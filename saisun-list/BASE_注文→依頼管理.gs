function syncBaseOrdersToIraiKanri() {
  const EXCLUDE_PRODUCT_IDS = new Set(['128311731', '129152120', '129140745', '132388956', '132389794', '132388821']);
  const ORDER_STATUS_COL_1BASED = 7;
  const ORDER_STATUS_VALUE = '未対応';

  // トリガーからも動作するようID指定で開く（getActiveSpreadsheetはトリガー非対応）
  const ss = baseGetTargetSpreadsheet_();
  const shOrder = ss.getSheetByName('BASE_注文');
  const shItem = ss.getSheetByName('BASE_注文商品');
  const shDst = ss.getSheetByName('依頼管理');

  if (!shOrder) throw new Error('シート「BASE_注文」が見つかりません');
  if (!shItem) throw new Error('シート「BASE_注文商品」が見つかりません');
  if (!shDst) throw new Error('シート「依頼管理」が見つかりません');

  const orderLastRow = shOrder.getLastRow();
  const itemLastRow = shItem.getLastRow();
  const dstLastRow = shDst.getLastRow();

  if (orderLastRow < 2) return;
  if (itemLastRow < 2) return;
  if (dstLastRow < 1) throw new Error('シート「依頼管理」にヘッダ行がありません');

  const orderLastCol = shOrder.getLastColumn();
  if (orderLastCol < ORDER_STATUS_COL_1BASED) throw new Error('「BASE_注文」の列数が不足しています（G列が存在しません）');

  const orderHeader = shOrder.getRange(1, 1, 1, orderLastCol).getValues()[0];
  const itemHeader = shItem.getRange(1, 1, 1, shItem.getLastColumn()).getValues()[0];
  const dstHeader = shDst.getRange(1, 1, 1, shDst.getLastColumn()).getValues()[0];

  const orderMap = buildHeaderMap_(orderHeader);
  const itemMap = buildHeaderMap_(itemHeader);
  const dstMap = buildHeaderMap_(dstHeader);

  const orders = shOrder.getRange(2, 1, orderLastRow - 1, orderLastCol).getValues();
  const items = shItem.getRange(2, 1, itemLastRow - 1, shItem.getLastColumn()).getValues();
  const dstValues = (dstLastRow >= 2)
    ? shDst.getRange(2, 1, dstLastRow - 1, shDst.getLastColumn()).getValues()
    : [];

  const idxOrderKey_Order = findAnyCol_(orderMap, ['注文キー', '注文Key', 'Order Key', 'order_key', 'orderKey', '注文ID', '受注ID', '受付番号']);
  if (idxOrderKey_Order === -1) throw new Error('「BASE_注文」に注文キー（注文ID/受付番号）相当の列が見つかりません');

  const idxOrderKey_Item = findAnyCol_(itemMap, ['注文キー', '注文Key', 'Order Key', 'order_key', 'orderKey', '注文ID', '受注ID', '受付番号']);
  if (idxOrderKey_Item === -1) throw new Error('「BASE_注文商品」に注文キー（注文ID/受付番号）相当の列が見つかりません');

  const idxProductId_Item = findAnyCol_(itemMap, ['商品ID', '商品Id', 'product_id', 'productId', 'Product ID', 'item_id', '商品コード']);
  if (idxProductId_Item === -1) throw new Error('「BASE_注文商品」に商品ID相当の列が見つかりません');

  const idxProductName_Item = findAnyCol_(itemMap, ['商品名', '商品名称', 'item_name', 'product_name', 'Product Name', '名称']);
  if (idxProductName_Item === -1) throw new Error('「BASE_注文商品」に商品名相当の列が見つかりません');

  const idxSubtotal_Item = findAnyCol_(itemMap, ['商品小計', '小計', 'subtotal', 'Sub Total', 'line_total', '商品合計']);
  if (idxSubtotal_Item === -1) throw new Error('「BASE_注文商品」に商品小計相当の列が見つかりません');

  const idxQty_Item = findAnyCol_(itemMap, ['数量、多', '数量', '個数', 'quantity', 'qty', 'Quantity', 'Qty', '注文数', '点数']);
  if (idxQty_Item === -1) throw new Error('「BASE_注文商品」に数量（合計点数）相当の列が見つかりません');

  const idxUpdatedAt_Item = findAnyCol_(itemMap, ['更新日時', 'updated_at', 'updatedAt', '更新日', '更新', 'Updated At']);
  if (idxUpdatedAt_Item === -1) throw new Error('「BASE_注文商品」に更新日時相当の列が見つかりません');

  const idxSurname_Order = findAnyCol_(orderMap, ['姓', '名字', '苗字', 'lastname', 'last_name', 'Last Name']);
  const idxGiven_Order = findAnyCol_(orderMap, ['名', '名前', 'firstname', 'first_name', 'First Name']);
  const idxEmail_Order = findAnyCol_(orderMap, ['メールアドレス', 'email', 'e-mail', 'mail', 'Email']);
  const idxZip_Order = findAnyCol_(orderMap, ['郵便番号', 'zip', 'zipcode', 'postal', 'postal_code', 'Post Code']);
  const idxPref_Order = findAnyCol_(orderMap, ['都道府県', 'prefecture', 'state', 'province']);
  const idxAddr1_Order = findAnyCol_(orderMap, ['住所1', '住所', 'address1', 'address_1', 'Address1']);
  const idxTel_Order = findAnyCol_(orderMap, ['電話番号', '電話', 'tel', 'phone', 'Phone']);
  const idxShipping_Order = findAnyCol_(orderMap, ['送料', 'shipping_fee', 'Shipping Fee', 'shipping']);

  // お届け先情報（購入者と異なる場合のみ値が入る）
  const idxRcvSurname_Order = findAnyCol_(orderMap, ['届先_姓']);
  const idxRcvGiven_Order = findAnyCol_(orderMap, ['届先_名']);
  const idxRcvZip_Order = findAnyCol_(orderMap, ['届先_郵便番号']);
  const idxRcvPref_Order = findAnyCol_(orderMap, ['届先_都道府県']);
  const idxRcvAddr1_Order = findAnyCol_(orderMap, ['届先_住所1']);
  const idxRcvAddr2_Order = findAnyCol_(orderMap, ['届先_住所2']);
  const idxRcvTel_Order = findAnyCol_(orderMap, ['届先_電話番号']);

  if (idxSurname_Order === -1 || idxGiven_Order === -1) throw new Error('「BASE_注文」に姓/名が見つかりません');
  if (idxEmail_Order === -1) throw new Error('「BASE_注文」にメールアドレスが見つかりません');
  if (idxZip_Order === -1) throw new Error('「BASE_注文」に郵便番号が見つかりません');
  if (idxPref_Order === -1) throw new Error('「BASE_注文」に都道府県が見つかりません');
  if (idxAddr1_Order === -1) throw new Error('「BASE_注文」に住所1（住所）が見つかりません');
  if (idxTel_Order === -1) throw new Error('「BASE_注文」に電話番号が見つかりません');

  const idxAddr2_Order_Exact = findAnyCol_(orderMap, ['住所2', 'address2', 'address_2', 'Address2', '建物名', 'マンション名', '部屋番号', '建物名/部屋番号', '住所(建物名)', '住所（建物名）']);
  const addr2CandidateIdxs = buildAddr2CandidateIdxs_(orderHeader, idxAddr2_Order_Exact);

  const dstIdx_ReceiptNo = findAnyCol_(dstMap, ['受付番号', '注文キー', '注文ID']);
  if (dstIdx_ReceiptNo === -1) throw new Error('「依頼管理」に受付番号（注文キー）列が見つかりません');

  const dstIdx_Remarks = findAnyCol_(dstMap, ['備考']);
  const dstIdx_TotalAmount = findAnyCol_(dstMap, ['合計金額']);
  const dstIdx_TotalCount = findAnyCol_(dstMap, ['合計点数', '点数', '数量']);
  const dstIdx_RequestAt = findAnyCol_(dstMap, ['依頼日時']);

  const dstIdx_Name = findAnyCol_(dstMap, ['会社名/氏名', '会社名', '氏名', 'お名前']);
  const dstIdx_Email = findAnyCol_(dstMap, ['連絡先', 'メールアドレス', 'Email']);
  const dstIdx_Zip = findAnyCol_(dstMap, ['郵便番号']);
  const dstIdx_Address = findAnyCol_(dstMap, ['住所']);
  const dstIdx_Tel = findAnyCol_(dstMap, ['電話番号']);
  const dstIdx_ProductName = findAnyCol_(dstMap, ['商品名']);  // H列

  const dstIdx_ShipStatus = findAnyCol_(dstMap, ['発送ステータス']);
  const dstIdx_ListInclude = findAnyCol_(dstMap, ['リスト同梱']);
  const dstIdx_XlsxSend = findAnyCol_(dstMap, ['xlsx送付']);
  const dstIdx_Status = findAnyCol_(dstMap, ['ステータス']);
  const dstIdx_PaymentStatus = findAnyCol_(dstMap, ['入金確認']);  // T列
  const dstIdx_ConfirmLink = findAnyCol_(dstMap, ['確認リンク']);  // I列
  const dstIdx_NotifyFlag = findAnyCol_(dstMap, ['受注通知', '通知フラグ']);  // AB列
  const dstIdx_ShippingStore = findAnyCol_(dstMap, ['送料(店負担)']);       // M列
  const dstIdx_ShippingCustomer = findAnyCol_(dstMap, ['送料(客負担)']);    // N列
  const dstIdx_PaymentMethod = findAnyCol_(dstMap, ['決済方法']);           // O列

  // BASE_注文シートの決済方法列を探索
  const idxPaymentMethod_Order = findAnyCol_(orderMap, ['決済方法', '支払方法', 'payment_method', 'paymentMethod', 'Payment Method', '支払い方法']);

  const requiredDstCols = [
    ['会社名/氏名', dstIdx_Name],
    ['連絡先', dstIdx_Email],
    ['郵便番号', dstIdx_Zip],
    ['住所', dstIdx_Address],
    ['電話番号', dstIdx_Tel],
    ['発送ステータス', dstIdx_ShipStatus],
    ['リスト同梱', dstIdx_ListInclude],
    ['xlsx送付', dstIdx_XlsxSend],
    ['ステータス', dstIdx_Status],
    ['受付番号', dstIdx_ReceiptNo],
    ['備考', dstIdx_Remarks],
    ['合計点数', dstIdx_TotalCount],
    ['合計金額', dstIdx_TotalAmount],
    ['依頼日時', dstIdx_RequestAt],
  ];

  for (const pair of requiredDstCols) {
    const name = pair[0];
    const idx = pair[1];
    if (idx === -1) throw new Error('「依頼管理」に必要列「' + name + '」が見つかりません');
  }

  const orderByKey = new Map();
  for (let r = 0; r < orders.length; r++) {
    const row = orders[r];
    const status = normalizeKey_(row[ORDER_STATUS_COL_1BASED - 1]);
    if (status !== ORDER_STATUS_VALUE) continue;

    const key = normalizeKey_(row[idxOrderKey_Order]);
    if (!key) continue;
    orderByKey.set(key, row);
  }

  const itemsByKey = new Map();
  for (let r = 0; r < items.length; r++) {
    const row = items[r];
    const key = normalizeKey_(row[idxOrderKey_Item]);
    if (!key) continue;

    const pid = normalizeKey_(row[idxProductId_Item]);
    if (!pid) continue;
    if (EXCLUDE_PRODUCT_IDS.has(pid)) continue;

    if (!itemsByKey.has(key)) itemsByKey.set(key, []);
    itemsByKey.get(key).push(row);
  }

  const existingKeys = new Set();
  const pidColInDst = findAnyCol_(dstMap, ['商品ID', 'product_id', 'productId', 'Product ID']);
  Logger.log('pidColInDst=' + pidColInDst);
  Logger.log('dstIdx_ProductName=' + dstIdx_ProductName);

  for (let r = 0; r < dstValues.length; r++) {
    const row = dstValues[r];
    const ok = normalizeKey_(row[dstIdx_ReceiptNo]);
    if (!ok) continue;

    // 重複チェック: 商品ID列があればそれを使用、なければ商品名(H列)を使用
    const subKey = (pidColInDst !== -1)
      ? normalizeKey_(row[pidColInDst])
      : (dstIdx_ProductName !== -1 ? normalizeKey_(row[dstIdx_ProductName]) : normalizeKey_(row[dstIdx_Remarks]));

    existingKeys.add(ok + '||' + subKey);
  }

  const newRows = [];
  const dstColCount = dstHeader.length;

  for (const entry of itemsByKey.entries()) {
    const orderKey = entry[0];
    const itemRows = entry[1];

    const orderRow = orderByKey.get(orderKey);
    if (!orderRow) continue;

    // --- 注文単位の送料計算 ---
    const baseShippingFee = (idxShipping_Order !== -1) ? (Number(orderRow[idxShipping_Order]) || 0) : 0;
    let shippingStore = 0;
    let shippingCustomer = 0;

    if (baseShippingFee > 0) {
      // BASE側で送料が設定されている → 客負担
      shippingCustomer = baseShippingFee;
    } else {
      // 送料0 → 送料表と住所から計算して店負担
      // お届け先の都道府県があればそちらを優先
      const rcvPrefForShip = (idxRcvPref_Order !== -1) ? String(orderRow[idxRcvPref_Order] || '').trim() : '';
      const orderPref = rcvPrefForShip || String(orderRow[idxPref_Order] || '').trim();
      // 注文内の合計点数（確認リンクがあるものは1として計算）
      let orderTotalQty = 0;
      for (let j = 0; j < itemRows.length; j++) {
        const qRaw = itemRows[j][idxQty_Item];
        const q = (qRaw == null || String(qRaw).trim() === '') ? 0 : Number(qRaw);
        orderTotalQty += q;
      }
      if (orderPref && typeof calcStoreShippingByAddress_ === 'function') {
        shippingStore = calcStoreShippingByAddress_(orderPref, orderTotalQty);
      }
    }

    let shippingSetForThisOrder = false;

    for (let i = 0; i < itemRows.length; i++) {
      const itemRow = itemRows[i];

      const pid = normalizeKey_(itemRow[idxProductId_Item]);
      const itemName = String(itemRow[idxProductName_Item] || '').trim();

      // 重複チェック: 商品ID列があればそれを使用、なければ商品名を使用（既存行チェックと同じロジック）
      const subKey = (pidColInDst !== -1) ? pid : itemName;
      const dedupKey = orderKey + '||' + normalizeKey_(subKey);

      if (existingKeys.has(dedupKey)) continue;

      const out = new Array(dstColCount).fill('');

      // お届け先情報があればそちらを優先（購入者≠届け先のケース）
      const rcvSurname = (idxRcvSurname_Order !== -1) ? String(orderRow[idxRcvSurname_Order] || '').trim() : '';
      const rcvGiven = (idxRcvGiven_Order !== -1) ? String(orderRow[idxRcvGiven_Order] || '').trim() : '';
      const hasReceiver = !!(rcvSurname || rcvGiven);

      const surname = hasReceiver ? rcvSurname : String(orderRow[idxSurname_Order] || '');
      const given = hasReceiver ? rcvGiven : String(orderRow[idxGiven_Order] || '');
      const fullName = (surname + given).trim();

      const email = String(orderRow[idxEmail_Order] || '').trim();

      const rcvZip = (hasReceiver && idxRcvZip_Order !== -1) ? String(orderRow[idxRcvZip_Order] || '').trim() : '';
      const zip = rcvZip || String(orderRow[idxZip_Order] || '').trim();

      const rcvPref = (hasReceiver && idxRcvPref_Order !== -1) ? String(orderRow[idxRcvPref_Order] || '').trim() : '';
      const rcvAddr1 = (hasReceiver && idxRcvAddr1_Order !== -1) ? String(orderRow[idxRcvAddr1_Order] || '').trim() : '';
      const rcvAddr2 = (hasReceiver && idxRcvAddr2_Order !== -1) ? String(orderRow[idxRcvAddr2_Order] || '').trim() : '';

      const pref = rcvPref || String(orderRow[idxPref_Order] || '').trim();
      const addr1 = rcvAddr1 || String(orderRow[idxAddr1_Order] || '').trim();
      const addr2 = (hasReceiver && rcvAddr2) ? rcvAddr2 : pickFirstNonDateText_(orderRow, addr2CandidateIdxs);
      const address = (pref + addr1 + addr2).trim();

      const rcvTel = (hasReceiver && idxRcvTel_Order !== -1) ? String(orderRow[idxRcvTel_Order] || '').trim() : '';
      const tel = rcvTel || String(orderRow[idxTel_Order] || '').trim();

      const subtotal = itemRow[idxSubtotal_Item];
      const qtyRaw = itemRow[idxQty_Item];
      const qty = (qtyRaw == null || String(qtyRaw).trim() === '') ? 0 : Number(qtyRaw);
      const updatedAt = itemRow[idxUpdatedAt_Item];

      out[dstIdx_Name] = fullName;
      out[dstIdx_Email] = email;
      out[dstIdx_Zip] = zip;
      out[dstIdx_Address] = address;
      out[dstIdx_Tel] = tel;
      if (dstIdx_ProductName !== -1) out[dstIdx_ProductName] = itemName;  // H列: 商品名

      out[dstIdx_ReceiptNo] = orderKey;
      out[dstIdx_Remarks] = '';  // V列: 備考（手入力用）
      out[dstIdx_TotalCount] = qty;
      out[dstIdx_TotalAmount] = subtotal;
      out[dstIdx_RequestAt] = updatedAt;

      out[dstIdx_ShipStatus] = '未着手';
      out[dstIdx_Status] = '依頼中';
      if (dstIdx_PaymentStatus !== -1) out[dstIdx_PaymentStatus] = '未対応';  // R列: 入金確認

      const hasXlsx = hasXlsx_(itemName);
      out[dstIdx_ListInclude] = hasXlsx ? '未' : '無し';
      out[dstIdx_XlsxSend] = hasXlsx ? '未' : '無し';

      // AA列: 通知フラグにFALSEを設定（発送通知の二重送信防止）
      if (dstIdx_NotifyFlag !== -1) out[dstIdx_NotifyFlag] = false;

      if (pidColInDst !== -1) {
        out[pidColInDst] = pid;
      }

      // AE列: 決済方法（BASE注文はBASE側で決済済み）
      if (dstIdx_PaymentMethod !== -1) {
        if (idxPaymentMethod_Order !== -1) {
          const rawMethod = String(orderRow[idxPaymentMethod_Order] || '').trim();
          out[dstIdx_PaymentMethod] = rawMethod || 'BASE決済';
        } else {
          out[dstIdx_PaymentMethod] = 'BASE決済';
        }
      }

      // 送料: 注文の最初の新規行にのみ設定（重複計上を防止）
      if (!shippingSetForThisOrder) {
        if (dstIdx_ShippingStore !== -1) out[dstIdx_ShippingStore] = shippingStore || '';
        if (dstIdx_ShippingCustomer !== -1) out[dstIdx_ShippingCustomer] = shippingCustomer || '';
        shippingSetForThisOrder = true;
      }

      existingKeys.add(dedupKey);
      newRows.push(out);
    }
  }

  if (newRows.length === 0) return;

  const startRow = findAppendRowByMainCol_(shDst, dstIdx_ReceiptNo + 1);
  shDst.getRange(startRow, 1, newRows.length, dstColCount).setValues(newRows);
}

function buildHeaderMap_(headerRow) {
  const map = {};
  for (let c = 0; c < headerRow.length; c++) {
    const name = String(headerRow[c] || '').trim();
    if (!name) continue;
    map[name] = c;
  }
  return map;
}

function findAnyCol_(headerMap, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const k = candidates[i];
    if (headerMap.hasOwnProperty(k)) return headerMap[k];
  }
  const keys = Object.keys(headerMap);
  for (let i = 0; i < candidates.length; i++) {
    const cnd = String(candidates[i] || '').trim().toLowerCase();
    if (!cnd) continue;
    for (let j = 0; j < keys.length; j++) {
      const hk = String(keys[j] || '').trim().toLowerCase();
      if (hk === cnd) return headerMap[keys[j]];
    }
  }
  return -1;
}

// normalizeKey_ はコード.gsで定義済み

function findAppendRowByMainCol_(sheet, col1Based) {
  const last = sheet.getLastRow();
  if (last < 2) return 2;
  const rng = sheet.getRange(2, col1Based, last - 1, 1).getValues();
  let lastFilled = 1;
  for (let i = 0; i < rng.length; i++) {
    if (String(rng[i][0] || '').trim() !== '') lastFilled = i + 2;
  }
  return lastFilled + 1;
}

function hasXlsx_(text) {
  const s = String(text || '').toLowerCase();
  return s.indexOf('xlsx') !== -1;
}

function buildAddr2CandidateIdxs_(headerRow, firstIdx) {
  const idxs = [];
  const push = (i) => {
    if (i == null || i < 0) return;
    if (idxs.indexOf(i) !== -1) return;
    idxs.push(i);
  };

  push(firstIdx);

  const includeWords = [
    '住所2', '住所（建物名）', '住所(建物名)', '建物名', 'マンション', 'マンション名', 'ビル', '部屋', '部屋番号', '号室',
    'address2', 'address_2', 'address line 2', 'line2', 'apt', 'apartment', 'suite', 'unit', 'building', 'room'
  ];

  const excludeWords = [
    '日時', '日付', '更新', '作成', '注文日時', '購入日時', '決済', '発送', '配達', '配送',
    'delivery', 'shipping', 'paid', 'updated', 'time', 'date'
  ];

  for (let c = 0; c < headerRow.length; c++) {
    const h = String(headerRow[c] || '').trim();
    if (!h) continue;

    const hl = h.toLowerCase();

    let ok = false;
    for (let i = 0; i < includeWords.length; i++) {
      const w = String(includeWords[i] || '').toLowerCase();
      if (!w) continue;
      if (hl.indexOf(w) !== -1) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;

    let ng = false;
    for (let i = 0; i < excludeWords.length; i++) {
      const w = String(excludeWords[i] || '').toLowerCase();
      if (!w) continue;
      if (hl.indexOf(w) !== -1) {
        ng = true;
        break;
      }
    }
    if (ng) continue;

    push(c);
  }

  return idxs;
}

function pickFirstNonDateText_(row, idxs) {
  for (let i = 0; i < idxs.length; i++) {
    const c = idxs[i];
    const v = row[c];
    if (v == null) continue;
    if (isDateLike_(v)) continue;
    const s = String(v || '').trim();
    if (!s) continue;
    return s;
  }
  return '';
}

function isDateLike_(v) {
  if (v instanceof Date) return true;

  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return true;
    return false;
  }

  const s = String(v || '').trim();
  if (!s) return false;

  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) return true;

  return false;
}
