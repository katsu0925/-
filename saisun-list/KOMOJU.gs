/**
 * KOMOJU.gs
 *
 * KOMOJU決済連携モジュール
 * クレジットカード（Visa/Mastercard）、コンビニ払い（セブン除く）、銀行振込、LINE Pay に対応
 * ※申請中: JCB/AMEX/Diners/Discover(日本)、PayPay、Paidy
 *
 * 設定方法:
 * 1. https://komoju.com/ でアカウント作成
 * 2. ダッシュボードからAPIキー（Secret Key）を取得
 * 3. スクリプトプロパティに KOMOJU_SECRET_KEY を設定
 * 4. Webhook URLを設定: [デプロイURL]?action=komoju_webhook
 */

// =====================================================
// 設定
// =====================================================

var KOMOJU_CONFIG = {
  // APIエンドポイント（テストキーを使えば本番URLでもテストモードになる）
  apiUrl: 'https://komoju.com/api/v1',

  // 対応決済方法（現在利用可能なもののみ）
  paymentMethods: [
    'credit_card',      // クレジットカード（Visa/Mastercard）※JCB/AMEX/Diners/Discover(日本)は申請中
    'konbini',          // コンビニ払い（セブン-イレブンを除く）
    'bank_transfer',    // 銀行振込
    'linepay'           // LINE Pay
    // 'paypay'         // PayPay — 申請中
    // 'paidy'          // Paidy（あと払い） — 申請中
  ],

  // 通貨
  currency: 'JPY',

  // デフォルトの有効期限（コンビニ払い等）
  expiresInSeconds: 259200  // 3日間
};

// =====================================================
// API: 決済セッション作成
// =====================================================

/**
 * KOMOJU決済セッションを作成
 * @param {string} receiptNo - 受付番号
 * @param {number} amount - 金額
 * @param {object} customerInfo - 顧客情報
 * @returns {object} - { ok, sessionUrl, sessionId, message }
 */
function apiCreateKomojuSession(receiptNo, amount, customerInfo) {
  try {
    var secretKey = getKomojuSecretKey_();
    if (!secretKey) {
      return { ok: false, message: 'KOMOJU APIキーが設定されていません' };
    }

    if (!receiptNo) {
      return { ok: false, message: '受付番号が必要です' };
    }

    if (!amount || amount <= 0) {
      return { ok: false, message: '有効な金額が必要です' };
    }

    var info = customerInfo || {};
    var email = String(info.email || info.contact || '').trim();

    // 決済セッション作成
    var sessionData = {
      amount: Math.round(amount),
      currency: KOMOJU_CONFIG.currency,
      external_order_num: receiptNo,
      return_url: getReturnUrl_() + '?receipt=' + encodeURIComponent(receiptNo) + '&status=complete',
      cancel_url: getReturnUrl_() + '?receipt=' + encodeURIComponent(receiptNo) + '&status=cancel',
      payment_types: KOMOJU_CONFIG.paymentMethods,
      metadata: {
        receipt_no: String(receiptNo),
        company_name: String(info.companyName || ''),
        email: String(email),
        product_amount: String(info.productAmount || 0),
        shipping_amount: String(info.shippingAmount || 0),
        shipping_size: String(info.shippingSize || '')
      }
    };

    // 顧客メールがあれば追加
    if (email) {
      sessionData.customer = { email: email };
    }

    var response = komojuRequest_('POST', '/sessions', sessionData, secretKey);

    if (response.error) {
      console.error('KOMOJU session creation error:', response);
      return { ok: false, message: response.error.message || 'セッション作成に失敗しました' };
    }

    // 決済情報を保存
    savePaymentSession_(receiptNo, {
      sessionId: response.id,
      amount: amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    return {
      ok: true,
      sessionId: response.id,
      sessionUrl: response.session_url,
      expiresAt: response.expires_at
    };

  } catch (e) {
    console.error('apiCreateKomojuSession error:', e);
    return { ok: false, message: e.message || String(e) };
  }
}

/**
 * 決済状態を確認
 * @param {string} receiptNo - 受付番号
 * @returns {object} - { ok, status, paymentDetails }
 */
function apiCheckPaymentStatus(receiptNo) {
  try {
    var secretKey = getKomojuSecretKey_();
    if (!secretKey) {
      return { ok: false, message: 'KOMOJU APIキーが設定されていません' };
    }

    var saved = getPaymentSession_(receiptNo);
    if (!saved || !saved.sessionId) {
      return { ok: false, message: '決済セッションが見つかりません' };
    }

    var response = komojuRequest_('GET', '/sessions/' + saved.sessionId, null, secretKey);

    if (response.error) {
      return { ok: false, message: response.error.message || 'ステータス取得に失敗しました' };
    }

    var status = mapKomojuStatus_(response.status);

    // ステータスを更新
    saved.status = status;
    saved.komojuStatus = response.status;
    saved.updatedAt = new Date().toISOString();
    if (response.payment) {
      saved.paymentId = response.payment.id;
      saved.paymentMethod = response.payment.payment_method_type;
    }
    savePaymentSession_(receiptNo, saved);

    // Webhookが未処理の場合のフォールバック:
    // 決済が完了(captured/authorized)しているのにペンディング注文が残っている場合、
    // ここで注文確定処理を実行する
    if ((status === 'paid' || status === 'authorized') && response.payment) {
      var props = PropertiesService.getScriptProperties();
      var pendingKey = 'PENDING_ORDER_' + receiptNo;
      if (props.getProperty(pendingKey)) {
        console.log('Webhookが未処理のため、ステータスチェック経由で注文を確定: ' + receiptNo);
        var paymentMethodType = response.payment.payment_method_type || '';
        var paymentStatus = '対応済';
        if (paymentMethodType === 'konbini' || paymentMethodType === 'bank_transfer') {
          paymentStatus = '入金待ち';
        }
        var confirmResult = confirmPaymentAndCreateOrder(
          receiptNo,
          paymentStatus,
          paymentMethodType,
          response.payment.id || ''
        );
        if (confirmResult && confirmResult.ok) {
          console.log('フォールバック注文確定成功: ' + receiptNo);
        } else {
          console.error('フォールバック注文確定失敗:', confirmResult);
        }
      }
    }

    return {
      ok: true,
      status: status,
      komojuStatus: response.status,
      paymentMethod: response.payment ? response.payment.payment_method_type : null,
      paidAt: response.payment ? response.payment.created_at : null
    };

  } catch (e) {
    console.error('apiCheckPaymentStatus error:', e);
    return { ok: false, message: e.message || String(e) };
  }
}

// =====================================================
// Webhook処理
// =====================================================

/**
 * KOMOJUからのWebhookを処理
 * @param {object} e - イベントオブジェクト
 * @returns {object} - レスポンス
 */
function handleKomojuWebhook(e) {
  try {
    var body = e.postData ? e.postData.contents : null;
    if (!body) {
      return { ok: false, message: 'No body' };
    }

    // Webhook署名検証
    if (!verifyKomojuWebhookSignature_(e, body)) {
      console.error('KOMOJU Webhook signature verification failed');
      return { ok: false, message: 'Invalid signature' };
    }

    var data = JSON.parse(body);
    console.log('KOMOJU Webhook received:', data.type);

    // イベントタイプに応じて処理
    switch (data.type) {
      case 'payment.captured':
      case 'payment.authorized':
        return handlePaymentSuccess_(data);

      case 'payment.failed':
      case 'payment.expired':
        return handlePaymentFailed_(data);

      case 'payment.refunded':
        return handlePaymentRefunded_(data);

      default:
        console.log('Unhandled webhook type:', data.type);
        return { ok: true, message: 'Event ignored' };
    }

  } catch (e) {
    console.error('handleKomojuWebhook error:', e);
    return { ok: false, message: e.message || String(e) };
  }
}

/**
 * 決済成功時の処理
 */
function handlePaymentSuccess_(data) {
  var payment = data.data;
  var receiptNo = payment.external_order_num ||
                  (payment.metadata ? payment.metadata.receipt_no : null);

  if (!receiptNo) {
    console.error('Receipt number not found in webhook data');
    return { ok: false, message: 'Receipt number not found' };
  }

  // 決済情報を更新
  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'paid';
  saved.komojuStatus = payment.status;
  saved.paymentId = payment.id;
  saved.paymentMethod = payment.payment_method_type;
  saved.paidAt = new Date().toISOString();
  saved.amount = payment.amount;
  savePaymentSession_(receiptNo, saved);

  // 決済方法に応じた入金ステータスを決定
  // クレジットカード、LINE Pay は即時決済なので「対応済」
  // コンビニ払い、銀行振込は後払いなので「入金待ち」
  // ※PayPay, Paidy は申請中（承認後に追加）
  var paymentStatus = '対応済';
  if (payment.payment_method_type === 'konbini' || payment.payment_method_type === 'bank_transfer') {
    paymentStatus = '入金待ち';
  }

  // 注文を確定（シート書き込み・注文確認メール送信）
  var confirmResult = confirmPaymentAndCreateOrder(
    receiptNo,
    paymentStatus,
    payment.payment_method_type || '',
    payment.id || ''
  );
  if (!confirmResult.ok) {
    console.error('Failed to confirm order:', confirmResult.message);
    // 既にシートに書き込まれている可能性があるため、ステータスのみ更新を試みる
    updateOrderPaymentStatus_(receiptNo, 'paid', payment.payment_method_type);
  }

  console.log('Payment success processed for:', receiptNo);
  return { ok: true, message: 'Payment processed' };
}

/**
 * 決済失敗時の処理
 */
function handlePaymentFailed_(data) {
  var payment = data.data;
  var receiptNo = payment.external_order_num ||
                  (payment.metadata ? payment.metadata.receipt_no : null);

  if (!receiptNo) {
    return { ok: false, message: 'Receipt number not found' };
  }

  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'failed';
  saved.komojuStatus = payment.status;
  saved.failedAt = new Date().toISOString();
  saved.failReason = payment.payment_details ? payment.payment_details.failure_reason : null;
  savePaymentSession_(receiptNo, saved);

  // 決済失敗 → 注文をキャンセルして商品を解放
  var cancelResult = apiCancelOrder(receiptNo);
  if (cancelResult && cancelResult.ok) {
    console.log('Order cancelled due to payment failure:', receiptNo);
  } else {
    console.error('Failed to cancel order after payment failure:', receiptNo);
  }

  console.log('Payment failed for:', receiptNo);
  return { ok: true, message: 'Payment failure processed' };
}

/**
 * 返金時の処理
 */
function handlePaymentRefunded_(data) {
  var payment = data.data;
  var receiptNo = payment.external_order_num ||
                  (payment.metadata ? payment.metadata.receipt_no : null);

  if (!receiptNo) {
    return { ok: false, message: 'Receipt number not found' };
  }

  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'refunded';
  saved.komojuStatus = payment.status;
  saved.refundedAt = new Date().toISOString();
  savePaymentSession_(receiptNo, saved);

  // 依頼管理シートのステータスを更新
  updateOrderPaymentStatus_(receiptNo, 'refunded', null);

  console.log('Payment refunded for:', receiptNo);
  return { ok: true, message: 'Refund processed' };
}

// =====================================================
// Webhook署名検証
// =====================================================

/**
 * KOMOJUのWebhook署名を検証
 * KOMOJU_WEBHOOK_SECRET スクリプトプロパティにWebhookシークレットを設定してください
 *
 * 注意: GAS の doPost() では HTTP リクエストヘッダーを直接取得できないため、
 * ヘッダーベースの署名検証は動作しない。代替として以下の方式で検証する:
 * 1. URL に含まれる webhook トークン（?webhook_token=xxx）で認証
 * 2. トークンも未設定の場合、受信データの receipt_no が既知の注文かを検証
 *
 * @param {object} e - イベントオブジェクト
 * @param {string} body - リクエストボディ
 * @returns {boolean} - 署名が有効な場合true
 */
function verifyKomojuWebhookSignature_(e, body) {
  // 方式1: URLトークン認証（推奨）
  // Webhook URL を ?action=komoju_webhook&webhook_token=YOUR_SECRET に設定
  var webhookSecret = getKomojuWebhookSecret_();
  if (webhookSecret && e && e.parameter) {
    var urlToken = String(e.parameter.webhook_token || '');
    if (urlToken && timingSafeEqual_(urlToken, webhookSecret)) {
      console.log('Webhook認証成功（URLトークン方式）');
      return true;
    }
  }

  // 方式2: ヘッダー署名検証（GASでは通常取得不可だが、念のため試行）
  if (webhookSecret) {
    var signature = '';
    if (e && e.postData && e.postData.headers) {
      signature = String(e.postData.headers['X-Komoju-Signature'] || e.postData.headers['x-komoju-signature'] || '');
    }
    if (signature) {
      var expectedRaw = Utilities.computeHmacSha256Signature(body, webhookSecret);
      var expected = expectedRaw.map(function(b) {
        return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
      }).join('');
      if (timingSafeEqual_(signature, expected)) {
        console.log('Webhook認証成功（HMAC署名方式）');
        return true;
      }
    }
  }

  // 方式3: 受信データの受付番号がペンディング注文に存在するか検証
  // （webhookSecret未設定、またはヘッダー取得不可の場合のフォールバック）
  try {
    var data = JSON.parse(body);
    var payment = data.data;
    if (payment) {
      var receiptNo = payment.external_order_num ||
                      (payment.metadata ? payment.metadata.receipt_no : null);
      if (receiptNo) {
        var props = PropertiesService.getScriptProperties();
        var pendingKey = 'PENDING_ORDER_' + receiptNo;
        var paymentKey = 'PAYMENT_' + receiptNo;
        if (props.getProperty(pendingKey) || props.getProperty(paymentKey)) {
          console.log('Webhook認証成功（受付番号照合方式）: ' + receiptNo);
          return true;
        }
      }
    }
  } catch (parseErr) {
    console.error('Webhook body parse error:', parseErr);
  }

  console.warn('Webhook認証失敗: 全ての検証方式で不合格');
  return false;
}

/**
 * Webhook シークレットキーを取得
 */
function getKomojuWebhookSecret_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('KOMOJU_WEBHOOK_SECRET') || '';
  } catch (e) {
    return '';
  }
}

/**
 * タイミングセーフな文字列比較（タイミング攻撃対策）
 */
function timingSafeEqual_(a, b) {
  var strA = String(a || '');
  var strB = String(b || '');
  if (strA.length !== strB.length) return false;
  var result = 0;
  for (var i = 0; i < strA.length; i++) {
    result |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return result === 0;
}

// =====================================================
// ヘルパー関数
// =====================================================

/**
 * KOMOJU APIリクエスト
 */
function komojuRequest_(method, endpoint, data, secretKey) {
  var url = KOMOJU_CONFIG.apiUrl + endpoint;

  var options = {
    method: method,
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(secretKey + ':'),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.payload = JSON.stringify(data);
  }

  var response = UrlFetchApp.fetch(url, options);
  var responseText = response.getContentText();

  try {
    return JSON.parse(responseText);
  } catch (e) {
    console.error('Failed to parse KOMOJU response:', responseText);
    return { error: { message: 'Invalid response from KOMOJU' } };
  }
}

/**
 * KOMOJUステータスをアプリ内ステータスにマッピング
 */
function mapKomojuStatus_(komojuStatus) {
  var statusMap = {
    'pending': 'pending',
    'authorized': 'authorized',
    'captured': 'paid',
    'refunded': 'refunded',
    'cancelled': 'cancelled',
    'expired': 'expired',
    'failed': 'failed'
  };
  return statusMap[komojuStatus] || komojuStatus;
}

/**
 * Secret Keyを取得（モードに応じてテスト/本番キーを返す）
 * 優先順位:
 *   1. KOMOJU_MODE が 'test' → KOMOJU_SECRET_KEY_TEST
 *   2. KOMOJU_MODE が 'live' → KOMOJU_SECRET_KEY_LIVE
 *   3. フォールバック → 従来の KOMOJU_SECRET_KEY（移行前互換）
 */
function getKomojuSecretKey_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var mode = String(props.getProperty('KOMOJU_MODE') || 'test').trim();
    var key;
    if (mode === 'live') {
      key = props.getProperty('KOMOJU_SECRET_KEY_LIVE');
    } else {
      key = props.getProperty('KOMOJU_SECRET_KEY_TEST');
    }
    // フォールバック: 新プロパティ未設定なら従来キーを使用
    if (!key) {
      key = props.getProperty('KOMOJU_SECRET_KEY');
    }
    return key || null;
  } catch (e) {
    return null;
  }
}

/**
 * 現在のKOMOJU決済モードを取得
 * @returns {object} { mode: 'test'|'live', hasTestKey, hasLiveKey, hasLegacyKey }
 */
function getKomojuMode_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var mode = String(props.getProperty('KOMOJU_MODE') || 'test').trim();
    if (mode !== 'live') mode = 'test';
    return {
      mode: mode,
      hasTestKey: !!props.getProperty('KOMOJU_SECRET_KEY_TEST'),
      hasLiveKey: !!props.getProperty('KOMOJU_SECRET_KEY_LIVE'),
      hasLegacyKey: !!props.getProperty('KOMOJU_SECRET_KEY')
    };
  } catch (e) {
    return { mode: 'test', hasTestKey: false, hasLiveKey: false, hasLegacyKey: false };
  }
}

/**
 * リターンURLを取得（フロントエンドURL優先）
 * FRONTEND_URL が設定されていればそちらを使用（Cloudflare Pages対応）
 * 未設定の場合は SITE_CONSTANTS.SITE_URL → GAS URLの順にフォールバック
 */
function getReturnUrl_() {
  try {
    var frontendUrl = PropertiesService.getScriptProperties().getProperty('FRONTEND_URL');
    if (frontendUrl) return frontendUrl.replace(/\/+$/, '');
  } catch (e) {}
  if (typeof SITE_CONSTANTS !== 'undefined' && SITE_CONSTANTS && SITE_CONSTANTS.SITE_URL) {
    return String(SITE_CONSTANTS.SITE_URL).replace(/\/+$/, '');
  }
  return ScriptApp.getService().getUrl();
}

/**
 * 決済セッション情報を保存
 */
function savePaymentSession_(receiptNo, data) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'PAYMENT_' + receiptNo;
    props.setProperty(key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save payment session:', e);
  }
}

/**
 * 決済セッション情報を取得
 */
function getPaymentSession_(receiptNo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'PAYMENT_' + receiptNo;
    var data = props.getProperty(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Failed to get payment session:', e);
    return null;
  }
}

/**
 * 依頼管理シートの決済ステータスを更新
 * 列構成: R列(18)=入金確認
 */
function updateOrderPaymentStatus_(receiptNo, paymentStatus, paymentMethod) {
  try {
    var orderSs = sh_getOrderSs_();
    var sheet = orderSs.getSheetByName('依頼管理');
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    // 受付番号で行を検索（A列）
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(receiptNo)) {
        var row = i + 2;

        // R列(18): 入金確認ステータスを更新
        var paymentConfirmCol = 18;  // R列
        var statusText = paymentStatus === 'paid' ? '対応済' : (paymentStatus === 'pending' ? '入金待ち' : '未対応');
        sheet.getRange(row, paymentConfirmCol).setValue(statusText);

        console.log('Updated payment status for row ' + row + ': ' + statusText);
        break;
      }
    }
  } catch (e) {
    console.error('updateOrderPaymentStatus_ error:', e);
  }
}

// =====================================================
// 設定用関数（GASエディタから実行）
// =====================================================

/**
 * KOMOJU APIキーを設定（テスト用 / 本番用を個別に保存）
 * 使い方:
 * 1. mode と secretKey を書き換え
 * 2. GASエディタでこの関数を実行
 * 3. 実行後、キーを YOUR_SECRET_KEY_HERE に戻す（セキュリティのため）
 */
function setKomojuSecretKey() {
  var mode = 'test';  // ← 'test' または 'live' を指定
  var secretKey = 'YOUR_SECRET_KEY_HERE';  // ← ここにKOMOJUのSecret Keyを入力

  if (secretKey === 'YOUR_SECRET_KEY_HERE') {
    console.log('ERROR: secretKey を実際のKOMOJU Secret Keyに置き換えてください');
    return;
  }

  var propName = (mode === 'live') ? 'KOMOJU_SECRET_KEY_LIVE' : 'KOMOJU_SECRET_KEY_TEST';
  PropertiesService.getScriptProperties().setProperty(propName, secretKey);
  console.log('SUCCESS: ' + propName + ' を設定しました');
  console.log('セキュリティのため、コード内のキーを YOUR_SECRET_KEY_HERE に戻すことをお勧めします');
}

/**
 * KOMOJU Webhookシークレットを設定
 * 使い方:
 * 1. webhookSecret を書き換え
 * 2. GASエディタでこの関数を実行
 * 3. 実行後、シークレットを YOUR_WEBHOOK_SECRET_HERE に戻す（セキュリティのため）
 * 4. Webhook URLを [デプロイURL]?action=komoju_webhook&webhook_token=設定した値 にする
 */
function setKomojuWebhookSecret() {
  var webhookSecret = 'YOUR_WEBHOOK_SECRET_HERE';  // ← ここにWebhookシークレットを入力

  if (webhookSecret === 'YOUR_WEBHOOK_SECRET_HERE') {
    console.log('ERROR: webhookSecret を実際のシークレットに置き換えてください');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('KOMOJU_WEBHOOK_SECRET', webhookSecret);
  console.log('SUCCESS: KOMOJU_WEBHOOK_SECRET を設定しました');
  console.log('Webhook URLに ?webhook_token=' + webhookSecret + ' を追加してください');
  console.log('セキュリティのため、コード内のシークレットを YOUR_WEBHOOK_SECRET_HERE に戻すことをお勧めします');
}

/**
 * KOMOJU APIキーが設定されているか確認
 */
function checkKomojuSecretKey() {
  var props = PropertiesService.getScriptProperties();
  var info = getKomojuMode_();
  console.log('現在のモード: ' + info.mode);
  console.log('テストキー: ' + (info.hasTestKey ? '設定済み' : '未設定'));
  console.log('本番キー: ' + (info.hasLiveKey ? '設定済み' : '未設定'));
  console.log('旧キー（KOMOJU_SECRET_KEY）: ' + (info.hasLegacyKey ? '設定済み' : '未設定'));

  var activeKey = getKomojuSecretKey_();
  if (activeKey) {
    console.log('使用中のキー: ' + activeKey.substring(0, 8) + '...');
  } else {
    console.log('使用中のキー: なし（未設定）');
  }
}

/**
 * KOMOJU APIキーを削除
 */
function deleteKomojuSecretKey() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('KOMOJU_SECRET_KEY');
  props.deleteProperty('KOMOJU_SECRET_KEY_TEST');
  props.deleteProperty('KOMOJU_SECRET_KEY_LIVE');
  console.log('KOMOJU関連のキーを全て削除しました');
}

/**
 * 決済モードを切り替え（管理画面から呼び出し）
 * @returns {object} { ok, mode, message }
 */
function adminToggleKomojuMode() {
  var props = PropertiesService.getScriptProperties();
  var current = String(props.getProperty('KOMOJU_MODE') || 'test').trim();
  var newMode = (current === 'live') ? 'test' : 'live';

  // 切替先のキーが設定されているか確認
  var targetKeyProp = (newMode === 'live') ? 'KOMOJU_SECRET_KEY_LIVE' : 'KOMOJU_SECRET_KEY_TEST';
  var targetKey = props.getProperty(targetKeyProp);
  if (!targetKey) {
    // フォールバックキーもチェック
    var legacyKey = props.getProperty('KOMOJU_SECRET_KEY');
    if (!legacyKey) {
      return {
        ok: false,
        mode: current,
        message: (newMode === 'live' ? '本番' : 'テスト') + '用のAPIキーが設定されていません。先にキーを設定してください。'
      };
    }
  }

  props.setProperty('KOMOJU_MODE', newMode);
  return {
    ok: true,
    mode: newMode,
    message: '決済モードを「' + (newMode === 'live' ? '本番' : 'テスト') + '」に切り替えました'
  };
}

/**
 * 現在の決済モード情報を取得（管理画面用）
 * @returns {object} { ok, mode, hasTestKey, hasLiveKey }
 */
function adminGetKomojuMode() {
  var info = getKomojuMode_();
  return { ok: true, mode: info.mode, hasTestKey: info.hasTestKey, hasLiveKey: info.hasLiveKey };
}

// =====================================================
// テスト・デバッグ用
// =====================================================

/**
 * KOMOJU接続テスト
 * テスト用の決済セッションを作成して接続を確認
 */
function testKomojuConnection() {
  var secretKey = getKomojuSecretKey_();
  if (!secretKey) {
    console.log('ERROR: KOMOJU_SECRET_KEY が設定されていません');
    console.log('スクリプトプロパティに KOMOJU_SECRET_KEY を設定してください');
    return;
  }

  console.log('KOMOJU接続テスト開始...');
  console.log('Secret Key: ' + secretKey.substring(0, 8) + '...');

  // テスト用セッションを作成
  var sessionData = {
    amount: 100,
    currency: 'JPY',
    return_url: 'https://example.com/return',
    cancel_url: 'https://example.com/cancel',
    payment_types: ['credit_card']
  };

  var response = komojuRequest_('POST', '/sessions', sessionData, secretKey);

  if (response.error) {
    console.log('ERROR: KOMOJU接続失敗');
    console.log('エラーコード: ' + response.error.code);
    console.log('エラーメッセージ: ' + response.error.message);

    if (response.error.code === 'invalid_token' || response.error.code === 'authentication_required') {
      console.log('→ APIキーが正しくありません。KOMOJUダッシュボードでSecret Keyを確認してください。');
    } else if (response.error.code === 'forbidden') {
      console.log('→ このAPIキーには必要な権限がありません。');
    }
  } else if (response.id) {
    console.log('SUCCESS: KOMOJU接続成功！');
    console.log('テストセッションID: ' + response.id);
    console.log('決済URL: ' + response.session_url);
    console.log('');
    console.log('※このテストセッションは自動的に期限切れになります');
  } else {
    console.log('WARNING: 予期しないレスポンス');
    console.log(JSON.stringify(response));
  }
}

/**
 * テスト決済セッション作成
 */
function testCreateSession() {
  var result = apiCreateKomojuSession('TEST-' + Date.now(), 1000, {
    email: 'test@example.com',
    companyName: 'テスト会社'
  });

  console.log('Result:', result);
  if (result.ok) {
    console.log('決済URL:', result.sessionUrl);
  }
}
