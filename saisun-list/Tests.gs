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
    { name: 'ユーティリティテスト', fn: testSuite_Util_ }
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
        // 沖縄は SHIPPING_AREAS にあるが SHIPPING_RATES に okinawa がないので別途チェック
        assertEqual_(missing.length, 0, 'Missing prefectures: ' + missing.join(', '));
      }
    }
  ]);
}
