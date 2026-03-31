/**
 * CORS・レスポンスヘルパー
 *
 * CORSオリジンはリクエスト単位で制御可能。
 * モジュールレベル変数にリクエスト固有データを保存しない（Cross-request data leak防止）。
 */

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function corsResponse(response, origin) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export function corsOptions(origin) {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function jsonOk(data, extra = {}) {
  return corsResponse(new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json', ...extra },
  }));
}

export function jsonError(message, status = 400) {
  return corsResponse(new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

export function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
