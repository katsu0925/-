/**
 * 注文送信API（Phase 5 → KOMOJU移行版）
 *
 * submitEstimate — バリデーション・価格計算・holds更新・KOMOJU決済セッション作成をすべてWorkersで実行
 * GASへはctx.waitUntilでペンディング注文データを非同期保存（webhook互換性のため）
 *
 * ロールバック: submitEstimate末尾を `return await proxyToGasForSubmit(bodyText, env);` に戻すだけ
 */
import { jsonOk, jsonError, corsResponse } from '../utils/response.js';
import { sendEvent as sendMetaEvent } from '../utils/meta-capi.js';

// ─── 数量割引ヘルパー（D1 settingsから動的テーブル対応） ───

const DEFAULT_QTY_DISCOUNTS = [
  { threshold: 100, rate: 0.20 },
  { threshold: 50, rate: 0.15 },
  { threshold: 30, rate: 0.10 },
  { threshold: 10, rate: 0.05 },
];

function calcQtyDiscount(count, dynTable) {
  const table = (Array.isArray(dynTable) && dynTable.length > 0) ? dynTable : DEFAULT_QTY_DISCOUNTS;
  for (const tier of table) {
    if (count >= tier.threshold) return tier.rate;
  }
  return 0;
}

// ─── 送料テーブル（フォールバック用、D1 SHIPPING_CONFIG優先） ───

const SHIPPING_AREAS = {
  '北海道': 'hokkaido',
  '青森県': 'kita_tohoku', '岩手県': 'kita_tohoku', '秋田県': 'kita_tohoku',
  '宮城県': 'minami_tohoku', '福島県': 'minami_tohoku', '山形県': 'minami_tohoku',
  '東京都': 'kanto', '神奈川県': 'kanto', '埼玉県': 'kanto', '千葉県': 'kanto',
  '茨城県': 'kanto', '栃木県': 'kanto', '群馬県': 'kanto', '山梨県': 'kanto',
  '新潟県': 'shinetsu', '長野県': 'shinetsu',
  '愛知県': 'tokai', '静岡県': 'tokai', '岐阜県': 'tokai', '三重県': 'tokai',
  '石川県': 'hokuriku', '福井県': 'hokuriku', '富山県': 'hokuriku',
  '大阪府': 'kansai', '兵庫県': 'kansai', '京都府': 'kansai',
  '奈良県': 'kansai', '和歌山県': 'kansai', '滋賀県': 'kansai',
  '広島県': 'chugoku', '岡山県': 'chugoku', '島根県': 'chugoku',
  '山口県': 'chugoku', '鳥取県': 'chugoku',
  '香川県': 'shikoku', '愛媛県': 'shikoku', '高知県': 'shikoku', '徳島県': 'shikoku',
  '福岡県': 'kita_kyushu', '佐賀県': 'kita_kyushu', '大分県': 'kita_kyushu', '長崎県': 'kita_kyushu',
  '鹿児島県': 'minami_kyushu', '熊本県': 'minami_kyushu', '宮崎県': 'minami_kyushu',
  '沖縄県': 'okinawa',
};

const SHIPPING_RATES = {
  minami_kyushu: [1320, 1700], kita_kyushu: [1280, 1620],
  shikoku: [1180, 1440], chugoku: [1200, 1480],
  kansai: [1100, 1260], hokuriku: [1160, 1420],
  tokai: [1180, 1440], shinetsu: [1220, 1540],
  kanto: [1300, 1680], minami_tohoku: [1400, 1900],
  kita_tohoku: [1460, 1980], hokkaido: [1640, 2380],
  okinawa: [2500, 3500],
};

const REMOTE_ISLANDS = [
  '大島町', '利島村', '新島村', '神津島村', '三宅村', '御蔵島村', '八丈町', '青ヶ島村', '小笠原村',
  '奄美市', '大和村', '宇検村', '瀬戸内町', '龍郷町', '喜界町', '徳之島町', '天城町', '伊仙町',
  '和泊町', '知名町', '与論町', '三島村', '十島村',
  '宮古島市', '石垣市', '多良間村', '竹富町', '与那国町', '久米島町', '座間味村', '渡嘉敷村',
  '粟国村', '渡名喜村', '南大東村', '北大東村', '伊江村', '伊是名村', '伊平屋村',
  '佐渡市', '隠岐の島町', '海士町', '西ノ島町', '知夫村',
  '対馬市', '壱岐市', '五島市', '新上五島町', '小値賀町',
  '利尻町', '利尻富士町', '礼文町', '奥尻町',
];

const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県',
  '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

// KOMOJU決済設定
const KOMOJU_API_URL = 'https://komoju.com/api/v1';
const KOMOJU_CURRENCY = 'JPY';
const KOMOJU_PAYMENT_METHODS = [
  'credit_card', 'konbini', 'bank_transfer', 'paypay', 'pay_easy', 'apple_pay', 'paidy',
];
const PAYMENT_EXPIRY_SECONDS = 259200; // 3日間

// ─── メインハンドラ ───

/**
 * submitEstimate — 注文処理をWorkersで完結
 *
 * 1. フォームバリデーション
 * 2. D1からデータ取得（products, bulk_products, customers, settings, coupons）
 * 3. 価格計算（割引・クーポン・FHP・ポイント・送料）
 * 4. D1 holds更新（pending_payment=1, until_ms延長, receipt_no設定）
 * 5. KOMOJU APIセッション作成
 * 6. フロントエンドにsessionUrl返却
 * + ctx.waitUntil: GASにペンディング注文保存
 */
export async function submitEstimate(args, env, bodyText, ctx) {
  const userKey = String(args[0] || '').trim();
  const form = args[1] || {};
  const ids = args[2] || [];

  if (!userKey) return jsonError('userKeyが不正です');

  const hasBulkItems = form.bulkItems && form.bulkItems.length > 0;
  if ((!ids || ids.length === 0) && !hasBulkItems) {
    return jsonError('カートが空です');
  }

  // デタウリ最低注文数チェック
  const minDetauri = hasBulkItems ? 1 : 5;
  if (ids.length > 0 && ids.length < minDetauri) {
    return jsonError(`デタウリ商品は${minDetauri}点以上で購入可能です（現在${ids.length}点）`);
  }

  // フォームバリデーション
  const companyName = String(form.companyName || '').trim();
  const contact = String(form.contact || '').trim();
  const contactMethod = String(form.contactMethod || '').trim();
  const delivery = String(form.delivery || '').trim();
  const postal = String(form.postal || '').trim();
  const address = String(form.address || '').trim();
  const phone = String(form.phone || '').trim();
  let note = String(form.note || '').trim();
  const measureOpt = String(form.measureOpt || '').trim();
  const couponCode = String(form.couponCode || '').trim().toUpperCase();
  const usePoints = Math.max(0, Math.floor(Number(form.usePoints) || 0));
  const paymentMethod = String(form.paymentMethod || '').trim();

  if (!companyName) return jsonError('会社名/氏名は必須です');
  if (!contact) return jsonError('メールアドレスは必須です');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return jsonError('有効なメールアドレスを入力してください');
  if (!postal) return jsonError('郵便番号は必須です');
  if (!address) return jsonError('住所は必須です');
  if (!phone) return jsonError('電話番号は必須です');

  // 郵便番号: 数字のみ7桁
  const postalClean = postal.replace(/[-ー\s]/g, '');
  if (!/^\d{7}$/.test(postalClean)) return jsonError('郵便番号は7桁の数字で入力してください');

  // 電話番号: 数字のみ10-11桁、先頭0
  const phoneClean = phone.replace(/[-ー\s]/g, '');
  if (!/^0\d{9,10}$/.test(phoneClean)) return jsonError('電話番号の形式が正しくありません（10〜11桁）');

  // クロスチェック
  if (/^\d{7}$/.test(phoneClean)) return jsonError('電話番号に郵便番号が入力されていませんか？');
  if (/^0\d{9,10}$/.test(postalClean)) return jsonError('郵便番号に電話番号が入力されていませんか？');

  // 住所: 数字（番地）を含むか
  if (!/\d/.test(address)) return jsonError('住所に番地が含まれていません');

  // 離島チェック
  if (isRemoteIsland(address)) {
    return jsonError('離島への配送は現在対応しておりません。');
  }

  // 都道府県検出
  const pref = detectPrefecture(address);
  if (!pref) {
    return jsonError('住所から都道府県を判別できません。住所を確認してください。');
  }

  // reCAPTCHA検証 + D1クエリを並列実行
  let parsedBody;
  try { parsedBody = JSON.parse(bodyText); } catch (e) { parsedBody = {}; }
  const recaptchaToken = parsedBody.recaptchaToken || '';

  // 商品データ検証 + 合計計算
  let productResults = [];
  let sum = 0;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const now = Date.now();

    // reCAPTCHA検証 + products/holds/open_items の3クエリを並列実行
    const parallelTasks = [
      env.DB.prepare(
        `SELECT managed_id, price, no_label, brand, category, size, color, shipping_method FROM products WHERE managed_id IN (${placeholders})`
      ).bind(...ids).all(),
      env.DB.prepare(
        `SELECT managed_id FROM holds
         WHERE managed_id IN (${placeholders})
           AND user_key != ? AND until_ms > ?`
      ).bind(...ids, userKey, now).all(),
      env.DB.prepare(
        `SELECT managed_id FROM open_items WHERE managed_id IN (${placeholders})`
      ).bind(...ids).all(),
    ];

    // reCAPTCHA検証も並列に含める
    const recaptchaPromise = (recaptchaToken && env.RECAPTCHA_SECRET)
      ? verifyRecaptcha(recaptchaToken, env.RECAPTCHA_SECRET)
      : Promise.resolve(true);
    parallelTasks.push(recaptchaPromise);

    const [productsResult, holdsResult, openResult, recaptchaVerified] = await Promise.all(parallelTasks);

    // reCAPTCHA検証結果チェック
    if (recaptchaToken && env.RECAPTCHA_SECRET && !recaptchaVerified) {
      return jsonError('bot判定されました。ブラウザを再読み込みして再度お試しください。');
    }

    const results = productsResult.results;
    productResults = results;

    const foundIds = new Set(results.map(r => r.managed_id));
    const missing = ids.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      return jsonError('商品が見つかりません: ' + missing.join('、'));
    }

    for (const r of results) sum += r.price;

    // 確保チェック（他ユーザーに確保されていないか）
    const otherHolds = holdsResult.results;
    if (otherHolds.length > 0) {
      const heldIds = otherHolds.map(h => h.managed_id);
      return jsonError('確保できない商品が含まれています: ' + heldIds.join('、'));
    }

    // 依頼中チェック
    const openCheck = openResult.results;
    if (openCheck.length > 0) {
      const openIds = openCheck.map(o => o.managed_id);
      return jsonError('依頼中の商品が含まれています: ' + openIds.join('、'));
    }
  } else {
    // ids が空の場合でも reCAPTCHA 検証は実行
    if (recaptchaToken && env.RECAPTCHA_SECRET) {
      const verified = await verifyRecaptcha(recaptchaToken, env.RECAPTCHA_SECRET);
      if (!verified) {
        return jsonError('bot判定されました。ブラウザを再読み込みして再度お試しください。');
      }
    }
  }

  // ─── アソートカート金額をサーバー側で再計算 ───
  let bulkProductAmount = 0;
  let bulkShippingAmount = 0;
  let bulkItemCount = 0;
  let orderItems = [];
  if (hasBulkItems) {
    // D1からアソート商品取得
    const { results: bulkProducts } = await env.DB.prepare(
      'SELECT product_id, name, price, discounted_price, min_qty, max_qty, stock, sold_out, unit FROM bulk_products WHERE active = 1'
    ).all();
    const bulkMap = {};
    for (const bp of bulkProducts) bulkMap[bp.product_id] = bp;

    for (const bItem of form.bulkItems) {
      const bPid = String(bItem.productId || '').trim();
      const bQty = Math.max(0, Math.floor(Number(bItem.qty) || 0));
      if (!bPid || bQty <= 0) continue;
      const bp = bulkMap[bPid];
      if (!bp) return jsonError('アソート商品が見つかりません: ' + bPid);
      if (bp.sold_out) return jsonError(bp.name + ' は売り切れです');
      if (bQty < bp.min_qty) return jsonError(bp.name + ' は最低' + bp.min_qty + bp.unit + 'から注文可能です');
      if (bQty > bp.max_qty) return jsonError(bp.name + ' は最大' + bp.max_qty + bp.unit + 'までです');
      if (bp.stock !== -1 && bp.stock < bQty) return jsonError(bp.name + ' の在庫が不足しています（残り' + bp.stock + '）');
      const bUnitPrice = (bp.discounted_price !== undefined && bp.discounted_price > 0) ? bp.discounted_price : bp.price;
      bulkProductAmount += bUnitPrice * bQty;
      bulkItemCount += bQty;
      orderItems.push({ productId: bPid, name: bp.name, qty: bQty, unit: bp.unit || '点', discountRate: bp.discounted_price > 0 && bp.discounted_price < bp.price ? Math.round((1 - bp.discounted_price / bp.price) * 100) : 0 });
    }
  }
  const rawBulkProductAmount = bulkProductAmount; // 送料無料判定用（クーポン適用前）

  // ─── 設定・顧客データ取得 ───
  const emailLower = contact.toLowerCase();

  // 並列で取得（D1 settings + 顧客データ）
  const [memberDiscountRow, fhpRow, customerRow, shippingRow, qtyDiscountRow, holdRow, minOrderRow, freeShipRow] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key = 'MEMBER_DISCOUNT_STATUS'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'FIRST_HALF_PRICE_STATUS'").first(),
    env.DB.prepare('SELECT points, purchase_count, total_spent FROM customers WHERE email = ?').bind(emailLower).first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'SHIPPING_CONFIG'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'QTY_DISCOUNTS'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'HOLD_MINUTES'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'MIN_ORDER_COUNT'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'FREE_SHIP_THRESHOLD'").first(),
  ]);

  // D1から動的設定を読み込み（フォールバック: ハードコード値）
  let dynShippingRates = SHIPPING_RATES;
  let dynShippingAreas = SHIPPING_AREAS;
  if (shippingRow) {
    try {
      const sc = JSON.parse(shippingRow.value);
      if (sc.rates) dynShippingRates = sc.rates;
      if (sc.areas) dynShippingAreas = sc.areas;
    } catch (e) { /* fallthrough */ }
  }

  let dynQtyDiscounts = null;
  if (qtyDiscountRow) {
    try { dynQtyDiscounts = JSON.parse(qtyDiscountRow.value); } catch (e) { /* fallthrough */ }
  }

  const dynFreeShipThreshold = freeShipRow ? (Number(freeShipRow.value) || 10000) : 10000;

  let memberDiscountStatus = { enabled: true, rate: 0.10, endDate: '2026-09-30', reason: 'active' };
  if (memberDiscountRow) { try { memberDiscountStatus = JSON.parse(memberDiscountRow.value); } catch (e) { /* fallthrough */ } }

  let fhpStatus = { enabled: false, rate: 0.50 };
  if (fhpRow) { try { fhpStatus = JSON.parse(fhpRow.value); } catch (e) { /* fallthrough */ } }

  const customerPoints = customerRow ? customerRow.points : 0;
  const purchaseCount = customerRow ? customerRow.purchase_count : 0;

  // ─── 価格計算 ───
  const totalCount = ids.length;
  let discountRate = 0;
  let memberDiscountRate = 0;
  let couponDiscount = 0;
  let couponLabel = '';
  let validatedCoupon = null;
  let firstHalfPriceApplied = false;
  let activeCouponCode = couponCode;

  // ログイン状態チェック（フロントエンドと一致させるため）
  const isLoggedIn = !!form.loggedIn;

  // 初回全品半額キャンペーンチェック（他の割引と併用不可、ログイン必須）
  // memberCap: 100人目までの登録者のみ対象（GAS isFhpEligible_ と同等）
  if (fhpStatus.enabled && isLoggedIn && customerRow && purchaseCount === 0) {
    const memberCap = fhpStatus.memberCap || 100;
    let fhpEligible = true;
    if (memberCap > 0) {
      // created_at < で自分より前の登録者数を取得（同一秒の曖昧さを排除）
      const orderRow = await env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM customers WHERE created_at < (SELECT created_at FROM customers WHERE email = ?)'
      ).bind(emailLower).first();
      // registrationOrder = 自分より前の人数 + 1（自分）。サブクエリNULL時は対象外にする
      const registrationOrder = (orderRow && orderRow.cnt !== null) ? orderRow.cnt + 1 : memberCap + 1;
      if (registrationOrder > memberCap) fhpEligible = false;
    }
    if (fhpEligible) {
      firstHalfPriceApplied = true;
      activeCouponCode = ''; // 他の割引を無効化
    }
  }

  if (!firstHalfPriceApplied && activeCouponCode) {
    // クーポン検証（D1）
    const coupon = await env.DB.prepare('SELECT * FROM coupons WHERE code = ?').bind(activeCouponCode).first();
    if (!coupon || !coupon.active) return jsonError('無効なクーポンコードです。');

    // 限定顧客チェック
    if (coupon.target_customer_email && coupon.target_customer_email !== emailLower) {
      return jsonError('このクーポンはご利用いただけません。');
    }
    if (coupon.target_customer_name && coupon.target_customer_name !== companyName) {
      return jsonError('このクーポンはご利用いただけません。');
    }
    // チャネルチェック
    if (coupon.channel !== 'all' && coupon.channel !== 'detauri') {
      return jsonError('このクーポンは対象外のチャネルです。');
    }
    // 開始日・有効期限チェック
    const now = new Date();
    if (coupon.start_date && now < new Date(coupon.start_date)) {
      return jsonError('このクーポンはまだ有効期間前です。');
    }
    if (coupon.expires_at && now > new Date(coupon.expires_at)) {
      return jsonError('このクーポンは有効期限切れです。');
    }
    // 利用回数上限
    if (coupon.max_uses > 0 && coupon.use_count >= coupon.max_uses) {
      return jsonError('このクーポンは利用上限に達しています。');
    }
    // 1回限り/ユーザー
    if (coupon.once_per_user && emailLower) {
      const used = await env.DB.prepare(
        'SELECT id FROM coupon_usage WHERE code = ? AND email = ? LIMIT 1'
      ).bind(activeCouponCode, emailLower).first();
      if (used) return jsonError('このクーポンは既にご利用済みです。');
    }
    // ターゲット顧客チェック（new/repeat）
    if (coupon.target !== 'all') {
      if (coupon.target === 'new' && purchaseCount > 0) return jsonError('このクーポンは新規のお客様限定です。');
      if (coupon.target === 'repeat' && purchaseCount === 0) return jsonError('このクーポンはリピーターのお客様限定です。');
    }

    validatedCoupon = {
      type: coupon.type,
      value: coupon.value,
      comboMember: coupon.combo_member === 1,
      comboBulk: coupon.combo_bulk === 1,
    };

    couponLabel = validatedCoupon.type === 'rate'
      ? ('クーポン' + Math.round(validatedCoupon.value * 100) + '%OFF')
      : validatedCoupon.type === 'shipping_free'
        ? 'クーポン送料無料'
        : ('クーポン' + validatedCoupon.value + '円引き');

    // 併用可能な割引（数量割引のみdiscountRateに加算、会員割引は順次適用で別途処理）
    if (validatedCoupon.comboBulk) {
      discountRate += calcQtyDiscount(totalCount, dynQtyDiscounts);
    }
    if (validatedCoupon.comboMember && memberDiscountStatus.enabled && isLoggedIn && customerRow) {
      memberDiscountRate = memberDiscountStatus.rate;
    }
  } else if (!firstHalfPriceApplied) {
    // 通常割引（クーポン未使用時）
    // 段階的数量割引（D1 settingsから動的テーブル）
    discountRate += calcQtyDiscount(totalCount, dynQtyDiscounts);

    // 会員割引（ログイン必須）
    if (memberDiscountStatus.enabled && isLoggedIn && customerRow) {
      memberDiscountRate = memberDiscountStatus.rate;
    }
  }

  // 割引適用（GAS SubmitFix.gs と同一順序: 数量割引 → 会員割引 → クーポン）
  let discounted;
  if (firstHalfPriceApplied) {
    const fhpOnDetauri = Math.round(sum * fhpStatus.rate);
    const fhpOnBulk = Math.round(bulkProductAmount * fhpStatus.rate);
    discounted = sum - fhpOnDetauri;
    bulkProductAmount = Math.max(0, bulkProductAmount - fhpOnBulk);
    couponLabel = '初回全品半額キャンペーン（' + Math.round(fhpStatus.rate * 100) + '%OFF）';
  } else {
    // 数量割引（デタウリのみ）
    discounted = discountRate > 0 ? Math.round(sum * (1 - discountRate)) : sum;
    // 会員割引を両チャネルに適用
    if (memberDiscountRate > 0) {
      discounted = Math.round(discounted * (1 - memberDiscountRate));
      if (bulkProductAmount > 0) {
        bulkProductAmount = Math.round(bulkProductAmount * (1 - memberDiscountRate));
      }
    }
    // クーポン控除: 割引適用後の合算額に対して計算（GAS SubmitFix.gs L178-182 と同一）
    if (validatedCoupon && validatedCoupon.type !== 'shipping_free') {
      couponDiscount = calcCouponDiscount(validatedCoupon.type, validatedCoupon.value, discounted + bulkProductAmount);
    }
  }

  // ─── 送料計算 ───
  const shippingArea = dynShippingAreas[pref] || '';
  let shippingSize = 'large';
  let shippingSizeLabel = '大';
  let shippingAmount = 0;

  // ダイヤモンド会員送料無料チェック（mypage.js と同じランク判定テーブル）
  const totalSpent = customerRow ? (customerRow.total_spent || 0) : 0;
  const diamondFree = totalSpent >= 500000;

  const shippingFreeCoupon = validatedCoupon && validatedCoupon.type === 'shipping_free';
  // 1万円以上で送料無料（FHP適用時は対象外）
  const thresholdFree = !firstHalfPriceApplied && (discounted + bulkProductAmount) >= dynFreeShipThreshold;

  // 送料無料判定前に実際の配送コストを計算（店負担送料用）
  let actualShippingForStore = 0;
  if (ids.length > 0 && shippingArea && dynShippingRates[shippingArea]) {
    const { thick: _thick, thin: _thin } = classifyThickness(productResults);
    const _sz = calcShippingSize(_thick, _thin);
    if (!_sz.size) {
      actualShippingForStore = calcMultiShipment(_thick, _thin, dynShippingRates[shippingArea]).amount;
    } else {
      actualShippingForStore = dynShippingRates[shippingArea][_sz.size === 'small' ? 0 : 1];
    }
  }
  if (bulkItemCount > 0 && shippingArea && dynShippingRates[shippingArea]) {
    actualShippingForStore += dynShippingRates[shippingArea][1] * bulkItemCount;
  }

  if (diamondFree) {
    shippingAmount = 0;
    bulkShippingAmount = 0;
  } else if (shippingFreeCoupon) {
    shippingAmount = 0;
    // アソート送料: 送料除外商品は除外分のみ有料（SubmitFix.gs L237-251と一致）
    const excludeStr = validatedCoupon.shippingExcludeProducts || '';
    if (excludeStr && bulkItemCount > 0 && shippingArea && dynShippingRates[shippingArea]) {
      const excludeIds = new Set(excludeStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
      let excludedBulkQty = 0;
      for (const bi of (form.bulkItems || [])) {
        const pid = String(bi.productId || '').trim().toUpperCase();
        const qty = Math.max(0, Math.floor(Number(bi.qty) || 0));
        if (excludeIds.has(pid)) excludedBulkQty += qty;
      }
      bulkShippingAmount = excludedBulkQty > 0 ? dynShippingRates[shippingArea][1] * excludedBulkQty : 0;
    } else {
      bulkShippingAmount = 0;
    }
  } else if (thresholdFree) {
    shippingAmount = 0;
    bulkShippingAmount = 0;
  } else {
    // 厚み分類 → サイズ判定 → 料金計算（CartCalc.html L32-77 と同一ロジック）
    if (ids.length > 0 && shippingArea && dynShippingRates[shippingArea]) {
      const { thick, thin } = classifyThickness(productResults);
      const sz = calcShippingSize(thick, thin);
      if (!sz.size) {
        // 上限超過: 複数口計算
        const multi = calcMultiShipment(thick, thin, dynShippingRates[shippingArea]);
        shippingAmount = multi.amount;
        shippingSize = 'multi';
        shippingSizeLabel = multi.sizeLabel;
      } else {
        shippingSize = sz.size;
        shippingSizeLabel = sz.size === 'small' ? '小' : '大';
        shippingAmount = dynShippingRates[shippingArea][sz.size === 'small' ? 0 : 1];
      }
    }
    if (bulkItemCount > 0 && shippingArea && dynShippingRates[shippingArea]) {
      bulkShippingAmount = dynShippingRates[shippingArea][1] * bulkItemCount;
    }
  }

  // ─── ポイント利用 ───
  let pointsUsed = 0;
  if (usePoints > 0 && customerRow && customerPoints >= usePoints) {
    pointsUsed = Math.min(usePoints, Math.max(0, discounted + shippingAmount + bulkProductAmount + bulkShippingAmount - couponDiscount));
    let ptRem = pointsUsed;
    const pointsOnProduct = Math.min(ptRem, discounted); ptRem -= pointsOnProduct;
    const pointsOnShipping = Math.min(ptRem, shippingAmount); ptRem -= pointsOnShipping;
    const pointsOnBulkProd = Math.min(ptRem, bulkProductAmount); ptRem -= pointsOnBulkProd;
    const pointsOnBulkShip = Math.min(ptRem, bulkShippingAmount);
    discounted -= pointsOnProduct;
    shippingAmount = Math.max(0, shippingAmount - pointsOnShipping);
    bulkProductAmount = Math.max(0, bulkProductAmount - pointsOnBulkProd);
    bulkShippingAmount = Math.max(0, bulkShippingAmount - pointsOnBulkShip);
  }

  // ─── 備考追記 ───
  if (firstHalfPriceApplied) {
    const fhpNote = '【' + couponLabel + '】';
    note = note ? (note + '\n' + fhpNote) : fhpNote;
  } else {
    const discountParts = [];
    if (activeCouponCode && validatedCoupon) {
      if (validatedCoupon.type === 'shipping_free') {
        discountParts.push(couponLabel + ' コード: ' + activeCouponCode);
      } else if (couponDiscount > 0) {
        discountParts.push(couponLabel + '（-' + couponDiscount + '円）コード: ' + activeCouponCode);
      }
    }
    if (discountRate > 0) {
      discountParts.push('数量割引' + Math.round(discountRate * 100) + '%OFF');
    }
    if (memberDiscountRate > 0) {
      discountParts.push('会員割引' + Math.round(memberDiscountRate * 100) + '%OFF');
    }
    if (discountParts.length > 0) {
      const couponNote = '【' + discountParts.join(' + ') + '】';
      note = note ? (note + '\n' + couponNote) : couponNote;
    }
  }
  if (pointsUsed > 0) {
    const ptNote = '【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
    note = note ? (note + '\n' + ptNote) : ptNote;
  }
  if (shippingAmount > 0) {
    const shipNote = '【送料: ¥' + shippingAmount.toLocaleString() + '（' + (pref || '') + '・' + shippingSizeLabel + '・税込）】';
    note = note ? (note + '\n' + shipNote) : shipNote;
  }

  // ─── 合計金額 ───
  const bulkTotal = bulkProductAmount + bulkShippingAmount;
  const totalWithShipping = discounted + shippingAmount + bulkTotal - couponDiscount;

  // アソート合算ノートは廃止（各列に正しく値が入るため不要）

  if (totalWithShipping <= 0) {
    return jsonError('合計金額が0円以下です。');
  }

  // ─── 決済トークン生成（受付番号は決済確認後にGAS側で発行） ───
  const paymentToken = crypto.randomUUID();
  const sortedIds = [...ids].sort((a, b) => a.localeCompare(b, 'ja'));
  const selectionList = sortedIds.join('、');
  const measureLabel = measureOpt === 'yes' ? '希望する' : '希望しない';
  const invoiceReceipt = (form.invoiceReceipt === true || form.invoiceReceipt === 'true');

  const validatedForm = {
    companyName, contact, contactMethod, delivery,
    postal, address, phone, note, measureOpt, invoiceReceipt,
  };

  // templateText構築（GAS互換 — 受付番号は決済確認後に差し込み）
  const templateLines = [
    '会社名/氏名：' + companyName,
    'メールアドレス：' + contact,
  ];
  if (postal) templateLines.push('郵便番号：' + postal);
  if (address) templateLines.push('住所：' + address);
  if (phone) templateLines.push('電話番号：' + phone);
  templateLines.push('採寸データ：' + measureLabel);
  if (note) templateLines.push('備考：' + note);
  templateLines.push('合計点数：' + (totalCount + bulkItemCount) + '点');
  templateLines.push('合計金額：¥' + totalWithShipping.toLocaleString());
  const templateText = templateLines.join('\n');

  // 商品詳細リスト（メール・シート用）
  const itemDetails = productResults.map(pd => ({
    managedId: pd.managed_id,
    noLabel: pd.no_label || '',
    brand: pd.brand || '',
    category: pd.category || '',
    size: pd.size || '',
    color: pd.color || '',
    price: pd.price || 0,
  }));

  // ─── D1 holds更新（pending_payment=1, until_ms延長）+ open_items即時追加 ───
  const now = Date.now();
  const paymentHoldMs = PAYMENT_EXPIRY_SECONDS * 1000;
  const holdUntilMs = now + paymentHoldMs;

  if (ids.length > 0) {
    const stmts = [];
    for (const managedId of ids) {
      stmts.push(
        env.DB.prepare(`
          INSERT INTO holds (managed_id, user_key, hold_id, until_ms, pending_payment, receipt_no, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (managed_id, user_key) DO UPDATE SET
            hold_id = excluded.hold_id,
            until_ms = excluded.until_ms,
            pending_payment = 1,
            receipt_no = excluded.receipt_no,
            created_at = excluded.created_at
        `).bind(managedId, userKey, userKey + ':' + now, holdUntilMs, paymentToken, new Date().toISOString())
      );
      // 即座にopen_itemsに追加 → 他ユーザーの確保・注文を即ブロック
      stmts.push(
        env.DB.prepare(`
          INSERT INTO open_items (managed_id, receipt_no, status, updated_at) VALUES (?, ?, '依頼中', ?)
          ON CONFLICT (managed_id) DO NOTHING
        `).bind(managedId, paymentToken, new Date().toISOString())
      );
    }
    await env.DB.batch(stmts);
  }

  // ─── KOMOJU決済セッション作成 ───
  const frontendUrl = (env.FRONTEND_URL || 'https://wholesale.nkonline-tool.com').replace(/\/+$/, '');
  const returnUrl = frontendUrl + '?token=' + encodeURIComponent(paymentToken) + '&status=complete';
  const cancelUrl = frontendUrl + '?token=' + encodeURIComponent(paymentToken) + '&status=cancel';

  // 名前を姓名に分割（スペース区切り、なければ全体を姓とする）
  var nameParts = (companyName || '').split(/[\s　]+/);
  var familyName = nameParts[0] || '';
  var givenName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  var postalFormatted = postal ? postal.replace(/[-ー\s]/g, '').replace(/^(\d{3})(\d{4})$/, '$1-$2') : '';

  // Paidy以外を選んだ場合、Hosted PageにPaidyを表示しない（混乱防止）
  const effectivePaymentTypes = paymentMethod === 'paidy'
    ? KOMOJU_PAYMENT_METHODS
    : KOMOJU_PAYMENT_METHODS.filter(m => m !== 'paidy');

  const sessionData = {
    amount: Math.round(totalWithShipping),
    currency: KOMOJU_CURRENCY,
    external_order_num: paymentToken,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    payment_types: effectivePaymentTypes,
    // Paidy含む全決済方法向け顧客情報（トップレベル）
    customer_email: contact || '',
    customer_family_name: familyName,
    customer_given_name: givenName || familyName,
    metadata: {
      payment_token: String(paymentToken),
      company_name: String(companyName),
      email: String(contact),
      product_amount: String(discounted + bulkProductAmount),
      shipping_amount: String(shippingAmount + bulkShippingAmount),
      shipping_size: String(shippingSize),
    },
  };
  // customerオブジェクト
  sessionData.customer = {};
  if (contact) sessionData.customer.email = contact;
  if (companyName) sessionData.customer.name = companyName;
  if (phone) sessionData.customer.phone = phone.replace(/[-ー\s]/g, '');

  // Paidy用: payment_dataにemail・shipping_address
  sessionData.payment_data = {
    paidy: {
      email: contact || '',
      shipping_address: {
        name: companyName || '',
        line1: address || '',
        line2: '',
        city: '',
        state: '',
        zip: postalFormatted,
        country: 'JP'
      }
    }
  };

  console.log('KOMOJU session request: customer_email=' + sessionData.customer_email +
              ', payment_types=' + JSON.stringify(sessionData.payment_types) +
              ', amount=' + sessionData.amount);

  const komojuResp = await fetch(KOMOJU_API_URL + '/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(env.KOMOJU_SECRET_KEY + ':'),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(sessionData),
  });

  const komojuResult = await komojuResp.json();
  console.log('KOMOJU session response: id=' + (komojuResult.id || 'N/A') +
              ', customer_in_resp=' + JSON.stringify(komojuResult.customer || null) +
              ', error=' + JSON.stringify(komojuResult.error || null));

  // session_id → paymentToken マッピング保存（ctx.waitUntilで非同期化）
  const sessionTokenMapPromise = komojuResult.id
    ? env.DB.prepare(
        'INSERT INTO session_token_map (session_id, payment_token, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
      ).bind(komojuResult.id, paymentToken, new Date().toISOString()).run().catch(mapErr => {
        console.error('session_token_map save error (non-fatal):', mapErr.message);
      })
    : Promise.resolve();

  // ─── Paidy Session Pay API（Hosted PageではPaidyのemail/shipping_addressが渡されないため直接APIで決済開始） ───
  let paidyRedirectUrl = null;
  if (paymentMethod === 'paidy' && komojuResult.id && !komojuResult.error) {
    try {
      const phoneClean = phone.replace(/[-ー\s]/g, '');
      const paidyPayResp = await fetch(KOMOJU_API_URL + '/sessions/' + komojuResult.id + '/pay', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(env.KOMOJU_SECRET_KEY + ':'),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          payment_details: {
            type: 'paidy',
            name: companyName,
            email: contact,
            phone: phoneClean,
            shipping_address_line1: address,
            shipping_address_line2: '',
            shipping_address_city: '',
            shipping_address_state: '',
            shipping_address_zip: postalFormatted,
            shipping_address_country: 'JP'
          }
        }),
      });
      const paidyPayResult = await paidyPayResp.json();
      console.log('Paidy Session Pay response: status=' + paidyPayResp.status +
                  ', body=' + JSON.stringify(paidyPayResult).substring(0, 500));
      if (paidyPayResult.redirect_url) {
        paidyRedirectUrl = paidyPayResult.redirect_url;
      } else if (paidyPayResult.payment && paidyPayResult.payment.payment_details && paidyPayResult.payment.payment_details.redirect_url) {
        paidyRedirectUrl = paidyPayResult.payment.payment_details.redirect_url;
      } else {
        console.error('Paidy Session Pay: redirect_url not found:', JSON.stringify(paidyPayResult).substring(0, 500));
      }
    } catch (paidyErr) {
      console.error('Paidy Session Pay error (falling back to session_url):', paidyErr.message);
    }
  }

  if (komojuResult.error || !komojuResult.session_url) {
    // KOMOJU失敗 → holdsとopen_itemsを元に戻す
    console.error('KOMOJU session creation failed:', JSON.stringify(komojuResult));
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE holds SET pending_payment = 0, receipt_no = '' WHERE managed_id IN (${placeholders}) AND user_key = ? AND receipt_no = ?`
        ).bind(...ids, userKey, paymentToken),
        env.DB.prepare(
          `DELETE FROM open_items WHERE managed_id IN (${placeholders})`
        ).bind(...ids),
      ]);
    }
    return jsonError('決済セッションの作成に失敗しました。' + (komojuResult.error ? komojuResult.error.message || '' : ''));
  }

  // ─── ペンディング注文データ（GAS webhook互換） ───
  const storeShipping = Math.round(actualShippingForStore / 2) || 0;

  // channel判定（GAS側プレミアムアソート自動選定用）
  const channel = hasBulkItems ? (ids.length > 0 ? 'まとめ' : 'アソート') : 'デタウリ';

  // 商品名リスト構築（GAS writeSubmitData_ のH列用）
  const allProductNames = [];
  if (ids.length > 0) allProductNames.push('選べるxlsx付きパッケージ');
  for (const oi of orderItems) {
    let label = oi.name + ' x' + oi.qty + oi.unit;
    if (oi.discountRate > 0) label += '(' + oi.discountRate + '%OFF)';
    allProductNames.push(label);
  }

  // K列の合計点数（デタウリは1パッケージ + アソート点数）
  const sheetTotalCount = (ids.length > 0 ? 1 : 0) + bulkItemCount;

  const pendingData = {
    userKey,
    form: validatedForm,
    ids,
    // チャネルが 'まとめ' (デタウリ個品 + アソート併用) の場合は ids が個品リストなので
    // GAS confirmPaymentAndCreateOrder に detauriIds として明示的に渡す。
    // これがないと GAS 側で selection.ids のみで pendingData.ids/selectionList が上書きされ
    // 個品の管理番号が J列(選択リスト)から消える。
    detauriIds: hasBulkItems && ids.length > 0 ? ids : undefined,
    paymentToken,
    selectionList,
    measureOpt,
    totalCount,
    discounted: discounted + bulkProductAmount,
    shippingAmount: shippingAmount + bulkShippingAmount,
    storeShipping,
    shippingSize,
    shippingArea,
    shippingPref: pref,
    createdAtMs: now,
    templateText,
    itemDetails,
    pointsUsed,
    couponCode: activeCouponCode || '',
    couponDiscount: couponDiscount || 0,
    couponLabel: couponLabel || '',
    bulkItemCount,
    totalAmount: totalWithShipping,
    komojuSessionId: komojuResult.id || '',
    channel,
    orderItems,
    productNames: allProductNames.join('\n'),
    _sheetTotalCount: sheetTotalCount,
  };

  // ─── D1バックアップ保存（PropertiesService欠損時のフォールバック用） ───
  try {
    await env.DB.prepare(`
      INSERT INTO pending_orders (payment_token, data, created_at, consumed)
      VALUES (?, ?, ?, 0)
      ON CONFLICT (payment_token) DO UPDATE SET data = excluded.data, created_at = excluded.created_at, consumed = 0
    `).bind(paymentToken, JSON.stringify(pendingData), new Date().toISOString()).run();
  } catch (d1Err) {
    console.error('D1 pending_orders save error (non-fatal):', d1Err.message);
  }

  // ─── GAS保存 + KVバックアップ + session_token_map を ctx.waitUntil で非同期化 ───
  // D1 pending_orders は既に保存済みなので、GAS保存はレスポンスをブロックしない
  const backgroundTasks = [
    savePendingToGas(pendingData, env),
    saveBackupToKV(pendingData, env),
    sessionTokenMapPromise,
  ];
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(Promise.all(backgroundTasks).catch(e => console.error('Background task error:', e)));
  } else {
    Promise.all(backgroundTasks).catch(e => console.error('Background task error:', e));
  }

  return jsonOk({
    paymentToken,
    sessionUrl: komojuResult.session_url,
    paidyRedirectUrl: paidyRedirectUrl || null,
    totalAmount: totalWithShipping,
    shippingAmount,
  });
}

// ─── バックグラウンド処理 ───

async function saveBackupToKV(pendingData, env) {
  if (env.CACHE) {
    var pendingKey = pendingData.paymentToken || pendingData.receiptNo;
    await env.CACHE.put(
      'PENDING_ORDER_' + pendingKey,
      JSON.stringify(pendingData),
      { expirationTtl: 86400 * 7 } // 7日間
    );
  }
}

async function savePendingToGas(pendingData, env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    console.error('GAS_API_URL not configured, skipping pending save');
    return false;
  }

  try {
    const resp = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: '_internalSavePendingOrder',
        adminKey: env.ADMIN_KEY || '',
        args: [pendingData],
      }),
      redirect: 'follow',
    });
    const text = await resp.text();
    console.log('GAS savePending response:', text.substring(0, 200));
    try {
      const result = JSON.parse(text);
      return result && result.ok === true;
    } catch (e) {
      // GASのレスポンスがJSONでない場合（リダイレクト等）
      return resp.ok;
    }
  } catch (e) {
    console.error('GAS savePending error (D1 backup exists):', e.message);
    return false;
  }
}

// ─── ヘルパー ───

function isRemoteIsland(address) {
  const text = String(address || '').trim();
  return REMOTE_ISLANDS.some(island => text.includes(island));
}

function detectPrefecture(address) {
  const text = String(address || '').trim();
  for (const pref of PREFECTURES) {
    if (text.startsWith(pref)) return pref;
  }
  for (const pref of PREFECTURES) {
    const short = pref.replace(/[都府県]$/, '');
    if (text.startsWith(short)) return pref;
  }
  return null;
}

async function verifyRecaptcha(token, secret) {
  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
  });
  const result = await resp.json();
  return result.success && (result.score || 0) >= 0.3;
}

function calcCouponDiscount(type, value, productAmount) {
  if (type === 'shipping_free') return 0;
  if (type === 'rate') return Math.round(productAmount * value);
  return Math.min(value, productAmount); // fixed
}

// ─── 送料ヘルパー（CartCalc.html L32-77 / SubmitFix.gs L1606-1647 からポート） ───

function classifyThickness(results) {
  let thick = 0, thin = 0;
  for (const r of results) {
    if (String(r.shipping_method || '').trim() === 'ゆうパケットポスト') thin++;
    else thick++;
  }
  return { thick, thin, total: thick + thin };
}

function calcShippingSize(thick, thin) {
  const total = thick + thin;
  if (thin === 0) {
    if (total > 20) return { size: null };
    return { size: 'large' };
  }
  if (thick === 0) {
    if (total > 40) return { size: null };
    return total <= 10 ? { size: 'small' } : { size: 'large' };
  }
  if (total > 40) return { size: null };
  if (thick >= 10) return { size: 'large' };
  return total <= 10 ? { size: 'small' } : { size: 'large' };
}

function calcMultiShipment(thick, thin, rates) {
  const smallRate = rates[0], largeRate = rates[1];
  let totalAmount = 0, largeCnt = 0, smallCnt = 0;
  if (thick > 0) {
    const n = Math.ceil(thick / 20);
    largeCnt += n;
    totalAmount += n * largeRate;
  }
  let rem = thin;
  while (rem > 0) {
    const batch = Math.min(rem, 40);
    if (batch <= 10) { smallCnt++; totalAmount += smallRate; }
    else { largeCnt++; totalAmount += largeRate; }
    rem -= batch;
  }
  const parts = [];
  if (largeCnt > 0) parts.push('大×' + largeCnt);
  if (smallCnt > 0) parts.push('小×' + smallCnt);
  return { amount: totalAmount, sizeLabel: parts.join('、') };
}

function makeReceiptNo() {
  // YYYYMMDDHHmmss-NNN (JST)
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const mi = String(jst.getUTCMinutes()).padStart(2, '0');
  const s = String(jst.getUTCSeconds()).padStart(2, '0');
  const rnd = Math.floor(Math.random() * 900 + 100);
  return `${y}${mo}${d}${h}${mi}${s}-${rnd}`;
}

// ─── レガシー互換: GASプロキシフォールバック（ロールバック用） ───

async function proxyToGasForSubmit(bodyText, env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    return jsonError('GAS_API_URL not configured', 502);
  }

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: bodyText,
    redirect: 'follow',
  });

  const text = await resp.text();
  return corsResponse(new Response(text, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Source': 'gas-proxy-validated',
    },
  }));
}

// ─── D1ペンディング注文API（GASからのフォールバック取得用） ───

/**
 * D1からペンディング注文を取得（ADMIN_KEY認証）
 */
export async function getPendingOrder(args, env, bodyText) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch (e) { parsed = {}; }
  if (!parsed.adminKey || parsed.adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 403);
  }

  const paymentToken = String(args[0] || '').trim();
  if (!paymentToken) return jsonError('paymentToken is required');

  try {
    const row = await env.DB.prepare(
      'SELECT payment_token, data, created_at, consumed FROM pending_orders WHERE payment_token = ?'
    ).bind(paymentToken).first();

    if (!row) {
      return jsonOk({ ok: true, found: false });
    }

    return jsonOk({
      ok: true,
      found: true,
      paymentToken: row.payment_token,
      data: row.data,
      createdAt: row.created_at,
      consumed: row.consumed,
    });
  } catch (e) {
    console.error('getPendingOrder error:', e.message);
    return jsonError('D1 query error: ' + e.message, 500);
  }
}

/**
 * D1のsession_token_mapからsession_id→paymentTokenを逆引き（ADMIN_KEY認証）
 */
export async function lookupBySession(args, env, bodyText) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch (e) { parsed = {}; }
  if (!parsed.adminKey || parsed.adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 403);
  }

  const sessionId = String(args[0] || '').trim();
  if (!sessionId) return jsonError('session_id is required');

  try {
    const row = await env.DB.prepare(
      'SELECT payment_token FROM session_token_map WHERE session_id = ?'
    ).bind(sessionId).first();

    if (!row) {
      return jsonOk({ ok: true, found: false });
    }

    return jsonOk({ ok: true, found: true, paymentToken: row.payment_token });
  } catch (e) {
    console.error('lookupBySession error:', e.message);
    return jsonError('D1 query error: ' + e.message, 500);
  }
}

/**
 * D1のsession_token_mapからpaymentToken→sessionIdを逆引き（ADMIN_KEY認証）
 * Workers版submitEstimateで作成されたKOMOJUセッションIDをGAS側から取得するために使用
 */
export async function lookupSessionByToken(args, env, bodyText) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch (e) { parsed = {}; }
  if (!parsed.adminKey || parsed.adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 403);
  }

  const paymentToken = String(args[0] || '').trim();
  if (!paymentToken) return jsonError('paymentToken is required');

  try {
    const row = await env.DB.prepare(
      'SELECT session_id FROM session_token_map WHERE payment_token = ?'
    ).bind(paymentToken).first();

    if (!row) {
      return jsonOk({ ok: true, found: false });
    }

    return jsonOk({ ok: true, found: true, sessionId: row.session_id });
  } catch (e) {
    console.error('lookupSessionByToken error:', e.message);
    return jsonError('D1 query error: ' + e.message, 500);
  }
}

/**
 * D1のペンディング注文をconsumed=1にマーク（ADMIN_KEY認証）
 */
export async function markPendingConsumed(args, env, bodyText) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch (e) { parsed = {}; }
  if (!parsed.adminKey || parsed.adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 403);
  }

  const paymentToken = String(args[0] || '').trim();
  if (!paymentToken) return jsonError('paymentToken is required');

  try {
    await env.DB.prepare(
      'UPDATE pending_orders SET consumed = 1 WHERE payment_token = ?'
    ).bind(paymentToken).run();

    return jsonOk({ ok: true, message: 'Marked as consumed' });
  } catch (e) {
    console.error('markPendingConsumed error:', e.message);
    return jsonError('D1 update error: ' + e.message, 500);
  }
}

/**
 * apiSendCapiEvent — GAS等のサーバーサイドからCAPIイベントを送信するエンドポイント
 *
 * 主にKOMOJU webhook処理後のPurchaseイベント送信に使用。
 * ADMIN_KEYで認証。
 */
export async function sendCapiEvent(args, env) {
  const params = args[0] || {};
  const { adminKey, eventName, eventId, email, phone, postal, amount, currency, contentIds, numItems } = params;

  if (adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 401);
  }

  if (!eventName) {
    return jsonError('eventName is required');
  }

  const userData = {};
  if (email) userData.email = email;
  if (phone) userData.phone = phone;
  if (postal) userData.zip = postal;
  userData.country = 'jp';

  const customData = {};
  if (currency) customData.currency = currency;
  if (amount) customData.value = amount;
  if (contentIds) customData.content_ids = contentIds;
  if (numItems) customData.num_items = numItems;
  customData.content_type = 'product';

  const result = await sendMetaEvent(env, {
    eventName,
    eventId: eventId || (eventName + '_' + Date.now()),
    sourceUrl: 'https://wholesale.nkonline-tool.com/',
    userData,
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  });

  return jsonOk({ ok: true, capi: result });
}
