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
 * 割り当て管理番号の生成ルール（append-only・2026-07-30〜）:
 *   z{区分コード}{開始番号}~{終了番号}
 *   L列は一度確定したら二度と動かさない。空欄かつ商品点数>0 の行だけを
 *   区分の末尾（既存の予約レンジと実物ラベルの最大値の次）から採番する。
 *   例: 区分A の末尾が zA151 のとき、点数10の新規箱 → zA152~161
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
    sweepUnassignedAssignNumbers_();
  });
}

// 同期を手動で1回走らせる（doPost の runShiireSync アクション / GASエディタから実行）
// 孤児掃除（Phase1.6）もこの経路で走る
function staff_runShiireSync() {
  handleChange_ShiireSync({});
  return { ok: true, ran: ['syncKanriToReport_', 'mergeReportToKanri_', 'recalcUnitCost_', 'sweepUnassignedAssignNumbers_'] };
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
//  割り当て管理番号の採番（append-only）
//  z{区分コード}{開始番号}~{終了番号}
//
//  【不変条件】L列は一度確定したら二度と動かさない
//    - L列が埋まっている行 = 凍結。値には一切触れず、整合性の検査だけ行う
//    - L列が空 かつ 商品点数>0 の行 = 未採番。区分の末尾から新規に採番する
//    - 同じ区分に未採番が複数あるときは 仕入れ日→登録日時 の順に連番
//
//  かつては毎回「区分内を1から全再計算」していたが、後から商品点数が入った箱が
//  実物ラベル確定済みの箱の前に割り込み、採番が丸ごと中断する事故が起きたため
//  append-only に変更した（2026-07-30）。新しい番号は必ず既存の最大値より後ろに
//  出るので、確定済みラベルを侵食することが原理的に起こらない。
// ═══════════════════════════════════════════

function recalcAssignNumbers_(kanriSheet, knr, numRows) {
  if (!numRows || numRows < 1) return;
  var ss = kanriSheet.getParent();

  // 必要な列を一括読み取り
  var ids = kanriSheet.getRange(2, knr.ID, numRows, 1).getValues();
  var categories = kanriSheet.getRange(2, knr.CATEGORY, numRows, 1).getValues();
  var dates = kanriSheet.getRange(2, knr.PURCHASE_DATE, numRows, 1).getValues();
  var counts = kanriSheet.getRange(2, knr.ITEM_COUNT, numRows, 1).getValues();
  var regDates = kanriSheet.getRange(2, knr.REG_DATE, numRows, 1).getValues();
  var assignNums = kanriSheet.getRange(2, knr.ASSIGN_NUM, numRows, 1).getValues();

  // 実物ラベル(商品管理)は「L列が空なのにラベルが存在する」異常の検出にだけ使う。
  // 読めなくても採番は止めない。
  var physMap = {};
  try {
    physMap = buildPhysicalLabelRangeMap_();
  } catch (physErr) {
    console.error('実物ラベルの読み取りに失敗（採番は続行）: ' + (physErr && physErr.message || physErr));
  }

  var pendingByCat = {};  // 区分コード → 未採番行の配列
  var anomalies = [];     // 凍結行の不整合（メール通知用）

  for (var i = 0; i < numRows; i++) {
    var cat = normalizeText_(categories[i][0]);
    if (!cat) continue;
    var sid = normalizeText_(ids[i][0]);
    var count = Number(counts[i][0]) || 0;
    var cur = String(assignNums[i][0] || '').trim();
    var rowNo = i + 2;

    // --- 凍結行: 絶対に書き換えない。整合性だけ検査する ---
    if (cur) {
      var rng = parseAssignRange_(cur);
      if (!rng) {
        anomalies.push('・' + rowNo + '行目 ' + sid + '（区分' + cat + '）: 割り当て管理番号「' + cur + '」の書式が不正です');
      } else if (rng.cat !== cat) {
        anomalies.push('・' + rowNo + '行目 ' + sid + '（区分' + cat + '）: 割り当て管理番号「' + cur + '」の区分が行の区分コードと一致しません');
      } else if (count > 0 && (rng.end - rng.start + 1) !== count) {
        anomalies.push('・' + rowNo + '行目 ' + sid + '（区分' + cat + '）: 商品点数 ' + count + '点 に対して予約レンジ「' + cur + '」は ' +
                       (rng.end - rng.start + 1) + '番分 です');
      }
      continue;
    }

    // --- 未採番行 ---
    if (count <= 0) continue;  // 商品点数が未確定 → 仕入れ数報告が入るまで待つ
    if (sid && physMap[sid]) {
      // L列が空なのに実物ラベルがある = 末尾に採番すると既存ラベルが宙に浮く。人が判断すべき状態。
      var ph = physMap[sid];
      anomalies.push('・' + rowNo + '行目 ' + sid + '（区分' + cat + '）: 割り当て管理番号が空なのに実物ラベル z' + ph.cat + ph.min +
                     '〜z' + ph.cat + ph.max + ' が存在するため、自動採番を見送りました');
      continue;
    }
    if (!pendingByCat[cat]) pendingByCat[cat] = [];
    pendingByCat[cat].push({
      idx: i,
      sid: sid,
      purchaseDate: toSortableDate_(dates[i][0]),
      regDate: toSortableDate_(regDates[i][0]),
      count: count
    });
  }

  // --- 未採番行に区分の末尾から採番する ---
  var assigned = [];
  for (var cat2 in pendingByCat) {
    var rows = pendingByCat[cat2];
    // 仕入れ日昇順 → 登録日時昇順（未採番同士の並びだけを決める。既存行の番号には影響しない）
    rows.sort(function(a, b) {
      if (a.purchaseDate < b.purchaseDate) return -1;
      if (a.purchaseDate > b.purchaseDate) return 1;
      if (a.regDate < b.regDate) return -1;
      if (a.regDate > b.regDate) return 1;
      return a.idx - b.idx;
    });

    // 開始番号はSPAの新規登録と同じロジック（L列の予約レンジ末尾 と 実物ラベル の最大値 +1）
    var next = staff_nextKanriNumber_(ss, 'z' + cat2);
    for (var r = 0; r < rows.length; r++) {
      var start = next;
      var end = next + rows[r].count - 1;
      var newVal = 'z' + cat2 + start + '~' + end;
      kanriSheet.getRange(rows[r].idx + 2, knr.ASSIGN_NUM).setValue(newVal);
      assigned.push(rows[r].sid + '（区分' + cat2 + '/' + rows[r].count + '点）→ ' + newVal);
      next = end + 1;
    }
  }

  if (assigned.length > 0) {
    console.log('割り当て管理番号を採番しました: ' + assigned.join(' / '));
  }
  if (anomalies.length > 0) {
    notifyAssignAnomaly_(anomalies);
  }
}

// ═══════════════════════════════════════════
//  未採番スイープ（自己修復）
//  商品点数が入っているのに割り当て管理番号が空の行が残っていないか点検し、
//  あれば採番する。採番は本来 mergeReportToKanri_ から呼ばれるが、点数がシート
//  直編集や別経路で入った場合に取りこぼすため、同期のたびに拾い直す。
// ═══════════════════════════════════════════

function sweepUnassignedAssignNumbers_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kanriSheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME);
  if (!kanriSheet) return;

  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var lastRow = kanriSheet.getLastRow();
  if (lastRow < 2) return;
  var numRows = lastRow - 1;

  // C列(区分コード)〜L列(割り当て管理番号) を1回で読む
  var lo = knr.CATEGORY, hi = knr.ASSIGN_NUM;
  var data = kanriSheet.getRange(2, lo, numRows, hi - lo + 1).getValues();
  var catOff = knr.CATEGORY - lo;
  var cntOff = knr.ITEM_COUNT - lo;
  var asgOff = knr.ASSIGN_NUM - lo;

  for (var i = 0; i < numRows; i++) {
    if (!normalizeText_(data[i][catOff])) continue;
    if ((Number(data[i][cntOff]) || 0) <= 0) continue;
    if (String(data[i][asgOff] || '').trim()) continue;
    console.log('未採番スイープ: ' + (i + 2) + '行目に割り当て管理番号が無いため採番します');
    recalcAssignNumbers_(kanriSheet, knr, numRows);
    return;
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
function notifyAssignConflict_(message, subjectOverride) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recipients = (typeof getRecipients === 'function') ? getRecipients(ss) : [];
    if (!recipients || recipients.length === 0) return;
    var subject = subjectOverride || '【要確認】割り当て管理番号の再計算を中断しました';
    for (var i = 0; i < recipients.length; i++) {
      try { MailApp.sendEmail(recipients[i], subject, message); }
      catch (e) { console.error('採番ガード通知メール送信失敗 ' + recipients[i] + ': ' + (e && e.message || e)); }
    }
  } catch (e) {
    console.error('採番ガード通知処理に失敗: ' + (e && e.message || e));
  }
}

// 凍結行(既に採番済み)の不整合を管理者へ通知する。
// append-only なので採番自体は正常に完了している＝「止まった」わけではないことを本文で明示する。
// 同じ内容を毎回送らないよう、ScriptProperties にハッシュを覚えて重複通知を抑止する。
function notifyAssignAnomaly_(lines) {
  var body = '【要確認】割り当て管理番号に不整合があります\n' +
    '採番自体は正常に完了しています（既存の番号は書き換えていません）。\n' +
    '下記の行はスプレッドシートの「管理メニュー → 🔢 仕入れ点数を修正」から修正してください。\n\n' +
    lines.join('\n');
  console.warn(body);

  try {
    var props = PropertiesService.getScriptProperties();
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, body, Utilities.Charset.UTF_8);
    var digest = '';
    for (var i = 0; i < bytes.length; i++) digest += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
    if (props.getProperty('ASSIGN_ANOMALY_DIGEST') === digest) return;  // 同一内容の再通知は抑止
    props.setProperty('ASSIGN_ANOMALY_DIGEST', digest);
  } catch (e) {
    console.error('採番不整合の通知抑止チェックに失敗（通知は続行）: ' + (e && e.message || e));
  }

  notifyAssignConflict_(body, '【要確認】割り当て管理番号に不整合があります');
}

// Date / 文字列 → ソート可能な文字列 "YYYY-MM-DD HH:MM:SS"
function toSortableDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  return normalizeText_(v);
}
