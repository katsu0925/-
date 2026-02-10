function updateReturnedToSold() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("商品管理");
  if (!sheet) throw new Error("シート「商品管理」が見つかりません");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const numRows = lastRow - 1;
  const range = sheet.getRange(2, 5, numRows, 40);
  const values = range.getValues();
  const outE = new Array(numRows);
  let changed = 0;
  for (let i = 0; i < numRows; i++) {
    const status = values[i][0];
    const ar = values[i][39];
    const arNum = (typeof ar === "number") ? ar : Number(String(ar).replace(/,/g, "").trim());
    const hasArAtLeast1 = !isNaN(arNum) && arNum >= 1;
    if (status === "返品済み" && hasArAtLeast1) { outE[i] = ["売却済み"]; changed++; }
    else { outE[i] = [status]; }
  }
  sheet.getRange(2, 5, numRows, 1).setValues(outE);
  Logger.log("変更件数: " + changed);
}
