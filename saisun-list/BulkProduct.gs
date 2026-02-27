// BulkProduct.gs
// =====================================================
// BulkProduct.gs — アソート商品データ読み込み（画像5枚対応）
// =====================================================

/**
 * アソート商品一覧を取得（キャッシュ付き）
 * @returns {object[]} 商品リスト
 */
function bulk_getProducts_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(BULK_CONFIG.cache.key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  var products = bulk_readProductsFromSheet_();

  try {
    cache.put(BULK_CONFIG.cache.key, JSON.stringify(products), BULK_CONFIG.cache.ttl);
  } catch (e) {
    console.log('アソート商品キャッシュ保存エラー:', e);
  }

  return products;
}

/**
 * スプレッドシートからアソート商品データを読み込み
 * @returns {object[]} 公開中・表示順ソート済みの商品リスト
 */
function bulk_readProductsFromSheet_() {
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return [];

  var ss;
  try { ss = SpreadsheetApp.openById(ssId); } catch (e) { console.error('アソート商品SS open error:', e); return []; }
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var c = BULK_CONFIG.cols;
  var products = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    var productId = String(row[c.productId] || '').trim();
    if (!productId) continue;

    // 公開・在庫チェック → soldOut フラグ
    var active = row[c.active];
    var isActive = (active === true || String(active).toUpperCase() === 'TRUE');
    var stockRaw = row[c.stock];
    var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
    if (isNaN(stock)) stock = -1;
    var soldOut = (!isActive || stock === 0);

    // 画像URL（最大5枚、空でないものだけ収集）
    var images = [];
    for (var imgIdx = c.image1; imgIdx <= c.image5; imgIdx++) {
      var imgUrl = String(row[imgIdx] || '').trim();
      if (imgUrl && imgUrl.indexOf('drive.google.com') !== -1) {
        var m = imgUrl.match(/[?&]id=([^&]+)/);
        if (m) imgUrl = 'https://lh3.googleusercontent.com/d/' + m[1];
      }
      if (imgUrl) images.push(imgUrl);
    }

    var discount = Number(row[c.discount]) || 0;
    if (discount < 0 || discount > 1) discount = 0;
    var basePrice = Number(row[c.price]) || 0;

    products.push({
      productId: productId,
      name: String(row[c.name] || '').trim(),
      description: String(row[c.description] || '').trim(),
      price: basePrice,
      discountRate: discount,
      discountedPrice: discount > 0 ? Math.round(basePrice * (1 - discount)) : basePrice,
      unit: String(row[c.unit] || '').trim(),
      tag: String(row[c.tag] || '').trim(),
      images: images,
      minQty: Math.max(1, Number(row[c.minQty]) || 1),
      maxQty: Math.max(1, Number(row[c.maxQty]) || 99),
      sortOrder: Number(row[c.sortOrder]) || 999,
      stock: stock,
      soldOut: soldOut
    });
  }

  // 表示順でソート
  products.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

  return products;
}

/**
 * アソート商品キャッシュを無効化
 */
function bulk_clearCache_() {
  try { CacheService.getScriptCache().remove(BULK_CONFIG.cache.key); } catch (e) {}
}

// adminBulkUploadImage は削除済み — saisun-list-bulk/コード.gs:294 に一本化
// BulkAdminModal.html は saisun-list-bulk にのみ存在

/**
 * アソート商品の初期化API（フロントエンドから呼ばれる）
 * @returns {object} { ok, products, settings }
 */
function apiBulkInit() {
  try {
    console.log('apiBulkInit: start');
    var products = bulk_getProducts_();
    console.log('apiBulkInit: products=' + products.length);
    var memberDiscount = app_getMemberDiscountStatus_();

    var detauriUrl = '';
    try { detauriUrl = SITE_CONSTANTS.SITE_URL || ''; } catch (e2) { console.log('apiBulkInit: SITE_URL error: ' + e2); }
    if (!detauriUrl) {
      try { detauriUrl = ScriptApp.getService().getUrl(); } catch (e3) { console.log('apiBulkInit: ScriptApp URL error: ' + e3); }
    }

    // 実績統計をキャッシュから付加
    var siteStats = null;
    try { siteStats = st_getStatsCache_(); } catch (e4) {}

    return {
      ok: true,
      products: products,
      settings: {
        appTitle: APP_CONFIG.appTitle,
        channel: BULK_CONFIG.channel,
        shippingAreas: SHIPPING_AREAS,
        shippingRates: SHIPPING_RATES,
        memberDiscount: memberDiscount,
        detauriUrl: detauriUrl
      },
      stats: siteStats
    };
  } catch (e) {
    console.error('apiBulkInit error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : ''));
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
