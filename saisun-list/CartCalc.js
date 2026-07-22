// =====================================================
// CartCalc — カート計算・表示ロジック共通モジュール
// BulkLP.html / index.html から <?!= include_('CartCalc') ?> でインクルード
// 純粋関数のみ。DOM/localStorage/グローバル変数への直接アクセスなし。
// =====================================================
var CartCalc = (function() {

  // ---- ユーティリティ ----
  function numFmt(n) { return String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function escAttr(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;'); }
  function yen(n) { return numFmt(n) + '円'; }

  // ---- 数量割引（2026-04-22廃止。関数は互換用に残しつつ常に0を返す） ----
  function bulkDiscountRate(count) {
    return 0;
  }
  function bulkDiscountLabel(count) {
    return '';
  }

  // ---- 送料: pt制設定（Constants.gs SHIPPING_CONSTANTS と同期） ----
  var ITEM_POINTS = { thin: 1, thick: 2 };                                  // 薄手(ゆうパケットポスト)=1pt / 厚手=2pt
  var BOX_CAPACITY = { '60': 2, '80': 4, '100': 10, '140': 20, '160': 40 }; // 箱サイズごとの収容pt
  var BOX_SIZES = ['60', '80', '100', '140', '160'];
  var CLICKPOST_PRICE = 280;                                                // クリックポスト顧客価格（税込・全国一律・沖縄含む）

  // ---- 送料: 厚み分類 ----
  function classifyThickness(items) {
    var thick = 0, thin = 0;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].shippingMethod || '').trim() === 'ゆうパケットポスト') thin++;
      else thick++;
    }
    return { thick: thick, thin: thin, total: thick + thin };
  }

  // ---- 送料: 料金表の形式正規化（旧2段階[小,大]が来たら5サイズへ読み替え・移行ウィンドウ用） ----
  function normalizeRates(r) {
    if (!r) return null;
    if (Object.prototype.toString.call(r) === '[object Array]') {
      return { '60': r[0], '80': r[0], '100': r[0], '140': r[1], '160': r[1] };
    }
    return r;
  }

  // ---- 送料: pt数から最安の箱組み合わせをDPで求める ----
  function calcBoxPlan(points, rates) {
    var p = Math.max(0, Math.ceil(Number(points) || 0));
    if (p === 0 || !rates) return { amount: 0, boxes: {}, label: '' };
    var dp = [0];
    var choice = [null];
    for (var i = 1; i <= p; i++) {
      dp[i] = Infinity;
      choice[i] = null;
      for (var s = 0; s < BOX_SIZES.length; s++) {
        var sz = BOX_SIZES[s];
        var rest = Math.max(0, i - BOX_CAPACITY[sz]);
        var cost = Number(rates[sz] || 0) + dp[rest];
        if (cost < dp[i]) { dp[i] = cost; choice[i] = sz; }
      }
    }
    var boxes = {};
    var cur = p;
    while (cur > 0) {
      var chosen = choice[cur];
      boxes[chosen] = (boxes[chosen] || 0) + 1;
      cur = Math.max(0, cur - BOX_CAPACITY[chosen]);
    }
    var order = ['160', '140', '100', '80', '60'];
    var parts = [];
    var totalBoxes = 0;
    for (var o = 0; o < order.length; o++) {
      var n = boxes[order[o]];
      if (n) { parts.push(n > 1 ? order[o] + '×' + n : order[o]); totalBoxes += n; }
    }
    var label = (totalBoxes === 1) ? parts[0] + 'サイズ' : parts.join('＋');
    return { amount: dp[p], boxes: boxes, label: label };
  }

  // ---- 送料: サイズ判定（単箱に収まる場合のサイズ。互換API） ----
  function calcShippingSize(thick, thin) {
    var points = thick * ITEM_POINTS.thick + thin * ITEM_POINTS.thin;
    if (thick === 0 && thin === 1) return { size: 'clickpost', label: 'クリックポスト', points: points };
    for (var i = 0; i < BOX_SIZES.length; i++) {
      if (points <= BOX_CAPACITY[BOX_SIZES[i]]) return { size: BOX_SIZES[i], label: BOX_SIZES[i] + 'サイズ', points: points };
    }
    return { size: null, reason: 'overLimit', points: points };
  }

  // ---- 送料: 複数口計算（DP。互換API） ----
  function calcMultiShipment(thick, thin, rates) {
    var plan = calcBoxPlan(thick * ITEM_POINTS.thick + thin * ITEM_POINTS.thin, normalizeRates(rates));
    return { amount: plan.amount, sizeLabel: plan.label, boxes: plan.boxes };
  }

  // ---- 送料: デタウリ送料の統合計算（クリックポスト判定＋pt制DP） ----
  function calcShipment(thick, thin, rates) {
    // クリックポスト: 薄手ちょうど1点（全国一律・沖縄含む）
    if (thick === 0 && thin === 1) {
      return { amount: CLICKPOST_PRICE, sizeLabel: 'クリックポスト', isClickpost: true, boxes: {}, remainingPts: 0 };
    }
    var points = thick * ITEM_POINTS.thick + thin * ITEM_POINTS.thin;
    var plan = calcBoxPlan(points, normalizeRates(rates));
    var cap = 0;
    for (var sz in plan.boxes) { if (plan.boxes.hasOwnProperty(sz)) cap += BOX_CAPACITY[sz] * plan.boxes[sz]; }
    return { amount: plan.amount, sizeLabel: plan.label, isClickpost: false, boxes: plan.boxes, remainingPts: Math.max(0, cap - points) };
  }

  // ---- 送料: 都道府県検出 ----
  var PREFECTURES = [
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県',
    '岐阜県','静岡県','愛知県','三重県',
    '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県',
    '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'
  ];
  function detectPref(text) {
    text = String(text || '').trim();
    for (var i = 0; i < PREFECTURES.length; i++) {
      if (text.indexOf(PREFECTURES[i]) === 0) return PREFECTURES[i];
    }
    for (var j = 0; j < PREFECTURES.length; j++) {
      var sh = PREFECTURES[j].replace(/[都府県]$/, '');
      if (text.indexOf(sh) === 0) return PREFECTURES[j];
    }
    return null;
  }

  // ---- 送料: 離島判定 ----
  var REMOTE_ISLANDS = [
    '大島町','利島村','新島村','神津島村','三宅村','御蔵島村','八丈町','青ヶ島村','小笠原村',
    '奄美市','大和村','宇検村','瀬戸内町','龍郷町','喜界町','徳之島町','天城町','伊仙町',
    '和泊町','知名町','与論町','三島村','十島村',
    '西之表市','中種子町','南種子町','屋久島町',
    '宮古島市','石垣市','多良間村','竹富町','与那国町','久米島町','座間味村','渡嘉敷村',
    '粟国村','渡名喜村','南大東村','北大東村','伊江村','伊是名村','伊平屋村',
    '佐渡市','隠岐の島町','海士町','西ノ島町','知夫村',
    '対馬市','壱岐市','五島市','新上五島町','小値賀町',
    '利尻町','利尻富士町','礼文町','奥尻町'
  ];
  function isRemoteIsland(text) {
    text = String(text || '');
    // 「周防大島町」（山口県・本土扱い）は東京都「大島町」に部分一致するため先に除去
    text = text.replace(/周防大島町/g, '');
    for (var i = 0; i < REMOTE_ISLANDS.length; i++) {
      if (text.indexOf(REMOTE_ISLANDS[i]) !== -1) return true;
    }
    return false;
  }

  // =====================================================
  // メイン計算関数
  // =====================================================
  function calculate(input) {
    var det = input.detauri || { items: [], rawTotal: 0, count: 0 };
    var ass = input.assort || { rawSubtotal: 0, totalQty: 0 };
    var coupon = input.coupon || null;
    var fhp = input.firstHalfPrice || null;
    var md = input.memberDiscount || { enabled: false, rate: 0 };
    var areas = input.shippingAreas || {};
    var rates = input.shippingRates || {};
    var addrPref = input.addressPref || null;
    var addrText = input.addressText || '';
    var pointsUsed = input.pointsUsed || 0;
    var customer = input.customer || null;
    var assortExcQty = input.assortExcludedQty || 0;
    var assortAlwaysChargeQty = input.assortAlwaysChargeQty || 0;  // 価格破壊商品の数量（¥10,000以上ルール無効化）

    // -- 結果オブジェクト初期化 --
    var result = {
      detauri: { raw: det.rawTotal, discounted: det.rawTotal, discounts: [], shipping: { amount: 0, label: '', isFree: false, freeReason: '' }, subtotal: 0 },
      assort:  { raw: ass.rawSubtotal, discounted: ass.rawSubtotal, discounts: [], shipping: { amount: 0, label: '', isFree: false, freeReason: '' }, subtotal: 0 },
      couponDiscount: 0,
      couponLabel: '',
      pointsApplied: 0,
      grandTotal: 0,
      hasBothChannels: det.count > 0 && ass.totalQty > 0,
      hasShippingAddress: !!addrPref,
      detauriCount: det.count,
      assortQty: ass.totalQty,
      isRemoteIsland: false,
      freeShipProgress: { show: false, current: 0, threshold: 10000, remaining: 0, pct: 0 }
    };

    // -- 離島チェック --
    if (addrText && isRemoteIsland(addrText)) {
      result.isRemoteIsland = true;
      return result;
    }

    // -- Step 1-2: FHP判定 --
    var fhpApplied = false;
    if (fhp && fhp.eligible && customer) {
      fhpApplied = true;
      // デタウリ
      if (det.rawTotal > 0) {
        var fhpDetAmt = Math.round(det.rawTotal * fhp.rate);
        result.detauri.discounted = Math.max(0, det.rawTotal - fhpDetAmt);
        if (fhpDetAmt > 0) {
          result.detauri.discounts.push({ label: '初回全品半額（' + Math.round(fhp.rate * 100) + '%OFF）', amount: fhpDetAmt, style: 'fhp' });
        }
      }
      // アソート
      if (ass.rawSubtotal > 0) {
        var fhpAssAmt = Math.round(ass.rawSubtotal * fhp.rate);
        result.assort.discounted = Math.max(0, ass.rawSubtotal - fhpAssAmt);
        if (fhpAssAmt > 0) {
          result.assort.discounts.push({ label: '初回全品半額（' + Math.round(fhp.rate * 100) + '%OFF）', amount: fhpAssAmt, style: 'fhp' });
        }
      }
    }

    // -- Step 3: FHP未適用時の割引 --
    if (!fhpApplied) {
      // 3a: 数量割引は2026-04-22に廃止（bulkDiscountRate は常に0を返す）
      // 3b: 会員割引（両チャネル、comboMember !== false なら適用）
      if (customer && md.enabled && (!coupon || coupon.comboMember !== false)) {
        // デタウリ
        if (result.detauri.discounted > 0) {
          var mdDetAmt = Math.round(result.detauri.discounted * md.rate);
          result.detauri.discounted = Math.max(0, result.detauri.discounted - mdDetAmt);
          if (mdDetAmt > 0) {
            result.detauri.discounts.push({ label: '会員割引 (' + Math.round(md.rate * 100) + '%OFF)', amount: mdDetAmt, style: 'member' });
          }
        }
        // アソート
        if (result.assort.discounted > 0) {
          var mdAssAmt = Math.round(result.assort.discounted * md.rate);
          result.assort.discounted = Math.max(0, result.assort.discounted - mdAssAmt);
          if (mdAssAmt > 0) {
            result.assort.discounts.push({ label: '会員割引 (' + Math.round(md.rate * 100) + '%OFF)', amount: mdAssAmt, style: 'member' });
          }
        }
      }
    }

    // -- Step 4: 送料計算 --
    var combinedDiscountedProduct = result.detauri.discounted + result.assort.discounted;
    var freeShipThreshold = 10000;

    // ダイヤモンド会員 → 全送料無料（沖縄県も無料のままダイヤ特典は維持）
    var diamondFree = customer && customer.rank && customer.rank.freeShipping;
    // 沖縄は送料無料（閾値・クーポン）の対象外（ダイヤ会員特典のみ維持）
    var isOkinawa = (addrPref ? areas[addrPref] : '') === 'okinawa';
    // 送料無料クーポン（shipping_free型 または rate/fixed型の送料無料併用フラグ）— FHP時は無効、沖縄は対象外
    var shippingFreeCoupon = !fhpApplied && coupon && (coupon.type === 'shipping_free' || coupon.freeShipping === true);
    var couponFreeEffective = shippingFreeCoupon && !isOkinawa;
    // ¥10,000以上で送料無料（FHP・沖縄は対象外）
    var thresholdFree = !fhpApplied && !isOkinawa && combinedDiscountedProduct >= freeShipThreshold;

    // デタウリ送料
    if (det.count > 0) {
      var t = classifyThickness(det.items);
      // クリックポスト: 薄手ちょうど1点（全国一律¥280・沖縄含む・住所未入力でも確定表示可）
      var isClickpost = (t.thick === 0 && t.thin === 1);
      var area = addrPref ? areas[addrPref] : null;
      if (addrPref && area && rates[area]) {
        if (diamondFree) {
          result.detauri.shipping = { amount: 0, label: 'デタウリ 送料', isFree: true, freeReason: 'ダイヤモンド会員特典' };
        } else if (couponFreeEffective) {
          result.detauri.shipping = { amount: 0, label: 'デタウリ 送料', isFree: true, freeReason: 'クーポン適用' };
        } else if (thresholdFree) {
          result.detauri.shipping = { amount: 0, label: 'デタウリ 送料', isFree: true, freeReason: '商品合計¥10,000以上' };
        } else if (isClickpost) {
          result.detauri.shipping = { amount: CLICKPOST_PRICE, label: 'デタウリ 送料（クリックポスト・全国一律）', isFree: false, freeReason: '', isClickpost: true };
        } else if (t.total > 0) {
          // pt制: 箱詰めDPで最安の箱組み合わせを計算
          var ship = calcShipment(t.thick, t.thin, rates[area]);
          result.detauri.shipping = { amount: ship.amount, label: 'デタウリ 送料（' + escHtml(addrPref) + '・' + ship.sizeLabel + '）', isFree: false, freeReason: '', remainingPts: ship.remainingPts };
        }
      } else if (!addrPref && isClickpost) {
        // 住所未入力でもクリックポストは全国一律のため確定表示（ダイヤ会員は無料）
        if (diamondFree) {
          result.detauri.shipping = { amount: 0, label: 'デタウリ 送料', isFree: true, freeReason: 'ダイヤモンド会員特典' };
        } else {
          result.detauri.shipping = { amount: CLICKPOST_PRICE, label: 'デタウリ 送料（クリックポスト・全国一律）', isFree: false, freeReason: '', isClickpost: true };
        }
      }
    }

    // アソート送料（1箱=160サイズ × 数量）
    if (ass.totalQty > 0 && addrPref) {
      var aArea = areas[addrPref];
      var aRates = (aArea && rates[aArea]) ? normalizeRates(rates[aArea]) : null;
      if (aRates) {
        if (diamondFree) {
          result.assort.shipping = { amount: 0, label: 'アソート 送料', isFree: true, freeReason: 'ダイヤモンド会員特典' };
        } else if (couponFreeEffective) {
          // 送料無料クーポンの除外商品対応
          if (assortExcQty > 0) {
            var excShip = aRates['160'] * assortExcQty;
            result.assort.shipping = { amount: excShip, label: 'アソート 送料（' + escHtml(addrPref) + '・160×' + assortExcQty + '、一部商品除外）', isFree: false, freeReason: '' };
          } else {
            result.assort.shipping = { amount: 0, label: 'アソート 送料', isFree: true, freeReason: 'クーポン適用' };
          }
        } else if (thresholdFree) {
          // ¥10,000以上送料無料 — ただし価格破壊商品は対象外（数量分だけ送料請求）
          if (assortAlwaysChargeQty > 0) {
            var alwaysShip = aRates['160'] * assortAlwaysChargeQty;
            result.assort.shipping = { amount: alwaysShip, label: 'アソート 送料（' + escHtml(addrPref) + '・160×' + assortAlwaysChargeQty + '、価格破壊商品分）', isFree: false, freeReason: '' };
          } else {
            result.assort.shipping = { amount: 0, label: 'アソート 送料', isFree: true, freeReason: '商品合計¥10,000以上' };
          }
        } else {
          var assortShipAmt = aRates['160'] * ass.totalQty;
          result.assort.shipping = { amount: assortShipAmt, label: 'アソート 送料（' + escHtml(addrPref) + '・160×' + ass.totalQty + '）', isFree: false, freeReason: '' };
        }
      }
    }

    // -- Step 5: 各チャネル小計 --
    result.detauri.subtotal = result.detauri.discounted + result.detauri.shipping.amount;
    result.assort.subtotal = result.assort.discounted + result.assort.shipping.amount;

    // -- Step 6: クーポン控除（合計レベル） --
    if (!fhpApplied && coupon && coupon.type !== 'shipping_free') {
      if (coupon.type === 'rate') {
        result.couponDiscount = Math.round(combinedDiscountedProduct * (coupon.value || 0));
      } else {
        // amount型
        result.couponDiscount = Math.min(Number(coupon.value || 0), combinedDiscountedProduct);
      }
      result.couponLabel = 'クーポン利用（' + escHtml(coupon.label || '') + '）';
    }

    // -- Step 7: ポイント控除（合計レベル） --
    var sumSubtotals = result.detauri.subtotal + result.assort.subtotal - result.couponDiscount;
    if (pointsUsed > 0 && customer) {
      var maxPts = customer.points || 0;
      // 0円注文防止: お支払い金額が最低¥1残るよう、ポイントは合計−1円までに制限
      result.pointsApplied = Math.min(pointsUsed, maxPts, Math.max(0, sumSubtotals - 1));
    }

    // -- Step 8: 合計 --
    result.grandTotal = Math.max(0, sumSubtotals - result.pointsApplied);

    // -- 送料無料プログレスバー（FHP時・沖縄は非表示） --
    if (!fhpApplied && !isOkinawa && combinedDiscountedProduct > 0 && combinedDiscountedProduct < freeShipThreshold) {
      result.freeShipProgress = {
        show: true,
        current: combinedDiscountedProduct,
        threshold: freeShipThreshold,
        remaining: freeShipThreshold - combinedDiscountedProduct,
        pct: Math.min(100, Math.round((combinedDiscountedProduct / freeShipThreshold) * 100))
      };
    } else if (!fhpApplied && !isOkinawa && combinedDiscountedProduct >= freeShipThreshold) {
      result.freeShipProgress = { show: true, current: combinedDiscountedProduct, threshold: freeShipThreshold, remaining: 0, pct: 100 };
    }

    return result;
  }

  // =====================================================
  // サマリーHTML生成
  // =====================================================
  function renderSummary(result, opts) {
    opts = opts || {};
    var primary = opts.primaryChannel || 'detauri';
    var secondary = (primary === 'detauri') ? 'assort' : 'detauri';
    var pData = result[primary];
    var sData = result[secondary];
    var pItemsHtml = opts.primaryItemsHtml || '';
    var sItemsHtml = opts.secondaryItemsHtml || '';
    var showProgress = opts.showProgressBar !== false;
    var pointsInputPt = opts.pointsInputPt || 0;

    var rows = '';

    // --- 送料無料プログレスバー ---
    if (showProgress && result.freeShipProgress.show) {
      if (result.freeShipProgress.remaining > 0) {
        rows += '<div style="margin:4px 0 8px;font-size:12px;color:#555;">あと<strong>¥' + numFmt(result.freeShipProgress.remaining) + '</strong>で送料無料！'
          + '<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-top:4px;"><div style="height:100%;background:linear-gradient(90deg,#3b82f6,#10b981);border-radius:3px;width:' + result.freeShipProgress.pct + '%;transition:width .4s ease;"></div></div></div>';
      } else {
        rows += '<div style="margin:4px 0 8px;font-size:12px;color:#059669;font-weight:700;">送料無料の条件を満たしています</div>';
      }
    }

    // --- プライマリチャネル ---
    var pIsAssort = (primary === 'assort');
    var pStyle = pIsAssort ? '' : '';
    var pDiscStyle = pIsAssort ? '' : '';

    // プライマリ商品行HTML
    rows += pItemsHtml;

    // プライマリ商品代行
    if (pData.raw > 0) {
      var pLabel;
      if (pIsAssort) {
        pLabel = 'アソート商品 商品代';
      } else {
        pLabel = 'デタウリ 商品代';
        if (result.detauriCount > 0) pLabel += '（' + result.detauriCount + '点）';
      }
      rows += '<div class="cart-row"' + pStyle + '><span>' + pLabel + '</span><span>¥' + numFmt(pData.raw) + '</span></div>';
    }

    // プライマリ割引行
    for (var pi = 0; pi < pData.discounts.length; pi++) {
      var pd = pData.discounts[pi];
      var pdStyle = '';
      if (pd.style === 'fhp') pdStyle = ' style="color:#c2410c;font-weight:700;"';
      rows += '<div class="cart-row"' + pdStyle + pDiscStyle + '><span>' + escHtml(pd.label) + '</span><span>-¥' + numFmt(pd.amount) + '</span></div>';
    }

    // プライマリ送料行
    if (pData.raw > 0) {
      if (pData.shipping.isFree) {
        var freeText = pData.shipping.freeReason ? '（' + pData.shipping.freeReason + '）' : '（無料）';
        rows += '<div class="cart-row"' + pStyle + '><span>' + escHtml(pData.shipping.label) + '</span><span>¥0' + freeText + '</span></div>';
      } else if (pData.shipping.amount > 0) {
        rows += '<div class="cart-row"' + pStyle + '><span>' + escHtml(pData.shipping.label) + '</span><span>¥' + numFmt(pData.shipping.amount) + '</span></div>';
      } else if (!result.hasShippingAddress) {
        var pShipLabel = pIsAssort ? 'アソート 送料' : 'デタウリ 送料';
        rows += '<div class="cart-row"' + pStyle + '><span>' + pShipLabel + '</span><span style="font-size:11px;color:#888;">住所を入力すると送料が表示されます</span></div>';
      }
      // 同梱アップセル（箱に残容量がある場合のみ）
      if (!pIsAssort && pData.shipping.amount > 0 && pData.shipping.remainingPts > 0) {
        var pRem = pData.shipping.remainingPts;
        var pThickFit = Math.floor(pRem / 2);
        rows += '<div style="margin:2px 0 6px;font-size:11px;color:#2563eb;">📦 同じ送料で、あと薄手' + pRem + '点' + (pThickFit > 0 ? '（または厚手' + pThickFit + '点）' : '') + 'まで同梱できます</div>';
      }
    }

    // 片チャネル時: ポイント行はsmall計の直前に
    if (!result.hasBothChannels && result.pointsApplied > 0) {
      rows += '<div class="cart-row" style="color:#b8002a;font-weight:700;"><span>ポイント利用合計 (' + pointsInputPt + 'pt)</span><span>-¥' + numFmt(result.pointsApplied) + '</span></div>';
    }

    // プライマリ小計行
    if (pData.raw > 0) {
      var pSubDisplay = result.hasBothChannels ? pData.subtotal : result.grandTotal;
      var pSubLabel = pIsAssort ? 'アソート商品 小計' : 'デタウリ 小計';
      rows += '<div class="cart-row total"><span>' + pSubLabel + '</span><span>¥' + numFmt(pSubDisplay) + '</span></div>';
    }

    // --- セカンダリチャネル ---
    if (sData.raw > 0) {
      var sIsAssort = (secondary === 'assort');
      var sColor = sIsAssort ? '#5B86C5' : '#5B86C5';
      var sSt = ' style="color:' + sColor + ';font-size:12px;border-bottom:none;"';

      // セクション区切りバー
      if (sIsAssort) {
        rows += '<div style="margin:14px -2px 6px;padding:7px 10px;background:linear-gradient(135deg,rgba(91,134,197,.12),rgba(59,111,181,.08));border-radius:6px;border-left:3px solid #5B86C5;display:flex;align-items:center;">'
          + '<span style="font-size:11px;font-weight:800;color:#3b6fb5;letter-spacing:0.3px;">■ アソート商品</span></div>';
      } else {
        // デタウリがセカンダリの場合（BulkLPから見た場合）
        // 区切りはプライマリの小計行で十分なので薄いセパレーター
      }

      // セカンダリ商品行HTML
      rows += sItemsHtml;

      // セカンダリ商品代行
      var sLabel;
      if (sIsAssort) {
        sLabel = 'アソート商品 商品代';
      } else {
        sLabel = 'デタウリ 商品代';
        if (result.detauriCount > 0) sLabel += '（' + result.detauriCount + '点）';
      }
      rows += '<div class="cart-row"' + sSt + '><span>' + sLabel + '</span><span>¥' + numFmt(sData.raw) + '</span></div>';

      // セカンダリ割引行
      for (var si = 0; si < sData.discounts.length; si++) {
        var sd = sData.discounts[si];
        var sdSt = sSt;
        if (sd.style === 'fhp') sdSt = ' style="color:#c2410c;font-size:12px;border-bottom:none;font-weight:700;"';
        rows += '<div class="cart-row"' + sdSt + '><span>' + escHtml(sd.label) + '</span><span>-¥' + numFmt(sd.amount) + '</span></div>';
      }

      // セカンダリ送料行
      if (sData.shipping.isFree) {
        var sFreeText = sData.shipping.freeReason ? '（' + sData.shipping.freeReason + '）' : '（無料）';
        rows += '<div class="cart-row"' + sSt + '><span>' + escHtml(sData.shipping.label) + '</span><span>¥0' + sFreeText + '</span></div>';
      } else if (sData.shipping.amount > 0) {
        rows += '<div class="cart-row"' + sSt + '><span>' + escHtml(sData.shipping.label) + '</span><span>¥' + numFmt(sData.shipping.amount) + '</span></div>';
      } else if (!result.hasShippingAddress) {
        var sShipFallback = sIsAssort ? 'アソート商品 送料' : 'デタウリ 送料';
        rows += '<div class="cart-row"' + sSt + '><span>' + sShipFallback + '</span><span style="font-size:11px;color:#888;">住所入力で計算</span></div>';
      } else if (sData.raw > 0) {
        rows += '<div class="cart-row"' + sSt + '><span>' + escHtml(sData.shipping.label || (sIsAssort ? 'アソート 送料' : 'デタウリ 送料')) + '</span><span>¥0（無料）</span></div>';
      }
      // 同梱アップセル（箱に残容量がある場合のみ）
      if (!sIsAssort && sData.shipping.amount > 0 && sData.shipping.remainingPts > 0) {
        var sRem = sData.shipping.remainingPts;
        var sThickFit = Math.floor(sRem / 2);
        rows += '<div style="margin:2px 0 6px;font-size:11px;color:#2563eb;">📦 同じ送料で、あと薄手' + sRem + '点' + (sThickFit > 0 ? '（または厚手' + sThickFit + '点）' : '') + 'まで同梱できます</div>';
      }

      // セカンダリ小計行
      var sSubLabel = sIsAssort ? 'アソート商品 小計' : 'デタウリ 小計';
      rows += '<div class="cart-row" style="color:' + sColor + ';font-size:16px;font-weight:800;border-top:2px solid ' + sColor + ';margin-top:8px;padding-top:12px;border-bottom:none;">'
        + '<span>' + sSubLabel + '</span><span>¥' + numFmt(sData.subtotal) + '</span></div>';

      // 合計レベル: クーポン行
      if (result.couponDiscount > 0) {
        rows += '<div class="cart-row" style="color:#b8002a;font-weight:700;"><span>' + result.couponLabel + '</span><span>-¥' + numFmt(result.couponDiscount) + '</span></div>';
      }

      // 合計レベル: ポイント行
      if (result.pointsApplied > 0) {
        rows += '<div class="cart-row" style="color:#b8002a;font-weight:700;"><span>ポイント利用合計 (' + pointsInputPt + 'pt)</span><span>-¥' + numFmt(result.pointsApplied) + '</span></div>';
      }

      // 両チャネル合計行
      rows += '<div style="display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;font-size:17px;font-weight:900;padding:14px 12px;border-radius:10px;margin-top:14px;box-shadow:0 3px 12px rgba(0,0,0,.18);">'
        + '<span>両チャネル合計（税込）</span><span style="color:#fbbf24;">¥' + numFmt(result.grandTotal) + '</span></div>';
    } else {
      // セカンダリなし: クーポンがあれば表示
      if (result.couponDiscount > 0) {
        rows += '<div class="cart-row" style="color:#b8002a;font-weight:700;"><span>' + result.couponLabel + '</span><span>-¥' + numFmt(result.couponDiscount) + '</span></div>';
      }
    }

    return rows;
  }

  // ---- 公開API ----
  return {
    numFmt: numFmt,
    escHtml: escHtml,
    escAttr: escAttr,
    yen: yen,
    bulkDiscountRate: bulkDiscountRate,
    bulkDiscountLabel: bulkDiscountLabel,
    classifyThickness: classifyThickness,
    calcShippingSize: calcShippingSize,
    calcMultiShipment: calcMultiShipment,
    calcBoxPlan: calcBoxPlan,
    calcShipment: calcShipment,
    normalizeRates: normalizeRates,
    detectPref: detectPref,
    isRemoteIsland: isRemoteIsland,
    calculate: calculate,
    renderSummary: renderSummary
  };

})();
