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

// ========== ステータス自動算出（AppSheet IFS 式と一致） ==========
// AppSheet 式（参照元）:
//   IFS(
//     ISNOTBLANK([廃棄日]),     "廃棄済み",
//     ISNOTBLANK([返品日付]),   "返品済み",
//     ISNOTBLANK([キャンセル日]),"キャンセル",
//     ISNOTBLANK([完了日]),     "売却済み",
//     ISNOTBLANK([発送日付]),   "発送済み",
//     ISNOTBLANK([販売日]),     "発送待ち",
//     ISNOTBLANK([出品日]),     "出品中",
//     AND(ISNOTBLANK([撮影日付]), ISNOTBLANK([採寸日])), "出品待ち",
//     AND(ISNOTBLANK([撮影日付]), ISBLANK([採寸日])),   "採寸待ち",
//     ISNOTBLANK([採寸日]),     "撮影待ち",
//     TRUE,                    ""
//   )
var STATUS_RULES_ = [
  { col: '廃棄日',    cond: 'notBlank',  status: '廃棄済み' },
  { col: '返品日付',  cond: 'notBlank',  status: '返品済み' },
  { col: 'キャンセル日', cond: 'notBlank', status: 'キャンセル' },
  { col: '完了日',    cond: 'notBlank',  status: '売却済み' },
  { col: '発送日付',  cond: 'notBlank',  status: '発送済み' },
  { col: '販売日',    cond: 'notBlank',  status: '発送待ち' },
  { col: '出品日',    cond: 'notBlank',  status: '出品中' },
  { cond: 'andNotBlank', cols: ['撮影日付', '採寸日'], status: '出品待ち' },
  { cond: 'andNotBlankBlank', notBlankCol: '撮影日付', blankCol: '採寸日', status: '採寸待ち' },
  { col: '採寸日',    cond: 'notBlank',  status: '撮影待ち' }
];

function staff_isBlankCell_(v) {
  return v === '' || v === null || v === undefined;
}

// 現状の行（rowVals: 1-indexed相当のオブジェクト or 配列, col: ヘッダ→列番号マップ）から
// IFS 順に評価して算出ステータス文字列を返す。該当なしは ''。
function staff_calcStatus_(rowVals, col) {
  function val(name) {
    var c = col[name];
    if (!c) return '';
    return rowVals[c - 1];
  }
  for (var i = 0; i < STATUS_RULES_.length; i++) {
    var r = STATUS_RULES_[i];
    if (r.cond === 'notBlank') {
      if (!staff_isBlankCell_(val(r.col))) return r.status;
    } else if (r.cond === 'andNotBlank') {
      var allFilled = r.cols.every(function(n){ return !staff_isBlankCell_(val(n)); });
      if (allFilled) return r.status;
    } else if (r.cond === 'andNotBlankBlank') {
      if (!staff_isBlankCell_(val(r.notBlankCol)) && staff_isBlankCell_(val(r.blankCol))) return r.status;
    }
  }
  return '';
}

// 行の現状を読んでステータスを再計算し、現在値と異なる場合のみ書き戻す。
// hdr / col 未指定時は内部で取得する。複数フィールド更新後にまとめて呼ぶ用途を想定。
function staff_recomputeStatus_(sh, rowNum, hdr, col) {
  if (!hdr) {
    hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }
  if (!col) col = buildHeaderMap_(hdr);
  var lastCol = sh.getLastColumn();
  var rowVals = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  var calc = staff_calcStatus_(rowVals, col);
  var current = String(rowVals[STAFF_COL.ステータス - 1] || '');
  // 判定列がすべて空なら算出も空。その場合はステータスもクリアする（削除時に前段階へ戻す）。
  if (calc === current) return { changed: false, current: current, calc: calc };
  sh.getRange(rowNum, STAFF_COL.ステータス).setValue(calc);
  return { changed: true, prev: current, status: calc };
}

// 指定の管理番号リストの E列ステータスを「売却済み」に一括書き戻す（5/3 Ctrl+H 連鎖被害の復旧用）
// Apps Script エディタから restoreSoldStatusBatch() を実行する。事前に KANRI_LIST を編集
// 注意: staff_recalcAllStatus() を後から実行すると IFS 式評価で再上書きされるので扱い注意
function restoreSoldStatusBatch() {
  // 2026-05-03 Ctrl+H で「売却済み→出品中→返品済み」と連鎖した35件
  var KANRI_LIST = [
    'zB32','zB33','zB35','zB38','zB51','zB83','zB85','zB87','zB88','zB94','zB95','zB99',
    'zB111','zB115','zB128','zB133','zB134','zB139','zB142','zB147','zB149','zB153','zB160','zB194',
    'zB248','zB404','zB406','zB419','zB423','zB472','zB857',
    'zG36',
    'zS6','zS7','zS12'
  ];
  var TARGET_STATUS = '売却済み';

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, updated: 0, notFound: KANRI_LIST.slice() };

  var kanriRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1).getValues();
  var kanriToRow = Object.create(null);
  for (var i = 0; i < kanriRange.length; i++) {
    var k = String(kanriRange[i][0] || '').trim();
    if (k) kanriToRow[k] = i + 2; // シート上の行番号
  }

  var updated = [];
  var notFound = [];
  for (var j = 0; j < KANRI_LIST.length; j++) {
    var kanri = KANRI_LIST[j];
    var rowNum = kanriToRow[kanri];
    if (!rowNum) { notFound.push(kanri); continue; }
    var current = String(sh.getRange(rowNum, STAFF_COL.ステータス).getValue() || '');
    if (current === TARGET_STATUS) {
      updated.push({ kanri: kanri, row: rowNum, prev: current, status: TARGET_STATUS, skipped: true });
      continue;
    }
    sh.getRange(rowNum, STAFF_COL.ステータス).setValue(TARGET_STATUS);
    updated.push({ kanri: kanri, row: rowNum, prev: current, status: TARGET_STATUS });
  }

  Logger.log('=== restoreSoldStatusBatch 結果 ===');
  Logger.log('対象=' + KANRI_LIST.length + ' / 更新=' + updated.filter(function(u){ return !u.skipped; }).length
    + ' / 既に売却済み=' + updated.filter(function(u){ return u.skipped; }).length
    + ' / 見つからず=' + notFound.length);
  for (var k = 0; k < updated.length; k++) {
    var u = updated[k];
    Logger.log((k + 1) + '. ' + u.kanri + ' 行' + u.row + ' [' + u.prev + ']→[' + u.status + ']' + (u.skipped ? ' (skip)' : ''));
  }
  if (notFound.length) Logger.log('見つからず: ' + notFound.join(', '));

  return { ok: true, updated: updated, notFound: notFound };
}

// 5/3 Ctrl+H 被害復旧の続き: 38件 (35件復旧 + 元々売却済み3件) の受付番号列を一括書き戻す
// Apps Script エディタから setReceiptNoBatch() を実行する
function setReceiptNoBatch() {
  var KANRI_LIST = [
    // 5/3 Ctrl+H 被害35件
    'zB32','zB33','zB35','zB38','zB51','zB83','zB85','zB87','zB88','zB94','zB95','zB99',
    'zB111','zB115','zB128','zB133','zB134','zB139','zB142','zB147','zB149','zB153','zB160','zB194',
    'zB248','zB404','zB406','zB419','zB423','zB472','zB857',
    'zG36',
    'zS6','zS7','zS12',
    // 元々売却済み3件 (既存値を上書き)
    'zB70','zB125','zG112'
  ];
  var TARGET_VALUE = '20260210163541-716';

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, updated: 0, notFound: KANRI_LIST.slice() };

  // 「受付番号」列をヘッダーから動的解決
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  var receiptCol = col['受付番号'];
  if (!receiptCol) throw new Error('「受付番号」列がヘッダーに見つかりません');

  var kanriRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1).getValues();
  var kanriToRow = Object.create(null);
  for (var i = 0; i < kanriRange.length; i++) {
    var k = String(kanriRange[i][0] || '').trim();
    if (k) kanriToRow[k] = i + 2;
  }

  var updated = [];
  var notFound = [];
  for (var j = 0; j < KANRI_LIST.length; j++) {
    var kanri = KANRI_LIST[j];
    var rowNum = kanriToRow[kanri];
    if (!rowNum) { notFound.push(kanri); continue; }
    var current = String(sh.getRange(rowNum, receiptCol).getValue() || '');
    sh.getRange(rowNum, receiptCol).setValue(TARGET_VALUE);
    updated.push({ kanri: kanri, row: rowNum, prev: current, value: TARGET_VALUE });
  }

  Logger.log('=== setReceiptNoBatch 結果 ===');
  Logger.log('対象=' + KANRI_LIST.length + ' / 更新=' + updated.length + ' / 見つからず=' + notFound.length);
  Logger.log('書き込み列=受付番号 (列' + receiptCol + ') / 値=' + TARGET_VALUE);
  for (var k = 0; k < updated.length; k++) {
    var u = updated[k];
    Logger.log((k + 1) + '. ' + u.kanri + ' 行' + u.row + ' [旧:' + (u.prev || '空') + ']→[' + u.value + ']');
  }
  if (notFound.length) Logger.log('見つからず: ' + notFound.join(', '));

  return { ok: true, updated: updated, notFound: notFound };
}

// 全行のステータスを IFS 式に揃える（手動バックフィル用 / Apps Script エディタから実行）
function staff_recalcAllStatus() {
  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, changed: 0, total: 0 };
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var rowVals = values[i];
    var calc = staff_calcStatus_(rowVals, col);
    var current = String(rowVals[STAFF_COL.ステータス - 1] || '');
    if (calc === current) continue;
    sh.getRange(i + 2, STAFF_COL.ステータス).setValue(calc);
    changed++;
  }
  return { ok: true, changed: changed, total: values.length };
}

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

// 画像アップロード用 Drive フォルダのキャッシュ。
// 過去: 毎回 getFileById(ss) → getParents → getFoldersByName(...) → next で 4 Drive 操作（〜1秒）
// 改: フォルダ ID を CacheService に 6h 保存して getFolderById 1回に短縮（〜200ms）。
// 不正 ID（手動削除など）にはフォールバックで親フォルダから再探索 + キャッシュ更新。
var STAFF_IMG_FOLDER_CACHE_ = Object.create(null); // 同一実行内メモ
function staff_getImageFolder_(folderName) {
  if (STAFF_IMG_FOLDER_CACHE_[folderName]) return STAFF_IMG_FOLDER_CACHE_[folderName];
  var cache = CacheService.getScriptCache();
  var cacheKey = 'imgFolderId:' + folderName;
  var cachedId = cache.get(cacheKey);
  if (cachedId) {
    try {
      var fld = DriveApp.getFolderById(cachedId);
      if (fld && fld.getName() === folderName) {
        STAFF_IMG_FOLDER_CACHE_[folderName] = fld;
        return fld;
      }
    } catch (err) { /* キャッシュ ID 不正 → 再探索 */ }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定');
    ss = SpreadsheetApp.openById(ssId);
  }
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var subs = parent.getFoldersByName(folderName);
  var folder = subs.hasNext() ? subs.next() : parent.createFolder(folderName);
  try { cache.put(cacheKey, folder.getId(), 6 * 60 * 60); } catch (e) {}
  STAFF_IMG_FOLDER_CACHE_[folderName] = folder;
  return folder;
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

  // ステータスを IFS 式で再計算（採寸日が入る → 撮影待ち / 出品待ち 等）
  try { staff_recomputeStatus_(sh, rowNum); } catch(e) {}

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

  // 販売価格が新規セットされた場合は 販売日タイムスタンプ を自動付与（並び替え・監査用）
  if (sale.price !== undefined && sale.price !== '' && !isNaN(Number(sale.price))) {
    sh.getRange(rowNum, STAFF_COL.販売日タイムスタンプ).setValue(new Date());
  }

  // ステータスは AppSheet IFS 式に従って再計算（販売日が入れば 発送待ち、完了日が入れば 売却済み 等）
  try { staff_recomputeStatus_(sh, rowNum); } catch(e) {}

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
  for (var i = 0; i < hdr.length; i++) { var hk = String(hdr[i] || '').trim(); if (hk && !(hk in col)) col[hk] = i + 1; }

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
// 1行目=説明文 / 2行目=空 / 3行目=ヘッダー / 4行目以降=データ
function staff_listAccounts() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('設定');
  if (!sh) return { ok: false, error: 'sheet not found: 設定' };
  var lastRow = sh.getLastRow();
  if (lastRow < 4) return { ok: true, items: [] };
  var values = sh.getRange(4, 2, lastRow - 3, 1).getValues();
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

// 仕入先マスタ → [{id, name}]
function staff_listSuppliers() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入先マスタ');
  if (!sh) return { ok: false, error: 'sheet not found: 仕入先マスタ' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  var seen = {};
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][0] == null ? '' : values[r][0]).trim();
    var name = String(values[r][1] == null ? '' : values[r][1]).trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push({ id: id, name: name || id });
  }
  return { ok: true, items: out };
}

// 納品場所 A列 → [string]
function staff_listPlaces() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('納品場所');
  if (!sh) return { ok: false, error: 'sheet not found: 納品場所' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
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

// 設定シート全体を { ヘッダー名: [ユニーク値...] } で返す
// 1行目=説明文 / 2行目=空 / 3行目=ヘッダー / 4行目以降=データ
// プルダウン用に「状態 / 発送方法 / カラー1 / カテゴリ2 / カテゴリ3」等を一括取得
function staff_listSettings() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('設定');
  if (!sh) return { ok: false, error: 'sheet not found: 設定' };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 4 || lastCol < 1) return { ok: true, items: {}, saleChannels: {} };
  var headers = sh.getRange(3, 1, 1, lastCol).getValues()[0];
  var data = sh.getRange(4, 1, lastRow - 3, lastCol).getValues();
  var out = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? '' : headers[c]).trim();
    if (!h) continue;
    var seen = {};
    var list = [];
    for (var r = 0; r < data.length; r++) {
      var v = String(data[r][c] == null ? '' : data[r][c]).trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      list.push(v);
    }
    if (list.length) out[h] = list;
  }
  // 販売場所名 / 手数料率 / 有効フラグ の3列が揃っていれば 行対応の structured map を生成
  // → クライアントが販売場所別の手数料率を引けるようにする
  var nameCol = -1, rateCol = -1, enabledCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h2 = String(headers[i] == null ? '' : headers[i]).trim();
    if (h2 === '販売場所名') nameCol = i;
    else if (h2 === '手数料率') rateCol = i;
    else if (h2 === '有効フラグ') enabledCol = i;
  }
  var saleChannels = {};
  if (nameCol >= 0 && rateCol >= 0) {
    for (var r2 = 0; r2 < data.length; r2++) {
      var name = String(data[r2][nameCol] == null ? '' : data[r2][nameCol]).trim();
      if (!name) continue;
      var rateRaw = data[r2][rateCol];
      var rate = (rateRaw === '' || rateRaw == null) ? NaN : Number(rateRaw);
      if (isNaN(rate)) continue;
      // 10 のような整数で来た場合は % とみなす
      if (rate > 1) rate = rate / 100;
      var enabled = true;
      if (enabledCol >= 0) {
        var ev = String(data[r2][enabledCol] == null ? '' : data[r2][enabledCol]).trim().toUpperCase();
        enabled = (ev === 'TRUE' || ev === '1' || ev === 'YES');
      }
      saleChannels[name] = { rate: rate, enabled: enabled };
    }
  }
  return { ok: true, items: out, saleChannels: saleChannels };
}

// 管理番号マスタ A列 (区分コード) → [string]
function staff_listCategories() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('管理番号マスタ');
  if (!sh) return { ok: false, error: 'sheet not found: 管理番号マスタ' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
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

// 管理番号 → AI画像判定シートから 9 項目をプリフィル用に返す
// AppSheet Initial Value (LOOKUP) 相当
function staff_lookupAiPrefill(kanri) {
  var key = String(kanri == null ? '' : kanri).trim();
  if (!key) return { ok: false, error: 'kanri required' };
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('AI画像判定');
  if (!sh) return { ok: true, fields: {}, found: false };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, fields: {}, found: false };
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h) colMap[h] = c;
  }
  var midCol = colMap['管理番号'];
  if (midCol == null) return { ok: true, fields: {}, found: false };
  var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var keyU = key.toUpperCase();
  var hit = null;
  for (var r = 0; r < rows.length; r++) {
    var v = String(rows[r][midCol] || '').trim();
    if (v && v.toUpperCase() === keyU) { hit = rows[r]; break; }
  }
  if (!hit) return { ok: true, fields: {}, found: false };
  // ユーザー要望の 9 項目
  var WANTED = ['ブランド','タグ表記','性別','カテゴリ1','カテゴリ2','カテゴリ3','デザイン特徴','カラー','ポケット'];
  var out = {};
  for (var i = 0; i < WANTED.length; i++) {
    var name = WANTED[i];
    var ci = colMap[name];
    if (ci == null) continue;
    var val = hit[ci];
    if (val == null) continue;
    var s = String(val).trim();
    if (s) out[name] = s;
  }
  // 撮影日付・撮影者は新規作成時にはセットしない。
  // 商品管理シートに行が登録された後、gas-proxy の autoMatchPhotography → importPhotographyData_
  // が photo-meta KV を元に AI列(35)=撮影日付 / AJ列(36)=撮影者 を 5分Cron で自動反映する。
  return { ok: true, fields: out, found: true };
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
  // スプレッドシートの TZ が JST と異なる（PDT など）と日付セルの時刻成分が getHours() でゼロにならず
  // 全日付セルが ISO 化されてしまう。TZ 上の HH:mm:ss で判定することで「日付のみ」セルを正しく検出する
  var sheetTz = ss.getSpreadsheetTimeZone() || tz;
  function fmtDate(d) {
    if (d instanceof Date) return Utilities.formatDate(d, sheetTz, 'yyyy-MM-dd');
    return String(d || '');
  }
  function fmtTs(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return String(d || '');
  }
  // 「日付のみ」セルの検出は単一 TZ では誤爆する。
  // 例: AppSheet が PDT 起点で書いた `2026-04-06T07:00Z` は JST で 16:00、PDT で 00:00。
  //     web フロント側で `new Date('2026-05-07')` を保存した値は UTC 起点で JST 09:00。
  // → JST/UTC/America/Los_Angeles のいずれかで 00:00:00 なら date-only と判定する。
  function fmtCell(d) {
    if (d instanceof Date) {
      var hmsJst = Utilities.formatDate(d, sheetTz, 'HH:mm:ss');
      var hmsUtc = Utilities.formatDate(d, 'UTC', 'HH:mm:ss');
      var hmsLa  = Utilities.formatDate(d, 'America/Los_Angeles', 'HH:mm:ss');
      if (hmsJst === '00:00:00' || hmsUtc === '00:00:00' || hmsLa === '00:00:00') {
        return Utilities.formatDate(d, sheetTz, 'yyyy-MM-dd');
      }
      return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
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
  for (var i = 0; i < hdr.length; i++) { var hk = String(hdr[i] || '').trim(); if (hk && !(hk in col)) col[hk] = i + 1; }
  var must = ['仕入れID','仕入れ日','金額','送料','商品点数','納品場所','商品原価','区分コード'];
  for (var k = 0; k < must.length; k++) {
    if (!col[must[k]]) return { ok: false, error: 'missing column: ' + must[k] };
  }

  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  // スプレッドシートの TZ（PDT 等）と script TZ（JST）が異なると日付セルが時刻ズレする。
  // 「日付のみ」セルは sheetTz でフォーマットして yyyy-MM-dd に丸める
  var sheetTz = ss.getSpreadsheetTimeZone() || tz;
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
    var dateStr = (date instanceof Date) ? Utilities.formatDate(date, sheetTz, 'yyyy-MM-dd') : String(date || '');
    var registeredAtRaw = val(row, '登録日時');
    var registeredAtStr = (registeredAtRaw instanceof Date)
      ? Utilities.formatDate(registeredAtRaw, tz, 'yyyy-MM-dd HH:mm:ss')
      : String(registeredAtRaw || '');
    var processedRaw = val(row, '処理済み');
    var processed = (processedRaw === true) || (String(processedRaw).toLowerCase() === 'true');
    items.push({
      shiireId: id,
      date: dateStr,
      amount: num(val(row, '金額')),
      shipping: num(val(row, '送料')),
      planned: num(val(row, '商品点数')),
      place: String(val(row, '納品場所') || ''),
      cost: num(val(row, '商品原価')),
      category: String(val(row, '区分コード') || ''),
      content: String(val(row, '内容') || ''),
      supplierId: String(val(row, '仕入先名') || ''),
      registerUser: String(val(row, '登録者') || ''),
      registeredAt: registeredAtStr,
      assignedKanri: String(val(row, '割当管理番号') || ''),
      processed: processed,
      row: r + 2
    });
  }
  return { ok: true, items: items };
}

// AI画像判定シート 全行ダンプ（Cloudflare D1 への同期用）
// 管理番号 → 9項目（ブランド/タグ表記/性別/カテゴリ1-3/デザイン特徴/カラー/ポケット）
// staff_lookupAiPrefill のシート全件版。Cron 5分で D1 に UPSERT し、handler 側は ai_prefill テーブルを引く
function staff_syncDumpAiPrefill() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('AI画像判定');
  if (!sh) return { ok: true, items: [] }; // シート無くてもエラーにせず空返し
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, items: [] };
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h) colMap[h] = c;
  }
  if (colMap['管理番号'] == null) return { ok: true, items: [] };
  var WANTED = ['ブランド','タグ表記','性別','カテゴリ1','カテゴリ2','カテゴリ3','デザイン特徴','カラー','ポケット'];
  var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];
  for (var r = 0; r < rows.length; r++) {
    var kanri = String(rows[r][colMap['管理番号']] || '').trim();
    if (!kanri) continue;
    var fields = {};
    for (var i = 0; i < WANTED.length; i++) {
      var name = WANTED[i];
      var ci = colMap[name];
      if (ci == null) continue;
      var v = rows[r][ci];
      if (v == null) continue;
      var s = String(v).trim();
      if (s) fields[name] = s;
    }
    if (Object.keys(fields).length === 0) continue;
    items.push({ kanri: kanri, fields: fields, row: r + 2 });
  }
  return { ok: true, items: items };
}

// Cloudflare からの書き込みプロキシ（採寸） — 認可チェックなし、シークレット認可は doPost 側
// Code.gs doGet で生成する商品説明 (shitsu_v3_<id>) の 10分キャッシュを失効させる。
// 採寸/詳細/新規作成 で値が変わった直後に呼ぶことで「商品説明コピー」が古い採寸値のままになる事故を防ぐ。
function staff_invalidateListingCache_(kanri) {
  if (!kanri) return;
  try { CacheService.getScriptCache().remove('shitsu_v3_' + String(kanri).trim()); } catch (e) { /* ignore */ }
}

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

  staff_invalidateListingCache_(kanri);
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

// 日付フィールドのパース。
//   - フロントは <input type="date"> から `YYYY-MM-DD` を送る → `new Date(s)` だと UTC 真夜中扱いで JST 09:00 等のずれが発生
//   - 「今日 (JST)」が来たら実際の保存時刻 `new Date()` を使う → 作業履歴の時刻が分まで残る
//   - 過去日は JST 真夜中で確定 → fmtCell で date-only と判定される
//   - 時刻付き ISO 文字列は素通し
function staff_parseFieldDate_(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  var s = String(raw).trim();
  if (!s) return null;
  // 時刻成分付き (T HH:mm or 空白 HH:mm) は通常パース
  if (/[T\s]\d{1,2}:\d{2}/.test(s)) {
    var dx = new Date(s);
    return isNaN(dx.getTime()) ? null : dx;
  }
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    var inputJst = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    var todayJst = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (inputJst === todayJst) return new Date();         // 今日 → 実時刻
    return new Date(inputJst + 'T00:00:00+09:00');        // 過去日 → JST 真夜中
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function staff_apiSaveDetails(payload, email) {
  // 計測: 各セクションの実行時間を _t に集約して返す。Worker 側で Server-Timing に転載。
  var __T = {}; var __mark = Date.now();
  function __lap(name){ var n = Date.now(); __T[name] = n - __mark; __mark = n; }

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
  __lap('open');

  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };
  var rowNum = found.getRow();
  __lap('find');

  // ★ 1op化: ヘッダー + 行データ + フォーミュラ を最小回数で取得
  // 旧実装は cell-by-cell で 15-25 op 走らせていた → このブロックで 3 op に集約
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  var rowRange = sh.getRange(rowNum, 1, 1, lastCol);
  var rowVals = rowRange.getValues()[0];
  var rowFormulas = rowRange.getFormulas()[0];
  __lap('hdr');

  var written = 0;
  var skipped = [];
  var unknown = [];
  // ★ このリクエストで実際に変更したセル列のインデックス（0始まり）。
  //   全行 setValues を廃止し、ここに登録した列だけを書き戻す。これにより
  //   保存中に並行実行された staff_apiUploadImage 等のセル書き込みを、
  //   stale な行スナップショットで上書きしてしまう lost-update を防ぐ。
  var dirtyIdx = {};

  // 販売価格の事前判定は in-memory rowVals から（旧実装は getValue 1 op だった）
  var prevSaleEmpty = false;
  var newSalePrice = null;
  if (fields['販売価格'] !== undefined && fields['販売価格'] !== '' && fields['販売価格'] !== null) {
    var spIdx = col['販売価格'] ? col['販売価格'] - 1 : -1;
    var prev = spIdx >= 0 ? rowVals[spIdx] : '';
    prevSaleEmpty = (prev === '' || prev === null || prev === undefined);
    var nP = Number(fields['販売価格']);
    if (!isNaN(nP)) newSalePrice = nP;
  }

  // 全変更を rowVals に in-memory で適用（書き込みは最後に setValues 1 発）
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (DETAILS_READONLY_[key]) { skipped.push(key); continue; }
    var c = col[key];
    if (!c) { unknown.push(key); continue; }
    // フォーミュラ列は守る（=A2-B2 等を消さない）
    if (rowFormulas[c - 1]) { skipped.push(key); continue; }
    var raw = fields[key];

    var v;
    if (raw === '' || raw === null || raw === undefined) {
      v = '';
    } else if (DETAILS_DATE_[key]) {
      var d = staff_parseFieldDate_(raw);
      v = (d === null) ? String(raw) : d;
    } else if (DETAILS_NUMERIC_[key]) {
      var n = Number(raw);
      if (isNaN(n)) { skipped.push(key); continue; }
      v = n;
    } else {
      v = String(raw);
    }
    rowVals[c - 1] = v;
    dirtyIdx[c - 1] = true;
    written++;
  }
  __lap('write');

  // 販売価格を新規入力した場合は 販売日タイムスタンプ を自動付与（並び替え・監査用）
  if (prevSaleEmpty && newSalePrice !== null) {
    var tsIdx = STAFF_COL.販売日タイムスタンプ ? STAFF_COL.販売日タイムスタンプ - 1 : -1;
    if (tsIdx >= 0 && !rowFormulas[tsIdx]) { rowVals[tsIdx] = new Date(); dirtyIdx[tsIdx] = true; }
  }

  // 採寸関連を更新したら 採寸者を自動補完（明示指定があればそちらを優先）
  var measureFieldUpdated = false;
  for (var j = 0; j < MEASURE_FIELDS.length; j++) {
    if (fields[MEASURE_FIELDS[j]] !== undefined) { measureFieldUpdated = true; break; }
  }
  var mdIdx = STAFF_COL.採寸日 ? STAFF_COL.採寸日 - 1 : -1;
  var mbIdx = STAFF_COL.採寸者 ? STAFF_COL.採寸者 - 1 : -1;
  if (measureFieldUpdated && fields['採寸者'] === undefined) {
    if (mbIdx >= 0 && !rowFormulas[mbIdx]) { rowVals[mbIdx] = email; dirtyIdx[mbIdx] = true; }
  }
  // 採寸者と採寸日はセット必須: 採寸者が入っていて採寸日が空なら当日で補完する
  // （採寸者だけ登録されると報酬計算が合わなくなるため）
  if (mbIdx >= 0 && mdIdx >= 0 && !rowFormulas[mdIdx]) {
    var mbVal = rowVals[mbIdx];
    var mdVal = rowVals[mdIdx];
    if (mbVal !== '' && mbVal !== null && mbVal !== undefined &&
        (mdVal === '' || mdVal === null || mdVal === undefined)) {
      rowVals[mdIdx] = new Date();
      dirtyIdx[mdIdx] = true;
    }
  }
  // 逆パターン: 採寸日が入っていて採寸者が空なら保存をブロックする
  // （このリクエストで採寸日／採寸者を更新した場合のみ判定。既存の片欠け行は触らない）
  if (fields['採寸日'] !== undefined || fields['採寸者'] !== undefined) {
    var chkMd = mdIdx >= 0 ? rowVals[mdIdx] : '';
    var chkMb = mbIdx >= 0 ? rowVals[mbIdx] : '';
    if (chkMd !== '' && chkMd !== null && chkMd !== undefined &&
        (chkMb === '' || chkMb === null || chkMb === undefined)) {
      return { ok: false, error: '採寸日を登録するには採寸者も必須です（採寸者と採寸日はセットで登録してください）' };
    }
  }

  // ステータスを AppSheet IFS 式で再計算（in-memory）
  var statusChanged = false;
  var derivedStatus = '';
  try {
    var calc = staff_calcStatus_(rowVals, col);
    var stIdx = STAFF_COL.ステータス ? STAFF_COL.ステータス - 1 : -1;
    var current = stIdx >= 0 ? String(rowVals[stIdx] || '') : '';
    // calc が '' のときも書き戻す（判定列を削除したらステータスも戻す）
    if (calc !== current && stIdx >= 0 && !rowFormulas[stIdx]) {
      rowVals[stIdx] = calc;
      dirtyIdx[stIdx] = true;
      statusChanged = true;
    }
    derivedStatus = calc;
  } catch(e) {}
  __lap('status');

  // 派生値（粗利・利益・利益率・リードタイム）を in-memory で計算
  // 既存のフォーミュラがあれば触らない（=A2-B2 等のシート式を尊重）。
  // 在庫日数は販売日が空でも今日基準で都度算出するためアプリ側のみで再計算するよう除外。
  try {
    var __spCell = col['販売価格'] ? Number(rowVals[col['販売価格'] - 1] || 0) : 0;
    var __ssCell = col['送料'] ? Number(rowVals[col['送料'] - 1] || 0) : 0;
    var __sfCell = col['手数料'] ? Number(rowVals[col['手数料'] - 1] || 0) : 0;
    var __costCell = col['仕入れ値'] ? Number(rowVals[col['仕入れ値'] - 1] || 0) : 0;
    // 販売価格をクリアした場合も派生値を再計算してシートに反映する。
    var derivedFields = {};
    derivedFields['粗利'] = __spCell - __ssCell - __sfCell;
    derivedFields['利益'] = __spCell - __ssCell - __sfCell - __costCell;
    // 利益率は販売価格 0/空のとき計算できないため空セルにする（NaN/Infinity 抑止）
    derivedFields['利益率'] = (__spCell > 0) ? ((__spCell - __ssCell - __sfCell - __costCell) / __spCell) : '';
    // リードタイム: 出品日 → 販売日（なければ今日）。販売後は販売日で固定
    var __listRaw = col['出品日'] ? rowVals[col['出品日'] - 1] : '';
    var __saleRaw = col['販売日'] ? rowVals[col['販売日'] - 1] : '';
    if (__listRaw) {
      var __ld = (__listRaw instanceof Date) ? __listRaw : new Date(__listRaw);
      var __sd;
      if (__saleRaw) {
        __sd = (__saleRaw instanceof Date) ? __saleRaw : new Date(__saleRaw);
      } else {
        __sd = new Date();
      }
      if (!isNaN(__ld.getTime()) && !isNaN(__sd.getTime())) {
        var __leadDays = Math.floor((__sd.getTime() - __ld.getTime()) / 86400000);
        if (__leadDays >= 0) derivedFields['リードタイム'] = __leadDays;
      }
    }
    Object.keys(derivedFields).forEach(function(fk){
      var fc = col[fk];
      if (!fc) return;
      if (rowFormulas[fc - 1]) return;
      rowVals[fc - 1] = derivedFields[fk];
      dirtyIdx[fc - 1] = true;
    });
  } catch (e) {}
  __lap('derived');

  // ★ 変更したセルだけを書き戻す。
  //   旧実装は全行 setValues([rowVals]) で書き戻していたが、rowVals は
  //   関数冒頭で取得した stale なスナップショット。保存処理中に並行実行された
  //   staff_apiUploadImage（画像列を 1 セル setValue）等の書き込みが、
  //   この全行書き戻しで空値に上書きされていた（画像登録が消えるバグの原因）。
  //   → dirtyIdx に登録した列のみを書く。連続列はまとめて 1 回の setValues、
  //     飛び地は個別レンジで書く（op 数を抑えつつ無関係セルには触れない）。
  var dirtyCols = Object.keys(dirtyIdx).map(Number).sort(function(a, b){ return a - b; });
  if (dirtyCols.length) {
    var runStart = dirtyCols[0];
    var runEnd = dirtyCols[0];
    for (var di = 1; di <= dirtyCols.length; di++) {
      if (di < dirtyCols.length && dirtyCols[di] === runEnd + 1) {
        runEnd = dirtyCols[di];
        continue;
      }
      sh.getRange(rowNum, runStart + 1, 1, runEnd - runStart + 1)
        .setValues([rowVals.slice(runStart, runEnd + 1)]);
      if (di < dirtyCols.length) { runStart = dirtyCols[di]; runEnd = dirtyCols[di]; }
    }
  }
  __lap('flush');

  // record は in-memory rowVals から構築（旧実装は再 getValues + getDisplayValues で 2 op）
  // 日付列は Utilities.formatDate で 'yyyy-MM-dd' に整形（getDisplayValues 相当）
  var record = {};
  try {
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    for (var ck = 0; ck < hdr.length; ck++) {
      var hk = String(hdr[ck] || '').trim();
      if (!hk) continue;
      // 画像列は record に含めない。staff_apiSaveDetails は画像列を一切編集しないため、
      // stale な空値を返すと Worker 側の reconcile が D1 の画像パスを空で上書きしてしまう。
      if (IMAGE_FIELDS_ALLOWED_[hk]) continue;
      var rawV = rowVals[ck];
      if (rawV instanceof Date) {
        // 時刻が 00:00:00 なら日付のみ、そうでなければ datetime
        var hasTime = rawV.getHours() || rawV.getMinutes() || rawV.getSeconds();
        record[hk] = Utilities.formatDate(rawV, tz, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
      } else if (rawV === null || rawV === undefined) {
        record[hk] = '';
      } else {
        record[hk] = rawV;
      }
    }
    // 利益率は表示形式（"1.7%"）に整形して返す（formatProduct と同じロジック）
    var __cost = Number(record['仕入れ値'] || 0);
    var __sp = Number(record['販売価格'] || 0);
    var __ss = Number(record['送料'] || 0);
    var __sf = Number(record['手数料'] || 0);
    if (__sp > 0) {
      record['粗利'] = __sp - __ss - __sf;
      record['利益'] = __sp - __ss - __sf - __cost;
      record['利益率'] = (__sp > 0 ? ((__sp - __ss - __sf - __cost) / __sp * 100).toFixed(1) : '0') + '%';
    }
  } catch (e) {}
  __lap('record');

  staff_invalidateListingCache_(kanri);
  return {
    ok: true,
    message: written + '件更新しました',
    kanri: kanri,
    row: rowNum,
    written: written,
    skipped: skipped,
    unknown: unknown,
    derivedStatus: derivedStatus,
    statusChanged: statusChanged,
    record: record,
    _t: __T
  };
}

// 商品自体の削除（フロントの「商品削除ゾーン」から呼ばれる）
// payload: { kanri }
// 商品管理シートから該当行を deleteRow で物理削除し、Worker /api/sync/row へ
// product_diff を投げて D1 を即時整合させる。説明文キャッシュも失効させる。
// 失敗時は ok:false を返してフロントでトースト表示。
function staff_apiDeleteProduct(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var kanri = String(payload.kanri || '').trim();
  if (!kanri) return { ok: false, error: '管理番号が空です' };

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '該当なし: ' + kanri };
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };

  var rowNum = found.getRow();
  sh.deleteRow(rowNum);

  staff_invalidateListingCache_(kanri);
  // D1 に削除を即時反映（onChange 経由を待たず確実に）
  try {
    var ss = sh.getParent();
    staff_pushDiffOnRemove_(ss);
  } catch (err) {
    console.warn('[staff_apiDeleteProduct] pushDiff failed: ' + (err && err.message));
  }
  return { ok: true, message: '削除しました: ' + kanri, kanri: kanri, row: rowNum, deletedBy: email };
}

// 画像アップロード（QR・バーコード画像 / 売却済み商品画像 / ポストシール）
// payload: { kanri, field, dataUrl }  dataUrl は "data:image/jpeg;base64,..." 形式
// Drive の '商品管理_Images' フォルダ（スプレッドシート親フォルダ配下）にアップロードし、
// 共有URLを当該ヘッダー列に書き込む。
var IMAGE_FIELDS_ALLOWED_ = { 'QR・バーコード画像': 1, '売却済み商品画像': 1, 'ポストシール': 1 };

function staff_apiUploadImage(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var kanri = String(payload.kanri || '').trim();
  var field = String(payload.field || '').trim();
  var dataUrl = String(payload.dataUrl || '');
  if (!kanri) return { ok: false, error: '管理番号が空です' };
  if (!field) return { ok: false, error: 'フィールド名が空です' };
  if (!IMAGE_FIELDS_ALLOWED_[field]) return { ok: false, error: '画像列ではありません: ' + field };
  if (!dataUrl) return { ok: false, error: '画像データが空です' };

  var m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m) return { ok: false, error: 'data URL の形式が不正です' };
  var mime = m[1];
  var b64 = m[2];
  var ext = (mime.split('/')[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  // AppSheet 互換ファイル名: <kanri>.<field>.<HHMMSS>.<ext>
  // ※ AppSheet は秒精度のタイムスタンプ（HHMMSS）。サーバー時刻 JST で揃える。
  var now = new Date();
  var hh = ('0' + now.getHours()).slice(-2);
  var mm = ('0' + now.getMinutes()).slice(-2);
  var ss2 = ('0' + now.getSeconds()).slice(-2);
  var stamp = hh + mm + ss2;
  var fileName = kanri + '.' + field + '.' + stamp + '.' + ext;
  // 相対パス（AppSheet 互換）: 商品管理_Images/<filename> をシートに書き込む
  var relPath = '商品管理_Images/' + fileName;

  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fileName);

  var sh = staff_getSheet_();
  var folder = staff_getImageFolder_('商品管理_Images');
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // 共有設定に失敗してもアップロード自体は成功扱いとする（管理者側で設定可能）
  }
  var url = 'https://drive.google.com/uc?id=' + file.getId();

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'シートが空です' };
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) return { ok: false, error: '該当なし: ' + kanri };
  var rowNum = found.getRow();

  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  if (!col[field]) return { ok: false, error: 'ヘッダーが見つかりません: ' + field };
  // シートには AppSheet 互換の相対パスを書き込む（軽量＋外注も AppSheet で確認可能）
  sh.getRange(rowNum, col[field]).setValue(relPath);

  return { ok: true, path: relPath, url: url, kanri: kanri, field: field, row: rowNum };
}

// AppSheet 旧形式の相対パス (例: "商品管理_Images/zS5.売却済み商品画像.013345.jpg") を Drive のシェアURL に解決
// path 末尾のファイル名で 商品管理_Images フォルダを検索し、ANYONE_WITH_LINK 共有を付与して uc?id= URL を返す
function staff_apiResolveImage(payload, email) {
  payload = payload || {};
  var path = String(payload.path || '').trim();
  if (!path) return { ok: false, error: 'path が空です' };
  // 末尾セグメント = ファイル名
  var idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  var fileName = idx >= 0 ? path.substring(idx + 1) : path;
  if (!fileName) return { ok: false, error: 'ファイル名が抽出できません: ' + path };

  var folder = staff_getImageFolder_('商品管理_Images');
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) return { ok: false, error: 'ファイルが見つかりません: ' + fileName };
  var file = files.next();
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
  var url = 'https://drive.google.com/uc?id=' + file.getId();
  return { ok: true, url: url, fileName: fileName };
}

// ========== 画像セル復旧ツール ==========
// 並行書き込みの lost-update で画像パスが消えた行を救済する。
// Drive の '商品管理_Images' にファイル本体は残っているので、その相対パスを
// 画像列が空のセルにだけ書き戻す（既に値があれば触らない）。
//   - fileName 指定時: getFilesByName で厳密一致（高速）
//   - 未指定時: '<kanri>.<field>.' 前方一致の最新ファイルを採用
// 例: staff_restoreImageCell_('zY162', '売却済み商品画像', 'zY162.売却済み商品画像.091737.jpg')
function staff_restoreImageCell_(kanri, field, fileName) {
  kanri = String(kanri || '').trim();
  field = String(field || '').trim();
  if (!kanri) throw new Error('kanri が空です');
  if (!IMAGE_FIELDS_ALLOWED_[field]) throw new Error('画像列ではありません: ' + field);

  var sh = staff_getSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('シートが空です');
  var idRange = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1);
  var found = idRange.createTextFinder(kanri).matchEntireCell(true).findNext();
  if (!found) throw new Error('該当なし: ' + kanri);
  var rowNum = found.getRow();

  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = buildHeaderMap_(hdr);
  if (!col[field]) throw new Error('ヘッダーが見つかりません: ' + field);

  var folder = staff_getImageFolder_('商品管理_Images');
  var best = null;
  if (fileName) {
    var exact = folder.getFilesByName(String(fileName));
    if (exact.hasNext()) best = exact.next();
  } else {
    var prefix = (kanri + '.' + field + '.').toLowerCase();
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().toLowerCase().indexOf(prefix) === 0) {
        if (!best || f.getDateCreated().getTime() > best.getDateCreated().getTime()) best = f;
      }
    }
  }
  if (!best) throw new Error('Drive にファイルが見つかりません: ' + (fileName || (kanri + '.' + field + '.*')));

  var relPath = '商品管理_Images/' + best.getName();
  var cell = sh.getRange(rowNum, col[field]);
  var before = String(cell.getValue() || '').trim();
  if (before) {
    return { ok: true, skipped: true, reason: '既に値あり', kanri: kanri, field: field, row: rowNum, value: before };
  }
  cell.setValue(relPath);
  staff_invalidateListingCache_(kanri);
  return { ok: true, kanri: kanri, field: field, row: rowNum, restored: relPath, file: best.getName() };
}

// ZY162 の「売却済み商品画像」を復旧する 1 回実行用エントリ（GAS エディタから実行）。
// 実行後、次の Cron 同期（5分以内）で D1 に反映され管理アプリの発送タブに表示される。
function staff_runRestoreZY162() {
  var r = staff_restoreImageCell_('zY162', '売却済み商品画像', 'zY162.売却済み商品画像.091737.jpg');
  Logger.log(JSON.stringify(r, null, 2));
  return r;
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

// 仕入れ管理シートに新規行を追加（AppSheet と同じ 14 列を書き込む）
// payload: { date, category, amount, shipping, planned, place, content, supplierId, registerUser }
// 列順: A=ID, B=仕入れ日, C=区分コード, D=金額, E=送料, F=商品点数, G=納品場所,
//       H=商品原価, I=内容, J=登録者, K=登録日時, L=割当管理番号, M=処理済み, N=仕入先名
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
  var supplierId = String(payload.supplierId || '').trim();
  var registerUser = String(payload.registerUser || '').trim();

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

  // 割当管理番号 (例 zB1~202): 現在の同区分の最大連番を求めて prefix + start ~ end を計算
  var assignedKanri = '';
  if (planned > 0) {
    var prefix = 'z' + category;
    var startN = staff_nextKanriNumber_(ss, prefix);
    var endN = startN + planned - 1;
    assignedKanri = prefix + startN + '~' + endN;
  }

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
    registerUser,    // J列 登録者
    new Date(),      // K列 登録日時
    assignedKanri,   // L列 割当管理番号
    true,            // M列 処理済み (登録時 TRUE)
    supplierId       // N列 仕入先名 (SUP0001 等の ID)
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

  return { ok: true, shiireId: id, row: appendAt, assignedKanri: assignedKanri };
}

// 次の割当開始番号（'z<category>' プレフィックスの最大連番 + 1）を返す。
// 参照元は2系統で、両方の最大値を見る:
//   ① 仕入れ管理シートの割当管理番号(L列) — 例 "zB101~300" の末尾 300。
//      まだ商品管理シートに商品が作られていない「予約済みレンジ」も含めて見るため、
//      同区分を連続で仕入れ登録しても番号レンジが重複しない。
//   ② 商品管理シートの管理番号列 — 予約レンジを持たない実在商品（手入力等）への保険。
// 従来は①を見ておらず、未投入の予約レンジと番号が重複していた。
function staff_nextKanriNumber_(ss, prefix) {
  var pl = prefix.length;
  var maxN = 0;

  // ① 仕入れ管理シートの割当管理番号(L列)= 予約済みレンジの末尾
  var ksh = ss.getSheetByName('仕入れ管理');
  if (ksh && ksh.getLastRow() >= 2) {
    var avals = ksh.getRange(2, 12, ksh.getLastRow() - 1, 1).getValues(); // L=12 割当管理番号
    for (var a = 0; a < avals.length; a++) {
      var av = String(avals[a][0] || '').trim();
      if (!av || av.substring(0, pl) !== prefix) continue;
      // "zB101~300" → 末尾 300 / "zB101"(レンジ無し) → 101
      var tail = av.indexOf('~') >= 0 ? av.substring(av.indexOf('~') + 1) : av.substring(pl);
      var endN = parseInt(tail, 10);
      if (!isNaN(endN) && endN > maxN) maxN = endN;
    }
  }

  // ② 商品管理シートの管理番号列 = 実在商品（予約レンジ無しの保険）
  var psh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (psh && psh.getLastRow() >= 2) {
    var col = STAFF_COL && STAFF_COL.管理番号 ? STAFF_COL.管理番号 : 6;
    var pvals = psh.getRange(2, col, psh.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < pvals.length; r++) {
      var k = String(pvals[r][0] || '').trim();
      if (!k || k.substring(0, pl) !== prefix) continue;
      var n = parseInt(k.substring(pl), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }

  return maxN + 1;
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

  // 仕入れ管理から 区分コード/仕入れ日/商品原価/納品場所 を引く
  var category = '';
  var shiirePurchaseDate = '';
  var shiireUnitCost = '';
  var shiirePlace = '';
  var shiireSh = ss.getSheetByName('仕入れ管理');
  if (shiireSh && shiireSh.getLastRow() >= 2) {
    var sLast = shiireSh.getLastRow();
    var sLastCol = shiireSh.getLastColumn();
    var sHdr = shiireSh.getRange(1, 1, 1, sLastCol).getValues()[0];
    var sCol = buildHeaderMap_(sHdr);
    var sIds = shiireSh.getRange(2, 1, sLast - 1, 1).getValues();
    for (var k = 0; k < sIds.length; k++) {
      if (String(sIds[k][0] || '').trim() === shiireId) {
        var sRow = shiireSh.getRange(k + 2, 1, 1, sLastCol).getValues()[0];
        if (sCol['区分コード']) category = String(sRow[sCol['区分コード'] - 1] || '').trim();
        if (sCol['仕入れ日']) shiirePurchaseDate = sRow[sCol['仕入れ日'] - 1];
        if (sCol['商品原価']) shiireUnitCost = sRow[sCol['商品原価'] - 1];
        if (sCol['納品場所']) shiirePlace = String(sRow[sCol['納品場所'] - 1] || '').trim();
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

  // 採寸登録時の自動書き込み（仕入れ管理 lookup + 派生値 0 初期化 + プロモーション FALSE + タイムスタンプ）
  var shiireUnitCostNum = 0;
  if (col['仕入れ日'] && shiirePurchaseDate !== '' && shiirePurchaseDate !== null && shiirePurchaseDate !== undefined) {
    rowArr[col['仕入れ日'] - 1] = shiirePurchaseDate;
  }
  if (col['仕入れ値'] && shiireUnitCost !== '' && shiireUnitCost !== null && shiireUnitCost !== undefined) {
    shiireUnitCostNum = Number(shiireUnitCost) || 0;
    rowArr[col['仕入れ値'] - 1] = shiireUnitCostNum;
  }
  if (col['納品場所']) rowArr[col['納品場所'] - 1] = shiirePlace;
  if (col['手数料']) rowArr[col['手数料'] - 1] = 0;
  if (col['粗利']) rowArr[col['粗利'] - 1] = 0;
  // 利益 = 粗利(0) - 仕入れ値 = -仕入れ値（販売前のため）
  if (col['利益']) rowArr[col['利益'] - 1] = -shiireUnitCostNum;
  if (col['利益率']) rowArr[col['利益率'] - 1] = 0;
  if (col['リードタイム']) rowArr[col['リードタイム'] - 1] = 0;
  // タイムスタンプは JST 文字列で書き込む（スプレッドシートのTZ設定がUTCでもズレないように）
  if (col['タイムスタンプ']) {
    rowArr[col['タイムスタンプ'] - 1] = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  }
  // プロモーション利用は文字列 'FALSE' で初期化。チェックボックス化はしない
  if (col['プロモーション利用']) rowArr[col['プロモーション利用'] - 1] = 'FALSE';

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
      var d = staff_parseFieldDate_(raw);
      v = (d === null) ? String(raw) : d;
    } else if (DETAILS_NUMERIC_[key]) {
      var n = Number(raw);
      if (isNaN(n)) { skipped.push(key); return; }
      v = n;
    } else {
      v = String(raw);
    }
    rowArr[c - 1] = v;
  });

  // 採寸関連が含まれていたら採寸者を補完
  var measureUpdated = false;
  for (var j = 0; j < MEASURE_FIELDS.length; j++) {
    if (fields[MEASURE_FIELDS[j]] !== undefined && fields[MEASURE_FIELDS[j]] !== '') { measureUpdated = true; break; }
  }
  if (measureUpdated && fields['採寸者'] === undefined && col['採寸者']) {
    rowArr[col['採寸者'] - 1] = email;
  }
  // 採寸者と採寸日はセット必須: 採寸者が入っていて採寸日が空なら当日で補完する
  // （採寸者だけ登録されると報酬計算が合わなくなるため）
  if (col['採寸者'] && col['採寸日']) {
    var mbV = rowArr[col['採寸者'] - 1];
    var mdV = rowArr[col['採寸日'] - 1];
    if (mbV !== '' && mbV !== null && mbV !== undefined &&
        (mdV === '' || mdV === null || mdV === undefined)) {
      rowArr[col['採寸日'] - 1] = new Date();
    }
    // 逆パターン: 採寸日が入っていて採寸者が空なら新規登録をブロックする
    var mbV2 = rowArr[col['採寸者'] - 1];
    var mdV2 = rowArr[col['採寸日'] - 1];
    if (mdV2 !== '' && mdV2 !== null && mdV2 !== undefined &&
        (mbV2 === '' || mbV2 === null || mbV2 === undefined)) {
      return { ok: false, error: '採寸日を登録するには採寸者も必須です（採寸者と採寸日はセットで登録してください）' };
    }
  }

  // 書き込み前にステータスを IFS 式で再計算（payload で日付が指定されていれば反映）
  // payload.status は外部からの上書き指定。空でなければ尊重し、空ならルール優先
  var calcStatus = staff_calcStatus_(rowArr, col);
  if (calcStatus) rowArr[STAFF_COL.ステータス - 1] = calcStatus;

  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, width).setValues([rowArr]);

  return { ok: true, kanri: kanri, productId: productId, row: appendAt, skipped: skipped, unknown: unknown };
}

// ═══════════════════════════════════════════════════════════════════════════
// 行単位即時同期: 商品管理 / 仕入れ管理 を編集すると Cloudflare Workers の
// /api/sync/row へ POST して D1 を即時 UPSERT する。
//
// 制約 (重要):
//  - 同一 GAS プロジェクト内のスクリプト書き込み (Range#setValue 等) は
//    installable トリガーが発火しない。よって 別アプリ (AppSheet, スタッフアプリ
//    経由の他関数, etc.) からの書き込み・手動編集に限り即時反映される。
//  - 5分 Cron は引き続き走るので、トリガーが発火しなかった更新もいずれは追従する。
//  - 削除整合性は 5分 Cron に委譲（onEdit では行削除を検知できない）。
//
// セットアップ:
//  - GAS エディタで staff_setupSyncTriggers() を一度だけ手動実行
//  - WORKERS_WEBHOOK_URL を Script Property に保存（未設定なら下記既定 URL を使用）
// ═══════════════════════════════════════════════════════════════════════════

var STAFF_WORKERS_DEFAULT_URL = 'https://shiire-kanri.nsdktts1030.workers.dev';

function staff_onEditTrigger(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();
    var firstRow = e.range.getRow();
    var numRows = e.range.getNumRows() || 1;
    if (firstRow < 2) return; // ヘッダーは無視

    if (name === STAFF_SHEET_NAME) {
      // ステータス判定列（出品日/販売日/発送日付/完了日/撮影日付/採寸日/廃棄日/返品日付/キャンセル日）が
      // 編集範囲に含まれていれば、行ごとに再計算する。
      // シート直接編集や AppSheet 経由での日付入力でステータスが古いまま放置される問題を解消。
      // GAS の installable トリガーは自身の setValue では再発火しないので、ここでの再書き込みはループしない。
      try {
        var firstColE = e.range.getColumn();
        var numColsE = e.range.getNumColumns() || 1;
        var hdrE = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var colE = buildHeaderMap_(hdrE);
        var STATUS_DRIVERS = ['出品日','販売日','発送日付','完了日','撮影日付','採寸日','廃棄日','返品日付','キャンセル日'];
        var triggersStatus = false;
        for (var k = 0; k < STATUS_DRIVERS.length; k++) {
          var cIdx = colE[STATUS_DRIVERS[k]];
          if (cIdx && cIdx >= firstColE && cIdx < firstColE + numColsE) { triggersStatus = true; break; }
        }
        if (triggersStatus) {
          for (var rr = 0; rr < numRows; rr++) {
            try { staff_recomputeStatus_(sh, firstRow + rr, hdrE, colE); } catch(_) {}
          }
        }
      } catch (errSt) {
        console.warn('[staff_onEditTrigger:recomputeStatus] ' + (errSt && errSt.message));
      }

      var items = [];
      for (var i = 0; i < numRows; i++) {
        var item = staff_buildProductRowPayload_(sh, firstRow + i);
        if (item && item.kanri) items.push(item);
      }
      if (items.length) staff_pushRowsToWorkers_('product', items);
    } else if (name === '仕入れ管理') {
      var items2 = [];
      for (var j = 0; j < numRows; j++) {
        var it2 = staff_buildPurchaseRowPayload_(sh, firstRow + j);
        if (it2 && it2.shiireId) items2.push(it2);
      }
      if (items2.length) staff_pushRowsToWorkers_('purchase', items2);
    }
  } catch (err) {
    console.error('[staff_onEditTrigger]', err && err.message);
  }
}

// onChange: AppSheet の INSERT_ROW / 行追加・削除など、onEdit が捕捉しない構造変更
// changeType=EDIT/INSERT_ROW/INSERT_GRID/REMOVE_ROW 等で発火する。
//  - REMOVE_ROW: 商品管理/仕入れ管理の現在のID列セットを Worker に送り、D1 で diff 削除
//  - INSERT_ROW/EDIT/OTHER: 最終行を再 push（AppSheet INSERT の補完）
function staff_onChangeTrigger(e) {
  try {
    if (!e) return;
    var ct = String(e.changeType || '');
    var ss = staff_getActiveSpreadsheet_();

    if (ct === 'REMOVE_ROW') {
      staff_pushDiffOnRemove_(ss);
      return;
    }

    if (ct !== 'INSERT_ROW' && ct !== 'EDIT' && ct !== 'OTHER') return;
    // 商品管理 / 仕入れ管理 の最終行のみを再 push（onEdit に拾われない AppSheet INSERT 用の補完）
    var pSh = ss.getSheetByName(STAFF_SHEET_NAME);
    if (pSh && pSh.getLastRow() >= 2) {
      var pItem = staff_buildProductRowPayload_(pSh, pSh.getLastRow());
      if (pItem && pItem.kanri) staff_pushRowsToWorkers_('product', [pItem]);
    }
    var qSh = ss.getSheetByName('仕入れ管理');
    if (qSh && qSh.getLastRow() >= 2) {
      var qItem = staff_buildPurchaseRowPayload_(qSh, qSh.getLastRow());
      if (qItem && qItem.shiireId) staff_pushRowsToWorkers_('purchase', [qItem]);
    }
  } catch (err) {
    console.error('[staff_onChangeTrigger]', err && err.message);
  }
}

// REMOVE_ROW 時: 商品管理シートの管理番号列 / 仕入れ管理シートの仕入れID列を全取得し、
// 「現在のID集合」を Worker に送って D1 から失われたIDを削除させる。
// シート全行 × 1列だけ getValues するので 5000 行でも 100〜300ms 程度。
function staff_pushDiffOnRemove_(ss) {
  // 商品管理: 管理番号列
  try {
    var pSh = ss.getSheetByName(STAFF_SHEET_NAME);
    if (pSh && pSh.getLastRow() >= 2) {
      var pVals = pSh.getRange(2, STAFF_COL.管理番号, pSh.getLastRow() - 1, 1).getValues();
      var kanris = [];
      for (var i = 0; i < pVals.length; i++) {
        var k = String(pVals[i][0] || '').trim();
        if (k) kanris.push(k);
      }
      staff_pushDiffToWorkers_('product_diff', { kanris: kanris });
    }
  } catch (err) {
    console.warn('[staff_pushDiffOnRemove_:product] ' + (err && err.message));
  }
  // 仕入れ管理: ヘッダー名「仕入れID」を動的に解決
  try {
    var qSh = ss.getSheetByName('仕入れ管理');
    if (qSh && qSh.getLastRow() >= 2) {
      var qHdr = qSh.getRange(1, 1, 1, qSh.getLastColumn()).getValues()[0];
      var idCol = 0;
      for (var j = 0; j < qHdr.length; j++) {
        if (String(qHdr[j] || '').trim() === '仕入れID') { idCol = j + 1; break; }
      }
      if (idCol) {
        var qVals = qSh.getRange(2, idCol, qSh.getLastRow() - 1, 1).getValues();
        var ids = [];
        for (var k2 = 0; k2 < qVals.length; k2++) {
          var id2 = String(qVals[k2][0] || '').trim();
          if (id2) ids.push(id2);
        }
        staff_pushDiffToWorkers_('purchase_diff', { shiireIds: ids });
      }
    }
  } catch (err) {
    console.warn('[staff_pushDiffOnRemove_:purchase] ' + (err && err.message));
  }
}

// 削除 diff payload を Worker /api/sync/row に POST。失敗は warn のみ（次の Cron で追従）
function staff_pushDiffToWorkers_(type, extra) {
  try {
    var sp = PropertiesService.getScriptProperties();
    var url = sp.getProperty('WORKERS_WEBHOOK_URL') || STAFF_WORKERS_DEFAULT_URL;
    var secret = sp.getProperty('SHIIRE_SYNC_SECRET') || '';
    if (!url || !secret) {
      console.warn('[staff_pushDiffToWorkers_] missing url/secret');
      return;
    }
    var body = { type: type };
    if (extra && extra.kanris) body.kanris = extra.kanris;
    if (extra && extra.shiireIds) body.shiireIds = extra.shiireIds;
    var endpoint = url.replace(/\/$/, '') + '/api/sync/row';
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sync-Secret': secret },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      console.warn('[staff_pushDiffToWorkers_] http ' + code + ' ' + (res.getContentText() || '').slice(0, 120));
    }
  } catch (err) {
    console.warn('[staff_pushDiffToWorkers_] ' + (err && err.message));
  }
}

// 商品管理 1行ぶんを D1 UPSERT 互換ペイロードに変換 (staff_syncDumpProducts と同じ items 形状)
function staff_buildProductRowPayload_(sh, rowNum) {
  if (rowNum < 2) return null;
  var ss = sh.getParent();
  var lastCol = Math.max(STAFF_COL.販売日タイムスタンプ, sh.getLastColumn());
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = hdr.map(function(v){ return String(v || '').trim(); });
  var row = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var sheetTz = ss.getSpreadsheetTimeZone() || tz;
  function fmtDate(d) {
    if (d instanceof Date) return Utilities.formatDate(d, sheetTz, 'yyyy-MM-dd');
    return String(d || '');
  }
  function fmtTs(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return String(d || '');
  }
  // 「日付のみ」セルは JST/UTC/PDT のいずれかで 00:00:00 になるので、
  // 3 TZ いずれかで真夜中なら date-only と判定する（fmtCell コメント参照）
  function fmtCell(d) {
    if (d instanceof Date) {
      var hmsJst = Utilities.formatDate(d, sheetTz, 'HH:mm:ss');
      var hmsUtc = Utilities.formatDate(d, 'UTC', 'HH:mm:ss');
      var hmsLa  = Utilities.formatDate(d, 'America/Los_Angeles', 'HH:mm:ss');
      if (hmsJst === '00:00:00' || hmsUtc === '00:00:00' || hmsLa === '00:00:00') {
        return Utilities.formatDate(d, sheetTz, 'yyyy-MM-dd');
      }
      return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    if (d === null || d === undefined) return '';
    return String(d);
  }
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  var kanri = String(row[STAFF_COL.管理番号 - 1] || '').trim();
  if (!kanri) return null;

  var measure = {};
  MEASURE_FIELDS.forEach(function(f) {
    var v = row[STAFF_COL[f] - 1];
    if (v !== '' && v !== null && v !== undefined) {
      var n = Number(v);
      if (!isNaN(n)) measure[f] = n;
    }
  });

  var extra = {};
  for (var c = 0; c < headers.length; c++) {
    var hname = headers[c];
    if (!hname) continue;
    extra[hname] = fmtCell(row[c]);
  }

  // 派生値の上書き計算（staff_apiSaveDetails:1184-1191 と同一ロジック）
  // セル側に formula や stale 値が残っていても webhook 経路では常に再計算する
  var __cost = Number(extra['仕入れ値'] || 0);
  var __sp = Number(extra['販売価格'] || 0);
  var __ss = Number(extra['送料'] || 0);
  var __sf = Number(extra['手数料'] || 0);
  if (__sp > 0) {
    extra['粗利'] = __sp - __ss - __sf;
    extra['利益'] = __sp - __ss - __sf - __cost;
    extra['利益率'] = ((__sp - __ss - __sf - __cost) / __sp * 100).toFixed(1) + '%';
  }
  // 在庫日数: 仕入れ日 → 販売日 (なければ今日)
  try {
    var __startStr = extra['仕入れ日'];
    if (__startStr) {
      var __start = new Date(__startStr);
      var __endStr = extra['販売日'];
      var __end = __endStr ? new Date(__endStr) : new Date();
      if (!isNaN(__start.getTime()) && !isNaN(__end.getTime())) {
        var __days = Math.floor((__end.getTime() - __start.getTime()) / 86400000);
        if (__days >= 0) extra['在庫日数'] = __days;
      }
    }
  } catch (e) {}
  // リードタイム: 出品日 → 販売日（なければ今日）。販売後は販売日で固定
  try {
    var __listStr = extra['出品日'];
    if (__listStr) {
      var __a = new Date(__listStr);
      var __saleStr = extra['販売日'];
      var __b = __saleStr ? new Date(__saleStr) : new Date();
      if (!isNaN(__a.getTime()) && !isNaN(__b.getTime())) {
        var __ld = Math.floor((__b.getTime() - __a.getTime()) / 86400000);
        if (__ld >= 0) extra['リードタイム'] = __ld;
      }
    }
  } catch (e) {}

  return {
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
    row: rowNum
  };
}

// 仕入れ管理 1行ぶんを D1 UPSERT 互換ペイロードに変換
function staff_buildPurchaseRowPayload_(sh, rowNum) {
  if (rowNum < 2) return null;
  var ss = sh.getParent();
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < hdr.length; i++) { var hk = String(hdr[i] || '').trim(); if (hk && !(hk in col)) col[hk] = i + 1; }
  if (!col['仕入れID']) return null;

  var row = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var sheetTz = ss.getSpreadsheetTimeZone() || tz;
  function val(name) { return col[name] ? row[col[name] - 1] : ''; }
  function num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isNaN(n) ? 0 : Math.round(n);
  }

  var id = String(val('仕入れID') || '').trim();
  if (!id) return null;
  var date = val('仕入れ日');
  var dateStr = (date instanceof Date) ? Utilities.formatDate(date, sheetTz, 'yyyy-MM-dd') : String(date || '');
  var registeredAtRaw = val('登録日時');
  var registeredAtStr = (registeredAtRaw instanceof Date)
    ? Utilities.formatDate(registeredAtRaw, tz, 'yyyy-MM-dd HH:mm:ss')
    : String(registeredAtRaw || '');
  var processedRaw = val('処理済み');
  var processed = (processedRaw === true) || (String(processedRaw).toLowerCase() === 'true');

  return {
    shiireId: id,
    date: dateStr,
    amount: num(val('金額')),
    shipping: num(val('送料')),
    planned: num(val('商品点数')),
    place: String(val('納品場所') || ''),
    cost: num(val('商品原価')),
    category: String(val('区分コード') || ''),
    content: String(val('内容') || ''),
    supplierId: String(val('仕入先名') || ''),
    registerUser: String(val('登録者') || ''),
    registeredAt: registeredAtStr,
    assignedKanri: String(val('割当管理番号') || ''),
    processed: processed,
    row: rowNum
  };
}

// Workers webhook へ POST。タイムアウトは 5 秒程度で諦める（編集体験を阻害しない）。
function staff_pushRowsToWorkers_(type, items) {
  try {
    var sp = PropertiesService.getScriptProperties();
    var url = sp.getProperty('WORKERS_WEBHOOK_URL') || STAFF_WORKERS_DEFAULT_URL;
    var secret = sp.getProperty('SHIIRE_SYNC_SECRET') || '';
    if (!url || !secret) {
      console.warn('[staff_pushRowsToWorkers_] missing url/secret');
      return;
    }
    var endpoint = url.replace(/\/$/, '') + '/api/sync/row';
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sync-Secret': secret },
      payload: JSON.stringify({ type: type, items: items }),
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      console.warn('[staff_pushRowsToWorkers_] http ' + code + ' ' + (res.getContentText() || '').slice(0, 120));
    }
  } catch (err) {
    console.warn('[staff_pushRowsToWorkers_] ' + (err && err.message));
  }
}

// セットアップ: GASエディタから一度だけ手動実行
//   - 既存の staff_onEditTrigger / staff_onChangeTrigger を一度全削除して再作成
//   - WORKERS_WEBHOOK_URL が Script Property に未設定なら警告のみ（既定 URL でフォールバック）
function staff_setupSyncTriggers() {
  var ss = staff_getActiveSpreadsheet_();
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'staff_onEditTrigger' || fn === 'staff_onChangeTrigger') {
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  });
  ScriptApp.newTrigger('staff_onEditTrigger').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('staff_onChangeTrigger').forSpreadsheet(ss).onChange().create();
  var sp = PropertiesService.getScriptProperties();
  if (!sp.getProperty('WORKERS_WEBHOOK_URL')) {
    sp.setProperty('WORKERS_WEBHOOK_URL', STAFF_WORKERS_DEFAULT_URL);
  }
  if (!sp.getProperty('SHIIRE_SYNC_SECRET')) {
    Logger.log('警告: SHIIRE_SYNC_SECRET が未設定です。staff_setupSyncSecret を先に実行してください。');
  }
  Logger.log('staff_setupSyncTriggers: 削除 ' + deleted + ' 件 / 新規 onEdit + onChange を登録しました。');
}

// 手動テスト: 商品管理シートの管理番号セットを今すぐ Worker に POST し、
// D1 で diff 削除（=シートに無い管理番号を D1 から削除）を強制する。
// GAS エディタから「実行」 → ログに HTTP レスポンスが出れば疎通OK。
//   - HTTP 200 + {"deleted": N}: 即時削除パスが動いた
//   - HTTP 200 + {"deleted": 0}: シートと D1 が完全一致
//   - HTTP 4xx/5xx: secret/URL/ペイロード形式を疑う
function staff_testDiffDeleteNow() {
  var ss = staff_getActiveSpreadsheet_();
  var pSh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!pSh || pSh.getLastRow() < 2) { Logger.log('シートに行がありません'); return; }
  var pVals = pSh.getRange(2, STAFF_COL.管理番号, pSh.getLastRow() - 1, 1).getValues();
  var kanris = [];
  for (var i = 0; i < pVals.length; i++) {
    var k = String(pVals[i][0] || '').trim();
    if (k) kanris.push(k);
  }
  Logger.log('シートの管理番号件数: ' + kanris.length);
  var sp = PropertiesService.getScriptProperties();
  var url = (sp.getProperty('WORKERS_WEBHOOK_URL') || STAFF_WORKERS_DEFAULT_URL).replace(/\/$/, '') + '/api/sync/row';
  var secret = sp.getProperty('SHIIRE_SYNC_SECRET') || '';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Secret': secret },
    payload: JSON.stringify({ type: 'product_diff', kanris: kanris }),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  Logger.log('HTTP ' + res.getResponseCode() + ' ' + res.getContentText());
}
