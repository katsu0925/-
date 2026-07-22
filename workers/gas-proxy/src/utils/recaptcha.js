/**
 * reCAPTCHA v3 検証ユーティリティ
 * submit.js（注文送信）の検証と同一ロジック。登録APIなどbot対策が必要なAPIで共用する。
 */
export async function verifyRecaptcha(token, secret) {
  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
  });
  const result = await resp.json();
  return result.success && (result.score || 0) >= 0.3;
}
