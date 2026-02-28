// NewArrivalNotify.gs
// =====================================================
// 新着商品通知メール (Phase 3-3)
// 新商品入荷時に登録者へ通知
// =====================================================

/**
 * 新着商品通知メール 定期実行（毎日10時）
 * 前回通知以降に追加された新商品を検出し、
 * メルマガ登録済み会員にメール送信
 */
function newArrivalNotifyCron_() {
  try {
    console.log('newArrivalNotifyCron_: 開始');

    var props = PropertiesService.getScriptProperties();
    var lastTs = props.getProperty('LAST_ARRIVAL_NOTIFY_TS');
    var lastDate = lastTs ? new Date(Number(lastTs)) : new Date(Date.now() - 86400000); // デフォルト24時間前

    // データ1シートから新着商品を検出
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

    // 全商品データを読み込み（A列〜E列: No, 画像, 商品名, ブランド, カテゴリ）
    var dataRange = dataSheet.getRange(headerRow + 1, 1, lastRow - headerRow, 5);
    var values = dataRange.getValues();

    // 新着商品を抽出（行番号で判定: 前回以降に追加された行）
    // より正確にはタイムスタンプが欲しいが、データ1シートにはないので
    // 最終行数をScriptPropertiesで管理する
    var lastNotifiedRow = Number(props.getProperty('LAST_ARRIVAL_NOTIFY_ROW') || '0');
    var currentLastRow = lastRow;

    if (lastNotifiedRow >= currentLastRow) {
      console.log('newArrivalNotifyCron_: 新着商品なし');
      props.setProperty('LAST_ARRIVAL_NOTIFY_TS', String(Date.now()));
      return;
    }

    // 新着商品を収集
    var newProducts = [];
    var startIdx = lastNotifiedRow > headerRow ? (lastNotifiedRow - headerRow) : 0;
    for (var i = startIdx; i < values.length; i++) {
      var productName = String(values[i][2] || '').trim();
      var brand = String(values[i][3] || '').trim();
      if (productName || brand) {
        newProducts.push({
          name: productName,
          brand: brand,
          category: String(values[i][4] || '').trim()
        });
      }
    }

    if (newProducts.length === 0) {
      console.log('newArrivalNotifyCron_: 有効な新着商品なし');
      props.setProperty('LAST_ARRIVAL_NOTIFY_ROW', String(currentLastRow));
      props.setProperty('LAST_ARRIVAL_NOTIFY_TS', String(Date.now()));
      return;
    }

    // 代表的な商品名（最大5件）
    var sampleProducts = newProducts.slice(0, 5);
    var sampleText = '';
    for (var j = 0; j < sampleProducts.length; j++) {
      var p = sampleProducts[j];
      var label = p.brand ? (p.brand + ' ' + p.name) : p.name;
      sampleText += '  ・' + label + '\n';
    }
    if (newProducts.length > 5) {
      sampleText += '  ...他 ' + (newProducts.length - 5) + '点\n';
    }

    // メルマガ登録済み会員にメール送信
    var custSheet = getCustomerSheet_();
    var custData = custSheet.getDataRange().getValues();
    var sent = 0;

    for (var c = 1; c < custData.length; c++) {
      var newsletter = custData[c][CUSTOMER_SHEET_COLS.NEWSLETTER];
      if (newsletter !== true && newsletter !== 'true' && newsletter !== 'TRUE') continue;

      var email = String(custData[c][CUSTOMER_SHEET_COLS.EMAIL] || '').trim();
      var companyName = String(custData[c][CUSTOMER_SHEET_COLS.COMPANY_NAME] || '');
      if (!email || email.indexOf('@') === -1) continue;

      try {
        var subject = '【デタウリ.Detauri】新着商品 ' + newProducts.length + '点が入荷しました';
        var body = companyName + ' 様\n\n'
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
          + '※ 配信停止: ' + nl_buildUnsubscribeUrl_(email) + '\n\n'
          + '──────────────────\n'
          + SITE_CONSTANTS.SITE_NAME + '\n'
          + SITE_CONSTANTS.SITE_URL + '\n'
          + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
          + '──────────────────\n';

        var sampleItems = [];
        for (var si = 0; si < sampleProducts.length; si++) {
          var sp = sampleProducts[si];
          sampleItems.push(sp.brand ? (sp.brand + ' ' + sp.name) : sp.name);
        }
        if (newProducts.length > 5) {
          sampleItems.push('...他 ' + (newProducts.length - 5) + '点');
        }

        MailApp.sendEmail({
          to: email, subject: subject, body: body, noReply: true,
          htmlBody: buildHtmlEmail_({
            greeting: companyName + ' 様',
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
            unsubscribe: nl_buildUnsubscribeUrl_(email)
          })
        });
        sent++;
      } catch (mailErr) {
        console.error('newArrivalNotifyCron_ mail error: ' + email, mailErr);
      }
    }

    // 次回用にタイムスタンプと行数を更新
    props.setProperty('LAST_ARRIVAL_NOTIFY_ROW', String(currentLastRow));
    props.setProperty('LAST_ARRIVAL_NOTIFY_TS', String(Date.now()));

    console.log('newArrivalNotifyCron_: 完了 新着=' + newProducts.length + '点, 送信=' + sent + '件');
  } catch (e) {
    console.error('newArrivalNotifyCron_ error:', e);
  }
}
