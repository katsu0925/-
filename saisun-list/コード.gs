// コード.gs
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
  DEST_COL_LISTED_DATE: 26, // Z列: デタウリ掲載日

  SRC_RETURN_START_ROW: 2,
  SRC_RETURN_COL_C: 4,

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

/**
 * デバッグ: 特定管理番号がsyncFull_の各段階でどう扱われるか調査
 * GASエディタから実行: debugProductSync('zB1012')
 */
function debugProductSync(targetId) {
  if (!targetId) targetId = 'zB1012';
  var key = normalizeKey_(targetId);
  console.log('=== debugProductSync: ' + key + ' ===');

  // キャッシュクリアして最新データで調査
  clearProductCache_();

  var sheets = openSheets_();
  var productSheet = sheets.productSheet;

  // 商品管理のヘッダーを全出力して「ステータス」列の位置を特定
  var lastCol = productSheet.getLastColumn();
  var headers = productSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var statusCols = [];
  for (var h = 0; h < headers.length; h++) {
    var hName = String(headers[h] || '').trim();
    if (hName.indexOf('ステータス') >= 0 || hName.indexOf('状態') >= 0 || hName.indexOf('状況') >= 0) {
      statusCols.push({ col: h + 1, letter: om_colNumToLetter_(h + 1), header: hName });
    }
  }
  console.log('ステータス/状態/状況 関連列: ' + JSON.stringify(statusCols));

  // 管理番号列を特定
  var idx = {};
  headers.forEach(function(hh, i) { idx[String(hh || '').trim()] = i; });
  var midCol = idx['管理番号'];
  console.log('管理番号列: ' + (midCol !== undefined ? (midCol + 1) + '列目 (' + om_colNumToLetter_(midCol + 1) + ')' : 'なし'));
  console.log('ステータス列(buildProductMap_が使う): ' + (idx['ステータス'] !== undefined ? (idx['ステータス'] + 1) + '列目 (' + om_colNumToLetter_(idx['ステータス'] + 1) + ')' : 'なし'));

  // 対象行を直接シートから読み取り（重複チェック: 全行走査）
  var startRow = CONFIG.SRC_PRODUCT_START_ROW;
  var nRows = productSheet.getLastRow() - startRow + 1;
  var matchCount = 0;
  if (midCol !== undefined && nRows > 0) {
    var allData = productSheet.getRange(startRow, 1, nRows, lastCol).getValues();
    for (var r = 0; r < allData.length; r++) {
      if (normalizeKey_(allData[r][midCol]) === key) {
        matchCount++;
        var brandVal = idx['ブランド'] !== undefined ? String(allData[r][idx['ブランド']] || '') : '?';
        console.log('★ 一致 #' + matchCount + ' 行' + (startRow + r) + ' ブランド="' + brandVal + '"');
        for (var s = 0; s < statusCols.length; s++) {
          var sc = statusCols[s];
          console.log('  ' + sc.letter + '列 "' + sc.header + '": "' + String(allData[r][sc.col - 1] || '') + '"');
        }
      }
    }
    if (matchCount > 1) {
      console.log('⚠⚠⚠ 重複検出: "' + key + '" が商品管理に ' + matchCount + ' 行存在！buildProductMap_は最後の行を使用するため、売却済みの行が無視されています');
    } else if (matchCount === 0) {
      console.log('商品管理にヒットなし');
    }
  }

  var productMap = buildProductMap_(productSheet);
  var returnSet = buildReturnSet_(sheets.returnSheet);

  var rec = productMap[key];
  if (!rec) {
    console.log('productMap に存在しません: ' + key);
  } else {
    console.log('productMap結果:');
    console.log('  bizStatus: "' + rec.bizStatus + '"');
    console.log('  status: "' + rec.status + '"');
    console.log('  brand: "' + rec.brand + '"');
  }

  var inReturn = returnSet[key];
  console.log('返送管理に存在: ' + (inReturn ? 'YES (' + inReturn + ')' : 'NO'));

  if (rec && inReturn) {
    var wouldInclude = (rec.bizStatus === '返品済み');
    console.log('syncFull_でデータ1に含まれるか: ' + (wouldInclude ? '★YES（問題！）' : 'NO（正常除外）'));
  }

  // データ1にいるか確認
  var destSheet = sheets.destSheet;
  var destLastRow = destSheet.getLastRow();
  if (destLastRow >= CONFIG.DEST_START_ROW) {
    var kCol = CONFIG.DEST_COL_KEY;
    var kData = destSheet.getRange(CONFIG.DEST_START_ROW, kCol, destLastRow - CONFIG.DEST_START_ROW + 1, 1).getValues();
    for (var i = 0; i < kData.length; i++) {
      if (normalizeKey_(kData[i][0]) === key) {
        console.log('データ1に存在: 行' + (CONFIG.DEST_START_ROW + i));
        break;
      }
    }
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

  // 安全策: productMap または returnSet が空の場合は既存データ保護のためスキップ
  // （シート読み込み失敗・一時的な権限エラー等で全データを消すのを防ぐ）
  const productKeyCount = Object.keys(productMap).length;
  const returnKeyCount = Object.keys(returnSet).length;
  if (productKeyCount === 0 || returnKeyCount === 0) {
    console.error('syncFull_: SKIP for safety. productMap=' + productKeyCount + ' returnSet=' + returnKeyCount);
    return;
  }

  // パフォーマンス: AIフォルダ全ファイルを一度に取得してマップ化（resolveAiFileId_の高速化用）
  const aiFolderFileMap = buildAiFolderFileMap_(CONFIG.AI_DEFAULT_FOLDER_NAME);

  const MEAS_START_COL = 12; // L列
  const MEAS_END_COL = 24;   // X列
  const MEAS_WIDTH = MEAS_END_COL - MEAS_START_COL + 1; // 13列
  const IMG_COL = CONFIG.DEST_WRITE_START_COL; // B列(=2)

  const keepCheckByKey = {};
  const measurementsByKey = {};
  const existImgByKey = {};
  const listedDateByKey = {}; // 既存の掲載日を保持
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
    // Z列: 既存の掲載日を保持
    try {
      var listedDates = destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_LISTED_DATE, nExist, 1).getValues();
      for (let li = 0; li < nExist; li++) {
        const lk = normalizeKey_(allVals[li][keyOff]);
        if (!lk) continue;
        var ld = listedDates[li][0];
        if (ld instanceof Date && !isNaN(ld)) listedDateByKey[lk] = ld;
      }
    } catch (e) { console.log('掲載日読み取りスキップ:', e.message || e); }
  }

  const out = [];
  const outShipping = [];
  const outMeasurements = [];
  // 画像数式が未確定の行 [outのindex, 管理番号]。ループ後にR2画像で一括補完する
  const needImgRows = [];
  const emptyMeas = new Array(MEAS_WIDTH).fill('');
  const keys = Object.keys(productMap);

  for (let i = 0; i < keys.length; i++) {
    const keyC = keys[i];
    if (!returnSet[keyC]) continue;

    const rec = productMap[keyC];
    if (rec.bizStatus !== '返品済み') {
      if (rec.bizStatus === '売却済み' || rec.bizStatus === '廃棄済み') {
        // 正常除外（ログ不要）
      } else if (rec.bizStatus) {
        console.log('syncFull_: 除外 ' + keyC + ' bizStatus="' + rec.bizStatus + '"');
      }
      continue;
    }
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
      // 未確定行はループ後にR2(タスキ箱)画像で上書きする。ここではDrive経路をフォールバック値として入れておく
      needImgRows.push([out.length, keyC]);
      const rawPath = aiPathMap[keyC] || "";
      var fileId = "";
      try {
        fileId = rawPath ? resolveAiFileId_(rawPath, aiFolderFileMap) : "";
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

  // ── B列画像をR2(タスキ箱)由来のURLで補完 ──
  // 旧経路(AIキーワード抽出シート「写真」列→Driveサムネイル)はAppSheet廃止(2026-04-26)以降
  // 書き手が居なくなり、2026/06以降の撮影分は充填率0%。R2にあればそちらを優先する。
  // 既存の画像数式がある行は対象外なので、現行の表示は一切変わらない。
  if (needImgRows.length > 0) {
    const r2Map = fetchR2ImageUrls_(needImgRows.map(function (r) { return r[1]; }));
    var r2Hit = 0;
    for (var ni = 0; ni < needImgRows.length; ni++) {
      const r2Url = r2Map[normalizeManagedIdForR2_(needImgRows[ni][1])];
      if (!r2Url) continue;
      out[needImgRows[ni][0]][0] = '="' + r2Url + '"';
      r2Hit++;
    }
    if (r2Hit > 0) console.log('syncFull_: R2画像で補完 ' + r2Hit + '/' + needImgRows.length + '件');
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

  // Z列: デタウリ掲載日を書き込み（既存は保持、新規は今日の日付）
  if (writeCount > 0) {
    try {
      var today = new Date();
      var listedDatesOut = new Array(writeCount);
      for (let ld = 0; ld < writeCount; ld++) {
        var ldKey = normalizeKey_(out[ld][out[ld].length - 1]); // 最後の要素 = 管理番号
        listedDatesOut[ld] = [listedDateByKey[ldKey] || today];
      }
      destSheet.getRange(CONFIG.DEST_START_ROW, CONFIG.DEST_COL_LISTED_DATE, writeCount, 1).setValues(listedDatesOut);
      // ヘッダー設定（行2に列名）
      destSheet.getRange(2, CONFIG.DEST_COL_LISTED_DATE).setValue('掲載日');
    } catch (e) { console.error('掲載日書き込みエラー:', e.message || e); }
    // 余剰行のZ列をクリア
    var listedClearStart = CONFIG.DEST_START_ROW + writeCount;
    var listedClearRows = targetLast - listedClearStart + 1;
    if (listedClearRows > 0) {
      try {
        var listedBlanks = new Array(listedClearRows);
        for (let lb = 0; lb < listedClearRows; lb++) listedBlanks[lb] = [''];
        destSheet.getRange(listedClearStart, CONFIG.DEST_COL_LISTED_DATE, listedClearRows, 1).setValues(listedBlanks);
      } catch (e) {}
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

    // 重複管理番号: 「売却済み」は最優先で保持（上書きさせない）
    var newBizStatus = idx['ステータス'] !== undefined ? (r[idx['ステータス']] || '') : '';
    if (map[key] && map[key].bizStatus === '売却済み') continue;

    map[key] = {
      status: idx['状態'] !== undefined ? (r[idx['状態']] || '') : '',
      bizStatus: newBizStatus,
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
      if (!setObj[k]) setObj[k] = true;
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
      const cell = String(data[i][3] ?? '').trim();
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

/**
 * AIフォルダ全ファイルを一括取得して fileName -> fileId のマップを返す
 * 大量レコード処理時の resolveAiFileId_ 高速化用
 * 失敗時は空オブジェクトを返す（resolveAiFileId_ が個別取得にフォールバック）
 */
function buildAiFolderFileMap_(folderName) {
  const fname = folderName || CONFIG.AI_DEFAULT_FOLDER_NAME;
  const cacheKey = 'AI_FOLDER_FILE_MAP:' + fname;
  const cache = CacheService.getScriptCache();

  // キャッシュ命中時は即返却（DriveApp 全件走査を回避）
  try {
    const cached = app_cacheGetLarge_(cache, cacheKey);
    if (cached) {
      const obj = JSON.parse(cached);
      if (obj && typeof obj === 'object') return obj;
    }
  } catch (e) { /* fallthrough to rebuild */ }

  const map = {};
  try {
    const it = DriveApp.getFoldersByName(fname);
    if (!it.hasNext()) return map;
    const folder = it.next();
    const files = folder.getFiles();
    let count = 0;
    while (files.hasNext()) {
      const f = files.next();
      map[f.getName()] = f.getId();
      count++;
    }
    console.log('buildAiFolderFileMap_: ' + fname + ' に ' + count + ' 件');
    try { app_cachePutLarge_(cache, cacheKey, JSON.stringify(map), 21600); } catch (e) {}
  } catch (e) {
    console.warn('buildAiFolderFileMap_ error:', e.message || e);
  }
  return map;
}

function resolveAiFileId_(raw, folderFileMap) {
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

  // 高速パス: 呼び出し元から渡された folderFileMap (デフォルトAIフォルダ全ファイル) を優先利用
  if (folderFileMap && folderName === CONFIG.AI_DEFAULT_FOLDER_NAME && folderFileMap[fileName]) {
    return folderFileMap[fileName];
  }

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

/**
 * 管理番号をR2側(Workers normalizeManagedId)と同じ規則で正規化する。
 * 全角英数→半角、長音符→ハイフン、全角スペース→半角、大文字化、trim。
 * 商品管理とAIキーワード抽出で大文字小文字がゆれている分(約525件)もこれで吸収される。
 */
function normalizeManagedIdForR2_(raw) {
  return String(raw ?? "")
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    })
    .replace(/\u30FC/g, '-')
    .replace(/\u3000/g, ' ')
    .toUpperCase()
    .trim();
}

/**
 * R2(タスキ箱)の代表画像URLを管理番号ごとに一括取得する。
 * Workers の POST /admin/product-image-urls を SYNC_SECRET 認証で叩く。
 * 返り値のキーは normalizeManagedIdForR2_ 済み。取得失敗時は {} を返し、
 * 呼び出し側は従来のDrive経路のフォールバック値をそのまま使う。
 */
function fetchR2ImageUrls_(keys) {
  const seen = {};
  const uniq = [];
  for (var i = 0; i < keys.length; i++) {
    const k = normalizeManagedIdForR2_(keys[i]);
    if (!k || seen[k]) continue;
    seen[k] = true;
    uniq.push(k);
  }
  if (uniq.length === 0) return {};

  const props = PropertiesService.getScriptProperties();
  const workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
  const secret = props.getProperty('SYNC_SECRET') || '';
  if (!secret) {
    console.warn('fetchR2ImageUrls_: SYNC_SECRET 未設定のためスキップ');
    return {};
  }

  const result = {};
  const CHUNK = 500; // GAS側のPOSTボディを肥大させないための分割（Workers内でさらに90件ずつSQL分割される）
  for (var s = 0; s < uniq.length; s += CHUNK) {
    const chunk = uniq.slice(s, s + CHUNK);
    try {
      const res = UrlFetchApp.fetch(workersUrl + '/admin/product-image-urls', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ key: secret, managedIds: chunk }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) {
        console.warn('fetchR2ImageUrls_: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
        continue;
      }
      const json = JSON.parse(res.getContentText() || '{}');
      const urls = json && json.urls;
      if (!urls) continue;
      for (var key in urls) {
        if (Object.prototype.hasOwnProperty.call(urls, key)) result[key] = urls[key];
      }
    } catch (e) {
      console.warn('fetchR2ImageUrls_ error:', e.message || e);
    }
  }
  return result;
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
    const aiFolderFileMap = buildAiFolderFileMap_(CONFIG.AI_DEFAULT_FOLDER_NAME);

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
      const id = resolveAiFileId_(p, aiFolderFileMap);
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

// 旧価格テーブル（2026-05-31 まで有効）。仕入値≤上限の最初の段の販売価格を返す。
const PRICE_TIER_TABLE_ = [
  [50, 200], [100, 320], [149, 430], [199, 485], [249, 595],
  [299, 650], [349, 705], [399, 760], [449, 815], [499, 925],
  [549, 980], [599, 1035], [649, 1090], [699, 1145], [749, 1255],
  [799, 1310], [849, 1365], [899, 1420], [949, 1475], [999, 1585],
  [1049, 1640], [1099, 1695], [1149, 1750], [1199, 1805], [1249, 1915],
  [1299, 1970], [1349, 2025], [1399, 2080], [1449, 2135], [1499, 2245],
  [1549, 2300], [1599, 2355], [1649, 2410], [1699, 2465]
];

// 2026-06-01「採寸撮影付き」リブランドに伴う新価格テーブル（旧価格 ×1.2・¥50切上げ・上限¥3,000）。
// 6/1 00:00 JST 以降は getActivePriceTierTable_() がこちらを返す。
const PRICE_TIER_TABLE_V2_ = [
  [50, 250], [100, 400], [149, 550], [199, 700], [249, 750],
  [299, 800], [349, 850], [399, 950], [449, 1000], [499, 1150],
  [549, 1200], [599, 1250], [649, 1350], [699, 1400], [749, 1550],
  [799, 1600], [849, 1650], [899, 1750], [949, 1800], [999, 1950],
  [1049, 2000], [1099, 2050], [1149, 2100], [1199, 2200], [1249, 2300],
  [1299, 2400], [1349, 2450], [1399, 2500], [1449, 2600], [1499, 2700],
  [1549, 2800], [1599, 2850], [1649, 2900], [1699, 3000]
];

// 価格テーブル切替日時（2026-06-01 00:00 JST）。以降は撮影データ付きの新価格。
const PRICE_TIER_V2_EFFECTIVE_MS_ = new Date('2026-06-01T00:00:00+09:00').getTime();

// 現在日時に応じて有効な価格テーブルを返す（6/1 00:00 JST で新価格へ自動切替）。
function getActivePriceTierTable_() {
  return (Date.now() >= PRICE_TIER_V2_EFFECTIVE_MS_) ? PRICE_TIER_TABLE_V2_ : PRICE_TIER_TABLE_;
}

function calcPriceTier_(n) {
  if (n < 0) return 0;
  const table = getActivePriceTierTable_();
  for (let i = 0; i < table.length; i++) {
    if (n <= table[i][0]) return table[i][1];
  }
  return table[table.length - 1][1];
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
    .addItem("3. 商品自動選定（J列が空の場合）", "menuManualAssortSelect")
    .addSeparator()
    .addItem("📮 クリックポスト ラベル発行", "showClickPostDialog")
    .addSeparator()
    .addItem("★ 管理パネルを開く", "showAdminPanel")
    .addItem("📋 返品棚卸しを番号順(1,2,3…)に並べ替え", "sortReturnTanaoroshi")
    .addToUi();

  // アソート商品管理メニューは、アソート商品スプレッドシートの
  // コンテナバインドスクリプト（saisun-list-bulk/）で表示
}

/** 運用マニュアルを新しいタブで開く */
function openManualDoc() {
  // MANUAL_DOC_URL が設定されていればそちらを優先（Google Doc等）
  var customUrl = PropertiesService.getScriptProperties().getProperty('MANUAL_DOC_URL') || '';
  if (customUrl) {
    var h = HtmlService.createHtmlOutput(
      '<script>window.open("' + customUrl + '", "_blank"); google.script.host.close();</script>'
    ).setWidth(1).setHeight(1);
    SpreadsheetApp.getUi().showModelessDialog(h, 'マニュアルを開いています...');
    return;
  }
  // GitHub上のマニュアルを選択して開く
  var base = 'https://github.com/katsu0925/-/blob/main/docs/';
  var html = HtmlService.createHtmlOutput(
    '<style>' +
      'body{font-family:sans-serif;padding:12px;margin:0}' +
      'a{display:block;padding:10px 14px;margin:6px 0;border-radius:6px;' +
        'text-decoration:none;color:#1a73e8;border:1px solid #dadce0;font-size:14px}' +
      'a:hover{background:#f0f4ff}' +
      '.desc{color:#5f6368;font-size:12px;margin-top:2px}' +
    '</style>' +
    '<a href="' + base + '%E9%81%8B%E7%94%A8%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.md" target="_blank">' +
      '運用マニュアル<div class="desc">全機能リファレンス（管理者向け）</div></a>' +
    '<a href="' + base + '%E3%82%B9%E3%82%BF%E3%83%83%E3%83%95%E7%94%A8%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.md" target="_blank">' +
      'スタッフ用マニュアル<div class="desc">受注〜発送の手順書</div></a>' +
    '<a href="' + base + '%E3%83%A1%E3%83%B3%E3%83%86%E3%83%8A%E3%83%B3%E3%82%B9%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.md" target="_blank">' +
      'メンテナンスマニュアル<div class="desc">システム保守リファレンス</div></a>'
  ).setWidth(320).setHeight(220);
  SpreadsheetApp.getUi().showModelessDialog(html, '運用マニュアル');
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

function diag2() {
  var sheets = openSheets_();
  var pm = buildProductMap_(sheets.productSheet);
  var rs = buildReturnSet_(sheets.returnSheet);
  var pmKeys = Object.keys(pm);
  var rsKeys = Object.keys(rs);
  var byStatus = {};
  var intersectAny = 0;
  for (var i = 0; i < pmKeys.length; i++) {
    var k = pmKeys[i];
    if (!rs[k]) continue;
    intersectAny++;
    var bs = String(pm[k].bizStatus || '');
    byStatus[bs] = (byStatus[bs] || 0) + 1;
  }
  var destLast = sheets.destSheet.getLastRow();
  var destRows = Math.max(0, destLast - CONFIG.DEST_START_ROW + 1);
  console.log('pm=' + pmKeys.length + ' rs=' + rsKeys.length + ' inter=' + intersectAny + ' data1Rows=' + destRows);
  console.log(JSON.stringify(byStatus));
  return { pm: pmKeys.length, rs: rsKeys.length, inter: intersectAny, data1Rows: destRows, byStatus: byStatus };
}

function diag3() {
  var sheets = openSheets_();
  var ss = sheets.destSS;
  var sh = sheets.destSheet;
  console.log('SSID: ' + ss.getId());
  console.log('URL : ' + ss.getUrl());
  console.log('Sheet name: ' + sh.getName());
  console.log('lastRow: ' + sh.getLastRow() + ' lastCol: ' + sh.getLastColumn());
  console.log('B1 (sheetTotalCount): ' + sh.getRange('B1').getValue());
  // Sample rows 3-7 (first 5 data rows)
  var n = Math.min(5, Math.max(0, sh.getLastRow() - 2));
  if (n > 0) {
    var sample = sh.getRange(3, 1, n, Math.min(11, sh.getLastColumn())).getValues();
    for (var i = 0; i < sample.length; i++) {
      console.log('row' + (i+3) + ': ' + JSON.stringify(sample[i]));
    }
  }
  // Last 5 data rows
  var last = sh.getLastRow();
  if (last >= 7) {
    var startLast = Math.max(3, last - 4);
    var lastSample = sh.getRange(startLast, 1, last - startLast + 1, Math.min(11, sh.getLastColumn())).getValues();
    for (var j = 0; j < lastSample.length; j++) {
      console.log('row' + (startLast + j) + ': ' + JSON.stringify(lastSample[j]));
    }
  }
}

