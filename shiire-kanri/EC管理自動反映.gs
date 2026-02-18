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
  },
  JIMOTY_FEE_RATE: 0.10,        // 10%
  JIMOTY_KEYWORD: 'ジモティ'
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
    const iraiContactCol = findColByName_(iraiHeader, '連絡先');
    const iraiTrackingCol = findColByName_(iraiHeader, '伝票番号');

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
    const dstFeeCol = findColByName_(dstHeader, '手数料');
    const dstProductPriceCol = findColByName_(dstHeader, '商品代金');
    const dstDepositCol = findColByName_(dstHeader, '入金額');
    const dstShipStoreCol = requireCol_(dstHeader, '店負担送料', 'EC管理');
    const dstShipCustCol = requireCol_(dstHeader, '客負担送料', 'EC管理');
    const dstTrackingCol = findColByName_(dstHeader, '伝票番号');

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
          paymentMethod: (iraiPaymentMethodCol > 0) ? String(row[iraiPaymentMethodCol - 1] || '').trim() : '',
          contact: (iraiContactCol > 0) ? String(row[iraiContactCol - 1] || '').trim() : '',
          tracking: (iraiTrackingCol > 0) ? String(row[iraiTrackingCol - 1] || '').trim() : ''
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

    // --- 既存注文キーの収集（行番号も保持） ---
    const existingKeyToRow = new Map();
    const dstLastRow = dstSh.getLastRow();
    let dstAllValues = [];
    if (dstLastRow >= 2) {
      dstAllValues = dstSh.getRange(2, 1, dstLastRow - 1, dstLastCol).getValues();
      for (let i = 0; i < dstAllValues.length; i++) {
        const k = normalizeKeyPart_(dstAllValues[i][dstOrderKeyCol - 1]);
        if (k) existingKeyToRow.set(k, i + 2);
      }
    }

    // --- 挿入・更新データ構築 ---
    const toInsert = [];
    for (const [rk, group] of orderGroups) {
      const isBase = baseOrderKeys.has(rk);
      const isJimoty = group.contact.indexOf(cfg.JIMOTY_KEYWORD) !== -1;
      const channel = isJimoty ? 'ジモティ' : isBase ? 'BASE' : 'デタウリ';

      // 手数料は顧客支払総額（商品 + 客負担送料）に対して計算
      const paymentTotal = group.totalSales + (group.shippingCustomer || 0);
      let fee = 0;
      if (isJimoty) {
        fee = Math.round(paymentTotal * cfg.JIMOTY_FEE_RATE);
      } else if (isBase) {
        fee = Math.round(paymentTotal * cfg.BASE_FEE_RATE + cfg.BASE_FEE_FIXED);
      } else {
        const rate = cfg.DETAURI_FEE_RATES[group.paymentMethod] || 0;
        fee = Math.round(paymentTotal * rate);
      }

      const productPrice = group.totalSales;
      const sales = productPrice + (group.shippingCustomer || 0);
      const deposit = sales - fee - (group.shippingStore || 0);

      const existingRow = existingKeyToRow.get(rk);
      if (existingRow) {
        // --- 既存行を更新（空なら埋める、伝票番号は常に上書き） ---
        const rowData = dstAllValues[existingRow - 2];
        if (!String(rowData[dstChannelCol - 1] || '').trim()) {
          dstSh.getRange(existingRow, dstChannelCol).setValue(channel);
        }
        if (dstProductPriceCol > 0 && !String(rowData[dstProductPriceCol - 1] || '').trim()) {
          dstSh.getRange(existingRow, dstProductPriceCol).setValue(productPrice);
        }
        if (!String(rowData[dstSalesCol - 1] || '').trim()) {
          dstSh.getRange(existingRow, dstSalesCol).setValue(sales);
        }
        if (dstFeeCol > 0 && !String(rowData[dstFeeCol - 1] || '').trim()) {
          dstSh.getRange(existingRow, dstFeeCol).setValue(fee);
        }
        if (dstDepositCol > 0 && !String(rowData[dstDepositCol - 1] || '').trim()) {
          dstSh.getRange(existingRow, dstDepositCol).setValue(deposit);
        }
        if (dstTrackingCol > 0 && group.tracking) {
          dstSh.getRange(existingRow, dstTrackingCol).setValue(group.tracking);
        }
        continue;
      }

      toInsert.push({
        orderKey: group.receiptNo,
        soldAt: group.requestAt,
        channel: channel,
        sales: sales,
        fee: fee,
        productPrice: productPrice,
        deposit: deposit,
        shippingStore: group.shippingStore || '',
        shippingCustomer: group.shippingCustomer || '',
        tracking: group.tracking || ''
      });
    }

    if (toInsert.length === 0) return;

    const cols = {
      orderKey: dstOrderKeyCol,
      soldAt: dstSoldAtCol,
      channel: dstChannelCol,
      sales: dstSalesCol,
      shippingStore: dstShipStoreCol,
      shippingCustomer: dstShipCustCol
    };
    if (dstFeeCol > 0) cols.fee = dstFeeCol;
    if (dstProductPriceCol > 0) cols.productPrice = dstProductPriceCol;
    if (dstDepositCol > 0) cols.deposit = dstDepositCol;
    if (dstTrackingCol > 0) cols.tracking = dstTrackingCol;

    const startRow = findAppendRowByActualData_(dstSh, cols);
    const needLastRow = startRow + toInsert.length - 1;
    if (needLastRow > dstSh.getMaxRows()) {
      dstSh.insertRowsAfter(dstSh.getMaxRows(), needLastRow - dstSh.getMaxRows());
    }

    // 全列を1回の setValues にまとめる
    const colKeys = Object.keys(cols);
    const minCol = Math.min.apply(null, colKeys.map(k => cols[k]));
    const maxCol = Math.max.apply(null, colKeys.map(k => cols[k]));
    const width = maxCol - minCol + 1;
    const batch = toInsert.map(o => {
      const row = new Array(width).fill('');
      row[cols.orderKey - minCol] = o.orderKey;
      row[cols.soldAt - minCol] = o.soldAt;
      row[cols.channel - minCol] = o.channel;
      row[cols.sales - minCol] = o.sales;
      row[cols.shippingStore - minCol] = o.shippingStore;
      row[cols.shippingCustomer - minCol] = o.shippingCustomer;
      if (cols.productPrice) row[cols.productPrice - minCol] = o.productPrice;
      if (cols.fee) row[cols.fee - minCol] = o.fee;
      if (cols.deposit) row[cols.deposit - minCol] = o.deposit;
      if (cols.tracking) row[cols.tracking - minCol] = o.tracking;
      return row;
    });
    dstSh.getRange(startRow, minCol, toInsert.length, width).setValues(batch);
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
