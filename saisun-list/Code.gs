// APP_CONFIG.data.spreadsheetId と同じスプレッドシートをログ先に使用
var LOG_SPREADSHEET_ID = String(APP_CONFIG.data.spreadsheetId || '');
const LOG_SHEET_NAME = "アクセスログ";

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

  // まとめ商品LP（?page=bulk）
  if (String(p.page || '') === 'bulk') {
    var tBulk = HtmlService.createTemplateFromFile('BulkLP');
    tBulk.appTitle = APP_CONFIG.appTitle;
    return tBulk.evaluate()
      .setTitle(APP_CONFIG.appTitle + ' - まとめ商品')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }

  // まとめ商品 管理画面（?page=bulk-admin）
  if (String(p.page || '') === 'bulk-admin') {
    var tBulkAdmin = HtmlService.createTemplateFromFile('BulkAdminModal');
    tBulkAdmin.appTitle = APP_CONFIG.appTitle;
    return tBulkAdmin.evaluate()
      .setTitle(APP_CONFIG.appTitle + ' - まとめ商品管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }

  var tplName = (String(p.admin || '') === '1') ? 'Admin' : 'Index';

  var t = HtmlService.createTemplateFromFile(tplName);
  t.appTitle = APP_CONFIG.appTitle;
  t.topNotes = (APP_CONFIG.uiText && Array.isArray(APP_CONFIG.uiText.notes)) ? APP_CONFIG.uiText.notes : [];
  t.me = String(p.me || '');

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

    // 許可されたAPI関数のマップ
    var allowed = {
      'apiGetCachedProducts': apiGetCachedProducts,
      'apiInit': apiInit,
      'apiSearch': apiSearch,
      'apiGetStatusDigest': apiGetStatusDigest,
      'apiSyncHolds': apiSyncHolds,
      'apiSubmitEstimate': apiSubmitEstimate,
      'apiGetProductDetail': apiGetProductDetail,
      'apiGetAllDetails': apiGetAllDetails,
      'apiRefreshOpenState': apiRefreshOpenState,
      'apiLogPV': apiLogPV,
      // お問い合わせ
      'apiSendContactForm': apiSendContactForm,
      // 顧客認証API
      'apiRegisterCustomer': apiRegisterCustomer,
      'apiLoginCustomer': apiLoginCustomer,
      'apiValidateSession': apiValidateSession,
      'apiLogoutCustomer': apiLogoutCustomer,
      'apiUpdateCustomerProfile': apiUpdateCustomerProfile,
      'apiRequestPasswordReset': apiRequestPasswordReset,
      'apiRecoverEmail': apiRecoverEmail,
      'apiChangePassword': apiChangePassword,
      'apiGetMyPage': apiGetMyPage,
      // KOMOJU決済API
      'apiCreateKomojuSession': apiCreateKomojuSession,
      'apiCheckPaymentStatus': apiCheckPaymentStatus,
      'apiCancelOrder': apiCancelOrder,
      // CSRFトークン発行
      'apiGetCsrfToken': apiGetCsrfToken,
      // まとめ商品API
      'apiBulkInit': apiBulkInit,
      'apiBulkSubmit': apiBulkSubmit,
      // AIチャットボット
      'apiChatbot': apiChatbot,
      // クーポン検証
      'apiValidateCoupon': apiValidateCoupon,
      // 管理者用: 既存受付番号に商品選択を紐付け
      'apiAdminLinkOrder': apiAdminLinkOrder,
      // まとめ商品管理
      'apiBulkAdminInit': apiBulkAdminInit,
      'apiBulkAdminNewId': apiBulkAdminNewId,
      'apiBulkAdminSave': apiBulkAdminSave,
      'apiBulkAdminDelete': apiBulkAdminDelete,
      'apiBulkAdminGetOAuthToken': apiBulkAdminGetOAuthToken,
      'apiBulkAdminGetDriveImageUrl': apiBulkAdminGetDriveImageUrl
    };

    var fn = allowed[action];
    if (!fn) {
      return jsonResponse_({ ok: false, message: '不明なアクション: ' + action });
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
  'apiRecoverEmail': { max: 5, windowSec: 3600, label: 'メールアドレス確認は1時間に5回まで' }
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

  // GASモード: オーナーのアクセスはログしない（メールアドレスで判定）
  try {
    var ownerEmail = String(PropertiesService.getScriptProperties().getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim().toLowerCase();
    if (ownerEmail) {
      var activeEmail = String((Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : '') || '').trim().toLowerCase();
      if (activeEmail && activeEmail === ownerEmail) return { ok: true, skipped: true };
    }
  } catch(e) { console.log('optional: owner email check: ' + (e.message || e)); }

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
    "",
    ""
  ];

  appendLogRow_(row);
  return { ok: true };
}

/**
 * 既存アクセスログからオーナー＆ボットの行を一括削除
 * ★ GASエディタから1回だけ実行してください
 */
function ad_cleanAccessLog() {
  var ss = SpreadsheetApp.openById(String(LOG_SPREADSHEET_ID).trim());
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) { console.log('アクセスログシートが見つかりません'); return; }
  var last = sheet.getLastRow();
  if (last < 2) { console.log('データなし'); return; }
  var data = sheet.getRange(2, 1, last - 1, 12).getValues();

  // オーナーのuserKey（Script Propertiesから取得）
  var ownerKeys = {};
  try {
    var ownerKeysRaw = PropertiesService.getScriptProperties().getProperty('OWNER_USER_KEYS') || '';
    if (ownerKeysRaw) {
      ownerKeysRaw.split(',').forEach(function(k) { if (k.trim()) ownerKeys[k.trim()] = true; });
    }
  } catch (e) { console.log('optional: owner keys read: ' + (e.message || e)); }

  var botUaRe = /headlesschrome|google-read-aloud|bot|crawl|spider|slurp/i;
  var botScreens = { '0x0': true, '2000x2000': true, '400x400': true };
  var suspectLangs = { 'en-US@posix': true, 'es-ES': true, 'it-IT': true };

  var deleteRows = [];
  for (var i = 0; i < data.length; i++) {
    var userKey = String(data[i][4] || '');
    var ua      = String(data[i][7] || '');
    var lang    = String(data[i][8] || '');
    var scr     = String(data[i][9] || '');

    var remove = false;

    // オーナーのuserKey
    if (ownerKeys[userKey]) remove = true;

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
  return { ok: true, deleted: deleteRows.length, total: data.length };
}

function appendLogRow_(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(String(LOG_SPREADSHEET_ID).trim());
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
        "queryParams",
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
