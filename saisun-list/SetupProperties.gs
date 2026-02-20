// SetupProperties.gs
/**
 * SetupProperties.gs
 *
 * ハードコードされていたID・認証情報をScript Propertiesに一括登録するスクリプト。
 * GASエディタで setupRequiredProperties() を1回実行してください。
 * 実行後、このファイルは削除して構いません。
 *
 * ★ 使い方:
 *   1. GASエディタで このファイルを開く
 *   2. setupRequiredProperties を選択して実行
 *   3. 実行ログで登録結果を確認
 *   4. 確認後、このファイルを削除
 */

function setupRequiredProperties() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperties();

  // 今回のリファクタリングで新たにScript Properties経由に移行したキーと元の値
  var required = {
    // Config.gs: データスプレッドシートID
    'DATA_SPREADSHEET_ID': '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',

    // Config.gs: 仕入れ管理Ver.2（商品詳細モーダル用）
    'DETAIL_SPREADSHEET_ID': '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',

    // Config.gs: 通知先メールアドレス
    'NOTIFY_EMAILS': 'nsdktts1030@gmail.com',

    // Constants.gs: サイトURL
    'SITE_URL': 'https://wholesale.nkonline-tool.com/',

    // Constants.gs: 問い合わせメールアドレス
    'CONTACT_EMAIL': 'nkonline1030@gmail.com',

    // 受注管理.gs: 仕入れ管理スプレッドシートID
    'OM_SHIIRE_SS_ID': '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',

    // 受注管理.gs: XLSX出力フォルダID
    'OM_XLSX_FOLDER_ID': '1lq8Xb_dVwz5skrXlGvrS5epTwEc_yEts',

    // Code.gs: オーナーのuserKey（カンマ区切り）— PVログ除外用
    'OWNER_USER_KEYS': 'u_tgneiv48y4ml4o0t4e,u_gwzmndr3ymaml5an2qq,u_jdgyiye97ommjkccuc5',

    // DateExport.gs: エクスポート先フォルダID（既にフォールバック付きだが明示的に設定）
    'EXPORT_FOLDER_ID': '1Wxx7J71PImov3MDU-RgCIwTSPHFlu9ot'
  };

  var setKeys = [];
  var skippedKeys = [];

  for (var key in required) {
    if (existing[key] !== undefined && existing[key] !== '') {
      skippedKeys.push(key + ' = "' + existing[key].substring(0, 20) + (existing[key].length > 20 ? '..."' : '"'));
    } else {
      props.setProperty(key, required[key]);
      setKeys.push(key);
    }
  }

  // 結果ログ
  console.log('===== Script Properties セットアップ完了 =====');
  console.log('');

  if (setKeys.length > 0) {
    console.log('★ 新規登録 (' + setKeys.length + '件):');
    setKeys.forEach(function(k) { console.log('  ✓ ' + k); });
  } else {
    console.log('新規登録なし（全て設定済み）');
  }

  console.log('');

  if (skippedKeys.length > 0) {
    console.log('既に設定済み (' + skippedKeys.length + '件):');
    skippedKeys.forEach(function(k) { console.log('  - ' + k); });
  }

  console.log('');
  console.log('全プロパティ数: ' + Object.keys(props.getProperties()).length);
  console.log('');
  console.log('★ 確認後、このファイル（SetupProperties.gs）は削除して構いません。');

  return {
    set: setKeys,
    skipped: skippedKeys,
    totalProperties: Object.keys(props.getProperties()).length
  };
}

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
