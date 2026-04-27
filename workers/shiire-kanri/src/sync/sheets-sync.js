// Cron Trigger（5分ごと）: GAS shiire-kanri Web App から商品/仕入れデータを取得し D1 に UPSERT

export async function scheduledSync(env) {
  const startedAt = Date.now();
  console.log('[sync] start');

  try {
    const products = await fetchAction(env, 'syncDumpProducts');
    if (products && products.ok && Array.isArray(products.items)) {
      await syncProducts(env.DB, products.items);
      await writeMeta(env.DB, 'products', products.items.length);
      console.log(`[sync] products=${products.items.length}`);
    } else {
      console.warn('[sync] products fetch failed', products && products.error);
    }
  } catch (err) {
    console.error('[sync] products error', err && err.message);
  }

  try {
    const purchases = await fetchAction(env, 'syncDumpPurchases');
    if (purchases && purchases.ok && Array.isArray(purchases.items)) {
      await syncPurchases(env.DB, purchases.items);
      await writeMeta(env.DB, 'purchases', purchases.items.length);
      console.log(`[sync] purchases=${purchases.items.length}`);
    } else {
      console.warn('[sync] purchases fetch failed', purchases && purchases.error);
    }
  } catch (err) {
    console.error('[sync] purchases error', err && err.message);
  }

  try {
    const aiPrefill = await fetchAction(env, 'syncDumpAiPrefill');
    if (aiPrefill && aiPrefill.ok && Array.isArray(aiPrefill.items)) {
      await syncAiPrefill(env.DB, aiPrefill.items);
      await writeMeta(env.DB, 'ai_prefill', aiPrefill.items.length);
      console.log(`[sync] ai_prefill=${aiPrefill.items.length}`);
    } else {
      console.warn('[sync] ai_prefill fetch failed', aiPrefill && aiPrefill.error);
    }
  } catch (err) {
    console.error('[sync] ai_prefill error', err && err.message);
  }

  console.log(`[sync] done ${Date.now() - startedAt}ms`);
}

async function fetchAction(env, action, payload) {
  const body = JSON.stringify({ action, secret: env.SYNC_SECRET, payload: payload || null });
  const res = await postFollowingRedirects(env.GAS_API_URL, body);
  if (!res.ok) throw new Error(`gas ${action} http ${res.status}`);
  return res.json();
}

// GAS Web App の POST フロー: POST /exec → 302 (script.googleusercontent.com/macros/echo?user_content_key=...) → GET でレスポンス取得
// fetch の redirect:'follow' は標準では POST→GET 変換されるが、Cloudflare Workers では Location を保持しないケースがあるため手動で追従する
async function postFollowingRedirects(url, body) {
  const first = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });
  if (first.status < 300 || first.status >= 400) return first;
  let loc = first.headers.get('location');
  for (let hop = 0; hop < 5; hop++) {
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    const next = await fetch(loc, { method: 'GET', redirect: 'manual' });
    if (next.status < 300 || next.status >= 400) return next;
    loc = next.headers.get('location');
  }
  throw new Error('too many redirects');
}

async function syncProducts(db, rows) {
  // 安全策: 受信が極端に少ない場合は削除をスキップ（GAS側エラー想定）
  const incoming = new Set(rows.map(r => String(r.kanri || '')).filter(Boolean));
  const { results: existing } = await db.prepare('SELECT kanri FROM products').all();
  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip product delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.kanri)).map(r => r.kanri);
    const delBatch = 50;
    for (let i = 0; i < stale.length; i += delBatch) {
      const batch = stale.slice(i, i + delBatch);
      const ph = batch.map(() => '?').join(',');
      await db.prepare(`DELETE FROM products WHERE kanri IN (${ph})`).bind(...batch).run();
    }
    if (stale.length) console.log(`[sync] deleted ${stale.length} stale products`);
  }

  const now = Date.now();
  const batchSize = 50;
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
  }
}

async function syncPurchases(db, rows) {
  const incoming = new Set(rows.map(r => String(r.shiireId || '')).filter(Boolean));
  const { results: existing } = await db.prepare('SELECT shiire_id FROM purchases').all();
  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip purchase delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.shiire_id)).map(r => r.shiire_id);
    const delBatch = 50;
    for (let i = 0; i < stale.length; i += delBatch) {
      const batch = stale.slice(i, i + delBatch);
      const ph = batch.map(() => '?').join(',');
      await db.prepare(`DELETE FROM purchases WHERE shiire_id IN (${ph})`).bind(...batch).run();
    }
    if (stale.length) console.log(`[sync] deleted ${stale.length} stale purchases`);
  }

  const now = Date.now();
  const batchSize = 50;
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
  }
}

async function syncAiPrefill(db, rows) {
  // 安全策: 受信が極端に少ない場合は削除をスキップ
  const incoming = new Set(rows.map(r => String(r.kanri || '')).filter(Boolean));
  const { results: existing } = await db.prepare('SELECT kanri FROM ai_prefill').all();
  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip ai_prefill delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.kanri)).map(r => r.kanri);
    const delBatch = 50;
    for (let i = 0; i < stale.length; i += delBatch) {
      const batch = stale.slice(i, i + delBatch);
      const ph = batch.map(() => '?').join(',');
      await db.prepare(`DELETE FROM ai_prefill WHERE kanri IN (${ph})`).bind(...batch).run();
    }
    if (stale.length) console.log(`[sync] deleted ${stale.length} stale ai_prefill`);
  }

  const now = Date.now();
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT OR REPLACE INTO ai_prefill (kanri, fields_json, row_num, updated_at)
        VALUES (?, ?, ?, ?)
      `).bind(
        String(p.kanri || ''),
        p.fields ? JSON.stringify(p.fields) : '{}',
        Number(p.row || 0),
        now,
      )
    );
    await db.batch(stmts);
  }
}

async function writeMeta(db, source, count) {
  await db.prepare(`
    INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count)
    VALUES (?, ?, ?)
  `).bind(source, Date.now(), count).run();
}

function s(v) { return v == null ? null : String(v); }
function n(v) {
  if (v == null || v === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}
