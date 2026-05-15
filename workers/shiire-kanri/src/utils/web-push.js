// Web Push の最小自前実装（Cloudflare Workers 環境用）
// - VAPID JWT (ECDSA P-256, ES256) を生成して Authorization ヘッダに付与
// - payload は aes128gcm スキーム (RFC8291) で暗号化
//   ECDH P-256 で共通秘密 → HKDF-SHA-256 で IKM/CEK/NONCE 派生 → AES-128-GCM
//
// 参考: RFC 8030 / 8291 / 8292、web-push-libs/web-push (Node.js) の実装
//
// 既存ライブラリを使わない理由: Cloudflare Workers に node:crypto は限定対応で、
// web-push パッケージの暗号化部分は移植コストが高い。Web Crypto API なら全機能利用可能。

// ---------- base64url ----------
function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4;
  const padded = pad ? str + '='.repeat(4 - pad) : str;
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s) { return new TextEncoder().encode(s); }

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ---------- VAPID JWT (ES256) ----------
// privateKeyB64Url は 32byte のスカラー (base64url)
// 公開鍵は uncompressed point (65byte: 0x04 || X || Y, base64url)
async function importVapidPrivateKey(privateKeyB64Url, publicKeyB64Url) {
  const d = b64urlDecode(privateKeyB64Url);
  const pubPoint = b64urlDecode(publicKeyB64Url);
  if (pubPoint[0] !== 0x04 || pubPoint.length !== 65) {
    throw new Error('VAPID public key must be uncompressed P-256 point (65 bytes)');
  }
  const x = pubPoint.slice(1, 33);
  const y = pubPoint.slice(33, 65);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: b64urlEncode(d),
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    ext: true,
  };
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

// audience は push endpoint のオリジン (https://fcm.googleapis.com など)
// expSeconds は現在時刻 + 12h など (最大 24h)
async function makeVapidJwt(audience, subject, publicKeyB64Url, privateKeyB64Url) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60, // 12h
    sub: subject,
  };
  const headerB64 = b64urlEncode(utf8(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(utf8(JSON.stringify(payload)));
  const signingInput = headerB64 + '.' + payloadB64;
  const key = await importVapidPrivateKey(privateKeyB64Url, publicKeyB64Url);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput)
  );
  // Web Crypto は raw r||s (64byte) を返すので JOSE 用にそのまま base64url
  const sigB64 = b64urlEncode(new Uint8Array(sig));
  return signingInput + '.' + sigB64;
}

// ---------- aes128gcm payload encryption (RFC 8291) ----------
// 入力: 受信者の p256dh (uncompressed point, base64url), auth (16byte, base64url), 平文
// 出力: 暗号化済みボディ (Uint8Array, header + ciphertext)
// header = salt(16) || rs(4 LE) || idlen(1) || keyid(idlen)
//   keyid には sender 公開鍵 (uncompressed 65byte) を入れる
async function encryptAes128Gcm(p256dhB64, authB64, plaintext) {
  const recipientPub = b64urlDecode(p256dhB64);
  const auth = b64urlDecode(authB64);
  if (recipientPub[0] !== 0x04 || recipientPub.length !== 65) {
    throw new Error('p256dh must be uncompressed P-256 (65 bytes)');
  }

  // 1) ephemeral sender keypair
  const senderKp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const senderPubJwk = await crypto.subtle.exportKey('jwk', senderKp.publicKey);
  const senderPubX = b64urlDecode(senderPubJwk.x);
  const senderPubY = b64urlDecode(senderPubJwk.y);
  const senderPubRaw = concatBytes(new Uint8Array([0x04]), senderPubX, senderPubY);

  // 2) ECDH 共通秘密
  const recipientPubKey = await crypto.subtle.importKey(
    'raw', recipientPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPubKey },
    senderKp.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // 3) salt (16byte ランダム)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 4) IKM = HKDF(auth, sharedSecret, info="WebPush: info\0" || ua_public || as_public, 32)
  const infoIkm = concatBytes(
    utf8('WebPush: info\0'),
    recipientPub,    // ua public
    senderPubRaw     // as public
  );
  const ikm = await hkdf(auth, sharedSecret, infoIkm, 32);

  // 5) CEK = HKDF(salt, IKM, info="Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);

  // 6) NONCE = HKDF(salt, IKM, info="Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // 7) 平文 + 0x02 (last record marker for aes128gcm) を AES-128-GCM で暗号化
  const plain = typeof plaintext === 'string' ? utf8(plaintext) : plaintext;
  const padded = concatBytes(plain, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey(
    'raw', cek,
    { name: 'AES-GCM' },
    false, ['encrypt']
  );
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    padded
  );
  const ciphertext = new Uint8Array(ct);

  // 8) header 構築
  const rs = 4096; // record size。1 record で送るので十分大きく
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs, false); // RFC は network byte order = big-endian
  const idlen = senderPubRaw.length; // 65
  const header = concatBytes(salt, rsBytes, new Uint8Array([idlen]), senderPubRaw);

  return concatBytes(header, ciphertext);
}

async function hkdf(salt, ikm, info, length) {
  const baseKey = await crypto.subtle.importKey(
    'raw', ikm,
    { name: 'HKDF' },
    false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    length * 8
  );
  return new Uint8Array(bits);
}

// ---------- 送信本体 ----------
// subscription: { endpoint, keys: { p256dh, auth } }
// payload: 文字列 or null (null は keepalive)
// vapid: { publicKey, privateKey, subject }
// 戻り値: { ok, status, expired (410/404 の場合 true) }
export async function sendWebPush(subscription, payload, vapid) {
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const jwt = await makeVapidJwt(audience, vapid.subject, vapid.publicKey, vapid.privateKey);

  let body = null;
  const headers = {
    'Authorization': 'vapid t=' + jwt + ', k=' + vapid.publicKey,
    'TTL': '86400', // 24h
  };
  if (payload != null) {
    const encrypted = await encryptAes128Gcm(
      subscription.keys.p256dh,
      subscription.keys.auth,
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    );
    body = encrypted;
    headers['Content-Encoding'] = 'aes128gcm';
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Length'] = String(encrypted.byteLength);
  } else {
    headers['Content-Length'] = '0';
  }

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
  });

  return {
    ok: res.ok,
    status: res.status,
    // 410 Gone / 404 Not Found は subscription が無効化されている
    expired: res.status === 410 || res.status === 404,
  };
}
