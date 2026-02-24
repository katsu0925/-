// 移動報告.gs
/**
 * 移動報告.gs — AppSheetからの移動報告を検知し、商品管理の納品場所を自動書き換え
 *
 * 移動報告シート構成:
 *   A列: 移動ID (MV-YYYYMMDD-NNN)
 *   B列: タイムスタンプ
 *   C列: 報告者
 *   D列: 移動先
 *   E列: 管理番号（複数: カンマ/改行/スペース区切り）
 *   F列: 処理済み (TRUE/FALSE)
 */

var MOVE_CONFIG = {
  MOVE_SHEET_NAME: '移動報告',
  PRODUCT_SHEET_NAME: '商品管理',
  COLS: { ID: 1, TIMESTAMP: 2, REPORTER: 3, DESTINATION: 4, IDS: 5, DONE: 6 }
};

// ═══════════════════════════════════════════
//  onChange トリガーから呼ばれるハンドラ
// ═══════════════════════════════════════════

function handleChange_Move(e) {
  withLock_(25000, function() {
    processPendingMoves_();
    syncProductIndex_();
  });
}

// ═══════════════════════════════════════════
//  未処理の移動報告を一括処理
// ═══════════════════════════════════════════

function processPendingMoves_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var moveSheet = ss.getSheetByName(MOVE_CONFIG.MOVE_SHEET_NAME);
  if (!moveSheet) return;

  var lastRow = moveSheet.getLastRow();
  if (lastRow < 2) return;

  var data = moveSheet.getRange(2, 1, lastRow - 1, 6).getValues();

  // 未処理行を収集
  var pending = [];
  for (var i = 0; i < data.length; i++) {
    var done = String(data[i][MOVE_CONFIG.COLS.DONE - 1] || '').trim().toUpperCase();
    if (done === 'TRUE') continue;

    var destination = String(data[i][MOVE_CONFIG.COLS.DESTINATION - 1] || '').trim();
    var idsRaw = String(data[i][MOVE_CONFIG.COLS.IDS - 1] || '');
    var moveId = String(data[i][MOVE_CONFIG.COLS.ID - 1] || '').trim();

    if (!destination || !idsRaw) continue;

    var ids = splitMoveIds_(idsRaw);
    if (ids.length === 0) continue;

    pending.push({ rowIndex: i, destination: destination, ids: ids, moveId: moveId });
  }

  if (pending.length === 0) return;

  // 商品管理シートを開いて納品場所を書き換え
  var productSheet = ss.getSheetByName(MOVE_CONFIG.PRODUCT_SHEET_NAME);
  if (!productSheet) { console.error('移動報告: 商品管理シートが見つかりません'); return; }

  var pLastRow = productSheet.getLastRow();
  var pLastCol = productSheet.getLastColumn();
  if (pLastRow < 2 || pLastCol < 1) return;

  var pHeader = productSheet.getRange(1, 1, 1, pLastCol).getDisplayValues()[0];
  var colId = findColByName_(pHeader, '管理番号');
  var colLocation = findColByName_(pHeader, '納品場所');
  if (colId < 0) { console.error('移動報告: 商品管理に「管理番号」列がありません'); return; }
  if (colLocation < 0) { console.error('移動報告: 商品管理に「納品場所」列がありません'); return; }

  // 管理番号 → 行番号のマップを構築
  var pNumRows = pLastRow - 1;
  var idVals = productSheet.getRange(2, colId, pNumRows, 1).getDisplayValues();
  var idToRow = {};
  for (var r = 0; r < pNumRows; r++) {
    var id = normalizeText_(idVals[r][0]);
    if (id) idToRow[id] = r + 2; // 1-indexed + ヘッダー
  }

  // 納品場所列を一括読み取り
  var locVals = productSheet.getRange(2, colLocation, pNumRows, 1).getValues();

  var totalUpdated = 0;
  var changed = false;

  pending.forEach(function(p) {
    var updated = 0;
    p.ids.forEach(function(id) {
      var row = idToRow[normalizeText_(id)];
      if (!row) {
        console.log('移動報告 [' + p.moveId + ']: 管理番号「' + id + '」が見つかりません');
        return;
      }
      var arrIdx = row - 2;
      locVals[arrIdx][0] = p.destination;
      changed = true;
      updated++;
    });
    totalUpdated += updated;
    console.log('移動報告 [' + p.moveId + ']: ' + updated + '/' + p.ids.length + '件の納品場所を「' + p.destination + '」に変更');
  });

  // 商品管理シートに一括書き込み
  if (changed) {
    productSheet.getRange(2, colLocation, pNumRows, 1).setValues(locVals);
  }

  // 処理済みフラグを立てる
  pending.forEach(function(p) {
    moveSheet.getRange(p.rowIndex + 2, MOVE_CONFIG.COLS.DONE).setValue('TRUE');
  });

  // 移動IDが空の行に自動採番
  assignMoveIds_(moveSheet, data);

  console.log('移動報告処理完了: ' + pending.length + '件の報告 / ' + totalUpdated + '件の商品を更新');
}

// ═══════════════════════════════════════════
//  移動ID自動採番
// ═══════════════════════════════════════════

function assignMoveIds_(moveSheet, data) {
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var prefix = 'MV-' + today + '-';

  // 今日の既存最大連番を取得
  var maxSeq = 0;
  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][0] || '');
    if (id.indexOf(prefix) === 0) {
      var seq = parseInt(id.substr(prefix.length), 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  // IDが空の行に採番
  for (var j = 0; j < data.length; j++) {
    var existingId = String(data[j][0] || '').trim();
    if (!existingId) {
      maxSeq++;
      var newId = prefix + padSeq_(maxSeq);
      moveSheet.getRange(j + 2, MOVE_CONFIG.COLS.ID).setValue(newId);
    }
  }
}

function padSeq_(n) {
  if (n < 10) return '00' + n;
  if (n < 100) return '0' + n;
  return String(n);
}

// ═══════════════════════════════════════════
//  管理番号パース（複数入力対応）
// ═══════════════════════════════════════════

function splitMoveIds_(text) {
  var raw = String(text || '');
  if (!raw) return [];
  var cleaned = raw.replace(/\u00A0/g, ' ').replace(/[　]/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
  var parts = cleaned.split(/[,\n\r\t\s、，／\/・|]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var id = normalizeText_(parts[i]);
    if (id) out.push(id);
  }
  return out;
}

// ═══════════════════════════════════════════
//  管理番号インデックス（ソート済み同期）
// ═══════════════════════════════════════════

var INDEX_SHEET_NAME = '管理番号インデックス';

/**
 * 商品管理から管理番号・納品場所を抽出し、管理番号の自然順でソートしたインデックスシートを再構築
 * onChange および handleChange_Inventory と同じタイミングで呼ばれる
 */
function syncProductIndex_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var productSheet = ss.getSheetByName(MOVE_CONFIG.PRODUCT_SHEET_NAME);
  if (!productSheet) return;

  var pLastRow = productSheet.getLastRow();
  var pLastCol = productSheet.getLastColumn();
  if (pLastRow < 2 || pLastCol < 1) return;

  var pHeader = productSheet.getRange(1, 1, 1, pLastCol).getDisplayValues()[0];
  var colId = findColByName_(pHeader, '管理番号');
  var colLocation = findColByName_(pHeader, '納品場所');
  if (colId < 0 || colLocation < 0) return;

  var numRows = pLastRow - 1;
  var idVals = productSheet.getRange(2, colId, numRows, 1).getDisplayValues();
  var locVals = productSheet.getRange(2, colLocation, numRows, 1).getDisplayValues();

  // 管理番号・納品場所ペアを収集（空行スキップ）
  var items = [];
  for (var i = 0; i < numRows; i++) {
    var id = String(idVals[i][0] || '').trim();
    if (!id) continue;
    items.push({ id: id, location: String(locVals[i][0] || '').trim() });
  }

  // 自然順ソート（プレフィックス文字→数値部分）
  items.sort(function(a, b) {
    var pa = parseIdParts_(a.id);
    var pb = parseIdParts_(b.id);
    if (pa.prefix < pb.prefix) return -1;
    if (pa.prefix > pb.prefix) return 1;
    return pa.num - pb.num;
  });

  // インデックスシートに書き込み
  var indexSheet = ss.getSheetByName(INDEX_SHEET_NAME);
  if (!indexSheet) {
    indexSheet = ss.insertSheet(INDEX_SHEET_NAME);
    indexSheet.getRange(1, 1, 1, 2).setValues([['管理番号', '納品場所']])
      .setFontWeight('bold').setBackground('#f0f0f0');
    indexSheet.setFrozenRows(1);
  }

  // データ領域クリア＆書き込み
  var idxLastRow = indexSheet.getLastRow();
  if (idxLastRow > 1) {
    indexSheet.getRange(2, 1, idxLastRow - 1, 2).clearContent();
  }

  if (items.length > 0) {
    var out = items.map(function(item) { return [item.id, item.location]; });
    indexSheet.getRange(2, 1, out.length, 2).setValues(out);
  }
}

/**
 * 管理番号をプレフィックス（文字部分）と数値部分に分解
 * 例: "zA1" → { prefix: "zA", num: 1 }
 *      "zB1201" → { prefix: "zB", num: 1201 }
 */
function parseIdParts_(id) {
  var m = String(id).match(/^([A-Za-z]+)(\d+)$/);
  if (m) return { prefix: m[1].toUpperCase(), num: parseInt(m[2], 10) };
  return { prefix: String(id).toUpperCase(), num: 0 };
}

// ═══════════════════════════════════════════
//  移動報告シート初期化（ヘッダー作成）
// ═══════════════════════════════════════════

function setupMoveSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MOVE_CONFIG.MOVE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(MOVE_CONFIG.MOVE_SHEET_NAME);
  }
  var headers = ['移動ID', 'タイムスタンプ', '報告者', '移動先', '管理番号', '処理済み'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f0f0f0');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 120);
  sh.setColumnWidth(5, 400);
  sh.setColumnWidth(6, 80);
  console.log('移動報告シートを初期化しました');
}
