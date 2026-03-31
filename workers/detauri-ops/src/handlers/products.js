/**
 * 商品API（採寸保存・情報保存・出品）
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * 商品一覧（バッチID or ステータスでフィルタ）
 */
export async function listProducts(request, env, session) {
  const body = await request.json();
  const { batchId, status, assignedToMe } = body;

  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (batchId) { sql += ' AND batch_id = ?'; params.push(batchId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (assignedToMe) { sql += ' AND (assigned_to = ? OR location = ?)'; params.push(session.userId, session.displayName); }

  sql += ' ORDER BY managed_id ASC LIMIT 500';

  const stmt = env.DB.prepare(sql);
  const rows = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // 各商品の写真URLをKVから取得
  const products = await Promise.all(rows.results.map(async (p) => {
    const kvKey = `product-photos:${p.managed_id}`;
    const urlsJson = await env.CACHE.get(kvKey);
    p.photoUrls = urlsJson ? JSON.parse(urlsJson) : [];
    return p;
  }));

  return jsonOk({ products });
}

/**
 * 商品詳細取得
 */
export async function getProduct(request, env, session) {
  const { managedId } = await request.json();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const product = await env.DB.prepare('SELECT * FROM products WHERE managed_id = ?').bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  const kvKey = `product-photos:${product.managed_id}`;
  const urlsJson = await env.CACHE.get(kvKey);
  product.photoUrls = urlsJson ? JSON.parse(urlsJson) : [];

  return jsonOk({ product });
}

/**
 * 採寸保存
 */
export async function saveMeasurements(request, env, session) {
  const body = await request.json();
  const { managedId, measureType, measurements } = body;

  if (!managedId) return jsonError('管理番号が必要です。', 400);
  if (!measureType) return jsonError('採寸タイプが必要です。', 400);

  const product = await env.DB.prepare('SELECT id FROM products WHERE managed_id = ?').bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  const m = measurements || {};
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE products SET
      measure_type = ?,
      m_length = ?, m_shoulder = ?, m_chest = ?, m_sleeve = ?,
      m_span = ?, m_total_length = ?, m_waist = ?, m_rise = ?,
      m_inseam = ?, m_thigh = ?, m_hem = ?, m_hip = ?,
      m2_total_length = ?, m2_waist = ?, m2_rise = ?, m2_inseam = ?,
      m2_thigh = ?, m2_hem = ?, m2_hip = ?,
      has_measurements = 1,
      measured_at = ?,
      measured_by = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    measureType,
    m.length || null, m.shoulder || null, m.chest || null, m.sleeve || null,
    m.span || null, m.totalLength || null, m.waist || null, m.rise || null,
    m.inseam || null, m.thigh || null, m.hem || null, m.hip || null,
    m.totalLength2 || null, m.waist2 || null, m.rise2 || null, m.inseam2 || null,
    m.thigh2 || null, m.hem2 || null, m.hip2 || null,
    now, session.displayName, now, product.id
  ).run();

  return jsonOk({ managedId, saved: true });
}

/**
 * 商品情報保存（AI判定結果の確認・修正）
 */
export async function saveInfo(request, env, session) {
  const body = await request.json();
  const { managedId, info } = body;

  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const product = await env.DB.prepare('SELECT id FROM products WHERE managed_id = ?').bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE products SET
      brand = ?, condition_state = ?, mercari_size = ?, tag_size = ?,
      gender = ?, shipping_method = ?, category1 = ?, category2 = ?, category3 = ?,
      design_feature = ?, color = ?, pocket = ?, defect_detail = ?,
      has_info = 1,
      updated_at = ?
    WHERE id = ?
  `).bind(
    info.brand || null, info.conditionState || null, info.mercariSize || null, info.tagSize || null,
    info.gender || null, info.shippingMethod || null, info.category1 || null, info.category2 || null, info.category3 || null,
    info.designFeature || null, info.color || null, info.pocket || null, info.defectDetail || null,
    now, product.id
  ).run();

  return jsonOk({ managedId, saved: true });
}

/**
 * AI判定結果保存（バックグラウンド処理後）
 */
export async function saveAiResult(request, env, session) {
  const { managedId, step, result, confidence } = await request.json();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const product = await env.DB.prepare('SELECT id FROM products WHERE managed_id = ?').bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  const field = step === 1 ? 'ai_step1_result' : 'ai_step2_result';
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE products SET ${field} = ?, ai_confidence = ?, updated_at = ? WHERE id = ?
  `).bind(JSON.stringify(result), confidence || null, now, product.id).run();

  return jsonOk({ managedId, step, saved: true });
}

/**
 * 出品（スプレッドシートに書き込み指示）
 */
export async function registerProduct(request, env, session) {
  const { managedId } = await request.json();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const product = await env.DB.prepare('SELECT * FROM products WHERE managed_id = ?').bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  // 必須チェック
  if (!product.has_photos) return jsonError('写真が登録されていません。（最低4枚必要）', 400);
  if (!product.has_measurements) return jsonError('採寸が入力されていません。', 400);
  if (!product.condition_state) return jsonError('状態を選択してください。', 400);

  // バッチ情報取得
  const batch = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(product.batch_id).first();

  // 写真URL取得
  const kvKey = `product-photos:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  const photoUrls = urlsJson ? JSON.parse(urlsJson) : [];

  // ステータス更新
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE products SET status = 'ready', updated_at = ? WHERE id = ?
  `).bind(now, product.id).run();

  // TODO: GAS連携（Step 7で実装）
  // ここでスプレッドシートに書き込むAPIを呼ぶ
  // 成功したら status = 'synced' に更新

  return jsonOk({
    managedId,
    registered: true,
    message: 'デタウリに出品する準備ができました。',
    product: { ...product, photoUrls },
    batch,
  });
}

/**
 * ダッシュボード用統計
 */
export async function getStats(request, env, session) {
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'draft' AND has_photos = 0 AND has_measurements = 0 THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN has_photos = 1 THEN 1 ELSE 0 END) as photographed,
      SUM(CASE WHEN has_measurements = 1 THEN 1 ELSE 0 END) as measured,
      SUM(CASE WHEN has_photos = 1 AND has_measurements = 1 AND status = 'draft' THEN 1 ELSE 0 END) as ready_to_confirm,
      SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as listed,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold
    FROM products
    WHERE assigned_to = ? OR location = ? OR ? = 'admin'
  `).bind(session.userId, session.displayName, session.role).first();

  return jsonOk({ stats });
}

/**
 * 自分の在庫一覧（移動報告用）
 */
export async function myInventory(request, env, session) {
  const rows = await env.DB.prepare(`
    SELECT managed_id, brand, category2, mercari_size, color
    FROM products
    WHERE location = ? AND status IN ('draft', 'ready', 'synced')
    ORDER BY managed_id ASC
  `).bind(session.displayName).all();

  return jsonOk({ products: rows.results });
}
