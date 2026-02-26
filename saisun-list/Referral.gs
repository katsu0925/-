// Referral.gs
// =====================================================
// 紹介プログラム (Phase 3-6)
// 既存顧客からの紹介で双方にポイント付与
// =====================================================

var REFERRAL_POINTS_REFERRER = 500;   // 紹介者に付与するポイント
var REFERRAL_POINTS_REFEREE = 300;    // 被紹介者に付与するポイント

/**
 * 紹介履歴シートを取得（なければ作成）
 */
function getReferralSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('紹介履歴');
  if (!sheet) {
    sheet = ss.insertSheet('紹介履歴');
    sheet.appendRow(['紹介者ID', '紹介者メール', '被紹介者ID', '被紹介者メール', '日時', 'ポイント付与済']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

/**
 * 紹介コード取得API
 * 会員IDベースのコード生成（REF-{customerId}）
 * @param {string} userKey
 * @param {object} params - { sessionId }
 * @return {object} { ok, data: { referralCode, referralUrl } }
 */
function apiGetReferralCode(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '').trim();
    if (!sessionId) {
      return { ok: false, message: 'ログインが必要です' };
    }

    var customer = findCustomerBySession_(sessionId);
    if (!customer) {
      return { ok: false, message: 'セッションが無効です。再ログインしてください' };
    }

    var referralCode = 'REF-' + customer.id;
    var referralUrl = SITE_CONSTANTS.SITE_URL + '?ref=' + encodeURIComponent(referralCode);

    return {
      ok: true,
      data: {
        referralCode: referralCode,
        referralUrl: referralUrl
      }
    };
  } catch (e) {
    console.error('apiGetReferralCode error:', e);
    return { ok: false, message: '紹介コードの取得に失敗しました' };
  }
}

/**
 * 紹介コード適用API
 * 新規登録後に呼び出し、紹介者と被紹介者にポイント付与
 * @param {string} userKey
 * @param {object} params - { sessionId, referralCode }
 * @return {object} { ok, message, data: { referrerPoints, refereePoints } }
 */
function apiApplyReferralCode(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '').trim();
    var referralCode = String(params.referralCode || '').trim();

    if (!sessionId) {
      return { ok: false, message: 'ログインが必要です' };
    }
    if (!referralCode) {
      return { ok: false, message: '紹介コードを入力してください' };
    }

    // 被紹介者（現在のログインユーザー）
    var referee = findCustomerBySession_(sessionId);
    if (!referee) {
      return { ok: false, message: 'セッションが無効です。再ログインしてください' };
    }

    var refereeFullInfo = findCustomerByEmail_(referee.email);
    if (!refereeFullInfo) {
      return { ok: false, message: '顧客情報が見つかりません' };
    }

    // 紹介コードから紹介者IDを抽出
    if (referralCode.indexOf('REF-') !== 0) {
      return { ok: false, message: '無効な紹介コードです' };
    }
    var referrerId = referralCode.substring(4); // 'REF-' を除去

    // 紹介者を検索
    var referrer = findCustomerById_(referrerId);
    if (!referrer) {
      return { ok: false, message: '紹介コードが見つかりません' };
    }

    // 自己紹介チェック
    if (referrer.email.toLowerCase() === referee.email.toLowerCase()) {
      return { ok: false, message: '自分自身は紹介できません' };
    }

    // 重複紹介チェック
    if (isReferralDuplicate_(referrer.id, refereeFullInfo.id)) {
      return { ok: false, message: 'この紹介コードは既に適用済みです' };
    }

    // ポイント付与（排他制御）
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { ok: false, message: '処理が混み合っています。しばらくお待ちください。' };
    }

    try {
      // 紹介者にポイント付与
      addPoints_(referrer.email, REFERRAL_POINTS_REFERRER);
      if (referrer.row) updatePointsTimestamp_(referrer.row);

      // 被紹介者にポイント付与
      addPoints_(referee.email, REFERRAL_POINTS_REFEREE);
      if (refereeFullInfo.row) updatePointsTimestamp_(refereeFullInfo.row);

      // 紹介履歴に記録
      var refSheet = getReferralSheet_();
      refSheet.appendRow([
        referrer.id,
        referrer.email,
        refereeFullInfo.id,
        referee.email,
        new Date(),
        '済'
      ]);

      lock.releaseLock();

      // 紹介者にメール通知
      try {
        sendReferralNotifyEmail_(referrer.email, referrer.companyName, referee.email, REFERRAL_POINTS_REFERRER);
      } catch (mailErr) {
        console.error('referral notify mail error:', mailErr);
      }

      return {
        ok: true,
        message: '紹介コードを適用しました！',
        data: {
          referrerPoints: REFERRAL_POINTS_REFERRER,
          refereePoints: REFERRAL_POINTS_REFEREE
        }
      };
    } catch (lockErr) {
      lock.releaseLock();
      throw lockErr;
    }
  } catch (e) {
    console.error('apiApplyReferralCode error:', e);
    return { ok: false, message: '紹介コードの適用に失敗しました: ' + (e.message || e) };
  }
}

/**
 * 顧客IDで検索
 * @param {string} customerId
 * @return {object|null}
 */
function findCustomerById_(customerId) {
  if (!customerId) return null;
  var sheet = getCustomerSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][CUSTOMER_SHEET_COLS.ID] || '') === customerId) {
      return {
        row: i + 1,
        id: data[i][CUSTOMER_SHEET_COLS.ID],
        email: String(data[i][CUSTOMER_SHEET_COLS.EMAIL] || '').trim(),
        companyName: String(data[i][CUSTOMER_SHEET_COLS.COMPANY_NAME] || '')
      };
    }
  }
  return null;
}

/**
 * 重複紹介チェック
 * @param {string} referrerId
 * @param {string} refereeId
 * @return {boolean}
 */
function isReferralDuplicate_(referrerId, refereeId) {
  var sheet = getReferralSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === referrerId && String(data[i][2] || '') === refereeId) {
      return true;
    }
  }
  return false;
}

/**
 * 紹介者への通知メール
 */
function sendReferralNotifyEmail_(email, companyName, refereeEmail, points) {
  var maskedEmail = refereeEmail.charAt(0) + '***@' + refereeEmail.split('@')[1];
  var subject = '【デタウリ.Detauri】紹介ポイントが付与されました';
  var body = companyName + ' 様\n\n'
    + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
    + 'あなたの紹介で新しい会員が登録されました！\n\n'
    + '━━━━━━━━━━━━━━━━━━━━\n'
    + '■ 紹介ポイント: +' + points + 'ポイント\n'
    + '■ 紹介先: ' + maskedEmail + '\n'
    + '━━━━━━━━━━━━━━━━━━━━\n\n'
    + '付与されたポイントは次回のお買い物でご利用いただけます。\n'
    + 'これからもお友達やお仲間へのご紹介をお待ちしております。\n\n'
    + '▼ お買い物はこちら\n'
    + SITE_CONSTANTS.SITE_URL + '\n\n'
    + '──────────────────\n'
    + SITE_CONSTANTS.SITE_NAME + '\n'
    + SITE_CONSTANTS.SITE_URL + '\n'
    + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────\n';

  MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });
}
