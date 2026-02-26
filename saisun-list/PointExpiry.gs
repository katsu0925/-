// PointExpiry.gs
// =====================================================
// ポイント有効期限管理 (Phase 3-4)
// ポイントに6ヶ月の有効期限を設けて利用促進
// =====================================================

var POINT_EXPIRY_MONTHS = 12;
var POINT_EXPIRY_WARN_DAYS = 30; // 失効30日前にリマインド

/**
 * ポイント有効期限チェック 定期実行（毎日6時）
 * ポイント更新日から6ヶ月経過した会員のポイントをリセット
 * 失効1週間前にリマインドメール送信
 */
function pointExpiryCron_() {
  try {
    console.log('pointExpiryCron_: 開始');

    var custSheet = getCustomerSheet_();
    var custData = custSheet.getDataRange().getValues();
    var cache = CacheService.getScriptCache();
    var now = new Date();
    var expired = 0;
    var reminded = 0;

    for (var i = 1; i < custData.length; i++) {
      var points = Number(custData[i][CUSTOMER_SHEET_COLS.POINTS] || 0);
      if (points <= 0) continue;

      var custId = String(custData[i][CUSTOMER_SHEET_COLS.ID] || '');
      var email = String(custData[i][CUSTOMER_SHEET_COLS.EMAIL] || '').trim();
      var companyName = String(custData[i][CUSTOMER_SHEET_COLS.COMPANY_NAME] || '');
      var pointsUpdatedAt = custData[i][CUSTOMER_SHEET_COLS.POINTS_UPDATED_AT];

      if (!pointsUpdatedAt) {
        // ポイント更新日が未設定の場合、登録日時をフォールバックとして使用
        pointsUpdatedAt = custData[i][CUSTOMER_SHEET_COLS.CREATED_AT];
      }
      if (!pointsUpdatedAt) continue;

      var updatedDate = new Date(pointsUpdatedAt);
      var expiryDate = new Date(updatedDate);
      expiryDate.setMonth(expiryDate.getMonth() + POINT_EXPIRY_MONTHS);

      var daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      // ポイント失効
      if (daysUntilExpiry <= 0) {
        // ポイントをリセット
        var lock = LockService.getScriptLock();
        if (lock.tryLock(5000)) {
          try {
            custSheet.getRange(i + 1, CUSTOMER_SHEET_COLS.POINTS + 1).setValue(0);
            custSheet.getRange(i + 1, CUSTOMER_SHEET_COLS.POINTS_UPDATED_AT + 1).setValue(now);
            expired++;
            console.log('pointExpiryCron_: ポイント失効 ' + email + ' (' + points + 'pt)');

            // 失効通知メール
            if (email && email.indexOf('@') !== -1) {
              sendPointExpiredEmail_(email, companyName, points);
            }
          } finally {
            lock.releaseLock();
          }
        }
        continue;
      }

      // 失効1週間前のリマインド
      if (daysUntilExpiry <= POINT_EXPIRY_WARN_DAYS && daysUntilExpiry > 0) {
        var remindKey = 'POINT_EXPIRY_REMINDED:' + custId;
        if (cache.get(remindKey)) continue; // 通知済み

        if (email && email.indexOf('@') !== -1) {
          var expiryDateStr = Utilities.formatDate(expiryDate, 'Asia/Tokyo', 'yyyy年MM月dd日');
          sendPointExpiryReminderEmail_(email, companyName, points, expiryDateStr);
          cache.put(remindKey, '1', 14 * 24 * 3600); // 14日間
          reminded++;
          console.log('pointExpiryCron_: 失効リマインド ' + email + ' (' + points + 'pt, ' + daysUntilExpiry + '日後)');
        }
      }
    }

    console.log('pointExpiryCron_: 完了 失効=' + expired + '件, リマインド=' + reminded + '件');
  } catch (e) {
    console.error('pointExpiryCron_ error:', e);
  }
}

/**
 * ポイント失効リマインドメール送信
 */
function sendPointExpiryReminderEmail_(email, companyName, points, expiryDateStr) {
  try {
    var subject = '【デタウリ.Detauri】ポイント失効のお知らせ';
    var body = companyName + ' 様\n\n'
      + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
      + 'お持ちのポイントがまもなく失効いたします。\n'
      + 'ぜひお早めにご利用ください。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ ポイント残高: ' + points + 'ポイント\n'
      + '■ 失効日: ' + expiryDateStr + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + 'ポイントは次回のお買い物で1ポイント=1円としてご利用いただけます。\n\n'
      + '▼ お買い物はこちら\n'
      + SITE_CONSTANTS.SITE_URL + '\n\n'
      + '※ ポイントは最終ポイント変動日から6ヶ月で失効します。\n'
      + '※ 新たにお買い物をされると有効期限が延長されます。\n\n'
      + '──────────────────\n'
      + SITE_CONSTANTS.SITE_NAME + '\n'
      + SITE_CONSTANTS.SITE_URL + '\n'
      + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    MailApp.sendEmail({
      to: email, subject: subject, body: body, noReply: true,
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\nお持ちのポイントがまもなく失効いたします。\nぜひお早めにご利用ください。',
        sections: [{
          title: 'ポイント情報',
          rows: [
            { label: 'ポイント残高', value: points + 'ポイント' },
            { label: '失効日', value: expiryDateStr }
          ],
          text: 'ポイントは次回のお買い物で1ポイント=1円としてご利用いただけます。'
        }],
        cta: { text: 'お買い物はこちら', url: SITE_CONSTANTS.SITE_URL },
        notes: [
          'ポイントは最終ポイント変動日から6ヶ月で失効します。',
          '新たにお買い物をされると有効期限が延長されます。'
        ]
      })
    });
  } catch (e) {
    console.error('sendPointExpiryReminderEmail_ error:', e);
  }
}

/**
 * ポイント失効通知メール送信
 */
function sendPointExpiredEmail_(email, companyName, expiredPoints) {
  try {
    var subject = '【デタウリ.Detauri】ポイントが失効しました';
    var body = companyName + ' 様\n\n'
      + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
      + '有効期限切れにより、以下のポイントが失効いたしました。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ 失効ポイント: ' + expiredPoints + 'ポイント\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '今後もお買い物でポイントが貯まります。\n'
      + 'ぜひまたご利用ください。\n\n'
      + '▼ お買い物はこちら\n'
      + SITE_CONSTANTS.SITE_URL + '\n\n'
      + '──────────────────\n'
      + SITE_CONSTANTS.SITE_NAME + '\n'
      + SITE_CONSTANTS.SITE_URL + '\n'
      + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    MailApp.sendEmail({
      to: email, subject: subject, body: body, noReply: true,
      htmlBody: buildHtmlEmail_({
        greeting: companyName + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n有効期限切れにより、以下のポイントが失効いたしました。',
        sections: [{
          title: '失効ポイント',
          rows: [
            { label: '失効ポイント', value: expiredPoints + 'ポイント' }
          ],
          text: '今後もお買い物でポイントが貯まります。\nぜひまたご利用ください。'
        }],
        cta: { text: 'お買い物はこちら', url: SITE_CONSTANTS.SITE_URL }
      })
    });
  } catch (e) {
    console.error('sendPointExpiredEmail_ error:', e);
  }
}

/**
 * ポイント更新日を現在日時に更新するヘルパー
 * ポイント付与・利用時に呼び出す
 * @param {number} row - 顧客管理シートの行番号（1-indexed）
 */
function updatePointsTimestamp_(row) {
  try {
    getCustomerSheet_().getRange(row, CUSTOMER_SHEET_COLS.POINTS_UPDATED_AT + 1).setValue(new Date());
  } catch (e) {
    console.log('optional: updatePointsTimestamp_: ' + (e.message || e));
  }
}

/**
 * GASエディタから手動実行: 既存顧客のPOINTS_UPDATED_AT列を一括設定
 * ポイント残高 > 0 かつ POINTS_UPDATED_AT が空の顧客に現在日時を設定
 */
function backfillPointsUpdatedAt() {
  var sheet = getCustomerSheet_();
  var data = sheet.getDataRange().getValues();
  var colPts = CUSTOMER_SHEET_COLS.POINTS;           // 12 (M列)
  var colUpd = CUSTOMER_SHEET_COLS.POINTS_UPDATED_AT; // 13 (N列)
  var now = new Date();
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var points = Number(data[i][colPts]) || 0;
    var updatedAt = data[i][colUpd];
    if (points > 0 && !updatedAt) {
      sheet.getRange(i + 1, colUpd + 1).setValue(now);
      count++;
    }
  }
  console.log('backfillPointsUpdatedAt: ' + count + '件にポイント更新日を設定');
  return { ok: true, updated: count };
}
