// =====================================================
// BulkAdmin.gs — まとめ商品 管理（Admin.htmlのモーダルから呼び出し）
// =====================================================
// Admin.html の google.script.run から直接呼び出される関数群。
// 商品一覧取得、新規登録、編集、削除、Google Drive画像選択に対応。

/**
 * ユニークな商品IDを生成
 * 形式: BLK-XXXXXXXX (8桁英数字)
 */
function bulkAdmin_generateId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = 'BLK-';
  for (var i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var existing = bulkAdmin_getAllProducts_();
  var ids = {};
  for (var j = 0; j < existing.length; j++) ids[existing[j].productId] = true;
  if (ids[id]) return bulkAdmin_generateId_();
  return id;
}

/**
 * 全商品データ取得（管理用 — 非公開含む全件）
 */
function bulkAdmin_getAllProducts_() {
  var ss = bulk_getSs_();
  var sh = bulk_ensureSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var c = BULK_CONFIG.cols;
  var products = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var productId = String(row[c.productId] || '').trim();
    if (!productId) continue;

    var images = [];
    for (var imgIdx = c.image1; imgIdx <= c.image5; imgIdx++) {
      images.push(String(row[imgIdx] || '').trim());
    }

    products.push({
      rowIndex: i + 2,
      productId: productId,
      name: String(row[c.name] || '').trim(),
      description: String(row[c.description] || '').trim(),
      price: Number(row[c.price]) || 0,
      unit: String(row[c.unit] || '').trim(),
      tag: String(row[c.tag] || '').trim(),
      images: images,
      minQty: Number(row[c.minQty]) || 1,
      maxQty: Number(row[c.maxQty]) || 99,
      sortOrder: Number(row[c.sortOrder]) || 999,
      active: row[c.active] === true || String(row[c.active]).toUpperCase() === 'TRUE'
    });
  }

  products.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
  return products;
}

// =============================================================
// Admin.html から google.script.run で直接呼ばれる関数
// =============================================================

/**
 * 管理画面: まとめ商品一覧 + 新規ID取得
 */
function adminBulkGetProducts() {
  return {
    ok: true,
    products: bulkAdmin_getAllProducts_(),
    newId: bulkAdmin_generateId_()
  };
}

/**
 * 管理画面: 新しいユニークID発行
 */
function adminBulkNewId() {
  return { ok: true, id: bulkAdmin_generateId_() };
}

/**
 * 管理画面: 商品を保存（新規 or 更新）
 * @param {object} product - 商品データ
 */
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

  var ss = bulk_getSs_();
  var sh = bulk_ensureSheet_(ss);
  var c = BULK_CONFIG.cols;

  var images = product.images || [];
  for (var i = 0; i < 5; i++) {
    images[i] = String(images[i] || '').trim();
  }

  var rowData = [];
  rowData[c.productId] = String(product.productId).trim();
  rowData[c.name] = String(product.name).trim();
  rowData[c.description] = String(product.description || '').trim();
  rowData[c.price] = Number(product.price) || 0;
  rowData[c.unit] = String(product.unit || '').trim();
  rowData[c.tag] = String(product.tag || '').trim();
  rowData[c.image1] = images[0] || '';
  rowData[c.image2] = images[1] || '';
  rowData[c.image3] = images[2] || '';
  rowData[c.image4] = images[3] || '';
  rowData[c.image5] = images[4] || '';
  rowData[c.minQty] = Math.max(1, Number(product.minQty) || 1);
  rowData[c.maxQty] = Math.max(1, Number(product.maxQty) || 99);
  rowData[c.sortOrder] = Number(product.sortOrder) || 999;
  rowData[c.active] = product.active !== false;

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
    sh.getRange(existingRow, 1, 1, BULK_SHEET_HEADER.length).setValues([rowData]);
  } else {
    sh.appendRow(rowData);
  }

  bulk_clearCache_();

  return {
    ok: true,
    message: existingRow > 0 ? '商品を更新しました。' : '商品を登録しました。',
    products: bulkAdmin_getAllProducts_()
  };
}

/**
 * 管理画面: 商品削除
 * @param {string} productId
 */
function adminBulkDeleteProduct(productId) {
  if (!productId) return { ok: false, message: '商品IDが必要です。' };

  var ss = bulk_getSs_();
  var sh = bulk_ensureSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, message: '商品が見つかりません。' };

  var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(productId).trim()) {
      sh.deleteRow(i + 2);
      bulk_clearCache_();
      return {
        ok: true,
        message: '商品を削除しました。',
        products: bulkAdmin_getAllProducts_()
      };
    }
  }

  return { ok: false, message: '商品が見つかりません。' };
}

/**
 * 管理画面: Google Drive OAuth トークン取得（Picker API用）
 */
function adminBulkGetOAuthToken() {
  DriveApp.getRootFolder();
  return { ok: true, token: ScriptApp.getOAuthToken() };
}

/**
 * 管理画面: Drive ファイルIDから画像URLを生成 + 共有設定
 * @param {string} fileId
 */
function adminBulkGetDriveImageUrl(fileId) {
  if (!fileId) return { ok: false, message: 'ファイルIDが必要です。' };

  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://lh3.googleusercontent.com/d/' + fileId;
    return { ok: true, url: url, name: file.getName() };
  } catch (e) {
    return { ok: false, message: 'ファイルにアクセスできません: ' + (e.message || e) };
  }
}
