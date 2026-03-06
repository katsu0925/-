// GA4Advice.gs
// =====================================================
// GA4 AI日次アドバイスメール
// 毎朝9時にGA4データを分析し、OpenAI経由でアクション提案付きメールを管理者に送信
// =====================================================

/**
 * エントリポイント（cronDaily9 から呼ばれる）
 * GA4シートからデータ抽出 → OpenAI分析 → メール送信
 */
function ga4advice_cron() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) {
    console.log('ga4advice_cron: ADMIN_OWNER_EMAIL が未設定のためスキップ');
    return;
  }

  var ss = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());

  var daily  = ga4advice_extractDailyMetrics_(ss);
  var source = ga4advice_extractSourceMetrics_(ss);
  var event  = ga4advice_extractEventMetrics_(ss);

  // OpenAI 分析（失敗時は null）
  var aiText = null;
  try {
    var messages = ga4advice_buildPrompt_(daily, source, event);
    aiText = ga4advice_callAI_(messages);
  } catch (e) {
    console.error('ga4advice_cron: AI分析失敗:', e);
  }

  var emailData = ga4advice_buildEmail_({ daily: daily, source: source, event: event }, aiText);
  ga4advice_sendEmail_(adminEmail, emailData);
  console.log('ga4advice_cron: 完了');
}

// =====================================================
// データ抽出
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
  if (lastRow < 3) return defaults; // ヘッダー+データ1行+合計行 = 最低3行

  // データ行: 2行目〜(lastRow-1行目)。lastRow行目は合計/平均行
  var dataEnd = lastRow - 1;
  var numData = dataEnd - 1; // データ行数
  if (numData < 1) return defaults;

  var all = sh.getRange(2, 1, numData, 7).getValues();

  // 昨日 = 最終データ行
  var last = all[all.length - 1];
  var yesterday = {
    date: String(last[0] || '-'),
    users: +last[1] || 0,
    newUsers: +last[2] || 0,
    sessions: +last[3] || 0,
    pv: +last[4] || 0,
    engagementRate: +last[5] || 0,
    avgDuration: +last[6] || 0
  };

  // 直近7日
  var recent7 = all.slice(Math.max(0, all.length - 7));
  var keys = ['users', 'newUsers', 'sessions', 'pv', 'engagementRate', 'avgDuration'];
  var colIdx = [1, 2, 3, 4, 5, 6];
  var avg7d = {};
  for (var k = 0; k < keys.length; k++) {
    var sum = 0;
    for (var r = 0; r < recent7.length; r++) sum += (+recent7[r][colIdx[k]] || 0);
    avg7d[keys[k]] = recent7.length > 0 ? sum / recent7.length : 0;
  }

  // 前週比: 直近7日合計 vs その前7日合計
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

  // 異常検出: 昨日の値が7日平均±1.5σ超
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
    if (sigma > 0 && Math.abs(yVal - mean) > 1.5 * sigma) {
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

/**
 * GA4流入元からTOP5+構成比を抽出
 * シート: 1行目=期間表示, 2行目=ヘッダー, 3行目〜=データ
 * 列: 流入元 / メディア / キャンペーン / ユーザー / セッション / PV
 */
function ga4advice_extractSourceMetrics_(ss) {
  var defaults = { top5: [], totalSessions: 0 };

  var sh = ss.getSheetByName('GA4流入元');
  if (!sh) return defaults;
  var lastRow = sh.getLastRow();
  if (lastRow < 4) return defaults; // 期間行+ヘッダー+データ1行+合計行

  // データ: 3行目〜(lastRow-1)。lastRow=合計行
  var dataEnd = lastRow - 1;
  var numData = dataEnd - 2;
  if (numData < 1) return defaults;

  var data = sh.getRange(3, 1, numData, 6).getValues();
  var totalSessions = 0;
  for (var i = 0; i < data.length; i++) totalSessions += (+data[i][4] || 0);

  var top5 = [];
  for (var j = 0; j < Math.min(5, data.length); j++) {
    var sessions = +data[j][4] || 0;
    top5.push({
      source: String(data[j][0] || ''),
      medium: String(data[j][1] || ''),
      sessions: sessions,
      pv: +data[j][5] || 0,
      share: totalSessions > 0 ? (sessions / totalSessions * 100) : 0
    });
  }

  return { top5: top5, totalSessions: totalSessions };
}

/**
 * GA4イベントからファネル再構築
 * シート: 1行目=期間表示, 2行目=ヘッダー, 3行目〜=データ
 * 列: イベント名 / 回数 / 元の名称
 */
function ga4advice_extractEventMetrics_(ss) {
  var funnelSteps = [
    { key: 'view_item_list', label: '商品一覧表示' },
    { key: 'view_item', label: '商品詳細表示' },
    { key: 'add_to_cart', label: 'カート追加' },
    { key: 'begin_checkout', label: '注文開始' },
    { key: 'redirect_to_payment', label: '決済ページ遷移' }
  ];
  var defaults = { funnel: funnelSteps.map(function(s) { return { label: s.label, count: 0, stepRate: 0, overallRate: 0 }; }) };

  var sh = ss.getSheetByName('GA4イベント');
  if (!sh) return defaults;
  var lastRow = sh.getLastRow();
  if (lastRow < 4) return defaults;

  var dataEnd = lastRow - 1;
  var numData = dataEnd - 2;
  if (numData < 1) return defaults;

  var data = sh.getRange(3, 1, numData, 3).getValues();
  // 元の名称(C列)またはイベント名(A列)で回数をマッピング
  var eventMap = {};
  for (var i = 0; i < data.length; i++) {
    var origName = String(data[i][2] || '').trim();
    var dispName = String(data[i][0] || '').trim();
    var count = +data[i][1] || 0;
    if (origName) eventMap[origName] = count;
    if (dispName) eventMap[dispName] = count;
  }

  var topCount = eventMap[funnelSteps[0].key] || eventMap[funnelSteps[0].label] || 0;
  var funnel = [];
  for (var f = 0; f < funnelSteps.length; f++) {
    var c = eventMap[funnelSteps[f].key] || eventMap[funnelSteps[f].label] || 0;
    var prevC = f === 0 ? c : (eventMap[funnelSteps[f - 1].key] || eventMap[funnelSteps[f - 1].label] || 0);
    funnel.push({
      label: funnelSteps[f].label,
      count: c,
      stepRate: f === 0 ? 100 : (prevC > 0 ? (c / prevC * 100) : 0),
      overallRate: topCount > 0 ? (c / topCount * 100) : 0
    });
  }

  return { funnel: funnel };
}

// =====================================================
// OpenAI
// =====================================================

/**
 * OpenAI用プロンプト生成
 */
function ga4advice_buildPrompt_(daily, source, event) {
  var system = [
    'あなたは「デタウリ.Detauri」のECデータアナリストです。',
    'デタウリは BtoB古着卸売EC で、最低5点からの注文、まとめ割引あり。',
    'メインターゲットは副業で古着販売をする個人。',
    '',
    '以下の観点で分析してください:',
    '1. トラフィック評価（前週比の変動、異常値があれば仮説）',
    '2. ファネルのボトルネック（どのステップで離脱が大きいか）',
    '3. 流入元の改善提案（注力すべきチャネル）',
    '4. 具体的なアクション提案（3〜5個）',
    '',
    '出力形式:',
    '- 3〜5個の箇条書き',
    '- 各項目に優先度タグ [高][中][低] を付ける',
    '- 具体的な数値を引用する',
    '- 日本語で回答'
  ].join('\n');

  var y = daily.yesterday;
  var a = daily.avg7d;
  var w = daily.weekOverWeek;

  var userContent = [
    '=== GA4日次データ ===',
    '■ 昨日 (' + y.date + ')',
    '  ユーザー: ' + y.users + ', 新規: ' + y.newUsers + ', セッション: ' + y.sessions,
    '  PV: ' + y.pv + ', エンゲージ率: ' + (y.engagementRate * 100).toFixed(1) + '%, 平均滞在: ' + y.avgDuration + '秒',
    '',
    '■ 7日平均',
    '  ユーザー: ' + a.users.toFixed(1) + ', 新規: ' + a.newUsers.toFixed(1) + ', セッション: ' + a.sessions.toFixed(1),
    '  PV: ' + a.pv.toFixed(1) + ', エンゲージ率: ' + (a.engagementRate * 100).toFixed(1) + '%, 平均滞在: ' + a.avgDuration.toFixed(0) + '秒',
    '',
    '■ 前週比 (直近7日 vs その前7日)',
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

  userContent.push('');
  userContent.push('=== 流入元 TOP5 ===');
  for (var s = 0; s < source.top5.length; s++) {
    var src = source.top5[s];
    userContent.push('  ' + (s + 1) + '. ' + src.source + ' / ' + src.medium + ' — セッション: ' + src.sessions + ' (' + src.share.toFixed(1) + '%)');
  }
  userContent.push('  合計セッション: ' + source.totalSessions);

  userContent.push('');
  userContent.push('=== コンバージョンファネル ===');
  for (var f = 0; f < event.funnel.length; f++) {
    var step = event.funnel[f];
    userContent.push('  ' + (f + 1) + '. ' + step.label + ': ' + step.count + '回 (前ステップ転換率: ' + step.stepRate.toFixed(1) + '%, 全体: ' + step.overallRate.toFixed(1) + '%)');
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent.join('\n') }
  ];
}

/**
 * OpenAI API呼び出し（Chatbot.gs パターン流用）
 */
function ga4advice_callAI_(messages) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定');

  var payload = {
    model: 'gpt-4.1-mini',
    messages: messages,
    max_tokens: 1000,
    temperature: 0.5
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
  if (!json.choices || !json.choices[0] || !json.choices[0].message) {
    throw new Error('OpenAI応答が不正です');
  }
  return String(json.choices[0].message.content || '').trim();
}

// =====================================================
// メール組み立て・送信
// =====================================================

/**
 * メールHTML生成
 * @param {object} metrics - { daily, source, event }
 * @param {string|null} aiText - AI分析結果（nullならAIセクション省略）
 * @returns {{ subject: string, html: string, text: string }}
 */
function ga4advice_buildEmail_(metrics, aiText) {
  var d = metrics.daily;
  var y = d.yesterday;
  var a = d.avg7d;
  var w = d.weekOverWeek;

  var dateStr = y.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var subject = '【デタウリ】GA4日次レポート + AIアドバイス（' + dateStr + '）';
  if (!aiText) subject = '【デタウリ】GA4日次レポート ※AI分析なし（' + dateStr + '）';

  var fmtPct = function(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var fmtNum = function(v) { return String(Math.round(v)); };

  // セクション構築
  var sections = [];

  // [1] 主要指標サマリー
  sections.push({
    title: '📊 主要指標サマリー',
    rows: [
      { label: 'ユーザー', value: y.users + '（7日平均: ' + fmtNum(a.users) + ', 前週比: ' + fmtPct(w.users) + '）' },
      { label: '新規ユーザー', value: y.newUsers + '（7日平均: ' + fmtNum(a.newUsers) + ', 前週比: ' + fmtPct(w.newUsers) + '）' },
      { label: 'セッション', value: y.sessions + '（7日平均: ' + fmtNum(a.sessions) + ', 前週比: ' + fmtPct(w.sessions) + '）' },
      { label: 'PV', value: y.pv + '（7日平均: ' + fmtNum(a.pv) + ', 前週比: ' + fmtPct(w.pv) + '）' },
      { label: 'エンゲージ率', value: (y.engagementRate * 100).toFixed(1) + '%（7日平均: ' + (a.engagementRate * 100).toFixed(1) + '%）' },
      { label: '平均滞在時間', value: y.avgDuration + '秒（7日平均: ' + fmtNum(a.avgDuration) + '秒）' }
    ]
  });

  // [2] コンバージョンファネル
  var funnelRows = [];
  var ev = metrics.event;
  for (var f = 0; f < ev.funnel.length; f++) {
    var step = ev.funnel[f];
    var rateStr = f === 0 ? '-' : step.stepRate.toFixed(1) + '%';
    funnelRows.push({
      label: (f + 1) + '. ' + step.label,
      value: step.count + '回（転換率: ' + rateStr + ', 全体: ' + step.overallRate.toFixed(1) + '%）'
    });
  }
  sections.push({ title: '🔄 コンバージョンファネル', rows: funnelRows });

  // [3] 流入元TOP5
  var srcRows = [];
  var src = metrics.source;
  for (var s = 0; s < src.top5.length; s++) {
    var t = src.top5[s];
    srcRows.push({
      label: (s + 1) + '. ' + t.source + ' / ' + t.medium,
      value: 'セッション: ' + t.sessions + '（' + t.share.toFixed(1) + '%）'
    });
  }
  if (srcRows.length > 0) sections.push({ title: '🌐 流入元 TOP5', rows: srcRows });

  // [4] AIアドバイス
  if (aiText) {
    sections.push({ title: '🤖 AIアドバイス', text: aiText });
  }

  // [5] 異常値検出
  if (d.anomalies.length > 0) {
    var anomalyItems = [];
    for (var ai = 0; ai < d.anomalies.length; ai++) {
      var an = d.anomalies[ai];
      anomalyItems.push('⚠ ' + an.metric + ': ' + an.value + '（' + an.direction + ' / 7日平均: ' + an.mean + '）');
    }
    sections.push({ title: '⚠ 異常値検出', items: anomalyItems });
  }

  var html = buildHtmlEmail_({
    greeting: 'GA4日次レポート（' + dateStr + '）',
    lead: '昨日のGA4データサマリーとAI分析結果をお届けします。',
    sections: sections
  });

  // テキスト版（プレーンテキスト）
  var textLines = ['GA4日次レポート（' + dateStr + '）', ''];
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
 * 手動テスト用（GASエディタから実行）
 */
function testGA4Advice() {
  ga4advice_cron();
}
