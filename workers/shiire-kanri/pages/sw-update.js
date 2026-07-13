// ===== PWA 更新マネージャ =====
// 目的: アプリ化したまま使うユーザーが古いバージョンに固定されないようにする
// 戦略:
//   1) 起動時 + 可視化時 + 5分ごとに reg.update() を強制
//   2) 起動時に waiting の新 SW がいたら SKIP_WAITING でサイレント適用（リロードしない。
//      /app.js と /sw-update.js は SW 非介入で毎回ネットワークから読むため、
//      ページは起動時点で常に最新コードで動いている＝世代交代にリロード不要）
//   3) セッション途中に新 SW を検知したらバナー通知のみ。「更新」を押したときだけ
//      SKIP_WAITING → リロードで即時適用する
//   4) controllerchange / SW_ACTIVATED での自動リロードは「更新ボタンを押した後」限定
//      （閲覧中の無断リロード＝商品管理タブへの差し戻しの原因だったため廃止）
(function setupPwaUpdater(){
  if (!('serviceWorker' in navigator)) return;

  // ページ読み込み時点でコントローラ(=既存SW)が居たか。
  // 初回インストールでは clients.claim() で controllerchange / SW_ACTIVATED が発火するが、
  // これは「更新」ではないので自動リロードしてはいけない（初回アクセスで無駄な再読込が走る）。
  // 真の更新ではページは旧SW配下で読み込まれている＝ここが true になる。
  var hadControllerAtLoad = !!navigator.serviceWorker.controller;

  // ✕ で閉じたバージョンを localStorage に記憶
  // 同一バージョンの waiting に対しては再表示しない（無限再表示ループ対策）
  var DISMISS_KEY = 'pwa-dismissed-version';
  function getDismissedVersion() {
    try { return localStorage.getItem(DISMISS_KEY) || ''; } catch(e) { return ''; }
  }
  function setDismissedVersion(v) {
    if (!v) return;
    try { localStorage.setItem(DISMISS_KEY, v); } catch(e) {}
  }

  // waiting/installing SW にバージョンを問い合わせ（最大1秒待つ）
  function getSwVersion(sw) {
    return new Promise(function(resolve){
      if (!sw) { resolve(''); return; }
      var done = false;
      function onMsg(ev) {
        var d = ev.data || {};
        if (d.type === 'VERSION') {
          if (done) return;
          done = true;
          try { navigator.serviceWorker.removeEventListener('message', onMsg); } catch(e) {}
          resolve(d.version || '');
        }
      }
      try { navigator.serviceWorker.addEventListener('message', onMsg); } catch(e) {}
      try { sw.postMessage({ type: 'GET_VERSION' }); } catch(e) {}
      setTimeout(function(){
        if (done) return;
        done = true;
        try { navigator.serviceWorker.removeEventListener('message', onMsg); } catch(e) {}
        resolve('');
      }, 1000);
    });
  }

  function isEditing() {
    // 詳細／新規作成画面で未保存の変更がある場合はリロードを保留
    try {
      if (typeof STATE !== 'undefined' && STATE) {
        if (STATE.detailDirty) return true;
        if (STATE.createDirty) return true;
      }
    } catch(e) {}
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return true;
    return false;
  }

  // 重複リロード/タイマーリロードの暴発を防ぐ
  var didReload = false;
  var pendingApplyTimer = null;
  // 「更新」ボタン押下後だけ true になる。controllerchange / SW_ACTIVATED での
  // リロードはこのフラグが立っているときに限定（サイレント適用ではリロードしない）
  var applyRequested = false;
  function safeReload() {
    if (didReload) return;
    didReload = true;
    if (pendingApplyTimer) { clearTimeout(pendingApplyTimer); pendingApplyTimer = null; }
    // リロード直前に画面状態（タブ・詳細）を保存 → 再読込後に app.js が復元する
    try { if (window.saveUiState_) window.saveUiState_(); } catch(e) {}
    try { window.location.reload(); } catch(e) {}
  }

  function showUpdateBanner(onApply, version) {
    var existing = document.getElementById('pwa-update-banner');
    if (existing) existing.remove();
    var bar = document.createElement('div');
    bar.id = 'pwa-update-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:max(12px,env(safe-area-inset-bottom));' +
      'transform:translateX(-50%);z-index:9999;' +
      'background:#1565c0;color:#fff;border-radius:24px;padding:10px 14px 10px 16px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;' +
      'max-width:calc(100vw - 24px);';
    bar.innerHTML =
      '<span id="pwa-update-msg">新しいバージョンが利用できます</span>' +
      '<button id="pwa-update-btn" style="appearance:none;border:none;background:#fff;color:#1565c0;' +
      'font-weight:700;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:13px;">更新</button>' +
      '<button id="pwa-update-close" aria-label="閉じる" style="appearance:none;border:none;background:transparent;' +
      'color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:4px 6px;">×</button>';
    document.body.appendChild(bar);
    document.getElementById('pwa-update-btn').addEventListener('click', function(){
      // 押した瞬間にバージョンを dismissed として記録（リロード遅延中の重複表示防止）
      if (version) setDismissedVersion(version);
      var msg = document.getElementById('pwa-update-msg');
      if (msg) msg.textContent = '更新中…';
      var btn = document.getElementById('pwa-update-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'default'; }
      try { onApply(); } catch(e) { safeReload(); }
    });
    document.getElementById('pwa-update-close').addEventListener('click', function(){
      // ✕ で閉じたら同一バージョンは二度と出さない
      if (version) setDismissedVersion(version);
      bar.remove();
    });
  }

  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(reg) {
    // 更新ボタン押下時の共通処理
    // SKIP_WAITING を送って新 SW を起こすと同時に、controllerchange を待たず
    // 短い fallback タイマーで強制リロードする（iOS スタンドアロンで
    // controllerchange が発火しないケースの保険）
    function applyUpdate() {
      applyRequested = true;
      var waiting = reg.waiting;
      if (waiting) {
        try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch(e) {}
      }
      // 5秒以内に controllerchange/SW_ACTIVATED でリロードされなければ強制リロード
      // iOS スタンドアロンで activate + clients.claim() が完了する前に reload してしまうと
      // 古い SW がコントローラのままページが復活し、新 SW は再び waiting に残る → 無限ループ
      if (pendingApplyTimer) clearTimeout(pendingApplyTimer);
      pendingApplyTimer = setTimeout(function(){ safeReload(); }, 5000);
    }

    // waiting がいれば、dismiss 済みでなければバナーを出す
    function promptIfWaiting() {
      var waiting = reg.waiting;
      if (!waiting) return;
      getSwVersion(waiting).then(function(v){
        if (v && getDismissedVersion() === v) return; // 同一バージョンは無視
        showUpdateBanner(applyUpdate, v);
      });
    }

    // 起動時: waiting の新 SW がいたらサイレントに切り替える（バナーもリロードも無し）。
    // ページは毎回ネットワークから最新 /app.js を読んでいるため、ここで静かに
    // 世代交代させればシェルキャッシュも次回起動から新版になる。
    (function activateSilentlyAtStartup() {
      var waiting = reg.waiting;
      if (!waiting) return;
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch(e) {}
    })();

    reg.addEventListener('updatefound', function(){
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function(){
        if (nw.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // 既に SW が走っている → 新版が waiting で待っている状態
            promptIfWaiting();
          }
          // 初回インストール時はユーザーに通知不要（そのまま使える）
        }
      });
    });

    // 起動直後に一度更新チェック
    try { reg.update(); } catch(e) {}

    // フォアグラウンド復帰 → 必ず更新チェック（iOS スタンドアロンの取りこぼし対策）
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') {
        try { reg.update(); } catch(e) {}
      }
    });

    // 5分ごとにも自動更新チェック
    setInterval(function(){ try { reg.update(); } catch(e) {} }, 5 * 60 * 1000);
  }).catch(function(){ /* SW 登録失敗は致命的ではない */ });

  // controllerchange = 新 SW がページを掌握した瞬間
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (didReload) return;
    // 初回インストールの claim による発火はリロードしない（更新ではない）
    if (!hadControllerAtLoad) return;
    // 「更新」ボタン押下後だけリロード（起動時サイレント適用では発火してもリロードしない）
    if (!applyRequested) return;
    if (isEditing()) {
      // 編集中はリロードせず通知のみ
      showUpdateBanner(function(){ safeReload(); });
      return;
    }
    safeReload();
  });

  // SW activate 時の自前メッセージ（iOS スタンドアロンで controllerchange が
  // 取りこぼされたときの安全網）
  navigator.serviceWorker.addEventListener('message', function(ev){
    var d = ev.data || {};
    if (d.type !== 'SW_ACTIVATED') return;
    if (d.version) setDismissedVersion(d.version); // activate 完了 → 旧 dismiss はクリア相当
    if (didReload) return;
    // 初回インストールの activate ではリロードしない（controllerchange と同じ理由）
    if (!hadControllerAtLoad) return;
    // 「更新」ボタン押下後だけリロード（controllerchange と同じゲート）
    if (!applyRequested) return;
    if (isEditing()) {
      showUpdateBanner(function(){ safeReload(); });
      return;
    }
    safeReload();
  });
})();
