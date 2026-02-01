function pr_productsVersionKey_() {
  return 'PRODUCTS_VERSION_V1:' + String(APP_CONFIG.data.spreadsheetId);
}

function pr_getProductsVersion_() {
  const props = PropertiesService.getScriptProperties();
  return u_toInt_(props.getProperty(pr_productsVersionKey_()), 0);
}

function pr_bumpProductsVersion_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(pr_productsVersionKey_(), String(u_nowMs_()));
}

function pr_clearProductsCache_() {
  const cache = CacheService.getScriptCache();
  const ck = 'PRODUCTS_CACHE_V1:' + String(APP_CONFIG.data.spreadsheetId) + ':' + String(APP_CONFIG.data.sheetName) + ':' + String(APP_CONFIG.data.headerRow);
  try { cache.remove(ck); } catch (e) {}
}

function pr_readProducts_() {
  const cache = CacheService.getScriptCache();
  const ck = 'PRODUCTS_CACHE_V1:' + String(APP_CONFIG.data.spreadsheetId) + ':' + String(APP_CONFIG.data.sheetName) + ':' + String(APP_CONFIG.data.headerRow);
  const ver = pr_getProductsVersion_();
  const cached = cache.get(ck);
  if (cached) {
    try {
      const json = u_ungzipFromB64_(cached);
      const obj = JSON.parse(json);
      if (obj && obj.ver === ver && Array.isArray(obj.items)) return obj.items;
    } catch (e) {}
  }

  const ss = sh_getDataSs_();
  const sh = ss.getSheetByName(APP_CONFIG.data.sheetName);
  if (!sh) throw new Error('データシートが見つかりません: ' + APP_CONFIG.data.sheetName);
  const headerRow = u_toInt_(APP_CONFIG.data.headerRow, 0);
  if (!headerRow) throw new Error('headerRowが不正です');

  const startRow = headerRow + 1;
  const lastRow = sh.getLastRow();
  if (lastRow < startRow) {
    const empty = [];
    try { cache.put(ck, u_gzipToB64_(JSON.stringify({ ver: ver, items: empty })), u_toInt_(APP_CONFIG.cache.productsSeconds, 21600)); } catch (e0) {}
    return empty;
  }

  const numRows = lastRow - startRow + 1;
  const values = sh.getRange(startRow, 1, numRows, u_toInt_(APP_CONFIG.data.readCols, 11)).getValues();

  const list = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const noLabel = String(row[0] || '').trim();
    const imageUrl = String(row[1] || '').trim();
    const state = String(row[2] || '').trim();
    const brand = String(row[3] || '').trim();
    const size = String(row[4] || '').trim();
    const gender = String(row[5] || '').trim();
    const category = String(row[6] || '').trim();
    const color = String(row[7] || '').trim();
    const price = u_toNumber_(row[8]);
    const qty = u_toNumber_(row[9]);
    const managedId = u_normalizeId_(row[10]);
    if (!managedId) continue;

    list.push({
      managedId: managedId,
      noLabel: noLabel,
      imageUrl: imageUrl,
      state: state,
      brand: brand,
      size: size,
      gender: gender,
      category: category,
      color: color,
      price: price,
      qty: qty
    });
  }

  try { cache.put(ck, u_gzipToB64_(JSON.stringify({ ver: ver, items: list })), u_toInt_(APP_CONFIG.cache.productsSeconds, 21600)); } catch (e1) {}
  return list;
}

function pr_buildFilterOptions_(products) {
  const setState = {};
  const setSize = {};
  const setGender = {};
  const setCategory = {};
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (p.state) setState[p.state] = true;
    if (p.size) setSize[p.size] = true;
    if (p.gender) setGender[p.gender] = true;
    if (p.category) setCategory[p.category] = true;
  }
  const keysSorted = (obj) => Object.keys(obj || {}).sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  return {
    status: ['在庫あり', '依頼中', '確保中'],
    category: keysSorted(setCategory),
    state: keysSorted(setState),
    gender: keysSorted(setGender),
    size: keysSorted(setSize),
    // 管理番号ソートは削除
    sort: [
      { key: 'default', label: 'No（番号順）' },
      { key: 'price', label: '価格' },
      { key: 'brand', label: 'ブランド' },
      { key: 'size', label: 'サイズ' }
    ]
  };
}

