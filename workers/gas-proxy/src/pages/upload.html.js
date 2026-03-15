/**
 * アップロードページHTML（自己完結型、スマホ最適化）
 *
 * セクション1: 画像アップロード（管理番号+最大10枚）
 * セクション2: 1枚目一括ダウンロード
 * セクション3: 加工済み1枚目上書き
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
input[type=text],input[type=password]{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;-webkit-appearance:none}
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
.replace-preview{text-align:center;margin:12px 0}
.replace-preview img{max-width:200px;max-height:200px;border-radius:8px;border:1px solid #ddd}
.tab-bar{display:flex;gap:4px;margin-bottom:12px;background:#f3f4f6;border-radius:10px;padding:4px}
.tab{flex:1;padding:8px;text-align:center;font-size:13px;font-weight:600;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#666}
.tab.active{background:#fff;color:#1a1a2e;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.section{display:none}
.section.active{display:block}
.auth-wall{text-align:center;padding:40px 16px}
.auth-wall h2{border:none;color:#6b7280}
.hidden{display:none}
.select-all-row{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:#666}
</style>
</head>
<body>
<div class="container">
  <h1>商品画像アップロード</h1>

  <!-- 認証フォーム -->
  <div id="authSection" class="card auth-wall">
    <h2>パスワードを入力</h2>
    <div class="form-group" style="margin-top:16px">
      <input type="password" id="authPassword" placeholder="パスワード" autocomplete="off">
    </div>
    <button class="btn btn-primary" id="authBtn" onclick="doAuth()">認証</button>
    <div class="status" id="authStatus"></div>
  </div>

  <!-- メインUI（認証後に表示） -->
  <div id="mainSection" class="hidden">
    <div class="tab-bar">
      <button class="tab active" onclick="switchTab('upload')">アップロード</button>
      <button class="tab" onclick="switchTab('download')">一括DL</button>
      <button class="tab" onclick="switchTab('replace')">上書き</button>
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
        <h2>1枚目一括ダウンロード</h2>
        <button class="btn btn-secondary" onclick="loadProductList()" style="margin-bottom:12px">一覧を読み込む</button>
        <div class="status" id="dlLoadStatus"></div>
        <div class="select-all-row hidden" id="selectAllRow">
          <input type="checkbox" id="selectAll" class="list-check" onchange="toggleSelectAll()">
          <span>すべて選択</span>
          <span style="margin-left:auto" id="selectedCount">0件選択</span>
        </div>
        <div id="productList"></div>
        <button class="btn btn-success hidden" id="dlBtn" onclick="doDownloadSelected()" style="margin-top:12px">選択した1枚目を保存</button>
        <div class="status" id="dlStatus"></div>
      </div>
    </div>

    <!-- セクション3: 加工済み上書き -->
    <div class="section" id="sec-replace">
      <div class="card">
        <h2>1枚目を上書き</h2>
        <div class="form-group">
          <label>管理番号</label>
          <input type="text" id="replaceManagedId" placeholder="例: A001" autocomplete="off">
          <button class="btn btn-secondary" onclick="loadCurrentImage()" style="margin-top:8px">現在の画像を確認</button>
        </div>
        <div class="replace-preview hidden" id="replacePreview">
          <p style="font-size:12px;color:#888;margin-bottom:4px">現在の1枚目:</p>
          <img id="replaceCurrentImg" src="">
        </div>
        <div class="form-group">
          <label>新しい画像</label>
          <input type="file" id="replaceFile" accept="image/*">
        </div>
        <div class="status" id="replaceStatus"></div>
        <button class="btn btn-danger" onclick="doReplace()" style="margin-top:8px">上書き保存</button>
      </div>
    </div>
  </div>
</div>

<script>
// ─── 設定 ───
var API_BASE = location.origin;
var TOKEN_KEY = 'detauri_upload_token';

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
    // トークン検証
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
    showStatus('authStatus', 'ネットワークエラー', 'err');
  });
}

// Enterキーで認証
document.getElementById('authPassword').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doAuth();
});

// ─── タブ切り替え ───
function switchTab(name) {
  var tabs = document.querySelectorAll('.tab');
  var secs = document.querySelectorAll('.section');
  tabs.forEach(function(t, i) {
    t.classList.toggle('active', ['upload','download','replace'][i] === name);
  });
  secs.forEach(function(s) { s.classList.toggle('active', s.id === 'sec-' + name); });
}

// ─── セクション1: アップロード ───
function showPreview() {
  var input = document.getElementById('uploadFiles');
  var grid = document.getElementById('uploadPreview');
  var btn = document.getElementById('uploadBtn');
  grid.innerHTML = '';
  var files = input.files;
  if (!files || files.length === 0) { btn.disabled = true; return; }
  if (files.length > 10) {
    showStatus('uploadStatus', '画像は最大10枚までです', 'err');
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
        div.innerHTML = '<img src="' + e.target.result + '">' +
          (idx === 0 ? '<span class="badge">トップ</span>' : '<span class="badge">' + (idx+1) + '</span>');
        grid.appendChild(div);
      };
      reader.readAsDataURL(files[idx]);
    })(i);
  }
}

function doUpload() {
  var managedId = document.getElementById('uploadManagedId').value.trim();
  if (!managedId) { showStatus('uploadStatus', '管理番号を入力してください', 'err'); return; }
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

  // 画像リサイズ → アップロード
  resizeAllImages(files, function(blobs) {
    showStatus('uploadStatus', '0/' + blobs.length + ' アップロード中...', 'info');
    uploadInParallel(managedId, blobs, 3, function(done, total) {
      fill.style.width = Math.round(done / total * 100) + '%';
      showStatus('uploadStatus', done + '/' + total + ' アップロード中...', 'info');
    }, function(err) {
      btn.disabled = false;
      bar.classList.remove('show');
      if (err) {
        showStatus('uploadStatus', 'エラー: ' + err, 'err');
      } else {
        showStatus('uploadStatus', blobs.length + '枚アップロード完了', 'ok');
        input.value = '';
        document.getElementById('uploadPreview').innerHTML = '';
      }
    });
  });
}

function resizeAllImages(files, cb) {
  var results = [];
  var done = 0;
  for (var i = 0; i < files.length; i++) {
    (function(idx) {
      var maxSize = idx === 0 ? 1200 : 800;
      var quality = idx === 0 ? 0.80 : 0.75;
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
  img.onerror = function() {
    // ブラウザがデコードできない場合はそのまま渡す
    cb(file);
  };
  img.src = URL.createObjectURL(file);
}

function uploadInParallel(managedId, blobs, concurrency, onProgress, onDone) {
  var fd = new FormData();
  fd.append('managedId', managedId);
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
      onDone(null);
    } else {
      if (d.message && d.message.indexOf('トークン') >= 0) { showAuth(); }
      onDone(d.message || 'アップロード失敗');
    }
  }).catch(function(e) { onDone(e.message); });
}

// ─── セクション2: 一括ダウンロード ───
var productListData = [];

function loadProductList() {
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
    if (productListData.length === 0) {
      showStatus('dlLoadStatus', 'アップロード済み商品はありません', 'info');
      return;
    }
    showStatus('dlLoadStatus', productListData.length + '件の商品', 'ok');
    renderProductList();
  }).catch(function(e) { showStatus('dlLoadStatus', 'ネットワークエラー', 'err'); });
}

function renderProductList() {
  var el = document.getElementById('productList');
  var html = '';
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-idx="' + i + '" onchange="updateSelectedCount()">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="list-thumb"></div>') +
      '<div class="list-info"><div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚 <span class="dl-status" id="dlst-' + i + '">✓保存済</span></div></div>' +
      '</div>';
  }
  el.innerHTML = html;
  document.getElementById('selectAllRow').classList.remove('hidden');
  document.getElementById('dlBtn').classList.remove('hidden');
}

function toggleSelectAll() {
  var checked = document.getElementById('selectAll').checked;
  document.querySelectorAll('.dl-check').forEach(function(c) { c.checked = checked; });
  updateSelectedCount();
}

function updateSelectedCount() {
  var checks = document.querySelectorAll('.dl-check:checked');
  document.getElementById('selectedCount').textContent = checks.length + '件選択';
}

function doDownloadSelected() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) { showStatus('dlStatus', '商品を選択してください', 'err'); return; }

  var indices = [];
  checks.forEach(function(c) { indices.push(parseInt(c.dataset.idx)); });

  var btn = document.getElementById('dlBtn');
  btn.disabled = true;
  showStatus('dlStatus', '0/' + indices.length + ' 保存中...', 'info');

  // 1枚ずつ300ms間隔でダウンロード
  var i = 0;
  function next() {
    if (i >= indices.length) {
      btn.disabled = false;
      showStatus('dlStatus', indices.length + '枚保存完了', 'ok');
      return;
    }
    var idx = indices[i];
    var p = productListData[idx];
    var url = API_BASE + p.thumbnail;
    showStatus('dlStatus', (i + 1) + '/' + indices.length + ' 保存中... ' + p.managedId, 'info');

    fetch(url).then(function(r) { return r.blob(); })
    .then(function(blob) {
      saveBlob(blob, p.managedId + '.jpg');
      var st = document.getElementById('dlst-' + idx);
      if (st) { st.classList.add('show'); }
      i++;
      setTimeout(next, 300);
    }).catch(function() {
      i++;
      setTimeout(next, 300);
    });
  }
  next();
}

function saveBlob(blob, filename) {
  // navigator.share対応（iOS Safari）
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] })) {
    // iOS: shareは非同期だが、連続実行の場合はdownloadフォールバック
  }
  // ダウンロードリンク方式
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

// ─── セクション3: 上書き ───
function loadCurrentImage() {
  var managedId = document.getElementById('replaceManagedId').value.trim();
  if (!managedId) { showStatus('replaceStatus', '管理番号を入力してください', 'err'); return; }

  var url = API_BASE + '/images/products/' + encodeURIComponent(managedId) + '/1.jpg';
  var img = document.getElementById('replaceCurrentImg');
  var wrap = document.getElementById('replacePreview');

  img.onload = function() { wrap.classList.remove('hidden'); };
  img.onerror = function() {
    wrap.classList.add('hidden');
    showStatus('replaceStatus', 'この管理番号の画像はまだアップロードされていません', 'info');
  };
  img.src = url + '?t=' + Date.now();
}

function doReplace() {
  var managedId = document.getElementById('replaceManagedId').value.trim();
  if (!managedId) { showStatus('replaceStatus', '管理番号を入力してください', 'err'); return; }
  var file = document.getElementById('replaceFile').files[0];
  if (!file) { showStatus('replaceStatus', '画像を選択してください', 'err'); return; }

  showStatus('replaceStatus', 'リサイズ中...', 'info');
  resizeImage(file, 1200, 0.80, function(blob) {
    showStatus('replaceStatus', 'アップロード中...', 'info');
    var fd = new FormData();
    fd.append('managedId', managedId);
    fd.append('image', blob, '1.jpg');

    fetch(API_BASE + '/upload/replace', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: fd
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        showStatus('replaceStatus', '上書き完了', 'ok');
        loadCurrentImage();
      } else {
        if (d.message && d.message.indexOf('トークン') >= 0) showAuth();
        showStatus('replaceStatus', d.message || 'エラー', 'err');
      }
    }).catch(function(e) { showStatus('replaceStatus', 'ネットワークエラー', 'err'); });
  });
}

// ─── ユーティリティ ───
function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
</script>
</body>
</html>`;
}
