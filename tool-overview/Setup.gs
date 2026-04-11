function onOpen(e){
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('会計')
    .addItem('初期構築','accountingSetup')
    .addItem('同期実行（集計更新まで）','accountingSyncAndRebuild')
    .addItem('書式再適用','applyFormatting')
    .addItem('ダッシュボード再構築','rebuildDashboard')
    .addToUi();
}

function accountingSetup(){
  setupDatabase();
  setupMaster();
  setupSettings();
  setupLog();
  applyFormatting();
  rebuildSummary();
  rebuildDashboard(false);
  setAllSheetsColumnWidth100_();
}

function accountingSyncAndRebuild(){
  accountingSync();
  rebuildSummary();
  rebuildDashboard(true);
  applyFormatting();
  setAllSheetsColumnWidth100_();
}

function setupDatabase() {
  var db = getDbSpreadsheet();
  var sheet = db.getSheetByName(TRANSACTION_SHEET);
  if (sheet == null) {
    sheet = db.insertSheet(TRANSACTION_SHEET);
  } else {
    sheet.clear();
  }
  var header = getTransactionHeader();
  sheet.insertRows(1,2);
  sheet.getRange(2,1,1,header.length).setValues([header]);
  sheet.getRange(1,1,1,header.length).merge().setValue('会計_取引DB');
  sheet.setFrozenRows(2);
  var headerRange = sheet.getRange(2,1,1,header.length);
  headerRange.setFontWeight('bold').setBackground('#e0e0e0').setFontColor('#000000');
  sheet.getDataRange().applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange(2,1,1,header.length).createFilter();
}

function setupMaster() {
  var db = getDbSpreadsheet();
  var sheet = db.getSheetByName(MASTER_SHEET);
  if (sheet == null) {
    sheet = db.insertSheet(MASTER_SHEET);
  } else {
    sheet.clear();
  }
  var data = [
    ['勘定科目','税区分','税率','区分'],
    ['売上高','課税',0.1,'収益'],
    ['販売手数料','課税',0.1,'支出'],
    ['発送費','課税',0.1,'支出'],
    ['仕入','課税',0.1,'支出'],
    ['仕入送料','課税',0.1,'支出'],
    ['外注費','課税',0.1,'支出'],
    ['広告費','課税',0.1,'支出'],
    ['経費','課税',0.1,'支出']
  ];
  sheet.getRange(1,1,data.length,data[0].length).setValues(data);
}

function setupSettings() {
  var db = getDbSpreadsheet();
  var sheet = db.getSheetByName(SETTINGS_SHEET);
  if (sheet == null) {
    sheet = db.insertSheet(SETTINGS_SHEET);
  } else {
    sheet.clear();
  }
  var data = [
    ['キー','値','説明'],
    ['開始月','2025-01','集計を開始する月'],
    ['表示月数','12','ダッシュボードに表示する月数'],
    ['証憑閾値','3000','支出の証憑リンク必須とする金額'],
    ['利益率閾値','0.2','利益率がこの値未満なら警告'],
    ['削除方式','無効','削除か無効を選択']
  ];
  sheet.getRange(1,1,data.length,data[0].length).setValues(data);
}

function setupLog() {
  var db = getDbSpreadsheet();
  var sheet = db.getSheetByName(LOG_SHEET);
  if (sheet == null) {
    sheet = db.insertSheet(LOG_SHEET);
  } else {
    sheet.clear();
  }
  sheet.getRange(1,1,1,3).setValues([['日時','レベル','メッセージ']]);
}

function applySummaryFormatting_() {
  var db = getDbSpreadsheet();
  var sh = db.getSheetByName(SUMMARY_SHEET);
  if (!sh) return;

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return;

  var colExpenseStart = 7;
  var colExpenseEnd = 13; // 仕入からその他経費まで 7-13
  var colTotalExpense = 15; // 合計支出列
  var colProfit = 16; // 最終損益列

  var rules = [];

  if (colExpenseStart <= lastCol) {
    var w1 = Math.min(colExpenseEnd, lastCol) - colExpenseStart + 1;
    if (w1 > 0) {
      var expRange = sh.getRange(2, colExpenseStart, lastRow - 1, w1);
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=TRUE').setFontColor('#d00000').setRanges([expRange]).build());
    }
  }

  if (colTotalExpense <= lastCol) {
    var teRange = sh.getRange(2, colTotalExpense, lastRow - 1, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=TRUE').setFontColor('#d00000').setRanges([teRange]).build());
  }

  if (colProfit <= lastCol) {
    var pRange = sh.getRange(2, colProfit, lastRow - 1, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#d00000').setRanges([pRange]).build());
  }

  sh.setConditionalFormatRules(rules);
}

function applyFormatting() {
  var db = getDbSpreadsheet();
  var sheet = db.getSheetByName(TRANSACTION_SHEET);
  if (!sheet) return;

  var header = getTransactionHeader();
  var rules = [];
  var baseRow = 3;
  var baseRange = sheet.getRange(baseRow, 1, Math.max(sheet.getMaxRows() - (baseRow - 1), 1), header.length);
  var colIndex = function(name) { return header.indexOf(name) + 1; };

  var aAmount = sheet.getRange(baseRow, colIndex('金額(税込)')).getA1Notation();
  var aDate = sheet.getRange(baseRow, colIndex('日付')).getA1Notation();
  var aDiv = sheet.getRange(baseRow, colIndex('区分')).getA1Notation();
  var aCat = sheet.getRange(baseRow, colIndex('勘定科目')).getA1Notation();
  var aTaxClass = sheet.getRange(baseRow, colIndex('税区分')).getA1Notation();
  var aRate = sheet.getRange(baseRow, colIndex('税率')).getA1Notation();
  var aYM = sheet.getRange(baseRow, colIndex('年月')).getA1Notation();

  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aAmount.replace(/[0-9]+$/, '') + baseRow + '=0').setBackground('#ffeeee').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aDate.replace(/[0-9]+$/, '') + baseRow + '=""').setBackground('#ffeeee').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aDiv.replace(/[0-9]+$/, '') + baseRow + '=""').setBackground('#ffeeee').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aCat.replace(/[0-9]+$/, '') + baseRow + '=""').setBackground('#ffeeee').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($' + aTaxClass.replace(/[0-9]+$/, '') + baseRow + '="課税",$' + aRate.replace(/[0-9]+$/, '') + baseRow + '=0)').setBackground('#fff7cc').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aYM.replace(/[0-9]+$/, '') + baseRow + '>TEXT(TODAY(),"yyyy-mm")').setBackground('#fff7cc').setRanges([baseRange]).build());

  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aDiv.replace(/[0-9]+$/, '') + baseRow + '="支出"').setFontColor('#d00000').setRanges([baseRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + aAmount.replace(/[0-9]+$/, '') + baseRow + '<0').setFontColor('#d00000').setRanges([baseRange]).build());

  sheet.setConditionalFormatRules(rules);

  var headerRange = sheet.getRange(2, 1, 1, header.length);
  headerRange.setFontWeight('bold').setBackground('#e0e0e0').setFontColor('#000000');
}

function rebuildSummary() {
  var db = getDbSpreadsheet();
  var transSheet = db.getSheetByName(TRANSACTION_SHEET);
  var summary = db.getSheetByName(SUMMARY_SHEET);
  if (summary == null) {
    summary = db.insertSheet(SUMMARY_SHEET);
  } else {
    summary.clear();
  }
  if (!transSheet) return;

  var lastRow = transSheet.getLastRow();
  if (lastRow < 3) return;

  var header = transSheet.getRange(2, 1, 1, transSheet.getLastColumn()).getValues()[0];
  var idx = {};
  for (var c = 0; c < header.length; c++) {
    var h = header[c];
    if (h == null) continue;
    var s = String(h).trim();
    if (!s) continue;
    idx[s] = c;
  }

  var need = ['日付', '区分', '勘定科目', '金額(税込)', '販路'];
  for (var n = 0; n < need.length; n++) {
    if (idx[need[n]] == null) {
      appendLog_('ERROR', '会計_取引DBに必要列がありません: ' + need[n]);
      return;
    }
  }

  var data = transSheet.getRange(3, 1, lastRow - 2, header.length).getValues();
  var tz = Session.getScriptTimeZone();

  function toNumber(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/,/g, '');
    var n = Number(s);
    return isNaN(n) ? 0 : n;
  }

  function normDate(v) {
    if (!v) return null;
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return null;
      return v;
    }
    var s = String(v).trim();
    if (!s) return null;
    var m1 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m1) return new Date(parseInt(m1[1], 10), parseInt(m1[2], 10) - 1, parseInt(m1[3], 10));
    var d2 = new Date(s);
    if (isNaN(d2.getTime())) return null;
    return d2;
  }

  var map = {};

  function ensureMonth(ymKey) {
    if (!map[ymKey]) {
      map[ymKey] = {
        BASE: 0,
        スマセル: 0,
        メルカリ: 0,
        ラクマ: 0,
        その他売上: 0,
        仕入: 0,
        仕入送料: 0,
        外注費: 0,
        広告費: 0,
        発送費: 0,
        販売手数料: 0,
        その他経費: 0
      };
    }
    return map[ymKey];
  }

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var d = normDate(r[idx['日付']]);
    if (!d) continue;
    var ymKey = Utilities.formatDate(d, tz, 'yyyy-MM');
    var obj = ensureMonth(ymKey);
    var division = String(r[idx['区分']] == null ? '' : r[idx['区分']]).trim();
    var cat = String(r[idx['勘定科目']] == null ? '' : r[idx['勘定科目']]).trim();
    var route = String(r[idx['販路']] == null ? '' : r[idx['販路']]).trim();
    var amount = toNumber(r[idx['金額(税込)']]);
    if (division === '収益') {
      if (cat === '売上高') {
        if (route === 'BASE') obj.BASE += amount;
        else if (route === 'スマセル') obj.スマセル += amount;
        else if (route === 'メルカリ') obj.メルカリ += amount;
        else if (route === 'ラクマ') obj.ラクマ += amount;
        else obj.その他売上 += amount;
      } else {
        obj.その他売上 += amount;
      }
    } else if (division === '支出') {
      if (cat === '仕入') obj.仕入 += amount;
      else if (cat === '仕入送料') obj.仕入送料 += amount;
      else if (cat === '外注費') obj.外注費 += amount;
      else if (cat === '広告費') obj.広告費 += amount;
      else if (cat === '発送費') obj.発送費 += amount;
      else if (cat === '販売手数料') obj.販売手数料 += amount;
      else obj.その他経費 += amount;
    }
  }

  var headerOut = [
    '年月',
    'BASE売上',
    'スマセル売上',
    'メルカリ売上',
    'ラクマ売上',
    'その他売上',
    '仕入',
    '仕入送料',
    '外注費',
    '広告費',
    '発送費',
    '販売手数料',
    'その他経費',
    '合計収益',
    '合計支出',
    '最終損益'
  ];

  var months = Object.keys(map).sort();
  var rows = [headerOut];

  for (var m = 0; m < months.length; m++) {
    var ymKey = months[m];
    var v = map[ymKey];
    var parts = ymKey.split('-');
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10);
    var ymDate = new Date(y, mo - 1, 1);
    var totalRevenue = v.BASE + v.スマセル + v.メルカリ + v.ラクマ + v.その他売上;
    var totalExpense = v.仕入 + v.仕入送料 + v.外注費 + v.広告費 + v.発送費 + v.販売手数料 + v.その他経費;
    var profit = totalRevenue - totalExpense;
    rows.push([
      ymDate,
      v.BASE,
      v.スマセル,
      v.メルカリ,
      v.ラクマ,
      v.その他売上,
      v.仕入,
      v.仕入送料,
      v.外注費,
      v.広告費,
      v.発送費,
      v.販売手数料,
      v.その他経費,
      totalRevenue,
      totalExpense,
      profit
    ]);
  }

  summary.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  if (rows.length > 1) {
    summary.getRange(2, 1, rows.length - 1, 1).setNumberFormat('yyyy-MM');
    summary.getRange(2, 2, rows.length - 1, rows[0].length - 1).setNumberFormat('#,##0');
  }

  summary.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#e0e0e0');
  summary.setFrozenRows(1);
  applySummaryFormatting_();
}

function rebuildDashboard(preserveE) {
  var db = getDbSpreadsheet();
  var dash = db.getSheetByName(DASHBOARD_SHEET);
  var isNew = false;
  if (dash == null) {
    dash = db.insertSheet(DASHBOARD_SHEET);
    isNew = true;
  } else {
    if (preserveE) {
      var maxRows = dash.getMaxRows();
      var maxCols = dash.getMaxColumns();
      if (maxCols >= 1) dash.getRange(1, 1, maxRows, Math.min(4, maxCols)).clearContent();
      if (maxCols >= 6) dash.getRange(1, 6, maxRows, maxCols - 5).clearContent();
    } else {
      dash.clearContents();
    }
  }
  var summary = db.getSheetByName(SUMMARY_SHEET);
  if (!summary) return;
  var lastRow = summary.getLastRow();
  if (lastRow < 2) return;
  var rawMonths = summary.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r){ return r[0]; });
  var dates = [];
  rawMonths.forEach(function(m) {
    var d = null;
    if (m instanceof Date) {
      d = new Date(m.getFullYear(), m.getMonth(), 1);
    } else if (typeof m === 'string' && m) {
      var parts = m.split(/[-\s\/]/);
      var y = parseInt(parts[0], 10);
      var mo = parseInt(parts[1], 10);
      if (!isNaN(y) && !isNaN(mo)) d = new Date(y, mo - 1, 1);
    }
    if (d && !isNaN(d.getTime())) dates.push(d);
  });
  if (dates.length === 0) return;
  dates.sort(function(a, b) { return a.getTime() - b.getTime(); });
  var lastMonth = dates[dates.length - 1];
  dash.getRange('B2').setValue(lastMonth);
  var validationRange = summary.getRange(2, 1, lastRow - 1, 1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInRange(validationRange).setAllowInvalid(false).build();
  dash.getRange('B2').setDataValidation(rule);
  dash.getRange('A1').setValue('主要指標');
  dash.getRange('A2').setValue('対象年月');
  dash.getRange('A3').setValue('合計収益');
  dash.getRange('A4').setValue('合計支出');
  dash.getRange('A5').setValue('最終損益');
  dash.getRange('A6').setValue('損益率');
  dash.getRange('D1').setValue('警告パネル');
  dash.getRange('D2').setValue('証憑不足件数');
  dash.getRange('D3').setValue('未分類件数');
  dash.getRange('D4').setValue('税区分矛盾件数');
  dash.getRange('D5').setValue('金額0または日付無し件数');
  dash.getRange('D6').setValue('まとめID欠落件数');
  dash.getRange('D7').setValue('損益率閾値未満の月');
  // 指標のセル
  dash.getRange('B3').setFormula('=IFERROR(VLOOKUP(B2,\'会計_月次集計\'!A:Q,14,FALSE),0)');
  dash.getRange('B4').setFormula('=IFERROR(VLOOKUP(B2,\'会計_月次集計\'!A:Q,15,FALSE),0)');
  dash.getRange('B5').setFormula('=IFERROR(VLOOKUP(B2,\'会計_月次集計\'!A:Q,16,FALSE),0)');
  dash.getRange('B6').setFormula('=IFERROR(B5/B3,0)');
  // 警告パネルの式（E列） preserveEがfalse、または新規の場合だけ設定
  var canWriteE = (!preserveE) || isNew;
  if (canWriteE) {
    dash.getRange('E2').setFormula('=COUNTIFS(\'会計_取引DB\'!$A$3:$A,"<>",\'会計_取引DB\'!$D$3:$D,"支出",\'会計_取引DB\'!$S$3:$S,"")');
    dash.getRange('E3').setFormula('=COUNTIF(\'会計_取引DB\'!$E$3:$E,"未分類")');
    dash.getRange('E4').setFormula('=COUNTIFS(\'会計_取引DB\'!$H$3:$H,"課税",\'会計_取引DB\'!$I$3:$I,0)');
    dash.getRange('E5').setFormula('=SUM(COUNTIFS(\'会計_取引DB\'!$A$3:$A,"<>",\'会計_取引DB\'!$B$3:$B,""),COUNTIFS(\'会計_取引DB\'!$A$3:$A,"<>",\'会計_取引DB\'!$D$3:$D,""),COUNTIFS(\'会計_取引DB\'!$A$3:$A,"<>",\'会計_取引DB\'!$G$3:$G,0))');
    dash.getRange('E6').setFormula('=COUNTIFS(\'会計_取引DB\'!$A$3:$A,"<>",\'会計_取引DB\'!$P$3:$P,"")');
    dash.getRange('E7').setFormula('=TEXTJOIN(",",TRUE,ARRAYFORMULA(TEXT(FILTER(\'会計_月次集計\'!A:A,IFERROR(\'会計_月次集計\'!P:P/\'会計_月次集計\'!N:N,0)<\'会計_設定\'!B5),"yyyy-mm")))');
  }
  rebuildCharts();
}

function rebuildCharts() {
  var db = getDbSpreadsheet();
  var dash = db.getSheetByName(DASHBOARD_SHEET);
  var summary = db.getSheetByName(SUMMARY_SHEET);
  if (!dash || !summary) return;
  var lastRow = summary.getLastRow();
  if (lastRow < 2) return;
  var helperName = '会計_グラフ用';
  var helper = db.getSheetByName(helperName);
  if (helper == null) {
    helper = db.insertSheet(helperName);
  } else {
    helper.clearContents();
  }
  helper.getRange(1, 1, 1, 4).setValues([[
    '年月','合計収益','合計支出','最終損益'
  ]]);
  var ymVals = summary.getRange(2, 1, lastRow - 1, 1).getValues();
  var revVals = summary.getRange(2, 14, lastRow - 1, 1).getValues();
  var expVals = summary.getRange(2, 15, lastRow - 1, 1).getValues();
  var profVals = summary.getRange(2, 16, lastRow - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < lastRow - 1; i++) {
    out.push([ymVals[i][0], revVals[i][0], expVals[i][0], profVals[i][0]]);
  }
  helper.getRange(2, 1, out.length, 4).setValues(out);
  var charts = dash.getCharts();
  charts.forEach(function(c){ dash.removeChart(c); });
  var helperLast = helper.getLastRow();
  if (helperLast < 2) return;
  var rangeLine = helper.getRange(1, 1, helperLast, 4);
  var chartLine = dash.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(rangeLine)
    .setNumHeaders(1)
    .setPosition(10, 1, 0, 0)
    .setOption('title', '月次 収益・支出・損益推移')
    .setOption('hAxis.title', '年月')
    .setOption('vAxes', {0:{title:'金額（円）'},1:{title:'損益（円）'}})
    .setOption('series', {0:{targetAxisIndex:0},1:{targetAxisIndex:0},2:{targetAxisIndex:1}})
    .setOption('legend', { position: 'top', textStyle: { color: '#000000' } })
    .build();
  dash.insertChart(chartLine);
  var rangeBar = helper.getRange(1, 1, helperLast, 3);
  var chartBar = dash.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(rangeBar)
    .setNumHeaders(1)
    .setPosition(10, 8, 0, 0)
    .setOption('title', '月次 収益・支出 比較')
    .setOption('hAxis.title', '年月')
    .setOption('vAxis.title', '金額（円）')
    .setOption('legend', { position: 'top', textStyle: { color: '#000000' } })
    .build();
  dash.insertChart(chartBar);
}

function setAllSheetsColumnWidth100_() {
  var db = getDbSpreadsheet();
  var names = [
    TRANSACTION_SHEET,
    SUMMARY_SHEET,
    DASHBOARD_SHEET,
    MASTER_SHEET,
    SETTINGS_SHEET,
    LOG_SHEET
  ];
  for (var i = 0; i < names.length; i++) {
    var sh = db.getSheetByName(names[i]);
    if (!sh) continue;
    var maxCols = sh.getMaxColumns();
    if (maxCols > 0) sh.setColumnWidths(1, maxCols, 100);
  }
}