/**
 * アップロードページHTML（自己完結型、スマホ最適化）
 *
 * セクション1: 画像アップロード（管理番号+最大10枚、既存画像検出・追加・上書き・並び替え）
 * セクション2: 商品管理（一括DL・画像検索・削除・並び替えを統合）
 */
export function getUploadPageHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>商品画像アップロード | デタウリ</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;line-height:1.5;padding-bottom:calc(80px + env(safe-area-inset-bottom))}
.container{max-width:600px;margin:0 auto;padding:16px}
h1{font-size:20px;text-align:center;padding:16px 0;color:#1a1a2e}
h2{font-size:16px;color:#1a1a2e;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.form-group{margin-bottom:12px}
label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px}
input[type=text],input[type=password],input[type=date],select{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;-webkit-appearance:none}
input[type=file]{width:100%;padding:8px;border:1.5px dashed #ccc;border-radius:8px;font-size:14px;background:#fafafa}
.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:#3b82f6;color:#fff}
.btn-primary:hover:not(:disabled){background:#2563eb}
.btn-danger{background:#ef4444;color:#fff}
.btn-secondary{background:#6b7280;color:#fff}
.btn-secondary:hover:not(:disabled){background:#4b5563}
.btn-success{background:#10b981;color:#fff}
.btn-success:hover:not(:disabled){background:#059669}
.status{padding:10px;border-radius:8px;margin-top:8px;font-size:13px;display:none}
.status.show{display:block}
.status.ok{background:#d1fae5;color:#065f46}
.status.err{background:#fee2e2;color:#991b1b}
.status.info{background:#dbeafe;color:#1e40af}
.preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin-top:8px}
.preview-item{position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;background:#f3f4f6}
.preview-item img{width:100%;height:100%;object-fit:cover}
.preview-item .badge{position:absolute;top:2px;left:2px;background:rgba(59,130,246,.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:4px}
.progress-bar{width:100%;height:6px;background:#e5e7eb;border-radius:3px;margin-top:8px;overflow:hidden;display:none}
.progress-bar.show{display:block}
.progress-bar .fill{height:100%;background:#3b82f6;border-radius:3px;transition:width .3s}
.list-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6}
.list-item:last-child{border-bottom:none}
.list-thumb{width:48px;height:48px;border-radius:6px;object-fit:cover;background:#eee;flex-shrink:0}
.list-info{flex:1;min-width:0}
.list-id{font-weight:600;font-size:14px}
.list-count{font-size:12px;color:#888}
.list-check{width:20px;height:20px;accent-color:#3b82f6}
.dl-status{font-size:11px;color:#10b981;display:none}
.dl-status.show{display:inline}
.tab-bar{display:flex;gap:4px;margin-bottom:12px;background:#f3f4f6;border-radius:10px;padding:4px;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap}
.tab{flex:none;min-width:70px;padding:8px;text-align:center;font-size:13px;font-weight:600;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#666;white-space:nowrap}
.tab.active{background:#fff;color:#1a1a2e;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.section{display:none}
.section.active{display:block}
.auth-wall{text-align:center;padding:40px 16px}
.auth-wall h2{border:none;color:#6b7280}
.hidden{display:none}
.select-all-row{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:#666}
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px}
.search-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;font-size:24px;opacity:0;transition:opacity .2s;cursor:pointer;border-radius:6px}
.search-item:hover .search-overlay,.search-item:active .search-overlay{opacity:1}
.replace-btn{position:absolute;bottom:2px;right:2px;background:rgba(255,255,255,.9);border-radius:4px;font-size:12px;padding:2px 4px;cursor:pointer}
.img-check-wrap{position:relative}
.img-check-wrap input[type=checkbox]{position:absolute;top:4px;left:4px;z-index:2;width:18px;height:18px;accent-color:#3b82f6}
.img-check-wrap .badge{left:auto;right:2px}
.sticky-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e7eb;padding:10px 16px calc(10px + env(safe-area-inset-bottom));z-index:50;display:none}
.sticky-footer.show{display:block}
.sticky-footer .footer-inner{max-width:600px;margin:0 auto;display:flex;gap:8px}
.sticky-footer .footer-inner .btn{flex:1;margin:0;padding:10px;font-size:14px}
.del-check{width:20px;height:20px;accent-color:#ef4444;flex-shrink:0}
.manage-sticky-header{position:sticky;top:0;z-index:20;background:#fff;padding:12px 16px 8px;border-radius:12px 12px 0 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
@media(max-width:480px){.img-grid{grid-template-columns:repeat(2,1fr)}.preview-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:481px) and (max-width:768px){.img-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:769px){.img-grid{grid-template-columns:repeat(4,1fr)}}
</style>
</head>
<body>
<div class="container">
  <h1>商品画像アップロード</h1>

  <!-- 認証フォーム -->
  <div id="authSection" class="card auth-wall">
    <h2>パスワードを入力</h2>
    <div class="form-group" style="margin-top:16px;position:relative">
      <input type="password" id="authPassword" placeholder="パスワード" autocomplete="off">
      <button type="button" id="pwToggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:18px;cursor:pointer;padding:4px">👁</button>
    </div>
    <button class="btn btn-primary" id="authBtn">認証</button>
    <div class="status" id="authStatus"></div>
  </div>

  <!-- メインUI（認証後に表示） -->
  <div id="mainSection" class="hidden">
    <div class="tab-bar">
      <button class="tab active" onclick="switchTab('upload')">アップロード <span id="unmatchedBadge" style="display:none;background:#ef4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:8px;margin-left:2px"></span></button>
      <button class="tab" onclick="switchTab('manage')">商品管理</button>
    </div>

    <!-- 撮影者選択モーダル -->
    <div id="photographerModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:100;align-items:center;justify-content:center">
      <div class="card" style="width:90%;max-width:400px;margin:0">
        <h2 style="border:none;text-align:center">撮影者を選択</h2>
        <div class="form-group" style="margin-top:12px">
          <select id="photographerSelect"><option value="">読み込み中...</option></select>
        </div>
        <button class="btn btn-primary" id="photographerConfirmBtn" onclick="confirmPhotographer()">決定</button>
      </div>
    </div>

    <!-- 撮影者バー -->
    <div id="photographerBar" class="card" style="display:none;align-items:center;justify-content:space-between;padding:10px 16px">
      <span style="font-size:13px">撮影者: <strong id="photographerName">-</strong></span>
      <button class="btn btn-secondary" style="width:auto;padding:6px 12px;font-size:12px" onclick="showPhotographerModal()">変更</button>
    </div>

    <!-- セクション1: アップロード -->
    <div class="section active" id="sec-upload">
      <div class="card">
        <h2>画像アップロード</h2>
        <div class="form-group">
          <label>管理番号</label>
          <input type="text" id="uploadManagedId" placeholder="例: A001" autocomplete="off">
        </div>
        <div class="form-group">
          <label>撮影日付</label>
          <input type="date" id="photographyDate">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
            <input type="checkbox" id="overwritePhotographer" style="width:18px;height:18px">
            <span style="font-size:13px">撮影者・撮影日を上書きする</span>
          </label>
        </div>
        <div id="existingImages" class="hidden" style="margin-top:12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px" id="existingCount"></div>
          <div class="preview-grid" id="existingGrid"></div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>画像（最大10枚）</label>
          <input type="file" id="uploadFiles" multiple accept="image/*" onchange="showPreview()">
        </div>
        <div class="preview-grid" id="uploadPreview"></div>
        <div class="progress-bar" id="uploadProgress"><div class="fill" id="uploadProgressFill"></div></div>
        <div class="status" id="uploadStatus"></div>
      </div>
    </div>

    <!-- セクション2: 商品管理（一括DL・検索・削除・並び替え統合） -->
    <div class="section" id="sec-manage">
      <div class="manage-sticky-header">
        <div class="form-group" style="margin-bottom:8px">
          <input type="text" id="manageSearch" placeholder="管理番号で検索..." autocomplete="off" oninput="filterManageList()">
        </div>
        <div class="status" id="manageLoadStatus"></div>
        <div class="select-all-row hidden" id="selectAllRow">
          <input type="checkbox" id="selectAll" class="list-check" onchange="toggleSelectAll()">
          <span>すべて選択（表示中）</span>
          <span style="margin-left:auto" id="selectedCount">0件選択</span>
        </div>
      </div>
      <div class="card" style="margin-top:0;border-top-left-radius:0;border-top-right-radius:0">
        <div id="manageList"></div>
        <div class="status" id="manageStatus"></div>
      </div>
    </div>
  </div>

  <!-- 固定フッタ -->
  <div class="sticky-footer" id="footer-upload">
    <div class="footer-inner">
      <button class="btn btn-primary" id="uploadBtn" onclick="doUpload()" disabled>アップロード</button>
    </div>
  </div>
  <div class="sticky-footer" id="footer-manage">
    <div class="footer-inner" style="flex-wrap:wrap;gap:6px">
      <button class="btn btn-success" style="flex:1;min-width:45%" id="dlTopBtn" onclick="doDownloadTopImages()">トップ画像を保存</button>
      <button class="btn btn-primary" style="flex:1;min-width:45%" id="dlAllBtn" onclick="doDownloadAllImages()">全画像を保存</button>
      <button class="btn btn-danger" style="flex:1;min-width:100%" id="deleteSelectedBtn" onclick="doDeleteSelected()" disabled>選択した商品を削除</button>
    </div>
  </div>

  <!-- 確認モーダル -->
  <div id="confirmModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center">
    <div class="card" style="width:90%;max-width:360px;margin:0;text-align:center">
      <p id="confirmMessage" style="font-size:14px;font-weight:600;margin-bottom:16px"></p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" style="flex:1" onclick="closeConfirm(false)">キャンセル</button>
        <button class="btn btn-danger" style="flex:1" onclick="closeConfirm(true)">削除する</button>
      </div>
    </div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script>
// ─── 設定 ───
var API_BASE = location.origin;
var TOKEN_KEY = 'detauri_upload_token';
var PHOTOGRAPHER_KEY = 'detauri_photographer';
var _workersList = [];

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }

function headers(extra) {
  var h = { 'Authorization': 'Bearer ' + getToken() };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function showStatus(id, msg, type) {
  var el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status show ' + type;
}

// ─── 初期化 ───
(function init() {
  if (getToken()) {
    fetch(API_BASE + '/upload/list', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: '{}'
    }).then(function(r) {
      if (r.ok) showMain();
      else showAuth();
    }).catch(function() { showAuth(); });
  } else {
    showAuth();
  }
})();

function showAuth() {
  document.getElementById('authSection').classList.remove('hidden');
  document.getElementById('mainSection').classList.add('hidden');
}
function showMain() {
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('mainSection').classList.remove('hidden');
  document.getElementById('footer-upload').classList.add('show');
  var today = new Date();
  var yyyy = today.getFullYear();
  var mm = String(today.getMonth() + 1).padStart(2, '0');
  var dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('photographyDate').value = yyyy + '-' + mm + '-' + dd;
  initPhotographer();
  loadUnmatchedCount();
}

function loadUnmatchedCount() {
  fetch(API_BASE + '/upload/unmatched', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: '{}'
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok && d.total > 0) {
      var badge = document.getElementById('unmatchedBadge');
      badge.textContent = d.total;
      badge.style.display = 'inline';
      // 7日以上の警告があれば赤く
      var hasWarning = d.items && d.items.some(function(i) { return i.warning; });
      if (hasWarning) badge.style.background = '#ef4444';
      else badge.style.background = '#f59e0b';
    }
  }).catch(function() {});
}

function initPhotographer() {
  fetch(API_BASE + '/upload/workers', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: '{}'
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok && d.workers) _workersList = d.workers;
    var saved = localStorage.getItem(PHOTOGRAPHER_KEY);
    if (saved && _workersList.some(function(w) { return w.name === saved; })) {
      setPhotographer(saved);
    } else {
      showPhotographerModal();
    }
  }).catch(function() {
    var saved = localStorage.getItem(PHOTOGRAPHER_KEY);
    if (saved) setPhotographer(saved);
    else showPhotographerModal();
  });
}

function showPhotographerModal() {
  var select = document.getElementById('photographerSelect');
  select.innerHTML = '<option value="">-- 選択してください --</option>';
  for (var i = 0; i < _workersList.length; i++) {
    var opt = document.createElement('option');
    opt.value = _workersList[i].name;
    opt.textContent = _workersList[i].name;
    select.appendChild(opt);
  }
  var saved = localStorage.getItem(PHOTOGRAPHER_KEY);
  if (saved) select.value = saved;
  var modal = document.getElementById('photographerModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function confirmPhotographer() {
  var val = document.getElementById('photographerSelect').value;
  if (!val) return;
  setPhotographer(val);
  var modal = document.getElementById('photographerModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function setPhotographer(name) {
  localStorage.setItem(PHOTOGRAPHER_KEY, name);
  document.getElementById('photographerName').textContent = name;
  var bar = document.getElementById('photographerBar');
  bar.classList.remove('hidden');
  bar.style.display = 'flex';
}

// ─── 認証 ───
function doAuth() {
  var pw = document.getElementById('authPassword').value.trim();
  if (!pw) return;
  var btn = document.getElementById('authBtn');
  btn.disabled = true;
  fetch(API_BASE + '/upload/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    if (d.ok) {
      setToken(d.token);
      showMain();
    } else {
      showStatus('authStatus', d.message || 'エラー', 'err');
    }
  }).catch(function(e) {
    btn.disabled = false;
    showStatus('authStatus', 'ネットワークエラー: ' + e.message, 'err');
  });
}

document.getElementById('pwToggle').addEventListener('click', function() {
  var inp = document.getElementById('authPassword');
  if (inp.type === 'password') {
    inp.type = 'text';
    this.textContent = '🔒';
  } else {
    inp.type = 'password';
    this.textContent = '👁';
  }
});

document.getElementById('authPassword').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doAuth();
});

document.getElementById('authBtn').addEventListener('click', function() {
  doAuth();
});

// ─── タブ切り替え ───
function switchTab(name) {
  var tabs = document.querySelectorAll('.tab');
  var secs = document.querySelectorAll('.section');
  var tabNames = ['upload','manage'];
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', tabNames[i] === name);
  });
  secs.forEach(function(s) { s.classList.toggle('active', s.id === 'sec-' + name); });
  // フッタ切り替え
  tabNames.forEach(function(t) {
    var f = document.getElementById('footer-' + t);
    if (f) f.classList.toggle('show', t === name);
  });
  if (name === 'manage') ensureListLoaded(function() { renderManageList(); });
}

// ─── セクション1: アップロード（既存画像検出付き） ───
var _existingUrls = [];
var _uploadMode = 'new'; // 'new' or 'append'
var _managedIdTimer = null;

document.getElementById('uploadManagedId').addEventListener('input', function() {
  clearTimeout(_managedIdTimer);
  var mid = normId(this.value);
  if (mid.length < 2) { hideExistingImages(); return; }
  _managedIdTimer = setTimeout(function() { checkExistingImages(mid); }, 500);
});

function checkExistingImages(managedId) {
  fetch(API_BASE + '/upload/product-images', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok && d.urls && d.urls.length > 0) {
      _existingUrls = d.urls;
      _uploadMode = 'append';
      showExistingImages(d.urls, managedId);
    } else {
      _existingUrls = [];
      _uploadMode = 'new';
      hideExistingImages();
    }
  }).catch(function() { _existingUrls = []; _uploadMode = 'new'; hideExistingImages(); });
}

function showExistingImages(urls, managedId) {
  var container = document.getElementById('existingImages');
  container.classList.remove('hidden');
  document.getElementById('existingCount').textContent = urls.length + '枚登録済み（あと' + (10 - urls.length) + '枚追加可能）';
  var grid = document.getElementById('existingGrid');
  var html = '';
  for (var i = 0; i < urls.length; i++) {
    html += '<div class="preview-item" draggable="true" data-idx="' + i + '">' +
      '<img src="' + API_BASE + urls[i] + '?t=' + Date.now() + '">' +
      '<span class="badge">' + (i === 0 ? 'トップ' : (i+1)) + '</span>' +
      '<span class="replace-btn" data-url="' + escapeHtml(urls[i]) + '" onclick="startReplace(this.dataset.url)">🔄</span>' +
      '</div>';
  }
  grid.innerHTML = html;
  initDragReorder(grid, managedId);
}

function hideExistingImages() {
  _existingUrls = [];
  _uploadMode = 'new';
  document.getElementById('existingImages').classList.add('hidden');
  document.getElementById('existingGrid').innerHTML = '';
}

// ─── ドラッグ&ドロップ並び替え（自動保存） ───
function initDragReorder(grid, managedId) {
  initManageDragReorder(grid, managedId, function() { saveReorder(managedId); });
}

function saveReorder(managedId) {
  var items = document.getElementById('existingGrid').querySelectorAll('.preview-item');
  var newOrder = [];
  items.forEach(function(item, i) {
    var img = item.querySelector('img');
    var url = img.src.replace(API_BASE, '').replace(/\\?t=\\d+$/, '');
    newOrder.push(url);
    var badge = item.querySelector('.badge');
    badge.textContent = i === 0 ? 'トップ' : (i + 1);
  });

  fetch(API_BASE + '/upload/reorder', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId, newOrder: newOrder })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      _existingUrls = d.urls || newOrder;
      showStatus('uploadStatus', '並び替えを保存しました', 'ok');
    } else {
      showStatus('uploadStatus', d.message || '並び替えエラー', 'err');
    }
  }).catch(function() { showStatus('uploadStatus', '並び替えエラー', 'err'); });
}

// ─── 画像上書き（Replace） ───
function startReplace(targetUrl) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function() {
    if (!input.files || !input.files[0]) return;
    var mid = normId(document.getElementById('uploadManagedId').value);
    var isTop = _existingUrls.indexOf(targetUrl) === 0;
    var maxSize = isTop ? 1200 : 800;
    var quality = isTop ? 0.80 : 0.75;
    showStatus('uploadStatus', '上書き中...', 'info');
    resizeImage(input.files[0], maxSize, quality, function(blob) {
      var fd = new FormData();
      fd.append('managedId', mid);
      fd.append('targetUrl', targetUrl);
      fd.append('images', blob, 'replace.jpg');
      fetch(API_BASE + '/upload/update-image', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() },
        body: fd
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          _existingUrls = d.urls;
          showExistingImages(d.urls, mid);
          showStatus('uploadStatus', '画像を上書きしました', 'ok');
        } else {
          showStatus('uploadStatus', d.message || '上書きエラー', 'err');
        }
      }).catch(function() { showStatus('uploadStatus', '上書きエラー', 'err'); });
    });
  };
  input.click();
}

// ─── プレビュー・アップロード ───
function showPreview() {
  var input = document.getElementById('uploadFiles');
  var grid = document.getElementById('uploadPreview');
  var btn = document.getElementById('uploadBtn');
  grid.innerHTML = '';
  var files = input.files;
  if (!files || files.length === 0) { btn.disabled = true; return; }
  var maxNew = 10 - _existingUrls.length;
  if (files.length > maxNew) {
    showStatus('uploadStatus', '画像は最大10枚までです（既存' + _existingUrls.length + '枚＋新規は' + maxNew + '枚まで）', 'err');
    input.value = '';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  for (var i = 0; i < files.length; i++) {
    var div = document.createElement('div');
    div.className = 'preview-item';
    var labelIdx = _existingUrls.length + i;
    var objUrl = URL.createObjectURL(files[i]);
    div.innerHTML = '<img src="' + objUrl + '" loading="lazy">' +
      (labelIdx === 0 ? '<span class="badge">トップ</span>' : '<span class="badge">' + (labelIdx+1) + '</span>');
    grid.appendChild(div);
  }
}

function doUpload() {
  var managedId = normId(document.getElementById('uploadManagedId').value);
  if (!managedId) { showStatus('uploadStatus', '管理番号を入力してください', 'err'); return; }
  var photographer = localStorage.getItem(PHOTOGRAPHER_KEY) || '';
  if (!photographer) { showStatus('uploadStatus', '撮影者を選択してください', 'err'); showPhotographerModal(); return; }
  var photographyDate = document.getElementById('photographyDate').value || '';
  var input = document.getElementById('uploadFiles');
  var files = input.files;
  if (!files || files.length === 0) { showStatus('uploadStatus', '画像を選択してください', 'err'); return; }

  var btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  var bar = document.getElementById('uploadProgress');
  var fill = document.getElementById('uploadProgressFill');
  bar.classList.add('show');
  fill.style.width = '0%';
  showStatus('uploadStatus', 'リサイズ中...', 'info');

  resizeAllImages(files, function(blobs) {
    showStatus('uploadStatus', '0/' + blobs.length + ' アップロード中...', 'info');
    uploadInParallel(managedId, blobs, 3, photographer, photographyDate, function(done, total) {
      fill.style.width = Math.round(done / total * 100) + '%';
      showStatus('uploadStatus', done + '/' + total + ' アップロード中...', 'info');
    }, function(err, response) {
      btn.disabled = false;
      bar.classList.remove('show');
      if (err) {
        showStatus('uploadStatus', 'エラー: ' + err, 'err');
      } else {
        if (response && response.registered === false) {
          showStatus('uploadStatus', blobs.length + '枚アップロード完了（撮影先行: 採寸情報入力後に自動連携されます）', 'info');
        } else {
          showStatus('uploadStatus', blobs.length + '枚アップロード完了', 'ok');
        }
        input.value = '';
        document.getElementById('uploadPreview').innerHTML = '';
        // 確認画面: 管理番号+サムネイルを表示
        var mid = normId(document.getElementById('uploadManagedId').value);
        checkExistingImages(mid);
      }
    });
  });
}

function resizeAllImages(files, cb) {
  var results = [];
  var idx = 0;
  var done = 0;
  var concurrency = 2; // 2枚並列（iOS安全圏内）
  function next() {
    while (idx < files.length && (idx - done) < concurrency) {
      (function(i) {
        idx++;
        var isTop = (_existingUrls.length === 0 && i === 0);
        var maxSize = isTop ? 1200 : 800;
        var quality = isTop ? 0.80 : 0.75;
        resizeImage(files[i], maxSize, quality, function(blob) {
          results[i] = blob;
          done++;
          if (done === files.length) { cb(results); return; }
          next();
        });
      })(idx);
    }
  }
  next();
}

function resizeImage(file, maxSize, quality, cb) {
  // createImageBitmap対応チェック（Canvas不要で高速+省メモリ）
  if (typeof createImageBitmap === 'function') {
    createImageBitmap(file).then(function(bmp) {
      var w = bmp.width, h = bmp.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      canvas.toBlob(function(blob) {
        canvas.width = 0; canvas.height = 0;
        cb(blob);
      }, 'image/jpeg', quality);
    }).catch(function() { resizeImageFallback(file, maxSize, quality, cb); });
  } else {
    resizeImageFallback(file, maxSize, quality, cb);
  }
}

function resizeImageFallback(file, maxSize, quality, cb) {
  var img = new Image();
  var objUrl = URL.createObjectURL(file);
  img.onload = function() {
    URL.revokeObjectURL(objUrl);
    var w = img.width, h = img.height;
    if (w > maxSize || h > maxSize) {
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob(function(blob) {
      canvas.width = 0; canvas.height = 0;
      cb(blob);
    }, 'image/jpeg', quality);
  };
  img.onerror = function() { URL.revokeObjectURL(objUrl); cb(file); };
  img.src = objUrl;
}

function uploadInParallel(managedId, blobs, concurrency, photographer, photographyDate, onProgress, onDone) {
  var fd = new FormData();
  fd.append('managedId', managedId);
  fd.append('action', _uploadMode); // 'new' or 'append'
  if (document.getElementById('overwritePhotographer').checked) fd.append('overwritePhotographer', 'true');
  if (photographer) fd.append('photographer', photographer);
  if (photographyDate) fd.append('photographyDate', photographyDate);
  for (var i = 0; i < blobs.length; i++) {
    fd.append('images', blobs[i], (i + 1) + '.jpg');
  }

  fetch(API_BASE + '/upload/images', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + getToken() },
    body: fd
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      onProgress(blobs.length, blobs.length);
      onDone(null, d);
    } else {
      if (d.message && d.message.indexOf('トークン') >= 0) { showAuth(); }
      onDone(d.message || 'アップロード失敗');
    }
  }).catch(function(e) { onDone(e.message); });
}

// ─── 共通: 商品一覧データ ───
var productListData = [];
var _listLoaded = false;

function ensureListLoaded(cb) {
  if (_listLoaded) { cb(); return; }
  showStatus('manageLoadStatus', '読み込み中...', 'info');
  fetch(API_BASE + '/upload/list', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: '{}'
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) {
      if (d.message && d.message.indexOf('トークン') >= 0) showAuth();
      showStatus('manageLoadStatus', d.message || 'エラー', 'err');
      return;
    }
    productListData = d.items || [];
    _listLoaded = true;
    if (productListData.length === 0) {
      showStatus('manageLoadStatus', 'アップロード済み商品はありません', 'info');
    } else {
      showStatus('manageLoadStatus', productListData.length + '件の商品', 'ok');
    }
    cb();
  }).catch(function(e) { showStatus('manageLoadStatus', 'ネットワークエラー', 'err'); });
}

function reloadList(cb) {
  _listLoaded = false;
  ensureListLoaded(cb || function(){});
}

// ─── セクション2: 商品管理（統合） ───
var _dlExpandedData = []; // [{mid, urls, filename}...]
var _manageExpandedMid = '';
var _manageExpandedUrls = []; // 展開中の商品の画像URL配列

function filterManageList() {
  ensureListLoaded(function() { renderManageList(); });
}

function renderManageList() {
  var q = normId(document.getElementById('manageSearch').value);
  var el = document.getElementById('manageList');
  var html = '';
  var count = 0;
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    if (q && p.managedId.toUpperCase().indexOf(q) === -1) continue;
    count++;
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div id="manage-row-' + escapeHtml(p.managedId) + '">' +
      '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-idx="' + i + '" data-mid="' + escapeHtml(p.managedId) + '" onchange="updateSelectedCount();updateDeleteSelectedCount()" onclick="event.stopPropagation()">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">' : '<div class="list-thumb" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')"></div>') +
      '<div class="list-info" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')" style="cursor:pointer"><div class="list-id">' + escapeHtml(p.managedId) + (p.warning ? ' <span style="background:#ef4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">採寸情報未登録</span>' : !p.registered ? ' <span style="background:#f59e0b;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">採寸情報未登録</span>' : '') + '</div>' +
      '<div class="list-count">' + p.count + '枚</div></div>' +
      '<span style="color:#3b82f6;font-size:20px;padding:0 8px;cursor:pointer" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">›</span>' +
      '</div></div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('selectAllRow').classList.remove('hidden');
  _manageExpandedMid = '';
  updateSelectedCount();
  updateDeleteSelectedCount();
}

function toggleSelectAll() {
  var checked = document.getElementById('selectAll').checked;
  document.querySelectorAll('.dl-check').forEach(function(c) {
    c.checked = checked;
  });
  updateSelectedCount();
  updateDeleteSelectedCount();
}

function updateSelectedCount() {
  var checks = document.querySelectorAll('.dl-check:checked');
  document.getElementById('selectedCount').textContent = checks.length + '件選択';
}

function toggleManageExpand(managedId) {
  // 同じ商品をもう一度タップしたら閉じる
  if (_manageExpandedMid === managedId) {
    var existing = document.getElementById('manageDetailInline');
    if (existing) { existing.remove(); _manageExpandedMid = ''; return; }
  }
  _manageExpandedMid = managedId;

  // 既存のインライン詳細を閉じる
  var old = document.getElementById('manageDetailInline');
  if (old) old.remove();

  var row = document.getElementById('manage-row-' + managedId);
  if (!row) return;
  var detail = document.createElement('div');
  detail.id = 'manageDetailInline';
  detail.style.cssText = 'background:#eff6ff;border-radius:8px;padding:12px;margin:4px 0 8px';
  detail.innerHTML = '<div style="text-align:center;color:#666;font-size:13px">読み込み中...</div>';
  row.after(detail);

  fetch(API_BASE + '/upload/product-images', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    var el = document.getElementById('manageDetailInline');
    if (!el) return;
    if (!d.ok) { showStatus('manageStatus', d.message || 'エラー', 'err'); return; }
    var urls = d.urls || [];
    _manageExpandedUrls = urls;
    // _dlExpandedData に追加（DL用）
    _dlExpandedData = [];
    for (var i = 0; i < urls.length; i++) {
      _dlExpandedData.push({ mid: managedId, url: urls[i], idx: i });
    }
    var html = '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + escapeHtml(managedId) + ' (' + urls.length + '枚)</div>';
    // 画像グリッド（ドラッグ並び替え対応）
    html += '<div class="img-grid" id="manageImageGrid">';
    for (var j = 0; j < urls.length; j++) {
      var fullUrl = API_BASE + urls[j];
      html += '<div class="img-check-wrap preview-item" draggable="true" data-idx="' + j + '" onclick="toggleImgCheck(this,event)" style="cursor:pointer">' +
        '<input type="checkbox" class="dl-img-check" data-mid="' + escapeHtml(managedId) + '" data-url="' + escapeHtml(urls[j]) + '" data-imgidx="' + j + '" checked>' +
        '<img src="' + fullUrl + '?t=' + Date.now() + '" loading="lazy">' +
        '<span class="badge">' + (j === 0 ? 'トップ' : (j+1)) + '</span>' +
        '</div>';
    }
    html += '</div>';
    // 画像選択ボタン
    html += '<div style="margin-top:8px;display:flex;gap:8px">' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'all\\')">全選択</button>' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'top\\')">トップのみ</button>' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'none\\')">全解除</button>' +
      '</div>';
    // 操作ボタン: 画像検索 + DL + 削除
    html += '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" style="flex:1;font-size:12px;padding:8px" onclick="searchManageImage(\\'' + escapeHtml(managedId) + '\\')">🔍 画像検索</button>' +
      '<button class="btn btn-success" style="flex:1;font-size:12px;padding:8px" onclick="downloadManageImages(\\'' + escapeHtml(managedId) + '\\')">📥 選択DL</button>' +
      '<button class="btn btn-danger" style="flex:1;font-size:12px;padding:8px" onclick="deleteManageImages(\\'' + escapeHtml(managedId) + '\\')">🗑 選択削除</button>' +
      '</div>';
    el.innerHTML = html;
    // ドラッグ並び替え初期化
    initManageDragReorder(document.getElementById('manageImageGrid'), managedId);
  }).catch(function(e) { showStatus('manageStatus', 'ネットワークエラー', 'err'); });
}

// ─── 展開内: 並び替え保存 ───
function saveManageReorder(managedId) {
  var grid = document.getElementById('manageImageGrid');
  if (!grid) return;
  var items = grid.querySelectorAll('.preview-item');
  var newOrder = [];
  items.forEach(function(item, i) {
    var img = item.querySelector('img');
    var url = img.src.replace(API_BASE, '').replace(/\\?t=\\d+$/, '');
    newOrder.push(url);
    var badge = item.querySelector('.badge');
    badge.textContent = i === 0 ? 'トップ' : (i + 1);
  });

  fetch(API_BASE + '/upload/reorder', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId, newOrder: newOrder })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      _manageExpandedUrls = d.urls || newOrder;
      showStatus('manageStatus', '並び替えを保存しました', 'ok');
    } else {
      showStatus('manageStatus', d.message || '並び替えエラー', 'err');
    }
  }).catch(function() { showStatus('manageStatus', '並び替えエラー', 'err'); });
}

// ─── 展開内: ドラッグ並び替え ───
function initManageDragReorder(grid, managedId, onSave) {
  if (!grid) return;
  var saveFn = onSave || function() { saveManageReorder(managedId); };
  var items = grid.querySelectorAll('.preview-item');
  var dragItem = null;
  items.forEach(function(item) {
    item.addEventListener('dragstart', function(e) {
      dragItem = this;
      this.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', function() {
      this.style.opacity = '1';
      dragItem = null;
    });
    item.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!dragItem || dragItem === this) return;
      var allItems = Array.from(grid.querySelectorAll('.preview-item'));
      var fromIdx = allItems.indexOf(dragItem);
      var toIdx = allItems.indexOf(this);
      if (fromIdx < toIdx) grid.insertBefore(dragItem, this.nextSibling);
      else grid.insertBefore(dragItem, this);
      saveFn();
    });
  });
}

// ─── 展開内: 画像検索 ───
function searchManageImage(managedId) {
  // トップ画像で検索
  var checks = document.querySelectorAll('.dl-img-check:checked');
  var url = '';
  if (checks.length > 0) {
    url = API_BASE + checks[0].dataset.url;
  } else if (_manageExpandedUrls.length > 0) {
    url = API_BASE + _manageExpandedUrls[0];
  }
  if (!url) { showStatus('manageStatus', '画像がありません', 'err'); return; }
  window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(url));
}

// ─── 展開内: 選択画像DL ───
function downloadManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }
  showStatus('manageStatus', '0/' + checks.length + ' 読み込み中...', 'info');
  var done = 0;
  var files = [];
  var promises = [];
  checks.forEach(function(c, i) {
    var url = API_BASE + c.dataset.url;
    var idx = parseInt(c.dataset.imgidx);
    promises.push(
      fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
        done++;
        files.push({ name: managedId + '_' + (idx + 1) + '.jpg', blob: blob });
        showStatus('manageStatus', done + '/' + checks.length + ' 読み込み中...', 'info');
      })
    );
  });
  Promise.all(promises).then(function() {
    if (files.length === 0) { showStatus('manageStatus', 'ダウンロードに失敗しました', 'err'); return; }
    var shareFiles = files.map(function(f) { return new File([f.blob], f.name, { type: 'image/jpeg' }); });

    // モバイル: navigator.share
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: shareFiles })) {
      showStatus('manageStatus', shareFiles.length + '枚を保存中...', 'info');
      navigator.share({ files: shareFiles }).then(function() {
        showStatus('manageStatus', shareFiles.length + '枚保存完了', 'ok');
      }).catch(function() {
        showStatus('manageStatus', 'キャンセルされました', 'info');
      });
      return;
    }

    // PC: JSZip
    if (typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      files.forEach(function(f) { zip.file(f.name, f.blob); });
      zip.generateAsync({ type: 'blob' }).then(function(content) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = managedId + '_images.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        showStatus('manageStatus', files.length + '枚保存完了', 'ok');
      });
      return;
    }

    // フォールバック: 個別DL
    files.forEach(function(f) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f.blob);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    });
    showStatus('manageStatus', files.length + '枚保存完了', 'ok');
  }).catch(function() { showStatus('manageStatus', 'ダウンロードエラー', 'err'); });
}

// ─── 展開内: 選択画像削除 ───
function deleteManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }
  var allChecks = document.querySelectorAll('.dl-img-check');
  if (checks.length === allChecks.length) {
    // 全画像選択 → 全削除
    showConfirm(managedId + ' の画像を全て削除しますか？', function() {
      showStatus('manageStatus', '全削除中...', 'info');
      fetch(API_BASE + '/upload/delete', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ managedId: managedId })
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          showStatus('manageStatus', d.deleted + '枚削除しました', 'ok');
          var el = document.getElementById('manageDetailInline'); if (el) el.remove();
          _manageExpandedMid = '';
          reloadList(function() { renderManageList(); });
        } else { showStatus('manageStatus', d.message || 'エラー', 'err'); }
      }).catch(function() { showStatus('manageStatus', 'ネットワークエラー', 'err'); });
    });
  } else {
    // 一部選択 → URL直接指定で削除（インデックスずれ防止）
    var targetUrls = [];
    checks.forEach(function(c) { targetUrls.push(c.dataset.url); });
    showConfirm(targetUrls.length + '枚の画像を削除しますか？', function() {
      var total = targetUrls.length;
      var done = 0;
      showStatus('manageStatus', '0/' + total + ' 削除中...', 'info');
      function delNext() {
        if (done >= total) {
          showStatus('manageStatus', total + '枚削除しました', 'ok');
          var mid = managedId;
          _manageExpandedMid = '';
          // 一覧を再読込して再展開
          reloadList(function() { renderManageList(); toggleManageExpand(mid); });
          return;
        }
        fetch(API_BASE + '/upload/delete-single', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ managedId: managedId, targetUrl: targetUrls[done] })
        }).then(function(r) { return r.json(); })
        .then(function() { done++; showStatus('manageStatus', done + '/' + total + ' 削除中...', 'info'); delNext(); })
        .catch(function() { done++; delNext(); });
      }
      delNext();
    });
  }
}

function toggleDlImageSelect(mode) {
  var checks = document.querySelectorAll('.dl-img-check');
  checks.forEach(function(c) {
    if (mode === 'all') c.checked = true;
    else if (mode === 'top') c.checked = (c.dataset.imgidx === '0');
    else if (mode === 'none') c.checked = false;
    c.closest('.img-check-wrap').style.opacity = c.checked ? '1' : '0.4';
  });
}

// モバイル判定（タッチ+画面幅ベース、PCのcanShareを除外）
function isMobileDevice() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 768;
}

function doDownloadTopImages() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '商品を選択してください', 'err'); return; }

  var indices = [];
  checks.forEach(function(c) { indices.push(parseInt(c.dataset.idx)); });

  var btn = document.getElementById('dlTopBtn');
  btn.disabled = true;
  showStatus('manageStatus', '0/' + indices.length + ' 読み込み中...', 'info');

  var done = 0;
  var fileEntries = [];
  var promises = indices.map(function(idx) {
    var p = productListData[idx];
    if (!p.thumbnail) { done++; return Promise.resolve(); }
    var url = API_BASE + p.thumbnail;
    return fetch(url).then(function(r) { return r.blob(); })
    .then(function(blob) {
      fileEntries.push({ idx: idx, mid: p.managedId, file: new File([blob], p.managedId + '.jpg', { type: 'image/jpeg' }) });
      done++;
      showStatus('manageStatus', done + '/' + indices.length + ' 読み込み中...', 'info');
    }).catch(function() { done++; });
  });

  Promise.all(promises).then(function() {
    if (fileEntries.length === 0) {
      btn.disabled = false;
      showStatus('manageStatus', 'ダウンロードに失敗しました', 'err');
      return;
    }
    var files = fileEntries.map(function(e) { return e.file; });

    // モバイル: 一括共有
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: files })) {
      showStatus('manageStatus', files.length + '枚を保存中...', 'info');
      navigator.share({ files: files }).then(function() {
        showStatus('manageStatus', files.length + '枚保存完了', 'ok');
      }).catch(function() {
        showStatus('manageStatus', 'キャンセルされました', 'info');
      }).finally(function() { btn.disabled = false; });
      return;
    }

    // PC: JSZip（管理番号ごとにフォルダ分け）
    if (typeof JSZip !== 'undefined') {
      showStatus('manageStatus', 'ZIPファイルを作成中...', 'info');
      var zip = new JSZip();
      fileEntries.forEach(function(e) { zip.file(e.mid + '.jpg', e.file); });
      zip.generateAsync({ type: 'blob' }).then(function(content) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'detauri_top_images.zip';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        showStatus('manageStatus', files.length + '枚保存完了（ZIP）', 'ok');
        btn.disabled = false;
      });
      return;
    }

    // フォールバック: 個別DL
    files.forEach(function(file) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    });
    btn.disabled = false;
    showStatus('manageStatus', files.length + '枚保存完了', 'ok');
  });
}

function doDownloadAllImages() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '商品を選択してください', 'err'); return; }

  var mids = [];
  checks.forEach(function(c) { mids.push(productListData[parseInt(c.dataset.idx)].managedId); });

  var btn = document.getElementById('dlAllBtn');
  btn.disabled = true;
  showStatus('manageStatus', '0/' + mids.length + ' 商品の画像を取得中...', 'info');

  // 各商品の全画像URLを取得
  var productDone = 0;
  var allItems = []; // [{mid, url, filename}]
  var promises = mids.map(function(mid) {
    return fetch(API_BASE + '/upload/product-images', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ managedId: mid })
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      productDone++;
      showStatus('manageStatus', productDone + '/' + mids.length + ' 商品の画像を取得中...', 'info');
      if (d.ok && d.urls) {
        for (var i = 0; i < d.urls.length; i++) {
          allItems.push({ mid: mid, url: API_BASE + d.urls[i], filename: mid + '_' + (i + 1) + '.jpg' });
        }
      }
    });
  });

  Promise.all(promises).then(function() {
    if (allItems.length === 0) {
      btn.disabled = false;
      showStatus('manageStatus', '画像が見つかりませんでした', 'err');
      return;
    }
    showStatus('manageStatus', '0/' + allItems.length + ' 画像を読み込み中...', 'info');
    var imgDone = 0;
    var fileEntries = [];
    var imgPromises = allItems.map(function(item) {
      return fetch(item.url).then(function(r) { return r.blob(); })
      .then(function(blob) {
        fileEntries.push({ file: new File([blob], item.filename, { type: 'image/jpeg' }), blob: blob, filename: item.filename });
        imgDone++;
        showStatus('manageStatus', imgDone + '/' + allItems.length + ' 画像を読み込み中...', 'info');
      }).catch(function() { imgDone++; });
    });

    return Promise.all(imgPromises).then(function() {
      if (fileEntries.length === 0) {
        btn.disabled = false;
        showStatus('manageStatus', 'ダウンロードに失敗しました', 'err');
        return;
      }
      var files = fileEntries.map(function(e) { return e.file; });

      // モバイル: navigator.share
      if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: files })) {
        showStatus('manageStatus', files.length + '枚を保存中...', 'info');
        navigator.share({ files: files }).then(function() {
          showStatus('manageStatus', files.length + '枚保存完了', 'ok');
        }).catch(function() {
          showStatus('manageStatus', 'キャンセルされました', 'info');
        }).finally(function() { btn.disabled = false; });
        return;
      }

      // PC: JSZip
      if (typeof JSZip !== 'undefined') {
        showStatus('manageStatus', 'ZIPファイルを作成中...', 'info');
        var zip = new JSZip();
        fileEntries.forEach(function(e) { zip.file(e.filename, e.blob); });
        zip.generateAsync({ type: 'blob' }).then(function(content) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(content);
          a.download = 'detauri_all_images.zip';
          a.click();
          setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
          btn.disabled = false;
          showStatus('manageStatus', fileEntries.length + '枚をZIPで保存しました', 'ok');
        });
        return;
      }

      // フォールバック
      files.forEach(function(file) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
      });
      btn.disabled = false;
      showStatus('manageStatus', files.length + '枚保存完了', 'ok');
    });
  }).catch(function() {
    btn.disabled = false;
    showStatus('manageStatus', 'エラーが発生しました', 'err');
  });
}

function doDownloadSelected() {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }

  var btn = document.getElementById('dlBtn');
  btn.disabled = true;
  showStatus('manageStatus', '0/' + checks.length + ' 読み込み中...', 'info');

  var selectedItems = [];
  checks.forEach(function(c) {
    selectedItems.push({
      mid: c.dataset.mid,
      url: API_BASE + c.dataset.url,
      filename: c.dataset.mid + '_' + (parseInt(c.dataset.imgidx) + 1) + '.jpg'
    });
  });

  var done = 0;
  var fileEntries = [];
  var promises = selectedItems.map(function(item) {
    return fetch(item.url).then(function(r) { return r.blob(); })
    .then(function(blob) {
      fileEntries.push({ file: new File([blob], item.filename, { type: 'image/jpeg' }), blob: blob, filename: item.filename });
      done++;
      showStatus('manageStatus', done + '/' + selectedItems.length + ' 読み込み中...', 'info');
    }).catch(function() { done++; });
  });

  Promise.all(promises).then(function() {
    if (fileEntries.length === 0) {
      btn.disabled = false;
      showStatus('manageStatus', 'ダウンロードに失敗しました', 'err');
      return;
    }

    var files = fileEntries.map(function(e) { return e.file; });

    // モバイル: navigator.share
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: files })) {
      showStatus('manageStatus', files.length + '枚を保存中...', 'info');
      navigator.share({ files: files }).then(function() {
        showStatus('manageStatus', files.length + '枚保存完了', 'ok');
      }).catch(function() {
        showStatus('manageStatus', 'キャンセルされました', 'info');
      }).finally(function() { btn.disabled = false; });
      return;
    }

    // PC: JSZip（管理番号_番号.jpg のファイル名）
    if (typeof JSZip !== 'undefined') {
      showStatus('manageStatus', 'ZIPファイルを作成中...', 'info');
      var zip = new JSZip();
      fileEntries.forEach(function(entry) {
        zip.file(entry.filename, entry.blob);
      });
      zip.generateAsync({ type: 'blob' }).then(function(content) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'detauri_images.zip';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        btn.disabled = false;
        showStatus('manageStatus', fileEntries.length + '枚をZIPで保存しました', 'ok');
      });
      return;
    }

    // フォールバック: 1枚ずつダウンロード
    files.forEach(function(file) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    });
    btn.disabled = false;
    showStatus('manageStatus', files.length + '枚保存完了', 'ok');
  });
}


// ─── 商品選択削除（フッタボタン用） ───
function updateDeleteSelectedCount() {
  var checks = document.querySelectorAll('.dl-check:checked');
  var btn = document.getElementById('deleteSelectedBtn');
  if (!btn) return;
  if (checks.length > 0) {
    btn.disabled = false;
    btn.textContent = checks.length + '件の商品を削除';
  } else {
    btn.disabled = true;
    btn.textContent = '選択した商品を削除';
  }
}

function doDeleteSelected() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) return;
  var mids = [];
  checks.forEach(function(c) { mids.push(c.dataset.mid); });
  showConfirm(mids.length + '件の商品画像を全て削除しますか？', function() {
    _doDeleteSelectedBatch(mids);
  });
}

function _doDeleteSelectedBatch(mids) {
  showStatus('manageStatus', '0/' + mids.length + ' 削除中...', 'info');
  var done = 0;
  var totalDeleted = 0;
  mids.forEach(function(mid) {
    fetch(API_BASE + '/upload/delete', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ managedId: mid })
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      done++;
      if (d.ok) totalDeleted += (d.deleted || 0);
      showStatus('manageStatus', done + '/' + mids.length + ' 削除中...', 'info');
      if (done === mids.length) {
        showStatus('manageStatus', mids.length + '件（' + totalDeleted + '枚）削除しました', 'ok');
        var el = document.getElementById('manageDetailInline'); if (el) el.remove();
        _manageExpandedMid = '';
        reloadList(function() { renderManageList(); });
      }
    }).catch(function() {
      done++;
      if (done === mids.length) {
        showStatus('manageStatus', done + '件処理完了（一部エラーあり）', 'err');
        reloadList(function() { renderManageList(); });
      }
    });
  });
}

// ─── 確認モーダル ───
var _confirmCallback = null;
function showConfirm(msg, cb) {
  _confirmCallback = cb;
  document.getElementById('confirmMessage').textContent = msg;
  var modal = document.getElementById('confirmModal');
  modal.style.display = 'flex';
}
function closeConfirm(ok) {
  var modal = document.getElementById('confirmModal');
  modal.style.display = 'none';
  if (ok && _confirmCallback) _confirmCallback();
  _confirmCallback = null;
}

// ─── ユーティリティ ───
function toggleImgCheck(wrap, e) {
  // チェックボックス自体がクリックされた場合はネイティブ動作に任せる
  if (e && (e.target.tagName === 'INPUT')) return;
  var cb = wrap.querySelector('input[type=checkbox]');
  if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  wrap.style.opacity = cb && cb.checked ? '1' : '0.4';
}

function normId(s) {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/ー/g, '-').replace(/\u3000/g, ' ').toUpperCase().trim();
}
function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
</script>
</body>
</html>`;
}
