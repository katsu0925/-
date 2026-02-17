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
 * クーポン登録（管理メニューから呼ばれる — HTMLダイアログ版）
 */
function registerCoupon() {
  var html = HtmlService.createHtmlOutput(getCouponDialogHtml_())
    .setWidth(480)
    .setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(html, 'クーポン登録');
}

/**
 * HTMLダイアログから呼ばれるクーポン登録処理
 */
function registerCouponFromDialog(data) {
  if (!data || typeof data !== 'object') return { ok: false, message: 'データが不正です' };

  var code = String(data.code || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'クーポンコードを入力してください' };
  if (!/^[A-Z0-9_-]+$/.test(code)) return { ok: false, message: 'コードは英数字・ハイフン・アンダースコアのみ使用可能です' };

  var type = String(data.type || '').toLowerCase();
  if (type !== 'rate' && type !== 'fixed' && type !== 'shipping_free') {
    return { ok: false, message: '割引タイプを選択してください' };
  }

  var value = 0;
  if (type === 'shipping_free') {
    value = 0;
  } else if (type === 'rate') {
    var pct = Number(data.value);
    if (isNaN(pct) || pct < 1 || pct > 99) return { ok: false, message: '割引率は1〜99で入力してください' };
    value = pct / 100;
  } else {
    value = Number(data.value);
    if (isNaN(value) || value <= 0) return { ok: false, message: '割引金額は1以上で入力してください' };
  }

  var expiresStr = String(data.expires || '').trim();
  var expires = '';
  if (expiresStr) {
    var d = new Date(expiresStr);
    if (isNaN(d.getTime())) return { ok: false, message: '有効期限の日付が不正です' };
    expires = d;
  }

  var maxUses = Number(data.maxUses) || 0;
  var oncePerUser = data.oncePerUser === true || String(data.oncePerUser) === 'true';

  var targetInput = String(data.target || '').toLowerCase();
  var target = (targetInput === 'new' || targetInput === 'repeat') ? targetInput : 'all';

  var startDateStr = String(data.startDate || '').trim();
  var startDate = '';
  if (startDateStr) {
    var sd = new Date(startDateStr);
    if (isNaN(sd.getTime())) return { ok: false, message: '有効開始日の日付が不正です' };
    startDate = sd;
  }

  if (startDateStr && expiresStr && startDateStr > expiresStr) {
    return { ok: false, message: '開始日が有効期限より後になっています' };
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

  return { ok: true, message: 'クーポン「' + code + '」（' + label + '）を登録しました' };
}

/**
 * クーポン登録ダイアログのHTML
 */
function getCouponDialogHtml_() {
  return '<style>'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;font-size:13px;margin:0;padding:16px;color:#333;}'
    + 'label{display:block;font-weight:700;margin-bottom:4px;font-size:12px;color:#555;}'
    + 'input,select,textarea{width:100%;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;box-sizing:border-box;outline:none;}'
    + 'input:focus,select:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.15);}'
    + '.row{display:flex;gap:10px;margin-bottom:10px;}'
    + '.col{flex:1;}'
    + '.hint{font-size:11px;color:#888;margin-top:2px;}'
    + '.btn{padding:8px 18px;border:1px solid #d0d5dd;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;background:#fff;}'
    + '.btn.primary{background:#3b82f6;color:#fff;border-color:#3b82f6;}'
    + '.btn.primary:hover{background:#2563eb;}'
    + '.btn:disabled{opacity:.5;cursor:not-allowed;}'
    + '.error{color:#dc2626;font-size:12px;margin-top:8px;display:none;}'
    + '.footer{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}'
    + '</style>'

    + '<div class="row"><div class="col">'
    + '  <label>クーポンコード *</label>'
    + '  <input id="code" placeholder="例: SUMMER10" style="text-transform:uppercase;">'
    + '</div></div>'

    + '<div class="row">'
    + '<div class="col">'
    + '  <label>割引タイプ *</label>'
    + '  <select id="type" onchange="onTypeChange()">'
    + '    <option value="rate">割引率（%OFF）</option>'
    + '    <option value="fixed">固定額引き（円）</option>'
    + '    <option value="shipping_free">送料無料</option>'
    + '  </select>'
    + '</div>'
    + '<div class="col" id="valueCol">'
    + '  <label id="valueLabel">割引率 *</label>'
    + '  <input id="value" type="number" min="0" placeholder="10">'
    + '  <div class="hint" id="valueHint">1〜99 の数字で入力</div>'
    + '</div>'
    + '</div>'

    + '<div class="row">'
    + '<div class="col">'
    + '  <label>対象顧客</label>'
    + '  <select id="target">'
    + '    <option value="all">全員</option>'
    + '    <option value="new">新規限定</option>'
    + '    <option value="repeat">リピーター限定</option>'
    + '  </select>'
    + '</div>'
    + '<div class="col">'
    + '  <label>1人1回制限</label>'
    + '  <select id="oncePerUser">'
    + '    <option value="true">あり</option>'
    + '    <option value="false">なし</option>'
    + '  </select>'
    + '</div>'
    + '</div>'

    + '<div class="row">'
    + '<div class="col">'
    + '  <label>利用上限</label>'
    + '  <select id="maxUses">'
    + '    <option value="0">無制限</option>'
    + '    <option value="1">1回</option>'
    + '    <option value="5">5回</option>'
    + '    <option value="10">10回</option>'
    + '    <option value="20">20回</option>'
    + '    <option value="50">50回</option>'
    + '    <option value="100">100回</option>'
    + '  </select>'
    + '</div>'
    + '<div class="col">'
    + '  <label>有効開始日</label>'
    + '  <input id="startDate" type="date">'
    + '  <div class="hint">空欄＝即日から</div>'
    + '</div>'
    + '</div>'

    + '<div class="row"><div class="col">'
    + '  <label>有効期限</label>'
    + '  <input id="expires" type="date">'
    + '  <div class="hint">空欄＝無期限</div>'
    + '</div>'
    + '<div class="col">'
    + '  <label>メモ</label>'
    + '  <input id="memo" placeholder="管理用メモ">'
    + '</div></div>'

    + '<div class="error" id="error"></div>'
    + '<div class="footer">'
    + '  <button class="btn" onclick="google.script.host.close()">キャンセル</button>'
    + '  <button class="btn primary" id="submitBtn" onclick="submit()">登録する</button>'
    + '</div>'

    + '<script>'
    + 'function onTypeChange(){'
    + '  var t=document.getElementById("type").value;'
    + '  var vc=document.getElementById("valueCol");'
    + '  if(t==="shipping_free"){vc.style.display="none";return;}'
    + '  vc.style.display="";'
    + '  if(t==="rate"){'
    + '    document.getElementById("valueLabel").textContent="割引率 *";'
    + '    document.getElementById("value").placeholder="10";'
    + '    document.getElementById("valueHint").textContent="1〜99 の数字で入力";'
    + '  }else{'
    + '    document.getElementById("valueLabel").textContent="割引金額 *";'
    + '    document.getElementById("value").placeholder="500";'
    + '    document.getElementById("valueHint").textContent="1円以上の金額を入力";'
    + '  }'
    + '}'
    + 'function showError(msg){var e=document.getElementById("error");e.textContent=msg;e.style.display="block";}'
    + 'function submit(){'
    + '  document.getElementById("error").style.display="none";'
    + '  var btn=document.getElementById("submitBtn");'
    + '  btn.disabled=true;btn.textContent="登録中...";'
    + '  var data={'
    + '    code:document.getElementById("code").value,'
    + '    type:document.getElementById("type").value,'
    + '    value:document.getElementById("value").value,'
    + '    target:document.getElementById("target").value,'
    + '    oncePerUser:document.getElementById("oncePerUser").value,'
    + '    maxUses:document.getElementById("maxUses").value,'
    + '    startDate:document.getElementById("startDate").value,'
    + '    expires:document.getElementById("expires").value,'
    + '    memo:document.getElementById("memo").value'
    + '  };'
    + '  google.script.run'
    + '    .withSuccessHandler(function(r){'
    + '      if(r&&r.ok){alert(r.message);google.script.host.close();}'
    + '      else{showError(r&&r.message?r.message:"登録に失敗しました");btn.disabled=false;btn.textContent="登録する";}'
    + '    })'
    + '    .withFailureHandler(function(e){'
    + '      showError(e&&e.message?e.message:"エラーが発生しました");btn.disabled=false;btn.textContent="登録する";'
    + '    })'
    + '    .registerCouponFromDialog(data);'
    + '}'
    + '</script>';
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
