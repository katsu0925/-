// StaffApi.gs — スタッフ用Web App API（採寸入力 + 販売情報入力）
// AppSheet移行のため作成（2026-04-26）

// ========== 設定 ==========

var STAFF_SHEET_NAME = '商品管理';

// 商品管理シートの列番号（1-indexed）
var STAFF_COL = {
  商品ID: 1,
  仕入れID: 2,
  作業者名: 3,
  区分コード: 4,
  ステータス: 5,
  管理番号: 6,
  状態: 7,
  ブランド: 8,
  メルカリサイズ: 9,
  カラー: 17,
  // 採寸（21-32）
  着丈: 21,
  肩幅: 22,
  身幅: 23,
  袖丈: 24,
  裄丈: 25,
  総丈: 26,
  ウエスト: 27,
  股上: 28,
  股下: 29,
  ワタリ: 30,
  裾幅: 31,
  ヒップ: 32,
  採寸日: 33,
  採寸者: 34,
  // 販売（42-46, 65）
  販売日: 42,
  販売場所: 43,
  販売価格: 44,
  送料: 45,
  手数料: 46,
  販売日タイムスタンプ: 65
};

var MEASURE_FIELDS = ['着丈','肩幅','身幅','袖丈','裄丈','総丈','ウエスト','股上','股下','ワタリ','裾幅','ヒップ'];

// ========== 認証 ==========

function staff_currentUser() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  if (!email) {
    try { email = Session.getEffectiveUser().getEmail() || ''; } catch(e) {}
  }
  var allowed = staff_isWhitelisted_(email);
  return { ok: true, email: email, allowed: allowed };
}

function staff_isWhitelisted_(email) {
  if (!email) return false;
  try {
    // 1) 作業者マスター シートから自動取得（メール列があれば）
    var fromSheet = staff_getWhitelistFromMaster_();
    if (fromSheet.length) {
      return fromSheet.indexOf(String(email).toLowerCase()) >= 0;
    }
    // 2) ScriptProperty STAFF_WHITELIST フォールバック
    var raw = PropertiesService.getScriptProperties().getProperty('STAFF_WHITELIST') || '';
    if (!raw) return true; // 未設定時は全許可（初期セットアップ時のフォールバック）
    var list = raw.split(/[\s,;\n]+/).map(function(s){ return String(s||'').trim().toLowerCase(); }).filter(Boolean);
    return list.indexOf(String(email).toLowerCase()) >= 0;
  } catch(e) { return false; }
}

function staff_getWhitelistFromMaster_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
      if (!ssId) return [];
      ss = SpreadsheetApp.openById(ssId);
    }
    var sh = ss.getSheetByName('作業者マスター');
    if (!sh) return [];
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v||''); });
    // メール系の列を探す（メール / Email / mail / アドレス）
    var emailColIdx = -1;
    for (var i = 0; i < hdr.length; i++) {
      var h = hdr[i].toLowerCase();
      if (h.indexOf('mail') >= 0 || hdr[i].indexOf('メール') >= 0 || hdr[i].indexOf('アドレス') >= 0) {
        emailColIdx = i; break;
      }
    }
    if (emailColIdx < 0) return [];
    var col = sh.getRange(2, emailColIdx + 1, lastRow - 1, 1).getValues();
    var out = [];
    for (var r = 0; r < col.length; r++) {
      var v = String(col[r][0] || '').trim().toLowerCase();
      if (v && v.indexOf('@') > 0) out.push(v);
    }
    return out;
  } catch(e) { return []; }
}

// デバッグ用：任意シートのヘッダー＋1行目データを返す
function staff_debugHeaders(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (ssId) ss = SpreadsheetApp.openById(ssId);
  }
  if (!ss) return { ok: false, error: 'no spreadsheet' };
  var sh = ss.getSheetByName(name);
  if (!sh) return { ok: false, error: 'sheet not found: ' + name, sheets: ss.getSheets().map(function(s){ return s.getName(); }) };
  var lc = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0];
  var first = sh.getLastRow() >= 2 ? sh.getRange(2, 1, 1, lc).getDisplayValues()[0] : [];
  return { ok: true, sheet: name, lastCol: lc, lastRow: sh.getLastRow(), headers: hdr, firstRow: first };
}

// デバッグ用：作業者マスターから読めたメール一覧を返す
function staff_debugWhitelist() {
  var u = '';
  try { u = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  var list = staff_getWhitelistFromMaster_();
  return { ok: true, you: u, count: list.length, emails: list };
}

function staff_assertAllowed_() {
  var u = staff_currentUser();
  if (!u.allowed) throw new Error('権限がありません: ' + (u.email || '未ログイン'));
  return u.email;
}

function staff_getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定');
    ss = SpreadsheetApp.openById(ssId);
  }
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) throw new Error('シートが見つかりません: ' + STAFF_SHEET_NAME);
  return sh;
}

// ========== 一覧 ==========

function staff_listProducts(opts) {
  staff_assertAllowed_();
  opts = opts || {};
  var filter = String(opts.filter || 'all'); // all|sokutei_machi|satsuei_machi|shuppin_machi|shuppin_sagyou|shuppinchu|sold
  var q = String(opts.q || '').trim().toLowerCase();
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 100));

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [], total: 0 };

  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var status = String(row[STAFF_COL.ステータス - 1] || '');
    var kanri = String(row[STAFF_COL.管理番号 - 1] || '');
    var brand = String(row[STAFF_COL.ブランド - 1] || '');
    var size = String(row[STAFF_COL.メルカリサイズ - 1] || '');
    var color = String(row[STAFF_COL.カラー - 1] || '');
    var sokutei_done = MEASURE_FIELDS.some(function(f){
      var v = row[STAFF_COL[f] - 1];
      return v !== '' && v !== null && v !== undefined;
    });
    var sold = String(row[STAFF_COL.販売日 - 1] || '') !== '';

    // フィルタ判定（ステータス値ベース＋採寸有無）
    var pass = true;
    switch (filter) {
      case 'sokutei_machi':
        pass = !sokutei_done && !sold;
        break;
      case 'satsuei_machi':
        pass = sokutei_done && /撮影待ち/.test(status);
        break;
      case 'shuppin_machi':
        pass = /出品待ち/.test(status);
        break;
      case 'shuppin_sagyou':
        pass = /出品作業中|作業中/.test(status);
        break;
      case 'shuppinchu':
        pass = /出品中/.test(status) && !sold;
        break;
      case 'sold':
        pass = sold || /売却済|完了/.test(status);
        break;
      case 'all':
      default:
        pass = true;
    }
    if (!pass) continue;

    if (q) {
      var hay = (kanri + ' ' + brand + ' ' + size + ' ' + color + ' ' + status).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }

    out.push({
      row: i + 2,
      kanri: kanri,
      brand: brand,
      size: size,
      color: color,
      status: status,
      measured: sokutei_done,
      sold: sold
    });
  }

  out.sort(function(a, b){ return String(b.kanri).localeCompare(String(a.kanri)); });

  var total = out.length;
  return { ok: true, items: out.slice(0, limit), total: total };
}

// ========== 詳細取得 ==========

function staff_getProduct(kanri) {
  staff_assertAllowed_();
  if (!kanri) return { ok: false, error: '管理番号が空です' };
  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'データなし' };

  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(String(kanri)).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  var row = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  function v(name){ return row[STAFF_COL[name] - 1]; }

  var data = {
    row: rowNum,
    kanri: String(v('管理番号') || ''),
    brand: String(v('ブランド') || ''),
    size: String(v('メルカリサイズ') || ''),
    color: String(v('カラー') || ''),
    status: String(v('ステータス') || ''),
    state: String(v('状態') || ''),
    measure: {},
    sokuteiDate: v('採寸日') || '',
    sokuteiUser: String(v('採寸者') || ''),
    sale: {
      date: v('販売日') || '',
      place: String(v('販売場所') || ''),
      price: v('販売価格') || '',
      shipping: v('送料') || '',
      fee: v('手数料') || ''
    }
  };
  MEASURE_FIELDS.forEach(function(f){ data.measure[f] = v(f) === '' || v(f) == null ? '' : v(f); });

  // Date型をyyyy-mm-dd文字列に
  if (data.sokuteiDate instanceof Date) data.sokuteiDate = Utilities.formatDate(data.sokuteiDate, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  if (data.sale.date instanceof Date) data.sale.date = Utilities.formatDate(data.sale.date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');

  return { ok: true, data: data };
}

// ========== 採寸保存 ==========

function staff_saveMeasurement(payload) {
  var email = staff_assertAllowed_();
  payload = payload || {};
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  var measure = payload.measure || {};
  var written = 0;
  MEASURE_FIELDS.forEach(function(f){
    var raw = measure[f];
    if (raw === undefined) return;
    var num = (raw === '' || raw === null) ? '' : Number(raw);
    if (raw !== '' && raw !== null && isNaN(num)) return; // 数値以外はスキップ
    sh.getRange(rowNum, STAFF_COL[f]).setValue(num === '' ? '' : num);
    written++;
  });

  // 採寸日・採寸者
  sh.getRange(rowNum, STAFF_COL.採寸日).setValue(new Date());
  sh.getRange(rowNum, STAFF_COL.採寸者).setValue(email || '');

  return { ok: true, message: '採寸を保存しました（' + written + '項目）', kanri: kanri };
}

// ========== 販売情報保存 ==========

function staff_saveSale(payload) {
  var email = staff_assertAllowed_();
  payload = payload || {};
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  var sale = payload.sale || {};

  // 販売日（yyyy-mm-dd文字列 or 空）
  if (sale.date !== undefined) {
    if (sale.date) {
      var d = new Date(sale.date);
      sh.getRange(rowNum, STAFF_COL.販売日).setValue(isNaN(d.getTime()) ? sale.date : d);
    } else {
      sh.getRange(rowNum, STAFF_COL.販売日).setValue('');
    }
  }
  if (sale.place !== undefined) sh.getRange(rowNum, STAFF_COL.販売場所).setValue(String(sale.place || ''));
  function setNum(col, val) {
    if (val === undefined) return;
    var n = (val === '' || val === null) ? '' : Number(val);
    if (val !== '' && val !== null && isNaN(n)) return;
    sh.getRange(rowNum, col).setValue(n === '' ? '' : n);
  }
  setNum(STAFF_COL.販売価格, sale.price);
  setNum(STAFF_COL.送料, sale.shipping);
  setNum(STAFF_COL.手数料, sale.fee);

  // ステータス→売却済み（販売価格が入っている場合のみ）
  if (sale.price !== undefined && sale.price !== '' && !isNaN(Number(sale.price))) {
    sh.getRange(rowNum, STAFF_COL.ステータス).setValue('売却済み');
    sh.getRange(rowNum, STAFF_COL.販売日タイムスタンプ).setValue(new Date());
  }

  return { ok: true, message: '販売情報を保存しました', kanri: kanri };
}

// ========== 仕入れ管理（AppSheet 仕入れ管理 ビュー相当） ==========

function staff_getActiveSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定');
    ss = SpreadsheetApp.openById(ssId);
  }
  return ss;
}

// 商品管理シートから 仕入れID → 登録件数 のマップを返す
function staff_countShiireProgress_(ss) {
  ss = ss || staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) return {};
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  var ids = sh.getRange(2, STAFF_COL.仕入れID, lastRow - 1, 1).getValues();
  var counts = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function staff_listShiire(opts) {
  staff_assertAllowed_();
  opts = opts || {};
  var q = String(opts.q || '').trim().toLowerCase();
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 100));

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: 'シートが見つかりません: 仕入れ管理' };

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, items: [], total: 0 };

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < hdr.length; i++) col[String(hdr[i] || '').trim()] = i + 1;

  // AppSheetビューに必要な列
  var must = ['仕入れID','仕入れ日','金額','送料','商品点数','納品場所','商品原価'];
  for (var k = 0; k < must.length; k++) {
    if (!col[must[k]]) return { ok: false, error: '仕入れ管理シートにカラムがありません: ' + must[k] };
  }

  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var prog = staff_countShiireProgress_(ss);
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';

  function v(row, name) { return col[name] ? row[col[name] - 1] : ''; }

  var items = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(v(row, '仕入れID') || '').trim();
    if (!id) continue;

    var date = v(row, '仕入れ日');
    var dateStr = (date instanceof Date) ? Utilities.formatDate(date, tz, 'yyyy-MM-dd') : String(date || '');
    var planned = Number(v(row, '商品点数') || 0) || 0;
    var registered = prog[id] || 0;
    var place = String(v(row, '納品場所') || '');
    var amount = v(row, '金額');
    var shipping = v(row, '送料');
    var cost = v(row, '商品原価');

    if (q) {
      var hay = (id + ' ' + dateStr + ' ' + place).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }

    items.push({
      row: r + 2,
      shiireId: id,
      date: dateStr,
      amount: amount === '' || amount == null ? '' : Number(amount),
      shipping: shipping === '' || shipping == null ? '' : Number(shipping),
      planned: planned,
      place: place,
      cost: cost === '' || cost == null ? '' : Number(cost),
      registered: registered,
      progressLabel: planned > 0 ? (registered + ' / ' + planned) : String(registered),
      progressDone: planned > 0 && registered >= planned
    });
  }

  // 仕入れ日 降順
  items.sort(function(a, b){ return String(b.date).localeCompare(String(a.date)); });

  return { ok: true, items: items.slice(0, limit), total: items.length };
}

// ========== Cloudflare 同期 API（doPost 経由・シークレット必須） ==========

// 作業者マスター（D/E列メール、O列有効フラグ TRUE）から認可メール一覧を返す。
// Cloudflare Access の Allowed Emails 設定に使う。
function staff_listAllowedEmails() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) return { ok: false, error: 'sheet not found: 作業者マスター' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, emails: [] };
  // A〜O列まで取得（D=4, E=5, O=15）
  var values = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  var seen = {};
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var enabled = row[14]; // O列
    var isTrue = (enabled === true) || (String(enabled).toLowerCase() === 'true');
    if (!isTrue) continue;
    [row[3], row[4]].forEach(function(v) { // D, E列
      var s = String(v == null ? '' : v).trim().toLowerCase();
      if (s && s.indexOf('@') > 0 && !seen[s]) {
        seen[s] = true;
        out.push(s);
      }
    });
  }
  return { ok: true, emails: out, count: out.length };
}

// 作業者マスター B列（作業者名）のうち O列（有効フラグ）TRUE のみ返す
function staff_listWorkers() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) return { ok: false, error: 'sheet not found: 作業者マスター' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  // B=2, O=15
  var values = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  var seen = {};
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var enabled = row[14]; // O列
    var isTrue = (enabled === true) || (String(enabled).toLowerCase() === 'true');
    if (!isTrue) continue;
    var name = String(row[1] == null ? '' : row[1]).trim(); // B列
    if (!name || seen[name]) continue;
    seen[name] = true;
    out.push(name);
  }
  return { ok: true, items: out };
}

// 設定シート B列（アカウント）一覧
function staff_listAccounts() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('設定');
  if (!sh) return { ok: false, error: 'sheet not found: 設定' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  // B=2 のみ。ヘッダー行を含めるとノイズなので 2 行目以降
  var values = sh.getRange(2, 2, lastRow - 1, 1).getValues();
  var seen = {};
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var name = String(values[r][0] == null ? '' : values[r][0]).trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    out.push(name);
  }
  return { ok: true, items: out };
}

// 初回セットアップ用: GASエディタから手動実行して SHIIRE_SYNC_SECRET を設定する
// （Workers の SYNC_SECRET と同じ値を埋める）
function staff_setupSyncSecret() {
  var SECRET = '4bdb6f1286925aaefc8d67b6552422cca8df0e5dd13ef6a3a2877ebe98d10aee';
  PropertiesService.getScriptProperties().setProperty('SHIIRE_SYNC_SECRET', SECRET);
  Logger.log('SHIIRE_SYNC_SECRET set (length=' + SECRET.length + ')');
}

// 商品管理シート 全行ダンプ（Cloudflare D1 への同期用）
// ヘッダー駆動で全カラムを extra に格納。主要カラムは個別フィールドにも残す（既存互換）
function staff_syncDumpProducts() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) return { ok: false, error: 'sheet not found: ' + STAFF_SHEET_NAME };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };

  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = hdr.map(function(v){ return String(v || '').trim(); });
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  function fmtDate(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return String(d || '');
  }
  function fmtTs(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return String(d || '');
  }
  function fmtCell(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (d === null || d === undefined) return '';
    return String(d);
  }
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  var items = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var kanri = String(row[STAFF_COL.管理番号 - 1] || '').trim();
    if (!kanri) continue;

    var measure = {};
    MEASURE_FIELDS.forEach(function(f) {
      var v = row[STAFF_COL[f] - 1];
      if (v !== '' && v !== null && v !== undefined) {
        var n = Number(v);
        if (!isNaN(n)) measure[f] = n;
      }
    });

    // 全カラムを extra に詰める（ヘッダー名キー）。Date は yyyy-MM-dd 文字列化
    var extra = {};
    for (var c = 0; c < headers.length; c++) {
      var name = headers[c];
      if (!name) continue;
      extra[name] = fmtCell(row[c]);
    }

    items.push({
      kanri: kanri,
      shiireId: String(row[STAFF_COL.仕入れID - 1] || ''),
      worker: String(row[STAFF_COL.作業者名 - 1] || ''),
      status: String(row[STAFF_COL.ステータス - 1] || ''),
      state: String(row[STAFF_COL.状態 - 1] || ''),
      brand: String(row[STAFF_COL.ブランド - 1] || ''),
      size: String(row[STAFF_COL.メルカリサイズ - 1] || ''),
      color: String(row[STAFF_COL.カラー - 1] || ''),
      measure: measure,
      measuredAt: fmtDate(row[STAFF_COL.採寸日 - 1]),
      measuredBy: String(row[STAFF_COL.採寸者 - 1] || ''),
      saleDate: fmtDate(row[STAFF_COL.販売日 - 1]),
      salePlace: String(row[STAFF_COL.販売場所 - 1] || ''),
      salePrice: num(row[STAFF_COL.販売価格 - 1]),
      saleShipping: num(row[STAFF_COL.送料 - 1]),
      saleFee: num(row[STAFF_COL.手数料 - 1]),
      saleTs: fmtTs(row[STAFF_COL.販売日タイムスタンプ - 1]),
      extra: extra,
      row: i + 2
    });
  }
  return { ok: true, items: items };
}

// 仕入れ管理シート 全行ダンプ
function staff_syncDumpPurchases() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: 'sheet not found: 仕入れ管理' };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, items: [] };

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < hdr.length; i++) col[String(hdr[i] || '').trim()] = i + 1;
  var must = ['仕入れID','仕入れ日','金額','送料','商品点数','納品場所','商品原価','区分コード'];
  for (var k = 0; k < must.length; k++) {
    if (!col[must[k]]) return { ok: false, error: 'missing column: ' + must[k] };
  }

  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  function val(row, name) { return col[name] ? row[col[name] - 1] : ''; }
  function num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isNaN(n) ? 0 : Math.round(n);
  }

  var items = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(val(row, '仕入れID') || '').trim();
    if (!id) continue;
    var date = val(row, '仕入れ日');
    var dateStr = (date instanceof Date) ? Utilities.formatDate(date, tz, 'yyyy-MM-dd') : String(date || '');
    items.push({
      shiireId: id,
      date: dateStr,
      amount: num(val(row, '金額')),
      shipping: num(val(row, '送料')),
      planned: num(val(row, '商品点数')),
      place: String(val(row, '納品場所') || ''),
      cost: num(val(row, '商品原価')),
      category: String(val(row, '区分コード') || ''),
      row: r + 2
    });
  }
  return { ok: true, items: items };
}

// Cloudflare からの書き込みプロキシ（採寸） — 認可チェックなし、シークレット認可は doPost 側
function staff_apiSaveMeasurement(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  var measure = payload.measure || {};
  var written = 0;
  MEASURE_FIELDS.forEach(function(f) {
    var raw = measure[f];
    if (raw === undefined) return;
    var n = (raw === '' || raw === null) ? '' : Number(raw);
    if (raw !== '' && raw !== null && isNaN(n)) return;
    sh.getRange(rowNum, STAFF_COL[f]).setValue(n === '' ? '' : n);
    written++;
  });
  sh.getRange(rowNum, STAFF_COL.採寸日).setValue(new Date());
  sh.getRange(rowNum, STAFF_COL.採寸者).setValue(email);

  return { ok: true, message: '採寸を保存しました（' + written + '項目）', kanri: kanri, row: rowNum };
}

// Cloudflare からの書き込みプロキシ（販売情報）
function staff_apiSaveSale(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  var sale = payload.sale || {};

  if (sale.date !== undefined) {
    if (sale.date) {
      var d = new Date(sale.date);
      sh.getRange(rowNum, STAFF_COL.販売日).setValue(isNaN(d.getTime()) ? sale.date : d);
    } else {
      sh.getRange(rowNum, STAFF_COL.販売日).setValue('');
    }
  }
  if (sale.place !== undefined) sh.getRange(rowNum, STAFF_COL.販売場所).setValue(String(sale.place || ''));
  function setNum(c, v) {
    if (v === undefined) return;
    var n = (v === '' || v === null) ? '' : Number(v);
    if (v !== '' && v !== null && isNaN(n)) return;
    sh.getRange(rowNum, c).setValue(n === '' ? '' : n);
  }
  setNum(STAFF_COL.販売価格, sale.price);
  setNum(STAFF_COL.送料, sale.shipping);
  setNum(STAFF_COL.手数料, sale.fee);

  if (sale.price !== undefined && sale.price !== '' && !isNaN(Number(sale.price))) {
    sh.getRange(rowNum, STAFF_COL.ステータス).setValue('売却済み');
    sh.getRange(rowNum, STAFF_COL.販売日タイムスタンプ).setValue(new Date());
  }

  return { ok: true, message: '販売情報を保存しました', kanri: kanri, row: rowNum };
}

// Cloudflare からの汎用書き込みプロキシ（ヘッダー名キーで任意フィールド更新）
// payload: { kanri: '...', fields: { 'ブランド': 'X', '販売価格': 1000, '採寸日': '2026-04-26', ... } }
// 計算列・自動引き当て列・システム列は無視（DETAILS_READONLY_）
var DETAILS_READONLY_ = {
  '商品ID': 1, '管理番号': 1, '仕入れID': 1, '区分コード': 1,
  '出品30日経過': 1, '在庫日数': 1,
  '仕入れ日': 1, '仕入れ値': 1, '納品場所': 1,
  'プロモーション手数料': 1, '粗利': 1, '利益': 1, '利益率': 1, 'リードタイム': 1,
  '販売日タイムスタンプ': 1
};
// 数値列（数値変換するヘッダー名）
var DETAILS_NUMERIC_ = {
  '販売価格': 1, '送料': 1, '手数料': 1
};
// 日付列（Date オブジェクトに変換するヘッダー名）
var DETAILS_DATE_ = {
  '採寸日': 1, '撮影日付': 1, '出品日': 1, '販売日': 1,
  '返品日付': 1, '発送日付': 1, '完了日': 1, 'キャンセル日': 1, '廃棄日': 1
};

function staff_apiSaveDetails(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var fields = payload.fields || {};
  var keys = Object.keys(fields);
  if (keys.length === 0) return { ok: false, error: '更新フィールドが空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'シートが空です' };

  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };
  var rowNum = found.getRow();

  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);

  var written = 0;
  var skipped = [];
  var unknown = [];
  var prevSaleEmpty = false;
  var newSalePrice = null;

  // 販売価格を新規セットしたら ステータス=売却済み + 販売日タイムスタンプ を自動更新するため事前判定
  if (fields['販売価格'] !== undefined && fields['販売価格'] !== '' && fields['販売価格'] !== null) {
    var prev = sh.getRange(rowNum, STAFF_COL.販売価格).getValue();
    prevSaleEmpty = (prev === '' || prev === null || prev === undefined);
    var nP = Number(fields['販売価格']);
    if (!isNaN(nP)) newSalePrice = nP;
  }

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (DETAILS_READONLY_[key]) { skipped.push(key); continue; }
    var c = col[key];
    if (!c) { unknown.push(key); continue; }
    var raw = fields[key];

    var v;
    if (raw === '' || raw === null || raw === undefined) {
      v = '';
    } else if (DETAILS_DATE_[key]) {
      var d = new Date(raw);
      v = isNaN(d.getTime()) ? String(raw) : d;
    } else if (DETAILS_NUMERIC_[key]) {
      var n = Number(raw);
      if (isNaN(n)) { skipped.push(key); continue; }
      v = n;
    } else {
      v = String(raw);
    }
    sh.getRange(rowNum, c).setValue(v);
    written++;
  }

  // 販売価格を新規入力した場合の連動処理（採寸/販売の既存ロジックと同等）
  if (prevSaleEmpty && newSalePrice !== null) {
    sh.getRange(rowNum, STAFF_COL.ステータス).setValue('売却済み');
    sh.getRange(rowNum, STAFF_COL.販売日タイムスタンプ).setValue(new Date());
  }

  // 採寸関連を更新したら 採寸日・採寸者を自動補完（明示指定があればそちらを優先）
  var measureFieldUpdated = false;
  for (var j = 0; j < MEASURE_FIELDS.length; j++) {
    if (fields[MEASURE_FIELDS[j]] !== undefined) { measureFieldUpdated = true; break; }
  }
  if (measureFieldUpdated) {
    if (fields['採寸日'] === undefined) sh.getRange(rowNum, STAFF_COL.採寸日).setValue(new Date());
    if (fields['採寸者'] === undefined) sh.getRange(rowNum, STAFF_COL.採寸者).setValue(email);
  }

  return {
    ok: true,
    message: written + '件更新しました',
    kanri: kanri,
    row: rowNum,
    written: written,
    skipped: skipped,
    unknown: unknown
  };
}

// 個別の仕入れIDに紐づく商品管理レコード一覧
function staff_getShiireProducts(shiireId) {
  staff_assertAllowed_();
  if (!shiireId) return { ok: false, error: '仕入れIDが空です' };
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) return { ok: false, error: 'シートが見つかりません: ' + STAFF_SHEET_NAME };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };

  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  var target = String(shiireId).trim();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var sid = String(row[STAFF_COL.仕入れID - 1] || '').trim();
    if (sid !== target) continue;
    out.push({
      row: i + 2,
      kanri: String(row[STAFF_COL.管理番号 - 1] || ''),
      brand: String(row[STAFF_COL.ブランド - 1] || ''),
      size: String(row[STAFF_COL.メルカリサイズ - 1] || ''),
      color: String(row[STAFF_COL.カラー - 1] || ''),
      status: String(row[STAFF_COL.ステータス - 1] || '')
    });
  }
  out.sort(function(a, b){ return String(b.kanri).localeCompare(String(a.kanri)); });
  return { ok: true, shiireId: target, items: out };
}

// ========== 新規作成 API（Cloudflare 経由・doPost で認可済み） ==========

// AppSheet UNIQUEID 互換の8文字ID（先頭1英字 + 7文字hex）
function staff_generateUniqueId_() {
  var letters = 'abcdefghijklmnopqrstuvwxyz';
  var head = letters.charAt(Math.floor(Math.random() * letters.length));
  var hex = Utilities.getUuid().replace(/-/g, '').slice(0, 7).toLowerCase();
  return head + hex;
}

// 仕入れ管理シートに新規行を追加
// payload: { date, category, amount, shipping, planned, place, content }
// onChange トリガー (handleChange_ShiireSync) が
//   - 仕入れ数報告へ自動転記
//   - 商品原価を自動計算
//   - 割り当て管理番号を再計算
function staff_apiCreatePurchase(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');

  var date = String(payload.date || '').trim();
  var category = String(payload.category || '').trim();
  var place = String(payload.place || '').trim();

  if (!date) return { ok: false, error: '仕入れ日が空です' };
  if (!category) return { ok: false, error: '区分コードが空です' };
  if (!place) return { ok: false, error: '納品場所が空です' };

  var amount = Number(payload.amount || 0) || 0;
  var shipping = Number(payload.shipping || 0) || 0;
  var planned = Number(payload.planned || 0) || 0;
  var content = String(payload.content || '').trim();

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: 'シートが見つかりません: 仕入れ管理' };

  var id = staff_generateUniqueId_();
  // 衝突回避（極めて稀）
  var existing = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var existSet = {};
  for (var i = 0; i < existing.length; i++) {
    var v = String(existing[i][0] || '').trim();
    if (v) existSet[v] = true;
  }
  while (existSet[id]) id = staff_generateUniqueId_();

  // 商品原価 = (金額 + 送料) / 商品点数（点数があれば）
  var unitCost = '';
  if (planned > 0) unitCost = Math.round((amount + shipping) / planned);

  var dateValue;
  var d = new Date(date);
  dateValue = isNaN(d.getTime()) ? date : d;

  // 列順: A=ID, B=仕入れ日, C=区分コード, D=金額, E=送料, F=商品点数, G=納品場所, H=商品原価, I=内容, J=空, K=登録日時
  var row = [
    id,
    dateValue,
    category,
    amount,
    shipping,
    planned,
    place,
    unitCost,
    content,
    '',           // J列（空）
    new Date()    // K列 登録日時
  ];

  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, row.length).setValues([row]);

  // onChange トリガーは UI 経由の編集でしか発火しないため明示的に同期処理を回す
  try {
    if (typeof handleChange_ShiireSync === 'function') {
      handleChange_ShiireSync({});
    }
  } catch (err) {
    console.warn('createPurchase: handleChange_ShiireSync 失敗 ' + (err && err.message));
  }

  return { ok: true, shiireId: id, row: appendAt };
}

// 商品管理シートに新規行を追加
// payload: { shiireId, kanri, brand, size, color, state, status }
// 区分コードは仕入れ管理から自動引き当て
function staff_apiCreateProduct(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');

  var shiireId = String(payload.shiireId || '').trim();
  var kanri = String(payload.kanri || '').trim();
  if (!shiireId) return { ok: false, error: '仕入れIDが空です' };
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) return { ok: false, error: 'シートが見つかりません: ' + STAFF_SHEET_NAME };

  // 管理番号の重複チェック
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
    var dup = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
    if (dup) return { ok: false, error: '管理番号 ' + kanri + ' は既に存在します（' + dup.getRow() + '行目）' };
  }

  // 仕入れ管理から区分コードを引く
  var category = '';
  var shiireSh = ss.getSheetByName('仕入れ管理');
  if (shiireSh && shiireSh.getLastRow() >= 2) {
    var sLast = shiireSh.getLastRow();
    var sIds = shiireSh.getRange(2, 1, sLast - 1, 1).getValues();
    for (var k = 0; k < sIds.length; k++) {
      if (String(sIds[k][0] || '').trim() === shiireId) {
        category = String(shiireSh.getRange(k + 2, 3).getValue() || '').trim();
        break;
      }
    }
  }

  var productId = staff_generateUniqueId_();
  var status = String(payload.status || '採寸待ち');

  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);

  // 既存固定列で初期化
  var width = Math.max(STAFF_COL.販売日タイムスタンプ, lastCol);
  var rowArr = new Array(width).fill('');
  rowArr[STAFF_COL.商品ID - 1] = productId;
  rowArr[STAFF_COL.仕入れID - 1] = shiireId;
  rowArr[STAFF_COL.区分コード - 1] = category;
  rowArr[STAFF_COL.ステータス - 1] = status;
  rowArr[STAFF_COL.管理番号 - 1] = kanri;
  if (payload.state !== undefined) rowArr[STAFF_COL.状態 - 1] = String(payload.state || '');
  if (payload.brand !== undefined) rowArr[STAFF_COL.ブランド - 1] = String(payload.brand || '');
  if (payload.size !== undefined) rowArr[STAFF_COL.メルカリサイズ - 1] = String(payload.size || '');
  if (payload.color !== undefined) rowArr[STAFF_COL.カラー - 1] = String(payload.color || '');

  // payload.fields で AppSheet 同等の任意ヘッダー入力を受け付ける
  var fields = payload.fields || {};
  var skipped = [];
  var unknown = [];
  Object.keys(fields).forEach(function(key){
    if (DETAILS_READONLY_[key]) { skipped.push(key); return; }
    var c = col[key];
    if (!c) { unknown.push(key); return; }
    var raw = fields[key];
    var v;
    if (raw === '' || raw === null || raw === undefined) {
      v = '';
    } else if (DETAILS_DATE_[key]) {
      var d = new Date(raw);
      v = isNaN(d.getTime()) ? String(raw) : d;
    } else if (DETAILS_NUMERIC_[key]) {
      var n = Number(raw);
      if (isNaN(n)) { skipped.push(key); return; }
      v = n;
    } else {
      v = String(raw);
    }
    rowArr[c - 1] = v;
  });

  // 採寸関連が含まれていたら採寸日・採寸者を補完
  var measureUpdated = false;
  for (var j = 0; j < MEASURE_FIELDS.length; j++) {
    if (fields[MEASURE_FIELDS[j]] !== undefined && fields[MEASURE_FIELDS[j]] !== '') { measureUpdated = true; break; }
  }
  if (measureUpdated) {
    if (fields['採寸日'] === undefined && col['採寸日']) rowArr[col['採寸日'] - 1] = new Date();
    if (fields['採寸者'] === undefined && col['採寸者']) rowArr[col['採寸者'] - 1] = email;
  }

  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, width).setValues([rowArr]);

  return { ok: true, kanri: kanri, productId: productId, row: appendAt, skipped: skipped, unknown: unknown };
}
