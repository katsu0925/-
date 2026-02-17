// =====================================================
// クーポン管理
// =====================================================
// クーポン管理シート列構成:
// A=クーポンコード, B=割引タイプ(rate/fixed), C=割引値, D=有効期限,
// E=利用上限, F=利用回数, G=1人1回制限(TRUE/FALSE), H=有効(TRUE/FALSE), I=メモ,
// J=対象顧客(all/new/repeat), K=有効開始日

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
  MEMO: 8,        // I: メモ
  TARGET: 9,      // J: 対象顧客 (all=全員 / new=新規限定 / repeat=リピーター限定)
  START_DATE: 10  // K: 有効開始日
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
  var header = ['クーポンコード', '割引タイプ', '割引値', '有効期限', '利用上限', '利用回数', '1人1回制限', '有効', 'メモ', '対象顧客', '有効開始日'];
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

// =====================================================
// 管理メニュー: クーポン登録・削除
// =====================================================

/**
 * クーポン登録（管理メニューから呼ばれる・一括入力）
 */
function registerCoupon() {
  var ui = SpreadsheetApp.getUi();

  var res = ui.prompt('クーポン登録（一括入力）',
    'カンマ区切りで入力してください:\n\n' +
    '書式: コード, タイプ, 値, 有効期限, 利用上限, 1人1回, 対象顧客, 有効開始日, メモ\n\n' +
    '■ タイプ:\n' +
    '  rate          → 割引率（例: 0.10 = 10%OFF）\n' +
    '  fixed         → 固定額引き（例: 500 = 500円引き）\n' +
    '  shipping_free → 送料無料（値は不要、0でOK）\n\n' +
    '■ 対象顧客: all=全員 / new=新規限定 / repeat=リピーター限定\n\n' +
    '■ 空欄にする場合はスキップ（カンマだけ書く）\n\n' +
    '例1: SUMMER10, rate, 0.10, 2026-12-31, 0, true, all, , 夏セール\n' +
    '例2: WELCOME500, fixed, 500, , 0, true, new, , 初回500円引き\n' +
    '例3: FREESHIP, shipping_free, 0, 2026-03-31, 100, false, repeat, 2026-03-01, リピーター送料無料',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) { ui.alert('入力が空です。'); return; }

  var parts = input.split(',');
  for (var pi = 0; pi < parts.length; pi++) parts[pi] = parts[pi].trim();

  // パース
  var code = String(parts[0] || '').toUpperCase();
  if (!code) { ui.alert('クーポンコードが空です。'); return; }

  var type = String(parts[1] || '').toLowerCase();
  if (type !== 'rate' && type !== 'fixed' && type !== 'shipping_free') {
    ui.alert('割引タイプは rate / fixed / shipping_free のいずれかを指定してください。');
    return;
  }

  var value = 0;
  if (type === 'shipping_free') {
    value = 0;
  } else {
    value = Number(parts[2]);
    if (isNaN(value) || value <= 0) { ui.alert('割引値は0より大きい数値を指定してください。'); return; }
    if (type === 'rate' && value >= 1) { ui.alert('rate の場合は小数で指定してください（例: 0.10 = 10%）。'); return; }
  }

  var expiresStr = String(parts[3] || '').trim();
  var expires = '';
  if (expiresStr) {
    var d = new Date(expiresStr);
    if (isNaN(d.getTime())) { ui.alert('有効期限の日付形式が正しくありません。'); return; }
    expires = d;
  }

  var maxUses = Number(parts[4]) || 0;
  var oncePerUser = String(parts[5] || 'false').toLowerCase() === 'true';

  var targetInput = String(parts[6] || '').toLowerCase();
  var target = (targetInput === 'new' || targetInput === 'repeat') ? targetInput : 'all';

  var startDateStr = String(parts[7] || '').trim();
  var startDate = '';
  if (startDateStr) {
    var sd = new Date(startDateStr);
    if (isNaN(sd.getTime())) { ui.alert('有効開始日の日付形式が正しくありません。'); return; }
    startDate = sd;
  }

  var memo = String(parts[8] || '').trim();

  // 重複チェック
  var ss = sh_getOrderSs_();
  var sh = sh_ensureCouponSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var existing = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0] || '').trim().toUpperCase() === code) {
        ui.alert('クーポンコード「' + code + '」は既に登録されています。');
        return;
      }
    }
  }

  // 確認
  var targetLabels = { all: '全員', 'new': '新規限定', repeat: 'リピーター限定' };
  var label = type === 'rate' ? (Math.round(value * 100) + '%OFF')
            : type === 'fixed' ? (value + '円引き')
            : '送料無料';
  var summary =
    'コード: ' + code + '\n' +
    '割引: ' + label + '\n' +
    '有効開始日: ' + (startDate ? startDateStr : '即日') + '\n' +
    '有効期限: ' + (expires ? expiresStr : '無期限') + '\n' +
    '利用上限: ' + (maxUses > 0 ? maxUses + '回' : '無制限') + '\n' +
    '1人1回制限: ' + (oncePerUser ? 'あり' : 'なし') + '\n' +
    '対象顧客: ' + targetLabels[target] + '\n' +
    'メモ: ' + (memo || '(なし)');

  var confirm = ui.alert('クーポン登録 確認', summary + '\n\nこの内容で登録しますか？', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  // 書き込み
  var newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1, 1, 11).setValues([[code, type, value, expires, maxUses, 0, oncePerUser, true, memo, target, startDate]]);

  ui.alert('クーポン「' + code + '」（' + label + '）を登録しました。');
}

/**
 * クーポン削除（管理メニューから呼ばれる）
 */
function deleteCoupon() {
  var ui = SpreadsheetApp.getUi();
  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) { ui.alert('クーポン管理シートが見つかりません。'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { ui.alert('登録されているクーポンがありません。'); return; }

  // 一覧表示用データ取得
  var data = sh.getRange(2, 1, lastRow - 1, 11).getValues();
  var targetLabels = { all: '全員', 'new': '新規限定', repeat: 'リピーター限定' };
  var listText = '';
  for (var i = 0; i < data.length; i++) {
    var c = String(data[i][COUPON_COLS.CODE] || '').trim();
    if (!c) continue;
    var t = data[i][COUPON_COLS.TYPE];
    var v = data[i][COUPON_COLS.VALUE];
    var label = t === 'rate' ? (Math.round(Number(v) * 100) + '%OFF')
              : t === 'shipping_free' ? '送料無料'
              : (v + '円引き');
    var active = (data[i][COUPON_COLS.ACTIVE] === true || String(data[i][COUPON_COLS.ACTIVE]).toUpperCase() === 'TRUE');
    var uses = Number(data[i][COUPON_COLS.USE_COUNT]) || 0;
    var tgt = String(data[i][COUPON_COLS.TARGET] || '').trim().toLowerCase();
    var tgtLabel = targetLabels[tgt] || '全員';
    listText += c + ' (' + label + ') [利用:' + uses + '回] [' + tgtLabel + '] ' + (active ? '有効' : '無効') + '\n';
  }

  var res = ui.prompt('クーポン削除',
    '登録中のクーポン:\n' + listText + '\n削除するクーポンコードを入力してください:',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var targetCode = String(res.getResponseText() || '').trim().toUpperCase();
  if (!targetCode) { ui.alert('クーポンコードが空です。'); return; }

  // 該当行を検索
  var targetRow = -1;
  var targetUses = 0;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][COUPON_COLS.CODE] || '').trim().toUpperCase() === targetCode) {
      targetRow = j + 2;
      targetUses = Number(data[j][COUPON_COLS.USE_COUNT]) || 0;
      break;
    }
  }

  if (targetRow === -1) {
    ui.alert('クーポンコード「' + targetCode + '」が見つかりません。');
    return;
  }

  var warnText = '';
  if (targetUses > 0) {
    warnText = '\n※ このクーポンは ' + targetUses + '回利用されています。';
  }

  var confirm = ui.alert('クーポン削除 確認',
    'クーポン「' + targetCode + '」を削除します。' + warnText + '\nよろしいですか？',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  sh.deleteRow(targetRow);
  ui.alert('クーポン「' + targetCode + '」を削除しました。');
}

/**
 * クーポン登録API（フロントエンド管理画面から呼ばれる）
 * @param {string} adminKey - 管理者キー
 * @param {object} data - クーポンデータ
 */
function apiAdminRegisterCoupon(adminKey, data) {
  try {
    ad_requireAdmin_(adminKey);

    if (!data || typeof data !== 'object') return { ok: false, message: 'データが不正です' };

    var code = String(data.code || '').trim().toUpperCase();
    if (!code) return { ok: false, message: 'クーポンコードが空です' };
    if (!/^[A-Z0-9_-]+$/.test(code)) return { ok: false, message: 'コードは英数字・ハイフン・アンダースコアのみ使用可能です' };

    var type = String(data.type || '').toLowerCase();
    if (type !== 'rate' && type !== 'fixed' && type !== 'shipping_free') {
      return { ok: false, message: '割引タイプは rate / fixed / shipping_free のいずれかを指定してください' };
    }

    var value = 0;
    if (type === 'shipping_free') {
      value = 0;
    } else {
      value = Number(data.value);
      if (isNaN(value) || value <= 0) return { ok: false, message: '割引値は0より大きい数値を指定してください' };
      if (type === 'rate' && value >= 1) return { ok: false, message: 'rate の場合は小数で指定してください（例: 0.10 = 10%）' };
    }

    var expiresStr = String(data.expires || '').trim();
    var expires = '';
    if (expiresStr) {
      var d = new Date(expiresStr);
      if (isNaN(d.getTime())) return { ok: false, message: '有効期限の日付形式が正しくありません' };
      expires = d;
    }

    var maxUses = Number(data.maxUses) || 0;
    var oncePerUser = data.oncePerUser === true || String(data.oncePerUser).toLowerCase() === 'true';

    var targetInput = String(data.target || '').toLowerCase();
    var target = (targetInput === 'new' || targetInput === 'repeat') ? targetInput : 'all';

    var startDateStr = String(data.startDate || '').trim();
    var startDate = '';
    if (startDateStr) {
      var sd = new Date(startDateStr);
      if (isNaN(sd.getTime())) return { ok: false, message: '有効開始日の日付形式が正しくありません' };
      startDate = sd;
    }

    var memo = String(data.memo || '').trim();

    // 重複チェック
    var ss = sh_getOrderSs_();
    var sh = sh_ensureCouponSheet_(ss);
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var existing = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < existing.length; i++) {
        if (String(existing[i][0] || '').trim().toUpperCase() === code) {
          return { ok: false, message: 'クーポンコード「' + code + '」は既に登録されています' };
        }
      }
    }

    // 書き込み
    var newRow = sh.getLastRow() + 1;
    sh.getRange(newRow, 1, 1, 11).setValues([[code, type, value, expires, maxUses, 0, oncePerUser, true, memo, target, startDate]]);

    var label = type === 'rate' ? (Math.round(value * 100) + '%OFF')
              : type === 'fixed' ? (value + '円引き')
              : '送料無料';

    return { ok: true, code: code, label: label };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

// =====================================================
// フロントエンドAPI
// =====================================================

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
    var label = result.type === 'rate'
      ? (Math.round(result.value * 100) + '%OFF')
      : result.type === 'shipping_free'
        ? '送料無料'
        : (result.value + '円引き');
    return {
      ok: true,
      type: result.type,
      value: result.value,
      discountAmount: discountAmount,
      freeShipping: result.type === 'shipping_free',
      label: label
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

  var data = sh.getRange(2, 1, lastRow - 1, 11).getValues();
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

  // 有効開始日チェック
  var startDate = coupon[COUPON_COLS.START_DATE];
  if (startDate) {
    var sDate = (startDate instanceof Date) ? startDate : new Date(startDate);
    if (!isNaN(sDate.getTime())) {
      sDate.setHours(0, 0, 0, 0);
      var now = new Date();
      now.setHours(0, 0, 0, 0);
      if (now < sDate) {
        return { ok: false, message: 'このクーポンはまだ利用期間前です' };
      }
    }
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

  // 対象顧客チェック（new=新規限定 / repeat=リピーター限定）
  var target = String(coupon[COUPON_COLS.TARGET] || '').trim().toLowerCase();
  if (target === 'new' || target === 'repeat') {
    var orders = email ? getOrderHistory_(email) : [];
    var hasOrders = orders.length > 0;
    if (target === 'new' && hasOrders) {
      return { ok: false, message: 'このクーポンは初回注文のお客様限定です' };
    }
    if (target === 'repeat' && !hasOrders) {
      return { ok: false, message: 'このクーポンはリピーターのお客様限定です' };
    }
  }

  var type = String(coupon[COUPON_COLS.TYPE] || 'rate').trim().toLowerCase();
  var value = Number(coupon[COUPON_COLS.VALUE]) || 0;

  if (type !== 'rate' && type !== 'fixed' && type !== 'shipping_free') {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }
  if (type !== 'shipping_free' && value <= 0) {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }

  return { ok: true, type: type, value: value, row: couponRow };
}

/**
 * クーポン割引額を計算
 */
function calcCouponDiscount_(type, value, productAmount) {
  if (type === 'shipping_free') {
    return 0; // 商品割引なし（送料はSubmitFix側で0にする）
  } else if (type === 'rate') {
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
