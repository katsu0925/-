/**
 * ピッキングリスト（印刷専用）
 *
 * 外注が在庫保管庫から商品を拾うときの作業用紙。配布用リストXLSXを印刷して
 * 現物と照合していた運用を、そのまま紙で置き換えるためのページ。
 *
 * XLSXと違って顧客向けの項目（タイトル・説明文・採寸・AIキーワード）は載せない。
 * 拾うのに要るのは「どの箱の・どれを・現物が合っているか」だけで、3,000字の
 * 説明文が混ざったxlsxは印刷に向かなかった。
 *
 * 顧客の氏名も出さない。作業に不要で、紙は持ち歩かれるため。
 */

export function getPickPageHtml(safeJson) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ピッキングリスト</title>
<style>
  @page { size: A4 portrait; margin: 10mm 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    color: #111; background: #f5f5f5;
  }
  .sheet { max-width: 900px; margin: 0 auto; background: #fff; padding: 20px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .head h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: 1px; }
  .meta { font-size: 12px; color: #444; line-height: 1.6; }
  .meta b { font-size: 14px; }
  .actions { margin: 0 0 14px; }
  .print-btn {
    background: #1a1a2e; color: #fff; border: 0; padding: 10px 18px;
    border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .print-btn:active { opacity: .85; }
  .hint { font-size: 12px; color: #666; margin-top: 6px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: middle; }
  th { background: #eee; font-size: 11px; white-space: nowrap; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  td.chk { width: 26px; text-align: center; font-size: 15px; }
  td.no { width: 34px; text-align: right; color: #666; }
  td.box { width: 92px; font-weight: 700; white-space: nowrap; }
  td.mid { width: 74px; font-weight: 700; white-space: nowrap; }
  td.size { width: 62px; white-space: nowrap; }
  td.color { width: 74px; white-space: nowrap; }
  /* 箱が変わる行に太線を引く。箱ごとにまとめて拾えるようにするため */
  tr.newbox td { border-top: 2px solid #111; }
  .foot { margin-top: 14px; font-size: 11px; color: #555; display: flex; justify-content: space-between; }
  .empty { padding: 40px; text-align: center; color: #666; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { max-width: none; padding: 0; }
    .actions { display: none; }
    th { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="sheet" id="sheet"></div>
<script>
(function() {
  var data = ${safeJson};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var items = (data.items || []).slice();

  // 箱ID順 → 管理番号順。箱を行ったり来たりせずに拾えるようにする
  items.sort(function(a, b) {
    var ab = String(a.boxId || ''), bb = String(b.boxId || '');
    if (ab !== bb) return ab < bb ? -1 : 1;
    var am = String(a.managedId || ''), bm = String(b.managedId || '');
    return am < bm ? -1 : (am > bm ? 1 : 0);
  });

  var printedAt = new Date();
  var dateStr = printedAt.getFullYear() + '/' +
    ('0' + (printedAt.getMonth() + 1)).slice(-2) + '/' +
    ('0' + printedAt.getDate()).slice(-2);

  var boxes = {};
  items.forEach(function(it) { boxes[String(it.boxId || '')] = 1; });
  var boxCount = Object.keys(boxes).length;

  var html =
    '<div class="head">' +
      '<div>' +
        '<h1>ピッキングリスト</h1>' +
        '<div class="meta">受付番号：<b>' + esc(data.receiptNo || '') + '</b></div>' +
      '</div>' +
      '<div class="meta" style="text-align:right">' +
        '合計 <b>' + items.length + '</b> 点 ／ ' + boxCount + ' 箱<br>' +
        '出力日：' + dateStr +
      '</div>' +
    '</div>' +
    '<div class="actions">' +
      '<button type="button" class="print-btn" onclick="window.print()">この画面を印刷する</button>' +
      '<div class="hint">A4縦の印刷に合わせてあります。複数ページになる場合も、見出し行は各ページの先頭に出ます。</div>' +
    '</div>';

  if (items.length === 0) {
    html += '<div class="empty">商品がありません。</div>';
  } else {
    html +=
      '<table>' +
        '<thead><tr>' +
          '<th></th><th>No.</th><th>箱ID</th><th>管理番号</th>' +
          '<th>ブランド</th><th>アイテム</th><th>サイズ</th><th>色</th>' +
        '</tr></thead><tbody>';

    var prevBox = null;
    items.forEach(function(it, i) {
      var box = String(it.boxId || '');
      var cls = (prevBox !== null && box !== prevBox) ? ' class="newbox"' : '';
      prevBox = box;
      html +=
        '<tr' + cls + '>' +
          '<td class="chk">□</td>' +
          '<td class="no">' + (i + 1) + '</td>' +
          '<td class="box">' + esc(box || '—') + '</td>' +
          '<td class="mid">' + esc(it.managedId || '') + '</td>' +
          '<td>' + esc(it.brand || '') + '</td>' +
          '<td>' + esc(it.item || '') + '</td>' +
          '<td class="size">' + esc(it.size || '') + '</td>' +
          '<td class="color">' + esc(it.color || '') + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>' +
      '<div class="foot">' +
        '<span>拾い終わったら□にチェックを入れてください。</span>' +
        '<span>デタウリ.Detauri</span>' +
      '</div>';
  }

  document.getElementById('sheet').innerHTML = html;
})();
</script>
</body>
</html>`;
}
