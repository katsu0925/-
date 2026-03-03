/**
 * パスワードハッシュ（Web Crypto API）
 *
 * GAS hashPasswordV2_ 互換:
 *   v2:salt:hex(SHA-256 × 1000回, input = password + salt)
 *
 * GAS Utilities.computeDigest(SHA_256, str) は UTF-8 エンコード後の
 * バイト列に対してSHA-256を計算し、符号付きバイト配列を返す。
 * Workers では TextEncoder (UTF-8) + crypto.subtle.digest で同等の結果を得る。
 */

/**
 * SHA-256 ハッシュを1回計算し、hexを返す
 */
async function sha256hex(input) {
  const encoded = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return bufToHex(hashBuf);
}

/**
 * ArrayBuffer → lowercase hex string
 */
function bufToHex(buf) {
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * v2 パスワードハッシュ生成（GAS互換: SHA-256 × 1000回）
 *
 * GASのhashPasswordV2_は以下の動作:
 *   hash = password + salt
 *   1000回: hash = Utilities.computeDigest(SHA_256, hash)  // バイト配列 → hex 変換せずバイト列を直接渡す
 * 最終結果をhex文字列化
 *
 * しかしGASのUtilities.computeDigest(SHA_256, string)はstringをUTF-8でエンコードする。
 * 中間ステップでバイト配列を再度computeDigestに渡す場合、
 * GASはバイト配列をtoString()でカンマ区切り文字列に変換してから処理する。
 *
 * → 正確な互換性のため、各イテレーションでhex文字列を入力として使用する方式を採用。
 * テストベクター比較で検証が必要。
 */
export async function hashPasswordV2(password, salt) {
  // GAS互換: 初回入力 = password + salt
  let hash = password + salt;

  for (let i = 0; i < 1000; i++) {
    hash = await sha256hex(hash);
  }

  return hash;
}

/**
 * フルハッシュ文字列を生成 ('v2:salt:hash')
 */
export async function createPasswordHash(password) {
  const salt = generateRandomHex(16);
  const hash = await hashPasswordV2(password, salt);
  return `v2:${salt}:${hash}`;
}

/**
 * パスワード検証（v2形式のみ。v1/legacyはGASフォールバック）
 */
export async function verifyPasswordV2(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('v2:')) {
    return { match: false, needsGasFallback: true };
  }

  const parts = storedHash.split(':');
  if (parts.length !== 3) {
    return { match: false, needsGasFallback: false };
  }

  const [, salt, expectedHash] = parts;
  const computed = await hashPasswordV2(password, salt);

  // タイミングセーフ比較
  const match = timingSafeEqual(computed, expectedHash);
  return { match, needsGasFallback: false };
}

/**
 * タイミングセーフ文字列比較
 */
function timingSafeEqual(a, b) {
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

/**
 * ランダムHex文字列生成
 */
export function generateRandomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer).slice(0, length);
}

/**
 * セッションID生成（32文字のランダムhex）
 */
export function generateSessionId() {
  return generateRandomHex(32);
}

/**
 * CSRFトークン生成（32文字のランダムhex）
 */
export function generateCsrfToken() {
  return generateRandomHex(32);
}
