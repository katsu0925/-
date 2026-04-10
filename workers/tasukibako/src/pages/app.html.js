/**
 * タスキ箱 メインUI（自己完結型、セッション認証ベース）
 *
 * タブ: アップロード / 商品管理 / チーム / 設定
 * デタウリ固有要素は削除済み（撮影者モーダル、採寸バッジ、未同期リスト等）
 */
export function getAppPageHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#4F46E5">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="タスキ箱">
<title>タスキ箱</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--primary:#4F46E5;--primary-hover:#4338CA;--bg:#f5f5f5;--card:#fff;--text:#1f2937;--text-sub:#6b7280;--border:#d1d5db;--error:#dc2626;--success:#10b981;--info:#3b82f6}
body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif;background:var(--bg);color:var(--text);line-height:1.5;padding-bottom:calc(80px + env(safe-area-inset-bottom));opacity:0;animation:fadeInBody .4s ease forwards}
@keyframes fadeInBody{to{opacity:1}}
.container{max-width:600px;margin:0 auto;padding:16px}
/* ヘッダー */
.app-header{display:flex;align-items:center;justify-content:space-between;padding:12px 0}
.app-header h1{font-size:18px;display:flex;align-items:center;gap:8px}
.app-header .logo-sm{width:28px;height:28px;background:var(--primary);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold;transition:transform .3s ease;animation:logoPulse 2s ease-in-out infinite}
@keyframes logoPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.app-header .logo-sm:hover{animation:none;transform:rotate(8deg) scale(1.1)}
.team-name{font-size:13px;color:var(--text-sub);cursor:pointer}
/* カード */
.card{background:var(--card);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.initial-anim .card{animation:slideUp .35s ease both}
.initial-anim .card:nth-child(2){animation-delay:.05s}
.initial-anim .card:nth-child(3){animation-delay:.1s}
h2{font-size:16px;color:var(--text);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb}
/* フォーム */
.field{margin-bottom:12px}
.field label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px}
input[type=text],input[type=email],input[type=password],select{width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;-webkit-appearance:none;outline:none}
input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
input[type=file]{width:100%;padding:8px;border:1.5px dashed #ccc;border-radius:8px;font-size:14px;background:#fafafa}
/* ボタン */
.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s ease;position:relative;overflow:hidden;transform:scale(1)}
.btn:active:not(:disabled){transform:scale(.97)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--primary);color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.25)}
.btn-primary:hover:not(:disabled){background:var(--primary-hover);box-shadow:0 4px 12px rgba(79,70,229,.35);transform:translateY(-1px)}
.btn-danger{background:var(--error);color:#fff;box-shadow:0 2px 8px rgba(220,38,38,.2)}
.btn-secondary{background:#6b7280;color:#fff}
.btn-success{background:var(--success);color:#fff;box-shadow:0 2px 8px rgba(16,185,129,.2)}
/* ステータス */
.status{padding:10px;border-radius:8px;margin-top:8px;font-size:13px;display:none}
.status.show{display:block}
.status.ok{background:#d1fae5;color:#065f46}
.status.err{background:#fee2e2;color:#991b1b}
.status.info{background:#dbeafe;color:#1e40af}
/* プレビュー */
.preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin-top:8px}
.preview-item{position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;background:#f3f4f6;transition:transform .2s ease,box-shadow .2s ease}
.preview-item:hover{transform:scale(1.03);box-shadow:0 4px 12px rgba(0,0,0,.15)}
.preview-item img{width:100%;height:100%;object-fit:cover;transition:transform .3s ease}
.preview-item:hover img{transform:scale(1.05)}
.preview-item .badge{position:absolute;top:2px;left:2px;background:rgba(79,70,229,.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:4px}
.replace-btn,.preview-btn{position:absolute;bottom:2px;right:2px;background:rgba(255,255,255,.9);border-radius:4px;font-size:12px;padding:2px 4px;cursor:pointer}
.blur-btn{position:absolute;bottom:2px;left:2px;background:rgba(255,255,255,.92);border-radius:4px;font-size:10px;padding:2px 5px;cursor:pointer;color:#4F46E5;font-weight:600;border:none;line-height:1.3;z-index:3}
.blur-btn:hover{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.blur-btn.done{background:rgba(79,70,229,.85);color:#fff}
.blur-btn.processing{pointer-events:none;opacity:.7}
.blur-overlay{position:absolute;inset:0;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;z-index:2}
/* プログレスバー */
.progress-bar{width:100%;height:6px;background:#e5e7eb;border-radius:3px;margin-top:8px;overflow:hidden;display:none}
.progress-bar.show{display:block}
.progress-bar .fill{height:100%;background:linear-gradient(90deg,var(--primary),#818cf8);border-radius:3px;transition:width .3s ease;background-size:200% 100%;animation:shimmer 1.5s infinite linear}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
/* リスト */
.list-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6;transition:background .15s ease}
.list-item:hover{background:#f9fafb;border-radius:8px}
.list-item:last-child{border-bottom:none}
.list-thumb{width:48px;height:48px;border-radius:6px;object-fit:cover;background:#eee;flex-shrink:0}
.list-info{flex:1;min-width:0}
.list-id{font-weight:600;font-size:14px}
.list-count{font-size:12px;color:#888}
.list-meta{font-size:11px;color:#aaa}
.list-check{width:20px;height:20px;accent-color:var(--primary)}
/* タブ */
.tab-bar{display:flex;gap:4px;margin-bottom:12px;background:#f3f4f6;border-radius:10px;padding:4px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tab{flex:1;min-width:0;padding:8px 4px;text-align:center;font-size:13px;font-weight:600;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#666;white-space:nowrap;transition:all .2s ease}
.tab:active{transform:scale(.95)}
.tab.active{background:#fff;color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.1)}
.section{display:none}
.section.active{display:block}
/* 商品管理グリッド */
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px}
.img-check-wrap{position:relative}
.img-check-wrap input[type=checkbox]{position:absolute;top:4px;left:4px;z-index:2;width:18px;height:18px;accent-color:var(--primary)}
.img-check-wrap .badge{left:auto;right:2px}
@keyframes sectionIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
/* フッタ */
.sticky-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e7eb;padding:12px 16px calc(16px + env(safe-area-inset-bottom));z-index:50;display:none;transform:translateY(100%);transition:transform .25s ease}
.sticky-footer.show{display:block;transform:translateY(0);animation:slideFooterIn .3s ease}
@keyframes slideFooterIn{from{transform:translateY(100%)}to{transform:translateY(0)}}
.sticky-footer .footer-inner{max-width:600px;margin:0 auto;display:flex;gap:8px}
.sticky-footer .footer-inner .btn{flex:1;margin:0;padding:10px;font-size:14px}
/* 使用状況バー */
.usage-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin:4px 0}
.usage-bar .fill{height:100%;border-radius:4px;transition:width .6s cubic-bezier(.4,0,.2,1)}
.usage-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px}
/* セレクトオールロウ */
.select-all-row{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:#666}
.manage-sticky-header{position:sticky;top:0;z-index:20;background:#fff;padding:12px 16px 8px;border-radius:12px 12px 0 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.hidden{display:none}
/* メンバーリスト */
.member-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6}
.member-item:last-child{border-bottom:none}
.member-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--primary),#818cf8);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px;flex-shrink:0;box-shadow:0 2px 8px rgba(79,70,229,.3)}
.member-name{font-weight:600;font-size:14px}
.member-role{font-size:12px;color:var(--text-sub)}
/* 招待リンク */
.invite-box{display:flex;gap:8px;align-items:center}
.invite-box input{flex:1;font-size:14px}
.invite-box button{padding:10px 16px;white-space:nowrap}
/* モーダル */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;align-items:center;justify-content:center;padding:20px}
.modal-overlay.show{display:flex}
.modal{background:#fff;border-radius:12px;padding:24px;width:100%;max-width:400px}
/* 成功アニメーション */
@keyframes successPop{0%{transform:scale(0);opacity:0}50%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}
.upload-success{display:none;text-align:center;padding:24px;animation:successPop .4s cubic-bezier(.175,.885,.32,1.275)}
.upload-success.show{display:block}
.upload-success .check{width:56px;height:56px;background:var(--success);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:28px;margin-bottom:8px;box-shadow:0 4px 16px rgba(16,185,129,.3)}
/* 管理パネル */
.admin-panel{position:fixed;left:0;right:0;bottom:0;background:#1e1b4b;color:#fff;z-index:40;padding:8px 12px calc(8px + env(safe-area-inset-bottom));font-size:12px;display:none;animation:slideFooterIn .3s ease}
.admin-panel.show{display:block}
body.has-admin .sticky-footer{bottom:var(--admin-h,80px)}
body.has-admin{padding-bottom:calc(140px + env(safe-area-inset-bottom))}
.admin-panel .admin-status{margin-bottom:6px;color:#c7d2fe;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-panel .admin-row{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:4px}
.admin-panel .admin-label{font-size:10px;color:#a5b4fc;min-width:48px;flex-shrink:0}
.admin-btn{padding:4px 8px;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;color:#fff;transition:all .15s;opacity:.85}
.admin-btn:hover{opacity:1;transform:scale(1.05)}
.admin-btn.active{opacity:1;box-shadow:0 0 0 2px #fff}
/* ローディングスピナー */
.spinner{display:inline-block;width:20px;height:20px;border:2.5px solid rgba(79,70,229,.2);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite}
.hdr-icon{width:32px;height:32px;border:none;background:none;border-radius:8px;cursor:pointer;color:#6b7280;font-size:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}
.hdr-icon:active{background:#e5e7eb}
@keyframes spin{to{transform:rotate(360deg)}}
.page-loader{display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:12px;color:var(--text-sub);font-size:14px}
/* オンボーディング */
.ob-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;display:none;align-items:center;justify-content:center;padding:20px}
.ob-overlay.show{display:flex}
.ob-card{background:#fff;border-radius:16px;width:100%;max-width:420px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.ob-header{background:linear-gradient(135deg,var(--primary),#818cf8);padding:32px 24px 24px;text-align:center;color:#fff}
.ob-header .ob-logo{width:56px;height:56px;background:rgba(255,255,255,.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;margin-bottom:12px}
.ob-header h2{font-size:20px;font-weight:700;margin-bottom:4px}
.ob-header p{font-size:14px;opacity:.85}
.ob-body{padding:24px}
.ob-steps{display:flex;flex-direction:column;gap:16px;margin-bottom:24px}
.ob-step{display:flex;align-items:flex-start;gap:12px}
.ob-step-num{width:28px;height:28px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.ob-step-text{font-size:14px;line-height:1.5}
.ob-step-text strong{display:block;font-size:14px;margin-bottom:2px}
.ob-step-text span{color:var(--text-sub);font-size:13px}
.ob-dots{display:flex;justify-content:center;gap:6px;margin-bottom:20px}
.ob-dot{width:8px;height:8px;border-radius:50%;background:#d1d5db;transition:all .2s}
.ob-dot.active{background:var(--primary);width:20px;border-radius:4px}
.ob-footer{display:flex;gap:8px}
.ob-footer .btn{flex:1}
@media(max-width:480px){.img-grid{grid-template-columns:repeat(2,1fr)}.preview-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:481px) and (max-width:768px){.img-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:769px){.img-grid{grid-template-columns:repeat(4,1fr)}}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" defer></script>
</head>
<body>

<!-- ローディング -->
<div class="page-loader" id="pageLoader">
  <div class="spinner" style="width:32px;height:32px;border-width:3px"></div>
  <span>読み込み中...</span>
</div>

<div class="container" id="appContainer" style="display:none">
  <!-- ヘッダー -->
  <div class="app-header">
    <h1><span class="logo-sm">箱</span> タスキ箱</h1>
    <span class="team-name" id="headerTeamName" onclick="switchTab('team')">-</span>
  </div>

  <!-- タブバー -->
  <div class="tab-bar" style="align-items:center">
    <button class="tab active" data-tab="upload">アップロード</button>
    <button class="tab" data-tab="manage">商品管理</button>
    <button class="tab" data-tab="team">チーム</button>
    <button class="tab" data-tab="settings">設定</button>
    <div style="display:flex;gap:2px;align-items:center;flex-shrink:0">
      <button id="refreshBtn" class="hdr-icon" title="更新"><span id="refreshIcon" style="display:inline-block">&#x21bb;</span></button>
      <button id="shareBtn" onclick="shareApp()" class="hdr-icon" style="display:none" title="共有">&#x1f517;</button>
      <button id="helpBtn" onclick="showOnboarding(true)" class="hdr-icon" title="ヘルプ">?</button>
    </div>
  </div>

  <!-- セクション1: アップロード -->
  <div class="section active" id="sec-upload">
    <!-- チーム未作成ガード -->
    <div class="card" id="uploadNoTeam" style="display:none;text-align:center">
      <h2 style="border:none;color:var(--text-sub)">チームを作成してください</h2>
      <p style="font-size:14px;color:var(--text-sub);margin-bottom:16px">画像をアップロードするにはチームの作成が必要です。</p>
      <button class="btn btn-primary" onclick="switchTab('team')">チームを作成する</button>
    </div>
    <!-- 使用状況ミニバー -->
    <div id="usageMiniBar" class="card" style="display:none;padding:12px 16px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-sub);margin-bottom:4px">
        <span>商品 <strong id="miniProducts">0</strong>/<span id="miniProductsMax">200</span></span>
        <span>画像 <strong id="miniImages">0</strong>/<span id="miniImagesMax">2,000</span></span>
      </div>
      <div class="usage-bar" style="margin:0"><div class="fill" id="miniBar" style="width:0%;background:var(--primary)"></div></div>
      <div id="usageWarning" style="display:none;font-size:12px;color:var(--error);margin-top:6px"></div>
    </div>
    <div class="card" id="uploadForm">
      <h2>画像アップロード</h2>
      <div class="field">
        <label for="uploadManagedId">管理番号</label>
        <input type="text" id="uploadManagedId" placeholder="例: A001" autocomplete="off">
      </div>
      <div id="existingImages" class="hidden" style="margin-top:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px" id="existingCount"></div>
        <div class="preview-grid" id="existingGrid"></div>
      </div>
      <div class="field" style="margin-top:12px">
        <label for="uploadFiles">画像（最大10枚）</label>
        <input type="file" id="uploadFiles" multiple accept="image/*">
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
        <button id="blurSelectedBtn" style="padding:5px 12px;border:1.5px solid #4F46E5;background:#fff;color:#4F46E5;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">選択をぼかす</button>
        <button id="blurSelectAllBtn" style="padding:5px 8px;border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:11px;cursor:pointer">全選択</button>
        <button id="blurDeselectAllBtn" style="padding:5px 8px;border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:11px;cursor:pointer">全解除</button>
        <span id="blurProgress" style="font-size:12px;color:#6b7280"></span>
      </div>
      <div id="blurStatus" style="display:none;font-size:12px;color:#6b7280;margin-top:4px"></div>
      <div class="progress-bar" id="uploadProgress"><div class="fill" id="uploadProgressFill"></div></div>
      <div class="status" id="uploadStatus"></div>
      <div class="upload-success" id="uploadSuccess">
        <div class="check">&#x2713;</div>
        <div style="font-size:15px;font-weight:600">アップロード完了</div>
      </div>
    </div>
  </div>

  <!-- セクション2: 商品管理 -->
  <div class="section" id="sec-manage">
    <div class="manage-sticky-header">
      <div class="field" style="margin-bottom:6px">
        <input type="text" id="manageSearch" placeholder="管理番号で検索..." autocomplete="off">
      </div>
      <div id="filterBar" style="display:none;margin-bottom:6px;font-size:12px">
        <div style="display:flex;gap:4px;margin-bottom:4px">
          <select id="filterMember" onchange="renderManageList()" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"><option value="">メンバー: 全員</option></select>
          <select id="filterSave" onchange="renderManageList()" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"><option value="">保存: すべて</option><option value="unsaved">未保存</option><option value="saved">保存済み</option></select>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <label style="flex:1;position:relative"><span style="position:absolute;left:8px;top:5px;font-size:11px;color:#999;pointer-events:none" id="filterDateFromLabel">年/月/日</span><input type="date" id="filterDateFrom" onchange="renderManageList();this.previousElementSibling.style.display=this.value?'none':''" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"></label>
          <span style="font-size:11px;color:#999;flex-shrink:0">〜</span>
          <label style="flex:1;position:relative"><span style="position:absolute;left:8px;top:5px;font-size:11px;color:#999;pointer-events:none" id="filterDateToLabel">年/月/日</span><input type="date" id="filterDateTo" onchange="renderManageList();this.previousElementSibling.style.display=this.value?'none':''" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;height:28px"></label>
          <button id="filterClearBtn" onclick="clearFilters()" style="display:none;padding:4px 8px;border:none;border-radius:6px;font-size:11px;background:#ef4444;color:#fff;cursor:pointer;white-space:nowrap;flex-shrink:0">クリア</button>
        </div>
      </div>
      <div class="status" id="manageLoadStatus"></div>
      <div class="select-all-row hidden" id="selectAllRow">
        <input type="checkbox" id="selectAll" class="list-check">
        <span>すべて選択</span>
        <span style="margin-left:auto" id="selectedCount">0件選択</span>
      </div>
    </div>
    <div class="card" style="margin-top:0;border-top-left-radius:0;border-top-right-radius:0">
      <div id="manageList"></div>
      <div class="status" id="manageStatus"></div>
    </div>
  </div>

  <!-- セクション3: チーム -->
  <div class="section" id="sec-team">
    <!-- チーム未作成時 -->
    <div id="noTeam" class="card" style="text-align:center;display:none">
      <h2 style="border:none">チームを作成しましょう</h2>
      <p style="font-size:14px;color:var(--text-sub);margin-bottom:16px">チームを作成するとメンバーと画像を共有できます。</p>
      <div class="field">
        <input type="text" id="newTeamName" placeholder="チーム名">
      </div>
      <button class="btn btn-primary" id="createTeamBtn">チームを作成</button>
      <div style="margin-top:16px;font-size:14px;color:var(--text-sub)">
        <p>招待コードをお持ちの方:</p>
        <div class="field" style="margin-top:8px">
          <input type="text" id="joinInviteCode" placeholder="招待コード">
        </div>
        <button class="btn btn-secondary" id="joinTeamBtn">チームに参加</button>
      </div>
      <div class="status" id="teamCreateStatus"></div>
    </div>

    <!-- チームあり -->
    <div id="hasTeam" style="display:none">
      <!-- 使用状況 -->
      <div class="card">
        <h2>使用状況</h2>
        <div class="usage-row">
          <span>商品数</span>
          <span><strong id="statProducts">0</strong> / <span id="statProductsMax">200</span></span>
        </div>
        <div class="usage-bar"><div class="fill" id="barProducts" style="width:0%;background:var(--primary)"></div></div>
        <div class="usage-row">
          <span>画像数</span>
          <span><strong id="statImages">0</strong> / <span id="statImagesMax">2,000</span></span>
        </div>
        <div class="usage-bar"><div class="fill" id="barImages" style="width:0%;background:var(--info)"></div></div>
        <div class="usage-row">
          <span>メンバー</span>
          <span><strong id="statMembers">0</strong> / <span id="statMembersMax">3</span></span>
        </div>
        <div class="usage-bar"><div class="fill" id="barMembers" style="width:0%;background:var(--success)"></div></div>
      </div>

      <!-- プラン -->
      <div class="card" id="planCard">
        <h2>プラン</h2>
        <div id="currentPlanInfo" style="margin-bottom:16px">
          <div style="font-size:14px;color:var(--text-sub)">現在のプラン: <strong id="currentPlanName" style="color:var(--text-main)">フリー</strong></div>
          <button class="btn btn-secondary" id="openPortalBtn" style="display:none;margin-top:8px;font-size:13px;padding:8px">サブスク管理（プラン変更・解約）</button>
        </div>
        <div id="planToggle" style="display:flex;justify-content:center;margin-bottom:16px;gap:0">
          <button id="billingMonthly" class="btn btn-primary" style="border-radius:8px 0 0 8px;font-size:13px;padding:8px 16px" onclick="switchPlanBilling('monthly')">月額</button>
          <button id="billingYearly" class="btn btn-secondary" style="border-radius:0 8px 8px 0;font-size:13px;padding:8px 16px;border-left:0" onclick="switchPlanBilling('yearly')">年額（2ヶ月無料）</button>
        </div>
        <div id="planGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <div class="plan-col" data-plan="lite" style="border:2px solid #e5e7eb;border-radius:12px;padding:12px;text-align:center;cursor:pointer" onclick="subscribePlan('lite')">
            <div style="font-weight:700;font-size:15px;color:#3b82f6">ライト</div>
            <div class="plan-price" style="font-size:18px;font-weight:700;margin:8px 0">¥980<span style="font-size:12px;font-weight:400">/月</span></div>
            <div style="font-size:11px;color:var(--text-sub);line-height:1.5">商品 1,000<br>画像 10,000<br>メンバー 5人<br>一括保存</div>
          </div>
          <div class="plan-col" data-plan="standard" style="border:2px solid var(--primary);border-radius:12px;padding:12px;text-align:center;cursor:pointer;position:relative" onclick="subscribePlan('standard')">
            <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;font-size:10px;padding:2px 10px;border-radius:10px;white-space:nowrap">おすすめ</div>
            <div style="font-weight:700;font-size:15px;color:var(--primary)">スタンダード</div>
            <div class="plan-price" style="font-size:18px;font-weight:700;margin:8px 0">¥1,980<span style="font-size:12px;font-weight:400">/月</span></div>
            <div style="font-size:11px;color:var(--text-sub);line-height:1.5">商品 2,000<br>画像 20,000<br>メンバー 15人<br>ログ・権限</div>
          </div>
          <div class="plan-col" data-plan="pro" style="border:2px solid #e5e7eb;border-radius:12px;padding:12px;text-align:center;cursor:pointer" onclick="subscribePlan('pro')">
            <div style="font-weight:700;font-size:15px;color:#f59e0b">プロ</div>
            <div class="plan-price" style="font-size:18px;font-weight:700;margin:8px 0">¥3,980<span style="font-size:12px;font-weight:400">/月</span></div>
            <div style="font-size:11px;color:var(--text-sub);line-height:1.5">商品 10,000<br>画像 100,000<br>無制限<br>CSV/API</div>
          </div>
        </div>
        <div id="planStatus" class="status" style="margin-top:8px"></div>
      </div>

      <!-- 招待リンク -->
      <div class="card" id="inviteCard">
        <h2>メンバー招待</h2>
        <div class="invite-box">
          <input type="text" id="inviteUrl" readonly>
          <button class="btn btn-primary" style="width:auto" id="copyInviteBtn">コピー</button>
        </div>
        <div class="status" id="inviteStatus"></div>
        <div style="margin-top:12px">
          <button class="btn btn-secondary" style="font-size:13px;padding:8px" id="regenInviteBtn">招待コードを再生成</button>
        </div>
      </div>

      <!-- メンバー一覧 -->
      <div class="card">
        <h2>メンバー</h2>
        <div id="memberList"></div>
      </div>
    </div>
  </div>

  <!-- セクション4: 設定 -->
  <div class="section" id="sec-settings">
    <div class="card">
      <h2>プロフィール</h2>
      <div class="field">
        <label for="settingsDisplayName">表示名</label>
        <input type="text" id="settingsDisplayName">
      </div>
      <div class="field">
        <label for="settingsEmail">メールアドレス</label>
        <input type="email" id="settingsEmail" readonly style="background:#f3f4f6">
      </div>
      <div class="status" id="settingsStatus"></div>
    </div>
    <div class="card">
      <h2>ヘルプ</h2>
      <button class="btn btn-secondary" id="showGuideBtn" style="margin-bottom:8px">使い方ガイドを表示</button>
    </div>
    <div class="card">
      <h2>アカウント</h2>
      <button class="btn btn-danger" id="logoutBtn">ログアウト</button>
    </div>
  </div>
</div>

<!-- フッタ: アップロード -->
<div class="sticky-footer" id="footer-upload">
  <div class="footer-inner">
    <button class="btn btn-primary" id="uploadBtn" disabled>アップロード</button>
  </div>
</div>

<!-- フッタ: 商品管理 -->
<div class="sticky-footer" id="footer-manage">
  <div class="footer-inner" style="flex-wrap:wrap;gap:6px">
    <button class="btn btn-success" style="flex:1;min-width:45%;opacity:.5" id="dlTopBtn" disabled onclick="showUpgradeHint()">
      <span style="font-size:10px;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:3px;margin-right:4px">PRO</span>トップ画像保存
    </button>
    <button class="btn btn-primary" style="flex:1;min-width:45%;opacity:.5" id="dlAllBtn" disabled onclick="showUpgradeHint()">
      <span style="font-size:10px;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:3px;margin-right:4px">PRO</span>全画像保存
    </button>
    <button class="btn btn-danger" style="flex:1;min-width:100%" id="deleteSelectedBtn" disabled>選択した商品を削除</button>
  </div>
</div>

<!-- ローディングポップアップ -->
<div id="loadingPopup" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:400;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:12px;padding:20px 28px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.2);max-width:280px">
    <div class="spinner" style="width:28px;height:28px;border-width:3px;margin:0 auto 12px"></div>
    <div id="loadingText" style="font-size:14px;font-weight:600;color:#1f2937">処理中...</div>
    <div id="loadingSubText" style="font-size:12px;color:#6b7280;margin-top:4px"></div>
  </div>
</div>

<!-- 画像プレビューモーダル -->
<div id="previewModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:300;align-items:center;justify-content:center;cursor:pointer">
  <img id="previewImg" style="max-width:95%;max-height:90vh;object-fit:contain;border-radius:4px">
  <div id="previewCompareBar" style="display:none;position:absolute;top:calc(env(safe-area-inset-top,12px) + 8px);left:50%;transform:translateX(-50%);gap:8px">
    <button id="previewBtnBlur" style="padding:6px 16px;border:none;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#1f2937">ぼかし済</button>
    <button id="previewBtnOrig" style="padding:6px 16px;border:none;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;background:rgba(255,255,255,.3);color:#fff">元画像</button>
  </div>
  <div style="position:absolute;top:16px;right:16px;color:#fff;font-size:32px;cursor:pointer;padding:8px;line-height:1" id="closePreviewBtn">&times;</div>
</div>

<!-- アップグレードモーダル（ソフトペイウォール） -->
<div class="modal-overlay" id="upgradeModal">
  <div class="modal">
    <h2 style="text-align:center;border:none;font-size:18px;margin-bottom:12px">もっと便利に使いませんか？</h2>
    <div id="upgradeReason" style="text-align:center;font-size:14px;color:var(--text-sub);margin-bottom:20px"></div>
    <div style="background:#f0f9ff;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
      <div style="font-weight:600;margin-bottom:8px;color:var(--primary)">ライトプラン — 月額 ¥980</div>
      <div>商品 1,000 / 画像 10,000 / メンバー 5人</div>
      <div style="margin-top:4px">一括保存・トップ画像保存・通知が使える</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" style="flex:1" onclick="document.getElementById('upgradeModal').classList.remove('show')">あとで</button>
      <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('upgradeModal').classList.remove('show');switchTab('team')">プランを見る</button>
    </div>
  </div>
</div>

<!-- オンボーディング -->
<div class="ob-overlay" id="obOverlay">
  <div class="ob-card" style="position:relative">
    <button onclick="closeOnboarding()" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:20px;color:#9ca3af;cursor:pointer;z-index:1;padding:4px">&times;</button>
    <div class="ob-header">
      <div class="ob-logo">箱</div>
      <h2 id="obTitle">タスキ箱へようこそ</h2>
      <p id="obSubtitle">商品画像をチームで共有・管理</p>
    </div>
    <div class="ob-body">
      <div id="obContent"></div>
      <div class="ob-dots" id="obDots"></div>
      <div class="ob-footer">
        <button class="btn btn-secondary" id="obSkip">スキップ</button>
        <button class="btn btn-primary" id="obNext">次へ</button>
      </div>
    </div>
  </div>
</div>

<!-- 管理パネル -->
<div class="admin-panel" id="adminPanel">
  <div class="admin-status" id="adminStatus">管理者モード</div>
  <div class="admin-row">
    <span class="admin-label">プラン:</span>
    <button class="admin-btn" style="background:#64748b" onclick="adminSetPlan('free')">無料</button>
    <button class="admin-btn" style="background:#3b82f6" onclick="adminSetPlan('lite')">ライト</button>
    <button class="admin-btn" style="background:#e94560" onclick="adminSetPlan('standard')">スタンダード</button>
    <button class="admin-btn" style="background:#f59e0b" onclick="adminSetPlan('pro')">プロ</button>
  </div>
  <div class="admin-row">
    <span class="admin-label">使用量:</span>
    <button class="admin-btn" style="background:#475569" onclick="adminSetUsage(0,0)">0件</button>
    <button class="admin-btn" style="background:#475569" onclick="adminSetUsage('half','half')">半分</button>
    <button class="admin-btn" style="background:#475569" onclick="adminSetUsage('max','max')">上限</button>
    <button class="admin-btn" style="background:#dc2626" onclick="adminSetUsage('over','over')">超過</button>
  </div>
</div>

<!-- 確認モーダル -->
<div class="modal-overlay" id="confirmModal">
  <div class="modal" style="text-align:center">
    <p id="confirmMessage" style="font-size:14px;font-weight:600;margin-bottom:16px"></p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" style="flex:1" id="confirmCancel">キャンセル</button>
      <button class="btn btn-danger" style="flex:1" id="confirmOk">削除する</button>
    </div>
  </div>
</div>

<script>
// ════════════════════════════════════════
// グローバル状態
// ════════════════════════════════════════
var API = '';
var _sessionId = localStorage.getItem('sessionId');
var _user = null;
var _teams = [];
var _currentTeam = null;
var _productList = [];
var _listLoaded = false;
var _existingUrls = [];
var _uploadMode = 'new';
var _manageExpandedMid = '';
var _manageExpandedUrls = [];
var _busyOperation = false;
var _confirmResolve = null;
var _blurredImages = {};
var _bgRemovalLib = null;
var _bgModelReady = false;
var _blurBusy = false;
var _blurAbort = false;
var _blurBatchMode = false;
var _bgPreloadStarted = false;
var _stackBlurLib = null;
var _uploadFileOrder = [];
var _previewBlurredSrc = '';
var _previewOrigSrc = '';
var _previewShowingOrig = false;

// ════════════════════════════════════════
// 初期化
// ════════════════════════════════════════
(function init() {
  if (!_sessionId) { location.href = '/login'; return; }
  apiPost('/api/session/validate', {}).then(function(d) {
    if (!d.ok) { localStorage.removeItem('sessionId'); location.href = '/login'; return; }
    _user = d.user;
    _teams = d.teams || [];
    if (_teams.length > 0) {
      _currentTeam = _teams[0];
    }
    // ローディング→メイン切替（初回アニメーション付き）
    document.getElementById('pageLoader').style.display = 'none';
    var appEl = document.getElementById('appContainer');
    appEl.style.display = 'block';
    appEl.classList.add('initial-anim');
    setTimeout(function() { appEl.classList.remove('initial-anim'); }, 600);
    showApp();
    if (!_currentTeam) switchTab('team');
    // オンボーディング（初回のみ）
    showOnboarding();
    // 管理パネル初期化
    initAdminPanel();
  }).catch(function() {
    localStorage.removeItem('sessionId');
    location.href = '/login';
  });
})();

// ════════════════════════════════════════
// ローディングポップアップ
// ════════════════════════════════════════
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

// StackBlur ライブラリ（ページ読み込み時にロード）
(function() {
  import('https://esm.sh/stackblur-canvas@2').then(function(m) {
    _stackBlurLib = m;
    console.log('StackBlur ready');
  }).catch(function(e) { console.warn('StackBlur load failed:', e); });
})();

function showApp() {
  document.getElementById('headerTeamName').textContent = _currentTeam ? _currentTeam.name : 'チーム未設定';
  if (_user) {
    document.getElementById('settingsDisplayName').value = _user.displayName || '';
    document.getElementById('settingsEmail').value = _user.email || '';
  }
  // チーム有無でアップロードUIを切替
  if (_currentTeam) {
    document.getElementById('uploadForm').style.display = '';
    document.getElementById('uploadNoTeam').style.display = 'none';
    document.getElementById('footer-upload').classList.add('show');
    updateUsageMiniBar();
  } else {
    document.getElementById('uploadForm').style.display = 'none';
    document.getElementById('uploadNoTeam').style.display = 'block';
  }
  // オーナーのみシェアボタン表示
  document.getElementById('shareBtn').style.display = (_currentTeam && _currentTeam.role === 'owner') ? '' : 'none';
  // バックグラウンドで商品リストをプリロード
  if (_currentTeam && !_listLoaded) {
    refreshProductList();
  }
}

// ════════════════════════════════════════
// API通信
// ════════════════════════════════════════
function apiPost(path, body) {
  return fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _sessionId },
    body: JSON.stringify(body),
  }).then(function(r) { return r.json(); });
}

function imgUrl(url) {
  return url + '?token=' + _sessionId + '&t=' + Date.now();
}

function showStatus(id, msg, type) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status show ' + type;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function normId(raw) {
  return raw.replace(/[\\uff21-\\uff3a\\uff41-\\uff5a\\uff10-\\uff19]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/[\\u30fc]/g,'-').replace(/\\u3000/g,' ').toUpperCase().trim();
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

// ════════════════════════════════════════
// タブ切り替え
// ════════════════════════════════════════
var _tabNames = ['upload','manage','team','settings'];
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() { switchTab(this.dataset.tab); });
});

// 更新ボタン（アイコンだけ回転、ページは揺れない）
document.getElementById('refreshBtn').addEventListener('click', function() {
  var btn = this;
  var icon = document.getElementById('refreshIcon');
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  icon.style.animation = 'spin .6s linear infinite';
  btn.style.opacity = '0.5';
  _listLoaded = false;
  refreshProductList(function() {
    icon.style.animation = '';
    btn.style.opacity = '';
    btn.dataset.busy = '';
    if (document.getElementById('sec-manage').classList.contains('active')) renderManageList();
    if (document.getElementById('sec-team').classList.contains('active')) renderTeamSection();
  });
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === name); });
  _tabNames.forEach(function(t) {
    var sec = document.getElementById('sec-' + t);
    if (sec) sec.classList.toggle('active', t === name);
    var f = document.getElementById('footer-' + t);
    if (f) f.classList.toggle('show', t === name);
  });
  if (name === 'manage') ensureListLoaded(function() { renderManageList(); });
  if (name === 'team') renderTeamSection();
}


// ════════════════════════════════════════
// アップロード
// ════════════════════════════════════════
var _midTimer = null;
document.getElementById('uploadManagedId').addEventListener('input', function() {
  clearTimeout(_midTimer);
  var mid = normId(this.value);
  if (mid.length < 2) { hideExisting(); return; }
  _midTimer = setTimeout(function() { checkExisting(mid); }, 500);
});

document.getElementById('uploadFiles').addEventListener('change', showPreview);

function checkExisting(managedId) {
  if (!_currentTeam) return;
  apiPost('/api/manage/product-images', { teamId: _currentTeam.id, managedId: managedId })
  .then(function(d) {
    if (d.ok && d.urls && d.urls.length > 0) {
      _existingUrls = d.urls;
      _uploadMode = 'append';
      showExisting(d.urls, managedId);
    } else { _existingUrls = []; _uploadMode = 'new'; hideExisting(); }
  }).catch(function() { _existingUrls = []; _uploadMode = 'new'; hideExisting(); });
}

function showExisting(urls, managedId) {
  var c = document.getElementById('existingImages');
  c.classList.remove('hidden');
  var remain = 10 - urls.length;
  document.getElementById('existingCount').innerHTML = '<span style="color:var(--primary)">&#x1f4f7; ' + urls.length + '枚登録済み</span>' +
    (remain > 0 ? ' — 新しい画像は<strong>追加</strong>されます（あと' + remain + '枚）' : ' — 上限に達しています');
  var grid = document.getElementById('existingGrid');
  var html = '';
  for (var i = 0; i < urls.length; i++) {
    html += '<div class="preview-item" draggable="true" data-idx="' + i + '">' +
      '<img src="' + imgUrl(urls[i]) + '">' +
      '<span class="badge">' + (i === 0 ? 'TOP' : (i+1)) + '</span>' +
      '<span class="replace-btn" data-url="' + escapeHtml(urls[i]) + '">&#x1f504;</span>' +
      '</div>';
  }
  grid.innerHTML = html;
  initDragReorder(grid, managedId);
  // 差し替えイベント
  grid.querySelectorAll('.replace-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); startReplace(this.dataset.url); });
  });
}

function hideExisting() {
  _existingUrls = []; _uploadMode = 'new';
  document.getElementById('existingImages').classList.add('hidden');
  document.getElementById('existingGrid').innerHTML = '';
}

function showPreview() {
  startBgPreload();
  var input = document.getElementById('uploadFiles');
  var grid = document.getElementById('uploadPreview');
  var btn = document.getElementById('uploadBtn');
  grid.innerHTML = '';
  var files = input.files;
  if (!files || files.length === 0) { btn.disabled = true; document.getElementById('blurBar').style.display = 'none'; return; }
  var maxNew = 10 - _existingUrls.length;
  if (files.length > maxNew) {
    showStatus('uploadStatus', '画像は最大10枚までです（既存' + _existingUrls.length + '枚+新規は' + maxNew + '枚まで）', 'err');
    input.value = ''; btn.disabled = true; return;
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
    var labelIdx = _existingUrls.length + i;
    div.innerHTML =
      '<input type="checkbox" class="upload-check" data-idx="' + i + '" style="position:absolute;top:4px;left:4px;z-index:2;width:18px;height:18px;accent-color:#4F46E5">' +
      '<img src="' + origUrl + '" loading="lazy">' +
      (labelIdx === 0 ? '<span class="badge" style="left:auto;right:2px">TOP</span>' : '<span class="badge" style="left:auto;right:2px">' + (labelIdx+1) + '</span>') +
      '<span class="preview-btn" style="cursor:pointer">&#x1f50d;</span>';
    grid.appendChild(div);
    generateLevelsPreview(files[i], i, grid);
  }
  initUploadDragReorder(grid);
  // プレビュークリック
  grid.querySelectorAll('.preview-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); previewUploadImg(this.parentNode); });
  });
  // チェックボックストグル
  grid.querySelectorAll('.preview-item').forEach(function(item) {
    item.addEventListener('click', function(e) { toggleUploadCheck(this, e); });
  });
  // ぼかしバー表示
  var bar = document.getElementById('blurBar');
  bar.style.display = 'flex';
  document.getElementById('blurProgress').textContent = '';
}

// 明るさ補正プレビュー生成（プレビューサムネ用、300px）
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

document.getElementById('uploadBtn').addEventListener('click', doUpload);

function doUpload() {
  if (!_currentTeam) { showStatus('uploadStatus', 'チームを先に作成してください', 'err'); return; }
  var managedId = normId(document.getElementById('uploadManagedId').value);
  if (!managedId) { showStatus('uploadStatus', '管理番号を入力してください', 'err'); return; }
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
    showStatus('uploadStatus', 'アップロード中...', 'info');
    var fd = new FormData();
    fd.append('teamId', _currentTeam.id);
    fd.append('managedId', managedId);
    fd.append('action', _uploadMode);
    for (var i = 0; i < blobs.length; i++) {
      fd.append('images', blobs[i], (i + 1) + '.jpg');
    }
    fetch(API + '/api/upload/images', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _sessionId },
      body: fd
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      hideLoading();
      btn.disabled = false;
      _busyOperation = false;
      bar.classList.remove('show');
      if (d.ok) {
        fill.style.width = '100%';
        var suc = document.getElementById('uploadSuccess');
        suc.classList.add('show');
        suc.querySelector('.check').textContent = blobs.length;
        suc.querySelector('div:last-child').textContent = blobs.length + '枚アップロード完了';
        setTimeout(function() { suc.classList.remove('show'); }, 2500);
        showStatus('uploadStatus', blobs.length + '枚アップロード完了', 'ok');
        input.value = '';
        document.getElementById('uploadPreview').innerHTML = '';
        _blurredImages = {};
        _uploadFileOrder = [];
        document.getElementById('blurBar').style.display = 'none';
        checkExisting(managedId);
        _listLoaded = false;
        updateUsageMiniBar();
      } else {
        showStatus('uploadStatus', d.message || 'アップロード失敗', 'err');
        if (d.message && d.message.indexOf('上限') >= 0) {
          showSoftPaywall(d.message);
        }
      }
    }).catch(function(e) {
      hideLoading();
      btn.disabled = false; _busyOperation = false; bar.classList.remove('show');
      showStatus('uploadStatus', '通信エラー: ' + e.message, 'err');
    });
  });
}

// ════════════════════════════════════════
// 画像リサイズ
// ════════════════════════════════════════
function resizeAllImages(files, cb) {
  var order = _uploadFileOrder.length > 0 ? _uploadFileOrder : [];
  if (order.length === 0) { for (var oi = 0; oi < files.length; oi++) order.push(oi); }
  var total = order.length;
  var results = []; var idx = 0; var done = 0;
  function next() {
    while (idx < total && (idx - done) < 2) {
      (function(pos) {
        idx++;
        var fileIdx = order[pos];
        if (_blurredImages[fileIdx]) {
          results[pos] = _blurredImages[fileIdx];
          done++;
          if (done === total) { cb(results); return; }
          next(); return;
        }
        var isTop = (_existingUrls.length === 0 && pos === 0);
        resizeImage(files[fileIdx], isTop ? 1200 : 800, isTop ? 0.80 : 0.75, function(blob) {
          results[pos] = blob; done++;
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
  var sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
  var rHist = new Uint32Array(256), gHist = new Uint32Array(256), bHist = new Uint32Array(256);
  for (var i = 0; i < d.length; i += 4) {
    sumR += d[i]; sumG += d[i+1]; sumB += d[i+2];
    sumLum += d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    rHist[d[i]]++; gHist[d[i+1]]++; bHist[d[i+2]]++;
  }
  var avgLum = sumLum / totalPixels;
  if (avgLum > 200) return;
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
  var rScale = 248 / Math.max(rW, 1);
  var gScale = 248 / Math.max(gW, 1);
  var bScale = 248 / Math.max(bW, 1);
  rScale = Math.min(1.5, Math.max(1.0, rScale));
  gScale = Math.min(1.5, Math.max(1.0, gScale));
  bScale = Math.min(1.5, Math.max(1.0, bScale));
  var target = 155;
  var gamma;
  if (avgLum < 30) { gamma = 1.8; }
  else if (avgLum >= target - 10) { gamma = 1.0; }
  else {
    gamma = Math.log(target / 255) / Math.log(avgLum / 255);
    gamma = Math.min(1.8, Math.max(1.0, gamma));
  }
  var maxScale = Math.max(rScale, gScale, bScale);
  if (Math.abs(gamma - 1) < 0.03 && maxScale < 1.02) return;
  var rLut = new Uint8Array(256), gLut = new Uint8Array(256), bLut = new Uint8Array(256);
  for (var v = 0; v < 256; v++) {
    rLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * rScale / 255), 1 / gamma)));
    gLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * gScale / 255), 1 / gamma)));
    bLut[v] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v * bScale / 255), 1 / gamma)));
  }
  for (var i = 0; i < d.length; i += 4) {
    d[i] = rLut[d[i]]; d[i+1] = gLut[d[i+1]]; d[i+2] = bLut[d[i+2]];
  }
  var shadowLut = new Float32Array(256);
  for (var v = 0; v < 256; v++) {
    if (v < 120) {
      var t = (120 - v) / 120;
      shadowLut[v] = 1 + Math.pow(t, 0.7) * 1.0;
    } else { shadowLut[v] = 1.0; }
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
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
      if (document.getElementById('autoLevelsCheck') && document.getElementById('autoLevelsCheck').checked) autoLevels(ctx, w, h);
      c.toBlob(function(blob) { c.width = 0; c.height = 0; cb(blob); }, 'image/jpeg', quality);
    }).catch(function() { cb(file); });
  } else { cb(file); }
}


// ════════════════════════════════════════
// AI背景ぼかし
// ════════════════════════════════════════
function startBgPreload() {
  if (_bgPreloadStarted) return;
  _bgPreloadStarted = true;
  import('https://esm.sh/@imgly/background-removal@1').then(function(lib) {
    _bgRemovalLib = lib;
    _bgModelReady = true;
    console.log('BG removal model ready');
  }).catch(function(e) { console.warn('BG model preload failed:', e); });
}


function canvasBlur(srcCanvas, blurPx) {
  var w = srcCanvas.width, h = srcCanvas.height;
  var out = document.createElement('canvas');
  out.width = w; out.height = h;
  var ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  if (_stackBlurLib) {
    var imgData = ctx.getImageData(0, 0, w, h);
    _stackBlurLib.default
      ? _stackBlurLib.default.imageDataRGBA(imgData, 0, 0, w, h, Math.round(blurPx))
      : _stackBlurLib.imageDataRGBA(imgData, 0, 0, w, h, Math.round(blurPx));
    ctx.putImageData(imgData, 0, 0);
    return out;
  }
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
  var indices = [];
  checks.forEach(function(cb) { indices.push(parseInt(cb.dataset.idx)); });
  var items = document.getElementById('uploadPreview').children;
  for (var k = 0; k < indices.length; k++) {
    var item = items[indices[k]];
    if (!item || _blurredImages[indices[k]]) continue;
    if (!item.querySelector('.blur-overlay')) {
      var ov = document.createElement('div');
      ov.className = 'blur-overlay';
      ov.innerHTML = '<div class="spinner"></div>';
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
  for (var k = 0; k < indices.length; k++) {
    applyBlurUI(indices[k]);
  }
  document.getElementById('blurProgress').textContent = _blurAbort ? '中断' : done + '枚完了';
  actionBtn.textContent = '選択をぼかす';
  actionBtn.onclick = function() { blurSelected(); };
  _blurBusy = false;
  _blurAbort = false;
  checks.forEach(function(cb) { cb.checked = false; });
}

async function processBlur(fileIndex) {
  var files = document.getElementById('uploadFiles').files;
  var file = files[fileIndex];
  if (!file) return;
  var item = document.getElementById('uploadPreview').children[fileIndex];
  if (!item) return;
  if (!item.querySelector('.blur-overlay')) {
    var ov = document.createElement('div');
    ov.className = 'blur-overlay';
    ov.innerHTML = '<div class="spinner"></div>';
    item.appendChild(ov);
  }
  try {
    var fgBlob;
    try {
      var fd = new FormData();
      fd.append('image', file);
      var segRes = await fetch(API + '/api/upload/blur', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _sessionId },
        body: fd
      });
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
      blurFn(alphaImg, 0, 0, w, h, 10);
      for (var dp = 0, dlen = ad.length; dp < dlen; dp += 4) {
        var v = ad[dp] * 4.0;
        ad[dp] = ad[dp+1] = ad[dp+2] = v > 255 ? 255 : v;
      }
      blurFn(alphaImg, 0, 0, w, h, 12);
    } else {
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

function toggleUploadCheck(wrap, e) {
  if (e && e.target.tagName === 'INPUT') return;
  if (e && e.target.classList.contains('preview-btn')) return;
  if (e && e.target.classList.contains('blur-done-badge')) return;
  var cb = wrap.querySelector('input[type=checkbox]');
  if (cb) cb.checked = !cb.checked;
}

function selectAllUpload(checked) {
  document.querySelectorAll('.upload-check').forEach(function(cb) { cb.checked = checked; });
}

function previewUploadImg(wrap) {
  var imgSrc = wrap.querySelector('img').src;
  var origSrc = wrap.getAttribute('data-orig') || '';
  var isBlurred = !!wrap.querySelector('.blur-done-badge');
  openPreview(imgSrc, isBlurred ? origSrc : '');
}

function initUploadDragReorder(grid) {
  var dragItem = null;
  var items = grid.querySelectorAll('.preview-item');
  items.forEach(function(item) {
    item.addEventListener('dragstart', function(e) {
      dragItem = this; this.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', function() { this.style.opacity = '1'; dragItem = null; });
    item.addEventListener('dragover', function(e) { e.preventDefault(); });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!dragItem || dragItem === this) return;
      var all = Array.from(grid.querySelectorAll('.preview-item'));
      var from = all.indexOf(dragItem), to = all.indexOf(this);
      if (from < to) grid.insertBefore(dragItem, this.nextSibling);
      else grid.insertBefore(dragItem, this);
      updateUploadBadges(grid);
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
    if (badge) badge.textContent = labelIdx === 0 ? 'TOP' : (labelIdx + 1);
  });
}

// ════════════════════════════════════════
// 商品管理画像ぼかし
// ════════════════════════════════════════
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
  targets.forEach(function(t) {
    if (!t.el.querySelector('.blur-overlay')) {
      var ov = document.createElement('div');
      ov.className = 'blur-overlay';
      ov.innerHTML = '<div class="spinner"></div>';
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
      var imgSrcUrl = imgUrl(t.url);
      var imgRes = await fetch(imgSrcUrl);
      if (!imgRes.ok) throw new Error('画像取得失敗');
      var imgBlob = await imgRes.blob();
      var fd = new FormData();
      fd.append('image', imgBlob);
      var segRes = await fetch(API + '/api/upload/blur', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _sessionId },
        body: fd
      });
      var fgBlob;
      if (segRes.ok) {
        fgBlob = await segRes.blob();
      } else {
        var lib = await loadBgRemoval();
        fgBlob = await lib.removeBackground(imgBlob, { model: 'medium', output: { format: 'image/png' } });
      }
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
      // R2に上書き: delete-single + upload
      var upFd = new FormData();
      upFd.append('teamId', _currentTeam.id);
      upFd.append('managedId', managedId);
      upFd.append('action', 'replace-single');
      upFd.append('targetUrl', t.url);
      upFd.append('images', resultBlob, 'blurred.jpg');
      var upRes = await fetch(API + '/api/upload/images', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _sessionId },
        body: upFd
      });
      var upData = await upRes.json();
      if (upData.ok) {
        t.el.querySelector('img').src = imgUrl(t.url);
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
  btn.textContent = '選択をぼかす';
  btn.onclick = function() { blurManageImages(managedId); };
  if (!aborted) {
    setTimeout(function() {
      _listLoaded = false;
      refreshProductList(function() {
        if (document.getElementById('sec-manage').classList.contains('active')) renderManageList();
      });
    }, 500);
  }
}

// ════════════════════════════════════════
// 画像差し替え
// ════════════════════════════════════════
function startReplace(targetUrl) {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = function() {
    if (!input.files || !input.files[0]) return;
    var mid = normId(document.getElementById('uploadManagedId').value);
    var isTop = _existingUrls.indexOf(targetUrl) === 0;
    showLoading('画像を差し替え中');
    showStatus('uploadStatus', '上書き中...', 'info');
    resizeImage(input.files[0], isTop ? 1200 : 800, isTop ? 0.80 : 0.75, function(blob) {
      var fd = new FormData();
      fd.append('teamId', _currentTeam.id);
      fd.append('managedId', mid);
      fd.append('targetUrl', targetUrl);
      fd.append('images', blob, 'replace.jpg');
      fd.append('action', 'replace-single');
      fetch(API + '/api/upload/images', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _sessionId },
        body: fd
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        hideLoading();
        if (d.ok) {
          showStatus('uploadStatus', '画像を上書きしました', 'ok');
          checkExisting(mid);
        } else {
          showStatus('uploadStatus', d.message || '上書きエラー', 'err');
        }
      }).catch(function() { hideLoading(); showStatus('uploadStatus', '上書きエラー', 'err'); });
    });
  };
  input.click();
}

// ════════════════════════════════════════
// ドラッグ並び替え
// ════════════════════════════════════════
function initDragReorder(grid, managedId) {
  var items = grid.querySelectorAll('.preview-item');
  var dragItem = null;
  items.forEach(function(item) {
    item.addEventListener('dragstart', function(e) { dragItem = this; this.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend', function() { this.style.opacity = '1'; dragItem = null; });
    item.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!dragItem || dragItem === this) return;
      var all = Array.from(grid.querySelectorAll('.preview-item'));
      var from = all.indexOf(dragItem), to = all.indexOf(this);
      if (from < to) grid.insertBefore(dragItem, this.nextSibling);
      else grid.insertBefore(dragItem, this);
      saveReorder(grid, managedId);
    });
  });
}

function saveReorder(grid, managedId) {
  var items = grid.querySelectorAll('.preview-item');
  var newOrder = [];
  items.forEach(function(item, i) {
    var img = item.querySelector('img');
    var url = img.src.replace(location.origin, '').replace(/\\?token=[^&]+(&|$)/, '').replace(/\\?t=\\d+$/, '').replace(/&t=\\d+$/, '');
    newOrder.push(url);
    var badge = item.querySelector('.badge');
    badge.textContent = i === 0 ? 'TOP' : (i + 1);
  });
  apiPost('/api/upload/reorder', { teamId: _currentTeam.id, managedId: managedId, newOrder: newOrder })
  .then(function(d) {
    if (d.ok) { _existingUrls = d.urls || newOrder; showStatus('uploadStatus', '並び替えを保存しました', 'ok'); }
    else { showStatus('uploadStatus', d.message || '並び替えエラー', 'err'); }
  }).catch(function() { showStatus('uploadStatus', '並び替えエラー', 'err'); });
}

// ════════════════════════════════════════
// 商品管理
// ════════════════════════════════════════
function ensureListLoaded(cb) {
  if (_listLoaded) { cb(); return; }
  refreshProductList(cb);
}

function refreshProductList(cb) {
  if (!_currentTeam) { if (cb) cb(); return; }
  showStatus('manageLoadStatus', '読み込み中...', 'info');
  apiPost('/api/manage/list', { teamId: _currentTeam.id })
  .then(function(d) {
    if (!d.ok) { showStatus('manageLoadStatus', d.message || 'エラー', 'err'); if (cb) cb(); return; }
    _productList = d.items || [];
    _listLoaded = true;
    populateFilterMember();
    showStatus('manageLoadStatus', _productList.length + '件の商品', 'ok');
    if (cb) cb();
  }).catch(function() { showStatus('manageLoadStatus', 'ネットワークエラー', 'err'); if (cb) cb(); });
}

function clearFilters() {
  document.getElementById('manageSearch').value = '';
  document.getElementById('filterMember').value = '';
  document.getElementById('filterSave').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('filterDateFromLabel').style.display = '';
  document.getElementById('filterDateToLabel').style.display = '';
  renderManageList();
}

function updateFilterClearBtn() {
  var active = document.getElementById('manageSearch').value ||
    document.getElementById('filterMember').value ||
    document.getElementById('filterSave').value ||
    document.getElementById('filterDateFrom').value ||
    document.getElementById('filterDateTo').value;
  document.getElementById('filterClearBtn').style.display = active ? '' : 'none';
}

function populateFilterMember() {
  var sel = document.getElementById('filterMember');
  var names = {};
  for (var i = 0; i < _productList.length; i++) {
    var n = _productList[i].uploadedByName;
    if (n) names[n] = true;
  }
  var prev = sel.value;
  sel.innerHTML = '<option value="">メンバー: 全員</option>';
  Object.keys(names).sort().forEach(function(n) {
    var o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = prev;
  document.getElementById('filterBar').style.display = _productList.length > 0 ? 'block' : 'none';
}

document.getElementById('manageSearch').addEventListener('input', function() {
  ensureListLoaded(function() { renderManageList(); });
});

document.getElementById('selectAll').addEventListener('change', function() {
  var checked = this.checked;
  document.querySelectorAll('.dl-check').forEach(function(c) { c.checked = checked; });
  updateSelectedCount();
});

function renderManageList() {
  var q = normId(document.getElementById('manageSearch').value);
  var rawQ = document.getElementById('manageSearch').value.trim();
  var fMember = document.getElementById('filterMember').value;
  var fDateFrom = document.getElementById('filterDateFrom').value;
  var fDateTo = document.getElementById('filterDateTo').value;
  var fSave = document.getElementById('filterSave').value;
  var el = document.getElementById('manageList');
  var html = '';
  var count = 0;
  for (var i = 0; i < _productList.length; i++) {
    var p = _productList[i];
    // テキスト検索
    if (q && p.managedId.toUpperCase().indexOf(q) === -1 && (!p.uploadedByName || p.uploadedByName.indexOf(rawQ) === -1)) continue;
    // メンバーフィルタ
    if (fMember && (p.uploadedByName || '') !== fMember) continue;
    // 登録日フィルタ（期間指定）
    if ((fDateFrom || fDateTo) && p.uploadedAt) {
      var ud = p.uploadedAt.slice(0, 10);
      if (fDateFrom && ud < fDateFrom) continue;
      if (fDateTo && ud > fDateTo) continue;
    } else if ((fDateFrom || fDateTo) && !p.uploadedAt) continue;
    // 保存フィルタ
    if (fSave === 'unsaved' && (p.saveCount || 0) > 0) continue;
    if (fSave === 'saved' && (p.saveCount || 0) === 0) continue;
    count++;
    var thumbSrc = p.thumbnail ? imgUrl(p.thumbnail) : '';
    html += '<div id="manage-row-' + escapeHtml(p.managedId) + '">' +
      '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-mid="' + escapeHtml(p.managedId) + '">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">' : '<div class="list-thumb" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')"></div>') +
      '<div class="list-info" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')" style="cursor:pointer">' +
      '<div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚' +
        (p.uploadedAt ? ' | ' + formatShortDate(p.uploadedAt) : '') +
        (p.saveCount > 0 ? ' | 保存' + p.saveCount + '回' : '') +
      '</div>' +
      (p.uploadedByName ? '<div class="list-meta">' + escapeHtml(p.uploadedByName) + '</div>' : '') +
      '</div>' +
      '<span style="color:var(--primary);font-size:20px;padding:0 8px;cursor:pointer" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">&#x203a;</span>' +
      '</div></div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('selectAllRow').classList.remove('hidden');
  _manageExpandedMid = '';
  updateSelectedCount();
  // フィルタ結果の件数表示
  var total = _productList.length;
  showStatus('manageLoadStatus', count === total ? total + '件の商品' : count + '/' + total + '件表示', 'ok');
  updateFilterClearBtn();
}

function updateSelectedCount() {
  var checks = document.querySelectorAll('.dl-check:checked');
  document.getElementById('selectedCount').textContent = checks.length + '件選択';
  document.getElementById('deleteSelectedBtn').disabled = checks.length === 0;
}

// チェックボックス変更時
document.getElementById('manageList').addEventListener('change', function(e) {
  if (e.target.classList.contains('dl-check')) updateSelectedCount();
});

function toggleManageExpand(managedId) {
  if (_manageExpandedMid === managedId) {
    var ex = document.getElementById('manageDetailInline');
    if (ex) { ex.remove(); _manageExpandedMid = ''; return; }
  }
  _manageExpandedMid = managedId;
  var old = document.getElementById('manageDetailInline');
  if (old) old.remove();
  var row = document.getElementById('manage-row-' + managedId);
  if (!row) return;
  var detail = document.createElement('div');
  detail.id = 'manageDetailInline';
  detail.style.cssText = 'background:#eff6ff;border-radius:8px;padding:12px;margin:4px 0 8px';
  detail.innerHTML = '<div style="text-align:center;color:#666;font-size:13px">読み込み中...</div>';
  row.after(detail);

  apiPost('/api/manage/product-images', { teamId: _currentTeam.id, managedId: managedId })
  .then(function(d) {
    var el = document.getElementById('manageDetailInline');
    if (!el) return;
    if (!d.ok) { el.innerHTML = '<div style="text-align:center;color:var(--error);font-size:13px;padding:8px">読み込みに失敗しました</div>'; return; }
    var urls = d.urls || [];
    _manageExpandedUrls = urls;
    var meta = d.meta || {};
    var sl = d.saveLog || { count: 0, users: [] };
    _currentSaveLog = sl;
    var html = '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + escapeHtml(managedId) + ' (' + urls.length + '枚)</div>';
    // メタ情報行
    var metaLine = '';
    if (meta.uploadedAt) metaLine += '登録: ' + formatDateTime(meta.uploadedAt) + (meta.uploadedByName ? '(' + escapeHtml(meta.uploadedByName) + ')' : '');
    if (sl.count > 0) metaLine += (metaLine ? ' | ' : '') + '保存: ' + sl.count + '回';
    if (metaLine) {
      html += '<div style="font-size:12px;color:#6b7280;margin-bottom:8px">' + metaLine;
      if (sl.count > 0) html += ' <span style="cursor:pointer;text-decoration:underline;color:var(--primary)" onclick="showSaveLog()" id="saveLogLink">詳細</span>';
      html += '</div>';
    }
    html += '<div class="img-grid" id="manageImageGrid">';
    for (var j = 0; j < urls.length; j++) {
      html += '<div class="img-check-wrap preview-item" draggable="true" data-idx="' + j + '" style="cursor:pointer">' +
        '<input type="checkbox" class="dl-img-check" data-url="' + escapeHtml(urls[j]) + '" data-imgidx="' + j + '" checked>' +
        '<img src="' + imgUrl(urls[j]) + '" loading="lazy">' +
        '<span class="badge">' + (j === 0 ? 'TOP' : (j+1)) + '</span>' +
        '<span class="preview-btn" data-src="' + imgUrl(urls[j]) + '">&#x1f50d;</span>' +
        '</div>';
    }
    html += '</div>';
    html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" style="flex:1;font-size:12px;padding:8px" onclick="searchImage(\\'' + escapeHtml(managedId) + '\\')">&#x1f50d; 画像検索</button>' +
      '<button class="btn btn-danger" style="flex:1;font-size:12px;padding:8px" onclick="deleteManageImages(\\'' + escapeHtml(managedId) + '\\')">&#x1f5d1; 選択削除</button>' +
      '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px">' +
      '<button class="btn" id="manageBlurBtn" style="flex:1;font-size:12px;padding:8px;background:#4F46E5;color:#fff" onclick="blurManageImages(\\'' + escapeHtml(managedId) + '\\')">選択をぼかす</button>' +
      '<button class="btn" style="flex:1;font-size:12px;padding:8px;background:#059669;color:#fff" onclick="saveAndDownload(\\'' + escapeHtml(managedId) + '\\')">&#x1f4be; 保存</button>' +
      '</div>' +
      '<div id="manageBlurProgress" style="font-size:12px;color:#6b7280;margin-top:4px"></div>';
    el.innerHTML = html;
    initDragReorder(document.getElementById('manageImageGrid'), managedId);
    // プレビュー
    el.querySelectorAll('.preview-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openPreview(this.dataset.src, ''); });
    });
    // チェックボックストグル
    el.querySelectorAll('.img-check-wrap').forEach(function(wrap) {
      wrap.addEventListener('click', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.classList.contains('preview-btn')) return;
        var cb = this.querySelector('input[type=checkbox]');
        if (cb) { cb.checked = !cb.checked; }
        this.style.opacity = cb && cb.checked ? '1' : '0.4';
      });
    });
  });
}

function searchImage(managedId) {
  if (!_currentTeam) return;
  var checks = document.querySelectorAll('.dl-img-check:checked');
  var imgPath = '';
  if (checks.length > 0) imgPath = checks[0].dataset.url;
  else if (_manageExpandedUrls.length > 0) imgPath = _manageExpandedUrls[0];
  if (!imgPath) return;
  // ワンタイムトークンを取得してからGoogle Lensに送出（セッションIDは送らない）
  apiPost('/api/manage/temp-token', { teamId: _currentTeam.id, imageUrl: location.origin + imgPath })
  .then(function(d) {
    if (d.ok) {
      window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(d.publicUrl));
    }
  });
}

// ────── 選択削除 ──────
document.getElementById('deleteSelectedBtn').addEventListener('click', doDeleteSelected);

function doDeleteSelected() {
  var checks = document.querySelectorAll('.dl-check:checked');
  if (checks.length === 0) return;
  var mids = [];
  checks.forEach(function(c) { mids.push(c.dataset.mid); });
  showConfirm(mids.length + '件の商品を削除しますか？この操作は取り消せません。').then(function(ok) {
    if (!ok) return;
    showLoading('一括削除中', '0/' + mids.length);
    var done = 0;
    var promises = mids.map(function(mid) {
      return apiPost('/api/manage/delete', { teamId: _currentTeam.id, managedId: mid }).then(function() {
        done++;
        updateLoading('一括削除中', done + '/' + mids.length);
      });
    });
    Promise.all(promises).then(function() {
      hideLoading();
      showStatus('manageStatus', mids.length + '件削除しました', 'ok');
      _listLoaded = false;
      ensureListLoaded(function() { renderManageList(); });
    }).catch(function() {
      hideLoading();
      showStatus('manageStatus', '削除中にエラーが発生しました', 'err');
    });
  });
}

function deleteManageImages(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:not(:checked)');
  var uncheckedUrls = [];
  checks.forEach(function(c) { uncheckedUrls.push(c.dataset.url); });
  var allChecked = document.querySelectorAll('.dl-img-check:checked');
  if (allChecked.length === 0) { showStatus('manageStatus', '削除する画像を選択してください', 'err'); return; }

  var checkedUrls = [];
  allChecked.forEach(function(c) { checkedUrls.push(c.dataset.url); });

  showConfirm(checkedUrls.length + '枚の画像を削除しますか？').then(function(ok) {
    if (!ok) return;
    showLoading('削除中', '0/' + checkedUrls.length);
    var done = 0;
    var promises = checkedUrls.map(function(url) {
      return apiPost('/api/manage/delete-single', { teamId: _currentTeam.id, managedId: managedId, targetUrl: url }).then(function() {
        done++;
        updateLoading('削除中', done + '/' + checkedUrls.length);
      });
    });
    Promise.all(promises).then(function() {
      hideLoading();
      showStatus('manageStatus', checkedUrls.length + '枚削除しました', 'ok');
      _listLoaded = false;
      toggleManageExpand(managedId);
      ensureListLoaded(function() { renderManageList(); });
    }).catch(function() {
      hideLoading();
      showStatus('manageStatus', '削除中にエラーが発生しました', 'err');
    });
  });
}

// ════════════════════════════════════════
// チーム管理
// ════════════════════════════════════════
function renderTeamSection() {
  if (!_currentTeam || _teams.length === 0) {
    document.getElementById('noTeam').style.display = 'block';
    document.getElementById('hasTeam').style.display = 'none';
    return;
  }
  document.getElementById('noTeam').style.display = 'none';
  document.getElementById('hasTeam').style.display = 'block';

  // 使用状況
  apiPost('/api/manage/stats', { teamId: _currentTeam.id })
  .then(function(d) {
    if (!d.ok) return;
    document.getElementById('statProducts').textContent = d.productCount;
    document.getElementById('statProductsMax').textContent = d.limits.maxProducts.toLocaleString();
    document.getElementById('statImages').textContent = d.imageCount;
    document.getElementById('statImagesMax').textContent = d.limits.maxImages.toLocaleString();
    document.getElementById('statMembers').textContent = d.memberCount;
    document.getElementById('statMembersMax').textContent = d.limits.maxMembers;
    document.getElementById('barProducts').style.width = Math.min(d.productCount / d.limits.maxProducts * 100, 100) + '%';
    document.getElementById('barImages').style.width = Math.min(d.imageCount / d.limits.maxImages * 100, 100) + '%';
    document.getElementById('barMembers').style.width = Math.min(d.memberCount / d.limits.maxMembers * 100, 100) + '%';
  });

  // 招待リンク
  var inviteLink = location.origin + '/register?code=' + _currentTeam.invite_code;
  document.getElementById('inviteUrl').value = inviteLink;

  // 招待カードの表示制御（ownerのみ）
  document.getElementById('inviteCard').style.display = _currentTeam.role === 'owner' ? 'block' : 'none';

  // メンバー一覧
  apiPost('/api/team/members', { teamId: _currentTeam.id })
  .then(function(d) {
    if (!d.ok) return;
    var html = '';
    (d.members || []).forEach(function(m) {
      var initial = (m.display_name || m.email || '?').charAt(0).toUpperCase();
      html += '<div class="member-item">' +
        '<div class="member-avatar">' + initial + '</div>' +
        '<div><div class="member-name">' + escapeHtml(m.display_name || m.email) + '</div>' +
        '<div class="member-role">' + (m.role === 'owner' ? 'オーナー' : 'メンバー') + '</div></div>' +
        '</div>';
    });
    document.getElementById('memberList').innerHTML = html;
  });

  // プランUI更新
  updatePlanUI();
}

// チーム作成
document.getElementById('createTeamBtn').addEventListener('click', function() {
  var name = document.getElementById('newTeamName').value.trim();
  if (!name) { showStatus('teamCreateStatus', 'チーム名を入力してください', 'err'); return; }
  this.disabled = true;
  apiPost('/api/team/create', { name: name }).then(function(d) {
    document.getElementById('createTeamBtn').disabled = false;
    if (d.ok) {
      _currentTeam = d.team;
      _teams = [d.team];
      showApp();
      renderTeamSection();
    } else {
      showStatus('teamCreateStatus', d.message || 'エラー', 'err');
    }
  }).catch(function() {
    document.getElementById('createTeamBtn').disabled = false;
    showStatus('teamCreateStatus', '通信エラー', 'err');
  });
});

// チーム参加
document.getElementById('joinTeamBtn').addEventListener('click', function() {
  var code = document.getElementById('joinInviteCode').value.trim();
  if (!code) { showStatus('teamCreateStatus', '招待コードを入力してください', 'err'); return; }
  this.disabled = true;
  apiPost('/api/team/join', { inviteCode: code }).then(function(d) {
    document.getElementById('joinTeamBtn').disabled = false;
    if (d.ok) {
      _currentTeam = d.team;
      _teams = [d.team];
      showApp();
      renderTeamSection();
    } else {
      showStatus('teamCreateStatus', d.message || 'エラー', 'err');
    }
  }).catch(function() {
    document.getElementById('joinTeamBtn').disabled = false;
    showStatus('teamCreateStatus', '通信エラー', 'err');
  });
});

// 招待コピー
document.getElementById('copyInviteBtn').addEventListener('click', function() {
  var url = document.getElementById('inviteUrl').value;
  navigator.clipboard.writeText(url).then(function() {
    showStatus('inviteStatus', 'コピーしました', 'ok');
  });
});

// 招待コード再生成
document.getElementById('regenInviteBtn').addEventListener('click', function() {
  if (!_currentTeam) return;
  apiPost('/api/team/regenerate-invite', { teamId: _currentTeam.id })
  .then(function(d) {
    if (d.ok) {
      _currentTeam.invite_code = d.inviteCode;
      document.getElementById('inviteUrl').value = location.origin + '/register?code=' + d.inviteCode;
      showStatus('inviteStatus', '招待コードを再生成しました', 'ok');
    } else {
      showStatus('inviteStatus', d.message || 'エラー', 'err');
    }
  });
});

// ════════════════════════════════════════
// 設定
// ════════════════════════════════════════
document.getElementById('showGuideBtn').addEventListener('click', function() {
  localStorage.removeItem('ob_done');
  showOnboarding();
});

document.getElementById('logoutBtn').addEventListener('click', function() {
  apiPost('/api/auth/logout', { sessionId: _sessionId }).then(function() {
    localStorage.removeItem('sessionId');
    location.href = '/login';
  }).catch(function() {
    localStorage.removeItem('sessionId');
    location.href = '/login';
  });
});

// ════════════════════════════════════════
// プレビューモーダル（ぼかし比較対応）
// ════════════════════════════════════════
function openPreview(blurredSrc, origSrc) {
  var modal = document.getElementById('previewModal');
  var img = document.getElementById('previewImg');
  img.src = blurredSrc;
  _previewBlurredSrc = blurredSrc;
  _previewOrigSrc = origSrc || '';
  _previewShowingOrig = false;
  modal.style.display = 'flex';
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
document.getElementById('previewModal').addEventListener('click', closePreview);
document.getElementById('closePreviewBtn').addEventListener('click', function(e) { e.stopPropagation(); closePreview(); });
document.getElementById('previewBtnBlur').addEventListener('click', function(e) { e.stopPropagation(); showPreviewBlur(); });
document.getElementById('previewBtnOrig').addEventListener('click', function(e) { e.stopPropagation(); showPreviewOrig(); });

// ════════════════════════════════════════
// 確認モーダル
// ════════════════════════════════════════
function showConfirm(message) {
  return new Promise(function(resolve) {
    _confirmResolve = resolve;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmModal').classList.add('show');
  });
}
document.getElementById('confirmCancel').addEventListener('click', function() {
  document.getElementById('confirmModal').classList.remove('show');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
});
document.getElementById('confirmOk').addEventListener('click', function() {
  document.getElementById('confirmModal').classList.remove('show');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
});

// ════════════════════════════════════════
// Stripe Billing（プラン課金）
// ════════════════════════════════════════
var _planBilling = 'monthly';
var PLAN_PRICES = {
  lite:     { monthly: '¥980',   yearly: '¥9,800' },
  standard: { monthly: '¥1,980', yearly: '¥19,800' },
  pro:      { monthly: '¥3,980', yearly: '¥39,800' },
};
var PLAN_NAMES = { free: 'フリー', lite: 'ライト', standard: 'スタンダード', pro: 'プロ' };

function updatePlanUI() {
  if (!_currentTeam) return;
  var plan = _currentTeam.plan || 'free';
  document.getElementById('currentPlanName').textContent = (PLAN_NAMES[plan] || plan);
  // 有料プランならPortalボタン表示
  var portalBtn = document.getElementById('openPortalBtn');
  portalBtn.style.display = (plan !== 'free') ? '' : 'none';
  // 現在プランをハイライト
  document.querySelectorAll('.plan-col').forEach(function(el) {
    var p = el.getAttribute('data-plan');
    if (p === plan) {
      el.style.borderColor = 'var(--success)';
      el.style.opacity = '0.6';
      el.style.pointerEvents = 'none';
      el.querySelector('.plan-price').insertAdjacentHTML('afterend',
        '<div class="current-badge" style="font-size:10px;color:var(--success);font-weight:600">利用中</div>');
    } else {
      el.style.opacity = '1';
      el.style.pointerEvents = '';
      var badge = el.querySelector('.current-badge');
      if (badge) badge.remove();
    }
  });
}

window.switchPlanBilling = function(mode) {
  _planBilling = mode;
  var mBtn = document.getElementById('billingMonthly');
  var yBtn = document.getElementById('billingYearly');
  if (mode === 'monthly') {
    mBtn.className = 'btn btn-primary'; mBtn.style.borderLeft = '';
    yBtn.className = 'btn btn-secondary'; yBtn.style.borderLeft = '0';
  } else {
    mBtn.className = 'btn btn-secondary'; mBtn.style.borderLeft = '';
    yBtn.className = 'btn btn-primary'; yBtn.style.borderLeft = '0';
  }
  // 価格表示更新
  document.querySelectorAll('.plan-col').forEach(function(el) {
    var p = el.getAttribute('data-plan');
    var priceEl = el.querySelector('.plan-price');
    var pr = PLAN_PRICES[p];
    if (pr && priceEl) {
      priceEl.innerHTML = pr[mode] + '<span style="font-size:12px;font-weight:400">/' + (mode === 'monthly' ? '月' : '年') + '</span>';
    }
  });
};

window.subscribePlan = function(plan) {
  if (!_currentTeam) return;
  // オーナーチェック（フロント側）
  if (_currentTeam.owner_id !== _user.id) {
    showStatus('planStatus', 'プラン変更はチームオーナーのみ可能です', 'err');
    return;
  }
  showStatus('planStatus', '決済ページに移動中...', 'ok');
  apiPost('/api/stripe/checkout', {
    plan: plan,
    billing: _planBilling,
    teamId: _currentTeam.id,
  }).then(function(d) {
    if (d.ok && d.url) {
      window.location.href = d.url;
    } else {
      showStatus('planStatus', d.message || 'エラーが発生しました', 'err');
    }
  }).catch(function() {
    showStatus('planStatus', '通信エラーが発生しました', 'err');
  });
};

document.getElementById('openPortalBtn').addEventListener('click', function() {
  apiPost('/api/stripe/portal', {}).then(function(d) {
    if (d.ok && d.url) {
      window.location.href = d.url;
    } else {
      alert(d.message || 'エラーが発生しました');
    }
  }).catch(function() {
    alert('通信エラーが発生しました');
  });
});

// Checkout成功後のフィードバック
(function() {
  var params = new URLSearchParams(location.search);
  if (params.get('checkout') === 'success') {
    history.replaceState({}, '', location.pathname);
    setTimeout(function() {
      showStatus('planStatus', 'プランが更新されました！反映まで数秒かかる場合があります。', 'ok');
    }, 500);
  }
})();

// ════════════════════════════════════════
// グローバル関数公開（inline onclick用）
// ════════════════════════════════════════
// ════════════════════════════════════════
// 使用量ミニバー（アップロードタブ上部）
// ════════════════════════════════════════
function updateUsageMiniBar() {
  if (!_currentTeam) return;
  apiPost('/api/manage/stats', { teamId: _currentTeam.id }).then(function(d) {
    if (!d.ok) return;
    var bar = document.getElementById('usageMiniBar');
    bar.style.display = '';
    document.getElementById('miniProducts').textContent = d.productCount;
    document.getElementById('miniProductsMax').textContent = d.limits.maxProducts.toLocaleString();
    document.getElementById('miniImages').textContent = d.imageCount;
    document.getElementById('miniImagesMax').textContent = d.limits.maxImages.toLocaleString();
    var pct = Math.max(
      d.productCount / d.limits.maxProducts,
      d.imageCount / d.limits.maxImages
    ) * 100;
    var fill = document.getElementById('miniBar');
    fill.style.width = Math.min(pct, 100) + '%';
    fill.style.background = pct >= 90 ? 'var(--error)' : pct >= 70 ? '#f59e0b' : 'var(--primary)';
    // 警告
    var warn = document.getElementById('usageWarning');
    if (pct >= 90) {
      var remaining = d.limits.maxProducts - d.productCount;
      warn.textContent = 'あと' + remaining + '商品で上限です。ライトプラン(¥980/月)で1,000商品に拡張できます。';
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  });
}

function showUpgradeHint() {
  document.getElementById('upgradeReason').textContent = 'この機能はライトプラン以上でご利用いただけます。';
  document.getElementById('upgradeModal').classList.add('show');
}

function showSoftPaywall(reason) {
  document.getElementById('upgradeReason').textContent = reason;
  document.getElementById('upgradeModal').classList.add('show');
}

window.switchTab = switchTab;
window.toggleManageExpand = toggleManageExpand;
window.searchImage = searchImage;
window.deleteManageImages = deleteManageImages;
window.showUpgradeHint = showUpgradeHint;
window.blurManageImages = blurManageImages;
window.showSaveLog = showSaveLog;
window.saveAndDownload = saveAndDownload;

var _currentSaveLog = { count: 0, users: [] };

function showSaveLog() {
  if (_currentSaveLog.users.length === 0) return;
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:999;display:flex;align-items:center;justify-content:center" onclick="this.remove()">' +
    '<div style="background:#fff;border-radius:12px;padding:20px;max-width:360px;width:90%;max-height:60vh;overflow-y:auto" onclick="event.stopPropagation()">' +
    '<div style="font-weight:600;font-size:15px;margin-bottom:12px">保存履歴</div>';
  for (var i = _currentSaveLog.users.length - 1; i >= 0; i--) {
    var u = _currentSaveLog.users[i];
    html += '<div style="font-size:13px;padding:6px 0;border-bottom:1px solid #f0f0f0">' +
      escapeHtml(u.displayName) + ' <span style="color:#9ca3af">' + formatDateTime(u.savedAt) + '</span></div>';
  }
  html += '<div style="margin-top:12px;text-align:center"><button class="btn" onclick="this.closest(\\x27[style*=fixed]\\x27).remove()" style="font-size:13px;padding:8px 24px">閉じる</button></div>';
  html += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function saveAndDownload(managedId) {
  if (!_currentTeam) return;
  // 保存ログ記録
  apiPost('/api/manage/save-log', { teamId: _currentTeam.id, managedId: managedId });
  // 選択されたチェック付き画像をダウンロード
  var checks = document.querySelectorAll('.dl-img-check:checked');
  if (checks.length === 0) { showStatus('manageStatus', '画像を選択してください', 'err'); return; }
  var done = 0;
  var files = [];
  var promises = [];
  checks.forEach(function(c) {
    var url = imgUrl(c.dataset.url);
    var idx = parseInt(c.dataset.imgidx);
    promises.push(
      fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
        done++;
        files.push({ name: managedId + '_' + (idx + 1) + '.jpg', blob: blob });
      })
    );
  });
  Promise.all(promises).then(function() {
    if (files.length === 0) { showStatus('manageStatus', 'ダウンロードに失敗しました', 'err'); return; }
    files.sort(function(a, b) { return a.name.localeCompare(b.name); });
    var shareFiles = files.map(function(f) { return new File([f.blob], f.name, { type: 'image/jpeg' }); });

    // モバイル: navigator.share
    if (isMobileDevice() && navigator.canShare && navigator.canShare({ files: shareFiles })) {
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
        a.remove();
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
      a.remove();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    });
    showStatus('manageStatus', files.length + '枚保存完了', 'ok');
  });
}

function isMobileDevice() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 768;
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
window.toggleDlImageSelect = toggleDlImageSelect;

// ぼかしバーのイベントリスナー
document.getElementById('blurSelectedBtn').addEventListener('click', function() { blurSelected(); });
document.getElementById('blurSelectAllBtn').addEventListener('click', function() { selectAllUpload(true); });
document.getElementById('blurDeselectAllBtn').addEventListener('click', function() { selectAllUpload(false); });

// ════════════════════════════════════════
// オンボーディング（初回のみ表示）
// ════════════════════════════════════════
var OB_PAGES = [
  {
    title: 'タスキ箱へようこそ',
    subtitle: '商品画像をチームで共有・管理',
    steps: [
      { label: 'チームを作成', desc: 'メンバーを招待して画像を共有' },
      { label: '画像をアップロード', desc: '管理番号ごとに最大10枚まで保存' },
      { label: '商品を管理', desc: '検索・並び替え・削除がかんたん' },
    ]
  },
  {
    title: 'アップロード方法',
    subtitle: '管理番号 + 画像を選ぶだけ',
    steps: [
      { label: '管理番号を入力', desc: '全角→半角は自動変換されます' },
      { label: '画像を選択', desc: 'TOPは高画質、2枚目以降は軽量に自動リサイズ' },
      { label: '追加モード', desc: '同じ番号で既に画像があれば追加モードに切替' },
    ]
  },
  {
    title: '画像の便利機能',
    subtitle: '補正・ぼかしで出品クオリティUP',
    steps: [
      { label: '明るさ自動補正', desc: '画像選択時にプレビューで確認。チェックOFFで無効化できます' },
      { label: '背景ぼかし', desc: 'AIが被写体を自動認識。選択した画像の背景をぼかせます' },
      { label: '画像差し替え', desc: '管理画面からぼかし適用や画像の上書きが可能です' },
    ]
  },
  {
    title: '商品管理のコツ',
    subtitle: '画像の確認・整理に便利な機能',
    steps: [
      { label: 'ドラッグで並び替え', desc: 'TOP画像を変更したいとき便利です' },
      { label: '画像検索', desc: 'Google Lensで類似商品を検索できます' },
      { label: 'チーム統計', desc: 'チームタブで使用状況を確認できます' },
    ]
  }
];

var _obPage = 0;

function showOnboarding(force) {
  if (!force && localStorage.getItem('ob_done')) return;
  _obPage = 0;
  renderObPage();
  document.getElementById('obOverlay').classList.add('show');
}

function renderObPage() {
  var p = OB_PAGES[_obPage];
  document.getElementById('obTitle').textContent = p.title;
  document.getElementById('obSubtitle').textContent = p.subtitle;

  var html = '<div class="ob-steps">';
  for (var i = 0; i < p.steps.length; i++) {
    html += '<div class="ob-step">' +
      '<div class="ob-step-num">' + (i + 1) + '</div>' +
      '<div class="ob-step-text"><strong>' + p.steps[i].label + '</strong>' +
      '<span>' + p.steps[i].desc + '</span></div></div>';
  }
  html += '</div>';
  document.getElementById('obContent').innerHTML = html;

  // ドット
  var dots = '';
  for (var j = 0; j < OB_PAGES.length; j++) {
    dots += '<div class="ob-dot' + (j === _obPage ? ' active' : '') + '"></div>';
  }
  document.getElementById('obDots').innerHTML = dots;

  // ボタン
  var nextBtn = document.getElementById('obNext');
  if (_obPage === OB_PAGES.length - 1) {
    nextBtn.textContent = 'はじめる';
  } else {
    nextBtn.textContent = '次へ';
  }
}

document.getElementById('obNext').addEventListener('click', function() {
  if (_obPage < OB_PAGES.length - 1) {
    _obPage++;
    renderObPage();
  } else {
    closeOnboarding();
  }
});

document.getElementById('obSkip').addEventListener('click', closeOnboarding);

function shareApp() {
  var url = location.origin + '/register';
  var text = 'タスキ箱 — 商品画像の共有ストレージ';
  if (_currentTeam && _currentTeam.invite_code) {
    url = location.origin + '/register?code=' + _currentTeam.invite_code;
    text = '「' + _currentTeam.name + '」からタスキ箱への招待です';
  }
  if (navigator.share) {
    navigator.share({ title: 'タスキ箱', text: text, url: url }).catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      showStatus('manageStatus', '招待リンクをコピーしました', 'ok');
    });
  }
}

function closeOnboarding() {
  document.getElementById('obOverlay').classList.remove('show');
  localStorage.setItem('ob_done', '1');
}

// ════════════════════════════════════════
// 管理者パネル（?admin=1で表示）
// ════════════════════════════════════════
var _isAdmin = false;

function initAdminPanel() {
  if (new URLSearchParams(location.search).get('admin') !== '1') return;
  if (!_currentTeam) return;

  // 管理者チェック
  apiPost('/api/admin/info', { teamId: _currentTeam.id }).then(function(d) {
    if (!d.ok || !d.isAdmin) return;
    _isAdmin = true;
    var panel = document.getElementById('adminPanel');
    panel.classList.add('show');
    document.body.classList.add('has-admin');
    // パネル高さを測ってCSS変数にセット（フッタのbottom位置用）
    requestAnimationFrame(function() {
      var h = panel.offsetHeight;
      document.documentElement.style.setProperty('--admin-h', h + 'px');
    });
    adminUpdateStatus(d);
    adminHighlightPlan(d.team.plan);
  }).catch(function() {});
}

function adminUpdateStatus(d) {
  var t = d.team;
  var l = d.limits;
  var el = document.getElementById('adminStatus');
  el.textContent = _user.email + ' | プラン: ' + t.plan +
    ' | 商品: ' + t.productCount + '/' + l.maxProducts +
    ' | 画像: ' + t.imageCount + '/' + l.maxImages +
    ' | メンバー: ' + t.memberCount + '/' + l.maxMembers;
}

function adminHighlightPlan(plan) {
  document.querySelectorAll('#adminPanel .admin-row:first-of-type .admin-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  var planNames = ['free', 'lite', 'standard', 'pro'];
  var btns = document.querySelectorAll('#adminPanel .admin-row:first-of-type .admin-btn');
  var idx = planNames.indexOf(plan);
  if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');
}

window.adminSetPlan = function(plan) {
  if (!_currentTeam) return;
  apiPost('/api/admin/set-plan', { teamId: _currentTeam.id, plan: plan }).then(function(d) {
    if (d.ok) {
      _currentTeam.plan = plan;
      adminHighlightPlan(plan);
      // 管理ステータス再取得
      apiPost('/api/admin/info', { teamId: _currentTeam.id }).then(function(d2) {
        if (d2.ok) adminUpdateStatus(d2);
      });
      // チームタブも更新
      if (document.getElementById('sec-team').classList.contains('active')) renderTeamSection();
    }
  });
};

window.adminSetUsage = function(products, images) {
  if (!_currentTeam) return;
  apiPost('/api/admin/info', { teamId: _currentTeam.id }).then(function(d) {
    if (!d.ok) return;
    var l = d.limits;
    var pc, ic;
    if (products === 0) { pc = 0; ic = 0; }
    else if (products === 'half') { pc = Math.ceil(l.maxProducts / 2); ic = Math.ceil(l.maxImages / 2); }
    else if (products === 'max') { pc = l.maxProducts; ic = l.maxImages; }
    else if (products === 'over') { pc = l.maxProducts + 5; ic = l.maxImages + 50; }
    else { pc = products; ic = images; }

    apiPost('/api/admin/reset-usage', { teamId: _currentTeam.id, productCount: pc, imageCount: ic }).then(function(d2) {
      if (d2.ok) {
        apiPost('/api/admin/info', { teamId: _currentTeam.id }).then(function(d3) {
          if (d3.ok) adminUpdateStatus(d3);
        });
        if (document.getElementById('sec-team').classList.contains('active')) renderTeamSection();
      }
    });
  });
};
</script>
</body>
</html>`;
}
