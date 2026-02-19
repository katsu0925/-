// =====================================================
// クーポン管理
// =====================================================
// クーポン管理シート列構成:
// A=クーポンコード, B=割引タイプ(rate/fixed), C=割引値, D=有効期限,
// E=利用上限, F=利用回数, G=1人1回制限(TRUE/FALSE), H=有効(TRUE/FALSE), I=メモ,
// J=対象顧客(all/new/repeat), K=有効開始日, L=会員割引併用(TRUE/FALSE), M=30点割引併用(TRUE/FALSE),
// N=適用チャネル(all/detauri/bulk), O=対象商品ID(まとめ商品用、カンマ区切り)

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
  START_DATE: 10, // K: 有効開始日
  COMBO_MEMBER: 11, // L: 会員割引との併用 (TRUE/FALSE)
  COMBO_BULK: 12,   // M: 30点割引との併用 (TRUE/FALSE)
  CHANNEL: 13,      // N: 適用チャネル (all=全て / detauri=デタウリのみ / bulk=まとめ商品のみ)
  TARGET_PRODUCTS: 14 // O: 対象商品ID (まとめ商品用、カンマ区切り。空=全商品)
};

var COUPON_COL_COUNT = 15;

// クーポン利用履歴シート列構成:
// A=クーポンコード, B=メールアドレス, C=受付番号, D=利用日時
var COUPON_LOG_SHEET_NAME = 'クーポン利用履歴';

/**
 * クーポン管理シートを確保
 */
function sh_ensureCouponSheet_(ss) {
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(COUPON_SHEET_NAME);
  var header = ['クーポンコード', '割引タイプ', '割引値', '有効期限', '利用上限', '利用回数', '1人1回制限', '有効', 'メモ', '対象顧客', '有効開始日', '会員割引併用', '30点割引併用', '適用チャネル', '対象商品ID'];
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
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'クーポン登録');
}

/**
 * 登録ダイアログ用: 既存クーポン一覧を取得（複製用）
 */
function getCouponListForDuplicate() {
  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var c = String(data[i][COUPON_COLS.CODE] || '').trim();
    if (!c) continue;
    var t = String(data[i][COUPON_COLS.TYPE] || '').trim().toLowerCase();
    var v = Number(data[i][COUPON_COLS.VALUE]) || 0;
    var displayValue = (t === 'rate') ? Math.round(v * 100) : v;
    var label = t === 'rate' ? (displayValue + '%OFF')
              : t === 'shipping_free' ? '送料無料'
              : (v + '円引き');

    var expires = data[i][COUPON_COLS.EXPIRES];
    var expiresStr = '';
    if (expires instanceof Date && !isNaN(expires.getTime())) {
      expiresStr = Utilities.formatDate(expires, 'Asia/Tokyo', 'yyyy-MM-dd');
    }

    var startDate = data[i][COUPON_COLS.START_DATE];
    var startDateStr = '';
    if (startDate instanceof Date && !isNaN(startDate.getTime())) {
      startDateStr = Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    }

    list.push({
      code: c,
      type: t,
      value: displayValue,
      label: label,
      target: String(data[i][COUPON_COLS.TARGET] || 'all').trim().toLowerCase(),
      oncePerUser: String(data[i][COUPON_COLS.ONCE_PER_USER]),
      maxUses: Number(data[i][COUPON_COLS.MAX_USES]) || 0,
      startDate: startDateStr,
      expires: expiresStr,
      memo: String(data[i][COUPON_COLS.MEMO] || ''),
      comboMember: (data[i][COUPON_COLS.COMBO_MEMBER] === true || String(data[i][COUPON_COLS.COMBO_MEMBER]).toUpperCase() === 'TRUE'),
      comboBulk: (data[i][COUPON_COLS.COMBO_BULK] === true || String(data[i][COUPON_COLS.COMBO_BULK]).toUpperCase() === 'TRUE'),
      channel: String(data[i][COUPON_COLS.CHANNEL] || 'all').trim().toLowerCase(),
      targetProducts: String(data[i][COUPON_COLS.TARGET_PRODUCTS] || '').trim()
    });
  }
  return list;
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

  var comboMember = data.comboMember === true || String(data.comboMember) === 'true';
  var comboBulk = data.comboBulk === true || String(data.comboBulk) === 'true';

  var channelInput = String(data.channel || '').toLowerCase();
  var channel = (channelInput === 'detauri' || channelInput === 'bulk') ? channelInput : 'all';

  var targetProducts = String(data.targetProducts || '').trim();

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
  sh.getRange(newRow, 1, 1, COUPON_COL_COUNT).setValues([[code, type, value, expires, maxUses, 0, oncePerUser, true, memo, target, startDate, comboMember, comboBulk, channel, targetProducts]]);

  // クーポンキャッシュを無効化（即時反映）
  try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) { console.log('optional: coupon cache invalidation: ' + (e.message || e)); }

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
    + '.dup-section{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;margin-bottom:12px;}'
    + '.dup-section label{color:#0369a1;}'
    + '</style>'

    + '<div class="dup-section">'
    + '  <label>既存クーポンから複製</label>'
    + '  <select id="duplicateFrom" onchange="onDuplicate()">'
    + '    <option value="">-- 新規作成 --</option>'
    + '  </select>'
    + '  <div class="hint">選択すると設定値がコピーされます（コードは変更してください）</div>'
    + '</div>'

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

    + '<div class="row">'
    + '<div class="col">'
    + '  <label>会員割引との併用</label>'
    + '  <select id="comboMember">'
    + '    <option value="false">不可</option>'
    + '    <option value="true">可</option>'
    + '  </select>'
    + '  <div class="hint">クーポンと会員割引(10%OFF)の併用</div>'
    + '</div>'
    + '<div class="col">'
    + '  <label>30点割引との併用</label>'
    + '  <select id="comboBulk">'
    + '    <option value="false">不可</option>'
    + '    <option value="true">可</option>'
    + '  </select>'
    + '  <div class="hint">クーポンと30点以上割引(10%OFF)の併用</div>'
    + '</div>'
    + '</div>'

    + '<div class="row">'
    + '<div class="col">'
    + '  <label>適用チャネル</label>'
    + '  <select id="channel" onchange="onChannelChange()">'
    + '    <option value="all">全て（デタウリ＋まとめ）</option>'
    + '    <option value="detauri">デタウリのみ</option>'
    + '    <option value="bulk">まとめ商品のみ</option>'
    + '  </select>'
    + '  <div class="hint">クーポンが使えるサイト</div>'
    + '</div>'
    + '<div class="col" id="targetProductsCol" style="display:none;">'
    + '  <label>対象商品ID</label>'
    + '  <input id="targetProducts" placeholder="BLK-XXXX,BLK-YYYY">'
    + '  <div class="hint">空欄＝全まとめ商品、カンマ区切りでID指定</div>'
    + '</div>'
    + '</div>'

    + '<div class="error" id="error"></div>'
    + '<div class="footer">'
    + '  <button class="btn" onclick="google.script.host.close()">キャンセル</button>'
    + '  <button class="btn primary" id="submitBtn" onclick="submit()">登録する</button>'
    + '</div>'

    + '<script>'
    + 'var dupList=[];'
    + 'function initDuplicate(){'
    + '  google.script.run'
    + '    .withSuccessHandler(function(list){'
    + '      dupList=list||[];'
    + '      var sel=document.getElementById("duplicateFrom");'
    + '      for(var i=0;i<dupList.length;i++){'
    + '        var c=dupList[i];'
    + '        var opt=document.createElement("option");'
    + '        opt.value=c.code;'
    + '        opt.textContent=c.code+" ("+c.label+")";'
    + '        sel.appendChild(opt);'
    + '      }'
    + '    })'
    + '    .withFailureHandler(function(){})'
    + '    .getCouponListForDuplicate();'
    + '}'
    + 'function onDuplicate(){'
    + '  var code=document.getElementById("duplicateFrom").value;'
    + '  if(!code)return;'
    + '  var c=null;'
    + '  for(var i=0;i<dupList.length;i++){if(dupList[i].code===code){c=dupList[i];break;}}'
    + '  if(!c)return;'
    + '  document.getElementById("code").value=c.code+"_COPY";'
    + '  document.getElementById("type").value=c.type;'
    + '  onTypeChange();'
    + '  if(c.type!=="shipping_free")document.getElementById("value").value=c.value;'
    + '  document.getElementById("target").value=c.target;'
    + '  document.getElementById("oncePerUser").value=c.oncePerUser.toLowerCase()==="true"?"true":"false";'
    + '  var maxSel=document.getElementById("maxUses");'
    + '  var maxVal=String(c.maxUses);'
    + '  var found=false;'
    + '  for(var j=0;j<maxSel.options.length;j++){if(maxSel.options[j].value===maxVal){maxSel.value=maxVal;found=true;break;}}'
    + '  if(!found)maxSel.value="0";'
    + '  document.getElementById("startDate").value=c.startDate||"";'
    + '  document.getElementById("expires").value=c.expires||"";'
    + '  document.getElementById("memo").value=c.memo||"";'
    + '  document.getElementById("comboMember").value=c.comboMember?"true":"false";'
    + '  document.getElementById("comboBulk").value=c.comboBulk?"true":"false";'
    + '  document.getElementById("channel").value=c.channel||"all";'
    + '  onChannelChange();'
    + '  document.getElementById("targetProducts").value=c.targetProducts||"";'
    + '  document.getElementById("code").focus();'
    + '  document.getElementById("code").select();'
    + '}'
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
    + 'function onChannelChange(){'
    + '  var ch=document.getElementById("channel").value;'
    + '  document.getElementById("targetProductsCol").style.display=(ch==="bulk")?"":"none";'
    + '  if(ch!=="bulk")document.getElementById("targetProducts").value="";'
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
    + '    memo:document.getElementById("memo").value,'
    + '    comboMember:document.getElementById("comboMember").value,'
    + '    comboBulk:document.getElementById("comboBulk").value,'
    + '    channel:document.getElementById("channel").value,'
    + '    targetProducts:document.getElementById("targetProducts").value'
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
    + 'initDuplicate();'
    + '</script>';
}

/**
 * クーポン削除（管理メニューから呼ばれる — HTMLダイアログ版）
 */
function deleteCoupon() {
  var ui = SpreadsheetApp.getUi();
  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) { ui.alert('クーポン管理シートが見つかりません。'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { ui.alert('登録されているクーポンがありません。'); return; }

  var html = HtmlService.createHtmlOutput(getDeleteCouponDialogHtml_())
    .setWidth(480)
    .setHeight(360);
  ui.showModalDialog(html, 'クーポン削除');
}

/**
 * 削除ダイアログ用: クーポン一覧を取得
 */
function getDeleteCouponList() {
  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
  var targetLabels = { all: '全員', 'new': '新規限定', repeat: 'リピーター限定' };
  var list = [];
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
    list.push({
      code: c,
      label: label,
      uses: uses,
      target: tgtLabel,
      active: active
    });
  }
  return list;
}

/**
 * 削除ダイアログから呼ばれる削除処理
 */
function deleteCouponFromDialog(code) {
  if (!code) return { ok: false, message: 'クーポンコードが選択されていません' };
  code = String(code).trim().toUpperCase();

  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) return { ok: false, message: 'クーポン管理シートが見つかりません' };

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, message: '登録されているクーポンがありません' };

  var data = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
  var targetRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][COUPON_COLS.CODE] || '').trim().toUpperCase() === code) {
      targetRow = j + 2;
      break;
    }
  }

  if (targetRow === -1) return { ok: false, message: 'クーポンコード「' + code + '」が見つかりません' };

  sh.deleteRow(targetRow);

  // クーポンキャッシュを無効化（即時反映）
  try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) { console.log('optional: coupon cache invalidation: ' + (e.message || e)); }

  return { ok: true, message: 'クーポン「' + code + '」を削除しました' };
}

/**
 * クーポン削除ダイアログのHTML
 */
function getDeleteCouponDialogHtml_() {
  return '<style>'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;font-size:13px;margin:0;padding:16px;color:#333;}'
    + 'label{display:block;font-weight:700;margin-bottom:4px;font-size:12px;color:#555;}'
    + 'select{width:100%;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;box-sizing:border-box;outline:none;}'
    + 'select:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.15);}'
    + '.info{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-top:12px;font-size:12px;color:#555;line-height:1.6;display:none;}'
    + '.info .warn{color:#dc2626;font-weight:700;}'
    + '.btn{padding:8px 18px;border:1px solid #d0d5dd;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;background:#fff;}'
    + '.btn.danger{background:#dc2626;color:#fff;border-color:#dc2626;}'
    + '.btn.danger:hover{background:#b91c1c;}'
    + '.btn:disabled{opacity:.5;cursor:not-allowed;}'
    + '.error{color:#dc2626;font-size:12px;margin-top:8px;display:none;}'
    + '.footer{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}'
    + '</style>'

    + '<div>'
    + '  <label>削除するクーポンを選択 *</label>'
    + '  <select id="couponSelect" onchange="onSelect()">'
    + '    <option value="">-- クーポンを選択してください --</option>'
    + '  </select>'
    + '</div>'

    + '<div class="info" id="info"></div>'

    + '<div class="error" id="error"></div>'
    + '<div class="footer">'
    + '  <button class="btn" onclick="google.script.host.close()">キャンセル</button>'
    + '  <button class="btn danger" id="deleteBtn" onclick="doDelete()" disabled>削除する</button>'
    + '</div>'

    + '<script>'
    + 'var couponList=[];'
    + 'function init(){'
    + '  google.script.run'
    + '    .withSuccessHandler(function(list){'
    + '      couponList=list||[];'
    + '      var sel=document.getElementById("couponSelect");'
    + '      for(var i=0;i<couponList.length;i++){'
    + '        var c=couponList[i];'
    + '        var opt=document.createElement("option");'
    + '        opt.value=c.code;'
    + '        opt.textContent=c.code+" ("+c.label+") [利用:"+c.uses+"回] ["+c.target+"] "+(c.active?"有効":"無効");'
    + '        sel.appendChild(opt);'
    + '      }'
    + '    })'
    + '    .withFailureHandler(function(e){showError(e&&e.message?e.message:"一覧の取得に失敗しました");})'
    + '    .getDeleteCouponList();'
    + '}'
    + 'function onSelect(){'
    + '  var code=document.getElementById("couponSelect").value;'
    + '  var info=document.getElementById("info");'
    + '  var btn=document.getElementById("deleteBtn");'
    + '  if(!code){info.style.display="none";btn.disabled=true;return;}'
    + '  var c=null;'
    + '  for(var i=0;i<couponList.length;i++){if(couponList[i].code===code){c=couponList[i];break;}}'
    + '  if(!c){info.style.display="none";btn.disabled=true;return;}'
    + '  var html="コード: <b>"+c.code+"</b><br>"'
    + '    +"割引: <b>"+c.label+"</b><br>"'
    + '    +"状態: "+(c.active?"有効":"無効")+"<br>"'
    + '    +"利用回数: "+c.uses+"回<br>"'
    + '    +"対象: "+c.target;'
    + '  if(c.uses>0) html+="<br><span class=\\"warn\\">※ このクーポンは "+c.uses+"回利用されています</span>";'
    + '  info.innerHTML=html;info.style.display="block";'
    + '  btn.disabled=false;'
    + '}'
    + 'function showError(msg){var e=document.getElementById("error");e.textContent=msg;e.style.display="block";}'
    + 'function doDelete(){'
    + '  var code=document.getElementById("couponSelect").value;'
    + '  if(!code){showError("クーポンを選択してください");return;}'
    + '  if(!confirm("クーポン「"+code+"」を削除します。\\nよろしいですか？"))return;'
    + '  document.getElementById("error").style.display="none";'
    + '  var btn=document.getElementById("deleteBtn");'
    + '  btn.disabled=true;btn.textContent="削除中...";'
    + '  google.script.run'
    + '    .withSuccessHandler(function(r){'
    + '      if(r&&r.ok){alert(r.message);google.script.host.close();}'
    + '      else{showError(r&&r.message?r.message:"削除に失敗しました");btn.disabled=false;btn.textContent="削除する";}'
    + '    })'
    + '    .withFailureHandler(function(e){'
    + '      showError(e&&e.message?e.message:"エラーが発生しました");btn.disabled=false;btn.textContent="削除する";'
    + '    })'
    + '    .deleteCouponFromDialog(code);'
    + '}'
    + 'init();'
    + '</script>';
}

// =====================================================
// フロントエンドAPI
// =====================================================

/**
 * クーポンコードを検証（API用: フロントエンドから呼ばれる）
 * @param {string} code - クーポンコード
 * @param {string} email - 利用者のメールアドレス
 * @param {number} productAmount - 商品代金（割引前）
 * @param {string} [channel] - 注文チャネル ('detauri' | 'bulk')
 * @param {string[]} [productIds] - まとめ商品の場合、カート内の商品IDリスト
 * @returns {object} { ok, type, value, discountAmount, message }
 */
function apiValidateCoupon(code, email, productAmount, channel, productIds) {
  try {
    var result = validateCoupon_(code, email, channel, productIds);
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
      label: label,
      comboMember: result.comboMember || false,
      comboBulk: result.comboBulk || false
    };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/**
 * クーポンデータをキャッシュ付きで取得（60秒TTL）
 * シートの全行読み取りを毎回行わず、短期間キャッシュで高速化
 */
var COUPON_CACHE_KEY = 'COUPON_DATA_ALL';
var COUPON_CACHE_TTL = 60; // 秒

function getCouponDataCached_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(COUPON_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  var ss = sh_getOrderSs_();
  var sh = ss.getSheetByName(COUPON_SHEET_NAME);
  if (!sh) return null;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var data = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
  // シリアライズ可能な形式に変換
  var items = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var expires = row[COUPON_COLS.EXPIRES];
    var expiresStr = '';
    if (expires instanceof Date && !isNaN(expires.getTime())) {
      expiresStr = expires.toISOString();
    }
    var startDate = row[COUPON_COLS.START_DATE];
    var startDateStr = '';
    if (startDate instanceof Date && !isNaN(startDate.getTime())) {
      startDateStr = startDate.toISOString();
    }
    items.push({
      code: String(row[COUPON_COLS.CODE] || '').trim().toUpperCase(),
      type: String(row[COUPON_COLS.TYPE] || '').trim().toLowerCase(),
      value: Number(row[COUPON_COLS.VALUE]) || 0,
      expires: expiresStr,
      maxUses: Number(row[COUPON_COLS.MAX_USES]) || 0,
      useCount: Number(row[COUPON_COLS.USE_COUNT]) || 0,
      oncePerUser: (row[COUPON_COLS.ONCE_PER_USER] === true || String(row[COUPON_COLS.ONCE_PER_USER]).toUpperCase() === 'TRUE'),
      active: (row[COUPON_COLS.ACTIVE] === true || String(row[COUPON_COLS.ACTIVE]).toUpperCase() === 'TRUE'),
      target: String(row[COUPON_COLS.TARGET] || '').trim().toLowerCase(),
      startDate: startDateStr,
      comboMember: (row[COUPON_COLS.COMBO_MEMBER] === true || String(row[COUPON_COLS.COMBO_MEMBER]).toUpperCase() === 'TRUE'),
      comboBulk: (row[COUPON_COLS.COMBO_BULK] === true || String(row[COUPON_COLS.COMBO_BULK]).toUpperCase() === 'TRUE'),
      channel: String(row[COUPON_COLS.CHANNEL] || 'all').trim().toLowerCase(),
      targetProducts: String(row[COUPON_COLS.TARGET_PRODUCTS] || '').trim(),
      rowIndex: i + 2
    });
  }

  try {
    cache.put(COUPON_CACHE_KEY, JSON.stringify(items), COUPON_CACHE_TTL);
  } catch (e) {
    console.log('クーポンキャッシュ保存エラー:', e);
  }
  return items;
}

/**
 * クーポンを検証（内部関数）
 * @param {string} code - クーポンコード
 * @param {string} email - 利用者のメールアドレス
 * @param {string} [channel] - 注文チャネル ('detauri' | 'bulk')。省略時はチャネルチェックをスキップ
 * @param {string[]} [productIds] - まとめ商品の場合、カート内の商品IDリスト
 */
function validateCoupon_(code, email, channel, productIds) {
  if (!code) return { ok: false, message: 'クーポンコードを入力してください' };
  code = String(code).trim().toUpperCase();

  var items = getCouponDataCached_();
  if (!items || items.length === 0) return { ok: false, message: '無効なクーポンコードです' };

  var coupon = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].code === code) {
      coupon = items[i];
      break;
    }
  }

  if (!coupon) return { ok: false, message: '無効なクーポンコードです' };

  // 有効チェック
  if (!coupon.active) {
    return { ok: false, message: 'このクーポンは現在無効です' };
  }

  // 適用チャネルチェック
  var couponChannel = coupon.channel || 'all';
  if (channel && couponChannel !== 'all') {
    if (couponChannel !== channel) {
      var channelLabel = couponChannel === 'detauri' ? 'デタウリ' : 'まとめ商品';
      return { ok: false, message: 'このクーポンは' + channelLabel + '専用です' };
    }
  }

  // まとめ商品の対象商品IDチェック
  if (channel === 'bulk' && coupon.targetProducts) {
    var allowedIds = coupon.targetProducts.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(function(s) { return s; });
    if (allowedIds.length > 0 && productIds && productIds.length > 0) {
      var hasMatch = false;
      for (var pi = 0; pi < productIds.length; pi++) {
        var pid = String(productIds[pi]).trim().toUpperCase();
        for (var ai = 0; ai < allowedIds.length; ai++) {
          if (pid === allowedIds[ai]) { hasMatch = true; break; }
        }
        if (hasMatch) break;
      }
      if (!hasMatch) {
        return { ok: false, message: 'このクーポンはカート内の商品に適用できません' };
      }
    }
  }

  // 有効開始日チェック
  if (coupon.startDate) {
    var sDate = new Date(coupon.startDate);
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
  if (coupon.expires) {
    var expDate = new Date(coupon.expires);
    if (!isNaN(expDate.getTime())) {
      expDate.setHours(23, 59, 59, 999);
      if (new Date() > expDate) {
        return { ok: false, message: 'このクーポンは期限切れです' };
      }
    }
  }

  // 利用上限チェック
  if (coupon.maxUses > 0 && coupon.useCount >= coupon.maxUses) {
    return { ok: false, message: 'このクーポンは利用上限に達しました' };
  }

  // 1人1回制限チェック
  if (coupon.oncePerUser) {
    if (email) {
      var ss = sh_getOrderSs_();
      if (hasUserUsedCoupon_(ss, code, email)) {
        return { ok: false, message: 'このクーポンは既にご利用済みです' };
      }
    }
  }

  // 対象顧客チェック（new=新規限定 / repeat=リピーター限定）
  if (coupon.target === 'new' || coupon.target === 'repeat') {
    var orders = email ? getOrderHistory_(email) : [];
    var hasOrders = orders.length > 0;
    if (coupon.target === 'new' && hasOrders) {
      return { ok: false, message: 'このクーポンは初回注文のお客様限定です' };
    }
    if (coupon.target === 'repeat' && !hasOrders) {
      return { ok: false, message: 'このクーポンはリピーターのお客様限定です' };
    }
  }

  var type = coupon.type || 'rate';
  var value = coupon.value || 0;

  if (type !== 'rate' && type !== 'fixed' && type !== 'shipping_free') {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }
  if (type !== 'shipping_free' && value <= 0) {
    return { ok: false, message: 'クーポン設定にエラーがあります' };
  }

  return { ok: true, type: type, value: value, row: coupon.rowIndex, comboMember: coupon.comboMember, comboBulk: coupon.comboBulk };
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
          // クーポンキャッシュを無効化（利用回数更新を即時反映）
          try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e2) { console.log('optional: coupon cache invalidation: ' + (e2.message || e2)); }
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
