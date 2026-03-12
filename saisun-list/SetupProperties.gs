// SetupProperties.gs
/**
 * 現在のScript Propertiesを一覧表示（デバッグ用）
 * 値は先頭20文字のみ表示（セキュリティ考慮）
 */
function listAllProperties() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var keys = Object.keys(all).sort();
  console.log('===== Script Properties 一覧 (' + keys.length + '件) =====');
  keys.forEach(function(k) {
    var v = all[k];
    var display = v.length > 20 ? v.substring(0, 20) + '...' : v;
    console.log('  ' + k + ' = "' + display + '"');
  });
}

/**
 * Workers連携に必要なプロパティを確認・設定
 * GASエディタから1回実行してください
 *
 * 設定する値:
 *   ADMIN_KEY         = "nkonline"（Workers ADMIN_KEY と一致させる）
 *   WORKERS_API_URL   = Workers.dev URL
 */
function setupWorkersIntegration() {
  var props = PropertiesService.getScriptProperties();

  // 現在の値を確認
  var currentAdminKey = props.getProperty('ADMIN_KEY') || '';
  var currentWorkersUrl = props.getProperty('WORKERS_API_URL') || '';

  console.log('=== Workers連携設定 ===');
  console.log('現在の ADMIN_KEY: ' + (currentAdminKey ? '"' + currentAdminKey.substring(0, 3) + '***" (' + currentAdminKey.length + '文字)' : '未設定'));
  console.log('現在の WORKERS_API_URL: ' + (currentWorkersUrl || '未設定'));

  // Workers ADMIN_KEYと一致させる
  var targetAdminKey = 'nkonline';
  var targetWorkersUrl = 'https://detauri-gas-proxy.nsdktts1030.workers.dev';

  if (currentAdminKey !== targetAdminKey) {
    props.setProperty('ADMIN_KEY', targetAdminKey);
    console.log('ADMIN_KEY を更新しました: "' + targetAdminKey + '"');
  } else {
    console.log('ADMIN_KEY は正しく設定済み');
  }

  if (currentWorkersUrl !== targetWorkersUrl) {
    props.setProperty('WORKERS_API_URL', targetWorkersUrl);
    console.log('WORKERS_API_URL を更新しました: "' + targetWorkersUrl + '"');
  } else {
    console.log('WORKERS_API_URL は正しく設定済み');
  }

  // 検証
  var verify = props.getProperties();
  console.log('');
  console.log('=== 設定確認 ===');
  console.log('ADMIN_KEY: ' + (verify['ADMIN_KEY'] === targetAdminKey ? '✓ OK' : '✗ MISMATCH'));
  console.log('WORKERS_API_URL: ' + (verify['WORKERS_API_URL'] === targetWorkersUrl ? '✓ OK' : '✗ MISMATCH'));
}

/**
 * SYNC_SECRET を Script Properties に設定（D1同期用）
 * GASエディタから1回実行してください
 */
function setupSyncSecret() {
  var secret = '456995e18a339839a099f3fbbee42741902ab8f8bfd7f6a1ade750bbd2554278';
  PropertiesService.getScriptProperties().setProperty('SYNC_SECRET', secret);
  console.log('SYNC_SECRET を設定しました');
}

/**
 * パスワードハッシュのテストベクター生成（Workers互換性検証用）
 * GASエディタから実行し、ログ出力の値をWorkersの出力と比較する
 */
function testHashVector() {
  var testCases = [
    { password: 'test123', salt: 'abcdef1234567890' },
    { password: 'パスワード', salt: '0123456789abcdef' },
    { password: 'hello@world.com', salt: 'deadbeef12345678' },
  ];
  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    var hash = hashPasswordV2_(tc.password, tc.salt);
    console.log('Test ' + (i+1) + ': password="' + tc.password + '" salt="' + tc.salt + '"');
    console.log('  → v2:' + tc.salt + ':' + hash);
  }

  // 診断: エンコーディング特定
  console.log('');
  console.log('=== 診断: エンコーディング特定 ===');
  var input = 'パスワード:0123456789abcdef';

  // デフォルト
  var h1 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  console.log('Default hash:  ' + bytesToHex_(h1));

  // UTF-8 明示
  var h2 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  console.log('UTF-8 hash:    ' + bytesToHex_(h2));

  // UTF-8バイト列からハッシュ
  var utf8Bytes = Utilities.newBlob(input).getBytes();
  var h3 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, utf8Bytes);
  console.log('UTF-8 bytes→hash: ' + bytesToHex_(h3));

  // 単一文字「パ」のバイト表現調査
  console.log('');
  console.log('=== 単一文字「パ」のバイト表現 ===');
  var singleChar = 'パ';

  // デフォルトハッシュ
  var hs = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, singleChar);
  console.log('Default SHA-256(パ): ' + bytesToHex_(hs));

  // UTF-8バイト
  var utf8B = Utilities.newBlob(singleChar).getBytes();
  console.log('UTF-8 bytes(パ): ' + JSON.stringify(utf8B) + ' (len=' + utf8B.length + ')');

  // US-ASCII
  var h4 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, singleChar, Utilities.Charset.US_ASCII);
  console.log('US_ASCII SHA-256(パ): ' + bytesToHex_(h4));
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

// =====================================================
// クリーンアップ関数
// =====================================================

/**
 * 不要な一時プロパティを一括削除
 *
 * 削除対象:
 *   - PAYMENT_*         — 完了/期限切れの決済セッション
 *   - PENDING_ORDER_*   — 完了/期限切れのペンディング注文
 *   - PAYMENT_TEST-*    — テスト決済セッション
 *   - SUBMIT_QUEUE      — 送信キュー（処理済み）
 *
 * ★ 使い方:
 *   1. まず cleanupStaleProperties(true) を実行 → 削除対象を確認（ドライラン）
 *   2. 確認後 cleanupStaleProperties() を実行  → 実際に削除
 */
function cleanupStaleProperties(dryRun) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all);

  // 削除対象のプレフィックス
  // ★ STATE_HOLDS_V4, STATE_OPEN_V4 は削除禁止！
  //   PropertiesServiceが一次ストレージ（CacheServiceはキャッシュのみ）
  var stalePrefixes = [
    'PAYMENT_',
    'PENDING_ORDER_',
  ];

  // 削除対象の完全一致キー
  var staleExact = {
    'SUBMIT_QUEUE': true,
    'PUBLIC_SYNC_LAST_ERROR_AT': true,
    'PUBLIC_SYNC_LAST_ERROR_MSG': true
  };

  var toDelete = [];
  var toKeep = [];

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var isStale = false;

    // プレフィックス判定
    for (var j = 0; j < stalePrefixes.length; j++) {
      if (k.indexOf(stalePrefixes[j]) === 0) {
        isStale = true;
        break;
      }
    }

    // 完全一致判定
    if (!isStale && staleExact[k]) {
      isStale = true;
    }

    if (isStale) {
      toDelete.push(k);
    } else {
      toKeep.push(k);
    }
  }

  // ログ出力
  console.log('===== Script Properties クリーンアップ =====');
  console.log(dryRun ? '【ドライラン — 実際には削除しません】' : '【実行モード】');
  console.log('');
  console.log('削除対象: ' + toDelete.length + '件');

  // カテゴリ別に集計
  var categories = {};
  toDelete.forEach(function(k) {
    var cat = k.split(':')[0].split('_').slice(0, 2).join('_');
    if (k.indexOf('STATE_HOLDS') === 0) cat = 'STATE_HOLDS_V4';
    else if (k.indexOf('STATE_OPEN') === 0) cat = 'STATE_OPEN_V4';
    else if (k.indexOf('PAYMENT_TEST') === 0) cat = 'PAYMENT_TEST';
    else if (k.indexOf('PAYMENT_') === 0) cat = 'PAYMENT';
    else if (k.indexOf('PENDING_ORDER_') === 0) cat = 'PENDING_ORDER';
    categories[cat] = (categories[cat] || 0) + 1;
  });
  for (var cat in categories) {
    console.log('  ' + cat + ': ' + categories[cat] + '件');
  }

  console.log('');
  console.log('残すプロパティ: ' + toKeep.length + '件');
  toKeep.sort();
  toKeep.forEach(function(k) { console.log('  ✓ ' + k); });

  // 実行
  if (!dryRun && toDelete.length > 0) {
    toDelete.forEach(function(k) { props.deleteProperty(k); });
    console.log('');
    console.log('★ ' + toDelete.length + '件を削除しました');
  }

  console.log('');
  var finalCount = dryRun ? (keys.length - toDelete.length) : Object.keys(props.getProperties()).length;
  console.log('最終プロパティ数: ' + finalCount + '件（削除前: ' + keys.length + '件）');

  return { deleted: toDelete.length, remaining: finalCount, dryRun: !!dryRun };
}

/**
 * ドライラン: 削除対象を確認するだけ（実際には削除しない）
 * まずこちらを実行して確認してください
 */
function cleanupDryRun() {
  return cleanupStaleProperties(true);
}

/**
 * 本番実行: 不要プロパティを実際に削除
 * cleanupDryRun で確認後に実行してください
 */
function cleanupExecute() {
  return cleanupStaleProperties(false);
}

// =====================================================
// シートヘッダー保護（スタッフの誤操作防止）
// =====================================================

/**
 * 主要シートのヘッダー行（1行目）を保護する
 * GASエディタから1回実行する
 *
 * 保護対象:
 *   - 依頼管理シート（注文SS）
 *   - データ1シート（商品SS）
 *   - 顧客管理シート（注文SS）
 *
 * オーナーのメールアドレス（ADMIN_OWNER_EMAIL）は編集可能のまま残す
 */
function setupHeaderProtection() {
  var props = PropertiesService.getScriptProperties();
  var ownerEmail = String(props.getProperty('ADMIN_OWNER_EMAIL') || '').trim();

  var targets = [];

  // 注文SS（依頼管理・顧客管理）
  try {
    var orderSs = sh_getOrderSs_();
    var reqSheet = orderSs.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
    if (reqSheet) targets.push({ sheet: reqSheet, name: '依頼管理' });
    var custSheet = orderSs.getSheetByName('顧客管理');
    if (custSheet) targets.push({ sheet: custSheet, name: '顧客管理' });
  } catch (e) { console.error('注文SSオープンエラー:', e); }

  // データSS（データ1）
  try {
    var dataSs = sh_getDataSs_();
    var dataSheet = dataSs.getSheetByName(String(APP_CONFIG.data.sheetName || 'データ1'));
    if (dataSheet) targets.push({ sheet: dataSheet, name: 'データ1' });
  } catch (e) { console.error('データSSオープンエラー:', e); }

  var protected_ = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    try {
      // 既存の1行目保護があれば削除
      var existingProtections = t.sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
      for (var j = 0; j < existingProtections.length; j++) {
        if (existingProtections[j].getDescription() === 'ヘッダー行保護') {
          existingProtections[j].remove();
        }
      }

      // 1行目を保護
      var protection = t.sheet.getRange(1, 1, 1, t.sheet.getMaxColumns()).protect();
      protection.setDescription('ヘッダー行保護');
      protection.setWarningOnly(false);

      // オーナーのみ編集可能
      if (ownerEmail) {
        protection.addEditor(ownerEmail);
        // オーナー以外を削除
        var editors = protection.getEditors();
        for (var k = 0; k < editors.length; k++) {
          if (editors[k].getEmail() !== ownerEmail) {
            protection.removeEditor(editors[k]);
          }
        }
      } else {
        // オーナー未設定の場合は警告表示のみ
        protection.setWarningOnly(true);
      }

      protected_++;
      console.log('ヘッダー保護設定: ' + t.name);
    } catch (e) {
      console.error('ヘッダー保護エラー(' + t.name + '):', e);
    }
  }

  console.log('ヘッダー保護完了: ' + protected_ + '/' + targets.length + 'シート');
  return { ok: true, protected: protected_, total: targets.length };
}
