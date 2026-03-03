/**
 * パスワードハッシュ互換性テスト
 * Node.js 18+ で実行: node test-hash.mjs
 *
 * GASエディタで testHashVector() を実行し、
 * ログ出力のハッシュ値とこのスクリプトの出力を比較する。
 */

import { webcrypto } from 'node:crypto';

// Node.js の crypto.subtle を使用
const subtle = webcrypto.subtle;

async function sha256bytes(input) {
  return subtle.digest('SHA-256', input);
}

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
    bytes[i] = code > 127 ? 0x3F : code; // non-ASCII → '?'
  }
  return bytes;
}

async function hashPasswordV2(password, salt) {
  // Step 1-2: 初回ハッシュ = SHA-256(password + ':' + salt)
  // GAS互換: 文字列→バイト変換はcharCode & 0xFF
  const input = gasStringToBytes(password + ':' + salt);
  let hash = new Uint8Array(await sha256bytes(input));

  // Step 3: saltHash = SHA-256(salt) — saltはASCIIなのでどちらでも同じ
  const saltHash = new Uint8Array(await sha256bytes(gasStringToBytes(salt)));

  // Step 4: 999回反復 hash = SHA-256(hash + saltHash)
  for (let i = 1; i < 1000; i++) {
    const combined = new Uint8Array(hash.length + saltHash.length);
    combined.set(hash, 0);
    combined.set(saltHash, hash.length);
    hash = new Uint8Array(await sha256bytes(combined));
  }

  // Step 5: hex変換
  return bufToHex(hash.buffer);
}

// GASの初回SHA-256結果: 7942eabe0f7191736d86e2d590b71d49b37d741e3eaa06f8396ddc6fb773760d
const GAS_DEFAULT = '7942eabe0f7191736d86e2d590b71d49b37d741e3eaa06f8396ddc6fb773760d';
const input = 'パスワード:0123456789abcdef';

console.log('=== エンコーディング診断 ===');
console.log(`Target (GAS Default): ${GAS_DEFAULT}\n`);

// 1. UTF-8
const utf8 = new TextEncoder().encode(input);
const h1 = bufToHex(await sha256bytes(utf8));
console.log(`UTF-8:        ${h1} ${h1 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// 2. charCode & 0xFF (Latin-1 style)
const latin1 = gasStringToBytes(input);
const h2 = bufToHex(await sha256bytes(latin1));
console.log(`charCode%256: ${h2} ${h2 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// 3. UTF-16BE (no BOM)
const utf16be = new Uint8Array(input.length * 2);
for (let i = 0; i < input.length; i++) {
  const code = input.charCodeAt(i);
  utf16be[i * 2] = (code >> 8) & 0xFF;
  utf16be[i * 2 + 1] = code & 0xFF;
}
const h3 = bufToHex(await sha256bytes(utf16be));
console.log(`UTF-16BE:     ${h3} ${h3 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// 4. UTF-16LE (no BOM)
const utf16le = new Uint8Array(input.length * 2);
for (let i = 0; i < input.length; i++) {
  const code = input.charCodeAt(i);
  utf16le[i * 2] = code & 0xFF;
  utf16le[i * 2 + 1] = (code >> 8) & 0xFF;
}
const h4 = bufToHex(await sha256bytes(utf16le));
console.log(`UTF-16LE:     ${h4} ${h4 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// 5. Shift-JIS via iconv-lite concept (manual mapping for katakana)
// パ=8370, ス=8358, ワ=838F, ー=815B, ド=8368
const sjisBytes = [
  0x83, 0x70, // パ
  0x83, 0x58, // ス
  0x83, 0x8F, // ワ
  0x81, 0x5B, // ー
  0x83, 0x68, // ド
  0x3A,       // :
  ...Array.from('0123456789abcdef').map(c => c.charCodeAt(0))
];
const h5 = bufToHex(await sha256bytes(new Uint8Array(sjisBytes)));
console.log(`Shift-JIS:    ${h5} ${h5 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// 6. EUC-JP
// パ=A5D1, ス=A5B9, ワ=A5EF, ー=A1BC, ド=A5C9
const eucjpBytes = [
  0xA5, 0xD1, // パ
  0xA5, 0xB9, // ス
  0xA5, 0xEF, // ワ
  0xA1, 0xBC, // ー
  0xA5, 0xC9, // ド
  0x3A,       // :
  ...Array.from('0123456789abcdef').map(c => c.charCodeAt(0))
];
const h6 = bufToHex(await sha256bytes(new Uint8Array(eucjpBytes)));
console.log(`EUC-JP:       ${h6} ${h6 === GAS_DEFAULT ? '✓ MATCH' : '✗'}`);

// Full test with best encoding
console.log('\n=== フルテスト ===');
const testCases = [
  { password: 'test123', salt: 'abcdef1234567890' },
  { password: 'パスワード', salt: '0123456789abcdef' },
  { password: 'hello@world.com', salt: 'deadbeef12345678' },
];

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const hash = await hashPasswordV2(tc.password, tc.salt);
  console.log(`Test ${i+1}: password="${tc.password}" salt="${tc.salt}"`);
  console.log(`  → v2:${tc.salt}:${hash}`);
}
