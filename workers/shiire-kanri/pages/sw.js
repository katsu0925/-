// Service Worker — 仕入れ管理 PWA
// 戦略:
//  - App shell (/, /index.html, /icon.svg, /manifest): Cache-First（バージョン更新で即時切替）
//  - GET /api/products(.+)?, /api/purchases, /api/master/*, /api/sheet/*: Stale-While-Revalidate
//  - GET /api/me, /api/ai/*: Network-First（認証/動的判定）
//  - POST/PUT/DELETE: 常に Network（書き込みはキャッシュ禁止）
//  - Access の JWT cookie はブラウザが自動付与するので SW でも問題なし

const VERSION = 'sk-2026-04-29-v1';
const SHELL_CACHE = 'shell-' + VERSION;
const API_CACHE   = 'api-' + VERSION;

const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try { await cache.addAll(SHELL_URLS); } catch (e) { /* オフライン初回は無視 */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApiSwr(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  // 書き込み系は除外（メソッドフィルタもしているので保険）
  if (pathname.startsWith('/api/save/')) return false;
  if (pathname.startsWith('/api/create/')) return false;
  if (pathname === '/api/me') return false;
  // 大きい/頻度高い読み取りは SWR
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
  }).catch((err) => null);
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

async function shellFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  // ネット越しに最新を取りに行きつつ、cached があれば即時返す
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(()=>{});
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE はスルー（=ネットワーク）

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SW 自身・admin・cdn-cgi はスルー（CF Access 周りで干渉しないように）
  if (url.pathname === '/sw.js') return;
  if (url.pathname.startsWith('/cdn-cgi/')) return;
  if (url.pathname.startsWith('/admin/')) return;

  if (url.pathname.startsWith('/api/')) {
    if (isApiSwr(url.pathname)) {
      event.respondWith(staleWhileRevalidate(req));
    } else {
      event.respondWith(networkFirst(req));
    }
    return;
  }

  // 画像 (Drive/proxy 経由) はキャッシュさせない（Auth が壊れる可能性 + 古い画像表示防止）
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/image/')) return;

  // それ以外（HTML / CSS / JS / icon / manifest）は shell-first
  event.respondWith(shellFirst(req));
});
