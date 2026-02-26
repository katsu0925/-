// FollowupEmail.gs
// =====================================================
// 購入後フォローアップメール (Phase 3-5)
// 購入後のサンクス・レビュー依頼メール
// =====================================================

/**
 * フォローアップメール 定期実行（毎日11時）
 * 「完了」ステータスの注文で、注文日から7日後にフォローアップメール送信
 */
function followupEmailCron_() {
  try {
    console.log('followupEmailCron_: 開始');

    var ss = sh_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    if (!reqSheet) {
      console.log('followupEmailCron_: 依頼管理シートが見つかりません');
      return;
    }

    var cache = CacheService.getScriptCache();
    var data = reqSheet.getDataRange().getValues();
    var now = new Date();
    var sent = 0;

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
      if (status !== '完了') continue;

      var receiptNo = String(data[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '');
      if (!receiptNo) continue;

      // 送信済みチェック（CacheService + ScriptProperties併用）
      if (isFollowupSent_(receiptNo)) continue;

      // 注文日から7日経過しているかチェック
      var orderDate = data[i][REQUEST_SHEET_COLS.DATETIME - 1];
      if (!orderDate) continue;

      var orderD = new Date(orderDate);
      var daysSince = Math.floor((now.getTime() - orderD.getTime()) / (24 * 60 * 60 * 1000));
      if (daysSince < 7 || daysSince > 30) continue; // 7日〜30日の間のみ送信

      // 連絡先メールが会員かチェック
      var email = String(data[i][REQUEST_SHEET_COLS.CONTACT - 1] || '').trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) continue;

      var customer = findCustomerByEmail_(email);
      if (!customer) continue; // 会員のみ

      var companyName = String(data[i][REQUEST_SHEET_COLS.COMPANY_NAME - 1] || customer.companyName || '');
      var productNames = String(data[i][REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || '');
      var totalAmount = Number(data[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;

      try {
        var subject = '【デタウリ.Detauri】ご利用ありがとうございました（受付番号：' + receiptNo + '）';
        var body = companyName + ' 様\n\n'
          + '先日はデタウリ.Detauri をご利用いただき、誠にありがとうございました。\n'
          + '商品はお手元に届きましたでしょうか？\n\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '■ ご注文内容\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '受付番号：' + receiptNo + '\n'
          + '商品：' + productNames + '\n'
          + '合計金額：' + Number(totalAmount).toLocaleString() + '円\n'
          + '━━━━━━━━━━━━━━━━━━━━\n\n'
          + '■ 商品はいかがでしたか？\n\n'
          + '商品の品質やお取引について、ご意見・ご感想を\n'
          + 'お聞かせいただけると大変嬉しく思います。\n'
          + 'いただいたフィードバックは、今後のサービス向上に活かしてまいります。\n\n'
          + '▼ ご意見・ご感想はこちら\n'
          + SITE_CONSTANTS.SITE_URL + '\n\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '■ 次回のお買い物もお待ちしております\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '・毎日新しい商品が入荷しています\n'
          + '・10点以上で5%OFF〜最大20%OFF\n'
          + '・会員様はポイントが貯まります（ランクに応じて1〜5%）\n\n'
          + '▼ 新着商品をチェック\n'
          + SITE_CONSTANTS.SITE_URL + '\n\n'
          + '※ このメールは自動送信です。\n\n'
          + '──────────────────\n'
          + SITE_CONSTANTS.SITE_NAME + '\n'
          + SITE_CONSTANTS.SITE_URL + '\n'
          + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
          + '──────────────────\n';

        MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });

        // 送信済みフラグ（30日、CacheService最大は21600秒=6時間なのでScriptPropertiesも併用）
        var sentKey = 'FOLLOWUP_SENT:' + receiptNo;
        cache.put(sentKey, '1', 21600);
        // ScriptPropertiesにも保存（長期保持用）
        try {
          PropertiesService.getScriptProperties().setProperty(sentKey, String(Date.now()));
        } catch (propErr) {
          console.log('optional: followup prop save: ' + (propErr.message || propErr));
        }

        sent++;
        console.log('followupEmailCron_: メール送信 ' + email + ' (' + receiptNo + ')');
      } catch (mailErr) {
        console.error('followupEmailCron_ mail error: ' + email, mailErr);
      }
    }

    console.log('followupEmailCron_: 完了 送信=' + sent + '件');
  } catch (e) {
    console.error('followupEmailCron_ error:', e);
  }
}

/**
 * フォローアップ送信済みチェック（CacheService + ScriptProperties）
 * @param {string} receiptNo
 * @return {boolean}
 */
function isFollowupSent_(receiptNo) {
  var key = 'FOLLOWUP_SENT:' + receiptNo;
  if (CacheService.getScriptCache().get(key)) return true;
  try {
    var val = PropertiesService.getScriptProperties().getProperty(key);
    if (val) {
      // 30日以内なら送信済み
      var ts = Number(val);
      if (Date.now() - ts < 30 * 24 * 60 * 60 * 1000) return true;
      // 30日超なら削除
      PropertiesService.getScriptProperties().deleteProperty(key);
    }
  } catch (e) {}
  return false;
}
