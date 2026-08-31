// 日付フォーマット検証.gs
//
// StaffApi.gs の sfd_cell_ / sfd_date_ / sfd_ts_ の「高速パス」が、
// 旧実装（Utilities.formatDate を毎回呼ぶ版）と 1 文字も違わないことを確かめる。
// 読み取り専用＝シートにも D1 にも一切書かない。GASエディタで実行し、実行ログを見る。
//
// なぜ要るか: この整形結果は D1 の商品データそのもの。1 文字でも変われば
//   ・全 7,500 行が「変更あり」と判定されて UPSERT が走る
//   ・日付の意味がズレると外注アプリの表示・報酬集計まで狂う
// 2026-07-28 の「シートTZ変更で全日付が16時間ズレた」事故と同じ種類の危険があるため、
// 高速パスに手を入れたら必ずこれを通すこと。

/**
 * 商品管理の全行を読み、日付セルについて 旧実装 と 高速パス の出力を突き合わせる。
 * 同じ時刻の Date は結果も同じなので、値が重複するものは 1 回だけ検査する。
 */
function verifyFastDateFormat() {
  var MAX_CHECK = 3000; // 旧実装は 1 値あたり formatDate を 5〜6 回呼ぶ。6分の実行上限に収める上限

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) { Logger.log('シートが見つかりません: ' + STAFF_SHEET_NAME); return; }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('データがありません'); return; }

  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var sheetTz = ss.getSpreadsheetTimeZone() || tz;
  var fast = sfd_fast_(tz, sheetTz);

  Logger.log('スクリプトTZ = ' + tz + ' / シートTZ = ' + sheetTz);
  if (!fast) {
    Logger.log('⚠ どちらかが Asia/Tokyo ではないので、本番では高速パスは使われません（従来どおり formatDate）。');
    Logger.log('  それでも下の突き合わせは実行し、高速パスが正しいかだけ見ておきます。');
  }

  // 値の重複を除く（日付のみのセルは同じ日が何百行も並ぶので、ここで大きく減る）
  var seen = {}, uniq = [], cells = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    for (var c = 0; c < lastCol; c++) {
      var v = row[c];
      if (!(v instanceof Date)) continue;
      cells++;
      var k = String(v.getTime());
      if (seen[k]) continue;
      seen[k] = 1;
      uniq.push(v);
    }
  }
  Logger.log('日付セル ' + cells + ' 個 / 重複を除くと ' + uniq.length + ' 種類');

  var step = Math.max(1, Math.ceil(uniq.length / MAX_CHECK));
  var checked = 0, bad = [];
  for (var j = 0; j < uniq.length; j += step) {
    var d = uniq[j];
    checked++;
    var pairs = [
      ['fmtCell', sfd_cell_(d, tz, sheetTz, false), sfd_cell_(d, tz, sheetTz, true)],
      ['fmtDate', sfd_date_(d, sheetTz, false),     sfd_date_(d, sheetTz, true)],
      ['fmtTs',   sfd_ts_(d, tz, false),            sfd_ts_(d, tz, true)],
    ];
    for (var q = 0; q < pairs.length; q++) {
      if (pairs[q][1] !== pairs[q][2] && bad.length < 20) {
        bad.push(pairs[q][0] + ': 旧=' + pairs[q][1] + ' / 新=' + pairs[q][2]
                 + ' (' + Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'") + ')');
      }
    }
  }

  Logger.log('検査 ' + checked + ' 種類（' + step + ' 個おき）');
  if (!bad.length) {
    Logger.log('✅ 不一致 0 件。高速パスの出力は旧実装と同一です。');
  } else {
    Logger.log('❌ 不一致 ' + bad.length + ' 件（先頭20件まで）:');
    for (var b = 0; b < bad.length; b++) Logger.log('  ' + bad[b]);
  }
  return { checked: checked, unique: uniq.length, cells: cells, mismatches: bad.length, fastActive: fast };
}

/**
 * 高速パスでどれだけ速くなったかを実測する（読み取り専用・シートは触らない）。
 * doPost 経由ではなく GASエディタから直接呼んで所要時間を見るためのもの。
 */
function measureSyncDumpProducts() {
  var t0 = Date.now();
  var r = staff_syncDumpProducts();
  var ms = Date.now() - t0;
  Logger.log('staff_syncDumpProducts: ' + (r && r.ok ? (r.items || []).length + ' 件' : 'エラー ' + (r && r.error))
             + ' / ' + ms + ' ms（' + Math.round(ms / 100) / 10 + ' 秒）');
  return ms;
}
