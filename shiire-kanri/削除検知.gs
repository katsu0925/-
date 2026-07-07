// 削除検知.gs
/**
 * 削除検知.gs — メルカリ「削除済み」出品の自動検出・ステータス更新
 *
 * 【背景】
 * 運用者がメルカリ出品を削除しても、返送管理シートに管理番号を報告しないと
 * 商品管理のステータスは「出品中」のまま残る。返送済みステータス変更.gs は
 * 「返送管理シートへの報告」が唯一のトリガーのため、未報告の削除は検知できず、
 * 月初の入替リストPDF（buildSwapList_＝出品中の古い順N件）に削除済み商品が
 * 混入してしまう。（2026-07 古着屋本舗の入替リストに zC91〜zC227 が混入した事象）
 *
 * 【対策】
 * 出品中かつメルカリリンクを持つ商品を「出品日の古い順」に巡回して商品ページを取得し、
 * SSR HTML に「削除されています」が含まれる＝削除済みと判定して、
 * ステータスを「売却済み」に更新する。
 *
 * 【なぜ「売却済み」か（安全性）】
 * - 販売日・完了日は空欄のまま更新する。これは既存の「売却済み×完了日空白」バケット
 *   （＝約1,600件の旧売却済み）と同じ扱いで、売上・完了数・在庫totalには計上されない。
 * - Worker 側 DERIVED_STATUS は raw status を最優先で尊重する（前進のみ・降格なし）ため、
 *   出品中→売却済みは前進扱い。降格による誤集計の地雷には該当しない。
 * - 出品中プールから外れるので、以後の入替リスト候補にも上がらない。
 *
 * 【安全設計】
 * - 判定は「削除されています」の完全一致のみ。生存中の商品ページには含まれない（検証済＝
 *   本日出品の生存4件で0件・削除済み3件で1件）。
 * - 取得失敗 / 非200・404 / 実体のないレスポンスでは絶対にマークしない（陽性が出た時だけ更新）。
 * - GAS 6分実行上限の回避: 1実行あたりの取得件数(MAX_CHECKS_PER_RUN)と実行時間(MAX_RUNTIME_MS)を
 *   ハードガードし、超えたら途中終了して次回に継続する。
 * - 書き込みは該当行の「ステータス」セルのみ（全列 setValues による lost-update を避ける）。
 *   書き込み直前に対象行の管理番号とステータスを再読込し、行ズレ／状態変化があればスキップ。
 * - チェック済み管理番号と最終チェック日時を「削除検知チェック状態」シートに保持し、
 *   RECHECK_DAYS 以内の再取得を省いて出品中プール全体をローテーション巡回する。
 * - UrlFetchApp は既存の OAuth スコープ(script.external_request)で動くため、
 *   本ファイル追加による再認証は不要（新スコープ追加＝トリガー失効の回避）。
 */

var DL_CONFIG = {
  PRODUCT_SHEET_NAME: '商品管理',
  STATE_SHEET_NAME: '削除検知チェック状態',   // チェック済み管理番号＋最終チェック時刻（非表示）
  LOG_SHEET_NAME: '削除検知ログ',             // 実行ごとの結果ログ
  STATUS_ACTIVE: '出品中',
  STATUS_DELETED: '売却済み',                 // 削除検出時に設定するステータス（販売日・完了日は空欄のまま）
  DELETED_MARKERS: ['削除されています'],      // メルカリ削除済みページの固有文言
  LINK_RE: /mercari\.com\/item\//i,          // 対象リンク（メルカリ個品URL）
  RECHECK_DAYS: 10,                           // 生存中商品の再チェック間隔（プール一巡の目安）
  MAX_CHECKS_PER_RUN: 250,                    // 1実行あたりの最大取得件数
  MAX_RUNTIME_MS: 280000,                     // 4分40秒でループ打ち切り（6分上限回避）
  FETCH_GAP_MS: 250,                          // メルカリへの連続アクセス間隔
  UA: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
};

// ═══════════════════════════════════════════
//  入口（手動 / タイムトリガー共通）
// ═══════════════════════════════════════════

/**
 * 削除検知を実行する。ロックで多重実行を防ぐ。
 * @param {Object=} opts { maxChecks:number, ignoreCache:boolean }
 *   タイムトリガーからはイベントオブジェクトが渡るので無視する。
 * @return {Object} 実行サマリー
 */
function runDeletedListingSweep(opts) {
  if (opts && opts.triggerUid) opts = null; // タイムトリガーのイベントオブジェクトは無視
  var out = withLock_(10 * 1000, function() {
    return sweepDeletedListingsCore_(opts || {});
  });
  return out || { skipped: true, message: '別の掃引が実行中のためスキップしました' };
}

/**
 * メニューから手動実行（結果をダイアログ表示）。
 */
function menu_runDeletedListingSweep() {
  var ui = SpreadsheetApp.getUi();
  var s = runDeletedListingSweep({});
  if (s && s.skipped) { ui.alert('削除検知', s.message || 'スキップしました', ui.ButtonSet.OK); return; }
  var msg =
    'チェック: ' + s.checked + '件\n' +
    '削除検出: ' + s.deleted + '件\n' +
    'ステータス更新（売却済み）: ' + s.marked + '件\n' +
    'スキップ（行ズレ/状態変化）: ' + s.skipped + '件\n' +
    '取得失敗（不明・再試行対象）: ' + s.errors + '件\n' +
    '未チェック残り: ' + s.remaining + '件' + (s.ranOut ? '（時間切れで途中終了）' : '') +
    (s.markedIds && s.markedIds.length ? '\n\n更新した管理番号:\n' + s.markedIds.join(', ') : '');
  ui.alert('削除検知の結果', msg, ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  本体
// ═══════════════════════════════════════════

function sweepDeletedListingsCore_(opts) {
  var startMs = Date.now();
  var maxChecks = opts.maxChecks || DL_CONFIG.MAX_CHECKS_PER_RUN;
  var ignoreCache = !!opts.ignoreCache;

  var summary = {
    checked: 0, deleted: 0, marked: 0, skipped: 0, errors: 0,
    markedIds: [], remaining: 0, ranOut: false, elapsedMs: 0
  };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DL_CONFIG.PRODUCT_SHEET_NAME);
  if (!sheet) throw new Error('商品管理シートが見つかりません');

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol <= 0) return summary;

  var header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var hMap = buildHeaderMap_(header);
  ['管理番号', 'ステータス', 'リンク', '出品日'].forEach(function(n) {
    if (!hMap[n]) throw new Error('ヘッダ「' + n + '」が見つかりません');
  });
  var cId = hMap['管理番号'], cStatus = hMap['ステータス'], cLink = hMap['リンク'], cDate = hMap['出品日'];

  var numRows = lastRow - 1;
  // 必要な列だけ読む（全列読みは避ける）
  var idVals = sheet.getRange(2, cId, numRows, 1).getDisplayValues();
  var stVals = sheet.getRange(2, cStatus, numRows, 1).getDisplayValues();
  var lkVals = sheet.getRange(2, cLink, numRows, 1).getDisplayValues();
  var dtVals = sheet.getRange(2, cDate, numRows, 1).getDisplayValues();

  var activeNorm = normalizeText_(DL_CONFIG.STATUS_ACTIVE);
  var candidates = [];
  for (var r = 0; r < numRows; r++) {
    if (normalizeText_(stVals[r][0]) !== activeNorm) continue;
    var link = String(lkVals[r][0] || '').trim();
    if (!DL_CONFIG.LINK_RE.test(link)) continue;
    var id = normalizeText_(idVals[r][0]);
    if (!id) continue;
    candidates.push({ row: r + 2, id: id, link: link, date: parseSwapDate_(dtVals[r][0]) });
  }

  // 出品日の古い順（空欄は末尾＝最新扱い。入替リストの並びと同じ思想）
  candidates.sort(function(a, b) {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

  // チェック状態ロード（出品中でなくなった管理番号はプルーニング）
  var activeIdSet = {};
  candidates.forEach(function(c) { activeIdSet[c.id] = true; });
  var state = dl_loadCheckState_(ss, activeIdSet); // { id: epochMs }
  var recheckMs = DL_CONFIG.RECHECK_DAYS * 24 * 3600 * 1000;
  var nowMs = Date.now();

  // 巡回ワークリスト（キャッシュ有効なら未チェック／期限切れのみ）
  var worklist = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var last = state[c.id] || 0;
    if (ignoreCache || (nowMs - last) >= recheckMs) worklist.push(c);
  }
  summary.remaining = worklist.length;

  // 取得＆判定
  var toMark = [];
  for (var w = 0; w < worklist.length; w++) {
    if (summary.checked >= maxChecks) break;
    if ((Date.now() - startMs) >= DL_CONFIG.MAX_RUNTIME_MS) { summary.ranOut = true; break; }
    var item = worklist[w];
    var verdict = dl_isDeleted_(item.link); // true=削除 / false=生存 / null=不明
    summary.checked++;
    if (verdict === true) {
      summary.deleted++;
      toMark.push(item);
      state[item.id] = Date.now();
    } else if (verdict === false) {
      state[item.id] = Date.now(); // 生存＝チェック済みスタンプ
    } else {
      summary.errors++;            // 不明はスタンプせず次回再チェック対象に残す
    }
    if (DL_CONFIG.FETCH_GAP_MS) Utilities.sleep(DL_CONFIG.FETCH_GAP_MS);
  }
  summary.remaining = Math.max(0, summary.remaining - summary.checked);

  // 書き込み直前に対象2列を再読込（掃引中の他者編集による行ズレ／状態変化を検出）
  if (toMark.length) {
    var idNow = sheet.getRange(2, cId, numRows, 1).getDisplayValues();
    var stNow = sheet.getRange(2, cStatus, numRows, 1).getDisplayValues();
    for (var m = 0; m < toMark.length; m++) {
      var it = toMark[m];
      var idx = it.row - 2;
      try {
        if (idx < 0 || idx >= numRows) { summary.skipped++; continue; }
        if (normalizeText_(idNow[idx][0]) !== it.id) { summary.skipped++; continue; }       // 行ズレ防止
        if (normalizeText_(stNow[idx][0]) !== activeNorm) { summary.skipped++; continue; }   // 途中で状態変化→触らない
        sheet.getRange(it.row, cStatus).setValue(DL_CONFIG.STATUS_DELETED);
        summary.marked++;
        summary.markedIds.push(it.id);
      } catch (e) {
        summary.errors++;
      }
    }
  }

  dl_saveCheckState_(ss, state);
  summary.elapsedMs = Date.now() - startMs;

  dl_appendLog_(ss, summary);
  dl_notifyAdmin_(summary);

  return summary;
}

// ═══════════════════════════════════════════
//  削除判定（メルカリ商品ページ取得）
// ═══════════════════════════════════════════

/**
 * メルカリ商品ページを取得し削除済みか判定する。
 * @param {string} link 商品URL
 * @return {boolean|null} true=削除済み / false=生存 / null=判定不能（取得失敗・非200/404・空応答）
 */
function dl_isDeleted_(link) {
  try {
    var resp = UrlFetchApp.fetch(link, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: { 'User-Agent': DL_CONFIG.UA, 'Accept-Language': 'ja,en;q=0.8' }
    });
    var code = resp.getResponseCode();
    if (code !== 200 && code !== 404) return null; // 403/429/5xx等は不明扱い（マークしない）
    var body = resp.getContentText();
    if (!body || body.length < 200) return null;   // 実体のない応答は不明
    for (var i = 0; i < DL_CONFIG.DELETED_MARKERS.length; i++) {
      if (body.indexOf(DL_CONFIG.DELETED_MARKERS[i]) >= 0) return true;
    }
    return false;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════
//  チェック状態の永続化
// ═══════════════════════════════════════════

/**
 * チェック状態シートを { 管理番号: 最終チェックepochMs } で読み込む。
 * activeIdSet に無い（＝もう出品中でない）管理番号は捨てる（サイズ肥大防止）。
 */
function dl_loadCheckState_(ss, activeIdSet) {
  var map = {};
  var sh = ss.getSheetByName(DL_CONFIG.STATE_SHEET_NAME);
  if (!sh) return map;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return map;
  var vals = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    var id = normalizeText_(vals[i][0]);
    if (!id) continue;
    if (activeIdSet && !activeIdSet[id]) continue;
    var ep = Number(vals[i][1]) || 0;
    if (ep > 0) map[id] = ep;
  }
  return map;
}

/**
 * チェック状態を全書き換えで保存（行数は出品中プール上限＝数千行で許容範囲）。
 */
function dl_saveCheckState_(ss, map) {
  var sh = ss.getSheetByName(DL_CONFIG.STATE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(DL_CONFIG.STATE_SHEET_NAME);
    try { sh.hideSheet(); } catch (e) {}
  }
  var ids = Object.keys(map);
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['管理番号', '最終チェックepochMs']]);
  if (ids.length) {
    var rows = ids.map(function(id) { return [id, map[id]]; });
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

// ═══════════════════════════════════════════
//  ログ＆通知
// ═══════════════════════════════════════════

function dl_appendLog_(ss, s) {
  try {
    var sh = ss.getSheetByName(DL_CONFIG.LOG_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(DL_CONFIG.LOG_SHEET_NAME);
      sh.appendRow(['実行日時', 'チェック件数', '削除検出', 'ステータス更新', 'スキップ', '取得失敗', '未チェック残り', '時間切れ', '所要秒', '更新した管理番号']);
      sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#f0f0f0');
      sh.setFrozenRows(1);
    }
    sh.appendRow([
      new Date(), s.checked, s.deleted, s.marked, s.skipped, s.errors, s.remaining,
      s.ranOut ? '時間切れ' : '', Math.round((s.elapsedMs || 0) / 1000),
      (s.markedIds || []).join(', ')
    ]);
  } catch (e) {
    console.error('削除検知ログ書き込み失敗: ' + e.message);
  }
}

function dl_notifyAdmin_(s) {
  if (!s || s.marked <= 0) return; // 更新が発生した時だけ通知
  try {
    var admin = PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL');
    if (!admin) return;
    var subject = '【削除検知】メルカリ削除済み ' + s.marked + '件を売却済みに更新しました';
    var body =
      'メルカリ上で削除されていた「出品中」商品を自動検出し、ステータスを「売却済み」に更新しました。\n' +
      '（販売日・完了日は空欄のままなので、売上・完了数には計上されません）\n\n' +
      '更新件数: ' + s.marked + '件\n' +
      '対象管理番号:\n' + (s.markedIds || []).join(', ') + '\n\n' +
      'チェック ' + s.checked + '件 / 削除検出 ' + s.deleted + '件 / スキップ ' + s.skipped + '件 / 取得失敗 ' + s.errors + '件' +
      (s.ranOut ? '\n※ 実行時間の上限で途中終了しました。残り ' + s.remaining + '件は次回実行で継続します。' : '') +
      '\n\n詳細は「' + DL_CONFIG.LOG_SHEET_NAME + '」シートをご確認ください。';
    MailApp.sendEmail(admin, subject, body);
  } catch (e) {
    console.error('削除検知 通知メール失敗: ' + e.message);
  }
}

// ═══════════════════════════════════════════
//  トリガー設定（毎日6時＝入替リスト実行の3時間前）
// ═══════════════════════════════════════════

function setupDeletedListingSweepTrigger() {
  replaceTrigger_('runDeletedListingSweep', function(tb) {
    tb.timeBased().everyDays(1).atHour(6).inTimezone('GMT+9').create();
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('削除検知トリガーを設定しました（毎日6時）', '完了', 5);
}
