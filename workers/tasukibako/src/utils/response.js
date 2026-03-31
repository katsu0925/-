/**
 * CORS・レスポンスヘルパー
 * ALLOWED_ORIGIN は wrangler.toml の vars で設定可能
 */

let _allowedOrigin = '*';

export function setAllowedOrigin(origin) {
  _allowedOrigin = origin || '*';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': _allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function corsResponse(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export function corsOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
