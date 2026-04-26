import { corsOptions, jsonOk, jsonError } from './utils/response.js';
import { getAccessUser } from './utils/access.js';
import { scheduledSync } from './sync/sheets-sync.js';
import { scheduledAccessSync } from './sync/access-sync.js';
import { listProducts, getProduct, listProductCounts } from './handlers/products.js';
import { listPurchases, getPurchaseProducts } from './handlers/purchases.js';
import { saveMeasurement, saveSale, saveDetails, createPurchase, createProduct } from './handlers/write-proxy.js';
import { listWorkers, listAccounts } from './handlers/master.js';

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

    // 新規作成（GAS プロキシ）
    if (path === '/api/create/purchase' && request.method === 'POST') {
      return createPurchase(request, env, user);
    }
    if (path === '/api/create/product' && request.method === 'POST') {
      return createProduct(request, env, user);
    }

    return jsonError('not found', 404);
  },
};
