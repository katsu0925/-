// AbandonedCart.gs
// =====================================================
// カゴ落ちメール (Phase 3-1)
// カート放棄後にリマインドメール送信
// デタウリ（個品）+ アソート（BulkLP）両対応
// =====================================================

/**
 * カゴ落ちメール送信 定期実行（15分ごと）
 * CacheServiceの CART_ABANDON_LIST / BULK_CART_ABANDON_LIST から
 * 未送信の会員にリマインドメールを送信
 */
function abandonedCartCron_() {
  try {
    console.log('abandonedCartCron_: 開始');
    var cache = CacheService.getScriptCache();
    var sent = 0;

    // ----- デタウリ（個品）カゴ落ち -----
    var listRaw = cache.get('CART_ABANDON_LIST');
    if (listRaw) {
      var emails;
      try { emails = JSON.parse(listRaw); } catch (e) { emails = []; }

      for (var i = 0; i < emails.length; i++) {
        var email = String(emails[i] || '').trim().toLowerCase();
        if (!email) continue;

        var remindKey = 'CART_REMIND:' + email;
        if (cache.get(remindKey)) continue;

        var customer = findCustomerByEmail_(email);
        if (!customer) continue;

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

          GmailApp.sendEmail(email, subject, body, {
            from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
            htmlBody: buildHtmlEmail_({
              greeting: customer.companyName + ' 様',
              lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\nカートに入れていた商品の確保期限が終了しました。\n人気商品は在庫が限られておりますので、お早めにご注文ください。',
              cta: { text: '商品を再度確認する', url: SITE_CONSTANTS.SITE_URL },
              notes: [
                '会員様は確保時間が30分に延長されます。ログインしてからカートに追加することをおすすめします。',
                'このメールは自動送信です。',
                '商品の在庫状況は変動する場合があります。'
              ]
            })
          });
          cache.put(remindKey, '1', 86400);
          sent++;
          console.log('abandonedCartCron_: デタウリ メール送信 ' + email);
        } catch (mailErr) {
          console.error('abandonedCartCron_ detauri mail error: ' + email, mailErr);
        }
      }
      cache.remove('CART_ABANDON_LIST');
    }

    // ----- アソート（BulkLP）カゴ落ち -----
    var bulkListRaw = cache.get('BULK_CART_ABANDON_LIST');
    if (bulkListRaw) {
      var bulkEmails;
      try { bulkEmails = JSON.parse(bulkListRaw); } catch (e) { bulkEmails = []; }

      var bulkSiteUrl = SITE_CONSTANTS.SITE_URL;
      // アソート商品ページURL（?page=bulk を付与）
      var bulkPageUrl = bulkSiteUrl + (bulkSiteUrl.indexOf('?') === -1 ? '?page=bulk' : '&page=bulk');

      for (var bi = 0; bi < bulkEmails.length; bi++) {
        var bEmail = String(bulkEmails[bi] || '').trim().toLowerCase();
        if (!bEmail) continue;

        var bulkRemindKey = 'BULK_CART_REMIND:' + bEmail;
        if (cache.get(bulkRemindKey)) continue;

        var bCustomer = findCustomerByEmail_(bEmail);
        if (!bCustomer) continue;

        try {
          var bSubject = '【デタウリ.Detauri】アソートカートに商品が残っています';
          var bBody = bCustomer.companyName + ' 様\n\n'
            + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
            + 'アソートカートに商品が残っています。\n'
            + '人気商品は在庫が限られておりますので、お早めにご注文ください。\n\n'
            + '━━━━━━━━━━━━━━━━━━━━\n'
            + '■ アソート商品を確認する\n'
            + '━━━━━━━━━━━━━━━━━━━━\n'
            + bulkPageUrl + '\n\n'
            + '※ このメールは自動送信です。\n'
            + '※ 商品の在庫状況は変動する場合があります。\n\n'
            + '──────────────────\n'
            + SITE_CONSTANTS.SITE_NAME + '\n'
            + SITE_CONSTANTS.SITE_URL + '\n'
            + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
            + '──────────────────\n';

          GmailApp.sendEmail(bEmail, bSubject, bBody, {
            from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
            htmlBody: buildHtmlEmail_({
              greeting: bCustomer.companyName + ' 様',
              lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\nアソートカートに商品が残っています。\n人気商品は在庫が限られておりますので、お早めにご注文ください。',
              cta: { text: 'アソート商品を確認する', url: bulkPageUrl },
              notes: [
                'このメールは自動送信です。',
                '商品の在庫状況は変動する場合があります。'
              ]
            })
          });
          cache.put(bulkRemindKey, '1', 86400);
          sent++;
          console.log('abandonedCartCron_: アソート メール送信 ' + bEmail);
        } catch (bulkMailErr) {
          console.error('abandonedCartCron_ bulk mail error: ' + bEmail, bulkMailErr);
        }
      }
      cache.remove('BULK_CART_ABANDON_LIST');
    }

    if (!listRaw && !bulkListRaw) {
      console.log('abandonedCartCron_: カゴ落ち候補なし');
    }

    console.log('abandonedCartCron_: 完了 送信=' + sent + '件');
  } catch (e) {
    console.error('abandonedCartCron_ error:', e);
  }
}

/**
 * デタウリ カゴ落ち候補を登録（確保解放時に呼び出し）
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
 * アソート カゴ落ち候補を登録
 * @param {string} email - 会員メールアドレス
 */
function registerBulkCartAbandon_(email) {
  if (!email) return;
  try {
    var cache = CacheService.getScriptCache();
    var listRaw = cache.get('BULK_CART_ABANDON_LIST');
    var list;
    try { list = listRaw ? JSON.parse(listRaw) : []; } catch (e) { list = []; }

    var normalizedEmail = String(email).trim().toLowerCase();
    if (list.indexOf(normalizedEmail) === -1) {
      list.push(normalizedEmail);
    }

    cache.put('BULK_CART_ABANDON_LIST', JSON.stringify(list), 7200); // 2時間保持
  } catch (e) {
    console.error('registerBulkCartAbandon_ error:', e);
  }
}

/**
 * アソート カゴ落ち候補登録API（フロントエンドから呼び出し）
 * @param {string} userKey
 * @param {object} params - { sessionId }
 * @return {object} { ok }
 */
function apiBulkRegisterCartAbandon(userKey, params) {
  var sessionId = String(params.sessionId || '').trim();
  if (!sessionId) return { ok: false };
  var customer = findCustomerBySession_(sessionId);
  if (!customer || !customer.email) return { ok: false };
  registerBulkCartAbandon_(customer.email);
  return { ok: true };
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
