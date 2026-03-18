// =====================================================
// Debug.gs — デバッグ・調査ツール集約
// GASエディタから手動実行して受付番号・管理番号で調査する
// =====================================================

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
        console.log('Payment Types: ' + JSON.stringify(session.payment_types || []));
        console.log('Metadata: ' + JSON.stringify(session.metadata || {}));
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
}

/**
 * 受付番号で注文の全情報を表示
 * メール送信状況・決済状態・依頼中状態を一括確認
 */
function debugLookupByReceipt() {
  var receiptNo = '20260318113100-626'; // ← ここに受付番号を入力

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
function debugLookupByManagedId() {
  var targetId = 'zB1012'; // ← ここに管理番号を入力

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
function debugSearch() {
  var keyword = '46545894360'; // ← ここに検索キーワードを入力

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
function debugSearchByAmount() {
  var targetAmount = 6880; // ← 商品金額（手数料除く）
  var dateFrom = '2026-03-01'; // ← 検索開始日
  var dateTo = '2026-03-10';   // ← 検索終了日

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
function debugRestoreOrder() {
  // === 復旧対象の情報（KOMOJU APIから取得済み） ===
  var komojuPaymentId = 'bwk81hnjru7n299xyegdl3tr6';
  var receiptNo = '20260305193720-732';
  var companyName = '高橋圭子';
  var email = 'phmy81pp@outlook.jp';
  var productAmount = 4980;
  var shippingAmount = 1900;
  var totalAmount = 6880;
  var paymentMethod = 'コンビニ払い';
  var orderDate = new Date('2026-03-05T19:37:20+09:00');

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
 * 受付番号の注文メールを再送
 */
function debugResendOrderEmail() {
  var receiptNo = '20260318113100-626'; // ← ここに受付番号を入力
  debugOrderEmail(receiptNo, true);
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
