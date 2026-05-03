// 月次レポート生成.gs — 商品管理＋依頼管理データからHTML月次分析レポートを生成
// Google Drive に保存し、分析アドバイスシートにリンクを記録する

// ──────────────────────────────────────────────
// ヘルパー関数
// ──────────────────────────────────────────────

/**
 * ¥2,112 → 2112 のように円表記をパース
 */
function cleanYen(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  var s = String(val).replace(/¥/g, '').replace(/,/g, '').replace(/\s/g, '').replace(/　/g, '');
  if (s === '' || s === '-') return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * 12% → 12 のようにパーセント表記をパース
 */
function cleanPct(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  var s = String(val).replace(/%/g, '').replace(/\s/g, '');
  if (s === '' || s === '-') return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * 日付をパース（Date, 文字列, 数値シリアルに対応）
 */
function mReportParseDate(val) {
  if (val == null || String(val).trim() === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    // Sheets serial date
    var d = new Date((val - 25569) * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }
  var s = String(val).trim();
  // Try common formats
  var patterns = [
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (m) {
      var dt = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
                        m[4] ? parseInt(m[4]) : 0, m[5] ? parseInt(m[5]) : 0, m[6] ? parseInt(m[6]) : 0);
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  var fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * 数値を ¥1,234 形式にフォーマット
 */
function fmtYen(val) {
  if (val == null || isNaN(val)) return '¥0';
  var v = Math.round(val);
  if (v < 0) return '-¥' + Math.abs(v).toLocaleString('ja-JP');
  return '¥' + v.toLocaleString('ja-JP');
}

/**
 * 数値を 12.3% 形式にフォーマット
 */
function fmtPct(val) {
  if (val == null || isNaN(val)) return '0.0%';
  return val.toFixed(1) + '%';
}

/**
 * 前月比変化バッジHTML
 */
function momChangeHtml(current, previous, isPct) {
  if (previous === 0) {
    if (current > 0) return '<span style="color:var(--accent-green);font-size:0.8em;margin-left:6px;">NEW</span>';
    return '';
  }
  if (isPct) {
    var diff = current - previous;
    var sign = diff >= 0 ? '+' : '';
    var color = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    return '<span style="color:' + color + ';font-size:0.8em;margin-left:6px;">' + sign + diff.toFixed(1) + 'pt</span>';
  }
  var change = ((current - previous) / Math.abs(previous)) * 100;
  var sign2 = change >= 0 ? '+' : '';
  var color2 = change >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  return '<span style="color:' + color2 + ';font-size:0.8em;margin-left:6px;">' + sign2 + change.toFixed(1) + '%</span>';
}

// ──────────────────────────────────────────────
// データ読み込みヘルパー
// ──────────────────────────────────────────────

/**
 * ヘッダー行から列名→インデックスのマップを作成
 */
function buildColumnMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim();
    if (name) map[name] = i;
  }
  return map;
}

/**
 * 行データから指定列の値を取得
 */
function getCol_(row, colMap, colName, defaultVal) {
  var idx = colMap[colName];
  if (idx == null) return defaultVal !== undefined ? defaultVal : null;
  var val = row[idx];
  return (val != null) ? val : (defaultVal !== undefined ? defaultVal : null);
}

/**
 * YYYY-MM形式の月キーを取得
 */
function monthKey_(date) {
  if (!date) return null;
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
}

// ──────────────────────────────────────────────
// データ読み込み
// ──────────────────────────────────────────────

/**
 * 商品管理シートからデータを読み込み
 */
function loadProductData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('商品管理');
  if (!sheet) throw new Error('商品管理シートが見つかりません');

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var colMap = buildColumnMap_(headers);

  var records = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = String(getCol_(row, colMap, 'ステータス', '')).trim();
    if (!status) continue;

    records.push({
      ステータス: status,
      販売場所: String(getCol_(row, colMap, '販売場所', '')).trim(),
      区分コード: String(getCol_(row, colMap, '区分コード', '')).trim(),
      カテゴリ2: String(getCol_(row, colMap, 'カテゴリ2', '')).trim(),
      ブランド: String(getCol_(row, colMap, 'ブランド', '')).trim(),
      仕入れ値: cleanYen(getCol_(row, colMap, '仕入れ値', 0)),
      販売価格: cleanYen(getCol_(row, colMap, '販売価格', 0)),
      利益: cleanYen(getCol_(row, colMap, '利益', 0)),
      利益率: cleanPct(getCol_(row, colMap, '利益率', 0)),
      販売日: mReportParseDate(getCol_(row, colMap, '販売日', null)),
      仕入れ日: mReportParseDate(getCol_(row, colMap, '仕入れ日', null)),
      在庫日数: (function() {
        var v = getCol_(row, colMap, '在庫日数', null);
        if (v == null || v === '') return null;
        var n = parseFloat(v);
        return isNaN(n) ? null : n;
      })()
    });
  }
  return records;
}

/**
 * 依頼管理シートからデータを読み込み（saisun-listスプレッドシート）
 */
function loadOrderData_() {
  // EC管理自動反映.gsと同じソーススプレッドシートID（採寸付商品リストVer.2）
  var saisunId = '';
  try {
    saisunId = PropertiesService.getScriptProperties().getProperty('SAISUN_LIST_SPREADSHEET_ID')
            || PropertiesService.getScriptProperties().getProperty('EC_SYNC_SRC_SPREADSHEET_ID')
            || '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc';
  } catch (e) {
    saisunId = '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc';
  }

  var ss = SpreadsheetApp.openById(saisunId);
  var sheet = ss.getSheetByName('依頼管理');
  if (!sheet) throw new Error('依頼管理シートが見つかりません（スプレッドシートID: ' + saisunId + '）');

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var colMap = buildColumnMap_(headers);

  var records = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = String(getCol_(row, colMap, 'ステータス', '')).trim();
    if (!status) continue;

    var 合計金額 = cleanYen(getCol_(row, colMap, '合計金額', 0));
    var 送料客負担 = cleanYen(getCol_(row, colMap, '送料(客負担)', 0));
    var 送料店負担 = cleanYen(getCol_(row, colMap, '送料(店負担)', 0));
    var 作業報酬 = cleanYen(getCol_(row, colMap, '作業報酬', 0));
    var 確認リンク = String(getCol_(row, colMap, '確認リンク', '')).trim();
    var 依頼日時 = mReportParseDate(getCol_(row, colMap, '依頼日時', null));

    // 注文タイプ判定
    var 注文タイプ = 'アソート';
    if (確認リンク && 確認リンク !== '' && 確認リンク !== '..' && 確認リンク.indexOf('http') !== -1) {
      注文タイプ = '個別選択';
    }

    // 卸売計算
    var 売上 = 合計金額 + 送料客負担;
    var 決済手数料 = 売上 * 0.016;
    var コスト = 送料店負担 + 作業報酬 + 決済手数料;
    var 利益 = 売上 - コスト;

    var 合計点数 = 0;
    if (colMap['合計点数'] != null) {
      var pts = getCol_(row, colMap, '合計点数', 0);
      合計点数 = parseInt(pts) || 0;
    }

    records.push({
      ステータス: status,
      確認リンク: 確認リンク,
      合計金額: 合計金額,
      '送料(店負担)': 送料店負担,
      '送料(客負担)': 送料客負担,
      作業報酬: 作業報酬,
      依頼日時: 依頼日時,
      注文タイプ: 注文タイプ,
      売上: 売上,
      決済手数料: 決済手数料,
      コスト: コスト,
      利益: 利益,
      月: monthKey_(依頼日時),
      合計点数: 合計点数
    });
  }
  return records;
}

// ──────────────────────────────────────────────
// 分析関数
// ──────────────────────────────────────────────

function analyzeMercari_(products) {
  var sold = [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p.ステータス === '売却済み' && p.販売場所 !== '') {
      p.月 = monthKey_(p.販売日);
      sold.push(p);
    }
  }
  return sold;
}

function analyzeInventory_(products) {
  var inv = [];
  var statuses = ['出品中', '出品待ち', '撮影待ち'];
  for (var i = 0; i < products.length; i++) {
    if (statuses.indexOf(products[i].ステータス) !== -1) {
      inv.push(products[i]);
    }
  }
  return inv;
}

function analyzeLosses_(products) {
  var returned = [], disposed = [];
  for (var i = 0; i < products.length; i++) {
    if (products[i].ステータス === '返品済み') returned.push(products[i]);
    else if (products[i].ステータス === '廃棄済み') disposed.push(products[i]);
  }
  return { returned: returned, disposed: disposed };
}

// ──────────────────────────────────────────────
// チャート＆テーブルデータ生成
// ──────────────────────────────────────────────

function monthlyProfitData_(mercariSold, ordersCompleted) {
  var monthsSet = {};
  var mercMonthly = {}, wsIndMonthly = {}, wsAssMonthly = {};

  for (var i = 0; i < mercariSold.length; i++) {
    var m = mercariSold[i].月;
    if (!m) continue;
    monthsSet[m] = true;
    mercMonthly[m] = (mercMonthly[m] || 0) + mercariSold[i].利益;
  }

  for (var i = 0; i < ordersCompleted.length; i++) {
    var m = ordersCompleted[i].月;
    if (!m) continue;
    monthsSet[m] = true;
    if (ordersCompleted[i].注文タイプ === '個別選択') {
      wsIndMonthly[m] = (wsIndMonthly[m] || 0) + ordersCompleted[i].利益;
    } else {
      wsAssMonthly[m] = (wsAssMonthly[m] || 0) + ordersCompleted[i].利益;
    }
  }

  var months = Object.keys(monthsSet).sort();
  return {
    labels: months,
    mercari: months.map(function(m) { return mercMonthly[m] || 0; }),
    ws_individual: months.map(function(m) { return wsIndMonthly[m] || 0; }),
    ws_assort: months.map(function(m) { return wsAssMonthly[m] || 0; })
  };
}

function classificationPerformance_(mercariSold) {
  if (mercariSold.length === 0) return [];
  var groups = {};
  for (var i = 0; i < mercariSold.length; i++) {
    var code = mercariSold[i].区分コード;
    if (!code) continue;
    if (!groups[code]) groups[code] = { 件数: 0, 販売価格合計: 0, 利益合計: 0, 赤字件数: 0 };
    groups[code].件数++;
    groups[code].販売価格合計 += mercariSold[i].販売価格;
    groups[code].利益合計 += mercariSold[i].利益;
    if (mercariSold[i].利益 < 0) groups[code].赤字件数++;
  }
  var result = [];
  for (var code in groups) {
    var g = groups[code];
    result.push({
      区分コード: code,
      件数: g.件数,
      平均販売価格: g.販売価格合計 / g.件数,
      平均利益: g.利益合計 / g.件数,
      合計利益: g.利益合計,
      赤字件数: g.赤字件数,
      赤字率: Math.round((g.赤字件数 / g.件数) * 1000) / 10
    });
  }
  result.sort(function(a, b) { return b.件数 - a.件数; });
  return result;
}

function categoryAnalysis_(mercariSold, topN) {
  topN = topN || 8;
  if (mercariSold.length === 0) return [];
  var groups = {};
  for (var i = 0; i < mercariSold.length; i++) {
    var cat = mercariSold[i].カテゴリ2;
    if (!cat) continue;
    if (!groups[cat]) groups[cat] = { 件数: 0, 利益合計: 0 };
    groups[cat].件数++;
    groups[cat].利益合計 += mercariSold[i].利益;
  }
  var result = [];
  for (var cat in groups) {
    var g = groups[cat];
    result.push({
      カテゴリ2: cat,
      件数: g.件数,
      合計利益: g.利益合計,
      平均利益: g.利益合計 / g.件数
    });
  }
  result.sort(function(a, b) { return b.合計利益 - a.合計利益; });
  return result.slice(0, topN);
}

function inventoryAgeDistribution_(inventory) {
  var dist = { '0-14': 0, '15-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (var i = 0; i < inventory.length; i++) {
    var d = inventory[i].在庫日数;
    if (d == null) continue;
    if (d <= 14) dist['0-14']++;
    else if (d <= 30) dist['15-30']++;
    else if (d <= 60) dist['31-60']++;
    else if (d <= 90) dist['61-90']++;
    else dist['90+']++;
  }
  return dist;
}

function wholesaleComparison_(ordersCompleted) {
  var result = {};
  var types = ['個別選択', 'アソート'];
  for (var t = 0; t < types.length; t++) {
    var typ = types[t];
    var sub = ordersCompleted.filter(function(o) { return o.注文タイプ === typ; });
    var 売上合計 = 0, 送料店負担合計 = 0, 作業報酬合計 = 0, 決済手数料合計 = 0, 利益合計 = 0;
    for (var i = 0; i < sub.length; i++) {
      売上合計 += sub[i].売上;
      送料店負担合計 += sub[i]['送料(店負担)'];
      作業報酬合計 += sub[i].作業報酬;
      決済手数料合計 += sub[i].決済手数料;
      利益合計 += sub[i].利益;
    }
    result[typ] = {
      件数: sub.length,
      売上: 売上合計,
      送料_店負担: 送料店負担合計,
      作業報酬: 作業報酬合計,
      決済手数料: 決済手数料合計,
      利益: 利益合計,
      利益率: 売上合計 > 0 ? (利益合計 / 売上合計 * 100) : 0,
      送料比率: 売上合計 > 0 ? (送料店負担合計 / 売上合計 * 100) : 0
    };
  }
  return result;
}

function wholesaleMonthlyTrend_(ordersCompleted) {
  var monthsSet = {};
  var indData = {}, assData = {};
  for (var i = 0; i < ordersCompleted.length; i++) {
    var m = ordersCompleted[i].月;
    if (!m) continue;
    monthsSet[m] = true;
    var target = ordersCompleted[i].注文タイプ === '個別選択' ? indData : assData;
    if (!target[m]) target[m] = { 売上: 0, 利益: 0, 件数: 0 };
    target[m].売上 += ordersCompleted[i].売上;
    target[m].利益 += ordersCompleted[i].利益;
    target[m].件数++;
  }
  var months = Object.keys(monthsSet).sort();
  return { months: months, indData: indData, assData: assData };
}

function monthlyChannelStats_(mercariSold, ordersCompleted, targetMonth) {
  var mMonth = mercariSold.filter(function(r) { return r.月 === targetMonth; });
  var wMonth = ordersCompleted.filter(function(r) { return r.月 === targetMonth; });
  var wInd = wMonth.filter(function(r) { return r.注文タイプ === '個別選択'; });
  var wAss = wMonth.filter(function(r) { return r.注文タイプ === 'アソート'; });

  return {
    merc_count: mMonth.length,
    merc_revenue: sumField_(mMonth, '販売価格'),
    merc_profit: sumField_(mMonth, '利益'),
    ws_count: wMonth.length,
    ws_revenue: sumField_(wMonth, '売上'),
    ws_profit: sumField_(wMonth, '利益'),
    ws_ind_count: wInd.length,
    ws_ind_profit: sumField_(wInd, '利益'),
    ws_ass_count: wAss.length,
    ws_ass_profit: sumField_(wAss, '利益')
  };
}

function sumField_(arr, field) {
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += (arr[i][field] || 0);
  return s;
}

// ──────────────────────────────────────────────
// アドバイス生成
// ──────────────────────────────────────────────

function generateAdvice_(mercariSold, ordersCompleted, inventory, returned, disposed, cur, prev, currentMonth, prevMonth) {
  var advice = [];
  var clf = classificationPerformance_(mercariSold);
  var wsComp = wholesaleComparison_(ordersCompleted);
  var cats = categoryAnalysis_(mercariSold, 8);

  // 1. 区分コード別の赤字リスク分析
  if (clf.length > 0) {
    var highRisk = clf.filter(function(r) { return r.件数 >= 5 && r.赤字率 > 10; });
    if (highRisk.length > 0) {
      var lines = [];
      for (var i = 0; i < highRisk.length; i++) {
        var r = highRisk[i];
        lines.push('<b>' + r.区分コード + 'ランク</b>: 赤字率' + r.赤字率.toFixed(1) + '%'
          + '（' + r.赤字件数 + '/' + r.件数 + '件）、平均販売価格' + fmtYen(r.平均販売価格));
      }
      var best = clf.filter(function(r) { return r.件数 >= 30; }).sort(function(a, b) { return a.赤字率 - b.赤字率; });
      var bestNote = '';
      if (best.length > 0) {
        var b = best[0];
        bestNote = ' 一方、<b>' + b.区分コード + 'ランク</b>は' + b.件数 + '件で赤字率' + b.赤字率.toFixed(1) + '%と最も安定しており、'
          + '仕入れ基準のモデルケースです。';
      }
      advice.push({
        title: '赤字率の高い区分コードへの対策',
        body: lines.join('・') + '。<br>'
          + '高単価ランクは仕入れ値が高いためハズレ時の損失が大きい。'
          + '販売価格を仕入れ値の2倍以上に設定できないものは仕入れ時点でスキップするか、'
          + '卸売の個別選択に回して原価¥0で利益確定する方が効率的です。' + bestNote
      });
    }

    // 利益の大黒柱
    var top2 = clf.sort(function(a, b) { return b.合計利益 - a.合計利益; }).slice(0, 2);
    if (top2.length >= 2) {
      var t1 = top2[0], t2 = top2[1];
      var totalMercProfit = sumField_(mercariSold, '利益');
      var share = totalMercProfit > 0 ? ((t1.合計利益 + t2.合計利益) / totalMercProfit * 100) : 0;
      advice.push({
        title: t1.区分コード + '・' + t2.区分コード + 'ランクが利益の大黒柱',
        body: '<b>' + t1.区分コード + '</b>: ' + t1.件数 + '件 × ' + fmtYen(t1.平均利益) + ' = ' + fmtYen(t1.合計利益) + '（赤字率' + t1.赤字率.toFixed(1) + '%）<br>'
          + '<b>' + t2.区分コード + '</b>: ' + t2.件数 + '件 × ' + fmtYen(t2.平均利益) + ' = ' + fmtYen(t2.合計利益) + '（赤字率' + t2.赤字率.toFixed(1) + '%）<br>'
          + '合計でメルカリ利益の<b>' + share.toFixed(1) + '%</b>を占めます。'
          + 'この2区分の仕入れ量を維持・拡大することが最も確実な利益確保策です。'
      });
    }
  }

  // 2. 卸売 個別選択の拡大戦略
  var wsInd = wsComp['個別選択'] || {};
  var wsAss = wsComp['アソート'] || {};
  if ((wsInd.件数 || 0) > 0 && (wsAss.件数 || 0) > 0) {
    var indRate = wsInd.利益率 || 0;
    var assRate = wsAss.利益率 || 0;
    var assShipPer = wsAss.件数 > 0 ? wsAss.送料_店負担 / wsAss.件数 : 0;
    var indShipPer = wsInd.件数 > 0 ? wsInd.送料_店負担 / wsInd.件数 : 0;
    advice.push({
      title: '個別選択の拡大が最優先戦略',
      body: '個別選択の利益率<b>' + indRate.toFixed(1) + '%</b>は全チャネルで最高。'
        + '1件あたり送料' + fmtYen(indShipPer) + 'に対し、アソートは' + fmtYen(assShipPer) + 'と'
        + '<b>' + fmtYen(assShipPer - indShipPer) + 'の差</b>があります。<br>'
        + '撮影・採寸データが充実するほど「自分で選びたい」顧客が増え、高粗利の個別選択比率が上がります。'
        + '補助金申請の「販路開拓」要件にも直結するストーリーです。'
    });
  }

  // 3. アソートの送料構造改善
  if ((wsAss.送料比率 || 0) > 30) {
    var assShipRatio = wsAss.送料比率;
    var assShipTotal = wsAss.送料_店負担;
    var assCount = wsAss.件数;
    advice.push({
      title: 'アソートの送料構造を改善',
      body: 'アソートの送料比率<b>' + assShipRatio.toFixed(1) + '%</b>（' + fmtYen(assShipTotal) + '/' + assCount + '件、'
        + '1件あたり' + fmtYen(assCount > 0 ? assShipTotal / assCount : 0) + '）は利益を圧迫しています。<br>'
        + '特に少量注文（¥500〜¥3,300）は送料に食われます。'
        + '最低注文額を¥5,000に引き上げるか、リピーターに個別選択への誘導を図ることで全体の収益効率が上がります。'
        + 'アソートは利益率' + (wsAss.利益率 || 0).toFixed(1) + '%で黒字ですが、集客チャネルとしての位置づけに留め、'
        + '利益は個別選択で稼ぐ構造にシフトすべきです。'
    });
  }

  // 4. カテゴリ別の深掘り
  if (cats.length >= 3) {
    var bestCat = cats[0];
    var niche = cats.filter(function(c) { return c.件数 >= 5 && c.件数 <= 30; })
      .sort(function(a, b) { return b.平均利益 - a.平均利益; });
    var nicheNote = '';
    if (niche.length > 0) {
      var n = niche[0];
      nicheNote = '<br>隠れた高利益カテゴリとして<b>「' + n.カテゴリ2 + '」</b>'
        + '（' + n.件数 + '件、平均利益' + fmtYen(n.平均利益) + '）が注目。'
        + bestCat.カテゴリ2 + 'の平均利益' + fmtYen(bestCat.平均利益) + 'の'
        + '<b>' + (bestCat.平均利益 !== 0 ? (n.平均利益 / bestCat.平均利益).toFixed(1) : '0') + '倍</b>。ニッチで競合が少ない可能性があります。';
    }
    var worstCat = cats.slice().sort(function(a, b) { return a.平均利益 - b.平均利益; })[0];
    advice.push({
      title: 'カテゴリ別の仕入れ最適化',
      body: '<b>「' + bestCat.カテゴリ2 + '」</b>が利益' + fmtYen(bestCat.合計利益)
        + '（' + bestCat.件数 + '件）で最も好調。同カテゴリの仕入れ強化を推奨します。'
        + nicheNote + '<br>'
        + '一方<b>「' + worstCat.カテゴリ2 + '」</b>は平均利益' + fmtYen(worstCat.平均利益) + 'と最低ライン。'
        + 'ブランド別に利益を分析し、利益の出るブランドに絞ることで改善可能です。'
    });
  }

  // 5. 在庫の滞留対策
  if (inventory.length > 0) {
    var old90 = inventory.filter(function(p) { return p.在庫日数 != null && p.在庫日数 > 90; });
    var old60 = inventory.filter(function(p) { return p.在庫日数 != null && p.在庫日数 > 60 && p.在庫日数 <= 90; });
    var new14 = inventory.filter(function(p) { return p.在庫日数 != null && p.在庫日数 <= 14; });
    var invTotal = inventory.length;
    if (old90.length > 0) {
      var old90Cost = sumField_(old90, '仕入れ値');
      var potentialRev = old90.length * 500;
      advice.push({
        title: '90日超の滞留在庫' + old90.length + '点の処理プラン',
        body: '仕入れ額' + fmtYen(old90Cost) + 'が滞留中。'
          + '卸売の個別選択に出品すれば原価¥0計算で1点¥500でも' + fmtYen(potentialRev) + 'の売上になります。'
          + '送料・手数料差し引いても<b>' + fmtYen(potentialRev * 0.7) + '以上の利益回収</b>が見込めます。<br>'
          + '61-90日の' + old60.length + '点には60日超で10-20%値下げルールを設定し、'
          + '75日超で卸売行きの自動判定を入れると在庫回転率が改善します。<br>'
          + '0-14日在庫' + new14.length + '点（' + (invTotal > 0 ? Math.round(new14.length / invTotal * 100) : 0) + '%）は健全で、出品サイクルは回っています。'
      });
    }
  }

  // 6. メルカリの月次トレンド警告
  if (cur && prev && prevMonth) {
    var mercChange = prev.merc_profit !== 0 ? ((cur.merc_profit - prev.merc_profit) / Math.abs(prev.merc_profit) * 100) : 0;
    var wsChange = prev.ws_profit !== 0 ? ((cur.ws_profit - prev.ws_profit) / Math.abs(prev.ws_profit) * 100) : 0;
    var totalCur = cur.merc_profit + cur.ws_profit;
    var totalPrev = prev.merc_profit + prev.ws_profit;
    var totalChange = totalPrev !== 0 ? ((totalCur - totalPrev) / Math.abs(totalPrev) * 100) : 0;

    if (mercChange < -10) {
      var wsOffset = '';
      if (cur.ws_profit > 0) {
        wsOffset = 'ただし卸売が' + fmtYen(cur.ws_profit) + '（前月比' + (wsChange >= 0 ? '+' : '') + Math.round(wsChange) + '%）で'
          + (totalChange >= -5 ? 'カバー' : '一部補填') + 'しており、'
          + '合計利益は' + fmtYen(totalCur) + '（前月比' + (totalChange >= 0 ? '+' : '') + totalChange.toFixed(1) + '%）です。';
      }
      advice.push({
        title: 'メルカリが前月比' + Math.round(mercChange) + '% — 要注意',
        body: 'メルカリ利益: ' + fmtYen(prev.merc_profit) + '（' + prevMonth + '）→ ' + fmtYen(cur.merc_profit) + '（' + currentMonth + '）、'
          + '件数も' + prev.merc_count + '件→' + cur.merc_count + '件に減少。<br>'
          + wsOffset + '<br>'
          + '出品中在庫の価格見直し（特に90日超の商品）と、'
          + '季節需要を見越した出品戦略の見直しが必要です。'
      });
    } else if (mercChange > 10) {
      advice.push({
        title: 'メルカリが前月比+' + Math.round(mercChange) + '%で好調',
        body: 'メルカリ利益: ' + fmtYen(prev.merc_profit) + '（' + prevMonth + '）→ ' + fmtYen(cur.merc_profit) + '（' + currentMonth + '）、'
          + '件数も' + prev.merc_count + '件→' + cur.merc_count + '件。<br>'
          + '好調な要因（季節性・価格帯・カテゴリ）を分析し、来月も維持できる施策を検討してください。'
      });
    }
  } else if (mercariSold.length > 0) {
    // fallback: ピーク比較
    var monthlyMap = {};
    for (var i = 0; i < mercariSold.length; i++) {
      var m = mercariSold[i].月;
      if (!m) continue;
      if (!monthlyMap[m]) monthlyMap[m] = { 件数: 0, 売上: 0, 利益: 0 };
      monthlyMap[m].件数++;
      monthlyMap[m].売上 += mercariSold[i].販売価格;
      monthlyMap[m].利益 += mercariSold[i].利益;
    }
    var monthKeys = Object.keys(monthlyMap).sort();
    if (monthKeys.length >= 3) {
      var peakMonth = monthKeys[0], peakProfit = monthlyMap[monthKeys[0]].利益;
      for (var i = 1; i < monthKeys.length; i++) {
        if (monthlyMap[monthKeys[i]].利益 > peakProfit) {
          peakMonth = monthKeys[i];
          peakProfit = monthlyMap[monthKeys[i]].利益;
        }
      }
      var latestMonth = monthKeys[monthKeys.length - 1];
      var latestProfit = monthlyMap[latestMonth].利益;
      if (latestProfit < peakProfit * 0.7) {
        var decline = (1 - latestProfit / peakProfit) * 100;
        advice.push({
          title: 'メルカリ利益の減速に要注意',
          body: 'ピーク月（' + peakMonth + '）から直近は<b>' + Math.round(decline) + '%減</b>。'
            + '価格見直しと季節商品の出品強化が必要です。'
        });
      }
    }
  }

  // 7. 返品の実態分析
  if (returned.length > 0) {
    var retCost = sumField_(returned, '仕入れ値');
    var totalProducts = mercariSold.length + returned.length + disposed.length + inventory.length;
    var retRate = totalProducts > 0 ? (returned.length / totalProducts * 100) : 0;
    advice.push({
      title: '返品' + returned.length + '件の実態を確認すべき',
      body: '返品' + returned.length + '件（仕入れ額' + fmtYen(retCost) + '、全商品の' + retRate.toFixed(1) + '%）が発生。<br>'
        + 'これが<b>仕入れ先への返品</b>（仕入れロットの中で使えない商品を返した）なのか、'
        + '<b>顧客からの返品</b>なのかで対策が全く異なります。<br>'
        + '仕入れ先返品の場合は仕入れ単価の交渉材料（「' + Math.round(retRate) + '%は使えない」）になります。'
        + '顧客返品の場合は商品説明・写真の品質改善とサイズ表記の明確化が急務です。'
    });
  }

  // 8. 補助金申請の数字根拠
  if (mercariSold.length > 0 && ordersCompleted.length > 0) {
    var totalRev = sumField_(mercariSold, '販売価格') + sumField_(ordersCompleted, '売上');
    var totalProf = sumField_(mercariSold, '利益') + sumField_(ordersCompleted, '利益');
    var totalRate = totalRev > 0 ? (totalProf / totalRev * 100) : 0;
    var wsTotalProfit = sumField_(ordersCompleted, '利益');
    var wsIndRate = (wsInd && wsInd.利益率) ? wsInd.利益率 : 0;
    advice.push({
      title: '補助金申請に使える数字根拠',
      body: '「総売上' + fmtYen(totalRev) + '・利益率' + totalRate.toFixed(1) + '%・'
        + '卸売サイト開始3ヶ月で利益' + fmtYen(wsTotalProfit) + '」は事業成長性を示す強い材料です。<br>'
        + '特に「卸売の個別選択（利益率' + wsIndRate.toFixed(1) + '%）を撮影データ付き商品パッケージで伸ばす」'
        + 'というストーリーは、補助金の「販路開拓」要件に直結します。'
        + '在庫' + inventory.length + '点の撮影・採寸データ整備が投資対象として説明しやすい構造です。'
    });
  }

  return advice;
}

// ──────────────────────────────────────────────
// HTML生成
// ──────────────────────────────────────────────

function generateReportHtml_(mercariSold, ordersCompleted, ordersAll, inventory, returned, disposed) {
  // 月の特定
  var allMonths = {};
  for (var i = 0; i < mercariSold.length; i++) { if (mercariSold[i].月) allMonths[mercariSold[i].月] = true; }
  for (var i = 0; i < ordersCompleted.length; i++) { if (ordersCompleted[i].月) allMonths[ordersCompleted[i].月] = true; }
  var sortedMonths = Object.keys(allMonths).sort();

  var now = new Date();
  var reportMonth = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
  var currentMonth = sortedMonths.length > 0 ? sortedMonths[sortedMonths.length - 1] : reportMonth;
  var prevMonth = sortedMonths.length >= 2 ? sortedMonths[sortedMonths.length - 2] : null;

  var cur = monthlyChannelStats_(mercariSold, ordersCompleted, currentMonth);
  var prev = prevMonth ? monthlyChannelStats_(mercariSold, ordersCompleted, prevMonth) : null;

  var curTotalRev = cur.merc_revenue + cur.ws_revenue;
  var curTotalProf = cur.merc_profit + cur.ws_profit;
  var curTotalRate = curTotalRev > 0 ? (curTotalProf / curTotalRev * 100) : 0;
  var prevTotalRev = prev ? (prev.merc_revenue + prev.ws_revenue) : 0;
  var prevTotalProf = prev ? (prev.merc_profit + prev.ws_profit) : 0;
  var prevTotalRate = prev && prevTotalRev > 0 ? (prevTotalProf / prevTotalRev * 100) : 0;

  // 累計
  var mercRevenue = sumField_(mercariSold, '販売価格');
  var mercProfit = sumField_(mercariSold, '利益');
  var mercCount = mercariSold.length;
  var wsRevenue = sumField_(ordersCompleted, '売上');
  var wsProfit = sumField_(ordersCompleted, '利益');
  var wsCount = ordersCompleted.length;
  var totalRevenue = mercRevenue + wsRevenue;
  var totalProfit = mercProfit + wsProfit;
  var totalRate = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

  var pipelineCount = ordersAll.filter(function(o) { return o.ステータス === '依頼中'; }).length;

  // 月次トレンド
  var mdata = monthlyProfitData_(mercariSold, ordersCompleted);

  // 卸売比較
  var wsComp = wholesaleComparison_(ordersCompleted);
  var wsTrend = wholesaleMonthlyTrend_(ordersCompleted);

  // 区分コード
  var clf = classificationPerformance_(mercariSold);

  // カテゴリ
  var cats = categoryAnalysis_(mercariSold);

  // 在庫
  var invCount = inventory.length;
  var invPurchase = sumField_(inventory, '仕入れ値');
  var ageDist = inventoryAgeDistribution_(inventory);

  // 在庫区分コード構成
  var invClf = {};
  if (inventory.length > 0) {
    var invClfTemp = {};
    for (var i = 0; i < inventory.length; i++) {
      var code = inventory[i].区分コード;
      if (code) invClfTemp[code] = (invClfTemp[code] || 0) + 1;
    }
    var invClfArr = [];
    for (var k in invClfTemp) invClfArr.push({ code: k, count: invClfTemp[k] });
    invClfArr.sort(function(a, b) { return b.count - a.count; });
    for (var i = 0; i < Math.min(8, invClfArr.length); i++) {
      invClf[invClfArr[i].code] = invClfArr[i].count;
    }
  }

  // 損失
  var retCount = returned.length;
  var retCost = sumField_(returned, '仕入れ値');
  var disCount = disposed.length;
  var disCost = sumField_(disposed, '仕入れ値');

  // アドバイス
  var advice = generateAdvice_(mercariSold, ordersCompleted, inventory, returned, disposed, cur, prev, currentMonth, prevMonth);

  // チャートデータJSON
  var chartData = {
    monthlyTrend: mdata,
    wsMonths: wsTrend.months,
    wsIndRevenue: wsTrend.months.map(function(m) { return (wsTrend.indData[m] || {}).売上 || 0; }),
    wsIndProfit: wsTrend.months.map(function(m) { return (wsTrend.indData[m] || {}).利益 || 0; }),
    wsAssRevenue: wsTrend.months.map(function(m) { return (wsTrend.assData[m] || {}).売上 || 0; }),
    wsAssProfit: wsTrend.months.map(function(m) { return (wsTrend.assData[m] || {}).利益 || 0; }),
    clfLabels: clf.map(function(r) { return r.区分コード; }),
    clfCount: clf.map(function(r) { return r.件数; }),
    clfAvgProfit: clf.map(function(r) { return Math.round(r.平均利益); }),
    clfLossRate: clf.map(function(r) { return r.赤字率; }),
    catLabels: cats.map(function(r) { return r.カテゴリ2; }),
    catProfit: cats.map(function(r) { return Math.round(r.合計利益); }),
    catAvgProfit: cats.map(function(r) { return Math.round(r.平均利益); }),
    catCount: cats.map(function(r) { return r.件数; }),
    ageDist: ageDist,
    invClf: invClf
  };

  // 区分コードテーブル行
  var clfRows = '';
  for (var i = 0; i < clf.length; i++) {
    var r = clf[i];
    clfRows += '<tr>'
      + '<td>' + r.区分コード + '</td>'
      + '<td>' + r.件数 + '</td>'
      + '<td>' + fmtYen(r.平均販売価格) + '</td>'
      + '<td>' + fmtYen(r.平均利益) + '</td>'
      + '<td>' + fmtYen(r.合計利益) + '</td>'
      + '<td>' + r.赤字率.toFixed(1) + '%</td>'
      + '</tr>';
  }

  // カテゴリテーブル行
  var catRows = '';
  for (var i = 0; i < cats.length; i++) {
    var r = cats[i];
    catRows += '<tr>'
      + '<td>' + r.カテゴリ2 + '</td>'
      + '<td>' + r.件数 + '</td>'
      + '<td>' + fmtYen(r.合計利益) + '</td>'
      + '<td>' + fmtYen(r.平均利益) + '</td>'
      + '</tr>';
  }

  // アドバイスHTML
  var adviceHtml = '';
  for (var i = 0; i < advice.length; i++) {
    var a = advice[i];
    adviceHtml += '<div class="advice-item"><span class="advice-num">' + (i + 1) + '</span>'
      + '<div><div class="advice-title">' + a.title + '</div>'
      + '<p>' + a.body + '</p></div></div>\n';
  }

  // 前月比較テーブル
  var momTableHtml = '';
  if (prev) {
    momTableHtml = '<div style="margin-bottom:20px;"><h3 style="color:var(--text-secondary);font-size:0.95em;margin-bottom:12px;">前月比較（' + prevMonth + ' → ' + currentMonth + '）</h3>'
      + '<div class="ws-table"><table><thead><tr><th>指標</th><th>' + prevMonth + '</th><th>' + currentMonth + '</th><th>増減</th></tr></thead><tbody>'
      + '<tr><td>総売上</td><td>' + fmtYen(prevTotalRev) + '</td><td>' + fmtYen(curTotalRev) + '</td><td>' + momChangeHtml(curTotalRev, prevTotalRev) + '</td></tr>'
      + '<tr><td>総利益</td><td>' + fmtYen(prevTotalProf) + '</td><td>' + fmtYen(curTotalProf) + '</td><td>' + momChangeHtml(curTotalProf, prevTotalProf) + '</td></tr>'
      + '<tr><td>メルカリ件数</td><td>' + prev.merc_count + '件</td><td>' + cur.merc_count + '件</td><td>' + momChangeHtml(cur.merc_count, prev.merc_count) + '</td></tr>'
      + '<tr><td>メルカリ利益</td><td>' + fmtYen(prev.merc_profit) + '</td><td>' + fmtYen(cur.merc_profit) + '</td><td>' + momChangeHtml(cur.merc_profit, prev.merc_profit) + '</td></tr>'
      + '<tr><td>卸売件数</td><td>' + prev.ws_count + '件</td><td>' + cur.ws_count + '件</td><td>' + momChangeHtml(cur.ws_count, prev.ws_count) + '</td></tr>'
      + '<tr><td>卸売利益</td><td>' + fmtYen(prev.ws_profit) + '</td><td>' + fmtYen(cur.ws_profit) + '</td><td>' + momChangeHtml(cur.ws_profit, prev.ws_profit) + '</td></tr>'
      + '<tr><td>卸売（個別選択）</td><td>' + prev.ws_ind_count + '件 / ' + fmtYen(prev.ws_ind_profit) + '</td><td>' + cur.ws_ind_count + '件 / ' + fmtYen(cur.ws_ind_profit) + '</td><td>' + momChangeHtml(cur.ws_ind_profit, prev.ws_ind_profit) + '</td></tr>'
      + '<tr><td>卸売（アソート）</td><td>' + prev.ws_ass_count + '件 / ' + fmtYen(prev.ws_ass_profit) + '</td><td>' + cur.ws_ass_count + '件 / ' + fmtYen(cur.ws_ass_profit) + '</td><td>' + momChangeHtml(cur.ws_ass_profit, prev.ws_ass_profit) + '</td></tr>'
      + '</tbody></table></div></div>';
  }

  // 卸売比較テーブルデータ
  var wsIndD = wsComp['個別選択'] || {};
  var wsAssD = wsComp['アソート'] || {};

  var generatedAt = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  var monthAvgProfit = sortedMonths.length > 0 ? fmtYen(totalProfit / sortedMonths.length) : '¥0';
  var mercRate = mercRevenue > 0 ? (mercProfit / mercRevenue * 100) : 0;
  var wsRate = wsRevenue > 0 ? (wsProfit / wsRevenue * 100) : 0;
  var mercAvgPrice = mercCount > 0 ? fmtYen(mercRevenue / mercCount) : '¥0';
  var mercAvgProfit = mercCount > 0 ? fmtYen(mercProfit / mercCount) : '¥0';
  var wsAvgPrice = wsCount > 0 ? fmtYen(wsRevenue / wsCount) : '¥0';
  var wsAvgProfit = wsCount > 0 ? fmtYen(wsProfit / wsCount) : '¥0';
  var mercRevenueShare = totalRevenue > 0 ? fmtPct(mercRevenue / totalRevenue * 100) : '0.0%';
  var wsRevenueShare = totalRevenue > 0 ? fmtPct(wsRevenue / totalRevenue * 100) : '0.0%';

  // ── HTML構築 ──
  var html = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>月次分析レポート - ' + reportMonth + '</title>\n'
    + '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>\n'
    + '<style>\n'
    + ':root {\n'
    + '    --bg-primary: #0f0f1a;\n'
    + '    --bg-secondary: #1a1a2e;\n'
    + '    --bg-card: #16213e;\n'
    + '    --bg-card-alt: #1a1a3e;\n'
    + '    --text-primary: #e0e0e0;\n'
    + '    --text-secondary: #a0a0b0;\n'
    + '    --text-muted: #707088;\n'
    + '    --accent-blue: #4fc3f7;\n'
    + '    --accent-green: #66bb6a;\n'
    + '    --accent-orange: #ffa726;\n'
    + '    --accent-red: #ef5350;\n'
    + '    --accent-purple: #ab47bc;\n'
    + '    --accent-teal: #26a69a;\n'
    + '    --border-color: #2a2a4a;\n'
    + '    --shadow: 0 4px 20px rgba(0,0,0,0.3);\n'
    + '}\n'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }\n'
    + 'body {\n'
    + '    font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Noto Sans JP\', sans-serif;\n'
    + '    background: var(--bg-primary);\n'
    + '    color: var(--text-primary);\n'
    + '    line-height: 1.6;\n'
    + '    padding: 20px;\n'
    + '}\n'
    + '.container { max-width: 1200px; margin: 0 auto; }\n'
    + '.header {\n'
    + '    text-align: center;\n'
    + '    padding: 40px 20px;\n'
    + '    margin-bottom: 30px;\n'
    + '    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);\n'
    + '    border-radius: 16px;\n'
    + '    border: 1px solid var(--border-color);\n'
    + '}\n'
    + '.header h1 {\n'
    + '    font-size: 2em;\n'
    + '    background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));\n'
    + '    -webkit-background-clip: text;\n'
    + '    -webkit-text-fill-color: transparent;\n'
    + '    margin-bottom: 8px;\n'
    + '}\n'
    + '.header .subtitle { color: var(--text-secondary); font-size: 1.1em; }\n'
    + '.section {\n'
    + '    background: var(--bg-card);\n'
    + '    border-radius: 12px;\n'
    + '    padding: 24px;\n'
    + '    margin-bottom: 24px;\n'
    + '    border: 1px solid var(--border-color);\n'
    + '    box-shadow: var(--shadow);\n'
    + '}\n'
    + '.section h2 {\n'
    + '    font-size: 1.3em;\n'
    + '    color: var(--accent-blue);\n'
    + '    margin-bottom: 20px;\n'
    + '    padding-bottom: 10px;\n'
    + '    border-bottom: 2px solid var(--border-color);\n'
    + '    display: flex;\n'
    + '    align-items: center;\n'
    + '    gap: 8px;\n'
    + '}\n'
    + '.section h2 .icon { font-size: 1.2em; }\n'
    + '.kpi-grid {\n'
    + '    display: grid;\n'
    + '    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n'
    + '    gap: 16px;\n'
    + '    margin-bottom: 20px;\n'
    + '}\n'
    + '.kpi-card {\n'
    + '    background: var(--bg-secondary);\n'
    + '    border-radius: 10px;\n'
    + '    padding: 20px;\n'
    + '    text-align: center;\n'
    + '    border: 1px solid var(--border-color);\n'
    + '    transition: transform 0.2s;\n'
    + '}\n'
    + '.kpi-card:hover { transform: translateY(-2px); }\n'
    + '.kpi-card .label { color: var(--text-secondary); font-size: 0.85em; margin-bottom: 4px; }\n'
    + '.kpi-card .value { font-size: 1.6em; font-weight: 700; }\n'
    + '.kpi-card .value.blue { color: var(--accent-blue); }\n'
    + '.kpi-card .value.green { color: var(--accent-green); }\n'
    + '.kpi-card .value.orange { color: var(--accent-orange); }\n'
    + '.kpi-card .value.red { color: var(--accent-red); }\n'
    + '.kpi-card .value.purple { color: var(--accent-purple); }\n'
    + '.kpi-card .value.teal { color: var(--accent-teal); }\n'
    + '.kpi-card .sub { color: var(--text-muted); font-size: 0.8em; margin-top: 4px; }\n'
    + '.breakdown {\n'
    + '    display: grid;\n'
    + '    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n'
    + '    gap: 16px;\n'
    + '    margin-top: 16px;\n'
    + '}\n'
    + '.breakdown-card {\n'
    + '    background: var(--bg-secondary);\n'
    + '    border-radius: 10px;\n'
    + '    padding: 20px;\n'
    + '    border-left: 4px solid var(--accent-blue);\n'
    + '}\n'
    + '.breakdown-card.wholesale { border-left-color: var(--accent-orange); }\n'
    + '.breakdown-card.pipeline { border-left-color: var(--accent-purple); }\n'
    + '.breakdown-card h3 { font-size: 1em; margin-bottom: 12px; color: var(--text-primary); }\n'
    + '.breakdown-card .stat { display: flex; justify-content: space-between; padding: 4px 0; }\n'
    + '.breakdown-card .stat .lbl { color: var(--text-secondary); }\n'
    + '.chart-container { position: relative; height: 350px; margin: 20px 0; }\n'
    + '.chart-container.small { height: 280px; }\n'
    + 'table {\n'
    + '    width: 100%;\n'
    + '    border-collapse: collapse;\n'
    + '    margin-top: 12px;\n'
    + '}\n'
    + 'table th, table td {\n'
    + '    padding: 10px 14px;\n'
    + '    text-align: right;\n'
    + '    border-bottom: 1px solid var(--border-color);\n'
    + '}\n'
    + 'table th {\n'
    + '    background: var(--bg-secondary);\n'
    + '    color: var(--accent-blue);\n'
    + '    font-weight: 600;\n'
    + '    font-size: 0.85em;\n'
    + '    text-transform: uppercase;\n'
    + '    letter-spacing: 0.5px;\n'
    + '}\n'
    + 'table th:first-child, table td:first-child { text-align: left; }\n'
    + 'table tr:hover { background: rgba(79, 195, 247, 0.05); }\n'
    + '.advice-item {\n'
    + '    display: flex;\n'
    + '    align-items: flex-start;\n'
    + '    gap: 14px;\n'
    + '    padding: 16px;\n'
    + '    background: var(--bg-secondary);\n'
    + '    border-radius: 10px;\n'
    + '    margin-bottom: 12px;\n'
    + '    border: 1px solid var(--border-color);\n'
    + '}\n'
    + '.advice-num {\n'
    + '    background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));\n'
    + '    color: #fff;\n'
    + '    width: 30px;\n'
    + '    height: 30px;\n'
    + '    border-radius: 50%;\n'
    + '    display: flex;\n'
    + '    align-items: center;\n'
    + '    justify-content: center;\n'
    + '    font-weight: 700;\n'
    + '    font-size: 0.9em;\n'
    + '    flex-shrink: 0;\n'
    + '}\n'
    + '.advice-title { font-weight: 700; font-size: 1.05em; color: var(--accent-blue); margin-bottom: 8px; }\n'
    + '.advice-item p { color: var(--text-secondary); line-height: 1.7; font-size: 0.92em; }\n'
    + '.advice-item b { color: var(--text-primary); }\n'
    + '.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }\n'
    + '@media (max-width: 768px) {\n'
    + '    .two-col { grid-template-columns: 1fr; }\n'
    + '    .kpi-grid { grid-template-columns: repeat(2, 1fr); }\n'
    + '    .breakdown { grid-template-columns: 1fr; }\n'
    + '    .header h1 { font-size: 1.5em; }\n'
    + '}\n'
    + '.ws-table { overflow-x: auto; }\n'
    + '.ws-table table { min-width: 600px; }\n'
    + '.loss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n'
    + '@media (max-width: 600px) { .loss-grid { grid-template-columns: 1fr; } }\n'
    + '.loss-card {\n'
    + '    background: var(--bg-secondary);\n'
    + '    border-radius: 10px;\n'
    + '    padding: 20px;\n'
    + '    text-align: center;\n'
    + '    border: 1px solid var(--border-color);\n'
    + '}\n'
    + '.loss-card .loss-label { color: var(--text-secondary); margin-bottom: 6px; }\n'
    + '.loss-card .loss-count { font-size: 2em; font-weight: 700; color: var(--accent-red); }\n'
    + '.loss-card .loss-amount { color: var(--text-muted); margin-top: 4px; }\n'
    + '.footer {\n'
    + '    text-align: center;\n'
    + '    color: var(--text-muted);\n'
    + '    padding: 30px;\n'
    + '    font-size: 0.85em;\n'
    + '}\n'
    + '</style>\n</head>\n<body>\n<div class="container">\n\n'

    // Header
    + '<div class="header">\n'
    + '    <h1>月次分析レポート</h1>\n'
    + '    <div class="subtitle">' + reportMonth + ' | Generated ' + generatedAt + '</div>\n'
    + '</div>\n\n'

    // Section 1: All-channel Summary
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f4ca;</span> 当月サマリー（' + currentMonth + '）</h2>\n'
    + '    <div class="kpi-grid">\n'
    + '        <div class="kpi-card"><div class="label">当月売上</div><div class="value blue">' + fmtYen(curTotalRev) + (prev ? momChangeHtml(curTotalRev, prevTotalRev) : '') + '</div><div class="sub">' + (cur.merc_count + cur.ws_count) + '件</div></div>\n'
    + '        <div class="kpi-card"><div class="label">当月利益</div><div class="value green">' + fmtYen(curTotalProf) + (prev ? momChangeHtml(curTotalProf, prevTotalProf) : '') + '</div></div>\n'
    + '        <div class="kpi-card"><div class="label">当月利益率</div><div class="value orange">' + fmtPct(curTotalRate) + (prev ? momChangeHtml(curTotalRate, prevTotalRate, true) : '') + '</div></div>\n'
    + '        <div class="kpi-card"><div class="label">パイプライン（依頼中）</div><div class="value purple">' + pipelineCount + '件</div></div>\n'
    + '    </div>\n'
    + momTableHtml
    + '    <div style="margin-top:12px;"><h3 style="color:var(--text-secondary);font-size:0.95em;margin-bottom:12px;">累計実績</h3></div>\n'
    + '    <div class="kpi-grid">\n'
    + '        <div class="kpi-card"><div class="label">累計売上</div><div class="value blue">' + fmtYen(totalRevenue) + '</div><div class="sub">' + (mercCount + wsCount) + '件</div></div>\n'
    + '        <div class="kpi-card"><div class="label">累計利益</div><div class="value green">' + fmtYen(totalProfit) + '</div></div>\n'
    + '        <div class="kpi-card"><div class="label">累計利益率</div><div class="value orange">' + fmtPct(totalRate) + '</div></div>\n'
    + '        <div class="kpi-card"><div class="label">月平均利益</div><div class="value teal">' + monthAvgProfit + '</div><div class="sub">' + sortedMonths.length + 'ヶ月間</div></div>\n'
    + '    </div>\n'
    + '    <div class="breakdown">\n'
    + '        <div class="breakdown-card">\n'
    + '            <h3>メルカリ / ラクマ（累計）</h3>\n'
    + '            <div class="stat"><span class="lbl">件数</span><span>' + mercCount + '件</span></div>\n'
    + '            <div class="stat"><span class="lbl">売上</span><span>' + fmtYen(mercRevenue) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">利益</span><span>' + fmtYen(mercProfit) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">利益率</span><span>' + fmtPct(mercRate) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">平均単価</span><span>' + mercAvgPrice + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">平均利益/件</span><span>' + mercAvgProfit + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">売上構成比</span><span>' + mercRevenueShare + '</span></div>\n'
    + '        </div>\n'
    + '        <div class="breakdown-card wholesale">\n'
    + '            <h3>卸売（デタウリ）（累計）</h3>\n'
    + '            <div class="stat"><span class="lbl">件数</span><span>' + wsCount + '件</span></div>\n'
    + '            <div class="stat"><span class="lbl">売上</span><span>' + fmtYen(wsRevenue) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">利益</span><span>' + fmtYen(wsProfit) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">利益率</span><span>' + fmtPct(wsRate) + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">平均単価</span><span>' + wsAvgPrice + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">平均利益/件</span><span>' + wsAvgProfit + '</span></div>\n'
    + '            <div class="stat"><span class="lbl">売上構成比</span><span>' + wsRevenueShare + '</span></div>\n'
    + '        </div>\n'
    + '        <div class="breakdown-card pipeline">\n'
    + '            <h3>パイプライン</h3>\n'
    + '            <div class="stat"><span class="lbl">依頼中</span><span>' + pipelineCount + '件</span></div>\n'
    + '        </div>\n'
    + '    </div>\n'
    + '</div>\n\n'

    // Section 2: Monthly Profit Trend
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f4c8;</span> 月次利益推移</h2>\n'
    + '    <div class="chart-container"><canvas id="monthlyTrendChart"></canvas></div>\n'
    + '</div>\n\n'

    // Section 3: Wholesale Individual vs Assort
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f4e6;</span> 卸売：個別選択 vs アソート</h2>\n'
    + '    <div class="ws-table"><table><thead><tr><th>指標</th><th>個別選択</th><th>アソート</th></tr></thead><tbody>\n'
    + '        <tr><td>件数</td><td>' + (wsIndD.件数 || 0) + '件</td><td>' + (wsAssD.件数 || 0) + '件</td></tr>\n'
    + '        <tr><td>売上</td><td>' + fmtYen(wsIndD.売上 || 0) + '</td><td>' + fmtYen(wsAssD.売上 || 0) + '</td></tr>\n'
    + '        <tr><td>送料（店負担）</td><td>' + fmtYen(wsIndD.送料_店負担 || 0) + '</td><td>' + fmtYen(wsAssD.送料_店負担 || 0) + '</td></tr>\n'
    + '        <tr><td>作業報酬</td><td>' + fmtYen(wsIndD.作業報酬 || 0) + '</td><td>' + fmtYen(wsAssD.作業報酬 || 0) + '</td></tr>\n'
    + '        <tr><td>決済手数料</td><td>' + fmtYen(wsIndD.決済手数料 || 0) + '</td><td>' + fmtYen(wsAssD.決済手数料 || 0) + '</td></tr>\n'
    + '        <tr><td>利益</td><td>' + fmtYen(wsIndD.利益 || 0) + '</td><td>' + fmtYen(wsAssD.利益 || 0) + '</td></tr>\n'
    + '        <tr><td>利益率</td><td>' + fmtPct(wsIndD.利益率 || 0) + '</td><td>' + fmtPct(wsAssD.利益率 || 0) + '</td></tr>\n'
    + '        <tr><td>送料比率</td><td>' + fmtPct(wsIndD.送料比率 || 0) + '</td><td>' + fmtPct(wsAssD.送料比率 || 0) + '</td></tr>\n'
    + '    </tbody></table></div>\n'
    + '    <div class="chart-container" style="margin-top:24px;"><canvas id="wsTrendChart"></canvas></div>\n'
    + '</div>\n\n'

    // Section 4: Classification Performance
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f3af;</span> 区分コード別パフォーマンス（メルカリ）</h2>\n'
    + '    <div class="chart-container"><canvas id="clfChart"></canvas></div>\n'
    + '    <table><thead><tr><th>区分コード</th><th>件数</th><th>平均販売価格</th><th>平均利益</th><th>合計利益</th><th>赤字率</th></tr></thead><tbody>\n'
    + clfRows
    + '    </tbody></table>\n'
    + '</div>\n\n'

    // Section 5: Category Analysis
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f3f7;&#xfe0f;</span> カテゴリ分析（トップ8 カテゴリ2）</h2>\n'
    + '    <table><thead><tr><th>カテゴリ</th><th>件数</th><th>合計利益</th><th>平均利益</th></tr></thead><tbody>\n'
    + catRows
    + '    </tbody></table>\n'
    + '</div>\n\n'

    // Section 6: Inventory Analysis
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f4e6;</span> 在庫分析</h2>\n'
    + '    <div class="kpi-grid">\n'
    + '        <div class="kpi-card"><div class="label">在庫点数</div><div class="value blue">' + invCount.toLocaleString('ja-JP') + '点</div></div>\n'
    + '        <div class="kpi-card"><div class="label">仕入れ額合計</div><div class="value orange">' + fmtYen(invPurchase) + '</div></div>\n'
    + '    </div>\n'
    + '    <div class="two-col">\n'
    + '        <div><h3 style="color:var(--accent-blue);margin-bottom:12px;">在庫日数分布</h3><div class="chart-container small"><canvas id="ageChart"></canvas></div></div>\n'
    + '        <div><h3 style="color:var(--accent-blue);margin-bottom:12px;">区分コード構成</h3><div class="chart-container small"><canvas id="invClfChart"></canvas></div></div>\n'
    + '    </div>\n'
    + '</div>\n\n'

    // Section 7: Losses
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x26a0;&#xfe0f;</span> 損失（返品・廃棄）</h2>\n'
    + '    <div class="loss-grid">\n'
    + '        <div class="loss-card"><div class="loss-label">返品済み</div><div class="loss-count">' + retCount + '件</div><div class="loss-amount">仕入れ額: ' + fmtYen(retCost) + '</div></div>\n'
    + '        <div class="loss-card"><div class="loss-label">廃棄済み</div><div class="loss-count">' + disCount + '件</div><div class="loss-amount">仕入れ額: ' + fmtYen(disCost) + '</div></div>\n'
    + '    </div>\n'
    + '</div>\n\n'

    // Section 8: Advice
    + '<div class="section">\n'
    + '    <h2><span class="icon">&#x1f4a1;</span> データに基づくアドバイス</h2>\n'
    + adviceHtml
    + '</div>\n\n'

    + '<div class="footer">Saisun Monthly Report | Auto-generated by GAS 月次レポート生成</div>\n\n'
    + '</div><!-- /container -->\n\n'

    // JavaScript / Charts
    + '<script>\n'
    + 'var DATA = ' + JSON.stringify(chartData) + ';\n\n'
    + 'var COLORS = {\n'
    + '    blue: "rgba(79, 195, 247, 0.8)",\n'
    + '    blueLight: "rgba(79, 195, 247, 0.3)",\n'
    + '    green: "rgba(102, 187, 106, 0.8)",\n'
    + '    orange: "rgba(255, 167, 38, 0.8)",\n'
    + '    orangeLight: "rgba(255, 167, 38, 0.3)",\n'
    + '    red: "rgba(239, 83, 80, 0.8)",\n'
    + '    purple: "rgba(171, 71, 188, 0.8)",\n'
    + '    teal: "rgba(38, 166, 154, 0.8)",\n'
    + '    white: "rgba(224, 224, 224, 1)"\n'
    + '};\n\n'
    + 'var defaultOptions = {\n'
    + '    responsive: true,\n'
    + '    maintainAspectRatio: false,\n'
    + '    plugins: { legend: { labels: { color: "#a0a0b0", font: { size: 12 } } } },\n'
    + '    scales: {\n'
    + '        x: { ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" } },\n'
    + '        y: { ticks: { color: "#707088", callback: function(v) { return "\\u00a5" + v.toLocaleString(); } }, grid: { color: "rgba(42,42,74,0.5)" } }\n'
    + '    }\n'
    + '};\n\n'

    // Chart 1: Monthly Profit Trend
    + 'new Chart(document.getElementById("monthlyTrendChart"), {\n'
    + '    type: "bar",\n'
    + '    data: {\n'
    + '        labels: DATA.monthlyTrend.labels,\n'
    + '        datasets: [\n'
    + '            { label: "メルカリ利益", data: DATA.monthlyTrend.mercari, backgroundColor: COLORS.blue, stack: "stack", order: 2 },\n'
    + '            { label: "卸売（個別選択）利益", data: DATA.monthlyTrend.ws_individual, backgroundColor: COLORS.orange, stack: "stack", order: 2 },\n'
    + '            { label: "卸売（アソート）利益", data: DATA.monthlyTrend.ws_assort, backgroundColor: COLORS.teal, stack: "stack", order: 2 },\n'
    + '            { label: "合計利益", data: DATA.monthlyTrend.labels.map(function(_, i) { return DATA.monthlyTrend.mercari[i] + DATA.monthlyTrend.ws_individual[i] + DATA.monthlyTrend.ws_assort[i]; }), type: "line", borderColor: COLORS.white, backgroundColor: "transparent", borderWidth: 2, pointRadius: 4, pointBackgroundColor: COLORS.white, order: 1, yAxisID: "y" }\n'
    + '        ]\n'
    + '    },\n'
    + '    options: {\n'
    + '        responsive: true, maintainAspectRatio: false,\n'
    + '        plugins: { legend: { labels: { color: "#a0a0b0", font: { size: 12 } } } },\n'
    + '        scales: {\n'
    + '            x: { stacked: true, ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" } },\n'
    + '            y: { stacked: true, ticks: { color: "#707088", callback: function(v) { return "\\u00a5" + v.toLocaleString(); } }, grid: { color: "rgba(42,42,74,0.5)" } }\n'
    + '        }\n'
    + '    }\n'
    + '});\n\n'

    // Chart 2: Wholesale Trend
    + 'new Chart(document.getElementById("wsTrendChart"), {\n'
    + '    type: "bar",\n'
    + '    data: {\n'
    + '        labels: DATA.wsMonths,\n'
    + '        datasets: [\n'
    + '            { label: "個別選択 売上", data: DATA.wsIndRevenue, backgroundColor: COLORS.blue },\n'
    + '            { label: "アソート 売上", data: DATA.wsAssRevenue, backgroundColor: COLORS.orange },\n'
    + '            { label: "個別選択 利益", data: DATA.wsIndProfit, type: "line", borderColor: COLORS.blue, backgroundColor: "transparent", borderWidth: 2, pointRadius: 3 },\n'
    + '            { label: "アソート 利益", data: DATA.wsAssProfit, type: "line", borderColor: COLORS.orange, backgroundColor: "transparent", borderWidth: 2, pointRadius: 3 }\n'
    + '        ]\n'
    + '    },\n'
    + '    options: defaultOptions\n'
    + '});\n\n'

    // Chart 3: Classification
    + 'new Chart(document.getElementById("clfChart"), {\n'
    + '    type: "bar",\n'
    + '    data: {\n'
    + '        labels: DATA.clfLabels,\n'
    + '        datasets: [\n'
    + '            { label: "件数", data: DATA.clfCount, backgroundColor: COLORS.blue, yAxisID: "y" },\n'
    + '            { label: "平均利益", data: DATA.clfAvgProfit, type: "line", borderColor: COLORS.green, backgroundColor: "transparent", borderWidth: 2, pointRadius: 3, yAxisID: "y1" },\n'
    + '            { label: "赤字率(%)", data: DATA.clfLossRate, type: "line", borderColor: COLORS.red, backgroundColor: "transparent", borderWidth: 2, pointRadius: 3, borderDash: [5, 5], yAxisID: "y2" }\n'
    + '        ]\n'
    + '    },\n'
    + '    options: {\n'
    + '        responsive: true, maintainAspectRatio: false,\n'
    + '        plugins: { legend: { labels: { color: "#a0a0b0", font: { size: 12 } } } },\n'
    + '        scales: {\n'
    + '            x: { ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" } },\n'
    + '            y: { position: "left", ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" }, title: { display: true, text: "件数", color: "#707088" } },\n'
    + '            y1: { position: "right", ticks: { color: "#707088", callback: function(v) { return "\\u00a5" + v.toLocaleString(); } }, grid: { drawOnChartArea: false }, title: { display: true, text: "平均利益", color: "#707088" } },\n'
    + '            y2: { position: "right", ticks: { color: "#707088", callback: function(v) { return v + "%"; } }, grid: { drawOnChartArea: false }, title: { display: true, text: "赤字率", color: "#707088" }, display: false }\n'
    + '        }\n'
    + '    }\n'
    + '});\n\n'

    // Chart 4: Inventory Age Distribution
    + 'new Chart(document.getElementById("ageChart"), {\n'
    + '    type: "bar",\n'
    + '    data: {\n'
    + '        labels: ["0-14日", "15-30日", "31-60日", "61-90日", "90日+"],\n'
    + '        datasets: [{ label: "在庫数", data: [DATA.ageDist["0-14"], DATA.ageDist["15-30"], DATA.ageDist["31-60"], DATA.ageDist["61-90"], DATA.ageDist["90+"]], backgroundColor: [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, COLORS.purple], borderRadius: 6 }]\n'
    + '    },\n'
    + '    options: {\n'
    + '        responsive: true, maintainAspectRatio: false,\n'
    + '        plugins: { legend: { display: false } },\n'
    + '        scales: {\n'
    + '            x: { ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" } },\n'
    + '            y: { ticks: { color: "#707088" }, grid: { color: "rgba(42,42,74,0.5)" } }\n'
    + '        }\n'
    + '    }\n'
    + '});\n\n'

    // Chart 5: Inventory Classification Pie
    + 'var invClfLabels = Object.keys(DATA.invClf);\n'
    + 'var invClfValues = Object.values(DATA.invClf);\n'
    + 'var pieColors = [COLORS.blue, COLORS.orange, COLORS.green, COLORS.purple, COLORS.teal, COLORS.red, "rgba(255,235,59,0.8)", "rgba(121,134,203,0.8)"];\n'
    + 'new Chart(document.getElementById("invClfChart"), {\n'
    + '    type: "doughnut",\n'
    + '    data: { labels: invClfLabels, datasets: [{ data: invClfValues, backgroundColor: pieColors.slice(0, invClfLabels.length), borderWidth: 0 }] },\n'
    + '    options: {\n'
    + '        responsive: true, maintainAspectRatio: false,\n'
    + '        plugins: { legend: { position: "right", labels: { color: "#a0a0b0", font: { size: 11 }, padding: 8 } } }\n'
    + '    }\n'
    + '});\n'
    + '<\/script>\n'
    + '</body>\n</html>';

  return { html: html, reportMonth: reportMonth, currentMonth: currentMonth };
}

// ──────────────────────────────────────────────
// メインエントリーポイント
// ──────────────────────────────────────────────

/**
 * 月次レポートを生成し、Google Driveに保存、分析アドバイスシートにリンクを記録する
 */
function generateMonthlyReport() {
  var startTime = new Date();
  console.log('月次レポート生成 開始');

  // 1. データ読み込み
  console.log('商品管理データ読み込み中...');
  var products = loadProductData_();
  console.log('  商品管理: ' + products.length + '件');

  console.log('依頼管理データ読み込み中...');
  var orders = loadOrderData_();
  console.log('  依頼管理: ' + orders.length + '件');

  // 2. 分析
  var mercariSold = analyzeMercari_(products);
  var inventory = analyzeInventory_(products);
  var losses = analyzeLosses_(products);
  var ordersCompleted = orders.filter(function(o) { return o.ステータス === '完了'; });

  console.log('メルカリ売却済み: ' + mercariSold.length + '件');
  console.log('卸売完了: ' + ordersCompleted.length + '件');
  console.log('在庫: ' + inventory.length + '件');
  console.log('返品: ' + losses.returned.length + '件, 廃棄: ' + losses.disposed.length + '件');

  // 3. HTML生成
  console.log('HTMLレポート生成中...');
  var result = generateReportHtml_(mercariSold, ordersCompleted, orders, inventory, losses.returned, losses.disposed);

  // 4. Google Driveに保存
  console.log('Google Driveに保存中...');
  var folderName = '月次レポート';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
    console.log('フォルダ「' + folderName + '」を作成しました');
  }

  var fileName = 'report_' + result.reportMonth + '.html';

  // 既存ファイルがあれば上書き
  var existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    var existing = existingFiles.next();
    existing.setTrashed(true);
    console.log('既存ファイルをゴミ箱に移動: ' + existing.getId());
  }

  var blob = Utilities.newBlob(result.html, 'text/html', fileName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Drive直接表示ではHTMLがコード表示されるため、ダウンロードURLを使用
  // ブラウザでダウンロード→開く でHTMLとしてレンダリングされる
  var fileUrl = 'https://drive.google.com/uc?id=' + file.getId() + '&export=download';

  console.log('ファイル保存完了: ' + fileUrl);
  console.log('ファイルサイズ: ' + Math.round(file.getSize() / 1024) + ' KB');

  // 5. 分析アドバイスシートにリンク記録
  var now = new Date();
  var period = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
  try {
    addAnalysisReport(period, fileUrl);
    console.log('分析アドバイスシートに記録完了');
  } catch (e) {
    console.log('分析アドバイスシートへの記録でエラー: ' + e.message);
  }

  // 6. 完了通知
  var elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  console.log('月次レポート生成 完了（' + elapsed + '秒）');

  try {
    SpreadsheetApp.getUi().alert(
      '月次レポート生成完了',
      '期間: ' + period + '\n'
      + '保存先: ' + folderName + '/' + fileName + '\n'
      + 'リンク: ' + fileUrl + '\n'
      + '処理時間: ' + elapsed + '秒',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // トリガー実行時はUI操作不可
    console.log('UIアラート表示不可（トリガー実行の可能性）: ' + e.message);
  }

  return { ok: true, url: fileUrl, period: period };
}

// ──────────────────────────────────────────────
// トリガー設定
// ──────────────────────────────────────────────

/**
 * 月次レポート自動生成トリガーを設定（毎月1日 AM 6:00）
 */
function setupMonthlyReportTrigger() {
  // 既存の同名トリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'generateMonthlyReport') {
      ScriptApp.deleteTrigger(triggers[i]);
      console.log('既存の月次レポートトリガーを削除しました');
    }
  }

  // 新しいトリガーを作成（毎月1日 6:00-7:00）
  ScriptApp.newTrigger('generateMonthlyReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  console.log('月次レポートトリガーを設定しました（毎月1日 AM 6:00）');

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('月次レポートトリガーを設定しました（毎月1日 AM 6:00）', '完了', 5);
  } catch (e) {
    // 無視
  }
}
