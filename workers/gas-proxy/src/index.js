/**
 * Cloudflare Worker: デタウリ APIルーター
 *
 * ── 仕組み ──
 * 1. フロントエンドからのリクエストを受ける
 * 2. WORKER_HANDLED マップでaction → handler振り分け
 * 3. マップに無いaction → 自動的にGASプロキシにフォールバック
 * 4. handler が null を返した場合も GASプロキシにフォールバック
 *
 * ── Phase単位のロールバック ──
 * WORKER_HANDLED からエントリを削除するだけで即座にGASに戻る
 */

import { corsOptions, corsResponse, jsonOk, jsonError } from './utils/response.js';
import { proxyToGas } from './handlers/proxy.js';
import * as products from './handlers/products.js';
import * as session from './handlers/session.js';
import * as auth from './handlers/auth.js';
import * as status from './handlers/status.js';
import * as holds from './handlers/holds.js';
import * as coupon from './handlers/coupon.js';
import * as mypage from './handlers/mypage.js';
import * as submit from './handlers/submit.js';
import { scheduledSync, batchAiJudgment, restorePhotoMetaFromGas } from './sync/sheets-sync.js';
import { handleUpload, serveImage } from './handlers/upload.js';
import { getUploadPageHtml } from './pages/upload.html.js';
import * as kitHandler from './handlers/kit.js';

// ─── フィーチャーフラグ: Workers側で処理するaction ───
// 各Phaseで段階的に追加。削除で即ロールバック。
const WORKER_HANDLED = {
  // Phase 1: 読み取りAPI
  apiGetCachedProducts: (args, env) => products.getCachedProducts(args, env),
  apiBulkInit:          (args, env) => products.bulkInit(args, env),
  apiBulkRefresh:       (args, env) => products.bulkRefresh(args, env),
  apiGetProductsVersion:(args, env) => products.getProductsVersion(args, env),
  apiGetCsrfToken:      (args, env) => session.getCsrfToken(args, env),

  // Phase 2: 認証
  apiValidateSession:  (args, env) => session.validateSession(args, env),
  apiLoginCustomer:    (args, env) => auth.login(args, env),
  apiRegisterCustomer: (args, env) => auth.register(args, env),
  apiLogoutCustomer:   (args, env) => auth.logout(args, env),

  // Phase 3: ステータス + 確保 + クーポン
  apiGetStatusDigest:  (args, env) => status.getStatusDigest(args, env),
  apiSyncHolds:        (args, env) => holds.syncHolds(args, env),
  apiCancelPendingPayment: (args, env) => holds.cancelPendingPayment(args, env),
  apiValidateCoupon:   (args, env) => coupon.validateCoupon(args, env),

  // Phase 4: マイページ
  apiGetMyPage:        (args, env) => mypage.getMyPage(args, env),
  apiGetReferralCode:  (args, env) => mypage.getReferralCode(args, env),

  // Phase 5: 注文送信（KOMOJU決済セッション作成をWorkersで完結）
  apiSubmitEstimate:   (args, env, bodyText, ctx) => submit.submitEstimate(args, env, bodyText, ctx),

  // D1ペンディング注文API（GASフォールバック用）
  apiGetPendingOrder:     (args, env, bodyText) => submit.getPendingOrder(args, env, bodyText),
  apiMarkPendingConsumed: (args, env, bodyText) => submit.markPendingConsumed(args, env, bodyText),

  // D1 session_token_map逆引き（Webhook paymentToken解決フォールバック用）
  apiLookupBySession:     (args, env, bodyText) => submit.lookupBySession(args, env, bodyText),
  apiLookupSessionByToken:(args, env, bodyText) => submit.lookupSessionByToken(args, env, bodyText),

  // Meta Conversions API（サーバーサイドイベント送信）
  apiSendCapiEvent:       (args, env) => submit.sendCapiEvent(args, env),
};

// CSRFが必要なaction（Phase 2以降で有効化）
const CSRF_REQUIRED = new Set([
  // 'apiSubmitEstimate',
  // 'apiCreateKomojuSession',
  // 'apiChangePassword',
  // 'apiApplyReferralCode',
  // 'apiSubmitSnsShare',
]);

// レート制限設定
const RATE_LIMITS = {
  apiSubmitEstimate:    { max: 5, windowSec: 3600 },
  apiBulkSubmit:        { max: 5, windowSec: 3600 },
  apiSyncHolds:         { max: 30, windowSec: 60 },
  apiLoginCustomer:     { max: 30, windowSec: 3600 },
  apiRegisterCustomer:  { max: 20, windowSec: 3600 },
  apiSendContactForm:   { max: 3, windowSec: 3600 },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight（/upload/* はAuthorization headerを許可）
    if (request.method === 'OPTIONS') {
      if (url.pathname.startsWith('/upload')) {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }
      return corsOptions();
    }

    // キャッシュ手動パージ（ヘルスチェックより先に判定）
    if (url.searchParams.get('purge') === '1') {
      return await purgeAllCaches(env);
    }

    // ─── 画像アップロード系（既存JSON POSTフローと完全分離） ───

    // ファビコン配信
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg' || url.pathname === '/tasukibako-apple-touch-icon.png')) {
      if (url.pathname === '/favicon.svg') {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="8" width="26" height="20" rx="3" fill="#3b82f6"/><rect x="1" y="5" width="30" height="7" rx="2" fill="#2563eb"/><rect x="-2" y="13" width="36" height="5" rx="1" fill="#fbbf24" transform="rotate(-35 16 16)"/></svg>`;
        return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } });
      }
      // favicon.ico (32x32 PNG) & tasukibako-apple-touch-icon (180x180 PNG)
      const png180 = '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';
      const png32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAApklEQVR4nO2UMQ6AIAxFOYyewuN4Ey/mgdxdHDAOLGBDW34LAz/pRvNem5QQZmZGyLpf0aOecynKTeAP7iJAgV0EanAzAQ7YTYAL/t5Cr0AydeopznE77qgpLji9J/8DDzhMQLLyvLdZQAtuFmiZulkAAVYJoKZWCaDBIgEreFXAYuVsAWswKeAxNSngCVYLIOEiATRYJGAFZwmQZ2KRbuBcoAt8hLz4p+Uq2+hnEwAAAABJRU5ErkJggg==';
      const b64 = url.pathname === '/tasukibako-apple-touch-icon.png' ? png180 : png32;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
    }

    // PWA: manifest.json
    if (request.method === 'GET' && url.pathname === '/manifest.json') {
      const manifest = JSON.stringify({
        name: 'タスキ箱',
        short_name: 'タスキ箱',
        description: '商品画像をチームで共有管理',
        start_url: '/upload',
        display: 'standalone',
        background_color: '#f5f5f5',
        theme_color: '#3b82f6',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/tasukibako-apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
        ]
      });
      return new Response(manifest, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=604800' } });
    }

    // PWA: Service Worker
    if (request.method === 'GET' && url.pathname === '/sw.js') {
      const sw = `
const CACHE_NAME = 'tasukibako-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/upload/') || e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (e.request.url.endsWith('.js') || e.request.url.endsWith('.css') || e.request.url.includes('/favicon'))) {
        const clone = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});`;
      return new Response(sw, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } });
    }

    // R2画像配信: GET /images/* → R2 → Cache-Control 1年
    if (request.method === 'GET' && url.pathname.startsWith('/images/')) {
      return await serveImage(request, env, url.pathname);
    }

    // photo-meta 復元: POST /admin/restore-photo-meta (body: {key})
    if (request.method === 'POST' && url.pathname === '/admin/restore-photo-meta') {
      try {
        const body = await request.json();
        if (body.key !== env.SYNC_SECRET) return new Response('Unauthorized', { status: 401 });
        const result = await restorePhotoMetaFromGas(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // バッチAI判定: POST /batch-ai (body: {key, limit, skip[]})
    if (request.method === 'POST' && url.pathname === '/batch-ai') {
      try {
        const body = await request.json();
        if (body.key !== env.SYNC_SECRET) return new Response('Unauthorized', { status: 401 });
        const limit = body.limit || 5;
        env._batchSkipSet = new Set(body.skip || []);
        const result = await batchAiJudgment(env, limit);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    // GET /upload/blur?check=1 → 使用量確認
    if (url.pathname === '/upload/blur' && request.method === 'GET') {
      const usage = await getBlurUsage(env);
      return jsonOk(usage);
    }

    // POST /upload/blur → CF Images segment で背景除去
    if (url.pathname === '/upload/blur' && request.method === 'POST') {
      return await handleBlurSegment(request, env);
    }

    // GET /upload/bg-replace?check=1 → 使用量確認
    if (url.pathname === '/upload/bg-replace' && request.method === 'GET') {
      const usage = await getBgReplaceUsage(env);
      return jsonOk(usage);
    }

    // POST /upload/bg-replace → Vercel Functions に転送（Sharp + Replicate）
    if (url.pathname === '/upload/bg-replace' && request.method === 'POST') {
      return await handleBgReplace(request, env);
    }

    // POST /api/brands-for-overlay → 背景置換時のブランド文字入れ用
    if (url.pathname === '/api/brands-for-overlay' && request.method === 'POST') {
      return await handleBrandsForOverlay(request, env);
    }

    // POST /upload/* → アップロードAPIハンドラー（multipart/JSON）
    if (url.pathname.startsWith('/upload/')) {
      return await handleUpload(request, env, url.pathname);
    }

    // POST /api/kit/save → キットデータ保存
    if (url.pathname === '/api/kit/save' && request.method === 'POST') {
      return await kitHandler.saveKit(request, env);
    }

    // GET リクエスト処理
    if (request.method === 'GET') {
      // 出品キットページ
      if (url.pathname === '/kit') {
        // デモモード: /kit?mode=demo
        if (url.searchParams.get('mode') === 'demo') {
          return kitHandler.serveDemoKit();
        }
        return await kitHandler.serveKit(request, env, url);
      }

      // 出品キット商品ZIP
      if (url.pathname.startsWith('/api/kit/zip/')) {
        return await kitHandler.zipProduct(request, env, url);
      }

      // アップロードページ
      if (url.pathname === '/upload') {
        return new Response(getUploadPageHtml(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        });
      }

      // ヘルスチェック（workers.devドメインの場合）
      if (!isCustomDomain(url)) {
        return jsonOk({
          status: 'running',
          workerHandled: Object.keys(WORKER_HANDLED),
          version: '2.1.0',
        });
      }

      // カスタムドメイン: Pages HTMLに商品データを埋め込んで返す
      return await serveHtmlWithData(request, env, url);
    }

    // POST以外は拒否
    if (request.method !== 'POST') {
      return jsonError('POST only', 405);
    }

    try {
      const bodyText = await request.text();
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        parsed = {};
      }

      const action = parsed.action || '';
      const args = parsed.args || [];
      const userKey = extractUserKey(request, args);

      // Workers側で処理するactionか確認
      const handler = WORKER_HANDLED[action];

      if (!handler) {
        // GASプロキシにフォールバック
        return await proxyToGas(bodyText, env);
      }

      // レート制限チェック（Workers処理のactionのみ）
      const rlConfig = RATE_LIMITS[action];
      if (rlConfig) {
        const limited = await checkRateLimit(env, action, userKey, rlConfig);
        if (limited) {
          return jsonError('リクエスト回数の上限に達しました。しばらくしてからお試しください。', 429);
        }
      }

      // CSRF検証（有効化されたactionのみ）
      if (CSRF_REQUIRED.has(action)) {
        const csrfToken = parsed.csrfToken || '';
        const valid = await session.verifyCsrfToken(userKey, csrfToken, env);
        if (!valid) {
          return jsonError('CSRFトークンが無効です。ページを再読み込みしてください。', 403);
        }
      }

      // ハンドラー実行（bodyTextとctxは一部ハンドラーで必要）
      const result = await handler(args, env, bodyText, ctx);

      // null返却 = GASフォールバック（パスワードv1/legacy等）
      if (result === null) {
        return await proxyToGas(bodyText, env);
      }

      return result;

    } catch (e) {
      console.error('Worker error:', e.message, e.stack);
      return jsonError('Proxy error: ' + e.message, 502);
    }
  },

  // Cron Trigger: D1 ⇔ Sheets 同期
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledSync(env));
  },
};

// ─── ヘルパー ───

function extractUserKey(request, args) {
  // argsの最初の要素がuserKeyの場合
  if (args.length > 0 && typeof args[0] === 'string' && args[0].length > 0) {
    return args[0];
  }
  // fallback: IPアドレス
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function checkRateLimit(env, action, userKey, config) {
  try {
    const key = `rl:${action}:${userKey}`;
    const count = parseInt(await env.SESSIONS.get(key) || '0', 10);

    if (count >= config.max) {
      return true; // rate limited
    }

    await env.SESSIONS.put(key, String(count + 1), {
      expirationTtl: config.windowSec,
    });
  } catch (e) {
    // KV制限超過時はレート制限をスキップしてリクエストを通す
    console.warn('Rate limit check failed (skipping):', e.message);
  }
  return false;
}

// ─── カスタムドメイン判定 ───

/**
 * CF Images segment で背景除去
 * 1. 画像をR2に一時保存
 * 2. CF Image Transformations (segment=foreground) で前景取得
 * 3. 前景PNGを返す
 * 4. 一時ファイル削除
 */
async function handleBlurSegment(request, env) {
  try {
    // 使用量チェック（?check=1 で残量確認のみ）
    const url = new URL(request.url);
    if (url.searchParams.get('check') === '1') {
      const usage = await getBlurUsage(env);
      return jsonOk(usage);
    }

    const formData = await request.formData();
    const file = formData.get('image');
    if (!file) return jsonError('画像が必要です', 400);

    // 使用量カウント
    const usage = await incrementBlurUsage(env);

    // R2に一時保存
    const tmpKey = 'tmp-blur/' + crypto.randomUUID() + '.jpg';
    await env.IMAGES.put(tmpKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'image/jpeg' },
    });

    // CF Image Transformations で segment 実行
    const imageUrl = new URL('/images/' + tmpKey, request.url).href;
    const segRes = await fetch(imageUrl, {
      cf: { image: { segment: 'foreground', format: 'png' } },
    });

    // 一時ファイル削除（バックグラウンド）
    env.IMAGES.delete(tmpKey).catch(() => {});

    if (!segRes.ok) {
      const errText = await segRes.text();
      console.error('CF segment error:', segRes.status, errText);
      return jsonError('背景除去に失敗しました（CF Images）', 502);
    }

    return new Response(segRes.body, {
      headers: {
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'X-Blur-Usage': String(usage.count),
        'X-Blur-Limit': '5000',
      },
    });
  } catch (e) {
    console.error('handleBlurSegment error:', e);
    return jsonError('背景除去エラー: ' + e.message, 500);
  }
}

// CF Images 使用量管理（KV、月ごとリセット）
const BLUR_LIMIT = 5000;

function blurUsageKey() {
  const now = new Date();
  return 'blur-usage:' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

async function getBlurUsage(env) {
  const key = blurUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0');
  return { count, limit: BLUR_LIMIT, remaining: Math.max(0, BLUR_LIMIT - count) };
}

async function incrementBlurUsage(env) {
  const key = blurUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0') + 1;
  // 月末+1日まで保持（自動リセット）
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  const ttl = Math.ceil((nextMonth - now) / 1000);
  await env.CACHE.put(key, String(count), { expirationTtl: ttl });
  return { count, limit: BLUR_LIMIT, remaining: Math.max(0, BLUR_LIMIT - count) };
}

// ─── 背景置換（Vercel Functions プロキシ） ───
const BG_REPLACE_LIMIT = 5000;

function bgReplaceUsageKey() {
  const now = new Date();
  return 'bgreplace-usage:' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

async function getBgReplaceUsage(env) {
  const key = bgReplaceUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0');
  return { count, limit: BG_REPLACE_LIMIT, remaining: Math.max(0, BG_REPLACE_LIMIT - count) };
}

async function incrementBgReplaceUsage(env) {
  const key = bgReplaceUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0') + 1;
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  const ttl = Math.ceil((nextMonth - now) / 1000);
  await env.CACHE.put(key, String(count), { expirationTtl: ttl });
  return { count, limit: BG_REPLACE_LIMIT, remaining: Math.max(0, BG_REPLACE_LIMIT - count) };
}

async function handleBgReplace(request, env) {
  try {
    const apiUrl = env.BG_API_URL;
    const apiKey = env.BG_API_KEY;
    if (!apiUrl || !apiKey) {
      return jsonError('背景置換APIが未設定です（BG_API_URL/BG_API_KEY）', 500);
    }

    const usage = await incrementBgReplaceUsage(env);

    // FormData をそのまま転送
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': request.headers.get('Content-Type') || 'multipart/form-data',
      },
      body: request.body,
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Vercel bg-replace error:', upstream.status, errText);
      return jsonError('背景置換に失敗しました（' + upstream.status + '）', 502);
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
        'X-Subject-Type': upstream.headers.get('X-Subject-Type') || '',
        'X-BgReplace-Usage': String(usage.count),
        'X-BgReplace-Limit': String(BG_REPLACE_LIMIT),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('handleBgReplace error:', e);
    return jsonError('背景置換エラー: ' + e.message, 500);
  }
}

// ─── 背景置換の文字入れ用ブランド取得 ───
// 優先度: 採寸済み行のブランド（外注レビュー済み） > KV ai-result のAI判定ブランド
async function handleBrandsForOverlay(request, env) {
  try {
    const body = await request.json();
    const managedIds = Array.isArray(body.managedIds) ? body.managedIds : [];
    const normIds = managedIds
      .map(x => String(x || '').trim().toUpperCase())
      .filter(Boolean);
    if (normIds.length === 0) return jsonOk({ brands: {} });

    // GASから採寸済みかつブランドあり行の情報を取得
    const gasBrands = {};
    const gasUrl = env.GAS_API_URL;
    if (gasUrl) {
      try {
        const resp = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'apiGetBrandsForOverlay',
            args: [{ syncSecret: env.SYNC_SECRET || '', managedIds: normIds }],
          }),
          redirect: 'follow',
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j && j.ok && j.brands) Object.assign(gasBrands, j.brands);
        } else {
          console.warn('GAS apiGetBrandsForOverlay failed:', resp.status);
        }
      } catch (e) {
        console.warn('GAS apiGetBrandsForOverlay error:', e.message);
      }
    }

    // 各管理番号について採用ブランドを決定
    const brands = {};
    for (const mid of normIds) {
      const g = gasBrands[mid];
      if (g && g.hasSizing && g.brand) {
        brands[mid] = g.brand;
        continue;
      }
      // KV ai-result フォールバック
      try {
        const cached = await env.CACHE.get(`ai-result:${mid}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.brand) { brands[mid] = parsed.brand; continue; }
        }
      } catch (e) { /* ignore */ }
      // GASのブランドをフォールバック（採寸なくても判定済みがあれば）
      if (g && g.brand) { brands[mid] = g.brand; continue; }
      brands[mid] = '';
    }

    return jsonOk({ brands });
  } catch (e) {
    console.error('handleBrandsForOverlay error:', e);
    return jsonError('ブランド取得エラー: ' + e.message, 500);
  }
}

const PAGES_ORIGIN = 'https://wholesale-eco.pages.dev';
const CUSTOM_DOMAINS = ['wholesale.nkonline-tool.com'];

function isCustomDomain(url) {
  return CUSTOM_DOMAINS.includes(url.hostname);
}

/**
 * Pages HTMLを取得し、KVの商品データを埋め込んで返す
 * - ルート(/) → HTMLRewriterで商品データ注入
 * - その他のパス → Pagesにパススルー
 */
async function serveHtmlWithData(request, env, url) {
  // Pages origin URLを構築
  const pagesUrl = PAGES_ORIGIN + url.pathname + url.search;

  // Pagesから静的ファイルを取得
  const pagesResp = await fetch(pagesUrl, {
    headers: {
      'Accept': request.headers.get('Accept') || '*/*',
      'Accept-Encoding': request.headers.get('Accept-Encoding') || '',
    },
  });

  // HTML以外（CSS, JS, images等）はそのまま返す
  const contentType = pagesResp.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) {
    return pagesResp;
  }

  // KVから商品データを取得（プリウォーム済みなので即座に返る）
  const productsJson = await env.CACHE.get('products:detauri');

  if (!productsJson) {
    // KVにデータが無い場合はそのまま返す（JSが通常APIフォールバック）
    return pagesResp;
  }

  // HTMLRewriterで商品データを埋め込む
  return new HTMLRewriter()
    .on('script#__initial_products__', {
      element(element) {
        // GASテンプレートタグを商品JSONデータに置換
        element.setInnerContent(productsJson, { html: false });
      },
    })
    .transform(pagesResp);
}

async function purgeAllCaches(env) {
  const keys = [
    'products:detauri',
    'products:bulk',
    'settings:public',
    'stats:banner',
    'products:version',
    'products:bulk:version',
  ];

  for (const key of keys) {
    await env.CACHE.delete(key);
  }

  return jsonOk({ message: 'All caches purged', keys });
}
