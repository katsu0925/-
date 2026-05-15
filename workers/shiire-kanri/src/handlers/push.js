import { jsonOk, jsonError } from '../utils/response.js';
import { sendWebPush } from '../utils/web-push.js';

// GET /api/push/vapid → 公開鍵を返す（フロントの applicationServerKey に使う）
export async function getVapidPublicKey(request, env) {
  const pub = env.VAPID_PUBLIC_KEY || '';
  if (!pub) return jsonError('VAPID_PUBLIC_KEY not configured', 500);
  return jsonOk({ publicKey: pub });
}

// POST /api/push/subscribe  body: { endpoint, keys: { p256dh, auth } }
//   PushManager.subscribe() の返り値をそのまま JSON で受け取る
export async function subscribePush(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const sub = body && body.subscription ? body.subscription : body;
  const endpoint = String((sub && sub.endpoint) || '').trim();
  const p256dh = String((sub && sub.keys && sub.keys.p256dh) || '').trim();
  const auth = String((sub && sub.keys && sub.keys.auth) || '').trim();
  if (!endpoint || !p256dh || !auth) return jsonError('invalid subscription', 400);

  const ua = request.headers.get('User-Agent') || '';
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, ua, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      email = excluded.email,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      ua = excluded.ua,
      last_seen_at = excluded.last_seen_at
  `).bind(endpoint, user.email, p256dh, auth, ua, now, now).run();

  // prefs が無ければデフォルト ON で作成
  await env.DB.prepare(`
    INSERT INTO push_prefs (email, on_hassoumachi, on_hassouzumi, updated_at)
    VALUES (?, 1, 1, ?)
    ON CONFLICT(email) DO NOTHING
  `).bind(user.email, now).run();

  return jsonOk({ subscribed: true });
}

// POST /api/push/unsubscribe  body: { endpoint }
export async function unsubscribePush(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const endpoint = String((body && body.endpoint) || '').trim();
  if (!endpoint) return jsonError('endpoint required', 400);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND email = ?')
    .bind(endpoint, user.email).run();
  return jsonOk({ unsubscribed: true });
}

// GET /api/push/prefs
export async function getPushPrefs(request, env, user) {
  const row = await env.DB.prepare(
    'SELECT on_hassoumachi, on_hassouzumi FROM push_prefs WHERE email = ?'
  ).bind(user.email).first();
  // サブスク件数も返す（UI で「この端末で通知ON」表示に使える）
  const cnt = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM push_subscriptions WHERE email = ?'
  ).bind(user.email).first();
  return jsonOk({
    onHassoumachi: row ? !!row.on_hassoumachi : true,
    onHassouzumi:  row ? !!row.on_hassouzumi  : true,
    deviceCount:   (cnt && cnt.c) || 0,
  });
}

// POST /api/push/prefs  body: { onHassoumachi?, onHassouzumi? }
export async function setPushPrefs(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const cur = await env.DB.prepare(
    'SELECT on_hassoumachi, on_hassouzumi FROM push_prefs WHERE email = ?'
  ).bind(user.email).first();
  const onMachi = body.onHassoumachi !== undefined ? (body.onHassoumachi ? 1 : 0)
                                                   : (cur ? cur.on_hassoumachi : 1);
  const onZumi  = body.onHassouzumi  !== undefined ? (body.onHassouzumi  ? 1 : 0)
                                                   : (cur ? cur.on_hassouzumi  : 1);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO push_prefs (email, on_hassoumachi, on_hassouzumi, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      on_hassoumachi = excluded.on_hassoumachi,
      on_hassouzumi  = excluded.on_hassouzumi,
      updated_at     = excluded.updated_at
  `).bind(user.email, onMachi, onZumi, now).run();
  return jsonOk({ saved: true, onHassoumachi: !!onMachi, onHassouzumi: !!onZumi });
}

// POST /api/push/test
//   テスト送信。本人の全端末に「テスト通知」を送る
export async function testPush(request, env, user) {
  const subs = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE email = ?'
  ).bind(user.email).all();
  const list = (subs && subs.results) || [];
  if (list.length === 0) return jsonError('no subscription', 400);

  const vapid = vapidConfig(env);
  if (!vapid) return jsonError('VAPID not configured', 500);

  const payload = JSON.stringify({
    title: 'テスト通知',
    body: '通知設定が有効です（' + new Date().toLocaleTimeString('ja-JP') + '）',
    tag: 'test',
    url: '/?tab=settings',
  });
  let okCount = 0;
  for (const s of list) {
    try {
      const r = await sendWebPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, vapid
      );
      if (r.ok) okCount++;
      if (r.expired) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
      }
    } catch (err) {
      console.warn('[push test] send failed', err.message);
    }
  }
  return jsonOk({ sent: okCount, total: list.length });
}

// ---------- ステータス遷移用の共通配信 ----------
// 状態遷移を検知したときに呼び出す。
// triggerType: 'hassoumachi' | 'hassouzumi'
// payload: { title, body, tag, url, ... }
export async function fanoutByTrigger(env, triggerType, payload) {
  const vapid = vapidConfig(env);
  if (!vapid) {
    console.warn('[push fanout] VAPID not configured');
    return { sent: 0, total: 0 };
  }
  const prefCol = triggerType === 'hassoumachi' ? 'on_hassoumachi' : 'on_hassouzumi';
  // pref が ON のユーザの全端末に配信
  const rows = await env.DB.prepare(`
    SELECT s.endpoint, s.p256dh, s.auth
    FROM push_subscriptions s
    JOIN push_prefs p ON p.email = s.email
    WHERE p.${prefCol} = 1
  `).all();
  const list = (rows && rows.results) || [];
  if (list.length === 0) return { sent: 0, total: 0 };
  const json = JSON.stringify(payload);
  const expired = [];
  let okCount = 0;
  await Promise.all(list.map(async (s) => {
    try {
      const r = await sendWebPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json, vapid
      );
      if (r.ok) okCount++;
      if (r.expired) expired.push(s.endpoint);
    } catch (err) {
      console.warn('[push fanout] send failed', err.message);
    }
  }));
  if (expired.length > 0) {
    // 失効した subscription はまとめて削除
    const placeholders = expired.map(() => '?').join(',');
    try {
      await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`)
        .bind(...expired).run();
    } catch (e) { /* ignore */ }
  }
  return { sent: okCount, total: list.length, expired: expired.length };
}

function vapidConfig(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}
