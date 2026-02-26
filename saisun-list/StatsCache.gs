// StatsCache.gs
// =====================================================
// 実績バナー用の統計データキャッシュ
// 依頼管理シートから実データを集計し、CacheServiceに保存
// =====================================================

var STATS_CACHE_KEY = 'SITE_STATS_BANNER';
var STATS_CACHE_TTL = 3600; // 1時間

/**
 * 統計データを計算してキャッシュに保存（1時間ごとのcronで実行）
 */
function st_calculateAndCacheStats_() {
  try {
    var orderSs = sh_getOrderSs_();
    var reqSheet = orderSs.getSheetByName('依頼管理');
    if (!reqSheet) { console.log('st_calculateAndCacheStats_: 依頼管理シートなし'); return; }

    var data = reqSheet.getDataRange().getValues();
    if (data.length < 2) return;

    var totalSold = 0;
    var customerOrders = {};

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || '').trim();
      if (status !== '完了') continue;

      var contact = String(data[i][REQUEST_SHEET_COLS.CONTACT - 1] || '').trim().toLowerCase();
      if (!contact) continue;

      totalSold += Number(data[i][REQUEST_SHEET_COLS.TOTAL_COUNT - 1]) || 0;
      customerOrders[contact] = (customerOrders[contact] || 0) + 1;
    }

    var emails = Object.keys(customerOrders);
    var totalCustomers = emails.length;
    var repeatCount = 0;
    for (var j = 0; j < emails.length; j++) {
      if (customerOrders[emails[j]] >= 2) repeatCount++;
    }
    var repeatRate = totalCustomers > 0 ? Math.round((repeatCount / totalCustomers) * 100) : 0;

    var stats = {
      totalSold: totalSold,
      totalCustomers: totalCustomers,
      repeatRate: repeatRate
    };

    CacheService.getScriptCache().put(STATS_CACHE_KEY, JSON.stringify(stats), STATS_CACHE_TTL);
    console.log('st_calculateAndCacheStats_: sold=' + totalSold + ' customers=' + totalCustomers + ' repeat=' + repeatRate + '%');
  } catch (e) {
    console.error('st_calculateAndCacheStats_ error:', e);
  }
}

/**
 * キャッシュから統計データを取得（apiGetCachedProducts / apiBulkInit で使用）
 */
function st_getStatsCache_() {
  try {
    var raw = CacheService.getScriptCache().get(STATS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // キャッシュがなければ即時計算（初回のみ）
  try {
    st_calculateAndCacheStats_();
    var raw2 = CacheService.getScriptCache().get(STATS_CACHE_KEY);
    if (raw2) return JSON.parse(raw2);
  } catch (e) {}
  return null;
}
