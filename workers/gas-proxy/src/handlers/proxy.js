/**
 * GASプロキシ — 未移行APIはそのままGASに転送
 */
import { corsResponse } from '../utils/response.js';

/**
 * GAS Web AppにPOSTリクエストをプロキシ
 * @param {string} bodyText - 元のリクエストボディ
 * @param {object} env - Workers env (GAS_API_URL secret)
 */
export async function proxyToGas(bodyText, env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    return corsResponse(new Response(JSON.stringify({
      ok: false,
      message: 'GAS_API_URL not configured',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: bodyText,
    redirect: 'follow',
  });

  const text = await resp.text();
  return corsResponse(new Response(text, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Source': 'gas-proxy',
    },
  }));
}
