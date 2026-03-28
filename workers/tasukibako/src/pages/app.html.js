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
<meta name="apple-mobile-web-app-capable" content="yes">
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
@keyframes spin{to{transform:rotate(360deg)}}
.page-loader{display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:12px;color:var(--text-sub);font-size:14px}
@media(max-width:480px){.img-grid{grid-template-columns:repeat(2,1fr)}.preview-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:481px) and (max-width:768px){.img-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:769px){.img-grid{grid-template-columns:repeat(4,1fr)}}
</style>
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
    <button id="refreshBtn" style="background:none;border:none;font-size:20px;padding:4px 8px;cursor:pointer;color:#6b7280;flex-shrink:0" title="更新"><span id="refreshIcon" style="display:inline-block">&#x21bb;</span></button>
  </div>

  <!-- セクション1: アップロード -->
  <div class="section active" id="sec-upload">
    <!-- チーム未作成ガード -->
    <div class="card" id="uploadNoTeam" style="display:none;text-align:center">
      <h2 style="border:none;color:var(--text-sub)">チームを作成してください</h2>
      <p style="font-size:14px;color:var(--text-sub);margin-bottom:16px">画像をアップロードするにはチームの作成が必要です。</p>
      <button class="btn btn-primary" onclick="switchTab('team')">チームを作成する</button>
    </div>
    <div class="card" id="uploadForm">
      <h2>画像アップロード</h2>
      <div class="field">
        <label>管理番号</label>
        <input type="text" id="uploadManagedId" placeholder="例: A001" autocomplete="off">
      </div>
      <div id="existingImages" class="hidden" style="margin-top:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px" id="existingCount"></div>
        <div class="preview-grid" id="existingGrid"></div>
      </div>
      <div class="field" style="margin-top:12px">
        <label>画像（最大10枚）</label>
        <input type="file" id="uploadFiles" multiple accept="image/*">
      </div>
      <div class="preview-grid" id="uploadPreview"></div>
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
      <div class="field" style="margin-bottom:8px">
        <input type="text" id="manageSearch" placeholder="管理番号で検索..." autocomplete="off">
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
        <label>表示名</label>
        <input type="text" id="settingsDisplayName">
      </div>
      <div class="field">
        <label>メールアドレス</label>
        <input type="email" id="settingsEmail" readonly style="background:#f3f4f6">
      </div>
      <div class="status" id="settingsStatus"></div>
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
  <div class="footer-inner">
    <button class="btn btn-danger" id="deleteSelectedBtn" disabled>選択した商品を削除</button>
  </div>
</div>

<!-- 画像プレビューモーダル -->
<div id="previewModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:300;display:none;align-items:center;justify-content:center;cursor:pointer">
  <img id="previewImg" style="max-width:95%;max-height:90vh;object-fit:contain;border-radius:4px">
  <div style="position:absolute;top:16px;right:16px;color:#fff;font-size:32px;cursor:pointer;padding:8px;line-height:1" id="closePreviewBtn">&times;</div>
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
    // 管理パネル初期化
    initAdminPanel();
  }).catch(function() {
    localStorage.removeItem('sessionId');
    location.href = '/login';
  });
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
  } else {
    document.getElementById('uploadForm').style.display = 'none';
    document.getElementById('uploadNoTeam').style.display = 'block';
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
  document.getElementById('existingCount').textContent = urls.length + '枚登録済み（あと' + (10 - urls.length) + '枚追加可能）';
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
  var input = document.getElementById('uploadFiles');
  var grid = document.getElementById('uploadPreview');
  var btn = document.getElementById('uploadBtn');
  grid.innerHTML = '';
  var files = input.files;
  if (!files || files.length === 0) { btn.disabled = true; return; }
  var maxNew = 10 - _existingUrls.length;
  if (files.length > maxNew) {
    showStatus('uploadStatus', '画像は最大10枚までです（既存' + _existingUrls.length + '枚+新規は' + maxNew + '枚まで）', 'err');
    input.value = ''; btn.disabled = true; return;
  }
  btn.disabled = false;
  for (var i = 0; i < files.length; i++) {
    var div = document.createElement('div');
    div.className = 'preview-item';
    var labelIdx = _existingUrls.length + i;
    div.innerHTML = '<img src="' + URL.createObjectURL(files[i]) + '">' +
      '<span class="badge">' + (labelIdx === 0 ? 'TOP' : (labelIdx+1)) + '</span>';
    grid.appendChild(div);
  }
}

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

  resizeAllImages(files, function(blobs) {
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
      btn.disabled = false;
      _busyOperation = false;
      bar.classList.remove('show');
      if (d.ok) {
        fill.style.width = '100%';
        // サクセスアニメーション
        var suc = document.getElementById('uploadSuccess');
        suc.classList.add('show');
        suc.querySelector('.check').textContent = blobs.length;
        suc.querySelector('div:last-child').textContent = blobs.length + '枚アップロード完了';
        setTimeout(function() { suc.classList.remove('show'); }, 2500);
        showStatus('uploadStatus', blobs.length + '枚アップロード完了', 'ok');
        input.value = '';
        document.getElementById('uploadPreview').innerHTML = '';
        checkExisting(managedId);
        _listLoaded = false;
      } else {
        showStatus('uploadStatus', d.message || 'アップロード失敗', 'err');
      }
    }).catch(function(e) {
      btn.disabled = false; _busyOperation = false; bar.classList.remove('show');
      showStatus('uploadStatus', '通信エラー: ' + e.message, 'err');
    });
  });
}

// ════════════════════════════════════════
// 画像リサイズ
// ════════════════════════════════════════
function resizeAllImages(files, cb) {
  var results = []; var idx = 0; var done = 0;
  function next() {
    while (idx < files.length && (idx - done) < 2) {
      (function(i) {
        idx++;
        var isTop = (_existingUrls.length === 0 && i === 0);
        resizeImage(files[i], isTop ? 1200 : 800, isTop ? 0.80 : 0.75, function(blob) {
          results[i] = blob; done++;
          if (done === files.length) { cb(results); return; }
          next();
        });
      })(idx);
    }
  }
  next();
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
      c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close();
      c.toBlob(function(blob) { c.width = 0; c.height = 0; cb(blob); }, 'image/jpeg', quality);
    }).catch(function() { cb(file); });
  } else { cb(file); }
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
    showStatus('uploadStatus', '上書き中...', 'info');
    resizeImage(input.files[0], isTop ? 1200 : 800, isTop ? 0.80 : 0.75, function(blob) {
      var fd = new FormData();
      fd.append('teamId', _currentTeam.id);
      fd.append('managedId', mid);
      fd.append('targetUrl', targetUrl);
      fd.append('images', blob, 'replace.jpg');
      // update-image APIは未実装のため、削除+追加で代替
      // 将来実装時にここを差し替え
      showStatus('uploadStatus', '差し替え機能は準備中です', 'info');
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
    showStatus('manageLoadStatus', _productList.length + '件の商品', 'ok');
    if (cb) cb();
  }).catch(function() { showStatus('manageLoadStatus', 'ネットワークエラー', 'err'); if (cb) cb(); });
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
  var el = document.getElementById('manageList');
  var html = '';
  for (var i = 0; i < _productList.length; i++) {
    var p = _productList[i];
    if (q && p.managedId.toUpperCase().indexOf(q) === -1) continue;
    var thumbSrc = p.thumbnail ? imgUrl(p.thumbnail) : '';
    html += '<div id="manage-row-' + escapeHtml(p.managedId) + '">' +
      '<div class="list-item">' +
      '<input type="checkbox" class="list-check dl-check" data-mid="' + escapeHtml(p.managedId) + '">' +
      (thumbSrc ? '<img class="list-thumb" src="' + thumbSrc + '" loading="lazy" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">' : '<div class="list-thumb" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')"></div>') +
      '<div class="list-info" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')" style="cursor:pointer">' +
      '<div class="list-id">' + escapeHtml(p.managedId) + '</div>' +
      '<div class="list-count">' + p.count + '枚</div>' +
      (p.uploadedByName ? '<div class="list-meta">' + escapeHtml(p.uploadedByName) + '</div>' : '') +
      '</div>' +
      '<span style="color:var(--primary);font-size:20px;padding:0 8px;cursor:pointer" onclick="toggleManageExpand(\\'' + escapeHtml(p.managedId) + '\\')">&#x203a;</span>' +
      '</div></div>';
  }
  el.innerHTML = html || '<div style="text-align:center;color:#999;padding:20px">該当なし</div>';
  document.getElementById('selectAllRow').classList.remove('hidden');
  _manageExpandedMid = '';
  updateSelectedCount();
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
    if (!el || !d.ok) return;
    var urls = d.urls || [];
    _manageExpandedUrls = urls;
    var html = '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + escapeHtml(managedId) + ' (' + urls.length + '枚)</div>';
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
      '</div>';
    el.innerHTML = html;
    initDragReorder(document.getElementById('manageImageGrid'), managedId);
    // プレビュー
    el.querySelectorAll('.preview-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openPreview(this.dataset.src); });
    });
  });
}

function searchImage(managedId) {
  var checks = document.querySelectorAll('.dl-img-check:checked');
  var url = '';
  if (checks.length > 0) url = location.origin + checks[0].dataset.url + '?token=' + _sessionId;
  else if (_manageExpandedUrls.length > 0) url = location.origin + _manageExpandedUrls[0] + '?token=' + _sessionId;
  if (!url) return;
  window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(url));
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
    var promises = mids.map(function(mid) {
      return apiPost('/api/manage/delete', { teamId: _currentTeam.id, managedId: mid });
    });
    Promise.all(promises).then(function() {
      showStatus('manageStatus', mids.length + '件削除しました', 'ok');
      _listLoaded = false;
      ensureListLoaded(function() { renderManageList(); });
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
    var promises = checkedUrls.map(function(url) {
      return apiPost('/api/manage/delete-single', { teamId: _currentTeam.id, managedId: managedId, targetUrl: url });
    });
    Promise.all(promises).then(function() {
      showStatus('manageStatus', checkedUrls.length + '枚削除しました', 'ok');
      _listLoaded = false;
      toggleManageExpand(managedId); // 閉じる
      ensureListLoaded(function() { renderManageList(); });
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
// プレビューモーダル
// ════════════════════════════════════════
function openPreview(src) {
  var modal = document.getElementById('previewModal');
  document.getElementById('previewImg').src = src;
  modal.style.display = 'flex';
}
document.getElementById('previewModal').addEventListener('click', function() { this.style.display = 'none'; });
document.getElementById('closePreviewBtn').addEventListener('click', function() { document.getElementById('previewModal').style.display = 'none'; });

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
// グローバル関数公開（inline onclick用）
// ════════════════════════════════════════
window.switchTab = switchTab;
window.toggleManageExpand = toggleManageExpand;
window.searchImage = searchImage;
window.deleteManageImages = deleteManageImages;

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
