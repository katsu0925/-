/**
 * ログイン画面HTML
 */
export function loginPage() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1e293b">
  <link rel="manifest" href="/manifest.json">
  <title>デタウリ業務 - ログイン</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
      background: #1e293b;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      width: 100%;
      max-width: 400px;
      padding: 24px;
    }
    .logo {
      text-align: center;
      margin-bottom: 40px;
    }
    .logo h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.05em;
    }
    .logo p {
      font-size: 0.875rem;
      color: #94a3b8;
      margin-top: 8px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 0.875rem;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .form-group input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      color: #f1f5f9;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-group input:focus {
      border-color: #3b82f6;
    }
    .remember-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    .remember-row input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #3b82f6;
    }
    .remember-row label {
      font-size: 0.875rem;
      color: #94a3b8;
    }
    .login-btn {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 8px;
      background: #3b82f6;
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .login-btn:hover {
      background: #2563eb;
    }
    .login-btn:disabled {
      background: #475569;
      cursor: not-allowed;
    }
    .error-msg {
      color: #f87171;
      font-size: 0.875rem;
      text-align: center;
      margin-top: 12px;
      min-height: 20px;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <h1>デタウリ業務</h1>
      <p>スタッフ専用</p>
    </div>
    <form id="loginForm">
      <div class="form-group">
        <label for="email">メールアドレス</label>
        <input type="email" id="email" autocomplete="email" required>
      </div>
      <div class="form-group">
        <label for="password">パスワード</label>
        <input type="password" id="password" autocomplete="current-password" required>
      </div>
      <div class="remember-row">
        <input type="checkbox" id="rememberMe">
        <label for="rememberMe">ログイン状態を保持</label>
      </div>
      <button type="submit" class="login-btn" id="loginBtn">ログイン</button>
      <div class="error-msg" id="errorMsg"></div>
    </form>
  </div>

  <script>
    // PWA: Service Worker登録
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const form = document.getElementById('loginForm');
    const btn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMsg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.textContent = '';
      btn.disabled = true;
      btn.textContent = 'ログイン中...';

      try {
        const res = await fetch('/api/auth/login', {
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
          // セッションIDをlocalStorageに保存
          localStorage.setItem('sessionId', data.sessionId);
          localStorage.setItem('user', JSON.stringify(data.user));
          window.location.href = '/app';
        } else {
          errorMsg.textContent = data.message || 'ログインに失敗しました。';
        }
      } catch (err) {
        errorMsg.textContent = 'ネットワークエラーが発生しました。';
      } finally {
        btn.disabled = false;
        btn.textContent = 'ログイン';
      }
    });
  </script>
</body>
</html>`;
}
