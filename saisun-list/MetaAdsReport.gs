// MetaAdsReport.gs
// Meta広告マネージャのCSVをGoogleドライブから取り込み、スプレッドシートに反映

/**
 * Script Properties:
 *   META_CSV_FOLDER_ID — CSVアップロード先のGoogleドライブフォルダID
 */

var META_REPORT_SHEET_NAME_ = 'Meta広告レポート';

/** CSVヘッダー → シート列のマッピング */
var META_CSV_COLUMNS_ = [
  { csv: '広告の名前',                         label: '広告名' },
  { csv: '広告の配信',                         label: 'ステータス' },
  { csv: 'インプレッション',                   label: 'インプレッション' },
  { csv: 'リーチ',                             label: 'リーチ' },
  { csv: 'フリークエンシー',                   label: 'フリークエンシー' },
  { csv: 'リンクのクリック',                   label: 'クリック数' },
  { csv: 'CTR(リンククリックスルー率)',         label: 'CTR(%)' },
  { csv: 'CPC(リンククリックの単価) (JPY)',    label: 'CPC(円)' },
  { csv: '消化金額 (JPY)',                     label: '消化金額(円)' },
  { csv: 'CPM(インプレッション単価) (JPY)',    label: 'CPM(円)' },
  { csv: '結果',                               label: 'CV数' },
  { csv: '結果の単価',                         label: 'CPA(円)' },
  { csv: 'ランディングページビュー',           label: 'LP閲覧数' },
  { csv: '品質ランキング',                     label: '品質ランキング' },
  { csv: 'エンゲージメント率ランキング',       label: 'エンゲージメント率' },
  { csv: 'コンバージョン率ランキング',         label: 'コンバージョン率' },
  { csv: 'レポート開始日',                     label: '期間開始' },
  { csv: 'レポート終了日',                     label: '期間終了' },
  { csv: '終了日時',                           label: '広告終了日' }
];

/**
 * メイン: ドライブフォルダからMeta広告CSVを取り込み、シートに反映
 * cronDaily8 から呼び出し
 */
function importMetaAdsCsv() {
  var folderId = PropertiesService.getScriptProperties().getProperty('META_CSV_FOLDER_ID');
  if (!folderId) {
    Logger.log('META_CSV_FOLDER_ID が未設定');
    return;
  }

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.CSV);

  // 最新のCSVファイルを取得（更新日時順）
  var latestFile = null;
  var latestDate = new Date(0);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getLastUpdated() > latestDate) {
      latestDate = f.getLastUpdated();
      latestFile = f;
    }
  }

  if (!latestFile) {
    Logger.log('CSVファイルが見つかりません');
    return;
  }

  var csvText = latestFile.getBlob().getDataAsString('UTF-8');
  var rows = metaParseCSV_(csvText);
  if (rows.length < 2) {
    Logger.log('CSVデータが空です');
    return;
  }

  var headerRow = rows[0];
  // CSVヘッダーのインデックスマップ
  var colIndex = {};
  for (var i = 0; i < headerRow.length; i++) {
    colIndex[headerRow[i].trim()] = i;
  }

  // activeのみフィルタリング
  var statusCol = colIndex['広告の配信'];
  var dataRows = [];
  for (var r = 1; r < rows.length; r++) {
    if (rows[r].length < 2) continue;
    var status = (rows[r][statusCol] || '').toString().trim().toLowerCase();
    if (status === 'active') {
      dataRows.push(rows[r]);
    }
  }

  if (dataRows.length === 0) {
    Logger.log('アクティブな広告が見つかりません');
    return;
  }

  // シートヘッダーとデータを構築
  var sheetHeaders = META_CSV_COLUMNS_.map(function(c) { return c.label; });
  sheetHeaders.unshift('取込日時');

  var sheetData = dataRows.map(function(row) {
    var out = [new Date()]; // 取込日時
    META_CSV_COLUMNS_.forEach(function(c) {
      var idx = colIndex[c.csv];
      var val = idx !== undefined ? (row[idx] || '').trim() : '';
      // 数値変換（ランキング系は文字列のまま）
      if (c.csv.indexOf('ランキング') === -1 && val !== '' && val !== '―' && !isNaN(Number(val))) {
        val = Number(val);
      }
      out.push(val);
    });
    return out;
  });

  // シートに書き込み
  var ss = SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
  var sheet = ss.getSheetByName(META_REPORT_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.insertSheet(META_REPORT_SHEET_NAME_);
  }

  sheet.clearContents();

  // ヘッダー
  sheet.getRange(1, 1, 1, sheetHeaders.length).setValues([sheetHeaders]);
  sheet.getRange(1, 1, 1, sheetHeaders.length)
    .setFontWeight('bold')
    .setBackground('#4267B2')
    .setFontColor('#FFFFFF');

  // データ
  if (sheetData.length > 0) {
    sheet.getRange(2, 1, sheetData.length, sheetHeaders.length).setValues(sheetData);
  }

  // 列幅自動調整
  for (var c = 1; c <= sheetHeaders.length; c++) {
    sheet.autoResizeColumn(c);
  }

  Logger.log('Meta広告レポート取込完了: ' + dataRows.length + '件 (ファイル: ' + latestFile.getName() + ')');
}

/**
 * CSV文字列をパース（ダブルクォート・カンマ対応）
 */
function metaParseCSV_(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuote = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var next = i + 1 < text.length ? text[i + 1] : '';

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// =====================================================
// AI分析 + メールアドバイス
// =====================================================

/**
 * Meta広告CSV取込 → AI分析 → メール送信（cronDaily8 から呼ぶメイン関数）
 */
function metaAdsReportAndAdvice() {
  var folderId = PropertiesService.getScriptProperties().getProperty('META_CSV_FOLDER_ID');
  if (!folderId) {
    Logger.log('META_CSV_FOLDER_ID が未設定 → スキップ');
    return;
  }

  // CSV取込（内部データも返す版）
  var result = metaImportAndExtract_();
  if (!result) return;

  // AI分析
  var aiText = null;
  try {
    var messages = metaAds_buildPrompt_(result.ads, result.totals);
    aiText = metaAds_callAI_(messages);
  } catch (e) {
    console.error('Meta広告AI分析失敗:', e);
  }

  // メール送信
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (adminEmail) {
    var emailData = metaAds_buildEmail_(result.ads, result.totals, aiText);
    MailApp.sendEmail({
      to: adminEmail,
      subject: emailData.subject,
      body: emailData.text,
      htmlBody: emailData.html,
      noReply: true
    });
    Logger.log('Meta広告レポート+AI分析メール送信完了');
  }
}

/**
 * CSV取込 + 構造化データ抽出（シート書き込みも行う）
 */
function metaImportAndExtract_() {
  var folderId = PropertiesService.getScriptProperties().getProperty('META_CSV_FOLDER_ID');
  if (!folderId) return null;

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.CSV);

  var latestFile = null;
  var latestDate = new Date(0);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getLastUpdated() > latestDate) {
      latestDate = f.getLastUpdated();
      latestFile = f;
    }
  }
  if (!latestFile) { Logger.log('CSVファイルなし'); return null; }

  var csvText = latestFile.getBlob().getDataAsString('UTF-8');
  var rows = metaParseCSV_(csvText);
  if (rows.length < 2) return null;

  var headerRow = rows[0];
  var colIndex = {};
  for (var i = 0; i < headerRow.length; i++) {
    colIndex[headerRow[i].trim()] = i;
  }

  var statusCol = colIndex['広告の配信'];
  var activeRows = [];
  for (var r = 1; r < rows.length; r++) {
    if (rows[r].length < 2) continue;
    var status = (rows[r][statusCol] || '').toString().trim().toLowerCase();
    if (status === 'active') activeRows.push(rows[r]);
  }
  if (activeRows.length === 0) { Logger.log('アクティブ広告なし'); return null; }

  // 構造化データに変換
  var ads = [];
  var totals = { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0, lpViews: 0 };

  for (var a = 0; a < activeRows.length; a++) {
    var row = activeRows[a];
    var getVal = function(csvKey) {
      var idx = colIndex[csvKey];
      return idx !== undefined ? (row[idx] || '').trim() : '';
    };
    var getNum = function(csvKey) {
      var v = getVal(csvKey);
      return (v && v !== '―') ? (Number(v) || 0) : 0;
    };

    var ad = {
      name:             getVal('広告の名前'),
      impressions:      getNum('インプレッション'),
      reach:            getNum('リーチ'),
      frequency:        getNum('フリークエンシー'),
      clicks:           getNum('リンクのクリック'),
      ctr:              getNum('CTR(リンククリックスルー率)'),
      cpc:              getNum('CPC(リンククリックの単価) (JPY)'),
      spend:            getNum('消化金額 (JPY)'),
      cpm:              getNum('CPM(インプレッション単価) (JPY)'),
      conversions:      getNum('結果'),
      cpa:              getNum('結果の単価'),
      lpViews:          getNum('ランディングページビュー'),
      qualityRanking:   getVal('品質ランキング'),
      engagementRanking:getVal('エンゲージメント率ランキング'),
      conversionRanking:getVal('コンバージョン率ランキング'),
      periodStart:      getVal('レポート開始日'),
      periodEnd:        getVal('レポート終了日')
    };
    ads.push(ad);

    totals.impressions += ad.impressions;
    totals.reach += ad.reach;
    totals.clicks += ad.clicks;
    totals.spend += ad.spend;
    totals.conversions += ad.conversions;
    totals.lpViews += ad.lpViews;
  }

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
  totals.cpc = totals.clicks > 0 ? (totals.spend / totals.clicks) : 0;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions * 1000) : 0;
  totals.cpa = totals.conversions > 0 ? (totals.spend / totals.conversions) : 0;

  // シート書き込み（既存ロジック）
  metaAds_writeSheet_(activeRows, colIndex);

  Logger.log('Meta広告データ抽出完了: ' + ads.length + '件');
  return { ads: ads, totals: totals, fileName: latestFile.getName() };
}

/**
 * シート書き込み（importMetaAdsCsvから分離）
 */
function metaAds_writeSheet_(dataRows, colIndex) {
  var sheetHeaders = META_CSV_COLUMNS_.map(function(c) { return c.label; });
  sheetHeaders.unshift('取込日時');

  var sheetData = dataRows.map(function(row) {
    var out = [new Date()];
    META_CSV_COLUMNS_.forEach(function(c) {
      var idx = colIndex[c.csv];
      var val = idx !== undefined ? (row[idx] || '').trim() : '';
      if (c.csv.indexOf('ランキング') === -1 && val !== '' && val !== '―' && !isNaN(Number(val))) {
        val = Number(val);
      }
      out.push(val);
    });
    return out;
  });

  var ss = SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
  var sheet = ss.getSheetByName(META_REPORT_SHEET_NAME_);
  if (!sheet) sheet = ss.insertSheet(META_REPORT_SHEET_NAME_);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, sheetHeaders.length).setValues([sheetHeaders]);
  sheet.getRange(1, 1, 1, sheetHeaders.length)
    .setFontWeight('bold').setBackground('#4267B2').setFontColor('#FFFFFF');
  if (sheetData.length > 0) {
    sheet.getRange(2, 1, sheetData.length, sheetHeaders.length).setValues(sheetData);
  }
  for (var c = 1; c <= sheetHeaders.length; c++) sheet.autoResizeColumn(c);
}

/**
 * AIプロンプト構築
 */
function metaAds_buildPrompt_(ads, totals) {
  var system = [
    'あなたは「デタウリ.Detauri」専属のMeta広告コンサルタントです。',
    'デタウリは BtoB古着卸売EC。メインターゲットは副業で古着販売をする個人。',
    '1人運営のため、実行可能性の高い具体的アドバイスが重要。',
    '',
    '出力フォーマット（必ずこの形式で）:',
    '',
    '### 全体サマリー',
    '[全広告を俯瞰した現状評価を2-3文で]',
    '',
    '### 最優先アクション',
    '[今すぐやるべき具体的な1アクション]',
    '',
    '### 理由',
    '[データに基づく根拠を2-3文で。必ず数値を引用]',
    '',
    '### 広告別評価',
    '[各広告の良い点・改善点を箇条書き]',
    '',
    '### 予算配分の提案',
    '[どの広告に予算を寄せるべきか、具体的な配分比率を提案]',
    '',
    'ルール:',
    '- 抽象的アドバイス禁止（「クリエイティブを改善しましょう」はNG。何をどう変えるか具体的に）',
    '- CPC, CTR, CPA, フリークエンシーの数値を必ず引用',
    '- フリークエンシーが高すぎる広告（3.0以上）は広告疲れの可能性を指摘',
    '- 品質ランキングが「平均以下」の広告は改善が必要と指摘',
    '- 1人運営を考慮した実行可能性重視',
    '- 日本語で回答'
  ].join('\n');

  var fmtYen = function(v) { return '¥' + Math.round(v).toLocaleString(); };

  var userLines = [
    '=== Meta広告パフォーマンス（アクティブ広告のみ） ===',
    '期間: ' + (ads[0] ? ads[0].periodStart + ' 〜 ' + ads[0].periodEnd : '不明'),
    '',
    '■ 全体合計',
    '  消化金額: ' + fmtYen(totals.spend),
    '  インプレッション: ' + totals.impressions.toLocaleString(),
    '  リーチ: ' + totals.reach.toLocaleString(),
    '  クリック数: ' + totals.clicks,
    '  CTR: ' + totals.ctr.toFixed(2) + '%',
    '  CPC: ' + fmtYen(totals.cpc),
    '  CPM: ' + fmtYen(totals.cpm),
    '  CV数: ' + totals.conversions,
    '  CPA: ' + (totals.cpa > 0 ? fmtYen(totals.cpa) : 'N/A'),
    '  LP閲覧数: ' + totals.lpViews,
    ''
  ];

  for (var i = 0; i < ads.length; i++) {
    var ad = ads[i];
    userLines.push('■ 広告' + (i + 1) + ': ' + ad.name);
    userLines.push('  消化金額: ' + fmtYen(ad.spend) + ' | インプレッション: ' + ad.impressions.toLocaleString() + ' | リーチ: ' + ad.reach.toLocaleString());
    userLines.push('  クリック: ' + ad.clicks + ' | CTR: ' + ad.ctr.toFixed(2) + '% | CPC: ' + fmtYen(ad.cpc));
    userLines.push('  フリークエンシー: ' + ad.frequency.toFixed(2) + ' | CPM: ' + fmtYen(ad.cpm));
    userLines.push('  CV数: ' + ad.conversions + ' | CPA: ' + (ad.cpa > 0 ? fmtYen(ad.cpa) : 'N/A') + ' | LP閲覧: ' + ad.lpViews);
    userLines.push('  品質: ' + (ad.qualityRanking || '―') + ' | エンゲージメント: ' + (ad.engagementRanking || '―') + ' | コンバージョン: ' + (ad.conversionRanking || '―'));
    userLines.push('');
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userLines.join('\n') }
  ];
}

/**
 * OpenAI API呼び出し
 */
function metaAds_callAI_(messages) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定');

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      model: 'gpt-5-mini',
      messages: messages,
      max_completion_tokens: 16000
    }),
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    console.error('Meta広告AI OpenAI error: ' + code + ' ' + body);
    throw new Error('OpenAI API失敗: ' + code);
  }

  var json = JSON.parse(body);
  if (json.choices && json.choices[0] && json.choices[0].message) {
    var msg = json.choices[0].message;
    if (msg.refusal) throw new Error('AI refusal: ' + msg.refusal);
    return String(msg.content || '').trim();
  }
  throw new Error('OpenAI応答が不正');
}

/**
 * メールHTML生成
 */
function metaAds_buildEmail_(ads, totals, aiText) {
  var fmtYen = function(v) { return '¥' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var period = ads[0] ? (ads[0].periodStart + ' 〜 ' + ads[0].periodEnd) : '';
  var subject = '【デタウリ】Meta広告分析レポート' + (aiText ? ' + AIアドバイス' : '') + '（' + period + '）';

  var sections = [];

  // AIアドバイス
  if (aiText) {
    sections.push({ title: '🤖 AIアドバイス', text: aiText });
  }

  // 全体サマリー
  sections.push({
    title: '📊 全体パフォーマンス',
    rows: [
      { label: '消化金額', value: fmtYen(totals.spend) },
      { label: 'インプレッション', value: String(totals.impressions) },
      { label: 'クリック数', value: String(totals.clicks) },
      { label: 'CTR', value: totals.ctr.toFixed(2) + '%' },
      { label: 'CPC', value: fmtYen(totals.cpc) },
      { label: 'CV数', value: String(totals.conversions) },
      { label: 'CPA', value: totals.cpa > 0 ? fmtYen(totals.cpa) : 'N/A' }
    ]
  });

  // 広告別
  for (var i = 0; i < ads.length; i++) {
    var ad = ads[i];
    var rankStr = [ad.qualityRanking, ad.engagementRanking, ad.conversionRanking]
      .filter(function(r) { return r && r !== '―'; }).join(' / ') || '―';
    sections.push({
      title: '📌 ' + ad.name,
      rows: [
        { label: '消化金額', value: fmtYen(ad.spend) + ' (' + (totals.spend > 0 ? (ad.spend / totals.spend * 100).toFixed(1) : 0) + '%)' },
        { label: 'クリック / CTR / CPC', value: ad.clicks + ' / ' + ad.ctr.toFixed(2) + '% / ' + fmtYen(ad.cpc) },
        { label: 'リーチ / フリークエンシー', value: ad.reach + ' / ' + ad.frequency.toFixed(2) },
        { label: 'CV / CPA', value: ad.conversions + ' / ' + (ad.cpa > 0 ? fmtYen(ad.cpa) : 'N/A') },
        { label: 'ランキング', value: rankStr }
      ]
    });
  }

  var html = buildHtmlEmail_({
    greeting: 'Meta広告分析レポート（' + period + '）',
    lead: 'アクティブ広告 ' + ads.length + '件のパフォーマンスとAI分析結果です。',
    sections: sections
  });

  // テキスト版
  var textLines = ['Meta広告分析レポート（' + period + '）', ''];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    textLines.push(sec.title);
    if (sec.rows) {
      for (var ri = 0; ri < sec.rows.length; ri++) {
        textLines.push('  ' + sec.rows[ri].label + ': ' + sec.rows[ri].value);
      }
    }
    if (sec.text) textLines.push(sec.text);
    textLines.push('');
  }

  return { subject: subject, html: html, text: textLines.join('\n') };
}

// =====================================================
// 旧関数（互換性維持）+ テスト
// =====================================================

/**
 * CSV取込のみ（シート反映だけ、AI分析なし）
 */
function importMetaAdsCsv() {
  metaImportAndExtract_();
}

/**
 * テスト: CSV取込 + AI分析 + メール送信
 * GASエディタから実行
 */
function testMetaAdsReport() {
  metaAdsReportAndAdvice();
}

/**
 * テスト: CSV取込のみ
 */
function testImportMetaAdsCsv() {
  importMetaAdsCsv();
}
