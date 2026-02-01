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
