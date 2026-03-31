/**
 * 認証API — ログイン/ログアウト/スタッフ管理
 * register機能なし（管理者がcreateStaffでスタッフを作成する方式）
 */
import { jsonOk, jsonError } from '../utils/response.js';
import {
  verifyPasswordV2,
  createPasswordHash,
  generateSessionId,
} from '../utils/crypto.js';
import { LIMITS } from '../config.js';

const SESSION_DURATION_MS = LIMITS.sessionTtlMs;        // 24時間
const SESSION_REMEMBER_ME_MS = LIMITS.rememberMeTtlMs;  // 30日

/**
 * ログイン
 */
export async function login(request, env) {
  const body = await request.json();
  const { password, rememberMe } = body;
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !password) {
    return jsonError('メールアドレスとパスワードを入力してください。');
  }

  // レート制限（30回/時間）
  const rlKey = `rl:login:${email}`;
  const rlCount = parseInt(await env.SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 30) {
    return jsonError('ログイン試行回数の上限に達しました。しばらくしてからお試しください。');
  }
  await env.SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  // D1からユーザー検索
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) {
    return jsonError('メールアドレスまたはパスワードが正しくありません。');
  }

  const match = await verifyPasswordV2(password, user.password_hash);
  if (!match) {
    return jsonError('メールアドレスまたはパスワードが正しくありません。');
  }

  // セッション作成
  const sessionId = generateSessionId();
  const durationMs = rememberMe ? SESSION_REMEMBER_ME_MS : SESSION_DURATION_MS;
  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    expiresAt,
  }), {
    expirationTtl: Math.ceil(durationMs / 1000),
  });

  // last_login更新
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, user.id).run();

  // ユーザー設定取得
  const settings = await env.DB.prepare(
    'SELECT default_destination FROM user_settings WHERE user_id = ?'
  ).bind(user.id).first();

  const maxAge = Math.ceil(durationMs / 1000);
  return jsonOk({
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      defaultDestination: settings?.default_destination || null,
    },
  }, { 'Set-Cookie': `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}` });
}

/**
 * ログアウト
 */
export async function logout(request, env, session) {
  const body = await request.json();
  if (body.sessionId) {
    await env.SESSIONS.delete(`session:${body.sessionId}`);
  }
  return jsonOk({});
}

/**
 * 新規スタッフ作成（管理者のみ）
 */
export async function createStaff(request, env, session) {
  if (session.role !== 'admin') {
    return jsonError('管理者権限が必要です。', 403);
  }

  const body = await request.json();
  const { password, role } = body;
  const email = (body.email || '').trim().toLowerCase();
  const displayName = (body.displayName || '').trim().replace(/<[^>]*>/g, '');

  if (!email || !password || !displayName) {
    return jsonError('メールアドレス、パスワード、表示名は必須です。');
  }
  if (password.length < 6) {
    return jsonError('パスワードは6文字以上で設定してください。');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('メールアドレスの形式が正しくありません。');
  }
  if (role && !['admin', 'staff'].includes(role)) {
    return jsonError('ロールは admin または staff のみです。');
  }

  // 重複チェック
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email).first();
  if (existing) {
    return jsonError('このメールアドレスは既に登録されています。');
  }

  // ユーザー作成
  const passwordHash = await createPasswordHash(password);
  const userId = 'U' + Date.now().toString(36).toUpperCase();
  const now = new Date().toISOString();
  const staffRole = role || 'staff';

  await env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(userId, email, passwordHash, displayName, staffRole, now, now).run();

  return jsonOk({
    staff: {
      id: userId,
      email,
      displayName,
      role: staffRole,
    },
  });
}

/**
 * スタッフ一覧（管理者のみ）
 */
export async function listStaff(request, env, session) {
  if (session.role !== 'admin') {
    return jsonError('管理者権限が必要です。', 403);
  }

  const { results } = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.last_login, u.created_at,
           us.default_destination
    FROM users u
    LEFT JOIN user_settings us ON u.id = us.user_id
    ORDER BY u.created_at ASC
  `).all();

  return jsonOk({
    staff: (results || []).map(r => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      lastLogin: r.last_login,
      createdAt: r.created_at,
      defaultDestination: r.default_destination,
    })),
  });
}

/**
 * スタッフの固定移動先を設定（管理者のみ）
 */
export async function updateStaffDestination(request, env, session) {
  if (session.role !== 'admin') {
    return jsonError('管理者権限が必要です。', 403);
  }

  const body = await request.json();
  const { userId, destination } = body;

  if (!userId) {
    return jsonError('ユーザーIDは必須です。');
  }

  // ユーザー存在チェック
  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) {
    return jsonError('指定されたユーザーが見つかりません。', 404);
  }

  const now = new Date().toISOString();

  // UPSERT（user_settingsテーブル）
  await env.DB.prepare(`
    INSERT INTO user_settings (user_id, default_destination, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      default_destination = excluded.default_destination,
      updated_at = excluded.updated_at
  `).bind(userId, destination || null, now).run();

  return jsonOk({ userId, destination: destination || null });
}
