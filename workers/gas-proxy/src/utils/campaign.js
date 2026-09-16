/**
 * キャンペーン期限の判定
 *
 * D1 settings の FIRST_HALF_PRICE_STATUS / MEMBER_DISCOUNT_STATUS は
 * GAS が5分Cronで流すスナップショット。GAS側（Config.gs app_getFirstHalfPriceStatus_）は
 * endDate を過ぎると enabled:false / reason:'expired' を返すので、通常は同期されて止まる。
 *
 * ただし Worker 側は enabled しか見ていなかったため、同期が止まると
 * 期限切れのキャンペーンが本番で効き続ける。注文送信は Worker 完結で
 * GAS フォールバックが無い（index.js の WORKER_HANDLED 参照）ため、
 * Worker 単体でも endDate を判定して二重化する。
 */

/** JSTの日付部（yyyy-mm-dd）を返す。submit.js のクーポン期間判定と同一意味論 */
function jstDatePart(d) {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return t.getUTCFullYear() + '-' + mm + '-' + dd;
}

/**
 * キャンペーンが現時点で有効か。
 * endDate は「当日23:59:59まで有効」（GAS Config.gs と同じ）。
 * endDate が無い・壊れている場合は enabled だけで判定する（既存挙動を変えない）。
 *
 * @param {{enabled?: boolean, endDate?: string}|null} status
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isCampaignActive(status, now) {
  if (!status || !status.enabled) return false;
  if (!status.endDate) return true;
  const end = new Date(status.endDate);
  if (isNaN(end.getTime())) return true;
  return jstDatePart(now instanceof Date ? now : new Date()) <= jstDatePart(end);
}
