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
// KOMOJU決済モード
// =====================================================

function adminPanel_getKomojuMode() {
  return adminGetKomojuMode();
}

function adminPanel_toggleKomojuMode() {
  return adminToggleKomojuMode();
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
