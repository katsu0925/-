import { jsonOk, jsonError } from '../utils/response.js';

// 日付フィールドが入力されているかの判定式（SQLite）
const D_SAISUN  = "(json_extract(extra_json, '$.\"採寸日\"') IS NOT NULL AND json_extract(extra_json, '$.\"採寸日\"') <> '')";
const D_SATSUEI = "(json_extract(extra_json, '$.\"撮影日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"撮影日付\"') <> '')";
const D_SHUPPIN = "(json_extract(extra_json, '$.\"出品日\"') IS NOT NULL AND json_extract(extra_json, '$.\"出品日\"') <> '')";
const D_HASSOU  = "(json_extract(extra_json, '$.\"発送日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"発送日付\"') <> '')";
const D_KANRYOU = "(json_extract(extra_json, '$.\"完了日\"') IS NOT NULL AND json_extract(extra_json, '$.\"完了日\"') <> '')";
const D_HANBAI  = "(sale_date IS NOT NULL AND sale_date <> '')";
const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";

// 派生ステータス: シート上の手動ステータス（status 列）を最優先。
// 「出品作業中」だけは raw='出品待ち' の中で日付＋アカウント条件を満たす行を細分化する。
// status が空のときだけ日付ベースで自動判定する。
//
// なぜ raw を優先するのか:
//   従来は日付ベースで派生していたが、シート上で「売却済み」になっていても
//   完了日が空の行が 1300件以上存在し、それらが派生では「出品中」になって
//   AppSheet と件数が大きく食い違っていた。シートが正、派生は補完。
const DERIVED_STATUS = `
  CASE
    -- raw='出品待ち' のうち撮影日・採寸日・使用アカウントが揃った行は「出品作業中」に細分化
    WHEN status = '出品待ち' AND ${D_SATSUEI} AND ${D_SAISUN} AND ${ACCOUNT_SELECTED} THEN '出品作業中'
    -- raw='出品待ち' でも採寸/撮影が未完なら日付ベースに降格（誤付与の自己修復）
    WHEN status = '出品待ち' AND NOT (${D_SATSUEI} AND ${D_SAISUN}) THEN
      CASE
        WHEN ${D_SATSUEI} THEN '採寸待ち'
        WHEN ${D_SAISUN}  THEN '撮影待ち'
        ELSE '採寸待ち'
      END
    -- raw status が入っていればそれを尊重（AppSheet と整合）
    WHEN status IS NOT NULL AND status <> '' THEN status
    -- raw status が空のときだけ日付ベースで派生
    WHEN ${D_KANRYOU} THEN '売却済み'
    WHEN ${D_HASSOU}  THEN '発送済み'
    WHEN ${D_HANBAI}  THEN '発送待ち'
    WHEN ${D_SHUPPIN} THEN '出品中'
    WHEN ${D_SATSUEI} AND ${D_SAISUN} THEN '出品待ち'
    WHEN ${D_SATSUEI} THEN '採寸待ち'
    WHEN ${D_SAISUN}  THEN '撮影待ち'
    ELSE '採寸待ち'
  END
`;

// GET /api/products?filter=...&q=...&shiire=...&limit=...&mode=list|full
export async function listProducts(request, env) {
  const u = new URL(request.url);
  const filter = u.searchParams.get('filter') || '';
  const q = (u.searchParams.get('q') || '').trim();
  const shiire = (u.searchParams.get('shiire') || '').trim();
  const brand = (u.searchParams.get('brand') || '').trim();
  const status = (u.searchParams.get('status') || '').trim();
  const worker = (u.searchParams.get('worker') || '').trim();
  const place = (u.searchParams.get('place') || '').trim();
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '10000', 10), 10000);
  // mode=list: 一覧描画に必要な最小フィールドだけ返す（モバイルのモッサリ対策）
  // mode=full: 従来通り extra_json / measure_json まで返す（旧クライアント互換）
  const mode = (u.searchParams.get('mode') || 'full').toLowerCase();
  const slim = (mode === 'list');

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
    // 発送商品タブ（AppSheet準拠）— raw [ステータス] を直接参照する:
    //   OR(AND([ステータス]='発送待ち', ISBLANK([発送日付])), [ステータス]='発送済み')
    // 派生ステータスではなく raw status を使う理由:
    //   raw=売却済み だが完了日未入力の行があり派生では '発送待ち' に降格してしまうため。
    where.push(`((status = '発送待ち' AND NOT ${D_HASSOU}) OR status = '発送済み')`);
  } else if (filter === 'sold') {
    where.push(`${ds} IN ('発送待ち','発送済み','売却済み')`);
  }

  if (status) { where.push('status = ?'); args.push(status); }
  if (shiire) { where.push('shiire_id = ?'); args.push(shiire); }
  if (brand)  { where.push('brand = ?'); args.push(brand); }
  if (worker) { where.push('worker = ?'); args.push(worker); }
  if (place)  { where.push("json_extract(extra_json, '$.\"納品場所\"') = ?"); args.push(place); }

  if (q) {
    where.push("(kanri LIKE ? OR brand LIKE ? OR color LIKE ? OR shiire_id LIKE ?)");
    const pat = `%${q}%`;
    args.push(pat, pat, pat, pat);
  }

  // slim モードでは一覧カードに必要な extra フィールドだけ json_extract で取り出す
  // （extra_json 全体は返さない／measure_json も省略）
  const slimSelect = `
    SELECT kanri, shiire_id, worker, status, brand, size, color,
           measured_at,
           sale_date, sale_ts,
           json_extract(extra_json, '$."売却済み商品画像"') AS extra_thumb,
           json_extract(extra_json, '$."使用アカウント"')   AS extra_account,
           ${DERIVED_STATUS} AS derived_status
    FROM products
  `;
  const fullSelect = `
    SELECT kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at,
           ${DERIVED_STATUS} AS derived_status
    FROM products
  `;
  const sql = (slim ? slimSelect : fullSelect) + `
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY kanri DESC
    LIMIT ?
  `;
  args.push(limit);

  try {
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const items = slim ? results.map(formatProductSlim) : results.map(formatProduct);
    return jsonOk({ items, count: items.length });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// 一覧用の最小フォーマッタ（mode=list）— カード描画に必要なフィールドだけ
function formatProductSlim(row) {
  const extra = {};
  if (row.extra_thumb) extra['売却済み商品画像'] = String(row.extra_thumb);
  if (row.extra_account) extra['使用アカウント'] = String(row.extra_account);
  return {
    kanri: row.kanri,
    shiireId: row.shiire_id,
    worker: row.worker,
    status: row.derived_status || row.status,
    rawStatus: row.status,
    brand: row.brand,
    size: row.size,
    color: row.color,
    measuredAt: row.measured_at,
    saleDate: row.sale_date,
    saleTs: row.sale_ts,
    extra,
  };
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
    hassou:         `((status = '発送待ち' AND NOT ${D_HASSOU}) OR status = '発送済み')`,
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
      SELECT p.*, ${DERIVED_STATUS} AS derived_status,
             pu.date AS pu_date, pu.cost AS pu_cost, pu.place AS pu_place,
             pu.amount AS pu_amount, pu.shipping AS pu_shipping
      FROM products p
      LEFT JOIN purchases pu ON pu.shiire_id = p.shiire_id
      WHERE p.kanri = ? LIMIT 1
    `).bind(kanri).first();
    if (!row) return jsonError('not found', 404);
    return jsonOk({ item: formatProduct(row, true) });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

function formatProduct(row, withDerived) {
  let measure = null;
  if (row.measure_json) {
    try { measure = JSON.parse(row.measure_json); } catch { measure = null; }
  }
  let extra = null;
  if (row.extra_json) {
    try { extra = JSON.parse(row.extra_json); } catch { extra = null; }
  }
  if (withDerived) {
    extra = extra || {};
    // 仕入れ管理シート由来の連動値（読取専用）— シート側に列が無い／空の場合のみ補完
    if (!extra['仕入れ日'] && row.pu_date) extra['仕入れ日'] = String(row.pu_date);
    if (!extra['納品場所'] && row.pu_place) extra['納品場所'] = String(row.pu_place);
    if (!extra['仕入れ値'] && row.pu_cost != null && row.pu_cost !== '') {
      extra['仕入れ値'] = Number(row.pu_cost);
    }
    // 計算系: シート側の値を優先、空なら都度算出
    const cost = Number(extra['仕入れ値'] || 0);
    const salePrice = Number(row.sale_price || 0);
    const saleShipping = Number(row.sale_shipping || 0);
    const saleFee = Number(row.sale_fee || 0);
    if (!extra['粗利'] && salePrice > 0) {
      extra['粗利'] = salePrice - saleShipping - saleFee;
    }
    if (!extra['利益'] && salePrice > 0) {
      extra['利益'] = salePrice - saleShipping - saleFee - cost;
    }
    if (!extra['利益率'] && salePrice > 0) {
      const rieki = salePrice - saleShipping - saleFee - cost;
      extra['利益率'] = (rieki / salePrice * 100).toFixed(1) + '%';
    }
    // 在庫日数: 仕入れ日 → 今日（販売日があればそこまで）
    if (!extra['在庫日数']) {
      const baseDateStr = extra['仕入れ日'];
      if (baseDateStr) {
        const start = new Date(baseDateStr);
        const end = row.sale_date ? new Date(row.sale_date) : new Date();
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          const days = Math.floor((end - start) / 86400000);
          if (days >= 0) extra['在庫日数'] = days;
        }
      }
    }
    // リードタイム: 仕入れ日 → 出品日
    if (!extra['リードタイム']) {
      const startStr = extra['仕入れ日'];
      const endStr = extra['出品日'];
      if (startStr && endStr) {
        const a = new Date(startStr);
        const b = new Date(endStr);
        if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
          const days = Math.floor((b - a) / 86400000);
          if (days >= 0) extra['リードタイム'] = days;
        }
      }
    }
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
