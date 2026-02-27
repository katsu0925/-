// Triggers.gs
function ad_initAdminOwnerAndKeyOnce() {
  const email = String((Session.getEffectiveUser && Session.getEffectiveUser().getEmail ? Session.getEffectiveUser().getEmail() : '') || '').trim() ||
                String((Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : '') || '').trim();
  if (!email) return { ok: false, message: 'この関数はスクリプトエディタから実行してください' };
  const props = PropertiesService.getScriptProperties();
  let owner = String(props.getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim();
  if (!owner) {
    props.setProperty(APP_CONFIG.admin.ownerEmailProp, email);
    owner = email;
  }
  if (owner !== email) return { ok: false, message: '所有者が一致しません: ' + email };
  let key = String(props.getProperty(APP_CONFIG.admin.accessKeyProp) || '').trim();
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, u_toInt_(APP_CONFIG.admin.accessKeyLen, 24));
    props.setProperty(APP_CONFIG.admin.accessKeyProp, key);
  }
  return { ok: true, ownerEmail: owner, accessKey: key };
}

function ad_requireAdmin_(adminKey) {
  const key = String(adminKey || '').trim();
  if (!key) throw new Error('権限がありません');
  const props = PropertiesService.getScriptProperties();
  // ADMIN_ACCESS_KEY（ad_initAdminOwnerAndKeyOnce で自動生成）と
  // ADMIN_KEY（setAdminKey で手動設定）の両方を許可
  const savedAccess = String(props.getProperty(APP_CONFIG.admin.accessKeyProp) || '').trim();
  const savedManual = String(props.getProperty('ADMIN_KEY') || '').trim();
  console.log('ad_requireAdmin_: key.len=' + key.length +
    ', ACCESS_KEY=' + (savedAccess ? 'set(' + savedAccess.length + 'chars)' : 'empty') +
    ', ADMIN_KEY=' + (savedManual ? 'set(' + savedManual.length + 'chars)' : 'empty') +
    ', matchAccess=' + (savedAccess ? timingSafeEqual_(key, savedAccess) : 'N/A') +
    ', matchManual=' + (savedManual ? timingSafeEqual_(key, savedManual) : 'N/A'));
  if (!savedAccess && !savedManual) throw new Error('管理キーが未設定です（ad_initAdminOwnerAndKeyOnce をスクリプトエディタから実行してください）');
  if ((savedAccess && timingSafeEqual_(key, savedAccess)) ||
      (savedManual && timingSafeEqual_(key, savedManual))) {
    return; // 認証OK
  }
  throw new Error('権限がありません');
}

// =====================================================
// トリガー設定・onEditハンドラ（旧WebApp.gs）
// =====================================================

/**
 * GASエディタから手動実行：全トリガーを削除して再構築
 */
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  console.log('既存トリガー ' + triggers.length + '件を全削除');
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  return tr_setupTriggersOnce_();
}

function tr_setupTriggersOnce_() {
  // =====================================================
  // 1. onEditトリガー（スプレッドシート別）
  // =====================================================
  var orderSs = sh_getOrderSs_();
  var dataSs = sh_getDataSs_();

  // メインonEdit（注文SS + データSS）
  ScriptApp.newTrigger('onEdit').forSpreadsheet(orderSs).onEdit().create();
  ScriptApp.newTrigger('onEdit').forSpreadsheet(dataSs).onEdit().create();

  // 発送通知onEdit（注文SS = SHIPMAIL_CONFIG.SPREADSHEET_ID）
  ScriptApp.newTrigger('shipMailOnEdit').forSpreadsheet(orderSs).onEdit().create();

  // ステータス同期onEdit（注文SS）
  ScriptApp.newTrigger('statusSync_onEdit').forSpreadsheet(orderSs).onEdit().create();

  // 仕入れ→データ1同期onEdit + onFormSubmit
  try {
    var srcSsId = String((APP_CONFIG.detail && APP_CONFIG.detail.spreadsheetId) || '');
    if (srcSsId) {
      var srcSs = SpreadsheetApp.openById(srcSsId);
      ScriptApp.newTrigger('syncListingPublic').forSpreadsheet(srcSs).onEdit().create();
      ScriptApp.newTrigger('syncListingPublic').forSpreadsheet(srcSs).onFormSubmit().create();
    }
  } catch (e) { console.log('syncListingPublicトリガー設定スキップ: ' + (e.message || e)); }

  // =====================================================
  // 2. timeBasedトリガー（全て一元管理）
  // =====================================================
  var timeBasedTriggers = [
    // 毎分
    { fn: 'syncListingPublicCron', type: 'minutes', interval: 1 },
    // 5分ごと
    { fn: 'cronExportProducts', type: 'minutes', interval: 5 },
    { fn: 'baseSyncOrdersNow', type: 'minutes', interval: 5 },
    { fn: 'baseSyncProductsToBase', type: 'minutes', interval: 5 },
    // 15分ごと
    { fn: 'cronAbandonedCart', type: 'minutes', interval: 15 },
    // 1時間ごと
    { fn: 'cronStatsCache', type: 'hours', interval: 1 },
    // 毎日4時
    { fn: 'cronCompactHolds', type: 'daily', hour: 4 },
    // 毎日5時
    { fn: 'cronProcessPoints', type: 'daily', hour: 5 },
    // 毎日6時
    { fn: 'cronPointExpiry', type: 'daily', hour: 6 },
    { fn: 'generateDailyArticle', type: 'daily', hour: 6 },
    { fn: 'ga4SyncAll', type: 'daily', hour: 6 },
    { fn: 'rewardUpdateDaily', type: 'daily', hour: 6 },
    // 毎日7時
    { fn: 'cronProductAnalytics', type: 'daily', hour: 7 },
    // 毎日9時
    { fn: 'sendPaymentReminders', type: 'daily', hour: 9 },
    { fn: 'cronNewsletter', type: 'daily', hour: 9 },
    // 毎日10時
    { fn: 'cronNewArrival', type: 'daily', hour: 10 },
    // 毎日11時
    { fn: 'cronFollowupEmail', type: 'daily', hour: 11 },
    // 毎週月曜7時
    { fn: 'cronRfmAnalysis', type: 'weekly', hour: 7 }
  ];

  for (var i = 0; i < timeBasedTriggers.length; i++) {
    var pt = timeBasedTriggers[i];
    if (pt.type === 'minutes') {
      ScriptApp.newTrigger(pt.fn).timeBased().everyMinutes(pt.interval).create();
    } else if (pt.type === 'hours') {
      ScriptApp.newTrigger(pt.fn).timeBased().everyHours(pt.interval).create();
    } else if (pt.type === 'daily') {
      ScriptApp.newTrigger(pt.fn).timeBased().everyDays(1).atHour(pt.hour).create();
    } else if (pt.type === 'weekly') {
      ScriptApp.newTrigger(pt.fn).timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(pt.hour).create();
    }
  }

  var total = ScriptApp.getProjectTriggers().length;
  console.log('トリガー設定完了: ' + total + '件');
  return { ok: true, count: total };
}

// =====================================================
// トリガー用公開ラッパー（プライベート関数はトリガーから呼べないため）
// =====================================================
function cronCompactHolds() { od_compactHolds_(); }
function cronProcessPoints() { processCustomerPointsAuto_(); }
function cronExportProducts() { exportProductData_(); }
function cronAbandonedCart() { abandonedCartCron_(); }
function cronNewArrival() { newArrivalNotifyCron_(); }
function cronFollowupEmail() { followupEmailCron_(); }
function cronNewsletter() { newsletterSendCron_(); }
function cronPointExpiry() { pointExpiryCron_(); }
function cronRfmAnalysis() { rfmAnalysisCron_(); }
function cronProductAnalytics() { productAnalyticsCron_(); }
function cronStatsCache() { st_calculateAndCacheStats_(); }

function onEdit(e) {
  try {
    if (!e || !e.range || !e.source) return;

    const ss = e.source;
    const sheet = e.range.getSheet();
    if (!sheet) return;

    const ssId = ss.getId();
    const orderId = app_getOrderSpreadsheetId_();
    const dataId = String(APP_CONFIG.data.spreadsheetId);

    if (ssId === dataId && sheet.getName() === APP_CONFIG.data.sheetName) {
      const r = e.range;
      const row = r.getRow();
      const col = r.getColumn();
      const numRows = r.getNumRows();
      const numCols = r.getNumColumns();
      const headerRow = Number(APP_CONFIG.data.headerRow || 3);
      const startRow = headerRow + 1;
      if (row + numRows - 1 >= startRow && col <= Number(APP_CONFIG.data.readCols || 11) && (col + numCols - 1) >= 1) {
        pr_bumpProductsVersion_();
        pr_clearProductsCache_();
      }
      return;
    }

    if (ssId === orderId && sheet.getName() === String(APP_CONFIG.order.requestSheetName || '依頼管理')) {
      const r = e.range;
      const row = r.getRow();
      const col = r.getColumn();
      const numRows = r.getNumRows();
      const numCols = r.getNumColumns();
      if (row < 2) return;

      const colEnd = col + numCols - 1;

      const orderSs = sh_getOrderSs_();
      sh_ensureAllOnce_(orderSs);

      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return;

      try {
        const nowMs = u_nowMs_();

        const statusCol = (typeof REQUEST_SHEET_COLS !== 'undefined' && REQUEST_SHEET_COLS.STATUS) ? REQUEST_SHEET_COLS.STATUS : 22;
        if (col <= statusCol && statusCol <= colEnd) {
          const start = row;
          const end = row + numRows - 1;
          od_handleRequestSheetStatusEdits_(orderSs, sheet, start, end, nowMs);
          return;
        }

        shippingStatusAutoComplete_(e);

        // 発送済みメール通知（独立トリガーが発火しない場合の保険）
        try { shipMailOnEdit(e); } catch (shipErr) {
          console.error('shipMailOnEdit error in onEdit:', shipErr);
        }
        return;

      } finally {
        lock.releaseLock();
      }
    }
    // 依頼中シートの編集・行削除を検知してopenStateを再構築
    const openLogSheetName = String(APP_CONFIG.order.openLogSheetName || '依頼中');
    if (ssId === orderId && sheet.getName() === openLogSheetName) {
      try {
        const orderSs = sh_getOrderSs_();
        od_rebuildOpenStateFromOpenLogSheet_(orderSs);
      } catch (e2) {
        console.error('依頼中シート同期エラー:', e2);
      }
      return;
    }

  } catch (err) {
    console.error('onEdit error:', err);
  }
}
