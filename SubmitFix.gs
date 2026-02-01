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
 * - 受付番号とテンプレートを即座に返す
 * - 実際の書き込みはバックグラウンドで実行
 */
function apiSubmitEstimate(userKey, form, ids) {
  try {
    if (!userKey) return { ok: false, message: 'userKeyがありません' };
    if (!ids || !ids.length) return { ok: false, message: '商品が選択されていません' };

    // 受付番号を生成
    var receiptNo = generateReceiptNo_();

    // テンプレートを生成
    var templateText = generateTemplateText_(receiptNo, form, ids);

    // 書き込みデータをPropertiesServiceに保存（バックグラウンド処理用）
    var writeData = {
      userKey: userKey,
      form: form,
      ids: ids,
      receiptNo: receiptNo,
      timestamp: new Date().toISOString()
    };

    var props = PropertiesService.getScriptProperties();
    var queue = [];
    try {
      var queueStr = props.getProperty('SUBMIT_QUEUE');
      if (queueStr) queue = JSON.parse(queueStr);
    } catch (e) {}

    queue.push(writeData);
    props.setProperty('SUBMIT_QUEUE', JSON.stringify(queue));

    // バックグラウンド処理をトリガーで実行（1秒後）
    try {
      ScriptApp.newTrigger('processSubmitQueue_')
        .timeBased()
        .after(1000)
        .create();
    } catch (e) {
      // トリガー作成に失敗しても、同期的に実行
      console.log('トリガー作成失敗、同期実行:', e);
      processSubmitQueue_();
    }

    // 即座に完了を返す
    return {
      ok: true,
      receiptNo: receiptNo,
      templateText: templateText
    };

  } catch (e) {
    console.error('apiSubmitEstimate error:', e);
    return { ok: false, message: e.message || '送信に失敗しました' };
  }
}

/**
 * 受付番号を生成
 */
function generateReceiptNo_() {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  var d = ('0' + now.getDate()).slice(-2);
  var h = ('0' + now.getHours()).slice(-2);
  var min = ('0' + now.getMinutes()).slice(-2);
  var s = ('0' + now.getSeconds()).slice(-2);
  var rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return 'E' + y + m + d + '-' + h + min + s + '-' + rand;
}

/**
 * テンプレートテキストを生成
 */
function generateTemplateText_(receiptNo, form, ids) {
  var lines = [];
  lines.push('【見積もり依頼】');
  lines.push('受付番号: ' + receiptNo);
  lines.push('');
  lines.push('会社名/氏名: ' + (form.companyName || ''));
  lines.push('連絡先: ' + (form.contact || ''));
  lines.push('参照元: ' + (form.contactMethod || ''));
  lines.push('希望引渡し: ' + (form.delivery || ''));
  if (form.delivery === '配送') {
    lines.push('郵便番号: ' + (form.postal || ''));
    lines.push('住所: ' + (form.address || ''));
    lines.push('電話番号: ' + (form.phone || ''));
  }
  lines.push('採寸データ: ' + (form.measureOpt === 'without' ? '無し（5%OFF）' : '付き'));
  lines.push('商品点数: ' + ids.length + '点');
  if (form.note) {
    lines.push('備考: ' + form.note);
  }
  lines.push('');
  lines.push('上記内容で見積もり依頼いたします。');
  lines.push('ご確認よろしくお願いいたします。');

  return lines.join('\n');
}

// =====================================================
// バックグラウンド書き込み処理
// =====================================================

/**
 * キューに溜まった送信データを処理（トリガーから呼ばれる）
 */
function processSubmitQueue_() {
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
    console.error('processSubmitQueue_ error:', e);
    try { lock.releaseLock(); } catch (x) {}
  } finally {
    // このトリガーを削除
    cleanupTriggers_('processSubmitQueue_');
  }
}

/**
 * 送信データを実際に書き込む
 */
function writeSubmitData_(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 依頼管理シートに書き込み
  writeToRequestSheet_(ss, data);

  // 2. データ1シートのステータスを「依頼中」に更新
  updateProductStatus_(ss, data.ids, data.userKey);

  // 3. 確保シートからクリア
  clearHoldSheet_(ss, data.userKey, data.ids);
}

/**
 * 依頼管理シートに書き込み（空行対策済み）
 */
function writeToRequestSheet_(ss, data) {
  var sheet = ss.getSheetByName('依頼管理');
  if (!sheet) {
    console.log('依頼管理シートが見つかりません');
    return;
  }

  // 実データがある最終行を取得（空行対策）
  var lastRow = getActualLastRow_(sheet, 1); // A列を基準
  var newRow = lastRow + 1;

  var form = data.form || {};
  var ids = data.ids || [];
  var now = new Date();

  // 書き込むデータ（シートの列構造に合わせて調整）
  var rowData = [
    now,                          // A: 日時
    data.receiptNo,               // B: 受付番号
    form.companyName || '',       // C: 会社名/氏名
    form.contact || '',           // D: 連絡先
    form.contactMethod || '',     // E: 参照元
    form.delivery || '',          // F: 希望引渡し
    form.postal || '',            // G: 郵便番号
    form.address || '',           // H: 住所
    form.phone || '',             // I: 電話番号
    form.note || '',              // J: 備考
    form.measureOpt || 'with',    // K: 採寸オプション
    ids.length,                   // L: 商品点数
    ids.join(','),                // M: 商品ID一覧
    data.userKey || '',           // N: userKey
    '未対応'                       // O: ステータス
  ];

  sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
}

/**
 * 実データがある最終行を取得（空行をスキップ）
 */
function getActualLastRow_(sheet, column) {
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return 0;

  // A列のデータを取得
  var values = sheet.getRange(1, column, lastRow, 1).getValues();

  // 下から探して、最初にデータがある行を見つける
  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== '' && values[i][0] !== null && values[i][0] !== undefined) {
      return i + 1;
    }
  }

  return 0;
}

/**
 * 商品ステータスを「依頼中」に更新
 */
function updateProductStatus_(ss, ids, userKey) {
  var sheet = ss.getSheetByName('データ1');
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return;

  // K列（管理ID）とJ列（ステータス）を取得
  var range = sheet.getRange(4, 10, lastRow - 3, 2); // J〜K列
  var values = range.getValues();

  var updates = [];

  for (var i = 0; i < values.length; i++) {
    var status = values[i][0];   // J列: ステータス
    var managedId = String(values[i][1] || '').trim(); // K列: 管理ID

    if (managedId && ids.indexOf(managedId) !== -1) {
      // 依頼中に更新
      updates.push({ row: i + 4, status: '依頼中（' + userKey.slice(-6) + '）' });
    }
  }

  // 一括更新
  for (var j = 0; j < updates.length; j++) {
    sheet.getRange(updates[j].row, 10).setValue(updates[j].status); // J列
  }
}

/**
 * 確保シートからクリア
 */
function clearHoldSheet_(ss, userKey, ids) {
  var sheet = ss.getSheetByName('確保');
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var range = sheet.getRange(2, 1, lastRow - 1, 2); // A〜B列
  var values = range.getValues();

  var rowsToDelete = [];

  for (var i = values.length - 1; i >= 0; i--) {
    var holdUserKey = String(values[i][0] || '').trim();
    var holdId = String(values[i][1] || '').trim();

    if (holdUserKey === userKey && ids.indexOf(holdId) !== -1) {
      rowsToDelete.push(i + 2);
    }
  }

  // 下から削除（行番号がずれないように）
  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
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
  processSubmitQueue_();
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
