/**
 * マイページAPI（Phase 4 完全実装版）
 *
 * apiGetMyPage — D1 customers + orders テーブル
 *   - 注文履歴は orders テーブル（sheets-sync の 5分Cronで同期）
 *   - ランク: 12ヶ月ローリング購入金額 + graceルール + 復帰ゴールド→ダイヤ昇格
 *   - FHP: memberCap + 非キャンセル過去注文チェック
 *   - pointsExpiryDate: points_updated_at + 12ヶ月
 */
import { jsonOk, jsonError } from '../utils/response.js';

const RANK_TIERS = {
  DIAMOND: { name: 'ダイヤモンド', threshold: 500000, pointRate: 0.05, freeShipping: true,  color: '#00bcd4' },
  GOLD:    { name: 'ゴールド',     threshold: 200000, pointRate: 0.05, freeShipping: false, color: '#f59e0b' },
  SILVER:  { name: 'シルバー',     threshold: 50000,  pointRate: 0.03, freeShipping: false, color: '#94a3b8' },
  REGULAR: { name: 'レギュラー',   threshold: 0,      pointRate: 0.01, freeShipping: false, color: '#64748b' },
};

const POINT_EXPIRY_MONTHS = 12;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const TWO_YEARS_MS = 730 * 24 * 60 * 60 * 1000;

/**
 * Asia/Tokyo で yyyy/MM/dd フォーマット
 */
function formatDateJst(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${y}/${m}/${dd}`;
}

/**
 * Asia/Tokyo で N ヶ月後の日付を yyyy/MM/dd で返す
 */
function addMonthsJst(iso, months) {
  if (!iso) return '';
  const base = new Date(iso);
  if (isNaN(base.getTime())) return '';
  const jstParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(base);
  const y = Number(jstParts.find(p => p.type === 'year').value);
  const m = Number(jstParts.find(p => p.type === 'month').value);
  const d = Number(jstParts.find(p => p.type === 'day').value);
  const target = new Date(Date.UTC(y, m - 1, d));
  target.setUTCMonth(target.getUTCMonth() + months);
  const ty = target.getUTCFullYear();
  const tm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const td = String(target.getUTCDate()).padStart(2, '0');
  return `${ty}/${tm}/${td}`;
}

function rankFromSpent(spent) {
  if (spent >= 500000) return 'DIAMOND';
  if (spent >= 200000) return 'GOLD';
  if (spent >= 50000) return 'SILVER';
  return 'REGULAR';
}

function applyGraceRule(currentRank, prevRank, recentSpent) {
  if (currentRank === 'REGULAR' && (prevRank === 'DIAMOND' || prevRank === 'GOLD')) {
    if (recentSpent >= 50000) {
      return { rank: prevRank, info: { restored: true, prevRank } };
    }
    return { rank: currentRank, info: { restored: false, prevRank, needed: 50000 - recentSpent } };
  }
  return { rank: currentRank, info: null };
}

function getNextRankInfo(currentRank, graceInfo) {
  if (currentRank === 'REGULAR') return { nextRank: 'SILVER', nextThreshold: 50000 };
  if (currentRank === 'SILVER') return { nextRank: 'GOLD', nextThreshold: 200000 };
  if (currentRank === 'GOLD') {
    return { nextRank: 'DIAMOND', nextThreshold: (graceInfo && graceInfo.restored) ? 350000 : 500000 };
  }
  return { nextRank: null, nextThreshold: 0 };
}

function calcSpendByPeriod(orders, now) {
  const oneYearAgo = new Date(now.getTime() - ONE_YEAR_MS);
  const oneMonthAgo = new Date(now.getTime() - ONE_MONTH_MS);
  const twoYearsAgo = new Date(now.getTime() - TWO_YEARS_MS);

  let annualSpent = 0, recentSpent = 0, prevYearSpent = 0;
  for (const o of orders) {
    if (o.status !== '完了') continue;
    if (!o._orderDate) continue;
    const total = Number(o.total) || 0;
    if (o._orderDate >= oneYearAgo) annualSpent += total;
    if (o._orderDate >= oneMonthAgo) recentSpent += total;
    if (o._orderDate >= twoYearsAgo && o._orderDate < oneYearAgo) prevYearSpent += total;
  }
  return { annualSpent, recentSpent, prevYearSpent };
}

function calculateRankFromOrders(orders) {
  const now = new Date();
  const spend = calcSpendByPeriod(orders, now);
  const prevRank = rankFromSpent(spend.prevYearSpent);
  let currentRank = rankFromSpent(spend.annualSpent);

  const grace = applyGraceRule(currentRank, prevRank, spend.recentSpent);
  currentRank = grace.rank;

  // 復帰ゴールド限定: 年間35万円でダイヤ昇格
  if (currentRank === 'GOLD' && grace.info && grace.info.restored && prevRank === 'GOLD') {
    if (spend.annualSpent >= 350000) currentRank = 'DIAMOND';
  }

  const tier = RANK_TIERS[currentRank];
  const next = getNextRankInfo(currentRank, grace.info);

  return {
    rank: currentRank,
    name: tier.name,
    pointRate: tier.pointRate,
    freeShipping: tier.freeShipping,
    color: tier.color,
    annualSpent: spend.annualSpent,
    nextRank: next.nextRank ? RANK_TIERS[next.nextRank].name : null,
    nextThreshold: next.nextThreshold,
    remaining: next.nextThreshold > 0 ? Math.max(0, next.nextThreshold - spend.annualSpent) : 0,
    graceInfo: grace.info,
  };
}

/**
 * apiGetMyPage — マイページ情報取得
 *
 * @param {Array} args - [userKey, { sessionId }]
 */
export async function getMyPage(args, env) {
  const params = args[1] || args[0] || {};
  const { sessionId } = params;

  if (!sessionId) {
    return jsonError('セッションIDが必要です。');
  }

  const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!session) {
    return jsonError('セッションが無効です。ログインし直してください。');
  }

  if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
    await env.SESSIONS.delete(`session:${sessionId}`);
    return jsonError('セッションが期限切れです。ログインし直してください。');
  }

  const customer = await env.DB.prepare(`
    SELECT id, email, company_name, phone, postal, address,
           newsletter, points, points_updated_at, purchase_count, total_spent, created_at
    FROM customers WHERE id = ?
  `).bind(session.customerId).first();

  if (!customer) {
    return jsonError('顧客情報が見つかりません。');
  }

  const email = String(customer.email || '').toLowerCase();

  // 注文履歴（D1 orders テーブル）
  const { results: orderRows } = await env.DB.prepare(`
    SELECT receipt_no, order_date, products, item_count, total_amount,
           shipping_cost, status, carrier, tracking
    FROM orders WHERE email = ? ORDER BY order_date DESC
  `).bind(email).all();

  const orders = (orderRows || []).map(r => {
    const dt = r.order_date ? new Date(r.order_date) : null;
    return {
      receiptNo: r.receipt_no || '',
      date: formatDateJst(r.order_date),
      products: r.products || '',
      count: Number(r.item_count) || 0,
      total: Number(r.total_amount) || 0,
      status: r.status || '',
      shipping: r.shipping_cost ? String(r.shipping_cost) : '',
      carrier: r.carrier || '',
      tracking: r.tracking || '',
      _orderDate: dt && !isNaN(dt.getTime()) ? dt : null,
    };
  });

  // 統計
  let totalSpent = 0;
  let totalItems = 0;
  for (const o of orders) {
    totalSpent += Number(o.total) || 0;
    totalItems += Number(o.count) || 0;
  }
  const totalOrders = orders.length;

  // ランク
  const rankInfo = calculateRankFromOrders(orders);

  // ポイント有効期限
  let pointsExpiryDate = '';
  if ((customer.points || 0) > 0 && customer.points_updated_at) {
    pointsExpiryDate = addMonthsJst(customer.points_updated_at, POINT_EXPIRY_MONTHS);
  }

  // FHP判定
  let firstHalfPrice = { eligible: false, rate: 0.5 };
  const fhpRow = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('FIRST_HALF_PRICE_STATUS').first();
  if (fhpRow) {
    try {
      const fhp = JSON.parse(fhpRow.value);
      let eligible = !!(fhp.enabled && (customer.purchase_count || 0) === 0);

      // 非キャンセル過去注文があるかチェック（purchase_count列が古い場合の抜け穴対策）
      if (eligible) {
        const hasPrior = orders.some(o => {
          const s = (o.status || '').trim();
          return s && s !== 'キャンセル';
        });
        if (hasPrior) eligible = false;
      }

      // memberCap: 登録順 cap人目までのみ対象
      if (eligible && fhp.memberCap > 0) {
        const orderRow = await env.DB.prepare(
          'SELECT COUNT(*) AS cnt FROM customers WHERE created_at < ?'
        ).bind(customer.created_at).first();
        const registrationOrder = (orderRow && orderRow.cnt !== null) ? orderRow.cnt + 1 : fhp.memberCap + 1;
        if (registrationOrder > fhp.memberCap) eligible = false;
      }
      firstHalfPrice = { eligible, rate: fhp.rate || 0.5 };
    } catch (e) { /* ignore */ }
  }

  // _orderDate は内部用なので削除してレスポンス
  const ordersOut = orders.map(o => {
    const { _orderDate, ...rest } = o;
    return rest;
  });

  return jsonOk({ data: {
    profile: {
      email: customer.email,
      companyName: customer.company_name,
      phone: String(customer.phone || '').replace(/^'/, ''),
      postal: String(customer.postal || '').replace(/^'/, ''),
      address: customer.address,
      newsletter: customer.newsletter === 1,
      registeredAt: formatDateJst(customer.created_at),
    },
    points: customer.points || 0,
    pointsExpiryDate,
    orders: ordersOut,
    stats: { totalOrders, totalSpent, totalItems },
    firstHalfPrice,
    rank: {
      name: rankInfo.name,
      rank: rankInfo.rank,
      pointRate: rankInfo.pointRate,
      freeShipping: rankInfo.freeShipping,
      color: rankInfo.color,
      annualSpent: rankInfo.annualSpent,
      nextRank: rankInfo.nextRank,
      nextThreshold: rankInfo.nextThreshold,
      remaining: rankInfo.remaining,
      graceInfo: rankInfo.graceInfo,
    },
  }});
}

/**
 * apiGetReferralCode — 紹介コード取得
 *
 * @param {Array} args - [userKey, { sessionId }]
 */
export async function getReferralCode(args, env) {
  const params = args[1] || args[0] || {};
  const { sessionId } = params;

  if (!sessionId) {
    return jsonOk({ ok: false, message: 'ログインが必要です' });
  }

  const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!session || !session.customerId) {
    return jsonOk({ ok: false, message: 'セッションが無効です。再ログインしてください' });
  }

  const referralCode = 'REF-' + session.customerId;
  const siteUrl = (env.FRONTEND_URL || 'https://wholesale.nkonline-tool.com').replace(/\/+$/, '');
  const referralUrl = siteUrl + '?ref=' + encodeURIComponent(referralCode);

  return jsonOk({
    data: {
      referralCode,
      referralUrl,
    },
  });
}
