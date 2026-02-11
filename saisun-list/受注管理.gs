// ═══════════════════════════════════════════
// 受注管理.gs — 受付番号ベースの一括操作メニュー
// 依頼管理（本SS）⇔ 仕入れ管理Ver2（回収完了・商品管理等）を跨いで処理
// ═══════════════════════════════════════════

var OM_SHIIRE_SS_ID = '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo';
var OM_DIST_SHEET_GID  = 1614333946;
var OM_DIST_NAME_CELL  = 'E1';
var OM_DIST_RECEIPT_CELL = 'I1';
var OM_XLSX_FOLDER_ID  = '1lq8Xb_dVwz5skrXlGvrS5epTwEc_yEts';

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

  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  activeSs.toast('依頼展開を開始します...', '処理中', 30);

  // 依頼管理は本SSにある
  var reqSheet = activeSs.getSheetByName('依頼管理');
  if (!reqSheet) { ui.alert('依頼管理シートが見つかりません。'); return; }

  var reqLastRow = reqSheet.getLastRow();
  if (reqLastRow < 2) { ui.alert('依頼管理にデータがありません。'); return; }

  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var receiptCol = rIdx['受付番号'];
  var selectionCol = rIdx['選択リスト'];
  if (receiptCol === undefined || selectionCol === undefined) {
    ui.alert('依頼管理シートに「受付番号」または「選択リスト」列が見つかりません。');
    return;
  }

  // 仕入れ管理のシートを開く
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var main = shiireSs.getSheetByName('商品管理');
  var mData = main.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);

  var returnSheet = shiireSs.getSheetByName('返送管理');
  var boxMap = om_buildBoxMap_(returnSheet);

  var out = shiireSs.getSheetByName('回収完了');

  var totalAdded = 0;

  receiptNos.forEach(function(receiptNo) {
    var reqRow = reqData.find(function(r) { return String(r[receiptCol] || '').trim() === receiptNo; });
    if (!reqRow) {
      activeSs.toast('受付番号 ' + receiptNo + ' が見つかりません', '警告', 3);
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
        '',
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
      totalAdded += outArr.length;
    }
  });

  om_ensureRecoveryHeaders_(out);

  // --- データ1のJ列に自動チェック ---
  // 展開された全管理番号を収集
  var allExpandedIds = [];
  receiptNos.forEach(function(receiptNo) {
    var reqRow = reqData.find(function(r) { return String(r[receiptCol] || '').trim() === receiptNo; });
    if (!reqRow) return;
    var selectionStr = String(reqRow[selectionCol] || '');
    var ids = selectionStr.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    ids.forEach(function(id) { allExpandedIds.push(id); });
  });

  if (allExpandedIds.length > 0) {
    try {
      var destSsId = String(APP_CONFIG.data.spreadsheetId || '').trim();
      var destSs = destSsId ? SpreadsheetApp.openById(destSsId) : activeSs;
      var destSheet = destSs.getSheetByName('データ1');
      if (destSheet) {
        var destStartRow = 4; // CONFIG.DEST_START_ROW
        var destLastRow = destSheet.getLastRow();
        if (destLastRow >= destStartRow) {
          var numRows = destLastRow - destStartRow + 1;
          var kVals = destSheet.getRange(destStartRow, 11, numRows, 1).getDisplayValues(); // K列=11
          var jRange = destSheet.getRange(destStartRow, 10, numRows, 1); // J列=10
          var jVals = jRange.getValues();

          var idSet = {};
          allExpandedIds.forEach(function(id) { idSet[String(id).trim()] = true; });

          var checkedCount = 0;
          for (var k = 0; k < numRows; k++) {
            var key = String(kVals[k][0] || '').trim();
            if (key && idSet[key] && jVals[k][0] !== true) {
              jVals[k][0] = true;
              checkedCount++;
            }
          }
          if (checkedCount > 0) {
            jRange.setValues(jVals);
          }
          activeSs.toast(totalAdded + '件を回収完了に展開し、' + checkedCount + '件のJ列チェックを付けました', '完了', 5);
        } else {
          activeSs.toast(totalAdded + '件を回収完了に展開しました（データ1にデータなし）', '完了', 5);
        }
      } else {
        activeSs.toast(totalAdded + '件を回収完了に展開しました（データ1シート未検出）', '完了', 5);
      }
    } catch (e) {
      console.error('J列自動チェックエラー:', e);
      activeSs.toast(totalAdded + '件を回収完了に展開しました（チェック付与でエラー）', '完了', 5);
    }
  } else {
    activeSs.toast(totalAdded + '件を回収完了に展開しました', '完了', 5);
  }
}

// ═══════════════════════════════════════════
// 2. 配布用リスト生成＋XLSX出力（バッチ対応）
// ═══════════════════════════════════════════

function generateAndExportForOrder() {
  var ui = SpreadsheetApp.getUi();
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);

  var listSheet = shiireSs.getSheetByName('回収完了');
  var mainSheet = shiireSs.getSheetByName('商品管理');

  var lastRow = listSheet.getLastRow();
  if (lastRow < 7) { activeSs.toast('リストが空です', 'エラー'); return; }

  var listData = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();

  // 受付番号でグループ化（全行対象）
  var groups = {};
  listData.forEach(function(r) {
    var rn = String(r[12] || '').trim();
    if (!rn) rn = '__none__';
    if (!groups[rn]) groups[rn] = [];
    groups[rn].push(r);
  });

  var mData = mainSheet.getDataRange().getValues();
  var headers = mData.shift();
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });

  // 依頼管理は本SSから取得
  var reqSheet = activeSs.getSheetByName('依頼管理');
  var reqData = reqSheet.getRange(1, 1, reqSheet.getLastRow(), reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var results = [];
  var exportSheet = shiireSs.getSheetByName('配布用リスト');
  if (!exportSheet) exportSheet = shiireSs.insertSheet('配布用リスト');

  var groupKeys = Object.keys(groups);
  for (var g = 0; g < groupKeys.length; g++) {
    var receiptNo = groupKeys[g];
    var targetRows = groups[receiptNo];
    if (receiptNo === '__none__') {
      activeSs.toast('受付番号が空の行があります。スキップします。', '警告', 3);
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
      var price = om_calcPriceTier_(cost);
      var priceText = price.toLocaleString('ja-JP') + '円';

      exportData.push([false, boxId, targetId, brand, aiTitle, item, size, condition, damageDetail, measurementText, description, priceText]);
    });

    exportSheet.getRange(2, 1, exportData.length, exportData[0].length).setValues(exportData);
    if (exportData.length > 1) {
      exportSheet.getRange(3, 1, exportData.length - 1, 1).insertCheckboxes();
    }

    SpreadsheetApp.flush();

    // XLSX出力
    var result = om_exportDistributionXlsx_();
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
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();

  var res = ui.prompt('欠品処理', '欠品の管理番号を入力してください（複数の場合は「、」区切り）:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) { ui.alert('管理番号が空です。'); return; }

  var targetIds = input.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (targetIds.length === 0) { ui.alert('有効な管理番号がありません。'); return; }
  var targetSet = {};
  targetIds.forEach(function(id) { targetSet[id] = true; });

  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var listSheet = shiireSs.getSheetByName('回収完了');
  var lastRow = listSheet.getLastRow();
  if (lastRow < 7) { activeSs.toast('データがありません', '終了'); return; }

  var listData = listSheet.getRange(7, 1, lastRow - 6, 13).getValues();
  var matchedRows = [];
  for (var i = 0; i < listData.length; i++) {
    var id = String(listData[i][2] || '').trim();
    if (targetSet[id]) {
      matchedRows.push({ idx: i, data: listData[i] });
    }
  }

  if (matchedRows.length === 0) {
    ui.alert('該当する管理番号が回収完了に見つかりませんでした。');
    return;
  }

  var confirm = ui.alert('欠品処理',
    matchedRows.length + '件を欠品として処理します。\n' +
    '回収完了から削除し、依頼管理の選択リストを更新します。\nよろしいですか？',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  activeSs.toast('欠品処理を開始します...', '処理中', 30);

  // 受付番号別にグループ化
  var groups = {};
  matchedRows.forEach(function(r) {
    var receiptNo = String(r.data[12] || '').trim();
    if (!receiptNo) return;
    if (!groups[receiptNo]) groups[receiptNo] = [];
    groups[receiptNo].push(String(r.data[2] || '').trim());
  });

  // 依頼管理は本SSから取得
  var reqSheet = activeSs.getSheetByName('依頼管理');
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

  // 商品管理のステータスを廃棄済みに、廃棄日に今日の日付を設定
  var mainSheet = shiireSs.getSheetByName('商品管理');
  if (mainSheet) {
    var mHeaderRow = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
    var mColMap = {};
    mHeaderRow.forEach(function(name, i) { if (name) mColMap[String(name).trim()] = i + 1; });

    var mStatusCol = mColMap['ステータス'];
    var mIdCol = mColMap['管理番号'];
    var mDiscardDateCol = mColMap['廃棄日'];

    if (mStatusCol && mIdCol) {
      var mLastRow = mainSheet.getLastRow();
      if (mLastRow >= 2) {
        var mIds = mainSheet.getRange(2, mIdCol, mLastRow - 1, 1).getValues().flat();
        var mIdToRow = {};
        mIds.forEach(function(id, idx) {
          var k = String(id).trim();
          if (k) mIdToRow[k] = idx + 2;
        });

        var today = new Date();
        targetIds.forEach(function(tid) {
          var row = mIdToRow[tid];
          if (!row) return;
          mainSheet.getRange(row, mStatusCol).setValue('廃棄済み');
          if (mDiscardDateCol) mainSheet.getRange(row, mDiscardDateCol).setValue(today);
        });
      }
    }
  }

  // 回収完了から該当行を削除（下から）
  var rowsToDelete = matchedRows.map(function(r) { return r.idx + 7; });
  rowsToDelete.sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(r) { listSheet.deleteRow(r); });

  activeSs.toast(matchedRows.length + '件の欠品処理を完了しました', '処理完了', 5);
}

// ═══════════════════════════════════════════
// 4. 売却反映（売却履歴ログ付き）
// ═══════════════════════════════════════════

function processSelectedSales() {
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);

  var sh = shiireSs.getSheetByName('回収完了');
  var main = shiireSs.getSheetByName('商品管理');

  var lastRow = sh.getLastRow();
  if (lastRow < 7) {
    activeSs.toast('データがありません', '終了');
    return;
  }

  activeSs.toast('ステータス反映と削除を開始します...', '処理中', 30);

  var headerRow = main.getRange(1, 1, 1, main.getLastColumn()).getValues()[0];
  var colMap = {};
  headerRow.forEach(function(name, i) {
    if (name) colMap[String(name).trim()] = i + 1;
  });

  var statusCol = colMap['ステータス'];
  if (!statusCol) {
    SpreadsheetApp.getUi().alert('エラー：商品管理にステータス列が見つかりません。');
    return;
  }

  var idCol = colMap['管理番号'];
  if (!idCol) {
    SpreadsheetApp.getUi().alert('エラー：商品管理に管理番号列が見つかりません。');
    return;
  }

  var mainLastRow = main.getLastRow();
  if (mainLastRow < 2) {
    activeSs.toast('商品管理にデータがありません', '終了', 5);
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
  var receiptByRow = {}; // 行番号→受付番号のマップ

  for (var i = 0; i < values.length; i++) {
    var rowData = values[i];

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
    receiptByRow[tgtRow] = receiptNo;
  }

  if (rowsToDelete.length === 0) {
    activeSs.toast('処理対象がありませんでした', '完了', 3);
    return;
  }

  // 商品管理のステータスを売却済みに
  var statusA1s = [];
  var statusColLetter = om_colNumToLetter_(statusCol);
  for (var a = 0; a < statusRows.length; a++) {
    statusA1s.push(statusColLetter + statusRows[a]);
  }
  main.getRangeList(statusA1s).setValue('売却済み');

  // BO列(67列目)に受付番号を書き込み
  var boColLetter = om_colNumToLetter_(67);
  var boA1s = [];
  var boValues = [];
  for (var b = 0; b < statusRows.length; b++) {
    boA1s.push(boColLetter + statusRows[b]);
    boValues.push(receiptByRow[statusRows[b]] || '');
  }
  if (boA1s.length > 0) {
    for (var c = 0; c < boA1s.length; c++) {
      main.getRange(boA1s[c]).setValue(boValues[c]);
    }
  }

  SpreadsheetApp.flush();

  // 売却履歴ログ
  om_writeSaleLog_(shiireSs, saleLogEntries);

  // 回収完了から削除
  rowsToDelete.sort(function(x, y) { return y - x; }).forEach(function(r) {
    sh.deleteRow(r);
  });

  activeSs.toast(rowsToDelete.length + '件を処理しました（売却済み反映＋売却履歴記録＋回収完了から削除）', '処理完了', 5);
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

  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var listSheet = shiireSs.getSheetByName('回収完了');
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
      activeSs.toast(rowsToDelete.length + '件の既存行を削除しました', '再生成中', 3);
    }
  }

  // 依頼管理は本SSから取得
  var reqSheet = activeSs.getSheetByName('依頼管理');
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

  var main = shiireSs.getSheetByName('商品管理');
  var mData = main.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);
  var returnSheet = shiireSs.getSheetByName('返送管理');
  var boxMap = om_buildBoxMap_(returnSheet);

  var outArr = [];
  ids.forEach(function(mgmtId) {
    var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === mgmtId; });
    if (!row) return;

    outArr.push([
      '',
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
  }

  om_ensureRecoveryHeaders_(listSheet);
  activeSs.toast('受付番号 ' + receiptNo + ' を ' + outArr.length + '件で再生成しました', '完了', 5);
}

// ═══════════════════════════════════════════
// 不要トリガー一括削除（採寸付商品リストVer2プロジェクト用）
// ═══════════════════════════════════════════

function cleanupObsoleteTriggers() {
  var obsolete = ['onDestCheckboxEdit'];
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
// XLSX出力
// ═══════════════════════════════════════════

function om_exportDistributionXlsx_() {
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var nameSheet = shiireSs.getSheetByName('配布用リスト');
  if (!nameSheet) return { ok: false, message: '配布用リスト が見つかりません' };

  var rawName = String(nameSheet.getRange(OM_DIST_NAME_CELL).getDisplayValue() || '').trim();
  if (!rawName) return { ok: false, message: '配布用リスト!E1 が空です' };

  var receiptNo = String(nameSheet.getRange(OM_DIST_RECEIPT_CELL).getDisplayValue() || '').trim();
  if (!receiptNo) return { ok: false, message: '配布用リスト!I1（受付番号）が空です' };

  var baseName = rawName + '様';
  var exportFileName = baseName + '_' + receiptNo + '.xlsx';
  var folder = DriveApp.getFolderById(OM_XLSX_FOLDER_ID);

  // 同名ファイル・旧形式（受付番号なし）を削除
  var oldFileName = baseName + '.xlsx';
  [exportFileName, oldFileName].forEach(function(fname) {
    var existing = folder.getFilesByName(fname);
    while (existing.hasNext()) {
      existing.next().setTrashed(true);
    }
  });

  var srcSheet = om_getSheetByGid_(shiireSs, OM_DIST_SHEET_GID);
  var tmpSs = SpreadsheetApp.create('tmp_' + baseName + '_' + Date.now());
  var tmpId = tmpSs.getId();
  var copied = srcSheet.copyTo(tmpSs);
  copied.setName(srcSheet.getName());
  om_deleteAllExceptSheet_(tmpSs, copied.getSheetId());
  om_trimColumnBAfterSecondHyphen_(copied);
  om_trimToDataBoundsStrict_(copied);
  SpreadsheetApp.flush();

  var xlsxBlob = om_exportAsXlsxBlob_(tmpId, exportFileName);
  var outFile = folder.createFile(xlsxBlob);
  outFile.setName(exportFileName);
  outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = outFile.getUrl();

  // 依頼管理のリンク更新（本SSから直接取得）
  om_updateRequestSheetLink_(rawName, receiptNo, url);

  DriveApp.getFileById(tmpId).setTrashed(true);
  return { ok: true, url: url, fileName: exportFileName };
}

function om_updateRequestSheetLink_(name, receiptNo, url) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('依頼管理');
  if (!sh) return;

  var lastRow = Math.max(sh.getLastRow(), 1);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var receiptCol = om_findColByName_(headers, '受付番号');
  var nameCol = om_findColByName_(headers, '会社名/氏名');
  var linkCol = om_findColByName_(headers, '確認リンク');
  if (receiptCol === -1 || nameCol === -1 || linkCol === -1) return;

  var dataRows = lastRow - 1;
  if (dataRows < 1) return;
  var receiptVals = sh.getRange(2, receiptCol, dataRows, 1).getDisplayValues();
  var nameVals = sh.getRange(2, nameCol, dataRows, 1).getDisplayValues();
  var targetReceipt = String(receiptNo || '').trim();
  var targetName = String(name || '').trim();
  var found = false;
  for (var i = 0; i < dataRows; i++) {
    var r = String(receiptVals[i][0] || '').trim();
    var n = String(nameVals[i][0] || '').trim();
    if (r === targetReceipt && n === targetName) {
      sh.getRange(i + 2, linkCol).setValue(url);
      found = true;
    }
  }
  if (!found) {
    var newRow = lastRow + 1;
    sh.getRange(newRow, receiptCol).setValue(targetReceipt);
    sh.getRange(newRow, nameCol).setValue(targetName);
    sh.getRange(newRow, linkCol).setValue(url);
  }
}

// ═══════════════════════════════════════════
// ヘルパー関数（om_ プレフィックスで名前衝突を回避）
// ═══════════════════════════════════════════

function om_buildAiMap_(aiSheet) {
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

function om_buildBoxMap_(returnSheet) {
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

function om_ensureRecoveryHeaders_(sheet) {
  var headerTitles = [
    '確認', '箱ID', '管理番号', 'ブランド', 'サイズ', '性別', 'カテゴリ', 'AIタイトル(KW1-8)', '出品日', 'アカウント', '仕入れ値', '納品場所', '【入力】受付番号'
  ];
  sheet.getRange(6, 1, 1, headerTitles.length).setValues([headerTitles]).setFontWeight('bold').setBackground('#f3f3f3');
}

function om_writeSaleLog_(ss, entries) {
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

function om_calcPriceTier_(n) {
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

// ═══════════════════════════════════════════
// XLSX用サブ関数
// ═══════════════════════════════════════════

function om_getSheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  throw new Error('指定gidのシートが見つかりません: ' + gid);
}

function om_deleteAllExceptSheet_(ss, keepSheetId) {
  var sheets = ss.getSheets();
  for (var i = sheets.length - 1; i >= 0; i--) {
    var sh = sheets[i];
    if (sh.getSheetId() !== keepSheetId) {
      if (ss.getSheets().length > 1) ss.deleteSheet(sh);
    }
  }
}

function om_trimColumnBAfterSecondHyphen_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  var rng = sheet.getRange(1, 2, lastRow, 1);
  var vals = rng.getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    var s = String(vals[i][0] || '');
    if (!s) { vals[i][0] = ''; continue; }
    var parts = s.split('-');
    if (parts.length >= 2) { vals[i][0] = parts[0] + '-' + parts[1]; }
    else { vals[i][0] = s; }
  }
  rng.setValues(vals);
}

function om_trimToDataBoundsStrict_(sheet) {
  var rowCand = Math.max(sheet.getLastRow(), 1);
  var colCand = Math.max(sheet.getLastColumn(), 1);
  var vals = sheet.getRange(1, 1, rowCand, colCand).getDisplayValues();
  var lastR = 1;
  var lastC = 1;
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    for (var c = 0; c < row.length; c++) {
      if (String(row[c] || '').trim() !== '') {
        if (r + 1 > lastR) lastR = r + 1;
        if (c + 1 > lastC) lastC = c + 1;
      }
    }
  }
  var maxR = sheet.getMaxRows();
  var maxC = sheet.getMaxColumns();
  if (maxR > lastR) sheet.deleteRows(lastR + 1, maxR - lastR);
  if (maxC > lastC) sheet.deleteColumns(lastC + 1, maxC - lastC);
}

function om_exportAsXlsxBlob_(spreadsheetId, filename) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('XLSXエクスポートに失敗しました: ' + code + ' / ' + res.getContentText());
  }
  return res.getBlob().setName(filename);
}

// ═══════════════════════════════════════════
// ユーティリティ（本プロジェクトに無いもの）
// ═══════════════════════════════════════════

function om_findColByName_(headerRow, name) {
  var target = String(name || '').trim();
  for (var i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i] || '').trim() === target) return i + 1;
  }
  return -1;
}

function om_colNumToLetter_(col) {
  var s = '';
  var n = col;
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
