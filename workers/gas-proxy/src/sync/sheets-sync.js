/**
 * D1 ⇔ Sheets 同期（Cron Trigger: 5分ごと）
 *
 * 同期方向:
 *   商品     : Sheets → D1（一方向）
 *   顧客     : 双方向（登録/ログインはD1、ポイント付与はSheets）
 *   確保     : D1 → Sheets（参考反映）
 *   依頼中   : Sheets → D1（一方向）
 *   クーポン : Sheets → D1（一方向）
 *   設定     : Sheets → D1（一方向）
 *
 * GAS側 SyncApi.gs の apiSyncExportData を呼び出してデータ取得、
 * D1にUPSERT する。
 */

/**
 * ⚠️ 重要: D1 課金事故防止
 *
 * このCronは5分ごとに走るため、各テーブルへの書き込みは
 * **必ず `syncIfChanged()` 経由で行うこと**。
 *
 * 直接 `syncProducts(env.DB, rows)` のように呼び出すと、
 * GAS側が全件返してくる現状の実装では INSERT OR REPLACE が
 * 毎ティック全行を書き直し、月100M行規模の課金事故になる。
 * （2026-04 に発生済み — D1 Rows Written $54/月）
 *
 * 新しいテーブル同期を追加する場合も `syncIfChanged()` を経由すること。
 *
 * Cron Trigger エントリポイント
 */

import { incrementGeminiUsage } from '../usage.js';

// ─── 価格破壊商品ID（¥10,000以上・送料無料クーポンの送料無料対象外） ───
// Constants.gs SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS / submit.js と同期
const ALWAYS_CHARGE_BULK_IDS = ['BLK-H2LZTP36'];

export async function scheduledSync(env) {
  console.log('[sync] Starting scheduled sync...');

  try {
    // 1. GASから差分データをエクスポート取得
    const exportData = await fetchExportData(env);
    if (!exportData || !exportData.ok) {
      console.error('[sync] Export failed:', exportData?.message || 'unknown');
      // エクスポート失敗でも撮影同期・AI判定は実行する
      await autoMatchPhotography(env);
      await syncPhotographyData(env);
      return;
    }

    // 2. 各テーブルに UPSERT — チェックサム未変化なら書き込みスキップ（D1 課金抑制）
    if (exportData.products && exportData.products.length > 0) {
      await syncIfChanged(env.DB, 'products', exportData.products,
        () => syncProducts(env.DB, exportData.products));
    }

    if (exportData.bulkProducts && exportData.bulkProducts.length > 0) {
      await syncIfChanged(env.DB, 'bulk_products', exportData.bulkProducts,
        () => syncBulkProducts(env.DB, exportData.bulkProducts));
    }

    if (exportData.customers && exportData.customers.length > 0) {
      await syncIfChanged(env.DB, 'customers', exportData.customers,
        () => syncCustomers(env.DB, exportData.customers));
    }

    if (exportData.openItems && exportData.openItems.length > 0) {
      await syncIfChanged(env.DB, 'open_items', exportData.openItems,
        () => syncOpenItems(env.DB, exportData.openItems));
    }

    if (exportData.orders && exportData.orders.length > 0) {
      await syncIfChanged(env.DB, 'orders', exportData.orders,
        () => syncOrders(env.DB, exportData.orders));
    }

    if (exportData.coupons && exportData.coupons.length > 0) {
      await syncIfChanged(env.DB, 'coupons', exportData.coupons,
        () => syncCoupons(env.DB, exportData.coupons));
    }

    if (exportData.settings) {
      await syncIfChanged(env.DB, 'settings', exportData.settings,
        () => syncSettings(env.DB, exportData.settings));
    }

    if (exportData.stats) {
      await syncIfChanged(env.DB, 'stats', exportData.stats,
        () => syncStats(env.DB, exportData.stats));
    }

    // 作業者マスター → KVに保存
    if (exportData.workers && exportData.workers.length > 0) {
      await env.CACHE.put('workers:list', JSON.stringify(exportData.workers));
      console.log(`[sync] Workers list synced: ${exportData.workers.length} rows`);
    }

    // 商品管理の管理番号リスト → KVに保存
    if (exportData.managedIds && exportData.managedIds.length > 0) {
      await env.CACHE.put('managed-ids:list', JSON.stringify(exportData.managedIds));
      console.log(`[sync] Managed IDs synced: ${exportData.managedIds.length} rows`);
    }

    // 3. sheetTotalCount（データ1 B1の掲載中件数）をKVに保存
    if (exportData.sheetTotalCount != null) {
      await env.CACHE.put('sheetTotalCount', String(exportData.sheetTotalCount));
    }

    // 4. 同期メタデータ更新
    await updateSyncMeta(env.DB, exportData);

    // 5. KVキャッシュをプリウォーム（D1→KVに最新データ書き込み）
    await prewarmCaches(env);

    // 5. D1 → Sheets 方向の同期（顧客の新規登録等）
    if (exportData.needsImport) {
      await pushImportData(env);
    }

    // 6. 撮影先行登録の自動マッチング（新規商品×先行アップロード画像）
    //    → 同じCron tick内で syncPhotographyData が処理できるよう先に実行
    await autoMatchPhotography(env);

    // 6b. 撮影データ → GAS（商品管理シートに書き込み）
    await syncPhotographyData(env);

    // 7. pending_orders クリーンアップ
    await cleanupPendingOrders(env.DB);

    // 8. session_token_map クリーンアップ（30日以上経過したレコードを削除）
    await cleanupSessionTokenMap(env.DB);

    // 9. 孤立画像クリーンアップ（30日以上未マッチ）
    await cleanupOrphanedImages(env);

    // 10. ソフトデリート商品の purge（保持期間切れの R2画像を実削除）
    await purgeSoftDeletedProducts(env);

    console.log('[sync] Sync completed successfully');
  } catch (e) {
    console.error('[sync] Sync error:', e.message, e.stack);
  }
}

// ─── checksum ガード（D1 課金事故防止）───

/**
 * 入力データのチェックサムを sync_meta テーブルに保存し、
 * 前回と一致する場合は INSERT OR REPLACE をスキップする。
 *
 * GAS の exportXxx_() は `since` を無視して全件返してくるため、
 * D1 側でガードしないと毎5分全行 UPSERT され課金が爆発する。
 *
 * @param {D1Database} db
 * @param {string} source - sync_meta.source（テーブル識別子）
 * @param {*} payload - JSON シリアライズ可能な任意の値（配列/オブジェクト）
 * @param {() => Promise<void>} doSync - 実際の書き込み処理
 * @returns {Promise<boolean>} 書き込みが実行されたら true、スキップなら false
 */
async function syncIfChanged(db, source, payload, doSync) {
  const checksum = await sha256Hex(stableStringify(payload));

  const existing = await db.prepare(
    'SELECT checksum FROM sync_meta WHERE source = ?'
  ).bind(source).first();

  if (existing && existing.checksum === checksum) {
    console.log(`[sync] ${source}: unchanged (skip write), checksum=${checksum.slice(0, 8)}`);
    return false;
  }

  await doSync();

  const rowCount = Array.isArray(payload) ? payload.length : 1;
  await db.prepare(`
    INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
    VALUES (?, ?, ?, ?)
  `).bind(source, new Date().toISOString(), rowCount, checksum).run();

  console.log(`[sync] ${source}: synced ${rowCount} rows, checksum=${checksum.slice(0, 8)}`);
  return true;
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// キー順を固定して JSON 化（同一データ → 同一文字列を保証）
function stableStringify(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// ─── pending_orders クリーンアップ ───

async function cleanupPendingOrders(db) {
  try {
    const now = new Date();

    // consumed=1 かつ7日以上経過 → DELETE
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { meta: delMeta } = await db.prepare(
      'DELETE FROM pending_orders WHERE consumed = 1 AND created_at < ?'
    ).bind(sevenDaysAgo).run();
    if (delMeta.changes > 0) {
      console.log(`[sync] pending_orders cleanup: deleted ${delMeta.changes} consumed rows (>7 days)`);
    }

    // consumed=0 かつ14日以上経過 → WARNING（削除はしない）
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { results: staleRows } = await db.prepare(
      'SELECT payment_token, created_at FROM pending_orders WHERE consumed = 0 AND created_at < ?'
    ).bind(fourteenDaysAgo).all();
    for (const row of staleRows) {
      console.warn(`[sync] WARNING: unconsumed pending_order >14 days: token=${row.payment_token}, created=${row.created_at}`);
    }
  } catch (e) {
    console.error('[sync] pending_orders cleanup error:', e.message);
  }
}

// ─── session_token_map クリーンアップ ───

async function cleanupSessionTokenMap(db) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { meta } = await db.prepare(
      'DELETE FROM session_token_map WHERE created_at < ?'
    ).bind(thirtyDaysAgo).run();
    if (meta.changes > 0) {
      console.log(`[sync] session_token_map cleanup: deleted ${meta.changes} rows (>30 days)`);
    }
  } catch (e) {
    console.error('[sync] session_token_map cleanup error:', e.message);
  }
}

// ─── GAS API通信 ───

async function fetchExportData(env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    console.error('[sync] GAS_API_URL not configured');
    return null;
  }

  // 最終同期時刻を取得
  const lastSync = await getLastSyncTime(env.DB);

  const body = JSON.stringify({
    action: 'apiSyncExportData',
    args: [{
      syncSecret: env.SYNC_SECRET || '',
      since: lastSync,
      tables: ['products', 'bulkProducts', 'customers', 'openItems', 'coupons', 'settings', 'stats', 'workers', 'managedIds', 'orders'],
    }],
  });

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'follow',
  });

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[sync] Failed to parse GAS response:', text.substring(0, 200));
    return null;
  }
}

async function pushImportData(env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) return;

  // D1から新規/更新された顧客を取得
  const lastImport = await getLastImportTime(env.DB);
  const { results: newCustomers } = await env.DB.prepare(`
    SELECT * FROM customers
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    LIMIT 100
  `).bind(lastImport).all();

  if (newCustomers.length === 0) return;

  const body = JSON.stringify({
    action: 'apiSyncImportData',
    args: [{
      syncSecret: env.SYNC_SECRET || '',
      customers: newCustomers.map(c => ({
        id: c.id,
        email: c.email,
        passwordHash: c.password_hash,
        companyName: c.company_name,
        phone: c.phone,
        postal: c.postal,
        address: c.address,
        newsletter: c.newsletter,
        createdAt: c.created_at,
        lastLogin: c.last_login,
        points: c.points,
        pointsUpdatedAt: c.points_updated_at,
        purchaseCount: c.purchase_count,
      })),
    }],
  });

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'follow',
  });

  const text = await resp.text();
  try {
    const result = JSON.parse(text);
    if (result.ok) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
         VALUES ('import_customers', ?, ?, '')`
      ).bind(new Date().toISOString(), newCustomers.length).run();
    }
  } catch (e) {
    console.error('[sync] Import push failed:', e.message);
  }
}

// ─── 撮影データ同期 ───

async function syncPhotographyData(env) {
  try {
    const pendingJson = await env.CACHE.get('photo-meta:pending');
    if (!pendingJson) return;
    const pending = JSON.parse(pendingJson);
    if (!pending || pending.length === 0) return;

    // 商品管理シートに登録済みの managedId セット（photographyData フィルタ用）
    // 未登録の場合 photographer/photographyDate は商品管理シートに書けない（importPhotographyData_ がスキップ）
    // → 未登録分は AI判定のみ実行し、AI画像判定シートに先行書き込みすることで
    //   AppSheet 側 LOOKUP プリフィルが利く
    const idsJson = await env.CACHE.get('managed-ids:list');
    const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

    // バッチ上限: GAS の apiSyncImportData は 1回 100s 以内に収める必要があるため
    // 1Cron で送信する件数を制限する（524 タイムアウト回避）
    const MAX_BATCH = 25;

    // LIFO: 新しいアップロードを優先処理する
    // FIFO だと過去の溜まった古いID（既に synced 済み or 商品管理未登録）の skip 処理に
    // バッチ枠を消費してしまい、直近アップロード分が長時間待たされるため。
    // pending 末尾＝最新アップロード を先に取り出す
    const entries = [];
    const orphanIds = new Set(); // photo-meta が存在しない pending 項目（除去対象）
    for (let i = pending.length - 1; i >= 0; i--) {
      if (entries.length >= MAX_BATCH) break;
      const managedId = pending[i];
      const metaJson = await env.CACHE.get(`photo-meta:${managedId}`);
      if (!metaJson) {
        orphanIds.add(managedId);
        continue;
      }
      const meta = JSON.parse(metaJson);
      entries.push({ managedId, meta });
    }

    if (entries.length === 0) {
      await env.CACHE.delete('photo-meta:pending');
      return;
    }

    // AI判定（Gemini）— 画像がある場合のみ
    // 結果はKVに保存し、GASへの送信時にまとめて含める
    //
    // 失敗ループ防止: 3回連続失敗した managedId は ai-failed カウンタで
    // 永続スキップする。これをやらないと、LIFO バッチ枠を同じ 25件が
    // 占拠して、pending 先頭側の items が永久に処理されなくなる。
    // （2026-05-21 pending=1224 停滞バグの根因対策）
    const AI_MAX_ATTEMPTS = 3;
    const geminiKey = env.GEMINI_API_KEY || '';
    if (geminiKey) {
      for (const entry of entries) {
        if (entry.meta.aiSynced === true) continue;
        const existingAi = await env.CACHE.get(`ai-result:${entry.managedId}`);
        if (existingAi) continue;

        // 永続失敗マーカー確認
        const failedJson = await env.CACHE.get(`ai-failed:${entry.managedId}`);
        if (failedJson) {
          try {
            const f = JSON.parse(failedJson);
            if ((f.attempts || 0) >= AI_MAX_ATTEMPTS) continue;
          } catch (_) {}
        }

        try {
          const aiResult = await runGeminiJudgment(env, entry.managedId, geminiKey);
          if (aiResult) {
            await env.CACHE.put(`ai-result:${entry.managedId}`, JSON.stringify(aiResult), { expirationTtl: 30 * 24 * 3600 });
            await env.CACHE.delete(`ai-failed:${entry.managedId}`);
            console.log(`[sync] AI判定OK: ${entry.managedId}`);
          } else {
            await incrementAiFailure(env, entry.managedId, 'null result');
          }
        } catch (e) {
          console.error(`[sync] AI判定失敗: ${entry.managedId}: ${e.message}`);
          await incrementAiFailure(env, entry.managedId, e.message);
        }
      }
    }

    // 送信データを2系統に分ける:
    //   photographyData: 商品管理に行がある & まだ synced されていないもの
    //   aiData:          まだ aiSynced されていない & ai-result キャッシュあり
    const photographyData = [];
    const photoSentIds = new Set();
    const aiData = [];
    const aiSentIds = new Set();
    for (const entry of entries) {
      const isRegistered = registeredIds.has(entry.managedId);
      const photoSynced = entry.meta.synced === true;
      const aiSynced = entry.meta.aiSynced === true || entry.meta.synced === true;
      // 既存データ互換: meta.synced=true は AI も書き済みとみなす（移行期）

      if (isRegistered && !photoSynced) {
        photographyData.push({
          managedId: entry.managedId,
          photographer: entry.meta.photographer || '',
          photographyDate: entry.meta.photographyDate || '',
        });
        photoSentIds.add(entry.managedId);
      }

      if (!aiSynced) {
        const cachedAi = await env.CACHE.get(`ai-result:${entry.managedId}`);
        if (cachedAi) {
          aiData.push({ managedId: entry.managedId, ...JSON.parse(cachedAi) });
          aiSentIds.add(entry.managedId);
        }
      }
    }

    if (photographyData.length === 0 && aiData.length === 0) {
      console.log('[sync] Photography: nothing to send (all synced or no data)');
      // 処理対象 entries + orphan を pending から取り除く
      const processedIds = new Set([...entries.map(e => e.managedId), ...orphanIds]);
      const remaining = pending.filter(id => !processedIds.has(id));
      if (remaining.length > 0) {
        await env.CACHE.put('photo-meta:pending', JSON.stringify(remaining));
      } else {
        await env.CACHE.delete('photo-meta:pending');
      }
      return;
    }

    if (aiData.length > 0) console.log(`[sync] AI判定結果送信: ${aiData.length}件`);
    if (photographyData.length > 0) console.log(`[sync] 撮影者/日付送信: ${photographyData.length}件`);

    // GASに送信
    const gasUrl = env.GAS_API_URL;
    if (!gasUrl) return;

    const body = JSON.stringify({
      action: 'apiSyncImportData',
      args: [{
        syncSecret: env.SYNC_SECRET || '',
        photographyData: photographyData.length > 0 ? photographyData : undefined,
        aiData: aiData.length > 0 ? aiData : undefined,
      }],
    });

    const resp = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'follow',
    });

    const text = await resp.text();
    console.log(`[sync] Photography GAS response: ${text.substring(0, 500)}`);
    try {
      const result = JSON.parse(text);
      console.log(`[sync] Photography result: ok=${result.ok}, imported=${JSON.stringify(result.imported)}`);
      if (result.ok) {
        const photoWritten = result.imported?.photography || 0;
        const aiWritten = result.imported?.aiProduct || 0;

        // 全件成功した側だけ synced/aiSynced を立てる。失敗側は次Cronで再試行
        const photoAllOk = photographyData.length > 0 && photoWritten >= photographyData.length;
        const aiAllOk = aiData.length > 0 && aiWritten >= aiData.length;

        // GAS 書込み成功直後に shiire-kanri D1 へも直接反映（管理アプリ即時反映）
        // shiire-kanri 5分 Cron を待たずに 撮影日付/撮影者 を extra_json に書き込む。
        // content_hash は触らないので次の shiire-kanri Cron で同値で再 UPSERT されても無害。
        if (photoAllOk && env.SHIIRE_DB) {
          await syncPhotoToShiireKanri(env, photographyData);
        }

        const touchIds = new Set([...photoSentIds, ...aiSentIds]);
        for (const mid of touchIds) {
          const metaJson = await env.CACHE.get(`photo-meta:${mid}`);
          if (!metaJson) continue;
          try {
            const meta = JSON.parse(metaJson);
            if (photoAllOk && photoSentIds.has(mid)) meta.synced = true;
            if (aiAllOk && aiSentIds.has(mid)) {
              meta.aiSynced = true;
              // AI送信済みになったら ai-result は不要（再送信防止）
              await env.CACHE.delete(`ai-result:${mid}`);
            }
            await env.CACHE.put(`photo-meta:${mid}`, JSON.stringify(meta));
          } catch (e) {
            console.error(`[sync] Failed to update sync flags for ${mid}: ${e.message}`);
          }
        }

        // AI同期成功した管理番号は shiire-kanri の listing-text KV を invalidate する。
        // これをやらないと、SPA 詳細画面の「タイトルコピー」が AIキーワード書込み前にウォーム
        // された 24h KV を 1日掴み続け、外注に AIキーワードを含まない短いタイトルが渡る。
        // （事例: zG1740 が 29文字のままになっていた件 — 2026-05-20 修正）
        if (aiAllOk && aiSentIds.size > 0 && env.SHIIRE_KANRI_URL) {
          try {
            const resp = await fetch(
              env.SHIIRE_KANRI_URL.replace(/\/$/, '') + '/admin/invalidate-listing-text',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Sync-Secret': env.SHIIRE_SYNC_SECRET || env.SYNC_SECRET || '',
                },
                body: JSON.stringify({ kanriIds: [...aiSentIds] }),
              }
            );
            const txt = await resp.text();
            console.log(`[sync] listing-text invalidate: ${resp.status} ${txt.substring(0, 120)}`);
          } catch (e) {
            console.error(`[sync] listing-text invalidate failed: ${e.message}`);
          }
        }

        // pending からは「今回 batch 枠を消費した全件」を取り除く。
        // - 既に aiSynced だった entries も含む（残し続けるとバッチ枠を奪い続けるため）
        // - photo-meta 消失 orphan も同時に除去
        // - GAS 個別失敗分は photo-meta.synced/aiSynced が false のまま残るので、
        //   次Cronの autoMatchPhotography で再 pending 入りする（再試行ループ成立）
        const processedIds = new Set([...entries.map(e => e.managedId), ...orphanIds]);
        const remaining = pending.filter(id => !processedIds.has(id));
        if (remaining.length > 0) {
          await env.CACHE.put('photo-meta:pending', JSON.stringify(remaining));
        } else {
          await env.CACHE.delete('photo-meta:pending');
        }
        console.log(`[sync] Photography synced: photo=${photoWritten}/${photographyData.length}, ai=${aiWritten}/${aiData.length}, remaining_pending=${remaining.length}`);
      } else {
        console.error('[sync] Photography sync failed:', result.message);
      }
    } catch (e) {
      console.error('[sync] Photography sync parse error:', e.message, 'text:', text.substring(0, 200));
    }
  } catch (e) {
    console.error('[sync] Photography sync error:', e.message);
  }
}

// shiire-kanri D1 (products.extra_json) に 撮影日付/撮影者 を直接書込み。
// GAS への apiSyncImportData が成功した直後に呼ぶ。
// shiire-kanri 5分 Cron での再同期では同値で content_hash が変わらないため再UPSERTは発生しない。
// D1 課金ガード: 既に同値なら UPDATE をスキップする（feedback_d1_cost_safeguard）。
async function syncPhotoToShiireKanri(env, photographyData) {
  if (!env.SHIIRE_DB || !Array.isArray(photographyData) || photographyData.length === 0) return;
  let updated = 0;
  let skipped = 0;
  for (const item of photographyData) {
    const kanri = String(item.managedId || '').trim();
    if (!kanri) continue;
    try {
      const cur = await env.SHIIRE_DB
        .prepare('SELECT extra_json FROM products WHERE kanri = ?')
        .bind(kanri)
        .first();
      if (!cur) continue; // shiire-kanri 側にまだ行が無い（次の Cron で UPSERT される）
      let extra = {};
      try { extra = JSON.parse(cur.extra_json || '{}') || {}; } catch (_) { extra = {}; }
      const newDate = item.photographyDate || '';
      const newBy = item.photographer || '';
      if ((extra['撮影日付'] || '') === newDate && (extra['撮影者'] || '') === newBy) {
        skipped++;
        continue;
      }
      extra['撮影日付'] = newDate;
      extra['撮影者'] = newBy;
      await env.SHIIRE_DB
        .prepare('UPDATE products SET extra_json = ?, updated_at = ? WHERE kanri = ?')
        .bind(JSON.stringify(extra), Date.now(), kanri)
        .run();
      updated++;
    } catch (err) {
      console.warn(`[sync] shiire-kanri D1 photo update failed (${kanri}): ${err.message}`);
    }
  }
  console.log(`[sync] shiire-kanri D1 photo sync: updated=${updated}, skipped=${skipped}, total=${photographyData.length}`);
}

// ─── D1 UPSERT ───

async function syncProducts(db, rows) {
  // GASから来たリストに無い商品をD1から削除（売却済み等）
  // 安全策: GAS側エラーで空データが来た場合の全削除を防止
  const incomingIds = new Set(rows.map(p => p.managedId));
  const { results: existing } = await db.prepare('SELECT managed_id FROM products').all();

  // 受信データが既存の20%未満の場合は異常とみなしスキップ（GAS側エラー防御）
  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] Skipping product delete: incoming=${rows.length} vs existing=${existing.length} (threshold 20%)`);
  } else {
    const toDelete = existing.filter(r => !incomingIds.has(r.managed_id)).map(r => r.managed_id);
    if (toDelete.length > 0) {
      const delBatchSize = 50;
      for (let i = 0; i < toDelete.length; i += delBatchSize) {
        const batch = toDelete.slice(i, i + delBatchSize);
        const placeholders = batch.map(() => '?').join(',');
        await db.prepare(`DELETE FROM products WHERE managed_id IN (${placeholders})`).bind(...batch).run();
      }
      console.log(`[sync] Deleted ${toDelete.length} stale products from D1`);
    }
  }

  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT OR REPLACE INTO products
          (managed_id, no_label, image_url, state, brand, size, gender, category,
           color, price, qty, defect_detail, shipping_method,
           measure_length, measure_shoulder, measure_bust, measure_sleeve,
           measure_yuki, measure_total_length, measure_waist, measure_rise,
           measure_inseam, measure_thigh, measure_hem_width, measure_hip,
           updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        p.managedId, p.noLabel || '', p.imageUrl || '', p.state || '',
        p.brand || '', p.size || '', p.gender || '', p.category || '',
        p.color || '', p.price || 0, p.qty || 0,
        p.defectDetail || '', p.shippingMethod || '',
        p.measureLength ?? null, p.measureShoulder ?? null,
        p.measureBust ?? null, p.measureSleeve ?? null,
        p.measureYuki ?? null, p.measureTotalLength ?? null,
        p.measureWaist ?? null, p.measureRise ?? null,
        p.measureInseam ?? null, p.measureThigh ?? null,
        p.measureHemWidth ?? null, p.measureHip ?? null,
        new Date().toISOString()
      )
    );
    await db.batch(stmts);
  }
}

export async function syncBulkProducts(db, rows) {
  const stmts = rows.map(p =>
    db.prepare(`
      INSERT OR REPLACE INTO bulk_products
        (product_id, name, description, price, unit, tag, images,
         min_qty, max_qty, sort_order, stock, sold_out,
         discount_rate, discounted_price, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      p.productId, p.name || '', p.description || '', p.price || 0,
      p.unit || '', p.tag || '', JSON.stringify(p.images || []),
      p.minQty || 1, p.maxQty || 99, p.sortOrder || 999,
      p.stock ?? -1, p.soldOut ? 1 : 0,
      p.discountRate || 0, p.discountedPrice || 0,
      p.soldOut ? 0 : 1, new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncCustomers(db, rows) {
  // Sheets → D1 方向: ポイント・購入回数などSheetsが信頼元のフィールドのみ更新
  const stmts = rows.map(c =>
    db.prepare(`
      INSERT INTO customers
        (id, email, password_hash, company_name, phone, postal, address,
         newsletter, created_at, last_login, points, points_updated_at,
         purchase_count, total_spent, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (email) DO UPDATE SET
        company_name = excluded.company_name,
        phone = excluded.phone,
        postal = excluded.postal,
        address = excluded.address,
        password_hash = excluded.password_hash,
        newsletter = excluded.newsletter,
        points = CASE WHEN excluded.points != customers.points THEN excluded.points ELSE customers.points END,
        points_updated_at = CASE WHEN excluded.points != customers.points THEN excluded.points_updated_at ELSE customers.points_updated_at END,
        purchase_count = excluded.purchase_count,
        total_spent = excluded.total_spent,
        updated_at = excluded.updated_at
    `).bind(
      c.id, c.email, c.passwordHash || '', c.companyName || '',
      c.phone || '', c.postal || '', c.address || '',
      c.newsletter ? 1 : 0, c.createdAt || new Date().toISOString(),
      c.lastLogin || '', c.points || 0,
      c.pointsUpdatedAt || '', c.purchaseCount || 0,
      c.annualSpent || 0,
      new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncOpenItems(db, rows) {
  // GASから来たIDセット + pending_payment中のholdsのIDを保護
  const gasIds = new Set(rows.map(o => o.managedId));

  // pending_payment=1 の商品はsubmitEstimateで追加したopen_items → 削除しない
  const { results: pendingHolds } = await db.prepare(
    'SELECT managed_id FROM holds WHERE pending_payment = 1'
  ).all();
  const pendingIds = new Set(pendingHolds.map(h => h.managed_id));

  // GASにもpendingにも含まれないopen_itemsのみ削除
  const { results: existing } = await db.prepare('SELECT managed_id FROM open_items').all();
  const toDelete = existing.filter(e => !gasIds.has(e.managed_id) && !pendingIds.has(e.managed_id));

  // GASにもpendingにも含まれないopen_itemsを削除（バッチ分割）
  if (toDelete.length > 0) {
    const DEL_BATCH = 50;
    for (let i = 0; i < toDelete.length; i += DEL_BATCH) {
      const chunk = toDelete.slice(i, i + DEL_BATCH).map(e => e.managed_id);
      const placeholders = chunk.map(() => '?').join(',');
      await db.prepare(`DELETE FROM open_items WHERE managed_id IN (${placeholders})`).bind(...chunk).run();
    }
  }

  // GASからのデータをUPSERT（1件ずつ実行）
  const now = new Date().toISOString();
  for (const o of rows) {
    await db.prepare(`
      INSERT INTO open_items (managed_id, receipt_no, status, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (managed_id) DO UPDATE SET
        receipt_no = excluded.receipt_no,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(o.managedId, o.receiptNo || '', o.status || '依頼中', now).run();
  }
}

async function syncOrders(db, rows) {
  const now = new Date().toISOString();
  const stmts = rows.map(o =>
    db.prepare(`
      INSERT OR REPLACE INTO orders
        (receipt_no, email, order_date, products, item_count,
         total_amount, shipping_cost, status, carrier, tracking, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      o.receiptNo, (o.email || '').toLowerCase(), o.orderDate || '',
      o.products || '', o.itemCount || 0,
      o.totalAmount || 0, o.shippingCost || 0,
      o.status || '', o.carrier || '', o.tracking || '', now
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncCoupons(db, rows) {
  const stmts = rows.map(c =>
    db.prepare(`
      INSERT OR REPLACE INTO coupons
        (code, type, value, expires_at, max_uses, use_count, once_per_user,
         active, memo, target, start_date, combo_member, combo_bulk, channel,
         target_products, shipping_exclude_products, free_shipping,
         target_customer_name, target_customer_email, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      c.code, c.type, c.value || 0, c.expiresAt || null,
      c.maxUses || 0, c.useCount || 0, c.oncePerUser ? 1 : 0,
      c.active ? 1 : 0, c.memo || '', c.target || 'all',
      c.startDate || null, c.comboMember ? 1 : 0, c.comboBulk ? 1 : 0,
      c.channel || 'all', c.targetProducts || '',
      c.shippingExcludeProducts || '', c.freeShipping ? 1 : 0,
      c.targetCustomerName || '',
      c.targetCustomerEmail || '', new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncSettings(db, settings) {
  const now = new Date().toISOString();
  const stmts = Object.entries(settings).map(([key, value]) =>
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).bind(key, typeof value === 'string' ? value : JSON.stringify(value), now)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

async function syncStats(db, stats) {
  await db.prepare(`
    INSERT OR REPLACE INTO stats_cache (key, data, updated_at)
    VALUES ('banner', ?, ?)
  `).bind(JSON.stringify(stats), new Date().toISOString()).run();
}

// ─── メタデータ・キャッシュ ───

async function getLastSyncTime(db) {
  const row = await db.prepare(
    "SELECT last_sync_at FROM sync_meta WHERE source = 'export' ORDER BY last_sync_at DESC LIMIT 1"
  ).first();
  return row ? row.last_sync_at : '2000-01-01T00:00:00Z';
}

async function getLastImportTime(db) {
  const row = await db.prepare(
    "SELECT last_sync_at FROM sync_meta WHERE source = 'import_customers'"
  ).first();
  return row ? row.last_sync_at : '2000-01-01T00:00:00Z';
}

async function updateSyncMeta(db, exportData) {
  const now = new Date().toISOString();
  const totalRows = (exportData.products?.length || 0) +
    (exportData.customers?.length || 0) +
    (exportData.coupons?.length || 0);

  await db.prepare(`
    INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
    VALUES ('export', ?, ?, '')
  `).bind(now, totalRows).run();
}

// ─── AI判定失敗カウンタ ───

/**
 * AI判定が失敗した managedId のカウンタを ai-failed:{managedId} に保存。
 * 3回連続失敗で syncPhotographyData / autoMatchPhotography 双方からスキップ対象になる。
 * TTL 7日: 失敗原因が一時的（Geminiレート制限等）の場合は1週間後に再試行可能。
 */
async function incrementAiFailure(env, managedId, reason) {
  try {
    const existing = await env.CACHE.get(`ai-failed:${managedId}`);
    const f = existing ? JSON.parse(existing) : { attempts: 0 };
    f.attempts = (f.attempts || 0) + 1;
    f.lastError = String(reason || '').substring(0, 200);
    f.lastAt = new Date().toISOString();
    await env.CACHE.put(`ai-failed:${managedId}`, JSON.stringify(f), { expirationTtl: 7 * 24 * 3600 });
    if (f.attempts >= 3) {
      console.warn(`[sync] AI判定 永続失敗マーク: ${managedId} (attempts=${f.attempts}, lastError=${f.lastError})`);
    }
  } catch (e) {
    console.error(`[sync] incrementAiFailure error for ${managedId}: ${e.message}`);
  }
}

// ─── 撮影先行登録の自動マッチング ───

/**
 * 商品管理に新規登録された商品と、先行アップロードされた画像を自動マッチング。
 * マッチしたら photo-meta:pending に追加 → 既存の syncPhotographyData() でGASに送信。
 */
async function autoMatchPhotography(env) {
  try {
    // managed-ids:list（商品管理に登録済みの管理番号）
    // 未登録でも AI判定は走らせる（AppSheet LOOKUP プリフィル用に AI画像判定シートへ先行書き込み）
    // 商品管理シートへの撮影者/日付書き込みは syncPhotographyData 側で registered のみに限定
    const idsJson = await env.CACHE.get('managed-ids:list');
    const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

    // product-images:index（画像がアップロード済みの管理番号）
    const indexJson = await env.CACHE.get('product-images:index');
    if (!indexJson) return;
    const imageIndex = JSON.parse(indexJson);

    // 既にpendingに入っているものは除外
    const pendingJson = await env.CACHE.get('photo-meta:pending');
    const pending = pendingJson ? JSON.parse(pendingJson) : [];
    const pendingSet = new Set(pending);

    const newMatches = [];
    for (const managedId of imageIndex) {
      if (pendingSet.has(managedId)) continue;

      // photo-metaまたはai-resultが存在するか確認
      const metaJson = await env.CACHE.get(`photo-meta:${managedId}`);
      const aiJson = await env.CACHE.get(`ai-result:${managedId}`);
      if (!metaJson && !aiJson) continue;

      let meta = null;
      if (metaJson) {
        try { meta = JSON.parse(metaJson); } catch (e) { meta = null; }
        if (meta && meta.uploadedAt) {
          const daysDiff = (Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff > 30) continue;
        }
      }

      // 互換: 旧 meta.synced=true は「AI も写真も書き済み」として扱う
      const aiSynced = meta && (meta.aiSynced === true || meta.synced === true);
      const photoSynced = meta && meta.synced === true;
      const isRegistered = registeredIds.has(managedId);
      let needsAi = !aiSynced;
      const needsPhoto = isRegistered && !photoSynced;

      // AI判定が3回以上失敗している managedId は再 push しない
      // （LIFOバッチ枠の永久占拠を防ぐ — 2026-05-21 修正）
      if (needsAi) {
        const failedJson = await env.CACHE.get(`ai-failed:${managedId}`);
        if (failedJson) {
          try {
            const f = JSON.parse(failedJson);
            if ((f.attempts || 0) >= 3) needsAi = false;
          } catch (_) {}
        }
      }

      if (!needsAi && !needsPhoto) continue;

      // photo-metaがない場合はai-resultだけの再適用（ダミーのphoto-metaを作成）
      if (!metaJson && aiJson) {
        const now = new Date();
        const todayStr = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
        await env.CACHE.put(`photo-meta:${managedId}`, JSON.stringify({
          photographer: '',
          photographyDate: todayStr,
          uploadedAt: now.toISOString(),
        }));
      }

      newMatches.push(managedId);
    }

    if (newMatches.length > 0) {
      const updatedPending = [...pending, ...newMatches];
      await env.CACHE.put('photo-meta:pending', JSON.stringify(updatedPending));
      console.log(`[sync] Auto-matched ${newMatches.length} photography items: ${newMatches.join(', ')}`);
    }
  } catch (e) {
    console.error('[sync] autoMatchPhotography error:', e.message);
  }
}

// ─── photo-meta 復元（GASから一括取得してKVに書き戻す） ───

/**
 * 商品管理シートの撮影メタデータから KVの photo-meta を再構築。
 * 過去にアップされたZY等で photo-meta が消失している商品の表示を復元するため。
 * @returns {object} { ok, restored, skipped, missing, total }
 */
export async function restorePhotoMetaFromGas(env) {
  const indexJson = await env.CACHE.get('product-images:index');
  if (!indexJson) return { ok: false, message: 'product-images:index not found' };
  const imageIndex = JSON.parse(indexJson);

  // 既に synced:true のphoto-metaがある管理番号は除外
  const needRestore = [];
  for (const mid of imageIndex) {
    const metaJson = await env.CACHE.get(`photo-meta:${mid}`);
    if (!metaJson) {
      needRestore.push(mid);
      continue;
    }
    try {
      const meta = JSON.parse(metaJson);
      if (!meta.uploadedAt || !meta.photographer || !meta.photographyDate) {
        needRestore.push(mid);
      }
    } catch (e) {
      needRestore.push(mid);
    }
  }

  if (needRestore.length === 0) {
    return { ok: true, restored: 0, skipped: imageIndex.length, missing: 0, total: imageIndex.length };
  }

  // GASから一括取得
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) return { ok: false, message: 'GAS_API_URL未設定' };

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action: 'apiExportPhotographyMeta',
      args: [{ syncSecret: env.SYNC_SECRET || '', managedIds: needRestore }],
    }),
    redirect: 'follow',
  });

  const text = await resp.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: 'GAS応答パース失敗', raw: text.substring(0, 500) };
  }
  if (!result.ok) return { ok: false, message: result.message || 'GAS error' };

  const items = result.items || [];
  const itemMap = {};
  for (const it of items) itemMap[String(it.managedId).toUpperCase()] = it;

  let restored = 0;
  const missing = [];
  for (const mid of needRestore) {
    const item = itemMap[String(mid).toUpperCase()];
    if (!item) { missing.push(mid); continue; }

    // photographyDate (yyyy/MM/dd) → ISO8601 (JST 00:00:00)
    let uploadedAt = new Date().toISOString();
    if (item.photographyDate) {
      const m = item.photographyDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
      if (m) {
        const iso = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') + 'T00:00:00+09:00';
        const d = new Date(iso);
        if (!isNaN(d.getTime())) uploadedAt = d.toISOString();
      }
    }

    // 既存のphoto-metaがあればuploadedAt等を保持
    const existingJson = await env.CACHE.get(`photo-meta:${mid}`);
    let existing = {};
    if (existingJson) {
      try { existing = JSON.parse(existingJson); } catch (e) {}
    }

    const meta = {
      ...existing,
      photographer: item.photographer || existing.photographer || '',
      photographyDate: item.photographyDate || existing.photographyDate || '',
      uploadedAt: existing.uploadedAt || uploadedAt,
      synced: true,
    };
    await env.CACHE.put(`photo-meta:${mid}`, JSON.stringify(meta));
    restored++;
  }

  return {
    ok: true,
    restored,
    skipped: imageIndex.length - needRestore.length,
    missing: missing.length,
    missingIds: missing.slice(0, 20),
    total: imageIndex.length,
  };
}

// ─── 孤立画像クリーンアップ（30日以上未マッチ） ───

async function cleanupOrphanedImages(env) {
  try {
    const idsJson = await env.CACHE.get('managed-ids:list');
    const registeredIds = idsJson ? new Set(JSON.parse(idsJson)) : new Set();

    const indexJson = await env.CACHE.get('product-images:index');
    if (!indexJson) return;
    const imageIndex = JSON.parse(indexJson);

    let cleaned = 0;
    for (const managedId of imageIndex) {
      if (registeredIds.has(managedId)) continue; // 登録済みは対象外

      const metaJson = await env.CACHE.get(`photo-meta:${managedId}`);
      if (!metaJson) continue;

      const meta = JSON.parse(metaJson);
      if (!meta.uploadedAt) continue;

      const daysDiff = (Date.now() - new Date(meta.uploadedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < 30) continue; // 30日未満はスキップ

      // R2から画像を削除
      const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
      if (urlsJson) {
        const urls = JSON.parse(urlsJson);
        await Promise.all(urls.map(url => {
          const r2Key = url.replace(/^\/images\//, '').split('?')[0];
          return env.IMAGES.delete(r2Key);
        }));
      }

      // KVを削除
      await env.CACHE.delete(`product-images:${managedId}`);
      await env.CACHE.delete(`photo-meta:${managedId}`);
      cleaned++;
      console.log(`[sync] Cleaned up orphaned images for ${managedId} (${daysDiff.toFixed(0)} days old)`);
    }

    // product-images:index を更新
    if (cleaned > 0) {
      const updatedIndex = imageIndex.filter(id => {
        if (registeredIds.has(id)) return true;
        const mj = null; // Already deleted from KV, so just check registered
        return registeredIds.has(id);
      });
      // Re-read to get accurate state
      const freshIndexJson = await env.CACHE.get('product-images:index');
      if (freshIndexJson) {
        const freshIndex = JSON.parse(freshIndexJson);
        const stillExists = [];
        for (const id of freshIndex) {
          const check = await env.CACHE.get(`product-images:${id}`);
          if (check) stillExists.push(id);
        }
        await env.CACHE.put('product-images:index', JSON.stringify(stillExists));
      }
      console.log(`[sync] Cleaned up ${cleaned} orphaned image sets`);
    }
  } catch (e) {
    console.error('[sync] cleanupOrphanedImages error:', e.message);
  }
}

/**
 * ソフトデリート商品の purge。
 * /upload/delete はソフトデリート（deleted-product:{id} KV へ退避）になり、
 * R2画像は即削除しない。保持期間（purgeAt）を過ぎた分だけここで実削除する。
 */
async function purgeSoftDeletedProducts(env) {
  try {
    const list = await env.CACHE.list({ prefix: 'deleted-product:' });
    const now = Date.now();
    let purged = 0;

    for (const entry of list.keys) {
      const json = await env.CACHE.get(entry.name);
      if (!json) continue;
      const trash = JSON.parse(json);

      // 保持期間内は温存（誤削除の復元用）
      if (typeof trash.purgeAt === 'number' && now < trash.purgeAt) continue;

      // R2画像と image-backup を実削除
      for (const url of trash.urls || []) {
        const r2Key = url.replace(/^\/images\//, '').split('?')[0];
        await env.IMAGES.delete(r2Key);
        await env.CACHE.delete(`image-backup:${trash.managedId}:${url}`);
      }
      await env.CACHE.delete(entry.name);
      purged++;
      console.log(`[sync] Purged soft-deleted product ${trash.managedId} (${(trash.urls || []).length} images)`);
    }

    if (purged > 0) {
      console.log(`[sync] Purged ${purged} soft-deleted product(s)`);
    }

    // 個別画像のソフトデリート分（delete-single / 画像上書きの旧版）も purge
    const imgList = await env.CACHE.list({ prefix: 'deleted-image:' });
    let purgedImages = 0;
    for (const entry of imgList.keys) {
      const json = await env.CACHE.get(entry.name);
      if (!json) continue;
      const stash = JSON.parse(json);

      // 保持期間内は温存（誤削除の復元用）
      if (typeof stash.purgeAt === 'number' && now < stash.purgeAt) continue;

      if (stash.url) {
        const r2Key = stash.url.replace(/^\/images\//, '').split('?')[0];
        await env.IMAGES.delete(r2Key);
      }
      await env.CACHE.delete(entry.name);
      purgedImages++;
    }
    if (purgedImages > 0) {
      console.log(`[sync] Purged ${purgedImages} soft-deleted image(s)`);
    }
  } catch (e) {
    console.error('[sync] purgeSoftDeletedProducts error:', e.message);
  }
}

/**
 * KVキャッシュをプリウォーム
 * 同期後にD1から最新データを読み取り、KVに書き込む。
 * ユーザーリクエスト時は常にKV HITになり、初回アクセスも高速。
 */
function buildMeasurementsObj(row) {
  const map = {
    '着丈': row.measure_length, '肩幅': row.measure_shoulder, '身幅': row.measure_bust,
    '袖丈': row.measure_sleeve, '桁丈': row.measure_yuki, '総丈': row.measure_total_length,
    'ウエスト': row.measure_waist, '股上': row.measure_rise, '股下': row.measure_inseam,
    'ワタリ': row.measure_thigh, '裾幅': row.measure_hem_width, 'ヒップ': row.measure_hip,
  };
  const result = {};
  for (const [label, val] of Object.entries(map)) {
    if (val != null) result[label] = val;
  }
  return result;
}

async function prewarmCaches(env) {
  const CACHE_TTL = 600; // 10分（Cronは5分間隔なので余裕を持たせる）

  try {
    // 商品データをプリウォーム
    const { results: products } = await env.DB.prepare(`
      SELECT managed_id, no_label, image_url, state, brand, size,
             gender, category, color, price, qty, defect_detail, shipping_method,
             measure_length, measure_shoulder, measure_bust, measure_sleeve,
             measure_yuki, measure_total_length, measure_waist, measure_rise,
             measure_inseam, measure_thigh, measure_hem_width, measure_hip
      FROM products ORDER BY CAST(no_label AS INTEGER) ASC, no_label ASC
    `).all();

    const items = products.map(row => ({
      managedId: row.managed_id, noLabel: row.no_label, imageUrl: row.image_url,
      state: row.state, brand: row.brand, size: row.size, gender: row.gender,
      category: row.category, color: row.color, price: row.price,
      defectDetail: row.defect_detail, shippingMethod: row.shipping_method,
      measurements: buildMeasurementsObj(row),
      status: '在庫あり', selectable: true,
    }));

    // holds + open_items からステータスを算出
    const now = Date.now();
    const { results: holds } = await env.DB.prepare('SELECT managed_id FROM holds WHERE until_ms > ?').bind(now).all();
    const heldSet = new Set(holds.map(h => h.managed_id));
    const { results: openItems } = await env.DB.prepare('SELECT managed_id FROM open_items').all();
    const openSet = new Set(openItems.map(o => o.managed_id));
    for (const p of items) {
      if (openSet.has(p.managedId)) { p.status = '依頼中'; p.selectable = false; }
      else if (heldSet.has(p.managedId)) { p.status = '確保中'; p.selectable = false; }
    }

    // R2画像をマージ
    const imgIndexJson = await env.CACHE.get('product-images:index');
    if (imgIndexJson) {
      const imgIndex = JSON.parse(imgIndexJson);
      const imgMap = {};
      // 並列でKV取得（最大50件ずつ）
      const batchSize = 50;
      for (let i = 0; i < imgIndex.length; i += batchSize) {
        const batch = imgIndex.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (mid) => {
            const json = await env.CACHE.get(`product-images:${mid}`);
            return { mid, urls: json ? JSON.parse(json) : null };
          })
        );
        for (const { mid, urls } of results) {
          if (urls && urls.length > 0) imgMap[mid.toUpperCase()] = urls;
        }
      }
      const imgPrefix = env.WORKERS_URL || '';
      for (const p of items) {
        const key = p.managedId.toUpperCase();
        if (imgMap[key]) {
          p.images = imgPrefix
            ? imgMap[key].map(u => u.startsWith('/') ? imgPrefix + u : u)
            : imgMap[key];
        }
      }
    }

    // フィルタオプション構築
    const sets = { category: new Set(), state: new Set(), gender: new Set(), size: new Set(), brand: new Set() };
    for (const p of items) {
      if (p.category) sets.category.add(p.category);
      if (p.state) sets.state.add(p.state);
      if (p.gender) sets.gender.add(p.gender);
      if (p.size) sets.size.add(p.size);
      if (p.brand) sets.brand.add(p.brand);
    }
    const sortArr = (s) => [...s].sort((a, b) => a.localeCompare(b, 'ja'));
    const options = {
      status: ['在庫あり', '依頼中', '確保中'],
      category: sortArr(sets.category), state: sortArr(sets.state),
      gender: sortArr(sets.gender), size: sortArr(sets.size),
      brand: sortArr(sets.brand),
      sort: [
        { key: 'default', label: 'No（番号順）' }, { key: 'price', label: '価格' },
        { key: 'brand', label: 'ブランド' }, { key: 'size', label: 'サイズ' },
      ],
    };

    // 設定データ
    const memberRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'MEMBER_DISCOUNT_STATUS'").first();
    let memberDiscount = { enabled: true, rate: 0.10, endDate: '2026-09-30', reason: 'active' };
    if (memberRow) { try { memberDiscount = JSON.parse(memberRow.value); } catch (e) { /* fallthrough */ } }

    const settings = {
      appTitle: 'デタウリ.Detauri', minOrderCount: 5, memberDiscount,
      notes: [
        '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
        '5点から購入可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料は住所入力後に自動計算されます。',
        'カートに入れた商品は15分間確保されます（会員は30分間）。在庫は先着順のためお早めにお手続きください。',
        '決済方法：クレジットカード／コンビニ払い／銀行振込／PayPay／ペイジー／Apple Pay／Paidy',
      ],
    };
    const discountNote = memberDiscount.enabled
      ? '<span style="color:#b8002a;">10点以上で5％割引〜最大20％OFF ／ 会員登録で10％OFF（' + memberDiscount.endDate + 'まで・併用可）</span>'
      : '<span style="color:#b8002a;">30点以上で10％割引</span>';
    settings.notes.push(discountNote);

    // 統計データ
    const statsRow = await env.DB.prepare("SELECT data FROM stats_cache WHERE key = 'banner'").first();
    const stats = statsRow ? JSON.parse(statsRow.data) : null;

    // sheetTotalCount（データ1 B1の掲載中件数）をKVから取得
    const sheetTotalCountStr = await env.CACHE.get('sheetTotalCount');
    const sheetTotalCount = sheetTotalCountStr ? Number(sheetTotalCountStr) : 0;

    // KVに書き込み（GAS互換形式: products キーで保存）
    const productData = { products: items, sheetTotalCount, options, settings, stats };
    await env.CACHE.put('products:detauri', JSON.stringify(productData), { expirationTtl: CACHE_TTL });
    await env.CACHE.put('settings:public', JSON.stringify(settings), { expirationTtl: CACHE_TTL });
    if (stats) await env.CACHE.put('stats:banner', JSON.stringify(stats), { expirationTtl: CACHE_TTL });

    // Bulk商品をプリウォーム
    const { results: bulkRows } = await env.DB.prepare(`
      SELECT product_id, name, description, price, unit, tag, images,
             min_qty, max_qty, sort_order, stock, sold_out, discount_rate, discounted_price
      FROM bulk_products WHERE active = 1 ORDER BY sort_order ASC
    `).all();

    const bulkProducts = bulkRows.map(row => ({
      productId: row.product_id, name: row.name, description: row.description,
      price: row.price, unit: row.unit, tag: row.tag,
      images: JSON.parse(row.images || '[]'), minQty: row.min_qty, maxQty: row.max_qty,
      sortOrder: row.sort_order, stock: row.stock, soldOut: row.sold_out === 1,
      discountRate: row.discount_rate, discountedPrice: row.discounted_price,
    }));

    const shippingRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'SHIPPING_CONFIG'").first();
    const shippingData = shippingRow ? JSON.parse(shippingRow.value) : null;
    const siteUrlRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'SITE_URL'").first();

    const bulkResult = {
      products: bulkProducts,
      settings: {
        appTitle: 'デタウリ.Detauri', channel: 'アソート',
        shippingAreas: shippingData?.areas || null, shippingRates: shippingData?.rates || null,
        memberDiscount, detauriUrl: siteUrlRow?.value || '',
        alwaysChargeShippingIds: ALWAYS_CHARGE_BULK_IDS,
      },
      stats,
    };
    await env.CACHE.put('products:bulk', JSON.stringify(bulkResult), { expirationTtl: CACHE_TTL });

    // バージョンハッシュ生成（クライアント側キャッシュ検証用）
    const encoder = new TextEncoder();
    const productHashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(productData)));
    const productVersion = [...new Uint8Array(productHashBuf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    await env.CACHE.put('products:version', productVersion, { expirationTtl: CACHE_TTL });

    const bulkHashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(bulkResult)));
    const bulkVersion = [...new Uint8Array(bulkHashBuf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    await env.CACHE.put('products:bulk:version', bulkVersion, { expirationTtl: CACHE_TTL });

    console.log(`[sync] KV prewarm complete: ${items.length} products, ${bulkProducts.length} bulk, v=${productVersion}/${bulkVersion}`);
  } catch (e) {
    console.error('[sync] Prewarm error:', e.message);
    // プリウォーム失敗時はキャッシュを削除（次のリクエストでD1から再構築）
    const keys = ['products:detauri', 'products:bulk', 'settings:public', 'stats:banner'];
    for (const key of keys) { await env.CACHE.delete(key); }
  }
}

// ─── バッチAI判定（全画像を順次処理） ───

export async function batchAiJudgment(env, limit) {
  const geminiKey = env.GEMINI_API_KEY || '';
  if (!geminiKey) return { error: 'GEMINI_API_KEY not set' };

  // product-images:index から全managedIdを取得
  const indexJson = await env.CACHE.get('product-images:index');
  if (!indexJson) return { error: 'No product-images:index', processed: 0 };
  const allIds = JSON.parse(indexJson);

  // 処理済みリストはリクエストパラメータで受け取る（KV結果整合性問題を回避）
  const pending = allIds.filter(mid => !env._batchSkipSet || !env._batchSkipSet.has(mid));

  if (pending.length === 0) {
    return { message: '全件処理済み', total: allIds.length, remaining: 0, processed: 0 };
  }

  // limit件ずつ処理
  const batch = pending.slice(0, limit);
  const results = [];
  const errors = [];
  const aiDataForGas = [];

  for (const mid of batch) {
    try {
      const aiResult = await runGeminiJudgment(env, mid, geminiKey);
      if (aiResult) {
        await env.CACHE.put(`ai-result:${mid}`, JSON.stringify(aiResult), { expirationTtl: 30 * 24 * 3600 });
        results.push({ managedId: mid, category2: aiResult.category2, brand: aiResult.brand });
        aiDataForGas.push({ managedId: mid, ...aiResult });
      } else {
        errors.push({ managedId: mid, error: 'Gemini returned null' });
      }
    } catch (e) {
      errors.push({ managedId: mid, error: e.message });
    }
  }

  // GASにまとめて1回で送信（リトライ付き）
  let gasWritten = 0;
  if (aiDataForGas.length > 0) {
    const gasUrl = env.GAS_API_URL;
    if (gasUrl) {
      const body = JSON.stringify({
        action: 'apiSyncImportData',
        args: [{ syncSecret: env.SYNC_SECRET || '', aiData: aiDataForGas }],
      });
      for (let retry = 0; retry < 3; retry++) {
        try {
          const resp = await fetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'follow' });
          const text = await resp.text();
          const result = JSON.parse(text);
          if (result.ok) {
            gasWritten = (result.imported?.aiProduct || 0) + (result.imported?.aiKeywords || 0);
            break;
          }
        } catch (e) {
          if (retry < 2) await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  return {
    total: allIds.length,
    remaining: pending.length - batch.length,
    processed: results.length,
    gasWritten,
    errors: errors.length,
    results,
    errorDetails: errors.length > 0 ? errors : undefined,
  };
}

// ─── 単体再判定（指定 managedId のみ） ───

export async function reprocessSingleAi(env, managedId) {
  const diag = { managedId, steps: [] };
  const geminiKey = env.GEMINI_API_KEY || '';
  if (!geminiKey) {
    diag.steps.push({ step: 'env', ok: false, message: 'GEMINI_API_KEY not set' });
    return diag;
  }

  // 1. KV画像URL確認
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  if (!urlsJson) {
    diag.steps.push({ step: 'check-images-kv', ok: false, message: 'product-images not in KV (タスキ箱→gas-proxy同期失敗 or 統合前のアップロード)' });
    return diag;
  }
  const urls = JSON.parse(urlsJson);
  diag.steps.push({ step: 'check-images-kv', ok: true, count: urls.length });

  // 2. 既存ai-resultキャッシュをクリア
  const existing = await env.CACHE.get(`ai-result:${managedId}`);
  await env.CACHE.delete(`ai-result:${managedId}`);
  diag.steps.push({ step: 'clear-ai-cache', ok: true, hadCache: !!existing });

  // 3. Gemini再判定
  let aiResult;
  try {
    aiResult = await runGeminiJudgment(env, managedId, geminiKey);
  } catch (e) {
    diag.steps.push({ step: 'gemini', ok: false, message: e.message });
    return diag;
  }
  if (!aiResult) {
    diag.steps.push({ step: 'gemini', ok: false, message: 'returned null (R2画像取得失敗 or Gemini空応答)' });
    return diag;
  }
  diag.steps.push({ step: 'gemini', ok: true, brand: aiResult.brand, category1: aiResult.category1, category2: aiResult.category2, category3: aiResult.category3, color: aiResult.color });

  // 4. KVにキャッシュしGAS送信
  await env.CACHE.put(`ai-result:${managedId}`, JSON.stringify(aiResult), { expirationTtl: 30 * 24 * 3600 });

  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    diag.steps.push({ step: 'gas', ok: false, message: 'GAS_API_URL not set' });
    return diag;
  }
  const body = JSON.stringify({
    action: 'apiSyncImportData',
    args: [{ syncSecret: env.SYNC_SECRET || '', aiData: [{ managedId, ...aiResult }] }],
  });
  const resp = await fetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'follow' });
  const text = await resp.text();
  let gasResult;
  try { gasResult = JSON.parse(text); } catch { gasResult = { raw: text.substring(0, 500) }; }
  diag.steps.push({ step: 'gas', ok: gasResult?.ok === true, imported: gasResult?.imported, message: gasResult?.message });

  return diag;
}

// 一括再判定: 渡された managedIds を順次再判定
// 1リクエストの実行時間制限に配慮し、limit 上限を 20 にクランプする
export async function bulkReprocessAi(env, managedIds, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit || 10, 10) || 10, 1), 20);
  const ids = (managedIds || []).map(s => String(s).trim()).filter(Boolean).slice(0, limit);
  const results = [];
  let success = 0;
  for (const mid of ids) {
    try {
      const diag = await reprocessSingleAi(env, mid);
      const ok = Array.isArray(diag.steps) && diag.steps.length > 0 && diag.steps.every(s => s.ok);
      if (ok) success++;
      results.push({ managedId: mid, ok, lastStep: diag.steps[diag.steps.length - 1] || null });
    } catch (e) {
      results.push({ managedId: mid, ok: false, error: e.message });
    }
  }
  return { processed: ids.length, success, failed: ids.length - success, results };
}

// ─── Gemini AI判定 ───

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 画像並び替え判定は視覚分類精度を優先して flash を使用
const ORDERING_MODEL = 'gemini-2.5-flash';
const ORDERING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${ORDERING_MODEL}:generateContent`;

// 怪しいケースだけ高精度化するためのスポット用 Pro モデル
const ORDERING_PRO_MODEL = 'gemini-2.5-pro';
const ORDERING_PRO_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${ORDERING_PRO_MODEL}:generateContent`;

const AI_PRODUCT_PROMPT = `あなたは古着の商品情報を画像から判定する専門家です。以下の画像の古着商品について、JSON形式で情報を返してください。

## 出力ルール
- 画像で確実に確認できる要素のみ出力
- brand・tagLabel・defectDetailは確認できない場合のみnullを出力
- gender・category1〜3・color・pocketは必ず選択肢から1つを選ぶ（null禁止）
- designは特筆すべき特徴がない／自信がない場合「画像で確認してください。」を出力
- ブランド名はタグが明確に読める場合のみ出力
- 必ず以下のJSON形式のみ出力（説明文や前置きは禁止）

## 「その他」選択ルール（重要）
- 「その他」は**最終手段**です。選択肢のいずれにも明らかに該当しない場合のみ使用してください
- 迷ったら、画像から読み取れる特徴に最も近い選択肢を選んでください
- 特にカテゴリ3は必ず細分化された選択肢から最も近いものを選ぶこと

## カテゴリ1の選択肢（※性別と同じ値を必ず入力。服の種類ではなく性別区分です）
レディース, メンズ, キッズ
※ カテゴリ1には「トップス」「パンツ」等の服の種類を絶対に入れないでください。服の種類はカテゴリ2です。

## カテゴリ2の選択肢
トップス, ジャケット・アウター, パンツ, スカート, ワンピース, スーツ・フォーマル, スーツセットアップ, ジャージセットアップ, ドレス・ブライダル, サロペット・オーバーオール, ルームウェア・パジャマ, マタニティ, キッズ, スーツ, 靴下・レッグウェア, 帽子, バッグ, アクセサリー, その他

## カテゴリ3の選択肢（カテゴリ2に対応・メルカリ出品カテゴリ準拠）
トップス: Tシャツ/カットソー(半袖/袖なし), Tシャツ/カットソー(七分/長袖), シャツ/ブラウス(半袖/袖なし), シャツ/ブラウス(七分/長袖), ポロシャツ, キャミソール, タンクトップ, ホルターネック, ニット/セーター, チュニック, カーディガン/ボレロ, アンサンブル, ベスト/ジレ, パーカー, トレーナー/スウェット, ベアトップ/チューブトップ, ジャージ, その他
ジャケット・アウター: テーラードジャケット, ノーカラージャケット, Gジャン/デニムジャケット, レザージャケット, ダウンジャケット, ライダースジャケット, ミリタリージャケット, ナイロンジャケット, ブルゾン, ポンチョ, ロングコート, トレンチコート, ダッフルコート, ピーコート, チェスターコート, モッズコート, スタジャン, MA-1, スカジャン, 毛皮/ファーコート, スプリングコート, その他
パンツ: デニム/ジーンズ, ショートパンツ, カジュアルパンツ, ハーフパンツ, チノパン, ワークパンツ/カーゴパンツ, クロップドパンツ, サルエルパンツ, オールインワン, サロペット/オーバーオール, レギンス/スパッツ, ガウチョパンツ, テーパードパンツ, ワイドパンツ, スウェットパンツ, スラックス, その他
スカート: ミニスカート, ひざ丈スカート, ロングスカート, マキシスカート, キュロット, フレアスカート, タイトスカート, Aラインスカート, プリーツスカート, その他
ワンピース: ミニワンピース, ひざ丈ワンピース, ロングワンピース, シャツワンピース, その他
スーツ・フォーマル: スカートスーツ上下セット, パンツスーツ上下セット, スカート, パンツ, ジャケット, その他
スーツセットアップ: ジャケット&パンツ, ジャケット&スカート, ベスト&パンツ, ベスト&スカート, その他
ジャージセットアップ: 上下セット, パーカー&パンツ, ジップアップ&パンツ, その他
ドレス・ブライダル: ウェディングドレス, パーティードレス, カクテルドレス, ロングドレス, ミニドレス, その他
サロペット・オーバーオール: サロペット, オーバーオール, ロンパース, つなぎ, その他
ルームウェア・パジャマ: パジャマ, ルームウェア, ナイトウェア, ガウン/バスローブ, その他
マタニティ: マタニティトップス, マタニティパンツ, マタニティワンピース, マタニティアウター, マタニティスカート, その他
キッズ: ベビー服(60-80cm), トドラー(80-95cm), キッズ(100-150cm), ジュニア(160cm-), その他
スーツ: シングルスーツ, ダブルスーツ, ストライプスーツ, セットアップ, その他
靴下・レッグウェア: 靴下, タイツ/ストッキング, レギンス, レッグウォーマー, その他
帽子: キャップ, ハット, ニット帽/ビーニー, ベレー帽, ハンチング/キャスケット, サンバイザー, 麦わら帽子, その他
バッグ: ハンドバッグ, ショルダーバッグ, トートバッグ, クラッチバッグ, リュック/バックパック, ボストンバッグ, ボディバッグ, ウエストバッグ, エコバッグ, ポーチ, その他
アクセサリー: ネックレス, ピアス, イヤリング, ブレスレット, バングル, リング, アンクレット, ヘアアクセサリー, ブローチ, その他
その他: その他

## 性別の選択肢
レディース, メンズ, キッズ

## カラーの選択肢
ブラック系, ホワイト系, グレー系, ブラウン系, ベージュ系, グリーン系, ブルー系, パープル系, イエロー系, ピンク系, レッド系, オレンジ系, ネイビー系, その他

## ポケットの選択肢
あり, なし

## JSON出力形式
{
  "brand": "ブランド名またはnull",
  "tagLabel": "タグに表記されているサイズ（数字やアルファベットそのまま）またはnull",
  "gender": "性別（必ず選択肢から1つ選ぶ。null禁止）",
  "category1": "カテゴリ1（必ず選択肢から1つ選ぶ。null禁止）",
  "category2": "カテゴリ2（必ず選択肢から1つ選ぶ。該当なしなら『その他』）",
  "category3": "カテゴリ3（必ず選択肢から1つ選ぶ。該当なしなら『その他』）",
  "design": "デザイン特徴を客観的に1〜2個だけ簡潔に記述する。①柄系（ボーダー、チェック柄、ストライプ、ドット、花柄、迷彩、無地、装飾プリント、刺繍、ロゴプリント、グラフィック等）②装飾系（フリル、レース、リボン、パール、スパンコール、ビーズ、フェイクファー、メタリック、ファスナー装飾等）から該当が画像に明確に映っている場合のみ採用。【厳格ルール】(a) 自信がない／柄も装飾も判別できない場合は必ず『画像で確認してください。』のみを出力（推測禁止）。(b) フリル・レースは襟元・袖口・裾・前立て等に大きく明確な装飾が確認できる場合のみ出力可。襟元のリブ編み・軽いギャザー・シフォンの透け感・編み目模様・シャーリング・通常の縫製ステッチを『フリル』『レース』と誤判定してはならない。(c) よく分からないからとりあえず『フリルレース』『装飾プリント』等の定型語を出力するのは禁止。画像に映っていない特徴は絶対に出力しない。(d) タグや無地のシャツ・パンツ・デニムなど装飾が明らかに無いアイテムは『画像で確認してください。』を出力する。",
  "color": "カラー（必ず選択肢から1つ選ぶ。該当なしなら『その他』）",
  "pocket": "ポケット（あり または なし を必ず出力。null禁止）",
  "defectDetail": "傷汚れ詳細。明確な汚れ・穴・破れ・シミのみ記載。自然な使用感や軽いシワ、通常の着用感、色褪せ程度の使用感は記載しない。該当なしはnull",
  "keywords": "メルカリ検索用キーワード 半角スペース区切り 3〜8語。【絶対禁止】(1) ブランド名（例: ユニクロ、GU、無印） (2) 色名（例: 黒、ネイビー、ブラック、ホワイト系。漢字/カタカナ/英字すべて） (3) サイズ（例: M、L、XL、フリー） (4) 素材（例: コットン、ポリエステル、ウール、デニム） (5) カテゴリ語をそのまま再掲（例: アイテムが『ワンピース』なら『ワンピース』を入れない）。【重複禁止】語同士で部分一致・包含関係になるものは出力しない（例: 『ロゴ』と『ロゴ刺繍』は同居禁止、長い具体語のみ採用）。同義語の重複も禁止（例: 『花柄』と『フローラル』）。【優先方針】抽象語より具体語を優先し（『デザイン』より『前結び』『シースルー』）、検索流入につながるシルエット・着丈・ディテール・テイスト語を選ぶ。"
}`;

async function runGeminiJudgment(env, managedId, apiKey) {
  // KVから画像URL取得
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  if (!urlsJson) return null;

  const urls = JSON.parse(urlsJson);
  if (!urls || urls.length === 0) return null;

  // 全画像をR2から取得してBase64変換
  const imageParts = [];
  for (const imgUrl of urls) {
    const r2Key = imgUrl.replace(/^\/images\//, '').split('?')[0];
    let r2Obj = await env.IMAGES.get(r2Key);
    // タスキ箱のR2からも探す（teams/で始まるパス）
    if (!r2Obj && env.TASUKIBAKO_IMAGES) {
      r2Obj = await env.TASUKIBAKO_IMAGES.get(r2Key);
    }
    if (!r2Obj) continue;

    const arrayBuffer = await r2Obj.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const mimeType = r2Obj.httpMetadata?.contentType || 'image/jpeg';
    imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  if (imageParts.length === 0) {
    console.log(`[ai] No images found in R2 for ${managedId}`);
    return null;
  }

  // Gemini API呼び出し（全画像を送信）
  const payload = {
    contents: [{
      parts: [
        { text: AI_PRODUCT_PROMPT + `\n\n※ ${imageParts.length}枚の画像すべてを確認して判定してください。タグ写真があればブランド・サイズ情報を優先的に読み取ってください。` },
        ...imageParts,
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };

  try { await incrementGeminiUsage(env, GEMINI_MODEL); } catch (e) { console.warn('[ai] incrementGeminiUsage failed:', e.message); }
  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    console.log(`[ai] Empty response from Gemini for ${managedId}`);
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    // null・"null"・"N/A"・"なし"・"不明" を空文字に変換（pocketの"なし"は有効値として保持）
    for (const key of Object.keys(parsed)) {
      if (parsed[key] === null || parsed[key] === undefined) {
        parsed[key] = '';
      } else if (typeof parsed[key] === 'string') {
        const v = parsed[key].trim().toLowerCase();
        if (v === 'null' || v === 'n/a' || v === '不明' || v === 'undefined') {
          parsed[key] = '';
        } else if (v === 'なし' && key !== 'pocket') {
          parsed[key] = '';
        }
      }
    }
    // category1は性別と同じ値（レディース/メンズ/キッズ）であるべき
    // Geminiがカテゴリ2の値を誤ってcategory1に入れた場合、genderからコピー
    const validCat1 = ['レディース', 'メンズ', 'キッズ'];
    if (parsed.category1 && !validCat1.includes(parsed.category1)) {
      console.log(`[ai] category1 fix: "${parsed.category1}" → "${parsed.gender}" for ${managedId}`);
      parsed.category1 = parsed.gender || '';
    }
    console.log(`[ai] Judgment OK for ${managedId}: cat1=${parsed.category1}, cat2=${parsed.category2}, brand=${parsed.brand}`);
    return parsed;
  } catch (e) {
    console.error(`[ai] JSON parse failed for ${managedId}:`, text.substring(0, 200));
    return null;
  }
}

// ─── 画像並び替え（AIラベル付け） ───
//
// 各画像を以下8カテゴリのいずれかに分類し、優先順位ソートで並び替える。
//   front_full : 前から全身（平置き or トルソー）
//   back_full  : 後ろから全身（平置き or トルソー）
//   worn       : 人間が着用している着画
//   angle_full        : 正面・背面以外の角度から商品全体を撮影（斜め・サイド・トルソーを斜めから等）
//   detail            : 部分アップ・ディテール
//   tag               : タグ
//   defect            : 傷・汚れ・破れ拡大
//   processed_right   : 白背景加工＋右上ロゴ（先頭）
//   processed_left    : 白背景加工＋左上ロゴ（末尾）
//   other             : それ以外（半身しか写らない／複数アイテム混在／構図不明確）
const ORDER_PRIORITY = ['processed_right', 'front_full', 'back_full', 'angle_full', 'worn', 'detail', 'tag', 'defect', 'other', 'processed_left'];

const AI_ORDERING_PROMPT = `あなたは古着の商品画像を並び替えるための分類アシスタントです。
画像配列の各画像について、まず観察した内容を reason に短く書いてから、最後に1つのカテゴリ label を付けてください。reason を書かずに即答することは禁止です。

## カテゴリ（必ず以下から1つだけ選ぶ）
- front_full : 商品の前面（正面）全体。人間は写っておらず、平置き／ハンガー／トルソーで真正面から撮影。トップス・ワンピならボディ前面、パンツなら脚の前面
- back_full  : 商品の背面全体。人間は写っておらず、真後ろから撮影
- angle_full : 正面でも背面でもない角度から「商品全体」が写っている画像。斜め45度／サイドビュー／真横／斜め上から見下ろし／トルソー or ハンガーを斜めから撮影、など。商品の輪郭ほぼ全体が画面に収まっていれば angle_full
- worn       : 人間（モデル）が実際に着用している着画。顔・手・脚・髪などの肌や身体パーツが画像内に見える
- detail     : 部分アップ。袖口・襟・素材アップ・装飾・ボタン・刺繍・プリント柄の拡大など、商品の一部分にフォーカス（商品全体は写っていない）
- tag        : 内側タグ・洗濯表示・ブランドネーム・サイズ表記など、文字情報主体の拡大写真
- defect          : 傷・汚れ・穴・シミ・ほつれ・色褪せなど、ダメージ箇所の拡大写真
- processed_right : 真っ白に背景処理された商品＋ブランドロゴ（店名テキスト）が「画像の右上」に重ねて合成された加工済み画像（先頭表示用のヒーロー画像）
- processed_left  : 真っ白に背景処理された商品＋ブランドロゴ（店名テキスト）が「画像の左上」に重ねて合成された加工済み画像（末尾表示用）
- other           : 上記いずれにも明確に該当しない曖昧な画像（複数アイテム混在／半身しか写っていない／構図が極端で全体も部分も判別不能 など）

## 判定の具体例
- 床に広げたトップスを真上から撮った写真 → front_full（または back_full）
- ハンガーに掛けて壁の正面から撮った写真 → front_full / back_full
- ハンガーに掛けて斜め45度から撮った写真（商品全体が写っている） → angle_full
- トルソーに着せて斜め前から商品全体を撮った写真 → angle_full
- 床に広げて斜め上から商品全体を撮った写真 → angle_full
- 商品を真横から撮ってシルエットが分かる写真 → angle_full
- モデルが着ていて顔は写っていないが手や髪が見える → worn
- 値札やサイズタグだけのアップ（文字情報メイン） → tag
- 袖の刺繍やボタンの拡大（ダメージなし） → detail
- 穴・シミ・色褪せの拡大 → defect
- 真っ白い背景に切り抜かれた商品＋"BRAND"等のロゴテキストが画像の「右上」に合成 → processed_right
- 真っ白い背景に切り抜かれた商品＋"BRAND"等のロゴテキストが画像の「左上」に合成 → processed_left
- 同じ商品の正面が複数枚 → 全て front_full（重複していてもOK）
- ロゴがどちらの上端にあるか曖昧（中央／下／判別不能）→ processed_left（より無難な末尾扱い）にする
- 「全体が写っているか部分アップか」迷ったら、商品の輪郭の大部分（だいたい7割以上）が画面に収まっていれば angle_full、収まっていなければ detail

## 前面・背面の見分け方（特にキャミ・ストラップ系ワンピ／袖なし／ベアトップ／ベアトップスなど袖の無い衣類）
袖が無い衣類はトルソーで撮ると前後が紛らわしい。以下の手がかりで判定する：
- **front_full の手がかり**：襟ぐりに明確な装飾的形状（V字／ハート型／スクエア／レース／フリル／リボン／ボタン列／ファスナー（前ジップ）／プリント柄／胸ダーツ）が見える
- **back_full の手がかり**：背中側のファスナー（後ジップ）／ボタン列の中心線／ホック／タグの飛び出し／クロス紐／ホールカット／背中ダーツ／首後ろの肌色っぽいすっきりした輪郭が見える
- **両方とも判定が難しい（前か後か断定できない）** → angle_full に倒す（中位置に並ぶので front/back 誤同定より傷が浅い）
- 角度が真正面でなく、肩や脇のシルエットが斜めに見える → angle_full
- 同一商品を「真正面・斜め前・真後ろ・斜め後ろ」と4枚撮影されているケースが多い：撮影者は通常「前→斜め前→後ろ→斜め後ろ」または「前→後ろ→斜め前→斜め後ろ」の順で並べる傾向あり

### 前後判定の具体例
- トルソーにキャミワンピを着せ、胸元にV字ネックの切り替えがはっきり見える → front_full
- 同じワンピをトルソーで撮り、背中ファスナーが縦に見える → back_full
- 同じワンピをトルソーで斜めから撮り、肩ストラップが斜めに重なって見える → angle_full
- ストラップが両肩から胸元に向けて自然に下りていて、襟ぐりの形状（V字／スクエア等）が見える → front_full
- ストラップが背中側でクロスしている／首の後ろが見えていて、襟ぐり形状が見えない → back_full

## 撮影順のヒント
画像は upload 順で並んでいます。経験上、最初の 2〜3 枚（index 0, 1, 2）は撮影者が「商品の代表写真」として front_full / back_full を撮る蓋然性が高いです。最終手前は worn、最後付近は processed_left（左上ロゴの末尾画像）の傾向があります。processed_right（右上ロゴ）は商品アップロードの最初のほうに置かれることもあります。ただしこれはヒントであり、画像内容を最優先してください。

## 入力
画像が index 0 から順に渡されます。

## 出力（JSONのみ・説明文や前置き禁止）
{
  "items": [
    { "index": 0, "reason": "白背景に切り抜かれ右上にBRANDロゴ合成", "label": "processed_right", "confidence": "high" },
    { "index": 1, "reason": "床に広げたトップスを真上から、人間なし", "label": "front_full", "confidence": "high" },
    { "index": 2, "reason": "ストラップ系で襟ぐり装飾も背中ファスナーも判別不能", "label": "angle_full", "confidence": "low" }
  ]
}

## 出力ルール（必ず守る）
- items の長さは入力画像の枚数と完全に一致させること
- index は 0 から順に通し番号で書くこと
- reason は label の前に置き、画像の特徴を15〜40字程度で簡潔に書くこと
- label は上記カテゴリのいずれかの英字キーをそのまま小文字で出力すること
- confidence は high / medium / low のいずれかを必ず付ける
  - **high**: 上記カテゴリ定義・具体例にそのまま当てはまり、迷う余地がない
  - **medium**: ある程度該当するが、細部で別のカテゴリの可能性も僅かに残る
  - **low**: front/back の判別困難、全体/部分の境界、複数解釈ありうる、画像が暗い・ピンボケ・写り込み等で読みにくい、など。後で人間の確認や上位モデルの再判定が望ましいケース`;

async function runOrderingJudgment(env, managedId, apiKey, opts = {}) {
  const usePro = !!opts.usePro;
  const endpoint = usePro ? ORDERING_PRO_ENDPOINT : ORDERING_ENDPOINT;
  const urlsJson = await env.CACHE.get(`product-images:${managedId}`);
  if (!urlsJson) return { error: 'no-kv' };
  const urls = JSON.parse(urlsJson);
  if (!urls || urls.length === 0) return { error: 'empty-urls' };

  const imageParts = [];
  const validUrls = [];
  for (const imgUrl of urls) {
    const r2Key = imgUrl.replace(/^\/images\//, '').split('?')[0];
    let r2Obj = await env.IMAGES.get(r2Key);
    if (!r2Obj && env.TASUKIBAKO_IMAGES) {
      r2Obj = await env.TASUKIBAKO_IMAGES.get(r2Key);
    }
    if (!r2Obj) continue;
    const arrayBuffer = await r2Obj.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const mimeType = r2Obj.httpMetadata?.contentType || 'image/jpeg';
    imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    validUrls.push(imgUrl);
  }
  if (imageParts.length === 0) return { error: 'no-r2-images' };

  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: usePro ? 8192 : 4096,
    responseMimeType: 'application/json',
  };
  if (!usePro) {
    // Flash: thinking が出力枠を食いつぶさないよう抑制（reason で CoT 等価）
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  // Pro はデフォルトで dynamic thinking が動くので明示設定なし

  const payload = {
    contents: [{
      parts: [
        { text: AI_ORDERING_PROMPT + `\n\n※ 入力画像は ${imageParts.length} 枚です。items は必ず ${imageParts.length} 件で index 0..${imageParts.length - 1} を全て埋めてください。` },
        ...imageParts,
      ],
    }],
    generationConfig,
  };

  try { await incrementGeminiUsage(env, usePro ? ORDERING_PRO_MODEL : ORDERING_MODEL); } catch (e) { console.warn('[ordering] incrementGeminiUsage failed:', e.message); }
  const resp = await fetch(`${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { error: `gemini-${resp.status}`, detail: t.substring(0, 200) };
  }
  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) return { error: 'empty-response' };

  let parsed;
  try { parsed = JSON.parse(text); } catch { return { error: 'json-parse-failed', raw: text.substring(0, 200) }; }

  // 新形式: { items: [{ index, reason, label, confidence }] }、旧形式 { labels: [...] } も後方互換で受け付ける
  let labels = [];
  let reasons = [];
  let confidences = [];
  const allowedConf = ['high', 'medium', 'low'];
  if (Array.isArray(parsed.items)) {
    const sorted = parsed.items.slice().sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    labels = sorted.map(it => String(it.label || '').trim().toLowerCase());
    reasons = sorted.map(it => String(it.reason || '').trim());
    confidences = sorted.map(it => {
      const c = String(it.confidence || '').trim().toLowerCase();
      return allowedConf.includes(c) ? c : '';
    });
  } else if (Array.isArray(parsed.labels)) {
    labels = parsed.labels.map(s => String(s || '').trim().toLowerCase());
    reasons = labels.map(() => '');
    confidences = labels.map(() => '');
  }
  if (labels.length !== validUrls.length) {
    return { error: 'label-length-mismatch', expected: validUrls.length, got: labels.length, labels, reasons, confidences };
  }
  // 不正ラベルは other に寄せる
  const normalized = labels.map(l => ORDER_PRIORITY.includes(l) ? l : 'other');
  return { urls: validUrls, labels: normalized, reasons, confidences, model: usePro ? ORDERING_PRO_MODEL : ORDERING_MODEL };
}

function applyOrderingRule(urls, labels) {
  const indexed = urls.map((u, i) => ({ url: u, label: labels[i] || 'other', orig: i }));
  // 正面画像（front_full / processed_right）が一切無い場合、
  // 最初の processed_left を先頭に格上げする（back_full しかない or タグだけ等で正面代表が無い状況を回避）
  const hasFrontLike = indexed.some(it => it.label === 'front_full' || it.label === 'processed_right');
  let promotedOrig = -1;
  if (!hasFrontLike) {
    const firstLeft = indexed.find(it => it.label === 'processed_left');
    if (firstLeft) promotedOrig = firstLeft.orig;
  }
  indexed.sort((a, b) => {
    if (a.orig === promotedOrig && b.orig !== promotedOrig) return -1;
    if (b.orig === promotedOrig && a.orig !== promotedOrig) return 1;
    const pa = ORDER_PRIORITY.indexOf(a.label);
    const pb = ORDER_PRIORITY.indexOf(b.label);
    if (pa !== pb) return pa - pb;
    return a.orig - b.orig;
  });
  return indexed.map(x => x.url);
}

// 最近アップロードされた managedId を limit 件取得。
// 2系統の R2 を両方スキャンし、uploaded 時刻が最も新しいものを優先：
//   env.IMAGES (detauri-images)         : products/{managedId}/{uuid}.jpg     ← gas-proxy /upload
//   env.TASUKIBAKO_IMAGES (tasukibako-) : teams/{teamId}/products/{mid}/...   ← 独立 Worker tasukibako
async function getRecentTasukibakoIds(env, limit = 50) {
  const seen = new Map(); // managedId -> latest uploaded Date

  async function scan(bucket, prefix, regex) {
    if (!bucket) return 0;
    let cursor = undefined;
    let scanned = 0;
    for (let page = 0; page < 4; page++) {
      const listed = await bucket.list({ prefix, limit: 1000, cursor });
      for (const obj of listed.objects || []) {
        scanned++;
        const m = obj.key.match(regex);
        if (!m) continue;
        const mid = m[1];
        const u = obj.uploaded ? new Date(obj.uploaded) : null;
        if (!u) continue;
        const cur = seen.get(mid);
        if (!cur || u > cur) seen.set(mid, u);
      }
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
    return scanned;
  }

  const a = await scan(env.IMAGES, 'products/', /^products\/([^/]+)\//);
  const b = await scan(env.TASUKIBAKO_IMAGES, 'teams/', /^teams\/[^/]+\/products\/([^/]+)\//);

  const arr = Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([mid, t]) => ({ managedId: mid, uploadedAt: t.toISOString() }));
  console.log(`[reorder] getRecentTasukibakoIds: scannedIMAGES=${a}, scannedTASUKIBAKO=${b}, unique=${seen.size}, returning=${arr.length}`);
  return arr;
}

export async function runReorderDryrun(env, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit || 50, 10) || 50, 1), 200);
  const apiKey = env.GEMINI_API_KEY || '';
  if (!apiKey) return { error: 'GEMINI_API_KEY not set' };

  // モード判定:
  //  - managedIds: 明示指定（最大200件、cursor無効）
  //  - cursor: product-images:index 全件をオフセット指定でバッチ処理（推奨）
  //  - 上記なし: getRecentTasukibakoIds で R2 最新N件
  const cursor = Math.max(0, parseInt(options.cursor, 10) || 0);
  const batchSize = Math.min(Math.max(parseInt(options.batchSize, 10) || 10, 1), 20);
  const useIndex = !options.managedIds && (options.cursor !== undefined || options.useAll);

  let target; // [{ managedId, uploadedAt }]
  let total = 0;
  let nextCursor = null;
  let mode = 'recent';

  if (Array.isArray(options.managedIds) && options.managedIds.length > 0) {
    target = options.managedIds
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 200)
      .map(managedId => ({ managedId, uploadedAt: '' }));
    total = target.length;
    mode = 'managedIds';
  } else if (useIndex) {
    const indexJson = await env.CACHE.get('product-images:index');
    const allIds = indexJson ? JSON.parse(indexJson) : [];
    total = allIds.length;
    const slice = allIds.slice(cursor, cursor + batchSize);
    target = slice.map(managedId => ({ managedId, uploadedAt: '' }));
    nextCursor = (cursor + slice.length < total) ? (cursor + slice.length) : null;
    mode = 'index';
  } else {
    target = await getRecentTasukibakoIds(env, limit);
    total = target.length;
    mode = 'recent';
  }
  if (target.length === 0) {
    return { error: 'no target products', mode, total, processed: 0, cursor, nextCursor: null, done: true };
  }

  const usePro = !!options.usePro;
  const rows = [];
  let success = 0;
  let failed = 0;
  for (const { managedId, uploadedAt } of target) {
    try {
      const j = await runOrderingJudgment(env, managedId, apiKey, { usePro });
      if (j.error) {
        rows.push({ managedId, uploadedAt, error: j.error, detail: j.detail || '' });
        failed++;
        continue;
      }
      const newOrder = applyOrderingRule(j.urls, j.labels);
      const changed = newOrder.some((u, i) => u !== j.urls[i]);
      // 怪しさサマリ: low が1件以上ある or other ラベルあり
      const hasLow = (j.confidences || []).some(c => c === 'low');
      const hasOther = j.labels.includes('other');
      rows.push({
        managedId,
        uploadedAt,
        count: j.urls.length,
        changed,
        before: j.urls,
        after: newOrder,
        labels: j.labels,
        reasons: j.reasons || [],
        confidences: j.confidences || [],
        ambiguous: hasLow || hasOther,
        model: j.model || (usePro ? ORDERING_PRO_MODEL : ORDERING_MODEL),
      });
      success++;
    } catch (e) {
      rows.push({ managedId, uploadedAt, error: 'exception', detail: e.message });
      failed++;
    }
  }

  // GASに送信して「画像並び替えドライラン」シートに書き出し
  // mode='index' かつ cursor>0 のときは追記モード（前バッチの結果を保つ）
  const append = (mode === 'index' && cursor > 0);
  let gasResult = null;
  const gasUrl = env.GAS_API_URL;
  if (gasUrl) {
    const body = JSON.stringify({
      action: 'apiWriteReorderDryrun',
      args: [{ syncSecret: env.SYNC_SECRET || '', rows, append }],
    });
    try {
      const resp = await fetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'follow' });
      const txt = await resp.text();
      try { gasResult = JSON.parse(txt); } catch { gasResult = { raw: txt.substring(0, 500) }; }
    } catch (e) {
      gasResult = { error: e.message };
    }
  }

  return {
    mode,
    cursor,
    nextCursor,
    done: nextCursor === null,
    total,
    processed: target.length,
    success,
    failed,
    changedCount: rows.filter(r => r.changed).length,
    ambiguousCount: rows.filter(r => r.ambiguous).length,
    model: usePro ? ORDERING_PRO_MODEL : ORDERING_MODEL,
    gasResult,
    sample: rows.slice(0, 3),
  };
}

/**
 * runRejudgeAmbiguous — 直近のドライランシートから ambiguous な行だけ抜き出して
 * Gemini 2.5 Pro で再判定し、シートを上書き更新する。
 * 全件再判定ではなくスポット用途。1100件中 ambiguous ~10% 想定で ~¥500 前後。
 */
export async function runRejudgeAmbiguous(env, options = {}) {
  const apiKey = env.GEMINI_API_KEY || '';
  if (!apiKey) return { error: 'GEMINI_API_KEY not set' };
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) return { error: 'GAS_API_URL not set' };

  let managedIds = [];
  if (Array.isArray(options.managedIds) && options.managedIds.length > 0) {
    // 明示指定（人間が「これとこれだけ Pro で再判定」を指示するケース）
    managedIds = options.managedIds.map(s => String(s || '').trim()).filter(Boolean).slice(0, 200);
  } else {
    // シートから ambiguous=true の行を取得
    const readBody = JSON.stringify({
      action: 'apiReadReorderDryrun',
      args: [{ syncSecret: env.SYNC_SECRET || '' }],
    });
    const readResp = await fetch(gasUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: readBody, redirect: 'follow',
    });
    const readText = await readResp.text();
    let readJson;
    try { readJson = JSON.parse(readText); } catch { return { error: 'failed to parse GAS response', raw: readText.substring(0, 500) }; }
    if (!readJson.ok) return { error: 'GAS read failed', message: readJson.message };
    const sheetRows = Array.isArray(readJson.rows) ? readJson.rows : [];
    managedIds = sheetRows.filter(r => r && r.ambiguous && r.managedId).map(r => String(r.managedId));
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 200);
    managedIds = managedIds.slice(0, limit);
  }
  if (managedIds.length === 0) {
    return { error: 'no ambiguous targets', processed: 0 };
  }

  const rows = [];
  let success = 0;
  let failed = 0;
  for (const managedId of managedIds) {
    try {
      const j = await runOrderingJudgment(env, managedId, apiKey, { usePro: true });
      if (j.error) {
        rows.push({ managedId, uploadedAt: '', error: j.error, detail: j.detail || '' });
        failed++;
        continue;
      }
      const newOrder = applyOrderingRule(j.urls, j.labels);
      const changed = newOrder.some((u, i) => u !== j.urls[i]);
      const hasLow = (j.confidences || []).some(c => c === 'low');
      const hasOther = j.labels.includes('other');
      rows.push({
        managedId,
        uploadedAt: '',
        count: j.urls.length,
        changed,
        before: j.urls,
        after: newOrder,
        labels: j.labels,
        reasons: j.reasons || [],
        confidences: j.confidences || [],
        ambiguous: hasLow || hasOther,
        model: ORDERING_PRO_MODEL,
      });
      success++;
    } catch (e) {
      rows.push({ managedId, uploadedAt: '', error: 'exception', detail: e.message });
      failed++;
    }
  }

  // 既存シートを部分更新（managedId 一致行を上書き）
  const body = JSON.stringify({
    action: 'apiWriteReorderDryrun',
    args: [{ syncSecret: env.SYNC_SECRET || '', rows, append: true, upsert: true }],
  });
  let gasResult = null;
  try {
    const resp = await fetch(gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'follow' });
    const txt = await resp.text();
    try { gasResult = JSON.parse(txt); } catch { gasResult = { raw: txt.substring(0, 500) }; }
  } catch (e) {
    gasResult = { error: e.message };
  }

  return {
    model: ORDERING_PRO_MODEL,
    processed: managedIds.length,
    success,
    failed,
    changedCount: rows.filter(r => r.changed).length,
    stillAmbiguousCount: rows.filter(r => r.ambiguous).length,
    gasResult,
    sample: rows.slice(0, 3),
  };
}

/**
 * runReorderManual — 人間が AI ラベルを上書きして KV に反映する一回限りの修正用
 * labels[] は現在の KV 順に対応する。ORDER_PRIORITY に従ってソートし、product-images:${mid} を上書き。
 */
export async function runReorderManual(env, managedId, labels) {
  if (!managedId) return { error: 'managedId required' };
  if (!Array.isArray(labels) || labels.length === 0) return { error: 'labels[] required' };
  const curJson = await env.CACHE.get(`product-images:${managedId}`);
  if (!curJson) return { error: 'no-kv', managedId };
  const cur = JSON.parse(curJson);
  if (cur.length !== labels.length) {
    return { error: 'length-mismatch', curCount: cur.length, labelCount: labels.length };
  }
  const normalized = labels.map(l => {
    const k = String(l || '').trim().toLowerCase();
    return ORDER_PRIORITY.includes(k) ? k : 'other';
  });
  const after = applyOrderingRule(cur, normalized);
  const alreadySame = cur.length === after.length && cur.every((u, i) => u === after[i]);
  if (alreadySame) {
    return { managedId, ok: true, noop: true, before: cur, after, labels: normalized };
  }
  await env.CACHE.put(`product-images:${managedId}`, JSON.stringify(after));
  try { await env.CACHE.delete('product-list-cache'); } catch (e) { /* ignore */ }
  return { managedId, ok: true, applied: true, before: cur, after, labels: normalized };
}

/**
 * runReorderApply — ドライランシートで承認された並び替えを KV に反映
 *
 * GAS apiReadReorderDryrun でシートを読み戻し、changed=○ の商品について
 * KV product-images:${managedId} を after の URL 配列で上書きする。
 * 元の URL 集合と一致しない場合は安全のためスキップ（ドライラン後に追加・削除があった場合の事故防止）。
 */
export async function runReorderApply(env, options = {}) {
  const dryRun = !!options.dryRun;
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 0;
  const onlyIds = Array.isArray(options.managedIds) && options.managedIds.length
    ? new Set(options.managedIds.map(String))
    : null;
  const excludeIds = Array.isArray(options.excludeIds) && options.excludeIds.length
    ? new Set(options.excludeIds.map(String))
    : null;
  const gasUrl = env.GAS_API_URL;

  // entries が直接渡された場合は GAS シート読み出しをスキップ（JSONL バックアップからの復旧用）
  let sheetRows;
  if (Array.isArray(options.entries) && options.entries.length) {
    sheetRows = options.entries
      .filter(e => e && e.managedId && Array.isArray(e.after) && e.after.length > 0)
      .map(e => ({
        managedId: String(e.managedId),
        after: e.after,
        before: Array.isArray(e.before) ? e.before : null,
        changed: e.changed !== false,
      }));
  } else {
    if (!gasUrl) return { error: 'GAS_API_URL not set' };
    const readBody = JSON.stringify({
      action: 'apiReadReorderDryrun',
      args: [{ syncSecret: env.SYNC_SECRET || '' }],
    });
    const readResp = await fetch(gasUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: readBody, redirect: 'follow',
    });
    const readText = await readResp.text();
    let readJson;
    try { readJson = JSON.parse(readText); } catch { return { error: 'failed to parse GAS response', raw: readText.substring(0, 500) }; }
    if (!readJson.ok) return { error: 'GAS read failed', message: readJson.message };
    sheetRows = Array.isArray(readJson.rows) ? readJson.rows : [];
  }

  let targets = sheetRows.filter(r => r.changed && Array.isArray(r.after) && r.after.length > 0);
  if (onlyIds) targets = targets.filter(r => onlyIds.has(String(r.managedId)));
  if (excludeIds) targets = targets.filter(r => !excludeIds.has(String(r.managedId)));
  if (limit > 0) targets = targets.slice(0, limit);

  // 2. 各 KV を更新
  const results = [];
  let updated = 0;
  let skipped = 0;
  let mismatched = 0;
  for (const row of targets) {
    const mid = row.managedId;
    const newOrder = row.after;
    try {
      const curJson = await env.CACHE.get(`product-images:${mid}`);
      if (!curJson) {
        results.push({ managedId: mid, ok: false, reason: 'no-kv' });
        skipped++;
        continue;
      }
      const cur = JSON.parse(curJson);
      // URL 集合が一致するか確認（ドライラン後に追加・削除されていたら適用しない）
      const curSet = new Set(cur);
      const newSet = new Set(newOrder);
      const sameSize = curSet.size === newSet.size;
      let allMatch = sameSize;
      if (allMatch) {
        for (const u of newSet) if (!curSet.has(u)) { allMatch = false; break; }
      }
      if (!allMatch) {
        results.push({ managedId: mid, ok: false, reason: 'set-mismatch', curCount: cur.length, newCount: newOrder.length });
        mismatched++;
        continue;
      }
      // 既に同じ順序なら何もしない
      const alreadySame = cur.length === newOrder.length && cur.every((u, i) => u === newOrder[i]);
      if (alreadySame) {
        results.push({ managedId: mid, ok: true, noop: true });
        skipped++;
        continue;
      }
      if (!dryRun) {
        await env.CACHE.put(`product-images:${mid}`, JSON.stringify(newOrder));
      }
      results.push({ managedId: mid, ok: true, applied: !dryRun });
      updated++;
    } catch (e) {
      results.push({ managedId: mid, ok: false, reason: 'exception', detail: e.message });
      skipped++;
    }
  }

  // /upload 一覧キャッシュを無効化しないと並び替えが見た目に反映されない（5分TTL の product-list-cache）
  if (!dryRun && updated > 0) {
    try { await env.CACHE.delete('product-list-cache'); } catch (e) { /* ignore */ }
  }

  return {
    dryRun,
    sheetRows: sheetRows.length,
    targets: targets.length,
    updated,
    skipped,
    mismatched,
    limit: limit || null,
    filteredByIds: onlyIds ? onlyIds.size : null,
    excludedIds: excludeIds ? excludeIds.size : null,
    results,
  };
}
