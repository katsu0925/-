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
  STATUS: 8,
  IMAGE_URL: 9
};

var ARTICLE_HEADERS = [
  '記事ID', 'タイトル', '要約', '本文', 'カテゴリ',
  'タグ', '公開日', '絵文字', 'ステータス', 'ヘッダ画像URL'
];

// =====================================================
// シートアクセス
// =====================================================

function art_formatDate_(val) {
  if (!val) return '';
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var d;
  if (val instanceof Date) {
    d = val;
  } else {
    var s = String(val).trim();
    if (!s) return '';
    d = new Date(s);
    if (isNaN(d.getTime())) return s;
  }
  var base = Utilities.formatDate(d, tz, 'yyyy/MM/dd');
  var dayEn = Utilities.formatDate(d, tz, 'E');
  var map = { Sun:'日', Mon:'月', Tue:'火', Wed:'水', Thu:'木', Fri:'金', Sat:'土' };
  return base + '(' + (map[dayEn] || dayEn) + ')';
}

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

function art_generateArticle_(pastTitles) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定です');

  var topics = [
    // === プラットフォーム別攻略 ===
    'メルカリの最新アルゴリズム変更と出品最適化テクニック',
    'ラクマで他と差別化して高値で売るための独自戦略',
    'Yahoo!フリマの隠れた機能とライバルが知らない活用法',
    'Amazon FBA vs 自己発送: 利益率を最大化する使い分け術',
    'eBay輸出で円安を活かした高利益商品カテゴリの発掘法',
    'Shopifyで自社ECサイトを立ち上げて物販の利益率を劇的に上げる方法',
    'メルカリShopsとメルカリの違い・法人化のメリット',
    'ヤフオクのオークション形式で想定以上の高値を引き出すテクニック',
    // === 仕入れ・リサーチの裏技 ===
    '中国輸入の最新仕入れルートとアリババ以外の穴場サイト',
    'Googleレンズを使った商品リサーチの裏技',
    'セカンドストリートやブックオフの値付けパターンを見抜く仕入れ術',
    'メルカリの「売り切れ」検索で需要のある商品を瞬時に見つける方法',
    'トレンド予測ツールを使って次に売れる商品を先取りする手法',
    '海外のフリマアプリ(Poshmark, Vinted)から仕入れる越境せどり',
    'ドン・キホーテやコストコの店舗せどりで利益商品を見つけるコツ',
    'プレミア化するおもちゃ・フィギュアの見極め方と投資型物販',
    // === 実践テクニック・裏技 ===
    'AIを使った商品説明文の自動生成と売上アップの実践法',
    '物販の写真撮影: スマホだけでプロ級の商品写真を撮る最新テクニック',
    '送料を50%削減する梱包材選びと発送方法の最適化',
    '値下げ交渉を逆に利益に変える心理テクニック',
    'メルカリの「いいね」数から売れるタイミングを予測する分析法',
    'バーコードスキャンアプリを使った店舗せどりの効率化テクニック',
    '再出品のゴールデンタイムと自動化ツールの活用法',
    'クロスリスティング（多プラットフォーム同時出品）の完全自動化',
    // === ビジネス・経営 ===
    '物販の確定申告: 経費にできる意外な項目と節税テクニック',
    '月商100万円を超えたら考えるべき法人化のタイミングと手順',
    '物販のキャッシュフロー管理: 仕入れ資金が回らなくなる前にやるべきこと',
    '外注化の始め方: 出品作業を時給500円で任せる仕組みの作り方',
    '物販で使えるクレジットカードのポイント還元を最大化する裏技',
    // === 最新トレンド・季節戦略 ===
    '今月のメルカリ売れ筋ランキングから読み解くトレンド分析',
    'インバウンド需要を活かした外国人向け商品販売戦略',
    'SDGs・サステナブル商品の需要増加を物販に活かす方法',
    '季節の変わり目に仕込む: 3ヶ月先を見据えた仕入れカレンダー',
    'ハンドメイド×物販: 既製品にひと手間加えて利益率を3倍にする方法',
    // === 副業・マインドセット ===
    '会社員が副業物販で月10万円稼ぐまでの最短ロードマップ',
    '物販で失敗する人の共通パターンと成功者の思考法',
    '1日30分の隙間時間でできる物販ルーティン',
    '物販の損切り判断: 売れ残り在庫をいつ・どう処分すべきか',
    '副業物販が会社にバレないための確定申告と住民税の対策',
    // === アパレル特化 ===
    'アパレル物販の採寸テクニック: 正確なサイズ計測で返品率を激減させる方法',
    'ブランド古着の真贋判定: タグ・縫製・素材から見抜く最新チェックリスト',
    '季節ごとのアパレル仕入れ戦略とオフシーズン仕入れの極意',
    'ノーブランド古着でも高値で売れるコーディネート提案販売術',
    'ヴィンテージ古着の価値判定と海外バイヤーへの販売ルート',
    // === ツール・効率化 ===
    '物販管理アプリ比較: 在庫・売上・利益を一元管理する最強ツール',
    'ChatGPTを物販に活用する10の実践的な方法',
    'スプレッドシートで作る自動利益計算シートの作り方',
    'SNSマーケティングで物販の集客を10倍にする具体的手法',
    'LINEやInstagramを使ったリピーター獲得の仕組み化'
  ];

  // ランダムにトピックを選択（日付ベース + 過去トピックとの重複回避）
  var dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  var baseIndex = dayOfYear % topics.length;
  // 過去記事のタイトルと類似しないトピックを選ぶ
  var todayTopic = topics[baseIndex];
  if (pastTitles && pastTitles.length > 0) {
    var pastStr = pastTitles.join(' ').toLowerCase();
    for (var ti = 0; ti < topics.length; ti++) {
      var candidate = topics[(baseIndex + ti) % topics.length];
      var keywords = candidate.split(/[・：\s]/);
      var overlap = false;
      for (var ki = 0; ki < keywords.length; ki++) {
        if (keywords[ki].length >= 4 && pastStr.indexOf(keywords[ki].toLowerCase()) !== -1) {
          overlap = true; break;
        }
      }
      if (!overlap) { todayTopic = candidate; break; }
    }
  }

  // 過去記事の重複回避指示を構築（全件のタイトル+要約を含める）
  var dedupeInstruction = '';
  if (pastTitles && pastTitles.length > 0) {
    var recentTitles = pastTitles.slice(0, 50);
    dedupeInstruction = '\n\n【最重要：重複回避ルール】\n' +
      '以下は過去に生成済みの記事タイトルです。これらの記事と内容・切り口・結論・' +
      '具体的なアドバイスが被ることは絶対に避けてください。\n' +
      '同じプラットフォームのTipsでも、全く異なる角度（裏技、最新変更、数字を使った具体例、' +
      '失敗事例、業界の最新ニュース等）から書いてください。\n' +
      recentTitles.map(function(t, i) { return (i + 1) + '. ' + t; }).join('\n');
  }

  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy年MM月dd日');

  var systemPrompt = [
    'あなたは物販・フリマアプリ・副業ビジネスの専門ジャーナリストです。',
    '今日は' + today + 'です。',
    '',
    '副業で物販（特にアパレル・古着・フリマアプリ物販）を行っている人向けに、',
    '他では読めない独自の視点で、実践的かつ最新のノウハウ記事を執筆してください。',
    '',
    '以下のJSON形式で出力してください（他のテキストは一切出力しないでください）:',
    '{',
    '  "title": "記事タイトル（30字以内、具体的な数字や裏技感を入れてキャッチーに）",',
    '  "summary": "要約（60〜80字、読者が「読みたい！」と思う要点を簡潔に）",',
    '  "content": "本文（HTML形式、600〜1000字、<h3><p><ul><li><strong><em>タグを使用）",',
    '  "category": "カテゴリ（メルカリ/ラクマ/Yahoo!フリマ/Amazon/eBay/中国輸入/せどり/副業全般/アパレル/ツール活用 のいずれか）",',
    '  "tags": "タグ（カンマ区切り、3〜5個）",',
    '  "emoji": "記事を表す絵文字（1つ）",',
    '  "imageQuery": "記事テーマに合うストックフォト検索用の英語キーワード（1〜3語、例: fashion wholesale, ecommerce shipping, vintage clothing）"',
    '}',
    '',
    '【執筆ルール】',
    '・noteやXで話題になるような読みやすい文体で書く',
    '・「です・ます」調で統一',
    '・具体的な数字（金額、%、件数など）を必ず含める',
    '・「裏技」「あまり知られていない」「プロだけが知る」系の情報を盛り込む',
    '・最新のトレンド・アップデート・季節要因を反映した内容にする',
    '・初心者にもわかりやすく、かつ中級者にも「知らなかった！」と思わせる情報を含める',
    '・一般的すぎるアドバイス（「写真を綺麗に撮ろう」等）は避け、具体的な手順・数字を示す',
    '・HTMLのcontent内では<script>タグや<style>タグは使わない',
    '・content内の文字列はHTMLエンティティで適切にエスケープする',
    '',
    '【正確性・信頼性ルール（厳守）】',
    '・事実に基づいた情報のみを記載すること。推測や憶測で数字や規約を書かない',
    '・各プラットフォーム（メルカリ、Amazon、eBay等）の公式規約・ガイドラインに反する内容は絶対に書かない',
    '・税金・確定申告に関する情報は日本の国税庁の公式見解に基づくこと。税理士への相談を推奨する一文を入れる',
    '・法律（古物営業法、特定商取引法、景品表示法等）に関わる記述は正確に。不確かな場合は「詳細は専門家に確認」と付記する',
    '・海外の情報と日本の情報を混同しない。日本国内の読者向けであることを常に意識する',
    '・「確実に儲かる」「絶対に成功する」等の断定的な表現は避け、リスクや注意点も併記する',
    '・具体的な金額を示す場合は「目安」「一例」であることを明記する'
  ].join('\n') + dedupeInstruction;

  var userPrompt = '今日のテーマ: 「' + todayTopic + '」\n\n' +
    '今日の日付（' + today + '）時点の最新情報を反映し、' +
    '過去の記事とは完全に異なる新しい切り口で記事を作成してください。' +
    '一般論ではなく、今すぐ使える具体的な裏技やテクニックを中心に書いてください。';

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
// Pexels API — ヘッダ画像取得（無料・200リクエスト/時間）
// Script Properties に PEXELS_API_KEY を設定すると有効化
// =====================================================

function art_fetchHeaderImage_(query) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('PEXELS_API_KEY') || '';
  if (!apiKey || !query) return '';
  try {
    var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) +
              '&per_page=5&orientation=landscape&size=medium';
    var res = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': apiKey },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return '';
    var data = JSON.parse(res.getContentText());
    if (!data.photos || !data.photos.length) return '';
    var idx = Math.floor(Math.random() * Math.min(5, data.photos.length));
    var photo = data.photos[idx];
    return photo.src.landscape || photo.src.large || photo.src.medium || '';
  } catch (e) {
    console.log('Pexels image fetch skipped: ' + (e.message || e));
    return '';
  }
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
    var sheet = art_getSheet_();
    var lastRow = sheet.getLastRow();

    // 過去記事のタイトルを取得（重複回避用）
    var pastTitles = [];
    if (lastRow >= 2) {
      var titleData = sheet.getRange(2, ARTICLE_COLS.TITLE + 1, lastRow - 1, 1).getValues();
      for (var i = titleData.length - 1; i >= 0; i--) {
        var t = String(titleData[i][0] || '').trim();
        if (t) pastTitles.push(t);
      }
    }

    var article = art_generateArticle_(pastTitles);
    var id = art_generateId_();
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var publishDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    // 記事数が100以上の場合、最も古い記事を削除
    var MAX_ARTICLES = 100;
    var articleCount = lastRow - 1; // ヘッダー行を除く
    if (articleCount >= MAX_ARTICLES) {
      // 最も古い記事（2行目）を削除
      sheet.deleteRow(2);
      console.log('記事上限到達: 最古の記事を削除しました（現在: ' + articleCount + '件）');
    }

    var imageUrl = art_fetchHeaderImage_(article.imageQuery || '');

    var row = [
      id,
      article.title || '',
      article.summary || '',
      article.content || '',
      article.category || '総合',
      article.tags || '',
      publishDate,
      article.emoji || '📝',
      'published',
      imageUrl
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

      var imgUrl = (data[i].length > ARTICLE_COLS.IMAGE_URL) ? String(data[i][ARTICLE_COLS.IMAGE_URL] || '').trim() : '';
      articles.push({
        id: String(data[i][ARTICLE_COLS.ID] || '').trim(),
        title: String(data[i][ARTICLE_COLS.TITLE] || '').trim(),
        summary: String(data[i][ARTICLE_COLS.SUMMARY] || '').trim(),
        category: String(data[i][ARTICLE_COLS.CATEGORY] || '').trim(),
        publishDate: art_formatDate_(data[i][ARTICLE_COLS.PUBLISH_DATE]),
        emoji: String(data[i][ARTICLE_COLS.EMOJI] || '📝').trim(),
        imageUrl: imgUrl
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

    var artImgUrl = (rowData.length > ARTICLE_COLS.IMAGE_URL) ? String(rowData[ARTICLE_COLS.IMAGE_URL] || '').trim() : '';
    var article = {
      id: String(rowData[ARTICLE_COLS.ID] || '').trim(),
      title: String(rowData[ARTICLE_COLS.TITLE] || '').trim(),
      content: String(rowData[ARTICLE_COLS.CONTENT] || '').trim(),
      category: String(rowData[ARTICLE_COLS.CATEGORY] || '').trim(),
      tags: String(rowData[ARTICLE_COLS.TAGS] || '').trim(),
      publishDate: art_formatDate_(rowData[ARTICLE_COLS.PUBLISH_DATE]),
      emoji: String(rowData[ARTICLE_COLS.EMOJI] || '📝').trim(),
      imageUrl: artImgUrl
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

// =====================================================
// Pexels APIキー設定ヘルパー（GASエディタから1回実行）
// 実行後は削除してもOK
// =====================================================

function setPexelsApiKey() {
  var key = 'ここにPexels APIキーを貼り付け';
  PropertiesService.getScriptProperties().setProperty('PEXELS_API_KEY', key);
  console.log('PEXELS_API_KEY を設定しました');
}
