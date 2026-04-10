/**
 * 商品管理API（一覧・削除・統計）
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { verifyMembership } from './team.js';
import { removeFromIndex } from './upload.js';
import { generateRandomHex } from '../utils/crypto.js';
import { PLAN_LIMITS } from '../config.js';

function normalizeManagedId(raw) {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[ー]/g, '-')
    .replace(/\u3000/g, ' ')
    .toUpperCase()
    .trim();
}

/**
 * 商品一覧（サムネイル付き）
 */
export async function list(request, env, session) {
  const body = await request.json();
  const { teamId } = body;
  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const indexKey = `team:${teamId}:product-images:index`;
  const indexJson = await env.CACHE.get(indexKey);
  const index = indexJson ? JSON.parse(indexJson) : [];

  const cleanupIds = [];
  const items = (await Promise.all(
    index.map(async (managedId) => {
      const urlsJson = await env.CACHE.get(`team:${teamId}:product-images:${managedId}`);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      if (urls.length === 0) {
        cleanupIds.push(managedId);
        return null;
      }

      const metaJson = await env.CACHE.get(`team:${teamId}:product-meta:${managedId}`);
      const meta = metaJson ? JSON.parse(metaJson) : {};

      const saveLogJson = await env.CACHE.get(`team:${teamId}:product-save-log:${managedId}`);
      const saveLog = saveLogJson ? JSON.parse(saveLogJson) : { count: 0, users: [] };

      return {
        managedId,
        thumbnail: urls[0] || null,
        count: urls.length,
        uploadedByName: meta.uploadedByName || '',
        uploadedAt: meta.uploadedAt || '',
        lastUpdatedByName: meta.lastUpdatedByName || '',
        lastUpdatedAt: meta.lastUpdatedAt || '',
        saveCount: saveLog.count,
      };
    })
  )).filter(Boolean);

  // 0枚の商品をクリーンアップ
  if (cleanupIds.length > 0) {
    for (const id of cleanupIds) {
      await removeFromIndex(env, teamId, id);
      await env.CACHE.delete(`team:${teamId}:product-images:${id}`);
      await env.CACHE.delete(`team:${teamId}:product-meta:${id}`);
    }
  }

  return jsonOk({ items });
}

/**
 * 指定商品の画像URL一覧
 */
export async function productImages(request, env, session) {
  const body = await request.json();
  const { teamId } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const urlsJson = await env.CACHE.get(`team:${teamId}:product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  const metaJson = await env.CACHE.get(`team:${teamId}:product-meta:${managedId}`);
  const meta = metaJson ? JSON.parse(metaJson) : {};

  const saveLogJson = await env.CACHE.get(`team:${teamId}:product-save-log:${managedId}`);
  const saveLog = saveLogJson ? JSON.parse(saveLogJson) : { count: 0, users: [] };

  return jsonOk({ managedId, urls, meta, saveLog });
}

/**
 * 商品画像の全削除
 */
export async function deleteProduct(request, env, session) {
  const body = await request.json();
  const { teamId } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const kvKey = `team:${teamId}:product-images:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  // R2から全画像削除
  await Promise.all(urls.map(url => {
    const r2Key = url.replace(/^\/images\//, '');
    return env.IMAGES.delete(r2Key);
  }));

  // KV削除
  await env.CACHE.delete(kvKey);
  await env.CACHE.delete(`team:${teamId}:product-meta:${managedId}`);
  await removeFromIndex(env, teamId, managedId);

  // カウンター更新
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE teams SET
      product_count = MAX(product_count - 1, 0),
      image_count = MAX(image_count - ?, 0),
      updated_at = ?
    WHERE id = ?
  `).bind(urls.length, now, teamId).run();

  return jsonOk({ managedId, deleted: urls.length });
}

/**
 * 個別画像の削除
 */
export async function deleteSingle(request, env, session) {
  const body = await request.json();
  const { teamId, targetUrl } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);
  if (!targetUrl) return jsonError('削除対象のURLが必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const kvKey = `team:${teamId}:product-images:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  let urls = urlsJson ? JSON.parse(urlsJson) : [];

  if (!urls.includes(targetUrl)) {
    return jsonError('指定された画像はこの商品に属しません。', 400);
  }

  // R2から削除
  const r2Key = targetUrl.replace(/^\/images\//, '');
  await env.IMAGES.delete(r2Key);

  // KV更新
  urls = urls.filter(u => u !== targetUrl);
  const now = new Date().toISOString();

  if (urls.length === 0) {
    await env.CACHE.delete(kvKey);
    await env.CACHE.delete(`team:${teamId}:product-meta:${managedId}`);
    await removeFromIndex(env, teamId, managedId);
    // 商品数もデクリメント
    await env.DB.prepare(`
      UPDATE teams SET product_count = MAX(product_count - 1, 0),
                       image_count = MAX(image_count - 1, 0), updated_at = ? WHERE id = ?
    `).bind(now, teamId).run();
  } else {
    await env.CACHE.put(kvKey, JSON.stringify(urls));
    await env.DB.prepare(`
      UPDATE teams SET image_count = MAX(image_count - 1, 0), updated_at = ? WHERE id = ?
    `).bind(now, teamId).run();
  }

  return jsonOk({ managedId, deleted: targetUrl, remaining: urls.length });
}

/**
 * チーム統計
 */
export async function stats(request, env, session) {
  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return jsonError('チームが見つかりません。', 404);

  const { cnt: memberCount } = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?'
  ).bind(teamId).first();

  const limits = PLAN_LIMITS[team.plan] || PLAN_LIMITS.free;

  return jsonOk({
    productCount: team.product_count,
    imageCount: team.image_count,
    memberCount,
    plan: team.plan,
    limits: {
      maxProducts: limits.maxProducts,
      maxImages: limits.maxImages,
      maxMembers: limits.maxMembers,
    },
  });
}

/**
 * 画像の一時公開トークン発行（Google Lens等の外部サービス用、5分有効）
 */
export async function tempToken(request, env, session) {
  const body = await request.json();
  const { teamId, imageUrl } = body;

  if (!teamId || !imageUrl) return jsonError('teamIdとimageUrlは必須です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const token = generateRandomHex(32);
  await env.SESSIONS.put(`tmp:${token}`, JSON.stringify({ teamId }), { expirationTtl: 300 });

  const publicUrl = imageUrl + '?token=' + token;
  return jsonOk({ publicUrl });
}

/**
 * 保存ログ記録（DL/保存時に呼び出し）
 */
export async function saveLog(request, env, session) {
  const body = await request.json();
  const { teamId } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const kvKey = `team:${teamId}:product-save-log:${managedId}`;
  const existing = await env.CACHE.get(kvKey);
  const log = existing ? JSON.parse(existing) : { count: 0, users: [] };

  log.count++;
  log.users.push({
    userId: session.userId,
    displayName: session.displayName,
    savedAt: new Date().toISOString(),
  });

  // 最新100件のみ保持
  if (log.users.length > 100) {
    log.users = log.users.slice(-100);
  }

  await env.CACHE.put(kvKey, JSON.stringify(log));

  return jsonOk({ count: log.count });
}
