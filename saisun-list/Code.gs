// Code.gs
// APP_CONFIG.data.spreadsheetId と同じスプレッドシートをログ先に使用
// ※ getterで遅延評価し、ファイル読み込み順に依存しないようにする
var _logConfig = { get id() { return String(APP_CONFIG.data.spreadsheetId || ''); } };
const LOG_SHEET_NAME = "アクセスログ";
// グローバルスコープ参照（doPost内で関数を動的に解決するため）
var _global = this;

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  if (p.code || p.error) {
    return baseHandleOAuthCallback_(e);
  }

  // KOMOJU Webhook処理
  if (p.action === 'komoju_webhook') {
    var result = handleKomojuWebhook(e);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // アソート商品LP（?page=bulk）
  if (String(p.page || '') === 'bulk') {
    var tBulk = HtmlService.createTemplateFromFile('BulkLP');
    tBulk.appTitle = APP_CONFIG.appTitle;
    // デタウリ（個品LP）へのリンクURLをテンプレートに渡す
    var detauriUrl = '';
    try { detauriUrl = SITE_CONSTANTS.SITE_URL || ''; } catch (e) {}
    if (!detauriUrl) {
      try { detauriUrl = ScriptApp.getService().getUrl(); } catch (e) {}
    }
    tBulk.detauriUrl = detauriUrl || '';
    return tBulk.evaluate()
      .setTitle(APP_CONFIG.appTitle + ' - アソート商品')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }

  var tplName = (String(p.admin || '') === 'nkonline') ? 'Admin' : 'Index';

  var t = HtmlService.createTemplateFromFile(tplName);
  t.appTitle = APP_CONFIG.appTitle;
  t.topNotes = (APP_CONFIG.uiText && Array.isArray(APP_CONFIG.uiText.notes)) ? APP_CONFIG.uiText.notes : [];
  t.me = String(p.me || '');

  // アソート商品LPへのリンクURLをテンプレートに渡す
  var bulkUrl = '';
  try { bulkUrl = (SITE_CONSTANTS.SITE_URL || '') + '?page=bulk'; } catch (e) {}
  if (!bulkUrl || bulkUrl === '?page=bulk') {
    try { bulkUrl = ScriptApp.getService().getUrl() + '?page=bulk'; } catch (e) {}
  }
  t.bulkUrl = bulkUrl || '';

  return t.evaluate()
    .setTitle(APP_CONFIG.appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}


/**
 * JSON API エンドポイント（外部フロントエンド用）
 * Cloudflare Pages等からfetch()で呼び出す
 */
function doPost(e) {
  try {
    // KOMOJU Webhook処理（POSTリクエスト、query param: ?action=komoju_webhook）
    var queryAction = (e && e.parameter) ? String(e.parameter.action || '') : '';
    if (queryAction === 'komoju_webhook') {
      var result = handleKomojuWebhook(e);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // KOMOJU Webhookボディ検出（GASリダイレクトでquery paramが消失した場合のフォールバック）
    // KOMOJUのWebhookペイロードは type: "payment.*" と data オブジェクトを持つ
    try {
      var rawContents = (e && e.postData) ? e.postData.contents : '';
      if (rawContents) {
        var preCheck = JSON.parse(rawContents);
        if (preCheck && preCheck.type && typeof preCheck.type === 'string' &&
            preCheck.type.indexOf('payment.') === 0 && preCheck.data) {
          console.log('KOMOJU Webhook detected by body content (query param fallback): ' + preCheck.type);
          var result = handleKomojuWebhook(e);
          return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    } catch (webhookDetectErr) {
      // Webhookではない通常APIリクエスト — 次の処理へ続行
    }

    var body = JSON.parse(e.postData.contents);
    var action = String(body.action || '');
    var args = body.args || [];
    console.log('doPost: action=' + action);

    // 許可されたAPI関数名のホワイトリスト
    // ※ 直接参照ではなく文字列で定義し、動的に解決する
    //   （1つのファイルのロードに失敗しても他のAPIが全滅しない）
    var allowedNames = [
      'apiGetCachedProducts', 'apiInit', 'apiSearch',
      'apiGetStatusDigest', 'apiSyncHolds', 'apiSubmitEstimate',
      'apiGetProductDetail', 'apiGetAllDetails', 'apiRefreshOpenState', 'apiLogPV',
      'apiSendContactForm',
      'apiRegisterCustomer', 'apiLoginCustomer', 'apiValidateSession',
      'apiLogoutCustomer', 'apiUpdateCustomerProfile',
      'apiRequestPasswordReset', 'apiRecoverEmail', 'apiChangePassword', 'apiGetMyPage',
      'apiCreateKomojuSession', 'apiCheckPaymentStatus', 'apiCancelOrder',
      'apiGetCsrfToken',
      'apiBulkInit', 'apiBulkSubmit', 'apiBulkPage', 'apiDetailPage',
      'apiChatbot', 'apiValidateCoupon', 'apiAdminLinkOrder',
      // 記事API
      'apiGetArticles', 'apiGetArticleContent',
      // 管理者専用API（adminKey認証必須）
      'adminGetKomojuMode', 'adminToggleKomojuMode',
      'adminGetMemberDiscountStatus', 'adminToggleMemberDiscount',
      'adminRebuildStates', 'adminApplyStatusDropdown',
      'adminClearProductsCache', 'adminCompactHolds'
    ];
    var allowedSet = {};
    for (var ai = 0; ai < allowedNames.length; ai++) allowedSet[allowedNames[ai]] = true;

    if (!allowedSet[action]) {
      return jsonResponse_({ ok: false, message: '不明なアクション: ' + action });
    }

    var fn = _global[action];
    if (typeof fn !== 'function') {
      console.error('API function not available: ' + action);
      return jsonResponse_({ ok: false, message: action + ' は現在利用できません。管理者にお問い合わせください。' });
    }

    // レート制限チェック（userKeyはargsの第1引数に入っている想定）
    var userKey = (args.length > 0 && typeof args[0] === 'string') ? args[0] : '';
    var adminKeyFromBody = String(body.adminKey || '');
    var props = PropertiesService.getScriptProperties();
    var storedAdminKey = props.getProperty('ADMIN_KEY') || '';
    var storedAccessKey = props.getProperty(APP_CONFIG.admin.accessKeyProp) || '';
    var isAdmin = (storedAdminKey !== '' && timingSafeEqual_(adminKeyFromBody, storedAdminKey)) ||
                  (storedAccessKey !== '' && timingSafeEqual_(adminKeyFromBody, storedAccessKey));
    console.log('doPost: isAdmin=' + isAdmin + ', action=' + action +
      ', ADMIN_KEY=' + (storedAdminKey ? 'set' : 'empty') +
      ', ACCESS_KEY=' + (storedAccessKey ? 'set' : 'empty'));

    // admin関数は管理者のみ呼び出し可能
    if (action.indexOf('admin') === 0 && !isAdmin) {
      return jsonResponse_({ ok: false, message: '権限がありません' });
    }

    if (!isAdmin) {
      var rateErr = checkRateLimit_(action, userKey);
      if (rateErr) {
        return jsonResponse_({ ok: false, message: rateErr });
      }

      // reCAPTCHA検証（送信時のみ）
      if (action === 'apiSubmitEstimate') {
        var token = String(body.recaptchaToken || '');
        if (!verifyRecaptcha_(token)) {
          console.log('reCAPTCHA failed: token=' + (token ? 'present(' + token.length + 'chars)' : 'empty') + ' keys=' + Object.keys(body).join(','));
          return jsonResponse_({ ok: false, message: 'bot判定されました。ブラウザを再読み込みして再度お試しください。' });
        }
      }

      // CSRF検証（状態変更を伴うAPIに適用）
      var csrfProtectedActions = [
        'apiSubmitEstimate', 'apiUpdateCustomerProfile', 'apiChangePassword',
        'apiCreateKomojuSession', 'apiCancelOrder'
      ];
      if (csrfProtectedActions.indexOf(action) !== -1) {
        var csrfToken = String(body.csrfToken || '');
        if (!verifyCsrfToken_(userKey, csrfToken)) {
          return jsonResponse_({ ok: false, message: '不正なリクエストです。ページを再読み込みしてください。' });
        }
      }
    }

    // オーナー（管理者）のPVアクセスはログしない
    if (isAdmin && action === 'apiLogPV') {
      return jsonResponse_({ ok: true, skipped: true });
    }

    // 管理者API: doPostで認証済みなら args[0] を ADMIN_ACCESS_KEY に統一し
    // ad_requireAdmin_ を確実に通過させる
    if (isAdmin && action.indexOf('apiAdmin') === 0 && args.length > 0 && storedAccessKey) {
      args[0] = storedAccessKey;
    }

    var result = fn.apply(null, args);
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ ok: false, message: (err && err.message) ? err.message : String(err) });
  }
}

/** クライアントから呼び出し: アソート商品ページのURLを返す */
function getBulkPageUrl() {
  var url = '';
  try { url = (SITE_CONSTANTS.SITE_URL || '') + '?page=bulk'; } catch (e) {}
  if (!url || url === '?page=bulk') {
    try { url = ScriptApp.getService().getUrl() + '?page=bulk'; } catch (e) {}
  }
  return url || '';
}

/** クライアントサイドルーター用: BulkLP.htmlのHTMLコンテンツを返す */
function apiBulkPage() {
  try {
    var html = HtmlService.createHtmlOutputFromFile('BulkLP').getContent();
    return { ok: true, html: html };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
}

/** クライアントサイドルーター用: index.html（デタウリ）のHTMLコンテンツを返す */
function apiDetailPage() {
  try {
    var html = HtmlService.createHtmlOutputFromFile('index').getContent();
    return { ok: true, html: html };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// レート制限（CacheServiceベース）
// =====================================================

var RATE_LIMITS = {
  'apiSubmitEstimate': { max: 5, windowSec: 3600, label: '決済は1時間に5回まで' },
  'apiBulkSubmit': { max: 5, windowSec: 3600, label: '決済は1時間に5回まで' },
  'apiSyncHolds':     { max: 30, windowSec: 60,   label: '確保操作は1分に30回まで' },
  'apiLoginCustomer': { max: 5, windowSec: 3600, label: 'ログインは1時間に5回まで' },
  'apiRegisterCustomer': { max: 3, windowSec: 3600, label: '登録は1時間に3回まで' },
  'apiSendContactForm': { max: 3, windowSec: 3600, label: 'お問い合わせは1時間に3回まで' },
  'apiRequestPasswordReset': { max: 3, windowSec: 3600, label: 'パスワードリセットは1時間に3回まで' },
  'apiRecoverEmail': { max: 5, windowSec: 3600, label: 'メールアドレス確認は1時間に5回まで' },
  'apiGetArticles':       { max: 20, windowSec: 60, label: '記事一覧は1分に20回まで' },
  'apiGetArticleContent': { max: 30, windowSec: 60, label: '記事閲覧は1分に30回まで' }
};

function checkRateLimit_(action, userKey) {
  var rule = RATE_LIMITS[action];
  if (!rule || !userKey) return null;

  // テストモード時は決済関連のレート制限をスキップ
  if (action === 'apiSubmitEstimate') {
    try {
      var komojuMode = getKomojuMode_();
      if (komojuMode.mode === 'test') return null;
    } catch (e) { console.log('optional: komoju mode check: ' + (e.message || e)); }
  }

  var cache = CacheService.getScriptCache();
  var key = 'RL:' + action + ':' + userKey;
  var raw = cache.get(key);
  var count = raw ? parseInt(raw, 10) : 0;

  if (count >= rule.max) {
    return rule.label + '。しばらくお待ちください。';
  }

  cache.put(key, String(count + 1), rule.windowSec);
  return null;
}

// =====================================================
// reCAPTCHA v3 検証
// =====================================================

function getRecaptchaSecret_() {
  return PropertiesService.getScriptProperties().getProperty('RECAPTCHA_SECRET') || '';
}

function verifyRecaptcha_(token) {
  var secret = getRecaptchaSecret_();
  if (!secret) {
    if (ENV_CONFIG.isProduction()) {
      console.error('RECAPTCHA_SECRET が本番環境で未設定です。リクエストを拒否します。');
      return false;  // 本番環境ではfail-secure
    }
    console.warn('RECAPTCHA_SECRET が未設定です。reCAPTCHA検証をスキップします（開発環境）。');
    return true;  // 開発環境のみスキップ
  }
  if (!token) {
    console.warn('reCAPTCHA token empty — リクエストを拒否します');
    return false;  // トークンなしは拒否（fail-secure）
  }

  try {
    var res = UrlFetchApp.fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'post',
      payload: {
        secret: secret,
        response: token
      },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText());
    console.log('reCAPTCHA verify: success=' + json.success + ' score=' + json.score);

    // 検証失敗の場合は拒否
    if (json.success !== true) {
      console.warn('reCAPTCHA verification failed: ' + JSON.stringify(json['error-codes'] || []));
      return false;
    }

    // スコアが閾値未満はbot判定で拒否
    if ((json.score || 0) < RECAPTCHA_CONSTANTS.SCORE_THRESHOLD) {
      console.warn('reCAPTCHA score too low: ' + json.score);
      return false;
    }

    return true;
  } catch (e) {
    console.error('reCAPTCHA fetch error: ' + e);
    return false;  // 検証失敗時は拒否（fail-secure）
  }
}

// =====================================================
// 管理者判定（レート制限・reCAPTCHAをスキップ）
// =====================================================

/**
 * 管理者キーを設定（GASエディタで1回だけ実行）
 * ★ 下の 'my-secret-key-123' を好きなキーに変えてから実行
 */
function setAdminKey() {
  var key = 'my-secret-key-123';  // ← ここを変更してから実行
  if (key === 'my-secret-key-123') {
    console.log('ERROR: key を実際の管理キーに置き換えてください');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', key);
  console.log('ADMIN_KEY を設定しました（セキュリティのため値は表示しません）');
}

function apiLogPV(payload) {
  const body = (payload && typeof payload === 'object') ? payload : {};
  const noLog = String(body.noLog || '') === '1';
  if (noLog) return { ok: true, skipped: true };

  var props = PropertiesService.getScriptProperties();

  // オーナー判定用メールアドレス（ADMIN_OWNER_EMAIL）
  var ownerEmail = '';
  try {
    ownerEmail = String(props.getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim().toLowerCase();
  } catch(e) {}

  // (1) ログイン中のメールアドレスでオーナー判定（全URL・全端末対応）
  var reqEmail = String(body.email || '').trim().toLowerCase();
  if (ownerEmail && reqEmail && reqEmail === ownerEmail) {
    // ついでにこの端末のuserKeyをOWNER_USER_KEYSに自動追加
    try {
      var reqUserKey = String(body.userKey || '').trim();
      if (reqUserKey) {
        var keysRaw = props.getProperty('OWNER_USER_KEYS') || '';
        var keysArr = keysRaw ? keysRaw.split(',').map(function(k) { return k.trim(); }).filter(Boolean) : [];
        if (keysArr.indexOf(reqUserKey) === -1) {
          keysArr.push(reqUserKey);
          props.setProperty('OWNER_USER_KEYS', keysArr.join(','));
          console.log('OWNER_USER_KEYS に自動追加: ' + reqUserKey);
        }
      }
    } catch(e) { console.log('optional: auto-add owner key: ' + (e.message || e)); }
    return { ok: true, skipped: true };
  }

  // (2) OWNER_USER_KEYS でuserKey判定
  try {
    var ownerKeysRaw = props.getProperty('OWNER_USER_KEYS') || '';
    if (ownerKeysRaw) {
      var reqUk = String(body.userKey || '').trim();
      if (reqUk) {
        var ownerKeys = {};
        ownerKeysRaw.split(',').forEach(function(k) { if (k.trim()) ownerKeys[k.trim()] = true; });
        if (ownerKeys[reqUk]) return { ok: true, skipped: true };
      }
    }
  } catch(e) { console.log('optional: owner userKey check: ' + (e.message || e)); }

  // (3) GASモード: Session.getActiveUser() でオーナー判定
  try {
    if (ownerEmail) {
      var activeEmail = String((Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : '') || '').trim().toLowerCase();
      if (activeEmail && activeEmail === ownerEmail) return { ok: true, skipped: true };
    }
  } catch(e) { console.log('optional: GAS owner email check: ' + (e.message || e)); }

  // ボット除外（サーバーサイド）
  var ua = String(body.userAgent || '').toLowerCase();
  if (/headlesschrome|google-read-aloud|bot|crawl|spider|slurp/.test(ua)) return { ok: true, skipped: true };
  var scr = String(body.screen || '');
  if (scr === '0x0' || scr === '2000x2000' || scr === '400x400') return { ok: true, skipped: true };

  const now = new Date();
  const tz = Session.getScriptTimeZone() || "Asia/Tokyo";
  const page = body.page ? String(body.page) : "Index";

  const row = [
    now,
    Utilities.formatDate(now, tz, "yyyy-MM-dd"),
    Utilities.formatDate(now, tz, "HH"),
    page,
    body.userKey ? String(body.userKey) : "",
    body.url ? String(body.url) : "",
    body.referrer ? String(body.referrer) : "",
    body.userAgent ? String(body.userAgent) : "",
    body.language ? String(body.language) : "",
    body.screen ? String(body.screen) : "",
    reqEmail,
    ""
  ];

  appendLogRow_(row);
  return { ok: true };
}

/**
 * 既存アクセスログからオーナー＆ボットの行を一括削除
 *
 * 削除対象:
 *   - OWNER_USER_KEYS に一致する userKey
 *   - ADMIN_OWNER_EMAIL に一致するメールアドレス（11列目）
 *   - GAS deployment URL 経由のアクセス（6列目 url に script.google.com を含む）
 *   - ボット / クローラー / スクレーパー
 *
 * ★ GASエディタから実行してください（何度でも実行可能）
 */
function ad_cleanAccessLog() {
  var ss = SpreadsheetApp.openById(String(_logConfig.id).trim());
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) { console.log('アクセスログシートが見つかりません'); return; }
  var last = sheet.getLastRow();
  if (last < 2) { console.log('データなし'); return; }
  var data = sheet.getRange(2, 1, last - 1, 12).getValues();

  var props = PropertiesService.getScriptProperties();

  // オーナーのuserKey（Script Propertiesから取得）
  var ownerKeys = {};
  try {
    var ownerKeysRaw = props.getProperty('OWNER_USER_KEYS') || '';
    if (ownerKeysRaw) {
      ownerKeysRaw.split(',').forEach(function(k) { if (k.trim()) ownerKeys[k.trim()] = true; });
    }
  } catch (e) { console.log('optional: owner keys read: ' + (e.message || e)); }

  // オーナーのメールアドレス
  var ownerEmail = '';
  try {
    ownerEmail = String(props.getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim().toLowerCase();
  } catch (e) {}

  var botUaRe = /headlesschrome|google-read-aloud|bot|crawl|spider|slurp/i;
  var botScreens = { '0x0': true, '2000x2000': true, '400x400': true };
  var suspectLangs = { 'en-US@posix': true, 'es-ES': true, 'it-IT': true };

  var deleteRows = [];
  var ownerKeysCandidates = {};
  for (var i = 0; i < data.length; i++) {
    var userKey = String(data[i][4] || '');
    var url     = String(data[i][5] || '');
    var ua      = String(data[i][7] || '');
    var lang    = String(data[i][8] || '');
    var scr     = String(data[i][9] || '');
    var email   = String(data[i][10] || '').trim().toLowerCase();

    var remove = false;

    // オーナーのuserKey
    if (ownerKeys[userKey]) remove = true;

    // オーナーのメールアドレス（11列目にメールが記録されている場合）
    if (ownerEmail && email && email === ownerEmail) {
      remove = true;
      // このuserKeyもオーナーのものとして記録
      if (userKey) ownerKeysCandidates[userKey] = true;
    }

    // GAS deployment URL 経由のアクセス（管理者アクセス）
    if (url.indexOf('script.google.com/macros/') !== -1) remove = true;

    // ボットUA
    if (botUaRe.test(ua)) remove = true;

    // 異常なスクリーンサイズ
    if (botScreens[scr]) remove = true;

    // 疑わしい言語
    if (suspectLangs[lang]) remove = true;

    // en-US + 800x600（スクレーパー）
    if (lang === 'en-US' && scr === '800x600') remove = true;

    // en-US + 1024x1024（ボット）
    if (lang === 'en-US' && scr === '1024x1024') remove = true;

    // en-US + 古いChrome（バージョン < 135）
    if (lang === 'en-US') {
      var m = ua.match(/Chrome\/(\d+)\./);
      if (m && parseInt(m[1], 10) < 135) remove = true;
    }

    if (remove) deleteRows.push(i + 2); // 1-indexed, ヘッダー分+1
  }

  // 新たに発見したオーナーのuserKeyをOWNER_USER_KEYSに自動追加
  var newKeysAdded = [];
  for (var nk in ownerKeysCandidates) {
    if (!ownerKeys[nk]) {
      ownerKeys[nk] = true;
      newKeysAdded.push(nk);
    }
  }
  if (newKeysAdded.length > 0) {
    var allKeys = Object.keys(ownerKeys).filter(Boolean).join(',');
    props.setProperty('OWNER_USER_KEYS', allKeys);
    console.log('OWNER_USER_KEYS に自動追加: ' + newKeysAdded.join(', '));
  }

  // バッチ削除: 残す行だけフィルタして一括書き換え（1行ずつdeleteRowするより高速）
  if (deleteRows.length > 0) {
    var deleteSet = {};
    for (var j = 0; j < deleteRows.length; j++) deleteSet[deleteRows[j]] = true;
    var keepData = [];
    for (var k = 0; k < data.length; k++) {
      if (!deleteSet[k + 2]) keepData.push(data[k]);
    }
    // データ行をクリアして残す行を書き込み
    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, 12).clearContent();
    }
    if (keepData.length > 0) {
      sheet.getRange(2, 1, keepData.length, 12).setValues(keepData);
    }
  }

  console.log('クリーンアップ完了: ' + deleteRows.length + '行削除 / ' + data.length + '行中');
  if (newKeysAdded.length > 0) console.log('新規オーナーキー: ' + newKeysAdded.length + '件追加');
  return { ok: true, deleted: deleteRows.length, total: data.length, newOwnerKeys: newKeysAdded };
}

function appendLogRow_(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(String(_logConfig.id).trim());
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.getRange(1, 1, 1, 12).setValues([[
        "timestamp",
        "date",
        "hour",
        "page",
        "userKey",
        "url",
        "referrer",
        "userAgent",
        "language",
        "screen",
        "email",
        "raw"
      ]]);
      sheet.setFrozenRows(1);
    }
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, 12).setValues([row]);
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// CSRFトークン管理
// =====================================================

/**
 * CSRFトークンを発行するAPI
 * フロントエンドはページロード時にこのAPIを呼び出し、
 * 以降のmutation APIリクエストにcsrfTokenを含める。
 * @param {string} userKey
 * @return {object} { ok, csrfToken }
 */
function apiGetCsrfToken(userKey) {
  var uk = String(userKey || '').trim();
  if (!uk) return { ok: false, message: 'userKeyが不正です' };

  var token = generateRandomId_(AUTH_CONSTANTS.CSRF_TOKEN_LENGTH);
  var cache = CacheService.getScriptCache();
  var key = 'CSRF:' + uk;
  cache.put(key, token, AUTH_CONSTANTS.CSRF_TOKEN_EXPIRY_SEC);

  return { ok: true, csrfToken: token };
}

/**
 * CSRFトークンを検証
 * @param {string} userKey
 * @param {string} token - クライアントから送信されたCSRFトークン
 * @return {boolean}
 */
function verifyCsrfToken_(userKey, token) {
  if (!userKey || !token) return false;
  var cache = CacheService.getScriptCache();
  var key = 'CSRF:' + userKey;
  var stored = cache.get(key);
  if (!stored) return false;
  return timingSafeEqual_(stored, token);
}

// =====================================================
// HTMLテンプレートインクルード
// =====================================================

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
