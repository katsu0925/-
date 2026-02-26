// LineNotify.gs
// =====================================================
// LINE公式アカウント連携 (Phase 4-2)
// LINE Messaging API を使った顧客向け通知
// =====================================================

/**
 * LINE Messaging API でプッシュメッセージを送信
 * @param {string} lineUserId - LINE UserID
 * @param {Array} messages - メッセージオブジェクト配列
 */
function linePushMessage_(lineUserId, messages) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !lineUserId) return;
  try {
    var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: lineUserId, messages: messages }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('LINE push error: HTTP ' + code + ' ' + resp.getContentText());
    }
  } catch (e) {
    console.error('linePushMessage_ error:', e);
  }
}

/**
 * 顧客のLINE UserIDを取得
 * @param {string} email
 * @return {string|null}
 */
function getLineUserId_(email) {
  var customer = findCustomerByEmail_(email);
  if (!customer) return null;
  var sheet = getCustomerSheet_();
  var lineUserId = String(sheet.getRange(customer.row, CUSTOMER_SHEET_COLS.LINE_USER_ID + 1).getValue() || '').trim();
  return lineUserId || null;
}

/**
 * LINE連携API
 * @param {string} userKey
 * @param {object} params - { sessionId, lineUserId }
 * @return {object}
 */
function apiLineLinkAccount(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '').trim();
    var lineUserId = String(params.lineUserId || '').trim();

    if (!sessionId) return { ok: false, message: 'ログインが必要です' };
    if (!lineUserId) return { ok: false, message: 'LINE UserIDが不正です' };

    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効です。再ログインしてください' };

    var fullCustomer = findCustomerByEmail_(customer.email);
    if (!fullCustomer) return { ok: false, message: '顧客情報が見つかりません' };

    getCustomerSheet_().getRange(fullCustomer.row, CUSTOMER_SHEET_COLS.LINE_USER_ID + 1).setValue(lineUserId);
    console.log('LINE連携完了: email=' + customer.email);

    return { ok: true, message: 'LINEアカウントを連携しました' };
  } catch (e) {
    console.error('apiLineLinkAccount error:', e);
    return { ok: false, message: 'LINE連携に失敗しました' };
  }
}

/**
 * 注文確定時のLINE通知
 * @param {string} email
 * @param {object} orderInfo - { receiptNo, companyName, totalCount, totalAmount, paymentMethod }
 */
function lineNotifyOrder_(email, orderInfo) {
  try {
    var lineUserId = getLineUserId_(email);
    if (!lineUserId) return;

    var text = 'ご注文ありがとうございます\n\n'
      + '受付番号: ' + String(orderInfo.receiptNo || '') + '\n'
      + '合計点数: ' + String(orderInfo.totalCount || 0) + '点\n'
      + '合計金額: ' + Number(orderInfo.totalAmount || 0).toLocaleString() + '円\n\n'
      + '商品の発送準備を進めてまいります。';

    linePushMessage_(lineUserId, [{ type: 'text', text: text }]);
  } catch (e) {
    console.error('lineNotifyOrder_ error:', e);
  }
}

/**
 * 発送通知のLINE送信
 * @param {string} email
 * @param {object} trackingInfo - { receiptNo, carrier, trackingNumber }
 */
function lineNotifyShipping_(email, trackingInfo) {
  try {
    var lineUserId = getLineUserId_(email);
    if (!lineUserId) return;

    var text = '商品を発送しました\n\n'
      + '受付番号: ' + String(trackingInfo.receiptNo || '') + '\n';

    if (trackingInfo.carrier) text += '配送業者: ' + trackingInfo.carrier + '\n';
    if (trackingInfo.trackingNumber) text += '伝票番号: ' + trackingInfo.trackingNumber + '\n';

    text += '\nお届けまでしばらくお待ちください。';

    linePushMessage_(lineUserId, [{ type: 'text', text: text }]);
  } catch (e) {
    console.error('lineNotifyShipping_ error:', e);
  }
}
