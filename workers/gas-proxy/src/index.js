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
import { scheduledSync } from './sync/sheets-sync.js';
import { handleUpload, serveImage } from './handlers/upload.js';
import { getUploadPageHtml } from './pages/upload.html.js';
import * as kitHandler from './handlers/kit.js';

// ─── フィーチャーフラグ: Workers側で処理するaction ───
// 各Phaseで段階的に追加。削除で即ロールバック。
const WORKER_HANDLED = {
  // Phase 1: 読み取りAPI
  apiGetCachedProducts: (args, env) => products.getCachedProducts(args, env),
  apiBulkInit:          (args, env) => products.bulkInit(args, env),
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
      const png180 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAb6ElEQVR42u2deXgc5ZXuf6eqWq3NkizwBjGY2BY7YbEJEJYLgZDgmwHuEAIkgQkJW4AMe2xjbHAMJsHDklwTG5hhhiUEwiXET5hgkrBlGfYlrLYsA4J4xWi31N1Vde4fVS2V2rIsyW2pWvre5/EjuyVbbfVbb5/v953vlLCDpaoCWICKiB95PAHsBhwM7At8HtgdGAfsDJQBCcDGKE7ygA6gGdgAfALUAu8CLwIrRCQVeZ1tABHxBuPJyQ42si0ibuSxnYHjgKOBI4EpoXGNhofagY+AZ4GngT+ISGOOuX0R0YIxdK6RwyT+GnA68FVgp61c9dnnIzv6YjPKz0sd+eiH76S5r9kG4LfA/SLy56ixd1RiS57N3PlEVXUn4DvA94D9Il/mh7+sHAMbDQ+Ta+T1tSKf+yOwWEQeD/1hhaWIHztDh09ORURVtQK4ALg4rInJ+U8aA48sg3uAE3nseeAmEVm+I9Ja8pzKZwFzgL0jpYTkXKlGI3cxGQ20R4A5IlIbDcQhM3SWXoiIp6p7AbcA/3srT97IqCdjbwSuE5Gl+UprGWiJka19VPVfQjPvbBLZqB9yI6XIo8APRWTt9ppaBlpiqGoxcBtwYeTKM8zYqL81dpaQ1ALfFZG/qqoTxb07zNARM+8HPETAk015YZSPMsQm4Njni8gGA01qawBm3pMAmh8dvm3YxsxG2yk7NHUJcL+qXhN6zQrXavk1dMTM+wHLgT1zaiAjo3yYOluC/ELVF4TrtH6ZWvph5qnAn4CJpl42GqS6+iYRubY/W+ZWH2iGp6rjgSdC00EnHPDmcaYAfBDoH8W3VWV8jMH/kn9Jz/H7In4OddWxlyNb9fSQIcIDXvCSMOWtmXoLqAqGr4afF8/im/7M/jX5NvMysTzoz8h2fltHbFcRM638O/PrGFWETMHi/Gum4Rv+38TkzCD/x/MljsD/WJ5pjGmvYV/k3GlImAa2nEXh9yOi+pq1ZvxlT7W1tvtgB+noYFWkTiyC2/hXVF1MCLhK30a6Xw6kntKa28PSwPanJREoq4e/r6+hnfX17Jpez1lB3wcrgn4G6pymfP6vsfsMQvolFHpwNV9+AoL8Jz8Zw2zcsJ70Lg4ye/ZgIdndMcz6iUkd0zL99r1xjP8GaxBs8HS1XEq7iqA96HJFMMY0x7YDeQGO9scLMZUrAPvIaT9AKTzOLDSY1atUkH8QURugGZzZmPMXGCmIyUpFbmfakhLji9J/8DDzhMQLLyvLdZQAtuFmiZulkAAVYJoKZWCaDBIgEreFXAYuVsAWswKeAxNSngCVYLIOEiATRYJGAFZwmQZ2KRbuBcoAt8hLz4p+Uq2+hnEwAAAABJRU5ErkJggg==';
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
