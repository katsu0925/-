import { corsOptions, jsonOk, jsonError } from './utils/response.js';
import { getAccessUser } from './utils/access.js';
import { scheduledSync } from './sync/sheets-sync.js';
import { scheduledAccessSync } from './sync/access-sync.js';
import { listProducts, getProduct, listProductCounts, getNextKanri } from './handlers/products.js';
import { listPurchases, getPurchaseProducts } from './handlers/purchases.js';
import { saveMeasurement, saveSale, saveDetails, uploadImage, resolveImage, createPurchase, createProduct } from './handlers/write-proxy.js';
import { listWorkers, listAccounts, listSuppliers, listPlaces, listCategories, listSettings } from './handlers/master.js';
import { lookupAiPrefill, lookupAiPrefillBatch } from './handlers/ai.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledSync(env));
    ctx.waitUntil(scheduledAccessSync(env));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsOptions();

    const url = new URL(request.url);
    const path = url.pathname;

    // ヘルスチェック（認証不要）
    if (path === '/health') {
      return jsonOk({ status: 'ok', ts: Date.now() });
    }

    // ルート/index.html はキャッシュさせず常に最新の SPA を返す
    // run_worker_first により先に Worker に到達 → ASSETS から fetch → no-store で返却
    // ASSETS は /index.html → / に正規化（307）するため、最初から / で fetch する
    if ((path === '/' || path === '/index.html') && request.method === 'GET') {
      const rootUrl = new URL('/', request.url);
      // ASSETS の自己ループを避けるためマーカー付きでフェッチ
      const assetReq = new Request(rootUrl.toString(), { method: 'GET', headers: request.headers });
      let assetResponse = await env.ASSETS.fetch(assetReq);
      // それでもリダイレクトされる場合は最終ターゲットを取得
      if (assetResponse.status >= 300 && assetResponse.status < 400) {
        const loc = assetResponse.headers.get('Location') || '/';
        const followUrl = new URL(loc, request.url);
        assetResponse = await env.ASSETS.fetch(new Request(followUrl.toString(), { method: 'GET', headers: request.headers }));
      }
      const headers = new Headers(assetResponse.headers);
      headers.set('Cache-Control', 'no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }

    // 手動同期トリガー（共通シークレット必須・運用デバッグ用）
    if (path === '/admin/sync' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      ctx.waitUntil(scheduledSync(env));
      return jsonOk({ triggered: true });
    }

    // Access ポリシー手動同期（運用デバッグ用）
    if (path === '/admin/sync-access' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      const result = await scheduledAccessSync(env);
      return jsonOk(result);
    }

    // Cloudflare Access JWT 検証
    const user = await getAccessUser(request, env);
    if (!user) return jsonError('unauthorized', 403);

    if (path === '/api/me') {
      return jsonOk({ user: { email: user.email } });
    }

    // 読み取り
    if (path === '/api/products' && request.method === 'GET') {
      return listProducts(request, env);
    }
    if (path === '/api/products/counts' && request.method === 'GET') {
      return listProductCounts(request, env);
    }
    if (path === '/api/kanri/next' && request.method === 'GET') {
      return getNextKanri(request, env);
    }
    const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
    if (productMatch && request.method === 'GET') {
      return getProduct(request, env, decodeURIComponent(productMatch[1]));
    }

    // マスター（作業者・使用アカウント）
    if (path === '/api/master/workers' && request.method === 'GET') {
      return listWorkers(request, env);
    }
    if (path === '/api/master/accounts' && request.method === 'GET') {
      return listAccounts(request, env);
    }
    if (path === '/api/master/suppliers' && request.method === 'GET') {
      return listSuppliers(request, env);
    }
    if (path === '/api/master/places' && request.method === 'GET') {
      return listPlaces(request, env);
    }
    if (path === '/api/master/categories' && request.method === 'GET') {
      return listCategories(request, env);
    }
    if (path === '/api/master/settings' && request.method === 'GET') {
      return listSettings(request, env);
    }

    // AI画像判定（管理番号 → ブランド/タグ表記/性別/カテゴリ1-3/デザイン特徴/カラー/ポケット）
    if (path === '/api/ai/prefill' && request.method === 'GET') {
      return lookupAiPrefill(request, env);
    }
    if (path === '/api/ai/prefill/batch' && request.method === 'POST') {
      return lookupAiPrefillBatch(request, env);
    }

    if (path === '/api/purchases' && request.method === 'GET') {
      return listPurchases(request, env);
    }
    const purchaseProductsMatch = path.match(/^\/api\/purchases\/([^/]+)\/products$/);
    if (purchaseProductsMatch && request.method === 'GET') {
      return getPurchaseProducts(request, env, decodeURIComponent(purchaseProductsMatch[1]));
    }

    // 書き込み（GAS プロキシ）
    if (path === '/api/save/measurement' && request.method === 'POST') {
      return saveMeasurement(request, env, user);
    }
    if (path === '/api/save/sale' && request.method === 'POST') {
      return saveSale(request, env, user);
    }
    if (path === '/api/save/details' && request.method === 'POST') {
      return saveDetails(request, env, user);
    }
    if (path === '/api/save/image' && request.method === 'POST') {
      return uploadImage(request, env, user);
    }
    if (path === '/api/image/resolve' && request.method === 'POST') {
      return resolveImage(request, env, user);
    }

    // 新規作成（GAS プロキシ）
    if (path === '/api/create/purchase' && request.method === 'POST') {
      return createPurchase(request, env, user);
    }
    if (path === '/api/create/product' && request.method === 'POST') {
      return createProduct(request, env, user);
    }

    // API/admin 以外は静的アセット（SPA fallback 含む）に委譲
    if (path.startsWith('/api/') || path.startsWith('/admin/')) {
      return jsonError('not found', 404);
    }
    return env.ASSETS.fetch(request);
  },
};
