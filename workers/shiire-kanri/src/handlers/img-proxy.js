// GET /api/img?id=FILE_ID&sz=w200
// Google Drive の thumbnail エンドポイントを Workers 経由でプロキシ。
// 用途: 発送タブ等のサムネ表示。Drive 直 URL は CDN を通らず 1〜3秒/枚かかるが、
//       caches.default にキャッシュすれば 2回目以降は CF Edge から ~50ms で返る。
//
// キャッシュ戦略:
//   - caches.default: 24h (cross-user, cross-session)
//   - Cache-Control: public, max-age=86400, immutable (ブラウザ/CDN 両方)
//   - キー: id+sz の組み合わせ（リクエスト URL の認証クッキーは無視）
//
// セキュリティ:
//   - id は英数字 + ハイフン + アンダースコアのみ許可（Drive ID 形式）
//   - sz は w100〜w2000 のみ許可
//   - その他のパラメータは無視

const ALLOWED_SIZES = new Set([
  'w100', 'w120', 'w160', 'w200', 'w240', 'w320', 'w400',
  'w500', 'w600', 'w800', 'w1000', 'w1200', 'w1600', 'w2000',
]);

export async function imgProxy(request, env, ctx) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const sz = url.searchParams.get('sz') || 'w500';

  if (!/^[\w-]{20,}$/.test(id)) {
    return new Response('bad id', { status: 400 });
  }
  if (!ALLOWED_SIZES.has(sz)) {
    return new Response('bad sz', { status: 400 });
  }

  const cacheKey = new Request(`https://shiire-kanri-img.local/${id}?sz=${sz}`, {
    method: 'GET',
  });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const driveUrl = `https://drive.google.com/thumbnail?id=${id}&sz=${sz}`;
  const upstream = await fetch(driveUrl, {
    cf: { cacheTtl: 86400, cacheEverything: true },
    redirect: 'follow',
  });

  if (!upstream.ok) {
    return new Response('drive error', { status: upstream.status });
  }

  const ct = upstream.headers.get('Content-Type') || 'image/jpeg';
  // Drive がエラー HTML を返すケース（権限不足/削除済）を弾く
  if (!ct.startsWith('image/')) {
    return new Response('not an image', { status: 502 });
  }

  const buf = await upstream.arrayBuffer();
  const res = new Response(buf, {
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  } else {
    await cache.put(cacheKey, res.clone());
  }
  return res;
}
