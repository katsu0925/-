// SNSShare.gs
// =====================================================
// SNSシェア管理 — SNSシェアキャンペーン機能
// =====================================================
//
// フロー:
// 1. ユーザーがマイページからスクリーンショットをアップロード (apiSubmitSnsShare)
// 2. 管理者がシートのF列を「承認」に変更 (onEdit → approveSnsShare_)
// 3. クーポンが自動生成されユーザーにメール通知
// 4. ユーザーが次回注文時にクーポンコードを入力

// SNSシェア管理シートの列定義
var SNS_SHARE_COLS = {
  ID: 0,           // A: 申請ID
  EMAIL: 1,        // B: 顧客メール
  NAME: 2,         // C: 顧客名
  DATE: 3,         // D: 申請日時
  SCREENSHOT: 4,   // E: スクリーンショットURL
  STATUS: 5,       // F: ステータス (申請中/承認/却下)
  APPROVED_DATE: 6,// G: 承認日時
  COUPON_CODE: 7,  // H: クーポンコード
  MEMO: 8          // I: 備考
};

var SNS_SHARE_SHEET_NAME = 'SNSシェア管理';
var SNS_SHARE_COL_COUNT = 9;
var SNS_SHARE_MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * SNSシェア管理シートを取得（なければ作成）
 */
function sh_ensureSnsShareSheet_(ss) {
  if (!ss) ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sheet = ss.getSheetByName(SNS_SHARE_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SNS_SHARE_SHEET_NAME);
  var headers = ['申請ID', '顧客メール', '顧客名', '申請日時', 'スクリーンショットURL', 'ステータス', '承認日時', 'クーポンコード', '備考'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * スクリーンショット保存用Driveフォルダを取得
 */
function getSnsShareDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('SNS_SHARE_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* フォルダ削除された場合は再作成 */ }
  }
  var folder = DriveApp.createFolder('SNSシェアキャンペーン_スクリーンショット');
  props.setProperty('SNS_SHARE_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * SNSシェア申請API — スクリーンショットをアップロード
 * @param {string} userKey - セッションキー
 * @param {object} params - { sessionId, image: { data: base64, type, name } }
 */
function apiSubmitSnsShare(userKey, params) {
  try {
    // キャンペーン有効チェック
    var campaignStatus = app_getSnsShareCampaignStatus_();
    if (!campaignStatus.enabled) {
      return { ok: false, message: 'SNSシェアキャンペーンは現在実施していません' };
    }

    // セッション検証
    var sessionId = String((params || {}).sessionId || '').trim();
    if (!sessionId) return { ok: false, message: 'ログインが必要です' };
    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効です。再ログインしてください' };

    var p = params || {};
    var image = p.image;
    if (!image || !image.data) {
      return { ok: false, message: 'スクリーンショットを選択してください' };
    }

    // サイズチェック（base64のデータ部分）
    var base64Data = String(image.data);
    if (base64Data.length * 0.75 > SNS_SHARE_MAX_IMAGE_SIZE) {
      return { ok: false, message: '画像サイズは5MB以下にしてください' };
    }

    var email = customer.email;
    var customerName = customer.companyName || '';
    var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
    var sheet = sh_ensureSnsShareSheet_(ss);

    // 重複チェック（1人1回のみ申請可能、ただし却下済は再申請可）
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][SNS_SHARE_COLS.EMAIL]).toLowerCase() === email.toLowerCase()) {
        var status = String(data[i][SNS_SHARE_COLS.STATUS]);
        if (status === '申請中') {
          return { ok: false, message: '既にSNSシェアの申請を提出済みです。確認をお待ちください' };
        }
        if (status === '承認') {
          return { ok: false, message: 'SNSシェアキャンペーンは既にご利用済みです' };
        }
        // 却下の場合は再申請可能 → 古い行を削除
        if (status === '却下') {
          sheet.deleteRow(i + 1);
          data.splice(i, 1);
          i--;
        }
      }
    }

    // Driveにスクリーンショットを保存
    var folder = getSnsShareDriveFolder_();
    var blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      image.type || 'image/jpeg',
      email + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + (image.name || 'screenshot.jpg')
    );
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var screenshotUrl = file.getUrl();

    // シートに行追加
    var newId = 'SNS-' + String(data.length).padStart(4, '0');
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([newId, email, customerName, now, screenshotUrl, '申請中', '', '', '']);

    // 管理者にメール通知
    var adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '';
    if (adminEmail) {
      var adminHtml = buildHtmlEmail_({
        greeting: '管理者 様',
        lead: 'SNSシェアキャンペーンの新しい申請がありました。',
        sections: [
          {
            title: '申請情報',
            rows: [
              { label: '申請ID', value: newId },
              { label: '顧客', value: customerName + ' (' + email + ')' },
              { label: '申請日時', value: now }
            ],
            link: { url: screenshotUrl, text: 'スクリーンショットを確認' }
          }
        ],
        notes: ['SNSシェア管理シートのF列を「承認」または「却下」に変更してください。']
      });
      MailApp.sendEmail({
        to: adminEmail,
        subject: '【デタウリ】SNSシェア申請: ' + customerName + ' (' + email + ')',
        body: 'SNSシェアキャンペーンの申請がありました。スプレッドシートを確認してください。',
        htmlBody: adminHtml
      });
    }

    return { ok: true, message: 'SNSシェアの申請を送信しました。確認後にクーポンをお送りします' };
  } catch (e) {
    console.error('apiSubmitSnsShare error:', e);
    return { ok: false, message: '申請の送信中にエラーが発生しました。時間をおいて再度お試しください' };
  }
}

/**
 * SNSシェア申請状況確認API
 * @param {string} userKey - セッションキー
 * @param {object} params - { sessionId }
 */
function apiGetSnsShareStatus(userKey, params) {
  try {
    var campaignStatus = app_getSnsShareCampaignStatus_();

    var sessionId = String((params || {}).sessionId || '').trim();
    if (!sessionId) {
      return { ok: true, status: 'not_logged_in', campaignEnabled: campaignStatus.enabled };
    }
    var customer = findCustomerBySession_(sessionId);
    if (!customer) {
      return { ok: true, status: 'not_logged_in', campaignEnabled: campaignStatus.enabled };
    }

    var email = customer.email;
    var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
    var sheet = ss.getSheetByName(SNS_SHARE_SHEET_NAME);
    if (!sheet) {
      return { ok: true, status: 'not_applied', campaignEnabled: campaignStatus.enabled };
    }

    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][SNS_SHARE_COLS.EMAIL]).toLowerCase() === email.toLowerCase()) {
        var status = String(data[i][SNS_SHARE_COLS.STATUS]);
        return {
          ok: true,
          status: status === '承認' ? 'approved' : status === '却下' ? 'rejected' : 'pending',
          couponCode: String(data[i][SNS_SHARE_COLS.COUPON_CODE] || ''),
          campaignEnabled: campaignStatus.enabled
        };
      }
    }
    return { ok: true, status: 'not_applied', campaignEnabled: campaignStatus.enabled };
  } catch (e) {
    console.error('apiGetSnsShareStatus error:', e);
    return { ok: false, message: 'ステータスの取得に失敗しました' };
  }
}

/**
 * SNSシェア承認処理（onEditから呼び出し）
 * F列を「承認」に変更したときに実行
 */
function approveSnsShare_(sheet, row) {
  var data = sheet.getRange(row, 1, 1, SNS_SHARE_COL_COUNT).getValues()[0];
  var email = String(data[SNS_SHARE_COLS.EMAIL]);
  var customerName = String(data[SNS_SHARE_COLS.NAME]);
  var existingCoupon = String(data[SNS_SHARE_COLS.COUPON_CODE]);

  // 冪等性: 既にクーポンが発行済みなら何もしない
  if (existingCoupon) return;

  // ランダムクーポンコード生成（推測防止）
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var random = '';
  for (var i = 0; i < 8; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
  var couponCode = 'SNS-' + random;

  // 有効期限: 承認日から90日後
  var expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + 90);
  var expiresStr = Utilities.formatDate(expireDate, 'Asia/Tokyo', 'yyyy/MM/dd');

  // クーポン管理シートに行を追加
  var ss = sheet.getParent();
  var couponSheet = ss.getSheetByName('クーポン管理');
  if (!couponSheet) {
    console.error('クーポン管理シートが見つかりません');
    return;
  }

  // COUPON_COL_COUNT = 18列
  var newCouponRow = [
    couponCode,     // A: コード
    'fixed',        // B: タイプ
    1000,           // C: 値（¥1,000）
    expiresStr,     // D: 有効期限
    1,              // E: 利用上限
    0,              // F: 利用回数
    true,           // G: 1人1回制限
    true,           // H: 有効
    'SNSシェアキャンペーン自動発行 (' + email + ')',  // I: メモ
    'all',          // J: 対象顧客
    '',             // K: 有効開始日
    false,          // L: 会員割引併用
    false,          // M: 数量割引併用
    'all',          // N: チャネル
    '',             // O: 対象商品ID
    '',             // P: 送料除外商品ID
    '',             // Q: 限定顧客名
    email           // R: 限定顧客メール
  ];
  couponSheet.appendRow(newCouponRow);

  // クーポンキャッシュを無効化
  CacheService.getScriptCache().remove(COUPON_CACHE_KEY);

  // SNSシェア管理シートにクーポンコードと承認日時を記録
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  sheet.getRange(row, SNS_SHARE_COLS.APPROVED_DATE + 1).setValue(now);
  sheet.getRange(row, SNS_SHARE_COLS.COUPON_CODE + 1).setValue(couponCode);

  // ユーザーにクーポン通知メール送信
  sendSnsShareCouponEmail_(email, customerName, couponCode, expiresStr);
}

/**
 * SNSシェア却下処理（onEditから呼び出し）
 */
function rejectSnsShare_(sheet, row) {
  var data = sheet.getRange(row, 1, 1, SNS_SHARE_COL_COUNT).getValues()[0];
  var email = String(data[SNS_SHARE_COLS.EMAIL]);
  var customerName = String(data[SNS_SHARE_COLS.NAME]);

  var html = buildHtmlEmail_({
    greeting: (customerName || 'お客') + ' 様',
    lead: 'SNSシェアキャンペーンの申請について、確認の結果、今回は承認に至りませんでした。\nお手数ですが、デタウリのサイトURLが含まれたSNS投稿のスクリーンショットを再度お送りください。',
    cta: { text: 'マイページから再申請', url: 'https://detauri.com/mypage' },
    notes: ['ご不明な点がございましたらお気軽にお問い合わせください。']
  });

  GmailApp.sendEmail(email, '【デタウリ】SNSシェアキャンペーン申請について',
    'SNSシェアキャンペーンの申請について確認の結果、今回は承認に至りませんでした。マイページから再度お申し込みください。', {
    from: SITE_CONSTANTS.CUSTOMER_EMAIL,
    replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
    htmlBody: html
  });
}

/**
 * クーポン通知メール送信
 */
function sendSnsShareCouponEmail_(email, customerName, couponCode, expiresStr) {
  var html = buildHtmlEmail_({
    greeting: (customerName || 'お客') + ' 様',
    lead: 'SNSシェアキャンペーンへのご参加ありがとうございます！\nスクリーンショットを確認し、クーポンを発行いたしました。',
    sections: [
      {
        title: 'クーポン情報',
        rows: [
          { label: 'クーポンコード', value: couponCode },
          { label: '割引内容', value: '¥1,000引き（1点まで無料）' },
          { label: '有効期限', value: expiresStr },
          { label: '利用回数', value: '1回限り' }
        ]
      }
    ],
    cta: { text: '今すぐお買い物', url: 'https://detauri.com' },
    notes: [
      'クーポンはご注文時に「クーポンコード」欄に入力してご利用ください。',
      '¥1,000以下の商品で1点無料となります（¥1,000を超える商品の場合は¥1,000引きとなります）。',
      '有効期限: ' + expiresStr + 'まで'
    ]
  });

  GmailApp.sendEmail(email, '【デタウリ】SNSシェアクーポンが届きました！',
    'SNSシェアキャンペーンのクーポンが発行されました。コード: ' + couponCode + '（有効期限: ' + expiresStr + '）', {
    from: SITE_CONSTANTS.CUSTOMER_EMAIL,
    replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
    htmlBody: html
  });
}
