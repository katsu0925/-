// AbandonedCart.gs
// =====================================================
// カゴ落ちメール (Phase 3-1)
// カート放棄後にリマインドメール送信
// =====================================================

/**
 * カゴ落ちメール送信 定期実行（15分ごと）
 * CacheServiceの CART_ABANDON:{email} フラグをチェックし、
 * 未送信の会員にリマインドメールを送信
 */
function abandonedCartCron_() {
  try {
    console.log('abandonedCartCron_: 開始');
    var cache = CacheService.getScriptCache();

    // カゴ落ち候補をCacheServiceから取得
    // CART_ABANDON_LIST にJSON配列でメールアドレスを保持
    var listRaw = cache.get('CART_ABANDON_LIST');
    if (!listRaw) {
      console.log('abandonedCartCron_: カゴ落ち候補なし');
      return;
    }

    var emails;
    try { emails = JSON.parse(listRaw); } catch (e) { emails = []; }
    if (!emails.length) return;

    var sent = 0;
    var remaining = [];

    for (var i = 0; i < emails.length; i++) {
      var email = String(emails[i] || '').trim().toLowerCase();
      if (!email) continue;

      // 送信済みチェック（24時間以内に送信済みならスキップ）
      var remindKey = 'CART_REMIND:' + email;
      if (cache.get(remindKey)) {
        continue; // 既に送信済み
      }

      // 会員チェック
      var customer = findCustomerByEmail_(email);
      if (!customer) continue;

      // メール送信
      try {
        var subject = '【デタウリ.Detauri】カートに商品が残っています';
        var body = customer.companyName + ' 様\n\n'
          + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
          + 'カートに入れていた商品の確保期限が終了しました。\n'
          + '人気商品は在庫が限られておりますので、お早めにご注文ください。\n\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '■ 商品を再度確認する\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + SITE_CONSTANTS.SITE_URL + '\n\n'
          + '会員様は確保時間が30分に延長されます。\n'
          + 'ログインしてからカートに追加することをおすすめします。\n\n'
          + '※ このメールは自動送信です。\n'
          + '※ 商品の在庫状況は変動する場合があります。\n\n'
          + '──────────────────\n'
          + SITE_CONSTANTS.SITE_NAME + '\n'
          + SITE_CONSTANTS.SITE_URL + '\n'
          + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
          + '──────────────────\n';

        MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });
        // 送信済みフラグ（24時間）
        cache.put(remindKey, '1', 86400);
        sent++;
        console.log('abandonedCartCron_: メール送信 ' + email);
      } catch (mailErr) {
        console.error('abandonedCartCron_ mail error: ' + email, mailErr);
      }
    }

    // 処理済みリストをクリア
    cache.remove('CART_ABANDON_LIST');
    console.log('abandonedCartCron_: 完了 送信=' + sent + '件');
  } catch (e) {
    console.error('abandonedCartCron_ error:', e);
  }
}

/**
 * カゴ落ち候補を登録（確保解放時に呼び出し）
 * @param {string} email - 会員メールアドレス
 */
function registerCartAbandon_(email) {
  if (!email) return;
  try {
    var cache = CacheService.getScriptCache();
    var listRaw = cache.get('CART_ABANDON_LIST');
    var list;
    try { list = listRaw ? JSON.parse(listRaw) : []; } catch (e) { list = []; }

    var normalizedEmail = String(email).trim().toLowerCase();
    if (list.indexOf(normalizedEmail) === -1) {
      list.push(normalizedEmail);
    }

    cache.put('CART_ABANDON_LIST', JSON.stringify(list), 7200); // 2時間保持
  } catch (e) {
    console.error('registerCartAbandon_ error:', e);
  }
}

/**
 * apiSyncHoldsから呼ばれる: userKeyとメールアドレスのマッピングを保存
 * @param {string} userKey
 * @param {string} email
 */
function cacheCartUserEmail_(userKey, email) {
  if (!userKey || !email) return;
  try {
    CacheService.getScriptCache().put('CART_USER:' + userKey, email, 7200); // 2時間
  } catch (e) {
    console.log('optional: cacheCartUserEmail_: ' + (e.message || e));
  }
}

/**
 * 確保解放時にカゴ落ち候補を登録（userKeyからメールを取得）
 * @param {string} userKey
 */
function notifyCartAbandoned_(userKey) {
  if (!userKey) return;
  try {
    var cache = CacheService.getScriptCache();
    var email = cache.get('CART_USER:' + userKey);
    if (email) {
      registerCartAbandon_(email);
    }
  } catch (e) {
    console.log('optional: notifyCartAbandoned_: ' + (e.message || e));
  }
}
