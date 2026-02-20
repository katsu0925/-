// BulkConfig.gs
// =====================================================
// BulkConfig.gs — アソート商品スプレッドシート設定
// =====================================================
// アソート商品は個品（デタウリ）とは別のスプレッドシートで管理。
// ScriptProperty 'BULK_SPREADSHEET_ID' にスプレッドシートIDを設定する。
//
// アソート商品シート列構成:
// A=商品ID, B=商品名, C=説明, D=価格, E=単位,
// F=タグ, G=画像URL1, H=画像URL2, I=画像URL3, J=画像URL4, K=画像URL5,
// L=最小注文数, M=最大注文数, N=表示順, O=公開, P=割引率

var BULK_CONFIG = {
  spreadsheetId: (function() {
    try { return PropertiesService.getScriptProperties().getProperty('BULK_SPREADSHEET_ID') || ''; }
    catch (e) { return ''; }
  })(),
  sheetName: 'アソート商品',
  headerRow: 1,
  cols: {
    productId: 0,     // A: 商品ID（例: BULK001）
    name: 1,          // B: 商品名
    description: 2,   // C: 説明
    price: 3,         // D: 価格
    unit: 4,          // E: 単位（/kg, /点, /パック 等）
    tag: 5,           // F: タグ（人気No.1, 高利益率 等）
    image1: 6,        // G: 画像URL1
    image2: 7,        // H: 画像URL2
    image3: 8,        // I: 画像URL3
    image4: 9,        // J: 画像URL4
    image5: 10,       // K: 画像URL5
    minQty: 11,       // L: 最小注文数（デフォルト1）
    maxQty: 12,       // M: 最大注文数（デフォルト99）
    sortOrder: 13,    // N: 表示順
    active: 14,       // O: 公開（TRUE/FALSE）
    discount: 15      // P: 割引率（0〜1 例: 0.1 = 10%OFF）
  },
  cache: {
    key: 'BULK_PRODUCTS',
    ttl: 300           // 5分
  },
  channel: 'アソート'     // 依頼管理のチャネル列に入る値
};

/**
 * アソート商品シートのヘッダー定義
 */
var BULK_SHEET_HEADER = [
  '商品ID', '商品名', '説明', '価格', '単位',
  'タグ', '画像URL1', '画像URL2', '画像URL3', '画像URL4', '画像URL5',
  '最小注文数', '最大注文数', '表示順', '公開', '割引率'
];

/**
 * アソート商品スプレッドシートを取得
 */
function bulk_getSs_() {
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) throw new Error('BULK_SPREADSHEET_ID が設定されていません。ScriptPropertiesに設定してください。');
  return SpreadsheetApp.openById(ssId);
}

/**
 * アソート商品シートを取得（なければ作成 + ヘッダー設定）
 */
function bulk_ensureSheet_(ss) {
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) {
    sh = ss.insertSheet(BULK_CONFIG.sheetName);
    sh.getRange(1, 1, 1, BULK_SHEET_HEADER.length).setValues([BULK_SHEET_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * セットアップ関数（GASエディタから1回実行）
 * アソート商品スプレッドシートのIDをScriptPropertiesに設定
 *
 * 使い方: 下の SPREADSHEET_ID を実際のIDに書き換えてから実行
 */
function setBulkSpreadsheetId() {
  // ★ ここに アソート商品スプレッドシートの ID を貼り付けてから実行してください
  var SPREADSHEET_ID = '1yzfn252G3G1yh4SZ7tm73EwrGxZCwxZ-uaHHu_OnoJU';

  var id = String(SPREADSHEET_ID || '').trim();
  if (!id) {
    console.log('エラー: SPREADSHEET_ID が空です。');
    return;
  }

  try {
    var ss = SpreadsheetApp.openById(id);
    bulk_ensureSheet_(ss);
    PropertiesService.getScriptProperties().setProperty('BULK_SPREADSHEET_ID', id);
    console.log('設定完了: ' + ss.getName());
    console.log('シート「' + BULK_CONFIG.sheetName + '」を確認しました。');
  } catch (e) {
    console.log('エラー: ' + (e.message || e));
  }
}
