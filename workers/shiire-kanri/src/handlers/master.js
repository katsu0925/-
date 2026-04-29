import { jsonOk, jsonError } from '../utils/response.js';

// マスター系（作業者/アカウント）は GAS 経由で取得し KV に短時間キャッシュ

const TTL_SECONDS = 600; // 10分

export async function listWorkers(request, env) {
  return getCached(env, 'master:workers', 'listWorkers');
}

export async function listAccounts(request, env) {
  return getCached(env, 'master:accounts', 'listAccounts');
}

export async function listSuppliers(request, env) {
  return getCached(env, 'master:suppliers', 'listSuppliers');
}

export async function listPlaces(request, env) {
  return getCached(env, 'master:places', 'listPlaces');
}

export async function listCategories(request, env) {
  return getCached(env, 'master:categories', 'listCategories');
}

// 設定シート（複数列の汎用マスタ）— items は { ヘッダー名: [値...] } のオブジェクト
export async function listSettings(request, env) {
  return getCached(env, 'master:settings', 'listSettings', { itemsType: 'object' });
}

async function getCached(env, cacheKey, action, opts) {
  const itemsType = (opts && opts.itemsType) || 'array';
  const isValid = (items) => itemsType === 'object'
    ? (items && typeof items === 'object' && !Array.isArray(items))
    : Array.isArray(items);

  try {
    if (env.CACHE) {
      const hit = await env.CACHE.get(cacheKey, 'json');
      if (hit && isValid(hit.items)) {
        return jsonOk({ items: hit.items, cached: true });
      }
    }
  } catch (err) {
    console.warn('[master] kv get failed', err.message);
  }

  let res;
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, JSON.stringify({
      action,
      secret: env.SYNC_SECRET,
    }));
  } catch (err) {
    return jsonError('gas fetch[' + action + ']: ' + err.message, 502);
  }
  if (!res.ok) return jsonError('gas http ' + res.status + '[' + action + ']', 502);
  let text = '';
  try { text = await res.text(); } catch { return jsonError('gas read fail[' + action + ']', 502); }
  let data;
  try { data = JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return jsonError('gas non-json[' + action + ']: ' + hint, 502);
  }
  if (!data || !data.ok) return jsonError((data && data.error) || ('gas error[' + action + ']'), 502);
  const items = isValid(data.items) ? data.items : (itemsType === 'object' ? {} : []);

  try {
    if (env.CACHE) {
      await env.CACHE.put(cacheKey, JSON.stringify({ items }), { expirationTtl: TTL_SECONDS });
    }
  } catch (err) {
    console.warn('[master] kv put failed', err.message);
  }
  return jsonOk({ items, cached: false });
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
