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
      // KOMOJU決済API
      'apiCreateKomojuSession': apiCreateKomojuSession,
      'apiCheckPaymentStatus': apiCheckPaymentStatus,
      'apiCancelOrder': apiCancelOrder
    };

    var fn = allowed[action];
    if (!fn) {
      return jsonResponse_({ ok: false, message: '不明なアクション: ' + action });
    }

    // レート制限チェック（userKeyはargsの第1引数に入っている想定）
    var userKey = (args.length > 0 && typeof args[0] === 'string') ? args[0] : '';
    var adminKeyFromBody = String(body.adminKey || '');
    var storedAdminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
    var isAdmin = (storedAdminKey !== '' && timingSafeEqual_(adminKeyFromBody, storedAdminKey));

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
  'apiSubmitEstimate': { max: 5, windowSec: 3600, label: '注文は1時間に5回まで' },
  'apiSyncHolds':     { max: 30, windowSec: 60,   label: '確保操作は1分に30回まで' },
  'apiLoginCustomer': { max: 5, windowSec: 3600, label: 'ログインは1時間に5回まで' },
  'apiRegisterCustomer': { max: 3, windowSec: 3600, label: '登録は1時間に3回まで' },
  'apiSendContactForm': { max: 3, windowSec: 3600, label: 'お問い合わせは1時間に3回まで' }
};

function checkRateLimit_(action, userKey) {
  var rule = RATE_LIMITS[action];
  if (!rule || !userKey) return null;

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
    console.warn('RECAPTCHA_SECRET が未設定です。reCAPTCHA検証をスキップします。');
    return true;  // 未設定ならスキップ（開発環境対応）
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

    // スコアが 0.3 未満はbot判定で拒否
    if ((json.score || 0) < 0.3) {
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

function isAdminUser_(body) {
  var adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
  var sent = String(body.adminKey || '');
  if (!adminKey) return false;
  // タイミングセーフな比較を使用
  return timingSafeEqual_(sent, adminKey);
}

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
