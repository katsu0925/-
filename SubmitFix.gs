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
 * 見積もり送信（高速版）
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

    if (!companyName) return { ok: false, message: '会社名/氏名は必須です' };
    if (!contact) return { ok: false, message: 'メールアドレスは必須です' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, message: '有効なメールアドレスを入力してください' };

    // === 同期：確保チェック ===
    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

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
    if (measureOpt === 'without') discountRate = 0.05;
    var discounted = Math.round(sum * (1 - discountRate));

    // === 同期：受付番号・テンプレート生成 ===
    var receiptNo = u_makeReceiptNo_();
    var selectionList = u_sortManagedIds_(list).join('、');
    var measureLabel = app_measureOptLabel_(measureOpt);

    var validatedForm = {
      companyName: companyName,
      contact: contact,
      contactMethod: contactMethod,
      delivery: delivery,
      postal: postal,
      address: address,
      phone: phone,
      note: note,
      measureOpt: measureOpt
    };

    var templateText = app_buildTemplateText_(receiptNo, validatedForm, list, totalCount, discounted);

    // === 同期：open/hold状態を即座に更新（他ユーザーとの競合防止） ===
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};

    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      openItems[id] = { receiptNo: receiptNo, status: APP_CONFIG.statuses.open, updatedAtMs: now };
      if (holdItems[id]) delete holdItems[id];
    }

    openState.items = openItems;
    openState.updatedAt = now;
    st_setOpenState_(orderSs, openState);

    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);

    st_invalidateStatusCache_(orderSs);

    // === バックグラウンド処理用にキューに追加 ===
    var writeData = {
      userKey: uk,
      form: validatedForm,
      ids: list,
      receiptNo: receiptNo,
      selectionList: selectionList,
      measureLabel: measureLabel,
      measureOpt: measureOpt,
      totalCount: totalCount,
      discounted: discounted,
      createdAtMs: now,
      templateText: templateText,
      timestamp: new Date().toISOString()
    };

    // キューに追加してバックグラウンドトリガーを設定
    try {
      var props = PropertiesService.getScriptProperties();
      var queue = [];
      try {
        var queueStr = props.getProperty('SUBMIT_QUEUE');
        if (queueStr) queue = JSON.parse(queueStr);
      } catch (e) {}
      queue.push(writeData);
      props.setProperty('SUBMIT_QUEUE', JSON.stringify(queue));

      // バックグラウンドトリガーを作成（まだなければ）
      scheduleBackgroundProcess_();
      console.log('バックグラウンド処理をスケジュール: ' + receiptNo);
    } catch (queueErr) {
      // キュー追加に失敗した場合は同期で実行（フォールバック）
      console.error('キュー追加失敗、同期実行: ' + receiptNo, queueErr);
      try {
        writeSubmitData_(writeData);
      } catch (writeErr) {
        console.error('同期書き込みも失敗: ' + receiptNo, writeErr);
      }
    }

    // 即座に完了を返す（バックグラウンド処理完了を待たない）
    return {
      ok: true,
      receiptNo: receiptNo,
      templateText: templateText,
      totalAmount: discounted
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

    // キューをクリア（処理中に新しいデータが来ても別キューになる）
    props.deleteProperty('SUBMIT_QUEUE');
    lock.releaseLock();

    // 各送信データを処理
    for (var i = 0; i < queue.length; i++) {
      var data = queue[i];
      try {
        writeSubmitData_(data);
        console.log('書き込み完了: ' + data.receiptNo);
      } catch (e) {
        console.error('書き込みエラー: ' + data.receiptNo, e);
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
  // 列構成: A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=発送ステータス, N=リスト同梱, O=xlsx送付,
  // P=ステータス, Q=担当者, R=支払いURL, S=採寸データ, T=入金確認, U-Y=予備, Z=備考
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var productNames = getProductNamesFromIds_(data.ids);
  var row = [
    data.receiptNo,                              // A: 受付番号
    new Date(now),                               // B: 依頼日時
    data.form.companyName || '',                 // C: 会社名/氏名
    data.form.contact || '',                     // D: 連絡先
    data.form.postal || '',                      // E: 郵便番号
    data.form.address || '',                     // F: 住所
    data.form.phone || '',                       // G: 電話番号
    productNames,                                // H: 商品名
    '',                                          // I: 確認リンク
    data.selectionList || data.ids.join('、'),   // J: 選択リスト
    data.ids.length,                             // K: 合計点数
    data.discounted || 0,                        // L: 合計金額
    '未着手',                                     // M: 発送ステータス
    '未',                                         // N: リスト同梱
    '未',                                         // O: xlsx送付
    APP_CONFIG.statuses.open,                    // P: ステータス
    '',                                          // Q: 担当者
    '',                                          // R: 支払いURL
    data.measureLabel || '',                     // S: 採寸データ
    '入金待ち',                                   // T: 入金確認
    '', '', '', '', '',                          // U-Y: 予備
    data.form.note || ''                         // Z: 備考
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

  // 3. メール通知
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
    writeRow: writeRow,
    createdAtMs: now,
    userKey: data.userKey,
    templateText: data.templateText || ''
  });

  // 4. Gmail下書き作成
  try {
    createEstimateDraft_(data.receiptNo, {
      companyName: data.form.companyName || '',
      contact: data.form.contact || '',
      postal: data.form.postal || '',
      address: data.form.address || '',
      phone: data.form.phone || '',
      note: data.form.note || '',
      measureLabel: data.measureLabel || '',
      totalCount: data.totalCount || data.ids.length,
      discounted: data.discounted || 0,
      selectionList: data.selectionList || data.ids.join('、')
    });
  } catch (e) {
    // 下書き作成に失敗してもエラーにしない
    Logger.log('Gmail下書き作成エラー: ' + (e.message || e));
  }
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
// Gmail下書き作成
// =====================================================

/**
 * 見積もり依頼の下書きメールを作成
 */
function createEstimateDraft_(receiptNo, info) {
  var to = String(info.contact || '').trim();
  if (!to || !to.includes('@')) return; // メールアドレスがない場合はスキップ

  var subject = '【見積もり依頼】受付番号: ' + receiptNo;

  var lines = [];
  lines.push(String(info.companyName || '') + ' 様');
  lines.push('');
  lines.push('この度は見積もり依頼をいただき、誠にありがとうございます。');
  lines.push('');
  lines.push('■ 受付番号: ' + receiptNo);
  lines.push('■ 点数: ' + String(info.totalCount || 0) + '点');
  lines.push('■ 見積金額: ' + u_formatYen_(info.discounted || 0));
  if (info.measureLabel) lines.push('■ 採寸データ: ' + String(info.measureLabel || ''));
  lines.push('');
  if (String(info.postal || '').trim()) lines.push('郵便番号: ' + String(info.postal || ''));
  if (String(info.address || '').trim()) lines.push('住所: ' + String(info.address || ''));
  if (String(info.phone || '').trim()) lines.push('電話番号: ' + String(info.phone || ''));
  if (String(info.note || '').trim()) {
    lines.push('');
    lines.push('備考:');
    lines.push(String(info.note || ''));
  }
  lines.push('');
  lines.push('ご確認の上、ご不明点がございましたらお気軽にお問い合わせください。');
  lines.push('');
  lines.push('よろしくお願いいたします。');

  var body = lines.join('\n');

  GmailApp.createDraft(to, subject, body);
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
  if (lastRow < 4) return 0;

  // J列（ステータス）とK列（管理ID）を取得
  var range = sheet.getRange(4, 10, lastRow - 3, 2);
  var values = range.getValues();

  var count = 0;

  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][0] || '');
    var managedId = String(values[i][1] || '').trim();

    // 依頼中または確保中のステータスをクリア
    var isTarget = (status.indexOf('依頼中') !== -1 || status.indexOf('確保中') !== -1);
    var matchId = !ids || ids.length === 0 || ids.indexOf(managedId) !== -1;

    if (isTarget && matchId) {
      sheet.getRange(i + 4, 10).setValue(''); // J列をクリア
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
 * 注文をキャンセル（決済失敗時に呼び出す）
 * - open状態から商品を解除
 * - キューから該当受付番号を削除
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

    // 1. open状態から該当受付番号の商品を解除
    var openState = st_getOpenState_(orderSs) || {};
    var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
    var removedIds = [];

    for (var id in openItems) {
      if (openItems[id] && String(openItems[id].receiptNo) === String(receiptNo)) {
        removedIds.push(id);
        delete openItems[id];
      }
    }

    if (removedIds.length > 0) {
      openState.items = openItems;
      openState.updatedAt = now;
      st_setOpenState_(orderSs, openState);
      st_invalidateStatusCache_(orderSs);
      console.log('Cancelled order ' + receiptNo + ', released ' + removedIds.length + ' items');
    }

    // 2. キューから該当受付番号を削除
    try {
      var props = PropertiesService.getScriptProperties();
      var queueStr = props.getProperty('SUBMIT_QUEUE');
      if (queueStr) {
        var queue = JSON.parse(queueStr);
        var newQueue = queue.filter(function(item) {
          return item.receiptNo !== receiptNo;
        });
        if (newQueue.length !== queue.length) {
          props.setProperty('SUBMIT_QUEUE', JSON.stringify(newQueue));
          console.log('Removed from queue: ' + receiptNo);
        }
      }
    } catch (qe) {
      console.error('Queue cleanup error:', qe);
    }

    return { ok: true, message: 'キャンセルしました', releasedCount: removedIds.length };
  } catch (e) {
    console.error('apiCancelOrder error:', e);
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
