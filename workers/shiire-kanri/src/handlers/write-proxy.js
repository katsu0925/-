import { jsonOk, jsonError } from '../utils/response.js';
import { invalidateCountsCache, DERIVED_STATUS } from './products.js';
import { fanoutByTrigger } from './push.js';
import { getOf, readBundle, writeBundle } from '../utils/bundle-store.js';

// POST /api/save/measurement  body: { kanri, measure: {着丈, 肩幅, ...} }
// POST /api/save/sale         body: { kanri, sale: {salePrice, saleDate, salePlace, saleShipping, saleFee} }

// Fire-and-forget: D1 を先に更新→即 200 を返却→裏で GAS にシート反映を投入
export async function saveMeasurement(request, env, user, ctx) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const measure = body.measure || {};
  if (!kanri) return jsonError('kanri required', 400);

  const __td1 = Date.now();
  try {
    const measuredAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE products SET measure_json = ?, measured_at = ?, measured_by = ?, updated_at = ?
      WHERE kanri = ?
    `).bind(JSON.stringify(measure), measuredAt, user.email, Date.now(), kanri).run();
  } catch (err) {
    console.warn('[save measurement] d1 update failed', err.message);
  }

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(dispatchGasSaveMeasurement_(env, user, kanri, measure));
  } else {
    dispatchGasSaveMeasurement_(env, user, kanri, measure).catch(() => {});
  }

  const t = { d1: Date.now() - __td1, total: Date.now() - __t0 };
  invalidateCountsCache();
  return jsonOk({ saved: true, optimistic: true }, { 'Server-Timing': buildServerTiming(t) });
}

async function dispatchGasSaveMeasurement_(env, user, kanri, measure) {
  let gasRes;
  try {
    gasRes = await callGas(env, 'saveMeasurement', { kanri, measure }, user);
  } catch (err) {
    console.warn('[save measurement bg] gas exception', err.message);
    await logSaveFailure_(env, user, kanri, { measure }, 'exception:' + err.message);
    return;
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[save measurement bg] gas failed', reason);
    await logSaveFailure_(env, user, kanri, { measure }, reason);
  }
}

// Fire-and-forget: D1 を先に更新→即 200 を返却→裏で GAS にシート反映を投入
// Push 通知（発送待ち）は GAS round-trip 後に発火する。GAS staff_apiSaveSale が
// IFS 式でステータスを再計算し、販売日入力で「出品中→発送待ち」へ遷移するため、
// その遷移を信頼源（GAS が返す status）で検知して fanout する。
export async function saveSale(request, env, user, ctx) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const sale = body.sale || {};
  if (!kanri) return jsonError('kanri required', 400);

  // Push 遷移検知用に、保存前の派生ステータスと仕入れID を取得しておく
  // （発送待ち Push の本文で納品場所を JOIN するため shiire_id も拾う）。
  let oldDerivedStatus = '';
  let oldShiireId = '';
  try {
    const cur = await env.DB.prepare(
      `SELECT shiire_id, ${DERIVED_STATUS} AS derived_status FROM products WHERE kanri = ?`
    ).bind(kanri).first();
    oldDerivedStatus = (cur && cur.derived_status) ? String(cur.derived_status) : '';
    oldShiireId = (cur && cur.shiire_id) ? String(cur.shiire_id) : '';
  } catch (err) {
    console.warn('[save sale] derived status fetch failed', err.message);
  }

  const __td1 = Date.now();
  try {
    await env.DB.prepare(`
      UPDATE products SET
        sale_date = ?, sale_place = ?, sale_price = ?, sale_shipping = ?, sale_fee = ?,
        updated_at = ?
      WHERE kanri = ?
    `).bind(
      String(sale.saleDate || ''),
      String(sale.salePlace || ''),
      Number(sale.salePrice || 0),
      Number(sale.saleShipping || 0),
      Number(sale.saleFee || 0),
      Date.now(),
      kanri,
    ).run();
  } catch (err) {
    console.warn('[save sale] d1 update failed', err.message);
  }

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(dispatchGasSaveSale_(env, user, kanri, sale, oldDerivedStatus, oldShiireId));
  } else {
    dispatchGasSaveSale_(env, user, kanri, sale, oldDerivedStatus, oldShiireId).catch(() => {});
  }

  const t = { d1: Date.now() - __td1, total: Date.now() - __t0 };
  invalidateCountsCache();
  return jsonOk({ saved: true, optimistic: true }, { 'Server-Timing': buildServerTiming(t) });
}

async function dispatchGasSaveSale_(env, user, kanri, sale, oldDerivedStatus, oldShiireId) {
  // フロントは saleDate/salePlace/salePrice/saleShipping/saleFee で送る。
  // GAS は sale.date/place/price/shipping/fee を期待する。ここで吸収。
  const saleForGas = {
    date: sale.saleDate,
    place: sale.salePlace,
    price: sale.salePrice,
    shipping: sale.saleShipping,
    fee: sale.saleFee,
  };
  let gasRes;
  try {
    gasRes = await callGas(env, 'saveSale', { kanri, sale: saleForGas }, user);
  } catch (err) {
    console.warn('[save sale bg] gas exception', err.message);
    await logSaveFailure_(env, user, kanri, { sale }, 'exception:' + err.message);
    return;
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[save sale bg] gas failed', reason);
    await logSaveFailure_(env, user, kanri, { sale }, reason);
    return;
  }

  // GAS が IFS 式で再計算したステータス（販売日入力後は通常「発送待ち」）を信頼源にする。
  // saveSale の optimistic update は sale_* 列しか触れていないため、status 列はここで確定反映する。
  const newStatus = String((gasRes && gasRes.status) || '').trim();
  if (newStatus) {
    try {
      await env.DB.prepare('UPDATE products SET status = ?, updated_at = ? WHERE kanri = ?')
        .bind(newStatus, Date.now(), kanri).run();
    } catch (err) {
      console.warn('[save sale bg] d1 status reconcile failed', err.message);
    }
  }

  // ステータス遷移（→発送待ち / →発送済み）を検知して Push 配信。
  // 販売処理は通常「出品中→発送待ち」なので 発送待ち Push が発送担当全員に飛ぶ。
  // mergedExtra は null 渡し（納品場所は purchases JOIN、販売価格は products.sale_price で補完される）。
  try {
    if (newStatus && newStatus !== oldDerivedStatus) {
      await maybePushOnStatusChange_(env, kanri, oldDerivedStatus, newStatus, null, oldShiireId);
    }
  } catch (err) {
    console.warn('[save sale bg] push fanout failed', err.message);
  }
}

// POST /api/save/details  body: { kanri, fields: { 'ヘッダー名': 値, ... } }
// 任意のヘッダーキーで商品管理シートを部分更新する汎用エンドポイント
//
// ★ Day 3: Fire-and-forget UX
//   1. D1 を fields で楽観更新（~50ms）
//   2. 即 200 を返却（体感 ~100ms）
//   3. ctx.waitUntil で GAS にバックグラウンド投入（~4-5秒、ユーザは待たない）
//   4. GAS が record を返したら D1 を再更新（派生値の確定反映）
//   5. GAS 失敗時は KV にエラーログを残す（次の Cron 同期 or 手動リトライで救済）
export async function saveDetails(request, env, user, ctx) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const fields = body.fields || {};
  if (!kanri) return jsonError('kanri required', 400);
  const keys = Object.keys(fields);
  if (keys.length === 0) return jsonError('fields required', 400);

  const __td1 = Date.now();
  let optimisticExtra = null;
  let oldDerivedStatus = '';
  let oldShiireId = '';
  try {
    // 派生ステータスは DERIVED_STATUS で同時に取得（販売日入力で「発送待ち」に
    // 自動遷移するパスを検知するため、raw status だけでは不十分）。
    const cur = await env.DB.prepare(
      `SELECT extra_json, shiire_id, ${DERIVED_STATUS} AS derived_status
       FROM products WHERE kanri = ?`
    ).bind(kanri).first();
    oldDerivedStatus = (cur && cur.derived_status) ? String(cur.derived_status) : '';
    oldShiireId = (cur && cur.shiire_id) ? String(cur.shiire_id) : '';
    let extra = {};
    if (cur && cur.extra_json) {
      try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
    }
    for (const k of keys) {
      const v = fields[k];
      extra[k] = v == null ? '' : String(v);
    }
    optimisticExtra = extra;
    await applyDetailColumns_(env, kanri, fields, extra);
  } catch (err) {
    console.warn('[save details] d1 optimistic update failed', err.message);
  }

  // 裏で GAS に投入（waitUntil なら fetch 終了後も走り続ける）
  // Push 通知（発送待ち / 発送済み）は GAS の derivedStatus を信頼源として
  // GAS round-trip 後に発火する。理由:
  //   - 販売日のみ入力ケースでは raw status の遷移を D1 だけでは判定できず、
  //     GAS 側 staff_calcStatus_ が AppSheet IFS を再計算した結果に依存する
  //   - 反映遅延は ~5秒だがフォアグラウンドの保存は即時 200 を返すので UX は変わらない
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(dispatchGasSaveDetails_(env, user, kanri, fields, oldDerivedStatus, oldShiireId));
    // 同梱グループへの自動転記（メインの販売/発送/完了保存をメンバーへ伝播）。
    // 失敗してもメイン保存には影響させない（fanoutBundleAfterSave 内で握り潰し済み）。
    ctx.waitUntil(fanoutBundleAfterSave(env, user, kanri, fields));
  } else {
    // ctx 未渡しの保険（通常は通らない）
    dispatchGasSaveDetails_(env, user, kanri, fields, oldDerivedStatus, oldShiireId).catch(() => {});
    fanoutBundleAfterSave(env, user, kanri, fields).catch(() => {});
  }

  const t = { d1: Date.now() - __td1, total: Date.now() - __t0 };
  invalidateCountsCache();
  return jsonOk({
    saved: true,
    optimistic: true,                    // フロントが「派生値はまだ来てない」と判断するためのヒント
    record: optimisticExtra || null,     // mergeRecordIntoItem_ 用（user 入力分のみ）
  }, { 'Server-Timing': buildServerTiming(t) });
}

// 専用カラム更新を共通化（保存と GAS 確定後の reconcile 両方で使う）
async function applyDetailColumns_(env, kanri, fields, mergedExtra, derivedStatus) {
  // #6: extra_json は全体上書き(= extra_json = ?)をやめ、json_patch で mergedExtra のキーだけを
  //     マージ更新する。全体上書きだと SELECT〜UPDATE の隙間に uploadImage の atomic 書き込みが
  //     書いた画像URLキー（こちらの SELECT スナップショットには写っていない）を丸ごと消してしまう
  //     （過去の orphan-image / image-clobber インシデントと同型の lost-update レース）。
  //     json_patch なら mergedExtra に含まれるキーのみ set し、他キー（並行で書かれた画像URL等）は保持。
  //     ※ saveDetails / reconcile / uploadImage はいずれも extra_json のキーを追加・更新するのみで
  //       削除しないため、全体上書きと結果は等価。
  const sets = [];
  const args = [];
  const extraEntries = Object.entries(mergedExtra || {});
  if (extraEntries.length) {
    // #7: 旧実装は mergedExtra の各キーを json_set(?, ?) で連結し「2 バインド変数 × キー数」を消費していた。
    //     extra_json は約70キーまで育つため 1 クエリで 140 変数超 → D1 の「1 クエリ100 バインド変数」上限を突破し
    //     UPDATE が SQLITE_ERROR[7500] で例外 → 呼び出し側 try/catch で握り潰され、楽観書き込み・reconcile の
    //     D1 反映が毎回サイレント失敗していた（保存後にリンク/出品日が消える事象の真因）。
    //     json_patch(現値, ?) なら patch オブジェクト全体を 1 変数で渡せるため上限に当たらない。
    //     json_patch は patch に含まれるキーのみ set し、未含有キー（並行で書かれた画像URL等）は保持するので
    //     #6 の lost-update 対策はそのまま維持される。
    //     json_patch は値が null のキーを削除扱いにするため、null→'' に正規化して「空文字で set」に揃える。
    const patch = {};
    for (const [k, v] of extraEntries) {
      patch[k] = (v == null) ? '' : v;
    }
    sets.push("extra_json = json_patch(COALESCE(extra_json, '{}'), ?)");
    args.push(JSON.stringify(patch));
  }
  sets.push('updated_at = ?'); args.push(Date.now());
  function push(col, val) { sets.push(`${col} = ?`); args.push(val); }

  // status: 引数 derivedStatus（GAS 再計算）優先、無ければ fields の値
  if (derivedStatus !== undefined && derivedStatus !== null && derivedStatus !== '') {
    push('status', String(derivedStatus));
  } else if (fields['ステータス'] !== undefined) {
    push('status', String(fields['ステータス'] || ''));
  }

  function pickFromFieldsOrExtra(name) {
    if (fields && fields[name] !== undefined) return fields[name];
    if (mergedExtra && mergedExtra[name] !== undefined) return mergedExtra[name];
    return undefined;
  }
  const state = pickFromFieldsOrExtra('状態');
  if (fields['状態'] !== undefined) push('state', String(state || ''));
  const brand = pickFromFieldsOrExtra('ブランド');
  if (fields['ブランド'] !== undefined) push('brand', String(brand || ''));
  const size = pickFromFieldsOrExtra('メルカリサイズ');
  if (fields['メルカリサイズ'] !== undefined) push('size', String(size || ''));
  const color = pickFromFieldsOrExtra('カラー');
  if (fields['カラー'] !== undefined) push('color', String(color || ''));
  const saleDate = pickFromFieldsOrExtra('販売日');
  if (fields['販売日'] !== undefined) push('sale_date', String(saleDate || ''));
  const salePlace = pickFromFieldsOrExtra('販売場所');
  if (fields['販売場所'] !== undefined) push('sale_place', String(salePlace || ''));
  if (fields['販売価格'] !== undefined) {
    const n = Number(fields['販売価格']);
    push('sale_price', Number.isFinite(n) ? n : null);
  }
  if (fields['送料'] !== undefined) {
    const n = Number(fields['送料']);
    push('sale_shipping', Number.isFinite(n) ? n : null);
  }
  if (fields['手数料'] !== undefined) {
    const n = Number(fields['手数料']);
    push('sale_fee', Number.isFinite(n) ? n : null);
  }
  args.push(kanri);
  await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE kanri = ?`).bind(...args).run();
}

// バックグラウンドで GAS に saveDetails を投入し、返ってきた record で D1 を確定反映する
// reconcile 後に Push 通知（発送待ち/発送済み 遷移）も発火させる
// opts.suppressPush: 同梱メンバーへの自動転記時に true（1販売でN通のPushが飛ぶのを防ぎ、メインの1通だけにする）
// opts.suppressFailureLog: savefail 再送Cron から呼ぶ時に true（失敗しても savefail を二重記録しない）
// 戻り値: GAS reconcile が成功したら true、失敗（例外/ok=false）なら false。呼び出し側の再送判定に使う。
async function dispatchGasSaveDetails_(env, user, kanri, fields, oldDerivedStatus, oldShiireId, opts = {}) {
  let gasRes;
  try {
    gasRes = await callGas(env, 'saveDetails', { kanri, fields }, user);
  } catch (err) {
    console.warn('[save details bg] gas exception', err.message);
    if (!opts.suppressFailureLog) await logSaveFailure_(env, user, kanri, fields, 'exception:' + err.message);
    return false;
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[save details bg] gas failed', reason);
    if (!opts.suppressFailureLog) await logSaveFailure_(env, user, kanri, fields, reason);
    return false;
  }
  // record があれば D1 を再更新（派生値の確定反映）
  const record = (gasRes.record && typeof gasRes.record === 'object') ? gasRes.record : null;
  let mergedExtra = null;
  if (record) {
    try {
      const cur = await env.DB.prepare('SELECT extra_json FROM products WHERE kanri = ?').bind(kanri).first();
      let extra = {};
      if (cur && cur.extra_json) {
        try { extra = JSON.parse(cur.extra_json) || {}; } catch { extra = {}; }
      }
      for (const k of Object.keys(record)) {
        const v = record[k];
        extra[k] = v == null ? '' : v;
      }
      mergedExtra = extra;
      // reconcile 時は GAS の derivedStatus を最優先 + 専用カラムは record から拾う
      const reconcileFields = {};
      for (const name of ['ステータス', '状態', 'ブランド', 'メルカリサイズ', 'カラー', '販売日', '販売場所', '販売価格', '送料', '手数料']) {
        if (record[name] !== undefined) reconcileFields[name] = record[name];
      }
      await applyDetailColumns_(env, kanri, reconcileFields, extra, gasRes.derivedStatus);
    } catch (err) {
      console.warn('[save details bg] d1 reconcile failed', err.message);
    }
  }

  // Push 通知: GAS の derivedStatus を信頼源にして遷移を判定する
  // 販売日のみ入力で raw='出品中'→'発送待ち' に変わるケースは D1 単独では検知できないため、
  // ここで GAS round-trip 後に判定する。
  try {
    if (!opts.suppressPush) {
      const newDerivedStatus = String((gasRes && gasRes.derivedStatus) || '').trim();
      if (newDerivedStatus && newDerivedStatus !== oldDerivedStatus) {
        await maybePushOnStatusChange_(env, kanri, oldDerivedStatus, newDerivedStatus, mergedExtra, oldShiireId);
      }
    }
  } catch (err) {
    console.warn('[save details bg] push fanout failed', err.message);
  }
  return true;
}

// ステータス遷移を検知して Push 配信（発送待ち / 発送済み への遷移時）
// oldDerivedStatus: 保存前の派生ステータス（D1 から取得済み）
// newDerivedStatus: 保存後の派生ステータス（GAS の derivedStatus を信頼源にする）
// mergedExtra: GAS record と D1 をマージ済みの最新 extra
// shiireId: 通知メッセージで納品場所を JOIN するためのキー
//
// 呼び出し側で oldDerivedStatus !== newDerivedStatus を確認済みの前提
async function maybePushOnStatusChange_(env, kanri, oldDerivedStatus, newDerivedStatus, mergedExtra, shiireId) {
  try {
    if (!newDerivedStatus) return;
    if (newDerivedStatus === oldDerivedStatus) return;

    let trigger = '';
    if (newDerivedStatus === '発送待ち') trigger = 'hassoumachi';
    else if (newDerivedStatus === '発送済み') trigger = 'hassouzumi';
    else return;

    const extra = mergedExtra || {};
    let payload;
    if (trigger === 'hassoumachi') {
      // 納品場所: extra['納品場所'] → 無ければ purchases.place を JOIN で取得
      let place = String(extra['納品場所'] || '').trim();
      if (!place && shiireId) {
        try {
          const p = await env.DB.prepare('SELECT place FROM purchases WHERE shiire_id = ?')
            .bind(shiireId).first();
          place = (p && p.place) ? String(p.place) : '';
        } catch (_) {}
      }
      // 販売価格: extra['販売価格'] → 無ければ products.sale_price
      let priceNum = Number(extra['販売価格']);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        try {
          const r = await env.DB.prepare('SELECT sale_price FROM products WHERE kanri = ?')
            .bind(kanri).first();
          if (r && Number.isFinite(Number(r.sale_price))) priceNum = Number(r.sale_price);
        } catch (_) {}
      }
      const lines = [];
      if (place) lines.push('納品場所: ' + place);
      if (Number.isFinite(priceNum) && priceNum > 0) {
        lines.push('¥' + priceNum.toLocaleString('en-US'));
      }
      payload = {
        title: '📦 発送待ち [' + kanri + ']',
        body: lines.join(' / ') || '発送待ちに変更されました',
        tag: 'kanri:' + kanri,
        url: '/?tab=hassou',
      };
    } else {
      // 発送済み: 使用アカウント
      const account = String(extra['使用アカウント'] || '').trim();
      payload = {
        title: '✅ 発送済み [' + kanri + ']',
        body: account ? ('使用アカウント: ' + account) : '発送済みに変更されました',
        tag: 'kanri:' + kanri,
        url: '/?tab=hassou',
      };
    }
    await fanoutByTrigger(env, trigger, payload);
  } catch (err) {
    console.warn('[push fanout] status change push failed', err.message);
  }
}

async function logSaveFailure_(env, user, kanri, fields, reason) {
  if (!env.CACHE) return;
  try {
    const key = 'savefail:' + kanri + ':' + Date.now();
    await env.CACHE.put(key, JSON.stringify({
      kanri, fields, reason, ts: Date.now(), email: (user && user.email) || ''
    }), { expirationTtl: 86400 * 7 });
  } catch (e) { /* ignore */ }
}

// ============================================================
// savefail 再送 Cron（②保存耐久性ギャップの解消）
//
// logSaveFailure_ が積んだ savefail:<kanri>:<ts> レコードには「D1 は楽観更新済みだが
// GAS reconcile が失敗した保存」が入る。従来は消費者ゼロで TTL7日で消えるだけ＝
// GAS 側（＝スプレッドシートの正）が永久に取り込まれない穴があった。
// scheduled から本関数を呼び、GAS へ再投入して確定させる。
//   - 成功 → savefail を削除
//   - 失敗 → attempts を +1 して残す。SAVEFAIL_MAX_ATTEMPTS 回で dead-letter(savefail-dead:*)へ退避
//   - 壊れたレコード → 削除
// feedback_d1_cost_safeguard: 1回の実行で処理する件数を SAVEFAIL_MAX_PER_RUN で上限化し、
//   reconcile 内の D1 書込みが暴走しないようにする（過去 $54 課金の教訓）。
const SAVEFAIL_MAX_ATTEMPTS = 5;
const SAVEFAIL_MAX_PER_RUN  = 100;
export async function retrySaveFailures(env) {
  const kv = env.CACHE;
  if (!kv) return { processed: 0, recovered: 0, dropped: 0, kept: 0 };
  let cursor = undefined;
  let processed = 0, recovered = 0, dropped = 0, kept = 0;
  try {
    outer:
    do {
      const list = await kv.list({ prefix: 'savefail:', cursor, limit: 100 });
      for (const k of list.keys) {
        if (processed >= SAVEFAIL_MAX_PER_RUN) break outer;
        // dead-letter は再送対象外（prefix 'savefail:' に 'savefail-dead:' は含まれない想定だが念のため）
        if (k.name.indexOf('savefail-dead:') === 0) continue;
        let rec = null;
        try { rec = await kv.get(k.name, 'json'); } catch { rec = null; }
        if (!rec || !rec.kanri || !rec.fields || typeof rec.fields !== 'object') {
          try { await kv.delete(k.name); } catch {}
          continue;
        }
        processed++;
        const user = { email: (rec.email || 'cloudflare-proxy') };
        let ok = false;
        try {
          ok = await dispatchGasSaveDetails_(env, user, rec.kanri, rec.fields, '', '', { suppressPush: true, suppressFailureLog: true });
        } catch (e) { ok = false; }
        if (ok) { try { await kv.delete(k.name); } catch {} recovered++; continue; }
        const attempts = (Number(rec.attempts) || 0) + 1;
        if (attempts >= SAVEFAIL_MAX_ATTEMPTS) {
          try { await kv.delete(k.name); } catch {}
          try { await kv.put('savefail-dead:' + rec.kanri + ':' + (rec.ts || Date.now()), JSON.stringify(Object.assign({}, rec, { attempts, deadAt: Date.now() })), { expirationTtl: 86400 * 30 }); } catch {}
          dropped++;
        } else {
          try { await kv.put(k.name, JSON.stringify(Object.assign({}, rec, { attempts })), { expirationTtl: 86400 * 7 }); } catch {}
          kept++;
        }
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  } catch (e) { console.warn('[savefail-retry] failed', e && e.message); }
  if (processed) console.log(`[savefail-retry] processed=${processed} recovered=${recovered} dropped=${dropped} kept=${kept}`);
  return { processed, recovered, dropped, kept };
}

// ============================================================
// 同梱グループ自動転記（bundle fan-out）
//
// メイン（グループ内で最初に実価格で販売登録した商品）の保存を起点に、
// 同梱メンバーへ次を自動転記する:
//   - 販売系: メンバーの販売日が空 → {販売日, 販売場所, 販売価格:0, 送料:0, 手数料:0}
//             メンバーが自動登録済み（価格0） → {販売日, 販売場所} のみ再転記（修正追従）
//             メンバーに手動の実価格（>0）あり → 販売系はスキップ
//   - 発送系: メンバーの発送日付が空 → {発送日付(+発送者)}（物理的に同梱発送のため全員対象）
//   - 完了系: メンバーの完了日が空 → {完了日}
// ステータス列は書かない。日付列の転記だけで DERIVED_STATUS（前進のみ・降格禁止）が
// 発送待ち/発送済み/売却済みへ自動遷移する — 既存設計と同じパターン。
// 転記ルールは冪等（同値なら patch が空になり何も送らない）なので、outbox 再送や
// KV レースが起きても収束する。削除/クリア（空文字への変更）は自動化しない＝手動運用。
// ============================================================

// 転記トリガーになるフィールド。通常の詳細編集でこれらに触れていなければ KV すら読まない
const FANOUT_TRIGGER_FIELDS_ = ['販売日', '販売場所', '販売価格', '発送日付', '発送者', '完了日'];

// saveDetails 起点の fan-out（waitUntil から呼ぶ。例外は必ず内部で握り潰す）
export async function fanoutBundleAfterSave(env, user, kanri, fields) {
  try {
    if (!fields || !FANOUT_TRIGGER_FIELDS_.some(k => fields[k] !== undefined)) return;
    await runBundleFanout_(env, user, kanri, fields, 'save');
  } catch (err) {
    console.warn('[bundle fanout] save fanout failed', kanri, err && err.message);
  }
}

// 同梱追加（/api/bundles/toggle）起点の fan-out — メインに販売情報がある状態で
// 後からメンバーを追加したケースを拾う
export async function fanoutBundleOnJoin(env, user, joinerKanri) {
  try {
    await runBundleFanout_(env, user, joinerKanri, null, 'join');
  } catch (err) {
    console.warn('[bundle fanout] join fanout failed', joinerKanri, err && err.message);
  }
}

async function runBundleFanout_(env, user, sourceKanri, fields, mode) {
  if (!env.CACHE || !env.DB) return;
  const gid = await getOf(env, sourceKanri);
  if (!gid) return;
  const bundle = await readBundle(env, gid);
  if (!bundle) return;
  const norm = s => String(s || '').toLowerCase();
  // dangling ポインタ（bundle-of は指すが members に居ない）は listBundles と同じく無視
  if (!bundle.members.some(m => norm(m) === norm(sourceKanri))) return;

  // メンバー全行を D1 から 1 クエリで取得（COLLATE NOCASE でレガシーなケース混在も救う。
  // 以降の書込は D1 の正準ケース r.kanri を使う）
  const placeholders = bundle.members.map(() => '?').join(',');
  const rs = await env.DB.prepare(
    `SELECT kanri, shiire_id, sale_date, sale_place, sale_price,
            ${DERIVED_STATUS} AS derived_status,
            json_extract(extra_json, '$.発送日付') AS ship_date,
            json_extract(extra_json, '$.発送者')   AS shipper,
            json_extract(extra_json, '$.完了日')   AS done_date
     FROM products WHERE kanri COLLATE NOCASE IN (${placeholders})`
  ).bind(...bundle.members).all();
  const rows = (rs && rs.results) || [];
  if (rows.length < 2) return;
  const byNorm = new Map(rows.map(r => [norm(r.kanri), r]));
  const trim = v => String(v == null ? '' : v).trim();

  // ---- main 判定 ----
  let mainKanri = (bundle.main && bundle.members.some(m => norm(m) === norm(bundle.main)))
    ? bundle.main : '';

  if (mode === 'save') {
    // メンバー（非メイン）の編集は転記しない
    if (mainKanri && norm(mainKanri) !== norm(sourceKanri)) return;
    if (!mainKanri) {
      // main 未設定: 「実価格つきの販売登録」かつ「未販売メンバーが居る」ときだけ main 化。
      // 全員販売済みの既存同梱（レガシー）の販売日編集では main を立てない（誤集約防止）
      const selfRow = byNorm.get(norm(sourceKanri));
      const saleDate = (fields && fields['販売日'] !== undefined)
        ? trim(fields['販売日']) : trim(selfRow && selfRow.sale_date);
      const salePrice = Number((fields && fields['販売価格'] !== undefined)
        ? fields['販売価格'] : (selfRow && selfRow.sale_price));
      if (!saleDate || !(salePrice > 0)) return;
      const hasEmpty = rows.some(r => norm(r.kanri) !== norm(sourceKanri) && !trim(r.sale_date));
      if (!hasEmpty) return;
      bundle.main = (selfRow && selfRow.kanri) || sourceKanri;
      await writeBundle(env, bundle);
      mainKanri = bundle.main;
    }
  } else {
    // join: main 未設定なら「実売（販売日あり∧価格>0）がちょうど1件 ∧ 未販売が1件以上」の
    // ときだけその実売メンバーを main 化（実売0件 or 2件以上＝レガシー混在は何もしない）
    if (!mainKanri) {
      const sold = rows.filter(r => trim(r.sale_date) && Number(r.sale_price) > 0);
      const hasEmpty = rows.some(r => !trim(r.sale_date));
      if (sold.length !== 1 || !hasEmpty) return;
      bundle.main = sold[0].kanri;
      await writeBundle(env, bundle);
      mainKanri = bundle.main;
    }
  }

  // ---- メインの現在値（save 時は今回の fields を優先。D1 楽観更新失敗時の保険） ----
  const mainRow = byNorm.get(norm(mainKanri));
  const mainVal = (fieldName, col) => {
    if (mode === 'save' && fields && fields[fieldName] !== undefined) return trim(fields[fieldName]);
    return mainRow ? trim(mainRow[col]) : '';
  };
  const mSaleDate  = mainVal('販売日', 'sale_date');
  const mSalePlace = mainVal('販売場所', 'sale_place');
  const mShipDate  = mainVal('発送日付', 'ship_date');
  const mShipper   = mainVal('発送者', 'shipper');
  const mDoneDate  = mainVal('完了日', 'done_date');

  // save 時は今回触ったフィールド群のみ転記対象（値が空＝クリアは自動転記しない）
  const touched = k => mode === 'join' || (fields && fields[k] !== undefined);
  const saleActive = !!mSaleDate && (touched('販売日') || touched('販売場所') || touched('販売価格'));
  const shipActive = !!mShipDate && (touched('発送日付') || touched('発送者'));
  const doneActive = !!mDoneDate && touched('完了日');
  if (!saleActive && !shipActive && !doneActive) return;

  // ---- メンバーごとの patch 構築（冪等: 同値なら空 patch → 送らない） ----
  const patches = [];
  for (const r of rows) {
    if (norm(r.kanri) === norm(mainKanri)) continue;
    const patch = {};
    if (saleActive) {
      const memSaleDate = trim(r.sale_date);
      const memPrice = Number(r.sale_price);
      if (!memSaleDate) {
        // 未販売 → フルセット自動登録（同梱分は価格・送料・手数料 0）
        patch['販売日'] = mSaleDate;
        if (mSalePlace) patch['販売場所'] = mSalePlace;
        patch['販売価格'] = 0;
        patch['送料'] = 0;
        patch['手数料'] = 0;
      } else if (!(memPrice > 0)) {
        // 自動登録済み（価格0）→ 販売日/販売場所のみ修正追従
        if (mSaleDate && mSaleDate !== memSaleDate) patch['販売日'] = mSaleDate;
        if (mSalePlace && mSalePlace !== trim(r.sale_place)) patch['販売場所'] = mSalePlace;
      }
      // 手動の実価格（>0）を持つメンバーは販売系スキップ（上書きしない）
    }
    if (shipActive && !trim(r.ship_date)) {
      patch['発送日付'] = mShipDate;
      if (mShipper) patch['発送者'] = mShipper;
    }
    if (doneActive && !trim(r.done_date)) {
      patch['完了日'] = mDoneDate;
    }
    if (Object.keys(patch).length) {
      patches.push({
        kanri: r.kanri,
        fields: patch,
        oldDerived: trim(r.derived_status),
        oldShiireId: trim(r.shiire_id),
      });
    }
  }
  if (!patches.length) return;

  // ---- D1 楽観更新（saveDetails 同期部と同型。patch キーのみ json_patch で反映） ----
  await Promise.all(patches.map(async p => {
    try {
      const patchExtra = {};
      for (const k of Object.keys(p.fields)) {
        const v = p.fields[k];
        patchExtra[k] = v == null ? '' : String(v);
      }
      await applyDetailColumns_(env, p.kanri, p.fields, patchExtra);
    } catch (err) {
      console.warn('[bundle fanout] member d1 update failed', p.kanri, err && err.message);
    }
  }));

  // ---- GAS 投入（並列。失敗は logSaveFailure_ に記録され、メインの販売日再保存＝再転記がリトライ手段） ----
  await Promise.all(patches.map(p =>
    dispatchGasSaveDetails_(env, user, p.kanri, p.fields, p.oldDerived, p.oldShiireId, { suppressPush: true })
  ));
  invalidateCountsCache();
}

// POST /api/save/image  body: { kanri, field, dataUrl }
// dataUrl は "data:image/jpeg;base64,..." 形式。GAS が Drive にアップロードして URL をシートに書き戻す。
export async function uploadImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const field = String(body.field || '').trim();
  const dataUrl = String(body.dataUrl || '');
  if (!kanri) return jsonError('kanri required', 400);
  if (!field) return jsonError('field required', 400);
  if (!dataUrl) return jsonError('dataUrl required', 400);

  const gasRes = await callGas(env, 'uploadImage', { kanri, field, dataUrl }, user);
  if (!gasRes.ok) {
    const reason = gasRes.error || 'gas error';
    console.warn('[uploadImage] GAS NG kanri=' + kanri + ' field=' + field + ' error=' + reason);
    // 画像アップロード失敗を KV にも残す。wrangler tail の接続タイミングに依存せず
    // 後から `wrangler kv key list --prefix savefail:` で失敗理由を確認できるようにする。
    try {
      await logSaveFailure_(env, user, kanri, { image: field, dataUrlLen: dataUrl.length }, 'uploadImage:' + reason);
    } catch (e) { /* ignore */ }
    return jsonError(reason, 502);
  }

  // 2026-05-03 以降: GAS は相対パス (path) と Drive URL (url) の両方を返す。
  // シートには path（AppSheet 互換 "商品管理_Images/..."）を書いているため D1 にも path を入れる。
  // path → URL の解決は既存の /api/image/resolve（KV キャッシュ 1日）が引き受ける。
  const sheetValue = gasRes.path || gasRes.url || '';
  // resolveImage の KV キャッシュをこの path で予熱しておくと、直後の表示で 1往復省ける
  if (env.CACHE && gasRes.path && gasRes.url) {
    try {
      // normalizeDriveUrl_ 相当の正規化（uc?id → thumbnail?id&sz=w500）
      const m = String(gasRes.url).match(/^https?:\/\/drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/);
      const norm = m ? ('https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w500') : gasRes.url;
      await env.CACHE.put('imgresolve:' + gasRes.path, norm, { expirationTtl: 86400 });
    } catch (err) {
      console.warn('[upload image] kv warm failed', err.message);
    }
  }

  try {
    // 2026-05-21: SELECT→UPDATE の read-modify-write を廃止し、json_set() の単一文で
    // 原子的に1キーだけ更新する。同一商品への画像アップロードが2件ほぼ同時に走っても、
    // 一方の SELECT〜UPDATE の隙間に他方の書き込みが挟まって取りこぼされる事故を防ぐ
    // （過去の orphan-image インシデントと同型の lost-update レース対策）。
    const jsonPath = '$."' + field.replace(/"/g, '\\"') + '"';
    await env.DB.prepare(
      "UPDATE products SET extra_json = json_set(COALESCE(extra_json, '{}'), ?, ?), updated_at = ? WHERE kanri = ?"
    ).bind(jsonPath, sheetValue, Date.now(), kanri).run();
  } catch (err) {
    console.warn('[upload image] d1 update failed', err.message);
  }

  return jsonOk({ uploaded: true, url: gasRes.url, path: gasRes.path || '', field });
}

// POST /api/image/resolve  body: { kanri, field, path }
// AppSheet 旧形式の相対パスを Drive シェアURL に解決。KV キャッシュ 1日。
// Drive の uc?id=FILE_ID は <img> タグから直接表示できない（リダイレクト/ウイルススキャン警告）
// → thumbnail?id=FILE_ID&sz=w500 に正規化して返す（GAS 側変更不要・既存KVキャッシュも自動対応）
function normalizeDriveUrl_(url) {
  if (!url) return url;
  // /uc?id=FILE_ID パターン → /thumbnail?id=FILE_ID&sz=w500
  var m = url.match(/^https?:\/\/drive\.google\.com\/uc\?(.*&)?id=([^&]+)/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[2] + '&sz=w500';
  // /file/d/FILE_ID/view パターン → /thumbnail?id=FILE_ID&sz=w500
  var m2 = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w500';
  return url;
}
export async function resolveImage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const path = String(body.path || '').trim();
  const field = String(body.field || '').trim();
  const kanri = String(body.kanri || '').trim();
  if (!path) return jsonError('path required', 400);

  const cacheKey = 'imgresolve:' + path;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) return jsonOk({ url: normalizeDriveUrl_(cached), cached: true });
    } catch (err) {
      console.warn('[resolve image] kv get failed', err.message);
    }
  }

  const gasRes = await callGas(env, 'resolveImage', { kanri, field, path }, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  const normalizedUrl = normalizeDriveUrl_(gasRes.url);

  if (env.CACHE && normalizedUrl) {
    try {
      await env.CACHE.put(cacheKey, normalizedUrl, { expirationTtl: 86400 });
    } catch (err) {
      console.warn('[resolve image] kv put failed', err.message);
    }
  }

  return jsonOk({ url: normalizedUrl, fileName: gasRes.fileName });
}

// POST /api/create/purchase  body: { date, category, amount, shipping, planned, place, content, supplierId, registerUser }
export async function createPurchase(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }

  const payload = {
    date: String(body.date || '').trim(),
    category: String(body.category || '').trim(),
    amount: Number(body.amount || 0) || 0,
    shipping: Number(body.shipping || 0) || 0,
    planned: Number(body.planned || 0) || 0,
    place: String(body.place || '').trim(),
    content: String(body.content || '').trim(),
    supplierId: String(body.supplierId || '').trim(),
    registerUser: String(body.registerUser || '').trim(),
  };
  if (!payload.date) return jsonError('仕入れ日が空です', 400);
  if (!payload.category) return jsonError('区分コードが空です', 400);
  if (!payload.place) return jsonError('納品場所が空です', 400);

  const gasRes = await callGas(env, 'createPurchase', payload, user);
  if (!gasRes.ok) return jsonError(gasRes.error || 'gas error', 502);

  // D1 への楽観的 INSERT（次の Cron で確定するが即時表示のため）
  try {
    const nowIso = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO purchases (shiire_id, date, amount, shipping, planned, place, cost, category,
                              content, supplier_id, register_user, registered_at, assigned_kanri, processed,
                              row_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shiire_id) DO UPDATE SET
        date = excluded.date, amount = excluded.amount, shipping = excluded.shipping,
        planned = excluded.planned, place = excluded.place, category = excluded.category,
        content = excluded.content, supplier_id = excluded.supplier_id,
        register_user = excluded.register_user, registered_at = excluded.registered_at,
        assigned_kanri = excluded.assigned_kanri, processed = excluded.processed,
        updated_at = excluded.updated_at
    `).bind(
      gasRes.shiireId,
      payload.date,
      payload.amount,
      payload.shipping,
      payload.planned,
      payload.place,
      payload.planned > 0 ? Math.round((payload.amount + payload.shipping) / payload.planned) : 0,
      payload.category,
      payload.content,
      payload.supplierId,
      payload.registerUser,
      nowIso,
      gasRes.assignedKanri || '',
      1,
      gasRes.row || 0,
      Date.now(),
    ).run();
  } catch (err) {
    console.warn('[create] purchases d1 insert failed', err.message);
  }

  return jsonOk({ created: true, shiireId: gasRes.shiireId, assignedKanri: gasRes.assignedKanri || '' });
}

// POST /api/create/product  body: { shiireId, kanri, brand, size, color, state, status, fields? }
// 同期 GAS 呼び出し: D1 へ即時 INSERT → GAS で Sheet 書き込み → 結果次第で 200/503/502 を返却。
// busy/exception 時は 503 を返して outbox に自動再送させる。idempotency_keys と GAS LockService の二重防御で重複防止。
// D1 楽観 INSERT は sheets-sync.js の 180 秒保護で Cron 削除から守られる。
// kanri はクライアントが /api/kanri/next で採番済みなのでサーバー往復不要。
export async function createProduct(request, env, user, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }

  const payload = {
    shiireId: String(body.shiireId || '').trim(),
    kanri: String(body.kanri || '').trim(),
    brand: String(body.brand || '').trim(),
    size: String(body.size || '').trim(),
    color: String(body.color || '').trim(),
    state: String(body.state || '').trim(),
    status: String(body.status || '採寸待ち').trim(),
    fields: (body.fields && typeof body.fields === 'object') ? body.fields : {},
  };
  if (!payload.shiireId) return jsonError('仕入れIDが空です', 400);
  if (!payload.kanri) return jsonError('管理番号が空です', 400);

  // #7 二重採番ガード: getNextKanri/getNextKanriForPurchase は予約・排他をせず MAX+1 を
  //    返すため、並行作成で同一 kanri が提案され得る（products.js 側はその場で楽観 INSERT を
  //    used に数えるので逐次呼び出しは自然に繰り上がり、競合窓はサブ秒のみ）。最終的に kanri が
  //    確定するのはこの createProduct なので、ここで衝突を検知して弾く:
  //      (1) row_num>0 = GAS 確定済みの別商品 → 必ず拒否
  //      (2) row_num=0 かつ shiire_id が別 = 別の箱が同じ番号を採番処理中（cross-box 衝突）→ 拒否
  //      (3) row_num=0 かつ同一 shiire_id = 自分の 503 リトライで置いた楽観 INSERT の可能性が
  //          高いので通す（誤って 409 にすると正当なリトライで実在商品を取りこぼす）
  //    ※(3) の同一箱・真の同時タップだけは原子的採番(予約カウンタ)無しには弾けないが、上記の
  //      used 繰り上がりで窓は極小。現行 9 名運用ではこの残存リスクを許容する。
  try {
    const dup = await env.DB.prepare('SELECT row_num, shiire_id FROM products WHERE kanri = ?')
      .bind(payload.kanri).first();
    if (dup) {
      if (Number(dup.row_num) > 0) {
        return jsonError(`管理番号 ${payload.kanri} は既に使われています。番号を採り直してください。`, 409);
      }
      if (dup.shiire_id && String(dup.shiire_id) !== payload.shiireId) {
        return jsonError(`管理番号 ${payload.kanri} は別の商品で採番処理中です。番号を採り直してください。`, 409);
      }
    }
  } catch (e) { /* D1 障害時はガードをスキップして従来動作（GAS 側の整合に委ねる） */ }

  try {
    // 即時表示用に extra_json も組み立てる（次の Cron で確定）
    const extra = Object.assign({}, payload.fields || {});
    extra['ステータス'] = payload.status;
    extra['ブランド'] = payload.brand || extra['ブランド'] || '';
    extra['メルカリサイズ'] = payload.size || extra['メルカリサイズ'] || '';
    extra['カラー'] = payload.color || extra['カラー'] || '';
    extra['状態'] = payload.state || extra['状態'] || '';
    extra['管理番号'] = payload.kanri;
    extra['仕入れID'] = payload.shiireId;
    // #8: ON CONFLICT は DO NOTHING にする。createProduct は新規登録専用だが、
    //     万一 kanri が既存（別商品の採寸・販売データを持つ行 / 503 リトライで attempt1 が
    //     既に INSERT 済み）の場合に DO UPDATE すると、蓄積済みの extra_json を最小ペイロードで
    //     上書きしてデータ消失を招く。DO NOTHING なら既存行を保護でき、かつ後続の GAS 呼び出しは
    //     そのまま継続するのでリトライ経路も壊れない（GAS が kanri で行解決し最終確定する）。
    await env.DB.prepare(`
      INSERT INTO products (kanri, shiire_id, status, brand, size, color, state, extra_json, row_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kanri) DO NOTHING
    `).bind(
      payload.kanri,
      payload.shiireId,
      payload.status,
      payload.brand,
      payload.size,
      payload.color,
      payload.state,
      JSON.stringify(extra),
      0,
      Date.now(),
    ).run();
  } catch (err) {
    console.warn('[create] products d1 insert failed', err.message);
  }

  // 同期 GAS 呼び出し（旧: ctx.waitUntil でバックグラウンド）。
  // busy/exception → 503 で outbox 自動再送、その他失敗 → 502。
  let gasRes;
  try {
    gasRes = await callGas(env, 'createProduct', payload, user);
  } catch (err) {
    console.warn('[create product] gas exception', err.message);
    await logSaveFailure_(env, user, payload.kanri, { create: payload }, 'exception:' + err.message);
    invalidateCountsCache();
    return jsonError('gas exception, retrying', 503);
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[create product] gas failed', reason);
    await logSaveFailure_(env, user, payload.kanri, { create: payload }, reason);
    invalidateCountsCache();
    if (/busy/i.test(reason)) {
      return jsonError('gas busy, retrying', 503);
    }
    return jsonError(reason, 502);
  }

  // 成功時: GAS 応答に row が含まれていれば D1 の row_num を確定反映
  if (gasRes.row && Number(gasRes.row) > 0) {
    try {
      await env.DB.prepare('UPDATE products SET row_num = ?, updated_at = ? WHERE kanri = ?')
        .bind(Number(gasRes.row), Date.now(), payload.kanri).run();
    } catch (e) { /* ignore */ }
  }

  invalidateCountsCache();
  return jsonOk({ created: true, kanri: payload.kanri, row: gasRes.row || 0 });
}

// DELETE /api/products/:kanri
// 商品自体の削除（フロントの「商品削除ゾーン」専用）。
// GAS で商品管理シートから物理削除 → 成功したら D1 からも削除（D1 から消すのは
// GAS の staff_pushDiffOnRemove_ も走るが、UX 即時反映のためここでも消す）。
// KV の同梱情報や画像は削除しない（要件: 商品管理シート行 + D1 のみ）。
export async function deleteProduct(request, env, user, ctx, kanri) {
  const k = String(kanri || '').trim();
  if (!k) return jsonError('kanri required', 400);

  const gasRes = await callGas(env, 'deleteProduct', { kanri: k }, user);
  if (!gasRes || !gasRes.ok) {
    return jsonError((gasRes && gasRes.error) || 'gas error', 502);
  }

  try {
    await env.DB.prepare('DELETE FROM products WHERE kanri = ?').bind(k).run();
  } catch (err) {
    console.warn('[delete product] d1 delete failed', err.message);
  }

  invalidateCountsCache();
  return jsonOk({ deleted: true, kanri: k });
}

async function callGas(env, action, payload, user) {
  const body = JSON.stringify({
    action,
    secret: env.SYNC_SECRET,
    email: user.email,
    payload,
  });
  // 計測: POST往復(post)・302→GET転送(hop)・テキスト取得(read)を分離
  const __T = { post: 0, hop: 0, read: 0 };
  let res;
  const __t0 = Date.now();
  try {
    res = await postFollowingRedirects(env.GAS_API_URL, body, __T);
  } catch (err) {
    return { ok: false, error: 'gas fetch[' + action + ']: ' + err.message, _t: { call: Date.now() - __t0, ...__T } };
  }
  if (!res.ok) return { ok: false, error: 'gas http ' + res.status + '[' + action + ']', _t: { call: Date.now() - __t0, ...__T } };
  // GAS が HTML を返すことがある（デプロイ切替中・タイムアウト等）。
  // どの action で起きたかを必ず error に残す。
  let text = '';
  const __tr = Date.now();
  try { text = await res.text(); } catch { return { ok: false, error: 'gas read fail[' + action + ']' }; }
  __T.read = Date.now() - __tr;
  __T.call = Date.now() - __t0;
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const hint = text ? text.slice(0, 80).replace(/\s+/g, ' ') : '(empty)';
    return { ok: false, error: 'gas non-json[' + action + ']: ' + hint, _t: __T };
  }
  // GAS の _t と Worker 計測をマージ
  parsed._t = Object.assign({}, parsed._t || {}, __T);
  return parsed;
}

// _t を Server-Timing ヘッダ文字列に変換 (DevTools Network → Timing で可視化)
function buildServerTiming(t) {
  if (!t || typeof t !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(t)) {
    const v = Number(t[k]);
    if (!Number.isFinite(v)) continue;
    parts.push(`${k};dur=${v}`);
  }
  return parts.join(', ');
}
export { buildServerTiming };

// GAS Web App の POST フロー: POST /exec → 302 (script.googleusercontent.com/macros/echo?user_content_key=...) → GET でレスポンス取得
async function postFollowingRedirects(url, body, T) {
  const __tp = Date.now();
  const first = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });
  if (T) T.post = Date.now() - __tp;
  if (first.status < 300 || first.status >= 400) return first;
  let loc = first.headers.get('location');
  const __th = Date.now();
  for (let hop = 0; hop < 5; hop++) {
    if (!loc) throw new Error(`redirect without location at hop ${hop}`);
    const next = await fetch(loc, { method: 'GET', redirect: 'manual' });
    if (next.status < 300 || next.status >= 400) {
      if (T) T.hop = Date.now() - __th;
      return next;
    }
    loc = next.headers.get('location');
  }
  throw new Error('too many redirects');
}
