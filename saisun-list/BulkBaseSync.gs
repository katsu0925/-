// BulkBaseSync.gs
// =====================================================
// BASE ↔ アソート商品 在庫・商品情報同期
// =====================================================
// 前提: BASE APIスコープに read_items, write_items が必要
//       BASEAPI.gs の basePrintAuthUrl() で再認証すること

/**
 * BASE商品一覧を取得（全件ページング対応）
 */
function baseListAllItems_() {
  var allItems = [];
  var offset = 0;
  var limit = 100;

  while (true) {
    var res = baseApiGet_('/1/items', { offset: String(offset), limit: String(limit) });
    var items = (res && Array.isArray(res.items)) ? res.items : [];
    if (items.length === 0) break;

    for (var i = 0; i < items.length; i++) {
      allItems.push(items[i]);
    }

    offset += items.length;
    if (items.length < limit) break;
  }

  return allItems;
}

/**
 * BASE商品の在庫を更新
 * @param {number|string} itemId - BASE商品ID
 * @param {number} stock - 在庫数
 * @param {number} [variationId] - バリエーションID（あれば）
 */
function baseUpdateStock_(itemId, stock, variationId) {
  var url = BASE_APP.API_BASE + '/1/items/edit_stock';
  var token = baseGetAccessToken_();

  var payload = {
    item_id: String(itemId),
    stock: String(Math.max(0, stock)),
    stock_edited: '1'
  };
  if (variationId) {
    payload.variation_id = String(variationId);
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/x-www-form-urlencoded',
    payload: baseToFormEncoded_(payload),
    muteHttpExceptions: true
  });

  var rc = resp.getResponseCode();
  if (rc < 200 || rc >= 300) {
    throw new Error('BASE在庫更新失敗 item=' + itemId + ' rc=' + rc + ' ' + resp.getContentText());
  }
}

// =====================================================
// BASE 画像同期
// =====================================================

/**
 * BASE商品に画像をアップロード（既存画像を上書き）
 * @param {string} itemId - BASE商品ID
 * @param {number} imageNo - 画像番号（1-5）
 * @param {string} imageUrl - 画像URL
 * @returns {boolean} 成功したか
 */
/**
 * アソート商品の画像（最大5枚）をBASEに同期
 * /1/items/add_image に image_url パラメータでURL直接登録
 * @param {string} itemId - BASE商品ID
 * @param {string[]} imageUrls - 画像URL配列（最大5要素）
 * @returns {number} 登録成功数
 */
function baseSyncImages_(itemId, imageUrls) {
  var token = baseGetAccessToken_();
  var uploaded = 0;

  for (var i = 0; i < 5; i++) {
    var url = (i < imageUrls.length) ? imageUrls[i] : '';

    if (url) {
      // image_url パラメータでURL直接登録
      try {
        var resp = UrlFetchApp.fetch(BASE_APP.API_BASE + '/1/items/add_image', {
          method: 'post',
          headers: { Authorization: 'Bearer ' + token },
          contentType: 'application/x-www-form-urlencoded',
          payload: baseToFormEncoded_({ item_id: String(itemId), image_no: String(i + 1), image_url: url }),
          muteHttpExceptions: true
        });
        var rc = resp.getResponseCode();
        if (rc >= 200 && rc < 300) {
          uploaded++;
        } else {
          console.error('BASE画像登録失敗 img' + (i + 1) + ' rc=' + rc + ' ' + resp.getContentText());
        }
      } catch (e) {
        console.error('BASE画像登録エラー img' + (i + 1) + ': ' + (e.message || e));
      }
    } else {
      // 画像URLが空 → 既存画像を削除（エラーは無視）
      baseDeleteImage_(itemId, i + 1);
    }

    Utilities.sleep(300);
  }

  if (uploaded > 0) console.log('BASE画像同期: item=' + itemId + ' ' + uploaded + '枚登録');
  return uploaded;
}

/**
 * BASE商品の画像を削除
 */
function baseDeleteImage_(itemId, imageNo) {
  try {
    var token = baseGetAccessToken_();
    var resp = UrlFetchApp.fetch(BASE_APP.API_BASE + '/1/items/delete_image', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      contentType: 'application/x-www-form-urlencoded',
      payload: baseToFormEncoded_({ item_id: String(itemId), image_no: String(imageNo) }),
      muteHttpExceptions: true
    });
    return resp.getResponseCode() >= 200 && resp.getResponseCode() < 300;
  } catch (e) {
    return false;
  }
}

/**
 * 画像同期テスト — GASエディタから手動実行
 * アソート商品の最初の1件で全画像を同期してBASE側を確認
 */
function baseTestImageSync() {
  var ss = bulk_getSs_();
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) throw new Error('アソート商品シートが見つかりません');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('商品がありません');

  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

  for (var r = 0; r < data.length; r++) {
    var baseItemId = String(data[r][c.baseItemId] || '').trim();
    var img1 = String(data[r][c.image1] || '').trim();
    if (!baseItemId || !img1) continue;

    var name = String(data[r][c.name] || '').trim();
    var imageUrls = [
      img1,
      String(data[r][c.image2] || '').trim(),
      String(data[r][c.image3] || '').trim(),
      String(data[r][c.image4] || '').trim(),
      String(data[r][c.image5] || '').trim()
    ];

    console.log('=== テスト: ' + name + ' (ID: ' + baseItemId + ') ===');
    console.log('画像URL: ' + JSON.stringify(imageUrls));

    var count = baseSyncImages_(baseItemId, imageUrls);
    console.log('結果: ' + count + '枚登録');

    Utilities.sleep(2000);

    // BASE側確認
    try {
      var detail = baseApiGet_('/1/items/detail/' + baseItemId, null);
      var item = detail.item || detail;
      console.log('--- BASE側の画像状態 ---');
      for (var i = 1; i <= 5; i++) {
        console.log('img' + i + '_origin: ' + (item['img' + i + '_origin'] || '(なし)'));
      }
    } catch (e) { console.error('詳細取得失敗: ' + e); }

    return;
  }
  console.log('テスト対象なし');
}

/**
 * BASE商品とアソート商品を商品名で自動マッチし、R列にBASE商品IDを書き込む
 * GASエディタから手動実行する（初回紐付け用）
 */
function baseMatchBulkProducts() {
  var baseItems = baseListAllItems_();
  console.log('BASE商品数: ' + baseItems.length);

  var ss = bulk_getSs_();
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) throw new Error('アソート商品シートが見つかりません');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { console.log('アソート商品がありません'); return; }

  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

  // BASE商品名→item_idマップ
  var baseNameMap = {};
  for (var i = 0; i < baseItems.length; i++) {
    var item = baseItems[i];
    var name = String(item.title || '').trim();
    if (name) baseNameMap[name] = item.item_id;
  }

  var matched = 0;
  var unmatched = [];

  for (var r = 0; r < data.length; r++) {
    var bulkName = String(data[r][c.name] || '').trim();
    var existingBaseId = String(data[r][c.baseItemId] || '').trim();

    if (!bulkName) continue;

    // 既にBASE商品IDが入っていればスキップ
    if (existingBaseId) {
      matched++;
      continue;
    }

    // 完全一致で検索
    var baseId = baseNameMap[bulkName];

    // 見つからない場合、部分一致を試す
    if (!baseId) {
      var baseNames = Object.keys(baseNameMap);
      for (var j = 0; j < baseNames.length; j++) {
        if (baseNames[j].indexOf(bulkName) !== -1 || bulkName.indexOf(baseNames[j]) !== -1) {
          baseId = baseNameMap[baseNames[j]];
          console.log('部分一致: 「' + bulkName + '」→「' + baseNames[j] + '」(ID:' + baseId + ')');
          break;
        }
      }
    }

    if (baseId) {
      data[r][c.baseItemId] = baseId;
      matched++;
      console.log('マッチ: 「' + bulkName + '」→ BASE ID:' + baseId);
    } else {
      unmatched.push(bulkName);
    }
  }

  // 書き戻し
  sh.getRange(2, 1, data.length, BULK_SHEET_HEADER.length).setValues(data);

  console.log('マッチ完了: ' + matched + '件マッチ / ' + unmatched.length + '件未マッチ');
  if (unmatched.length > 0) {
    console.log('未マッチ商品: ' + unmatched.join(', '));
  }

  // BASE側の未マッチ商品も表示
  var usedBaseIds = new Set();
  for (var r2 = 0; r2 < data.length; r2++) {
    var bid = String(data[r2][c.baseItemId] || '').trim();
    if (bid) usedBaseIds.add(bid);
  }
  var unmatchedBase = [];
  for (var k = 0; k < baseItems.length; k++) {
    if (!usedBaseIds.has(String(baseItems[k].item_id))) {
      unmatchedBase.push(baseItems[k].title + ' (ID:' + baseItems[k].item_id + ')');
    }
  }
  if (unmatchedBase.length > 0) {
    console.log('BASE側未マッチ: ' + unmatchedBase.join(', '));
  }
}

/**
 * アソート商品の在庫をBASEに一括プッシュ
 * アソート側の在庫数をBASE側に反映する
 */
function basePushAllStock() {
  var ss = bulk_getSs_();
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) throw new Error('アソート商品シートが見つかりません');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

  var updated = 0;
  var skipped = 0;
  var errors = 0;

  for (var r = 0; r < data.length; r++) {
    var baseItemId = String(data[r][c.baseItemId] || '').trim();
    if (!baseItemId) { skipped++; continue; }

    var stock = data[r][c.stock];
    stock = (stock === '' || stock === null || stock === undefined) ? -1 : Number(stock);
    if (isNaN(stock)) stock = -1;

    // 無制限の場合はBASE側に999をセット
    var baseStock = (stock === -1) ? 999 : stock;

    try {
      baseUpdateStock_(baseItemId, baseStock);
      updated++;
      console.log('在庫更新: ' + data[r][c.name] + ' → ' + baseStock);
    } catch (e) {
      errors++;
      console.error('在庫更新エラー: ' + data[r][c.name] + ' - ' + (e.message || e));
    }

    Utilities.sleep(300);
  }

  console.log('BASE在庫プッシュ完了: 更新' + updated + '件 / スキップ' + skipped + '件 / エラー' + errors + '件');
}

/**
 * デタウリで在庫が変わった際にBASEの在庫も更新する
 * bulk_deductStock_() の後に呼ばれる
 * @param {string} productId - アソート商品ID
 */
function baseSyncSingleStock_(productId) {
  var ss = bulk_getSs_();
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

  for (var r = 0; r < data.length; r++) {
    if (String(data[r][c.productId] || '').trim() !== productId) continue;

    var baseItemId = String(data[r][c.baseItemId] || '').trim();
    if (!baseItemId) return;

    var stock = data[r][c.stock];
    stock = (stock === '' || stock === null || stock === undefined) ? -1 : Number(stock);
    if (isNaN(stock)) stock = -1;

    var baseStock = (stock === -1) ? 999 : Math.max(0, stock);
    baseUpdateStock_(baseItemId, baseStock);
    console.log('BASE在庫同期: ' + productId + ' → ' + baseStock);
    return;
  }
}

/**
 * BASEの注文が来た時にアソート在庫を減らす
 * baseSyncOrdersNow() の後に呼ばれる
 */
function baseSyncStockFromOrders_() {
  try {
    var ss = baseGetTargetSpreadsheet_();
    var shItem = ss.getSheetByName('BASE_注文商品');
    if (!shItem) return;

    var itemLastRow = shItem.getLastRow();
    if (itemLastRow < 2) return;

    var itemHeader = shItem.getRange(1, 1, 1, shItem.getLastColumn()).getValues()[0];
    var itemMap = buildHeaderMap_(itemHeader);

    var idxBaseItemId = findAnyCol_(itemMap, ['商品ID']);
    var idxQty = findAnyCol_(itemMap, ['数量']);
    var idxStatus = findAnyCol_(itemMap, ['ステータス']);
    var idxName = findAnyCol_(itemMap, ['商品名']);
    if (idxBaseItemId === -1 || idxQty === -1) return;

    var items = shItem.getRange(2, 1, itemLastRow - 1, shItem.getLastColumn()).getValues();

    // アソート商品シートを読む
    var bulkSs = bulk_getSs_();
    var bulkSh = bulkSs.getSheetByName(BULK_CONFIG.sheetName);
    if (!bulkSh) return;

    var bulkLastRow = bulkSh.getLastRow();
    if (bulkLastRow < 2) return;

    var c = BULK_CONFIG.cols;
    var bulkData = bulkSh.getRange(2, 1, bulkLastRow - 1, BULK_SHEET_HEADER.length).getValues();

    // BASE商品ID（R列）→ 行インデックスマップ
    var baseIdToRow = {};
    for (var r = 0; r < bulkData.length; r++) {
      var bid = String(bulkData[r][c.baseItemId] || '').trim();
      if (bid) baseIdToRow[bid] = r;
    }

    // 処理済みチェック用のプロパティ
    var props = PropertiesService.getScriptProperties();
    var lastProcessed = props.getProperty('BASE_STOCK_LAST_ITEM_ROW') || '0';
    var lastProcessedRow = Number(lastProcessed) || 0;

    var changed = false;
    for (var i = lastProcessedRow; i < items.length; i++) {
      var orderBaseId = String(items[i][idxBaseItemId] || '').trim();
      var qty = Number(items[i][idxQty]) || 0;
      var status = (idxStatus !== -1) ? String(items[i][idxStatus] || '').trim() : '';

      if (status === 'キャンセル') continue;
      if (!orderBaseId || qty <= 0) continue;

      var bulkRow = baseIdToRow[orderBaseId];
      if (bulkRow === undefined) continue;

      var currentStock = bulkData[bulkRow][c.stock];
      currentStock = (currentStock === '' || currentStock === null || currentStock === undefined) ? -1 : Number(currentStock);
      if (currentStock === -1) continue; // 無制限はスキップ

      var newStock = Math.max(0, currentStock - qty);
      bulkData[bulkRow][c.stock] = newStock;
      changed = true;
      var itemLabel = (idxName !== -1) ? String(items[i][idxName] || '').trim() : orderBaseId;
      console.log('BASE注文在庫減: ' + itemLabel + ' (ID:' + orderBaseId + ') ' + currentStock + ' → ' + newStock);
    }

    if (changed) {
      bulkSh.getRange(2, 1, bulkData.length, BULK_SHEET_HEADER.length).setValues(bulkData);
      bulk_clearCache_();
    }

    props.setProperty('BASE_STOCK_LAST_ITEM_ROW', String(items.length));
  } catch (e) {
    console.error('baseSyncStockFromOrders_ error: ' + (e.message || e));
  }
}

// =====================================================
// アソート商品 → BASE 商品情報同期（定期実行）
// =====================================================

/**
 * BASE商品を編集（タイトル・説明・価格・在庫・公開状態）
 * バリエーション商品はpriceを受け付けないため、400エラー時にprice抜きでリトライ
 */
function baseEditItem_(itemId, params) {
  var url = BASE_APP.API_BASE + '/1/items/edit';
  var token = baseGetAccessToken_();

  params.item_id = String(itemId);

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/x-www-form-urlencoded',
    payload: baseToFormEncoded_(params),
    muteHttpExceptions: true
  });

  var rc = resp.getResponseCode();
  if (rc === 400 && params.price) {
    // バリエーション商品はprice編集不可 → price抜きでリトライ
    console.log('BASE編集400エラー: price抜きでリトライ item=' + itemId);
    var retryParams = {};
    for (var k in params) {
      if (k !== 'price') retryParams[k] = params[k];
    }
    var resp2 = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      contentType: 'application/x-www-form-urlencoded',
      payload: baseToFormEncoded_(retryParams),
      muteHttpExceptions: true
    });
    var rc2 = resp2.getResponseCode();
    if (rc2 < 200 || rc2 >= 300) {
      throw new Error('BASE商品編集失敗(リトライ) item=' + itemId + ' rc=' + rc2 + ' ' + resp2.getContentText());
    }
    return;
  }

  if (rc < 200 || rc >= 300) {
    throw new Error('BASE商品編集失敗 item=' + itemId + ' rc=' + rc + ' ' + resp.getContentText());
  }
}

/**
 * BASE商品を新規登録
 * @returns {string} 作成された商品ID
 */
function baseAddItem_(params) {
  var url = BASE_APP.API_BASE + '/1/items/add';
  var token = baseGetAccessToken_();

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/x-www-form-urlencoded',
    payload: baseToFormEncoded_(params),
    muteHttpExceptions: true
  });

  var rc = resp.getResponseCode();
  var text = resp.getContentText();
  if (rc < 200 || rc >= 300) {
    throw new Error('BASE商品登録失敗 rc=' + rc + ' ' + text);
  }

  var result = text ? JSON.parse(text) : {};
  var item = result.item || result;
  return String(item.item_id || '');
}

/**
 * アソート商品の変更をBASEに同期（差分のみ）
 * 5分ごとのトリガーで自動実行される
 */
function baseSyncProductsToBase() {
  var ss = bulk_getSs_();
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();

  // 前回のスナップショットを取得
  var props = PropertiesService.getScriptProperties();
  var prevJson = props.getProperty('BASE_SYNC_SNAPSHOT') || '{}';
  var prev;
  try { prev = JSON.parse(prevJson); } catch (e) { prev = {}; }

  var current = {};
  var updated = 0;
  var created = 0;
  var skipped = 0;
  var sheetChanged = false;

  for (var r = 0; r < data.length; r++) {
    var baseItemId = String(data[r][c.baseItemId] || '').trim();
    var name = String(data[r][c.name] || '').trim();
    if (!name) { skipped++; continue; }

    var description = String(data[r][c.description] || '').trim();
    var price = Number(data[r][c.price]) || 0;
    var active = data[r][c.active];
    var isActive = (active === true || String(active).toUpperCase() === 'TRUE');
    var stockRaw = data[r][c.stock];
    var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
    if (isNaN(stock)) stock = -1;
    var baseStock = stock === -1 ? 999 : Math.max(0, stock);

    // 画像URL取得（G-K列）
    var imageUrls = [
      String(data[r][c.image1] || '').trim(),
      String(data[r][c.image2] || '').trim(),
      String(data[r][c.image3] || '').trim(),
      String(data[r][c.image4] || '').trim(),
      String(data[r][c.image5] || '').trim()
    ];

    // BASE商品IDが未設定 → 新規登録
    if (!baseItemId) {
      if (!isActive) { skipped++; continue; } // 非公開は登録しない
      if (price <= 0) { skipped++; continue; } // 価格0は登録しない

      try {
        var newId = baseAddItem_({
          title: name,
          detail: description,
          price: String(price),
          stock: String(baseStock),
          visible: isActive ? '1' : '0',
          identifier: String(data[r][c.productId] || '').trim()
        });

        if (newId) {
          data[r][c.baseItemId] = newId;
          baseItemId = newId;
          sheetChanged = true;
          created++;
          console.log('BASE新規登録: ' + name + ' → ID:' + newId);

          // 新規登録後に画像をアップロード
          var hasNewImages = imageUrls.some(function(u) { return !!u; });
          if (hasNewImages) {
            try {
              var imgCount = baseSyncImages_(newId, imageUrls);
              console.log('BASE画像アップロード: ' + name + ' (' + imgCount + '枚)');
            } catch (imgE) {
              console.error('BASE画像エラー: ' + name + ' - ' + (imgE.message || imgE));
            }
          }

          // スナップショット登録して次の商品へ
          current[newId] = name + '|' + description + '|' + price + '|' + isActive + '|' + stock + '|' + imageUrls.join(',');
        }
      } catch (e) {
        console.error('BASE新規登録エラー: ' + name + ' - ' + (e.message || e));
      }

      Utilities.sleep(300);
      continue;
    }

    // 現在の状態をハッシュ化して比較（画像URLも含む）
    var hash = name + '|' + description + '|' + price + '|' + isActive + '|' + stock + '|' + imageUrls.join(',');
    current[baseItemId] = hash;

    if (prev[baseItemId] === hash) { skipped++; continue; }

    // 差分あり → BASEに反映（商品情報 + 在庫）
    try {
      baseEditItem_(baseItemId, {
        title: name,
        detail: description,
        price: String(price),
        visible: isActive ? '1' : '0'
      });
      baseUpdateStock_(baseItemId, baseStock);
      updated++;
      console.log('BASE同期: ' + name + ' (変更あり, 在庫:' + baseStock + ')');
    } catch (e) {
      console.error('BASE同期エラー: ' + name + ' - ' + (e.message || e));
    }

    // 画像の差分チェック — 画像部分が変わった場合のみ画像同期
    var prevHash = prev[baseItemId] || '';
    var prevParts = prevHash.split('|');
    var prevImgPart = prevParts.length >= 6 ? prevParts.slice(5).join('|') : '';
    var curImgPart = imageUrls.join(',');
    if (prevImgPart !== curImgPart) {
      var hasImages = imageUrls.some(function(u) { return !!u; });
      if (hasImages) {
        try {
          var imgUpdated = baseSyncImages_(baseItemId, imageUrls);
          console.log('BASE画像更新: ' + name + ' (' + imgUpdated + '枚)');
        } catch (imgE) {
          console.error('BASE画像更新エラー: ' + name + ' - ' + (imgE.message || imgE));
        }
      }
    }

    Utilities.sleep(300);
  }

  // R列にBASE商品IDが書き込まれた場合、シートに反映
  if (sheetChanged) {
    sh.getRange(2, 1, data.length, BULK_SHEET_HEADER.length).setValues(data);
  }

  // スナップショット保存
  props.setProperty('BASE_SYNC_SNAPSHOT', JSON.stringify(current));

  if (updated > 0 || created > 0) {
    console.log('BASE商品同期完了: 新規' + created + '件 / 更新' + updated + '件 / スキップ' + skipped + '件');
  }
}

/**
 * BASE商品同期トリガーを設定（5分ごと）
 * GASエディタから1回実行する
 */
function baseInstallProductSync() {
  var fn = 'baseSyncProductsToBase';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === fn) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
  console.log('BASE商品同期トリガーを設定しました（5分ごと）');
}
