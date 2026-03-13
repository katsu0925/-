// NewArrivalNotify.gs
// =====================================================
// 新着商品通知メール (Phase 3-3)
// 管理IDベースで新着を正確に検出し、メルマガ登録者に通知
// =====================================================

/**
 * 新着商品通知メール 定期実行（毎日10時）
 *
 * データ1シートの管理ID一覧を前回と比較し、
 * 新しく出現したIDのみを「新着」として通知する。
 * （syncFull_が毎分全行書き換えするため、行番号での判定は不正確）
 *
 * Script Properties:
 *   KNOWN_PRODUCT_IDS — 前回通知時点の管理IDセット（JSON配列）
 */
function newArrivalNotifyCron_() {
  try {
    console.log('newArrivalNotifyCron_: 開始');

    var ss = SpreadsheetApp.openById(String(APP_CONFIG.data.spreadsheetId).trim());
    var dataSheet = ss.getSheetByName(APP_CONFIG.data.sheetName);
    if (!dataSheet) {
      console.log('newArrivalNotifyCron_: データ1シートが見つかりません');
      return;
    }

    var lastRow = dataSheet.getLastRow();
    var headerRow = Number(APP_CONFIG.data.headerRow || 2);
    if (lastRow <= headerRow) {
      console.log('newArrivalNotifyCron_: 商品データなし');
      return;
    }

    // K列(管理ID)とD列(ブランド)、C列(状態)、E列(サイズ)、G列(カテゴリ)、I列(価格)を読み込み
    var numRows = lastRow - headerRow;
    var values = dataSheet.getRange(headerRow + 1, 1, numRows, 11).getValues(); // A〜K列

    // 現在の管理IDセットと商品データマップを構築
    var currentIds = {};
    var productMap = {};
    for (var i = 0; i < values.length; i++) {
      var managedId = String(values[i][10] || '').trim(); // K列: 管理ID
      if (!managedId) continue;
      currentIds[managedId] = true;
      productMap[managedId] = {
        brand: String(values[i][3] || '').trim(),    // D列
        state: String(values[i][2] || '').trim(),     // C列
        size: String(values[i][4] || '').trim(),      // E列
        category: String(values[i][6] || '').trim(),  // G列
        price: Number(values[i][8] || 0)              // I列
      };
    }

    // 前回の管理IDセットを読み込み
    var props = PropertiesService.getScriptProperties();
    var prevIdsJson = props.getProperty('KNOWN_PRODUCT_IDS');
    var prevIds = {};

    if (prevIdsJson) {
      try {
        var arr = JSON.parse(prevIdsJson);
        for (var j = 0; j < arr.length; j++) {
          prevIds[arr[j]] = true;
        }
      } catch (e) {
        console.log('newArrivalNotifyCron_: 前回IDのパース失敗、全商品を既知として扱う');
        // パース失敗時は現在のIDを保存して次回から正常動作
        props.setProperty('KNOWN_PRODUCT_IDS', JSON.stringify(Object.keys(currentIds)));
        return;
      }
    }

    // 新着 = 現在あって前回になかったID
    var newProducts = [];
    var currentIdKeys = Object.keys(currentIds);
    for (var k = 0; k < currentIdKeys.length; k++) {
      var id = currentIdKeys[k];
      if (!prevIds[id] && productMap[id]) {
        var p = productMap[id];
        newProducts.push({
          managedId: id,
          brand: p.brand,
          state: p.state,
          size: p.size,
          category: p.category,
          price: p.price
        });
      }
    }

    // 現在のIDセットを保存（次回比較用）
    props.setProperty('KNOWN_PRODUCT_IDS', JSON.stringify(currentIdKeys));

    // 初回実行時（前回データなし）はIDを保存するだけで通知しない
    if (!prevIdsJson) {
      console.log('newArrivalNotifyCron_: 初回実行 → ' + currentIdKeys.length + '件のIDを記録（通知なし）');
      return;
    }

    if (newProducts.length === 0) {
      console.log('newArrivalNotifyCron_: 新着商品なし（現在' + currentIdKeys.length + '件）');
      return;
    }

    console.log('newArrivalNotifyCron_: 新着 ' + newProducts.length + '件を検出');

    // 代表的な商品（最大5件）
    var sampleProducts = newProducts.slice(0, 5);
    var sampleItems = [];
    for (var si = 0; si < sampleProducts.length; si++) {
      var sp = sampleProducts[si];
      var label = sp.brand || sp.category || '商品';
      if (sp.size) label += ' / ' + sp.size;
      if (sp.price > 0) label += '  ¥' + String(sp.price).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      sampleItems.push(label);
    }
    if (newProducts.length > 5) {
      sampleItems.push('...他 ' + (newProducts.length - 5) + '点');
    }

    var sampleText = '';
    for (var st = 0; st < sampleItems.length; st++) {
      sampleText += '  ・' + sampleItems[st] + '\n';
    }

    // メルマガ登録済み会員にメール送信
    var recipients = getNewsletterRecipients_();
    var sent = 0;

    for (var c = 0; c < recipients.length; c++) {
      var recip = recipients[c];
      try {
        var subject = '【デタウリ.Detauri】新着商品 ' + newProducts.length + '点が入荷しました';
        var body = recip.companyName + ' 様\n\n'
          + 'デタウリ.Detauri に新しい商品が入荷しました！\n\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '■ 新着商品 ' + newProducts.length + '点\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + sampleText + '\n'
          + '▼ 新着商品をチェック\n'
          + SITE_CONSTANTS.SITE_URL + '\n\n'
          + '人気商品は早い者勝ちです。\n'
          + '会員様は確保時間が30分に延長されますので、\n'
          + 'ログインしてからお買い物をお楽しみください。\n\n'
          + '※ このメールはメルマガ配信にご登録いただいた方にお送りしています。\n'
          + '※ 配信停止: ' + nl_buildUnsubscribeUrl_(recip.email) + '\n\n'
          + '──────────────────\n'
          + SITE_CONSTANTS.SITE_NAME + '\n'
          + SITE_CONSTANTS.SITE_URL + '\n'
          + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
          + '──────────────────\n';

        GmailApp.sendEmail(recip.email, subject, body, {
          from: SITE_CONSTANTS.CUSTOMER_EMAIL, replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
          htmlBody: buildHtmlEmail_({
            greeting: recip.companyName + ' 様',
            lead: 'デタウリ.Detauri に新しい商品が入荷しました！',
            sections: [{
              title: '新着商品 ' + newProducts.length + '点',
              items: sampleItems
            }],
            cta: { text: '新着商品をチェック', url: SITE_CONSTANTS.SITE_URL },
            notes: [
              '人気商品は早い者勝ちです。\n会員様は確保時間が30分に延長されますので、ログインしてからお買い物をお楽しみください。',
              'このメールはメルマガ配信にご登録いただいた方にお送りしています。'
            ],
            unsubscribe: nl_buildUnsubscribeUrl_(recip.email)
          })
        });
        sent++;
      } catch (mailErr) {
        console.error('newArrivalNotifyCron_ mail error: ' + recip.email, mailErr);
      }
    }

    console.log('newArrivalNotifyCron_: 完了 新着=' + newProducts.length + '点, 送信=' + sent + '件');
  } catch (e) {
    console.error('newArrivalNotifyCron_ error:', e);
  }
}
