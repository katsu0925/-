import { corsOptions, jsonOk, jsonError } from './utils/response.js';
import { getAccessUser } from './utils/access.js';
import { withIdempotency } from './utils/idempotency.js';
import { scheduledSync } from './sync/sheets-sync.js';
import { scheduledAccessSync, debugAccessConfig } from './sync/access-sync.js';
import { listProducts, getProduct, listProductCounts, getNextKanri, getNextKanriForPurchase, listProductThumbs, getProductImages, listKanrisWithImages, backfillThumbUrl } from './handlers/products.js';
import { listPurchases, getPurchaseProducts } from './handlers/purchases.js';
import { saveMeasurement, saveSale, saveDetails, uploadImage, resolveImage, createPurchase, createProduct, deleteProduct, retrySaveFailures } from './handlers/write-proxy.js';
import { imgProxy } from './handlers/img-proxy.js';
import { thumbProxy } from './handlers/thumb-proxy.js';
import { listWorkers, listAccounts, listSuppliers, listPlaces, listCategories, listSettings } from './handlers/master.js';
import { lookupAiPrefill, lookupAiPrefillBatch } from './handlers/ai.js';
import { listMoves, createMove, deleteMove, updateMove, listReturns, createReturn, deleteReturn, updateReturn, deletePurchase, previewFixPurchaseQuantity, fixPurchaseQuantity, listAiResults, listSagyousha, warmSagyoushaCache, saveSagyousha, createSagyousha, dumpSheet, warmSheetDumpCache, getListingText, appendKeihi, uploadKeihiImage, updateShiireHoukokuQuantity } from './handlers/extras.js';
import { getSalesSummary } from './handlers/sales.js';
import { syncRowWebhook } from './handlers/sync-webhook.js';
import { listBundles, toggleBundle } from './handlers/bundles.js';
import { getVapidPublicKey, subscribePush, unsubscribePush, getPushPrefs, setPushPrefs, testPush } from './handlers/push.js';
import {
  invoiceMe, listMyInvoices, getInvoiceDetail, listMyAvailableMonths,
  calcInvoicePreview, getInvoiceProfile, saveInvoiceProfile,
  createInvoice, updateManualItems, downloadInvoicePdf, requestInvoiceRevision, listMyRevisions,
  adminListInvoices, adminListRevisions, adminUpdateRevision, adminUpdateInvoiceStatus,
  adminUpdateManualItems, adminRecalcInvoice,
  adminGetGraceRates, adminSaveGraceRates, adminGetSettings, adminSaveSettings,
} from './handlers/invoice.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledSync(env));
    ctx.waitUntil(scheduledAccessSync(env));
    // ②保存耐久性: GAS reconcile に失敗して savefail に積まれた保存を再投入して確定させる
    ctx.waitUntil(retrySaveFailures(env));
    // 仕入れ数報告タブの一覧を先回りで KV に温める（初回表示の GAS 往復 2〜4秒を消す）
    ctx.waitUntil(warmSheetDumpCache(env));
    // 作業者マスターも先回りで温める（GAS 実測 20〜90 秒 = アプリの 25 秒タイムアウト超え）。
    // 期限内なら中で早期 return するので、5 分ごとに GAS を叩くわけではない。
    ctx.waitUntil(warmSagyoushaCache(env));
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

    // Access 設定の読み取り専用ダンプ（アプリ単位/全ポリシー/グローバルの session_duration 切り分け用）
    if (path === '/admin/access-debug' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      const result = await debugAccessConfig(env);
      return jsonOk(result);
    }

    // thumb_url 一括バックフィル（Phase 2-A 初回専用・運用デバッグ用）
    if (path === '/admin/backfill-thumb-url' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      return backfillThumbUrl(request, env);
    }

    // listing-text KV invalidate（gas-proxy の AI同期完了通知用）
    // AIキーワード抽出シートに新規キーワードが書き込まれた直後、対象 kanri の
    // listing-text:xxx KV を強制削除し、次回詳細閲覧で最新タイトルが再生成されるようにする。
    // 認可: X-Sync-Secret ヘッダ（既存 /admin/sync と共通）
    if (path === '/admin/invalidate-listing-text' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret') || '';
      if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);
      let body = {};
      try { body = await request.json(); } catch {}
      const ids = Array.isArray(body && body.kanriIds) ? body.kanriIds : [];
      if (!ids.length) return jsonOk({ invalidated: 0 });
      const kv = env.CACHE;
      if (!kv) return jsonOk({ invalidated: 0, note: 'no CACHE binding' });
      const dels = ids
        .map(k => String(k || '').trim())
        .filter(Boolean)
        .map(k => kv.delete('listing-text:' + k).catch(() => {}));
      await Promise.all(dels);
      return jsonOk({ invalidated: dels.length });
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
    if (path === '/api/products/has-images' && request.method === 'GET') {
      return listKanrisWithImages(request, env);
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
    if (productMatch && request.method === 'DELETE') {
      return withIdempotency(request, env, () => deleteProduct(request, env, user, ctx, decodeURIComponent(productMatch[1])));
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
      return lookupAiPrefill(request, env, ctx);
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
    const purchaseNextKanriMatch = path.match(/^\/api\/purchases\/([^/]+)\/next-kanri$/);
    if (purchaseNextKanriMatch && request.method === 'GET') {
      return getNextKanriForPurchase(request, env, decodeURIComponent(purchaseNextKanriMatch[1]));
    }
    const purchaseFixQtyMatch = path.match(/^\/api\/purchases\/([^/]+)\/fix-quantity$/);
    if (purchaseFixQtyMatch && request.method === 'GET') {
      return previewFixPurchaseQuantity(request, env, user, decodeURIComponent(purchaseFixQtyMatch[1]));
    }
    if (purchaseFixQtyMatch && request.method === 'POST') {
      const shiireId = decodeURIComponent(purchaseFixQtyMatch[1]);
      return withIdempotency(request, env, () => fixPurchaseQuantity(request, env, user, shiireId));
    }
    if (path.startsWith('/api/purchases/') && request.method === 'DELETE') {
      const shiireId = decodeURIComponent(path.slice('/api/purchases/'.length));
      return withIdempotency(request, env, () => deletePurchase(request, env, user, shiireId));
    }

    // 書き込み（GAS プロキシ）
    if (path === '/api/save/measurement' && request.method === 'POST') {
      return withIdempotency(request, env, () => saveMeasurement(request, env, user, ctx));
    }
    if (path === '/api/save/sale' && request.method === 'POST') {
      return withIdempotency(request, env, () => saveSale(request, env, user, ctx));
    }
    if (path === '/api/save/details' && request.method === 'POST') {
      return withIdempotency(request, env, () => saveDetails(request, env, user, ctx));
    }
    if (path === '/api/save/image' && request.method === 'POST') {
      return withIdempotency(request, env, () => uploadImage(request, env, user));
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
      return withIdempotency(request, env, () => createPurchase(request, env, user));
    }
    if (path === '/api/create/product' && request.method === 'POST') {
      return withIdempotency(request, env, () => createProduct(request, env, user, ctx));
    }

    // 場所移動
    if (path === '/api/moves' && request.method === 'GET') {
      return listMoves(request, env, user);
    }
    if (path === '/api/moves' && request.method === 'POST') {
      return withIdempotency(request, env, () => createMove(request, env, user));
    }
    if (path.startsWith('/api/moves/') && request.method === 'DELETE') {
      const moveId = decodeURIComponent(path.slice('/api/moves/'.length));
      return withIdempotency(request, env, () => deleteMove(request, env, user, moveId));
    }
    if (path.startsWith('/api/moves/') && request.method === 'PUT') {
      const moveId = decodeURIComponent(path.slice('/api/moves/'.length));
      return withIdempotency(request, env, () => updateMove(request, env, user, moveId));
    }

    // 返送管理
    if (path === '/api/returns' && request.method === 'GET') {
      return listReturns(request, env, user);
    }
    if (path === '/api/returns' && request.method === 'POST') {
      return withIdempotency(request, env, () => createReturn(request, env, user));
    }
    if (path.startsWith('/api/returns/') && request.method === 'DELETE') {
      const boxId = decodeURIComponent(path.slice('/api/returns/'.length));
      return withIdempotency(request, env, () => deleteReturn(request, env, user, boxId));
    }
    if (path.startsWith('/api/returns/') && request.method === 'PUT') {
      const boxId = decodeURIComponent(path.slice('/api/returns/'.length));
      return withIdempotency(request, env, () => updateReturn(request, env, user, boxId));
    }

    // AI画像判定一覧
    if (path === '/api/ai/list' && request.method === 'GET') {
      return listAiResults(request, env, user);
    }

    // 作業者管理
    if (path === '/api/sagyousha' && request.method === 'GET') {
      return listSagyousha(request, env, user, ctx);
    }
    if (path === '/api/sagyousha' && request.method === 'POST') {
      return withIdempotency(request, env, () => saveSagyousha(request, env, user));
    }
    if (path === '/api/sagyousha/create' && request.method === 'POST') {
      return withIdempotency(request, env, () => createSagyousha(request, env, user));
    }

    // 同梱（bundled shipping）— KV のみ。スプレッドシート反映なし
    if (path === '/api/bundles' && request.method === 'GET') {
      return listBundles(request, env);
    }
    if (path === '/api/bundles/toggle' && request.method === 'POST') {
      // user/ctx は同梱追加時の自動転記 fan-out（fanoutBundleOnJoin）用
      return withIdempotency(request, env, () => toggleBundle(request, env, user, ctx));
    }

    // 売上ダッシュボード（今月/前月/通年/月別内訳）
    if (path === '/api/sales/summary' && request.method === 'GET') {
      return getSalesSummary(request, env, ctx);
    }

    // Web Push 通知
    if (path === '/api/push/vapid' && request.method === 'GET') {
      return getVapidPublicKey(request, env);
    }
    if (path === '/api/push/subscribe' && request.method === 'POST') {
      return subscribePush(request, env, user);
    }
    if (path === '/api/push/unsubscribe' && request.method === 'POST') {
      return unsubscribePush(request, env, user);
    }
    if (path === '/api/push/prefs' && request.method === 'GET') {
      return getPushPrefs(request, env, user);
    }
    if (path === '/api/push/prefs' && request.method === 'POST') {
      return setPushPrefs(request, env, user);
    }
    if (path === '/api/push/test' && request.method === 'POST') {
      return testPush(request, env, user);
    }

    // 経費申請: 本人申請を受けてシートに行追加（通知メールは onChange トリガーが発火）
    // GAS appendRow は数秒かかるので ctx.waitUntil で fire-and-forget。
    if (path === '/api/keihi/submit' && request.method === 'POST') {
      return withIdempotency(request, env, () => appendKeihi(request, env, user, ctx));
    }
    // 経費申請レシート画像アップロード（kanri 不要 / 経費_Images フォルダに保存）
    if (path === '/api/keihi/image' && request.method === 'POST') {
      return withIdempotency(request, env, () => uploadKeihiImage(request, env, user));
    }

    // 仕入れ数報告: 本人の未処理行に数量を入力 → 処理済み TRUE 化（Phase2 マージは GAS 側で実行）
    if (path === '/api/shiire-houkoku/quantity' && request.method === 'POST') {
      return withIdempotency(request, env, () => updateShiireHoukokuQuantity(request, env, user));
    }

    // フリマ用タイトル・説明文取得（GAS doGet を ?fmt=json でプロキシ）
    const listingTextMatch = path.match(/^\/api\/listing-text\/([^/]+)$/);
    if (listingTextMatch && request.method === 'GET') {
      return getListingText(request, env, user, decodeURIComponent(listingTextMatch[1]));
    }

    // 請求書管理（スタッフ）
    if (path === '/api/invoice/me' && request.method === 'GET') {
      return invoiceMe(request, env, user);
    }
    if (path === '/api/invoice/list' && request.method === 'GET') {
      return listMyInvoices(request, env, user);
    }
    if (path === '/api/invoice/detail' && request.method === 'GET') {
      return getInvoiceDetail(request, env, user);
    }
    if (path === '/api/invoice/months' && request.method === 'GET') {
      return listMyAvailableMonths(request, env, user);
    }
    if (path === '/api/invoice/preview' && request.method === 'POST') {
      return calcInvoicePreview(request, env, user);
    }
    if (path === '/api/invoice/profile' && request.method === 'GET') {
      return getInvoiceProfile(request, env, user);
    }
    if (path === '/api/invoice/profile' && request.method === 'POST') {
      return withIdempotency(request, env, () => saveInvoiceProfile(request, env, user));
    }
    if (path === '/api/invoice/create' && request.method === 'POST') {
      return withIdempotency(request, env, () => createInvoice(request, env, user));
    }
    if (path === '/api/invoice/manual-items' && request.method === 'POST') {
      return withIdempotency(request, env, () => updateManualItems(request, env, user));
    }
    if (path === '/api/invoice/pdf' && request.method === 'GET') {
      return downloadInvoicePdf(request, env, user);
    }
    if (path === '/api/invoice/revision' && request.method === 'POST') {
      return withIdempotency(request, env, () => requestInvoiceRevision(request, env, user));
    }
    if (path === '/api/invoice/revisions' && request.method === 'GET') {
      return listMyRevisions(request, env, user);
    }

    // 請求書管理（管理者）
    if (path === '/api/admin-invoice/list' && request.method === 'GET') {
      return adminListInvoices(request, env, user);
    }
    if (path === '/api/admin-invoice/revisions' && request.method === 'GET') {
      return adminListRevisions(request, env, user);
    }
    if (path === '/api/admin-invoice/revisions' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminUpdateRevision(request, env, user));
    }
    if (path === '/api/admin-invoice/status' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminUpdateInvoiceStatus(request, env, user));
    }
    if (path === '/api/admin-invoice/manual-items' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminUpdateManualItems(request, env, user));
    }
    if (path === '/api/admin-invoice/recalc' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminRecalcInvoice(request, env, user));
    }
    if (path === '/api/admin-invoice/grace-rates' && request.method === 'GET') {
      return adminGetGraceRates(request, env, user);
    }
    if (path === '/api/admin-invoice/grace-rates' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminSaveGraceRates(request, env, user));
    }
    if (path === '/api/admin-invoice/settings' && request.method === 'GET') {
      return adminGetSettings(request, env, user);
    }
    if (path === '/api/admin-invoice/settings' && request.method === 'POST') {
      return withIdempotency(request, env, () => adminSaveSettings(request, env, user));
    }

    // 業務メニュー（汎用シートダンプ: 仕入れ数報告/経費申請/報酬管理）
    const sheetMatch = path.match(/^\/api\/sheet\/([^/]+)$/);
    if (sheetMatch && request.method === 'GET') {
      return dumpSheet(request, env, user, decodeURIComponent(sheetMatch[1]), ctx);
    }

    // API/admin 以外は静的アセット（SPA fallback 含む）に委譲
    if (path.startsWith('/api/') || path.startsWith('/admin/')) {
      return jsonError('not found', 404);
    }
    return env.ASSETS.fetch(request);
  },
};
