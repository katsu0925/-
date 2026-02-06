// =====================================================
// 顧客認証 (CustomerAuth.gs)
// =====================================================

/**
 * 顧客シートを取得（なければ作成）
 */
function getCustomerSheet_() {
  const ss = sh_getOrderSs_();
  let sheet = ss.getSheetByName('顧客管理');
  if (!sheet) {
    sheet = ss.insertSheet('顧客管理');
    sheet.appendRow([
      'ID', 'メールアドレス', 'パスワードハッシュ', '会社名/氏名', '電話番号',
      '郵便番号', '住所', 'メルマガ', '登録日時', '最終ログイン', 'セッションID', 'セッション有効期限'
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * SHA-256ハッシュ生成
 */
function hashPassword_(password, salt) {
  const input = password + ':' + salt;
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return rawHash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * ランダムなソルト/セッションID生成
 */
function generateRandomId_(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * メールアドレスで顧客を検索
 */
function findCustomerByEmail_(email) {
  const sheet = getCustomerSheet_();
  const data = sheet.getDataRange().getValues();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1] || '').trim().toLowerCase() === normalizedEmail) {
      return {
        row: i + 1,
        id: data[i][0],
        email: data[i][1],
        passwordHash: data[i][2],
        companyName: data[i][3],
        phone: data[i][4],
        postal: data[i][5],
        address: data[i][6],
        newsletter: data[i][7],
        registeredAt: data[i][8],
        lastLogin: data[i][9],
        sessionId: data[i][10],
        sessionExpiry: data[i][11]
      };
    }
  }
  return null;
}

/**
 * セッションIDで顧客を検索
 */
function findCustomerBySession_(sessionId) {
  if (!sessionId) return null;

  const sheet = getCustomerSheet_();
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][10] === sessionId) {
      const expiry = data[i][11];
      if (expiry && new Date(expiry) > now) {
        return {
          row: i + 1,
          id: data[i][0],
          email: data[i][1],
          companyName: data[i][3],
          phone: data[i][4],
          postal: data[i][5],
          address: data[i][6],
          newsletter: data[i][7]
        };
      }
    }
  }
  return null;
}

/**
 * 顧客登録API
 */
function apiRegisterCustomer(userKey, params) {
  try {
    const email = String(params.email || '').trim().toLowerCase();
    const password = String(params.password || '');
    const companyName = String(params.companyName || '').trim();
    const phone = String(params.phone || '').trim();
    const postal = String(params.postal || '').trim();
    const address = String(params.address || '').trim();
    const newsletter = params.newsletter === true || params.newsletter === 'true';

    // バリデーション
    if (!email || !email.includes('@')) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }
    if (!password || password.length < 6) {
      return { ok: false, message: 'パスワードは6文字以上で入力してください' };
    }
    if (!companyName) {
      return { ok: false, message: '会社名/氏名は必須です' };
    }

    // 既存チェック
    if (findCustomerByEmail_(email)) {
      return { ok: false, message: 'このメールアドレスは既に登録されています' };
    }

    // パスワードハッシュ生成（ソルト付き）
    const salt = generateRandomId_(16);
    const passwordHash = salt + ':' + hashPassword_(password, salt);

    // セッションID生成
    const sessionId = generateRandomId_(32);
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間

    // シートに追加
    const sheet = getCustomerSheet_();
    const customerId = 'C' + Date.now().toString(36).toUpperCase();
    const now = new Date();

    sheet.appendRow([
      customerId, email, passwordHash, companyName, phone,
      postal, address, newsletter, now, now, sessionId, sessionExpiry
    ]);

    return {
      ok: true,
      data: {
        sessionId: sessionId,
        customer: {
          id: customerId,
          email: email,
          companyName: companyName,
          phone: phone,
          postal: postal,
          address: address,
          newsletter: newsletter
        }
      }
    };
  } catch (e) {
    return { ok: false, message: '登録に失敗しました: ' + (e.message || e) };
  }
}

/**
 * ログインAPI
 */
function apiLoginCustomer(userKey, params) {
  try {
    const email = String(params.email || '').trim().toLowerCase();
    const password = String(params.password || '');

    if (!email || !password) {
      return { ok: false, message: 'メールアドレスとパスワードを入力してください' };
    }

    const customer = findCustomerByEmail_(email);
    if (!customer) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    // パスワード検証
    const parts = customer.passwordHash.split(':');
    if (parts.length !== 2) {
      return { ok: false, message: '認証エラーが発生しました' };
    }
    const salt = parts[0];
    const storedHash = parts[1];
    const inputHash = hashPassword_(password, salt);

    if (inputHash !== storedHash) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    // 新しいセッションID生成
    const sessionId = generateRandomId_(32);
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const now = new Date();

    // シート更新
    const sheet = getCustomerSheet_();
    sheet.getRange(customer.row, 10).setValue(now); // 最終ログイン
    sheet.getRange(customer.row, 11).setValue(sessionId);
    sheet.getRange(customer.row, 12).setValue(sessionExpiry);

    return {
      ok: true,
      data: {
        sessionId: sessionId,
        customer: {
          id: customer.id,
          email: customer.email,
          companyName: customer.companyName,
          phone: customer.phone,
          postal: customer.postal,
          address: customer.address,
          newsletter: customer.newsletter
        }
      }
    };
  } catch (e) {
    return { ok: false, message: 'ログインに失敗しました: ' + (e.message || e) };
  }
}

/**
 * セッション検証API
 */
function apiValidateSession(userKey, params) {
  try {
    const sessionId = String(params.sessionId || '');
    if (!sessionId) {
      return { ok: false, message: 'セッションがありません' };
    }

    const customer = findCustomerBySession_(sessionId);
    if (!customer) {
      return { ok: false, message: 'セッションが無効または期限切れです' };
    }

    return {
      ok: true,
      data: {
        customer: {
          id: customer.id,
          email: customer.email,
          companyName: customer.companyName,
          phone: customer.phone,
          postal: customer.postal,
          address: customer.address,
          newsletter: customer.newsletter
        }
      }
    };
  } catch (e) {
    return { ok: false, message: 'セッション検証に失敗しました' };
  }
}

/**
 * ログアウトAPI
 */
function apiLogoutCustomer(userKey, params) {
  try {
    const sessionId = String(params.sessionId || '');
    if (!sessionId) {
      return { ok: true };
    }

    const sheet = getCustomerSheet_();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][10] === sessionId) {
        sheet.getRange(i + 1, 11).setValue('');
        sheet.getRange(i + 1, 12).setValue('');
        break;
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: true }; // ログアウトは常に成功扱い
  }
}
