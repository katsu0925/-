const BASE_ORDER_SYNC = {
  SRC_SPREADSHEET_ID: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
  SRC_SHEET_NAME: 'BASE_注文',
  SRC_ITEM_SHEET_NAME: 'BASE_注文商品',
  DST_SPREADSHEET_ID: '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',
  DST_SHEET_NAME: 'EC管理',
  SRC_COL: { orderKey: '注文キー', status: '注文ステータス', orderAt: '注文日時', total: '合計金額', shipping: '送料' },
  DST_COL: { orderKey: '注文キー', soldAt: '販売日', sales: '売上', shippingStore: '店負担送料', shippingCustomer: '客負担送料' },
  CANCEL_STATUS_VALUE: 'キャンセル',
  ALLOW_STATUS_VALUES: ['未対応', '対応済']
};

// =====================================================
// 送料テーブル（採寸付商品リスト Config.gs と同一）
// =====================================================
const EC_SHIPPING_AREAS = {
  '北海道': 'hokkaido',
  '青森県': 'kita_tohoku', '岩手県': 'kita_tohoku', '秋田県': 'kita_tohoku',
  '宮城県': 'minami_tohoku', '福島県': 'minami_tohoku', '山形県': 'minami_tohoku',
  '東京都': 'kanto', '神奈川県': 'kanto', '埼玉県': 'kanto', '千葉県': 'kanto',
  '茨城県': 'kanto', '栃木県': 'kanto', '群馬県': 'kanto', '山梨県': 'kanto',
  '新潟県': 'shinetsu', '長野県': 'shinetsu',
  '愛知県': 'tokai', '静岡県': 'tokai', '岐阜県': 'tokai', '三重県': 'tokai',
  '石川県': 'hokuriku', '福井県': 'hokuriku', '富山県': 'hokuriku',
  '大阪府': 'kansai', '兵庫県': 'kansai', '京都府': 'kansai',
  '奈良県': 'kansai', '和歌山県': 'kansai', '滋賀県': 'kansai',
  '広島県': 'chugoku', '岡山県': 'chugoku', '島根県': 'chugoku',
  '山口県': 'chugoku', '鳥取県': 'chugoku',
  '香川県': 'shikoku', '愛媛県': 'shikoku', '高知県': 'shikoku', '徳島県': 'shikoku',
  '福岡県': 'kita_kyushu', '佐賀県': 'kita_kyushu', '大分県': 'kita_kyushu', '長崎県': 'kita_kyushu',
  '鹿児島県': 'minami_kyushu', '熊本県': 'minami_kyushu', '宮崎県': 'minami_kyushu',
  '沖縄県': 'okinawa'
};

//                                小      大
const EC_SHIPPING_RATES = {
  minami_kyushu:       [1320,  1700],
  kita_kyushu:         [1280,  1620],
  shikoku:             [1180,  1440],
  chugoku:             [1200,  1480],
  kansai:              [1100,  1260],
  hokuriku:            [1160,  1420],
  tokai:               [1180,  1440],
  shinetsu:            [1220,  1540],
  kanto:               [1300,  1680],
  minami_tohoku:       [1400,  1900],
  kita_tohoku:         [1460,  1980],
  hokkaido:            [1640,  2380]
};

/**
 * 住所テキストから都道府県を検出
 */
function ecDetectPrefecture_(addressText) {
  var PREFS = [
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県',
    '岐阜県','静岡県','愛知県','三重県',
    '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県',
    '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'
  ];
  var text = String(addressText || '').trim();
  for (var i = 0; i < PREFS.length; i++) {
    if (text.indexOf(PREFS[i]) === 0) return PREFS[i];
  }
  for (var j = 0; j < PREFS.length; j++) {
    var short = PREFS[j].replace(/[都府県]$/, '');
    if (text.indexOf(short) === 0) return PREFS[j];
  }
  return null;
}

/**
 * 都道府県と点数から送料を計算（≤10点=小、>10点=大）
 */
function calcShippingForEc_(prefOrAddress, totalCount) {
  var pref = EC_SHIPPING_AREAS[prefOrAddress] ? prefOrAddress : ecDetectPrefecture_(prefOrAddress);
  if (!pref) return 0;
  var area = EC_SHIPPING_AREAS[pref];
  if (!area || !EC_SHIPPING_RATES[area]) return 0;
  var sizeIdx = (totalCount <= 10) ? 0 : 1;
  return EC_SHIPPING_RATES[area][sizeIdx];
}

// =====================================================
// セットアップ & メイン同期
// =====================================================

function setupBaseOrderSync() {
  replaceTrigger_('syncBaseOrdersToEc', function(tb) {
    tb.timeBased().everyMinutes(5).create();
  });
  syncBaseOrdersToEc();
}

function syncBaseOrdersToEc() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const cfg = BASE_ORDER_SYNC;
    const allowStatus = new Set((cfg.ALLOW_STATUS_VALUES || []).map(v => normalizeKeyPart_(v)));

    const srcSs = SpreadsheetApp.openById(cfg.SRC_SPREADSHEET_ID);
    const srcSh = srcSs.getSheetByName(cfg.SRC_SHEET_NAME);
    if (!srcSh) throw new Error('元シートが見つかりません: ' + cfg.SRC_SHEET_NAME);

    // BASE_注文商品シート（点数計算用）
    const srcItemSh = srcSs.getSheetByName(cfg.SRC_ITEM_SHEET_NAME);

    const dstSs = SpreadsheetApp.openById(cfg.DST_SPREADSHEET_ID);
    const dstSh = dstSs.getSheetByName(cfg.DST_SHEET_NAME);
    if (!dstSh) throw new Error('先シートが見つかりません: ' + cfg.DST_SHEET_NAME);

    const srcLastRow = srcSh.getLastRow();
    const srcLastCol = srcSh.getLastColumn();
    if (srcLastRow < 2 || srcLastCol < 1) return;

    const dstLastCol = dstSh.getLastColumn();
    if (dstLastCol < 1) throw new Error('先シートの列数が不正です');

    const srcHeader = srcSh.getRange(1, 1, 1, srcLastCol).getValues()[0].map(v => String(v || '').trim());
    const dstHeader = dstSh.getRange(1, 1, 1, dstLastCol).getValues()[0].map(v => String(v || '').trim());

    const srcOrderKeyCol = requireCol_(srcHeader, cfg.SRC_COL.orderKey, '元');
    const srcStatusCol = requireCol_(srcHeader, cfg.SRC_COL.status, '元');
    const srcOrderAtCol = requireCol_(srcHeader, cfg.SRC_COL.orderAt, '元');
    const srcTotalCol = requireCol_(srcHeader, cfg.SRC_COL.total, '元');
    const srcShippingCol = requireCol_(srcHeader, cfg.SRC_COL.shipping, '元');

    // 都道府県列（送料自動算出用）— 見つからなくてもエラーにしない
    const srcPrefCol = findColByName_(srcHeader, '都道府県');
    const srcRcvPrefCol = findColByName_(srcHeader, '届先_都道府県');

    const dstOrderKeyCol = requireCol_(dstHeader, cfg.DST_COL.orderKey, '先');
    const dstSoldAtCol = requireCol_(dstHeader, cfg.DST_COL.soldAt, '先');
    const dstSalesCol = requireCol_(dstHeader, cfg.DST_COL.sales, '先');
    const dstShipStoreCol = requireCol_(dstHeader, cfg.DST_COL.shippingStore, '先');
    const dstShipCustCol = requireCol_(dstHeader, cfg.DST_COL.shippingCustomer, '先');

    const srcValues = srcSh.getRange(2, 1, srcLastRow - 1, srcLastCol).getValues();

    // --- BASE_注文商品から注文ごとの点数を集計（各商品行=1点） ---
    const itemCountByOrderKey = new Map();
    if (srcItemSh) {
      const itemLastRow = srcItemSh.getLastRow();
      const itemLastCol = srcItemSh.getLastColumn();
      if (itemLastRow >= 2 && itemLastCol >= 1) {
        const itemHeader = srcItemSh.getRange(1, 1, 1, itemLastCol).getValues()[0].map(v => String(v || '').trim());
        const itemOrderKeyCol = findColByName_(itemHeader, '注文キー');
        if (itemOrderKeyCol > 0) {
          const itemValues = srcItemSh.getRange(2, 1, itemLastRow - 1, itemLastCol).getValues();
          for (let i = 0; i < itemValues.length; i++) {
            const k = normalizeKeyPart_(itemValues[i][itemOrderKeyCol - 1]);
            if (!k) continue;
            itemCountByOrderKey.set(k, (itemCountByOrderKey.get(k) || 0) + 1);
          }
        }
      }
    }

    // --- キャンセル注文の検出 & EC管理から削除 ---
    const cancelKeys = new Set();
    for (let i = 0; i < srcValues.length; i++) {
      const r = srcValues[i];
      const k = normalizeKeyPart_(r[srcOrderKeyCol - 1]);
      if (!k) continue;
      const st = normalizeKeyPart_(r[srcStatusCol - 1]);
      if (st === normalizeKeyPart_(cfg.CANCEL_STATUS_VALUE)) cancelKeys.add(k);
    }

    const dstLastRowBeforeDelete = dstSh.getLastRow();
    if (dstLastRowBeforeDelete >= 2 && cancelKeys.size > 0) {
      const dstKeys = dstSh.getRange(2, dstOrderKeyCol, dstLastRowBeforeDelete - 1, 1).getDisplayValues();
      const delRows = [];
      for (let i = 0; i < dstKeys.length; i++) {
        const k = (dstKeys[i][0] || '').toString().trim();
        if (k && cancelKeys.has(k)) delRows.push(i + 2);
      }
      for (let i = delRows.length - 1; i >= 0; i--) {
        dstSh.deleteRow(delRows[i]);
      }
    }

    // --- 既存注文キーの収集 ---
    const existingOrderKeys = new Set();
    const dstLastRow = dstSh.getLastRow();
    if (dstLastRow >= 2) {
      const dstKeys2 = dstSh.getRange(2, dstOrderKeyCol, dstLastRow - 1, 1).getValues();
      for (let i = 0; i < dstKeys2.length; i++) {
        const k = normalizeKeyPart_(dstKeys2[i][0]);
        if (k) existingOrderKeys.add(k);
      }
    }

    // --- 挿入データ構築 ---
    const toInsert = [];
    for (let i = 0; i < srcValues.length; i++) {
      const r = srcValues[i];
      const orderKey = r[srcOrderKeyCol - 1];
      const status = r[srcStatusCol - 1];
      const at = r[srcOrderAtCol - 1];
      const total = r[srcTotalCol - 1];
      const baseShipping = Number(r[srcShippingCol - 1]) || 0;

      const ok = normalizeKeyPart_(orderKey);
      if (!ok) continue;

      const st = normalizeKeyPart_(status);
      if (st === normalizeKeyPart_(cfg.CANCEL_STATUS_VALUE)) continue;
      if (!allowStatus.has(st)) continue;
      if (existingOrderKeys.has(ok)) continue;

      // --- 送料振り分け ---
      let shippingStore = '';
      let shippingCustomer = '';

      if (baseShipping > 0) {
        // BASE側で送料が設定されている → 客負担
        shippingCustomer = baseShipping;
      } else {
        // 送料0（キャンペーン等で店が負担）→ 住所+点数から自動算出 → 店負担
        const rcvPref = (srcRcvPrefCol > 0) ? String(r[srcRcvPrefCol - 1] || '').trim() : '';
        const orderPref = rcvPref || ((srcPrefCol > 0) ? String(r[srcPrefCol - 1] || '').trim() : '');
        const itemCount = itemCountByOrderKey.get(ok) || 0;
        if (orderPref && itemCount > 0) {
          shippingStore = calcShippingForEc_(orderPref, itemCount);
        }
      }

      toInsert.push({
        orderKey: orderKey,
        at: at,
        total: total,
        shippingStore: shippingStore,
        shippingCustomer: shippingCustomer
      });
      existingOrderKeys.add(ok);
    }

    if (toInsert.length === 0) return;

    const cols = {
      orderKey: dstOrderKeyCol,
      soldAt: dstSoldAtCol,
      sales: dstSalesCol,
      shippingStore: dstShipStoreCol,
      shippingCustomer: dstShipCustCol
    };

    const startRow = findAppendRowByActualData_(dstSh, cols);
    const needLastRow = startRow + toInsert.length - 1;
    if (needLastRow > dstSh.getMaxRows()) {
      dstSh.insertRowsAfter(dstSh.getMaxRows(), needLastRow - dstSh.getMaxRows());
    }

    dstSh.getRange(startRow, cols.orderKey, toInsert.length, 1).setValues(toInsert.map(o => [o.orderKey]));
    dstSh.getRange(startRow, cols.soldAt, toInsert.length, 1).setValues(toInsert.map(o => [o.at]));
    dstSh.getRange(startRow, cols.sales, toInsert.length, 1).setValues(toInsert.map(o => [o.total]));
    dstSh.getRange(startRow, cols.shippingStore, toInsert.length, 1).setValues(toInsert.map(o => [o.shippingStore]));
    dstSh.getRange(startRow, cols.shippingCustomer, toInsert.length, 1).setValues(toInsert.map(o => [o.shippingCustomer]));
  } finally {
    lock.releaseLock();
  }
}

function normalizeKeyPart_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v).trim();
}

function findAppendRowByActualData_(sh, cols) {
  const lastRow = Math.max(sh.getLastRow(), 1);
  if (lastRow < 2) return 2;
  const scanRows = lastRow - 1;
  if (scanRows <= 0) return 2;
  const lastCol = sh.getLastColumn();
  const allData = sh.getRange(2, 1, scanRows, lastCol).getDisplayValues();
  const colValues = Object.keys(cols).map(function(k) { return cols[k]; });
  const checkCols = colValues.map(function(c) { return c - 1; });
  let lastDataRow = 1;
  for (let i = scanRows - 1; i >= 0; i--) {
    const row = allData[i];
    const has = checkCols.some(function(c) { return c >= 0 && row[c] && String(row[c]).trim() !== ''; });
    if (has) { lastDataRow = i + 2; break; }
  }
  const nextRow = lastDataRow + 1;
  return nextRow < 2 ? 2 : nextRow;
}
