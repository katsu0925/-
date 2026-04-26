import { jsonOk, jsonError } from '../utils/response.js';

// AI画像判定シートの管理番号 lookup（AppSheet Initial Value 相当）
// GET /api/ai/prefill?kanri=zB1
export async function lookupAiPrefill(request, env) {
  const url = new URL(request.url);
  const kanri = String(url.searchParams.get('kanri') || '').trim();
  if (!kanri) return jsonError('kanri required', 400);

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
  return jsonOk({ fields: data.fields || {}, found: !!data.found });
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
