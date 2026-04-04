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
           newsletter, points, points_updated_at, purchase_count, total_spent, created_at
    FROM customers WHERE id = ?
  `).bind(session.customerId).first();

  if (!customer) {
    return jsonError('顧客情報が見つかりません。');
  }

  // firstHalfPrice判定（memberCap: 100人目までの登録者のみ対象）
  let firstHalfPrice = { eligible: false, rate: 0.5 };
  const fhpRow = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('FIRST_HALF_PRICE_STATUS').first();
  if (fhpRow) {
    try {
      const fhp = JSON.parse(fhpRow.value);
      let eligible = !!(fhp.enabled && customer.purchase_count === 0);
      if (eligible && fhp.memberCap > 0) {
        const orderRow = await env.DB.prepare(
          'SELECT COUNT(*) AS cnt FROM customers WHERE created_at < ?'
        ).bind(customer.created_at).first();
        const registrationOrder = (orderRow && orderRow.cnt !== null) ? orderRow.cnt + 1 : fhp.memberCap + 1;
        if (registrationOrder > fhp.memberCap) eligible = false;
      }
      firstHalfPrice = { eligible, rate: fhp.rate || 0.5 };
    } catch (e) { /* ignore */ }
  }

  // ランク判定
  const totalSpent = customer.total_spent || 0;
  let rank;
  if (totalSpent >= 500000) rank = { name: 'ダイヤモンド', color: '#00bcd4', pointRate: 5, freeShipping: true };
  else if (totalSpent >= 200000) rank = { name: 'ゴールド', color: '#f59e0b', pointRate: 5, freeShipping: false };
  else if (totalSpent >= 50000) rank = { name: 'シルバー', color: '#94a3b8', pointRate: 3, freeShipping: false };
  else rank = { name: 'レギュラー', color: '#64748b', pointRate: 1, freeShipping: false };

  return jsonOk({ data: {
    profile: {
      email: customer.email,
      companyName: customer.company_name,
      phone: customer.phone,
      postal: customer.postal,
      address: customer.address,
      newsletter: customer.newsletter === 1,
      registeredAt: customer.created_at,
    },
    points: customer.points,
    pointsExpiryDate: null,
    orders: [],
    stats: { totalOrders: customer.purchase_count || 0, totalSpent, totalItems: 0 },
    firstHalfPrice,
    rank,
  }});
}

/**
 * apiGetReferralCode — 紹介コード取得
 *
 * @param {Array} args - [userKey, { sessionId }]
 */
export async function getReferralCode(args, env) {
  const params = args[1] || args[0] || {};
  const { sessionId } = params;

  if (!sessionId) {
    return jsonOk({ ok: false, message: 'ログインが必要です' });
  }

  const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!session || !session.customerId) {
    return jsonOk({ ok: false, message: 'セッションが無効です。再ログインしてください' });
  }

  const referralCode = 'REF-' + session.customerId;
  const siteUrl = (env.FRONTEND_URL || 'https://wholesale.nkonline-tool.com').replace(/\/+$/, '');
  const referralUrl = siteUrl + '?ref=' + encodeURIComponent(referralCode);

  return jsonOk({
    data: {
      referralCode,
      referralUrl,
    },
  });
}
