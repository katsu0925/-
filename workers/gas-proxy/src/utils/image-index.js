/**
 * 画像インデックス（D1 product_image_index）の真実値管理
 *
 * S3-lite: /upload 商品管理一覧を「D1 を1回 SELECT して全件返す」方式に切り替えるための共有モジュール。
 * product_image_index は KV product-images:index の権威ソースであると同時に、一覧描画に必要な
 * サムネ・件数・撮影者・アップ日時・保存回数を行に焼き込む（いずれも _thumb 派生ではなく原寸URL）。
 *
 * 旧来の KV read-modify-write は並行アップロードで競合し orphan を生んでいたため、INSERT/DELETE/UPDATE を
 * D1 で atomic 化し、KV はそこから再構築する（[[project-orphan-image-incident]]）。
 *
 * upload.js（撮影アップロード経路）と sheets-sync.js（Cron・並び替え・メタ復元経路）の双方から呼ばれる
 * リーフモジュール。循環参照を避けるため他の自作モジュールへは依存しない。
 */

/**
 * 管理番号を安定ソート可能なキーに変換する。
 * フロント managedIdCompareAsc_（接頭字昇順→数値昇順→接尾字昇順）に合わせた並びを D1 側でも再現するため、
 * 数値部をゼロ埋めした文字列を生成する。フロントは応答受信後に再ソートするので最終整合はフロント側で担保され、
 * この sort_key はあくまで初期描画順の近似。
 */
export function buildSortKey_(managedId) {
  const id = String(managedId || '').toUpperCase();
  const m = id.match(/^([A-Z]*)(\d+)(.*)$/);
  if (!m) return id;
  const prefix = m[1];
  const num = m[2].padStart(12, '0');
  const suffix = m[3];
  return `${prefix}|${num}|${suffix}`;
}

/**
 * D1 の managed_id 一覧を KV product-images:index に書き戻す（AI判定バッチ等の既存消費者が参照）。
 * メンバーシップ（行の増減）が変わったときだけ呼ぶこと。純粋な列 UPDATE では呼ばない（無駄な KV write 回避）。
 */
export async function rebuildImageIndexKv(env) {
  const { results } = await env.DB.prepare(
    'SELECT managed_id FROM product_image_index ORDER BY managed_id'
  ).all();
  const ids = (results || []).map(r => r.managed_id);
  await env.CACHE.put('product-images:index', JSON.stringify(ids));
}

/**
 * 行を完全削除（商品まるごと削除・0件化のとき）。D1 DELETE → KV index 再構築。
 */
export async function removeFromIndex(env, managedId) {
  await env.DB.prepare(
    'DELETE FROM product_image_index WHERE managed_id = ?'
  ).bind(managedId).run();
  await rebuildImageIndexKv(env);
}

/**
 * 1管理番号ぶんの行を最新化する（1件 UPSERT / 画像0件なら DELETE）。
 *
 * product-images / photo-meta / save-log の各 KV を読み、一覧描画に必要な列を行へ焼き込む。
 * - 画像0件 → 行を削除（旧 invalidateListCache 全削除の置き換え）
 * - D1 課金ガード: 既存行と全列同値なら書き込みをスキップ（Cron 経路からの多発呼び出しに耐える）
 * - メンバーシップが変わった（新規行）ときだけ KV index を再構築
 */
export async function upsertImageIndexRow(env, managedId) {
  if (!managedId) return;

  const [urlsJson, metaJson, saveLogJson] = await Promise.all([
    env.CACHE.get(`product-images:${managedId}`),
    env.CACHE.get(`photo-meta:${managedId}`),
    env.CACHE.get(`save-log:${managedId}`),
  ]);
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  const existing = await env.DB.prepare(
    `SELECT managed_id, first_image_url, second_image_url, image_count, uploaded_at,
            photographer, save_count, sort_key, urls_json
       FROM product_image_index WHERE managed_id = ?`
  ).bind(managedId).first();

  // 画像0件 → 行を消す（存在すれば DELETE）
  if (urls.length === 0) {
    if (existing) await removeFromIndex(env, managedId);
    return;
  }

  const meta = metaJson ? JSON.parse(metaJson) : {};
  let saveLog = { count: 0 };
  if (saveLogJson) { try { saveLog = JSON.parse(saveLogJson); } catch (e) { /* ignore */ } }

  const row = {
    first: urls[0] || null,
    second: urls[1] || null,
    count: urls.length,
    uploadedAt: meta.uploadedAt || null,
    photographer: meta.photographer || null,
    saveCount: saveLog.count || 0,
    sortKey: buildSortKey_(managedId),
    // 全画像URL配列を D1 にミラー。prewarm が KV を全件 get せず D1 だけで一覧画像を組めるようにする。
    urlsJson: JSON.stringify(urls),
  };

  // D1 課金ガード: 全列同値ならスキップ
  if (existing &&
      (existing.first_image_url || null) === row.first &&
      (existing.second_image_url || null) === row.second &&
      (existing.image_count || 0) === row.count &&
      (existing.uploaded_at || null) === row.uploadedAt &&
      (existing.photographer || null) === row.photographer &&
      (existing.save_count || 0) === row.saveCount &&
      (existing.sort_key || null) === row.sortKey &&
      (existing.urls_json || null) === row.urlsJson) {
    return;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO product_image_index
       (managed_id, created_at, first_image_url, second_image_url, image_count,
        uploaded_at, photographer, save_count, sort_key, updated_at, urls_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(managed_id) DO UPDATE SET
       first_image_url  = excluded.first_image_url,
       second_image_url = excluded.second_image_url,
       image_count      = excluded.image_count,
       uploaded_at      = excluded.uploaded_at,
       photographer     = excluded.photographer,
       save_count       = excluded.save_count,
       sort_key         = excluded.sort_key,
       updated_at       = excluded.updated_at,
       urls_json        = excluded.urls_json`
  ).bind(
    managedId, now, row.first, row.second, row.count,
    row.uploadedAt, row.photographer, row.saveCount, row.sortKey, now, row.urlsJson
  ).run();

  // 新規行のときだけ KV index を再構築（純 UPDATE では不要）
  if (!existing) await rebuildImageIndexKv(env);
}
