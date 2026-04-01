// AdminPanelApi.gs — 管理パネル用サーバーサイドAPI

/**
 * 管理パネルをモーダルダイアログで表示
 */
function showAdminPanel() {
  var html = HtmlService.createHtmlOutputFromFile('AdminPanel')
    .setWidth(920)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '管理パネル');
}

// =====================================================
// console.log キャプチャ（Debug関数のUI転送用）
// =====================================================

function captureConsoleLog_(fn) {
  var logs = [];
  var origLog = console.log;
  var origWarn = console.warn;
  var origError = console.error;
  console.log = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    logs.push(msg);
    origLog.apply(console, arguments);
  };
  console.warn = function() {
    var msg = '[WARN] ' + Array.prototype.slice.call(arguments).join(' ');
    logs.push(msg);
    origWarn.apply(console, arguments);
  };
  console.error = function() {
    var msg = '[ERROR] ' + Array.prototype.slice.call(arguments).join(' ');
    logs.push(msg);
    origError.apply(console, arguments);
  };
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return { ok: true, logs: logs };
}

// =====================================================
// スクリプトプロパティ CRUD
// =====================================================

var AP_SECRET_PATTERNS_ = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'HASH'];

function adminPanel_getProperties() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var result = {};
  var keys = Object.keys(props).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    // 内部状態キーは除外
    if (k.indexOf('STATE_') === 0 || k.indexOf('PENDING_ORDER_') === 0 || k.indexOf('PAYMENT_') === 0) continue;
    if (k.indexOf('CALLS_') === 0 || k.indexOf('ATTEMPTS_') === 0 || k.indexOf('BACKOFF_') === 0) continue;
    if (k.indexOf('BATCH_EXPAND_') === 0) continue;

    var isSecret = false;
    var kUpper = k.toUpperCase();
    for (var s = 0; s < AP_SECRET_PATTERNS_.length; s++) {
      if (kUpper.indexOf(AP_SECRET_PATTERNS_[s]) !== -1) { isSecret = true; break; }
    }
    result[k] = {
      value: isSecret ? '' : props[k],
      masked: isSecret,
      hasValue: !!props[k]
    };
  }
  return { ok: true, props: result };
}

function adminPanel_setProperties(updates) {
  if (!updates || typeof updates !== 'object') return { ok: false, message: '無効なデータ' };
  var props = PropertiesService.getScriptProperties();
  var changed = 0;
  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = updates[k];
    if (v === '__DELETE__') {
      props.deleteProperty(k);
      changed++;
    } else if (v !== null && v !== undefined && v !== '') {
      props.setProperty(k, String(v));
      changed++;
    }
    // 空文字は変更なし（既存値維持）
  }
  return { ok: true, message: changed + '件のプロパティを更新しました' };
}

// =====================================================
// 管理ツール（既存関数のラッパー）
// =====================================================

function adminPanel_compactHolds() {
  try { od_compactHolds_(); return { ok: true, message: '期限切れ確保を整理しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_rebuildStates() {
  try {
    var orderSs = sh_getOrderSs_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return { ok: false, message: 'ロック取得失敗' };
    try {
      var nowMs = u_nowMs_();
      var hold = od_rebuildHoldStateFromSheet_(orderSs);
      var open = od_rebuildOpenStateFromRequestSheet_(orderSs);
      hold.updatedAt = nowMs;
      open.updatedAt = nowMs;
      st_setHoldState_(orderSs, hold);
      st_setOpenState_(orderSs, open);
      st_invalidateStatusCache_(orderSs);
      return { ok: true, message: '状態を再構築しました' };
    } finally { lock.releaseLock(); }
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_clearCache() {
  try {
    pr_bumpProductsVersion_();
    pr_clearProductsCache_();
    return { ok: true, message: '商品キャッシュを削除しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_applyDropdown() {
  try {
    var orderSs = sh_getOrderSs_();
    sh_applyRequestStatusDropdown_(orderSs);
    return { ok: true, message: 'プルダウンを適用しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// 業務操作
// =====================================================

function adminPanel_processPoints() {
  try { processCustomerPointsAuto_(); return { ok: true, message: '顧客ポイントを付与しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_processInvoices() {
  try { processInvoiceReceipts(); return { ok: true, message: '領収書を送付しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_cancelInvoices() {
  try { processCancelledInvoices(); return { ok: true, message: '領収書取消を処理しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// トリガー管理
// =====================================================

function adminPanel_listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var list = [];
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    list.push({
      id: t.getUniqueId(),
      fn: t.getHandlerFunction(),
      type: String(t.getEventType()),
      source: String(t.getTriggerSource())
    });
  }
  return { ok: true, triggers: list };
}

function adminPanel_rebuildTriggers() {
  try {
    setupTriggers();
    return { ok: true, message: 'トリガーを再構築しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_deleteTrigger(triggerId) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(triggers[i]);
      return { ok: true, message: 'トリガーを削除しました: ' + triggers[i].getHandlerFunction() };
    }
  }
  return { ok: false, message: 'トリガーが見つかりません' };
}

// =====================================================
// キャンペーン・割引管理
// =====================================================

function adminPanel_getCampaignStatus() {
  var md = app_getMemberDiscountStatus_();
  var fhp = app_getFirstHalfPriceStatus_();
  var sns = app_getSnsShareCampaignStatus_ ? app_getSnsShareCampaignStatus_() : { enabled: false };
  return { ok: true, memberDiscount: md, firstHalfPrice: fhp, snsShare: sns };
}

function adminPanel_updateCampaign(type, settings) {
  var props = PropertiesService.getScriptProperties();
  if (type === 'memberDiscount') {
    if (settings.enabled !== undefined) props.setProperty('MEMBER_DISCOUNT_ENABLED', String(settings.enabled));
    if (settings.rate !== undefined) props.setProperty('MEMBER_DISCOUNT_RATE', String(settings.rate));
    if (settings.endDate !== undefined) props.setProperty('MEMBER_DISCOUNT_END_DATE', String(settings.endDate));
  } else if (type === 'firstHalfPrice') {
    if (settings.enabled !== undefined) props.setProperty('FIRST_HALF_PRICE_ENABLED', String(settings.enabled));
    if (settings.rate !== undefined) props.setProperty('FIRST_HALF_PRICE_RATE', String(settings.rate));
    if (settings.endDate !== undefined) props.setProperty('FIRST_HALF_PRICE_END_DATE', String(settings.endDate));
  } else if (type === 'snsShare') {
    if (settings.enabled !== undefined) props.setProperty('SNS_SHARE_CAMPAIGN_ENABLED', String(settings.enabled));
    if (settings.endDate !== undefined) props.setProperty('SNS_SHARE_CAMPAIGN_END_DATE', String(settings.endDate));
  }
  return adminPanel_getCampaignStatus();
}

// =====================================================
// キャンペーンON/OFFトグル
// =====================================================

function adminPanel_toggleCampaign(type) {
  var props = PropertiesService.getScriptProperties();
  if (type === 'memberDiscount') {
    var cur = props.getProperty('MEMBER_DISCOUNT_ENABLED');
    props.setProperty('MEMBER_DISCOUNT_ENABLED', cur === 'false' ? 'true' : 'false');
  } else if (type === 'firstHalfPrice') {
    var cur2 = props.getProperty('FIRST_HALF_PRICE_ENABLED');
    props.setProperty('FIRST_HALF_PRICE_ENABLED', cur2 === 'false' ? 'true' : 'false');
  } else if (type === 'snsShare') {
    var cur3 = props.getProperty('SNS_SHARE_CAMPAIGN_ENABLED');
    props.setProperty('SNS_SHARE_CAMPAIGN_ENABLED', cur3 === 'false' ? 'true' : 'false');
  }
  return { ok: true };
}

// =====================================================
// 数量割引テーブル（ScriptProperties外出し）
// =====================================================

var QTY_DISCOUNT_DEFAULTS_ = [
  { threshold: 100, rate: 0.20 },
  { threshold: 50, rate: 0.15 },
  { threshold: 30, rate: 0.10 },
  { threshold: 10, rate: 0.05 }
];

function adminPanel_getQtyDiscounts() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_QTY_DISCOUNTS');
  if (raw) {
    try { return { ok: true, discounts: JSON.parse(raw) }; } catch (e) {}
  }
  return { ok: true, discounts: QTY_DISCOUNT_DEFAULTS_ };
}

function adminPanel_setQtyDiscounts(discounts) {
  if (!Array.isArray(discounts)) return { ok: false, message: '無効なデータ' };
  PropertiesService.getScriptProperties().setProperty('CONFIG_QTY_DISCOUNTS', JSON.stringify(discounts));
  return { ok: true, message: '数量割引テーブルを保存しました' };
}

// =====================================================
// ビジネス割引設定（送料無料閾値・紹介ポイント）
// =====================================================

function adminPanel_getBizDiscountSettings() {
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    freeShipThreshold: Number(props.getProperty('CONFIG_FREE_SHIP_THRESHOLD') || 10000),
    referralReferrer: Number(props.getProperty('CONFIG_REFERRAL_REFERRER') || 500),
    referralReferee: Number(props.getProperty('CONFIG_REFERRAL_REFEREE') || 300)
  };
}

function adminPanel_setBizDiscountSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.freeShipThreshold !== undefined) props.setProperty('CONFIG_FREE_SHIP_THRESHOLD', String(settings.freeShipThreshold));
  if (settings.referralReferrer !== undefined) props.setProperty('CONFIG_REFERRAL_REFERRER', String(settings.referralReferrer));
  if (settings.referralReferee !== undefined) props.setProperty('CONFIG_REFERRAL_REFEREE', String(settings.referralReferee));
  return { ok: true, message: '設定を保存しました' };
}

// =====================================================
// AI設定管理
// =====================================================

function adminPanel_getAiSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_AI_SETTINGS');
  var s = {};
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  return {
    ok: true,
    chatModel: s.chatModel || 'gpt-5-mini',
    articleModel: s.articleModel || 'gpt-5-mini',
    articleMaxDisplay: s.articleMaxDisplay || 10,
    orderModel: s.orderModel || 'gpt-4o-mini',
    orderBatchSize: s.orderBatchSize || 30
  };
}

function adminPanel_setAiSettings(settings) {
  PropertiesService.getScriptProperties().setProperty('CONFIG_AI_SETTINGS', JSON.stringify(settings));
  return { ok: true, message: 'AI設定を保存しました' };
}

// =====================================================
// ビジネス設定管理
// =====================================================

function adminPanel_getBizSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_BIZ_SETTINGS');
  var s = {};
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  // 送料テーブルは別キー
  var shRaw = PropertiesService.getScriptProperties().getProperty('CONFIG_SHIPPING_RATES');
  var shippingRates = null;
  if (shRaw) { try { shippingRates = JSON.parse(shRaw); } catch (e) {} }
  if (!shippingRates) {
    // Config.gsのデフォルト値
    shippingRates = {
      minami_kyushu:[1320,1700], kita_kyushu:[1280,1620], shikoku:[1180,1440],
      chugoku:[1200,1480], kansai:[1100,1260], hokuriku:[1160,1420],
      tokai:[1180,1440], shinetsu:[1220,1540], kanto:[1300,1680],
      minami_tohoku:[1400,1900], kita_tohoku:[1460,1980], hokkaido:[1640,2380], okinawa:[2500,3500]
    };
  }
  return {
    ok: true,
    settings: {
      minOrderCount: s.minOrderCount || 5,
      holdMinutes: s.holdMinutes || 15,
      holdMemberMinutes: s.holdMemberMinutes || 30,
      taxRate: s.taxRate || 0.10,
      cacheProducts: s.cacheProducts || 21600,
      cacheStatus: s.cacheStatus || 300,
      cacheState: s.cacheState || 3600,
      cacheDetail: s.cacheDetail || 86400,
      sessionHours: s.sessionHours || 24,
      rememberDays: s.rememberDays || 30,
      minPwLength: s.minPwLength || 6,
      csrfExpiry: s.csrfExpiry || 3600,
      paymentExpiry: s.paymentExpiry || 259200,
      shippingRates: shippingRates
    }
  };
}

function adminPanel_setBizSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.shippingRates) {
    props.setProperty('CONFIG_SHIPPING_RATES', JSON.stringify(settings.shippingRates));
    delete settings.shippingRates;
  }
  if (Object.keys(settings).length > 0) {
    var raw = props.getProperty('CONFIG_BIZ_SETTINGS');
    var current = {};
    if (raw) { try { current = JSON.parse(raw); } catch (e) {} }
    var keys = Object.keys(settings);
    for (var i = 0; i < keys.length; i++) current[keys[i]] = settings[keys[i]];
    props.setProperty('CONFIG_BIZ_SETTINGS', JSON.stringify(current));
  }
  return { ok: true, message: 'ビジネス設定を保存しました' };
}

// =====================================================
// BASE連携
// =====================================================

function adminPanel_getBaseSettings() {
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    clientId: props.getProperty('BASE_CLIENT_ID') || '',
    redirectUri: props.getProperty('BASE_REDIRECT_URI') || '',
    shopId: props.getProperty('BASE_SHOP_ID') || '',
    syncDays: Number(props.getProperty('CONFIG_BASE_SYNC_DAYS') || 30),
    syncBuffer: Number(props.getProperty('CONFIG_BASE_SYNC_BUFFER') || 7),
    syncLimit: Number(props.getProperty('CONFIG_BASE_SYNC_LIMIT') || 100)
  };
}

function adminPanel_baseReauth() {
  try {
    if (typeof baseShowAuthUrl === 'function') {
      baseShowAuthUrl();
      return { ok: true, message: '認証URLをダイアログに表示しました' };
    }
    return { ok: false, message: 'baseShowAuthUrl関数が見つかりません' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_baseSyncNow() {
  try {
    baseSyncOrdersNow();
    return { ok: true, message: 'BASE注文同期を実行しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// GA4/分析/広告
// =====================================================

function adminPanel_getGa4Settings() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_GA4_SETTINGS');
  var s = {};
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    propertyId: s.propertyId || props.getProperty('GA4_PROPERTY_ID') || '',
    days: s.days || 30,
    sigma: s.sigma || 2.0,
    adsConversionId: props.getProperty('GOOGLE_ADS_CONVERSION_ID') || '',
    adsConversionLabel: props.getProperty('GOOGLE_ADS_CONVERSION_LABEL') || '',
    metaPixelId: props.getProperty('META_PIXEL_ID') || ''
  };
}

function adminPanel_setGa4Settings(settings) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CONFIG_GA4_SETTINGS', JSON.stringify({
    propertyId: settings.propertyId, days: settings.days, sigma: settings.sigma
  }));
  if (settings.adsConversionId !== undefined) props.setProperty('GOOGLE_ADS_CONVERSION_ID', settings.adsConversionId);
  if (settings.adsConversionLabel !== undefined) props.setProperty('GOOGLE_ADS_CONVERSION_LABEL', settings.adsConversionLabel);
  if (settings.metaPixelId !== undefined) props.setProperty('META_PIXEL_ID', settings.metaPixelId);
  return { ok: true, message: 'GA4/広告設定を保存しました' };
}

function adminPanel_runRfm() {
  try { if (typeof rfm_runAnalysis_ === 'function') { rfm_runAnalysis_(); return { ok: true, message: 'RFM分析を実行しました' }; } return { ok: false, message: '関数なし' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_runProductAnalytics() {
  try { if (typeof pa_runAnalysis_ === 'function') { pa_runAnalysis_(); return { ok: true, message: '商品分析を実行しました' }; } return { ok: false, message: '関数なし' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// クーポン管理
// =====================================================

function adminPanel_getCoupons() {
  try {
    var orderSs = sh_getOrderSs_();
    var sh = orderSs.getSheetByName('クーポン管理');
    if (!sh) return { ok: true, coupons: [] };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, coupons: [] };
    var data = sh.getRange(2, 1, lastRow - 1, 18).getDisplayValues();
    var coupons = [];
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      coupons.push({
        code: data[i][0], type: data[i][1], value: data[i][2], expiry: data[i][3],
        limit: data[i][4] || '0', used: data[i][5] || '0', active: data[i][7] || 'TRUE'
      });
    }
    return { ok: true, coupons: coupons };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_registerCoupon(params) {
  try {
    var orderSs = sh_getOrderSs_();
    var sh = orderSs.getSheetByName('クーポン管理');
    if (!sh) return { ok: false, message: 'クーポン管理シートなし' };
    var row = [
      params.code, params.type, params.value, params.expiry, params.limit || 0, 0, '',
      'TRUE', '', '', '', params.comboMember || 'TRUE', params.comboBulk || 'TRUE',
      params.channel || 'all', '', '', params.once || 'FALSE', ''
    ];
    sh.appendRow(row);
    return { ok: true, message: params.code + ' を登録しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_deleteCoupon(code) {
  try {
    var orderSs = sh_getOrderSs_();
    var sh = orderSs.getSheetByName('クーポン管理');
    if (!sh) return { ok: false, message: 'シートなし' };
    var lastRow = sh.getLastRow();
    for (var i = lastRow; i >= 2; i--) {
      if (sh.getRange(i, 1).getDisplayValue().trim() === code) {
        sh.deleteRow(i);
        return { ok: true, message: code + ' を削除しました' };
      }
    }
    return { ok: false, message: 'クーポンが見つかりません' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// ニュースレター管理
// =====================================================

function adminPanel_getNewsletters() {
  try {
    var orderSs = sh_getOrderSs_();
    var sh = orderSs.getSheetByName('ニュースレター');
    if (!sh) return { ok: true, newsletters: [] };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, newsletters: [] };
    var data = sh.getRange(2, 1, lastRow - 1, 7).getDisplayValues();
    var list = [];
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      list.push({
        title: data[i][0], status: data[i][3] || '未配信',
        frequency: data[i][4] || '一度', target: data[i][6] || '全員',
        scheduleDate: data[i][2] || ''
      });
    }
    return { ok: true, newsletters: list };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_registerNewsletter(params) {
  try {
    if (typeof saveNewsletter_ === 'function') {
      saveNewsletter_(params.title, params.body, params.schedule, params.target, params.frequency);
      return { ok: true, message: 'ニュースレターを登録しました' };
    }
    return { ok: false, message: 'saveNewsletter_関数なし' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_testNewsletter(params) {
  try {
    var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
    if (!adminEmail) return { ok: false, message: 'ADMIN_OWNER_EMAILが未設定' };
    MailApp.sendEmail({ to: adminEmail, subject: '[テスト] ' + (params.title || 'ニュースレター'), body: params.body || '', noReply: true });
    return { ok: true, message: adminEmail + 'にテスト送信しました' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// KOMOJU決済モード
// =====================================================

function adminPanel_getKomojuMode() {
  return adminGetKomojuMode();
}

function adminPanel_toggleKomojuMode() {
  return adminToggleKomojuMode();
}

// =====================================================
// メール設定管理
// =====================================================

var MAIL_SETTINGS_KEY_ = 'CONFIG_MAIL_SETTINGS';

function adminPanel_getMailSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty(MAIL_SETTINGS_KEY_);
  var settings = {};
  if (raw) { try { settings = JSON.parse(raw); } catch (e) {} }

  // デフォルト値のマージ
  var defaults = {
    subjectPrefix: '【デタウリ.Detauri】',
    siteName: 'デタウリ.Detauri',
    siteUrl: PropertiesService.getScriptProperties().getProperty('SITE_URL') || 'https://wholesale.nkonline-tool.com/',
    contactEmail: PropertiesService.getScriptProperties().getProperty('CONTACT_EMAIL') || '',
    bizName: '', bizRegNo: '', bizAddress: '', bizPhone: '',
    paymentDeadlineDays: 3, cancelGraceDays: 1,
    followupMinDays: 7, followupMaxDays: 30,
    pointExpiryMonths: 12, pointExpiryWarnDays: 30,
    cartRemindIntervalHours: 24,
    newArrivalCount: 5,
    weeklyDays: '2,4,6',
    dormant2mDays: 60, dormant6mDays: 180, dormant1yDays: 365, dormantRate: 0.10,
    pwResetExpiryMin: 30,
    subjects: {}
  };

  var merged = {};
  var dKeys = Object.keys(defaults);
  for (var i = 0; i < dKeys.length; i++) {
    var k = dKeys[i];
    merged[k] = (settings[k] !== undefined && settings[k] !== null) ? settings[k] : defaults[k];
  }
  // subjectsは深いマージ
  if (settings.subjects) {
    merged.subjects = settings.subjects;
  }
  return { ok: true, settings: merged };
}

function adminPanel_setMailSettings(updates) {
  if (!updates || typeof updates !== 'object') return { ok: false, message: '無効なデータ' };
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MAIL_SETTINGS_KEY_);
  var current = {};
  if (raw) { try { current = JSON.parse(raw); } catch (e) {} }

  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'subjects' && typeof updates[k] === 'object') {
      // subjectsは深いマージ
      if (!current.subjects) current.subjects = {};
      var sKeys = Object.keys(updates[k]);
      for (var j = 0; j < sKeys.length; j++) {
        current.subjects[sKeys[j]] = updates[k][sKeys[j]];
      }
    } else {
      current[k] = updates[k];
    }
  }
  props.setProperty(MAIL_SETTINGS_KEY_, JSON.stringify(current));
  return { ok: true, message: 'メール設定を保存しました' };
}

function adminPanel_testEmails() {
  try {
    if (typeof adminTestEmails === 'function') {
      adminTestEmails();
      return { ok: true, message: 'テストメールを送信しました' };
    }
    return { ok: false, message: 'adminTestEmails関数が見つかりません' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// デバッグツール（パラメータ化ラッパー）
// =====================================================

function adminPanel_debugLookupByReceipt(receiptNo) {
  return captureConsoleLog_(function() { debugLookupByReceipt(receiptNo); });
}

function adminPanel_debugLookupByManagedId(managedId) {
  return captureConsoleLog_(function() { debugLookupByManagedId(managedId); });
}

function adminPanel_debugSearch(keyword) {
  return captureConsoleLog_(function() { debugSearch(keyword); });
}

function adminPanel_debugSearchByAmount(amount, dateFrom, dateTo) {
  return captureConsoleLog_(function() { debugSearchByAmount(amount, dateFrom, dateTo); });
}

function adminPanel_debugResendOrderEmail(receiptNo) {
  return captureConsoleLog_(function() { debugResendOrderEmail(receiptNo); });
}

function adminPanel_debugFixOrderRow(receiptNo) {
  return captureConsoleLog_(function() { debugFixOrderRow(receiptNo); });
}

function adminPanel_debugRestoreOrder(params) {
  return captureConsoleLog_(function() { debugRestoreOrder(params); });
}

function adminPanel_debugRestoreFromSaleLog(receiptNo) {
  return captureConsoleLog_(function() { debugRestoreFromSaleLog(receiptNo); });
}

function adminPanel_debugBulkMarkSold(ids, boValue) {
  return captureConsoleLog_(function() { debugBulkMarkSold(ids, boValue); });
}

function adminPanel_debugPaidyPayment() {
  return captureConsoleLog_(function() { debugPaidyPayment(); });
}

function adminPanel_debugKomojuSession() {
  return captureConsoleLog_(function() { debugKomojuSession(); });
}

function adminPanel_debugViewQueues() {
  return captureConsoleLog_(function() { debugViewQueues(); });
}

function adminPanel_debugViewStates() {
  return captureConsoleLog_(function() { debugViewStates(); });
}

function adminPanel_createDemoDistributionList() {
  return captureConsoleLog_(function() { createDemoDistributionList(); });
}
