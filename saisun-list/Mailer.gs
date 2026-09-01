// =====================================================
// Mailer.gs — 販促メール専用の送信ラッパー
// =====================================================
// 目的: Gmail無料枠(100通/日)の奪い合いを解消する。
//
// 購読者98人に対しGmail枠は100通/日しかなく、
//   10:00 新着通知(98通) → 10:30 週3メルマガ(98通) → 11:00 フォローアップ
// が同じ枠を共食いして、後発の施策が黙って落ちていた。
//
// 方針: 「販促メール」だけを Brevo(無料300通/日) に逃がし、
//       「取引メール」(受注確認・発送通知・決済督促・パスワード再設定など)は
//       従来どおり GmailApp を直接使う。取引メールの確実性を最優先し、
//       外部サービス障害の影響を受けさせないため。
//
// 【この関数を使うもの = 販促メール】
//   Newsletter.gs / WeeklyNewsletter.gs / NewArrivalNotify.gs /
//   FollowupEmail.gs / AbandonedCart.gs / PointExpiry.gs
//
// 【使わないもの = 取引メール】
//   発送通知.gs / 受注管理.gs / SubmitFix.gs / KOMOJU.gs /
//   PaymentReminder.gs / CustomerAuth.gs / ContactQueue.gs / ApiPublic.gs
//
// 【セットアップ】mail_setupGuide() をGASエディタで実行すると手順が出ます。
//   BREVO_API_KEY が未設定の間は自動的に GmailApp にフォールバックするため、
//   設定前でも従来どおり動きます（枠は100通/日のまま）。
// =====================================================

var MAILER_CONFIG = {
  ENDPOINT: 'https://api.brevo.com/v3/smtp/email',
  KEY_PROP: 'BREVO_API_KEY',
  SENDER_PROP: 'BREVO_SENDER',      // 例: noreply@nkonline-tool.com
  SENDER_NAME: 'デタウリ.Detauri',
  DAILY_CAP: 300,                   // Brevo無料プランの1日上限
  SAFETY_MARGIN: 10,                // 予備枠
  COUNT_PROP_PREFIX: 'BREVO_SENT_', // BREVO_SENT_yyyyMMdd (UTC)
  GMAIL_SAFETY_MARGIN: 5            // フォールバック時に取引メール用へ残す枠
};

/**
 * Brevo送信が使える状態か（APIキーと差出人アドレスの両方が設定済み）
 * @return {boolean}
 */
function mail_brevoEnabled_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var key = String(p.getProperty(MAILER_CONFIG.KEY_PROP) || '').trim();
    var sender = String(p.getProperty(MAILER_CONFIG.SENDER_PROP) || '').trim();
    return !!(key && sender && sender.indexOf('@') !== -1);
  } catch (e) {
    return false;
  }
}

/**
 * 本日の送信数カウンタのキー。
 * Brevoの日次上限はUTC基準でリセットされるため、カウンタもUTC日付で持つ。
 * 販促cronは9:00〜11:00 JST = 0:00〜2:00 UTC に集中しており、
 * UTC日付で数えるとリセット直後から1日分をフルに使える。
 * @return {string}
 */
function mail_todayKey_() {
  return MAILER_CONFIG.COUNT_PROP_PREFIX +
    Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
}

/**
 * 本日すでにBrevoで送った通数
 * @return {number}
 */
function mail_sentToday_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty(mail_todayKey_())) || 0;
  } catch (e) {
    return 0;
  }
}

/** 送信数カウンタを加算（前日分のキーは cronDaily4To6 の掃除で消える） */
function mail_bumpSentCount_(n) {
  try {
    var p = PropertiesService.getScriptProperties();
    var k = mail_todayKey_();
    p.setProperty(k, String((Number(p.getProperty(k)) || 0) + (n || 1)));
  } catch (e) {
    // カウンタが壊れてもSAFETY_MARGINで吸収する
    console.log('optional: mail_bumpSentCount_: ' + (e.message || e));
  }
}

/**
 * 販促メールに使える本日の残り通数。
 * 各cronは送信ループの前にこれを見て、送れる分だけ送る（分割配信）。
 * @return {number}
 */
function mail_remainingBulkQuota_() {
  if (mail_brevoEnabled_()) {
    return Math.max(0, MAILER_CONFIG.DAILY_CAP - mail_sentToday_() - MAILER_CONFIG.SAFETY_MARGIN);
  }
  // 未設定時はGmail枠。取引メール用のマージンを引いて返す
  try {
    return Math.max(0, MailApp.getRemainingDailyQuota() - MAILER_CONFIG.GMAIL_SAFETY_MARGIN);
  } catch (e) {
    return 0;
  }
}

/**
 * 販促メールを1通送る。
 * Brevo未設定なら GmailApp にフォールバックするので、呼び出し側は分岐不要。
 *
 * 失敗時は例外を投げる。メッセージには呼び出し側の既存のエラー分類
 * (/invalid email/ → 配信不可フラグ、/quota|too many|limit/ → 翌日持ち越し)
 * に合う語を含めてある。
 *
 * @param {string} to 宛先
 * @param {string} subject 件名
 * @param {string} body テキスト本文
 * @param {object} [options] { htmlBody, replyTo, name, bcc }
 * @return {boolean} 送信できたら true
 */
function mail_sendBulk_(to, subject, body, options) {
  var opts = options || {};
  var addr = String(to || '').trim();
  if (!addr || addr.indexOf('@') === -1) {
    throw new Error('invalid email: ' + addr);
  }

  if (!mail_brevoEnabled_()) {
    GmailApp.sendEmail(addr, subject, body, {
      from: SITE_CONSTANTS.CUSTOMER_EMAIL,
      replyTo: opts.replyTo || SITE_CONSTANTS.CUSTOMER_EMAIL,
      htmlBody: opts.htmlBody,
      bcc: opts.bcc
    });
    return true;
  }

  var props = PropertiesService.getScriptProperties();
  var payload = {
    sender: {
      email: String(props.getProperty(MAILER_CONFIG.SENDER_PROP) || '').trim(),
      name: MAILER_CONFIG.SENDER_NAME
    },
    // 返信は今までどおり運用中のGmailに届く
    replyTo: { email: opts.replyTo || SITE_CONSTANTS.CUSTOMER_EMAIL },
    to: [opts.name ? { email: addr, name: String(opts.name) } : { email: addr }],
    subject: String(subject || ''),
    textContent: String(body || '')
  };
  if (opts.htmlBody) payload.htmlContent = String(opts.htmlBody);
  if (opts.bcc) payload.bcc = [{ email: String(opts.bcc) }];

  var res = UrlFetchApp.fetch(MAILER_CONFIG.ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'api-key': String(props.getProperty(MAILER_CONFIG.KEY_PROP) || '').trim(),
      'accept': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code === 200 || code === 201 || code === 202) {
    mail_bumpSentCount_(1);
    return true;
  }

  var text = String(res.getContentText() || '').substring(0, 200);

  // 402=クレジット不足 / 429=レート上限 → 「quota」を含めて翌日持ち越しさせる
  if (code === 402 || code === 429) {
    throw new Error('quota: Brevo daily limit reached (HTTP ' + code + ') ' + text);
  }
  // 宛先不正 → 呼び出し側が顧客管理P列に配信不可を立てる
  if (code === 400 && /invalid.*email|email.*invalid|invalid_parameter/i.test(text)) {
    throw new Error('invalid email: ' + text);
  }
  throw new Error('Brevo送信失敗 (HTTP ' + code + '): ' + text);
}

// =====================================================
// セットアップ・確認用（GASエディタから手動実行）
// =====================================================

/**
 * セットアップ手順を表示する。
 * APIキーはこの関数では受け取らない（ログや会話に平文で残さないため）。
 */
function mail_setupGuide() {
  var guide = [
    '── Brevo 送信セットアップ手順 ──',
    '',
    '1) https://www.brevo.com/ で無料アカウントを作成（クレジットカード不要・300通/日）',
    '',
    '2) Senders, Domains & Dedicated IPs → Domains → Add a domain',
    '   nkonline-tool.com を追加すると DKIM/DMARC 等のDNSレコードが表示される',
    '',
    '3) 表示されたレコードを Cloudflare の nkonline-tool.com のDNSに追加し、',
    '   Brevo側で Verify を押す（緑になればOK）',
    '',
    '4) SMTP & API → API Keys → Generate a new API key でキーを発行',
    '',
    '5) Apps Scriptエディタ → 左下「プロジェクトの設定」→ スクリプト プロパティ に追加:',
    '     ' + MAILER_CONFIG.KEY_PROP + '  = 発行したAPIキー',
    '     ' + MAILER_CONFIG.SENDER_PROP + '   = noreply@nkonline-tool.com',
    '   ※ キーはここに直接貼る。チャットやログには残さないこと',
    '',
    '6) mail_testBrevo() を実行して自分宛に1通届くか確認',
    '',
    '設定が終わるまでは自動的にGmail送信のまま動作します（枠100通/日）。'
  ].join('\n');
  console.log(guide);
  return guide;
}

/**
 * 設定状態の確認（キーの中身は出さない）
 */
function mail_brevoStatus() {
  var p = PropertiesService.getScriptProperties();
  var key = String(p.getProperty(MAILER_CONFIG.KEY_PROP) || '').trim();
  var sender = String(p.getProperty(MAILER_CONFIG.SENDER_PROP) || '').trim();
  var status = {
    brevo有効: mail_brevoEnabled_(),
    APIキー: key ? '設定済み(' + key.length + '文字)' : '未設定',
    差出人: sender || '未設定',
    本日の送信数: mail_sentToday_(),
    本日の残り枠: mail_remainingBulkQuota_(),
    Gmail残枠: (function () { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return '取得不可'; } })()
  };
  console.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * 自分宛にテスト送信（GASエディタから手動実行）
 */
function mail_testBrevo() {
  var to = SITE_CONSTANTS.CUSTOMER_EMAIL;
  var sent = mail_sendBulk_(to, '【テスト】デタウリ 販促メール送信テスト',
    'これは Mailer.gs のテスト送信です。\n経路: ' + (mail_brevoEnabled_() ? 'Brevo' : 'Gmail(フォールバック)') + '\n',
    {
      htmlBody: buildHtmlEmail_({
        greeting: 'テスト送信',
        lead: 'これは Mailer.gs のテスト送信です。\n経路: ' + (mail_brevoEnabled_() ? 'Brevo' : 'Gmail(フォールバック)')
      })
    });
  console.log('mail_testBrevo: sent=' + sent + ' to=' + to + ' 経路=' + (mail_brevoEnabled_() ? 'Brevo' : 'Gmail'));
  return sent;
}

/**
 * 古い送信数カウンタを掃除する（cronDaily4To6 から呼ぶ）
 * BREVO_SENT_yyyyMMdd のうち、当日分以外を削除。
 */
function mail_cleanupSentCounters_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var all = p.getProperties();
    var today = mail_todayKey_();
    var removed = 0;
    for (var k in all) {
      if (k.indexOf(MAILER_CONFIG.COUNT_PROP_PREFIX) === 0 && k !== today) {
        p.deleteProperty(k);
        removed++;
      }
    }
    if (removed) console.log('mail_cleanupSentCounters_: ' + removed + '件削除');
  } catch (e) {
    console.log('optional: mail_cleanupSentCounters_: ' + (e.message || e));
  }
}
