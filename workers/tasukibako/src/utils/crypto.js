/**
 * パスワードハッシュ（Web Crypto API）
 * v2:salt:hex(SHA-256 × 1000回)
 */

async function sha256bytes(input) {
  return crypto.subtle.digest('SHA-256', input);
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function gasStringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes[i] = code > 127 ? 0x3F : code;
  }
  return bytes;
}

export async function hashWithIterations(password, salt, iterations) {
  const input = gasStringToBytes(password + ':' + salt);
  let hash = new Uint8Array(await sha256bytes(input));

  if (iterations > 1) {
    const saltHash = new Uint8Array(await sha256bytes(gasStringToBytes(salt)));
    for (let i = 1; i < iterations; i++) {
      const combined = new Uint8Array(hash.length + saltHash.length);
      combined.set(hash, 0);
      combined.set(saltHash, hash.length);
      hash = new Uint8Array(await sha256bytes(combined));
    }
  }

  return bufToHex(hash.buffer);
}

export async function hashPasswordV2(password, salt) {
  return hashWithIterations(password, salt, 1000);
}

export async function createPasswordHash(password) {
  const salt = generateRandomHex(16);
  const hash = await hashPasswordV2(password, salt);
  return `v2:${salt}:${hash}`;
}

/**
 * パスワード検証（v2形式のみ、1000回固定）
 * タスキ箱は新規サービスのため旧10000回フォールバック不要
 */
export async function verifyPasswordV2(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('v2:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;

  const [, salt, expectedHash] = parts;
  const computed = await hashWithIterations(password, salt, 1000);
  return timingSafeEqual(computed, expectedHash);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

export function generateRandomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer).slice(0, length);
}

export function generateSessionId() {
  return generateRandomHex(32);
}

export function generateCsrfToken() {
  return generateRandomHex(32);
}
