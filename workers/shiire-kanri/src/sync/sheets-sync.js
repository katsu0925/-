// Cron Trigger（5分ごと）: GAS shiire-kanri Web App から商品/仕入れデータを取得し D1 に UPSERT
//
// ⚠️ D1 課金事故防止（重要）
// ────────────────────────────────────────────────────────────
// 5分 Cron × 5000+行 × INSERT OR REPLACE は月 100M writes 規模になり、
// 過去 detauri-gas-proxy で $54/月 の課金事故が発生している。
// このため本ファイルでは 2 段ガードを必須とする:
//
//   1. payload 全体の SHA-256 を sync_meta.checksum と比較し、
//      変化なしなら 5000 行 SELECT すらスキップ（粗粒度・最も安価）
//   2. 1 で書く必要があると判った場合のみ、既存行の content_hash と
//      新規行のハッシュを行単位で比較し、変化行だけを UPSERT
//
// 新しい同期テーブルを増やす場合も必ずこの 2 段で実装すること。
// 直 INSERT OR REPLACE / 全行 UPSERT は禁止。

export async function scheduledSync(env) {
  const startedAt = Date.now();
  console.log('[sync] start');

  // 3 系統を並列実行。直列だと products(5000+行) で 12s 超 → waitUntil 30s 上限で
  // ai_prefill が cancel されるバグが過去にあった。Promise.all で max(各系統) に短縮
  await Promise.all([
    syncOne(env, 'syncDumpProducts',  'products',   syncProducts),
    syncOne(env, 'syncDumpPurchases', 'purchases',  syncPurchases),
    syncOne(env, 'syncDumpAiPrefill', 'ai_prefill', syncAiPrefill),
  ]);

  // listing-text KV プリウォーム: 出品準備〜出品中フェーズの商品（実測 ~2200 件）を
  // 毎ティック 16 件ずつ温める。16 × 288 tick/日 = 4608/日 で全件を 12〜24 時間で 1 周。
  // 詳細を初めて開いた瞬間でも KV ヒット → ~50ms で「タイトルコピー」が即時反応するようになる。
  // 商品データに変化があれば syncProducts 側で KV.delete されるので、古い説明文は出回らない。
  try { await prewarmListingText(env, 16); }
  catch (err) { console.error('[warm] error', err && err.message); }

  console.log(`[sync] done ${Date.now() - startedAt}ms`);
}

async function syncOne(env, action, source, applyFn) {
  try {
    const data = await fetchAction(env, action);
    if (!(data && data.ok && Array.isArray(data.items))) {
      console.warn(`[sync] ${source} fetch failed`, data && data.error);
      return;
    }

    // ─── ガード 1: payload 全体 checksum ───────────────────────
    // 変化なしなら以降の SELECT/UPSERT を完全にスキップ。
    const checksum = await sha256Hex(stableStringify(data.items));
    const meta = await env.DB.prepare(
      'SELECT checksum FROM sync_meta WHERE source = ?'
    ).bind(source).first();

    if (meta && meta.checksum === checksum) {
      console.log(`[sync] ${source}: unchanged (skip), n=${data.items.length}, hash=${checksum.slice(0, 8)}`);
      return;
    }

    // ─── ガード 2: 行単位 content_hash で UPSERT 件数を絞る ─────
    const result = await applyFn(env, data.items);
    const writeCount = (result && typeof result.count === 'number') ? result.count : (result || 0);
    await writeMeta(env.DB, source, data.items.length, checksum);
    console.log(`[sync] ${source}: total=${data.items.length} writes=${writeCount} hash=${checksum.slice(0, 8)}`);
  } catch (err) {
    console.error(`[sync] ${source} error`, err && err.message, err && err.stack);
  }
}

async function fetchAction(env, action, payload) {
  const body = JSON.stringify({ action, secret: env.SYNC_SECRET, payload: payload || null });
  const res = await postFollowingRedirects(env.GAS_API_URL, body);
  if (!res.ok) throw new Error(`gas ${action} http ${res.status}`);
  return res.json();
}

// GAS Web App の POST フロー: POST /exec → 302 → GET でレスポンス取得
// fetch の redirect:'follow' は標準では POST→GET 変換されるが、Cloudflare Workers では
// Location を保持しないケースがあるため手動で追従する
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

// ─── products ──────────────────────────────────────────────────
async function syncProducts(env, rows) {
  const db = env.DB;
  // 削除対象検出（incoming に居ない既存行）。20% 安全閾値で誤削除を防ぐ。
  const incoming = new Set(rows.map(r => String(r.kanri || '')).filter(Boolean));
  const { results: existing } = await db
    .prepare('SELECT kanri, content_hash FROM products')
    .all();
  const existingHash = new Map(existing.map(r => [r.kanri, r.content_hash]));

  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip product delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.kanri)).map(r => r.kanri);
    if (stale.length) {
      const delBatch = 50;
      for (let i = 0; i < stale.length; i += delBatch) {
        const batch = stale.slice(i, i + delBatch);
        const ph = batch.map(() => '?').join(',');
        await db.prepare(`DELETE FROM products WHERE kanri IN (${ph})`).bind(...batch).run();
      }
      console.log(`[sync] deleted ${stale.length} stale products`);
    }
  }

  // 行単位 content_hash 比較 → 変化行だけ抽出
  const now = Date.now();
  const toWrite = [];
  for (const p of rows) {
    const hash = await sha256Hex(stableStringify(p));
    const prev = existingHash.get(String(p.kanri || ''));
    if (prev !== hash) toWrite.push({ p, hash });
  }

  if (toWrite.length === 0) return 0;

  const batchSize = 50;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const batch = toWrite.slice(i, i + batchSize);
    const stmts = batch.map(({ p, hash }) =>
      db.prepare(`
        INSERT OR REPLACE INTO products
          (kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        hash,
      )
    );
    await db.batch(stmts);
  }

  // 商品データ変化 → KV 内の listing-text を invalidate（次回ウォームで再生成）。
  // GAS 側 CacheService 10 分も含めて古い説明文が残らないよう、ここで明示削除する。
  if (env.CACHE && toWrite.length) {
    const dels = toWrite.map(({ p }) =>
      env.CACHE.delete('listing-text:' + String(p.kanri || '')).catch(() => {})
    );
    await Promise.all(dels);
  }
  return toWrite.length;
}

// ─── purchases ─────────────────────────────────────────────────
async function syncPurchases(env, rows) {
  const db = env.DB;
  const incoming = new Set(rows.map(r => String(r.shiireId || '')).filter(Boolean));
  const { results: existing } = await db
    .prepare('SELECT shiire_id, content_hash FROM purchases')
    .all();
  const existingHash = new Map(existing.map(r => [r.shiire_id, r.content_hash]));

  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip purchase delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.shiire_id)).map(r => r.shiire_id);
    if (stale.length) {
      const delBatch = 50;
      for (let i = 0; i < stale.length; i += delBatch) {
        const batch = stale.slice(i, i + delBatch);
        const ph = batch.map(() => '?').join(',');
        await db.prepare(`DELETE FROM purchases WHERE shiire_id IN (${ph})`).bind(...batch).run();
      }
      console.log(`[sync] deleted ${stale.length} stale purchases`);
    }
  }

  const now = Date.now();
  const toWrite = [];
  for (const p of rows) {
    const hash = await sha256Hex(stableStringify(p));
    const prev = existingHash.get(String(p.shiireId || ''));
    if (prev !== hash) toWrite.push({ p, hash });
  }

  if (toWrite.length === 0) return 0;

  const batchSize = 50;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const batch = toWrite.slice(i, i + batchSize);
    const stmts = batch.map(({ p, hash }) =>
      db.prepare(`
        INSERT OR REPLACE INTO purchases
          (shiire_id, date, amount, shipping, planned, place, cost, category,
           content, supplier_id, register_user, registered_at, assigned_kanri, processed,
           row_num, updated_at, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        hash,
      )
    );
    await db.batch(stmts);
  }
  return toWrite.length;
}

// ─── ai_prefill ────────────────────────────────────────────────
async function syncAiPrefill(env, rows) {
  const db = env.DB;
  const incoming = new Set(rows.map(r => String(r.kanri || '')).filter(Boolean));
  const { results: existing } = await db
    .prepare('SELECT kanri, content_hash FROM ai_prefill')
    .all();
  const existingHash = new Map(existing.map(r => [r.kanri, r.content_hash]));

  if (existing.length > 0 && rows.length < existing.length * 0.2) {
    console.warn(`[sync] skip ai_prefill delete: incoming=${rows.length} vs existing=${existing.length}`);
  } else {
    const stale = existing.filter(r => !incoming.has(r.kanri)).map(r => r.kanri);
    if (stale.length) {
      const delBatch = 50;
      for (let i = 0; i < stale.length; i += delBatch) {
        const batch = stale.slice(i, i + delBatch);
        const ph = batch.map(() => '?').join(',');
        await db.prepare(`DELETE FROM ai_prefill WHERE kanri IN (${ph})`).bind(...batch).run();
      }
      console.log(`[sync] deleted ${stale.length} stale ai_prefill`);
    }
  }

  const now = Date.now();
  const toWrite = [];
  for (const p of rows) {
    const hash = await sha256Hex(stableStringify(p));
    const prev = existingHash.get(String(p.kanri || ''));
    if (prev !== hash) toWrite.push({ p, hash });
  }

  if (toWrite.length === 0) return 0;

  const batchSize = 50;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const batch = toWrite.slice(i, i + batchSize);
    const stmts = batch.map(({ p, hash }) =>
      db.prepare(`
        INSERT OR REPLACE INTO ai_prefill
          (kanri, fields_json, row_num, updated_at, content_hash)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        String(p.kanri || ''),
        p.fields ? JSON.stringify(p.fields) : '{}',
        Number(p.row || 0),
        now,
        hash,
      )
    );
    await db.batch(stmts);
  }
  return toWrite.length;
}

// ─── sync_meta ─────────────────────────────────────────────────
async function writeMeta(db, source, count, checksum) {
  await db.prepare(`
    INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
    VALUES (?, ?, ?, ?)
  `).bind(source, Date.now(), count, checksum).run();
}

// ─── ハッシュユーティリティ ─────────────────────────────────────
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

function s(v) { return v == null ? null : String(v); }
function n(v) {
  if (v == null || v === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

// ─── listing-text プリウォーム ───────────────────────────────────
// アクティブフェーズ（出品待ち / 出品作業中 / 出品中）の商品を毎ティック数件ずつ
// GAS doGet?fmt=json で取得 → KV に 30 分 TTL で保存。
// staff app で詳細を初めて開いた瞬間でも KV ヒットして「タイトルコピー」が即時動作する。
//
// コスト試算: 8 件/tick × 288 tick/日 = 2304 GAS 呼び出し/日。
// GAS の月割り無料枠（6h CPU/日）で十分カバーできる。
async function prewarmListingText(env, batchSize) {
  const kv = env.CACHE;
  if (!kv) return;
  if (!env.GAS_API_URL) return;

  // 多めに候補を取って、KV 既ヒット分を除外したうえで上位 batchSize 件をウォームする。
  const { results } = await env.DB.prepare(
    `SELECT kanri FROM products
     WHERE status IN ('出品待ち','出品作業中','出品中')
     ORDER BY updated_at DESC
     LIMIT ?`
  ).bind(batchSize * 6).all();

  const candidates = (results || []).map(r => String(r.kanri || '')).filter(Boolean);
  if (!candidates.length) return;

  // 並列で KV 在否を確認（KV.get は metadata-only より値取得が安いため text で）
  const present = await Promise.all(
    candidates.map(k =>
      kv.get('listing-text:' + k, 'text').then(v => !!v).catch(() => false)
    )
  );
  const misses = candidates.filter((_, i) => !present[i]).slice(0, batchSize);
  if (!misses.length) {
    console.log(`[warm] all hot (candidates=${candidates.length})`);
    return;
  }

  const settled = await Promise.allSettled(misses.map(k => warmOne(env, k)));
  const ok = settled.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`[warm] candidates=${candidates.length} misses=${misses.length} warmed=${ok}`);
}

async function warmOne(env, kanri) {
  const base = String(env.GAS_API_URL || '');
  const target = base + (base.indexOf('?') >= 0 ? '&' : '?')
    + 'id=' + encodeURIComponent(kanri) + '&fmt=json';
  let res;
  try {
    res = await getFollowingRedirects(target);
  } catch { return false; }
  if (!res.ok) return false;
  let parsed;
  try { parsed = await res.json(); } catch { return false; }
  if (!parsed || parsed.ok !== true) return false;
  const out = {
    title: String(parsed.title || ''),
    description: String(parsed.description || ''),
  };
  try {
    // TTL 24h: Cron が変化検知で invalidate するので長めで OK。
    // 万一 invalidate が漏れても 24h でセルフヒーリング。
    await env.CACHE.put(
      'listing-text:' + kanri,
      JSON.stringify(out),
      { expirationTtl: 86400 }
    );
  } catch { return false; }
  return true;
}

async function getFollowingRedirects(url) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { method: 'GET', redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    current = loc;
  }
  throw new Error('too many redirects');
}
