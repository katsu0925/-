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

        const statusCol = 18;
        if (col <= statusCol && statusCol <= colEnd) {
          const start = row;
          const end = row + numRows - 1;
          od_handleRequestSheetStatusEdits_(orderSs, sheet, start, end, nowMs);
          return;
        }

        shippingStatusAutoComplete_(e);
        return;

      } finally {
        lock.releaseLock();
      }
    }
  } catch (err) {
  }
}
