// StaffApiExtras.gs — Cloudflare 版 shiire-kanri 用の追加 API
// AppSheet 互換タブ（場所移動・返送・AI画像判定・作業者・業務メニュー）の読み書き

// Web App 文脈では getActiveSpreadsheet() が null を返すため SPREADSHEET_ID で開く
function staff_getActiveSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!ssId) throw new Error('SPREADSHEET_ID が未設定');
  return SpreadsheetApp.openById(ssId);
}

// ========== 場所移動（移動報告シート） ==========

// 移動報告シートの全行を一覧で返す
// COLS: ID(1) TIMESTAMP(2) REPORTER(3) DESTINATION(4) IDS(5) DONE(6)
function staff_listMoves(opts) {
  opts = opts || {};
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 200));
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('移動報告');
  if (!sh) return { ok: true, items: [] };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 6).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  function fmt(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm");
    return String(d || '');
  }
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var moveId = String(row[0] || '').trim();
    if (!moveId) continue;
    var done = String(row[5] || '').trim().toUpperCase() === 'TRUE';
    out.push({
      row: i + 2,
      moveId: moveId,
      timestamp: fmt(row[1]),
      reporter: String(row[2] || ''),
      destination: String(row[3] || ''),
      ids: String(row[4] || ''),
      done: done
    });
  }
  out.sort(function(a, b){ return String(b.timestamp).localeCompare(String(a.timestamp)); });
  return { ok: true, items: out.slice(0, limit), total: out.length };
}

// 移動報告を新規作成
// payload: { destination: string, ids: string, reporter?: string }
// moveId は自動採番 MV-yyyyMMdd-HHmmss
function staff_apiCreateMove(payload, email) {
  payload = payload || {};
  var destination = String(payload.destination || '').trim();
  var ids = String(payload.ids || '').trim();
  if (!destination) return { ok: false, error: '移動先を指定してください' };
  if (!ids) return { ok: false, error: '管理番号を指定してください' };
  var reporter = String(payload.reporter || '').trim() || String(email || '');
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('移動報告');
  if (!sh) return { ok: false, error: '移動報告シートが見つかりません' };
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var now = new Date();
  // クライアント側で AppSheet 互換の moveId が事前生成されていればそれを採用、無ければ生成
  var moveId = String(payload.moveId || '').trim();
  if (!moveId) {
    moveId = 'MV-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
  }
  var rowArr = [moveId, now, reporter, destination, ids, 'FALSE'];
  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, 6).setValues([rowArr]);
  // onChange トリガー任せにせず、append 直後に処理を走らせて即時「反映済」にする
  // （AppSheet 互換: 登録 → 数秒以内に商品管理の納品場所が更新される）
  try {
    if (typeof processPendingMoves_ === 'function') {
      withLock_(20000, function(){ processPendingMoves_(); });
    }
  } catch (err) {
    console.warn('staff_apiCreateMove: processPendingMoves_ failed: ' + err);
  }
  return { ok: true, moveId: moveId, row: appendAt };
}

// ========== 返送管理 ==========

// 返送管理シート: A=箱ID B=報告者 C=移動先 D=管理番号 E=着数 F=備考
function staff_listReturns(opts) {
  opts = opts || {};
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 200));
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('返送管理');
  if (!sh) return { ok: true, items: [] };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 6).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var boxId = String(row[0] || '').trim();
    if (!boxId) continue;
    out.push({
      row: i + 2,
      boxId: boxId,
      reporter: String(row[1] || ''),
      destination: String(row[2] || ''),
      ids: String(row[3] || ''),
      count: row[4] === '' || row[4] == null ? '' : Number(row[4]),
      note: String(row[5] || '')
    });
  }
  out.sort(function(a, b){ return String(b.boxId).localeCompare(String(a.boxId)); });
  return { ok: true, items: out.slice(0, limit), total: out.length };
}

// 返送を新規作成
// payload: { destination, ids, count?, note?, boxId?, reporter? }
function staff_apiCreateReturn(payload, email) {
  payload = payload || {};
  var destination = String(payload.destination || '').trim();
  var ids = String(payload.ids || '').trim();
  if (!destination) return { ok: false, error: '移動先を指定してください' };
  if (!ids) return { ok: false, error: '管理番号を指定してください' };
  var reporter = String(payload.reporter || '').trim() || String(email || '');
  var note = String(payload.note || '');
  var count = (payload.count === '' || payload.count == null) ? '' : Number(payload.count);
  if (count !== '' && isNaN(count)) count = '';

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('返送管理');
  if (!sh) return { ok: false, error: '返送管理シートが見つかりません' };
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) {
    boxId = 'RT-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  }
  var rowArr = [boxId, reporter, destination, ids, count, note];
  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, 6).setValues([rowArr]);
  // onChange トリガー任せにせず、append 直後に処理を走らせて即時にステータス＝返品済みへ反映
  try {
    if (typeof updateReturnStatusNowInner_ === 'function') {
      withLock_(20000, function(){ updateReturnStatusNowInner_(); });
    }
  } catch (err) {
    console.warn('staff_apiCreateReturn: updateReturnStatusNowInner_ failed: ' + err);
  }
  return { ok: true, boxId: boxId, row: appendAt };
}

// ========== AI 画像判定一覧 ==========

// AI画像判定シートを最新200件で返す（kanri + 全項目）
function staff_listAiResults(opts) {
  opts = opts || {};
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 200));
  var q = String(opts.q || '').trim().toLowerCase();
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('AI画像判定');
  if (!sh) return { ok: true, items: [], headers: [] };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, items: [], headers: [] };
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v || '').trim(); });
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var midIdx = headers.indexOf('管理番号');
  if (midIdx < 0) return { ok: true, items: [], headers: headers };
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  function fmtCell(v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (v == null) return '';
    return String(v);
  }
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var kanri = String(row[midIdx] || '').trim();
    if (!kanri) continue;
    var item = { row: i + 2, kanri: kanri, fields: {} };
    for (var c = 0; c < headers.length; c++) {
      var name = headers[c];
      if (!name || name === '管理番号') continue;
      item.fields[name] = fmtCell(row[c]);
    }
    if (q) {
      var hay = (kanri + ' ' + Object.keys(item.fields).map(function(k){ return item.fields[k]; }).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }
    out.push(item);
  }
  out.sort(function(a, b){ return String(b.kanri).localeCompare(String(a.kanri)); });
  return { ok: true, items: out.slice(0, limit), total: out.length, headers: headers };
}

// ========== 作業者管理 ==========

// 作業者マスター + 商品管理シートからの月次集計を返す
// items: [{ name, email, monthly: { ym: {sokutei, satsuei} } }]
function staff_listSagyousha(opts) {
  opts = opts || {};
  var months = Math.min(12, Math.max(1, parseInt(opts.months, 10) || 6));
  var ss = staff_getActiveSpreadsheet_();
  // 作業者マスター
  var masterSh = ss.getSheetByName('作業者マスター');
  var workers = [];
  if (masterSh && masterSh.getLastRow() >= 2) {
    var lastRow = masterSh.getLastRow();
    var values = masterSh.getRange(2, 1, lastRow - 1, 15).getValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var enabled = row[14];
      var isTrue = (enabled === true) || (String(enabled).toLowerCase() === 'true');
      if (!isTrue) continue;
      var name = String(row[1] || '').trim();
      if (!name) continue;
      var email1 = String(row[3] || '').trim().toLowerCase();
      var email2 = String(row[4] || '').trim().toLowerCase();
      workers.push({ name: name, email: email1 || email2, monthly: {} });
    }
  }
  // 商品管理: 採寸日(33)/採寸者(34) と 撮影日付(35)/撮影者(36) を集計
  var prodSh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (prodSh && prodSh.getLastRow() >= 2) {
    var pLast = prodSh.getLastRow();
    var pVals = prodSh.getRange(2, 33, pLast - 1, 4).getValues(); // 列 33-36
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var workerMap = {};
    workers.forEach(function(w){ workerMap[w.name] = w; });
    function getYm(d) {
      if (!(d instanceof Date)) return '';
      return Utilities.formatDate(d, tz, 'yyyy-MM');
    }
    for (var i = 0; i < pVals.length; i++) {
      var sokuteiYm = getYm(pVals[i][0]);
      var sokuteiUser = String(pVals[i][1] || '').trim();
      var satsueiYm = getYm(pVals[i][2]);
      var satsueiUser = String(pVals[i][3] || '').trim();
      function bumpUser(name, ym, kind) {
        if (!name || !ym) return;
        var w = workerMap[name];
        if (!w) {
          w = { name: name, email: '', monthly: {} };
          workerMap[name] = w;
          workers.push(w);
        }
        if (!w.monthly[ym]) w.monthly[ym] = { sokutei: 0, satsuei: 0 };
        w.monthly[ym][kind]++;
      }
      bumpUser(sokuteiUser, sokuteiYm, 'sokutei');
      bumpUser(satsueiUser, satsueiYm, 'satsuei');
    }
  }
  // 直近 months ヶ月のキー一覧
  var now = new Date();
  var ymList = [];
  for (var m = 0; m < months; m++) {
    var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    ymList.push(Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM'));
  }
  return { ok: true, items: workers, months: ymList };
}

// ========== 業務メニュー（汎用シートダンプ） ==========

// 任意のシートをヘッダー＋行で返す（読み取り専用）
// payload: { name: string, limit?: number }
function staff_dumpSheet(payload) {
  payload = payload || {};
  var name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  var limit = Math.min(500, Math.max(10, parseInt(payload.limit, 10) || 200));
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) return { ok: false, error: 'sheet not found: ' + name };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { ok: true, headers: [], rows: [] };
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v || '').trim(); });
  if (lastRow < 2) return { ok: true, headers: headers, rows: [] };
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  // 末尾から limit 件を取得（新しい順表示）
  var start = Math.max(0, values.length - limit);
  var sliced = values.slice(start).reverse();
  return { ok: true, headers: headers, rows: sliced, total: values.length };
}

// ========== ワンショット: 採寸未済なのに「出品待ち」になっている行をクリーンアップ ==========
// SyncApi.importPhotographyData_ の旧仕様で誤って付与されたステータスを修正する。
// 商品管理シートで status='出品待ち' AND 採寸日空 の行を '採寸待ち' に上書き。
// GASエディタから一回だけ実行して使う。
function cleanupOrphanShuppinMachi() {
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh) throw new Error('sheet not found: ' + STAFF_SHEET_NAME);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, fixed: [] };

  var statusVals = sh.getRange(2, STAFF_COL.ステータス, lastRow - 1, 1).getValues();
  var saisunVals = sh.getRange(2, STAFF_COL.採寸日,   lastRow - 1, 1).getValues();
  var kanriVals  = sh.getRange(2, STAFF_COL.管理番号, lastRow - 1, 1).getValues();

  var fixed = [];
  for (var i = 0; i < statusVals.length; i++) {
    var st = String(statusVals[i][0] || '').trim();
    var sa = String(saisunVals[i][0] || '').trim();
    if (st === '出品待ち' && !sa) {
      sh.getRange(i + 2, STAFF_COL.ステータス).setValue('採寸待ち');
      fixed.push(String(kanriVals[i][0] || ''));
    }
  }
  Logger.log('Fixed ' + fixed.length + ' rows: ' + fixed.join(', '));
  return { ok: true, fixed: fixed };
}

