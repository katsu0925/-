/**
 * 仕入れバッチAPI
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateRandomHex } from '../utils/crypto.js';
import { CATEGORY_CODES } from '../config.js';

/**
 * バッチ一覧（スタッフ: 自分宛のみ、管理者: 全件）
 */
export async function listBatches(request, env, session) {
  let rows;
  if (session.role === 'admin') {
    rows = await env.DB.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM products WHERE batch_id = b.id) as product_count,
        (SELECT COUNT(*) FROM products WHERE batch_id = b.id AND status = 'synced') as synced_count
      FROM batches b ORDER BY b.created_at DESC LIMIT 50
    `).all();
  } else {
    rows = await env.DB.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM products WHERE batch_id = b.id) as product_count,
        (SELECT COUNT(*) FROM products WHERE batch_id = b.id AND status = 'synced') as synced_count
      FROM batches b
      WHERE b.delivery_user_id = ? OR b.delivery_to = ?
      ORDER BY b.created_at DESC LIMIT 50
    `).bind(session.userId, session.displayName).all();
  }
  return jsonOk({ batches: rows.results });
}

/**
 * バッチ作成（管理者のみ）
 */
export async function createBatch(request, env, session) {
  if (session.role !== 'admin') return jsonError('管理者のみ実行できます。', 403);

  const body = await request.json();
  const { purchaseDate, categoryCode, productAmount, shippingCost, deliveryTo, deliveryUserId, note } = body;

  if (!purchaseDate) return jsonError('仕入れ日は必須です。', 400);
  if (!categoryCode || !CATEGORY_CODES.includes(categoryCode)) return jsonError('区分コードが不正です。', 400);
  if (productAmount == null || productAmount < 0) return jsonError('商品金額は必須です。', 400);
  if (!deliveryTo) return jsonError('納品先は必須です。', 400);

  const id = generateRandomHex(8);
  await env.DB.prepare(`
    INSERT INTO batches (id, purchase_date, category_code, product_amount, shipping_cost, delivery_to, delivery_user_id, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, purchaseDate, categoryCode, productAmount, shippingCost || 0, deliveryTo, deliveryUserId || null, note || '', session.userId).run();

  return jsonOk({ batchId: id });
}

/**
 * 点数入力（外注が開封後に実行）→ 管理番号自動採番
 */
export async function countBatch(request, env, session) {
  const { batchId, itemCount } = await request.json();

  if (!batchId) return jsonError('バッチIDが必要です。', 400);
  if (!itemCount || itemCount < 1 || itemCount > 500) return jsonError('点数は1〜500の範囲で入力してください。', 400);

  // バッチ取得
  const batch = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(batchId).first();
  if (!batch) return jsonError('バッチが見つかりません。', 404);
  if (batch.status !== 'pending') return jsonError('このバッチは既に点数入力済みです。', 400);

  const categoryCode = batch.category_code;
  const unitCost = Math.round((batch.product_amount + batch.shipping_cost) / itemCount);

  // カウンター取得・更新（採番）
  const counter = await env.DB.prepare(
    'SELECT next_number FROM counters WHERE category_code = ?'
  ).bind(categoryCode).first();

  const startNum = counter ? counter.next_number : 1;
  const endNum = startNum + itemCount;

  // カウンター更新（UPSERT）
  await env.DB.prepare(`
    INSERT INTO counters (category_code, next_number) VALUES (?, ?)
    ON CONFLICT(category_code) DO UPDATE SET next_number = ?
  `).bind(categoryCode, endNum, endNum).run();

  // 商品レコードを一括作成
  const now = new Date().toISOString();
  const products = [];
  const stmts = [];

  for (let i = 0; i < itemCount; i++) {
    const num = startNum + i;
    const managedId = `d${categoryCode}${String(num).padStart(4, '0')}`;
    const productId = generateRandomHex(8);

    products.push({ id: productId, managedId });
    stmts.push(
      env.DB.prepare(`
        INSERT INTO products (id, batch_id, managed_id, assigned_to, location, category_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(productId, batchId, managedId, batch.delivery_user_id || null, batch.delivery_to, categoryCode, now)
    );
  }

  // バッチ更新
  stmts.push(
    env.DB.prepare(`
      UPDATE batches SET item_count = ?, unit_cost = ?, status = 'numbered', counted_by = ?, synced_at = NULL
      WHERE id = ?
    `).bind(itemCount, unitCost, session.userId, batchId)
  );

  // 一括実行
  await env.DB.batch(stmts);

  return jsonOk({
    batchId,
    itemCount,
    unitCost,
    startNumber: `d${categoryCode}${String(startNum).padStart(4, '0')}`,
    endNumber: `d${categoryCode}${String(endNum - 1).padStart(4, '0')}`,
    products,
  });
}
