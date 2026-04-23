// タスキ箱チェック.gs — 商品管理シートのうち対象ステータスの管理番号をJSONで返す一時エンドポイント
// 使い方: Web AppのURLに ?check=tsk を付けてアクセス
function tskCheck_(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (ssId) ss = SpreadsheetApp.openById(ssId);
  }
  var sh = ss && ss.getSheetByName('商品管理');
  if (!sh) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '商品管理 not found' })).setMimeType(ContentService.MimeType.JSON);

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ ok: true, ids: [] })).setMimeType(ContentService.MimeType.JSON);

  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idxId = headers.indexOf('管理番号');
  var idxStatus = headers.indexOf('ステータス');
  if (idxId < 0 || idxStatus < 0) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'missing columns', idxId: idxId, idxStatus: idxStatus })).setMimeType(ContentService.MimeType.JSON);
  }

  var minCol = Math.min(idxId, idxStatus);
  var maxCol = Math.max(idxId, idxStatus);
  var data = sh.getRange(2, minCol + 1, lastRow - 1, maxCol - minCol + 1).getValues();
  var idOff = idxId - minCol;
  var stOff = idxStatus - minCol;
  var targets = { '出品中': 1, '出品待ち': 1, '返品済み': 1 };
  var ids = [];
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][stOff]).trim();
    if (!targets[status]) continue;
    var id = String(data[i][idOff]).trim();
    if (id) ids.push(id);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, count: ids.length, ids: ids })).setMimeType(ContentService.MimeType.JSON);
}
