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
const TOKEN_TTL = 7 * 24 * 60 * 60; // 7日

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

  switch (path) {
    case '/upload/images':
      return await handleImageUpload(request, env);
    case '/upload/replace':
      return await handleReplace(request, env);
    case '/upload/list':
      return await handleList(request, env);
    case '/upload/product-images':
      return await handleProductImages(request, env);
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

  return jsonOk({ managedId, urls, count: urls.length });
}

// ─── 1枚目上書き ───

async function handleReplace(request, env) {
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

  const file = formData.get('image');
  if (!(file instanceof File)) {
    return jsonError('画像ファイルが必要です', 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return jsonError(`ファイルサイズが大きすぎます（最大${MAX_FILE_SIZE / 1024 / 1024}MB）`, 400);
  }

  // 1枚目を上書き
  const key = `products/${managedId}/1.jpg`;
  const arrayBuffer = await file.arrayBuffer();
  await env.IMAGES.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return jsonOk({ managedId, url: `/images/products/${managedId}/1.jpg` });
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

// ─── ヘルパー ───

async function addToIndex(env, managedId) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];
  if (!index.includes(managedId)) {
    index.push(managedId);
    index.sort();
    await env.CACHE.put('product-images:index', JSON.stringify(index));
  }
}
