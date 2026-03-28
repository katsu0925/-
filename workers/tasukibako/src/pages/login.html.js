/**
 * ログインページ
 */
export function getLoginPageHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ログイン — タスキ箱</title>
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
.logo-icon:hover { animation: none; transform: rotate(5deg) scale(1.1); transition: transform .2s; }
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
.field input { transition: border-color .2s, box-shadow .2s; }
.field input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79,70,229,.15); }
.check-row { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.check-row input { width: auto; }
.check-row label { font-size: 14px; color: var(--text-sub); }
.btn {
  width: 100%; padding: 12px; border: none; border-radius: 8px;
  font-size: 16px; font-weight: 600; cursor: pointer;
  background: var(--primary); color: white;
  transition: all .2s ease; box-shadow: 0 2px 8px rgba(79,70,229,.25);
  transform: scale(1);
}
.btn:hover { background: var(--primary-hover); box-shadow: 0 4px 16px rgba(79,70,229,.35); transform: translateY(-1px); }
.btn:active { transform: scale(.97); }
.btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.error-msg {
  background: var(--error-bg); color: var(--error); padding: 10px 14px;
  border-radius: 8px; font-size: 14px; margin-bottom: 16px; display: none;
}
.links { text-align: center; margin-top: 20px; font-size: 14px; color: var(--text-sub); }
.links a { color: var(--primary); text-decoration: none; }
.links a:hover { text-decoration: underline; }

/* パスワードリセットモーダル */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: none; align-items: center; justify-content: center; z-index: 100; padding: 20px;
}
.modal-overlay.show { display: flex; }
.modal { background: white; border-radius: var(--radius); padding: 28px; width: 100%; max-width: 400px; }
.modal h2 { font-size: 18px; margin-bottom: 16px; }
.modal .close-btn {
  float: right; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-sub);
}
.success-msg {
  background: #F0FDF4; color: #166534; padding: 10px 14px;
  border-radius: 8px; font-size: 14px; margin-bottom: 16px; display: none;
}
</style>
</head>
<body>

<div class="logo">
  <div class="logo-icon">箱</div>
  <h1>タスキ箱</h1>
</div>

<div class="card">
  <div class="error-msg" id="errorMsg"></div>
  <div class="success-msg" id="successMsg"></div>

  <form id="loginForm">
    <div class="field">
      <label for="email">メールアドレス</label>
      <input type="email" id="email" autocomplete="email" required>
    </div>
    <div class="field">
      <label for="password">パスワード</label>
      <input type="password" id="password" autocomplete="current-password" required>
    </div>
    <div class="check-row">
      <input type="checkbox" id="rememberMe">
      <label for="rememberMe">ログインしたままにする</label>
    </div>
    <button type="submit" class="btn" id="submitBtn">ログイン</button>
  </form>

  <div class="links">
    <p style="margin-bottom:8px"><a href="#" id="forgotLink">パスワードを忘れた方</a></p>
    <p>アカウントをお持ちでない方は <a href="/register">新規登録</a></p>
  </div>
</div>

<!-- パスワードリセットモーダル -->
<div class="modal-overlay" id="forgotModal">
  <div class="modal">
    <button class="close-btn" id="closeForgot">&times;</button>
    <h2>パスワードリセット</h2>
    <p style="font-size:14px;color:var(--text-sub);margin-bottom:16px">
      登録メールアドレスにリセットリンクを送信します。
    </p>
    <div class="error-msg" id="forgotError"></div>
    <div class="success-msg" id="forgotSuccess"></div>
    <div class="field">
      <input type="email" id="forgotEmail" placeholder="メールアドレス">
    </div>
    <button class="btn" id="forgotBtn">送信</button>
  </div>
</div>

<script>
const API = '';

// 既にログイン済みならリダイレクト
if (localStorage.getItem('sessionId')) {
  location.href = '/app';
}

const form = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');
const successMsg = document.getElementById('successMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.style.display = 'none';
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'ログイン中...';

  try {
    const res = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
        rememberMe: document.getElementById('rememberMe').checked,
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
  btn.textContent = 'ログイン';
});

// パスワードリセットモーダル
document.getElementById('forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgotModal').classList.add('show');
});
document.getElementById('closeForgot').addEventListener('click', () => {
  document.getElementById('forgotModal').classList.remove('show');
});

document.getElementById('forgotBtn').addEventListener('click', async () => {
  const email = document.getElementById('forgotEmail').value.trim();
  const errEl = document.getElementById('forgotError');
  const sucEl = document.getElementById('forgotSuccess');
  errEl.style.display = 'none';
  sucEl.style.display = 'none';

  if (!email) { errEl.textContent = 'メールアドレスを入力してください。'; errEl.style.display = 'block'; return; }

  sucEl.textContent = 'この機能は準備中です。管理者にお問い合わせください。';
  sucEl.style.display = 'block';
});
</script>
</body>
</html>`;
}
