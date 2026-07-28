/**
 * 日付列の「日付のみ」化 ─ 作業時刻ログ + 過去データ一括正規化
 *
 * 【背景】
 * 出品日などの日付列に「日付＋時刻」のセルが混在していた（2026-07-28 時点で 4,643 セル）。
 * 時刻が入っていると
 *   - 見た目が「2026/07/01 15:52」になり日付だけの行と揃わない
 *   - シート側の集計（フィルタ / ピボット / <=DATE() 比較）と報酬集計（JST の getMonth）が
 *     月境界で 1 件ずれる余地が残る（例: なかのや（児島）2026-07 は 85 と 84 が併存した）
 *   - 過去には AppSheet が別 TZ 起点で書いたセルもあり、TZ 差で前日に表示される行があった
 * ※ シートの TZ は 2026-07-28 に America/Los_Angeles → Asia/Tokyo へ変更された。
 *   Sheets はセルを「壁時計」で持ち TZ を保持しないので、TZ を変えると表示は動かないまま
 *   GAS が読む Date（instant）が丸ごと 16 時間ずれる。LA 時代に GAS が書いた行は
 *   このズレを受けるため、dateNorm_applyFix_ で真の JST 日付へ一度だけ補正した。
 *   以下の処理は TZ を決め打ちせず必ず sheetTz を通すこと。
 *
 * 【方針】
 * 日付列は必ず「シート TZ の 00:00:00」＝日付のみで保存する（StaffApi.gs staff_parseFieldDate_）。
 * 捨てられる作業時刻は、このファイルの staff_appendWorkTimeLog_ で
 * 「作業時刻ログ」シートに追記して追跡できるようにする。
 *
 * 【実行手順（過去データ正規化）】
 *   1. GAS エディタで normalizeDateColumnsDryRun()  … 変更予定件数だけ確認（書き込みなし）
 *   2. GAS エディタで normalizeDateColumnsToDateOnly() … バックアップ作成 → 実書き込み
 *   3. 元に戻したい場合は restoreDateColumnsFromBackup() … 直近の実行ぶんを旧値へ戻す
 */

// 対象列（StaffApi.gs の DETAILS_DATE_ と同一集合）
var DATE_NORMALIZE_COLUMNS_ = [
  '採寸日', '撮影日付', '出品日', '販売日',
  '返品日付', '発送日付', '完了日', 'キャンセル日', '廃棄日'
];

var WORK_TIME_LOG_SHEET_ = '作業時刻ログ';
var DATE_NORMALIZE_BACKUP_SHEET_ = '日付正規化バックアップ';

/**
 * 検証用（読み取り専用）。指定した管理番号の日付セルについて
 * 「シートの表示文字列」と「GAS が読み取る Date」を突き合わせる。
 * getDisplayValue() がシート上の見た目そのものなので、TZ 起因のズレを一発で判定できる。
 */
function dateNorm_probe_(payload) {
  var p = payload || {};
  var kanris = p.kanris || [];
  var cname = p.column || '出品日';
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var h = 0; h < hdr.length; h++) {
    var nm = String(hdr[h] || '').trim();
    if (nm && !col[nm]) col[nm] = h + 1;
  }
  var kcol = col['管理番号'] || STAFF_COL.管理番号;
  var kv = sh.getRange(2, kcol, lastRow - 1, 1).getValues();
  var rowOf = {};
  for (var i = 0; i < kv.length; i++) rowOf[String(kv[i][0] || '')] = i + 2;

  var out = [];
  for (var j = 0; j < kanris.length; j++) {
    var k = String(kanris[j]);
    var rn = rowOf[k];
    if (!rn || !col[cname]) { out.push({ kanri: k, error: 'not found' }); continue; }
    var rg = sh.getRange(rn, col[cname]);
    var v = rg.getValue();
    out.push({
      kanri: k,
      row: rn,
      display: rg.getDisplayValue(),            // ← シート上の見た目（真実）
      format: rg.getNumberFormat(),
      isDate: (v instanceof Date),
      jst: (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX") : String(v),
      utc: (v instanceof Date) ? Utilities.formatDate(v, 'UTC', "yyyy-MM-dd'T'HH:mm:ss") : '',
      la:  (v instanceof Date) ? Utilities.formatDate(v, 'America/Los_Angeles', "yyyy-MM-dd'T'HH:mm:ss") : ''
    });
  }
  // parseDate/formatDate の往復に狂いがないかの自己テスト
  var tz = ss.getSpreadsheetTimeZone();
  var t1 = Utilities.parseDate('2026-07-01', tz, 'yyyy-MM-dd');
  var selfTest = {
    parsed: Utilities.formatDate(t1, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    reformatted: Utilities.formatDate(t1, tz, 'yyyy-MM-dd')
  };

  // バックアップに記録された旧値／新値（1件だけ抜き出す）
  var bkRow = null;
  var bk = ss.getSheetByName(DATE_NORMALIZE_BACKUP_SHEET_);
  if (bk && bk.getLastRow() > 1 && kanris.length) {
    var bd = bk.getRange(2, 1, bk.getLastRow() - 1, 6).getValues();
    for (var b = 0; b < bd.length; b++) {
      if (String(bd[b][2]) === String(kanris[0]) && String(bd[b][3]) === cname) {
        bkRow = { runStamp: String(bd[b][0]), row: bd[b][1], kanri: String(bd[b][2]), column: String(bd[b][3]), old: String(bd[b][4]), neu: String(bd[b][5]) };
        break;
      }
    }
  }

  return {
    ok: true,
    sheetTz: tz,
    scriptTz: Session.getScriptTimeZone(),
    column: cname,
    selfTest: selfTest,
    backup: bkRow,
    items: out
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1) 作業時刻ログ（追記専用）
//    日付セルからは時刻が消えるが、「いつ作業したか」はここに残る。
//    値は文字列で持つ（シート TZ の影響を受けないようにするため）。
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {string} kanri  管理番号
 * @param {Array<{field:string,date:Date}>} entries 更新した日付項目
 * @param {string} email  実行者（ログイン中のメール）
 * @param {string} route  経路（'詳細保存' など）
 */
function staff_appendWorkTimeLog_(kanri, entries, email, route) {
  if (!entries || !entries.length) return;
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(WORK_TIME_LOG_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(WORK_TIME_LOG_SHEET_);
    sh.appendRow(['記録日時', '管理番号', '項目', '日付', '実時刻', '担当者', '経路']);
    sh.setFrozenRows(1);
  }
  var now = new Date();
  var stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  var hms = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss');
  var worker = '';
  try { worker = staff_resolveWorkerName_(email) || String(email || ''); } catch (e) { worker = String(email || ''); }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var ymd = '';
    try { ymd = Utilities.formatDate(e.date, staff_sheetTz_(), 'yyyy-MM-dd'); } catch (e2) {}
    // appendRow は競合に強い（複数スタッフの同時保存を考慮して setValues は使わない）
    sh.appendRow([stamp, kanri, e.field, ymd, hms, worker, String(route || '')]);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2) 過去データの一括正規化
// ═══════════════════════════════════════════════════════════════════════

function normalizeDateColumnsDryRun() {
  var r = dateNorm_run_(true);
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function normalizeDateColumnsToDateOnly() {
  var r = dateNorm_run_(false);
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/**
 * @param {boolean} dryRun true なら一切書き込まない
 */
function dateNorm_run_(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: '他の処理が実行中です（ロック取得失敗）' };
  try {
    var ss = staff_getActiveSpreadsheet_();
    var sh = ss.getSheetByName(STAFF_SHEET_NAME);
    if (!sh) return { ok: false, error: 'シートが見つかりません: ' + STAFF_SHEET_NAME };
    var sheetTz = staff_sheetTz_();

    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2) return { ok: false, error: 'データ行がありません' };

    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var col = {};
    for (var h = 0; h < hdr.length; h++) {
      var name = String(hdr[h] || '').trim();
      if (name && !col[name]) col[name] = h + 1;
    }
    var kanriCol = col['管理番号'] || STAFF_COL.管理番号;
    var kanris = sh.getRange(2, kanriCol, lastRow - 1, 1).getValues();

    var runStamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    var backupRows = [];   // [実行日時, 行, 管理番号, 列, 旧値(JST), 新値]
    var summary = {};
    var totalChanged = 0;
    var skippedFormula = 0;
    var skippedString = 0;

    // 列ごとに処理する。**書き戻しは対象 1 列だけ**（全行 setValues は
    // 発送タブ画像消失の事故原因なので絶対に使わない）
    for (var ci = 0; ci < DATE_NORMALIZE_COLUMNS_.length; ci++) {
      var cname = DATE_NORMALIZE_COLUMNS_[ci];
      var c = col[cname];
      if (!c) { summary[cname] = '列なし'; continue; }

      var rng = sh.getRange(2, c, lastRow - 1, 1);
      var vals = rng.getValues();
      var fmls = rng.getFormulas();
      var changed = 0;

      for (var r = 0; r < vals.length; r++) {
        if (fmls[r][0]) { skippedFormula++; continue; }   // 数式セルは触らない
        var v = vals[r][0];
        if (v === '' || v === null || v === undefined) continue;
        if (!(v instanceof Date)) { skippedString++; continue; }
        if (isNaN(v.getTime())) continue;
        // シート TZ で 00:00:00 なら既に「日付のみ」
        if (Utilities.formatDate(v, sheetTz, 'HH:mm:ss') === '00:00:00') continue;

        // JST の暦日（＝作業した日）をシート TZ の 00:00 に置き換える
        var jstYmd = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
        var nv = Utilities.parseDate(jstYmd, sheetTz, 'yyyy-MM-dd');
        backupRows.push([
          runStamp,
          r + 2,
          String(kanris[r][0] || ''),
          cname,
          Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
          jstYmd
        ]);
        vals[r][0] = nv;
        changed++;
      }

      summary[cname] = changed;
      totalChanged += changed;

      if (!dryRun && changed > 0) {
        // バックアップを先に確定させてから書き込む
        dateNorm_writeBackup_(ss, backupRows);
        backupRows = [];
        rng.setValues(vals);
      }
      if (!dryRun) {
        // 表示も日付のみに揃える（時刻書式が残っていると 0:00 が表示されるため）
        rng.setNumberFormat('yyyy/mm/dd');
      }
    }

    if (!dryRun && backupRows.length) dateNorm_writeBackup_(ss, backupRows);

    return {
      ok: true,
      dryRun: !!dryRun,
      sheetTz: sheetTz,
      rows: lastRow - 1,
      changed: totalChanged,
      perColumn: summary,
      skippedFormula: skippedFormula,
      skippedNonDate: skippedString,
      backupSheet: DATE_NORMALIZE_BACKUP_SHEET_,
      runStamp: runStamp
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3) TZ 変更による 1 日ズレの補正（2026-07-28 の一度きりの復旧用）
//    スプレッドシートの TZ が America/Los_Angeles → Asia/Tokyo に変わったため、
//    それ以前に GAS が書いた「真の JST 時刻」が壁時計として 16 時間ぶん過去に
//    ずれて読まれるようになった。TZ 変更前に取得した全件ダンプ（真の JST）を
//    正として、管理番号 + 列名で日付のみセルを上書きする。
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {{items:Array<[string,string,string]>, apply:boolean, runStamp:string}} payload
 *        items = [[管理番号, 列名, 'yyyy-MM-dd'], ...]
 */
function dateNorm_applyFix_(payload) {
  var p = payload || {};
  var items = p.items || [];
  var dryRun = (p.apply !== true);
  if (!items.length) return { ok: false, error: 'items が空です' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: '他の処理が実行中です（ロック取得失敗）' };
  try {
    var ss = staff_getActiveSpreadsheet_();
    var sh = ss.getSheetByName(STAFF_SHEET_NAME);
    var sheetTz = staff_sheetTz_();
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();

    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var col = {};
    for (var h = 0; h < hdr.length; h++) {
      var nm = String(hdr[h] || '').trim();
      if (nm && !col[nm]) col[nm] = h + 1;
    }
    var kanriCol = col['管理番号'] || STAFF_COL.管理番号;
    var kv = sh.getRange(2, kanriCol, lastRow - 1, 1).getValues();
    var rowOf = {};
    for (var i = 0; i < kv.length; i++) rowOf[String(kv[i][0] || '')] = i + 2;

    // 列ごとにまとめる（書き戻しは対象 1 列だけ）
    var byCol = {};
    var notFound = 0;
    for (var t = 0; t < items.length; t++) {
      var kanri = String(items[t][0] || '');
      var cname = String(items[t][1] || '');
      var ymd = String(items[t][2] || '');
      if (!rowOf[kanri] || !col[cname] || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) { notFound++; continue; }
      (byCol[cname] = byCol[cname] || []).push([rowOf[kanri], kanri, ymd]);
    }

    var runStamp = String(p.runStamp || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'));
    var summary = {};
    var totalChanged = 0, alreadyOk = 0;

    for (var cname2 in byCol) {
      var c = col[cname2];
      var rng = sh.getRange(2, c, lastRow - 1, 1);
      var vals = rng.getValues();
      var fmls = rng.getFormulas();
      var list = byCol[cname2];
      var backupRows = [];
      var changed = 0;

      for (var j = 0; j < list.length; j++) {
        var rn = list[j][0], idx = rn - 2, ymd2 = list[j][2];
        if (fmls[idx][0]) continue;                      // 数式セルは触らない
        var cur = vals[idx][0];
        var curYmd = (cur instanceof Date && !isNaN(cur.getTime()))
          ? Utilities.formatDate(cur, sheetTz, 'yyyy-MM-dd') : '';
        if (curYmd === ymd2) { alreadyOk++; continue; }
        backupRows.push([runStamp, rn, list[j][1], cname2,
          (cur instanceof Date) ? Utilities.formatDate(cur, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX") : String(cur),
          ymd2]);
        vals[idx][0] = Utilities.parseDate(ymd2, sheetTz, 'yyyy-MM-dd');
        changed++;
      }

      summary[cname2] = changed;
      totalChanged += changed;
      if (!dryRun && changed > 0) {
        dateNorm_writeBackup_(ss, backupRows);   // バックアップ確定が先
        rng.setValues(vals);
        rng.setNumberFormat('yyyy/mm/dd');
      }
    }

    return {
      ok: true, dryRun: dryRun, sheetTz: sheetTz, runStamp: runStamp,
      received: items.length, changed: totalChanged,
      alreadyOk: alreadyOk, notFound: notFound, perColumn: summary
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function dateNorm_writeBackup_(ss, rows) {
  if (!rows.length) return;
  var bk = ss.getSheetByName(DATE_NORMALIZE_BACKUP_SHEET_);
  if (!bk) {
    bk = ss.insertSheet(DATE_NORMALIZE_BACKUP_SHEET_);
    bk.appendRow(['実行日時', '行', '管理番号', '列', '旧値(JST)', '新値']);
    bk.setFrozenRows(1);
  }
  bk.getRange(bk.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  SpreadsheetApp.flush();
}

/**
 * 直近（または指定）の正規化を旧値へ戻す。管理番号 + 列名で照合するので、
 * 行が増減していても正しい行に戻る。
 * @param {string} runStamp 省略時はバックアップの最新実行分
 */
function restoreDateColumnsFromBackup(runStamp) {
  var ss = staff_getActiveSpreadsheet_();
  var bk = ss.getSheetByName(DATE_NORMALIZE_BACKUP_SHEET_);
  if (!bk || bk.getLastRow() < 2) return { ok: false, error: 'バックアップがありません' };
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  var data = bk.getRange(2, 1, bk.getLastRow() - 1, 6).getValues();

  var target = String(runStamp || '').trim();
  if (!target) {
    for (var i = 0; i < data.length; i++) {
      var s = String(data[i][0] || '');
      if (s > target) target = s;
    }
  }

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var h = 0; h < hdr.length; h++) {
    var nm = String(hdr[h] || '').trim();
    if (nm && !col[nm]) col[nm] = h + 1;
  }
  var kanriCol = col['管理番号'] || STAFF_COL.管理番号;
  var kanris = sh.getRange(2, kanriCol, lastRow - 1, 1).getValues();
  var rowOf = {};
  for (var k = 0; k < kanris.length; k++) rowOf[String(kanris[k][0] || '')] = k + 2;

  var restored = 0, missing = 0;
  for (var d = 0; d < data.length; d++) {
    if (String(data[d][0] || '') !== target) continue;
    var kanri = String(data[d][2] || '');
    var cname = String(data[d][3] || '');
    var old = String(data[d][4] || '');
    var rn = rowOf[kanri];
    var cn = col[cname];
    if (!rn || !cn || !old) { missing++; continue; }
    var dv = new Date(old);
    if (isNaN(dv.getTime())) { missing++; continue; }
    sh.getRange(rn, cn).setValue(dv);
    restored++;
  }
  return { ok: true, runStamp: target, restored: restored, missing: missing };
}
