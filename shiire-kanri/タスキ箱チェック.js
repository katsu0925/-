// タスキ箱チェック.gs — 商品管理シートのうち対象ステータスの管理番号をJSONで返す一時エンドポイント
// 使い方:
//   ?check=tsk           → 対象ステータスの管理番号IDのみ
//   ?check=tsk&mode=all  → 全行の {id, status, worker(=作業者名)} を返す
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
  var idxWorker = headers.indexOf('作業者名');
  if (idxId < 0 || idxStatus < 0) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'missing columns', headers: headers })).setMimeType(ContentService.MimeType.JSON);
  }

  var mode = (e && e.parameter && e.parameter.mode) || '';

  var all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  if (mode === 'all') {
    var rows = [];
    for (var i = 0; i < all.length; i++) {
      var id = String(all[i][idxId]).trim();
      if (!id) continue;
      rows.push({
        id: id,
        status: String(all[i][idxStatus]).trim(),
        worker: idxWorker >= 0 ? String(all[i][idxWorker]).trim() : ''
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, count: rows.length, rows: rows })).setMimeType(ContentService.MimeType.JSON);
  }

  var targets = { '出品中': 1, '出品待ち': 1, '返品済み': 1 };
  var ids = [];
  for (var j = 0; j < all.length; j++) {
    var st = String(all[j][idxStatus]).trim();
    if (!targets[st]) continue;
    var mid = String(all[j][idxId]).trim();
    if (mid) ids.push(mid);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, count: ids.length, ids: ids })).setMimeType(ContentService.MimeType.JSON);
}
