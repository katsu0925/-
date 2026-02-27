// CronReward.gs
// =====================================================
// 報酬管理（saisun-list/報酬管理.gs から移動）
// 毎日6時に依頼管理シートから報酬集計を実行
// =====================================================

function rewardUpdateDaily() {
  var ssId = cron_getSsId_();
  var ss = SpreadsheetApp.openById(ssId);
  var shReq = ss.getSheetByName('依頼管理');
  if (!shReq) throw new Error('依頼管理シートが見つかりません');

  var shOut = ss.getSheetByName('報酬管理') || ss.insertSheet('報酬管理');

  var lastRow = shReq.getLastRow();
  if (lastRow < 2) {
    cron_writeRewardOutput_(shOut, [], Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'));
    return;
  }

  var COL_DATETIME = REQUEST_SHEET_COLS.DATETIME;
  var COL_CONFIRM  = REQUEST_SHEET_COLS.CONFIRM_LINK;
  var COL_COUNT    = REQUEST_SHEET_COLS.TOTAL_COUNT;
  var COL_STATUS   = REQUEST_SHEET_COLS.STATUS;
  var COL_PERSON   = REQUEST_SHEET_COLS.STAFF;
  var COL_REWARD   = REQUEST_SHEET_COLS.REWARD;

  var maxCol = Math.max(COL_DATETIME, COL_CONFIRM, COL_STATUS, COL_PERSON, COL_COUNT, COL_REWARD);
  var values = shReq.getRange(2, 1, lastRow - 1, maxCol).getValues();

  var agg = {};

  for (var i = 0; i < values.length; i++) {
    var row = values[i];

    var status = String(row[COL_STATUS - 1] || '').trim();
    if (status !== '完了') continue;

    var person = String(row[COL_PERSON - 1] || '').trim();
    if (!person) continue;

    var reqDate = cron_toDate_(row[COL_DATETIME - 1]);
    if (!reqDate) continue;

    var ym = Utilities.formatDate(reqDate, 'Asia/Tokyo', 'yyyy-MM');

    var reward = cron_toNumber_(row[COL_REWARD - 1]);
    if (!isFinite(reward)) continue;

    var confirmLink = String(row[COL_CONFIRM - 1] || '').trim();
    var count = confirmLink ? 1 : cron_toNumber_(row[COL_COUNT - 1]);

    var key = ym + '\t' + person;
    if (!agg[key]) agg[key] = { ym: ym, person: person, sum: 0, cnt: 0 };
    agg[key].sum += reward;
    agg[key].cnt += (isFinite(count) ? count : 0);
  }

  var keys = Object.keys(agg);
  keys.sort(function(a, b) {
    var va = agg[a], vb = agg[b];
    return va.ym === vb.ym ? va.person.localeCompare(vb.person, 'ja') : va.ym.localeCompare(vb.ym);
  });

  var rows = keys.map(function(k) {
    var o = agg[k];
    return [o.ym, o.person, o.sum, o.cnt];
  });

  var updatedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  cron_writeRewardOutput_(shOut, rows, updatedAt);
}

function cron_writeRewardOutput_(shOut, rows, updatedAtText) {
  shOut.getRange('A2:D').clearContent();
  shOut.getRange(1, 1, 1, 4).setValues([['年月', '担当者', '報酬合計', '合計点数']]);
  shOut.getRange('F1').setValue('最終更新日時');
  shOut.getRange('F2').setValue(updatedAtText);
  shOut.getRange('F2').setNumberFormat('yyyy/mm/dd hh:mm:ss');

  if (rows.length) {
    shOut.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  shOut.getRange('C2:C').setNumberFormat('#,##0');
  shOut.getRange('D2:D').setNumberFormat('#,##0');
  shOut.getRange('A:A').setNumberFormat('yyyy-mm');
}

function cron_toNumber_(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[,\s￥¥]/g, '').trim();
  if (!s) return NaN;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

function cron_toDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v;

  var s = String(v).trim();
  if (!s) return null;

  var n = Number(s);
  if (isFinite(n) && n > 20000) {
    try {
      var d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
  }

  var d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1;

  var m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    var d2 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}
