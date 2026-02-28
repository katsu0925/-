// PaymentReminder.gs
// =====================================================
// 後払い入金リマインダーメール（コンビニ・銀行振込・ペイジー）
// 入金期限の前日と当日に、未入金のお客様へリマインドメールを送信
// =====================================================

var PAYMENT_DEADLINE_DAYS = 3; // 注文日から3日以内

/**
 * 入金リマインダーを送信（毎日9時にトリガー実行）
 * 依頼管理シートで「入金待ち」ステータスの注文を検索し、
 * 期限前日・当日にリマインドメールを送信する。
 */
function sendPaymentReminders() {
  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  if (!reqSh) return;

  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) return;

  var data = reqSh.getRange(2, 1, lastRow - 1, REQUEST_SHEET_COLS.CHANNEL || 33).getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var cache = CacheService.getScriptCache();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var paymentStatus = String(row[REQUEST_SHEET_COLS.PAYMENT - 1] || '').trim();

    // 入金待ちの注文のみ対象
    if (paymentStatus !== '入金待ち') continue;

    var receiptNo = String(row[REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '').trim();
    var orderDate = row[REQUEST_SHEET_COLS.DATETIME - 1];
    var email = String(row[REQUEST_SHEET_COLS.CONTACT - 1] || '').trim();
    var companyName = String(row[REQUEST_SHEET_COLS.COMPANY_NAME - 1] || '').trim();
    var totalAmount = Number(row[REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1] || 0);
    var paymentMethod = String(row[REQUEST_SHEET_COLS.PAYMENT_METHOD - 1] || '').trim();

    if (!email || email.indexOf('@') === -1 || !receiptNo) continue;

    // 注文日時からDateオブジェクトを作成
    var orderDateObj = orderDate instanceof Date ? orderDate : new Date(orderDate);
    if (isNaN(orderDateObj.getTime())) continue;

    // 期限日を計算（注文日 + 3日）
    var deadline = new Date(orderDateObj);
    deadline.setDate(deadline.getDate() + PAYMENT_DEADLINE_DAYS);
    deadline.setHours(0, 0, 0, 0);

    // 期限前日
    var dayBefore = new Date(deadline);
    dayBefore.setDate(dayBefore.getDate() - 1);

    // 今日が期限前日かチェック
    var todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
    var dayBeforeStr = Utilities.formatDate(dayBefore, 'Asia/Tokyo', 'yyyy-MM-dd');
    var deadlineStr = Utilities.formatDate(deadline, 'Asia/Tokyo', 'yyyy-MM-dd');

    var cacheKeyPre = 'pay_remind_pre_' + receiptNo;
    var cacheKeyDay = 'pay_remind_day_' + receiptNo;

    if (todayStr === dayBeforeStr && !cache.get(cacheKeyPre)) {
      // 期限前日リマインド
      sendPaymentReminderEmail_(email, companyName, receiptNo, totalAmount, paymentMethod, deadline, 'eve');
      cache.put(cacheKeyPre, '1', 86400); // 24時間キャッシュ
      console.log('入金リマインド（前日）送信: ' + receiptNo + ' → ' + email);
    }

    if (todayStr === deadlineStr && !cache.get(cacheKeyDay)) {
      // 期限当日リマインド
      sendPaymentReminderEmail_(email, companyName, receiptNo, totalAmount, paymentMethod, deadline, 'day');
      cache.put(cacheKeyDay, '1', 86400);
      console.log('入金リマインド（当日）送信: ' + receiptNo + ' → ' + email);
    }
  }
}

/**
 * リマインドメールを送信
 * @param {string} email - 送信先
 * @param {string} companyName - 会社名/氏名
 * @param {string} receiptNo - 受付番号
 * @param {number} totalAmount - 合計金額
 * @param {string} paymentMethod - 決済方法
 * @param {Date} deadline - 期限日
 * @param {string} type - 'eve'（前日）or 'day'（当日）
 */
function sendPaymentReminderEmail_(email, companyName, receiptNo, totalAmount, paymentMethod, deadline, type) {
  var deadlineStr = Utilities.formatDate(deadline, 'Asia/Tokyo', 'yyyy年MM月dd日');
  var isEve = type === 'eve';

  var subject = isEve
    ? '【デタウリ.Detauri】お支払い期限が明日です（受付番号：' + receiptNo + '）'
    : '【デタウリ.Detauri】本日がお支払い期限です（受付番号：' + receiptNo + '）';

  var urgency = isEve
    ? 'お支払い期限が明日（' + deadlineStr + '）となっております。'
    : '本日（' + deadlineStr + '）がお支払い期限です。';

  var body = companyName + ' 様\n\n'
    + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
    + '下記のご注文について、まだお支払いが確認できておりません。\n'
    + urgency + '\n\n'
    + '━━━━━━━━━━━━━━━━━━━━\n'
    + '受付番号：' + receiptNo + '\n'
    + '合計金額：' + Number(totalAmount).toLocaleString() + '円（税込・送料込）\n'
    + '決済方法：' + paymentMethod + '\n'
    + 'お支払い期限：' + deadlineStr + '\n'
    + '━━━━━━━━━━━━━━━━━━━━\n\n'
    + '期限を過ぎますと、ご注文は自動的にキャンセルとなり、\n'
    + '確保中の商品は解放されますのでご注意ください。\n\n'
    + 'お支払い済みの場合は、反映までにお時間がかかる場合がございます。\n'
    + 'このメールは行き違いでお届けしている可能性がございますので、何卒ご了承ください。\n\n'
    + '※ このメールは自動送信です。\n\n'
    + '──────────────────\n'
    + 'デタウリ.Detauri\n'
    + 'https://wholesale.nkonline-tool.com/\n'
    + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────\n';

  var reminderHtmlBody = buildHtmlEmail_({
    greeting: companyName + ' 様',
    lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n下記のご注文について、まだお支払いが確認できておりません。\n' + urgency,
    sections: [
      {
        title: 'ご注文情報',
        rows: [
          { label: '受付番号', value: receiptNo },
          { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円（税込・送料込）' },
          { label: '決済方法', value: paymentMethod },
          { label: 'お支払い期限', value: deadlineStr }
        ]
      },
      {
        title: '',
        text: '期限を過ぎますと、ご注文は自動的にキャンセルとなり、\n確保中の商品は解放されますのでご注意ください。\n\nお支払い済みの場合は、反映までにお時間がかかる場合がございます。\nこのメールは行き違いでお届けしている可能性がございますので、何卒ご了承ください。'
      }
    ],
    notes: [
      'このメールは自動送信です。'
    ]
  });

  MailApp.sendEmail({ to: email, subject: subject, body: body, htmlBody: reminderHtmlBody, noReply: true });
}

// =====================================================
// メール一括テスト（管理者向け）
// 顧客向けメールと管理者向けメールを管理者アドレスに一括送信
// =====================================================

/**
 * テストメールを管理者に一括送信
 * 直近の注文データを使って、顧客向け・管理者向け・リマインドメールのプレビューを送信
 */
function adminTestEmails() {
  var orderSs = sh_getOrderSs_();
  var adminEmails = app_getNotifyToEmails_(orderSs);
  if (!adminEmails.length) {
    return { ok: false, message: '管理者メールアドレスが取得できません' };
  }
  var adminEmail = adminEmails[0];

  // 直近の注文データを取得
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  if (!reqSh || reqSh.getLastRow() < 2) {
    return { ok: false, message: '注文データがありません' };
  }

  var lastRow = reqSh.getLastRow();
  var row = reqSh.getRange(lastRow, 1, 1, REQUEST_SHEET_COLS.CHANNEL || 33).getValues()[0];

  var receiptNo = String(row[REQUEST_SHEET_COLS.RECEIPT_NO - 1] || 'TEST-001');
  var companyName = String(row[REQUEST_SHEET_COLS.COMPANY_NAME - 1] || 'テスト太郎');
  var totalAmount = Number(row[REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1] || 5000);
  var paymentMethod = String(row[REQUEST_SHEET_COLS.PAYMENT_METHOD - 1] || 'コンビニ払い');
  var postal = String(row[REQUEST_SHEET_COLS.POSTAL - 1] || '600-8846');
  var address = String(row[REQUEST_SHEET_COLS.ADDRESS - 1] || '京都府京都市下京区朱雀宝蔵町44');
  var phone = String(row[REQUEST_SHEET_COLS.PHONE - 1] || '090-0000-0000');
  var totalCount = Number(row[REQUEST_SHEET_COLS.TOTAL_COUNT - 1] || 3);
  var selectionList = String(row[REQUEST_SHEET_COLS.SELECTION_LIST - 1] || 'サンプル商品A × 1\nサンプル商品B × 2');

  var sentCount = 0;
  var errors = [];

  // === 1. 顧客向け注文確認メール（クレカ即時決済） ===
  try {
    app_sendOrderConfirmToCustomer_({
      receiptNo: receiptNo,
      form: { companyName: companyName, contact: adminEmail, postal: postal, address: address, phone: phone, note: '' },
      totalCount: totalCount, discounted: totalAmount,
      shippingAmount: Number(row[REQUEST_SHEET_COLS.SHIP_COST_CUST - 1] || 0),
      createdAtMs: Date.now(), paymentMethod: 'credit_card',
      itemDetails: [], selectionList: selectionList
    });
    sentCount++;
  } catch (e) { errors.push('1.注文確認(クレカ): ' + e.message); }

  // === 2. 顧客向け注文確認メール（後払い） ===
  try {
    app_sendOrderConfirmToCustomer_({
      receiptNo: receiptNo + '-D',
      form: { companyName: companyName, contact: adminEmail, postal: postal, address: address, phone: phone, note: 'テスト備考' },
      totalCount: totalCount, discounted: totalAmount,
      shippingAmount: 0, createdAtMs: Date.now(),
      paymentMethod: 'konbini', itemDetails: [], selectionList: selectionList
    });
    sentCount++;
  } catch (e) { errors.push('2.注文確認(後払い): ' + e.message); }

  // === 3. 管理者向け注文通知メール ===
  try {
    app_sendOrderNotifyMail_(orderSs, receiptNo, {
      companyName: companyName, contact: adminEmail, postal: postal, address: address, phone: phone,
      totalCount: totalCount, discounted: totalAmount,
      createdAtMs: Date.now(), paymentMethod: paymentMethod, paymentStatus: '未対応'
    });
    sentCount++;
  } catch (e) { errors.push('3.管理者注文通知: ' + e.message); }

  // === 4. 入金リマインド（前日） ===
  try {
    var deadlineEve = new Date();
    deadlineEve.setDate(deadlineEve.getDate() + 1);
    sendPaymentReminderEmail_(adminEmail, companyName, receiptNo, totalAmount, paymentMethod, deadlineEve, 'eve');
    sentCount++;
  } catch (e) { errors.push('4.入金リマインド(前日): ' + e.message); }

  // === 5. 入金リマインド（当日） ===
  try {
    sendPaymentReminderEmail_(adminEmail, companyName, receiptNo, totalAmount, paymentMethod, new Date(), 'day');
    sentCount++;
  } catch (e) { errors.push('5.入金リマインド(当日): ' + e.message); }

  // === 6. 発送通知（顧客向け） ===
  try {
    var shipCustSubject = '【デタウリ.Detauri】商品を発送しました（受付番号：' + receiptNo + '）';
    var shipCustBody = companyName + ' 様\n\nデタウリ.Detauri をご利用いただきありがとうございます。\n下記の内容で商品を発送いたしました。\n\n受付番号：' + receiptNo + '\n合計点数：' + totalCount + '点\n合計金額：' + Number(totalAmount).toLocaleString() + '円（税込）\n配送業者：ヤマト運輸\n伝票番号：1234-5678-9012\n';
    var shipRows = [
      { label: '受付番号', value: receiptNo },
      { label: '合計点数', value: totalCount + '点' },
      { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円（税込）' },
      { label: '配送業者', value: 'ヤマト運輸' },
      { label: '伝票番号', value: '1234-5678-9012' }
    ];
    var shipSections = [{ title: '発送内容', rows: shipRows }];
    if (selectionList) shipSections.push({ title: '選択商品', text: selectionList });
    shipSections.push({ title: 'ご注文明細（Google Drive）', text: '以下のリンクからご注文内容をご確認いただけます。' });
    MailApp.sendEmail({
      to: adminEmail, subject: shipCustSubject, body: shipCustBody, noReply: true,
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n下記の内容で商品を発送いたしました。',
        sections: shipSections,
        cta: { text: 'ご注文明細を確認', url: SITE_CONSTANTS.SITE_URL },
        notes: ['商品到着まで今しばらくお待ちください。', '到着後、内容にご不明点がございましたらお気軽にお問い合わせください。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('6.発送通知(顧客): ' + e.message); }

  // === 7. 発送通知（管理者向け） ===
  try {
    var shipAdminSubject = '発送通知: 受付番号 ' + receiptNo;
    MailApp.sendEmail({
      to: adminEmail, subject: shipAdminSubject,
      body: '受付番号「' + receiptNo + '」が発送されました。\n\nお客様名：' + companyName + '\n',
      htmlBody: buildHtmlEmail_({
        lead: '受付番号「' + receiptNo + '」が発送されました。',
        sections: [{ title: '発送情報', rows: [{ label: 'お客様名', value: companyName }] }]
      })
    });
    sentCount++;
  } catch (e) { errors.push('7.発送通知(管理者): ' + e.message); }

  // === 8. パスワードリセット ===
  try {
    var tempPw = 'TeSt1234AbCd';
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】パスワードリセットのお知らせ',
      body: companyName + ' 様\n\nパスワードリセットのリクエストを受け付けました。\n仮パスワード: ' + tempPw + '\n有効期限: 30分\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'パスワードリセットのリクエストを受け付けました。\n以下の仮パスワードでログインしてください。',
        sections: [{ title: '仮パスワード情報', rows: [{ label: '仮パスワード', value: tempPw }, { label: '有効期限', value: '30分' }] }],
        cta: { text: 'ログインはこちら', url: SITE_CONSTANTS.SITE_URL },
        notes: ['有効期限を過ぎると仮パスワードは無効になります。\nログイン後、マイページからパスワードの変更をお勧めします。', 'このメールに心当たりがない場合は、無視してください。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('8.パスワードリセット: ' + e.message); }

  // === 9. 領収書（インボイス） ===
  try {
    sendInvoiceReceipt_(adminEmail, {
      companyName: companyName, receiptNo: receiptNo,
      orderDate: '2026年2月20日', totalAmount: totalAmount,
      invoiceNo: 'T1234567890123', note: ''
    });
    sentCount++;
  } catch (e) { errors.push('9.領収書: ' + e.message); }

  // === 10. 取消領収書 ===
  try {
    sendCancelReceipt_(adminEmail, {
      companyName: companyName, receiptNo: receiptNo,
      orderDate: '2026年2月20日', totalAmount: totalAmount,
      invoiceNo: 'T1234567890123', cancelType: 'キャンセル'
    });
    sentCount++;
  } catch (e) { errors.push('10.取消領収書: ' + e.message); }

  // === 11. お問い合わせ（管理者向け） ===
  try {
    var datetime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    MailApp.sendEmail({
      to: adminEmail, replyTo: adminEmail,
      subject: '【デタウリ.Detauri】お問い合わせ: ' + companyName,
      body: 'お問い合わせを受信しました。\n\nお名前: ' + companyName + '\nメールアドレス: ' + adminEmail + '\n日時: ' + datetime + '\n\n--- お問い合わせ内容 ---\nこれはテスト用のお問い合わせ内容です。\n',
      htmlBody: buildHtmlEmail_({
        lead: 'お問い合わせを受信しました。',
        sections: [
          { title: 'お問い合わせ情報', rows: [{ label: 'お名前', value: companyName }, { label: 'メールアドレス', value: adminEmail }, { label: '日時', value: datetime }] },
          { title: 'お問い合わせ内容', text: 'これはテスト用のお問い合わせ内容です。' }
        ]
      })
    });
    sentCount++;
  } catch (e) { errors.push('11.お問い合わせ(管理者): ' + e.message); }

  // === 12. お問い合わせ（顧客向け自動返信） ===
  try {
    var datetime2 = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】お問い合わせを受け付けました',
      body: companyName + ' 様\n\nお問い合わせいただきありがとうございます。\n以下の内容で受け付けました。2営業日以内にご連絡いたします。\n\nお名前：' + companyName + '\nメールアドレス：' + adminEmail + '\n日時：' + datetime2 + '\n\nこれはテスト用のお問い合わせ内容です。\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'お問い合わせいただきありがとうございます。\n以下の内容で受け付けました。2営業日以内にご連絡いたします。',
        sections: [
          { title: 'お問い合わせ内容', rows: [{ label: 'お名前', value: companyName }, { label: 'メールアドレス', value: adminEmail }, { label: '日時', value: datetime2 }] },
          { title: '', text: 'これはテスト用のお問い合わせ内容です。' }
        ],
        notes: ['このメールは自動送信です。', 'このメールへの返信はお控えください。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('12.お問い合わせ(顧客): ' + e.message); }

  // === 13. フォローアップメール ===
  try {
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】ご利用ありがとうございました（受付番号：' + receiptNo + '）',
      body: companyName + ' 様\n\n先日はデタウリ.Detauri をご利用いただき、誠にありがとうございました。\n商品はお手元に届きましたでしょうか？\n\n受付番号：' + receiptNo + '\n合計金額：' + Number(totalAmount).toLocaleString() + '円\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: '先日はデタウリ.Detauri をご利用いただき、誠にありがとうございました。\n商品はお手元に届きましたでしょうか？',
        sections: [
          { title: 'ご注文内容', rows: [{ label: '受付番号', value: receiptNo }, { label: '商品', value: selectionList }, { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円' }] },
          { title: '商品はいかがでしたか？', text: '商品の品質やお取引について、ご意見・ご感想を\nお聞かせいただけると大変嬉しく思います。' },
          { title: '次回のお買い物もお待ちしております', items: ['10点以上で5%OFF〜最大20%OFF', '会員様はポイントが貯まります（ランクに応じて1〜5%）'] }
        ],
        cta: { text: '新着商品をチェック', url: SITE_CONSTANTS.SITE_URL },
        notes: ['このメールは自動送信です。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('13.フォローアップ: ' + e.message); }

  // === 14. ポイント失効リマインド ===
  try {
    sendPointExpiryReminderEmail_(adminEmail, companyName, 1500, '2026年3月31日');
    sentCount++;
  } catch (e) { errors.push('14.ポイント失効リマインド: ' + e.message); }

  // === 15. ポイント失効通知 ===
  try {
    sendPointExpiredEmail_(adminEmail, companyName, 1500);
    sentCount++;
  } catch (e) { errors.push('15.ポイント失効通知: ' + e.message); }

  // === 16. 紹介ポイント付与通知 ===
  try {
    sendReferralNotifyEmail_(adminEmail, companyName, 'test@example.com', REFERRAL_POINTS_REFERRER);
    sentCount++;
  } catch (e) { errors.push('16.紹介ポイント: ' + e.message); }

  // === 17. 新着商品通知 ===
  try {
    var sampleItems = ['CHANEL サンプルバッグ', 'LOUIS VUITTON テスト財布', 'GUCCI テストスカーフ', 'PRADA テストポーチ', 'HERMES テストベルト'];
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】新着商品 5点が入荷しました',
      body: companyName + ' 様\n\nデタウリ.Detauri に新しい商品が入荷しました！\n\n  ・' + sampleItems.join('\n  ・') + '\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri に新しい商品が入荷しました！',
        sections: [{ title: '新着商品 5点', items: sampleItems }],
        cta: { text: '新着商品をチェック', url: SITE_CONSTANTS.SITE_URL },
        notes: ['人気商品は早い者勝ちです。\n会員様は確保時間が30分に延長されますので、ログインしてからお買い物をお楽しみください。', 'このメールはメルマガ配信にご登録いただいた方にお送りしています。'],
        unsubscribe: nl_buildUnsubscribeUrl_('test')
      })
    });
    sentCount++;
  } catch (e) { errors.push('17.新着商品通知: ' + e.message); }

  // === 18. ニュースレター ===
  try {
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】春の新作入荷フェア開催中！',
      body: companyName + ' 様\n\n春の新作入荷フェアを開催中です！\n期間限定で人気ブランドの新作が続々入荷しています。\n\nぜひこの機会にチェックしてください。\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: '春の新作入荷フェアを開催中です！\n期間限定で人気ブランドの新作が続々入荷しています。\n\nぜひこの機会にチェックしてください。',
        unsubscribe: nl_buildUnsubscribeUrl_('test')
      })
    });
    sentCount++;
  } catch (e) { errors.push('18.ニュースレター: ' + e.message); }

  // === 19. カゴ落ち（デタウリ） ===
  try {
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】カートに商品が残っています',
      body: companyName + ' 様\n\nカートに入れていた商品の確保期限が終了しました。\n人気商品は在庫が限られておりますので、お早めにご注文ください。\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\nカートに入れていた商品の確保期限が終了しました。\n人気商品は在庫が限られておりますので、お早めにご注文ください。',
        cta: { text: '商品を再度確認する', url: SITE_CONSTANTS.SITE_URL },
        notes: ['会員様は確保時間が30分に延長されます。ログインしてからカートに追加することをおすすめします。', 'このメールは自動送信です。', '商品の在庫状況は変動する場合があります。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('19.カゴ落ち(デタウリ): ' + e.message); }

  // === 20. カゴ落ち（アソート） ===
  try {
    var bulkPageUrl = SITE_CONSTANTS.SITE_URL + (SITE_CONSTANTS.SITE_URL.indexOf('?') === -1 ? '?page=bulk' : '&page=bulk');
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】アソートカートに商品が残っています',
      body: companyName + ' 様\n\nアソートカートに商品が残っています。\n人気商品は在庫が限られておりますので、お早めにご注文ください。\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\nアソートカートに商品が残っています。\n人気商品は在庫が限られておりますので、お早めにご注文ください。',
        cta: { text: 'アソート商品を確認する', url: bulkPageUrl },
        notes: ['このメールは自動送信です。', '商品の在庫状況は変動する場合があります。']
      })
    });
    sentCount++;
  } catch (e) { errors.push('20.カゴ落ち(アソート): ' + e.message); }

  // === 21. 休眠顧客クーポン ===
  try {
    MailApp.sendEmail({
      to: adminEmail, noReply: true,
      subject: '【デタウリ.Detauri】' + companyName + '様へ 10%OFFクーポンをお届けします',
      body: companyName + ' 様\n\nご無沙汰しております。\n感謝の気持ちを込めて10%OFFクーポンをお届けします。\n\nクーポンコード: COMEBACK2M\n割引: 全品10%OFF\n',
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'ご無沙汰しております。\n最近サイトにお越しいただけていないようですので、\n感謝の気持ちを込めて10%OFFクーポンをお届けします。',
        sections: [{
          title: 'クーポン情報',
          rows: [
            { label: 'クーポンコード', value: 'COMEBACK2M' },
            { label: '割引', value: '全品10%OFF' }
          ],
          text: '注文時にクーポンコードを入力してください。'
        }],
        cta: { text: 'お買い物はこちら', url: SITE_CONSTANTS.SITE_URL },
        notes: ['お1人様1回限りのクーポンです。', '他のクーポンとの併用はできません。'],
        unsubscribe: nl_buildUnsubscribeUrl_('test')
      })
    });
    sentCount++;
  } catch (e) { errors.push('21.休眠クーポン: ' + e.message); }

  var result = {
    ok: true,
    message: sentCount + '通のテストメールを ' + adminEmail + ' に送信しました',
    sentTo: adminEmail,
    sentCount: sentCount,
    totalTypes: 21
  };
  if (errors.length) {
    result.errors = errors;
    result.message += '（エラー: ' + errors.length + '件）';
  }
  return result;
}
