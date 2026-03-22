/**
 * 商品画像アップロードAPI
 *
 * エンドポイント:
 *   POST /upload/auth           — パスワード認証→トークン発行
 *   POST /upload/images         — 画像アップロード（最大10枚、action=append で追加モード対応）
 *   POST /upload/update-image   — 指定画像の上書き（1枚差し替え）
 *   POST /upload/reorder        — 画像並び替え（KV配列の順序変更）
 *   POST /upload/list           — アップロード済み商品一覧（サムネイル付き）
 *   POST /upload/list-all       — 全商品の全画像URL一括取得
 *   POST /upload/product-images — 指定商品の画像URL一覧
 *   POST /upload/delete         — 商品画像の全削除
 *   POST /upload/delete-single  — 個別画像の削除（targetUrl or imageIndex）
 *
 * 認証: Authorization: Bearer {token} → KV upload-token:{token}
 * R2パス: products/{managedId}/{uuid}.jpg（UUID v4）
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
    case '/upload/update-image':
      return await handleUpdateImage(request, env);
    case '/upload/reorder':
      return await handleReorder(request, env);
    case '/upload/list-all':
      return await handleListAll(request, env);
    case '/upload/unmatched':
      return await handleUnmatched(request, env);
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

  // 管理番号存在チェック（商品管理シートのF列、KV経由）
  let managedIdRegistered = false;
  const idsJson = await env.CACHE.get('managed-ids:list');
  if (idsJson) {
    const ids = JSON.parse(idsJson);
    managedIdRegistered = ids.includes(managedId.toUpperCase());
  }

  // action判定: append=追加モード, new=新規（デフォルト）
  const action = formData.get('action') || 'new';

  // ファイル取得
  const files = formData.getAll('images');
  if (!files || files.length === 0) {
    return jsonError('画像ファイルが必要です', 400);
  }
  if (files.length > MAX_IMAGES) {
    return jsonError(`画像は最大${MAX_IMAGES}枚までです`, 400);
  }

  // appendモード: 既存画像との合計枚数チェック
  let existingUrls = [];
  if (action === 'append') {
    const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
    existingUrls = urlsJson ? JSON.parse(urlsJson) : [];
    if (existingUrls.length + files.length > MAX_IMAGES) {
      return jsonError(`あと${MAX_IMAGES - existingUrls.length}枚まで追加可能です（現在${existingUrls.length}枚）`, 400);
    }
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

  // R2に並列PUT（UUID v4でファイル名生成）
  const uploadPromises = files.map(async (file) => {
    const uuid = crypto.randomUUID();
    const key = `products/${managedId}/${uuid}.jpg`;
    const arrayBuffer = await file.arrayBuffer();
    await env.IMAGES.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return `/images/products/${managedId}/${uuid}.jpg`;
  });

  const newUrls = await Promise.all(uploadPromises);
  const urls = action === 'append' ? [...existingUrls, ...newUrls] : newUrls;

  // KVインデックス更新（商品単位）
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));

  // 商品一覧インデックスに追加
  await addToIndex(env, managedId);

  // 商品キャッシュ無効化（フロントに即反映）
  await invalidateProductCache(env);

  // 撮影メタデータ保存（KV）
  const photographer = formData.get('photographer') || '';
  const overwritePhotographer = formData.get('overwritePhotographer') === 'true';
  const now = new Date();
  const todayStr = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
  const photographyDate = formData.get('photographyDate')
    ? formData.get('photographyDate').replace(/-/g, '/')
    : todayStr;

  // 既存メタデータを確認（初回撮影者を保持）
  const existingMetaJson = await env.CACHE.get(`photo-meta:${managedId}`);
  let meta;
  if (existingMetaJson && !overwritePhotographer) {
    // 既存メタがあり上書きフラグなし → 初回撮影者を保持
    const existingMeta = JSON.parse(existingMetaJson);
    meta = {
      photographer: existingMeta.photographer || photographer,
      photographyDate: existingMeta.photographyDate || photographyDate,
      uploadedAt: existingMeta.uploadedAt || now.toISOString(),
    };
  } else {
    // 新規 or 上書きフラグあり
    meta = {
      photographer,
      photographyDate,
      uploadedAt: now.toISOString(),
    };
  }
  await env.CACHE.put(`photo-meta:${managedId}`, JSON.stringify(meta));

  // 未同期リストに追加（商品管理に登録済みの場合のみ）
  if (managedIdRegistered) {
    const pendingJson = await env.CACHE.get('photo-meta:pending');
    const pending = pendingJson ? JSON.parse(pendingJson) : [];
    if (!pending.includes(managedId)) {
      pending.push(managedId);
      await env.CACHE.put('photo-meta:pending', JSON.stringify(pending));
    }
  }

  return jsonOk({ managedId, urls, count: urls.length, registered: managedIdRegistered });
}

// ─── 商品一覧 ───

async function handleList(request, env) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];

  const idsJson = await env.CACHE.get('managed-ids:list');
  const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

  // 各商品の1枚目URL＋警告フラグを取得（0枚の商品は自動クリーンアップ）
  const cleanupIds = [];
  const items = (await Promise.all(
    index.map(async (managedId) => {
      const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      if (urls.length === 0) {
        cleanupIds.push(managedId);
        return null;
      }
      let warning = false;
      if (!registeredIds.has(managedId)) {
        const metaJson = await env.CACHE.get(`photo-meta:${managedId}`);
        const meta = metaJson ? JSON.parse(metaJson) : {};
        if (meta.uploadedAt) {
          const days = Math.floor((Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24));
          warning = days >= 7;
        }
      }
      return {
        managedId,
        thumbnail: urls[0] || null,
        count: urls.length,
        registered: registeredIds.has(managedId),
        warning,
      };
    })
  )).filter(Boolean);

  // 0枚の商品をインデックスから自動削除
  if (cleanupIds.length > 0) {
    for (const id of cleanupIds) {
      await removeFromIndex(env, id);
      await env.CACHE.delete(`product-images:${id}`);
      await env.CACHE.delete(`photo-meta:${id}`);
    }
  }

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
  // クエリ文字列を除去してR2キーを構築
  const cleanPath = path.split('?')[0];
  const r2Key = cleanPath.replace(/^\/images\//, '');

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
  if (!managedId) return jsonError('管理番号が必要です', 400);

  // UUID方式: targetUrl でURLを指定
  const targetUrl = body.targetUrl || '';
  // 旧方式互換: imageIndex でも受け付ける
  const imageIndex = parseInt(body.imageIndex, 10);

  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  let urls = urlsJson ? JSON.parse(urlsJson) : [];

  let urlToDelete = '';
  if (targetUrl) {
    // URL直接指定
    if (!urls.includes(targetUrl)) return jsonError('指定された画像はこの商品に属しません', 400);
    urlToDelete = targetUrl;
  } else if (!isNaN(imageIndex) && imageIndex >= 1 && imageIndex <= MAX_IMAGES) {
    // 旧方式: 番号指定（後方互換）
    const legacyUrl = `/images/products/${managedId}/${imageIndex}.jpg`;
    if (urls.includes(legacyUrl)) {
      urlToDelete = legacyUrl;
    } else {
      return jsonError('指定された画像が見つかりません', 400);
    }
  } else {
    return jsonError('削除対象の画像を指定してください（targetUrl または imageIndex）', 400);
  }

  // R2から削除
  const r2Key = urlToDelete.replace(/^\/images\//, '');
  await env.IMAGES.delete(r2Key);

  // KV更新
  urls = urls.filter(u => u !== urlToDelete);
  if (urls.length === 0) {
    await env.CACHE.delete(`product-images:${managedId}`);
    await removeFromIndex(env, managedId);
  } else {
    await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  }

  await invalidateProductCache(env);
  return jsonOk({ managedId, deleted: urlToDelete, remaining: urls.length });
}

// ─── 指定画像の上書き ───

async function handleUpdateImage(request, env) {
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
  if (!managedId) return jsonError('管理番号が必要です', 400);

  const targetUrl = formData.get('targetUrl') || '';
  if (!targetUrl) return jsonError('対象画像URLが必要です', 400);

  // URL所有権チェック
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  const targetIndex = urls.indexOf(targetUrl);
  if (targetIndex === -1) return jsonError('指定された画像はこの商品に属しません', 400);

  const files = formData.getAll('images');
  if (!files || files.length !== 1) return jsonError('画像ファイルを1枚指定してください', 400);
  const file = files[0];
  if (!(file instanceof File)) return jsonError('不正なファイルです', 400);
  if (file.size > MAX_FILE_SIZE) return jsonError(`ファイルサイズが大きすぎます（最大${MAX_FILE_SIZE / 1024 / 1024}MB）`, 400);

  // 古いR2ファイルを削除
  const oldR2Key = targetUrl.replace(/^\/images\//, '');
  await env.IMAGES.delete(oldR2Key);

  // 新UUIDで保存
  const uuid = crypto.randomUUID();
  const newKey = `products/${managedId}/${uuid}.jpg`;
  const arrayBuffer = await file.arrayBuffer();
  await env.IMAGES.put(newKey, arrayBuffer, {
    httpMetadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const newUrl = `/images/products/${managedId}/${uuid}.jpg`;
  urls[targetIndex] = newUrl;
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  await invalidateProductCache(env);

  return jsonOk({ managedId, oldUrl: targetUrl, newUrl, urls });
}

// ─── 画像並び替え ───

async function handleReorder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) return jsonError('管理番号が必要です', 400);

  const newOrder = body.newOrder;
  if (!Array.isArray(newOrder) || newOrder.length === 0) {
    return jsonError('新しい順序が必要です', 400);
  }

  // 既存URL取得
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  // バリデーション: URLホワイトリスト + 所有権チェック
  const urlPattern = /^\/images\/products\/[A-Z0-9\-]+\/[a-f0-9\-]+\.jpg$/;
  for (const url of newOrder) {
    if (!urlPattern.test(url) && !/^\/images\/products\/[A-Z0-9\-]+\/\d+\.jpg$/.test(url)) {
      return jsonError('不正なURL形式です', 400);
    }
    if (!urls.includes(url)) {
      return jsonError('指定された画像はこの商品に属しません', 400);
    }
  }

  // 重複チェック
  if (new Set(newOrder).size !== newOrder.length) {
    return jsonError('重複したURLがあります', 400);
  }

  // 数の一致チェック
  if (newOrder.length !== urls.length) {
    return jsonError('画像数が一致しません', 400);
  }

  // KV更新
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(newOrder));
  await invalidateProductCache(env);

  return jsonOk({ managedId, urls: newOrder });
}

// ─── 全商品の全画像URL一括取得 ───

async function handleListAll(request, env) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];

  const items = await Promise.all(
    index.map(async (managedId) => {
      const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      return { managedId, urls, count: urls.length };
    })
  );

  return jsonOk({ items });
}

// ─── 未マッチ画像一覧（商品管理に未登録の画像） ───

async function handleUnmatched(request, env) {
  const indexJson = await env.CACHE.get('product-images:index');
  const index = indexJson ? JSON.parse(indexJson) : [];

  const idsJson = await env.CACHE.get('managed-ids:list');
  const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

  const unmatched = [];
  for (const managedId of index) {
    if (!registeredIds.has(managedId)) {
      const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      const metaJson = await env.CACHE.get(`photo-meta:${managedId}`);
      const meta = metaJson ? JSON.parse(metaJson) : {};
      const daysSinceUpload = meta.uploadedAt
        ? Math.floor((Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      unmatched.push({
        managedId,
        thumbnail: urls[0] || null,
        count: urls.length,
        photographer: meta.photographer || '',
        uploadedAt: meta.uploadedAt || '',
        daysSinceUpload,
        warning: daysSinceUpload !== null && daysSinceUpload >= 7,
      });
    }
  }

  return jsonOk({ items: unmatched, total: unmatched.length });
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
