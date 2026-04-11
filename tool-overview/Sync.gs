function accountingSync() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var main = getMainSpreadsheet();
    var db = getDbSpreadsheet();

    var transSheet = db.getSheetByName('会計_取引DB');
    if (!transSheet) throw new Error('DB側に「会計_取引DB」シートが見つかりません');

    var lastCol = transSheet.getLastColumn();
    if (lastCol < 1) throw new Error('会計_取引DBの列が不正です');

    var header = transSheet.getRange(2, 1, 1, lastCol).getValues()[0];
    var col = buildHeaderIndex_(header);

    var existing = readExistingSyncMap_(transSheet, col);

    var upserts = [];
    upserts = upserts.concat(buildExpenseUpserts_(main, col));
    upserts = upserts.concat(buildEcUpserts_(main, col));
    upserts = upserts.concat(buildPurchaseMgmtUpserts_(main, col));
    upserts = upserts.concat(buildProductSalesUpserts_(main, col));

    applyUpserts_(transSheet, col, existing, upserts);

    assignMissingTransactionIds_(transSheet, col);

    sortTransactionDbByDate_(transSheet, col);

    writeSyncTimestamp_(transSheet, header.length);

    appendLog_('INFO', '同期が完了しました。');
  } catch (e) {
    appendLog_('ERROR', (e && e.message) ? e.message : String(e));
    throw e;
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// 経費申請シートから支出データを抽出します。
// D列の「外注費」フラグは数値や非空の場合に外注費として扱い、
// 金額列がゼロで外注費列が数値の場合はその値を金額として利用します。
function buildExpenseUpserts_(mainSs, col) {
  var sh = mainSs.getSheetByName('経費申請');
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0].map(function(v){ return v == null ? '' : String(v).trim(); });
  var rows = values.slice(1);
  var idxId = findHeaderIndex_(header, ['ID']);
  var idxTs = findHeaderIndex_(header, ['タイムスタンプ']);
  var idxName = findHeaderIndex_(header, ['名前']);
  var idxOutsource = findHeaderIndex_(header, ['外注費']);
  var idxDate = findHeaderIndex_(header, ['購入日']);
  var idxItem = findHeaderIndex_(header, ['商品名']);
  var idxPlace = findHeaderIndex_(header, ['購入場所']);
  var idxPlaceLink = findHeaderIndex_(header, ['購入場所リンク']);
  var idxAmount = findHeaderIndex_(header, ['購入金額']);
  var idxReceipt = findHeaderIndex_(header, ['購入証明のためのレシートやスクショ']);
  // 必須列が無い場合は空を返す
  if (idxDate < 0 || idxAmount < 0) return [];
  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var d = normalizeDate_(r[idxDate]);
    if (!d) continue;
    // 金額取得
    var amt = toNumber_(r[idxAmount]);
    if (!(amt >= 0)) amt = 0;
    // 外注費判定
    var isOut = false;
    var altAmt = 0;
    if (idxOutsource >= 0) {
      var outVal = r[idxOutsource];
      if (outVal !== null && outVal !== '') {
        var boolVal = normalizeBool_(outVal);
        var numVal = toNumber_(outVal);
        if (boolVal || numVal > 0 || String(outVal).trim() !== '') {
          isOut = true;
        }
        if (numVal > 0) {
          altAmt = numVal;
        }
      }
    }
    if (isOut && amt === 0 && altAmt > 0) {
      amt = altAmt;
    }
    var ym = Utilities.formatDate(d, tz, 'yyyy-MM');
    // 商品名から広告費判定
    var sub = '';
    var isAd = false;
    if (idxItem >= 0) {
      var itemVal = r[idxItem];
      if (itemVal != null) {
        sub = String(itemVal).trim();
        if (sub.indexOf('広告費') >= 0) {
          isAd = true;
        }
      }
    }
    // 勘定科目の決定: 外注費優先、次に広告費、最後に経費
    var cat;
    if (isOut) {
      cat = '外注費';
    } else if (isAd) {
      cat = '広告費';
    } else {
      cat = '経費';
    }
    var partner = (idxPlace >= 0) ? String(r[idxPlace] == null ? '' : r[idxPlace]).trim() : '';
    var placeLink = (idxPlaceLink >= 0) ? String(r[idxPlaceLink] == null ? '' : r[idxPlaceLink]).trim() : '';
    var receipt = (idxReceipt >= 0) ? String(r[idxReceipt] == null ? '' : r[idxReceipt]).trim() : '';
    var proof = placeLink ? placeLink : receipt;
    var name = (idxName >= 0) ? String(r[idxName] == null ? '' : r[idxName]).trim() : '';
    var ts = (idxTs >= 0) ? String(r[idxTs] == null ? '' : r[idxTs]).trim() : '';
    var memo = '';
    if (name) memo += name;
    if (ts) memo += (memo ? ' / ' : '') + ts;
    var idVal = (idxId >= 0) ? String(r[idxId] == null ? '' : r[idxId]).trim() : '';
    var syncKey = idVal ? ('EXP-' + idVal) : ('EXP-ROW-' + (i + 2));
    // 税計算（10%固定）
    var taxClass = '課税';
    var taxRate = 0.1;
    var taxBase = 0;
    var tax = 0;
    if (taxRate > 0) {
      taxBase = amt / (1 + taxRate);
      tax = amt - taxBase;
    } else {
      taxBase = amt;
      tax = 0;
    }
    taxBase = round2_(taxBase);
    tax = round2_(tax);
    var rowObj = {
      syncKey: syncKey,
      date: d,
      ym: ym,
      division: '支出',
      accountTitle: cat,
      subTitle: sub,
      amount: amt,
      taxClass: taxClass,
      taxRate: taxRate,
      taxBase: taxBase,
      tax: tax,
      wallet: '',
      payMethod: '',
      route: '',
      partner: partner,
      bundleId: '',
      purchaseId: '',
      productId: '',
      receipt: proof,
      memo: memo,
      source: '経費申請'
    };
    out.push(rowObj);
  }
  return out;
}


function buildEcUpserts_(mainSs, col) {
  var sh = mainSs.getSheetByName('EC管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0].map(function(v){ return v == null ? '' : String(v).trim(); });
  var rows = values.slice(1);

  var idxLot = findHeaderIndex_(header, ['ロットID','まとめID']);
  var idxOrder = findHeaderIndex_(header, ['注文キー','注文ID']);
  var idxChannel = findHeaderIndex_(header, ['チャンネル','販路']);
  var idxDate = findHeaderIndex_(header, ['販売日','注文日','日付']);
  var idxSales = findHeaderIndex_(header, ['売上','売上金額','販売金額']);
  var idxFee = findHeaderIndex_(header, ['手数料額','販売手数料','手数料']);
  var idxShip = findHeaderIndex_(header, ['送料','発送費','配送費']);
  var idxMemo = findHeaderIndex_(header, ['メモ','備考']);

  if (idxDate < 0) return [];
  if (idxSales < 0 && idxFee < 0 && idxShip < 0) return [];

  var tz = Session.getScriptTimeZone();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var d = normalizeDate_(r[idxDate]);
    if (!d) continue;

    var ym = Utilities.formatDate(d, tz, 'yyyy-MM');

    var lotId = (idxLot >= 0) ? String(r[idxLot] == null ? '' : r[idxLot]).trim() : '';
    var orderKey = (idxOrder >= 0) ? String(r[idxOrder] == null ? '' : r[idxOrder]).trim() : '';
    var channel = (idxChannel >= 0) ? String(r[idxChannel] == null ? '' : r[idxChannel]).trim() : '';
    var memoCell = (idxMemo >= 0) ? String(r[idxMemo] == null ? '' : r[idxMemo]).trim() : '';

    var baseKey = orderKey || lotId || ('ROW-' + (i + 2));

    var memo = '';
    if (orderKey) memo += '注文キー:' + orderKey;
    if (lotId) memo += (memo ? ' / ' : '') + 'ロットID:' + lotId;
    if (memoCell) memo += (memo ? ' / ' : '') + memoCell;

    var sales = (idxSales >= 0) ? toNumber_(r[idxSales]) : 0;
    var fee = (idxFee >= 0) ? toNumber_(r[idxFee]) : 0;
    var ship = (idxShip >= 0) ? toNumber_(r[idxShip]) : 0;

    if (sales > 0) {
      var t1 = buildTax_(sales, 0.1);
      out.push({
        syncKey: 'EC-' + baseKey + '-SALE',
        date: d,
        ym: ym,
        division: '収益',
        accountTitle: '売上高',
        subTitle: '',
        amount: sales,
        taxClass: t1.taxClass,
        taxRate: t1.taxRate,
        taxBase: t1.taxBase,
        tax: t1.tax,
        wallet: '',
        payMethod: '',
        route: channel,
        partner: channel,
        bundleId: lotId,
        purchaseId: '',
        productId: '',
        receipt: '',
        memo: memo,
        source: 'EC管理'
      });
    }

    if (fee > 0) {
      var t2 = buildTax_(fee, 0.1);
      out.push({
        syncKey: 'EC-' + baseKey + '-FEE',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '販売手数料',
        subTitle: '',
        amount: fee,
        taxClass: t2.taxClass,
        taxRate: t2.taxRate,
        taxBase: t2.taxBase,
        tax: t2.tax,
        wallet: '',
        payMethod: '',
        route: channel,
        partner: channel,
        bundleId: lotId,
        purchaseId: '',
        productId: '',
        receipt: '',
        memo: memo,
        source: 'EC管理'
      });
    }

    if (ship > 0) {
      var t3 = buildTax_(ship, 0.1);
      out.push({
        syncKey: 'EC-' + baseKey + '-SHIP',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '発送費',
        subTitle: '',
        amount: ship,
        taxClass: t3.taxClass,
        taxRate: t3.taxRate,
        taxBase: t3.taxBase,
        tax: t3.tax,
        wallet: '',
        payMethod: '',
        route: channel,
        partner: channel,
        bundleId: lotId,
        purchaseId: '',
        productId: '',
        receipt: '',
        memo: memo,
        source: 'EC管理'
      });
    }
  }

  return out;
}

function buildPurchaseMgmtUpserts_(mainSs, col) {
  var sh = mainSs.getSheetByName('仕入れ管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0].map(function(v){ return v == null ? '' : String(v).trim(); });
  var rows = values.slice(1);

  var idxPurchaseId = findHeaderIndex_(header, ['仕入れID','仕入ID','仕入れ番号','ID']);
  var idxDate = findHeaderIndex_(header, ['仕入れ日','仕入日','購入日','日付']);
  var idxAmount = findHeaderIndex_(header, ['金額','仕入れ金額','購入金額','仕入れ額','合計金額']);
  var idxShip = findHeaderIndex_(header, ['送料','仕入れ送料','配送料','送料(円)']);
  var idxPartner = findHeaderIndex_(header, ['仕入先名','仕入先','仕入れ先','購入先','取引先']);
  var idxBundle = findHeaderIndex_(header, ['まとめID','ロットID','仕入れ数報告ID']);
  var idxMemo = findHeaderIndex_(header, ['メモ','備考','内容','品目']);

  if (idxDate < 0) return [];
  if (idxAmount < 0 && idxShip < 0) return [];

  var tz = Session.getScriptTimeZone();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var d = normalizeDate_(r[idxDate]);
    if (!d) continue;

    var ym = Utilities.formatDate(d, tz, 'yyyy-MM');

    var purchaseId = (idxPurchaseId >= 0) ? String(r[idxPurchaseId] == null ? '' : r[idxPurchaseId]).trim() : '';
    var baseKey = purchaseId || ('ROW-' + (i + 2));

    var partner = (idxPartner >= 0) ? String(r[idxPartner] == null ? '' : r[idxPartner]).trim() : '';
    var bundleId = (idxBundle >= 0) ? String(r[idxBundle] == null ? '' : r[idxBundle]).trim() : '';

    var memo = '';
    if (partner) memo += partner;
    if (idxMemo >= 0) {
      var memoCell = String(r[idxMemo] == null ? '' : r[idxMemo]).trim();
      if (memoCell) memo += (memo ? ' / ' : '') + memoCell;
    }
    if (purchaseId) memo += (memo ? ' / ' : '') + '仕入れID:' + purchaseId;

    var amt = (idxAmount >= 0) ? toNumber_(r[idxAmount]) : 0;
    if (amt > 0) {
      var t1 = buildTax_(amt, 0.1);
      out.push({
        syncKey: 'BUY-' + baseKey + '-AMT',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '仕入',
        subTitle: '',
        amount: amt,
        taxClass: t1.taxClass,
        taxRate: t1.taxRate,
        taxBase: t1.taxBase,
        tax: t1.tax,
        wallet: '',
        payMethod: '',
        route: '',
        partner: partner,
        bundleId: bundleId,
        purchaseId: purchaseId,
        productId: '',
        receipt: '',
        memo: memo,
        source: '仕入れ管理'
      });
    }

    var ship = (idxShip >= 0) ? toNumber_(r[idxShip]) : 0;
    if (ship > 0) {
      var t2 = buildTax_(ship, 0.1);
      out.push({
        syncKey: 'BUY-' + baseKey + '-SHIP',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '仕入送料',
        subTitle: '',
        amount: ship,
        taxClass: t2.taxClass,
        taxRate: t2.taxRate,
        taxBase: t2.taxBase,
        tax: t2.tax,
        wallet: '',
        payMethod: '',
        route: '',
        partner: partner,
        bundleId: bundleId,
        purchaseId: purchaseId,
        productId: '',
        receipt: '',
        memo: memo,
        source: '仕入れ管理'
      });
    }
  }

  return out;
}

function normalizeRoute_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.indexOf('メルカリ') >= 0) return 'メルカリ';
  if (s.indexOf('ラクマ') >= 0) return 'ラクマ';
  if (s.toUpperCase().indexOf('BASE') >= 0) return 'BASE';
  if (s.indexOf('スマセル') >= 0 || s.toUpperCase().indexOf('SMACELL') >= 0) return 'スマセル';
  return s;
}

function buildProductSalesUpserts_(mainSs, col) {
  var sh = mainSs.getSheetByName('商品管理');
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0].map(function(v){ return v == null ? '' : String(v).trim(); });
  var rows = values.slice(1);

  var idxProductId = findHeaderIndex_(header, ['商品ID']);
  var idxPurchaseId = findHeaderIndex_(header, ['仕入れID']);
  var idxManageNo = findHeaderIndex_(header, ['管理番号']);
  var idxBrand = findHeaderIndex_(header, ['ブランド']);
  var idxStatus = findHeaderIndex_(header, ['ステータス']);
  var idxSaleDate = findHeaderIndex_(header, ['販売日','販売日タイムスタンプ','成約日','売上日']);
  var idxRoute = findHeaderIndex_(header, ['販売場所','販路','チャンネル','販売先']);
  var idxSale = findHeaderIndex_(header, ['販売価格','売上','販売金額','販売額']);
  var idxFee = findHeaderIndex_(header, ['手数料','販売手数料','手数料額']);
  var idxShip = findHeaderIndex_(header, ['送料','発送費','配送費']);
  var idxLink = findHeaderIndex_(header, ['リンク','URL']);
  var idxBundle = findHeaderIndex_(header, ['まとめID','ロットID']);
  var idxMemo = findHeaderIndex_(header, ['メモ','備考']);

  if (idxSaleDate < 0 || idxSale < 0) return [];

  var tz = Session.getScriptTimeZone();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var d = normalizeDate_(r[idxSaleDate]);
    if (!d) continue;

    var sales = toNumber_(r[idxSale]);
    var fee = (idxFee >= 0) ? toNumber_(r[idxFee]) : 0;
    var ship = (idxShip >= 0) ? toNumber_(r[idxShip]) : 0;

    if (!(sales > 0) && !(fee > 0) && !(ship > 0)) continue;

    var ym = Utilities.formatDate(d, tz, 'yyyy-MM');
    var dayKey = Utilities.formatDate(d, tz, 'yyyyMMdd');

    var productId = (idxProductId >= 0) ? String(r[idxProductId] == null ? '' : r[idxProductId]).trim() : '';
    var manageNo = (idxManageNo >= 0) ? String(r[idxManageNo] == null ? '' : r[idxManageNo]).trim() : '';
    var purchaseId = (idxPurchaseId >= 0) ? String(r[idxPurchaseId] == null ? '' : r[idxPurchaseId]).trim() : '';
    var bundleId = (idxBundle >= 0) ? String(r[idxBundle] == null ? '' : r[idxBundle]).trim() : '';

    var brand = (idxBrand >= 0) ? String(r[idxBrand] == null ? '' : r[idxBrand]).trim() : '';
    var status = (idxStatus >= 0) ? String(r[idxStatus] == null ? '' : r[idxStatus]).trim() : '';

    var rawRoute = (idxRoute >= 0) ? String(r[idxRoute] == null ? '' : r[idxRoute]).trim() : '';
    var route = normalizeRoute_(rawRoute);

    var link = (idxLink >= 0) ? String(r[idxLink] == null ? '' : r[idxLink]).trim() : '';

    var baseKey = manageNo || productId || ('ROW-' + (i + 2));
    var productKey = manageNo || productId;

    var memo = '';
    if (manageNo) memo += '管理番号:' + manageNo;
    if (brand) memo += (memo ? ' / ' : '') + 'ブランド:' + brand;
    if (status) memo += (memo ? ' / ' : '') + 'ステータス:' + status;
    if (purchaseId) memo += (memo ? ' / ' : '') + '仕入れID:' + purchaseId;
    if (link) memo += (memo ? ' / ' : '') + link;
    if (idxMemo >= 0) {
      var memoCell = String(r[idxMemo] == null ? '' : r[idxMemo]).trim();
      if (memoCell) memo += (memo ? ' / ' : '') + memoCell;
    }

    if (sales > 0) {
      var t1 = buildTax_(sales, 0.1);
      out.push({
        syncKey: 'SALE-' + baseKey + '-' + dayKey + '-REV',
        date: d,
        ym: ym,
        division: '収益',
        accountTitle: '売上高',
        subTitle: '',
        amount: sales,
        taxClass: t1.taxClass,
        taxRate: t1.taxRate,
        taxBase: t1.taxBase,
        tax: t1.tax,
        wallet: '',
        payMethod: '',
        route: route,
        partner: route,
        bundleId: bundleId,
        purchaseId: purchaseId,
        productId: productKey,
        receipt: '',
        memo: memo,
        source: '商品管理'
      });
    }

    if (fee > 0) {
      var t2 = buildTax_(fee, 0.1);
      out.push({
        syncKey: 'SALE-' + baseKey + '-' + dayKey + '-FEE',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '販売手数料',
        subTitle: '',
        amount: fee,
        taxClass: t2.taxClass,
        taxRate: t2.taxRate,
        taxBase: t2.taxBase,
        tax: t2.tax,
        wallet: '',
        payMethod: '',
        route: route,
        partner: route,
        bundleId: bundleId,
        purchaseId: purchaseId,
        productId: productKey,
        receipt: '',
        memo: memo,
        source: '商品管理'
      });
    }

    if (ship > 0) {
      var t3 = buildTax_(ship, 0.1);
      out.push({
        syncKey: 'SALE-' + baseKey + '-' + dayKey + '-SHIP',
        date: d,
        ym: ym,
        division: '支出',
        accountTitle: '発送費',
        subTitle: '',
        amount: ship,
        taxClass: t3.taxClass,
        taxRate: t3.taxRate,
        taxBase: t3.taxBase,
        tax: t3.tax,
        wallet: '',
        payMethod: '',
        route: route,
        partner: route,
        bundleId: bundleId,
        purchaseId: purchaseId,
        productId: productKey,
        receipt: '',
        memo: memo,
        source: '商品管理'
      });
    }
  }

  return out;
}

function applyUpserts_(transSheet, col, existing, upserts) {
  if (!upserts || upserts.length === 0) return;

  var toUpdate = [];
  var toAppend = [];

  for (var i = 0; i < upserts.length; i++) {
    var u = upserts[i];
    if (!u || !u.syncKey) continue;
    var rowIndex = existing[u.syncKey];
    if (rowIndex) toUpdate.push({ rowIndex: rowIndex, obj: u });
    else toAppend.push(u);
  }

  var idxId = col['取引ID'] || 0;

  if (toUpdate.length > 0) {
    toUpdate.sort(function(a, b){ return a.rowIndex - b.rowIndex; });

    var p = 0;
    while (p < toUpdate.length) {
      var startRow = toUpdate[p].rowIndex;
      var rows = [];
      rows.push(buildDbRow_(col, toUpdate[p].obj));

      var q = p + 1;
      while (q < toUpdate.length && toUpdate[q].rowIndex === startRow + (q - p)) {
        rows.push(buildDbRow_(col, toUpdate[q].obj));
        q++;
      }

      if (idxId) {
        var existIds = transSheet.getRange(startRow, idxId, rows.length, 1).getValues();
        for (var k = 0; k < rows.length; k++) {
          var curId = existIds[k][0];
          if (curId) rows[k][idxId - 1] = curId;
        }
      }

      transSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      p = q;
    }
  }

  if (toAppend.length > 0) {
    var addRows = toAppend.map(function(o){ return buildDbRow_(col, o); });
    transSheet.getRange(transSheet.getLastRow() + 1, 1, addRows.length, addRows[0].length).setValues(addRows);
  }
}

function buildDbRow_(col, obj) {
  var width = col._width;
  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';

  setIf_(row, col, '取引ID', '');
  setIf_(row, col, '日付', obj.date || '');
  setIf_(row, col, '年月', obj.ym || '');
  setIf_(row, col, '区分', obj.division || '');
  setIf_(row, col, '勘定科目', obj.accountTitle || '');
  setIf_(row, col, 'サブ科目', obj.subTitle || '');
  setIf_(row, col, '金額(税込)', obj.amount || 0);
  setIf_(row, col, '税区分', obj.taxClass || '');
  setIf_(row, col, '税率', obj.taxRate || 0);
  setIf_(row, col, '税抜', obj.taxBase || 0);
  setIf_(row, col, '消費税', obj.tax || 0);
  setIf_(row, col, '口座', obj.wallet || '');
  setIf_(row, col, '支払方法', obj.payMethod || '');
  setIf_(row, col, '販路', obj.route || '');
  setIf_(row, col, '取引先', obj.partner || '');
  setIf_(row, col, 'まとめID', obj.bundleId || '');
  setIf_(row, col, '仕入れID', obj.purchaseId || '');
  setIf_(row, col, '商品ID/管理番号', obj.productId || '');
  setIf_(row, col, '証憑リンク', obj.receipt || '');
  setIf_(row, col, 'メモ', obj.memo || '');
  setIf_(row, col, '作成元', obj.source || '');
  setIf_(row, col, '同期キー', obj.syncKey || '');

  return row;
}

function readExistingSyncMap_(transSheet, col) {
  var lastRow = transSheet.getLastRow();
  if (lastRow < 3) return {};
  var keyCol = col['同期キー'];
  if (!keyCol) return {};
  var height = lastRow - 2;
  var keys = transSheet.getRange(3, keyCol, height, 1).getValues();
  var map = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i][0];
    if (k == null) continue;
    k = String(k).trim();
    if (!k) continue;
    map[k] = i + 3;
  }
  return map;
}

function assignMissingTransactionIds_(transSheet, col) {
  var lastRow = transSheet.getLastRow();
  if (lastRow < 3) return;

  var idxId = col['取引ID'];
  var idxDate = col['日付'];
  if (!idxId || !idxDate) return;

  var h = lastRow - 2;
  var idVals = transSheet.getRange(3, idxId, h, 1).getValues();
  var dateVals = transSheet.getRange(3, idxDate, h, 1).getValues();

  var maxSeqByDay = {};
  for (var i = 0; i < idVals.length; i++) {
    var idv = idVals[i][0];
    if (!idv) continue;
    var s = String(idv);
    var parts = s.split('-');
    if (parts.length !== 2) continue;
    var day = parts[0];
    var seq = parseInt(parts[1], 10);
    if (!(seq >= 0)) continue;
    if (maxSeqByDay[day] == null || seq > maxSeqByDay[day]) maxSeqByDay[day] = seq;
  }

  var tz = Session.getScriptTimeZone();
  var updates = [];
  var updateRows = [];

  for (var r = 0; r < idVals.length; r++) {
    var cur = idVals[r][0];
    if (cur) continue;

    var d = normalizeDate_(dateVals[r][0]);
    if (!d) continue;

    var dayKey = Utilities.formatDate(d, tz, 'yyyyMMdd');
    var next = (maxSeqByDay[dayKey] == null ? 1 : (maxSeqByDay[dayKey] + 1));
    maxSeqByDay[dayKey] = next;

    var newId = dayKey + '-' + pad6_(next);
    updates.push([newId]);
    updateRows.push(r + 3);
  }

  for (var j = 0; j < updateRows.length; j++) {
    transSheet.getRange(updateRows[j], idxId, 1, 1).setValues([updates[j]]);
  }
}

function sortTransactionDbByDate_(transSheet, col) {
  if (!transSheet) return;
  var idxDate = col['日付'];
  if (!idxDate) return;

  var lastRow = transSheet.getLastRow();
  var lastCol = transSheet.getLastColumn();
  if (lastRow < 3 || lastCol < 1) return;

  transSheet.getRange(3, 1, lastRow - 2, lastCol).sort({ column: idxDate, ascending: false });
}

function writeSyncTimestamp_(transSheet, headerWidth) {
  var now = new Date();
  transSheet.getRange(1, 1).setValue('会計_取引DB (最終同期:' + formatDateTime_(now) + ')');
  var r = transSheet.getRange(1, 1, 1, headerWidth);
  try { r.breakApart(); } catch (e) {}
  r.merge();
}

function appendLog_(level, message) {
  var db = getDbSpreadsheet();
  var logSheet = db.getSheetByName(LOG_SHEET);
  if (!logSheet) return;
  var last = logSheet.getLastRow();
  if (last < 1) {
    logSheet.getRange(1, 1, 1, 3).setValues([['日時','レベル','メッセージ']]);
    last = 1;
  }
  logSheet.getRange(last + 1, 1, 1, 3).setValues([[new Date(), level, message]]);
}

function buildHeaderIndex_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = headerRow[i];
    if (!name) continue;
    name = String(name).trim();
    if (!name) continue;
    map[name] = i + 1;
  }
  map._width = headerRow.length;
  return map;
}

function findHeaderIndex_(headerRow, candidates) {
  var set = {};
  for (var i = 0; i < headerRow.length; i++) {
    var key = headerRow[i] == null ? '' : String(headerRow[i]).trim();
    if (key) set[key] = i;
  }
  for (var j = 0; j < candidates.length; j++) {
    var c = String(candidates[j]).trim();
    if (c && set[c] != null) return set[c];
  }
  return -1;
}

function setIf_(row, col, name, value) {
  var idx = col[name];
  if (!idx) return;
  row[idx - 1] = value;
}

function normalizeDate_(v) {
  if (v === null || v === undefined || v === '') return null;

  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return v;
  }

  if (typeof v === 'number') {
    if (isNaN(v)) return null;
    var base = new Date(1899, 11, 30);
    var d0 = new Date(base.getTime() + Math.round(v * 86400000));
    if (isNaN(d0.getTime())) return null;
    return d0;
  }

  var s = String(v).trim();
  if (!s) return null;

  var m1 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m1) {
    var y = parseInt(m1[1], 10);
    var mo = parseInt(m1[2], 10) - 1;
    var da = parseInt(m1[3], 10);
    var hh = m1[4] ? parseInt(m1[4], 10) : 0;
    var mm = m1[5] ? parseInt(m1[5], 10) : 0;
    var ss = m1[6] ? parseInt(m1[6], 10) : 0;
    var d1 = new Date(y, mo, da, hh, mm, ss);
    if (isNaN(d1.getTime())) return null;
    return d1;
  }

  var d2 = new Date(s);
  if (isNaN(d2.getTime())) return null;
  return d2;
}

function buildTax_(amt, taxRate) {
  var taxClass = '課税';
  var base = 0;
  var tax = 0;

  if (!(amt >= 0)) amt = 0;
  if (!(taxRate >= 0)) taxRate = 0;

  if (taxRate > 0) {
    base = amt / (1 + taxRate);
    tax = amt - base;
  } else {
    base = amt;
    tax = 0;
  }

  return { taxClass: taxClass, taxRate: taxRate, taxBase: round2_(base), tax: round2_(tax) };
}

function normalizeBool_(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;
  var s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '1') return true;
  if (s === '0') return false;
  if (s === 'はい') return true;
  if (s === 'いいえ') return false;
  if (s === 'yes') return true;
  if (s === 'no') return true;
  return false;
}

function toNumber_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    if (isNaN(v)) return 0;
    return v;
  }
  var s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/,/g, '');
  var n = Number(s);
  if (isNaN(n)) return 0;
  return n;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function pad6_(n) {
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

function formatDateTime_(d) {
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss');
}
