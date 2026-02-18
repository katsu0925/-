// st_invalidateStatusCache_, st_getOpenSetFast_, st_buildNeedles_,
// st_getSelectedBrandKeys_, st_searchPage_, st_buildDigestMap_
// は Status.gs で定義済み

/**
 * 確保シートから状態を再構築
 */
function od_rebuildHoldStateFromSheet_(orderSs) {
  const sh = sh_ensureHoldSheet_(orderSs);
  const lastRow = sh.getLastRow();
  const items = {};
  
  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, 5).getValues();
    const now = u_nowMs_();
    
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const managedId = u_normalizeId_(row[0]);
      if (!managedId) continue;
      
      const holdId = String(row[1] || '');
      const userKey = String(row[2] || '');
      const untilMs = row[3] instanceof Date ? row[3].getTime() : u_toInt_(row[3], 0);
      const createdAtMs = row[4] instanceof Date ? row[4].getTime() : u_toInt_(row[4], now);
      
      // 期限切れでないもののみ追加
      if (untilMs > now) {
        items[managedId] = { holdId: holdId, userKey: userKey, untilMs: untilMs, createdAtMs: createdAtMs };
      }
    }
  }
  
  return { items: items, updatedAt: u_nowMs_() };
}

/**
 * 依頼管理シートから依頼中状態を再構築
 */
function od_rebuildOpenStateFromRequestSheet_(orderSs) {
  const sh = sh_ensureRequestSheet_(orderSs);
  const lastRow = sh.getLastRow();
  const items = {};
  
  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, 32).getValues();

    var rc = APP_CONFIG.requestCols || {};
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const receiptNo = String(row[rc.receiptNo || 0] || '').trim();
      const selectionList = String(row[rc.selectionList || 9] || '');
      const status = String(row[rc.status || 21] || '').trim();
      
      if (!receiptNo || !status) continue;
      
      // クローズされたステータスは除外
      if (u_isClosedStatus_(status)) continue;
      
      // 選択リストから管理番号を抽出
      const managedIds = u_parseSelectionList_(selectionList);
      const now = u_nowMs_();
      
      for (let j = 0; j < managedIds.length; j++) {
        const id = managedIds[j];
        items[id] = { receiptNo: receiptNo, status: status, updatedAtMs: now };
      }
    }
  }
  
  return { items: items, updatedAt: u_nowMs_() };
}

/**
 * 確保シートへの書き込み
 */
function od_writeHoldSheetFromState_(orderSs, holdItems, nowMs) {
  const sh = sh_ensureHoldSheet_(orderSs);
  const lastRow = sh.getLastRow();
  
  // 既存データをクリア（ヘッダー以外）
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 5).clearContent();
  }
  
  // 新しいデータを書き込み
  const rows = [];
  for (const id in holdItems) {
    const it = holdItems[id];
    if (!it) continue;
    
    const untilMs = u_toInt_(it.untilMs, 0);
    if (untilMs <= nowMs) continue; // 期限切れは除外
    
    rows.push([
      id,
      String(it.holdId || ''),
      String(it.userKey || ''),
      new Date(untilMs),
      new Date(u_toInt_(it.createdAtMs, nowMs))
    ]);
  }
  
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 5).setValues(rows);
  }
}

/**
 * 依頼中シートへの書き込み（重要：この関数が欠落していた）
 */
function od_writeOpenLogSheetFromState_(orderSs, openItems, nowMs) {
  const sh = sh_ensureOpenLogSheet_(orderSs);
  const lastRow = sh.getLastRow();
  
  // 既存データをクリア（ヘッダー以外）
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  
  // 新しいデータを書き込み
  const rows = [];
  for (const id in openItems) {
    const it = openItems[id];
    if (!it) continue;
    
    // クローズされたステータスは除外
    if (u_isClosedStatus_(it.status)) continue;
    
    rows.push([
      id,
      String(it.receiptNo || ''),
      String(it.status || ''),
      new Date(u_toInt_(it.updatedAtMs, nowMs))
    ]);
  }
  
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }
}

/**
 * ステータス変更時の処理（Triggersから呼ばれる）
 */
function od_handleRequestSheetStatusEdits_(orderSs, requestSheet, startRow, endRow, nowMs) {
  const numRows = Math.max(0, endRow - startRow + 1);
  if (numRows === 0) return;
  
  const values = requestSheet.getRange(startRow, 1, numRows, 32).getValues();

  var rc = APP_CONFIG.requestCols || {};
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const receiptNo = String(row[rc.receiptNo || 0] || '').trim();
    const selectionList = String(row[rc.selectionList || 9] || '');
    const status = String(row[rc.status || 21] || '').trim();

    if (!receiptNo) continue;

    od_syncOpenStateForReceipt_(orderSs, receiptNo, selectionList, status, nowMs);
  }
}

/**
 * 特定の受付番号の状態を同期
 */
function od_syncOpenStateForReceipt_(orderSs, receiptNo, selectionList, status, nowMs) {
  const managedIds = u_parseSelectionList_(selectionList);
  if (managedIds.length === 0) return;
  
  const openState = st_getOpenState_(orderSs);
  const openItems = openState.items || {};
  const isClosed = u_isClosedStatus_(status);
  
  let changed = false;
  
  for (let i = 0; i < managedIds.length; i++) {
    const id = managedIds[i];
    if (isClosed) {
      // クローズの場合は削除
      if (openItems[id]) {
        delete openItems[id];
        changed = true;
      }
    } else {
      // オープンの場合は更新または追加
      openItems[id] = { receiptNo: receiptNo, status: status, updatedAtMs: nowMs };
      changed = true;
    }
  }
  
  if (changed) {
    openState.items = openItems;
    openState.updatedAt = nowMs;
    st_setOpenState_(orderSs, openState);
    od_writeOpenLogSheetFromState_(orderSs, openItems, nowMs);
    st_invalidateStatusCache_(orderSs);
  }
}

/**
 * 確保のコンパクト化（日次実行用）
 */
function od_compactHolds_() {
  const orderSs = sh_getOrderSs_();
  const lock = LockService.getScriptLock();
  
  if (!lock.tryLock(30000)) return;
  
  try {
    const now = u_nowMs_();
    const holdState = st_getHoldState_(orderSs);
    const holdItems = holdState.items || {};
    
    // 期限切れを削除
    const del = [];
    for (const id in holdItems) {
      const it = holdItems[id];
      if (!it || u_toInt_(it.untilMs, 0) <= now) del.push(id);
    }
    for (let i = 0; i < del.length; i++) {
      delete holdItems[del[i]];
    }
    
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);
    
    if (APP_CONFIG.holds && APP_CONFIG.holds.syncHoldSheet) {
      od_writeHoldSheetFromState_(orderSs, holdItems, now);
    }
    
    // 依頼中状態も再構築
    const openState = od_rebuildOpenStateFromRequestSheet_(orderSs);
    st_setOpenState_(orderSs, openState);
    od_writeOpenLogSheetFromState_(orderSs, openState.items || {}, now);
    
    st_invalidateStatusCache_(orderSs);
  } finally {
    lock.releaseLock();
  }
}

// トリガーから呼び出す関数（アンダースコアなし）
function syncHoldSheetPeriodic() {
  try {
    const cache = CacheService.getScriptCache();
    const dirty = cache.get('HOLD_SHEET_DIRTY');
    if (dirty !== '1') return;
    cache.remove('HOLD_SHEET_DIRTY');
    
    const orderSs = sh_getOrderSs_();
    const holdState = st_getHoldState_(orderSs) || {};
    const holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    od_writeHoldSheetFromState_(orderSs, holdItems, Date.now());
  } catch (e) {
    console.error('syncHoldSheetPeriodic error:', e);
  }
}

/**
 * 依頼シートの実際の最終行を取得（空行をスキップ）
 */
function od_getActualLastRow_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1; // ヘッダーのみ
  
  // A列（受付番号列）で空でない最後の行を探す
  const values = sheet.getRange(1, 1, lastRow, 1).getValues();
  
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== '' && values[i][0] !== null && values[i][0] !== undefined) {
      return i + 1;
    }
  }
  
  return 1;
}


/**
 * 依頼中シートの現在の内容からopenStateを再構築
 * シート上で行を削除すると、その商品のopenStateも消える
 */
function od_rebuildOpenStateFromOpenLogSheet_(orderSs) {
  const sh = sh_ensureOpenLogSheet_(orderSs);
  const lastRow = sh.getLastRow();
  const items = {};
  const now = u_nowMs_();

  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, 4).getValues();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const managedId = String(row[0] || '').trim();
      if (!managedId) continue;

      const receiptNo = String(row[1] || '').trim();
      const status = String(row[2] || '').trim();
      const updatedAtMs = (row[3] instanceof Date) ? row[3].getTime() : u_toInt_(row[3], now);

      if (!receiptNo || !status) continue;
      if (u_isClosedStatus_(status)) continue;

      items[managedId] = { receiptNo: receiptNo, status: status, updatedAtMs: updatedAtMs };
    }
  }

  const openState = { items: items, updatedAt: now };
  st_setOpenState_(orderSs, openState);
  st_invalidateStatusCache_(orderSs);

  console.log('依頼中シートからopenState再構築: ' + Object.keys(items).length + '件');
  return openState;
}
