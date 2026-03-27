/**
 * AI採寸 Workers API
 *
 * POST /api/measure        — キーポイント検出 + 採寸計算
 * POST /api/feedback       — ユーザー修正データ記録
 * GET  /api/usage          — 利用回数確認
 * POST /api/auth/register  — ユーザー登録
 * POST /api/auth/login     — ログイン
 * POST /api/auth/logout    — ログアウト
 * GET  /api/auth/me        — セッション情報取得
 * POST /api/stripe/checkout — Stripe Checkout セッション作成
 * POST /api/stripe/portal   — Customer Portal セッション作成
 * POST /api/stripe/webhook  — Stripe Webhook 受信
 */

const SESSION_TTL = 30 * 24 * 3600; // 30日 (秒)
const COOKIE_NAME = 'sm_session';
const PLAN_LIMITS = { free: 5, light: 50, standard: 100, pro: 300, team: 500 };
const TEAM_MEMBER_LIMITS = { pro: 3, team: 5 }; // オーナー含む

// Stripe 価格ID → プラン名マッピング
const STRIPE_PRICE_TO_PLAN = {
  'price_1TFSDJJxnW1kn7BUkNX5sc8g': 'light',
  'price_1TFSDqJxnW1kn7BURjOr8Ha5': 'standard',
  'price_1TFSEOJxnW1kn7BUjcMF1nyJ': 'pro',
  'price_1TFSF7JxnW1kn7BUjbMFTOuq': 'team',
};
const PLAN_TO_STRIPE_PRICE = Object.fromEntries(Object.entries(STRIPE_PRICE_TO_PLAN).map(([k,v])=>[v,k]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === 'GET' && (path === '/favicon.ico' || path === '/favicon.svg' || path === '/apple-touch-icon.png')) {
      return handleFavicon(path);
    }

    // セッション復元（全リクエスト共通）
    const user = await getSessionUser(request, env);

    try {
      // 認証API
      if (path === '/api/auth/register' && request.method === 'POST') return await handleRegister(request, env);
      if (path === '/api/auth/login' && request.method === 'POST') return await handleLogin(request, env);
      if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout();
      if (path === '/api/auth/me' && request.method === 'GET') return await handleMe(request, env, user);

      // チームAPI
      if (path === '/api/team/invite' && request.method === 'POST') return await handleTeamInvite(request, env, user);
      if (path === '/api/team/join' && request.method === 'POST') return await handleTeamJoin(request, env, user);
      if (path === '/api/team/members' && request.method === 'GET') return await handleTeamMembers(request, env, user);
      if (path === '/api/team/remove' && request.method === 'POST') return await handleTeamRemove(request, env, user);
      if (path === '/api/team/leave' && request.method === 'POST') return await handleTeamLeave(request, env, user);

      // Stripe API
      if (path === '/api/stripe/checkout' && request.method === 'POST') return await handleStripeCheckout(request, env, user);
      if (path === '/api/stripe/portal' && request.method === 'POST') return await handleStripePortal(request, env, user);
      if (path === '/api/stripe/webhook' && request.method === 'POST') return await handleStripeWebhook(request, env);

      // 既存API
      if (path === '/api/measure' && request.method === 'POST') return await handleMeasure(request, env, user);
      if (path === '/api/feedback' && request.method === 'POST') return await handleFeedback(request, env, user);
      if (path === '/api/usage' && request.method === 'GET') return await handleUsage(request, env, user);

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: e.message }, 500);
    }
  },
};

// ==================================================
// 暗号ユーティリティ（SHA-256 + salt）
// ==================================================
async function sha256(data) {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return bufToHex(hash);
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateHex(len) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer).slice(0, len);
}

async function hashPassword(password) {
  const salt = generateHex(32);
  const hash = await hashWithSalt(password, salt, 1000);
  return `v2:${salt}:${hash}`;
}

async function hashWithSalt(password, salt, iterations) {
  let hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password + ':' + salt)));
  if (iterations > 1) {
    const saltHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt)));
    for (let i = 1; i < iterations; i++) {
      const combined = new Uint8Array(hash.length + saltHash.length);
      combined.set(hash, 0);
      combined.set(saltHash, hash.length);
      hash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
    }
  }
  return bufToHex(hash.buffer);
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('v2:')) return false;
  const [, salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const computed = await hashWithSalt(password, salt, 1000);
  // timing-safe comparison
  if (computed.length !== expected.length) return false;
  const a = new TextEncoder().encode(computed);
  const b = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ==================================================
// セッション管理
// ==================================================
async function getSessionUser(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([a-f0-9]+)`));
  if (!match) return null;
  const sessionId = match[1];
  const data = await env.SM_SESSIONS.get(`sm_session:${sessionId}`, 'json');
  if (!data) return null;
  if (data.expiresAt && new Date(data.expiresAt) <= new Date()) {
    await env.SM_SESSIONS.delete(`sm_session:${sessionId}`);
    return null;
  }
  return data;
}

function sessionCookie(sessionId, maxAge = SESSION_TTL) {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function createSession(env, user) {
  const sessionId = generateHex(64);
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
  await env.SM_SESSIONS.put(`sm_session:${sessionId}`, JSON.stringify({
    userId: user.id, email: user.email, plan: user.plan,
    limit: user.monthly_limit, expiresAt,
  }), { expirationTtl: SESSION_TTL });
  return sessionId;
}

// ==================================================
// 使用量管理
// ==================================================
function currentMonth() { return new Date().toISOString().slice(0, 7); }

// チームのオーナー情報を取得（メンバーならオーナーを返す、オーナー自身ならnull）
async function getTeamOwner(env, userId) {
  const membership = await env.DB.prepare('SELECT owner_id FROM sm_team_members WHERE member_id = ?').bind(userId).first();
  if (!membership) return null;
  return await env.DB.prepare('SELECT id, plan, monthly_limit FROM sm_users WHERE id = ?').bind(membership.owner_id).first();
}

// チーム全体の使用量を合算
async function getTeamUsage(env, ownerId, month) {
  // オーナー自身 + 全メンバーの使用量合算
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(u.used), 0) as total FROM sm_usage u
    WHERE u.month = ? AND (u.user_id = ? OR u.user_id IN (SELECT member_id FROM sm_team_members WHERE owner_id = ?))`)
    .bind(month, ownerId, ownerId).first();
  return row?.total || 0;
}

async function getUsage(env, user, request) {
  const month = currentMonth();
  if (user) {
    // チームメンバーかチェック
    const teamOwner = await getTeamOwner(env, user.userId);
    if (teamOwner) {
      // メンバー → オーナーの枠を使う
      const used = await getTeamUsage(env, teamOwner.id, month);
      return { used, limit: teamOwner.monthly_limit || PLAN_LIMITS[teamOwner.plan] || 5, plan: teamOwner.plan, teamRole: 'member' };
    }
    // オーナーかチェック（自分がチームを持っている場合）
    const hasTeam = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sm_team_members WHERE owner_id = ?').bind(user.userId).first();
    if (hasTeam?.cnt > 0) {
      const used = await getTeamUsage(env, user.userId, month);
      return { used, limit: user.limit || PLAN_LIMITS[user.plan] || 5, plan: user.plan, teamRole: 'owner' };
    }
    // ソロユーザー
    const row = await env.DB.prepare('SELECT used FROM sm_usage WHERE user_id = ? AND month = ?').bind(user.userId, month).first();
    return { used: row?.used || 0, limit: user.limit || PLAN_LIMITS[user.plan] || 5, plan: user.plan };
  }
  // 未ログイン: IPベース
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = (await sha256('sm_salt_' + ip)).slice(0, 16);
  const row = await env.DB.prepare('SELECT used FROM sm_usage WHERE ip_hash = ? AND month = ? AND user_id IS NULL').bind(ipHash, month).first();
  return { used: row?.used || 0, limit: 5, plan: 'free', ipHash };
}

async function incrementUsage(env, user, request) {
  const month = currentMonth();
  if (user) {
    await env.DB.prepare(`INSERT INTO sm_usage (user_id, month, used) VALUES (?, ?, 1)
      ON CONFLICT(user_id, month) DO UPDATE SET used = used + 1`).bind(user.userId, month).run();
  } else {
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const ipHash = (await sha256('sm_salt_' + ip)).slice(0, 16);
    await env.DB.prepare(`INSERT INTO sm_usage (ip_hash, month, used) VALUES (?, ?, 1)
      ON CONFLICT(ip_hash, month) DO UPDATE SET used = used + 1`).bind(ipHash, month).run();
  }
}

// ==================================================
// POST /api/auth/register
// ==================================================
async function handleRegister(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return jsonResponse({ error: 'メールアドレスとパスワードを入力してください' }, 400);
  if (password.length < 8) return jsonResponse({ error: 'パスワードは8文字以上で入力してください' }, 400);

  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return jsonResponse({ error: 'メールアドレスの形式が正しくありません' }, 400);

  // レート制限
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rlKey = `rl:register:${ip}`;
  const rlCount = parseInt(await env.SM_SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 10) return jsonResponse({ error: '登録試行回数の上限です。しばらくしてからお試しください' }, 429);
  await env.SM_SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  // 既存チェック
  const existing = await env.DB.prepare('SELECT id FROM sm_users WHERE email = ?').bind(normalized).first();
  if (existing) return jsonResponse({ error: 'このメールアドレスは既に登録されています' }, 409);

  const now = new Date().toISOString();
  const userId = 'U' + Date.now().toString(36).toUpperCase();
  const hash = await hashPassword(password);

  await env.DB.prepare(`INSERT INTO sm_users (id, email, password_hash, plan, monthly_limit, display_name, created_at, updated_at)
    VALUES (?, ?, ?, 'free', 5, '', ?, ?)`).bind(userId, normalized, hash, now, now).run();

  const user = { id: userId, email: normalized, plan: 'free', monthly_limit: 5 };
  const sessionId = await createSession(env, user);

  return jsonResponse({ ok: true, user: { id: userId, email: normalized, plan: 'free', limit: 5 } }, 201, {
    'Set-Cookie': sessionCookie(sessionId),
  });
}

// ==================================================
// POST /api/auth/login
// ==================================================
async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return jsonResponse({ error: 'メールアドレスとパスワードを入力してください' }, 400);

  const normalized = email.trim().toLowerCase();

  // レート制限
  const rlKey = `rl:login:${normalized}`;
  const rlCount = parseInt(await env.SM_SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 30) return jsonResponse({ error: 'ログイン試行回数の上限です。しばらくしてからお試しください' }, 429);
  await env.SM_SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  const row = await env.DB.prepare('SELECT * FROM sm_users WHERE email = ?').bind(normalized).first();
  if (!row) return jsonResponse({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401);

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return jsonResponse({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401);

  // 最終ログイン更新
  await env.DB.prepare('UPDATE sm_users SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();

  const sessionId = await createSession(env, row);
  const usage = await getUsage(env, { userId: row.id, plan: row.plan, limit: row.monthly_limit }, request);

  return jsonResponse({
    ok: true,
    user: { id: row.id, email: row.email, plan: row.plan, displayName: row.display_name, limit: row.monthly_limit, ...usage },
  }, 200, { 'Set-Cookie': sessionCookie(sessionId) });
}

// ==================================================
// POST /api/auth/logout
// ==================================================
function handleLogout() {
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
}

// ==================================================
// GET /api/auth/me
// ==================================================
async function handleMe(request, env, user) {
  if (!user) return jsonResponse({ loggedIn: false, plan: 'free', used: 0, limit: 5 });
  const usage = await getUsage(env, user, request);
  return jsonResponse({ loggedIn: true, userId: user.userId, email: user.email, plan: user.plan, ...usage });
}

// ==================================================
// Stripe API ヘルパー
// ==================================================
async function stripeAPI(env, endpoint, params) {
  const resp = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return resp.json();
}

// ==================================================
// POST /api/stripe/checkout — Checkout セッション作成
// ==================================================
async function handleStripeCheckout(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);

  const { plan } = await request.json();
  const priceId = PLAN_TO_STRIPE_PRICE[plan];
  if (!priceId) return jsonResponse({ error: '無効なプランです' }, 400);

  // Stripe Customer 取得 or 作成
  const dbUser = await env.DB.prepare('SELECT stripe_customer_id, email FROM sm_users WHERE id = ?').bind(user.userId).first();
  let customerId = dbUser?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripeAPI(env, 'customers', { email: dbUser.email, 'metadata[sm_user_id]': user.userId });
    customerId = customer.id;
    await env.DB.prepare('UPDATE sm_users SET stripe_customer_id = ? WHERE id = ?').bind(customerId, user.userId).run();
  }

  const origin = new URL(request.url).origin;
  const session = await stripeAPI(env, 'checkout/sessions', {
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'subscription',
    success_url: `${origin}/measure?checkout=success`,
    cancel_url: `${origin}/measure?checkout=cancel`,
    'metadata[sm_user_id]': user.userId,
    'metadata[plan]': plan,
  });

  if (session.error) return jsonResponse({ error: session.error.message }, 400);
  return jsonResponse({ url: session.url });
}

// ==================================================
// POST /api/stripe/portal — Customer Portal セッション
// ==================================================
async function handleStripePortal(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);

  const dbUser = await env.DB.prepare('SELECT stripe_customer_id FROM sm_users WHERE id = ?').bind(user.userId).first();
  if (!dbUser?.stripe_customer_id) return jsonResponse({ error: 'サブスクリプションがありません' }, 400);

  const origin = new URL(request.url).origin;
  const session = await stripeAPI(env, 'billing/portal/sessions', {
    customer: dbUser.stripe_customer_id,
    return_url: `${origin}/measure`,
  });

  if (session.error) return jsonResponse({ error: session.error.message }, 400);
  return jsonResponse({ url: session.url });
}

// ==================================================
// チーム管理 API
// ==================================================
async function handleTeamInvite(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);
  const dbUser = await env.DB.prepare('SELECT plan FROM sm_users WHERE id = ?').bind(user.userId).first();
  const maxMembers = TEAM_MEMBER_LIMITS[dbUser?.plan] || 0;
  if (maxMembers === 0) return jsonResponse({ error: 'チーム機能はプロプラン以上で利用できます' }, 403);

  const memberCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sm_team_members WHERE owner_id = ?').bind(user.userId).first();
  if ((memberCount?.cnt || 0) + 1 >= maxMembers) return jsonResponse({ error: `メンバー上限（${maxMembers}人）に達しています` }, 400);

  const token = generateHex(32);
  await env.SM_SESSIONS.put(`invite:${token}`, JSON.stringify({ ownerId: user.userId }), { expirationTtl: 7 * 24 * 3600 });
  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, inviteUrl: `${origin}/measure?invite=${token}`, token });
}

async function handleTeamJoin(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);
  const { token } = await request.json();
  if (!token) return jsonResponse({ error: '招待トークンが必要です' }, 400);

  const invite = await env.SM_SESSIONS.get(`invite:${token}`, 'json');
  if (!invite) return jsonResponse({ error: '招待リンクが無効または期限切れです' }, 400);

  if (invite.ownerId === user.userId) return jsonResponse({ error: '自分自身を招待することはできません' }, 400);

  // 既に別チームに所属していないかチェック
  const existing = await env.DB.prepare('SELECT owner_id FROM sm_team_members WHERE member_id = ?').bind(user.userId).first();
  if (existing) return jsonResponse({ error: '既に別のチームに所属しています。先に脱退してください' }, 400);

  // 上限チェック
  const owner = await env.DB.prepare('SELECT plan FROM sm_users WHERE id = ?').bind(invite.ownerId).first();
  const maxMembers = TEAM_MEMBER_LIMITS[owner?.plan] || 0;
  const memberCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sm_team_members WHERE owner_id = ?').bind(invite.ownerId).first();
  if ((memberCount?.cnt || 0) + 1 >= maxMembers) return jsonResponse({ error: 'チームのメンバー上限に達しています' }, 400);

  await env.DB.prepare('INSERT INTO sm_team_members (owner_id, member_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .bind(invite.ownerId, user.userId, 'member', new Date().toISOString()).run();

  // 使用済みトークンを削除
  await env.SM_SESSIONS.delete(`invite:${token}`);
  return jsonResponse({ ok: true });
}

async function handleTeamMembers(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);
  const members = await env.DB.prepare(`SELECT tm.member_id, tm.role, tm.joined_at, u.email, u.display_name
    FROM sm_team_members tm JOIN sm_users u ON tm.member_id = u.id WHERE tm.owner_id = ? ORDER BY tm.joined_at`)
    .bind(user.userId).all();

  const dbUser = await env.DB.prepare('SELECT plan FROM sm_users WHERE id = ?').bind(user.userId).first();
  const maxMembers = TEAM_MEMBER_LIMITS[dbUser?.plan] || 0;

  return jsonResponse({
    members: members.results,
    count: members.results.length + 1, // +1 for owner
    maxMembers,
    plan: dbUser?.plan,
  });
}

async function handleTeamRemove(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);
  const { memberId } = await request.json();
  if (!memberId) return jsonResponse({ error: 'メンバーIDが必要です' }, 400);

  await env.DB.prepare('DELETE FROM sm_team_members WHERE owner_id = ? AND member_id = ?').bind(user.userId, memberId).run();
  return jsonResponse({ ok: true });
}

async function handleTeamLeave(request, env, user) {
  if (!user) return jsonResponse({ error: 'ログインが必要です' }, 401);
  await env.DB.prepare('DELETE FROM sm_team_members WHERE member_id = ?').bind(user.userId).run();
  return jsonResponse({ ok: true });
}

// ダウングレード時のメンバー自動削除
async function trimTeamMembers(env, ownerId, newPlan) {
  const maxMembers = TEAM_MEMBER_LIMITS[newPlan] || 0;
  if (maxMembers === 0) {
    // チーム機能なしプラン → 全メンバー削除
    await env.DB.prepare('DELETE FROM sm_team_members WHERE owner_id = ?').bind(ownerId).run();
    return;
  }
  // 上限超過分を参加日の新しい順に削除（オーナー分の1を引く）
  const excess = await env.DB.prepare(`SELECT id FROM sm_team_members WHERE owner_id = ?
    ORDER BY joined_at DESC LIMIT -1 OFFSET ?`).bind(ownerId, maxMembers - 1).all();
  for (const row of excess.results) {
    await env.DB.prepare('DELETE FROM sm_team_members WHERE id = ?').bind(row.id).run();
  }
}

// ==================================================
// POST /api/stripe/webhook — Stripe Webhook
// ==================================================
async function handleStripeWebhook(request, env) {
  const body = await request.text();
  let event;
  try { event = JSON.parse(body); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  // TODO: 本番では署名検証 (STRIPE_WEBHOOK_SECRET) を追加
  // const sig = request.headers.get('stripe-signature');

  const type = event.type;
  const data = event.data?.object;

  if (type === 'checkout.session.completed') {
    const userId = data.metadata?.sm_user_id;
    const plan = data.metadata?.plan;
    if (userId && plan) {
      const limit = PLAN_LIMITS[plan] || 5;
      await env.DB.prepare('UPDATE sm_users SET plan = ?, monthly_limit = ?, stripe_customer_id = ?, updated_at = ? WHERE id = ?')
        .bind(plan, limit, data.customer, new Date().toISOString(), userId).run();
    }
  }

  if (type === 'customer.subscription.updated') {
    const customerId = data.customer;
    const priceId = data.items?.data?.[0]?.price?.id;
    const plan = STRIPE_PRICE_TO_PLAN[priceId];
    if (customerId && plan) {
      const limit = PLAN_LIMITS[plan] || 5;
      await env.DB.prepare('UPDATE sm_users SET plan = ?, monthly_limit = ?, updated_at = ? WHERE stripe_customer_id = ?')
        .bind(plan, limit, new Date().toISOString(), customerId).run();
      // ダウングレード時のチームメンバー自動削除
      const owner = await env.DB.prepare('SELECT id FROM sm_users WHERE stripe_customer_id = ?').bind(customerId).first();
      if (owner) await trimTeamMembers(env, owner.id, plan);
    }
  }

  if (type === 'customer.subscription.deleted') {
    const customerId = data.customer;
    if (customerId) {
      // チーム全メンバー削除
      const owner = await env.DB.prepare('SELECT id FROM sm_users WHERE stripe_customer_id = ?').bind(customerId).first();
      if (owner) await trimTeamMembers(env, owner.id, 'free');
      await env.DB.prepare('UPDATE sm_users SET plan = ?, monthly_limit = ?, updated_at = ? WHERE stripe_customer_id = ?')
        .bind('free', 5, new Date().toISOString(), customerId).run();
    }
  }

  return jsonResponse({ received: true });
}

// ==================================================
// POST /api/measure
// ==================================================
async function handleMeasure(request, env, user) {
  // 使用量チェック
  const usage = await getUsage(env, user, request);
  if (usage.used >= usage.limit) {
    return jsonResponse({ error: 'usageLimitReached', message: '今月の利用上限に達しました', used: usage.used, limit: usage.limit, plan: usage.plan }, 429);
  }

  const formData = await request.formData();
  const imageFile = formData.get('image');
  const category = formData.get('category') || 'tops';
  const scale = parseFloat(formData.get('scale') || '0');

  if (!imageFile) return jsonResponse({ error: 'image is required' }, 400);

  const imageKey = `temp/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const imageBuffer = await imageFile.arrayBuffer();
  await env.IMAGES.put(imageKey, imageBuffer, { httpMetadata: { contentType: 'image/jpeg' } });

  const imageUrl = `https://ai-measure-images.YOUR_DOMAIN.com/${imageKey}`;
  const prediction = await callReplicate(env, { image: imageUrl, category, scale });

  await env.IMAGES.delete(imageKey);

  if (prediction.error) return jsonResponse({ error: prediction.error }, 500);

  const result = typeof prediction.output === 'string' ? JSON.parse(prediction.output) : prediction.output;

  if (result.measurements) {
    await applyCorrection(result.measurements, category, env);
  }

  // 使用量カウント（成功時のみ）
  await incrementUsage(env, user, request);

  return jsonResponse(result);
}

// ==================================================
// Replicate API
// ==================================================
async function callReplicate(env, input) {
  const createResp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: env.REPLICATE_MODEL_VERSION, input }),
  });
  if (!createResp.ok) return { error: `Replicate API error: ${await createResp.text()}` };

  let prediction = await createResp.json();
  const maxWait = 60000, interval = 1000;
  let elapsed = 0;

  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    if (elapsed >= maxWait) return { error: 'Replicate timeout' };
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
    const pollResp = await fetch(prediction.urls.get, { headers: { 'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}` } });
    prediction = await pollResp.json();
  }
  return prediction.status === 'failed' ? { error: prediction.error || 'Prediction failed' } : prediction;
}

// ==================================================
// POST /api/feedback
// ==================================================
async function handleFeedback(request, env, user) {
  const body = await request.json();
  const { image_key, category, ai_keypoints, ai_measurements, user_keypoints, user_measurements, scale, image_width, image_height } = body;
  if (!category || !ai_measurements || !user_measurements) return jsonResponse({ error: 'Missing required fields' }, 400);

  await env.DB.prepare(`INSERT INTO measure_feedback (image_key, category, ai_keypoints, ai_measurements, user_keypoints, user_measurements, scale, image_width, image_height, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    image_key || null, category, JSON.stringify(ai_keypoints || {}), JSON.stringify(ai_measurements),
    JSON.stringify(user_keypoints || {}), JSON.stringify(user_measurements), scale || 0, image_width || 0, image_height || 0,
    user?.userId || null
  ).run();

  await updateCorrection(category, env);
  return jsonResponse({ ok: true });
}

// ==================================================
// 統計補正
// ==================================================
async function applyCorrection(measurements, category, env) {
  try {
    const corrections = await env.DB.prepare('SELECT measurement_name, avg_error FROM measure_correction WHERE category = ? AND sample_count >= 30').bind(category).all();
    for (const corr of corrections.results) {
      if (measurements[corr.measurement_name]) {
        const m = measurements[corr.measurement_name];
        m.value_cm = Math.round((m.value_cm - corr.avg_error) * 10) / 10;
        m.corrected = true;
      }
    }
  } catch (e) { console.log('Correction table not ready:', e.message); }
}

async function updateCorrection(category, env) {
  try {
    const rows = await env.DB.prepare('SELECT ai_measurements, user_measurements FROM measure_feedback WHERE category = ? ORDER BY created_at DESC LIMIT 500').bind(category).all();
    if (rows.results.length < 10) return;
    const errors = {};
    for (const row of rows.results) {
      const ai = JSON.parse(row.ai_measurements), user = JSON.parse(row.user_measurements);
      for (const [name, userVal] of Object.entries(user)) {
        const aiEntry = ai[name]; if (!aiEntry) continue;
        const aiVal = aiEntry.value_cm || aiEntry;
        const uVal = typeof userVal === 'object' ? userVal.value_cm : userVal;
        if (typeof aiVal === 'number' && typeof uVal === 'number') {
          if (!errors[name]) errors[name] = [];
          errors[name].push(aiVal - uVal);
        }
      }
    }
    for (const [name, errs] of Object.entries(errors)) {
      const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
      await env.DB.prepare(`INSERT INTO measure_correction (category, measurement_name, avg_error, sample_count, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(category, measurement_name) DO UPDATE SET avg_error = ?, sample_count = ?, updated_at = datetime('now')`)
        .bind(category, name, avg, errs.length, avg, errs.length).run();
    }
  } catch (e) { console.log('Update correction error:', e.message); }
}

// ==================================================
// GET /api/usage
// ==================================================
async function handleUsage(request, env, user) {
  const usage = await getUsage(env, user, request);
  return jsonResponse(usage);
}

// ==================================================
// ユーティリティ
// ==================================================
function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

function handleFavicon(path) {
  if (path === '/favicon.svg') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="8" width="24" height="18" rx="3" fill="#e94560"/><circle cx="16" cy="17" r="6" fill="#1a1a2e"/><circle cx="16" cy="17" r="4" fill="#e94560" opacity=".5"/><circle cx="16" cy="17" r="1.5" fill="#fff"/><rect x="22" y="9" width="4" height="3" rx="1" fill="#c62828"/><rect x="0" y="26" width="32" height="4" rx="1" fill="#fbbf24"/></svg>`;
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } });
  }
  return new Response(null, { status: 302, headers: { 'Location': '/favicon.svg' } });
}
