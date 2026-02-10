const BASE_ORDER_SYNC = {
  SRC_SPREADSHEET_ID: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
  SRC_SHEET_NAME: 'BASE_注文',
  DST_SPREADSHEET_ID: '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',
  DST_SHEET_NAME: 'EC管理',
  SRC_COL: { orderKey: '注文キー', status: '注文ステータス', orderAt: '注文日時', total: '合計金額', shipping: '送料' },
  DST_COL: { orderKey: '注文キー', channel: 'チャンネル', soldAt: '販売日', sales: '売上', shipping: '送料' },
  CHANNEL_FIXED_VALUE: 'BASE',
  CANCEL_STATUS_VALUE: 'キャンセル',
  ALLOW_STATUS_VALUES: ['未対応', '対応済']
};

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

    const dstOrderKeyCol = requireCol_(dstHeader, cfg.DST_COL.orderKey, '先');
    const dstChannelCol = requireCol_(dstHeader, cfg.DST_COL.channel, '先');
    const dstSoldAtCol = requireCol_(dstHeader, cfg.DST_COL.soldAt, '先');
    const dstSalesCol = requireCol_(dstHeader, cfg.DST_COL.sales, '先');
    const dstShippingCol = requireCol_(dstHeader, cfg.DST_COL.shipping, '先');

    const srcValues = srcSh.getRange(2, 1, srcLastRow - 1, srcLastCol).getValues();

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

    const existingOrderKeys = new Set();
    const dstLastRow = dstSh.getLastRow();
    if (dstLastRow >= 2) {
      const dstKeys2 = dstSh.getRange(2, dstOrderKeyCol, dstLastRow - 1, 1).getValues();
      for (let i = 0; i < dstKeys2.length; i++) {
        const k = normalizeKeyPart_(dstKeys2[i][0]);
        if (k) existingOrderKeys.add(k);
      }
    }

    const toInsert = [];
    for (let i = 0; i < srcValues.length; i++) {
      const r = srcValues[i];
      const orderKey = r[srcOrderKeyCol - 1];
      const status = r[srcStatusCol - 1];
      const at = r[srcOrderAtCol - 1];
      const total = r[srcTotalCol - 1];
      const ship = r[srcShippingCol - 1];

      const ok = normalizeKeyPart_(orderKey);
      if (!ok) continue;

      const st = normalizeKeyPart_(status);
      if (st === normalizeKeyPart_(cfg.CANCEL_STATUS_VALUE)) continue;
      if (!allowStatus.has(st)) continue;
      if (existingOrderKeys.has(ok)) continue;

      toInsert.push({ orderKey: orderKey, channel: cfg.CHANNEL_FIXED_VALUE, at: at, total: total, ship: ship });
      existingOrderKeys.add(ok);
    }

    if (toInsert.length === 0) return;

    const cols = {
      orderKey: dstOrderKeyCol, channel: dstChannelCol, soldAt: dstSoldAtCol,
      sales: dstSalesCol, shipping: dstShippingCol
    };

    const startRow = findAppendRowByActualData_(dstSh, cols);
    const needLastRow = startRow + toInsert.length - 1;
    if (needLastRow > dstSh.getMaxRows()) {
      dstSh.insertRowsAfter(dstSh.getMaxRows(), needLastRow - dstSh.getMaxRows());
    }

    dstSh.getRange(startRow, cols.orderKey, toInsert.length, 1).setValues(toInsert.map(o => [o.orderKey]));
    dstSh.getRange(startRow, cols.channel, toInsert.length, 1).setValues(toInsert.map(o => [o.channel]));
    dstSh.getRange(startRow, cols.soldAt, toInsert.length, 1).setValues(toInsert.map(o => [o.at]));
    dstSh.getRange(startRow, cols.sales, toInsert.length, 1).setValues(toInsert.map(o => [o.total]));
    dstSh.getRange(startRow, cols.shipping, toInsert.length, 1).setValues(toInsert.map(o => [o.ship]));
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
  const checkCols = [cols.orderKey - 1, cols.channel - 1, cols.soldAt - 1, cols.sales - 1, cols.shipping - 1];
  let lastDataRow = 1;
  for (let i = scanRows - 1; i >= 0; i--) {
    const row = allData[i];
    const has = checkCols.some(function(c) { return row[c] && String(row[c]).trim() !== ''; });
    if (has) { lastDataRow = i + 2; break; }
  }
  const nextRow = lastDataRow + 1;
  return nextRow < 2 ? 2 : nextRow;
}
