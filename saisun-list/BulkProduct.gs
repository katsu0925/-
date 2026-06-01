// BulkProduct.gs
// =====================================================
// BulkProduct.gs — アソート商品データ読み込み（画像5枚対応）
// =====================================================

/**
 * アソート商品一覧を取得（キャッシュ付き）
 * @returns {object[]} 商品リスト
 */
// =====================================================
// 2026-06-01「採寸撮影付き」リブランド: プレミアムアソート価格 +20% ＋ 撮影データ同梱を一回限り反映
// 6/1 00:00 JST 以降、アソート商品シートの該当3行（小/中/大ロット）の D列（価格）を新価格に更新し、
// C列（説明）に撮影データ同梱の案内を追記する。ScriptProperty フラグで冪等化。
// このフラグは SubmitFix.gs の getPremiumTarget_() も参照し、選定目標額と顧客表示価格を同時に切替する。
// =====================================================
function maybeApplyPremiumRepricing_() {
  if (typeof PRICE_TIER_V2_EFFECTIVE_MS_ === 'undefined') return;
  if (Date.now() < PRICE_TIER_V2_EFFECTIVE_MS_) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PREMIUM_REPRICED_PROP_) === '1') return;
  var n = applyPremiumRepricing_();
  // 1行以上更新できた時だけフラグON（名称不一致による無言失敗を防ぐ＝次回読込で再試行）
  if (n > 0) {
    props.setProperty(PREMIUM_REPRICED_PROP_, '1');
    console.log('プレミアムアソート 6/1価格反映完了: ' + n + '行更新');
  } else {
    console.warn('プレミアムアソート 6/1価格反映: 対象行が見つからずスキップ（シートの商品名を要確認）');
  }
}

// アソート商品シートのプレミアム3行を新価格（小¥6,800 / 中¥16,200 / 大¥32,000）に更新し、
// 説明列に撮影データ同梱の案内を追記する。更新できた行数を返す。
// 手動でも単独実行可能（フラグ判定なしで即反映）。
function applyPremiumRepricing_() {
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return 0;
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var newPrice = {
    'プレミアムアソート小ロット': 6800,
    'プレミアムアソート中ロット': 16200,
    'プレミアムアソート大ロット': 32000
  };
  var note = '【採寸撮影データ付き】出品キットから全商品の撮影画像をダウンロードでき、フリマ出品にそのまま使えます。';
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][c.name] || '').trim();
    // 完全一致または前方/部分一致（小/中/大は互いに部分文字列にならないため安全）
    var matchKey = null;
    for (var k in newPrice) { if (name === k || name.indexOf(k) >= 0) { matchKey = k; break; } }
    if (!matchKey) continue;
    sh.getRange(i + 2, c.price + 1).setValue(newPrice[matchKey]); // 価格列（0始まりindex+1）
    var desc = String(data[i][c.description] || '');
    if (desc.indexOf('採寸撮影データ付き') < 0) {
      sh.getRange(i + 2, c.description + 1).setValue(desc ? (desc + ' ' + note) : note); // 説明列
    }
    count++;
  }
  if (count > 0) SpreadsheetApp.flush();
  return count;
}

// 6/1 アソート説明文の後追い修正用ワンショット（フラグをリセットして再適用）。
// 価格反映時に PREMIUM_REPRICED_0601 が既に立っているため、説明文だけ後から直す用途。
function fix0601AssortDesc() {
  try { PropertiesService.getScriptProperties().deleteProperty(PREMIUM_REPRICED_PROP_); } catch (e) {}
  applyPremiumRepricing_();
  bulk_clearCache_();
  return 'done';
}

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
  try { maybeApplyPremiumRepricing_(); } catch (e) {}
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

/**
 * BULKスプレッドシートの onEdit ハンドラ
 * アソート商品シートが編集されたら GAS キャッシュを即クリアし、
 * Workers 側にも apiBulkRefresh を投げて D1 + KV を即時更新する。
 *
 * トリガー登録: Triggers.gs の tr_setupTriggersOnce_() 内で
 *   ScriptApp.newTrigger('bulk_onEdit').forSpreadsheet(bulkSs).onEdit().create()
 */
function bulk_onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (!sh || sh.getName() !== BULK_CONFIG.sheetName) return;
    // ヘッダー行は無視
    if (e.range.getRow() < 2) return;

    // GASキャッシュを即クリア
    bulk_clearCache_();

    // Workers にも即時反映を依頼（fire-and-forget）
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
    var adminKey = props.getProperty('ADMIN_KEY') || '';
    if (!adminKey) {
      console.warn('bulk_onEdit: ADMIN_KEY未設定のためWorkers更新スキップ');
      return;
    }

    try {
      var resp = UrlFetchApp.fetch(workersUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          action: 'apiBulkRefresh',
          args: [{ adminKey: adminKey }]
        }),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code !== 200) {
        console.warn('bulk_onEdit: Workers refresh HTTP ' + code + ' body=' + resp.getContentText().slice(0, 200));
      }
    } catch (err) {
      console.error('bulk_onEdit: Workers refresh error: ' + (err && err.message || err));
    }
  } catch (err) {
    console.error('bulk_onEdit error: ' + (err && err.message || err));
  }
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
        detauriUrl: detauriUrl,
        alwaysChargeShippingIds: (typeof SHIPPING_CONSTANTS !== 'undefined' && SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS) ? SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS : []
      },
      stats: siteStats
    };
  } catch (e) {
    console.error('apiBulkInit error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : ''));
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
