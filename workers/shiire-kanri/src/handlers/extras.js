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

export async function dumpSheet(request, env, user, name) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const r = await callGas(env, 'dumpSheet', { name, limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ headers: r.headers || [], rows: r.rows || [], total: r.total || 0 });
}

// ?id=xxx&fmt=json で GAS doGet からタイトル・説明文を取得
// （Code.gs:doGet が組み立てる generatedTitle / description を JSON で受け取る）
export async function getListingText(request, env, user, kanri) {
  const id = String(kanri || '').trim();
  if (!id) return jsonError('kanri required', 400);
  const base = String(env.GAS_API_URL || '');
  if (!base) return jsonError('GAS_API_URL not configured', 500);
  const target = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(id) + '&fmt=json';
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
  return jsonOk({
    id: parsed.id || id,
    title: String(parsed.title || ''),
    description: String(parsed.description || ''),
  });
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
