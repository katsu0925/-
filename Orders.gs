function st_invalidateStatusCache_(orderSs) {
  const cache = CacheService.getScriptCache();
  const id = orderSs.getId();
  try { cache.remove('STATUSMAPS_V4:' + id); } catch (e0) {}
  try { cache.remove('OPENSETV4:' + id); } catch (e1) {}
  try { cache.remove('STATECACHE_V1:STATE_HOLDS_V4:' + id); } catch (e2) {}
  try { cache.remove('STATECACHE_V1:STATE_OPEN_V4:' + id); } catch (e3) {}
}

function st_getOpenSetFast_(orderSs) {
  const cache = CacheService.getScriptCache();
  const ck = 'OPENSETV4:' + orderSs.getId();
  const cached = cache.get(ck);
  if (cached) {
    try {
      const json = u_ungzipFromB64_(cached);
      const obj = JSON.parse(json);
      if (obj && typeof obj === 'object') return obj;
    } catch (e0) {}
  }

  const openState = st_getOpenState_(orderSs);
  const items = openState.items || {};
  const out = {};
  for (const id in items) out[id] = true;

  try { cache.put(ck, u_gzipToB64_(JSON.stringify(out)), Math.max(3, u_toInt_(APP_CONFIG.cache.statusSeconds, 10))); } catch (e1) {}
  return out;
}


function st_buildNeedles_(keywordRaw, syn) {
  return u_expandKeywordNeedles_(keywordRaw, syn);
}

function st_getSelectedBrandKeys_(params) {
  const p = (params && typeof params === 'object') ? params : {};
  const f = (p.filters && typeof p.filters === 'object') ? p.filters : {};

  let list = [];
  if (Array.isArray(f.brand)) list = f.brand;
  else if (typeof f.brand === 'string' && f.brand.trim()) list = [f.brand];

  const set = {};
  for (let i = 0; i < list.length; i++) {
    const k = st_normBrandKey_(list[i]);
    if (k) set[k] = true;
  }
  return set;
}

function st_searchPage_(userKey, params) {
  const uk = String(userKey || '').trim();
  const orderSs = sh_getOrderSs_();
  const products = pr_readProducts_();
  const maps = st_buildStatusMaps_(orderSs);
  return st_applyFiltersAndSort_(products, maps, uk, params || {});
}

function st_buildDigestMap_(orderSs, userKey, ids) {
  const now = u_nowMs_();
  const maps = st_buildStatusMaps_(orderSs);
  const out = {};
  const list = u_unique_(u_normalizeIds_(ids || []));

  for (let i = 0; i < list.length; i++) {
    const id = list[i];

    if (maps.openSet && maps.openSet[id]) {
      out[id] = { status: '依頼中', heldByOther: false, untilMs: 0 };
      continue;
    }

    const h = maps.holds ? maps.holds[id] : null;
    if (h && u_toInt_(h.untilMs, 0) > now) {
      const other = String(h.userKey || '') && String(h.userKey || '') !== String(userKey || '');
      out[id] = { status: '確保中', heldByOther: other, untilMs: u_toInt_(h.untilMs, 0) };
      continue;
    }

    out[id] = { status: '在庫あり', heldByOther: false, untilMs: 0 };
  }

  return out;
}

function od_headerMap_(sh) {
  const lastCol = sh.getLastColumn();
  const r1 = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let i = 0; i < r1.length; i++) {
    const k = String(r1[i] || '').trim();
    if (k) map[k] = i + 1;
  }
  return map;
}

function od_toMs_(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (isFinite(n) && n > 0) return Math.floor(n);
  const s = String(v).trim();
  if (!s) return 0;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  return 0;
}

function od_rebuildHoldStateFromSheet_(orderSs) {
  try {
    const ss = orderSs;
    const sh = sh_ensureHoldSheet_(ss);
    const map = od_headerMap_(sh);
    const colId = map['管理番号'] || 1;
    const colHoldId = map['確保ID'] || 2;
    const colUser = map['userKey'] || 3;
    const colUntil = map['確保期限'] || 4;
    const colCreated = map['作成日時'] || 5;

    const lastRow = sh.getLastRow();
    const items = {};
    const now = u_nowMs_();

    if (lastRow >= 2) {
      const vals = sh.getRange(2, 1, lastRow - 1, Math.max(colCreated, colUntil, colUser, colHoldId, colId)).getValues();
      for (let i = 0; i < vals.length; i++) {
        const row = vals[i];
        const id = u_normalizeId_(row[colId - 1]);
        if (!id) continue;
        const untilMs = od_toMs_(row[colUntil - 1]);
        if (!untilMs || untilMs <= now) continue;
        items[id] = {
          holdId: String(row[colHoldId - 1] || ''),
          userKey: String(row[colUser - 1] || ''),
          untilMs: untilMs,
          createdAtMs: od_toMs_(row[colCreated - 1]) || now
        };
      }
    }

    return { items: items, updatedAt: now };
  } catch (e) {
    return { items: {}, updatedAt: u_nowMs_() };
  }
}

function od_rebuildOpenStateFromRequestSheet_(orderSs) {
  const ss = orderSs;
  const sh = sh_ensureRequestSheet_(ss);
  const map = od_headerMap_(sh);

  const colReceipt = map['受付番号'] || 1;
  const colAt = map['依頼日時'] || 2;
  const colSelNo = map['選択No.'] || 11;
  const colList = map['選択リスト'] || 12;
  const colStatus = map['ステータス'] || 18;

  const lastRow = sh.getLastRow();
  const items = {};
  const now = u_nowMs_();

  if (lastRow >= 2) {
    const needCols = Math.max(colReceipt, colAt, colSelNo, colList, colStatus);
    const vals = sh.getRange(2, 1, lastRow - 1, needCols).getValues();

    for (let i = 0; i < vals.length; i++) {
      const row = vals[i];
      const status = String(row[colStatus - 1] || '').trim();
      if (status !== APP_CONFIG.statuses.open) continue;

      const receiptNo = String(row[colReceipt - 1] || '').trim();
      const atMs = od_toMs_(row[colAt - 1]) || now;

      const listRaw = String(row[colList - 1] || '').trim();
      let ids = listRaw ? u_parseSelectionList_(listRaw) : [];

      if (!ids.length) {
        const one = u_normalizeId_(row[colSelNo - 1]);
        if (one) ids = [one];
      }

      for (let j = 0; j < ids.length; j++) {
        const id = ids[j];
        const prev = items[id];
        if (!prev || u_toInt_(prev.updatedAtMs, 0) <= atMs) {
          items[id] = { receiptNo: receiptNo, status: status, updatedAtMs: atMs };
        }
      }
    }
  }

  return { items: items, updatedAt: now };
}

function od_writeHoldSheetFromState_(orderSs, holdItems, nowMs) {
  const sh = sh_ensureHoldSheet_(orderSs);
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 5).clearContent();

  const rows = [];
  for (const id in (holdItems || {})) {
    const it = holdItems[id];
    if (!it) continue;
    const mid = u_normalizeId_(id);
    if (!mid) continue;
    const untilMs = u_toInt_(it.untilMs, 0);
    if (!untilMs || untilMs <= nowMs) continue;
    const holdId = String(it.holdId || '');
    const userKey = String(it.userKey || '');
    let createdAtMs = u_toInt_(it.createdAtMs, 0);
    if (!createdAtMs) createdAtMs = nowMs;
    rows.push([mid, holdId, userKey, new Date(untilMs), new Date(createdAtMs)]);
  }
  rows.sort((a, b) => u_compareManagedId_(a[0], b[0]));
  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function od_writeOpenLogSheetFromState_(orderSs, openItems, nowMs) {
  const sh = sh_ensureOpenLogSheet_(orderSs);
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 4).clearContent();

  const rows = [];
  for (const id in (openItems || {})) {
    const it = openItems[id];
    if (!it) continue;
    const mid = u_normalizeId_(id);
    if (!mid) continue;
    const receiptNo = String(it.receiptNo || '');
    const status = String(it.status || '');
    const at = u_toInt_(it.updatedAtMs, 0) || nowMs;
    rows.push([mid, receiptNo, status, new Date(at)]);
  }
  rows.sort((a, b) => u_compareManagedId_(a[0], b[0]));
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows);
}

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
    const values = sh.getRange(2, 1, lastRow - 1, 18).getValues();
    
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const receiptNo = String(row[0] || '').trim();
      const selectionList = String(row[11] || '');  // 列L = 選択リスト
      const status = String(row[17] || '').trim();   // 列R = ステータス
      
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
  
  const values = requestSheet.getRange(startRow, 1, numRows, 18).getValues();
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const receiptNo = String(row[0] || '').trim();
    const selectionList = String(row[11] || '');
    const status = String(row[17] || '').trim();
    
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
 * 依頼シートに新しい行を追加（空行なし）
 */
function od_appendRequestRow_(sheet, rowData) {
  const actualLastRow = od_getActualLastRow_(sheet);
  const newRow = actualLastRow + 1;
  
  // 行数が足りなければ追加
  const maxRow = sheet.getMaxRows();
  if (newRow > maxRow) {
    sheet.insertRowsAfter(maxRow, 1);
  }
  
  // データを書き込み
  const numCols = rowData.length;
  sheet.getRange(newRow, 1, 1, numCols).setValues([rowData]);
  
  return newRow;
}
