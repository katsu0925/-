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
 * 反復SHA-256ハッシュ生成（PBKDF2相当の強化）
 * 10000回の反復でブルートフォース・レインボーテーブル攻撃を困難にする
 */
function hashPassword_(password, salt) {
  var iterations = 10000;
  var input = password + ':' + salt;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  for (var i = 1; i < iterations; i++) {
    // 前回のハッシュ結果 + ソルトで再ハッシュ
    var combined = hash.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.newBlob(salt).getBytes()));
    hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  }
  return hash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * レガシーハッシュ（旧方式、移行期間中の互換性用）
 */
function hashPasswordLegacy_(password, salt) {
  var input = password + ':' + salt;
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return rawHash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * 暗号論的に安全なランダムID生成
 * Utilities.getUuid() を使用してセキュアな乱数を生成
 */
function generateRandomId_(length) {
  // Utilities.getUuid() は暗号論的に安全なUUIDを生成
  let result = '';
  while (result.length < length) {
    result += Utilities.getUuid().replace(/-/g, '');
  }
  return result.substring(0, length);
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

    // 電話番号・郵便番号は先頭の0が消えないようにアポストロフィを付加
    const phoneForSheet = phone ? ("'" + phone) : '';
    const postalForSheet = postal ? ("'" + postal) : '';
    sheet.appendRow([
      customerId, email, passwordHash, companyName, phoneForSheet,
      postalForSheet, address, newsletter, now, now, sessionId, sessionExpiry
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

    // パスワード検証（新旧ハッシュ方式に対応）
    const parts = customer.passwordHash.split(':');
    if (parts.length < 2) {
      return { ok: false, message: '認証エラーが発生しました' };
    }
    const salt = parts[0];
    const storedHash = parts.slice(1).join(':');
    const inputHash = hashPassword_(password, salt);
    const inputHashLegacy = hashPasswordLegacy_(password, salt);

    var matched = timingSafeEqual_(inputHash, storedHash) || timingSafeEqual_(inputHashLegacy, storedHash);
    if (!matched) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    // レガシーハッシュの場合は新方式に自動移行
    if (timingSafeEqual_(inputHashLegacy, storedHash) && !timingSafeEqual_(inputHash, storedHash)) {
      const newPasswordHash = salt + ':' + inputHash;
      const sheet2 = getCustomerSheet_();
      sheet2.getRange(customer.row, 3).setValue(newPasswordHash);
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
 * 会員属性変更API（パスワード再認証必須）
 * JCA不正ログイン対策: 属性変更時の本人確認（二要素認証等）
 */
function apiUpdateCustomerProfile(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '');
    var currentPassword = String(params.currentPassword || '');

    // --- 本人確認: セッション + パスワード再入力の二段階認証 ---
    if (!sessionId) {
      return { ok: false, message: 'ログインが必要です' };
    }
    if (!currentPassword) {
      return { ok: false, message: '本人確認のため現在のパスワードを入力してください' };
    }

    var customer = findCustomerBySession_(sessionId);
    if (!customer) {
      return { ok: false, message: 'セッションが無効または期限切れです。再ログインしてください' };
    }

    // パスワード再認証（セッション認証 + パスワード = 二段階の本人確認）
    var fullCustomer = findCustomerByEmail_(customer.email);
    if (!fullCustomer) {
      return { ok: false, message: '顧客情報が見つかりません' };
    }
    var parts = fullCustomer.passwordHash.split(':');
    if (parts.length < 2) {
      return { ok: false, message: '認証エラーが発生しました' };
    }
    var salt = parts[0];
    var storedHash = parts.slice(1).join(':');
    var inputHash = hashPassword_(currentPassword, salt);
    if (!timingSafeEqual_(inputHash, storedHash)) {
      // レガシーハッシュもチェック
      var inputHashLegacy = hashPasswordLegacy_(currentPassword, salt);
      if (!timingSafeEqual_(inputHashLegacy, storedHash)) {
        return { ok: false, message: 'パスワードが正しくありません' };
      }
    }

    // --- 本人確認OK: 属性変更を実行 ---
    var sheet = getCustomerSheet_();
    var row = fullCustomer.row;
    var updated = [];

    if (params.companyName !== undefined) {
      var companyName = String(params.companyName || '').trim();
      if (!companyName) return { ok: false, message: '会社名/氏名は必須です' };
      sheet.getRange(row, 4).setValue(companyName);
      updated.push('会社名/氏名');
    }
    if (params.phone !== undefined) {
      var phone = String(params.phone || '').trim();
      sheet.getRange(row, 5).setValue(phone ? "'" + phone : '');
      updated.push('電話番号');
    }
    if (params.postal !== undefined) {
      var postal = String(params.postal || '').trim();
      sheet.getRange(row, 6).setValue(postal ? "'" + postal : '');
      updated.push('郵便番号');
    }
    if (params.address !== undefined) {
      var address = String(params.address || '').trim();
      sheet.getRange(row, 7).setValue(address);
      updated.push('住所');
    }
    if (params.email !== undefined) {
      var newEmail = String(params.email || '').trim().toLowerCase();
      if (!newEmail || !newEmail.includes('@')) {
        return { ok: false, message: '有効なメールアドレスを入力してください' };
      }
      if (newEmail !== fullCustomer.email) {
        var existing = findCustomerByEmail_(newEmail);
        if (existing) return { ok: false, message: 'このメールアドレスは既に使用されています' };
        sheet.getRange(row, 2).setValue(newEmail);
        updated.push('メールアドレス');
      }
    }

    if (updated.length === 0) {
      return { ok: false, message: '変更する項目がありません' };
    }

    console.log('Customer profile updated: ' + fullCustomer.id + ' fields=' + updated.join(','));
    return { ok: true, message: updated.join('、') + ' を更新しました' };
  } catch (e) {
    console.error('apiUpdateCustomerProfile error:', e);
    return { ok: false, message: '更新に失敗しました' };
  }
}

/**
 * パスワードリセットAPI
 * 登録メールアドレスに仮パスワードを送信
 */
function apiRequestPasswordReset(userKey, params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }

    var customer = findCustomerByEmail_(email);
    if (!customer) {
      // セキュリティ: 登録有無を漏らさないため同じメッセージを返す
      return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
    }

    // 仮パスワード生成（8文字の英数字）
    var tempPassword = generateRandomId_(8);

    // 新しいハッシュで保存
    var salt = generateRandomId_(16);
    var newHash = salt + ':' + hashPassword_(tempPassword, salt);
    var sheet = getCustomerSheet_();
    sheet.getRange(customer.row, 3).setValue(newHash);

    // 仮パスワードをメール送信
    var subject = '【NKonline Apparel】パスワードリセットのお知らせ';
    var body = customer.companyName + ' 様\n\n'
      + 'パスワードリセットのリクエストを受け付けました。\n'
      + '以下の仮パスワードでログインしてください。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '仮パスワード: ' + tempPassword + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + 'ログイン後、マイページからパスワードの変更をお勧めします。\n'
      + '※ このメールに心当たりがない場合は、無視してください。\n\n'
      + '──────────────────\n'
      + 'NKonline Apparel\n'
      + 'https://wholesale.nkonline-tool.com\n'
      + 'お問い合わせ: nkonline1030@gmail.com\n'
      + '──────────────────\n';

    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: body,
      noReply: true
    });

    console.log('Password reset sent to: ' + email + ' (customer: ' + customer.id + ')');
    return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
  } catch (e) {
    console.error('apiRequestPasswordReset error:', e);
    return { ok: false, message: 'パスワードリセットに失敗しました。しばらくしてからお試しください' };
  }
}

/**
 * メールアドレス確認API
 * 会社名/氏名 + 電話番号で照合し、マスク済みメールアドレスを返す
 */
function apiRecoverEmail(userKey, params) {
  try {
    var companyName = String(params.companyName || '').trim();
    var phone = String(params.phone || '').trim().replace(/[-\s]/g, '');

    if (!companyName) {
      return { ok: false, message: '会社名/氏名を入力してください' };
    }
    if (!phone) {
      return { ok: false, message: '電話番号を入力してください' };
    }

    var sheet = getCustomerSheet_();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var rowName = String(data[i][3] || '').trim();
      var rowPhone = String(data[i][4] || '').trim().replace(/[-\s']/g, '');

      if (rowName === companyName && rowPhone === phone) {
        var rawEmail = String(data[i][1] || '');
        var masked = maskEmail_(rawEmail);
        return { ok: true, data: { maskedEmail: masked } };
      }
    }

    return { ok: false, message: '一致する登録情報が見つかりませんでした。\n入力内容をご確認いただくか、お問い合わせください。' };
  } catch (e) {
    console.error('apiRecoverEmail error:', e);
    return { ok: false, message: 'メールアドレスの確認に失敗しました' };
  }
}

/**
 * メールアドレスをマスク表示 (例: test@example.com → t***@e*****.com)
 */
function maskEmail_(email) {
  var parts = String(email).split('@');
  if (parts.length !== 2) return '***@***';
  var local = parts[0];
  var domain = parts[1];

  var maskedLocal = local.charAt(0) + '***';
  var dotIdx = domain.lastIndexOf('.');
  if (dotIdx > 0) {
    var maskedDomain = domain.charAt(0) + '*'.repeat(Math.min(dotIdx - 1, 5)) + domain.substring(dotIdx);
  } else {
    var maskedDomain = domain.charAt(0) + '***';
  }
  return maskedLocal + '@' + maskedDomain;
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
