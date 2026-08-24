/**
 * ステータスAPI（Phase 3）
 *
 * apiGetStatusDigest — D1 holds + open_items から商品ステータス取得
 * 5秒ポーリングの負荷をGASから完全解放
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { selectInChunks } from '../utils/sql.js';
import { resolveCustomerId, isOwnHold } from '../utils/identity.js';

/**
 * apiGetStatusDigest — 商品ステータス一括取得
 *
 * @param {Array} args - [userKey, managedIds[], sessionId]
 * @returns {object} { ok, map: { managedId: { status, heldByOther, untilMs } } }
 */
export async function getStatusDigest(args, env) {
  const userKey = args[0] || '';
  const ids = args[1] || [];
  const sessionId = args[2] || '';

  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonOk({ map: {} });
  }

  // ログイン中なら会員IDでも「自分の確保」と判定する（別端末対応）
  const customerId = await resolveCustomerId(env, sessionId);

  // D1からholds取得（期限内のみ）
  // ids はD1のSQL変数上限（100）を超えうるため分割実行する
  const now = Date.now();
  const holdRows = await selectInChunks(ids, (ph, chunk) =>
    env.DB.prepare(`
      SELECT managed_id, user_key, customer_id, until_ms, hold_id
      FROM holds
      WHERE managed_id IN (${ph})
        AND until_ms > ?
    `).bind(...chunk, now));

  // open_items取得
  const openRows = await selectInChunks(ids, (ph, chunk) =>
    env.DB.prepare(`
      SELECT managed_id FROM open_items
      WHERE managed_id IN (${ph})
    `).bind(...chunk));

  // holdsマップ構築（自分のholdを優先）
  const holdMap = {};
  for (const h of holdRows) {
    const existing = holdMap[h.managed_id];
    // 自分のholdがあれば常に優先（他ユーザーのholdで上書きしない）
    if (!existing || isOwnHold(h, userKey, customerId)) {
      holdMap[h.managed_id] = {
        userKey: h.user_key,
        customerId: h.customer_id || '',
        untilMs: h.until_ms,
        holdId: h.hold_id,
      };
    }
  }

  // openSetマップ構築
  const openSet = new Set();
  for (const o of openRows) {
    openSet.add(o.managed_id);
  }

  // ダイジェスト構築
  const map = {};
  for (const id of ids) {
    if (openSet.has(id)) {
      map[id] = { status: '依頼中', heldByOther: false, untilMs: 0 };
    } else if (holdMap[id]) {
      const hold = holdMap[id];
      const isMyHold = isOwnHold(hold, userKey, customerId);
      map[id] = {
        status: '確保中',
        heldByOther: !isMyHold,
        untilMs: isMyHold ? hold.untilMs : 0,
      };
    } else {
      map[id] = { status: '在庫あり', heldByOther: false, untilMs: 0 };
    }
  }

  return jsonOk({ map });
}
