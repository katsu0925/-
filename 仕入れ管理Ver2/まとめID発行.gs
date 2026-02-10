const RC_TARGET_SHEET_NAME = '回収完了';
const RC_HEADER_ROW = 6;
const RC_START_ROW = RC_HEADER_ROW + 1;
const RC_CHECKBOX_COL = 1;
const RC_OUTPUT_COL = 13;
const RC_TZ = 'Asia/Tokyo';
const RC_CLEAR_ON_UNCHECK = true;

const RC_BULK_KEY_COL = 2;

function rc_bulkCheckVisibleRowsAndSetBatchId() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(RC_TARGET_SHEET_NAME);
    if (!sheet) throw new Error('シート「' + RC_TARGET_SHEET_NAME + '」が見つかりません');

    const lastRow = sheet.getLastRow();
    if (lastRow < RC_START_ROW) return;

    let startRow = RC_START_ROW;
    let endRow = lastRow;

    const filter = sheet.getFilter();
    if (filter) {
      const fr = filter.getRange();
      const frLast = fr.getLastRow();
      if (frLast >= startRow) endRow = Math.min(endRow, frLast);
    }

    if (endRow < startRow) return;

    const n = endRow - startRow + 1;

    const checkValues = sheet.getRange(startRow, RC_CHECKBOX_COL, n, 1).getValues();
    const mValues = sheet.getRange(startRow, RC_OUTPUT_COL, n, 1).getValues();

    const prefix = Utilities.formatDate(new Date(), RC_TZ, 'yyMMdd');
    const used = new Set();
    for (let i = 0; i < mValues.length; i++) {
      const s = String(mValues[i][0] ?? '').trim();
      if (s && s.startsWith(prefix)) used.add(s);
    }
    const batchId = rc_makeUniqueCode_(prefix, used);

    const targets = new Array(n).fill(false);

    for (let i = 0; i < n; i++) {
      const checked = checkValues[i][0] === true;
      if (!checked) continue;
      targets[i] = true;
    }

    const segments = rc_targetsToSegments_(targets, startRow);
    if (segments.length === 0) {
      ss.toast('対象行がありません（チェック済みの行が0件）', '回収完了', 5);
      return;
    }

    let total = 0;

    for (const seg of segments) {
      const len = seg.len;
      const mArr = Array.from({ length: len }, () => [batchId]);
      sheet.getRange(seg.start, RC_OUTPUT_COL, len, 1).setValues(mArr);
      total += len;
    }

    ss.toast('まとめID: ' + batchId + ' / 対象 ' + total + ' 行', '回収完了', 5);
  } finally {
    lock.releaseLock();
  }
}

function rc_getVisibleFlagsFast_(spreadsheetId, sheetId, sheetName, startRow, endRow) {
  try {
    if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || !Sheets.Spreadsheets.get) return null;

    const res = Sheets.Spreadsheets.get(spreadsheetId, {
      includeGridData: true,
      ranges: [sheetName + '!A' + startRow + ':A' + endRow],
      fields: 'sheets(properties(sheetId),data(rowMetadata(hiddenByFilter,hiddenByUser)))'
    });

    const sheets = (res && res.sheets) ? res.sheets : [];
    let target = null;
    for (let i = 0; i < sheets.length; i++) {
      const p = sheets[i].properties;
      if (p && p.sheetId === sheetId) {
        target = sheets[i];
        break;
      }
    }
    if (!target || !target.data || !target.data[0] || !target.data[0].rowMetadata) return null;

    const meta = target.data[0].rowMetadata;
    const n = endRow - startRow + 1;
    if (!Array.isArray(meta) || meta.length < n) return null;

    const flags = new Array(n);
    for (let i = 0; i < n; i++) {
      const rm = meta[i] || {};
      const hiddenF = rm.hiddenByFilter === true;
      const hiddenU = rm.hiddenByUser === true;
      flags[i] = !(hiddenF || hiddenU);
    }
    return flags;
  } catch (e) {
    return null;
  }
}

function rc_targetsToSegments_(targets, startRow) {
  const segs = [];
  let inSeg = false;
  let segStart = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i] === true;
    if (t && !inSeg) {
      inSeg = true;
      segStart = i;
    } else if (!t && inSeg) {
      const start = startRow + segStart;
      const len = i - segStart;
      segs.push({ start, len });
      inSeg = false;
    }
  }
  if (inSeg) {
    const start = startRow + segStart;
    const len = targets.length - segStart;
    segs.push({ start, len });
  }
  return segs;
}

function rc_handleRecoveryCompleteOnEdit_(e) {
  if (!e || !e.range) return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;

  try {
    const range = e.range;
    const sheet = range.getSheet();
    if (!sheet || sheet.getName() !== RC_TARGET_SHEET_NAME) return;

    const startRow = range.getRow();
    const numRows = range.getNumRows();
    const startCol = range.getColumn();
    const numCols = range.getNumColumns();
    const endRow = startRow + numRows - 1;
    const endCol = startCol + numCols - 1;

    if (endRow < RC_START_ROW) return;
    if (startCol > RC_CHECKBOX_COL || endCol < RC_CHECKBOX_COL) return;

    const values = range.getValues();
    const colOffset = RC_CHECKBOX_COL - startCol;

    const targets = [];
    for (let i = 0; i < numRows; i++) {
      const r = startRow + i;
      if (r < RC_START_ROW) continue;
      const v = values[i][colOffset];
      const checked = (v === true || String(v).toUpperCase() === 'TRUE');
      const unchecked = (v === false || String(v).toUpperCase() === 'FALSE');
      if (checked || unchecked) targets.push({ row: r, checked });
    }
    if (targets.length === 0) return;

    const maxRow = Math.max(sheet.getLastRow(), endRow);
    if (maxRow < RC_START_ROW) return;

    const prefix = Utilities.formatDate(new Date(), RC_TZ, 'yyMMdd');

    const mRange = sheet.getRange(RC_START_ROW, RC_OUTPUT_COL, maxRow - RC_START_ROW + 1, 1);
    const mValues = mRange.getValues();

    const used = new Set();
    for (let i = 0; i < mValues.length; i++) {
      const s = String(mValues[i][0] ?? '').trim();
      if (s && s.startsWith(prefix)) used.add(s);
    }

    let changed = false;

    for (const t of targets) {
      const idx = t.row - RC_START_ROW;
      if (idx < 0 || idx >= mValues.length) continue;

      const current = String(mValues[idx][0] ?? '').trim();

      if (t.checked) {
        if (!current) {
          const next = rc_makeUniqueCode_(prefix, used);
          mValues[idx][0] = next;
          used.add(next);
          changed = true;
        }
      } else {
        if (RC_CLEAR_ON_UNCHECK && current) {
          mValues[idx][0] = '';
          changed = true;
        }
      }
    }

    if (changed) mRange.setValues(mValues);
  } finally {
    lock.releaseLock();
  }
}

function rc_makeUniqueCode_(prefix, used) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 5000; i++) {
    const s1 = letters.charAt(Math.floor(Math.random() * 26));
    const s2 = letters.charAt(Math.floor(Math.random() * 26));
    const code = prefix + s1 + s2;
    if (!used.has(code)) return code;
  }
  for (let i = 0; i < 5000; i++) {
    const u = Utilities.getUuid().replace(/-/g, '').slice(0, 3).toUpperCase();
    const code = prefix + u;
    if (!used.has(code)) return code;
  }
  throw new Error('ユニークID生成に失敗しました');
}
