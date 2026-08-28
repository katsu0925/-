/**
 * 出品キットAPI
 *
 * エンドポイント:
 *   POST /api/kit/save       — GASから呼び出し。キットデータをKV保存
 *   GET  /kit?token={uuid}   — キットページHTML配信
 *   GET  /api/kit/zip/{managedId}?token={uuid} — 商品画像ZIP
 *   GET  /api/kit/csv?token={uuid}             — 全商品の一覧CSV（旧配布用リストXLSXと同じ14列）
 *
 * 認証:
 *   saveKit: ADMIN_KEY認証（bodyのadminKeyフィールド）
 *   serveKit / zipProduct / exportCsv: UUIDv4トークン
 */

import { jsonOk, jsonError } from '../utils/response.js';
import { getKitPageHtml } from '../pages/kit-page.js';

const KIT_TTL = 15552000; // 半年（180日）— 46点ロットを出品しきり、季節を一巡できる長さ

// ─── POST /api/kit/save ───

export async function saveKit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  // ADMIN_KEY認証
  if (!body.adminKey || body.adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 401);
  }

  const { receiptNo, token, kitData } = body;
  if (!receiptNo || !token || !kitData) {
    return jsonError('Missing required fields', 400);
  }

  // 画像URL取得＋「真の原画」への差し替え:
  //   1) product-images:{id} = 現在の表示画像URL配列（背景加工した商品は加工後版が入る）
  //   2) image-original:{id}:{現URL} があれば、その値（真の原画URL＝最初に撮影した生写真）に差し替える
  //      ※加工していない画像は image-original キーが無く、現URL自体が原画なのでそのまま使う
  //   配布画像をデタウリ自身の出品（加工済み）と別物にし、メルカリ重複画像検知を避ける狙い。
  const items = kitData.items || [];
  if (items.length > 0) {
    const ids = items.map(item => String(item.managedId || '').toUpperCase());

    // 1) 各商品の現在の表示画像URLを並列取得
    const urlResults = await Promise.all(
      ids.map(id => env.CACHE.get(`product-images:${id}`))
    );
    const itemUrls = urlResults.map(json => {
      try { return json ? JSON.parse(json) : []; } catch { return []; }
    });

    // 2) 「原画ポインタを持つ表示URL」を list で特定（list は値を返さないが、
    //    どの表示URLが加工済みかが分かるので、原画値の get は加工画像ぶんだけで済む）
    const listResults = await Promise.all(
      ids.map(id => env.CACHE.list({ prefix: `image-original:${id}:` }).catch(() => ({ keys: [] })))
    );

    // 3) 差し替えが必要な (商品index, 現URL, 原画キー) を収集。
    //    Workersのサブリクエスト上限(1000/呼び出し)を超えないよう原画getの本数を制限。
    //    既に product-images + list で 2N 本消費しているため、残りを原画getに割り当てる。
    const budget = Math.max(0, 950 - 2 * items.length);
    const lookups = [];
    let truncated = false;
    for (let i = 0; i < items.length; i++) {
      const prefix = `image-original:${ids[i]}:`;
      const hasOriginal = new Set();
      for (const entry of listResults[i].keys) hasOriginal.add(entry.name.slice(prefix.length));
      for (const url of itemUrls[i]) {
        if (!hasOriginal.has(url)) continue; // 加工なし＝現URLが原画
        if (lookups.length >= budget) { truncated = true; continue; }
        lookups.push({ i, url, key: prefix + url });
      }
    }
    if (truncated) {
      console.warn(`saveKit: 原画解決がサブリクエスト上限に達したため一部は現画像のまま (receiptNo=${receiptNo}, items=${items.length})`);
    }

    // 4) 真の原画URLを並列取得してマップ化
    const originalValues = await Promise.all(lookups.map(l => env.CACHE.get(l.key)));
    const originalMap = items.map(() => ({}));
    for (let k = 0; k < lookups.length; k++) {
      if (originalValues[k]) originalMap[lookups[k].i][lookups[k].url] = originalValues[k];
    }

    // 5) 表示URLを原画URLに差し替えて焼き込み（原画が無ければ現URL＝それ自体が原画）
    for (let i = 0; i < items.length; i++) {
      items[i].images = itemUrls[i].map(url => originalMap[i][url] || url);
    }
  }

  // 閲覧期限をデータに焼き込む。KVのTTLは保存時に決まるので、ここで確定する。
  // ページ側は「半年」ではなく実際の日付を出せる（何をいつまでに保存すべきか伝わる）。
  kitData.expiresAt = new Date(Date.now() + KIT_TTL * 1000).toISOString();

  // KV保存
  await env.CACHE.put(`kit:${receiptNo}`, JSON.stringify(kitData), { expirationTtl: KIT_TTL });
  await env.CACHE.put(`kit-token:${token}`, receiptNo, { expirationTtl: KIT_TTL });

  return jsonOk({ ok: true, receiptNo });
}

// ─── GET /kit?token={uuid} ───

export async function serveKit(request, env, url) {
  const token = url.searchParams.get('token');
  if (!token) {
    return kitErrorPage('トークンが指定されていません。');
  }

  // レート制限（IP 60回/分）
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:kit:${ip}`;
  const rlCount = parseInt(await env.SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 60) {
    return kitErrorPage('アクセス回数の上限に達しました。しばらくしてからお試しください。', 429);
  }
  await env.SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 60 });

  // トークン → 受付番号 → キットデータ
  const receiptNo = await env.CACHE.get(`kit-token:${token}`);
  if (!receiptNo) {
    return kitErrorPage('リンクが無効または期限切れです。');
  }

  const kitJson = await env.CACHE.get(`kit:${receiptNo}`);
  if (!kitJson) {
    return kitErrorPage('リンクが無効または期限切れです。');
  }

  // XSSエスケープ: </script> インジェクション防止
  const safeJson = kitJson.replace(/</g, '\\u003c');

  const html = getKitPageHtml(safeJson);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
  });
}

// ─── GET /api/kit/csv?token={uuid} ───

// 旧「配布用リスト」XLSX の列順・ヘッダーをそのまま踏襲する（1列目だけは
// XLSX ではチェックボックスで見出しが空欄だったため「出品済」と名前を付けた）。
const KIT_CSV_COLUMNS = [
  ['出品済',                    () => 'FALSE'],
  ['メルカリ用タイトル',        it => it.title],
  ['即出品用説明文（コピペ用）', it => it.description],
  ['箱ID',                      it => it.boxId],
  ['管理番号(照合用)',          it => it.managedId],
  ['ブランド',                  it => it.brand],
  ['AIキーワード',              it => it.aiKeywords],
  ['アイテム',                  it => it.item],
  ['サイズ',                    it => it.size],
  ['状態',                      it => it.condition],
  ['傷汚れ詳細',                it => it.damageDetail],
  ['採寸情報',                  it => it.measurementText],
  ['金額',                      it => it.priceText],
  ['性別',                      it => it.gender],
];

// RFC4180: 説明文に改行・カンマ・引用符が入るため、全セルを引用符で囲んで
// 内側の " を "" にエスケープする。先頭が = + - @ のセルは Excel が数式として
// 解釈する（CSVインジェクション）ので ' を前置して無害化する。
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function exportCsv(request, env, url) {
  const token = url.searchParams.get('token');
  if (!token) {
    return jsonError('Missing token', 400);
  }

  // レート制限（IP 20回/分）— ZIPより重いので serveKit より厳しめ
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:kitcsv:${ip}`;
  const rlCount = parseInt(await env.SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 20) {
    return jsonError('Too many requests', 429);
  }
  await env.SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 60 });

  const receiptNo = await env.CACHE.get(`kit-token:${token}`);
  if (!receiptNo) {
    return jsonError('Invalid or expired token', 403);
  }

  const kitJson = await env.CACHE.get(`kit:${receiptNo}`);
  if (!kitJson) {
    return jsonError('Invalid or expired token', 403);
  }

  let kitData;
  try {
    kitData = JSON.parse(kitJson);
  } catch {
    return jsonError('Invalid kit data', 500);
  }

  const items = kitData.items || [];
  const lines = [KIT_CSV_COLUMNS.map(c => csvCell(c[0])).join(',')];
  for (const item of items) {
    lines.push(KIT_CSV_COLUMNS.map(c => csvCell(c[1](item))).join(','));
  }

  // CRLF + UTF-8 BOM。BOM が無いと Excel が Shift_JIS と誤認して全部文字化けする。
  const body = '\uFEFF' + lines.join('\r\n') + '\r\n';

  const fileName = `出品リスト_${receiptNo}.csv`;
  const asciiName = `kit-list-${receiptNo}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
  });
}

// ─── GET /api/kit/zip/{managedId}?token={uuid} ───

export async function zipProduct(request, env, url) {
  const token = url.searchParams.get('token');
  if (!token) {
    return jsonError('Missing token', 400);
  }

  // トークン検証
  const receiptNo = await env.CACHE.get(`kit-token:${token}`);
  if (!receiptNo) {
    return jsonError('Invalid or expired token', 403);
  }

  // managedId取得
  const pathParts = url.pathname.split('/');
  const managedId = decodeURIComponent(pathParts[pathParts.length - 1]);
  if (!managedId) {
    return jsonError('Missing managedId', 400);
  }

  // R2から画像取得（managedIdを大文字正規化）
  const normalizedId = managedId.toUpperCase();
  const imagesJson = await env.CACHE.get(`product-images:${normalizedId}`);
  if (!imagesJson) {
    return jsonError('No images found', 404);
  }

  let imageUrls;
  try {
    imageUrls = JSON.parse(imagesJson);
  } catch {
    return jsonError('Invalid image data', 500);
  }

  if (!imageUrls || imageUrls.length === 0) {
    return jsonError('No images found', 404);
  }

  // 最大10枚
  imageUrls = imageUrls.slice(0, 10);

  // 画像をfetchして非圧縮ZIPを構築
  const imageData = await Promise.all(
    imageUrls.map(async (imgUrl, idx) => {
      try {
        // R2パスを抽出してR2から直接取得（相対パス・絶対パス両対応）
        const r2Key = imgUrl.replace(/^(https?:\/\/[^/]+)?\/images\//, '');
        const obj = await env.IMAGES.get(r2Key);
        if (!obj) return null;
        const data = await obj.arrayBuffer();
        const ext = imgUrl.endsWith('.png') ? '.png' : '.jpg';
        return { name: `${managedId}_${idx + 1}${ext}`, data: new Uint8Array(data) };
      } catch {
        return null;
      }
    })
  );

  const validImages = imageData.filter(Boolean);
  if (validImages.length === 0) {
    return jsonError('Failed to fetch images', 500);
  }

  // 非圧縮ZIP作成
  const zipBuffer = buildZipStore(validImages);

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${managedId}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

// ─── GET /kit/demo — SNS発信用デモページ ───

export function serveDemoKit() {
  const demoData = {
    isDemo: true,
    receiptNo: 'DEMO-SAMPLE',
    customerName: 'サンプル',
    orderDate: '2026-08-25',
    totalPrice: 2725,
    // デモ用の4点は、実際に納品した出品キットからそのまま引用している
    // （タイトル・説明文・採寸・撮影画像はすべて本番パイプラインの出力）。
    // お客様情報だけは受付番号・氏名をサンプル値に差し替えて匿名化している。
    items: [
      {
        managedId: "zY221",
        brand: "ミラオーウェン(Mila Owen)",
        item: "ワンピース",
        cat3: "ロングワンピース",
        size: "XS",
        color: "ブラウン系",
        gender: "レディース",
        condition: "目立った傷や汚れなし",
        aiKeywords: "ニットワンピース プリーツワンピース ウエストリボン",
        priceText: "900円",
        title: "美品 ミラオーウェン ロングワンピース ニットワンピース ブラウン XS",
        description: "ご覧いただきありがとうございます。\n\n━━━━━━━━━━━━━━━━━━━━\n\n■ ブランド\nミラオーウェン(Mila Owen)\n流行を反映し、大人の女性向けのスタイリッシュなブランドです。\n\n■ アイテム\nニットワンピース\nウエストリボンとプリーツが特徴のデザインで、エレガントな印象を与えます。優れた着心地で、長時間の着用にもおすすめです。\n\n■ こんな方におすすめ\n・おしゃれでありながら快適さを求める方\n・特別な場にもデイリーにも使えるアイテムを探している方\n・女性らしいシルエットを演出したい方\n\n■ 着こなしのヒント\n・シンプルなアクセサリーと合わせて上品に\n・スニーカーを合わせてカジュアルダウン\n・ブーツと合わせた秋冬スタイルを楽しむ\n\n■ サイズ\n表記：XS\n【実寸（平置き・cm）】\n着丈: 43 / 肩幅: 40 / 身幅: 40 / 袖丈: 50 / 総丈: 120 / ウエスト: 64 / ヒップ: 80\n\n■ 状態\n目立った傷や汚れなし。\n脇下やスカート部に毛玉がありますが、全体的には良好です。\n\n━━━━━━━━━━━━━━━━━━━━\n\n・古着のため、多少の使用感はご了承ください\n・平置き採寸のため、若干の誤差が生じる場合がございます\n・ご不明点はお気軽にコメントください\n\n#ミラオーウェン #ニットワンピース #古着",
        measurementText: "着丈: 43 / 肩幅: 40 / 身幅: 40 / 袖丈: 50 / 総丈: 120 / ウエスト: 64 / ヒップ: 80",
        images: [
          "/images/products/ZY221/213ea398-bdd3-4b9e-9180-c7f54d9241c8.jpg",
          "/images/products/ZY221/cffeeddb-c527-4c01-9e18-49f30bc0dbe0.jpg",
          "/images/products/ZY221/6be62b69-78ca-4c6c-88d0-2b44addae309.jpg",
          "/images/products/ZY221/7ece8995-e7d6-4b55-86ef-c631f07b2158.jpg",
          "/images/products/ZY221/5185971e-add4-4f82-8196-6710c6546730.jpg",
          "/images/products/ZY221/b1eb60f9-da6c-4fe9-a522-121d877ec805.jpg",
          "/images/products/ZY221/b2c88020-a685-495c-8eb0-dd572f62ad54.jpg",
          "/images/products/ZY221/92115132-2305-40f1-b2db-6e605c1668fb.jpg",
          "/images/products/ZY221/74caedcd-e4ee-4316-8c25-e5c55cd70e40.jpg",
        ]
      },
      {
        managedId: "zG1145",
        brand: "BANANA REPUBLIC",
        item: "ジャケット・アウター",
        cat3: "テーラードジャケット",
        size: "M",
        color: "ブラック系",
        gender: "レディース",
        condition: "目立った傷や汚れなし",
        aiKeywords: "テーラードジャケット ショート丈 シングルボタン ポケット付き 長袖 レディース用風",
        priceText: "700円",
        title: "美品 BANANA REPUBLIC テーラードジャケット ブラック M",
        description: "ご覧いただきありがとうございます。\n\n━━━━━━━━━━━━━━━━━━━━\n\n■ ブランド\nBANANA REPUBLIC（バナナリパブリック）  \nアメリカの人気カジュアルブランドで、スタイリッシュで高品質なアイテムの展開が魅力です。\n\n■ アイテム\nテーラードジャケット  \nショート丈のシングルボタンジャケットで、ポケットが付いたカジュアルなデザイン。普段使いからビジネスシーンまで活躍する一着です。\n\n■ こんな方におすすめ\n・カジュアルなジャケットを探している方  \n・スタイリングにこだわりたい方  \n・着回しができるアイテムを求めている方  \n\n■ 着こなしのヒント\nブラウスやTシャツを合わせ、ジーンズやスカートとコーディネートすれば、いつでも素敵な着こなしが楽しめます。\n\n■ サイズ\n表記：M  \n【実寸（平置き・cm）】  \n着丈: 50 / 肩幅: 36 / 身幅: 42 / 袖丈: 60\n\n■ 状態\n目立った傷や汚れなし。\n\n━━━━━━━━━━━━━━━━━━━━\n\n・古着のため、多少の使用感はご了承ください  \n・平置き採寸のため、若干の誤差が生じる場合がございます  \n・ご不明点はお気軽にコメントください\n\n#BANANAREPUBLIC #テーラードジャケット #ショート丈 #古着 #カジュアル #スタイリッシュ #着回し #アメリカブランド #ファッション #ビジネスカジュアル",
        measurementText: "着丈: 50 / 肩幅: 36 / 身幅: 42 / 袖丈: 60",
        images: [
          "/images/products/ZG1145/d0661cc2-f6de-41d9-9159-e7e0b290fb7f.jpg",
          "/images/products/ZG1145/677011af-a491-4a58-9365-5bfcae63c867.jpg",
          "/images/products/ZG1145/bf4ca9c1-c38c-4ee1-8625-0c4f48e44100.jpg",
          "/images/products/ZG1145/9b48b9e1-c78c-4fda-86c3-9cf49ab8d3cd.jpg",
          "/images/products/ZG1145/b5845ede-b55f-4b65-a5d4-04a1f36a5a43.jpg",
          "/images/products/ZG1145/07924198-8416-4625-8ce7-43802a5cf841.jpg",
          "/images/products/ZG1145/35e43506-3b07-40dd-a4a8-fb167434d89c.jpg",
          "/images/products/ZG1145/62cc5d5f-a9a1-44ea-a4d9-2a7fe59c01f8.jpg",
          "/images/products/ZG1145/08bace75-af15-4331-8bd1-5bf8a6bf99cc.jpg",
          "/images/products/ZG1145/c61d6476-695b-4947-aaca-d2c7b5d07617.jpg",
        ]
      },
      {
        managedId: "zG795",
        brand: "SHIPS",
        item: "ジャケット・アウター",
        cat3: "ブルゾン",
        size: "S",
        color: "グリーン系",
        gender: "メンズ",
        condition: "目立った傷や汚れなし",
        aiKeywords: "ジャケット チェック 長袖 ポケット",
        priceText: "495円",
        title: "美品 SHIPS シップス ブルゾン チェック 長袖 ポケット グリーン S",
        description: "ご覧いただきありがとうございます。\n\n━━━━━━━━━━━━━━━━━━━━\n\n■ ブランド\nSHIPS（シップス）\n質の高いカジュアルを提案する日本のブランドで、上品なデザインで大人の女性に人気を博しています。\n\n■ アイテム\nチェックジャケット\nクラシックなチェック柄が特徴の長袖ジャケットです。ポケット付きで、実用性を兼ね備えています。\n\n■ こんな方におすすめ\n・オフィスカジュアルをお探しの方\n・チェック柄が好きな方\n・旬のトレンドを取り入れたい方\n\n■ 着こなしのヒント\nシンプルなトップスに合わせるだけで、洗練されたスタイルに仕上がります。ワイドパンツとのコーディネートで、トレンド感をアップさせることができます。\n\n■ サイズ\n表記：S\n【実寸（平置き・cm）】\n着丈: 57 / 肩幅: 40 / 身幅: 43 / 袖丈: 60\n\n■ 状態\n目立った傷や汚れなし\n全体的に非常に良好な状態です。\n\n━━━━━━━━━━━━━━━━━━━━\n\n・古着のため、多少の使用感はご了承ください\n・平置き採寸のため、若干の誤差が生じる場合がございます\n・ご不明点はお気軽にコメントください\n\n#SHIPS #古着 #チェックジャケット #カジュアル #ファッション",
        measurementText: "着丈: 57 / 肩幅: 40 / 身幅: 43 / 袖丈: 60",
        images: [
          "/images/products/ZG795/3380605f-3529-48ed-9392-1525a8f85de5.jpg",
          "/images/products/ZG795/542d7b6e-1d3a-42fb-9c5b-5ba4a38927f5.jpg",
          "/images/products/ZG795/2f33cd02-c71f-47f2-be75-1740156c9241.jpg",
          "/images/products/ZG795/9e8aa26c-321b-4614-9e5a-ccf60caf3ccd.jpg",
          "/images/products/ZG795/a063b4cf-9004-444b-b383-728e34528ac5.jpg",
          "/images/products/ZG795/513e706a-071e-4000-bf2d-9066eda58a1c.jpg",
          "/images/products/ZG795/b72a50da-b510-42d2-ba82-a38bbe5636c0.jpg",
          "/images/products/ZG795/227027ed-3665-400a-a714-5b66a87f2448.jpg",
          "/images/products/ZG795/b80dff1c-8539-4d93-93f0-c30413f2314d.jpg",
          "/images/products/ZG795/d4472e11-a194-4249-a6bc-6673e5abae0a.jpg",
        ]
      },
      {
        managedId: "zG907",
        brand: "CONVERSE",
        item: "ジャケット・アウター",
        cat3: "ダウンジャケット",
        size: "M",
        color: "ブラック系",
        gender: "メンズ",
        condition: "目立った傷や汚れなし",
        aiKeywords: "ダウンジャケット ロング丈 ハイネック ボリューム襟 キルティング ポケット",
        priceText: "630円",
        title: "美品 CONVERSE コンバース ダウンジャケット ロング丈 ブラック M",
        description: "ご覧いただきありがとうございます。\n\n━━━━━━━━━━━━━━━━━━━━\n\n■ ブランド\nCONVERSE（コンバース）\nスポーティーでありながらスタイリッシュなデザインが光るブランドで、スニーカーだけでなくアパレルも人気です。\n\n■ アイテム\nダウンジャケット\nハイネックでボリューム感のある襟が特徴的なロング丈のダウンジャケットです。キルティングデザインが暖かさを保ちつつ、ファッション性も抜群です。\n\n■ こんな方におすすめ\n・寒い季節に最適なアウターを探している方\n・ワンランク上のおしゃれを目指したい方\n・アクティブに過ごす方 \n\n■ 着こなしのヒント\nインナーにはスウェットやタートルネックを選ぶと、トレンド感を加えたスタイリングが完成します。スカートとのコーデも、外さずに決まります。\n\n■ サイズ\n表記：M\n【実寸（平置き・cm）】\n着丈: 89 / 肩幅: 43 / 身幅: 56 / 袖丈: 59\n\n■ 状態\n目立った傷や汚れなし\n袖口・エリ・前裾・右肩辺りに汚れがございますが、全体的に良好です。\n\n━━━━━━━━━━━━━━━━━━━━\n\n・古着のため、多少の使用感はご了承ください\n・平置き採寸のため、若干の誤差が生じる場合がございます\n・ご不明点はお気軽にコメントください\n\n#CONVERSE #古着 #ダウンジャケット #アウター",
        measurementText: "着丈: 89 / 肩幅: 43 / 身幅: 56 / 袖丈: 59",
        images: [
          "/images/products/ZG907/30f09408-c609-46e8-926c-b2c3bd14fad5.jpg",
          "/images/products/ZG907/60e5a864-e5bc-423c-9554-14f635ea71b1.jpg",
          "/images/products/ZG907/5c638525-e041-4938-bca9-bf2fb63fdc97.jpg",
          "/images/products/ZG907/bd052809-5ea0-4376-a9c0-3c69bbb2213f.jpg",
          "/images/products/ZG907/41eb06b6-215a-41a2-b3b0-88f0f643cfd0.jpg",
          "/images/products/ZG907/796ab957-cea3-4d74-bc20-2d13a7bb7413.jpg",
          "/images/products/ZG907/237da82b-6b81-4866-b29a-327e76008803.jpg",
          "/images/products/ZG907/f92b9798-3f02-44b8-be85-3dae5d765769.jpg",
          "/images/products/ZG907/fb0bfa8d-d028-4c0b-bb4a-deda3092e49f.jpg",
          "/images/products/ZG907/c27a2250-454a-4244-8b35-de14f4a2d116.jpg",
        ]
      }
    ]
  };

  const safeJson = JSON.stringify(demoData).replace(/</g, '\\u003c');
  const html = getKitPageHtml(safeJson);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ─── ヘルパー ───

function kitErrorPage(message, status = 404) {
  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>出品キット — デタウリ</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f5f5f7;margin:0;}
.msg{text-align:center;padding:40px;max-width:400px;}.msg h1{font-size:20px;color:#1a1a2e;margin-bottom:12px;}.msg p{color:#666;font-size:14px;line-height:1.6;}</style>
</head><body><div class="msg"><h1>出品キット</h1><p>${message}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * 非圧縮ZIP（STOREDメソッド）を構築
 * Workers環境でzlibが不要な軽量実装
 */
function buildZipStore(files) {
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataLen = file.data.byteLength;

    // CRC-32計算
    const crc = crc32(file.data);

    // Local file header (30 + nameLen + dataLen)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression: STORED
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc-32
    lv.setUint32(18, dataLen, true);     // compressed size
    lv.setUint32(22, dataLen, true);     // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // filename length
    lv.setUint16(28, 0, true);           // extra field length
    localHeader.set(nameBytes, 30);

    localHeaders.push(localHeader);
    localHeaders.push(file.data);

    // Central directory header
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression: STORED
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, crc, true);         // crc-32
    cv.setUint32(20, dataLen, true);     // compressed size
    cv.setUint32(24, dataLen, true);     // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // filename length
    cv.setUint16(30, 0, true);           // extra field length
    cv.setUint16(32, 0, true);           // file comment length
    cv.setUint16(34, 0, true);           // disk number start
    cv.setUint16(36, 0, true);           // internal file attributes
    cv.setUint32(38, 0, true);           // external file attributes
    cv.setUint32(42, offset, true);      // relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralHeaders.push(centralHeader);
    offset += 30 + nameBytes.length + dataLen;
  }

  // End of central directory record
  const centralDirSize = centralHeaders.reduce((s, h) => s + h.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);    // signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // disk with central dir
  ev.setUint16(8, files.length, true);   // entries on this disk
  ev.setUint16(10, files.length, true);  // total entries
  ev.setUint32(12, centralDirSize, true);// central dir size
  ev.setUint32(16, offset, true);        // central dir offset
  ev.setUint16(20, 0, true);             // comment length

  // 全体を結合
  const totalSize = offset + centralDirSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const buf of localHeaders) {
    result.set(buf, pos);
    pos += buf.byteLength;
  }
  for (const buf of centralHeaders) {
    result.set(buf, pos);
    pos += buf.byteLength;
  }
  result.set(eocd, pos);

  return result.buffer;
}

/**
 * CRC-32計算（ZIP互換）
 */
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
