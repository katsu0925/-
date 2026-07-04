// 同梱（bundled shipping）KV プリミティブ
// bundles.js（トグル/一覧 API）と write-proxy.js（自動転記 fan-out）の両方から使うため、
// 循環 import を避けてここに抽出（依存方向: bundles.js → write-proxy.js → bundle-store.js）。
//
// KV スキーマ (env.CACHE):
//   bundle:<groupId>  → JSON: { id, members: ["zA1","zC1",...], updatedAt, main?: "zA1" }
//   bundle-of:<kanri> → groupId （逆引き O(1)）
//
// main: グループ内で最初に販売情報（実価格）を登録した商品＝メイン。
//   自動転記・集約表示の基準。省略可（無し＝レガシー同梱・現行表示のまま）。

export const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function bundleKey(id) { return 'bundle:' + id; }
export function ofKey(kanri)  { return 'bundle-of:' + kanri; }

// 入力された管理番号を商品テーブル(D1)の正準ケースに解決する。
// 同じ商品が zC549/zc549 のように別ケースで KV 登録され、bundle-of/グループが
// 分裂・孤児化する（=「ZC549は2点なのにZC596は4点」表示崩れ）のを根本防止する。
// 商品テーブルに無い番号や D1 不調時は入力をそのまま使う（同梱操作をブロックしない）。
export async function canonKanri(env, kanri) {
  if (!kanri || !env || !env.DB) return kanri;
  try {
    const row = await env.DB
      .prepare('SELECT kanri FROM products WHERE kanri = ?1 COLLATE NOCASE LIMIT 1')
      .bind(kanri)
      .first();
    return (row && row.kanri) ? row.kanri : kanri;
  } catch (e) {
    return kanri;
  }
}

export async function readBundle(env, id) {
  if (!id) return null;
  const raw = await env.CACHE.get(bundleKey(id), 'json');
  if (!raw || !Array.isArray(raw.members)) return null;
  return raw;
}

export async function writeBundle(env, b) {
  // #9(a): 並行トグルで同一 kanri が二重 push された痕跡を消すため、保存前に重複排除
  if (Array.isArray(b.members)) b.members = Array.from(new Set(b.members));
  await env.CACHE.put(bundleKey(b.id), JSON.stringify(b));
}

export async function deleteBundle(env, id) {
  await env.CACHE.delete(bundleKey(id));
}

export async function setOf(env, kanri, groupId) {
  if (groupId) await env.CACHE.put(ofKey(kanri), groupId);
  else await env.CACHE.delete(ofKey(kanri));
}

export async function getOf(env, kanri) {
  return env.CACHE.get(ofKey(kanri));
}

// kanri を既存グループから外す。1人になったらグループ削除。
export async function removeFromCurrentGroup(env, kanri) {
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
    // メインを外したらグループはレガシー扱い（集約表示・自動転記の基準を失う）に戻す
    if (b.main && b.main === kanri) delete b.main;
    await writeBundle(env, b);
  }
}
