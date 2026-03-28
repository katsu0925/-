/**
 * セッション管理
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * リクエストからセッションを検証
 * Authorization: Bearer {sessionId} ヘッダーから取得
 * @returns {object|null} { userId, email, displayName } or null
 */
export async function extractSession(request, env) {
  let sessionId = null;

  // Authorizationヘッダーから取得
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    sessionId = auth.slice(7);
  }

  if (!sessionId) return null;

  const sessionData = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!sessionData) return null;

  // 有効期限チェック
  if (sessionData.expiresAt && new Date(sessionData.expiresAt) <= new Date()) {
    await env.SESSIONS.delete(`session:${sessionId}`);
    return null;
  }

  return {
    userId: sessionData.userId,
    email: sessionData.email,
    displayName: sessionData.displayName,
  };
}

/**
 * セッション検証API — ユーザー情報 + チーム一覧を返す
 */
export async function validateAndReturn(request, env, session) {
  const { results: teams } = await env.DB.prepare(`
    SELECT t.id, t.name, t.plan, t.product_count, t.image_count,
           t.invite_code, t.invite_enabled, tm.role
    FROM teams t
    JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.user_id = ?
  `).bind(session.userId).all();

  return jsonOk({
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
    },
    teams: teams || [],
  });
}
