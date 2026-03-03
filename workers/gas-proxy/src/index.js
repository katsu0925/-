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

// ─── フィーチャーフラグ: Workers側で処理するaction ───
// 各Phaseで段階的に追加。削除で即ロールバック。
const WORKER_HANDLED = {
  // Phase 1: 読み取りAPI
  apiGetCachedProducts: (args, env) => products.getCachedProducts(args, env),
  apiBulkInit:          (args, env) => products.bulkInit(args, env),
  apiGetCsrfToken:      (args, env) => session.getCsrfToken(args, env),

  // Phase 2: 認証
  apiValidateSession:  (args, env) => session.validateSession(args, env),
  apiLoginCustomer:    (args, env) => auth.login(args, env),
  apiRegisterCustomer: (args, env) => auth.register(args, env),
  apiLogoutCustomer:   (args, env) => auth.logout(args, env),

  // Phase 3: ステータス + 確保 + クーポン
  apiGetStatusDigest:  (args, env) => status.getStatusDigest(args, env),
  apiSyncHolds:        (args, env) => holds.syncHolds(args, env),
  apiValidateCoupon:   (args, env) => coupon.validateCoupon(args, env),

  // Phase 4: マイページ
  apiGetMyPage:        (args, env) => mypage.getMyPage(args, env),

  // Phase 5: 注文送信（ハイブリッド: バリデーション→Workers, 確保→GAS）
  apiSubmitEstimate:   (args, env, bodyText) => submit.submitEstimate(args, env, bodyText),
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

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsOptions();
    }

    // キャッシュ手動パージ（ヘルスチェックより先に判定）
    if (url.searchParams.get('purge') === '1') {
      return await purgeAllCaches(env);
    }

    // ヘルスチェック
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonOk({
        status: 'running',
        workerHandled: Object.keys(WORKER_HANDLED),
        version: '2.0.0',
      });
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

      // ハンドラー実行（bodyTextは一部ハンドラーでGASプロキシ用に必要）
      const result = await handler(args, env, bodyText);

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
  const key = `rl:${action}:${userKey}`;
  const count = parseInt(await env.SESSIONS.get(key) || '0', 10);

  if (count >= config.max) {
    return true; // rate limited
  }

  await env.SESSIONS.put(key, String(count + 1), {
    expirationTtl: config.windowSec,
  });
  return false;
}

async function purgeAllCaches(env) {
  const keys = [
    'products:detauri',
    'products:bulk',
    'settings:public',
    'stats:banner',
  ];

  for (const key of keys) {
    await env.CACHE.delete(key);
  }

  return jsonOk({ message: 'All caches purged', keys });
}
