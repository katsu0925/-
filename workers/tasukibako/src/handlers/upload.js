/**
 * 画像アップロードAPI（マルチテナント対応）
 *
 * R2パス: teams/{teamId}/products/{managedId}/{uuid}.jpg
 * KV: team:{teamId}:product-images:{managedId} → URL配列
 *     team:{teamId}:product-images:index → managedIdリスト
 *     team:{teamId}:product-meta:{managedId} → メタ情報
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { verifyMembership } from './team.js';
import { PLAN_LIMITS } from '../config.js';

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
 * 画像アップロード
 */
export async function uploadImages(request, env, session) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('multipart/form-data が必要です', 400);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('フォームデータの解析に失敗しました', 400);
  }

  const teamId = formData.get('teamId') || '';
  if (!teamId) return jsonError('teamIdは必須です。', 400);

  // メンバーシップ検証
  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const managedId = normalizeManagedId(formData.get('managedId') || '');
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const action = formData.get('action') || 'new';
  const files = formData.getAll('images');

  if (!files || files.length === 0) {
    return jsonError('画像ファイルが必要です。', 400);
  }
  if (files.length > MAX_IMAGES) {
    return jsonError(`画像は最大${MAX_IMAGES}枚までです。`, 400);
  }

  // チーム情報取得（プラン制限チェック用）
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return jsonError('チームが見つかりません。', 404);
  const limits = PLAN_LIMITS[team.plan] || PLAN_LIMITS.free;

  // 既存画像取得
  const kvKey = `team:${teamId}:product-images:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  let existingUrls = urlsJson ? JSON.parse(urlsJson) : [];
  const isNewProduct = existingUrls.length === 0;

  // フリープラン制限チェック
  if (isNewProduct && team.product_count >= limits.maxProducts) {
    return jsonError(`商品数の上限（${limits.maxProducts}）に達しています。`, 400);
  }
  if (team.image_count + files.length > limits.maxImages) {
    return jsonError(`画像数の上限（${limits.maxImages}）に達しています。残り${limits.maxImages - team.image_count}枚です。`, 400);
  }

  // replace-single: 1枚だけ差し替え（ぼかし・画像差し替え用）
  if (action === 'replace-single') {
    const targetUrl = formData.get('targetUrl') || '';
    if (!targetUrl) return jsonError('targetUrlが必要です。', 400);
    if (files.length !== 1) return jsonError('差し替えは1枚のみです。', 400);
    const file = files[0];
    if (!(file instanceof File)) return jsonError('不正なファイルです。', 400);
    if (file.size > MAX_FILE_SIZE) return jsonError('ファイルサイズが大きすぎます（最大10MB）。', 400);

    // 元画像をR2から削除
    const oldR2Key = targetUrl.replace(/^\/images\//, '');
    await env.IMAGES.delete(oldR2Key);

    // 新しい画像をR2にアップロード
    const uuid = crypto.randomUUID();
    const newKey = `teams/${teamId}/products/${managedId}/${uuid}.jpg`;
    await env.IMAGES.put(newKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
    });
    const newUrl = `/images/teams/${teamId}/products/${managedId}/${uuid}.jpg`;

    // KVのURL配列を更新
    const updatedUrls = existingUrls.map(u => u === targetUrl ? newUrl : u);
    await env.CACHE.put(kvKey, JSON.stringify(updatedUrls));

    // メタデータ更新
    const now = new Date().toISOString();
    const metaKey = `team:${teamId}:product-meta:${managedId}`;
    const existingMetaJson = await env.CACHE.get(metaKey);
    const existingMeta = existingMetaJson ? JSON.parse(existingMetaJson) : {};
    existingMeta.lastUpdatedBy = session.userId;
    existingMeta.lastUpdatedByName = session.displayName;
    existingMeta.lastUpdatedAt = now;
    await env.CACHE.put(metaKey, JSON.stringify(existingMeta));
    await env.CACHE.delete(`team:${teamId}:product-list-cache`);

    return jsonOk({ managedId, urls: updatedUrls, newUrl, count: updatedUrls.length });
  }

  // appendモードの枚数チェック
  if (action === 'append') {
    if (existingUrls.length + files.length > MAX_IMAGES) {
      return jsonError(`あと${MAX_IMAGES - existingUrls.length}枚まで追加可能です（現在${existingUrls.length}枚）。`, 400);
    }
  }

  // バリデーション
  for (const file of files) {
    if (!(file instanceof File)) return jsonError('不正なファイルです。', 400);
    if (file.size > MAX_FILE_SIZE) return jsonError(`ファイルサイズが大きすぎます（最大10MB）。`, 400);
  }

  // appendでない場合、既存画像をR2から削除
  if (action !== 'append' && existingUrls.length > 0) {
    await Promise.all(existingUrls.map(url => {
      const r2Key = url.replace(/^\/images\//, '');
      return env.IMAGES.delete(r2Key);
    }));
  }

  // R2に並列アップロード
  const uploadPromises = files.map(async (file) => {
    const uuid = crypto.randomUUID();
    const key = `teams/${teamId}/products/${managedId}/${uuid}.jpg`;
    const arrayBuffer = await file.arrayBuffer();
    await env.IMAGES.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return `/images/teams/${teamId}/products/${managedId}/${uuid}.jpg`;
  });

  const newUrls = await Promise.all(uploadPromises);
  const urls = action === 'append' ? [...existingUrls, ...newUrls] : newUrls;

  // KV更新
  await env.CACHE.put(kvKey, JSON.stringify(urls));

  // インデックス更新
  await addToIndex(env, teamId, managedId);

  // メタデータ保存
  const now = new Date().toISOString();
  const metaKey = `team:${teamId}:product-meta:${managedId}`;
  const existingMetaJson = await env.CACHE.get(metaKey);
  const existingMeta = existingMetaJson ? JSON.parse(existingMetaJson) : {};

  const meta = {
    uploadedBy: existingMeta.uploadedBy || session.userId,
    uploadedByName: existingMeta.uploadedByName || session.displayName,
    uploadedAt: existingMeta.uploadedAt || now,
    lastUpdatedBy: session.userId,
    lastUpdatedByName: session.displayName,
    lastUpdatedAt: now,
  };
  await env.CACHE.put(metaKey, JSON.stringify(meta));

  // チームのカウンター更新
  const productDelta = isNewProduct ? 1 : 0;
  const imageDelta = action === 'append'
    ? files.length                        // 追加: 新規枚数そのまま
    : files.length - existingUrls.length; // 上書き: 差分（負になりうる）

  await env.DB.prepare(`
    UPDATE teams SET
      product_count = product_count + ?,
      image_count = MAX(image_count + ?, 0),
      updated_at = ?
    WHERE id = ?
  `).bind(productDelta, imageDelta, now, teamId).run();

  // gas-proxy側KVに同期データを書き込み（AI判定自動連携）
  if (env.SYNC_CACHE) {
    try {
      await writeSyncData(env, managedId, teamId, session, now);
    } catch (e) {
      console.error(`[upload] SYNC_CACHE write failed: ${e.message}`);
    }
  }

  await env.CACHE.delete(`team:${teamId}:product-list-cache`);

  return jsonOk({ managedId, urls, count: urls.length });
}

/**
 * gas-proxy側KVに撮影データを書き込み（AI判定自動連携）
 * - photo-meta:{managedId} — 撮影者・撮影日
 * - photo-meta:pending — 待機リスト
 * - product-images:{managedId} — 画像URL配列（R2パス）
 * - product-images:index — managedIdリスト
 */
async function writeSyncData(env, managedId, teamId, session, now) {
  const d = new Date(now);
  const todayStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  // photo-meta
  await env.SYNC_CACHE.put(`photo-meta:${managedId}`, JSON.stringify({
    photographer: session.displayName || session.userId || '',
    photographyDate: todayStr,
    uploadedAt: now,
  }));

  // pending リストに追加
  const pendingJson = await env.SYNC_CACHE.get('photo-meta:pending');
  const pending = pendingJson ? JSON.parse(pendingJson) : [];
  if (!pending.includes(managedId)) {
    pending.push(managedId);
    await env.SYNC_CACHE.put('photo-meta:pending', JSON.stringify(pending));
  }

  // product-images（gas-proxy側のキー形式で保存）
  const tasukiKey = `team:${teamId}:product-images:${managedId}`;
  const urlsJson = await env.CACHE.get(tasukiKey);
  if (urlsJson) {
    await env.SYNC_CACHE.put(`product-images:${managedId}`, urlsJson);
  }

  // product-images:index
  const indexJson = await env.SYNC_CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];
  if (!index.includes(managedId)) {
    index.push(managedId);
    index.sort();
    await env.SYNC_CACHE.put('product-images:index', JSON.stringify(index));
  }

  console.log(`[upload] Synced to gas-proxy KV: ${managedId}`);
}

/**
 * 画像並び替え
 */
export async function reorder(request, env, session) {
  const body = await request.json();
  const { teamId, newOrder } = body;
  const managedId = normalizeManagedId(body.managedId || '');

  if (!teamId) return jsonError('teamIdは必須です。', 400);
  if (!managedId) return jsonError('管理番号が必要です。', 400);
  if (!Array.isArray(newOrder) || newOrder.length === 0) return jsonError('新しい順序が必要です。', 400);

  const membership = await verifyMembership(env, teamId, session.userId);
  if (!membership) return jsonError('このチームのメンバーではありません。', 403);

  const kvKey = `team:${teamId}:product-images:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  // バリデーション
  for (const url of newOrder) {
    if (!urls.includes(url)) return jsonError('指定された画像はこの商品に属しません。', 400);
  }
  if (new Set(newOrder).size !== newOrder.length) return jsonError('重複したURLがあります。', 400);
  if (newOrder.length !== urls.length) return jsonError('画像数が一致しません。', 400);

  await env.CACHE.put(kvKey, JSON.stringify(newOrder));

  return jsonOk({ managedId, urls: newOrder });
}

/**
 * R2画像配信（セッション認証 ?token= 方式）
 */
export async function serveImage(request, env, url) {
  const pathname = url.pathname;
  // パスからteamIdを抽出: /images/teams/{teamId}/products/...
  const match = pathname.match(/^\/images\/teams\/([^/]+)\/products\//);
  if (!match) return new Response('Not Found', { status: 404 });

  const teamId = match[1];

  // パストラバーサル防止
  if (pathname.includes('..') || pathname.includes('%2e%2e') || pathname.includes('%2E%2E')) {
    return new Response('Bad Request', { status: 400 });
  }

  // トークン認証（img srcにAuthヘッダーを付けられないため）
  const token = url.searchParams.get('token');
  if (!token) return new Response('Unauthorized', { status: 401 });

  // ワンタイムトークン（tmp:で始まる、5分有効、外部共有用）
  const tmpData = await env.SESSIONS.get(`tmp:${token}`, 'json');
  if (tmpData) {
    // ワンタイムトークンはパスを限定して検証
    if (tmpData.teamId !== teamId) return new Response('Forbidden', { status: 403 });
    // 使い捨て: 削除しない（TTLで自動期限切れ）
  } else {
    // 通常セッショントークン
    const sessionData = await env.SESSIONS.get(`session:${token}`, 'json');
    if (!sessionData) return new Response('Unauthorized', { status: 401 });
    const membership = await verifyMembership(env, teamId, sessionData.userId);
    if (!membership) return new Response('Forbidden', { status: 403 });
  }

  // R2からオブジェクト取得
  const r2Key = pathname.replace(/^\/images\//, '');
  const object = await env.IMAGES.get(r2Key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');

  if (object.etag) headers.set('ETag', object.etag);

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && object.etag && ifNoneMatch === object.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

// ─── ヘルパー ───

async function addToIndex(env, teamId, managedId) {
  const indexKey = `team:${teamId}:product-images:index`;
  const indexJson = await env.CACHE.get(indexKey);
  const index = indexJson ? JSON.parse(indexJson) : [];
  if (!index.includes(managedId)) {
    index.push(managedId);
    index.sort();
    await env.CACHE.put(indexKey, JSON.stringify(index));
  }
}

export async function removeFromIndex(env, teamId, managedId) {
  const indexKey = `team:${teamId}:product-images:index`;
  const indexJson = await env.CACHE.get(indexKey);
  if (!indexJson) return;
  const index = JSON.parse(indexJson).filter(id => id !== managedId);
  await env.CACHE.put(indexKey, JSON.stringify(index));
}
