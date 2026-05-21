import { jsonOk, jsonError } from '../utils/response.js';
import { invalidateCountsCache, DERIVED_STATUS } from './products.js';
import { fanoutByTrigger } from './push.js';

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
// 注: GAS staff_apiSaveSale は販売価格入力時に raw status を直接「売却済み」へ
//     セットする（発送待ちは経由しない）。Push トリガーには 売却済み は無いので
//     ここでは Push 検知を行わない。発送待ち遷移は saveDetails 経由のみ。
export async function saveSale(request, env, user, ctx) {
  const __t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanri = String(body.kanri || '').trim();
  const sale = body.sale || {};
  if (!kanri) return jsonError('kanri required', 400);

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
    ctx.waitUntil(dispatchGasSaveSale_(env, user, kanri, sale));
  } else {
    dispatchGasSaveSale_(env, user, kanri, sale).catch(() => {});
  }

  const t = { d1: Date.now() - __td1, total: Date.now() - __t0 };
  invalidateCountsCache();
  return jsonOk({ saved: true, optimistic: true }, { 'Server-Timing': buildServerTiming(t) });
}

async function dispatchGasSaveSale_(env, user, kanri, sale) {
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
  } else {
    // ctx 未渡しの保険（通常は通らない）
    dispatchGasSaveDetails_(env, user, kanri, fields, oldDerivedStatus, oldShiireId).catch(() => {});
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
  const sets = ['extra_json = ?', 'updated_at = ?'];
  const args = [JSON.stringify(mergedExtra), Date.now()];
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
async function dispatchGasSaveDetails_(env, user, kanri, fields, oldDerivedStatus, oldShiireId) {
  let gasRes;
  try {
    gasRes = await callGas(env, 'saveDetails', { kanri, fields }, user);
  } catch (err) {
    console.warn('[save details bg] gas exception', err.message);
    await logSaveFailure_(env, user, kanri, fields, 'exception:' + err.message);
    return;
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[save details bg] gas failed', reason);
    await logSaveFailure_(env, user, kanri, fields, reason);
    return;
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
    const newDerivedStatus = String((gasRes && gasRes.derivedStatus) || '').trim();
    if (newDerivedStatus && newDerivedStatus !== oldDerivedStatus) {
      await maybePushOnStatusChange_(env, kanri, oldDerivedStatus, newDerivedStatus, mergedExtra, oldShiireId);
    }
  } catch (err) {
    console.warn('[save details bg] push fanout failed', err.message);
  }
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
// Fire-and-forget: D1 へ即時 INSERT → 即 200 を返却 → 裏で GAS にシート反映を投入
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
    await env.DB.prepare(`
      INSERT INTO products (kanri, shiire_id, status, brand, size, color, state, extra_json, row_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kanri) DO UPDATE SET
        shiire_id = excluded.shiire_id, status = excluded.status, brand = excluded.brand,
        size = excluded.size, color = excluded.color, state = excluded.state,
        extra_json = excluded.extra_json, updated_at = excluded.updated_at
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

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(dispatchGasCreateProduct_(env, user, payload));
  } else {
    dispatchGasCreateProduct_(env, user, payload).catch(() => {});
  }

  invalidateCountsCache();
  return jsonOk({ created: true, optimistic: true, kanri: payload.kanri });
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

async function dispatchGasCreateProduct_(env, user, payload) {
  let gasRes;
  try {
    gasRes = await callGas(env, 'createProduct', payload, user);
  } catch (err) {
    console.warn('[create product bg] gas exception', err.message);
    await logSaveFailure_(env, user, payload.kanri, { create: payload }, 'exception:' + err.message);
    return;
  }
  if (!gasRes || !gasRes.ok) {
    const reason = (gasRes && gasRes.error) || 'unknown';
    console.warn('[create product bg] gas failed', reason);
    await logSaveFailure_(env, user, payload.kanri, { create: payload }, reason);
    return;
  }
  // GAS 応答に row が含まれていれば D1 の row_num を確定反映
  if (gasRes.row && Number(gasRes.row) > 0) {
    try {
      await env.DB.prepare('UPDATE products SET row_num = ?, updated_at = ? WHERE kanri = ?')
        .bind(Number(gasRes.row), Date.now(), payload.kanri).run();
    } catch (e) { /* ignore */ }
  }
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
