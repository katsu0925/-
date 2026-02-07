/**
 * KOMOJU.gs
 *
 * KOMOJU決済連携モジュール
 * クレジットカード、コンビニ払い、銀行振込、PayPay等に対応
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
  // APIエンドポイント
  // 本番環境: 'https://komoju.com/api/v1'
  // テスト環境: 'https://sandbox.komoju.com/api/v1'
  apiUrl: 'https://sandbox.komoju.com/api/v1',  // テストモード有効

  // 対応決済方法
  paymentMethods: [
    'credit_card',      // クレジットカード
    'konbini',          // コンビニ払い
    'bank_transfer',    // 銀行振込
    'paypay',           // PayPay
    'linepay',          // LINE Pay
    'merpay'            // メルペイ
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
        receipt_no: receiptNo,
        company_name: String(info.companyName || ''),
        email: email
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

  // 依頼管理シートのステータスを更新
  updateOrderPaymentStatus_(receiptNo, 'paid', payment.payment_method_type);

  // 確認メール送信（オプション）
  // sendPaymentConfirmationEmail_(receiptNo, saved);

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
 * Secret Keyを取得
 */
function getKomojuSecretKey_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('KOMOJU_SECRET_KEY');
  } catch (e) {
    return null;
  }
}

/**
 * リターンURLを取得
 */
function getReturnUrl_() {
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
 * 列構成: T列(20)=入金確認
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

        // T列(20): 入金確認ステータスを更新
        var paymentConfirmCol = 20;  // T列
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
 * KOMOJU APIキーを設定
 * 使い方:
 * 1. この関数の YOUR_SECRET_KEY_HERE を実際のキーに置き換え
 * 2. GASエディタでこの関数を実行
 * 3. 実行後、キーを YOUR_SECRET_KEY_HERE に戻す（セキュリティのため）
 */
function setKomojuSecretKey() {
  var secretKey = 'YOUR_SECRET_KEY_HERE';  // ← ここにKOMOJUのSecret Keyを入力

  if (secretKey === 'YOUR_SECRET_KEY_HERE') {
    console.log('ERROR: secretKey を実際のKOMOJU Secret Keyに置き換えてください');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('KOMOJU_SECRET_KEY', secretKey);
  console.log('SUCCESS: KOMOJU_SECRET_KEY を設定しました');
  console.log('セキュリティのため、コード内のキーを YOUR_SECRET_KEY_HERE に戻すことをお勧めします');
}

/**
 * KOMOJU APIキーが設定されているか確認
 */
function checkKomojuSecretKey() {
  var key = PropertiesService.getScriptProperties().getProperty('KOMOJU_SECRET_KEY');
  if (key) {
    console.log('KOMOJU_SECRET_KEY: 設定済み（' + key.substring(0, 8) + '...）');
  } else {
    console.log('KOMOJU_SECRET_KEY: 未設定');
  }
}

/**
 * KOMOJU APIキーを削除
 */
function deleteKomojuSecretKey() {
  PropertiesService.getScriptProperties().deleteProperty('KOMOJU_SECRET_KEY');
  console.log('KOMOJU_SECRET_KEY を削除しました');
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
