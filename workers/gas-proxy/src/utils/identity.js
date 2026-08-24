/**
 * 会員同一性ヘルパー
 *
 * 確保（holds）の所有者判定は従来 user_key（端末ごとに発行されるキー）のみで行っていた。
 * そのため同じ会員が別端末で開くと自分の確保が「確保中（選択不可）」になっていた。
 * ログイン中はセッションから customer_id を解決し、同一会員なら自分の確保として扱う。
 */

/**
 * セッションID → 会員ID（未ログイン・無効セッションは空文字）
 *
 * @param {object} env
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
export async function resolveCustomerId(env, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !env.SESSIONS) return '';
  try {
    const session = await env.SESSIONS.get(`session:${sid}`, 'json');
    if (!session || !session.customerId) return '';
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) return '';
    return String(session.customerId);
  } catch (e) {
    console.error('resolveCustomerId failed:', e.message);
    return '';
  }
}

/**
 * 確保行が「自分のもの」か判定（同一端末 or 同一会員）
 *
 * @param {object} row - holds の行（user_key / customer_id）
 * @param {string} userKey
 * @param {string} customerId - 未ログインなら空文字
 * @returns {boolean}
 */
export function isOwnHold(row, userKey, customerId) {
  if (!row) return false;
  const rowUserKey = row.user_key !== undefined ? row.user_key : row.userKey;
  if (rowUserKey && rowUserKey === userKey) return true;
  if (!customerId) return false;
  const rowCustomerId = row.customer_id !== undefined ? row.customer_id : row.customerId;
  return !!(rowCustomerId && rowCustomerId === customerId);
}
