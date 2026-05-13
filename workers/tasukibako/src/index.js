/**
 * タスキ箱 — メインルーター
 */
import { corsOptions, jsonOk, jsonError, htmlResponse } from './utils/response.js';
import { extractSession } from './handlers/session.js';
import * as auth from './handlers/auth.js';
import * as session from './handlers/session.js';
import * as team from './handlers/team.js';
import * as upload from './handlers/upload.js';
import * as manage from './handlers/manage.js';
import * as admin from './handlers/admin.js';
import * as stripe from './handlers/stripe.js';
import { getLoginPageHtml } from './pages/login.html.js';
import { getRegisterPageHtml } from './pages/register.html.js';
import { getAppPageHtml } from './pages/app.html.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return corsOptions(env.ALLOWED_ORIGIN);
    }

    // --- HTMLページ ---
    if (request.method === 'GET') {
      switch (url.pathname) {
        case '/':
        case '/login':
          return htmlResponse(getLoginPageHtml());
        case '/register':
          return htmlResponse(getRegisterPageHtml(url.searchParams.get('code')));
        case '/app':
          return htmlResponse(getAppPageHtml());
        case '/favicon.svg':
        case '/favicon.ico':
          return new Response(FAVICON_SVG, {
            headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
          });
      }

      // R2画像配信（tmp-blur/は内部CF Transformations用、認証不要）
      if (url.pathname.startsWith('/images/tmp-blur/')) {
        const r2Key = url.pathname.replace(/^\/images\//, '');
        const obj = await env.IMAGES.get(r2Key);
        if (!obj) return new Response('Not Found', { status: 404 });
        return new Response(obj.body, {
          headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg' },
        });
      }

      // R2画像配信
      if (url.pathname.startsWith('/images/')) {
        try {
          return await upload.serveImage(request, env, url);
        } catch (e) {
          console.error('Image serve error:', url.pathname, e);
          return new Response('Internal Server Error', { status: 500 });
        }
      }
    }

    // GET /api/upload/blur?check=1 → ぼかし使用量確認
    if (url.pathname === '/api/upload/blur' && request.method === 'GET') {
      const usage = await getBlurUsage(env);
      return jsonOk(usage);
    }

    // --- API ---
    if (url.pathname.startsWith('/api/') && request.method === 'POST') {
      try {
        return await routeApi(request, env, ctx, url.pathname);
      } catch (e) {
        console.error('API error:', url.pathname, e);
        return jsonError('サーバーエラーが発生しました。', 500);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function routeApi(request, env, ctx, path) {
  // 認証不要エンドポイント
  switch (path) {
    case '/api/auth/register':    return auth.register(request, env);
    case '/api/auth/login':       return auth.login(request, env);
    case '/api/auth/logout':      return auth.logout(request, env);
    case '/api/team/invite-info': return team.inviteInfo(request, env);
    case '/api/stripe/webhook':   return stripe.webhook(request, env);
  }

  // 認証必須エンドポイント
  const sess = await extractSession(request, env);
  if (!sess) {
    return jsonError('ログインが必要です。', 401);
  }

  switch (path) {
    // セッション
    case '/api/session/validate': return session.validateAndReturn(request, env, sess);

    // チーム管理
    case '/api/team/create':            return team.create(request, env, sess);
    case '/api/team/list':              return team.list(request, env, sess);
    case '/api/team/join':              return team.join(request, env, sess);
    case '/api/team/members':           return team.members(request, env, sess);
    case '/api/team/regenerate-invite': return team.regenerateInvite(request, env, sess);

    // 画像アップロード
    case '/api/upload/images':  return upload.uploadImages(request, env, sess);
    case '/api/upload/reorder': return upload.reorder(request, env, sess);
    case '/api/upload/blur':    return handleBlurSegment(request, env);

    // 商品管理
    case '/api/manage/list':           return manage.list(request, env, sess);
    case '/api/manage/product-images': return manage.productImages(request, env, sess);
    case '/api/manage/delete':         return manage.deleteProduct(request, env, sess);
    case '/api/manage/delete-single':  return manage.deleteSingle(request, env, sess);
    case '/api/manage/stats':          return manage.stats(request, env, sess);
    case '/api/manage/temp-token':     return manage.tempToken(request, env, sess);
    case '/api/manage/save-log':      return manage.saveLog(request, env, sess);

    // Stripe Billing
    case '/api/stripe/checkout':  return stripe.checkout(request, env, sess);
    case '/api/stripe/portal':    return stripe.portal(request, env, sess);

    // 管理者
    case '/api/admin/set-plan':     return admin.setPlan(request, env, sess);
    case '/api/admin/reset-usage':  return admin.resetUsage(request, env, sess);
    case '/api/admin/info':         return admin.info(request, env, sess);
  }

  return jsonError('不明なエンドポイント', 404);
}

// ─── AI背景ぼかし（CF Images segment） ───
const BLUR_LIMIT = 5000;

function blurUsageKey() {
  const now = new Date();
  return 'blur-usage:' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

async function getBlurUsage(env) {
  const key = blurUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0');
  return { ok: true, count, limit: BLUR_LIMIT, remaining: Math.max(0, BLUR_LIMIT - count) };
}

async function incrementBlurUsage(env) {
  const key = blurUsageKey();
  const count = parseInt(await env.CACHE.get(key) || '0') + 1;
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  const ttl = Math.ceil((nextMonth - now) / 1000);
  await env.CACHE.put(key, String(count), { expirationTtl: ttl });
  return { count, limit: BLUR_LIMIT, remaining: Math.max(0, BLUR_LIMIT - count) };
}

async function handleBlurSegment(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('image');
    if (!file) return jsonError('画像が必要です', 400);

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
        'X-Blur-Limit': String(BLUR_LIMIT),
      },
    });
  } catch (e) {
    console.error('handleBlurSegment error:', e);
    return jsonError('背景除去エラー: ' + e.message, 500);
  }
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#4F46E5"/>
  <text x="50" y="68" font-size="52" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold">箱</text>
</svg>`;
