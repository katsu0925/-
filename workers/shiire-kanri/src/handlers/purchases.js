import { jsonOk, jsonError } from '../utils/response.js';

// 商品の派生ステータス（products.js と同一ロジックを使用）
const D_SAISUN  = "(json_extract(extra_json, '$.\"採寸日\"') IS NOT NULL AND json_extract(extra_json, '$.\"採寸日\"') <> '')";
const D_SATSUEI = "(json_extract(extra_json, '$.\"撮影日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"撮影日付\"') <> '')";
const D_SHUPPIN = "(json_extract(extra_json, '$.\"出品日\"') IS NOT NULL AND json_extract(extra_json, '$.\"出品日\"') <> '')";
const D_HASSOU  = "(json_extract(extra_json, '$.\"発送日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"発送日付\"') <> '')";
const D_KANRYOU = "(json_extract(extra_json, '$.\"完了日\"') IS NOT NULL AND json_extract(extra_json, '$.\"完了日\"') <> '')";
const D_HANBAI  = "(sale_date IS NOT NULL AND sale_date <> '')";
const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";
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

// GET /api/purchases?limit=500
export async function listPurchases(request, env) {
  const u = new URL(request.url);
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '500', 10), 2000);

  try {
    // 仕入れ＋登録進捗（商品管理シートに行が存在すれば登録済み扱い）
    const { results } = await env.DB.prepare(`
      SELECT p.shiire_id, p.date, p.amount, p.shipping, p.planned, p.place, p.cost, p.category,
             p.content, p.supplier_id, p.register_user, p.registered_at, p.assigned_kanri, p.processed,
             p.row_num,
             COUNT(pr.kanri) AS registered,
             SUM(CASE WHEN pr.sale_date IS NOT NULL AND pr.sale_date <> '' THEN 1 ELSE 0 END) AS sold
      FROM purchases p
      LEFT JOIN products pr ON pr.shiire_id = p.shiire_id
      GROUP BY p.shiire_id
      ORDER BY p.date DESC
      LIMIT ?
    `).bind(limit).all();

    return jsonOk({
      items: results.map(r => ({
        shiireId: r.shiire_id,
        date: r.date,
        amount: r.amount,
        shipping: r.shipping,
        planned: r.planned,
        place: r.place,
        cost: r.cost,
        category: r.category || '',
        content: r.content || '',
        supplierId: r.supplier_id || '',
        registerUser: r.register_user || '',
        registeredAt: r.registered_at || '',
        assignedKanri: r.assigned_kanri || '',
        processed: !!r.processed,
        registered: r.registered || 0,
        sold: r.sold || 0,
        row: r.row_num,
      })),
      count: results.length,
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/purchases/:id/products — 仕入れに紐づく商品
export async function getPurchaseProducts(request, env, shiireId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT kanri, status, state, brand, size, color, sale_date, sale_price, row_num,
             ${DERIVED_STATUS} AS derived_status
      FROM products
      WHERE shiire_id = ?
      ORDER BY kanri DESC
    `).bind(shiireId).all();
    return jsonOk({
      items: results.map(r => ({
        kanri: r.kanri,
        status: r.derived_status || r.status,
        rawStatus: r.status,
        state: r.state,
        brand: r.brand,
        size: r.size,
        color: r.color,
        saleDate: r.sale_date,
        salePrice: r.sale_price,
        row: r.row_num,
      })),
      count: results.length,
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}
