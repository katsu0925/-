/**
 * サムネイル(_thumb)キー・URL 派生ヘルパー
 *
 * 内部タスキ箱の一覧表示を軽量化するため、原寸画像 products/{id}/{uuid}.jpg に対し
 * 同じ uuid の products/{id}/{uuid}_thumb.jpg（長辺320/品質0.7）を別オブジェクトとして
 * 保存する。_thumb は原寸から派生する「表示専用キャッシュ」であり、原画ではない。
 *
 * 重要な不変条件:
 *   - _thumb は UUID形式のキーからのみ派生する。legacy の番号URL（{n}.jpg）は対象外で null を返す。
 *   - _thumb は派生物なので、原寸を削除する全経路で連動削除してよい（保護対象照合は不要）。
 *   - D1・API が保持する代表画像は必ず「原寸URL」。_thumb はフロント表示時の src 差し替えのみ。
 *
 * upload.js と sheets-sync.js の両方から import される。
 */

// products/{id}/{uuid}.jpg のみマッチ（uuid = v4形式の36文字）。番号URLは弾く。
const THUMB_KEY_RE = /^(products\/[^/]+\/[a-f0-9-]{36})\.jpg$/i;

/**
 * R2キー（例: products/ZK123/{uuid}.jpg）→ 対応する _thumb キー。
 * UUID形式でなければ null。
 */
export function deriveThumbKey_(r2Key) {
  if (!r2Key) return null;
  const m = String(r2Key).match(THUMB_KEY_RE);
  return m ? m[1] + '_thumb.jpg' : null;
}

/**
 * 画像URL（/images/products/{id}/{uuid}.jpg）→ 対応する _thumb URL。
 * UUID形式でなければ元URLをそのまま返す（派生不可＝原寸で表示）。
 */
export function deriveThumbUrl_(url) {
  if (!url) return url;
  const s = String(url);
  const r2Key = s.replace(/^\/images\//, '').split('?')[0];
  const tk = deriveThumbKey_(r2Key);
  return tk ? '/images/' + tk : s;
}
