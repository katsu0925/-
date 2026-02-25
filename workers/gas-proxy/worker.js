/**
 * Cloudflare Worker: GAS APIプロキシ＆エッジキャッシュ
 *
 * デタウリ・アソート両ページの商品データをCloudflareエッジにキャッシュし、
 * GASのコールドスタート（1-2秒）を回避する。
 *
 * ── 仕組み ──
 * 1. フロントエンドからのリクエストを受ける
 * 2. Cloudflare Cache APIでキャッシュを確認
 * 3. キャッシュヒット → 即座に返す（50-100ms）
 * 4. キャッシュミス → GAS APIにプロキシ → レスポンスをキャッシュして返す
 *
 * ── キャッシュ対象アクション ──
 * - apiGetCachedProducts（デタウリ商品データ）: 5分キャッシュ
 * - apiBulkInit（アソート商品データ）: 5分キャッシュ
 * - その他: キャッシュせずそのままプロキシ
 *
 * ── デプロイ手順 ──
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. cd workers/gas-proxy
 * 4. wrangler deploy
 *
 * ── トラブルシューティング ──
 * - キャッシュを手動パージ: Worker URLに ?purge=1 をつけてGET
 * - ログ確認: wrangler tail
 * - Worker無効化: wrangler delete（フロントは自動でGAS直接に切替）
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg/exec';

// キャッシュ対象アクションとTTL（秒）
const CACHE_CONFIG = {
  apiGetCachedProducts: 300, // 5分
  apiBulkInit: 300,          // 5分
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // キャッシュ手動パージ
    if (url.searchParams.get('purge') === '1') {
      const cache = caches.default;
      const keys = Object.keys(CACHE_CONFIG);
      for (const action of keys) {
        const cacheKey = new Request(url.origin + '/cache/' + action);
        await cache.delete(cacheKey);
      }
      return corsResponse(new Response(JSON.stringify({ ok: true, message: 'Cache purged', actions: keys }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ヘルスチェック
    if (request.method === 'GET' && url.pathname === '/') {
      return corsResponse(new Response(JSON.stringify({ ok: true, status: 'running', cached_actions: Object.keys(CACHE_CONFIG) }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    // POST以外は拒否
    if (request.method !== 'POST') {
      return corsResponse(new Response(JSON.stringify({ ok: false, message: 'POST only' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    try {
      // リクエストボディをパース
      const bodyText = await request.text();
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        parsed = {};
      }

      const action = parsed.action || '';
      const ttl = CACHE_CONFIG[action];

      // キャッシュ対象外 → そのままプロキシ
      if (!ttl) {
        return await proxyToGas(bodyText);
      }

      // キャッシュ対象 → Cache API確認
      const cache = caches.default;
      const cacheKey = new Request(url.origin + '/cache/' + action);

      const cached = await cache.match(cacheKey);
      if (cached) {
        // キャッシュヒット
        const resp = new Response(cached.body, cached);
        resp.headers.set('X-Cache', 'HIT');
        return corsResponse(resp);
      }

      // キャッシュミス → GASから取得
      const gasResp = await proxyToGas(bodyText);

      if (gasResp.ok) {
        // レスポンスをクローンしてキャッシュ保存
        const respBody = await gasResp.text();
        const cacheResp = new Response(respBody, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 's-maxage=' + ttl,
            'X-Cache': 'MISS',
            'X-Cached-At': new Date().toISOString(),
          },
        });

        // バックグラウンドでキャッシュ保存（レスポンスを遅延させない）
        ctx.waitUntil(cache.put(cacheKey, cacheResp.clone()));

        return corsResponse(cacheResp);
      }

      // GASエラー → そのまま返す
      return corsResponse(gasResp);

    } catch (e) {
      return corsResponse(new Response(JSON.stringify({ ok: false, message: 'Proxy error: ' + e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  },
};

async function proxyToGas(bodyText) {
  const resp = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: bodyText,
    redirect: 'follow',
  });

  // GASのレスポンスを読み取り
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Cache': 'MISS',
    },
  });
}

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
