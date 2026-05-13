import { jsonOk, jsonError } from '../utils/response.js';

// 請求書管理 API — GAS の staff_invoice* / adminInv_* を薄くプロキシする。
// データは GAS 側 Sheets（請求書履歴 / 請求書修正申請 / インボイス経過措置率 / 請求書管理者設定）が正本。
// Workers は認証（CF Access JWT）と JSON 整形のみを担当。

// ───── スタッフ向け ─────

export async function invoiceMe(request, env, user) {
  const r = await callGas(env, 'invoiceCurrentUser', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ user: r.user || {}, settings: r.settings || {} });
}

export async function listMyInvoices(request, env, user) {
  const r = await callGas(env, 'listInvoices', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [] });
}

export async function getInvoiceDetail(request, env, user) {
  const url = new URL(request.url);
  const invoiceNo = String(url.searchParams.get('invoiceNo') || '').trim();
  if (!invoiceNo) return jsonError('invoiceNo required', 400);
  const r = await callGas(env, 'getInvoiceDetail', { no: invoiceNo }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ invoice: r.invoice || null });
}

export async function listMyAvailableMonths(request, env, user) {
  const r = await callGas(env, 'listMyAvailableMonths', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ months: r.months || [] });
}

export async function calcInvoicePreview(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const ym = String(body.ym || '').trim();
  if (!ym) return jsonError('ym required', 400);
  const r = await callGas(env, 'calcInvoicePreview', { ym }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ preview: r.preview || null });
}

export async function getInvoiceProfile(request, env, user) {
  const r = await callGas(env, 'getInvoiceProfile', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ profile: r.profile || {} });
}

export async function saveInvoiceProfile(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const r = await callGas(env, 'saveInvoiceProfile', body || {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ saved: true, profile: r.profile || {} });
}

export async function createInvoice(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const ym = String(body.ym || '').trim();
  if (!ym) return jsonError('ym required', 400);
  const r = await callGas(env, 'createInvoice', { ym }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({
    invoice: r.invoice || null,
    created: r.created !== false,
    overwritten: !!r.overwritten,
  });
}

export async function downloadInvoicePdf(request, env, user) {
  const url = new URL(request.url);
  const invoiceNo = String(url.searchParams.get('invoiceNo') || '').trim();
  if (!invoiceNo) return jsonError('invoiceNo required', 400);
  const r = await callGas(env, 'downloadInvoicePdf', { no: invoiceNo }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  // GAS 側で base64 化された PDF を直接バイナリ Response に整形して返す。
  const b64 = String(r.base64 || '');
  const fileName = String(r.filename || ('invoice_' + invoiceNo + '.pdf'));
  if (!b64) return jsonError('empty pdf', 502);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bin, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(fileName),
      'Cache-Control': 'no-store',
    },
  });
}

export async function requestInvoiceRevision(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const invoiceNo = String(body.invoiceNo || '').trim();
  const reason = String(body.reason || '').trim();
  if (!invoiceNo) return jsonError('invoiceNo required', 400);
  if (!reason) return jsonError('reason required', 400);
  const r = await callGas(env, 'requestInvoiceRevision', { no: invoiceNo, reason }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ submitted: true, applyId: r.applyId });
}

export async function listMyRevisions(request, env, user) {
  const r = await callGas(env, 'listMyRevisions', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [] });
}

// ───── 管理者向け ─────

export async function adminListInvoices(request, env, user) {
  const url = new URL(request.url);
  const params = {};
  const ym = url.searchParams.get('ym');
  const status = url.searchParams.get('status');
  const staffName = url.searchParams.get('staffName');
  if (ym) params.ym = ym;
  if (status) params.status = status;
  if (staffName) params.staffName = staffName;
  const r = await callGas(env, 'adminInv_listAllInvoices', params, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ items: r.items || [] });
}

export async function adminListRevisions(request, env, user) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const r = await callGas(env, 'adminInv_listAllRevisions', status ? { status } : {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ items: r.items || [] });
}

export async function adminUpdateRevision(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const r = await callGas(env, 'adminInv_respondRevision', body || {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ updated: true });
}

export async function adminUpdateInvoiceStatus(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const r = await callGas(env, 'adminInv_updateInvoiceStatus', body || {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ updated: true });
}

export async function adminGetGraceRates(request, env, user) {
  const r = await callGas(env, 'adminInv_listGraceRates', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ items: r.items || [] });
}

export async function adminSaveGraceRates(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const r = await callGas(env, 'adminInv_saveGraceRates', body || {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ saved: true });
}

export async function adminGetSettings(request, env, user) {
  const r = await callGas(env, 'adminInv_getAdminSettings', {}, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ settings: r.settings || {} });
}

export async function adminSaveSettings(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const r = await callGas(env, 'adminInv_saveAdminSettings', { settings: body || {} }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ saved: true });
}

// ───── 内部ヘルパー（extras.js と同じ実装、ESM のため重複定義）─────

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
    if (!loc) throw new Error('redirect without location at hop ' + hop);
    const next = await fetch(loc, { method: 'GET', redirect: 'manual' });
    if (next.status < 300 || next.status >= 400) return next;
    loc = next.headers.get('location');
  }
  throw new Error('too many redirects');
}
