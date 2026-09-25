// SetupNlHalf0930.gs
// =====================================================
// メルマガ登録者限定 半額クーポン（2026-09-25 配信 / 9/30まで）
//
// 方式: 登録者ごとに個別コード NLHALF-XXXXXX を発行し、
//       クーポン管理シートの R列(限定顧客メール) で本人に縛る（ReturnCoupon.gs と同じ方式）。
//       → コードが他人に回っても使えない。GAS/Worker(coupon.js・submit.js)とも R列を見るので3層整合。
//
// 条件: 50%OFF / 1回限り / 個品・アソート両方 / 会員割引と併用不可 /
//       「¥10,000以上送料無料」の対象外（Coupon.gs NO_THRESHOLD_FREESHIP_COUPON_PREFIXES）
//       初回購入の人は FHP（初回全品半額）が優先適用され、このクーポンは消費されない
//       → 2回目の注文で使える（＝初回半額を使った人も対象）
//
// 実行（GASエディタから）:
//   1. nlHalf0930_sendTest()  … 運営アドレス宛てに本番と同じメールを1通（実コード発行）
//   2. nlHalf0930_sendAll()   … メルマガ登録者全員へ。残枠が足りなければ送れた分で止まり、
//                               再実行すると未送信の人にだけ続きを送る（冪等）
//   確認: nlHalf0930_status()
//
// 注意: シート→D1は5分同期。発行直後の数分は Worker 経路で「無効なクーポン」と出ることがある。
// =====================================================

var NLHALF0930 = {
  PREFIX: 'NLHALF-',
  RATE: 0.50,
  START: '2026-09-25',
  EXPIRES: '2026-09-30',
  MEMO: 'メルマガ登録者限定 半額（2026-09-25配信・9/30まで）',
  TEST_TO: 'nsdktts1030@gmail.com',
  SUBJECT: '【デタウリ.Detauri】メルマガ登録者さま限定｜全品半額クーポン（9/30まで）'
};

/** 紛らわしい文字(0/O/1/I/L)を除いた6桁 */
function nlHalf0930_randomSuffix_() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/**
 * 宛先メールごとのコードを発行（既発行ならそれを返す）。まとめて1回で書き込む。
 * @param {string[]} emails
 * @return {Object} { email(小文字): code }
 */
function nlHalf0930_issueCodes_(emails) {
  // 呼び出し側（nlHalf0930_issueCodesLocked_）が ScriptLock を保持している前提
    var ss = sh_getOrderSs_();
    var sh = sh_ensureCouponSheet_(ss);
    var lastRow = sh.getLastRow();
    var map = {};
    var used = {};
    if (lastRow >= 2) {
      var rows = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
      for (var i = 0; i < rows.length; i++) {
        var c = String(rows[i][COUPON_COLS.CODE] || '').trim().toUpperCase();
        if (!c) continue;
        used[c] = true;
        if (c.indexOf(NLHALF0930.PREFIX) !== 0) continue;
        var em = String(rows[i][COUPON_COLS.TARGET_CUSTOMER_EMAIL] || '').trim().toLowerCase();
        if (em) map[em] = c;
      }
    }

    var start = new Date(NLHALF0930.START + 'T00:00:00+09:00');
    var expires = new Date(NLHALF0930.EXPIRES + 'T00:00:00+09:00');
    var newRows = [];
    for (var j = 0; j < emails.length; j++) {
      var addr = String(emails[j] || '').trim().toLowerCase();
      if (!addr || addr.indexOf('@') === -1 || map[addr]) continue;
      var code;
      do { code = NLHALF0930.PREFIX + nlHalf0930_randomSuffix_(); } while (used[code]);
      used[code] = true;
      map[addr] = code;
      newRows.push([
        code,              // A: コード
        'rate',            // B: 割引タイプ
        NLHALF0930.RATE,   // C: 割引値
        expires,           // D: 有効期限（当日23:59まで有効）
        1,                 // E: 利用上限
        0,                 // F: 利用回数
        true,              // G: 1人1回制限
        true,              // H: 有効
        NLHALF0930.MEMO,   // I: メモ
        'all',             // J: 対象顧客（購入歴を問わない＝初回半額を使った人も対象）
        start,             // K: 有効開始日
        false,             // L: 会員割引併用（不可）
        false,             // M: 30点割引併用（不可）
        'all',             // N: 適用チャネル（個品・アソート両方）
        '',                // O: 対象商品ID（全商品）
        '',                // P: 送料除外商品ID
        '',                // Q: 限定顧客名（表記ゆれで弾かれないよう空）
        addr,              // R: 限定顧客メール
        false              // S: 送料無料併用
      ]);
    }
    if (newRows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, newRows.length, COUPON_COL_COUNT).setValues(newRows);
      SpreadsheetApp.flush();
      try { CacheService.getScriptCache().remove(COUPON_CACHE_KEY); } catch (e) {}
    }
    console.log('nlHalf0930_issueCodes_: 新規 ' + newRows.length + ' 件 / 対象 ' + emails.length + ' 件');
    return map;
}

/**
 * エディタからの手動実行だけを許す。
 * Web App は「匿名アクセス・デプロイ者として実行」なので、公開関数は google.script.run で誰でも呼べる。
 * 匿名実行では getActiveUser() が空になる → エディタで実行したオーナー本人のときだけ通す。
 */
function nlHalf0930_assertEditor_() {
  var active = '', effective = '';
  try { active = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  try { effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!active || active !== effective) throw new Error('この関数はGASエディタから実行してください');
}


function nlHalf0930_bodyText_(code) {
  var url = SITE_CONSTANTS.SITE_URL;
  return [
    'いつもデタウリ.Detauriをご利用いただきありがとうございます。',
    '',
    'メルマガにご登録いただいている方だけに、',
    '9月30日（水）まで使える「全品半額クーポン」をお届けします。',
    '',
    '【あなた専用のクーポンコード】' + code,
    '【割引】ご注文の商品代金が50%OFF',
    '【期間】2026年9月25日（金）〜 9月30日（水）23:59',
    '【対象】個品・アソート商品すべて',
    '',
    '「初回全品半額」でご購入済みの方もお使いいただけます。',
    'カートの「クーポンコード」欄に上のコードを入力してください。',
    '',
    '■ ご利用上の注意',
    '・このメールを受け取ったメールアドレスでのご注文に限りご利用いただけます（コードはお一人様専用です）',
    '・ご利用は1回限りです',
    '・会員割引など他の割引との併用はできません',
    '・クーポンご利用時は「¥10,000以上送料無料」の対象外となり、送料を別途いただきます',
    '・まだ一度もご購入のない方は、初回全品半額が自動で適用されます（このクーポンは使われずに残るので、2回目のご注文でお使いください）',
    '・在庫には限りがございます。なくなり次第終了となります',
    '',
    'ご注文はこちらから',
    url,
    '',
    'ご不明な点がございましたら、お気軽にお問い合わせください。'
  ].join('\n');
}

function nlHalf0930_sendOne_(email, companyName, code) {
  var lead = nlHalf0930_bodyText_(code);
  var greeting = (companyName ? companyName : 'お客') + ' 様';
  var unsub = nl_buildUnsubscribeUrl_(email);
  var body = greeting + '\n\n'
    + lead + '\n\n'
    + '──────────────────\n'
    + SITE_CONSTANTS.SITE_NAME + '\n'
    + SITE_CONSTANTS.SITE_URL + '\n'
    + 'お問い合わせ: ' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────\n\n'
    + '※ メルマガ配信停止: ' + unsub + '\n';
  mail_sendBulk_(email, NLHALF0930.SUBJECT, body, {
    name: companyName || '',
    htmlBody: buildHtmlEmail_({ greeting: greeting, lead: lead, unsubscribe: unsub })
  });
}

// ── 送信記録（宛先ごとに1プロパティ。1値9KB上限に当たらない） ──
// 値 = { e: メール, s: 'SENDING' | 'SENT' | 'ERROR', c: コード }
// SENDING のまま残った宛先（送信中に強制終了）は結果不明として自動再送しない。
var NLHALF0930_KEY_PREFIX = 'NLHALF0930_S_';
var NLHALF0930_RUNNING_PROP = 'NLHALF0930_RUNNING';
var NLHALF0930_RUNNING_STALE_MS = 8 * 60 * 1000; // GAS実行上限6分＋余裕

function nlHalf0930_key_(email) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email).trim().toLowerCase(), Utilities.Charset.UTF_8);
  return NLHALF0930_KEY_PREFIX + d.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 全送信記録 { email: {s, c} }。解析できない記録があれば例外で止める（再送を防ぐ） */
function nlHalf0930_loadStates_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = {};
  Object.keys(all).forEach(function(k) {
    if (k.indexOf(NLHALF0930_KEY_PREFIX) !== 0) return;
    var v = JSON.parse(all[k]);
    if (!v || !v.e || !v.s) throw new Error('送信記録 ' + k + ' が壊れています。送信を中止しました');
    out[String(v.e).toLowerCase()] = v;
  });
  return out;
}

function nlHalf0930_setState_(email, state, code) {
  PropertiesService.getScriptProperties().setProperty(nlHalf0930_key_(email),
    JSON.stringify({ e: String(email).toLowerCase(), s: state, c: code || '' }));
}

/**
 * 配信の実行権を取る。共通 ScriptLock は注文処理と共有なので、ここでは一瞬だけ握って
 * 実行中マーカーを立てるだけにし、送信中は解放しておく。
 */
function nlHalf0930_acquireRun_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = Number(props.getProperty(NLHALF0930_RUNNING_PROP) || 0);
    if (cur && Date.now() - cur < NLHALF0930_RUNNING_STALE_MS) return false;
    props.setProperty(NLHALF0930_RUNNING_PROP, String(Date.now()));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function nlHalf0930_releaseRun_() {
  PropertiesService.getScriptProperties().deleteProperty(NLHALF0930_RUNNING_PROP);
}

/** コード発行（クーポン管理シートへの書込み）だけ短く ScriptLock で排他 */
function nlHalf0930_issueCodesLocked_(emails) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return nlHalf0930_issueCodes_(emails); } finally { lock.releaseLock(); }
}

/** 運営アドレス宛てにテスト送信（実コードを1件発行する＝カートで半額・送料の確認に使える） */
function nlHalf0930_sendTest() {
  nlHalf0930_assertEditor_();
  var to = NLHALF0930.TEST_TO;
  var map = nlHalf0930_issueCodesLocked_([to]);
  nlHalf0930_sendOne_(to, 'テスト', map[to]);
  var msg = 'テスト送信しました → ' + to + ' / コード ' + map[to] + '（D1反映は最大5分後）';
  console.log(msg);
  return msg;
}

/** メルマガ登録者全員へ送信（冪等・残枠や時間が尽きたら止まり、再実行で未送信の人にだけ続きを送る） */
function nlHalf0930_sendAll() {
  nlHalf0930_assertEditor_();
  var todayJst = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  if (todayJst > NLHALF0930.EXPIRES) return '期限（' + NLHALF0930.EXPIRES + '）を過ぎているため送信しません';
  if (!nlHalf0930_acquireRun_()) return '別の実行が進行中です。数分おいて再実行してください';
  try {
    return nlHalf0930_sendAllRun_();
  } finally {
    nlHalf0930_releaseRun_();
  }
}

function nlHalf0930_sendAllRun_() {
  var startedAt = Date.now();
  // 顧客管理に同じメールが複数行あっても1通だけにする
  var seen = {};
  var recipients = getNewsletterRecipients_('全員').filter(function(r) {
    var k = String(r.email || '').trim().toLowerCase();
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
  var states = nlHalf0930_loadStates_();
  var pending = recipients.filter(function(r) { return !states[r.email.toLowerCase()]; });
  if (!pending.length) return '全員処理済みです（' + Object.keys(states).length + '人）';

  var budget = mail_remainingBulkQuota_();
  if (budget <= 0) return '本日の送信枠が残っていません。明日以降に再実行してください（未送信 ' + pending.length + '人）';

  var batch = pending.slice(0, budget);
  var map = nlHalf0930_issueCodesLocked_(batch.map(function(r) { return r.email; }));
  var ok = 0, fail = 0, quotaHit = false, timeUp = false;
  for (var i = 0; i < batch.length; i++) {
    // 6分上限に余裕を残して止める
    if (Date.now() - startedAt > 4 * 60 * 1000) { timeUp = true; break; }
    var r = batch[i];
    var key = r.email.toLowerCase();
    nlHalf0930_setState_(key, 'SENDING', map[key]); // 送信前に処理中を記録（失敗したら送らずに例外で止まる）
    var sendErr = null;
    try {
      nlHalf0930_sendOne_(r.email, r.companyName, map[key]);
    } catch (e) {
      sendErr = e;
    }
    if (!sendErr) {
      ok++;
      // 送信済み。記録更新に失敗しても SENDING のまま残る＝再送されない
      try { nlHalf0930_setState_(key, 'SENT', map[key]); } catch (e2) { console.error('nlHalf0930_sendAll: SENT記録失敗 ' + r.email + ' ' + e2); }
      continue;
    }
    var m = String(sendErr && sendErr.message || sendErr);
    console.error('nlHalf0930_sendAll: ' + r.email + ' ' + m);
    if (/quota|too many|limit/i.test(m)) {
      // 枠切れ＝送られていない → 記録を消して未送信に戻し、再実行で続きから
      PropertiesService.getScriptProperties().deleteProperty(nlHalf0930_key_(key));
      quotaHit = true;
      break;
    }
    fail++;
    if (/invalid email|invalid argument|無効/i.test(m)) {
      try { nl_markCustomerUndeliverable_(r.email, '送信エラー: ' + m.substring(0, 80)); } catch (_) {}
    }
    // 宛先不正・結果不明（通信エラー等）は自動再送しない。status の errors で確認する
    nlHalf0930_setState_(key, 'ERROR', map[key]);
  }

  var after = nlHalf0930_loadStates_();
  var remain = recipients.filter(function(r2) { return !after[r2.email.toLowerCase()]; }).length;
  var msg = '送信 ' + ok + '通 / 失敗 ' + fail + '通 / 未送信 ' + remain + '人'
    + (quotaHit ? '（本日の送信枠切れ）' : '') + (timeUp ? '（時間切れ）' : '')
    + (remain ? '（残りは再実行で続きから送ります）' : '');
  try { appendDeliveryLog_(sh_getOrderSs_(), 'ニュースレター', '', '', '半額クーポン(NLHALF) ' + msg, remain ? '一部送信' : '送信完了'); } catch (_) {}
  console.log('nlHalf0930_sendAll: ' + msg);
  return msg;
}

/** 状況確認: 対象人数・送信済み・失敗/結果不明の宛先・発行済みコード数・利用数 */
function nlHalf0930_status() {
  nlHalf0930_assertEditor_();
  var recipients = getNewsletterRecipients_('全員');
  var states = nlHalf0930_loadStates_();
  var sh = sh_ensureCouponSheet_(sh_getOrderSs_());
  var lastRow = sh.getLastRow();
  var issued = 0, usedCount = 0;
  if (lastRow >= 2) {
    var rows = sh.getRange(2, 1, lastRow - 1, COUPON_COL_COUNT).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][COUPON_COLS.CODE] || '').toUpperCase().indexOf(NLHALF0930.PREFIX) !== 0) continue;
      issued++;
      if (Number(rows[i][COUPON_COLS.USE_COUNT]) > 0) usedCount++;
    }
  }
  var keys = Object.keys(states);
  var out = {
    recipients: recipients.length,
    sent: keys.filter(function(k) { return states[k].s === 'SENT'; }).length,
    errors: keys.filter(function(k) { return states[k].s === 'ERROR'; }),
    unknown: keys.filter(function(k) { return states[k].s === 'SENDING'; }),
    issued: issued,
    used: usedCount,
    remainingQuota: mail_remainingBulkQuota_()
  };
  console.log('nlHalf0930_status: ' + JSON.stringify(out));
  return out;
}
