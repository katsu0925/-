/**
 * ステータスAPI（Phase 3）
 *
 * apiGetStatusDigest — D1 holds + open_items から商品ステータス取得
 * 5秒ポーリングの負荷をGASから完全解放
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * apiGetStatusDigest — 商品ステータス一括取得
 *
 * @param {Array} args - [userKey, managedIds[]]
 * @returns {object} { ok, map: { managedId: { status, heldByOther, untilMs } } }
 */
export async function getStatusDigest(args, env) {
  const userKey = args[0] || '';
  const ids = args[1] || [];

  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonOk({ map: {} });
  }

  // D1からholds取得（期限内のみ）
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');

  const holdsQuery = `
    SELECT managed_id, user_key, until_ms, hold_id
    FROM holds
    WHERE managed_id IN (${placeholders})
      AND until_ms > ?
  `;
  const holdsResult = await env.DB.prepare(holdsQuery)
    .bind(...ids, now)
    .all();

  // open_items取得
  const openQuery = `
    SELECT managed_id FROM open_items
    WHERE managed_id IN (${placeholders})
  `;
  const openResult = await env.DB.prepare(openQuery)
    .bind(...ids)
    .all();

  // holdsマップ構築
  const holdMap = {};
  for (const h of holdsResult.results) {
    holdMap[h.managed_id] = {
      userKey: h.user_key,
      untilMs: h.until_ms,
      holdId: h.hold_id,
    };
  }

  // openSetマップ構築
  const openSet = new Set();
  for (const o of openResult.results) {
    openSet.add(o.managed_id);
  }

  // ダイジェスト構築
  const map = {};
  for (const id of ids) {
    if (openSet.has(id)) {
      map[id] = { status: '依頼中', heldByOther: false, untilMs: 0 };
    } else if (holdMap[id]) {
      const hold = holdMap[id];
      const isMyHold = hold.userKey === userKey;
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
