// 回収完了.gs
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

  var nRows = lastRow - startRow + 1;
  var recsDisp = sh.getRange(startRow, percentCol, nRows, 1).getDisplayValues();
  var stamps = sh.getRange(startRow, stampCol, nRows, 1).getValues();

  var changed = false;
  var now = new Date();
  for (var r = 0; r < recsDisp.length; r++) {
    var disp = recsDisp[r][0];
    if (disp === '' || disp == null) continue;

    var m2 = String(disp).match(/[\d\.]+/);
    if (!m2) continue;
    var vn = Number(m2[0]);
    if (isNaN(vn)) continue;
    var v = vn / 100;

    if (v >= threshold && !stamps[r][0]) {
      stamps[r][0] = now;
      changed = true;
    }
  }
  if (changed) {
    sh.getRange(startRow, stampCol, nRows, 1).setValues(stamps);
  }
}

// toggleKaishuKanryoFilter は不要になったため削除
