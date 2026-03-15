/**
 * 商品API — D1 + KVキャッシュで高速読み取り
 *
 * Phase 1: apiGetCachedProducts, apiBulkInit
 */
import { jsonOk, jsonError, jsonRaw } from '../utils/response.js';

const PRODUCTS_CACHE_KEY = 'products:detauri';
const BULK_CACHE_KEY = 'products:bulk';
const SETTINGS_CACHE_KEY = 'settings:public';
const STATS_CACHE_KEY = 'stats:banner';
const CACHE_TTL = 300; // 5分

/**
 * apiGetCachedProducts — デタウリ商品一覧
 *
 * KVキャッシュ → D1フォールバック
 * レスポンス形式: { ok: true, data: { products, totalCount, options, settings, stats } }
 * KVには data 部分のみ保存（HTML埋め込みにも使用）
 */
export async function getCachedProducts(args, env) {
  const cache = env.CACHE;

  // KVキャッシュ確認（GAS互換形式: { products, totalCount, options, settings, stats }）
  const cachedJson = await cache.get(PRODUCTS_CACHE_KEY);
  if (cachedJson) {
    const ver = await cache.get('products:version') || '';
    return jsonRaw(`{"ok":true,"dataVersion":"${ver}","data":${cachedJson}}`, { 'X-Cache': 'HIT' });
  }

  // D1から商品データ読み取り
  const products = await readProductsFromD1(env.DB);

  // holds + open_items からステータスを算出して各商品に付与
  await applyProductStatuses(env.DB, products);

  // R2画像をマージ
  await mergeR2Images(env.CACHE, products);

  const options = buildFilterOptions(products);
  const settings = await getPublicSettings(env);
  const stats = await getStatsCache(env);

  const sheetTotalCountStr = await env.CACHE.get('sheetTotalCount');
  const sheetTotalCount = sheetTotalCountStr ? Number(sheetTotalCountStr) : 0;

  const data = {
    products,
    sheetTotalCount,
    options,
    settings,
    stats,
  };

  const dataJson = JSON.stringify(data);
  await cache.put(PRODUCTS_CACHE_KEY, dataJson, { expirationTtl: CACHE_TTL });

  // ハッシュも生成して返す
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(dataJson));
  const ver = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  await cache.put('products:version', ver);

  return jsonRaw(`{"ok":true,"dataVersion":"${ver}","data":${dataJson}}`, { 'X-Cache': 'MISS' });
}

/**
 * apiBulkInit — アソート商品一覧
 */
export async function bulkInit(args, env) {
  const cache = env.CACHE;

  // KVキャッシュ確認
  const cached = await cache.get(BULK_CACHE_KEY, 'json');
  if (cached) {
    const bulkVer = await cache.get('products:bulk:version') || '';
    cached.dataVersion = bulkVer;
    return jsonOk(cached, { 'X-Cache': 'HIT' });
  }

  // D1からアソート商品読み取り
  const products = await readBulkProductsFromD1(env.DB);

  // 設定データ取得
  const memberDiscount = await getMemberDiscountStatus(env);

  // 統計データ取得
  const stats = await getStatsCache(env);

  const result = {
    products,
    settings: {
      appTitle: 'デタウリ.Detauri',
      channel: 'アソート',
      shippingAreas: null, // 同期時に設定テーブルから読み込み
      shippingRates: null,
      memberDiscount,
      detauriUrl: '',      // 同期時に設定テーブルから読み込み
    },
    stats,
  };

  // 設定テーブルから送料データを上書き
  const shippingData = await getShippingConfig(env.DB);
  if (shippingData) {
    result.settings.shippingAreas = shippingData.areas;
    result.settings.shippingRates = shippingData.rates;
  }

  const siteUrl = await getSetting(env.DB, 'SITE_URL');
  if (siteUrl) result.settings.detauriUrl = siteUrl;

  const bulkJson = JSON.stringify(result);
  await cache.put(BULK_CACHE_KEY, bulkJson, {
    expirationTtl: CACHE_TTL,
  });

  // バルク用バージョンハッシュ
  const encoder = new TextEncoder();
  const bulkHashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(bulkJson));
  const bulkVer = [...new Uint8Array(bulkHashBuf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  await cache.put('products:bulk:version', bulkVer);
  result.dataVersion = bulkVer;

  return jsonOk(result, { 'X-Cache': 'MISS' });
}

/**
 * apiGetProductsVersion — バージョンハッシュのみ返す軽量API
 * クライアント側のlocalStorageキャッシュ検証用
 */
export async function getProductsVersion(args, env) {
  const detauri = await env.CACHE.get('products:version') || '';
  const bulk = await env.CACHE.get('products:bulk:version') || '';
  return jsonOk({ detauri, bulk });
}

// ─── D1読み取りヘルパー ───

async function readProductsFromD1(db) {
  const { results } = await db.prepare(`
    SELECT managed_id, no_label, image_url, state, brand, size,
           gender, category, color, price, qty, defect_detail, shipping_method,
           measure_length, measure_shoulder, measure_bust, measure_sleeve,
           measure_yuki, measure_total_length, measure_waist, measure_rise,
           measure_inseam, measure_thigh, measure_hem_width, measure_hip
    FROM products
    ORDER BY CAST(no_label AS INTEGER) ASC, no_label ASC
  `).all();

  return results.map(row => {
    const measurements = buildMeasurements(row);
    return {
      managedId: row.managed_id,
      noLabel: row.no_label,
      imageUrl: row.image_url,
      state: row.state,
      brand: row.brand,
      size: row.size,
      gender: row.gender,
      category: row.category,
      color: row.color,
      price: row.price,
      defectDetail: row.defect_detail,
      shippingMethod: row.shipping_method,
      measurements,
      images: [],
      // status, selectable は applyProductStatuses() で後から付与
      status: '在庫あり',
      selectable: true,
    };
  });
}

function buildMeasurements(row) {
  const map = {
    '着丈': row.measure_length, '肩幅': row.measure_shoulder, '身幅': row.measure_bust,
    '袖丈': row.measure_sleeve, '桁丈': row.measure_yuki, '総丈': row.measure_total_length,
    'ウエスト': row.measure_waist, '股上': row.measure_rise, '股下': row.measure_inseam,
    'ワタリ': row.measure_thigh, '裾幅': row.measure_hem_width, 'ヒップ': row.measure_hip,
  };
  const result = {};
  for (const [label, val] of Object.entries(map)) {
    if (val != null) result[label] = val;
  }
  return result;
}

/**
 * holds + open_items を参照して各商品の status / selectable を設定
 */
async function applyProductStatuses(db, products) {
  const now = Date.now();

  // 有効な確保を一括取得
  const { results: holds } = await db.prepare(
    'SELECT managed_id FROM holds WHERE until_ms > ?'
  ).bind(now).all();
  const heldSet = new Set(holds.map(h => h.managed_id));

  // 依頼中を一括取得
  const { results: openItems } = await db.prepare(
    'SELECT managed_id FROM open_items'
  ).all();
  const openSet = new Set(openItems.map(o => o.managed_id));

  for (const p of products) {
    if (openSet.has(p.managedId)) {
      p.status = '依頼中';
      p.selectable = false;
    } else if (heldSet.has(p.managedId)) {
      p.status = '確保中';
      p.selectable = false;
    }
    // デフォルト: '在庫あり', selectable: true（readProductsFromD1で設定済み）
  }
}

/**
 * KVのproduct-images:{managedId}からR2画像URLを各商品にマージ
 */
async function mergeR2Images(cache, products) {
  const imgIndexJson = await cache.get('product-images:index');
  if (!imgIndexJson) return;

  const imgIndex = JSON.parse(imgIndexJson);
  if (imgIndex.length === 0) return;

  const imgMap = {};
  const batchSize = 50;
  for (let i = 0; i < imgIndex.length; i += batchSize) {
    const batch = imgIndex.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (mid) => {
        const json = await cache.get(`product-images:${mid}`);
        return { mid, urls: json ? JSON.parse(json) : null };
      })
    );
    for (const { mid, urls } of results) {
      if (urls && urls.length > 0) imgMap[mid] = urls;
    }
  }

  for (const p of products) {
    if (imgMap[p.managedId]) {
      p.images = imgMap[p.managedId];
    }
  }
}

async function readBulkProductsFromD1(db) {
  const { results } = await db.prepare(`
    SELECT product_id, name, description, price, unit, tag,
           images, min_qty, max_qty, sort_order, stock, sold_out,
           discount_rate, discounted_price
    FROM bulk_products
    WHERE active = 1
    ORDER BY sort_order ASC
  `).all();

  return results.map(row => ({
    productId: row.product_id,
    name: row.name,
    description: row.description,
    price: row.price,
    unit: row.unit,
    tag: row.tag,
    images: JSON.parse(row.images || '[]'),
    minQty: row.min_qty,
    maxQty: row.max_qty,
    sortOrder: row.sort_order,
    stock: row.stock,
    soldOut: row.sold_out === 1,
    discountRate: row.discount_rate,
    discountedPrice: row.discounted_price,
  }));
}

function buildFilterOptions(products) {
  const sets = {
    category: new Set(),
    state: new Set(),
    gender: new Set(),
    size: new Set(),
    brand: new Set(),
  };

  for (const p of products) {
    if (p.category) sets.category.add(p.category);
    if (p.state) sets.state.add(p.state);
    if (p.gender) sets.gender.add(p.gender);
    if (p.size) sets.size.add(p.size);
    if (p.brand) sets.brand.add(p.brand);
  }

  const sortArr = (s) => [...s].sort((a, b) => a.localeCompare(b, 'ja'));

  return {
    status: ['在庫あり', '依頼中', '確保中'],
    category: sortArr(sets.category),
    state: sortArr(sets.state),
    gender: sortArr(sets.gender),
    size: sortArr(sets.size),
    brand: sortArr(sets.brand),
    sort: [
      { key: 'default', label: 'No（番号順）' },
      { key: 'price', label: '価格' },
      { key: 'brand', label: 'ブランド' },
      { key: 'size', label: 'サイズ' },
    ],
  };
}

// ─── 設定・統計ヘルパー ───

async function getPublicSettings(env) {
  const cache = env.CACHE;
  const cached = await cache.get(SETTINGS_CACHE_KEY, 'json');
  if (cached) return cached;

  const memberDiscount = await getMemberDiscountStatus(env);

  const settings = {
    appTitle: 'デタウリ.Detauri',
    minOrderCount: 5,
    memberDiscount,
    notes: [
      '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
      '5点から購入可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料は住所入力後に自動計算されます。',
      'カートに入れた商品は15分間確保されます（会員は30分間）。在庫は先着順のためお早めにお手続きください。',
      '決済方法：クレジットカード／コンビニ払い／銀行振込／PayPay／ペイジー／Apple Pay／Paidy',
    ],
  };

  // 会員割引ON/OFFでノート切り替え
  const discountNote = memberDiscount.enabled
    ? '<span style="color:#b8002a;">10点以上で5％割引〜最大20％OFF ／ 会員登録で10％OFF（' + memberDiscount.endDate + 'まで・併用可）</span>'
    : '<span style="color:#b8002a;">30点以上で10％割引</span>';
  settings.notes.push(discountNote);

  await cache.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), {
    expirationTtl: 300,
  });

  return settings;
}

async function getMemberDiscountStatus(env) {
  const row = await getSetting(env.DB, 'MEMBER_DISCOUNT_STATUS');
  if (row) {
    try { return JSON.parse(row); } catch (e) { /* fallthrough */ }
  }
  // デフォルト
  return { enabled: true, rate: 0.10, endDate: '2026-09-30', reason: 'active' };
}

async function getStatsCache(env) {
  const cache = env.CACHE;
  const cached = await cache.get(STATS_CACHE_KEY, 'json');
  if (cached) return cached;

  const row = await env.DB.prepare(
    'SELECT data FROM stats_cache WHERE key = ?'
  ).bind('banner').first();

  if (row) {
    const data = JSON.parse(row.data);
    await cache.put(STATS_CACHE_KEY, JSON.stringify(data), { expirationTtl: 3600 });
    return data;
  }
  return null;
}

async function getShippingConfig(db) {
  const row = await db.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('SHIPPING_CONFIG').first();
  if (row) {
    try { return JSON.parse(row.value); } catch (e) { /* ignore */ }
  }
  return null;
}

async function getSetting(db, key) {
  const row = await db.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(key).first();
  return row ? row.value : null;
}
