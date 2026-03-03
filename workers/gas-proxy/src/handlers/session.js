/**
 * セッション管理API
 *
 * Phase 1: apiGetCsrfToken — KVで発行・管理（GAS不要に）
 * Phase 2: apiValidateSession — KV SESSIONS + D1 customers
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateCsrfToken } from '../utils/crypto.js';

const CSRF_TTL = 3600; // 1時間（秒）

/**
 * apiGetCsrfToken — CSRFトークン発行
 *
 * userKey（IPベースのキー）に紐づくCSRFトークンを生成し、KVに保存。
 * フロントはこのトークンを状態変更APIに添付して送信する。
 */
export async function getCsrfToken(args, env) {
  const userKey = args[0] || '';
  if (!userKey) {
    return jsonError('userKey is required');
  }

  const token = generateCsrfToken();
  const kvKey = `csrf:${userKey}`;

  // KV SESSIONSに保存（1時間有効）
  await env.SESSIONS.put(kvKey, token, { expirationTtl: CSRF_TTL });

  return jsonOk({ csrfToken: token });
}

/**
 * CSRFトークン検証
 * @returns {boolean}
 */
export async function verifyCsrfToken(userKey, token, env) {
  if (!userKey || !token) return false;

  const kvKey = `csrf:${userKey}`;
  const stored = await env.SESSIONS.get(kvKey);

  if (!stored) return false;

  // タイミングセーフ比較
  if (stored.length !== token.length) return false;
  const enc = new TextEncoder();
  const a = enc.encode(stored);
  const b = enc.encode(token);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * apiValidateSession — セッション検証（Phase 2で実装）
 * Phase 1ではGASプロキシにフォールバック
 */
export async function validateSession(args, env) {
  const sessionId = args[1]?.sessionId || args[0]?.sessionId || '';
  if (!sessionId) {
    return jsonOk({ valid: false });
  }

  // KV SESSIONSからセッション検索
  const kvKey = `session:${sessionId}`;
  const sessionData = await env.SESSIONS.get(kvKey, 'json');

  if (!sessionData) {
    return jsonOk({ valid: false });
  }

  // 有効期限チェック
  if (sessionData.expiresAt && new Date(sessionData.expiresAt) <= new Date()) {
    await env.SESSIONS.delete(kvKey);
    return jsonOk({ valid: false });
  }

  // D1から顧客情報取得
  const customer = await env.DB.prepare(`
    SELECT id, email, company_name, phone, postal, address,
           newsletter, points, purchase_count
    FROM customers WHERE id = ?
  `).bind(sessionData.customerId).first();

  if (!customer) {
    return jsonOk({ valid: false });
  }

  // isOwner判定
  const ownerEmail = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('ADMIN_OWNER_EMAIL').first();

  const isOwner = ownerEmail && customer.email === ownerEmail.value;

  // firstHalfPrice判定
  const fhpStatus = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('FIRST_HALF_PRICE_STATUS').first();

  let firstHalfPrice = null;
  if (fhpStatus) {
    try {
      const fhp = JSON.parse(fhpStatus.value);
      if (fhp.enabled && customer.purchase_count === 0) {
        firstHalfPrice = fhp;
      }
    } catch (e) { /* ignore */ }
  }

  return jsonOk({
    valid: true,
    customer: {
      id: customer.id,
      email: customer.email,
      companyName: customer.company_name,
      phone: customer.phone,
      postal: customer.postal,
      address: customer.address,
      newsletter: customer.newsletter === 1,
      points: customer.points,
      purchaseCount: customer.purchase_count,
    },
    isOwner: isOwner || false,
    firstHalfPrice,
  });
}
