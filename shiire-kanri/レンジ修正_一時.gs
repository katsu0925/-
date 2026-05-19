/**
 * 一時メンテナンス: 仕入れ管理シート L列(割当管理番号) の予約レンジを
 * 実際に登録済みの商品の管理番号レンジに合わせて修正する。
 *
 * 経緯: 商品の管理番号採番が「全体最大+1」になっていたため、
 *       仕入れIDごとの予約レンジと実際の登録番号がズレた仕入れが発生した。
 *       採番ロジックは修正済み(Workers側 getNextKanriForPurchase)。
 *       本ファイルは既登録分のレンジを実態に合わせる一回限りの修正。
 *
 * 使い方: GASエディタで fixAssignedRanges_dryRun() を実行して内容を確認 →
 *         問題なければ fixAssignedRanges_apply() を実行。
 * 実行後はこのファイルを削除してよい。
 */

// shiire_id => 実態に合わせた新しい予約レンジ (D1の実商品レンジで検証済み 2026-05-19)
var FIX_RANGE_TARGETS_ = [
  { id: 'u385d306', old: 'zG2023~2185', neo: 'zG1714~1740' }, // 実登録27件が別レンジ
  { id: '48c1722f', old: 'zB645~766',  neo: 'zB645~767'  },   // 末尾1件不足
  { id: '92d75391', old: 'zB767~886',  neo: 'zB768~886'  },   // 先頭1件ズレ
  { id: 'c2b672db', old: 'zB1274~1314', neo: 'zB1273~1313' }, // 全体1件ズレ
  { id: '4dcef6b7', old: 'zB1273~1273', neo: 'zB1314~1314' }  // 単品が別番号
];

function fixAssignedRanges_dryRun() {
  fixAssignedRanges_(false);
}

function fixAssignedRanges_apply() {
  fixAssignedRanges_(true);
}

function fixAssignedRanges_(doWrite) {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) throw new Error('シートが見つかりません: 仕入れ管理');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('データ行がありません');

  // A列(仕入れID) と L列(割当管理番号) を取得
  var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var idRow = {};
  for (var i = 0; i < ids.length; i++) {
    var v = String(ids[i][0] || '').trim();
    if (v) idRow[v] = i + 2; // 実際の行番号
  }

  var log = [];
  var applied = 0;
  for (var t = 0; t < FIX_RANGE_TARGETS_.length; t++) {
    var tg = FIX_RANGE_TARGETS_[t];
    var rowNum = idRow[tg.id];
    if (!rowNum) { log.push('[NG] ' + tg.id + ' : 行が見つかりません'); continue; }

    var cur = String(sh.getRange(rowNum, 12).getValue() || '').trim();
    if (cur === tg.neo) { log.push('[SKIP] ' + tg.id + ' (行' + rowNum + ') : 既に ' + tg.neo); continue; }
    if (cur !== tg.old) {
      log.push('[NG] ' + tg.id + ' (行' + rowNum + ') : 現在値 "' + cur +
               '" が想定 "' + tg.old + '" と一致せず → スキップ');
      continue;
    }

    if (doWrite) {
      sh.getRange(rowNum, 12).setValue(tg.neo);
      applied++;
      log.push('[修正] ' + tg.id + ' (行' + rowNum + ') : ' + tg.old + ' → ' + tg.neo);
    } else {
      log.push('[予定] ' + tg.id + ' (行' + rowNum + ') : ' + tg.old + ' → ' + tg.neo);
    }
  }

  var head = doWrite ? '=== 適用結果 (' + applied + '件修正) ===' : '=== ドライラン (書き込みなし) ===';
  Logger.log(head + '\n' + log.join('\n'));

  if (doWrite && applied > 0) {
    try {
      if (typeof handleChange_ShiireSync === 'function') handleChange_ShiireSync({});
    } catch (err) {
      Logger.log('handleChange_ShiireSync 失敗: ' + (err && err.message));
    }
  }
  return log;
}
