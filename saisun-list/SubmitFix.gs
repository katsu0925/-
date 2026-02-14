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

    var list = u_unique_(u_normalizeIds_(ids || []));
    if (!list.length) return { ok: false, message: 'カートが空です' };

    var f = form || {};
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

    if (!companyName) return { ok: false, message: '会社名/氏名は必須です' };
    if (!contact) return { ok: false, message: 'メールアドレスは必須です' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, message: '有効なメールアドレスを入力してください' };
    if (!postal) return { ok: false, message: '郵便番号は必須です' };
    if (!address) return { ok: false, message: '住所は必須です' };
    if (!phone) return { ok: false, message: '電話番号は必須です' };

    // === 読み取り専用操作（ロック外で先に実行 → 高速化） ===
    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    // 商品データを先に読み込み（スプレッドシート読み取りは重いためロック外で実行）
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) productMap[String(products[i].managedId)] = products[i];

    // 商品存在チェック（ロック不要）
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var p = productMap[list[i]];
      if (!p) return { ok: false, message: '商品が見つかりません: ' + list[i] };
      sum += Number(p.price || 0);
    }

    // === 価格計算（ロック不要の演算） ===
    var totalCount = list.length;
    var discountRate = 0;

    // 30点以上割引（10%）
    if (totalCount >= 30) discountRate += 0.10;

    // 会員割引（ログイン会員のみ、enabled時のみ）
    var memberDiscountStatus = app_getMemberDiscountStatus_();
    if (memberDiscountStatus.enabled && contact) {
      var custForDiscount = findCustomerByEmail_(contact);
      if (custForDiscount) {
        discountRate += memberDiscountStatus.rate;
      }
    }

    if (measureOpt === 'without') discountRate += 0.05;
    // ※割引は商品代のみに適用。送料は割引対象外（税込み固定）。
    var discounted = Math.round(sum * (1 - discountRate));

    // === 送料計算（ロック不要） ===
    var shippingAmount = Math.max(0, Math.floor(Number(f.shippingAmount || 0)));
    var shippingSize = String(f.shippingSize || '');
    var shippingArea = String(f.shippingArea || '');
    var shippingPref = String(f.shippingPref || '');

    // === ポイント利用額の事前計算（ロック不要） ===
    var pointsUsed = 0;
    var custForPoints = null;
    if (usePoints > 0 && contact) {
      custForPoints = findCustomerByEmail_(contact);
      if (custForPoints && custForPoints.points >= usePoints) {
        pointsUsed = Math.min(usePoints, discounted); // 合計金額を超えない
        discounted = discounted - pointsUsed;
      }
    }

    // === 送料を備考に追記 ===
    if (pointsUsed > 0) {
      if (note) {
        note += '\n【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
      } else {
        note = '【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
      }
    }
    if (shippingAmount > 0) {
      var shippingLabel = '【送料: ¥' + shippingAmount.toLocaleString() + '（' + (shippingPref || '') + '・' + (shippingSize === 'small' ? '小' : '大') + '・税込）】';
      note = note ? (note + '\n' + shippingLabel) : shippingLabel;
    }

    // 送料込みの合計金額
    var totalWithShipping = discounted + shippingAmount;

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
    if (!lock.tryLock(30000)) {
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

    // === 商品を確保→依頼中に移行（決済完了まで予約） ===
    for (var i = 0; i < list.length; i++) {
      delete holdItems[list[i]];
    }
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);
    st_invalidateStatusCache_(orderSs);

    // openState に追加（依頼中として記録）
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    for (var j = 0; j < list.length; j++) {
      openItems[list[j]] = { receiptNo: receiptNo, status: APP_CONFIG.statuses.open, updatedAtMs: now };
    }
    openState.items = openItems;
    openState.updatedAt = now;
    st_setOpenState_(orderSs, openState);

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
      discounted: totalWithShipping,
      shippingAmount: shippingAmount,
      shippingSize: shippingSize,
      shippingArea: shippingArea,
      shippingPref: shippingPref,
      createdAtMs: now,
      templateText: templateText,
      itemDetails: itemDetails,
      pointsUsed: pointsUsed
    };

    var props = PropertiesService.getScriptProperties();
    props.setProperty('PENDING_ORDER_' + receiptNo, JSON.stringify(pendingData));
    console.log('ペンディング注文を保存: ' + receiptNo);

    // === KOMOJU決済セッションを作成 ===
    var komojuResult = apiCreateKomojuSession(receiptNo, totalWithShipping, {
      email: contact,
      companyName: companyName,
      productAmount: discounted,
      shippingAmount: shippingAmount,
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

    return {
      ok: true,
      receiptNo: receiptNo,
      sessionUrl: komojuResult.sessionUrl,
      totalAmount: totalWithShipping,
      shippingAmount: shippingAmount
    };

  } catch (e) {
    console.error('apiSubmitEstimate error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// バックグラウンド書き込み処理（レガシー互換）
// =====================================================

function scheduleBackgroundProcess_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processSubmitQueue') {
      return;
    }
  }
  ScriptApp.newTrigger('processSubmitQueue')
    .timeBased()
    .after(1000)
    .create();
}

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
    try { lock.releaseLock(); } catch (x) {}
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
  // 列構成（32列 A-AF）:
  // A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=発送ステータス, N=リスト同梱, O=xlsx送付,
  // P=ステータス, Q=担当者, R=入金確認, S=インボイス発行, T=インボイス状況, U=予備, V=備考,
  // W=配送業者, X=伝票番号, Y=作業報酬, Z=更新日時, AA=通知フラグ,
  // AB=ポイント付与済, AC=送料(店負担), AD=送料(客負担), AE=決済方法, AF=決済ID
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var productNames = '選べるxlsx付きパッケージ';
  var paymentStatus = data.paymentStatus || '対応済';
  var row = [
    data.receiptNo,                              // A: 受付番号
    new Date(now),                               // B: 依頼日時
    data.form.companyName || '',                 // C: 会社名/氏名
    data.form.contact || '',                     // D: 連絡先
    data.form.postal || '',                      // E: 郵便番号
    data.form.address || '',                     // F: 住所
    data.form.phone || '',                       // G: 電話番号
    productNames,                                // H: 商品名
    createOrderConfirmLink_(data.receiptNo, data),  // I: 確認リンク（Drive共有URL）
    data.selectionList || data.ids.join('、'),   // J: 選択リスト
    data.ids.length,                             // K: 合計点数
    data.discounted || 0,                        // L: 合計金額
    '未着手',                                     // M: 発送ステータス
    '未',                                         // N: リスト同梱
    '未',                                         // O: xlsx送付
    APP_CONFIG.statuses.open,                    // P: ステータス
    '',                                          // Q: 担当者
    paymentStatus,                               // R: 入金確認
    data.form.invoiceReceipt ? '希望' : '',      // S: 領収書希望
    '',                                          // T: 領収書送付済
    '',                                          // U: 予備
    data.form.note || '',                        // V: 備考
    '',                                          // W: 配送業者
    '',                                          // X: 伝票番号
    '',                                          // Y: 作業報酬
    new Date(now),                               // Z: 更新日時
    '',                                          // AA: 通知フラグ
    '',                                          // AB: ポイント付与済
    '',                                          // AC: 送料(店負担)
    data.shippingAmount || '',                   // AD: 送料(客負担)
    data.paymentMethod || '',                    // AE: 決済方法
    data.paymentId || ''                         // AF: 決済ID
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

  // 3. 管理者宛注文通知メール
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
    totalCount: data.totalCount || data.ids.length,
    discounted: data.discounted || 0,
    selectionList: data.selectionList || data.ids.join('、'),
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

function refreshTestSubmission() {
  var testUserKey = '';
  var testIds = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var holdCleared = clearHoldSheetForRefresh_(ss, testUserKey, testIds);
  var statusReset = resetProductStatusForRefresh_(ss, testIds);
  console.log('='.repeat(50));
  console.log('リフレッシュ完了');
  console.log('確保クリア: ' + holdCleared + '件');
  console.log('ステータスリセット: ' + statusReset + '件');
  console.log('='.repeat(50));
}

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

function clearHoldSheetForRefresh_(ss, userKey, ids) {
  var sheet = ss.getSheetByName('確保');
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var range = sheet.getRange(2, 1, lastRow - 1, 2);
  var values = range.getValues();
  var rowsToDelete = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var holdUserKey = String(values[i][0] || '').trim();
    var holdId = String(values[i][1] || '').trim();
    var matchUser = !userKey || holdUserKey === userKey;
    var matchId = !ids || ids.length === 0 || ids.indexOf(holdId) !== -1;
    if (matchUser && matchId) rowsToDelete.push(i + 2);
  }
  for (var j = 0; j < rowsToDelete.length; j++) sheet.deleteRow(rowsToDelete[j]);
  return rowsToDelete.length;
}

function resetProductStatusForRefresh_(ss, ids) {
  var sheet = ss.getSheetByName('データ1');
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  var range = sheet.getRange(3, 10, lastRow - 2, 2);
  var values = range.getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][0] || '');
    var managedId = String(values[i][1] || '').trim();
    var isTarget = (status.indexOf('依頼中') !== -1 || status.indexOf('確保中') !== -1);
    var matchId = !ids || ids.length === 0 || ids.indexOf(managedId) !== -1;
    if (isTarget && matchId) { sheet.getRange(i + 3, 10).setValue(''); count++; }
  }
  return count;
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
function confirmPaymentAndCreateOrder(receiptNo, paymentStatus, paymentMethod, paymentId) {
  try {
    if (!receiptNo) {
      return { ok: false, message: '受付番号が必要です' };
    }

    var props = PropertiesService.getScriptProperties();
    var pendingKey = 'PENDING_ORDER_' + receiptNo;
    var pendingDataStr = props.getProperty(pendingKey);

    if (!pendingDataStr) {
      console.log('PENDING_ORDER not found: ' + receiptNo);
      // ペンディングがない場合は既にシートに書き込み済みの可能性 → ステータスのみ更新
      updateOrderPaymentStatus_(receiptNo, 'paid', paymentMethod);
      return { ok: true, message: '入金ステータスを更新しました（ペンディングデータなし）' };
    }

    var pendingData = JSON.parse(pendingDataStr);
    console.log('Found pending order: ' + receiptNo + ', items: ' + pendingData.ids.length);

    var orderSs = sh_getOrderSs_();
    var now = u_nowMs_();

    // 1. open状態を再確認（apiSubmitEstimateで既に設定済み）
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    for (var i = 0; i < pendingData.ids.length; i++) {
      var id = pendingData.ids[i];
      openItems[id] = {
        receiptNo: receiptNo,
        userKey: pendingData.userKey,
        createdAtMs: now
      };
    }
    openState.items = openItems;
    openState.updatedAt = now;
    st_setOpenState_(orderSs, openState);

    // 2. 決済情報を付与してシート書き込み + メール送信
    var writeData = {
      userKey: pendingData.userKey,
      form: pendingData.form,
      ids: pendingData.ids,
      receiptNo: receiptNo,
      selectionList: pendingData.selectionList,
      measureOpt: pendingData.measureOpt,
      totalCount: pendingData.totalCount,
      discounted: pendingData.discounted,
      shippingAmount: pendingData.shippingAmount,
      shippingSize: pendingData.shippingSize,
      shippingArea: pendingData.shippingArea,
      shippingPref: pendingData.shippingPref,
      createdAtMs: now,
      templateText: pendingData.templateText,
      measureLabel: app_measureOptLabel_(pendingData.measureOpt),
      paymentStatus: paymentStatus || '対応済',
      paymentMethod: paymentMethod || '',
      paymentId: paymentId || '',
      itemDetails: pendingData.itemDetails || [],
      pointsUsed: pendingData.pointsUsed || 0
    };

    writeSubmitData_(writeData);
    console.log('Order written to sheet: ' + receiptNo);

    // 3. ペンディングデータを削除
    props.deleteProperty(pendingKey);
    console.log('Deleted pending order: ' + receiptNo);

    // 4. キャッシュを無効化
    st_invalidateStatusCache_(orderSs);

    return {
      ok: true,
      message: '注文を確定しました',
      receiptNo: receiptNo,
      movedCount: pendingData.ids.length
    };

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
 * @param {string} receiptNo - 受付番号
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
    try { props.deleteProperty('PAYMENT_' + receiptNo); } catch (e) {}

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
