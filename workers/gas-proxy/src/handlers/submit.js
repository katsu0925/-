/**
 * 注文送信API（Phase 5）
 *
 * apiSubmitEstimate — 前半（バリデーション・金額計算・送料計算・FHP判定）をWorkersで実行
 * 検証通過後、注文データをGASにプロキシ（Sheets書き込み + Drive + メール送信）
 *
 * apiBulkSubmit — 同様のハイブリッド構成
 */
import { jsonOk, jsonError, corsResponse } from '../utils/response.js';

// 送料テーブル（同期時にD1 settingsから読み込み、フォールバック用にハードコード）
const DEFAULT_SHIPPING_AREAS = {
  '北海道': 'hokkaido',
  '青森県': 'kita_tohoku', '岩手県': 'kita_tohoku', '秋田県': 'kita_tohoku',
  '宮城県': 'minami_tohoku', '福島県': 'minami_tohoku', '山形県': 'minami_tohoku',
  '東京都': 'kanto', '神奈川県': 'kanto', '埼玉県': 'kanto', '千葉県': 'kanto',
  '茨城県': 'kanto', '栃木県': 'kanto', '群馬県': 'kanto', '山梨県': 'kanto',
  '新潟県': 'shinetsu', '長野県': 'shinetsu',
  '愛知県': 'tokai', '静岡県': 'tokai', '岐阜県': 'tokai', '三重県': 'tokai',
  '石川県': 'hokuriku', '福井県': 'hokuriku', '富山県': 'hokuriku',
  '大阪府': 'kansai', '兵庫県': 'kansai', '京都府': 'kansai',
  '奈良県': 'kansai', '和歌山県': 'kansai', '滋賀県': 'kansai',
  '広島県': 'chugoku', '岡山県': 'chugoku', '島根県': 'chugoku',
  '山口県': 'chugoku', '鳥取県': 'chugoku',
  '香川県': 'shikoku', '愛媛県': 'shikoku', '高知県': 'shikoku', '徳島県': 'shikoku',
  '福岡県': 'kita_kyushu', '佐賀県': 'kita_kyushu', '大分県': 'kita_kyushu', '長崎県': 'kita_kyushu',
  '鹿児島県': 'minami_kyushu', '熊本県': 'minami_kyushu', '宮崎県': 'minami_kyushu',
  '沖縄県': 'okinawa',
};

const DEFAULT_SHIPPING_RATES = {
  minami_kyushu: [1320, 1700], kita_kyushu: [1280, 1620],
  shikoku: [1180, 1440], chugoku: [1200, 1480],
  kansai: [1100, 1260], hokuriku: [1160, 1420],
  tokai: [1180, 1440], shinetsu: [1220, 1540],
  kanto: [1300, 1680], minami_tohoku: [1400, 1900],
  kita_tohoku: [1460, 1980], hokkaido: [1640, 2380],
  okinawa: [2500, 3500],
};

const REMOTE_ISLANDS = [
  '大島町', '利島村', '新島村', '神津島村', '三宅村', '御蔵島村', '八丈町', '青ヶ島村', '小笠原村',
  '奄美市', '大和村', '宇検村', '瀬戸内町', '龍郷町', '喜界町', '徳之島町', '天城町', '伊仙町',
  '和泊町', '知名町', '与論町', '三島村', '十島村',
  '宮古島市', '石垣市', '多良間村', '竹富町', '与那国町', '久米島町', '座間味村', '渡嘉敷村',
  '粟国村', '渡名喜村', '南大東村', '北大東村', '伊江村', '伊是名村', '伊平屋村',
  '佐渡市', '隠岐の島町', '海士町', '西ノ島町', '知夫村',
  '対馬市', '壱岐市', '五島市', '新上五島町', '小値賀町',
  '利尻町', '利尻富士町', '礼文町', '奥尻町',
];

const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県',
  '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

/**
 * apiSubmitEstimate — 注文前半バリデーション
 *
 * バリデーション・金額計算をWorkersで高速実行し、
 * 検証通過後はGASにプロキシして確保・KOMOJU決済・シート書き込みを実行。
 */
export async function submitEstimate(args, env, bodyText) {
  const userKey = String(args[0] || '').trim();
  const form = args[1] || {};
  const ids = args[2] || [];

  if (!userKey) return jsonError('userKeyが不正です');

  const hasBulkItems = form.bulkItems && form.bulkItems.length > 0;
  if ((!ids || ids.length === 0) && !hasBulkItems) {
    return jsonError('カートが空です');
  }

  // デタウリ最低注文数チェック
  const minDetauri = hasBulkItems ? 1 : 5;
  if (ids.length > 0 && ids.length < minDetauri) {
    return jsonError(`デタウリ商品は${minDetauri}点以上で購入可能です（現在${ids.length}点）`);
  }

  // フォームバリデーション
  const companyName = String(form.companyName || '').trim();
  const contact = String(form.contact || '').trim();
  const postal = String(form.postal || '').trim();
  const address = String(form.address || '').trim();
  const phone = String(form.phone || '').trim();

  if (!companyName) return jsonError('会社名/氏名は必須です');
  if (!contact) return jsonError('メールアドレスは必須です');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return jsonError('有効なメールアドレスを入力してください');
  if (!postal) return jsonError('郵便番号は必須です');
  if (!address) return jsonError('住所は必須です');
  if (!phone) return jsonError('電話番号は必須です');

  // 離島チェック
  if (isRemoteIsland(address)) {
    return jsonError('離島への配送は現在対応しておりません。');
  }

  // 都道府県検出
  const pref = detectPrefecture(address);
  if (!pref) {
    return jsonError('住所から都道府県を判別できません。住所を確認してください。');
  }

  // D1から商品データ検証
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT managed_id, price FROM products WHERE managed_id IN (${placeholders})`
    ).bind(...ids).all();

    const foundIds = new Set(results.map(r => r.managed_id));
    const missing = ids.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      return jsonError('商品が見つかりません: ' + missing.join('、'));
    }

    // 商品合計計算
    let sum = 0;
    for (const r of results) sum += r.price;

    // 確保チェック（他ユーザーに確保されていないか）
    const now = Date.now();
    const { results: otherHolds } = await env.DB.prepare(
      `SELECT managed_id FROM holds
       WHERE managed_id IN (${placeholders})
         AND user_key != ? AND until_ms > ?`
    ).bind(...ids, userKey, now).all();

    if (otherHolds.length > 0) {
      const heldIds = otherHolds.map(h => h.managed_id);
      return jsonError('確保できない商品が含まれています: ' + heldIds.join('、'));
    }

    // 依頼中チェック
    const { results: openCheck } = await env.DB.prepare(
      `SELECT managed_id FROM open_items WHERE managed_id IN (${placeholders})`
    ).bind(...ids).all();

    if (openCheck.length > 0) {
      const openIds = openCheck.map(o => o.managed_id);
      return jsonError('依頼中の商品が含まれています: ' + openIds.join('、'));
    }
  }

  // reCAPTCHA検証（Workers側で実行）
  // bodyTextをパースしてrecaptchaTokenを取得
  let parsedBody;
  try { parsedBody = JSON.parse(bodyText); } catch (e) { parsedBody = {}; }
  const recaptchaToken = parsedBody.recaptchaToken || '';

  if (recaptchaToken && env.RECAPTCHA_SECRET) {
    const verified = await verifyRecaptcha(recaptchaToken, env.RECAPTCHA_SECRET);
    if (!verified) {
      return jsonError('bot判定されました。ブラウザを再読み込みして再度お試しください。');
    }
  }

  // 検証通過 → GASにプロキシ（確保・決済セッション作成・シート書き込み）
  return await proxyToGasForSubmit(bodyText, env);
}

// ─── ヘルパー ───

function isRemoteIsland(address) {
  const text = String(address || '').trim();
  return REMOTE_ISLANDS.some(island => text.includes(island));
}

function detectPrefecture(address) {
  const text = String(address || '').trim();
  for (const pref of PREFECTURES) {
    if (text.startsWith(pref)) return pref;
  }
  // 略称チェック（東京、大阪 等）
  for (const pref of PREFECTURES) {
    const short = pref.replace(/[都府県]$/, '');
    if (text.startsWith(short)) return pref;
  }
  return null;
}

async function verifyRecaptcha(token, secret) {
  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
  });

  const result = await resp.json();
  return result.success && (result.score || 0) >= 0.3;
}

async function proxyToGasForSubmit(bodyText, env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    return jsonError('GAS_API_URL not configured', 502);
  }

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: bodyText,
    redirect: 'follow',
  });

  const text = await resp.text();
  return corsResponse(new Response(text, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Source': 'gas-proxy-validated',
    },
  }));
}
