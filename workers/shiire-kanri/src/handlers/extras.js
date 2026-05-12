import { jsonOk, jsonError } from '../utils/response.js';

// AppSheet 互換タブ用の追加 API
// GAS Web App をプロキシする読み書き API（移動報告/返送管理/AI画像判定/作業者/業務シート）

export async function listMoves(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const r = await callGas(env, 'listMoves', { limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [], total: r.total || (r.items ? r.items.length : 0) });
}

export async function createMove(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  const moveId = String(body.moveId || '').trim();
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'createMove', { destination, ids, reporter, moveId }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ created: true, moveId: r.moveId, row: r.row });
}

export async function deleteMove(request, env, user, moveId) {
  const id = String(moveId || '').trim();
  if (!id) return jsonError('moveId required', 400);
  const r = await callGas(env, 'deleteMove', { moveId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, moveId: r.moveId });
}

export async function deleteReturn(request, env, user, boxId) {
  const id = String(boxId || '').trim();
  if (!id) return jsonError('boxId required', 400);
  const r = await callGas(env, 'deleteReturn', { boxId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, boxId: r.boxId });
}

export async function deletePurchase(request, env, user, shiireId) {
  const id = String(shiireId || '').trim();
  if (!id) return jsonError('shiireId required', 400);
  const r = await callGas(env, 'deletePurchase', { shiireId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, shiireId: r.shiireId });
}

export async function listReturns(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const r = await callGas(env, 'listReturns', { limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [], total: r.total || (r.items ? r.items.length : 0) });
}

export async function createReturn(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  const note = String(body.note || '');
  const count = body.count;
  const boxId = String(body.boxId || '').trim();
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'createReturn', { destination, ids, reporter, note, count, boxId }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ created: true, boxId: r.boxId, row: r.row });
}

// AI 画像判定: D1 mirror がベース。GAS フォールバックは使用しない。
export async function listAiResults(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  try {
    const stmt = q
      ? env.DB.prepare(
          `SELECT kanri, fields_json, updated_at FROM ai_prefill WHERE LOWER(kanri) LIKE ? OR LOWER(fields_json) LIKE ? ORDER BY updated_at DESC LIMIT ?`
        ).bind('%' + q + '%', '%' + q + '%', limit)
      : env.DB.prepare(
          `SELECT kanri, fields_json, updated_at FROM ai_prefill ORDER BY updated_at DESC LIMIT ?`
        ).bind(limit);
    const { results } = await stmt.all();
    const items = (results || []).map((r) => {
      let fields = {};
      try { fields = JSON.parse(r.fields_json || '{}') || {}; } catch {}
      return { kanri: r.kanri, fields, updatedAt: r.updated_at };
    });
    return jsonOk({ items, total: items.length });
  } catch (err) {
    return jsonError('d1 error: ' + err.message, 500);
  }
}

export async function listSagyousha(request, env, user) {
  const url = new URL(request.url);
  const months = Math.min(12, Math.max(1, parseInt(url.searchParams.get('months'), 10) || 6));
  const r = await callGas(env, 'listSagyousha', { months }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({
    items: r.items || [],
    months: r.months || [],
    currentUser: r.currentUser || { email: (user && user.email) || '', isAdmin: false },
  });
}

export async function saveSagyousha(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const row = parseInt(body.row, 10);
  if (!row || row < 2) return jsonError('row required', 400);
  const payload = {
    row,
    name: typeof body.name === 'string' ? body.name : undefined,
    email1: typeof body.email1 === 'string' ? body.email1 : undefined,
    email2: typeof body.email2 === 'string' ? body.email2 : undefined,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    admin: typeof body.admin === 'boolean' ? body.admin : undefined,
  };
  const r = await callGas(env, 'saveSagyousha', payload, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ saved: true, row: r.row });
}

export async function createSagyousha(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const name = String(body.name || '').trim();
  if (!name) return jsonError('name required', 400);
  const payload = {
    name,
    email1: String(body.email1 || ''),
    email2: String(body.email2 || ''),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    admin: body.admin === true,
  };
  const r = await callGas(env, 'createSagyousha', payload, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ created: true, row: r.row });
}

// 報酬管理など読み取り頻度の高いシートはエッジ KV に短時間キャッシュ。
// 日次の updateRewardsNoFormula で更新されるので 60 秒程度のラグは許容。
// クライアントから ?fresh=1 で強制再取得可能。
const SHEET_DUMP_TTL = 60;
const SHEET_DUMP_CACHED = { '報酬管理': true, '仕入れ報告': true, '経費': true };
export async function dumpSheet(request, env, user, name) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const fresh = url.searchParams.get('fresh') === '1';
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  const cacheable = !!SHEET_DUMP_CACHED[name];
  const cacheKey = 'sheet-dump:' + name + ':' + limit;
  if (kv && cacheable && !fresh) {
    try {
      const hit = await kv.get(cacheKey, 'json');
      if (hit && Array.isArray(hit.headers)) {
        return jsonOk({ headers: hit.headers, rows: hit.rows || [], total: hit.total || 0, cached: true });
      }
    } catch {}
  }
  const r = await callGas(env, 'dumpSheet', { name, limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  const payload = { headers: r.headers || [], rows: r.rows || [], total: r.total || 0 };
  if (kv && cacheable) {
    try { await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: SHEET_DUMP_TTL }); } catch {}
  }
  return jsonOk(payload);
}

// ?id=xxx&fmt=json で GAS doGet からタイトル・説明文を取得
// （Code.gs:doGet が組み立てる generatedTitle / description を JSON で受け取る）
// KV キャッシュ（24h）で 2 回目以降はミリ秒応答にする。
// 5分Cron で出品準備フェーズの商品を先回りウォーム + 商品データ変化時に invalidate するため、
// 古い説明文が出回るリスクは低い（最悪 5 分以内に Cron が拾う）。
const LISTING_TEXT_TTL = 86400;
export async function getListingText(request, env, user, kanri) {
  const id = String(kanri || '').trim();
  if (!id) return jsonError('kanri required', 400);
  const cacheKey = 'listing-text:' + id;
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  // KV ヒット → D1 の追加項目（伸縮性/生地の厚み/裏地）を post-cache 注入して返却
  if (kv) {
    try {
      const hit = await kv.get(cacheKey, 'json');
      if (hit && typeof hit.title === 'string' && typeof hit.description === 'string') {
        const desc = await injectExtraDescription_(env, id, hit.description);
        return jsonOk({ id, title: hit.title, description: desc, cached: true });
      }
    } catch {}
  }
  const base = String(env.GAS_API_URL || '');
  if (!base) return jsonError('GAS_API_URL not configured', 500);
  // KV 未ヒット時は GAS 側 CacheService 10分 もバイパスする（Cron invalidate 後に古い説明文が残らないように）。
  const target = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(id) + '&fmt=json&nocache=1';
  let res;
  try {
    res = await getFollowingRedirects(target);
  } catch (err) {
    return jsonError('gas fetch[listingText]: ' + err.message, 502);
  }
  if (!res.ok) return jsonError('gas http ' + res.status + '[listingText]', 502);
  let text = '';
  try { text = await res.text(); } catch { return jsonError('gas read fail[listingText]', 502); }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return jsonError('gas non-json[listingText]: ' + hint, 502);
  }
  if (!parsed || parsed.ok !== true) {
    return jsonError(String((parsed && parsed.error) || 'gas error'), 502);
  }
  const out = {
    title: String(parsed.title || ''),
    description: String(parsed.description || ''),
  };
  // KV にはスプレッドシート由来のオリジナル description を保存（D1 追加項目は post-cache 注入する）
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(out), { expirationTtl: LISTING_TEXT_TTL }); } catch {}
  }
  const desc = await injectExtraDescription_(env, id, out.description);
  return jsonOk({ id: parsed.id || id, title: out.title, description: desc });
}

// D1 の extra_json から 伸縮性 / 生地の厚み / 裏地 を取り出し、
// description の「透け感：…」行の直後に挿入する。
// 取れなければ何もしない（GAS 由来テキストをそのまま返す）。
async function injectExtraDescription_(env, kanri, description) {
  if (!env || !env.DB) return description;
  let extra = {};
  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    if (cur && cur.extra_json) extra = JSON.parse(cur.extra_json) || {};
  } catch { return description; }
  const lines = [];
  const stretch = String(extra['伸縮性'] || '').trim();
  const thick = String(extra['生地の厚み'] || '').trim();
  const lining = String(extra['裏地'] || '').trim();
  if (stretch) lines.push('伸縮性：' + stretch);
  if (thick)   lines.push('生地の厚み：' + thick);
  if (lining)  lines.push('裏地：' + lining);
  if (lines.length === 0) return description;
  const insert = lines.join('\n') + '\n';
  // 1) 透け感行の直後（一番自然なデザイン・特徴ブロック内）
  if (/透け感：[^\n]*\n/.test(description)) {
    return description.replace(/(透け感：[^\n]*\n)/, '$1' + insert);
  }
  // 2) ポケット行の直後（透け感が無くてもデザイン・特徴内に収まる）
  if (/ポケット：[^\n]*\n/.test(description)) {
    return description.replace(/(ポケット：[^\n]*\n)/, '$1' + insert);
  }
  // 3) ☆状態詳細 セクションの直前にデザイン・特徴ミニブロックとして挿入
  if (/☆状態詳細/.test(description)) {
    return description.replace(/(☆状態詳細)/, '☆デザイン・特徴\n' + insert + '\n$1');
  }
  // 4) お願い文（・保管上または…）の直前
  if (/・保管上または/.test(description)) {
    return description.replace(/(・保管上または)/, '☆デザイン・特徴\n' + insert + '\n$1');
  }
  return description + (description.endsWith('\n') ? '' : '\n') + insert;
}

// 経費申請レシート画像: dataUrl を GAS の Drive '経費_Images' に保存して URL を返す
// kanri を必要としない汎用画像アップロード（商品管理の保存とは別ライン）
export async function uploadKeihiImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const dataUrl = String(body.dataUrl || '');
  const name = String(body.name || '').trim();
  if (!dataUrl) return jsonError('dataUrl required', 400);
  if (!/^data:image\//.test(dataUrl)) return jsonError('dataUrl must be image data url', 400);
  const r = await callGas(env, 'uploadKeihiImage', { dataUrl, name }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ url: r.url, fileName: r.fileName });
}

// 経費申請: SPA から本人申請を受けて GAS appendKeihi を呼ぶ
// GAS の sh.appendRow は 1-3 秒かかるので、検証通過後は ctx.waitUntil() で
// fire-and-forget して 200 を即時返却する。シート反映は数秒遅れる前提。
export async function appendKeihi(request, env, user, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const name = String(body.name || '').trim();
  const itemName = String(body.itemName || '').trim();
  const amount = Number(body.amount || 0);
  const outsourceCost = Number(body.outsourceCost || 0);
  if (!name) return jsonError('name required', 400);
  if (!itemName) return jsonError('itemName required', 400);
  if (outsourceCost <= 0 && (!amount || amount <= 0)) return jsonError('amount must be positive', 400);
  const payload = {
    name,
    purchaseDate: String(body.purchaseDate || '').trim(),
    itemName,
    place: String(body.place || '').trim(),
    placeLink: String(body.placeLink || '').trim(),
    amount,
    outsourceCost,
    receipt: String(body.receipt || '').trim(),
  };
  const job = (async () => {
    const r = await callGas(env, 'appendKeihi', payload, user);
    if (!r.ok) console.error('[appendKeihi waitUntil] gas error: ' + (r.error || 'unknown'));
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else await job;
  return jsonOk({ submitted: true, queued: true });
}

// 仕入れ数報告: SPA から数量送信 → GAS で行更新 + Phase2 マージ
export async function updateShiireHoukokuQuantity(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const id = String(body.id || '').trim();
  const quantity = parseInt(body.quantity, 10);
  if (!id) return jsonError('id required', 400);
  if (!quantity || quantity <= 0) return jsonError('quantity must be positive', 400);
  const r = await callGas(env, 'updateShiireHoukokuQuantity', { id, quantity }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ saved: true, id: r.id, row: r.row, quantity: r.quantity });
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

async function callGas(env, action, payload, user) {
  const body = JSON.stringify({
    action,
    secret: env.SYNC_SECRET,
    email: (user && user.email) || '',
    payload,
  });
  let res;
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, body);
  } catch (err) {
    return { ok: false, error: 'gas fetch[' + action + ']: ' + err.message };
  }
  if (!res.ok) return { ok: false, error: 'gas http ' + res.status + '[' + action + ']' };
  let text = '';
  try { text = await res.text(); } catch { return { ok: false, error: 'gas read fail[' + action + ']' }; }
  try { return JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return { ok: false, error: 'gas non-json[' + action + ']: ' + hint };
  }
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
