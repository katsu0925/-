// 同梱（bundled shipping）グループ管理
// スプレッドシートには反映せず Workers KV のみ。3点以上のグループに対応。
//
// KV スキーマ (env.CACHE): utils/bundle-store.js 参照
//   bundle:<groupId>  → JSON: { id, members: ["zA1","zC1",...], updatedAt, main? }
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
//
// #9 KV 非原子 read-modify-write の既知制約:
//   KV には CAS/トランザクションが無いため、同一グループへの並行トグルでは
//   members 取りこぼし（後勝ちで片方のpushが消える）や bundle-of との不整合が
//   理論上起こり得る（orphan-image インシデントと同型）。本機能は KV 専用設計
//   （シート/D1 を経由しない）かつ 外注 9 名による低頻度の手動操作のため、
//   完全な原子化（Durable Object でのシリアライズ）はコスト過大と判断し未導入。
//   代わりに次の二重の緩和でUIへの影響を抑える:
//     (a) writeBundle で members を常に重複排除（並行二重 push の痕跡を消す）
//     (b) listBundles で bundle-of が指すグループに当該 kanri が実在する場合のみ
//         同梱中として返す（dangling な bundle-of ポインタを読取時に自己修復）

import { jsonOk, jsonError } from '../utils/response.js';
// KV プリミティブは write-proxy.js（自動転記 fan-out）と共有するため bundle-store.js に抽出済み
import {
  KEY_RE, canonKanri, readBundle, writeBundle,
  setOf, getOf, removeFromCurrentGroup,
} from '../utils/bundle-store.js';
import { fanoutBundleOnJoin } from './write-proxy.js';

// 同梱追加の成功後、メインの販売/発送/完了情報を新メンバーへ自動転記する。
// waitUntil で応答をブロックせず、失敗してもトグル自体は成立させる。
function kickJoinFanout_(ctx, env, user, kanri) {
  const p = fanoutBundleOnJoin(env, user, kanri).catch(err => {
    console.warn('[bundle toggle] join fanout failed', err && err.message);
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

export async function toggleBundle(request, env, user, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  let kanri = String(body && body.kanri || '').trim();
  let target = body && body.target ? String(body.target).trim() : '';
  if (!KEY_RE.test(kanri)) return jsonError('bad kanri', 400);
  // ケース混在によるグループ分裂を防ぐため、保存前に商品テーブルの正準ケースへ解決
  kanri = await canonKanri(env, kanri);

  // target 無し → 解除のみ
  if (!target) {
    await removeFromCurrentGroup(env, kanri);
    return jsonOk({ removed: true });
  }
  if (!KEY_RE.test(target) && !target.startsWith('g:')) {
    return jsonError('bad target', 400);
  }
  if (!target.startsWith('g:')) target = await canonKanri(env, target);
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
    kickJoinFanout_(ctx, env, user, kanri);
    return jsonOk({ added: true, groupId, members: b.members });
  }

  // 4) 既存グループに追加
  const b = await readBundle(env, groupId);
  if (!b) return jsonError('group not found', 404);
  if (!b.members.includes(kanri)) b.members.push(kanri);
  b.updatedAt = Date.now();
  await writeBundle(env, b);
  await setOf(env, kanri, groupId);
  kickJoinFanout_(ctx, env, user, kanri);
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
    // #9(b): bundle-of は指しているがグループ members に当該 kanri が居ない
    //        （並行トグルの取りこぼしで生じた dangling ポインタ）場合は同梱中扱いしない。
    //        書込はせず読取時にフィルタするだけ（GET でのKV write/二次レース回避）。
    if (!b.members.includes(k)) continue;
    // main: 集約表示（メイン1枚＋同梱バッジ）の基準。無し＝レガシー同梱（現行表示）
    result[k] = { id: b.id, members: b.members, main: b.main || '' };
  }
  return jsonOk({ bundles: result });
}
