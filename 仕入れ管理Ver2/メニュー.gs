var AI_SHEET_NAME = 'AIキーワード抽出';

var COLUMN_NAMES = {
  STATUS: 'ステータス',
  SALE_DATE: '販売日',
  SALE_PLACE: '販売場所',
  SALE_PRICE: '販売価格',
  INCOME: '粗利',
  PROFIT: '利益',
  PROFIT_RATE: '利益率'
};

var ANALYSIS_HEADER_ROW = 15;

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  var invMenu = ui.createMenu('棚卸')
    .addItem('今月を開始', 'startNewMonth')
    .addItem('今月に新規IDを同期', 'syncCurrentMonthIds')
    .addItem('最新月の理論を前月実地で再計算', 'recalcCurrentTheoryFromPrev');

  ui.createMenu('管理メニュー')
    .addSubMenu(invMenu)
    .addSeparator()
    .addItem('不要トリガー一括削除', 'cleanupObsoleteTriggers')
    .addSeparator()
    .addItem('列診断', 'debugCheckColumns')
    .addToUi();
}

function onEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== '回収完了') return;

  if (e.range.getRow() === 4 && e.range.getColumn() === 2) {
    sortByField(sh);
  }
}

// ═══════════════════════════════════════════
// 不要トリガー一括削除（仕入れ管理Ver2プロジェクト用）
// ═══════════════════════════════════════════

function cleanupObsoleteTriggers() {
  var obsolete = [
    'generateCompletionList',
    'rc_handleRecoveryCompleteOnEdit_',
    'toggleKaishuKanryoFilter',
    'rc_bulkCheckVisibleRowsAndSetBatchId'
  ];
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;

  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (obsolete.indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  });

  SpreadsheetApp.getActiveSpreadsheet().toast(deleted + '件の不要トリガーを削除しました', '完了', 5);
}

// ═══════════════════════════════════════════
// ソート（回収完了 B4 セルの値でソート）
// ═══════════════════════════════════════════

function sortByField(sheet) {
  var colMap = { '箱ID': 2, '管理番号': 3, 'ブランド': 4, 'サイズ': 5, '性別': 6, 'カテゴリ': 7 };
  var field = sheet.getRange('B4').getValue();
  var colIdx = colMap[field];
  var lastRow = sheet.getLastRow();
  if (colIdx && lastRow >= 7) {
    sheet.getRange(7, 1, lastRow - 6, sheet.getLastColumn()).sort({ column: colIdx, ascending: true });
  }
}

// ═══════════════════════════════════════════
// 列診断
// ═══════════════════════════════════════════

function debugCheckColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var main = ss.getSheetByName('商品管理');
  var aiSheet = ss.getSheetByName(AI_SHEET_NAME);
  var analysis = ss.getSheetByName('在庫分析');

  var msg = '【診断レポート】\n\n';

  if (aiSheet) {
    msg += 'AIシート「' + AI_SHEET_NAME + '」発見\n';
  } else {
    msg += 'AIシート「' + AI_SHEET_NAME + '」が見つかりません\n';
  }

  if (analysis) {
    msg += '在庫分析シート発見\n';
    var h = analysis.getRange(15, 1, 1, analysis.getLastColumn()).getValues()[0];
    var colRateIdx = h.indexOf('回収割合');
    msg += '  - 回収割合: ' + (colRateIdx > -1 ? (colRateIdx + 1) + '列目' : '見つかりません(15行目を確認してください)') + '\n';
  } else {
    msg += '在庫分析シートが見つかりません\n';
  }

  msg += '\n商品管理シート列確認:\n';
  var headerRow = main.getRange(1, 1, 1, main.getLastColumn()).getValues()[0];
  var map = {};
  headerRow.forEach(function(n, i) { if (n) map[n.toString().trim()] = i + 1; });

  for (var k in COLUMN_NAMES) {
    var name = COLUMN_NAMES[k];
    var col = map[name];
    msg += '  - ' + name + ' : ' + (col ? col + '列目' : '見つかりません') + '\n';
  }

  Browser.msgBox(msg);
}
