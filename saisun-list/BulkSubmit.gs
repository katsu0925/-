// =====================================================
// BulkSubmit.gs — まとめ商品の注文送信・KOMOJU決済連携
// =====================================================
//
// フロー:
// 1. apiBulkSubmit() — バリデーション・価格計算・KOMOJU決済セッション作成
// 2. KOMOJU Webhook → confirmPaymentAndCreateOrder() → bulk_writeOrder_()
// 3. 依頼管理シートにチャネル「まとめ」として書き込み

/**
 * まとめ商品の注文送信API
 * @param {object} form - 注文フォーム { companyName, contact, postal, address, phone, note, couponCode }
 * @param {object[]} items - 注文商品 [{ productId, qty }]
 * @returns {object} { ok, receiptNo, sessionUrl, totalAmount, shippingAmount }
 */
function apiBulkSubmit(form, items) {
  try {
    // === バリデーション ===
    var f = form || {};
    var companyName = String(f.companyName || '').trim();
    var contact = String(f.contact || '').trim();
    var postal = String(f.postal || '').trim();
    var address = String(f.address || '').trim();
    var phone = String(f.phone || '').trim();
    var note = String(f.note || '').trim();
    var couponCode = String(f.couponCode || '').trim();

    if (!companyName) return { ok: false, message: '会社名/氏名は必須です' };
    if (!contact) return { ok: false, message: 'メールアドレスは必須です' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, message: '有効なメールアドレスを入力してください' };
    if (!postal) return { ok: false, message: '郵便番号は必須です' };
    if (!address) return { ok: false, message: '住所は必須です' };
    if (!phone) return { ok: false, message: '電話番号は必須です' };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { ok: false, message: 'カートが空です' };
    }

    // === 商品データ取得・価格計算 ===
    var products = bulk_getProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) {
      productMap[products[i].productId] = products[i];
    }

    var sum = 0;
    var totalQty = 0;
    var orderItems = [];
    var productNames = [];

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var pid = String(item.productId || '').trim();
      var qty = Math.max(0, Math.floor(Number(item.qty) || 0));
      if (!pid || qty <= 0) continue;

      var p = productMap[pid];
      if (!p) return { ok: false, message: '商品が見つかりません: ' + pid };

      if (qty < p.minQty) return { ok: false, message: p.name + ' は最低' + p.minQty + p.unit + 'から注文可能です' };
      if (qty > p.maxQty) return { ok: false, message: p.name + ' は最大' + p.maxQty + p.unit + 'までです' };

      // 個別割引適用
      var unitPrice = (p.discountedPrice !== undefined) ? p.discountedPrice : p.price;
      var lineTotal = unitPrice * qty;
      sum += lineTotal;
      totalQty += qty;

      orderItems.push({
        productId: pid,
        name: p.name,
        price: unitPrice,
        originalPrice: p.price,
        discountRate: p.discountRate || 0,
        unit: p.unit,
        qty: qty,
        lineTotal: lineTotal
      });

      var nameLabel = p.name + ' x' + qty + p.unit;
      if (p.discountRate > 0) nameLabel += '(' + Math.round(p.discountRate * 100) + '%OFF)';
      productNames.push(nameLabel);
    }

    if (orderItems.length === 0) return { ok: false, message: 'カートが空です' };

    // === 割引計算（既存のクーポン・会員割引を再利用） ===
    var discountRate = 0;
    var couponDiscount = 0;
    var couponLabel = '';
    var validatedCoupon = null;

    if (couponCode) {
      var bulkProductIds = [];
      for (var ci = 0; ci < orderItems.length; ci++) bulkProductIds.push(orderItems[ci].productId);
      var couponResult = validateCoupon_(couponCode, contact, 'bulk', bulkProductIds);
      if (!couponResult.ok) return couponResult;
      validatedCoupon = couponResult;
      couponDiscount = calcCouponDiscount_(couponResult.type, couponResult.value, sum);
      couponLabel = couponResult.type === 'rate'
        ? ('クーポン' + Math.round(couponResult.value * 100) + '%OFF')
        : couponResult.type === 'shipping_free'
          ? 'クーポン送料無料'
          : ('クーポン' + couponResult.value + '円引き');

      // 併用可能な割引
      if (validatedCoupon.comboBulk && totalQty >= 30) {
        discountRate += 0.10;
      }
      var memberStatus = app_getMemberDiscountStatus_();
      if (validatedCoupon.comboMember && memberStatus.enabled && contact && typeof findCustomerByEmail_ === 'function') {
        var cust = findCustomerByEmail_(contact);
        if (cust) discountRate += memberStatus.rate;
      }
    } else {
      // 通常割引
      if (totalQty >= 30) discountRate += 0.10;
      var memberStatus = app_getMemberDiscountStatus_();
      if (memberStatus.enabled && contact && typeof findCustomerByEmail_ === 'function') {
        var cust = findCustomerByEmail_(contact);
        if (cust) discountRate += memberStatus.rate;
      }
    }

    var discounted;
    if (couponCode) {
      var afterCoupon = Math.max(0, sum - couponDiscount);
      discounted = Math.round(afterCoupon * (1 - discountRate));
    } else {
      discounted = Math.round(sum * (1 - discountRate));
    }

    // === 送料計算（まとめ商品: 常に大サイズ × 数量） ===
    var shippingPref = String(f.shippingPref || '');
    var shippingSize = 'large';
    var shippingAmount = 0;
    if (shippingPref) {
      var area = SHIPPING_AREAS[shippingPref];
      if (area && SHIPPING_RATES[area]) {
        shippingAmount = SHIPPING_RATES[area][1] * totalQty; // [1] = 大
      }
    }

    // 送料無料クーポン
    if (validatedCoupon && validatedCoupon.type === 'shipping_free') {
      shippingAmount = 0;
    }

    // === 備考に割引・送料を追記 ===
    if (couponCode && validatedCoupon) {
      var discountParts = [];
      if (validatedCoupon.type === 'shipping_free') {
        discountParts.push(couponLabel + ' コード: ' + couponCode);
      } else if (couponDiscount > 0) {
        discountParts.push(couponLabel + '（-' + couponDiscount + '円）コード: ' + couponCode);
      }
      if (discountRate > 0) {
        discountParts.push('併用割引' + Math.round(discountRate * 100) + '%OFF');
      }
      if (discountParts.length > 0) {
        var couponNote = '【' + discountParts.join(' + ') + '】';
        note = note ? (note + '\n' + couponNote) : couponNote;
      }
    }
    if (shippingAmount > 0) {
      var shippingLabel = '【送料: ¥' + shippingAmount + '（' + (shippingPref || '') + '・大×' + totalQty + '・税込）】';
      note = note ? (note + '\n' + shippingLabel) : shippingLabel;
    }

    var totalWithShipping = discounted + shippingAmount;

    // === 受付番号生成 ===
    var receiptNo = u_makeReceiptNo_();

    var validatedForm = {
      companyName: companyName,
      contact: contact,
      contactMethod: '',
      delivery: '',
      postal: postal,
      address: address,
      phone: phone,
      note: note,
      invoiceReceipt: f.invoiceReceipt === true || f.invoiceReceipt === 'true'
    };

    // === ペンディング注文データを保存 ===
    var pendingData = {
      channel: BULK_CONFIG.channel,
      form: validatedForm,
      orderItems: orderItems,
      receiptNo: receiptNo,
      totalCount: totalQty,
      productAmount: sum,
      discounted: discounted,
      shippingAmount: shippingAmount,
      storeShipping: calcStoreShippingByAddress_(shippingPref, totalQty) || 0,
      shippingSize: shippingSize,
      shippingPref: shippingPref,
      productNames: productNames.join('、'),
      createdAtMs: u_nowMs_(),
      couponCode: couponCode || '',
      couponDiscount: couponDiscount || 0,
      couponLabel: couponLabel || ''
    };

    var props = PropertiesService.getScriptProperties();
    props.setProperty('PENDING_ORDER_' + receiptNo, JSON.stringify(pendingData));
    console.log('まとめ商品ペンディング注文を保存: ' + receiptNo);

    // === KOMOJU決済セッション作成 ===
    var komojuResult = apiCreateKomojuSession(receiptNo, totalWithShipping, {
      email: contact,
      companyName: companyName,
      productAmount: discounted,
      shippingAmount: shippingAmount,
      shippingSize: shippingSize
    });

    if (!komojuResult || !komojuResult.ok) {
      console.error('KOMOJU session creation failed for bulk:', komojuResult);
      props.deleteProperty('PENDING_ORDER_' + receiptNo);
      return {
        ok: false,
        message: '決済セッションの作成に失敗しました。' + (komojuResult && komojuResult.message ? komojuResult.message : '')
      };
    }

    console.log('まとめ商品KOMOJU決済セッション作成: ' + receiptNo + ' → ' + komojuResult.sessionUrl);

    return {
      ok: true,
      receiptNo: receiptNo,
      sessionUrl: komojuResult.sessionUrl,
      totalAmount: totalWithShipping,
      shippingAmount: shippingAmount
    };

  } catch (e) {
    console.error('apiBulkSubmit error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
