// =====================================================
// ApologyPoints.gs — お詫びポイントの手動付与（GASエディタから実行）
// =====================================================
// 用途: 当店側の不手際（商品の入れ違い等）へのお詫びとして、会員にポイントを付与する。
//       クーポンは1注文に1コードしか使えないため、他のクーポンと併用してもらいたい
//       お詫びはポイントで渡す（ポイントはクーポン割引の後に差し引かれる）。
//
// 有効期限: ポイントの通常ルール（POINT_EXPIRY_MONTHS・更新日から12か月）に従う。
// 二重付与防止: 受付番号ごとに ScriptProperty APOLOGY_PT_<受付番号> へ PENDING→DONE の順で記録する。
//               PENDING のまま＝結果不明なので自動では再加算しない。
// 顧客の特定: 顧客ID（顧客管理 A列）。メールアドレスはコードに書かない。
// 反映: Workers側(D1)へは顧客管理シート→D1の5分同期で反映される。
// =====================================================

/**
 * エディタから実行したオーナー本人のときだけ通す。
 * Web App は匿名アクセス・デプロイ者として実行のため、公開関数は誰でも呼べてしまう。
 */
function apologyPoints_assertEditor_() {
  var active = '', effective = '';
  try { active = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  try { effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!active || active !== effective) throw new Error('この関数はGASエディタから実行してください');
}

/**
 * お詫びポイントを付与する（受付番号ごとに1回だけ）。
 *
 * @param {string} receiptNo 受付番号（二重付与防止のキー）
 * @param {string} customerId 顧客ID（顧客管理 A列）
 * @param {number} points 付与ポイント
 * @return {string} 結果メッセージ
 */
function apologyPoints_grant_(receiptNo, customerId, points) {
  apologyPoints_assertEditor_();
  var no = String(receiptNo || '').trim();
  var id = String(customerId || '').trim();
  var pt = Math.floor(Number(points) || 0);
  if (!no || !id || pt <= 0) throw new Error('受付番号・顧客ID・ポイント数を指定してください');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'APOLOGY_PT_' + no;
    var state = props.getProperty(key);
    if (state && state.indexOf('DONE ') === 0) {
      var doneMsg = '付与済みです（' + state + '）';
      console.log(doneMsg);
      return doneMsg;
    }

    var sheet = getCustomerSheet_();
    var data = sheet.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][CUSTOMER_SHEET_COLS.ID] || '').trim() === id) { row = i + 1; break; }
    }
    if (row === -1) throw new Error('顧客IDが見つかりません: ' + id);
    var before = Number(data[row - 1][CUSTOMER_SHEET_COLS.POINTS] || 0);

    // 前回が途中で止まっている＝加算できたか不明。自動では再加算しない（二重付与防止）
    if (state) {
      var pendMsg = '前回の実行が途中で止まっています（' + state + '）。現在の残高は ' + before +
        'pt です。顧客管理シートを確認し、未付与なら ScriptProperty ' + key + ' を削除して再実行、' +
        '付与済みなら値の先頭を DONE に書き換えてください';
      console.log(pendMsg);
      return pendMsg;
    }

    var after = before + pt;
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') +
      ' ' + id + ' ' + before + 'pt→' + after + 'pt';
    // 残高を書く前に「実行中」を残す（この後で失敗しても、再実行が黙って再加算しない）
    props.setProperty(key, 'PENDING ' + stamp);

    sheet.getRange(row, CUSTOMER_SHEET_COLS.POINTS + 1).setValue(after);
    updatePointsTimestamp_(row);
    SpreadsheetApp.flush();
    props.setProperty(key, 'DONE ' + stamp);

    var email = String(data[row - 1][CUSTOMER_SHEET_COLS.EMAIL] || '').trim().toLowerCase();
    try { CacheService.getScriptCache().remove('CUSTOMER:' + email); } catch (e) {}

    var msg = '付与しました: ' + id + ' ' + before + 'pt → ' + after + 'pt（D1反映は最大5分後）';
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/** 受付番号 20260922043143-676（zC502 と zC464 の袋の入れ違い）へのお詫び 500pt */
function apologyPoints_grant_20260922043143_676() {
  return apologyPoints_grant_('20260922043143-676', 'CMMO8OO56', 500);
}
