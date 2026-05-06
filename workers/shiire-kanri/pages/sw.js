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

const VERSION = 'sk-2026-05-06-v101';
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
  if (data.type === 'WARM_API') {
    event.waitUntil(warmApi(data.urls));
  }
});

// ETag-aware SWR 対象（GET 一覧系）。Worker 側で ETag を返す API 限定。
// /api/products と /api/purchases は network-first（ETag/304 で十分高速）。
//   理由: SWR にすると「シート直接編集 → リロードしても初回はキャッシュの旧データ」現象が起きる。
//   過去に同じ手で UX バグを踏んでいる（v88 で再発）。
function isApiSwr(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/save/')) return false;
  if (pathname.startsWith('/api/create/')) return false;
  if (pathname === '/api/me') return false;
  // 売上ダッシュボード・商品詳細は network-first 維持
  if (pathname.startsWith('/api/sales/')) return false;
  if (/^\/api\/products\/[^/]+$/.test(pathname) &&
      pathname !== '/api/products/counts' &&
      pathname !== '/api/products/thumbs') {
    return false;
  }
  // 書き戻し直後の整合性が重要なものは除外
  if (pathname === '/api/moves') return false;
  if (pathname === '/api/returns') return false;
  if (pathname === '/api/sagyousha') return false;
  if (pathname === '/api/kanri/next') return false;
  if (pathname.startsWith('/api/sheet/')) return false;
  // 一覧系は network-first（ETag/304 でほぼゼロコスト）
  if (pathname === '/api/products') return false;
  if (pathname === '/api/purchases') return false;
  // SWR 対象: counts/thumbs/master/購入詳細のみ（変化が遅い・あるいは ETag 不要）
  return /^\/api\/(products\/(counts|thumbs)|purchases\/[^/]+\/products|master\/)/.test(pathname);
}

// ETag-aware SWR
//  1. キャッシュあれば即返却（描画 0ms）
//  2. 裏で If-None-Match 付き fetch
//     - 304: 何もしない（最新確認済み・帯域ゼロ）
//     - 200: Cache 上書き（次回アクセスで反映）
//  3. キャッシュなし: 通常 fetch → Cache 投入
//
// 注意: 200 受信時にクライアントへ通知して即時再描画する案を試したが、
// ETag を返さないエンドポイント（counts 等）で常に 200 が返り、
// notify→autoRefresh→fetch→notify の暴走ループを引き起こした。
// 現行は notify せず「次のアクセスで反映」方針に統一する。
async function staleWhileRevalidate(req) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(req);

  const revalidate = async () => {
    const headers = new Headers(req.headers);
    if (cached) {
      const etag = cached.headers.get('ETag');
      if (etag) headers.set('If-None-Match', etag);
    }
    const conditionalReq = new Request(req.url, {
      method: 'GET',
      headers,
      credentials: req.credentials,
      mode: req.mode,
      redirect: req.redirect,
    });
    try {
      const res = await fetch(conditionalReq);
      if (res.status === 304) return; // 最新確認済み
      if (res && res.ok && res.status === 200) {
        await cache.put(req, res.clone()).catch(()=>{});
      }
    } catch(e) { /* オフライン等は無視 */ }
  };

  if (cached) {
    // 即返却 + 裏で再検証
    revalidate();
    return cached;
  }

  // 初回: 通常 fetch
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status === 200) {
      cache.put(req, res.clone()).catch(()=>{});
    }
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:'offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 先回り温め: クライアントが visibilitychange:hidden 等のタイミングで呼ぶ
// 指定 URL を裏で fetch して Cache を最新化
async function warmApi(urls) {
  const cache = await caches.open(API_CACHE);
  await Promise.all((urls || []).map(async (url) => {
    try {
      const cached = await cache.match(url);
      const headers = new Headers();
      if (cached) {
        const etag = cached.headers.get('ETag');
        if (etag) headers.set('If-None-Match', etag);
      }
      const res = await fetch(url, { credentials: 'include', headers });
      if (res && res.ok && res.status === 200) {
        await cache.put(url, res.clone()).catch(()=>{});
      }
    } catch(e) {}
  }));
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
  // app.js / sw-update.js も staticCacheFirst だと最新版が即時反映されない。
  // _headers が no-cache なので素通しすればブラウザが ETag/304 で軽量に動く。
  if (url.pathname === '/app.js') return;
  if (url.pathname === '/sw-update.js') return;
  if (url.pathname.startsWith('/cdn-cgi/')) return;
  if (url.pathname.startsWith('/admin/')) return;
  // 画像プロキシは SW を介さずブラウザ HTTP cache（24h immutable）に任せる
  // SW networkFirst を通すと毎回往復が発生して 1〜3秒/枚になる
  if (url.pathname === '/api/img') return;

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
