// RequestSheetRepair.gs
// 依頼管理シートの「消えてはいけない値」を自己修復するユーティリティ。
//
// ■ なぜ必要か
//  - AE列(作業報酬)は行の書き込み時に buildRewardFormula_() で数式を焼き込む設計。
//    ところがシート全体を setValues で書き戻す処理（欠品処理など）を通ると
//    数式が静的値に潰れ、T列(配送業者)が未入力だった行は "" が焼き付いて
//    あとから配送業者を入れても報酬が二度と出なくなる。
//  - BASE取込行は AF(更新日時)・AG(チャネル) が空のまま作られていた時期があり、
//    アーカイブ・チャネル別集計・キャンセル時の在庫復帰から漏れる。
//  - シート上で AE列に「配送業者ベースの旧数式」が手作業でドラッグされ、
//    空行まで敷き詰められていた（2026-08-13 発覚）。これがあると発送サイズ別報酬
//    （2026-07-25改定）が反映されず、クリックポスト発送が ¥50 ではなく ¥350 になる。
//
// ■ 方針（安全側に倒す）
//  - 「空欄の行だけ」埋める。既に静的な値が入っている行は絶対に触らない
//    （＝過去に確定した報酬額を書き換えない）。
//  - 例外は旧数式の差し替えのみ。それも REWARD_SCHEME_V2_START_（2026-07-25）以降の
//    依頼日時に限定し、改定前の行は旧数式のまま据え置く。
//  - チャネル(AG)が空の行は デタウリ/アソート を判別できないため AE を推測で埋めない。
//    先に AG を確定させてから（BASE注文キーと照合）AE を直す。
//  - 行2は ARRAYFORMULA 保護のため対象外（od_archiveCompletedOrders_ と同じ扱い）。

/** 1回の実行で修復する最大行数（GAS 6分制限対策） */
var REQ_REPAIR_MAX_FIX_ = 500;

/**
 * 依頼管理シートを取得する（内部用）
 * @return {Sheet|null}
 */
function req_getRequestSheet_() {
  try {
    var ss = sh_getOrderSs_();
    if (!ss) return null;
    var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
    // ★列移設（発送サイズ→V / 箱数→W）が未実施のまま報酬数式を焼くと参照先がズレるため、
    //   修復処理に入る前に必ず移設を済ませておく。移設済みなら何もしない。
    if (sh) sh_migrateShipSizeColumns_(sh);
    return sh;
  } catch (e) {
    console.error('req_getRequestSheet_ error:', e);
    return null;
  }
}

/**
 * AE列(作業報酬)の数式が失われた行 / 旧ルールの数式が残っている行を復旧する。
 *
 * ① 数式が消えた行の復旧（すべて満たす行のみ）:
 *   1. A列(受付番号)が入っている
 *   2. AE列に数式が無い
 *   3. AE列の値も空（＝静的な数値が入っている行は確定済みとみなして保護）
 *   4. AG列(チャネル)が入っている（空欄は判別不能なので触らない）
 *
 * ② 旧ルールの数式の差し替え:
 *   シート上で手作業により AE列へドラッグされた旧数式（配送業者ベース）が残っていると、
 *   発送サイズ別報酬（2026-07-25改定）が永久に反映されない。
 *   判定は「buildRewardFormula_() が返す期待数式と一致するか」で行う（isCurrentRewardFormula_）。
 *   一致しない行のうち REWARD_SCHEME_V2_START_ 以降の依頼日時の行だけを現行数式へ差し替える。
 *   （それより前の行は支払済みの可能性があるため旧数式のまま保護する）
 *   ※報酬ルールを改定した場合も、この経路で改定日以降の行が自動的に追随する。
 *
 * ③ 空行の掃除:
 *   受付番号が無い行に数式だけが残っていると、次に書き込まれる行が
 *   旧ルールで計算されてしまう（GASが上書きしない経路では気づけない）。
 *   受付番号が空なのに AG に数式が入っている行はクリアする。
 *
 * @param {Sheet} [sheet] 依頼管理シート（省略時は自動取得）
 * @return {{fixed:number, legacyReplaced:number, legacyKeptOld:number, blankCleared:number, skippedNoChannel:number, scanned:number}} 修復結果
 */
function req_repairRewardFormulas_(sheet) {
  var sh = sheet || req_getRequestSheet_();
  var result = { fixed: 0, legacyReplaced: 0, legacyKeptOld: 0, blankCleared: 0, skippedNoChannel: 0, scanned: 0 };
  if (!sh) return result;

  var lastRow = sh.getLastRow();
  if (lastRow < 3) return result; // ヘッダー + 行2(ARRAYFORMULA) のみ

  var n = lastRow - 2; // 行3以降
  var startRow = 3;
  result.scanned = n;

  var receipts = sh.getRange(startRow, REQUEST_SHEET_COLS.RECEIPT_NO, n, 1).getValues();
  var requestedAt = sh.getRange(startRow, REQUEST_SHEET_COLS.DATETIME, n, 1).getValues();
  var channels = sh.getRange(startRow, REQUEST_SHEET_COLS.CHANNEL, n, 1).getValues();
  var rewardFormulas = sh.getRange(startRow, REQUEST_SHEET_COLS.REWARD, n, 1).getFormulas();
  var rewardValues = sh.getRange(startRow, REQUEST_SHEET_COLS.REWARD, n, 1).getValues();

  var blankRows = []; // 掃除対象（受付番号なし × 数式あり）のインデックス

  for (var i = 0; i < n; i++) {
    if (result.fixed + result.legacyReplaced >= REQ_REPAIR_MAX_FIX_) break;

    var formula = String(rewardFormulas[i][0] || '').trim();
    var receiptNo = String(receipts[i][0] || '').trim();

    // --- ③ 空行に居座る数式を掃除する ---
    if (!receiptNo) {
      if (formula) blankRows.push(i);
      continue;
    }

    var row = startRow + i;
    var channel = String(channels[i][0] || '').trim();

    var reqDate = requestedAt[i][0];
    var isV3Row = (reqDate instanceof Date) && reqDate.getTime() && reqDate >= REWARD_SCHEME_V3_START_;

    // --- ② 旧ルールの数式を、その行の依頼日時に見合う数式へ差し替える ---
    if (formula) {
      // v3行はチャネル非依存（サイズ×箱数）なので channel が空でも判定できる
      if ((channel || isV3Row) && isCurrentRewardFormula_(formula, row, channel, reqDate)) continue; // 期待どおり = 正常
      if (!(reqDate instanceof Date) || reqDate < REWARD_SCHEME_V2_START_) {
        // 改定前の行 = 支払済みの可能性があるので触らない
        result.legacyKeptOld++;
        continue;
      }
      if (!channel && !isV3Row) {
        result.skippedNoChannel++;
        continue;
      }
      try {
        sh.getRange(row, REQUEST_SHEET_COLS.REWARD).setFormula(buildRewardFormulaForDate_(row, channel, reqDate));
        result.legacyReplaced++;
      } catch (eL) {
        console.error('req_repairRewardFormulas_ 旧数式差替失敗 row=' + row, eL);
      }
      continue;
    }

    // --- ① 数式が消えた行を復旧する ---
    // 静的な値が入っている行は確定済み報酬とみなして保護
    if (String(rewardValues[i][0] || '').trim() !== '') continue;

    if (!channel && !isV3Row) {
      // v2以前はチャネル不明だとデタウリ(サイズ別)かアソート(箱数×250)か決められない
      // （v3以降はサイズ×箱数の1本なのでチャネル不要）
      result.skippedNoChannel++;
      continue;
    }

    try {
      sh.getRange(row, REQUEST_SHEET_COLS.REWARD).setFormula(buildRewardFormulaForDate_(row, channel, reqDate));
      result.fixed++;
    } catch (e) {
      console.error('req_repairRewardFormulas_ 書込失敗 row=' + row, e);
    }
  }

  result.blankCleared = req_clearBlankRewardCells_(sh, startRow, blankRows);

  if (result.fixed || result.legacyReplaced || result.blankCleared || result.skippedNoChannel) {
    console.log('作業報酬(AG)修復: 復旧=' + result.fixed +
      '件 / 旧数式差替=' + result.legacyReplaced +
      '件 / 改定前につき据置=' + result.legacyKeptOld +
      '件 / 空行クリア=' + result.blankCleared +
      '件 / チャネル空欄で保留=' + result.skippedNoChannel + '件');
  }
  return result;
}

/**
 * 受付番号が無い行に残った AE列の数式をクリアする（連続行はまとめて処理）。
 * @param {Sheet} sh 依頼管理シート
 * @param {number} startRow 走査開始行（1-based）
 * @param {number[]} indexes startRow からのオフセット配列（昇順）
 * @return {number} クリアしたセル数
 */
function req_clearBlankRewardCells_(sh, startRow, indexes) {
  if (!indexes || !indexes.length) return 0;
  var cleared = 0;
  var blockStart = indexes[0];
  var prev = indexes[0];

  for (var i = 1; i <= indexes.length; i++) {
    var cur = (i < indexes.length) ? indexes[i] : -1;
    if (cur === prev + 1) { prev = cur; continue; }
    var len = prev - blockStart + 1;
    try {
      sh.getRange(startRow + blockStart, REQUEST_SHEET_COLS.REWARD, len, 1).clearContent();
      cleared += len;
    } catch (e) {
      console.error('req_clearBlankRewardCells_ クリア失敗 row=' + (startRow + blockStart) + ' len=' + len, e);
    }
    blockStart = cur;
    prev = cur;
  }
  return cleared;
}

/**
 * BASE_注文シートの注文キー集合を作る（AG列の後追い判定に使う）
 * @param {Spreadsheet} ss
 * @return {Object} キー -> true
 */
function req_buildBaseOrderKeySet_(ss) {
  var set = {};
  try {
    var sh = ss.getSheetByName('BASE_注文');
    if (!sh) return set;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return set;

    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = buildHeaderMap_(header);
    var idxKey = findAnyCol_(map, ['注文キー', '注文Key', 'Order Key', 'order_key', 'orderKey', '注文ID', '受注ID', '受付番号']);
    if (idxKey === -1) return set;

    var vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var k = normalizeKey_(vals[i][idxKey]);
      if (k) set[k] = true;
    }
  } catch (e) {
    console.error('req_buildBaseOrderKeySet_ error:', e);
  }
  return set;
}

/**
 * 【手動実行】依頼管理シートの取りこぼし列をまとめて補完する。
 *
 * 補完対象（いずれも「空欄の行だけ」）:
 *   - AG列(チャネル): 受付番号が BASE_注文 の注文キーと一致する行に 'アソート' を設定
 *   - AF列(更新日時): B列(依頼日時)の日付をコピー（アーカイブ判定・更新日時表示に必要）
 *   - AE列(作業報酬): AG確定後に数式を再投入
 *
 * GASエディタから実行する。結果はログと戻り値で確認できる。
 * @return {Object} 補完件数
 */
function repairIraiKanriMissingFields() {
  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (!sh) throw new Error('依頼管理シートが見つかりません');

  var lastRow = sh.getLastRow();
  if (lastRow < 3) return { channel: 0, updatedAt: 0, reward: 0 };

  var startRow = 3; // 行2はARRAYFORMULA保護
  var n = lastRow - 2;

  var baseKeys = req_buildBaseOrderKeySet_(ss);

  var receipts = sh.getRange(startRow, REQUEST_SHEET_COLS.RECEIPT_NO, n, 1).getValues();
  var requestedAt = sh.getRange(startRow, REQUEST_SHEET_COLS.DATETIME, n, 1).getValues();
  var updatedAt = sh.getRange(startRow, REQUEST_SHEET_COLS.UPDATED_AT, n, 1).getValues();
  var channels = sh.getRange(startRow, REQUEST_SHEET_COLS.CHANNEL, n, 1).getValues();

  var channelFixed = 0;
  var updatedFixed = 0;

  for (var i = 0; i < n; i++) {
    var receiptNo = String(receipts[i][0] || '').trim();
    if (!receiptNo) continue;
    var row = startRow + i;

    // --- AG列(チャネル): BASE注文キーと一致する空欄行を 'アソート' に ---
    if (!String(channels[i][0] || '').trim()) {
      var key = normalizeKey_(receiptNo);
      if (key && baseKeys[key]) {
        try {
          sh.getRange(row, REQUEST_SHEET_COLS.CHANNEL).setValue('アソート');
          channels[i][0] = 'アソート';
          channelFixed++;
        } catch (e) {
          console.error('AG列補完失敗 row=' + row, e);
        }
      }
    }

    // --- AF列(更新日時): 空欄なら依頼日時をコピー ---
    if (!(updatedAt[i][0] instanceof Date) && String(updatedAt[i][0] || '').trim() === '') {
      var d = requestedAt[i][0];
      if (d instanceof Date) {
        try {
          sh.getRange(row, REQUEST_SHEET_COLS.UPDATED_AT).setValue(d);
          updatedFixed++;
        } catch (e2) {
          console.error('AF列補完失敗 row=' + row, e2);
        }
      }
    }
  }

  // --- AE列(作業報酬): AG確定後に数式を復旧 ---
  var rewardResult = req_repairRewardFormulas_(sh);

  var summary = {
    channel: channelFixed,
    updatedAt: updatedFixed,
    reward: rewardResult.fixed,
    rewardLegacyReplaced: rewardResult.legacyReplaced,
    rewardLegacyKeptOld: rewardResult.legacyKeptOld,
    rewardBlankCleared: rewardResult.blankCleared,
    rewardSkippedNoChannel: rewardResult.skippedNoChannel
  };
  console.log('依頼管理の欠落列補完: ' + JSON.stringify(summary));
  return summary;
}


/**
 * 【手動実行1回】発送サイズ／箱数を V・W列（伝票番号の隣）へ移す。
 *
 * 発送作業者が「どのサイズの箱を何箱送ったか」を配送業者・伝票番号と並べて入力できるようにするための列移設。
 * 依頼管理・依頼管理_アーカイブの両方に適用する。実体は Product.gs の sh_migrateShipSizeColumns_。
 *
 * ※通常は注文書き込み時（sh_ensureRequestSheet_）に自動で1回実行されるため、
 *   この関数は「注文が来る前に手で済ませておきたい」ときのための入口。移設済みなら何もしない。
 */
function migrateShipSizeColumns() {
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var moved = [];
  var reqSh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (reqSh && sh_migrateShipSizeColumns_(reqSh)) moved.push(reqSh.getName());
  var arcSh = ss.getSheetByName('依頼管理_アーカイブ');
  if (arcSh && sh_migrateShipSizeColumns_(arcSh)) moved.push(arcSh.getName());

  // ヘッダー・プルダウンを新しい列位置に張り直す
  sh_applyRequestStatusDropdown_(ss);

  var msg = moved.length ? ('列移設を実行しました: ' + moved.join(' / ')) : '列移設は不要でした（すでに新しい並びです）';
  console.log(msg);
  return { moved: moved, message: msg };
}
