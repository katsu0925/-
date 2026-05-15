// 同梱（bundled shipping）グループ管理
// スプレッドシートには反映せず Workers KV のみ。3点以上のグループに対応。
//
// KV スキーマ (env.CACHE):
//   bundle:<groupId>  → JSON: { id, members: ["zA1","zC1",...], updatedAt }
//   bundle-of:<kanri> → groupId （逆引き O(1)）
//
// 操作:
//   POST /api/bundles/toggle  body: { kanri, target }
//     - target が「グループ追加先のメンバー管理番号」または groupId（"g:<uuid>"）。
//       未指定 (target が無い) なら kanri を現グループから外す（=解除）。
//     - target が指定されたら：
//         · target がすでにグループに属していればそのグループに kanri を加える
//         · そうでなければ target と kanri で新グループを作成
//         · kanri が別グループに居たら旧グループから自動的に外す
//   GET /api/bundles?kanris=zA1,zC1,...
//     → { bundles: { "zA1": { id, members:[...] }, ... } }（同梱されてない kanri は省略）
//
// 解除規則:
//   メンバー1人になったグループは自動削除（同梱の意味がないため）

import { jsonOk, jsonError } from '../utils/response.js';

const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

function bundleKey(id) { return 'bundle:' + id; }
function ofKey(kanri)  { return 'bundle-of:' + kanri; }

async function readBundle(env, id) {
  if (!id) return null;
  const raw = await env.CACHE.get(bundleKey(id), 'json');
  if (!raw || !Array.isArray(raw.members)) return null;
  return raw;
}

async function writeBundle(env, b) {
  await env.CACHE.put(bundleKey(b.id), JSON.stringify(b));
}

async function deleteBundle(env, id) {
  await env.CACHE.delete(bundleKey(id));
}

async function setOf(env, kanri, groupId) {
  if (groupId) await env.CACHE.put(ofKey(kanri), groupId);
  else await env.CACHE.delete(ofKey(kanri));
}

async function getOf(env, kanri) {
  return env.CACHE.get(ofKey(kanri));
}

// kanri を既存グループから外す。1人になったらグループ削除。
async function removeFromCurrentGroup(env, kanri) {
  const gid = await getOf(env, kanri);
  if (!gid) return;
  const b = await readBundle(env, gid);
  if (!b) { await setOf(env, kanri, null); return; }
  const next = b.members.filter(m => m !== kanri);
  await setOf(env, kanri, null);
  if (next.length <= 1) {
    // 残り1人以下になるなら全員クリアしてグループ削除
    for (const m of next) await setOf(env, m, null);
    await deleteBundle(env, gid);
  } else {
    b.members = next;
    b.updatedAt = Date.now();
    await writeBundle(env, b);
  }
}

export async function toggleBundle(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body && body.kanri || '').trim();
  const target = body && body.target ? String(body.target).trim() : '';
  if (!KEY_RE.test(kanri)) return jsonError('bad kanri', 400);

  // target 無し → 解除のみ
  if (!target) {
    await removeFromCurrentGroup(env, kanri);
    return jsonOk({ removed: true });
  }
  if (!KEY_RE.test(target) && !target.startsWith('g:')) {
    return jsonError('bad target', 400);
  }
  if (target === kanri) return jsonError('same kanri', 400);

  // 1) target からグループ ID を解決
  let groupId = null;
  if (target.startsWith('g:')) {
    groupId = target.slice(2);
    const b = await readBundle(env, groupId);
    if (!b) return jsonError('group not found', 404);
  } else {
    groupId = await getOf(env, target);
  }

  // 2) kanri が現在所属しているグループから外す（同じグループなら何もしない）
  const currentGid = await getOf(env, kanri);
  if (groupId && currentGid === groupId) {
    // 既に同じグループ → 解除トグル
    await removeFromCurrentGroup(env, kanri);
    return jsonOk({ removed: true, groupId });
  }
  if (currentGid) {
    await removeFromCurrentGroup(env, kanri);
  }

  // 3) target がグループ未所属なら新規作成
  if (!groupId) {
    groupId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    const b = { id: groupId, members: [target, kanri], updatedAt: Date.now() };
    await writeBundle(env, b);
    await setOf(env, target, groupId);
    await setOf(env, kanri, groupId);
    return jsonOk({ added: true, groupId, members: b.members });
  }

  // 4) 既存グループに追加
  const b = await readBundle(env, groupId);
  if (!b) return jsonError('group not found', 404);
  if (!b.members.includes(kanri)) b.members.push(kanri);
  b.updatedAt = Date.now();
  await writeBundle(env, b);
  await setOf(env, kanri, groupId);
  return jsonOk({ added: true, groupId, members: b.members });
}

// バッチ取得: ?kanris=zA1,zC1,... → { bundles: { kanri: { id, members } } }
export async function listBundles(request, env) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('kanris') || '';
  const kanris = raw.split(',').map(s => s.trim()).filter(s => KEY_RE.test(s)).slice(0, 1000);
  if (!kanris.length) return jsonOk({ bundles: {} });

  // bundle-of:<kanri> を並列取得
  const ofs = await Promise.all(kanris.map(k => getOf(env, k).then(v => [k, v])));
  const groupIds = Array.from(new Set(ofs.map(([, g]) => g).filter(Boolean)));
  const bundles = await Promise.all(groupIds.map(id => readBundle(env, id).then(b => [id, b])));
  const byId = {};
  for (const [id, b] of bundles) { if (b) byId[id] = b; }

  const result = {};
  for (const [k, gid] of ofs) {
    if (!gid) continue;
    const b = byId[gid];
    if (!b) continue;
    result[k] = { id: b.id, members: b.members };
  }
  return jsonOk({ bundles: result });
}
