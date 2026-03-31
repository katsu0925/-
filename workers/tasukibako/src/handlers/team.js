/**
 * チーム管理API
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { generateRandomHex } from '../utils/crypto.js';
import { PLAN_LIMITS } from '../config.js';

/**
 * チーム作成
 */
export async function create(request, env, session) {
  const body = await request.json();
  const name = (body.name || '').trim();

  if (!name || name.length > 50) {
    return jsonError('チーム名は1〜50文字で入力してください。');
  }

  // フリープラン: 1ユーザー1チーム（ownerとして）
  const { cnt: ownerCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE user_id = ? AND role = ?'
  ).bind(session.userId, 'owner').first();

  if (ownerCount >= 1) {
    return jsonError('フリープランではチームは1つまでです。有料プランにアップグレードすると複数チームを作成できます。');
  }

  const teamId = 'T' + Date.now().toString(36).toUpperCase();
  const inviteCode = generateRandomHex(8);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO teams (id, name, owner_id, plan, invite_code, invite_enabled,
                       product_count, image_count, created_at, updated_at)
    VALUES (?, ?, ?, 'free', ?, 1, 0, 0, ?, ?)
  `).bind(teamId, name, session.userId, inviteCode, now, now).run();

  await env.DB.prepare(
    'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).bind(teamId, session.userId, 'owner', now).run();

  return jsonOk({
    team: { id: teamId, name, plan: 'free', inviteCode, role: 'owner',
            productCount: 0, imageCount: 0 },
  });
}

/**
 * チーム一覧（自分が所属するチーム）
 */
export async function list(request, env, session) {
  const { results } = await env.DB.prepare(`
    SELECT t.id, t.name, t.plan, t.product_count, t.image_count,
           t.invite_code, t.invite_enabled, tm.role
    FROM teams t
    JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.user_id = ?
  `).bind(session.userId).all();

  return jsonOk({ teams: results || [] });
}

/**
 * 招待コードの情報取得（参加前のプレビュー）
 */
export async function inviteInfo(request, env) {
  const body = await request.json();
  const { inviteCode } = body;

  if (!inviteCode) {
    return jsonError('招待コードを入力してください。');
  }

  const team = await env.DB.prepare(
    'SELECT id, name FROM teams WHERE invite_code = ? AND invite_enabled = 1'
  ).bind(inviteCode).first();

  if (!team) {
    return jsonError('無効な招待コードです。');
  }

  const { cnt: memberCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(team.id).first();

  return jsonOk({ team: { name: team.name, memberCount } });
}

/**
 * チームに参加
 */
export async function join(request, env, session) {
  const body = await request.json();
  const { inviteCode } = body;

  if (!inviteCode) {
    return jsonError('招待コードを入力してください。');
  }

  const team = await env.DB.prepare(
    'SELECT * FROM teams WHERE invite_code = ? AND invite_enabled = 1'
  ).bind(inviteCode).first();

  if (!team) {
    return jsonError('無効な招待コードです。');
  }

  // 既に参加済みチェック
  const existing = await env.DB.prepare(
    'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(team.id, session.userId).first();

  if (existing) {
    return jsonError('既にこのチームに参加しています。');
  }

  // フリープラン: ユーザーは1チームのみ所属可能
  const { cnt: teamCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE user_id = ?'
  ).bind(session.userId).first();

  if (teamCount >= 1) {
    return jsonError('フリープランでは1つのチームにのみ参加できます。');
  }

  // メンバー上限チェック
  const { cnt: memberCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(team.id).first();

  const limits = PLAN_LIMITS[team.plan] || PLAN_LIMITS.free;
  if (memberCount >= limits.maxMembers) {
    return jsonError(`このチームのメンバー上限（${limits.maxMembers}人）に達しています。`);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).bind(team.id, session.userId, 'member', now).run();

  return jsonOk({
    team: { id: team.id, name: team.name, plan: team.plan, role: 'member' },
  });
}

/**
 * メンバー一覧
 */
export async function members(request, env, session) {
  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。');

  // メンバーシップ検証
  const membership = await env.DB.prepare(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, session.userId).first();

  if (!membership) {
    return jsonError('このチームのメンバーではありません。', 403);
  }

  const { results } = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, tm.role, tm.joined_at
    FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = ?
    ORDER BY tm.joined_at ASC
  `).bind(teamId).all();

  return jsonOk({ members: results || [] });
}

/**
 * 招待コード再生成（ownerのみ）
 */
export async function regenerateInvite(request, env, session) {
  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。');

  // ownerチェック
  const membership = await env.DB.prepare(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, session.userId).first();

  if (!membership || membership.role !== 'owner') {
    return jsonError('チームオーナーのみ実行できます。', 403);
  }

  const newCode = generateRandomHex(8);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'UPDATE teams SET invite_code = ?, updated_at = ? WHERE id = ?'
  ).bind(newCode, now, teamId).run();

  return jsonOk({ inviteCode: newCode });
}

/**
 * メンバーシップ検証ヘルパー（他ハンドラーから利用）
 */
export async function verifyMembership(env, teamId, userId) {
  const membership = await env.DB.prepare(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, userId).first();
  return membership;
}
