const LOG_SPREADSHEET_ID = "1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc";
const LOG_SHEET_NAME = "アクセスログ";

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  if (p.code || p.error) {
    return baseHandleOAuthCallback_(e);
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
      'apiLogPV': apiLogPV
    };

    var fn = allowed[action];
    if (!fn) {
      return jsonResponse_({ ok: false, message: '不明なアクション: ' + action });
    }

    // レート制限チェック（userKeyはargsの第1引数に入っている想定）
    var userKey = (args.length > 0 && typeof args[0] === 'string') ? args[0] : '';
    var rateErr = checkRateLimit_(action, userKey);
    if (rateErr) {
      return jsonResponse_({ ok: false, message: rateErr });
    }

    // reCAPTCHA検証（送信時のみ）
    if (action === 'apiSubmitEstimate') {
      var token = String(body.recaptchaToken || '');
      if (!verifyRecaptcha_(token)) {
        return jsonResponse_({ ok: false, message: 'bot判定されました。ページを再読み込みしてお試しください。' });
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
  'apiSubmitEstimate': { max: 3, windowSec: 3600, label: '見積もり送信は1時間に3回まで' },
  'apiSyncHolds':     { max: 30, windowSec: 60,   label: '確保操作は1分に30回まで' }
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

var RECAPTCHA_SECRET_KEY = '';  // ★ Google reCAPTCHA v3のシークレットキーを設定

function verifyRecaptcha_(token) {
  if (!RECAPTCHA_SECRET_KEY) return true;  // 未設定ならスキップ
  if (!token) return false;

  try {
    var res = UrlFetchApp.fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'post',
      payload: {
        secret: RECAPTCHA_SECRET_KEY,
        response: token
      },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText());
    return json.success === true && (json.score || 0) >= 0.3;
  } catch (e) {
    return true;  // 検証失敗時は通す（可用性優先）
  }
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
