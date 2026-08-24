/**
 * カート確保API（Phase 3）
 *
 * apiSyncHolds — D1 batch() でアトミック操作
 * GASのScriptLock不要に → ロック競合エラー解消
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateRandomHex } from '../utils/crypto.js';
import { statementsInChunks } from '../utils/sql.js';
import { resolveCustomerId, isOwnHold } from '../utils/identity.js';

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
  // customerId は確保時間の延長だけでなく「自分の確保」判定にも使う。
  // 同じ会員が別端末で開いたとき、自分の確保が確保中（選択不可）にならないようにする。
  const customerId = await resolveCustomerId(env, sessionId);
  const holdMinutes = customerId ? HOLD_MINUTES_MEMBER : HOLD_MINUTES_DEFAULT;

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
    // 商品存在チェック（D1に無い = 売却済み等で同期時に削除済み）
    const productCheck = await env.DB.prepare(
      'SELECT managed_id FROM products WHERE managed_id = ?'
    ).bind(managedId).first();

    if (!productCheck) {
      failed.push({ id: managedId, reason: '在庫なし', heldByOther: false });
      digest[managedId] = { status: '在庫なし', heldByOther: false, untilMs: 0 };
      continue;
    }

    // 確保状況を取得（自分の確保は pending_payment / until_ms を引き継ぐため必要）
    const { results: holdRows } = await env.DB.prepare(
      'SELECT user_key, customer_id, until_ms, pending_payment, receipt_no FROM holds WHERE managed_id = ? AND until_ms > ?'
    ).bind(managedId, now).all();

    // 他人の確保 = 「同じ端末でも同じ会員でもない」確保
    const otherHold = holdRows.find(h => !isOwnHold(h, userKey, customerId));
    // 決済処理中（pending_payment）まわりは端末単位で判定する。
    // 別端末の決済処理中まで自分扱いにすると、同じ会員が同じ商品を二重注文できてしまう。
    const myHold = holdRows.find(h => h.user_key === userKey);
    const myPending = !!(myHold && myHold.pending_payment);

    // 依頼中チェック
    // 自分自身の決済処理中ロック（submitEstimate が入れた open_items）は除外する。
    // 除外しないと、KOMOJU決済ページからブラウザバックで戻ってきた本人が
    // 自分のロックで「依頼中」と判定され、カートが全消失する（2026-08-24 事故）
    const openRow = await env.DB.prepare(
      `SELECT o.receipt_no AS receipt_no,
              EXISTS (
                SELECT 1 FROM pending_orders po
                 WHERE po.payment_token = o.receipt_no
                   AND po.consumed = 0
                   AND json_extract(po.data, '$.userKey') = ?
              ) AS mine
         FROM open_items o WHERE o.managed_id = ?`
    ).bind(userKey, managedId).first();

    if (openRow) {
      const isMine = openRow.mine === 1
        || (myPending && myHold.receipt_no && myHold.receipt_no === openRow.receipt_no);

      if (!isMine && myPending) {
        // 自分が決済処理中なのに依頼中トークンが一致しない稀なケース。
        // カートからは外さず（own:true）状態だけ通知する
        failed.push({ id: managedId, reason: '決済処理中', heldByOther: false, own: true });
        digest[managedId] = {
          status: '確保中', heldByOther: false, untilMs: myHold.until_ms, pendingPayment: true,
        };
        continue;
      }

      if (!isMine) {
        // 自分の決済中は上で除外済み → ここは他人の注文で確定
        failed.push({ id: managedId, reason: '依頼中', heldByOther: true });
        digest[managedId] = { status: '依頼中', heldByOther: true, untilMs: 0 };
        continue;
      }
    }

    if (otherHold) {
      failed.push({ id: managedId, reason: '確保中', heldByOther: true });
      digest[managedId] = { status: '確保中', heldByOther: true, untilMs: 0 };
      continue;
    }

    // 自分の確保をUPSERT
    // 決済処理中（pending_payment=1）の場合はフラグと期限を維持する。
    // コンビニ/銀行振込は着金まで日をまたぐため、ここで解除すると
    // 支払い予定の商品が他人に取られてしまう
    stmts.push(
      env.DB.prepare(`
        INSERT INTO holds (managed_id, user_key, hold_id, until_ms, pending_payment, created_at, customer_id)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT (managed_id, user_key) DO UPDATE SET
          hold_id = excluded.hold_id,
          until_ms = CASE WHEN holds.pending_payment = 1 THEN holds.until_ms ELSE excluded.until_ms END,
          pending_payment = holds.pending_payment,
          created_at = excluded.created_at,
          customer_id = excluded.customer_id
      `).bind(managedId, userKey, holdId, untilMs, new Date().toISOString(), customerId)
    );

    // 決済処理中（pending_payment=1）の確保は DB 側の長い期限をそのまま返す。
    // ここで15/30分の untilMs を返すとフロントのタイマーが誤って期限切れ扱いにする
    const myUntilMs = myPending ? myHold.until_ms : untilMs;
    digest[managedId] = {
      status: '確保中',
      heldByOther: false,
      untilMs: myUntilMs,
      pendingPayment: myPending,
    };
  }

  // 自分の確保のうち、今回のリストに含まれないものを解放
  // pending_paymentの有無に関わらず削除（カートから外した＝不要な確保）
  //
  // NOT IN (?,?,...) は ids が99件を超えるとD1のSQL変数上限（100）に当たり、
  // batch全体が "too many SQL variables" で失敗する。その結果、100点以上の
  // カートでは確保が1件も作られなくなっていた（2026-08-25 修正）。
  // 解放対象をJS側で差分算出し、分割DELETEする。
  if (ids.length > 0) {
    const idSet = new Set(ids);
    const { results: myHolds } = await env.DB.prepare(
      'SELECT managed_id FROM holds WHERE user_key = ?'
    ).bind(userKey).all();
    const staleIds = (myHolds || [])
      .map((h) => h.managed_id)
      .filter((m) => !idSet.has(m));
    for (const st of statementsInChunks(staleIds, (ph, chunk) =>
      env.DB.prepare(
        `DELETE FROM holds WHERE user_key = ? AND managed_id IN (${ph})`
      ).bind(userKey, ...chunk))) {
      stmts.push(st);
    }
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
  // pending（コンビニ/銀行振込の受付済み＝支払い待ち）も解放しない。
  // 解放すると支払い予定の商品が他人に売れて二重販売になる
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
        if (session.payment && ['captured', 'authorized', 'pending'].includes(session.payment.status)) {
          return jsonOk({ released: false, reason: 'payment_already_confirmed' });
        }
      }
    } catch (e) {
      console.error('KOMOJU check failed (proceeding with cancel):', e);
    }
  }

  // pending_paymentを0にリセットし、until_msを通常確保時間（15分）に戻す
  // 同時にsubmitEstimateで追加したopen_itemsも削除（決済キャンセル＝依頼中ではない）
  const now = Date.now();
  const normalHoldMs = HOLD_MINUTES_DEFAULT * 60 * 1000;

  // まずreceipt_noに紐づくmanaged_idを取得してopen_itemsからも削除
  const { results: heldItems } = await env.DB.prepare(
    'SELECT managed_id FROM holds WHERE receipt_no = ? AND pending_payment = 1'
  ).bind(paymentToken).all();

  const stmts = [
    env.DB.prepare(`
      UPDATE holds
      SET pending_payment = 0, receipt_no = '', until_ms = ?
      WHERE receipt_no = ? AND pending_payment = 1
    `).bind(now + normalHoldMs, paymentToken),
  ];

  if (heldItems.length > 0) {
    const cancelIds = heldItems.map(h => h.managed_id);
    for (const st of statementsInChunks(cancelIds, (ph, chunk) =>
      env.DB.prepare(
        `DELETE FROM open_items WHERE managed_id IN (${ph}) AND receipt_no = ?`
      ).bind(...chunk, paymentToken))) {
      stmts.push(st);
    }
  }

  await env.DB.batch(stmts);

  return jsonOk({ released: true, affected: heldItems.length });
}
