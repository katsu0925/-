// CronAnalytics.gs
// =====================================================
// 商品分析 + RFM分析（saisun-list から移動）
// =====================================================

// =====================================================
// 商品分析（毎日7時）
// =====================================================

function cronProductAnalytics() {
  try {
    console.log('cronProductAnalytics: 開始');
    var ss = cron_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    if (!reqSheet) { console.log('cronProductAnalytics: 依頼管理シートなし'); return; }

    var reqData = reqSheet.getDataRange().getValues();
    var now = new Date();

    // 商品データシートからブランド・カテゴリ情報を取得
    var productInfo = {};
    try {
      var dataSs = SpreadsheetApp.openById(cron_getSsId_());
      var dataSheet = dataSs.getSheetByName('データ1');
      if (dataSheet) {
        var headerRow = 2;
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

    // フォールバック: 仕入れ管理Ver.2（商品管理シート）から売却済み商品のブランド・カテゴリを補完
    try {
      var detailSsId = String(PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || '');
      if (detailSsId) {
        var detailSs = SpreadsheetApp.openById(detailSsId);
        var detailSheet = detailSs.getSheetByName('商品管理');
        if (detailSheet) {
          var dHeaders = detailSheet.getRange(1, 1, 1, detailSheet.getLastColumn()).getValues()[0];
          var dMidCol = -1, dBrandCol = -1, dCatCol = -1;
          for (var h = 0; h < dHeaders.length; h++) {
            var hName = String(dHeaders[h] || '').trim();
            if (hName === '管理番号') dMidCol = h;
            else if (hName === 'ブランド') dBrandCol = h;
            else if (hName === 'カテゴリ') dCatCol = h;
          }
          if (dMidCol >= 0) {
            var dLastRow = detailSheet.getLastRow();
            if (dLastRow > 1) {
              var dMaxCol = Math.max(dMidCol, dBrandCol, dCatCol) + 1;
              var dData = detailSheet.getRange(2, 1, dLastRow - 1, dMaxCol).getValues();
              for (var d = 0; d < dData.length; d++) {
                var dId = String(dData[d][dMidCol] || '').trim();
                if (!dId || productInfo[dId]) continue;
                productInfo[dId] = {
                  brand: dBrandCol >= 0 ? String(dData[d][dBrandCol] || '').trim() : '',
                  category: dCatCol >= 0 ? String(dData[d][dCatCol] || '').trim() : ''
                };
              }
            }
          }
        }
      }
    } catch (e) {
      console.log('optional: detail product info load: ' + (e.message || e));
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
        mid, info.brand || '', info.category || '',
        pm.orders, pm.total,
        pm.orders > 0 ? Math.round(pm.total / pm.orders) : 0,
        pm.lastDate ? Utilities.formatDate(pm.lastDate, 'Asia/Tokyo', 'yyyy/MM/dd') : '',
        Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
      ]);
    }

    rows.sort(function(a, b) { return b[3] - a[3]; });

    if (rows.length > 0) {
      analyticsSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      analyticsSheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
    }

    console.log('cronProductAnalytics: 完了 ' + rows.length + '商品');
  } catch (e) {
    console.error('cronProductAnalytics error:', e);
  }
}

// =====================================================
// RFM分析（毎週月曜7時）
// =====================================================

var RFM_THRESHOLDS = {
  R: [{ score: 5, maxDays: 30 }, { score: 4, maxDays: 60 }, { score: 3, maxDays: 90 }, { score: 2, maxDays: 180 }, { score: 1, maxDays: Infinity }],
  F: [{ score: 5, min: 10 }, { score: 4, min: 7 }, { score: 3, min: 4 }, { score: 2, min: 2 }, { score: 1, min: 1 }],
  M: [{ score: 5, min: 500000 }, { score: 4, min: 200000 }, { score: 3, min: 100000 }, { score: 2, min: 50000 }, { score: 1, min: 0 }]
};

function cron_calcRScore_(days) { for (var i = 0; i < RFM_THRESHOLDS.R.length; i++) { if (days <= RFM_THRESHOLDS.R[i].maxDays) return RFM_THRESHOLDS.R[i].score; } return 1; }
function cron_calcFScore_(count) { for (var i = 0; i < RFM_THRESHOLDS.F.length; i++) { if (count >= RFM_THRESHOLDS.F[i].min) return RFM_THRESHOLDS.F[i].score; } return 1; }
function cron_calcMScore_(spent) { for (var i = 0; i < RFM_THRESHOLDS.M.length; i++) { if (spent >= RFM_THRESHOLDS.M[i].min) return RFM_THRESHOLDS.M[i].score; } return 1; }

function cron_determineSegment_(r, f, m) {
  if (r >= 4 && f >= 4 && m >= 4) return 'VIP';
  if (r >= 3 && f >= 3 && m >= 3) return '優良';
  if (r >= 4 && (f <= 2 || m <= 2)) return '休眠復帰';
  if (r <= 2 && f >= 3) return '休眠';
  if (f === 1) return '新規';
  return '一般';
}

function cronRfmAnalysis() {
  try {
    console.log('cronRfmAnalysis: 開始');
    var ss = cron_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    var custSheet = cron_getCustomerSheet_();
    if (!reqSheet || !custSheet) { console.error('cronRfmAnalysis: シートなし'); return; }

    var reqData = reqSheet.getDataRange().getValues();
    var custData = custSheet.getDataRange().getValues();
    var now = new Date();

    // 顧客別購買データ集計
    var purchaseMap = {};
    for (var i = 1; i < reqData.length; i++) {
      var status = String(reqData[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
      if (status !== '完了') continue;
      var email = String(reqData[i][REQUEST_SHEET_COLS.CONTACT - 1] || '').trim().toLowerCase();
      if (!email) continue;
      var orderDate = reqData[i][REQUEST_SHEET_COLS.DATETIME - 1];
      var total = Number(reqData[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;

      if (!purchaseMap[email]) purchaseMap[email] = { lastDate: null, count: 0, total: 0 };
      purchaseMap[email].count++;
      purchaseMap[email].total += total;
      if (orderDate) {
        var d = new Date(orderDate);
        if (!purchaseMap[email].lastDate || d > purchaseMap[email].lastDate) purchaseMap[email].lastDate = d;
      }
    }

    // RFMデータ構築
    var rows = [];
    for (var c = 1; c < custData.length; c++) {
      var email = String(custData[c][CUSTOMER_SHEET_COLS.EMAIL] || '').trim().toLowerCase();
      if (!email) continue;
      var p = purchaseMap[email];
      if (!p || p.count === 0) continue;

      var days = p.lastDate ? Math.floor((now - p.lastDate) / 86400000) : 9999;
      var r = cron_calcRScore_(days), f = cron_calcFScore_(p.count), m = cron_calcMScore_(p.total);

      rows.push([
        String(custData[c][CUSTOMER_SHEET_COLS.ID] || ''), email,
        String(custData[c][CUSTOMER_SHEET_COLS.COMPANY_NAME] || ''),
        r, f, m, cron_determineSegment_(r, f, m),
        p.lastDate ? Utilities.formatDate(p.lastDate, 'Asia/Tokyo', 'yyyy/MM/dd') : '',
        p.count, p.total,
        Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
      ]);
    }

    // シート書き出し
    var rfmSheet = ss.getSheetByName('RFM分析') || ss.insertSheet('RFM分析');
    rfmSheet.clear();
    var headers = ['顧客ID', 'メール', '会社名', 'R_Score', 'F_Score', 'M_Score', 'セグメント', '最終購入日', '購入回数', '累計金額', '更新日時'];
    rfmSheet.appendRow(headers);
    rfmSheet.setFrozenRows(1);
    rfmSheet.getRange(1, 1, 1, headers.length).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');

    if (rows.length > 0) {
      rfmSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      rfmSheet.getRange(2, 10, rows.length, 1).setNumberFormat('#,##0');
    }

    console.log('cronRfmAnalysis: 完了 ' + rows.length + '件');
  } catch (e) {
    console.error('cronRfmAnalysis error:', e);
  }
}
