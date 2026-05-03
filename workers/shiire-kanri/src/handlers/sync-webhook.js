// GAS onEdit/onChange トリガーから呼ばれる行単位 UPSERT エンドポイント
// 5分 Cron を待たず、シート編集を即時 D1 反映するための高速パス
//
// 制約:
//  - 削除は行わない（同一プロジェクト内の script-driven 削除はトリガー発火しないため、
//    削除整合性は 5分 Cron に委ねる）
//  - 認証は X-Sync-Secret ヘッダ（Cloudflare Access バイパス、/admin/sync と同一方式）
//  - body: { type: 'product' | 'purchase', items: [...] }
//    items の構造は staff_syncDumpProducts/Purchases と完全互換

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
  if (!items.length) return jsonOk({ upserted: 0 });

  try {
    if (type === 'product') {
      const n = await upsertProducts(env.DB, items);
      return jsonOk({ upserted: n, type });
    }
    if (type === 'purchase') {
      const n = await upsertPurchases(env.DB, items);
      return jsonOk({ upserted: n, type });
    }
    return jsonError('unknown type: ' + type, 400);
  } catch (err) {
    console.error('[sync-webhook] error', err && err.message);
    return jsonError('upsert failed: ' + (err && err.message || 'unknown'), 500);
  }
}

async function upsertProducts(db, rows) {
  const now = Date.now();
  const batchSize = 50;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT OR REPLACE INTO products
          (kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        INSERT OR REPLACE INTO purchases
          (shiire_id, date, amount, shipping, planned, place, cost, category,
           content, supplier_id, register_user, registered_at, assigned_kanri, processed,
           row_num, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
