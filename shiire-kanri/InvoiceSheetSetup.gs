// InvoiceSheetSetup.gs — 請求書機能のシート構造セットアップ
// 初回 inv_setupAllSheets() を GAS エディタから手動実行する。
// 既存運用に影響を与えないよう、Q列(列17) は触らず作業者マスター AC列(列29)以降を拡張する。

var INV_SHEET = {
  HISTORY: '請求書履歴',
  REVISION: '請求書修正申請',
  GRACE: 'インボイス経過措置率',
  SETTINGS: '請求書管理者設定'
};

// 作業者マスター 拡張列の 1-indexed 列番号
// 既存 B/D/E/F-M(単価)/N/O(有効)/P/Q(対象アカウント) を壊さないため AC=29 から開始
var INV_WORKER_EXT_COL = {
  屋号: 29,       // AC
  本名: 30,       // AD
  郵便番号: 31,   // AE
  住所: 32,       // AF
  電話: 33,       // AG
  銀行名: 34,     // AH
  支店名: 35,     // AI
  口座種別: 36,   // AJ
  口座番号: 37,   // AK
  口座名義: 38,   // AL
  インボイス登録番号: 39, // AM
  振込元希望銀行: 40,     // AN
  スタッフ用備考: 41      // AO
};

var INV_WORKER_EXT_HEADERS = [
  '屋号', '本名', '郵便番号', '住所', '電話',
  '銀行名', '支店名', '口座種別', '口座番号', '口座名義',
  'インボイス登録番号', '振込元希望銀行', 'スタッフ用備考'
];

// 請求書履歴 シート 列定義 (1-indexed)
//  A=請求書番号, B=請求月(YYYY/MM), C=スタッフ名, D=スタッフメール,
//  E=屋号, F=本名, G=郵便番号, H=住所, I=電話, J=インボイス番号,
//  K=銀行名, L=支店名, M=口座種別, N=口座番号, O=口座名義, P=振込先希望銀行(スナップショット),
//  Q=採寸件数, R=撮影件数, S=出品件数, T=発送件数,
//  U=在庫管理報酬, V=固定報酬, W=経費合計, X=売上報酬, Y=その他報酬,
//  Z=採寸単価, AA=撮影単価, AB=出品単価, AC=発送単価,
//  AD=税込合計, AE=控除可能率, AF=調整額, AG=振込元銀行, AH=振込手数料, AI=請求額,
//  AJ=ステータス, AK=作成日時, AL=更新日時, AM=支払日, AN=スナップショットJSON, AO=管理者メモ,
//  AP=PDFダウンロード回数, AQ=最終ダウンロード日時, AR=PDFファイルID
var INV_HISTORY_HEADERS = [
  '請求書番号', '請求月', 'スタッフ名', 'スタッフメール',
  '屋号', '本名', '郵便番号', '住所', '電話', 'インボイス番号',
  '銀行名', '支店名', '口座種別', '口座番号', '口座名義', '振込先希望銀行',
  '採寸件数', '撮影件数', '出品件数', '発送件数',
  '在庫管理報酬', '固定報酬', '経費合計', '売上報酬', 'その他報酬',
  '採寸単価', '撮影単価', '出品単価', '発送単価',
  '税込合計', '控除可能率', '調整額', '振込元銀行', '振込手数料', '請求額',
  'ステータス', '作成日時', '更新日時', '支払日', 'スナップショットJSON', '管理者メモ',
  'PDFダウンロード回数', '最終ダウンロード日時', 'PDFファイルID'
];

// 請求書履歴 ステータス（7段階）
var INV_STATUS_LIST = ['未確認', '確認済み', '修正申請中', '修正承認済み', '作成済み', '支払済み', '取消済み'];

// 請求書修正申請 シート 列定義 (1-indexed)
//  A=申請ID, B=請求書番号, C=請求月, D=スタッフ名, E=スタッフメール,
//  F=申請日時, G=申請理由, H=申請内容JSON,
//  I=対応日時, J=対応者メール, K=ステータス, L=管理者コメント, M=再請求書番号
var INV_REVISION_HEADERS = [
  '申請ID', '請求書番号', '請求月', 'スタッフ名', 'スタッフメール',
  '申請日時', '申請理由', '申請内容JSON',
  '対応日時', '対応者メール', 'ステータス', '管理者コメント', '再請求書番号'
];

// 修正申請ステータス（5段階）
var INV_REVISION_STATUS_LIST = ['未申請', '申請中', '承認済み', '却下', '差戻し'];

// インボイス経過措置率 シート 列定義 (1-indexed)
//  A=開始YM(YYYY/MM), B=終了YM(YYYY/MM), C=控除可能率(0-1), D=控除不可率(0-1), E=備考
var INV_GRACE_HEADERS = ['開始YM', '終了YM', '控除可能率', '控除不可率', '備考'];

// 経過措置率初期データ
//  2023/10〜2026/09: 80%控除可能 / 控除不可20%
//  2026/10〜2029/09: 50%控除可能 / 控除不可50%
//  2029/10〜       :  0%控除可能 / 控除不可100%
var INV_GRACE_DEFAULTS = [
  ['2023/10', '2026/09', 0.80, 0.20, 'インボイス制度経過措置 (80%控除)'],
  ['2026/10', '2029/09', 0.50, 0.50, 'インボイス制度経過措置 (50%控除)'],
  ['2029/10', '',        0.00, 1.00, 'インボイス制度経過措置終了 (控除なし)']
];

// 請求書管理者設定 シート 列定義 (1-indexed)
//  A=有効, B=屋号, C=本名, D=郵便番号, E=住所, F=電話, G=メール,
//  H=インボイス番号, I=振込元銀行候補(JSON配列), J=楽天⇔楽天手数料,
//  K=他行小額手数料, L=他行高額手数料, M=高額しきい値(円), N=通知先メール
var INV_SETTINGS_HEADERS = [
  '有効', '屋号', '本名', '郵便番号', '住所', '電話', 'メール',
  'インボイス番号', '振込元銀行候補(JSON)', '楽天⇔楽天手数料',
  '他行小額手数料', '他行高額手数料', '高額しきい値', '通知先メール'
];

// 管理者設定 初期データ（値は管理者が後で編集する想定）
var INV_SETTINGS_DEFAULTS = [
  [
    true, '', '', '', '', '', '',
    '',
    JSON.stringify(['楽天銀行', 'PayPay銀行']),
    0, 145, 330, 30000,
    ''
  ]
];

// ============================================================
// メインセットアップ
// ============================================================

function inv_setupAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定です');
    ss = SpreadsheetApp.openById(ssId);
  }
  var log = [];
  log.push('=== invoice setup start: ' + new Date().toISOString() + ' ===');

  // 1) 請求書履歴
  log.push(inv_ensureSheet_(ss, INV_SHEET.HISTORY, INV_HISTORY_HEADERS));

  // 2) 請求書修正申請
  log.push(inv_ensureSheet_(ss, INV_SHEET.REVISION, INV_REVISION_HEADERS));

  // 3) インボイス経過措置率
  log.push(inv_ensureSheet_(ss, INV_SHEET.GRACE, INV_GRACE_HEADERS));
  log.push(inv_seedGraceRates_(ss));

  // 4) 請求書管理者設定
  log.push(inv_ensureSheet_(ss, INV_SHEET.SETTINGS, INV_SETTINGS_HEADERS));
  log.push(inv_seedSettings_(ss));

  // 5) 作業者マスター 拡張列追加
  log.push(inv_extendWorkerMaster_(ss));

  log.push('=== invoice setup done ===');
  log.forEach(function(l){ Logger.log(l); });
  return { ok: true, log: log };
}

// 指定名のシートが無ければ作り、ヘッダー1行目を保証する
function inv_ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() > headers.length) {
      sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
    }
    return 'created sheet: ' + name + ' (' + headers.length + ' cols)';
  }
  // 既存ヘッダーが空ならセット、足りなければ追記
  var curLastCol = Math.max(sh.getLastColumn(), 1);
  var cur = sh.getRange(1, 1, 1, curLastCol).getValues()[0]
    .map(function(v){ return String(v || '').trim(); });
  // 完全一致か（足りない場合は伸ばす）
  var changed = false;
  for (var i = 0; i < headers.length; i++) {
    if (cur[i] !== headers[i]) {
      sh.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
      changed = true;
    }
  }
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.setFrozenRows(1);
  return 'existing sheet: ' + name + (changed ? ' (headers updated)' : ' (headers ok)');
}

// 経過措置率の初期データ（既存行があれば触らない）
function inv_seedGraceRates_(ss) {
  var sh = ss.getSheetByName(INV_SHEET.GRACE);
  if (!sh) return 'grace seed skipped (sheet missing)';
  if (sh.getLastRow() >= 2) return 'grace seed skipped (already has rows)';
  sh.getRange(2, 1, INV_GRACE_DEFAULTS.length, INV_GRACE_DEFAULTS[0].length)
    .setValues(INV_GRACE_DEFAULTS);
  // C, D 列を % 表示に
  sh.getRange(2, 3, INV_GRACE_DEFAULTS.length, 2).setNumberFormat('0.00%');
  return 'grace seeded: ' + INV_GRACE_DEFAULTS.length + ' rows';
}

// 管理者設定 初期行
function inv_seedSettings_(ss) {
  var sh = ss.getSheetByName(INV_SHEET.SETTINGS);
  if (!sh) return 'settings seed skipped (sheet missing)';
  if (sh.getLastRow() >= 2) return 'settings seed skipped (already has row)';
  sh.getRange(2, 1, INV_SETTINGS_DEFAULTS.length, INV_SETTINGS_DEFAULTS[0].length)
    .setValues(INV_SETTINGS_DEFAULTS);
  return 'settings seeded: ' + INV_SETTINGS_DEFAULTS.length + ' rows';
}

// 作業者マスターに拡張列ヘッダーを追加（既存列を一切触らない）
function inv_extendWorkerMaster_(ss) {
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) return 'worker master: sheet not found';
  var needLastCol = INV_WORKER_EXT_COL.スタッフ用備考; // 41
  var curMaxCol = sh.getMaxColumns();
  if (curMaxCol < needLastCol) {
    sh.insertColumnsAfter(curMaxCol, needLastCol - curMaxCol);
  }
  var headerRow = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0];
  var changed = 0;
  // AC〜AO に対応ヘッダーが未セットなら入れる（既存ヘッダーは絶対に上書きしない）
  var startCol = INV_WORKER_EXT_COL.屋号; // 29
  for (var i = 0; i < INV_WORKER_EXT_HEADERS.length; i++) {
    var col = startCol + i;
    var cur = String(headerRow[col - 1] || '').trim();
    if (cur === '') {
      sh.getRange(1, col).setValue(INV_WORKER_EXT_HEADERS[i]).setFontWeight('bold');
      changed++;
    } else if (cur !== INV_WORKER_EXT_HEADERS[i]) {
      // 既存の別名ヘッダーがある場合は警告のみ（破壊しない）
      Logger.log('worker master col %s already has header "%s" (expected "%s")', col, cur, INV_WORKER_EXT_HEADERS[i]);
    }
  }
  return 'worker master extended: ' + changed + ' new headers (cols ' + startCol + '..' + (startCol + INV_WORKER_EXT_HEADERS.length - 1) + ')';
}

// ============================================================
// セルフチェック
// ============================================================

function inv_migrationSelfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定です');
    ss = SpreadsheetApp.openById(ssId);
  }
  var report = { ok: true, sheets: {}, workerExt: {}, errors: [] };
  [INV_SHEET.HISTORY, INV_SHEET.REVISION, INV_SHEET.GRACE, INV_SHEET.SETTINGS].forEach(function(n){
    var sh = ss.getSheetByName(n);
    if (!sh) { report.errors.push('missing sheet: ' + n); report.ok = false; return; }
    var lc = sh.getLastColumn();
    var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function(v){ return String(v || '').trim(); });
    report.sheets[n] = { lastRow: sh.getLastRow(), lastCol: lc, headers: hdr };
  });
  var wm = ss.getSheetByName('作業者マスター');
  if (wm) {
    var lc2 = wm.getMaxColumns();
    var hdr2 = wm.getRange(1, 1, 1, lc2).getValues()[0].map(function(v){ return String(v || '').trim(); });
    INV_WORKER_EXT_HEADERS.forEach(function(h, i){
      var col = INV_WORKER_EXT_COL.屋号 + i;
      report.workerExt[h] = { col: col, actual: hdr2[col - 1] || '' };
      if (hdr2[col - 1] !== h) {
        report.errors.push('worker col ' + col + ' expected "' + h + '" but got "' + (hdr2[col - 1] || '') + '"');
      }
    });
  } else {
    report.errors.push('作業者マスター not found');
    report.ok = false;
  }
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// ============================================================
// 請求書履歴 全件削除 (1行目ヘッダーは残す)
// ────────────────────────────────────────────────
// GAS エディタの関数ドロップダウンから手動実行する。
// 通常運用では呼ばない。重複行のクリーンアップ等にのみ使う。
// 末尾アンダースコア無しでパブリック化（エディタUIから選択可能にするため）。
// ============================================================
function invPurgeAllInvoices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
    if (!ssId) throw new Error('SPREADSHEET_ID が未設定です');
    ss = SpreadsheetApp.openById(ssId);
  }
  var sh = ss.getSheetByName(INV_SHEET.HISTORY);
  if (!sh) {
    Logger.log('請求書履歴シートがありません');
    return { ok: false, error: '請求書履歴シートがありません' };
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log('削除対象なし');
    return { ok: true, deleted: 0, message: '削除対象なし' };
  }
  var n = lastRow - 1;
  sh.deleteRows(2, n);
  Logger.log(n + ' 行削除しました');
  return { ok: true, deleted: n, message: n + ' 行削除しました' };
}
