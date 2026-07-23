/**
 * クーポンAPI（Phase 3）
 *
 * apiValidateCoupon — D1 coupons + coupon_usage で検証
 */
import { jsonOk, jsonError } from '../utils/response.js';

/**
 * apiValidateCoupon — クーポン検証
 *
 * GAS validateCoupon_ と同じ検証ロジックを再現。
 * フロントエンドからの呼び出し形式:
 *   runApi('apiValidateCoupon', code, email, productAmount, channel, productIds, customerName)
 * → args = [code, email, productAmount, channel, productIds, customerName]
 *
 * GAS関数シグネチャ: apiValidateCoupon(code, email, productAmount, channel, productIds, customerName)
 */
export async function validateCoupon(args, env) {
  const code = String(args[0] || '').trim().toUpperCase();
  const email = String(args[1] || '').trim().toLowerCase();
  // args[2] = productAmount (Workers側では不使用)
  const channel = String(args[3] || 'all').trim();
  const productIds = args[4] || [];
  const customerName = String(args[5] || '').trim();

  if (!code) {
    return jsonOk({ ok: false, message: 'クーポンコードを入力してください。' });
  }

  // D1からクーポン検索
  const coupon = await env.DB.prepare(
    'SELECT * FROM coupons WHERE code = ?'
  ).bind(code).first();

  if (!coupon || !coupon.active) {
    return jsonOk({ ok: false, message: '無効なクーポンコードです。' });
  }

  // 限定顧客チェック
  if (coupon.target_customer_email && coupon.target_customer_email !== email) {
    return jsonOk({ ok: false, message: 'このクーポンはご利用いただけません。' });
  }
  if (coupon.target_customer_name && coupon.target_customer_name !== customerName) {
    return jsonOk({ ok: false, message: 'このクーポンはご利用いただけません。' });
  }

  // チャネルチェック
  if (coupon.channel !== 'all' && coupon.channel !== channel) {
    return jsonOk({ ok: false, message: 'このクーポンは対象外のチャネルです。' });
  }

  // 対象商品チェック（GAS Coupon.gs validateCoupon_ と同一意味論:
  // bulk専用 or all のクーポンを bulk チャネルから使う時のみ照合する。
  // detauri個品側は商品IDの体系が異なるため対象外。比較は両辺 trim + 大文字化）
  const couponChannel = coupon.channel || 'all';
  if ((couponChannel === 'bulk' || couponChannel === 'all') && channel === 'bulk' && coupon.target_products) {
    const allowedIds = coupon.target_products.split(',')
      .map(s => s.trim().toUpperCase()).filter(Boolean);
    if (allowedIds.length > 0 && productIds && productIds.length > 0) {
      const hasMatch = productIds.some(pid => allowedIds.includes(String(pid).trim().toUpperCase()));
      if (!hasMatch) {
        return jsonOk({ ok: false, message: 'このクーポンはカート内の商品に適用できません' });
      }
    }
  }

  // 開始日・有効期限チェック（GAS Coupon.gs validateCoupon_ と同一意味論:
  // JSTの日付部で比較し、開始日は当日0:00から・失効日は当日23:59:59まで有効。
  // GAS側は setHours がスクリプトTZ(JST)で丸められるため、Worker側(UTC)では
  // +9時間シフト後のUTC getterでJST日付部を取り出し文字列比較で再現する）
  const jstDatePart = (d) => {
    const t = new Date(d.getTime() + 9 * 3600 * 1000);
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(t.getUTCDate()).padStart(2, '0');
    return t.getUTCFullYear() + '-' + mm + '-' + dd;
  };
  const todayJst = jstDatePart(new Date());

  if (coupon.start_date) {
    const start = new Date(coupon.start_date);
    if (!isNaN(start.getTime()) && todayJst < jstDatePart(start)) {
      return jsonOk({ ok: false, message: 'このクーポンはまだ利用期間前です' });
    }
  }

  if (coupon.expires_at) {
    const expires = new Date(coupon.expires_at);
    if (!isNaN(expires.getTime()) && todayJst > jstDatePart(expires)) {
      return jsonOk({ ok: false, message: 'このクーポンは期限切れです' });
    }
  }

  // 利用回数上限チェック
  if (coupon.max_uses > 0 && coupon.use_count >= coupon.max_uses) {
    return jsonOk({ ok: false, message: 'このクーポンは利用上限に達しています。' });
  }

  // 1回限り/ユーザーチェック
  if (coupon.once_per_user && email) {
    const used = await env.DB.prepare(
      'SELECT id FROM coupon_usage WHERE code = ? AND email = ? LIMIT 1'
    ).bind(code, email).first();

    if (used) {
      return jsonOk({ ok: false, message: 'このクーポンは既にご利用済みです。' });
    }
  }

  // ターゲット顧客チェック（new/repeat）
  // GAS Coupon.gs validateCoupon_ と同一意味論: 注文履歴の有無で判定する。
  // customers.purchase_count は完了時にしか増えないため、注文直後の顧客が
  // 「新規」のまま扱われる差異があった。D1 orders は依頼管理＋アーカイブの
  // 全行ミラー（email小文字化・全ステータス）で GAS getOrderHistory_ と同等。
  if (coupon.target === 'new' || coupon.target === 'repeat') {
    const orderRow = email ? await env.DB.prepare(
      'SELECT 1 AS one FROM orders WHERE email = ? LIMIT 1'
    ).bind(email).first() : null;
    const hasOrders = !!orderRow;

    if (coupon.target === 'new' && hasOrders) {
      return jsonOk({ ok: false, message: 'このクーポンは初回注文のお客様限定です' });
    }
    if (coupon.target === 'repeat' && !hasOrders) {
      return jsonOk({ ok: false, message: 'このクーポンはリピーターのお客様限定です' });
    }
  }

  // 検証成功
  // 送料無料フラグ・表示ラベル（GAS apiValidateCoupon と一致）
  const freeShipping = coupon.type === 'shipping_free' || coupon.free_shipping === 1;
  let label = coupon.type === 'rate'
    ? (Math.round(coupon.value * 100) + '%OFF')
    : coupon.type === 'shipping_free'
      ? '送料無料'
      : (coupon.value + '円引き');
  if (freeShipping && coupon.type !== 'shipping_free') label += '＋送料無料';

  return jsonOk({
    type: coupon.type,
    value: coupon.value,
    label,
    freeShipping,
    comboMember: coupon.combo_member === 1,
    comboBulk: coupon.combo_bulk === 1,
    shippingExcludeProducts: coupon.shipping_exclude_products || '',
  });
}
