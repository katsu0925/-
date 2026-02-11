const CONFIG = {
  // APP_CONFIG.detail.spreadsheetId から取得（一元管理）
  get SRC_SPREADSHEET_ID() { return String((APP_CONFIG.detail && APP_CONFIG.detail.spreadsheetId) || ''); },
  SRC_SHEET_PRODUCT_NAME: "商品管理",
  SRC_SHEET_RETURN_NAME: "返送管理",
  SRC_SHEET_AI_NAME: "AIキーワード抽出",

  // APP_CONFIG.data.spreadsheetId から取得（一元管理）
  get DEST_SPREADSHEET_ID() { return String(APP_CONFIG.data.spreadsheetId || ''); },
  DEST_SHEET_NAME: "データ1",

  DEST_START_ROW: 4,
  DEST_WRITE_START_COL: 2,

  DEST_COL_CHECK: 10,
  DEST_COL_KEY: 11,

  SRC_PRODUCT_START_ROW: 2,

  DEST_COL_SHIPPING: 25,

  SRC_RETURN_START_ROW: 2,
  SRC_RETURN_COL_C: 3,

  SRC_AI_START_ROW: 2,
  SRC_AI_COL_KEY: 2,
  SRC_AI_COL_PATH: 3,

  AI_DEFAULT_FOLDER_NAME: "AIキーワード抽出_Images",

  CACHE_TTL_SEC: 300,

  GUARD_KEY: "PUBLIC_SYNC_GUARD",
  GUARD_TTL_SEC: 50
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
    const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
    syncFull_(productSheet, returnSheet, aiSheet, destSheet);
    const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
    ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
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

    if (name === CONFIG.SRC_SHEET_PRODUCT_NAME) {
      app_log_('PRODUCT edit');
      clearProductCache_();
      setGuardOn_();

      const t0 = Date.now();
      app_log_('openSheets_ START');
      const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));

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
      const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));

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
      const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
      app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

      const t1 = Date.now();
      app_log_('syncFull_ START');
      syncFull_(productSheet, returnSheet, aiSheet, destSheet);
      app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

      const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
      ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));

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

    clearProductCache_();
    clearReturnCache_();

    const t0 = Date.now();
    app_log_('openSheets_ START');
    const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
    app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

    const t1 = Date.now();
    app_log_('syncFull_ START');
    syncFull_(productSheet, returnSheet, aiSheet, destSheet);
    app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

    const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
    const t2 = Date.now();
    app_log_('ensureCheckboxValidation_ START', { lastRow: lastRow });
    ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));
    app_log_('ensureCheckboxValidation_ DONE', { ms: Date.now() - t2 });

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

/**
 * syncFull_ — 商品管理+返送管理+AIキーワード抽出 → データ1 直接同期
 * フィルタ: 管理番号 が 返送管理 に存在するもののみ
 */
function syncFull_(productSheet, returnSheet, aiSheet, destSheet) {
  const productMap = getProductMapCached_(productSheet);
  const returnSet = getReturnSetCached_(returnSheet);
  const aiPathMap = getAiPathMapCached_(aiSheet);

  const MEAS_START_COL = 12; // L列
  const MEAS_END_COL = 24;   // X列
  const MEAS_WIDTH = MEAS_END_COL - MEAS_START_COL + 1; // 13列
  const IMG_COL = CONFIG.DEST_WRITE_START_COL; // B列(=2)

  const keepCheckByKey = {};
  const measurementsByKey = {};
  const existImgByKey = {};
  const destLastRow = destSheet.getLastRow();
  if (destLastRow >= CONFIG.DEST_START_ROW) {
    const nExist = destLastRow - CONFIG.DEST_START_ROW + 1;
    const existChecks = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_CHECK, nExist, 1).getValues();
    const existKeys = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_KEY, nExist, 1).getValues();
    const existMeas = destSheet.getRange(CONFIG.DEST_START_ROW, MEAS_START_COL, nExist, MEAS_WIDTH).getValues();
    const existImgs = destSheet.getRange(CONFIG.DEST_START_ROW, IMG_COL, nExist, 1).getFormulas();
    for (let i = 0; i < nExist; i++) {
      const k = normalizeKey_(existKeys[i][0]);
      if (!k) continue;
      if (existChecks[i][0] === true) keepCheckByKey[k] = true;
      const hasData = existMeas[i].some(v => v !== '' && v !== null && v !== undefined);
      if (hasData) measurementsByKey[k] = existMeas[i];
      if (existImgs[i][0]) existImgByKey[k] = existImgs[i][0];
    }
  }

  const out = [];
  const outShipping = [];
  const outMeasurements = [];
  const emptyMeas = new Array(MEAS_WIDTH).fill('');
  const keys = Object.keys(productMap);

  for (let i = 0; i < keys.length; i++) {
    const keyC = keys[i];
    if (!returnSet[keyC]) continue;

    const rec = productMap[keyC];
    if (rec.bizStatus !== '返品済み') continue;
    const insertedStatus = convertCondition(rec.status);
    const brand = rec.brand;
    const size = convertFreeSizeToF_(rec.size);
    const gender = rec.gender;
    const category = rec.category;
    const color = rec.color;
    const insertedPrice = convertRecoveryK_(rec.cost);
    const shippingMethod = rec.shipping;
    const keepCheck = keepCheckByKey[keyC] === true;

    // 既存の画像数式があればDrive API呼び出しをスキップ
    let imgFormula = existImgByKey[keyC] || "";
    if (!imgFormula) {
      const rawPath = aiPathMap[keyC] || "";
      var fileId = "";
      try {
        fileId = rawPath ? resolveAiFileId_(rawPath) : "";
      } catch (e) {
        if (!syncFull_._aiErrLogged) {
          console.warn('resolveAiFileId_ error (以降省略):', e.message || e);
          syncFull_._aiErrLogged = true;
        }
      }
      imgFormula = fileId ? buildImageFormula_(fileId) : "";
    }

    out.push([imgFormula, insertedStatus, brand, size, gender, category, color, insertedPrice, keepCheck, keyC]);
    outShipping.push([shippingMethod]);
    // 商品管理の採寸データを優先、なければ既存データ1の値を保持
    const srcMeas = rec.measurements || emptyMeas;
    const hasSrcMeas = srcMeas.some(v => v !== '' && v !== null && v !== undefined);
    outMeasurements.push(hasSrcMeas ? srcMeas : (measurementsByKey[keyC] || emptyMeas));
  }

  const width = CONFIG.DEST_COL_KEY - CONFIG.DEST_WRITE_START_COL + 1;

  const writeCount = out.length;
  const currentLast = destSheet.getLastRow();
  const targetLast = Math.max(currentLast, CONFIG.DEST_START_ROW + Math.max(0, writeCount - 1));

  if (targetLast >= CONFIG.DEST_START_ROW) {
    ensureSheetSize_(destSheet, targetLast, CONFIG.DEST_COL_SHIPPING);

    if (writeCount > 0) {
      withRetry_(
        () => destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_WRITE_START_COL, writeCount, width).setValues(out),
        2,
        500
      );
      withRetry_(
        () => destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_SHIPPING, writeCount, 1).setValues(outShipping),
        2,
        500
      );
      withRetry_(
        () => destSheet.getRange(CONFIG.DEST_START_ROW, MEAS_START_COL, writeCount, MEAS_WIDTH).setValues(outMeasurements),
        2,
        500
      );
    }

    const clearStart = CONFIG.DEST_START_ROW + writeCount;
    const clearRows = targetLast - clearStart + 1;
    if (clearRows > 0) {
      const destLastCol = Math.max(destSheet.getLastColumn(), CONFIG.DEST_COL_SHIPPING);
      const fullWidth = Math.max(width, destLastCol - CONFIG.DEST_WRITE_START_COL + 1);
      const blanks = new Array(clearRows);
      for (let i = 0; i < clearRows; i++) {
        const row = new Array(fullWidth).fill('');
        row[CONFIG.DEST_COL_CHECK - CONFIG.DEST_WRITE_START_COL] = false;
        blanks[i] = row;
      }
      withRetry_(
        () => destSheet.getRange(clearStart, CONFIG.DEST_WRITE_START_COL, clearRows, fullWidth).setValues(blanks),
        2,
        500
      );
    }
  }

  try {
    pr_bumpProductsVersion_();
    pr_clearProductsCache_();
  } catch (e) {}
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

/**
 * buildProductMap_ — 商品管理をヘッダベースで読み取り、管理番号→全フィールドのマップを構築
 */
function buildProductMap_(productSheet) {
  const lastRow = productSheet.getLastRow();
  const lastCol = productSheet.getLastColumn();
  const map = {};
  if (lastRow < CONFIG.SRC_PRODUCT_START_ROW || lastCol < 1) return map;

  const headers = productSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });

  const rows = lastRow - CONFIG.SRC_PRODUCT_START_ROW + 1;
  const data = productSheet.getRange(CONFIG.SRC_PRODUCT_START_ROW, 1, rows, lastCol).getValues();

  for (let i = 0; i < rows; i++) {
    const r = data[i];
    const key = normalizeKey_(idx['管理番号'] !== undefined ? r[idx['管理番号']] : '');
    if (!key) continue;

    map[key] = {
      status: idx['状態'] !== undefined ? (r[idx['状態']] || '') : '',
      bizStatus: idx['ステータス'] !== undefined ? (r[idx['ステータス']] || '') : '',
      brand: idx['ブランド'] !== undefined ? (r[idx['ブランド']] || '') : '',
      size: idx['メルカリサイズ'] !== undefined ? (r[idx['メルカリサイズ']] || '') : '',
      gender: idx['性別'] !== undefined ? (r[idx['性別']] || '') : '',
      category: idx['カテゴリ2'] !== undefined ? (r[idx['カテゴリ2']] || '') : '',
      color: idx['カラー'] !== undefined ? (r[idx['カラー']] || '') : '',
      cost: idx['仕入れ値'] !== undefined ? r[idx['仕入れ値']] : '',
      shipping: idx['発送方法'] !== undefined ? (r[idx['発送方法']] || '') : '',
      // 採寸情報 (L-X列: 着丈,肩幅,身幅,袖丈,桁丈,総丈,ウエスト,股上,股下,ワタリ,裾幅,ヒップ,汚れ詳)
      measurements: [
        idx['着丈'] !== undefined ? (r[idx['着丈']] ?? '') : '',
        idx['肩幅'] !== undefined ? (r[idx['肩幅']] ?? '') : '',
        idx['身幅'] !== undefined ? (r[idx['身幅']] ?? '') : '',
        idx['袖丈'] !== undefined ? (r[idx['袖丈']] ?? '') : '',
        idx['桁丈'] !== undefined ? (r[idx['桁丈']] ?? '') : '',
        idx['総丈'] !== undefined ? (r[idx['総丈']] ?? '') : '',
        idx['ウエスト'] !== undefined ? (r[idx['ウエスト']] ?? '') : '',
        idx['股上'] !== undefined ? (r[idx['股上']] ?? '') : '',
        idx['股下'] !== undefined ? (r[idx['股下']] ?? '') : '',
        idx['ワタリ'] !== undefined ? (r[idx['ワタリ']] ?? '') : '',
        idx['裾幅'] !== undefined ? (r[idx['裾幅']] ?? '') : '',
        idx['ヒップ'] !== undefined ? (r[idx['ヒップ']] ?? '') : '',
        idx['傷汚れ詳細'] !== undefined ? (r[idx['傷汚れ詳細']] ?? '') : ''
      ]
    };
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

/** Drive権限テスト — エディタから実行して権限を承認する用 */
function testDrivePermission() {
  var it = DriveApp.getFoldersByName('_test_permission_check_');
  console.log('DriveApp OK: フォルダ検索権限あり');
}

/** 手動テスト用（ロック/ガード無視） — エディタから実行 */
function syncManualTest() {
  clearProductCache_();
  clearReturnCache_();
  const { productSheet, returnSheet, aiSheet, destSheet } = openSheets_();
  syncFull_(productSheet, returnSheet, aiSheet, destSheet);
  console.log('syncManualTest 完了');
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
  const productSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_PRODUCT_NAME);
  const returnSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_RETURN_NAME);
  const aiSheet = srcSS.getSheetByName(CONFIG.SRC_SHEET_AI_NAME);

  if (!productSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_PRODUCT_NAME);
  if (!returnSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_RETURN_NAME);
  if (!aiSheet) throw new Error("元シートが見つかりません: " + CONFIG.SRC_SHEET_AI_NAME);

  const destSS = SpreadsheetApp.openById(CONFIG.DEST_SPREADSHEET_ID);
  let destSheet = destSS.getSheetByName(CONFIG.DEST_SHEET_NAME);
  if (!destSheet) destSheet = destSS.insertSheet(CONFIG.DEST_SHEET_NAME);

  return { srcSS, productSheet, returnSheet, aiSheet, destSS, destSheet };
}

function installTriggers() {
  deleteTriggers();

  const srcSS = SpreadsheetApp.openById(CONFIG.SRC_SPREADSHEET_ID);

  ScriptApp.newTrigger("syncListingPublic").forSpreadsheet(srcSS).onEdit().create();
  ScriptApp.newTrigger("syncListingPublic").forSpreadsheet(srcSS).onFormSubmit().create();
  ScriptApp.newTrigger("syncListingPublicCron").timeBased().everyMinutes(1).create();
}

function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const fn = t.getHandlerFunction();
    if (fn === "syncListingPublic" || fn === "syncListingPublicCron") {
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
    .addItem("1. 依頼展開（受付番号→回収完了へ展開）", "expandOrder")
    .addItem("2. 配布用リスト生成＋XLSX出力", "generateAndExportForOrder")
    .addItem("3. 欠品処理", "handleMissingProducts")
    .addItem("4. 売却反映（チェック行を一括処理）", "processSelectedSales")
    .addItem("5. 再生成（受付番号で回収完了を再作成）", "regenerateOrder")
    .addSeparator()
    .addItem("一括でチェックをつける", "checkManagement")
    .addItem("チェック全解除", "clearAllChecks")
    .addSeparator()
    .addItem("会員割引 ON/OFF 切替", "toggleMemberDiscount")
    .addItem("会員割引 期限変更", "setMemberDiscountEndDate")
    .addSeparator()
    .addItem("顧客ポイント付与（完了済み注文）", "processCustomerPoints")
    .addSeparator()
    .addItem("領収書送付（完了済み・希望者）", "processInvoiceReceipts")
    .addItem("領収書取消（キャンセル/返品）", "processCancelledInvoices")
    .addSeparator()
    .addItem("不要トリガー一括削除", "cleanupObsoleteTriggers")
    .addToUi();
}

function clearAllChecks() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    setGuardOn_();
    const { destSheet } = openSheets_();

    const last = destSheet.getLastRow();
    if (last >= CONFIG.DEST_START_ROW) {
      const n = last - CONFIG.DEST_START_ROW + 1;
      const falses = new Array(n);
      for (let i = 0; i < n; i++) falses[i] = [false];
      destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_CHECK, n, 1).setValues(falses);
    }

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
    SpreadsheetApp.getActiveSpreadsheet().toast("他の処理が終わるまで待機中…", "チェック管理", 10);
    if (!lock.tryLock(5000)) {
      lock.waitLock(60000);
    }

    setGuardOn_();

    const { destSheet } = openSheets_();

    const startRow = CONFIG.DEST_START_ROW;
    const lastRow = destSheet.getLastRow();
    if (lastRow < startRow) {
      lock.releaseLock();
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

    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());

    const notFound = uniqueIds.filter(id => !foundSet.has(id));

    if (matchedRows === 0) {
      lock.releaseLock();
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
    const errMsg = String(err && err.message || err);
    if (errMsg.indexOf("timed out") !== -1 || errMsg.indexOf("ロックのタイムアウト") !== -1) {
      ui.alert("ロックエラー", "別の処理が実行中です。しばらく待ってから再度お試しください。\n\n詳細: " + errMsg, ui.ButtonSet.OK);
      return;
    }
    saveError_(err);
    ui.alert("エラー", "処理中にエラーが発生しました: " + errMsg, ui.ButtonSet.OK);
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
