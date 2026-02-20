// 在庫日数更新.gs
function recalcZaikoNissu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('商品管理');
  if (!sheet) { console.log('商品管理シートが見つかりません'); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { console.log('データ行がありません'); return; }
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var shuppinColIndex = headers.indexOf('出品日');
  var statusColIndex = headers.indexOf('ステータス');
  var zaikoColIndex = headers.indexOf('在庫日数');
  if (shuppinColIndex === -1 || statusColIndex === -1 || zaikoColIndex === -1) {
    console.log('必要な列（出品日, ステータス, 在庫日数）のどれかが見つかりません');
    return;
  }
  var rowCount = lastRow - 1;
  var minCol = Math.min(shuppinColIndex, statusColIndex, zaikoColIndex);
  var maxCol = Math.max(shuppinColIndex, statusColIndex, zaikoColIndex);
  var allData = sheet.getRange(2, minCol + 1, rowCount, maxCol - minCol + 1).getValues();
  var shuppinOff = shuppinColIndex - minCol;
  var statusOff = statusColIndex - minCol;
  var zaikoOff = zaikoColIndex - minCol;
  var zaikoValues = sheet.getRange(2, zaikoColIndex + 1, rowCount, 1).getValues();
  var endStatuses = ['発送済み', '発送待ち', '売却済み', 'キャンセル', '返品済み', '廃棄済み'];
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  for (var i = 0; i < rowCount; i++) {
    var rawDate = allData[i][shuppinOff];
    var status = allData[i][statusOff];
    if (!rawDate || endStatuses.indexOf(status) !== -1) { zaikoValues[i][0] = 0; continue; }
    var d;
    if (rawDate instanceof Date) { d = new Date(rawDate); }
    else if (typeof rawDate === 'string') {
      var parts = rawDate.split('/');
      if (parts.length === 3) { d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])); }
    }
    if (!d || isNaN(d.getTime())) { zaikoValues[i][0] = 0; continue; }
    d.setHours(0, 0, 0, 0);
    var diffMs = today.getTime() - d.getTime();
    var days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    zaikoValues[i][0] = days >= 0 ? days : 0;
  }
  sheet.getRange(2, zaikoColIndex + 1, rowCount, 1).setValues(zaikoValues);
}
