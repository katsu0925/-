// StateStore.gs
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
  try { cache.remove(ck); } catch (e) { console.log('optional: cache remove: ' + (e.message || e)); }
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
    } catch (e) { console.log('optional: products cache parse: ' + (e.message || e)); }
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
    try { cache.put(ck, u_gzipToB64_(JSON.stringify({ ver: ver, items: empty })), u_toInt_(APP_CONFIG.cache.productsSeconds, 21600)); } catch (e0) { console.log('optional: products cache put: ' + (e0.message || e0)); }
    return empty;
  }

  const numRows = lastRow - startRow + 1;
  const values = sh.getRange(startRow, 1, numRows, u_toInt_(APP_CONFIG.data.readCols, 25)).getValues();

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
    // 採寸データ (L〜W列 = index 11〜22)
    const measureLength = row.length > 11 ? u_toNumber_(row[11]) : null;
    const measureShoulder = row.length > 12 ? u_toNumber_(row[12]) : null;
    const measureBust = row.length > 13 ? u_toNumber_(row[13]) : null;
    const measureSleeve = row.length > 14 ? u_toNumber_(row[14]) : null;
    const measureYuki = row.length > 15 ? u_toNumber_(row[15]) : null;
    const measureTotalLength = row.length > 16 ? u_toNumber_(row[16]) : null;
    const measureWaist = row.length > 17 ? u_toNumber_(row[17]) : null;
    const measureRise = row.length > 18 ? u_toNumber_(row[18]) : null;
    const measureInseam = row.length > 19 ? u_toNumber_(row[19]) : null;
    const measureThigh = row.length > 20 ? u_toNumber_(row[20]) : null;
    const measureHemWidth = row.length > 21 ? u_toNumber_(row[21]) : null;
    const measureHip = row.length > 22 ? u_toNumber_(row[22]) : null;
    // 傷汚れ詳細 (X列 = index 23)
    const defectDetail = row.length > 23 ? String(row[23] || '').trim() : '';
    // 発送方法 (Y列 = index 24)
    const shippingMethod = row.length > 24 ? String(row[24] || '').trim() : '';
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
      qty: qty,
      measureLength: measureLength || null,
      measureShoulder: measureShoulder || null,
      measureBust: measureBust || null,
      measureSleeve: measureSleeve || null,
      measureYuki: measureYuki || null,
      measureTotalLength: measureTotalLength || null,
      measureWaist: measureWaist || null,
      measureRise: measureRise || null,
      measureInseam: measureInseam || null,
      measureThigh: measureThigh || null,
      measureHemWidth: measureHemWidth || null,
      measureHip: measureHip || null,
      defectDetail: defectDetail,
      shippingMethod: shippingMethod
    });
  }

  try { cache.put(ck, u_gzipToB64_(JSON.stringify({ ver: ver, items: list })), u_toInt_(APP_CONFIG.cache.productsSeconds, 21600)); } catch (e1) { console.log('optional: products cache put: ' + (e1.message || e1)); }
  return list;
}

function pr_buildFilterOptions_(products) {
  const setState = {};
  const setSize = {};
  const setGender = {};
  const setCategory = {};
  const setBrand = {};
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (p.state) setState[p.state] = true;
    if (p.size) setSize[p.size] = true;
    if (p.gender) setGender[p.gender] = true;
    if (p.category) setCategory[p.category] = true;
    if (p.brand) setBrand[p.brand] = true;
  }
  const keysSorted = (obj) => Object.keys(obj || {}).sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  return {
    status: ['在庫あり', '依頼中', '確保中'],
    category: keysSorted(setCategory),
    state: keysSorted(setState),
    gender: keysSorted(setGender),
    size: keysSorted(setSize),
    brand: keysSorted(setBrand),
    // 管理番号ソートは削除
    sort: [
      { key: 'default', label: 'No（番号順）' },
      { key: 'price', label: '価格' },
      { key: 'brand', label: 'ブランド' },
      { key: 'size', label: 'サイズ' }
    ]
  };
}

/**
 * 商品キャッシュを強制クリア（GASエディタから実行）
 * コード変更後にD1同期データを更新したい場合に使用
 */
function refreshProductsCache() {
  pr_bumpProductsVersion_();
  pr_clearProductsCache_();
  console.log('商品キャッシュをクリアしました。次回のWorkers同期で最新データが反映されます。');
}

