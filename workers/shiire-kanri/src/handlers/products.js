import { jsonOk, jsonError } from '../utils/response.js';

// 日付フィールドが入力されているかの判定式（SQLite）
const D_SAISUN  = "(json_extract(extra_json, '$.\"採寸日\"') IS NOT NULL AND json_extract(extra_json, '$.\"採寸日\"') <> '')";
const D_SATSUEI = "(json_extract(extra_json, '$.\"撮影日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"撮影日付\"') <> '')";
const D_SHUPPIN = "(json_extract(extra_json, '$.\"出品日\"') IS NOT NULL AND json_extract(extra_json, '$.\"出品日\"') <> '')";
const D_HASSOU  = "(json_extract(extra_json, '$.\"発送日付\"') IS NOT NULL AND json_extract(extra_json, '$.\"発送日付\"') <> '')";
const D_KANRYOU = "(json_extract(extra_json, '$.\"完了日\"') IS NOT NULL AND json_extract(extra_json, '$.\"完了日\"') <> '')";
const D_HANBAI  = "(sale_date IS NOT NULL AND sale_date <> '')";
const ACCOUNT_SELECTED = "(json_extract(extra_json, '$.\"使用アカウント\"') IS NOT NULL AND json_extract(extra_json, '$.\"使用アカウント\"') <> '')";

// 販売日(sale_date)が3か月以内か。発送商品タブの「完了」チップで、
// 完了（完了日入力済み＝売却済み）の行を販売日から3か月以内に限って表示するための窓。
// sale_date は "YYYY/MM/DD" or "YYYY-MM-DD" 文字列なので先頭10文字を正規化して date() 比較。
const SALE_WITHIN_3M = "(sale_date IS NOT NULL AND sale_date <> '' AND date(replace(substr(sale_date, 1, 10), '/', '-')) >= date('now', '-3 months'))";

// 出品待ち・出品作業中タブから除外する「仮置き場」の納品場所。
// family / なかの屋plus は撮影・採寸中の一時納品場所で、在庫保管場所へ移動報告
// するまで出品させてはいけない（出品後に売れると発送処理ができなくなるため）。
// 管理者は設定シートの「出品待ち除外納品場所」列（master:settings KV）で編集でき、
// KV ミス・列が空のときは下の既定値にフォールバックする。
const DEFAULT_SHUPPIN_EXCLUDE_PLACES = ['family', 'なかの屋plus'];
const SHUPPIN_EXCLUDE_SETTING_KEY = '出品待ち除外納品場所';

async function getShuppinExcludePlaces_(env) {
  try {
    const s = env.CACHE && await env.CACHE.get('master:settings', 'json');
    const list = s && s.items && s.items[SHUPPIN_EXCLUDE_SETTING_KEY];
    if (Array.isArray(list)) {
      const cleaned = list.map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
      if (cleaned.length) return cleaned;
    }
  } catch (err) {
    console.warn('[products] settings kv get failed', err && err.message);
  }
  return DEFAULT_SHUPPIN_EXCLUDE_PLACES;
}

// 「納品場所が除外拠点でない」SQL 句とバインド引数を返す。
// AppSheet の [納品場所]<>"x" 同様、納品場所が空の行は通す（IFNULL で NULL セーフ）。
function shuppinPlaceClause_(places) {
  const ph = places.map(() => '?').join(', ');
  return {
    clause: `IFNULL(json_extract(extra_json, '$."納品場所"'), '') NOT IN (${ph})`,
    args: places.slice(),
  };
}

// 派生ステータス: シート上の手動ステータス（status 列）を最優先。
// 「出品作業中」だけは raw='出品待ち' の中で日付＋アカウント条件を満たす行を細分化する。
// status が空のときだけ日付ベースで自動判定する。
//
// なぜ raw を優先するのか:
//   従来は日付ベースで派生していたが、シート上で「売却済み」になっていても
//   完了日が空の行が 1300件以上存在し、それらが派生では「出品中」になって
//   AppSheet と件数が大きく食い違っていた。シートが正、派生は補完。
export const DERIVED_STATUS = `
  CASE
    -- raw='出品待ち'/'出品作業中' でも 出品日 が入っていれば 販売日入るまで '出品中' を最優先
    -- （シート直接編集や AppSheet 経由で出品日だけ入った行のステータス遅延を解消）
    WHEN status IN ('出品待ち','出品作業中') AND ${D_SHUPPIN}
         AND NOT ${D_HANBAI} AND NOT ${D_HASSOU} AND NOT ${D_KANRYOU}
         THEN '出品中'
    -- raw='出品待ち' のうち撮影日・採寸日・使用アカウントが揃った行は「出品作業中」に細分化
    WHEN status = '出品待ち' AND ${D_SATSUEI} AND ${D_SAISUN} AND ${ACCOUNT_SELECTED} THEN '出品作業中'
    -- raw='出品待ち' でも採寸/撮影が未完なら日付ベースに降格（誤付与の自己修復）
    WHEN status = '出品待ち' AND NOT (${D_SATSUEI} AND ${D_SAISUN}) THEN
      CASE
        WHEN ${D_SATSUEI} THEN '採寸待ち'
        WHEN ${D_SAISUN}  THEN '撮影待ち'
        ELSE '採寸待ち'
      END
    -- 完了日が入っていれば raw status('発送済み'/'発送待ち') より優先して '売却済み' を返す。
    -- 完了ボタン押下直後は D1.status の reconcile（GAS往復で最大数分／失敗時は5分Cron）が
    -- 未着地で raw='発送済み' のままだが、extra_json.完了日 は楽観更新で即入る。シート側 IFS
    -- （StaffApi.gs:65 完了日 notBlank→売却済み）と整合させ、reconcile を待たず即「売却済み」を
    -- 返す（発送済みリストからも即外れる）。廃棄/返品/キャンセル済みは上位で確定済みなので影響なし。
    WHEN ${D_KANRYOU} AND status IN ('発送済み','発送待ち') THEN '売却済み'
    -- ▼ 楽観更新の即時反映（reconcile 待ちラグ解消）:
    --   採寸日/撮影日付/出品日/販売日/発送日付 等は SPA 保存で extra_json/sale_date に即入るが、
    --   raw status 列は GAS round-trip の reconcile（~5秒／失敗時5分Cron）まで前段階のまま。
    --   一覧カードの表示は derived_status を見るため、下の line「raw status を尊重」に落ちると
    --   日付を入れても表示が前段階に張り付き「数分ラグ」に見える（完了日だけ上の branch で即時化済）。
    --   そこで raw status が「日付が示す段階より前」のときだけ、日付ベースの段階へ前進させる。
    --   ※ 前進のみ・降格はしない。raw status が既に '売却済み'/'返品済み'/'廃棄済み'/'キャンセル' 等の
    --     終端や、日付段階以上に進んでいる行（1300件の status='売却済み'×完了日空白 を含む）は
    --     どの WHEN にも一致せず下の「raw status を尊重」に落ちるので従来通り維持される。
    --     条件は StaffApi.gs:staff_calcStatus_（AppSheet IFS）と同順・同判定で整合させる。
    WHEN ${D_HASSOU}  AND status IN ('採寸待ち','撮影待ち','出品待ち','出品作業中','出品中','発送待ち') THEN '発送済み'
    WHEN ${D_HANBAI}  AND status IN ('採寸待ち','撮影待ち','出品待ち','出品作業中','出品中') THEN '発送待ち'
    WHEN ${D_SATSUEI} AND ${D_SAISUN} AND status IN ('採寸待ち','撮影待ち') THEN '出品待ち'
    WHEN ${D_SAISUN}  AND NOT ${D_SATSUEI} AND status = '採寸待ち' THEN '撮影待ち'
    -- raw status が入っていればそれを尊重（AppSheet と整合）
    WHEN status IS NOT NULL AND status <> '' THEN status
    -- raw status が空のときだけ日付ベースで派生
    WHEN ${D_KANRYOU} THEN '売却済み'
    WHEN ${D_HASSOU}  THEN '発送済み'
    WHEN ${D_HANBAI}  THEN '発送待ち'
    WHEN ${D_SHUPPIN} THEN '出品中'
    WHEN ${D_SATSUEI} AND ${D_SAISUN} THEN '出品待ち'
    WHEN ${D_SATSUEI} THEN '採寸待ち'
    WHEN ${D_SAISUN}  THEN '撮影待ち'
    ELSE '採寸待ち'
  END
`;

// GET /api/products?filter=...&q=...&shiire=...&limit=...&mode=list|full
export async function listProducts(request, env) {
  const u = new URL(request.url);
  const filter = u.searchParams.get('filter') || '';
  const q = (u.searchParams.get('q') || '').trim();
  const shiire = (u.searchParams.get('shiire') || '').trim();
  const brand = (u.searchParams.get('brand') || '').trim();
  const status = (u.searchParams.get('status') || '').trim();
  const worker = (u.searchParams.get('worker') || '').trim();
  const place = (u.searchParams.get('place') || '').trim();
  // includeHolding=1: 仮置き場（family等）除外を無効化。場所移動ピッカー専用。
  // 仮置き場の商品こそ移動対象なので、出品待ちタブと違って除外してはいけない。
  const includeHolding = u.searchParams.get('includeHolding') === '1';
  // listedBeforeDays: 出品日が N 日以上前の商品のみに絞る（返送ピッカー用）
  // AppSheet Valid_If: DATE([出品日]) <= (TODAY() - 30) と同条件
  const listedBeforeDaysRaw = u.searchParams.get('listedBeforeDays');
  const listedBeforeDays = listedBeforeDaysRaw != null && listedBeforeDaysRaw !== ''
    ? Math.max(0, Math.min(3650, parseInt(listedBeforeDaysRaw, 10) || 0))
    : null;
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '10000', 10), 10000);
  // mode=list: 一覧描画に必要な最小フィールドだけ返す（モバイルのモッサリ対策）
  // mode=full: 従来通り extra_json / measure_json まで返す（旧クライアント互換）
  const mode = (u.searchParams.get('mode') || 'full').toLowerCase();
  const slim = (mode === 'list');

  const where = [];
  const args = [];

  // フィルタプリセット（派生ステータス基準）
  const ds = `(${DERIVED_STATUS})`;
  if (filter === 'sokutei_machi') {
    where.push(`${ds} = '採寸待ち'`);
  } else if (filter === 'satsuei_machi') {
    where.push(`${ds} = '撮影待ち'`);
  } else if (filter === 'shuppin_machi') {
    // 出品待ち = 派生ステータス '出品待ち'（採寸・撮影済み）かつ
    // 納品場所が仮置き場（family 等）でない。AppSheet の出品待ちビュー条件と一致。
    // ただし includeHolding=1（場所移動ピッカー）のときは仮置き場こそ移動対象なので除外しない。
    if (includeHolding) {
      where.push(`${ds} = '出品待ち'`);
    } else {
      const ex = shuppinPlaceClause_(await getShuppinExcludePlaces_(env));
      where.push(`${ds} = '出品待ち' AND ${ex.clause}`);
      ex.args.forEach((a) => args.push(a));
    }
  } else if (filter === 'shuppin_sagyou') {
    // 出品作業中も仮置き場を除外する。出品待ちタブだけ除外しても、使用アカウントが
    // 入ると派生ステータスが '出品作業中' に進み、このタブ経由で出品できてしまうため
    // （zC1600〜1621 が family のまま66点出品された経路）。includeHolding の扱いは
    // shuppin_machi と同じ（ピッカー用途では仮置き場こそ対象なので除外しない）。
    if (includeHolding) {
      where.push(`${ds} = '出品作業中'`);
    } else {
      const ex = shuppinPlaceClause_(await getShuppinExcludePlaces_(env));
      where.push(`${ds} = '出品作業中' AND ${ex.clause}`);
      ex.args.forEach((a) => args.push(a));
    }
  } else if (filter === 'shuppinchu') {
    // 出品中は意図的に除外しない: 既に出品済みの仮置き場商品まで消えると管理不能になる。
    where.push(`${ds} = '出品中'`);
  } else if (filter === 'hassou') {
    // 発送商品タブ — 派生ステータス(${ds})ではなく raw [ステータス] を参照する。
    //   派生ステータスは「前進のみ・降格禁止」の設計（一度進むと発送待ちへ戻れない）なので、
    //   発送作業の実態（発送日・完了日の入力状況）を正確に反映するには raw status を見る必要がある。
    //   ここで raw を使うのは意図的であり、派生ステータスへ置換してはならない。
    // 対象:
    //   1. 発送待ち（発送日付未入力）= これから発送
    //   2. 発送済み（明示的にステータス更新済）
    //   3. 完了（完了日入力済み＝売却済み）かつ 販売日が3か月以内
    // 1・2 は従来通り「完了日が入った行」を除外する（完了したら発送待ち/発送済みからは外す）。
    //   reconcile が数分遅れても、完了ボタンを押した商品が発送済みリストに残らないようにする。
    // 3 は完了行を別枝で拾い、フロントの第3チップ「完了」でのみ表示する（販売日から3か月以内に限定）。
    where.push(
      `((((status = '発送待ち' AND NOT ${D_HASSOU}) OR status = '発送済み') AND NOT ${D_KANRYOU})` +
      ` OR (${D_KANRYOU} AND ${SALE_WITHIN_3M}))`
    );
  } else if (filter === 'sold') {
    where.push(`${ds} IN ('発送待ち','発送済み','売却済み')`);
  }

  // noSold=1: 商品管理タブ用。派生ステータス '売却済み' / '返品済み' を除外。
  // 仕入れ詳細・売上タブ・発送タブは送らないので影響なし。
  if (u.searchParams.get('noSold') === '1') {
    where.push(`${ds} NOT IN ('売却済み','返品済み')`);
  }

  if (status) { where.push('status = ?'); args.push(status); }
  if (shiire) { where.push('shiire_id = ?'); args.push(shiire); }
  if (brand)  { where.push('brand = ?'); args.push(brand); }
  if (worker) { where.push('worker = ?'); args.push(worker); }
  if (place)  { where.push("json_extract(extra_json, '$.\"納品場所\"') = ?"); args.push(place); }

  // 出品日が N 日以上前 (= 出品日 <= today - N days)
  // 出品日は extra_json に "YYYY/MM/DD" or "YYYY-MM-DD" などの文字列で入っているので
  // 先頭10文字を切り出し / を - に置換してから SQLite date() で比較する
  if (listedBeforeDays != null) {
    where.push(
      "json_extract(extra_json, '$.\"出品日\"') IS NOT NULL " +
      "AND json_extract(extra_json, '$.\"出品日\"') <> '' " +
      "AND date(replace(substr(json_extract(extra_json, '$.\"出品日\"'), 1, 10), '/', '-')) <= date('now', ?)"
    );
    args.push('-' + listedBeforeDays + ' days');
  }

  if (q) {
    where.push("(kanri LIKE ? OR brand LIKE ? OR color LIKE ? OR shiire_id LIKE ?)");
    const pat = `%${q}%`;
    args.push(pat, pat, pat, pat);
  }

  // slim モードでは一覧カードに必要な extra フィールドだけ json_extract で取り出す
  // （extra_json 全体は返さない／measure_json も省略）
  const slimSelect = `
    SELECT kanri, shiire_id, worker, status, brand, size, color,
           measured_at, row_num,
           sale_date, sale_ts, sale_price,
           thumb_url,
           json_extract(extra_json, '$."売却済み商品画像"') AS extra_thumb,
           json_extract(extra_json, '$."使用アカウント"')   AS extra_account,
           json_extract(extra_json, '$."完了日"')           AS extra_kanryou,
           json_extract(extra_json, '$."納品場所"')          AS extra_place,
           ${DERIVED_STATUS} AS derived_status
    FROM products
  `;
  const fullSelect = `
    SELECT kanri, shiire_id, worker, status, state, brand, size, color,
           measure_json, measured_at, measured_by,
           sale_date, sale_place, sale_price, sale_shipping, sale_fee, sale_ts,
           extra_json, row_num, updated_at,
           ${DERIVED_STATUS} AS derived_status
    FROM products
  `;
  // 管理番号は「2文字prefix + 数値」(例: zk1000, zG1698)。文字列ソートだと
  // zk1000 < zk999 になるので、prefix と数値部を分けて自然数ソートする。
  const sql = (slim ? slimSelect : fullSelect) + `
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY substr(kanri,1,2) ASC, CAST(substr(kanri,3) AS INTEGER) ASC, kanri ASC
    LIMIT ?
  `;

  // ETag = 同一フィルタ条件で COUNT + MAX(updated_at) を取得し、これをハッシュ化したもの。
  // 9人 × 30s ポーリング × 5000 行で毎回 JSON 化するのは重いので、変化がなければ 304 で返す。
  // クライアントの fetch() は no-cache + ETag があれば自動で If-None-Match を送る。
  const fingerprintSql = `
    SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), 0) AS maxup
    FROM products
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;

  try {
    const fp = await env.DB.prepare(fingerprintSql).bind(...args).first();
    const etag = `"p${slim ? 'S9' : 'F5'}-${fp.cnt}-${fp.maxup}-${limit}"`;

    // CF Edge は weak ETag (W/"...") に書き換えることがあるため、比較時は W/ プレフィクスを剥がす
    const inm = request.headers.get('If-None-Match') || '';
    const inmStripped = inm.replace(/^W\//, '').trim();
    if (inmStripped && inmStripped === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const { results } = await env.DB.prepare(sql).bind(...args, limit).all();
    const items = slim ? results.map(formatProductSlim) : results.map(formatProduct);
    return jsonOk({ items, count: items.length }, {
      ETag: etag,
      'Cache-Control': 'no-cache, must-revalidate',
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// 一覧用の最小フォーマッタ（mode=list）— カード描画に必要なフィールドだけ
function formatProductSlim(row) {
  const extra = {};
  if (row.extra_thumb) extra['売却済み商品画像'] = String(row.extra_thumb);
  if (row.extra_account) extra['使用アカウント'] = String(row.extra_account);
  // 発送済みカードに「完了 ✓」ボタン or 完了日を出し分けるため slim でも 完了日 を露出
  if (row.extra_kanryou) extra['完了日'] = String(row.extra_kanryou);
  // 発送商品カードに納品場所を表示するため slim でも 納品場所 を露出
  if (row.extra_place) extra['納品場所'] = String(row.extra_place);
  return {
    kanri: row.kanri,
    shiireId: row.shiire_id,
    worker: row.worker,
    status: row.derived_status || row.status,
    rawStatus: row.status,
    brand: row.brand,
    size: row.size,
    color: row.color,
    measuredAt: row.measured_at,
    saleDate: row.sale_date,
    saleTs: row.sale_ts,
    salePrice: row.sale_price,
    rowNum: row.row_num,
    thumbUrl: row.thumb_url || '',
    extra,
  };
}

// GET /api/products/counts → 各フィルタの件数を返す
// Cache API + KV による SWR キャッシュ（TTL30s + 60s 以内なら stale 返却 + 裏で再生成）。
// 9人 × 30s ポーリングで 18req/分の固定負荷だった D1 集約をほぼ消す。
const COUNTS_CACHE_KEY = 'https://cache.local/products/counts/v1';
const COUNTS_TTL_SEC = 30;
const COUNTS_STALE_SEC = 60;

async function computeCounts_(env) {
  const ds = `(${DERIVED_STATUS})`;
  // 出品待ち・出品作業中は納品場所が仮置き場の行を除外（フィルタ側と同条件）
  const ex = shuppinPlaceClause_(await getShuppinExcludePlaces_(env));
  const buckets = {
    sokutei_machi:  `${ds} = '採寸待ち'`,
    satsuei_machi:  `${ds} = '撮影待ち'`,
    shuppin_machi:  `${ds} = '出品待ち' AND ${ex.clause}`,
    shuppin_sagyou: `${ds} = '出品作業中' AND ${ex.clause}`,
    shuppinchu:     `${ds} = '出品中'`,
    // hassou バッジ = 「これから対応が必要な発送待ち/発送済み」の件数だけを数える。
    //   filter=hassou のリスト側（上部）は完了枝 `OR (${D_KANRYOU} AND ${SALE_WITHIN_3M})` を持ち、
    //   完了チップに販売3か月以内の完了行も表示するが、バッジ側はその完了枝を意図的に欠いている。
    //   完了行はバッジの「要対応件数」に含めない設計なので、バッジ ≤ リスト件数となるのは正常。
    hassou:         `((status = '発送待ち' AND NOT ${D_HASSOU}) OR status = '発送済み') AND NOT ${D_KANRYOU}`,
    sold:           `${ds} IN ('発送待ち','発送済み','売却済み')`,
  };
  const parts = Object.entries(buckets).map(([key, cond]) =>
    `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS ${key}`
  );
  // total は商品管理タブ「すべて」chip と一致させるため、売却済み/返品済みを除外。
  const sql = `SELECT
    SUM(CASE WHEN ${ds} NOT IN ('売却済み','返品済み') THEN 1 ELSE 0 END) AS total,
    ${parts.join(', ')}
    FROM products`;
  const stmt = env.DB.prepare(sql);
  // ex.clause は machi / sagyou の2バケツで使うため、プレースホルダ出現順に2回バインドする
  const row = await (ex.args.length ? stmt.bind(...ex.args, ...ex.args) : stmt).first();
  const counts = {};
  Object.keys(buckets).forEach(k => { counts[k] = Number(row[k] || 0); });
  counts.all = Number(row.total || 0);
  return { total: counts.all, counts, generatedAt: Date.now() };
}

export async function listProductCounts(request, env, ctx) {
  const cache = caches.default;
  const cacheReq = new Request(COUNTS_CACHE_KEY);
  try {
    const cached = await cache.match(cacheReq);
    if (cached) {
      const ageStr = cached.headers.get('X-Generated-At');
      const generatedAt = ageStr ? Number(ageStr) : 0;
      const ageSec = (Date.now() - generatedAt) / 1000;
      if (ageSec < COUNTS_TTL_SEC) {
        // フレッシュ
        return cached;
      }
      if (ageSec < (COUNTS_TTL_SEC + COUNTS_STALE_SEC)) {
        // stale: 裏で再生成、いまはキャッシュを返す
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(refreshCountsCache_(env, cache, cacheReq));
        }
        return cached;
      }
    }
    // miss or 完全期限切れ
    return await refreshCountsCache_(env, cache, cacheReq);
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

async function refreshCountsCache_(env, cache, cacheReq) {
  const data = await computeCounts_(env);
  const body = JSON.stringify({ ok: true, ...data });
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${COUNTS_TTL_SEC + COUNTS_STALE_SEC}`,
      'X-Generated-At': String(data.generatedAt),
      'Access-Control-Allow-Origin': '*',
    },
  });
  await cache.put(cacheReq, res.clone());
  return res;
}

// 書き込み API から呼んで counts キャッシュを即時無効化
export async function invalidateCountsCache() {
  try {
    await caches.default.delete(new Request(COUNTS_CACHE_KEY));
  } catch (e) {}
}

// POST /api/products/thumbs body: { kanris: [...] }
// タスキ箱（gas-proxy KV: product-images:<kanri>）から各管理番号のトップ画像URLを返す。
// 画像なしのキーは items から省かれる（フロント側で 📷 フォールバック）。
export async function listProductThumbs(request, env) {
  let body = null;
  try { body = await request.json(); } catch { return jsonError('invalid json', 400); }
  const kanris = Array.isArray(body && body.kanris)
    ? body.kanris.map(s => String(s || '').trim()).filter(Boolean)
    : [];
  if (kanris.length === 0) return jsonOk({ items: {} });
  if (kanris.length > 200) return jsonError('too many kanris (max 200)', 400);
  if (!env.GAS_PROXY_CACHE) return jsonOk({ items: {} });

  // FRONTEND_URL が無ければ gas-proxy のドメインに固定（KV パスは /images/... の相対）
  const baseUrl = (env.FRONTEND_URL || 'https://wholesale.nkonline-tool.com').replace(/\/$/, '');
  const items = {};

  // gas-proxy 側 KV キーは大文字 managedId（normalizeManagedId 適用後）。
  // shiire-kanri の products.kanri は小文字。両方を試して当たった方を返す。
  const upper = kanris.map(k => k.toUpperCase());
  const results = await Promise.all(upper.map(k =>
    env.GAS_PROXY_CACHE.get('product-images:' + k).catch(() => null)
  ));
  for (let i = 0; i < kanris.length; i++) {
    const raw = results[i];
    if (!raw) continue;
    let arr = null;
    try { arr = JSON.parse(raw); } catch { arr = null; }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const top = String(arr[0] || '').trim();
    if (!top) continue;
    // 元の kanri（小文字含む）をキーに返す → フロントの data-kanri と完全一致
    items[kanris[i]] = /^https?:/.test(top) ? top : (baseUrl + top);
  }
  return jsonOk({ items });
}

// GET /api/products/has-images
// gas-proxy KV `product-images:index` を 1read で返す（一覧の placeholder 振り分け用）。
// これがあると「画像未登録 → 即 📷 / 画像あり → 📷→画像」を初回描画から区別できる。
// レスポンスは uppercase の管理番号配列。クライアントは Set にしてルックアップする。
export async function listKanrisWithImages(request, env) {
  if (!env.GAS_PROXY_CACHE) return jsonOk({ kanris: [] });
  const raw = await env.GAS_PROXY_CACHE.get('product-images:index').catch(() => null);
  if (!raw) return jsonOk({ kanris: [] });
  let arr = null;
  try { arr = JSON.parse(raw); } catch { arr = null; }
  if (!Array.isArray(arr)) return jsonOk({ kanris: [] });
  const kanris = arr.map(s => String(s || '').trim().toUpperCase()).filter(Boolean);
  return jsonOk({ kanris }, {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  });
}

// POST /admin/backfill-thumb-url?offset=0&limit=200 (X-Sync-Secret 必須)
// 既存商品の thumb_url を gas-proxy KV (product-images:<MID>) から流し込む 1回限りのバックフィル。
// Phase 2-A の D1 列追加後に初回 1 度だけ実行する想定。冪等（同値ならスキップ）。
// Workers の 30 秒/サブリクエスト数制限を回避するため、offset/limit でチャンク処理する。
// 呼び出し側は nextOffset が null になるまで連続実行する。
export async function backfillThumbUrl(request, env) {
  if (!env.GAS_PROXY_CACHE || !env.DB) {
    return jsonError('binding missing', 500);
  }
  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));

  const indexRaw = await env.GAS_PROXY_CACHE.get('product-images:index').catch(() => null);
  if (!indexRaw) return jsonOk({ scanned: 0, updated: 0, message: 'no index', nextOffset: null });
  let index = null;
  try { index = JSON.parse(indexRaw); } catch { index = null; }
  if (!Array.isArray(index)) return jsonOk({ scanned: 0, updated: 0, message: 'bad index', nextOffset: null });

  const total = index.length;
  const end = Math.min(offset + limit, total);
  const slice = index.slice(offset, end);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  for (const idRaw of slice) {
    const managedId = String(idRaw || '').trim().toUpperCase();
    if (!managedId) continue;
    const raw = await env.GAS_PROXY_CACHE.get('product-images:' + managedId).catch(() => null);
    if (!raw) continue;
    let arr = null;
    try { arr = JSON.parse(raw); } catch { arr = null; }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const newThumb = String(arr[0] || '').trim() || null;
    if (!newThumb) continue;

    const cur = await env.DB
      .prepare('SELECT kanri, thumb_url FROM products WHERE upper(kanri) = ?')
      .bind(managedId)
      .first();
    if (!cur) { missing++; continue; }
    if ((cur.thumb_url || null) === newThumb) { skipped++; continue; }
    await env.DB
      .prepare('UPDATE products SET thumb_url = ? WHERE kanri = ?')
      .bind(newThumb, cur.kanri)
      .run();
    updated++;
  }
  return jsonOk({
    total,
    offset,
    processed: slice.length,
    updated,
    skipped,
    missing,
    nextOffset: end >= total ? null : end,
  });
}

// GET /api/products/:kanri/images
// タスキ箱に登録された該当商品の全画像URLを配列で返す（詳細画面のサムネ表示用）。
// KV 形式は gas-proxy の `product-images:<管理番号大文字>` を JSON 配列で読み出す。
export async function getProductImages(request, env, kanri) {
  const k = String(kanri || '').trim();
  if (!k) return jsonError('kanri required', 400);
  if (!env.GAS_PROXY_CACHE) return jsonOk({ urls: [] });
  const baseUrl = (env.FRONTEND_URL || 'https://wholesale.nkonline-tool.com').replace(/\/$/, '');
  const raw = await env.GAS_PROXY_CACHE.get('product-images:' + k.toUpperCase()).catch(() => null);
  if (!raw) return jsonOk({ urls: [] });
  let arr = null;
  try { arr = JSON.parse(raw); } catch { arr = null; }
  if (!Array.isArray(arr)) return jsonOk({ urls: [] });
  const urls = arr.map(u => {
    const s = String(u || '').trim();
    if (!s) return '';
    return /^https?:/.test(s) ? s : (baseUrl + s);
  }).filter(Boolean);
  return jsonOk({ urls });
}

// GET /api/kanri/next?category=C
// 区分コードを受け取り、その区分での次の連番（max+1）を返す。
// 例: category=C のとき、zC で始まる kanri の最大番号 +1 を返す。
// ※ 商品管理テーブルの実在商品だけでなく、仕入れの予約レンジ(assigned_kanri)の
//    末尾も考慮する。SPA作成の仕入れは recalcAssignNumbers_ を経由しないため、
//    予約レンジ末尾が実在商品より先行することがあるため。
// #7 これは「予約・排他をしない助言的採番」である。MAX(=実在 + 楽観 INSERT 済 row_num=0
//    行も含む) + 1 を返すだけなので、createProduct が INSERT する前のサブ秒だけ並行呼び出しで
//    同番号が提案され得る。実際の二重採番の最終ガードは write-proxy.js createProduct 側
//    (row_num>0 / cross-box shiire_id 衝突を 409)。完全な原子予約はここを書込化する必要があり
//    （abandon 時の orphan 予約・番号スキップを生む）現行運用では未導入。
export async function getNextKanri(request, env) {
  const u = new URL(request.url);
  const category = (u.searchParams.get('category') || '').trim();
  if (!category) return jsonError('category required', 400);
  const prefix = 'z' + category;
  // ① 商品管理テーブルの実在商品の最大番号
  const sqlP = `
    SELECT MAX(CAST(SUBSTR(kanri, ?) AS INTEGER)) AS max_n
    FROM products
    WHERE SUBSTR(kanri, 1, ?) = ?
      AND CAST(SUBSTR(kanri, ?) AS INTEGER) > 0
  `;
  try {
    const rowP = await env.DB.prepare(sqlP).bind(prefix.length + 1, prefix.length, prefix, prefix.length + 1).first();
    let maxN = Number(rowP && rowP.max_n || 0);
    // ② 仕入れの予約レンジ(assigned_kanri)末尾も考慮（zC950~1074 → 1074）
    const rowsA = await env.DB.prepare(
      `SELECT assigned_kanri FROM purchases WHERE category = ? AND assigned_kanri != ''`
    ).bind(category).all();
    for (const r of (rowsA.results || [])) {
      const a = String(r.assigned_kanri || '').trim();
      if (a.substring(0, prefix.length) !== prefix) continue;
      const tail = a.indexOf('~') >= 0 ? a.substring(a.indexOf('~') + 1) : a.substring(prefix.length);
      const endN = parseInt(tail, 10);
      if (!isNaN(endN) && endN > maxN) maxN = endN;
    }
    return jsonOk({ category, prefix, maxN, nextKanri: prefix + (maxN + 1) });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/purchases/:sid/next-kanri
// 指定した仕入れIDの予約レンジ(assigned_kanri 例 zC950~1074)内で
// 未使用の先頭番号を返す。1仕入れID = 1箱 を連番で管理するため、
// 商品作成時の管理番号はその仕入れの予約レンジから採番する。
// #7 getNextKanri と同様に助言的採番。used は products(楽観 INSERT 済の row_num=0 行を含む)
//    から集めるため、先行 createProduct の楽観 INSERT が着地していれば後続呼び出しは自然に
//    次番号へ繰り上がる。最終的な二重採番ガードは createProduct 側。
export async function getNextKanriForPurchase(request, env, shiireId) {
  try {
    const pu = await env.DB.prepare(
      `SELECT shiire_id, category, assigned_kanri FROM purchases WHERE shiire_id = ? LIMIT 1`
    ).bind(shiireId).first();
    if (!pu) return jsonError('not found', 404);
    const category = String(pu.category || '').trim();
    const prefix = 'z' + category;
    const assigned = String(pu.assigned_kanri || '').trim();
    // 予約レンジを解析: "zC950~1074" → start=950, end=1074
    let startN = 0, endN = 0;
    if (assigned.indexOf('~') >= 0 && assigned.substring(0, prefix.length) === prefix) {
      const parts = assigned.substring(prefix.length).split('~');
      startN = parseInt(parts[0], 10);
      endN = parseInt(parts[1], 10);
      if (isNaN(startN)) startN = 0;
      if (isNaN(endN)) endN = 0;
    }
    // この仕入れに紐づく既存商品の番号を収集
    const rows = await env.DB.prepare(
      `SELECT kanri FROM products WHERE shiire_id = ?`
    ).bind(shiireId).all();
    const used = new Set();
    let maxUsed = 0;
    for (const r of (rows.results || [])) {
      const k = String(r.kanri || '').trim();
      if (k.substring(0, prefix.length) !== prefix) continue;
      const n = parseInt(k.substring(prefix.length), 10);
      if (!isNaN(n) && n > 0) { used.add(n); if (n > maxUsed) maxUsed = n; }
    }
    let nextN = 0;
    let withinRange = false;
    if (startN > 0 && endN >= startN) {
      // 予約レンジ内の未使用先頭番号
      for (let n = startN; n <= endN; n++) {
        if (!used.has(n)) { nextN = n; withinRange = true; break; }
      }
      // レンジが満杯ならレンジ末尾+1（オーバーフロー）
      if (nextN === 0) nextN = endN + 1;
    } else {
      // 予約レンジ未設定の旧仕入れ → 既存最大+1（フォールバック）
      nextN = maxUsed + 1;
    }
    return jsonOk({
      shiireId, category, prefix, assignedKanri: assigned,
      rangeStart: startN, rangeEnd: endN,
      registered: used.size, nextN, nextKanri: prefix + nextN,
      withinRange,
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

// GET /api/products/:kanri
export async function getProduct(request, env, kanri) {
  try {
    const row = await env.DB.prepare(`
      SELECT p.*, ${DERIVED_STATUS} AS derived_status,
             pu.date AS pu_date, pu.cost AS pu_cost, pu.place AS pu_place,
             pu.amount AS pu_amount, pu.shipping AS pu_shipping
      FROM products p
      LEFT JOIN purchases pu ON pu.shiire_id = p.shiire_id
      WHERE p.kanri = ? LIMIT 1
    `).bind(kanri).first();
    if (!row) return jsonError('not found', 404);
    return jsonOk({ item: formatProduct(row, true) });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}

function formatProduct(row, withDerived) {
  let measure = null;
  if (row.measure_json) {
    try { measure = JSON.parse(row.measure_json); } catch { measure = null; }
  }
  let extra = null;
  if (row.extra_json) {
    try { extra = JSON.parse(row.extra_json); } catch { extra = null; }
  }
  if (withDerived) {
    extra = extra || {};
    // 仕入れ管理シート由来の連動値（読取専用）— シート側に列が無い／空の場合のみ補完
    if (!extra['仕入れ日'] && row.pu_date) extra['仕入れ日'] = String(row.pu_date);
    if (!extra['納品場所'] && row.pu_place) extra['納品場所'] = String(row.pu_place);
    if (!extra['仕入れ値'] && row.pu_cost != null && row.pu_cost !== '') {
      extra['仕入れ値'] = Number(row.pu_cost);
    }
    // 計算系: シート側の値を優先、空なら都度算出
    const cost = Number(extra['仕入れ値'] || 0);
    const salePrice = Number(row.sale_price || 0);
    const saleShipping = Number(row.sale_shipping || 0);
    const saleFee = Number(row.sale_fee || 0);
    if (!extra['粗利'] && salePrice > 0) {
      extra['粗利'] = salePrice - saleShipping - saleFee;
    }
    if (!extra['利益'] && salePrice > 0) {
      extra['利益'] = salePrice - saleShipping - saleFee - cost;
    }
    if (!extra['利益率'] && salePrice > 0) {
      const rieki = salePrice - saleShipping - saleFee - cost;
      extra['利益率'] = (rieki / salePrice * 100).toFixed(1) + '%';
    }
    // 在庫日数: 仕入れ日 → 今日（販売日があればそこまで）
    if (!extra['在庫日数']) {
      const baseDateStr = extra['仕入れ日'];
      if (baseDateStr) {
        const start = new Date(baseDateStr);
        const end = row.sale_date ? new Date(row.sale_date) : new Date();
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          const days = Math.floor((end - start) / 86400000);
          if (days >= 0) extra['在庫日数'] = days;
        }
      }
    }
    // リードタイム: 出品日 → 販売日（なければ今日）。販売後は販売日で固定
    if (!extra['リードタイム']) {
      const startStr = extra['出品日'];
      if (startStr) {
        const a = new Date(startStr);
        const b = row.sale_date ? new Date(row.sale_date) : new Date();
        if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
          const days = Math.floor((b - a) / 86400000);
          if (days >= 0) extra['リードタイム'] = days;
        }
      }
    }
  }
  return {
    kanri: row.kanri,
    shiireId: row.shiire_id,
    worker: row.worker,
    status: row.derived_status || row.status,
    rawStatus: row.status,
    state: row.state,
    brand: row.brand,
    size: row.size,
    color: row.color,
    measure,
    measuredAt: row.measured_at,
    measuredBy: row.measured_by,
    saleDate: row.sale_date,
    salePlace: row.sale_place,
    salePrice: row.sale_price,
    saleShipping: row.sale_shipping,
    saleFee: row.sale_fee,
    saleTs: row.sale_ts,
    extra,
    row: row.row_num,
  };
}
