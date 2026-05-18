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
  // B列(タイムスタンプ)は秒まで表示する書式に統一
  sh.getRange(appendAt, 2).setNumberFormat('yyyy-MM-dd HH:mm:ss');
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

// 返送管理シート: A=箱ID B=報告者 C=移動先 D=管理番号 E=着数 F=備考 G=返送日
function staff_listReturns(opts) {
  opts = opts || {};
  var limit = Math.min(500, Math.max(10, parseInt(opts.limit, 10) || 200));
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('返送管理');
  if (!sh) return { ok: true, items: [] };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  function fmt(d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm");
    return String(d || '');
  }
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
      note: String(row[5] || ''),
      timestamp: fmt(row[6])
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
  var now = new Date();
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) {
    boxId = 'RT-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
  }
  var rowArr = [boxId, reporter, destination, ids, count, note, now];
  var appendAt = sh.getLastRow() + 1;
  sh.getRange(appendAt, 1, 1, 7).setValues([rowArr]);
  // G列(返送日)は秒まで表示する書式に統一
  sh.getRange(appendAt, 7).setNumberFormat('yyyy-MM-dd HH:mm:ss');
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

// ========== 削除 API ==========
// 注意: 場所移動・返送は登録時に商品管理シートの「納品場所」「ステータス」を
// 書き換えているが、削除では元に戻さない（記録のみ削除）。
// 戻し処理が必要な場合は手動で再登録するか、別途専用UIを設ける。

// 移動報告を削除: payload.moveId で行を特定
function staff_apiDeleteMove(payload, email) {
  payload = payload || {};
  var moveId = String(payload.moveId || '').trim();
  if (!moveId) return { ok: false, error: 'moveId required' };
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('移動報告');
  if (!sh) return { ok: false, error: '移動報告シートが見つかりません' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '対象が見つかりません' };
  // 同時削除衝突を避けるため LockService（既存パターンの withLock_ を使用）
  var deleted = false;
  withLock_(20000, function(){
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === moveId) {
        sh.deleteRow(i + 2);
        deleted = true;
        break;
      }
    }
  });
  if (!deleted) return { ok: false, error: '対象が見つかりません: ' + moveId };
  return { ok: true, moveId: moveId };
}

// 返送管理を削除: payload.boxId で行を特定
function staff_apiDeleteReturn(payload, email) {
  payload = payload || {};
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) return { ok: false, error: 'boxId required' };
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('返送管理');
  if (!sh) return { ok: false, error: '返送管理シートが見つかりません' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '対象が見つかりません' };
  var deleted = false;
  withLock_(20000, function(){
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === boxId) {
        sh.deleteRow(i + 2);
        deleted = true;
        break;
      }
    }
  });
  if (!deleted) return { ok: false, error: '対象が見つかりません: ' + boxId };
  return { ok: true, boxId: boxId };
}

// ========== 編集 API ==========
// 移動報告を編集: payload.moveId で行を特定し、報告者/移動先/管理番号を上書き
// 既存行を残したまま値だけ更新し、processPendingMoves_ で商品管理側を再反映する。
function staff_apiUpdateMove(payload, email) {
  payload = payload || {};
  var moveId = String(payload.moveId || '').trim();
  if (!moveId) return { ok: false, error: 'moveId required' };
  var destination = String(payload.destination || '').trim();
  var ids = String(payload.ids || '').trim();
  if (!destination) return { ok: false, error: '移動先を指定してください' };
  if (!ids) return { ok: false, error: '管理番号を指定してください' };
  var reporter = String(payload.reporter || '').trim() || String(email || '');
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('移動報告');
  if (!sh) return { ok: false, error: '移動報告シートが見つかりません' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '対象が見つかりません' };
  var updatedRow = 0;
  withLock_(20000, function(){
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === moveId) {
        var r = i + 2;
        // B=タイムスタンプ は据え置き、C=報告者 D=移動先 E=管理番号 を上書き
        sh.getRange(r, 3).setValue(reporter);
        sh.getRange(r, 4).setValue(destination);
        sh.getRange(r, 5).setValue(ids);
        // F=反映フラグ を FALSE に戻して再反映キューに乗せる
        sh.getRange(r, 6).setValue('FALSE');
        updatedRow = r;
        break;
      }
    }
  });
  if (!updatedRow) return { ok: false, error: '対象が見つかりません: ' + moveId };
  // 即時反映（onChange トリガー任せにせず、商品管理側の納品場所を更新）
  try {
    if (typeof processPendingMoves_ === 'function') {
      withLock_(20000, function(){ processPendingMoves_(); });
    }
  } catch (err) {
    console.warn('staff_apiUpdateMove: processPendingMoves_ failed: ' + err);
  }
  return { ok: true, moveId: moveId, row: updatedRow };
}

// 返送を編集: payload.boxId で行を特定し、報告者/移動先/管理番号/着数/備考 を上書き
function staff_apiUpdateReturn(payload, email) {
  payload = payload || {};
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) return { ok: false, error: 'boxId required' };
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
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '対象が見つかりません' };
  var updatedRow = 0;
  withLock_(20000, function(){
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === boxId) {
        var r = i + 2;
        // A=箱ID, G=返送日 は据え置き、B=報告者 C=移動先 D=管理番号 E=着数 F=備考 を上書き
        sh.getRange(r, 2).setValue(reporter);
        sh.getRange(r, 3).setValue(destination);
        sh.getRange(r, 4).setValue(ids);
        sh.getRange(r, 5).setValue(count);
        sh.getRange(r, 6).setValue(note);
        updatedRow = r;
        break;
      }
    }
  });
  if (!updatedRow) return { ok: false, error: '対象が見つかりません: ' + boxId };
  // 商品管理側の「返品済み」ステータス再反映
  try {
    if (typeof updateReturnStatusNowInner_ === 'function') {
      withLock_(20000, function(){ updateReturnStatusNowInner_(); });
    }
  } catch (err) {
    console.warn('staff_apiUpdateReturn: updateReturnStatusNowInner_ failed: ' + err);
  }
  return { ok: true, boxId: boxId, row: updatedRow };
}

// 仕入れ管理を削除: payload.shiireId で行を特定
// 安全策: 商品管理シートに当該 仕入れID を参照する行が1件でもあれば削除拒否
//   （登録済みの商品が孤立しないようにするため）
function staff_apiDeletePurchase(payload, email) {
  payload = payload || {};
  var shiireId = String(payload.shiireId || '').trim();
  if (!shiireId) return { ok: false, error: 'shiireId required' };
  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: '仕入れ管理シートが見つかりません' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '対象が見つかりません' };

  // 商品管理シートに当該 仕入れID を参照する行があるか確認
  try {
    var prodSh = ss.getSheetByName(STAFF_SHEET_NAME);
    if (prodSh) {
      var prodLast = prodSh.getLastRow();
      if (prodLast >= 2 && STAFF_COL && STAFF_COL.仕入れID) {
        var col = STAFF_COL.仕入れID;
        var ids = prodSh.getRange(2, col, prodLast - 1, 1).getValues();
        for (var k = 0; k < ids.length; k++) {
          if (String(ids[k][0] || '').trim() === shiireId) {
            return { ok: false, error: 'この仕入れに紐づく商品が商品管理シートに登録されています。先に商品を削除してください。' };
          }
        }
      }
    }
  } catch (err) {
    return { ok: false, error: '参照チェック失敗: ' + (err && err.message || err) };
  }

  var deleted = false;
  withLock_(20000, function(){
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === shiireId) {
        sh.deleteRow(i + 2);
        deleted = true;
        break;
      }
    }
  });
  if (!deleted) return { ok: false, error: '対象が見つかりません: ' + shiireId };
  return { ok: true, shiireId: shiireId };
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

// 作業者マスター列マップ (固定):
//  B(2)=名前 / D(4)=メール1 / E(5)=メール2 / O(15)=有効
//  管理者フラグ列はヘッダー名で動的解決 (位置非固定)
var SAGYOU_COL_NAME = 2;
var SAGYOU_COL_EMAIL1 = 4;
var SAGYOU_COL_EMAIL2 = 5;
var SAGYOU_COL_ENABLED = 15;

// 作業者マスター + 商品管理シートからの月次集計を返す
// items: [{ row, name, email1, email2, enabled, admin, monthly }]
// currentUser.isAdmin で UI 側の編集ボタン表示を判定
function staff_listSagyousha(opts, requesterEmail) {
  opts = opts || {};
  var months = Math.min(12, Math.max(1, parseInt(opts.months, 10) || 6));
  var reqEmail = String(requesterEmail || '').trim().toLowerCase();
  var ss = staff_getActiveSpreadsheet_();
  var masterSh = ss.getSheetByName('作業者マスター');
  var workers = [];
  var adminColIdx = -1;
  var lastCol = 0;
  if (masterSh && masterSh.getLastRow() >= 1) {
    lastCol = Math.max(SAGYOU_COL_ENABLED, masterSh.getLastColumn());
    var headers = masterSh.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(v){ return String(v || '').trim(); });
    for (var c = 0; c < headers.length; c++) {
      if (headers[c] === '管理者フラグ') { adminColIdx = c; break; }
    }
  }
  var currentUserAdmin = false;
  if (masterSh && masterSh.getLastRow() >= 2) {
    var lastRow = masterSh.getLastRow();
    var values = masterSh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var name = String(row[SAGYOU_COL_NAME - 1] || '').trim();
      if (!name) continue;
      var enabled = row[SAGYOU_COL_ENABLED - 1];
      var enabledFlag = (enabled === true) || (String(enabled).toLowerCase() === 'true');
      var email1 = String(row[SAGYOU_COL_EMAIL1 - 1] || '').trim().toLowerCase();
      var email2 = String(row[SAGYOU_COL_EMAIL2 - 1] || '').trim().toLowerCase();
      var adminFlag = false;
      if (adminColIdx >= 0) {
        var adminVal = row[adminColIdx];
        adminFlag = (adminVal === true) || (String(adminVal).toLowerCase() === 'true');
      }
      if (reqEmail && (email1 === reqEmail || email2 === reqEmail) && adminFlag) {
        currentUserAdmin = true;
      }
      workers.push({
        row: r + 2,
        name: name,
        email1: email1,
        email2: email2,
        enabled: enabledFlag,
        admin: adminFlag,
        monthly: {}
      });
    }
  }
  // 商品管理: 採寸/撮影/出品/発送 の (日付列, 担当者列) ペアをヘッダー名で動的解決して集計
  // 列名は揺れがあるため候補を順に試す
  var prodSh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (prodSh && prodSh.getLastRow() >= 2) {
    var pLast = prodSh.getLastRow();
    var pLastCol = prodSh.getLastColumn();
    var pHeaders = prodSh.getRange(1, 1, 1, pLastCol).getValues()[0]
      .map(function(v){ return String(v || '').trim(); });
    function findCol_(cands) {
      for (var i = 0; i < cands.length; i++) {
        var idx = pHeaders.indexOf(cands[i]);
        if (idx >= 0) return idx + 1; // 1-indexed
      }
      return 0;
    }
    var allPairs = [
      { kind: 'sokutei', dCol: findCol_(['採寸日']),               uCol: findCol_(['採寸者', '採寸担当']) },
      { kind: 'satsuei', dCol: findCol_(['撮影日付', '撮影日']),    uCol: findCol_(['撮影者', '撮影担当']) },
      { kind: 'shuppin', dCol: findCol_(['出品日', '出品日付']),    uCol: findCol_(['出品者', '出品担当']) },
      { kind: 'hassou',  dCol: findCol_(['発送日付', '発送日']),    uCol: findCol_(['発送者', '発送担当']) }
    ];
    var pairs = allPairs.filter(function(p){ return p.dCol > 0 && p.uCol > 0; });
    if (pairs.length) {
      var allCols = [];
      pairs.forEach(function(p){ allCols.push(p.dCol); allCols.push(p.uCol); });
      var minCol = Math.min.apply(null, allCols);
      var maxCol = Math.max.apply(null, allCols);
      var width = maxCol - minCol + 1;
      var pVals = prodSh.getRange(2, minCol, pLast - 1, width).getValues();
      var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
      var workerMap = {};
      workers.forEach(function(w){ workerMap[w.name] = w; });
      function getYm(d) {
        // Dateオブジェクト
        if (d instanceof Date && !isNaN(d.getTime())) {
          return Utilities.formatDate(d, tz, 'yyyy-MM');
        }
        // 文字列 (FILTER/ARRAYFORMULA 経由で日付が文字列化されるケース)
        // 受理: yyyy-MM-dd, yyyy/MM/dd, yyyy/M/d, yyyy.MM.dd, yyyy年M月d日 等
        var s = String(d || '').trim();
        if (!s) return '';
        // 数値はシリアル日付として扱わない（行番号などと誤認しないため）
        var m = s.match(/^(\d{4})[\-\/\.年](\d{1,2})/);
        if (m) {
          var y = m[1];
          var mo = m[2].length === 1 ? '0' + m[2] : m[2];
          return y + '-' + mo;
        }
        return '';
      }
      function bumpUser(name, ym, kind) {
        if (!name || !ym) return;
        var w = workerMap[name];
        if (!w) {
          w = { row: 0, name: name, email1: '', email2: '', enabled: false, admin: false, monthly: {} };
          workerMap[name] = w;
          workers.push(w);
        }
        if (!w.monthly[ym]) w.monthly[ym] = { sokutei: 0, satsuei: 0, shuppin: 0, hassou: 0 };
        if (typeof w.monthly[ym][kind] !== 'number') w.monthly[ym][kind] = 0;
        w.monthly[ym][kind]++;
      }
      for (var i = 0; i < pVals.length; i++) {
        for (var k = 0; k < pairs.length; k++) {
          var p = pairs[k];
          var ym = getYm(pVals[i][p.dCol - minCol]);
          var user = String(pVals[i][p.uCol - minCol] || '').trim();
          bumpUser(user, ym, p.kind);
        }
      }
    }
  }
  // 直近 months ヶ月のキー一覧
  var now = new Date();
  var ymList = [];
  for (var m = 0; m < months; m++) {
    var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    ymList.push(Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM'));
  }
  return {
    ok: true,
    items: workers,
    months: ymList,
    adminColumn: adminColIdx >= 0 ? (adminColIdx + 1) : 0,
    currentUser: { email: reqEmail, isAdmin: currentUserAdmin }
  };
}

// 既存行の更新 (管理者のみ)
// payload: { row, name?, email1?, email2?, enabled?, admin? }
function staff_apiSaveSagyousha(payload, email) {
  payload = payload || {};
  var row = parseInt(payload.row, 10);
  if (!row || row < 2) return { ok: false, error: 'row が不正です' };
  var ss = staff_getActiveSpreadsheet_();
  var masterSh = ss.getSheetByName('作業者マスター');
  if (!masterSh) return { ok: false, error: '作業者マスターが見つかりません' };
  var auth = staff_assertSagyouAdmin_(masterSh, email);
  if (!auth.ok) return auth;
  if (row > masterSh.getLastRow()) return { ok: false, error: '行が存在しません' };
  if (typeof payload.name === 'string') masterSh.getRange(row, SAGYOU_COL_NAME).setValue(payload.name);
  if (typeof payload.email1 === 'string') masterSh.getRange(row, SAGYOU_COL_EMAIL1).setValue(payload.email1);
  if (typeof payload.email2 === 'string') masterSh.getRange(row, SAGYOU_COL_EMAIL2).setValue(payload.email2);
  if (typeof payload.enabled === 'boolean') masterSh.getRange(row, SAGYOU_COL_ENABLED).setValue(payload.enabled);
  if (typeof payload.admin === 'boolean' && auth.adminColIdx >= 0) {
    masterSh.getRange(row, auth.adminColIdx + 1).setValue(payload.admin);
  }
  return { ok: true, row: row };
}

// 新規追加 (管理者のみ)
// payload: { name, email1?, email2?, enabled?, admin? }
function staff_apiCreateSagyousha(payload, email) {
  payload = payload || {};
  var name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: '名前を指定してください' };
  var ss = staff_getActiveSpreadsheet_();
  var masterSh = ss.getSheetByName('作業者マスター');
  if (!masterSh) return { ok: false, error: '作業者マスターが見つかりません' };
  var auth = staff_assertSagyouAdmin_(masterSh, email);
  if (!auth.ok) return auth;
  var newRow = masterSh.getLastRow() + 1;
  masterSh.getRange(newRow, SAGYOU_COL_NAME).setValue(name);
  if (payload.email1) masterSh.getRange(newRow, SAGYOU_COL_EMAIL1).setValue(String(payload.email1));
  if (payload.email2) masterSh.getRange(newRow, SAGYOU_COL_EMAIL2).setValue(String(payload.email2));
  masterSh.getRange(newRow, SAGYOU_COL_ENABLED).setValue(payload.enabled === false ? false : true);
  if (auth.adminColIdx >= 0) {
    masterSh.getRange(newRow, auth.adminColIdx + 1).setValue(payload.admin === true);
  }
  return { ok: true, row: newRow };
}

// 呼び出し元の email が管理者フラグ TRUE かをチェック
function staff_assertSagyouAdmin_(masterSh, email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'email がありません' };
  var lastRow = masterSh.getLastRow();
  var lastCol = masterSh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: '作業者がいません' };
  var headers = masterSh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v){ return String(v || '').trim(); });
  var adminColIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    if (headers[c] === '管理者フラグ') { adminColIdx = c; break; }
  }
  if (adminColIdx < 0) return { ok: false, error: '管理者フラグ列が見つかりません' };
  var values = masterSh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var e1 = String(row[SAGYOU_COL_EMAIL1 - 1] || '').trim().toLowerCase();
    var e2 = String(row[SAGYOU_COL_EMAIL2 - 1] || '').trim().toLowerCase();
    if (e1 !== email && e2 !== email) continue;
    var enabled = row[SAGYOU_COL_ENABLED - 1];
    var enabledFlag = (enabled === true) || (String(enabled).toLowerCase() === 'true');
    if (!enabledFlag) return { ok: false, error: 'アカウントが無効です' };
    var adminVal = row[adminColIdx];
    var adminFlag = (adminVal === true) || (String(adminVal).toLowerCase() === 'true');
    if (adminFlag) return { ok: true, adminColIdx: adminColIdx };
    break;
  }
  return { ok: false, error: '管理者権限がありません' };
}

// ========== 業務メニュー（汎用シートダンプ） ==========

// メールアドレスから作業者マスターの本人情報を解決する軽量ヘルパー
// 戻り値: { name: string, isAdmin: boolean } / 未登録なら name='' , isAdmin=false
function staff_resolveUserByEmail_(email) {
  var reqEmail = String(email || '').trim().toLowerCase();
  var result = { name: '', isAdmin: false };
  if (!reqEmail) return result;
  var ss = staff_getActiveSpreadsheet_();
  var masterSh = ss.getSheetByName('作業者マスター');
  if (!masterSh || masterSh.getLastRow() < 2) return result;
  var lastCol = Math.max(SAGYOU_COL_ENABLED, masterSh.getLastColumn());
  var headers = masterSh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v){ return String(v || '').trim(); });
  var adminColIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    if (headers[c] === '管理者フラグ') { adminColIdx = c; break; }
  }
  var values = masterSh.getRange(2, 1, masterSh.getLastRow() - 1, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var email1 = String(row[SAGYOU_COL_EMAIL1 - 1] || '').trim().toLowerCase();
    var email2 = String(row[SAGYOU_COL_EMAIL2 - 1] || '').trim().toLowerCase();
    if (email1 === reqEmail || email2 === reqEmail) {
      result.name = String(row[SAGYOU_COL_NAME - 1] || '').trim();
      if (adminColIdx >= 0) {
        var adminVal = row[adminColIdx];
        result.isAdmin = (adminVal === true) || (String(adminVal).toLowerCase() === 'true');
      }
      return result;
    }
  }
  return result;
}

// 任意のシートをヘッダー＋行で返す（読み取り専用）
// payload: { name: string, limit?: number }
// 経費申請シートは本人の行のみ返す（管理者は全件）
function staff_dumpSheet(payload, email) {
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

  // 経費申請シート: 報酬管理と同じく、非管理者は本人の行のみに絞り込む
  if (name === '経費申請') {
    var me = staff_resolveUserByEmail_(email);
    if (!me.isAdmin) {
      var iName = headers.indexOf('名前');
      if (iName < 0) return { ok: false, error: '経費申請シートに「名前」列がありません' };
      var myName = String(me.name || '').trim();
      values = values.filter(function(row){
        return String(row[iName] || '').trim() === myName;
      });
    }
  }

  // 末尾から limit 件を取得（新しい順表示）
  var start = Math.max(0, values.length - limit);
  var sliced = values.slice(start).reverse();
  return { ok: true, headers: headers, rows: sliced, total: values.length };
}

// ========== 経費申請: 画像アップロード（kanri 不要 / レシート画像専用） ==========
// SPA から POST /api/keihi/image 経由で呼ばれる。dataUrl を Drive '経費_Images' に保存し共有URLを返す。
// シートには書き込まない（呼び出し側の appendKeihi で receipt 列にURLを入れる）。
function staff_apiUploadKeihiImage(payload, email) {
  payload = payload || {};
  email = String(email || 'cloudflare-proxy');
  var dataUrl = String(payload.dataUrl || '');
  var nameHint = String(payload.name || '').trim().replace(/[^\w぀-ヿ一-龯\-]+/g, '_').slice(0, 30);
  if (!dataUrl) return { ok: false, error: '画像データが空です' };

  var m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9+.\-]+);base64,(.+)$/);
  if (!m) return { ok: false, error: 'data URL の形式が不正です' };
  var mime = m[1];
  var b64 = m[2];
  var ext = (mime.split('/')[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  var fileName = '経費_' + (nameHint || 'receipt') + '_' + Date.now() + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fileName);

  var folder = staff_getImageFolder_('経費_Images');
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // 共有設定失敗時もアップロード自体は成功扱い
  }
  var url = 'https://drive.google.com/uc?id=' + file.getId();
  return { ok: true, url: url, fileName: fileName };
}

// ========== 経費申請: 行追加 ==========
// SPA から POST /api/keihi/submit 経由で呼ばれる。AppSheet と同じスキーマで appendRow。
// 通知メールは onChange トリガーの handleChange_Mailer が拾うので、ここでは行追加のみ。
function staff_apiAppendKeihi(payload, email) {
  var p = payload || {};
  var name = String(p.name || '').trim();
  if (!name) return { ok: false, error: '名前が必要です' };
  var purchaseDate = String(p.purchaseDate || '').trim();
  var itemName = String(p.itemName || '').trim();
  var place = String(p.place || '').trim();
  var placeLink = String(p.placeLink || '').trim();
  var amount = Number(p.amount || 0);
  var outsourceCost = Number(p.outsourceCost || 0);
  var receipt = String(p.receipt || '').trim();
  if (!itemName) return { ok: false, error: '商品名が必要です' };
  if ((!outsourceCost || outsourceCost <= 0) && (!amount || amount <= 0)) {
    return { ok: false, error: '金額または外注費が必要です' };
  }

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('経費申請');
  if (!sh) return { ok: false, error: '経費申請シートが見つかりません' };
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return { ok: false, error: '経費申請シートのヘッダーが空です' };
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v || '').trim(); });

  // ID は yyyymmddHHmmss + ランダム3桁（mailer 用 dedup キーとして使われる）
  var now = new Date();
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  var id = '' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) +
           pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) +
           ('00' + Math.floor(Math.random() * 1000)).slice(-3);

  var fieldMap = {
    'タイムスタンプ': now,
    '名前': name,
    '購入日': purchaseDate,
    '外注費': outsourceCost > 0 ? outsourceCost : '',
    '商品名': itemName,
    '購入場所': place,
    '購入場所リンク': placeLink,
    '購入金額': amount,
    '購入証明のためのレシートやスクショ': receipt,
    'ID': id
  };
  var row = headers.map(function(h){
    return Object.prototype.hasOwnProperty.call(fieldMap, h) ? fieldMap[h] : '';
  });
  sh.appendRow(row);
  return { ok: true, id: id, row: sh.getLastRow() };
}

// ========== 仕入れ数報告: 数量入力 + 処理済みフラグ ==========
// SPA から POST /api/shiire-houkoku/quantity 経由で呼ばれる。
// 報告者は ID で一意に特定（SPA が STATE.userName でフィルタ済みの未処理行のみを対象に呼ぶ）。
// G列(処理済み) を TRUE にすると onChange トリガーが Phase2 マージを実行する。
function staff_apiUpdateShiireHoukokuQuantity(payload, email) {
  var p = payload || {};
  var id = String(p.id || '').trim();
  var quantity = Number(p.quantity || 0);
  if (!id) return { ok: false, error: 'id が必要です' };
  if (!quantity || quantity <= 0) return { ok: false, error: '数量が不正です' };

  var ss = staff_getActiveSpreadsheet_();
  var sh = ss.getSheetByName('仕入れ数報告');
  if (!sh) return { ok: false, error: '仕入れ数報告シートが見つかりません' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'データがありません' };
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v || '').trim(); });

  function colByName(name, fallbackIdx) {
    var i = headers.indexOf(name);
    return i >= 0 ? i + 1 : fallbackIdx;
  }
  // 仕入れ数マージ.gs の RPT 定義に合わせる: A=ID, B=タイムスタンプ, F=数量, G=処理済み
  var idCol  = colByName('ID', 1);
  var tsCol  = colByName('タイムスタンプ', 2);
  var qtyCol = colByName('数量', 6);
  var doneCol = colByName('処理済み', 7);

  var ids = sh.getRange(2, idCol, lastRow - 1, 1).getDisplayValues();
  var foundRow = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) { foundRow = i + 2; break; }
  }
  if (foundRow < 0) return { ok: false, error: '該当行が見つかりません: ' + id };

  // 既に処理済みなら何もしない（誤操作で点数が二重マージされるのを防ぐ）
  var doneVal = String(sh.getRange(foundRow, doneCol).getDisplayValue() || '').trim().toUpperCase();
  if (doneVal === 'TRUE') return { ok: false, error: '既に処理済みです' };

  sh.getRange(foundRow, qtyCol).setValue(quantity);
  // 数量入力時刻を B列 タイムスタンプにスタンプ（監査・通知用）
  sh.getRange(foundRow, tsCol).setValue(new Date());
  // 処理済み=TRUE は mergeReportToKanri_ 自身が最後にセットする。
  // ここで先に TRUE を立てると、merge ループが「DONE=TRUE は skip」判定で対象行を
  // スキップしてしまい、仕入れ管理シートへの商品点数/原価/割り当て管理番号反映が
  // 一切行われない（バグ）。数量だけ書き込んで merge に任せる。
  try { withLock_(15000, function(){ mergeReportToKanri_(); recalcUnitCost_(); }); } catch(err) {
    console.error('mergeReportToKanri_ failed: ' + (err.message || err));
  }
  return { ok: true, id: id, row: foundRow, quantity: quantity };
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

