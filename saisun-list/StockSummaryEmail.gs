// StockSummaryEmail.gs
// =====================================================
// 月次在庫サマリーメール
// 毎月1日にメルマガ登録ユーザーへ在庫状況を配信
// =====================================================

var SS_BRAND_CATEGORIES = ['ハイブランド', 'デザイナーズブランド', 'セレクトブランド'];

/**
 * ブランド名をファジーマッチ用に正規化
 * @param {*} str
 * @returns {string}
 */
function ss_normalizeBrandKey_(str) {
  var s = String(str == null ? '' : str).trim();
  // 全角英数→半角
  s = s.replace(/[！-～]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  // 全角スペース→半角
  s = s.replace(/\u3000/g, ' ');
  s = s.toLowerCase();
  // 連続スペースを1つに
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * 「ブランド一覧」シートを読み込み、セレクトブランド以上のブランドを
 * 正規化キー→{name, category} のマップで返す
 * シート列: A=No., B=ブランド名（英語）, C=ブランド名（カナ）, D=カテゴリ, E=対象
 * @returns {Object} 正規化キー → {name: string, category: string}
 */
function ss_buildBrandLookup_() {
  var lookup = {};
  var ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  if (!ssId) return lookup;

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName('ブランド一覧');
  if (!sh) {
    console.log('ss_buildBrandLookup_: ブランド一覧シートが見つかりません');
    return lookup;
  }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return lookup;

  var data = sh.getRange(2, 1, lastRow - 1, 5).getValues(); // A〜E列

  for (var i = 0; i < data.length; i++) {
    var engName = String(data[i][1] || '').trim();   // B列: 英語名
    var kanaName = String(data[i][2] || '').trim();  // C列: カナ名
    var category = String(data[i][3] || '').trim();  // D列: カテゴリ

    // セレクトブランド以上のみ
    if (SS_BRAND_CATEGORIES.indexOf(category) === -1) continue;

    var entry = { name: engName || kanaName, category: category };

    // 英語名をキーとして登録
    if (engName) {
      lookup[ss_normalizeBrandKey_(engName)] = entry;
    }
    // カナ名も別キーとして同一エントリに登録
    if (kanaName) {
      lookup[ss_normalizeBrandKey_(kanaName)] = entry;
    }
  }

  return lookup;
}

/**
 * 在庫データを集計してサマリーオブジェクトを返す
 * @returns {Object} { totalCount, categories, otherCount }
 */
function ss_buildStockSummary_() {
  var ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  if (!ssId) return { totalCount: 0, categories: {}, otherCount: 0 };

  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(APP_CONFIG.data.sheetName || 'データ1');
  if (!sh) return { totalCount: 0, categories: {}, otherCount: 0 };

  var lastRow = sh.getLastRow();
  if (lastRow < 3) return { totalCount: 0, categories: {}, otherCount: 0 };

  var values = sh.getRange(3, 1, lastRow - 2, 25).getValues();
  var brandLookup = ss_buildBrandLookup_();

  var totalCount = 0;
  var otherCount = 0;
  // カテゴリ別 → ブランド別 → { count, prices[] }
  var catData = {};
  for (var c = 0; c < SS_BRAND_CATEGORIES.length; c++) {
    catData[SS_BRAND_CATEGORIES[c]] = {};
  }

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var managedId = String(row[DATA_COLUMNS.managedId] || '').trim();
    if (!managedId) continue;

    var status = String(row[DATA_COLUMNS.status] || '').trim();
    if (getStatusKind_(status) !== 'available') continue;

    totalCount++;

    var rawBrand = normalizeBrand_(row[DATA_COLUMNS.brand]);
    var brandKey = ss_normalizeBrandKey_(rawBrand);
    var entry = brandLookup[brandKey];

    if (!entry) {
      otherCount++;
      continue;
    }

    var cat = entry.category;
    var displayName = entry.name;
    var price = Number(row[DATA_COLUMNS.price] || 0);

    if (!catData[cat][displayName]) {
      catData[cat][displayName] = { count: 0, prices: [] };
    }
    catData[cat][displayName].count++;
    if (price > 0) {
      catData[cat][displayName].prices.push(price);
    }
  }

  // カテゴリ別にブランドリストを構築
  var categories = {};
  for (var c2 = 0; c2 < SS_BRAND_CATEGORIES.length; c2++) {
    var catName = SS_BRAND_CATEGORIES[c2];
    var brands = catData[catName];
    var brandList = [];

    for (var bName in brands) {
      var b = brands[bName];
      var priceRange = '';
      if (b.prices.length > 0) {
        var minP = Math.floor(Math.min.apply(null, b.prices) / 100) * 100;
        var maxP = Math.floor(Math.max.apply(null, b.prices) / 100) * 100;
        if (minP === maxP) {
          priceRange = minP + '円台';
        } else {
          priceRange = minP + '円台〜' + maxP + '円台';
        }
      }
      brandList.push({ brand: bName, count: b.count, priceRange: priceRange });
    }

    // 点数降順でソート
    brandList.sort(function(a, b) { return b.count - a.count; });
    categories[catName] = brandList;
  }

  var summary = {
    totalCount: totalCount,
    categories: categories,
    otherCount: otherCount
  };

  console.log('ss_buildStockSummary_: total=' + totalCount +
    ', ハイブランド=' + categories['ハイブランド'].length +
    ', デザイナーズ=' + categories['デザイナーズブランド'].length +
    ', セレクト=' + categories['セレクトブランド'].length +
    ', other=' + otherCount);

  return summary;
}

/**
 * サマリーからHTMLメール本文を構築
 * @param {Object} summary - ss_buildStockSummary_()の返却値
 * @param {string} companyName - 受信者の会社名
 * @param {string} email - 受信者のメールアドレス
 * @returns {Object} { html, text, subject }
 */
function ss_buildEmailBody_(summary, companyName, email) {
  var sections = [];

  // カテゴリごとのセクション（ハイブランド→デザイナーズ→セレクト順）
  for (var c = 0; c < SS_BRAND_CATEGORIES.length; c++) {
    var catName = SS_BRAND_CATEGORIES[c];
    var brandList = summary.categories[catName] || [];
    if (brandList.length === 0) continue;

    var items = [];
    for (var b = 0; b < brandList.length; b++) {
      var br = brandList[b];
      var line = br.brand + ': ' + br.count + '点';
      if (br.priceRange) line += '（' + br.priceRange + '）';
      items.push(line);
    }

    sections.push({ title: catName, items: items });
  }

  // その他（モールブランド以下）
  if (summary.otherCount > 0) {
    sections.push({
      title: 'その他（モールブランド以下）',
      text: summary.otherCount + '点（多数ブランド取り扱い中）'
    });
  }

  var unsubUrl = SITE_CONSTANTS.SITE_URL + '?action=unsubscribe&email=' + encodeURIComponent(email);

  var html = buildHtmlEmail_({
    greeting: companyName + ' 様',
    lead: '今月のデタウリ在庫サマリーをお届けします。\n現在の出品数: 全' + summary.totalCount + '点',
    sections: sections,
    cta: { text: '在庫を見る', url: SITE_CONSTANTS.SITE_URL },
    unsubscribe: unsubUrl
  });

  // テキスト版
  var textLines = [
    companyName + ' 様',
    '',
    '今月のデタウリ在庫サマリーをお届けします。',
    '現在の出品数: 全' + summary.totalCount + '点',
    ''
  ];

  for (var c2 = 0; c2 < SS_BRAND_CATEGORIES.length; c2++) {
    var cn = SS_BRAND_CATEGORIES[c2];
    var bl = summary.categories[cn] || [];
    if (bl.length === 0) continue;
    textLines.push('■ ' + cn);
    for (var b2 = 0; b2 < bl.length; b2++) {
      var br2 = bl[b2];
      var tl = '  ' + br2.brand + ': ' + br2.count + '点';
      if (br2.priceRange) tl += '（' + br2.priceRange + '）';
      textLines.push(tl);
    }
    textLines.push('');
  }

  if (summary.otherCount > 0) {
    textLines.push('■ その他（モールブランド以下）');
    textLines.push('  ' + summary.otherCount + '点（多数ブランド取り扱い中）');
    textLines.push('');
  }

  textLines.push('▼ 在庫を見る');
  textLines.push(SITE_CONSTANTS.SITE_URL);
  textLines.push('');
  textLines.push('──────────────────');
  textLines.push(SITE_CONSTANTS.SITE_NAME);
  textLines.push(SITE_CONSTANTS.SITE_URL);
  textLines.push('お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL);
  textLines.push('──────────────────');
  textLines.push('');
  textLines.push('※ メルマガ配信停止: ' + unsubUrl);

  return {
    html: html,
    text: textLines.join('\n'),
    subject: '【デタウリ.Detauri】今月の在庫サマリー'
  };
}

/**
 * 月次在庫サマリーメール送信（cronDaily8から呼び出し）
 * 毎月1日のみ実行
 */
function sendMonthlyStockSummary() {
  if (new Date().getDate() !== 1) return;

  console.log('sendMonthlyStockSummary: 開始');
  var summary = ss_buildStockSummary_();
  var recipients = getNewsletterRecipients_();

  if (recipients.length === 0) {
    console.log('sendMonthlyStockSummary: 配信対象者なし');
    return;
  }

  var sent = 0;
  for (var i = 0; i < recipients.length; i++) {
    var recip = recipients[i];
    try {
      var email = ss_buildEmailBody_(summary, recip.companyName, recip.email);
      MailApp.sendEmail({
        to: recip.email,
        subject: email.subject,
        body: email.text,
        htmlBody: email.html,
        noReply: true
      });
      sent++;
    } catch (e) {
      console.error('sendMonthlyStockSummary mail error: ' + recip.email, e);
    }
  }

  console.log('sendMonthlyStockSummary: 完了 送信=' + sent + '/' + recipients.length + '件');
}

/**
 * テスト関数: 管理者のみに在庫サマリーメールを送信
 * GASエディタから手動実行（日付チェックなし）
 */
function testStockSummaryEmail() {
  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) {
    console.error('testStockSummaryEmail: ADMIN_OWNER_EMAIL が未設定です');
    return;
  }

  console.log('testStockSummaryEmail: 集計開始');
  var summary = ss_buildStockSummary_();

  console.log('--- 集計結果 ---');
  console.log('総出品数: ' + summary.totalCount);
  for (var c = 0; c < SS_BRAND_CATEGORIES.length; c++) {
    var catName = SS_BRAND_CATEGORIES[c];
    var brands = summary.categories[catName] || [];
    console.log(catName + ': ' + brands.length + 'ブランド');
    for (var b = 0; b < brands.length; b++) {
      console.log('  ' + brands[b].brand + ': ' + brands[b].count + '点 ' + brands[b].priceRange);
    }
  }
  console.log('モールブランド以下: ' + summary.otherCount + '点');

  var email = ss_buildEmailBody_(summary, '管理者テスト', adminEmail);

  MailApp.sendEmail({
    to: adminEmail,
    subject: '【テスト】' + email.subject,
    body: '（管理者テスト送信）\n\n' + email.text,
    htmlBody: email.html,
    noReply: true
  });

  console.log('testStockSummaryEmail: 送信完了 → ' + adminEmail);
}
