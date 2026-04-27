import { jsonOk, jsonError } from '../utils/response.js';

// POST /api/save/measurement  body: { kanri, measure: {着丈, 肩幅, ...} }
// POST /api/save/sale         body: { kanri, sale: {salePrice, saleDate, salePlace, saleShipping, saleFee} }

export async function saveMeasurement(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const measure = body.measure || {};
  if (!kanri) return jsonError('kanri required', 400);

  const gasRes = await callGas(env, 'saveMeasurement', { kanri, measure }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // 楽観的更新: D1 にも即時反映
  try {
    const measuredAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE products SET measure_json = ?, measured_at = ?, measured_by = ?, updated_at = ?
      WHERE kanri = ?
    `).bind(JSON.stringify(measure), measuredAt, user.email, Date.now(), kanri).run();
  } catch (err) {
    console.warn('[save] d1 update failed', err.message);
  }

  return jsonOk({ saved: true });
}

export async function saveSale(request, env, user) {
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

  return jsonOk({ saved: true });
}

// POST /api/save/details  body: { kanri, fields: { 'ヘッダー名': 値, ... } }
// 任意のヘッダーキーで商品管理シートを部分更新する汎用エンドポイント
export async function saveDetails(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const fields = body.fields || {};
  if (!kanri) return jsonError('kanri required', 400);
  const keys = Object.keys(fields);
  if (keys.length === 0) return jsonError('fields required', 400);

  const gasRes = await callGas(env, 'saveDetails', { kanri, fields }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // 楽観的更新: 既存の extra_json をマージして書き戻す（次の Cron で確定）
  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    let extra = {};
    if (cur && cur.extra_json) {
      try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
    }
    for (const k of keys) {
      const v = fields[k];
      extra[k] = v == null ? '' : String(v);
    }
    // 既存の専用カラムにも反映できるものは反映（フィルタ性能維持）
    const sets = ['extra_json = ?', 'updated_at = ?'];
    const args = [JSON.stringify(extra), Date.now()];
    function push(col, val) { sets.push(`${col} = ?`); args.push(val); }
    if (fields['ステータス'] !== undefined) push('status', String(fields['ステータス'] || ''));
    if (fields['状態'] !== undefined) push('state', String(fields['状態'] || ''));
    if (fields['ブランド'] !== undefined) push('brand', String(fields['ブランド'] || ''));
    if (fields['メルカリサイズ'] !== undefined) push('size', String(fields['メルカリサイズ'] || ''));
    if (fields['カラー'] !== undefined) push('color', String(fields['カラー'] || ''));
    if (fields['販売日'] !== undefined) push('sale_date', String(fields['販売日'] || ''));
    if (fields['販売場所'] !== undefined) push('sale_place', String(fields['販売場所'] || ''));
    if (fields['販売価格'] !== undefined) {
      const n = Number(fields['販売価格']);
      push('sale_price', Number.isFinite(n) ? n : null);
    }
    if (fields['送料'] !== undefined) {
      const n = Number(fields['送料']);
      push('sale_shipping', Number.isFinite(n) ? n : null);
    }
    if (fields['手数料'] !== undefined) {
      const n = Number(fields['手数料']);
      push('sale_fee', Number.isFinite(n) ? n : null);
    }
    args.push(kanri);
    await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE kanri = ?`).bind(...args).run();
  } catch (err) {
    console.warn('[save details] d1 update failed', err.message);
  }

  return jsonOk({
    saved: true,
    written: gasRes.written || 0,
    skipped: gasRes.skipped || [],
    unknown: gasRes.unknown || []
  });
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

  // 楽観的更新: extra_json に URL を反映
  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    let extra = {};
    if (cur && cur.extra_json) {
      try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
    }
    extra[field] = gasRes.url;
    await env.DB.prepare('UPDATE products SET extra_json = ?, updated_at = ? WHERE kanri = ?')
      .bind(JSON.stringify(extra), Date.now(), kanri).run();
  } catch (err) {
    console.warn('[upload image] d1 update failed', err.message);
  }

  return jsonOk({ uploaded: true, url: gasRes.url, field });
}

// POST /api/image/resolve  body: { kanri, field, path }
// AppSheet 旧形式の相対パスを Drive シェアURL に解決。KV キャッシュ 1日。
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
      if (cached) return jsonOk({ url: cached, cached: true });
    } catch (err) {
      console.warn('[resolve image] kv get failed', err.message);
    }
  }

  const gasRes = await callGas(env, 'resolveImage', { kanri, field, path }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  if (env.CACHE && gasRes.url) {
    try {
      await env.CACHE.put(cacheKey, gasRes.url, { expirationTtl: 86400 });
    } catch (err) {
      console.warn('[resolve image] kv put failed', err.message);
    }
  }

  return jsonOk({ url: gasRes.url, fileName: gasRes.fileName });
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
  let res;
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, body);
  } catch (err) {
    return { ok: false, error: 'gas fetch: ' + err.message };
  }
  if (!res.ok) return { ok: false, error: 'gas http ' + res.status };
  try { return await res.json(); } catch { return { ok: false, error: 'gas non-json' }; }
}

// GAS Web App の POST フロー: POST /exec → 302 (script.googleusercontent.com/macros/echo?user_content_key=...) → GET でレスポンス取得
async function postFollowingRedirects(url, body) {
  const first = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });
  if (first.status < 300 || first.status >= 400) return first;
  let loc = first.headers.get('location');
  for (let hop = 0; hop < 5; hop++) {
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    const next = await fetch(loc, { method: 'GET', redirect: 'manual' });
    if (next.status < 300 || next.status >= 400) return next;
    loc = next.headers.get('location');
  }
  throw new Error('too many redirects');
}
