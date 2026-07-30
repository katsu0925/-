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
 *   E列: 仕入れ日, F列: 数量, G列: 処理済み(TRUE/FALSE), H列: 内容
 *
 * 仕入れ管理シート構成:
 *   A列: ID, B列: 仕入れ日, C列: 区分コード, D列: 金額,
 *   E列: 送料, F列: 商品点数, G列: 納品場所, ...
 *   I列: 内容, K列: 登録日時, L列: 割り当て管理番号, M列: 処理列(TRUE/FALSE)
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
  RPT: { ID: 1, TIMESTAMP: 2, REPORTER: 3, CATEGORY: 4, PURCHASE_DATE: 5, QUANTITY: 6, DONE: 7, CONTENT: 8 },
  // 仕入れ管理の列番号
  KNR: { ID: 1, PURCHASE_DATE: 2, CATEGORY: 3, AMOUNT: 4, SHIPPING: 5, ITEM_COUNT: 6, LOCATION: 7, UNIT_COST: 8, CONTENT: 9, REG_DATE: 11, ASSIGN_NUM: 12, SYNCED: 13 }
};

// ═══════════════════════════════════════════
//  onChange トリガーから呼ばれるハンドラ
// ═══════════════════════════════════════════

function handleChange_ShiireSync(e) {
  withLock_(25000, function() {
    syncKanriToReport_();
    mergeReportToKanri_();
    recalcUnitCost_();
  });
}

// 同期を手動で1回走らせる（doPost の runShiireSync アクション / GASエディタから実行）
// 孤児掃除（Phase1.6）もこの経路で走る
function staff_runShiireSync() {
  handleChange_ShiireSync({});
  return { ok: true, ran: ['syncKanriToReport_', 'mergeReportToKanri_', 'recalcUnitCost_'] };
}

// ═══════════════════════════════════════════
//  原価再計算（金額・送料・商品点数の変更時）
//  H列 = Math.round((D列 + E列) / F列)
// ═══════════════════════════════════════════

function recalcUnitCost_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kanriSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME);
  if (!kanriSheet) return;

  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var lastRow = kanriSheet.getLastRow();
  if (lastRow < 2) return;

  var numRows = lastRow - 1;
  var amounts  = kanriSheet.getRange(2, knr.AMOUNT,    numRows, 1).getValues();
  var shipping = kanriSheet.getRange(2, knr.SHIPPING,  numRows, 1).getValues();
  var counts   = kanriSheet.getRange(2, knr.ITEM_COUNT, numRows, 1).getValues();
  var costs    = kanriSheet.getRange(2, knr.UNIT_COST,  numRows, 1).getValues();

  var dirty = false;
  for (var i = 0; i < numRows; i++) {
    var count = Number(counts[i][0]) || 0;
    if (count <= 0) continue;

    var amt = Number(amounts[i][0]) || 0;
    var shp = Number(shipping[i][0]) || 0;
    var expected = Math.round((amt + shp) / count);
    var current  = Number(costs[i][0]) || 0;

    if (current !== expected) {
      costs[i][0] = expected;
      dirty = true;
    }
  }

  if (dirty) {
    kanriSheet.getRange(2, knr.UNIT_COST, numRows, 1).setValues(costs);
    console.log('原価再計算: 更新しました');
  }
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

  // 全行を収集（既存行の 内容/区分/報告者/仕入れ日 編集を後段で反映するため、SYNCED でフィルタしない）
  var pending = [];
  var kanriIdSet = {};  // 孤児掃除用: 仕入れ管理に現存するIDの集合
  for (var i = 0; i < kanriData.length; i++) {
    var id = normalizeText_(kanriData[i][knr.ID - 1]);
    if (!id) continue;
    kanriIdSet[id] = true;

    var purchaseDate = kanriData[i][knr.PURCHASE_DATE - 1];
    var category = String(kanriData[i][knr.CATEGORY - 1] || '').trim();
    var location = String(kanriData[i][knr.LOCATION - 1] || '').trim();
    var content = String(kanriData[i][knr.CONTENT - 1] || '').trim();
    var itemCount = Number(kanriData[i][knr.ITEM_COUNT - 1]) || 0;

    pending.push({
      kanriRowIndex: i,
      id: id,
      purchaseDate: purchaseDate,
      category: category,
      reporter: location,  // 納品場所 = 報告者
      content: content,    // 内容（外注が商品を識別するため）
      itemCount: itemCount // 仕入れ管理側で先に入力された商品点数（逆方向同期用）
    });
  }

  if (pending.length === 0) return;

  // 仕入れ数報告に既に存在するIDと、その行/内容/区分/報告者/仕入れ日/数量/処理済み を取得
  // 内容を後から仕入れ管理に追記するケースに対応するため、差分があれば既存行も上書きする
  // 数量・処理済みは逆方向同期（仕入れ管理 → 仕入れ数報告）用
  var existingMap = {};  // id -> { rowIndex(1始まり), content, category, reporter, purchaseDate, quantity, done }
  var orphanRows = [];   // 孤児掃除候補: 仕入れ管理に存在しない かつ 数量未入力 の報告行
  var reportLastRow = reportSheet.getLastRow();
  if (reportLastRow >= 2) {
    var reportRows = reportSheet.getRange(2, 1, reportLastRow - 1, 8).getValues();
    for (var r = 0; r < reportRows.length; r++) {
      var rid = normalizeText_(reportRows[r][rpt.ID - 1]);
      if (!rid) continue;
      // 仕入れ管理から削除されたIDで、まだ数量が入っていない行 → 外注アプリに永久に残る孤児
      if (!kanriIdSet[rid] && !(Number(reportRows[r][rpt.QUANTITY - 1]) > 0)) {
        orphanRows.push({ rowIndex: r + 2, id: rid, content: String(reportRows[r][rpt.CONTENT - 1] || '') });
      }
      existingMap[rid] = {
        rowIndex: r + 2,
        content: String(reportRows[r][rpt.CONTENT - 1] || ''),
        category: String(reportRows[r][rpt.CATEGORY - 1] || ''),
        reporter: String(reportRows[r][rpt.REPORTER - 1] || ''),
        purchaseDate: reportRows[r][rpt.PURCHASE_DATE - 1],
        quantity: Number(reportRows[r][rpt.QUANTITY - 1]) || 0,
        done: String(reportRows[r][rpt.DONE - 1] || '').trim().toUpperCase() === 'TRUE'
      };
    }
  }

  // 仕入れ数報告に行を追加 / 既存行は内容差分があれば上書き
  var appendRows = [];
  var syncedKanriRows = [];
  var updatedExistingCount = 0;

  for (var p = 0; p < pending.length; p++) {
    var item = pending[p];
    var existing = existingMap[item.id];

    if (existing) {
      // 既存行: 仕入れ管理側で 内容/区分/報告者/仕入れ日 が編集された場合に追従
      var changed = false;
      if (String(existing.content) !== String(item.content)) {
        reportSheet.getRange(existing.rowIndex, rpt.CONTENT).setValue(item.content);
        changed = true;
      }
      if (String(existing.category) !== String(item.category)) {
        reportSheet.getRange(existing.rowIndex, rpt.CATEGORY).setValue(item.category);
        changed = true;
      }
      if (String(existing.reporter) !== String(item.reporter)) {
        reportSheet.getRange(existing.rowIndex, rpt.REPORTER).setValue(item.reporter);
        changed = true;
      }
      // 仕入れ日は Date 型比較のため文字列化して比較
      if (String(existing.purchaseDate) !== String(item.purchaseDate)) {
        reportSheet.getRange(existing.rowIndex, rpt.PURCHASE_DATE).setValue(item.purchaseDate);
        changed = true;
      }
      // 逆方向同期: 仕入れ管理.商品点数 が入っているのに 仕入れ数報告.数量 が空 かつ 未処理 → 数量を埋めて DONE=TRUE
      // （管理者が外注を介さず直接 商品点数 を入力したケースで pending から消すため）
      if (item.itemCount > 0 && existing.quantity <= 0 && !existing.done) {
        reportSheet.getRange(existing.rowIndex, rpt.QUANTITY).setValue(item.itemCount);
        reportSheet.getRange(existing.rowIndex, rpt.DONE).setValue('TRUE');
        // タイムスタンプが空ならシステム実行時刻を入れる（監査用）
        if (!String(reportSheet.getRange(existing.rowIndex, rpt.TIMESTAMP).getValue() || '').trim()) {
          reportSheet.getRange(existing.rowIndex, rpt.TIMESTAMP).setValue(new Date());
        }
        changed = true;
        console.log('仕入れ数マージ Phase1.5(逆同期): ID=' + item.id + ' に商品点数 ' + item.itemCount + ' を反映 → 処理済み');
      }
      if (changed) updatedExistingCount++;
      syncedKanriRows.push(item.kanriRowIndex);
      continue;
    }

    // A=ID, B=タイムスタンプ, C=報告者, D=区分コード, E=仕入れ日, F=数量, G=処理済み, H=内容
    // 仕入れ管理側に既に 商品点数 が入っている場合は数量＋処理済みも先に埋めて pending に出さない
    var preFilledQty = (item.itemCount > 0) ? item.itemCount : '';
    var preFilledDone = (item.itemCount > 0) ? 'TRUE' : '';
    var preFilledTs = (item.itemCount > 0) ? new Date() : '';
    appendRows.push([item.id, preFilledTs, item.reporter, item.category, item.purchaseDate, preFilledQty, preFilledDone, item.content]);
    syncedKanriRows.push(item.kanriRowIndex);
    existingMap[item.id] = {
      rowIndex: -1, content: item.content, category: item.category,
      reporter: item.reporter, purchaseDate: item.purchaseDate,
      quantity: item.itemCount, done: item.itemCount > 0
    };

    console.log('仕入れ数マージ Phase1: 仕入れ数報告に行作成 - ID=' + item.id + ' 報告者=' + item.reporter + ' 区分=' + item.category +
                (item.itemCount > 0 ? ' (商品点数=' + item.itemCount + ' を初期反映 / 処理済み)' : ''));
  }
  if (updatedExistingCount > 0) {
    console.log('仕入れ数マージ Phase1: 既存行を' + updatedExistingCount + '件更新（内容/区分/報告者/仕入れ日 の編集を反映）');
  }

  // 仕入れ数報告に一括追加
  if (appendRows.length > 0) {
    var appendStartRow = Math.max(reportSheet.getLastRow() + 1, 2);
    reportSheet.getRange(appendStartRow, 1, appendRows.length, 8).setValues(appendRows);
  }

  // 仕入れ管理のM列に同期済みマーク
  for (var s = 0; s < syncedKanriRows.length; s++) {
    kanriSheet.getRange(syncedKanriRows[s] + 2, knr.SYNCED).setValue('TRUE');
  }

  // Phase1.6: 孤児掃除（仕入れ管理から削除されたIDの未処理行を仕入れ数報告からも消す）
  sweepOrphanReportRows_(reportSheet, orphanRows);

  console.log('仕入れ数マージ Phase1完了: ' + appendRows.length + '件作成 / ' + syncedKanriRows.length + '件同期済み');
}

/**
 * 仕入れ数報告の孤児行を削除する
 * 孤児 = 仕入れ管理にIDが存在しない かつ 数量が未入力（未処理）の行
 * - 数量が入っている行は集計・監査の証跡なので絶対に削除しない
 * - 行番号がズレないよう下から削除する
 * - 想定外の大量削除（列ズレ・シート破損など）を防ぐため上限件数でガードし、超過時はメール通知のみ
 * @param {Sheet} reportSheet 仕入れ数報告シート
 * @param {Array} orphanRows [{ rowIndex, id, content }] （呼び出し側で収集済み）
 */
function sweepOrphanReportRows_(reportSheet, orphanRows) {
  if (!orphanRows || orphanRows.length === 0) return 0;

  var MAX_SWEEP = 20;
  if (orphanRows.length > MAX_SWEEP) {
    var msg = '仕入れ数報告の孤児行が異常に多いため自動削除を中止しました（' + orphanRows.length + '件 / 上限' + MAX_SWEEP + '件）。\n' +
              '列ズレやシート破損の可能性があります。手動で確認してください。\n' +
              '対象ID(先頭20件): ' + orphanRows.slice(0, 20).map(function(o) { return o.id; }).join(', ');
    console.error(msg);
    try { notifyAssignConflict_(msg); } catch (err) { console.error('孤児掃除の通知に失敗: ' + err); }
    return 0;
  }

  // 下から削除（上から消すと以降の行番号がズレる）
  var sorted = orphanRows.slice().sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  for (var i = 0; i < sorted.length; i++) {
    reportSheet.deleteRow(sorted[i].rowIndex);
    console.log('仕入れ数マージ Phase1.6(孤児掃除): 仕入れ数報告から削除 - ID=' + sorted[i].id +
                ' 内容=' + sorted[i].content + '（仕入れ管理に該当行なし / 数量未入力）');
  }
  console.log('仕入れ数マージ Phase1.6(孤児掃除): ' + sorted.length + '件削除');
  return sorted.length;
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

  var reportData = reportSheet.getRange(2, 1, reportLastRow - 1, 8).getValues();
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
  var kanriIds = kanriSheet.getRange(2, knr.ID, kanriNumRows, 1).getValues();
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
  var ids = kanriSheet.getRange(2, knr.ID, numRows, 1).getValues();
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
      sid: normalizeText_(ids[i][0]),
      purchaseDate: toSortableDate_(dates[i][0]),
      regDate: toSortableDate_(regDates[i][0]),
      count: count
    });
  }

  // 区分コードごとにソートして採番案を算出（この時点ではまだ書き込まない）
  var proposals = [];  // { idx, sid, cat, newVal }
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
      proposals.push({ idx: rows[r].idx, sid: rows[r].sid, cat: cat, newVal: 'z' + cat + start + '~' + end });
      cumulative = end;
    }
  }

  // 【再発防止ガード】実物ラベル(商品管理)を侵食する採番を阻止する。
  //   既に商品管理へ実物ラベルが振られている仕入れについて、
  //   「今の予約レンジ(L列)は実物ラベルを内包しているのに、今回の採番案では内包しなくなる」
  //   ケース(=過去日割り込み等で確定済みの箱がずれる回帰)を検出したら、採番を中断して管理者へ通知する。
  //   ※既に内包していない箱(別要因の恒常的なズレ)は現状維持のため中断しない＝正常運用を止めない。
  try {
    var physMap = buildPhysicalLabelRangeMap_();
    var regressions = [];
    for (var p = 0; p < proposals.length; p++) {
      var pr = proposals[p];
      var phys = pr.sid ? physMap[pr.sid] : null;
      if (!phys || phys.cat !== pr.cat) continue;
      var oldRange = parseAssignRange_(assignNums[pr.idx][0]);
      var newRange = parseAssignRange_(pr.newVal);
      var oldEncloses = oldRange && oldRange.cat === phys.cat && oldRange.start <= phys.min && oldRange.end >= phys.max;
      var newEncloses = newRange && newRange.cat === phys.cat && newRange.start <= phys.min && newRange.end >= phys.max;
      if (oldEncloses && !newEncloses) {
        regressions.push('・仕入れID ' + pr.sid + '（区分' + pr.cat + '）: 実物ラベル z' + phys.cat + phys.min + '〜z' + phys.cat + phys.max +
                         ' / 予約 ' + String(assignNums[pr.idx][0] || '') + ' → ' + pr.newVal);
      }
    }
    if (regressions.length > 0) {
      var wmsg = '【割り当て管理番号 再計算を中断】\n' +
        '確定済み(商品管理に実物ラベルあり)の箱の予約レンジがずれる採番を検出したため、L列を書き換えずに中断しました。\n' +
        '主因は「仕入れ日を過去日にした仕入れの割り込み」です。該当仕入れの仕入れ日を実際の登録日に直してから再度お試しください。\n\n' +
        regressions.join('\n');
      console.error(wmsg);
      notifyAssignConflict_(wmsg);
      return;  // ★ 書き込まない（確定済みラベルを守る）
    }
  } catch (guardErr) {
    // ガードの失敗(商品管理読み取り不能等)で本来の採番を止めないよう、ログのみ残して継続
    console.error('割り当て番号ガードの実行に失敗（採番は続行）: ' + (guardErr && guardErr.message || guardErr));
  }

  // 競合なし → 差分のみ書き込み
  var dirty = false;
  for (var q = 0; q < proposals.length; q++) {
    var pq = proposals[q];
    if (String(assignNums[pq.idx][0] || '') !== pq.newVal) {
      assignNums[pq.idx][0] = pq.newVal;
      dirty = true;
    }
  }

  if (dirty) {
    kanriSheet.getRange(2, knr.ASSIGN_NUM, numRows, 1).setValues(assignNums);
    console.log('割り当て管理番号を再計算しました');
  }
}

// ═══════════════════════════════════════════
//  再発防止ガード用ヘルパー
// ═══════════════════════════════════════════

// 商品管理シートから 仕入れID → { cat, min, max }（実物ラベルの区分と最小/最大番号）を構築
function buildPhysicalLabelRangeMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof STAFF_SHEET_NAME !== 'undefined') ? STAFF_SHEET_NAME : '商品管理';
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return {};
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  var idCol  = (typeof STAFF_COL !== 'undefined' && STAFF_COL['仕入れID']) ? STAFF_COL['仕入れID'] : 2;
  var knrCol = (typeof STAFF_COL !== 'undefined' && STAFF_COL['管理番号']) ? STAFF_COL['管理番号'] : 6;
  var lo = Math.min(idCol, knrCol);
  var hi = Math.max(idCol, knrCol);
  var data = sh.getRange(2, lo, lastRow - 1, hi - lo + 1).getValues();
  var idOff = idCol - lo;
  var knrOff = knrCol - lo;
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var sid = String(data[i][idOff] || '').trim();
    if (!sid) continue;
    var m = String(data[i][knrOff] || '').trim().match(/^z([A-Za-z]+)(\d+)$/);
    if (!m) continue;
    var cat = m[1];
    var num = parseInt(m[2], 10);
    var cur = map[sid];
    if (!cur) { map[sid] = { cat: cat, min: num, max: num }; }
    else if (cur.cat === cat) { if (num < cur.min) cur.min = num; if (num > cur.max) cur.max = num; }
  }
  return map;
}

// "zC950~1074" → { cat:'C', start:950, end:1074 } / パース不能は null
function parseAssignRange_(v) {
  var m = String(v || '').trim().match(/^z([A-Za-z]+)(\d+)~(\d+)$/);
  if (!m) return null;
  return { cat: m[1], start: parseInt(m[2], 10), end: parseInt(m[3], 10) };
}

// 採番ガードの競合を管理者へメール通知（設定シートの通知先を再利用）。失敗しても採番処理は止めない。
function notifyAssignConflict_(message) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recipients = (typeof getRecipients === 'function') ? getRecipients(ss) : [];
    if (!recipients || recipients.length === 0) return;
    var subject = '【要確認】割り当て管理番号の再計算を中断しました';
    for (var i = 0; i < recipients.length; i++) {
      try { MailApp.sendEmail(recipients[i], subject, message); }
      catch (e) { console.error('採番ガード通知メール送信失敗 ' + recipients[i] + ': ' + (e && e.message || e)); }
    }
  } catch (e) {
    console.error('採番ガード通知処理に失敗: ' + (e && e.message || e));
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
