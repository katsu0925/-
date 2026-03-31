/**
 * detauri-ops メインルーター
 * Workers fetchハンドラ
 */
import { extractSession } from './handlers/session.js';
import { validateAndReturn } from './handlers/session.js';
import { login, logout, createStaff, listStaff, updateStaffDestination } from './handlers/auth.js';
import { listBatches, createBatch, countBatch } from './handlers/batches.js';
import { listProducts, getProduct, saveMeasurements, saveInfo, saveAiResult, registerProduct, getStats, myInventory } from './handlers/products.js';
import { uploadImages, deletePhoto, serveImage } from './handlers/upload.js';
import { createTransfer, listTransfers, processTransfer } from './handlers/transfers.js';
import { analyzeStep1, analyzeStep2 } from './handlers/ai.js';
import { jsonError, corsOptions, htmlResponse } from './utils/response.js';
import { loginPage } from './pages/login.html.js';
import { appPage } from './pages/app.html.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS プリフライト
    if (method === 'OPTIONS') {
      return corsOptions();
    }

    try {
      // === 認証不要ルート ===

      // ログイン画面
      if (method === 'GET' && (path === '/' || path === '/login')) {
        return htmlResponse(loginPage());
      }

      // PWAマニフェスト
      if (method === 'GET' && path === '/manifest.json') {
        return new Response(JSON.stringify({
          name: 'デタウリ業務',
          short_name: 'デタウリ',
          start_url: '/app',
          display: 'standalone',
          background_color: '#1e293b',
          theme_color: '#1e293b',
          icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
        }), {
          headers: {
            'Content-Type': 'application/manifest+json',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }

      // Service Worker
      if (method === 'GET' && path === '/sw.js') {
        return new Response(serviceWorkerScript(), {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ログインAPI
      if (method === 'POST' && path === '/api/auth/login') {
        return await login(request, env);
      }

      // ログアウトAPI（セッション不要 — bodyのsessionIdで削除）
      if (method === 'POST' && path === '/api/auth/logout') {
        return await logout(request, env, null);
      }

      // === 認証必須ルート ===
      const session = await extractSession(request, env);

      // メインアプリ画面
      if (method === 'GET' && path === '/app') {
        if (!session) {
          return Response.redirect(new URL('/', url).toString(), 302);
        }
        return htmlResponse(appPage({
          id: session.userId,
          email: session.email,
          displayName: session.displayName,
          role: session.role,
        }));
      }

      // R2画像配信（?token=sessionId方式）
      if (method === 'GET' && path.startsWith('/images/')) {
        if (!session) {
          return jsonError('認証が必要です。', 401);
        }
        const imagePath = path.slice('/images/'.length);
        if (!imagePath) {
          return jsonError('画像パスが指定されていません。', 400);
        }
        const object = await env.IMAGES.get(imagePath);
        if (!object) {
          return new Response('Not Found', { status: 404 });
        }
        const headers = new Headers();
        headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
        headers.set('Cache-Control', 'private, max-age=3600');
        return new Response(object.body, { headers });
      }

      // 以降のAPIは認証必須
      if (!session) {
        return jsonError('認証が必要です。', 401);
      }

      // セッション検証
      if (method === 'POST' && path === '/api/session/validate') {
        return await validateAndReturn(request, env, session);
      }

      // スタッフ作成（管理者のみ）
      if (method === 'POST' && path === '/api/auth/create-staff') {
        return await createStaff(request, env, session);
      }

      // スタッフ一覧（管理者のみ）
      if (method === 'POST' && path === '/api/auth/list-staff') {
        return await listStaff(request, env, session);
      }

      // スタッフ移動先設定（管理者のみ）
      if (method === 'POST' && path === '/api/auth/update-destination') {
        return await updateStaffDestination(request, env, session);
      }

      // === バッチAPI ===
      if (method === 'POST' && path === '/api/batches/list') return await listBatches(request, env, session);
      if (method === 'POST' && path === '/api/batches/create') return await createBatch(request, env, session);
      if (method === 'POST' && path === '/api/batches/count') return await countBatch(request, env, session);

      // === 商品API ===
      if (method === 'POST' && path === '/api/products/list') return await listProducts(request, env, session);
      if (method === 'POST' && path === '/api/products/get') return await getProduct(request, env, session);
      if (method === 'POST' && path === '/api/products/save-measurements') return await saveMeasurements(request, env, session);
      if (method === 'POST' && path === '/api/products/save-info') return await saveInfo(request, env, session);
      if (method === 'POST' && path === '/api/products/save-ai-result') return await saveAiResult(request, env, session);
      if (method === 'POST' && path === '/api/products/register') return await registerProduct(request, env, session);
      if (method === 'POST' && path === '/api/products/stats') return await getStats(request, env, session);
      if (method === 'POST' && path === '/api/products/my-inventory') return await myInventory(request, env, session);

      // === 画像アップロードAPI ===
      if (method === 'POST' && path === '/api/upload/images') return await uploadImages(request, env, session);
      if (method === 'POST' && path === '/api/upload/delete') return await deletePhoto(request, env, session);

      // === AI判定API ===
      if (method === 'POST' && path === '/api/ai/step1') return await analyzeStep1(request, env, session);
      if (method === 'POST' && path === '/api/ai/step2') return await analyzeStep2(request, env, session);

      // === 移動報告API ===
      if (method === 'POST' && path === '/api/transfers/create') return await createTransfer(request, env, session);
      if (method === 'POST' && path === '/api/transfers/list') return await listTransfers(request, env, session);
      if (method === 'POST' && path === '/api/transfers/process') return await processTransfer(request, env, session);

      // 未知のパス
      return jsonError('Not Found', 404);

    } catch (err) {
      console.error('Router error:', err);
      return jsonError('サーバーエラーが発生しました。', 500);
    }
  },
};

/**
 * Service Worker スクリプト
 * ネットワークファースト、オフライン時はキャッシュから返す
 */
function serviceWorkerScript() {
  return `
const CACHE_NAME = 'detauri-ops-v1';
const STATIC_ASSETS = ['/', '/app', '/manifest.json'];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除 + クライアントに更新通知
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => {
      // 新しいSWがactivateされたらクライアントに通知
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED' });
        });
      });
    })
  );
  self.clients.claim();
});

// フェッチ: ネットワークファースト
self.addEventListener('fetch', (event) => {
  // APIリクエストはキャッシュしない
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 正常なレスポンスをキャッシュに保存
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request);
      })
  );
});
`;
}
