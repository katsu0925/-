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
  const t0 = Date.now();
  const body = await request.json();
  const { teamId } = body;
  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  // キャッシュ済みリストがあれば即返却
  const cacheKey = `team:${teamId}:product-list-cache`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return jsonOk({ items: JSON.parse(cached) }, { 'Server-Timing': `cache;dur=${Date.now()-t0};desc="hit"` });
  }

  // キャッシュなし→フル構築
  const tBuild = Date.now();
  const items = await buildProductList(env, teamId);
  const buildDur = Date.now() - tBuild;

  // キャッシュ保存（15分TTL — 5分Cronで定期リフレッシュ、3tick失敗まで耐える）
  await env.CACHE.put(cacheKey, JSON.stringify(items), { expirationTtl: 900 });

  return jsonOk({ items }, { 'Server-Timing': `cache;dur=0;desc="miss", build;dur=${buildDur}, total;dur=${Date.now()-t0}` });
}

/**
 * 全チームの商品一覧キャッシュをウォームアップ
 * Cron 5分ごとに呼ばれる。D1から全チームIDを取得し、それぞれ buildProductList → KV put。
 *
 * KV write 概算:
 *   チーム数N × 1 put × 288tick/日 = N × 8,640/月
 *   N=50 → 432k/月 → 無料枠30k超過、$5/100万で約$2/月（要監視）
 *   N=10 → 86k/月 → 無料枠超過なら約$0.4/月
 *
 * 注意: 全チーム並列ではなく、チャンク（5件ずつ）で順次実行してCron制限内に収める。
 */
export async function warmupAllTeams(env) {
  const t0 = Date.now();
  try {
    const result = await env.DB.prepare('SELECT id FROM teams').all();
    const teamIds = (result.results || []).map(r => r.id);
    if (teamIds.length === 0) {
      console.log('[warmup] tasukibako: no teams');
      return;
    }
    let ok = 0, fail = 0;
    const CHUNK = 5;
    for (let i = 0; i < teamIds.length; i += CHUNK) {
      const chunk = teamIds.slice(i, i + CHUNK);
      const results = await Promise.allSettled(chunk.map(async (teamId) => {
        const items = await buildProductList(env, teamId);
        await env.CACHE.put(`team:${teamId}:product-list-cache`, JSON.stringify(items), { expirationTtl: 900 });
      }));
      results.forEach(r => { if (r.status === 'fulfilled') ok++; else fail++; });
    }
    console.log(`[warmup] tasukibako: ${ok} teams cached, ${fail} failed (${Date.now()-t0}ms, total ${teamIds.length})`);
  } catch (e) {
    console.error('[warmup] tasukibako failed:', e && e.message ? e.message : e);
  }
}

/** リストデータをKVから構築 */
async function buildProductList(env, teamId) {
  const indexKey = `team:${teamId}:product-images:index`;
  const indexJson = await env.CACHE.get(indexKey);
  const index = indexJson ? JSON.parse(indexJson) : [];

  const cleanupIds = [];
  const items = (await Promise.all(
    index.map(async (managedId) => {
      // QW1: 3つのKV読みを並列化（順次awaitを Promise.all へ）
      const [urlsJson, metaJson, saveLogJson] = await Promise.all([
        env.CACHE.get(`team:${teamId}:product-images:${managedId}`),
        env.CACHE.get(`team:${teamId}:product-meta:${managedId}`),
        env.CACHE.get(`team:${teamId}:product-save-log:${managedId}`),
      ]);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      if (urls.length === 0) {
        cleanupIds.push(managedId);
        return null;
      }
      const meta = metaJson ? JSON.parse(metaJson) : {};
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

  // 0枚の商品をクリーンアップ（QW1: 各IDの3操作を並列化）
  if (cleanupIds.length > 0) {
    await Promise.all(cleanupIds.map(id => Promise.all([
      removeFromIndex(env, teamId, id),
      env.CACHE.delete(`team:${teamId}:product-images:${id}`),
      env.CACHE.delete(`team:${teamId}:product-meta:${id}`),
    ])));
  }

  return items;
}

/** リストキャッシュを無効化 */
export async function invalidateListCache(env, teamId) {
  await env.CACHE.delete(`team:${teamId}:product-list-cache`);
}

/**
 * 指定商品の画像URL一覧
 */
export async function productImages(request, env, session) {
  const t0 = Date.now();
  const body = await request.json();
  const { teamId } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  // QW1: 3つのKV読みを並列化（順次awaitを Promise.all へ）
  const tKv = Date.now();
  const [urlsJson, metaJson, saveLogJson] = await Promise.all([
    env.CACHE.get(`team:${teamId}:product-images:${managedId}`),
    env.CACHE.get(`team:${teamId}:product-meta:${managedId}`),
    env.CACHE.get(`team:${teamId}:product-save-log:${managedId}`),
  ]);
  const kvDur = Date.now() - tKv;
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  const meta = metaJson ? JSON.parse(metaJson) : {};
  const saveLog = saveLogJson ? JSON.parse(saveLogJson) : { count: 0, users: [] };

  return jsonOk({ managedId, urls, meta, saveLog }, { 'Server-Timing': `kv;dur=${kvDur}, total;dur=${Date.now()-t0}` });
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

  await invalidateListCache(env, teamId);
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

  await invalidateListCache(env, teamId);
  return jsonOk({ managedId, deleted: targetUrl, remaining: urls.length });
}

/**
 * チーム統計
 */
export async function stats(request, env, session) {
  const t0 = Date.now();
  const body = await request.json();
  const { teamId } = body;

  if (!teamId) return jsonError('teamIdは必須です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  // QW1: 2つのD1クエリを並列化
  const tD1 = Date.now();
  const [team, memberRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first(),
    env.DB.prepare('SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?').bind(teamId).first(),
  ]);
  const d1Dur = Date.now() - tD1;
  if (!team) return jsonError('チームが見つかりません。', 404);
  const memberCount = memberRow.cnt;

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
  }, { 'Server-Timing': `d1;dur=${d1Dur}, total;dur=${Date.now()-t0}` });
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
  await invalidateListCache(env, teamId);

  return jsonOk({ count: log.count });
}
