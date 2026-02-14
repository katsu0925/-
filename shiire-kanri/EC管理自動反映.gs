/**
 * EC管理自動反映.gs
 *
 * 依頼管理シート → EC管理シートへの自動同期
 * - チャンネル判定: BASE_注文に存在する注文は「BASE」、それ以外は「デタウリ」
 * - 手数料自動計算: BASE=6.6%+40円、デタウリ=決済方法別レート
 */

const IRAI_EC_SYNC = {
  SRC_SPREADSHEET_ID: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
  IRAI_SHEET_NAME: '依頼管理',
  BASE_ORDER_SHEET_NAME: 'BASE_注文',
  DST_SPREADSHEET_ID: '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',
  DST_SHEET_NAME: 'EC管理',
  CANCEL_STATUSES: ['キャンセル', '返品'],
  ALLOW_STATUSES: ['依頼中', '完了'],

  // 手数料レート
  BASE_FEE_RATE: 0.066,      // 6.6%
  BASE_FEE_FIXED: 40,        // +40円/件
  DETAURI_FEE_RATES: {
    'クレジットカード': 0.0325,  // 3.25%
    'コンビニ払い': 0.0275,     // 2.75%
    '銀行振込': 0.014           // 1.4%
  }
};

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
    const cfg = IRAI_EC_SYNC;
    const cancelStatuses = new Set(cfg.CANCEL_STATUSES.map(v => normalizeKeyPart_(v)));
    const allowStatuses = new Set(cfg.ALLOW_STATUSES.map(v => normalizeKeyPart_(v)));

    // --- ソーススプレッドシート ---
    const srcSs = SpreadsheetApp.openById(cfg.SRC_SPREADSHEET_ID);

    // --- 依頼管理シートを読み込み ---
    const iraiSh = srcSs.getSheetByName(cfg.IRAI_SHEET_NAME);
    if (!iraiSh) throw new Error('シートが見つかりません: ' + cfg.IRAI_SHEET_NAME);

    const iraiLastRow = iraiSh.getLastRow();
    const iraiLastCol = iraiSh.getLastColumn();
    if (iraiLastRow < 2 || iraiLastCol < 1) return;

    const iraiHeader = iraiSh.getRange(1, 1, 1, iraiLastCol).getValues()[0].map(v => String(v || '').trim());

    const iraiReceiptNoCol = requireCol_(iraiHeader, '受付番号', '依頼管理');
    const iraiRequestAtCol = requireCol_(iraiHeader, '依頼日時', '依頼管理');
    const iraiTotalAmountCol = requireCol_(iraiHeader, '合計金額', '依頼管理');
    const iraiStatusCol = requireCol_(iraiHeader, 'ステータス', '依頼管理');
    const iraiShipStoreCol = findColByName_(iraiHeader, '送料(店負担)');
    const iraiShipCustCol = findColByName_(iraiHeader, '送料(客負担)');
    const iraiPaymentMethodCol = findColByName_(iraiHeader, '決済方法');

    // --- BASE_注文のキーを取得（チャンネル判定用） ---
    const baseOrderKeys = new Set();
    const baseSh = srcSs.getSheetByName(cfg.BASE_ORDER_SHEET_NAME);
    if (baseSh) {
      const baseLastRow = baseSh.getLastRow();
      const baseLastCol = baseSh.getLastColumn();
      if (baseLastRow >= 2 && baseLastCol >= 1) {
        const baseHeader = baseSh.getRange(1, 1, 1, baseLastCol).getValues()[0].map(v => String(v || '').trim());
        const baseOrderKeyCol = findColByName_(baseHeader, '注文キー');
        if (baseOrderKeyCol > 0) {
          const baseValues = baseSh.getRange(2, baseOrderKeyCol, baseLastRow - 1, 1).getValues();
          for (let i = 0; i < baseValues.length; i++) {
            const k = normalizeKeyPart_(baseValues[i][0]);
            if (k) baseOrderKeys.add(k);
          }
        }
      }
    }

    // --- 先: EC管理 ---
    const dstSs = SpreadsheetApp.openById(cfg.DST_SPREADSHEET_ID);
    const dstSh = dstSs.getSheetByName(cfg.DST_SHEET_NAME);
    if (!dstSh) throw new Error('シートが見つかりません: ' + cfg.DST_SHEET_NAME);

    const dstLastCol = dstSh.getLastColumn();
    if (dstLastCol < 1) throw new Error('EC管理の列数が不正です');

    const dstHeader = dstSh.getRange(1, 1, 1, dstLastCol).getValues()[0].map(v => String(v || '').trim());

    const dstOrderKeyCol = requireCol_(dstHeader, '注文キー', 'EC管理');
    const dstSoldAtCol = requireCol_(dstHeader, '販売日', 'EC管理');
    const dstChannelCol = requireCol_(dstHeader, 'チャンネル', 'EC管理');
    const dstSalesCol = requireCol_(dstHeader, '売上', 'EC管理');
    const dstFeeCol = requireCol_(dstHeader, '手数料', 'EC管理');
    const dstShipStoreCol = requireCol_(dstHeader, '店負担送料', 'EC管理');
    const dstShipCustCol = requireCol_(dstHeader, '客負担送料', 'EC管理');

    // --- 依頼管理データ読み込み ---
    const iraiValues = iraiSh.getRange(2, 1, iraiLastRow - 1, iraiLastCol).getValues();

    // --- 受付番号でグループ化（EC管理は注文単位） ---
    const cancelKeys = new Set();
    const orderGroups = new Map();

    for (let i = 0; i < iraiValues.length; i++) {
      const row = iraiValues[i];
      const receiptNo = row[iraiReceiptNoCol - 1];
      const rk = normalizeKeyPart_(receiptNo);
      if (!rk) continue;

      const st = normalizeKeyPart_(row[iraiStatusCol - 1]);
      if (cancelStatuses.has(st)) {
        cancelKeys.add(rk);
        continue;
      }
      if (!allowStatuses.has(st)) continue;

      if (!orderGroups.has(rk)) {
        orderGroups.set(rk, {
          receiptNo: receiptNo,
          requestAt: row[iraiRequestAtCol - 1],
          totalSales: 0,
          shippingStore: (iraiShipStoreCol > 0) ? (Number(row[iraiShipStoreCol - 1]) || 0) : 0,
          shippingCustomer: (iraiShipCustCol > 0) ? (Number(row[iraiShipCustCol - 1]) || 0) : 0,
          paymentMethod: (iraiPaymentMethodCol > 0) ? String(row[iraiPaymentMethodCol - 1] || '').trim() : ''
        });
      }

      const group = orderGroups.get(rk);
      group.totalSales += Number(row[iraiTotalAmountCol - 1]) || 0;
    }

    // --- キャンセル注文をEC管理から削除 ---
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
    for (const [rk, group] of orderGroups) {
      if (existingOrderKeys.has(rk)) continue;

      // チャンネル判定: BASE_注文に存在すればBASE、なければデタウリ
      const isBase = baseOrderKeys.has(rk);
      const channel = isBase ? 'BASE' : 'デタウリ';

      // 手数料計算
      let fee = 0;
      if (isBase) {
        fee = Math.round(group.totalSales * cfg.BASE_FEE_RATE + cfg.BASE_FEE_FIXED);
      } else {
        const rate = cfg.DETAURI_FEE_RATES[group.paymentMethod] || 0;
        fee = Math.round(group.totalSales * rate);
      }

      toInsert.push({
        orderKey: group.receiptNo,
        soldAt: group.requestAt,
        channel: channel,
        sales: group.totalSales,
        fee: fee,
        shippingStore: group.shippingStore || '',
        shippingCustomer: group.shippingCustomer || ''
      });
      existingOrderKeys.add(rk);
    }

    if (toInsert.length === 0) return;

    const cols = {
      orderKey: dstOrderKeyCol,
      soldAt: dstSoldAtCol,
      channel: dstChannelCol,
      sales: dstSalesCol,
      fee: dstFeeCol,
      shippingStore: dstShipStoreCol,
      shippingCustomer: dstShipCustCol
    };

    const startRow = findAppendRowByActualData_(dstSh, cols);
    const needLastRow = startRow + toInsert.length - 1;
    if (needLastRow > dstSh.getMaxRows()) {
      dstSh.insertRowsAfter(dstSh.getMaxRows(), needLastRow - dstSh.getMaxRows());
    }

    dstSh.getRange(startRow, cols.orderKey, toInsert.length, 1).setValues(toInsert.map(o => [o.orderKey]));
    dstSh.getRange(startRow, cols.soldAt, toInsert.length, 1).setValues(toInsert.map(o => [o.soldAt]));
    dstSh.getRange(startRow, cols.channel, toInsert.length, 1).setValues(toInsert.map(o => [o.channel]));
    dstSh.getRange(startRow, cols.sales, toInsert.length, 1).setValues(toInsert.map(o => [o.sales]));
    dstSh.getRange(startRow, cols.fee, toInsert.length, 1).setValues(toInsert.map(o => [o.fee]));
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
