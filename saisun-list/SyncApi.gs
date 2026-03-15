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

    return { ok: true, imported: imported };
  } catch (e) {
    console.error('apiSyncImportData error:', e);
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
 * 撮影データを商品管理シートに書き込み
 * AI列(35)=撮影日付, AJ列(36)=撮影者, F列(6)で管理番号を特定
 * 既にAI/AJ列に値がある場合はスキップ
 *
 * @param {object[]} data - [{ managedId, photographyDate, photographer }, ...]
 * @returns {number} 書き込んだ件数
 */
function importPhotographyData_(data) {
  var ssId = '';
  try {
    ssId = APP_CONFIG.detail.spreadsheetId;
  } catch (e) {}
  if (!ssId) {
    try {
      ssId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '';
    } catch (e) {}
  }
  if (!ssId) return 0;

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('商品管理');
  if (!sh) return 0;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  // F列(6)の管理番号を取得して行番号マップを構築
  var fData = sh.getRange(2, 6, lastRow - 1, 1).getValues();
  var idToRow = {};
  for (var i = 0; i < fData.length; i++) {
    var mid = String(fData[i][0] || '').trim().toUpperCase();
    if (mid) idToRow[mid] = i + 2; // 1-indexed シート行番号
  }

  // AI列(35)・AJ列(36)の既存値を取得
  var aiajData = sh.getRange(2, 35, lastRow - 1, 2).getValues();

  var written = 0;
  for (var j = 0; j < data.length; j++) {
    var entry = data[j];
    var mid = String(entry.managedId || '').trim().toUpperCase();
    if (!mid) continue;

    var row = idToRow[mid];
    if (!row) continue;

    var rowIdx = row - 2; // aiajData配列のインデックス
    var existingDate = String(aiajData[rowIdx][0] || '').trim();
    var existingPhotographer = String(aiajData[rowIdx][1] || '').trim();

    // AI列(撮影日付)が空なら書き込み
    if (!existingDate && entry.photographyDate) {
      sh.getRange(row, 35).setValue(entry.photographyDate);
    }
    // AJ列(撮影者)が空なら書き込み
    if (!existingPhotographer && entry.photographer) {
      sh.getRange(row, 36).setValue(entry.photographer);
    }

    if ((!existingDate && entry.photographyDate) || (!existingPhotographer && entry.photographer)) {
      written++;
    }
  }

  return written;
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
