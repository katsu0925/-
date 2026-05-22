// ContactQueue.gs
// =====================================================
// お問い合わせの非同期処理キュー
// =====================================================
// 【背景】
// 従来 apiSendContactForm は doPost 内でメール2通（管理者+顧客）を同期送信していた。
// 画像添付＋メール送信に10〜30秒かかるため、送信成功後にレスポンスが
// 遅延・崩れると runApi が「失敗」と判定し、自動フォールバック再送＋
// ユーザーの手動再送で同じ問い合わせが何度も重複送信されていた。
//
// 【対策（根本対応）】
// doPost ではシートに「未送信」で記録するだけで即座に応答を返し（1秒以内）、
// 実際のメール送信は cronEvery5min から processContactQueue() で非同期実行する。
//  - doPost が高速化 → 「成功なのに失敗に見える」現象が消える
//  - submitToken による冪等化 → 自動フォールバック・手動再送が来ても重複しない
//  - シートに永続記録 → メール送信失敗時の問い合わせ取りこぼしも防ぐ
//
// 【お問い合わせシートの列】
//  A:受付日時 B:お名前 C:メールアドレス D:お問い合わせ内容 E:ページ
//  F:画像ファイルID(カンマ区切り) G:送信トークン H:ステータス
//  I:処理日時 J:試行回数 K:エラー

var CONTACT_SHEET_NAME = 'お問い合わせ';
var CONTACT_IMAGE_FOLDER_PROP = 'CONTACT_IMAGE_FOLDER_ID';
var CONTACT_MAX_ATTEMPTS = 5;        // この回数失敗したら「送信失敗」にする
var CONTACT_MAX_PER_RUN = 10;        // 1回のcronで処理する最大件数（タイムアウト防止）
var CONTACT_STALE_MIN = 15;          // 「送信中」が何分経過したら再キューするか
var CONTACT_COL_COUNT = 11;
var CONTACT_COLS = {
  DATE: 1, NAME: 2, EMAIL: 3, MESSAGE: 4, PAGE: 5,
  IMAGES: 6, TOKEN: 7, STATUS: 8, PROCESSED_AT: 9, ATTEMPTS: 10, ERROR: 11
};

/** お問い合わせシートを取得（なければ作成） */
function contact_getSheet_() {
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sh = ss.getSheetByName(CONTACT_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONTACT_SHEET_NAME);
    sh.getRange(1, 1, 1, CONTACT_COL_COUNT).setValues([[
      '受付日時', 'お名前', 'メールアドレス', 'お問い合わせ内容', 'ページ',
      '画像ファイルID', '送信トークン', 'ステータス', '処理日時', '試行回数', 'エラー'
    ]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** お問い合わせ添付画像の保存先Driveフォルダを取得（なければ作成） */
function contact_getImageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var fid = String(props.getProperty(CONTACT_IMAGE_FOLDER_PROP) || '').trim();
  if (fid) {
    try { return DriveApp.getFolderById(fid); } catch (e) {}
  }
  var folder = DriveApp.createFolder('デタウリ_お問い合わせ画像');
  props.setProperty(CONTACT_IMAGE_FOLDER_PROP, folder.getId());
  return folder;
}

/** Driveファイルをまとめてゴミ箱へ */
function contact_trashFiles_(fileIds) {
  for (var i = 0; i < fileIds.length; i++) {
    if (!fileIds[i]) continue;
    try { DriveApp.getFileById(fileIds[i]).setTrashed(true); } catch (e) {}
  }
}

/**
 * お問い合わせをキューに登録する（apiSendContactForm から即座に呼ばれる）。
 * メール送信は行わず、シートに「未送信」で記録するだけ。
 * 同一 submitToken の重複登録は無視する（冪等性）。
 */
function contact_enqueue_(params) {
  var name = String((params && params.name) || '').trim();
  var email = String((params && params.email) || '').trim();
  var message = String((params && params.message) || '').trim();
  var page = String((params && params.page) || '').trim();
  var token = String((params && params.submitToken) || '').trim();
  // クライアントがトークンを送らない場合は冪等化なしで継続（毎回ユニーク）
  if (!token) token = Utilities.getUuid();

  // 画像をDriveへ保存（base64をシートに入れると50000字制限を超えるため）
  var images = ((params && params.images) || []).slice(0, 3);
  var fileIds = [];
  if (images.length > 0) {
    var folder = contact_getImageFolder_();
    for (var i = 0; i < images.length; i++) {
      try {
        var bytes = Utilities.base64Decode(images[i].data);
        var blob = Utilities.newBlob(bytes, images[i].type || 'image/jpeg', images[i].name || ('image' + (i + 1) + '.jpg'));
        fileIds.push(folder.createFile(blob).getId());
      } catch (e) {
        console.error('contact_enqueue_ 画像保存失敗:', e);
      }
    }
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(15000); } catch (e) { locked = false; }
  try {
    var sh = contact_getSheet_();
    var lastRow = sh.getLastRow();
    // 冪等性チェック: 同一トークンが既に登録済みならスキップ
    if (lastRow >= 2) {
      var tokens = sh.getRange(2, CONTACT_COLS.TOKEN, lastRow - 1, 1).getValues();
      for (var r = 0; r < tokens.length; r++) {
        if (String(tokens[r][0] || '').trim() === token) {
          contact_trashFiles_(fileIds); // 重複登録 → 今回の画像は不要
          return { ok: true, dedup: true };
        }
      }
    }
    sh.appendRow([
      new Date(), name, email, message, page,
      fileIds.join(','), token, '未送信', '', 0, ''
    ]);
    return { ok: true };
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/**
 * 未送信のお問い合わせをメール送信する（cronEvery5min から呼ばれる）。
 * メール送信中はロックを取らないため doPost を遅延させない。
 */
function processContactQueue() {
  var ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  var sh = ss.getSheetByName(CONTACT_SHEET_NAME);
  if (!sh) return; // まだ問い合わせ無し
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var data = sh.getRange(2, 1, lastRow - 1, CONTACT_COL_COUNT).getValues();
  var now = Date.now();
  var staleMs = CONTACT_STALE_MIN * 60 * 1000;
  var processed = 0;
  var newlyFailed = [];

  for (var i = 0; i < data.length; i++) {
    if (processed >= CONTACT_MAX_PER_RUN) break;
    var rowNum = i + 2;
    var status = String(data[i][CONTACT_COLS.STATUS - 1] || '').trim();

    // 「送信中」のまま CONTACT_STALE_MIN 分以上経過 = 異常終了 → 再キュー
    if (status === '送信中') {
      var procAt = data[i][CONTACT_COLS.PROCESSED_AT - 1];
      if (procAt instanceof Date && (now - procAt.getTime()) > staleMs) {
        status = '未送信';
      } else {
        continue; // 別実行が処理中
      }
    }
    if (status !== '未送信') continue;

    var rec = {
      date: data[i][CONTACT_COLS.DATE - 1],
      name: String(data[i][CONTACT_COLS.NAME - 1] || ''),
      email: String(data[i][CONTACT_COLS.EMAIL - 1] || ''),
      message: String(data[i][CONTACT_COLS.MESSAGE - 1] || ''),
      imageIds: String(data[i][CONTACT_COLS.IMAGES - 1] || '').split(',').filter(function(s) { return s.trim(); })
    };
    var attempts = Number(data[i][CONTACT_COLS.ATTEMPTS - 1] || 0);

    // 「送信中」マーク（同時実行・異常終了による重複送信を防ぐ）
    sh.getRange(rowNum, CONTACT_COLS.STATUS).setValue('送信中');
    sh.getRange(rowNum, CONTACT_COLS.PROCESSED_AT).setValue(new Date());
    SpreadsheetApp.flush();
    processed++;

    try {
      contact_sendMails_(rec);
      sh.getRange(rowNum, CONTACT_COLS.STATUS).setValue('送信済み');
      sh.getRange(rowNum, CONTACT_COLS.PROCESSED_AT).setValue(new Date());
      sh.getRange(rowNum, CONTACT_COLS.ATTEMPTS).setValue(attempts + 1);
      sh.getRange(rowNum, CONTACT_COLS.ERROR).setValue('');
      contact_trashFiles_(rec.imageIds); // 送信済みの画像はDriveから削除
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      attempts++;
      sh.getRange(rowNum, CONTACT_COLS.ATTEMPTS).setValue(attempts);
      sh.getRange(rowNum, CONTACT_COLS.ERROR).setValue(msg);
      if (attempts >= CONTACT_MAX_ATTEMPTS) {
        sh.getRange(rowNum, CONTACT_COLS.STATUS).setValue('送信失敗');
        newlyFailed.push(rec.name + ' <' + rec.email + '>: ' + msg);
      } else {
        sh.getRange(rowNum, CONTACT_COLS.STATUS).setValue('未送信'); // 次回cronで再試行
      }
      console.error('processContactQueue 送信失敗 row=' + rowNum + ':', e);
    }
  }

  // 規定回数失敗した問い合わせは dispatcher 経由でLINE通知させる
  if (newlyFailed.length > 0) {
    throw new Error('お問い合わせメール送信失敗 ' + newlyFailed.length + '件:\n' + newlyFailed.join('\n'));
  }
}

/**
 * 1件のお問い合わせについて管理者宛・顧客宛メールを送信する。
 * 管理者宛が失敗した場合は throw（行は再試行される）。
 * 顧客宛のみ失敗した場合は警告ログのみ（管理者宛は届いており、再試行で
 * 管理者宛を二重送信しないため）。
 */
function contact_sendMails_(rec) {
  var name = rec.name, email = rec.email, message = rec.message;
  var datetime = (rec.date instanceof Date)
    ? Utilities.formatDate(rec.date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
    : String(rec.date || '');

  // Driveから添付画像を取得
  var attachments = [];
  for (var i = 0; i < rec.imageIds.length; i++) {
    try { attachments.push(DriveApp.getFileById(rec.imageIds[i]).getBlob()); } catch (e) {}
  }

  // --- 1. 管理者宛通知（返信ボタンでお客様に直接返信可能） ---
  var adminTo = (function() {
    try { return PropertiesService.getScriptProperties().getProperty('CONTACT_ADMIN_EMAILS') || (SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'); }
    catch (e) { return SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'; }
  })();
  var adminSubject = '【デタウリ.Detauri】お問い合わせ: ' + name;
  var adminBody = 'お問い合わせを受信しました。\n'
    + 'このメールに返信すると ' + email + ' 宛に送信されます。\n\n'
    + 'お名前: ' + name + '\n'
    + 'メールアドレス: ' + email + '\n'
    + '日時: ' + datetime + '\n'
    + (attachments.length > 0 ? '添付画像: ' + attachments.length + '枚\n' : '')
    + '\n--- お問い合わせ内容 ---\n'
    + message + '\n'
    + '\n━━━ 返信テンプレート ━━━\n\n'
    + name + ' 様\n\n'
    + 'お問い合わせいただきありがとうございます。\n'
    + 'デタウリ.Detauriでございます。\n\n'
    + '\n\n'
    + '──────────────────\n'
    + 'デタウリ.Detauri\n'
    + 'https://wholesale.nkonline-tool.com/\n'
    + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
    + '──────────────────\n';

  var adminHtmlBody = buildHtmlEmail_({
    lead: 'お問い合わせを受信しました。<br>このメールに返信すると <strong>' + email + '</strong> 宛に送信されます。',
    sections: [
      {
        title: 'お問い合わせ情報',
        rows: [
          { label: 'お名前', value: name },
          { label: 'メールアドレス', value: email },
          { label: '日時', value: datetime }
        ].concat(attachments.length > 0 ? [{ label: '添付画像', value: attachments.length + '枚' }] : [])
      },
      {
        title: 'お問い合わせ内容',
        text: message
      },
      {
        title: '返信テンプレート（コピーしてご利用ください）',
        text: name + ' 様\n\n'
          + 'お問い合わせいただきありがとうございます。\n'
          + 'デタウリ.Detauriでございます。\n\n'
          + '\n\n'
          + '──────────────────\n'
          + 'デタウリ.Detauri\n'
          + 'https://wholesale.nkonline-tool.com/\n'
          + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL
      }
    ]
  });

  var adminMailOpts = {
    to: adminTo,
    replyTo: email,
    subject: adminSubject,
    body: adminBody,
    htmlBody: adminHtmlBody
  };
  if (attachments.length > 0) adminMailOpts.attachments = attachments;
  MailApp.sendEmail(adminMailOpts); // 失敗時は throw → 行は再試行される

  // --- 2. 顧客宛確認メール（失敗しても throw しない＝管理者宛の二重送信防止） ---
  try {
    var custSubject = '【デタウリ.Detauri】お問い合わせを受け付けました';
    var custBody = name + ' 様\n\n'
      + 'お問い合わせいただきありがとうございます。\n'
      + '以下の内容で受け付けました。2営業日以内にご連絡いたします。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ お問い合わせ内容\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + 'お名前：' + name + '\n'
      + 'メールアドレス：' + email + '\n'
      + '日時：' + datetime + '\n\n'
      + message + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '※ このメールは自動送信です。\n'
      + '  このメールへの返信はお控えください。\n\n'
      + '──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    var custHtmlBody2 = buildHtmlEmail_({
      greeting: name + ' 様',
      lead: 'お問い合わせいただきありがとうございます。\n以下の内容で受け付けました。2営業日以内にご連絡いたします。',
      sections: [
        {
          title: 'お問い合わせ内容',
          rows: [
            { label: 'お名前', value: name },
            { label: 'メールアドレス', value: email },
            { label: '日時', value: datetime }
          ]
        },
        {
          title: '',
          text: message
        }
      ],
      notes: [
        'このメールは自動送信です。',
        'このメールへの返信はお控えください。'
      ]
    });

    GmailApp.sendEmail(email, custSubject, custBody, {
      from: SITE_CONSTANTS.CUSTOMER_EMAIL,
      replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
      htmlBody: custHtmlBody2
    });
  } catch (e) {
    console.error('contact_sendMails_ 顧客宛メール送信失敗（管理者宛は送信済み）:', e);
  }
}
