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
