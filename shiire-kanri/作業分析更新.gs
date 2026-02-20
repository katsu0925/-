// 作業分析更新.gs
function buildWorkAnalysis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName('商品管理');
  if (!src) throw new Error('商品管理 シートが見つかりません');
  var dst = ss.getSheetByName('作業分析') || ss.insertSheet('作業分析');
  dst.clear();
  var lastRow = src.getLastRow();
  if (lastRow < 2) {
    dst.getRange(1,1,1,1).setValue('データがありません');
    return;
  }

  var startCol = 33;
  var width = 26;
  var values = src.getRange(2, startCol, lastRow - 1, width).getValues();

  var monthsSet = {};
  var totals = {meas:{}, photo:{}, list:{}, ship:{}};
  var people = {meas:{}, photo:{}, list:{}, ship:{}};
  var accounts = {meas:{}, photo:{}, list:{}, ship:{}};

  function toMonthKey(v) {
    if (v === '' || v === null) return null;
    var d;
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) d = v;
    else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400 * 1000));
    else {
      d = new Date(v);
      if (isNaN(d)) return null;
    }
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    return y + '/' + ('0' + m).slice(-2);
  }

  function toDateObj(v) {
    if (v === '' || v === null) return null;
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
    var d = new Date(v);
    if (isNaN(d)) return null;
    return d;
  }

  function toDayKey(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '/' + m + '/' + day;
  }

  function inc(map, k) {
    map[k] = (map[k] || 0) + 1;
  }

  function incBucket(bucket, month, key) {
    var name = key === '' ? '(未入力)' : String(key);
    if (!bucket[month]) bucket[month] = {};
    bucket[month][name] = (bucket[month][name] || 0) + 1;
  }

  var today = new Date();
  var curY = today.getFullYear();
  var curM = today.getMonth();
  var monthStart = new Date(curY, curM, 1);
  var monthEnd = new Date(curY, curM + 1, 1);

  var daily = {meas:{}, photo:{}, list:{}, ship:{}};
  var dailyPerson = {};
  function incDailyPerson(person, dayKey, kind) {
    var name = person === '' ? '(未入力)' : String(person);
    if (!dailyPerson[name]) dailyPerson[name] = {};
    if (!dailyPerson[name][dayKey]) dailyPerson[name][dayKey] = {meas:0, photo:0, list:0, ship:0};
    dailyPerson[name][dayKey][kind] = (dailyPerson[name][dayKey][kind] || 0) + 1;
  }

  for (var i = 0; i < values.length; i++) {
    var ag = values[i][0];
    var ah = values[i][1];
    var ai = values[i][2];
    var aj = values[i][3];
    var ak = values[i][4];
    var al = values[i][5];
    var am = values[i][6];
    var be = values[i][24];
    var bf = values[i][25];

    var m1 = toMonthKey(ag);
    if (m1) {
      monthsSet[m1] = true;
      inc(totals.meas, m1);
      incBucket(people.meas, m1, ah);
      incBucket(accounts.meas, m1, am);
    }
    var d1 = toDateObj(ag);
    if (d1 && d1 >= monthStart && d1 < monthEnd) {
      var k1 = toDayKey(d1);
      inc(daily.meas, k1);
      incDailyPerson(ah, k1, 'meas');
    }

    var m2 = toMonthKey(ai);
    if (m2) {
      monthsSet[m2] = true;
      inc(totals.photo, m2);
      incBucket(people.photo, m2, aj);
      incBucket(accounts.photo, m2, am);
    }
    var d2 = toDateObj(ai);
    if (d2 && d2 >= monthStart && d2 < monthEnd) {
      var k2 = toDayKey(d2);
      inc(daily.photo, k2);
      incDailyPerson(aj, k2, 'photo');
    }

    var m3 = toMonthKey(ak);
    if (m3) {
      monthsSet[m3] = true;
      inc(totals.list, m3);
      incBucket(people.list, m3, al);
      incBucket(accounts.list, m3, am);
    }
    var d3 = toDateObj(ak);
    if (d3 && d3 >= monthStart && d3 < monthEnd) {
      var k3 = toDayKey(d3);
      inc(daily.list, k3);
      incDailyPerson(al, k3, 'list');
    }

    var m4 = toMonthKey(be);
    if (m4) {
      monthsSet[m4] = true;
      inc(totals.ship, m4);
      incBucket(people.ship, m4, bf);
      incBucket(accounts.ship, m4, am);
    }
    var d4 = toDateObj(be);
    if (d4 && d4 >= monthStart && d4 < monthEnd) {
      var k4 = toDayKey(d4);
      inc(daily.ship, k4);
      incDailyPerson(bf, k4, 'ship');
    }
  }

  var months = Object.keys(monthsSet).sort();
  var header1 = ['月','採寸件数','採寸ユニーク人数','撮影件数','撮影ユニーク人数','出品件数','出品ユニーク人数','発送件数','発送ユニーク人数'];
  var out1 = [header1];
  for (var j = 0; j < months.length; j++) {
    var mo = months[j];
    var u1 = people.meas[mo] ? Object.keys(people.meas[mo]).length : 0;
    var u2 = people.photo[mo] ? Object.keys(people.photo[mo]).length : 0;
    var u3 = people.list[mo] ? Object.keys(people.list[mo]).length : 0;
    var u4 = people.ship[mo] ? Object.keys(people.ship[mo]).length : 0;
    out1.push([mo, totals.meas[mo] || 0, u1, totals.photo[mo] || 0, u2, totals.list[mo] || 0, u3, totals.ship[mo] || 0, u4]);
  }
  dst.getRange(1,1,out1.length,header1.length).setValues(out1);
  formatTable_(dst, 1, 1, out1.length, header1.length);

  var r = out1.length + 2;
  dst.getRange(r-1,1,1,1).setValue('区分別 明細');

  function writeKindDetail(kindLabel, bucket, startRow) {
    var rows = [['区分','月','担当者','件数']];
    var monthsLocal = Object.keys(bucket).sort();
    for (var a = 0; a < monthsLocal.length; a++) {
      var m = monthsLocal[a];
      var persons = Object.keys(bucket[m]).sort(function(x,y){return bucket[m][y]-bucket[m][x] || x.localeCompare(y,'ja')});
      for (var b = 0; b < persons.length; b++) {
        var p = persons[b];
        rows.push([kindLabel, m, p, bucket[m][p]]);
      }
    }
    dst.getRange(startRow,1,rows.length,4).setValues(rows);
    formatTable_(dst, startRow, 1, rows.length, 4);
    return startRow + rows.length + 1;
  }

  r = writeKindDetail('採寸', people.meas, r);
  r = writeKindDetail('撮影', people.photo, r);
  r = writeKindDetail('出品', people.list, r);
  r = writeKindDetail('発送', people.ship, r);

  var statusCol = src.getRange(2, 5, lastRow - 1, 1).getValues();
  var accountCol = src.getRange(2, 39, lastRow - 1, 1).getValues();
  var map = {};
  var total = 0;
  for (var k = 0; k < statusCol.length; k++) {
    var st = String(statusCol[k][0]).trim();
    if (st === '出品中') {
      var nameAcc = accountCol[k][0] === '' ? '(未入力)' : String(accountCol[k][0]);
      map[nameAcc] = (map[nameAcc] || 0) + 1;
      total++;
    }
  }
  var keysAcc = Object.keys(map).sort(function(a,b){return map[b]-map[a] || a.localeCompare(b,'ja')});

  var headerAcc = ['使用アカウント','現在出品数'];
  var topN = 3;
  var rows2Compact = [headerAcc];
  var sumTop = 0;
  for (var t = 0; t < Math.min(topN, keysAcc.length); t++) {
    rows2Compact.push([keysAcc[t], map[keysAcc[t]]]);
    sumTop += map[keysAcc[t]];
  }
  rows2Compact.push(['合計', total]);

  // ▼▼▼ 修正箇所: 出力先をK2 (11列目、2行目) に変更しました ▼▼▼
  dst.getRange(2,11,rows2Compact.length,2).setValues(rows2Compact);
  formatTable_(dst, 2, 11, rows2Compact.length, 2);
  // ▲▲▲ 修正箇所ここまで ▲▲▲

  var dayHeader = ['日付','採寸件数','撮影件数','出品件数','発送件数'];
  var dayRows = [dayHeader];
  var d = new Date(monthStart.getTime());
  while (d < monthEnd) {
    var key = toDayKey(d);
    dayRows.push([
      key,
      daily.meas[key] || 0,
      daily.photo[key] || 0,
      daily.list[key] || 0,
      daily.ship[key] || 0
    ]);
    d.setDate(d.getDate() + 1);
  }
  dst.getRange(13,6,dayRows.length,dayHeader.length).setValues(dayRows);
  formatTable_(dst, 13, 6, dayRows.length, dayHeader.length);

  var personHeader = ['担当者','日付','採寸件数','撮影件数','出品件数','発送件数'];
  var personRows = [personHeader];
  var personsAll = Object.keys(dailyPerson).sort(function(a,b){return a.localeCompare(b,'ja')});
  for (var pi = 0; pi < personsAll.length; pi++) {
    var pname = personsAll[pi];
    var dd = new Date(monthStart.getTime());
    while (dd < monthEnd) {
      var dk = toDayKey(dd);
      var cell = dailyPerson[pname][dk] || {meas:0, photo:0, list:0, ship:0};
      var s = (cell.meas||0) + (cell.photo||0) + (cell.list||0) + (cell.ship||0);
      if (s > 0) {
        personRows.push([pname, dk, cell.meas||0, cell.photo||0, cell.list||0, cell.ship||0]);
      }
      dd.setDate(dd.getDate() + 1);
    }
  }
  if (personRows.length === 1) personRows.push(['(該当なし)','-',0,0,0,0]);
  dst.getRange(12,12,1,1).setValue('当月 人別日別');
  dst.getRange(13,12,personRows.length,personHeader.length).setValues(personRows);
  formatTable_(dst, 13, 12, personRows.length, personHeader.length);

  var startMonthly = r + 1;
  dst.getRange(startMonthly-1,1,1,1).setValue('月次ブレークダウン');
  var rowsMonthly = [['月','区分','種別','名称','件数']];
  function pushAccountRows(month, kindLabel, bucket) {
    if (!bucket[month]) return;
    var klist = Object.keys(bucket[month]).sort(function(x,y){return bucket[month][y]-bucket[month][x] || x.localeCompare(y,'ja')});
    for (var i2 = 0; i2 < klist.length; i2++) rowsMonthly.push([month, kindLabel, '使用アカウント', klist[i2], bucket[month][klist[i2]]]);
  }
  function pushPeopleRows(month, kindLabel, bucket) {
    if (!bucket[month]) return;
    var klist = Object.keys(bucket[month]).sort(function(x,y){return bucket[month][y]-bucket[month][x] || x.localeCompare(y,'ja')});
    for (var i3 = 0; i3 < klist.length; i3++) rowsMonthly.push([month, kindLabel, '担当者', klist[i3], bucket[month][klist[i3]]]);
  }
  for (var mi = 0; mi < months.length; mi++) {
    var mo = months[mi];
    pushAccountRows(mo,'採寸',accounts.meas);
    pushPeopleRows(mo,'採寸',people.meas);
    rowsMonthly.push([mo,'採寸','全合計','合計',totals.meas[mo]||0]);
    pushAccountRows(mo,'撮影',accounts.photo);
    pushPeopleRows(mo,'撮影',people.photo);
    rowsMonthly.push([mo,'撮影','全合計','合計',totals.photo[mo]||0]);
    pushAccountRows(mo,'出品',accounts.list);
    pushPeopleRows(mo,'出品',people.list);
    rowsMonthly.push([mo,'出品','全合計','合計',totals.list[mo]||0]);
    pushAccountRows(mo,'発送',accounts.ship);
    pushPeopleRows(mo,'発送',people.ship);
    rowsMonthly.push([mo,'発送','全合計','合計',totals.ship[mo]||0]);
  }
  dst.getRange(startMonthly,1,rowsMonthly.length,rowsMonthly[0].length).setValues(rowsMonthly);
  formatTable_(dst, startMonthly, 1, rowsMonthly.length, rowsMonthly[0].length);

  dst.setFrozenRows(1);
}

function formatTable_(sheet, row, col, numRows, numCols) {
  var range = sheet.getRange(row, col, numRows, numCols);
  range.setBorder(true,true,true,true,true,true);
  var bg = [];
  for (var r = 0; r < numRows; r++) {
    var color = r === 0 ? '#e6e6e6' : (r % 2 === 1 ? '#ffffff' : '#f2f2f2');
    var rowArr = [];
    for (var c = 0; c < numCols; c++) rowArr.push(color);
    bg.push(rowArr);
  }
  range.setBackgrounds(bg);
  sheet.getRange(row, col, 1, numCols).setFontWeight('bold');
}
