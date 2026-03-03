/**
 * マイページAPI（Phase 4）
 *
 * apiGetMyPage — D1 customers + 注文データ
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * apiGetMyPage — マイページ情報取得
 *
 * @param {Array} args - [userKey, { sessionId }]
 */
export async function getMyPage(args, env) {
  const params = args[1] || args[0] || {};
  const { sessionId } = params;

  if (!sessionId) {
    return jsonError('セッションIDが必要です。');
  }

  // セッション検証
  const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!session) {
    return jsonError('セッションが無効です。ログインし直してください。');
  }

  if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
    await env.SESSIONS.delete(`session:${sessionId}`);
    return jsonError('セッションが期限切れです。ログインし直してください。');
  }

  // D1から顧客情報取得
  const customer = await env.DB.prepare(`
    SELECT id, email, company_name, phone, postal, address,
           newsletter, points, points_updated_at, purchase_count, created_at
    FROM customers WHERE id = ?
  `).bind(session.customerId).first();

  if (!customer) {
    return jsonError('顧客情報が見つかりません。');
  }

  return jsonOk({
    customer: {
      id: customer.id,
      email: customer.email,
      companyName: customer.company_name,
      phone: customer.phone,
      postal: customer.postal,
      address: customer.address,
      newsletter: customer.newsletter === 1,
      points: customer.points,
      pointsUpdatedAt: customer.points_updated_at,
      purchaseCount: customer.purchase_count,
      createdAt: customer.created_at,
    },
  });
}
