// 分析レポート.gs — 月次分析レポートのリンクを「分析アドバイス」シートに記録

var ANALYSIS_ADVICE_SHEET = '分析アドバイス';

/**
 * 分析レポートのリンクを「分析アドバイス」シートに追記する
 * @param {string} period - 分析期間（例: "2026年3月"）
 * @param {string} link - レポートのURL
 */
function addAnalysisReport(period, link) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ANALYSIS_ADVICE_SHEET);

  // シートがなければ作成
  if (!sheet) {
    sheet = ss.insertSheet(ANALYSIS_ADVICE_SHEET);
    sheet.getRange('A1:C1').setValues([['作成日', '分析期間', 'リンク']]);
    sheet.getRange('A1:C1')
      .setFontWeight('bold')
      .setBackground('#1a73e8')
      .setFontColor('#ffffff');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 400);
    sheet.setFrozenRows(1);
  }

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[today, period, link]]);

  console.log('分析レポート記録: ' + period + ' → ' + link);
  return { ok: true, row: lastRow + 1 };
}

/**
 * メニューから手動で分析レポートリンクを追加（テスト用）
 */
function addAnalysisReportManual() {
  var ui = SpreadsheetApp.getUi();
  var periodResp = ui.prompt('分析期間を入力', '例: 2026年3月', ui.ButtonSet.OK_CANCEL);
  if (periodResp.getSelectedButton() !== ui.Button.OK) return;
  var linkResp = ui.prompt('レポートURLを入力', '', ui.ButtonSet.OK_CANCEL);
  if (linkResp.getSelectedButton() !== ui.Button.OK) return;

  var result = addAnalysisReport(periodResp.getResponseText(), linkResp.getResponseText());
  if (result.ok) {
    ui.alert('記録しました（行: ' + result.row + '）');
  }
}
