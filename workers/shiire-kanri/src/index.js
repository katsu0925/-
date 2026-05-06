import { corsOptions, jsonOk, jsonError } from './utils/response.js';
import { getAccessUser } from './utils/access.js';
import { scheduledSync } from './sync/sheets-sync.js';
import { scheduledAccessSync } from './sync/access-sync.js';
import { listProducts, getProduct, listProductCounts, getNextKanri, listProductThumbs, getProductImages } from './handlers/products.js';
import { listPurchases, getPurchaseProducts } from './handlers/purchases.js';
import { saveMeasurement, saveSale, saveDetails, uploadImage, resolveImage, createPurchase, createProduct } from './handlers/write-proxy.js';
import { imgProxy } from './handlers/img-proxy.js';
import { thumbProxy } from './handlers/thumb-proxy.js';
import { listWorkers, listAccounts, listSuppliers, listPlaces, listCategories, listSettings } from './handlers/master.js';
import { lookupAiPrefill, lookupAiPrefillBatch } from './handlers/ai.js';
import { listMoves, createMove, listReturns, createReturn, listAiResults, listSagyousha, saveSagyousha, createSagyousha, dumpSheet, getListingText, appendKeihi, uploadKeihiImage, updateShiireHoukokuQuantity } from './handlers/extras.js';
import { getSalesSummary } from './handlers/sales.js';
import { syncRowWebhook } from './handlers/sync-webhook.js';

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

    // /sw.js, /, /index.html, /app.js, /sw-update.js, /mockup-*, /test-* のキャッシュヘッダは
    // pages/_headers で集約管理（ETag/304 ベースの再検証は ASSETS が自動処理）。
    // ここでハンドラを持たないことで条件付き GET（If-None-Match → 304）が透過的に通る。

    // 手動同期トリガー（共通シークレット必須・運用デバッグ用）
    if (path === '/admin/sync' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      ctx.waitUntil(scheduledSync(env));
      return jsonOk({ triggered: true });
    }

    // GAS onEdit/onChange トリガーからの行単位 UPSERT（即時反映）
    // X-Sync-Secret 必須・Cloudflare Access バイパス
    if (path === '/api/sync/row' && request.method === 'POST') {
      return syncRowWebhook(request, env);
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
      return listProductCounts(request, env, ctx);
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
      return saveDetails(request, env, user, ctx);
    }
    if (path === '/api/save/image' && request.method === 'POST') {
      return uploadImage(request, env, user);
    }
    if (path === '/api/image/resolve' && request.method === 'POST') {
      return resolveImage(request, env, user);
    }

    // Drive thumbnail プロキシ（CF Edge Cache 24h で 2回目以降 ~50ms）
    if (path === '/api/img' && request.method === 'GET') {
      return imgProxy(request, env, ctx);
    }
    // R2 (タスキ箱由来) サムネ動的リサイズプロキシ（Wasm + caches.default 24h）
    // 一覧 22 件で原本 3.8MB → 130KB に削減。詳細表示(原本)は wholesale.nkonline-tool.com 直
    if (path === '/api/thumb' && request.method === 'GET') {
      return thumbProxy(request, env, ctx);
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
    // GAS appendRow は数秒かかるので ctx.waitUntil で fire-and-forget。
    if (path === '/api/keihi/submit' && request.method === 'POST') {
      return appendKeihi(request, env, user, ctx);
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
    return env.ASSETS.fetch(request);
  },
};
