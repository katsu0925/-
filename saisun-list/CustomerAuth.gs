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
 * v2 高速ハッシュ（100回反復）
 * GASの computeDigest オーバーヘッドを考慮し実用的な速度を確保
 * レート制限 + ソルト付きで十分な安全性を維持
 */
function hashPasswordV2_(password, salt) {
  var iterations = 100;
  var input = password + ':' + salt;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  var saltBytes = Utilities.newBlob(salt).getBytes();
  for (var i = 1; i < iterations; i++) {
    var combined = hash.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltBytes));
    hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  }
  return hash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/**
 * v1 旧ハッシュ（10000回反復）- 後方互換用
 */
function hashPassword_(password, salt) {
  var iterations = 10000;
  var input = password + ':' + salt;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  for (var i = 1; i < iterations; i++) {
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
 * パスワードハッシュ文字列を生成（v2形式）
 */
function createPasswordHash_(password) {
  var salt = generateRandomId_(16);
  return 'v2:' + salt + ':' + hashPasswordV2_(password, salt);
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

    if (!email || !email.includes('@')) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }
    if (!password || password.length < 6) {
      return { ok: false, message: 'パスワードは6文字以上で入力してください' };
    }
    if (!companyName) {
      return { ok: false, message: '会社名/氏名は必須です' };
    }
    if (findCustomerByEmail_(email)) {
      return { ok: false, message: 'このメールアドレスは既に登録されています' };
    }

    var passwordHash = createPasswordHash_(password);
    const sessionId = generateRandomId_(32);
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sheet = getCustomerSheet_();
    const customerId = 'C' + Date.now().toString(36).toUpperCase();
    const now = new Date();
    const phoneForSheet = phone ? ("'" + phone) : '';
    const postalForSheet = postal ? ("'" + postal) : '';

    sheet.appendRow([
      customerId, email, passwordHash, companyName, phoneForSheet,
      postalForSheet, address, newsletter, now, now, sessionId, sessionExpiry, 0
    ]);

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

    const customer = findCustomerByEmail_(email);
    if (!customer) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    if (!verifyAndMigratePassword_(password, customer.passwordHash, customer.row)) {
      return { ok: false, message: 'メールアドレスまたはパスワードが正しくありません' };
    }

    const sessionId = generateRandomId_(32);
    var rememberMe = params.rememberMe === true || params.rememberMe === 'true';
    var sessionDuration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const sessionExpiry = new Date(Date.now() + sessionDuration);
    const now = new Date();
    const sheet = getCustomerSheet_();
    sheet.getRange(customer.row, 10).setValue(now);
    sheet.getRange(customer.row, 11).setValue(sessionId);
    sheet.getRange(customer.row, 12).setValue(sessionExpiry);

    return {
      ok: true,
      data: {
        sessionId: sessionId,
        customer: {
          id: customer.id, email: customer.email, companyName: customer.companyName,
          phone: customer.phone, postal: customer.postal, address: customer.address,
          newsletter: customer.newsletter, points: customer.points
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
          id: customer.id, email: customer.email, companyName: customer.companyName,
          phone: customer.phone, postal: customer.postal, address: customer.address,
          newsletter: customer.newsletter, points: customer.points
        }
      }
    };
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
    if (!newPassword || newPassword.length < 6) return { ok: false, message: '新しいパスワードは6文字以上で入力してください' };

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
 * パスワードリセットAPI（v2ハッシュ使用 - 高速）
 */
function apiRequestPasswordReset(userKey, params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }

    var customer = findCustomerByEmail_(email);
    if (!customer) {
      return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
    }

    var tempPassword = generateRandomId_(8);
    var newHash = createPasswordHash_(tempPassword);
    var sheet = getCustomerSheet_();
    sheet.getRange(customer.row, 3).setValue(newHash);

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

    MailApp.sendEmail({ to: email, subject: subject, body: body, noReply: true });

    return { ok: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました' };
  } catch (e) {
    console.error('apiRequestPasswordReset error:', e);
    return { ok: false, message: 'パスワードリセットに失敗しました。しばらくしてからお試しください' };
  }
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
        points: points
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
        receiptNo: String(data[i][0] || ''),
        date: data[i][1] ? formatDate_(data[i][1]) : '',
        products: String(data[i][7] || ''),
        count: Number(data[i][10]) || 0,
        total: Number(data[i][11]) || 0,
        status: String(data[i][15] || ''),
        shipping: String(data[i][12] || ''),
        carrier: String(data[i][22] || ''),
        tracking: String(data[i][23] || '')
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
// ポイント管理
// =====================================================

var POINT_RATE = 0.01; // 購入金額の1%

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
    var status = String(reqData[i][15] || '');       // P列: ステータス
    var notifFlag = String(reqData[i][26] || '');     // AA列: 通知フラグ
    var email = String(reqData[i][3] || '').trim().toLowerCase(); // D列: 連絡先
    var total = Number(reqData[i][11]) || 0;         // L列: 合計金額

    if (status === '完了' && notifFlag.indexOf('PT') === -1 && email && total > 0) {
      var points = Math.floor(total * POINT_RATE);
      if (points > 0 && custMap[email]) {
        custMap[email].points += points;
        custSheet.getRange(custMap[email].row, 13).setValue(custMap[email].points);
        // ポイント付与済みマーク
        reqSheet.getRange(i + 1, 27).setValue(notifFlag ? notifFlag + ',PT' : 'PT');
        awarded++;
      }
    }
  }

  if (awarded > 0) {
    SpreadsheetApp.getUi().alert('ポイント付与完了: ' + awarded + '件（1%付与）');
  } else {
    SpreadsheetApp.getUi().alert('ポイント付与対象の注文はありませんでした');
  }
}

/**
 * ポイント利用API（見積もり送信時に呼び出し）
 */
function deductPoints_(email, points) {
  if (!points || points <= 0) return false;
  var customer = findCustomerByEmail_(email);
  if (!customer || customer.points < points) return false;
  var sheet = getCustomerSheet_();
  sheet.getRange(customer.row, 13).setValue(customer.points - points);
  return true;
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
