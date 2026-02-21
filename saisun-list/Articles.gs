// Articles.gs
// =====================================================
// 記事管理（OpenAI GPTによる自動生成＋API提供）
// 物販・フリマアプリの副業お役立ち情報を日次で自動生成し
// フロントエンドのポップアップパネルに配信する
// =====================================================

var ARTICLE_CONFIG = {
  SHEET_NAME: '記事管理',
  CACHE_KEY: 'ARTICLES_LIST_CACHE',
  CACHE_TTL: 3600,
  CONTENT_CACHE_PREFIX: 'ARTICLE_CONTENT:',
  CONTENT_CACHE_TTL: 86400,
  MAX_ARTICLES_DISPLAY: 20,
  MODEL: 'gpt-4o-mini',
  ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  MAX_TOKENS: 2000,
  TEMPERATURE: 0.8
};

var ARTICLE_COLS = {
  ID: 0,
  TITLE: 1,
  SUMMARY: 2,
  CONTENT: 3,
  CATEGORY: 4,
  TAGS: 5,
  PUBLISH_DATE: 6,
  EMOJI: 7,
  STATUS: 8
};

var ARTICLE_HEADERS = [
  '記事ID', 'タイトル', '要約', '本文', 'カテゴリ',
  'タグ', '公開日', '絵文字', 'ステータス'
];

// =====================================================
// シートアクセス
// =====================================================

function art_getSheet_() {
  var ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  if (!ssId) throw new Error('DATA_SPREADSHEET_ID が未設定です');
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(ARTICLE_CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ARTICLE_CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, ARTICLE_HEADERS.length).setValues([ARTICLE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function art_generateId_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var rnd = Math.floor(Math.random() * 900 + 100);
  return dateStr + '-' + rnd;
}

// =====================================================
// OpenAI API連携 — 記事生成
// =====================================================

function art_generateArticle_() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定です');

  var topics = [
    'メルカリでの出品・販売テクニック',
    'ラクマでの効率的な売り方',
    'Yahoo!フリマ活用法',
    'Amazon物販の最新ノウハウ',
    'eBay輸出で利益を出すコツ',
    '中国輸入せどりの始め方',
    'せどりの仕入れテクニック',
    'フリマアプリの写真撮影術',
    '古着転売で利益を出すポイント',
    '物販の梱包・発送効率化',
    'フリマアプリでのプロフィール最適化',
    '物販の確定申告・税金対策',
    'トレンド商品のリサーチ方法',
    '物販の在庫管理術',
    '副業物販のスケジュール管理',
    '物販のクレーム対応術',
    'ブランド古着の真贋判定のコツ',
    '物販の利益率を上げる価格設定',
    'フリマアプリのSEO対策（タイトル・説明文の書き方）',
    '季節に合わせた物販戦略',
    'リピーター獲得のための接客術',
    '物販初心者がやりがちな失敗と対策',
    '複数プラットフォーム同時出品のコツ',
    'ヤフオクとメルカリの違いと使い分け',
    '物販で月5万円稼ぐロードマップ',
    '古着せどりの仕入れ先ガイド',
    '物販の外注化・仕組み化',
    'フリマアプリの値下げ交渉への対応',
    'アパレル物販のサイズ表記の書き方',
    '物販のキャッシュフロー管理'
  ];
  var dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  var topicIndex = dayOfYear % topics.length;
  var todayTopic = topics[topicIndex];

  var systemPrompt = [
    'あなたは物販・フリマアプリの専門ライターです。',
    '副業で物販を行っている人向けに、実践的で最新のノウハウ記事を執筆してください。',
    '',
    '以下のJSON形式で出力してください（他のテキストは一切出力しないでください）:',
    '{',
    '  "title": "記事タイトル（30字以内、キャッチーに）",',
    '  "summary": "要約（60〜80字、記事の要点を簡潔に）",',
    '  "content": "本文（HTML形式、500〜800字、<h3><p><ul><li><strong><em>タグを使用）",',
    '  "category": "カテゴリ（メルカリ/ラクマ/Yahoo!フリマ/Amazon/eBay/中国輸入/せどり/総合 のいずれか）",',
    '  "tags": "タグ（カンマ区切り、3〜5個）",',
    '  "emoji": "記事を表す絵文字（1つ）"',
    '}',
    '',
    '【執筆ルール】',
    '・noteの記事のような読みやすい文体で書く',
    '・「です・ます」調で統一',
    '・具体的な数字やステップを含める',
    '・最新のトレンドを反映した内容にする',
    '・初心者にもわかりやすく、かつ中級者にも有用な情報を含める',
    '・HTMLのcontent内では<script>タグや<style>タグは使わない',
    '・content内の文字列はHTMLエンティティで適切にエスケープする'
  ].join('\n');

  var userPrompt = '今日のテーマ: 「' + todayTopic + '」について、今すぐ使える実践的なtipsを記事にしてください。';

  var payload = {
    model: ARTICLE_CONFIG.MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: ARTICLE_CONFIG.MAX_TOKENS,
    temperature: ARTICLE_CONFIG.TEMPERATURE,
    response_format: { type: 'json_object' }
  };

  var res = UrlFetchApp.fetch(ARTICLE_CONFIG.ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';

  if (code < 200 || code >= 300) {
    console.error('OpenAI API error (article): ' + code + ' ' + body);
    throw new Error('記事生成APIエラー: HTTP ' + code);
  }

  var json = JSON.parse(body);
  if (!json.choices || !json.choices[0] || !json.choices[0].message) {
    throw new Error('記事生成APIの応答が不正です');
  }

  var articleJson = JSON.parse(json.choices[0].message.content);
  if (!articleJson.title || !articleJson.summary || !articleJson.content) {
    throw new Error('生成された記事データが不完全です');
  }

  return articleJson;
}

// =====================================================
// 日次記事生成（トリガーから呼び出し）
// =====================================================

function generateDailyArticle() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('記事生成: ロック取得失敗（既に実行中）');
    return;
  }

  try {
    var article = art_generateArticle_();
    var sheet = art_getSheet_();
    var id = art_generateId_();
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var publishDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var row = [
      id,
      article.title || '',
      article.summary || '',
      article.content || '',
      article.category || '総合',
      article.tags || '',
      publishDate,
      article.emoji || '📝',
      'published'
    ];

    sheet.appendRow(row);

    var cache = CacheService.getScriptCache();
    cache.remove(ARTICLE_CONFIG.CACHE_KEY);

    console.log('記事生成完了: ' + id + ' - ' + article.title);
    return { ok: true, id: id, title: article.title };
  } catch (e) {
    console.error('記事生成エラー: ' + (e.message || e));
    return { ok: false, message: e.message || String(e) };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// 公開API — 記事一覧
// =====================================================

function apiGetArticles() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(ARTICLE_CONFIG.CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* fall through */ }
    }

    var sheet = art_getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      var empty = { ok: true, articles: [] };
      try { cache.put(ARTICLE_CONFIG.CACHE_KEY, JSON.stringify(empty), ARTICLE_CONFIG.CACHE_TTL); } catch (e) {}
      return empty;
    }

    var data = sheet.getRange(2, 1, lastRow - 1, ARTICLE_HEADERS.length).getValues();
    var articles = [];
    for (var i = data.length - 1; i >= 0; i--) {
      var status = String(data[i][ARTICLE_COLS.STATUS] || '').trim();
      if (status !== 'published') continue;

      articles.push({
        id: String(data[i][ARTICLE_COLS.ID] || '').trim(),
        title: String(data[i][ARTICLE_COLS.TITLE] || '').trim(),
        summary: String(data[i][ARTICLE_COLS.SUMMARY] || '').trim(),
        category: String(data[i][ARTICLE_COLS.CATEGORY] || '').trim(),
        publishDate: String(data[i][ARTICLE_COLS.PUBLISH_DATE] || '').trim(),
        emoji: String(data[i][ARTICLE_COLS.EMOJI] || '📝').trim()
      });

      if (articles.length >= ARTICLE_CONFIG.MAX_ARTICLES_DISPLAY) break;
    }

    var result = { ok: true, articles: articles };
    try { cache.put(ARTICLE_CONFIG.CACHE_KEY, JSON.stringify(result), ARTICLE_CONFIG.CACHE_TTL); } catch (e) {}
    return result;
  } catch (e) {
    console.error('apiGetArticles error: ' + (e.message || e));
    return { ok: false, message: '記事一覧の取得に失敗しました' };
  }
}

// =====================================================
// 公開API — 記事本文
// =====================================================

function apiGetArticleContent(articleId) {
  try {
    var id = String(articleId || '').trim();
    if (!id) return { ok: false, message: '記事IDが指定されていません' };

    var cache = CacheService.getScriptCache();
    var cacheKey = ARTICLE_CONFIG.CONTENT_CACHE_PREFIX + id;
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* fall through */ }
    }

    var sheet = art_getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, message: '記事が見つかりません' };

    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var rowIndex = -1;
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0] || '').trim() === id) { rowIndex = i; break; }
    }
    if (rowIndex === -1) return { ok: false, message: '記事が見つかりません' };

    var rowData = sheet.getRange(rowIndex + 2, 1, 1, ARTICLE_HEADERS.length).getValues()[0];
    var status = String(rowData[ARTICLE_COLS.STATUS] || '').trim();
    if (status !== 'published') return { ok: false, message: '記事は非公開です' };

    var article = {
      id: String(rowData[ARTICLE_COLS.ID] || '').trim(),
      title: String(rowData[ARTICLE_COLS.TITLE] || '').trim(),
      content: String(rowData[ARTICLE_COLS.CONTENT] || '').trim(),
      category: String(rowData[ARTICLE_COLS.CATEGORY] || '').trim(),
      tags: String(rowData[ARTICLE_COLS.TAGS] || '').trim(),
      publishDate: String(rowData[ARTICLE_COLS.PUBLISH_DATE] || '').trim(),
      emoji: String(rowData[ARTICLE_COLS.EMOJI] || '📝').trim()
    };

    var result = { ok: true, article: article };
    try { cache.put(cacheKey, JSON.stringify(result), ARTICLE_CONFIG.CONTENT_CACHE_TTL); } catch (e) {}
    return result;
  } catch (e) {
    console.error('apiGetArticleContent error: ' + (e.message || e));
    return { ok: false, message: '記事の取得に失敗しました' };
  }
}

// =====================================================
// トリガー設定（GASエディタから1回実行）
// =====================================================

function setupArticleTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'generateDailyArticle') {
      console.log('記事生成トリガーは既に設定済みです');
      return { ok: true, message: '既に設定済み' };
    }
  }

  ScriptApp.newTrigger('generateDailyArticle')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  console.log('記事生成の日次トリガーを設定しました（毎日6:00 JST）');
  return { ok: true, message: 'トリガー設定完了' };
}
