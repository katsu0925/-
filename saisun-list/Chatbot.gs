// =====================================================
// AIチャットボット API（OpenAI GPT）
// =====================================================

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
 * APIキーなしの場合の定型応答
 */
function chatbot_fallbackReply_(message) {
  var msg = message.toLowerCase();

  if (msg.indexOf('送料') !== -1 || msg.indexOf('配送') !== -1) {
    return '送料は地域と注文点数により異なります。関西エリアで1,100〜1,260円、関東エリアで1,300〜1,680円です。お届け先入力後に自動計算されます。';
  }
  if (msg.indexOf('注文') !== -1 || msg.indexOf('購入') !== -1 || msg.indexOf('買い方') !== -1) {
    return '商品を10点以上カートに入れて「注文手続きへ」からお進みください。カートに入れた商品は15分間確保されます。';
  }
  if (msg.indexOf('決済') !== -1 || msg.indexOf('支払') !== -1 || msg.indexOf('カード') !== -1) {
    return 'クレジットカード・コンビニ払い・銀行振込の3つの決済方法に対応しています。';
  }
  if (msg.indexOf('割引') !== -1 || msg.indexOf('セール') !== -1) {
    return '30点以上のご購入で10%割引が適用されます。また、会員登録で10%OFFキャンペーンも実施中です（併用可）。';
  }
  if (msg.indexOf('会員') !== -1 || msg.indexOf('ランク') !== -1 || msg.indexOf('ポイント') !== -1) {
    return '会員ランク制度があります。レギュラー(1%)、シルバー(3%)、ゴールド(5%)、ダイヤモンド(5%+送料無料)です。年間購入額で決まります。';
  }
  if (msg.indexOf('採寸') !== -1 || msg.indexOf('サイズ') !== -1 || msg.indexOf('寸法') !== -1) {
    return '全商品に着丈・肩幅・身幅・袖丈などの採寸データが付いています。商品詳細画面で確認できます。';
  }
  if (msg.indexOf('問い合わせ') !== -1 || msg.indexOf('連絡') !== -1 || msg.indexOf('メール') !== -1) {
    return 'お問い合わせはサイト内のお問い合わせフォーム、またはメール（nkonline1030@gmail.com）までお気軽にどうぞ。';
  }

  return 'デタウリ.Detauriへようこそ！採寸データ付き古着卸です。10点からご購入いただけます。送料、決済方法、会員ランクなどご質問がありましたらお気軽にどうぞ。';
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
