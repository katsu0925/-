// RFMAnalysis.gs
// =====================================================
// RFM顧客セグメンテーション (Phase 4-6)
// 購買行動による顧客分類
// =====================================================

var RFM_THRESHOLDS = {
  R: [{ score: 5, maxDays: 30 }, { score: 4, maxDays: 60 }, { score: 3, maxDays: 90 }, { score: 2, maxDays: 180 }, { score: 1, maxDays: Infinity }],
  F: [{ score: 5, min: 10 }, { score: 4, min: 7 }, { score: 3, min: 4 }, { score: 2, min: 2 }, { score: 1, min: 1 }],
  M: [{ score: 5, min: 500000 }, { score: 4, min: 200000 }, { score: 3, min: 100000 }, { score: 2, min: 50000 }, { score: 1, min: 0 }]
};

function calcRScore_(days) { for (var i = 0; i < RFM_THRESHOLDS.R.length; i++) { if (days <= RFM_THRESHOLDS.R[i].maxDays) return RFM_THRESHOLDS.R[i].score; } return 1; }
function calcFScore_(count) { for (var i = 0; i < RFM_THRESHOLDS.F.length; i++) { if (count >= RFM_THRESHOLDS.F[i].min) return RFM_THRESHOLDS.F[i].score; } return 1; }
function calcMScore_(spent) { for (var i = 0; i < RFM_THRESHOLDS.M.length; i++) { if (spent >= RFM_THRESHOLDS.M[i].min) return RFM_THRESHOLDS.M[i].score; } return 1; }

function determineSegment_(r, f, m) {
  if (r >= 4 && f >= 4 && m >= 4) return 'VIP';
  if (r >= 3 && f >= 3 && m >= 3) return '優良';
  if (r >= 4 && (f <= 2 || m <= 2)) return '休眠復帰';
  if (r <= 2 && f >= 3) return '休眠';
  if (f === 1) return '新規';
  return '一般';
}

/**
 * RFM分析 定期実行（毎週月曜7時）
 */
function rfmAnalysisCron_() {
  try {
    console.log('rfmAnalysisCron_: 開始');
    var ss = sh_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    var custSheet = getCustomerSheet_();
    if (!reqSheet || !custSheet) { console.error('rfmAnalysisCron_: シートなし'); return; }

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
      var r = calcRScore_(days), f = calcFScore_(p.count), m = calcMScore_(p.total);

      rows.push([
        String(custData[c][CUSTOMER_SHEET_COLS.ID] || ''), email,
        String(custData[c][CUSTOMER_SHEET_COLS.COMPANY_NAME] || ''),
        r, f, m, determineSegment_(r, f, m),
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

    console.log('rfmAnalysisCron_: 完了 ' + rows.length + '件');
  } catch (e) {
    console.error('rfmAnalysisCron_ error:', e);
  }
}

/**
 * RFMサマリー取得（管理者用）
 */
function adminGetRFMSummary(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    var ss = sh_getOrderSs_();
    var sheet = ss.getSheetByName('RFM分析');
    if (!sheet || sheet.getLastRow() < 2) return { ok: true, data: { segments: [], totalCustomers: 0 } };

    var data = sheet.getDataRange().getValues();
    var map = {};
    for (var i = 1; i < data.length; i++) {
      var seg = String(data[i][6] || '');
      if (!map[seg]) map[seg] = { name: seg, count: 0, revenue: 0 };
      map[seg].count++;
      map[seg].revenue += Number(data[i][9]) || 0;
    }

    var order = ['VIP', '優良', '休眠復帰', '休眠', '新規', '一般'];
    var segments = [];
    for (var s = 0; s < order.length; s++) { if (map[order[s]]) { segments.push(map[order[s]]); delete map[order[s]]; } }
    for (var k in map) segments.push(map[k]);

    return { ok: true, data: { segments: segments, totalCustomers: data.length - 1 } };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}
