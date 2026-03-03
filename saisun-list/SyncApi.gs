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

  var imported = { customers: 0 };

  try {
    // 顧客データのインポート（D1 → Sheets）
    if (p.customers && p.customers.length > 0) {
      imported.customers = importCustomers_(p.customers);
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
  var ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  if (!ssId) return [];

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(APP_CONFIG.data.sheetName);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  var headerRow = APP_CONFIG.data.headerRow || 2;
  if (lastRow <= headerRow) return [];

  // 全列読み込み（採寸データまで含む）
  var readCols = Math.max(APP_CONFIG.data.readCols || 25, 32);
  var data = sh.getRange(headerRow + 1, 1, lastRow - headerRow, readCols).getValues();

  var products = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var managedId = u_normalizeId_(String(row[10] || '').trim());
    if (!managedId) continue;

    var qty = Number(row[9]) || 0;
    if (qty <= 0) continue;

    products.push({
      managedId: managedId,
      noLabel: String(row[0] || ''),
      imageUrl: String(row[1] || ''),
      state: String(row[2] || ''),
      brand: String(row[3] || ''),
      size: String(row[4] || ''),
      gender: String(row[5] || ''),
      category: String(row[6] || ''),
      color: String(row[7] || ''),
      price: Number(row[8]) || 0,
      qty: qty,
      defectDetail: String(row[16] || ''),
      shippingMethod: String(row[24] || ''),
      // 採寸データ（Config.gs の detail.columns と対応）
      measureLength: row[11] ? Number(row[11]) : null,
      measureShoulder: row[12] ? Number(row[12]) : null,
      measureBust: row[13] ? Number(row[13]) : null,
      measureSleeve: row[14] ? Number(row[14]) : null,
      measureYuki: row[15] ? Number(row[15]) : null,
      measureTotalLength: null, // 仕入れ管理Ver.2から取得
      measureWaist: null,
      measureRise: null,
      measureInseam: null,
      measureThigh: null,
      measureHemWidth: null,
      measureHip: null
    });
  }

  // 仕入れ管理Ver.2から追加の採寸データを取得
  try {
    var detailSsId = String((APP_CONFIG.detail && APP_CONFIG.detail.spreadsheetId) || '').trim();
    if (detailSsId) {
      var detailSs = SpreadsheetApp.openById(detailSsId);
      var detailSh = detailSs.getSheetByName(APP_CONFIG.detail.sheetName || '商品管理');
      if (detailSh) {
        var detailData = detailSh.getDataRange().getValues();
        var dc = APP_CONFIG.detail.columns;
        var detailMap = {};
        for (var d = 1; d < detailData.length; d++) {
          var dr = detailData[d];
          var mid = u_normalizeId_(String(dr[dc.managedId - 1] || '').trim());
          if (!mid) continue;
          detailMap[mid] = {
            defectDetail: String(dr[dc.defectDetail - 1] || ''),
            measureLength: dr[dc.length - 1] ? Number(dr[dc.length - 1]) : null,
            measureShoulder: dr[dc.shoulder - 1] ? Number(dr[dc.shoulder - 1]) : null,
            measureBust: dr[dc.bust - 1] ? Number(dr[dc.bust - 1]) : null,
            measureSleeve: dr[dc.sleeve - 1] ? Number(dr[dc.sleeve - 1]) : null,
            measureYuki: dr[dc.yuki - 1] ? Number(dr[dc.yuki - 1]) : null,
            measureTotalLength: dr[dc.totalLength - 1] ? Number(dr[dc.totalLength - 1]) : null,
            measureWaist: dr[dc.waist - 1] ? Number(dr[dc.waist - 1]) : null,
            measureRise: dr[dc.rise - 1] ? Number(dr[dc.rise - 1]) : null,
            measureInseam: dr[dc.inseam - 1] ? Number(dr[dc.inseam - 1]) : null,
            measureThigh: dr[dc.thigh - 1] ? Number(dr[dc.thigh - 1]) : null,
            measureHemWidth: dr[dc.hemWidth - 1] ? Number(dr[dc.hemWidth - 1]) : null,
            measureHip: dr[dc.hip - 1] ? Number(dr[dc.hip - 1]) : null
          };
        }

        // 商品データに採寸詳細をマージ
        for (var p = 0; p < products.length; p++) {
          var detail = detailMap[products[p].managedId];
          if (detail) {
            if (detail.defectDetail) products[p].defectDetail = detail.defectDetail;
            if (detail.measureLength != null) products[p].measureLength = detail.measureLength;
            if (detail.measureShoulder != null) products[p].measureShoulder = detail.measureShoulder;
            if (detail.measureBust != null) products[p].measureBust = detail.measureBust;
            if (detail.measureSleeve != null) products[p].measureSleeve = detail.measureSleeve;
            if (detail.measureYuki != null) products[p].measureYuki = detail.measureYuki;
            if (detail.measureTotalLength != null) products[p].measureTotalLength = detail.measureTotalLength;
            if (detail.measureWaist != null) products[p].measureWaist = detail.measureWaist;
            if (detail.measureRise != null) products[p].measureRise = detail.measureRise;
            if (detail.measureInseam != null) products[p].measureInseam = detail.measureInseam;
            if (detail.measureThigh != null) products[p].measureThigh = detail.measureThigh;
            if (detail.measureHemWidth != null) products[p].measureHemWidth = detail.measureHemWidth;
            if (detail.measureHip != null) products[p].measureHip = detail.measureHip;
          }
        }
      }
    }
  } catch (detailErr) {
    console.log('exportProducts_: detail merge error:', detailErr);
  }

  return products;
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
      purchaseCount: Number(row[c.PURCHASE_COUNT]) || 0
    });
  }

  return customers;
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
    newRow[c.NEWSLETTER] = cust.newsletter || false;
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
