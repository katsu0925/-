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
  var channel = String(row[(REQUEST_SHEET_COLS.CHANNEL || 33) - 1] || 'デタウリ');

  var sentCount = 0;

  // 1. 顧客向け注文確認メール
  try {
    var testData = {
      receiptNo: receiptNo,
      form: {
        companyName: companyName,
        contact: adminEmail,
        postal: String(row[REQUEST_SHEET_COLS.POSTAL - 1] || ''),
        address: String(row[REQUEST_SHEET_COLS.ADDRESS - 1] || ''),
        phone: String(row[REQUEST_SHEET_COLS.PHONE - 1] || ''),
        note: ''
      },
      totalCount: Number(row[REQUEST_SHEET_COLS.TOTAL_COUNT - 1] || 1),
      discounted: totalAmount,
      shippingAmount: Number(row[REQUEST_SHEET_COLS.SHIP_COST_CUST - 1] || 0),
      createdAtMs: Date.now(),
      paymentMethod: 'credit_card',
      itemDetails: [],
      selectionList: String(row[REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '')
    };
    app_sendOrderConfirmToCustomer_(testData);
    sentCount++;
  } catch (e) {
    console.error('テスト: 顧客向けメール送信エラー:', e);
  }

  // 2. 管理者向け注文通知メール
  try {
    app_sendOrderNotifyMail_(orderSs, receiptNo, {
      companyName: companyName,
      contact: adminEmail,
      postal: String(row[REQUEST_SHEET_COLS.POSTAL - 1] || ''),
      address: String(row[REQUEST_SHEET_COLS.ADDRESS - 1] || ''),
      phone: String(row[REQUEST_SHEET_COLS.PHONE - 1] || ''),
      totalCount: Number(row[REQUEST_SHEET_COLS.TOTAL_COUNT - 1] || 1),
      discounted: totalAmount,
      createdAtMs: Date.now(),
      paymentMethod: paymentMethod,
      paymentStatus: '未対応'
    });
    sentCount++;
  } catch (e) {
    console.error('テスト: 管理者向けメール送信エラー:', e);
  }

  // 3. 入金リマインドメール（前日テスト）
  try {
    var testDeadline = new Date();
    testDeadline.setDate(testDeadline.getDate() + 1);
    sendPaymentReminderEmail_(adminEmail, companyName, receiptNo, totalAmount, paymentMethod, testDeadline, 'eve');
    sentCount++;
  } catch (e) {
    console.error('テスト: リマインドメール送信エラー:', e);
  }

  return {
    ok: true,
    message: sentCount + '通のテストメールを ' + adminEmail + ' に送信しました',
    sentTo: adminEmail,
    sentCount: sentCount
  };
}
