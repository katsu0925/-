// GAS onEdit/onChange トリガーから呼ばれる行単位 UPSERT/削除エンドポイント
// 5分 Cron を待たず、シート編集を即時 D1 反映するための高速パス
//
// 制約:
//  - 認証は X-Sync-Secret ヘッダ（Cloudflare Access バイパス、/admin/sync と同一方式）
//  - body 形式:
//    A) UPSERT: { type: 'product' | 'purchase', items: [...] }
//       items の構造は staff_syncDumpProducts/Purchases と完全互換
//    B) 削除 diff: { type: 'product_diff', kanris: [全管理番号セット] }
//                 { type: 'purchase_diff', shiireIds: [全仕入れIDセット] }
//       Worker は incoming セットに居ない既存D1行のみを DELETE する。
//       誤削除防止のため受信件数が既存の 20% 未満ならスキップ（5分Cronと同一閾値）。

import { jsonOk, jsonError } from '../utils/response.js';

export async function syncRowWebhook(request, env) {
  const secret = request.headers.get('X-Sync-Secret') || '';
  if (!secret || secret !== env.SYNC_SECRET) return jsonError('unauthorized', 403);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError('invalid json', 400);
  }

  const type = String(body && body.type || '').toLowerCase();
  const items = Array.isArray(body && body.items) ? body.items : [];

  try {
    if (type === 'product') {
      if (!items.length) return jsonOk({ upserted: 0, type });
      const n = await upsertProducts(env.DB, items);
      return jsonOk({ upserted: n, type });
    }
    if (type === 'purchase') {
      if (!items.length) return jsonOk({ upserted: 0, type });
      const n = await upsertPurchases(env.DB, items);
      return jsonOk({ upserted: n, type });
    }
    if (type === 'product_diff') {
      const kanris = Array.isArray(body && body.kanris)
        ? body.kanris.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const n = await diffDeleteProducts(env.DB, kanris);
      return jsonOk({ deleted: n, type });
    }
    if (type === 'purchase_diff') {
      const ids = Array.isArray(body && body.shiireIds)
        ? body.shiireIds.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const n = await diffDeletePurchases(env.DB, ids);
      return jsonOk({ deleted: n, type });
    }
    return jsonError('unknown type: ' + type, 400);
  } catch (err) {
    console.error('[sync-webhook] error', err && err.message);
    return jsonError('upsert failed: ' + (err && err.message || 'unknown'), 500);
  }
}

// 注意: content_hash は触らない（次の Cron が hash 比較で再書込みを防ぐためのキー）
// INSERT OR REPLACE だと content_hash が NULL になり、Cron の hash 比較が無効化される。
// 代わりに ON CONFLICT DO UPDATE で raw 列のみ更新し、content_hash の値を保持する。
async function upsertProducts(db, rows) {
  const now = Date.now();
  const batchSize = 50;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT INTO products
          (kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kanri) DO UPDATE SET
          shiire_id      = excluded.shiire_id,
          worker         = excluded.worker,
          status         = excluded.status,
          state          = excluded.state,
          brand          = excluded.brand,
          size           = excluded.size,
          color          = excluded.color,
          measure_json   = excluded.measure_json,
          measured_at    = excluded.measured_at,
          measured_by    = excluded.measured_by,
          sale_date      = excluded.sale_date,
          sale_place     = excluded.sale_place,
          sale_price     = excluded.sale_price,
          sale_shipping  = excluded.sale_shipping,
          sale_fee       = excluded.sale_fee,
          sale_ts        = excluded.sale_ts,
          extra_json     = excluded.extra_json,
          row_num        = excluded.row_num,
          updated_at     = excluded.updated_at
      `).bind(
        String(p.kanri || ''),
        s(p.shiireId), s(p.worker), s(p.status), s(p.state),
        s(p.brand), s(p.size), s(p.color),
        p.measure ? JSON.stringify(p.measure) : null,
        s(p.measuredAt), s(p.measuredBy),
        s(p.saleDate), s(p.salePlace),
        n(p.salePrice), n(p.saleShipping), n(p.saleFee),
        s(p.saleTs),
        p.extra ? JSON.stringify(p.extra) : null,
        Number(p.row || 0),
        now,
      )
    );
    await db.batch(stmts);
    count += batch.length;
  }
  return count;
}

async function upsertPurchases(db, rows) {
  const now = Date.now();
  const batchSize = 50;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT INTO purchases
          (shiire_id, date, amount, shipping, planned, place, cost, category,
           content, supplier_id, register_user, registered_at, assigned_kanri, processed,
           row_num, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shiire_id) DO UPDATE SET
          date           = excluded.date,
          amount         = excluded.amount,
          shipping       = excluded.shipping,
          planned        = excluded.planned,
          place          = excluded.place,
          cost           = excluded.cost,
          category       = excluded.category,
          content        = excluded.content,
          supplier_id    = excluded.supplier_id,
          register_user  = excluded.register_user,
          registered_at  = excluded.registered_at,
          assigned_kanri = excluded.assigned_kanri,
          processed      = excluded.processed,
          row_num        = excluded.row_num,
          updated_at     = excluded.updated_at
      `).bind(
        String(p.shiireId || ''),
        s(p.date),
        n(p.amount), n(p.shipping), n(p.planned),
        s(p.place),
        n(p.cost),
        s(p.category),
        s(p.content),
        s(p.supplierId),
        s(p.registerUser),
        s(p.registeredAt),
        s(p.assignedKanri),
        p.processed ? 1 : 0,
        Number(p.row || 0),
        now,
      )
    );
    await db.batch(stmts);
    count += batch.length;
  }
  return count;
}

function s(v) { return v == null ? null : String(v); }
function n(v) {
  if (v == null || v === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

// ─── 削除 diff ────────────────────────────────────────────────────
// onChange:REMOVE_ROW から呼ばれ、シート全件のIDセットを受け取って
// D1 にだけ存在する古い行を削除する。
//
// 安全弁:
//  - incoming が空配列なら何もしない（誤シート空化の連鎖回避）
//  - incoming 件数が既存の 20% 未満ならスキップ（sheets-sync.js と同一閾値）
async function diffDeleteProducts(db, incomingKanris) {
  if (!incomingKanris.length) return 0;
  const incoming = new Set(incomingKanris);
  const { results: existing } = await db
    .prepare('SELECT kanri FROM products')
    .all();
  if (existing.length > 0 && incoming.size < existing.length * 0.2) {
    console.warn(`[diff] skip product delete: incoming=${incoming.size} vs existing=${existing.length}`);
    return 0;
  }
  let stale = existing
    .filter(r => !incoming.has(String(r.kanri || '')))
    .map(r => r.kanri);
  if (!stale.length) return 0;
  // #3 楽観 INSERT 保護: 直近 180 秒以内に updated_at が更新された行は、書込側(write-proxy)が
  // D1 へ先行 INSERT したばかりで GAS→シート反映前の可能性がある。この diff スナップショットは
  // 反映前のシートから採取されている恐れがあるため、新規行を「stale」と誤判定し消す競合が起きる。
  // 3 分経ってもシートに居なければ削除する（sheets-sync.js syncProducts と同一閾値）。
  stale = await excludeRecent(db, 'products', 'kanri', stale);
  if (!stale.length) return 0;
  const batchSize = 50;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const ph = batch.map(() => '?').join(',');
    await db.prepare(`DELETE FROM products WHERE kanri IN (${ph})`).bind(...batch).run();
  }
  console.log(`[diff] deleted ${stale.length} stale products`);
  return stale.length;
}

async function diffDeletePurchases(db, incomingIds) {
  if (!incomingIds.length) return 0;
  const incoming = new Set(incomingIds);
  const { results: existing } = await db
    .prepare('SELECT shiire_id FROM purchases')
    .all();
  if (existing.length > 0 && incoming.size < existing.length * 0.2) {
    console.warn(`[diff] skip purchase delete: incoming=${incoming.size} vs existing=${existing.length}`);
    return 0;
  }
  let stale = existing
    .filter(r => !incoming.has(String(r.shiire_id || '')))
    .map(r => r.shiire_id);
  if (!stale.length) return 0;
  // #3 楽観 INSERT 保護（diffDeleteProducts と同一趣旨）
  stale = await excludeRecent(db, 'purchases', 'shiire_id', stale);
  if (!stale.length) return 0;
  const batchSize = 50;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const ph = batch.map(() => '?').join(',');
    await db.prepare(`DELETE FROM purchases WHERE shiire_id IN (${ph})`).bind(...batch).run();
  }
  console.log(`[diff] deleted ${stale.length} stale purchases`);
  return stale.length;
}

// 直近 180 秒以内に updated_at が更新された行(=楽観 INSERT 直後でシート未反映の可能性)を
// 削除候補から除外する。keyCol は PK 列名（products: kanri / purchases: shiire_id）。
async function excludeRecent(db, table, keyCol, keys) {
  if (!keys.length) return keys;
  const threshold = Date.now() - 180 * 1000;
  const protectedSet = new Set();
  const probeBatch = 50;
  for (let i = 0; i < keys.length; i += probeBatch) {
    const batch = keys.slice(i, i + probeBatch);
    const ph = batch.map(() => '?').join(',');
    const { results: recent } = await db
      .prepare(`SELECT ${keyCol} AS k FROM ${table} WHERE updated_at > ?1 AND ${keyCol} IN (${ph})`)
      .bind(threshold, ...batch)
      .all();
    for (const r of recent) protectedSet.add(r.k);
  }
  if (protectedSet.size) {
    console.log(`[diff] protect ${protectedSet.size} recent ${table} rows from delete`);
    return keys.filter(k => !protectedSet.has(k));
  }
  return keys;
}
