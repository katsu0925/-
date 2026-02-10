function od_handleRequestSheetStatusEditsUpsert_(orderSs, requestSheet, startRow, endRow, nowMs) {
  const numRows = Math.max(0, endRow - startRow + 1);
  if (!numRows) return;

  const values = requestSheet.getRange(startRow, 1, numRows, 18).getValues();
  const manageMap = new Map();

  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const receiptNo = String(r[0] || '').trim();
    const selectionList = String(r[11] || '');
    const status = String(r[17] || '').trim();
    if (!receiptNo) continue;
    if (!status) continue;

    const manageNos = od_extractManageNos_(selectionList);
    for (let j = 0; j < manageNos.length; j++) {
      manageMap.set(manageNos[j], { receiptNo: receiptNo, status: status });
    }
  }

  const updatedAt = new Date((typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now());
  if (manageMap.size > 0) {
    od_upsertInProgress_(orderSs, manageMap, updatedAt);
  }

  try {
    const open = od_rebuildOpenStateFromRequestSheet_(orderSs);
    if (open && typeof open === 'object') {
      open.updatedAt = (typeof u_nowMs_ === 'function') ? u_nowMs_() : Date.now();
      st_setOpenState_(orderSs, open);
    }
    if (typeof st_invalidateStatusCache_ === 'function') st_invalidateStatusCache_(orderSs);
  } catch (e) {
    console.error('od_handleRequestSheetStatusEditsUpsert_ state sync error:', e);
  }
}

function od_upsertInProgress_(orderSs, manageMap, updatedAt) {
  const sh = od_ensureInProgressSheet_(orderSs);
  const cols = od_getInProgressCols_(sh);

  const lastRow = sh.getLastRow();
  const existingCount = Math.max(0, lastRow - 1);

  const rowByManage = new Map();
  if (existingCount > 0) {
    const manageVals = sh.getRange(2, cols.manageCol, existingCount, 1).getDisplayValues();
    for (let i = 0; i < manageVals.length; i++) {
      const k = String(manageVals[i][0] || '').trim();
      if (k && !rowByManage.has(k)) rowByManage.set(k, 2 + i);
    }
  }

  const toAppend = [];
  const toUpdate = [];

  manageMap.forEach((v, k) => {
    const manageNo = String(k || '').trim();
    if (!manageNo) return;
    const receiptNo = String(v.receiptNo || '').trim();
    const status = String(v.status || '').trim();
    if (!receiptNo || !status) return;

    const row = rowByManage.get(manageNo);
    if (row) {
      toUpdate.push({ row: row, receiptNo: receiptNo, status: status });
    } else {
      toAppend.push([manageNo, receiptNo, status, updatedAt]);
    }
  });

  for (let i = 0; i < toUpdate.length; i++) {
    const u = toUpdate[i];
    sh.getRange(u.row, cols.receiptCol, 1, 3).setValues([[u.receiptNo, u.status, updatedAt]]);
  }

  if (toAppend.length > 0) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, cols.manageCol, toAppend.length, 4).setValues(toAppend);
  }
}

function od_ensureInProgressSheet_(orderSs) {
  const name = od_getInProgressSheetName_();
  let sh = orderSs.getSheetByName(name);
  if (!sh) sh = orderSs.insertSheet(name);

  const need = ['管理番号', '受付番号', 'ステータス', '更新日時'];
  const lastCol = Math.max(4, sh.getLastColumn() || 0);
  const hdr = (lastCol > 0) ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  const map = od_buildHeaderMap_(hdr);

  const hasAll = map['管理番号'] && map['受付番号'] && map['ステータス'] && map['更新日時'];
  if (!hasAll) {
    sh.getRange(1, 1, 1, 4).setValues([need]);
  }
  return sh;
}

function od_getInProgressCols_(sh) {
  const lastCol = Math.max(4, sh.getLastColumn() || 4);
  const hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const map = od_buildHeaderMap_(hdr);

  const manageCol = map['管理番号'] || 1;
  const receiptCol = map['受付番号'] || 2;
  const statusCol = map['ステータス'] || 3;
  const updatedCol = map['更新日時'] || 4;

  return { manageCol: manageCol, receiptCol: receiptCol, statusCol: statusCol, updatedCol: updatedCol };
}

function od_getInProgressSheetName_() {
  try {
    const n = APP_CONFIG && APP_CONFIG.order && APP_CONFIG.order.inProgressSheetName;
    const s = String(n || '').trim();
    if (s) return s;
  } catch (e) {
    console.warn('od_getInProgressSheetName_ error:', e.message || e);
  }
  return '依頼中';
}

function od_buildHeaderMap_(headers) {
  const map = {};
  for (let i = 0; i < (headers || []).length; i++) {
    const h = String(headers[i] || '').trim();
    if (h && !map[h]) map[h] = i + 1;
  }
  return map;
}

function od_extractManageNos_(text) {
  const s = String(text || '');
  const m = s.match(/[A-Za-z]{1,6}\d{1,10}/g) || [];
  const out = [];
  const seen = {};
  for (let i = 0; i < m.length; i++) {
    const t = String(m[i] || '').trim();
    if (!t) continue;
    if (seen[t]) continue;
    seen[t] = true;
    out.push(t);
  }
  return out;
}

function od_compactInProgressSheetOnce_() {
  const orderSs = sh_getOrderSs_();
  const sh = od_ensureInProgressSheet_(orderSs);
  const cols = od_getInProgressCols_(sh);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow <= 2) return { ok: true, before: Math.max(0, lastRow - 1), after: Math.max(0, lastRow - 1) };

  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const keep = new Map();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const k = String(row[cols.manageCol - 1] || '').trim();
    if (!k) continue;
    keep.set(k, row);
  }

  const out = Array.from(keep.values());
  sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (out.length > 0) sh.getRange(2, 1, out.length, lastCol).setValues(out);

  return { ok: true, before: data.length, after: out.length };
}
