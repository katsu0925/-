import { jsonOk, jsonError } from '../utils/response.js';

// AppSheet 互換タブ用の追加 API
// GAS Web App をプロキシする読み書き API（移動報告/返送管理/AI画像判定/作業者/業務シート）

export async function listMoves(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const r = await callGas(env, 'listMoves', { limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [], total: r.total || (r.items ? r.items.length : 0) });
}

export async function createMove(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  const moveId = String(body.moveId || '').trim();
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'createMove', { destination, ids, reporter, moveId }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ created: true, moveId: r.moveId, row: r.row });
}

export async function deleteMove(request, env, user, moveId) {
  const id = String(moveId || '').trim();
  if (!id) return jsonError('moveId required', 400);
  const r = await callGas(env, 'deleteMove', { moveId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, moveId: r.moveId });
}

export async function updateMove(request, env, user, moveId) {
  const id = String(moveId || '').trim();
  if (!id) return jsonError('moveId required', 400);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'updateMove', { moveId: id, destination, ids, reporter }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ updated: true, moveId: r.moveId, row: r.row });
}

export async function deleteReturn(request, env, user, boxId) {
  const id = String(boxId || '').trim();
  if (!id) return jsonError('boxId required', 400);
  const r = await callGas(env, 'deleteReturn', { boxId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, boxId: r.boxId });
}

export async function updateReturn(request, env, user, boxId) {
  const id = String(boxId || '').trim();
  if (!id) return jsonError('boxId required', 400);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  const note = String(body.note || '');
  const count = body.count;
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'updateReturn', { boxId: id, destination, ids, reporter, note, count }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  // 楽観更新: 返送に入れた商品を即 '返品済み' にして候補（filter=shuppinchu）から外す
  await markReturnedInD1_(env, ids);
  return jsonOk({ updated: true, boxId: r.boxId, row: r.row });
}

// 返送作成/更新時、D1 の該当行 status を即 '返品済み' に楽観更新する。
// D1 の status 列は 5 分 Cron 同期まで旧値（出品中）のままで、その間 返送候補
// （app.js onHensouReporterChange の filter=shuppinchu = derived '出品中'）に
// 返送済み商品が出続けてしまう（シート上は既に「返品済み」なのに候補に並ぶ）。
// ここで D1 も即 '返品済み' にすると derived_status が '返品済み' になり候補から外れる。
// GAS の 返送済みステータス変更.gs（EXCLUDED_STATUS_TEXTS）と同じガードで、
// 売却済み・廃棄済み・キャンセル済み・発送待ち・発送済み は上書きしない（＝GAS 側で
// 返品済みにしなかった行は D1 でも変えない）。シートは既に返品済みなので、次回 Cron の
// content_hash 比較でも '返品済み' を書き込み、巻き戻しは起きない。
async function markReturnedInD1_(env, idsCsv) {
  if (!env || !env.DB) return;
  const ids = Array.from(new Set(
    String(idsCsv || '').split(',').map((s) => s.trim()).filter(Boolean)
  ));
  if (!ids.length) return;
  const now = Date.now();
  const chunk = 90; // D1 の bind 変数上限(100)に余裕を持たせる
  for (let i = 0; i < ids.length; i += chunk) {
    const batch = ids.slice(i, i + chunk);
    const ph = batch.map(() => '?').join(',');
    try {
      await env.DB.prepare(
        `UPDATE products SET status = '返品済み', updated_at = ?` +
        `  WHERE kanri IN (${ph})` +
        `    AND status NOT IN ('返品済み','売却済み','廃棄済み','キャンセル済み','発送待ち','発送済み')`
      ).bind(now, ...batch).run();
    } catch (err) {
      console.warn('[markReturnedInD1] d1 optimistic 返品済み failed: ' + err.message);
    }
  }
}

export async function deletePurchase(request, env, user, shiireId) {
  const id = String(shiireId || '').trim();
  if (!id) return jsonError('shiireId required', 400);
  const r = await callGas(env, 'deletePurchase', { shiireId: id }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ deleted: true, shiireId: r.shiireId });
}

// GET /api/purchases/:id/fix-quantity
// 実点数の修正画面の初期表示用。今の点数・管理番号レンジ・登録済み件数を返す。
// 管理者判定は GAS 側（staff_apiFixPurchaseQuantity）が行う。
export async function previewFixPurchaseQuantity(request, env, user, shiireId) {
  const id = String(shiireId || '').trim();
  if (!id) return jsonError('shiireId required', 400);
  const r = await callGas(env, 'fixPurchaseQuantity', { shiireId: id, dryRun: true }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({
    shiireId: r.shiireId, category: r.category, count: r.count,
    assignNum: r.assignNum, rangeStart: r.rangeStart, rangeEnd: r.rangeEnd,
    registered: r.registered,
  });
}

// POST /api/purchases/:id/fix-quantity  body: { correctCount }
// 増やす → 区分の最後尾に補助行を追加（既存の管理番号は1つも動かさない）
// 減らす → 予約レンジの末尾を短縮して欠番化
export async function fixPurchaseQuantity(request, env, user, shiireId) {
  const id = String(shiireId || '').trim();
  if (!id) return jsonError('shiireId required', 400);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const correctCount = parseInt(body.correctCount, 10);
  if (!Number.isFinite(correctCount) || correctCount < 1) return jsonError('正しい点数を入力してください', 400);

  const r = await callGas(env, 'fixPurchaseQuantity', { shiireId: id, correctCount }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);

  // D1 楽観更新（次の Cron で確定するが、画面へ即反映するため）
  try {
    const now = Date.now();
    if (r.mode === 'increase') {
      // 元行は点数・管理番号そのまま。金額/送料/原価だけ按分し直される
      await env.DB.prepare(
        `UPDATE purchases SET amount = ?, shipping = ?, cost = ?, updated_at = ? WHERE shiire_id = ?`
      ).bind(r.amount || 0, r.shipping || 0, r.cost || 0, now, id).run();
      // 差分ぶんの補助行を追加
      if (r.sub && r.sub.shiireId) {
        const s = r.sub;
        await env.DB.prepare(`
          INSERT INTO purchases (shiire_id, date, amount, shipping, planned, place, cost, category,
                                  content, supplier_id, register_user, registered_at, assigned_kanri, processed,
                                  row_num, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(shiire_id) DO UPDATE SET
            amount = excluded.amount, shipping = excluded.shipping, planned = excluded.planned,
            cost = excluded.cost, content = excluded.content,
            assigned_kanri = excluded.assigned_kanri, updated_at = excluded.updated_at
        `).bind(
          s.shiireId, s.date || '', s.amount || 0, s.shipping || 0, s.count || 0,
          s.place || '', s.cost || 0, s.category || '', s.content || '',
          s.supplierId || '', (user && user.name) || '', new Date().toISOString(),
          s.assignNum || '', 1, s.row || 0, now,
        ).run();
      }
    } else if (r.mode === 'decrease') {
      await env.DB.prepare(
        `UPDATE purchases SET planned = ?, cost = ?, assigned_kanri = ?, updated_at = ? WHERE shiire_id = ?`
      ).bind(r.count || 0, r.cost || 0, r.assignNum || '', now, id).run();
    }
  } catch (err) {
    console.warn('[fixPurchaseQuantity] d1 optimistic update failed: ' + err.message);
  }
  // 増やした場合は syncKanriToReport_ が仕入れ数報告シートに補助行を足すので、一覧の KV も捨てる
  await purgeSheetDumpCache(env, '仕入れ数報告', user);

  return jsonOk({
    fixed: true, shiireId: id, mode: r.mode, message: r.message || '',
    origCount: r.origCount, correctCount: r.correctCount,
    assignNum: r.assignNum || '', sub: r.sub || null,
  });
}

export async function listReturns(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const r = await callGas(env, 'listReturns', { limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ items: r.items || [], total: r.total || (r.items ? r.items.length : 0) });
}

export async function createReturn(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const destination = String(body.destination || '').trim();
  const ids = String(body.ids || '').trim();
  const reporter = String(body.reporter || '').trim();
  const registerUser = String(body.registerUser || '').trim();
  const note = String(body.note || '');
  const count = body.count;
  const boxId = String(body.boxId || '').trim();
  if (!destination) return jsonError('destination required', 400);
  if (!ids) return jsonError('ids required', 400);
  const r = await callGas(env, 'createReturn', { destination, ids, reporter, registerUser, note, count, boxId }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  // 楽観更新: 返送に入れた商品を即 '返品済み' にして候補（filter=shuppinchu）から外す
  await markReturnedInD1_(env, ids);
  return jsonOk({ created: true, boxId: r.boxId, row: r.row });
}

// AI 画像判定: D1 mirror がベース。GAS フォールバックは使用しない。
export async function listAiResults(request, env, user) {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  try {
    const stmt = q
      ? env.DB.prepare(
          `SELECT kanri, fields_json, updated_at FROM ai_prefill WHERE LOWER(kanri) LIKE ? OR LOWER(fields_json) LIKE ? ORDER BY updated_at DESC LIMIT ?`
        ).bind('%' + q + '%', '%' + q + '%', limit)
      : env.DB.prepare(
          `SELECT kanri, fields_json, updated_at FROM ai_prefill ORDER BY updated_at DESC LIMIT ?`
        ).bind(limit);
    const { results } = await stmt.all();
    const items = (results || []).map((r) => {
      let fields = {};
      try { fields = JSON.parse(r.fields_json || '{}') || {}; } catch {}
      return { kanri: r.kanri, fields, updatedAt: r.updated_at };
    });
    return jsonOk({ items, total: items.length });
  } catch (err) {
    return jsonError('d1 error: ' + err.message, 500);
  }
}

export async function listSagyousha(request, env, user) {
  const url = new URL(request.url);
  const months = Math.min(12, Math.max(1, parseInt(url.searchParams.get('months'), 10) || 6));
  const r = await callGas(env, 'listSagyousha', { months }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({
    items: r.items || [],
    months: r.months || [],
    currentUser: r.currentUser || { email: (user && user.email) || '', isAdmin: false },
  });
}

export async function saveSagyousha(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const row = parseInt(body.row, 10);
  if (!row || row < 2) return jsonError('row required', 400);
  const payload = {
    row,
    name: typeof body.name === 'string' ? body.name : undefined,
    email1: typeof body.email1 === 'string' ? body.email1 : undefined,
    email2: typeof body.email2 === 'string' ? body.email2 : undefined,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    admin: typeof body.admin === 'boolean' ? body.admin : undefined,
  };
  const r = await callGas(env, 'saveSagyousha', payload, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ saved: true, row: r.row });
}

export async function createSagyousha(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const name = String(body.name || '').trim();
  if (!name) return jsonError('name required', 400);
  const payload = {
    name,
    email1: String(body.email1 || ''),
    email2: String(body.email2 || ''),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    admin: body.admin === true,
  };
  const r = await callGas(env, 'createSagyousha', payload, user);
  if (!r.ok) return jsonError(r.error || 'gas error', r.error && r.error.indexOf('管理者') >= 0 ? 403 : 502);
  return jsonOk({ created: true, row: r.row });
}

// 読み取り頻度の高いシートはエッジ KV にキャッシュし、GAS 往復（実測 2〜4秒）を省く。
// キャッシュ粒度はシートごとに変える:
//   'global' … 誰が引いても同じ内容が返る（GAS 側で本人フィルタが掛からない）→ 1本のキーを全員で共有
//   'user'  … staff_dumpSheet(StaffApiExtras.gs:837) が非管理者に本人フィルタを掛ける
//             → メールごとにキーを分ける。共有キーにすると管理者が引いた全件（他人の報酬）が
//               非管理者へそのまま配られてしまうため必須。
// クライアントから ?fresh=1 で強制再取得可能。
// ttl を過ぎても KV からは消さず（物理TTL = SHEET_DUMP_HOLD）、古い値を即返しつつ
// 裏で作り直す（stale-while-revalidate）。user スコープは Cron で暖機できないので、
// これが無いと各自 ttl ごとに GAS 往復を待たされる。
const SHEET_DUMP_CACHE = {
  // 5分Cron(warmSheetDumpCache)が先回りで温めるので基本は常にヒットする。
  // 数量送信時は purgeSheetDumpCache で即時に捨てるため、古い一覧は残らない。
  '仕入れ数報告': { scope: 'global', ttl: 600 },
  // 自分の申請は appendKeihi が purge する。管理者は他人の申請も見えるので ttl は短め
  // （stale 配信のおかげで ttl を短くしても待ち時間は増えず、裏の GAS 呼び出しが増えるだけ）。
  '経費申請':     { scope: 'user',   ttl: 120 },
  // 日次の updateRewardsNoFormula で更新されるので数分のラグは許容。
  '報酬管理':     { scope: 'user',   ttl: 300 },
};
// 期限切れ後も stale 配信のために保持しておく時間。
const SHEET_DUMP_HOLD = 86400;
// GAS へは常に上限件数で取りに行き、返却時に必要な件数だけ切り出す。
// キーに limit を含めないので purge / warm が1本のキーで済む（rows は新しい順なので先頭から切る）。
const SHEET_DUMP_MAX = 500;
// ①多層防御: フロント(BUSINESS_SHEETS)が実際に要求する3シートのみ Worker で通す。
//   これ以外のシート名を GAS へ渡さないことで、任意シート閲覧の入口を塞ぐ。
//   本人フィルタ・管理者判定は GAS(staff_dumpSheet)が正だが、その手前でも名前を絞る。
const DUMP_ALLOWED_SHEETS = { '仕入れ数報告': true, '経費申請': true, '報酬管理': true };

function sheetDumpCacheKey_(name, user) {
  const conf = SHEET_DUMP_CACHE[name];
  if (!conf) return '';
  if (conf.scope === 'user') return 'sheet-dump:' + name + ':u:' + ((user && user.email) || '-');
  return 'sheet-dump:' + name;
}

// 書き込み後に呼ぶ。捨てておかないと TTL が切れるまで古い一覧が返り続ける。
export async function purgeSheetDumpCache(env, name, user) {
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  const key = sheetDumpCacheKey_(name, user);
  if (!kv || !key) return;
  try { await kv.delete(key); } catch {}
}

// GAS から引き直して KV に入れ直す。stale 配信の裏側と暖機の共通処理。
async function refillSheetDump_(env, name, user, cacheKey) {
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  const r = await callGas(env, 'dumpSheet', { name, limit: SHEET_DUMP_MAX }, user);
  if (!r.ok) throw new Error(r.error || 'gas error');
  const payload = { headers: r.headers || [], rows: r.rows || [], total: r.total || 0, ts: Date.now() };
  if (kv && cacheKey) {
    try { await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: SHEET_DUMP_HOLD }); } catch {}
  }
  return payload;
}

// 5分Cron から呼ぶ暖機。global スコープのシートのみ（user スコープは誰の分か決められない）。
export async function warmSheetDumpCache(env) {
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  if (!kv) return;
  for (const name of Object.keys(SHEET_DUMP_CACHE)) {
    if (SHEET_DUMP_CACHE[name].scope !== 'global') continue;
    try {
      await refillSheetDump_(env, name, null, sheetDumpCacheKey_(name, null));
    } catch (err) {
      console.warn('[warmSheetDumpCache] ' + name + ': ' + err.message);
    }
  }
}

export async function dumpSheet(request, env, user, name, ctx) {
  if (!DUMP_ALLOWED_SHEETS[name]) return jsonError('forbidden', 403);
  const url = new URL(request.url);
  const limit = Math.min(SHEET_DUMP_MAX, Math.max(10, parseInt(url.searchParams.get('limit'), 10) || 200));
  const fresh = url.searchParams.get('fresh') === '1';
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  const conf = SHEET_DUMP_CACHE[name];
  const cacheKey = sheetDumpCacheKey_(name, user);
  if (kv && cacheKey && !fresh) {
    try {
      const hit = await kv.get(cacheKey, 'json');
      if (hit && Array.isArray(hit.headers)) {
        const stale = (Date.now() - (hit.ts || 0)) >= conf.ttl * 1000;
        // 期限切れでも待たせず古い値を返し、更新はレスポンス後に回す。
        if (stale && ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(refillSheetDump_(env, name, user, cacheKey).catch(function(err){
            console.warn('[dumpSheet revalidate] ' + name + ': ' + err.message);
          }));
        }
        return jsonOk({ headers: hit.headers, rows: (hit.rows || []).slice(0, limit), total: hit.total || 0, cached: true, stale });
      }
    } catch {}
  }
  if (kv && cacheKey) {
    let payload;
    try { payload = await refillSheetDump_(env, name, user, cacheKey); }
    catch (err) { return jsonError(err.message || 'gas error', 502); }
    return jsonOk({ headers: payload.headers, rows: payload.rows.slice(0, limit), total: payload.total });
  }
  const r = await callGas(env, 'dumpSheet', { name, limit }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ headers: r.headers || [], rows: r.rows || [], total: r.total || 0 });
}

// ?id=xxx&fmt=json で GAS doGet からタイトル・説明文を取得
// （Code.gs:doGet が組み立てる generatedTitle / description を JSON で受け取る）
// KV キャッシュ（24h）で 2 回目以降はミリ秒応答にする。
// 5分Cron で出品準備フェーズの商品を先回りウォーム + 商品データ変化時に invalidate するため、
// 古い説明文が出回るリスクは低い（最悪 5 分以内に Cron が拾う）。
const LISTING_TEXT_TTL = 86400;
export async function getListingText(request, env, user, kanri) {
  const id = String(kanri || '').trim();
  if (!id) return jsonError('kanri required', 400);
  const cacheKey = 'listing-text:' + id;
  const kv = env.CACHE || env.GAS_PROXY_CACHE;
  // KV ヒット → D1 の追加項目（伸縮性/生地の厚み/裏地）を post-cache 注入して返却
  if (kv) {
    try {
      const hit = await kv.get(cacheKey, 'json');
      if (hit && typeof hit.title === 'string' && typeof hit.description === 'string') {
        const desc = await injectExtraDescription_(env, id, hit.description);
        return jsonOk({ id, title: hit.title, description: desc, cached: true });
      }
    } catch {}
  }
  const base = String(env.GAS_API_URL || '');
  if (!base) return jsonError('GAS_API_URL not configured', 500);
  // KV 未ヒット時は GAS 側 CacheService 10分 もバイパスする（Cron invalidate 後に古い説明文が残らないように）。
  const target = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(id) + '&fmt=json&nocache=1';
  let res;
  try {
    res = await getFollowingRedirects(target);
  } catch (err) {
    return jsonError('gas fetch[listingText]: ' + err.message, 502);
  }
  if (!res.ok) return jsonError('gas http ' + res.status + '[listingText]', 502);
  let text = '';
  try { text = await res.text(); } catch { return jsonError('gas read fail[listingText]', 502); }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return jsonError('gas non-json[listingText]: ' + hint, 502);
  }
  if (!parsed || parsed.ok !== true) {
    return jsonError(String((parsed && parsed.error) || 'gas error'), 502);
  }
  const out = {
    title: String(parsed.title || ''),
    description: String(parsed.description || ''),
  };
  // KV にはスプレッドシート由来のオリジナル description を保存（D1 追加項目は post-cache 注入する）
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(out), { expirationTtl: LISTING_TEXT_TTL }); } catch {}
  }
  const desc = await injectExtraDescription_(env, id, out.description);
  return jsonOk({ id: parsed.id || id, title: out.title, description: desc });
}

// D1 の extra_json から 伸縮性 / 生地の厚み / 裏地 を取り出し、
// description の「透け感：…」行の直後に挿入する。
// 取れなければ何もしない（GAS 由来テキストをそのまま返す）。
async function injectExtraDescription_(env, kanri, description) {
  if (!env || !env.DB) return description;
  let extra = {};
  try {
    const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
    if (cur && cur.extra_json) extra = JSON.parse(cur.extra_json) || {};
  } catch { return description; }
  const lines = [];
  const stretch = String(extra['伸縮性'] || '').trim();
  const thick = String(extra['生地の厚み'] || '').trim();
  const lining = String(extra['裏地'] || '').trim();
  if (stretch) lines.push('伸縮性：' + stretch);
  if (thick)   lines.push('生地の厚み：' + thick);
  if (lining)  lines.push('裏地：' + lining);
  if (lines.length === 0) return description;
  const insert = lines.join('\n') + '\n';
  // 1) 透け感行の直後（一番自然なデザイン・特徴ブロック内）
  if (/透け感：[^\n]*\n/.test(description)) {
    return description.replace(/(透け感：[^\n]*\n)/, '$1' + insert);
  }
  // 2) ポケット行の直後（透け感が無くてもデザイン・特徴内に収まる）
  if (/ポケット：[^\n]*\n/.test(description)) {
    return description.replace(/(ポケット：[^\n]*\n)/, '$1' + insert);
  }
  // 3) ☆状態詳細 セクションの直前にデザイン・特徴ミニブロックとして挿入
  if (/☆状態詳細/.test(description)) {
    return description.replace(/(☆状態詳細)/, '☆デザイン・特徴\n' + insert + '\n$1');
  }
  // 4) お願い文（・保管上または…）の直前
  if (/・保管上または/.test(description)) {
    return description.replace(/(・保管上または)/, '☆デザイン・特徴\n' + insert + '\n$1');
  }
  return description + (description.endsWith('\n') ? '' : '\n') + insert;
}

// 経費申請レシート画像: dataUrl を GAS の Drive '経費_Images' に保存して URL を返す
// kanri を必要としない汎用画像アップロード（商品管理の保存とは別ライン）
export async function uploadKeihiImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const dataUrl = String(body.dataUrl || '');
  const name = String(body.name || '').trim();
  if (!dataUrl) return jsonError('dataUrl required', 400);
  if (!/^data:image\//.test(dataUrl)) return jsonError('dataUrl must be image data url', 400);
  const r = await callGas(env, 'uploadKeihiImage', { dataUrl, name }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  return jsonOk({ url: r.url, fileName: r.fileName });
}

// 経費申請: SPA から本人申請を受けて GAS appendKeihi を呼ぶ
// GAS の sh.appendRow は 1-3 秒かかるので、検証通過後は ctx.waitUntil() で
// fire-and-forget して 200 を即時返却する。シート反映は数秒遅れる前提。
export async function appendKeihi(request, env, user, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const name = String(body.name || '').trim();
  const itemName = String(body.itemName || '').trim();
  const amount = Number(body.amount || 0);
  const outsourceCost = Number(body.outsourceCost || 0);
  if (!name) return jsonError('name required', 400);
  if (!itemName) return jsonError('itemName required', 400);
  if (outsourceCost <= 0 && (!amount || amount <= 0)) return jsonError('amount must be positive', 400);
  const payload = {
    name,
    purchaseDate: String(body.purchaseDate || '').trim(),
    itemName,
    place: String(body.place || '').trim(),
    placeLink: String(body.placeLink || '').trim(),
    amount,
    outsourceCost,
    receipt: String(body.receipt || '').trim(),
  };
  const job = (async () => {
    const r = await callGas(env, 'appendKeihi', payload, user);
    if (!r.ok) { console.error('[appendKeihi waitUntil] gas error: ' + (r.error || 'unknown')); return; }
    // 行が入った後に捨てる（先に捨てると追加前の一覧でキャッシュが埋め直される）
    await purgeSheetDumpCache(env, '経費申請', user);
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else await job;
  return jsonOk({ submitted: true, queued: true });
}

// 仕入れ数報告: SPA から数量送信 → GAS で行更新 + Phase2 マージ
export async function updateShiireHoukokuQuantity(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const id = String(body.id || '').trim();
  const quantity = parseInt(body.quantity, 10);
  if (!id) return jsonError('id required', 400);
  if (!quantity || quantity <= 0) return jsonError('quantity must be positive', 400);
  const r = await callGas(env, 'updateShiireHoukokuQuantity', { id, quantity }, user);
  if (!r.ok) return jsonError(r.error || 'gas error', 502);
  // 送信直後に一覧を引き直しても古い「未処理」カードが返らないよう、KV を捨てる
  await purgeSheetDumpCache(env, '仕入れ数報告', user);
  return jsonOk({ saved: true, id: r.id, row: r.row, quantity: r.quantity });
}

async function getFollowingRedirects(url) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { method: 'GET', redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    current = loc;
  }
  throw new Error('too many redirects');
}

async function callGas(env, action, payload, user) {
  const body = JSON.stringify({
    action,
    secret: env.SYNC_SECRET,
    email: (user && user.email) || '',
    payload,
  });
  let res;
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, body);
  } catch (err) {
    return { ok: false, error: 'gas fetch[' + action + ']: ' + err.message };
  }
  if (!res.ok) return { ok: false, error: 'gas http ' + res.status + '[' + action + ']' };
  let text = '';
  try { text = await res.text(); } catch { return { ok: false, error: 'gas read fail[' + action + ']' }; }
  try { return JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return { ok: false, error: 'gas non-json[' + action + ']: ' + hint };
  }
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
