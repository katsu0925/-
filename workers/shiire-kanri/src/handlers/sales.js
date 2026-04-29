import { jsonOk, jsonError } from '../utils/response.js';

// 売上ダッシュボード: 今月 / 前月 / 通年 / 月別内訳 を 1リクエストで返す
// 計算: 売上(gross)=Σsale_price, 手数料=Σsale_fee, 送料=Σsale_shipping,
//        純売上(net)=gross - 手数料 - 送料, 件数=COUNT, 平均単価=gross/件数
export async function getSalesSummary(request, env) {
  const url = new URL(request.url);
  const tzOffsetMin = parseInt(url.searchParams.get('tz') || '-540', 10); // JST デフォルト
  const now = new Date(Date.now() - tzOffsetMin * 60 * 1000);
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth() + 1;
  const lastMonth = mm === 1 ? { y: yyyy - 1, m: 12 } : { y: yyyy, m: mm - 1 };
  const fmtYm = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

  const ymThis = fmtYm(yyyy, mm);
  const ymLast = fmtYm(lastMonth.y, lastMonth.m);
  const yearStr = String(yyyy);
  const yearLastStr = String(yyyy - 1);

  try {
    // 期間集計: ひとつのクエリで CASE WHEN により 4 期間を一括算出
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
        SUM(CASE WHEN substr(sale_date,1,4) = ?4 THEN COALESCE(sale_shipping,0) ELSE 0 END) AS lyear_ship
      FROM products
      WHERE sale_date IS NOT NULL AND sale_date <> ''
    `;
    const row = await env.DB.prepare(sql).bind(ymThis, ymLast, yearStr, yearLastStr).first();

    // 月別内訳（今年）
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
    const monthlyRows = (await env.DB.prepare(monthlySql).bind(`${yearStr}-%`).all()).results || [];
    const monthlyMap = {};
    monthlyRows.forEach(r => { monthlyMap[r.ym] = r; });
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const ym = fmtYm(yyyy, m);
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
      now: { year: yyyy, month: mm, ym: ymThis },
      thisMonth: { yyyymm: ymThis, ...buildPeriod(row.this_count, row.this_gross, row.this_fee, row.this_ship) },
      lastMonth: { yyyymm: ymLast, ...buildPeriod(row.last_count, row.last_gross, row.last_fee, row.last_ship) },
      thisYear:  { year: yyyy,     ...buildPeriod(row.year_count, row.year_gross, row.year_fee, row.year_ship) },
      lastYear:  { year: yyyy - 1, ...buildPeriod(row.lyear_count, row.lyear_gross, row.lyear_fee, row.lyear_ship) },
      monthly,
    });
  } catch (err) {
    return jsonError('db error: ' + err.message, 500);
  }
}
