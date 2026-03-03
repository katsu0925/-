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
 * SHA-256 ハッシュ（バイト配列入力 → ArrayBuffer出力）
 */
async function sha256bytes(input) {
  return crypto.subtle.digest('SHA-256', input);
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
 * GAS互換: Utilities.computeDigest(algo, string) のエンコーディング
 * GASのデフォルトはUS_ASCII: 非ASCII文字は 0x3F ('?') に置換される
 */
function gasStringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes[i] = code > 127 ? 0x3F : code;
  }
  return bytes;
}

/**
 * v2 パスワードハッシュ生成（GAS hashPasswordV2_ 完全互換）
 *
 * GASのアルゴリズム (CustomerAuth.gs:33-46):
 *   1. input = password + ':' + salt
 *   2. hash = SHA-256(US_ASCII(input))  → バイト配列(32bytes)
 *      ※ GASのcomputeDigest(algo, string)はUS_ASCIIエンコード（非ASCII→0x3F '?'）
 *   3. saltHash = SHA-256(Blob(salt).getBytes()) → バイト配列(32bytes)
 *      ※ Blob.getBytes()はUTF-8だがsaltはASCII hexなので同一
 *   4. 999回: hash = SHA-256(hash.concat(saltHash))  → バイト配列結合(64bytes)→SHA-256
 *   5. 最終バイト配列をhex変換
 */
export async function hashWithIterations(password, salt, iterations) {
  // Step 1-2: 初回ハッシュ = SHA-256(US_ASCII(password + ':' + salt))
  const input = gasStringToBytes(password + ':' + salt);
  let hash = new Uint8Array(await sha256bytes(input));

  if (iterations > 1) {
    // Step 3: saltHash = SHA-256(salt) — saltはASCIIなのでどのエンコーディングでも同一
    const saltHash = new Uint8Array(await sha256bytes(gasStringToBytes(salt)));

    // Step 4: (iterations-1)回反復 hash = SHA-256(hash + saltHash)
    for (let i = 1; i < iterations; i++) {
      const combined = new Uint8Array(hash.length + saltHash.length);
      combined.set(hash, 0);
      combined.set(saltHash, hash.length);
      hash = new Uint8Array(await sha256bytes(combined));
    }
  }

  // Step 5: hex変換
  return bufToHex(hash.buffer);
}

export async function hashPasswordV2(password, salt) {
  return hashWithIterations(password, salt, 1000);
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
 * パスワード検証（v2形式: 1000回 + 旧10000回フォールバック、v1/legacy/tmpはGASへ）
 *
 * GASの verifyPassword_ (CustomerAuth.gs:108-133) と同じロジック:
 *   v2: → 1000回で検証、不一致なら旧10000回でも試行
 *   tmp: → GASフォールバック
 *   v1/legacy → GASフォールバック
 */
export async function verifyPasswordV2(password, storedHash) {
  if (!storedHash) {
    return { match: false, needsGasFallback: true };
  }

  if (storedHash.startsWith('v2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) {
      return { match: false, needsGasFallback: false };
    }

    const [, salt, expectedHash] = parts;

    // 現行1000回で検証
    const computed1000 = await hashWithIterations(password, salt, 1000);
    if (timingSafeEqual(computed1000, expectedHash)) {
      return { match: true, needsGasFallback: false };
    }

    // 旧10000回でも試行（HASH_ITERATIONS変更前のハッシュ対応）
    const computed10000 = await hashWithIterations(password, salt, 10000);
    if (timingSafeEqual(computed10000, expectedHash)) {
      return { match: true, needsGasFallback: false };
    }

    return { match: false, needsGasFallback: false };
  }

  // tmp/v1/legacy形式 → GASにフォールバック
  return { match: false, needsGasFallback: true };
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
