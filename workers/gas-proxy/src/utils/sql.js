/**
 * D1 SQL変数上限（100）対策ユーティリティ
 *
 * `IN (?,?,...)` を使うクエリは ids が多いと
 * `D1_ERROR: too many SQL variables` でクエリ全体が失敗する。
 * カートが100点以上になると確保同期・注文送信が全滅していた（2026-08-25 修正）。
 * ids を分割して実行し、結果を結合する。
 */

// 100 が上限。userKey / now などの追加バインドぶんを差し引いて余裕を持たせる
export const SQL_VAR_LIMIT = 90;

/** ids を size 件ずつに分割 */
export function chunkIds(ids, size = SQL_VAR_LIMIT) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * ids を分割して SELECT を実行し、results を結合して返す
 * @param {string[]} ids
 * @param {(placeholders: string, chunk: string[]) => object} build bind済みのD1文を返す
 * @returns {Promise<object[]>} 結合済みの results
 */
export async function selectInChunks(ids, build, size = SQL_VAR_LIMIT) {
  if (!ids || ids.length === 0) return [];
  const parts = await Promise.all(
    chunkIds(ids, size).map((c) => build(c.map(() => '?').join(','), c).all())
  );
  const out = [];
  for (const p of parts) for (const r of (p.results || [])) out.push(r);
  return out;
}

/**
 * ids を分割して文を組み立て、配列で返す（batch へ push する用途）
 * @param {string[]} ids
 * @param {(placeholders: string, chunk: string[]) => object} build
 * @returns {object[]} D1文の配列
 */
export function statementsInChunks(ids, build, size = SQL_VAR_LIMIT) {
  if (!ids || ids.length === 0) return [];
  return chunkIds(ids, size).map((c) => build(c.map(() => '?').join(','), c));
}
