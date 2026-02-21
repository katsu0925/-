// CustomerAuth.gs
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
      '郵便番号', '住所', 'メルマガ', '登録日時', '最終ログイン', 'セッションID', 'セッション有効期限',
      'ポイント残高'
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// =====================================================
// パスワードハッシュ関数群
// =====================================================

/**
 * v2 ハッシュ（10,000回反復）
 * OWASP推奨の最低反復回数を満たすセキュアなハッシュ
 * レート制限 + ソルト付きで安全性を確保
 */
function hashPasswordV2_(password, salt) {
  var iterations = AUTH_CONSTANTS.HASH_ITERATIONS;
  var input = password + ':' + salt;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  var saltBytes = Utilities.newBlob(salt).getBytes();
  var saltHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltBytes);
  for (var i = 1; i < iterations; i++) {
    var combined = hash.concat(saltHash);
    hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  }
  return hash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * v1 旧ハッシュ（10000回反復）- 後方互換用
 * @deprecated v2への自動移行完了後に削除予定
 */
function hashPassword_(password, salt) {
  return hashWithIterations_(password, salt, 10000);
}

/**
 * レガシーハッシュ（旧方式、移行期間中の互換性用）
 * @deprecated v2への自動移行完了後に削除予定
 */
function hashPasswordLegacy_(password, salt) {
  return hashWithIterations_(password, salt, 1);
}

/**
 * SHA-256反復ハッシュの共通実装（v1/legacy統合）
 * @param {string} password
 * @param {string} salt
 * @param {number} iterations - 反復回数
 * @return {string} 16進ハッシュ文字列
 */
function hashWithIterations_(password, salt, iterations) {
  var input = password + ':' + salt;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  if (iterations > 1) {
    var saltBytes = Utilities.newBlob(salt).getBytes();
    var saltHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltBytes);
    for (var i = 1; i < iterations; i++) {
      var combined = hash.concat(saltHash);
      hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
    }
  }
  return hash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * パスワードハッシュ文字列を生成（v2形式）
 */
function createPasswordHash_(password) {
  var salt = generateRandomId_(AUTH_CONSTANTS.SALT_LENGTH);
  return AUTH_CONSTANTS.HASH_PREFIX + ':' + salt + ':' + hashPasswordV2_(password, salt);
}

/**
 * 仮パスワード用の軽量ハッシュ生成（tmp形式）
 * 仮パスワードは30分で失効するランダム文字列のため、1回のハッシュで十分
 */
function createTempPasswordHash_(password) {
  var salt = generateRandomId_(AUTH_CONSTANTS.SALT_LENGTH);
  return 'tmp:' + salt + ':' + hashWithIterations_(password, salt, 1);
}

/**
 * パスワード検証（v2/v1/legacy全形式対応）
 * @return {boolean}
 */
function verifyPassword_(password, storedHash) {
  if (storedHash.indexOf('v2:') === 0) {
    var rest = storedHash.substring(3);
    var parts = rest.split(':');
    var salt = parts[0];
    var hash = parts.slice(1).join(':');
    return timingSafeEqual_(hashPasswordV2_(password, salt), hash);
  }
  // tmp形式（仮パスワード用軽量ハッシュ）
  if (storedHash.indexOf('tmp:') === 0) {
    var rest = storedHash.substring(4);
    var parts = rest.split(':');
    var salt = parts[0];
    var hash = parts.slice(1).join(':');
    return timingSafeEqual_(hashWithIterations_(password, salt, 1), hash);
  }
  // v1 / legacy形式
  var parts = storedHash.split(':');
  if (parts.length < 2) return false;
  var salt = parts[0];
  var hash = parts.slice(1).join(':');
  return timingSafeEqual_(hashPassword_(password, salt), hash)
      || timingSafeEqual_(hashPasswordLegacy_(password, salt), hash);
}

/**
 * パスワード検証 + 自動v2移行
 * @return {boolean}
 */
function verifyAndMigratePassword_(password, storedHash, customerRow) {
  if (storedHash.indexOf('v2:') === 0) {
    var rest = storedHash.substring(3);
    var parts = rest.split(':');
    var salt = parts[0];
    var hash = parts.slice(1).join(':');
    return timingSafeEqual_(hashPasswordV2_(password, salt), hash);
  }
  // v1 / legacy - 検証後にv2へ自動移行
  var parts = storedHash.split(':');
  if (parts.length < 2) return false;
  var salt = parts[0];
  var hash = parts.slice(1).join(':');
  var matched = timingSafeEqual_(hashPassword_(password, salt), hash)
             || timingSafeEqual_(hashPasswordLegacy_(password, salt), hash);
  if (matched && customerRow) {
    var newHash = createPasswordHash_(password);
    getCustomerSheet_().getRange(customerRow, 3).setValue(newHash);
  }
  return matched;
}

/**
 * 暗号論的に安全なランダムID生成
 */
function generateRandomId_(length) {
  let result = '';
  while (result.length < length) {
    result += Utilities.getUuid().replace(/-/g, '');
  }
  return result.substring(0, length);
}

// =====================================================
// 顧客検索
// =====================================================

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
        sessionExpiry: data[i][11],
        points: Number(data[i][12]) || 0
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
          newsletter: data[i][7],
          points: Number(data[i][12]) || 0
        };
      }
    }
  }
  return null;
}

// =====================================================
// 認証API
// =====================================================

/**
 * 顧客登録API（v2ハッシュ使用）
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

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }
    if (!password || password.length < AUTH_CONSTANTS.MIN_PASSWORD_LENGTH) {
      return { ok: false, message: 'パスワードは' + AUTH_CONSTANTS.MIN_PASSWORD_LENGTH + '文字以上で入力してください' };
    }
    if (!companyName) {
      return { ok: false, message: '会社名/氏名は必須です' };
    }

    // 排他制御: メール重複チェック〜appendRowをロックで保護（レースコンディション対策）
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { ok: false, message: '登録処理が混み合っています。しばらくお待ちください。' };
    }
    try {
      if (findCustomerByEmail_(email)) {
        lock.releaseLock();
        return { ok: false, message: 'このメールアドレスは既に登録されています' };
      }

      var passwordHash = createPasswordHash_(password);
      const sessionId = generateRandomId_(AUTH_CONSTANTS.SESSION_ID_LENGTH);
      const sessionExpiry = new Date(Date.now() + AUTH_CONSTANTS.SESSION_DURATION_MS);
      const sheet = getCustomerSheet_();
      const customerId = 'C' + Date.now().toString(36).toUpperCase();
      const now = new Date();
      const phoneForSheet = phone ? ("'" + phone) : '';
      const postalForSheet = postal ? ("'" + postal) : '';

      sheet.appendRow([
        customerId, email, passwordHash, companyName, phoneForSheet,
        postalForSheet, address, newsletter, now, now, sessionId, sessionExpiry, 0
      ]);
      lock.releaseLock();

      return {
        ok: true,
        data: {
          sessionId: sessionId,
          customer: {
            id: customerId, email: email, companyName: companyName,
            phone: phone, postal: postal, address: address,
            newsletter: newsletter, points: 0
          }
        }
      };
    } catch (lockErr) {
      lock.releaseLock();
      throw lockErr;
    }
  } catch (e) {
    return { ok: false, message: '登録に失敗しました: ' + (e.message || e) };
  }
}

/**
 * ログインAPI（v2高速ハッシュ + v1/legacy自動移行）
 */
function apiLoginCustomer(userKey, params) {
  try {
    const email = String(params.email || '').trim().toLowerCase();
    const password = String(params.password || '');

    if (!email || !password) {
      return { ok: false, message: 'メールアドレスとパスワードを入力してください' };
    }

    // メールアドレスベースのレート制限（userKey偽装によるバイパス対策）
    var emailRateKey = 'RL:login_email:' + email;
    var cache = CacheService.getScriptCache();
    var emailAttempts = parseInt(cache.get(emailRateKey) || '0', 10);
    if (emailAttempts >= 10) {
      return { ok: false, message: 'ログイン試行回数が多すぎます。しばらくお待ちください。' };
    }
    cache.put(emailRateKey, String(emailAttempts + 1), 3600);

    const customer = findCustomerByEmail_(email);
    if (!customer) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    // 1. 通常パスワードで検証（v2自動移行付き）
    var passwordOk = verifyAndMigratePassword_(password, customer.passwordHash, customer.row);

    // 2. 通常パスワードが不一致の場合、仮パスワード（有効期限内）を検証
    if (!passwordOk) {
      var temp = getTempPassword_(email);
      if (temp && verifyPassword_(password, temp.hash)) {
        // 仮パスワードで認証成功 → 本パスワードに昇格
        var newHash = createPasswordHash_(password);
        getCustomerSheet_().getRange(customer.row, 3).setValue(newHash);
        clearTempPassword_(email);
        passwordOk = true;
      }
    }

    if (!passwordOk) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    const sessionId = generateRandomId_(AUTH_CONSTANTS.SESSION_ID_LENGTH);
    var rememberMe = params.rememberMe === true || params.rememberMe === 'true';
    var sessionDuration = rememberMe ? AUTH_CONSTANTS.SESSION_REMEMBER_ME_MS : AUTH_CONSTANTS.SESSION_DURATION_MS;
    const sessionExpiry = new Date(Date.now() + sessionDuration);
    const now = new Date();
    const sheet = getCustomerSheet_();
    sheet.getRange(customer.row, 10, 1, 3).setValues([[now, sessionId, sessionExpiry]]);

    // オーナー判定（PVログ除外用フラグ）
    var isOwner = false;
    try {
      var ownerEmail = String(PropertiesService.getScriptProperties().getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim().toLowerCase();
      if (ownerEmail && email === ownerEmail) isOwner = true;
    } catch(e) {}

    var responseData = {
      sessionId: sessionId,
      customer: {
        id: customer.id, email: customer.email, companyName: customer.companyName,
        phone: customer.phone, postal: customer.postal, address: customer.address,
        newsletter: customer.newsletter, points: customer.points
      }
    };
    if (isOwner) responseData.isOwner = true;

    return { ok: true, data: responseData };
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

    // オーナー判定（PVログ除外用フラグ）
    var isOwner = false;
    try {
      var ownerEmail = String(PropertiesService.getScriptProperties().getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim().toLowerCase();
      var custEmail = String(customer.email || '').trim().toLowerCase();
      if (ownerEmail && custEmail && custEmail === ownerEmail) isOwner = true;
    } catch(e) {}

    var responseData = {
      customer: {
        id: customer.id, email: customer.email, companyName: customer.companyName,
        phone: customer.phone, postal: customer.postal, address: customer.address,
        newsletter: customer.newsletter, points: customer.points
      }
    };
    if (isOwner) responseData.isOwner = true;

    return { ok: true, data: responseData };
  } catch (e) {
    return { ok: false, message: 'セッション検証に失敗しました' };
  }
}

/**
 * 会員属性変更API（パスワード再認証必須）
 */
function apiUpdateCustomerProfile(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '');
    var currentPassword = String(params.currentPassword || '');

    if (!sessionId) return { ok: false, message: 'ログインが必要です' };
    if (!currentPassword) return { ok: false, message: '本人確認のため現在のパスワードを入力してください' };

    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効または期限切れです。再ログインしてください' };

    var fullCustomer = findCustomerByEmail_(customer.email);
    if (!fullCustomer) return { ok: false, message: '顧客情報が見つかりません' };

    if (!verifyPassword_(currentPassword, fullCustomer.passwordHash)) {
      return { ok: false, message: 'パスワードが正しくありません' };
    }

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
      if (!newEmail || !newEmail.includes('@')) return { ok: false, message: '有効なメールアドレスを入力してください' };
      if (newEmail !== fullCustomer.email) {
        if (findCustomerByEmail_(newEmail)) return { ok: false, message: 'このメールアドレスは既に使用されています' };
        sheet.getRange(row, 2).setValue(newEmail);
        updated.push('メールアドレス');
      }
    }

    if (updated.length === 0) return { ok: false, message: '変更する項目がありません' };

    return { ok: true, message: updated.join('、') + ' を更新しました' };
  } catch (e) {
    return { ok: false, message: '更新に失敗しました' };
  }
}

/**
 * パスワード変更API
 */
function apiChangePassword(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '');
    var currentPassword = String(params.currentPassword || '');
    var newPassword = String(params.newPassword || '');

    if (!sessionId) return { ok: false, message: 'ログインが必要です' };
    if (!currentPassword) return { ok: false, message: '現在のパスワードを入力してください' };
    if (!newPassword || newPassword.length < AUTH_CONSTANTS.MIN_PASSWORD_LENGTH) return { ok: false, message: '新しいパスワードは' + AUTH_CONSTANTS.MIN_PASSWORD_LENGTH + '文字以上で入力してください' };

    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効です。再ログインしてください' };

    var fullCustomer = findCustomerByEmail_(customer.email);
    if (!fullCustomer) return { ok: false, message: '顧客情報が見つかりません' };

    if (!verifyPassword_(currentPassword, fullCustomer.passwordHash)) {
      return { ok: false, message: '現在のパスワードが正しくありません' };
    }

    var newHash = createPasswordHash_(newPassword);
    getCustomerSheet_().getRange(fullCustomer.row, 3).setValue(newHash);

    return { ok: true, message: 'パスワードを変更しました' };
  } catch (e) {
    return { ok: false, message: 'パスワード変更に失敗しました' };
  }
}

/**
 * パスワードリセットAPI（仮パスワードに有効期限付き）
 * 仮パスワードは元のパスワードを上書きせず、ScriptPropertiesに期限付きで保存。
 * ログイン時に仮パスワードが有効期限内であれば認証成功→本パスワードに昇格。
 * @param {string} userKey
 * @param {object} params - { email }
 * @return {object} { ok, message }
 */
function apiRequestPasswordReset(userKey, params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }

    var customer = findCustomerByEmail_(email);
    if (!customer) {
      // ユーザー列挙攻撃を防ぐため、存在しない場合も同じメッセージ
      return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
    }

    var tempPassword = generateRandomId_(AUTH_CONSTANTS.TEMP_PASSWORD_LENGTH);
    var tempHash = createTempPasswordHash_(tempPassword);
    var expiresAt = Date.now() + AUTH_CONSTANTS.TEMP_PASSWORD_EXPIRY_MS;

    // 仮パスワードをScriptPropertiesに保存（元のパスワードは上書きしない）
    storeTempPassword_(email, tempHash, expiresAt);

    var expiryMinutes = Math.round(AUTH_CONSTANTS.TEMP_PASSWORD_EXPIRY_MS / 60000);
    var subject = '【デタウリ.Detauri】パスワードリセットのお知らせ';
    var body = customer.companyName + ' 様\n\n'
      + 'パスワードリセットのリクエストを受け付けました。\n'
      + '以下の仮パスワードでログインしてください。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '仮パスワード: ' + tempPassword + '\n'
      + '有効期限: ' + expiryMinutes + '分\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '※ 有効期限を過ぎると仮パスワードは無効になります。\n'
      + 'ログイン後、マイページからパスワードの変更をお勧めします。\n'
      + '※ このメールに心当たりがない場合は、無視してください。\n\n'
      + '──────────────────\n'
      + SITE_CONSTANTS.SITE_NAME + '\n'
      + SITE_CONSTANTS.SITE_URL + '\n'
      + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });

    return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
  } catch (e) {
    console.error('apiRequestPasswordReset error:', e);
    return { ok: false, message: 'パスワードリセットに失敗しました。しばらくしてからお試しください' };
  }
}

/**
 * 仮パスワードをScriptPropertiesに保存
 * @param {string} email
 * @param {string} hash - v2形式ハッシュ
 * @param {number} expiresAt - 有効期限のタイムスタンプ(ms)
 */
function storeTempPassword_(email, hash, expiresAt) {
  var key = 'TEMP_PW_' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, email
  ).map(function(b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('').substring(0, 16);
  var data = JSON.stringify({ hash: hash, expiresAt: expiresAt });
  PropertiesService.getScriptProperties().setProperty(key, data);
}

/**
 * 仮パスワードを取得（有効期限チェック付き）
 * @param {string} email
 * @return {object|null} { hash, expiresAt } or null
 */
function getTempPassword_(email) {
  var key = 'TEMP_PW_' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, email
  ).map(function(b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('').substring(0, 16);
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      // 期限切れ→削除
      PropertiesService.getScriptProperties().deleteProperty(key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * 仮パスワードを削除
 * @param {string} email
 */
function clearTempPassword_(email) {
  var key = 'TEMP_PW_' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, email
  ).map(function(b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('').substring(0, 16);
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
  } catch (e) { console.log('optional: clear temp password: ' + (e.message || e)); }
}

/**
 * メールアドレス確認API
 */
function apiRecoverEmail(userKey, params) {
  try {
    var companyName = String(params.companyName || '').trim();
    var phone = String(params.phone || '').trim().replace(/[-\s]/g, '');

    if (!companyName) return { ok: false, message: '会社名/氏名を入力してください' };
    if (!phone) return { ok: false, message: '電話番号を入力してください' };

    var sheet = getCustomerSheet_();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var rowName = String(data[i][3] || '').trim();
      var rowPhone = String(data[i][4] || '').trim().replace(/[-\s']/g, '');
      if (rowName === companyName && rowPhone === phone) {
        return { ok: true, data: { maskedEmail: maskEmail_(String(data[i][1] || '')) } };
      }
    }

    return { ok: false, message: '一致する登録情報が見つかりませんでした。\n入力内容をご確認いただくか、お問い合わせください。' };
  } catch (e) {
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
  var maskedDomain = (dotIdx > 0)
    ? domain.charAt(0) + '*'.repeat(Math.min(dotIdx - 1, 5)) + domain.substring(dotIdx)
    : domain.charAt(0) + '***';
  return maskedLocal + '@' + maskedDomain;
}

// =====================================================
// マイページAPI
// =====================================================

/**
 * マイページ情報取得API
 */
function apiGetMyPage(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '');
    if (!sessionId) return { ok: false, message: 'ログインが必要です' };

    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効です。再ログインしてください' };

    var fullCustomer = findCustomerByEmail_(customer.email);
    var orders = getOrderHistory_(customer.email);
    var points = fullCustomer ? fullCustomer.points : 0;

    // 統計データ計算
    var totalOrders = orders.length;
    var totalSpent = 0;
    var totalItems = 0;
    for (var i = 0; i < orders.length; i++) {
      totalSpent += Number(orders[i].total) || 0;
      totalItems += Number(orders[i].count) || 0;
    }

    // ランク情報取得
    var rankInfo = calculateCustomerRank_(customer.email);

    return {
      ok: true,
      data: {
        profile: {
          email: customer.email,
          companyName: customer.companyName,
          phone: String(customer.phone || '').replace(/^'/, ''),
          postal: String(customer.postal || '').replace(/^'/, ''),
          address: customer.address,
          newsletter: customer.newsletter,
          registeredAt: fullCustomer ? formatDate_(fullCustomer.registeredAt) : ''
        },
        orders: orders,
        points: points,
        stats: {
          totalOrders: totalOrders,
          totalSpent: totalSpent,
          totalItems: totalItems
        },
        rank: {
          name: rankInfo.name,
          rank: rankInfo.rank,
          pointRate: rankInfo.pointRate,
          freeShipping: rankInfo.freeShipping,
          color: rankInfo.color,
          annualSpent: rankInfo.annualSpent,
          nextRank: rankInfo.nextRank,
          nextThreshold: rankInfo.nextThreshold,
          remaining: rankInfo.remaining,
          graceInfo: rankInfo.graceInfo
        }
      }
    };
  } catch (e) {
    console.error('apiGetMyPage error:', e);
    return { ok: false, message: 'マイページの読み込みに失敗しました' };
  }
}

/**
 * 注文履歴を取得
 */
function getOrderHistory_(email) {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('依頼管理');
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var orders = [];
  var normalizedEmail = String(email).trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][3] || '').trim().toLowerCase();
    if (rowEmail === normalizedEmail) {
      orders.push({
        receiptNo: String(data[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || ''),
        date: data[i][REQUEST_SHEET_COLS.DATETIME - 1] ? formatDate_(data[i][REQUEST_SHEET_COLS.DATETIME - 1]) : '',
        products: String(data[i][REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || ''),
        count: Number(data[i][REQUEST_SHEET_COLS.TOTAL_COUNT - 1]) || 0,
        total: Number(data[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0,
        status: String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || ''),
        shipping: String(data[i][REQUEST_SHEET_COLS.SHIP_COST_SHOP - 1] || ''),
        carrier: String(data[i][REQUEST_SHEET_COLS.CARRIER - 1] || ''),
        tracking: String(data[i][REQUEST_SHEET_COLS.TRACKING - 1] || '')
      });
    }
  }

  orders.reverse();
  return orders;
}

/**
 * 日付フォーマット
 */
function formatDate_(d) {
  if (!d) return '';
  try {
    return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy/MM/dd');
  } catch (e) {
    return String(d);
  }
}

// =====================================================
// ランクシステム
// =====================================================

var RANK_TIERS = {
  DIAMOND:  { name: 'ダイヤモンド', threshold: 500000, pointRate: 0.05, freeShipping: true, color: '#00bcd4' },
  GOLD:     { name: 'ゴールド',     threshold: 200000, pointRate: 0.05, freeShipping: false, color: '#f59e0b' },
  SILVER:   { name: 'シルバー',     threshold: 50000,  pointRate: 0.03, freeShipping: false, color: '#94a3b8' },
  REGULAR:  { name: 'レギュラー',   threshold: 0,      pointRate: 0.01, freeShipping: false, color: '#64748b' }
};

/**
 * 顧客のランクを判定（過去12ヶ月の購入金額ベース）
 * @param {string} email - 顧客メールアドレス
 * @return {object} { rank, name, pointRate, freeShipping, color, annualSpent, nextRank, nextThreshold, graceInfo }
 */
function calculateCustomerRank_(email) {
  var orders = getOrderHistory_(email);
  var now = new Date();

  var spendData = calcSpendByPeriod_(orders, now);
  var prevRank = rankFromSpent_(spendData.prevYearSpent);
  var currentRank = rankFromSpent_(spendData.annualSpent);

  var graceInfo = applyGraceRule_(currentRank, prevRank, spendData.recentSpent);
  currentRank = graceInfo.rank;

  // 復帰ゴールド限定: 年間35万でダイヤモンド昇格
  if (currentRank === 'GOLD' && graceInfo.info && graceInfo.info.restored && prevRank === 'GOLD') {
    if (spendData.annualSpent >= 350000) currentRank = 'DIAMOND';
  }

  var tier = RANK_TIERS[currentRank];
  var nextInfo = getNextRankInfo_(currentRank, graceInfo.info);

  return {
    rank: currentRank,
    name: tier.name,
    pointRate: tier.pointRate,
    freeShipping: tier.freeShipping,
    color: tier.color,
    annualSpent: spendData.annualSpent,
    nextRank: nextInfo.nextRank ? RANK_TIERS[nextInfo.nextRank].name : null,
    nextThreshold: nextInfo.nextThreshold,
    remaining: nextInfo.nextThreshold > 0 ? Math.max(0, nextInfo.nextThreshold - spendData.annualSpent) : 0,
    graceInfo: graceInfo.info
  };
}

/**
 * 完了済み注文を期間別に集計
 * @param {Array} orders - 注文履歴
 * @param {Date} now - 現在日時
 * @return {object} { annualSpent, recentSpent, prevYearSpent }
 */
function calcSpendByPeriod_(orders, now) {
  var oneYearAgo = new Date(now.getTime() - TIME_CONSTANTS.ONE_YEAR_MS);
  var oneMonthAgo = new Date(now.getTime() - TIME_CONSTANTS.ONE_MONTH_MS);
  var twoYearsAgo = new Date(now.getTime() - TIME_CONSTANTS.TWO_YEARS_MS);

  var annualSpent = 0, recentSpent = 0, prevYearSpent = 0;

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o.status !== '完了') continue;
    var orderDate;
    try { orderDate = new Date(o.date.replace(/\//g, '-')); } catch (e) { continue; }
    var total = Number(o.total) || 0;
    if (orderDate >= oneYearAgo) annualSpent += total;
    if (orderDate >= oneMonthAgo) recentSpent += total;
    if (orderDate >= twoYearsAgo && orderDate < oneYearAgo) prevYearSpent += total;
  }

  return { annualSpent: annualSpent, recentSpent: recentSpent, prevYearSpent: prevYearSpent };
}

/**
 * 購入金額からランクを判定
 * @param {number} spent - 購入金額
 * @return {string} ランクキー
 */
function rankFromSpent_(spent) {
  if (spent >= 500000) return 'DIAMOND';
  if (spent >= 200000) return 'GOLD';
  if (spent >= 50000) return 'SILVER';
  return 'REGULAR';
}

/**
 * 救済措置を適用
 * @param {string} currentRank
 * @param {string} prevRank
 * @param {number} recentSpent
 * @return {object} { rank, info }
 */
function applyGraceRule_(currentRank, prevRank, recentSpent) {
  if (currentRank === 'REGULAR' && (prevRank === 'DIAMOND' || prevRank === 'GOLD')) {
    if (recentSpent >= 50000) {
      return { rank: prevRank, info: { restored: true, prevRank: prevRank } };
    }
    return { rank: currentRank, info: { restored: false, prevRank: prevRank, needed: 50000 - recentSpent } };
  }
  return { rank: currentRank, info: null };
}

/**
 * 次のランクまでの情報を取得
 * @param {string} currentRank
 * @param {object|null} graceInfo
 * @return {object} { nextRank, nextThreshold }
 */
function getNextRankInfo_(currentRank, graceInfo) {
  if (currentRank === 'REGULAR') return { nextRank: 'SILVER', nextThreshold: 50000 };
  if (currentRank === 'SILVER') return { nextRank: 'GOLD', nextThreshold: 200000 };
  if (currentRank === 'GOLD') {
    return { nextRank: 'DIAMOND', nextThreshold: (graceInfo && graceInfo.restored) ? 350000 : 500000 };
  }
  return { nextRank: null, nextThreshold: 0 };
}

// =====================================================
// ポイント管理
// =====================================================

/**
 * 完了済み注文にポイントを付与（メニューまたはトリガーから実行）
 */
function processCustomerPoints() {
  var ss = sh_getOrderSs_();
  var reqSheet = ss.getSheetByName('依頼管理');
  var custSheet = getCustomerSheet_();
  if (!reqSheet || !custSheet) return;

  var reqData = reqSheet.getDataRange().getValues();
  var custData = custSheet.getDataRange().getValues();

  // 顧客メール→行番号マップ
  var custMap = {};
  for (var i = 1; i < custData.length; i++) {
    var email = String(custData[i][1] || '').trim().toLowerCase();
    if (email) custMap[email] = { row: i + 1, points: Number(custData[i][12]) || 0 };
  }

  var awarded = 0;
  for (var i = 1; i < reqData.length; i++) {
    var status = String(reqData[i][21] || '');       // V列: ステータス
    var pointFlag = String(reqData[i][17] || '');     // R列: ポイント付与済
    var email = String(reqData[i][3] || '').trim().toLowerCase(); // D列: 連絡先
    var total = Number(reqData[i][11]) || 0;         // L列: 合計金額

    if (status === '完了' && pointFlag !== 'PT' && email && total > 0) {
      if (custMap[email]) {
        // ランクに応じたポイント付与率を取得
        var rankInfo = calculateCustomerRank_(email);
        var pointRate = rankInfo.pointRate || 0.01;
        var points = Math.floor(total * pointRate);
        if (points > 0) {
          custMap[email].points += points;
          custSheet.getRange(custMap[email].row, 13).setValue(custMap[email].points);
          // R列にポイント付与済みマーク
          reqSheet.getRange(i + 1, 18).setValue('PT');
          awarded++;
        }
      }
    }
  }

  if (awarded > 0) {
    try { SpreadsheetApp.getUi().alert('ポイント付与完了: ' + awarded + '件（ランクに応じた付与率で付与）'); } catch (e) { /* トリガー実行時はUI非対応 */ }
  } else {
    try { SpreadsheetApp.getUi().alert('ポイント付与対象の注文はありませんでした'); } catch (e) { /* トリガー実行時はUI非対応 */ }
  }
  console.log('processCustomerPoints: ' + awarded + '件付与');
}

/**
 * 時間ベーストリガーから呼ばれるポイント付与関数
 * SpreadsheetApp.getUi()がないコンテキストでも安全に動作する
 */
function processCustomerPointsAuto_() {
  try {
    var ss = sh_getOrderSs_();
    var reqSheet = ss.getSheetByName('依頼管理');
    var custSheet = getCustomerSheet_();
    if (!reqSheet || !custSheet) { console.log('processCustomerPointsAuto_: シートが見つかりません'); return; }

    var reqData = reqSheet.getDataRange().getValues();
    var custData = custSheet.getDataRange().getValues();

    var custMap = {};
    for (var i = 1; i < custData.length; i++) {
      var email = String(custData[i][1] || '').trim().toLowerCase();
      if (email) custMap[email] = { row: i + 1, points: Number(custData[i][12]) || 0 };
    }

    var awarded = 0;
    for (var i = 1; i < reqData.length; i++) {
      var status = String(reqData[i][21] || '');
      var pointFlag = String(reqData[i][17] || '');
      var email = String(reqData[i][3] || '').trim().toLowerCase();
      var total = Number(reqData[i][11]) || 0;

      if (status === '完了' && pointFlag !== 'PT' && email && total > 0) {
        if (custMap[email]) {
          var rankInfo = calculateCustomerRank_(email);
          var pointRate = rankInfo.pointRate || 0.01;
          var points = Math.floor(total * pointRate);
          if (points > 0) {
            custMap[email].points += points;
            custSheet.getRange(custMap[email].row, 13).setValue(custMap[email].points);
            reqSheet.getRange(i + 1, 18).setValue('PT');
            awarded++;
          }
        }
      }
    }
    console.log('processCustomerPointsAuto_: ' + awarded + '件付与');
  } catch (e) {
    console.error('processCustomerPointsAuto_ error:', e);
  }
}

/**
 * ポイント利用API（注文送信時に呼び出し）
 */
function deductPoints_(email, points) {
  if (!points || points <= 0) return false;
  var customer = findCustomerByEmail_(email);
  if (!customer || customer.points < points) return false;
  var sheet = getCustomerSheet_();
  sheet.getRange(customer.row, 13).setValue(customer.points - points);
  return true;
}

/**
 * ポイント返還（注文キャンセル時に呼び出し）
 */
function addPoints_(email, points) {
  if (!points || points <= 0) return false;
  var customer = findCustomerByEmail_(email);
  if (!customer) return false;
  var sheet = getCustomerSheet_();
  var currentPoints = Number(customer.points || 0);
  sheet.getRange(customer.row, 13).setValue(currentPoints + points);
  return true;
}

// =====================================================
// インボイス領収書
// =====================================================

/**
 * 完了済み注文にインボイス付き領収書を自動送付（メニューまたはトリガーから実行）
 * Z列="希望" かつ AA列が空 かつ V列="完了" の注文に送付
 */
function processInvoiceReceipts() {
  var ss = sh_getOrderSs_();
  var reqSheet = ss.getSheetByName('依頼管理');
  if (!reqSheet) return;

  var data = reqSheet.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();
  var invoiceNo = props.getProperty('INVOICE_REGISTRATION_NO') || 'T0000000000000';

  var sent = 0;
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][21] || '');         // V列: ステータス
    var invoiceFlag = String(data[i][25] || '');   // Z列: インボイス発行
    var sentFlag = String(data[i][26] || '');       // AA列: インボイス状況
    var email = String(data[i][3] || '').trim();   // D列: 連絡先
    var companyName = String(data[i][2] || '');     // C列: 会社名

    if (status === '完了' && invoiceFlag === '希望' && !sentFlag && email) {
      var receiptNo = String(data[i][0] || '');
      var orderDate = data[i][1] ? formatDate_(data[i][1]) : '';
      var totalAmount = Number(data[i][11]) || 0;
      var note = String(data[i][29] || '');         // AD列: 備考

      try {
        sendInvoiceReceipt_(email, {
          receiptNo: receiptNo,
          companyName: companyName,
          orderDate: orderDate,
          totalAmount: totalAmount,
          note: note,
          invoiceNo: invoiceNo
        });
        reqSheet.getRange(i + 1, 27).setValue('送付済');  // AA列: インボイス状況
        sent++;
      } catch (e) {
        console.error('領収書送付エラー: ' + receiptNo, e);
      }
    }
  }

  if (sent > 0) {
    SpreadsheetApp.getUi().alert('領収書送付完了: ' + sent + '件');
  } else {
    SpreadsheetApp.getUi().alert('送付対象の注文はありませんでした');
  }
}

/**
 * キャンセル・返品時の領収書取消処理
 * P列="キャンセル"or"返品" かつ T列="送付済" の注文に取消通知を送付
 */
function processCancelledInvoices() {
  var ss = sh_getOrderSs_();
  var reqSheet = ss.getSheetByName('依頼管理');
  if (!reqSheet) return;

  var data = reqSheet.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();
  var invoiceNo = props.getProperty('INVOICE_REGISTRATION_NO') || 'T0000000000000';

  var sent = 0;
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][21] || '');          // V列: ステータス
    var sentFlag = String(data[i][26] || '');        // AA列: インボイス状況
    var email = String(data[i][3] || '').trim();     // D列: 連絡先

    if ((status === 'キャンセル' || status === '返品') && sentFlag === '送付済' && email) {
      var receiptNo = String(data[i][0] || '');
      var companyName = String(data[i][2] || '');
      var orderDate = data[i][1] ? formatDate_(data[i][1]) : '';
      var totalAmount = Number(data[i][11]) || 0;

      try {
        sendCancelReceipt_(email, {
          receiptNo: receiptNo,
          companyName: companyName,
          orderDate: orderDate,
          totalAmount: totalAmount,
          invoiceNo: invoiceNo,
          cancelType: status
        });
        reqSheet.getRange(i + 1, 27).setValue('取消送付済');  // AA列: インボイス状況
        sent++;
      } catch (e) {
        console.error('取消通知エラー: ' + receiptNo, e);
      }
    }
  }

  if (sent > 0) {
    SpreadsheetApp.getUi().alert('取消通知送付完了: ' + sent + '件');
  } else {
    SpreadsheetApp.getUi().alert('取消対象の注文はありませんでした');
  }
}

/**
 * インボイス付き領収書メール送信
 */
function sendInvoiceReceipt_(email, data) {
  var taxRate = TAX_RATE;
  var taxExcluded = Math.floor(data.totalAmount / (1 + taxRate));
  var taxAmount = data.totalAmount - taxExcluded;
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日');

  var subject = '【デタウリ.Detauri】領収書 No.' + data.receiptNo;
  var body = '━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
    + '　　　　　　　　領　収　書\n'
    + '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
    + data.companyName + ' 様\n\n'
    + '下記の通り領収いたしました。\n\n'
    + '──────────────────────────\n'
    + '受付番号　: ' + data.receiptNo + '\n'
    + '注文日　　: ' + data.orderDate + '\n'
    + '発行日　　: ' + today + '\n'
    + '──────────────────────────\n\n'
    + '【ご請求内容】\n'
    + '　税抜金額　　: ' + formatYen_(taxExcluded) + '\n'
    + '　消費税(10%)　: ' + formatYen_(taxAmount) + '\n'
    + '　────────────────\n'
    + '　合計金額(税込): ' + formatYen_(data.totalAmount) + '\n\n';

  if (data.note) {
    body += '【備考】\n' + data.note + '\n\n';
  }

  body += '──────────────────────────\n'
    + '【発行者情報】\n'
    + '　事業者名　: デタウリ.Detauri\n'
    + '　登録番号　: ' + data.invoiceNo + '\n'
    + '　所在地　　: 大阪府大東市灰塚4-16-15\n'
    + '　電話番号　: 090-5820-1803\n'
    + '　メール　　: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────────────\n\n'
    + '※ この領収書は適格請求書（インボイス）として発行しています。\n'
    + '※ 本メールは自動送信です。ご不明な点がございましたらお問い合わせください。\n\n'
    + 'デタウリ.Detauri\n'
    + 'https://wholesale.nkonline-tool.com\n';

  MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });
}

/**
 * キャンセル/返品時の取消領収書メール
 */
function sendCancelReceipt_(email, data) {
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日');

  var subject = '【デタウリ.Detauri】領収書取消通知 No.' + data.receiptNo;
  var body = data.companyName + ' 様\n\n'
    + '下記の注文について' + data.cancelType + 'に伴い、領収書を取り消しいたします。\n\n'
    + '──────────────────────────\n'
    + '受付番号　: ' + data.receiptNo + '\n'
    + '注文日　　: ' + data.orderDate + '\n'
    + '取消日　　: ' + today + '\n'
    + '取消理由　: ' + data.cancelType + '\n'
    + '取消金額　: ' + formatYen_(data.totalAmount) + '\n'
    + '──────────────────────────\n\n'
    + '【発行者情報】\n'
    + '　事業者名　: デタウリ.Detauri\n'
    + '　登録番号　: ' + data.invoiceNo + '\n'
    + '　所在地　　: 大阪府大東市灰塚4-16-15\n'
    + '──────────────────────────\n\n'
    + '※ 先にお送りした領収書は無効となります。\n'
    + '※ 返金処理は別途ご案内いたします。\n\n'
    + 'デタウリ.Detauri\n'
    + 'https://wholesale.nkonline-tool.com\n';

  MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });
}

/**
 * 金額フォーマット（領収書用）
 */
function formatYen_(n) {
  return String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

// =====================================================
// ログアウト
// =====================================================

/**
 * ログアウトAPI
 */
function apiLogoutCustomer(userKey, params) {
  try {
    const sessionId = String(params.sessionId || '');
    if (!sessionId) return { ok: true };

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
    return { ok: true };
  }
}
