// ═══════════════════════════════════════════
// 受注管理.gs — 受付番号ベースの一括操作メニュー（2ステップ版）
// 依頼管理（本SS）⇔ 仕入れ管理Ver2（回収完了・商品管理等）を跨いで処理
//
// ステップ1: expandOrder()         — 依頼展開（展開→XLSX生成→売却反映 一括）
// ステップ2: handleMissingProducts() — 欠品処理（返品+再生成 一括）
// ═══════════════════════════════════════════

var OM_SHIIRE_SS_ID = '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo';
var OM_DIST_SHEET_GID  = 1614333946;
var OM_DIST_NAME_CELL  = 'E1';
var OM_DIST_RECEIPT_CELL = 'B1';
var OM_XLSX_FOLDER_ID  = '1lq8Xb_dVwz5skrXlGvrS5epTwEc_yEts';

// ═══════════════════════════════════════════
// 1. 依頼展開（全自動: 展開→XLSX生成→確認リンク更新→売却反映→回収完了削除）
// ═══════════════════════════════════════════

function expandOrder() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('依頼展開', '受付番号を入力してください（複数の場合は「、」区切り）:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) { ui.alert('受付番号が空です。'); return; }

  var receiptNos = input.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (receiptNos.length === 0) { ui.alert('有効な受付番号がありません。'); return; }

  om_executeFullPipeline_(receiptNos, '依頼展開');
}

// ═══════════════════════════════════════════
// 2. 欠品処理（返品ステータス変更→選択リスト更新→確認リンク削除→自動再生成）
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

  // --- 商品管理から欠品商品の受付番号（BO列）を特定 ---
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mHeaderRow = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
  var mColMap = {};
  mHeaderRow.forEach(function(name, i) { if (name) mColMap[String(name).trim()] = i + 1; });

  var mStatusCol = mColMap['ステータス'];
  var mIdCol = mColMap['管理番号'];
  var mDiscardDateCol = mColMap['廃棄日'];
  var mBoCol = 67; // BO列 = 受付番号

  if (!mStatusCol || !mIdCol) {
    ui.alert('商品管理にステータス列または管理番号列が見つかりません。');
    return;
  }

  var mLastRow = mainSheet.getLastRow();
  if (mLastRow < 2) { ui.alert('商品管理にデータがありません。'); return; }

  var mIds = mainSheet.getRange(2, mIdCol, mLastRow - 1, 1).getValues().flat();
  var mBoVals = mainSheet.getRange(2, mBoCol, mLastRow - 1, 1).getValues().flat();
  var mIdToRow = {};
  mIds.forEach(function(id, idx) {
    var k = String(id).trim();
    if (k) mIdToRow[k] = idx + 2;
  });

  // 欠品商品の受付番号を収集
  var affectedReceiptNos = {};
  targetIds.forEach(function(tid) {
    var rowIdx = mIdToRow[tid];
    if (!rowIdx) return;
    var boVal = String(mBoVals[rowIdx - 2] || '').trim();
    if (boVal) affectedReceiptNos[boVal] = true;
  });

  var receiptNoList = Object.keys(affectedReceiptNos);
  if (receiptNoList.length === 0) {
    ui.alert('指定された管理番号に対応する受付番号が商品管理のBO列に見つかりません。');
    return;
  }

  var confirm = ui.alert('欠品処理',
    targetIds.length + '件を欠品として処理します。\n' +
    '対象受付番号: ' + receiptNoList.join('、') + '\n\n' +
    '以下を自動実行します:\n' +
    '① 欠品商品: ステータス→廃棄済み、BO列クリア\n' +
    '② 依頼管理: 選択リスト更新、確認リンク削除\n' +
    '③ 残りの商品: 売却済み→解除、BO列クリア\n' +
    '④ 自動再生成（展開→XLSX→売却反映）\n\nよろしいですか？',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  activeSs.toast('欠品処理を開始します...', '処理中', 60);

  // --- 依頼管理の選択リスト更新 + 確認リンク削除 ---
  var reqSheet = activeSs.getSheetByName('依頼管理');
  var reqLastRow = reqSheet.getLastRow();
  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData[0];
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var receiptCol = rIdx['受付番号'];
  var selectionCol = rIdx['選択リスト'];
  var countCol = rIdx['合計点数'];
  var linkCol = rIdx['確認リンク'];

  receiptNoList.forEach(function(receiptNo) {
    for (var i = 1; i < reqData.length; i++) {
      if (String(reqData[i][receiptCol] || '').trim() === receiptNo) {
        // 選択リストから欠品商品を除外
        var currentList = String(reqData[i][selectionCol] || '');
        var currentIds = currentList.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        var newIds = currentIds.filter(function(id) { return !targetSet[id]; });
        reqSheet.getRange(i + 1, selectionCol + 1).setValue(newIds.join('、'));
        if (countCol !== undefined) {
          reqSheet.getRange(i + 1, countCol + 1).setValue(newIds.length);
        }
        // 確認リンク削除
        if (linkCol !== undefined) {
          reqSheet.getRange(i + 1, linkCol + 1).setValue('');
        }
        break;
      }
    }
  });

  // --- 欠品商品: ステータス→廃棄済み、廃棄日→今日、BO列クリア ---
  var today = new Date();
  targetIds.forEach(function(tid) {
    var row = mIdToRow[tid];
    if (!row) return;
    mainSheet.getRange(row, mStatusCol).setValue('廃棄済み');
    if (mDiscardDateCol) mainSheet.getRange(row, mDiscardDateCol).setValue(today);
    mainSheet.getRange(row, mBoCol).setValue('');
  });

  // --- 同じ受付番号の残り商品: 売却済み→ステータスクリア、BO列クリア ---
  // (再生成で再度売却済みにするので、一旦元に戻す)
  receiptNoList.forEach(function(receiptNo) {
    for (var i = 0; i < mIds.length; i++) {
      var id = String(mIds[i]).trim();
      if (!id) continue;
      if (targetSet[id]) continue; // 欠品商品はスキップ（既に廃棄済み処理済み）
      var boVal = String(mBoVals[i] || '').trim();
      if (boVal === receiptNo) {
        var row = i + 2;
        mainSheet.getRange(row, mStatusCol).setValue('');
        mainSheet.getRange(row, mBoCol).setValue('');
      }
    }
  });

  // --- 売却履歴から該当受付番号のエントリを削除 ---
  receiptNoList.forEach(function(receiptNo) {
    om_removeSaleLogByReceipt_(shiireSs, receiptNo);
  });

  SpreadsheetApp.flush();

  activeSs.toast('欠品処理完了。再生成を開始します...', '処理中', 60);

  // --- 自動再生成: 残りの商品で全パイプラインを再実行 ---
  om_executeFullPipeline_(receiptNoList, '欠品処理→再生成');
}

// ═══════════════════════════════════════════
// 全自動パイプライン（展開→XLSX→売却反映）
// expandOrder と handleMissingProducts の両方から呼ばれる共通処理
// ═══════════════════════════════════════════

function om_executeFullPipeline_(receiptNos, callerLabel) {
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  activeSs.toast(callerLabel + ': 処理を開始します（' + receiptNos.length + '件）...', '処理中', 60);

  // --- 共通データ読み込み ---
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

  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);

  var returnSheet = shiireSs.getSheetByName('返送管理');
  var boxMap = om_buildBoxMap_(returnSheet);

  var recoverySheet = shiireSs.getSheetByName('回収完了');
  var exportSheet = shiireSs.getSheetByName('配布用リスト');
  if (!exportSheet) exportSheet = shiireSs.insertSheet('配布用リスト');

  // 商品管理の行マップ（売却反映用）
  var mainHeaderRow = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
  var colMap = {};
  mainHeaderRow.forEach(function(name, i) { if (name) colMap[String(name).trim()] = i + 1; });
  var statusCol = colMap['ステータス'];
  var idCol = colMap['管理番号'];
  if (!statusCol || !idCol) {
    ui.alert('商品管理にステータス列または管理番号列が見つかりません。');
    return;
  }
  var mainLastRow = mainSheet.getLastRow();
  var mainIds = mainLastRow >= 2 ? mainSheet.getRange(2, idCol, mainLastRow - 1, 1).getValues().flat() : [];
  var idToRowMap = {};
  mainIds.forEach(function(id, index) {
    var k = String(id).trim();
    if (k !== '') idToRowMap[k] = index + 2;
  });

  var results = [];
  var allSaleLogEntries = [];
  var allRecoveryRows = []; // { sheetRow, receiptNo } 回収完了から削除する行

  // --- 受付番号ごとにループ処理 ---
  for (var g = 0; g < receiptNos.length; g++) {
    var receiptNo = receiptNos[g];

    activeSs.toast(callerLabel + ': ' + receiptNo + ' を処理中（' + (g + 1) + '/' + receiptNos.length + '）...', '処理中', 60);

    // 依頼管理から該当行を検索
    var reqRow = reqData.find(function(r) { return String(r[receiptCol] || '').trim() === receiptNo; });
    if (!reqRow) {
      results.push({ receiptNo: receiptNo, ok: false, message: '依頼管理に見つかりません' });
      continue;
    }

    var selectionStr = String(reqRow[selectionCol] || '');
    var ids = selectionStr.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    if (ids.length === 0) {
      results.push({ receiptNo: receiptNo, ok: false, message: '選択リストが空です' });
      continue;
    }

    var customerName = String(reqRow[rIdx['会社名/氏名']] || '').trim();

    // --- Phase 1: 回収完了に展開 ---
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

    if (outArr.length === 0) {
      results.push({ receiptNo: receiptNo, ok: false, message: '商品管理に該当商品なし' });
      continue;
    }

    var recoveryStartRow = Math.max(recoverySheet.getLastRow() + 1, 7);
    recoverySheet.getRange(recoveryStartRow, 1, outArr.length, outArr[0].length).setValues(outArr);
    om_ensureRecoveryHeaders_(recoverySheet);

    // 削除対象として記録
    for (var ri = 0; ri < outArr.length; ri++) {
      allRecoveryRows.push(recoveryStartRow + ri);
    }

    // --- Phase 2: 配布用リスト生成 + XLSX出力 ---
    var maxRows = exportSheet.getMaxRows();
    var maxCols = exportSheet.getMaxColumns();
    if (maxRows >= 2) {
      exportSheet.getRange(2, 1, maxRows - 1, maxCols).clearContent();
      exportSheet.getRange(2, 1, maxRows - 1, 1).removeCheckboxes();
    }
    exportSheet.getRange('A1').setValue('受付番号');
    exportSheet.getRange('B1').setValue(receiptNo);
    exportSheet.getRange('E1').setValue(customerName);
    // I1には書き込まない

    var headerRow = ['確認', '箱ID', '管理番号(照合用)', 'ブランド', 'AIタイトル候補', 'アイテム', 'サイズ', '状態', '傷汚れ詳細', '採寸情報', '即出品用説明文（コピペ用）', '金額'];
    var exportData = [headerRow];

    outArr.forEach(function(listRow) {
      var boxId = listRow[1];
      var targetId = String(listRow[2] || '').trim();
      var aiTitle = listRow[7];
      if (!targetId) return;

      var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === targetId; });
      if (!row) return;

      var condition = row[mIdx['状態']] || '目立った傷や汚れなし';
      var damageDetail = row[mIdx['傷汚れ詳細']] || '';
      var brand = row[mIdx['ブランド']] || '';
      var size = row[mIdx['メルカリサイズ']] || '';
      var item = row[mIdx['カテゴリ2']] || '古着';
      if (!aiTitle) aiTitle = '';

      var length = row[mIdx['着丈']] || '-';
      var width = row[mIdx['身幅']] || '-';
      var shoulder = row[mIdx['肩幅']] || '-';
      var sleeve = row[mIdx['袖丈']] || '-';
      var waist = row[mIdx['ウエスト']];
      var rise = row[mIdx['股上']];
      var inseam = row[mIdx['股下']];

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
      var price = normalizeSellPrice_(om_calcPriceTier_(cost));

      // 状態による価格調整
      if (condition === '傷や汚れあり' || condition === 'やや傷や汚れあり' || condition === '全体的に状態が悪い') {
        price = normalizeSellPrice_(Math.round(price * 0.8));
      } else if (condition === '目立った傷や汚れなし' && damageDetail.trim() !== '') {
        price = normalizeSellPrice_(Math.round(price * 0.9));
      }

      var priceText = price.toLocaleString('ja-JP') + '円';

      exportData.push([false, boxId, targetId, brand, aiTitle, item, size, condition, damageDetail, measurementText, description, priceText]);
    });

    exportSheet.getRange(2, 1, exportData.length, exportData[0].length).setValues(exportData);
    if (exportData.length > 1) {
      exportSheet.getRange(3, 1, exportData.length - 1, 1).insertCheckboxes();
    }

    SpreadsheetApp.flush();

    // XLSX出力 + 確認リンク更新
    var xlsxResult = om_exportDistributionXlsx_();
    if (!xlsxResult || !xlsxResult.ok) {
      results.push({ receiptNo: receiptNo, ok: false, message: 'XLSX生成エラー: ' + (xlsxResult ? xlsxResult.message : '不明') });
      continue;
    }

    // --- Phase 3: 売却反映（商品管理ステータス→売却済み、BO列→受付番号） ---
    var statusA1s = [];
    var statusColLetter = om_colNumToLetter_(statusCol);
    var boColLetter = om_colNumToLetter_(67);

    ids.forEach(function(mgmtId) {
      var tgtRow = idToRowMap[mgmtId];
      if (!tgtRow) return;

      statusA1s.push(statusColLetter + tgtRow);
      mainSheet.getRange(boColLetter + tgtRow).setValue(receiptNo);

      // 売却履歴用
      var listRow = outArr.find(function(r) { return String(r[2] || '').trim() === mgmtId; });
      allSaleLogEntries.push({
        date: new Date(),
        managedId: mgmtId,
        receiptNo: receiptNo,
        brand: listRow ? (listRow[3] || '') : '',
        cost: listRow ? (listRow[10] || '') : ''
      });
    });

    if (statusA1s.length > 0) {
      mainSheet.getRangeList(statusA1s).setValue('売却済み');
    }

    results.push({ receiptNo: receiptNo, ok: true, fileName: xlsxResult.fileName });
  }

  // --- 後処理: 売却履歴ログ書き込み ---
  if (allSaleLogEntries.length > 0) {
    om_writeSaleLog_(shiireSs, allSaleLogEntries);
  }

  // --- 後処理: 回収完了から展開した行を削除（下から） ---
  allRecoveryRows.sort(function(a, b) { return b - a; });
  allRecoveryRows.forEach(function(r) {
    recoverySheet.deleteRow(r);
  });

  SpreadsheetApp.flush();

  // --- 結果レポート ---
  var msg = '';
  results.forEach(function(r) {
    if (r.ok) {
      msg += r.receiptNo + ': OK (' + r.fileName + ')\n';
    } else {
      msg += r.receiptNo + ': エラー - ' + r.message + '\n';
    }
  });

  if (msg) {
    ui.alert(callerLabel + ' 結果', msg, ui.ButtonSet.OK);
  } else {
    activeSs.toast('処理対象がありませんでした', '完了', 5);
  }
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
  if (!receiptNo) return { ok: false, message: '配布用リスト!B1（受付番号）が空です' };

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

function om_removeSaleLogByReceipt_(ss, receiptNo) {
  var logSheet = ss.getSheetByName('売却履歴');
  if (!logSheet) return;

  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;

  var data = logSheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var rowsToDelete = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][2] || '').trim() === receiptNo) {
      rowsToDelete.push(i + 2);
    }
  }
  rowsToDelete.sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(r) { logSheet.deleteRow(r); });
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
