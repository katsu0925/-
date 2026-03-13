// WeeklyNewsletter.gs
// =====================================================
// 週3回 定期メルマガ（火・木・土）
// 火: 売れた速報  木: ブランドコラム  土: 週末ピックアップ
// =====================================================

// 配信履歴キー（Script Properties）
var WN_HISTORY_KEY = 'WEEKLY_NL_HISTORY';       // 過去配信ブランド/切り口JSON
var WN_ROTATION_KEY = 'WEEKLY_NL_ROTATION_IDX';  // 土曜ローテーションindex

// UTM共通
var WN_UTM_SOURCE = 'newsletter';
var WN_UTM_MEDIUM = 'email';

// =====================================================
// メインディスパッチャー（cronNewsletter3 から呼ばれる）
// =====================================================

/**
 * 週3回メルマガ配信 メインエントリ
 * 火曜=売れた速報, 木曜=ブランドコラム, 土曜=週末ピックアップ
 * トリガー: cronWeeklyNewsletter（毎日10:30にセット）
 */
function weeklyNewsletterCron_() {
  try {
    var today = new Date();
    var dow = today.getDay(); // 0=日,1=月,2=火,3=水,4=木,5=金,6=土

    // 毎月1日はスキップ（月次サマリーと重複回避）
    if (today.getDate() === 1) {
      console.log('weeklyNewsletterCron_: 毎月1日はスキップ（月次サマリー優先）');
      return;
    }

    if (dow === 2) {
      wn_sendSoldReport_();
    } else if (dow === 4) {
      wn_sendBrandColumn_();
    } else if (dow === 6) {
      wn_sendWeekendPicks_();
    }
    // 火木土以外は何もしない
  } catch (e) {
    console.error('weeklyNewsletterCron_ error:', e);
  }
}

// =====================================================
// UTMヘルパー
// =====================================================

function wn_buildUtmUrl_(baseUrl, campaign) {
  var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
  return baseUrl + sep
    + 'utm_source=' + WN_UTM_SOURCE
    + '&utm_medium=' + WN_UTM_MEDIUM
    + '&utm_campaign=' + encodeURIComponent(campaign);
}

function wn_campaignName_(prefix) {
  var d = new Date();
  return prefix + '_' + Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
}

// =====================================================
// 共通: 重複防止チェック
// =====================================================

/**
 * 今日すでにマーケ系メールを受信した顧客を除外
 * @param {Array} recipients getNewsletterRecipients_() の戻り値
 * @returns {Array} フィルタ済み受信者リスト
 */
function wn_filterAlreadySent_(recipients) {
  var cache = CacheService.getScriptCache();
  var todayKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var filtered = [];

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    var key = 'WN_SENT_' + todayKey + '_' + r.email;
    if (!cache.get(key)) {
      filtered.push(r);
    }
  }
  return filtered;
}

/**
 * 送信済みフラグを記録（24時間有効）
 */
function wn_markSent_(email) {
  var cache = CacheService.getScriptCache();
  var todayKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  cache.put('WN_SENT_' + todayKey + '_' + email, '1', 86400);
}

// =====================================================
// 価格フォーマット
// =====================================================

function wn_formatPrice_(price) {
  return '¥' + String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// =====================================================
// 火曜: 売れた速報
// =====================================================

function wn_sendSoldReport_() {
  console.log('wn_sendSoldReport_: 開始');

  // データ1シートから管理番号→商品情報マップを構築
  var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
  var dataSheet = dataSs.getSheetByName(APP_CONFIG.data.sheetName);
  var stockCount = 0;
  var productMap = {}; // 管理番号 → {brand, category, price}
  if (dataSheet) {
    var headerRow = Number(APP_CONFIG.data.headerRow || 2);
    var dataLastRow = dataSheet.getLastRow();
    stockCount = Math.max(0, dataLastRow - headerRow);
    if (dataLastRow > headerRow) {
      var dataValues = dataSheet.getRange(headerRow + 1, 1, dataLastRow - headerRow, 11).getValues();
      for (var d = 0; d < dataValues.length; d++) {
        var mid = String(dataValues[d][10] || '').trim(); // K列: 管理番号
        if (!mid) continue;
        productMap[mid] = {
          brand: String(dataValues[d][3] || '').trim(),    // D列
          category: String(dataValues[d][6] || '').trim(), // G列
          price: Number(dataValues[d][8] || 0)             // I列
        };
      }
    }
  }

  // 依頼管理シートから直近の売約データを取得
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (!sh) { console.log('wn_sendSoldReport_: 依頼管理シートなし'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { console.log('wn_sendSoldReport_: データなし'); return; }

  var data = sh.getRange(2, 1, lastRow - 1, 35).getValues(); // AI列(35)まで取得

  // 直近7日の売約を集計
  var now = new Date();
  var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  var soldItems = [];
  var brandCount = {};

  for (var i = 0; i < data.length; i++) {
    var dateVal = data[i][1]; // B列: 依頼日時
    if (!(dateVal instanceof Date)) continue;
    if (dateVal < weekAgo) continue;

    var status = String(data[i][21] || '').trim(); // V列
    if (status === 'キャンセル' || status === '返品') continue;

    var selectionList = String(data[i][9] || '').trim(); // J列: 選択リスト
    if (!selectionList) continue;

    var managedIds = u_parseSelectionList_(selectionList);
    if (managedIds.length === 0) continue;

    // AI列: 商品単価JSON（データ1から消えた商品のフォールバック用）
    var unitPriceMap = {};
    try {
      var aiVal = data[i][34]; // AI列(idx 34)
      if (aiVal) unitPriceMap = JSON.parse(String(aiVal));
    } catch (e) { /* パースエラーは無視 */ }

    for (var j = 0; j < managedIds.length; j++) {
      var mid = managedIds[j];
      var info = productMap[mid];
      if (info) {
        soldItems.push({
          name: info.brand + ' / ' + info.category,
          amount: info.price,
          brand: info.brand,
          date: dateVal
        });
        if (info.brand) brandCount[info.brand] = (brandCount[info.brand] || 0) + 1;
      } else {
        // データ1から削除済み → AI列の単価JSONでフォールバック
        var fbPrice = Number(unitPriceMap[mid] || 0);
        soldItems.push({
          name: mid,
          amount: fbPrice,
          brand: '',
          date: dateVal
        });
      }
    }
  }

  if (soldItems.length === 0) {
    console.log('wn_sendSoldReport_: 直近7日の売約なし → スキップ');
    return;
  }

  // 人気ブランドTOP3
  var brandRanking = Object.keys(brandCount).sort(function(a, b) {
    return brandCount[b] - brandCount[a];
  }).slice(0, 3);

  var campaign = wn_campaignName_('weekly_sold');
  var siteUrl = wn_buildUtmUrl_(SITE_CONSTANTS.SITE_URL, campaign);

  // メール内容構築
  var sampleItems = [];
  var recent = soldItems.slice(-5).reverse();
  for (var s = 0; s < recent.length; s++) {
    var item = recent[s];
    var label = item.name;
    if (item.amount > 0) label += '  ' + wn_formatPrice_(item.amount);
    sampleItems.push(label);
  }
  if (soldItems.length > 5) {
    sampleItems.push('...他 ' + (soldItems.length - 5) + '件');
  }

  var brandText = brandRanking.length > 0
    ? '人気ブランド: ' + brandRanking.join('、')
    : '';

  // 送信
  var recipients = wn_filterAlreadySent_(getNewsletterRecipients_());
  var sent = 0;

  for (var c = 0; c < recipients.length; c++) {
    var recip = recipients[c];
    try {
      var subject = '【デタウリ】今週 ' + soldItems.length + '点が売約｜残り' + stockCount + '点';
      var body = recip.companyName + ' 様\n\n'
        + 'いつもデタウリ.Detauri をご利用いただきありがとうございます。\n\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '■ 今週の売約速報 ' + soldItems.length + '点\n'
        + '━━━━━━━━━━━━━━━━━━━━\n';
      for (var si = 0; si < sampleItems.length; si++) {
        body += '  ・' + sampleItems[si] + '\n';
      }
      body += '\n';
      if (brandText) body += brandText + '\n\n';
      body += '現在の在庫: ' + stockCount + '点\n'
        + '人気商品は早い者勝ちです。\n\n'
        + '▼ 在庫を今すぐ確認\n' + siteUrl + '\n\n'
        + '※ このメールはメルマガ配信にご登録いただいた方にお送りしています。\n'
        + '※ 配信停止: ' + nl_buildUnsubscribeUrl_(recip.email) + '\n\n'
        + '──────────────────\n'
        + SITE_CONSTANTS.SITE_NAME + '\n'
        + SITE_CONSTANTS.SITE_URL + '\n'
        + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
        + '──────────────────\n';

      var sections = [{
        title: '今週の売約速報 ' + soldItems.length + '点',
        items: sampleItems
      }];
      if (brandText) {
        sections.push({ title: '注目ブランド', text: brandText });
      }
      sections.push({
        title: '現在の在庫',
        text: stockCount + '点 — 人気商品は早い者勝ちです'
      });

      GmailApp.sendEmail(recip.email, subject, body, {
        from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
        htmlBody: buildHtmlEmail_({
          greeting: recip.companyName + ' 様',
          lead: 'いつもデタウリ.Detauri をご利用いただきありがとうございます。',
          sections: sections,
          cta: { text: '在庫を今すぐ確認', url: siteUrl },
          notes: [
            '人気商品は早い者勝ちです。会員様は確保時間が30分に延長されます。',
            'このメールはメルマガ配信にご登録いただいた方にお送りしています。'
          ],
          unsubscribe: nl_buildUnsubscribeUrl_(recip.email)
        })
      });
      wn_markSent_(recip.email);
      sent++;
    } catch (mailErr) {
      console.error('wn_sendSoldReport_ mail error: ' + recip.email, mailErr);
    }
  }

  console.log('wn_sendSoldReport_: 完了 売約=' + soldItems.length + '点, 送信=' + sent + '件');
}

// =====================================================
// 木曜: ブランドコラム
// =====================================================

function wn_sendBrandColumn_() {
  console.log('wn_sendBrandColumn_: 開始');

  // 在庫データからブランド別集計
  var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
  var dataSheet = dataSs.getSheetByName(APP_CONFIG.data.sheetName);
  if (!dataSheet) { console.log('wn_sendBrandColumn_: データ1シートなし'); return; }

  var headerRow = Number(APP_CONFIG.data.headerRow || 2);
  var lastRow = dataSheet.getLastRow();
  if (lastRow <= headerRow) return;

  var values = dataSheet.getRange(headerRow + 1, 1, lastRow - headerRow, 11).getValues();

  var brandStats = {};
  for (var i = 0; i < values.length; i++) {
    var brand = String(values[i][3] || '').trim();  // D列
    var category = String(values[i][6] || '').trim(); // G列
    var price = Number(values[i][8] || 0);           // I列
    if (!brand) continue;

    if (!brandStats[brand]) {
      brandStats[brand] = { count: 0, categories: {}, prices: [], totalPrice: 0 };
    }
    brandStats[brand].count++;
    brandStats[brand].categories[category] = (brandStats[brand].categories[category] || 0) + 1;
    if (price > 0) {
      brandStats[brand].prices.push(price);
      brandStats[brand].totalPrice += price;
    }
  }

  // 過去12週の配信ブランドを取得（重複回避）
  var props = PropertiesService.getScriptProperties();
  var historyJson = props.getProperty(WN_HISTORY_KEY);
  var history = [];
  try { if (historyJson) history = JSON.parse(historyJson); } catch (e) { history = []; }

  // 在庫数順にソートし、過去12週に出ていないブランドを選択
  var sorted = Object.keys(brandStats).sort(function(a, b) {
    return brandStats[b].count - brandStats[a].count;
  });

  var targetBrand = null;
  for (var b = 0; b < sorted.length; b++) {
    if (history.indexOf(sorted[b]) === -1 && brandStats[sorted[b]].count >= 3) {
      targetBrand = sorted[b];
      break;
    }
  }
  // 全ブランド使い切った場合は履歴リセット
  if (!targetBrand && sorted.length > 0) {
    history = [];
    targetBrand = sorted[0];
  }
  if (!targetBrand) { console.log('wn_sendBrandColumn_: 対象ブランドなし'); return; }

  // 履歴更新（最大12件保持）
  history.push(targetBrand);
  if (history.length > 12) history = history.slice(-12);
  props.setProperty(WN_HISTORY_KEY, JSON.stringify(history));

  var stats = brandStats[targetBrand];
  var avgPrice = stats.prices.length > 0 ? Math.round(stats.totalPrice / stats.prices.length) : 0;
  var minPrice = stats.prices.length > 0 ? Math.min.apply(null, stats.prices) : 0;
  var maxPrice = stats.prices.length > 0 ? Math.max.apply(null, stats.prices) : 0;

  var catList = Object.keys(stats.categories).sort(function(a, b) {
    return stats.categories[b] - stats.categories[a];
  });

  // AI生成（フォールバック付き）
  var columnText = '';
  try {
    columnText = wn_generateBrandColumnAI_(targetBrand, stats, catList, avgPrice);
  } catch (aiErr) {
    console.error('wn_sendBrandColumn_ AI生成失敗、テンプレートにフォールバック:', aiErr);
    columnText = wn_brandColumnFallback_(targetBrand, stats, catList, avgPrice);
  }

  var campaign = wn_campaignName_('brand_column');
  var siteUrl = wn_buildUtmUrl_(SITE_CONSTANTS.SITE_URL, campaign);
  var brandUrl = wn_buildUtmUrl_(SITE_CONSTANTS.SITE_URL + '?brand=' + encodeURIComponent(targetBrand), campaign);

  // 送信
  var recipients = wn_filterAlreadySent_(getNewsletterRecipients_());
  var sent = 0;

  for (var c = 0; c < recipients.length; c++) {
    var recip = recipients[c];
    try {
      var subject = '【デタウリ】' + targetBrand + ' 特集｜在庫' + stats.count + '点';
      var body = recip.companyName + ' 様\n\n'
        + columnText + '\n\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '■ ' + targetBrand + ' の在庫データ\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '  在庫数: ' + stats.count + '点\n'
        + '  価格帯: ' + wn_formatPrice_(minPrice) + ' 〜 ' + wn_formatPrice_(maxPrice) + '\n'
        + '  平均価格: ' + wn_formatPrice_(avgPrice) + '\n'
        + '  カテゴリ: ' + catList.join('、') + '\n\n'
        + '▼ ' + targetBrand + ' の商品を見る\n' + brandUrl + '\n\n'
        + '▼ 全商品を見る\n' + siteUrl + '\n\n'
        + '※ このメールはメルマガ配信にご登録いただいた方にお送りしています。\n'
        + '※ 配信停止: ' + nl_buildUnsubscribeUrl_(recip.email) + '\n\n'
        + '──────────────────\n'
        + SITE_CONSTANTS.SITE_NAME + '\n'
        + SITE_CONSTANTS.SITE_URL + '\n'
        + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
        + '──────────────────\n';

      GmailApp.sendEmail(recip.email, subject, body, {
        from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
        htmlBody: buildHtmlEmail_({
          greeting: recip.companyName + ' 様',
          lead: columnText,
          sections: [{
            title: targetBrand + ' の在庫データ',
            rows: [
              { label: '在庫数', value: stats.count + '点' },
              { label: '価格帯', value: wn_formatPrice_(minPrice) + ' 〜 ' + wn_formatPrice_(maxPrice) },
              { label: '平均価格', value: wn_formatPrice_(avgPrice) },
              { label: 'カテゴリ', value: catList.join('、') }
            ]
          }],
          cta: { text: targetBrand + ' の商品を見る', url: brandUrl },
          notes: [
            '会員様は確保時間が30分に延長されます。ログインしてからお買い物をお楽しみください。',
            'このメールはメルマガ配信にご登録いただいた方にお送りしています。'
          ],
          unsubscribe: nl_buildUnsubscribeUrl_(recip.email)
        })
      });
      wn_markSent_(recip.email);
      sent++;
    } catch (mailErr) {
      console.error('wn_sendBrandColumn_ mail error: ' + recip.email, mailErr);
    }
  }

  console.log('wn_sendBrandColumn_: 完了 ブランド=' + targetBrand + ', 送信=' + sent + '件');
}

/**
 * AI生成: ブランドコラム本文
 */
function wn_generateBrandColumnAI_(brand, stats, catList, avgPrice) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY 未設定');

  var messages = [
    {
      role: 'system',
      content: 'あなたは「デタウリ.Detauri」のメルマガライターです。\n'
        + 'デタウリはBtoB古着卸売ECサイトで、副業で古着販売をする個人がターゲットです。\n'
        + 'ブランドの魅力と、仕入れ視点でのおすすめポイントを3〜5文で簡潔に書いてください。\n'
        + 'ルール:\n'
        + '- 150文字以内で簡潔に\n'
        + '- 仕入れ・転売視点でメリットを書く（「認知度が高く回転率が良い」等）\n'
        + '- 「デタウリでは〜」で始めない。自然な導入で\n'
        + '- 日本語で回答'
    },
    {
      role: 'user',
      content: 'ブランド: ' + brand + '\n'
        + '在庫数: ' + stats.count + '点\n'
        + '平均価格: ' + avgPrice + '円\n'
        + 'カテゴリ: ' + catList.join('、') + '\n'
        + '上記データをもとに、仕入れ担当者向けのブランド紹介コラムを書いてください。'
    }
  ];

  var payload = {
    model: 'gpt-5-mini',
    messages: messages,
    max_completion_tokens: 2000
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
    throw new Error('OpenAI API失敗: ' + code);
  }

  var json = JSON.parse(body);
  if (json.choices && json.choices[0] && json.choices[0].message) {
    var msg = json.choices[0].message;
    if (msg.refusal) throw new Error('AI refusal: ' + msg.refusal);
    return String(msg.content || '').trim();
  }
  throw new Error('OpenAI応答不正');
}

/**
 * テンプレートフォールバック: AI生成失敗時
 */
function wn_brandColumnFallback_(brand, stats, catList, avgPrice) {
  return brand + ' は古着市場で安定した人気を持つブランドです。'
    + '現在デタウリには ' + stats.count + '点の在庫があり、'
    + '平均価格 ' + wn_formatPrice_(avgPrice) + ' と仕入れやすい価格帯です。'
    + (catList.length > 0 ? catList.join('・') + ' を中心に取り揃えています。' : '');
}

// =====================================================
// 土曜: 週末おすすめピックアップ
// =====================================================

function wn_sendWeekendPicks_() {
  console.log('wn_sendWeekendPicks_: 開始');

  var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
  var dataSheet = dataSs.getSheetByName(APP_CONFIG.data.sheetName);
  if (!dataSheet) { console.log('wn_sendWeekendPicks_: データ1シートなし'); return; }

  var headerRow = Number(APP_CONFIG.data.headerRow || 2);
  var lastRow = dataSheet.getLastRow();
  if (lastRow <= headerRow) return;

  var numRows = lastRow - headerRow;
  var values = dataSheet.getRange(headerRow + 1, 1, numRows, 11).getValues();

  // 全商品データ収集
  var products = [];
  var categoryCount = {};
  var brandCount = {};
  var sizeCount = {};

  for (var i = 0; i < values.length; i++) {
    var managedId = String(values[i][10] || '').trim();
    if (!managedId) continue;

    var brand = String(values[i][3] || '').trim();
    var category = String(values[i][6] || '').trim();
    var price = Number(values[i][8] || 0);
    var size = String(values[i][4] || '').trim();
    var state = String(values[i][2] || '').trim();

    products.push({ brand: brand, category: category, price: price, size: size, state: state });

    if (brand) brandCount[brand] = (brandCount[brand] || 0) + 1;
    if (category) categoryCount[category] = (categoryCount[category] || 0) + 1;
    if (size) sizeCount[size] = (sizeCount[size] || 0) + 1;
  }

  if (products.length === 0) return;

  // ローテーション: 6パターン
  var props = PropertiesService.getScriptProperties();
  var rotIdx = Number(props.getProperty(WN_ROTATION_KEY) || 0);
  var patterns = ['brand', 'category', 'price_low', 'price_high', 'size', 'state'];
  var pattern = patterns[rotIdx % patterns.length];
  props.setProperty(WN_ROTATION_KEY, String((rotIdx + 1) % patterns.length));

  var title = '';
  var pickedItems = [];
  var filterParam = '';

  switch (pattern) {
    case 'brand':
      var topBrand = Object.keys(brandCount).sort(function(a, b) { return brandCount[b] - brandCount[a]; })[0];
      title = topBrand + ' 特集 — ' + brandCount[topBrand] + '点が在庫中';
      pickedItems = products.filter(function(p) { return p.brand === topBrand; }).slice(0, 8);
      filterParam = '?brand=' + encodeURIComponent(topBrand);
      break;
    case 'category':
      var topCat = Object.keys(categoryCount).sort(function(a, b) { return categoryCount[b] - categoryCount[a]; })[0];
      title = topCat + ' 特集 — ' + categoryCount[topCat] + '点';
      pickedItems = products.filter(function(p) { return p.category === topCat; }).slice(0, 8);
      filterParam = '?category=' + encodeURIComponent(topCat);
      break;
    case 'price_low':
      title = '3,000円以下のお手頃アイテム';
      pickedItems = products.filter(function(p) { return p.price > 0 && p.price <= 3000; }).slice(0, 8);
      filterParam = '?priceMax=3000';
      break;
    case 'price_high':
      title = 'ハイブランド・プレミアムアイテム';
      pickedItems = products.filter(function(p) { return p.price >= 5000; })
        .sort(function(a, b) { return b.price - a.price; }).slice(0, 8);
      filterParam = '?priceMin=5000';
      break;
    case 'size':
      var topSize = Object.keys(sizeCount).sort(function(a, b) { return sizeCount[b] - sizeCount[a]; })[0];
      title = 'サイズ ' + topSize + ' 充実中 — ' + sizeCount[topSize] + '点';
      pickedItems = products.filter(function(p) { return p.size === topSize; }).slice(0, 8);
      filterParam = '?size=' + encodeURIComponent(topSize);
      break;
    case 'state':
      var newItems = products.filter(function(p) { return p.state === '新品' || p.state === '未使用'; });
      if (newItems.length < 3) {
        // 新品が少ない場合は「状態良好」に切り替え
        newItems = products.filter(function(p) { return p.state === '目立った傷や汚れなし' || p.state === '新品' || p.state === '未使用'; });
        title = '状態良好アイテム特集 — ' + newItems.length + '点';
      } else {
        title = '新品・未使用タグ付き特集 — ' + newItems.length + '点';
      }
      pickedItems = newItems.slice(0, 8);
      filterParam = '';
      break;
  }

  if (pickedItems.length === 0) {
    console.log('wn_sendWeekendPicks_: パターン=' + pattern + ' で対象商品なし');
    return;
  }

  var campaign = wn_campaignName_('weekend_picks');
  var siteUrl = wn_buildUtmUrl_(SITE_CONSTANTS.SITE_URL + (filterParam || ''), campaign);
  var allUrl = wn_buildUtmUrl_(SITE_CONSTANTS.SITE_URL, campaign);

  // アイテムリスト構築
  var itemLabels = [];
  for (var p = 0; p < pickedItems.length; p++) {
    var pi = pickedItems[p];
    var label = pi.brand || pi.category || '商品';
    if (pi.size) label += ' / ' + pi.size;
    if (pi.price > 0) label += '  ' + wn_formatPrice_(pi.price);
    itemLabels.push(label);
  }

  // 送信
  var recipients = wn_filterAlreadySent_(getNewsletterRecipients_());
  var sent = 0;

  for (var c = 0; c < recipients.length; c++) {
    var recip = recipients[c];
    try {
      var subject = '【デタウリ】週末セレクト：' + title;
      // 件名が長すぎる場合はカット
      if (subject.length > 60) subject = subject.substring(0, 57) + '...';

      var body = recip.companyName + ' 様\n\n'
        + 'いつもデタウリ.Detauri をご利用いただきありがとうございます。\n'
        + '今週の週末セレクトをお届けします。\n\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '■ ' + title + '\n'
        + '━━━━━━━━━━━━━━━━━━━━\n';
      for (var il = 0; il < itemLabels.length; il++) {
        body += '  ・' + itemLabels[il] + '\n';
      }
      body += '\n'
        + '全 ' + products.length + '点の在庫からお選びいただけます。\n\n'
        + '▼ この特集を見る\n' + siteUrl + '\n\n'
        + '▼ 全商品を見る\n' + allUrl + '\n\n'
        + '※ このメールはメルマガ配信にご登録いただいた方にお送りしています。\n'
        + '※ 配信停止: ' + nl_buildUnsubscribeUrl_(recip.email) + '\n\n'
        + '──────────────────\n'
        + SITE_CONSTANTS.SITE_NAME + '\n'
        + SITE_CONSTANTS.SITE_URL + '\n'
        + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
        + '──────────────────\n';

      GmailApp.sendEmail(recip.email, subject, body, {
        from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
        htmlBody: buildHtmlEmail_({
          greeting: recip.companyName + ' 様',
          lead: '今週の週末セレクトをお届けします。',
          sections: [{
            title: title,
            items: itemLabels
          }, {
            text: '全 ' + products.length + '点の在庫からお選びいただけます。'
          }],
          cta: { text: 'この特集を見る', url: siteUrl },
          notes: [
            '会員様は確保時間が30分に延長されます。ログインしてからお買い物をお楽しみください。',
            'このメールはメルマガ配信にご登録いただいた方にお送りしています。'
          ],
          unsubscribe: nl_buildUnsubscribeUrl_(recip.email)
        })
      });
      wn_markSent_(recip.email);
      sent++;
    } catch (mailErr) {
      console.error('wn_sendWeekendPicks_ mail error: ' + recip.email, mailErr);
    }
  }

  console.log('wn_sendWeekendPicks_: 完了 パターン=' + pattern + ' ' + title + ', 送信=' + sent + '件');
}

// =====================================================
// テスト送信（管理者メールに3パターン全て送信）
// =====================================================

/**
 * GASエディタから手動実行: 3パターンのテストメールを管理者に送信
 * 実際のデータを使って本番と同じ内容を生成し、管理者メールに送る
 */
function testWeeklyNewsletter() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) {
    console.log('testWeeklyNewsletter: ADMIN_OWNER_EMAIL が未設定');
    return;
  }

  console.log('testWeeklyNewsletter: 管理者 ' + adminEmail + ' に3パターン送信開始');

  // テスト用に getNewsletterRecipients_ を上書き（管理者のみ）
  var origFunc = this.getNewsletterRecipients_;
  this.getNewsletterRecipients_ = function() {
    return [{ email: adminEmail, companyName: '【テスト】管理者' }];
  };

  // 重複防止キャッシュをクリア（テスト用）
  var cache = CacheService.getScriptCache();
  var todayKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  cache.remove('WN_SENT_' + todayKey + '_' + adminEmail);

  try {
    // 1. 火曜: 売れた速報
    console.log('--- テスト1: 売れた速報 ---');
    wn_sendSoldReport_();

    // キャッシュクリア（次のテストのため）
    cache.remove('WN_SENT_' + todayKey + '_' + adminEmail);

    // 2. 木曜: ブランドコラム
    console.log('--- テスト2: ブランドコラム ---');
    wn_sendBrandColumn_();

    cache.remove('WN_SENT_' + todayKey + '_' + adminEmail);

    // 3. 土曜: 週末ピックアップ
    console.log('--- テスト3: 週末ピックアップ ---');
    wn_sendWeekendPicks_();

    console.log('testWeeklyNewsletter: 3パターン送信完了 → ' + adminEmail);
  } catch (e) {
    console.error('testWeeklyNewsletter error:', e);
  } finally {
    // 元の関数に戻す
    this.getNewsletterRecipients_ = origFunc;
  }
}
