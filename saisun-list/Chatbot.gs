// =====================================================
// AIチャットボット API（OpenAI GPT）
// =====================================================

/**
 * OpenAI APIキーを設定（GASエディタで1回だけ実行）
 * ★ 下の 'sk-xxxxx' を実際のAPIキーに変えてから実行
 */
function setChatbotApiKey() {
  var key = 'sk-xxxxx';  // ← ここを実際のOpenAI APIキーに置き換え
  if (key === 'sk-xxxxx') {
    var ui = SpreadsheetApp.getUi();
    ui.alert('エラー', 'APIキーを実際の値に置き換えてから実行してください。', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('OPENAI_API_KEY', key);
  SpreadsheetApp.getUi().alert('OPENAI_API_KEY を設定しました。\nセキュリティのため、このコード内のキー文字列を削除してください。');
}

/**
 * OpenAI APIキーを削除
 */
function removeChatbotApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('OPENAI_API_KEY');
  SpreadsheetApp.getUi().alert('OPENAI_API_KEY を削除しました。定型応答モードに切り替わります。');
}

var CHATBOT_CONFIG = {
  MODEL: 'gpt-4o-mini',
  ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  MAX_TOKENS: 500,
  TEMPERATURE: 0.7,
  RATE_LIMIT_MAX: 10,
  RATE_LIMIT_WINDOW_SEC: 300,  // 5分間に10回まで
  MAX_HISTORY: 6  // 直近6メッセージ（3往復）をコンテキストに含める
};

/**
 * チャットボットAPI
 * @param {string} userKey - ユーザー識別キー
 * @param {object} params - { message: string, history: Array }
 * @return {object} { ok, reply }
 */
function apiChatbot(userKey, params) {
  try {
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    var userMessage = String((params && params.message) || '').trim();
    if (!userMessage) return { ok: false, message: 'メッセージを入力してください' };
    if (userMessage.length > 500) return { ok: false, message: 'メッセージは500文字以内でお願いします' };

    // レート制限チェック
    var rateErr = chatbot_checkRateLimit_(uk);
    if (rateErr) return { ok: false, message: rateErr };

    // OpenAI APIキー取得
    var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
    if (!apiKey) {
      // APIキーが未設定の場合は定型応答
      return { ok: true, reply: chatbot_fallbackReply_(userMessage) };
    }

    // 会話履歴の構築
    var history = (params && Array.isArray(params.history)) ? params.history : [];
    history = history.slice(-CHATBOT_CONFIG.MAX_HISTORY);

    var messages = [{ role: 'system', content: chatbot_buildSystemPrompt_() }];

    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      if (h && h.role && h.content) {
        var role = (h.role === 'user') ? 'user' : 'assistant';
        messages.push({ role: role, content: String(h.content).slice(0, 500) });
      }
    }

    messages.push({ role: 'user', content: userMessage });

    // OpenAI API呼び出し
    var reply = chatbot_callOpenAI_(apiKey, messages);
    return { ok: true, reply: reply };

  } catch (e) {
    console.error('apiChatbot error:', e);
    return { ok: false, message: '申し訳ございません。一時的にエラーが発生しました。しばらくしてから再度お試しください。' };
  }
}

/**
 * システムプロンプト構築（店舗情報を埋め込む）
 */
function chatbot_buildSystemPrompt_() {
  var memberDiscount = app_getMemberDiscountStatus_();
  var memberDiscountText = memberDiscount.enabled
    ? '会員登録で10%OFF（' + memberDiscount.endDate + 'まで）が適用されます。30点以上購入で10%割引との併用も可能です。'
    : '現在、会員割引は実施しておりません。30点以上購入で10%割引は適用されます。';

  return [
    'あなたは「デタウリ.Detauri」の公式AIアシスタントです。',
    '古着卸売のECサイトで、BtoB向けに採寸データ付きの古着を10点から販売しています。',
    '',
    '【店舗基本情報】',
    '・サイト名：デタウリ.Detauri',
    '・サイトURL：https://wholesale.nkonline-tool.com/',
    '・業態：古着卸売（BtoB）',
    '・最低注文数：10点から',
    '・特徴：全商品に採寸データ（着丈・肩幅・身幅・袖丈など）が付いています',
    '・お問い合わせ先：nkonline1030@gmail.com',
    '',
    '【注文の流れ】',
    '1. 商品を選んでカートに入れる（カートに入れると15分間確保されます）',
    '2. 10点以上選んだら「注文手続きへ」ボタンを押す',
    '3. お届け先情報を入力（送料が自動計算されます）',
    '4. 決済方法を選択して注文確定',
    '',
    '【決済方法】',
    '・クレジットカード',
    '・コンビニ払い',
    '・銀行振込',
    '',
    '【割引情報】',
    '・30点以上ご購入で10%割引',
    '・' + memberDiscountText,
    '',
    '【送料について】',
    '・送料は地域と点数（10点以下＝小箱、11点以上＝大箱）で決まります',
    '・関西エリア：1,100〜1,260円',
    '・関東エリア：1,300〜1,680円',
    '・北海道：1,640〜2,380円',
    '・沖縄：2,500〜3,500円',
    '・離島は配送対象外の場合があります',
    '・ダイヤモンド会員は送料無料',
    '',
    '【会員ランク制度】',
    '・レギュラー：ポイント1%',
    '・シルバー（年間5万円以上）：ポイント3%',
    '・ゴールド（年間20万円以上）：ポイント5%',
    '・ダイヤモンド（年間50万円以上）：ポイント5% + 送料無料',
    '',
    '【対応ルール】',
    '・日本語で丁寧に回答してください',
    '・回答は簡潔にまとめてください（200文字以内目安）',
    '・分からないことは正直に伝え、お問い合わせフォームやメール（nkonline1030@gmail.com）への連絡を案内してください',
    '・個人情報やセキュリティに関わる質問には答えないでください',
    '・商品の在庫状況や具体的な商品の推薦はできません（サイトで直接検索するよう案内してください）',
    '・競合サービスについてのコメントは控えてください'
  ].join('\n');
}

/**
 * OpenAI API呼び出し
 */
function chatbot_callOpenAI_(apiKey, messages) {
  var payload = {
    model: CHATBOT_CONFIG.MODEL,
    messages: messages,
    max_tokens: CHATBOT_CONFIG.MAX_TOKENS,
    temperature: CHATBOT_CONFIG.TEMPERATURE
  };

  var res = UrlFetchApp.fetch(CHATBOT_CONFIG.ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';

  if (code < 200 || code >= 300) {
    console.error('OpenAI API error: ' + code + ' ' + body);
    throw new Error('AI応答の取得に失敗しました');
  }

  var json = JSON.parse(body);
  if (!json.choices || !json.choices[0] || !json.choices[0].message) {
    throw new Error('AI応答が不正です');
  }

  return String(json.choices[0].message.content || '').trim();
}

/**
 * APIキーなしの場合の定型応答（ルールベース）
 * キーワードマッチングで幅広い質問に対応
 */
function chatbot_fallbackReply_(message) {
  var msg = String(message || '');
  var lower = msg.toLowerCase();
  // カタカナ→ひらがな変換（簡易）
  var hira = msg.replace(/[\u30A1-\u30F6]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0x60);
  });

  // ルール定義: [キーワード配列, 応答文]
  var rules = [
    // --- 送料・配送 ---
    [['送料', '配送', '発送', '届く', '届け', '何日', '日数', '到着'],
     '送料は地域と注文点数で異なります。\n\n' +
     '【目安（税込）】\n' +
     '・関西：1,100〜1,260円\n' +
     '・関東：1,300〜1,680円\n' +
     '・北海道：1,640〜2,380円\n' +
     '・沖縄：2,500〜3,500円\n\n' +
     '10点以下＝小箱、11点以上＝大箱で料金が変わります。\n' +
     'お届け先の住所入力後に自動計算されます。\n' +
     '※離島は配送対象外の場合があります。'],

    // --- 注文方法 ---
    [['注文', '購入', '買い方', '買う', '頼み方', 'カート', '手順', '流れ', 'やり方', '使い方'],
     '【注文の流れ】\n' +
     '1. 商品を選んでカートに追加（15分間確保されます）\n' +
     '2. 10点以上選んだら「注文手続きへ」\n' +
     '3. お届け先を入力（送料が自動計算されます）\n' +
     '4. 決済方法を選んで注文確定\n\n' +
     '※最低注文数は10点からです。在庫は先着順のためお早めにどうぞ。'],

    // --- 決済方法 ---
    [['決済', '支払', 'カード', 'クレジット', 'コンビニ', '振込', '銀行', 'pay'],
     '以下の決済方法に対応しています。\n\n' +
     '・クレジットカード（即時決済）\n' +
     '・コンビニ払い\n' +
     '・銀行振込\n\n' +
     '注文確定後、お支払いの確認ができ次第、発送準備に入ります。'],

    // --- 割引 ---
    [['割引', 'セール', '安く', 'お得', 'クーポン', 'キャンペーン', 'オフ', 'off', 'OFF', '値引'],
     '現在ご利用いただける割引は以下の通りです。\n\n' +
     '・30点以上ご購入で10%割引\n' +
     '・会員登録で10%OFF（2026年9月末まで）\n\n' +
     '上記2つは併用可能です！まとめ買いがお得です。'],

    // --- 会員・ランク・ポイント ---
    [['会員', 'ランク', 'ポイント', '登録', 'アカウント', 'ログイン', 'サインアップ'],
     '【会員ランク制度】\n' +
     '年間ご購入額に応じてランクが決まります。\n\n' +
     '・レギュラー：ポイント1%\n' +
     '・シルバー（年間5万円〜）：ポイント3%\n' +
     '・ゴールド（年間20万円〜）：ポイント5%\n' +
     '・ダイヤモンド（年間50万円〜）：ポイント5% + 送料無料\n\n' +
     'ポイントは次回のお買い物で1pt=1円としてご利用いただけます。\n' +
     '会員登録は無料です。'],

    // --- 採寸・サイズ ---
    [['採寸', 'サイズ', '寸法', '測定', 'センチ', 'cm', '着丈', '肩幅', '身幅', '袖丈'],
     '全商品に詳細な採寸データが付いています。\n\n' +
     '【計測項目の例】\n' +
     '着丈・肩幅・身幅・袖丈・裄丈・総丈・ウエスト・股上・股下・ワタリ・裾幅・ヒップ\n\n' +
     '商品カードをクリックすると詳細画面で確認できます。'],

    // --- 問い合わせ ---
    [['問い合わせ', '連絡', 'メール', '電話', '相談', 'サポート', '質問'],
     'お問い合わせ方法は以下の通りです。\n\n' +
     '・サイト内のお問い合わせフォーム\n' +
     '・メール：nkonline1030@gmail.com\n\n' +
     '2営業日以内にご返信いたします。お気軽にどうぞ。'],

    // --- キャンセル・返品 ---
    [['キャンセル', '返品', '返金', '交換', '取り消し'],
     '注文確定後のキャンセル・変更はできません。\n' +
     '商品に問題があった場合は、お問い合わせフォームまたはメール（nkonline1030@gmail.com）までご連絡ください。'],

    // --- 確保・在庫 ---
    [['確保', '在庫', '売り切れ', '品切れ', '入荷', 'なくな'],
     'カートに入れた商品は15分間確保されます。\n' +
     '15分を過ぎると確保が解除され、他の方が購入できるようになります。\n\n' +
     '在庫は先着順です。お目当ての商品が見つかったらお早めにお手続きください。'],

    // --- 検索・探し方 ---
    [['検索', '探し', '見つけ', 'フィルタ', 'ブランド', 'カテゴリ', '絞り込み'],
     '商品の探し方は以下の通りです。\n\n' +
     '・キーワード検索（ブランド名・商品名等）\n' +
     '・ブランド別フィルタ（頭文字から選択）\n' +
     '・カテゴリ・性別・サイズ・状態で絞り込み\n' +
     '・並び替え（価格順・新着順等）\n\n' +
     'ページ上部のフィルタをお試しください。'],

    // --- 古着・商品について ---
    [['古着', '商品', '品質', '状態', 'コンディション', '傷', '汚れ', '中古'],
     '当店は採寸データ付き古着卸です。\n\n' +
     '各商品には状態（S/A/B/C等）が表示されており、傷や汚れがある場合は詳細に記載しています。\n' +
     '商品カードをクリックすると、傷汚れ詳細と採寸データを確認できます。'],

    // --- 最低注文数 ---
    [['最低', '何点', '何枚', '1点', '1枚', '少量'],
     '最低注文数は10点からです。\n' +
     '30点以上のご購入で10%割引が適用されますので、まとめ買いがお得です。'],

    // --- 離島 ---
    [['離島', '沖縄', '小笠原', '奄美', '対馬'],
     '一部の離島は配送対象外となる場合があります。\n' +
     '沖縄本島は配送可能です（送料：2,500〜3,500円）。\n\n' +
     '配送可否の詳細はお問い合わせください。\n' +
     'メール：nkonline1030@gmail.com'],

    // --- あいさつ ---
    [['こんにちは', 'はじめまして', 'おはよう', 'こんばんは', 'ハロー', 'hello', 'hi'],
     'こんにちは！デタウリ.Detauriへようこそ。\n\n' +
     '採寸データ付き古着卸です。10点からご購入いただけます。\n' +
     'ご質問がありましたらお気軽にどうぞ。'],

    // --- 感謝 ---
    [['ありがとう', 'サンキュー', 'thanks', '助かり'],
     'お役に立てて嬉しいです！\n他にもご質問がありましたらお気軽にどうぞ。']
  ];

  // キーワードマッチング
  for (var i = 0; i < rules.length; i++) {
    var keywords = rules[i][0];
    var reply = rules[i][1];
    for (var j = 0; j < keywords.length; j++) {
      var kw = keywords[j];
      if (msg.indexOf(kw) !== -1 || lower.indexOf(kw.toLowerCase()) !== -1 || hira.indexOf(kw) !== -1) {
        return reply;
      }
    }
  }

  // どのルールにもマッチしない場合
  return 'お問い合わせありがとうございます。\n\n' +
    'よくあるご質問：\n' +
    '・「注文方法」 → 注文の流れ\n' +
    '・「送料」 → 送料の目安\n' +
    '・「決済方法」 → 支払い方法\n' +
    '・「割引」 → 現在のキャンペーン\n' +
    '・「会員ランク」 → ポイント制度\n' +
    '・「採寸データ」 → サイズ情報\n\n' +
    '上記以外のご質問はお問い合わせフォームまたはメール（nkonline1030@gmail.com）までお願いいたします。';
}

/**
 * チャットボット専用レート制限
 */
function chatbot_checkRateLimit_(userKey) {
  var cache = CacheService.getScriptCache();
  var key = 'RL:apiChatbot:' + userKey;
  var raw = cache.get(key);
  var count = raw ? parseInt(raw, 10) : 0;

  if (count >= CHATBOT_CONFIG.RATE_LIMIT_MAX) {
    return 'しばらくお待ちください。チャットは5分間に' + CHATBOT_CONFIG.RATE_LIMIT_MAX + '回までご利用いただけます。';
  }

  cache.put(key, String(count + 1), CHATBOT_CONFIG.RATE_LIMIT_WINDOW_SEC);
  return null;
}
