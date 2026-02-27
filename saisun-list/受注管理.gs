// 受注管理.gs
// ═══════════════════════════════════════════
// 受注管理.gs — 受付番号ベースの一括操作メニュー（2ステップ版）
// 依頼管理（本SS）⇔ 仕入れ管理Ver2（回収完了・商品管理等）を跨いで処理
//
// ステップ1: expandOrder()         — 依頼展開（展開→XLSX生成→売却反映 一括）
// ステップ2: handleMissingProducts() — 欠品処理（返品+再生成 一括）
// ═══════════════════════════════════════════

function getOmProp_(key, fallback) {
  try { return PropertiesService.getScriptProperties().getProperty(key) || fallback; }
  catch (e) { return fallback; }
}
var OM_SHIIRE_SS_ID = getOmProp_('OM_SHIIRE_SS_ID', '');
var OM_DIST_SHEET_GID  = 1614333946;
var OM_DIST_NAME_CELL  = 'E1';
var OM_DIST_RECEIPT_CELL = 'B1';
var OM_MERCARI_MODEL = 'gpt-4o-mini';
var OM_XLSX_FOLDER_ID  = getOmProp_('OM_XLSX_FOLDER_ID', '');

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

  // バッチ更新: 全更新をメモリ上で処理してから一括書き込み
  var updatedReqData = reqData.map(function(row) { return row.slice(); });
  receiptNoList.forEach(function(receiptNo) {
    for (var i = 1; i < updatedReqData.length; i++) {
      if (String(updatedReqData[i][receiptCol] || '').trim() === receiptNo) {
        var currentList = String(updatedReqData[i][selectionCol] || '');
        var currentIds = currentList.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        var newIds = currentIds.filter(function(id) { return !targetSet[id]; });
        updatedReqData[i][selectionCol] = newIds.join('、');
        if (countCol !== undefined) updatedReqData[i][countCol] = newIds.length;
        if (linkCol !== undefined) updatedReqData[i][linkCol] = '';
        break;
      }
    }
  });
  reqSheet.getRange(1, 1, updatedReqData.length, updatedReqData[0].length).setValues(updatedReqData);

  // --- 欠品商品: ステータス→廃棄済み、廃棄日→今日、BO列クリア ---
  // --- 同じ受付番号の残り商品: 売却済み→ステータスクリア、BO列クリア ---
  // (再生成で再度売却済みにするので、一旦元に戻す)
  var today = new Date();
  var receiptNoSet = {};
  receiptNoList.forEach(function(rn) { receiptNoSet[rn] = true; });

  var statusA1s_discard = [];
  var dateA1s_discard = [];
  var boA1s_discard = [];
  var statusA1s_clear = [];
  var boA1s_clear = [];

  var statusColLetter = om_colNumToLetter_(mStatusCol);
  var boColLetter = om_colNumToLetter_(mBoCol);
  var discardDateColLetter = mDiscardDateCol ? om_colNumToLetter_(mDiscardDateCol) : '';

  // 欠品商品
  targetIds.forEach(function(tid) {
    var row = mIdToRow[tid];
    if (!row) return;
    statusA1s_discard.push(statusColLetter + row);
    if (discardDateColLetter) dateA1s_discard.push(discardDateColLetter + row);
    boA1s_discard.push(boColLetter + row);
  });

  // 残り商品（同じ受付番号の非欠品商品）
  for (var i = 0; i < mIds.length; i++) {
    var id = String(mIds[i]).trim();
    if (!id || targetSet[id]) continue;
    var boVal = String(mBoVals[i] || '').trim();
    if (boVal && receiptNoSet[boVal]) {
      var row = i + 2;
      statusA1s_clear.push(statusColLetter + row);
      boA1s_clear.push(boColLetter + row);
    }
  }

  // バッチ更新
  if (statusA1s_discard.length > 0) mainSheet.getRangeList(statusA1s_discard).setValue('廃棄済み');
  if (dateA1s_discard.length > 0) mainSheet.getRangeList(dateA1s_discard).setValue(today);
  if (boA1s_discard.length > 0) mainSheet.getRangeList(boA1s_discard).setValue('');
  if (statusA1s_clear.length > 0) mainSheet.getRangeList(statusA1s_clear).setValue('');
  if (boA1s_clear.length > 0) mainSheet.getRangeList(boA1s_clear).setValue('');

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

    var customerName = '';
    var nameKeys = ['会社名/氏名', '会社名／氏名', '会社名', '氏名', 'お名前'];
    for (var nk = 0; nk < nameKeys.length; nk++) {
      if (rIdx[nameKeys[nk]] !== undefined) {
        customerName = String(reqRow[rIdx[nameKeys[nk]]] || '').trim();
        if (customerName) break;
      }
    }
    if (!customerName) {
      console.log('expandOrder: customerName空 receiptNo=' + receiptNo +
        ' rIdxKeys=' + JSON.stringify(Object.keys(rIdx)) +
        ' reqRow[0..5]=' + JSON.stringify(reqRow.slice(0, 6)));
    }

    // --- Phase 1: 回収完了に展開 ---
    var outArr = [];
    ids.forEach(function(mgmtId) {
      var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === mgmtId; });
      if (!row) return;

      outArr.push([
        '',
        boxMap[mgmtId] || (mIdx['箱ID'] !== undefined ? String(row[mIdx['箱ID']] || '') : ''),
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

    // --- Phase 2: 配布用リスト生成 + OpenAI API でタイトル・説明文自動生成 + XLSX出力 ---
    var maxRows = exportSheet.getMaxRows();
    var maxCols = exportSheet.getMaxColumns();
    // データ行のみクリア（Row 1固定ラベル・Row 2ヘッダーは触らない）
    if (maxRows >= 3) {
      exportSheet.getRange(3, 1, maxRows - 2, maxCols).clearContent();
      exportSheet.getRange(3, 1, maxRows - 2, 1).removeCheckboxes();
    }
    // Row 1: 値セルのみ書き込み（A1,D1,G1,H1 は固定ラベルなので触らない）
    exportSheet.getRange('B1').setValue(receiptNo);
    exportSheet.getRange('E1').setValue(customerName);

    var exportData = [];
    var totalPrice = 0;

    // 各商品のデータを収集
    var productRows = [];
    outArr.forEach(function(listRow) {
      var boxId = listRow[1];
      var targetId = String(listRow[2] || '').trim();
      var aiKeywords = listRow[7];
      if (!targetId) return;

      var row = mData.find(function(r) { return String(r[mIdx['管理番号']] || '').trim() === targetId; });
      if (!row) return;

      // 箱IDフォールバック: 返送管理→商品管理
      if (!boxId && mIdx['箱ID'] !== undefined) {
        boxId = String(row[mIdx['箱ID']] || '');
      }
      // 箱ID: 2つ目のハイフン以降（名前部分）を除外
      boxId = String(boxId || '');
      var boxParts = boxId.split('-');
      if (boxParts.length > 2) boxId = boxParts[0] + '-' + boxParts[1];

      var condition = row[mIdx['状態']] || '目立った傷や汚れなし';
      var damageDetail = row[mIdx['傷汚れ詳細']] || '';
      var brand = row[mIdx['ブランド']] || '';
      var size = row[mIdx['メルカリサイズ']] || '';
      var item = row[mIdx['カテゴリ2']] || '古着';
      var cat3 = String(row[mIdx['カテゴリ3']] || '').trim();
      if (!aiKeywords) aiKeywords = '';

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

      var cost = toNumber_(listRow[10]) || 0;
      var price = normalizeSellPrice_(om_calcPriceTier_(cost));

      // 状態による価格調整
      if (condition === '傷や汚れあり' || condition === 'やや傷や汚れあり' || condition === '全体的に状態が悪い') {
        price = Math.round(price * 0.8);
      } else if (condition === '目立った傷や汚れなし' && damageDetail.trim() !== '') {
        price = Math.round(price * 0.9);
      }

      var priceText = price.toLocaleString('ja-JP') + '円';
      totalPrice += price;

      var color = String(row[mIdx['カラー']] || '').trim();

      productRows.push({
        boxId: boxId, targetId: targetId, brand: brand, aiKeywords: aiKeywords,
        item: item, cat3: cat3, size: size, condition: condition, damageDetail: damageDetail,
        measurementText: measurementText, priceText: priceText, color: color
      });
    });

    // タイトル: GASロジック組み立て / 説明文: OpenAI API生成
    var aiResults = om_generateMercariTexts_(productRows);

    for (var pi = 0; pi < productRows.length; pi++) {
      var pr = productRows[pi];
      var ai = aiResults[pi] || {};
      exportData.push([
        false,
        ai.title || '',
        ai.description || '',
        pr.boxId,
        pr.targetId,
        pr.brand,
        pr.aiKeywords,
        pr.item,
        pr.size,
        pr.condition,
        pr.damageDetail,
        pr.measurementText,
        pr.priceText
      ]);
    }

    if (exportData.length > 0) {
      exportSheet.getRange(3, 1, exportData.length, 13).setValues(exportData);
      exportSheet.getRange(3, 1, exportData.length, 1).insertCheckboxes();
      // データ行の高さをデフォルト（21px）にリセット（Row 1-2は触らない）
      exportSheet.setRowHeightsForced(3, exportData.length, 21);
    }
    exportSheet.getRange('I1').setValue(totalPrice.toLocaleString('ja-JP') + '円');

    SpreadsheetApp.flush();

    // XLSX出力 + 確認リンク更新
    var xlsxResult = om_exportDistributionXlsx_(customerName, receiptNo);
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

  // --- 後処理: 回収完了から展開した行をバッチ削除 ---
  if (allRecoveryRows.length > 0) {
    var recLastRow = recoverySheet.getLastRow();
    if (recLastRow >= 2) {
      var recData = recoverySheet.getRange(2, 1, recLastRow - 1, recoverySheet.getLastColumn()).getValues();
      var recDelSet = {};
      allRecoveryRows.forEach(function(r) { recDelSet[r] = true; });
      var recKeep = [];
      for (var ri = 0; ri < recData.length; ri++) {
        if (!recDelSet[ri + 2]) recKeep.push(recData[ri]);
      }
      recoverySheet.getRange(2, 1, recData.length, recData[0].length).clearContent();
      if (recKeep.length > 0) {
        recoverySheet.getRange(2, 1, recKeep.length, recKeep[0].length).setValues(recKeep);
      }
    }
  }

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

function om_exportDistributionXlsx_(customerName, receiptNo) {
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);

  var rawName = String(customerName || '').trim();
  if (!rawName) return { ok: false, message: 'customerName が空です' };

  receiptNo = String(receiptNo || '').trim();
  if (!receiptNo) return { ok: false, message: 'receiptNo が空です' };

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
  var minCol = Math.min(receiptCol, nameCol);
  var maxCol = Math.max(receiptCol, nameCol);
  var allVals = sh.getRange(2, minCol, dataRows, maxCol - minCol + 1).getDisplayValues();
  var rOff = receiptCol - minCol;
  var nOff = nameCol - minCol;
  var targetReceipt = String(receiptNo || '').trim();
  var targetName = String(name || '').trim();
  var matchRows = [];
  for (var i = 0; i < dataRows; i++) {
    var r = String(allVals[i][rOff] || '').trim();
    var n = String(allVals[i][nOff] || '').trim();
    if (r === targetReceipt && n === targetName) matchRows.push(i + 2);
  }
  var found = matchRows.length > 0;
  if (found) {
    var rangeList = sh.getRangeList(matchRows.map(function(row) { return sh.getRange(row, linkCol).getA1Notation(); }));
    rangeList.setValue(url);
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
    var mgmtIdsStr = String(row[3]);
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
  // バッチ削除: 残す行だけフィルタして一括書き換え
  var keepData = data.filter(function(row) {
    return String(row[2] || '').trim() !== receiptNo;
  });
  var deletedCount = data.length - keepData.length;
  if (deletedCount > 0) {
    logSheet.getRange(2, 1, data.length, 5).clearContent();
    if (keepData.length > 0) {
      logSheet.getRange(2, 1, keepData.length, 5).setValues(keepData);
    }
  }
}

function om_calcPriceTier_(n) {
  return calcPriceTier_(n);
}

// ═══════════════════════════════════════════
// XLSX用サブ関数（shiire-kanri/xlsxダウンロード.gs 由来）
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
  var rng = sheet.getRange(1, 5, lastRow, 1);
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

// ═══════════════════════════════════════════
// メルカリ用タイトル・説明文 OpenAI API 自動生成
// ═══════════════════════════════════════════

// 状態→タイトル用ワードのマッピング
var OM_CONDITION_WORD_MAP = {
  '新品、未使用': '新品未使用',
  '未使用に近い': '未使用に近い',
  '目立った傷や汚れなし': '美品',
  'やや傷や汚れあり': '',
  '傷や汚れあり': '',
  '全体的に状態が悪い': ''
};

// 英語ブランド名→カタカナ読みマッピング（メルカリ検索流入を増やすため）
// スマホユーザーの大半はカタカナで検索する（「NIKE」より「ナイキ」）
var OM_BRAND_KATAKANA_MAP = {
  'NIKE': 'ナイキ', 'adidas': 'アディダス', 'PUMA': 'プーマ',
  'UNIQLO': 'ユニクロ', 'GU': 'ジーユー', 'ZARA': 'ザラ',
  'H&M': 'エイチアンドエム', 'GAP': 'ギャップ',
  'RALPH LAUREN': 'ラルフローレン', 'Polo Ralph Lauren': 'ポロラルフローレン',
  'GUCCI': 'グッチ', 'PRADA': 'プラダ', 'LOUIS VUITTON': 'ルイヴィトン',
  'BURBERRY': 'バーバリー', 'COACH': 'コーチ', 'FENDI': 'フェンディ',
  'HERMES': 'エルメス', 'CHANEL': 'シャネル', 'DIOR': 'ディオール',
  'BALENCIAGA': 'バレンシアガ', 'CELINE': 'セリーヌ',
  'Saint Laurent': 'サンローラン', 'VALENTINO': 'ヴァレンティノ',
  'VERSACE': 'ヴェルサーチ', 'GIVENCHY': 'ジバンシィ',
  'LOEWE': 'ロエベ', 'BOTTEGA VENETA': 'ボッテガヴェネタ',
  'Maison Margiela': 'メゾンマルジェラ', 'MARNI': 'マルニ',
  'Vivienne Westwood': 'ヴィヴィアンウエストウッド',
  'THE NORTH FACE': 'ノースフェイス', 'Patagonia': 'パタゴニア',
  'Columbia': 'コロンビア', 'ARC\'TERYX': 'アークテリクス',
  'MONCLER': 'モンクレール', 'Canada Goose': 'カナダグース',
  'BEAMS': 'ビームス', 'UNITED ARROWS': 'ユナイテッドアローズ',
  'SHIPS': 'シップス', 'JOURNAL STANDARD': 'ジャーナルスタンダード',
  'URBAN RESEARCH': 'アーバンリサーチ', 'nano・universe': 'ナノユニバース',
  'TOMORROWLAND': 'トゥモローランド', 'EDIFICE': 'エディフィス',
  'ADAM ET ROPE': 'アダムエロペ',
  'Champion': 'チャンピオン', 'Levi\'s': 'リーバイス', 'Lee': 'リー',
  'Wrangler': 'ラングラー', 'Carhartt': 'カーハート',
  'STUSSY': 'ステューシー', 'Supreme': 'シュプリーム',
  'A BATHING APE': 'アベイシングエイプ',
  'NEW BALANCE': 'ニューバランス', 'CONVERSE': 'コンバース',
  'VANS': 'バンズ', 'Dr.Martens': 'ドクターマーチン',
  'TOMMY HILFIGER': 'トミーヒルフィガー', 'Calvin Klein': 'カルバンクライン',
  'DIESEL': 'ディーゼル', 'DOLCE&GABBANA': 'ドルチェアンドガッバーナ',
  'ARMANI': 'アルマーニ', 'Paul Smith': 'ポールスミス',
  'Vivienne Westwood': 'ヴィヴィアンウエストウッド'
};

/**
 * ブランド英語名からカタカナ読みを返す（なければ空文字）
 */
function om_getBrandKatakana_(brand) {
  if (!brand) return '';
  if (OM_BRAND_KATAKANA_MAP[brand]) return OM_BRAND_KATAKANA_MAP[brand];
  var lower = brand.toLowerCase().replace(/\s+/g, '');
  for (var key in OM_BRAND_KATAKANA_MAP) {
    if (key.toLowerCase().replace(/\s+/g, '') === lower) return OM_BRAND_KATAKANA_MAP[key];
  }
  return '';
}

/**
 * ブランド名をタイトル用に整形
 * - 「不明」→ 除外
 * - 「マカフィー(MACPHEE)」→ 括弧前のカタカナ部分のみ使用
 * - 英語のみ → カタカナマップがあれば併記（短い場合）or カタカナのみ
 */
function om_formatBrandForTitle_(rawBrand) {
  var brand = String(rawBrand || '').trim();
  if (!brand || brand === '不明') return '';

  // 括弧付きブランド: 「カタカナ名(英語名)」→ カタカナ部分を抽出
  var parenMatch = brand.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (parenMatch) {
    var before = parenMatch[1].trim();
    var inside = parenMatch[2].trim();
    // カタカナ部分が先なら「カタカナ」のみ、英語が先なら「英語」のみ
    if (/^[\u30A0-\u30FF]/.test(before)) return before;
    if (/^[\u30A0-\u30FF]/.test(inside)) return inside;
    // どちらもカタカナでなければ短い方
    return before.length <= inside.length ? before : inside;
  }

  // カタカナマップで変換
  var kana = om_getBrandKatakana_(brand);
  if (kana) {
    var both = brand + ' ' + kana;
    return both.length <= 16 ? both : kana;
  }

  return brand;
}

/**
 * メルカリで売れるタイトルをGASロジックで組み立て（40文字以内）
 *
 * 実データに基づく設計:
 * - cat3（デニム/ジーンズ等）を優先、なければcat2（パンツ等）
 * - AIキーワードとアイテム名の重複を排除（「パンツ」+「ストレートパンツ」→後者のみ）
 * - カラーの「系」を除去（「ネイビー系」→「ネイビー」）
 * - ブランド「不明」除外、括弧付きブランドはカタカナ部分のみ
 * - 段階的削減: 全入り → AIキーワード削減 → アイテム名除外 → 状態除外
 */
function om_buildTitle_(pr) {
  var TITLE_MAX = 40;

  var condWord = OM_CONDITION_WORD_MAP[pr.condition] || '';
  var brandStr = om_formatBrandForTitle_(pr.brand);
  var color = String(pr.color || '').trim().replace(/系$/, '');
  var sizeStr = String(pr.size || '').trim();

  // アイテム名: cat3を優先（「デニム/ジーンズ」→「デニム ジーンズ」）
  var cat3 = String(pr.cat3 || '').trim();
  var cat2 = String(pr.item || '').trim();
  var itemName = cat3 || cat2;
  // 「デニム/ジーンズ」等のスラッシュは検索用にスペースに変換
  itemName = itemName.replace(/\//g, ' ');

  // AIキーワード: ブランド名・アイテム名と重複するものを除外
  var brandLower = String(pr.brand || '').toLowerCase();
  var brandKana = om_getBrandKatakana_(pr.brand || '');
  var brandKanaLower = brandKana.toLowerCase();
  var itemWords = itemName.toLowerCase().split(/\s+/);

  var aiWords = [];
  if (pr.aiKeywords) {
    String(pr.aiKeywords).split(/[\s　,、]+/).forEach(function(s) {
      var t = s.trim();
      if (!t) return;
      var tl = t.toLowerCase();
      // ブランド名と完全一致 → 除外
      if (tl === brandLower || tl === brandKanaLower) return;
      // アイテム名に含まれる語と完全一致 → 除外（「デニム」「ジーンズ」等）
      if (itemWords.indexOf(tl) >= 0) return;
      // アイテム名の部分文字列 → 除外（「パンツ」は「イージーパンツ」に含まれるので不要）
      var isSubOfItem = false;
      for (var wi = 0; wi < itemWords.length; wi++) {
        if (itemWords[wi].indexOf(tl) >= 0 && itemWords[wi] !== tl) { isSubOfItem = true; break; }
      }
      if (isSubOfItem) return;
      // cat3が具体的な場合、汎用カテゴリ語は冗長なので除外
      // （「スラックス」がitemNameなら「パンツ」は不要、「ロングスカート」なら「スカート」不要）
      if (cat3 && ['パンツ', 'スカート', 'トップス', 'ボトムス', 'ワンピース', 'コート', 'ジャケット', 'シャツ'].indexOf(t) >= 0) return;
      aiWords.push(t);
    });
  }

  // AIキーワードがアイテム名のより具体的な版を含む場合、アイテム名を除外
  // 例: item=「スカート」, aiWords に「ロングスカート」がある → 「スカート」不要
  var skipItem = false;
  if (itemName) {
    var itemLower = itemName.toLowerCase().replace(/\s+/g, '');
    for (var k = 0; k < aiWords.length; k++) {
      if (aiWords[k].toLowerCase().indexOf(itemLower) >= 0 && aiWords[k].toLowerCase() !== itemLower) {
        skipItem = true;
        break;
      }
    }
  }

  // タイトル組み立て
  function build(opts) {
    var segs = [];
    if (opts.cond && condWord) segs.push(condWord);
    if (brandStr) segs.push(brandStr);
    if (opts.item && itemName && !skipItem) segs.push(itemName);
    if (opts.aiWords) {
      for (var i = 0; i < opts.aiWords.length; i++) segs.push(opts.aiWords[i]);
    }
    if (opts.color && color) segs.push(color);
    if (opts.size && sizeStr) segs.push(sizeStr);
    return segs.join(' ');
  }

  // Step 1: 全入り
  var title = build({ cond: true, item: true, aiWords: aiWords, color: true, size: true });
  if (title.length <= TITLE_MAX) return title;

  // Step 2: AIキーワードを末尾から1つずつ削る
  var words = aiWords.slice();
  while (words.length > 0) {
    words.pop();
    title = build({ cond: true, item: true, aiWords: words, color: true, size: true });
    if (title.length <= TITLE_MAX) return title;
  }

  // Step 3: アイテム名を除外
  title = build({ cond: true, item: false, aiWords: [], color: true, size: true });
  if (title.length <= TITLE_MAX) return title;

  // Step 4: 状態ワードを除外
  title = build({ cond: false, item: false, aiWords: [], color: true, size: true });
  if (title.length <= TITLE_MAX) return title;

  // Step 5: 最小構成
  var segs = [];
  if (brandStr) segs.push(brandStr);
  if (sizeStr) segs.push(sizeStr);
  return segs.join(' ').substring(0, TITLE_MAX);
}

var OM_MERCARI_SYSTEM_PROMPT = 'あなたはメルカリでの古着販売に特化した、プロの出品テキストライターです。\n'
  + '商品の魅力が伝わり、購入意欲を高める説明文を作成してください。\n'
  + 'ショップのような丁寧で信頼感のあるトーンで書いてください。\n\n'
  + '【ルール】\n'
  + '- 丁寧語（です・ます調）で統一する\n'
  + '- 嘘や誇張は絶対にしない\n'
  + '- わからない情報（カラー・素材など）は無理に書かず省略する\n'
  + '- 説明文の先頭に管理番号は入れない\n\n'
  + '■ 説明文フォーマット（この構成を厳守すること）：\n\n'
  + 'ご覧いただきありがとうございます。\n\n'
  + '━━━━━━━━━━━━━━━━━━━━\n\n'
  + '■ ブランド\n{ブランド名}（読み仮名がわかれば記載）\n{ブランドの特徴を2〜3行で紹介。有名ブランドは正確に、マイナーブランドは無理に書かない}\n\n'
  + '■ アイテム\n{アイテムの正式名称・デザイン特徴}\n{AIキーワードのデザイン情報を活用して具体的に説明。2〜3行}\n\n'
  + '■ こんな方におすすめ\n・{ターゲット層やニーズに合わせた提案を3つ}\n\n'
  + '■ 着こなしのヒント\n{2〜3パターンの着こなし提案。季節感も意識する}\n\n'
  + '■ サイズ\n表記：{サイズ表記}\n【実寸（平置き・cm）】\n{採寸情報をそのまま記載}\n\n'
  + '■ 状態\n{状態ランク}\n{傷汚れ詳細があれば記載。なければ「目立つダメージはございません。」}\n\n'
  + '━━━━━━━━━━━━━━━━━━━━\n\n'
  + '・古着のため、多少の使用感はご了承ください\n'
  + '・平置き採寸のため、若干の誤差が生じる場合がございます\n'
  + '・ご不明点はお気軽にコメントください\n\n'
  + '{ハッシュタグを8〜10個。ブランド名・アイテム名・特徴・「古着」等を含め、#付きで半角スペース区切り}\n\n'
  + '■ 出力形式\n必ず以下のJSON形式のみで返答してください：\n{"description": "説明文"}';

/**
 * 商品データ配列からメルカリ用タイトル・説明文を一括生成
 * @param {Array} productRows - [{brand, aiKeywords, item, size, condition, damageDetail, measurementText, priceText}]
 * @return {Array} [{title, description}]
 */
function om_generateMercariTexts_(productRows) {
  // タイトルはGASロジックで組み立て（API不要、即時、確実に36-40文字）
  var titles = productRows.map(function(pr) { return om_buildTitle_(pr); });

  // 説明文はOpenAI APIで生成
  var descriptions = om_generateDescriptions_(productRows);

  var results = [];
  for (var i = 0; i < productRows.length; i++) {
    results.push({ title: titles[i], description: descriptions[i] });
  }
  return results;
}

/**
 * 説明文のみをOpenAI APIで一括生成
 */
function om_generateDescriptions_(productRows) {
  var apiKey = '';
  try { apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || ''; } catch (e) {}
  if (!apiKey) {
    console.log('OPENAI_API_KEY未設定: テンプレート説明文で代替');
    return productRows.map(function(pr) { return om_fallbackDescription_(pr); });
  }

  var userMsg = '以下の' + productRows.length + '件の商品データそれぞれについて、メルカリ用の商品説明文を生成してください。\n'
    + '結果は {"items": [{"description": "..."}, ...]} の形式で、入力順と同じ順序で返してください。\n\n';

  for (var i = 0; i < productRows.length; i++) {
    var pr = productRows[i];
    userMsg += '--- 商品' + (i + 1) + ' ---\n'
      + 'ブランド: ' + (pr.brand || '（なし）') + '\n'
      + 'AIキーワード（デザイン情報）: ' + (pr.aiKeywords || '（なし）') + '\n'
      + 'アイテム: ' + (pr.item || '（なし）') + '\n'
      + 'カラー: ' + (pr.color || '（なし）') + '\n'
      + 'サイズ: ' + (pr.size || '（なし）') + '\n'
      + '状態: ' + (pr.condition || '（なし）') + '\n'
      + '傷汚れ詳細: ' + (pr.damageDetail || '（なし）') + '\n'
      + '採寸情報: ' + (pr.measurementText || '（なし）') + '\n'
      + '販売価格: ' + (pr.priceText || '（なし）') + '\n\n';
  }

  try {
    var payload = {
      model: OM_MERCARI_MODEL,
      messages: [
        { role: 'system', content: OM_MERCARI_SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ],
      max_tokens: Math.min(productRows.length * 512, 16384),
      temperature: 0.4,
      response_format: { type: 'json_object' }
    };

    var resp = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('OpenAI API error: HTTP ' + code + ' ' + resp.getContentText().substring(0, 200));
      return productRows.map(function(pr) { return om_fallbackDescription_(pr); });
    }

    var body = JSON.parse(resp.getContentText());
    var content = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
    content = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    var parsed = JSON.parse(content);

    var items = parsed.items || [];
    var results = [];
    for (var j = 0; j < productRows.length; j++) {
      var item = items[j];
      if (item && item.description) {
        results.push(String(item.description).replace(/\\n/g, '\n'));
      } else {
        results.push(om_fallbackDescription_(productRows[j]));
      }
    }
    console.log('メルカリ説明文一括生成OK: ' + results.length + '件');
    return results;
  } catch (e) {
    console.error('メルカリ説明文一括生成エラー: ' + (e.message || e));
    return productRows.map(function(pr) { return om_fallbackDescription_(pr); });
  }
}

/**
 * API失敗時のフォールバック（従来のテンプレート形式）
 */
/**
 * API失敗時のフォールバック説明文（テンプレート形式）
 */
function om_fallbackDescription_(pr) {
  var brandKana = om_getBrandKatakana_(pr.brand);
  var brandDisplay = brandKana ? (pr.brand || '') + '（' + brandKana + '）' : (pr.brand || '');
  var desc = 'ご覧いただきありがとうございます。\n\n'
    + '━━━━━━━━━━━━━━━━━━━━\n\n'
    + '■ ブランド\n' + brandDisplay + '\n\n'
    + '■ アイテム\n' + (pr.item || '古着') + '\n';
  if (pr.aiKeywords) desc += pr.aiKeywords + '\n';
  if (pr.color) desc += '\n■ カラー\n' + pr.color + '\n';
  desc += '\n■ サイズ\n表記：' + (pr.size || '') + '\n【実寸（平置き・cm）】\n' + (pr.measurementText || '') + '\n\n'
    + '■ 状態\n' + (pr.condition || '') + '\n';
  if (pr.damageDetail) desc += pr.damageDetail + '\n';
  else desc += '目立つダメージはございません。\n';
  desc += '\n━━━━━━━━━━━━━━━━━━━━\n\n'
    + '・古着のため、多少の使用感はご了承ください\n'
    + '・平置き採寸のため、若干の誤差が生じる場合がございます\n'
    + '・ご不明点はお気軽にコメントください';
  return desc;
}

/**
 * テスト用: 商品管理シートから実データを読んでタイトル生成結果をログ出力
 * GASエディタから手動実行する
 */
function testBuildTitle() {
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  // ヘッダー確認: カラー関連列を探す
  var colorKeys = Object.keys(mIdx).filter(function(k) {
    return k.match(/カラー|色|Color|colour/i);
  });
  console.log('=== ヘッダー確認 ===');
  console.log('全ヘッダー: ' + Object.keys(mIdx).join(' | '));
  console.log('カラー関連列: ' + (colorKeys.length > 0 ? colorKeys.join(', ') : '❌ 見つからない'));
  console.log('ブランド列: ' + (mIdx['ブランド'] !== undefined ? '✅ col=' + mIdx['ブランド'] : '❌'));
  console.log('カテゴリ2列: ' + (mIdx['カテゴリ2'] !== undefined ? '✅ col=' + mIdx['カテゴリ2'] : '❌'));
  console.log('状態列: ' + (mIdx['状態'] !== undefined ? '✅ col=' + mIdx['状態'] : '❌'));
  console.log('メルカリサイズ列: ' + (mIdx['メルカリサイズ'] !== undefined ? '✅ col=' + mIdx['メルカリサイズ'] : '❌'));

  // AIキーワードマップ構築
  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);
  console.log('AIキーワード件数: ' + Object.keys(aiMap).length);

  // 追加列の確認
  console.log('デザイン特徴列: ' + (mIdx['デザイン特徴'] !== undefined ? '✅ col=' + mIdx['デザイン特徴'] : '❌'));
  console.log('カテゴリ3列: ' + (mIdx['カテゴリ3'] !== undefined ? '✅ col=' + mIdx['カテゴリ3'] : '❌'));
  console.log('タグ表記列: ' + (mIdx['タグ表記'] !== undefined ? '✅ col=' + mIdx['タグ表記'] : '❌'));

  // AIキーワードありの商品を20件テスト + ブランド「不明」や括弧付き等も混ぜる
  var colorColName = colorKeys.length > 0 ? colorKeys[0] : 'カラー';

  // まずAIキーワードあり商品を全データから収集（最新から）
  var aiSamples = [];
  var noAiSamples = [];
  for (var i = mData.length - 1; i >= 0; i--) {
    var row = mData[i];
    var id = String(row[mIdx['管理番号']] || '').trim();
    if (!id) continue;
    if (aiMap[id] && aiSamples.length < 15) aiSamples.push(i);
    else if (!aiMap[id] && noAiSamples.length < 5) noAiSamples.push(i);
    if (aiSamples.length >= 15 && noAiSamples.length >= 5) break;
  }
  var testIndices = aiSamples.concat(noAiSamples);

  console.log('\n=== タイトル生成テスト(AIキーワードあり15件 + なし5件) ===');
  var tested = 0;
  for (var ti = 0; ti < testIndices.length; ti++) {
    var row = mData[testIndices[ti]];
    var id = String(row[mIdx['管理番号']] || '').trim();

    var brand = String(row[mIdx['ブランド']] || '').trim();
    var item = String(row[mIdx['カテゴリ2']] || '').trim();
    var cat3 = String(row[mIdx['カテゴリ3']] || '').trim();
    var size = String(row[mIdx['メルカリサイズ']] || '').trim();
    var condition = String(row[mIdx['状態']] || '').trim();
    var color = String(row[mIdx[colorColName]] || '').trim();
    var design = String(row[mIdx['デザイン特徴']] || '').trim();
    var tagLabel = String(row[mIdx['タグ表記']] || '').trim();
    var aiKeywords = aiMap[id] || '';

    var pr = {
      brand: brand, aiKeywords: aiKeywords, item: item, cat3: cat3,
      size: size, condition: condition, color: color
    };
    var title = om_buildTitle_(pr);

    console.log('--- ' + id + ' ---');
    console.log('  brand: ' + (brand || '(空)') + ' | item: ' + (item || '(空)') + ' | cat3: ' + (cat3 || '(空)'));
    console.log('  color: ' + (color || '(空)') + ' | size: ' + (size || '(空)') + ' | cond: ' + (condition || '(空)'));
    console.log('  design: ' + (design || '(空)'));
    console.log('  tag: ' + (tagLabel || '(空)'));
    console.log('  aiKW: ' + (aiKeywords || '(空)'));
    console.log('  → タイトル(' + title.length + '文字): ' + title);
    tested++;
  }

  console.log('\n=== 統計 ===');
  console.log('AIキーワードあり: ' + aiSamples.length + '件 / なし: ' + noAiSamples.length + '件 テスト');
  console.log('テスト完了: ' + tested + '件');
}
