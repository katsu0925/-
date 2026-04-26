import { jsonOk, jsonError } from '../utils/response.js';

// GET /api/purchases?limit=500
export async function listPurchases(request, env) {
  const u = new URL(request.url);
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '500', 10), 2000);

  try {
    // 仕入れ＋登録進捗
    // AppSheet と揃える: 商品管理シートで「キャンセル日 / 廃棄日 / 返品日付」のいずれかが
    // 入っている商品は無効（登録枠から外す）として扱う
    const { results } = await env.DB.prepare(`
      SELECT p.shiire_id, p.date, p.amount, p.shipping, p.planned, p.place, p.cost, p.category, p.row_num,
             SUM(CASE WHEN pr.kanri IS NOT NULL
                       AND COALESCE(json_extract(pr.extra_json, '$.キャンセル日'), '') = ''
                       AND COALESCE(json_extract(pr.extra_json, '$.廃棄日'), '') = ''
                       AND COALESCE(json_extract(pr.extra_json, '$.返品日付'), '') = ''
                  THEN 1 ELSE 0 END) AS registered,
             SUM(CASE WHEN pr.kanri IS NOT NULL
                       AND pr.sale_date IS NOT NULL AND pr.sale_date <> ''
                       AND COALESCE(json_extract(pr.extra_json, '$.キャンセル日'), '') = ''
                       AND COALESCE(json_extract(pr.extra_json, '$.廃棄日'), '') = ''
                       AND COALESCE(json_extract(pr.extra_json, '$.返品日付'), '') = ''
                  THEN 1 ELSE 0 END) AS sold
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
      SELECT kanri, status, state, brand, size, color, sale_date, sale_price, row_num
      FROM products
      WHERE shiire_id = ?
      ORDER BY kanri DESC
    `).bind(shiireId).all();
    return jsonOk({
      items: results.map(r => ({
        kanri: r.kanri,
        status: r.status,
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
