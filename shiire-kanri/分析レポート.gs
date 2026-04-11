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
 * メニューから分析レポートリンクを追加
 * 分析期間は当月を自動設定、リンクのみ入力
 */
function addAnalysisReportManual() {
  var ui = SpreadsheetApp.getUi();
  var now = new Date();
  var period = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';

  var linkResp = ui.prompt(
    '分析レポートリンク追加（' + period + '）',
    'レポートURLを入力してください',
    ui.ButtonSet.OK_CANCEL
  );
  if (linkResp.getSelectedButton() !== ui.Button.OK) return;
  var link = linkResp.getResponseText().trim();
  if (!link) { ui.alert('URLが空です'); return; }

  var result = addAnalysisReport(period, link);
  if (result.ok) {
    ui.alert('記録しました\n期間: ' + period + '\n行: ' + result.row);
  }
}
