/**
 * SubmitFix.gs
 *
 * 1. 依頼送信を即座に完了（書き込みはバックグラウンド）
 * 2. 空行問題を修正
 * 3. テスト用リフレッシュ関数
 *
 * 既存の apiSubmitEstimate を置き換えてください
 */

// =====================================================
// 高速版 apiSubmitEstimate（即座に完了を返す）
// =====================================================

/**
 * 注文送信（高速版）
 * - バリデーション・確保チェック・価格計算は同期で実行
 * - シート書き込み・状態更新・メール送信はバックグラウンドで実行
 * - 受付番号とテンプレートを即座に返す
 */
function apiSubmitEstimate(userKey, form, ids) {
  try {
    // === 同期バリデーション ===
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

    // === 同期：確保チェック（ロック付き） ===
    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
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

    // === 同期：価格計算 ===
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) productMap[String(products[i].managedId)] = products[i];

    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var p = productMap[list[i]];
      if (!p) return { ok: false, message: '商品が見つかりません: ' + list[i] };
      sum += Number(p.price || 0);
    }

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

    // === 送料計算 ===
    var shippingAmount = Math.max(0, Math.floor(Number(f.shippingAmount || 0)));
    var shippingSize = String(f.shippingSize || '');
    var shippingArea = String(f.shippingArea || '');
    var shippingPref = String(f.shippingPref || '');

    // === ポイント利用 ===
    var pointsUsed = 0;
    if (usePoints > 0 && contact) {
      var custForPoints = findCustomerByEmail_(contact);
      if (custForPoints && custForPoints.points >= usePoints) {
        pointsUsed = Math.min(usePoints, discounted); // 合計金額を超えない
        discounted = discounted - pointsUsed;
        // ポイント残高を差し引き
        deductPoints_(contact, pointsUsed);
        if (note) {
          note += '\n【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
        } else {
          note = '【ポイント利用: ' + pointsUsed + 'pt（-' + pointsUsed + '円）】';
        }
      }
    }

    // === 送料を備考に追記 ===
    if (shippingAmount > 0) {
      var shippingLabel = '【送料: ¥' + shippingAmount.toLocaleString() + '（' + (shippingPref || '') + '・' + (shippingSize === 'small' ? '小' : '大') + '・税込）】';
      note = note ? (note + '\n' + shippingLabel) : shippingLabel;
    }

    // 送料込みの合計金額
    var totalWithShipping = discounted + shippingAmount;

    // === 同期：受付番号・テンプレート生成 ===
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

    // === 注文モード：確保を解除して依頼中に変更 ===
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

    // === 注文モード：即座にシート書き込み・メール通知 ===
    // メール用の商品詳細リストを構築
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

    var submitData = {
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
      paymentStatus: '未対応',
      itemDetails: itemDetails
    };

    // 直接書き込み
    writeSubmitData_(submitData);
    console.log('注文データを書き込み完了: ' + receiptNo);

    return {
      ok: true,
      receiptNo: receiptNo,
      templateText: templateText,
      totalAmount: totalWithShipping,
      shippingAmount: shippingAmount
    };

  } catch (e) {
    console.error('apiSubmitEstimate error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// =====================================================
// バックグラウンド書き込み処理
// =====================================================

/**
 * バックグラウンド処理をスケジュール
 * 既存のトリガーがなければ1秒後に実行するトリガーを作成
 */
function scheduleBackgroundProcess_() {
  // 既存のトリガーをチェック
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processSubmitQueue') {
      // 既にスケジュール済み
      return;
    }
  }

  // 1秒後に実行するトリガーを作成
  ScriptApp.newTrigger('processSubmitQueue')
    .timeBased()
    .after(1000) // 1秒後
    .create();
}

/**
 * キューに溜まった送信データを処理（トリガーから呼ばれる）
 */
function processSubmitQueue() {
  var lock = LockService.getScriptLock();

  try {
    // ロック取得を試みる（最大10秒待機）
    if (!lock.tryLock(10000)) {
      console.log('ロック取得失敗、次回に持ち越し');
      return;
    }

    var props = PropertiesService.getScriptProperties();
    var queueStr = props.getProperty('SUBMIT_QUEUE');

    if (!queueStr) {
      lock.releaseLock();
      return;
    }

    var queue = JSON.parse(queueStr);
    if (!queue || queue.length === 0) {
      lock.releaseLock();
      return;
    }

    // キューを取得してからロック解放（処理後に削除する）
    lock.releaseLock();

    // 各送信データを処理
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

    // 処理完了後にキューを削除（失敗分は再キューイング）
    if (allSuccess) {
      props.deleteProperty('SUBMIT_QUEUE');
    } else if (failedItems.length > 0) {
      // 失敗分のみ再キューイング
      try {
        props.setProperty('SUBMIT_QUEUE', JSON.stringify(failedItems));
        console.warn('失敗したキューアイテムを再保存: ' + failedItems.length + '件');
      } catch (requeueErr) {
        console.error('再キューイング失敗:', requeueErr);
        props.deleteProperty('SUBMIT_QUEUE');
      }
    }

  } catch (e) {
    console.error('processSubmitQueue error:', e);
    try { lock.releaseLock(); } catch (x) {}
  } finally {
    // このトリガーを削除
    cleanupTriggers_('processSubmitQueue');
  }
}

/**
 * 送信データを実際に書き込む（バックグラウンド）
 * - 依頼管理シートへの書き込み
 * - hold/openログシートの同期
 * - メール通知
 */
function writeSubmitData_(data) {
  var orderSs = sh_getOrderSs_();
  sh_ensureAllOnce_(orderSs);

  var now = data.createdAtMs || u_nowMs_();

  // 1. 依頼管理シートに書き込み
  // 列構成（30列 A-AD）:
  // A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=発送ステータス, N=リスト同梱, O=xlsx送付,
  // P=ステータス, Q=担当者, R=入金確認, S=インボイス発行, T=インボイス状況, U=予備, V=備考,
  // W=配送業者, X=伝票番号, Y=作業報酬, Z=更新日時, AA=通知フラグ,
  // AB=ポイント付与済, AC=送料(店負担), AD=送料(客負担)
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var productNames = '選べるxlsx付きパッケージ';
  var paymentStatus = data.paymentStatus || '入金待ち';
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
    '',                                          // AC: 送料(店負担) — 後決済モード時に使用
    data.shippingAmount || ''                    // AD: 送料(客負担) — フロントから送料あり時
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

  // 3. 管理者宛メール通知
  app_sendEstimateNotifyMail_(orderSs, data.receiptNo, {
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
    templateText: data.templateText || ''
  });

  // 4. 顧客宛確認メール
  app_sendEstimateConfirmToCustomer_(data);

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

/**
 * テスト送信した商品の確保・依頼中をリセット
 * GASエディタから手動実行
 *
 * 使い方：
 * 1. 下の testUserKey と testIds を設定
 * 2. refreshTestSubmission() を実行
 */
function refreshTestSubmission() {
  // ★★★ ここを設定 ★★★
  var testUserKey = ''; // 空の場合は全ユーザー対象
  var testIds = [];     // 空の場合は全商品対象（注意！）
  // ★★★★★★★★★★★★

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 確保シートをクリア
  var holdCleared = clearHoldSheetForRefresh_(ss, testUserKey, testIds);

  // 2. データ1シートのステータスをリセット
  var statusReset = resetProductStatusForRefresh_(ss, testIds);

  // 3. 依頼管理シートから該当行を削除（オプション）
  // var requestDeleted = deleteRequestForRefresh_(ss, testUserKey, testIds);

  console.log('='.repeat(50));
  console.log('リフレッシュ完了');
  console.log('確保クリア: ' + holdCleared + '件');
  console.log('ステータスリセット: ' + statusReset + '件');
  console.log('='.repeat(50));
}

/**
 * 最新のテスト送信をリフレッシュ（便利関数）
 * 依頼管理シートの最新行を見て自動でリセット
 */
function refreshLatestSubmission() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('依頼管理');
  if (!sheet) {
    console.log('依頼管理シートが見つかりません');
    return;
  }

  var lastRow = getActualLastRow_(sheet, 1);
  if (lastRow < 2) {
    console.log('依頼データがありません');
    return;
  }

  // 最新行のデータを取得
  var rowData = sheet.getRange(lastRow, 1, 1, 15).getValues()[0];
  var receiptNo = rowData[1];    // B列: 受付番号
  var idsStr = rowData[12];      // M列: 商品ID一覧
  var userKey = rowData[13];     // N列: userKey

  var ids = idsStr ? String(idsStr).split(',').map(function(s) { return s.trim(); }) : [];

  console.log('リフレッシュ対象:');
  console.log('  受付番号: ' + receiptNo);
  console.log('  userKey: ' + userKey);
  console.log('  商品数: ' + ids.length);

  // 確保シートをクリア
  var holdCleared = clearHoldSheetForRefresh_(ss, userKey, ids);

  // ステータスをリセット
  var statusReset = resetProductStatusForRefresh_(ss, ids);

  // 依頼管理シートから削除
  sheet.deleteRow(lastRow);

  console.log('='.repeat(50));
  console.log('リフレッシュ完了');
  console.log('確保クリア: ' + holdCleared + '件');
  console.log('ステータスリセット: ' + statusReset + '件');
  console.log('依頼管理から削除: 1件');
  console.log('='.repeat(50));
}

/**
 * 確保シートをクリア（リフレッシュ用）
 */
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

    if (matchUser && matchId) {
      rowsToDelete.push(i + 2);
    }
  }

  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  return rowsToDelete.length;
}

/**
 * 商品ステータスをリセット（リフレッシュ用）
 */
function resetProductStatusForRefresh_(ss, ids) {
  var sheet = ss.getSheetByName('データ1');
  if (!sheet) return 0;

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;

  // J列（ステータス）とK列（管理ID）を取得
  var range = sheet.getRange(3, 10, lastRow - 2, 2);
  var values = range.getValues();

  var count = 0;

  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][0] || '');
    var managedId = String(values[i][1] || '').trim();

    // 依頼中または確保中のステータスをクリア
    var isTarget = (status.indexOf('依頼中') !== -1 || status.indexOf('確保中') !== -1);
    var matchId = !ids || ids.length === 0 || ids.indexOf(managedId) !== -1;

    if (isTarget && matchId) {
      sheet.getRange(i + 3, 10).setValue(''); // J列をクリア
      count++;
    }
  }

  return count;
}

// =====================================================
// キューの手動処理（デバッグ用）
// =====================================================

/**
 * キューに溜まったデータを手動で処理
 */
function processQueueManually() {
  processSubmitQueue();
}

/**
 * キューをクリア（緊急用）
 */
function clearSubmitQueue() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('SUBMIT_QUEUE');
  console.log('キューをクリアしました');
}

/**
 * 依頼中状態を全リセット（テスト後のクリーンアップ用）
 * - openStateをクリア
 * - 依頼中シートをクリア
 * - キャッシュを無効化
 * GASエディタから手動実行
 */
function resetAllOpenState() {
  var orderSs = sh_getOrderSs_();

  // openStateをクリア
  st_setOpenState_(orderSs, { items: {}, updatedAt: u_nowMs_() });

  // 依頼中シートをクリア
  var sh = sh_ensureOpenLogSheet_(orderSs);
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  }

  // キャッシュ無効化
  st_invalidateStatusCache_(orderSs);

  console.log('依頼中状態を全リセットしました');
}

/**
 * 指定した受付番号の依頼中を取り消す
 * GASエディタから手動実行
 * @param {string} receiptNo - 受付番号
 */
function cancelByReceiptNo(receiptNo) {
  if (!receiptNo) {
    console.log('受付番号を指定してください');
    return;
  }

  var orderSs = sh_getOrderSs_();
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};

  var removed = [];
  for (var id in openItems) {
    if (openItems[id] && String(openItems[id].receiptNo || '') === String(receiptNo)) {
      removed.push(id);
      delete openItems[id];
    }
  }

  if (removed.length === 0) {
    console.log('受付番号 ' + receiptNo + ' に該当する依頼中商品はありません');
    return;
  }

  openState.items = openItems;
  openState.updatedAt = u_nowMs_();
  st_setOpenState_(orderSs, openState);

  // 依頼中シートも更新
  od_writeOpenLogSheetFromState_(orderSs, openItems, u_nowMs_());
  st_invalidateStatusCache_(orderSs);

  console.log('受付番号 ' + receiptNo + ' の依頼中を取り消しました（' + removed.length + '点）');
  console.log('対象: ' + removed.join('、'));
}

/**
 * 現在の依頼中をリフレッシュ（API用 - フロントからも呼べる）
 * 依頼管理シートの最新状態からopenStateを再構築する
 */
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

/**
 * キューの内容を確認
 */
function viewSubmitQueue() {
  var props = PropertiesService.getScriptProperties();
  var queueStr = props.getProperty('SUBMIT_QUEUE');

  if (!queueStr) {
    console.log('キューは空です');
    return;
  }

  var queue = JSON.parse(queueStr);
  console.log('キュー内容: ' + queue.length + '件');
  for (var i = 0; i < queue.length; i++) {
    console.log('  ' + (i + 1) + '. ' + queue[i].receiptNo + ' (' + queue[i].ids.length + '点)');
  }
}

/**
 * 商品IDから商品名を取得してカンマ区切りで返す
 * @param {string[]} ids - 商品ID配列
 * @returns {string} - 商品名のカンマ区切り文字列
 */
function getProductNamesFromIds_(ids) {
  if (!ids || !ids.length) return '';
  try {
    var products = pr_readProducts_();
    var productMap = {};
    for (var i = 0; i < products.length; i++) {
      productMap[String(products[i].managedId)] = products[i];
    }
    var names = [];
    for (var i = 0; i < ids.length; i++) {
      var p = productMap[String(ids[i])];
      if (p && p.brand) {
        names.push(p.brand + (p.category ? ' ' + p.category : ''));
      } else {
        names.push(ids[i]);
      }
    }
    return names.join('、');
  } catch (e) {
    console.error('getProductNamesFromIds_ error:', e);
    return ids.join('、');
  }
}

/**
 * 決済完了後に注文を確定（KOMOJU webhookから呼び出す）
 * - 保存済みのペンディング注文データを取得
 * - 商品をhold状態からopen状態へ変更
 * - 依頼管理シートにデータを書き込み
 * @param {string} receiptNo - 受付番号
 * @param {string} paymentStatus - 入金ステータス（'入金待ち' | '未対応' | '対応済'）
 * @returns {object} - { ok, message }
 */
function confirmPaymentAndCreateOrder(receiptNo, paymentStatus) {
  try {
    if (!receiptNo) {
      return { ok: false, message: '受付番号が必要です' };
    }

    var props = PropertiesService.getScriptProperties();
    var pendingKey = 'PENDING_ORDER_' + receiptNo;
    var pendingDataStr = props.getProperty(pendingKey);

    if (!pendingDataStr) {
      console.log('PENDING_ORDER not found: ' + receiptNo);
      return { ok: false, message: 'ペンディング注文が見つかりません: ' + receiptNo };
    }

    var pendingData = JSON.parse(pendingDataStr);
    console.log('Found pending order: ' + receiptNo + ', items: ' + pendingData.ids.length);

    var orderSs = sh_getOrderSs_();
    var now = u_nowMs_();

    // 1. 商品をhold状態からopen状態へ移行
    var holdState = st_getHoldState_(orderSs) || {};
    var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};

    var movedIds = [];
    for (var i = 0; i < pendingData.ids.length; i++) {
      var id = pendingData.ids[i];
      // holdから削除
      if (holdItems[id]) {
        delete holdItems[id];
      }
      // openに追加
      openItems[id] = {
        receiptNo: receiptNo,
        userKey: pendingData.userKey,
        createdAtMs: now
      };
      movedIds.push(id);
    }

    // hold/open状態を保存
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);

    openState.items = openItems;
    openState.updatedAt = now;
    st_setOpenState_(orderSs, openState);

    // 2. 依頼管理シートにデータを書き込み
    var writeData = {
      userKey: pendingData.userKey,
      form: pendingData.form,
      ids: pendingData.ids,
      receiptNo: receiptNo,
      selectionList: pendingData.selectionList,
      measureOpt: pendingData.measureOpt,
      totalCount: pendingData.totalCount,
      discounted: pendingData.discounted,
      createdAtMs: now,
      templateText: pendingData.templateText,
      measureLabel: app_measureOptLabel_(pendingData.measureOpt),
      paymentStatus: paymentStatus || '入金待ち'
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
      movedCount: movedIds.length
    };

  } catch (e) {
    console.error('confirmPaymentAndCreateOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * 注文をキャンセル（決済失敗時に呼び出す）
 * - hold状態から商品を解除
 * - ペンディング注文データを削除
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

    if (pendingDataStr) {
      try {
        var pendingData = JSON.parse(pendingDataStr);
        idsToRelease = pendingData.ids || [];
      } catch (pe) {
        console.error('Failed to parse pending data:', pe);
      }
    }

    // 2. hold状態から該当受付番号の商品を解除
    var holdState = st_getHoldState_(orderSs) || {};
    var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    var removedIds = [];

    // ペンディングデータがある場合はそのIDリストから解除
    if (idsToRelease.length > 0) {
      for (var i = 0; i < idsToRelease.length; i++) {
        var id = idsToRelease[i];
        if (holdItems[id]) {
          removedIds.push(id);
          delete holdItems[id];
        }
      }
    } else {
      // ペンディングデータがない場合は受付番号で検索
      for (var id in holdItems) {
        if (holdItems[id] && String(holdItems[id].receiptNo) === String(receiptNo)) {
          removedIds.push(id);
          delete holdItems[id];
        }
      }
    }

    if (removedIds.length > 0) {
      holdState.items = holdItems;
      holdState.updatedAt = now;
      st_setHoldState_(orderSs, holdState);
      console.log('Cancelled order ' + receiptNo + ', released ' + removedIds.length + ' items from hold');
    }

    // 3. ペンディング注文データを削除
    if (pendingDataStr) {
      props.deleteProperty(pendingKey);
      console.log('Deleted pending order: ' + receiptNo);
    }

    // 4. キャッシュを無効化
    st_invalidateStatusCache_(orderSs);

    return { ok: true, message: 'キャンセルしました', releasedCount: removedIds.length };
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
 * リンクを知っている全員がVIEW可能（Googleアカウント不要）
 * @param {string} receiptNo - 受付番号
 * @param {object} data - 注文データ
 * @returns {string} - Google Drive共有URL（失敗時は空文字）
 */
function createOrderConfirmLink_(receiptNo, data) {
  try {
    if (!receiptNo || !data) return '';

    var form = data.form || {};
    var ids = data.ids || [];
    var datetime = new Date(data.createdAtMs || Date.now());
    var dateStr = Utilities.formatDate(datetime, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    // スプレッドシートを新規作成
    var ss = SpreadsheetApp.create('注文明細_' + receiptNo);
    var sheet = ss.getActiveSheet();
    sheet.setName('注文明細');

    // ヘッダー情報
    var headerRows = [
      ['NKonline Apparel - ご注文明細'],
      [''],
      ['受付番号', receiptNo],
      ['依頼日時', dateStr],
      ['会社名/氏名', form.companyName || ''],
      ['合計点数', String(ids.length) + '点'],
      ['合計金額', String(Number(data.discounted || 0).toLocaleString()) + '円（税込）'],
      [''],
      ['■ 選択商品一覧'],
      ['No.', '管理番号']
    ];

    // 商品リストを追加
    for (var i = 0; i < ids.length; i++) {
      headerRows.push([i + 1, ids[i]]);
    }

    headerRows.push(['']);
    headerRows.push(['※ このシートは閲覧専用です。']);
    headerRows.push(['※ ご不明点はお問い合わせください: nkonline1030@gmail.com']);

    sheet.getRange(1, 1, headerRows.length, 2).setValues(headerRows);

    // タイトル行の書式設定
    sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
    sheet.getRange(10, 1, 1, 2).setFontWeight('bold').setBackground('#f0f0f0');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 200);

    // シートを保護（閲覧のみ）
    var protection = sheet.protect().setDescription('注文明細（閲覧専用）');
    protection.setWarningOnly(true);

    // リンクを知っている全員に VIEW 権限を付与
    var file = DriveApp.getFileById(ss.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // エクスポートフォルダに移動（設定されている場合）
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
