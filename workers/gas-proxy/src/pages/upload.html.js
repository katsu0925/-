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
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/tasukibako-apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#3b82f6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="タスキ箱">
<title>タスキ箱 | デタウリ</title>
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
.preview-btn{position:absolute;bottom:2px;right:2px;background:rgba(255,255,255,.9);border-radius:4px;font-size:12px;padding:2px 4px;cursor:pointer}
.blur-btn{position:absolute;bottom:2px;left:2px;background:rgba(255,255,255,.92);border-radius:4px;font-size:10px;padding:2px 5px;cursor:pointer;color:#4F46E5;font-weight:600;border:none;line-height:1.3;z-index:3}
.blur-btn:hover{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.blur-btn.done{background:rgba(79,70,229,.85);color:#fff}
.blur-btn.processing{pointer-events:none;opacity:.7}
.blur-overlay{position:absolute;inset:0;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;z-index:2}
.img-check-wrap{position:relative}
.img-check-wrap input[type=checkbox]{position:absolute;top:4px;left:4px;z-index:2;width:18px;height:18px;accent-color:#3b82f6}
.img-check-wrap .badge{left:auto;right:2px}
.sticky-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e7eb;padding:12px 16px calc(16px + env(safe-area-inset-bottom));z-index:50;display:none}
.sticky-footer.show{display:block}
.sticky-footer .footer-inner{max-width:600px;margin:0 auto;display:flex;gap:8px}
.sticky-footer .footer-inner .btn{flex:1;margin:0;padding:10px;font-size:14px}
.del-check{width:20px;height:20px;accent-color:#ef4444;flex-shrink:0}
.manage-sticky-header{position:sticky;top:0;z-index:20;background:#fff;padding:12px 16px 8px;border-radius:12px 12px 0 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
@media(max-width:480px){.img-grid{grid-template-columns:repeat(2,1fr)}.preview-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:481px) and (max-width:768px){.img-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:769px){.img-grid{grid-template-columns:repeat(4,1fr)}}
.hdr-icon{width:32px;height:32px;border:none;background:none;border-radius:8px;cursor:pointer;color:#6b7280;font-size:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}
.hdr-icon:active{background:#e5e7eb}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <h1>タスキ箱</h1>

  <!-- 認証フォーム（トークンがあれば初期非表示→検証後に切り替え） -->
  <div id="authSection" class="card auth-wall hidden">
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
    <div class="tab-bar" style="display:flex;align-items:center">
      <button class="tab active" onclick="switchTab('upload')" style="flex:1">アップロード <span id="unmatchedBadge" style="display:none;background:#ef4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:8px;margin-left:2px"></span></button>
      <button class="tab" onclick="switchTab('manage')" style="flex:1">商品管理</button>
      <div style="display:flex;gap:2px;align-items:center;flex-shrink:0">
        <button id="refreshBtn" onclick="doRefresh()" class="hdr-icon" title="更新"><span id="refreshIcon" style="display:inline-flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></span></button>
        <button id="shareBtn" onclick="shareApp()" class="hdr-icon" style="display:none" title="共有"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 6 12 2 16 6"/><line x1="12" y1="2" x2="12" y2="16"/><path d="M6 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg></button>
        <button onclick="showHelpGuide()" class="hdr-icon" title="ヘルプ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>
      </div>
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
        <div style="margin-top:8px">
          <label style="display:inline-flex;align-items:center;gap:5px;font-size:13px;color:#374151;cursor:pointer">
            <input type="checkbox" id="autoLevelsCheck" checked style="width:16px;height:16px;accent-color:#4F46E5">
            明るさ自動補正
          </label>
        </div>
        <div class="preview-grid" id="uploadPreview"></div>
        <!-- ぼかし操作バー -->
        <div id="blurBar" style="display:none;margin-top:8px;align-items:center;gap:6px;flex-wrap:wrap">
          <button id="blurSelectedBtn" onclick="blurSelected()" style="padding:5px 12px;border:1.5px solid #4F46E5;background:#fff;color:#4F46E5;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">選択をぼかす</button>
          <button onclick="selectAllUpload(true)" style="padding:5px 8px;border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:11px;cursor:pointer">全選択</button>
          <button onclick="selectAllUpload(false)" style="padding:5px 8px;border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:11px;cursor:pointer">全解除</button>
          <span id="blurProgress" style="font-size:12px;color:#6b7280"></span>
          <span id="blurUsage" style="font-size:11px;color:#9ca3af;margin-left:auto"></span>
        </div>
        <div id="blurStatus" style="display:none;font-size:12px;color:#6b7280;margin-top:4px"></div>
        <div class="progress-bar" id="uploadProgress"><div class="fill" id="uploadProgressFill"></div></div>
        <div class="status" id="uploadStatus"></div>
      </div>
    </div>

    <!-- セクション2: 商品管理（一括DL・検索・削除・並び替え統合） -->
    <div class="section" id="sec-manage">
      <div class="manage-sticky-header">
        <div class="form-group" style="margin-bottom:6px">
          <input type="text" id="manageSearch" placeholder="管理番号で検索..." autocomplete="off" oninput="filterManageList()">
        </div>
        <div id="filterBar" style="display:none;margin-bottom:6px;font-size:12px">
          <div style="display:flex;gap:4px;margin-bottom:4px">
            <select id="filterPhotographer" onchange="filterManageList()" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"><option value="">撮影者: 全員</option></select>
            <select id="filterSave" onchange="filterManageList()" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"><option value="">保存: すべて</option><option value="unsaved">未保存</option><option value="saved">保存済み</option></select>
            <select id="filterRegistered" onchange="filterManageList()" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"><option value="">採寸: すべて</option><option value="unregistered">未登録</option><option value="registered">登録済み</option></select>
          </div>
          <div style="display:flex;gap:4px;align-items:center">
            <label style="flex:1;position:relative"><span style="position:absolute;left:8px;top:5px;font-size:11px;color:#999;pointer-events:none" id="filterDateFromLabel">年/月/日</span><input type="date" id="filterDateFrom" onchange="filterManageList();this.previousElementSibling.style.display=this.value?'none':''" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"></label>
            <span style="font-size:11px;color:#999;flex-shrink:0">〜</span>
            <label style="flex:1;position:relative"><span style="position:absolute;left:8px;top:5px;font-size:11px;color:#999;pointer-events:none" id="filterDateToLabel">年/月/日</span><input type="date" id="filterDateTo" onchange="filterManageList();this.previousElementSibling.style.display=this.value?'none':''" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"></label>
            <button id="filterClearBtn" onclick="clearFilters()" style="display:none;padding:4px 8px;border:none;border-radius:6px;font-size:11px;background:#ef4444;color:#fff;cursor:pointer;white-space:nowrap;flex-shrink:0">クリア</button>
          </div>
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

<!-- ローディングポップアップ -->
<div id="loadingPopup" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:400;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:12px;padding:20px 28px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.2);max-width:280px">
    <div style="width:28px;height:28px;border:3px solid rgba(79,70,229,.2);border-top-color:#4F46E5;border-radius:50%;animation:ptr-spin .6s linear infinite;margin:0 auto 12px"></div>
    <div id="loadingText" style="font-size:14px;font-weight:600;color:#1f2937">処理中...</div>
    <div id="loadingSubText" style="font-size:12px;color:#6b7280;margin-top:4px"></div>
  </div>
</div>

<!-- 画像プレビューモーダル -->
<div id="previewModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.9);z-index:300;align-items:center;justify-content:center;cursor:pointer" onclick="closePreview()">
  <img id="previewImg" style="max-width:95%;max-height:90vh;object-fit:contain;border-radius:4px">
  <div id="previewCompareBar" style="display:none;position:absolute;top:calc(env(safe-area-inset-top,12px) + 8px);left:50%;transform:translateX(-50%);gap:8px">
    <button id="previewBtnBlur" onclick="event.stopPropagation();showPreviewBlur()" style="padding:6px 16px;border:none;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#1f2937">ぼかし済</button>
    <button id="previewBtnOrig" onclick="event.stopPropagation();showPreviewOrig()" style="padding:6px 16px;border:none;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;background:rgba(255,255,255,.3);color:#fff">元画像</button>
  </div>
  <div style="position:absolute;top:env(safe-area-inset-top,12px);right:12px;color:#fff;font-size:32px;cursor:pointer;padding:8px;line-height:1" onclick="closePreview()">✕</div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script>
// ─── 設定 ───
var API_BASE = location.origin;

// ─── ローディングポップアップ ───
function showLoading(text, subText) {
  document.getElementById('loadingText').textContent = text || '処理中...';
  document.getElementById('loadingSubText').textContent = subText || '';
  document.getElementById('loadingPopup').style.display = 'flex';
}
function updateLoading(text, subText) {
  if (text) document.getElementById('loadingText').textContent = text;
  if (subText !== undefined) document.getElementById('loadingSubText').textContent = subText;
}
function hideLoading() {
  document.getElementById('loadingPopup').style.display = 'none';
}
var TOKEN_KEY = 'detauri_upload_token';
var TOKEN_VERIFIED_KEY = 'detauri_token_verified_at';
var PHOTOGRAPHER_KEY = 'detauri_photographer';
var _workersList = [];

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
  if (t) localStorage.setItem(TOKEN_VERIFIED_KEY, String(Date.now()));
  else localStorage.removeItem(TOKEN_VERIFIED_KEY);
}

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
  if (!getToken()) { showAuth(); return; }

  var lastVerified = Number(localStorage.getItem(TOKEN_VERIFIED_KEY) || '0');
  var hoursSince = (Date.now() - lastVerified) / (1000 * 60 * 60);

  if (hoursSince < 24) {
    // 24時間以内に検証済み → 即座にメイン画面、検証スキップ
    showMain();
  } else {
    // 24時間以上 or 未検証 → サーバーで検証してから表示
    fetch(API_BASE + '/upload/list', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: '{}'
    }).then(function(r) {
      if (r.ok) {
        localStorage.setItem(TOKEN_VERIFIED_KEY, String(Date.now()));
        showMain();
      } else { setToken(''); showAuth(); }
    }).catch(function() {
      // オフライン時はトークンがあれば表示を許可
      showMain();
    });
  }
})();

// ─── 更新制御 ───
var _lastRefresh = 0;
var _refreshing = false;
var _busyOperation = false; // アップロード・削除・並べ替え中はtrue

// アプリ復帰時に自動更新（30秒スロットリング＋操作中は抑制）
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && getToken()
      && !document.getElementById('mainSection').classList.contains('hidden')
      && !_busyOperation && Date.now() - _lastRefresh > 30000) {
    doRefresh(null, true);
  }
});

// ─── プルトゥリフレッシュ（AppSheet風） ───
(function initPullToRefresh() {
  var startY = 0, currentDy = 0, pulling = false;
  var indicator = document.createElement('div');
  indicator.style.cssText = 'position:fixed;top:-50px;left:calc(50% - 18px);width:36px;height:36px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:999;display:flex;align-items:center;justify-content:center;transition:top .2s ease;font-size:18px';
  indicator.innerHTML = '&#x21bb;';
  document.body.appendChild(indicator);

  var style = document.createElement('style');
  style.textContent = '@keyframes ptr-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  function hideIndicator() {
    indicator.style.animation = '';
    indicator.style.top = '-50px';
    indicator.style.opacity = '0';
  }

  document.addEventListener('touchstart', function(e) {
    if (!_refreshing && !_busyOperation && window.scrollY === 0 && getToken()
        && !document.getElementById('mainSection').classList.contains('hidden')) {
      startY = e.touches[0].clientY;
      currentDy = 0;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling) return;
    currentDy = e.touches[0].clientY - startY;
    if (currentDy > 10) {
      var visualDy = Math.min(currentDy * 0.5, 70); // 減衰させて自然な動きに
      indicator.style.top = (visualDy - 20) + 'px';
      indicator.style.opacity = Math.min(currentDy / 80, 1);
      indicator.style.animation = '';
    } else if (currentDy < 0) {
      pulling = false;
      hideIndicator();
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!pulling) return;
    pulling = false;
    if (currentDy > 80) {
      indicator.style.top = '16px';
      indicator.style.animation = 'ptr-spin .6s linear infinite';
      doRefresh(function() { hideIndicator(); });
    } else {
      hideIndicator();
    }
  }, { passive: true });
})();

// ─── 更新実行（排他制御・展開状態保持） ───
function doRefresh(cb, silent) {
  if (_refreshing) { if (cb) cb(); return; }
  _refreshing = true;
  _lastRefresh = Date.now();
  var btn = document.getElementById('refreshBtn');
  var icon = document.getElementById('refreshIcon');
  if (icon) icon.style.animation = 'spin .6s linear infinite';
  if (btn) btn.style.opacity = '0.5';
  loadUnmatchedCount();
  _listLoaded = false;
  var savedExpanded = _manageExpandedMid;
  var prevData = JSON.stringify(productListData || []);
  refreshProductList(function() {
    var newData = JSON.stringify(productListData || []);
    if (newData !== prevData) {
      renderManageList();
      if (savedExpanded) toggleManageExpand(savedExpanded);
      showStatus('manageLoadStatus', productListData.length + '件の商品', 'ok');
    }
    _finishRefresh(btn, cb);
  }, true);
}
function _finishRefresh(btn, cb) {
  var icon = document.getElementById('refreshIcon');
  if (icon) icon.style.animation = '';
  if (btn) btn.style.opacity = '';
  _refreshing = false;
  if (cb) cb();
}

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
  // バックグラウンドで商品リストをプリロード
  if (!_listLoaded) refreshProductList(null, true);
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
      var newText = String(d.total);
      var hasWarning = d.items && d.items.some(function(i) { return i.warning; });
      var newBg = hasWarning ? '#ef4444' : '#f59e0b';
      // 値が変わった場合のみDOMを更新
      if (badge.textContent !== newText || badge.style.display !== 'inline' || badge.style.background !== newBg) {
        badge.textContent = newText;
        badge.style.display = 'inline';
        badge.style.background = newBg;
      }
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
  document.getElementById('shareBtn').style.display = (name === 'かつ') ? '' : 'none';
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
  // クリア後の遅延コールバック対策
  if (!normId(document.getElementById('uploadManagedId').value)) return;
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
    var imgSrc = API_BASE + urls[i] + '?t=' + Date.now();
    html += '<div class="preview-item" draggable="true" data-idx="' + i + '">' +
      '<img src="' + imgSrc + '">' +
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
    showLoading('画像を差し替え中');
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
        hideLoading();
        if (d.ok) {
          _existingUrls = d.urls;
          showExistingImages(d.urls, mid);
          showStatus('uploadStatus', '画像を上書きしました', 'ok');
        } else {
          showStatus('uploadStatus', d.message || '上書きエラー', 'err');
        }
      }).catch(function() { hideLoading(); showStatus('uploadStatus', '上書きエラー', 'err'); });
    });
  };
  input.click();
}

// ─── AI背景ぼかし ───
var _blurredImages = {};
var _bgRemovalLib = null;
var _bgModelReady = false;
var _blurBusy = false;
var _blurAbort = false;

// モデルプリロード（ファイル選択時に開始）
var _bgPreloadStarted = false;
// 使用量表示
function updateBlurUsage(res) {
  var count = parseInt(res.headers.get('X-Blur-Usage') || '0');
  var limit = parseInt(res.headers.get('X-Blur-Limit') || '5000');
  var remaining = limit - count;
  var el = document.getElementById('blurUsage');
  if (!el) return;
  el.textContent = '残 ' + remaining + '/' + limit;
  if (remaining <= 0) {
    el.style.color = '#dc2626';
    el.textContent = '無料枠超過（' + count + '/' + limit + '）';
  } else if (remaining <= 500) {
    el.style.color = '#f59e0b';
  } else {
    el.style.color = '#9ca3af';
  }
}

function fetchBlurUsage() {
  fetch('/upload/blur?check=1').then(function(r) { return r.json(); }).then(function(d) {
    if (!d.ok) return;
    var el = document.getElementById('blurUsage');
    if (!el) return;
    var remaining = d.remaining;
    el.textContent = '残 ' + remaining + '/' + d.limit;
    if (remaining <= 0) {
      el.style.color = '#dc2626';
      el.textContent = '無料枠超過（' + d.count + '/' + d.limit + '）';
    } else if (remaining <= 500) {
      el.style.color = '#f59e0b';
    } else {
      el.style.color = '#9ca3af';
    }
  }).catch(function() {});
}

function startBgPreload() {
  if (_bgPreloadStarted) return;
  _bgPreloadStarted = true;
  import('https://esm.sh/@imgly/background-removal@1').then(function(lib) {
    _bgRemovalLib = lib;
    _bgModelReady = true;
    console.log('BG removal model ready');
  }).catch(function(e) { console.warn('BG model preload failed:', e); });
}

// StackBlur ライブラリ（ページ読み込み時にロード）
var _stackBlurLib = null;
(function() {
  import('https://esm.sh/stackblur-canvas@2').then(function(m) {
    _stackBlurLib = m;
    console.log('StackBlur ready');
  }).catch(function(e) { console.warn('StackBlur load failed:', e); });
})();

// Canvas blur（Safari対応: filterが使えない場合はStackBlurで代替）
function canvasBlur(srcCanvas, blurPx) {
  var w = srcCanvas.width, h = srcCanvas.height;
  var out = document.createElement('canvas');
  out.width = w; out.height = h;
  var ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);

  // StackBlur優先（全ブラウザで確実に動作）
  if (_stackBlurLib) {
    var imgData = ctx.getImageData(0, 0, w, h);
    _stackBlurLib.default
      ? _stackBlurLib.default.imageDataRGBA(imgData, 0, 0, w, h, Math.round(blurPx))
      : _stackBlurLib.imageDataRGBA(imgData, 0, 0, w, h, Math.round(blurPx));
    ctx.putImageData(imgData, 0, 0);
    return out;
  }

  // フォールバック: ctx.filter（Chrome/Firefox）
  try {
    var test = document.createElement('canvas').getContext('2d');
    test.filter = 'blur(1px)';
    if (test.filter === 'blur(1px)') {
      ctx.filter = 'blur(' + blurPx + 'px)';
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(srcCanvas, 0, 0);
      ctx.filter = 'none';
    }
  } catch(e) {}
  return out;
}

async function loadBgRemoval() {
  if (_bgRemovalLib) return _bgRemovalLib;
  var s = document.getElementById('blurStatus');
  s.style.display = 'block';
  s.textContent = 'AIモデルを読み込み中…';
  _bgRemovalLib = await import('https://esm.sh/@imgly/background-removal@1');
  s.style.display = 'none';
  return _bgRemovalLib;
}

// 選択画像をぼかし
async function blurSelected() {
  if (_blurBusy) return;
  var checks = document.querySelectorAll('.upload-check:checked');
  if (checks.length === 0) {
    showStatus('uploadStatus', 'ぼかす画像を選択してください', 'err');
    return;
  }

  _blurBusy = true;
  _blurAbort = false;
  var actionBtn = document.getElementById('blurSelectedBtn');
  actionBtn.textContent = '中止';
  actionBtn.onclick = function() { _blurAbort = true; };

  // 選択されたインデックスを取得
  var indices = [];
  checks.forEach(function(cb) { indices.push(parseInt(cb.dataset.idx)); });

  // 待機中UIを一括セット
  var items = document.getElementById('uploadPreview').children;
  for (var k = 0; k < indices.length; k++) {
    var item = items[indices[k]];
    if (!item || _blurredImages[indices[k]]) continue;
    if (!item.querySelector('.blur-overlay')) {
      var ov = document.createElement('div');
      ov.className = 'blur-overlay';
      ov.innerHTML = '<div style="width:20px;height:20px;border:2.5px solid rgba(79,70,229,.2);border-top-color:#4F46E5;border-radius:50%;animation:ptr-spin .6s linear infinite"></div>';
      item.appendChild(ov);
    }
  }

  _blurBatchMode = true;
  showLoading('ぼかし処理中', '0/' + indices.length);
  var done = 0;
  for (var k = 0; k < indices.length; k++) {
    if (_blurAbort) break;
    var idx = indices[k];
    if (_blurredImages[idx]) { done++; continue; }
    updateLoading('ぼかし処理中', (done+1) + '/' + indices.length);
    document.getElementById('blurProgress').textContent = (done+1) + '/' + indices.length + ' 処理中…';
    await processBlur(idx);
    done++;
    await new Promise(function(r) { setTimeout(r, 30); });
  }
  _blurBatchMode = false;
  hideLoading();

  // 全画像のUI を一括反映
  for (var k = 0; k < indices.length; k++) {
    applyBlurUI(indices[k]);
  }

  document.getElementById('blurProgress').textContent = _blurAbort ? '中断' : done + '枚完了';
  actionBtn.textContent = '選択をぼかす';
  actionBtn.onclick = blurSelected;
  _blurBusy = false;
  _blurAbort = false;
  checks.forEach(function(cb) { cb.checked = false; });
}

// 個別処理
async function processBlur(fileIndex) {
  var files = document.getElementById('uploadFiles').files;
  var file = files[fileIndex];
  if (!file) return;
  var item = document.getElementById('uploadPreview').children[fileIndex];
  if (!item) return;

  if (!item.querySelector('.blur-overlay')) {
    var ov = document.createElement('div');
    ov.className = 'blur-overlay';
    ov.innerHTML = '<div style="width:20px;height:20px;border:2.5px solid rgba(79,70,229,.2);border-top-color:#4F46E5;border-radius:50%;animation:ptr-spin .6s linear infinite"></div>';
    item.appendChild(ov);
  }

  try {
    // サーバーサイド（CF Images segment）を優先、失敗時はブラウザWASMにフォールバック
    var fgBlob;
    try {
      var fd = new FormData();
      fd.append('image', file);
      var segRes = await fetch('/upload/blur', { method: 'POST', body: fd });
      if (segRes.ok) {
        fgBlob = await segRes.blob();
        updateBlurUsage(segRes);
      } else {
        throw new Error('server ' + segRes.status);
      }
    } catch(serverErr) {
      console.warn('CF segment failed, falling back to WASM:', serverErr);
      var lib = await loadBgRemoval();
      fgBlob = await lib.removeBackground(file, {
        model: 'medium',
        output: { format: 'image/png' }
      });
    }

    var isTop = (_existingUrls.length === 0 && fileIndex === 0);
    var maxSize = isTop ? 1200 : 800;
    var quality = isTop ? 0.80 : 0.75;

    var origBmp = await createImageBitmap(file);
    var w = origBmp.width, h = origBmp.height;
    if (w > maxSize || h > maxSize) {
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
    }

    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(origBmp, 0, 0, w, h);
    origBmp.close();

    // ぼかし版（StackBlur直接適用、Canvas経由不要）
    var blurC = document.createElement('canvas');
    blurC.width = w; blurC.height = h;
    var blurCtx = blurC.getContext('2d');
    blurCtx.drawImage(canvas, 0, 0);
    var blurFn = _stackBlurLib && (_stackBlurLib.default
      ? _stackBlurLib.default.imageDataRGBA : _stackBlurLib.imageDataRGBA);
    if (blurFn) {
      var bid = blurCtx.getImageData(0, 0, w, h);
      blurFn(bid, 0, 0, w, h, 9);
      blurCtx.putImageData(bid, 0, 0);
      bid = null;
    } else {
      blurC = canvasBlur(canvas, 9);
      blurCtx = blurC.getContext('2d');
    }

    // マスクalpha抽出 → StackBlur直接で膨張+フェザリング（Canvas最小化）
    var fgBmp = await createImageBitmap(fgBlob);
    var maskC = document.createElement('canvas');
    maskC.width = w; maskC.height = h;
    var mCtx = maskC.getContext('2d');
    mCtx.drawImage(fgBmp, 0, 0, w, h);
    fgBmp.close();
    var maskData = mCtx.getImageData(0, 0, w, h);
    maskC.width = 0;

    var alphaImg = new ImageData(w, h);
    var md = maskData.data, ad = alphaImg.data;
    for (var p = 0, len = md.length; p < len; p += 4) {
      ad[p] = md[p+3]; ad[p+1] = md[p+3]; ad[p+2] = md[p+3]; ad[p+3] = 255;
    }
    maskData = null;

    if (blurFn) {
      // 膨張: 1パス blur(10px) + ブースト（3パス相当）
      blurFn(alphaImg, 0, 0, w, h, 10);
      for (var dp = 0, dlen = ad.length; dp < dlen; dp += 4) {
        var v = ad[dp] * 4.0;
        ad[dp] = ad[dp+1] = ad[dp+2] = v > 255 ? 255 : v;
      }
      // フェザリング
      blurFn(alphaImg, 0, 0, w, h, 12);
    } else {
      // StackBlur未ロード時のフォールバック（canvasBlur経由）
      var alphaC = document.createElement('canvas');
      alphaC.width = w; alphaC.height = h;
      var aCtx = alphaC.getContext('2d');
      aCtx.putImageData(alphaImg, 0, 0);
      for (var pass = 0; pass < 3; pass++) {
        var tmpDil = canvasBlur(alphaC, 6);
        var dd = tmpDil.getContext('2d').getImageData(0, 0, w, h);
        for (var dp2 = 0; dp2 < dd.data.length; dp2 += 4) {
          dd.data[dp2] = dd.data[dp2+1] = dd.data[dp2+2] = Math.min(255, dd.data[dp2] * 2.5);
        }
        aCtx.putImageData(dd, 0, 0);
        tmpDil.width = 0;
      }
      var featherC = canvasBlur(alphaC, 12);
      alphaImg = featherC.getContext('2d').getImageData(0, 0, w, h);
      ad = alphaImg.data;
      alphaC.width = 0; featherC.width = 0;
    }

    // ブレンド
    var origData = ctx.getImageData(0, 0, w, h);
    var blurData = blurCtx.getImageData(0, 0, w, h);
    var od = origData.data, bd = blurData.data;
    for (var p = 0, len = od.length; p < len; p += 4) {
      var t = 1 - (ad[p] / 255);
      od[p]   = od[p]   + (bd[p]   - od[p])   * t;
      od[p+1] = od[p+1] + (bd[p+1] - od[p+1]) * t;
      od[p+2] = od[p+2] + (bd[p+2] - od[p+2]) * t;
    }
    ctx.putImageData(origData, 0, 0);

    var resultBlob = await new Promise(function(r) {
      canvas.toBlob(r, 'image/jpeg', quality);
    });
    _blurredImages[fileIndex] = resultBlob;
    canvas.width = 0; blurC.width = 0;

    // バッチモード（blurSelected経由）ではUI更新を遅延
    if (!_blurBatchMode) {
      applyBlurUI(fileIndex);
    }
  } catch(e) {
    console.error('Blur error:', e);
    if (!_blurBatchMode) {
      var ovEl = item.querySelector('.blur-overlay');
      if (ovEl) ovEl.remove();
    }
    showStatus('uploadStatus', 'ぼかし処理失敗: ' + e.message, 'err');
  }
}

var _blurBatchMode = false;

// UI反映（1枚分）
function applyBlurUI(fileIndex) {
  var item = document.getElementById('uploadPreview').children[fileIndex];
  if (!item || !_blurredImages[fileIndex]) return;
  item.querySelector('img').src = URL.createObjectURL(_blurredImages[fileIndex]);
  if (!item.querySelector('.blur-done-badge')) {
    var badge = document.createElement('span');
    badge.className = 'blur-done-badge';
    badge.style.cssText = 'position:absolute;bottom:2px;left:2px;background:rgba(79,70,229,.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;z-index:3;cursor:pointer';
    badge.textContent = 'ぼかし済';
    badge.title = 'タップで解除';
    badge.onclick = function(e) { e.stopPropagation(); removeBlur(fileIndex); };
    item.appendChild(badge);
  }
  var ovEl = item.querySelector('.blur-overlay');
  if (ovEl) ovEl.remove();
}

function removeBlur(fileIndex) {
  delete _blurredImages[fileIndex];
  var files = document.getElementById('uploadFiles').files;
  var item = document.getElementById('uploadPreview').children[fileIndex];
  if (item && files[fileIndex]) {
    item.querySelector('img').src = URL.createObjectURL(files[fileIndex]);
    var badge = item.querySelector('.blur-done-badge');
    if (badge) badge.remove();
  }
}

// ─── プレビュー・アップロード ───
function showPreview() {
  startBgPreload(); // ファイル選択時にモデル読み込み開始
  var input = document.getElementById('uploadFiles');
  var grid = document.getElementById('uploadPreview');
  var btn = document.getElementById('uploadBtn');
  grid.innerHTML = '';
  var files = input.files;
  if (!files || files.length === 0) { btn.disabled = true; document.getElementById('blurBar').style.display = 'none'; return; }
  var maxNew = 10 - _existingUrls.length;
  if (files.length > maxNew) {
    showStatus('uploadStatus', '画像は最大10枚までです（既存' + _existingUrls.length + '枚＋新規は' + maxNew + '枚まで）', 'err');
    input.value = '';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  _blurredImages = {};
  _uploadFileOrder = [];
  for (var i = 0; i < files.length; i++) {
    _uploadFileOrder.push(i);
    var div = document.createElement('div');
    div.className = 'preview-item';
    div.setAttribute('data-idx', i);
    div.setAttribute('draggable', 'true');
    var origUrl = URL.createObjectURL(files[i]);
    div.setAttribute('data-orig', origUrl);
    div.onclick = function(e) { toggleUploadCheck(this, e); };
    var labelIdx = _existingUrls.length + i;
    div.innerHTML =
      '<input type="checkbox" class="upload-check" data-idx="' + i + '" style="position:absolute;top:4px;left:4px;z-index:2;width:18px;height:18px;accent-color:#4F46E5">' +
      '<img src="' + origUrl + '" loading="lazy">' +
      (labelIdx === 0 ? '<span class="badge" style="left:auto;right:2px">トップ</span>' : '<span class="badge" style="left:auto;right:2px">' + (labelIdx+1) + '</span>') +
      '<span class="preview-btn" onclick="event.stopPropagation();previewUploadImg(this.parentNode)">🔍</span>';
    grid.appendChild(div);
    generateLevelsPreview(files[i], i, grid);
  }
  initUploadDragReorder(grid);
  // ぼかしバー表示
  var bar = document.getElementById('blurBar');
  bar.style.display = 'flex';
  document.getElementById('blurProgress').textContent = '';
  fetchBlurUsage();
}

var _uploadFileOrder = [];

// 明るさ補正プレビュー生成（サムネ用、300px）
var _levelsPreviewUrls = {};
function generateLevelsPreview(file, idx, grid) {
  if (typeof createImageBitmap !== 'function') return;
  createImageBitmap(file).then(function(bmp) {
    var w = bmp.width, h = bmp.height;
    var maxSize = 300;
    if (w > maxSize || h > maxSize) {
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
    autoLevels(ctx, w, h);
    c.toBlob(function(blob) {
      c.width = 0;
      var url = URL.createObjectURL(blob);
      _levelsPreviewUrls[idx] = url;
      var chk = document.getElementById('autoLevelsCheck');
      if (chk && chk.checked) {
        var item = grid.children[idx];
        if (item && !item.querySelector('.blur-done-badge')) {
          item.querySelector('img').src = url;
        }
      }
    }, 'image/jpeg', 0.85);
  }).catch(function() {});
}

// チェックボックス切替時にプレビュー画像を差し替え
document.getElementById('autoLevelsCheck').addEventListener('change', function() {
  var grid = document.getElementById('uploadPreview');
  var items = grid.querySelectorAll('.preview-item');
  var checked = this.checked;
  items.forEach(function(item) {
    if (item.querySelector('.blur-done-badge')) return;
    var idx = parseInt(item.getAttribute('data-idx'));
    var img = item.querySelector('img');
    if (checked && _levelsPreviewUrls[idx]) {
      img.src = _levelsPreviewUrls[idx];
    } else {
      var orig = item.getAttribute('data-orig');
      if (orig) img.src = orig;
    }
  });
});

function initUploadDragReorder(grid) {
  var dragItem = null;
  var items = grid.querySelectorAll('.preview-item');
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
    item.addEventListener('dragover', function(e) { e.preventDefault(); });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!dragItem || dragItem === this) return;
      var all = Array.from(grid.querySelectorAll('.preview-item'));
      var from = all.indexOf(dragItem);
      var to = all.indexOf(this);
      if (from < to) { grid.insertBefore(dragItem, this.nextSibling); }
      else { grid.insertBefore(dragItem, this); }
      // バッジ番号更新
      updateUploadBadges(grid);
      // ファイル順序更新
      var moved = _uploadFileOrder.splice(from, 1)[0];
      _uploadFileOrder.splice(to, 0, moved);
    });
  });
}

function updateUploadBadges(grid) {
  var items = grid.querySelectorAll('.preview-item');
  items.forEach(function(item, i) {
    var badge = item.querySelector('.badge');
    var labelIdx = _existingUrls.length + i;
    if (badge) badge.textContent = labelIdx === 0 ? 'トップ' : (labelIdx + 1);
  });
}

function previewUploadImg(wrap) {
  var imgSrc = wrap.querySelector('img').src;
  var origSrc = wrap.getAttribute('data-orig') || '';
  // ぼかし済みなら元画像と比較可能
  var isBlurred = !!wrap.querySelector('.blur-done-badge');
  openPreview(imgSrc, isBlurred ? origSrc : '');
}

function toggleUploadCheck(wrap, e) {
  if (e && e.target.tagName === 'INPUT') return;
  if (e && e.target.classList.contains('preview-btn')) return;
  var cb = wrap.querySelector('input[type=checkbox]');
  if (cb) cb.checked = !cb.checked;
}

function selectAllUpload(checked) {
  document.querySelectorAll('.upload-check').forEach(function(cb) { cb.checked = checked; });
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
  _busyOperation = true;
  var bar = document.getElementById('uploadProgress');
  var fill = document.getElementById('uploadProgressFill');
  bar.classList.add('show');
  fill.style.width = '0%';
  showStatus('uploadStatus', 'リサイズ中...', 'info');
  showLoading('アップロード中', 'リサイズしています...');

  resizeAllImages(files, function(blobs) {
    updateLoading('アップロード中', '0/' + blobs.length);
    showStatus('uploadStatus', '0/' + blobs.length + ' アップロード中...', 'info');
    uploadInParallel(managedId, blobs, 3, photographer, photographyDate, function(done, total) {
      fill.style.width = Math.round(done / total * 100) + '%';
      updateLoading('アップロード中', done + '/' + total);
      showStatus('uploadStatus', done + '/' + total + ' アップロード中...', 'info');
    }, function(err, response) {
      hideLoading();
      btn.disabled = false;
      _busyOperation = false;
      bar.classList.remove('show');
      if (err) {
        showStatus('uploadStatus', 'エラー: ' + err, 'err');
      } else {
        if (response && response.registered === false) {
          showStatus('uploadStatus', blobs.length + '枚アップロード完了（撮影先行: 採寸情報入力後に自動連携されます）', 'info');
        } else {
          showStatus('uploadStatus', blobs.length + '枚アップロード完了', 'ok');
        }
        clearTimeout(_managedIdTimer);
        input.value = '';
        document.getElementById('uploadPreview').innerHTML = '';
        _blurredImages = {};
        _uploadFileOrder = [];
        document.getElementById('blurBar').style.display = 'none';
        document.getElementById('uploadManagedId').value = '';
        document.getElementById('existingImages').classList.add('hidden');
        document.getElementById('existingGrid').innerHTML = '';
        _existingUrls = []; _uploadMode = 'new';
        // 商品リストを更新（バックグラウンド）
        doRefresh();
      }
    });
  });
}

function resizeAllImages(files, cb) {
  // _uploadFileOrderの順序で処理（並べ替え反映）
  var order = _uploadFileOrder.length > 0 ? _uploadFileOrder : [];
  if (order.length === 0) { for (var oi = 0; oi < files.length; oi++) order.push(oi); }
  var total = order.length;
  var results = [];
  var idx = 0;
  var done = 0;
  var concurrency = 2;
  function next() {
    while (idx < total && (idx - done) < concurrency) {
      (function(pos) {
        idx++;
        var fileIdx = order[pos];
        // AIぼかし済みの画像はそのまま使用
        if (_blurredImages[fileIdx]) {
          results[pos] = _blurredImages[fileIdx];
          done++;
          if (done === total) { cb(results); return; }
          next();
          return;
        }
        var isTop = (_existingUrls.length === 0 && pos === 0);
        var maxSize = isTop ? 1200 : 800;
        var quality = isTop ? 0.80 : 0.75;
        resizeImage(files[fileIdx], maxSize, quality, function(blob) {
          results[pos] = blob;
          done++;
          if (done === total) { cb(results); return; }
          next();
        });
      })(idx);
    }
  }
  next();
}

// 自動明るさ補正（画像ごとに最適なガンマを計算）
function autoLevels(ctx, w, h) {
  var data = ctx.getImageData(0, 0, w, h);
  var d = data.data;
  var totalPixels = w * h;

  // 平均輝度＋各チャンネル白点を同時に計算（1パス）
  var sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
  var rHist = new Uint32Array(256), gHist = new Uint32Array(256), bHist = new Uint32Array(256);
  for (var i = 0; i < d.length; i += 4) {
    sumR += d[i]; sumG += d[i+1]; sumB += d[i+2];
    sumLum += d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    rHist[d[i]]++; gHist[d[i+1]]++; bHist[d[i+2]]++;
  }
  var avgLum = sumLum / totalPixels;

  // 本当に全体が明るい画像（avgLum > 200）はスキップ
  if (avgLum > 200) return;

  // 各チャンネルの白点（上位2%の平均）
  function findWhite(hist) {
    var th = Math.floor(totalPixels * 0.02);
    var cnt = 0, sum = 0, num = 0;
    for (var v = 255; v >= 0; v--) {
      cnt += hist[v]; sum += v * hist[v]; num += hist[v];
      if (cnt >= th) break;
    }
    return num > 0 ? sum / num : 255;
  }
  var rW = findWhite(rHist), gW = findWhite(gHist), bW = findWhite(bHist);

  // ホワイトバランス: 各チャンネルの白点を248に揃える
  var rScale = 248 / Math.max(rW, 1);
  var gScale = 248 / Math.max(gW, 1);
  var bScale = 248 / Math.max(bW, 1);
  rScale = Math.min(1.5, Math.max(1.0, rScale));
  gScale = Math.min(1.5, Math.max(1.0, gScale));
  bScale = Math.min(1.5, Math.max(1.0, bScale));

  // 画像の明るさに応じたガンマ値を動的に計算
  // 目標: 平均輝度を155に近づける（商品写真に最適）
  var target = 155;
  var gamma;
  if (avgLum < 30) {
    gamma = 1.8; // 非常に暗い
  } else if (avgLum >= target - 10) {
    gamma = 1.0; // 既に適正（ホワイトバランスのみ適用）
  } else {
    // 平均輝度から目標への必要ガンマを計算
    gamma = Math.log(target / 255) / Math.log(avgLum / 255);
    gamma = Math.min(1.8, Math.max(1.0, gamma));
  }

  // 変化が小さすぎればスキップ
  var maxScale = Math.max(rScale, gScale, bScale);
  if (Math.abs(gamma - 1) < 0.03 && maxScale < 1.02) return;

  // LUT作成（ホワイトバランス＋ガンマを合成）
  var rLut = new Uint8Array(256), gLut = new Uint8Array(256), bLut = new Uint8Array(256);
  for (var v = 0; v < 256; v++) {
    rLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * rScale / 255), 1 / gamma)));
    gLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * gScale / 255), 1 / gamma)));
    bLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * bScale / 255), 1 / gamma)));
  }

  for (var i = 0; i < d.length; i += 4) {
    d[i] = rLut[d[i]]; d[i+1] = gLut[d[i+1]]; d[i+2] = bLut[d[i+2]];
  }

  // シャドウリカバリー: 暗い部分だけを自然に持ち上げる
  // 輝度が低いほど強くブースト、明るい部分はそのまま
  var shadowLut = new Float32Array(256);
  for (var v = 0; v < 256; v++) {
    if (v < 120) {
      var t = (120 - v) / 120; // 0(lum=120) → 1(lum=0)
      shadowLut[v] = 1 + Math.pow(t, 0.7) * 1.0; // 0→2倍, 60→1.6倍
    } else {
      shadowLut[v] = 1.0;
    }
  }
  for (var i = 0; i < d.length; i += 4) {
    var lum = Math.round(d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
    var boost = shadowLut[lum];
    if (boost > 1.01) {
      d[i]   = Math.min(255, d[i]   * boost + 0.5 | 0);
      d[i+1] = Math.min(255, d[i+1] * boost + 0.5 | 0);
      d[i+2] = Math.min(255, d[i+2] * boost + 0.5 | 0);
    }
  }

  ctx.putImageData(data, 0, 0);
}

function resizeImage(file, maxSize, quality, cb) {
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
      if (document.getElementById('autoLevelsCheck') && document.getElementById('autoLevelsCheck').checked) autoLevels(ctx, w, h);
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
    if (document.getElementById('autoLevelsCheck') && document.getElementById('autoLevelsCheck').checked) autoLevels(ctx, w, h);
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
  refreshProductList(cb);
}

function refreshProductList(cb, silent) {
  if (!silent) showStatus('manageLoadStatus', '読み込み中...', 'info');
  fetch(API_BASE + '/upload/list', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: '{}'
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) {
      if (d.message && d.message.indexOf('トークン') >= 0) showAuth();
      showStatus('manageLoadStatus', d.message || 'エラー', 'err');
      if (cb) cb();
      return;
    }
    productListData = d.items || [];
    _listLoaded = true;
    populateFilterPhotographer();
    if (!silent) {
      if (productListData.length === 0) {
        showStatus('manageLoadStatus', 'アップロード済み商品はありません', 'info');
      } else {
        showStatus('manageLoadStatus', productListData.length + '件の商品', 'ok');
      }
    }
    if (cb) cb();
  }).catch(function(e) { showStatus('manageLoadStatus', 'ネットワークエラー', 'err'); if (cb) cb(); });
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

function clearFilters() {
  document.getElementById('manageSearch').value = '';
  document.getElementById('filterPhotographer').value = '';
  document.getElementById('filterSave').value = '';
  document.getElementById('filterRegistered').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('filterDateFromLabel').style.display = '';
  document.getElementById('filterDateToLabel').style.display = '';
  filterManageList();
}

function updateFilterClearBtn() {
  var active = document.getElementById('manageSearch').value ||
    document.getElementById('filterPhotographer').value ||
    document.getElementById('filterSave').value ||
    document.getElementById('filterRegistered').value ||
    document.getElementById('filterDateFrom').value ||
    document.getElementById('filterDateTo').value;
  document.getElementById('filterClearBtn').style.display = active ? '' : 'none';
}

function populateFilterPhotographer() {
  var sel = document.getElementById('filterPhotographer');
  var names = {};
  for (var i = 0; i < productListData.length; i++) {
    var n = productListData[i].photographer;
    if (n) names[n] = true;
  }
  var prev = sel.value;
  sel.innerHTML = '<option value="">撮影者: 全員</option>';
  Object.keys(names).sort().forEach(function(n) {
    sel.innerHTML += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
  });
  sel.value = prev;
  document.getElementById('filterBar').style.display = productListData.length > 0 ? 'block' : 'none';
}

function renderManageList() {
  var q = normId(document.getElementById('manageSearch').value);
  var rawQ = document.getElementById('manageSearch').value.trim();
  var fPhoto = document.getElementById('filterPhotographer').value;
  var fDateFrom = document.getElementById('filterDateFrom').value;
  var fDateTo = document.getElementById('filterDateTo').value;
  var fSave = document.getElementById('filterSave').value;
  var fReg = document.getElementById('filterRegistered').value;
  var el = document.getElementById('manageList');
  var html = '';
  var count = 0;
  for (var i = 0; i < productListData.length; i++) {
    var p = productListData[i];
    // テキスト検索
    if (q && p.managedId.toUpperCase().indexOf(q) === -1 && (!p.photographer || p.photographer.indexOf(rawQ) === -1)) continue;
    // 撮影者フィルタ
    if (fPhoto && (p.photographer || '') !== fPhoto) continue;
    // 登録日フィルタ（期間指定）
    if ((fDateFrom || fDateTo) && p.uploadedAt) {
      var ud = p.uploadedAt.slice(0, 10);
      if (fDateFrom && ud < fDateFrom) continue;
      if (fDateTo && ud > fDateTo) continue;
    } else if ((fDateFrom || fDateTo) && !p.uploadedAt) continue;
    // 保存フィルタ
    if (fSave === 'unsaved' && (p.saveCount || 0) > 0) continue;
    if (fSave === 'saved' && (p.saveCount || 0) === 0) continue;
    // 採寸情報フィルタ
    if (fReg === 'unregistered' && p.registered) continue;
    if (fReg === 'registered' && !p.registered) continue;
    count++;
    var thumbSrc = p.thumbnail ? (API_BASE + p.thumbnail) : '';
    html += '<div id="manage-row-' + escapeHtml(p.managedId) + '">' +
      '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-idx="' + i + '" data-mid="' + escapeHtml(p.managedId) + '" onchange="updateSelectedCount();updateDeleteSelectedCount()" onclick="event.stopPropagation()">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">' : '<div class="list-thumb" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')"></div>') +
      '<div class="list-info" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')" style="cursor:pointer"><div class="list-id">' + escapeHtml(p.managedId) + (p.warning ? ' <span style="background:#ef4444;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">採寸情報未登録</span>' : !p.registered ? ' <span style="background:#f59e0b;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">採寸情報未登録</span>' : '') + '</div>' +
      '<div class="list-count">' + p.count + '枚' +
        (p.uploadedAt ? ' | ' + formatShortDate(p.uploadedAt) : '') +
        (p.saveCount > 0 ? ' | 保存' + p.saveCount + '回' : '') +
      '</div></div>' +
      '<span style="color:#3b82f6;font-size:20px;padding:0 8px;cursor:pointer" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">›</span>' +
      '</div></div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('selectAllRow').classList.remove('hidden');
  _manageExpandedMid = '';
  updateSelectedCount();
  updateDeleteSelectedCount();
  // フィルタ結果の件数表示
  var total = productListData.length;
  showStatus('manageLoadStatus', count === total ? total + '件の商品' : count + '/' + total + '件表示', 'ok');
  updateFilterClearBtn();
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
    var meta = d.meta || {};
    var sl = d.saveLog || { count: 0, users: [] };
    _currentSaveLog = sl;
    var html = '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + escapeHtml(managedId) + ' (' + urls.length + '枚)</div>';
    // メタ情報行
    var metaLine = '';
    if (meta.uploadedAt) metaLine += '登録: ' + formatDateTime(meta.uploadedAt) + (meta.photographer ? '(' + escapeHtml(meta.photographer) + ')' : '');
    if (sl.count > 0) metaLine += (metaLine ? ' | ' : '') + '保存: ' + sl.count + '回';
    if (metaLine) {
      html += '<div style="font-size:12px;color:#6b7280;margin-bottom:8px">' + metaLine;
      if (sl.count > 0) html += ' <span style="cursor:pointer;text-decoration:underline;color:#3b82f6" onclick="showSaveLog()">詳細</span>';
      html += '</div>';
    }
    // 画像グリッド（ドラッグ並び替え対応）
    html += '<div class="img-grid" id="manageImageGrid">';
    for (var j = 0; j < urls.length; j++) {
      var fullUrl = API_BASE + urls[j];
      html += '<div class="img-check-wrap preview-item" draggable="true" data-idx="' + j + '" onclick="toggleImgCheck(this,event)" style="cursor:pointer">' +
        '<input type="checkbox" class="dl-img-check" data-mid="' + escapeHtml(managedId) + '" data-url="' + escapeHtml(urls[j]) + '" data-imgidx="' + j + '" checked>' +
        '<img src="' + fullUrl + '?t=' + Date.now() + '" loading="lazy">' +
        '<span class="badge">' + (j === 0 ? 'トップ' : (j+1)) + '</span>' +
        '<span class="preview-btn" onclick="event.stopPropagation();openPreview(this.previousElementSibling.previousElementSibling.src)">🔍</span>' +
        '</div>';
    }
    html += '</div>';
    // 画像選択ボタン
    html += '<div style="margin-top:8px;display:flex;gap:8px">' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'all\\')">全選択</button>' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'top\\')">トップのみ</button>' +
      '<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:8px" onclick="toggleDlImageSelect(\\'none\\')">全解除</button>' +
      '</div>';
    // 操作ボタン: 画像検索 + DL + ぼかし + 削除
    html += '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" style="flex:1;font-size:12px;padding:8px" onclick="searchManageImage(\\'' + escapeHtml(managedId) + '\\')">🔍 画像検索</button>' +
      '<button class="btn btn-success" style="flex:1;font-size:12px;padding:8px" onclick="saveAndDownload(\\'' + escapeHtml(managedId) + '\\')">📥 保存DL</button>' +
      '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn" id="manageBlurBtn" style="flex:1;font-size:12px;padding:8px;background:#4F46E5;color:#fff" onclick="blurManageImages(\\'' + escapeHtml(managedId) + '\\')">✨ 選択をぼかす</button>' +
      '<button class="btn btn-danger" style="flex:1;font-size:12px;padding:8px" onclick="deleteManageImages(\\'' + escapeHtml(managedId) + '\\')">🗑 選択削除</button>' +
      '</div>' +
      '<div id="manageBlurProgress" style="font-size:12px;color:#6b7280;margin-top:4px"></div>';
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

// ─── 保存ログ表示 + 保存DL ───
var _currentSaveLog = { count: 0, users: [] };

function showSaveLog() {
  if (_currentSaveLog.users.length === 0) return;
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center" onclick="this.remove()">' +
    '<div style="background:#fff;border-radius:12px;padding:20px;max-width:360px;width:90%;max-height:60vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<div style="font-weight:600;font-size:15px;margin-bottom:12px">保存履歴</div>';
  for (var i = _currentSaveLog.users.length - 1; i >= 0; i--) {
    var u = _currentSaveLog.users[i];
    html += '<div style="font-size:13px;padding:6px 0;border-bottom:1px solid #f0f0f0">' +
      escapeHtml(u.displayName) + ' <span style="color:#9ca3af">' + formatDateTime(u.savedAt) + '</span></div>';
  }
  html += '<div style="margin-top:12px;text-align:center"><button class="btn" onclick="this.closest(\\x27[style*=fixed]\\x27).remove()" style="font-size:13px;padding:8px 24px;width:auto">閉じる</button></div>';
  html += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function recordSaveLog(managedId) {
  var userName = localStorage.getItem(PHOTOGRAPHER_KEY) || '';
  fetch(API_BASE + '/upload/save-log', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ managedId: managedId, userName: userName })
  }).catch(function() {});
}

function saveAndDownload(managedId) {
  recordSaveLog(managedId);
  // 既存DL処理を実行
  downloadManageImages(managedId);
}

// ─── 展開内: 選択画像DL ───
function downloadManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }
  showLoading('ダウンロード準備中', '0/' + checks.length);
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
        updateLoading('ダウンロード準備中', done + '/' + checks.length);
      })
    );
  });
  Promise.all(promises).then(function() {
    hideLoading();
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

// ─── 展開内: 選択画像ぼかし ───
async function blurManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', 'ぼかす画像を選択してください', 'err'); return; }

  var btn = document.getElementById('manageBlurBtn');
  var prog = document.getElementById('manageBlurProgress');
  btn.disabled = true;
  btn.textContent = '中止';
  var aborted = false;
  btn.onclick = function() { aborted = true; };

  var targets = [];
  checks.forEach(function(c) {
    targets.push({ url: c.dataset.url, idx: parseInt(c.dataset.imgidx), el: c.closest('.img-check-wrap') });
  });

  // 全画像にスピナー表示
  targets.forEach(function(t) {
    if (!t.el.querySelector('.blur-overlay')) {
      var ov = document.createElement('div');
      ov.className = 'blur-overlay';
      ov.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;z-index:2';
      ov.innerHTML = '<div style="width:20px;height:20px;border:2.5px solid rgba(79,70,229,.2);border-top-color:#4F46E5;border-radius:50%;animation:ptr-spin .6s linear infinite"></div>';
      t.el.appendChild(ov);
    }
  });

  showLoading('ぼかし処理中', '0/' + targets.length);
  var done = 0;
  for (var i = 0; i < targets.length; i++) {
    if (aborted) break;
    var t = targets[i];
    updateLoading('ぼかし処理中', (done+1) + '/' + targets.length);
    prog.textContent = (done+1) + '/' + targets.length + ' 処理中…';

    try {
      // 1) 元画像を取得
      var imgUrl = API_BASE + t.url + '?t=' + Date.now();
      var imgRes = await fetch(imgUrl);
      if (!imgRes.ok) throw new Error('画像取得失敗');
      var imgBlob = await imgRes.blob();

      // 2) CF Images segment でぼかし用マスク取得
      var fd = new FormData();
      fd.append('image', imgBlob);
      var segRes = await fetch('/upload/blur', { method: 'POST', body: fd });
      var fgBlob;
      if (segRes.ok) {
        fgBlob = await segRes.blob();
      } else {
        // フォールバック: ブラウザWASM
        var lib = await loadBgRemoval();
        fgBlob = await lib.removeBackground(imgBlob, { model: 'medium', output: { format: 'image/png' } });
      }

      // 3) 合成（ぼかし背景 + シャープ前景）
      var origBmp = await createImageBitmap(imgBlob);
      var w = origBmp.width, h = origBmp.height;
      var maxSize = (t.idx === 0) ? 1200 : 800;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(origBmp, 0, 0, w, h);
      origBmp.close();
      var origData = ctx.getImageData(0, 0, w, h);

      var blurC = canvasBlur(canvas, 9);
      var blurData = blurC.getContext('2d').getImageData(0, 0, w, h);

      var fgBmp = await createImageBitmap(fgBlob);
      var maskC = document.createElement('canvas');
      maskC.width = w; maskC.height = h;
      var mCtx = maskC.getContext('2d');
      mCtx.drawImage(fgBmp, 0, 0, w, h);
      fgBmp.close();
      var maskData = mCtx.getImageData(0, 0, w, h);
      maskC.width = 0;

      var alphaImg = new ImageData(w, h);
      var md = maskData.data, ad = alphaImg.data;
      for (var p = 0; p < md.length; p += 4) {
        ad[p] = md[p+3]; ad[p+1] = md[p+3]; ad[p+2] = md[p+3]; ad[p+3] = 255;
      }

      var blurFn = _stackBlurLib && (_stackBlurLib.default
        ? _stackBlurLib.default.imageDataRGBA : _stackBlurLib.imageDataRGBA);
      if (blurFn) {
        blurFn(alphaImg, 0, 0, w, h, 10);
        for (var dp = 0; dp < ad.length; dp += 4) {
          var v = ad[dp] * 4.0;
          ad[dp] = ad[dp+1] = ad[dp+2] = v > 255 ? 255 : v;
        }
        blurFn(alphaImg, 0, 0, w, h, 12);
      }

      var od = origData.data, bd = blurData.data;
      for (var p = 0; p < od.length; p += 4) {
        var tt = 1 - (ad[p] / 255);
        od[p]   = od[p]   + (bd[p]   - od[p])   * tt;
        od[p+1] = od[p+1] + (bd[p+1] - od[p+1]) * tt;
        od[p+2] = od[p+2] + (bd[p+2] - od[p+2]) * tt;
      }
      ctx.putImageData(origData, 0, 0);

      var resultBlob = await new Promise(function(r) {
        canvas.toBlob(r, 'image/jpeg', t.idx === 0 ? 0.80 : 0.75);
      });
      canvas.width = 0; blurC.width = 0;

      // 4) R2に上書き保存
      var upFd = new FormData();
      upFd.append('managedId', managedId);
      upFd.append('targetUrl', t.url);
      upFd.append('images', resultBlob, 'blurred.jpg');
      var upRes = await fetch(API_BASE + '/upload/update-image', {
        method: 'POST', headers: headers({}), body: upFd
      });
      var upData = await upRes.json();

      // 5) プレビュー更新
      if (upData.ok && upData.newUrl) {
        t.el.querySelector('img').src = API_BASE + upData.newUrl + '?t=' + Date.now();
        // チェックボックスのdata-urlも更新
        var cb = t.el.querySelector('.dl-img-check');
        if (cb) cb.dataset.url = upData.newUrl;
      }
    } catch(e) {
      console.error('Manage blur error:', e);
      showStatus('manageStatus', 'ぼかし失敗（' + (done+1) + '枚目）: ' + e.message, 'err');
    }

    var ov = t.el.querySelector('.blur-overlay');
    if (ov) ov.remove();
    done++;
    await new Promise(function(r) { setTimeout(r, 30); });
  }

  hideLoading();
  prog.textContent = aborted ? '中断' : done + '枚完了';
  btn.disabled = false;
  btn.textContent = '✨ 選択をぼかす';
  btn.onclick = function() { blurManageImages(managedId); };

  // 展開データ更新
  if (!aborted) {
    setTimeout(function() { doRefresh(); }, 500);
  }
}

// ─── 展開内: 選択画像削除 ───
function deleteManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }
  var allChecks = document.querySelectorAll('.dl-img-check');
  if (checks.length === allChecks.length) {
    // 全画像選択 → 全削除
    showConfirm(managedId + ' の画像を全て削除しますか？', function() {
      showLoading('削除中', managedId);
      fetch(API_BASE + '/upload/delete', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ managedId: managedId })
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        hideLoading();
        if (d.ok) {
          showStatus('manageStatus', d.deleted + '枚削除しました', 'ok');
          var el = document.getElementById('manageDetailInline'); if (el) el.remove();
          _manageExpandedMid = '';
          reloadList(function() { renderManageList(); });
        } else { showStatus('manageStatus', d.message || 'エラー', 'err'); }
      }).catch(function() { hideLoading(); showStatus('manageStatus', 'ネットワークエラー', 'err'); });
    });
  } else {
    // 一部選択 → URL直接指定で削除（インデックスずれ防止）
    var targetUrls = [];
    checks.forEach(function(c) { targetUrls.push(c.dataset.url); });
    showConfirm(targetUrls.length + '枚の画像を削除しますか？', function() {
      var total = targetUrls.length;
      var done = 0;
      showLoading('削除中', '0/' + total);
      function delNext() {
        if (done >= total) {
          hideLoading();
          showStatus('manageStatus', total + '枚削除しました', 'ok');
          var mid = managedId;
          _manageExpandedMid = '';
          reloadList(function() { renderManageList(); toggleManageExpand(mid); });
          return;
        }
        updateLoading('削除中', (done+1) + '/' + total);
        fetch(API_BASE + '/upload/delete-single', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ managedId: managedId, targetUrl: targetUrls[done] })
        }).then(function(r) { return r.json(); })
        .then(function() { done++; delNext(); })
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

  // 選択した各商品の保存ログを記録
  indices.forEach(function(idx) {
    var p = productListData[idx];
    if (p && p.managedId) recordSaveLog(p.managedId);
  });

  var btn = document.getElementById('dlTopBtn');
  btn.disabled = true;
  showLoading('トップ画像を準備中', '0/' + indices.length);

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
      updateLoading('トップ画像を準備中', done + '/' + indices.length);
    }).catch(function() { done++; });
  });

  Promise.all(promises).then(function() {
    hideLoading();
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

  // 選択した各商品の保存ログを記録
  mids.forEach(function(mid) { recordSaveLog(mid); });

  var btn = document.getElementById('dlAllBtn');
  btn.disabled = true;
  showLoading('全画像を準備中', '0/' + mids.length + ' 商品');

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
      updateLoading('全画像を準備中', productDone + '/' + mids.length + ' 商品');
      if (d.ok && d.urls) {
        for (var i = 0; i < d.urls.length; i++) {
          allItems.push({ mid: mid, url: API_BASE + d.urls[i], filename: mid + '_' + (i + 1) + '.jpg' });
        }
      }
    });
  });

  Promise.all(promises).then(function() {
    if (allItems.length === 0) {
      hideLoading();
      btn.disabled = false;
      showStatus('manageStatus', '画像が見つかりませんでした', 'err');
      return;
    }
    updateLoading('画像をダウンロード中', '0/' + allItems.length);
    var imgDone = 0;
    var fileEntries = [];
    var imgPromises = allItems.map(function(item) {
      return fetch(item.url).then(function(r) { return r.blob(); })
      .then(function(blob) {
        fileEntries.push({ file: new File([blob], item.filename, { type: 'image/jpeg' }), blob: blob, filename: item.filename });
        imgDone++;
        updateLoading('画像をダウンロード中', imgDone + '/' + allItems.length);
      }).catch(function() { imgDone++; });
    });

    return Promise.all(imgPromises).then(function() {
      hideLoading();
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
  showLoading('一括削除中', '0/' + mids.length);
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
      updateLoading('一括削除中', done + '/' + mids.length);
      if (done === mids.length) {
        hideLoading();
        showStatus('manageStatus', mids.length + '件（' + totalDeleted + '枚）削除しました', 'ok');
        var el = document.getElementById('manageDetailInline'); if (el) el.remove();
        _manageExpandedMid = '';
        reloadList(function() { renderManageList(); });
      }
    }).catch(function() {
      done++;
      if (done === mids.length) {
        hideLoading();
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
  // プレビューボタンがクリックされた場合は無視
  if (e && e.target.classList.contains('preview-btn')) return;
  var cb = wrap.querySelector('input[type=checkbox]');
  if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  wrap.style.opacity = cb && cb.checked ? '1' : '0.4';
}

var _previewBlurredSrc = '';
var _previewOrigSrc = '';
var _previewShowingOrig = false;

function openPreview(blurredSrc, origSrc) {
  var modal = document.getElementById('previewModal');
  var img = document.getElementById('previewImg');
  img.src = blurredSrc;
  _previewBlurredSrc = blurredSrc;
  _previewOrigSrc = origSrc || '';
  _previewShowingOrig = false;
  modal.style.display = 'flex';
  // ぼかし済み画像のみ比較バー表示
  document.getElementById('previewCompareBar').style.display = _previewOrigSrc ? 'flex' : 'none';
  updatePreviewBtns();
}

function showPreviewBlur() {
  _previewShowingOrig = false;
  document.getElementById('previewImg').src = _previewBlurredSrc;
  updatePreviewBtns();
}
function showPreviewOrig() {
  _previewShowingOrig = true;
  document.getElementById('previewImg').src = _previewOrigSrc;
  updatePreviewBtns();
}
function updatePreviewBtns() {
  var btnB = document.getElementById('previewBtnBlur');
  var btnO = document.getElementById('previewBtnOrig');
  if (!btnB || !btnO) return;
  btnB.style.background = _previewShowingOrig ? 'rgba(255,255,255,.3)' : '#fff';
  btnB.style.color = _previewShowingOrig ? '#fff' : '#1f2937';
  btnO.style.background = _previewShowingOrig ? '#fff' : 'rgba(255,255,255,.3)';
  btnO.style.color = _previewShowingOrig ? '#1f2937' : '#fff';
}

function closePreview() {
  document.getElementById('previewModal').style.display = 'none';
  document.getElementById('previewImg').src = '';
  _previewBlurredSrc = ''; _previewOrigSrc = '';
}

// ─── 使い方ガイド ───
function shareApp() {
  var url = location.origin + '/upload';
  var text = 'タスキ箱 — 商品画像のアップロード・管理ツール';
  if (navigator.share) {
    navigator.share({ title: 'タスキ箱', text: text, url: url }).catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      showStatus('manageStatus', 'URLをコピーしました', 'ok');
    });
  }
}

function showHelpGuide() {
  var pages = [
    { title: '画像アップロード', items: [
      '管理番号を入力して画像を選択',
      '全角→半角は自動変換されます',
      'TOPは高画質、2枚目以降は軽量に自動リサイズ',
      '同じ番号で既に画像があれば追加モードに切替',
    ]},
    { title: '商品管理', items: [
      '商品をタップして画像を確認・操作',
      'ドラッグ&ドロップで画像の並び替え',
      '保存DLで画像をダウンロード（保存回数を記録）',
      '画像検索でGoogle Lensから類似商品を検索',
    ]},
    { title: '便利機能', items: [
      '明るさ自動補正: プレビューで確認可能',
      '背景ぼかし: AIが被写体を自動認識して背景をぼかし',
      '一括操作: 全選択→一括DL/一括削除',
      '採寸情報未登録: 7日以上未登録は赤ラベル表示',
    ]},
  ];
  var _guidePage = 0;
  function renderGuide() {
    var p = pages[_guidePage];
    var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center" id="helpGuideOverlay">' +
      '<div style="background:#fff;border-radius:16px;padding:24px;max-width:380px;width:90%;position:relative">' +
      '<button onclick="document.getElementById(\\x27helpGuideOverlay\\x27).remove()" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:20px;color:#9ca3af;cursor:pointer;padding:4px">&times;</button>' +
      '<div style="font-weight:700;font-size:17px;margin-bottom:4px">' + p.title + '</div>' +
      '<div style="font-size:12px;color:#9ca3af;margin-bottom:16px">' + (_guidePage + 1) + ' / ' + pages.length + '</div>';
    for (var i = 0; i < p.items.length; i++) {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">' + (i + 1) + '</div>' +
        '<div style="font-size:13px;line-height:1.5">' + p.items[i] + '</div></div>';
    }
    html += '<div style="display:flex;gap:8px;margin-top:16px">';
    if (_guidePage > 0) html += '<button class="btn btn-secondary" style="flex:1;font-size:13px;padding:10px" onclick="event.preventDefault();window._guideNav(-1)">戻る</button>';
    if (_guidePage < pages.length - 1) html += '<button class="btn btn-primary" style="flex:1;font-size:13px;padding:10px" onclick="event.preventDefault();window._guideNav(1)">次へ</button>';
    else html += '<button class="btn btn-primary" style="flex:1;font-size:13px;padding:10px" onclick="document.getElementById(\\x27helpGuideOverlay\\x27).remove()">閉じる</button>';
    html += '</div></div></div>';
    var existing = document.getElementById('helpGuideOverlay');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
  }
  window._guideNav = function(dir) { _guidePage += dir; renderGuide(); };
  renderGuide();
}

function formatShortDate(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  var now = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  if (d.getFullYear() !== now.getFullYear()) {
    return String(d.getFullYear()).slice(-2) + '/' + mm + '/' + dd;
  }
  return mm + '/' + dd;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return mm + '/' + dd + ' ' + hh + ':' + mi;
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
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}</script>
</body>
</html>`;
}
