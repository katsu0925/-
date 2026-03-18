// SubmitFix.gs
/**
 * SubmitFix.gs
 *
 * 決済フロー:
 * 1. apiSubmitEstimate() — バリデーション・価格計算・商品確保・KOMOJU決済セッション作成
 *    → フロントエンドにKOMOJU決済URLを返す（シート書き込み・メール送信はしない）
 * 2. KOMOJU Webhook → confirmPaymentAndCreateOrder() — 決済完了後にシート書き込み・メール送信
 * 3. apiCancelOrder() — 決済キャンセル・失敗時に商品を解放
 */

// =====================================================
// apiSubmitEstimate — 注文送信 → KOMOJU決済セッション作成
// =====================================================

/**
 * 注文送信（決済フロー版）
 * - バリデーション・確保チェック・価格計算は同期で実行
 * - 商品を確保→依頼中に移行（決済完了まで予約）
 * - KOMOJU決済セッションを作成してURLを返す
 * - シート書き込み・メール送信は決済完了後（webhook経由）
 */
function apiSubmitEstimate(userKey, form, ids) {
  try {
    // === バリデーション ===
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    var f = form || {};
    var list = u_unique_(u_normalizeIds_(ids || []));
    var hasBulkItems = f.bulkItems && f.bulkItems.length > 0;
    if (!list.length && !hasBulkItems) return { ok: false, message: 'カートが空です' };

    // デタウリ最低注文数チェック（アソート併用時は1点〜、デタウリのみは5点〜）
    var minDetauri = hasBulkItems ? 1 : 5;
    if (list.length > 0 && list.length < minDetauri) {
      return { ok: false, message: 'デタウリ商品は' + minDetauri + '点以上で購入可能です（現在' + list.length + '点）' };
    }
    var companyName = String(f.companyName || '').trim();
    var contact = String(f.contact || '').trim();
    var contactMethod = String(f.contactMethod || '').trim();
    var delivery = String(f.delivery || '').trim();
    var postal = String(f.postal || '').trim();
    var address = String(f.address || '').trim();
    var phone = String(f.phone || '').trim();
    var note = String(f.note || '').trim();
    var measureOpt = String(f.measureOpt || 'with');
    var usePoints = Math.max(0, Math.floor(Number(f.usePoints || 0)));
    var couponCode = String(f.couponCode || '').trim();
    var paymentMethod = String(f.paymentMethod || '').trim();

    if (!companyName) return { ok: false, message: '会社名/氏名は必須です' };
    if (!contact) return { ok: false, message: 'メールアドレスは必須です' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, message: '有効なメールアドレスを入力してください' };
    if (!postal) return { ok: false, message: '郵便番号は必須です' };
    if (!address) return { ok: false, message: '住所は必須です' };
    if (!phone) return { ok: false, message: '電話番号は必須です' };
    // 郵便番号: 数字のみ7桁
    var postalClean = postal.replace(/[-ー\s]/g, '');
    if (!/^\d{7}$/.test(postalClean)) return { ok: false, message: '郵便番号は7桁の数字で入力してください' };
    // 電話番号: 数字のみ10-11桁、先頭0
    var phoneClean = phone.replace(/[-ー\s]/g, '');
    if (!/^0\d{9,10}$/.test(phoneClean)) return { ok: false, message: '電話番号の形式が正しくありません（10〜11桁）' };
    // クロスチェック
    if (/^\d{7}$/.test(phoneClean)) return { ok: false, message: '電話番号に郵便番号が入力されていませんか？' };
    if (/^0\d{9,10}$/.test(postalClean)) return { ok: false, message: '郵便番号に電話番号が入力されていませんか？' };
    // 住所: 数字（番地）を含むか
    if (!/\d/.test(address)) return { ok: false, message: '住所に番地が含まれていません' };

    // === 読み取り専用操作（ロック外で先に実行 → 高速化） ===
    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    // 商品データを先に読み込み（スプレッドシート読み取りは重いためロック外で実行）
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) productMap[String(products[i].managedId)] = products[i];

    // 商品存在チェック（ロック不要）— データ1に無い商品は売却済み等で除外済み
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var p = productMap[list[i]];
      if (!p) return { ok: false, message: '在庫がありません: ' + list[i] };
      sum += Number(p.price || 0);
    }

    // === アソートカート金額をサーバー側で再計算（改ざん防止） ===
    var bulkProductAmount = 0;
    var bulkShippingAmount = 0;
    var bulkItemCount = 0;
    if (hasBulkItems) {
      var bulkProducts = bulk_getProducts_();
      var bulkProductMap = {};
      for (var bi = 0; bi < bulkProducts.length; bi++) {
        bulkProductMap[bulkProducts[bi].productId] = bulkProducts[bi];
      }
      for (var bj = 0; bj < f.bulkItems.length; bj++) {
        var bItem = f.bulkItems[bj];
        var bPid = String(bItem.productId || '').trim();
        var bQty = Math.max(0, Math.floor(Number(bItem.qty) || 0));
        if (!bPid || bQty <= 0) continue;
        var bp = bulkProductMap[bPid];
        if (!bp) return { ok: false, message: 'アソート商品が見つかりません: ' + bPid };
        if (bp.soldOut) return { ok: false, message: bp.name + ' は売り切れです' };
        if (bQty < bp.minQty) return { ok: false, message: bp.name + ' は最低' + bp.minQty + bp.unit + 'から注文可能です' };
        if (bQty > bp.maxQty) return { ok: false, message: bp.name + ' は最大' + bp.maxQty + bp.unit + 'までです' };
        if (bp.stock !== -1 && bp.stock < bQty) return { ok: false, message: bp.name + ' の在庫が不足しています（残り' + bp.stock + '）' };
        var bUnitPrice = (bp.discountedPrice !== undefined) ? bp.discountedPrice : bp.price;
        bulkProductAmount += bUnitPrice * bQty;
        bulkItemCount += bQty;
      }
    }
    // === 価格計算（CartCalcと同じ順序: FHP → 数量割引 → 会員割引 → クーポン） ===
    var totalCount = list.length;
    var discountRate = 0;
    var memberDiscountRate = 0;
    var couponDiscount = 0;
    var couponLabel = '';
    var validatedCoupon = null;
    var firstHalfPriceApplied = false;

    // 初回全品半額キャンペーンチェック（他の割引と併用不可）
    // ログイン必須（フロントエンドと一致させるため）
    var isLoggedIn = !!f.loggedIn;
    var fhpStatus = app_getFirstHalfPriceStatus_();
    if (fhpStatus.enabled && isLoggedIn && contact && typeof findCustomerByEmail_ === 'function') {
      var custForFhp = findCustomerByEmail_(contact);
      if (custForFhp && custForFhp.purchaseCount === 0) {
        firstHalfPriceApplied = true;
        couponCode = '';
      }
    }

    // クーポン検証（割引額はまだ計算しない — 割引適用後に計算）
    if (!firstHalfPriceApplied && couponCode) {
      var couponResult = validateCoupon_(couponCode, contact, 'detauri', null, companyName);
      if (!couponResult.ok) return couponResult;
      validatedCoupon = couponResult;
      couponLabel = couponResult.type === 'rate'
        ? ('クーポン' + Math.round(couponResult.value * 100) + '%OFF')
        : couponResult.type === 'shipping_free'
          ? 'クーポン送料無料'
          : ('クーポン' + couponResult.value + '円引き');
    }

    // 数量割引レート取得（CartCalc step 3a — comboBulk !== false なら適用）
    if (!firstHalfPriceApplied) {
      var _comboBulkOk = !validatedCoupon || validatedCoupon.comboBulk !== false;
      if (_comboBulkOk) {
        if (totalCount >= 100) discountRate = 0.20;
        else if (totalCount >= 50) discountRate = 0.15;
        else if (totalCount >= 30) discountRate = 0.10;
        else if (totalCount >= 10) discountRate = 0.05;
      }
    }

    // 会員割引レート取得（CartCalc step 3b — comboMember !== false なら適用）
    // ログイン必須（フロントエンドと一致させるため）
    if (!firstHalfPriceApplied && isLoggedIn) {
      var _comboMemberOk = !validatedCoupon || validatedCoupon.comboMember !== false;
      if (_comboMemberOk) {
        var memberDiscountStatus = app_getMemberDiscountStatus_();
        if (memberDiscountStatus.enabled && contact && typeof findCustomerByEmail_ === 'function') {
          var custForDiscount = findCustomerByEmail_(contact);
          if (custForDiscount) {
            memberDiscountRate = memberDiscountStatus.rate;
          }
        }
      }
    }

    // === 割引適用（CartCalc step順: FHP → 数量割引 → 会員割引 → クーポン） ===
    var discounted;
    if (firstHalfPriceApplied) {
      var _fhpOnDetauri = Math.round(sum * fhpStatus.rate);
      var _fhpOnBulk = Math.round(bulkProductAmount * fhpStatus.rate);
      discounted = sum - _fhpOnDetauri;
      bulkProductAmount = Math.max(0, bulkProductAmount - _fhpOnBulk);
      couponLabel = '初回全品半額キャンペーン（' + Math.round(fhpStatus.rate * 100) + '%OFF）';
    } else {
      // 数量割引（デタウリのみ — CartCalc step 3a）
      discounted = discountRate > 0 ? Math.round(sum * (1 - discountRate)) : sum;
      // 会員割引を両チャネルに適用（CartCalc step 3b）
      if (memberDiscountRate > 0) {
        discounted = Math.round(discounted * (1 - memberDiscountRate));
        if (bulkProductAmount > 0) {
          bulkProductAmount = Math.round(bulkProductAmount * (1 - memberDiscountRate));
        }
      }
      // クーポン控除: 割引適用後の合算額に対して計算（CartCalc step 6）
      if (validatedCoupon && validatedCoupon.type !== 'shipping_free') {
        var combinedDiscounted = discounted + bulkProductAmount;
        couponDiscount = calcCouponDiscount_(validatedCoupon.type, validatedCoupon.value, combinedDiscounted);
      }
    }

    // === 送料計算（サーバー側で再計算 — 改ざん防止） ===
    var shippingPref = detectPrefecture_(address) || '';
    var shippingArea = shippingPref ? (SHIPPING_AREAS[shippingPref] || '') : '';
    var shippingSize = 'large';
    var shippingSizeLabel = '大';
    var shippingAmount = 0;

    if (list.length > 0 || hasBulkItems) {
      if (isRemoteIsland_(address)) {
        return { ok: false, message: '離島への配送は現在対応しておりません。' };
      }
      if (!shippingPref) {
        return { ok: false, message: '住所から都道府県を判別できません。住所を確認してください。' };
      }
    }

    // ダイヤモンド会員送料無料チェック
    var diamondFree = false;
    if (isLoggedIn && contact) {
      try {
        var rankInfo = calculateCustomerRank_(contact);
        diamondFree = rankInfo && rankInfo.freeShipping === true;
      } catch (e) { console.error('ランク取得エラー:', e); }
    }

    var shippingFreeCoupon = validatedCoupon && validatedCoupon.type === 'shipping_free';
    var thresholdFree = (discounted + bulkProductAmount) >= 10000;

    // 送料無料判定（CartCalcと同じ優先順序: ダイヤモンド > クーポン > 1万円以上 > 計算値）
    if (diamondFree) {
      shippingAmount = 0;
      bulkShippingAmount = 0;
    } else if (shippingFreeCoupon) {
      // デタウリ送料: クーポンで無料（CartCalc line 234と一致）
      shippingAmount = 0;
      // アソート送料: 送料除外商品は除外分のみ有料（CartCalc lines 262-268と一致）
      var excludeStr = validatedCoupon.shippingExcludeProducts || '';
      if (excludeStr && hasBulkItems && shippingArea && SHIPPING_RATES[shippingArea]) {
        var excludeIds = excludeStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(function(s) { return s; });
        var excludedBulkQty = 0;
        for (var bei = 0; bei < f.bulkItems.length; bei++) {
          var bePid = String(f.bulkItems[bei].productId || '').trim().toUpperCase();
          var beQty = Math.max(0, Math.floor(Number(f.bulkItems[bei].qty) || 0));
          for (var bex = 0; bex < excludeIds.length; bex++) {
            if (bePid === excludeIds[bex]) { excludedBulkQty += beQty; break; }
          }
        }
        bulkShippingAmount = (excludedBulkQty > 0) ? SHIPPING_RATES[shippingArea][1] * excludedBulkQty : 0;
      } else {
        bulkShippingAmount = 0;
      }
    } else if (thresholdFree) {
      shippingAmount = 0;
      bulkShippingAmount = 0;
    } else {
      if (list.length > 0 && shippingArea && SHIPPING_RATES[shippingArea]) {
        // 厚み分類→サイズ判定→料金計算（CartCalcと同一ロジック）
        var thick = 0, thin = 0;
        for (var si = 0; si < list.length; si++) {
          var sp = productMap[list[si]];
          if (sp && String(sp.shippingMethod || '').trim() === 'ゆうパケットポスト') thin++;
          else thick++;
        }
        var sz = calcShippingSize_sf_(thick, thin);
        if (!sz.size) {
          // 上限超過: 複数口計算
          var multi = calcMultiShipment_sf_(thick, thin, SHIPPING_RATES[shippingArea]);
          shippingAmount = multi.amount;
          shippingSize = 'multi';
          shippingSizeLabel = multi.sizeLabel;
        } else {
          shippingSize = sz.size;
          shippingSizeLabel = (sz.size === 'small') ? '小' : '大';
          shippingAmount = SHIPPING_RATES[shippingArea][(sz.size === 'small') ? 0 : 1];
        }
      }
      if (bulkItemCount > 0 && shippingArea && SHIPPING_RATES[shippingArea]) {
        bulkShippingAmount = SHIPPING_RATES[shippingArea][1] * bulkItemCount;
      }
    }

    // === ポイント利用額の事前計算（ロック不要） ===
    var pointsUsed = 0;
    var custForPoints = null;
    if (usePoints > 0 && contact && typeof findCustomerByEmail_ === 'function') {
      custForPoints = findCustomerByEmail_(contact);
      if (custForPoints && custForPoints.points >= usePoints) {
        pointsUsed = Math.min(usePoints, Math.max(0, discounted + shippingAmount + bulkProductAmount + bulkShippingAmount - couponDiscount));
        var _ptRem = pointsUsed;
        var pointsOnProduct = Math.min(_ptRem, discounted); _ptRem -= pointsOnProduct;
        var pointsOnShipping = Math.min(_ptRem, shippingAmount); _ptRem -= pointsOnShipping;
        var pointsOnBulkProd = Math.min(_ptRem, bulkProductAmount); _ptRem -= pointsOnBulkProd;
        var pointsOnBulkShip = Math.min(_ptRem, bulkShippingAmount);
        discounted -= pointsOnProduct;
        shippingAmount = Math.max(0, shippingAmount - pointsOnShipping);
        bulkProductAmount = Math.max(0, bulkProductAmount - pointsOnBulkProd);
        bulkShippingAmount = Math.max(0, bulkShippingAmount - pointsOnBulkShip);
      }
    }

    // === 割引・送料を備考に追記 ===
    if (firstHalfPriceApplied) {
      var fhpNote = '【' + couponLabel + '】';
      note = note ? (note + '\n' + fhpNote) : fhpNote;
    } else {
      var discountParts = [];
      if (couponCode && validatedCoupon) {
        if (validatedCoupon.type === 'shipping_free') {
          discountParts.push(couponLabel + ' コード: ' + couponCode);
        } else if (couponDiscount > 0) {
          discountParts.push(couponLabel + '（-' + couponDiscount + '円）コード: ' + couponCode);
        }
      }
      if (discountRate > 0) {
        discountParts.push('数量割引' + Math.round(discountRate * 100) + '%OFF');
      }
      if (memberDiscountRate > 0) {
        discountParts.push('会員割引' + Math.round(memberDiscountRate * 100) + '%OFF');
      }
      if (discountParts.length > 0) {
        var couponNote = '【' + discountParts.join(' + ') + '】';
        note = note ? (note + '\n' + couponNote) : couponNote;
      }
    }
    if (pointsUsed > 0) {
      if (note) {
        note += '\n【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
      } else {
        note = '【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
      }
    }
    if (shippingAmount > 0) {
      var shippingLabel = '【送料: ¥' + shippingAmount.toLocaleString() + '（' + (shippingPref || '') + '・' + shippingSizeLabel + '・税込）】';
      note = note ? (note + '\n' + shippingLabel) : shippingLabel;
    }

    // === アソートカートの金額を合算（両チャネル合算決済） ===
    var bulkTotal = bulkProductAmount + bulkShippingAmount;

    // 送料込みの合計金額（クーポンは合計レベルで控除 — CartCalc step 6と一致）
    var totalWithShipping = discounted + shippingAmount + bulkTotal - couponDiscount;

    if (bulkTotal > 0) {
      var bulkNote = '【アソート合算: 商品代¥' + bulkProductAmount + '（' + bulkItemCount + '点）+ 送料¥' + bulkShippingAmount + '】';
      note = note ? (note + '\n' + bulkNote) : bulkNote;
    }

    // === 受付番号生成 ===
    var receiptNo = u_makeReceiptNo_();
    var selectionList = u_sortManagedIds_(list).join('、');
    var measureLabel = app_measureOptLabel_(measureOpt);

    var invoiceReceipt = (f.invoiceReceipt === true || f.invoiceReceipt === 'true');

    var validatedForm = {
      companyName: companyName,
      contact: contact,
      contactMethod: contactMethod,
      delivery: delivery,
      postal: postal,
      address: address,
      phone: phone,
      note: note,
      measureOpt: measureOpt,
      invoiceReceipt: invoiceReceipt
    };

    var templateText = app_buildTemplateText_(receiptNo, validatedForm, list, totalCount, discounted);

    // === 確保チェック＆状態更新（ロック付き — 最小スコープ） ===
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) {
      return { ok: false, message: '現在混雑しています。少し時間を置いて再度お試しください。' };
    }

    try {

    var now = u_nowMs_();
    var openSet = st_getOpenSetFast_(orderSs) || {};
    var holdState = st_getHoldState_(orderSs) || {};
    var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    st_cleanupExpiredHolds_(holdItems, now);

    var bad = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (openSet[id]) {
        bad.push(id);
        continue;
      }
      var it = holdItems[id];
      if (it && u_toInt_(it.untilMs, 0) > now && String(it.userKey || '') !== uk) {
        bad.push(id);
        continue;
      }
    }
    if (bad.length) {
      return { ok: false, message: '確保できない商品が含まれています: ' + bad.join('、') };
    }

    // ポイント残高を差し引き（ロック内で実行 → 二重引き落とし防止）
    if (pointsUsed > 0 && contact) {
      deductPoints_(contact, pointsUsed);
    }

    // === 商品を確保中のまま維持（決済完了まで） ===
    // holdのuntilMsをKOMOJU決済期限（3日間）に延長し、pendingPaymentフラグを付与
    // 決済完了後に confirmPaymentAndCreateOrder() で holdState→openState に遷移する
    var paymentHoldMs = PAYMENT_CONSTANTS.PAYMENT_EXPIRY_SECONDS * 1000;
    for (var i = 0; i < list.length; i++) {
      holdItems[list[i]] = {
        holdId: uk + ':' + String(now),
        userKey: uk,
        untilMs: now + paymentHoldMs,
        createdAtMs: now,
        pendingPayment: true,
        receiptNo: receiptNo
      };
    }
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);
    st_invalidateStatusCache_(orderSs);

    } finally {
      lock.releaseLock();
    }

    // === 商品詳細リストを構築（メール・シート用） ===
    var itemDetails = [];
    for (var idx = 0; idx < list.length; idx++) {
      var pd = productMap[list[idx]];
      if (pd) {
        itemDetails.push({
          managedId: pd.managedId,
          noLabel: pd.noLabel || '',
          brand: pd.brand || '',
          category: pd.category || '',
          size: pd.size || '',
          color: pd.color || '',
          price: pd.price || 0
        });
      }
    }

    // === ペンディング注文データを保存（決済完了後にシート書き込み） ===
    var pendingData = {
      userKey: uk,
      form: validatedForm,
      ids: list,
      receiptNo: receiptNo,
      selectionList: selectionList,
      measureOpt: measureOpt,
      totalCount: totalCount,
      discounted: discounted,
      shippingAmount: shippingAmount,
      storeShipping: Math.round((shippingAmount + bulkShippingAmount) / 2) || 0,
      shippingSize: shippingSize,
      shippingArea: shippingArea,
      shippingPref: shippingPref,
      createdAtMs: now,
      templateText: templateText,
      itemDetails: itemDetails,
      pointsUsed: pointsUsed,
      couponCode: couponCode || '',
      couponDiscount: couponDiscount || 0,
      couponLabel: couponLabel || '',
      bulkProductAmount: bulkProductAmount,
      bulkShipping: bulkShippingAmount,
      bulkItemCount: bulkItemCount,
      totalAmount: totalWithShipping
    };

    var props = PropertiesService.getScriptProperties();
    props.setProperty('PENDING_ORDER_' + receiptNo, JSON.stringify(pendingData));
    console.log('ペンディング注文を保存: ' + receiptNo);

    // === KOMOJU決済セッションを作成 ===
    var komojuResult = apiCreateKomojuSession(receiptNo, totalWithShipping, {
      email: contact,
      companyName: companyName,
      phone: phone,
      postal: postal,
      address: address,
      productAmount: discounted + bulkProductAmount,
      shippingAmount: shippingAmount + bulkShippingAmount,
      shippingSize: shippingSize
    });

    if (!komojuResult || !komojuResult.ok) {
      // KOMOJU セッション作成失敗 → 商品を解放してエラー返却
      console.error('KOMOJU session creation failed:', komojuResult);
      apiCancelOrder(receiptNo);
      return {
        ok: false,
        message: '決済セッションの作成に失敗しました。' + (komojuResult && komojuResult.message ? komojuResult.message : '')
      };
    }

    console.log('KOMOJU決済セッション作成: ' + receiptNo + ' → ' + komojuResult.sessionUrl);

    // Paidy Session Pay API（Hosted Pageのshipping_address未送信を回避）
    var paidyRedirectUrl = null;
    if (paymentMethod === 'paidy' && komojuResult.sessionId) {
      var paidyResult = komojuSessionPayPaidy_(komojuResult.sessionId, contact, { line1: address, zip: postal });
      if (paidyResult.ok) {
        paidyRedirectUrl = paidyResult.redirectUrl;
      } else {
        console.warn('Paidy Session Pay失敗、Hosted Pageにフォールバック:', paidyResult.message);
      }
    }

    return {
      ok: true,
      receiptNo: receiptNo,
      sessionUrl: komojuResult.sessionUrl,
      paidyRedirectUrl: paidyRedirectUrl,
      totalAmount: totalWithShipping,
      shippingAmount: shippingAmount
    };

  } catch (e) {
    console.error('apiSubmitEstimate error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// _internalSavePendingOrder — Workers内部API
// Workers側でKOMOJUセッション作成後、GASにペンディング注文データを非同期保存
// =====================================================

/**
 * Workers → GAS 内部通信用（ADMIN_KEY認証済み）
 * - PENDING_ORDER_をPropertiesServiceに保存（webhookハンドラ互換性）
 * - holdStateをPropertiesServiceに更新（pendingPayment=true, until_ms延長）
 * - ポイントをSheetsから差し引き
 *
 * @param {object} pendingData - Workers側で構築したペンディング注文データ
 * @returns {object} { ok, message }
 */
function _internalSavePendingOrder(pendingData) {
  try {
    // paymentToken（新フロー）またはreceiptNo（旧フロー）でキー決定
    var pendingKey = (pendingData && (pendingData.paymentToken || pendingData.receiptNo)) || '';
    if (!pendingData || !pendingKey) {
      return { ok: false, message: 'pendingDataが不正です' };
    }

    var ids = pendingData.ids || [];
    var uk = pendingData.userKey || '';
    var contact = (pendingData.form && pendingData.form.contact) || '';
    var pointsUsed = pendingData.pointsUsed || 0;

    console.log('_internalSavePendingOrder: key=' + pendingKey + ', ids=' + ids.length + ', points=' + pointsUsed);

    // 1. PENDING_ORDER_をPropertiesServiceに保存（webhook互換）
    var props = PropertiesService.getScriptProperties();
    props.setProperty('PENDING_ORDER_' + pendingKey, JSON.stringify(pendingData));

    // 2. holdState更新（GAS側のPropertiesServiceベースの状態管理と同期）
    if (ids.length > 0) {
      var orderSs = sh_getOrderSs_();
      sh_ensureAllOnce_(orderSs);

      var lock = LockService.getScriptLock();
      if (lock.tryLock(30000)) {
        try {
          var now = u_nowMs_();
          var holdState = st_getHoldState_(orderSs) || {};
          var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};

          var paymentHoldMs = PAYMENT_CONSTANTS.PAYMENT_EXPIRY_SECONDS * 1000;
          for (var i = 0; i < ids.length; i++) {
            holdItems[ids[i]] = {
              holdId: uk + ':' + String(now),
              userKey: uk,
              untilMs: now + paymentHoldMs,
              createdAtMs: now,
              pendingPayment: true,
              receiptNo: pendingKey
            };
          }
          holdState.items = holdItems;
          holdState.updatedAt = now;
          st_setHoldState_(orderSs, holdState);
          st_invalidateStatusCache_(orderSs);
        } finally {
          lock.releaseLock();
        }
      } else {
        console.warn('_internalSavePendingOrder: holdState lock timeout (non-fatal)');
      }
    }

    // 3. ポイント差し引き
    if (pointsUsed > 0 && contact) {
      deductPoints_(contact, pointsUsed);
      console.log('_internalSavePendingOrder: deducted ' + pointsUsed + ' points from ' + contact);
    }

    // 4. PAYMENT_セッション保存（Workers版submitEstimate用: apiCheckPaymentStatusで必要）
    if (pendingData.komojuSessionId) {
      var paymentSessionData = {
        sessionId: pendingData.komojuSessionId,
        amount: pendingData.totalAmount || 0,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      savePaymentSession_(pendingKey, paymentSessionData);
      // 書き込み検証: PropertiesServiceへの保存を確認
      var verify = getPaymentSession_(pendingKey);
      if (!verify || !verify.sessionId) {
        console.warn('_internalSavePendingOrder: PAYMENT_保存検証失敗、リトライ');
        Utilities.sleep(300);
        savePaymentSession_(pendingKey, paymentSessionData);
      }
      console.log('_internalSavePendingOrder: saved PAYMENT_' + pendingKey + ' (sessionId=' + pendingData.komojuSessionId + ')');
    }

    console.log('_internalSavePendingOrder: saved PENDING_ORDER_' + pendingKey);
    return { ok: true, message: 'ペンディング注文を保存しました: ' + pendingKey };

  } catch (e) {
    console.error('_internalSavePendingOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// apiAdminLinkOrder — 管理者用: 既存受付番号に商品選択を紐付け
// =====================================================

/**
 * BASE注文で依頼管理に登録済みの受付番号に対し、
 * 管理者がサイトUIで選んだアソート商品を紐付ける。
 * - 依頼管理シートの選択リスト(J列)・合計点数(K列)を更新
 * - 選んだ商品をopenStateに登録
 * - 決済なし、メール通知なし
 *
 * @param {string} adminKey - 管理者認証キー
 * @param {string} receiptNo - 紐付け先の受付番号（BASE注文キー）
 * @param {string} userKey - フロントのuserKey
 * @param {string[]} ids - 選んだ商品の管理番号リスト
 */
function apiAdminLinkOrder(adminKey, receiptNo, userKey, ids) {
  try {
    console.log('apiAdminLinkOrder: adminKey=' + (adminKey ? 'present(' + String(adminKey).length + 'chars)' : 'empty') +
      ', receiptNo=' + receiptNo + ', userKey=' + (userKey ? 'present' : 'empty') + ', ids=' + (ids ? ids.length : 'null'));
    ad_requireAdmin_(adminKey);

    var rn = String(receiptNo || '').trim();
    if (!rn) return { ok: false, message: '受付番号を入力してください' };

    var uk = String(userKey || '').trim();

    var list = u_unique_(u_normalizeIds_(ids || []));
    if (!list.length) return { ok: false, message: 'カートが空です' };

    // === 依頼管理シートで受付番号の行を検索 ===
    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    var reqSh = sh_ensureRequestSheet_(orderSs);
    var lastRow = reqSh.getLastRow();

    if (lastRow < 2) return { ok: false, message: '依頼管理にデータがありません' };

    // A列（受付番号）を全行読み込んで対象行を検索
    var receiptCol = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    var targetRow = -1;
    for (var r = 0; r < receiptCol.length; r++) {
      if (String(receiptCol[r][0]).trim() === rn) {
        targetRow = r + 2; // 1-based, ヘッダ行分を加算
        break;
      }
    }
    if (targetRow === -1) {
      return { ok: false, message: '受付番号「' + rn + '」が依頼管理に見つかりません' };
    }

    // === 商品存在チェック ===
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) productMap[String(products[i].managedId)] = products[i];

    for (var i = 0; i < list.length; i++) {
      if (!productMap[list[i]]) {
        return { ok: false, message: '商品が見つかりません: ' + list[i] };
      }
    }

    // === 確保チェック＆状態更新（ロック付き） ===
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) {
      return { ok: false, message: '現在混雑しています。少し時間を置いて再度お試しください。' };
    }

    try {

    var now = u_nowMs_();
    var openSet = st_getOpenSetFast_(orderSs) || {};
    var holdState = st_getHoldState_(orderSs) || {};
    var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    st_cleanupExpiredHolds_(holdItems, now);

    var bad = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (openSet[id]) {
        bad.push(id);
        continue;
      }
      var it = holdItems[id];
      if (it && u_toInt_(it.untilMs, 0) > now && String(it.userKey || '') !== uk) {
        bad.push(id);
        continue;
      }
    }
    if (bad.length) {
      return { ok: false, message: '確保できない商品が含まれています: ' + bad.join('、') };
    }

    // holdから削除
    for (var i = 0; i < list.length; i++) {
      delete holdItems[list[i]];
    }
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);

    // openStateに追加
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    for (var i = 0; i < list.length; i++) {
      openItems[list[i]] = {
        receiptNo: rn,
        userKey: uk,
        status: APP_CONFIG.statuses.open,
        createdAtMs: now
      };
    }
    openState.items = openItems;
    openState.updatedAt = now;
    st_setOpenState_(orderSs, openState);

    } finally {
      lock.releaseLock();
    }

    // === 依頼管理シートを更新 ===
    var selectionList = u_sortManagedIds_(list).join('、');

    // J列(10): 選択リスト
    reqSh.getRange(targetRow, 10).setValue(selectionList);
    // K列(11): 合計点数
    reqSh.getRange(targetRow, 11).setValue(list.length);
    // AF列(32): 更新日時
    reqSh.getRange(targetRow, 32).setValue(new Date(now));

    // キャッシュ無効化
    st_invalidateStatusCache_(orderSs);

    console.log('Admin link order: receipt=' + rn + ', items=' + list.length + ', selection=' + selectionList);

    return {
      ok: true,
      receiptNo: rn,
      itemCount: list.length,
      message: '受付番号「' + rn + '」に' + list.length + '点の商品を紐付けました'
    };

  } catch (e) {
    console.error('apiAdminLinkOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// バックグラウンド書き込み処理（レガシー互換）
// =====================================================

function processSubmitQueue() {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      console.log('ロック取得失敗、次回に持ち越し');
      return;
    }
    var props = PropertiesService.getScriptProperties();
    var queueStr = props.getProperty('SUBMIT_QUEUE');
    if (!queueStr) { lock.releaseLock(); return; }
    var queue = JSON.parse(queueStr);
    if (!queue || queue.length === 0) { lock.releaseLock(); return; }
    lock.releaseLock();
    var allSuccess = true;
    var failedItems = [];
    for (var i = 0; i < queue.length; i++) {
      var data = queue[i];
      try {
        writeSubmitData_(data);
        console.log('書き込み完了: ' + data.receiptNo);
      } catch (e) {
        console.error('書き込みエラー: ' + data.receiptNo, e);
        allSuccess = false;
        failedItems.push(data);
      }
    }
    if (allSuccess) {
      props.deleteProperty('SUBMIT_QUEUE');
    } else if (failedItems.length > 0) {
      try {
        props.setProperty('SUBMIT_QUEUE', JSON.stringify(failedItems));
      } catch (requeueErr) {
        props.deleteProperty('SUBMIT_QUEUE');
      }
    }
  } catch (e) {
    console.error('processSubmitQueue error:', e);
    try { lock.releaseLock(); } catch (x) { console.log('optional: lock release: ' + (x.message || x)); }
  } finally {
    cleanupTriggers_('processSubmitQueue');
  }
}

// =====================================================
// シート書き込み（決済完了後に呼ばれる）
// =====================================================

/**
 * 注文データを依頼管理シートに書き込み、メール通知を送信
 * confirmPaymentAndCreateOrder() から呼ばれる
 * @param {object} data - 注文データ
 */
function writeSubmitData_(data) {
  var orderSs = sh_getOrderSs_();
  sh_ensureAllOnce_(orderSs);

  var now = data.createdAtMs || u_nowMs_();

  // 1. 依頼管理シートに書き込み
  // 列構成（33列 A-AG）:
  // A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=送料(店負担), N=送料(客負担), O=決済方法, P=決済ID,
  // Q=入金確認, R=ポイント付与済, S=発送ステータス, T=配送業者, U=伝票番号, V=ステータス, W=担当者,
  // X=リスト同梱, Y=xlsx送付, Z=インボイス発行, AA=インボイス状況, AB=受注通知,
  // AC=発送通知, AD=備考, AE=作業報酬, AF=更新日時, AG=チャネル
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var productNames = data.productNames || '選べるxlsx付きパッケージ';
  if (productNames.indexOf('\n') !== -1) {
    productNames = productNames.split('\n').map(function(s) { return '・' + s; }).join('\n');
  } else if (productNames.indexOf('、') !== -1) {
    productNames = productNames.split('、').map(function(s) { return '・' + s.trim(); }).join('\n');
  } else {
    productNames = '・' + productNames;
  }
  var channel = data.channel || 'デタウリ';
  var paymentStatus = data.paymentStatus || '対応済';
  // アソート商品の場合、選択リスト/合計点数の扱いが異なる
  var selectionList = data.selectionList || (data.ids ? data.ids.join('、') : '');
  var totalCount = data._sheetTotalCount || calcTotalCountFromProductNames_(productNames) || data.totalCount || (data.ids ? data.ids.length : 0);
  var confirmLink = (channel === 'デタウリ' || data._hasManagedIds) ? createOrderConfirmLink_(data.receiptNo, data) : '';
  var row = [
    data.receiptNo,                              // A: 受付番号
    new Date(now),                               // B: 依頼日時
    data.form.companyName || '',                 // C: 会社名/氏名
    data.form.contact || '',                     // D: 連絡先
    data.form.postal || '',                      // E: 郵便番号
    data.form.address || '',                     // F: 住所
    data.form.phone || '',                       // G: 電話番号
    productNames,                                // H: 商品名
    confirmLink,                                 // I: 確認リンク
    selectionList,                               // J: 選択リスト
    totalCount,                                  // K: 合計点数
    data.discounted || 0,                        // L: 合計金額
    data.storeShipping || '',                     // M: 送料(店負担)
    data.shippingAmount || '',                   // N: 送料(客負担)
    data.paymentMethod ? getPaymentMethodDisplayName_(data.paymentMethod) : '',  // O: 決済方法（日本語表示名）
    data.paymentId || '',                        // P: 決済ID
    paymentStatus,                               // Q: 入金確認
    '',                                          // R: ポイント付与済
    '未着手',                                     // S: 発送ステータス
    '',                                          // T: 配送業者
    '',                                          // U: 伝票番号
    APP_CONFIG.statuses.open,                    // V: ステータス
    '',                                          // W: 担当者
    '未',                                         // X: リスト同梱
    '未',                                         // Y: xlsx送付
    data.form.invoiceReceipt ? '希望' : '',      // Z: インボイス発行
    '',                                          // AA: インボイス状況
    paymentStatus === '入金待ち' ? '' : false,     // AB: 受注通知（入金待ちは空白、入金済みはFALSE）
    '',                                          // AC: 発送通知
    data.form.note || '',                        // AD: 備考
    '',                                          // AE: 作業報酬
    new Date(now),                               // AF: 更新日時
    channel,                                     // AG: チャネル
    '',                                          // AH: 追跡URL
    (function() {                                // AI: 商品単価JSON（注文時価格）
      var pm = {};
      (data.itemDetails || []).forEach(function(it) {
        if (it.managedId) pm[it.managedId] = it.price || 0;
      });
      return JSON.stringify(pm);
    })()
  ];
  var writeRow = sh_findNextRowByDisplayKey_(reqSh, 1, 1);
  reqSh.getRange(writeRow, 1, 1, row.length).setValues([row]);

  // 2. hold/openログシートの同期
  var holdState = st_getHoldState_(orderSs) || {};
  var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
  if (APP_CONFIG.holds && APP_CONFIG.holds.syncHoldSheet) {
    od_writeHoldSheetFromState_(orderSs, holdItems, now);
  }

  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  od_writeOpenLogSheetFromState_(orderSs, openItems, now);

  // 3. 管理者宛注文通知メール（skipNotify時はスキップ）
  if (data.skipNotify) return;
  app_sendOrderNotifyMail_(orderSs, data.receiptNo, {
    companyName: data.form.companyName || '',
    contact: data.form.contact || '',
    contactMethod: data.form.contactMethod || '',
    delivery: data.form.delivery || '',
    postal: data.form.postal || '',
    address: data.form.address || '',
    phone: data.form.phone || '',
    note: data.form.note || '',
    measureLabel: data.measureLabel || '',
    totalCount: data.totalCount || (data.ids ? data.ids.length : 0),
    discounted: data.discounted || 0,
    selectionList: data.selectionList || (data.ids ? data.ids.join('、') : ''),
    itemDetails: data.itemDetails || [],
    writeRow: writeRow,
    createdAtMs: now,
    userKey: data.userKey,
    templateText: data.templateText || '',
    paymentMethod: data.paymentMethod || '',
    paymentId: data.paymentId || '',
    paymentStatus: paymentStatus
  });

  // 4. 顧客宛注文確認メール（決済完了通知）
  app_sendOrderConfirmToCustomer_(data);

}

/**
 * トリガーをクリーンアップ
 */
function cleanupTriggers_(functionName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

// =====================================================
// ヘルパー関数
// =====================================================

/**
 * 実データがある最終行を取得（空行をスキップ）
 */
function getActualLastRow_(sheet, column) {
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return 0;

  var values = sheet.getRange(1, column, lastRow, 1).getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== '' && values[i][0] !== null && values[i][0] !== undefined) {
      return i + 1;
    }
  }

  return 0;
}

// =====================================================
// テスト用リフレッシュ関数
// =====================================================

function refreshLatestSubmission() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('依頼管理');
  if (!sheet) { console.log('依頼管理シートが見つかりません'); return; }
  var lastRow = getActualLastRow_(sheet, 1);
  if (lastRow < 2) { console.log('依頼データがありません'); return; }
  var rowData = sheet.getRange(lastRow, 1, 1, 15).getValues()[0];
  var receiptNo = rowData[1];
  var idsStr = rowData[12];
  var userKey = rowData[13];
  var ids = idsStr ? String(idsStr).split(',').map(function(s) { return s.trim(); }) : [];
  console.log('リフレッシュ対象:');
  console.log('  受付番号: ' + receiptNo);
  console.log('  userKey: ' + userKey);
  console.log('  商品数: ' + ids.length);
  var holdCleared = clearHoldSheetForRefresh_(ss, userKey, ids);
  var statusReset = resetProductStatusForRefresh_(ss, ids);
  sheet.deleteRow(lastRow);
  console.log('='.repeat(50));
  console.log('リフレッシュ完了');
  console.log('確保クリア: ' + holdCleared + '件');
  console.log('ステータスリセット: ' + statusReset + '件');
  console.log('依頼管理から削除: 1件');
  console.log('='.repeat(50));
}

// =====================================================
// キュー関連（デバッグ用）
// =====================================================

function processQueueManually() { processSubmitQueue(); }

function clearSubmitQueue() {
  PropertiesService.getScriptProperties().deleteProperty('SUBMIT_QUEUE');
  console.log('キューをクリアしました');
}

function resetAllOpenState() {
  var orderSs = sh_getOrderSs_();
  st_setOpenState_(orderSs, { items: {}, updatedAt: u_nowMs_() });
  var sh = sh_ensureOpenLogSheet_(orderSs);
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  st_invalidateStatusCache_(orderSs);
  console.log('依頼中状態を全リセットしました');
}

function cancelByReceiptNo(receiptNo) {
  if (!receiptNo) { console.log('受付番号を指定してください'); return; }
  var orderSs = sh_getOrderSs_();
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  var removed = [];
  for (var id in openItems) {
    if (openItems[id] && String(openItems[id].receiptNo || '') === String(receiptNo)) {
      removed.push(id); delete openItems[id];
    }
  }
  if (removed.length === 0) { console.log('受付番号 ' + receiptNo + ' に該当する依頼中商品はありません'); return; }
  openState.items = openItems;
  openState.updatedAt = u_nowMs_();
  st_setOpenState_(orderSs, openState);
  od_writeOpenLogSheetFromState_(orderSs, openItems, u_nowMs_());
  st_invalidateStatusCache_(orderSs);
  console.log('受付番号 ' + receiptNo + ' の依頼中を取り消しました（' + removed.length + '点）');
  console.log('対象: ' + removed.join('、'));
}

function apiRefreshOpenState() {
  try {
    var orderSs = sh_getOrderSs_();
    var openState = od_rebuildOpenStateFromRequestSheet_(orderSs);
    st_setOpenState_(orderSs, openState);
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    od_writeOpenLogSheetFromState_(orderSs, openItems, u_nowMs_());
    st_invalidateStatusCache_(orderSs);
    var count = Object.keys(openItems).length;
    return { ok: true, message: '依頼中を再構築しました（' + count + '件）' };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

function viewSubmitQueue() {
  var props = PropertiesService.getScriptProperties();
  var queueStr = props.getProperty('SUBMIT_QUEUE');
  if (!queueStr) { console.log('キューは空です'); return; }
  var queue = JSON.parse(queueStr);
  console.log('キュー内容: ' + queue.length + '件');
  for (var i = 0; i < queue.length; i++) {
    console.log('  ' + (i + 1) + '. ' + queue[i].receiptNo + ' (' + queue[i].ids.length + '点)');
  }
}

function getProductNamesFromIds_(ids) {
  if (!ids || !ids.length) return '';
  try {
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) productMap[String(products[i].managedId)] = products[i];
    var names = [];
    for (var i = 0; i < ids.length; i++) {
      var p = productMap[String(ids[i])];
      if (p && p.brand) { names.push(p.brand + (p.category ? ' ' + p.category : '')); }
      else { names.push(ids[i]); }
    }
    return names.join('、');
  } catch (e) {
    console.error('getProductNamesFromIds_ error:', e);
    return ids.join('、');
  }
}

// =====================================================
// 決済完了後に注文を確定（KOMOJU webhookから呼び出す）
// =====================================================

/**
 * 決済完了後に注文を確定
 * - ペンディング注文データを取得
 * - 依頼管理シートにデータを書き込み
 * - 注文確認メールを送信
 * @param {string} receiptNo - 受付番号
 * @param {string} paymentStatus - 入金ステータス（'対応済' | '入金待ち'）
 * @param {string} paymentMethod - 決済方法（'credit_card' | 'konbini' | 'bank_transfer'）
 * @param {string} paymentId - KOMOJU決済ID
 * @returns {object} - { ok, message }
 */
function confirmPaymentAndCreateOrder(paymentToken, paymentStatus, paymentMethod, paymentId) {
  try {
    if (!paymentToken) {
      return { ok: false, message: '決済トークンが必要です' };
    }

    // === ロックを取得して二重登録を防止 ===
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(120000)) {
      console.warn('confirmPaymentAndCreateOrder: ロック取得失敗: ' + paymentToken);
      return { ok: false, message: '処理中です。しばらくお待ちください。' };
    }

    try {

    var props = PropertiesService.getScriptProperties();
    var pendingKey = 'PENDING_ORDER_' + paymentToken;
    var pendingDataStr = props.getProperty(pendingKey);

    if (!pendingDataStr) {
      console.log('PENDING_ORDER not found in PropertiesService: ' + paymentToken + ' → D1バックアップを確認');

      // === フォールバック2: D1バックアップから取得 ===
      var d1Result = fetchPendingFromD1_(paymentToken);
      if (d1Result && d1Result.found) {
        if (d1Result.consumed === 1) {
          // D1で見つかりconsumed=1 → 既にシート書き込み済み → ステータスのみ更新
          console.log('D1 pending found but already consumed: ' + paymentToken);
          updateOrderPaymentStatus_(paymentToken, 'paid', paymentMethod);
          return { ok: true, message: '入金ステータスを更新しました（D1 consumed済み）' };
        }
        // D1で見つかりconsumed=0 → PropertiesServiceに復元して通常フロー継続
        console.log('D1 backup found, restoring to PropertiesService: ' + paymentToken);
        pendingDataStr = d1Result.data;
        props.setProperty(pendingKey, pendingDataStr);
      } else {
        // === フォールバック3: KOMOJUメタデータから「要確認」行を作成 ===
        console.warn('D1 backup not found either: ' + paymentToken + ' → KOMOJUメタデータから要確認行を作成');
        var minimalResult = createMinimalOrderRow_(paymentToken, paymentStatus, paymentMethod, paymentId);
        return minimalResult;
      }
    }

    // ペンディングデータをパース（削除はシート書き込み成功後に行う）
    var pendingData = JSON.parse(pendingDataStr);
    var isBulk = pendingData.channel === 'アソート' || pendingData.channel === 'まとめ';
    console.log('Found pending order: ' + paymentToken + (isBulk ? ' (アソート)' : '') + ', items: ' + (pendingData.ids ? pendingData.ids.length : pendingData.totalCount));

    // === 受付番号の決定: UUID（新フロー）なら新規生成、旧形式ならそのまま ===
    var receiptNo;
    if (paymentToken.length === 36 && paymentToken.indexOf('-') > 4) {
      receiptNo = u_makeReceiptNo_();  // 新フロー: 決済確認後に正式な受付番号を生成
    } else {
      receiptNo = paymentToken;  // 旧フロー: 受付番号がそのまま使われている（後方互換）
    }
    pendingData.receiptNo = receiptNo;
    console.log('受付番号決定: token=' + paymentToken + ' → receiptNo=' + receiptNo);

    var orderSs = sh_getOrderSs_();
    var now = u_nowMs_();

    // --- プレミアムアソート自動選定 + デタウリ合算ID統合 ---
    var detauriIds = pendingData.detauriIds || [];
    var premiumSpec = isBulk ? detectPremiumAssort_(pendingData.orderItems) : null;
    var allIds = [];

    if (premiumSpec) {
      var selection = selectProductsForPremiumAssort_(
        premiumSpec.targetAmount, premiumSpec.minCount, premiumSpec.maxCount, orderSs, detauriIds
      );
      allIds = allIds.concat(selection.ids);
      console.log('プレミアムアソート自動選定: target=¥' + premiumSpec.targetAmount
        + ' selected=¥' + selection.total + ' items=' + selection.ids.length);
    }

    if (detauriIds.length > 0) {
      allIds = allIds.concat(detauriIds);
    }

    if (allIds.length > 0) {
      // K列用: アソート数量はそのまま、デタウリ合算は1として加算
      pendingData._sheetTotalCount = (pendingData.totalCount || 0) + (detauriIds.length > 0 ? 1 : 0);
      pendingData.ids = allIds;
      pendingData.selectionList = u_sortManagedIds_(allIds).join('、');
      pendingData.totalCount = allIds.length;
      pendingData._hasManagedIds = true;
    } else if (!isBulk && pendingData.ids && pendingData.ids.length > 0) {
      // デタウリ単体注文: 管理番号が何点あってもK列は1
      pendingData._sheetTotalCount = 1;
    }

    // 1. holdState → openState に遷移（決済完了で確定）
    // ※アソート商品は個品の確保/依頼中管理が不要なのでスキップ（プレミアムアソート・デタウリ合算は除く）
    if ((!isBulk || pendingData._hasManagedIds) && pendingData.ids && pendingData.ids.length > 0) {
      // 1a. holdStateから商品を削除（確保中 解除）
      var holdState = st_getHoldState_(orderSs) || {};
      var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
      for (var i = 0; i < pendingData.ids.length; i++) {
        delete holdItems[pendingData.ids[i]];
      }
      holdState.items = holdItems;
      holdState.updatedAt = now;
      st_setHoldState_(orderSs, holdState);

      // 1b. openStateに商品を追加（依頼中として確定）
      var openState = st_getOpenState_(orderSs) || {};
      var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
      for (var i = 0; i < pendingData.ids.length; i++) {
        openItems[pendingData.ids[i]] = {
          receiptNo: receiptNo,
          userKey: pendingData.userKey,
          status: APP_CONFIG.statuses.open,
          createdAtMs: now
        };
      }
      openState.items = openItems;
      openState.updatedAt = now;
      st_setOpenState_(orderSs, openState);
    }

    // 2. シートレベルの重複チェック（最終安全弁 — ロック・PENDING_ORDER_削除で防げないケース対策）
    var reqSh = sh_ensureRequestSheet_(orderSs);
    var shLastRow = reqSh.getLastRow();
    if (shLastRow >= 2) {
      var existingReceipts = reqSh.getRange(2, 1, shLastRow - 1, 1).getDisplayValues();
      for (var k = 0; k < existingReceipts.length; k++) {
        if (String(existingReceipts[k][0]).trim() === String(receiptNo).trim()) {
          console.warn('confirmPaymentAndCreateOrder: 受付番号が既にシートに存在するため書き込みスキップ: ' + receiptNo);
          return { ok: true, message: '既に登録済みです' };
        }
      }
    }

    // 3. templateTextの先頭に受付番号を挿入（新フローでは決済前に受付番号がない）
    var templateText = pendingData.templateText || '';
    if (templateText.indexOf('受付番号：') === -1) {
      templateText = '受付番号：' + receiptNo + '\n' + templateText;
    }

    // 決済情報を付与してシート書き込み + メール送信
    var writeData = {
      userKey: pendingData.userKey,
      form: pendingData.form,
      ids: pendingData.ids || [],
      receiptNo: receiptNo,
      selectionList: pendingData.selectionList || '',
      measureOpt: pendingData.measureOpt,
      totalCount: pendingData.totalCount,
      discounted: pendingData.discounted,
      shippingAmount: pendingData.shippingAmount,
      storeShipping: pendingData.storeShipping || 0,
      shippingSize: pendingData.shippingSize,
      shippingArea: pendingData.shippingArea,
      shippingPref: pendingData.shippingPref,
      createdAtMs: now,
      templateText: templateText,
      measureLabel: app_measureOptLabel_(pendingData.measureOpt),
      paymentStatus: paymentStatus || '未対応',
      paymentMethod: paymentMethod || '',
      paymentId: paymentId || '',
      itemDetails: pendingData.itemDetails || [],
      pointsUsed: pendingData.pointsUsed || 0,
      channel: pendingData.channel || 'デタウリ',
      productNames: pendingData.productNames || '',
      _hasManagedIds: pendingData._hasManagedIds || false,
      _sheetTotalCount: pendingData._sheetTotalCount || 0
    };

    writeSubmitData_(writeData);
    console.log('Order written to sheet: ' + receiptNo);

    // 3.1. 購入回数を+1（初回半額の判定に使用）
    var _pcEmail = pendingData.form && pendingData.form.contact;
    if (_pcEmail) {
      try {
        incrementPurchaseCount_(String(_pcEmail).trim().toLowerCase());
        console.log('購入回数+1: ' + _pcEmail);
      } catch (pcErr) {
        console.error('購入回数更新エラー:', pcErr);
      }
    }

    // シート書き込み成功後にペンディングキーを削除（書き込み前に削除すると例外時にデータ消失するため）
    props.deleteProperty(pendingKey);
    console.log('Deleted pending key after successful write: ' + paymentToken + ' → ' + receiptNo);

    // D1バックアップのconsumedフラグを立てる（非致命的）
    try {
      markD1PendingConsumed_(paymentToken);
    } catch (d1MarkErr) {
      console.error('markD1PendingConsumed_ error (non-fatal):', d1MarkErr);
    }

    // 3.5. クーポン利用を記録
    if (pendingData.couponCode) {
      try {
        recordCouponUsage_(pendingData.couponCode, pendingData.form.contact, receiptNo);
        console.log('クーポン利用記録: ' + pendingData.couponCode + ' / ' + receiptNo);
      } catch (couponErr) {
        console.error('クーポン利用記録エラー:', couponErr);
      }
    }

    // 3.6. アソート注文のポイント控除（決済完了後に実施）
    if (isBulk && pendingData.pointsUsed > 0) {
      var ptEmail = pendingData.form && pendingData.form.contact;
      if (ptEmail) {
        try {
          deductPoints_(ptEmail, pendingData.pointsUsed);
          console.log('アソートポイント控除: ' + pendingData.pointsUsed + 'pt / ' + ptEmail);
        } catch (ptErr) {
          console.error('アソートポイント控除エラー:', ptErr);
        }
      }
    }

    // 4. プレミアムアソート → 依頼展開を自動実行
    if (premiumSpec && pendingData.ids && pendingData.ids.length > 0) {
      try {
        var _orderSsId = app_getOrderSpreadsheetId_();
        om_executeFullPipeline_([receiptNo], 'プレミアムアソート自動展開', { silent: true, orderSsId: _orderSsId });
        console.log('プレミアムアソート自動展開完了: ' + receiptNo);
      } catch (expandErr) {
        console.error('プレミアムアソート自動展開エラー（非致命的）:', expandErr);
      }
    }

    // 5. キャッシュを無効化
    st_invalidateStatusCache_(orderSs);

    return {
      ok: true,
      message: '注文を確定しました',
      receiptNo: receiptNo,
      paymentToken: paymentToken,
      movedCount: pendingData.ids ? pendingData.ids.length : (pendingData.totalCount || 0)
    };

    } finally {
      lock.releaseLock();
    }

  } catch (e) {
    console.error('confirmPaymentAndCreateOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// 注文キャンセル（決済失敗・キャンセル時）
// =====================================================

/**
 * 注文をキャンセル
 * - open状態から商品を解除（在庫を解放）
 * - hold状態からも念のため解除
 * - ペンディング注文データを削除
 * - ポイントが使用されていた場合は返還
 * @param {string} receiptNo - 受付番号または決済トークン
 * @returns {object} - { ok, message }
 */
function apiCancelOrder(receiptNo) {
  try {
    if (!receiptNo) {
      return { ok: false, message: '受付番号が必要です' };
    }

    var orderSs = sh_getOrderSs_();
    var now = u_nowMs_();
    var props = PropertiesService.getScriptProperties();

    // 1. ペンディング注文データを取得して商品IDを特定
    var pendingKey = 'PENDING_ORDER_' + receiptNo;
    var pendingDataStr = props.getProperty(pendingKey);
    var idsToRelease = [];
    var pointsToRefund = 0;
    var refundEmail = '';

    if (pendingDataStr) {
      try {
        var pendingData = JSON.parse(pendingDataStr);
        idsToRelease = pendingData.ids || [];
        pointsToRefund = pendingData.pointsUsed || 0;
        refundEmail = (pendingData.form && pendingData.form.contact) || '';
      } catch (pe) {
        console.error('Failed to parse pending data:', pe);
      }
    }

    // 2. open状態から該当受付番号の商品を解除
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    var removedFromOpen = [];

    if (idsToRelease.length > 0) {
      for (var i = 0; i < idsToRelease.length; i++) {
        var id = idsToRelease[i];
        if (openItems[id] && String(openItems[id].receiptNo || '') === String(receiptNo)) {
          removedFromOpen.push(id);
          delete openItems[id];
        }
      }
    } else {
      for (var openId in openItems) {
        if (openItems[openId] && String(openItems[openId].receiptNo || '') === String(receiptNo)) {
          removedFromOpen.push(openId);
          delete openItems[openId];
        }
      }
    }

    if (removedFromOpen.length > 0) {
      openState.items = openItems;
      openState.updatedAt = now;
      st_setOpenState_(orderSs, openState);
      od_writeOpenLogSheetFromState_(orderSs, openItems, now);
    }

    // 3. hold状態からも念のため解除
    var holdState = st_getHoldState_(orderSs) || {};
    var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    var removedFromHold = [];

    if (idsToRelease.length > 0) {
      for (var j = 0; j < idsToRelease.length; j++) {
        if (holdItems[idsToRelease[j]]) {
          removedFromHold.push(idsToRelease[j]);
          delete holdItems[idsToRelease[j]];
        }
      }
    }

    if (removedFromHold.length > 0) {
      holdState.items = holdItems;
      holdState.updatedAt = now;
      st_setHoldState_(orderSs, holdState);
    }

    // 4. ポイント返還
    if (pointsToRefund > 0 && refundEmail) {
      try {
        addPoints_(refundEmail, pointsToRefund);
        console.log('ポイント返還: ' + refundEmail + ' +' + pointsToRefund + 'pt');
      } catch (ptErr) {
        console.error('ポイント返還失敗:', ptErr);
      }
    }

    // 5. ペンディング注文データを削除
    if (pendingDataStr) {
      props.deleteProperty(pendingKey);
      console.log('Deleted pending order: ' + receiptNo);
    }

    // 6. 決済セッション情報も削除
    try { props.deleteProperty('PAYMENT_' + receiptNo); } catch (e) { console.log('optional: delete payment session: ' + (e.message || e)); }

    // 7. キャッシュを無効化
    st_invalidateStatusCache_(orderSs);

    var totalReleased = removedFromOpen.length + removedFromHold.length;
    console.log('Cancelled order ' + receiptNo + ', released ' + totalReleased + ' items');

    return { ok: true, message: 'キャンセルしました', releasedCount: totalReleased };
  } catch (e) {
    console.error('apiCancelOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}


// =====================================================
// 注文確認用 Google Drive 共有リンク生成
// =====================================================

/**
 * 注文確認用スプレッドシートをDriveに作成し、共有リンクを返す
 */
function createOrderConfirmLink_(receiptNo, data) {
  try {
    if (!receiptNo || !data) return '';

    var form = data.form || {};
    var ids = data.ids || [];
    var datetime = new Date(data.createdAtMs || Date.now());
    var dateStr = Utilities.formatDate(datetime, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    var ss = SpreadsheetApp.create('注文明細_' + receiptNo);
    var sheet = ss.getActiveSheet();
    sheet.setName('注文明細');

    var headerRows = [
      ['デタウリ.Detauri - ご注文明細'],
      [''],
      ['受付番号', receiptNo],
      ['注文日時', dateStr],
      ['会社名/氏名', form.companyName || ''],
      ['合計点数', String(ids.length) + '点'],
      ['合計金額', String(Number(data.discounted || 0).toLocaleString()) + '円（税込・送料込）'],
      [''],
      ['■ 選択商品一覧'],
      ['No.', '管理番号']
    ];

    for (var i = 0; i < ids.length; i++) {
      headerRows.push([i + 1, ids[i]]);
    }

    headerRows.push(['']);
    headerRows.push(['※ このシートは閲覧専用です。']);
    headerRows.push(['※ ご不明点はお問い合わせください: ' + SITE_CONSTANTS.CONTACT_EMAIL]);

    sheet.getRange(1, 1, headerRows.length, 2).setValues(headerRows);

    sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
    sheet.getRange(10, 1, 1, 2).setFontWeight('bold').setBackground('#f0f0f0');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 200);

    var protection = sheet.protect().setDescription('注文明細（閲覧専用）');
    protection.setWarningOnly(true);

    var file = DriveApp.getFileById(ss.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    try {
      if (typeof EXPORT_FOLDER_ID !== 'undefined' && EXPORT_FOLDER_ID) {
        var folder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      }
    } catch (moveErr) {
      console.warn('フォルダ移動スキップ: ' + (moveErr.message || moveErr));
    }

    var url = ss.getUrl();
    console.log('注文確認リンク作成: ' + receiptNo + ' → ' + url);
    return url;

  } catch (e) {
    console.error('createOrderConfirmLink_ error:', e);
    return '';
  }
}

/**
 * H列の商品名テキストから合計点数を算出する
 * 「選べるxlsx付きパッケージ」はカウントしない
 * 各行の「x2」「×3」等を合算、なければ1として加算
 */
function calcTotalCountFromProductNames_(productNamesText) {
  if (!productNamesText) return 0;
  var lines = String(productNamesText).split('\n');
  var total = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^・/, '').trim();
    if (!line) continue;
    if (line.indexOf('選べるxlsx付きパッケージ') !== -1) continue;
    var m = line.match(/[x×]\s*(\d+)/i);
    total += m ? parseInt(m[1], 10) : 1;
  }
  return total;
}

// =====================================================
// プレミアムアソート自動選定
// =====================================================

var PREMIUM_ASSORT_MAP_ = [
  { keyword: 'プレミアムアソート小ロット', target: 5600, min: 10 },
  { keyword: 'プレミアムアソート中ロット', target: 13500, min: 20 },
  { keyword: 'プレミアムアソート大ロット', target: 26700, min: 30 }
];
var PREMIUM_ASSORT_MAX_ = 50;

function classifyProductSeason_(product) {
  if (String(product.category || '') === 'ジャケット・アウター') return 'aw';
  if (String(product.shippingMethod || '').trim() === 'ゆうパケットポスト') return 'ss';
  return 'aw';
}

function getSeasonRatio_() {
  var month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 9) return { primary: 'ss', ratio: 0.9 };
  return { primary: 'aw', ratio: 0.9 };
}

function detectPremiumAssort_(orderItems) {
  if (!orderItems || !Array.isArray(orderItems)) return null;
  var totalTarget = 0, totalMin = 0;
  for (var i = 0; i < orderItems.length; i++) {
    var name = String(orderItems[i].name || '');
    var qty = Math.max(1, Number(orderItems[i].qty) || 1);
    for (var j = 0; j < PREMIUM_ASSORT_MAP_.length; j++) {
      if (name.indexOf(PREMIUM_ASSORT_MAP_[j].keyword) !== -1) {
        totalTarget += PREMIUM_ASSORT_MAP_[j].target * qty;
        totalMin += PREMIUM_ASSORT_MAP_[j].min * qty;
        break;
      }
    }
  }
  if (totalTarget <= 0) return null;
  return {
    targetAmount: totalTarget,
    minCount: totalMin,
    maxCount: Math.max(PREMIUM_ASSORT_MAX_, totalMin * 3)
  };
}

function selectProductsForPremiumAssort_(targetAmount, minCount, maxCount, orderSs, excludeIds) {
  var products = pr_readProducts_();
  var holdState = st_getHoldState_(orderSs) || {};
  var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  var excludeSet = {};
  if (excludeIds) for (var e = 0; e < excludeIds.length; e++) excludeSet[excludeIds[e]] = true;

  var ssPool = [], awPool = [];
  var _skipNoId = 0, _skipState = 0, _skipHold = 0, _skipOpen = 0, _skipExclude = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (!p.managedId || !p.price || p.price <= 0) { _skipNoId++; continue; }
    if (holdItems[p.managedId]) { _skipHold++; continue; }
    if (openItems[p.managedId]) { _skipOpen++; continue; }
    if (excludeSet[p.managedId]) { _skipExclude++; continue; }
    var item = { id: p.managedId, price: p.price };
    if (classifyProductSeason_(p) === 'ss') ssPool.push(item);
    else awPool.push(item);
  }
  console.log('プレミアムアソート選定プール: 全商品=' + products.length + ' ssPool=' + ssPool.length + ' awPool=' + awPool.length
    + ' skipNoId=' + _skipNoId + ' skipState=' + _skipState + ' skipHold=' + _skipHold + ' skipOpen=' + _skipOpen + ' skipExclude=' + _skipExclude);

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }
  shuffle(ssPool);
  shuffle(awPool);

  var season = getSeasonRatio_();
  var primaryPool = (season.primary === 'ss') ? ssPool : awPool;
  var secondaryPool = (season.primary === 'ss') ? awPool : ssPool;
  var secondaryTarget = Math.max(1, Math.floor(minCount * (1 - season.ratio)));
  var primaryTarget = minCount - secondaryTarget;

  var selected = [];
  var total = 0;
  var pIdx = 0, sIdx = 0;

  // 1st: secondary pool (少数派の季節)
  while (selected.length < secondaryTarget && sIdx < secondaryPool.length) {
    selected.push(secondaryPool[sIdx]); total += secondaryPool[sIdx].price; sIdx++;
  }
  // 2nd: primary pool (多数派の季節)
  while (selected.length < minCount && pIdx < primaryPool.length) {
    selected.push(primaryPool[pIdx]); total += primaryPool[pIdx].price; pIdx++;
  }
  // 3rd: 最低点数未達→残りプールから補充（季節フォールバック）
  while (selected.length < minCount && sIdx < secondaryPool.length) {
    selected.push(secondaryPool[sIdx]); total += secondaryPool[sIdx].price; sIdx++;
  }
  // 4th: 金額不足→maxCountまで追加（primary優先）
  while (total < targetAmount && selected.length < maxCount) {
    if (pIdx < primaryPool.length) {
      selected.push(primaryPool[pIdx]); total += primaryPool[pIdx].price; pIdx++;
    } else if (sIdx < secondaryPool.length) {
      selected.push(secondaryPool[sIdx]); total += secondaryPool[sIdx].price; sIdx++;
    } else break;
  }
  // 5th: maxCount到達でも金額不足→安い商品を高い商品に交換
  if (total < targetAmount) {
    selected.sort(function(a, b) { return a.price - b.price; });
    var unused = [];
    for (var ui = pIdx; ui < primaryPool.length; ui++) unused.push(primaryPool[ui]);
    for (var ui2 = sIdx; ui2 < secondaryPool.length; ui2++) unused.push(secondaryPool[ui2]);
    unused.sort(function(a, b) { return b.price - a.price; });
    for (var u = 0; u < unused.length && total < targetAmount; u++) {
      if (unused[u].price > selected[0].price) {
        total = total - selected[0].price + unused[u].price;
        selected[0] = unused[u];
        selected.sort(function(a, b) { return a.price - b.price; });
      }
    }
  }

  // 季節割合チェック
  var primarySet = {};
  for (var pi = 0; pi < primaryPool.length; pi++) primarySet[primaryPool[pi].id] = true;
  var primaryCount = 0;
  for (var si = 0; si < selected.length; si++) {
    if (primarySet[selected[si].id]) primaryCount++;
  }
  var seasonRatio = selected.length > 0 ? primaryCount / selected.length : 0;

  if (total < targetAmount) {
    console.warn('プレミアムアソート: 在庫不足 target=' + targetAmount + ' selected=' + total);
  }
  if (seasonRatio < 0.4) {
    console.warn('プレミアムアソート: オンシーズン割合が低い: ' + Math.round(seasonRatio * 100) + '%');
    try {
      MailApp.sendEmail({
        to: APP_CONFIG.admin.ownerEmail,
        subject: '⚠ プレミアムアソート: オンシーズン在庫不足',
        body: 'オンシーズン商品の割合が' + Math.round(seasonRatio * 100) + '%（目標90%）に低下しています。\n'
          + '選定点数: ' + selected.length + '点\n'
          + 'オンシーズン: ' + primaryCount + '点\n'
          + '在庫補充を検討してください。',
        replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL
      });
    } catch (mailErr) { console.error('季節警告メール送信エラー:', mailErr); }
  }

  return { ids: selected.map(function(s) { return s.id; }), total: total, seasonRatio: seasonRatio };
}

/**
 * 手動でプレミアムアソート自動選定を実行（GASエディタから実行）
 * 受付番号を指定して、J列(選択リスト)・K列(合計点数)を更新する
 *
 * 使い方: GASエディタで受付番号を書き換えて実行
 */
function manualPremiumAssortSelect() {
  var receiptNo = '20260305193720-732'; // ← ここに受付番号を入力

  var orderSs = sh_getOrderSs_();
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('依頼管理が空です'); return; }

  // 受付番号でA列を検索
  var targetRow = -1;
  var data = reqSh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === receiptNo) { targetRow = i + 2; break; }
  }
  if (targetRow < 0) { console.log('受付番号が見つかりません: ' + receiptNo); return; }

  // H列(8)から商品名を取得してプレミアムアソート検出
  var productName = String(reqSh.getRange(targetRow, 8).getValue() || '');
  // H列の商品名から「x2」「×2」等の数量を抽出
  var nameQtyMatch = productName.match(/[x×]\s*(\d+)/i);
  var qty = nameQtyMatch ? parseInt(nameQtyMatch[1], 10) : 1;
  var orderItems = [{ name: productName, qty: qty }];
  var premiumSpec = detectPremiumAssort_(orderItems);
  if (!premiumSpec) { console.log('プレミアムアソート商品が検出されませんでした: ' + productName); return; }

  console.log('検出: target=¥' + premiumSpec.targetAmount + ' min=' + premiumSpec.minCount + ' max=' + premiumSpec.maxCount);

  // 既存のJ列IDをopenStateから除去（再選定のためリセット）
  var existingJ = String(reqSh.getRange(targetRow, 10).getValue() || '').trim();
  var oldIds = existingJ ? existingJ.split(/[、,]/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
  if (oldIds.length > 0) {
    var openStatePre = st_getOpenState_(orderSs) || {};
    var openItemsPre = (openStatePre.items && typeof openStatePre.items === 'object') ? openStatePre.items : {};
    for (var oi = 0; oi < oldIds.length; oi++) delete openItemsPre[oldIds[oi]];
    openStatePre.items = openItemsPre;
    st_setOpenState_(orderSs, openStatePre);
    console.log('既存選定 ' + oldIds.length + '点をopenStateから除去（再選定）');
  }

  // 自動選定実行（ゼロから再選定）
  var selection = selectProductsForPremiumAssort_(
    premiumSpec.targetAmount, premiumSpec.minCount, premiumSpec.maxCount, orderSs, []
  );

  if (!selection.ids || selection.ids.length === 0) {
    console.log('在庫不足で商品を選定できませんでした');
    return;
  }

  var allIds = selection.ids;
  var selectionList = u_sortManagedIds_(allIds).join('、');

  // J列・K列・AF列を更新
  reqSh.getRange(targetRow, 10).setValue(selectionList);
  var hText = String(reqSh.getRange(targetRow, 8).getValue() || '');
  reqSh.getRange(targetRow, 11).setValue(calcTotalCountFromProductNames_(hText));
  reqSh.getRange(targetRow, 32).setValue(new Date());

  // openStateに追加
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  for (var i = 0; i < selection.ids.length; i++) {
    openItems[selection.ids[i]] = { receiptNo: receiptNo, at: Date.now() };
  }
  openState.items = openItems;
  st_setOpenState_(orderSs, openState);
  st_invalidateStatusCache_(orderSs);

  console.log('完了: ' + receiptNo + ' → ' + selection.ids.length + '点選定, 合計¥' + selection.total + ', J列=' + selectionList);
}

// =====================================================
// 送料サイズ判定ヘルパー（CartCalc.html と同一ロジック）
// =====================================================

/**
 * 厚み分類からサイズを判定
 * @param {number} thick - 厚手商品数（非ゆうパケット）
 * @param {number} thin - 薄手商品数（ゆうパケットポスト）
 * @return {{ size: string|null }} size='small'|'large'|null(上限超過)
 */
function calcShippingSize_sf_(thick, thin) {
  var total = thick + thin;
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

/**
 * 上限超過時の複数口送料計算
 * @param {number} thick - 厚手商品数
 * @param {number} thin - 薄手商品数
 * @param {Array} rates - [小サイズ料金, 大サイズ料金]
 * @return {{ amount: number, sizeLabel: string }}
 */
function calcMultiShipment_sf_(thick, thin, rates) {
  var smallRate = rates[0], largeRate = rates[1];
  var totalAmount = 0, largeCnt = 0, smallCnt = 0;
  if (thick > 0) {
    var n = Math.ceil(thick / 20);
    largeCnt += n;
    totalAmount += n * largeRate;
  }
  var rem = thin;
  while (rem > 0) {
    var batch = Math.min(rem, 40);
    if (batch <= 10) { smallCnt++; totalAmount += smallRate; }
    else { largeCnt++; totalAmount += largeRate; }
    rem -= batch;
  }
  var parts = [];
  if (largeCnt > 0) parts.push('大×' + largeCnt);
  if (smallCnt > 0) parts.push('小×' + smallCnt);
  return { amount: totalAmount, sizeLabel: parts.join('、') };
}

// =====================================================
// D1バックアップ ヘルパー（決済→依頼管理反映の確実化）
// =====================================================

/**
 * Workers API経由でD1のpending_ordersからデータを取得
 * @param {string} paymentToken - 決済トークン
 * @returns {object|null} - { found, data, consumed } or null on error
 */
function fetchPendingFromD1_(paymentToken) {
  try {
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_API_URL');
    var adminKey = props.getProperty('ADMIN_KEY');
    if (!workersUrl || !adminKey) {
      console.warn('fetchPendingFromD1_: WORKERS_API_URL or ADMIN_KEY not set');
      return null;
    }

    var resp = UrlFetchApp.fetch(workersUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'apiGetPendingOrder',
        adminKey: adminKey,
        args: [paymentToken]
      }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      console.error('fetchPendingFromD1_: HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
      return null;
    }

    var result = JSON.parse(resp.getContentText());
    if (!result || !result.ok) {
      console.error('fetchPendingFromD1_: API error: ' + JSON.stringify(result).substring(0, 200));
      return null;
    }

    return {
      found: result.found === true,
      data: result.data || null,
      consumed: result.consumed || 0
    };
  } catch (e) {
    console.error('fetchPendingFromD1_ error:', e);
    return null;
  }
}

/**
 * Workers API経由でD1のpending_ordersのconsumedフラグを立てる
 * @param {string} paymentToken - 決済トークン
 */
function markD1PendingConsumed_(paymentToken) {
  try {
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_API_URL');
    var adminKey = props.getProperty('ADMIN_KEY');
    if (!workersUrl || !adminKey) return;

    UrlFetchApp.fetch(workersUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'apiMarkPendingConsumed',
        adminKey: adminKey,
        args: [paymentToken]
      }),
      muteHttpExceptions: true
    });
    console.log('D1 pending marked consumed: ' + paymentToken);
  } catch (e) {
    console.error('markD1PendingConsumed_ error:', e);
  }
}

/**
 * KOMOJUメタデータから最低限の「要確認」行を依頼管理に作成
 * PropertiesServiceにもD1にもデータがない場合の最終フォールバック
 * @param {string} paymentToken - 決済トークン
 * @param {string} paymentStatus - 入金ステータス
 * @param {string} paymentMethod - 決済方法
 * @param {string} paymentId - KOMOJU決済ID
 * @returns {object} - { ok, message }
 */
function createMinimalOrderRow_(paymentToken, paymentStatus, paymentMethod, paymentId) {
  try {
    // KOMOJUから決済情報を取得
    var komojuData = null;
    if (paymentId) {
      komojuData = fetchPaymentFromApi_(paymentId);
    }

    var receiptNo = u_makeReceiptNo_();
    var email = '';
    var companyName = '【要確認】';
    var totalAmount = 0;
    var phone = '';
    var postal = '';
    var address = '';

    if (komojuData) {
      totalAmount = komojuData.amount || 0;
      if (komojuData.customer) {
        email = komojuData.customer.email || '';
      }
      if (komojuData.metadata) {
        companyName = komojuData.metadata.company_name || '【要確認】';
        email = email || komojuData.metadata.email || '';
      }
    }

    // 依頼管理シートに最低限の行を書き込み
    var orderSs = sh_getOrderSs_();
    var reqSh = sh_ensureRequestSheet_(orderSs);
    var now = new Date();
    var noteText = '【自動復旧】決済データから作成（要確認）\n'
      + 'paymentToken: ' + paymentToken + '\n'
      + 'paymentId: ' + (paymentId || 'N/A') + '\n'
      + '決済方法: ' + (paymentMethod || 'N/A');

    // 依頼管理の列: A=受付番号, B=日時, C=会社名, D=メール, E=電話, F=郵便番号, G=住所,
    //   H=商品名, I=確認リンク, J=採寸, K=商品リスト, L=合計金額, M=発送ステータス,
    //   N=備考, O=決済方法, P=ステータス, Q=入金確認, R=入金ステータス
    var row = [
      receiptNo,                                         // A: 受付番号
      Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'), // B: 日時
      companyName,                                       // C: 会社名
      email,                                             // D: メール
      phone,                                             // E: 電話
      postal,                                            // F: 郵便番号
      address,                                           // G: 住所
      '【要確認】商品情報なし',                            // H: 商品名
      '',                                                // I: 確認リンク
      '',                                                // J: 採寸
      '',                                                // K: 商品リスト
      totalAmount,                                       // L: 合計金額
      '',                                                // M: 発送ステータス
      noteText                                           // N: 備考
    ];

    reqSh.appendRow(row);

    // 入金確認列（Q列=17）と決済方法列（O列=15）を更新
    var lastRow = reqSh.getLastRow();
    if (paymentStatus === 'paid') {
      reqSh.getRange(lastRow, 17).setValue('未対応');
    } else {
      reqSh.getRange(lastRow, 17).setValue('入金待ち');
    }
    if (paymentMethod) {
      reqSh.getRange(lastRow, 15).setValue(getPaymentMethodDisplayName_(paymentMethod));
    }

    console.log('Created minimal order row: ' + receiptNo + ' (paymentToken=' + paymentToken + ')');

    return {
      ok: true,
      message: '要確認行を作成しました（ペンディングデータ復旧不可）',
      receiptNo: receiptNo,
      paymentToken: paymentToken
    };
  } catch (e) {
    console.error('createMinimalOrderRow_ error:', e);
    return { ok: false, message: '要確認行の作成に失敗: ' + (e.message || String(e)) };
  }
}
