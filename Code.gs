const LOG_SPREADSHEET_ID = "1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc";
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
    console.log('doPost: action=' + action + ' adminKey=' + String(body.adminKey || '(none)'));

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
      // 顧客認証API
      'apiRegisterCustomer': apiRegisterCustomer,
      'apiLoginCustomer': apiLoginCustomer,
      'apiValidateSession': apiValidateSession,
      'apiLogoutCustomer': apiLogoutCustomer,
      // KOMOJU決済API
      'apiCreateKomojuSession': apiCreateKomojuSession,
      'apiCheckPaymentStatus': apiCheckPaymentStatus
    };

    var fn = allowed[action];
    if (!fn) {
      return jsonResponse_({ ok: false, message: '不明なアクション: ' + action });
    }

    // レート制限チェック（userKeyはargsの第1引数に入っている想定）
    var userKey = (args.length > 0 && typeof args[0] === 'string') ? args[0] : '';
    var adminKeyFromBody = String(body.adminKey || '');
    var storedAdminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
    var isAdmin = (storedAdminKey !== '' && adminKeyFromBody === storedAdminKey);

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
  'apiRegisterCustomer': { max: 3, windowSec: 3600, label: '登録は1時間に3回まで' }
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
  if (!secret) return true;  // 未設定ならスキップ
  if (!token) {
    console.warn('reCAPTCHA token empty — client may not have loaded reCAPTCHA. Allowing request (availability first).');
    return true;
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
    console.log('reCAPTCHA verify: success=' + json.success + ' score=' + json.score + ' hostname=' + json.hostname + ' errors=' + JSON.stringify(json['error-codes'] || []));
    // スコアが十分に低い場合(0.1未満)のみブロック。それ以外はレート制限で保護されているため通す
    if (json.success === true && (json.score || 0) < 0.1) {
      return false;
    }
    return true;
  } catch (e) {
    console.warn('reCAPTCHA fetch error: ' + e);
    return true;  // 検証失敗時は通す（可用性優先）
  }
}

// =====================================================
// 管理者判定（レート制限・reCAPTCHAをスキップ）
// =====================================================

function isAdminUser_(body) {
  var adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
  var sent = String(body.adminKey || '');
  console.log('isAdminUser_ check: sent="' + sent + '" stored="' + adminKey + '" match=' + (sent === adminKey));
  if (!adminKey) return false;
  return sent === adminKey;
}

/**
 * 管理者キーを設定（GASエディタで1回だけ実行）
 * ★ 下の 'my-secret-key-123' を好きなキーに変えてから実行
 */
function setAdminKey() {
  var key = 'my-secret-key-123';  // ← ここを変更してから実行
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', key);
  console.log('ADMIN_KEY を設定しました: ' + key);
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
