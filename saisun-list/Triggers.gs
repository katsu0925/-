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
    // 5分ごと（ディスパッチャー: 6関数を1トリガーに統合）
    { fn: 'cronEvery5min', type: 'minutes', interval: 5 },
    // 30分ごと
    { fn: 'cronAbandonedCart', type: 'minutes', interval: 30 },
    // 1時間ごと
    { fn: 'cronStatsCache', type: 'hours', interval: 1 },
    // 毎日4時（ディスパッチャー: 確保クリーンアップ + ポイント処理 + ポイント失効 + プロパティ掃除）
    { fn: 'cronDaily4To6', type: 'daily', hour: 4 },
    // 毎日7時（ディスパッチャー: インボイス領収書送付 + キャンセル取消 + BASEトークンチェック）
    { fn: 'cronDaily7', type: 'daily', hour: 7 },
    // 毎日8時（GA4同期 — saisun-list-bulkから戻し）
    { fn: 'ga4SyncAll', type: 'daily', hour: 8 },
    // generateDailyArticle, rewardUpdateDaily → saisun-list-bulk に移動
    // cronProductAnalytics, cronRfmAnalysis → saisun-list-bulk に移動
    // 毎日9時（ディスパッチャー: 2関数を1トリガーに統合）
    { fn: 'cronDaily9', type: 'daily', hour: 9 },
    // 毎日10時
    { fn: 'cronNewArrival', type: 'daily', hour: 10 },
    // 毎日11時
    { fn: 'cronFollowupEmail', type: 'daily', hour: 11 },
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
// cronRfmAnalysis, cronProductAnalytics → saisun-list-bulk に移動
function cronStatsCache() { st_calculateAndCacheStats_(); }
function cronInvoiceReceipts() { processInvoiceReceipts(); }
function cronCancelledInvoices() { processCancelledInvoices(); }

// =====================================================
// ディスパッチャー（同一間隔のトリガーを統合してトリガー数を節約）
// =====================================================

/** 5分ごと: 6関数を1トリガーで実行 */
function cronEvery5min() {
  var fns = [cronExportProducts, baseSyncOrdersNow, baseSyncProductsToBase, notifyUnsentRequests, cronAutoExpandOrders, checkPendingOrders];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](); } catch (e) { console.error('cronEvery5min [' + fns[i].name + ']:', e); }
  }
}

/** 毎日4時: 確保クリーンアップ + ポイント処理 + ポイント失効 + プロパティ掃除 */
function cronDaily4To6() {
  var fns = [cronCompactHolds, cronProcessPoints, cronPointExpiry, cleanupExecute];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](); } catch (e) { console.error('cronDaily4To6 [' + fns[i].name + ']:', e); }
  }
}

/** 毎日7時: インボイス領収書送付 + キャンセル取消 + BASEトークン期限チェック */
function cronDaily7() {
  var fns = [cronInvoiceReceipts, cronCancelledInvoices, cronBaseTokenCheck];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](); } catch (e) { console.error('cronDaily7 [' + fns[i].name + ']:', e); }
  }
}

/** BASEトークンの残り有効期限を確認し、24時間以内なら管理者にメール通知 */
function cronBaseTokenCheck() {
  var props = PropertiesService.getScriptProperties();
  var exp = Number(props.getProperty(BASE_APP.PROP_EXPIRES_AT) || '0');
  if (!exp) return; // BASE未設定

  var remainMs = exp - Date.now();
  var remainHours = Math.floor(remainMs / (60 * 60 * 1000));

  if (remainMs > 24 * 60 * 60 * 1000) return; // 24時間以上あれば問題なし

  var adminEmail = String(props.getProperty('ADMIN_OWNER_EMAIL') || APP_CONFIG.notifyEmails || '').split(',')[0].trim();
  if (!adminEmail) return;

  var subject, body;
  if (remainMs <= 0) {
    subject = '【要対応】BASE APIトークンが期限切れです';
    body = 'BASE APIのアクセストークンが期限切れです。\n' +
           'BASE連携（商品同期・注文同期）が停止しています。\n\n' +
           '対応: GASエディタで baseShowAuthUrl() を実行し、BASE再認証を行ってください。';
  } else {
    subject = '【注意】BASE APIトークンの期限が残り' + remainHours + '時間です';
    body = 'BASE APIのアクセストークンの有効期限が近づいています。\n' +
           '残り約' + remainHours + '時間で期限切れになります。\n\n' +
           '通常は自動リフレッシュされますが、リフレッシュトークンも期限切れの場合は\n' +
           'GASエディタで baseShowAuthUrl() を実行し、BASE再認証を行ってください。';
  }

  try {
    MailApp.sendEmail(adminEmail, subject, body);
    console.log('BASEトークン期限警告メール送信: 残り' + remainHours + '時間');
  } catch (e) {
    console.error('BASEトークン警告メール送信失敗:', e);
  }
}

/** 毎日9時: 2関数を1トリガーで実行 */
function cronDaily9() {
  var fns = [sendPaymentReminders, cronNewsletter];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](); } catch (e) { console.error('cronDaily9 [' + fns[i].name + ']:', e); }
  }
}



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
