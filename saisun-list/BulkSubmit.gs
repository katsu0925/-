// BulkSubmit.gs
// =====================================================
// BulkSubmit.gs — アソート商品の注文送信・KOMOJU決済連携
// =====================================================
//
// フロー:
// 1. apiBulkSubmit() — バリデーション・価格計算・KOMOJU決済セッション作成
// 2. KOMOJU Webhook → confirmPaymentAndCreateOrder() → bulk_writeOrder_()
// 3. 依頼管理シートにチャネル「アソート」として書き込み

/**
 * アソート商品の注文送信API
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
      if (p.soldOut) return { ok: false, message: p.name + ' は売り切れです' };

      if (qty < p.minQty) return { ok: false, message: p.name + ' は最低' + p.minQty + p.unit + 'から注文可能です' };
      if (qty > p.maxQty) return { ok: false, message: p.name + ' は最大' + p.maxQty + p.unit + 'までです' };
      if (p.stock !== -1 && p.stock < qty) return { ok: false, message: p.name + ' の在庫が不足しています（残り' + p.stock + '）' };

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

    // === デタウリカート合算データを先読み ===
    var detauriProductAmount = Math.max(0, Math.floor(Number(f.detauriProductAmount || 0)));
    var detauriShippingAmount = Math.max(0, Math.floor(Number(f.detauriShipping || 0)));
    var detauriItemCount = Math.max(0, Math.floor(Number(f.detauriItemCount || 0)));
    // デタウリ最低数量チェック（アソートありなら制限なし、なしなら5点以上必要）
    if (orderItems.length === 0 && detauriItemCount > 0 && detauriItemCount < 5) {
      return { ok: false, message: 'デタウリ商品は5点以上で購入可能です（現在' + detauriItemCount + '点）' };
    }

    // === 割引計算（CartCalcと同じ順序: FHP → 数量割引 → 会員割引 → クーポン） ===
    var discountRate = 0;
    var couponDiscount = 0;
    var couponLabel = '';
    var validatedCoupon = null;
    var firstHalfPriceApplied = false;

    // 初回全品半額キャンペーンチェック（他の割引と併用不可）
    var fhpStatus = app_getFirstHalfPriceStatus_();
    if (fhpStatus.enabled && contact && typeof findCustomerByEmail_ === 'function') {
      var custForFhp = findCustomerByEmail_(contact);
      if (custForFhp && custForFhp.purchaseCount === 0) {
        firstHalfPriceApplied = true;
        couponCode = ''; // 他の割引を無効化
      }
    }

    // クーポン検証（割引額はまだ計算しない — 会員割引適用後に計算）
    if (!firstHalfPriceApplied && couponCode) {
      var bulkProductIds = [];
      for (var ci = 0; ci < orderItems.length; ci++) bulkProductIds.push(orderItems[ci].productId);
      var couponResult = validateCoupon_(couponCode, contact, 'bulk', bulkProductIds, companyName);
      if (!couponResult.ok) return couponResult;
      validatedCoupon = couponResult;
      couponLabel = couponResult.type === 'rate'
        ? ('クーポン' + Math.round(couponResult.value * 100) + '%OFF')
        : couponResult.type === 'shipping_free'
          ? 'クーポン送料無料'
          : ('クーポン' + couponResult.value + '円引き');
    }

    // 会員割引レート取得（CartCalc step 3b — comboMember !== false なら適用）
    if (!firstHalfPriceApplied) {
      var _comboMemberOk = !validatedCoupon || validatedCoupon.comboMember !== false;
      if (_comboMemberOk) {
        var memberStatus = app_getMemberDiscountStatus_();
        if (memberStatus.enabled && contact && typeof findCustomerByEmail_ === 'function') {
          var cust = findCustomerByEmail_(contact);
          if (cust) discountRate = memberStatus.rate;
        }
      }
    }

    // デタウリ数量割引（CartCalc step 3a — FHP時・comboBulk=false時は除外）
    if (!firstHalfPriceApplied && detauriItemCount >= 10 && detauriProductAmount > 0) {
      var _applyBulkDisc = !validatedCoupon || validatedCoupon.comboBulk !== false;
      if (_applyBulkDisc) {
        var detauriBulkRate = 0;
        if (detauriItemCount >= 100) detauriBulkRate = 0.20;
        else if (detauriItemCount >= 50) detauriBulkRate = 0.15;
        else if (detauriItemCount >= 30) detauriBulkRate = 0.10;
        else detauriBulkRate = 0.05;
        var detauriBulkDisc = Math.round(detauriProductAmount * detauriBulkRate);
        detauriProductAmount = Math.max(0, detauriProductAmount - detauriBulkDisc);
        if (detauriBulkDisc > 0) {
          var bulkDiscLabel = '【デタウリ数量割引: ' + detauriItemCount + '点 ' + Math.round(detauriBulkRate * 100) + '%OFF（-¥' + detauriBulkDisc + '）】';
          note = note ? (note + '\n' + bulkDiscLabel) : bulkDiscLabel;
        }
      }
    }

    // === 割引適用（CartCalc step順: FHP → 数量割引(上) → 会員割引 → クーポン） ===
    var discounted;
    if (firstHalfPriceApplied) {
      // 初回半額: 各チャネル個別に50%OFF（送料は対象外）
      var _fhpOnAssort = Math.round(sum * fhpStatus.rate);
      var _fhpOnDetauri = Math.round(detauriProductAmount * fhpStatus.rate);
      discounted = sum - _fhpOnAssort;
      detauriProductAmount = Math.max(0, detauriProductAmount - _fhpOnDetauri);
      couponLabel = '初回全品半額キャンペーン（' + Math.round(fhpStatus.rate * 100) + '%OFF）';
    } else {
      // 会員割引を両チャネルに適用（CartCalc step 3b）
      discounted = Math.round(sum * (1 - discountRate));
      if (discountRate > 0 && detauriProductAmount > 0) {
        detauriProductAmount = Math.round(detauriProductAmount * (1 - discountRate));
      }
      // クーポン控除: 会員割引適用後の合算額に対して計算（CartCalc step 6）
      if (validatedCoupon && validatedCoupon.type !== 'shipping_free') {
        var combinedDiscounted = discounted + detauriProductAmount;
        couponDiscount = calcCouponDiscount_(validatedCoupon.type, validatedCoupon.value, combinedDiscounted);
      }
    }

    // === 送料計算（CartCalcと同じ優先順序: ダイヤモンド > クーポン > 1万円以上 > 計算値） ===
    var shippingPref = String(f.shippingPref || '');
    var shippingSize = 'large';
    var shippingAmount = 0;
    var shippingArea = '';

    // ダイヤモンド会員送料無料チェック
    var diamondFree = false;
    if (contact) {
      try {
        var rankInfo = calculateCustomerRank_(contact);
        diamondFree = rankInfo && rankInfo.freeShipping === true;
      } catch (e) { console.error('ランク取得エラー:', e); }
    }

    var shippingFreeCoupon = validatedCoupon && validatedCoupon.type === 'shipping_free';
    var thresholdFree = (discounted + detauriProductAmount) >= 10000;

    if (shippingPref) {
      shippingArea = SHIPPING_AREAS[shippingPref] || '';
      if (shippingArea && SHIPPING_RATES[shippingArea]) {
        if (diamondFree) {
          shippingAmount = 0;
          detauriShippingAmount = 0;
        } else if (shippingFreeCoupon) {
          // 送料無料クーポン（送料除外商品は除外分のみ有料）
          var shippingExcludedQty = 0;
          var excludeStr = validatedCoupon.shippingExcludeProducts || '';
          if (excludeStr) {
            var excludeIds = excludeStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(function(s) { return s; });
            for (var ei = 0; ei < orderItems.length; ei++) {
              var ePid = String(orderItems[ei].productId || '').toUpperCase();
              for (var ex = 0; ex < excludeIds.length; ex++) {
                if (ePid === excludeIds[ex]) { shippingExcludedQty += orderItems[ei].qty; break; }
              }
            }
          }
          shippingAmount = (shippingExcludedQty > 0) ? SHIPPING_RATES[shippingArea][1] * shippingExcludedQty : 0;
          detauriShippingAmount = 0;
        } else if (thresholdFree) {
          shippingAmount = 0;
          detauriShippingAmount = 0;
        } else {
          shippingAmount = SHIPPING_RATES[shippingArea][1] * totalQty;
        }
      }
    }

    // === ポイント使用（1pt = 1円）— 送料確定後に適用 ===
    var pointsUsed = Math.max(0, Math.floor(Number(f.pointsUsed || 0)));
    var pointsDiscount = 0;
    if (pointsUsed > 0 && contact && typeof findCustomerByEmail_ === 'function') {
      var custPt = findCustomerByEmail_(contact);
      var availablePoints = custPt ? (Number(custPt.points) || 0) : 0;
      if (availablePoints < pointsUsed) {
        return { ok: false, message: 'ポイント残高が不足しています（残高: ' + availablePoints + 'pt）' };
      }
      pointsUsed = Math.min(pointsUsed, Math.max(0, discounted + shippingAmount + detauriProductAmount + detauriShippingAmount - couponDiscount));
      var _ptRem = pointsUsed;
      var ptOnProduct = Math.min(_ptRem, discounted); _ptRem -= ptOnProduct;
      var ptOnShipping = Math.min(_ptRem, shippingAmount); _ptRem -= ptOnShipping;
      var ptOnDetauriProd = Math.min(_ptRem, detauriProductAmount); _ptRem -= ptOnDetauriProd;
      var ptOnDetauriShip = Math.min(_ptRem, detauriShippingAmount);
      discounted = Math.max(0, discounted - ptOnProduct);
      shippingAmount = Math.max(0, shippingAmount - ptOnShipping);
      detauriProductAmount = Math.max(0, detauriProductAmount - ptOnDetauriProd);
      detauriShippingAmount = Math.max(0, detauriShippingAmount - ptOnDetauriShip);
      pointsDiscount = pointsUsed;
    }

    // === 備考に割引・送料を追記 ===
    if (firstHalfPriceApplied) {
      var fhpNote = '【' + couponLabel + '】';
      note = note ? (note + '\n' + fhpNote) : fhpNote;
    } else if (couponCode && validatedCoupon) {
      var discountParts = [];
      if (validatedCoupon.type === 'shipping_free') {
        discountParts.push(couponLabel + ' コード: ' + couponCode);
      } else if (couponDiscount > 0) {
        discountParts.push(couponLabel + '（-' + couponDiscount + '円）コード: ' + couponCode);
      }
      if (discountRate > 0) {
        discountParts.push('併用会員割引' + Math.round(discountRate * 100) + '%OFF');
      }
      if (discountParts.length > 0) {
        var couponNote = '【' + discountParts.join(' + ') + '】';
        note = note ? (note + '\n' + couponNote) : couponNote;
      }
    }
    if (pointsDiscount > 0) {
      var ptNote = '【ポイント利用: ' + pointsUsed + 'pt（-¥' + pointsDiscount + '）】';
      note = note ? (note + '\n' + ptNote) : ptNote;
    }
    if (shippingAmount > 0) {
      var shippingQtyLabel = shippingExcludedQty > 0 ? shippingExcludedQty : totalQty;
      var shippingLabel = '【送料: ¥' + shippingAmount + '（' + (shippingPref || '') + '・大×' + shippingQtyLabel + '・税込';
      if (shippingExcludedQty > 0) shippingLabel += '・送料除外商品分';
      shippingLabel += '）】';
      note = note ? (note + '\n' + shippingLabel) : shippingLabel;
    }

    // === デタウリカートの金額を合算（両チャネル合算決済） ===
    var detauriTotal = detauriProductAmount + detauriShippingAmount;

    var totalWithShipping = discounted + shippingAmount + detauriTotal - couponDiscount;

    if (detauriTotal > 0) {
      var detauriNote = '【デタウリ合算: 商品代¥' + detauriProductAmount + '（' + detauriItemCount + '点）+ 送料¥' + detauriShippingAmount + '】';
      note = note ? (note + '\n' + detauriNote) : detauriNote;
    }

    // === 決済トークン生成（受付番号は決済確認後にGAS側で発行） ===
    var paymentToken = Utilities.getUuid();

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
      paymentToken: paymentToken,
      totalCount: totalQty,
      productAmount: sum,
      discounted: discounted,
      shippingAmount: shippingAmount,
      storeShipping: calcStoreShippingByAddress_(shippingPref, totalQty) || 0,
      shippingSize: shippingSize,
      shippingPref: shippingPref,
      selectionList: '',
      productNames: productNames.join('\n'),
      createdAtMs: u_nowMs_(),
      couponCode: couponCode || '',
      couponDiscount: couponDiscount || 0,
      couponLabel: couponLabel || '',
      pointsUsed: pointsUsed || 0,
      pointsDiscount: pointsDiscount || 0,
      detauriProductAmount: detauriProductAmount,
      detauriShipping: detauriShippingAmount,
      detauriItemCount: detauriItemCount,
      detauriIds: Array.isArray(f.detauriIds) ? f.detauriIds : [],
      totalAmount: totalWithShipping
    };

    var props = PropertiesService.getScriptProperties();
    props.setProperty('PENDING_ORDER_' + paymentToken, JSON.stringify(pendingData));
    console.log('アソート商品ペンディング注文を保存: ' + paymentToken + ' (デタウリ合算: ¥' + detauriTotal + ')');

    // === KOMOJU決済セッション作成 ===
    var komojuResult = apiCreateKomojuSession(paymentToken, totalWithShipping, {
      email: contact,
      companyName: companyName,
      phone: phone,
      postal: postal,
      address: address,
      productAmount: discounted + detauriProductAmount,
      shippingAmount: shippingAmount + detauriShippingAmount,
      shippingSize: shippingSize
    });

    if (!komojuResult || !komojuResult.ok) {
      console.error('KOMOJU session creation failed for bulk:', komojuResult);
      props.deleteProperty('PENDING_ORDER_' + paymentToken);
      return {
        ok: false,
        message: '決済セッションの作成に失敗しました。' + (komojuResult && komojuResult.message ? komojuResult.message : '')
      };
    }

    console.log('アソート商品KOMOJU決済セッション作成: ' + paymentToken + ' → ' + komojuResult.sessionUrl);

    // === 在庫減算 + BASE在庫同期 ===
    try {
      bulk_deductStock_(orderItems);
      for (var si = 0; si < orderItems.length; si++) {
        try { baseSyncSingleStock_(orderItems[si].productId); } catch (be) { console.error('BASE在庫同期エラー:', be); }
      }
    } catch (stockErr) {
      console.error('在庫減算エラー（注文は継続）:', stockErr);
    }

    return {
      ok: true,
      paymentToken: paymentToken,
      sessionUrl: komojuResult.sessionUrl,
      totalAmount: totalWithShipping,
      shippingAmount: shippingAmount
    };

  } catch (e) {
    console.error('apiBulkSubmit error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * 在庫減算（注文確定後に呼ばれる）
 * @param {object[]} orderItems - [{ productId, qty }]
 */
function bulk_deductStock_(orderItems) {
  var ss = bulk_getSs_();
  var sh = bulk_ensureSheet_(ss);
  var c = BULK_CONFIG.cols;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var itemMap = {};
  for (var i = 0; i < orderItems.length; i++) {
    itemMap[orderItems[i].productId] = orderItems[i].qty;
  }

  for (var r = 0; r < data.length; r++) {
    var pid = String(data[r][c.productId] || '').trim();
    if (!pid || !itemMap[pid]) continue;

    var stockRaw = data[r][c.stock];
    var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
    if (isNaN(stock)) stock = -1;
    if (stock === -1) continue;

    var newStock = Math.max(0, stock - itemMap[pid]);
    var rowNum = r + 2;
    sh.getRange(rowNum, c.stock + 1).setValue(newStock);

    if (newStock === 0) {
      sh.getRange(rowNum, c.active + 1).setValue(false);
    }
  }

  bulk_clearCache_();
}

/**
 * キャンセル時に在庫を復帰（+ BASE在庫も同期）
 * @param {string} selectionList - 選択リスト文字列（J列）
 * @param {number} totalCount - 合計点数（K列）
 */
function bulk_restoreStock_(selectionList, totalCount) {
  try {
    var ss = bulk_getSs_();
    var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
    if (!sh) return;

    var c = BULK_CONFIG.cols;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

    // 選択リストから商品名→数量を解析
    // 形式例: "商品A × 2\n商品B × 1"
    var itemQtyMap = {};
    var lines = String(selectionList || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var match = line.match(/^(.+?)\s*[×x]\s*(\d+)/i);
      if (match) {
        itemQtyMap[match[1].trim()] = Number(match[2]) || 1;
      }
    }

    if (Object.keys(itemQtyMap).length === 0) return;

    var changed = false;
    for (var r = 0; r < data.length; r++) {
      var name = String(data[r][c.name] || '').trim();
      if (!name || !itemQtyMap[name]) continue;

      var stockRaw = data[r][c.stock];
      var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
      if (isNaN(stock)) stock = -1;
      if (stock === -1) continue; // 無制限はスキップ

      var newStock = stock + itemQtyMap[name];
      var rowNum = r + 2;
      sh.getRange(rowNum, c.stock + 1).setValue(newStock);

      // 在庫が復活したら公開に戻す
      if (stock === 0 && newStock > 0) {
        sh.getRange(rowNum, c.active + 1).setValue(true);
      }

      changed = true;
      console.log('在庫復帰: ' + name + ' ' + stock + ' → ' + newStock);

      // BASE在庫も同期
      var pid = String(data[r][c.productId] || '').trim();
      if (pid) {
        try { baseSyncSingleStock_(pid); } catch (e) { console.error('BASE在庫復帰同期エラー:', e); }
      }
    }

    if (changed) bulk_clearCache_();
  } catch (e) {
    console.error('bulk_restoreStock_ error:', e);
  }
}
