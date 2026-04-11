/**
 * 写メジャー Service Worker
 * 戦略: Network First + キャッシュフォールバック（タスキ箱方式）
 */
const CACHE_NAME = 'shameasure-20260326214951';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // 古いキャッシュを削除
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // POST（画像アップロード等）はキャッシュしない
  if (e.request.method !== 'GET') return;
  // API呼び出しはキャッシュしない
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).then(r => {
      // 成功したらキャッシュに保存（HTML/JS/CSS/faviconのみ）
      if (r.ok && (
        e.request.url.endsWith('.html') ||
        e.request.url.endsWith('.js') ||
        e.request.url.endsWith('.css') ||
        e.request.url.endsWith('.json') ||
        e.request.url.includes('/favicon')
      )) {
        const clone = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => {
      // ネットワーク失敗時はキャッシュから返す
      return caches.match(e.request);
    })
  );
});

// メインスレッドからの更新チェックメッセージ
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_UPDATE') {
    self.registration.update();
  }
});
