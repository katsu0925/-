// 在庫日数更新.gs
// 毎日4時 Cron: 商品管理シートの 在庫日数 / リードタイム 列を再計算する。
//   在庫日数  = 仕入れ日 → 販売日 (なければ今日)
//   リードタイム = 出品日   → 販売日 (なければ今日)
// 販売日が入っている行は販売日で固定（売却後に日数が増え続けないように）。
// 旧仕様 (在庫日数=出品日→今日 / 終了ステータスで0) からの置換。
function recalcZaikoNissu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('商品管理');
  if (!sheet) { console.log('商品管理シートが見つかりません'); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { console.log('データ行がありません'); return; }
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var purchaseColIndex = headers.indexOf('仕入れ日');
  var listingColIndex = headers.indexOf('出品日');
  var saleDateColIndex = headers.indexOf('販売日');
  var zaikoColIndex = headers.indexOf('在庫日数');
  var leadColIndex = headers.indexOf('リードタイム');

  if (zaikoColIndex === -1 && leadColIndex === -1) {
    console.log('在庫日数/リードタイムのいずれの列も見つかりません');
    return;
  }
  if (purchaseColIndex === -1 && listingColIndex === -1) {
    console.log('仕入れ日/出品日のいずれの列も見つかりません');
    return;
  }

  var rowCount = lastRow - 1;
  var allData = sheet.getRange(2, 1, rowCount, lastCol).getValues();

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayMs = today.getTime();

  function toMidnight_(raw) {
    if (!raw) return null;
    var d;
    if (raw instanceof Date) {
      d = new Date(raw.getTime());
    } else if (typeof raw === 'string') {
      var s = raw.trim();
      if (!s) return null;
      // yyyy/M/d / yyyy-MM-dd / yyyy.MM.dd を許容
      var m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
      if (m) {
        d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else {
        d = new Date(s);
      }
    } else {
      return null;
    }
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function diffDays_(startMs, endMs) {
    if (startMs == null || endMs == null) return null;
    var d = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
    return d >= 0 ? d : null;
  }

  var zaikoOut = zaikoColIndex !== -1 ? new Array(rowCount) : null;
  var leadOut = leadColIndex !== -1 ? new Array(rowCount) : null;

  for (var i = 0; i < rowCount; i++) {
    var row = allData[i];
    var saleMs = saleDateColIndex !== -1 ? toMidnight_(row[saleDateColIndex]) : null;
    var endMs = saleMs != null ? saleMs : todayMs;

    if (zaikoColIndex !== -1) {
      var purMs = purchaseColIndex !== -1 ? toMidnight_(row[purchaseColIndex]) : null;
      var d = diffDays_(purMs, endMs);
      zaikoOut[i] = [d != null ? d : ''];
    }
    if (leadColIndex !== -1) {
      var listMs = listingColIndex !== -1 ? toMidnight_(row[listingColIndex]) : null;
      var ld = diffDays_(listMs, endMs);
      leadOut[i] = [ld != null ? ld : ''];
    }
  }

  if (zaikoOut) {
    sheet.getRange(2, zaikoColIndex + 1, rowCount, 1).setValues(zaikoOut);
  }
  if (leadOut) {
    sheet.getRange(2, leadColIndex + 1, rowCount, 1).setValues(leadOut);
  }
}
