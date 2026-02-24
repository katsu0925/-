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
  withLock_(25000, function() { processPendingMoves_(); });
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

  // MV-で始まらない行に採番（AppSheetの自動キーを上書き）
  for (var j = 0; j < data.length; j++) {
    var existingId = String(data[j][0] || '').trim();
    if (existingId.indexOf('MV-') !== 0) {
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
