// 5分Cron: 作業者マスター（O列=TRUE のメール）を Cloudflare Access のポリシーに反映
// 必要な env: CF_API_TOKEN, CF_ACCOUNT_ID, GAS_API_URL, SYNC_SECRET
// Application は Application name = "shiire-kanri" で自動発見、最初のポリシーを更新する

const APP_NAME = 'shiire-kanri';
const CF_BASE = 'https://api.cloudflare.com/client/v4';

export async function scheduledAccessSync(env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    console.log('[access-sync] skip (CF_API_TOKEN or CF_ACCOUNT_ID not set)');
    return { ok: false, skipped: true };
  }
  try {
    const emails = await fetchAllowedEmails(env);
    if (!emails.length) {
      console.warn('[access-sync] no emails returned from GAS');
      return { ok: false, error: 'no emails' };
    }
    const { appId, policyId } = await discoverApp(env);
    const updated = await updatePolicyEmails(env, appId, policyId, emails);
    console.log(`[access-sync] policy ${policyId} updated emails=${emails.length} changed=${updated.changed}`);
    return { ok: true, count: emails.length, changed: updated.changed };
  } catch (err) {
    console.error('[access-sync] error', err.message);
    return { ok: false, error: err.message };
  }
}

async function fetchAllowedEmails(env) {
  const body = JSON.stringify({ action: 'listAllowedEmails', secret: env.SYNC_SECRET });
  const first = await fetch(env.GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });
  let res = first;
  let loc = first.headers.get('location');
  for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400; hop++) {
    if (!loc) throw new Error(`gas redirect without location at hop ${hop}`);
    res = await fetch(loc, { method: 'GET', redirect: 'manual' });
    loc = res.headers.get('location');
  }
  if (!res.ok) throw new Error(`gas listAllowedEmails http ${res.status}`);
  const json = await res.json();
  if (!json.ok || !Array.isArray(json.emails)) throw new Error(`gas response: ${json.error || 'invalid'}`);
  return json.emails;
}

async function discoverApp(env) {
  // Application 一覧から名前で検索
  const res = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps?per_page=200`);
  const app = (res.result || []).find(a => a.name === APP_NAME);
  if (!app) throw new Error(`access app not found: ${APP_NAME}`);
  // ポリシー一覧（先頭の Allow ポリシーを採用）
  const polRes = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${app.id}/policies`);
  const policy = (polRes.result || []).find(p => p.decision === 'allow') || polRes.result?.[0];
  if (!policy) throw new Error(`no policy found for app ${app.id}`);
  return { appId: app.id, policyId: policy.id };
}

async function updatePolicyEmails(env, appId, policyId, emails) {
  // 現状ポリシーを取得（他フィールドを保持するため）
  const cur = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${appId}/policies/${policyId}`);
  const policy = cur.result;
  const include = emails.map(e => ({ email: { email: e } }));
  // 差分判定: 既存 include の email セットと一致するならスキップ
  const before = new Set((policy.include || [])
    .map(r => r.email && r.email.email)
    .filter(Boolean)
    .map(s => s.toLowerCase()));
  const after = new Set(emails.map(e => e.toLowerCase()));
  if (before.size === after.size && [...after].every(e => before.has(e))) {
    return { changed: false };
  }
  await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${appId}/policies/${policyId}`, {
    method: 'PUT',
    body: {
      name: policy.name,
      decision: policy.decision,
      include,
      exclude: policy.exclude || [],
      require: policy.require || [],
      session_duration: policy.session_duration,
    },
  });
  return { changed: true };
}

async function cfApi(env, path, opts) {
  const o = opts || {};
  const res = await fetch(CF_BASE + path, {
    method: o.method || 'GET',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors && json.errors[0] && json.errors[0].message) || `http ${res.status}`;
    throw new Error(`cf api ${path}: ${msg}`);
  }
  return json;
}
