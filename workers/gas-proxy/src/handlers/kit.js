/**
 * 出品キットAPI
 *
 * エンドポイント:
 *   POST /api/kit/save       — GASから呼び出し。キットデータをKV保存
 *   GET  /kit?token={uuid}   — キットページHTML配信
 *   GET  /api/kit/zip/{managedId}?token={uuid} — 商品画像ZIP
 *
 * 認証:
 *   saveKit: ADMIN_KEY認証（bodyのadminKeyフィールド）
 *   serveKit / zipProduct: UUIDv4トークン
 */

import { jsonOk, jsonError } from '../utils/response.js';
import { getKitPageHtml } from '../pages/kit-page.js';

const KIT_TTL = 7776000; // 90日

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

  // 画像URL取得: product-images:{managedId} を並列取得
  const items = kitData.items || [];
  if (items.length > 0) {
    const imagePromises = items.map(item =>
      env.CACHE.get(`product-images:${item.managedId.toUpperCase()}`)
    );
    const imageResults = await Promise.all(imagePromises);
    for (let i = 0; i < items.length; i++) {
      try {
        items[i].images = imageResults[i] ? JSON.parse(imageResults[i]) : [];
      } catch {
        items[i].images = [];
      }
    }
  }

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
    orderDate: '2026-03-28',
    totalPrice: 9750,
    items: [
      {
        managedId: 'DEMO-001',
        brand: 'BURBERRY',
        item: 'トップス',
        cat3: 'ニット・セーター',
        size: 'L',
        color: 'ベージュ',
        gender: 'メンズ',
        condition: 'B（使用感少ない）',
        priceText: '¥2,500',
        title: 'BURBERRY ニット セーター ノバチェック ベージュ L メンズ',
        description: '■ブランド\nBURBERRY バーバリー\n\n■アイテム\nニット・セーター\n\n■サイズ\nL\n肩幅: 46cm / 身幅: 54cm / 着丈: 68cm / 袖丈: 62cm\n\n■カラー\nベージュ\n\n■状態\n目立った傷や汚れなし\n全体的にきれいな状態です。\n\n■商品説明\nバーバリーの定番ノバチェック柄ニットです。上質なウール素材で暖かく、シンプルなデザインで合わせやすい一着です。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
        measurementText: '肩幅: 46cm / 身幅: 54cm / 着丈: 68cm / 袖丈: 62cm',
        images: []
      },
      {
        managedId: 'DEMO-002',
        brand: 'THE NORTH FACE',
        item: 'アウター',
        cat3: 'マウンテンパーカー',
        size: 'M',
        color: 'ブラック',
        gender: 'メンズ',
        condition: 'A（美品）',
        priceText: '¥3,500',
        title: 'ノースフェイス マウンテンパーカー ブラック M メンズ',
        description: '■ブランド\nTHE NORTH FACE ザ・ノースフェイス\n\n■アイテム\nマウンテンパーカー\n\n■サイズ\nM\n肩幅: 44cm / 身幅: 55cm / 着丈: 70cm / 袖丈: 64cm\n\n■カラー\nブラック\n\n■状態\n美品・ほぼ未使用に近い状態です。\n\n■商品説明\nノースフェイスのマウンテンパーカーです。防風・撥水機能があり、アウトドアからタウンユースまで幅広く活躍します。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
        measurementText: '肩幅: 44cm / 身幅: 55cm / 着丈: 70cm / 袖丈: 64cm',
        images: []
      },
      {
        managedId: 'DEMO-003',
        brand: 'Ralph Lauren',
        item: 'トップス',
        cat3: 'ポロシャツ',
        size: 'L',
        color: 'ネイビー',
        gender: 'メンズ',
        condition: 'B（使用感少ない）',
        priceText: '¥1,500',
        title: 'ラルフローレン ポロシャツ ポニー刺繍 ネイビー L メンズ',
        description: '■ブランド\nRalph Lauren ラルフローレン\n\n■アイテム\nポロシャツ\n\n■サイズ\nL\n肩幅: 45cm / 身幅: 56cm / 着丈: 72cm / 袖丈: 24cm\n\n■カラー\nネイビー\n\n■状態\n目立った傷や汚れなし\n\n■商品説明\nラルフローレンの定番ポロシャツです。胸元のポニー刺繍がワンポイント。鹿の子素材で通気性もよく、春夏に活躍します。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
        measurementText: '肩幅: 45cm / 身幅: 56cm / 着丈: 72cm / 袖丈: 24cm',
        images: []
      },
      {
        managedId: 'DEMO-004',
        brand: 'COACH',
        item: 'バッグ',
        cat3: 'ショルダーバッグ',
        size: '-',
        color: 'ブラウン',
        gender: 'レディース',
        condition: 'B（使用感少ない）',
        priceText: '¥2,250',
        title: 'COACH ショルダーバッグ シグネチャー ブラウン レディース',
        description: '■ブランド\nCOACH コーチ\n\n■アイテム\nショルダーバッグ\n\n■サイズ\n縦: 22cm / 横: 28cm / マチ: 8cm / ショルダー: 120cm\n\n■カラー\nブラウン\n\n■状態\n目立った傷や汚れなし\n\n■商品説明\nコーチのシグネチャー柄ショルダーバッグです。レザーとキャンバスのコンビ素材で高級感があります。収納力もあり普段使いに最適です。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
        measurementText: '縦: 22cm / 横: 28cm / マチ: 8cm / ショルダー: 120cm',
        images: []
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
