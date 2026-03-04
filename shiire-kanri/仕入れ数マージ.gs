// 仕入れ数マージ.gs
/**
 * 仕入れ管理 ⇔ 仕入れ数報告の双方向同期
 *
 * 【Phase 1】仕入れ管理 → 仕入れ数報告
 *   管理者が仕入れ管理に行を追加すると、仕入れ数報告に対応行を自動作成
 *   (ID・報告者・区分コード・仕入れ日を転記、数量は空欄)
 *   同期済みマーク: 仕入れ管理 M列(処理列) = TRUE
 *
 * 【Phase 2】仕入れ数報告 → 仕入れ管理
 *   外注が仕入れ数報告に数量を入力すると、仕入れ管理のF列(商品点数)に反映
 *   マージ済みマーク: 仕入れ数報告 G列(処理済み) = TRUE
 *
 * 仕入れ数報告シート構成:
 *   A列: ID, B列: タイムスタンプ, C列: 報告者, D列: 区分コード,
 *   E列: 仕入れ日, F列: 数量, G列: 処理済み(TRUE/FALSE)
 *
 * 仕入れ管理シート構成:
 *   A列: ID, B列: 仕入れ日, C列: 区分コード, D列: 金額,
 *   E列: 送料, F列: 商品点数, G列: 納品場所, ...
 *   K列: 登録日時, L列: 割り当て管理番号, M列: 処理列(TRUE/FALSE)
 *
 * 割り当て管理番号の生成ルール:
 *   z{区分コード}{開始番号}~{終了番号}
 *   同一区分コード内で、仕入れ日→登録日時の順にソートし、商品点数を累計して連番を振る
 *   例: 区分A / 点数5→3→10 → zA1~5, zA6~8, zA9~18
 */

var SHIIRE_MERGE_CONFIG = {
  REPORT_SHEET_NAME: '仕入れ数報告',
  KANRI_SHEET_NAME: '仕入れ管理',
  // 仕入れ数報告の列番号
  RPT: { ID: 1, TIMESTAMP: 2, REPORTER: 3, CATEGORY: 4, PURCHASE_DATE: 5, QUANTITY: 6, DONE: 7 },
  // 仕入れ管理の列番号
  KNR: { ID: 1, PURCHASE_DATE: 2, CATEGORY: 3, AMOUNT: 4, SHIPPING: 5, ITEM_COUNT: 6, LOCATION: 7, UNIT_COST: 8, REG_DATE: 11, ASSIGN_NUM: 12, SYNCED: 13 }
};

// ═══════════════════════════════════════════
//  onChange トリガーから呼ばれるハンドラ
// ═══════════════════════════════════════════

function handleChange_ShiireSync(e) {
  withLock_(25000, function() {
    syncKanriToReport_();
    mergeReportToKanri_();
  });
}

// ═══════════════════════════════════════════
//  Phase 1: 仕入れ管理 → 仕入れ数報告（行の自動作成）
// ═══════════════════════════════════════════

function syncKanriToReport_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kanriSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME);
  if (!kanriSheet) return;

  var reportSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.REPORT_SHEET_NAME);
  if (!reportSheet) { console.error('仕入れ数マージ Phase1: 仕入れ数報告シートが見つかりません'); return; }

  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var rpt = SHIIRE_MERGE_CONFIG.RPT;

  var kanriLastRow = kanriSheet.getLastRow();
  if (kanriLastRow < 2) return;

  var kanriNumRows = kanriLastRow - 1;
  var kanriLastCol = Math.max(kanriSheet.getLastColumn(), knr.SYNCED);
  var kanriData = kanriSheet.getRange(2, 1, kanriNumRows, kanriLastCol).getValues();

  // 未同期の行を収集
  var pending = [];
  for (var i = 0; i < kanriData.length; i++) {
    var synced = String(kanriData[i][knr.SYNCED - 1] || '').trim().toUpperCase();
    if (synced === 'TRUE') continue;

    var id = String(kanriData[i][knr.ID - 1] || '').trim();
    if (!id) continue;

    var purchaseDate = kanriData[i][knr.PURCHASE_DATE - 1];
    var category = String(kanriData[i][knr.CATEGORY - 1] || '').trim();
    var location = String(kanriData[i][knr.LOCATION - 1] || '').trim();

    pending.push({
      kanriRowIndex: i,
      id: id,
      purchaseDate: purchaseDate,
      category: category,
      reporter: location  // 納品場所 = 報告者
    });
  }

  if (pending.length === 0) return;

  // 仕入れ数報告に既に存在するIDを取得（重複防止）
  var existingIds = new Set();
  var reportLastRow = reportSheet.getLastRow();
  if (reportLastRow >= 2) {
    var reportIds = reportSheet.getRange(2, rpt.ID, reportLastRow - 1, 1).getDisplayValues();
    for (var r = 0; r < reportIds.length; r++) {
      var rid = String(reportIds[r][0] || '').trim();
      if (rid) existingIds.add(rid);
    }
  }

  // 仕入れ数報告に行を追加
  var appendRows = [];
  var syncedKanriRows = [];

  for (var p = 0; p < pending.length; p++) {
    var item = pending[p];

    if (existingIds.has(item.id)) {
      // 既に存在 → 同期済みマークだけ付ける
      syncedKanriRows.push(item.kanriRowIndex);
      continue;
    }

    // A=ID, B=タイムスタンプ(空), C=報告者, D=区分コード, E=仕入れ日, F=数量(空), G=処理済み(空)
    appendRows.push([item.id, '', item.reporter, item.category, item.purchaseDate, '', '']);
    syncedKanriRows.push(item.kanriRowIndex);
    existingIds.add(item.id);

    console.log('仕入れ数マージ Phase1: 仕入れ数報告に行作成 - ID=' + item.id + ' 報告者=' + item.reporter + ' 区分=' + item.category);
  }

  // 仕入れ数報告に一括追加
  if (appendRows.length > 0) {
    var appendStartRow = Math.max(reportSheet.getLastRow() + 1, 2);
    reportSheet.getRange(appendStartRow, 1, appendRows.length, 7).setValues(appendRows);
  }

  // 仕入れ管理のM列に同期済みマーク
  for (var s = 0; s < syncedKanriRows.length; s++) {
    kanriSheet.getRange(syncedKanriRows[s] + 2, knr.SYNCED).setValue('TRUE');
  }

  console.log('仕入れ数マージ Phase1完了: ' + appendRows.length + '件作成 / ' + syncedKanriRows.length + '件同期済み');
}

// ═══════════════════════════════════════════
//  Phase 2: 仕入れ数報告 → 仕入れ管理（商品点数マージ）
// ═══════════════════════════════════════════

function mergeReportToKanri_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reportSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.REPORT_SHEET_NAME);
  if (!reportSheet) return;

  var kanriSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME);
  if (!kanriSheet) { console.error('仕入れ数マージ Phase2: 仕入れ管理シートが見つかりません'); return; }

  var rpt = SHIIRE_MERGE_CONFIG.RPT;
  var knr = SHIIRE_MERGE_CONFIG.KNR;

  // --- 仕入れ数報告の未処理行を収集 ---
  var reportLastRow = reportSheet.getLastRow();
  if (reportLastRow < 2) return;

  var reportData = reportSheet.getRange(2, 1, reportLastRow - 1, 7).getValues();
  var pending = [];

  for (var i = 0; i < reportData.length; i++) {
    var done = String(reportData[i][rpt.DONE - 1] || '').trim().toUpperCase();
    if (done === 'TRUE') continue;

    var id = normalizeText_(reportData[i][rpt.ID - 1]);
    var quantity = Number(reportData[i][rpt.QUANTITY - 1]) || 0;

    if (!id || quantity <= 0) continue;

    pending.push({ rowIndex: i, id: id, quantity: quantity });
  }

  if (pending.length === 0) return;

  // --- 仕入れ管理のID列・商品点数列・金額列・送料列を読み込み ---
  var kanriLastRow = kanriSheet.getLastRow();
  if (kanriLastRow < 2) return;

  var kanriNumRows = kanriLastRow - 1;
  var kanriIds = kanriSheet.getRange(2, knr.ID, kanriNumRows, 1).getDisplayValues();
  var kanriCounts = kanriSheet.getRange(2, knr.ITEM_COUNT, kanriNumRows, 1).getValues();
  var kanriAmounts = kanriSheet.getRange(2, knr.AMOUNT, kanriNumRows, 1).getValues();
  var kanriShipping = kanriSheet.getRange(2, knr.SHIPPING, kanriNumRows, 1).getValues();
  var kanriUnitCost = kanriSheet.getRange(2, knr.UNIT_COST, kanriNumRows, 1).getValues();

  // ID → 行インデックスのマップ
  var idToRow = {};
  for (var k = 0; k < kanriIds.length; k++) {
    var kid = normalizeText_(kanriIds[k][0]);
    if (kid) idToRow[kid] = k;
  }

  // --- マッチング＆マージ ---
  var mergedCount = 0;
  var countsDirty = false;
  var costDirty = false;
  var mergedReportRows = [];

  for (var p = 0; p < pending.length; p++) {
    var item = pending[p];
    var targetIdx = idToRow[item.id];

    if (targetIdx === undefined) {
      console.log('仕入れ数マージ Phase2: マッチなし - ID=' + item.id);
      continue;
    }

    // 商品点数を書き込み
    kanriCounts[targetIdx][0] = item.quantity;
    countsDirty = true;

    // 商品原価を計算: (金額 + 送料) ÷ 商品点数
    var amount = Number(kanriAmounts[targetIdx][0]) || 0;
    var shipping = Number(kanriShipping[targetIdx][0]) || 0;
    var unitCost = Math.round((amount + shipping) / item.quantity);
    kanriUnitCost[targetIdx][0] = unitCost;
    costDirty = true;

    mergedCount++;
    mergedReportRows.push(item.rowIndex);

    console.log('仕入れ数マージ Phase2: ID=' + item.id + ' 数量=' + item.quantity + ' 原価=' + unitCost + ' → 仕入れ管理' + (targetIdx + 2) + '行目');
  }

  // --- 仕入れ管理に書き戻し ---
  if (countsDirty) {
    kanriSheet.getRange(2, knr.ITEM_COUNT, kanriNumRows, 1).setValues(kanriCounts);
    // 商品点数が変わったので割り当て管理番号を再計算
    recalcAssignNumbers_(kanriSheet, knr, kanriNumRows);
  }
  if (costDirty) {
    kanriSheet.getRange(2, knr.UNIT_COST, kanriNumRows, 1).setValues(kanriUnitCost);
  }

  // --- 仕入れ数報告の処理済みフラグを立てる ---
  for (var m = 0; m < mergedReportRows.length; m++) {
    reportSheet.getRange(mergedReportRows[m] + 2, rpt.DONE).setValue('TRUE');
  }

  console.log('仕入れ数マージ Phase2完了: ' + mergedCount + '/' + pending.length + '件マージ');
}

// ═══════════════════════════════════════════
//  割り当て管理番号の再計算
//  z{区分コード}{開始番号}~{終了番号}
//  同一区分コード内で仕入れ日→登録日時順に累計
// ═══════════════════════════════════════════

function recalcAssignNumbers_(kanriSheet, knr, numRows) {
  // 必要な列を一括読み取り
  var categories = kanriSheet.getRange(2, knr.CATEGORY, numRows, 1).getValues();
  var dates = kanriSheet.getRange(2, knr.PURCHASE_DATE, numRows, 1).getValues();
  var counts = kanriSheet.getRange(2, knr.ITEM_COUNT, numRows, 1).getValues();
  var regDates = kanriSheet.getRange(2, knr.REG_DATE, numRows, 1).getValues();
  var assignNums = kanriSheet.getRange(2, knr.ASSIGN_NUM, numRows, 1).getValues();

  // 区分コードごとに行を収集
  var groups = {};
  for (var i = 0; i < numRows; i++) {
    var cat = normalizeText_(categories[i][0]);
    var count = Number(counts[i][0]) || 0;
    if (!cat || count <= 0) continue;

    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({
      idx: i,
      purchaseDate: toSortableDate_(dates[i][0]),
      regDate: toSortableDate_(regDates[i][0]),
      count: count
    });
  }

  // 区分コードごとにソートして連番を振る
  var dirty = false;
  for (var cat in groups) {
    var rows = groups[cat];
    // 仕入れ日昇順 → 登録日時昇順
    rows.sort(function(a, b) {
      if (a.purchaseDate < b.purchaseDate) return -1;
      if (a.purchaseDate > b.purchaseDate) return 1;
      if (a.regDate < b.regDate) return -1;
      if (a.regDate > b.regDate) return 1;
      return 0;
    });

    var cumulative = 0;
    for (var r = 0; r < rows.length; r++) {
      var start = cumulative + 1;
      var end = cumulative + rows[r].count;
      var newVal = 'z' + cat + start + '~' + end;

      if (String(assignNums[rows[r].idx][0] || '') !== newVal) {
        assignNums[rows[r].idx][0] = newVal;
        dirty = true;
      }
      cumulative = end;
    }
  }

  if (dirty) {
    kanriSheet.getRange(2, knr.ASSIGN_NUM, numRows, 1).setValues(assignNums);
    console.log('割り当て管理番号を再計算しました');
  }
}

// Date / 文字列 → ソート可能な文字列 "YYYY-MM-DD HH:MM:SS"
function toSortableDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  return normalizeText_(v);
}
