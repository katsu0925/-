// Service Worker — 仕入れ管理 PWA
// 更新戦略（重要）:
//  - HTML (/, /index.html): Network-First（オンラインなら常に最新を返す）
//      → これを誤ると「デプロイしても古いまま」現象が再発する
//  - 静的アセット (/manifest, /icon*): Cache-First（URL変更なし＝同一）
//  - GET 読み取り API（高頻度）: Stale-While-Revalidate
//  - GET 認証/動的 API: Network-First
//  - POST/PUT/DELETE: 常に Network（書き込みはキャッシュ禁止）
//  - VERSION を上げると activate 時に旧キャッシュを全削除
//  - skipWaiting + clients.claim で即時切替、controllerchange でクライアントが UI 通知

const VERSION = 'sk-2026-05-03-v67';
const SHELL_CACHE = 'shell-' + VERSION;
const API_CACHE   = 'api-' + VERSION;

// HTML は network-first なのでプリキャッシュからは外す（古いHTMLを掴ませない）
const SHELL_URLS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try { await cache.addAll(SHELL_URLS); } catch (e) { /* オフライン初回は無視 */ }
    // 即座に waiting を解除して activate へ移行
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 旧バージョンのキャッシュは全削除（VERSION で終わらないものは古い）
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
    // クライアントに「新バージョンがアクティブになった」と通知（controllerchange と併用）
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach(c => {
      try { c.postMessage({ type: 'SW_ACTIVATED', version: VERSION }); } catch(e) {}
    });
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION') {
    try { event.source && event.source.postMessage({ type: 'VERSION', version: VERSION }); } catch(e) {}
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    })());
  }
});

function isApiSwr(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/save/')) return false;
  if (pathname.startsWith('/api/create/')) return false;
  if (pathname === '/api/me') return false;
  // 売上ダッシュボード (/api/sales/*) は SWR から外す → 常に network-first で最新を取る
  return /^\/api\/(products|purchases|master\/|sheet\/|moves|returns|sagyousha|kanri\/next)/.test(pathname);
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok && res.status === 200) {
      cache.put(req, res.clone()).catch(()=>{});
    }
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response(JSON.stringify({ ok:false, error:'offline' }), {
    status: 503, headers: { 'Content-Type': 'application/json' }
  });
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    return res;
  } catch (err) {
    const cache = await caches.open(API_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

// HTML は必ず network-first（オフライン時のみキャッシュ）
async function htmlNetworkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) {
      try { cache.put(req, res.clone()); } catch(e) {}
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// アイコン/manifest はキャッシュ優先（同一URLなら同一内容）
async function staticCacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) {
    // 裏で更新（ファイル名が同じでも内容が変わる可能性に備える）
    fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(()=>{});
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(()=>{});
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE はスルー（=ネットワーク）

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SW 自身は絶対にキャッシュしない（更新が止まる原因 No.1）
  if (url.pathname === '/sw.js') return;
  if (url.pathname.startsWith('/cdn-cgi/')) return;
  if (url.pathname.startsWith('/admin/')) return;

  // HTML（SPA エントリ）は network-first
  // ナビゲーションリクエストは Accept: text/html
  const isNavigation = req.mode === 'navigate' ||
                       (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(htmlNetworkFirst(req));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (isApiSwr(url.pathname)) {
      event.respondWith(staleWhileRevalidate(req));
    } else {
      event.respondWith(networkFirst(req));
    }
    return;
  }

  // 画像（Drive/proxy 経由）はキャッシュ禁止
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/image/')) return;

  // それ以外（icon / manifest / 静的アセット）はキャッシュ優先 + 裏で更新
  event.respondWith(staticCacheFirst(req));
});
