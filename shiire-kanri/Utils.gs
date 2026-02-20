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
