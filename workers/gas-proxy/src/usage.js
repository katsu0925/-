// 従量監視用 KV カウンタ（gas-proxy）
// 月次キー（YYYY-MM）で記録。月末+1日まで TTL を伸ばして自動リセット。
// All-buppan ③シート Monitor.js が GET /usage/* で参照する。

function monthKey() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function monthTtlSeconds() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  return Math.ceil((nextMonth - now) / 1000);
}

// ─── Gemini API 呼出し数（モデル別・合計） ───
// keys: gemini-count:YYYY-MM:<model>, gemini-count:YYYY-MM:_total

export async function incrementGeminiUsage(env, model) {
  const m = monthKey();
  const modelKey = `gemini-count:${m}:${model || 'unknown'}`;
  const totalKey = `gemini-count:${m}:_total`;
  const ttl = monthTtlSeconds();
  const [modelStr, totalStr] = await Promise.all([
    env.CACHE.get(modelKey),
    env.CACHE.get(totalKey),
  ]);
  const modelCount = parseInt(modelStr || '0') + 1;
  const totalCount = parseInt(totalStr || '0') + 1;
  await Promise.all([
    env.CACHE.put(modelKey, String(modelCount), { expirationTtl: ttl }),
    env.CACHE.put(totalKey, String(totalCount), { expirationTtl: ttl }),
  ]);
  return { month: m, model: model || 'unknown', modelCount, totalCount };
}

export async function getGeminiUsage(env) {
  const m = monthKey();
  // KV list でこの月の全モデル分を集計
  const prefix = `gemini-count:${m}:`;
  const list = await env.CACHE.list({ prefix });
  const models = {};
  let total = 0;
  for (const k of list.keys) {
    const suffix = k.name.substring(prefix.length);
    const v = parseInt(await env.CACHE.get(k.name) || '0');
    if (suffix === '_total') {
      total = v;
    } else {
      models[suffix] = v;
    }
  }
  return { month: m, total, models };
}
