const REWARD_CONFIG = {
  // APP_CONFIG.data.spreadsheetId から取得（一元管理）
  get SPREADSHEET_ID() { return String(APP_CONFIG.data.spreadsheetId || ''); },
  SHEET_REQUEST: '依頼管理',
  SHEET_REWARD: '報酬管理',
  TZ: 'Asia/Tokyo',
  STATUS_DONE_VALUE: '完了',
  // REQUEST_SHEET_COLS (Constants.gs) と同期 — getter でファイル読込順に依存しない
  get COL_REQUEST_DATETIME() { return REQUEST_SHEET_COLS.DATETIME; },      // B列: 依頼日時
  get COL_CONFIRM_LINK()     { return REQUEST_SHEET_COLS.CONFIRM_LINK; },  // I列: 確認リンク
  get COL_COUNT()            { return REQUEST_SHEET_COLS.TOTAL_COUNT; },   // K列: 合計点数
  get COL_STATUS()           { return REQUEST_SHEET_COLS.STATUS; },        // V列: ステータス
  get COL_PERSON()           { return REQUEST_SHEET_COLS.STAFF; },         // W列: 担当者
  get COL_REWARD()           { return REQUEST_SHEET_COLS.REWARD; }         // AE列: 作業報酬
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

  const maxCol = Math.max(REWARD_CONFIG.COL_REQUEST_DATETIME, REWARD_CONFIG.COL_CONFIRM_LINK, REWARD_CONFIG.COL_STATUS, REWARD_CONFIG.COL_PERSON, REWARD_CONFIG.COL_COUNT, REWARD_CONFIG.COL_REWARD);
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

    const reward = toNumber_(row[REWARD_CONFIG.COL_REWARD - 1]);
    if (!isFinite(reward)) continue;

    // 確認リンク(I列)にデータがあれば点数=1、なければK列の合計点数を使用
    const confirmLink = String(row[REWARD_CONFIG.COL_CONFIRM_LINK - 1] || '').trim();
    const count = confirmLink ? 1 : toNumber_(row[REWARD_CONFIG.COL_COUNT - 1]);

    const key = ym + '\t' + person;
    const cur = agg.get(key) || { ym: ym, person: person, sum: 0, cnt: 0 };
    cur.sum += reward;
    cur.cnt += (isFinite(count) ? count : 0);
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

  // ヘッダー行を設定
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
    } catch (e) { console.log('optional: serial date parse: ' + (e.message || e)); }
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
