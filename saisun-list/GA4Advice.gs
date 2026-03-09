// GA4Advice.gs
// =====================================================
// GA4 日次アラート + 週次AIアドバイス
// cronDaily9 → ga4advice_cron() で毎朝実行
//   月曜 → 週次サマリー（GA4 + 注文データ + メルマガ履歴 + AI分析）
//   火〜日 → 日次アラート（異常検出±2.0σ時のみ送信、AIなし）
// =====================================================

/**
 * エントリポイント（cronDaily9 から呼ばれる）
 * 曜日で日次アラート / 週次サマリーを分岐
 */
function ga4advice_cron() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) {
    console.log('ga4advice_cron: ADMIN_OWNER_EMAIL が未設定のためスキップ');
    return;
  }

  var dow = new Date().getDay(); // 0=日, 1=月, ..., 6=土
  if (dow === 1) {
    ga4advice_weeklySummary_(adminEmail);
  } else {
    ga4advice_dailyAlert_(adminEmail);
  }
}

// =====================================================
// 日次アラート（火〜日: 異常検出時のみ送信）
// =====================================================

/**
 * 日次アラート処理
 * 異常値(±2.0σ)があればアラートメール送信、なければ送信しない
 */
function ga4advice_dailyAlert_(adminEmail) {
  var ss = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
  var daily = ga4advice_extractDailyMetrics_(ss);

  if (daily.anomalies.length === 0) {
    console.log('ga4advice_dailyAlert_: 異常なし → 送信スキップ');
    return;
  }

  var yesterdayGA4 = null;
  try { yesterdayGA4 = ga4advice_fetchYesterdayGA4_(); } catch (e) {
    console.error('ga4advice_dailyAlert_: GA4 API失敗:', e);
  }

  var emailData = ga4advice_buildAlertEmail_(daily, yesterdayGA4);
  ga4advice_sendEmail_(adminEmail, emailData);
  console.log('ga4advice_dailyAlert_: アラート送信完了');
}

// =====================================================
// 週次サマリー（月曜: GA4 + 注文 + AI分析）
// =====================================================

/**
 * 週次統合サマリー + AI分析
 * GA4データ、注文データ、メルマガ配信履歴をAIに渡して「最優先1アクション」を提案
 */
function ga4advice_weeklySummary_(adminEmail) {
  var ss = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
  var daily = ga4advice_extractDailyMetrics_(ss);

  var yesterdayGA4 = null;
  try { yesterdayGA4 = ga4advice_fetchYesterdayGA4_(); } catch (e) {
    console.error('ga4advice_weeklySummary_: GA4 API失敗:', e);
  }

  var weeklyData = null;
  try { weeklyData = ga4advice_collectWeeklyOrderMetrics_(); } catch (e) {
    console.error('ga4advice_weeklySummary_: 注文データ取得失敗:', e);
  }

  var aiText = null;
  try {
    var messages = ga4advice_buildWeeklyPrompt_(daily, yesterdayGA4, weeklyData);
    aiText = ga4advice_callAI_(messages);
  } catch (e) {
    console.error('ga4advice_weeklySummary_: AI分析失敗:', e);
  }

  var metrics = { daily: daily, yesterdayGA4: yesterdayGA4, weeklyData: weeklyData };
  var emailData = ga4advice_buildWeeklyEmail_(metrics, aiText);
  ga4advice_sendEmail_(adminEmail, emailData);
  console.log('ga4advice_weeklySummary_: 完了');
}

// =====================================================
// データ抽出: GA4日別サマリー（シート読み取り）
// =====================================================

/**
 * GA4日別サマリーから昨日/7日平均/前週比/異常値を抽出
 * シート列: 日付 / ユーザー / 新規 / セッション / PV / エンゲージ率 / 平均滞在(秒)
 */
function ga4advice_extractDailyMetrics_(ss) {
  var defaults = {
    yesterday: { date: '-', users: 0, newUsers: 0, sessions: 0, pv: 0, engagementRate: 0, avgDuration: 0 },
    avg7d: { users: 0, newUsers: 0, sessions: 0, pv: 0, engagementRate: 0, avgDuration: 0 },
    weekOverWeek: { users: 0, newUsers: 0, sessions: 0, pv: 0 },
    anomalies: []
  };

  var sh = ss.getSheetByName('GA4日別サマリー');
  if (!sh) return defaults;
  var lastRow = sh.getLastRow();
  if (lastRow < 3) return defaults;

  var dataEnd = lastRow - 1;
  var numData = dataEnd - 1;
  if (numData < 1) return defaults;

  var all = sh.getRange(2, 1, numData, 7).getValues();

  var last = all[all.length - 1];
  var yesterday = {
    date: (last[0] instanceof Date) ? Utilities.formatDate(last[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(last[0] || '-'),
    users: +last[1] || 0,
    newUsers: +last[2] || 0,
    sessions: +last[3] || 0,
    pv: +last[4] || 0,
    engagementRate: +last[5] || 0,
    avgDuration: +last[6] || 0
  };

  var recent7 = all.slice(Math.max(0, all.length - 7));
  var keys = ['users', 'newUsers', 'sessions', 'pv', 'engagementRate', 'avgDuration'];
  var colIdx = [1, 2, 3, 4, 5, 6];
  var avg7d = {};
  for (var k = 0; k < keys.length; k++) {
    var sum = 0;
    for (var r = 0; r < recent7.length; r++) sum += (+recent7[r][colIdx[k]] || 0);
    avg7d[keys[k]] = recent7.length > 0 ? sum / recent7.length : 0;
  }

  var weekOverWeek = {};
  var thisWeek = all.slice(Math.max(0, all.length - 7));
  var prevWeek = all.slice(Math.max(0, all.length - 14), Math.max(0, all.length - 7));
  var wowKeys = ['users', 'newUsers', 'sessions', 'pv'];
  var wowCols = [1, 2, 3, 4];
  for (var w = 0; w < wowKeys.length; w++) {
    var thisSum = 0, prevSum = 0;
    for (var t = 0; t < thisWeek.length; t++) thisSum += (+thisWeek[t][wowCols[w]] || 0);
    for (var p = 0; p < prevWeek.length; p++) prevSum += (+prevWeek[p][wowCols[w]] || 0);
    weekOverWeek[wowKeys[w]] = prevSum > 0 ? ((thisSum - prevSum) / prevSum * 100) : 0;
  }

  // 異常検出: 昨日の値が7日平均±2.0σ超
  var anomalies = [];
  var labels = { users: 'ユーザー', newUsers: '新規', sessions: 'セッション', pv: 'PV' };
  for (var a = 0; a < wowKeys.length; a++) {
    var key = wowKeys[a];
    var ci = wowCols[a];
    var vals = [];
    for (var v = 0; v < recent7.length; v++) vals.push(+recent7[v][ci] || 0);
    var mean = avg7d[key];
    var variance = 0;
    for (var vi = 0; vi < vals.length; vi++) variance += Math.pow(vals[vi] - mean, 2);
    var sigma = vals.length > 1 ? Math.sqrt(variance / vals.length) : 0;
    var yVal = yesterday[key];
    if (sigma > 0 && Math.abs(yVal - mean) > 2.0 * sigma) {
      anomalies.push({
        metric: labels[key],
        value: yVal,
        mean: Math.round(mean * 10) / 10,
        sigma: Math.round(sigma * 10) / 10,
        direction: yVal > mean ? '急増' : '急減'
      });
    }
  }

  return { yesterday: yesterday, avg7d: avg7d, weekOverWeek: weekOverWeek, anomalies: anomalies };
}

// =====================================================
// データ抽出: GA4 API 昨日1日分（流入元 + ファネル）
// =====================================================

/**
 * GA4 API直接呼び出しで昨日1日分の流入元・ファネルを取得
 * ga4Run_() (GA4Analytics.gs:385) を再利用
 */
function ga4advice_fetchYesterdayGA4_() {
  // 流入元（sessionSource × sessionMedium）
  var srcRpt = ga4Run_(
    [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    [{ name: 'sessions' }, { name: 'screenPageViews' }],
    'yesterday', 'yesterday',
    [{ metric: { metricName: 'sessions' }, desc: true }]
  );

  var sources = [];
  var totalSessions = 0;
  var srcRows = srcRpt.rows || [];
  for (var i = 0; i < srcRows.length; i++) {
    var d = srcRows[i].dimensionValues;
    var m = srcRows[i].metricValues;
    var sessions = +m[0].value || 0;
    totalSessions += sessions;
    sources.push({
      source: String(d[0].value || '(direct)'),
      medium: String(d[1].value || '(none)'),
      sessions: sessions,
      pv: +m[1].value || 0
    });
  }
  for (var j = 0; j < sources.length; j++) {
    sources[j].share = totalSessions > 0 ? (sources[j].sessions / totalSessions * 100) : 0;
  }

  // ファネル（eventName）
  var evRpt = ga4Run_(
    [{ name: 'eventName' }],
    [{ name: 'eventCount' }],
    'yesterday', 'yesterday',
    [{ metric: { metricName: 'eventCount' }, desc: true }]
  );

  var eventMap = {};
  var evRows = evRpt.rows || [];
  for (var k = 0; k < evRows.length; k++) {
    eventMap[evRows[k].dimensionValues[0].value] = +evRows[k].metricValues[0].value || 0;
  }

  var funnelSteps = [
    { key: 'view_item_list', label: '商品一覧表示' },
    { key: 'view_item', label: '商品詳細表示' },
    { key: 'add_to_cart', label: 'カート追加' },
    { key: 'begin_checkout', label: '注文開始' },
    { key: 'redirect_to_payment', label: '決済ページ遷移' }
  ];
  var topCount = eventMap[funnelSteps[0].key] || 0;
  var funnel = [];
  for (var f = 0; f < funnelSteps.length; f++) {
    var c = eventMap[funnelSteps[f].key] || 0;
    var prevC = f === 0 ? c : (eventMap[funnelSteps[f - 1].key] || 0);
    funnel.push({
      label: funnelSteps[f].label,
      count: c,
      stepRate: f === 0 ? 100 : (prevC > 0 ? (c / prevC * 100) : 0),
      overallRate: topCount > 0 ? (c / topCount * 100) : 0
    });
  }

  return { sources: sources, totalSessions: totalSessions, funnel: funnel };
}

// =====================================================
// データ抽出: 注文データ（依頼管理シート）
// =====================================================

/**
 * 依頼管理シートから注文データを集計
 * B列(日時), K列(点数), L列(金額), D列(メール), O列(決済), AG列(チャネル)
 */
function ga4advice_collectOrderMetrics_() {
  var ssId = app_getOrderSpreadsheetId_();
  if (!ssId) return null;
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var data = sh.getRange(2, 1, lastRow - 1, REQUEST_SHEET_COLS.CHANNEL).getValues();

  var tz = 'Asia/Tokyo';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var todayStart = new Date(todayStr + 'T00:00:00+09:00');
  var oneDayMs = 24 * 60 * 60 * 1000;
  var yesterdayStart = new Date(todayStart.getTime() - oneDayMs);
  var sevenDaysAgo = new Date(todayStart.getTime() - 7 * oneDayMs);
  var fourteenDaysAgo = new Date(todayStart.getTime() - 14 * oneDayMs);

  // 0-indexed column positions
  var iDate = REQUEST_SHEET_COLS.DATETIME - 1;      // B(1)
  var iEmail = REQUEST_SHEET_COLS.CONTACT - 1;       // D(3)
  var iCount = REQUEST_SHEET_COLS.TOTAL_COUNT - 1;   // K(10)
  var iAmount = REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1;  // L(11)
  var iPayment = REQUEST_SHEET_COLS.PAYMENT_METHOD - 1; // O(14)
  var iStatus = REQUEST_SHEET_COLS.STATUS - 1;        // V(21)
  var iChannel = REQUEST_SHEET_COLS.CHANNEL - 1;      // AG(32)

  var yesterdayOrd = { count: 0, amount: 0, items: 0 };
  var week = { count: 0, amount: 0, items: 0 };
  var prevWeek = { count: 0, amount: 0, items: 0 };
  var channelMap = {};
  var paymentMap = {};
  var completedEmails = {};

  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][iStatus] || '').trim();
    if (status === 'キャンセル' || status === '返品') continue;
    if (!data[i][0]) continue; // 受付番号が空ならスキップ

    var dateVal = data[i][iDate];
    if (!(dateVal instanceof Date)) continue;

    var amount = +data[i][iAmount] || 0;
    var items = +data[i][iCount] || 0;
    var channel = String(data[i][iChannel] || '').trim() || '不明';
    var payment = String(data[i][iPayment] || '').trim() || '不明';
    var email = String(data[i][iEmail] || '').trim().toLowerCase();

    // 昨日
    if (dateVal >= yesterdayStart && dateVal < todayStart) {
      yesterdayOrd.count++;
      yesterdayOrd.amount += amount;
      yesterdayOrd.items += items;
    }

    // 直近7日
    if (dateVal >= sevenDaysAgo && dateVal < todayStart) {
      week.count++;
      week.amount += amount;
      week.items += items;
      channelMap[channel] = (channelMap[channel] || 0) + 1;
      paymentMap[payment] = (paymentMap[payment] || 0) + 1;
    }

    // 前週（7〜14日前）
    if (dateVal >= fourteenDaysAgo && dateVal < sevenDaysAgo) {
      prevWeek.count++;
      prevWeek.amount += amount;
      prevWeek.items += items;
    }

    // リピート率用（完了注文のメール）
    if (status === '完了' && email) {
      completedEmails[email] = (completedEmails[email] || 0) + 1;
    }
  }

  // AOV
  var aov = week.count > 0 ? Math.round(week.amount / week.count) : 0;

  // 前週比
  var wowCount = prevWeek.count > 0 ? ((week.count - prevWeek.count) / prevWeek.count * 100) : 0;
  var wowAmount = prevWeek.amount > 0 ? ((week.amount - prevWeek.amount) / prevWeek.amount * 100) : 0;

  // リピート率
  var emailKeys = Object.keys(completedEmails);
  var uniqueCustomers = emailKeys.length;
  var repeatCustomers = 0;
  for (var e = 0; e < emailKeys.length; e++) {
    if (completedEmails[emailKeys[e]] >= 2) repeatCustomers++;
  }
  var repeatRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers * 100) : 0;

  // チャネル内訳
  var channels = [];
  var chKeys = Object.keys(channelMap);
  for (var ci = 0; ci < chKeys.length; ci++) {
    channels.push({ name: chKeys[ci], count: channelMap[chKeys[ci]] });
  }
  channels.sort(function(a, b) { return b.count - a.count; });

  // 決済方法内訳
  var payments = [];
  var pKeys = Object.keys(paymentMap);
  for (var pi = 0; pi < pKeys.length; pi++) {
    payments.push({ name: pKeys[pi], count: paymentMap[pKeys[pi]] });
  }
  payments.sort(function(a, b) { return b.count - a.count; });

  return {
    yesterday: yesterdayOrd,
    week: week,
    prevWeek: prevWeek,
    aov: aov,
    wowCount: wowCount,
    wowAmount: wowAmount,
    channels: channels,
    payments: payments,
    repeatRate: repeatRate,
    uniqueCustomers: uniqueCustomers,
    repeatCustomers: repeatCustomers
  };
}

// =====================================================
// データ抽出: 週次注文 + ニュースレター配信履歴
// =====================================================

/**
 * 注文集計 + ニュースレター配信履歴（直近7日）
 */
function ga4advice_collectWeeklyOrderMetrics_() {
  var orders = ga4advice_collectOrderMetrics_();

  // ニュースレター配信履歴（直近7日）
  var newsletters = [];
  try {
    var nlSs = sh_getOrderSs_();
    var nlSh = nlSs.getSheetByName('ニュースレター');
    if (nlSh) {
      var nlLast = nlSh.getLastRow();
      if (nlLast >= 2) {
        var nlData = nlSh.getRange(2, 1, nlLast - 1, 7).getValues();
        var tz = 'Asia/Tokyo';
        var sevenDaysAgo = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000);
        for (var i = 0; i < nlData.length; i++) {
          var title = String(nlData[i][0] || '').trim();
          var nlStatus = String(nlData[i][3] || '').trim();
          var sentDate = nlData[i][5]; // F列: 最終配信日
          if (!sentDate && nlData[i][2]) sentDate = nlData[i][2]; // C列: 配信日時
          if (!(sentDate instanceof Date)) continue;
          if (nlStatus !== '配信済み' && nlStatus !== '配信完了') continue;
          if (sentDate >= sevenDaysAgo) {
            newsletters.push({
              title: title,
              date: Utilities.formatDate(sentDate, tz, 'MM/dd'),
              target: String(nlData[i][6] || '全員').trim()
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('ga4advice: ニュースレター履歴取得失敗:', e);
  }

  return { orders: orders, newsletters: newsletters };
}

// =====================================================
// OpenAI: プロンプト（週次用）
// =====================================================

/**
 * 週次用プロンプト（「最優先1アクション」形式）
 */
function ga4advice_buildWeeklyPrompt_(daily, yesterdayGA4, weeklyData) {
  var system = [
    'あなたは「デタウリ.Detauri」専属のECコンサルタントです。',
    'デタウリは BtoB古着卸売EC で、最低5点からの注文、まとめ割引あり。',
    'メインターゲットは副業で古着販売をする個人。1人運営のため実行可能性が重要。',
    '',
    '出力フォーマット（必ずこの形式で）:',
    '### 最優先アクション',
    '[具体的なアクション名]',
    '### 理由',
    '[データに基づく根拠を2-3文で]',
    '### 想定インパクト',
    '[金額または件数の定量的見積もり]',
    '',
    'ルール:',
    '- 抽象アドバイス禁止（「SNSを頑張りましょう」等はNG。具体的に何をどうするか書く）',
    '- 1人運営を考慮した実行可能性重視（大規模施策NG）',
    '- 必ずデータの数値を引用して根拠を示す',
    '- 日本語で回答'
  ].join('\n');

  var y = daily.yesterday;
  var a = daily.avg7d;
  var w = daily.weekOverWeek;

  var userContent = [
    '=== GA4 週次データ ===',
    '■ 昨日 (' + y.date + ')',
    '  ユーザー: ' + y.users + ', 新規: ' + y.newUsers + ', セッション: ' + y.sessions,
    '  PV: ' + y.pv + ', エンゲージ率: ' + (y.engagementRate * 100).toFixed(1) + '%, 平均滞在: ' + y.avgDuration + '秒',
    '',
    '■ 7日平均',
    '  ユーザー: ' + a.users.toFixed(1) + ', 新規: ' + a.newUsers.toFixed(1) + ', セッション: ' + a.sessions.toFixed(1),
    '  PV: ' + a.pv.toFixed(1) + ', エンゲージ率: ' + (a.engagementRate * 100).toFixed(1) + '%, 平均滞在: ' + a.avgDuration.toFixed(0) + '秒',
    '',
    '■ 前週比',
    '  ユーザー: ' + w.users.toFixed(1) + '%, 新規: ' + w.newUsers.toFixed(1) + '%, セッション: ' + w.sessions.toFixed(1) + '%, PV: ' + w.pv.toFixed(1) + '%'
  ];

  if (daily.anomalies.length > 0) {
    userContent.push('');
    userContent.push('■ 異常検出');
    for (var i = 0; i < daily.anomalies.length; i++) {
      var an = daily.anomalies[i];
      userContent.push('  ' + an.metric + ': ' + an.value + ' (' + an.direction + ', 平均' + an.mean + '±' + an.sigma + ')');
    }
  }

  // 昨日のGA4流入元・ファネル
  if (yesterdayGA4) {
    userContent.push('');
    userContent.push('=== 昨日の流入元 TOP5 ===');
    var top5 = yesterdayGA4.sources.slice(0, 5);
    for (var s = 0; s < top5.length; s++) {
      var src = top5[s];
      userContent.push('  ' + (s + 1) + '. ' + src.source + ' / ' + src.medium + ' — セッション: ' + src.sessions + ' (' + src.share.toFixed(1) + '%)');
    }
    userContent.push('  合計セッション: ' + yesterdayGA4.totalSessions);

    userContent.push('');
    userContent.push('=== 昨日のファネル ===');
    for (var f = 0; f < yesterdayGA4.funnel.length; f++) {
      var step = yesterdayGA4.funnel[f];
      userContent.push('  ' + (f + 1) + '. ' + step.label + ': ' + step.count + '回 (転換率: ' + step.stepRate.toFixed(1) + '%, 全体: ' + step.overallRate.toFixed(1) + '%)');
    }
  }

  // 注文データ
  var orders = weeklyData && weeklyData.orders;
  if (orders) {
    var fmtYen = function(v) { return '¥' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    userContent.push('');
    userContent.push('=== 注文データ ===');
    userContent.push('■ 昨日: ' + orders.yesterday.count + '件, 売上' + fmtYen(orders.yesterday.amount) + ', ' + orders.yesterday.items + '点');
    userContent.push('■ 直近7日: ' + orders.week.count + '件, 売上' + fmtYen(orders.week.amount) + ', ' + orders.week.items + '点');
    userContent.push('■ 前週: ' + orders.prevWeek.count + '件, 売上' + fmtYen(orders.prevWeek.amount));
    userContent.push('■ AOV(平均注文単価): ' + fmtYen(orders.aov));
    userContent.push('■ 前週比: 件数' + (orders.wowCount >= 0 ? '+' : '') + orders.wowCount.toFixed(1) + '%, 売上' + (orders.wowAmount >= 0 ? '+' : '') + orders.wowAmount.toFixed(1) + '%');

    if (orders.channels.length > 0) {
      userContent.push('■ チャネル別(7日):');
      for (var ch = 0; ch < orders.channels.length; ch++) {
        userContent.push('  ' + orders.channels[ch].name + ': ' + orders.channels[ch].count + '件');
      }
    }
    if (orders.payments.length > 0) {
      userContent.push('■ 決済方法別(7日):');
      for (var pm = 0; pm < orders.payments.length; pm++) {
        userContent.push('  ' + orders.payments[pm].name + ': ' + orders.payments[pm].count + '件');
      }
    }
    userContent.push('■ リピート率: ' + orders.repeatRate.toFixed(1) + '% (' + orders.repeatCustomers + '/' + orders.uniqueCustomers + '人)');
  }

  // ニュースレター配信履歴
  var newsletters = weeklyData && weeklyData.newsletters;
  if (newsletters && newsletters.length > 0) {
    userContent.push('');
    userContent.push('=== メルマガ配信履歴（直近7日） ===');
    for (var n = 0; n < newsletters.length; n++) {
      var nl = newsletters[n];
      userContent.push('  ' + nl.date + ' 「' + nl.title + '」 (対象: ' + nl.target + ')');
    }
  } else {
    userContent.push('');
    userContent.push('=== メルマガ配信履歴 ===');
    userContent.push('  直近7日間の配信なし');
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent.join('\n') }
  ];
}

// =====================================================
// OpenAI API呼び出し
// =====================================================

/**
 * OpenAI API呼び出し（Chatbot.gs パターン流用）
 */
function ga4advice_callAI_(messages) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定');

  var payload = {
    model: 'gpt-5-mini',
    messages: messages,
    max_completion_tokens: 16000
  };

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    console.error('ga4advice OpenAI error: ' + code + ' ' + body);
    throw new Error('OpenAI API失敗: ' + code);
  }

  var json = JSON.parse(body);
  if (json.choices && json.choices[0] && json.choices[0].message) {
    var msg = json.choices[0].message;
    if (msg.refusal) {
      throw new Error('AI refusal: ' + msg.refusal);
    }
    return String(msg.content || '').trim();
  }
  throw new Error('OpenAI応答が不正です');
}

// =====================================================
// メール: 日次アラートHTML
// =====================================================

/**
 * 日次アラートメールHTML生成
 * セクション: 異常値 → 主要指標 → 流入元TOP3
 */
function ga4advice_buildAlertEmail_(daily, yesterdayGA4) {
  var y = daily.yesterday;
  var dateStr = y.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // 件名に異常内容を含める
  var anomalyLabels = [];
  for (var i = 0; i < daily.anomalies.length; i++) {
    anomalyLabels.push(daily.anomalies[i].metric + daily.anomalies[i].direction);
  }
  var subject = '【デタウリ】GA4アラート: ' + anomalyLabels.join(', ') + '（' + dateStr + '）';

  var fmtPct = function(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var fmtNum = function(v) { return String(Math.round(v)); };
  var a = daily.avg7d;
  var w = daily.weekOverWeek;

  var sections = [];

  // [1] 異常値
  var anomalyItems = [];
  for (var ai = 0; ai < daily.anomalies.length; ai++) {
    var an = daily.anomalies[ai];
    anomalyItems.push(an.metric + ': ' + an.value + '（' + an.direction + ' / 7日平均: ' + an.mean + ' ± ' + an.sigma + '）');
  }
  sections.push({ title: '⚠ 異常値検出', items: anomalyItems });

  // [2] 主要指標
  sections.push({
    title: '📊 主要指標',
    rows: [
      { label: 'ユーザー', value: y.users + '（7日平均: ' + fmtNum(a.users) + ', 前週比: ' + fmtPct(w.users) + '）' },
      { label: '新規', value: y.newUsers + '（7日平均: ' + fmtNum(a.newUsers) + '）' },
      { label: 'セッション', value: y.sessions + '（7日平均: ' + fmtNum(a.sessions) + '）' },
      { label: 'PV', value: y.pv + '（7日平均: ' + fmtNum(a.pv) + '）' },
      { label: 'エンゲージ率', value: (y.engagementRate * 100).toFixed(1) + '%' },
      { label: '平均滞在', value: y.avgDuration + '秒' }
    ]
  });

  // [3] 流入元TOP3（昨日）
  if (yesterdayGA4 && yesterdayGA4.sources.length > 0) {
    var srcRows = [];
    var top3 = yesterdayGA4.sources.slice(0, 3);
    for (var s = 0; s < top3.length; s++) {
      var t = top3[s];
      srcRows.push({
        label: (s + 1) + '. ' + t.source + ' / ' + t.medium,
        value: 'セッション: ' + t.sessions + '（' + t.share.toFixed(1) + '%）'
      });
    }
    sections.push({ title: '🌐 流入元 TOP3（昨日）', rows: srcRows });
  }

  var html = buildHtmlEmail_({
    greeting: 'GA4アラート（' + dateStr + '）',
    lead: '昨日のGA4データで異常値を検出しました。',
    sections: sections
  });

  var textLines = ['GA4アラート（' + dateStr + '）', ''];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    textLines.push(sec.title);
    if (sec.rows) {
      for (var ri = 0; ri < sec.rows.length; ri++) {
        textLines.push('  ' + sec.rows[ri].label + ': ' + sec.rows[ri].value);
      }
    }
    if (sec.items) {
      for (var ii = 0; ii < sec.items.length; ii++) textLines.push('  ' + sec.items[ii]);
    }
    textLines.push('');
  }

  return { subject: subject, html: html, text: textLines.join('\n') };
}

// =====================================================
// メール: 週次サマリーHTML
// =====================================================

/**
 * 週次サマリーメールHTML生成
 * セクション: AIアドバイス → 注文 → GA4 → ファネル → 流入元 → 内訳 → 異常値
 */
function ga4advice_buildWeeklyEmail_(metrics, aiText) {
  var d = metrics.daily;
  var y = d.yesterday;
  var a = d.avg7d;
  var w = d.weekOverWeek;
  var ga4 = metrics.yesterdayGA4;
  var weeklyData = metrics.weeklyData;
  var orders = weeklyData && weeklyData.orders;

  var dateStr = y.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var subject = '【デタウリ】週次レポート + AIアドバイス（' + dateStr + '）';
  if (!aiText) subject = '【デタウリ】週次レポート ※AI分析なし（' + dateStr + '）';

  var fmtPct = function(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var fmtNum = function(v) { return String(Math.round(v)); };
  var fmtYen = function(v) { return '¥' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

  var sections = [];

  // [1] AIアドバイス
  if (aiText) {
    sections.push({ title: '🤖 AIアドバイス（最優先1アクション）', text: aiText });
  }

  // [2] 注文サマリー
  if (orders) {
    sections.push({
      title: '🛒 注文サマリー（直近7日）',
      rows: [
        { label: '昨日', value: orders.yesterday.count + '件 / ' + fmtYen(orders.yesterday.amount) + ' / ' + orders.yesterday.items + '点' },
        { label: '直近7日', value: orders.week.count + '件 / ' + fmtYen(orders.week.amount) + ' / ' + orders.week.items + '点' },
        { label: 'AOV(平均注文単価)', value: fmtYen(orders.aov) },
        { label: '前週比', value: '件数' + fmtPct(orders.wowCount) + ' / 売上' + fmtPct(orders.wowAmount) },
        { label: 'リピート率', value: orders.repeatRate.toFixed(1) + '%（' + orders.repeatCustomers + '/' + orders.uniqueCustomers + '人）' }
      ]
    });
  }

  // [3] GA4主要指標
  sections.push({
    title: '📊 GA4主要指標',
    rows: [
      { label: 'ユーザー', value: y.users + '（7日平均: ' + fmtNum(a.users) + ', 前週比: ' + fmtPct(w.users) + '）' },
      { label: '新規', value: y.newUsers + '（7日平均: ' + fmtNum(a.newUsers) + ', 前週比: ' + fmtPct(w.newUsers) + '）' },
      { label: 'セッション', value: y.sessions + '（7日平均: ' + fmtNum(a.sessions) + ', 前週比: ' + fmtPct(w.sessions) + '）' },
      { label: 'PV', value: y.pv + '（7日平均: ' + fmtNum(a.pv) + ', 前週比: ' + fmtPct(w.pv) + '）' },
      { label: 'エンゲージ率', value: (y.engagementRate * 100).toFixed(1) + '%（7日平均: ' + (a.engagementRate * 100).toFixed(1) + '%）' },
      { label: '平均滞在時間', value: y.avgDuration + '秒（7日平均: ' + fmtNum(a.avgDuration) + '秒）' }
    ]
  });

  // [4] ファネル（昨日）
  if (ga4 && ga4.funnel) {
    var funnelRows = [];
    for (var f = 0; f < ga4.funnel.length; f++) {
      var step = ga4.funnel[f];
      var rateStr = f === 0 ? '-' : step.stepRate.toFixed(1) + '%';
      funnelRows.push({
        label: (f + 1) + '. ' + step.label,
        value: step.count + '回（転換率: ' + rateStr + ', 全体: ' + step.overallRate.toFixed(1) + '%）'
      });
    }
    sections.push({ title: '🔄 ファネル（昨日）', rows: funnelRows });
  }

  // [5] 流入元TOP5（昨日）
  if (ga4 && ga4.sources.length > 0) {
    var srcRows = [];
    var top5 = ga4.sources.slice(0, 5);
    for (var s = 0; s < top5.length; s++) {
      var t = top5[s];
      srcRows.push({
        label: (s + 1) + '. ' + t.source + ' / ' + t.medium,
        value: 'セッション: ' + t.sessions + '（' + t.share.toFixed(1) + '%）'
      });
    }
    sections.push({ title: '🌐 流入元 TOP5（昨日）', rows: srcRows });
  }

  // [6] チャネル別・決済別内訳
  if (orders) {
    var breakdownRows = [];
    if (orders.channels.length > 0) {
      for (var ch = 0; ch < orders.channels.length; ch++) {
        breakdownRows.push({
          label: 'チャネル: ' + orders.channels[ch].name,
          value: orders.channels[ch].count + '件'
        });
      }
    }
    if (orders.payments.length > 0) {
      for (var pm = 0; pm < orders.payments.length; pm++) {
        breakdownRows.push({
          label: '決済: ' + orders.payments[pm].name,
          value: orders.payments[pm].count + '件'
        });
      }
    }
    if (breakdownRows.length > 0) {
      sections.push({ title: '📋 内訳（直近7日）', rows: breakdownRows });
    }
  }

  // [7] 異常値
  if (d.anomalies.length > 0) {
    var anomalyItems = [];
    for (var ai = 0; ai < d.anomalies.length; ai++) {
      var an = d.anomalies[ai];
      anomalyItems.push(an.metric + ': ' + an.value + '（' + an.direction + ' / 7日平均: ' + an.mean + '）');
    }
    sections.push({ title: '⚠ 異常値検出', items: anomalyItems });
  }

  var html = buildHtmlEmail_({
    greeting: '週次レポート（' + dateStr + '）',
    lead: '先週のGA4データ・注文データとAI分析結果をお届けします。',
    sections: sections
  });

  var textLines = ['週次レポート（' + dateStr + '）', ''];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    textLines.push(sec.title);
    if (sec.rows) {
      for (var ri = 0; ri < sec.rows.length; ri++) {
        textLines.push('  ' + sec.rows[ri].label + ': ' + sec.rows[ri].value);
      }
    }
    if (sec.text) textLines.push(sec.text);
    if (sec.items) {
      for (var ii = 0; ii < sec.items.length; ii++) textLines.push('  ' + sec.items[ii]);
    }
    textLines.push('');
  }

  return { subject: subject, html: html, text: textLines.join('\n') };
}

// =====================================================
// メール送信
// =====================================================

/**
 * メール送信
 */
function ga4advice_sendEmail_(adminEmail, emailData) {
  MailApp.sendEmail({
    to: adminEmail,
    subject: emailData.subject,
    body: emailData.text,
    htmlBody: emailData.html,
    noReply: true
  });
  console.log('ga4advice_sendEmail_: 送信完了 → ' + adminEmail);
}

// =====================================================
// テスト
// =====================================================

/**
 * 日次アラートテスト（GASエディタから実行）
 * 異常があればアラートメール、なければ送信なし
 */
function testGA4AdviceDaily() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) { console.log('ADMIN_OWNER_EMAIL 未設定'); return; }
  ga4advice_dailyAlert_(adminEmail);
}

/**
 * 週次サマリーテスト（GASエディタから実行）
 * 管理者メールに週次レポート + AI「最優先1アクション」が届く
 */
function testGA4AdviceWeekly() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) { console.log('ADMIN_OWNER_EMAIL 未設定'); return; }
  ga4advice_weeklySummary_(adminEmail);
}
