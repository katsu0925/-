// 5分Cron: 作業者マスター（O列=TRUE のメール）を Cloudflare Access のポリシーに反映
// 必要な env: CF_API_TOKEN, CF_ACCOUNT_ID, GAS_API_URL, SYNC_SECRET
// Application は Application name = "shiire-kanri" で自動発見、最初のポリシーを更新する
// さらに「アプリ単位の session_duration」も同値に enforce する（下記参照）。

const APP_NAME = 'shiire-kanri';
const CF_BASE = 'https://api.cloudflare.com/client/v4';
// ログイン継続期間。1ヶ月 = 730h（Cloudflare Access の上限）。
// ※重要: session_duration は「ポリシー単位」と「アプリ単位（=全ポリシーの既定値）」の2箇所にあり、
//   ポリシーだけ伸ばしてもアプリ単位の既定値（初期値24h）が実効上限として効いてしまうケースがある
//   （実際 168h にした後も全員が毎日ログインを求められていた＝アプリ単位の24hが効いていた）。
//   そのため本同期では「ポリシー単位」と「アプリ単位」の両方を DESIRED に揃える。
//   変更時はここだけ書き換えれば次回 Cron / POST /admin/sync-access で両方に反映される。
const DESIRED_SESSION_DURATION = '730h';

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
    // アプリ単位の session_duration も同値に揃える（ポリシーだけだと24hが実効上限になる問題への対処）
    const appUpdated = await updateAppSessionDuration(env, appId);
    // ★最重要: グローバル（アカウント全体）セッションも同値に揃える。
    //   Cloudflare Access は 3層（ポリシー→アプリ→グローバル）で、一番外側のグローバルが
    //   ハード上限になる。グローバルが既定24hのままだと、アプリ/ポリシーを730hにしても
    //   24h ごとに IdP 再ログインを強制される（2026-06-23 判明の真因）。
    //   ※ CF_API_TOKEN に Access: Organizations(Edit) 権限が無い間は skip ログのみ（無害）。
    const orgUpdated = await updateGlobalSessionDuration(env);
    console.log(`[access-sync] policy ${policyId} emails=${emails.length} polChanged=${updated.changed} appChanged=${appUpdated.changed} orgChanged=${orgUpdated.changed} session=${updated.sessionDuration}/${appUpdated.sessionDuration}/${orgUpdated.sessionDuration || orgUpdated.reason || 'skip'}`);
    return {
      ok: true,
      count: emails.length,
      changed: updated.changed,
      sessionDuration: updated.sessionDuration,
      appChanged: appUpdated.changed,
      appSessionDuration: appUpdated.sessionDuration,
      orgChanged: orgUpdated.changed,
      orgSessionDuration: orgUpdated.sessionDuration ?? null,
      orgSkipped: orgUpdated.skipped || false,
      orgReason: orgUpdated.reason || null,
    };
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
  const emailsSame = before.size === after.size && [...after].every(e => before.has(e));
  // ログイン継続期間も enforce 対象。emails が同一でも session_duration がずれていれば PUT する。
  const durationOk = policy.session_duration === DESIRED_SESSION_DURATION;
  if (emailsSame && durationOk) {
    return { changed: false, sessionDuration: policy.session_duration };
  }
  // #4: 急激な縮小ロックアウト防止。GAS の一時的な部分読み取りやバグで許可リストが
  //     大幅に縮むと全外注がアクセス不能になる。現行が十分な人数(>=4)で、新リストが
  //     その半数未満なら異常とみなし PUT をスキップしてログだけ残す（手動確認を促す）。
  //     本当に大量無効化したい場合は CF ダッシュボードで直接編集する運用。
  //     ※ session_duration だけの変更（emails 同一）はこのガードの対象外。
  if (!emailsSame && before.size >= 4 && after.size < before.size * 0.5) {
    console.error(`[access-sync] refuse shrink: before=${before.size} after=${after.size} (>=50% drop). policy unchanged.`);
    return { changed: false, skippedShrink: true, before: before.size, after: after.size };
  }
  await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${appId}/policies/${policyId}`, {
    method: 'PUT',
    body: {
      name: policy.name,
      decision: policy.decision,
      include,
      exclude: policy.exclude || [],
      require: policy.require || [],
      session_duration: DESIRED_SESSION_DURATION,
    },
  });
  return { changed: true, sessionDuration: DESIRED_SESSION_DURATION };
}

// 読み取り専用の診断: アプリ単位 session_duration / 全ポリシーの session_duration /
// アカウント全体のグローバルセッション設定を一括取得する（PUT は一切しない）。
// 「168h にしたのに全員が毎回ログインを求められる」原因が、アプリ単位設定・
// 2本目のポリシー・グローバルセッションのどれで頭打ちになっているかを切り分けるため。
export async function debugAccessConfig(env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return { ok: false, skipped: true, reason: 'CF_API_TOKEN or CF_ACCOUNT_ID not set' };
  }
  try {
    const appsRes = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps?per_page=200`);
    const app = (appsRes.result || []).find(a => a.name === APP_NAME);
    if (!app) return { ok: false, error: `access app not found: ${APP_NAME}` };

    const polRes = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${app.id}/policies`);
    const policies = (polRes.result || []).map((p, i) => ({
      order: i,
      id: p.id,
      name: p.name,
      decision: p.decision,
      precedence: p.precedence,
      session_duration: p.session_duration ?? null,
      includeCount: Array.isArray(p.include) ? p.include.length : 0,
      emailCount: Array.isArray(p.include)
        ? p.include.filter(r => r && r.email && r.email.email).length
        : 0,
    }));

    // アカウント全体のグローバルセッション設定（organizations）
    let org = null;
    try {
      const orgRes = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/organizations`);
      const r = orgRes.result || {};
      org = {
        session_duration: r.session_duration ?? null,
        auto_redirect_to_identity: r.auto_redirect_to_identity ?? null,
        name: r.name ?? null,
      };
    } catch (e) {
      org = { error: e.message };
    }

    return {
      ok: true,
      desiredSessionDuration: DESIRED_SESSION_DURATION,
      app: {
        id: app.id,
        name: app.name,
        domain: app.domain,
        aud: app.aud ?? null,
        session_duration: app.session_duration ?? null,
        allowed_idps: app.allowed_idps || null,
        app_launcher_visible: app.app_launcher_visible ?? null,
      },
      policies,
      organization: org,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// アプリ単位の session_duration を DESIRED に揃える。
// Cloudflare の PUT /access/apps/{id} は全フィールド置換のため、GET の全項目を echo して
// session_duration だけ上書きする（aud / domain / type 等の重要フィールドを保持。
// 特に aud を保持しないと Worker 側 JWT 検証の aud 不一致でログイン不能になる）。
async function updateAppSessionDuration(env, appId) {
  const cur = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${appId}`);
  const app = cur.result || {};
  if (app.session_duration === DESIRED_SESSION_DURATION) {
    return { changed: false, sessionDuration: app.session_duration };
  }
  const body = { ...app, session_duration: DESIRED_SESSION_DURATION };
  // 読み取り専用メタのみ除去。aud は echo して保持する（消すと JWT 検証が aud 不一致で壊れる）。
  delete body.id;
  delete body.created_at;
  delete body.updated_at;
  await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/apps/${appId}`, {
    method: 'PUT',
    body,
  });
  return { changed: true, sessionDuration: DESIRED_SESSION_DURATION };
}

// グローバル（アカウント全体）の session_duration を DESIRED に揃える。
// これが Access の最外層＝ハード上限。ここが既定24hだとアプリ/ポリシー730hが無効化される。
// PUT /access/organizations は全フィールド置換のため GET の全項目を echo して session_duration
// だけ上書きする（auth_domain / name 等の重要フィールドを保持。auth_domain を失うと壊れる）。
// CF_API_TOKEN に organizations 編集権限が無い間は GET/PUT が Authentication error になるので
// その場合は throw せず skip を返す（sync 全体は継続させる）。
async function updateGlobalSessionDuration(env) {
  let org;
  try {
    const cur = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/organizations`);
    org = cur.result || {};
  } catch (e) {
    // 権限不足（Authentication error）等は致命にせず skip。token に Access:Organizations(Edit) を付ければ有効化される。
    console.warn(`[access-sync] org session read skipped: ${e.message}`);
    return { changed: false, skipped: true, reason: `read failed: ${e.message}` };
  }
  if (org.session_duration === DESIRED_SESSION_DURATION) {
    return { changed: false, sessionDuration: org.session_duration };
  }
  const body = { ...org, session_duration: DESIRED_SESSION_DURATION };
  delete body.created_at;
  delete body.updated_at;
  try {
    await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/access/organizations`, {
      method: 'PUT',
      body,
    });
  } catch (e) {
    console.warn(`[access-sync] org session write skipped: ${e.message}`);
    return { changed: false, skipped: true, reason: `write failed: ${e.message}`, prev: org.session_duration ?? null };
  }
  return { changed: true, sessionDuration: DESIRED_SESSION_DURATION, prev: org.session_duration ?? null };
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
