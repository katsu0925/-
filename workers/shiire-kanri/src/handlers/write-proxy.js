import { jsonOk, jsonError } from '../utils/response.js';

// POST /api/save/measurement  body: { kanri, measure: {着丈, 肩幅, ...} }
// POST /api/save/sale         body: { kanri, sale: {salePrice, saleDate, salePlace, saleShipping, saleFee} }

export async function saveMeasurement(request, env, user) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const measure = body.measure || {};
  if (!kanri) return jsonError('kanri required', 400);

  const gasRes = await callGas(env, 'saveMeasurement', { kanri, measure }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // 楽観的更新: D1 にも即時反映
  const __td1 = Date.now();
  try {
    const measuredAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE products SET measure_json = ?, measured_at = ?, measured_by = ?, updated_at = ?
      WHERE kanri = ?
    `).bind(JSON.stringify(measure), measuredAt, user.email, Date.now(), kanri).run();
  } catch (err) {
    console.warn('[save] d1 update failed', err.message);
  }
  const t = Object.assign({}, gasRes._t || {}, { d1: Date.now() - __td1, total: Date.now() - __t0 });
  return jsonOk({ saved: true }, { 'Server-Timing': buildServerTiming(t) });
}

export async function saveSale(request, env, user) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const sale = body.sale || {};
  if (!kanri) return jsonError('kanri required', 400);

  // フロントは saleDate/salePlace/salePrice/saleShipping/saleFee で送る。
  // GAS は sale.date/place/price/shipping/fee を期待する。ここで吸収。
  const saleForGas = {
    date: sale.saleDate,
    place: sale.salePlace,
    price: sale.salePrice,
    shipping: sale.saleShipping,
    fee: sale.saleFee,
  };
  const gasRes = await callGas(env, 'saveSale', { kanri, sale: saleForGas }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  const __td1 = Date.now();
  try {
    await env.DB.prepare(`
      UPDATE products SET
        sale_date = ?, sale_place = ?, sale_price = ?, sale_shipping = ?, sale_fee = ?,
        updated_at = ?
      WHERE kanri = ?
    `).bind(
      String(sale.saleDate || ''),
      String(sale.salePlace || ''),
      Number(sale.salePrice || 0),
      Number(sale.saleShipping || 0),
      Number(sale.saleFee || 0),
      Date.now(),
      kanri,
    ).run();
  } catch (err) {
    console.warn('[save] d1 update failed', err.message);
  }
  const t = Object.assign({}, gasRes._t || {}, { d1: Date.now() - __td1, total: Date.now() - __t0 });
  return jsonOk({ saved: true }, { 'Server-Timing': buildServerTiming(t) });
}

// POST /api/save/details  body: { kanri, fields: { 'ヘッダー名': 値, ... } }
// 任意のヘッダーキーで商品管理シートを部分更新する汎用エンドポイント
export async function saveDetails(request, env, user) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const fields = body.fields || {};
  if (!kanri) return jsonError('kanri required', 400);
  const keys = Object.keys(fields);
  if (keys.length === 0) return jsonError('fields required', 400);

  const gasRes = await callGas(env, 'saveDetails', { kanri, fields }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);
  const __td1 = Date.now();

  // 楽観的更新: GAS が返す record（再計算後の最新行）を優先して extra_json と専用カラムを更新する。
  // record があれば「シートが正」のスナップショットとして使える → 派生ステータス・粗利等が即時に反映される。
  // record が無い場合のみ従来通り fields をそのままマージ。
  const record = (gasRes && gasRes.record && typeof gasRes.record === 'object') ? gasRes.record : null;
  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    let extra = {};
    if (cur && cur.extra_json) {
      try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
    }
    if (record) {
      // record の各キーで上書き（読み取り専用キーも含めて全列が来ているはず）
      for (const k of Object.keys(record)) {
        const v = record[k];
        extra[k] = v == null ? '' : v;
      }
    } else {
      for (const k of keys) {
        const v = fields[k];
        extra[k] = v == null ? '' : String(v);
      }
    }
    // 既存の専用カラムにも反映（フィルタ性能維持）
    const sets = ['extra_json = ?', 'updated_at = ?'];
    const args = [JSON.stringify(extra), Date.now()];
    function push(col, val) { sets.push(`${col} = ?`); args.push(val); }

    // 派生 status は GAS の derivedStatus（再計算済み）を最優先、無ければ fields → record の順
    const derived = (gasRes && typeof gasRes.derivedStatus === 'string' && gasRes.derivedStatus)
      ? gasRes.derivedStatus
      : (fields['ステータス'] !== undefined ? String(fields['ステータス'] || '') : (record && record['ステータス'] != null ? String(record['ステータス']) : null));
    if (derived !== null) push('status', derived);

    // 専用カラムは record があれば record から、無ければ fields から拾う
    function pick(name) {
      if (record && record[name] !== undefined) return record[name];
      if (fields[name] !== undefined) return fields[name];
      return undefined;
    }
    const state = pick('状態');
    if (state !== undefined) push('state', String(state || ''));
    const brand = pick('ブランド');
    if (brand !== undefined) push('brand', String(brand || ''));
    const size = pick('メルカリサイズ');
    if (size !== undefined) push('size', String(size || ''));
    const color = pick('カラー');
    if (color !== undefined) push('color', String(color || ''));
    const saleDate = pick('販売日');
    if (saleDate !== undefined) push('sale_date', String(saleDate || ''));
    const salePlace = pick('販売場所');
    if (salePlace !== undefined) push('sale_place', String(salePlace || ''));
    const sp = pick('販売価格');
    if (sp !== undefined) {
      const n = Number(sp);
      push('sale_price', Number.isFinite(n) ? n : null);
    }
    const sh = pick('送料');
    if (sh !== undefined) {
      const n = Number(sh);
      push('sale_shipping', Number.isFinite(n) ? n : null);
    }
    const sf = pick('手数料');
    if (sf !== undefined) {
      const n = Number(sf);
      push('sale_fee', Number.isFinite(n) ? n : null);
    }
    args.push(kanri);
    await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE kanri = ?`).bind(...args).run();
  } catch (err) {
    console.warn('[save details] d1 update failed', err.message);
  }

  const t = Object.assign({}, gasRes._t || {}, { d1: Date.now() - __td1, total: Date.now() - __t0 });
  // record をそのまま返す: フロントは保存後の再 fetch を省いて、record で d.extra を直接更新する。
  // これで「保存ボタン押下 → 派生値（粗利・利益・ステータス）反映」までの ms を 1 往復ぶん削減。
  return jsonOk({
    saved: true,
    written: gasRes.written || 0,
    skipped: gasRes.skipped || [],
    unknown: gasRes.unknown || [],
    derivedStatus: gasRes.derivedStatus || '',
    statusChanged: !!gasRes.statusChanged,
    record: record || null
  }, { 'Server-Timing': buildServerTiming(t) });
}

// POST /api/save/image  body: { kanri, field, dataUrl }
// dataUrl は "data:image/jpeg;base64,..." 形式。GAS が Drive にアップロードして URL をシートに書き戻す。
export async function uploadImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const field = String(body.field || '').trim();
  const dataUrl = String(body.dataUrl || '');
  if (!kanri) return jsonError('kanri required', 400);
  if (!field) return jsonError('field required', 400);
  if (!dataUrl) return jsonError('dataUrl required', 400);

  const gasRes = await callGas(env, 'uploadImage', { kanri, field, dataUrl }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // 2026-05-03 以降: GAS は相対パス (path) と Drive URL (url) の両方を返す。
  // シートには path（AppSheet 互換 "商品管理_Images/..."）を書いているため D1 にも path を入れる。
  // path → URL の解決は既存の /api/image/resolve（KV キャッシュ 1日）が引き受ける。
  const sheetValue = gasRes.path || gasRes.url || '';
  // resolveImage の KV キャッシュをこの path で予熱しておくと、直後の表示で 1往復省ける
  if (env.CACHE && gasRes.path && gasRes.url) {
    try {
      // normalizeDriveUrl_ 相当の正規化（uc?id → thumbnail?id&sz=w500）
      const m = String(gasRes.url).match(/^https?:\/\/drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/);
      const norm = m ? ('https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w500') : gasRes.url;
      await env.CACHE.put('imgresolve:' + gasRes.path, norm, { expirationTtl: 86400 });
    } catch (err) {
      console.warn('[upload image] kv warm failed', err.message);
    }
  }

  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    let extra = {};
    if (cur && cur.extra_json) {
      try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
    }
    extra[field] = sheetValue;
    await env.DB.prepare('UPDATE products SET extra_json = ?, updated_at = ? WHERE kanri = ?')
      .bind(JSON.stringify(extra), Date.now(), kanri).run();
  } catch (err) {
    console.warn('[upload image] d1 update failed', err.message);
  }

  return jsonOk({ uploaded: true, url: gasRes.url, path: gasRes.path || '', field });
}

// POST /api/image/resolve  body: { kanri, field, path }
// AppSheet 旧形式の相対パスを Drive シェアURL に解決。KV キャッシュ 1日。
// Drive の uc?id=FILE_ID は <img> タグから直接表示できない（リダイレクト/ウイルススキャン警告）
// → thumbnail?id=FILE_ID&sz=w500 に正規化して返す（GAS 側変更不要・既存KVキャッシュも自動対応）
function normalizeDriveUrl_(url) {
  if (!url) return url;
  // /uc?id=FILE_ID パターン → /thumbnail?id=FILE_ID&sz=w500
  var m = url.match(/^https?:\/\/drive\.google\.com\/uc\?(.*&)?id=([^&]+)/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[2] + '&sz=w500';
  // /file/d/FILE_ID/view パターン → /thumbnail?id=FILE_ID&sz=w500
  var m2 = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w500';
  return url;
}
export async function resolveImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const path = String(body.path || '').trim();
  const field = String(body.field || '').trim();
  const kanri = String(body.kanri || '').trim();
  if (!path) return jsonError('path required', 400);

  const cacheKey = 'imgresolve:' + path;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) return jsonOk({ url: normalizeDriveUrl_(cached), cached: true });
    } catch (err) {
      console.warn('[resolve image] kv get failed', err.message);
    }
  }

  const gasRes = await callGas(env, 'resolveImage', { kanri, field, path }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  const normalizedUrl = normalizeDriveUrl_(gasRes.url);

  if (env.CACHE && normalizedUrl) {
    try {
      await env.CACHE.put(cacheKey, normalizedUrl, { expirationTtl: 86400 });
    } catch (err) {
      console.warn('[resolve image] kv put failed', err.message);
    }
  }

  return jsonOk({ url: normalizedUrl, fileName: gasRes.fileName });
}

// POST /api/create/purchase  body: { date, category, amount, shipping, planned, place, content, supplierId, registerUser }
export async function createPurchase(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }

  const payload = {
    date: String(body.date || '').trim(),
    category: String(body.category || '').trim(),
    amount: Number(body.amount || 0) || 0,
    shipping: Number(body.shipping || 0) || 0,
    planned: Number(body.planned || 0) || 0,
    place: String(body.place || '').trim(),
    content: String(body.content || '').trim(),
    supplierId: String(body.supplierId || '').trim(),
    registerUser: String(body.registerUser || '').trim(),
  };
  if (!payload.date) return jsonError('仕入れ日が空です', 400);
  if (!payload.category) return jsonError('区分コードが空です', 400);
  if (!payload.place) return jsonError('納品場所が空です', 400);

  const gasRes = await callGas(env, 'createPurchase', payload, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // D1 への楽観的 INSERT（次の Cron で確定するが即時表示のため）
  try {
    const nowIso = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO purchases (shiire_id, date, amount, shipping, planned, place, cost, category,
                              content, supplier_id, register_user, registered_at, assigned_kanri, processed,
                              row_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shiire_id) DO UPDATE SET
        date = excluded.date, amount = excluded.amount, shipping = excluded.shipping,
        planned = excluded.planned, place = excluded.place, category = excluded.category,
        content = excluded.content, supplier_id = excluded.supplier_id,
        register_user = excluded.register_user, registered_at = excluded.registered_at,
        assigned_kanri = excluded.assigned_kanri, processed = excluded.processed,
        updated_at = excluded.updated_at
    `).bind(
      gasRes.shiireId,
      payload.date,
      payload.amount,
      payload.shipping,
      payload.planned,
      payload.place,
      payload.planned > 0 ? Math.round((payload.amount + payload.shipping) / payload.planned) : 0,
      payload.category,
      payload.content,
      payload.supplierId,
      payload.registerUser,
      nowIso,
      gasRes.assignedKanri || '',
      1,
      gasRes.row || 0,
      Date.now(),
    ).run();
  } catch (err) {
    console.warn('[create] purchases d1 insert failed', err.message);
  }

  return jsonOk({ created: true, shiireId: gasRes.shiireId, assignedKanri: gasRes.assignedKanri || '' });
}

// POST /api/create/product  body: { shiireId, kanri, brand, size, color, state, status, fields? }
export async function createProduct(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }

  const payload = {
    shiireId: String(body.shiireId || '').trim(),
    kanri: String(body.kanri || '').trim(),
    brand: String(body.brand || '').trim(),
    size: String(body.size || '').trim(),
    color: String(body.color || '').trim(),
    state: String(body.state || '').trim(),
    status: String(body.status || '採寸待ち').trim(),
    fields: (body.fields && typeof body.fields === 'object') ? body.fields : {},
  };
  if (!payload.shiireId) return jsonError('仕入れIDが空です', 400);
  if (!payload.kanri) return jsonError('管理番号が空です', 400);

  const gasRes = await callGas(env, 'createProduct', payload, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  try {
    // 即時表示用に extra_json も組み立てる（次の Cron で確定）
    const extra = Object.assign({}, payload.fields || {});
    extra['ステータス'] = payload.status;
    extra['ブランド'] = payload.brand || extra['ブランド'] || '';
    extra['メルカリサイズ'] = payload.size || extra['メルカリサイズ'] || '';
    extra['カラー'] = payload.color || extra['カラー'] || '';
    extra['状態'] = payload.state || extra['状態'] || '';
    extra['管理番号'] = payload.kanri;
    extra['仕入れID'] = payload.shiireId;
    await env.DB.prepare(`
      INSERT INTO products (kanri, shiire_id, status, brand, size, color, state, extra_json, row_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kanri) DO UPDATE SET
        shiire_id = excluded.shiire_id, status = excluded.status, brand = excluded.brand,
        size = excluded.size, color = excluded.color, state = excluded.state,
        extra_json = excluded.extra_json, updated_at = excluded.updated_at
    `).bind(
      payload.kanri,
      payload.shiireId,
      payload.status,
      payload.brand,
      payload.size,
      payload.color,
      payload.state,
      JSON.stringify(extra),
      gasRes.row || 0,
      Date.now(),
    ).run();
  } catch (err) {
    console.warn('[create] products d1 insert failed', err.message);
  }

  return jsonOk({ created: true, kanri: payload.kanri });
}

async function callGas(env, action, payload, user) {
  const body = JSON.stringify({
    action,
    secret: env.SYNC_SECRET,
    email: user.email,
    payload,
  });
  // 計測: POST往復(post)・302→GET転送(hop)・テキスト取得(read)を分離
  const __T = { post: 0, hop: 0, read: 0 };
  let res;
  const __t0 = Date.now();
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, body, __T);
  } catch (err) {
    return { ok: false, error: 'gas fetch[' + action + ']: ' + err.message, _t: { call: Date.now() - __t0, ...__T } };
  }
  if (!res.ok) return { ok: false, error: 'gas http ' + res.status + '[' + action + ']', _t: { call: Date.now() - __t0, ...__T } };
  // GAS が HTML を返すことがある（デプロイ切替中・タイムアウト等）。
  // どの action で起きたかを必ず error に残す。
  let text = '';
  const __tr = Date.now();
  try { text = await res.text(); } catch { return { ok: false, error: 'gas read fail[' + action + ']' }; }
  __T.read = Date.now() - __tr;
  __T.call = Date.now() - __t0;
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return { ok: false, error: 'gas non-json[' + action + ']: ' + hint, _t: __T };
  }
  // GAS の _t と Worker 計測をマージ
  parsed._t = Object.assign({}, parsed._t || {}, __T);
  return parsed;
}

// _t を Server-Timing ヘッダ文字列に変換 (DevTools Network → Timing で可視化)
function buildServerTiming(t) {
  if (!t || typeof t !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(t)) {
    const v = Number(t[k]);
    if (!Number.isFinite(v)) continue;
    parts.push(`${k};dur=${v}`);
  }
  return parts.join(', ');
}
export { buildServerTiming };

// GAS Web App の POST フロー: POST /exec → 302 (script.googleusercontent.com/macros/echo?user_content_key=...) → GET でレスポンス取得
async function postFollowingRedirects(url, body, T) {
  const __tp = Date.now();
  const first = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });
  if (T) T.post = Date.now() - __tp;
  if (first.status < 300 || first.status >= 400) return first;
  let loc = first.headers.get('location');
  const __th = Date.now();
  for (let hop = 0; hop < 5; hop++) {
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    const next = await fetch(loc, { method: 'GET', redirect: 'manual' });
    if (next.status < 300 || next.status >= 400) {
      if (T) T.hop = Date.now() - __th;
      return next;
    }
    loc = next.headers.get('location');
  }
  throw new Error('too many redirects');
}
