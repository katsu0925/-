/**
 * カート確保API（Phase 3）
 *
 * apiSyncHolds — D1 batch() でアトミック操作
 * GASのScriptLock不要に → ロック競合エラー解消
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateRandomHex } from '../utils/crypto.js';

const HOLD_MINUTES_DEFAULT = 15;
const HOLD_MINUTES_MEMBER = 30;

/**
 * apiSyncHolds — カート確保の同期処理
 *
 * @param {Array} args - [userKey, managedIds[], sessionId]
 * @returns {object} { ok, digest, failed, holdMinutes }
 */
export async function syncHolds(args, env) {
  const userKey = args[0] || '';
  const ids = args[1] || [];
  const sessionId = args[2] || '';

  if (!userKey) {
    return jsonError('userKey is required');
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    // カートが空 → 自分の確保を全解放（pending_payment以外）
    if (userKey) {
      await env.DB.prepare(
        'DELETE FROM holds WHERE user_key = ? AND pending_payment = 0'
      ).bind(userKey).run();
    }
    return jsonOk({ digest: {}, failed: [], holdMinutes: HOLD_MINUTES_DEFAULT });
  }

  // 会員判定（セッションから）
  let holdMinutes = HOLD_MINUTES_DEFAULT;
  if (sessionId) {
    const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
    if (session && session.customerId) {
      holdMinutes = HOLD_MINUTES_MEMBER;
    }
  }

  const now = Date.now();
  const untilMs = now + holdMinutes * 60 * 1000;
  const holdId = generateRandomHex(16);

  // D1 batch でアトミック操作
  const stmts = [];

  // 1. 期限切れの確保を全削除
  stmts.push(
    env.DB.prepare('DELETE FROM holds WHERE until_ms <= ?').bind(now)
  );

  // 2. 各商品の確保処理
  const digest = {};
  const failed = [];

  for (const managedId of ids) {
    // 依頼中チェック
    const openCheck = await env.DB.prepare(
      'SELECT managed_id FROM open_items WHERE managed_id = ?'
    ).bind(managedId).first();

    if (openCheck) {
      failed.push(managedId);
      digest[managedId] = { status: '依頼中', heldByOther: false, untilMs: 0 };
      continue;
    }

    // 他ユーザーの有効な確保チェック
    const otherHold = await env.DB.prepare(
      'SELECT user_key, until_ms FROM holds WHERE managed_id = ? AND user_key != ? AND until_ms > ?'
    ).bind(managedId, userKey, now).first();

    if (otherHold) {
      failed.push(managedId);
      digest[managedId] = { status: '確保中', heldByOther: true, untilMs: 0 };
      continue;
    }

    // 自分の確保をUPSERT
    stmts.push(
      env.DB.prepare(`
        INSERT INTO holds (managed_id, user_key, hold_id, until_ms, pending_payment, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT (managed_id, user_key) DO UPDATE SET
          hold_id = excluded.hold_id,
          until_ms = excluded.until_ms,
          created_at = excluded.created_at
      `).bind(managedId, userKey, holdId, untilMs, new Date().toISOString())
    );

    digest[managedId] = { status: '確保中', heldByOther: false, untilMs };
  }

  // 自分の確保のうち、今回のリストに含まれないものを解放
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(
        `DELETE FROM holds WHERE user_key = ? AND managed_id NOT IN (${placeholders}) AND pending_payment = 0`
      ).bind(userKey, ...ids)
    );
  }

  // バッチ実行
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  return jsonOk({ digest, failed, holdMinutes });
}
