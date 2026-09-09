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
  var orig = console;
  console = {
    log: function() { var m = [].slice.call(arguments).join(' '); logs.push(m); orig.log.apply(orig, arguments); },
    warn: function() { var m = '[WARN] ' + [].slice.call(arguments).join(' '); logs.push(m); orig.warn.apply(orig, arguments); },
    error: function() { var m = '[ERROR] ' + [].slice.call(arguments).join(' '); logs.push(m); orig.error.apply(orig, arguments); },
    info: function() { var m = [].slice.call(arguments).join(' '); logs.push(m); orig.info.apply(orig, arguments); },
    time: function(){}, timeEnd: function(){}
  };
  try {
    fn();
  } finally {
    console = orig;
  }
  return { ok: true, logs: logs };
}

// =====================================================
// スクリプトプロパティ CRUD
// =====================================================

var AP_SECRET_PATTERNS_ = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'HASH'];

/** 一覧に既定で出さない内部状態キー（「内部キーも表示」で出せる） */
var AP_INTERNAL_PREFIXES_ = ['STATE_', 'PENDING_ORDER_', 'PAYMENT_', 'CALLS_',
  'ATTEMPTS_', 'BACKOFF_', 'BATCH_EXPAND_', 'BREVO_SENT_'];

/** 消すと本番が止まるキー。画面からは削除させない（GASの設定画面からなら可能） */
var AP_PROTECTED_KEYS_ = ['ADMIN_KEY', 'ADMIN_OWNER_EMAIL',
  'KOMOJU_SECRET_KEY', 'KOMOJU_SECRET_KEY_LIVE', 'KOMOJU_SECRET_KEY_TEST', 'KOMOJU_WEBHOOK_SECRET',
  'DATA_SPREADSHEET_ID', 'DETAIL_SPREADSHEET_ID', 'BULK_SPREADSHEET_ID',
  'SYNC_SECRET', 'WORKERS_API_URL',
  'BASE_CLIENT_ID', 'BASE_CLIENT_SECRET', 'BASE_ACCESS_TOKEN', 'BASE_REFRESH_TOKEN'];

/** スクリプトプロパティのストア上限（Apps Scriptの割当: 1ストア合計500KB） */
var AP_PROPS_LIMIT_BYTES_ = 500 * 1024;

/** 掃除の対象にする経過日数（KOMOJUの決済有効期限3日を大きく超えたもの） */
var AP_SWEEP_AGE_DAYS_ = 14;

function ap_isInternalKey_(k) {
  for (var i = 0; i < AP_INTERNAL_PREFIXES_.length; i++) {
    if (k.indexOf(AP_INTERNAL_PREFIXES_[i]) === 0) return true;
  }
  return false;
}

function ap_isSecretKey_(k) {
  var u = String(k).toUpperCase();
  for (var i = 0; i < AP_SECRET_PATTERNS_.length; i++) {
    if (u.indexOf(AP_SECRET_PATTERNS_[i]) !== -1) return true;
  }
  return false;
}

function ap_isProtectedKey_(k) {
  return AP_PROTECTED_KEYS_.indexOf(String(k)) !== -1;
}

/** UTF-8バイト数（ストア使用量の概算に使う） */
function ap_byteLen_(s) {
  s = String(s == null ? '' : s);
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** ストア全体の使用量（件数・バイト数・内部キー分） */
function ap_propsUsage_(allProps) {
  var count = 0, bytes = 0, internalCount = 0, internalBytes = 0;
  for (var k in allProps) {
    var b = ap_byteLen_(k) + ap_byteLen_(allProps[k]);
    count++; bytes += b;
    if (ap_isInternalKey_(k)) { internalCount++; internalBytes += b; }
  }
  return {
    count: count,
    bytes: bytes,
    limitBytes: AP_PROPS_LIMIT_BYTES_,
    percent: Math.round(bytes / AP_PROPS_LIMIT_BYTES_ * 1000) / 10,
    internalCount: internalCount,
    internalBytes: internalBytes
  };
}

function ap_parseJson_(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

/**
 * 掃除対象かどうかを判定し、対象なら理由を返す（対象外は空文字）。
 * 判断できないもの・現役の可能性があるものは必ず空文字を返して残す。
 */
function ap_sweepReason_(k, v, todayKey, cutoffMs) {
  if (k.indexOf('BREVO_SENT_') === 0) {
    return k === todayKey ? '' : '前日以前の送信カウンタ';
  }
  if (k.indexOf('PENDING_ORDER_') === 0) {
    var d = ap_parseJson_(v);
    if (!d) return '壊れた未確定注文データ';
    var ms = Number(d.createdAtMs || 0);
    if (!ms) return '';  // 日時が読めないものは触らない
    return ms < cutoffMs ? AP_SWEEP_AGE_DAYS_ + '日以上前の未確定注文' : '';
  }
  if (k.indexOf('PAYMENT_') === 0) {
    var p = ap_parseJson_(v);
    if (!p) return '壊れた決済セッション';
    var t = Date.parse(p.createdAt || p.created_at || '');
    if (!t) return '';
    return t < cutoffMs ? AP_SWEEP_AGE_DAYS_ + '日以上前の決済セッション' : '';
  }
  return '';
}

/**
 * プロパティ一覧。
 * @param {boolean} [includeInternal] 内部状態キー（PENDING_ORDER_ 等）も含める
 */
function adminPanel_getProperties(includeInternal) {
  var props = PropertiesService.getScriptProperties().getProperties();
  var result = {};
  var internals = [];
  var keys = Object.keys(props).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var val = props[k] || '';

    // 内部状態キーは編集対象にしない。件数・容量・削除だけできるようにする
    if (ap_isInternalKey_(k)) {
      if (includeInternal) {
        internals.push({
          key: k,
          bytes: ap_byteLen_(k) + ap_byteLen_(val),
          preview: val.substring(0, 60)
        });
      }
      continue;
    }

    result[k] = {
      value: val,
      masked: ap_isSecretKey_(k),
      hasValue: !!val,
      bytes: ap_byteLen_(k) + ap_byteLen_(val),
      protected: ap_isProtectedKey_(k)
    };
  }
  internals.sort(function (a, b) { return b.bytes - a.bytes; });
  return { ok: true, props: result, internals: internals, usage: ap_propsUsage_(props) };
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

/**
 * 新しいプロパティを1件登録する。
 * GASの「プロジェクトの設定」画面が上限で使えないときの登録口。
 */
function adminPanel_addProperty(key, value) {
  var k = String(key == null ? '' : key).trim();
  var v = String(value == null ? '' : value).trim();
  if (!k) return { ok: false, message: 'キー名を入力してください' };
  if (!/^[A-Za-z0-9_.\-]{1,120}$/.test(k)) {
    return { ok: false, message: 'キー名は英数字と _ . - のみ（120文字以内）で入力してください' };
  }
  if (!v) return { ok: false, message: '値を入力してください' };

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(k) !== null) {
    return { ok: false, message: '「' + k + '」は既に登録されています。一覧から値を上書きしてください' };
  }
  try {
    props.setProperty(k, v);
  } catch (e) {
    var u = ap_propsUsage_(props.getProperties());
    return {
      ok: false,
      message: '保存できませんでした（' + (e.message || e) + '）\n' +
        '現在の使用量: ' + Math.round(u.bytes / 1024) + 'KB / ' + u.count + '件。' +
        '「不要キーを掃除」で空けてから再実行してください',
      usage: u
    };
  }
  return {
    ok: true,
    message: '「' + k + '」を登録しました',
    usage: ap_propsUsage_(props.getProperties())
  };
}

/**
 * 指定したキーを削除する（保護キーは除外）。
 * @param {string[]|string} keys
 */
function adminPanel_deleteProperties(keys) {
  var list = (keys instanceof Array) ? keys : [keys];
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var deleted = 0, freed = 0, skipped = [], missing = 0;

  for (var i = 0; i < list.length; i++) {
    var k = String(list[i] || '').trim();
    if (!k) continue;
    if (ap_isProtectedKey_(k)) { skipped.push(k); continue; }
    if (!(k in all)) { missing++; continue; }
    freed += ap_byteLen_(k) + ap_byteLen_(all[k]);
    props.deleteProperty(k);
    deleted++;
  }

  var msg = deleted + '件を削除しました（約' + Math.round(freed / 1024 * 10) / 10 + 'KB解放）';
  if (skipped.length) msg += '\n保護キーのため削除しませんでした: ' + skipped.join(', ');
  if (missing) msg += '\n' + missing + '件は既にありませんでした';
  return { ok: true, message: msg, deleted: deleted, freed: freed, usage: ap_propsUsage_(props.getProperties()) };
}

/**
 * 明らかに不要な内部キーをまとめて掃除する。
 * @param {boolean} dryRun true なら削除せず対象を返すだけ
 */
function adminPanel_sweepProperties(dryRun) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var todayKey = '';
  try { todayKey = mail_todayKey_(); } catch (e) { todayKey = ''; }
  var cutoffMs = Date.now() - AP_SWEEP_AGE_DAYS_ * 24 * 60 * 60 * 1000;

  var targets = [];
  var bytes = 0;
  for (var k in all) {
    var reason = ap_sweepReason_(k, all[k], todayKey, cutoffMs);
    if (!reason) continue;
    var b = ap_byteLen_(k) + ap_byteLen_(all[k]);
    bytes += b;
    targets.push({ key: k, reason: reason, bytes: b });
  }
  targets.sort(function (a, b2) { return b2.bytes - a.bytes; });

  if (!dryRun) {
    for (var i = 0; i < targets.length; i++) props.deleteProperty(targets[i].key);
  }

  return {
    ok: true,
    dryRun: !!dryRun,
    count: targets.length,
    bytes: bytes,
    targets: targets.slice(0, 50),
    message: (dryRun ? '掃除対象: ' : '掃除しました: ') +
      targets.length + '件（約' + Math.round(bytes / 1024 * 10) / 10 + 'KB）',
    usage: ap_propsUsage_(props.getProperties())
  };
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

// 数量割引は廃止済み。管理画面互換のため空配列デフォルトを返す
var QTY_DISCOUNT_DEFAULTS_ = [];

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

// 一度だけGASエディタから手動実行: 旧値¥30,000を¥10,000に戻すための一括移行
function migrateFreeShipThresholdTo10000() {
  var props = PropertiesService.getScriptProperties();
  var before = props.getProperty('CONFIG_FREE_SHIP_THRESHOLD');
  props.setProperty('CONFIG_FREE_SHIP_THRESHOLD', '10000');
  console.log('CONFIG_FREE_SHIP_THRESHOLD: ' + before + ' → 10000');
  return { ok: true, before: before, after: '10000' };
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
    chatModel: s.chatModel || 'gpt-5.6-luna',
    articleModel: s.articleModel || 'gpt-5.6-luna',
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
  // 2026-07改定: 旧2段階送料テーブル(CONFIG_SHIPPING_RATES)は廃止。送料はConfig.gsの5サイズ運賃表＋pt制で管理
  return {
    ok: true,
    settings: {
      minOrderCount: s.minOrderCount || 1,
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
      paymentExpiry: s.paymentExpiry || 259200
    }
  };
}

function adminPanel_setBizSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  // 2026-07改定: 旧2段階送料テーブルは廃止。旧UIからの書き込みは無視する（送料はConfig.gsの5サイズ表で管理）
  if (settings.shippingRates) {
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
    // ヘッダー（S列「送料無料併用」含む）を保証してから追記
    var sh = sh_ensureCouponSheet_(orderSs);
    if (!sh) return { ok: false, message: 'クーポン管理シートなし' };
    // A:コード B:タイプ C:値 D:有効期限 E:利用上限 F:利用回数 G:1人1回制限 H:有効
    // I:メモ J:対象顧客 K:有効開始日 L:会員割引併用 M:数量割引併用 N:チャネル
    // O:対象商品ID P:送料除外商品ID Q:限定顧客名 R:限定顧客メール S:送料無料併用
    var row = [
      params.code, params.type, params.value, params.expiry, params.limit || 0, 0,
      params.once || 'FALSE', 'TRUE', '', '', '', params.comboMember || 'TRUE',
      params.comboBulk || 'TRUE', params.channel || 'all', '', '', '', '',
      params.freeShipping || 'FALSE'
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

function adminPanel_debugSubsidyStats() {
  try {
    var custSheet = getCustomerSheet_();
    var custData = custSheet.getDataRange().getValues();

    var totalCustomers = custData.length - 1;
    var purchasedOnce = 0;
    var repeaters = 0;

    for (var i = 1; i < custData.length; i++) {
      var pc = Number(custData[i][CUSTOMER_SHEET_COLS.PURCHASE_COUNT]) || 0;
      if (pc >= 1) purchasedOnce++;
      if (pc >= 2) repeaters++;
    }

    var ss = sh_getOrderSs_();
    var sheetNames = ['依頼管理', '依頼管理_アーカイブ'];
    var totalOrders = 0;
    var totalRevenue = 0;
    var monthlySales = {};

    for (var s = 0; s < sheetNames.length; s++) {
      var sheet = ss.getSheetByName(sheetNames[s]);
      if (!sheet || sheet.getLastRow() < 2) continue;
      var data = sheet.getDataRange().getValues();
      for (var j = 1; j < data.length; j++) {
        var status = String(data[j][REQUEST_SHEET_COLS.STATUS - 1] || '').trim();
        if (status !== '完了') continue;
        totalOrders++;
        var amount = Number(data[j][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;
        totalRevenue += amount;
        var dateVal = data[j][REQUEST_SHEET_COLS.DATETIME - 1];
        if (dateVal instanceof Date) {
          var ym = Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM');
          monthlySales[ym] = (monthlySales[ym] || 0) + amount;
        }
      }
    }

    var avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    var purchaseRate = totalCustomers > 0 ? +(purchasedOnce / totalCustomers * 100).toFixed(1) : 0;
    var repeatRate = purchasedOnce > 0 ? +(repeaters / purchasedOnce * 100).toFixed(1) : 0;

    var sortedMonths = Object.keys(monthlySales).sort().reverse().slice(0, 6);
    var recent6mTotal = 0;
    for (var m = 0; m < sortedMonths.length; m++) {
      recent6mTotal += monthlySales[sortedMonths[m]];
    }
    var monthlyAvg = sortedMonths.length > 0 ? Math.round(recent6mTotal / sortedMonths.length) : 0;

    var monthlyList = [];
    for (var k = 0; k < sortedMonths.length; k++) {
      monthlyList.push({ month: sortedMonths[k], amount: monthlySales[sortedMonths[k]] });
    }

    return {
      ok: true, subsidy: true,
      totalCustomers: totalCustomers,
      purchasedOnce: purchasedOnce,
      repeaters: repeaters,
      purchaseRate: purchaseRate,
      repeatRate: repeatRate,
      totalOrders: totalOrders,
      totalRevenue: totalRevenue,
      avgOrderValue: avgOrderValue,
      monthlyAvg: monthlyAvg,
      monthlyList: monthlyList
    };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + (e.message || String(e)) };
  }
}

function adminPanel_createDemoDistributionList() {
  return captureConsoleLog_(function() { createDemoDistributionList(); });
}
