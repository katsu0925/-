import { jsonOk, jsonError } from '../utils/response.js';

// 売上ダッシュボード: 今月 / 前月 / 今年(YTD) / 前年(full or YTD同期間) / 月別 を 1リクエストで返す
// 計算: 売上(gross)=Σsale_price, 手数料=Σsale_fee, 送料=Σsale_shipping,
//        純売上(net)=gross - 手数料 - 送料, 件数=COUNT, 平均単価=gross/件数
// パラメータ:
//   ?year=YYYY  月別グラフ用の対象年（省略時=現在年）
export async function getSalesSummary(request, env) {
  const url = new URL(request.url);
  const tzOffsetMin = parseInt(url.searchParams.get('tz') || '-540', 10); // JST デフォルト
  const now = new Date(Date.now() - tzOffsetMin * 60 * 1000);
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth() + 1;
  const dd = now.getUTCDate();
  const lastMonth = mm === 1 ? { y: yyyy - 1, m: 12 } : { y: yyyy, m: mm - 1 };
  const fmtYm = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const fmtYmd = (y, m, d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const ymThis = fmtYm(yyyy, mm);
  const ymLast = fmtYm(lastMonth.y, lastMonth.m);
  const yearStr = String(yyyy);
  const yearLastStr = String(yyyy - 1);

  // 対象年（月別グラフ用）。デフォルトは現在年
  const yearParam = parseInt(url.searchParams.get('year') || String(yyyy), 10);
  const targetYear = isFinite(yearParam) ? yearParam : yyyy;
  const targetYearStr = String(targetYear);

  try {
    // 期間集計: 4 期間 + 前年同期(YTD と同じ MM-DD まで)
    // 前年同期 (YoY同期): 前年の 1/1 〜 今日と同じ MM-DD
    const ytdEndMmdd = fmtYmd(yyyy, mm, dd).slice(5); // "MM-DD"
    const lyearYtdEnd = `${yearLastStr}-${ytdEndMmdd}`;
    const sql = `
      SELECT
        SUM(CASE WHEN substr(sale_date,1,7) = ?1 THEN 1 ELSE 0 END) AS this_count,
        SUM(CASE WHEN substr(sale_date,1,7) = ?1 THEN COALESCE(sale_price,0) ELSE 0 END) AS this_gross,
        SUM(CASE WHEN substr(sale_date,1,7) = ?1 THEN COALESCE(sale_fee,0) ELSE 0 END) AS this_fee,
        SUM(CASE WHEN substr(sale_date,1,7) = ?1 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS this_ship,

        SUM(CASE WHEN substr(sale_date,1,7) = ?2 THEN 1 ELSE 0 END) AS last_count,
        SUM(CASE WHEN substr(sale_date,1,7) = ?2 THEN COALESCE(sale_price,0) ELSE 0 END) AS last_gross,
        SUM(CASE WHEN substr(sale_date,1,7) = ?2 THEN COALESCE(sale_fee,0) ELSE 0 END) AS last_fee,
        SUM(CASE WHEN substr(sale_date,1,7) = ?2 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS last_ship,

        SUM(CASE WHEN substr(sale_date,1,4) = ?3 THEN 1 ELSE 0 END) AS year_count,
        SUM(CASE WHEN substr(sale_date,1,4) = ?3 THEN COALESCE(sale_price,0) ELSE 0 END) AS year_gross,
        SUM(CASE WHEN substr(sale_date,1,4) = ?3 THEN COALESCE(sale_fee,0) ELSE 0 END) AS year_fee,
        SUM(CASE WHEN substr(sale_date,1,4) = ?3 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS year_ship,

        SUM(CASE WHEN substr(sale_date,1,4) = ?4 THEN 1 ELSE 0 END) AS lyear_count,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 THEN COALESCE(sale_price,0) ELSE 0 END) AS lyear_gross,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 THEN COALESCE(sale_fee,0) ELSE 0 END) AS lyear_fee,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS lyear_ship,

        SUM(CASE WHEN substr(sale_date,1,4) = ?4 AND substr(sale_date,6,5) <= ?5 THEN 1 ELSE 0 END) AS lytd_count,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 AND substr(sale_date,6,5) <= ?5 THEN COALESCE(sale_price,0) ELSE 0 END) AS lytd_gross,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 AND substr(sale_date,6,5) <= ?5 THEN COALESCE(sale_fee,0) ELSE 0 END) AS lytd_fee,
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 AND substr(sale_date,6,5) <= ?5 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS lytd_ship
      FROM products
      WHERE sale_date IS NOT NULL AND sale_date <> ''
    `;
    const row = await env.DB.prepare(sql)
      .bind(ymThis, ymLast, yearStr, yearLastStr, ytdEndMmdd)
      .first();

    // 月別内訳（指定年）
    const monthlySql = `
      SELECT substr(sale_date,1,7) AS ym,
             COUNT(*) AS c,
             COALESCE(SUM(sale_price),0) AS gross,
             COALESCE(SUM(sale_fee),0) AS fee,
             COALESCE(SUM(sale_shipping),0) AS ship
      FROM products
      WHERE sale_date LIKE ?1
      GROUP BY ym
      ORDER BY ym
    `;
    const monthlyRows = (await env.DB.prepare(monthlySql).bind(`${targetYearStr}-%`).all()).results || [];
    const monthlyMap = {};
    monthlyRows.forEach(r => { monthlyMap[r.ym] = r; });
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const ym = fmtYm(targetYear, m);
      const r = monthlyMap[ym];
      const c = Number(r ? r.c : 0);
      const gross = Number(r ? r.gross : 0);
      const fee = Number(r ? r.fee : 0);
      const ship = Number(r ? r.ship : 0);
      monthly.push({
        yyyymm: ym, month: m, count: c,
        gross, fee, shipping: ship,
        net: gross - fee - ship,
      });
    }

    // 利用可能な年（売上データのある年）
    const yearsRows = (await env.DB.prepare(
      `SELECT DISTINCT substr(sale_date,1,4) AS y FROM products WHERE sale_date IS NOT NULL AND sale_date <> '' ORDER BY y DESC`
    ).all()).results || [];
    const availableYears = yearsRows.map(r => Number(r.y)).filter(y => isFinite(y) && y > 2000);
    if (!availableYears.includes(yyyy)) availableYears.unshift(yyyy);
    if (!availableYears.includes(targetYear)) availableYears.push(targetYear);
    availableYears.sort((a, b) => b - a);

    const buildPeriod = (cnt, gross, fee, ship) => {
      const c = Number(cnt || 0);
      const g = Number(gross || 0);
      const f = Number(fee || 0);
      const s = Number(ship || 0);
      const net = g - f - s;
      return {
        count: c, gross: g, fee: f, shipping: s, net,
        avg: c ? Math.round(g / c) : 0,
      };
    };

    return jsonOk({
      now: { year: yyyy, month: mm, ym: ymThis, ymd: fmtYmd(yyyy, mm, dd) },
      thisMonth: { yyyymm: ymThis, ...buildPeriod(row.this_count, row.this_gross, row.this_fee, row.this_ship) },
      lastMonth: { yyyymm: ymLast, ...buildPeriod(row.last_count, row.last_gross, row.last_fee, row.last_ship) },
      thisYear:  { year: yyyy,     ytd: true, ...buildPeriod(row.year_count, row.year_gross, row.year_fee, row.year_ship) },
      lastYear:  { year: yyyy - 1, ytd: false, ...buildPeriod(row.lyear_count, row.lyear_gross, row.lyear_fee, row.lyear_ship) },
      lastYearYtd: { year: yyyy - 1, ytdEnd: ytdEndMmdd, ...buildPeriod(row.lytd_count, row.lytd_gross, row.lytd_fee, row.lytd_ship) },
      monthly,
      monthlyYear: targetYear,
      availableYears,
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}
