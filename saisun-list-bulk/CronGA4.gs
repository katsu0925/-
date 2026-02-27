// CronGA4.gs
// =====================================================
// GA4 Analytics Data API → スプレッドシート自動連携
// （saisun-list/GA4Analytics.gs から移動）
// =====================================================
// 【前提】GASエディタ → サービス(+) → 「Google Analytics Data API」追加 が必要

var GA4_PROP_ = 'properties/525734643';
var GA4_DAYS_ = 30;

var GA4_SN_ = {
  daily:  'GA4日別サマリー',
  source: 'GA4流入元',
  event:  'GA4イベント'
};

var GA4C_ = {
  head:   '#1565c0', headTxt: '#ffffff',
  alt:    '#f5f5f5', total:   '#e8eaf6',
  border: '#bdbdbd', ec:      '#e8f5e9',
  funnel: '#ff9800', funnelTxt: '#ffffff'
};

/** 全GA4シートを更新（毎日6時） */
function ga4SyncAll() {
  var ss = SpreadsheetApp.openById(cron_getSsId_());
  var r  = ga4Range_();
  ga4Daily_(ss, r.s, r.e);
  ga4Source_(ss, r.s, r.e);
  ga4Event_(ss, r.s, r.e);
  SpreadsheetApp.flush();
}

// ==================== 日別サマリー ====================

function ga4Daily_(ss, s, e) {
  var rpt = ga4Run_(
    [{ name: 'date' }],
    [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' },
     { name: 'screenPageViews' }, { name: 'engagementRate' },
     { name: 'averageSessionDuration' }],
    s, e,
    [{ dimension: { dimensionName: 'date' }, desc: false }]
  );

  var H = ['日付', 'ユーザー', '新規', 'セッション', 'PV', 'エンゲージ率', '平均滞在(秒)'];
  var rows = (rpt.rows || []).map(function(r) {
    var d = r.dimensionValues[0].value, m = r.metricValues;
    return [
      d.substr(0, 4) + '-' + d.substr(4, 2) + '-' + d.substr(6, 2),
      +m[0].value, +m[1].value, +m[2].value, +m[3].value,
      +m[4].value, Math.round(+m[5].value)
    ];
  });

  var sh = ga4Reset_(ss, GA4_SN_.daily);
  var n  = rows.length;
  var lR = n + 1;
  var tR = n + 2;

  sh.getRange(1, 1, 1, H.length).setValues([H]);
  if (n) sh.getRange(2, 1, n, H.length).setValues(rows);

  sh.getRange(tR, 1).setValue('合計 / 平均');
  ['SUM', 'SUM', 'SUM', 'SUM', 'AVERAGE', 'AVERAGE'].forEach(function(fn, i) {
    var c = String.fromCharCode(66 + i);
    sh.getRange(tR, i + 2).setFormula('=' + fn + '(' + c + '2:' + c + lR + ')');
  });

  ga4Head_(sh, 1, H.length);
  sh.getRange(2, 2, n + 1, 4).setNumberFormat('#,##0');
  sh.getRange(2, 6, n + 1, 1).setNumberFormat('0.0%');
  sh.getRange(2, 7, n + 1, 1).setNumberFormat('#,##0');
  sh.getRange(tR, 1, 1, H.length).setBackground(GA4C_.total).setFontWeight('bold')
    .setBorder(true, null, true, null, null, null, GA4C_.border, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  ga4Alt_(sh, 2, n, H.length);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 110);
  [2, 3, 4, 5].forEach(function(c) { sh.setColumnWidth(c, 95); });
  sh.setColumnWidth(6, 130);
  sh.setColumnWidth(7, 120);

  if (n > 1) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.MIN, '0')
      .setGradientMaxpointWithValue('#1b5e20', SpreadsheetApp.InterpolationType.MAX, 'MAX')
      .setRanges([sh.getRange(2, 2, n, 1)]).build();
    sh.setConditionalFormatRules([rule]);
  }

  if (n > 1) {
    var ch = sh.newChart().setChartType(Charts.ChartType.AREA)
      .addRange(sh.getRange(1, 1, lR, 1))
      .addRange(sh.getRange(1, 2, lR, 1))
      .addRange(sh.getRange(1, 4, lR, 1))
      .addRange(sh.getRange(1, 5, lR, 1))
      .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
      .setPosition(2, 9, 0, 0)
      .setOption('title', 'ユーザー・セッション・PV 推移（過去' + GA4_DAYS_ + '日）')
      .setOption('titleTextStyle', { fontSize: 13, bold: true })
      .setOption('width', 680).setOption('height', 370)
      .setOption('legend', { position: 'top' })
      .setOption('hAxis', { slantedText: true, slantedTextAngle: 45 })
      .setOption('vAxis', { minValue: 0 })
      .setOption('areaOpacity', 0.12)
      .setOption('colors', ['#1565c0', '#43a047', '#fb8c00'])
      .setOption('curveType', 'function')
      .build();
    sh.insertChart(ch);
  }
}

// ==================== 流入元 ====================

function ga4Source_(ss, s, e) {
  var rpt = ga4Run_(
    [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }],
    [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
    s, e,
    [{ metric: { metricName: 'sessions' }, desc: true }]
  );

  var mediumLabels = {
    'organic': '自然検索', 'cpc': '有料検索(CPC)', 'referral': '参照元サイト',
    '(none)': '(なし/直接)', 'email': 'メール', 'social': 'ソーシャル',
    'display': 'ディスプレイ広告', 'affiliate': 'アフィリエイト',
    'video': '動画広告', 'paid_social': '有料ソーシャル',
    'paid_search': '有料検索', 'push': 'プッシュ通知',
    'sms': 'SMS', 'audio': '音声広告'
  };
  var sourceLabels = {
    '(direct)': '(直接アクセス)', '(not set)': '(未設定)',
    'google': 'Google', 'yahoo': 'Yahoo', 'bing': 'Bing'
  };

  var H = ['流入元', 'メディア', 'キャンペーン', 'ユーザー', 'セッション', 'PV'];
  var rows = (rpt.rows || []).map(function(r) {
    var d = r.dimensionValues, m = r.metricValues;
    var src = d[0].value || '(direct)';
    var med = d[1].value || '(none)';
    var camp = d[2].value || '(not set)';
    return [
      sourceLabels[src] || src, mediumLabels[med] || med,
      camp === '(not set)' ? '(未設定)' : camp,
      +m[0].value, +m[1].value, +m[2].value
    ];
  });

  var sh = ga4Reset_(ss, GA4_SN_.source);
  var n  = rows.length;
  var lR = n + 2;
  var tR = n + 3;

  sh.getRange(1, 1).setValue('期間: ' + s + ' 〜 ' + e)
    .setFontSize(11).setFontWeight('bold').setFontColor('#333');
  sh.getRange(2, 1, 1, H.length).setValues([H]);
  if (n) sh.getRange(3, 1, n, H.length).setValues(rows);

  sh.getRange(tR, 1).setValue('合計');
  ['D', 'E', 'F'].forEach(function(c, i) {
    sh.getRange(tR, i + 4).setFormula('=SUM(' + c + '3:' + c + lR + ')');
  });

  ga4Head_(sh, 2, H.length);
  sh.getRange(3, 4, n + 1, 3).setNumberFormat('#,##0');
  sh.getRange(tR, 1, 1, H.length).setBackground(GA4C_.total).setFontWeight('bold');
  ga4Alt_(sh, 3, n, H.length);
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 200);
  [4, 5, 6].forEach(function(c) { sh.setColumnWidth(c, 100); });

  if (n > 1) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.MIN, '0')
      .setGradientMaxpointWithValue('#0d47a1', SpreadsheetApp.InterpolationType.MAX, 'MAX')
      .setRanges([sh.getRange(3, 5, n, 1)]).build();
    sh.setConditionalFormatRules([rule]);
  }

  if (n > 1) {
    var top = Math.min(n, 10);
    var ch = sh.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange(2, 1, top + 1, 1))
      .addRange(sh.getRange(2, 5, top + 1, 1))
      .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
      .setPosition(2, 8, 0, 0)
      .setOption('title', 'セッション比率（ソース別 上位' + top + '）')
      .setOption('titleTextStyle', { fontSize: 13, bold: true })
      .setOption('width', 520).setOption('height', 380)
      .setOption('legend', { position: 'right' })
      .setOption('pieSliceText', 'percentage')
      .setOption('colors', ['#1565c0', '#43a047', '#fb8c00', '#e53935',
                             '#8e24aa', '#00acc1', '#6d4c41', '#546e7a',
                             '#d81b60', '#fdd835'])
      .build();
    sh.insertChart(ch);
  }
}

// ==================== イベント ====================

function ga4Event_(ss, s, e) {
  var rpt = ga4Run_(
    [{ name: 'eventName' }],
    [{ name: 'eventCount' }],
    s, e,
    [{ metric: { metricName: 'eventCount' }, desc: true }]
  );

  var labels = {
    'page_view': 'ページ表示', 'page_loaded': 'ページ読込完了',
    'view_item_list': '商品一覧表示', 'view_item': '商品詳細表示',
    'add_to_cart': 'カート追加', 'remove_from_cart': 'カートから削除',
    'view_cart': 'カート表示', 'begin_checkout': '注文開始',
    'redirect_to_payment': '決済ページ遷移',
    'login': 'ログイン', 'sign_up': '新規登録', 'logout': 'ログアウト',
    'view_mypage': 'マイページ表示', 'apply_coupon': 'クーポン適用',
    'first_visit': '初回訪問', 'session_start': 'セッション開始',
    'user_engagement': 'エンゲージメント', 'scroll': 'スクロール',
    'click': 'クリック', 'file_download': 'ファイルDL',
    'form_start': 'フォーム開始', 'form_submit': 'フォーム送信',
    'video_start': '動画再生開始', 'video_progress': '動画再生中',
    'video_complete': '動画再生完了', 'purchase': '購入完了',
    'search': '検索', 'share': '共有', 'select_content': 'コンテンツ選択',
    'select_item': '商品選択', 'select_promotion': 'プロモーション選択',
    'view_promotion': 'プロモーション表示', 'view_search_results': '検索結果表示',
    'generate_lead': 'リード獲得', 'exception': 'エラー発生'
  };

  var H = ['イベント名', '回数', '元の名称'];
  var rows = (rpt.rows || []).map(function(r) {
    var n = r.dimensionValues[0].value, c = +r.metricValues[0].value;
    return [labels[n] || n, c, labels[n] ? n : ''];
  });

  var sh = ga4Reset_(ss, GA4_SN_.event);
  var n  = rows.length;
  var lR = n + 2;
  var tR = n + 3;

  sh.getRange(1, 1).setValue('期間: ' + s + ' 〜 ' + e)
    .setFontSize(11).setFontWeight('bold').setFontColor('#333');
  sh.getRange(2, 1, 1, H.length).setValues([H]);
  if (n) sh.getRange(3, 1, n, H.length).setValues(rows);

  sh.getRange(tR, 1).setValue('合計');
  sh.getRange(tR, 2).setFormula('=SUM(B3:B' + lR + ')');

  ga4Head_(sh, 2, H.length);
  sh.getRange(3, 2, n + 1, 1).setNumberFormat('#,##0');
  sh.getRange(tR, 1, 1, H.length).setBackground(GA4C_.total).setFontWeight('bold');
  ga4Alt_(sh, 3, n, H.length);
  sh.setFrozenRows(2);

  var ecLabels = ['商品詳細表示', '商品一覧表示', 'カート追加', 'カートから削除',
                  'カート表示', '注文開始', '決済ページ遷移'];
  rows.forEach(function(r, i) {
    if (ecLabels.indexOf(r[0]) >= 0) sh.getRange(i + 3, 1, 1, H.length).setBackground(GA4C_.ec);
  });

  sh.setColumnWidth(1, 210); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 200);

  if (n > 1) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.MIN, '0')
      .setGradientMaxpointWithValue('#1565c0', SpreadsheetApp.InterpolationType.MAX, 'MAX')
      .setRanges([sh.getRange(3, 2, n, 1)]).build();
    sh.setConditionalFormatRules([rule]);
  }

  // ファネル分析
  var eventMap = {};
  (rpt.rows || []).forEach(function(r) {
    eventMap[r.dimensionValues[0].value] = +r.metricValues[0].value;
  });

  var fR = tR + 2;
  sh.getRange(fR, 1).setValue('コンバージョンファネル')
    .setFontSize(13).setFontWeight('bold').setFontColor('#e65100');

  var fH = ['ステップ', 'イベント', '回数', '前ステップ転換率', '全体転換率', ''];
  sh.getRange(fR + 1, 1, 1, fH.length).setValues([fH]);
  sh.getRange(fR + 1, 1, 1, fH.length)
    .setBackground(GA4C_.funnel).setFontColor(GA4C_.funnelTxt)
    .setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true, GA4C_.border, SpreadsheetApp.BorderStyle.SOLID);

  var steps = [
    { ev: 'view_item_list', label: '1. 商品一覧表示' },
    { ev: 'view_item',      label: '2. 商品詳細表示' },
    { ev: 'add_to_cart',    label: '3. カート追加' },
    { ev: 'begin_checkout', label: '4. 注文開始' },
    { ev: 'redirect_to_payment', label: '5. 決済ページ遷移' }
  ];
  var topCount = eventMap[steps[0].ev] || 0;
  var funnelColors = ['#c8e6c9', '#dcedc8', '#fff9c4', '#ffe0b2', '#ffccbc'];

  steps.forEach(function(step, i) {
    var count     = eventMap[step.ev] || 0;
    var prevCount = i === 0 ? count : (eventMap[steps[i - 1].ev] || 0);
    var stepRate  = prevCount > 0 ? count / prevCount : 0;
    var allRate   = topCount > 0 ? count / topCount : 0;
    var row       = fR + 2 + i;

    sh.getRange(row, 1, 1, 5).setValues([[
      step.label, labels[step.ev] || step.ev, count,
      i === 0 ? '-' : (stepRate * 100).toFixed(1) + '%',
      i === 0 ? '100%' : (allRate * 100).toFixed(1) + '%'
    ]]);

    var remaining = topCount > 0 ? topCount - count : 0;
    if (remaining < 0) remaining = 0;
    sh.getRange(row, 6).setFormula(
      '=SPARKLINE({' + count + ',' + remaining + '},{"charttype","bar";"color1","#e65100";"color2","#eeeeee"})'
    );

    sh.getRange(row, 1, 1, fH.length).setBackground(funnelColors[i]);
    sh.getRange(row, 3).setNumberFormat('#,##0');
  });

  sh.getRange(fR + 1, 1, steps.length + 1, fH.length)
    .setBorder(true, true, true, true, null, null, GA4C_.border, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sh.setColumnWidth(4, 170); sh.setColumnWidth(5, 120); sh.setColumnWidth(6, 240);

  if (n > 1) {
    var topN = Math.min(n, 15);
    var ch = sh.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(2, 1, topN + 1, 1))
      .addRange(sh.getRange(2, 2, topN + 1, 1))
      .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
      .setPosition(2, 8, 0, 0)
      .setOption('title', 'イベント発生回数（上位' + topN + '）')
      .setOption('titleTextStyle', { fontSize: 13, bold: true })
      .setOption('width', 580).setOption('height', 420)
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#1565c0'])
      .setOption('hAxis', { title: '回数' })
      .build();
    sh.insertChart(ch);
  }
}

// ==================== ヘルパー ====================

function ga4Run_(dims, mets, s, e, ord) {
  try {
    var req = { dimensions: dims, metrics: mets, dateRanges: [{ startDate: s, endDate: e }] };
    if (ord) req.orderBys = ord;
    return AnalyticsData.Properties.runReport(req, GA4_PROP_);
  } catch (err) {
    var msg = String(err);
    if (msg.indexOf('AnalyticsData') >= 0 || msg.indexOf('not defined') >= 0) {
      throw new Error(
        'Google Analytics Data API が有効になっていません。\n' +
        'GASエディタ → サービス(+) → 「Google Analytics Data API」 → 追加 してください。'
      );
    }
    throw err;
  }
}

function ga4Reset_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getCharts().forEach(function(c) { sh.removeChart(c); });
  return sh;
}

function ga4Range_() {
  var now = new Date(), past = new Date();
  past.setDate(now.getDate() - GA4_DAYS_);
  var tz = 'Asia/Tokyo';
  return {
    s: Utilities.formatDate(past, tz, 'yyyy-MM-dd'),
    e: Utilities.formatDate(now, tz, 'yyyy-MM-dd')
  };
}

function ga4Head_(sh, row, cols) {
  sh.getRange(row, 1, 1, cols)
    .setBackground(GA4C_.head).setFontColor(GA4C_.headTxt)
    .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true, GA4C_.border, SpreadsheetApp.BorderStyle.SOLID);
}

function ga4Alt_(sh, startRow, numRows, cols) {
  for (var i = 0; i < numRows; i++) {
    if (i % 2 === 1) sh.getRange(startRow + i, 1, 1, cols).setBackground(GA4C_.alt);
  }
}
