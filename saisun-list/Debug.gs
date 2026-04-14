// =====================================================
// Debug.gs — デバッグ・調査ツール集約
// GASエディタから手動実行して受付番号・管理番号で調査する
// =====================================================

/**
 * KOMOJU Session Pay APIを直接呼んでPaidyの422エラー内容を確認
 */
function debugPaidyPayment() {
  var secretKey = getKomojuSecretKey_();
  if (!secretKey) { console.log('KOMOJU APIキー未設定'); return; }

  // 直近のセッションを取得
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var latest = null;
  for (var key in allProps) {
    if (key.indexOf('PAYMENT_') === 0) {
      try {
        var val = JSON.parse(allProps[key]);
        if (!latest || (val.createdAt || '') > (latest.createdAt || '')) {
          val._key = key;
          latest = val;
        }
      } catch (e) {}
    }
  }

  if (!latest || !latest.sessionId) {
    console.log('セッションが見つかりません');
    return;
  }

  console.log('最新セッション: ' + latest._key + ', sessionId=' + latest.sessionId);

  // セッション詳細を取得
  var session = komojuRequest_('GET', '/sessions/' + latest.sessionId, null, secretKey);
  console.log('Session status: ' + (session.status || 'N/A'));
  console.log('Session customer_email: ' + (session.customer_email || 'N/A'));
  console.log('Session customer_family_name: ' + (session.customer_family_name || 'N/A'));
  console.log('Session payment_data: ' + JSON.stringify(session.payment_data || null));
  console.log('Session full keys: ' + Object.keys(session).join(', '));

  // Session Pay APIでPaidy決済を直接実行
  // テスト1: payment_detailsにフラット形式で配送先
  var payData = {
    payment_details: {
      type: 'paidy',
      email: 'nsdktts1030@gmail.com',
      shipping_address_line1: '大阪府大阪市中央区1-1-1',
      shipping_address_line2: '',
      shipping_address_city: '大阪市',
      shipping_address_state: '大阪府',
      shipping_address_zip: '540-0001',
      shipping_address_country: 'JP'
    }
  };
  console.log('\n=== Session Pay API テスト (shipping_address付き) ===');
  console.log('POST /sessions/' + latest.sessionId + '/pay');
  console.log('Request: ' + JSON.stringify(payData));

  var result = komojuRequest_('POST', '/sessions/' + latest.sessionId + '/pay', payData, secretKey);
  console.log('Response: ' + JSON.stringify(result, null, 2));
}

/**
 * KOMOJUセッションの詳細を確認（Paidyデバッグ用）
 * GASエディタから手動実行
 */
function debugKomojuSession() {
  var secretKey = getKomojuSecretKey_();
  if (!secretKey) { console.log('KOMOJU APIキー未設定'); return; }

  // ScriptPropertiesから直近のPAYMENT_セッションを探す
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var paymentKeys = [];
  for (var key in allProps) {
    if (key.indexOf('PAYMENT_') === 0) {
      try {
        var val = JSON.parse(allProps[key]);
        val._key = key;
        paymentKeys.push(val);
      } catch (e) {}
    }
  }

  // 作成日時の新しい順にソート
  paymentKeys.sort(function(a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  // 直近3件を詳細表示
  var count = Math.min(paymentKeys.length, 3);
  console.log('=== 直近 ' + count + ' 件のPAYMENTセッション ===');

  for (var i = 0; i < count; i++) {
    var saved = paymentKeys[i];
    console.log('\n--- [' + (i + 1) + '] ' + saved._key + ' ---');
    console.log('ローカル保存データ: ' + JSON.stringify(saved, null, 2));

    if (saved.sessionId) {
      var session = komojuRequest_('GET', '/sessions/' + saved.sessionId, null, secretKey);
      if (session && !session.error) {
        console.log('KOMOJUステータス: ' + session.status);
        console.log('金額: ¥' + session.amount);
        console.log('Customer: ' + JSON.stringify(session.customer || '(なし)'));
        console.log('customer_email: ' + (session.customer_email || '(なし)'));
        console.log('customer_family_name: ' + (session.customer_family_name || '(なし)'));
        console.log('customer_given_name: ' + (session.customer_given_name || '(なし)'));
        console.log('Payment Types: ' + JSON.stringify(session.payment_types || []));
        console.log('payment_data: ' + JSON.stringify(session.payment_data || '(なし)'));
        console.log('Metadata: ' + JSON.stringify(session.metadata || {}));
        console.log('Session全キー: ' + Object.keys(session).join(', '));
        if (session.payment) {
          console.log('Payment: status=' + session.payment.status +
            ', type=' + (session.payment.payment_details ? session.payment.payment_details.type : 'N/A'));
        } else {
          console.log('Payment: (未決済)');
        }
      } else {
        console.log('KOMOJU APIエラー: ' + JSON.stringify(session));
      }
    }
  }

  if (paymentKeys.length === 0) {
    console.log('PAYMENT_セッションが見つかりません');
  }

  // 直近のPaidy決済のpayment詳細を取得
  for (var j = 0; j < count; j++) {
    var s = paymentKeys[j];
    if (s.paymentId) {
      console.log('\n=== Payment詳細: ' + s.paymentId + ' ===');
      var payment = komojuRequest_('GET', '/payments/' + s.paymentId, null, secretKey);
      if (payment && !payment.error) {
        console.log('Status: ' + payment.status);
        console.log('Amount: ' + payment.amount);
        console.log('Payment Details Type: ' + (payment.payment_details ? payment.payment_details.type : 'N/A'));
        console.log('Payment Details: ' + JSON.stringify(payment.payment_details || {}));
        console.log('Customer Email: ' + (payment.customer_email || 'N/A'));
        console.log('Customer Name: ' + (payment.customer_name || 'N/A'));
        console.log('Customer Phone: ' + (payment.customer_phone || 'N/A'));
        console.log('Error: ' + JSON.stringify(payment.payment_method_fee || null));
        console.log('Full payment object keys: ' + Object.keys(payment).join(', '));
      } else {
        console.log('Payment取得エラー: ' + JSON.stringify(payment));
      }
    }
  }
}

/**
 * 受付番号で注文の全情報を表示
 * メール送信状況・決済状態・依頼中状態を一括確認
 */
function debugLookupByReceipt(receiptNo) {
  receiptNo = receiptNo || '20260318113100-626';

  if (!receiptNo) { console.log('受付番号を指定してください'); return; }

  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  if (!reqSh) { console.error('依頼管理シートなし'); return; }

  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('データなし'); return; }

  var data = reqSh.getRange(2, 1, lastRow - 1, REQUEST_SHEET_COLS.ITEM_PRICES || 35).getValues();
  var row = null, rowIdx = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '').trim() === receiptNo) {
      row = data[i]; rowIdx = i + 2; break;
    }
  }
  if (!row) { console.error('受付番号が見つかりません: ' + receiptNo); return; }

  var email = String(row[REQUEST_SHEET_COLS.CONTACT - 1] || '').trim();
  var companyName = String(row[REQUEST_SHEET_COLS.COMPANY_NAME - 1] || '').trim();
  var status = String(row[REQUEST_SHEET_COLS.STATUS - 1] || '').trim();
  var paymentMethod = String(row[REQUEST_SHEET_COLS.PAYMENT_METHOD - 1] || '').trim();
  var paymentId = String(row[REQUEST_SHEET_COLS.PAYMENT_ID - 1] || '').trim();
  var payment = String(row[REQUEST_SHEET_COLS.PAYMENT - 1] || '').trim();
  var shipStatus = String(row[REQUEST_SHEET_COLS.SHIP_STATUS - 1] || '').trim();
  var notifyFlag = row[REQUEST_SHEET_COLS.NOTIFY_FLAG - 1];
  var totalCount = Number(row[REQUEST_SHEET_COLS.TOTAL_COUNT - 1]) || 0;
  var totalAmount = Number(row[REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;
  var selectionList = String(row[REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '').trim();
  var productNames = String(row[REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || '').trim();
  var datetime = row[REQUEST_SHEET_COLS.DATETIME - 1];
  var channel = String(row[REQUEST_SHEET_COLS.CHANNEL - 1] || '').trim();

  // === 注文情報 ===
  console.log('========== 注文情報 ==========');
  console.log('受付番号: ' + receiptNo + ' (行' + rowIdx + ')');
  console.log('注文日時: ' + datetime);
  console.log('チャネル: ' + channel);
  console.log('会社名: ' + companyName);
  console.log('メール: ' + email);
  console.log('商品名: ' + productNames);
  console.log('選択リスト(J列): ' + selectionList);
  console.log('点数(K列): ' + totalCount + ' / 金額(L列): ¥' + totalAmount);
  console.log('決済方法: ' + paymentMethod);
  console.log('決済ID: ' + paymentId);
  console.log('入金確認(Q列): ' + payment);
  console.log('発送ステータス(S列): ' + shipStatus);
  console.log('ステータス(V列): ' + status);
  console.log('受注通知フラグ(AB列): ' + notifyFlag);

  // === openState確認 ===
  console.log('========== 依頼中状態 ==========');
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  var openForReceipt = [];
  for (var id in openItems) {
    if (openItems[id] && String(openItems[id].receiptNo || '') === receiptNo) {
      openForReceipt.push(id);
    }
  }
  console.log('openState内の該当商品: ' + openForReceipt.length + '点');
  if (openForReceipt.length > 0) {
    console.log('  ' + openForReceipt.join('、'));
  }

  // === メール送信状況 ===
  console.log('========== メール送信状況（推定） ==========');
  console.log('1. 注文受付メール: ' + (notifyFlag ? '✅ 送信済み' : '⚠ フラグ未設定'));

  var deferredMethods = { 'konbini': true, 'bank_transfer': true, 'pay_easy': true, 'paidy': true, 'コンビニ払い': true, '銀行振込': true, 'ペイジー': true };
  if (deferredMethods[paymentMethod]) {
    if (payment === '入金待ち') {
      console.log('2. 入金確認メール: ❌ 未送信（まだ入金待ち）');
    } else {
      console.log('2. 入金確認メール: ✅ 送信済み（' + payment + '）');
    }

    var orderDateObj = datetime instanceof Date ? datetime : new Date(datetime);
    var deadline = new Date(orderDateObj);
    deadline.setDate(deadline.getDate() + (typeof PAYMENT_DEADLINE_DAYS !== 'undefined' ? PAYMENT_DEADLINE_DAYS : 7));
    console.log('3. 入金期限: ' + Utilities.formatDate(deadline, 'Asia/Tokyo', 'yyyy-MM-dd'));
  } else {
    console.log('2. 入金確認メール: 対象外（即時決済: ' + paymentMethod + '）');
    console.log('3. リマインドメール: 対象外');
  }

  if (shipStatus === '発送済み' || shipStatus === '発送済') {
    console.log('4. 発送通知メール: ✅ 送信済み');
  } else {
    console.log('4. 発送通知メール: ⏳ 未発送');
  }

  // === Gmail確認 ===
  if (email && email.indexOf('@') >= 0) {
    console.log('========== Gmail送信履歴 ==========');
    try {
      var threads = GmailApp.search('to:' + email + ' subject:' + receiptNo, 0, 10);
      if (threads.length === 0) {
        console.log('⚠ Gmailに該当メールなし');
      } else {
        for (var t = 0; t < threads.length; t++) {
          var msgs = threads[t].getMessages();
          for (var m = 0; m < msgs.length; m++) {
            console.log('  [' + Utilities.formatDate(msgs[m].getDate(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + '] ' + msgs[m].getSubject());
          }
        }
      }
    } catch (e) {
      console.log('Gmail検索エラー: ' + e.message);
    }
  } else {
    console.log('⚠ メールアドレスが空または不正 → メール送信されていません');
  }

  // === KOMOJU決済セッション ===
  console.log('========== 決済セッション ==========');
  try {
    var session = getPaymentSession_(receiptNo);
    if (session) {
      console.log('KOMOJUセッション: あり');
      console.log('  sessionId: ' + (session.sessionId || ''));
      console.log('  status: ' + (session.status || ''));
    } else {
      console.log('KOMOJUセッション: なし（期限切れ or 即時決済）');
    }
  } catch (e) {
    console.log('セッション取得エラー: ' + e.message);
  }
}

/**
 * 管理番号で商品の状態を総合表示
 * データ1・商品管理・holdState・openState を横断確認
 */
function debugLookupByManagedId(targetId) {
  targetId = targetId || 'zB1012';

  if (!targetId) { console.log('管理番号を指定してください'); return; }

  console.log('========== 商品調査: ' + targetId + ' ==========');

  // 商品管理シートでの状態（既存のdebugProductSyncを利用）
  debugProductSync(targetId);

  // holdState / openState 確認
  console.log('========== 確保/依頼中状態 ==========');
  var orderSs = sh_getOrderSs_();
  var holdState = st_getHoldState_(orderSs) || {};
  var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};

  if (holdItems[targetId]) {
    var h = holdItems[targetId];
    console.log('確保中(holdState): YES');
    console.log('  userKey: ' + (h.userKey || ''));
    console.log('  createdAt: ' + (h.createdAtMs ? new Date(h.createdAtMs).toLocaleString('ja-JP') : ''));
  } else {
    console.log('確保中(holdState): NO');
  }

  if (openItems[targetId]) {
    var o = openItems[targetId];
    console.log('依頼中(openState): YES');
    console.log('  受付番号: ' + (o.receiptNo || ''));
    console.log('  status: ' + (o.status || ''));
    console.log('  createdAt: ' + (o.createdAtMs ? new Date(o.createdAtMs).toLocaleString('ja-JP') : (o.at ? new Date(o.at).toLocaleString('ja-JP') : '')));
  } else {
    console.log('依頼中(openState): NO');
  }

  // 依頼管理シートでJ列に含まれる注文を検索
  console.log('========== 依頼管理シートでの出現 ==========');
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  if (reqSh) {
    var lastRow = reqSh.getLastRow();
    if (lastRow >= 2) {
      var reqData = reqSh.getRange(2, 1, lastRow - 1, REQUEST_SHEET_COLS.STATUS || 22).getValues();
      var foundCount = 0;
      for (var i = 0; i < reqData.length; i++) {
        var jCol = String(reqData[i][REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '');
        if (jCol.indexOf(targetId) !== -1) {
          foundCount++;
          var rn = String(reqData[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '');
          var st = String(reqData[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
          console.log('  受付番号: ' + rn + ' / ステータス: ' + st + ' (行' + (i + 2) + ')');
        }
      }
      if (foundCount === 0) console.log('  依頼管理のJ列に含まれていません');
    }
  }

  // 商品詳細
  console.log('========== 商品詳細 ==========');
  try {
    var detail = pr_getProductDetail_(targetId);
    if (detail) {
      console.log('  品名: ' + (detail.title || ''));
      console.log('  ブランド: ' + (detail.brand || ''));
      console.log('  カテゴリ: ' + (detail.category || ''));
      console.log('  価格: ¥' + (detail.price || 0));
      console.log('  発送方法: ' + (detail.shippingMethod || ''));
    } else {
      console.log('  商品詳細取得できず（キャッシュに存在しない）');
    }
  } catch (e) {
    console.log('  商品詳細取得エラー: ' + e.message);
  }
}

/**
 * キーワードで依頼管理シート・KOMOJU API・ペンディング注文を横断検索
 * 決済ID、メール、会社名、受付番号、KOMOJU確認番号 等なんでも
 */
function debugSearch(keyword) {
  keyword = keyword || '46545894360';

  if (!keyword) { console.log('検索キーワードを指定してください'); return; }
  console.log('========== 横断検索: "' + keyword + '" ==========');

  // === 1. 依頼管理シート全列を検索 ===
  console.log('--- 依頼管理シート ---');
  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  var foundReceipts = [];
  if (reqSh) {
    var lastRow = reqSh.getLastRow();
    var lastCol = reqSh.getLastColumn();
    if (lastRow >= 2 && lastCol > 0) {
      var allData = reqSh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
      for (var i = 0; i < allData.length; i++) {
        var rowStr = allData[i].join('|');
        if (rowStr.indexOf(keyword) !== -1) {
          var rn = allData[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '';
          var company = allData[i][REQUEST_SHEET_COLS.COMPANY_NAME - 1] || '';
          var email = allData[i][REQUEST_SHEET_COLS.CONTACT - 1] || '';
          var product = allData[i][REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || '';
          var payId = allData[i][REQUEST_SHEET_COLS.PAYMENT_ID - 1] || '';
          var payMethod = allData[i][REQUEST_SHEET_COLS.PAYMENT_METHOD - 1] || '';
          var payment = allData[i][REQUEST_SHEET_COLS.PAYMENT - 1] || '';
          var status = allData[i][REQUEST_SHEET_COLS.STATUS - 1] || '';
          var amount = allData[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1] || '';
          var datetime = allData[i][REQUEST_SHEET_COLS.DATETIME - 1] || '';
          console.log('  [行' + (i + 2) + '] 受付番号: ' + rn);
          console.log('    会社名: ' + company + ' / メール: ' + email);
          console.log('    商品: ' + product.substring(0, 80));
          console.log('    決済ID(P列): ' + payId + ' / 決済方法: ' + payMethod);
          console.log('    入金(Q列): ' + payment + ' / ステータス(V列): ' + status);
          console.log('    金額: ¥' + amount + ' / 日時: ' + datetime);
          // マッチした列を特定
          var matchCols = [];
          for (var c = 0; c < allData[i].length; c++) {
            if (String(allData[i][c]).indexOf(keyword) !== -1) {
              matchCols.push(String.fromCharCode(65 + c) + '列');
            }
          }
          console.log('    マッチ列: ' + matchCols.join(', '));
          foundReceipts.push(rn);
        }
      }
    }
  }
  if (foundReceipts.length === 0) {
    console.log('  依頼管理シートにヒットなし');
  } else {
    console.log('  計 ' + foundReceipts.length + '件ヒット');
  }

  // === 2. ペンディング注文を検索 ===
  console.log('--- ペンディング注文 ---');
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var pendingFound = 0;
  for (var key in allProps) {
    if ((key.indexOf('PENDING_ORDER_') === 0 || key.indexOf('PAYMENT_') === 0) && allProps[key].indexOf(keyword) !== -1) {
      pendingFound++;
      console.log('  ' + key + ': ' + allProps[key].substring(0, 300));
    }
  }
  if (pendingFound === 0) console.log('  ペンディング注文にヒットなし');

  // === 3. KOMOJU API検索 ===
  console.log('--- KOMOJU API ---');
  try {
    var secretKey = getKomojuSecretKey_();
    if (!secretKey) { console.log('  KOMOJU APIキー未設定'); }
    else {
      // payment IDとして取得
      var resp = komojuRequest_('GET', '/payments/' + keyword, null, secretKey);
      if (resp && !resp.error && resp.id) {
        console.log('  決済として発見:');
        console.log('    ID: ' + resp.id);
        console.log('    status: ' + resp.status);
        console.log('    amount: ¥' + resp.amount);
        console.log('    external_order_num: ' + (resp.external_order_num || ''));
        console.log('    metadata: ' + JSON.stringify(resp.metadata || {}));
        console.log('    payment_details: ' + JSON.stringify(resp.payment_details || {}).substring(0, 200));
      } else {
        console.log('  決済IDとしてはヒットなし');
      }

      // session IDとして取得
      var resp2 = komojuRequest_('GET', '/sessions/' + keyword, null, secretKey);
      if (resp2 && !resp2.error && resp2.id) {
        console.log('  セッションとして発見:');
        console.log('    ID: ' + resp2.id);
        console.log('    status: ' + resp2.status);
        console.log('    amount: ¥' + resp2.amount);
        console.log('    external_order_num: ' + (resp2.external_order_num || ''));
        console.log('    metadata: ' + JSON.stringify(resp2.metadata || {}));
      } else {
        console.log('  セッションIDとしてはヒットなし');
      }

      // external_order_numとして検索
      var resp3 = komojuRequest_('GET', '/sessions?external_order_num=' + encodeURIComponent(keyword), null, secretKey);
      if (resp3 && resp3.data && resp3.data.length > 0) {
        console.log('  external_order_numとして ' + resp3.data.length + '件発見:');
        for (var s = 0; s < resp3.data.length; s++) {
          var sess = resp3.data[s];
          console.log('    [' + (s + 1) + '] session: ' + sess.id + ' / status: ' + sess.status + ' / ¥' + sess.amount);
        }
      } else {
        console.log('  external_order_numとしてはヒットなし');
      }
    }
  } catch (e) {
    console.log('  KOMOJU APIエラー: ' + e.message);
  }

  // === 4. 顧客管理シート検索 ===
  console.log('--- 顧客管理シート ---');
  try {
    var custSh = getCustomerSheet_();
    if (custSh) {
      var custLastRow = custSh.getLastRow();
      if (custLastRow >= 2) {
        var custData = custSh.getRange(2, 1, custLastRow - 1, custSh.getLastColumn()).getDisplayValues();
        for (var ci = 0; ci < custData.length; ci++) {
          var custRowStr = custData[ci].join('|');
          if (custRowStr.indexOf(keyword) !== -1) {
            console.log('  [行' + (ci + 2) + '] ID: ' + custData[ci][0] + ' / メール: ' + custData[ci][1] + ' / 会社名: ' + custData[ci][3]);
          }
        }
      }
    }
  } catch (e) {
    console.log('  顧客管理シート検索エラー: ' + e.message);
  }

  // === 5. KOMOJU API: 最近のコンビニ決済一覧から検索 ===
  console.log('--- KOMOJU 最近の決済から検索 ---');
  try {
    var secretKey2 = getKomojuSecretKey_();
    if (secretKey2) {
      // /payments でフィルタなし一覧取得（最新25件）
      var paymentsResp = komojuRequest_('GET', '/payments?per_page=50', null, secretKey2);
      if (paymentsResp && paymentsResp.data) {
        var matchPayments = [];
        for (var pi = 0; pi < paymentsResp.data.length; pi++) {
          var pay = paymentsResp.data[pi];
          var payStr = JSON.stringify(pay);
          if (payStr.indexOf(keyword) !== -1) {
            matchPayments.push(pay);
          }
        }
        if (matchPayments.length > 0) {
          console.log('  決済一覧から ' + matchPayments.length + '件ヒット:');
          for (var mi = 0; mi < matchPayments.length; mi++) {
            var mp = matchPayments[mi];
            console.log('    [' + (mi + 1) + '] id: ' + mp.id + ' / status: ' + mp.status + ' / ¥' + mp.amount);
            console.log('      external_order_num: ' + (mp.external_order_num || ''));
            console.log('      payment_details: ' + JSON.stringify(mp.payment_details || {}).substring(0, 200));
          }
        } else {
          console.log('  最新50件の決済一覧にはヒットなし');
        }
      }
    }
  } catch (e) {
    console.log('  KOMOJU決済一覧検索エラー: ' + e.message);
  }

  console.log('========== 検索完了 ==========');
}

/**
 * 金額と日付範囲で依頼管理シートを検索
 * コンビニ払いのお客様番号はGAS側に保存されないため、金額で特定する
 */
function debugSearchByAmount(targetAmount, dateFrom, dateTo) {
  targetAmount = targetAmount || 6880;
  dateFrom = dateFrom || '2026-03-01';
  dateTo = dateTo || '2026-03-10';

  console.log('========== 金額検索: ¥' + targetAmount + ' (' + dateFrom + '〜' + dateTo + ') ==========');

  var orderSs = sh_getOrderSs_();
  var reqSh = orderSs.getSheetByName(APP_CONFIG.order.requestSheetName || '依頼管理');
  if (!reqSh) { console.log('依頼管理シートなし'); return; }

  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('データなし'); return; }

  var data = reqSh.getRange(2, 1, lastRow - 1, REQUEST_SHEET_COLS.NOTE || 30).getValues();
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo + 'T23:59:59');
  var found = 0;

  for (var i = 0; i < data.length; i++) {
    var amount = Number(data[i][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;
    var datetime = data[i][REQUEST_SHEET_COLS.DATETIME - 1];
    var orderDate = datetime instanceof Date ? datetime : new Date(datetime);

    // 金額一致 or 金額+手数料一致（220円はコンビニ手数料）
    if ((amount === targetAmount || amount === targetAmount + 220 || amount === targetAmount - 220) &&
        orderDate >= fromDate && orderDate <= toDate) {
      found++;
      var rn = String(data[i][REQUEST_SHEET_COLS.RECEIPT_NO - 1] || '');
      var company = String(data[i][REQUEST_SHEET_COLS.COMPANY_NAME - 1] || '');
      var email = String(data[i][REQUEST_SHEET_COLS.CONTACT - 1] || '');
      var payMethod = String(data[i][REQUEST_SHEET_COLS.PAYMENT_METHOD - 1] || '');
      var payId = String(data[i][REQUEST_SHEET_COLS.PAYMENT_ID - 1] || '');
      var payment = String(data[i][REQUEST_SHEET_COLS.PAYMENT - 1] || '');
      var status = String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
      var product = String(data[i][REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || '');
      var selList = String(data[i][REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '');
      console.log('[行' + (i + 2) + '] 受付番号: ' + rn);
      console.log('  会社名: ' + company + ' / メール: ' + email);
      console.log('  金額: ¥' + amount + ' / 日時: ' + orderDate.toLocaleString('ja-JP'));
      console.log('  決済: ' + payMethod + ' / 決済ID: ' + payId + ' / 入金: ' + payment);
      console.log('  商品: ' + product.substring(0, 80));
      console.log('  選択リスト(J列): ' + selList.substring(0, 80));
      console.log('  ステータス(V列): ' + status);
    }
  }

  if (found === 0) console.log('該当なし');
  else console.log('計 ' + found + '件ヒット');
}

/**
 * KOMOJU決済済みだが注文未登録の注文を復旧する
 * PENDING_ORDERがGCされてWebhookで処理できなかったケース用
 */
function debugRestoreOrder(params) {
  params = params || {};
  var komojuPaymentId = params.komojuPaymentId || 'bwk81hnjru7n299xyegdl3tr6';
  var receiptNo = params.receiptNo || '20260305193720-732';
  var companyName = params.companyName || '高橋圭子';
  var email = params.email || 'phmy81pp@outlook.jp';
  var productAmount = params.productAmount || 4980;
  var shippingAmount = params.shippingAmount || 1900;
  var totalAmount = params.totalAmount || 6880;
  var paymentMethod = params.paymentMethod || 'コンビニ払い';
  var orderDate = params.orderDate ? new Date(params.orderDate) : new Date('2026-03-05T19:37:20+09:00');

  console.log('========== 注文復旧 ==========');
  console.log('受付番号: ' + receiptNo);
  console.log('顧客: ' + companyName + ' / ' + email);
  console.log('金額: 商品¥' + productAmount + ' + 送料¥' + shippingAmount + ' = ¥' + totalAmount);

  // 重複チェック
  var orderSs = sh_getOrderSs_();
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var lastRow = reqSh.getLastRow();
  if (lastRow >= 2) {
    var existingReceipts = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < existingReceipts.length; i++) {
      if (String(existingReceipts[i][0]).trim() === receiptNo) {
        console.log('⚠ 既に依頼管理に存在します（行' + (i + 2) + '）。復旧不要です。');
        return;
      }
    }
  }

  // 顧客管理シートから住所情報を取得
  var custInfo = { postal: '', address: '', phone: '' };
  try {
    var custSh = getCustomerSheet_();
    if (custSh) {
      var custLast = custSh.getLastRow();
      if (custLast >= 2) {
        var custData = custSh.getRange(2, 1, custLast - 1, 8).getValues();
        for (var c = 0; c < custData.length; c++) {
          if (String(custData[c][CUSTOMER_SHEET_COLS.EMAIL] || '').trim().toLowerCase() === email.toLowerCase()) {
            custInfo.postal = String(custData[c][CUSTOMER_SHEET_COLS.POSTAL] || '');
            custInfo.address = String(custData[c][CUSTOMER_SHEET_COLS.ADDRESS] || '');
            custInfo.phone = String(custData[c][CUSTOMER_SHEET_COLS.PHONE] || '');
            console.log('顧客情報取得: 〒' + custInfo.postal + ' ' + custInfo.address + ' TEL:' + custInfo.phone);
            break;
          }
        }
      }
    }
  } catch (e) { console.error('顧客情報取得エラー:', e); }

  // 依頼管理シートに書き込み
  var now = new Date();
  var row = [
    receiptNo,                    // A: 受付番号
    orderDate,                    // B: 依頼日時
    companyName,                  // C: 会社名/氏名
    email,                        // D: 連絡先メール
    custInfo.postal,              // E: 郵便番号
    custInfo.address,             // F: 住所
    custInfo.phone,               // G: 電話番号
    '※KOMOJU復旧（商品情報はお客様に確認中）', // H: 商品名
    '',                           // I: 確認リンク
    '',                           // J: 選択リスト
    '',                           // K: 合計点数
    productAmount,                // L: 合計金額
    '',                           // M: 送料(店負担)
    shippingAmount,               // N: 送料(客負担)
    paymentMethod,                // O: 決済方法
    komojuPaymentId,              // P: 決済ID
    '対応済',                     // Q: 入金確認（captured済み）
    '',                           // R: ポイント付与済
    '',                           // S: 発送ステータス
    '',                           // T: 配送業者
    '',                           // U: 伝票番号
    '依頼中',                     // V: ステータス
    '',                           // W: 担当者
    '未',                         // X: リスト同梱
    '未',                         // Y: xlsx送付
    '',                           // Z: インボイス発行
    '',                           // AA: インボイス状況
    false,                        // AB: 受注通知
    '',                           // AC: 発送通知
    'KOMOJU復旧 ' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'), // AD: 備考
    '',                           // AE: 作業報酬
    now,                          // AF: 更新日時
    'デタウリ'                    // AG: チャネル
  ];

  reqSh.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
  console.log('✅ 依頼管理シートに書き込み完了（行' + (lastRow + 1) + '）');
  console.log('');
  console.log('⚠ 次のステップ:');
  console.log('  1. H列の商品名をお客様に確認して更新');
  console.log('  2. J列の管理番号を特定して入力');
  console.log('  3. お客様に注文確認メールを再送（debugResendOrderEmail）');
}

/**
 * 売却履歴にあるが依頼管理にない注文を復元する
 * 売却履歴（仕入れ管理）+ D1ペンディングデータ + 顧客管理から情報を集めて依頼管理に行を作成
 */
function debugRestoreFromSaleLog(receiptNo) {
  receiptNo = receiptNo || '20260320201818-560';

  console.log('========== 売却履歴から注文復元 ==========');
  console.log('受付番号: ' + receiptNo);

  // 1. 依頼管理の重複チェック
  var orderSs = sh_getOrderSs_();
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var lastRow = reqSh.getLastRow();
  if (lastRow >= 2) {
    var existingReceipts = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < existingReceipts.length; i++) {
      if (String(existingReceipts[i][0]).trim() === receiptNo) {
        console.log('⚠ 既に依頼管理に存在します（行' + (i + 2) + '）。復旧不要です。');
        return;
      }
    }
  }

  // 2. 依頼管理_アーカイブも確認
  var arcSh = orderSs.getSheetByName('依頼管理_アーカイブ');
  if (arcSh) {
    var arcLast = arcSh.getLastRow();
    if (arcLast >= 2) {
      var arcReceipts = arcSh.getRange(2, 1, arcLast - 1, 1).getDisplayValues();
      for (var a = 0; a < arcReceipts.length; a++) {
        if (String(arcReceipts[a][0]).trim() === receiptNo) {
          console.log('⚠ 依頼管理_アーカイブに存在します（行' + (a + 2) + '）。アーカイブから復元してください。');
          return;
        }
      }
    }
  }

  // 3. D1からペンディングデータを取得（受付番号=paymentToken の旧フロー）
  var pendingData = null;
  try {
    var d1Result = fetchPendingFromD1_(receiptNo);
    if (d1Result && d1Result.found && d1Result.data) {
      pendingData = JSON.parse(d1Result.data);
      console.log('D1ペンディングデータ取得成功');
    }
  } catch (e) { console.log('D1ペンディングデータなし: ' + e.message); }

  // 4. 売却履歴から管理番号リストを取得（仕入れ管理スプレッドシート）
  var shiireSsId = getOmProp_('OM_SHIIRE_SS_ID', '');
  var managedIds = [];
  var brands = [];
  try {
    var shiireSs = SpreadsheetApp.openById(shiireSsId);
    var saleLogSh = shiireSs.getSheetByName('売却履歴');
    if (saleLogSh) {
      var slLast = saleLogSh.getLastRow();
      if (slLast >= 2) {
        var slData = saleLogSh.getRange(2, 1, slLast - 1, 5).getDisplayValues();
        for (var s = 0; s < slData.length; s++) {
          if (String(slData[s][2]).trim() === receiptNo) {
            managedIds.push(String(slData[s][1]).trim());
            brands.push(String(slData[s][3]).trim());
          }
        }
      }
    }
    // 重複排除
    var seen = {};
    var uniqueIds = [], uniqueBrands = [];
    for (var u = 0; u < managedIds.length; u++) {
      if (!seen[managedIds[u]]) {
        seen[managedIds[u]] = true;
        uniqueIds.push(managedIds[u]);
        uniqueBrands.push(brands[u]);
      }
    }
    managedIds = uniqueIds;
    brands = uniqueBrands;
    console.log('売却履歴から取得: ' + managedIds.length + '件 → ' + managedIds.join(', '));
  } catch (e) { console.error('売却履歴取得エラー:', e); }

  // 5. KOMOJU APIで決済情報を検索（external_order_num = receiptNo）
  var komojuSession = null;
  try {
    var secretKey = getKomojuSecretKey_();
    if (secretKey) {
      var searchResp = komojuRequest_('GET', '/sessions?external_order_num=' + encodeURIComponent(receiptNo), null, secretKey);
      if (searchResp && searchResp.data && searchResp.data.length > 0) {
        komojuSession = searchResp.data[0];
        console.log('KOMOJUセッション発見: id=' + komojuSession.id + ' status=' + komojuSession.status + ' amount=' + komojuSession.amount);
        // セッション詳細を取得
        var sessionDetail = komojuRequest_('GET', '/sessions/' + komojuSession.id, null, secretKey);
        if (sessionDetail && sessionDetail.id) komojuSession = sessionDetail;
      } else {
        console.log('KOMOJUセッション見つからず');
      }
    }
  } catch (e) { console.error('KOMOJU検索エラー:', e); }

  // 6. 復元データの組み立て
  var email = '';
  var companyName = '【要確認】';
  var phone = '';
  var postal = '';
  var address = '';
  var productAmount = 0;
  var shippingAmount = 0;
  var storeShipping = '';
  var totalAmount = 0;
  var paymentMethod = '';
  var paymentId = '';
  var paymentStatus = '入金待ち';
  var channel = 'デタウリ';
  var productNames = managedIds.length > 0 ? ('管理番号: ' + managedIds.join(', ')) : '【要確認】商品情報なし';
  var orderDate = new Date(receiptNo.substring(0, 4) + '-' + receiptNo.substring(4, 6) + '-' + receiptNo.substring(6, 8)
    + 'T' + receiptNo.substring(8, 10) + ':' + receiptNo.substring(10, 12) + ':' + receiptNo.substring(12, 14) + '+09:00');

  if (pendingData) {
    // D1データがあれば最優先
    email = (pendingData.form && pendingData.form.contact) || '';
    companyName = (pendingData.form && pendingData.form.companyName) || '【要確認】';
    phone = (pendingData.form && pendingData.form.phone) || '';
    postal = (pendingData.form && pendingData.form.postal) || '';
    address = (pendingData.form && pendingData.form.address) || '';
    productAmount = pendingData.discounted || 0;
    shippingAmount = pendingData.shippingAmount || 0;
    storeShipping = pendingData.storeShipping || '';
    totalAmount = pendingData.totalAmount || 0;
    channel = pendingData.channel || 'デタウリ';
    productNames = pendingData.productNames || productNames;
    console.log('D1データで復元: ' + companyName + ' / ' + email + ' / ¥' + totalAmount);
  }

  // KOMOJUデータで補完（D1にない情報を埋める）
  if (komojuSession) {
    if (!totalAmount && komojuSession.amount) totalAmount = komojuSession.amount;
    if (komojuSession.metadata) {
      if (!email) email = komojuSession.metadata.email || '';
      if (companyName === '【要確認】' && komojuSession.metadata.company_name) companyName = komojuSession.metadata.company_name;
      if (!productAmount && komojuSession.metadata.product_amount) productAmount = Number(komojuSession.metadata.product_amount) || 0;
      if (!shippingAmount && komojuSession.metadata.shipping_amount) shippingAmount = Number(komojuSession.metadata.shipping_amount) || 0;
    }
    if (komojuSession.customer) {
      if (!email && komojuSession.customer.email) email = komojuSession.customer.email;
      if (companyName === '【要確認】' && komojuSession.customer.name) companyName = komojuSession.customer.name;
      if (!phone && komojuSession.customer.phone) phone = komojuSession.customer.phone;
    }
    if (komojuSession.payment) {
      paymentId = komojuSession.payment.id || '';
      var pmType = komojuSession.payment.type || '';
      paymentMethod = pmType ? getPaymentMethodDisplayName_(pmType) : '';
      var komojuStatus = komojuSession.status || '';
      if (komojuStatus === 'completed' || komojuStatus === 'captured') paymentStatus = '対応済';
      else if (komojuStatus === 'authorized') paymentStatus = '対応済';
    }
    if (!shippingAmount && totalAmount && productAmount) shippingAmount = totalAmount - productAmount;
    console.log('KOMOJUで補完: ' + companyName + ' / ' + email + ' / ¥' + totalAmount + ' / 決済=' + paymentMethod);
  }

  // 7. 顧客管理シートから住所情報を補完
  if (email) {
    try {
      var custSh = getCustomerSheet_();
      if (custSh) {
        var custLast = custSh.getLastRow();
        if (custLast >= 2) {
          var custData = custSh.getRange(2, 1, custLast - 1, 8).getValues();
          for (var c = 0; c < custData.length; c++) {
            if (String(custData[c][CUSTOMER_SHEET_COLS.EMAIL] || '').trim().toLowerCase() === email.toLowerCase()) {
              if (!postal) postal = String(custData[c][CUSTOMER_SHEET_COLS.POSTAL] || '');
              if (!address) address = String(custData[c][CUSTOMER_SHEET_COLS.ADDRESS] || '');
              if (!phone) phone = String(custData[c][CUSTOMER_SHEET_COLS.PHONE] || '');
              if (!companyName || companyName === '【要確認】') companyName = String(custData[c][CUSTOMER_SHEET_COLS.COMPANY] || companyName);
              console.log('顧客情報補完: ' + companyName + ' / 〒' + postal);
              break;
            }
          }
        }
      }
    } catch (e) { console.error('顧客情報取得エラー:', e); }
  }

  // 8. 依頼管理シートに書き込み
  var now = new Date();
  var row = [
    receiptNo,                    // A: 受付番号
    orderDate,                    // B: 依頼日時
    companyName,                  // C: 会社名/氏名
    email,                        // D: 連絡先メール
    postal,                       // E: 郵便番号
    address,                      // F: 住所
    phone,                        // G: 電話番号
    productNames,                 // H: 商品名
    '',                           // I: 確認リンク
    managedIds.join('\n'),        // J: 選択リスト（管理番号）
    managedIds.length || '',      // K: 合計点数
    productAmount,                // L: 合計金額
    storeShipping,                // M: 送料(店負担)
    shippingAmount,               // N: 送料(客負担)
    paymentMethod,                // O: 決済方法
    paymentId,                    // P: 決済ID
    paymentStatus,                // Q: 入金確認
    '',                           // R: ポイント付与済
    '',                           // S: 発送ステータス
    '',                           // T: 配送業者
    '',                           // U: 伝票番号
    '依頼中',                     // V: ステータス
    '',                           // W: 担当者
    '未',                         // X: リスト同梱
    '未',                         // Y: xlsx送付
    '',                           // Z: インボイス発行
    '',                           // AA: インボイス状況
    false,                        // AB: 受注通知
    '',                           // AC: 発送通知
    '売却履歴から復元 ' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'), // AD: 備考
    '',                           // AE: 作業報酬
    now,                          // AF: 更新日時
    channel                       // AG: チャネル
  ];

  reqSh.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
  console.log('✅ 依頼管理シートに書き込み完了（行' + (lastRow + 1) + '）');
  console.log('管理番号: ' + managedIds.join(', '));
  console.log('ブランド: ' + brands.join(', '));
  console.log('');
  console.log('⚠ 次のステップ:');
  console.log('  1. D1データがない場合、金額・決済情報をKOMOJUで確認して手動更新');
  console.log('  2. 展開済みならV列を「依頼中」→適切なステータスに変更');
}

/**
 * 商品管理シートの指定管理番号をまとめて売却済みにし、BO列に任意の値を設定する
 */
function debugBulkMarkSold(targetIds, boValue) {
  targetIds = targetIds || [
    'zC2','zC11','zC13','zC14','zC85','zC84','zC75','zC67','zC64','zC57',
    'zC55','zC54','zC47','zC38','zC7','zC12','zB444','zB440','zB433','zB427',
    'zB425','zB422','zB420','zB418','zB417','zB409'
  ];
  boValue = boValue || 'ファスト補填';

  console.log('========== 商品管理一括売却済み ==========');
  console.log('対象: ' + targetIds.length + '件');

  var shiireSsId = getOmProp_('OM_SHIIRE_SS_ID', '');
  if (!shiireSsId) { console.error('OM_SHIIRE_SS_ID 未設定'); return; }

  var shiireSs = SpreadsheetApp.openById(shiireSsId);
  var sheet = shiireSs.getSheetByName('商品管理');
  if (!sheet) { console.error('商品管理シートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  header.forEach(function(name, i) { if (name) colMap[String(name).trim()] = i + 1; });

  var idCol = colMap['管理番号'];
  var statusCol = colMap['ステータス'];
  var boCol = 67; // BO列

  if (!idCol || !statusCol) {
    console.error('管理番号列またはステータス列が見つかりません');
    return;
  }

  var data = sheet.getRange(2, idCol, lastRow - 1, 1).getDisplayValues();
  var targetSet = {};
  targetIds.forEach(function(id) { targetSet[id] = true; });

  var statusA1s = [];
  var boA1s = [];
  var found = 0;

  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][0]).trim();
    if (targetSet[id]) {
      var row = i + 2;
      statusA1s.push(sheet.getRange(row, statusCol).getA1Notation());
      boA1s.push(sheet.getRange(row, boCol).getA1Notation());
      found++;
      delete targetSet[id]; // 重複防止
    }
  }

  var notFound = Object.keys(targetSet);
  if (notFound.length > 0) {
    console.log('⚠ 見つからなかった管理番号: ' + notFound.join(', '));
  }

  if (statusA1s.length > 0) {
    sheet.getRangeList(statusA1s).setValue('売却済み');
    sheet.getRangeList(boA1s).setValue(boValue);
  }

  console.log('✅ 完了: ' + found + '/' + targetIds.length + '件を売却済みに更新（BO列="' + boValue + '"）');
}

/**
 * 受付番号の注文メールを再送
 */
function debugResendOrderEmail(receiptNo) {
  receiptNo = receiptNo || '20260318113100-626';
  debugOrderEmail(receiptNo, true);
}

/**
 * 受付番号の依頼管理行を修正（アソート商品名・合計点数・金額・送料・チャネル）
 * 備考欄のアソート合算情報 + アソート商品マスタから正しい値を復元する
 */
function debugFixOrderRow(receiptNo) {
  receiptNo = receiptNo || '20260322065719-340';

  var orderSs = sh_getOrderSs_();
  var reqSh = sh_ensureRequestSheet_(orderSs);
  var lastRow = reqSh.getLastRow();
  if (lastRow < 2) { console.log('依頼管理シートにデータなし'); return; }

  // 該当行を検索
  var receipts = reqSh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var targetRow = -1;
  for (var i = 0; i < receipts.length; i++) {
    if (String(receipts[i][0]).trim() === receiptNo) {
      targetRow = i + 2;
      break;
    }
  }
  if (targetRow === -1) { console.log('受付番号が見つかりません: ' + receiptNo); return; }

  // 現在の値を取得
  var currentRow = reqSh.getRange(targetRow, 1, 1, 33).getValues()[0];
  var note = String(currentRow[29] || '');
  console.log('該当行: ' + targetRow);
  console.log('現在のH列: ' + currentRow[7]);
  console.log('現在の備考: ' + note);

  // 備考からアソート合算情報を抽出: 【アソート合算: 商品代¥4400（1点）+ 送料¥1440】
  var assortMatch = note.match(/【アソート合算: 商品代¥(\d+)（(\d+)点）\+ 送料¥(\d+)】/);
  if (!assortMatch) {
    console.log('備考にアソート合算情報が見つかりません。手動で修正してください。');
    return;
  }
  var assortProductAmount = Number(assortMatch[1]);  // 4400
  var assortItemCount = Number(assortMatch[2]);      // 1
  var assortShipping = Number(assortMatch[3]);        // 1440

  // 備考の「商品代¥4400」は割引適用済みの金額（FHP50%OFF後）なのでそのまま使う
  var discountedAmount = assortProductAmount;

  console.log('アソート商品代(割引適用済み): ¥' + discountedAmount);
  console.log('アソート点数: ' + assortItemCount);
  console.log('アソート送料: ¥' + assortShipping);

  // アソート商品マスタから商品を検索（FHP適用済みの場合は元値の半額でもマッチ）
  var isFHP = note.indexOf('初回全品半額') !== -1;
  var bulkProducts = bulk_getProducts_();
  var matchedNames = [];
  for (var i = 0; i < bulkProducts.length; i++) {
    var bp = bulkProducts[i];
    var unitPrice = (bp.discountedPrice !== undefined) ? bp.discountedPrice : bp.price;
    var matchDirect = (unitPrice * assortItemCount === assortProductAmount);
    var matchFHP = isFHP && (Math.round(unitPrice * 0.5) * assortItemCount === assortProductAmount);
    if (matchDirect || matchFHP) {
      matchedNames.push(bp.name + ' x' + assortItemCount + bp.unit);
      console.log('商品候補: ' + bp.name + ' (元値¥' + unitPrice + (matchFHP ? ' → FHP50%OFF→¥' + Math.round(unitPrice * 0.5) : '') + ' x' + assortItemCount + ')');
    }
  }

  var productNames;
  if (matchedNames.length === 1) {
    productNames = '・' + matchedNames[0];
  } else if (matchedNames.length > 1) {
    console.log('⚠ 複数の候補商品があります。全アソート商品を表示:');
    for (var k = 0; k < bulkProducts.length; k++) {
      var bpk = bulkProducts[k];
      var upk = (bpk.discountedPrice !== undefined) ? bpk.discountedPrice : bpk.price;
      console.log('  ' + bpk.productId + ': ' + bpk.name + ' ¥' + upk + '/' + bpk.unit);
    }
    productNames = '・' + matchedNames.join('\n・');
  } else {
    console.log('⚠ ¥' + assortProductAmount + 'に一致する商品が見つかりません。全アソート商品を表示:');
    for (var k = 0; k < bulkProducts.length; k++) {
      var bpk = bulkProducts[k];
      var upk = (bpk.discountedPrice !== undefined) ? bpk.discountedPrice : bpk.price;
      console.log('  ' + bpk.productId + ': ' + bpk.name + ' ¥' + upk + '/' + bpk.unit);
    }
    console.log('商品を特定できません。修正を中断します。');
    return;
  }

  // 送料の店負担（半額）
  var storeShipping = Math.round(assortShipping / 2) || 0;

  console.log('=== 修正値 ===');
  console.log('H列(商品名): ' + productNames);
  console.log('K列(合計点数): ' + assortItemCount);
  console.log('L列(合計金額): ' + discountedAmount);
  console.log('M列(送料店負担): ' + storeShipping);
  console.log('N列(送料客負担): ' + assortShipping);
  console.log('AG列(チャネル): アソート');

  // 更新実行
  reqSh.getRange(targetRow, 8).setValue(productNames);       // H列: 商品名
  reqSh.getRange(targetRow, 11).setValue(assortItemCount);    // K列: 合計点数
  reqSh.getRange(targetRow, 12).setValue(discountedAmount);   // L列: 合計金額
  reqSh.getRange(targetRow, 13).setValue(storeShipping);      // M列: 送料(店負担)
  reqSh.getRange(targetRow, 14).setValue(assortShipping);     // N列: 送料(客負担)
  // AG列(チャネル)は「アソート」のまま（BulkSubmit経由なので正しい）

  // 備考からアソート合算行を削除（数値が各列に入ったので不要）
  var newNote = note.replace(/\n?【アソート合算[^】]*】/g, '').trim();
  if (newNote !== note) {
    reqSh.getRange(targetRow, 30).setValue(newNote);
    console.log('AD列(備考): アソート合算行を削除 → ' + newNote);
  }

  console.log('✓ 行 ' + targetRow + ' を修正しました');
}

/**
 * 注文送信キュー・ペンディング注文を確認
 */
function debugViewQueues() {
  console.log('========== 注文送信キュー ==========');
  viewSubmitQueue();

  console.log('========== ペンディング注文 ==========');
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var pendingKeys = Object.keys(all).filter(function(k) { return k.indexOf('PENDING_ORDER_') === 0; });
  console.log('ペンディング注文数: ' + pendingKeys.length);
  for (var i = 0; i < pendingKeys.length; i++) {
    try {
      var pd = JSON.parse(all[pendingKeys[i]]);
      console.log('  ' + pendingKeys[i] + ': ' + (pd.productNames || '') + ' / ¥' + (pd.discounted || 0));
    } catch (e) {
      console.log('  ' + pendingKeys[i] + ': パースエラー');
    }
  }
}

/**
 * STATE関連プロパティの概要を表示
 */
function debugViewStates() {
  console.log('========== holdState ==========');
  var orderSs = sh_getOrderSs_();
  var holdState = st_getHoldState_(orderSs) || {};
  var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
  var holdKeys = Object.keys(holdItems);
  console.log('確保中: ' + holdKeys.length + '点');
  if (holdKeys.length > 0 && holdKeys.length <= 20) {
    for (var i = 0; i < holdKeys.length; i++) {
      var hi = holdItems[holdKeys[i]];
      console.log('  ' + holdKeys[i] + ' (user:' + (hi.userKey || '').substring(0, 8) + '...)');
    }
  }

  console.log('========== openState ==========');
  var openState = st_getOpenState_(orderSs) || {};
  var openItems = (openState.items && typeof openState.items === 'object') ? openState.items : {};
  var openKeys = Object.keys(openItems);
  console.log('依頼中: ' + openKeys.length + '点');

  // 受付番号ごとに集計
  var byReceipt = {};
  for (var j = 0; j < openKeys.length; j++) {
    var oi = openItems[openKeys[j]];
    var rn = oi.receiptNo || '不明';
    if (!byReceipt[rn]) byReceipt[rn] = 0;
    byReceipt[rn]++;
  }
  var receipts = Object.keys(byReceipt).sort();
  for (var k = 0; k < receipts.length; k++) {
    console.log('  ' + receipts[k] + ': ' + byReceipt[receipts[k]] + '点');
  }
}



/**
 * デキルンデモ用の配布用リスト形式スプレッドシートを新規作成
 * GASエディタから▶で実行
 */
function createDemoDistributionList() {
  var ss = SpreadsheetApp.create('【デモ】配布用リスト — デタウリ出品キット');
  var sheet = ss.getActiveSheet();
  sheet.setName('配布用リスト');

  // Row 1: メタ情報
  sheet.getRange('A1').setValue('受付番号');
  sheet.getRange('B1').setValue('DEMO-SAMPLE');
  sheet.getRange('D1').setValue('お客様名');
  sheet.getRange('E1').setValue('サンプル');
  sheet.getRange('G1').setValue('注文日');
  sheet.getRange('H1').setValue('2026-03-28');
  sheet.getRange('I1').setValue('9,750円');
  sheet.getRange('A1:N1').setFontWeight('bold').setBackground('#f0f0f0');

  // Row 2: ヘッダー
  var headers = ['出品済', 'タイトル', '説明文', 'BOX', '管理番号', 'ブランド', 'AIキーワード', 'アイテム', 'サイズ', '状態', 'ダメージ', '採寸', '価格', '性別'];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#d9e2f3');

  // Row 3-6: デモデータ
  var data = [
    [false, 'BURBERRY ニット セーター ノバチェック ベージュ L メンズ',
     '■ブランド\nBURBERRY バーバリー\n\n■アイテム\nニット・セーター\n\n■サイズ\nL\n肩幅: 46cm / 身幅: 54cm / 着丈: 68cm / 袖丈: 62cm\n\n■カラー\nベージュ\n\n■状態\n目立った傷や汚れなし\n全体的にきれいな状態です。\n\n■商品説明\nバーバリーの定番ノバチェック柄ニットです。上質なウール素材で暖かく、シンプルなデザインで合わせやすい一着です。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
     '', 'DEMO-001', 'BURBERRY', '', 'トップス', 'L', 'B（使用感少ない）', '', '肩幅: 46cm / 身幅: 54cm / 着丈: 68cm / 袖丈: 62cm', '¥2,500', 'メンズ'],
    [false, 'ノースフェイス マウンテンパーカー ブラック M メンズ',
     '■ブランド\nTHE NORTH FACE ザ・ノースフェイス\n\n■アイテム\nマウンテンパーカー\n\n■サイズ\nM\n肩幅: 44cm / 身幅: 55cm / 着丈: 70cm / 袖丈: 64cm\n\n■カラー\nブラック\n\n■状態\n美品・ほぼ未使用に近い状態です。\n\n■商品説明\nノースフェイスのマウンテンパーカーです。防風・撥水機能があり、アウトドアからタウンユースまで幅広く活躍します。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
     '', 'DEMO-002', 'THE NORTH FACE', '', 'アウター', 'M', 'A（美品）', '', '肩幅: 44cm / 身幅: 55cm / 着丈: 70cm / 袖丈: 64cm', '¥3,500', 'メンズ'],
    [false, 'ラルフローレン ポロシャツ ポニー刺繍 ネイビー L メンズ',
     '■ブランド\nRalph Lauren ラルフローレン\n\n■アイテム\nポロシャツ\n\n■サイズ\nL\n肩幅: 45cm / 身幅: 56cm / 着丈: 72cm / 袖丈: 24cm\n\n■カラー\nネイビー\n\n■状態\n目立った傷や汚れなし\n\n■商品説明\nラルフローレンの定番ポロシャツです。胸元のポニー刺繍がワンポイント。鹿の子素材で通気性もよく、春夏に活躍します。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
     '', 'DEMO-003', 'Ralph Lauren', '', 'トップス', 'L', 'B（使用感少ない）', '', '肩幅: 45cm / 身幅: 56cm / 着丈: 72cm / 袖丈: 24cm', '¥1,500', 'メンズ'],
    [false, 'COACH ショルダーバッグ シグネチャー ブラウン レディース',
     '■ブランド\nCOACH コーチ\n\n■アイテム\nショルダーバッグ\n\n■サイズ\n縦: 22cm / 横: 28cm / マチ: 8cm / ショルダー: 120cm\n\n■カラー\nブラウン\n\n■状態\n目立った傷や汚れなし\n\n■商品説明\nコーチのシグネチャー柄ショルダーバッグです。レザーとキャンバスのコンビ素材で高級感があります。収納力もあり普段使いに最適です。\n\n※素人採寸のため多少の誤差はご了承ください。\n※中古品のためご理解のある方のご購入をお願いいたします。',
     '', 'DEMO-004', 'COACH', '', 'バッグ', '-', 'B（使用感少ない）', '', '縦: 22cm / 横: 28cm / マチ: 8cm / ショルダー: 120cm', '¥2,250', 'レディース']
  ];

  sheet.getRange(3, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(3, 1, data.length, 1).insertCheckboxes();
  sheet.setRowHeightsForced(3, data.length, 21);

  // 列幅調整
  sheet.setColumnWidth(1, 50);   // 出品済
  sheet.setColumnWidth(2, 300);  // タイトル
  sheet.setColumnWidth(3, 400);  // 説明文
  sheet.setColumnWidth(5, 100);  // 管理番号
  sheet.setColumnWidth(6, 120);  // ブランド
  sheet.setColumnWidth(12, 250); // 採寸
  sheet.setColumnWidth(13, 80);  // 価格

  console.log('デモ配布用リスト作成完了: ' + ss.getUrl());
}

/**
 * 補助金申請用：現状の経営指標を集計（GASエディタから手動実行）
 */
function debugSubsidyStats() {
  var custSheet = getCustomerSheet_();
  var custData = custSheet.getDataRange().getValues();

  var totalCustomers = custData.length - 1;
  var purchasedOnce = 0;   // 購入回数 >= 1
  var repeaters = 0;       // 購入回数 >= 2

  for (var i = 1; i < custData.length; i++) {
    var pc = Number(custData[i][CUSTOMER_SHEET_COLS.PURCHASE_COUNT]) || 0;
    if (pc >= 1) purchasedOnce++;
    if (pc >= 2) repeaters++;
  }

  // 依頼管理 + アーカイブから完了注文の売上を集計
  var ss = sh_getOrderSs_();
  var sheetNames = ['依頼管理', '依頼管理_アーカイブ'];
  var totalOrders = 0;
  var totalRevenue = 0;
  var monthlySales = {};

  for (var s = 0; s < sheetNames.length; s++) {
    var sheet = ss.getSheetByName(sheetNames[s]);
    if (!sheet || sheet.getLastRow() < 2) continue;
    var data = sheet.getDataRange().getValues();
    for (var j = 1; j < data.length; j++) {
      var status = String(data[j][REQUEST_SHEET_COLS.STATUS - 1] || '').trim();
      if (status !== '完了') continue;
      totalOrders++;
      var amount = Number(data[j][REQUEST_SHEET_COLS.TOTAL_AMOUNT - 1]) || 0;
      totalRevenue += amount;

      var dateVal = data[j][REQUEST_SHEET_COLS.DATETIME - 1];
      if (dateVal instanceof Date) {
        var ym = Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM');
        monthlySales[ym] = (monthlySales[ym] || 0) + amount;
      }
    }
  }

  var avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  var purchaseRate = totalCustomers > 0 ? (purchasedOnce / totalCustomers * 100).toFixed(1) : 0;
  var repeatRate = purchasedOnce > 0 ? (repeaters / purchasedOnce * 100).toFixed(1) : 0;

  // 直近6ヶ月の月平均売上
  var sortedMonths = Object.keys(monthlySales).sort().reverse().slice(0, 6);
  var recent6mTotal = 0;
  for (var m = 0; m < sortedMonths.length; m++) {
    recent6mTotal += monthlySales[sortedMonths[m]];
  }
  var monthlyAvg = sortedMonths.length > 0 ? Math.round(recent6mTotal / sortedMonths.length) : 0;

  function yen_(n) { return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  console.log('========================================');
  console.log('  補助金申請用 経営指標');
  console.log('========================================');
  console.log('');
  console.log('【顧客データ】');
  console.log('  会員登録数:           ' + totalCustomers + '人');
  console.log('  購入者数(1回以上):    ' + purchasedOnce + '人');
  console.log('  リピーター数(2回以上): ' + repeaters + '人');
  console.log('');
  console.log('【主要KPI】');
  console.log('  購入率(会員→購入):       ' + purchaseRate + '%');
  console.log('  リピート率(購入者→2回+):  ' + repeatRate + '%');
  console.log('');
  console.log('【売上データ】');
  console.log('  完了注文数:    ' + totalOrders + '件');
  console.log('  累計売上:      ' + yen_(totalRevenue));
  console.log('  平均客単価:    ' + yen_(avgOrderValue));
  console.log('  月平均売上(直近6ヶ月): ' + yen_(monthlyAvg));
  console.log('');
  console.log('【月別売上(直近6ヶ月)】');
  for (var k = 0; k < sortedMonths.length; k++) {
    console.log('  ' + sortedMonths[k] + ':  ' + yen_(monthlySales[sortedMonths[k]]));
  }
  console.log('========================================');
}

/**
 * 注文金額の分布を集計し、送料無料ラインの影響を分析
 * GASエディタから手動実行 → 実行ログに結果が出力される
 */
/**
 * 既存のデータ1掲載商品にZ列（掲載日）をバックフィル
 * 商品管理の出品日があればそれを��い、なければ今日の日付を入れる
 * GASエディタから1回だけ手動実行する — Debug.gs
 */
function backfillListedDate() {
  var mainSs = SpreadsheetApp.getActiveSpreadsheet();
  var data1 = mainSs.getSheetByName('データ1');
  if (!data1) { console.log('データ1が見つかりません'); return; }
  var d1Last = data1.getLastRow();
  if (d1Last < 3) { console.log('データなし'); return; }

  var nRows = d1Last - 2;
  var keys = data1.getRange(3, 11, nRows, 1).getValues();     // K列: 管理番号
  var existing = data1.getRange(3, 26, nRows, 1).getValues();  // Z列: 掲載日

  // 商品管理から出品��を取得
  var detailSsId = '';
  try { detailSsId = APP_CONFIG.detail.spreadsheetId; } catch (e) {}
  if (!detailSsId) try { detailSsId = PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || ''; } catch (e) {}

  var listDateMap = {};
  if (detailSsId) {
    var detailSs = SpreadsheetApp.openById(detailSsId);
    var mgSh = detailSs.getSheetByName('商品管理');
    if (mgSh) {
      var mgLast = mgSh.getLastRow();
      var mgLastCol = mgSh.getLastColumn();
      if (mgLast >= 2) {
        var mgHeaders = mgSh.getRange(1, 1, 1, mgLastCol).getValues()[0];
        var cMid = -1, cDate = -1;
        for (var h = 0; h < mgHeaders.length; h++) {
          var name = String(mgHeaders[h] || '').trim();
          if (name === '管理番号') cMid = h;
          if (name === '出品日') cDate = h;
        }
        if (cMid >= 0 && cDate >= 0) {
          var mgData = mgSh.getRange(2, 1, mgLast - 1, Math.max(cMid, cDate) + 1).getValues();
          for (var r = 0; r < mgData.length; r++) {
            var mid = String(mgData[r][cMid] || '').trim().toUpperCase();
            var d = mgData[r][cDate];
            if (mid && d instanceof Date && !isNaN(d)) listDateMap[mid] = d;
          }
        }
      }
    }
  }

  var today = new Date();
  var output = [];
  var filled = 0, newToday = 0;
  for (var i = 0; i < nRows; i++) {
    var mid = String(keys[i][0] || '').trim().toUpperCase();
    var fromMg = listDateMap[mid];
    if (fromMg) {
      output.push([fromMg]);
      filled++;
    } else {
      output.push([today]);
      newToday++;
    }
  }

  data1.getRange(3, 26, nRows, 1).setValues(output);
  data1.getRange(2, 26).setValue('掲載日');
  console.log('バックフィル完了: 出品日流用=' + filled + ' 今日の日付(出品日なし)=' + newToday + ' 合計=' + nRows);
}

/**
 * デタウリに現在掲載中の商品を、出品日が古い順に10件表示
 * データ1シート（掲載中商品）× 商品管理シート（出品日）をクロス参照
 * GASエディタから手動実行 → 実行ログに出力
 */
function showOldestListings() {
  // データ1のZ列（掲載日）を直接使用
  var mainSs = SpreadsheetApp.getActiveSpreadsheet();
  var data1 = mainSs.getSheetByName('データ1');
  if (!data1) { console.log('データ1シートが見つかりません'); return; }
  var d1Last = data1.getLastRow();
  if (d1Last < 3) { console.log('データ1にデータなし'); return; }

  // K列(11):管理番号, D列(4):ブランド, I列(9):価格, Z列(26):掲載日
  var nRows = d1Last - 2;
  var d1Vals = data1.getRange(3, 1, nRows, 11).getValues();
  var listedDates = data1.getRange(3, 26, nRows, 1).getValues();

  var items = [];
  var today = new Date();
  var noDate = 0;

  for (var i = 0; i < nRows; i++) {
    var mid = String(d1Vals[i][10] || '').trim(); // K列
    if (!mid) continue;

    var d = listedDates[i][0];
    if (!(d instanceof Date) || isNaN(d)) { noDate++; continue; }

    var days = Math.floor((today - d) / (1000 * 60 * 60 * 24));
    items.push({
      mid: mid,
      brand: String(d1Vals[i][3] || ''),
      price: Number(d1Vals[i][8]) || 0,
      date: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd'),
      days: days
    });
  }

  items.sort(function(a, b) { return b.days - a.days; });

  console.log('========================================');
  console.log('デタウリ掲載中 古い商品 TOP10（掲載中 ' + items.length + '件' + (noDate > 0 ? '、掲載日未設定=' + noDate + '件' : '') + '）');
  console.log('========================================');
  var top = Math.min(10, items.length);
  for (var k = 0; k < top; k++) {
    var it = items[k];
    console.log((k + 1) + '. ' + it.mid + '  ' + it.brand + '  ¥' + it.price + '  ' + it.date + '（' + it.days + '日）');
  }
  if (items.length === 0) console.log('(掲載日が入っている商品がありません。先に backfillListedDate を実行してください)');
  console.log('========================================');
}

function analyzeShippingThreshold() {
  function yen_(n) { return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sh = ss.getSheetByName(String(APP_CONFIG.order.requestSheetName || '依頼管理'));
  if (!sh) { console.log('依頼管理シートが見つかりません'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { console.log('データなし'); return; }

  var data = sh.getRange(2, 1, lastRow - 1, 22).getValues();
  var amounts = [];
  var shippingPaid = []; // 客負担送料が発生した注文

  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][21] || '').trim(); // V列: ステータス
    if (status === 'キャンセル' || status === '返品') continue;
    var amount = Number(data[i][11]) || 0; // L列: 合計金額
    if (amount <= 0) continue;
    amounts.push(amount);
    var custShip = Number(data[i][13]) || 0; // N列: 送料(客負担)
    if (custShip > 0) shippingPaid.push({ amount: amount, shipping: custShip });
  }

  if (amounts.length === 0) { console.log('有効な注文データなし'); return; }

  amounts.sort(function(a, b) { return a - b; });
  var total = amounts.length;

  // 金額帯の分布
  var bands = [
    [0, 5000], [5000, 10000], [10000, 15000], [15000, 20000],
    [20000, 25000], [25000, 30000], [30000, 50000], [50000, 100000], [100000, Infinity]
  ];
  var bandCounts = {};
  for (var b = 0; b < bands.length; b++) {
    var lo = bands[b][0], hi = bands[b][1];
    var label = hi === Infinity ? (yen_(lo) + '以上') : (yen_(lo) + '〜' + yen_(hi));
    var cnt = 0;
    for (var j = 0; j < amounts.length; j++) {
      if (amounts[j] >= lo && amounts[j] < hi) cnt++;
    }
    bandCounts[label] = cnt;
  }

  // 各閾値で送料無料になる注文の割合
  var thresholds = [10000, 15000, 20000, 25000, 30000];

  console.log('========================================');
  console.log('送料無料ライン分析（有効注文 ' + total + '件）');
  console.log('========================================');
  console.log('');
  console.log('【注文金額の分布】');
  for (var key in bandCounts) {
    var pct = Math.round(bandCounts[key] / total * 1000) / 10;
    console.log('  ' + key + ':  ' + bandCounts[key] + '件 (' + pct + '%)');
  }

  console.log('');
  console.log('【送料無料ライン別 影響】');
  for (var t = 0; t < thresholds.length; t++) {
    var th = thresholds[t];
    var freeCount = 0;
    for (var a = 0; a < amounts.length; a++) {
      if (amounts[a] >= th) freeCount++;
    }
    var freePct = Math.round(freeCount / total * 1000) / 10;
    var paidCount = total - freeCount;
    var paidPct = Math.round(paidCount / total * 1000) / 10;
    console.log('  ' + yen_(th) + '以上で無料:  無料=' + freeCount + '件(' + freePct + '%)  有料=' + paidCount + '件(' + paidPct + '%)');
  }

  // 平均・中央値
  var sum = 0;
  for (var s = 0; s < amounts.length; s++) sum += amounts[s];
  var avg = Math.round(sum / total);
  var median = amounts[Math.floor(total / 2)];

  console.log('');
  console.log('【統計】');
  console.log('  平均注文金額:  ' + yen_(avg));
  console.log('  中央値:        ' + yen_(median));
  console.log('  最小:          ' + yen_(amounts[0]));
  console.log('  最大:          ' + yen_(amounts[amounts.length - 1]));

  // 現在送料を払っている注文の分布
  console.log('');
  console.log('【現在 送料(客負担)が発生している注文: ' + shippingPaid.length + '件】');
  if (shippingPaid.length > 0) {
    var shipTotal = 0;
    for (var sp = 0; sp < shippingPaid.length; sp++) shipTotal += shippingPaid[sp].shipping;
    console.log('  送料収入合計:  ' + yen_(shipTotal));
    console.log('  平均送料/件:   ' + yen_(Math.round(shipTotal / shippingPaid.length)));
  }

  console.log('========================================');
}

// =====================================================
// 単発: D1 pendingバックアップから個品/アソートID内訳を復元
// =====================================================

function debugRecoverDetauriIds_620() {
  debugRecoverDetauriIdsForReceipt('20260410180154-620');
}

function debugRecoverDetauriIdsForReceipt(receiptNo) {
  console.log('=== D1 pending復元: ' + receiptNo + ' ===');
  // 旧形式の受付番号は paymentToken === receiptNo
  var d1Result = fetchPendingFromD1_(receiptNo);
  if (!d1Result) { console.log('D1 API応答なし（WORKERS_API_URL/ADMIN_KEY未設定の可能性）'); return; }
  if (!d1Result.found) { console.log('D1にバックアップなし'); return; }

  var pending = null;
  try { pending = JSON.parse(d1Result.data); }
  catch (e) { console.log('JSONパース失敗: ' + e.message); console.log('raw: ' + String(d1Result.data).substring(0, 500)); return; }

  console.log('consumed: ' + d1Result.consumed);
  console.log('channel: ' + (pending.channel || '(なし)'));
  console.log('totalCount: ' + pending.totalCount);
  console.log('selectionList: ' + (pending.selectionList || '(なし)'));

  var detauriIds = pending.detauriIds || [];
  console.log('--- detauriIds (お客様が手動選択した個品) ---');
  console.log('件数: ' + detauriIds.length);
  if (detauriIds.length > 0) {
    console.log('IDs: ' + detauriIds.join('、'));
  }

  var ids = pending.ids || [];
  console.log('--- 統合ids (J列に書かれた全管理番号) ---');
  console.log('件数: ' + ids.length);

  // アソート分 = 統合ids − detauriIds
  var detauriSet = {};
  for (var i = 0; i < detauriIds.length; i++) detauriSet[detauriIds[i]] = true;
  var assortIds = ids.filter(function(x) { return !detauriSet[x]; });
  console.log('--- アソート自動選定分 (推定) ---');
  console.log('件数: ' + assortIds.length);
  if (assortIds.length > 0) console.log('IDs: ' + assortIds.join('、'));
}
