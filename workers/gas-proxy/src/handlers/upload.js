/**
 * 商品画像アップロードAPI
 *
 * エンドポイント:
 *   POST /upload/auth           — パスワード認証→トークン発行
 *   POST /upload/images         — 画像アップロード（最大10枚）
 *   POST /upload/replace        — 1枚目上書き
 *   POST /upload/list           — アップロード済み商品一覧
 *   POST /upload/product-images — 指定商品の画像URL一覧
 *
 * 認証: Authorization: Bearer {token} → KV upload-token:{token}
 * R2パス: products/{managedId}/1.jpg 〜 10.jpg
 * KV: product-images:{managedId} → URL配列, product-images:index → managedIdリスト
 */

import { jsonOk, jsonError, corsResponse } from '../utils/response.js';

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const TOKEN_TTL = 90 * 24 * 60 * 60; // 90日(3ヶ月)

/**
 * 管理番号の正規化: 全角→半角、小文字→大文字
 * データ1シートの管理番号と確実にマッチさせるため
 */
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
 * /upload/* ルーター
 */
export async function handleUpload(request, env, path) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonError('POST only', 405);
  }

  // 認証エンドポイントはトークン不要
  if (path === '/upload/auth') {
    return await handleAuth(request, env);
  }

  // それ以外はトークン認証必須
  const token = extractToken(request);
  if (!token) {
    return jsonError('認証が必要です', 401);
  }
  const valid = await env.CACHE.get(`upload-token:${token}`);
  if (!valid) {
    return jsonError('トークンが無効または期限切れです', 401);
  }

  // トークンTTL自動更新（アクセスごとに30日延長）
  await env.CACHE.put(`upload-token:${token}`, '1', { expirationTtl: TOKEN_TTL });

  switch (path) {
    case '/upload/images':
      return await handleImageUpload(request, env);
    case '/upload/list':
      return await handleList(request, env);
    case '/upload/product-images':
      return await handleProductImages(request, env);
    case '/upload/delete':
      return await handleDelete(request, env);
    case '/upload/delete-single':
      return await handleDeleteSingle(request, env);
    case '/upload/workers':
      return await handleWorkers(request, env);
    default:
      return jsonError('不明なエンドポイント', 404);
  }
}

// ─── 認証 ───

async function handleAuth(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const password = body.password || '';
  if (!password || password !== env.UPLOAD_PASSWORD) {
    return jsonError('パスワードが違います', 403);
  }

  // トークン生成（ランダム32バイト hex）
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');

  // KVに保存（expirationTtlで自動期限切れ）
  await env.CACHE.put(`upload-token:${token}`, '1', { expirationTtl: TOKEN_TTL });

  return jsonOk({ token });
}

function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

// ─── 画像アップロード ───

async function handleImageUpload(request, env) {
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

  const managedId = normalizeManagedId(formData.get('managedId') || '');
  if (!managedId) {
    return jsonError('管理番号が必要です', 400);
  }

  // ファイル取得
  const files = formData.getAll('images');
  if (!files || files.length === 0) {
    return jsonError('画像ファイルが必要です', 400);
  }
  if (files.length > MAX_IMAGES) {
    return jsonError(`画像は最大${MAX_IMAGES}枚までです`, 400);
  }

  // バリデーション
  for (const file of files) {
    if (!(file instanceof File)) {
      return jsonError('不正なファイルです', 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return jsonError(`ファイルサイズが大きすぎます（最大${MAX_FILE_SIZE / 1024 / 1024}MB）`, 400);
    }
  }

  // R2に並列PUT
  const uploadPromises = files.map(async (file, index) => {
    const num = index + 1;
    const key = `products/${managedId}/${num}.jpg`;
    const arrayBuffer = await file.arrayBuffer();
    await env.IMAGES.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return `/images/products/${managedId}/${num}.jpg`;
  });

  const urls = await Promise.all(uploadPromises);

  // KVインデックス更新（商品単位）
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));

  // 商品一覧インデックスに追加
  await addToIndex(env, managedId);

  // 商品キャッシュ無効化（フロントに即反映）
  await invalidateProductCache(env);

  // 撮影メタデータ保存（KV）— 常に保存（フロントから未送信でもデフォルト値で保存）
  const photographer = formData.get('photographer') || '';
  const now = new Date();
  const todayStr = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
  const photographyDate = formData.get('photographyDate')
    ? formData.get('photographyDate').replace(/-/g, '/')
    : todayStr;
  const meta = {
    photographer,
    photographyDate,
    uploadedAt: now.toISOString(),
  };
  await env.CACHE.put(`photo-meta:${managedId}`, JSON.stringify(meta));

  // 未同期リストに追加
  const pendingJson = await env.CACHE.get('photo-meta:pending');
  const pending = pendingJson ? JSON.parse(pendingJson) : [];
  if (!pending.includes(managedId)) {
    pending.push(managedId);
    await env.CACHE.put('photo-meta:pending', JSON.stringify(pending));
  }

  return jsonOk({ managedId, urls, count: urls.length });
}

// ─── 商品一覧 ───

async function handleList(request, env) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];

  // 各商品の1枚目URLを取得
  const items = await Promise.all(
    index.map(async (managedId) => {
      const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      return {
        managedId,
        thumbnail: urls[0] || null,
        count: urls.length,
      };
    })
  );

  return jsonOk({ items });
}

// ─── 指定商品の画像URL一覧 ───

async function handleProductImages(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) {
    return jsonError('管理番号が必要です', 400);
  }

  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  return jsonOk({ managedId, urls });
}

// ─── R2画像配信 ───

export async function serveImage(request, env, path) {
  // path: /images/products/{managedId}/{n}.jpg
  const r2Key = path.replace(/^\/images\//, '');

  const object = await env.IMAGES.get(r2Key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');

  // ETag
  if (object.etag) {
    headers.set('ETag', object.etag);
  }

  // 304 Not Modified
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && object.etag && ifNoneMatch === object.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

// ─── 商品画像の全削除 ───

async function handleDelete(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) {
    return jsonError('管理番号が必要です', 400);
  }

  // KVから画像URL一覧を取得
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  // R2から全画像を削除
  const deletePromises = urls.map((url) => {
    const r2Key = url.replace(/^\/images\//, '');
    return env.IMAGES.delete(r2Key);
  });
  await Promise.all(deletePromises);

  // KVインデックスから削除
  await env.CACHE.delete(`product-images:${managedId}`);
  await removeFromIndex(env, managedId);

  await invalidateProductCache(env);

  return jsonOk({ managedId, deleted: urls.length });
}

// ─── 個別画像の削除 ───

async function handleDeleteSingle(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  const imageIndex = parseInt(body.imageIndex, 10); // 1-based index
  if (!managedId) {
    return jsonError('管理番号が必要です', 400);
  }
  if (isNaN(imageIndex) || imageIndex < 1 || imageIndex > MAX_IMAGES) {
    return jsonError('画像番号が不正です（1〜10）', 400);
  }

  // R2から削除
  const r2Key = `products/${managedId}/${imageIndex}.jpg`;
  await env.IMAGES.delete(r2Key);

  // KVの画像URL一覧を更新
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  let urls = urlsJson ? JSON.parse(urlsJson) : [];
  const targetUrl = `/images/products/${managedId}/${imageIndex}.jpg`;
  urls = urls.filter(u => u !== targetUrl);

  if (urls.length === 0) {
    // 全画像が削除された場合はインデックスからも除去
    await env.CACHE.delete(`product-images:${managedId}`);
    await removeFromIndex(env, managedId);
  } else {
    await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  }

  await invalidateProductCache(env);

  return jsonOk({ managedId, imageIndex, remaining: urls.length });
}

// ─── 作業者リスト取得 ───

async function handleWorkers(request, env) {
  const workersJson = await env.CACHE.get('workers:list');
  const workers = workersJson ? JSON.parse(workersJson) : [];
  return jsonOk({ workers });
}

// ─── ヘルパー ───

/**
 * 商品キャッシュを無効化（次のAPIリクエストでD1+R2画像から再構築される）
 */
async function invalidateProductCache(env) {
  await env.CACHE.delete('products:detauri');
  await env.CACHE.delete('products:version');
}

async function addToIndex(env, managedId) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];
  if (!index.includes(managedId)) {
    index.push(managedId);
    index.sort();
    await env.CACHE.put('product-images:index', JSON.stringify(index));
  }
}

async function removeFromIndex(env, managedId) {
  const indexJson = await env.CACHE.get('product-images:index');
  if (!indexJson) return;
  const index = JSON.parse(indexJson).filter(id => id !== managedId);
  await env.CACHE.put('product-images:index', JSON.stringify(index));
}
