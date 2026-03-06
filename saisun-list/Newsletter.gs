// Newsletter.gs
// =====================================================
// ニュースレター配信システム
// 定期配信（一度/毎週/毎月）+ AI本文生成 + メルマガ解除
// =====================================================

var NEWSLETTER_AI_CONFIG = {
  MODEL: 'gpt-5-mini',
  ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  MAX_TOKENS: 600,
  TEMPERATURE: 0.7
};

/**
 * ニュースレターシートを取得（なければ作成、7列ヘッダー）
 */
function getNewsletterSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('ニュースレター');
  if (!sheet) {
    sheet = ss.insertSheet('ニュースレター');
    sheet.appendRow(['タイトル', '本文', '配信日時', 'ステータス', '頻度', '最終配信日', '対象']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
    return sheet;
  }
  // 既存シートの後方互換: E・F・G列ヘッダーがなければ追加
  var lastCol = sheet.getLastColumn();
  if (lastCol < 5) sheet.getRange(1, 5).setValue('頻度');
  if (lastCol < 6) sheet.getRange(1, 6).setValue('最終配信日');
  if (lastCol < 7) sheet.getRange(1, 7).setValue('対象');
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
      '.info{color:#5f6368;font-size:12px;margin-top:4px}' +
      '.actions{margin-top:14px;display:flex;gap:8px;justify-content:flex-end}' +
      'button{padding:8px 20px;border-radius:4px;font-size:14px;cursor:pointer;border:none}' +
      '.btn-primary{background:#1a73e8;color:#fff}' +
      '.btn-primary:hover{background:#1557b0}' +
      '.btn-cancel{background:#f1f3f4;color:#333}' +
      '.btn-cancel:hover{background:#e0e0e0}' +
      '.btn-ai{background:#7c3aed;color:#fff;padding:8px 16px;border-radius:4px;font-size:13px;white-space:nowrap}' +
      '.btn-ai:hover{background:#6d28d9}' +
      '.btn-ai:disabled{opacity:.5;cursor:not-allowed}' +
      '.ai-section{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:12px;margin-bottom:12px}' +
      '.ai-row{display:flex;gap:6px;align-items:flex-end}' +
      '.ai-row input{flex:1}' +
      '#aiStatus{font-size:12px;color:#6b7280;margin-top:4px}' +
      '#aiStatus .ok{color:#16a34a}#aiStatus .err{color:#dc2626}' +
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
    '<div class="ai-section">' +
      '<label style="margin-top:0">AI生成</label>' +
      '<div class="ai-row">' +
        '<input type="text" id="aiTheme" placeholder="テーマ例: 春のセール、新着ブランド紹介">' +
        '<button class="btn-ai" id="aiBtn" onclick="generateAI()">AI生成</button>' +
      '</div>' +
      '<div id="aiStatus"></div>' +
    '</div>' +
    '<label>タイトル</label>' +
    '<input type="text" id="title" placeholder="例: 夏のセール開催のお知らせ">' +
    '<label>本文</label>' +
    '<textarea id="body" placeholder="テンプレートを選択するか、AI生成 or 直接入力&#10;&#10;改行はそのまま反映されます"></textarea>' +
    '<label>配信日時</label>' +
    '<input type="datetime-local" id="schedule">' +
    '<div class="info">空欄の場合、次の朝9時に自動配信されます</div>' +
    '<label>配信対象</label>' +
    '<select id="target">' +
      '<option value="全員">全員</option>' +
      '<option value="リピーター">リピーター（購入2回以上）</option>' +
      '<option value="新規">新規（購入0〜1回）</option>' +
    '</select>' +
    '<label>配信頻度</label>' +
    '<select id="freq">' +
      '<option value="一度">一度（通常配信）</option>' +
      '<option value="毎週">毎週</option>' +
      '<option value="毎月">毎月</option>' +
    '</select>' +
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
      'function generateAI(){' +
        'var theme=document.getElementById("aiTheme").value.trim();' +
        'if(!theme){document.getElementById("aiStatus").innerHTML="<span class=\\"err\\">テーマを入力してください</span>";return}' +
        'var btn=document.getElementById("aiBtn");' +
        'btn.disabled=true;' +
        'document.getElementById("aiStatus").textContent="生成中です（10〜15秒）...";' +
        'google.script.run' +
          '.withSuccessHandler(function(r){' +
            'btn.disabled=false;' +
            'if(r&&r.ok){' +
              'document.getElementById("title").value=r.title;' +
              'document.getElementById("body").value=r.body;' +
              'document.getElementById("aiStatus").innerHTML="<span class=\\"ok\\">生成完了</span>";' +
            '}else{' +
              'document.getElementById("aiStatus").innerHTML="<span class=\\"err\\">"+(r&&r.message||"生成に失敗しました")+"</span>";' +
            '}' +
          '})' +
          '.withFailureHandler(function(e){' +
            'btn.disabled=false;' +
            'document.getElementById("aiStatus").innerHTML="<span class=\\"err\\">エラー: "+e.message+"</span>";' +
          '})' +
          '.generateNewsletterAI(theme);' +
      '}' +
      'function submit(){' +
        'var t=document.getElementById("title").value.trim();' +
        'var b=document.getElementById("body").value.trim();' +
        'var s=document.getElementById("schedule").value||"";' +
        'var tg=document.getElementById("target").value;' +
        'var f=document.getElementById("freq").value;' +
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
          '.saveNewsletter(t,b,s,tg,f)' +
      '}' +
    '</script>'
  ).setWidth(520).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'ニュースレター登録');
}

/**
 * 保存 公開ラッパー（google.script.runから呼ぶため _ なし）
 */
function saveNewsletter(title, bodyText, schedule, target, frequency) {
  return saveNewsletter_(title, bodyText, schedule, target, frequency);
}

/**
 * HTMLダイアログから呼ばれるサーバー関数
 */
function saveNewsletter_(title, bodyText, schedule, target, frequency) {
  var sheet = getNewsletterSheet_();
  var freq = frequency || '一度';
  var tgt = target || '全員';
  sheet.appendRow([title, bodyText, schedule || '', '', freq, '', tgt]);
  var recipients = getNewsletterRecipients_(tgt);
  var freqLabel = freq === '一度' ? '' : '（' + freq + '配信）';
  return '登録完了' + freqLabel + '（配信対象: ' + tgt + ' ' + recipients.length + '人、配信予定: ' + (schedule || '次の朝9時に自動配信') + '）';
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

// =====================================================
// AI生成（GPT-4o-mini）
// =====================================================

/**
 * AI生成 公開ラッパー（google.script.runから呼ぶため _ なし）
 */
function generateNewsletterAI(theme) {
  return generateNewsletterAI_(theme);
}

/**
 * AIでニュースレターのタイトルと本文を生成
 * @param {string} theme - テーマ（例: 春のセール、新着ブランド紹介）
 * @return {object} {ok, title, body} or {ok:false, message}
 */
function generateNewsletterAI_(theme) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!apiKey) return { ok: false, message: 'OPENAI_API_KEYが設定されていません' };

    var systemPrompt = 'デタウリ.Detauri（中古ブランドアパレル卸売EC）のメルマガ作成。対象:古着販売の個人事業主。丁寧なB2Bトーン、絵文字不可。JSON出力: {"title":"【デタウリ】で始まる件名","body":"本文(改行は\\n)"}。200〜300文字、末尾にURL https://wholesale.nkonline-tool.com/ を含める。';

    var response = UrlFetchApp.fetch(NEWSLETTER_AI_CONFIG.ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify({
        model: NEWSLETTER_AI_CONFIG.MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'テーマ: ' + String(theme) }
        ],
        max_tokens: NEWSLETTER_AI_CONFIG.MAX_TOKENS,
        temperature: NEWSLETTER_AI_CONFIG.TEMPERATURE,
        response_format: { type: 'json_object' }
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      console.error('OpenAI API error: ' + code + ' ' + response.getContentText());
      return { ok: false, message: 'AI APIエラー（' + code + '）' };
    }

    var json = JSON.parse(response.getContentText());
    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content) return { ok: false, message: 'AI応答が空です' };

    var result = JSON.parse(content);
    return { ok: true, title: result.title || '', body: result.body || '' };
  } catch (e) {
    console.error('generateNewsletterAI_ error:', e);
    return { ok: false, message: '生成に失敗しました: ' + e.message };
  }
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
// 自動配信（毎日9時）— 定期配信対応
// =====================================================

/**
 * ニュースレター配信 定期実行（毎日9時）
 * - 「配信待ち」→ 配信日時が過去なら送信
 * - 「配信中」→ 頻度に応じて再配信（毎週: 7日経過 / 毎月: 月が変わった）
 * - 「停止」「配信済み」→ スキップ
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
      var frequency = String(data[i][4] || '一度').trim(); // E列: 頻度（後方互換）
      var lastSent = data[i][5]; // F列: 最終配信日

      if (!title || !bodyText) continue;
      if (status === '停止' || status === '配信済み') continue;
      if (status !== '' && status !== '配信待ち' && status !== '配信中') continue;

      var shouldSend = false;
      var sheetRow = i + 1;

      if (frequency === '一度' || !frequency) {
        // 通常配信: 配信日時チェック
        if (status === '配信済み') continue;
        if (scheduledAt) {
          var schedDate = new Date(scheduledAt);
          if (schedDate > now) continue;
        }
        shouldSend = true;
      } else if (frequency === '毎週') {
        // 最終配信日から7日以上経過していれば送信
        if (!lastSent || !(lastSent instanceof Date)) {
          // 初回: 配信日時チェック
          if (scheduledAt) {
            var schedDate2 = new Date(scheduledAt);
            if (schedDate2 > now) continue;
          }
          shouldSend = true;
        } else {
          var diffDays = (now.getTime() - new Date(lastSent).getTime()) / (1000 * 60 * 60 * 24);
          shouldSend = (diffDays >= 7);
        }
      } else if (frequency === '毎月') {
        // 月が変わっていれば送信
        if (!lastSent || !(lastSent instanceof Date)) {
          if (scheduledAt) {
            var schedDate3 = new Date(scheduledAt);
            if (schedDate3 > now) continue;
          }
          shouldSend = true;
        } else {
          var lastDate = new Date(lastSent);
          shouldSend = (now.getFullYear() > lastDate.getFullYear() ||
                        now.getMonth() > lastDate.getMonth());
        }
      }

      if (!shouldSend) continue;

      // G列: 配信対象（後方互換: 空なら全員）
      var target = String(data[i][6] || '全員').trim();

      // メルマガ登録済み会員にメール送信（対象フィルタ適用）
      var recipients = getNewsletterRecipients_(target);
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
            + nl_buildUnsubscribeUrl_(recip.email) + '\n';

          MailApp.sendEmail({
            to: recip.email, subject: subject, body: body, noReply: true,
            htmlBody: buildHtmlEmail_({
              greeting: recip.companyName + ' 様',
              lead: bodyText,
              unsubscribe: nl_buildUnsubscribeUrl_(recip.email)
            })
          });
          sent++;
        } catch (mailErr) {
          console.error('newsletterSendCron_ mail error: ' + recip.email, mailErr);
        }
      }

      // ステータスと最終配信日を更新
      if (frequency === '一度' || !frequency) {
        sheet.getRange(sheetRow, 4).setValue('配信済み');
      } else {
        sheet.getRange(sheetRow, 4).setValue('配信中');
      }
      sheet.getRange(sheetRow, 6).setValue(now); // F列: 最終配信日

      // 自動配信ログに記録
      try {
        var logSs = sh_getOrderSs_();
        var logTarget = target !== '全員' ? '（対象: ' + target + '）' : '';
        appendDeliveryLog_(logSs, 'ニュースレター', '', '', '「' + title + '」→ ' + sent + '件送信' + logTarget + '（' + frequency + '）', sent > 0 ? '送信完了' : '対象者なし');
      } catch (logErr) { console.log('optional: newsletter log: ' + (logErr.message || logErr)); }

      totalSent += sent;
      console.log('newsletterSendCron_: "' + title + '" を ' + sent + '件送信（頻度: ' + frequency + '）');
    }

    console.log('newsletterSendCron_: 完了 合計送信=' + totalSent + '件');
  } catch (e) {
    console.error('newsletterSendCron_ error:', e);
  }
}

/**
 * メルマガ登録済み会員一覧を取得（対象フィルタ対応）
 * @param {string} [target] - '全員'(default) / 'リピーター'(購入2回以上) / '新規'(購入0〜1回)
 * @return {Array<{email: string, companyName: string}>}
 */
function getNewsletterRecipients_(target) {
  var tgt = String(target || '全員').trim();
  var custSheet = getCustomerSheet_();
  var custData = custSheet.getDataRange().getValues();
  var recipients = [];

  for (var i = 1; i < custData.length; i++) {
    var newsletter = custData[i][CUSTOMER_SHEET_COLS.NEWSLETTER];
    if (newsletter !== true && newsletter !== 'true' && newsletter !== 'TRUE') continue;

    var email = String(custData[i][CUSTOMER_SHEET_COLS.EMAIL] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;

    // 対象フィルタ: 購入回数(P列)で絞り込み
    if (tgt !== '全員') {
      var purchaseCount = Number(custData[i][CUSTOMER_SHEET_COLS.PURCHASE_COUNT] || 0);
      if (tgt === 'リピーター' && purchaseCount < 2) continue;
      if (tgt === '新規' && purchaseCount >= 2) continue;
    }

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

// =====================================================
// 自動配信ログ
// ニュースレター・休眠クーポン等の自動配信を記録
// =====================================================

var DELIVERY_LOG_SHEET_NAME = '自動配信ログ';
var DELIVERY_LOG_COLS = 6; // A:日時, B:種別, C:メール, D:会社名, E:内容, F:ステータス

/**
 * 自動配信ログシートを取得（なければ作成）
 */
function ensureDeliveryLogSheet_(ss) {
  var sh = ss.getSheetByName(DELIVERY_LOG_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(DELIVERY_LOG_SHEET_NAME);
  sh.appendRow(['日時', '種別', 'メール', '会社名', '内容', 'ステータス']);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, DELIVERY_LOG_COLS).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(5, 300);
  return sh;
}

/**
 * 自動配信ログに1行追記
 */
function appendDeliveryLog_(ss, type, email, companyName, content, status) {
  try {
    var sh = ensureDeliveryLogSheet_(ss);
    sh.appendRow([new Date(), type, email || '', companyName || '', content || '', status || '']);
  } catch (e) {
    console.log('optional: appendDeliveryLog_: ' + (e.message || e));
  }
}

// =====================================================
// 休眠顧客クーポン自動送信
// 最終ログインから一定期間経過した顧客に10%OFFクーポンを送信
// =====================================================

var DORMANT_TIERS = [
  { key: '1Y', days: 365, label: '1年',   code: 'COMEBACK1Y' },
  { key: '6M', days: 180, label: '半年',  code: 'COMEBACK6M' },
  { key: '2M', days: 60,  label: '2ヶ月', code: 'COMEBACK2M' }
];

/**
 * 休眠顧客用クーポンをクーポン管理シートに自動作成（3段階: 2ヶ月/半年/1年）
 * 既に存在するコードはスキップ。GASエディタから手動実行 or cronから自動実行。
 */
function setupDormantCoupons() {
  var ss = sh_getOrderSs_();
  var sh = sh_ensureCouponSheet_(ss);
  var lastRow = sh.getLastRow();

  var existingCodes = {};
  if (lastRow >= 2) {
    var codes = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      existingCodes[String(codes[i][0] || '').trim().toUpperCase()] = true;
    }
  }

  var created = [];
  for (var t = 0; t < DORMANT_TIERS.length; t++) {
    var tier = DORMANT_TIERS[t];
    if (existingCodes[tier.code]) continue;

    var newRow = sh.getLastRow() + 1;
    sh.getRange(newRow, 1, 1, COUPON_COL_COUNT).setValues([[
      tier.code,   // A: コード
      'rate',      // B: 割引タイプ
      0.10,        // C: 割引値 (10%)
      '',          // D: 有効期限（無期限）
      0,           // E: 利用上限（無制限）
      0,           // F: 利用回数
      true,        // G: 1人1回制限
      true,        // H: 有効
      '休眠顧客復帰用（' + tier.label + '未ログイン）自動送信', // I: メモ
      'all',       // J: 対象顧客
      '',          // K: 有効開始日
      false,       // L: 会員割引併用
      false,       // M: 30点割引併用
      'all',       // N: 適用チャネル
      '',          // O: 対象商品ID
      '',          // P: 送料除外商品ID
      '',          // Q: 限定顧客名
      ''           // R: 限定顧客メール
    ]]);
    created.push(tier.code);
  }

  try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) {}
  if (created.length) console.log('setupDormantCoupons: 作成完了 ' + created.join(', '));
  return { ok: true, created: created };
}

/**
 * 休眠顧客クーポンメール送信（毎日9時にcronで実行）
 * 2ヶ月→半年→1年の段階で、未送信の最上位ティアのクーポンを1通送信
 */
function dormantCouponCron_() {
  try {
    console.log('dormantCouponCron_: 開始');
    setupDormantCoupons();

    var custSheet = getCustomerSheet_();
    var custData = custSheet.getDataRange().getValues();
    var now = new Date();
    var props = PropertiesService.getScriptProperties();
    var ss = sh_getOrderSs_();
    var sent = 0;

    // 一括取得でAPI呼び出しを最小化
    var allProps = props.getProperties();

    // クーポン利用履歴を一括読み込み → Setで高速判定
    var usedSet = {};
    var logSh = ss.getSheetByName(COUPON_LOG_SHEET_NAME);
    if (logSh && logSh.getLastRow() >= 2) {
      var logData = logSh.getRange(2, 1, logSh.getLastRow() - 1, 2).getValues();
      for (var l = 0; l < logData.length; l++) {
        usedSet[String(logData[l][0] || '').trim().toUpperCase() + ':' + String(logData[l][1] || '').trim().toLowerCase()] = true;
      }
    }

    for (var i = 1; i < custData.length; i++) {
      var newsletter = custData[i][CUSTOMER_SHEET_COLS.NEWSLETTER];
      if (newsletter !== true && newsletter !== 'true' && newsletter !== 'TRUE') continue;

      var email = String(custData[i][CUSTOMER_SHEET_COLS.EMAIL] || '').trim();
      if (!email || email.indexOf('@') === -1) continue;

      var lastLogin = custData[i][CUSTOMER_SHEET_COLS.LAST_LOGIN];
      if (!lastLogin) continue;

      var lastLoginDate = lastLogin instanceof Date ? lastLogin : new Date(lastLogin);
      if (isNaN(lastLoginDate.getTime())) continue;

      var daysSince = Math.floor((now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24));

      // 最上位の未送信ティアを探す（1Y > 6M > 2M）
      var tierToSend = null;
      var emailLower = email.toLowerCase();
      for (var t = 0; t < DORMANT_TIERS.length; t++) {
        var tier = DORMANT_TIERS[t];
        if (daysSince < tier.days) continue;
        if (allProps['DORMANT_SENT:' + tier.key + ':' + emailLower]) continue;
        if (usedSet[tier.code + ':' + emailLower]) continue;
        tierToSend = tier;
        break;
      }

      if (!tierToSend) continue;

      var companyName = String(custData[i][CUSTOMER_SHEET_COLS.COMPANY_NAME] || '');

      try {
        var subject = '【デタウリ.Detauri】' + companyName + '様へ 10%OFFクーポンをお届けします';
        var body = companyName + ' 様\n\n'
          + 'デタウリ.Detauri をご利用いただきありがとうございます。\n\n'
          + 'ご無沙汰しております。\n'
          + '最近サイトにお越しいただけていないようですので、\n'
          + '感謝の気持ちを込めて10%OFFクーポンをお届けします。\n\n'
          + '━━━━━━━━━━━━━━━━━━━━\n'
          + '■ クーポンコード: ' + tierToSend.code + '\n'
          + '■ 割引: 全品10%OFF\n'
          + '■ 注文時にクーポンコードを入力してください\n'
          + '━━━━━━━━━━━━━━━━━━━━\n\n'
          + '▼ お買い物はこちら\n'
          + SITE_CONSTANTS.SITE_URL + '\n\n'
          + '※ お1人様1回限りのクーポンです。\n'
          + '※ 他のクーポンとの併用はできません。\n\n'
          + '──────────────────\n'
          + SITE_CONSTANTS.SITE_NAME + '\n'
          + SITE_CONSTANTS.SITE_URL + '\n'
          + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
          + '──────────────────\n\n'
          + '※ メルマガ配信停止: '
          + nl_buildUnsubscribeUrl_(email) + '\n';

        MailApp.sendEmail({
          to: email, subject: subject, body: body, noReply: true,
          htmlBody: buildHtmlEmail_({
            greeting: companyName + ' 様',
            lead: 'ご無沙汰しております。\n最近サイトにお越しいただけていないようですので、\n感謝の気持ちを込めて10%OFFクーポンをお届けします。',
            sections: [{
              title: 'クーポン情報',
              rows: [
                { label: 'クーポンコード', value: tierToSend.code },
                { label: '割引', value: '全品10%OFF' }
              ],
              text: '注文時にクーポンコードを入力してください。'
            }],
            cta: { text: 'お買い物はこちら', url: SITE_CONSTANTS.SITE_URL },
            notes: [
              'お1人様1回限りのクーポンです。',
              '他のクーポンとの併用はできません。'
            ],
            unsubscribe: nl_buildUnsubscribeUrl_(email)
          })
        });

        props.setProperty('DORMANT_SENT:' + tierToSend.key + ':' + emailLower, String(Date.now()));
        appendDeliveryLog_(ss, '休眠クーポン(' + tierToSend.label + ')', email, companyName, tierToSend.code + ' / 10%OFF', '送信完了');
        sent++;
        console.log('dormantCouponCron_: ' + tierToSend.key + ' 送信 ' + email);
      } catch (mailErr) {
        appendDeliveryLog_(ss, '休眠クーポン(' + tierToSend.label + ')', email, companyName, tierToSend.code, '送信失敗: ' + (mailErr.message || mailErr));
        console.error('dormantCouponCron_ mail error: ' + email, mailErr);
      }
    }

    // 古い送信済みフラグをクリーンアップ（2年以上前のものを削除）
    var cutoff = Date.now() - (730 * 24 * 60 * 60 * 1000);
    var keysToDelete = [];
    for (var key in allProps) {
      if (key.indexOf('DORMANT_SENT:') !== 0) continue;
      var ts = Number(allProps[key]);
      if (ts && ts < cutoff) keysToDelete.push(key);
    }
    for (var d = 0; d < keysToDelete.length; d++) {
      try { props.deleteProperty(keysToDelete[d]); } catch (e2) {}
    }
    if (keysToDelete.length) {
      console.log('dormantCouponCron_: 古いフラグ ' + keysToDelete.length + '件を削除');
    }

    console.log('dormantCouponCron_: 完了 送信=' + sent + '件');
  } catch (e) {
    console.error('dormantCouponCron_ error:', e);
  }
}

/** メルマガ配信停止URLを組み立てる（フロントエンド側で処理） */
function nl_buildUnsubscribeUrl_(email) {
  return SITE_CONSTANTS.SITE_URL + '?action=unsubscribe&email=' + encodeURIComponent(email);
}
