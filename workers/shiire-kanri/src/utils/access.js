// Cloudflare Access JWT 検証
// Application AUD と Team Domain の公開鍵で署名検証
// 参考: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

const CERTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
let certsCache = null;

async function fetchCerts(team) {
  const now = Date.now();
  if (certsCache && certsCache.team === team && (now - certsCache.fetchedAt) < CERTS_CACHE_TTL_MS) {
    return certsCache.keys;
  }
  const url = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('access certs fetch failed: ' + res.status);
  const json = await res.json();
  certsCache = { team, keys: json.keys || [], fetchedAt: now };
  return certsCache.keys;
}

function base64UrlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeStr(s) {
  return new TextDecoder().decode(base64UrlDecode(s));
}

async function importJwk(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function verifyJwt(token, team, expectedAud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64UrlDecodeStr(headerB64));
  const payload = JSON.parse(base64UrlDecodeStr(payloadB64));

  // exp / aud
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error('jwt expired');
  if (expectedAud) {
    const audOk = Array.isArray(payload.aud)
      ? payload.aud.includes(expectedAud)
      : payload.aud === expectedAud;
    if (!audOk) throw new Error('aud mismatch');
  }

  // 署名検証
  const certs = await fetchCerts(team);
  const jwk = certs.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('signing key not found');
  const key = await importJwk(jwk);
  const sig = base64UrlDecode(sigB64);
  const data = new TextEncoder().encode(headerB64 + '.' + payloadB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('jwt signature invalid');

  return payload;
}

// リクエストから認可済みユーザー情報を取得
// 失敗時は null を返す（呼び出し側で 403）
//
// 短絡パス: token が存在しかつ cf-access-authenticated-user-email ヘッダが付いていれば
// Access edge が必ず上書きするヘッダなので RSA verify をスキップ（5-20ms 削減）。
// 外部からこのヘッダを偽装しても、Access 前段で必ず正規値に上書きされるため安全。
export async function getAccessUser(request, env) {
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;

  const team = env.CF_ACCESS_TEAM;
  const aud = env.CF_ACCESS_AUD;
  if (!team || !aud) {
    if (env.ALLOW_NO_ACCESS === '1') return { email: 'dev@local', anonymous: true };
    return null;
  }

  // 短絡: edge ヘッダがある = Access 通過済み（偽装不可）
  const edgeEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (edgeEmail) {
    return { email: edgeEmail, sub: '' };
  }

  try {
    const payload = await verifyJwt(token, team, aud);
    return { email: payload.email || '', sub: payload.sub || '' };
  } catch (err) {
    return null;
  }
}
