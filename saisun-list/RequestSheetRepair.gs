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
//
// ■ 方針（安全側に倒す）
//  - 「空欄の行だけ」埋める。既に数式や値が入っている行は絶対に触らない
//    （＝過去に確定した報酬額を書き換えない）。
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
    return ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  } catch (e) {
    console.error('req_getRequestSheet_ error:', e);
    return null;
  }
}

/**
 * AE列(作業報酬)の数式が失われた行を復旧する。
 *
 * 対象条件（すべて満たす行のみ）:
 *   1. A列(受付番号)が入っている
 *   2. AE列に数式が無い
 *   3. AE列の値も空（＝静的な数値が入っている行は確定済みとみなして保護）
 *   4. AG列(チャネル)が入っている（空欄は判別不能なので触らない）
 *
 * @param {Sheet} [sheet] 依頼管理シート（省略時は自動取得）
 * @return {{fixed:number, skippedNoChannel:number, scanned:number}} 修復結果
 */
function req_repairRewardFormulas_(sheet) {
  var sh = sheet || req_getRequestSheet_();
  var result = { fixed: 0, skippedNoChannel: 0, scanned: 0 };
  if (!sh) return result;

  var lastRow = sh.getLastRow();
  if (lastRow < 3) return result; // ヘッダー + 行2(ARRAYFORMULA) のみ

  var n = lastRow - 2; // 行3以降
  var startRow = 3;
  result.scanned = n;

  var receipts = sh.getRange(startRow, REQUEST_SHEET_COLS.RECEIPT_NO, n, 1).getValues();
  var channels = sh.getRange(startRow, REQUEST_SHEET_COLS.CHANNEL, n, 1).getValues();
  var rewardFormulas = sh.getRange(startRow, REQUEST_SHEET_COLS.REWARD, n, 1).getFormulas();
  var rewardValues = sh.getRange(startRow, REQUEST_SHEET_COLS.REWARD, n, 1).getValues();

  for (var i = 0; i < n; i++) {
    if (result.fixed >= REQ_REPAIR_MAX_FIX_) break;

    var receiptNo = String(receipts[i][0] || '').trim();
    if (!receiptNo) continue;

    // 既に数式がある行は正常
    if (String(rewardFormulas[i][0] || '').trim()) continue;
    // 静的な値が入っている行は確定済み報酬とみなして保護
    if (String(rewardValues[i][0] || '').trim() !== '') continue;

    var channel = String(channels[i][0] || '').trim();
    if (!channel) {
      // チャネル不明 = デタウリ(サイズ別)かアソート(箱数×250)か決められない
      result.skippedNoChannel++;
      continue;
    }

    var row = startRow + i;
    try {
      sh.getRange(row, REQUEST_SHEET_COLS.REWARD).setFormula(buildRewardFormula_(row, channel));
      result.fixed++;
    } catch (e) {
      console.error('req_repairRewardFormulas_ 書込失敗 row=' + row, e);
    }
  }

  if (result.fixed > 0 || result.skippedNoChannel > 0) {
    console.log('作業報酬(AE)修復: 復旧=' + result.fixed + '件 / チャネル空欄で保留=' + result.skippedNoChannel + '件');
  }
  return result;
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
    rewardSkippedNoChannel: rewardResult.skippedNoChannel
  };
  console.log('依頼管理の欠落列補完: ' + JSON.stringify(summary));
  return summary;
}
