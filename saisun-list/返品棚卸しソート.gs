// 返品棚卸しソート.gs
// 返品棚卸しシートの A:C を B列（管理番号）の番号で 1,2,3…（自然順）に並べ替える。
// 通常の昇順だと番号が文字列のため 1,10,100,2… になる問題への対策。
// 管理メニュー →「📋 返品棚卸しを番号順(1,2,3…)に並べ替え」から sortReturnTanaoroshi() を呼ぶ。

var RETURN_INV_SHEET = '返品棚卸し';
var RETURN_INV_HEADER_ROWS = 1; // 見出し行（並べ替えで動かさない先頭の行数）
var RETURN_INV_KEY_COL = 2;     // 並べ替えキー列（A=1, B=2, C=3）。基準列を変えたいときはここだけ変更
var RETURN_INV_WIDTH = 3;       // 並べ替え対象の横幅（A:C = 3列）

function sortReturnTanaoroshi() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(RETURN_INV_SHEET);
  if (!sh) {
    SpreadsheetApp.getUi().alert('「' + RETURN_INV_SHEET + '」シートが見つかりません。');
    return;
  }

  var lastRow = sh.getLastRow();
  var n = lastRow - RETURN_INV_HEADER_ROWS;
  if (n <= 1) {
    ss.toast('並べ替える行がありません。', RETURN_INV_SHEET, 3);
    return;
  }

  var startRow = RETURN_INV_HEADER_ROWS + 1;
  var range = sh.getRange(startRow, 1, n, RETURN_INV_WIDTH);
  var data = range.getValues(); // A:C

  var keyIdx = RETURN_INV_KEY_COL - 1; // 0始まりのキー列インデックス
  data.sort(function (a, b) {
    return tana_naturalCompare_(a[keyIdx], b[keyIdx]);
  });

  range.setValues(data);
  SpreadsheetApp.flush();

  var keyLetter = String.fromCharCode(64 + RETURN_INV_KEY_COL); // 2 -> 'B'
  ss.toast(RETURN_INV_SHEET + ' を ' + keyLetter + '列の番号順(1,2,3…)に並べ替えました。', '完了', 4);
}

// ─────────────────────────────────────────────
// 自然順比較: "1,2,3,...,10,...,100" / "返1,返2,返10" を正しい順に。
// 空白は末尾へ。純粋な数値同士は数値比較、それ以外は数字チャンクを数値比較する。
// ─────────────────────────────────────────────
function tana_naturalCompare_(a, b) {
  var sa = (a === null || a === undefined) ? '' : String(a).trim();
  var sb = (b === null || b === undefined) ? '' : String(b).trim();

  if (sa === '' && sb === '') return 0;
  if (sa === '') return 1;  // 空白は末尾
  if (sb === '') return -1;

  var na = Number(sa), nb = Number(sb);
  var aNum = !isNaN(na), bNum = !isNaN(nb);
  if (aNum && bNum) {
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }

  var ax = tana_naturalChunks_(sa), bx = tana_naturalChunks_(sb);
  var len = Math.min(ax.length, bx.length);
  for (var i = 0; i < len; i++) {
    var x = ax[i], y = bx[i];
    if (x.isNum && y.isNum) {
      if (x.val !== y.val) return x.val < y.val ? -1 : 1;
    } else {
      if (x.str !== y.str) return x.str < y.str ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

function tana_naturalChunks_(s) {
  var out = [];
  var re = /(\d+)|(\D+)/g, m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) out.push({ isNum: true, val: Number(m[1]), str: m[1] });
    else out.push({ isNum: false, val: 0, str: m[2] });
  }
  return out;
}
