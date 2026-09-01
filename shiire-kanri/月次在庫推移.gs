// 月次在庫推移.gs
// =====================================================
// 月次在庫推移シートの計算をGASで実行し、値を書き込む
// スプレッドシートID: 1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo
// =====================================================

/**
 * 「月次在庫推移」シートを更新する
 * A〜Q列: 在庫推移（期首在庫、仕入、売上、利益、在庫回転率など）
 *
 * データソース:
 *   商品管理 — AP列(販売日), AR列(売上額), AO列(原価額) ※AU列は粗利なので使わない
 *   EC管理   — D列(販売日), G列(売上)
 *   売却履歴 — A列(売却日), E列(仕入れ値)
 *
 * 合算ルール:
 *   H列(当月売上額)  = 商品管理売上 + EC管理売上(G列)
 *   I列(当月原価額)  = 商品管理原価 + 売却履歴仕入れ値(E列)
 *   J列(売上総利益)  = H - I
 */
function updateMonthlyInventoryTrend() {
  var ss = SpreadsheetApp.openById('1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');

  // --- シート取得 ---
  var sheetMain       = ss.getSheetByName('月次在庫推移');
  var sheetTanaoroshi = ss.getSheetByName('期末棚卸サマリー');
  var sheetShiire     = ss.getSheetByName('仕入れ管理');
  var sheetShohin     = ss.getSheetByName('商品管理');
  var sheetEc         = ss.getSheetByName('EC管理');
  var sheetBaiky      = ss.getSheetByName('売却履歴');

  if (!sheetMain)       throw new Error('月次在庫推移シートが見つかりません');
  if (!sheetTanaoroshi) throw new Error('期末棚卸サマリーシートが見つかりません');
  if (!sheetShiire)     throw new Error('仕入れ管理シートが見つかりません');
  if (!sheetShohin)     throw new Error('商品管理シートが見つかりません');

  // --- 棚卸明細の理論在庫(C列)を最新の出庫状況で引き直す ---
  // これを先に走らせないと、行が作られた月の数字のまま固定された棚卸数で集計されてしまう
  try { recomputeComputedColumns(); } catch (e) { Logger.log('recomputeComputedColumns 失敗: ' + e); }

  // --- 期末棚卸サマリーを棚卸明細から再生成（手入力の転記漏れ・誤転記を防ぐ） ---
  rebuildTanaoroshiSummary_(ss);

  // --- 参照データ読み込み ---
  // 期末棚卸サマリー: A列(年月), B列(期首在庫金額)
  var tanaData  = sheetTanaoroshi.getRange('A2:B').getValues();
  // 仕入れ管理: B列(日付), D列(仕入額), E列(運賃), F列(点数)
  var shiireB   = sheetShiire.getRange('B2:B').getValues().flat();
  var shiireD   = sheetShiire.getRange('D2:D').getValues().flat();
  var shiireE   = sheetShiire.getRange('E2:E').getValues().flat();
  var shiireF   = sheetShiire.getRange('F2:F').getValues().flat();
  // 商品管理: AP列(販売日), AR列(売上額), AO列(原価額) ※AU列は粗利なので使わない
  var shohinAP  = sheetShohin.getRange('AP2:AP').getValues().flat();
  var shohinAR  = sheetShohin.getRange('AR2:AR').getValues().flat();
  var shohinAO  = sheetShohin.getRange('AO2:AO').getValues().flat();

  // --- EC管理データ読み込み ---
  // D列(販売日), G列(売上)
  var ecDateYM = [], ecSales = [];
  if (sheetEc) {
    var ecLastRow = sheetEc.getLastRow();
    if (ecLastRow >= 2) {
      ecDateYM  = sheetEc.getRange('D2:D' + ecLastRow).getValues().flat().map(function(v) { return toYM_(v); });
      ecSales   = sheetEc.getRange('G2:G' + ecLastRow).getValues().flat();
    }
  }

  // --- 売却履歴データ読み込み ---
  // A列(売却日), E列(仕入れ値)
  var baikyDateYM = [], baikyCost = [];
  if (sheetBaiky) {
    var baikyLastRow = sheetBaiky.getLastRow();
    if (baikyLastRow >= 2) {
      baikyDateYM = sheetBaiky.getRange('A2:A' + baikyLastRow).getValues().flat().map(function(v) { return toYM_(v); });
      baikyCost   = sheetBaiky.getRange('E2:E' + baikyLastRow).getValues().flat();
    }
  }

  // --- 日付キャッシュ ---
  var shiireBYM  = shiireB.map(function(v) { return toYM_(v); });
  var shohinAPYM = shohinAP.map(function(v) { return toYM_(v); });

  // --- 期末棚卸サマリーをMap化 {年月 → B列値} ---
  var tanaMap = {};
  for (var t = 0; t < tanaData.length; t++) {
    var key = tanaData[t][0];
    if (key === '' || key == null) continue;
    var keyStr = (key instanceof Date) ? toYM_(key) : String(key);
    tanaMap[keyStr] = Number(tanaData[t][1]) || 0;
  }

  // --- A列: 年月リスト ---
  var yearMonthList = [];
  for (var i = 0; i < tanaData.length && yearMonthList.length < 299; i++) {
    var val = tanaData[i][0];
    if (val !== '' && val != null) {
      yearMonthList.push(val);
    }
  }

  var maxRows = Math.min(yearMonthList.length, 98);
  var result = [];

  for (var r = 0; r < maxRows; r++) {
    var ym = yearMonthList[r];
    var ymStr = (ym instanceof Date) ? toYM_(ym) : String(ym);

    // --- B列: 期首在庫金額 ---
    var colB = 0;
    try {
      var dateVal = new Date(ymStr + '/01');
      var prevDate = edate_(dateVal, -1);
      var prevYM = toYM_(prevDate);
      colB = (tanaMap[prevYM] != null) ? tanaMap[prevYM] : 0;
    } catch (e) { colB = 0; }

    // --- C列: 当月仕入額 ---
    var colC = 0;
    for (var i1 = 0; i1 < shiireBYM.length; i1++) {
      if (shiireBYM[i1] === ymStr) colC += (Number(shiireD[i1]) || 0);
    }

    // --- D列: 当月仕入れ点数 ---
    var colD = 0;
    for (var i2 = 0; i2 < shiireBYM.length; i2++) {
      if (shiireBYM[i2] === ymStr) colD += (Number(shiireF[i2]) || 0);
    }

    // --- E列: 仕入運賃 ---
    var colE = 0;
    for (var i3 = 0; i3 < shiireBYM.length; i3++) {
      if (shiireBYM[i3] === ymStr) colE += (Number(shiireE[i3]) || 0);
    }

    // --- F列: 純仕入額 = C + E ---
    var colF = colC + colE;

    // --- G列: 当月販売数 ---
    var colG = 0;
    for (var i4 = 0; i4 < shohinAPYM.length; i4++) {
      if (shohinAPYM[i4] === ymStr) colG++;
    }

    // --- H列: 当月売上額 = 商品管理売上 + EC管理売上 ---
    var colH = 0;
    for (var i5 = 0; i5 < shohinAPYM.length; i5++) {
      if (shohinAPYM[i5] === ymStr) colH += (Number(shohinAR[i5]) || 0);
    }
    for (var e1 = 0; e1 < ecDateYM.length; e1++) {
      if (ecDateYM[e1] === ymStr) colH += (Number(ecSales[e1]) || 0);
    }

    // --- I列: 当月原価額 = 商品管理原価 + 売却履歴仕入れ値 ---
    var colI = 0;
    for (var i6 = 0; i6 < shohinAPYM.length; i6++) {
      if (shohinAPYM[i6] === ymStr) colI += (Number(shohinAO[i6]) || 0);
    }
    for (var b1 = 0; b1 < baikyDateYM.length; b1++) {
      if (baikyDateYM[b1] === ymStr) colI += (Number(baikyCost[b1]) || 0);
    }

    // --- J列: 売上総利益 = H - I ---
    var colJ = colH - colI;

    // --- K列: 売上総利益率 = J / H ---
    var colK = (colH !== 0) ? colJ / colH : 0;

    // --- L列: 期末在庫金額 = B + F - I ---
    var colL = colB + colF - colI;

    // --- M列: 在庫増減額 = L - B ---
    var colM = colL - colB;

    // --- N列: 在庫増減率 = M / B ---
    var colN = (colB !== 0) ? colM / colB : 0;

    // --- O列: 在庫回転率 = I / ((B + L) / 2) ---
    var avgInv = (colB + colL) / 2;
    var colO = (avgInv !== 0) ? colI / avgInv : 0;

    // --- P列: 消費税(売上) = ROUND(H / 11) ---
    var colP = Math.round(colH / 11);

    // --- Q列: 消費税(仕入) = ROUND(F * 0.1) ---
    var colQ = Math.round(colF * 0.1);

    result.push([ym, colB, colC, colD, colE, colF, colG, colH, colI, colJ, colK, colL, colM, colN, colO, colP, colQ]);
  }

  // --- A〜Q列(17列)を書き込み ---
  if (result.length > 0) {
    sheetMain.getRange(3, 1, result.length, 17).setValues(result);
  }

  Logger.log('月次在庫推移を更新しました: ' + result.length + '行 (EC管理・売却履歴含む)');
}

// =====================================================
// 期末棚卸サマリーの自動生成
// =====================================================

/**
 * 「期末棚卸サマリー」を「棚卸明細」から再生成する
 *
 * 棚卸明細   : 3行目以降 A列(棚卸し日) D列(実地棚卸数) G列(棚卸金額)
 * 生成先     : 期末棚卸サマリー 2行目以降 A列(年月 "yyyy/MM") B列(期末在庫金額)
 *
 * 従来このシートは完全手入力で、転記が止まると月次在庫推移の行そのものが
 * 増えなくなる（行数はA列の年月リスト分しか作られないため）。さらに集計途中の
 * 値を転記してしまう誤りも起きていたので、棚卸明細から機械的に作り直す。
 *
 * 実地棚卸数(D列)が1行でも未入力の月は「棚卸し中」とみなして出力しない。
 * これにより集計途中の過少な金額がサマリーに載ることを防ぐ。
 *
 * @param {Spreadsheet} ss
 * @returns {{written:number, skipped:string[]}|null}
 */
function rebuildTanaoroshiSummary_(ss) {
  var shStock = ss.getSheetByName('棚卸明細');
  var shSum   = ss.getSheetByName('期末棚卸サマリー');
  if (!shStock || !shSum) return null;

  var lastRow = shStock.getLastRow();
  if (lastRow < 3) return null;

  // A〜G列を一括読み込み（3行目がデータ開始行）
  var vals = shStock.getRange(3, 1, lastRow - 2, 7).getValues();

  // 年月ごとに集計 {年月: {sum:棚卸金額合計, rows:行数, filled:実地棚卸数の入力済み行数}}
  // 同じ年月に同じ仕入れIDが2行ある場合は先勝ちで2行目以降を無視する
  //（2026/02/28 に実際に1件発生し、その月だけ666点・¥76,590 が二重計上されていた）
  var blocks = {}, seenIds = {}, dupRows = [];
  for (var i = 0; i < vals.length; i++) {
    var d = vals[i][0];
    if (!(d instanceof Date) || isNaN(d.getTime())) continue;
    var ym = toYM_(d);
    if (!ym) continue;
    var pid = String(vals[i][1] || '').trim(); // B列: 仕入れID
    if (pid) {
      var dupKey = ym + '\u0000' + pid;
      if (seenIds[dupKey]) { dupRows.push(ym + ' ' + pid + '(行' + (i + 3) + ')'); continue; }
      seenIds[dupKey] = true;
    }
    if (!blocks[ym]) blocks[ym] = { sum: 0, rows: 0, filled: 0 };
    blocks[ym].rows++;
    var actual = vals[i][3]; // D列: 実地棚卸数
    if (actual !== '' && actual != null) blocks[ym].filled++;
    blocks[ym].sum += (Number(vals[i][6]) || 0); // G列: 棚卸金額
  }

  var ymKeys = Object.keys(blocks).sort();
  var rows = [], skipped = [];
  for (var k = 0; k < ymKeys.length; k++) {
    var b = blocks[ymKeys[k]];
    if (b.filled < b.rows) { skipped.push(ymKeys[k] + '(' + b.filled + '/' + b.rows + ')'); continue; }
    rows.push([ymKeys[k], b.sum]);
  }
  if (rows.length === 0) return null;

  var sumLastRow = shSum.getLastRow();
  if (sumLastRow >= 2) shSum.getRange(2, 1, sumLastRow - 1, 2).clearContent();
  // A列は "yyyy/MM" の文字列として保持する（日付に自動変換されるとキーが崩れる）
  shSum.getRange(2, 1, rows.length, 1).setNumberFormat('@');
  shSum.getRange(2, 1, rows.length, 2).setValues(rows);

  Logger.log('期末棚卸サマリーを再生成: ' + rows.length + '行'
    + (skipped.length ? ' / 棚卸し中のため除外: ' + skipped.join(', ') : '')
    + (dupRows.length ? ' / 重複行を無視: ' + dupRows.join(', ') : ''));
  return { written: rows.length, skipped: skipped, duplicates: dupRows };
}

// =====================================================
// ヘルパー関数
// =====================================================

/**
 * 日付 → "yyyy/MM" 文字列に変換
 * @param {*} date
 * @returns {string}
 */
function toYM_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  return y + '/' + m;
}

/**
 * EDATE相当（nか月前/後の日付）
 * @param {Date} date
 * @param {number} months
 * @returns {Date|null}
 */
function edate_(date, months) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  var d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
