
function sh_getProductSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 全商品の詳細データを一括取得（高速化用）
 */
function pr_getAllProductDetails_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'ALL_PRODUCT_DETAILS_V1';
  
  // キャッシュから取得
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }
  
  // シートから取得
  const ss = sh_getProductSs_();
  const sheet = ss.getSheetByName('データ1');
  if (!sheet) return {};
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 4) return {};
  
  const data = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const headers = data[0] || [];
  
  function findCol(names) {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      for (let j = 0; j < names.length; j++) {
        if (h === names[j] || h.indexOf(names[j]) !== -1) return i;
      }
    }
    return -1;
  }
  
  const colManagedId = findCol(['管理番号']);
  const colTake = findCol(['着丈']);
  const colShoulder = findCol(['肩幅']);
  const colChest = findCol(['身幅']);
  const colSleeve = findCol(['袖丈']);
  const colYuki = findCol(['桁丈', '裄丈']);
  const colTotal = findCol(['総丈']);
  const colWaist = findCol(['ウエスト']);
  const colRise = findCol(['股上']);
  const colInseam = findCol(['股下']);
  const colThigh = findCol(['ワタリ']);
  const colHem = findCol(['裾幅']);
  const colHip = findCol(['ヒップ']);
  const colDefect = findCol(['傷汚れ詳細', '傷汚れ']);
  
  if (colManagedId < 0) return {};
  
  const result = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const id = String(row[colManagedId] || '').trim();
    if (!id) continue;
    
    const measurements = {};
    
    function addMeasure(label, colIndex) {
      if (colIndex < 0) return;
      const val = row[colIndex];
      if (val !== '' && val !== null && val !== undefined) {
        const num = Number(val);
        if (!isNaN(num) && num > 0) {
          measurements[label] = num;
        }
      }
    }
    
    addMeasure('着丈', colTake);
    addMeasure('肩幅', colShoulder);
    addMeasure('身幅', colChest);
    addMeasure('袖丈', colSleeve);
    addMeasure('桁丈', colYuki);
    addMeasure('総丈', colTotal);
    addMeasure('ウエスト', colWaist);
    addMeasure('股上', colRise);
    addMeasure('股下', colInseam);
    addMeasure('ワタリ', colThigh);
    addMeasure('裾幅', colHem);
    addMeasure('ヒップ', colHip);
    
    const defectDetail = (colDefect >= 0) ? String(row[colDefect] || '').trim() : '';
    
    result[id] = {
      measurements: measurements,
      defectDetail: defectDetail
    };
  }
  
  // キャッシュに保存（5分間）
  try {
    const jsonStr = JSON.stringify(result);
    if (jsonStr.length < 100000) { // 100KB以下ならキャッシュ
      cache.put(cacheKey, jsonStr, 300);
    }
  } catch (e) {}
  
  return result;
}

function sh_getDataSs_() {
  return SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
}

function sh_getOrderSs_() {
  return SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
}

function sh_ensureRequestSheet_(ss) {
  const name = String(APP_CONFIG.order.requestSheetName || '依頼管理');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = [
    '受付番号','依頼日時','会社名/氏名','連絡先','連絡手段','希望引渡し','郵便番号','住所','電話番号','備考 or 商品名',
    '確認リンク','選択リスト','合計点数','合計金額','発送ステータス','リスト同梱','xlsx送付','ステータス','担当者','支払いURL','採寸データ'
  ];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_ensureHoldSheet_(ss) {
  const name = String(APP_CONFIG.order.holdSheetName || '確保');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = ['管理番号','確保ID','userKey','確保期限','作成日時'];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_ensureOpenLogSheet_(ss) {
  const name = String(APP_CONFIG.order.openLogSheetName || '依頼中');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = ['管理番号', '受付番号', 'ステータス', '更新日時'];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_applyRequestStatusDropdown_(ss) {
  const sh = sh_ensureRequestSheet_(ss);
  const maxRows = sh.getMaxRows();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(APP_CONFIG.statuses.allowed, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, 18, Math.max(1, maxRows - 1), 1).setDataValidation(rule);
  return true;
}

function sh_ensureAllOnce_(ss) {
  const props = PropertiesService.getScriptProperties();
  const k = 'SHEETS_READY_V2:' + ss.getId();
  if (props.getProperty(k) === '1') return;
  sh_ensureRequestSheet_(ss);
  sh_ensureHoldSheet_(ss);
  sh_ensureOpenLogSheet_(ss);
  sh_applyRequestStatusDropdown_(ss);
  props.setProperty(k, '1');
}

// =====================================================
// ★★★ Products.gs に追加する関数 ★★★
// 以下の内容を Products.gs の末尾にコピー＆ペーストしてください
// （商品詳細モーダル機能を使う場合のみ必要）
// =====================================================

/**
 * 仕入れ管理Ver.2のスプレッドシートを取得
 */
function sh_getDetailSs_() {
  if (!APP_CONFIG.detail || !APP_CONFIG.detail.spreadsheetId) {
    throw new Error('APP_CONFIG.detail.spreadsheetId が設定されていません');
  }
  return SpreadsheetApp.openById(APP_CONFIG.detail.spreadsheetId);
}


/**
 * 商品詳細を取得（高速キャッシュ版）
 * 目標: 1秒未満
 */
function pr_getProductDetail_(managedId) {
  if (!managedId) return null;
  
  const id = String(managedId).trim();
  
  // ★キャッシュから取得を試みる（超高速）
  const cache = CacheService.getScriptCache();
  const cacheKey = 'PRODUCT_DETAIL_' + id;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }
  
  // キャッシュにない場合はシートから取得
  const detail = pr_getProductDetailFromSheet_(id);
  
  // キャッシュに保存（5分間）
  if (detail) {
    try {
      cache.put(cacheKey, JSON.stringify(detail), 300);
    } catch (e) {}
  }
  
  return detail;
}


/**
 * シートから商品詳細を取得（内部関数）
 */
function pr_getProductDetailFromSheet_(id) {
  const ss = sh_getProductSs_();
  const sheet = ss.getSheetByName('データ1');
  if (!sheet) return null;
  
  // ★最適化: 必要な範囲だけ取得
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 4) return null;
  
  const data = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const headers = data[0] || [];
  
  // 列インデックスを検索
  function findCol(names) {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      for (let j = 0; j < names.length; j++) {
        if (h === names[j] || h.indexOf(names[j]) !== -1) return i;
      }
    }
    return -1;
  }
  
  const colManagedId = findCol(['管理番号']);
  const colBrand = findCol(['ブランド']);
  const colState = findCol(['状態']);
  const colCategory = findCol(['カテゴリ']);
  const colSize = findCol(['サイズ']);
  const colGender = findCol(['性別']);
  const colColor = findCol(['カラー', '色']);
  const colPrice = findCol(['価格']);
  
  // 採寸データ列（全12項目）
  const colTake = findCol(['着丈']);
  const colShoulder = findCol(['肩幅']);
  const colChest = findCol(['身幅']);
  const colSleeve = findCol(['袖丈']);
  const colYuki = findCol(['桁丈', '裄丈']);
  const colTotal = findCol(['総丈']);
  const colWaist = findCol(['ウエスト']);
  const colRise = findCol(['股上']);
  const colInseam = findCol(['股下']);
  const colThigh = findCol(['ワタリ']);
  const colHem = findCol(['裾幅']);
  const colHip = findCol(['ヒップ']);
  const colDefect = findCol(['傷汚れ詳細', '傷汚れ']);
  
  if (colManagedId < 0) return null;
  
  // 対象行を検索（1行目はヘッダーなので i=1 から）
  let targetRow = null;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const rowId = String(row[colManagedId] || '').trim();
    if (rowId === id) {
      targetRow = row;
      break;
    }
  }
  
  if (!targetRow) return null;
  
  // 採寸データを構築
  const measurements = {};
  
  function addMeasure(label, colIndex) {
    if (colIndex < 0) return;
    const val = targetRow[colIndex];
    if (val !== '' && val !== null && val !== undefined) {
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        measurements[label] = num;
      }
    }
  }
  
  addMeasure('着丈', colTake);
  addMeasure('肩幅', colShoulder);
  addMeasure('身幅', colChest);
  addMeasure('袖丈', colSleeve);
  addMeasure('桁丈', colYuki);
  addMeasure('総丈', colTotal);
  addMeasure('ウエスト', colWaist);
  addMeasure('股上', colRise);
  addMeasure('股下', colInseam);
  addMeasure('ワタリ', colThigh);
  addMeasure('裾幅', colHem);
  addMeasure('ヒップ', colHip);
  
  const defectDetail = (colDefect >= 0) ? String(targetRow[colDefect] || '').trim() : '';
  
  return {
    managedId: id,
    brand: (colBrand >= 0) ? String(targetRow[colBrand] || '').trim() : '',
    state: (colState >= 0) ? String(targetRow[colState] || '').trim() : '',
    category: (colCategory >= 0) ? String(targetRow[colCategory] || '').trim() : '',
    size: (colSize >= 0) ? String(targetRow[colSize] || '').trim() : '',
    gender: (colGender >= 0) ? String(targetRow[colGender] || '').trim() : '',
    color: (colColor >= 0) ? String(targetRow[colColor] || '').trim() : '',
    price: (colPrice >= 0) ? Number(targetRow[colPrice] || 0) : 0,
    defectDetail: defectDetail,
    measurements: measurements
  };
}


/**
 * 商品詳細キャッシュをクリア（データ更新時に呼ぶ）
 */
function pr_clearProductDetailCache_(managedId) {
  const cache = CacheService.getScriptCache();
  if (managedId) {
    cache.remove('PRODUCT_DETAIL_' + String(managedId).trim());
  }
}


/**
 * 全商品詳細キャッシュを事前構築（オプション：起動時に呼ぶと初回も高速）
 */
function pr_prebuildProductDetailCache_() {
  const ss = sh_getProductSs_();
  const sheet = ss.getSheetByName('データ1');
  if (!sheet) return;
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 4) return;
  
  const data = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const headers = data[0] || [];
  
  function findCol(names) {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      for (let j = 0; j < names.length; j++) {
        if (h === names[j] || h.indexOf(names[j]) !== -1) return i;
      }
    }
    return -1;
  }
  
  const colManagedId = findCol(['管理番号']);
  if (colManagedId < 0) return;
  
  const cache = CacheService.getScriptCache();
  const toCache = {};
  
  // 最大100件をキャッシュ（API制限対策）
  let count = 0;
  for (let i = 1; i < data.length && count < 100; i++) {
    const row = data[i];
    if (!row) continue;
    const id = String(row[colManagedId] || '').trim();
    if (!id) continue;
    
    // 簡易的にキャッシュ（詳細は初回アクセス時に構築）
    toCache['PRODUCT_DETAIL_' + id] = JSON.stringify({ managedId: id, _prebuilt: true });
    count++;
  }
  
  if (Object.keys(toCache).length > 0) {
    cache.putAll(toCache, 300);
  }
}


// =====================================================
// ★★★ テスト用関数（GASエディタから実行して確認）★★★
// =====================================================

/**
 * 商品詳細取得のテスト
 * GASエディタで実行 → ログを確認
 */
function testGetProductDetail() {
  const testId = 'zB55';  // テストする管理番号
  const result = pr_getProductDetail_(testId);
  
  console.log('=== テスト結果 ===');
  console.log('管理番号: ' + testId);
  
  if (!result) {
    console.log('結果: 商品が見つかりません');
    return;
  }
  
  console.log('ブランド: ' + result.brand);
  console.log('状態: ' + result.state);
  console.log('カテゴリ: ' + result.category);
  console.log('傷汚れ詳細: ' + result.defectDetail);
  console.log('採寸データ:');
  
  for (const key in result.measurements) {
    console.log('  ' + key + ': ' + result.measurements[key] + ' cm');
  }
  
  return result;
}


/**
 * ヘッダー列の確認用（デバッグ）
 */
function debugCheckHeaders() {
  const ss = sh_getProductSs_();
  const sheet = ss.getSheetByName('データ1');
  if (!sheet) {
    console.log('データ1シートが見つかりません');
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[2] || []; // 3行目がヘッダー
  
  console.log('=== データ1シートのヘッダー（3行目）===');
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (h) {
      console.log('列' + (i + 1) + ' (' + columnToLetter_(i + 1) + '): ' + h);
    }
  }
}

function columnToLetter_(col) {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}
