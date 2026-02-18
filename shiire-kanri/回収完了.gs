function stampByThreshold() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('在庫分析');
  var headerRow = 15;
  var startRow = 16;
  var lastRow = sh.getLastRow();
  if (lastRow < startRow) return;

  var headers = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getValues()[0];
  var percentCol = headers.indexOf('回収割合') + 1;
  var stampCol = headers.indexOf('回収完了日') + 1;
  if (percentCol < 1 || stampCol < 1) return;

  var validationsRow = sh.getRange(14, 1, 1, sh.getLastColumn()).getDataValidations()[0];
  var thresholdCol = -1;
  for (var i = 0; i < validationsRow.length; i++) {
    if (validationsRow[i]) {
      thresholdCol = i + 1;
      break;
    }
  }
  if (thresholdCol === -1) return;

  var rawThresholdStr = sh.getRange(14, thresholdCol).getDisplayValue();
  if (rawThresholdStr === '' || rawThresholdStr == null) return;
  var m = String(rawThresholdStr).match(/[\d\.]+/);
  if (!m) return;
  var tn = Number(m[0]);
  if (isNaN(tn)) return;
  var threshold = tn / 100;

  var recsDisp = sh.getRange(startRow, percentCol, lastRow - startRow + 1, 1).getDisplayValues();
  var stamps = sh.getRange(startRow, stampCol, lastRow - startRow + 1, 1).getValues();

  for (var r = 0; r < recsDisp.length; r++) {
    var disp = recsDisp[r][0];
    if (disp === '' || disp == null) continue;

    var m2 = String(disp).match(/[\d\.]+/);
    if (!m2) continue;
    var vn = Number(m2[0]);
    if (isNaN(vn)) continue;
    var v = vn / 100;

    if (v >= threshold && !stamps[r][0]) {
      sh.getRange(startRow + r, stampCol).setValue(new Date());
    }
  }
}

// toggleKaishuKanryoFilter は不要になったため削除
