/**
 * 認証API（Phase 2）
 *
 * - apiLoginCustomer: Web Crypto APIでハッシュ検証 + KVセッション作成
 * - apiRegisterCustomer: D1 insert + KVセッション + 同期でSheets反映
 * - apiLogoutCustomer: KVセッション削除
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { sendEvent as sendMetaEvent } from '../utils/meta-capi.js';
import {
  verifyPasswordV2,
  createPasswordHash,
  generateSessionId,
  generateCsrfToken,
} from '../utils/crypto.js';

const SESSION_DURATION_MS = 86400000;      // 24時間
const SESSION_REMEMBER_ME_MS = 2592000000; // 30日

/**
 * apiLoginCustomer
 */
export async function login(args, env) {
  const userKey = args[0] || '';
  const params = args[1] || {};
  const { email: rawEmail, password, rememberMe } = params;

  if (!rawEmail || !password) {
    return jsonError('メールアドレスとパスワードを入力してください。');
  }

  const email = rawEmail.trim().toLowerCase();

  // レート制限チェック
  const rlKey = `rl:login:${email}`;
  const rlCount = parseInt(await env.SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 30) {
    return jsonError('ログイン試行回数の上限に達しました。しばらくしてからお試しください。');
  }
  // レート制限カウンタ更新（1時間TTL）
  await env.SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  // D1から顧客検索
  const customer = await env.DB.prepare(
    'SELECT * FROM customers WHERE email = ?'
  ).bind(email).first();

  if (!customer) {
    return jsonError('メールアドレスまたはパスワードが正しくありません。');
  }

  // パスワード検証
  const { match, needsGasFallback } = await verifyPasswordV2(password, customer.password_hash);

  if (needsGasFallback) {
    // v1/legacy形式 → GASにフォールバックして検証
    return null; // index.jsでnull返却を検知してGASプロキシへ
  }

  if (!match) {
    return jsonError('メールアドレスまたはパスワードが正しくありません。');
  }

  // セッション作成
  const sessionId = generateSessionId();
  const durationMs = rememberMe ? SESSION_REMEMBER_ME_MS : SESSION_DURATION_MS;
  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  // KVにセッション保存
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    customerId: customer.id,
    email: customer.email,
    expiresAt,
  }), {
    expirationTtl: Math.ceil(durationMs / 1000),
  });

  // D1のlast_loginを更新
  await env.DB.prepare(
    'UPDATE customers SET last_login = ?, updated_at = ? WHERE id = ?'
  ).bind(new Date().toISOString(), new Date().toISOString(), customer.id).run();

  // CSRFトークン発行
  const csrfToken = generateCsrfToken();
  await env.SESSIONS.put(`csrf:${userKey}`, csrfToken, { expirationTtl: 3600 });

  // isOwner判定
  const ownerEmail = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('ADMIN_OWNER_EMAIL').first();
  const isOwner = ownerEmail && customer.email === ownerEmail.value;

  // firstHalfPrice判定
  let firstHalfPrice = null;
  {
    const fhpRow = await env.DB.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('FIRST_HALF_PRICE_STATUS').first();
    if (fhpRow) {
      try {
        const parsed = JSON.parse(fhpRow.value);
        firstHalfPrice = {
          eligible: !!(parsed.enabled && customer.purchase_count === 0),
          rate: parsed.rate || 0.5,
        };
      } catch (e) { /* ignore */ }
    }
  }

  return jsonOk({ data: {
    sessionId,
    csrfToken,
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
  }});
}

/**
 * apiRegisterCustomer
 */
export async function register(args, env, bodyText, ctx) {
  const userKey = args[0] || '';
  const params = args[1] || {};
  const {
    email: rawEmail,
    password,
    companyName,
    phone,
    postal,
    address,
    newsletter,
  } = params;

  // バリデーション
  if (!rawEmail || !password || !companyName) {
    return jsonError('メールアドレス、パスワード、会社名/氏名は必須です。');
  }
  if (password.length < 6) {
    return jsonError('パスワードは6文字以上で設定してください。');
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('メールアドレスの形式が正しくありません。');
  }

  // 重複チェック
  const existing = await env.DB.prepare(
    'SELECT id FROM customers WHERE email = ?'
  ).bind(email).first();

  if (existing) {
    return jsonError('このメールアドレスは既に登録されています。');
  }

  // パスワードハッシュ生成
  const passwordHash = await createPasswordHash(password);

  // 顧客ID生成: 'C' + timestamp.toString(36).toUpperCase()
  const customerId = 'C' + Date.now().toString(36).toUpperCase();
  const now = new Date().toISOString();
  const initialPoints = 500; // 新規登録ボーナス

  // D1に挿入
  await env.DB.prepare(`
    INSERT INTO customers (id, email, password_hash, company_name, phone, postal,
                           address, newsletter, created_at, last_login, points,
                           points_updated_at, purchase_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    customerId, email, passwordHash, companyName,
    phone || '', postal || '', address || '',
    newsletter ? 1 : 0,
    now, now, initialPoints, now, now
  ).run();

  // セッション作成
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    customerId,
    email,
    expiresAt,
  }), {
    expirationTtl: Math.ceil(SESSION_DURATION_MS / 1000),
  });

  // CSRFトークン発行
  const csrfToken = generateCsrfToken();
  await env.SESSIONS.put(`csrf:${userKey}`, csrfToken, { expirationTtl: 3600 });

  // CAPI: CompleteRegistration イベント送信（バックグラウンド）
  const capiPromise = sendMetaEvent(env, {
    eventName: 'CompleteRegistration',
    eventId: 'reg_' + customerId,
    sourceUrl: 'https://wholesale.nkonline-tool.com/',
    userData: {
      email,
      phone: phone || undefined,
      zip: postal || undefined,
      country: 'jp',
      externalId: customerId,
    },
    customData: {
      content_name: 'wholesale_member',
      status: 'true',
    },
  }).catch(err => console.error('CAPI CompleteRegistration error:', err));

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(capiPromise);
  }

  return jsonOk({ data: {
    sessionId,
    csrfToken,
    customer: {
      id: customerId,
      email,
      companyName,
      phone: phone || '',
      postal: postal || '',
      address: address || '',
      newsletter: !!newsletter,
      points: initialPoints,
      purchaseCount: 0,
    },
    welcomeBonus: initialPoints,
  }});
}

/**
 * apiLogoutCustomer
 */
export async function logout(args, env) {
  const params = args[1] || args[0] || {};
  const { sessionId } = params;

  if (sessionId) {
    await env.SESSIONS.delete(`session:${sessionId}`);
  }

  return jsonOk({});
}
