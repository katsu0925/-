/**
 * Meta Conversions API (CAPI) ユーティリティ
 *
 * サーバーサイドからMeta Graph APIにイベントを送信する。
 * ブラウザ側のPixel (fbq) と重複排除されるよう event_id を共有する。
 *
 * 必要なシークレット:
 *   META_PIXEL_ID        — Pixel ID (例: 2122295911954697)
 *   META_ACCESS_TOKEN     — Conversions API アクセストークン（Events Managerで生成）
 */

const GRAPH_API_VERSION = 'v22.0';
const GRAPH_API_BASE = 'https://graph.facebook.com';

/**
 * SHA-256ハッシュ化（Meta CAPIの要件: email, phone等は事前にハッシュ化）
 */
async function sha256(value) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const encoded = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * CAPIイベントを送信
 *
 * @param {object} env - Workers環境変数
 * @param {object} opts
 * @param {string} opts.eventName - 'Purchase', 'CompleteRegistration', 'AddToCart' 等
 * @param {string} opts.eventId - 重複排除用ID（フロント側のevent_idと一致させる）
 * @param {string} opts.sourceUrl - イベント発生ページのURL
 * @param {object} opts.userData - ユーザー情報 { email, phone, firstName, lastName, city, state, zip, country, externalId, clientIpAddress, clientUserAgent, fbc, fbp }
 * @param {object} [opts.customData] - カスタムデータ { currency, value, content_name, content_ids, content_type, num_items }
 * @param {number} [opts.eventTime] - UNIXタイムスタンプ（秒）。省略時は現在時刻
 */
export async function sendEvent(env, opts) {
  const pixelId = env.META_PIXEL_ID;
  const accessToken = env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.warn('meta-capi: META_PIXEL_ID or META_ACCESS_TOKEN not configured, skipping');
    return null;
  }

  const {
    eventName,
    eventId,
    sourceUrl,
    userData = {},
    customData,
    eventTime,
  } = opts;

  // ユーザーデータのハッシュ化（Meta要件）
  const user_data = {};
  if (userData.email) user_data.em = [await sha256(userData.email)];
  if (userData.phone) user_data.ph = [await sha256(userData.phone.replace(/[-ー\s]/g, ''))];
  if (userData.firstName) user_data.fn = [await sha256(userData.firstName)];
  if (userData.lastName) user_data.ln = [await sha256(userData.lastName)];
  if (userData.city) user_data.ct = [await sha256(userData.city)];
  if (userData.state) user_data.st = [await sha256(userData.state)];
  if (userData.zip) user_data.zp = [await sha256(userData.zip.replace(/[-ー\s]/g, ''))];
  if (userData.country) user_data.country = [await sha256(userData.country)];
  if (userData.externalId) user_data.external_id = [await sha256(userData.externalId)];
  if (userData.clientIpAddress) user_data.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) user_data.client_user_agent = userData.clientUserAgent;
  if (userData.fbc) user_data.fbc = userData.fbc;
  if (userData.fbp) user_data.fbp = userData.fbp;

  const eventData = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: sourceUrl || 'https://wholesale.nkonline-tool.com/',
    user_data,
  };

  if (eventId) eventData.event_id = eventId;
  if (customData) eventData.custom_data = customData;

  const payload = {
    data: [eventData],
  };

  const url = `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await resp.json();

    if (!resp.ok) {
      console.error('meta-capi error:', JSON.stringify(result));
      return { ok: false, error: result };
    }

    console.log('meta-capi sent:', eventName, 'events_received:', result.events_received);
    return { ok: true, events_received: result.events_received };
  } catch (err) {
    console.error('meta-capi fetch error:', err.message);
    return { ok: false, error: err.message };
  }
}
