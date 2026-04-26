import { jsonOk, jsonError } from '../utils/response.js';

// 日付フィールドが入力されているかの判定式（SQLite）
const D_SAISUN  = "(json_extract(extra_json, '$.\"採寸日\"') IS NOT NULL AND json_extract(extra_json, '$.\"採寸日\"') <> '')";
const D_SATSUEI = "(json_extract(extra_json, '$.\"撮影日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"撮影日付\"') <> '')";
const D_SHUPPIN = "(json_extract(extra_json, '$.\"出品日\"') IS NOT NULL AND json_extract(extra_json, '$.\"出品日\"') <> '')";
const D_HASSOU  = "(json_extract(extra_json, '$.\"発送日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"発送日付\"') <> '')";
const D_KANRYOU = "(json_extract(extra_json, '$.\"完了日\"') IS NOT NULL AND json_extract(extra_json, '$.\"完了日\"') <> '')";
const D_HANBAI  = "(sale_date IS NOT NULL AND sale_date <> '')";
const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";

// 派生ステータス: 日付・アカウントの入力状況から自動算出
// 手動ステータス（キャンセル/返品/廃棄）は保持
const DERIVED_STATUS = `
  CASE
    WHEN status LIKE '%キャンセル%' OR status LIKE '%廃棄%' OR status LIKE '%返品%' THEN status
    WHEN ${D_KANRYOU} THEN '売却済み'
    WHEN ${D_HASSOU}  THEN '発送済み'
    WHEN ${D_HANBAI}  THEN '発送待ち'
    WHEN ${D_SHUPPIN} THEN '出品中'
    WHEN ${D_SATSUEI} AND ${D_SAISUN} AND ${ACCOUNT_SELECTED} THEN '出品作業中'
    WHEN ${D_SATSUEI} AND ${D_SAISUN} THEN '出品待ち'
    WHEN ${D_SATSUEI} THEN '採寸待ち'
    WHEN ${D_SAISUN}  THEN '撮影待ち'
    ELSE COALESCE(NULLIF(status,''), '採寸待ち')
  END
`;

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

  // フィルタプリセット（派生ステータス基準）
  const ds = `(${DERIVED_STATUS})`;
  if (filter === 'sokutei_machi') {
    where.push(`${ds} = '採寸待ち'`);
  } else if (filter === 'satsuei_machi') {
    where.push(`${ds} = '撮影待ち'`);
  } else if (filter === 'shuppin_machi') {
    where.push(`${ds} = '出品待ち'`);
  } else if (filter === 'shuppin_sagyou') {
    where.push(`${ds} = '出品作業中'`);
  } else if (filter === 'shuppinchu') {
    where.push(`${ds} = '出品中'`);
  } else if (filter === 'hassou') {
    // 発送商品タブ: 出品中＋発送待ち
    where.push(`${ds} IN ('出品中','発送待ち')`);
  } else if (filter === 'sold') {
    where.push(`${ds} IN ('発送待ち','発送済み','売却済み')`);
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
           extra_json, row_num, updated_at,
           ${DERIVED_STATUS} AS derived_status
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
  const ds = `(${DERIVED_STATUS})`;
  const buckets = {
    sokutei_machi:  `${ds} = '採寸待ち'`,
    satsuei_machi:  `${ds} = '撮影待ち'`,
    shuppin_machi:  `${ds} = '出品待ち'`,
    shuppin_sagyou: `${ds} = '出品作業中'`,
    shuppinchu:     `${ds} = '出品中'`,
    hassou:         `${ds} IN ('出品中','発送待ち')`,
    sold:           `${ds} IN ('発送待ち','発送済み','売却済み')`,
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

// GET /api/kanri/next?category=C
// 区分コードを受け取り、その区分での次の連番（max+1）を返す。
// 例: category=C のとき、zC で始まる kanri の最大番号 +1 を返す。
export async function getNextKanri(request, env) {
  const u = new URL(request.url);
  const category = (u.searchParams.get('category') || '').trim();
  if (!category) return jsonError('category required', 400);
  const prefix = 'z' + category;
  // GLOB は SUBSTR の数字部分だけを抽出するために条件を絞る
  const sql = `
    SELECT MAX(CAST(SUBSTR(kanri, ?) AS INTEGER)) AS max_n
    FROM products
    WHERE SUBSTR(kanri, 1, ?) = ?
      AND CAST(SUBSTR(kanri, ?) AS INTEGER) > 0
  `;
  try {
    const row = await env.DB.prepare(sql).bind(prefix.length + 1, prefix.length, prefix, prefix.length + 1).first();
    const maxN = Number(row && row.max_n || 0);
    return jsonOk({ category, prefix, maxN, nextKanri: prefix + (maxN + 1) });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/products/:kanri
export async function getProduct(request, env, kanri) {
  try {
    const row = await env.DB.prepare(`
      SELECT *, ${DERIVED_STATUS} AS derived_status
      FROM products WHERE kanri = ? LIMIT 1
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
    status: row.derived_status || row.status,
    rawStatus: row.status,
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
