import { jsonOk, jsonError } from '../utils/response.js';

// GET /api/products?filter=...&q=...&shiire=...&limit=...
export async function listProducts(request, env) {
  const u = new URL(request.url);
  const filter = u.searchParams.get('filter') || '';
  const q = (u.searchParams.get('q') || '').trim();
  const shiire = (u.searchParams.get('shiire') || '').trim();
  const brand = (u.searchParams.get('brand') || '').trim();
  const status = (u.searchParams.get('status') || '').trim();
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '10000', 10), 10000);

  const where = [];
  const args = [];

  // 採寸済み判定（measure_json が空でない＝1値以上ある）
  const SOKUTEI_DONE = "(measure_json IS NOT NULL AND measure_json <> '' AND measure_json <> '{}')";
  const SOKUTEI_NOT_DONE = "(measure_json IS NULL OR measure_json = '' OR measure_json = '{}')";
  // 売却判定（販売日あり OR ステータスが売却済/完了）
  const SOLD = "((sale_date IS NOT NULL AND sale_date <> '') OR status LIKE '%売却済%' OR status LIKE '%完了%')";
  const NOT_SOLD = "((sale_date IS NULL OR sale_date = '') AND status NOT LIKE '%売却済%' AND status NOT LIKE '%完了%')";

  // 出品作業中: 使用アカウントが選択されている（extra_json 内）＋未売却＋出品中以外
  const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";

  // フィルタプリセット
  if (filter === 'sokutei_machi') {
    where.push(`${SOKUTEI_NOT_DONE} AND ${NOT_SOLD}`);
  } else if (filter === 'satsuei_machi') {
    where.push(`${SOKUTEI_DONE} AND status LIKE '%撮影待ち%'`);
  } else if (filter === 'shuppin_machi') {
    where.push("status LIKE '%出品待ち%'");
  } else if (filter === 'shuppin_sagyou') {
    where.push(`${ACCOUNT_SELECTED} AND ${NOT_SOLD} AND status NOT LIKE '%出品中%'`);
  } else if (filter === 'shuppinchu') {
    where.push(`status LIKE '%出品中%' AND ${NOT_SOLD}`);
  } else if (filter === 'hassou') {
    // 発送商品タブ: 出品中＋発送待ち（未売却）
    where.push(`(status LIKE '%出品中%' OR status LIKE '%発送待ち%') AND ${NOT_SOLD}`);
  } else if (filter === 'sold') {
    where.push(SOLD);
  }

  if (status) { where.push('status = ?'); args.push(status); }
  if (shiire) { where.push('shiire_id = ?'); args.push(shiire); }
  if (brand)  { where.push('brand = ?'); args.push(brand); }

  if (q) {
    where.push("(kanri LIKE ? OR brand LIKE ? OR color LIKE ? OR shiire_id LIKE ?)");
    const pat = `%${q}%`;
    args.push(pat, pat, pat, pat);
  }

  const sql = `
    SELECT kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at
    FROM products
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY kanri DESC
    LIMIT ?
  `;
  args.push(limit);

  try {
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const items = results.map(formatProduct);
    return jsonOk({ items, count: items.length });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/products/counts → 各フィルタの件数を返す
export async function listProductCounts(request, env) {
  const SOKUTEI_DONE = "(measure_json IS NOT NULL AND measure_json <> '' AND measure_json <> '{}')";
  const SOKUTEI_NOT_DONE = "(measure_json IS NULL OR measure_json = '' OR measure_json = '{}')";
  const SOLD = "((sale_date IS NOT NULL AND sale_date <> '') OR status LIKE '%売却済%' OR status LIKE '%完了%')";
  const NOT_SOLD = "((sale_date IS NULL OR sale_date = '') AND status NOT LIKE '%売却済%' AND status NOT LIKE '%完了%')";
  const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";

  const buckets = {
    sokutei_machi:  `${SOKUTEI_NOT_DONE} AND ${NOT_SOLD}`,
    satsuei_machi:  `${SOKUTEI_DONE} AND status LIKE '%撮影待ち%'`,
    shuppin_machi:  "status LIKE '%出品待ち%'",
    shuppin_sagyou: `${ACCOUNT_SELECTED} AND ${NOT_SOLD} AND status NOT LIKE '%出品中%'`,
    shuppinchu:     `status LIKE '%出品中%' AND ${NOT_SOLD}`,
    hassou:         `(status LIKE '%出品中%' OR status LIKE '%発送待ち%') AND ${NOT_SOLD}`,
    sold:           SOLD,
  };

  // 1クエリで集約（CASE で各フィルタの SUM）
  const parts = Object.entries(buckets).map(([key, cond]) =>
    `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS ${key}`
  );
  const sql = `SELECT COUNT(*) AS total, ${parts.join(', ')} FROM products`;

  try {
    const row = await env.DB.prepare(sql).first();
    const counts = {};
    Object.keys(buckets).forEach(k => { counts[k] = Number(row[k] || 0); });
    return jsonOk({ total: Number(row.total || 0), counts });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/products/:kanri
export async function getProduct(request, env, kanri) {
  try {
    const row = await env.DB.prepare(`
      SELECT * FROM products WHERE kanri = ? LIMIT 1
    `).bind(kanri).first();
    if (!row) return jsonError('not found', 404);
    return jsonOk({ item: formatProduct(row) });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

function formatProduct(row) {
  let measure = null;
  if (row.measure_json) {
    try { measure = JSON.parse(row.measure_json); } catch { measure = null; }
  }
  let extra = null;
  if (row.extra_json) {
    try { extra = JSON.parse(row.extra_json); } catch { extra = null; }
  }
  return {
    kanri: row.kanri,
    shiireId: row.shiire_id,
    worker: row.worker,
    status: row.status,
    state: row.state,
    brand: row.brand,
    size: row.size,
    color: row.color,
    measure,
    measuredAt: row.measured_at,
    measuredBy: row.measured_by,
    saleDate: row.sale_date,
    salePlace: row.sale_place,
    salePrice: row.sale_price,
    saleShipping: row.sale_shipping,
    saleFee: row.sale_fee,
    saleTs: row.sale_ts,
    extra,
    row: row.row_num,
  };
}
