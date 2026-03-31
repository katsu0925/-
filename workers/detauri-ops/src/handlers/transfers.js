/**
 * 移動報告API
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateRandomHex } from '../utils/crypto.js';

/**
 * 箱ID自動生成（BOX-YYMMDD-XXX）
 */
function generateBoxId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = generateRandomHex(3).toUpperCase();
  return `BOX-${yy}${mm}${dd}-${suffix}`;
}

/**
 * 移動報告を作成
 */
export async function createTransfer(request, env, session) {
  const { managedIds } = await request.json();

  if (!Array.isArray(managedIds) || managedIds.length === 0) {
    return jsonError('移動する商品を選択してください。', 400);
  }

  // 固定移動先を取得
  const settings = await env.DB.prepare(
    'SELECT default_destination FROM user_settings WHERE user_id = ?'
  ).bind(session.userId).first();

  if (!settings || !settings.default_destination) {
    return jsonError('移動先が設定されていません。管理者に連絡してください。', 400);
  }

  const destination = settings.default_destination;
  const boxId = generateBoxId();
  const transferId = boxId; // 箱IDをそのまま移動IDとして使用
  const now = new Date().toISOString();

  // 商品が全て自分の在庫にあるか確認
  const placeholders = managedIds.map(() => '?').join(',');
  const products = await env.DB.prepare(
    `SELECT managed_id, location FROM products WHERE managed_id IN (${placeholders})`
  ).bind(...managedIds).all();

  if (products.results.length !== managedIds.length) {
    return jsonError('一部の商品が見つかりません。', 400);
  }

  const notMine = products.results.filter(p => p.location !== session.displayName);
  if (notMine.length > 0) {
    return jsonError(`${notMine[0].managed_id} は自分の在庫にありません。`, 400);
  }

  // 移動報告レコード作成
  await env.DB.prepare(`
    INSERT INTO transfers (id, reporter_id, reporter_name, destination, managed_ids, item_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(transferId, session.userId, session.displayName, destination, managedIds.join('、'), managedIds.length, now).run();

  // 商品の所在地を一括更新
  const stmts = managedIds.map(mid =>
    env.DB.prepare('UPDATE products SET location = ?, updated_at = ? WHERE managed_id = ?')
      .bind(destination, now, mid)
  );
  await env.DB.batch(stmts);

  return jsonOk({
    transferId,
    boxId,
    destination,
    itemCount: managedIds.length,
    managedIds,
  });
}

/**
 * 移動履歴一覧
 */
export async function listTransfers(request, env, session) {
  let rows;
  if (session.role === 'admin') {
    rows = await env.DB.prepare(
      'SELECT * FROM transfers ORDER BY created_at DESC LIMIT 50'
    ).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT * FROM transfers WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(session.userId).all();
  }

  return jsonOk({ transfers: rows.results });
}

/**
 * 移動報告を処理済みにする（管理者のみ）
 */
export async function processTransfer(request, env, session) {
  if (session.role !== 'admin') return jsonError('管理者のみ実行できます。', 403);

  const { transferId } = await request.json();
  if (!transferId) return jsonError('移動IDが必要です。', 400);

  await env.DB.prepare(
    'UPDATE transfers SET processed = 1 WHERE id = ?'
  ).bind(transferId).run();

  return jsonOk({ transferId, processed: true });
}
