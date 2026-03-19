/**
 * アップロードページHTML（自己完結型、スマホ最適化）
 *
 * セクション1: 画像アップロード（管理番号+最大10枚、既存画像検出・追加・上書き・並び替え）
 * セクション2: 一括ダウンロード（画像展開+JSZip ZIP DL）
 * セクション3: 検索（リサーチ）（Google画像検索）
 * セクション4: 削除（targetUrl方式）
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
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;line-height:1.5;padding-bottom:env(safe-area-inset-bottom)}
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
      <button class="tab" onclick="switchTab('download')">一括DL</button>
      <button class="tab" onclick="switchTab('research')">検索</button>
      <button class="tab" onclick="switchTab('delete')">削除</button>
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
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="saveReorder(normId(document.getElementById('uploadManagedId').value))">並び順を保存</button>
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>画像（最大10枚）</label>
          <input type="file" id="uploadFiles" multiple accept="image/*" onchange="showPreview()">
        </div>
        <div class="preview-grid" id="uploadPreview"></div>
        <div class="progress-bar" id="uploadProgress"><div class="fill" id="uploadProgressFill"></div></div>
        <div class="status" id="uploadStatus"></div>
        <button class="btn btn-primary" id="uploadBtn" onclick="doUpload()" style="margin-top:12px" disabled>アップロード</button>
      </div>
    </div>

    <!-- セクション2: 一括ダウンロード -->
    <div class="section" id="sec-download">
      <div class="card">
        <h2>画像一括ダウンロード</h2>
        <div class="form-group">
          <input type="text" id="dlSearch" placeholder="管理番号で検索..." autocomplete="off" oninput="filterDlList()">
        </div>
        <div class="status" id="dlLoadStatus"></div>
        <div class="select-all-row hidden" id="selectAllRow">
          <input type="checkbox" id="selectAll" class="list-check" onchange="toggleSelectAll()">
          <span>すべて選択（表示中）</span>
          <span style="margin-left:auto" id="selectedCount">0件選択</span>
        </div>
        <div id="productList"></div>
        <div style="display:flex;gap:8px;margin-top:12px" id="dlActionRow" class="hidden">
          <button class="btn btn-success" style="flex:1" id="dlTopBtn" onclick="doDownloadTopImages()">トップ画像を保存</button>
          <button class="btn btn-primary" style="flex:1" id="dlExpandBtn" onclick="expandDlImages()">全画像を展開</button>
        </div>
        <div id="dlImageGrid" class="hidden" style="margin-top:12px"></div>
        <div style="margin-top:8px;display:flex;gap:8px" id="dlImageActions" class="hidden">
          <button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect('all')">全画像選択</button>
          <button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect('top')">トップ画像のみ</button>
        </div>
        <button class="btn btn-success hidden" id="dlBtn" onclick="doDownloadSelected()" style="margin-top:12px">選択した画像を保存</button>
        <div class="status" id="dlStatus"></div>
      </div>
    </div>

    <!-- セクション3: 検索（リサーチ） -->
    <div class="section" id="sec-research">
      <div class="card">
        <h2>画像検索（リサーチ）</h2>
        <div class="form-group">
          <input type="text" id="researchSearch" placeholder="管理番号で検索..." autocomplete="off" oninput="filterResearchList()">
        </div>
        <div class="status" id="researchLoadStatus"></div>
        <div class="select-all-row hidden" id="researchSelectAllRow">
          <input type="checkbox" id="researchSelectAll" class="list-check" onchange="toggleResearchSelectAll()">
          <span>すべて選択</span>
        </div>
        <div id="researchProductList"></div>
        <button class="btn btn-primary hidden" id="researchExpandBtn" onclick="expandResearchImages()" style="margin-top:12px">選択した商品の画像を展開</button>
        <div class="status" id="researchStatus"></div>
        <div id="researchImageGrid" class="hidden" style="margin-top:12px"></div>
      </div>
    </div>

    <!-- セクション4: 削除 -->
    <div class="section" id="sec-delete">
      <div class="card">
        <h2>画像削除</h2>
        <div class="form-group">
          <input type="text" id="deleteSearch" placeholder="管理番号で検索..." autocomplete="off" oninput="filterDeleteList()">
        </div>
        <div class="status" id="deleteStatus"></div>
        <div id="deleteList"></div>
      </div>
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
  var tabNames = ['upload','download','research','delete'];
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', tabNames[i] === name);
  });
  secs.forEach(function(s) { s.classList.toggle('active', s.id === 'sec-' + name); });
  if (name === 'download') ensureListLoaded(function() { renderDlList(); });
  if (name === 'research') ensureListLoaded(function() { renderResearchList(); });
  if (name === 'delete') ensureListLoaded(function() { renderDeleteList(); });
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

// ─── ドラッグ&ドロップ並び替え（PC） ───
function initDragReorder(grid, managedId) {
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
      saveReorder(managedId);
    });
    // モバイル: タップでインライン番号セレクト表示
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('replace-btn') || e.target.closest('.replace-btn')) return;
      if (e.target.tagName === 'SELECT') return;
      if ('ontouchstart' in window) {
        var self = this;
        var allItems = Array.from(grid.querySelectorAll('.preview-item'));
        var currentIdx = allItems.indexOf(self);
        // 既にセレクトがあれば閉じる
        var existing = grid.querySelector('.reorder-select');
        if (existing) existing.remove();
        // セレクトボックスを生成
        var sel = document.createElement('select');
        sel.className = 'reorder-select';
        sel.style.cssText = 'position:absolute;bottom:0;left:0;right:0;font-size:14px;padding:4px;background:#fff;border:2px solid #3b82f6;border-radius:0 0 6px 6px;z-index:10;text-align:center;';
        for (var si = 0; si < allItems.length; si++) {
          var opt = document.createElement('option');
          opt.value = si;
          opt.textContent = (si + 1) + '番目' + (si === 0 ? '（トップ）' : '');
          if (si === currentIdx) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', function() {
          var newIdx = parseInt(this.value);
          this.remove();
          if (isNaN(newIdx) || newIdx === currentIdx) return;
          if (newIdx < currentIdx) grid.insertBefore(self, allItems[newIdx]);
          else grid.insertBefore(self, allItems[newIdx].nextSibling);
          saveReorder(managedId);
        });
        // タップ外で閉じる
        sel.addEventListener('blur', function() { setTimeout(function() { sel.remove(); }, 200); });
        self.appendChild(sel);
        sel.focus();
      }
    });
  });
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
    (function(idx) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var div = document.createElement('div');
        div.className = 'preview-item';
        var labelIdx = _existingUrls.length + idx;
        div.innerHTML = '<img src="' + e.target.result + '">' +
          (labelIdx === 0 ? '<span class="badge">トップ</span>' : '<span class="badge">' + (labelIdx+1) + '</span>');
        grid.appendChild(div);
      };
      reader.readAsDataURL(files[idx]);
    })(i);
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
  var done = 0;
  for (var i = 0; i < files.length; i++) {
    (function(idx) {
      var isTop = (_existingUrls.length === 0 && idx === 0);
      var maxSize = isTop ? 1200 : 800;
      var quality = isTop ? 0.80 : 0.75;
      resizeImage(files[idx], maxSize, quality, function(blob) {
        results[idx] = blob;
        done++;
        if (done === files.length) cb(results);
      });
    })(i);
  }
}

function resizeImage(file, maxSize, quality, cb) {
  var img = new Image();
  img.onload = function() {
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
    canvas.toBlob(function(blob) { cb(blob); }, 'image/jpeg', quality);
  };
  img.onerror = function() { cb(file); };
  img.src = URL.createObjectURL(file);
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
  showStatus('dlLoadStatus', '読み込み中...', 'info');
  fetch(API_BASE + '/upload/list', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: '{}'
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) {
      if (d.message && d.message.indexOf('トークン') >= 0) showAuth();
      showStatus('dlLoadStatus', d.message || 'エラー', 'err');
      return;
    }
    productListData = d.items || [];
    _listLoaded = true;
    if (productListData.length === 0) {
      showStatus('dlLoadStatus', 'アップロード済み商品はありません', 'info');
    } else {
      showStatus('dlLoadStatus', productListData.length + '件の商品', 'ok');
    }
    cb();
  }).catch(function(e) { showStatus('dlLoadStatus', 'ネットワークエラー', 'err'); });
}

function reloadList(cb) {
  _listLoaded = false;
  ensureListLoaded(cb || function(){});
}

// ─── セクション2: 一括ダウンロード ───
var _dlExpandedData = []; // [{mid, urls, filename}...]

function filterDlList() {
  ensureListLoaded(function() { renderDlList(); });
}

function renderDlList() {
  var q = normId(document.getElementById('dlSearch').value);
  var el = document.getElementById('productList');
  var html = '';
  var count = 0;
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    if (q && p.managedId.toUpperCase().indexOf(q) === -1) continue;
    count++;
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-idx="' + i + '" data-mid="' + escapeHtml(p.managedId) + '" onchange="updateSelectedCount()">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="list-thumb"></div>') +
      '<div class="list-info"><div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚 <span class="dl-status" id="dlst-' + i + '">✓保存済</span></div></div>' +
      '</div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('selectAllRow').classList.remove('hidden');
  document.getElementById('dlActionRow').classList.remove('hidden');
  // Hide image grid when re-rendering list
  document.getElementById('dlImageGrid').classList.add('hidden');
  document.getElementById('dlImageActions').classList.add('hidden');
  document.getElementById('dlBtn').classList.add('hidden');
  updateSelectedCount();
}

function toggleSelectAll() {
  var checked = document.getElementById('selectAll').checked;
  document.querySelectorAll('.dl-check').forEach(function(c) {
    c.checked = checked;
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  var checks = document.querySelectorAll('.dl-check:checked');
  document.getElementById('selectedCount').textContent = checks.length + '件選択';
}

function expandDlImages() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) { showStatus('dlStatus', '商品を選択してください', 'err'); return; }
  if (checks.length > 10) { showStatus('dlStatus', '10商品以上選択されています。処理に時間がかかる場合があります', 'info'); }

  var grid = document.getElementById('dlImageGrid');
  grid.innerHTML = '<div style="text-align:center;padding:20px;color:#666">読み込み中...</div>';
  grid.classList.remove('hidden');

  var mids = [];
  checks.forEach(function(c) { mids.push(c.dataset.mid); });

  _dlExpandedData = [];
  var allHtml = '';
  var done = 0;
  mids.forEach(function(mid) {
    fetch(API_BASE + '/upload/product-images', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ managedId: mid })
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      done++;
      if (d.ok && d.urls) {
        for (var i = 0; i < d.urls.length; i++) {
          _dlExpandedData.push({ mid: mid, url: d.urls[i], idx: i });
        }
        allHtml += '<div style="margin-bottom:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">' + escapeHtml(mid) + ' (' + d.urls.length + '枚)</div>';
        allHtml += '<div class="img-grid">';
        for (var j = 0; j < d.urls.length; j++) {
          var fullUrl = API_BASE + d.urls[j];
          allHtml += '<div class="img-check-wrap preview-item">' +
            '<input type="checkbox" class="dl-img-check" data-mid="' + escapeHtml(mid) + '" data-url="' + escapeHtml(d.urls[j]) + '" data-imgidx="' + j + '" checked>' +
            '<img src="' + fullUrl + '" loading="lazy">' +
            '<span class="badge">' + (j === 0 ? 'トップ' : (j+1)) + '</span>' +
            '</div>';
        }
        allHtml += '</div></div>';
      }
      if (done === mids.length) {
        grid.innerHTML = allHtml || '<div style="text-align:center;color:#999;padding:20px">画像なし</div>';
        document.getElementById('dlImageActions').classList.remove('hidden');
        document.getElementById('dlBtn').classList.remove('hidden');
      }
    }).catch(function() {
      done++;
      if (done === mids.length) {
        grid.innerHTML = allHtml || '<div style="text-align:center;color:#999;padding:20px">画像なし</div>';
        document.getElementById('dlImageActions').classList.remove('hidden');
        document.getElementById('dlBtn').classList.remove('hidden');
      }
    });
  });
}

function toggleDlImageSelect(mode) {
  var checks = document.querySelectorAll('.dl-img-check');
  checks.forEach(function(c) {
    if (mode === 'all') {
      c.checked = true;
    } else if (mode === 'top') {
      c.checked = (c.dataset.imgidx === '0');
    }
  });
}

// モバイル判定（タッチ+画面幅ベース、PCのcanShareを除外）
function isMobileDevice() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 768;
}

function doDownloadTopImages() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) { showStatus('dlStatus', '商品を選択してください', 'err'); return; }

  var indices = [];
  checks.forEach(function(c) { indices.push(parseInt(c.dataset.idx)); });

  var btn = document.getElementById('dlTopBtn');
  btn.disabled = true;
  showStatus('dlStatus', '0/' + indices.length + ' 読み込み中...', 'info');

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
      showStatus('dlStatus', done + '/' + indices.length + ' 読み込み中...', 'info');
    }).catch(function() { done++; });
  });

  Promise.all(promises).then(function() {
    if (fileEntries.length === 0) {
      btn.disabled = false;
      showStatus('dlStatus', 'ダウンロードに失敗しました', 'err');
      return;
    }
    var files = fileEntries.map(function(e) { return e.file; });

    // モバイル: 一括共有
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: files })) {
      showStatus('dlStatus', files.length + '枚を保存中...', 'info');
      navigator.share({ files: files }).then(function() {
        showStatus('dlStatus', files.length + '枚保存完了', 'ok');
      }).catch(function() {
        showStatus('dlStatus', 'キャンセルされました', 'info');
      }).finally(function() { btn.disabled = false; });
      return;
    }

    // PC: JSZip（管理番号ごとにフォルダ分け）
    if (typeof JSZip !== 'undefined') {
      showStatus('dlStatus', 'ZIPファイルを作成中...', 'info');
      var zip = new JSZip();
      fileEntries.forEach(function(e) { zip.file(e.mid + '.jpg', e.file); });
      zip.generateAsync({ type: 'blob' }).then(function(content) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'detauri_top_images.zip';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        showStatus('dlStatus', files.length + '枚保存完了（ZIP）', 'ok');
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
    showStatus('dlStatus', files.length + '枚保存完了', 'ok');
  });
}

function doDownloadSelected() {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('dlStatus', '画像を選択してください', 'err'); return; }

  var btn = document.getElementById('dlBtn');
  btn.disabled = true;
  showStatus('dlStatus', '0/' + checks.length + ' 読み込み中...', 'info');

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
      showStatus('dlStatus', done + '/' + selectedItems.length + ' 読み込み中...', 'info');
    }).catch(function() { done++; });
  });

  Promise.all(promises).then(function() {
    if (fileEntries.length === 0) {
      btn.disabled = false;
      showStatus('dlStatus', 'ダウンロードに失敗しました', 'err');
      return;
    }

    var files = fileEntries.map(function(e) { return e.file; });

    // モバイル: navigator.share
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: files })) {
      showStatus('dlStatus', files.length + '枚を保存中...', 'info');
      navigator.share({ files: files }).then(function() {
        showStatus('dlStatus', files.length + '枚保存完了', 'ok');
      }).catch(function() {
        showStatus('dlStatus', 'キャンセルされました', 'info');
      }).finally(function() { btn.disabled = false; });
      return;
    }

    // PC: JSZip（管理番号_番号.jpg のファイル名）
    if (typeof JSZip !== 'undefined') {
      showStatus('dlStatus', 'ZIPファイルを作成中...', 'info');
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
        showStatus('dlStatus', fileEntries.length + '枚をZIPで保存しました', 'ok');
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
    showStatus('dlStatus', files.length + '枚保存完了', 'ok');
  });
}

// ─── セクション3: 検索（リサーチ） ───

function filterResearchList() {
  ensureListLoaded(function() { renderResearchList(); });
}

function renderResearchList() {
  var q = normId(document.getElementById('researchSearch').value);
  var el = document.getElementById('researchProductList');
  var html = '';
  var count = 0;
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    if (q && p.managedId.toUpperCase().indexOf(q) === -1) continue;
    count++;
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div class="list-item">' +
      '<input type="checkbox" class="list-check research-check" data-mid="' + escapeHtml(p.managedId) + '" data-idx="' + i + '">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="list-thumb"></div>') +
      '<div class="list-info"><div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚</div></div>' +
      '</div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('researchSelectAllRow').classList.remove('hidden');
  document.getElementById('researchExpandBtn').classList.remove('hidden');
}

function toggleResearchSelectAll() {
  var checked = document.getElementById('researchSelectAll').checked;
  document.querySelectorAll('.research-check').forEach(function(c) { c.checked = checked; });
}

function expandResearchImages() {
  var checks = document.querySelectorAll('.research-check:checked');
  if (checks.length === 0) { showStatus('researchStatus', '商品を選択してください', 'err'); return; }

  var grid = document.getElementById('researchImageGrid');
  grid.innerHTML = '<div style="text-align:center;padding:20px;color:#666">読み込み中...</div>';
  grid.classList.remove('hidden');

  var mids = [];
  checks.forEach(function(c) { mids.push(c.dataset.mid); });

  var fragments = [];
  var done = 0;
  mids.forEach(function(mid, midIdx) {
    fetch(API_BASE + '/upload/product-images', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ managedId: mid })
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      done++;
      if (d.ok && d.urls) {
        var h = '<div style="margin-bottom:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">' + escapeHtml(mid) + ' (' + d.urls.length + '枚)</div>';
        h += '<div class="img-grid">';
        for (var i = 0; i < d.urls.length; i++) {
          var fullUrl = API_BASE + d.urls[i];
          h += '<div class="preview-item search-item" style="cursor:pointer" data-url="' + fullUrl + '" onclick="searchImage(this.dataset.url)">' +
            '<img src="' + fullUrl + '" loading="lazy">' +
            '<span class="badge">' + (i === 0 ? 'トップ' : (i+1)) + '</span>' +
            '<div class="search-overlay">🔍</div>' +
            '</div>';
        }
        h += '</div></div>';
        fragments[midIdx] = h;
      }
      if (done === mids.length) {
        var allHtml = '';
        for (var k = 0; k < mids.length; k++) {
          if (fragments[k]) allHtml += fragments[k];
        }
        grid.innerHTML = allHtml || '<div style="text-align:center;color:#999;padding:20px">画像なし</div>';
      }
    }).catch(function() {
      done++;
      if (done === mids.length) {
        var allHtml = '';
        for (var k = 0; k < mids.length; k++) {
          if (fragments[k]) allHtml += fragments[k];
        }
        grid.innerHTML = allHtml || '<div style="text-align:center;color:#999;padding:20px">画像なし</div>';
      }
    });
  });
}

function searchImage(imgUrl) {
  if (/iPhone|iPad/.test(navigator.userAgent)) {
    window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(imgUrl));
  } else {
    window.open('https://www.google.com/searchbyimage?image_url=' + encodeURIComponent(imgUrl));
  }
}

// ─── セクション4: 削除 ───
var _deleteImages = [];
var _deleteManagedId = '';

function filterDeleteList() {
  ensureListLoaded(function() { renderDeleteList(); });
}

function renderDeleteList() {
  var q = normId(document.getElementById('deleteSearch').value);
  var el = document.getElementById('deleteList');
  var html = '';
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    if (q && p.managedId.toUpperCase().indexOf(q) === -1) continue;
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div id="del-row-' + escapeHtml(p.managedId) + '">' +
      '<div class="list-item" style="cursor:pointer" onclick="selectForDelete(\\'' + escapeHtml(p.managedId) + '\\')">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="list-thumb"></div>') +
      '<div class="list-info"><div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚</div></div>' +
      '<span style="color:#ef4444;font-size:20px;padding:0 8px">›</span>' +
      '</div></div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
}

function selectForDelete(managedId) {
  // 同じ商品をもう一度タップしたら閉じる
  if (_deleteManagedId === managedId) {
    var existing = document.getElementById('deleteDetailInline');
    if (existing) { existing.remove(); _deleteManagedId = ''; return; }
  }
  _deleteManagedId = managedId;

  // 既存のインライン詳細を閉じる
  var old = document.getElementById('deleteDetailInline');
  if (old) old.remove();

  // 対象行の直後にインライン詳細を挿入
  var row = document.getElementById('del-row-' + managedId);
  if (!row) return;
  var detail = document.createElement('div');
  detail.id = 'deleteDetailInline';
  detail.style.cssText = 'background:#fef2f2;border-radius:8px;padding:12px;margin:4px 0 8px';
  detail.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + escapeHtml(managedId) + ' の画像</div>' +
    '<div style="text-align:center;color:#666;font-size:13px">読み込み中...</div>';
  row.after(detail);

  fetch(API_BASE + '/upload/product-images', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    var el = document.getElementById('deleteDetailInline');
    if (!el) return;
    if (!d.ok) { showStatus('deleteStatus', d.message || 'エラー', 'err'); return; }
    _deleteImages = d.urls || [];
    showStatus('deleteStatus', _deleteImages.length + '枚', 'ok');
    var html = '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + escapeHtml(managedId) + ' の画像</div>';
    html += '<div class="preview-grid">';
    for (var i = 0; i < _deleteImages.length; i++) {
      html += '<div class="preview-item">' +
        '<img src="' + API_BASE + _deleteImages[i] + '?t=' + Date.now() + '">' +
        '<span class="badge" style="background:rgba(239,68,68,.85);cursor:pointer" onclick="doDeleteSingle(' + i + ')">×</span>' +
        '</div>';
    }
    html += '</div>';
    html += '<button class="btn btn-danger" style="margin-top:8px" onclick="doDeleteAll()">この商品の画像を全て削除</button>';
    el.innerHTML = html;
  }).catch(function(e) { showStatus('deleteStatus', 'ネットワークエラー', 'err'); });
}

function doDeleteSingle(urlIndex) {
  showConfirm((urlIndex+1) + '枚目を削除しますか？', function() {
    _doDeleteSingle(urlIndex);
  });
}
function _doDeleteSingle(urlIndex) {
  showStatus('deleteStatus', '削除中...', 'info');
  fetch(API_BASE + '/upload/delete-single', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: _deleteManagedId, targetUrl: _deleteImages[urlIndex] })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showStatus('deleteStatus', '削除しました（残り' + d.remaining + '枚）', 'ok');
      if (d.remaining > 0) {
        var mid = _deleteManagedId;
        // 一覧側の枚数表示も即時更新
        var row = document.getElementById('del-row-' + mid);
        if (row) { var cnt = row.querySelector('.list-count'); if (cnt) cnt.textContent = d.remaining + '枚'; }
        _deleteManagedId = ''; selectForDelete(mid);
      }
      else { var el = document.getElementById('deleteDetailInline'); if (el) el.remove(); _deleteManagedId = ''; reloadList(function() { renderDeleteList(); }); }
    } else {
      showStatus('deleteStatus', d.message || 'エラー', 'err');
    }
  }).catch(function(e) { showStatus('deleteStatus', 'ネットワークエラー', 'err'); });
}

function doDeleteAll() {
  showConfirm(_deleteManagedId + ' の画像を全て削除しますか？', function() {
    _doDeleteAll();
  });
}
function _doDeleteAll() {
  showStatus('deleteStatus', '全削除中...', 'info');
  fetch(API_BASE + '/upload/delete', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: _deleteManagedId })
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.ok) {
      showStatus('deleteStatus', d.deleted + '枚削除しました', 'ok');
      var el = document.getElementById('deleteDetailInline'); if (el) el.remove();
      _deleteManagedId = '';
      reloadList(function() { renderDeleteList(); });
    } else {
      showStatus('deleteStatus', d.message || 'エラー', 'err');
    }
  }).catch(function(e) { showStatus('deleteStatus', 'ネットワークエラー', 'err'); });
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
