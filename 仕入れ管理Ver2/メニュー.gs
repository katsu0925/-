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
    .addItem('1. 依頼展開（受付番号→回収完了へ展開）', 'expandOrder')
    .addItem('2. 配布用リスト生成＋XLSX出力', 'generateAndExportForOrder')
    .addItem('3. 欠品処理', 'handleMissingProducts')
    .addItem('4. 売却反映（チェック行を一括処理）', 'processSelectedSales')
    .addItem('5. 再生成（受付番号で回収完了を再作成）', 'regenerateOrder')
    .addSeparator()
    .addItem('不要トリガー一括削除', 'cleanupObsoleteTriggers')
    .addSubMenu(invMenu)
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
// 1. 依頼展開 — 受付番号を指定して依頼管理から商品リストを取得し回収完了へ展開
// ═══════════════════════════════════════════

function expandOrder() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('依頼展開', '受付番号を入力してください（複数の場合は「、」区切り）:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) { ui.alert('受付番号が空です。'); return; }

  var receiptNos = input.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (receiptNos.length === 0) { ui.alert('有効な受付番号がありません。'); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('依頼展開を開始します...', '処理中', 30);

  var requestSs = SpreadsheetApp.openById('1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc');
  var reqSheet = requestSs.getSheetByName('依頼管理');
  if (!reqSheet) { ui.alert('依頼管理シートが見つかりません。'); return; }

  var reqLastRow = reqSheet.getLastRow();
  if (reqLastRow < 2) { ui.alert('依頼管理にデータがありません。'); return; }

  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var receiptCol = rIdx['受付番号'];
  var nameCol = rIdx['会社名/氏名'];
  var selectionCol = rIdx['選択リスト'];
  if (receiptCol === undefined || selectionCol === undefined) {
    ui.alert('依頼管理シートに「受付番号」または「選択リスト」列が見つかりません。');
    return;
  }

  var main = ss.getSheetByName('商品管理');
  var mData = main.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var aiSheet = ss.getSheetByName(AI_SHEET_NAME);
  var aiMap = buildAiMap_(aiSheet);

  var returnSheet = ss.getSheetByName('返送管理');
  var boxMap = buildBoxMap_(returnSheet);

  var out = ss.getSheetByName('回収完了');

  var totalAdded = 0;

  receiptNos.forEach(function(receiptNo) {
    var reqRow = reqData.find(function(r) { return String(r[receiptCol] || '').trim() === receiptNo; });
    if (!reqRow) {
      ss.toast('受付番号 ' + receiptNo + ' が見つかりません', '警告', 3);
      return;
    }

    var selectionStr = String(reqRow[selectionCol] || '');
    var ids = selectionStr.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    if (ids.length === 0) return;

    var outArr = [];
    ids.forEach(function(mgmtId) {
      var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === mgmtId; });
      if (!row) return;

      outArr.push([
        false,
        boxMap[mgmtId] || '',
        mgmtId,
        row[mIdx['ブランド']] || '',
        row[mIdx['メルカリサイズ']] || '',
        row[mIdx['性別']] || '',
        row[mIdx['カテゴリ2']] || '',
        aiMap[mgmtId] || '',
        row[mIdx['出品日']] || '',
        row[mIdx['使用アカウント']] || '',
        row[mIdx['仕入れ値']] || '',
        row[mIdx['納品場所']] || '',
        receiptNo
      ]);
    });

    if (outArr.length > 0) {
      var startRow = Math.max(out.getLastRow() + 1, 7);
      out.getRange(startRow, 1, outArr.length, outArr[0].length).setValues(outArr);
      out.getRange(startRow, 1, outArr.length, 1).insertCheckboxes();
      totalAdded += outArr.length;
    }
  });

  ensureRecoveryHeaders_(out);
  ss.toast(totalAdded + '件を回収完了に展開しました', '完了', 5);
}

// ═══════════════════════════════════════════
// 2. 配布用リスト生成＋XLSX出力（バッチ対応）
// ═══════════════════════════════════════════

function generateAndExportForOrder() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSheet = ss.getSheetByName('回収完了');
  var mainSheet = ss.getSheetByName('商品管理');

  var lastRow = listSheet.getLastRow();
  if (lastRow < 7) { ss.toast('リストが空です', 'エラー'); return; }

  var listData = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();
  var checkedRows = listData.filter(function(r) { return r[0] === true; });

  if (checkedRows.length === 0) {
    ss.toast('チェックされた項目がありません。', '処理中断');
    return;
  }

  // 受付番号でグループ化
  var groups = {};
  checkedRows.forEach(function(r) {
    var rn = String(r[12] || '').trim();
    if (!rn) rn = '__none__';
    if (!groups[rn]) groups[rn] = [];
    groups[rn].push(r);
  });

  var mData = mainSheet.getDataRange().getValues();
  var headers = mData.shift();
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });

  // 依頼管理から顧客情報を取得
  var requestSs = SpreadsheetApp.openById('1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc');
  var reqSheet = requestSs.getSheetByName('依頼管理');
  var reqData = reqSheet.getRange(1, 1, reqSheet.getLastRow(), reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var results = [];
  var exportSheetName = '配布用リスト';
  var exportSheet = ss.getSheetByName(exportSheetName);
  if (!exportSheet) exportSheet = ss.insertSheet(exportSheetName);

  var groupKeys = Object.keys(groups);
  for (var g = 0; g < groupKeys.length; g++) {
    var receiptNo = groupKeys[g];
    var targetRows = groups[receiptNo];
    if (receiptNo === '__none__') {
      ss.toast('受付番号が空の行があります。スキップします。', '警告', 3);
      continue;
    }

    // 顧客情報を依頼管理から取得
    var customerName = '';
    var reqRow = reqData.find(function(r) { return String(r[rIdx['受付番号']] || '').trim() === receiptNo; });
    if (reqRow) {
      customerName = String(reqRow[rIdx['会社名/氏名']] || '').trim();
    }

    // 配布用リストシートを構築
    var maxRows = exportSheet.getMaxRows();
    var maxCols = exportSheet.getMaxColumns();
    if (maxRows >= 2) {
      exportSheet.getRange(2, 1, maxRows - 1, maxCols).clearContent();
      exportSheet.getRange(2, 1, maxRows - 1, 1).removeCheckboxes();
    }
    exportSheet.getRange('A1').setValue('受付番号');
    exportSheet.getRange('B1').setValue(receiptNo);
    exportSheet.getRange('E1').setValue(customerName);
    exportSheet.getRange('I1').setValue(receiptNo);

    var headerRow = ['確認', '箱ID', '管理番号(照合用)', 'ブランド', 'AIタイトル候補', 'アイテム', 'サイズ', '状態', '傷汚れ詳細', '採寸情報', '即出品用説明文（コピペ用）', '金額'];
    var exportData = [headerRow];

    targetRows.forEach(function(listRow) {
      var boxId = listRow[1];
      var targetId = String(listRow[2] || '').trim();
      var aiTitle = listRow[7];
      if (!targetId) return;

      var row = mData.find(function(r) { return String(r[idx['管理番号']] || '').trim() === targetId; });
      if (!row) return;

      var condition = row[idx['状態']] || '目立った傷や汚れなし';
      var damageDetail = row[idx['傷汚れ詳細']] || '';
      var brand = row[idx['ブランド']] || '';
      var size = row[idx['メルカリサイズ']] || '';
      var item = row[idx['カテゴリ2']] || '古着';
      if (!aiTitle) aiTitle = '';

      var length = row[idx['着丈']] || '-';
      var width = row[idx['身幅']] || '-';
      var shoulder = row[idx['肩幅']] || '-';
      var sleeve = row[idx['袖丈']] || '-';
      var waist = row[idx['ウエスト']];
      var rise = row[idx['股上']];
      var inseam = row[idx['股下']];

      var measurementText = '';
      if (length != '-' || width != '-') {
        measurementText += '着丈: ' + length + ' / 身幅: ' + width + ' / 肩幅: ' + shoulder + ' / 袖丈: ' + sleeve + '\n';
      }
      if (waist) {
        measurementText += 'ウエスト: ' + waist + ' / 股上: ' + rise + ' / 股下: ' + inseam;
      }
      measurementText = measurementText.trim();

      var description =
        '【管理番号】\n' +
        '【ブランド】' + brand + '\n' +
        '【サイズ】' + size + '\n' +
        '【状態】' + condition + '\n';
      if (damageDetail !== '') {
        description += '【状態詳細】\n' + damageDetail + '\n';
      }
      description += '【実寸(cm)】\n' + measurementText + '\n' +
        '\n※素人採寸のため多少の誤差はご了承ください。';

      var cost = toNumber_(listRow[10]) || 0;
      var price = calcPriceTier_(cost);
      var priceText = price.toLocaleString('ja-JP') + '円';

      exportData.push([false, boxId, targetId, brand, aiTitle, item, size, condition, damageDetail, measurementText, description, priceText]);
    });

    exportSheet.getRange(2, 1, exportData.length, exportData[0].length).setValues(exportData);
    if (exportData.length > 1) {
      exportSheet.getRange(3, 1, exportData.length - 1, 1).insertCheckboxes();
    }

    SpreadsheetApp.flush();

    // XLSX出力
    var result = exportDistributionList();
    results.push({ receiptNo: receiptNo, result: result });
  }

  // 結果レポート
  var msg = '';
  results.forEach(function(r) {
    if (r.result && r.result.ok) {
      msg += r.receiptNo + ': OK (' + r.result.fileName + ')\n';
    } else {
      msg += r.receiptNo + ': エラー - ' + (r.result ? r.result.message : '不明') + '\n';
    }
  });

  if (msg) {
    ui.alert('配布用リスト生成結果', msg, ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════
// 3. 欠品処理
// ═══════════════════════════════════════════

function handleMissingProducts() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSheet = ss.getSheetByName('回収完了');

  var lastRow = listSheet.getLastRow();
  if (lastRow < 7) { ss.toast('データがありません', '終了'); return; }

  var listData = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();
  var checkedRows = [];
  for (var i = 0; i < listData.length; i++) {
    if (listData[i][0] === true) {
      checkedRows.push({ idx: i, data: listData[i] });
    }
  }

  if (checkedRows.length === 0) {
    ss.toast('欠品対象のチェックがありません。', '処理中断');
    return;
  }

  var confirm = ui.alert('欠品処理',
    checkedRows.length + '件を欠品として処理します。\n' +
    '回収完了から削除し、依頼管理の選択リストを更新します。\nよろしいですか？',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  ss.toast('欠品処理を開始します...', '処理中', 30);

  // 受付番号別にグループ化
  var groups = {};
  checkedRows.forEach(function(r) {
    var receiptNo = String(r.data[12] || '').trim();
    if (!receiptNo) return;
    if (!groups[receiptNo]) groups[receiptNo] = [];
    groups[receiptNo].push(String(r.data[2] || '').trim());
  });

  // 依頼管理の選択リストから欠品商品を除外
  var requestSs = SpreadsheetApp.openById('1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc');
  var reqSheet = requestSs.getSheetByName('依頼管理');
  var reqLastRow = reqSheet.getLastRow();
  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData[0];
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var receiptCol = rIdx['受付番号'];
  var selectionCol = rIdx['選択リスト'];
  var countCol = rIdx['合計点数'];

  Object.keys(groups).forEach(function(receiptNo) {
    var missingIds = groups[receiptNo];
    var missingSet = {};
    missingIds.forEach(function(id) { missingSet[id] = true; });

    for (var i = 1; i < reqData.length; i++) {
      if (String(reqData[i][receiptCol] || '').trim() === receiptNo) {
        var currentList = String(reqData[i][selectionCol] || '');
        var currentIds = currentList.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        var newIds = currentIds.filter(function(id) { return !missingSet[id]; });
        reqSheet.getRange(i + 1, selectionCol + 1).setValue(newIds.join('、'));
        if (countCol !== undefined) {
          reqSheet.getRange(i + 1, countCol + 1).setValue(newIds.length);
        }
        break;
      }
    }
  });

  // 回収完了からチェック行を削除（下から）
  var rowsToDelete = checkedRows.map(function(r) { return r.idx + 7; });
  rowsToDelete.sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(r) { listSheet.deleteRow(r); });

  ss.toast(checkedRows.length + '件の欠品処理を完了しました', '処理完了', 5);
}

// ═══════════════════════════════════════════
// 4. 売却反映（売却履歴ログ付き）
// ═══════════════════════════════════════════

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
  headerRow.forEach(function(name, i) {
    if (name) colMap[String(name).trim()] = i + 1;
  });

  var statusCol = colMap[COLUMN_NAMES.STATUS];
  if (!statusCol) {
    Browser.msgBox('エラー：ステータス列が見つかりません。');
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
  mainIds.forEach(function(id, index) {
    var k = String(id).trim();
    if (k !== '') idToRowMap[k] = index + 2;
  });

  var values = sh.getRange(7, 1, lastRow - 6, 17).getValues();

  var rowsToDelete = [];
  var uniqueRowSet = {};
  var statusRows = [];
  var saleLogEntries = [];

  for (var i = 0; i < values.length; i++) {
    var rowData = values[i];

    var isChecked = rowData[0] === true;
    if (!isChecked) continue;

    var id = String(rowData[2] || '').trim();
    if (id === '') continue;

    var tgtRow = idToRowMap[id];
    if (!tgtRow) continue;

    var receiptNo = String(rowData[12] || '').trim();

    rowsToDelete.push(i + 7);
    saleLogEntries.push({
      date: new Date(),
      managedId: id,
      receiptNo: receiptNo,
      brand: rowData[3] || '',
      cost: rowData[10] || ''
    });

    if (!uniqueRowSet[tgtRow]) {
      uniqueRowSet[tgtRow] = true;
      statusRows.push(tgtRow);
    }
  }

  if (rowsToDelete.length === 0) {
    ss.toast('処理対象がありませんでした', '完了', 3);
    return;
  }

  // 商品管理のステータスを売却済みに
  var statusA1s = [];
  var statusColLetter = colNumToLetter_(statusCol);
  for (var a = 0; a < statusRows.length; a++) {
    statusA1s.push(statusColLetter + statusRows[a]);
  }
  main.getRangeList(statusA1s).setValue('売却済み');
  SpreadsheetApp.flush();

  // 売却履歴ログ
  writeSaleLog_(ss, saleLogEntries);

  // 回収完了から削除
  rowsToDelete.sort(function(x, y) { return y - x; }).forEach(function(r) {
    sh.deleteRow(r);
  });

  ss.toast(rowsToDelete.length + '件を処理しました（売却済み反映＋売却履歴記録＋回収完了から削除）', '処理完了', 5);
}

// ═══════════════════════════════════════════
// 5. 再生成 — 受付番号指定で回収完了の該当行を削除して再展開
// ═══════════════════════════════════════════

function regenerateOrder() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('再生成', '再生成する受付番号を入力してください:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var receiptNo = String(res.getResponseText() || '').trim();
  if (!receiptNo) { ui.alert('受付番号が空です。'); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var listSheet = ss.getSheetByName('回収完了');
  var lastRow = listSheet.getLastRow();

  // 既存行を削除
  if (lastRow >= 7) {
    var data = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();
    var rowsToDelete = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][12] || '').trim() === receiptNo) {
        rowsToDelete.push(i + 7);
      }
    }
    rowsToDelete.sort(function(a, b) { return b - a; });
    rowsToDelete.forEach(function(r) { listSheet.deleteRow(r); });

    if (rowsToDelete.length > 0) {
      ss.toast(rowsToDelete.length + '件の既存行を削除しました', '再生成中', 3);
    }
  }

  // 再展開（expandOrderの内部ロジックを再利用）
  var requestSs = SpreadsheetApp.openById('1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc');
  var reqSheet = requestSs.getSheetByName('依頼管理');
  var reqLastRow = reqSheet.getLastRow();
  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var reqRow = reqData.find(function(r) { return String(r[rIdx['受付番号']] || '').trim() === receiptNo; });
  if (!reqRow) { ui.alert('受付番号 ' + receiptNo + ' が依頼管理に見つかりません。'); return; }

  var selectionStr = String(reqRow[rIdx['選択リスト']] || '');
  var ids = selectionStr.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (ids.length === 0) { ui.alert('選択リストが空です。'); return; }

  var main = ss.getSheetByName('商品管理');
  var mData = main.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var aiSheet = ss.getSheetByName(AI_SHEET_NAME);
  var aiMap = buildAiMap_(aiSheet);
  var returnSheet = ss.getSheetByName('返送管理');
  var boxMap = buildBoxMap_(returnSheet);

  var outArr = [];
  ids.forEach(function(mgmtId) {
    var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === mgmtId; });
    if (!row) return;

    outArr.push([
      false,
      boxMap[mgmtId] || '',
      mgmtId,
      row[mIdx['ブランド']] || '',
      row[mIdx['メルカリサイズ']] || '',
      row[mIdx['性別']] || '',
      row[mIdx['カテゴリ2']] || '',
      aiMap[mgmtId] || '',
      row[mIdx['出品日']] || '',
      row[mIdx['使用アカウント']] || '',
      row[mIdx['仕入れ値']] || '',
      row[mIdx['納品場所']] || '',
      receiptNo
    ]);
  });

  if (outArr.length > 0) {
    var startRow = Math.max(listSheet.getLastRow() + 1, 7);
    listSheet.getRange(startRow, 1, outArr.length, outArr[0].length).setValues(outArr);
    listSheet.getRange(startRow, 1, outArr.length, 1).insertCheckboxes();
  }

  ensureRecoveryHeaders_(listSheet);
  ss.toast('受付番号 ' + receiptNo + ' を ' + outArr.length + '件で再生成しました', '完了', 5);
}

// ═══════════════════════════════════════════
// 不要トリガー一括削除
// ═══════════════════════════════════════════

function cleanupObsoleteTriggers() {
  var obsolete = ['generateCompletionList', 'rc_handleRecoveryCompleteOnEdit_', 'toggleKaishuKanryoFilter'];
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
// ヘルパー関数
// ═══════════════════════════════════════════

function buildAiMap_(aiSheet) {
  var aiMap = {};
  if (!aiSheet) return aiMap;

  var aiData = aiSheet.getDataRange().getValues();
  var aiHeaders = aiData.shift();
  var aiIdIdx = aiHeaders.indexOf('管理番号');
  var keywordIndices = [];
  aiHeaders.forEach(function(h, i) {
    if (String(h).match(/キーワード|Keyword/)) keywordIndices.push(i);
  });

  if (aiIdIdx > -1 && keywordIndices.length > 0) {
    aiData.forEach(function(r) {
      var id = String(r[aiIdIdx]).trim();
      if (id) {
        var words = [];
        keywordIndices.forEach(function(idx) {
          var val = r[idx];
          if (val && String(val).trim() !== '') words.push(val);
        });
        aiMap[id] = words.join(' ');
      }
    });
  }
  return aiMap;
}

function buildBoxMap_(returnSheet) {
  var boxMap = {};
  if (!returnSheet) return boxMap;

  var rData = returnSheet.getDataRange().getValues();
  for (var i = 1; i < rData.length; i++) {
    var row = rData[i];
    var boxId = row[0];
    var mgmtIdsStr = String(row[2]);
    if (mgmtIdsStr) {
      var ids = mgmtIdsStr.split(/[、,]/);
      ids.forEach(function(id) {
        boxMap[id.trim()] = boxId;
      });
    }
  }
  return boxMap;
}

function ensureRecoveryHeaders_(sheet) {
  var headerTitles = [
    '確認', '箱ID', '管理番号', 'ブランド', 'サイズ', '性別', 'カテゴリ', 'AIタイトル(KW1-8)', '出品日', 'アカウント', '仕入れ値', '納品場所', '【入力】受付番号'
  ];
  sheet.getRange(6, 1, 1, headerTitles.length).setValues([headerTitles]).setFontWeight('bold').setBackground('#f3f3f3');
}

function writeSaleLog_(ss, entries) {
  if (!entries || entries.length === 0) return;

  var logSheetName = '売却履歴';
  var logSheet = ss.getSheetByName(logSheetName);
  if (!logSheet) {
    logSheet = ss.insertSheet(logSheetName);
    logSheet.getRange(1, 1, 1, 5).setValues([['売却日', '管理番号', '受付番号', 'ブランド', '仕入れ値']]).setFontWeight('bold');
  }

  var logData = entries.map(function(e) {
    return [e.date, e.managedId, e.receiptNo, e.brand, e.cost];
  });

  var startRow = logSheet.getLastRow() + 1;
  logSheet.getRange(startRow, 1, logData.length, logData[0].length).setValues(logData);
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

function sortByField(sheet) {
  var colMap = { '箱ID': 2, '管理番号': 3, 'ブランド': 4, 'サイズ': 5, '性別': 6, 'カテゴリ': 7 };
  var field = sheet.getRange('B4').getValue();
  var colIdx = colMap[field];
  var lastRow = sheet.getLastRow();
  if (colIdx && lastRow >= 7) {
    sheet.getRange(7, 1, lastRow - 6, sheet.getLastColumn()).sort({ column: colIdx, ascending: true });
  }
}
