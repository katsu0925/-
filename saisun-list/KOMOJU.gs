// KOMOJU.gs
/**
 * KOMOJU.gs
 *
 * KOMOJU決済連携モジュール
 * クレジットカード（Visa/Mastercard）、コンビニ払い、銀行振込に対応
 * ※申請中: Paidy
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

  // 対応決済方法
  paymentMethods: [
    'credit_card',      // クレジットカード（Visa/Mastercard/JCB/AMEX/Diners/Discover）
    'konbini',          // コンビニ払い
    'bank_transfer',    // 銀行振込
    'paypay',           // PayPay
    'pay_easy',         // ペイジー（Pay-easy）
    'apple_pay',        // Apple Pay
    'paidy'             // Paidy（あと払い）
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
 * @param {string} paymentKey - 決済トークン（UUID）または受付番号（後方互換）
 * @param {number} amount - 金額
 * @param {object} customerInfo - 顧客情報
 * @returns {object} - { ok, sessionUrl, sessionId, message }
 */
function apiCreateKomojuSession(paymentKey, amount, customerInfo) {
  try {
    var secretKey = getKomojuSecretKey_();
    if (!secretKey) {
      return { ok: false, message: 'KOMOJU APIキーが設定されていません' };
    }

    if (!paymentKey) {
      return { ok: false, message: '決済キーが必要です' };
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
      external_order_num: paymentKey,
      return_url: getReturnUrl_() + '?token=' + encodeURIComponent(paymentKey) + '&status=complete',
      cancel_url: getReturnUrl_() + '?token=' + encodeURIComponent(paymentKey) + '&status=cancel',
      payment_types: KOMOJU_CONFIG.paymentMethods,
      metadata: {
        payment_token: String(paymentKey),
        company_name: String(info.companyName || ''),
        email: String(email),
        product_amount: String(info.productAmount || 0),
        shipping_amount: String(info.shippingAmount || 0),
        shipping_size: String(info.shippingSize || '')
      }
    };

    // 顧客情報を追加（Paidyは name, email, phone が必須）
    var customerName = String(info.companyName || '').trim();
    var customerPhone = String(info.phone || '').trim().replace(/[-ー\s]/g, '');
    if (email || customerName || customerPhone) {
      sessionData.customer = {};
      if (email) sessionData.customer.email = email;
      if (customerName) sessionData.customer.name = customerName;
      if (customerPhone) sessionData.customer.phone = customerPhone;
    }

    var response = komojuRequest_('POST', '/sessions', sessionData, secretKey);

    if (response.error) {
      console.error('KOMOJU session creation error:', response);
      return { ok: false, message: response.error.message || 'セッション作成に失敗しました' };
    }

    // 決済情報を保存
    savePaymentSession_(paymentKey, {
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
 * @param {string} pendingKey - 決済トークン（UUID）または受付番号（後方互換）
 * @returns {object} - { ok, status, paymentDetails, receiptNo }
 */
function apiCheckPaymentStatus(pendingKey) {
  try {
    var secretKey = getKomojuSecretKey_();
    if (!secretKey) {
      return { ok: false, message: 'KOMOJU APIキーが設定されていません' };
    }

    var saved = getPaymentSession_(pendingKey);

    // PropertiesServiceの一時的な不整合に備え、未取得時はリトライ
    if (!saved || !saved.sessionId) {
      Utilities.sleep(500);
      saved = getPaymentSession_(pendingKey);
    }

    // それでもPAYMENT_セッションが見つからない場合、D1逆引きで復元
    if (!saved || !saved.sessionId) {
      console.log('apiCheckPaymentStatus: PAYMENT_セッション未保存、D1逆引きを試行: ' + pendingKey);
      var recoveredSessionId = lookupSessionByToken_(pendingKey);
      if (recoveredSessionId) {
        saved = {
          sessionId: recoveredSessionId,
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        savePaymentSession_(pendingKey, saved);
        console.log('apiCheckPaymentStatus: D1逆引き成功、sessionId=' + recoveredSessionId);
      } else {
        console.error('apiCheckPaymentStatus: D1逆引きも失敗: ' + pendingKey);
        return { ok: false, message: '決済セッションが見つかりません' };
      }
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
      saved.paymentMethod = extractPaymentMethodType_(response.payment);
    }
    savePaymentSession_(pendingKey, saved);

    // Webhookが未処理の場合のフォールバック:
    // 決済が完了(captured/authorized)しているのにペンディング注文が残っている場合、
    // ここで注文確定処理を実行する
    if ((status === 'paid' || status === 'authorized') && response.payment) {
      var props = PropertiesService.getScriptProperties();
      var fallbackKey = 'PENDING_ORDER_' + pendingKey;
      if (props.getProperty(fallbackKey)) {
        console.log('Webhookが未処理のため、ステータスチェック経由で注文を確定: ' + pendingKey);
        var paymentMethodType = extractPaymentMethodType_(response.payment);

        // Paidy: authorized → 自動キャプチャ
        if (paymentMethodType === 'paidy' && status === 'authorized') {
          console.log('フォールバック: Paidy自動キャプチャ実行: ' + pendingKey);
          var capResult = capturePayment_(response.payment.id);
          if (capResult && !capResult.error) {
            console.log('フォールバック: Paidyキャプチャ成功: ' + pendingKey);
          } else {
            console.error('フォールバック: Paidyキャプチャ失敗: ' + pendingKey, capResult);
          }
        }

        var deferredFb = { 'konbini': true, 'bank_transfer': true, 'pay_easy': true };
        var paymentStatus;
        if (status === 'paid') {
          paymentStatus = '対応済';
        } else if (deferredFb[paymentMethodType] && status === 'authorized') {
          paymentStatus = '入金待ち';
        } else {
          paymentStatus = '未対応';
        }
        var confirmResult = confirmPaymentAndCreateOrder(
          pendingKey,
          paymentStatus,
          paymentMethodType,
          response.payment.id || ''
        );
        if (confirmResult && confirmResult.ok) {
          console.log('フォールバック注文確定成功: ' + pendingKey);
          // 確定後のreceiptNoをsavedにも保存
          if (confirmResult.receiptNo) {
            saved.receiptNo = confirmResult.receiptNo;
            savePaymentSession_(pendingKey, saved);
          }
        } else {
          console.error('フォールバック注文確定失敗:', confirmResult);
        }
      }
    }

    return {
      ok: true,
      status: status,
      komojuStatus: response.status,
      paymentMethod: response.payment ? extractPaymentMethodType_(response.payment) : null,
      paidAt: response.payment ? response.payment.created_at : null,
      totalAmount: saved.amount || 0,
      receiptNo: saved.receiptNo || null
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

      case 'payment.updated':
        return handlePaymentUpdated_(data);

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
  var paymentToken = resolvePaymentToken_(webhookPayment);

  if (!paymentToken) {
    console.error('Payment token not found in webhook data (5-level fallback exhausted)');
    return { ok: false, message: 'Payment token not found' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  if (!apiPayment) {
    console.error('KOMOJU API verification failed for: ' + paymentToken + ' (paymentId=' + webhookPayment.id + ')');
    return { ok: false, message: 'API verification failed' };
  }

  // APIから取得したステータスが本当に成功しているか確認
  var apiStatus = mapKomojuStatus_(apiPayment.status);
  if (apiStatus !== 'paid' && apiStatus !== 'authorized') {
    console.error('API検証: 決済ステータスが成功ではない: status=' + apiPayment.status + ', token=' + paymentToken);
    return { ok: false, message: 'Payment not confirmed by API (status=' + apiPayment.status + ')' };
  }

  // 金額の照合
  if (!verifyPaymentAmount_(paymentToken, apiPayment.amount)) {
    console.error('API検証: 金額不一致のため処理を中止: token=' + paymentToken);
    return { ok: false, message: 'Amount mismatch' };
  }

  // === 検証済みのAPIデータで決済情報を更新 ===
  var payment = apiPayment;  // 以降はAPI検証済みデータを使用
  var paymentMethodType = extractPaymentMethodType_(payment);

  // Paidy: authorized → 自動キャプチャ（売上確定）
  // Paidyは与信確保後に加盟店が明示的にcaptureを呼ぶ必要がある。
  // KOMOJUが立替入金するため、即座にキャプチャして注文確定する。
  if (paymentMethodType === 'paidy' && data.type === 'payment.authorized') {
    console.log('Paidy authorized → 自動キャプチャ実行: paymentId=' + payment.id + ', token=' + paymentToken);
    var captureResult = capturePayment_(payment.id);
    if (captureResult && !captureResult.error) {
      console.log('Paidyキャプチャ成功: paymentId=' + payment.id);
      payment = captureResult;  // キャプチャ後のデータで更新
    } else {
      console.error('Paidyキャプチャ失敗: paymentId=' + payment.id, captureResult);
      // キャプチャ失敗でも注文確定は続行（authorizedの状態で記録し、後でリトライ可能にする）
    }
  }

  var saved = getPaymentSession_(paymentToken) || {};
  saved.status = 'paid';
  saved.komojuStatus = payment.status;
  saved.paymentId = payment.id;
  saved.paymentMethod = paymentMethodType;
  saved.paidAt = new Date().toISOString();
  saved.amount = payment.amount;
  saved.verifiedViaApi = true;
  savePaymentSession_(paymentToken, saved);

  console.log('Payment method detected: ' + paymentMethodType + ' (for ' + paymentToken + ')');

  // 決済方法に応じた入金ステータスを決定
  // captured = 入金済み → 対応済、authorized = 承認済み（未入金）→ 入金待ち
  // Paidy: KOMOJUが立替入金するため、キャプチャ後は '未対応'（入金済み・処理待ち）
  var deferredMethods = { 'konbini': true, 'bank_transfer': true, 'pay_easy': true };
  var paymentStatus;
  if (data.type === 'payment.captured') {
    paymentStatus = '対応済';
  } else if (deferredMethods[paymentMethodType] && data.type === 'payment.authorized') {
    paymentStatus = '入金待ち';
  } else {
    paymentStatus = '未対応';
  }

  // 注文を確定（シート書き込み・注文確認メール送信）
  var confirmResult = confirmPaymentAndCreateOrder(
    paymentToken,
    paymentStatus,
    paymentMethodType,
    payment.id || ''
  );
  if (!confirmResult.ok) {
    console.error('Failed to confirm order:', confirmResult.message);
    // 既にシートに書き込まれている可能性があるため、ステータスのみ更新を試みる
    // confirmResult.receiptNoがあればそれを使用、なければpaymentTokenで旧互換
    var statusReceiptNo = (confirmResult && confirmResult.receiptNo) ? confirmResult.receiptNo : paymentToken;
    updateOrderPaymentStatus_(statusReceiptNo, 'paid', paymentMethodType);
  } else {
    // 確定成功時: receiptNoをPAYMENT_セッションに保存
    if (confirmResult.receiptNo) {
      saved.receiptNo = confirmResult.receiptNo;
      savePaymentSession_(paymentToken, saved);
    }
  }

  console.log('Payment success processed (API verified) for:', paymentToken);
  return { ok: true, message: 'Payment processed' };
}

/**
 * 決済失敗時の処理
 * Webhookの通知を受けた後、KOMOJU APIで決済状態を検証してから処理を実行する。
 */
function handlePaymentFailed_(data) {
  var webhookPayment = data.data;
  var paymentToken = resolvePaymentToken_(webhookPayment);

  if (!paymentToken) {
    return { ok: false, message: 'Payment token not found (5-level fallback exhausted)' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  var payment = apiPayment || webhookPayment;  // API取得失敗時はWebhookデータで続行（キャンセルは安全側）

  if (apiPayment) {
    var apiStatus = mapKomojuStatus_(apiPayment.status);
    if (apiStatus === 'paid' || apiStatus === 'authorized') {
      console.error('API検証: Webhookは失敗だがAPIでは決済成功 → 処理を中止: token=' + paymentToken);
      return { ok: false, message: 'API shows payment succeeded, ignoring failure webhook' };
    }
    console.log('決済失敗をAPI検証で確認: token=' + paymentToken + ', status=' + apiPayment.status);
  } else {
    console.warn('API検証失敗、Webhookデータで処理を続行（安全側）: token=' + paymentToken);
  }

  var saved = getPaymentSession_(paymentToken) || {};
  saved.status = 'failed';
  saved.komojuStatus = payment.status;
  saved.failedAt = new Date().toISOString();
  saved.failReason = payment.payment_details ? payment.payment_details.failure_reason : null;
  saved.verifiedViaApi = !!apiPayment;
  savePaymentSession_(paymentToken, saved);

  // 決済失敗 → 注文をキャンセルして商品を解放
  var cancelResult = apiCancelOrder(paymentToken);
  if (cancelResult && cancelResult.ok) {
    console.log('Order cancelled due to payment failure:', paymentToken);
  } else {
    console.error('Failed to cancel order after payment failure:', paymentToken);
  }

  console.log('Payment failed (API verified) for:', paymentToken);
  return { ok: true, message: 'Payment failure processed' };
}

/**
 * 返金時の処理
 * Webhookの通知を受けた後、KOMOJU APIで決済状態を検証してから処理を実行する。
 */
function handlePaymentRefunded_(data) {
  var webhookPayment = data.data;
  var paymentToken = resolvePaymentToken_(webhookPayment);

  if (!paymentToken) {
    return { ok: false, message: 'Payment token not found (5-level fallback exhausted)' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  if (!apiPayment) {
    console.error('KOMOJU API verification failed for refund: ' + paymentToken + ' (paymentId=' + webhookPayment.id + ')');
    return { ok: false, message: 'API verification failed for refund' };
  }

  // APIから取得したステータスが本当に返金されているか確認
  var apiStatus = mapKomojuStatus_(apiPayment.status);
  if (apiStatus !== 'refunded') {
    console.error('API検証: 返金ステータスではない: status=' + apiPayment.status + ', token=' + paymentToken);
    return { ok: false, message: 'Refund not confirmed by API (status=' + apiPayment.status + ')' };
  }

  var payment = apiPayment;
  var saved = getPaymentSession_(paymentToken) || {};
  saved.status = 'refunded';
  saved.komojuStatus = payment.status;
  saved.refundedAt = new Date().toISOString();
  saved.verifiedViaApi = true;
  savePaymentSession_(paymentToken, saved);

  // 依頼管理シートのステータスを更新（PAYMENT_セッションからreceiptNoを取得）
  var sheetReceiptNo = saved.receiptNo || paymentToken;
  updateOrderPaymentStatus_(sheetReceiptNo, 'refunded', null);

  console.log('Payment refunded (API verified) for:', paymentToken);
  return { ok: true, message: 'Refund processed' };
}

/**
 * 決済更新時の処理（payment.updated）
 * コンビニ払い・銀行振込・ペイジーで顧客が実際に入金した際にKOMOJUから送信される。
 * 入金完了（captured）を検知して「入金待ち」→「未対応」にステータスを更新する。
 */
function handlePaymentUpdated_(data) {
  var webhookPayment = data.data;
  var paymentToken = resolvePaymentToken_(webhookPayment);

  if (!paymentToken) {
    console.log('payment.updated: payment token not found (5-level fallback exhausted), ignoring');
    return { ok: true, message: 'No payment token, ignored' };
  }

  // === KOMOJU APIで決済状態を裏取り ===
  var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
  if (!apiPayment) {
    console.error('payment.updated: API verification failed for ' + paymentToken);
    return { ok: false, message: 'API verification failed' };
  }

  var apiStatus = mapKomojuStatus_(apiPayment.status);
  console.log('payment.updated: token=' + paymentToken + ', apiStatus=' + apiPayment.status + ' → ' + apiStatus);

  // captured（入金完了）でない場合は無視
  if (apiStatus !== 'paid') {
    console.log('payment.updated: status is not captured (' + apiPayment.status + '), ignoring');
    return { ok: true, message: 'Not captured, ignored' };
  }

  var paymentMethodType = extractPaymentMethodType_(apiPayment);

  // 後払い（コンビニ・銀行振込・ペイジー）の入金完了を処理
  var deferredMethods = { 'konbini': true, 'bank_transfer': true, 'pay_easy': true, 'paidy': true };
  if (deferredMethods[paymentMethodType]) {
    // 金額の照合
    if (!verifyPaymentAmount_(paymentToken, apiPayment.amount)) {
      console.error('payment.updated: 金額不一致: token=' + paymentToken);
      return { ok: false, message: 'Amount mismatch' };
    }

    // 決済セッション情報を更新
    var saved = getPaymentSession_(paymentToken) || {};
    saved.status = 'paid';
    saved.komojuStatus = apiPayment.status;
    saved.paymentId = apiPayment.id;
    saved.paymentMethod = paymentMethodType;
    saved.paidAt = new Date().toISOString();
    saved.verifiedViaApi = true;
    savePaymentSession_(paymentToken, saved);

    // 依頼管理シートの入金ステータスを「入金待ち」→「未対応」に更新
    // PAYMENT_セッションからreceiptNoを取得
    var sheetReceiptNo = saved.receiptNo || paymentToken;
    updateOrderPaymentStatus_(sheetReceiptNo, 'paid', paymentMethodType);

    // 入金確認メールを顧客に送信
    sendPaymentConfirmedEmail_(sheetReceiptNo, paymentMethodType);

    console.log('payment.updated: 入金確認完了 (' + paymentMethodType + '): ' + paymentToken);
    return { ok: true, message: 'Payment confirmed via updated event' };
  }

  // 後払い以外のupdatedイベントは無視
  console.log('payment.updated: non-deferred payment method (' + paymentMethodType + '), ignoring');
  return { ok: true, message: 'Non-deferred method, ignored' };
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

  // 方式3（受付番号照合）は廃止 — 受付番号が予測可能なため偽造リスクあり
  // KOMOJU_WEBHOOK_SECRET を必ず設定してください

  console.warn('Webhook認証失敗: HMAC署名検証に失敗しました。KOMOJU_WEBHOOK_SECRET が正しく設定されているか確認してください。');
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
  // 長さが異なる場合もタイミング一定で比較（長さリーク対策）
  var len = Math.max(strA.length, strB.length);
  var result = strA.length ^ strB.length;
  for (var i = 0; i < len; i++) {
    result |= (strA.charCodeAt(i) || 0) ^ (strB.charCodeAt(i) || 0);
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
 * @param {string} pendingKey - 決済トークンまたは受付番号
 * @param {number} apiAmount - KOMOJU APIから取得した実際の決済金額
 * @returns {boolean} - 金額が一致すればtrue
 */
function verifyPaymentAmount_(pendingKey, apiAmount) {
  var amountChecked = false;  // 実際に金額照合が行われたかのフラグ

  // PAYMENT_ セッションの金額と照合
  var saved = getPaymentSession_(pendingKey);
  if (saved && saved.amount) {
    if (Math.round(Number(saved.amount)) !== Math.round(Number(apiAmount))) {
      console.error('金額不一致（PAYMENT_セッション）: 期待=' + saved.amount + ', 実際=' + apiAmount + ', key=' + pendingKey);
      return false;
    }
    amountChecked = true;
  }

  // PENDING_ORDER_ の金額とも照合
  try {
    var props = PropertiesService.getScriptProperties();
    var pendingStr = props.getProperty('PENDING_ORDER_' + pendingKey);
    if (pendingStr) {
      var pending = JSON.parse(pendingStr);
      // totalAmount = 送料込み合計（discounted は商品のみなので比較対象にならない）
      var expectedTotal = pending.totalAmount;
      if (expectedTotal !== undefined && expectedTotal !== null) {
        if (Math.round(Number(expectedTotal)) !== Math.round(Number(apiAmount))) {
          console.error('金額不一致（PENDING_ORDER）: 期待=' + expectedTotal + ', 実際=' + apiAmount + ', key=' + pendingKey);
          return false;
        }
        amountChecked = true;
      }
    }
  } catch (e) {
    console.warn('verifyPaymentAmount_: ペンディング注文の金額照合スキップ:', e);
  }

  // 照合データが一切なかった場合は警告ログを出力（改ざんリスクの見逃しを防ぐ）
  if (!amountChecked) {
    console.warn('verifyPaymentAmount_: 金額照合データなし（PAYMENT_/PENDING_ORDER_ともに未取得）' +
                 ' key=' + pendingKey + ', apiAmount=' + apiAmount);
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
    muteHttpExceptions: true,
    deadline: 10  // 10秒でタイムアウト（GAS UrlFetchApp の deadline パラメータ）
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
 * KOMOJU決済をキャプチャ（売上確定）する
 * Paidyなど、authorized後に明示的なキャプチャが必要な決済方法で使用。
 * @param {string} paymentId - KOMOJUの決済ID
 * @returns {object} - キャプチャ後の決済オブジェクト、またはエラー
 */
function capturePayment_(paymentId) {
  var secretKey = getKomojuSecretKey_();
  if (!secretKey) {
    return { error: { message: 'KOMOJU APIキーが設定されていません' } };
  }
  return komojuRequest_('POST', '/payments/' + paymentId + '/capture', {}, secretKey);
}

// =====================================================
// paymentToken 5段フォールバック解決
// =====================================================

/**
 * Webhookの決済オブジェクトからpaymentTokenを5段フォールバックで解決する。
 *
 * Level 1: external_order_num（通常はここで解決）
 * Level 2: metadata.payment_token（メタデータから）
 * Level 3: metadata.receipt_no（旧フロー互換）
 * Level 4: KOMOJU Sessions API GET /sessions/{session_id}（セッションの元metadata）
 * Level 5: D1逆引き session_token_map（Workers API経由）
 *
 * @param {object} webhookPayment - Webhookのdata.data（決済オブジェクト）
 * @returns {string|null} - paymentToken。解決できなければnull
 */
function resolvePaymentToken_(webhookPayment) {
  if (!webhookPayment) return null;

  // Level 1: external_order_num
  if (webhookPayment.external_order_num) {
    console.log('resolvePaymentToken_: Level 1 (external_order_num) → ' + webhookPayment.external_order_num);
    return webhookPayment.external_order_num;
  }

  // Level 2: metadata.payment_token
  if (webhookPayment.metadata && webhookPayment.metadata.payment_token) {
    console.log('resolvePaymentToken_: Level 2 (metadata.payment_token) → ' + webhookPayment.metadata.payment_token);
    return webhookPayment.metadata.payment_token;
  }

  // Level 3: metadata.receipt_no（旧フロー互換）
  if (webhookPayment.metadata && webhookPayment.metadata.receipt_no) {
    console.log('resolvePaymentToken_: Level 3 (metadata.receipt_no) → ' + webhookPayment.metadata.receipt_no);
    return webhookPayment.metadata.receipt_no;
  }

  // Level 4: KOMOJU Sessions API
  // 決済オブジェクトからsession_idを取得してセッション情報を参照
  var sessionId = webhookPayment.session || null;
  if (!sessionId && webhookPayment.id) {
    // session_idが直接ない場合、KOMOJU Payments APIから取得済みの情報を確認
    var apiPayment = fetchPaymentFromApi_(webhookPayment.id);
    if (apiPayment) {
      sessionId = apiPayment.session || null;
      // APIから取得した決済オブジェクト自体にexternal_order_numがある場合もチェック
      if (apiPayment.external_order_num) {
        console.log('resolvePaymentToken_: Level 4a (API payment.external_order_num) → ' + apiPayment.external_order_num);
        return apiPayment.external_order_num;
      }
      if (apiPayment.metadata && apiPayment.metadata.payment_token) {
        console.log('resolvePaymentToken_: Level 4b (API payment.metadata.payment_token) → ' + apiPayment.metadata.payment_token);
        return apiPayment.metadata.payment_token;
      }
    }
  }

  if (sessionId) {
    var session = fetchSessionFromApi_(sessionId);
    if (session) {
      // セッションのexternal_order_numやmetadataを確認
      if (session.external_order_num) {
        console.log('resolvePaymentToken_: Level 4c (session.external_order_num) → ' + session.external_order_num);
        return session.external_order_num;
      }
      if (session.metadata && session.metadata.payment_token) {
        console.log('resolvePaymentToken_: Level 4d (session.metadata.payment_token) → ' + session.metadata.payment_token);
        return session.metadata.payment_token;
      }
    }

    // Level 5: D1逆引き session_token_map
    var d1Token = lookupTokenFromD1_(sessionId);
    if (d1Token) {
      console.log('resolvePaymentToken_: Level 5 (D1 session_token_map) → ' + d1Token);
      return d1Token;
    }
  }

  console.error('resolvePaymentToken_: 全5レベルで解決不能。paymentId=' + (webhookPayment.id || 'unknown') + ', sessionId=' + (sessionId || 'unknown'));
  return null;
}

/**
 * KOMOJU Sessions APIでセッション情報を取得
 * @param {string} sessionId - KOMOJUのセッションID
 * @returns {object|null} - セッション情報。取得失敗時はnull
 */
function fetchSessionFromApi_(sessionId) {
  if (!sessionId) return null;

  var secretKey = getKomojuSecretKey_();
  if (!secretKey) {
    console.error('fetchSessionFromApi_: APIキー未設定');
    return null;
  }

  var response = komojuRequest_('GET', '/sessions/' + sessionId, null, secretKey);
  if (response.error) {
    console.error('fetchSessionFromApi_: KOMOJU API error:', response.error.message || JSON.stringify(response.error));
    return null;
  }

  if (!response.id) {
    console.error('fetchSessionFromApi_: 不正なレスポンス');
    return null;
  }

  return response;
}

/**
 * Workers API経由でD1のsession_token_mapからpaymentTokenを逆引き
 * @param {string} sessionId - KOMOJUのセッションID
 * @returns {string|null} - paymentToken。見つからない場合はnull
 */
function lookupTokenFromD1_(sessionId) {
  if (!sessionId) return null;

  try {
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_API_URL');
    var adminKey = props.getProperty('ADMIN_KEY');
    if (!workersUrl || !adminKey) {
      console.warn('lookupTokenFromD1_: WORKERS_API_URL or ADMIN_KEY not set');
      return null;
    }

    var resp = UrlFetchApp.fetch(workersUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'apiLookupBySession',
        adminKey: adminKey,
        args: [sessionId]
      }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      console.error('lookupTokenFromD1_: HTTP ' + code);
      return null;
    }

    var result = JSON.parse(resp.getContentText());
    if (result && result.ok && result.found && result.paymentToken) {
      return result.paymentToken;
    }
    return null;
  } catch (e) {
    console.error('lookupTokenFromD1_ error:', e);
    return null;
  }
}

/**
 * Workers API経由でD1のsession_token_mapからpaymentToken→sessionIdを逆引き
 * Workers版submitEstimateで作成されたKOMOJUセッションのIDを取得するために使用
 * @param {string} paymentToken - 決済トークン（UUID）
 * @returns {string|null} - sessionId。見つからない場合はnull
 */
function lookupSessionByToken_(paymentToken) {
  if (!paymentToken) return null;

  try {
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_API_URL');
    var adminKey = props.getProperty('ADMIN_KEY');
    if (!workersUrl || !adminKey) {
      console.warn('lookupSessionByToken_: WORKERS_API_URL or ADMIN_KEY not set');
      return null;
    }

    var resp = UrlFetchApp.fetch(workersUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'apiLookupSessionByToken',
        adminKey: adminKey,
        args: [paymentToken]
      }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      console.error('lookupSessionByToken_: HTTP ' + code);
      return null;
    }

    var result = JSON.parse(resp.getContentText());
    if (result && result.ok && result.found && result.sessionId) {
      return result.sessionId;
    }
    return null;
  } catch (e) {
    console.error('lookupSessionByToken_ error:', e);
    return null;
  }
}

/**
 * KOMOJUの決済オブジェクトから決済方法タイプを抽出する。
 * KOMOJU APIバージョンによってフィールド名が異なるため、複数のパスを確認する:
 *   1. payment_method_type（セッション内のpaymentオブジェクト）
 *   2. payment_details.type（/payments/ APIレスポンス）
 *
 * @param {object} payment - KOMOJU決済オブジェクト
 * @returns {string} - 決済方法タイプ（例: 'credit_card'）。取得できない場合は空文字
 */
function extractPaymentMethodType_(payment) {
  if (!payment) return '';
  // 1. payment_method_type を確認
  if (payment.payment_method_type) return String(payment.payment_method_type);
  // 2. payment_details.type を確認（KOMOJU /payments/ API レスポンス形式）
  if (payment.payment_details && payment.payment_details.type) return String(payment.payment_details.type);
  return '';
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
    'bank_transfer': '銀行振込',
    'paypay': 'PayPay',
    'pay_easy': 'ペイジー',
    'apple_pay': 'Apple Pay',
    'paidy': 'Paidy（あと払い）',
    'admin': '管理者登録'
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
  } catch (e) { console.log('optional: FRONTEND_URL read: ' + (e.message || e)); }
  if (typeof SITE_CONSTANTS !== 'undefined' && SITE_CONSTANTS && SITE_CONSTANTS.SITE_URL) {
    return String(SITE_CONSTANTS.SITE_URL).replace(/\/+$/, '');
  }
  // DEPLOY_URL が設定されていればそれを使用
  try {
    var deployUrl = PropertiesService.getScriptProperties().getProperty('DEPLOY_URL');
    if (deployUrl) return deployUrl.replace(/\/+$/, '');
  } catch (e) { console.log('optional: DEPLOY_URL read: ' + (e.message || e)); }
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
/**
 * 後払い入金確認メールを顧客に送信
 * コンビニ・銀行振込・ペイジー・Paidyで実際に入金された際に呼ばれる
 * @param {string} receiptNo - 受付番号
 * @param {string} paymentMethodType - 決済方法タイプ
 */
function sendPaymentConfirmedEmail_(receiptNo, paymentMethodType) {
  try {
    var orderSs = sh_getOrderSs_();
    var sheet = orderSs.getSheetByName('依頼管理');
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    // 受付番号で行を検索（A列）
    var allReceipts = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var targetRow = -1;
    for (var i = 0; i < allReceipts.length; i++) {
      if (String(allReceipts[i][0]) === String(receiptNo)) {
        targetRow = i + 2;
        break;
      }
    }
    if (targetRow === -1) {
      console.warn('sendPaymentConfirmedEmail_: 受付番号が見つからない: ' + receiptNo);
      return;
    }

    // 依頼管理シートから必要な列を取得
    // A=受付番号, C=会社名, D=メール, K=合計点数, L=合計金額, N=送料(客負担), O=決済方法
    var rowData = sheet.getRange(targetRow, 1, 1, 15).getValues()[0];
    var companyName = String(rowData[2] || '').trim();
    var email = String(rowData[3] || '').trim();
    var totalCount = rowData[10] || 0;
    var totalAmount = rowData[11] || 0;
    var shippingAmount = rowData[13] || 0;

    if (!email || email.indexOf('@') === -1) {
      console.warn('sendPaymentConfirmedEmail_: メールアドレスなし: ' + receiptNo);
      return;
    }

    var paymentMethodLabel = getPaymentMethodDisplayName_(paymentMethodType);
    var confirmedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日 HH:mm');

    // テキスト版
    var subject = '【デタウリ.Detauri】入金を確認しました（受付番号：' + receiptNo + '）';
    var body = companyName + ' 様\n\n'
      + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
      + 'お客様のご入金を確認いたしました。ご注文が確定しましたのでお知らせいたします。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ ご注文内容\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '受付番号：' + receiptNo + '\n'
      + '入金確認日時：' + confirmedAt + '\n'
      + '会社名/氏名：' + companyName + '\n'
      + '合計点数：' + totalCount + '点\n'
      + '合計金額：' + Number(totalAmount).toLocaleString() + '円（税込）\n';

    if (shippingAmount > 0) {
      body += '（うち送料：' + Number(shippingAmount).toLocaleString() + '円）\n';
    }
    body += '決済方法：' + paymentMethodLabel + '\n';

    body += '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '商品の発送準備を進めてまいります。\n'
      + '発送が完了しましたら、追跡番号とともにメールでお知らせいたします。\n\n'
      + '※ このメールは自動送信です。\n'
      + '※ ご注文確定後のキャンセル・変更はできません。\n'
      + '\n──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    // HTML版
    var htmlBody = buildHtmlEmail_({
      greeting: companyName + ' 様',
      lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\nお客様のご入金を確認いたしました。ご注文が確定しましたのでお知らせいたします。',
      sections: [
        {
          title: 'ご注文内容',
          rows: [
            { label: '受付番号', value: String(receiptNo) },
            { label: '入金確認日時', value: confirmedAt },
            { label: '会社名/氏名', value: companyName },
            { label: '合計点数', value: totalCount + '点' },
            { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円（税込）' },
            { label: '決済方法', value: paymentMethodLabel }
          ]
        },
        {
          title: '',
          text: '商品の発送準備を進めてまいります。\n発送が完了しましたら、追跡番号とともにメールでお知らせいたします。'
        }
      ],
      notes: [
        'このメールは自動送信です。',
        'ご注文確定後のキャンセル・変更はできません。'
      ]
    });

    GmailApp.sendEmail(email, subject, body, {
      from: SITE_CONSTANTS.CUSTOMER_EMAIL,
      replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
      htmlBody: htmlBody
    });

    console.log('入金確認メール送信完了: ' + receiptNo + ' → ' + email);
  } catch (e) {
    console.error('sendPaymentConfirmedEmail_ error:', e);
  }
}

/**
 * テスト用: パラメータ直接指定で入金確認メールを送信
 */
function sendPaymentConfirmedEmail_test_(email, companyName, receiptNo, totalCount, totalAmount, paymentMethodType) {
  var paymentMethodLabel = getPaymentMethodDisplayName_(paymentMethodType);
  var confirmedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日 HH:mm');

  var subject = '【デタウリ.Detauri】入金を確認しました（受付番号：' + receiptNo + '）';
  var body = companyName + ' 様\n\n'
    + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
    + 'お客様のご入金を確認いたしました。ご注文が確定しましたのでお知らせいたします。\n\n'
    + '受付番号：' + receiptNo + '\n'
    + '入金確認日時：' + confirmedAt + '\n'
    + '合計点数：' + totalCount + '点\n'
    + '合計金額：' + Number(totalAmount).toLocaleString() + '円（税込）\n'
    + '決済方法：' + paymentMethodLabel + '\n';

  var htmlBody = buildHtmlEmail_({
    greeting: companyName + ' 様',
    lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\nお客様のご入金を確認いたしました。ご注文が確定しましたのでお知らせいたします。',
    sections: [
      {
        title: 'ご注文内容',
        rows: [
          { label: '受付番号', value: String(receiptNo) },
          { label: '入金確認日時', value: confirmedAt },
          { label: '会社名/氏名', value: companyName },
          { label: '合計点数', value: totalCount + '点' },
          { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円（税込）' },
          { label: '決済方法', value: paymentMethodLabel }
        ]
      },
      {
        title: '',
        text: '商品の発送準備を進めてまいります。\n発送が完了しましたら、追跡番号とともにメールでお知らせいたします。'
      }
    ],
    notes: ['このメールは自動送信です。', 'ご注文確定後のキャンセル・変更はできません。']
  });

  GmailApp.sendEmail(email, subject, body, { from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL, htmlBody: htmlBody });
}

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

        // Q列(17): 入金確認ステータスを更新
        var paymentConfirmCol = 17;  // Q列
        var statusText = paymentStatus === 'paid' ? '未対応' : (paymentStatus === 'pending' ? '入金待ち' : '未対応');
        sheet.getRange(row, paymentConfirmCol).setValue(statusText);

        // O列(15): 決済方法（日本語表示名）
        if (paymentMethod) {
          var paymentMethodCol = 15;  // O列
          sheet.getRange(row, paymentMethodCol).setValue(getPaymentMethodDisplayName_(paymentMethod));
        }

        // AB列(28): 受注通知フラグ — 入金完了時（未対応に変更時）にFALSEをセット
        if (statusText === '未対応') {
          var notifyFlagCol = 28;  // AB列
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
  // 暗号学的に安全なシークレットキーを生成（UUID v4ベース）
  var webhookSecret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');

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
        var paymentMethodType = extractPaymentMethodType_(response.payment);

        // Paidy: authorized → 自動キャプチャ
        if (paymentMethodType === 'paidy' && status === 'authorized') {
          console.log('checkPendingOrders: [' + receiptNo + '] Paidy自動キャプチャ実行');
          var capResult = capturePayment_(response.payment.id);
          if (capResult && !capResult.error) {
            console.log('checkPendingOrders: [' + receiptNo + '] Paidyキャプチャ成功');
          } else {
            console.error('checkPendingOrders: [' + receiptNo + '] Paidyキャプチャ失敗', capResult);
          }
        }

        // コンビニ・銀行振込: authorized=入金待ち、captured/paid=未対応（入金済み）
        var paymentStatus = '未対応';
        if ((paymentMethodType === 'konbini' || paymentMethodType === 'bank_transfer') && status === 'authorized') {
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

/**
 * KOMOJU支払い復旧: PENDING_ORDER消失時に依頼管理シートへ手動登録
 * GASエディタから実行
 */
function recoverKomojuPayment() {
  // === 復旧対象 ===
  var targets = [
    { paymentId: '12r1rrkxu3zrvtyp4maq1frjv', deleteReceiptNo: '20260307191211-994' },
    { paymentId: '84egj84yy6obfgvbubnaq48km', deleteReceiptNo: '20260306150832-592' },
  ];

  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName('依頼管理');
  if (!reqSh) { console.log('依頼管理シートなし'); return; }

  for (var t = 0; t < targets.length; t++) {
    var target = targets[t];
    console.log('');
    console.log('========== 復旧開始: ' + target.paymentId + ' ==========');

    // 0. 既存のミニマル行を削除
    if (target.deleteReceiptNo) {
      var lastRow = reqSh.getLastRow();
      if (lastRow >= 2) {
        var receipts = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
        for (var d = receipts.length - 1; d >= 0; d--) {
          if (String(receipts[d][0]).trim() === target.deleteReceiptNo) {
            reqSh.deleteRow(d + 2);
            console.log('ミニマル行を削除: 行' + (d + 2) + ' 受付番号=' + target.deleteReceiptNo);
            break;
          }
        }
      }
    }

    // 1. KOMOJU APIから決済情報取得
    var payment = fetchPaymentFromApi_(target.paymentId);
    if (!payment) { console.log('KOMOJU APIから取得できません: ' + target.paymentId); continue; }
    console.log('KOMOJU status: ' + payment.status + ', amount: ¥' + payment.amount);
    var meta = payment.metadata || {};
    console.log('metadata: ' + JSON.stringify(meta));

    // 2. paymentToken解決
    var paymentToken = resolvePaymentToken_(payment);
    console.log('paymentToken: ' + (paymentToken || '(null)'));

    // 3. confirmPaymentAndCreateOrderで完全復旧を試みる（D1からデータ取得）
    if (paymentToken) {
      var paymentMethodType = extractPaymentMethodType_(payment);
      var deferredMethods = { 'konbini': true, 'bank_transfer': true, 'pay_easy': true, 'paidy': true };
      var paymentStatus = '未対応';
      if (deferredMethods[paymentMethodType] && payment.status !== 'captured') {
        paymentStatus = '入金待ち';
      }
      console.log('confirmPaymentAndCreateOrder試行: token=' + paymentToken + ', method=' + paymentMethodType);
      var confirmResult = confirmPaymentAndCreateOrder(paymentToken, paymentStatus, paymentMethodType, target.paymentId);
      if (confirmResult && confirmResult.ok) {
        console.log('=== 完全復旧成功 === 受付番号: ' + (confirmResult.receiptNo || paymentToken));
        continue;
      }
      console.log('confirmPaymentAndCreateOrder失敗: ' + (confirmResult ? confirmResult.message : 'null'));
    }

    // 4. フォールバック: メタデータからミニマル復旧
    console.log('ミニマル復旧にフォールバック');
    var receiptNo = u_makeReceiptNo_();
    var email = String(meta.email || '').trim().toLowerCase();
    var custInfo = { postal: '', address: '', phone: '' };
    if (email) {
      try {
        var custSh = orderSs.getSheetByName('顧客管理');
        if (custSh) {
          var custLast = custSh.getLastRow();
          if (custLast >= 2) {
            var custData = custSh.getRange(2, 1, custLast - 1, 8).getValues();
            for (var c = 0; c < custData.length; c++) {
              if (String(custData[c][CUSTOMER_SHEET_COLS.EMAIL] || '').trim().toLowerCase() === email) {
                custInfo.postal = String(custData[c][CUSTOMER_SHEET_COLS.POSTAL] || '');
                custInfo.address = String(custData[c][CUSTOMER_SHEET_COLS.ADDRESS] || '');
                custInfo.phone = String(custData[c][CUSTOMER_SHEET_COLS.PHONE] || '');
                break;
              }
            }
          }
        }
      } catch (e) { console.error('顧客情報取得エラー:', e); }
    }

    var productAmount = +meta.product_amount || 0;
    var shippingAmount = +meta.shipping_amount || 0;
    var now = new Date();
    var lastRow2 = reqSh.getLastRow();
    var row = [
      receiptNo, now, meta.company_name || '', meta.email || '',
      custInfo.postal, custInfo.address, custInfo.phone,
      '※KOMOJU復旧（商品情報なし）', '', '', '',
      productAmount, '', shippingAmount,
      getPaymentMethodDisplayName_(payment.payment_details ? payment.payment_details.type : ''),
      target.paymentId,
      payment.status === 'captured' ? '未対応' : '入金待ち',
      '', '未着手', '', '', '依頼中', '', '未', '未', '', '',
      false, '',
      'KOMOJU復旧: ' + payment.status + ' ¥' + payment.amount,
      '', now, 'デタウリ'
    ];
    reqSh.getRange(lastRow2 + 1, 1, 1, row.length).setValues([row]);
    console.log('=== ミニマル復旧完了 === 受付番号: ' + receiptNo + ' ※商品情報は手動入力必要');
  }

  console.log('');
  console.log('========== 全件処理完了 ==========');
}

/**
 * KOMOJUセッションIDからペンディングデータを探して商品情報を復旧
 * GASエディタから実行: findAndRestorePendingOrder()
 */
function findAndRestorePendingOrder() {
  var komojuId = '84egj84yy6obfgvbubnaq48km';
  var secretKey = getKomojuSecretKey_();

  // 1. まずpayment IDとして取得を試みる
  var resp = komojuRequest_('GET', '/payments/' + komojuId, null, secretKey);
  if (!resp || resp.error) {
    console.log('payment取得失敗、sessionとして試行...');
    resp = komojuRequest_('GET', '/sessions/' + komojuId, null, secretKey);
    if (!resp || resp.error) {
      console.log('session取得も失敗:', JSON.stringify(resp));
      // 3. PropertiesServiceを直接検索
      console.log('PropertiesServiceを直接検索します...');
      var props = PropertiesService.getScriptProperties();
      var allProps = props.getProperties();
      var found = false;
      for (var key in allProps) {
        if (key.indexOf('PENDING_ORDER_') === 0 || key.indexOf('PAYMENT_') === 0) {
          var val = allProps[key];
          if (val.indexOf(komojuId) !== -1) {
            console.log('Found in ' + key + ':', val.substring(0, 500));
            found = true;
          }
        }
      }
      if (!found) console.log('PropertiesServiceにも見つかりません');
      return;
    }
  }

  console.log('取得成功 - status:', resp.status);
  console.log('external_order_num:', resp.external_order_num);
  console.log('metadata:', JSON.stringify(resp.metadata || {}));

  var paymentToken = resp.external_order_num
    || (resp.metadata ? (resp.metadata.payment_token || resp.metadata.receipt_no) : null);
  if (!paymentToken) { console.log('paymentToken not found'); return; }
  console.log('paymentToken:', paymentToken);

  // 2. PENDING_ORDER_ を探す
  var props = PropertiesService.getScriptProperties();
  var pendingStr = props.getProperty('PENDING_ORDER_' + paymentToken);
  if (!pendingStr) {
    console.log('PENDING_ORDER not found for: ' + paymentToken);
    console.log('KVバックアップも期限切れの可能性。手動で商品情報を入力してください。');
    return;
  }

  var pending = JSON.parse(pendingStr);
  console.log('=== PENDING ORDER FOUND ===');
  console.log('ids:', JSON.stringify(pending.ids || []));
  console.log('selectionList:', pending.selectionList || '');
  console.log('totalCount:', pending.totalCount || 0);

  // 3. 依頼管理シートで受付番号を探してH列・J列・K列を更新
  var receiptNo = paymentToken;
  // PAYMENT_セッションにreceiptNoがあればそちらを使用
  var paymentStr = props.getProperty('PAYMENT_' + paymentToken);
  if (paymentStr) {
    var paymentData = JSON.parse(paymentStr);
    if (paymentData.receiptNo) receiptNo = paymentData.receiptNo;
  }
  console.log('受付番号:', receiptNo);

  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName('依頼管理');
  if (!reqSh) { console.log('依頼管理シートなし'); return; }

  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('依頼管理にデータなし'); return; }

  var receipts = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var targetRow = -1;
  for (var i = 0; i < receipts.length; i++) {
    if (String(receipts[i][0]).trim() === receiptNo) {
      targetRow = i + 2;
      break;
    }
  }
  if (targetRow === -1) {
    console.log('受付番号 ' + receiptNo + ' が依頼管理に見つかりません');
    return;
  }

  // 商品名を構築
  var productName = '';
  var itemDetails = pending.itemDetails || [];
  if (itemDetails.length > 0) {
    productName = itemDetails.map(function(item) {
      return (item.brand || '') + ' ' + (item.category || '') + ' ' + (item.managedId || '');
    }).join('\n');
  } else if (pending.templateText) {
    productName = pending.templateText;
  } else {
    productName = (pending.ids || []).join('、');
  }

  var selectionList = pending.selectionList || (pending.ids || []).join('、');
  var totalCount = pending.totalCount || (pending.ids || []).length;
  var remarks = pending.form ? (pending.form.remarks || pending.form.memo || '') : '';

  // H列=商品名(8), J列=選択リスト(10), K列=合計点数(11)
  reqSh.getRange(targetRow, 8).setValue(productName);   // H列
  reqSh.getRange(targetRow, 10).setValue(selectionList); // J列
  reqSh.getRange(targetRow, 11).setValue(totalCount);    // K列
  if (remarks) {
    var currentAD = reqSh.getRange(targetRow, 30).getValue();
    reqSh.getRange(targetRow, 30).setValue(String(currentAD || '') + '\n備考: ' + remarks); // AD列
  }

  console.log('=== 復旧完了 ===');
  console.log('行:', targetRow);
  console.log('商品名:', productName.substring(0, 100));
  console.log('選択リスト:', selectionList.substring(0, 100));
  console.log('点数:', totalCount);
  if (remarks) console.log('備考:', remarks);
}

/**
 * 受付番号に関連するPropertiesServiceのデータを全てダンプ
 * GASエディタから実行: dumpOrderData()
 */
function dumpOrderData() {
  var receiptNo = '20260306150832-592';
  var props = PropertiesService.getScriptProperties();

  // 1. PAYMENT_ セッション
  var paymentStr = props.getProperty('PAYMENT_' + receiptNo);
  console.log('=== PAYMENT_' + receiptNo + ' ===');
  console.log(paymentStr || '(not found)');

  // 2. PENDING_ORDER_
  var pendingStr = props.getProperty('PENDING_ORDER_' + receiptNo);
  console.log('=== PENDING_ORDER_' + receiptNo + ' ===');
  console.log(pendingStr || '(not found)');

  // 3. holdState から当時のデータを探す
  var orderSs = sh_getOrderSs_();
  var holdState = st_getHoldState_(orderSs) || {};
  var holdItems = holdState.items || {};
  console.log('=== holdState内の該当データ ===');
  var foundHold = false;
  for (var id in holdItems) {
    if (holdItems[id].receiptNo === receiptNo) {
      console.log(id + ':', JSON.stringify(holdItems[id]));
      foundHold = true;
    }
  }
  if (!foundHold) console.log('(holdStateに該当なし)');

  // 4. openState（依頼中）から探す
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = openState.items || {};
  console.log('=== openState内の該当データ ===');
  var foundOpen = false;
  for (var oid in openItems) {
    if (openItems[oid].receiptNo === receiptNo) {
      console.log(oid + ':', JSON.stringify(openItems[oid]));
      foundOpen = true;
    }
  }
  if (!foundOpen) console.log('(openStateに該当なし)');

  // 5. PropertiesService全体から受付番号を含むキーを検索
  console.log('=== Properties全検索 ===');
  var all = props.getProperties();
  var count = 0;
  for (var key in all) {
    if (all[key].indexOf(receiptNo) !== -1) {
      console.log(key + ':', all[key].substring(0, 500));
      count++;
    }
  }
  if (count === 0) console.log('(受付番号を含むプロパティなし)');
}
