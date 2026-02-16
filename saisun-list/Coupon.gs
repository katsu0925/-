// =====================================================
// クーポン管理
// =====================================================
// クーポン管理シート列構成:
// A=クーポンコード, B=割引タイプ(rate/fixed), C=割引値, D=有効期限,
// E=利用上限, F=利用回数, G=1人1回制限(TRUE/FALSE), H=有効(TRUE/FALSE), I=メモ

var COUPON_SHEET_NAME = 'クーポン管理';

var COUPON_COLS = {
  CODE: 0,        // A: クーポンコード
  TYPE: 1,        // B: 割引タイプ (rate=割引率 / fixed=固定額)
  VALUE: 2,       // C: 割引値 (rate: 0.10=10% / fixed: 500=500円)
  EXPIRES: 3,     // D: 有効期限
  MAX_USES: 4,    // E: 利用上限 (0=無制限)
  USE_COUNT: 5,   // F: 利用回数
  ONCE_PER_USER: 6, // G: 1人1回制限
  ACTIVE: 7,      // H: 有効
  MEMO: 8         // I: メモ
};

// クーポン利用履歴シート列構成:
// A=クーポンコード, B=メールアドレス, C=受付番号, D=利用日時
var COUPON_LOG_SHEET_NAME = 'クーポン利用履歴';

/**
 * クーポン管理シートを確保
 */
function sh_ensureCouponSheet_(ss) {
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(COUPON_SHEET_NAME);
  var header = ['クーポンコード', '割引タイプ', '割引値', '有効期限', '利用上限', '利用回数', '1人1回制限', '有効', 'メモ'];
  var r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

/**
 * クーポン利用履歴シートを確保
 */
function sh_ensureCouponLogSheet_(ss) {
  var sh = ss.getSheetByName(COUPON_LOG_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(COUPON_LOG_SHEET_NAME);
  var header = ['クーポンコード', 'メールアドレス', '受付番号', '利用日時'];
  var r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

/**
 * クーポンコードを検証（API用: フロントエンドから呼ばれる）
 * @param {string} code - クーポンコード
 * @param {string} email - 利用者のメールアドレス
 * @param {number} productAmount - 商品代金（割引前）
 * @returns {object} { ok, type, value, discountAmount, message }
 */
function apiValidateCoupon(code, email, productAmount) {
  try {
    var result = validateCoupon_(code, email);
    if (!result.ok) return result;

    var discountAmount = calcCouponDiscount_(result.type, result.value, productAmount);
    return {
      ok: true,
      type: result.type,
      value: result.value,
      discountAmount: discountAmount,
      label: result.type === 'rate'
        ? (Math.round(result.value * 100) + '%OFF')
        : (result.value + '円引き')
    };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/**
 * クーポンを検証（内部関数）
 */
function validateCoupon_(code, email) {
  if (!code) return { ok: false, message: 'クーポンコードを入力してください' };
  code = String(code).trim().toUpperCase();

  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) return { ok: false, message: '無効なクーポンコードです' };

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, message: '無効なクーポンコードです' };

  var data = sh.getRange(2, 1, lastRow - 1, 9).getValues();
  var coupon = null;
  var couponRow = -1;

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COUPON_COLS.CODE] || '').trim().toUpperCase() === code) {
      coupon = data[i];
      couponRow = i + 2;
      break;
    }
  }

  if (!coupon) return { ok: false, message: '無効なクーポンコードです' };

  // 有効チェック
  var active = coupon[COUPON_COLS.ACTIVE];
  if (active === false || String(active).toUpperCase() === 'FALSE') {
    return { ok: false, message: 'このクーポンは現在無効です' };
  }

  // 有効期限チェック
  var expires = coupon[COUPON_COLS.EXPIRES];
  if (expires) {
    var expDate = (expires instanceof Date) ? expires : new Date(expires);
    if (!isNaN(expDate.getTime())) {
      expDate.setHours(23, 59, 59, 999);
      if (new Date() > expDate) {
        return { ok: false, message: 'このクーポンは期限切れです' };
      }
    }
  }

  // 利用上限チェック
  var maxUses = Number(coupon[COUPON_COLS.MAX_USES]) || 0;
  var useCount = Number(coupon[COUPON_COLS.USE_COUNT]) || 0;
  if (maxUses > 0 && useCount >= maxUses) {
    return { ok: false, message: 'このクーポンは利用上限に達しました' };
  }

  // 1人1回制限チェック
  var oncePerUser = coupon[COUPON_COLS.ONCE_PER_USER];
  if (oncePerUser === true || String(oncePerUser).toUpperCase() === 'TRUE') {
    if (email && hasUserUsedCoupon_(ss, code, email)) {
      return { ok: false, message: 'このクーポンは既にご利用済みです' };
    }
  }

  var type = String(coupon[COUPON_COLS.TYPE] || 'rate').trim().toLowerCase();
  var value = Number(coupon[COUPON_COLS.VALUE]) || 0;

  if (type !== 'rate' && type !== 'fixed') {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }
  if (value <= 0) {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }

  return { ok: true, type: type, value: value, row: couponRow };
}

/**
 * クーポン割引額を計算
 */
function calcCouponDiscount_(type, value, productAmount) {
  if (type === 'rate') {
    return Math.round(productAmount * value);
  } else {
    return Math.min(value, productAmount);
  }
}

/**
 * ユーザーがクーポンを使用済みか確認
 */
function hasUserUsedCoupon_(ss, code, email) {
  var sh = ss.getSheetByName(COUPON_LOG_SHEET_NAME);
  if (!sh) return false;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return false;

  var data = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  code = String(code).trim().toUpperCase();
  email = String(email).trim().toLowerCase();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === code &&
        String(data[i][1] || '').trim().toLowerCase() === email) {
      return true;
    }
  }
  return false;
}

/**
 * クーポン利用を記録（注文確定時に呼ぶ）
 */
function recordCouponUsage_(code, email, receiptNo) {
  if (!code) return;
  var ss = sh_getOrderSs_();

  // 利用回数をインクリメント
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (sh) {
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var data = sh.getRange(2, 1, lastRow - 1, 6).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][COUPON_COLS.CODE] || '').trim().toUpperCase() === String(code).trim().toUpperCase()) {
          var current = Number(data[i][COUPON_COLS.USE_COUNT]) || 0;
          sh.getRange(i + 2, COUPON_COLS.USE_COUNT + 1).setValue(current + 1);
          break;
        }
      }
    }
  }

  // 利用履歴に追記
  var logSh = sh_ensureCouponLogSheet_(ss);
  var logRow = logSh.getLastRow() + 1;
  logSh.getRange(logRow, 1, 1, 4).setValues([[
    String(code).trim().toUpperCase(),
    String(email || '').trim(),
    String(receiptNo || ''),
    new Date()
  ]]);
}
