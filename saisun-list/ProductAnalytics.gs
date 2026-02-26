// ProductAnalytics.gs
// =====================================================
// 商品アナリティクスダッシュボード (Phase 4-7)
// 売上・コンバージョン分析
// =====================================================

/**
 * 商品分析 定期実行（毎日7時）
 */
function productAnalyticsCron_() {
  try {
    console.log('productAnalyticsCron_: 開始');
    var ss = sh_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    if (!reqSheet) { console.log('productAnalyticsCron_: 依頼管理シートなし'); return; }

    var reqData = reqSheet.getDataRange().getValues();
    var now = new Date();

    // 商品データシートからブランド・カテゴリ情報を取得
    var productInfo = {};
    try {
      var dataSs = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
      var dataSheet = dataSs.getSheetByName(APP_CONFIG.data.sheetName);
      if (dataSheet) {
        var headerRow = Number(APP_CONFIG.data.headerRow || 2);
        var lastRow = dataSheet.getLastRow();
        if (lastRow > headerRow) {
          var pData = dataSheet.getRange(headerRow + 1, 1, lastRow - headerRow, 11).getValues();
          for (var p = 0; p < pData.length; p++) {
            var mid = String(pData[p][10] || '').trim(); // K列: 管理番号
            if (!mid) mid = String(pData[p][0] || '').trim(); // A列: No
            if (mid) {
              productInfo[mid] = {
                brand: String(pData[p][3] || '').trim(),
                category: String(pData[p][4] || '').trim()
              };
            }
          }
        }
      }
    } catch (e) {
      console.log('optional: product info load: ' + (e.message || e));
    }

    // 依頼管理シートから商品別集計
    var productMap = {};
    for (var i = 1; i < reqData.length; i++) {
      var status = String(reqData[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
      if (status !== '完了') continue;

      var selectionList = String(reqData[i][REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '');
      var totalAmount = Number(reqData[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;
      var totalCount = Number(reqData[i][REQUEST_SHEET_COLS.TOTAL_COUNT - 1]) || 0;
      var orderDate = reqData[i][REQUEST_SHEET_COLS.DATETIME - 1];

      // 選択リストからIDを分解
      var ids = selectionList.split(/[,、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      var pricePerItem = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

      for (var j = 0; j < ids.length; j++) {
        var id = ids[j];
        if (!productMap[id]) {
          productMap[id] = { orders: 0, total: 0, lastDate: null };
        }
        productMap[id].orders++;
        productMap[id].total += pricePerItem;
        if (orderDate) {
          var d = new Date(orderDate);
          if (!productMap[id].lastDate || d > productMap[id].lastDate) productMap[id].lastDate = d;
        }
      }
    }

    // シート書き出し
    var analyticsSheet = ss.getSheetByName('商品分析') || ss.insertSheet('商品分析');
    analyticsSheet.clear();
    var headers = ['管理番号', 'ブランド', 'カテゴリ', '注文回数', '合計金額', '平均単価', '最終注文日', '更新日時'];
    analyticsSheet.appendRow(headers);
    analyticsSheet.setFrozenRows(1);
    analyticsSheet.getRange(1, 1, 1, headers.length).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');

    var rows = [];
    for (var mid in productMap) {
      var pm = productMap[mid];
      var info = productInfo[mid] || {};
      rows.push([
        mid,
        info.brand || '',
        info.category || '',
        pm.orders,
        pm.total,
        pm.orders > 0 ? Math.round(pm.total / pm.orders) : 0,
        pm.lastDate ? Utilities.formatDate(pm.lastDate, 'Asia/Tokyo', 'yyyy/MM/dd') : '',
        Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
      ]);
    }

    // 注文回数降順ソート
    rows.sort(function(a, b) { return b[3] - a[3]; });

    if (rows.length > 0) {
      analyticsSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      analyticsSheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
    }

    console.log('productAnalyticsCron_: 完了 ' + rows.length + '商品');
  } catch (e) {
    console.error('productAnalyticsCron_ error:', e);
  }
}

/**
 * 商品分析データ取得（管理者用）
 */
function adminGetProductAnalytics(adminKey, params) {
  try {
    ad_requireAdmin_(adminKey);
    var p = params || {};
    var sortBy = String(p.sortBy || 'orders');
    var limit = Number(p.limit || 50);

    var ss = sh_getOrderSs_();
    var sheet = ss.getSheetByName('商品分析');
    if (!sheet || sheet.getLastRow() < 2) return { ok: true, data: { products: [], total: 0 } };

    var data = sheet.getDataRange().getValues();
    var products = [];
    for (var i = 1; i < data.length; i++) {
      products.push({
        managedId: String(data[i][0] || ''),
        brand: String(data[i][1] || ''),
        category: String(data[i][2] || ''),
        orders: Number(data[i][3]) || 0,
        revenue: Number(data[i][4]) || 0,
        avgPrice: Number(data[i][5]) || 0,
        lastOrderDate: String(data[i][6] || '')
      });
    }

    // ソート
    if (sortBy === 'revenue') products.sort(function(a, b) { return b.revenue - a.revenue; });
    else if (sortBy === 'recent') products.sort(function(a, b) { return (b.lastOrderDate || '').localeCompare(a.lastOrderDate || ''); });
    else products.sort(function(a, b) { return b.orders - a.orders; });

    return { ok: true, data: { products: products.slice(0, limit), total: products.length } };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}
