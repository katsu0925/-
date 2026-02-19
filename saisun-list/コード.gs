const CONFIG = {
  // APP_CONFIG.detail.spreadsheetId から取得（一元管理）
  get SRC_SPREADSHEET_ID() { return String((APP_CONFIG.detail && APP_CONFIG.detail.spreadsheetId) || ''); },
  SRC_SHEET_PRODUCT_NAME: "商品管理",
  SRC_SHEET_RETURN_NAME: "返送管理",
  SRC_SHEET_AI_NAME: "AIキーワード抽出",

  // APP_CONFIG.data.spreadsheetId から取得（一元管理）
  get DEST_SPREADSHEET_ID() { return String(APP_CONFIG.data.spreadsheetId || ''); },
  DEST_SHEET_NAME: "データ1",
  DEST_SHEET_TANAOROSHI: "返品棚卸し",

  DEST_START_ROW: 3,
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
    const { productSheet, returnSheet, aiSheet, destSS, destSheet } = openSheets_();
    syncFull_(productSheet, returnSheet, aiSheet, destSheet);
    syncTanaoroshi_(productSheet, returnSheet, destSS);
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
  if (!lock.tryLock(30000)) {
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

    const CLEAR_CACHE_MAP_ = {};
    CLEAR_CACHE_MAP_[CONFIG.SRC_SHEET_PRODUCT_NAME] = clearProductCache_;
    CLEAR_CACHE_MAP_[CONFIG.SRC_SHEET_RETURN_NAME] = clearReturnCache_;
    CLEAR_CACHE_MAP_[CONFIG.SRC_SHEET_AI_NAME] = clearAiPathCache_;

    const clearFn = CLEAR_CACHE_MAP_[name];
    if (!clearFn) {
      app_log_('syncListingPublic SKIP sheetNotTarget', { sheetName: name, totalMs: Date.now() - started });
      return;
    }

    app_log_(name + ' edit');
    clearFn();
    setGuardOn_();

    const t0 = Date.now();
    app_log_('openSheets_ START');
    const { productSheet, returnSheet, aiSheet, destSS, destSheet } = openSheets_();
    app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

    const t1 = Date.now();
    app_log_('syncFull_ START');
    syncFull_(productSheet, returnSheet, aiSheet, destSheet);
    app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

    syncTanaoroshi_(productSheet, returnSheet, destSS);

    const lastRow = Math.max(destSheet.getLastRow(), CONFIG.DEST_START_ROW);
    ensureCheckboxValidation_(destSheet, CONFIG.DEST_START_ROW, Math.max(0, lastRow - CONFIG.DEST_START_ROW + 1));

    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_OK_AT, new Date().toISOString());
    app_log_(name + ' END OK', { totalMs: Date.now() - started });
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
  if (!lock.tryLock(30000)) {
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
    const { productSheet, returnSheet, aiSheet, destSS, destSheet } = openSheets_();
    app_log_('openSheets_ DONE', { ms: Date.now() - t0 });

    const t1 = Date.now();
    app_log_('syncFull_ START');
    syncFull_(productSheet, returnSheet, aiSheet, destSheet);
    app_log_('syncFull_ DONE', { ms: Date.now() - t1 });

    syncTanaoroshi_(productSheet, returnSheet, destSS);

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

function app_cachePutLarge_(cache, baseKey, str, seconds) {
  const s = str == null ? '' : String(str);
  const chunkSize = 90000;

  const n = Math.ceil(s.length / chunkSize);
  const putObj = {};
  putObj[baseKey + ':N'] = String(n);
  for (let i = 0; i < n; i++) {
    putObj[baseKey + ':' + i] = s.slice(i * chunkSize, (i + 1) * chunkSize);
  }
  try {
    cache.putAll(putObj, seconds);
  } catch (e) {
    for (const k in putObj) cache.put(k, putObj[k], seconds);
  }
}

function app_cacheGetLarge_(cache, baseKey) {
  const nStr = cache.get(baseKey + ':N');
  if (!nStr) return null;

  const n = Number(nStr || '0');
  if (!n) return null;

  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = baseKey + ':' + i;
  const all = cache.getAll(keys);

  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = all[keys[i]];
    if (p == null) return null;
    parts.push(p);
  }
  return parts.join('');
}

function app_cacheDeleteLarge_(cache, baseKey) {
  const nStr = cache.get(baseKey + ':N');
  const n = Number(nStr || '0');

  const keys = [baseKey + ':N', baseKey];
  for (let i = 0; i < n; i++) keys.push(baseKey + ':' + i);
  try {
    cache.removeAll(keys);
  } catch (e) {
    for (let i = 0; i < keys.length; i++) cache.remove(keys[i]);
  }
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
    // B(2)〜X(24) を1回で読み取り
    const allVals = destSheet.getRange(CONFIG.DEST_START_ROW, IMG_COL, nExist, MEAS_END_COL - IMG_COL + 1).getValues();
    const existImgs = destSheet.getRange(CONFIG.DEST_START_ROW, IMG_COL, nExist, 1).getFormulas();
    const checkOff = CONFIG.DEST_COL_CHECK - IMG_COL;   // J列のオフセット
    const keyOff = CONFIG.DEST_COL_KEY - IMG_COL;       // K列のオフセット
    const measOff = MEAS_START_COL - IMG_COL;            // L列のオフセット
    for (let i = 0; i < nExist; i++) {
      const row = allVals[i];
      const k = normalizeKey_(row[keyOff]);
      if (!k) continue;
      if (row[checkOff] === true) keepCheckByKey[k] = true;
      const meas = row.slice(measOff, measOff + MEAS_WIDTH);
      const hasData = meas.some(v => v !== '' && v !== null && v !== undefined);
      if (hasData) measurementsByKey[k] = meas;
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

    // 状態による価格調整
    let adjustedPrice = insertedPrice;
    if (typeof insertedPrice === 'number' && isFinite(insertedPrice)) {
      const rawStatus = String(rec.status || '');
      if (rawStatus === '傷や汚れあり' || rawStatus === 'やや傷や汚れあり' || rawStatus === '全体的に状態が悪い') {
        adjustedPrice = Math.round(insertedPrice * 0.8);
      } else if (rawStatus === '目立った傷や汚れなし' && rec.measurements[12] && String(rec.measurements[12]).trim() !== '') {
        adjustedPrice = Math.round(insertedPrice * 0.9);
      }
    }

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

    out.push([imgFormula, insertedStatus, brand, size, gender, category, color, adjustedPrice, keepCheck, keyC]);
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
      // B(2)〜Y(25) を1回で書き込み
      const fullWidth = CONFIG.DEST_COL_SHIPPING - CONFIG.DEST_WRITE_START_COL + 1;
      const measOff = MEAS_START_COL - CONFIG.DEST_WRITE_START_COL;
      const shipOff = CONFIG.DEST_COL_SHIPPING - CONFIG.DEST_WRITE_START_COL;
      const combined = new Array(writeCount);
      for (let i = 0; i < writeCount; i++) {
        const row = new Array(fullWidth).fill('');
        for (let c = 0; c < width; c++) row[c] = out[i][c];
        for (let c = 0; c < MEAS_WIDTH; c++) row[measOff + c] = outMeasurements[i][c];
        row[shipOff] = outShipping[i][0];
        combined[i] = row;
      }
      withRetry_(
        () => destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_WRITE_START_COL, writeCount, fullWidth).setValues(combined),
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
  } catch (e) { console.error('critical operation failed: products version bump: ' + (e.message || e)); }
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
    } catch (e) { console.log('optional: product map cache parse: ' + (e.message || e)); }
  }

  const map = buildProductMap_(productSheet);
  const json = JSON.stringify(map);

  try {
    app_cachePutLarge_(cache, baseKey, json, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    try {
      cache.put(baseKey, json, CONFIG.CACHE_TTL_SEC);
    } catch (e2) { console.log('optional: product map cache put fallback: ' + (e2.message || e2)); }
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
    } catch (e) { console.log('optional: return set cache parse: ' + (e.message || e)); }
  }

  const setObj = buildReturnSet_(returnSheet);
  const json = JSON.stringify(setObj);

  try {
    app_cachePutLarge_(cache, baseKey, json, CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    try {
      cache.put(baseKey, json, CONFIG.CACHE_TTL_SEC);
    } catch (e2) { console.log('optional: return set cache put fallback: ' + (e2.message || e2)); }
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

    const parts = cell.split(/[,\n\r\t\s、，／\/・|]+/);
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
      } catch (e2) { console.log('optional: ai path cache put bucket: ' + (e2.message || e2)); }
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
  const minCol = Math.min(CONFIG.SRC_AI_COL_KEY, CONFIG.SRC_AI_COL_PATH);
  const maxCol = Math.max(CONFIG.SRC_AI_COL_KEY, CONFIG.SRC_AI_COL_PATH);
  const data = aiSheet.getRange(start, minCol, n, maxCol - minCol + 1).getValues();
  const keyOff = CONFIG.SRC_AI_COL_KEY - minCol;
  const pathOff = CONFIG.SRC_AI_COL_PATH - minCol;

  const map = {};
  for (let i = 0; i < n; i++) {
    const key = normalizeKey_(data[i][keyOff]);
    if (!key) continue;
    const p = String(data[i][pathOff] ?? "").trim();
    if (!p) continue;
    map[key] = p;
  }
  return map;
}

/**
 * syncTanaoroshi_ — 返送管理の管理番号+箱ID → 返品棚卸しシート同期
 * フィルタ: 商品管理のステータスが「返品済み」のもののみ（売却済み等は除外）
 */
function syncTanaoroshi_(productSheet, returnSheet, destSS) {
  const productMap = getProductMapCached_(productSheet);

  const lastRow = returnSheet.getLastRow();
  const start = CONFIG.SRC_RETURN_START_ROW;
  const rows = [];

  if (lastRow >= start) {
    const n = lastRow - start + 1;
    const data = returnSheet.getRange(start, 1, n, CONFIG.SRC_RETURN_COL_C).getValues();

    for (let i = 0; i < n; i++) {
      const boxId = String(data[i][0] ?? '').trim();
      const cell = String(data[i][2] ?? '').trim();
      if (!cell) continue;

      const parts = cell.split(/[,\n\r\t\s、，／\/・|]+/);
      for (let j = 0; j < parts.length; j++) {
        const key = normalizeKey_(parts[j]);
        if (!key) continue;

        const rec = productMap[key];
        if (!rec) continue;
        if (rec.bizStatus !== '返品済み') continue;

        rows.push([false, key, boxId]);
      }
    }
  }

  const sheetName = CONFIG.DEST_SHEET_TANAOROSHI;
  let tSheet = destSS.getSheetByName(sheetName);
  if (!tSheet) tSheet = destSS.insertSheet(sheetName);

  const numCols = 3;
  ensureSheetSize_(tSheet, Math.max(4, 2 + rows.length - 1), 4);

  // ヘッダ + D列メタ情報を1回で書き込み
  tSheet.getRange(1, 1, 4, 4).setValues([
    ['チェック', '管理番号', '箱ID', '更新日時'],
    ['', '', '', new Date()],
    ['', '', '', '点数'],
    ['', '', '', rows.length]
  ]);

  const dataStart = 2;

  if (rows.length > 0) {
    tSheet.getRange(dataStart, 1, rows.length, numCols).setValues(rows);
    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    tSheet.getRange(dataStart, 1, rows.length, 1).setDataValidation(rule);
  }

  const lastExisting = tSheet.getLastRow();
  const clearStart = dataStart + rows.length;
  if (lastExisting >= clearStart) {
    const clearRange = tSheet.getRange(clearStart, 1, lastExisting - clearStart + 1, numCols);
    clearRange.clearContent();
    clearRange.getSheet().getRange(clearStart, 1, lastExisting - clearStart + 1, 1).clearDataValidations();
  }
}

/** 手動テスト用（ロック/ガード無視） — エディタから実行 */
function syncManualTest() {
  clearProductCache_();
  clearReturnCache_();
  const { productSheet, returnSheet, aiSheet, destSS, destSheet } = openSheets_();
  syncFull_(productSheet, returnSheet, aiSheet, destSheet);
  syncTanaoroshi_(productSheet, returnSheet, destSS);
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
      } catch (e) { console.log('optional: set file sharing: ' + (e.message || e)); }
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
  const obj = {};
  obj[PROP_KEYS.LAST_ERROR_AT] = new Date().toISOString();
  obj[PROP_KEYS.LAST_ERROR_MSG] = String(err && err.stack ? err.stack : err);
  props.setProperties(obj);
}

function normalizeKey_(v) {
  return String(v ?? "").trim();
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

const PRICE_TIER_TABLE_ = [
  [50, 200], [100, 320], [149, 430], [199, 485], [249, 595],
  [299, 650], [349, 705], [399, 760], [449, 815], [499, 925],
  [549, 980], [599, 1035], [649, 1090], [699, 1145], [749, 1255],
  [799, 1310], [849, 1365], [899, 1420], [949, 1475], [999, 1585],
  [1049, 1640], [1099, 1695], [1149, 1750], [1199, 1805], [1249, 1915],
  [1299, 1970], [1349, 2025], [1399, 2080], [1449, 2135], [1499, 2245],
  [1549, 2300], [1599, 2355], [1649, 2410], [1699, 2465]
];

function calcPriceTier_(n) {
  if (n < 0) return 0;
  for (let i = 0; i < PRICE_TIER_TABLE_.length; i++) {
    if (n <= PRICE_TIER_TABLE_[i][0]) return PRICE_TIER_TABLE_[i][1];
  }
  return PRICE_TIER_TABLE_[PRICE_TIER_TABLE_.length - 1][1];
}

function convertRecoveryK_(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (s === "") return "";
  const n = Number(s);
  if (!isFinite(n)) return v;
  return normalizeSellPrice_(calcPriceTier_(n));
}

function isGuardOn_() {
  const v = CacheService.getScriptCache().get(CONFIG.GUARD_KEY);
  return v === "1";
}

function setGuardOn_() {
  CacheService.getScriptCache().put(CONFIG.GUARD_KEY, "1", CONFIG.GUARD_TTL_SEC);
}

function onOpen(e) {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("管理メニュー")
    .addItem("1. 依頼展開（展開→XLSX→売却 一括処理）", "expandOrder")
    .addItem("2. 欠品処理（返品→再生成 一括処理）", "handleMissingProducts")
    .addSeparator()
    .addItem("クーポン登録", "registerCoupon")
    .addItem("クーポン削除", "deleteCoupon")
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

  // まとめ商品管理メニューは、まとめ商品スプレッドシートの
  // コンテナバインドスクリプト（saisun-list-bulk/）で表示
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
    } catch (e) { console.log('optional: lock release: ' + (e.message || e)); }
  }
}


