/**
 * 商品管理シート 2026-03-22 一括書き換えインシデント対応
 * 過去リビジョンの取得・コピー作成を行う調査関数群
 */

// Drive REST API v3 でリビジョン一覧を取得（Sheets はheadのみ返ることが多い）
function staff_listRevisions(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var token = ScriptApp.getOAuthToken();
  var all = [];
  var pageToken = '';
  try {
    for (var i = 0; i < 20; i++) {
      var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/revisions'
              + '?fields=revisions(id,modifiedTime,lastModifyingUser/displayName,exportLinks,mimeType,keepForever),nextPageToken'
              + '&pageSize=1000'
              + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      var res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = res.getContentText();
      if (code !== 200) {
        return { ok: false, source: 'drive_v3', status: code, body: body.slice(0, 500) };
      }
      var data = JSON.parse(body);
      if (data.revisions) all = all.concat(data.revisions);
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return { ok: true, source: 'drive_v3', count: all.length, revisions: all };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// Drive API v2 (legacy) でリビジョン一覧を取得（Sheets は v2 でも head のみが多い）
function staff_listRevisionsV2(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var token = ScriptApp.getOAuthToken();
  try {
    var url = 'https://www.googleapis.com/drive/v2/files/' + fileId + '/revisions';
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code !== 200) {
      return { ok: false, source: 'drive_v2', status: code, body: body.slice(0, 500) };
    }
    var data = JSON.parse(body);
    return { ok: true, source: 'drive_v2', count: (data.items || []).length, items: data.items };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// Sheets 内部エンドポイント /revisions/load を OAuth Bearer で叩く（要 cookie の可能性あり）
function staff_loadRevisionsInternal(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var start = Number(payload.start || 1);
  var end = Number(payload.end || 200000);
  var token = ScriptApp.getOAuthToken();
  var results = {};

  var endpoints = [
    'https://docs.google.com/spreadsheets/d/' + fileId + '/revisions/load?id=' + fileId + '&start=' + start + '&end=' + end,
    'https://docs.google.com/spreadsheets/d/' + fileId + '/revisions/tiles?id=' + fileId + '&start=' + start + '&end=' + end,
    'https://docs.google.com/spreadsheets/d/' + fileId + '/revisions/list?id=' + fileId,
    'https://clients6.google.com/drive/v2internal/files/' + fileId + '/revisions'
  ];

  for (var i = 0; i < endpoints.length; i++) {
    try {
      var res = UrlFetchApp.fetch(endpoints[i], {
        headers: {
          Authorization: 'Bearer ' + token,
          'X-Same-Domain': '1',
          'User-Agent': 'Mozilla/5.0'
        },
        muteHttpExceptions: true,
        followRedirects: false
      });
      results['ep' + i] = {
        url: endpoints[i].slice(0, 120),
        status: res.getResponseCode(),
        bodyHead: res.getContentText().slice(0, 400)
      };
    } catch (e) {
      results['ep' + i] = { url: endpoints[i].slice(0, 120), error: String(e && e.message || e) };
    }
  }
  return { ok: true, results: results };
}

// 推定リビジョン番号からの直接ジャンプ URL を生成（head 番号と日付差から線形推定）
function staff_estimateRevisionUrl(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var targetDate = String(payload.targetDate || '2026-03-22'); // ISO
  var headRevision = Number(payload.headRevision || 111954);
  var headDate = String(payload.headDate || '2026-05-11T05:06:57Z');
  // ファイル作成日から head までの平均 rev/day を計算するために creation date を取りに行く
  var token = ScriptApp.getOAuthToken();
  try {
    var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=createdTime,modifiedTime,name';
    var res = UrlFetchApp.fetch(metaUrl, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var meta = JSON.parse(res.getContentText());
    var createdMs = new Date(meta.createdTime).getTime();
    var headMs = new Date(headDate).getTime();
    var targetMs = new Date(targetDate + 'T12:00:00Z').getTime();
    var totalDays = (headMs - createdMs) / (1000 * 60 * 60 * 24);
    var avgPerDay = headRevision / totalDays;
    var daysAgo = (headMs - targetMs) / (1000 * 60 * 60 * 24);
    var estimated = Math.round(headRevision - (daysAgo * avgPerDay));

    var urls = [];
    [estimated - 500, estimated - 200, estimated, estimated + 200, estimated + 500].forEach(function (n) {
      if (n > 0 && n <= headRevision) {
        urls.push('https://docs.google.com/spreadsheets/d/' + fileId + '/edit?revision=' + n);
      }
    });
    return {
      ok: true,
      meta: meta,
      headRevision: headRevision,
      totalDays: totalDays,
      avgPerDay: avgPerDay,
      daysAgo: daysAgo,
      estimatedRevision: estimated,
      candidateUrls: urls
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 商品管理シートで暗い緑1 (#274e13) 背景のzk行をスキャンし、
// 現在のD区分コード/Eステータス/AK〜AZ+3列の値を返す（3/23 12:17 一括消失 復元用）
function staff_scanGreenRows(payload) {
  payload = payload || {};
  // sheets 標準パレットの「暗い緑1」= #274e13 / 「緑3」= #d9ead3 等。サンプル取得モードあり。
  var targetColor = String(payload.color || '').toLowerCase();
  var sampleMode = !!payload.sample;
  var ss = SpreadsheetApp.openById('1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var sh = ss.getSheetByName('商品管理');
  if (!sh) return { ok: false, error: '商品管理 not found' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, rows: [] };
  // 指定列の背景色を全行スキャン（デフォルト A=1）
  var col = Math.max(1, parseInt(payload.col, 10) || 1);
  var bgs = sh.getRange(2, col, lastRow - 1, 1).getBackgrounds();
  if (sampleMode) {
    // 各ユニーク色のサンプルを最大8件まで返す
    var hist = {};
    for (var i = 0; i < bgs.length; i++) {
      var c = String(bgs[i][0] || '').toLowerCase();
      if (!hist[c]) hist[c] = { count: 0, rows: [] };
      hist[c].count++;
      if (hist[c].rows.length < 4) hist[c].rows.push(i + 2);
    }
    return { ok: true, col: col, histogram: hist };
  }
  if (!targetColor) return { ok: false, error: 'color required (e.g. #274e13). Use sample:true to inspect palette.' };
  var matchedRows = [];
  for (var j = 0; j < bgs.length; j++) {
    if (String(bgs[j][0] || '').toLowerCase() === targetColor) {
      matchedRows.push(j + 2);
    }
  }
  if (matchedRows.length === 0) return { ok: true, color: targetColor, count: 0, rows: [] };
  // マッチした行の D(4) / E(5) / F(6=管理番号) / AK〜AZ(37-52) / BJ(62) / BK(63) / BO(67) を取得
  var details = [];
  for (var k = 0; k < matchedRows.length; k++) {
    var r = matchedRows[k];
    var row = sh.getRange(r, 1, 1, 68).getDisplayValues()[0];
    details.push({
      row: r,
      kanri: String(row[5] || ''),
      kubunCode: String(row[3] || ''),   // D列
      status: String(row[4] || ''),       // E列
      shukkinDate: String(row[36] || ''), // AK 出品日
      shukkinSha:  String(row[37] || ''), // AL 出品者
      account:     String(row[38] || ''), // AM 使用アカウント
      shiireDate:  String(row[39] || ''), // AN 仕入れ日
      shiireValue: String(row[40] || ''), // AO 仕入れ値
      sellDate:    String(row[41] || ''), // AP 販売日
      sellPlace:   String(row[42] || ''), // AQ
      sellPrice:   String(row[43] || ''), // AR
      souryo:      String(row[44] || ''), // AS 送料
      tesuryou:    String(row[45] || ''), // AT 手数料
      arari:       String(row[46] || ''), // AU 粗利
      rieki:       String(row[47] || ''), // AV 利益
      riekiRate:   String(row[48] || ''), // AW 利益率
      leadTime:    String(row[49] || ''), // AX
      henpinDate:  String(row[50] || ''), // AY
      bikou:       String(row[51] || ''), // AZ
      zaikoDays:   String(row[61] || ''), // BJ 在庫日数
      link:        String(row[62] || ''), // BK
      uketsukeNo:  String(row[66] || ''), // BO 受付番号
      haikiDate:   String(row[60] || '')  // BI 廃棄日
    });
  }
  return { ok: true, color: targetColor, count: details.length, rows: details };
}

// 3/23 12:17 一括消失の症状で 85件 候補を特定する。
// 条件: 管理番号(F)が zk- prefix, ステータス(E)= '廃棄済み', AK〜AZ がほぼ全て空。
function staff_findRecoveryCandidates(payload) {
  payload = payload || {};
  var prefix = String(payload.prefix || 'zk').toLowerCase();
  var statusFilter = String(payload.status || '廃棄済み');
  var requireEmptyAKtoAZ = payload.requireEmpty == null ? true : !!payload.requireEmpty;
  var ss = SpreadsheetApp.openById('1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var sh = ss.getSheetByName('商品管理');
  if (!sh) return { ok: false, error: '商品管理 not found' };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, rows: [] };
  // F列(管理番号), E列(ステータス), AK〜AZ(37-52) を一気に取得
  var values = sh.getRange(2, 1, lastRow - 1, 68).getDisplayValues();
  var matches = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var kanri = String(row[5] || '').trim().toLowerCase();
    var status = String(row[4] || '').trim();
    if (!kanri.startsWith(prefix)) continue;
    if (statusFilter && status !== statusFilter) continue;
    if (requireEmptyAKtoAZ) {
      // AK〜AZ = idx 36〜51 (0-based)。何かしら値があれば対象外
      var anyFilled = false;
      for (var c = 36; c <= 51; c++) {
        if (String(row[c] || '').trim() !== '') { anyFilled = true; break; }
      }
      if (anyFilled) continue;
    }
    matches.push({
      row: i + 2,
      shouhinId: String(row[0] || ''),      // A 商品ID
      shiireId: String(row[1] || ''),       // B 仕入れID
      sagyousha: String(row[2] || ''),      // C 作業者名
      kanri: String(row[5] || ''),
      kubunCode: String(row[3] || ''),
      status: String(row[4] || ''),
      brand: String(row[7] || ''),          // H ブランド
      haikiDate: String(row[60] || ''),     // BI 廃棄日
      uketsukeNo: String(row[66] || ''),    // BO 受付番号
      link: String(row[62] || ''),          // BK
      // 採寸日(33=AG) / 採寸者(34=AH) / 撮影日付(35=AI) / 撮影者(36=AJ)
      saisunDate: String(row[32] || ''),
      saisunSha:  String(row[33] || ''),
      shashinDate:String(row[34] || ''),
      shashinSha: String(row[35] || '')
    });
  }
  return { ok: true, count: matches.length, prefix: prefix, status: statusFilter, requireEmpty: requireEmptyAKtoAZ, rows: matches };
}

// Drive API で revisionId 指定で File をコピー（Sheets は head のみコピー可能）
function staff_copyAtRevision(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var revisionId = String(payload.revisionId || '');
  var newName = String(payload.newName || '復元用-220322前');
  if (!revisionId) return { ok: false, error: 'revisionId required' };
  var token = ScriptApp.getOAuthToken();
  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy';
    var meta = { name: newName };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify(meta),
      muteHttpExceptions: true
    });
    return { ok: res.getResponseCode() === 200, status: res.getResponseCode(), body: res.getContentText().slice(0, 1000) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 復元用: 任意のシートのヘッダ＋先頭行を openById で読む（doPost dispatch 用）
function staff_dumpHeadersOpenById(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var name = String(payload.name || '商品管理');
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName(name);
  if (!sh) return { ok: false, error: 'sheet not found: ' + name, sheets: ss.getSheets().map(function(s){ return s.getName(); }) };
  var lc = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0];
  var first = sh.getLastRow() >= 2 ? sh.getRange(2, 1, 1, lc).getDisplayValues()[0] : [];
  return { ok: true, sheet: name, lastCol: lc, lastRow: sh.getLastRow(), headers: hdr, firstRow: first };
}

// 復元用: 仕入れID で 仕入れ管理シート の 仕入れ日/単価(商品原価) を逆引き
function staff_lookupShiireById(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var shiireIds = (payload.shiireIds || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
  if (!shiireIds.length) return { ok: false, error: 'shiireIds required' };
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: '仕入れ管理 not found' };
  var lc = sh.getLastColumn();
  var lr = sh.getLastRow();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var displays = sh.getRange(2, 1, lr - 1, lc).getDisplayValues();
  var idCol = hdr.indexOf('仕入れID');
  var dateCol = hdr.indexOf('仕入れ日');
  var costCol = hdr.indexOf('商品原価');   // 単価
  var amountCol = hdr.indexOf('金額');
  var qtyCol = hdr.indexOf('商品点数');
  var assignCol = hdr.indexOf('割当管理番号');
  var kubunCol = hdr.indexOf('区分コード');
  var supCol = hdr.indexOf('仕入先名');
  var idMap = {};
  for (var r = 0; r < displays.length; r++) {
    var id = String(displays[r][idCol] || '').trim();
    if (id) idMap[id] = {
      row: r + 2,
      shiireDate: dateCol >= 0 ? displays[r][dateCol] : null,
      shiireCost: costCol >= 0 ? displays[r][costCol] : null,
      amount: amountCol >= 0 ? displays[r][amountCol] : null,
      qty: qtyCol >= 0 ? displays[r][qtyCol] : null,
      assign: assignCol >= 0 ? displays[r][assignCol] : null,
      kubun: kubunCol >= 0 ? displays[r][kubunCol] : null,
      supplier: supCol >= 0 ? displays[r][supCol] : null
    };
  }
  var results = {};
  for (var i = 0; i < shiireIds.length; i++) {
    results[shiireIds[i]] = idMap[shiireIds[i]] || null;
  }
  return {
    ok: true,
    headers: hdr,
    cols: { id: idCol, date: dateCol, cost: costCol, amount: amountCol, qty: qtyCol, assign: assignCol, kubun: kubunCol, supplier: supCol },
    results: results,
    foundCount: Object.keys(results).filter(function (k) { return !!results[k]; }).length
  };
}

// 復元用: 仕入れ管理シートから 管理番号で 仕入れ日/仕入れ値 を逆引き
function staff_lookupShiireForRecovery(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var kanris = (payload.kanris || []).map(function (k) { return String(k).toLowerCase(); });
  if (!kanris.length) return { ok: false, error: 'kanris required' };
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName('仕入れ管理');
  if (!sh) return { ok: false, error: '仕入れ管理 not found', sheets: ss.getSheets().map(function(s){ return s.getName(); }) };
  var lc = sh.getLastColumn();
  var lr = sh.getLastRow();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var values = sh.getRange(2, 1, lr - 1, lc).getValues();
  var displays = sh.getRange(2, 1, lr - 1, lc).getDisplayValues();
  // 管理番号列を 緩く探す（'割り当て管理番号' 等を含む）
  var kanriCols = [];
  hdr.forEach(function (h, i) {
    if (/管理番号/.test(h)) kanriCols.push({ name: h, index: i });
  });
  var dateCol = hdr.indexOf('仕入れ日');
  var costCol = hdr.indexOf('仕入れ値');
  if (dateCol < 0) dateCol = hdr.indexOf('購入日');
  if (costCol < 0) costCol = hdr.indexOf('購入金額');
  var byKanri = {};
  kanris.forEach(function (k) { byKanri[k] = []; });
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < kanriCols.length; c++) {
      var cellRaw = String(values[r][kanriCols[c].index] || '').toLowerCase();
      if (!cellRaw) continue;
      // 複数管理番号がカンマ/空白で並ぶケースを分解
      var tokens = cellRaw.split(/[\s,，、]+/).map(function (t) { return t.trim(); }).filter(Boolean);
      for (var t = 0; t < tokens.length; t++) {
        if (byKanri.hasOwnProperty(tokens[t])) {
          byKanri[tokens[t]].push({
            row: r + 2,
            kanriCol: kanriCols[c].name,
            shiireDate: dateCol >= 0 ? displays[r][dateCol] : null,
            shiireCost: costCol >= 0 ? displays[r][costCol] : null,
            fullRow: displays[r]
          });
        }
      }
    }
  }
  return {
    ok: true,
    headers: hdr,
    kanriCols: kanriCols,
    dateCol: dateCol,
    costCol: costCol,
    results: byKanri
  };
}

// 復元用: 依頼管理シートから 管理番号を含む 商品名 で受付番号/販売情報を逆引き
function staff_lookupIraiForRecovery(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var kanris = (payload.kanris || []).map(function (k) { return String(k).toLowerCase(); });
  if (!kanris.length) return { ok: false, error: 'kanris required' };
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName('依頼管理');
  if (!sh) return { ok: false, error: '依頼管理 not found', sheets: ss.getSheets().map(function(s){ return s.getName(); }) };
  var lc = sh.getLastColumn();
  var lr = sh.getLastRow();
  if (lr < 2) return { ok: true, results: {} };
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var displays = sh.getRange(2, 1, lr - 1, lc).getDisplayValues();
  // 商品名 / 受付番号 / 依頼日時 / 合計金額 / ステータス / 確認リンク / 送料 列を探す
  function findCol(names) {
    for (var i = 0; i < names.length; i++) {
      var idx = hdr.indexOf(names[i]);
      if (idx >= 0) return idx;
    }
    return -1;
  }
  var productCol = findCol(['商品名', '商品']);
  var listCol = findCol(['選択リスト']);
  var priceJsonCol = findCol(['商品単価JSON']);
  var receiptCol = findCol(['受付番号']);
  var dateCol = findCol(['依頼日時', '販売日', '受注日']);
  var amountCol = findCol(['合計金額', '販売価格']);
  var statusCol = findCol(['ステータス']);
  var linkCol = findCol(['確認リンク', 'リンク']);
  var shipStoreCol = findCol(['送料(店負担)', '店負担送料', '送料']);
  var shipCustCol = findCol(['送料(客負担)', '客負担送料']);
  var byKanri = {};
  kanris.forEach(function (k) { byKanri[k] = []; });
  for (var r = 0; r < displays.length; r++) {
    var searchText = '';
    if (productCol >= 0) searchText += String(displays[r][productCol] || '') + '';
    if (listCol >= 0) searchText += String(displays[r][listCol] || '') + '';
    if (priceJsonCol >= 0) searchText += String(displays[r][priceJsonCol] || '');
    if (!searchText.trim()) continue;
    searchText = searchText.toLowerCase();
    for (var k = 0; k < kanris.length; k++) {
      var kanri = kanris[k];
      // 「zk2」が「zk20」を巻き込まないように 単語境界で判定（区切りは ASCII 英数字以外）
      var re = new RegExp('(^|[^a-z0-9])' + kanri.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '(?![a-z0-9])', 'i');
      if (re.test(searchText)) {
        byKanri[kanri].push({
          row: r + 2,
          productName: productCol >= 0 ? displays[r][productCol] : null,
          selectionList: listCol >= 0 ? String(displays[r][listCol] || '').slice(0, 300) : null,
          receiptNo: receiptCol >= 0 ? displays[r][receiptCol] : null,
          date: dateCol >= 0 ? displays[r][dateCol] : null,
          amount: amountCol >= 0 ? displays[r][amountCol] : null,
          status: statusCol >= 0 ? displays[r][statusCol] : null,
          link: linkCol >= 0 ? displays[r][linkCol] : null,
          shipStore: shipStoreCol >= 0 ? displays[r][shipStoreCol] : null,
          shipCust: shipCustCol >= 0 ? displays[r][shipCustCol] : null
        });
      }
    }
  }
  return {
    ok: true,
    headers: hdr,
    cols: { product: productCol, list: listCol, priceJson: priceJsonCol, receipt: receiptCol, date: dateCol, amount: amountCol, status: statusCol, link: linkCol, shipStore: shipStoreCol, shipCust: shipCustCol },
    results: byKanri
  };
}

// 復元用: 商品管理シートに値を書き戻す（dry-run対応、空セルのみ上書き）
function staff_applyRecoveredValues(payload) {
  payload = payload || {};
  var fileId = String(payload.fileId || '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo');
  var sheetName = String(payload.sheet || '商品管理');
  var updates = payload.updates || []; // [{ row, header, value }]
  var dryRun = payload.dryRun !== false; // default true
  var allowOverwrite = !!payload.allowOverwrite;
  if (!updates.length) return { ok: false, error: 'updates required' };
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return { ok: false, error: 'sheet not found: ' + sheetName };
  var lc = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v || '').trim(); });
  var headerIndex = {};
  hdr.forEach(function (h, i) { if (h) headerIndex[h] = i + 1; });
  var planned = [];
  var skipped = [];
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    var row = Number(u.row || 0);
    var header = String(u.header || '');
    var col = headerIndex[header];
    if (!row || !col) {
      skipped.push({ idx: i, reason: 'row/header not resolvable', update: u });
      continue;
    }
    var current = sh.getRange(row, col).getValue();
    var currentNotEmpty = !(current === '' || current === null || current === undefined);
    if (currentNotEmpty && !allowOverwrite) {
      skipped.push({ idx: i, reason: 'cell not empty', current: String(current), update: u });
      continue;
    }
    planned.push({ idx: i, row: row, col: col, header: header, value: u.value, currentEmpty: !currentNotEmpty });
  }
  if (dryRun) {
    return { ok: true, dryRun: true, plannedCount: planned.length, skippedCount: skipped.length, planned: planned.slice(0, 100), skipped: skipped.slice(0, 100) };
  }
  for (var j = 0; j < planned.length; j++) {
    sh.getRange(planned[j].row, planned[j].col).setValue(planned[j].value);
  }
  return { ok: true, dryRun: false, applied: planned.length, skipped: skipped.length, plannedSample: planned.slice(0, 50), skippedSample: skipped.slice(0, 50) };
}
