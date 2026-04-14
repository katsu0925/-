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

  // 商品数チェック: 大量の場合は分割実行に自動切替
  if (receiptNos.length === 1) {
    var orderSs = sh_getOrderSs_();
    var reqSh = sh_ensureRequestSheet_(orderSs);
    var lastRow = reqSh.getLastRow();
    if (lastRow >= 2) {
      var rowData = reqSh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < rowData.length; i++) {
        if (String(rowData[i][0]).trim() === receiptNos[0]) {
          var selStr = String(reqSh.getRange(i + 2, 10).getValue() || '');
          var idCount = selStr.split(/[、,，\s]+/).filter(Boolean).length;
          if (idCount > BATCH_EXPAND_AI_SIZE_) {
            var confirm = ui.alert('分割実行',
              '商品数が ' + idCount + '点あり、タイムアウトの可能性があります。\n'
              + BATCH_EXPAND_AI_SIZE_ + '点ずつ分割して自動実行しますか？\n\n'
              + '（' + Math.ceil(idCount / BATCH_EXPAND_AI_SIZE_) + 'バッチ × 約1分間隔で実行されます）',
              ui.ButtonSet.YES_NO);
            if (confirm === ui.Button.YES) {
              startBatchExpand_(receiptNos[0]);
              ui.alert('分割展開を開始しました。\n' + Math.ceil(idCount / BATCH_EXPAND_AI_SIZE_) + 'バッチで自動実行されます。\n\n進捗確認: checkBatchExpandProgress を実行');
              return;
            }
            // NOの場合は通常実行を続行（タイムアウトする可能性あり）
          }
          break;
        }
      }
    }
  }

  om_executeFullPipeline_(receiptNos, '依頼展開');
}

/**
 * 分割展開を開始（内部用）
 */
function startBatchExpand_(receiptNo) {
  // batchExpandOrder の受付番号を設定して呼び出す
  // 注: batchExpandOrder() 内の receiptNo 変数を手動で書き換える代わりに
  //     ScriptProperties に受付番号を一時保存して渡す
  var props = PropertiesService.getScriptProperties();
  props.setProperty('BATCH_EXPAND_RECEIPT_NO', receiptNo);
  console.log('分割展開開始: ' + receiptNo);
  batchExpandOrder();
}

// ═══════════════════════════════════════════
// 1b. 自動展開（I列=確認リンクが空 & J列=選択リストあり → 自動でパイプライン実行）
// ═══════════════════════════════════════════

function cronAutoExpandOrders() {
  var orderSsId = app_getOrderSpreadsheetId_();
  var ss = SpreadsheetApp.openById(orderSsId);
  var reqSheet = ss.getSheetByName('依頼管理');
  if (!reqSheet) return;

  var lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return;

  var confirmCol = REQUEST_SHEET_COLS.CONFIRM_LINK;     // I列: 9
  var selectionCol = REQUEST_SHEET_COLS.SELECTION_LIST;  // J列: 10
  var statusCol = REQUEST_SHEET_COLS.STATUS;             // V列: 22
  var receiptCol = REQUEST_SHEET_COLS.RECEIPT_NO;        // A列: 1
  var readCols = Math.max(confirmCol, selectionCol, statusCol);
  var data = reqSheet.getRange(2, 1, lastRow - 1, readCols).getValues();

  var receiptNos = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var receiptNo = String(row[receiptCol - 1] || '').trim();
    if (!receiptNo) continue;
    var selectionList = String(row[selectionCol - 1] || '').trim();
    if (!selectionList) continue;                       // J列が空 → 未紐付け
    var confirmLink = String(row[confirmCol - 1] || '').trim();
    if (confirmLink) continue;                          // I列にリンクあり → 処理済み
    var status = String(row[statusCol - 1] || '').trim();
    if (status === '完了' || status === 'キャンセル') continue;
    receiptNos.push(receiptNo);
  }

  if (receiptNos.length === 0) return;

  // タイムアウト防止: 1回のcronで最大3件まで処理（残りは次回cronで）
  var MAX_PER_CRON = 3;
  if (receiptNos.length > MAX_PER_CRON) {
    console.log('cronAutoExpandOrders: ' + receiptNos.length + '件中' + MAX_PER_CRON + '件を処理（残りは次回）');
    receiptNos = receiptNos.slice(0, MAX_PER_CRON);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { console.log('cronAutoExpandOrders: ロック取得失敗'); return; }
  try {
    console.log('cronAutoExpandOrders: ' + receiptNos.length + '件を自動展開: ' + receiptNos.join(', '));
    om_executeFullPipeline_(receiptNos, '自動展開', { silent: true, orderSsId: orderSsId });
  } finally {
    lock.releaseLock();
  }
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
  var mIdToAllRows = {};  // 重複行対応
  mIds.forEach(function(id, idx) {
    var k = String(id).trim();
    if (!k) return;
    if (!mIdToRow[k]) mIdToRow[k] = idx + 2;
    if (!mIdToAllRows[k]) mIdToAllRows[k] = [];
    mIdToAllRows[k].push(idx + 2);
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

  // 欠品商品（重複行対応: 全行を廃棄済みに）
  targetIds.forEach(function(tid) {
    var rows = mIdToAllRows[tid] || [];
    rows.forEach(function(row) {
      statusA1s_discard.push(statusColLetter + row);
      if (discardDateColLetter) dateA1s_discard.push(discardDateColLetter + row);
      boA1s_discard.push(boColLetter + row);
    });
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

function om_executeFullPipeline_(receiptNos, callerLabel, opts) {
  var silent = opts && opts.silent;
  var orderSsId = (opts && opts.orderSsId) || '';
  var activeSs = orderSsId ? SpreadsheetApp.openById(orderSsId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!orderSsId) orderSsId = activeSs.getId();
  var ui = null;
  if (!silent) { try { ui = SpreadsheetApp.getUi(); } catch (e) { /* cron */ } }

  if (ui) activeSs.toast(callerLabel + ': 処理を開始します（' + receiptNos.length + '件）...', '処理中', 60);
  else console.log(callerLabel + ': 処理を開始します（' + receiptNos.length + '件）');

  // --- 共通データ読み込み ---
  var reqSheet = activeSs.getSheetByName('依頼管理');
  if (!reqSheet) { if (ui) ui.alert('依頼管理シートが見つかりません。'); else console.error('依頼管理シートが見つかりません'); return; }

  var reqLastRow = reqSheet.getLastRow();
  if (reqLastRow < 2) { if (ui) ui.alert('依頼管理にデータがありません。'); else console.error('依頼管理にデータがありません'); return; }

  var reqData = reqSheet.getRange(1, 1, reqLastRow, reqSheet.getLastColumn()).getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  var receiptCol = rIdx['受付番号'];
  var selectionCol = rIdx['選択リスト'];
  if (receiptCol === undefined || selectionCol === undefined) {
    if (ui) ui.alert('依頼管理シートに「受付番号」または「選択リスト」列が見つかりません。');
    else console.error('依頼管理シートに「受付番号」または「選択リスト」列が見つかりません');
    return;
  }

  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  // 管理番号→行データのハッシュマップ（O(1)検索用）
  var mDataMap = {};
  var idColIdx = mIdx['管理番号'];
  for (var mi = 0; mi < mData.length; mi++) {
    var mk = String(mData[mi][idColIdx] || '').trim();
    if (mk) mDataMap[mk] = mData[mi];
  }

  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);

  var returnSheet = shiireSs.getSheetByName('返送管理');
  var boxMap = om_buildBoxMap_(returnSheet);

  // 返送管理から管理番号→G列日付マップを構築（在庫経過割引用フォールバック）
  var returnSetMap = {};
  if (returnSheet) {
    var rRetData = returnSheet.getDataRange().getValues();
    for (var ri = 1; ri < rRetData.length; ri++) {
      var rIdsStr = String(rRetData[ri][3] || ''); // D列: 管理番号リスト
      var rDate = rRetData[ri][6]; // G列: 日付
      if (!rIdsStr || !rDate) continue;
      var rDateVal = (rDate instanceof Date) ? rDate : new Date(rDate);
      if (isNaN(rDateVal.getTime())) continue;
      var rIds = rIdsStr.split(/[,\n\r\t\s、，／\/・|]+/);
      for (var rj = 0; rj < rIds.length; rj++) {
        var rk = String(rIds[rj]).trim();
        if (rk) returnSetMap[rk] = rDateVal;
      }
    }
  }

  // データ1から管理番号→販売価格マップを構築（在庫経過割引済みの正価格）
  var data1PriceMap = {};
  try {
    var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId || ''));
    var data1Sheet = dataSs.getSheetByName('データ1');
    if (data1Sheet) {
      var d1Last = data1Sheet.getLastRow();
      if (d1Last >= 3) {
        var d1Keys = data1Sheet.getRange(3, 11, d1Last - 2, 1).getValues();   // K列=管理番号
        var d1Prices = data1Sheet.getRange(3, 9, d1Last - 2, 1).getValues();  // I列=価格
        for (var di = 0; di < d1Keys.length; di++) {
          var dk = String(d1Keys[di][0] || '').trim();
          if (dk) data1PriceMap[dk] = d1Prices[di][0];
        }
      }
    }
  } catch (e) {
    console.warn('データ1価格読取失敗（仕入値から再計算にフォールバック）:', e.message || e);
  }

  var recoverySheet = shiireSs.getSheetByName('回収完了');
  var exportSheet = shiireSs.getSheetByName('配布用リスト');
  if (!exportSheet) exportSheet = shiireSs.insertSheet('配布用リスト');

  // 商品管理の行マップ（売却反映用）— mHeaders/mIdxを再利用して二重読み込みを排除
  var statusCol = mIdx['ステータス'] !== undefined ? mIdx['ステータス'] + 1 : 0;
  var idCol = idColIdx !== undefined ? idColIdx + 1 : 0;
  if (!statusCol || !idCol) {
    if (ui) ui.alert('商品管理にステータス列または管理番号列が見つかりません。');
    else console.error('商品管理にステータス列または管理番号列が見つかりません');
    return;
  }
  // 管理番号→行番号マップ（重複行対応: 全行を配列で保持）
  var idToRowMap = {};   // 互換用: 最初の行を返す
  var idToAllRows = {};  // 重複対応: 全行の配列
  for (var ir = 0; ir < mData.length; ir++) {
    var ik = String(mData[ir][idColIdx] || '').trim();
    if (!ik) continue;
    if (!idToRowMap[ik]) idToRowMap[ik] = ir + 2;
    if (!idToAllRows[ik]) idToAllRows[ik] = [];
    idToAllRows[ik].push(ir + 2);
  }

  // 依頼管理の受付番号→行データのハッシュマップ
  var reqDataMap = {};
  for (var rdi = 0; rdi < reqData.length; rdi++) {
    var rk = String(reqData[rdi][receiptCol] || '').trim();
    if (rk) reqDataMap[rk] = reqData[rdi];
  }

  var results = [];
  var allSaleLogEntries = [];
  var allRecoveryRows = []; // { sheetRow, receiptNo } 回収完了から削除する行

  // バッチ用: 売却反映を全受付番号分まとめて最後に実行
  var allStatusA1s = [];
  var allBoA1s = {};  // boA1 → receiptNo（受付番号ごとに異なる値をセット）
  var statusColLetter = om_colNumToLetter_(statusCol);
  var boColLetter = om_colNumToLetter_(67);

  // XLSX用temp SSを事前に1回だけ作成（ループ内で使い回す）
  var srcSheet = om_getSheetByGid_(shiireSs, OM_DIST_SHEET_GID);
  var tmpSs = SpreadsheetApp.create('tmp_dist_' + Date.now());
  var tmpSsId = tmpSs.getId();
  var copiedSheet = srcSheet.copyTo(tmpSs);
  copiedSheet.setName(srcSheet.getName());
  om_deleteAllExceptSheet_(tmpSs, copiedSheet.getSheetId());

  // --- 受付番号ごとにループ処理 ---
  for (var g = 0; g < receiptNos.length; g++) {
    var receiptNo = receiptNos[g];

    if (ui) activeSs.toast(callerLabel + ': ' + receiptNo + ' を処理中（' + (g + 1) + '/' + receiptNos.length + '）...', '処理中', 60);
    else console.log(callerLabel + ': ' + receiptNo + ' を処理中（' + (g + 1) + '/' + receiptNos.length + '）');

    // 依頼管理から該当行を検索
    var reqRow = reqDataMap[receiptNo];
    if (!reqRow) {
      results.push({ receiptNo: receiptNo, ok: false, message: '依頼管理に見つかりません' });
      continue;
    }

    // AI列: 注文時価格JSON（新形式 {assort:{},detauri:{}} と旧形式 {id:price} の両対応）
    var orderPriceMap = {};
    try {
      var priceJson = String(reqRow[REQUEST_SHEET_COLS.ITEM_PRICES - 1] || '');
      if (priceJson) {
        var parsed = JSON.parse(priceJson);
        if (parsed && (parsed.assort !== undefined || parsed.detauri !== undefined)) {
          var aMap = parsed.assort || {};
          var dMap = parsed.detauri || {};
          for (var ak in aMap) orderPriceMap[ak] = aMap[ak];
          for (var dk in dMap) orderPriceMap[dk] = dMap[dk];
        } else if (parsed) {
          orderPriceMap = parsed;
        }
      }
    } catch (e) { /* AI列が空または不正な場合はフォールバック */ }

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
      var row = mDataMap[mgmtId];
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

      var row = mDataMap[targetId];
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

      var MEASURE_FIELDS = [
        '着丈', '肩幅', '身幅', '袖丈', '裄丈', '総丈',
        'ウエスト', '股上', '股下', 'ワタリ', '裾幅', 'ヒップ'
      ];
      var measureParts = [];
      MEASURE_FIELDS.forEach(function(name) {
        var val = mIdx[name] !== undefined ? row[mIdx[name]] : undefined;
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          measureParts.push(name + ': ' + val);
        }
      });
      var measurementText = measureParts.join(' / ');

      // 注文時価格（AI列）→ データ1価格 → 仕入値再計算の優先順で取得
      var price;
      var orderPrice = orderPriceMap[targetId];
      if (typeof orderPrice === 'number' && isFinite(orderPrice) && orderPrice > 0) {
        price = orderPrice;
      } else if (typeof (data1PriceMap[targetId]) === 'number' && isFinite(data1PriceMap[targetId]) && data1PriceMap[targetId] > 0) {
        price = data1PriceMap[targetId];
      } else {
        var cost = toNumber_(listRow[10]) || 0;
        price = normalizeSellPrice_(om_calcPriceTier_(cost));
        if (condition === '傷や汚れあり' || condition === 'やや傷や汚れあり' || condition === '全体的に状態が悪い') {
          price = Math.round(price * 0.8);
        } else if (condition === '目立った傷や汚れなし' && damageDetail.trim() !== '') {
          price = Math.round(price * 0.9);
        }
        // 在庫経過割引（syncFull_と同じロジック）
        var returnDate = returnSetMap[targetId];
        price = applyAgingDiscount_(price, returnDate);
        console.log('XLSX価格フォールバック: ' + targetId + ' 仕入値=' + cost + ' → ' + price + '円 (経過割引適用)');
      }

      var priceText = price.toLocaleString('ja-JP') + '円';
      totalPrice += price;

      var color = String(row[mIdx['カラー']] || '').trim();

      var gender = row[mIdx['性別']] || '';
      productRows.push({
        boxId: boxId, targetId: targetId, brand: brand, aiKeywords: aiKeywords,
        item: item, cat3: cat3, size: size, condition: condition, damageDetail: damageDetail,
        measurementText: measurementText, priceText: priceText, color: color, gender: gender
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
        pr.priceText,
        pr.gender
      ]);
    }

    if (exportData.length > 0) {
      exportSheet.getRange(3, 1, exportData.length, 14).setValues(exportData);
      exportSheet.getRange(3, 1, exportData.length, 1).insertCheckboxes();
      // データ行の高さをデフォルト（21px）にリセット（Row 1-2は触らない）
      exportSheet.setRowHeightsForced(3, exportData.length, 21);
    }
    exportSheet.getRange('I1').setValue(totalPrice.toLocaleString('ja-JP') + '円');

    // flush不要: XLSX生成前にexportSheetに書き込み済み

    // XLSX出力 + 確認リンク更新（事前作成のtemp SSを使い回す）
    var xlsxResult = om_exportDistributionXlsx_fast_(customerName, receiptNo, orderSsId, exportSheet, tmpSsId, copiedSheet);
    if (!xlsxResult || !xlsxResult.ok) {
      results.push({ receiptNo: receiptNo, ok: false, message: 'XLSX生成エラー: ' + (xlsxResult ? xlsxResult.message : '不明') });
      continue;
    }

    // --- Phase 3: 売却反映データを蓄積（バッチ実行はループ後） ---
    // outArr の管理番号→行マップ（O(1)検索用）
    var outArrMap = {};
    for (var oi = 0; oi < outArr.length; oi++) {
      var oKey = String(outArr[oi][2] || '').trim();
      if (oKey) outArrMap[oKey] = outArr[oi];
    }

    ids.forEach(function(mgmtId) {
      var allRows = idToAllRows[mgmtId] || [];
      if (allRows.length === 0) return;

      for (var ri = 0; ri < allRows.length; ri++) {
        allStatusA1s.push(statusColLetter + allRows[ri]);
        allBoA1s[boColLetter + allRows[ri]] = receiptNo;
      }
      if (allRows.length > 1) {
        console.log('重複行検出: ' + mgmtId + ' → ' + allRows.length + '行を売却済みに更新');
      }

      var listRow = outArrMap[mgmtId];
      allSaleLogEntries.push({
        date: new Date(),
        managedId: mgmtId,
        receiptNo: receiptNo,
        brand: listRow ? (listRow[3] || '') : '',
        cost: listRow ? (listRow[10] || '') : ''
      });
    });

    results.push({ receiptNo: receiptNo, ok: true, fileName: xlsxResult.fileName });

    // 出品キットデータをWorkers KVに保存
    try {
      om_saveKitToWorkers_(receiptNo, customerName, reqRow[REQUEST_SHEET_COLS.DATETIME - 1], totalPrice, productRows, aiResults, reqSheet, reqDataMap);
    } catch (e) {
      console.error('キットKV保存エラー(' + receiptNo + '): ' + e.message);
    }
  }

  // --- 後処理: 売却反映バッチ実行（全受付番号分まとめて） ---
  if (allStatusA1s.length > 0) {
    mainSheet.getRangeList(allStatusA1s).setValue('売却済み');
  }
  // BO列: 受付番号ごとに値が異なるのでグループ化して実行
  var boByReceipt = {};
  Object.keys(allBoA1s).forEach(function(a1) {
    var rn = allBoA1s[a1];
    if (!boByReceipt[rn]) boByReceipt[rn] = [];
    boByReceipt[rn].push(a1);
  });
  Object.keys(boByReceipt).forEach(function(rn) {
    mainSheet.getRangeList(boByReceipt[rn]).setValue(rn);
  });

  // 売却反映後、商品管理キャッシュを無効化（1回だけ）
  clearProductCache_();

  // temp SS削除
  try { DriveApp.getFileById(tmpSsId).setTrashed(true); } catch (e) {}

  // --- 後処理: 売却履歴ログ書き込み ---
  if (allSaleLogEntries.length > 0) {
    om_writeSaleLog_(shiireSs, allSaleLogEntries);
  }

  // --- 後処理: 回収完了から展開した行をバッチ削除 ---
  if (allRecoveryRows.length > 0) {
    SpreadsheetApp.flush(); // 書き込みを確定してからgetLastRowを呼ぶ
    var recLastRow = recoverySheet.getLastRow();
    console.log('回収完了削除: allRecoveryRows=' + JSON.stringify(allRecoveryRows) + ' recLastRow=' + recLastRow);
    if (recLastRow >= 7) {
      // 行7以降のデータ行のみ対象（行1-6はヘッダー領域）
      var recLastCol = recoverySheet.getLastColumn();
      if (recLastCol > 0) {
        var recData = recoverySheet.getRange(7, 1, recLastRow - 6, recLastCol).getValues();
        var recDelSet = {};
        allRecoveryRows.forEach(function(r) { recDelSet[r] = true; });
        var recKeep = [];
        for (var ri = 0; ri < recData.length; ri++) {
          var sheetRow = ri + 7; // 実際のシート行番号
          if (!recDelSet[sheetRow]) recKeep.push(recData[ri]);
        }
        console.log('回収完了削除: データ行数=' + recData.length + ' 削除対象=' + allRecoveryRows.length + ' 残す行数=' + recKeep.length);
        // 行7以降を全クリア
        recoverySheet.getRange(7, 1, recData.length, recLastCol).clearContent();
        if (recKeep.length > 0) {
          recoverySheet.getRange(7, 1, recKeep.length, recKeep[0].length).setValues(recKeep);
        }
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
    if (ui) ui.alert(callerLabel + ' 結果', msg, ui.ButtonSet.OK);
    else console.log(callerLabel + ' 結果:\n' + msg);
  } else {
    if (ui) activeSs.toast('処理対象がありませんでした', '完了', 5);
    else console.log('処理対象がありませんでした');
  }
}

// ═══════════════════════════════════════════
// 大量商品の依頼展開を分割実行（タイムアウト回避）
// ═══════════════════════════════════════════

/**
 * 大量商品の依頼展開を分割実行する。
 * 1回あたり BATCH_SIZE 件ずつ処理し、残りはトリガーで自動継続。
 *
 * 使い方: GASエディタで受付番号を書き換えて batchExpandOrder() を実行
 * → 自動で分割処理が開始され、完了するまでトリガーが連鎖実行される
 */
var BATCH_EXPAND_AI_SIZE_ = 20; // OpenAI 1回あたりの処理件数（スプレッドシート再読込+API呼出で6分制限に収める）

/**
 * ヘルパー: 受付番号から全スプレッドシートデータを読み込み、productRows等を構築する。
 * Phase 1 と Phase 3 の両方で呼び出すことで、大きなデータを ScriptProperties に保存せずに済む。
 *
 * @param {string} receiptNo 受付番号
 * @return {Object|null} { productRows, titles, outArr, customerName, ids, reqRow, rIdx, orderPriceMap }
 */
function buildProductRowsForReceipt_(receiptNo) {
  var orderSs = sh_getOrderSs_();
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('依頼管理が空です'); return null; }

  // 受付番号→行を検索
  var targetRow = -1;
  var reqData = reqSh.getRange(2, 1, lastRow - 1, reqSh.getLastColumn()).getValues();
  var reqHeaders = reqSh.getRange(1, 1, 1, reqSh.getLastColumn()).getValues()[0];
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });

  for (var i = 0; i < reqData.length; i++) {
    if (String(reqData[i][0]).trim() === receiptNo) { targetRow = i; break; }
  }
  if (targetRow < 0) { console.log('受付番号が見つかりません: ' + receiptNo); return null; }
  var reqRow = reqData[targetRow];

  var selectionCol = rIdx['選択リスト'];
  var selectionStr = String(reqRow[selectionCol] || '');
  var idsRaw = selectionStr.split(/[、,，\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  // 重複除去（J列に同じIDが複数入っていた場合の安全策）
  var seen = {};
  var ids = [];
  for (var di = 0; di < idsRaw.length; di++) {
    var idUp = idsRaw[di].toUpperCase();
    if (!seen[idUp]) { seen[idUp] = true; ids.push(idsRaw[di]); }
  }
  if (idsRaw.length !== ids.length) console.log('J列の重複除去: ' + idsRaw.length + '件 → ' + ids.length + '件');
  if (ids.length === 0) { console.log('選択リストが空です'); return null; }

  // 仕入れ管理読み込み
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });
  var idColIdx = mIdx['管理番号'];
  var mDataMap = {};
  for (var mi = 0; mi < mData.length; mi++) {
    var mk = String(mData[mi][idColIdx] || '').trim();
    if (mk) mDataMap[mk] = mData[mi];
  }

  var aiSheet = shiireSs.getSheetByName('AIキーワード抽出');
  var aiMap = om_buildAiMap_(aiSheet);
  var returnSheet = shiireSs.getSheetByName('返送管理');
  var boxMap = om_buildBoxMap_(returnSheet);

  // 返送管理日付マップ
  var returnSetMap = {};
  if (returnSheet) {
    var rRetData = returnSheet.getDataRange().getValues();
    for (var ri = 1; ri < rRetData.length; ri++) {
      var rIdsStr = String(rRetData[ri][3] || '');
      var rDate = rRetData[ri][6];
      if (!rIdsStr || !rDate) continue;
      var rDateVal = (rDate instanceof Date) ? rDate : new Date(rDate);
      if (isNaN(rDateVal.getTime())) continue;
      var rIds = rIdsStr.split(/[,\n\r\t\s、，／\/・|]+/);
      for (var rj = 0; rj < rIds.length; rj++) {
        var rk = String(rIds[rj]).trim();
        if (rk) returnSetMap[rk] = rDateVal;
      }
    }
  }

  // データ1価格マップ
  var data1PriceMap = {};
  try {
    var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId || ''));
    var data1Sheet = dataSs.getSheetByName('データ1');
    if (data1Sheet) {
      var d1Last = data1Sheet.getLastRow();
      if (d1Last >= 3) {
        var d1Keys = data1Sheet.getRange(3, 11, d1Last - 2, 1).getValues();
        var d1Prices = data1Sheet.getRange(3, 9, d1Last - 2, 1).getValues();
        for (var di = 0; di < d1Keys.length; di++) {
          var dk = String(d1Keys[di][0] || '').trim();
          if (dk) data1PriceMap[dk] = d1Prices[di][0];
        }
      }
    }
  } catch (e) { console.warn('データ1価格読取失敗:', e.message); }

  // 注文時価格JSON
  var orderPriceMap = {};
  try {
    var priceJson = String(reqRow[REQUEST_SHEET_COLS.ITEM_PRICES - 1] || '');
    if (priceJson) orderPriceMap = JSON.parse(priceJson);
  } catch (e) {}

  // 顧客名
  var customerName = '';
  var nameKeys = ['会社名/氏名', '会社名／氏名', '会社名', '氏名', 'お名前'];
  for (var nk = 0; nk < nameKeys.length; nk++) {
    if (rIdx[nameKeys[nk]] !== undefined) {
      customerName = String(reqRow[rIdx[nameKeys[nk]]] || '').trim();
      if (customerName) break;
    }
  }

  // 回収完了用 outArr を構築（mDataMapに存在するIDのみ、ids順を維持）
  var outArr = [];
  var resolvedIds = []; // 実際にmDataMapで見つかったIDの順序リスト
  ids.forEach(function(mgmtId) {
    var row = mDataMap[mgmtId];
    if (!row) return;
    resolvedIds.push(mgmtId);
    outArr.push([
      '', boxMap[mgmtId] || (mIdx['箱ID'] !== undefined ? String(row[mIdx['箱ID']] || '') : ''),
      mgmtId, row[mIdx['ブランド']] || '', row[mIdx['メルカリサイズ']] || '',
      row[mIdx['性別']] || '', row[mIdx['カテゴリ2']] || '', aiMap[mgmtId] || '',
      row[mIdx['出品日']] || '', row[mIdx['使用アカウント']] || '',
      row[mIdx['仕入れ値']] || '', row[mIdx['納品場所']] || '', receiptNo
    ]);
  });

  // productRows を構築
  var productRows = [];
  outArr.forEach(function(listRow) {
    var targetId = String(listRow[2] || '').trim();
    if (!targetId) return;
    var row = mDataMap[targetId];
    if (!row) return;

    var boxId = listRow[1];
    if (!boxId && mIdx['箱ID'] !== undefined) boxId = String(row[mIdx['箱ID']] || '');
    boxId = String(boxId || '');
    var boxParts = boxId.split('-');
    if (boxParts.length > 2) boxId = boxParts[0] + '-' + boxParts[1];

    var condition = row[mIdx['状態']] || '目立った傷や汚れなし';
    var damageDetail = row[mIdx['傷汚れ詳細']] || '';
    var brand = row[mIdx['ブランド']] || '';
    var size = row[mIdx['メルカリサイズ']] || '';
    var item = row[mIdx['カテゴリ2']] || '古着';
    var cat3 = String(row[mIdx['カテゴリ3']] || '').trim();
    var aiKeywords = listRow[7] || '';
    var color = String(row[mIdx['カラー']] || '').trim();

    var MEASURE_FIELDS = ['着丈','肩幅','身幅','袖丈','裄丈','総丈','ウエスト','股上','股下','ワタリ','裾幅','ヒップ'];
    var measureParts = [];
    MEASURE_FIELDS.forEach(function(name) {
      var val = mIdx[name] !== undefined ? row[mIdx[name]] : undefined;
      if (val !== undefined && val !== null && String(val).trim() !== '') measureParts.push(name + ': ' + val);
    });
    var measurementText = measureParts.join(' / ');

    var price;
    var orderPrice = orderPriceMap[targetId];
    if (typeof orderPrice === 'number' && isFinite(orderPrice) && orderPrice > 0) {
      price = orderPrice;
    } else if (typeof (data1PriceMap[targetId]) === 'number' && isFinite(data1PriceMap[targetId]) && data1PriceMap[targetId] > 0) {
      price = data1PriceMap[targetId];
    } else {
      var cost = toNumber_(listRow[10]) || 0;
      price = normalizeSellPrice_(om_calcPriceTier_(cost));
      if (condition === '傷や汚れあり' || condition === 'やや傷や汚れあり' || condition === '全体的に状態が悪い') price = Math.round(price * 0.8);
      else if (condition === '目立った傷や汚れなし' && damageDetail.trim() !== '') price = Math.round(price * 0.9);
      price = applyAgingDiscount_(price, returnSetMap[targetId]);
    }

    var gender = row[mIdx['性別']] || '';
    productRows.push({
      boxId: boxId, targetId: targetId, brand: brand, aiKeywords: aiKeywords,
      item: item, cat3: cat3, size: size, condition: condition, damageDetail: damageDetail,
      measurementText: measurementText, priceText: price.toLocaleString('ja-JP') + '円', price: price, color: color, gender: gender
    });
  });

  // タイトルはGASロジックで即座に生成（APIなし）
  var titles = productRows.map(function(pr) { return om_buildTitle_(pr); });

  return {
    productRows: productRows,
    titles: titles,
    outArr: outArr,
    customerName: customerName,
    ids: ids,
    resolvedIds: resolvedIds,
    reqRow: reqRow,
    rIdx: rIdx,
    orderPriceMap: orderPriceMap
  };
}

/**
 * 大量商品の依頼展開を分割実行する（OpenAI部分のみバッチ化）。
 *
 * Phase 1: データ読み込み + 回収完了書込み（1回、全商品）
 * Phase 2: OpenAI説明文生成（バッチ分割、トリガー連鎖）— CacheService に保存
 * Phase 3: 配布用リスト + XLSX + 売却反映（1回、全商品）— スプレッドシートから再構築
 *
 * ScriptProperties (9KB制限): メタデータのみ保存
 * CacheService (100KB/キー): OpenAI説明文をチャンク保存
 * productRows/titles: Phase 1/3 でスプレッドシートから再構築（約5秒）
 *
 * 使い方: GASエディタで受付番号を書き換えて batchExpandOrder() を実行
 */
function batchExpandOrder() {
  var receiptNo = '20260324140158-692'; // ← 手動実行時はここに受付番号を入力

  // startBatchExpand_ から呼ばれた場合は ScriptProperties から受付番号を取得
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var overrideReceipt = props.getProperty('BATCH_EXPAND_RECEIPT_NO');
  if (overrideReceipt) {
    receiptNo = overrideReceipt;
    props.deleteProperty('BATCH_EXPAND_RECEIPT_NO');
  }

  var stateKey = 'BATCH_EXPAND_STATE';
  var stateJson = props.getProperty(stateKey);

  if (stateJson) {
    // ── 継続実行: Phase 2（OpenAIバッチ）or Phase 3（最終処理） ──
    var state = JSON.parse(stateJson);
    receiptNo = state.receiptNo;

    if (state.phase === 2) {
      batchExpandPhase2_(state, props, cache, stateKey);
    } else if (state.phase === 3) {
      batchExpandPhase3_(state, props, cache, stateKey);
    }
    return;
  }

  // ── 初回実行: Phase 1（データ読み込み + 回収完了） ──
  console.log('=== 分割展開開始: ' + receiptNo + ' ===');

  var data = buildProductRowsForReceipt_(receiptNo);
  if (!data) return;

  console.log('Phase 1: ' + data.ids.length + '点のデータ読み込み + 回収完了書込み');

  // 回収完了に書込み（重複防止: 同じ受付番号の既存データを先に削除）
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var recoverySheet = shiireSs.getSheetByName('回収完了');
  var recLast = recoverySheet.getLastRow();
  if (recLast >= 7) {
    var recLastCol = recoverySheet.getLastColumn();
    if (recLastCol > 0) {
      var existingRec = recoverySheet.getRange(7, 1, recLast - 6, recLastCol).getValues();
      // 受付番号列（M列=13番目=index12）に同じ受付番号がある行を除外
      var recKeep = [];
      for (var eri = 0; eri < existingRec.length; eri++) {
        if (String(existingRec[eri][12] || '').trim() !== receiptNo) recKeep.push(existingRec[eri]);
      }
      if (recKeep.length < existingRec.length) {
        console.log('回収完了: 既存の受付番号 ' + receiptNo + ' のデータを ' + (existingRec.length - recKeep.length) + '行削除');
        recoverySheet.getRange(7, 1, existingRec.length, recLastCol).clearContent();
        if (recKeep.length > 0) recoverySheet.getRange(7, 1, recKeep.length, recKeep[0].length).setValues(recKeep);
      }
    }
  }
  var recoveryStartRow = Math.max(recoverySheet.getLastRow() + 1, 7);
  if (data.outArr.length > 0) {
    recoverySheet.getRange(recoveryStartRow, 1, data.outArr.length, data.outArr[0].length).setValues(data.outArr);
    om_ensureRecoveryHeaders_(recoverySheet);
    console.log('回収完了書込み: ' + data.outArr.length + '行 (row ' + recoveryStartRow + '〜)');
  }

  // titles を CacheService に保存（GASロジック生成なので高速、1時間TTL）
  cache.put('BATCH_TITLES', JSON.stringify(data.titles), 3600);

  // state: メタデータのみ（productRows/titles/descriptions は保存しない）
  var totalBatches = Math.ceil(data.productRows.length / BATCH_EXPAND_AI_SIZE_);
  var state = {
    phase: 2,
    receiptNo: receiptNo,
    customerName: data.customerName,
    idsCsv: data.ids.join(','),
    resolvedIdsCsv: data.resolvedIds.join(','),
    totalItems: data.productRows.length,
    recoveryStartRow: recoveryStartRow,
    recoveryCount: data.outArr.length,
    processedIndex: 0,
    batchNum: 0,
    totalBatches: totalBatches,
    startTime: Date.now()
  };

  console.log('Phase 1 完了。Phase 2 へ: OpenAI説明文 ' + data.productRows.length + '点 → ' + totalBatches + 'バッチ');
  props.setProperty(stateKey, JSON.stringify(state));

  // Phase 1でスプレッドシート読込済みなので、Phase 2は別実行にして6分制限を回避
  ScriptApp.newTrigger('batchExpandOrder').timeBased().after(10000).create();
  console.log('Phase 2 トリガー設定: 10秒後');
}

/**
 * Phase 2: OpenAI説明文をバッチ生成（CacheService にチャンク保存）
 */
function batchExpandPhase2_(state, props, cache, stateKey) {
  // スプレッドシートから productRows を再構築（バッチスライスのみ使用）
  var data = buildProductRowsForReceipt_(state.receiptNo);
  if (!data) { props.deleteProperty(stateKey); return; }

  // Phase 1のresolvedIds順にフィルタして順序を保証
  var productRows = batchFilterByResolvedIds_(data.productRows, state.resolvedIdsCsv);

  var startIdx = state.processedIndex;
  var endIdx = Math.min(startIdx + BATCH_EXPAND_AI_SIZE_, state.totalItems);
  var batch = productRows.slice(startIdx, endIdx);

  console.log('Phase 2 バッチ ' + (state.batchNum + 1) + '/' + state.totalBatches
    + ': OpenAI説明文 ' + batch.length + '点 (' + startIdx + '〜' + (endIdx - 1) + ')');

  // OpenAI APIで説明文生成
  var descriptions = om_generateDescriptions_(batch);

  // CacheService にバッチごとに保存（1時間TTL）
  cache.put('BATCH_DESC_' + state.batchNum, JSON.stringify(descriptions), 3600);

  state.processedIndex = endIdx;
  state.batchNum++;

  if (state.processedIndex >= state.totalItems) {
    // 全バッチ完了 → Phase 3へ（常にトリガー経由で6分制限を回避）
    console.log('Phase 2 完了。Phase 3 トリガー設定: 10秒後');
    state.phase = 3;
    props.setProperty(stateKey, JSON.stringify(state));
    ScriptApp.newTrigger('batchExpandOrder').timeBased().after(10000).create();
  } else {
    // 次バッチのトリガー
    props.setProperty(stateKey, JSON.stringify(state));
    ScriptApp.newTrigger('batchExpandOrder').timeBased().after(30000).create();
    console.log('次OpenAIバッチトリガー設定: 30秒後（残り '
      + (state.totalItems - state.processedIndex) + '点）');
  }
}

/**
 * Phase 3: 配布用リスト書込み + XLSX生成 + 売却反映
 */
function batchExpandPhase3_(state, props, cache, stateKey) {
  console.log('Phase 3: 配布用リスト + XLSX + 売却反映 (' + state.totalItems + '点)');

  // スプレッドシートから productRows を再構築（約5秒）
  var data = buildProductRowsForReceipt_(state.receiptNo);
  if (!data) { props.deleteProperty(stateKey); return; }

  // Phase 1のresolvedIds順にフィルタして順序を保証
  var productRows = batchFilterByResolvedIds_(data.productRows, state.resolvedIdsCsv);
  // titlesもresolvedIds順に再構築（CacheServiceからの取得はフォールバックとして残す）
  var filteredTitles = batchFilterByResolvedIds_(data.titles, state.resolvedIdsCsv, data.productRows);

  // CacheService から全説明文を収集
  var allDescriptions = [];
  for (var b = 0; b < state.totalBatches; b++) {
    var descJson = cache.get('BATCH_DESC_' + b);
    var descs = descJson ? JSON.parse(descJson) : [];
    allDescriptions = allDescriptions.concat(descs);
  }

  // titles を CacheService から取得（フォールバック: resolvedIds順に再構築した titles を使用）
  var titlesJson = cache.get('BATCH_TITLES');
  var titles = titlesJson ? JSON.parse(titlesJson) : filteredTitles;

  var receiptNo = state.receiptNo;
  var orderSsId = app_getOrderSpreadsheetId_();
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var exportSheet = shiireSs.getSheetByName('配布用リスト');
  if (!exportSheet) exportSheet = shiireSs.insertSheet('配布用リスト');

  // 配布用リストのクリア + ヘッダー書込み
  var maxRows = exportSheet.getMaxRows();
  var maxCols = exportSheet.getMaxColumns();
  if (maxRows >= 3) {
    exportSheet.getRange(3, 1, maxRows - 2, maxCols).clearContent();
    exportSheet.getRange(3, 1, maxRows - 2, 1).removeCheckboxes();
  }
  exportSheet.getRange('B1').setValue(receiptNo);
  exportSheet.getRange('E1').setValue(state.customerName);

  // exportData構築
  var exportData = [];
  var totalPrice = 0;
  for (var pi = 0; pi < productRows.length; pi++) {
    var pr = productRows[pi];
    totalPrice += pr.price;
    exportData.push([
      false,
      titles[pi] || '',
      allDescriptions[pi] || '',
      pr.boxId, pr.targetId, pr.brand, pr.aiKeywords, pr.item,
      pr.size, pr.condition, pr.damageDetail, pr.measurementText, pr.priceText,
      pr.gender
    ]);
  }

  if (exportData.length > 0) {
    exportSheet.getRange(3, 1, exportData.length, 14).setValues(exportData);
    exportSheet.getRange(3, 1, exportData.length, 1).insertCheckboxes();
    exportSheet.setRowHeightsForced(3, exportData.length, 21);
  }
  exportSheet.getRange('I1').setValue(totalPrice.toLocaleString('ja-JP') + '円');
  console.log('配布用リスト書込み完了: ' + exportData.length + '行');

  // XLSX出力
  var srcSheet = om_getSheetByGid_(shiireSs, OM_DIST_SHEET_GID);
  var tmpSs = SpreadsheetApp.create('tmp_dist_' + Date.now());
  var tmpSsId = tmpSs.getId();
  var copiedSheet = srcSheet.copyTo(tmpSs);
  copiedSheet.setName(srcSheet.getName());
  om_deleteAllExceptSheet_(tmpSs, copiedSheet.getSheetId());

  var xlsxResult = om_exportDistributionXlsx_fast_(state.customerName, receiptNo, orderSsId, exportSheet, tmpSsId, copiedSheet);
  try { DriveApp.getFileById(tmpSsId).setTrashed(true); } catch (e) {}

  if (xlsxResult && xlsxResult.ok) {
    console.log('XLSX出力完了: ' + xlsxResult.fileName);
  } else {
    console.error('XLSX出力エラー: ' + (xlsxResult ? xlsxResult.message : '不明'));
  }

  // 売却反映
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });
  var idColIdx = mIdx['管理番号'];
  var statusCol = mIdx['ステータス'] !== undefined ? mIdx['ステータス'] + 1 : 0;
  var statusColLetter = om_colNumToLetter_(statusCol);
  var boColLetter = om_colNumToLetter_(67);

  var idToAllRows = {};
  for (var ir = 0; ir < mData.length; ir++) {
    var ik = String(mData[ir][idColIdx] || '').trim();
    if (!ik) continue;
    if (!idToAllRows[ik]) idToAllRows[ik] = [];
    idToAllRows[ik].push(ir + 2);
  }

  var allStatusA1s = [];
  var allBoA1s = {};
  data.ids.forEach(function(mgmtId) {
    var allRows = idToAllRows[mgmtId] || [];
    for (var ri = 0; ri < allRows.length; ri++) {
      allStatusA1s.push(statusColLetter + allRows[ri]);
      allBoA1s[boColLetter + allRows[ri]] = receiptNo;
    }
  });

  if (allStatusA1s.length > 0) mainSheet.getRangeList(allStatusA1s).setValue('売却済み');
  var boByReceipt = {};
  Object.keys(allBoA1s).forEach(function(a1) {
    var rn = allBoA1s[a1]; if (!boByReceipt[rn]) boByReceipt[rn] = []; boByReceipt[rn].push(a1);
  });
  Object.keys(boByReceipt).forEach(function(rn) { mainSheet.getRangeList(boByReceipt[rn]).setValue(rn); });
  clearProductCache_();
  console.log('売却反映完了: ' + allStatusA1s.length + '行');

  // 回収完了から展開行を削除（受付番号ベースで確実にマッチ）
  var recoverySheet = shiireSs.getSheetByName('回収完了');
  SpreadsheetApp.flush();
  var recLastRow = recoverySheet.getLastRow();
  if (recLastRow >= 7) {
    var recLastCol = recoverySheet.getLastColumn();
    if (recLastCol > 0) {
      var recData = recoverySheet.getRange(7, 1, recLastRow - 6, recLastCol).getValues();
      var recKeep = [];
      for (var ri = 0; ri < recData.length; ri++) {
        // M列（index 12）の受付番号で判定
        if (String(recData[ri][12] || '').trim() !== receiptNo) recKeep.push(recData[ri]);
      }
      recoverySheet.getRange(7, 1, recData.length, recLastCol).clearContent();
      if (recKeep.length > 0) recoverySheet.getRange(7, 1, recKeep.length, recKeep[0].length).setValues(recKeep);
      console.log('回収完了削除: ' + (recData.length - recKeep.length) + '行（受付番号: ' + receiptNo + '）');
    }
  }

  // 売却履歴ログ
  var logEntries = productRows.map(function(pr) {
    return { date: new Date(), managedId: pr.targetId, receiptNo: receiptNo, brand: pr.brand, cost: '' };
  });
  if (logEntries.length > 0) om_writeSaleLog_(shiireSs, logEntries);

  SpreadsheetApp.flush();

  // 出品キットデータをWorkers KVに保存
  try {
    var orderSs = SpreadsheetApp.openById(orderSsId);
    var kitReqSheet = orderSs.getSheetByName('依頼管理');
    if (kitReqSheet) {
      var kitReqData = kitReqSheet.getDataRange().getValues();
      var kitHeaders = kitReqData.shift();
      var kitRIdx = {};
      kitHeaders.forEach(function(h, i) { kitRIdx[String(h || '').trim()] = i; });
      var kitReqDataMap = {};
      for (var ki = 0; ki < kitReqData.length; ki++) {
        var krn = String(kitReqData[ki][kitRIdx['受付番号']] || '').trim();
        if (krn) kitReqDataMap[krn] = kitReqData[ki];
      }
      var kitReqRow = kitReqDataMap[receiptNo];
      var kitOrderDate = kitReqRow ? kitReqRow[REQUEST_SHEET_COLS.DATETIME - 1] : '';
      var kitAiResults = titles.map(function(t, i) { return { title: t, description: allDescriptions[i] || '' }; });
      om_saveKitToWorkers_(receiptNo, state.customerName, kitOrderDate, totalPrice, productRows, kitAiResults, kitReqSheet, kitReqDataMap);
    }
  } catch (e) {
    console.error('キットKV保存エラー(分割展開 ' + receiptNo + '): ' + e.message);
  }

  // クリーンアップ: state, トリガー, キャッシュ
  props.deleteProperty(stateKey);
  cleanupBatchExpandTriggers_();
  for (var b = 0; b < state.totalBatches; b++) cache.remove('BATCH_DESC_' + b);
  cache.remove('BATCH_TITLES');

  console.log('=== 分割展開完了: ' + receiptNo + ' / ' + state.totalItems + '点 ===');

  try {
    MailApp.sendEmail({
      to: APP_CONFIG.admin.ownerEmail,
      subject: '依頼展開 分割処理完了: ' + receiptNo,
      body: '受付番号: ' + receiptNo + '\n合計点数: ' + state.totalItems + '点\n処理完了しました。',
      replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL
    });
  } catch (mailErr) {}
}

function cleanupBatchExpandTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'batchExpandOrder') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Phase 1で確定したresolvedIds順にproductRows（またはtitles）をフィルタ・並び替え。
 * Phase間でproductRowsの順序一貫性を保証する。
 * @param {Array} items - productRows配列 or titles配列
 * @param {string} resolvedIdsCsv - Phase 1で確定したID順序（カンマ区切り）
 * @param {Array} [refProductRows] - titlesフィルタ時にproductRowsを参照（targetIdの取得用）
 */
function batchFilterByResolvedIds_(items, resolvedIdsCsv, refProductRows) {
  if (!resolvedIdsCsv) return items;
  var resolvedIds = resolvedIdsCsv.split(',');

  // productRows配列の場合: targetIdでマップ化してresolvedIds順に並び替え
  if (!refProductRows) {
    var itemMap = {};
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].targetId) itemMap[items[i].targetId] = items[i];
    }
    var result = [];
    for (var j = 0; j < resolvedIds.length; j++) {
      if (itemMap[resolvedIds[j]]) result.push(itemMap[resolvedIds[j]]);
    }
    return result;
  }

  // titles配列の場合: refProductRowsのtargetIdでインデックスマッピング
  var idxMap = {};
  for (var k = 0; k < refProductRows.length; k++) {
    if (refProductRows[k] && refProductRows[k].targetId) idxMap[refProductRows[k].targetId] = k;
  }
  var result2 = [];
  for (var m = 0; m < resolvedIds.length; m++) {
    var idx = idxMap[resolvedIds[m]];
    if (idx !== undefined) result2.push(items[idx]);
  }
  return result2;
}

/**
 * 分割展開の進捗確認（GASエディタから実行）
 */
function checkBatchExpandProgress() {
  var props = PropertiesService.getScriptProperties();
  var stateJson = props.getProperty('BATCH_EXPAND_STATE');
  if (!stateJson) {
    console.log('分割展開は実行中ではありません');
    return;
  }
  var state = JSON.parse(stateJson);
  var totalItems = state.totalItems || (state.idsCsv ? state.idsCsv.split(',').length : 0);
  console.log('受付番号: ' + state.receiptNo);
  console.log('Phase: ' + state.phase);
  console.log('進捗: ' + state.processedIndex + '/' + totalItems + '点'
    + ' (バッチ ' + state.batchNum + '/' + state.totalBatches + ')');
  console.log('残り: ' + (totalItems - state.processedIndex) + '点');
}

/**
 * 分割展開を強制停止（GASエディタから実行）
 */
function cancelBatchExpand() {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var stateJson = props.getProperty('BATCH_EXPAND_STATE');
  if (stateJson) {
    try {
      var state = JSON.parse(stateJson);
      // キャッシュもクリーンアップ
      for (var b = 0; b < (state.totalBatches || 0); b++) cache.remove('BATCH_DESC_' + b);
      cache.remove('BATCH_TITLES');
    } catch (e) {}
  }
  props.deleteProperty('BATCH_EXPAND_STATE');
  props.deleteProperty('BATCH_EXPAND_RECEIPT_NO');
  cleanupBatchExpandTriggers_();
  console.log('分割展開をキャンセルしました');
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
// XLSX出力（高速版: 事前作成のtemp SSを使い回す）
// ═══════════════════════════════════════════

function om_exportDistributionXlsx_fast_(customerName, receiptNo, optOrderSsId, exportSheet, tmpSsId, copiedSheet) {
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

  // exportSheetの書き込みを確定してからデータ取得
  SpreadsheetApp.flush();
  // exportSheet（配布用リスト）のデータをtemp SSのcopiedSheetにコピー
  var srcData = exportSheet.getDataRange();
  var srcVals = srcData.getValues();
  var srcRows = srcVals.length;
  var srcCols = srcVals[0].length;

  // copiedSheetをクリアしてデータを書き込み
  var copiedMaxR = copiedSheet.getMaxRows();
  var copiedMaxC = copiedSheet.getMaxColumns();
  if (copiedMaxR > 1) copiedSheet.getRange(1, 1, copiedMaxR, copiedMaxC).clearContent();
  // 行数が足りなければ追加
  if (copiedMaxR < srcRows) copiedSheet.insertRowsAfter(copiedMaxR, srcRows - copiedMaxR);
  if (copiedMaxC < srcCols) copiedSheet.insertColumnsAfter(copiedMaxC, srcCols - copiedMaxC);
  copiedSheet.getRange(1, 1, srcRows, srcCols).setValues(srcVals);

  om_trimColumnBAfterSecondHyphen_(copiedSheet);
  om_trimToDataBoundsStrict_(copiedSheet);
  SpreadsheetApp.flush();

  var xlsxBlob = om_exportAsXlsxBlob_(tmpSsId, exportFileName);
  var outFile = folder.createFile(xlsxBlob);
  outFile.setName(exportFileName);
  outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = outFile.getUrl();

  om_updateRequestSheetLink_(rawName, receiptNo, url, optOrderSsId);

  return { ok: true, url: url, fileName: exportFileName };
}

// ═══════════════════════════════════════════
// XLSX出力（レガシー版: handleMissingProducts等から呼ばれる互換用）
// ═══════════════════════════════════════════

function om_exportDistributionXlsx_(customerName, receiptNo, optOrderSsId) {
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
  om_updateRequestSheetLink_(rawName, receiptNo, url, optOrderSsId);

  DriveApp.getFileById(tmpId).setTrashed(true);
  return { ok: true, url: url, fileName: exportFileName };
}

function om_updateRequestSheetLink_(name, receiptNo, url, optOrderSsId) {
  var ss = optOrderSsId ? SpreadsheetApp.openById(optOrderSsId) : SpreadsheetApp.getActiveSpreadsheet();
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

/**
 * テスト用: 既存受付番号からキットリンクのみ作成（XLSX作成なし・既存ファイル不変）
 * GASエディタから手動実行する
 */
/**
 * テスト用: 単一商品でキットページを作成（画像表示確認用）
 * GASエディタから手動実行する
 */
function testCreateKitSingle() {
  var managedId = 'zC86';

  // 商品管理から1商品を取得
  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });

  var row = null;
  for (var i = 0; i < mData.length; i++) {
    if (String(mData[i][mIdx['管理番号']] || '').trim() === managedId) { row = mData[i]; break; }
  }
  if (!row) { console.error('商品が見つかりません: ' + managedId); return; }

  var brand = row[mIdx['ブランド']] || '';
  var item = row[mIdx['カテゴリ2']] || '古着';
  var size = row[mIdx['メルカリサイズ']] || '';
  var color = String(row[mIdx['カラー']] || '').trim();
  var condition = row[mIdx['状態']] || '目立った傷や汚れなし';
  var damageDetail = row[mIdx['傷汚れ詳細']] || '';

  var MEASURE_FIELDS = ['着丈','肩幅','身幅','袖丈','裄丈','総丈','ウエスト','股上','股下','ワタリ','裾幅','ヒップ'];
  var measureParts = [];
  MEASURE_FIELDS.forEach(function(name) {
    var val = mIdx[name] !== undefined ? row[mIdx[name]] : undefined;
    if (val !== undefined && val !== null && String(val).trim() !== '') measureParts.push(name + ': ' + val);
  });

  var productRows = [{
    targetId: managedId, brand: brand, item: item, size: size,
    color: color, condition: condition, damageDetail: damageDetail,
    measurementText: measureParts.join(' / '), priceText: '500円'
  }];

  var aiResults = om_generateMercariTexts_(productRows);

  // KV保存（依頼管理シートには書き込まない）
  var props = PropertiesService.getScriptProperties();
  var workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
  var adminKey = props.getProperty('ADMIN_KEY');
  var token = Utilities.getUuid();

  var kitData = {
    receiptNo: 'TEST-' + managedId,
    customerName: 'テストユーザー',
    orderDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd'),
    totalPrice: 500,
    items: [{
      managedId: managedId, brand: brand, item: item, size: size,
      color: color, condition: condition,
      measurementText: measureParts.join(' / '), priceText: '500円',
      title: aiResults[0].title || '', description: aiResults[0].description || ''
    }]
  };

  var resp = UrlFetchApp.fetch(workersUrl + '/api/kit/save', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ adminKey: adminKey, receiptNo: 'TEST-' + managedId, token: token, kitData: kitData }),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() === 200) {
    var kitUrl = 'https://wholesale.nkonline-tool.com/kit?token=' + token;
    console.log('テストキット作成完了: ' + kitUrl);
  } else {
    console.error('保存失敗: HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText());
  }
}

function testCreateKitLink() {
  var receiptNo = '20260324140158-692';

  // 商品データ再構築（スプレッドシートから読み込み）
  var data = buildProductRowsForReceipt_(receiptNo);
  if (!data) { console.error('データ構築失敗: ' + receiptNo); return; }

  // タイトル+説明文をOpenAI APIで生成
  var aiResults = om_generateMercariTexts_(data.productRows);

  // 合計金額
  var totalPrice = 0;
  data.productRows.forEach(function(pr) { totalPrice += (pr.price || 0); });

  // 注文日
  var orderDate = data.reqRow[REQUEST_SHEET_COLS.DATETIME - 1] || '';

  // 依頼管理シート取得
  var orderSs = sh_getOrderSs_();
  var reqSheet = sh_ensureRequestSheet_(orderSs);
  var reqData = reqSheet.getDataRange().getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });
  var reqDataMap = {};
  for (var i = 0; i < reqData.length; i++) {
    var rn = String(reqData[i][rIdx['受付番号']] || '').trim();
    if (rn) reqDataMap[rn] = reqData[i];
  }

  // KV保存 + AJ列書込み
  om_saveKitToWorkers_(receiptNo, data.customerName, orderDate, totalPrice, data.productRows, aiResults, reqSheet, reqDataMap);

  console.log('テスト完了: ' + receiptNo);
}

/**
 * 配布用リストの既存データからキットを生成（AI生成スキップ）
 * GASエディタから手動実行
 */
function createKitFromDistList() {
  var receiptNo = '20260324140158-692'; // ← 受付番号

  var shiireSs = SpreadsheetApp.openById(OM_SHIIRE_SS_ID);
  var exportSheet = shiireSs.getSheetByName('配布用リスト');
  if (!exportSheet) { console.error('配布用リストが見つかりません'); return; }

  var customerName = exportSheet.getRange('E1').getDisplayValue();
  var receiptNoFromSheet = exportSheet.getRange('B1').getDisplayValue();
  console.log('配布用リスト: 受付番号=%s 顧客名=%s', receiptNoFromSheet, customerName);

  // 3行目以降のデータ読み込み（A:チェック B:タイトル C:説明文 D:箱ID E:管理番号 F:ブランド G:AIキーワード H:アイテム I:サイズ J:状態 K:傷汚れ詳細 L:採寸 M:価格 N:性別）
  var lastRow = exportSheet.getLastRow();
  if (lastRow < 3) { console.error('配布用リストにデータがありません'); return; }
  var rows = exportSheet.getRange(3, 1, lastRow - 2, 14).getValues();

  // 商品管理からカテゴリ3・カラーを補完
  var mainSheet = shiireSs.getSheetByName('商品管理');
  var mData = mainSheet.getDataRange().getValues();
  var mHeaders = mData.shift();
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });
  var mDataMap = {};
  var idColIdx = mIdx['管理番号'];
  for (var mi = 0; mi < mData.length; mi++) {
    var mk = String(mData[mi][idColIdx] || '').trim();
    if (mk) mDataMap[mk] = mData[mi];
  }

  var productRows = [];
  var aiResults = [];
  var totalPrice = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var title = String(r[1] || '');
    var desc = String(r[2] || '');
    var priceText = String(r[12] || '');
    var price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
    totalPrice += price;

    var targetId = String(r[4] || '').trim();
    var mRow = mDataMap[targetId];
    var cat3 = mRow && mIdx['カテゴリ3'] !== undefined ? String(mRow[mIdx['カテゴリ3']] || '') : '';
    var color = mRow && mIdx['カラー'] !== undefined ? String(mRow[mIdx['カラー']] || '') : '';

    productRows.push({
      boxId: String(r[3] || ''), targetId: targetId,
      brand: String(r[5] || ''), aiKeywords: String(r[6] || ''),
      item: String(r[7] || ''), cat3: cat3, size: String(r[8] || ''),
      condition: String(r[9] || ''), damageDetail: String(r[10] || ''),
      measurementText: String(r[11] || ''), priceText: priceText,
      price: price, color: color, gender: String(r[13] || '')
    });
    aiResults.push({ title: title, description: desc });
  }

  // 依頼管理シートから注文日取得
  var orderSs = sh_getOrderSs_();
  var reqSheet = sh_ensureRequestSheet_(orderSs);
  var reqData = reqSheet.getDataRange().getValues();
  var reqHeaders = reqData.shift();
  var rIdx = {};
  reqHeaders.forEach(function(h, i) { rIdx[String(h || '').trim()] = i; });
  var reqDataMap = {};
  var orderDate = '';
  for (var i = 0; i < reqData.length; i++) {
    var rn = String(reqData[i][rIdx['受付番号']] || '').trim();
    if (rn) reqDataMap[rn] = reqData[i];
    if (rn === receiptNo) orderDate = reqData[i][REQUEST_SHEET_COLS.DATETIME - 1] || '';
  }

  // KV保存 + AJ列書込み
  om_saveKitToWorkers_(receiptNo, customerName, orderDate, totalPrice, productRows, aiResults, reqSheet, reqDataMap);
  console.log('createKitFromDistList 完了: %s 商品数=%s', receiptNo, productRows.length);
}

/**
 * 出品キットデータをWorkers KVに保存し、依頼管理シートAJ列にURLを書き込む
 * @param {string} receiptNo - 受付番号
 * @param {string} customerName - 顧客名
 * @param {Date|string} orderDate - 注文日
 * @param {number} totalPrice - 合計金額
 * @param {Array} productRows - 商品行データ
 * @param {Array} aiResults - AI生成結果（title, description）
 * @param {Sheet} reqSheet - 依頼管理シート
 * @param {Object} reqDataMap - 受付番号→行データマップ
 */
function om_saveKitToWorkers_(receiptNo, customerName, orderDate, totalPrice, productRows, aiResults, reqSheet, reqDataMap) {
  var props = PropertiesService.getScriptProperties();
  var workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
  var adminKey = props.getProperty('ADMIN_KEY');
  if (!adminKey) {
    console.warn('om_saveKitToWorkers_: ADMIN_KEY未設定');
    return;
  }

  // UUIDv4トークン生成
  var token = Utilities.getUuid();

  // 注文日フォーマット
  var dateStr = '';
  if (orderDate instanceof Date) {
    dateStr = Utilities.formatDate(orderDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  } else if (orderDate) {
    dateStr = String(orderDate);
  }

  // items配列構築
  var items = [];
  for (var i = 0; i < productRows.length; i++) {
    var pr = productRows[i];
    var ai = aiResults[i] || {};
    items.push({
      managedId: pr.targetId || '',
      brand: pr.brand || '',
      item: pr.item || '',
      cat3: pr.cat3 || '',
      size: pr.size || '',
      color: pr.color || '',
      gender: pr.gender || '',
      condition: pr.condition || '',
      aiKeywords: pr.aiKeywords || '',
      measurementText: pr.measurementText || '',
      priceText: pr.priceText || '',
      title: ai.title || '',
      description: ai.description || ''
    });
  }

  var kitData = {
    receiptNo: receiptNo,
    customerName: customerName,
    orderDate: dateStr,
    totalPrice: totalPrice,
    items: items
  };

  var resp = UrlFetchApp.fetch(workersUrl + '/api/kit/save', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      adminKey: adminKey,
      receiptNo: receiptNo,
      token: token,
      kitData: kitData
    }),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    console.error('キットKV保存失敗: HTTP ' + code + ' ' + resp.getContentText());
    return;
  }

  // 依頼管理シート AJ列にURL書込み
  var kitUrl = 'https://wholesale.nkonline-tool.com/kit?token=' + token;
  var reqData = reqSheet.getDataRange().getValues();
  var reqHeaders = reqData[0];
  var receiptColIdx = -1;
  for (var hi = 0; hi < reqHeaders.length; hi++) {
    if (String(reqHeaders[hi] || '').trim() === '受付番号') { receiptColIdx = hi; break; }
  }
  if (receiptColIdx >= 0) {
    for (var ri = 1; ri < reqData.length; ri++) {
      if (String(reqData[ri][receiptColIdx] || '').trim() === receiptNo) {
        reqSheet.getRange(ri + 1, REQUEST_SHEET_COLS.KIT_URL).setValue(kitUrl);
        break;
      }
    }
  }

  console.log('キットKV保存完了: ' + receiptNo + ' → ' + kitUrl);
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
 * 説明文のみをOpenAI APIで一括生成（10件ずつバッチ分割）
 */
function om_generateDescriptions_(productRows) {
  var apiKey = '';
  try { apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || ''; } catch (e) {}
  if (!apiKey) {
    console.log('OPENAI_API_KEY未設定: テンプレート説明文で代替');
    return productRows.map(function(pr) { return om_fallbackDescription_(pr); });
  }

  var BATCH_SIZE = 30;  // gpt-4o-miniは高速なので大きめバッチでAPI往復回数を削減
  var allResults = [];

  for (var batchStart = 0; batchStart < productRows.length; batchStart += BATCH_SIZE) {
    var batch = productRows.slice(batchStart, batchStart + BATCH_SIZE);
    var batchResults = om_generateDescriptionsBatch_(batch, apiKey);
    allResults = allResults.concat(batchResults);
  }

  console.log('メルカリ説明文生成完了: ' + allResults.length + '件（' + Math.ceil(productRows.length / BATCH_SIZE) + 'バッチ）');
  return allResults;
}

function om_generateDescriptionsBatch_(batch, apiKey) {
  var userMsg = '以下の' + batch.length + '件の商品データそれぞれについて、メルカリ用の商品説明文を生成してください。\n'
    + '結果は {"items": [{"description": "..."}, ...]} の形式で、入力順と同じ順序で返してください。\n\n';

  for (var i = 0; i < batch.length; i++) {
    var pr = batch[i];
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
      max_completion_tokens: 16000,
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
      return batch.map(function(pr) { return om_fallbackDescription_(pr); });
    }

    var body = JSON.parse(resp.getContentText());
    var content = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
    content = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    var parsed = JSON.parse(content);

    var items = parsed.items || [];
    var results = [];
    for (var j = 0; j < batch.length; j++) {
      var item = items[j];
      if (item && item.description) {
        results.push(String(item.description).replace(/\\n/g, '\n'));
      } else {
        results.push(om_fallbackDescription_(batch[j]));
      }
    }
    return results;
  } catch (e) {
    console.error('メルカリ説明文バッチ生成エラー: ' + (e.message || e));
    return batch.map(function(pr) { return om_fallbackDescription_(pr); });
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

// ═══════════════════════════════════════════
// 重複販売チェック: 売却済み商品がデータ1に残っていないか照合
// GASエディタから手動実行
// ═══════════════════════════════════════════

/**
 * 売却済み管理番号とデータ1のK列を照合し、重複をログ出力＋メール通知
 */
function checkDuplicateSales() {
  var shiireSsId = String((APP_CONFIG.detail && APP_CONFIG.detail.spreadsheetId) || '');
  if (!shiireSsId) { console.error('DETAIL_SPREADSHEET_ID 未設定'); return; }

  var shiireSs = SpreadsheetApp.openById(shiireSsId);
  var mainSheet = shiireSs.getSheetByName(String((APP_CONFIG.detail && APP_CONFIG.detail.sheetName) || '商品管理'));
  if (!mainSheet) { console.error('商品管理シートなし'); return; }

  // 商品管理から売却済みの管理番号を収集
  var mHeaders = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
  var mIdx = {};
  mHeaders.forEach(function(h, i) { mIdx[String(h || '').trim()] = i; });
  var mIdCol = mIdx['管理番号'];
  var mStatusCol = mIdx['ステータス'];
  if (mIdCol === undefined || mStatusCol === undefined) { console.error('管理番号/ステータス列なし'); return; }

  var mData = mainSheet.getRange(2, 1, mainSheet.getLastRow() - 1, mainSheet.getLastColumn()).getValues();
  var soldSet = {};
  for (var i = 0; i < mData.length; i++) {
    var st = String(mData[i][mStatusCol] || '').trim();
    if (st === '売却済み') {
      var mid = String(mData[i][mIdCol] || '').trim();
      if (mid) soldSet[mid] = true;
    }
  }
  console.log('売却済み商品数: ' + Object.keys(soldSet).length);

  // 依頼管理の完了注文の選択リスト(J列)からも売却済みIDを収集
  var orderSs = sh_getOrderSs_();
  var reqSheet = orderSs.getSheetByName('依頼管理');
  if (reqSheet) {
    var reqData = reqSheet.getDataRange().getValues();
    for (var r = 1; r < reqData.length; r++) {
      var status = String(reqData[r][REQUEST_SHEET_COLS.STATUS - 1] || '');
      if (status !== '完了') continue;
      var selList = String(reqData[r][REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '');
      var ids = selList.split(/[,、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      for (var j = 0; j < ids.length; j++) {
        soldSet[ids[j]] = true;
      }
    }
  }
  console.log('売却済み+完了注文 合計管理番号数: ' + Object.keys(soldSet).length);

  // データ1のK列（管理番号）を読み取り
  var dataSsId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  if (!dataSsId) { console.error('DATA_SPREADSHEET_ID 未設定'); return; }
  var dataSs = SpreadsheetApp.openById(dataSsId);
  var dataSheet = dataSs.getSheetByName(APP_CONFIG.data.sheetName);
  if (!dataSheet) { console.error('データ1シートなし'); return; }

  var headerRow = Number(APP_CONFIG.data.headerRow || 2);
  var dLastRow = dataSheet.getLastRow();
  if (dLastRow <= headerRow) { console.log('データ1にデータなし'); return; }

  var dHeaders = dataSheet.getRange(headerRow, 1, 1, dataSheet.getLastColumn()).getValues()[0];
  var dKeyCol = u_findCol_(dHeaders, ['管理番号']);
  if (dKeyCol < 0) { console.error('データ1に管理番号列なし'); return; }

  var dData = dataSheet.getRange(headerRow + 1, 1, dLastRow - headerRow, dataSheet.getLastColumn()).getValues();
  var duplicates = [];
  for (var d = 0; d < dData.length; d++) {
    var dId = String(dData[d][dKeyCol] || '').trim();
    if (dId && soldSet[dId]) {
      duplicates.push(dId);
    }
  }

  console.log('=== 重複チェック結果 ===');
  console.log('データ1の商品数: ' + dData.length);
  if (duplicates.length === 0) {
    console.log('★ 重複なし — 問題ありません');
    return;
  }

  console.log('⚠ 重複検出: ' + duplicates.length + '件');
  for (var k = 0; k < duplicates.length; k++) {
    console.log('  - ' + duplicates[k]);
  }

  // 管理者にメール通知
  try {
    var email = PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL');
    if (email) {
      var body = '【緊急】売却済み商品がデータ1に残っています（重複販売リスク）\n\n' +
        '該当管理番号 (' + duplicates.length + '件):\n' +
        duplicates.map(function(id) { return '  - ' + id; }).join('\n') +
        '\n\n即座にデータ1から手動削除するか、syncListingPublicCron の実行を確認してください。';
      MailApp.sendEmail({
        to: email,
        subject: '【デタウリ緊急】重複販売リスク: 売却済み ' + duplicates.length + '件がデータ1に残存',
        body: body,
        noReply: true
      });
      console.log('管理者メール送信完了: ' + email);
    }
  } catch (e) {
    console.error('メール送信エラー: ' + (e.message || e));
  }

  return duplicates;
}
