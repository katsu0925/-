// CronConfig.gs
// =====================================================
// saisun-list から移動した定期実行ジョブの共有設定
// =====================================================
// 【セットアップ】
// 1. ScriptProperties に DATA_SPREADSHEET_ID を設定
// 2. ScriptProperties に OPENAI_API_KEY を設定（記事生成用）
// 3. ScriptProperties に PEXELS_API_KEY を設定（記事画像用、任意）
// 4. GASエディタ → サービス(+) → 「Google Analytics Data API」追加（GA4用）
// 5. setupCronTriggers() を実行

// =====================================================
// スプレッドシートアクセス
// =====================================================

function cron_getSsId_() {
  return String(PropertiesService.getScriptProperties().getProperty('DATA_SPREADSHEET_ID') || '');
}

function cron_getOrderSs_() {
  return SpreadsheetApp.openById(cron_getSsId_());
}

function cron_getCustomerSheet_() {
  var ss = cron_getOrderSs_();
  return ss.getSheetByName('顧客管理');
}

// =====================================================
// 列定数（saisun-list/Constants.gs と同期）
// =====================================================

var REQUEST_SHEET_COLS = {
  RECEIPT_NO: 1, DATETIME: 2, COMPANY_NAME: 3, CONTACT: 4,
  POSTAL: 5, ADDRESS: 6, PHONE: 7, PRODUCT_NAMES: 8,
  CONFIRM_LINK: 9, SELECTION_LIST: 10, TOTAL_COUNT: 11, TOTAL_AMOUNT: 12,
  SHIP_COST_SHOP: 13, SHIP_COST_CUST: 14, PAYMENT_METHOD: 15, PAYMENT_ID: 16,
  PAYMENT: 17, POINTS_AWARDED: 18, SHIP_STATUS: 19, CARRIER: 20, TRACKING: 21,
  STATUS: 22, STAFF: 23, LIST_ENCLOSED: 24, XLSX_SENT: 25,
  INVOICE_REQ: 26, INVOICE_SENT: 27, NOTIFY_FLAG: 28, SHIP_NOTIFY_FLAG: 29,
  NOTE: 30, REWARD: 31, UPDATED_AT: 32, CHANNEL: 33
};

var CUSTOMER_SHEET_COLS = {
  ID: 0, EMAIL: 1, PASSWORD: 2, COMPANY_NAME: 3, PHONE: 4,
  POSTAL: 5, ADDRESS: 6, NEWSLETTER: 7, CREATED_AT: 8, LAST_LOGIN: 9,
  SESSION_ID: 10, SESSION_EXPIRY: 11, POINTS: 12, POINTS_UPDATED_AT: 13,
  LINE_USER_ID: 14
};

// =====================================================
// トリガー設定（GASエディタから1回実行）
// =====================================================

function setupCronTriggers() {
  var targetFns = [
    'cronProductAnalytics', 'cronRfmAnalysis', 'ga4SyncAll',
    'rewardUpdateDaily', 'generateDailyArticle'
  ];

  // 対象トリガーのみ削除（既存のonOpenトリガー等は残す）
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (targetFns.indexOf(triggers[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 毎日6時
  ScriptApp.newTrigger('ga4SyncAll').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('generateDailyArticle').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('rewardUpdateDaily').timeBased().everyDays(1).atHour(6).create();
  // 毎日7時
  ScriptApp.newTrigger('cronProductAnalytics').timeBased().everyDays(1).atHour(7).create();
  // 毎週月曜7時
  ScriptApp.newTrigger('cronRfmAnalysis').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  var total = ScriptApp.getProjectTriggers().length;
  console.log('cronトリガー設定完了: ' + total + '件');
  return { ok: true, count: total };
}
