// Code.gs
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
      'apiGetProductDetail', 'apiGetAllDetails', 'apiRefreshOpenState',
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
      // Phase 3: リテンション/LTV向上
      'apiUnsubscribeNewsletter', 'apiGetReferralCode', 'apiApplyReferralCode',
      // Phase 4: インフラ/アナリティクス
      'apiSubmitReview', 'apiGetReviews',
      'apiGetAdsConfig', 'apiGetMetaConfig', 'apiGetSitemap',
      'apiLineLinkAccount', 'apiGetABTestVariant', 'apiTrackABTestEvent',
      // 管理者専用API（adminKey認証必須）
      'adminGetKomojuMode', 'adminToggleKomojuMode',
      'adminGetMemberDiscountStatus', 'adminToggleMemberDiscount',
      'adminRebuildStates', 'adminApplyStatusDropdown',
      'adminClearProductsCache', 'adminCompactHolds',
      'adminTestEmails',
      'adminApproveReview', 'adminGetRFMSummary',
      'adminGetProductAnalytics', 'adminGetABTestResults'
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
        'apiCreateKomojuSession', 'apiCancelOrder',
        'apiSubmitReview', 'apiApplyReferralCode', 'apiLineLinkAccount'
      ];
      if (csrfProtectedActions.indexOf(action) !== -1) {
        var csrfToken = String(body.csrfToken || '');
        if (!verifyCsrfToken_(userKey, csrfToken)) {
          return jsonResponse_({ ok: false, message: '不正なリクエストです。ページを再読み込みしてください。' });
        }
      }
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
  'apiGetArticleContent': { max: 30, windowSec: 60, label: '記事閲覧は1分に30回まで' },
  'apiSubmitReview':      { max: 3, windowSec: 3600, label: 'レビュー投稿は1時間に3回まで' },
  'apiApplyReferralCode': { max: 5, windowSec: 3600, label: '紹介コード適用は1時間に5回まで' },
  'apiGetReferralCode':   { max: 10, windowSec: 60, label: '紹介コード取得は1分に10回まで' },
  'apiTrackABTestEvent':  { max: 30, windowSec: 60, label: 'ABテストイベントは1分に30回まで' }
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
