const AI_SHEET_NAME = 'AIキーワード抽出';

const COLUMN_NAMES = {
  STATUS: 'ステータス',
  SALE_DATE: '販売日',
  SALE_PLACE: '販売場所',
  SALE_PRICE: '販売価格',
  INCOME: '粗利',
  PROFIT: '利益',
  PROFIT_RATE: '利益率'
};

const ANALYSIS_HEADER_ROW = 15;

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const invMenu = ui.createMenu('棚卸')
    .addItem('今月を開始', 'startNewMonth')
    .addItem('今月に新規IDを同期', 'syncCurrentMonthIds')
    .addItem('最新月の理論を前月実地で再計算', 'recalcCurrentTheoryFromPrev');

  ui.createMenu('管理メニュー')
    .addItem('1. 回収完了リストを更新(抽出)', 'generateCompletionList')
    .addItem('2. 配布用リスト作成(チェック行を印刷・CSV用)', 'createBuyerSheet')
    .addItem('3. 売却反映(チェック行を一括処理)', 'processSelectedSales')
    .addSeparator()
    .addSubMenu(invMenu)
    .addToUi();
}

function onEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== '回収完了') return;

  rc_handleRecoveryCompleteOnEdit_(e);

  if (e.range.getRow() === 4 && e.range.getColumn() === 2) {
    sortByField(sh);
  }
}


function generateCompletionList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var main = ss.getSheetByName('商品管理');
  var analysis = ss.getSheetByName('在庫分析');
  var out = ss.getSheetByName('回収完了');
  var aiSheet = ss.getSheetByName(AI_SHEET_NAME);
  var returnSheet = ss.getSheetByName('返送管理');

  ss.toast('リスト抽出を開始します...', '処理開始', 5);

  var daysThreshold = out.getRange('B1').getValue();
  var rawRateThreshold = out.getRange('B2').getValue();
  var rateThreshold = rawRateThreshold / 100;

  var lastRowAn = analysis.getLastRow();
  var anHeaders = analysis.getRange(ANALYSIS_HEADER_ROW, 1, 1, analysis.getLastColumn()).getValues()[0];
  var colIdIdx = anHeaders.indexOf('仕入れID');
  var colRateIdx = anHeaders.indexOf('回収割合');

  if (colIdIdx === -1 || colRateIdx === -1) {
    Browser.msgBox('エラー：「在庫分析」シートに「仕入れID」または「回収割合」の列が見つかりません。');
    return;
  }

  var anDataRange = analysis.getRange(ANALYSIS_HEADER_ROW + 1, 1, lastRowAn - ANALYSIS_HEADER_ROW, analysis.getLastColumn());
  var anData = anDataRange.getValues();
  var rateMap = {};
  anData.forEach(function (r) {
    var id = r[colIdIdx];
    var val = r[colRateIdx];
    var rate = 0;
    if (typeof val === 'number') {
      rate = val;
    } else if (typeof val === 'string') {
      rate = parseFloat(val.replace('%', '')) / 100;
    }
    if (id) rateMap[id] = rate;
  });

  var aiMap = {};
  if (aiSheet) {
    var aiData = aiSheet.getDataRange().getValues();
    var aiHeaders = aiData.shift();
    var aiIdIdx = aiHeaders.indexOf('管理番号');
    var keywordIndices = [];
    aiHeaders.forEach(function (h, i) {
      if (String(h).match(/キーワード|Keyword/)) keywordIndices.push(i);
    });

    if (aiIdIdx > -1 && keywordIndices.length > 0) {
      aiData.forEach(function (r) {
        var id = String(r[aiIdIdx]).trim();
        if (id) {
          var words = [];
          keywordIndices.forEach(function (idx) {
            var val = r[idx];
            if (val && String(val).trim() !== "") words.push(val);
          });
          aiMap[id] = words.join(' ');
        }
      });
    }
  }

  var boxMap = {};
  if (returnSheet) {
    var rData = returnSheet.getDataRange().getValues();
    for (var i = 1; i < rData.length; i++) {
      var row = rData[i];
      var boxId = row[0];
      var mgmtIdsStr = String(row[2]);

      if (mgmtIdsStr) {
        var ids = mgmtIdsStr.split(/[、,]/);
        ids.forEach(function (id) {
          boxMap[id.trim()] = boxId;
        });
      }
    }
  }

  var mData = main.getDataRange().getValues();
  var headers = mData.shift();
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });

  if (idx['ステータス'] === undefined) {
    Browser.msgBox('エラー：「商品管理」シートに「ステータス」列が見つかりません。ヘッダ名を確認してください。');
    return;
  }

  var outArr = [];
  var today = new Date();
  var msecPerDay = 24 * 60 * 60 * 1000;

  mData.forEach(function (r) {
    var status = String(r[idx['ステータス']] || '').trim();
    if (status === '売却済み') return;

    var ld = r[idx['出品日']];
    if (!ld || !(ld instanceof Date)) return;
    if (r[idx['販売日']] || r[idx['返品日']] || r[idx['キャンセル日']] || r[idx['廃棄日']]) return;

    var days = Math.floor((today - ld) / msecPerDay);
    if (days < daysThreshold) return;

    var id = r[idx['仕入れID']];
    var rate = rateMap[id] || 0;

    if (rate <= rateThreshold) return;

    var mgmtId = String(r[idx['管理番号']]).trim();
    var aiTitle = aiMap[mgmtId] || "";
    var boxId = boxMap[mgmtId] || "";

    outArr.push([
      false,
      boxId,
      mgmtId,
      r[idx['ブランド']],
      r[idx['メルカリサイズ']],
      r[idx['性別']],
      r[idx['カテゴリ2']],
      aiTitle,
      ld,
      r[idx['使用アカウント']],
      r[idx['仕入れ値']],
      r[idx['納品場所']],
      ""
    ]);
  });

  var maxRows = out.getMaxRows();
  if (maxRows >= 7) {
    var lastCol = out.getLastColumn() || 20;
    out.getRange(7, 1, maxRows - 6, lastCol).clearContent();
    out.getRange(7, 1, maxRows - 6, 1).removeCheckboxes();
  }

  var headerTitles = [
    '確認', '箱ID', '管理番号', 'ブランド', 'サイズ', '性別', 'カテゴリ', 'AIタイトル(KW1-8)', '出品日', 'アカウント', '仕入れ値', '納品場所', '【入力】まとめID'
  ];
  out.getRange(6, 1, 1, headerTitles.length).setValues([headerTitles]).setFontWeight('bold').setBackground('#f3f3f3');

  if (outArr.length > 0) {
    out.getRange(7, 1, outArr.length, outArr[0].length).setValues(outArr);
    out.getRange(7, 1, outArr.length, 1).insertCheckboxes();
    ss.toast(outArr.length + '件抽出完了', '完了', 5);
  } else {
    ss.toast('対象データはありませんでした', '完了', 5);
  }
}


function createBuyerSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var html = HtmlService.createHtmlOutput(
    '<style>' +
    'body { font-family: sans-serif; padding: 10px; }' +
    'label { display: block; margin-top: 10px; font-weight: bold; }' +
    'input { width: 100%; padding: 6px; margin-top: 4px; box-sizing: border-box; }' +
    'button { margin-top: 16px; padding: 8px 20px; }' +
    '#spinner { display:none; margin-top:12px; text-align:center; color:#666; }' +
    '.loader { display:inline-block; width:18px; height:18px; border:3px solid #ccc; border-top:3px solid #333; border-radius:50%; animation:spin .8s linear infinite; vertical-align:middle; margin-right:6px; }' +
    '@keyframes spin { to { transform:rotate(360deg); } }' +
    '</style>' +
    '<div id="spinner"><span class="loader"></span> 処理中...</div>' +
    '<label>会社名 / 氏名</label>' +
    '<input type="text" id="name" />' +
    '<label>受付番号</label>' +
    '<input type="text" id="number" />' +
    '<br><button id="btn" onclick="submit()">実行</button>' +
    '<script>' +
    'function submit(){' +
    '  var name = document.getElementById("name").value;' +
    '  var number = document.getElementById("number").value;' +
    '  if(!name || !number){ alert("両方入力してください"); return; }' +
    '  document.getElementById("btn").disabled = true;' +
    '  document.getElementById("spinner").style.display = "block";' +
    '  google.script.run.withSuccessHandler(function(){ google.script.host.close(); })' +
    '    .withFailureHandler(function(e){ alert("エラー: "+e.message); document.getElementById("btn").disabled=false; document.getElementById("spinner").style.display="none"; })' +
    '    .createBuyerSheetWithInput(name, number);' +
    '}' +
    '</script>'
  ).setWidth(350).setHeight(220);

  SpreadsheetApp.getUi().showModalDialog(html, '配布用リスト作成');
}

function createBuyerSheetWithInput(inputName, inputNumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSheet = ss.getSheetByName('回収完了');
  var mainSheet = ss.getSheetByName('商品管理');

  var exportSheetName = '配布用リスト';
  var exportSheet = ss.getSheetByName(exportSheetName);

  if (!exportSheet) {
    exportSheet = ss.insertSheet(exportSheetName);
  } else {
    var maxRows = exportSheet.getMaxRows();
    var maxCols = exportSheet.getMaxColumns();
    if (maxRows >= 2) {
      exportSheet.getRange(2, 1, maxRows - 1, maxCols).clearContent();
      exportSheet.getRange(2, 1, maxRows - 1, 1).removeCheckboxes();
    }
    exportSheet.getRange('A1').clearContent();
    exportSheet.getRange('B1').clearContent();
    exportSheet.getRange('E1').clearContent();
    exportSheet.getRange('I1').clearContent();
  }

  var lastRow = listSheet.getLastRow();
  if (lastRow < 7) {
    ss.toast('リストが空です', 'エラー');
    return;
  }

  var listData = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();
  var targetRows = listData.filter(function (r) { return r[0] === true; });

  if (targetRows.length === 0) {
    ss.toast('「回収完了」シートでチェックされた項目がありません。', '処理中断');
    return;
  }

  var summaryId = targetRows[0][12] || "";

  var mData = mainSheet.getDataRange().getValues();
  var headers = mData.shift();
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });

  var headerRow = ['確認', '箱ID', '管理番号(照合用)', 'ブランド', 'AIタイトル候補', 'アイテム', 'サイズ', '状態', '傷汚れ詳細', '採寸情報', '即出品用説明文（コピペ用）', '金額'];
  var exportData = [headerRow];

  targetRows.forEach(function (listRow) {
    var boxId = listRow[1];
    var targetId = listRow[2];
    var aiTitle = listRow[7];

    if (targetId == "") return;

    var row = mData.find(function (r) { return r[idx['管理番号']] === targetId; });
    if (!row) return;

    var condition = row[idx['状態']] || '目立った傷や汚れなし';
    var damageDetail = row[idx['傷汚れ詳細']] || '';
    var brand = row[idx['ブランド']] || '';
    var size = row[idx['メルカリサイズ']] || '';
    var item = row[idx['カテゴリ2']] || '古着';
    if (!aiTitle) aiTitle = "";

    var length = row[idx['着丈']] || '-';
    var width = row[idx['身幅']] || '-';
    var shoulder = row[idx['肩幅']] || '-';
    var sleeve = row[idx['袖丈']] || '-';
    var waist = row[idx['ウエスト']];
    var rise = row[idx['股上']];
    var inseam = row[idx['股下']];

    var measurementText = "";
    if (length != '-' || width != '-') {
      measurementText += "着丈: " + length + " / 身幅: " + width + " / 肩幅: " + shoulder + " / 袖丈: " + sleeve + "\n";
    }
    if (waist) {
      measurementText += "ウエスト: " + waist + " / 股上: " + rise + " / 股下: " + inseam;
    }
    measurementText = measurementText.trim();

    var description =
      "【管理番号】\n" +
      "【ブランド】" + brand + "\n" +
      "【サイズ】" + size + "\n" +
      "【状態】" + condition + "\n";

    if (damageDetail !== "") {
      description += "【状態詳細】\n" + damageDetail + "\n";
    }

    description += "【実寸(cm)】\n" + measurementText + "\n" +
      "\n※素人採寸のため多少の誤差はご了承ください。";

    var cost = toNumber_(listRow[10]) || 0;
    var price = calcPriceTier_(cost);
    var priceText = price.toLocaleString('ja-JP') + '円';

    exportData.push([false, boxId, targetId, brand, aiTitle, item, size, condition, damageDetail, measurementText, description, priceText]);
  });

  exportSheet.getRange('A1').setValue('まとめID');
  exportSheet.getRange('B1').setValue(summaryId);
  exportSheet.getRange('E1').setValue(inputName);
  exportSheet.getRange('I1').setValue(inputNumber);

  exportSheet.getRange(2, 1, exportData.length, exportData[0].length).setValues(exportData);

  if (exportData.length > 1) {
    exportSheet.getRange(3, 1, exportData.length - 1, 1).insertCheckboxes();
  }

  ss.toast(targetRows.length + '件を配布用リストへ反映しました', '成功', 3);
}

function processSelectedSales() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('回収完了');
  var main = ss.getSheetByName('商品管理');

  var lastRow = sh.getLastRow();
  if (lastRow < 7) {
    ss.toast('データがありません', '終了');
    return;
  }

  ss.toast('ステータス反映と削除を開始します...', '処理中', 30);

  var headerRow = main.getRange(1, 1, 1, main.getLastColumn()).getValues()[0];
  var colMap = {};
  headerRow.forEach(function (name, i) {
    if (name) colMap[String(name).trim()] = i + 1;
  });

  var statusCol = colMap[COLUMN_NAMES.STATUS];
  if (!statusCol) {
    Browser.msgBox('エラー：ステータス列が見つかりません。「★列とシートの診断」を実行してください。');
    return;
  }

  var idCol = colMap['管理番号'];
  if (!idCol) {
    Browser.msgBox('エラー：管理番号列が見つかりません。');
    return;
  }

  var mainLastRow = main.getLastRow();
  if (mainLastRow < 2) {
    ss.toast('商品管理にデータがありません', '終了', 5);
    return;
  }

  var mainIds = main.getRange(2, idCol, mainLastRow - 1, 1).getValues().flat();
  var idToRowMap = {};
  mainIds.forEach(function (id, index) {
    var k = String(id).trim();
    if (k !== '') idToRowMap[k] = index + 2;
  });

  var values = sh.getRange(7, 1, lastRow - 6, 17).getValues();

  var rowsToDelete = [];
  var uniqueRowSet = {};
  var statusRows = [];

  for (var i = 0; i < values.length; i++) {
    var rowData = values[i];

    var isChecked = rowData[0] === true;
    if (!isChecked) continue;

    var id = String(rowData[2] || '').trim();
    if (id === '') continue;

    var tgtRow = idToRowMap[id];
    if (!tgtRow) continue;

    rowsToDelete.push(i + 7);

    if (!uniqueRowSet[tgtRow]) {
      uniqueRowSet[tgtRow] = true;
      statusRows.push(tgtRow);
    }
  }

  if (rowsToDelete.length === 0) {
    ss.toast('処理対象がありませんでした', '完了', 3);
    return;
  }

  var statusA1s = [];
  var statusColLetter = colNumToLetter_(statusCol);
  for (var a = 0; a < statusRows.length; a++) {
    statusA1s.push(statusColLetter + statusRows[a]);
  }
  main.getRangeList(statusA1s).setValue('売却済み');

  SpreadsheetApp.flush();

  rowsToDelete.sort(function (x, y) { return y - x; }).forEach(function (r) {
    sh.deleteRow(r);
  });

  ss.toast(rowsToDelete.length + '件を処理しました（売却済み反映＋回収完了から削除）', '処理完了', 5);
}

function debugCheckColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var main = ss.getSheetByName('商品管理');
  var aiSheet = ss.getSheetByName(AI_SHEET_NAME);
  var analysis = ss.getSheetByName('在庫分析');

  var msg = '【診断レポート】\n\n';

  if (aiSheet) {
    msg += '✅ AIシート「' + AI_SHEET_NAME + '」発見\n';
  } else {
    msg += '❌ AIシート「' + AI_SHEET_NAME + '」が見つかりません\n';
  }

  if (analysis) {
    msg += '✅ 在庫分析シート発見\n';
    var h = analysis.getRange(15, 1, 1, analysis.getLastColumn()).getValues()[0];
    var colRateIdx = h.indexOf('回収割合');
    msg += '  - 回収割合: ' + (colRateIdx > -1 ? (colRateIdx + 1) + '列目' : '❌見つかりません(15行目を確認してください)') + '\n';
  } else {
    msg += '❌ 在庫分析シートが見つかりません\n';
  }

  msg += '\n✅ 商品管理シート列確認:\n';
  var headerRow = main.getRange(1, 1, 1, main.getLastColumn()).getValues()[0];
  var map = {};
  headerRow.forEach(function (n, i) { if (n) map[n.toString().trim()] = i + 1; });

  for (var k in COLUMN_NAMES) {
    var name = COLUMN_NAMES[k];
    var col = map[name];
    msg += '  - ' + name + ' : ' + (col ? col + '列目' : '❌見つかりません') + '\n';
  }

  Browser.msgBox(msg);
}

function sortByField(sheet) {
  var colMap = { '箱ID': 2, '管理番号': 3, 'ブランド': 4, 'サイズ': 5, '性別': 6, 'カテゴリ': 7 };
  var field = sheet.getRange('B4').getValue();
  var colIdx = colMap[field];
  var lastRow = sheet.getLastRow();
  if (colIdx && lastRow >= 7) {
    sheet.getRange(7, 1, lastRow - 6, sheet.getLastColumn()).sort({ column: colIdx, ascending: true });
  }
}

function calcPriceTier_(n) {
  var table = [
    [50, 100], [100, 220], [149, 330], [199, 385], [249, 495],
    [299, 550], [349, 605], [399, 660], [449, 715], [499, 825],
    [549, 880], [599, 935], [649, 990], [699, 1045], [749, 1155],
    [799, 1210], [849, 1265], [899, 1320], [949, 1375], [999, 1485],
    [1049, 1540], [1099, 1595], [1149, 1650], [1199, 1705], [1249, 1815],
    [1299, 1870], [1349, 1925], [1399, 1980], [1449, 2035], [1499, 2145],
    [1549, 2200], [1599, 2255], [1649, 2310], [1699, 2365]
  ];
  if (n < 0) return 0;
  for (var i = 0; i < table.length; i++) {
    if (n <= table[i][0]) return table[i][1];
  }
  return table[table.length - 1][1];
}
