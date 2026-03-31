/**
 * セッション管理
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * リクエストからセッションを検証
 * Authorization: Bearer {sessionId} ヘッダーから取得
 * @returns {object|null} { userId, email, displayName, role } or null
 */
export async function extractSession(request, env) {
  let sessionId = null;

  // Authorizationヘッダーから取得
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    sessionId = auth.slice(7);
  }

  // クエリパラメータからも取得（画像配信・ページ遷移用）
  if (!sessionId) {
    const url = new URL(request.url);
    sessionId = url.searchParams.get('token');
  }

  // Cookieからも取得（ページ遷移用）
  if (!sessionId) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/session_id=([a-f0-9]+)/);
    if (match) sessionId = match[1];
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
    role: sessionData.role,
  };
}

/**
 * セッション検証API — ユーザー情報を返す
 */
export async function validateAndReturn(request, env, session) {
  // ユーザー設定も取得
  const settings = await env.DB.prepare(
    'SELECT default_destination FROM user_settings WHERE user_id = ?'
  ).bind(session.userId).first();

  return jsonOk({
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      defaultDestination: settings?.default_destination || null,
    },
  });
}
