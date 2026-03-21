// Pages Function: /kit → Workers にプロキシ
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const workersUrl = 'https://detauri-gas-proxy.nsdktts1030.workers.dev' + url.pathname + url.search;
  const resp = await fetch(workersUrl, {
    method: context.request.method,
    headers: context.request.headers,
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}
