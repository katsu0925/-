// SyncApi.gs
// =====================================================
// D1 ⇔ Sheets 同期API（Cloudflare Workers から呼び出される）
// =====================================================
// Workers の Cron Trigger (5分ごと) が以下のAPIを呼び出し、
// スプレッドシートデータをD1にインポートする。
//
// セキュリティ: SYNC_SECRET による認証（Script Properties に設定）
// =====================================================

/**
 * apiSyncExportData — Sheets → D1 方向のデータエクスポート
 *
 * Workers側が5分ごとにこのAPIを呼び出し、差分データを取得する。
 * 全テーブルのデータを一括で返す（差分検出はWorkers側で管理）。
 *
 * @param {object} params - { syncSecret, since, tables }
 * @returns {object} { ok, products, bulkProducts, customers, openItems, coupons, settings, stats }
 */
function apiSyncExportData(params) {
  var p = params || {};

  // 認証チェック
  if (!verifySyncSecret_(p.syncSecret)) {
    return { ok: false, message: '認証エラー' };
  }

  var tables = p.tables || ['products', 'customers', 'openItems', 'coupons', 'settings'];
  var result = { ok: true, needsImport: false };

  try {
    // 商品データ（データ1シート）
    if (tables.indexOf('products') !== -1) {
      result.products = exportProducts_();
      // データ1シートB1の掲載中件数
      try {
        var data1Sh = SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId).getSheetByName(APP_CONFIG.data.sheetName);
        result.sheetTotalCount = Number(data1Sh.getRange('B1').getValue()) || 0;
      } catch (e) { result.sheetTotalCount = 0; }
    }

    // アソート商品データ
    if (tables.indexOf('bulkProducts') !== -1) {
      result.bulkProducts = exportBulkProducts_();
    }

    // 顧客データ
    if (tables.indexOf('customers') !== -1) {
      result.customers = exportCustomers_();
      // D1側に新規登録された顧客があるかフラグ
      result.needsImport = true;
    }

    // 依頼中データ
    if (tables.indexOf('openItems') !== -1) {
      result.openItems = exportOpenItems_();
    }

    // クーポンデータ
    if (tables.indexOf('coupons') !== -1) {
      result.coupons = exportCoupons_();
    }

    // 設定データ
    if (tables.indexOf('settings') !== -1) {
      result.settings = exportSettings_();
    }

    // 統計データ
    if (tables.indexOf('stats') !== -1) {
      result.stats = exportStats_();
    }

    // 作業者マスター
    if (tables.indexOf('workers') !== -1) {
      result.workers = exportWorkers_();
    }

    // 商品管理の管理番号リスト
    if (tables.indexOf('managedIds') !== -1) {
      result.managedIds = exportManagedIds_();
    }

    // 注文履歴（依頼管理シート → D1 ordersテーブル）
    if (tables.indexOf('orders') !== -1) {
      result.orders = exportOrders_();
    }

    return result;
  } catch (e) {
    console.error('apiSyncExportData error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * apiSyncImportData — D1 → Sheets 方向のデータインポート
 *
 * Workers側で新規登録された顧客データなどをSheetsに反映する。
 *
 * @param {object} params - { syncSecret, customers }
 * @returns {object} { ok, imported }
 */
function apiSyncImportData(params) {
  var p = params || {};

  // 認証チェック
  if (!verifySyncSecret_(p.syncSecret)) {
    return { ok: false, message: '認証エラー' };
  }

  var imported = { customers: 0, photography: 0 };

  try {
    // 顧客データのインポート（D1 → Sheets）
    if (p.customers && p.customers.length > 0) {
      imported.customers = importCustomers_(p.customers);
    }

    // 撮影データのインポート（Workers KV → 商品管理シート）
    if (p.photographyData && p.photographyData.length > 0) {
      imported.photography = importPhotographyData_(p.photographyData);
    }

    // AI判定データのインポート（Gemini → 商品管理シート + AIキーワード抽出シート）
    if (p.aiData && p.aiData.length > 0) {
      var aiResult = importAiProductData_(p.aiData);
      imported.aiProduct = aiResult.product;
      imported.aiKeywords = aiResult.keywords;
      // imported.aiDebug = aiResult.debug; // デバッグ用（本番不要）
    }

    return { ok: true, imported: imported };
  } catch (e) {
    console.error('apiSyncImportData error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * apiExportPhotographyMeta — 商品管理シートから撮影メタデータを一括取得
 *
 * Workers KVの photo-meta 復元用。商品管理シートのF列(管理番号)・AI列(撮影日付)・AJ列(撮影者)を返す。
 *
 * @param {object} params - { syncSecret, managedIds? }
 * @returns {object} { ok, items: [{ managedId, photographyDate, photographer }] }
 */
function apiExportPhotographyMeta(params) {
  var p = params || {};
  if (!verifySyncSecret_(p.syncSecret)) {
    return { ok: false, message: '認証エラー' };
  }

  try {
    var ssId = '';
    try { ssId = APP_CONFIG.detail.spreadsheetId; } catch (e) {}
    if (!ssId) {
      ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '';
    }
    if (!ssId) return { ok: false, message: 'spreadsheetId未設定' };

    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName('商品管理');
    if (!sh) return { ok: false, message: '商品管理シートが見つかりません' };

    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, items: [] };

    // F列(6), AI列(35), AJ列(36) を一括取得（F〜AJは列6〜36 = 31列）
    var range = sh.getRange(2, 6, lastRow - 1, 31).getValues();

    var filterSet = null;
    if (Array.isArray(p.managedIds) && p.managedIds.length > 0) {
      filterSet = {};
      for (var k = 0; k < p.managedIds.length; k++) {
        var key = String(p.managedIds[k] || '').trim().toUpperCase();
        if (key) filterSet[key] = true;
      }
    }

    var items = [];
    for (var i = 0; i < range.length; i++) {
      var mid = String(range[i][0] || '').trim();
      if (!mid) continue;
      var midKey = mid.toUpperCase();
      if (filterSet && !filterSet[midKey]) continue;

      var dateCell = range[i][29]; // AI列 = 6 + 29 = 35
      var photographer = String(range[i][30] || '').trim(); // AJ列 = 36

      var photographyDate = '';
      if (dateCell instanceof Date) {
        photographyDate = Utilities.formatDate(dateCell, 'Asia/Tokyo', 'yyyy/MM/dd');
      } else if (dateCell) {
        photographyDate = String(dateCell).trim().replace(/-/g, '/');
      }

      if (!photographyDate && !photographer) continue;

      items.push({
        managedId: midKey,
        photographyDate: photographyDate,
        photographer: photographer,
      });
    }

    return { ok: true, items: items, total: items.length };
  } catch (e) {
    console.error('apiExportPhotographyMeta error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// 認証
// =====================================================

function verifySyncSecret_(secret) {
  if (!secret) return false;
  var stored = '';
  try {
    stored = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '';
  } catch (e) { return false; }
  if (!stored) return false;
  return timingSafeEqual_(String(secret), stored);
}

// =====================================================
// エクスポート関数
// =====================================================

function exportProducts_() {
  // pr_readProducts_() を直接使う（GASの既存ロジックと完全一致）
  try {
    var products = pr_readProducts_();
    if (!products || !products.length) return [];
    // D1向けにそのまま返す（managedId, noLabel, imageUrl, state, brand, size, gender, category, color, price, qty, defectDetail, shippingMethod）
    return products;
  } catch (e) {
    console.error('exportProducts_ error:', e);
    return [];
  }
}

function exportBulkProducts_() {
  try {
    return bulk_getProducts_();
  } catch (e) {
    console.log('exportBulkProducts_ error:', e);
    return [];
  }
}

function exportCustomers_() {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('顧客管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  // 年間購入金額を集計（依頼管理シートから — calcSpendByPeriod_ と同じロジック）
  var spentMap = calcAnnualSpentMap_(ss);

  var data = sh.getRange(2, 1, lastRow - 1, 16).getValues();
  var c = CUSTOMER_SHEET_COLS;
  var customers = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var email = String(row[c.EMAIL] || '').trim().toLowerCase();
    if (!email) continue;

    customers.push({
      id: String(row[c.ID] || ''),
      email: email,
      passwordHash: String(row[c.PASSWORD] || ''),
      companyName: String(row[c.COMPANY_NAME] || ''),
      phone: String(row[c.PHONE] || '').replace(/^'/, ''),
      postal: String(row[c.POSTAL] || '').replace(/^'/, ''),
      address: String(row[c.ADDRESS] || ''),
      newsletter: row[c.NEWSLETTER] === true || String(row[c.NEWSLETTER]).toUpperCase() === 'TRUE',
      createdAt: row[c.CREATED_AT] ? new Date(row[c.CREATED_AT]).toISOString() : '',
      lastLogin: row[c.LAST_LOGIN] ? new Date(row[c.LAST_LOGIN]).toISOString() : '',
      points: Number(row[c.POINTS]) || 0,
      pointsUpdatedAt: row[c.POINTS_UPDATED_AT] ? new Date(row[c.POINTS_UPDATED_AT]).toISOString() : '',
      purchaseCount: Number(row[c.PURCHASE_COUNT]) || 0,
      annualSpent: spentMap[email] || 0
    });
  }

  return customers;
}

/**
 * 依頼管理シートから顧客ごとの年間購入金額を集計
 * calcSpendByPeriod_ と同一ロジック: status='完了' && 過去1年の total を合算
 * @param {Spreadsheet} ss
 * @return {Object.<string, number>} email → annualSpent
 */
function calcAnnualSpentMap_(ss) {
  var orderSheet = ss.getSheetByName('依頼管理');
  if (!orderSheet) return {};

  var lastRow = orderSheet.getLastRow();
  if (lastRow < 2) return {};

  // A=受付番号(0), D=メール(3), L=合計金額(11), P=ステータス(15)
  var data = orderSheet.getRange(2, 1, lastRow - 1, 16).getValues();
  var now = new Date();
  var oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  var map = {};

  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][15] || '').trim();
    if (status !== '完了') continue;

    var receiptNo = String(data[i][0] || '').trim();
    var orderDate = parseReceiptDate_(receiptNo);
    if (!orderDate || orderDate < oneYearAgo) continue;

    var email = String(data[i][3] || '').trim().toLowerCase();
    if (!email) continue;

    var total = Number(data[i][11]) || 0;
    map[email] = (map[email] || 0) + total;
  }

  return map;
}

/**
 * 受付番号から日時を解析（JST）
 * Format: YYYYMMDDHHmmss-NNN
 */
function parseReceiptDate_(receiptNo) {
  if (!receiptNo || receiptNo.length < 14) return null;
  var y  = parseInt(receiptNo.substring(0, 4), 10);
  var mo = parseInt(receiptNo.substring(4, 6), 10) - 1;
  var d  = parseInt(receiptNo.substring(6, 8), 10);
  var h  = parseInt(receiptNo.substring(8, 10), 10);
  var mi = parseInt(receiptNo.substring(10, 12), 10);
  var s  = parseInt(receiptNo.substring(12, 14), 10);
  if (isNaN(y) || isNaN(mo) || isNaN(d)) return null;
  return new Date(y, mo, d, h || 0, mi || 0, s || 0);
}

function exportOpenItems_() {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(APP_CONFIG.order.openLogSheetName || '依頼中');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
  var items = [];

  for (var i = 0; i < data.length; i++) {
    var managedId = u_normalizeId_(String(data[i][0] || '').trim());
    if (!managedId) continue;
    items.push({
      managedId: managedId,
      receiptNo: String(data[i][1] || ''),
      status: String(data[i][2] || '依頼中')
    });
  }

  return items;
}

function exportCoupons_() {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('クーポン管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, 18).getValues();
  var coupons = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var code = String(row[0] || '').trim();
    if (!code) continue;

    coupons.push({
      code: code,
      type: String(row[1] || 'rate'),
      value: Number(row[2]) || 0,
      expiresAt: row[3] ? new Date(row[3]).toISOString() : null,
      maxUses: Number(row[4]) || 0,
      useCount: Number(row[5]) || 0,
      oncePerUser: row[6] === true || String(row[6]).toUpperCase() === 'TRUE',
      active: row[7] === true || String(row[7]).toUpperCase() === 'TRUE',
      memo: String(row[8] || ''),
      target: String(row[9] || 'all'),
      startDate: row[10] ? new Date(row[10]).toISOString() : null,
      comboMember: row[11] === true || String(row[11]).toUpperCase() === 'TRUE',
      comboBulk: row[12] === true || String(row[12]).toUpperCase() === 'TRUE',
      channel: String(row[13] || 'all'),
      targetProducts: String(row[14] || ''),
      shippingExcludeProducts: String(row[15] || ''),
      targetCustomerName: String(row[16] || ''),
      targetCustomerEmail: String(row[17] || '')
    });
  }

  return coupons;
}

function exportSettings_() {
  var props = PropertiesService.getScriptProperties();
  var settings = {};

  // 会員割引ステータス
  settings.MEMBER_DISCOUNT_STATUS = JSON.stringify(app_getMemberDiscountStatus_());

  // 初回半額キャンペーンステータス
  settings.FIRST_HALF_PRICE_STATUS = JSON.stringify(app_getFirstHalfPriceStatus_());

  // 送料設定
  settings.SHIPPING_CONFIG = JSON.stringify({
    areas: SHIPPING_AREAS,
    rates: SHIPPING_RATES
  });

  // サイトURL
  var siteUrl = '';
  try { siteUrl = SITE_CONSTANTS.SITE_URL || ''; } catch (e) {}
  if (!siteUrl) { try { siteUrl = ScriptApp.getService().getUrl(); } catch (e) {} }
  settings.SITE_URL = siteUrl;

  // 管理者メール
  settings.ADMIN_OWNER_EMAIL = props.getProperty('ADMIN_OWNER_EMAIL') || '';

  // SNSシェアキャンペーン
  if (typeof app_getSnsShareCampaignStatus_ === 'function') {
    settings.SNS_SHARE_CAMPAIGN_STATUS = JSON.stringify(app_getSnsShareCampaignStatus_());
  }

  // 管理パネルから設定された値（ScriptPropertiesに保存済み）
  var qtyDiscounts = props.getProperty('CONFIG_QTY_DISCOUNTS');
  if (qtyDiscounts) settings.QTY_DISCOUNTS = qtyDiscounts;

  var bizSettings = props.getProperty('CONFIG_BIZ_SETTINGS');
  if (bizSettings) {
    try {
      var biz = JSON.parse(bizSettings);
      settings.HOLD_MINUTES = JSON.stringify({ default: biz.holdMinutes || 15, member: biz.holdMemberMinutes || 30 });
      settings.MIN_ORDER_COUNT = String(biz.minOrderCount || 5);
      settings.SESSION_CONFIG = JSON.stringify({ sessionHours: biz.sessionHours || 24, rememberDays: biz.rememberDays || 30, csrfExpiry: biz.csrfExpiry || 3600 });
      settings.PAYMENT_EXPIRY = String(biz.paymentExpiry || 259200);
    } catch (e) {}
  }

  var freeShipThreshold = props.getProperty('CONFIG_FREE_SHIP_THRESHOLD');
  if (freeShipThreshold) settings.FREE_SHIP_THRESHOLD = freeShipThreshold;

  return settings;
}

function exportStats_() {
  try {
    return st_getStatsCache_();
  } catch (e) {
    return null;
  }
}

// =====================================================
// インポート関数
// =====================================================

/**
 * D1からの顧客データをSheetsにインポート
 * 既存メールアドレスはスキップ（Sheets側のデータを優先）
 *
 * @param {object[]} customers - 顧客データ配列
 * @returns {number} インポートした件数
 */
/**
 * 作業者マスターシートからID・名前を取得
 * 仕入れ管理Ver2 SS内の「作業者マスター」シート
 * @returns {object[]} [{ id, name }, ...]
 */
function exportWorkers_() {
  var ssId = '';
  try {
    ssId = APP_CONFIG.detail.spreadsheetId;
  } catch (e) {}
  if (!ssId) {
    try {
      ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '';
    } catch (e) {}
  }
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  var workers = [];
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][1] || '').trim();
    if (!name) continue;
    workers.push({
      id: String(data[i][0] || (i + 1)),
      name: name
    });
  }
  return workers;
}

/**
 * 依頼管理シート → D1 ordersテーブル用エクスポート
 * マイページ注文履歴・ランク判定に使用
 * アーカイブシートも含めて全行エクスポート（D1側でPK=受付番号でUPSERT）
 * @returns {object[]}
 */
function exportOrders_() {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var orders = [];
  var c = REQUEST_SHEET_COLS;

  var sheetNames = ['依頼管理', '依頼管理_アーカイブ'];
  for (var s = 0; s < sheetNames.length; s++) {
    var sh = ss.getSheetByName(sheetNames[s]);
    if (!sh) continue;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;
    var lastCol = sh.getLastColumn();
    if (lastCol < c.STATUS) lastCol = c.STATUS;

    var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var receiptNo = String(row[c.RECEIPT_NO - 1] || '').trim();
      if (!receiptNo) continue;
      var email = String(row[c.CONTACT - 1] || '').trim().toLowerCase();
      if (!email) continue;

      var dt = row[c.DATETIME - 1];
      var orderDate = '';
      if (dt instanceof Date) orderDate = dt.toISOString();
      else if (dt) { try { orderDate = new Date(dt).toISOString(); } catch (e) { orderDate = ''; } }

      orders.push({
        receiptNo: receiptNo,
        email: email,
        orderDate: orderDate,
        products: String(row[c.PRODUCT_NAMES - 1] || ''),
        itemCount: Number(row[c.TOTAL_COUNT - 1]) || 0,
        totalAmount: Number(row[c.TOTAL_AMOUNT - 1]) || 0,
        shippingCost: Number(row[c.SHIP_COST_SHOP - 1]) || 0,
        status: String(row[c.STATUS - 1] || '').trim(),
        carrier: String(row[c.CARRIER - 1] || '').trim(),
        tracking: String(row[c.TRACKING - 1] || '').trim()
      });
    }
  }

  return orders;
}

/**
 * 商品管理シートF列の管理番号リストを返す
 * @returns {string[]}
 */
function exportManagedIds_() {
  var ssId = '';
  try { ssId = APP_CONFIG.detail.spreadsheetId; } catch (e) {}
  if (!ssId) {
    try { ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || ''; } catch (e) {}
  }
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('商品管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 6, lastRow - 1, 1).getValues();
  var ids = [];
  for (var i = 0; i < data.length; i++) {
    var mid = String(data[i][0] || '').trim().toUpperCase();
    if (mid) ids.push(mid);
  }
  return ids;
}

/**
 * 撮影データを商品管理シートに書き込み
 * AI列(35)=撮影日付, AJ列(36)=撮影者, F列(6)で管理番号を特定
 * 既にAI/AJ列に値がある場合はスキップ
 *
 * @param {object[]} data - [{ managedId, photographyDate, photographer }, ...]
 * @returns {number} 書き込んだ件数
 */
function importPhotographyData_(data) {
  console.log('importPhotographyData_ called with ' + data.length + ' items');
  var ssId = '';
  try {
    ssId = APP_CONFIG.detail.spreadsheetId;
  } catch (e) { console.log('APP_CONFIG.detail.spreadsheetId error: ' + e); }
  if (!ssId) {
    try {
      ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '';
    } catch (e) { console.log('DETAIL_SPREADSHEET_ID error: ' + e); }
  }
  console.log('ssId: ' + ssId);
  if (!ssId) return 0;

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('商品管理');
  if (!sh) { console.log('商品管理シートが見つかりません'); return 0; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { console.log('lastRow < 2'); return 0; }

  // F列(6)の管理番号を取得して行番号マップを構築
  var fData = sh.getRange(2, 6, lastRow - 1, 1).getValues();
  var idToRow = {};
  for (var i = 0; i < fData.length; i++) {
    var mid = String(fData[i][0] || '').trim().toUpperCase();
    if (mid) idToRow[mid] = i + 2; // 1-indexed シート行番号
  }
  console.log('idToRow keys count: ' + Object.keys(idToRow).length);

  // E列(5)のステータスを取得
  var eData = sh.getRange(2, 5, lastRow - 1, 1).getValues();
  // AI列(35)・AJ列(36)の既存値を取得
  var aiajData = sh.getRange(2, 35, lastRow - 1, 2).getValues();

  var written = 0;
  for (var j = 0; j < data.length; j++) {
    var entry = data[j];
    var mid = String(entry.managedId || '').trim().toUpperCase();
    if (!mid) continue;

    var row = idToRow[mid];
    if (!row) { console.log('管理番号 ' + mid + ' が見つかりません'); continue; }

    // 終了済み系ステータスは変更しない（売却済み復活バグ対策）
    var currentStatus = String(eData[row - 2][0] || '').trim();
    var PROTECTED_STATUSES = ['返品済み', '売却済み', '発送済み', '発送待ち', 'キャンセル', 'キャンセル済み', '廃棄済み'];
    if (PROTECTED_STATUSES.indexOf(currentStatus) !== -1) {
      console.log('管理番号 ' + mid + ' はステータス「' + currentStatus + '」のためスキップ');
      continue;
    }

    console.log('管理番号 ' + mid + ' → 行 ' + row);

    var rowIdx = row - 2; // aiajData配列のインデックス
    var existingDate = String(aiajData[rowIdx][0] || '').trim();
    var existingPhotographer = String(aiajData[rowIdx][1] || '').trim();

    var changed = false;

    // AI列(撮影日付)が空なら書き込み（ハイフン→スラッシュ変換）
    if (!existingDate && entry.photographyDate) {
      var dateStr = String(entry.photographyDate).replace(/-/g, '/');
      sh.getRange(row, 35).setValue(dateStr);
      changed = true;
    }
    // AJ列(撮影者)が空なら書き込み
    if (!existingPhotographer && entry.photographer) {
      sh.getRange(row, 36).setValue(entry.photographer);
      changed = true;
    }
    // E列(5)ステータスを「出品待ち」に変更（撮影データがあれば常に）
    if (changed || entry.photographyDate) {
      console.log('E列を出品待ちに変更: 行' + row + ', changed=' + changed + ', photographyDate=' + entry.photographyDate);
      sh.getRange(row, 5).setValue('出品待ち');
      changed = true;
    } else {
      console.log('E列変更スキップ: 行' + row + ', changed=' + changed + ', photographyDate=' + entry.photographyDate);
    }

    if (changed) written++;
  }

  return written;
}

/**
 * AI判定データを商品管理シート + AIキーワード抽出シートに書き込み
 * 既存値がある列はスキップ（上書き防止）
 *
 * @param {object[]} data - [{ managedId, brand, tagLabel, gender, category1, category2, category3, design, color, pocket, defectDetail, keywords }, ...]
 * @returns {object} { product: 書き込み件数, keywords: キーワード書き込み件数 }
 */
function importAiProductData_(data) {
  console.log('importAiProductData_ called with ' + data.length + ' items');
  var ssId = '';
  try {
    ssId = APP_CONFIG.detail.spreadsheetId;
  } catch (e) { /* ignore */ }
  if (!ssId) {
    try {
      ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '';
    } catch (e) { /* ignore */ }
  }
  if (!ssId) return { product: 0, keywords: 0 };

  var ss = SpreadsheetApp.openById(ssId);

  // ── 商品管理シートへの書き込み ──
  var sh = ss.getSheetByName('商品管理');
  if (!sh) { console.log('商品管理シートが見つかりません'); return { product: 0, keywords: 0 }; }

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return { product: 0, keywords: 0 };

  // ヘッダー名→列番号マップ構築
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  for (var h = 0; h < headers.length; h++) {
    var hName = String(headers[h] || '').trim();
    if (hName) colMap[hName] = h + 1; // 1-indexed
  }

  // AI判定対象のフィールド→ヘッダー名マッピング
  var fieldToHeader = {
    brand: 'ブランド',
    tagLabel: 'タグ表記',
    gender: '性別',
    category1: 'カテゴリ1',
    category2: 'カテゴリ2',
    category3: 'カテゴリ3',
    design: 'デザイン特徴',
    color: 'カラー',
    pocket: 'ポケット',
    defectDetail: '傷汚れ詳細'
  };

  // 管理番号列（F列）で行番号マップ構築
  var colMid = colMap['管理番号'];
  if (!colMid) { console.log('管理番号列が見つかりません'); return { product: 0, keywords: 0 }; }

  var midData = sh.getRange(2, colMid, lastRow - 1, 1).getValues();
  var idToRow = {};
  for (var i = 0; i < midData.length; i++) {
    var mid = String(midData[i][0] || '').trim().toUpperCase();
    if (mid) idToRow[mid] = i + 2;
  }

  var productWritten = 0;
  for (var j = 0; j < data.length; j++) {
    var entry = data[j];
    var mid = String(entry.managedId || '').trim().toUpperCase();
    if (!mid) continue;

    // 商品管理シートに行があればプリフィル（なければスキップ）
    var row = idToRow[mid];
    if (row) {
      var changed = false;
      for (var field in fieldToHeader) {
        var headerName = fieldToHeader[field];
        var col = colMap[headerName];
        if (!col) continue;
        var newVal = entry[field];
        if (newVal === null || newVal === undefined) continue;
        var newValStr = String(newVal).trim();
        var newValLower = newValStr.toLowerCase();
        if (newValStr === '' || newValLower === 'null' || newValLower === 'n/a' || newValStr === '不明' || newValLower === 'undefined') continue;
        // "なし" は pocket(ポケット) だけ有効値として通す
        if (newValStr === 'なし' && headerName !== 'ポケット') continue;
        var existing = String(sh.getRange(row, col).getValue() || '').trim();
        if (existing !== '') continue;
        sh.getRange(row, col).setValue(newValStr);
        changed = true;
      }
      if (changed) {
        productWritten++;
        console.log('AI: 商品情報プリフィル完了 ' + mid);
      }
    }
  }

  // ── AI画像判定シートへの書き込み（AppSheet Initial Value参照用） ──
  var aiSh = ss.getSheetByName('AI画像判定');
  if (!aiSh) {
    console.log('AI画像判定シートが見つかりません');
  } else {
    var aiLastRow = aiSh.getLastRow();
    var aiLastCol = aiSh.getLastColumn();
    if (aiLastCol < 1) aiLastCol = 12; // ヘッダー未作成の場合

    // ヘッダーが未作成なら作成
    if (aiLastRow < 1) {
      var aiHeaders = ['管理番号', 'ブランド', 'タグ表記', '性別', 'カテゴリ1', 'カテゴリ2', 'カテゴリ3', 'デザイン特徴', 'カラー', 'ポケット', '傷汚れ詳細', '判定日'];
      aiSh.getRange(1, 1, 1, aiHeaders.length).setValues([aiHeaders]);
      aiLastRow = 1;
      aiLastCol = aiHeaders.length;
    }

    // ヘッダーマップ構築
    var aiHeaders = aiSh.getRange(1, 1, 1, aiLastCol).getValues()[0];
    var aiColMap = {};
    for (var ah = 0; ah < aiHeaders.length; ah++) {
      var ahName = String(aiHeaders[ah] || '').trim();
      if (ahName) aiColMap[ahName] = ah + 1;
    }
    var aiColMid = aiColMap['管理番号'];

    if (aiColMid) {
      // 既存の管理番号→行マップ
      var aiIdToRow = {};
      if (aiLastRow >= 2) {
        var aiMidData = aiSh.getRange(2, aiColMid, aiLastRow - 1, 1).getValues();
        for (var am = 0; am < aiMidData.length; am++) {
          var aiMid = String(aiMidData[am][0] || '').trim().toUpperCase();
          if (aiMid) aiIdToRow[aiMid] = am + 2;
        }
      }

      var aiFieldMap = {
        brand: 'ブランド', tagLabel: 'タグ表記', gender: '性別',
        category1: 'カテゴリ1', category2: 'カテゴリ2', category3: 'カテゴリ3',
        design: 'デザイン特徴', color: 'カラー', pocket: 'ポケット', defectDetail: '傷汚れ詳細'
      };

      for (var ai = 0; ai < data.length; ai++) {
        var aiEntry = data[ai];
        var aiMidVal = String(aiEntry.managedId || '').trim().toUpperCase();
        if (!aiMidVal) continue;

        var aiRow = aiIdToRow[aiMidVal];
        if (!aiRow) {
          // 新規行追加
          aiRow = aiLastRow + 1;
          aiLastRow++;
          // AppSheetの管理番号形式に合わせる（先頭小文字z + 大文字コード + 連番）
          var aiMidWrite = String(aiEntry.managedId || '').trim();
          // AppSheetは先頭小文字zで生成するが、タスキ箱は全大文字化するため、先頭を小文字に戻す
          if (aiMidWrite.length > 0 && aiMidWrite.charAt(0) === 'Z') {
            aiMidWrite = 'z' + aiMidWrite.substring(1);
          }
          aiSh.getRange(aiRow, aiColMid).setValue(aiMidWrite);
          aiIdToRow[aiMidVal] = aiRow;
        }

        // 各フィールド書き込み（上書き）
        for (var aiField in aiFieldMap) {
          var aiHeaderName = aiFieldMap[aiField];
          var aiCol = aiColMap[aiHeaderName];
          if (!aiCol) continue;
          var aiVal = aiEntry[aiField];
          if (aiVal === null || aiVal === undefined) continue;
          var aiValStr = String(aiVal).trim();
          var aiValLower = aiValStr.toLowerCase();
          if (aiValStr === '' || aiValLower === 'null' || aiValLower === 'n/a' || aiValStr === '不明' || aiValLower === 'undefined') continue;
          // "なし" は pocket(ポケット) だけ有効値として通す
          if (aiValStr === 'なし' && aiHeaderName !== 'ポケット') continue;
          aiSh.getRange(aiRow, aiCol).setValue(aiValStr);
        }

        // 判定日
        var aiColDate = aiColMap['判定日'];
        if (aiColDate) {
          aiSh.getRange(aiRow, aiColDate).setValue(new Date());
        }

        productWritten++;
        console.log('AI: AI画像判定シート書込み完了 ' + aiMidVal);
      }
    }
  }

  // ── AIキーワード抽出シートへの書き込み ──
  var kwWritten = 0;
  console.log('AI: ssId=' + ssId + ', ss.getName()=' + ss.getName());
  var kwSh = ss.getSheetByName('AIキーワード抽出');
  console.log('AI: kwSh=' + (kwSh ? 'FOUND' : 'NULL'));
  if (kwSh) {
    var kwLastRow = kwSh.getLastRow();
    var kwLastCol = kwSh.getLastColumn();
    console.log('AI: kwLastRow=' + kwLastRow + ', kwLastCol=' + kwLastCol);
    var kwHeaders = kwSh.getRange(1, 1, 1, kwLastCol).getValues()[0];
    var kwColMap = {};
    for (var kh = 0; kh < kwHeaders.length; kh++) {
      var khName = String(kwHeaders[kh] || '').trim();
      if (khName) kwColMap[khName] = kh + 1;
    }
    console.log('AI: kwColMap keys=' + Object.keys(kwColMap).join(','));

    var kwColMid = kwColMap['管理番号'];
    var kwColFlag = kwColMap['再生成フラグ'];
    var kwColLog = kwColMap['処理ログ'];
    var kwCols = [];
    for (var ki = 1; ki <= 8; ki++) {
      if (kwColMap['キーワード' + ki]) kwCols.push(kwColMap['キーワード' + ki]);
    }
    console.log('AI: kwColMid=' + kwColMid + ', kwCols.length=' + kwCols.length + ', kwColFlag=' + kwColFlag);

    if (kwColMid && kwCols.length > 0) {
      // 既存の管理番号→行マップ
      var kwIdToRow = {};
      if (kwLastRow >= 2) {
        var kwMidData = kwSh.getRange(2, kwColMid, kwLastRow - 1, 1).getValues();
        for (var km = 0; km < kwMidData.length; km++) {
          var kwMid = String(kwMidData[km][0] || '').trim().toUpperCase();
          if (kwMid) kwIdToRow[kwMid] = km + 2;
        }
      }

      for (var d = 0; d < data.length; d++) {
        var dEntry = data[d];
        var dMid = String(dEntry.managedId || '').trim().toUpperCase();
        console.log('AI KW: d=' + d + ', managedId=' + dMid + ', keys=' + Object.keys(dEntry).join(','));
        if (!dMid) continue;

        var keywords = String(dEntry.keywords || '').trim();
        console.log('AI KW: keywords="' + keywords + '"');
        if (!keywords) continue;

        var kwParts = keywords.split(/[\s　,、]+/).filter(function(s) { return s.length > 0; });
        if (kwParts.length === 0) continue;

        // 8個にパディング
        while (kwParts.length < 8) kwParts.push('');
        kwParts = kwParts.slice(0, 8);

        var kwRow = kwIdToRow[dMid];
        console.log('AI KW: kwRow=' + kwRow + ', kwLastRow=' + kwLastRow);
        if (!kwRow) {
          // 新規行を追加
          kwRow = kwLastRow + 1;
          kwLastRow++;
          console.log('AI KW: 新規行追加 row=' + kwRow + ', col=' + kwColMid + ', val=' + dEntry.managedId);
          var kwMidWrite = String(dEntry.managedId || '').trim();
          if (kwMidWrite.length > 0 && kwMidWrite.charAt(0) === 'Z') {
            kwMidWrite = 'z' + kwMidWrite.substring(1);
          }
          kwSh.getRange(kwRow, kwColMid).setValue(kwMidWrite);
          kwIdToRow[dMid] = kwRow;
        }

        // キーワード列が既に埋まっていたらスキップ
        var firstKwVal = String(kwSh.getRange(kwRow, kwCols[0]).getValue() || '').trim();
        console.log('AI KW: firstKwVal="' + firstKwVal + '", kwCols[0]=' + kwCols[0]);
        if (firstKwVal !== '') {
          console.log('AI: キーワード既存のためスキップ ' + dMid);
          continue;
        }

        // キーワード1〜8を書込み
        for (var kw = 0; kw < kwCols.length && kw < kwParts.length; kw++) {
          kwSh.getRange(kwRow, kwCols[kw]).setValue(kwParts[kw]);
        }

        // 再生成フラグ=FALSE
        if (kwColFlag) {
          kwSh.getRange(kwRow, kwColFlag).setValue(false);
        }

        // 処理ログ
        if (kwColLog) {
          kwSh.getRange(kwRow, kwColLog).setValue('OK(Gemini): ' + kwParts.filter(Boolean).join(' '));
        }

        kwWritten++;
        console.log('AI: キーワード書込み完了 ' + dMid + ': ' + kwParts.filter(Boolean).join(' '));
      }
    }
  } else {
    console.log('AIキーワード抽出シートが見つかりません');
  }

  var firstEntry = data[0] || {};
  var testMid = String(firstEntry.managedId || '').trim().toUpperCase();
  var testKwRow = kwIdToRow ? kwIdToRow[testMid] : -1;
  var testFirstKwVal = '';
  if (testKwRow && kwCols && kwCols.length > 0) {
    try { testFirstKwVal = String(kwSh.getRange(testKwRow, kwCols[0]).getValue() || ''); } catch(e) {}
  }
  return { product: productWritten, keywords: kwWritten, debug: { ssName: ss.getName(), kwShFound: !!kwSh, kwColMid: kwColMid || null, kwColsLen: kwCols ? kwCols.length : 0, kwLastRow: kwSh ? kwSh.getLastRow() : -1, dataLen: data.length, firstMid: testMid, firstKw: String(firstEntry.keywords || '').substring(0, 50), kwRowFound: testKwRow || 'NOT_FOUND', firstKwVal: testFirstKwVal } };
}

/**
 * AI画像判定シート → 商品管理シートへの未適用データを再適用
 * cronEvery5minから呼び出し。AI判定が先に完了し、商品管理に行が後から追加されるケースに対応。
 */
function applyPendingAiData() {
  var ssId = '';
  try { ssId = APP_CONFIG.detail.spreadsheetId; } catch (e) {}
  if (!ssId) try { ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || ''; } catch (e) {}
  if (!ssId) return;

  var ss = SpreadsheetApp.openById(ssId);
  var aiSh = ss.getSheetByName('AI画像判定');
  var sh = ss.getSheetByName('商品管理');
  if (!aiSh || !sh) return;

  var aiLastRow = aiSh.getLastRow();
  var aiLastCol = aiSh.getLastColumn();
  if (aiLastRow < 2 || aiLastCol < 2) return;

  // AI画像判定ヘッダーマップ
  var aiHeaders = aiSh.getRange(1, 1, 1, aiLastCol).getValues()[0];
  var aiColMap = {};
  for (var i = 0; i < aiHeaders.length; i++) {
    var name = String(aiHeaders[i] || '').trim();
    if (name) aiColMap[name] = i + 1;
  }
  var aiColMid = aiColMap['管理番号'];
  if (!aiColMid) return;

  // 商品管理ヘッダーマップ
  var shLastRow = sh.getLastRow();
  var shLastCol = sh.getLastColumn();
  if (shLastRow < 2) return;
  var shHeaders = sh.getRange(1, 1, 1, shLastCol).getValues()[0];
  var shColMap = {};
  for (var h = 0; h < shHeaders.length; h++) {
    var hName = String(shHeaders[h] || '').trim();
    if (hName) shColMap[hName] = h + 1;
  }

  // 商品管理の管理番号→行マップ
  var shColMid = shColMap['管理番号'];
  if (!shColMid) return;
  var shMidData = sh.getRange(2, shColMid, shLastRow - 1, 1).getValues();
  var shIdToRow = {};
  for (var s = 0; s < shMidData.length; s++) {
    var smid = String(shMidData[s][0] || '').trim().toUpperCase();
    if (smid) shIdToRow[smid] = s + 2;
  }

  // フィールドマッピング
  var fieldMap = {
    'ブランド': 'ブランド', 'タグ表記': 'タグ表記', '性別': '性別',
    'カテゴリ1': 'カテゴリ1', 'カテゴリ2': 'カテゴリ2', 'カテゴリ3': 'カテゴリ3',
    'デザイン特徴': 'デザイン特徴', 'カラー': 'カラー', 'ポケット': 'ポケット', '傷汚れ詳細': '傷汚れ詳細'
  };

  // AI画像判定の全行を走査
  var aiData = aiSh.getRange(2, 1, aiLastRow - 1, aiLastCol).getValues();
  var applied = 0;
  for (var r = 0; r < aiData.length; r++) {
    var mid = String(aiData[r][aiColMid - 1] || '').trim().toUpperCase();
    if (!mid) continue;

    var shRow = shIdToRow[mid];
    if (!shRow) continue; // 商品管理に行がまだない

    var changed = false;
    for (var aiHeader in fieldMap) {
      var shHeader = fieldMap[aiHeader];
      var aiCol = aiColMap[aiHeader];
      var shCol = shColMap[shHeader];
      if (!aiCol || !shCol) continue;

      var aiVal = String(aiData[r][aiCol - 1] || '').trim();
      var aiValLower = aiVal.toLowerCase();
      if (aiVal === '' || aiValLower === 'null' || aiValLower === 'n/a' || aiVal === '不明') continue;
      // "なし" は ポケット だけ有効値として通す
      if (aiVal === 'なし' && aiHeader !== 'ポケット') continue;

      var existing = String(sh.getRange(shRow, shCol).getValue() || '').trim();
      if (existing !== '') continue; // 既に値がある

      sh.getRange(shRow, shCol).setValue(aiVal);
      changed = true;
    }
    if (changed) {
      applied++;
      console.log('applyPendingAiData: 適用 ' + mid);
    }
  }
  if (applied > 0) console.log('applyPendingAiData: ' + applied + '件適用');
}

function importCustomers_(customers) {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return 0;

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('顧客管理');
  if (!sh) return 0;

  // 既存メールアドレスを取得
  var lastRow = sh.getLastRow();
  var existingEmails = {};
  if (lastRow >= 2) {
    var emails = sh.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      var em = String(emails[i][0] || '').trim().toLowerCase();
      if (em) existingEmails[em] = true;
    }
  }

  var c = CUSTOMER_SHEET_COLS;
  var imported = 0;

  for (var j = 0; j < customers.length; j++) {
    var cust = customers[j];
    var email = String(cust.email || '').trim().toLowerCase();
    if (!email || existingEmails[email]) continue;

    // 新規顧客をシートに追加
    var newRow = new Array(16);
    newRow[c.ID] = cust.id || '';
    newRow[c.EMAIL] = email;
    newRow[c.PASSWORD] = cust.passwordHash || '';
    newRow[c.COMPANY_NAME] = cust.companyName || '';
    newRow[c.PHONE] = cust.phone ? "'" + cust.phone : '';
    newRow[c.POSTAL] = cust.postal ? "'" + cust.postal : '';
    newRow[c.ADDRESS] = cust.address || '';
    newRow[c.NEWSLETTER] = cust.newsletter === 1 || cust.newsletter === true;
    newRow[c.CREATED_AT] = cust.createdAt ? new Date(cust.createdAt) : new Date();
    newRow[c.LAST_LOGIN] = cust.lastLogin ? new Date(cust.lastLogin) : '';
    newRow[c.SESSION_ID] = '';  // セッションはKVで管理
    newRow[c.SESSION_EXPIRY] = '';
    newRow[c.POINTS] = cust.points || 0;
    newRow[c.POINTS_UPDATED_AT] = cust.pointsUpdatedAt ? new Date(cust.pointsUpdatedAt) : new Date();
    newRow[c.PURCHASE_COUNT] = cust.purchaseCount || 0;
    // O列: LINE UserID（空）
    if (newRow.length < 16) newRow.push('');

    sh.appendRow(newRow);
    existingEmails[email] = true;
    imported++;
  }

  return imported;
}

/**
 * apiGetBrandsForOverlay — 背景置換時のブランド文字入れ用
 *
 * 指定された管理番号に対し、商品管理シートから
 * ブランド名と採寸有無（着丈列）を返す。
 * 採寸が入っている行は外注が手を入れたとみなし、
 * そちらのブランドを優先採用する判定に使う。
 *
 * @param {object} params - { syncSecret, managedIds: string[] }
 * @returns {object} { ok, brands: { [managedId]: { brand, hasSizing } } }
 */
function apiGetBrandsForOverlay(params) {
  var p = params || {};
  if (!verifySyncSecret_(p.syncSecret)) {
    return { ok: false, message: '認証エラー' };
  }

  var input = p.managedIds || [];
  var managedIds = [];
  for (var mi = 0; mi < input.length; mi++) {
    var v = String(input[mi] || '').trim().toUpperCase();
    if (v) managedIds.push(v);
  }
  if (managedIds.length === 0) return { ok: true, brands: {} };

  var ssId = '';
  try { ssId = APP_CONFIG.detail.spreadsheetId; } catch (e) { /* ignore */ }
  if (!ssId) {
    try { ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || ''; } catch (e) { /* ignore */ }
  }
  if (!ssId) return { ok: false, message: 'spreadsheetId未設定' };

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('商品管理');
  if (!sh) return { ok: false, message: '商品管理シートが見つかりません' };

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, brands: {} };

  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  for (var h = 0; h < headers.length; h++) {
    var hName = String(headers[h] || '').trim();
    if (hName) colMap[hName] = h + 1;
  }
  var colMid = colMap['管理番号'];
  var colBrand = colMap['ブランド'];
  var colSizing = colMap['着丈'];
  if (!colMid || !colBrand) return { ok: false, message: '必要な列がありません' };

  var idSet = {};
  for (var k = 0; k < managedIds.length; k++) idSet[managedIds[k]] = true;

  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var brands = {};
  for (var i = 0; i < data.length; i++) {
    var mid = String(data[i][colMid - 1] || '').trim().toUpperCase();
    if (!mid || !idSet[mid]) continue;
    var brand = String(data[i][colBrand - 1] || '').trim();
    var sizingVal = colSizing ? String(data[i][colSizing - 1] || '').trim() : '';
    brands[mid] = { brand: brand, hasSizing: !!sizingVal };
  }

  return { ok: true, brands: brands };
}
