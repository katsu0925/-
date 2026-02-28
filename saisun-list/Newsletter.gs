// Newsletter.gs
// =====================================================
// ニュースレター配信システム (Phase 3-2)
// 管理者が定期的にメール配信
// =====================================================

/**
 * ニュースレターシートを取得（なければ作成）
 */
function getNewsletterSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('ニュースレター');
  if (!sheet) {
    sheet = ss.insertSheet('ニュースレター');
    sheet.appendRow(['タイトル', '本文', '配信日時', 'ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 4).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

// =====================================================
// メニューから実行
// =====================================================

/**
 * メニューから実行: ニュースレター登録ダイアログ（HTML版）
 */
function registerNewsletter() {
  var recipients = getNewsletterRecipients_();
  var html = HtmlService.createHtmlOutput(
    '<style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:-apple-system,sans-serif;padding:16px;color:#333}' +
      'label{display:block;font-weight:600;margin:12px 0 4px;font-size:13px}' +
      'label:first-child{margin-top:0}' +
      'input[type=text],input[type=datetime-local],textarea,select{' +
        'width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px;font-family:inherit}' +
      'textarea{height:140px;resize:vertical;line-height:1.6}' +
      'input:focus,textarea:focus,select:focus{outline:none;border-color:#1a73e8;box-shadow:0 0 0 2px rgba(26,115,232,.2)}' +
      '.tpl-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}' +
      '.tpl-btn{padding:6px 12px;border-radius:16px;font-size:12px;cursor:pointer;border:1px solid #dadce0;background:#fff;color:#1a73e8;white-space:nowrap}' +
      '.tpl-btn:hover{background:#e8f0fe}' +
      '.tpl-btn.loading{opacity:.5;pointer-events:none}' +
      '.info{color:#5f6368;font-size:12px;margin-top:4px}' +
      '.actions{margin-top:14px;display:flex;gap:8px;justify-content:flex-end}' +
      'button{padding:8px 20px;border-radius:4px;font-size:14px;cursor:pointer;border:none}' +
      '.btn-primary{background:#1a73e8;color:#fff}' +
      '.btn-primary:hover{background:#1557b0}' +
      '.btn-cancel{background:#f1f3f4;color:#333}' +
      '.btn-cancel:hover{background:#e0e0e0}' +
      '.result{margin-top:12px;padding:10px;border-radius:4px;font-size:13px;display:none}' +
      '.result.ok{display:block;background:#e6f4ea;color:#1e7e34}' +
      '.result.ng{display:block;background:#fce8e6;color:#c5221f}' +
    '</style>' +
    '<label>テンプレートから作成</label>' +
    '<div class="tpl-row">' +
      '<span class="tpl-btn" onclick="genTpl(this,\'new_arrivals\')">新着商品</span>' +
      '<span class="tpl-btn" onclick="genTpl(this,\'weekly_summary\')">入荷まとめ</span>' +
      '<span class="tpl-btn" onclick="genTpl(this,\'sale\')">セール告知</span>' +
      '<span class="tpl-btn" onclick="genTpl(this,\'seasonal\')">季節の挨拶</span>' +
    '</div>' +
    '<label>タイトル</label>' +
    '<input type="text" id="title" placeholder="例: 夏のセール開催のお知らせ">' +
    '<label>本文</label>' +
    '<textarea id="body" placeholder="テンプレートを選択するか、直接入力してください&#10;&#10;改行はそのまま反映されます"></textarea>' +
    '<label>配信日時</label>' +
    '<input type="datetime-local" id="schedule">' +
    '<div class="info">空欄の場合、次の朝9時に自動配信されます</div>' +
    '<div class="info" style="margin-top:8px">配信対象: <b>' + recipients.length + '人</b>（メルマガ登録済み会員）</div>' +
    '<div class="actions">' +
      '<button class="btn-cancel" onclick="google.script.host.close()">キャンセル</button>' +
      '<button class="btn-primary" id="submitBtn" onclick="submit()">登録</button>' +
    '</div>' +
    '<div class="result" id="result"></div>' +
    '<script>' +
      'var TPLS={' +
        'new_arrivals:{title:"新着商品入荷のお知らせ",body:"いつもデタウリ.Detauriをご利用いただきありがとうございます。\\n\\n新着商品が入荷しました！\\n\\n・（ブランド名 / カテゴリ / サイズ  ¥価格）\\n・（ブランド名 / カテゴリ / サイズ  ¥価格）\\n・（ブランド名 / カテゴリ / サイズ  ¥価格）\\n\\n他にも多数の商品を取り揃えております。\\nぜひサイトをご覧ください。\\n\\n' + SITE_CONSTANTS.SITE_URL + '"},' +
        'weekly_summary:{title:"今週の在庫まとめ",body:"いつもデタウリ.Detauriをご利用いただきありがとうございます。\\n\\n現在の取扱商品をまとめてご案内いたします。\\n\\n【在庫状況】全 ○○ 点\\n価格帯: ¥○○○ 〜 ¥○○○\\n\\n■ ブランドA（○点）\\n■ ブランドB（○点）\\n■ ブランドC（○点）\\n\\n最低注文数: 5点から承ります。\\n詳しくはサイトをご覧ください。\\n\\n' + SITE_CONSTANTS.SITE_URL + '"},' +
        'sale:{title:"【期間限定】セール開催のお知らせ",body:"いつもデタウリ.Detauriをご利用いただきありがとうございます。\\n\\n【期間限定セール開催のお知らせ】\\n\\n下記の期間、対象商品を特別価格にてご提供いたします。\\n\\n期間: ○月○日（○）〜 ○月○日（○）\\n割引: 全品○○%OFF\\n\\n※○○以上ご注文で送料無料\\n※他のクーポンとの併用はできません\\n\\nこの機会にぜひご利用ください。\\n\\n' + SITE_CONSTANTS.SITE_URL + '"},' +
        'seasonal:{title:"' + nlSeasonalTitle_() + '",body:"' + nlSeasonalBody_() + '"}' +
      '};' +
      'function genTpl(el,type){' +
        'var t=TPLS[type];if(!t)return;' +
        'document.getElementById("title").value=t.title;' +
        'document.getElementById("body").value=t.body;' +
      '}' +
      'function submit(){' +
        'var t=document.getElementById("title").value.trim();' +
        'var b=document.getElementById("body").value.trim();' +
        'var s=document.getElementById("schedule").value||"";' +
        'if(!t){alert("タイトルを入力してください");return}' +
        'if(!b){alert("本文を入力してください");return}' +
        'document.getElementById("submitBtn").disabled=true;' +
        'document.getElementById("submitBtn").textContent="登録中...";' +
        'google.script.run' +
          '.withSuccessHandler(function(r){' +
            'var el=document.getElementById("result");' +
            'el.className="result ok";' +
            'el.textContent=r;' +
            'setTimeout(function(){google.script.host.close()},2000)' +
          '})' +
          '.withFailureHandler(function(e){' +
            'var el=document.getElementById("result");' +
            'el.className="result ng";' +
            'el.textContent="エラー: "+e.message;' +
            'document.getElementById("submitBtn").disabled=false;' +
            'document.getElementById("submitBtn").textContent="登録"' +
          '})' +
          '.saveNewsletter_(t,b,s)' +
      '}' +
    '</script>'
  ).setWidth(500).setHeight(540);
  SpreadsheetApp.getUi().showModalDialog(html, 'ニュースレター登録');
}

/**
 * HTMLダイアログから呼ばれるサーバー関数
 */
function saveNewsletter_(title, bodyText, schedule) {
  var sheet = getNewsletterSheet_();
  sheet.appendRow([title, bodyText, schedule || '', '']);
  var recipients = getNewsletterRecipients_();
  return '登録完了（配信対象: ' + recipients.length + '人、配信予定: ' + (schedule || '次の朝9時に自動配信') + '）';
}

/**
 * 季節テンプレートのタイトルを返す（HTML埋め込み用）
 */
function nlSeasonalTitle_() {
  var greetings = { 1:'新年',2:'立春',3:'春',4:'新年度',5:'初夏',6:'梅雨',7:'盛夏',8:'晩夏',9:'初秋',10:'秋',11:'晩秋',12:'年末' };
  return (greetings[new Date().getMonth() + 1] || '新年') + 'のご挨拶';
}

/**
 * 季節テンプレートの本文を返す（HTML埋め込み用、改行は\\nエスケープ）
 */
function nlSeasonalBody_() {
  var msgs = {
    1:  '新年あけましておめでとうございます。\\n本年もデタウリ.Detauriをよろしくお願いいたします。',
    2:  '立春を迎え、少しずつ春の気配が感じられる季節となりました。',
    3:  '春の訪れとともに、新生活の準備が始まる季節ですね。',
    4:  '新年度が始まりました。新しいスタートにふさわしいアイテムをご用意しております。',
    5:  '爽やかな季節となりました。初夏にぴったりのアイテムをご紹介いたします。',
    6:  '梅雨の季節となりましたが、いかがお過ごしでしょうか。',
    7:  '夏本番を迎えました。暑い日が続きますが、いかがお過ごしでしょうか。',
    8:  '残暑が続いておりますが、いかがお過ごしでしょうか。',
    9:  '秋の気配が感じられる季節となりました。秋冬アイテムをご紹介いたします。',
    10: '秋も深まり、衣替えの季節ですね。',
    11: '朝晩の冷え込みが増してまいりました。冬支度はいかがでしょうか。',
    12: '今年も残りわずかとなりました。\\n本年もデタウリ.Detauriをご利用いただきありがとうございました。'
  };
  var msg = msgs[new Date().getMonth() + 1] || msgs[1];
  return 'いつもデタウリ.Detauriをご利用いただきありがとうございます。\\n\\n'
    + msg + '\\n\\n'
    + '当店では引き続き、ブランドアパレルを卸価格にてご提供しております。\\n'
    + '新商品も随時入荷中ですので、ぜひサイトをご確認ください。\\n\\n'
    + 'ご不明な点がございましたら、お気軽にお問い合わせください。\\n\\n'
    + SITE_CONSTANTS.SITE_URL;
}

/**
 * メニューから実行: 管理者宛にテスト送信
 * ニュースレターシートの最新の未配信行を管理者にだけ送信する
 */
function testNewsletterSend() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getNewsletterSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { ui.alert('ニュースレターが登録されていません'); return; }

  // 最新の未配信行を探す
  var data = sheet.getDataRange().getValues();
  var targetRow = -1;
  var title = '', bodyText = '';
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][3] || '').trim() !== '配信済み' && String(data[i][0] || '').trim()) {
      targetRow = i;
      title = String(data[i][0] || '').trim();
      bodyText = String(data[i][1] || '').trim();
      break;
    }
  }
  if (targetRow === -1) { ui.alert('未配信のニュースレターがありません'); return; }

  var adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_OWNER_EMAIL') || '').trim();
  if (!adminEmail) { ui.alert('ADMIN_OWNER_EMAIL が未設定です'); return; }

  // メール残量を表示
  var remaining = MailApp.getRemainingDailyQuota();

  var subject = '【テスト】【デタウリ.Detauri】' + title;
  var body = '（管理者テスト送信）\n\n'
    + adminEmail + ' 様\n\n'
    + bodyText + '\n\n'
    + '──────────────────\n'
    + SITE_CONSTANTS.SITE_NAME + '\n'
    + SITE_CONSTANTS.SITE_URL + '\n'
    + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────\n\n'
    + '※ メルマガ配信停止: （テストのためリンク省略）\n';

  try {
    MailApp.sendEmail({
      to: adminEmail, subject: subject, body: body, noReply: true,
      htmlBody: buildHtmlEmail_({
        greeting: '（管理者テスト送信）',
        lead: bodyText
      })
    });

    var recipients = getNewsletterRecipients_();
    ui.alert(
      'テスト送信完了\n\n' +
      '送信先: ' + adminEmail + '\n' +
      'タイトル: ' + title + '\n\n' +
      '--- メール送信状況 ---\n' +
      '本日の残り送信枠: ' + remaining + '通\n' +
      '配信対象の会員数: ' + recipients.length + '人\n' +
      (recipients.length > remaining ? '⚠ 会員数が残り枠を超えています！配信を分割してください。' : '配信可能です。')
    );
  } catch (e) {
    ui.alert('テスト送信失敗\n\n' + (e.message || e));
  }
}

// =====================================================
// 自動配信（毎日9時）
// =====================================================

/**
 * ニュースレター配信 定期実行（毎日9時）
 * 「未配信」かつ配信日時が過去のものを配信
 */
function newsletterSendCron_() {
  try {
    console.log('newsletterSendCron_: 開始');

    var sheet = getNewsletterSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('newsletterSendCron_: 配信対象なし');
      return;
    }

    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var totalSent = 0;

    for (var i = 1; i < data.length; i++) {
      var title = String(data[i][0] || '').trim();
      var bodyText = String(data[i][1] || '').trim();
      var scheduledAt = data[i][2];
      var status = String(data[i][3] || '').trim();

      if (!title || !bodyText) continue;
      if (status === '配信済み') continue;

      // 配信日時チェック
      if (scheduledAt) {
        var schedDate = new Date(scheduledAt);
        if (schedDate > now) continue; // まだ配信時刻になっていない
      }

      // メルマガ登録済み会員にメール送信
      var recipients = getNewsletterRecipients_();
      var sent = 0;

      for (var r = 0; r < recipients.length; r++) {
        var recip = recipients[r];
        try {
          var subject = '【デタウリ.Detauri】' + title;
          var body = recip.companyName + ' 様\n\n'
            + bodyText + '\n\n'
            + '──────────────────\n'
            + SITE_CONSTANTS.SITE_NAME + '\n'
            + SITE_CONSTANTS.SITE_URL + '\n'
            + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
            + '──────────────────\n\n'
            + '※ メルマガ配信停止: '
            + SITE_CONSTANTS.SITE_URL + '?action=unsubscribe&email=' + encodeURIComponent(recip.email) + '\n';

          MailApp.sendEmail({
            to: recip.email, subject: subject, body: body, noReply: true,
            htmlBody: buildHtmlEmail_({
              greeting: recip.companyName + ' 様',
              lead: bodyText,
              unsubscribe: SITE_CONSTANTS.SITE_URL + '?action=unsubscribe&email=' + encodeURIComponent(recip.email)
            })
          });
          sent++;
        } catch (mailErr) {
          console.error('newsletterSendCron_ mail error: ' + recip.email, mailErr);
        }
      }

      // ステータスを「配信済み」に変更
      sheet.getRange(i + 1, 4).setValue('配信済み');
      totalSent += sent;
      console.log('newsletterSendCron_: "' + title + '" を ' + sent + '件送信');
    }

    console.log('newsletterSendCron_: 完了 合計送信=' + totalSent + '件');
  } catch (e) {
    console.error('newsletterSendCron_ error:', e);
  }
}

/**
 * メルマガ登録済み会員一覧を取得
 * @return {Array<{email: string, companyName: string}>}
 */
function getNewsletterRecipients_() {
  var custSheet = getCustomerSheet_();
  var custData = custSheet.getDataRange().getValues();
  var recipients = [];

  for (var i = 1; i < custData.length; i++) {
    var newsletter = custData[i][CUSTOMER_SHEET_COLS.NEWSLETTER];
    if (newsletter !== true && newsletter !== 'true' && newsletter !== 'TRUE') continue;

    var email = String(custData[i][CUSTOMER_SHEET_COLS.EMAIL] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;

    recipients.push({
      email: email,
      companyName: String(custData[i][CUSTOMER_SHEET_COLS.COMPANY_NAME] || '')
    });
  }

  return recipients;
}

/**
 * メルマガ解除API
 * @param {string} userKey
 * @param {object} params - { email }
 * @return {object} { ok, message }
 */
function apiUnsubscribeNewsletter(userKey, params) {
  try {
    var email = String(params.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) {
      return { ok: false, message: '有効なメールアドレスを入力してください' };
    }

    var customer = findCustomerByEmail_(email);
    if (!customer) {
      // ユーザー列挙攻撃を防ぐため同じメッセージ
      return { ok: true, message: 'メルマガ配信を停止しました' };
    }

    var sheet = getCustomerSheet_();
    sheet.getRange(customer.row, CUSTOMER_SHEET_COLS.NEWSLETTER + 1).setValue(false);

    console.log('メルマガ解除: ' + email);
    return { ok: true, message: 'メルマガ配信を停止しました' };
  } catch (e) {
    console.error('apiUnsubscribeNewsletter error:', e);
    return { ok: false, message: 'メルマガ解除に失敗しました' };
  }
}
