/**
 * KOMOJU.gs
 *
 * KOMOJU決済連携モジュール
 * クレジットカード（Visa/Mastercard）、コンビニ払い（セブン除く）、銀行振込に対応
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
    'bank_transfer'     // 銀行振込
    // 'linepay'        // LINE Pay — サービス終了のため削除
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
        var paymentStatus = '未対応';
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
      console.error('KOMOJU Webhook: No body received. postData=' + JSON.stringify(e.postData || null) +
                     ', parameter=' + JSON.stringify(e.parameter || null));
      return { ok: false, message: 'No body' };
    }

    console.log('KOMOJU Webhook: body received, length=' + body.length +
                ', parameter=' + JSON.stringify(e.parameter || null));

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
 * Webhookの通知を受けた後、KOMOJU APIで決済状態と金額を検証してから処理を実行する。
 */
function handlePaymentSuccess_(data) {
  var webhookPayment = data.data;
  var receiptNo = webhookPayment.external_order_num ||
                  (webhookPayment.metadata ? webhookPayment.metadata.receipt_no : null);

  if (!receiptNo) {
    console.error('Receipt number not found in webhook data');
    return { ok: false, message: 'Receipt number not found' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  if (!apiPayment) {
    console.error('KOMOJU API verification failed for: ' + receiptNo + ' (paymentId=' + webhookPayment.id + ')');
    return { ok: false, message: 'API verification failed' };
  }

  // APIから取得したステータスが本当に成功しているか確認
  var apiStatus = mapKomojuStatus_(apiPayment.status);
  if (apiStatus !== 'paid' && apiStatus !== 'authorized') {
    console.error('API検証: 決済ステータスが成功ではない: status=' + apiPayment.status + ', receiptNo=' + receiptNo);
    return { ok: false, message: 'Payment not confirmed by API (status=' + apiPayment.status + ')' };
  }

  // 金額の照合
  if (!verifyPaymentAmount_(receiptNo, apiPayment.amount)) {
    console.error('API検証: 金額不一致のため処理を中止: receiptNo=' + receiptNo);
    return { ok: false, message: 'Amount mismatch' };
  }

  // === 検証済みのAPIデータで決済情報を更新 ===
  var payment = apiPayment;  // 以降はAPI検証済みデータを使用
  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'paid';
  saved.komojuStatus = payment.status;
  saved.paymentId = payment.id;
  saved.paymentMethod = payment.payment_method_type;
  saved.paidAt = new Date().toISOString();
  saved.amount = payment.amount;
  saved.verifiedViaApi = true;
  savePaymentSession_(receiptNo, saved);

  // 決済方法に応じた入金ステータスを決定
  // クレジットカードは即時決済完了なので「未対応」（入金済み・処理待ち）
  // コンビニ払い、銀行振込は後払いなので「入金待ち」
  // ※PayPay, Paidy は申請中（承認後に追加）
  var paymentStatus = '未対応';
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

  console.log('Payment success processed (API verified) for:', receiptNo);
  return { ok: true, message: 'Payment processed' };
}

/**
 * 決済失敗時の処理
 * Webhookの通知を受けた後、KOMOJU APIで決済状態を検証してから処理を実行する。
 */
function handlePaymentFailed_(data) {
  var webhookPayment = data.data;
  var receiptNo = webhookPayment.external_order_num ||
                  (webhookPayment.metadata ? webhookPayment.metadata.receipt_no : null);

  if (!receiptNo) {
    return { ok: false, message: 'Receipt number not found' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  var payment = apiPayment || webhookPayment;  // API取得失敗時はWebhookデータで続行（キャンセルは安全側）

  if (apiPayment) {
    var apiStatus = mapKomojuStatus_(apiPayment.status);
    if (apiStatus === 'paid' || apiStatus === 'authorized') {
      // APIでは決済成功しているのに失敗Webhookが来た → 偽のWebhookの可能性
      console.error('API検証: Webhookは失敗だがAPIでは決済成功 → 処理を中止: receiptNo=' + receiptNo);
      return { ok: false, message: 'API shows payment succeeded, ignoring failure webhook' };
    }
    console.log('決済失敗をAPI検証で確認: receiptNo=' + receiptNo + ', status=' + apiPayment.status);
  } else {
    console.warn('API検証失敗、Webhookデータで処理を続行（安全側）: receiptNo=' + receiptNo);
  }

  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'failed';
  saved.komojuStatus = payment.status;
  saved.failedAt = new Date().toISOString();
  saved.failReason = payment.payment_details ? payment.payment_details.failure_reason : null;
  saved.verifiedViaApi = !!apiPayment;
  savePaymentSession_(receiptNo, saved);

  // 決済失敗 → 注文をキャンセルして商品を解放
  var cancelResult = apiCancelOrder(receiptNo);
  if (cancelResult && cancelResult.ok) {
    console.log('Order cancelled due to payment failure:', receiptNo);
  } else {
    console.error('Failed to cancel order after payment failure:', receiptNo);
  }

  console.log('Payment failed (API verified) for:', receiptNo);
  return { ok: true, message: 'Payment failure processed' };
}

/**
 * 返金時の処理
 * Webhookの通知を受けた後、KOMOJU APIで決済状態を検証してから処理を実行する。
 */
function handlePaymentRefunded_(data) {
  var webhookPayment = data.data;
  var receiptNo = webhookPayment.external_order_num ||
                  (webhookPayment.metadata ? webhookPayment.metadata.receipt_no : null);

  if (!receiptNo) {
    return { ok: false, message: 'Receipt number not found' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  if (!apiPayment) {
    console.error('KOMOJU API verification failed for refund: ' + receiptNo + ' (paymentId=' + webhookPayment.id + ')');
    return { ok: false, message: 'API verification failed for refund' };
  }

  // APIから取得したステータスが本当に返金されているか確認
  var apiStatus = mapKomojuStatus_(apiPayment.status);
  if (apiStatus !== 'refunded') {
    console.error('API検証: 返金ステータスではない: status=' + apiPayment.status + ', receiptNo=' + receiptNo);
    return { ok: false, message: 'Refund not confirmed by API (status=' + apiPayment.status + ')' };
  }

  var payment = apiPayment;
  var saved = getPaymentSession_(receiptNo) || {};
  saved.status = 'refunded';
  saved.komojuStatus = payment.status;
  saved.refundedAt = new Date().toISOString();
  saved.verifiedViaApi = true;
  savePaymentSession_(receiptNo, saved);

  // 依頼管理シートのステータスを更新
  updateOrderPaymentStatus_(receiptNo, 'refunded', null);

  console.log('Payment refunded (API verified) for:', receiptNo);
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
// KOMOJU API による決済検証
// =====================================================

/**
 * KOMOJU APIで決済情報を取得し、Webhookデータの正当性を検証する。
 * Webhookの通知内容を鵜呑みにせず、API経由で実際の決済状態を確認する。
 *
 * @param {string} paymentId - KOMOJUの決済ID (webhook data.id)
 * @returns {object|null} - 検証済みの決済情報。取得失敗時はnull
 */
function fetchPaymentFromApi_(paymentId) {
  if (!paymentId) return null;

  var secretKey = getKomojuSecretKey_();
  if (!secretKey) {
    console.error('fetchPaymentFromApi_: APIキー未設定');
    return null;
  }

  var response = komojuRequest_('GET', '/payments/' + paymentId, null, secretKey);
  if (response.error) {
    console.error('fetchPaymentFromApi_: KOMOJU API error:', response.error.message || JSON.stringify(response.error));
    return null;
  }

  if (!response.id) {
    console.error('fetchPaymentFromApi_: 不正なレスポンス');
    return null;
  }

  return response;
}

/**
 * Webhookの金額とペンディング注文の期待金額を照合する。
 * 金額の不一致は改ざんの可能性があるため、不一致時はfalseを返す。
 *
 * @param {string} receiptNo - 受付番号
 * @param {number} apiAmount - KOMOJU APIから取得した実際の決済金額
 * @returns {boolean} - 金額が一致すればtrue
 */
function verifyPaymentAmount_(receiptNo, apiAmount) {
  // PAYMENT_ セッションの金額と照合
  var saved = getPaymentSession_(receiptNo);
  if (saved && saved.amount) {
    if (Math.round(Number(saved.amount)) !== Math.round(Number(apiAmount))) {
      console.error('金額不一致（PAYMENT_セッション）: 期待=' + saved.amount + ', 実際=' + apiAmount + ', 受付番号=' + receiptNo);
      return false;
    }
  }

  // PENDING_ORDER_ の金額とも照合
  try {
    var props = PropertiesService.getScriptProperties();
    var pendingStr = props.getProperty('PENDING_ORDER_' + receiptNo);
    if (pendingStr) {
      var pending = JSON.parse(pendingStr);
      if (pending.discounted) {
        if (Math.round(Number(pending.discounted)) !== Math.round(Number(apiAmount))) {
          console.error('金額不一致（PENDING_ORDER）: 期待=' + pending.discounted + ', 実際=' + apiAmount + ', 受付番号=' + receiptNo);
          return false;
        }
      }
    }
  } catch (e) {
    console.warn('verifyPaymentAmount_: ペンディング注文の金額照合スキップ:', e);
  }

  return true;
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
 * KOMOJU決済方法を日本語表示名に変換
 * @param {string} methodType - KOMOJUの決済方法タイプ（例: 'credit_card'）
 * @returns {string} - 日本語表示名（例: 'クレジットカード'）
 */
function getPaymentMethodDisplayName_(methodType) {
  var map = {
    'credit_card': 'クレジットカード',
    'konbini': 'コンビニ払い',
    'bank_transfer': '銀行振込'
  };
  return map[String(methodType || '')] || String(methodType || '');
}

/**
 * KOMOJUステータスをアプリ内ステータスにマッピング
 */
function mapKomojuStatus_(komojuStatus) {
  var statusMap = {
    'pending': 'pending',
    'authorized': 'authorized',
    'captured': 'paid',
    'completed': 'paid',
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
  // DEPLOY_URL が設定されていればそれを使用
  try {
    var deployUrl = PropertiesService.getScriptProperties().getProperty('DEPLOY_URL');
    if (deployUrl) return deployUrl.replace(/\/+$/, '');
  } catch (e) {}
  // 最終フォールバック: ScriptApp.getService().getUrl()
  // ※ エディタ実行時はデプロイIDが異なるため正しくない場合がある
  var gasUrl = ScriptApp.getService().getUrl();
  if (gasUrl && gasUrl.indexOf('/dev') === gasUrl.length - 4) {
    gasUrl = gasUrl.slice(0, -4) + '/exec';
  }
  return gasUrl;
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
 * 列構成: R列(18)=入金確認, AA列(27)=通知フラグ, AE列(31)=決済方法
 *
 * 後日入金（銀行振込・コンビニ払い）が確認された場合:
 * - R列を「入金待ち」→「未対応」に更新
 * - AA列にFALSEをセット（入金完了時のみ）
 * - AE列に決済方法の日本語表示名をセット
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
        var statusText = paymentStatus === 'paid' ? '未対応' : (paymentStatus === 'pending' ? '入金待ち' : '未対応');
        sheet.getRange(row, paymentConfirmCol).setValue(statusText);

        // AE列(31): 決済方法（日本語表示名）
        if (paymentMethod) {
          var paymentMethodCol = 31;  // AE列
          sheet.getRange(row, paymentMethodCol).setValue(getPaymentMethodDisplayName_(paymentMethod));
        }

        // AA列(27): 通知フラグ — 入金完了時（未対応に変更時）にFALSEをセット
        if (statusText === '未対応') {
          var notifyFlagCol = 27;  // AA列
          sheet.getRange(row, notifyFlagCol).setValue(false);
        }

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
 * KOMOJU Webhookシークレットを自動生成して設定
 *
 * GASエディタでこの関数を実行すると:
 * 1. ランダムなシークレットキーを自動生成
 * 2. スクリプトプロパティ KOMOJU_WEBHOOK_SECRET に保存
 * 3. KOMOJUダッシュボードに設定すべき値をログに出力
 *
 * ログに表示される「シークレットキー」と「Webhook URL」を
 * KOMOJUダッシュボードのWebhook設定にコピーしてください。
 */
function setKomojuWebhookSecret() {
  // ランダムなシークレットキーを生成（32バイト = 64文字の16進数）
  var rawBytes = [];
  for (var i = 0; i < 32; i++) {
    rawBytes.push(Math.floor(Math.random() * 256));
  }
  var webhookSecret = rawBytes.map(function(b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');

  PropertiesService.getScriptProperties().setProperty('KOMOJU_WEBHOOK_SECRET', webhookSecret);

  // デプロイURLを取得（DEPLOY_URL スクリプトプロパティを最優先）
  var props = PropertiesService.getScriptProperties();
  var deployUrl = props.getProperty('DEPLOY_URL');

  if (deployUrl) {
    deployUrl = deployUrl.replace(/\/+$/, '');
  } else {
    // DEPLOY_URL 未設定の場合はエラーを表示して中断
    // ScriptApp.getService().getUrl() はエディタ実行時に /dev のURLを返し、
    // さらにデプロイIDも本番と異なるため信頼できない
    console.log('=== エラー: DEPLOY_URL が未設定です ===');
    console.log('');
    console.log('Webhookが正しく動作するには、本番デプロイURLの設定が必要です。');
    console.log('');
    console.log('【手順】');
    console.log('1. GASエディタで「デプロイ」→「デプロイを管理」を開く');
    console.log('2. ウェブアプリのURLをコピー（/exec で終わるURL）');
    console.log('3. 以下のいずれかの方法で設定:');
    console.log('   a) setDeployUrl() 関数を実行（実行時にプロンプトが表示されます）');
    console.log('   b) スクリプトプロパティに DEPLOY_URL を手動追加');
    console.log('4. 設定後、この setKomojuWebhookSecret() を再実行');
    console.log('');
    console.log('=== Webhook設定を中断しました ===');
    return;
  }

  console.log('=== KOMOJU Webhook 設定情報 ===');
  console.log('');
  console.log('【1】KOMOJUダッシュボードの「シークレットキー」欄に以下を貼り付け:');
  console.log(webhookSecret);
  console.log('');
  console.log('【2】KOMOJUダッシュボードの「Webhook URL」欄に以下を設定:');
  console.log(deployUrl + '?action=komoju_webhook&webhook_token=' + webhookSecret);
  console.log('');
  console.log('使用中のデプロイURL: ' + deployUrl);
  console.log('');
  console.log('=== 設定完了 ===');
}

/**
 * 本番デプロイURLをスクリプトプロパティに保存するヘルパー関数
 * 使い方:
 * 1. deployUrl を実際のデプロイURLに書き換え
 * 2. GASエディタでこの関数を実行
 * 3. 実行後、URLを 'YOUR_DEPLOY_URL_HERE' に戻す（セキュリティのため）
 */
function setDeployUrl() {
  var deployUrl = 'YOUR_DEPLOY_URL_HERE';  // ← ここにデプロイURLを入力（/exec で終わるURL）

  if (deployUrl === 'YOUR_DEPLOY_URL_HERE') {
    console.log('ERROR: deployUrl を実際のデプロイURLに置き換えてください');
    console.log('');
    console.log('【手順】');
    console.log('1. GASエディタで「デプロイ」→「デプロイを管理」を開く');
    console.log('2. ウェブアプリのURLをコピー（/exec で終わるURL）');
    console.log('3. このコード内の deployUrl を書き換えて再実行');
    console.log('');
    console.log('例: var deployUrl = \'https://script.google.com/macros/s/XXXXX/exec\';');
    return;
  }

  var url = deployUrl.trim();

  // 基本的なバリデーション
  if (url.indexOf('https://script.google.com/macros/s/') !== 0) {
    console.log('エラー: GASデプロイURLの形式ではありません。');
    console.log('正しい形式: https://script.google.com/macros/s/XXXXX/exec');
    return;
  }
  if (url.indexOf('/dev') === url.length - 4) {
    console.log('エラー: /dev URLは使用できません。/exec で終わる本番URLを指定してください。');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('DEPLOY_URL', url.replace(/\/+$/, ''));
  console.log('DEPLOY_URL を保存しました: ' + url);
  console.log('');
  console.log('セキュリティのため、コード内のURLを YOUR_DEPLOY_URL_HERE に戻すことをお勧めします');
  console.log('');
  console.log('次に setKomojuWebhookSecret() を実行してWebhookを設定してください。');
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

// =====================================================
// ペンディング注文の定期チェック（Webhookセーフティネット）
// =====================================================

/**
 * ペンディング注文をチェックし、KOMOJU側で決済完了しているものを確定する。
 * Webhookが届かなかった場合のセーフティネット。
 *
 * GASエディタから時間ベースのトリガーを設定してください:
 *   ScriptApp.newTrigger('checkPendingOrders')
 *     .timeBased().everyMinutes(5).create();
 */
function checkPendingOrders() {
  var secretKey = getKomojuSecretKey_();
  if (!secretKey) return;

  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var pendingKeys = [];

  for (var key in allProps) {
    if (key.indexOf('PENDING_ORDER_') === 0) {
      pendingKeys.push(key);
    }
  }

  if (pendingKeys.length === 0) return;

  console.log('checkPendingOrders: ' + pendingKeys.length + '件のペンディング注文を確認');

  for (var i = 0; i < pendingKeys.length; i++) {
    var pendingKey = pendingKeys[i];
    var receiptNo = pendingKey.replace('PENDING_ORDER_', '');

    try {
      // ペンディングデータの経過時間を確認（古すぎるものは自動キャンセル）
      var pendingDataStr = props.getProperty(pendingKey);
      if (!pendingDataStr) {
        console.warn('checkPendingOrders: ペンディングデータが空: ' + receiptNo);
        continue;
      }
      var pendingData = JSON.parse(pendingDataStr);
      var elapsedMs = Date.now() - (pendingData.createdAtMs || 0);
      var elapsedMin = Math.round(elapsedMs / 60000);
      console.log('checkPendingOrders: [' + receiptNo + '] 経過' + elapsedMin + '分');

      // 3日（259200秒 = KOMOJU有効期限）を超過 → 自動キャンセル
      if (elapsedMs > 259200 * 1000) {
        console.log('checkPendingOrders: ペンディング注文の期限切れ → 自動キャンセル: ' + receiptNo);
        apiCancelOrder(receiptNo);
        continue;
      }

      // KOMOJU決済セッションの状態を確認
      var saved = getPaymentSession_(receiptNo);
      var sessionId = saved && saved.sessionId ? saved.sessionId : null;

      if (!sessionId) {
        // PAYMENT_ データがない場合、external_order_num で KOMOJU API を検索
        console.warn('checkPendingOrders: [' + receiptNo + '] PAYMENT_データなし → KOMOJU APIで検索');
        var searchResp = komojuRequest_('GET', '/sessions?external_order_num=' + encodeURIComponent(receiptNo), null, secretKey);
        if (searchResp && searchResp.data && searchResp.data.length > 0) {
          var foundSession = searchResp.data[0];
          sessionId = foundSession.id;
          // 見つかったセッション情報を保存（次回から高速に取得）
          savePaymentSession_(receiptNo, {
            sessionId: sessionId,
            status: foundSession.status,
            createdAt: foundSession.created_at
          });
          console.log('checkPendingOrders: [' + receiptNo + '] KOMOJU検索でセッション発見: ' + sessionId);
        } else {
          console.warn('checkPendingOrders: [' + receiptNo + '] KOMOJUにもセッションなし → スキップ');
          continue;
        }
      }

      var response = komojuRequest_('GET', '/sessions/' + sessionId, null, secretKey);
      if (response.error) {
        console.warn('checkPendingOrders: [' + receiptNo + '] KOMOJU API error: ' + (response.error.message || JSON.stringify(response.error)));
        continue;
      }

      var status = mapKomojuStatus_(response.status);
      console.log('checkPendingOrders: [' + receiptNo + '] KOMOJUステータス=' + response.status + ' → ' + status);

      if ((status === 'paid' || status === 'authorized') && response.payment) {
        console.log('checkPendingOrders: [' + receiptNo + '] 決済完了を検出 → 注文確定');
        var paymentMethodType = response.payment.payment_method_type || '';
        var paymentStatus = '未対応';
        if (paymentMethodType === 'konbini' || paymentMethodType === 'bank_transfer') {
          paymentStatus = '入金待ち';
        }
        var confirmResult = confirmPaymentAndCreateOrder(
          receiptNo, paymentStatus, paymentMethodType, response.payment.id || ''
        );
        if (confirmResult && confirmResult.ok) {
          console.log('checkPendingOrders: [' + receiptNo + '] 注文確定成功');
        } else {
          console.error('checkPendingOrders: [' + receiptNo + '] 注文確定失敗:', confirmResult);
        }
      } else if (status === 'failed' || status === 'expired' || status === 'cancelled') {
        console.log('checkPendingOrders: [' + receiptNo + '] 決済失敗/期限切れ → キャンセル');
        apiCancelOrder(receiptNo);
      } else {
        console.log('checkPendingOrders: [' + receiptNo + '] まだ決済未完了（status=' + status + '）→ 次回再チェック');
      }
    } catch (checkErr) {
      console.error('checkPendingOrders error for ' + receiptNo + ':', checkErr);
    }
  }
}

/**
 * ペンディング注文チェックのトリガーを設定（GASエディタで1回だけ実行）
 */
function setupPendingOrderTrigger() {
  // 既存のトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkPendingOrders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 5分おきにペンディング注文をチェック
  ScriptApp.newTrigger('checkPendingOrders')
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log('checkPendingOrders トリガーを設定しました（5分間隔）');
}
