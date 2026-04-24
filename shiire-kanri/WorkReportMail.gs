// WorkReportMail.gs
// 商品管理シートの AG-AL 列（採寸/撮影/出品 × 日付・担当者）から
// 日報・週報メールを生成して送信する。
// 配信先は既存の「設定」シート K4:K（仕入れ数報告と共通）。

var WORK_REPORT_CFG = {
  SHEET_NAME: '商品管理',
  START_COL: 33,  // AG = 採寸日
  WIDTH: 6,       // AG〜AL（採寸日/採寸担当/撮影日/撮影担当/出品日/出品担当）
  ACTIVE_WINDOW_DAYS: 30,  // 直近N日以内に名前が出現した担当者を「在籍」とみなす
  EXCLUDE_PERSONS: ['Non']  // 日報・週報から除外する担当者（退職者など）
};

/** 除外対象判定（前後空白を吸収） */
function wr_isExcluded_(name) {
  var t = String(name || '').trim();
  if (!t) return false;
  var list = WORK_REPORT_CFG.EXCLUDE_PERSONS || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]).trim() === t) return true;
  }
  return false;
}

// ──────────────────────────────────────────────
// エントリポイント（トリガー対象）
// ──────────────────────────────────────────────

/**
 * 日報: 前日分の作業実績を送信（毎朝8時のトリガーから呼ぶ）
 */
function sendDailyWorkReport() {
  var now = new Date();
  var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  var start = yesterday;
  var end   = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() + 1);
  var prevStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - 1);
  var prevEnd   = yesterday;

  var data = wr_collectWorkCounts_(start, end);
  var prev = wr_collectWorkCounts_(prevStart, prevEnd);
  var persons = wr_getActivePersons_();

  var subject = '【日報】' + wr_formatMD_(yesterday) + '(' + wr_weekdayJa_(yesterday) + ') 商品管理作業数';
  var body = wr_buildDailyBody_(yesterday, data, prev, persons);
  wr_sendMail_(subject, body);
}

/**
 * 週報: 前週（月〜日）分の作業実績を送信（毎週月曜8時のトリガーから呼ぶ）
 */
function sendWeeklyWorkReport() {
  var now = new Date();
  // 今日を含めず、直前の日曜日までを終端とする
  var day = now.getDay(); // 0=Sun,1=Mon,...
  var daysBackToLastSun = (day === 0) ? 7 : day;
  var lastSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBackToLastSun);
  var lastMonday = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() - 6);
  var start = lastMonday;
  var end   = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() + 1);
  var prevStart = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() - 7);
  var prevEnd   = lastMonday;

  var data = wr_collectWorkCounts_(start, end);
  var prev = wr_collectWorkCounts_(prevStart, prevEnd);
  var persons = wr_getActivePersons_();

  var subject = '【週報】' + wr_formatMD_(lastMonday) + '(月)〜' + wr_formatMD_(lastSunday) + '(日) 商品管理作業数';
  var body = wr_buildWeeklyBody_(lastMonday, lastSunday, data, prev, persons);
  wr_sendMail_(subject, body);
}

// ──────────────────────────────────────────────
// トリガー設定（GASエディタから手動実行）
// ──────────────────────────────────────────────

/**
 * 日報・週報トリガーを設定（既存の同名トリガーは削除してから再作成）
 */
function setupWorkReportTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var h = t.getHandlerFunction();
    if (h === 'sendDailyWorkReport' || h === 'sendWeeklyWorkReport') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  ScriptApp.newTrigger('sendDailyWorkReport')
    .timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('sendWeeklyWorkReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).nearMinute(0).create();
  console.log('WorkReportMail: 既存トリガー削除=' + removed + '件 / 日報(毎朝8時)・週報(月曜8時)を設定しました');
}

/** 手動テスト: 前日分の日報を即送信 */
function testSendDailyWorkReport() { sendDailyWorkReport(); }
/** 手動テスト: 前週分の週報を即送信 */
function testSendWeeklyWorkReport() { sendWeeklyWorkReport(); }

// ──────────────────────────────────────────────
// データ収集
// ──────────────────────────────────────────────

/**
 * [startDate, endDate) の範囲で採寸/撮影/出品の件数を集計する
 * 戻り値: { byCatPerson:{meas,photo,list}, byDay:{'yyyy/MM/dd':{meas,photo,list}}, totals:{...} }
 */
function wr_collectWorkCounts_(startDate, endDate) {
  var result = {
    byCatPerson: { meas: {}, photo: {}, list: {} },
    byDay: {},
    totals: { meas: 0, photo: 0, list: 0 }
  };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(WORK_REPORT_CFG.SHEET_NAME);
  if (!sh) throw new Error(WORK_REPORT_CFG.SHEET_NAME + ' シートが見つかりません');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return result;

  var values = sh.getRange(2, WORK_REPORT_CFG.START_COL, lastRow - 1, WORK_REPORT_CFG.WIDTH).getValues();
  var cats = [
    { key: 'meas',  dateIdx: 0, personIdx: 1 },
    { key: 'photo', dateIdx: 2, personIdx: 3 },
    { key: 'list',  dateIdx: 4, personIdx: 5 }
  ];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var d = wr_toDate_(row[cat.dateIdx]);
      if (!d) continue;
      if (d < startDate || d >= endDate) continue;
      var person = String(row[cat.personIdx] || '').trim();
      if (wr_isExcluded_(person)) continue;
      if (person === '') person = '(未入力)';
      result.byCatPerson[cat.key][person] = (result.byCatPerson[cat.key][person] || 0) + 1;
      result.totals[cat.key]++;
      var dk = wr_formatDayKey_(d);
      if (!result.byDay[dk]) result.byDay[dk] = { meas: 0, photo: 0, list: 0 };
      result.byDay[dk][cat.key]++;
    }
  }
  return result;
}

/**
 * 直近ACTIVE_WINDOW_DAYS日以内に名前が出現した全担当者（ゼロ件含む全員表示の母集合）
 * 五十音順で返す
 */
function wr_getActivePersons_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(WORK_REPORT_CFG.SHEET_NAME);
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var now = new Date();
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WORK_REPORT_CFG.ACTIVE_WINDOW_DAYS);
  var values = sh.getRange(2, WORK_REPORT_CFG.START_COL, lastRow - 1, WORK_REPORT_CFG.WIDTH).getValues();
  var set = {};
  var pairs = [[0,1],[2,3],[4,5]];
  for (var i = 0; i < values.length; i++) {
    for (var c = 0; c < pairs.length; c++) {
      var d = wr_toDate_(values[i][pairs[c][0]]);
      if (!d || d < cutoff) continue;
      var p = String(values[i][pairs[c][1]] || '').trim();
      if (p && !wr_isExcluded_(p)) set[p] = true;
    }
  }
  return Object.keys(set).sort(function(a, b) { return a.localeCompare(b, 'ja'); });
}

// ──────────────────────────────────────────────
// 本文ビルダー
// ──────────────────────────────────────────────

function wr_buildDailyBody_(date, data, prev, persons) {
  var lines = [];
  lines.push(wr_formatMD_(date) + '(' + wr_weekdayJa_(date) + ') 外注別 作業実績');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  var total = data.totals.meas + data.totals.photo + data.totals.list;
  lines.push('全合計: ' + total + '件（採寸 ' + data.totals.meas
             + ' / 撮影 ' + data.totals.photo
             + ' / 出品 ' + data.totals.list + '）');
  lines.push('');

  var cats = [['meas','採寸'], ['photo','撮影'], ['list','出品']];
  for (var i = 0; i < cats.length; i++) {
    var key = cats[i][0], label = cats[i][1];
    lines.push('■ ' + label + ' (' + data.totals[key] + '件)');
    var sorted = persons.slice().sort(function(a, b) {
      var ca = data.byCatPerson[key][a] || 0;
      var cb = data.byCatPerson[key][b] || 0;
      if (ca !== cb) return cb - ca;
      return a.localeCompare(b, 'ja');
    });
    if (sorted.length === 0) {
      lines.push('   (該当担当者なし)');
    } else {
      for (var p = 0; p < sorted.length; p++) {
        var cnt = data.byCatPerson[key][sorted[p]] || 0;
        lines.push('   ' + wr_padName_(sorted[p], 10) + wr_padNum_(cnt, 4));
      }
    }
    lines.push('');
  }

  var prevTotal = prev.totals.meas + prev.totals.photo + prev.totals.list;
  var diff = total - prevTotal;
  var prevDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  lines.push('前日(' + wr_formatMD_(prevDate) + ') 比: ' + (diff >= 0 ? '+' : '') + diff + '件');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('集計元: 商品管理シート AG/AI/AK 列');
  return lines.join('\n');
}

function wr_buildWeeklyBody_(monday, sunday, data, prev, persons) {
  var lines = [];
  lines.push(wr_formatMD_(monday) + '(月)〜' + wr_formatMD_(sunday) + '(日) 外注別 作業実績');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  var total = data.totals.meas + data.totals.photo + data.totals.list;
  var avg = Math.round(total / 7);
  lines.push('週合計: ' + total + '件（日平均 ' + avg + '件）');
  lines.push('  採寸 ' + data.totals.meas + ' / 撮影 ' + data.totals.photo + ' / 出品 ' + data.totals.list);
  lines.push('');

  // 外注別テーブル（全員、全合計の降順）
  lines.push('■ 外注別（週合計）');
  lines.push('   ' + wr_padName_('', 10) + wr_padNum_('採寸', 4) + '  ' + wr_padNum_('撮影', 4) + '  ' + wr_padNum_('出品', 4));
  var sorted = persons.slice().sort(function(a, b) {
    var ta = (data.byCatPerson.meas[a]  || 0)
           + (data.byCatPerson.photo[a] || 0)
           + (data.byCatPerson.list[a]  || 0);
    var tb = (data.byCatPerson.meas[b]  || 0)
           + (data.byCatPerson.photo[b] || 0)
           + (data.byCatPerson.list[b]  || 0);
    if (ta !== tb) return tb - ta;
    return a.localeCompare(b, 'ja');
  });
  if (sorted.length === 0) {
    lines.push('   (該当担当者なし)');
  } else {
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var m  = data.byCatPerson.meas[p]  || 0;
      var ph = data.byCatPerson.photo[p] || 0;
      var ls = data.byCatPerson.list[p]  || 0;
      lines.push('   ' + wr_padName_(p, 10) + wr_padNum_(m, 4) + '  ' + wr_padNum_(ph, 4) + '  ' + wr_padNum_(ls, 4));
    }
  }
  lines.push('');

  // 日別推移
  lines.push('■ 日別推移');
  var dayNames = ['日','月','火','水','木','金','土'];
  var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
  while (d <= sunday) {
    var dk = wr_formatDayKey_(d);
    var cell = data.byDay[dk] || { meas: 0, photo: 0, list: 0 };
    var dayTotal = cell.meas + cell.photo + cell.list;
    var wd = dayNames[d.getDay()];
    lines.push(' ' + wd + ' ' + wr_padName_(wr_formatMD_(d), 5)
               + '  ' + wr_padNum_(dayTotal, 3)
               + '   採寸' + cell.meas + ' 撮影' + cell.photo + ' 出品' + cell.list);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  lines.push('');

  var prevTotal = prev.totals.meas + prev.totals.photo + prev.totals.list;
  var diff = total - prevTotal;
  var pct = prevTotal > 0 ? Math.round((diff / prevTotal) * 1000) / 10 : 0;
  lines.push('前週比: ' + (diff >= 0 ? '+' : '') + diff + '件 ('
             + (diff >= 0 ? '+' : '') + pct + '%)');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('集計元: 商品管理シート AG/AI/AK 列');
  return lines.join('\n');
}

// ──────────────────────────────────────────────
// メール送信
// ──────────────────────────────────────────────

function wr_sendMail_(subject, bodyText) {
  var recipients = getRecipients(SpreadsheetApp.getActiveSpreadsheet()); // 経費_仕入れ数報告の通知用アドレス.gs の関数を流用
  if (!recipients || recipients.length === 0) {
    console.warn('wr_sendMail_: 配信先なし（設定シート K4:K を確認してください）');
    return;
  }
  var htmlBody = '<pre style="font-family: \'Menlo\', \'Consolas\', \'Noto Sans Mono CJK JP\', monospace; font-size: 13px; line-height: 1.5;">'
               + wr_escapeHtml_(bodyText) + '</pre>';
  var sent = 0;
  for (var i = 0; i < recipients.length; i++) {
    try {
      MailApp.sendEmail({ to: recipients[i], subject: subject, body: bodyText, htmlBody: htmlBody });
      sent++;
    } catch (e) {
      console.error('wr_sendMail_ error: ' + recipients[i] + ': ' + (e && e.message || e));
    }
    Utilities.sleep(150);
  }
  console.log('wr_sendMail_: 送信=' + sent + '/' + recipients.length + '件 subject=' + subject);
}

// ──────────────────────────────────────────────
// ユーティリティ
// ──────────────────────────────────────────────

function wr_toDate_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  var d = new Date(v);
  return isNaN(d) ? null : d;
}

function wr_formatDayKey_(d) {
  return d.getFullYear() + '/' + wr_pad2_(d.getMonth() + 1) + '/' + wr_pad2_(d.getDate());
}

function wr_pad2_(n) { return ('0' + n).slice(-2); }

function wr_formatMD_(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

function wr_weekdayJa_(d) { return ['日','月','火','水','木','金','土'][d.getDay()]; }

/** 半角=1 / 全角=2 として指定幅に右パディング */
function wr_padName_(s, widthHalf) {
  var str = String(s);
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    w += str.charCodeAt(i) > 127 ? 2 : 1;
  }
  var pad = Math.max(0, widthHalf - w);
  return str + new Array(pad + 1).join(' ');
}

/** 数値を半角換算の指定幅で左パディング */
function wr_padNum_(n, widthHalf) {
  var str = String(n);
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    w += str.charCodeAt(i) > 127 ? 2 : 1;
  }
  var pad = Math.max(0, widthHalf - w);
  return new Array(pad + 1).join(' ') + str;
}

function wr_escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
