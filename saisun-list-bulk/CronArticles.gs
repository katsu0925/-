// CronArticles.gs
// =====================================================
// 記事管理（saisun-list/Articles.gs から移動）
// OpenAI GPTによるスケジュール生成（月水金日 6時）
// =====================================================
// 【前提】ScriptProperties に OPENAI_API_KEY（必須）、PEXELS_API_KEY（任意）を設定

var ARTICLE_CONFIG = {
  SHEET_NAME: '記事管理',
  CACHE_KEY: 'ARTICLES_LIST_CACHE',
  CACHE_TTL: 3600,
  MODEL: 'gpt-4o-mini',
  ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  MAX_TOKENS: 2000,
  TEMPERATURE: 0.8
};

var ARTICLE_COLS = {
  ID: 0, TITLE: 1, SUMMARY: 2, CONTENT: 3, CATEGORY: 4,
  TAGS: 5, PUBLISH_DATE: 6, EMOJI: 7, STATUS: 8, IMAGE_URL: 9,
  MAJOR_CATEGORY: 10
};

var ARTICLE_HEADERS = [
  '記事ID', 'タイトル', '要約', '本文', 'カテゴリ',
  'タグ', '公開日', '絵文字', 'ステータス', 'ヘッダ画像URL', '大カテゴリ'
];

// 曜日→大カテゴリ スケジュール（0=日,1=月,...,6=土）
// 月=売り方ガイド, 水=仕入れノウハウ, 金=副業の始め方, 日=トレンド情報
var DAY_CATEGORY_SCHEDULE = {
  0: 'トレンド情報',    // 日曜
  1: '売り方ガイド',    // 月曜
  3: '仕入れノウハウ',  // 水曜
  5: '副業の始め方'     // 金曜
};

// カテゴリ別トピック配列
var TOPICS_BY_CATEGORY = {
  '売り方ガイド': [
    'メルカリの最新アルゴリズム変更と出品最適化テクニック',
    'ラクマで他と差別化して高値で売るための独自戦略',
    'Yahoo!フリマの隠れた機能とライバルが知らない活用法',
    'Amazon FBA vs 自己発送: 利益率を最大化する使い分け術',
    'eBay輸出で円安を活かした高利益商品カテゴリの発掘法',
    'Shopifyで自社ECサイトを立ち上げて物販の利益率を劇的に上げる方法',
    'メルカリShopsとメルカリの違い・法人化のメリット',
    'ヤフオクのオークション形式で想定以上の高値を引き出すテクニック',
    '値下げ交渉を逆に利益に変える心理テクニック',
    'メルカリの「いいね」数から売れるタイミングを予測する分析法',
    '再出品のゴールデンタイムと自動化ツールの活用法',
    'クロスリスティング（多プラットフォーム同時出品）の完全自動化',
    '物販の写真撮影: スマホだけでプロ級の商品写真を撮る最新テクニック',
    'AIを使った商品説明文の自動生成と売上アップの実践法',
    'SNSマーケティングで物販の集客を10倍にする具体的手法',
    'LINEやInstagramを使ったリピーター獲得の仕組み化',
    'ノーブランド古着でも高値で売れるコーディネート提案販売術'
  ],
  '仕入れノウハウ': [
    '中国輸入の最新仕入れルートとアリババ以外の穴場サイト',
    'Googleレンズを使った商品リサーチの裏技',
    'セカンドストリートやブックオフの値付けパターンを見抜く仕入れ術',
    'メルカリの「売り切れ」検索で需要のある商品を瞬時に見つける方法',
    'トレンド予測ツールを使って次に売れる商品を先取りする手法',
    '海外のフリマアプリ(Poshmark, Vinted)から仕入れる越境せどり',
    'ドン・キホーテやコストコの店舗せどりで利益商品を見つけるコツ',
    'プレミア化するおもちゃ・フィギュアの見極め方と投資型物販',
    'バーコードスキャンアプリを使った店舗せどりの効率化テクニック',
    'アパレル物販の採寸テクニック: 正確なサイズ計測で返品率を激減させる方法',
    'ブランド古着の真贋判定: タグ・縫製・素材から見抜く最新チェックリスト',
    '季節ごとのアパレル仕入れ戦略とオフシーズン仕入れの極意',
    'ヴィンテージ古着の価値判定と海外バイヤーへの販売ルート',
    '季節の変わり目に仕込む: 3ヶ月先を見据えた仕入れカレンダー'
  ],
  '副業の始め方': [
    '会社員が副業物販で月10万円稼ぐまでの最短ロードマップ',
    '物販で失敗する人の共通パターンと成功者の思考法',
    '1日30分の隙間時間でできる物販ルーティン',
    '物販の損切り判断: 売れ残り在庫をいつ・どう処分すべきか',
    '副業物販が会社にバレないための確定申告と住民税の対策',
    '物販の確定申告: 経費にできる意外な項目と節税テクニック',
    '月商100万円を超えたら考えるべき法人化のタイミングと手順',
    '物販のキャッシュフロー管理: 仕入れ資金が回らなくなる前にやるべきこと',
    '外注化の始め方: 出品作業を時給500円で任せる仕組みの作り方',
    '物販で使えるクレジットカードのポイント還元を最大化する裏技',
    '物販管理アプリ比較: 在庫・売上・利益を一元管理する最強ツール',
    'ChatGPTを物販に活用する10の実践的な方法',
    'スプレッドシートで作る自動利益計算シートの作り方',
    '送料を50%削減する梱包材選びと発送方法の最適化',
    'ハンドメイド×物販: 既製品にひと手間加えて利益率を3倍にする方法',
    'インバウンド需要を活かした外国人向け商品販売戦略',
    'SDGs・サステナブル商品の需要増加を物販に活かす方法'
  ]
};

// =====================================================
// シートアクセス
// =====================================================

function cron_art_getSheet_() {
  var ssId = cron_getSsId_();
  if (!ssId) throw new Error('DATA_SPREADSHEET_ID が未設定です');
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(ARTICLE_CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ARTICLE_CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, ARTICLE_HEADERS.length).setValues([ARTICLE_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    var lastCol = sheet.getLastColumn();
    if (lastCol < ARTICLE_HEADERS.length) {
      for (var c = lastCol; c < ARTICLE_HEADERS.length; c++) {
        sheet.getRange(1, c + 1).setValue(ARTICLE_HEADERS[c]);
      }
    }
  }
  return sheet;
}

function cron_art_generateId_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var rnd = Math.floor(Math.random() * 900 + 100);
  return dateStr + '-' + rnd;
}

// =====================================================
// トレンドデータ取得（商品分析シートから集計）
// =====================================================

function cron_art_getTrendData_() {
  var ssId = cron_getSsId_();
  if (!ssId) return null;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('商品分析');
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    // 商品分析: A=管理番号, B=ブランド, C=カテゴリ, D=注文回数, E=合計金額
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    var brandMap = {};
    var categoryMap = {};

    for (var i = 0; i < data.length; i++) {
      var brand = String(data[i][1] || '').trim();
      var category = String(data[i][2] || '').trim();
      var orders = Number(data[i][3]) || 0;
      if (orders <= 0) continue;

      if (brand) {
        if (!brandMap[brand]) brandMap[brand] = { orders: 0, total: 0 };
        brandMap[brand].orders += orders;
        brandMap[brand].total += Number(data[i][4]) || 0;
      }
      if (category) {
        if (!categoryMap[category]) categoryMap[category] = { orders: 0, total: 0 };
        categoryMap[category].orders += orders;
        categoryMap[category].total += Number(data[i][4]) || 0;
      }
    }

    // TOP10ブランド
    var brands = [];
    for (var b in brandMap) {
      if (brandMap.hasOwnProperty(b)) brands.push({ name: b, orders: brandMap[b].orders, total: brandMap[b].total });
    }
    brands.sort(function(a, b) { return b.orders - a.orders; });
    var topBrands = brands.slice(0, 10);

    // TOP10カテゴリ
    var categories = [];
    for (var c in categoryMap) {
      if (categoryMap.hasOwnProperty(c)) categories.push({ name: c, orders: categoryMap[c].orders, total: categoryMap[c].total });
    }
    categories.sort(function(a, b) { return b.orders - a.orders; });
    var topCategories = categories.slice(0, 10);

    if (topBrands.length === 0 && topCategories.length === 0) return null;

    return { brands: topBrands, categories: topCategories };
  } catch (e) {
    console.log('トレンドデータ取得スキップ: ' + (e.message || e));
    return null;
  }
}

// =====================================================
// OpenAI API連携 — 通常記事生成
// =====================================================

function cron_art_generateArticle_(pastTitles, majorCategory, pastCategories) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定です');

  var topics = TOPICS_BY_CATEGORY[majorCategory] || TOPICS_BY_CATEGORY['副業の始め方'];

  // --- 堅固な重複回避トピック選択 ---
  var dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  var baseIndex = dayOfYear % topics.length;
  var todayTopic = null;

  // 直近7記事のカテゴリを抽出（カテゴリクールダウン用）
  var recentCats = {};
  if (pastCategories) {
    var catSlice = pastCategories.slice(0, 7);
    for (var ci = 0; ci < catSlice.length; ci++) {
      var c = catSlice[ci].category;
      if (c) recentCats[c] = true;
    }
  }

  for (var ti = 0; ti < topics.length; ti++) {
    var candidate = topics[(baseIndex + ti) % topics.length];

    // チェック1: トライグラム類似度（過去タイトルとの内容重複）
    var tooSimilar = false;
    if (pastTitles && pastTitles.length > 0) {
      for (var pi = 0; pi < pastTitles.length; pi++) {
        if (cron_art_trigramSimilarity_(candidate, pastTitles[pi]) > 0.18) {
          tooSimilar = true;
          break;
        }
      }
    }
    if (tooSimilar) continue;

    // チェック2: カテゴリクールダウン（直近7記事に同カテゴリがあればスキップ）
    var topicCat = cron_art_guessCategory_(candidate);
    if (topicCat && recentCats[topicCat]) continue;

    todayTopic = candidate;
    break;
  }
  // 全トピックが重複した場合はランダム選択（フォールバック）
  if (!todayTopic) {
    todayTopic = topics[Math.floor(Math.random() * topics.length)];
    console.log('記事生成: 全トピック重複のためランダム選択: ' + todayTopic);
  }

  // --- 強化された重複回避プロンプト ---
  var dedupeInstruction = '';
  if (pastTitles && pastTitles.length > 0) {
    var recentTitles = pastTitles.slice(0, 50);
    dedupeInstruction = '\n\n【最重要：重複回避ルール — 違反は絶対に許容しない】\n' +
      '以下は過去に生成済みの記事タイトルです。\n' +
      '■ これらの記事と「テーマ」「主要キーワード」「扱うプラットフォーム/サイト名」「結論」が1つでも被る記事は生成禁止\n' +
      '■ 「5選→7選」「最新版→2026年版」のような数字/年号の差し替えだけの焼き直しも禁止\n' +
      '■ 同じプラットフォーム（例: 中国輸入、メルカリ等）を扱う場合は、過去記事と完全に異なる切り口（例: 仕入れ→販売戦略、初心者向け→上級者向け）でなければならない\n' +
      '■ 過去記事で既出の具体的サイト名・ツール名・テクニック名は再度メインテーマにしない\n\n' +
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
    '  "imageQuery": "記事テーマに合うストックフォト検索用の英語キーワード（1〜3語）"',
    '}',
    '',
    '【執筆ルール】',
    '・noteやXで話題になるような読みやすい文体で書く',
    '・「です・ます」調で統一',
    '・具体的な数字（金額、%、件数など）を必ず含める',
    '・「裏技」「あまり知られていない」「プロだけが知る」系の情報を盛り込む',
    '・最新のトレンド・アップデート・季節要因を反映した内容にする',
    '・初心者にもわかりやすく、かつ中級者にも「知らなかった！」と思わせる情報を含める',
    '・一般的すぎるアドバイスは避け、具体的な手順・数字を示す',
    '・HTMLのcontent内では<script>タグや<style>タグは使わない',
    '・content内の文字列はHTMLエンティティで適切にエスケープする',
    '',
    '【正確性・信頼性ルール（厳守）】',
    '・事実に基づいた情報のみを記載すること。推測や憶測で数字や規約を書かない',
    '・各プラットフォームの公式規約・ガイドラインに反する内容は絶対に書かない',
    '・税金・確定申告に関する情報は日本の国税庁の公式見解に基づくこと。税理士への相談を推奨する一文を入れる',
    '・法律に関わる記述は正確に。不確かな場合は「詳細は専門家に確認」と付記する',
    '・海外の情報と日本の情報を混同しない',
    '・「確実に儲かる」「絶対に成功する」等の断定的な表現は避け、リスクや注意点も併記する',
    '・具体的な金額を示す場合は「目安」「一例」であることを明記する'
  ].join('\n') + dedupeInstruction;

  var userPrompt = '今日のテーマ: 「' + todayTopic + '」\n\n' +
    '今日の日付（' + today + '）時点の最新情報を反映し、' +
    '過去の記事とは完全に異なる新しい切り口で記事を作成してください。' +
    '一般論ではなく、今すぐ使える具体的な裏技やテクニックを中心に書いてください。';

  return cron_art_callOpenAI_(apiKey, systemPrompt, userPrompt);
}

// =====================================================
// OpenAI API連携 — トレンド記事生成
// =====================================================

function cron_art_generateTrendArticle_(pastTitles, trendData) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定です');

  var dedupeInstruction = '';
  if (pastTitles && pastTitles.length > 0) {
    var recentTitles = pastTitles.slice(0, 50);
    dedupeInstruction = '\n\n【最重要：重複回避ルール — 違反は絶対に許容しない】\n' +
      '以下は過去に生成済みの記事タイトルです。\n' +
      '■ これらの記事と「テーマ」「主要キーワード」「扱うブランド・カテゴリ」が被る記事は生成禁止\n' +
      '■ 前回と同じブランドやカテゴリをメインに据えた記事は書かない。異なるブランド・カテゴリを軸にすること\n' +
      '■ 「今週のトレンド」系の記事が過去にある場合、同じデータの焼き直しは禁止\n\n' +
      recentTitles.map(function(t, i) { return (i + 1) + '. ' + t; }).join('\n');
  }

  var trendSection = '';
  if (trendData) {
    trendSection = '\n\n【デタウリ累計注文数ランキング（開業以降の累計）】\n';
    if (trendData.brands && trendData.brands.length > 0) {
      trendSection += '■ ブランド別ランキング（順位のみ、金額・注文回数は非公開）:\n';
      for (var i = 0; i < trendData.brands.length; i++) {
        var b = trendData.brands[i];
        trendSection += (i + 1) + '位: ' + b.name + '\n';
      }
    }
    if (trendData.categories && trendData.categories.length > 0) {
      trendSection += '■ カテゴリ別ランキング（順位のみ、金額・注文回数は非公開）:\n';
      for (var j = 0; j < trendData.categories.length; j++) {
        var c = trendData.categories[j];
        trendSection += (j + 1) + '位: ' + c.name + '\n';
      }
    }
    trendSection += '\n※このランキングは累計データです。「今週」「今月」「春の売上」等、特定期間の数字として表現しないこと。\n';
    trendSection += '※具体的な注文回数や売上金額は一切記事内に書かないこと（例: 「ZARAが10回注文」「売上60,644円」等の記述は禁止）。順位とブランド名のみ引用可。\n';
  }

  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy年MM月dd日');

  var systemPrompt = [
    'あなたは物販・フリマアプリ・副業ビジネスの専門アナリストです。',
    '今日は' + today + 'です。',
    '',
    '副業で古着・ブランド物販を行っている人向けに、',
    '実際の売上データに基づくトレンド分析記事を執筆してください。',
    '',
    '以下のJSON形式で出力してください（他のテキストは一切出力しないでください）:',
    '{',
    '  "title": "記事タイトル（30字以内、人気ブランド名やカテゴリ名を入れてキャッチーに。具体的な売上金額・注文回数は入れない）",',
    '  "summary": "要約（60〜80字、人気ブランド・カテゴリの傾向がわかるようにまとめる。具体的な数字は入れない）",',
    '  "content": "本文（HTML形式、600〜1000字、<h3><p><ul><li><strong><em>タグを使用）",',
    '  "category": "せどり",',
    '  "tags": "タグ（カンマ区切り、3〜5個、例: トレンド,売れ筋,ブランド,ランキング）",',
    '  "emoji": "📊",',
    '  "imageQuery": "fashion trend ranking chart"',
    '}',
    '',
    '【執筆ルール】',
    '・提供された累計ランキングを参考に、どのブランド・カテゴリが副業物販で人気かを一般論として分析する',
    '・なぜそのブランド/カテゴリが人気なのか、季節要因や市場動向を考察する',
    '・リセラーが今すぐ活かせる仕入れアクションを3つ以上提案する',
    '・「です・ます」調で統一',
    '・HTMLのcontent内では<script>タグや<style>タグは使わない',
    '・「確実に儲かる」等の断定は避け、リスクや注意点も併記する',
    '',
    '【数字・実績に関する厳守ルール】',
    '・具体的な売上金額・注文回数・受注件数等の数字は絶対に記事内に書かない（例: 「ZARAは10回注文」「売上60,644円」「105回の注文」等は全て禁止）',
    '・「今週」「今月」「○月上旬のデタウリ売上データ」「2026年春の売上」のような特定期間の自社データとして書くのは禁止',
    '・「デタウリの売上データによると」「デタウリ実績データでは」のような自社実績データを明示する表現は禁止',
    '・ランキング順位とブランド名・カテゴリ名のみ引用可（例: 「人気ブランドには ZARA、INGNI、adidas などがあり…」のように列挙するのはOK）',
    '・市場相場・業界統計として出典が明確な一般的な数字は引用可（例: 総務省統計、経産省レポート等）'
  ].join('\n') + trendSection + dedupeInstruction;

  var userPrompt = 'デタウリで継続的に人気のあるブランド・カテゴリ（累計ランキング）を踏まえ、一般的な市場トレンド分析記事を作成してください。\n' +
    'ランキング上位のブランド・カテゴリがなぜ物販市場全体で人気なのか、季節要因・市場動向・ターゲット層の観点から一般論として分析し、' +
    '副業リセラーが今仕入れるべきアイテムと仕入れ先を具体的に提案してください。\n' +
    '※「今週」「今月」「○月上旬の売上」「2026年春の売上」等、特定期間の自社データとして書かないこと。' +
    'あくまで累計ランキングからの傾向考察として書くこと。';

  return cron_art_callOpenAI_(apiKey, systemPrompt, userPrompt);
}

// =====================================================
// OpenAI API呼び出し共通
// =====================================================

function cron_art_callOpenAI_(apiKey, systemPrompt, userPrompt) {
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
// Pexels API — ヘッダ画像取得
// =====================================================

function cron_art_fetchHeaderImage_(query) {
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
// スケジュール記事生成（月水金日のみ、cronDaily6から呼び出し）
// =====================================================

function generateScheduledArticle() {
  var dow = new Date().getDay(); // 0=日,1=月,...,6=土
  var majorCategory = DAY_CATEGORY_SCHEDULE[dow];
  if (!majorCategory) {
    console.log('記事生成スキップ: 本日(' + dow + ')は生成対象外');
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('記事生成: ロック取得失敗（既に実行中）');
    return;
  }

  try {
    var sheet = cron_art_getSheet_();
    var lastRow = sheet.getLastRow();

    var pastTitles = [];
    var pastCategories = [];
    if (lastRow >= 2) {
      var cols = sheet.getRange(2, 1, lastRow - 1, ARTICLE_COLS.MAJOR_CATEGORY + 1).getValues();
      for (var i = cols.length - 1; i >= 0; i--) {
        var t = String(cols[i][ARTICLE_COLS.TITLE] || '').trim();
        if (t) pastTitles.push(t);
        pastCategories.push({
          category: String(cols[i][ARTICLE_COLS.CATEGORY] || ''),
          majorCategory: String(cols[i][ARTICLE_COLS.MAJOR_CATEGORY] || '')
        });
      }
    }

    var article;
    if (majorCategory === 'トレンド情報') {
      var trendData = cron_art_getTrendData_();
      article = cron_art_generateTrendArticle_(pastTitles, trendData);
    } else {
      article = cron_art_generateArticle_(pastTitles, majorCategory, pastCategories);
    }

    var id = cron_art_generateId_();
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var publishDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var imageUrl = cron_art_fetchHeaderImage_(article.imageQuery || '');

    var row = [
      id, article.title || '', article.summary || '', article.content || '',
      article.category || '総合', article.tags || '', publishDate,
      article.emoji || '', 'published', imageUrl, majorCategory
    ];

    sheet.appendRow(row);

    console.log('記事生成完了: [' + majorCategory + '] ' + id + ' - ' + article.title);
    return { ok: true, id: id, title: article.title, majorCategory: majorCategory };
  } catch (e) {
    console.error('記事生成エラー: ' + (e.message || e));
    return { ok: false, message: e.message || String(e) };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// 3ヶ月以上前の記事を自動削除（日次実行）
// =====================================================

function cron_art_cleanupOldArticles_() {
  try {
    var sheet = cron_art_getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var now = new Date();
    var threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());

    var dateCol = sheet.getRange(2, ARTICLE_COLS.PUBLISH_DATE + 1, lastRow - 1, 1).getValues();
    var deleted = 0;

    // 下→上の順で削除（行番号がずれないように）
    for (var i = dateCol.length - 1; i >= 0; i--) {
      var val = dateCol[i][0];
      if (!val) continue;
      var d = (val instanceof Date) ? val : new Date(String(val).trim());
      if (isNaN(d.getTime())) continue;
      if (d < threeMonthsAgo) {
        sheet.deleteRow(i + 2); // +2 = ヘッダー分 + 0始まり
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log('古い記事クリーンアップ: ' + deleted + '件削除');
    }
  } catch (e) {
    console.error('記事クリーンアップエラー: ' + (e.message || e));
  }
}

// =====================================================
// 後方互換: 旧関数名からの委譲
// =====================================================

function generateDailyArticle() {
  return generateScheduledArticle();
}

// =====================================================
// 重複回避ヘルパー: トライグラム類似度
// =====================================================

/**
 * 2つのテキストのトライグラム（3文字部分文字列）Jaccard類似度を計算
 * 0.0（完全不一致）〜1.0（完全一致）
 */
function cron_art_trigramSimilarity_(text1, text2) {
  var g1 = cron_art_getNgrams_(text1, 3);
  var g2 = cron_art_getNgrams_(text2, 3);
  var keys1 = Object.keys(g1);
  var keys2 = Object.keys(g2);
  if (keys1.length === 0 || keys2.length === 0) return 0;

  var intersection = 0;
  for (var i = 0; i < keys1.length; i++) {
    if (g2[keys1[i]]) intersection++;
  }

  // 和集合 = |A| + |B| - |A∩B|
  var union = keys1.length + keys2.length - intersection;
  return union > 0 ? intersection / union : 0;
}

function cron_art_getNgrams_(text, n) {
  // 記号・数字・スペースを除去し、ひらがな・カタカナ・漢字・英字のみ残す
  var clean = text.toLowerCase().replace(/[\s・：！？、。（）「」\d\-\/\+%＋％×→←↑↓…〜~,;\[\]{}()#@&*_=<>'"]/g, '');
  var ngrams = {};
  for (var i = 0; i <= clean.length - n; i++) {
    ngrams[clean.substring(i, i + n)] = true;
  }
  return ngrams;
}

/**
 * トピック文からカテゴリ（例: 中国輸入, メルカリ, eBay等）を推定
 */
function cron_art_guessCategory_(topic) {
  var map = {
    'メルカリ': 'メルカリ', 'ラクマ': 'ラクマ', 'Yahoo': 'Yahoo!フリマ',
    'ヤフオク': 'Yahoo!フリマ', 'Amazon': 'Amazon', 'eBay': 'eBay',
    'Shopify': '副業全般', '中国輸入': '中国輸入', 'アリババ': '中国輸入',
    '1688': '中国輸入', 'セカンドストリート': 'アパレル', 'ブックオフ': 'アパレル',
    'フィギュア': 'アパレル', 'おもちゃ': 'アパレル', 'ハンドメイド': '副業全般',
    '古着': 'アパレル', 'アパレル': 'アパレル', 'せどり': 'せどり',
    '確定申告': '副業全般', '法人化': '副業全般', '外注': '副業全般'
  };
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (topic.indexOf(keys[i]) !== -1) return map[keys[i]];
  }
  return null;
}
