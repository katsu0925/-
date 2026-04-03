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
    // 毎日8時（ディスパッチャー: GA4同期 + 月次在庫サマリーメール）
    { fn: 'cronDaily8', type: 'daily', hour: 8 },
    // generateDailyArticle, rewardUpdateDaily → saisun-list-bulk に移動
    // cronProductAnalytics, cronRfmAnalysis → saisun-list-bulk に移動
    // 毎日9時（ディスパッチャー: 2関数を1トリガーに統合）
    { fn: 'cronDaily9', type: 'daily', hour: 9 },
    // 毎日10時
    { fn: 'cronNewArrival', type: 'daily', hour: 10 },
    // 毎日10:30（週3メルマガ: 火木土のみ配信、他曜日はスキップ）
    { fn: 'cronWeeklyNewsletter', type: 'daily', hour: 10 },
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
function cronWeeklyNewsletter() { weeklyNewsletterCron_(); }
function cronFollowupEmail() { followupEmailCron_(); }
function cronNewsletter() { newsletterSendCron_(); }
function cronDormantCoupon() { dormantCouponCron_(); }
function cronPointExpiry() { pointExpiryCron_(); }
// cronRfmAnalysis, cronProductAnalytics → saisun-list-bulk に移動
function cronArchiveOrders() { od_archiveCompletedOrders_(); }
function cronStatsCache() { st_calculateAndCacheStats_(); }
function cronInvoiceReceipts() { processInvoiceReceipts(); }
function cronCancelledInvoices() { processCancelledInvoices(); }

// =====================================================
// ディスパッチャー共通（エラー時LINE通知付き）
// =====================================================

/** ディスパッチャー共通: 関数リストを順次実行し、エラーがあればLINE通知 */
function runWithErrorNotify_(dispatcherName, fns) {
  var errors = [];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](); } catch (e) {
      console.error(dispatcherName + ' [' + fns[i].name + ']:', e);
      errors.push(fns[i].name + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  if (errors.length > 0) {
    try {
      var token = getLineAccessToken_();
      var toId = getLineToId_();
      if (token && toId) {
        var msg = '【エラー通知】' + dispatcherName + '\n' + errors.join('\n');
        if (msg.length > 500) msg = msg.substring(0, 497) + '...';
        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post', contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + token },
          payload: JSON.stringify({ to: toId, messages: [{ type: 'text', text: msg }] }),
          muteHttpExceptions: true
        });
      }
    } catch (lineErr) { console.error('エラーLINE通知失敗:', lineErr); }
  }
}

// =====================================================
// ディスパッチャー（同一間隔のトリガーを統合してトリガー数を節約）
// =====================================================

/** 5分ごと: 7関数を1トリガーで実行 */
function cronEvery5min() {
  runWithErrorNotify_('cronEvery5min', [cronExportProducts, baseSyncOrdersNow, baseSyncProductsToBase, notifyUnsentRequests, cronAutoExpandOrders, checkPendingOrders, checkAwaitingPayments]);
}

/** 毎日4時: 確保クリーンアップ + ポイント処理 + ポイント失効 + プロパティ掃除 */
function cronDaily4To6() {
  runWithErrorNotify_('cronDaily4To6', [cronCompactHolds, cronProcessPoints, cronPointExpiry, cleanupExecute, cronArchiveOrders]);
}

/** 毎日7時: インボイス領収書送付 + キャンセル取消 + BASEトークン期限チェック */
function cronDaily7() {
  runWithErrorNotify_('cronDaily7', [cronInvoiceReceipts, cronCancelledInvoices, cronBaseTokenCheck]);
}

/** BASEトークンのリフレッシュを試み、失敗した場合のみ管理者にメール通知 */
function cronBaseTokenCheck() {
  var props = PropertiesService.getScriptProperties();
  var access = String(props.getProperty(BASE_APP.PROP_ACCESS_TOKEN) || '').trim();
  if (!access) return; // BASE未設定

  // 自動リフレッシュを試みる（baseGetAccessToken_が期限切れなら自動更新）
  try {
    baseGetAccessToken_();
    // リフレッシュ成功 → 通知不要（アクセストークンは短命だが自動更新で正常運用）
    return;
  } catch (e) {
    console.error('cronBaseTokenCheck: トークンリフレッシュ失敗:', e);
  }

  // リフレッシュ失敗 → 再認証が必要
  var adminEmail = String(props.getProperty('ADMIN_OWNER_EMAIL') || APP_CONFIG.notifyEmails || '').split(',')[0].trim();
  if (!adminEmail) return;

  var subject = '【要対応】BASE APIトークンの自動更新に失敗しました';
  var body = 'BASE APIのアクセストークンの自動リフレッシュに失敗しました。\n' +
             'リフレッシュトークンが期限切れの可能性があります。\n\n' +
             '対応: GASエディタで baseShowAuthUrl() を実行し、BASE再認証を行ってください。';

  try {
    MailApp.sendEmail(adminEmail, subject, body);
    console.log('BASEトークン再認証必要メール送信');
  } catch (e) {
    console.error('BASEトークン警告メール送信失敗:', e);
  }
}

/** 毎日8時: GA4同期 + 月次在庫サマリーメール(1日のみ) */
function cronDaily8() {
  runWithErrorNotify_('cronDaily8', [ga4SyncAll, sendMonthlyStockSummary]);
}

/** 毎日9時: 4関数を1トリガーで実行 */
function cronDaily9() {
  runWithErrorNotify_('cronDaily9', [sendPaymentReminders, cancelExpiredPayments, cronNewsletter, cronDormantCoupon, cronDailySummary, ga4advice_cron]);
}

// =====================================================
// 毎朝の業務サマリーLINE通知
// =====================================================

/** 依頼管理シートの状態を集計してLINE通知 */
function cronDailySummary() {
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (!sh) return;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var data = sh.getRange(2, 1, lastRow - 1, 33).getValues();

  var pendingPayment = 0; // 入金待ち
  var pendingShip = 0;    // 発送待ち
  var newToday = 0;       // 本日新規

  var today = new Date();
  var todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy/MM/dd');

  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][21] || '').trim(); // V列: ステータス
    if (status === '完了' || status === 'キャンセル' || status === '返品') continue;
    if (!data[i][0]) continue; // 受付番号が空ならスキップ

    var payment = String(data[i][16] || '').trim(); // Q列: 入金確認
    var shipStatus = String(data[i][18] || '').trim(); // S列: 発送ステータス

    // 入金待ち: 入金確認が空
    if (!payment || payment === 'FALSE' || payment === 'false') {
      pendingPayment++;
    }
    // 発送待ち: 入金済み & 未発送
    else if (shipStatus !== '発送済み') {
      pendingShip++;
    }

    // 本日の新規注文
    var dateVal = data[i][1]; // B列: 依頼日時
    if (dateVal instanceof Date) {
      var dateStr = Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy/MM/dd');
      if (dateStr === todayStr) newToday++;
    }
  }

  // 全て0件なら通知しない
  if (pendingPayment === 0 && pendingShip === 0 && newToday === 0) return;

  var message = '【朝の業務サマリー】\n' +
    '入金待ち: ' + pendingPayment + '件\n' +
    '発送待ち: ' + pendingShip + '件\n' +
    '本日の新規注文: ' + newToday + '件';

  var token = getLineAccessToken_();
  var toId = getLineToId_();
  if (!token || !toId) {
    // LINE未設定ならメールで送信
    var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || APP_CONFIG.notifyEmails || '').split(',')[0].trim();
    if (adminEmail) {
      try { MailApp.sendEmail(adminEmail, '【デタウリ】朝の業務サマリー', message); } catch (e) {}
    }
    return;
  }

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: toId, messages: [{ type: 'text', text: message }] }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.error('業務サマリーLINE通知失敗:', e);
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
        // shipMailOnEdit は専用トリガーで発火するため、ここでは呼ばない
        // （両方呼ぶと競合でメールが2通送信されるバグの原因）
        return;

      } finally {
        lock.releaseLock();
      }
    }
    // SNSシェア管理シートのF列（ステータス）変更を検知
    if (ssId === orderId && sheet.getName() === 'SNSシェア管理') {
      const r = e.range;
      const row = r.getRow();
      const col = r.getColumn();
      if (row >= 2 && col === 6) { // F列 = ステータス
        var newValue = String(r.getValue());
        if (newValue === '承認') {
          approveSnsShare_(sheet, row);
        } else if (newValue === '却下') {
          rejectSnsShare_(sheet, row);
        }
      }
      return;
    }

    // 顧客管理シート編集時: CUSTOMER/SESSIONキャッシュを無効化
    if (ssId === orderId && sheet.getName() === '顧客管理') {
      try {
        var r = e.range;
        var row = r.getRow();
        if (row >= 2) {
          var email = String(sheet.getRange(row, 2).getValue() || '').trim().toLowerCase();
          var sessionId = String(sheet.getRange(row, 11).getValue() || '');
          var cache = CacheService.getScriptCache();
          if (email) cache.remove('CUSTOMER:' + email);
          if (sessionId) cache.remove('SESSION:' + sessionId);
        }
      } catch (e2) {
        console.error('顧客キャッシュ無効化エラー:', e2);
      }
      return;
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
