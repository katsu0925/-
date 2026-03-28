/**
 * 認証API — 登録/ログイン/ログアウト
 */
import { jsonOk, jsonError } from '../utils/response.js';
import {
  verifyPasswordV2,
  createPasswordHash,
  generateSessionId,
} from '../utils/crypto.js';
import { PLAN_LIMITS } from '../config.js';

const SESSION_DURATION_MS = 86400000;      // 24時間
const SESSION_REMEMBER_ME_MS = 2592000000; // 30日

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

  // レート制限
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
    expiresAt,
  }), {
    expirationTtl: Math.ceil(durationMs / 1000),
  });

  // last_login更新
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, user.id).run();

  // 所属チーム一覧
  const teams = await getUserTeams(env, user.id);

  return jsonOk({
    sessionId,
    user: { id: user.id, email: user.email, displayName: user.display_name },
    teams,
  });
}

/**
 * 登録
 */
export async function register(request, env) {
  const body = await request.json();
  const { password, displayName, inviteCode } = body;
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !password || !displayName) {
    return jsonError('メールアドレス、パスワード、表示名は必須です。');
  }
  if (password.length < 6) {
    return jsonError('パスワードは6文字以上で設定してください。');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('メールアドレスの形式が正しくありません。');
  }

  // レート制限
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:register:${clientIp}`;
  const rlCount = parseInt(await env.SESSIONS.get(rlKey) || '0', 10);
  if (rlCount >= 10) {
    return jsonError('登録の試行回数の上限に達しました。しばらくしてからお試しください。');
  }
  await env.SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

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

  await env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, last_login, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(userId, email, passwordHash, displayName.trim(), now, now, now).run();

  // 招待コードがある場合、チームに参加
  let joinedTeam = null;
  let joinError = null;
  if (inviteCode) {
    const team = await env.DB.prepare(
      'SELECT * FROM teams WHERE invite_code = ? AND invite_enabled = 1'
    ).bind(inviteCode).first();

    if (!team) {
      joinError = '招待コードが無効です。チーム画面から参加できます。';
    } else {
      const memberCount = (await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
      ).bind(team.id).first()).cnt;

      const limits = PLAN_LIMITS[team.plan] || PLAN_LIMITS.free;
      if (memberCount >= limits.maxMembers) {
        joinError = `「${team.name}」のメンバー上限（${limits.maxMembers}人）に達しています。`;
      } else {
        await env.DB.prepare(
          'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
        ).bind(team.id, userId, 'member', now).run();
        joinedTeam = { id: team.id, name: team.name };
      }
    }
  }

  // セッション作成
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    userId, email, displayName: displayName.trim(), expiresAt,
  }), {
    expirationTtl: Math.ceil(SESSION_DURATION_MS / 1000),
  });

  const teams = await getUserTeams(env, userId);

  return jsonOk({
    sessionId,
    user: { id: userId, email, displayName: displayName.trim() },
    teams,
    joinedTeam,
    joinError,
  });
}

/**
 * ログアウト
 */
export async function logout(request, env) {
  const body = await request.json();
  if (body.sessionId) {
    await env.SESSIONS.delete(`session:${body.sessionId}`);
  }
  return jsonOk({});
}

/**
 * ユーザーの所属チーム一覧を取得
 */
async function getUserTeams(env, userId) {
  const { results } = await env.DB.prepare(`
    SELECT t.id, t.name, t.plan, t.product_count, t.image_count,
           t.invite_code, t.invite_enabled, tm.role
    FROM teams t
    JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.user_id = ?
  `).bind(userId).all();
  return results || [];
}
