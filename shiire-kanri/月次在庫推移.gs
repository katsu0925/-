// 月次在庫推移.gs
// =====================================================
// 月次在庫推移シートの計算をGASで実行し、値を書き込む
// スプレッドシートID: 1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo
// =====================================================

/**
 * 「月次在庫推移」シートを更新する
 * A〜Q列: 既存の在庫推移（期首在庫、仕入、売上、利益、在庫回転率など）
 * R〜T列: EC管理データ（EC商品代金合計、EC手数料合計、EC入金額合計）
 *
 * EC管理シート列: A=番号, B=注文キー, C=チャンネル, D=販売日, E=商品代金,
 *   F=客負担送料, G=売上, H=手数料, I=店負担送料, J=入金額, K=伝票番号, L=メモ
 */
function updateMonthlyInventoryTrend() {
  var ss = SpreadsheetApp.openById('1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');

  // --- シート取得 ---
  var sheetMain       = ss.getSheetByName('月次在庫推移');
  var sheetTanaoroshi = ss.getSheetByName('期末棚卸サマリー');
  var sheetShiire     = ss.getSheetByName('仕入れ管理');
  var sheetShohin     = ss.getSheetByName('商品管理');
  var sheetEc         = ss.getSheetByName('EC管理');

  if (!sheetMain)       throw new Error('月次在庫推移シートが見つかりません');
  if (!sheetTanaoroshi) throw new Error('期末棚卸サマリーシートが見つかりません');
  if (!sheetShiire)     throw new Error('仕入れ管理シートが見つかりません');
  if (!sheetShohin)     throw new Error('商品管理シートが見つかりません');

  // --- 参照データ読み込み ---
  // 期末棚卸サマリー: A列(年月), B列(期首在庫金額)
  var tanaData  = sheetTanaoroshi.getRange('A2:B').getValues();
  // 仕入れ管理: B列(日付), D列(仕入額), E列(運賃), F列(点数)
  var shiireB   = sheetShiire.getRange('B2:B').getValues().flat();
  var shiireD   = sheetShiire.getRange('D2:D').getValues().flat();
  var shiireE   = sheetShiire.getRange('E2:E').getValues().flat();
  var shiireF   = sheetShiire.getRange('F2:F').getValues().flat();
  // 商品管理: AP列(販売日), AU列(売上額), AO列(原価額)
  var shohinAP  = sheetShohin.getRange('AP2:AP').getValues().flat();
  var shohinAU  = sheetShohin.getRange('AU2:AU').getValues().flat();
  var shohinAO  = sheetShohin.getRange('AO2:AO').getValues().flat();

  // --- EC管理データ読み込み ---
  // D列(販売日), E列(商品代金), H列(手数料), J列(入金額)
  var ecData = { dateYM: [], productPrice: [], fee: [], deposit: [] };
  if (sheetEc) {
    var ecLastRow = sheetEc.getLastRow();
    if (ecLastRow >= 2) {
      var ecDates        = sheetEc.getRange('D2:D' + ecLastRow).getValues().flat();
      var ecProductPrice = sheetEc.getRange('E2:E' + ecLastRow).getValues().flat();
      var ecFee          = sheetEc.getRange('H2:H' + ecLastRow).getValues().flat();
      var ecDeposit      = sheetEc.getRange('J2:J' + ecLastRow).getValues().flat();
      ecData.dateYM      = ecDates.map(function(v) { return toYM_(v); });
      ecData.productPrice = ecProductPrice;
      ecData.fee         = ecFee;
      ecData.deposit     = ecDeposit;
    }
  }

  // --- 仕入れ管理の日付を "yyyy/MM" に変換してキャッシュ ---
  var shiireBYM = shiireB.map(function(v) { return toYM_(v); });
  // --- 商品管理の販売日を "yyyy/MM" に変換してキャッシュ ---
  var shohinAPYM = shohinAP.map(function(v) { return toYM_(v); });

  // --- 期末棚卸サマリーをMap化 {年月 → B列値} ---
  var tanaMap = {};
  for (var t = 0; t < tanaData.length; t++) {
    var key = tanaData[t][0];
    if (key === '' || key == null) continue;
    var keyStr = (key instanceof Date) ? toYM_(key) : String(key);
    tanaMap[keyStr] = Number(tanaData[t][1]) || 0;
  }

  // --- A列: 年月リスト（期末棚卸サマリーのA列から空でないものを最大299行） ---
  var yearMonthList = [];
  for (var i = 0; i < tanaData.length && yearMonthList.length < 299; i++) {
    var val = tanaData[i][0];
    if (val !== '' && val != null) {
      yearMonthList.push(val);
    }
  }

  // 計算結果を98行分
  var maxRows = Math.min(yearMonthList.length, 98);
  var result = [];

  for (var r = 0; r < maxRows; r++) {
    var ym = yearMonthList[r];
    var ymStr = (ym instanceof Date) ? toYM_(ym) : String(ym);

    // --- B列: 期首在庫金額 = 前月の期末棚卸サマリーB列 ---
    var colB = 0;
    try {
      var dateVal = new Date(ymStr + '/01');
      var prevDate = edate_(dateVal, -1);
      var prevYM = toYM_(prevDate);
      colB = (tanaMap[prevYM] != null) ? tanaMap[prevYM] : 0;
    } catch (e) { colB = 0; }

    // --- C列: 当月仕入額 = SUMIF(仕入れ管理B列, 年月, D列) ---
    var colC = 0;
    for (var i1 = 0; i1 < shiireBYM.length; i1++) {
      if (shiireBYM[i1] === ymStr) colC += (Number(shiireD[i1]) || 0);
    }

    // --- D列: 当月仕入れ点数 = SUMIF(仕入れ管理B列, 年月, F列) ---
    var colD = 0;
    for (var i2 = 0; i2 < shiireBYM.length; i2++) {
      if (shiireBYM[i2] === ymStr) colD += (Number(shiireF[i2]) || 0);
    }

    // --- E列: 仕入運賃 = SUMIF(仕入れ管理B列, 年月, E列) ---
    var colE = 0;
    for (var i3 = 0; i3 < shiireBYM.length; i3++) {
      if (shiireBYM[i3] === ymStr) colE += (Number(shiireE[i3]) || 0);
    }

    // --- F列: 純仕入額 = C + E ---
    var colF = colC + colE;

    // --- G列: 当月販売数 = COUNTIF(商品管理AP列, 年月) ---
    var colG = 0;
    for (var i4 = 0; i4 < shohinAPYM.length; i4++) {
      if (shohinAPYM[i4] === ymStr) colG++;
    }

    // --- H列: 当月売上額 = SUMIF(商品管理AP列, 年月, AU列) ---
    var colH = 0;
    for (var i5 = 0; i5 < shohinAPYM.length; i5++) {
      if (shohinAPYM[i5] === ymStr) colH += (Number(shohinAU[i5]) || 0);
    }

    // --- I列: 当月原価額 = SUMIF(商品管理AP列, 年月, AO列) ---
    var colI = 0;
    for (var i6 = 0; i6 < shohinAPYM.length; i6++) {
      if (shohinAPYM[i6] === ymStr) colI += (Number(shohinAO[i6]) || 0);
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

    // --- R列: EC商品代金合計 = SUMIF(EC管理 販売日, 年月, 商品代金) ---
    var colR = 0;
    for (var e1 = 0; e1 < ecData.dateYM.length; e1++) {
      if (ecData.dateYM[e1] === ymStr) colR += (Number(ecData.productPrice[e1]) || 0);
    }

    // --- S列: EC手数料合計 = SUMIF(EC管理 販売日, 年月, 手数料) ---
    var colS = 0;
    for (var e2 = 0; e2 < ecData.dateYM.length; e2++) {
      if (ecData.dateYM[e2] === ymStr) colS += (Number(ecData.fee[e2]) || 0);
    }

    // --- T列: EC入金額合計 = SUMIF(EC管理 販売日, 年月, 入金額) ---
    var colT = 0;
    for (var e3 = 0; e3 < ecData.dateYM.length; e3++) {
      if (ecData.dateYM[e3] === ymStr) colT += (Number(ecData.deposit[e3]) || 0);
    }

    result.push([ym, colB, colC, colD, colE, colF, colG, colH, colI, colJ, colK, colL, colM, colN, colO, colP, colQ, colR, colS, colT]);
  }

  // --- 結果をシートに書き込み (A〜T = 20列) ---
  if (result.length > 0) {
    sheetMain.getRange(3, 1, result.length, 20).setValues(result);
  }

  Logger.log('月次在庫推移を更新しました: ' + result.length + '行 (EC管理含む)');
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
