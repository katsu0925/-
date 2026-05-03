// Utils.gs
/**
 * Utils.gs — 全ファイル共有のユーティリティ関数
 */

// ═══════════════════════════════════════════
//  ヘッダ検索
// ═══════════════════════════════════════════

/**
 * ヘッダ行から {名前: 列番号(1始まり)} マップを構築
 */
function buildHeaderMap_(headerRow) {
  const m = {};
  for (let i = 0; i < headerRow.length; i++) {
    const key = String(headerRow[i] || '').trim();
    if (key && !(key in m)) m[key] = i + 1;
  }
  return m;
}

/**
 * ヘッダ行から列番号を取得（完全一致、見つからなければ -1）
 */
function findColByName_(headerRow, name) {
  const target = String(name || '').trim();
  for (let i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i] || '').trim() === target) return i + 1;
  }
  return -1;
}

/**
 * ヘッダ行から列番号を取得（見つからなければ throw Error）
 */
function requireCol_(headerRow, name, sheetLabel) {
  const col = findColByName_(headerRow, name);
  if (col < 0) throw new Error((sheetLabel ? sheetLabel + ': ' : '') + 'ヘッダ「' + name + '」が見つかりません');
  return col;
}

// ═══════════════════════════════════════════
//  列番号 ⇔ 列文字 変換
// ═══════════════════════════════════════════

/**
 * A1記法の列文字 → 列番号 ("A"→1, "Z"→26, "AA"→27)
 */
function colLetterToNum_(a1) {
  let n = 0;
  for (let i = 0; i < a1.length; i++) n = n * 26 + (a1.charCodeAt(i) - 64);
  return n;
}

// ═══════════════════════════════════════════
//  文字列・数値正規化
// ═══════════════════════════════════════════

/**
 * テキスト正規化（trim + 全角数字変換 + ゼロ幅文字除去）
 */
function normalizeText_(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  s = s.replace(/\u00A0/g, ' ').replace(/[　]/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.trim();
  if (!s) return '';
  s = s.replace(/[０-９]/g, function(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  return s.trim();
}

// ═══════════════════════════════════════════
//  制御ユーティリティ
// ═══════════════════════════════════════════

/**
 * ロックを取得して処理を実行（タイムアウトで取得失敗時は何もしない）
 */
function withLock_(timeout, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeout)) return;
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * トリガーを置換（既存を削除して新規作成）
 * @param {string} fnName - ハンドラ関数名
 * @param {Function} builderFn - function(trigger) で trigger を構築する
 */
function replaceTrigger_(fnName, builderFn) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
  builderFn(ScriptApp.newTrigger(fnName));
}

// ═══════════════════════════════════════════
//  プロパティ自動クリーンアップ
// ═══════════════════════════════════════════

/** 保持するプロパティキー（これ以外のパターンマッチは削除対象） */
var KEEP_PROPS_ = [
  'OPENAI_API_KEY', 'SPREADSHEET_ID', 'IMAGE_FOLDER_ID', 'INV_BUSY',
  'SWAP_EMAIL_FURUGIYAHONPO', 'SWAP_EMAIL_HOSHIIGA',
  'EC_SYNC_SRC_SPREADSHEET_ID', 'EC_SYNC_DST_SPREADSHEET_ID',
  'XLSX_SOURCE_SPREADSHEET_ID', 'XLSX_REQUEST_SPREADSHEET_ID',
  'OWNER_USER_KEYS'
];

/**
 * 不要プロパティを一括削除（手動実行 or トリガー）
 * - CALLS_YYYYMMDD: 今日以外を削除
 * - mail_sent__*: 7日以上前のものを削除
 */
function cleanupStaleProps() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all);
  var today = todayKey_();
  var keepSet = {};
  KEEP_PROPS_.forEach(function(k) { keepSet[k] = true; });

  var toDelete = [];
  keys.forEach(function(k) {
    // 保持リストに一致 → スキップ
    if (keepSet[k]) return;

    // CALLS_YYYYMMDD: 今日のみ残す
    if (k.indexOf('CALLS_') === 0) {
      if (k !== 'CALLS_' + today) toDelete.push(k);
      return;
    }

    // ATTEMPTS_*: 全て削除（リトライ回数は一時的なもの）
    if (k.indexOf('ATTEMPTS_') === 0) { toDelete.push(k); return; }

    // BACKOFF_UNTIL_*: 期限切れのものを削除
    if (k.indexOf('BACKOFF_UNTIL_') === 0) {
      var until = Number(all[k]) || 0;
      if (until < Date.now()) toDelete.push(k);
      return;
    }

    // mail_sent__*: 重複送信防止フラグのため削除しない
    if (k.indexOf('mail_sent__') === 0) return;
  });

  if (toDelete.length > 0) {
    toDelete.forEach(function(k) { props.deleteProperty(k); });
  }
  console.log('プロパティクリーンアップ: ' + toDelete.length + '件削除 / ' + keys.length + '件中');
  return { deleted: toDelete.length, total: keys.length };
}
