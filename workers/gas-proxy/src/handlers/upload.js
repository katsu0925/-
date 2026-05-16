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
 *   POST /upload/delete         — 商品画像の全削除（ソフトデリート: 7日間は復元可能）
 *   POST /upload/delete-single  — 個別画像の削除（ソフトデリート: 7日間は復元可能）
 *   POST /upload/restore        — ソフトデリートした商品の復元
 *   POST /upload/restore-image  — ソフトデリートした個別画像の復元
 *   POST /upload/deleted-list   — 最近削除した商品・画像の一覧（復元候補）
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
    case '/upload/restore':
      return await handleRestore(request, env);
    case '/upload/restore-image':
      return await handleRestoreImage(request, env);
    case '/upload/deleted-list':
      return await handleDeletedList(request, env);
    case '/upload/update-image':
      return await handleUpdateImage(request, env);
    case '/upload/revert-image':
      return await handleRevertImage(request, env);
    case '/upload/reorder':
      return await handleReorder(request, env);
    case '/upload/list-all':
      return await handleListAll(request, env);
    case '/upload/unmatched':
      return await handleUnmatched(request, env);
    case '/upload/workers':
      return await handleWorkers(request, env);
    case '/upload/save-log':
      return await handleSaveLog(request, env);
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

  // shiire-kanri 一覧の即時サムネ用に thumb_url を直接書き戻す
  await syncThumbToShiire(env, managedId, urls);

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
  // 新しい画像がアップされたので同期済みフラグはリセット（再同期対象に戻す）
  meta.synced = false;
  meta.aiSynced = false;
  await env.CACHE.put(`photo-meta:${managedId}`, JSON.stringify(meta));

  // 未同期リストに追加（未登録でも AI判定先行のため pending 入り）
  // 商品管理シートへの photographer/photographyDate 書込みは syncPhotographyData 側で
  // registeredIds でフィルタするので、未登録 ID が紛れ込んでも安全
  const pendingJson = await env.CACHE.get('photo-meta:pending');
  const pending = pendingJson ? JSON.parse(pendingJson) : [];
  if (!pending.includes(managedId)) {
    pending.push(managedId);
    await env.CACHE.put('photo-meta:pending', JSON.stringify(pending));
  }

  await invalidateListCache(env);
  return jsonOk({ managedId, urls, count: urls.length, registered: managedIdRegistered });
}

// ─── 商品一覧 ───

async function handleList(request, env) {
  const t0 = Date.now();
  // キャッシュ済みリストがあれば即返却
  const cached = await env.CACHE.get('product-list-cache');
  if (cached) {
    return jsonOk({ items: JSON.parse(cached) }, { 'Server-Timing': `cache;dur=${Date.now()-t0};desc="hit"` });
  }

  const tBuild = Date.now();
  const items = await buildProductList(env);
  const buildDur = Date.now() - tBuild;
  // キャッシュ保存（30日TTL — write側で invalidateListCache が呼ばれるので、それまでは保持）
  await env.CACHE.put('product-list-cache', JSON.stringify(items), { expirationTtl: 86400 * 30 });
  return jsonOk({ items }, { 'Server-Timing': `cache;dur=0;desc="miss", build;dur=${buildDur}, total;dur=${Date.now()-t0}` });
}

async function buildProductList(env) {
  // QW1: 2つのKV読みを並列化
  const [indexJson, idsJson] = await Promise.all([
    env.CACHE.get('product-images:index'),
    env.CACHE.get('managed-ids:list'),
  ]);
  const index = indexJson ? JSON.parse(indexJson) : [];
  const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

  const cleanupIds = [];
  const items = [];
  // QW1: 並列度をチャンクで制限してメモリ128MB制限を回避（旧: 全件 Promise.all で落ちる）
  const CHUNK = 50;
  for (let i = 0; i < index.length; i += CHUNK) {
    const chunkResults = await Promise.all(index.slice(i, i + CHUNK).map(async (managedId) => {
      const [urlsJson, metaJson, saveLogJson] = await Promise.all([
        env.CACHE.get(`product-images:${managedId}`),
        env.CACHE.get(`photo-meta:${managedId}`),
        env.CACHE.get(`save-log:${managedId}`),
      ]);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      if (urls.length === 0) {
        cleanupIds.push(managedId);
        return null;
      }
      const meta = metaJson ? JSON.parse(metaJson) : {};
      const saveLog = saveLogJson ? JSON.parse(saveLogJson) : { count: 0 };

      let warning = false;
      if (!registeredIds.has(managedId) && meta.uploadedAt) {
        const days = Math.floor((Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24));
        warning = days >= 7;
      }

      return {
        managedId,
        thumbnail: urls[0] || null,
        secondThumbnail: urls[1] || null,
        count: urls.length,
        registered: registeredIds.has(managedId),
        warning,
        uploadedAt: meta.uploadedAt || '',
        photographer: meta.photographer || '',
        saveCount: saveLog.count,
      };
    }));
    for (const r of chunkResults) if (r) items.push(r);
  }

  // QW1: クリーンアップを並列化（各IDの3操作 × 全ID並列）
  if (cleanupIds.length > 0) {
    await Promise.all(cleanupIds.map(id => Promise.all([
      removeFromIndex(env, id),
      env.CACHE.delete(`product-images:${id}`),
      env.CACHE.delete(`photo-meta:${id}`),
    ])));
  }

  return items;
}

function invalidateListCache(env) {
  return env.CACHE.delete('product-list-cache');
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

  const t0 = Date.now();
  // QW1: 3つのKV読み + backupリストを並列化
  const backupPrefix = `image-backup:${managedId}:`;
  const [urlsJson, metaJson, saveLogJson, backupList] = await Promise.all([
    env.CACHE.get(`product-images:${managedId}`),
    env.CACHE.get(`photo-meta:${managedId}`),
    env.CACHE.get(`save-log:${managedId}`),
    env.CACHE.list({ prefix: backupPrefix }).catch(() => ({ keys: [] })),
  ]);
  const kvDur = Date.now() - t0;
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  const meta = metaJson ? JSON.parse(metaJson) : {};
  const saveLog = saveLogJson ? JSON.parse(saveLogJson) : { count: 0, users: [] };

  const backupUrls = [];
  for (const entry of backupList.keys) {
    const url = entry.name.slice(backupPrefix.length);
    if (urls.includes(url)) backupUrls.push(url);
  }

  return jsonOk({ managedId, urls, meta, saveLog, backupUrls }, { 'Server-Timing': `kv;dur=${kvDur}, total;dur=${Date.now()-t0}` });
}

// ─── R2画像配信 ───

export async function serveImage(request, env, path) {
  // クエリ文字列を除去してR2キーを構築
  const cleanPath = path.split('?')[0];
  // パーセントエンコードされた日本語等をR2キー(生UTF-8)に戻す
  let r2Key = cleanPath.replace(/^\/images\//, '');
  try { r2Key = decodeURIComponent(r2Key); } catch {}

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

// ─── 商品画像の全削除（ソフトデリート） ───

// 削除した商品を復元可能な状態で保持する日数。
// この期間を過ぎたものは Cron（sheets-sync.js）が R2画像ごと実削除する。
const SOFT_DELETE_RETENTION_DAYS = 7;

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

  // 削除前の確認強化: 管理番号の再入力（confirm）が一致しないと実行しない（誤操作防止）
  if (normalizeManagedId(body.confirm || '') !== managedId) {
    return jsonError('確認のため管理番号をもう一度入力してください', 400);
  }

  // KVから画像URL一覧を取得
  const [urlsJson, metaJson, saveLogJson] = await Promise.all([
    env.CACHE.get(`product-images:${managedId}`),
    env.CACHE.get(`photo-meta:${managedId}`),
    env.CACHE.get(`save-log:${managedId}`),
  ]);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  if (urls.length === 0) {
    return jsonError('対象の商品が見つかりません', 404);
  }

  // ソフトデリート: R2画像は消さず deleted-product:{id} へ退避する（誤削除の復元用）。
  // 実体の R2画像と image-backup KV はそのまま残し、保持期間経過後に Cron が purge する。
  const now = Date.now();
  const trash = {
    managedId,
    urls,
    meta: metaJson ? JSON.parse(metaJson) : null,
    saveLog: saveLogJson ? JSON.parse(saveLogJson) : null,
    deletedAt: new Date(now).toISOString(),
    deletedBy: (body.userName || '').trim() || '不明',
    purgeAt: now + SOFT_DELETE_RETENTION_DAYS * 86400 * 1000,
  };
  // KV 自体は「保持期間 + 7日」のバックストップ TTL（Cron purge が失敗しても自然消滅）
  await env.CACHE.put(`deleted-product:${managedId}`, JSON.stringify(trash), {
    expirationTtl: (SOFT_DELETE_RETENTION_DAYS + 7) * 86400,
  });

  // 一覧からは即座に外す（R2画像とバックアップは保持期間中は残す）
  await env.CACHE.delete(`product-images:${managedId}`);
  await removeFromIndex(env, managedId);
  await syncThumbToShiire(env, managedId, []);

  await invalidateProductCache(env);
  await invalidateListCache(env);

  return jsonOk({
    managedId,
    softDeleted: true,
    count: urls.length,
    deletedAt: trash.deletedAt,
    retentionDays: SOFT_DELETE_RETENTION_DAYS,
  });
}

// ─── ソフトデリートした商品の復元 ───

async function handleRestore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) return jsonError('管理番号が必要です', 400);

  const trashJson = await env.CACHE.get(`deleted-product:${managedId}`);
  if (!trashJson) {
    return jsonError('復元データが見つかりません（保持期間切れの可能性）', 404);
  }
  const trash = JSON.parse(trashJson);

  // R2実体が残っているURLだけを復元対象にする
  const existing = [];
  for (const url of trash.urls || []) {
    const r2Key = url.replace(/^\/images\//, '');
    const head = await env.IMAGES.head(r2Key);
    if (head) existing.push(url);
  }
  if (existing.length === 0) {
    return jsonError('画像の実体が既に削除されています（復元不可）', 410);
  }

  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(existing));
  await addToIndex(env, managedId);
  await syncThumbToShiire(env, managedId, existing);
  await env.CACHE.delete(`deleted-product:${managedId}`);

  await invalidateProductCache(env);
  await invalidateListCache(env);

  return jsonOk({
    managedId,
    restored: existing.length,
    missing: (trash.urls || []).length - existing.length,
  });
}

// ─── 最近削除した商品・画像の一覧（復元候補） ───

async function handleDeletedList(request, env) {
  const items = [];

  // 商品まるごと削除（deleted-product:）
  const prodList = await env.CACHE.list({ prefix: 'deleted-product:' }).catch(() => ({ keys: [] }));
  for (const entry of prodList.keys) {
    const json = await env.CACHE.get(entry.name);
    if (!json) continue;
    const t = JSON.parse(json);
    const daysLeft = Math.max(0, Math.ceil((t.purgeAt - Date.now()) / 86400000));
    items.push({
      type: 'product',
      managedId: entry.name.slice('deleted-product:'.length),
      thumbnail: (t.urls && t.urls[0]) || null,
      count: (t.urls || []).length,
      deletedAt: t.deletedAt || '',
      deletedBy: t.deletedBy || '不明',
      daysLeft,
    });
  }

  // 個別画像の削除・上書き旧版（deleted-image:）
  const imgList = await env.CACHE.list({ prefix: 'deleted-image:' }).catch(() => ({ keys: [] }));
  for (const entry of imgList.keys) {
    const json = await env.CACHE.get(entry.name);
    if (!json) continue;
    const t = JSON.parse(json);
    const daysLeft = Math.max(0, Math.ceil((t.purgeAt - Date.now()) / 86400000));
    items.push({
      type: 'image',
      managedId: t.managedId || '',
      url: t.url || '',
      thumbnail: t.url || null,
      count: 1,
      deletedAt: t.deletedAt || '',
      deletedBy: t.deletedBy || '不明',
      daysLeft,
    });
  }

  // 削除日時の新しい順
  items.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));

  return jsonOk({ items });
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

  // ソフトデリート: R2実体は消さず deleted-image:{id}:{fileId} へ退避（7日間は復元可能）
  const position = urls.indexOf(urlToDelete);
  const fileId = urlToDelete.split('/').pop().replace(/\.jpg$/i, '');
  const now = Date.now();
  await env.CACHE.put(
    `deleted-image:${managedId}:${fileId}`,
    JSON.stringify({
      managedId,
      url: urlToDelete,
      position,
      deletedAt: new Date(now).toISOString(),
      deletedBy: (body.userName || '').trim() || '不明',
      purgeAt: now + SOFT_DELETE_RETENTION_DAYS * 86400 * 1000,
    }),
    { expirationTtl: (SOFT_DELETE_RETENTION_DAYS + 7) * 86400 }
  );

  // KV更新（一覧からは即座に外す。R2実体は保持期間中は残し、Cron が purge する）
  urls = urls.filter(u => u !== urlToDelete);
  if (urls.length === 0) {
    await env.CACHE.delete(`product-images:${managedId}`);
    await removeFromIndex(env, managedId);
  } else {
    await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  }
  await syncThumbToShiire(env, managedId, urls);

  await invalidateProductCache(env);
  await invalidateListCache(env);
  return jsonOk({ managedId, deleted: urlToDelete, remaining: urls.length, softDeleted: true });
}

// ─── ソフトデリートした個別画像の復元 ───

async function handleRestoreImage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) return jsonError('管理番号が必要です', 400);
  const url = body.url || '';
  if (!url) return jsonError('復元対象の画像URLが必要です', 400);

  const fileId = url.split('/').pop().replace(/\.jpg$/i, '');
  const stashKey = `deleted-image:${managedId}:${fileId}`;
  const stashJson = await env.CACHE.get(stashKey);
  if (!stashJson) {
    return jsonError('復元データが見つかりません（保持期間切れの可能性）', 404);
  }
  const stash = JSON.parse(stashJson);

  // R2実体が残っているか確認
  const r2Key = url.replace(/^\/images\//, '');
  const head = await env.IMAGES.head(r2Key);
  if (!head) {
    await env.CACHE.delete(stashKey);
    return jsonError('画像の実体が既に削除されています（復元不可）', 410);
  }

  // product-images に元の位置で挿入（重複は除く）
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  if (!urls.includes(url)) {
    let pos = typeof stash.position === 'number' ? stash.position : urls.length;
    if (pos < 0 || pos > urls.length) pos = urls.length;
    urls.splice(pos, 0, url);
  }
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  await addToIndex(env, managedId);
  await syncThumbToShiire(env, managedId, urls);
  await env.CACHE.delete(stashKey);

  await invalidateProductCache(env);
  await invalidateListCache(env);

  return jsonOk({ managedId, restored: url, count: urls.length });
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

  // 新UUIDで保存（古いR2ファイルは元に戻す用に残す）
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
  // 先頭画像が置換された場合に備えて thumb_url を同期
  if (targetIndex === 0) await syncThumbToShiire(env, managedId, urls);

  // バックアップ：newUrl → targetUrl を保持（直前に戻す「元に戻す」用）
  await env.CACHE.put(
    `image-backup:${managedId}:${newUrl}`,
    targetUrl,
    { expirationTtl: SOFT_DELETE_RETENTION_DAYS * 86400 }
  );

  // 上書きで外れた旧版も deleted-image: へ退避（「最近削除した商品・画像」から復元可能。
  // 保持期間後に Cron が R2 を purge するので孤立画像も残さない）
  const oldFileId = targetUrl.split('/').pop().replace(/\.jpg$/i, '');
  const nowTs = Date.now();
  await env.CACHE.put(
    `deleted-image:${managedId}:${oldFileId}`,
    JSON.stringify({
      managedId,
      url: targetUrl,
      position: targetIndex,
      deletedAt: new Date(nowTs).toISOString(),
      deletedBy: '画像上書き',
      purgeAt: nowTs + SOFT_DELETE_RETENTION_DAYS * 86400 * 1000,
    }),
    { expirationTtl: (SOFT_DELETE_RETENTION_DAYS + 7) * 86400 }
  );

  await invalidateProductCache(env);
  await invalidateListCache(env);

  return jsonOk({ managedId, oldUrl: targetUrl, newUrl, urls, backupAvailable: true });
}

// ─── 画像の元に戻す（置換前に復元） ───

async function handleRevertImage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  if (!managedId) return jsonError('管理番号が必要です', 400);
  const currentUrl = body.currentUrl || '';
  if (!currentUrl) return jsonError('対象画像URLが必要です', 400);

  const backupKey = `image-backup:${managedId}:${currentUrl}`;
  const oldUrl = await env.CACHE.get(backupKey);
  if (!oldUrl) return jsonError('バックアップが見つかりません（期限切れの可能性）', 404);

  const oldR2Key = oldUrl.replace(/^\/images\//, '');
  const oldObj = await env.IMAGES.head(oldR2Key);
  if (!oldObj) {
    await env.CACHE.delete(backupKey);
    return jsonError('元画像が既に削除されています', 404);
  }

  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  const idx = urls.indexOf(currentUrl);
  if (idx === -1) return jsonError('対象画像が見つかりません', 404);

  urls[idx] = oldUrl;
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(urls));
  if (idx === 0) await syncThumbToShiire(env, managedId, urls);

  // 旧版が現役に復帰したので deleted-image: 退避を解除（Cron による誤 purge を防ぐ）
  const revertedFileId = oldUrl.split('/').pop().replace(/\.jpg$/i, '');
  await env.CACHE.delete(`deleted-image:${managedId}:${revertedFileId}`);

  // 現在（置換後）のR2画像を削除
  const currentR2Key = currentUrl.replace(/^\/images\//, '');
  await env.IMAGES.delete(currentR2Key);

  await env.CACHE.delete(backupKey);
  await invalidateProductCache(env);
  await invalidateListCache(env);

  return jsonOk({ managedId, oldUrl: currentUrl, newUrl: oldUrl, urls });
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
  await syncThumbToShiire(env, managedId, newOrder);
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
  // QW1: index と registeredIds を並列取得
  const [indexJson, idsJson] = await Promise.all([
    env.CACHE.get('product-images:index'),
    env.CACHE.get('managed-ids:list'),
  ]);
  const index = indexJson ? JSON.parse(indexJson) : [];
  const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

  // QW1: 未マッチIDをまとめて並列KV読み
  const targetIds = index.filter(id => !registeredIds.has(id));
  const unmatched = (await Promise.all(
    targetIds.map(async (managedId) => {
      const [urlsJson, metaJson] = await Promise.all([
        env.CACHE.get(`product-images:${managedId}`),
        env.CACHE.get(`photo-meta:${managedId}`),
      ]);
      const urls = urlsJson ? JSON.parse(urlsJson) : [];
      const meta = metaJson ? JSON.parse(metaJson) : {};
      const daysSinceUpload = meta.uploadedAt
        ? Math.floor((Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        managedId,
        thumbnail: urls[0] || null,
        secondThumbnail: urls[1] || null,
        count: urls.length,
        photographer: meta.photographer || '',
        uploadedAt: meta.uploadedAt || '',
        daysSinceUpload,
        warning: daysSinceUpload !== null && daysSinceUpload >= 7,
      };
    })
  ));

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

// D1 product_image_index を真実値として保持し、KV product-images:index は再構築結果を書き込む。
// 旧来の KV read-modify-write は並行アップロードで競合し orphan を生んでいたため
// （ZY73/ZY74 等が index 不在で AI判定を取りこぼす事象が発生）、INSERT/DELETE を D1 で atomic 化した。
async function rebuildImageIndexKv(env) {
  const { results } = await env.DB.prepare(
    'SELECT managed_id FROM product_image_index ORDER BY managed_id'
  ).all();
  const ids = (results || []).map(r => r.managed_id);
  await env.CACHE.put('product-images:index', JSON.stringify(ids));
}

async function addToIndex(env, managedId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO product_image_index (managed_id, created_at) VALUES (?, ?)'
  ).bind(managedId, now).run();
  await rebuildImageIndexKv(env);
}

async function removeFromIndex(env, managedId) {
  await env.DB.prepare(
    'DELETE FROM product_image_index WHERE managed_id = ?'
  ).bind(managedId).run();
  await rebuildImageIndexKv(env);
}

// shiire-kanri-db.products.thumb_url を直接書き換える（一覧の即時サムネ用）。
// managedId は uppercase で来るが、shiire-kanri 側 kanri は sheets 由来の混在ケース
// （例: zk1000 / zY125）。upper(kanri) = ? で一致させる。
// D1 課金ガード: 既に同値なら UPDATE しない。
async function syncThumbToShiire(env, managedId, urls) {
  if (!env.SHIIRE_DB || !managedId) return;
  const newThumb = (Array.isArray(urls) && urls.length > 0 && urls[0]) ? String(urls[0]) : null;
  try {
    const cur = await env.SHIIRE_DB
      .prepare('SELECT kanri, thumb_url FROM products WHERE upper(kanri) = ?')
      .bind(managedId)
      .first();
    if (!cur) return; // shiire-kanri 側にまだ行が無い（次の Cron で UPSERT される）
    if ((cur.thumb_url || null) === (newThumb || null)) return;
    await env.SHIIRE_DB
      .prepare('UPDATE products SET thumb_url = ? WHERE kanri = ?')
      .bind(newThumb, cur.kanri)
      .run();
  } catch (err) {
    console.warn(`[upload] shiire thumb_url update failed (${managedId}): ${err.message}`);
  }
}

// ─── 保存ログ記録 ───

async function handleSaveLog(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('不正なリクエスト', 400);
  }

  const managedId = normalizeManagedId(body.managedId || '');
  const userName = (body.userName || '').trim();
  if (!managedId) return jsonError('管理番号が必要です', 400);

  const kvKey = `save-log:${managedId}`;
  const existing = await env.CACHE.get(kvKey);
  const log = existing ? JSON.parse(existing) : { count: 0, users: [] };

  log.count++;
  log.users.push({
    displayName: userName || '不明',
    savedAt: new Date().toISOString(),
  });

  // 最新100件のみ保持
  if (log.users.length > 100) {
    log.users = log.users.slice(-100);
  }

  await env.CACHE.put(kvKey, JSON.stringify(log));
  await invalidateListCache(env);

  return jsonOk({ count: log.count });
}
