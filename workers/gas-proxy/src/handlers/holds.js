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
    // カートが空 → 自分の確保を全解放
    if (userKey) {
      await env.DB.prepare(
        'DELETE FROM holds WHERE user_key = ?'
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
      failed.push({ id: managedId, reason: '依頼中' });
      digest[managedId] = { status: '依頼中', heldByOther: false, untilMs: 0 };
      continue;
    }

    // 他ユーザーの有効な確保チェック
    const otherHold = await env.DB.prepare(
      'SELECT user_key, until_ms FROM holds WHERE managed_id = ? AND user_key != ? AND until_ms > ?'
    ).bind(managedId, userKey, now).first();

    if (otherHold) {
      failed.push({ id: managedId, reason: '確保中' });
      digest[managedId] = { status: '確保中', heldByOther: true, untilMs: 0 };
      continue;
    }

    // 自分の確保をUPSERT
    // pending_payment=0 にリセット: syncHoldsが呼ばれる＝ユーザーが商品ページを閲覧中
    // （KOMOJU決済ページではsyncHoldsは呼ばれない）
    // 決済放棄後にpending_paymentが残り続けるバグを防止
    stmts.push(
      env.DB.prepare(`
        INSERT INTO holds (managed_id, user_key, hold_id, until_ms, pending_payment, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT (managed_id, user_key) DO UPDATE SET
          hold_id = excluded.hold_id,
          until_ms = CASE WHEN holds.pending_payment = 1 THEN holds.until_ms ELSE excluded.until_ms END,
          pending_payment = holds.pending_payment,
          created_at = excluded.created_at
      `).bind(managedId, userKey, holdId, untilMs, new Date().toISOString())
    );

    digest[managedId] = { status: '確保中', heldByOther: false, untilMs };
  }

  // 自分の確保のうち、今回のリストに含まれないものを解放
  // pending_paymentの有無に関わらず削除（カートから外した＝不要な確保）
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(
        `DELETE FROM holds WHERE user_key = ? AND managed_id NOT IN (${placeholders})`
      ).bind(userKey, ...ids)
    );
  }

  // バッチ実行
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  return jsonOk({ digest, failed, holdMinutes });
}

/**
 * cancelPendingPayment — 決済キャンセル時にpending_paymentフラグを解除
 *
 * @param {Array} args - [paymentToken]
 * @returns {object} { ok, released, affected }
 */
export async function cancelPendingPayment(args, env) {
  const paymentToken = args[0] || '';
  if (!paymentToken) return jsonError('paymentToken required');

  // KOMOJU APIでステータス確認（偽cancelを防止）
  // 成功ステータス(captured/authorized)なら解放しない
  const komojuKey = env.KOMOJU_SECRET_KEY;
  if (komojuKey) {
    try {
      const resp = await fetch(
        'https://komoju.com/api/v1/sessions?external_order_num=' + encodeURIComponent(paymentToken),
        {
          headers: {
            'Authorization': 'Basic ' + btoa(komojuKey + ':'),
            'Accept': 'application/json',
          },
        }
      );
      const data = await resp.json();
      if (data.resource_data && data.resource_data.length > 0) {
        const session = data.resource_data[0];
        if (session.payment && ['captured', 'authorized'].includes(session.payment.status)) {
          return jsonOk({ released: false, reason: 'payment_already_confirmed' });
        }
      }
    } catch (e) {
      console.error('KOMOJU check failed (proceeding with cancel):', e);
    }
  }

  // pending_paymentを0にリセットし、until_msを通常確保時間（15分）に戻す
  const now = Date.now();
  const normalHoldMs = HOLD_MINUTES_DEFAULT * 60 * 1000;
  const result = await env.DB.prepare(`
    UPDATE holds
    SET pending_payment = 0, receipt_no = '', until_ms = ?
    WHERE receipt_no = ? AND pending_payment = 1
  `).bind(now + normalHoldMs, paymentToken).run();

  return jsonOk({ released: true, affected: result.changes || 0 });
}
