/**
 * Stripe Billing — サブスクリプション課金
 * チームオーナーが課金 → teams.plan を更新
 *
 * 必要なSecret: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { PLAN_LIMITS } from '../config.js';

// ─── Price ID マッピング（TODO: Stripe Dashboardで作成後に差し替え） ───

// Stripe price_id → プラン名
const STRIPE_PRICE_TO_PLAN = {
  // 月額
  'price_tasukibako_lite_monthly':     'lite',
  'price_tasukibako_standard_monthly': 'standard',
  'price_tasukibako_pro_monthly':      'pro',
  // 年額
  'price_tasukibako_lite_yearly':      'lite',
  'price_tasukibako_standard_yearly':  'standard',
  'price_tasukibako_pro_yearly':       'pro',
};

// プラン名 → price_id（月額/年額）
const PLAN_TO_STRIPE_PRICE = {
  lite:     { monthly: 'price_tasukibako_lite_monthly',     yearly: 'price_tasukibako_lite_yearly' },
  standard: { monthly: 'price_tasukibako_standard_monthly', yearly: 'price_tasukibako_standard_yearly' },
  pro:      { monthly: 'price_tasukibako_pro_monthly',      yearly: 'price_tasukibako_pro_yearly' },
};

// ─── Stripe API ラッパー ───

async function stripeAPI(env, endpoint, params, method = 'POST') {
  let url = `https://api.stripe.com/v1/${endpoint}`;
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  };
  if (method === 'POST') {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params).toString();
  } else if (params && Object.keys(params).length > 0) {
    url += '?' + new URLSearchParams(params).toString();
  }
  const resp = await fetch(url, opts);
  return resp.json();
}

// ─── Webhook署名検証 ───

async function verifyWebhookSignature(body, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const item of sigHeader.split(',')) {
    const [key, value] = item.split('=');
    parts[key.trim()] = value;
  }
  const timestamp = parts['t'];
  const sig = parts['v1'];
  if (!timestamp || !sig) return false;

  // 5分以上古いイベントは拒否
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedHex = [...new Uint8Array(expected)].map(b => b.toString(16).padStart(2, '0')).join('');
  return expectedHex === sig;
}

// ─── POST /api/stripe/checkout ───

export async function checkout(request, env, session) {
  const { plan, billing = 'monthly', teamId } = await request.json();

  // プラン・price_id検証
  const prices = PLAN_TO_STRIPE_PRICE[plan];
  const priceId = prices?.[billing];
  if (!priceId) return jsonError('無効なプランです', 400);

  // チームオーナーであることを確認
  const team = await env.DB.prepare(
    'SELECT id, owner_id, plan FROM teams WHERE id = ? AND owner_id = ?'
  ).bind(teamId, session.userId).first();
  if (!team) return jsonError('チームのオーナーのみプラン変更できます', 403);

  // Stripe Customer 取得 or 作成
  const dbUser = await env.DB.prepare(
    'SELECT stripe_customer_id, email FROM users WHERE id = ?'
  ).bind(session.userId).first();
  let customerId = dbUser?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripeAPI(env, 'customers', {
      email: dbUser.email,
      'metadata[tasukibako_user_id]': session.userId,
      'metadata[team_id]': teamId,
    });
    if (customer.error) return jsonError(customer.error.message, 400);
    customerId = customer.id;
    await env.DB.prepare(
      'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
    ).bind(customerId, session.userId).run();
  }

  // Checkoutセッション作成
  const origin = new URL(request.url).origin;
  const params = {
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'subscription',
    success_url: `${origin}/app?checkout=success`,
    cancel_url: `${origin}/app?checkout=cancel`,
    'metadata[tasukibako_user_id]': session.userId,
    'metadata[team_id]': teamId,
    'metadata[plan]': plan,
    'allow_promotion_codes': 'true',
  };

  const stripeSession = await stripeAPI(env, 'checkout/sessions', params);
  if (stripeSession.error) return jsonError(stripeSession.error.message, 400);

  return jsonOk({ url: stripeSession.url });
}

// ─── POST /api/stripe/portal ───

export async function portal(request, env, session) {
  const dbUser = await env.DB.prepare(
    'SELECT stripe_customer_id FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!dbUser?.stripe_customer_id) {
    return jsonError('サブスクリプションがありません', 400);
  }

  const origin = new URL(request.url).origin;
  const portalSession = await stripeAPI(env, 'billing/portal/sessions', {
    customer: dbUser.stripe_customer_id,
    return_url: `${origin}/app`,
  });
  if (portalSession.error) return jsonError(portalSession.error.message, 400);

  return jsonOk({ url: portalSession.url });
}

// ─── POST /api/stripe/webhook ───

export async function webhook(request, env) {
  const body = await request.text();

  // 署名検証
  const sig = request.headers.get('stripe-signature');
  if (env.STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyWebhookSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return jsonError('署名検証失敗', 400);
  }

  let event;
  try { event = JSON.parse(body); } catch { return jsonError('Invalid JSON', 400); }

  const type = event.type;
  const data = event.data?.object;

  // ========== checkout.session.completed ==========
  if (type === 'checkout.session.completed') {
    const userId = data.metadata?.tasukibako_user_id;
    const teamId = data.metadata?.team_id;
    const customerId = data.customer;

    // subscriptionのpriceIdからプラン判定（metadata改ざん防止）
    let plan = null;
    if (data.subscription) {
      try {
        const sub = await stripeAPI(env, `subscriptions/${data.subscription}`, {}, 'GET');
        if (!sub.error) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          plan = STRIPE_PRICE_TO_PLAN[priceId];
        }
      } catch (e) {
        console.error('[checkout.completed] subscription取得失敗:', e.message);
      }
    }
    // フォールバック
    if (!plan) plan = data.metadata?.plan;

    if (teamId && plan && PLAN_LIMITS[plan]) {
      const now = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE teams SET plan = ?, updated_at = ? WHERE id = ?'
      ).bind(plan, now, teamId).run();

      // stripe_customer_id保存
      if (userId && customerId) {
        await env.DB.prepare(
          'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
        ).bind(customerId, userId).run();
      }
    }
  }

  // ========== customer.subscription.updated（プラン変更） ==========
  if (type === 'customer.subscription.updated') {
    const customerId = data.customer;
    const priceId = data.items?.data?.[0]?.price?.id;
    const plan = STRIPE_PRICE_TO_PLAN[priceId];

    if (customerId && plan && PLAN_LIMITS[plan]) {
      // stripe_customer_idからオーナーのチームを特定
      const owner = await env.DB.prepare(
        'SELECT id FROM users WHERE stripe_customer_id = ?'
      ).bind(customerId).first();

      if (owner) {
        const now = new Date().toISOString();
        // オーナーの全チームを更新（通常1チーム）
        await env.DB.prepare(
          'UPDATE teams SET plan = ?, updated_at = ? WHERE owner_id = ?'
        ).bind(plan, now, owner.id).run();

        // ダウングレード時のメンバー上限チェック
        const limits = PLAN_LIMITS[plan];
        const teams = await env.DB.prepare(
          'SELECT id FROM teams WHERE owner_id = ?'
        ).bind(owner.id).all();

        for (const t of (teams.results || [])) {
          await trimTeamMembers(env, t.id, limits.maxMembers);
        }
      }
    }
  }

  // ========== customer.subscription.deleted（解約） ==========
  if (type === 'customer.subscription.deleted') {
    const customerId = data.customer;
    if (customerId) {
      const owner = await env.DB.prepare(
        'SELECT id FROM users WHERE stripe_customer_id = ?'
      ).bind(customerId).first();

      if (owner) {
        const now = new Date().toISOString();
        // 全チームをfreeに戻す
        await env.DB.prepare(
          'UPDATE teams SET plan = ?, updated_at = ? WHERE owner_id = ?'
        ).bind('free', now, owner.id).run();

        // メンバー上限をfreeに合わせる
        const teams = await env.DB.prepare(
          'SELECT id FROM teams WHERE owner_id = ?'
        ).bind(owner.id).all();

        for (const t of (teams.results || [])) {
          await trimTeamMembers(env, t.id, PLAN_LIMITS.free.maxMembers);
        }
      }
    }
  }

  return jsonOk({ received: true });
}

// ─── ダウングレード時のメンバー削除 ───

async function trimTeamMembers(env, teamId, maxMembers) {
  const { cnt } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(teamId).first();

  if (cnt <= maxMembers) return;

  const excess = await env.DB.prepare(`
    SELECT user_id FROM team_members WHERE team_id = ? AND role != 'owner'
    ORDER BY joined_at DESC LIMIT ?
  `).bind(teamId, cnt - maxMembers).all();

  for (const row of (excess.results || [])) {
    await env.DB.prepare(
      'DELETE FROM team_members WHERE team_id = ? AND user_id = ?'
    ).bind(teamId, row.user_id).run();
  }
}
