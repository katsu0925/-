// 作業分析更新.gs
// 「商品管理」シートから「作業分析」シートを毎時再構築する（トリガー: トリガー設定.gs:19）
//
// ■ 2026-08-28 全面刷新
//  旧版は月別サマリーを A1:I（1行 + 月数）に書きつつ、当月日別を F13、人別日別を L13 と
//  「固定行」に書いていた。データが13か月を超えた時点で月別サマリーの右側4列
//  （出品件数 / 出品ユニーク人数 / 発送件数 / 発送ユニーク人数）が日別表に上書きされて壊れる。
//  → 全ブロックを A列起点で縦に積む（行カーソル方式）に変更し、重なりが構造的に起きないようにした。
//  → 「アカウント別 月別出品数」ピボット（行=使用アカウント／列=月）を新設。
//  → 現在出品中の在庫はアカウント上位3件までだったのを全件表示に変更。
//  → 列位置はヘッダー名で解決し、見つからないときだけ従来の列番号にフォールバックする。
//    （同名ヘッダーが複数ある場合は「最初の列」を優先）
//
// ※ セル結合は一切使わない。Sheet.clear() は結合を解除しないため、
//   結合を使うと毎時の再実行でレイアウトが壊れる。

var WA_SRC_NAME     = '商品管理';
var WA_DST_NAME     = '作業分析';
var WA_PIVOT_MONTHS = 12;   // ピボット表に出す直近月数
var WA_BLANK        = '(未入力)';

var WA_C_TITLE_BG = '#1f3864';
var WA_C_TITLE_FG = '#ffffff';
var WA_C_HEAD_BG  = '#d9e2f3';
var WA_C_ZEBRA    = '#f5f7fb';
var WA_C_TOTAL_BG = '#fff2cc';
var WA_C_SAT_BG   = '#eaf1fb';
var WA_C_SUN_BG   = '#fdecec';
var WA_C_BORDER   = '#b7c3d6';
var WA_NUMFMT     = '#,##0;-#,##0;"-"';

/**
 * エントリポイント（1時間ごとのトリガーから呼ばれる。関数名は変更しないこと）
 */
function buildWorkAnalysis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var sid = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (sid) ss = SpreadsheetApp.openById(sid);
  }
  if (!ss) throw new Error('スプレッドシートを取得できません');

  var src = ss.getSheetByName(WA_SRC_NAME);
  if (!src) throw new Error(WA_SRC_NAME + ' シートが見つかりません');
  var dst = ss.getSheetByName(WA_DST_NAME) || ss.insertSheet(WA_DST_NAME);

  dst.clear();
  dst.setFrozenRows(0);
  try { dst.setHiddenGridlines(true); } catch (e) {}

  var lastRow = src.getLastRow();
  var lastCol = src.getLastColumn();
  if (lastRow < 2) {
    dst.getRange(1, 1).setValue('データがありません');
    return;
  }

  // ---- 列解決（ヘッダー名優先／既定の列番号にフォールバック） ----
  var header = src.getRange(1, 1, 1, lastCol).getValues()[0];
  var hidx = {};
  for (var c = 0; c < header.length; c++) {
    var h = String(header[c] == null ? '' : header[c]).trim();
    if (h && !(h in hidx)) hidx[h] = c + 1;   // 同名は最初の列を優先
  }
  function colOf(names, fallback) {
    for (var i = 0; i < names.length; i++) if (hidx[names[i]]) return hidx[names[i]];
    return fallback;
  }

  var KINDS = [
    { key: 'meas',  label: '採寸', dCol: colOf(['採寸日', '採寸日付'], 33), pCol: colOf(['採寸者', '採寸担当'], 34) },
    { key: 'photo', label: '撮影', dCol: colOf(['撮影日付', '撮影日'], 35), pCol: colOf(['撮影者', '撮影担当'], 36) },
    { key: 'list',  label: '出品', dCol: colOf(['出品日', '出品日付'], 37), pCol: colOf(['出品者', '出品担当'], 38) },
    { key: 'ship',  label: '発送', dCol: colOf(['発送日付', '発送日'], 57), pCol: colOf(['発送者', '発送担当'], 58) }
  ];
  var accCol = colOf(['使用アカウント'], 39);
  var stCol  = colOf(['ステータス'], 5);

  // ---- 読み込み（必要な列だけをまとめて1ブロックで取得） ----
  var need = [accCol];
  for (var ki = 0; ki < KINDS.length; ki++) { need.push(KINDS[ki].dCol); need.push(KINDS[ki].pCol); }
  var minC = Math.min.apply(null, need);
  var maxC = Math.max.apply(null, need);
  var n = lastRow - 1;
  var vals = src.getRange(2, minC, n, maxC - minC + 1).getValues();
  var stVals = src.getRange(2, stCol, n, 1).getValues();

  // ---- 集計 ----
  var now = new Date();
  var mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var mEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var curYm  = wa_ym_(mStart);

  var monthSet = {};
  var agg = {};                 // kind -> { total:{ym:n}, person:{ym:{name:n}}, daily:{dayKey:n} }
  for (var a = 0; a < KINDS.length; a++) agg[KINDS[a].key] = { total: {}, person: {}, daily: {} };
  var acctMonth = {};           // ym -> { account: 出品数 }
  var dailyPerson = {};         // person -> dayKey -> { meas, photo, list, ship }
  var stockByAcct = {};         // account -> 出品中件数
  var stockTotal = 0;

  for (var i = 0; i < n; i++) {
    var row = vals[i];
    var acct = wa_name_(row[accCol - minC]);

    if (String(stVals[i][0] == null ? '' : stVals[i][0]).trim() === '出品中') {
      stockByAcct[acct] = (stockByAcct[acct] || 0) + 1;
      stockTotal++;
    }

    for (var k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var d = wa_date_(row[kind.dCol - minC]);
      if (!d) continue;

      var ym = wa_ym_(d);
      monthSet[ym] = true;
      var A = agg[kind.key];
      A.total[ym] = (A.total[ym] || 0) + 1;

      var person = wa_name_(row[kind.pCol - minC]);
      if (!A.person[ym]) A.person[ym] = {};
      A.person[ym][person] = (A.person[ym][person] || 0) + 1;

      if (kind.key === 'list') {
        if (!acctMonth[ym]) acctMonth[ym] = {};
        acctMonth[ym][acct] = (acctMonth[ym][acct] || 0) + 1;
      }

      if (d >= mStart && d < mEnd) {
        var dk = wa_day_(d);
        A.daily[dk] = (A.daily[dk] || 0) + 1;
        if (!dailyPerson[person]) dailyPerson[person] = {};
        if (!dailyPerson[person][dk]) dailyPerson[person][dk] = { meas: 0, photo: 0, list: 0, ship: 0 };
        dailyPerson[person][dk][kind.key]++;
      }
    }
  }

  var months = Object.keys(monthSet).sort();
  var pivotMonths = months.slice(-WA_PIVOT_MONTHS);
  var monthsDesc = months.slice().reverse();
  var curLabel = Utilities.formatDate(mStart, 'GMT+9', 'yyyy年M月');

  // ---- 出力（すべて A列起点・行カーソルで縦積み） ----
  var r = 1;
  var width = Math.max(7, pivotMonths.length + 2);

  wa_ensure_(dst, 1, 1, 3, width);
  dst.getRange(1, 1).setValue('作業分析');
  dst.getRange(1, 1, 1, width).setFontSize(14).setFontWeight('bold');
  dst.getRange(2, 1).setValue(
    '最終更新 ' + Utilities.formatDate(now, 'GMT+9', 'yyyy/MM/dd HH:mm') +
    '　／　対象 ' + WA_SRC_NAME + ' ' + n + '行' +
    '　／　1時間ごとに自動更新');
  dst.getRange(2, 1, 1, width).setFontColor('#666666').setFontSize(9);
  r = 4;

  // ① 月別サマリー
  r = wa_title_(dst, r, '① 月別サマリー（新しい月が上）', width);
  var sumRows = [];
  for (var m = 0; m < monthsDesc.length; m++) {
    var ym2 = monthsDesc[m];
    var v1 = agg.meas.total[ym2] || 0, v2 = agg.photo.total[ym2] || 0,
        v3 = agg.list.total[ym2] || 0, v4 = agg.ship.total[ym2] || 0;
    sumRows.push([ym2 + (ym2 === curYm ? '（今月）' : ''), v1, v2, v3, v4, v1 + v2 + v3 + v4]);
  }
  sumRows.push(wa_sumRow_('合計', sumRows, 1, 5));
  r = wa_table_(dst, r, ['月', '採寸', '撮影', '出品', '発送', '合計'], sumRows, { boldLast: true });

  // ② アカウント別 月別出品数
  r = wa_title_(dst, r, '② アカウント別 月別出品数（出品日ベース・直近' + pivotMonths.length + 'か月）', width);
  r = wa_table_(dst, r, ['使用アカウント'].concat(pivotMonths).concat(['合計']),
                wa_pivot_(acctMonth, pivotMonths), { boldLast: true });

  // ③ 現在の在庫（出品中）アカウント別
  r = wa_title_(dst, r, '③ 現在の在庫（ステータス=出品中）アカウント別', width);
  var stockRows = [];
  var stockKeys = Object.keys(stockByAcct);
  stockKeys.sort(function (x, y) { return stockByAcct[y] - stockByAcct[x] || wa_cmp_(x, y); });
  for (var s = 0; s < stockKeys.length; s++) {
    var cnt = stockByAcct[stockKeys[s]];
    stockRows.push([stockKeys[s], cnt, stockTotal ? cnt / stockTotal : 0]);
  }
  if (stockRows.length) stockRows.push(['合計', stockTotal, stockTotal ? 1 : 0]);
  r = wa_table_(dst, r, ['使用アカウント', '出品中件数', '構成比'],
                stockRows.length ? stockRows : [['(該当なし)', 0, 0]],
                { boldLast: stockRows.length > 0, pctCol: 3 });

  // ④ 当月 担当者別 作業件数
  r = wa_title_(dst, r, '④ ' + curLabel + ' 担当者別 作業件数', width);
  var pRows = [];
  var pNames = Object.keys(dailyPerson);
  for (var p = 0; p < pNames.length; p++) {
    var t = { meas: 0, photo: 0, list: 0, ship: 0 };
    var byDay = dailyPerson[pNames[p]];
    for (var dk2 in byDay) { t.meas += byDay[dk2].meas; t.photo += byDay[dk2].photo; t.list += byDay[dk2].list; t.ship += byDay[dk2].ship; }
    pRows.push([pNames[p], t.meas, t.photo, t.list, t.ship, t.meas + t.photo + t.list + t.ship]);
  }
  pRows.sort(function (x, y) { return y[5] - x[5] || wa_cmp_(x[0], y[0]); });
  if (pRows.length) pRows.push(wa_sumRow_('合計', pRows, 1, 5));
  r = wa_table_(dst, r, ['担当者', '採寸', '撮影', '出品', '発送', '合計'],
                pRows.length ? pRows : [['(該当なし)', 0, 0, 0, 0, 0]], { boldLast: pRows.length > 0 });

  // ⑤ 当月 日別 作業件数
  r = wa_title_(dst, r, '⑤ ' + curLabel + ' 日別 作業件数', width);
  var dayRows = [], dayColors = [];
  for (var day = new Date(mStart); day < mEnd; day.setDate(day.getDate() + 1)) {
    var dk3 = wa_day_(day);
    var d1 = agg.meas.daily[dk3] || 0, d2 = agg.photo.daily[dk3] || 0,
        d3 = agg.list.daily[dk3] || 0, d4 = agg.ship.daily[dk3] || 0;
    dayRows.push([wa_dayLabel_(day), d1, d2, d3, d4, d1 + d2 + d3 + d4]);
    dayColors.push(day.getDay() === 0 ? WA_C_SUN_BG : (day.getDay() === 6 ? WA_C_SAT_BG : null));
  }
  dayRows.push(wa_sumRow_('合計', dayRows, 1, 5));
  dayColors.push(null);
  r = wa_table_(dst, r, ['日付', '採寸', '撮影', '出品', '発送', '合計'], dayRows,
                { boldLast: true, rowColors: dayColors });

  // ⑥ 当月 担当者×日別
  r = wa_title_(dst, r, '⑥ ' + curLabel + ' 担当者×日別（作業のあった日のみ）', width);
  var pdRows = [];
  var pdNames = Object.keys(dailyPerson).sort(wa_cmp_);
  for (var q = 0; q < pdNames.length; q++) {
    var nm = pdNames[q], daysMap = dailyPerson[nm];
    var dayKeys = Object.keys(daysMap).sort();
    for (var w = 0; w < dayKeys.length; w++) {
      var cell = daysMap[dayKeys[w]];
      var tot = cell.meas + cell.photo + cell.list + cell.ship;
      if (!tot) continue;
      pdRows.push([nm, wa_dayLabel_(wa_fromDay_(dayKeys[w])), cell.meas, cell.photo, cell.list, cell.ship, tot]);
    }
  }
  r = wa_table_(dst, r, ['担当者', '日付', '採寸', '撮影', '出品', '発送', '合計'],
                pdRows.length ? pdRows : [['(該当なし)', '', 0, 0, 0, 0, 0]], { numFrom: 3 });

  // ⑦ 月別 担当者別（区分ごと）
  for (var kk = 0; kk < KINDS.length; kk++) {
    var kd = KINDS[kk];
    r = wa_title_(dst, r, '⑦-' + (kk + 1) + ' 月別 担当者別（' + kd.label + '）直近' + pivotMonths.length + 'か月', width);
    r = wa_table_(dst, r, ['担当者'].concat(pivotMonths).concat(['合計']),
                  wa_pivot_(agg[kd.key].person, pivotMonths), { boldLast: true });
  }

  // ---- 体裁 ----
  dst.setColumnWidth(1, 200);
  for (var cw = 2; cw <= width; cw++) dst.setColumnWidth(cw, 92);
  dst.setFrozenRows(2);
}

/* ============================ 出力ヘルパー ============================ */

/** 行数・列数が足りなければ追加する（setValues のはみ出しエラー防止） */
function wa_ensure_(sh, row, col, numRows, numCols) {
  var needR = row + numRows - 1, needC = col + numCols - 1;
  if (sh.getMaxRows() < needR) sh.insertRowsAfter(sh.getMaxRows(), needR - sh.getMaxRows());
  if (sh.getMaxColumns() < needC) sh.insertColumnsAfter(sh.getMaxColumns(), needC - sh.getMaxColumns());
}

/** 見出し行を書く。次に書ける行番号を返す */
function wa_title_(sh, row, text, width) {
  wa_ensure_(sh, row, 1, 1, width);
  var rng = sh.getRange(row, 1, 1, width);
  rng.setBackground(WA_C_TITLE_BG).setFontColor(WA_C_TITLE_FG).setFontWeight('bold').setFontSize(11);
  sh.getRange(row, 1).setValue(text);
  return row + 1;
}

/**
 * 表を書く。次に書ける行番号（1行空けた位置）を返す
 * opts: { boldLast:合計行を強調, numFrom:数値開始列(1始点,既定2), rowColors:行別背景, pctCol:%書式にする列 }
 */
function wa_table_(sh, row, headerArr, rows, opts) {
  opts = opts || {};
  var w = headerArr.length;
  var data = [headerArr];
  for (var i = 0; i < rows.length; i++) {
    var rr = rows[i].slice(0, w);
    while (rr.length < w) rr.push('');
    data.push(rr);
  }
  wa_ensure_(sh, row, 1, data.length, w);
  var rng = sh.getRange(row, 1, data.length, w);
  rng.setValues(data);
  rng.setBorder(true, true, true, true, true, true, WA_C_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  rng.setFontSize(10);

  // ヘッダー
  sh.getRange(row, 1, 1, w).setBackground(WA_C_HEAD_BG).setFontWeight('bold').setHorizontalAlignment('center');

  // 本文の背景（縞 → 行別色 → 合計行の順に上書き）
  var bgs = [];
  for (var b = 0; b < rows.length; b++) {
    var color = (b % 2 === 1) ? WA_C_ZEBRA : '#ffffff';
    if (opts.rowColors && opts.rowColors[b]) color = opts.rowColors[b];
    if (opts.boldLast && b === rows.length - 1) color = WA_C_TOTAL_BG;
    var line = [];
    for (var c = 0; c < w; c++) line.push(color);
    bgs.push(line);
  }
  if (bgs.length) sh.getRange(row + 1, 1, bgs.length, w).setBackgrounds(bgs);
  if (opts.boldLast && rows.length) sh.getRange(row + rows.length, 1, 1, w).setFontWeight('bold');

  // 数値列
  var numFrom = opts.numFrom || 2;
  if (w >= numFrom && rows.length) {
    sh.getRange(row + 1, numFrom, rows.length, w - numFrom + 1)
      .setNumberFormat(WA_NUMFMT).setHorizontalAlignment('right');
  }
  if (opts.pctCol && rows.length) {
    sh.getRange(row + 1, opts.pctCol, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');
  }
  return row + data.length + 1;   // 表の下を1行空ける
}

/** ym -> { name: 件数 } を 行=name / 列=月 のピボット行配列に変換（合計行付き・降順） */
function wa_pivot_(bucket, monthsArr) {
  var nameSet = {};
  for (var i = 0; i < monthsArr.length; i++) {
    var b = bucket[monthsArr[i]];
    if (!b) continue;
    for (var k in b) nameSet[k] = true;
  }
  var names = Object.keys(nameSet);
  var rows = [];
  for (var j = 0; j < names.length; j++) {
    var line = [names[j]], sum = 0;
    for (var m = 0; m < monthsArr.length; m++) {
      var b2 = bucket[monthsArr[m]];
      var v = (b2 && b2[names[j]]) || 0;
      line.push(v); sum += v;
    }
    line.push(sum);
    if (sum > 0) rows.push(line);
  }
  rows.sort(function (x, y) { return y[y.length - 1] - x[x.length - 1] || wa_cmp_(x[0], y[0]); });
  if (!rows.length) {
    var empty = ['(該当なし)'];
    for (var e = 0; e <= monthsArr.length; e++) empty.push(0);
    return [empty];
  }
  rows.push(wa_sumRow_('合計', rows, 1, monthsArr.length + 1));
  return rows;
}

/** rows の from..to 列（0始点）を合計した行を作る */
function wa_sumRow_(label, rows, from, to) {
  var out = [label];
  for (var c = from; c <= to; c++) {
    var s = 0;
    for (var i = 0; i < rows.length; i++) s += Number(rows[i][c]) || 0;
    out.push(s);
  }
  return out;
}

/* ============================ 値ヘルパー ============================ */

/** 担当者名・アカウント名の正規化（前後空白除去・空欄は (未入力)） */
function wa_name_(v) {
  var s = String(v == null ? '' : v).trim();
  return s === '' ? WA_BLANK : s;
}

/** Date / シリアル値 / 文字列 を Date に。不正値は null */
function wa_date_(v) {
  if (v == null || v === '') return null;
  var d = null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    d = v;
  } else if (typeof v === 'number') {
    if (v < 10000 || v > 90000) return null;             // 日付シリアルの妥当範囲のみ
    d = new Date(Math.round((v - 25569) * 86400 * 1000));
  } else {
    var s = String(v).trim().replace(/[.\-]/g, '/');
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) return null;
    d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  var y = d.getFullYear();
  if (y < 2000 || y > 2100) return null;
  return d;
}

function wa_ym_(d)  { return Utilities.formatDate(d, 'GMT+9', 'yyyy/MM'); }
function wa_day_(d) { return Utilities.formatDate(d, 'GMT+9', 'yyyy/MM/dd'); }

/** '8/1(金)' 形式の表示ラベル */
function wa_dayLabel_(d) {
  var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + wd + ')';
}

/** 'yyyy/MM/dd' → Date */
function wa_fromDay_(key) {
  var p = key.split('/');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** 日本語ロケール優先の文字列比較 */
function wa_cmp_(a, b) {
  a = String(a); b = String(b);
  try { return a.localeCompare(b, 'ja'); } catch (e) { return a < b ? -1 : (a > b ? 1 : 0); }
}
