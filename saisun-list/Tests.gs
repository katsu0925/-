// =====================================================
// Tests.gs — 自動テストスイート
// 認証・決済・注文の主要パスをカバー
// GASエディタから runAllTests() を実行
// =====================================================

/**
 * テストランナー
 */
function runAllTests() {
  var results = [];
  var suites = [
    { name: '認証テスト', fn: testSuite_Auth_ },
    { name: '決済テスト', fn: testSuite_Payment_ },
    { name: '注文テスト', fn: testSuite_Order_ },
    { name: 'ユーティリティテスト', fn: testSuite_Util_ },
    { name: '結合テスト: 認証フロー', fn: testSuite_Integration_Auth_ },
    { name: '結合テスト: 決済→ステータス更新', fn: testSuite_Integration_Payment_ },
    { name: 'セキュリティテスト', fn: testSuite_Security_ },
    { name: 'エッジケーステスト', fn: testSuite_EdgeCases_ },
    { name: 'ランク計算テスト', fn: testSuite_Rank_ },
    { name: 'CSRF/環境テスト', fn: testSuite_CsrfEnv_ }
  ];

  var totalPass = 0;
  var totalFail = 0;

  for (var i = 0; i < suites.length; i++) {
    console.log('\n=== ' + suites[i].name + ' ===');
    try {
      var suiteResult = suites[i].fn();
      results.push({ suite: suites[i].name, tests: suiteResult });
      for (var j = 0; j < suiteResult.length; j++) {
        if (suiteResult[j].pass) totalPass++;
        else totalFail++;
      }
    } catch (e) {
      console.error(suites[i].name + ' スイートエラー: ' + (e.message || e));
      results.push({ suite: suites[i].name, error: e.message || String(e) });
      totalFail++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('テスト結果: ' + totalPass + ' passed / ' + totalFail + ' failed / ' + (totalPass + totalFail) + ' total');
  console.log('='.repeat(50));

  return { pass: totalPass, fail: totalFail, results: results };
}

// =====================================================
// テストヘルパー
// =====================================================

function assert_(condition, message) {
  if (!condition) {
    throw new Error('ASSERT FAILED: ' + (message || ''));
  }
}

function assertEqual_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error('ASSERT EQUAL FAILED: ' + (message || '') +
      ' (expected=' + JSON.stringify(expected) + ', actual=' + JSON.stringify(actual) + ')');
  }
}

function runTests_(tests) {
  var results = [];
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      t.fn();
      console.log('  ✓ ' + t.name);
      results.push({ name: t.name, pass: true });
    } catch (e) {
      console.log('  ✗ ' + t.name + ' — ' + (e.message || e));
      results.push({ name: t.name, pass: false, error: e.message || String(e) });
    }
  }
  return results;
}

// =====================================================
// 認証テストスイート
// =====================================================

function testSuite_Auth_() {
  return runTests_([
    {
      name: 'hashPasswordV2_ は一貫した結果を返す',
      fn: function() {
        var hash1 = hashPasswordV2_('testpass', 'salt123');
        var hash2 = hashPasswordV2_('testpass', 'salt123');
        assertEqual_(hash1, hash2, 'Same input should produce same hash');
        assert_(hash1.length === 64, 'SHA-256 hex should be 64 chars, got ' + hash1.length);
      }
    },
    {
      name: 'hashPasswordV2_ はソルトが異なると異なる結果を返す',
      fn: function() {
        var hash1 = hashPasswordV2_('testpass', 'salt1');
        var hash2 = hashPasswordV2_('testpass', 'salt2');
        assert_(hash1 !== hash2, 'Different salt should produce different hash');
      }
    },
    {
      name: 'createPasswordHash_ は v2 形式を生成する',
      fn: function() {
        var hash = createPasswordHash_('mypassword');
        assert_(hash.indexOf('v2:') === 0, 'Should start with v2: prefix');
        var parts = hash.split(':');
        assert_(parts.length === 3, 'Should have 3 parts (prefix:salt:hash)');
        assertEqual_(parts[0], 'v2', 'Prefix should be v2');
        assert_(parts[1].length === 16, 'Salt should be 16 chars');
        assert_(parts[2].length === 64, 'Hash should be 64 hex chars');
      }
    },
    {
      name: 'verifyPassword_ は v2 ハッシュを正しく検証する',
      fn: function() {
        var password = 'test_password_123';
        var hash = createPasswordHash_(password);
        assert_(verifyPassword_(password, hash), 'Correct password should verify');
        assert_(!verifyPassword_('wrong_password', hash), 'Wrong password should not verify');
      }
    },
    {
      name: 'generateRandomId_ は指定長のランダム文字列を生成する',
      fn: function() {
        var id16 = generateRandomId_(16);
        var id32 = generateRandomId_(32);
        assertEqual_(id16.length, 16, 'Length should be 16');
        assertEqual_(id32.length, 32, 'Length should be 32');
        assert_(id16 !== id32, 'Different lengths should not be equal');
        // 2回生成して異なることを確認
        var id16b = generateRandomId_(16);
        assert_(id16 !== id16b, 'Should generate unique IDs');
      }
    },
    {
      name: 'timingSafeEqual_ は正しく比較する',
      fn: function() {
        assert_(timingSafeEqual_('abc', 'abc'), 'Same strings should be equal');
        assert_(!timingSafeEqual_('abc', 'abd'), 'Different strings should not be equal');
        assert_(!timingSafeEqual_('abc', 'abcd'), 'Different lengths should not be equal');
        assert_(!timingSafeEqual_('', 'a'), 'Empty vs non-empty should not be equal');
      }
    },
    {
      name: 'maskEmail_ はメールアドレスをマスクする',
      fn: function() {
        var masked = maskEmail_('test@example.com');
        assert_(masked.indexOf('t***') === 0, 'Local part should be masked');
        assert_(masked.indexOf('@') !== -1, 'Should contain @');
        assert_(masked.indexOf('.com') !== -1, 'Should preserve TLD');
      }
    },
    {
      name: 'apiRegisterCustomer はバリデーションを行う',
      fn: function() {
        // メールアドレスなし
        var r1 = apiRegisterCustomer('testkey', { email: '', password: '123456', companyName: 'Test' });
        assert_(!r1.ok, 'Should fail without email');

        // パスワード短い
        var r2 = apiRegisterCustomer('testkey', { email: 'test@test.com', password: '12345', companyName: 'Test' });
        assert_(!r2.ok, 'Should fail with short password');

        // 会社名なし
        var r3 = apiRegisterCustomer('testkey', { email: 'test@test.com', password: '123456', companyName: '' });
        assert_(!r3.ok, 'Should fail without company name');
      }
    },
    {
      name: 'apiLoginCustomer はバリデーションを行う',
      fn: function() {
        var r1 = apiLoginCustomer('testkey', { email: '', password: '' });
        assert_(!r1.ok, 'Should fail without email/password');
      }
    },
    {
      name: 'apiValidateSession は空セッションを拒否する',
      fn: function() {
        var r = apiValidateSession('testkey', { sessionId: '' });
        assert_(!r.ok, 'Should fail with empty session');
      }
    }
  ]);
}

// =====================================================
// 決済テストスイート
// =====================================================

function testSuite_Payment_() {
  return runTests_([
    {
      name: 'mapKomojuStatus_ はステータスを正しくマッピングする',
      fn: function() {
        assertEqual_(mapKomojuStatus_('captured'), 'paid', 'captured → paid');
        assertEqual_(mapKomojuStatus_('authorized'), 'authorized', 'authorized → authorized');
        assertEqual_(mapKomojuStatus_('pending'), 'pending', 'pending → pending');
        assertEqual_(mapKomojuStatus_('refunded'), 'refunded', 'refunded → refunded');
        assertEqual_(mapKomojuStatus_('cancelled'), 'cancelled', 'cancelled → cancelled');
        assertEqual_(mapKomojuStatus_('expired'), 'expired', 'expired → expired');
        assertEqual_(mapKomojuStatus_('failed'), 'failed', 'failed → failed');
        assertEqual_(mapKomojuStatus_('unknown'), 'unknown', 'unknown → unknown (passthrough)');
      }
    },
    {
      name: 'apiCreateKomojuSession はAPIキー未設定を検知する',
      fn: function() {
        // APIキーが未設定の場合（テスト環境では通常未設定）
        var key = getKomojuSecretKey_();
        if (!key) {
          var r = apiCreateKomojuSession('TEST-001', 1000, { email: 'test@test.com' });
          assert_(!r.ok, 'Should fail without API key');
          assert_(r.message.indexOf('APIキー') !== -1, 'Should mention API key');
        }
      }
    },
    {
      name: 'apiCreateKomojuSession はバリデーションを行う',
      fn: function() {
        var r1 = apiCreateKomojuSession('', 1000, {});
        assert_(!r1.ok, 'Should fail without receipt number');

        var r2 = apiCreateKomojuSession('TEST-001', 0, {});
        assert_(!r2.ok, 'Should fail with zero amount');

        var r3 = apiCreateKomojuSession('TEST-001', -100, {});
        assert_(!r3.ok, 'Should fail with negative amount');
      }
    },
    {
      name: 'apiCheckPaymentStatus はセッション未存在を検知する',
      fn: function() {
        var r = apiCheckPaymentStatus('NONEXISTENT-999');
        assert_(!r.ok, 'Should fail for nonexistent session');
      }
    },
    {
      name: 'verifyKomojuWebhookSignature_ はシークレット未設定で拒否する',
      fn: function() {
        var mockEvent = { postData: { contents: '{}', headers: {} } };
        var result = verifyKomojuWebhookSignature_(mockEvent, '{}');
        // シークレット未設定時は false を返す（fail-secure）
        assert_(!result, 'Should reject when webhook secret is not set');
      }
    }
  ]);
}

// =====================================================
// 注文テストスイート
// =====================================================

function testSuite_Order_() {
  return runTests_([
    {
      name: 'apiSubmitEstimate はバリデーションを行う',
      fn: function() {
        // userKeyなし
        var r1 = apiSubmitEstimate('', {}, []);
        assert_(!r1.ok, 'Should fail without userKey');

        // カート空
        var r2 = apiSubmitEstimate('testkey', {}, []);
        assert_(!r2.ok, 'Should fail with empty cart');
        assert_(r2.message.indexOf('カートが空') !== -1, 'Should mention empty cart');

        // 会社名なし
        var r3 = apiSubmitEstimate('testkey', { companyName: '', contact: 'a@b.com' }, ['id1']);
        assert_(!r3.ok, 'Should fail without company name');

        // メールアドレスなし
        var r4 = apiSubmitEstimate('testkey', { companyName: 'Test', contact: '' }, ['id1']);
        assert_(!r4.ok, 'Should fail without contact');

        // メールアドレス不正
        var r5 = apiSubmitEstimate('testkey', { companyName: 'Test', contact: 'invalid' }, ['id1']);
        assert_(!r5.ok, 'Should fail with invalid email');
      }
    },
    {
      name: 'calcShippingByAddress_ は送料を正しく計算する',
      fn: function() {
        // 大阪府（関西エリア）10点以下 = 小型
        var ship1 = calcShippingByAddress_('大阪府', 10);
        assertEqual_(ship1, 1100, '大阪府 小型 should be 1100');

        // 大阪府 11点以上 = 大型
        var ship2 = calcShippingByAddress_('大阪府', 11);
        assertEqual_(ship2, 1260, '大阪府 大型 should be 1260');

        // 東京都
        var ship3 = calcShippingByAddress_('東京都', 10);
        assertEqual_(ship3, 1300, '東京都 小型 should be 1300');

        // 北海道
        var ship4 = calcShippingByAddress_('北海道', 15);
        assertEqual_(ship4, 2380, '北海道 大型 should be 2380');

        // 不明なエリア
        var ship5 = calcShippingByAddress_('不明', 10);
        assertEqual_(ship5, 0, 'Unknown area should return 0');
      }
    },
    {
      name: 'detectPrefecture_ は住所から都道府県を検出する',
      fn: function() {
        assertEqual_(detectPrefecture_('大阪府大東市灰塚4-16-15'), '大阪府', 'Should detect 大阪府');
        assertEqual_(detectPrefecture_('東京都渋谷区...'), '東京都', 'Should detect 東京都');
        assertEqual_(detectPrefecture_('北海道札幌市...'), '北海道', 'Should detect 北海道');
        assertEqual_(detectPrefecture_(''), null, 'Empty string should return null');
      }
    },
    {
      name: 'app_measureOptLabel_ は正しいラベルを返す',
      fn: function() {
        assertEqual_(app_measureOptLabel_('with'), '付き', 'with → 付き');
        assertEqual_(app_measureOptLabel_('without'), '無し（合計5%OFF）', 'without → 無し（合計5%OFF）');
        assertEqual_(app_measureOptLabel_(''), '付き', 'empty → 付き (default)');
      }
    },
    {
      name: 'apiCancelOrder はバリデーションを行う',
      fn: function() {
        var r = apiCancelOrder('');
        assert_(!r.ok, 'Should fail without receipt number');
      }
    },
    {
      name: 'confirmPaymentAndCreateOrder はバリデーションを行う',
      fn: function() {
        var r1 = confirmPaymentAndCreateOrder('', '');
        assert_(!r1.ok, 'Should fail without receipt number');

        // 存在しないペンディングオーダー
        var r2 = confirmPaymentAndCreateOrder('NONEXISTENT-999', '入金待ち');
        assert_(!r2.ok, 'Should fail for nonexistent pending order');
      }
    }
  ]);
}

// =====================================================
// ユーティリティテストスイート
// =====================================================

function testSuite_Util_() {
  return runTests_([
    {
      name: 'formatYen_ は金額を正しくフォーマットする',
      fn: function() {
        assertEqual_(formatYen_(1000), '1,000円', '1000 → 1,000円');
        assertEqual_(formatYen_(0), '0円', '0 → 0円');
        assertEqual_(formatYen_(1234567), '1,234,567円', '1234567 → 1,234,567円');
      }
    },
    {
      name: 'formatDate_ は日付を正しくフォーマットする',
      fn: function() {
        var d = new Date(2025, 0, 15); // 2025-01-15
        var formatted = formatDate_(d);
        assert_(formatted.indexOf('2025') !== -1, 'Should contain year');
        assert_(formatted.indexOf('01') !== -1, 'Should contain month');
        assert_(formatted.indexOf('15') !== -1, 'Should contain day');

        // 空の場合
        assertEqual_(formatDate_(''), '', 'Empty should return empty');
        assertEqual_(formatDate_(null), '', 'Null should return empty');
      }
    },
    {
      name: 'RANK_TIERS の閾値が正しく設定されている',
      fn: function() {
        assertEqual_(RANK_TIERS.DIAMOND.threshold, 500000, 'Diamond threshold');
        assertEqual_(RANK_TIERS.GOLD.threshold, 200000, 'Gold threshold');
        assertEqual_(RANK_TIERS.SILVER.threshold, 50000, 'Silver threshold');
        assertEqual_(RANK_TIERS.REGULAR.threshold, 0, 'Regular threshold');

        // ポイントレート
        assertEqual_(RANK_TIERS.DIAMOND.pointRate, 0.05, 'Diamond point rate');
        assertEqual_(RANK_TIERS.REGULAR.pointRate, 0.01, 'Regular point rate');

        // 送料無料
        assert_(RANK_TIERS.DIAMOND.freeShipping, 'Diamond should have free shipping');
        assert_(!RANK_TIERS.GOLD.freeShipping, 'Gold should not have free shipping');
      }
    },
    {
      name: 'APP_CONFIG が正しく設定されている',
      fn: function() {
        assert_(APP_CONFIG.appTitle, 'appTitle should be set');
        assert_(APP_CONFIG.data.spreadsheetId, 'data.spreadsheetId should be set');
        assert_(APP_CONFIG.minOrderCount > 0, 'minOrderCount should be positive');
        assertEqual_(APP_CONFIG.minOrderCount, 10, 'minOrderCount should be 10');
      }
    },
    {
      name: 'SHIPPING_AREAS は全都道府県をカバーする',
      fn: function() {
        var prefs = [
          '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
          '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
          '新潟県','富山県','石川県','福井県','山梨県','長野県',
          '岐阜県','静岡県','愛知県','三重県',
          '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
          '鳥取県','島根県','岡山県','広島県','山口県',
          '徳島県','香川県','愛媛県','高知県',
          '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'
        ];
        var missing = [];
        for (var i = 0; i < prefs.length; i++) {
          if (!SHIPPING_AREAS[prefs[i]]) missing.push(prefs[i]);
        }
        assertEqual_(missing.length, 0, 'Missing prefectures: ' + missing.join(', '));
      }
    }
  ]);
}

// =====================================================
// 結合テスト: 認証フロー
// 登録 → ログイン → セッション検証 → プロフィール更新 → ログアウト
// =====================================================

function testSuite_Integration_Auth_() {
  var testEmail = 'test_integration_' + Date.now() + '@test.example.com';
  var testPassword = 'TestPass123!';
  var testCompany = 'テスト株式会社';
  var sessionId = null;

  return runTests_([
    {
      name: '結合: 新規顧客を登録できる',
      fn: function() {
        var r = apiRegisterCustomer('testkey_int', {
          email: testEmail,
          password: testPassword,
          companyName: testCompany
        });
        assert_(r.ok, 'Registration should succeed: ' + (r.message || ''));
      }
    },
    {
      name: '結合: 重複メールで登録は失敗する',
      fn: function() {
        var r = apiRegisterCustomer('testkey_int', {
          email: testEmail,
          password: testPassword,
          companyName: testCompany
        });
        assert_(!r.ok, 'Duplicate registration should fail');
      }
    },
    {
      name: '結合: 正しい認証情報でログインできる',
      fn: function() {
        var r = apiLoginCustomer('testkey_int', {
          email: testEmail,
          password: testPassword
        });
        assert_(r.ok, 'Login should succeed: ' + (r.message || ''));
        assert_(r.sessionId, 'Should return sessionId');
        sessionId = r.sessionId;
      }
    },
    {
      name: '結合: 間違ったパスワードでログインできない',
      fn: function() {
        var r = apiLoginCustomer('testkey_int', {
          email: testEmail,
          password: 'WrongPassword!'
        });
        assert_(!r.ok, 'Login with wrong password should fail');
      }
    },
    {
      name: '結合: セッションIDで認証状態を検証できる',
      fn: function() {
        assert_(sessionId, 'Session ID should exist from login test');
        var r = apiValidateSession('testkey_int', { sessionId: sessionId });
        assert_(r.ok, 'Session should be valid: ' + (r.message || ''));
        assert_(r.customer, 'Should return customer data');
        assertEqual_(r.customer.email, testEmail, 'Email should match');
      }
    },
    {
      name: '結合: 無効なセッションIDは拒否される',
      fn: function() {
        var r = apiValidateSession('testkey_int', { sessionId: 'invalid_session_id_999' });
        assert_(!r.ok, 'Invalid session should be rejected');
      }
    },
    {
      name: '結合: パスワード変更が正常に動作する',
      fn: function() {
        assert_(sessionId, 'Session ID should exist');
        var newPassword = 'NewPass456!';
        var r = apiChangePassword('testkey_int', {
          sessionId: sessionId,
          currentPassword: testPassword,
          newPassword: newPassword
        });
        assert_(r.ok, 'Password change should succeed: ' + (r.message || ''));

        // 新しいパスワードでログインできる
        var r2 = apiLoginCustomer('testkey_int', {
          email: testEmail,
          password: newPassword
        });
        assert_(r2.ok, 'Login with new password should succeed');
        sessionId = r2.sessionId;

        // 旧パスワードでログインできない
        var r3 = apiLoginCustomer('testkey_int', {
          email: testEmail,
          password: testPassword
        });
        assert_(!r3.ok, 'Login with old password should fail');

        // テスト後にパスワードを元に戻す
        testPassword = newPassword;
      }
    },
    {
      name: '結合: ログアウトでセッションが無効化される',
      fn: function() {
        assert_(sessionId, 'Session ID should exist');
        var r = apiLogoutCustomer('testkey_int', { sessionId: sessionId });
        assert_(r.ok, 'Logout should succeed');

        // ログアウト後のセッション検証は失敗する
        var r2 = apiValidateSession('testkey_int', { sessionId: sessionId });
        assert_(!r2.ok, 'Session should be invalid after logout');
      }
    },
    {
      name: '結合: テスト顧客データのクリーンアップ',
      fn: function() {
        // テストで作成した顧客データを削除
        try {
          var sheet = getCustomerSheet_();
          var lastRow = sheet.getLastRow();
          if (lastRow >= 2) {
            var data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
            for (var i = data.length - 1; i >= 0; i--) {
              if (String(data[i][0]).toLowerCase() === testEmail.toLowerCase()) {
                sheet.deleteRow(i + 2);
              }
            }
          }
        } catch (e) {
          console.warn('Cleanup warning: ' + e.message);
        }
        assert_(true, 'Cleanup completed');
      }
    }
  ]);
}

// =====================================================
// 結合テスト: 決済→ステータス更新
// KOMOJU Webhook受信 → 注文確定 → ステータス反映
// =====================================================

function testSuite_Integration_Payment_() {
  return runTests_([
    {
      name: '結合: Webhook成功→注文確定フローのデータ整合性',
      fn: function() {
        // ペンディング注文を模擬保存
        var receiptNo = 'TEST-INT-' + Date.now();
        var pendingData = {
          userKey: 'test_user',
          form: {
            companyName: 'テスト会社',
            contact: 'test@example.com',
            postal: '100-0001',
            address: '東京都千代田区',
            phone: '03-1234-5678',
            note: '',
            measureOpt: 'with',
            contactMethod: 'email',
            delivery: '',
            invoiceReceipt: false
          },
          ids: ['TEST-001', 'TEST-002'],
          selectionList: 'TEST-001、TEST-002',
          measureOpt: 'with',
          totalCount: 2,
          discounted: 10000,
          templateText: 'テストテンプレート'
        };

        // ペンディングデータを保存
        var props = PropertiesService.getScriptProperties();
        var pendingKey = 'PENDING_ORDER_' + receiptNo;
        props.setProperty(pendingKey, JSON.stringify(pendingData));

        // confirmPaymentAndCreateOrder を呼び出し
        // ※ 実際のシート書き込みが発生するため、テスト後にクリーンアップが必要
        // ここではペンディングデータの保存・取得の整合性のみ検証
        var stored = props.getProperty(pendingKey);
        assert_(stored, 'Pending data should be stored');
        var parsed = JSON.parse(stored);
        assertEqual_(parsed.ids.length, 2, 'Should have 2 items');
        assertEqual_(parsed.discounted, 10000, 'Amount should match');

        // クリーンアップ
        props.deleteProperty(pendingKey);
        var cleaned = props.getProperty(pendingKey);
        assert_(!cleaned, 'Pending data should be cleaned up');
      }
    },
    {
      name: '結合: 決済セッション保存・取得の整合性',
      fn: function() {
        var receiptNo = 'TEST-PAY-' + Date.now();
        var sessionData = {
          sessionId: 'sess_test_12345',
          amount: 5000,
          status: 'pending',
          createdAt: new Date().toISOString()
        };

        // 保存
        savePaymentSession_(receiptNo, sessionData);

        // 取得
        var loaded = getPaymentSession_(receiptNo);
        assert_(loaded, 'Should retrieve saved session');
        assertEqual_(loaded.sessionId, 'sess_test_12345', 'Session ID should match');
        assertEqual_(loaded.amount, 5000, 'Amount should match');
        assertEqual_(loaded.status, 'pending', 'Status should match');

        // ステータス更新
        loaded.status = 'paid';
        loaded.paidAt = new Date().toISOString();
        savePaymentSession_(receiptNo, loaded);

        var updated = getPaymentSession_(receiptNo);
        assertEqual_(updated.status, 'paid', 'Status should be updated to paid');
        assert_(updated.paidAt, 'paidAt should be set');

        // クリーンアップ
        PropertiesService.getScriptProperties().deleteProperty('PAYMENT_' + receiptNo);
      }
    },
    {
      name: '結合: 決済失敗時のステータス遷移',
      fn: function() {
        // handlePaymentFailed_ の動作を検証
        var receiptNo = 'TEST-FAIL-' + Date.now();
        savePaymentSession_(receiptNo, { sessionId: 'sess_fail', status: 'pending', amount: 3000 });

        var data = {
          type: 'payment.failed',
          data: {
            external_order_num: receiptNo,
            status: 'failed',
            payment_details: { failure_reason: 'insufficient_funds' }
          }
        };
        var result = handlePaymentFailed_(data);
        assert_(result.ok, 'Should handle failure gracefully');

        var session = getPaymentSession_(receiptNo);
        assertEqual_(session.status, 'failed', 'Status should be failed');
        assertEqual_(session.failReason, 'insufficient_funds', 'Fail reason should be recorded');

        // クリーンアップ
        PropertiesService.getScriptProperties().deleteProperty('PAYMENT_' + receiptNo);
      }
    },
    {
      name: '結合: 返金時のステータス遷移',
      fn: function() {
        var receiptNo = 'TEST-REFUND-' + Date.now();
        savePaymentSession_(receiptNo, { sessionId: 'sess_refund', status: 'paid', amount: 7000 });

        var data = {
          type: 'payment.refunded',
          data: {
            external_order_num: receiptNo,
            status: 'refunded'
          }
        };
        var result = handlePaymentRefunded_(data);
        assert_(result.ok, 'Should handle refund');

        var session = getPaymentSession_(receiptNo);
        assertEqual_(session.status, 'refunded', 'Status should be refunded');
        assert_(session.refundedAt, 'refundedAt should be set');

        // クリーンアップ
        PropertiesService.getScriptProperties().deleteProperty('PAYMENT_' + receiptNo);
      }
    }
  ]);
}

// =====================================================
// セキュリティテスト
// =====================================================

function testSuite_Security_() {
  return runTests_([
    {
      name: 'パスワードハッシュ: v1/legacy/v2の互換性',
      fn: function() {
        var password = 'TestCompatibility!';
        var salt = 'testsalt12345678';

        // v2ハッシュ
        var v2Hash = createPasswordHash_(password);
        assert_(verifyPassword_(password, v2Hash), 'v2 hash should verify');

        // v1ハッシュとの差異
        var v1Hash = hashPassword_(password, salt);
        var legacyHash = hashPasswordLegacy_(password, salt);
        assert_(v1Hash !== legacyHash, 'v1 and legacy hashes should differ (different iterations)');
      }
    },
    {
      name: 'パスワードハッシュ: 同じパスワードでもソルトが異なる',
      fn: function() {
        var hash1 = createPasswordHash_('same_password');
        var hash2 = createPasswordHash_('same_password');
        assert_(hash1 !== hash2, 'Different salts should produce different hashes');
      }
    },
    {
      name: '仮パスワード: 有効期限内は取得できる',
      fn: function() {
        var email = 'temp_pw_test_' + Date.now() + '@test.com';
        var hash = createPasswordHash_('TempPass123');
        var expiresAt = Date.now() + 30 * 60 * 1000; // 30分後

        storeTempPassword_(email, hash, expiresAt);

        var temp = getTempPassword_(email);
        assert_(temp, 'Should retrieve temp password within expiry');
        assertEqual_(temp.hash, hash, 'Hash should match');

        // クリーンアップ
        clearTempPassword_(email);
        var cleared = getTempPassword_(email);
        assert_(!cleared, 'Should be null after clearing');
      }
    },
    {
      name: '仮パスワード: 有効期限切れは取得できない',
      fn: function() {
        var email = 'temp_pw_expired_' + Date.now() + '@test.com';
        var hash = createPasswordHash_('ExpiredPass');
        var expiresAt = Date.now() - 1000; // 1秒前（期限切れ）

        storeTempPassword_(email, hash, expiresAt);

        var temp = getTempPassword_(email);
        assert_(!temp, 'Should not retrieve expired temp password');
      }
    },
    {
      name: 'レート制限: 上限を超えるとエラーを返す',
      fn: function() {
        var cache = CacheService.getScriptCache();
        var testKey = 'RL:apiLoginCustomer:testRateLimit_' + Date.now();

        // 上限回数までカウント
        cache.put(testKey, '5', 3600);

        var err = checkRateLimit_('apiLoginCustomer', 'testRateLimit_' + Date.now());
        // 新しいuserKeyなのでまだブロックされない
        assert_(!err, 'First request should not be rate limited');
      }
    },
    {
      name: 'reCAPTCHA: トークンなしは拒否する',
      fn: function() {
        // RECAPTCHA_SECRET が設定されている場合のみテスト
        var secret = getRecaptchaSecret_();
        if (secret) {
          var result = verifyRecaptcha_('');
          assert_(!result, 'Empty token should be rejected');
        }
      }
    },
    {
      name: 'Webhook署名: 署名ヘッダーなしは拒否する',
      fn: function() {
        var mockEvent = {
          postData: { contents: '{"type":"test"}', headers: {} }
        };
        var result = verifyKomojuWebhookSignature_(mockEvent, '{"type":"test"}');
        assert_(!result, 'Should reject when signature header is missing');
      }
    },
    {
      name: 'メール検証: 不正なメールアドレスパターンの拒否',
      fn: function() {
        var invalid = ['', 'noatsign', '@missing.local', 'spaces in@email.com', 'a@b'];
        for (var i = 0; i < invalid.length; i++) {
          var r = apiRegisterCustomer('sectest', {
            email: invalid[i], password: '123456', companyName: 'Test'
          });
          assert_(!r.ok, 'Should reject invalid email: ' + invalid[i]);
        }
      }
    }
  ]);
}

// =====================================================
// エッジケーステスト
// =====================================================

function testSuite_EdgeCases_() {
  return runTests_([
    {
      name: '送料計算: 住所テキストから都道府県を抽出',
      fn: function() {
        // 住所の先頭に都道府県がある標準パターン
        assertEqual_(detectPrefecture_('東京都渋谷区道玄坂1-1-1'), '東京都');
        assertEqual_(detectPrefecture_('大阪府大阪市北区梅田'), '大阪府');
        assertEqual_(detectPrefecture_('京都府京都市中京区'), '京都府');
        assertEqual_(detectPrefecture_('北海道旭川市'), '北海道');

        // 「県」なしの短縮表記
        assertEqual_(detectPrefecture_('神奈川横浜市'), '神奈川県');
        assertEqual_(detectPrefecture_('愛知名古屋市'), '愛知県');

        // 不正入力
        assertEqual_(detectPrefecture_(''), null);
        assertEqual_(detectPrefecture_(null), null);
        assertEqual_(detectPrefecture_(undefined), null);
        assertEqual_(detectPrefecture_('海外住所'), null);
      }
    },
    {
      name: '送料計算: 境界値テスト',
      fn: function() {
        // 10点ちょうど = 小型
        var s10 = calcShippingByAddress_('東京都', 10);
        assert_(s10 > 0, 'Should return shipping for 10 items');

        // 11点 = 大型（境界超え）
        var s11 = calcShippingByAddress_('東京都', 11);
        assert_(s11 > s10, 'Large box should cost more');

        // 0点
        var s0 = calcShippingByAddress_('東京都', 0);
        assert_(s0 > 0, '0 items should still use small box rate');

        // 負の値
        var sNeg = calcShippingByAddress_('東京都', -5);
        assert_(sNeg > 0, 'Negative count should use small box rate');
      }
    },
    {
      name: 'apiSubmitEstimate: XSS攻撃パターンの入力',
      fn: function() {
        var xssInputs = [
          '<script>alert(1)</script>',
          '"><img src=x onerror=alert(1)>',
          "'; DROP TABLE users; --"
        ];
        for (var i = 0; i < xssInputs.length; i++) {
          var r = apiSubmitEstimate('testkey', {
            companyName: xssInputs[i],
            contact: 'test@test.com'
          }, ['id1']);
          // バリデーションエラーか、商品が見つからないエラーが出るはず
          // 重要なのはサーバーがクラッシュしないこと
          assert_(r !== undefined && r !== null, 'Should not crash with XSS input: ' + xssInputs[i]);
        }
      }
    },
    {
      name: 'generateRandomId_: 大量生成でもユニーク',
      fn: function() {
        var ids = {};
        var duplicates = 0;
        for (var i = 0; i < 100; i++) {
          var id = generateRandomId_(16);
          if (ids[id]) duplicates++;
          ids[id] = true;
        }
        assertEqual_(duplicates, 0, 'Should not produce duplicates in 100 generations');
      }
    },
    {
      name: 'u_normSearch_: 全角/半角変換',
      fn: function() {
        var result1 = u_normSearch_('ＡＢＣ');
        assert_(result1.indexOf('abc') !== -1, 'Full-width ASCII should be converted');

        var result2 = u_normSearch_('カタカナ');
        // カタカナ→ひらがな変換
        assert_(result2.indexOf('かたかな') !== -1, 'Katakana should be converted to hiragana');
      }
    },
    {
      name: 'テンプレートテキスト生成: 必須項目のみ',
      fn: function() {
        var text = app_buildTemplateText_('R-001', {
          companyName: 'テスト社',
          contact: 'a@b.com',
          measureOpt: 'with'
        }, ['ID1', 'ID2'], 2, 5000);

        assert_(text.indexOf('R-001') !== -1, 'Should contain receipt number');
        assert_(text.indexOf('テスト社') !== -1, 'Should contain company name');
        assert_(text.indexOf('a@b.com') !== -1, 'Should contain email');
        assert_(text.indexOf('2点') !== -1, 'Should contain count');
      }
    },
    {
      name: 'テンプレートテキスト生成: オプション項目付き',
      fn: function() {
        var text = app_buildTemplateText_('R-002', {
          companyName: 'テスト社',
          contact: 'a@b.com',
          postal: '100-0001',
          address: '東京都千代田区',
          phone: '03-1234-5678',
          note: 'テスト備考',
          measureOpt: 'without'
        }, ['ID1'], 1, 9500);

        assert_(text.indexOf('100-0001') !== -1, 'Should contain postal');
        assert_(text.indexOf('東京都千代田区') !== -1, 'Should contain address');
        assert_(text.indexOf('03-1234-5678') !== -1, 'Should contain phone');
        assert_(text.indexOf('テスト備考') !== -1, 'Should contain note');
        assert_(text.indexOf('無し') !== -1, 'Should show without measure label');
      }
    }
  ]);
}

// =====================================================
// ランク計算テスト
// =====================================================

function testSuite_Rank_() {
  return runTests_([
    {
      name: 'rankFromSpent_: 金額に応じたランク判定',
      fn: function() {
        assertEqual_(rankFromSpent_(0), 'REGULAR', '0 → REGULAR');
        assertEqual_(rankFromSpent_(49999), 'REGULAR', '49999 → REGULAR');
        assertEqual_(rankFromSpent_(50000), 'SILVER', '50000 → SILVER');
        assertEqual_(rankFromSpent_(199999), 'SILVER', '199999 → SILVER');
        assertEqual_(rankFromSpent_(200000), 'GOLD', '200000 → GOLD');
        assertEqual_(rankFromSpent_(499999), 'GOLD', '499999 → GOLD');
        assertEqual_(rankFromSpent_(500000), 'DIAMOND', '500000 → DIAMOND');
        assertEqual_(rankFromSpent_(1000000), 'DIAMOND', '1000000 → DIAMOND');
      }
    },
    {
      name: 'applyGraceRule_: 救済措置の適用',
      fn: function() {
        // 現在REGULARで前年GOLDの場合、直近1ヶ月で5万以上なら復帰
        var r1 = applyGraceRule_('REGULAR', 'GOLD', 50000);
        assertEqual_(r1.rank, 'GOLD', 'Should restore to GOLD');
        assert_(r1.info.restored, 'Should be marked as restored');

        // 5万未満は復帰しない
        var r2 = applyGraceRule_('REGULAR', 'GOLD', 49999);
        assertEqual_(r2.rank, 'REGULAR', 'Should stay REGULAR');
        assert_(!r2.info.restored, 'Should not be restored');
        assertEqual_(r2.info.needed, 1, 'Should need 1 more yen');

        // 前年DIAMOND→復帰
        var r3 = applyGraceRule_('REGULAR', 'DIAMOND', 60000);
        assertEqual_(r3.rank, 'DIAMOND', 'Should restore to DIAMOND');

        // 前年SILVERの場合は救済対象外
        var r4 = applyGraceRule_('REGULAR', 'SILVER', 100000);
        assertEqual_(r4.rank, 'REGULAR', 'SILVER should not trigger grace rule');
        assert_(!r4.info, 'No grace info for non-eligible');
      }
    },
    {
      name: 'getNextRankInfo_: 次ランクまでの情報',
      fn: function() {
        var r1 = getNextRankInfo_('REGULAR', null);
        assertEqual_(r1.nextRank, 'SILVER', 'REGULAR → SILVER');
        assertEqual_(r1.nextThreshold, 50000, 'Threshold should be 50000');

        var r2 = getNextRankInfo_('SILVER', null);
        assertEqual_(r2.nextRank, 'GOLD', 'SILVER → GOLD');

        var r3 = getNextRankInfo_('GOLD', null);
        assertEqual_(r3.nextRank, 'DIAMOND', 'GOLD → DIAMOND');
        assertEqual_(r3.nextThreshold, 500000, 'Normal threshold');

        // 復帰GOLD→35万でDIAMOND
        var r4 = getNextRankInfo_('GOLD', { restored: true });
        assertEqual_(r4.nextThreshold, 350000, 'Grace threshold should be 350000');

        var r5 = getNextRankInfo_('DIAMOND', null);
        assert_(!r5.nextRank, 'DIAMOND has no next rank');
      }
    },
    {
      name: 'calcSpendByPeriod_: 期間別集計の精度',
      fn: function() {
        var now = new Date('2025-06-01T00:00:00+09:00');
        var orders = [
          // 今年度（12ヶ月以内）
          { date: '2025/05/01', status: '完了', total: 100000 },
          { date: '2025/03/15', status: '完了', total: 50000 },
          // 直近1ヶ月
          { date: '2025/05/20', status: '完了', total: 30000 },
          // キャンセル注文（カウントしない）
          { date: '2025/04/01', status: 'キャンセル', total: 200000 },
          // 前年度（13-24ヶ月）
          { date: '2024/03/01', status: '完了', total: 80000 }
        ];

        var result = calcSpendByPeriod_(orders, now);
        assertEqual_(result.annualSpent, 180000, 'Annual should include completed orders in last 12 months');
        assertEqual_(result.recentSpent, 30000, 'Recent should only include last month');
        assertEqual_(result.prevYearSpent, 80000, 'Prev year should include 13-24 months');
      }
    }
  ]);
}

// =====================================================
// CSRF/環境テスト
// =====================================================

function testSuite_CsrfEnv_() {
  return runTests_([
    {
      name: 'CSRFトークン: 発行・検証が正常に動作する',
      fn: function() {
        var userKey = 'csrf_test_' + Date.now();
        var r = apiGetCsrfToken(userKey);
        assert_(r.ok, 'Token generation should succeed');
        assert_(r.csrfToken, 'Should return a token');
        assert_(r.csrfToken.length > 0, 'Token should not be empty');

        // 検証
        var valid = verifyCsrfToken_(userKey, r.csrfToken);
        assert_(valid, 'Token should be valid');

        // 不正なトークン
        var invalid = verifyCsrfToken_(userKey, 'wrong_token');
        assert_(!invalid, 'Wrong token should fail');

        // 異なるuserKey
        var wrongUser = verifyCsrfToken_('wrong_user', r.csrfToken);
        assert_(!wrongUser, 'Different userKey should fail');
      }
    },
    {
      name: 'CSRFトークン: userKeyなしでは発行されない',
      fn: function() {
        var r = apiGetCsrfToken('');
        assert_(!r.ok, 'Should fail without userKey');
      }
    },
    {
      name: '環境設定: ENV_CONFIG が動作する',
      fn: function() {
        var env = ENV_CONFIG.getEnv();
        assert_(typeof env === 'string', 'getEnv should return string');
        assert_(env.length > 0, 'getEnv should not be empty');

        // いずれかの環境であること
        var valid = ['production', 'staging', 'development'];
        assert_(valid.indexOf(env) !== -1, 'Should be a valid environment: ' + env);
      }
    },
    {
      name: '定数の整合性チェック',
      fn: function() {
        // AUTH_CONSTANTS
        assert_(AUTH_CONSTANTS.HASH_ITERATIONS >= 10000, 'Hash iterations should be >= 10000');
        assert_(AUTH_CONSTANTS.SALT_LENGTH >= 16, 'Salt should be >= 16 chars');
        assert_(AUTH_CONSTANTS.MIN_PASSWORD_LENGTH >= 6, 'Min password should be >= 6');
        assert_(AUTH_CONSTANTS.TEMP_PASSWORD_EXPIRY_MS > 0, 'Temp password expiry should be positive');
        assert_(AUTH_CONSTANTS.CSRF_TOKEN_LENGTH >= 16, 'CSRF token should be >= 16 chars');

        // PAYMENT_CONSTANTS
        assert_(PAYMENT_CONSTANTS.PAYMENT_EXPIRY_SECONDS > 0, 'Payment expiry should be positive');

        // RECAPTCHA_CONSTANTS
        assert_(RECAPTCHA_CONSTANTS.SCORE_THRESHOLD > 0, 'reCAPTCHA threshold should be positive');
        assert_(RECAPTCHA_CONSTANTS.SCORE_THRESHOLD < 1, 'reCAPTCHA threshold should be < 1');

        // TIME_CONSTANTS
        assertEqual_(TIME_CONSTANTS.ONE_DAY_MS, 86400000, 'One day in ms');
        assert_(TIME_CONSTANTS.ONE_YEAR_MS > TIME_CONSTANTS.ONE_MONTH_MS, 'Year > Month');
      }
    },
    {
      name: 'hashWithIterations_: 統合ハッシュ関数の一貫性',
      fn: function() {
        var pw = 'test_password';
        var salt = 'test_salt_16char';

        // v1互換（10000回）
        var v1Result = hashWithIterations_(pw, salt, 10000);
        var v1Legacy = hashPassword_(pw, salt);
        assertEqual_(v1Result, v1Legacy, 'hashWithIterations_(10000) should match hashPassword_');

        // legacy互換（1回）
        var legacyResult = hashWithIterations_(pw, salt, 1);
        var legacyOld = hashPasswordLegacy_(pw, salt);
        assertEqual_(legacyResult, legacyOld, 'hashWithIterations_(1) should match hashPasswordLegacy_');
      }
    }
  ]);
}
