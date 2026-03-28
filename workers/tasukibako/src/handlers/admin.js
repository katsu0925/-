/**
 * 管理者API — プラン変更・使用量操作（テスト運用用）
 *
 * 写メジャーと同パターン: ADMIN_EMAILS で制御
 * 本番前に環境変数化 + DB role判定に移行すること
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { PLAN_LIMITS } from '../config.js';

const ADMIN_EMAILS = ['nkonline1030@gmail.com', 'nsdktts1030@gmail.com'];

/**
 * 管理者権限チェック
 */
function isAdmin(session) {
  return session && ADMIN_EMAILS.includes(session.email);
}

/**
 * プラン変更
 * POST /api/admin/set-plan
 * body: { teamId, plan }
 */
export async function setPlan(request, env, session) {
  if (!isAdmin(session)) return jsonError('権限がありません', 403);

  const body = await request.json();
  const { teamId, plan } = body;

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!PLAN_LIMITS[plan]) return jsonError('無効なプランです。有効: free, lite, standard, pro', 400);

  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return jsonError('チームが見つかりません。', 404);

  const limits = PLAN_LIMITS[plan];
  const now = new Date().toISOString();

  await env.DB.prepare(
    'UPDATE teams SET plan = ?, updated_at = ? WHERE id = ?'
  ).bind(plan, now, teamId).run();

  // ダウングレード時のメンバー上限チェック
  const { cnt: memberCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(teamId).first();

  if (memberCount > limits.maxMembers) {
    // 上限超過分を参加日の新しい順に削除
    const excess = await env.DB.prepare(`
      SELECT user_id FROM team_members WHERE team_id = ? AND role != 'owner'
      ORDER BY joined_at DESC LIMIT ?
    `).bind(teamId, memberCount - limits.maxMembers).all();

    for (const row of (excess.results || [])) {
      await env.DB.prepare(
        'DELETE FROM team_members WHERE team_id = ? AND user_id = ?'
      ).bind(teamId, row.user_id).run();
    }
  }

  return jsonOk({
    plan,
    limits,
    message: `プランを「${plan}」に変更しました`,
  });
}

/**
 * 使用量操作
 * POST /api/admin/reset-usage
 * body: { teamId, productCount, imageCount }
 */
export async function resetUsage(request, env, session) {
  if (!isAdmin(session)) return jsonError('権限がありません', 403);

  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return jsonError('チームが見つかりません。', 404);

  const productCount = typeof body.productCount === 'number' ? body.productCount : team.product_count;
  const imageCount = typeof body.imageCount === 'number' ? body.imageCount : team.image_count;
  const now = new Date().toISOString();

  await env.DB.prepare(
    'UPDATE teams SET product_count = ?, image_count = ?, updated_at = ? WHERE id = ?'
  ).bind(productCount, imageCount, now, teamId).run();

  return jsonOk({
    productCount,
    imageCount,
    message: `使用量を更新しました（商品: ${productCount}, 画像: ${imageCount}）`,
  });
}

/**
 * 管理者情報取得（管理パネル表示用）
 * POST /api/admin/info
 */
export async function info(request, env, session) {
  if (!isAdmin(session)) return jsonError('権限がありません', 403);

  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return jsonError('チームが見つかりません。', 404);

  const { cnt: memberCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(teamId).first();

  const limits = PLAN_LIMITS[team.plan] || PLAN_LIMITS.free;

  return jsonOk({
    team: {
      id: team.id,
      name: team.name,
      plan: team.plan,
      productCount: team.product_count,
      imageCount: team.image_count,
      memberCount,
    },
    limits,
    isAdmin: true,
  });
}
