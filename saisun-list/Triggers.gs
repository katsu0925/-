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

function tr_setupTriggersOnce_() {
  const orderSs = sh_getOrderSs_();
  const dataSs = sh_getDataSs_();
  const targets = {};
  targets[orderSs.getId()] = true;
  targets[dataSs.getId()] = true;

  const triggers = ScriptApp.getProjectTriggers();
  const has = {};
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const fn = t.getHandlerFunction ? t.getHandlerFunction() : '';
    const sid = t.getTriggerSourceId ? t.getTriggerSourceId() : '';
    if (fn === 'onEdit' && sid) has[sid] = true;
  }

  for (const sid in targets) {
    if (has[sid]) continue;
    ScriptApp.newTrigger('onEdit').forSpreadsheet(SpreadsheetApp.openById(sid)).onEdit().create();
  }

  const t2 = ScriptApp.getProjectTriggers();
  let hasDaily = false;
  for (let i = 0; i < t2.length; i++) {
    const t = t2[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === 'od_compactHolds_') {
      hasDaily = true;
      break;
    }
  }
  if (!hasDaily) ScriptApp.newTrigger('od_compactHolds_').timeBased().everyDays(1).atHour(4).create();

  // 顧客ポイント付与トリガー（毎日5時に自動実行）
  var hasPointsTrigger = false;
  var t3 = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t3.length; i++) {
    if (t3[i].getHandlerFunction && t3[i].getHandlerFunction() === 'processCustomerPointsAuto_') {
      hasPointsTrigger = true;
      break;
    }
  }
  if (!hasPointsTrigger) ScriptApp.newTrigger('processCustomerPointsAuto_').timeBased().everyDays(1).atHour(5).create();

  return { ok: true };
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
