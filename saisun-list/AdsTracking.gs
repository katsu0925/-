// AdsTracking.gs
// =====================================================
// 広告トラッキング設定API (Phase 4-4, 4-5)
// Google Ads / Meta Ads の設定を提供
// =====================================================

/**
 * Google Ads 設定取得API
 * Script Properties から GOOGLE_ADS_CONVERSION_ID, GOOGLE_ADS_CONVERSION_LABEL を返す
 * @return {object}
 */
function apiGetAdsConfig() {
  try {
    var props = PropertiesService.getScriptProperties();
    return {
      ok: true,
      data: {
        conversionId: String(props.getProperty('GOOGLE_ADS_CONVERSION_ID') || ''),
        conversionLabel: String(props.getProperty('GOOGLE_ADS_CONVERSION_LABEL') || '')
      }
    };
  } catch (e) {
    console.error('apiGetAdsConfig error:', e);
    return { ok: true, data: { conversionId: '', conversionLabel: '' } };
  }
}

/**
 * Meta Ads (Facebook/Instagram) 設定取得API
 * Script Properties から META_PIXEL_ID を返す
 * @return {object}
 */
function apiGetMetaConfig() {
  try {
    var props = PropertiesService.getScriptProperties();
    return {
      ok: true,
      data: {
        pixelId: String(props.getProperty('META_PIXEL_ID') || '')
      }
    };
  } catch (e) {
    console.error('apiGetMetaConfig error:', e);
    return { ok: true, data: { pixelId: '' } };
  }
}

/**
 * サイトマップデータ取得API（SEO用）
 * 商品一覧のURLデータを提供
 * @return {object}
 */
function apiGetSitemap() {
  try {
    var products = pr_readProducts_();
    var urls = [];
    var baseUrl = SITE_CONSTANTS.SITE_URL;

    // トップページ
    urls.push({ url: baseUrl, priority: 1.0, changefreq: 'daily' });
    // アソートページ
    urls.push({ url: baseUrl + '?page=bulk', priority: 0.8, changefreq: 'daily' });

    // 商品ページ（各商品の管理番号ベース）
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      if (p && p.managedId) {
        urls.push({
          url: baseUrl + '?item=' + encodeURIComponent(p.managedId),
          priority: 0.6,
          changefreq: 'weekly',
          managedId: p.managedId,
          brand: p.brand || '',
          name: p.name || ''
        });
      }
    }

    return { ok: true, data: { urls: urls, total: urls.length } };
  } catch (e) {
    console.error('apiGetSitemap error:', e);
    return { ok: false, message: 'サイトマップデータの取得に失敗しました' };
  }
}
