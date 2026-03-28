/**
 * 登録ページ
 */
export function getRegisterPageHtml(inviteCode) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>新規登録 — タスキ箱</title>
<style>
:root {
  --primary: #4F46E5;
  --primary-hover: #4338CA;
  --bg: #F9FAFB;
  --card-bg: #FFFFFF;
  --text: #1F2937;
  --text-sub: #6B7280;
  --border: #D1D5DB;
  --error: #DC2626;
  --error-bg: #FEF2F2;
  --radius: 12px;
  --info-bg: #EFF6FF;
  --info-text: #1E40AF;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
  background: var(--bg); color: var(--text);
  min-height: 100dvh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 20px;
}
@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes logoBounce { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
.logo { text-align: center; margin-bottom: 24px; animation: fadeUp .5s ease; }
.logo-icon {
  width: 56px; height: 56px; background: linear-gradient(135deg, var(--primary), #818cf8); border-radius: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 28px; color: white; font-weight: bold; margin-bottom: 8px;
  box-shadow: 0 4px 16px rgba(79,70,229,.3);
  animation: logoBounce 2s ease-in-out infinite;
}
.logo h1 { font-size: 22px; font-weight: 700; }
.card {
  background: var(--card-bg); border-radius: var(--radius);
  box-shadow: 0 4px 24px rgba(0,0,0,.08); padding: 32px;
  width: 100%; max-width: 400px;
  animation: fadeUp .5s ease .1s both;
}
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
.field input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border);
  border-radius: 8px; font-size: 16px; outline: none;
}
.field input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79,70,229,.15); }
.field .hint { font-size: 12px; color: var(--text-sub); margin-top: 4px; }
.btn {
  width: 100%; padding: 12px; border: none; border-radius: 8px;
  font-size: 16px; font-weight: 600; cursor: pointer;
  background: var(--primary); color: white;
  transition: all .2s ease; box-shadow: 0 2px 8px rgba(79,70,229,.25);
  margin-top: 4px; transform: scale(1);
}
.btn:hover { background: var(--primary-hover); box-shadow: 0 4px 16px rgba(79,70,229,.35); transform: translateY(-1px); }
.btn:active { transform: scale(.97); }
.btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.error-msg {
  background: var(--error-bg); color: var(--error); padding: 10px 14px;
  border-radius: 8px; font-size: 14px; margin-bottom: 16px; display: none;
}
.info-msg {
  background: var(--info-bg); color: var(--info-text); padding: 10px 14px;
  border-radius: 8px; font-size: 14px; margin-bottom: 16px; display: none;
}
.links { text-align: center; margin-top: 20px; font-size: 14px; color: var(--text-sub); }
.links a { color: var(--primary); text-decoration: none; }
.links a:hover { text-decoration: underline; }
</style>
</head>
<body>

<div class="logo">
  <div class="logo-icon">箱</div>
  <h1>タスキ箱</h1>
</div>

<div class="card">
  <div class="error-msg" id="errorMsg"></div>
  <div class="info-msg" id="inviteInfo"></div>

  <form id="registerForm">
    <div class="field">
      <label for="displayName">表示名</label>
      <input type="text" id="displayName" required placeholder="田中太郎">
    </div>
    <div class="field">
      <label for="email">メールアドレス</label>
      <input type="email" id="email" autocomplete="email" required>
    </div>
    <div class="field">
      <label for="password">パスワード</label>
      <input type="password" id="password" autocomplete="new-password" required minlength="6">
      <div class="hint">6文字以上</div>
    </div>
    <div class="field">
      <label for="inviteCode">招待コード（お持ちの方）</label>
      <input type="text" id="inviteCode" placeholder="任意"
             value="${inviteCode || ''}">
    </div>
    <button type="submit" class="btn" id="submitBtn">アカウント作成</button>
  </form>

  <div class="links">
    <p>既にアカウントをお持ちの方は <a href="/login">ログイン</a></p>
  </div>
</div>

<script>
const API = '';

if (localStorage.getItem('sessionId')) {
  location.href = '/app';
}

// 招待コードのプレビュー
const inviteInput = document.getElementById('inviteCode');
const inviteInfo = document.getElementById('inviteInfo');

async function checkInvite() {
  const code = inviteInput.value.trim();
  if (!code || code.length < 4) { inviteInfo.style.display = 'none'; return; }
  try {
    const res = await fetch(API + '/api/team/invite-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: code }),
    });
    const data = await res.json();
    if (data.ok) {
      inviteInfo.textContent = '「' + data.team.name + '」チームに参加します（メンバー: ' + data.team.memberCount + '人）';
      inviteInfo.style.display = 'block';
    } else {
      inviteInfo.style.display = 'none';
    }
  } catch { inviteInfo.style.display = 'none'; }
}

let inviteTimer;
inviteInput.addEventListener('input', () => {
  clearTimeout(inviteTimer);
  inviteTimer = setTimeout(checkInvite, 500);
});
if (inviteInput.value) checkInvite();

// 登録
const form = document.getElementById('registerForm');
const errorMsg = document.getElementById('errorMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.style.display = 'none';
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '登録中...';

  try {
    const res = await fetch(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: document.getElementById('displayName').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
        inviteCode: inviteInput.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem('sessionId', data.sessionId);
      location.href = '/app';
    } else {
      errorMsg.textContent = data.message;
      errorMsg.style.display = 'block';
    }
  } catch {
    errorMsg.textContent = '通信エラーが発生しました。';
    errorMsg.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'アカウント作成';
});
</script>
</body>
</html>`;
}
