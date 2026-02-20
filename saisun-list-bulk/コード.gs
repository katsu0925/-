// コード.gs
// =====================================================
// アソート商品管理 — コンテナバインドスクリプト
// =====================================================
// このスクリプトは「アソート商品」スプレッドシートにバインドして使用。
// スプレッドシートを開くと管理メニューが表示される。

// =============================================================
// シート設定
// =============================================================

var SHEET_NAME = 'アソート商品';

var SHEET_HEADER = [
  '商品ID', '商品名', '説明', '価格', '単位',
  'タグ', '画像URL1', '画像URL2', '画像URL3', '画像URL4', '画像URL5',
  '最小注文数', '最大注文数', '表示順', '公開', '割引率'
];

var COLS = {
  productId: 0,
  name: 1,
  description: 2,
  price: 3,
  unit: 4,
  tag: 5,
  image1: 6,
  image2: 7,
  image3: 8,
  image4: 9,
  image5: 10,
  minQty: 11,
  maxQty: 12,
  sortOrder: 13,
  active: 14,
  discount: 15
};

// =============================================================
// onOpen — スプレッドシートメニュー
// =============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('アソート商品管理')
    .addItem('商品を新規登録', 'showNewProductModal')
    .addItem('商品一覧 / 編集 / 削除', 'showProductListModal')
    .addToUi();
}

// =============================================================
// モーダル表示
// =============================================================

function showNewProductModal() {
  var html = HtmlService.createHtmlOutputFromFile('BulkAdminModal')
    .setWidth(620)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'アソート商品 — 新規登録');
}

function showProductListModal() {
  var html = HtmlService.createHtmlOutputFromFile('BulkAdminList')
    .setWidth(700)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'アソート商品 — 一覧 / 編集 / 削除');
}

function showEditProductModal(productId) {
  var t = HtmlService.createTemplate(
    '<script>var EDIT_PRODUCT_ID = "<?= productId ?>";</script>'
    + HtmlService.createHtmlOutputFromFile('BulkAdminModal').getContent()
  );
  t.productId = productId;
  var html = t.evaluate().setWidth(620).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'アソート商品 — 編集');
}

// =============================================================
// シートヘルパー
// =============================================================

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, SHEET_HEADER.length).setValues([SHEET_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// =============================================================
// 内部ヘルパー
// =============================================================

function generateId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = 'BLK-';
  for (var i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var existing = getAllProducts_();
  var ids = {};
  for (var j = 0; j < existing.length; j++) ids[existing[j].productId] = true;
  if (ids[id]) return generateId_();
  return id;
}

function getAllProducts_() {
  var sh = ensureSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, SHEET_HEADER.length).getValues();
  var products = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var productId = String(row[COLS.productId] || '').trim();
    if (!productId) continue;

    var images = [];
    for (var imgIdx = COLS.image1; imgIdx <= COLS.image5; imgIdx++) {
      var imgUrl = String(row[imgIdx] || '').trim();
      if (imgUrl && imgUrl.indexOf('drive.google.com') !== -1) {
        var m = imgUrl.match(/[?&]id=([^&]+)/);
        if (m) imgUrl = 'https://lh3.googleusercontent.com/d/' + m[1];
      }
      images.push(imgUrl);
    }

    var discount = Number(row[COLS.discount]) || 0;
    if (discount < 0 || discount > 1) discount = 0;

    products.push({
      rowIndex: i + 2,
      productId: productId,
      name: String(row[COLS.name] || '').trim(),
      description: String(row[COLS.description] || '').trim(),
      price: Number(row[COLS.price]) || 0,
      unit: String(row[COLS.unit] || '').trim(),
      tag: String(row[COLS.tag] || '').trim(),
      images: images,
      minQty: Number(row[COLS.minQty]) || 1,
      maxQty: Number(row[COLS.maxQty]) || 99,
      sortOrder: Number(row[COLS.sortOrder]) || 999,
      active: row[COLS.active] === true || String(row[COLS.active]).toUpperCase() === 'TRUE',
      discount: discount
    });
  }

  products.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
  return products;
}

// =============================================================
// google.script.run から呼ばれるAPI関数
// =============================================================

function adminBulkGetProducts() {
  return {
    ok: true,
    products: getAllProducts_(),
    newId: generateId_()
  };
}

function adminBulkNewId() {
  return { ok: true, id: generateId_() };
}

function adminBulkSaveProduct(product) {
  if (!product || !product.productId) {
    return { ok: false, message: '商品IDが必要です。' };
  }
  if (!product.name || !String(product.name).trim()) {
    return { ok: false, message: '商品名が必要です。' };
  }
  if (!product.price || Number(product.price) <= 0) {
    return { ok: false, message: '価格は1以上を指定してください。' };
  }

  var sh = ensureSheet_();

  var images = product.images || [];
  for (var i = 0; i < 5; i++) {
    images[i] = String(images[i] || '').trim();
  }

  var discount = Number(product.discount) || 0;
  if (discount < 0 || discount > 1) discount = 0;

  var rowData = [];
  rowData[COLS.productId] = String(product.productId).trim();
  rowData[COLS.name] = String(product.name).trim();
  rowData[COLS.description] = String(product.description || '').trim();
  rowData[COLS.price] = Number(product.price) || 0;
  rowData[COLS.unit] = String(product.unit || '').trim();
  rowData[COLS.tag] = String(product.tag || '').trim();
  rowData[COLS.image1] = images[0] || '';
  rowData[COLS.image2] = images[1] || '';
  rowData[COLS.image3] = images[2] || '';
  rowData[COLS.image4] = images[3] || '';
  rowData[COLS.image5] = images[4] || '';
  rowData[COLS.minQty] = Math.max(1, Number(product.minQty) || 1);
  rowData[COLS.maxQty] = Math.max(1, Number(product.maxQty) || 99);
  rowData[COLS.sortOrder] = Number(product.sortOrder) || 999;
  rowData[COLS.active] = product.active !== false;
  rowData[COLS.discount] = discount;

  var lastRow = sh.getLastRow();
  var existingRow = 0;
  if (lastRow >= 2) {
    var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var j = 0; j < ids.length; j++) {
      if (String(ids[j][0]).trim() === String(product.productId).trim()) {
        existingRow = j + 2;
        break;
      }
    }
  }

  if (existingRow > 0) {
    var prevHeight = sh.getRowHeight(existingRow);
    sh.getRange(existingRow, 1, 1, SHEET_HEADER.length).setValues([rowData]);
    sh.setRowHeight(existingRow, prevHeight);
  } else {
    var refHeight = lastRow >= 2 ? sh.getRowHeight(2) : 21;
    sh.appendRow(rowData);
    sh.setRowHeight(sh.getLastRow(), refHeight);
  }

  return {
    ok: true,
    message: existingRow > 0 ? '商品を更新しました。' : '商品を登録しました。',
    products: getAllProducts_()
  };
}

function adminBulkDeleteProduct(productId) {
  if (!productId) return { ok: false, message: '商品IDが必要です。' };

  var sh = ensureSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, message: '商品が見つかりません。' };

  var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(productId).trim()) {
      sh.deleteRow(i + 2);
      return {
        ok: true,
        message: '商品を削除しました。',
        products: getAllProducts_()
      };
    }
  }

  return { ok: false, message: '商品が見つかりません。' };
}

function adminBulkGetProduct(productId) {
  var all = getAllProducts_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].productId === productId) {
      return { ok: true, product: all[i] };
    }
  }
  return { ok: false, message: '商品が見つかりません。' };
}

/**
 * ローカルファイルからアップロードされた画像をGoogleドライブに保存
 * @param {string} base64Data - 画像のBase64エンコードデータ
 * @param {string} mimeType - MIMEタイプ（例: image/jpeg）
 * @param {string} fileName - ファイル名
 * @returns {object} { ok, url, fileId }
 */
function adminBulkUploadImage(base64Data, mimeType, fileName) {
  try {
    if (!base64Data) return { ok: false, message: '画像データがありません' };

    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || 'image/jpeg', fileName || 'product_image.jpg');

    // アソート商品画像用フォルダを取得または作成
    var folderId = '';
    try {
      folderId = PropertiesService.getScriptProperties().getProperty('BULK_IMAGE_FOLDER_ID') || '';
    } catch (e) {}

    var file;
    if (folderId) {
      try {
        var folder = DriveApp.getFolderById(folderId);
        file = folder.createFile(blob);
      } catch (e) {
        file = DriveApp.createFile(blob);
      }
    } else {
      var folders = DriveApp.getFoldersByName('アソート商品画像');
      var folder;
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder('アソート商品画像');
      }
      file = folder.createFile(blob);
      try {
        PropertiesService.getScriptProperties().setProperty('BULK_IMAGE_FOLDER_ID', folder.getId());
      } catch (e) {}
    }

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var url = 'https://lh3.googleusercontent.com/d/' + fileId;

    return { ok: true, url: url, fileId: fileId };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
