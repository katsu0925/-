const CONFIG = {
  SRC_SPREADSHEET_ID: "1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo",
  SRC_SHEET_RECOVERY_NAME: "回収完了",
  SRC_SHEET_PRODUCT_NAME: "商品管理",
  SRC_SHEET_RETURN_NAME: "返送管理",
  SRC_SHEET_AI_NAME: "AIキーワード抽出",

  DEST_SPREADSHEET_ID: "1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc",
  DEST_SHEET_NAME: "データ1",

  DEST_START_ROW: 4,
  DEST_WRITE_START_COL: 2,

  DEST_COL_CHECK: 10,
  DEST_COL_KEY: 11,

  SRC_RECOVERY_START_ROW: 7,
  SRC_RECOVERY_COL_C: 3,
  SRC_RECOVERY_COL_MARK: 1,
  SRC_RECOVERY_RANGE_COLS: 13,
  SRC_RECOVERY_COL_K: 11,

  SRC_PRODUCT_START_ROW: 2,
  SRC_PRODUCT_COL_F: 6,
  SRC_PRODUCT_COL_G: 7,
  SRC_PRODUCT_COL_Q: 17,

  SRC_RETURN_START_ROW: 2,
  SRC_RETURN_COL_C: 3,

  SRC_AI_START_ROW: 2,
  SRC_AI_COL_KEY: 2,
  SRC_AI_COL_PATH: 3,

  AI_DEFAULT_FOLDER_NAME: "AIキーワード抽出_Images",

  MARK_COLOR: "#f4cccc",
  CACHE_TTL_SEC: 300,

  GUARD_KEY: "PUBLIC_SYNC_GUARD",
  GUARD_TTL_SEC: 80
};

const PROP_KEYS = {
  LAST_OK_AT: "PUBLIC_SYNC_LAST_OK_AT",
  LAST_ERROR_AT: "PUBLIC_SYNC_LAST_ERROR_AT",
  LAST_ERROR_MSG: "PUBLIC_SYNC_LAST_ERROR_MSG"
};

function initializePublicList() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    setGuardOn_();
    const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
    syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
    const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
    ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
    syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
  } catch (err) {
    saveError_(err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function app_log_(label, data) {
  const ts = new Date().toISOString();
  let line = '[' + ts + '] ' + String(label || '');
  if (data !== undefined) {
    let s = '';
    try {
      s = (typeof data === 'string') ? data : JSON.stringify(data);
    } catch (e) {
      s = String(data);
    }
    line += ' ' + s;
  }
  console.log(line);
  Logger.log(line);
}

function app_rangeInfo_(range) {
  if (!range) return null;
  const sh = range.getSheet();
  return {
    sheetName: sh ? sh.getName() : '',
    a1: range.getA1Notation(),
    row: range.getRow(),
    col: range.getColumn(),
    numRows: range.getNumRows(),
    numCols: range.getNumColumns()
  };
}

function syncListingPublic(e) {
  const started = Date.now();
  if (isGuardOn_()) {
    app_log_('syncListingPublic SKIP guardOn');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    app_log_('syncListingPublic SKIP lockBusy');
    return;
  }

  try {
    app_log_('syncListingPublic START', { range: app_rangeInfo_(e && e.range ? e.range : null) });

    if (!e || !e.range) {
      app_log_('syncListingPublic SKIP noEventRange');
      return;
    }

    const sheet = e.range.getSheet();
    const name = sheet.getName();

    if (name === CONFIG.SRC_SHEET_RECOVERY_NAME) {
      const r1 = e.range.getRow();
      const r2 = r1 + e.range.getNumRows() - 1;
      const c1 = e.range.getColumn();
      const c2 = c1 + e.range.getNumColumns() - 1;

      app_log_('RECOVERY edit', { r1: r1, r2: r2, c1: c1, c2: c2 });

      if (r2 < CONFIG.SRC_RECOVERY_START_ROW) {
        app_log_('RECOVERY SKIP rowUnderStart', { r2: r2, start: CONFIG.SRC_RECOVERY_START_ROW });
        return;
      }

      const touchesMain = !(c2 < CONFIG.SRC_RECOVERY_COL_C || c1 > (CONFIG.SRC_RECOVERY_COL_C + CONFIG.SRC_RECOVERY_RANGE_COLS - 1));
      const touchesK = !(c2 < CONFIG.SRC_RECOVERY_COL_K || c1 > CONFIG.SRC_RECOVERY_COL_K);

      app_log_('RECOVERY touches', { touchesMain: touchesMain, touchesK: touchesK });

      if (!touchesMain && !touchesK) {
        app_log_('RECOVERY SKIP notTargetCols');
        return;
      }

      clearRecoveryKeyRowMap_();
      setGuardOn_();

      const t0 = Date.now();
      app_log_('openSheets_ START');
      const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      const t2 = Date.now();
      app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
      app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

      const t3 = Date.now();
      app_log_('syncCheckboxMarksAll_ START');
      syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
      app_log_('syncCheckboxMarksAll_ DONE', { ms: Date.now() - t3 });

      PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
      app_log_('RECOVERY END OK', { totalMs: Date.now() - started });
      return;
    }

    if (name === CONFIG.SRC_SHEET_PRODUCT_NAME) {
      app_log_('PRODUCT edit');
      clearProductCache_();
      setGuardOn_();

      const t0 = Date.now();
      app_log_('openSheets_ START');
      const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      const t2 = Date.now();
      app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
      app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

      const t3 = Date.now();
      app_log_('syncCheckboxMarksAll_ START');
      syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
      app_log_('syncCheckboxMarksAll_ DONE', { ms: Date.now() - t3 });

      PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
      app_log_('PRODUCT END OK', { totalMs: Date.now() - started });
      return;
    }

    if (name === CONFIG.SRC_SHEET_RETURN_NAME) {
      app_log_('RETURN edit');
      clearReturnCache_();
      setGuardOn_();

      const t0 = Date.now();
      app_log_('openSheets_ START');
      const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      const t2 = Date.now();
      app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
      app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

      const t3 = Date.now();
      app_log_('syncCheckboxMarksAll_ START');
      syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
      app_log_('syncCheckboxMarksAll_ DONE', { ms: Date.now() - t3 });

      PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
      app_log_('RETURN END OK', { totalMs: Date.now() - started });
      return;
    }

    if (name === CONFIG.SRC_SHEET_AI_NAME) {
      app_log_('AI edit');
      clearAiPathCache_();
      setGuardOn_();

      const t0 = Date.now();
      app_log_('openSheets_ START');
      const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      const t2 = Date.now();
      app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
      app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

      const t3 = Date.now();
      app_log_('syncCheckboxMarksAll_ START');
      syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
      app_log_('syncCheckboxMarksAll_ DONE', { ms: Date.now() - t3 });

      PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
      app_log_('AI END OK', { totalMs: Date.now() - started });
      return;
    }

    app_log_('syncListingPublic SKIP sheetNotTarget', { sheetName: name, totalMs: Date.now() - started });
  } catch (err) {
    app_log_('syncListingPublic ERROR', { message: String(err && err.message ? err.message : err), stack: String(err && err.stack ? err.stack : '') });
    saveError_(err);
  } finally {
    lock.releaseLock();
  }
}

function syncListingPublicCron() {
  const started = Date.now();
  if (isGuardOn_()) {
    app_log_('syncListingPublicCron SKIP guardOn');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    app_log_('syncListingPublicCron SKIP lockBusy');
    return;
  }

  try {
    app_log_('syncListingPublicCron START');
    setGuardOn_();

    const t0 = Date.now();
    app_log_('openSheets_ START');
    const { recoverySheet, productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
    app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

    const t1 = Date.now();
    app_log_('syncFull_ START');
    syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet);
    app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

    const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
    const t2 = Date.now();
    app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
    ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
    app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

    const t3 = Date.now();
    app_log_('syncCheckboxMarksAll_ START');
    syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
    app_log_('syncCheckboxMarksAll_ DONE', { ms: Date.now() - t3 });

    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
    app_log_('syncListingPublicCron END OK', { totalMs: Date.now() - started });
  } catch (err) {
    app_log_('syncListingPublicCron ERROR', { message: String(err && err.message ? err.message : err), stack: String(err && err.stack ? err.stack : '') });
    saveError_(err);
  } finally {
    lock.releaseLock();
  }
}

function app_propsSetLargeRaw_(baseKey, str) {
  const props = PropertiesService.getScriptProperties();
  const s = str == null ? '' : String(str);
  const chunkSize = 8000;

  const n = Math.ceil(s.length / chunkSize);
  props.setProperty(baseKey + ':N', String(n));

  for (let i = 0; i < n; i++) {
    props.setProperty(baseKey + ':' + i, s.slice(i * chunkSize, (i + 1) * chunkSize));
  }
}

function app_propsGetLargeRaw_(baseKey) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(baseKey + ':N') || '0');
  if (!n) return null;

  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(props.getProperty(baseKey + ':' + i) || '');
  }
  return parts.join('');
}

function app_propsDeleteLargeRaw_(baseKey) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(baseKey + ':N') || '0');

  for (let i = 0; i < n; i++) {
    props.deleteProperty(baseKey + ':' + i);
  }
  props.deleteProperty(baseKey + ':N');
}

function app_cachePutLarge_(cache, baseKey, str, seconds) {
  const s = str == null ? '' : String(str);
  const chunkSize = 90000;

  const n = Math.ceil(s.length / chunkSize);
  cache.put(baseKey + ':N', String(n), seconds);

  for (let i = 0; i < n; i++) {
    cache.put(baseKey + ':' + i, s.slice(i * chunkSize, (i + 1) * chunkSize), seconds);
  }
}

function app_cacheGetLarge_(cache, baseKey) {
  const nStr = cache.get(baseKey + ':N');
  if (!nStr) return null;

  const n = Number(nStr || '0');
  if (!n) return null;

  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = cache.get(baseKey + ':' + i);
    if (p == null) return null;
    parts.push(p);
  }
  return parts.join('');
}

function app_cacheDeleteLarge_(cache, baseKey) {
  const nStr = cache.get(baseKey + ':N');
  const n = Number(nStr || '0');

  for (let i = 0; i < n; i++) {
    cache.remove(baseKey + ':' + i);
  }
  cache.remove(baseKey + ':N');
  cache.remove(baseKey);
}

function onDestCheckboxEdit(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return;
  }

  try {
    if (!e || !e.range) return;

    const sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.DEST_SHEET_NAME) return;

    const r1 = e.range.getRow();
    const r2 = r1 + e.range.getNumRows() - 1;
    const c1 = e.range.getColumn();
    const c2 = c1 + e.range.getNumColumns() - 1;

    if (r2 < CONFIG.DEST_START_ROW) return;
    if (c2 < CONFIG.DEST_COL_CHECK || c1 > CONFIG.DEST_COL_CHECK) return;

    const { recoverySheet, returnSheet, destSheet } = openSheets_();

    const startRow = Math.max(CONFIG.DEST_START_ROW, r1);
    const numRows = r2 - startRow + 1;
    if (numRows <= 0) return;

    const checks = destSheet.getRange(startRow, CONFIG.DEST_COL_CHECK, numRows, 1).getValues();
    const keys = destSheet.getRange(startRow, CONFIG.DEST_COL_KEY, numRows, 1).getValues();

    const returnSet = getReturnSetCached_(returnSheet);
    const keyRowMap = getRecoveryKeyRowMapCached_(recoverySheet);

    const rowToColor = {};
    for (let i = 0; i < numRows; i++) {
      const k = normalizeKey_(keys[i][0]);
      if (!k) continue;
      const row = keyRowMap[k];
      if (!row) continue;
      const checked = checks[i][0] === true;
      const color = (returnSet[k] && checked) ? CONFIG.MARK_COLOR : "";
      rowToColor[row] = color;
    }

    const rows = Object.keys(rowToColor);
    if (rows.length === 0) return;

    const pairs = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const rr = Number(rows[i]);
      pairs[i] = [rr, rowToColor[rr]];
    }

    applyRowBackgrounds_(recoverySheet, CONFIG.SRC_RECOVERY_COL_MARK, CONFIG.SRC_RECOVERY_RANGE_COLS, pairs);
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
  } catch (err) {
    saveError_(err);
  } finally {
    lock.releaseLock();
  }
}

function syncFull_(recoverySheet, productSheet, returnSheet, aiSheet, destSheet) {
  const productMap = getProductMapCached_(productSheet);
  const returnSet = getReturnSetCached_(returnSheet);
  const aiPathMap = getAiPathMapCached_(aiSheet);

  const keepCheckByKey = {};
  const destLastRow = destSheet.getLastRow();
  if (destLastRow >= CONFIG.DEST_START_ROW) {
    const nExist = destLastRow - CONFIG.DEST_START_ROW + 1;
    const existChecks = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_CHECK, nExist, 1).getValues();
    const existKeys = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_KEY, nExist, 1).getValues();
    for (let i = 0; i < nExist; i++) {
      const k = normalizeKey_(existKeys[i][0]);
      if (!k) continue;
      if (existChecks[i][0] === true) keepCheckByKey[k] = true;
    }
  }

  const recLastRow = recoverySheet.getLastRow();
  const srcStart = CONFIG.SRC_RECOVERY_START_ROW;
  const recN = Math.max(0, recLastRow - srcStart + 1);

  let recoveryValues = [];
  let recoveryK = [];
  if (recN > 0) {
    recoveryValues = withRetry_(
      () => recoverySheet.getRange(srcStart, CONFIG.SRC_RECOVERY_COL_C, recN, CONFIG.SRC_RECOVERY_RANGE_COLS).getValues(),
      2,
      300
    );
    recoveryK = withRetry_(
      () => recoverySheet.getRange(srcStart, CONFIG.SRC_RECOVERY_COL_K, recN, 1).getValues(),
      2,
      300
    );
  }

  const out = [];
  for (let i = 0; i < recN; i++) {
    const r = recoveryValues[i];

    const keyC = normalizeKey_(r[0]);
    const d = r[1];
    const eCol = convertFreeSizeToF_(r[2]);
    const f = r[3];
    const g = r[4];
    const kVal = recoveryK[i] ? recoveryK[i][0] : "";

    const allBlank = !keyC && isBlank_(d) && isBlank_(eCol) && isBlank_(f) && isBlank_(g) && isBlank_(kVal);
    if (allBlank) continue;

    if (!keyC) continue;
    if (!returnSet[keyC]) continue;

    const rec = Object.prototype.hasOwnProperty.call(productMap, keyC) ? productMap[keyC] : null;
    const insertedStatus = convertCondition(rec ? rec.g : "");
    const insertedColor = rec ? rec.q : "";
    const insertedPrice = convertRecoveryK_(kVal);
    const keepCheck = keepCheckByKey[keyC] === true;

    const rawPath = aiPathMap[keyC] || "";
    const fileId = rawPath ? resolveAiFileId_(rawPath) : "";
    const imgFormula = fileId ? buildImageFormula_(fileId) : "";

    out.push([imgFormula, insertedStatus, d, eCol, f, convertCondition(g), insertedColor, insertedPrice, keepCheck, keyC]);
  }

  const width = CONFIG.DEST_COL_KEY - CONFIG.DEST_WRITE_START_COL + 1;

  const writeCount = out.length;
  const currentLast = destSheet.getLastRow();
  const targetLast = Math.max(currentLast, CONFIG.DEST_START_ROW + Math.max(0, writeCount - 1));

  if (targetLast >= CONFIG.DEST_START_ROW) {
    ensureSheetSize_(destSheet, targetLast, CONFIG.DEST_COL_KEY);

    if (writeCount > 0) {
      withRetry_(
        () => destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_WRITE_START_COL, writeCount, width).setValues(out),
        2,
        500
      );
    }

    const clearStart = CONFIG.DEST_START_ROW + writeCount;
    const clearRows = targetLast - clearStart + 1;
    if (clearRows > 0) {
      const blanks = new Array(clearRows);
      for (let i = 0; i < clearRows; i++) {
        blanks[i] = ["", "", "", "", "", "", "", "", false, ""];
      }
      withRetry_(
        () => destSheet.getRange(clearStart, CONFIG.DEST_WRITE_START_COL, clearRows, width).setValues(blanks),
        2,
        500
      );
    }
  }
}

function syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet) {
  const destLast = destSheet.getLastRow();
  if (destLast < CONFIG.DEST_START_ROW) return;

  const n = destLast - CONFIG.DEST_START_ROW + 1;

  const checks = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_CHECK, n, 1).getValues();
  const keys = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_KEY, n, 1).getValues();

  const checkedMap = {};
  for (let i = 0; i < n; i++) {
    const k = normalizeKey_(keys[i][0]);
    if (!k) continue;
    if (checks[i][0] === true) checkedMap[k] = true;
  }

  const returnSet = getReturnSetCached_(returnSheet);

  const recLast = recoverySheet.getLastRow();
  const recStart = CONFIG.SRC_RECOVERY_START_ROW;
  const recN = Math.max(0, recLast - recStart + 1);
  if (recN <= 0) return;

  const recKeys = recoverySheet.getRange(recStart, CONFIG.SRC_RECOVERY_COL_C, recN, 1).getValues();

  const w = CONFIG.SRC_RECOVERY_RANGE_COLS;
  const bgs = new Array(recN);
  for (let i = 0; i < recN; i++) {
    const k = normalizeKey_(recKeys[i][0]);
    const color = (k && returnSet[k] && checkedMap[k]) ? CONFIG.MARK_COLOR : "";
    const row = new Array(w);
    for (let j = 0; j < w; j++) row[j] = color;
    bgs[i] = row;
  }

  recoverySheet.getRange(recStart, CONFIG.SRC_RECOVERY_COL_MARK, recN, w).setBackgrounds(bgs);
}

function buildRecoveryKeyRowMap_(recoverySheet) {
  const lastRow = recoverySheet.getLastRow();
  const start = CONFIG.SRC_RECOVERY_START_ROW;
  if (lastRow < start) return {};

  const n = lastRow - start + 1;
  const vals = recoverySheet.getRange(start, CONFIG.SRC_RECOVERY_COL_C, n, 1).getValues();

  const map = {};
  for (let i = 0; i < n; i++) {
    const k = normalizeKey_(vals[i][0]);
    if (!k) continue;
    if (!map[k]) map[k] = start + i;
  }
  return map;
}

function getRecoveryKeyRowMapCached_(recoverySheet) {
  const cache = CacheService.getScriptCache();
  const start = CONFIG.SRC_RECOVERY_START_ROW;
  const lastRow = recoverySheet.getLastRow();

  let firstKey = "";
  let lastKey = "";
  if (lastRow >= start) {
    firstKey = normalizeKey_(recoverySheet.getRange(start, CONFIG.SRC_RECOVERY_COL_C, 1, 1).getValue());
    lastKey = normalizeKey_(recoverySheet.getRange(lastRow, CONFIG.SRC_RECOVERY_COL_C, 1, 1).getValue());
  }

  const sig = [lastRow, firstKey, lastKey].join("|");
  const sigKey = "RECOVERY_MAP_SIG";
  const dataKey = "RECOVERY_KEY_ROW_MAP_JSON";

  const cachedSig = cache.get(sigKey);
  const cachedLarge = app_cacheGetLarge_(cache, dataKey);
  const cached = cachedLarge != null ? cachedLarge : cache.get(dataKey);

  if (cached && cachedSig === sig) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const map = buildRecoveryKeyRowMap_(recoverySheet);
  cache.put(sigKey, sig, CONFIG.CACHE_TTL_SEC);

  const json = JSON.stringify(map);
  try {
    app_cachePutLarge_(cache, dataKey, json, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    try {
      cache.put(dataKey, json, CONFIG.CACHE_TTL_SEC);
    } catch (e2) {}
  }

  return map;
}

function clearRecoveryKeyRowMap_() {
  const cache = CacheService.getScriptCache();
  cache.remove("RECOVERY_MAP_SIG");
  app_cacheDeleteLarge_(cache, "RECOVERY_KEY_ROW_MAP_JSON");
}

function applyRowBackgrounds_(sheet, startCol, numCols, rowColorPairs) {
  if (!rowColorPairs || rowColorPairs.length === 0) return;

  rowColorPairs.sort((a, b) => a[0] - b[0]);

  const groups = [];
  let s = rowColorPairs[0][0];
  let e = rowColorPairs[0][0];
  let colors = [makeBgRow_(rowColorPairs[0][1], numCols)];

  for (let i = 1; i < rowColorPairs.length; i++) {
    const r = rowColorPairs[i][0];
    const c = rowColorPairs[i][1];

    if (r === e + 1) {
      e = r;
      colors.push(makeBgRow_(c, numCols));
    } else {
      groups.push([s, e, colors]);
      s = r;
      e = r;
      colors = [makeBgRow_(c, numCols)];
    }
  }
  groups.push([s, e, colors]);

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const startRow = g[0];
    const endRow = g[1];
    const bg = g[2];
    sheet.getRange(startRow, startCol, endRow - startRow + 1, numCols).setBackgrounds(bg);
  }
}

function makeBgRow_(color, width) {
  const row = new Array(width);
  for (let i = 0; i < width; i++) row[i] = color;
  return row;
}

function ensureCheckboxValidation_(destSheet, startRow, numRows) {
  if (numRows <= 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  destSheet.getRange(startRow, CONFIG.DEST_COL_CHECK, numRows, 1).setDataValidation(rule);
}

function getProductMapCached_(productSheet) {
  const cache = CacheService.getScriptCache();
  const baseKey = "PRODUCT_MAP_JSON";

  const cachedLarge = app_cacheGetLarge_(cache, baseKey);
  const cached = cachedLarge != null ? cachedLarge : cache.get(baseKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const map = buildProductMap_(productSheet);
  const json = JSON.stringify(map);

  try {
    app_cachePutLarge_(cache, baseKey, json, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    try {
      cache.put(baseKey, json, CONFIG.CACHE_TTL_SEC);
    } catch (e2) {}
  }

  return map;
}

function clearProductCache_() {
  const cache = CacheService.getScriptCache();
  app_cacheDeleteLarge_(cache, "PRODUCT_MAP_JSON");
}

function buildProductMap_(productSheet) {
  const lastRow = productSheet.getLastRow();
  const map = {};
  if (lastRow < CONFIG.SRC_PRODUCT_START_ROW) return map;

  const rows = lastRow - CONFIG.SRC_PRODUCT_START_ROW + 1;

  const colF = productSheet.getRange(CONFIG.SRC_PRODUCT_START_ROW, CONFIG.SRC_PRODUCT_COL_F, rows, 1).getValues();
  const colG = productSheet.getRange(CONFIG.SRC_PRODUCT_START_ROW, CONFIG.SRC_PRODUCT_COL_G, rows, 1).getValues();
  const colQ = productSheet.getRange(CONFIG.SRC_PRODUCT_START_ROW, CONFIG.SRC_PRODUCT_COL_Q, rows, 1).getValues();

  for (let i = 0; i < rows; i++) {
    const keyF = normalizeKey_(colF[i][0]);
    const valG = colG[i][0];
    const valQ = colQ[i][0];
    const keyQ = normalizeKey_(valQ);

    if (keyF) map[keyF] = { g: valG, q: valQ };
    if (keyQ) map[keyQ] = { g: valG, q: valQ };
  }

  return map;
}

function getReturnSetCached_(returnSheet) {
  const cache = CacheService.getScriptCache();
  const baseKey = "RETURN_SET_JSON";

  const cachedLarge = app_cacheGetLarge_(cache, baseKey);
  const cached = cachedLarge != null ? cachedLarge : cache.get(baseKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const setObj = buildReturnSet_(returnSheet);
  const json = JSON.stringify(setObj);

  try {
    app_cachePutLarge_(cache, baseKey, json, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    try {
      cache.put(baseKey, json, CONFIG.CACHE_TTL_SEC);
    } catch (e2) {}
  }

  return setObj;
}

function clearReturnCache_() {
  const cache = CacheService.getScriptCache();
  app_cacheDeleteLarge_(cache, "RETURN_SET_JSON");
}

function buildReturnSet_(returnSheet) {
  const lastRow = returnSheet.getLastRow();
  const start = CONFIG.SRC_RETURN_START_ROW;
  const col = CONFIG.SRC_RETURN_COL_C;

  const setObj = {};
  if (lastRow < start) return setObj;

  const n = lastRow - start + 1;
  const vals = returnSheet.getRange(start, col, n, 1).getValues();

  for (let i = 0; i < n; i++) {
    const cell = String(vals[i][0] ?? "").trim();
    if (cell === "") continue;

    const parts = cell.split(/[、,，\n\r\t ]+/);
    for (let j = 0; j < parts.length; j++) {
      const k = normalizeKey_(parts[j]);
      if (!k) continue;
      setObj[k] = true;
    }
  }
  return setObj;
}

function getAiPathMapCached_(aiSheet) {
  const cache = CacheService.getScriptCache();
  const buckets = 16;

  const bucketKeys = new Array(buckets);
  for (let i = 0; i < buckets; i++) bucketKeys[i] = "AI_PATH_MAP_B" + i;

  const test = cache.get(bucketKeys[0]);
  if (test) {
    const out = {};
    const jsons = cache.getAll(bucketKeys);
    let ok = true;
    for (let i = 0; i < buckets; i++) {
      const s = jsons[bucketKeys[i]];
      if (!s) {
        ok = false;
        break;
      }
      try {
        const part = JSON.parse(s);
        const ks = Object.keys(part);
        for (let j = 0; j < ks.length; j++) out[ks[j]] = part[ks[j]];
      } catch (e) {
        ok = false;
        break;
      }
    }
    if (ok) return out;
  }

  const map = buildAiPathMap_(aiSheet);

  const parts = new Array(buckets);
  for (let i = 0; i < buckets; i++) parts[i] = {};

  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const b = hashKey_(k) % buckets;
    parts[b][k] = map[k];
  }

  const putObj = {};
  for (let i = 0; i < buckets; i++) {
    const s = JSON.stringify(parts[i]);
    putObj[bucketKeys[i]] = s;
  }

  try {
    cache.putAll(putObj, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    for (let i = 0; i < buckets; i++) {
      try {
        cache.put(bucketKeys[i], JSON.stringify(parts[i]), CONFIG.CACHE_TTL_SEC);
      } catch (e2) {}
    }
  }

  return map;
}

function clearAiPathCache_() {
  const cache = CacheService.getScriptCache();
  const buckets = 16;

  const keys = new Array(buckets + 1);
  keys[0] = "AI_PATH_MAP_JSON";
  for (let i = 0; i < buckets; i++) keys[i + 1] = "AI_PATH_MAP_B" + i;

  try {
    cache.removeAll(keys);
  } catch (e) {
    for (let i = 0; i < keys.length; i++) cache.remove(keys[i]);
  }
}

function hashKey_(s) {
  const str = String(s ?? "");
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0);
}

function buildAiPathMap_(aiSheet) {
  const lastRow = aiSheet.getLastRow();
  const start = CONFIG.SRC_AI_START_ROW;
  if (lastRow < start) return {};

  const n = lastRow - start + 1;
  const keys = aiSheet.getRange(start, CONFIG.SRC_AI_COL_KEY, n, 1).getValues();
  const paths = aiSheet.getRange(start, CONFIG.SRC_AI_COL_PATH, n, 1).getValues();

  const map = {};
  for (let i = 0; i < n; i++) {
    const key = normalizeKey_(keys[i][0]);
    if (!key) continue;
    const p = String(paths[i][0] ?? "").trim();
    if (!p) continue;
    map[key] = p;
  }
  return map;
}

function resolveAiFileId_(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const idFromUrl = extractDriveFileId_(s);
  if (idFromUrl) return idFromUrl;

  if (/^[a-zA-Z0-9_-]{15,}$/.test(s) && !s.includes("/")) return s;

  const parts = s.split("/");
  let folderName = "";
  let fileName = "";
  if (parts.length >= 2) {
    folderName = parts[0].trim();
    fileName = parts.slice(1).join("/").trim();
  } else {
    folderName = CONFIG.AI_DEFAULT_FOLDER_NAME;
    fileName = s;
  }
  if (!folderName) folderName = CONFIG.AI_DEFAULT_FOLDER_NAME;
  if (!fileName) return "";

  const cache = CacheService.getScriptCache();

  const folderIdKey = "AI_FOLDER_ID::" + folderName;
  let folderId = cache.get(folderIdKey);
  if (!folderId) {
    const it = DriveApp.getFoldersByName(folderName);
    if (!it.hasNext()) return "";
    const folder = it.next();
    folderId = folder.getId();
    cache.put(folderIdKey, folderId, 21600);
  }

  const fileKey = "AI_FILE_ID::" + folderId + "::" + fileName;
  const cachedFileId = cache.get(fileKey);
  if (cachedFileId) return cachedFileId;

  const folder = DriveApp.getFolderById(folderId);
  const fit = folder.getFilesByName(fileName);
  if (!fit.hasNext()) return "";
  const f = fit.next();
  const fileId = f.getId();
  cache.put(fileKey, fileId, 21600);
  return fileId;
}

function buildImageFormula_(fileId) {
  const id = String(fileId ?? "").trim();
  if (!id) return "";
  const url = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w1000";
  return '="' + url + '"';
}

function extractDriveFileId_(s) {
  const str = String(s ?? "").trim();
  if (!str) return "";
  const m1 = str.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1 && m1[1]) return m1[1];
  const m2 = str.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2 && m2[1]) return m2[1];
  return "";
}

function publishAiImagesInDest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    setGuardOn_();

    const { aiSheet, destSheet } = openSheets_();
    const aiPathMap = getAiPathMapCached_(aiSheet);

    const last = destSheet.getLastRow();
    if (last < CONFIG.DEST_START_ROW) return;

    const n = last - CONFIG.DEST_START_ROW + 1;
    const keys = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_KEY, n, 1).getValues();

    const done = {};
    for (let i = 0; i < n; i++) {
      const k = normalizeKey_(keys[i][0]);
      if (!k) continue;
      const p = aiPathMap[k] || "";
      if (!p) continue;
      const id = resolveAiFileId_(p);
      if (!id) continue;
      if (done[id]) continue;
      done[id] = true;
      try {
        DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {}
    }
  } catch (err) {
    saveError_(err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function openSheets_() {
  const srcSS = SpreadsheetApp.openById(CONFIG.SRC_SPREADSHEET_ID);
  const recoverySheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_RECOVERY_NAME);
  const productSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_PRODUCT_NAME);
  const returnSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_RETURN_NAME);
  const aiSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_AI_NAME);

  if (!recoverySheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_RECOVERY_NAME);
  if (!productSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_PRODUCT_NAME);
  if (!returnSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_RETURN_NAME);
  if (!aiSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_AI_NAME);

  const destSS = SpreadsheetApp.openById(CONFIG.DEST_SPREADSHEET_ID);
  let destSheet = destSS.getSheetByName(CONFIG.DEST_SHEET_NAME);
  if (!destSheet) destSheet = destSS.insertSheet(CONFIG.DEST_SHEET_NAME);

  return { srcSS, recoverySheet, productSheet, returnSheet, aiSheet, destSS, destSheet };
}

function installTriggers() {
  deleteTriggers();

  const srcSS = SpreadsheetApp.openById(CONFIG.SRC_SPREADSHEET_ID);
  const destSS = SpreadsheetApp.openById(CONFIG.DEST_SPREADSHEET_ID);

  ScriptApp.newTrigger("syncListingPublic").forSpreadsheet(srcSS).onEdit().create();
  ScriptApp.newTrigger("syncListingPublic").forSpreadsheet(srcSS).onFormSubmit().create();
  ScriptApp.newTrigger("syncListingPublicCron").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("onDestCheckboxEdit").forSpreadsheet(destSS).onEdit().create();
}

function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const fn = t.getHandlerFunction();
    if (fn === "syncListingPublic" || fn === "syncListingPublicCron" || fn === "onDestCheckboxEdit") {
      ScriptApp.deleteTrigger(t);
    }
  }
}

function forceSyncNow() {
  syncListingPublicCron();
}

function getLastError() {
  const props = PropertiesService.getScriptProperties();
  const lastOk = props.getProperty(PROP_KEYS.LAST_OK_AT) || "";
  const lastErrAt = props.getProperty(PROP_KEYS.LAST_ERROR_AT) || "";
  const lastErrMsg = props.getProperty(PROP_KEYS.LAST_ERROR_MSG) || "";
  return [
    "LAST_OK_AT=" + lastOk,
    "LAST_ERROR_AT=" + lastErrAt,
    "LAST_ERROR_MSG=" + lastErrMsg
  ].join("\n");
}

function ensureSheetSize_(sheet, minRows, minCols) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < minRows) sheet.insertRowsAfter(maxRows, minRows - maxRows);

  const maxCols = sheet.getMaxColumns();
  if (maxCols < minCols) sheet.insertColumnsAfter(maxCols, minCols - maxCols);
}

function withRetry_(fn, retries, sleepMs) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      if (i === retries) throw lastErr;
      Utilities.sleep(sleepMs * (i + 1));
    }
  }
  throw lastErr;
}

function saveError_(err) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_KEYS.LAST_ERROR_AT, new Date().toISOString());
  props.setProperty(PROP_KEYS.LAST_ERROR_MSG, String(err && err.stack ? err.stack : err));
}

function normalizeKey_(v) {
  return String(v ?? "").trim();
}

function isBlank_(v) {
  return String(v ?? "").trim() === "";
}

function convertFreeSizeToF_(v) {
  const s = String(v ?? "").trim();
  if (s === "フリーサイズ") return "F";
  return v;
}

function convertCondition(v) {
  const s = String(v ?? "").trim();
  if (s === "新品、未使用") return "S";
  if (s === "未使用に近い") return "A";
  if (s === "目立った傷や汚れなし") return "AB";
  if (s === "やや傷や汚れあり") return "B";
  if (s === "傷や汚れあり") return "C";
  if (s === "全体的に状態が悪い") return "D";
  return s;
}

function normalizeSellPrice_(p) {
  const v = Number(p);
  if (!isFinite(v)) return p;
  const base = Math.floor(v / 100) * 100;
  if (v <= base) return base;
  if (v <= base + 50) return base + 50;
  return base + 100;
}

function convertRecoveryK_(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (s === "") return "";
  const n = Number(s);
  if (!isFinite(n)) return v;

  let p = n;

  if (n >= 0 && n <= 50) p = 100;
else if (n >= 51 && n <= 100) p = 220;
else if (n >= 101 && n <= 149) p = 330;
else if (n >= 150 && n <= 199) p = 385;
else if (n >= 200 && n <= 249) p = 495;
else if (n >= 250 && n <= 299) p = 550;
else if (n >= 300 && n <= 349) p = 605;
else if (n >= 350 && n <= 399) p = 660;
else if (n >= 400 && n <= 449) p = 715;
else if (n >= 450 && n <= 499) p = 825;
else if (n >= 500 && n <= 549) p = 880;
else if (n >= 550 && n <= 599) p = 935;
else if (n >= 600 && n <= 649) p = 990;
else if (n >= 650 && n <= 699) p = 1045;
else if (n >= 700 && n <= 749) p = 1155;
else if (n >= 750 && n <= 799) p = 1210;
else if (n >= 800 && n <= 849) p = 1265;
else if (n >= 850 && n <= 899) p = 1320;
else if (n >= 900 && n <= 949) p = 1375;
else if (n >= 950 && n <= 999) p = 1485;
else if (n >= 1000 && n <= 1049) p = 1540;
else if (n >= 1050 && n <= 1099) p = 1595;
else if (n >= 1100 && n <= 1149) p = 1650;
else if (n >= 1150 && n <= 1199) p = 1705;
else if (n >= 1200 && n <= 1249) p = 1815;
else if (n >= 1250 && n <= 1299) p = 1870;
else if (n >= 1300 && n <= 1349) p = 1925;
else if (n >= 1350 && n <= 1399) p = 1980;
else if (n >= 1400 && n <= 1449) p = 2035;
else if (n >= 1450 && n <= 1499) p = 2145;
else if (n >= 1500 && n <= 1549) p = 2200;
else if (n >= 1550 && n <= 1599) p = 2255;
else if (n >= 1600 && n <= 1649) p = 2310;
else if (n >= 1650 && n <= 1699) p = 2365;

  return normalizeSellPrice_(p);
}

function isGuardOn_() {
  const v = CacheService.getScriptCache().get(CONFIG.GUARD_KEY);
  return v === "1";
}

function setGuardOn_() {
  CacheService.getScriptCache().put(CONFIG.GUARD_KEY, "1", CONFIG.GUARD_TTL_SEC);
}

function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu("管理メニュー")
    .addItem("一括でチェックをつける", "checkManagement")
    .addItem("チェック全解除", "clearAllChecks")
    .addItem("色を再同期", "syncCheckboxMarksNow")
    .addToUi();
}

function clearAllChecks() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    setGuardOn_();
    const { recoverySheet, returnSheet, destSheet } = openSheets_();

    const last = destSheet.getLastRow();
    if (last >= CONFIG.DEST_START_ROW) {
      const n = last - CONFIG.DEST_START_ROW + 1;
      const falses = new Array(n);
      for (let i = 0; i < n; i++) falses[i] = [false];
      destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_CHECK, n, 1).setValues(falses);
    }

    syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
  } catch (err) {
    saveError_(err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function syncCheckboxMarksNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    setGuardOn_();
    const { recoverySheet, returnSheet, destSheet } = openSheets_();
    syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
  } catch (err) {
    saveError_(err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function checkManagement() {
  const ui = SpreadsheetApp.getUi();

  const res = ui.prompt(
    "チェック管理",
    "K列の管理番号を「、」または「,」区切りで入力してください。\n例：ZB1、ZB2、ZB3",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const input = String(res.getResponseText() || "").trim();
  if (!input) {
    ui.alert("入力が空です。");
    return;
  }

  const ids = input
    .split(/[、,，\n\r\t ]+/)
    .map(s => String(s).trim())
    .filter(s => s.length > 0);

  if (ids.length === 0) {
    ui.alert("有効な管理番号がありません。");
    return;
  }

  const uniqueIds = Array.from(new Set(ids));
  const targetSet = new Set(uniqueIds);

  const lock = LockService.getScriptLock();

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast("他の処理が終わるまで待機中…", "チェック管理", 5);
    lock.waitLock(30000);

    setGuardOn_();

    const { recoverySheet, returnSheet, destSheet } = openSheets_();

    const startRow = CONFIG.DEST_START_ROW;
    const lastRow = destSheet.getLastRow();
    if (lastRow < startRow) {
      ui.alert("データがありません（" + startRow + "行目以降）。");
      return;
    }

    const numRows = lastRow - startRow + 1;

    ensureCheckboxValidation_(destSheet, startRow, numRows);

    const kVals = destSheet.getRange(startRow, CONFIG.DEST_COL_KEY, numRows, 1).getDisplayValues();
    const jRange = destSheet.getRange(startRow, CONFIG.DEST_COL_CHECK, numRows, 1);
    const jVals = jRange.getValues();

    const foundSet = new Set();
    let matchedRows = 0;
    let newlyChecked = 0;

    for (let i = 0; i < numRows; i++) {
      const key = normalizeKey_(kVals[i][0]);
      if (!key) continue;
      if (!targetSet.has(key)) continue;

      foundSet.add(key);
      matchedRows++;

      if (jVals[i][0] !== true) {
        jVals[i][0] = true;
        newlyChecked++;
      }
    }

    jRange.setValues(jVals);

    syncCheckboxMarksAll_(destSheet, recoverySheet, returnSheet);

    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());

    const notFound = uniqueIds.filter(id => !foundSet.has(id));

    if (matchedRows === 0) {
      ui.alert("該当なし", "一致する管理番号がデータ1のK列に見つかりませんでした。", ui.ButtonSet.OK);
      return;
    }

    if (notFound.length > 0) {
      ui.alert(
        "チェック完了",
        "一致行数：" + matchedRows + "\n新規チェック数：" + newlyChecked + "\n見つからなかった管理番号：\n" + notFound.join("、"),
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        "チェック完了",
        "一致行数：" + matchedRows + "\n新規チェック数：" + newlyChecked,
        ui.ButtonSet.OK
      );
    }
  } catch (err) {
    if (String(err && err.message || err).indexOf("timed out") !== -1) {
      ui.alert("別の処理が実行中です。30秒待っても終わらなかったため中断しました。");
      return;
    }
    saveError_(err);
    throw err;
  } finally {
    try {
      if (lock && lock.hasLock()) lock.releaseLock();
    } catch (e) {}
  }
}


function app_debugData1_() {
  const ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  const shName = String(APP_CONFIG.data.sheetName || '').trim();
  const headerRow = Number(APP_CONFIG.data.headerRow || 3);
  const readCols = Number(APP_CONFIG.data.readCols || 11);

  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(shName);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  const startRow = Math.max(headerRow + 1, lastRow - 20);
  const numRows = Math.max(0, lastRow - startRow + 1);
  const numCols = Math.min(readCols, Math.max(1, lastCol));

  const tail = numRows > 0 ? sh.getRange(startRow, 1, numRows, numCols).getDisplayValues() : [];

  return {
    now: new Date().toISOString(),
    spreadsheetId: ssId,
    sheetName: shName,
    headerRow: headerRow,
    readCols: readCols,
    lastRow: lastRow,
    lastCol: lastCol,
    tail: tail
  };
}
