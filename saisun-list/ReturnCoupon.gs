// =====================================================
// ReturnCoupon.gs — 再来促進クーポン（発送完了メール同梱）
// =====================================================
// 根拠: 2回目の注文を実際にした24人の「初回からの日数」は
//       平均11日 / 71%が14日以内 / 最長38日 / 60日超はゼロ。
//       既存の休眠クーポン(60日・180日・365日)は、
//       実績上カムバックが1件も起きていないゾーンを狙っている。
//       → 打ち手は「初回発送直後の14日」に寄せる。
//
// 方式: 受注ごとに1回限りの個別コード AGAIN14-<受付番号> を発行し、
//       クーポン管理シートの
//         D列(有効期限)     = 発行日+14日
//         R列(限定顧客メール) = その注文の連絡先メール
//       で本人・期限を厳密に縛る。
//       GAS側(Coupon.gs)・Workers側(coupon.js / submit.js)とも
//       target_customer_email と有効期限を見るので3層とも整合する。
//
// 注意: Workers側はクーポン管理シート→D1の5分同期で反映される。
//       発行直後の数分間はWorkers経路で「無効なクーポン」と出る可能性があるが、
//       メール到着から注文までのリードタイムを考えれば実害はない。
// =====================================================

var RETURN_COUPON = {
  PREFIX: 'AGAIN14-',
  RATE: 0.10,                 // 10%OFF
  VALID_DAYS: 14,
  MEMO: '再来促進（発送完了メール同梱・14日間有効）',
  KEEP_DAYS_AFTER_EXPIRY: 30  // 期限切れ後この日数を過ぎた行は掃除する
};

/**
 * 受注1件に対する再来クーポンを発行する（冪等）。
 * すでに同じ受付番号のコードがあれば、それをそのまま返す。
 *
 * @param {string} receiptNo 受付番号
 * @param {string} email 連絡先メール
 * @return {object|null} { code, expiresStr, ratePct } 失敗時 null
 */
function rc_issueReturnCoupon_(receiptNo, email) {
  try {
    var no = String(receiptNo || '').trim();
    var addr = String(email || '').trim().toLowerCase();
    if (!no || !addr || addr.indexOf('@') === -1) return null;

    var code = (RETURN_COUPON.PREFIX + no).toUpperCase();
    var ss = sh_getOrderSs_();
    var sh = sh_ensureCouponSheet_(ss);
    var lastRow = sh.getLastRow();

    // 既発行チェック（発送メールの再送・onEditの重複発火に備える）
    if (lastRow >= 2) {
      var rows = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][COUPON_COLS.CODE] || '').trim().toUpperCase() !== code) continue;
        return {
          code: code,
          expiresStr: rc_formatDate_(rows[i][COUPON_COLS.EXPIRES]),
          ratePct: Math.round((Number(rows[i][COUPON_COLS.VALUE]) || RETURN_COUPON.RATE) * 100)
        };
      }
    }

    var expires = new Date();
    expires.setDate(expires.getDate() + RETURN_COUPON.VALID_DAYS);

    sh.getRange(sh.getLastRow() + 1, 1, 1, COUPON_COL_COUNT).setValues([[
      code,                    // A: コード
      'rate',                  // B: 割引タイプ
      RETURN_COUPON.RATE,      // C: 割引値
      expires,                 // D: 有効期限
      1,                       // E: 利用上限（1回）
      0,                       // F: 利用回数
      true,                    // G: 1人1回制限
      true,                    // H: 有効
      RETURN_COUPON.MEMO + ' ' + no, // I: メモ
      'all',                   // J: 対象顧客
      '',                      // K: 有効開始日
      false,                   // L: 会員割引併用（不可）
      false,                   // M: 30点割引併用（不可）
      'all',                   // N: 適用チャネル
      '',                      // O: 対象商品ID
      '',                      // P: 送料除外商品ID
      '',                      // Q: 限定顧客名（名前の表記ゆれで弾かれるのを避けるため空）
      addr,                    // R: 限定顧客メール
      false                    // S: 送料無料併用
    ]]);

    try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) {}

    console.log('rc_issueReturnCoupon_: 発行 ' + code + ' → ' + addr +
      '（期限 ' + rc_formatDate_(expires) + '）');

    return {
      code: code,
      expiresStr: rc_formatDate_(expires),
      ratePct: Math.round(RETURN_COUPON.RATE * 100)
    };
  } catch (e) {
    // クーポン発行に失敗しても発送メール自体は必ず送る
    console.error('rc_issueReturnCoupon_ error (receiptNo=' + receiptNo + '):', e);
    return null;
  }
}

/**
 * 受付番号から、まだ期限内の再来クーポンを引く（フォローアップメール用）
 * @param {string} receiptNo
 * @return {object|null} { code, expiresStr, ratePct, daysLeft }
 */
function rc_findActiveReturnCoupon_(receiptNo) {
  try {
    var no = String(receiptNo || '').trim();
    if (!no) return null;
    var code = (RETURN_COUPON.PREFIX + no).toUpperCase();

    var sh = sh_ensureCouponSheet_(sh_getOrderSs_());
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return null;

    var rows = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][COUPON_COLS.CODE] || '').trim().toUpperCase() !== code) continue;
      if (rows[i][COUPON_COLS.ACTIVE] !== true &&
          String(rows[i][COUPON_COLS.ACTIVE]).toUpperCase() !== 'TRUE') return null;
      if (Number(rows[i][COUPON_COLS.USE_COUNT]) > 0) return null; // 使用済み

      var exp = rows[i][COUPON_COLS.EXPIRES];
      if (!(exp instanceof Date) || isNaN(exp.getTime())) return null;
      var daysLeft = Math.ceil((exp.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft < 0) return null;

      return {
        code: code,
        expiresStr: rc_formatDate_(exp),
        ratePct: Math.round((Number(rows[i][COUPON_COLS.VALUE]) || RETURN_COUPON.RATE) * 100),
        daysLeft: daysLeft
      };
    }
    return null;
  } catch (e) {
    console.error('rc_findActiveReturnCoupon_ error:', e);
    return null;
  }
}

/**
 * メール本文（テキスト版）に差し込むクーポン案内
 * @param {object} info rc_issueReturnCoupon_ / rc_findActiveReturnCoupon_ の戻り値
 * @return {string}
 */
function rc_couponMailText_(info) {
  if (!info) return '';
  return '━━━━━━━━━━━━━━━━━━━━\n'
    + '■ 次回ご注文で使える ' + info.ratePct + '%OFF クーポン\n'
    + '━━━━━━━━━━━━━━━━━━━━\n'
    + 'クーポンコード：' + info.code + '\n'
    + '有効期限：' + info.expiresStr + 'まで\n'
    + '※ ご注文時にクーポンコード欄へご入力ください。\n'
    + '※ お一人様1回限り・他の割引との併用はできません。\n\n'
    + '▼ 商品を見る\n'
    + SITE_CONSTANTS.SITE_URL + '\n\n';
}

/**
 * buildHtmlEmail_ に渡すクーポンセクション
 * @param {object} info
 * @return {object|null}
 */
function rc_couponMailSection_(info) {
  if (!info) return null;
  return {
    title: '次回ご注文で使える ' + info.ratePct + '%OFF クーポン',
    rows: [
      { label: 'クーポンコード', value: info.code },
      { label: '有効期限', value: info.expiresStr + 'まで' }
    ],
    text: 'ご注文時にクーポンコード欄へご入力ください。お一人様1回限り・他の割引との併用はできません。'
  };
}

/**
 * 期限切れの再来クーポン行を掃除する（cronDaily4To6 から実行）
 * 期限から KEEP_DAYS_AFTER_EXPIRY 日を過ぎた行だけ削除する。
 * 利用実績はクーポン利用履歴シートに残るため、行を消しても記録は失われない。
 */
function rc_cleanupExpiredReturnCoupons_() {
  try {
    var sh = sh_ensureCouponSheet_(sh_getOrderSs_());
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var rows = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
    var cutoff = Date.now() - RETURN_COUPON.KEEP_DAYS_AFTER_EXPIRY * 24 * 60 * 60 * 1000;
    var targets = [];

    for (var i = 0; i < rows.length; i++) {
      var code = String(rows[i][COUPON_COLS.CODE] || '').trim().toUpperCase();
      if (code.indexOf(RETURN_COUPON.PREFIX) !== 0) continue;
      var exp = rows[i][COUPON_COLS.EXPIRES];
      if (!(exp instanceof Date) || isNaN(exp.getTime())) continue;
      if (exp.getTime() < cutoff) targets.push(i + 2); // シート行番号
    }

    // 行番号がずれないよう下から削除
    for (var t = targets.length - 1; t >= 0; t--) {
      sh.deleteRow(targets[t]);
    }

    if (targets.length) {
      try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) {}
      console.log('rc_cleanupExpiredReturnCoupons_: ' + targets.length + '行削除');
    }
  } catch (e) {
    console.error('rc_cleanupExpiredReturnCoupons_ error:', e);
  }
}

/** Date → 'yyyy年M月d日'（メール表示用） */
function rc_formatDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月d日');
}
