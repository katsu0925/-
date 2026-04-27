import { jsonOk, jsonError } from '../utils/response.js';

// AI画像判定シートの管理番号 lookup（AppSheet Initial Value 相当）
// GET /api/ai/prefill?kanri=zB1
//
// 速度階層（高速→低速の順に試行し、最初にヒットしたら即返却）
//   1. caches.default — pop ローカル SSD（5分）。同一URLで2回目以降 ~10ms
//   2. D1 ai_prefill  — 5分Cron で AI画像判定シート全件を同期。~15-25ms
//   3. KV ai-result   — gas-proxy 側 Gemini 判定直後に書き込み（30日 TTL）。~30-50ms
//   4. GAS Web App    — 上記すべてミスのフォールバック。~600-1500ms
//
// D1 を最優先にする理由: TTL 切れによる KV ミス、シート手動編集 → KV 未更新 のケースを
// Cron 同期で取りこぼさず、レスポンスが安定する。
export async function lookupAiPrefill(request, env) {
  const url = new URL(request.url);
  const kanri = String(url.searchParams.get('kanri') || '').trim();
  if (!kanri) return jsonError('kanri required', 400);

  // 1) Workers Cache API（pop ローカル SSD、5分）
  const cacheKey = new Request('https://shiire-kanri.cache/ai-prefill?kanri=' + encodeURIComponent(kanri));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    // ヘッダで cache hit を示す（デバッグ用）
    const text = await cached.text();
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-AI-Source': 'edge-cache' },
    });
  }

  let body = null;

  // 2) D1 ai_prefill
  try {
    const row = await env.DB.prepare('SELECT fields_json FROM ai_prefill WHERE kanri = ? LIMIT 1').bind(kanri).first();
    if (row && row.fields_json) {
      const fields = safeParse_(row.fields_json);
      if (fields && Object.keys(fields).length > 0) {
        body = { ok: true, fields, found: true, source: 'd1' };
      }
    }
  } catch (_) { /* D1 例外は次のレイヤーへ */ }

  // 3) KV ai-result（D1 ミス時）
  if (!body && env.GAS_PROXY_CACHE) {
    try {
      const cachedKv = await env.GAS_PROXY_CACHE.get('ai-result:' + kanri);
      if (cachedKv) {
        const ai = safeParse_(cachedKv);
        const fields = mapAiResultToFields_(ai);
        if (fields && Object.keys(fields).length > 0) {
          body = { ok: true, fields, found: true, source: 'kv' };
        }
      }
    } catch (_) { /* 次のレイヤーへ */ }
  }

  // 4) GAS Web App フォールバック
  if (!body) {
    let res;
    try {
      res = await postFollowingRedirects(env.GAS_API_URL, JSON.stringify({
        action: 'lookupAiPrefill',
        secret: env.SYNC_SECRET,
        payload: { kanri },
      }));
    } catch (err) {
      return jsonError('gas fetch: ' + err.message, 502);
    }
    if (!res.ok) return jsonError('gas http ' + res.status, 502);
    let data;
    try { data = await res.json(); } catch { return jsonError('gas non-json', 502); }
    if (!data || !data.ok) return jsonError(data && data.error || 'gas error', 502);
    body = { ok: true, fields: data.fields || {}, found: !!data.found, source: 'gas' };
  }

  // Cache API に保存（5分）。ヒット時は found: true のみキャッシュする方針もあるが、
  // 空応答もキャッシュして GAS 連打を防ぐ
  const json = JSON.stringify(body);
  const response = new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'X-AI-Source': body.source || 'unknown',
    },
  });
  // Note: Cache API は Response の clone を put する必要がある
  request.cf || null; // (no-op; placeholder so we don't await before cloning if response is small)
  // ctx.waitUntil 相当はここでは取れないが、cache.put は同期でも fire-and-forget で通常 OK
  cache.put(cacheKey, response.clone()).catch(() => { /* cache 書込失敗は無視 */ });
  return response;
}

// gas-proxy KV (英語キー Gemini 出力) → AI画像判定シート列名 (日本語) にマッピング
// saisun-list/SyncApi.gs の fieldToHeader と整合
function mapAiResultToFields_(ai) {
  const map = {
    brand: 'ブランド',
    tagLabel: 'タグ表記',
    gender: '性別',
    category1: 'カテゴリ1',
    category2: 'カテゴリ2',
    category3: 'カテゴリ3',
    design: 'デザイン特徴',
    color: 'カラー',
    pocket: 'ポケット',
  };
  const out = {};
  if (!ai || typeof ai !== 'object') return out;
  for (const k in map) {
    const v = ai[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out[map[k]] = s;
  }
  return out;
}

function safeParse_(s) {
  try { return JSON.parse(s); } catch { return null; }
}

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

// POST /api/ai/prefill/batch  body: { kanris: ["zB1","zB2",...] }
// Phase 3 — クライアント側で一気にプリフェッチして in-memory cache に貯める用途
// D1 単体クエリ（IN 句）で全件取得 → 残った欠損のみ KV を回す（GAS は呼ばない）
export async function lookupAiPrefillBatch(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const list = Array.isArray(body && body.kanris) ? body.kanris.map(s => String(s || '').trim()).filter(Boolean) : [];
  if (!list.length) return jsonOk({ items: {} });
  // 上限 200（DoS 防止＋ D1 SQL ステートメント上限の保守的値）
  const kanris = Array.from(new Set(list)).slice(0, 200);

  const result = {};

  // D1 一括取得
  try {
    const ph = kanris.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT kanri, fields_json FROM ai_prefill WHERE kanri IN (${ph})`
    ).bind(...kanris).all();
    for (const row of results || []) {
      const fields = safeParse_(row.fields_json);
      if (fields && Object.keys(fields).length > 0) {
        result[row.kanri] = { fields, found: true, source: 'd1' };
      }
    }
  } catch (_) { /* 全件 D1 失敗時は KV にフォールバック */ }

  // 欠損分を KV から（並列取得）
  if (env.GAS_PROXY_CACHE) {
    const missing = kanris.filter(k => !result[k]);
    if (missing.length > 0) {
      const kvResults = await Promise.all(missing.map(k =>
        env.GAS_PROXY_CACHE.get('ai-result:' + k).catch(() => null)
      ));
      for (let i = 0; i < missing.length; i++) {
        const cached = kvResults[i];
        if (!cached) continue;
        const ai = safeParse_(cached);
        const fields = mapAiResultToFields_(ai);
        if (fields && Object.keys(fields).length > 0) {
          result[missing[i]] = { fields, found: true, source: 'kv' };
        }
      }
    }
  }

  return jsonOk({ items: result, count: Object.keys(result).length });
}
