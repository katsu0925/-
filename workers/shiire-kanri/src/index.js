import { corsOptions, jsonOk, jsonError } from './utils/response.js';
import { getAccessUser } from './utils/access.js';
import { scheduledSync } from './sync/sheets-sync.js';
import { scheduledAccessSync } from './sync/access-sync.js';
import { listProducts, getProduct, listProductCounts, getNextKanri, listProductThumbs, getProductImages } from './handlers/products.js';
import { listPurchases, getPurchaseProducts } from './handlers/purchases.js';
import { saveMeasurement, saveSale, saveDetails, uploadImage, resolveImage, createPurchase, createProduct } from './handlers/write-proxy.js';
import { listWorkers, listAccounts, listSuppliers, listPlaces, listCategories, listSettings } from './handlers/master.js';
import { lookupAiPrefill, lookupAiPrefillBatch } from './handlers/ai.js';
import { listMoves, createMove, listReturns, createReturn, listAiResults, listSagyousha, saveSagyousha, createSagyousha, dumpSheet, getListingText, appendKeihi, uploadKeihiImage, updateShiireHoukokuQuantity } from './handlers/extras.js';
import { getSalesSummary } from './handlers/sales.js';

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

    // PWA 用 Service Worker は no-store で配信（更新を確実に拾う）
    // Service-Worker-Allowed を付けてスコープを / に明示
    if (path === '/sw.js' && request.method === 'GET') {
      const r = await env.ASSETS.fetch(request);
      const h = new Headers(r.headers);
      h.set('Cache-Control', 'no-store, must-revalidate');
      h.set('Service-Worker-Allowed', '/');
      h.set('Content-Type', 'application/javascript; charset=utf-8');
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
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
    if (path === '/api/products/thumbs' && request.method === 'POST') {
      return listProductThumbs(request, env);
    }
    if (path === '/api/kanri/next' && request.method === 'GET') {
      return getNextKanri(request, env);
    }
    const productImagesMatch = path.match(/^\/api\/products\/([^/]+)\/images$/);
    if (productImagesMatch && request.method === 'GET') {
      return getProductImages(request, env, decodeURIComponent(productImagesMatch[1]));
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

    // 場所移動
    if (path === '/api/moves' && request.method === 'GET') {
      return listMoves(request, env, user);
    }
    if (path === '/api/moves' && request.method === 'POST') {
      return createMove(request, env, user);
    }

    // 返送管理
    if (path === '/api/returns' && request.method === 'GET') {
      return listReturns(request, env, user);
    }
    if (path === '/api/returns' && request.method === 'POST') {
      return createReturn(request, env, user);
    }

    // AI画像判定一覧
    if (path === '/api/ai/list' && request.method === 'GET') {
      return listAiResults(request, env, user);
    }

    // 作業者管理
    if (path === '/api/sagyousha' && request.method === 'GET') {
      return listSagyousha(request, env, user);
    }
    if (path === '/api/sagyousha' && request.method === 'POST') {
      return saveSagyousha(request, env, user);
    }
    if (path === '/api/sagyousha/create' && request.method === 'POST') {
      return createSagyousha(request, env, user);
    }

    // 売上ダッシュボード（今月/前月/通年/月別内訳）
    if (path === '/api/sales/summary' && request.method === 'GET') {
      return getSalesSummary(request, env);
    }

    // 経費申請: 本人申請を受けてシートに行追加（通知メールは onChange トリガーが発火）
    if (path === '/api/keihi/submit' && request.method === 'POST') {
      return appendKeihi(request, env, user);
    }
    // 経費申請レシート画像アップロード（kanri 不要 / 経費_Images フォルダに保存）
    if (path === '/api/keihi/image' && request.method === 'POST') {
      return uploadKeihiImage(request, env, user);
    }

    // 仕入れ数報告: 本人の未処理行に数量を入力 → 処理済み TRUE 化（Phase2 マージは GAS 側で実行）
    if (path === '/api/shiire-houkoku/quantity' && request.method === 'POST') {
      return updateShiireHoukokuQuantity(request, env, user);
    }

    // フリマ用タイトル・説明文取得（GAS doGet を ?fmt=json でプロキシ）
    const listingTextMatch = path.match(/^\/api\/listing-text\/([^/]+)$/);
    if (listingTextMatch && request.method === 'GET') {
      return getListingText(request, env, user, decodeURIComponent(listingTextMatch[1]));
    }

    // 業務メニュー（汎用シートダンプ: 仕入れ数報告/経費申請/報酬管理）
    const sheetMatch = path.match(/^\/api\/sheet\/([^/]+)$/);
    if (sheetMatch && request.method === 'GET') {
      return dumpSheet(request, env, user, decodeURIComponent(sheetMatch[1]));
    }

    // API/admin 以外は静的アセット（SPA fallback 含む）に委譲
    if (path.startsWith('/api/') || path.startsWith('/admin/')) {
      return jsonError('not found', 404);
    }
    // mockup-* / test-* はキャッシュ無効で常に最新を返す（デザイン検証用）
    if (path.startsWith('/mockup') || path.startsWith('/test-')) {
      const r = await env.ASSETS.fetch(request);
      const h = new Headers(r.headers);
      h.set('Cache-Control', 'no-store, must-revalidate');
      h.set('Pragma', 'no-cache');
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }
    return env.ASSETS.fetch(request);
  },
};
