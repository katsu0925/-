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

  // 対象商品チェック（bulk + targetProducts設定時）
  if (coupon.target_products && productIds.length > 0) {
    const targets = coupon.target_products.split(',').map(s => s.trim()).filter(Boolean);
    if (targets.length > 0) {
      const hasMatch = productIds.some(pid => targets.includes(pid));
      if (!hasMatch) {
        return jsonOk({ ok: false, message: 'このクーポンは対象商品がカートにありません。' });
      }
    }
  }

  // 開始日チェック
  if (coupon.start_date) {
    const now = new Date();
    const start = new Date(coupon.start_date);
    if (now < start) {
      return jsonOk({ ok: false, message: 'このクーポンはまだ有効期間前です。' });
    }
  }

  // 有効期限チェック
  if (coupon.expires_at) {
    const now = new Date();
    const expires = new Date(coupon.expires_at);
    if (now > expires) {
      return jsonOk({ ok: false, message: 'このクーポンは有効期限切れです。' });
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
  if (coupon.target !== 'all' && email) {
    const customer = await env.DB.prepare(
      'SELECT purchase_count FROM customers WHERE email = ?'
    ).bind(email).first();

    const purchaseCount = customer ? customer.purchase_count : 0;

    if (coupon.target === 'new' && purchaseCount > 0) {
      return jsonOk({ ok: false, message: 'このクーポンは新規のお客様限定です。' });
    }
    if (coupon.target === 'repeat' && purchaseCount === 0) {
      return jsonOk({ ok: false, message: 'このクーポンはリピーターのお客様限定です。' });
    }
  }

  // 検証成功
  return jsonOk({
    type: coupon.type,
    value: coupon.value,
    comboMember: coupon.combo_member === 1,
    comboBulk: coupon.combo_bulk === 1,
    shippingExcludeProducts: coupon.shipping_exclude_products || '',
  });
}
