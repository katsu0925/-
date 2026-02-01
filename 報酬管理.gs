const REWARD_CONFIG = {
  SPREADSHEET_ID: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
  SHEET_REQUEST: '依頼管理',
  SHEET_REWARD: '報酬管理',
  TZ: 'Asia/Tokyo',
  STATUS_DONE_VALUE: '完了',
  COL_REQUEST_DATETIME: 2,
  COL_STATUS: 18,
  COL_PERSON: 19,
  COL_AMOUNT: 25
};

function rewardUpdateDaily() {
  const ss = SpreadsheetApp.openById(REWARD_CONFIG.SPREADSHEET_ID);
  const shReq = ss.getSheetByName(REWARD_CONFIG.SHEET_REQUEST);
  if (!shReq) throw new Error('依頼管理シートが見つかりません: ' + REWARD_CONFIG.SHEET_REQUEST);

  const shOut = ss.getSheetByName(REWARD_CONFIG.SHEET_REWARD) || ss.insertSheet(REWARD_CONFIG.SHEET_REWARD);

  const lastRow = shReq.getLastRow();
  if (lastRow < 2) {
    writeRewardOutput_(shOut, [], Utilities.formatDate(new Date(), REWARD_CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss'));
    return;
  }

  const maxCol = Math.max(REWARD_CONFIG.COL_REQUEST_DATETIME, REWARD_CONFIG.COL_STATUS, REWARD_CONFIG.COL_PERSON, REWARD_CONFIG.COL_AMOUNT);
  const values = shReq.getRange(2, 1, lastRow - 1, maxCol).getValues();

  const agg = new Map();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    const status = String(row[REWARD_CONFIG.COL_STATUS - 1] || '').trim();
    if (status !== REWARD_CONFIG.STATUS_DONE_VALUE) continue;

    const person = String(row[REWARD_CONFIG.COL_PERSON - 1] || '').trim();
    if (!person) continue;

    const reqDate = toDate_(row[REWARD_CONFIG.COL_REQUEST_DATETIME - 1]);
    if (!reqDate) continue;

    const ym = Utilities.formatDate(reqDate, REWARD_CONFIG.TZ, 'yyyy-MM');

    const amount = toNumber_(row[REWARD_CONFIG.COL_AMOUNT - 1]);
    if (!isFinite(amount)) continue;

    const key = ym + '\t' + person;
    const cur = agg.get(key) || { ym: ym, person: person, sum: 0, cnt: 0 };
    cur.sum += amount;
    cur.cnt += 1;
    agg.set(key, cur);
  }

  const rows = Array.from(agg.values())
    .sort((a, b) => (a.ym === b.ym ? a.person.localeCompare(b.person, 'ja') : a.ym.localeCompare(b.ym)))
    .map(o => [o.ym, o.person, o.sum, o.cnt]);

  const updatedAt = Utilities.formatDate(new Date(), REWARD_CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
  writeRewardOutput_(shOut, rows, updatedAt);
}

function installDailyRewardTrigger() {
  removeRewardTriggers_();
  ScriptApp.newTrigger('rewardUpdateDaily').timeBased().everyDays(1).atHour(6).create();
}

function removeRewardTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'rewardUpdateDaily') {
      ScriptApp.deleteTrigger(t);
    }
  }
}

function writeRewardOutput_(shOut, rows, updatedAtText) {
  shOut.getRange('A2:D').clearContent();

  shOut.getRange('F1').setValue('最終更新日時');
  shOut.getRange('F2').setValue(updatedAtText);
  shOut.getRange('F2').setNumberFormat('yyyy/mm/dd hh:mm:ss');

  if (rows.length) {
    shOut.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  shOut.getRange('C2:C').setNumberFormat('#,##0');
  shOut.getRange('A:A').setNumberFormat('yyyy-mm');
}

function toNumber_(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[,\s￥¥]/g, '').trim();
  if (!s) return NaN;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

function toDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v;

  const s = String(v).trim();
  if (!s) return null;

  const n = Number(s);
  if (isFinite(n) && n > 20000) {
    try {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
  }

  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1;

  const m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    const yy = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const dd = Number(m[3]);
    const hh = m[4] ? Number(m[4]) : 0;
    const mi = m[5] ? Number(m[5]) : 0;
    const ss = m[6] ? Number(m[6]) : 0;
    const d2 = new Date(yy, mm, dd, hh, mi, ss);
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}
