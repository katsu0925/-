import { jsonOk, jsonError } from '../utils/response.js';

// AI画像判定シートの管理番号 lookup（AppSheet Initial Value 相当）
// GET /api/ai/prefill?kanri=zB1
// 高速パス: gas-proxy 側 KV (ai-result:<kanri>) を直読みして GAS 往復をスキップ
// フォールバック: GAS Web App
export async function lookupAiPrefill(request, env) {
  const url = new URL(request.url);
  const kanri = String(url.searchParams.get('kanri') || '').trim();
  if (!kanri) return jsonError('kanri required', 400);

  // KV ヒット時は ~50ms で返却。未ヒット時は AI画像判定シート（GAS）にフォールバック。
  // KV TTL 切れ／タスキ箱未アップだが手動でシートに値がある等のケースを取りこぼさない。
  if (env.GAS_PROXY_CACHE) {
    try {
      const cached = await env.GAS_PROXY_CACHE.get('ai-result:' + kanri);
      if (cached) {
        const ai = JSON.parse(cached);
        const fields = mapAiResultToFields_(ai);
        if (Object.keys(fields).length > 0) {
          return jsonOk({ fields, found: true, source: 'kv' });
        }
      }
    } catch (_) { /* KV 例外は無視して GAS にフォールバック */ }
  }

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
  return jsonOk({ fields: data.fields || {}, found: !!data.found, source: 'gas' });
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
