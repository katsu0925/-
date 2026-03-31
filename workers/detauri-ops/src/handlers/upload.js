/**
 * 画像アップロードAPI
 *
 * R2パス: products/{managedId}/{photoIndex}_{uuid}.jpg
 * KV: product-photos:{managedId} → URL配列
 */
import { jsonOk, jsonError } from '../utils/response.js';
import { LIMITS } from '../config.js';

const MAX_FILE_SIZE = LIMITS.photoUploadSizeMB * 1024 * 1024;

/**
 * 画像アップロード（1枚ずつ or 複数枚）
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

  const managedId = (formData.get('managedId') || '').trim();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  // 商品の所有権チェック
  const product = await env.DB.prepare(
    'SELECT id, batch_id, assigned_to, has_photos FROM products WHERE managed_id = ?'
  ).bind(managedId).first();
  if (!product) return jsonError('商品が見つかりません。', 404);

  const files = formData.getAll('images');
  if (!files || files.length === 0) {
    return jsonError('画像ファイルが必要です。', 400);
  }

  // 既存画像取得
  const kvKey = `product-photos:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  const existingUrls = urlsJson ? JSON.parse(urlsJson) : [];

  // 枚数チェック（最大10枚）
  if (existingUrls.length + files.length > LIMITS.maxPhotosPerItem) {
    return jsonError(`あと${LIMITS.maxPhotosPerItem - existingUrls.length}枚まで追加可能です（現在${existingUrls.length}枚）。`, 400);
  }

  // バリデーション
  for (const file of files) {
    if (!(file instanceof File)) return jsonError('不正なファイルです。', 400);
    if (file.size > MAX_FILE_SIZE) return jsonError('ファイルサイズが大きすぎます（最大10MB）。', 400);
  }

  // R2に並列アップロード
  const startIndex = existingUrls.length;
  const uploadPromises = files.map(async (file, i) => {
    const uuid = crypto.randomUUID();
    const photoIndex = startIndex + i;
    const key = `products/${managedId}/${photoIndex}_${uuid}.jpg`;
    const arrayBuffer = await file.arrayBuffer();
    await env.IMAGES.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type || 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return `/images/products/${managedId}/${photoIndex}_${uuid}.jpg`;
  });

  const newUrls = await Promise.all(uploadPromises);
  const allUrls = [...existingUrls, ...newUrls];

  // KV更新
  await env.CACHE.put(kvKey, JSON.stringify(allUrls));

  // D1更新
  const now = new Date().toISOString();
  const hasPhotos = allUrls.length >= LIMITS.minPhotosPerItem ? 1 : 0;
  await env.DB.prepare(`
    UPDATE products SET
      has_photos = ?,
      photographed_at = CASE WHEN photographed_at IS NULL THEN ? ELSE photographed_at END,
      photographed_by = CASE WHEN photographed_by IS NULL THEN ? ELSE photographed_by END,
      updated_at = ?
    WHERE id = ?
  `).bind(hasPhotos, now, session.displayName, now, product.id).run();

  return jsonOk({ managedId, urls: allUrls, count: allUrls.length });
}

/**
 * 画像削除（1枚）
 */
export async function deletePhoto(request, env, session) {
  const { managedId, photoUrl } = await request.json();
  if (!managedId || !photoUrl) return jsonError('管理番号と画像URLが必要です。', 400);

  // R2から削除
  const r2Key = photoUrl.replace(/^\/images\//, '');
  await env.IMAGES.delete(r2Key);

  // KV更新
  const kvKey = `product-photos:${managedId}`;
  const urlsJson = await env.CACHE.get(kvKey);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];
  const filtered = urls.filter(u => u !== photoUrl);
  await env.CACHE.put(kvKey, JSON.stringify(filtered));

  // D1更新
  const hasPhotos = filtered.length >= LIMITS.minPhotosPerItem ? 1 : 0;
  await env.DB.prepare(
    'UPDATE products SET has_photos = ?, updated_at = ? WHERE managed_id = ?'
  ).bind(hasPhotos, new Date().toISOString(), managedId).run();

  return jsonOk({ managedId, urls: filtered, count: filtered.length });
}

/**
 * R2画像配信
 */
export async function serveImage(request, env, path) {
  const key = path.replace(/^\/images\//, '');

  // パストラバーサル防止
  if (key.includes('..') || key.startsWith('/')) {
    return new Response('Not Found', { status: 404 });
  }

  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': obj.httpMetadata?.cacheControl || 'public, max-age=86400',
    },
  });
}
