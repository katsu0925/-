function setupTrigger_statusSyncOnEdit() {
  const fn = 'statusSync_onEdit';
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction && t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger(fn).forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

function statusSync_onEdit(e) {
  try {
    if (!e || !e.range) return;

    const sh = e.range.getSheet();
    const sheetName = String(sh.getName() || '');

    const reqName = (APP_CONFIG && APP_CONFIG.order && APP_CONFIG.order.requestSheetName) ? String(APP_CONFIG.order.requestSheetName) : '依頼管理';
    if (sheetName !== reqName) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();

    const statusCol = 18;
    if (row <= 1) return;
    if (col !== statusCol) return;

    const receiptNo = String(sh.getRange(row, 1).getValue() || '').trim();
    if (!receiptNo) return;

    const newStatus = String(e.value != null ? e.value : e.range.getValue()).trim();
    if (!newStatus) return;

    const allowed = (APP_CONFIG && APP_CONFIG.statuses && Array.isArray(APP_CONFIG.statuses.allowed)) ? APP_CONFIG.statuses.allowed : [];
    if (allowed.length && allowed.indexOf(newStatus) === -1) return;

    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    const now = (typeof u_nowMs_ === 'function') ? u_nowMs_() : Date.now();

    const openState = st_getOpenState_(orderSs);
    const openItems = openState.items || {};

    let changed = false;
    for (const id in openItems) {
      const it = openItems[id];
      if (!it) continue;
      if (String(it.receiptNo || '') === receiptNo) {
        it.status = newStatus;
        it.updatedAtMs = now;
        changed = true;
      }
    }

    if (changed) {
      openState.items = openItems;
      openState.updatedAt = now;
      st_setOpenState_(orderSs, openState);

      od_writeOpenLogSheetFromState_(orderSs, openItems, now);
      st_invalidateStatusCache_(orderSs);
      return;
    }

    statusSync_updateOpenLogSheetDirect_(orderSs, receiptNo, newStatus);
    st_invalidateStatusCache_(orderSs);

  } catch (err) {
    try { console.error(err && err.message ? err.message : String(err)); } catch (e2) {}
  }
}

function statusSync_updateOpenLogSheetDirect_(orderSs, receiptNo, newStatus) {
  const openName = (APP_CONFIG && APP_CONFIG.order && APP_CONFIG.order.openLogSheetName) ? String(APP_CONFIG.order.openLogSheetName) : '依頼中';
  const sh = orderSs.getSheetByName(openName);
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const headerRow = 1;
  const header = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());

  const receiptCol = statusSync_findCol_(header, ['受付番号', '受付No', '受付Ｎｏ', 'receiptNo'], 2);
  const statusCol = statusSync_findCol_(header, ['ステータス', '状態', 'status'], 3);

  const vals = sh.getRange(2, receiptCol, lastRow - 1, 1).getValues();
  const targets = [];
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === receiptNo) targets.push(i + 2);
  }
  if (!targets.length) return;

  for (let i = 0; i < targets.length; i++) {
    sh.getRange(targets[i], statusCol).setValue(newStatus);
  }
}

function statusSync_findCol_(headerRowValues, names, fallbackCol) {
  const hs = headerRowValues || [];
  const keys = (names || []).map(x => String(x || '').trim()).filter(Boolean);
  for (let i = 0; i < hs.length; i++) {
    const h = String(hs[i] || '').trim();
    if (!h) continue;
    for (let k = 0; k < keys.length; k++) {
      if (h === keys[k]) return i + 1;
    }
  }
  return Number(fallbackCol || 1);
}

// =====================================================
// 発送ステータス自動完了（旧ステータス変更.gs）
// =====================================================

function shippingStatusAutoComplete_(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (!sheet) return;
  if (sheet.getName() !== '依頼管理') return;

  const HEADER_ROW = 1;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  const shipCol = headers.indexOf('発送ステータス') + 1;
  const statusCol = headers.indexOf('ステータス') + 1;
  if (shipCol < 1 || statusCol < 1) return;

  const range = e.range;
  const r1 = range.getRow();
  const r2 = r1 + range.getNumRows() - 1;
  const c1 = range.getColumn();
  const c2 = c1 + range.getNumColumns() - 1;

  if (r2 < HEADER_ROW + 1) return;
  if (shipCol < c1 || shipCol > c2) return;

  const startRow = Math.max(r1, HEADER_ROW + 1);
  const numRows = r2 - startRow + 1;
  if (numRows <= 0) return;

  const shipValues = sheet.getRange(startRow, shipCol, numRows, 1).getDisplayValues();
  const statusRange = sheet.getRange(startRow, statusCol, numRows, 1);
  const statusValues = statusRange.getDisplayValues();

  let changed = false;
  for (let i = 0; i < numRows; i++) {
    const v = String(shipValues[i][0] ?? '').trim();
    if (v === '発送済み') {
      if (String(statusValues[i][0] ?? '').trim() !== '完了') {
        statusValues[i][0] = '完了';
        changed = true;
      }
    }
  }

  if (changed) statusRange.setValues(statusValues);
}
