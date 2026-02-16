const SHIPMAIL_CONFIG = {
  // APP_CONFIG.data.spreadsheetId から取得（一元管理）
  get SPREADSHEET_ID() { return String(APP_CONFIG.data.spreadsheetId || ''); },
  SHEET_NAME: '依頼管理',
  // 通知先メールも APP_CONFIG から取得
  get TO_EMAIL() { return String(APP_CONFIG.notifyEmails || ''); },
  STATUS_VALUE: '発送済み',
  COL_RECEIPT_NO: 1,      // A列: 受付番号
  COL_CUSTOMER_C: 3,      // C列: 会社名/氏名
  COL_CONTACT_D: 4,       // D列: 連絡先メール
  COL_CONFIRM_LINK_I: 9,  // I列: 確認リンク
  COL_SELECTION_J: 10,     // J列: 選択リスト
  COL_COUNT_K: 11,         // K列: 合計点数
  COL_AMOUNT_L: 12,        // L列: 合計金額
  COL_STATUS_M: 13,        // M列: 発送ステータス
  COL_STATUS_P: 16,        // P列: ステータス
  COL_CARRIER_W: 23,       // W列: 配送業者
  COL_TRACKING_X: 24,      // X列: 伝票番号
  FLAG_COL: 21,            // U列: 発送通知フラグ（AA列は受注通知フラグ専用）
  COL_PAYMENT_ID_AF: 32   // AF列: 決済ID（KOMOJUのみ）
};

function shipMailOnEdit(e) {
  try {
    Logger.log('--- shipMailOnEdit START ---');
    Logger.log('event=' + JSON.stringify(safeEvent_(e)));

    if (!e || !e.range) {
      Logger.log('STOP: e or e.range is missing');
      return;
    }

    const sh = e.range.getSheet();
    if (!sh) {
      Logger.log('STOP: sheet is missing');
      return;
    }

    const ss = sh.getParent();
    Logger.log('sheet=' + sh.getName() + ' ssId=' + (ss && ss.getId ? ss.getId() : ''));

    if (sh.getName() !== SHIPMAIL_CONFIG.SHEET_NAME) {
      Logger.log('STOP: sheet name mismatch');
      return;
    }

    if (ss.getId && ss.getId() !== SHIPMAIL_CONFIG.SPREADSHEET_ID) {
      Logger.log('STOP: spreadsheet id mismatch');
      return;
    }

    const row = e.range.getRow();
    const col = e.range.getColumn();
    Logger.log('edited row=' + row + ' col=' + col);

    if (row < 2) {
      Logger.log('STOP: header row');
      return;
    }

    if (col !== SHIPMAIL_CONFIG.COL_STATUS_M) {
      Logger.log('STOP: not O column edit');
      return;
    }

    const newValue = String((typeof e.value !== 'undefined' ? e.value : e.range.getValue()) || '').trim();
    Logger.log('newValue=' + newValue);

    if (newValue !== SHIPMAIL_CONFIG.STATUS_VALUE) {
      Logger.log('STOP: newValue is not 発送済み');
      return;
    }

    const flagCell = sh.getRange(row, SHIPMAIL_CONFIG.FLAG_COL);
    const flagged = String(flagCell.getValue() || '').trim();
    Logger.log('flagged=' + flagged);

    if (flagged) {
      Logger.log('STOP: already notified');
      return;
    }

    const maxCol = Math.max(
      SHIPMAIL_CONFIG.COL_STATUS_M,
      SHIPMAIL_CONFIG.COL_CUSTOMER_C,
      SHIPMAIL_CONFIG.COL_RECEIPT_NO,
      SHIPMAIL_CONFIG.COL_TRACKING_X,
      SHIPMAIL_CONFIG.COL_PAYMENT_ID_AF
    );

    const rowVals = sh.getRange(row, 1, 1, maxCol).getValues()[0];

    // --- AF列（決済ID）チェック: KOMOJU注文のみ通知 ---
    const paymentId = String(rowVals[SHIPMAIL_CONFIG.COL_PAYMENT_ID_AF - 1] || '').trim();
    if (!paymentId) {
      Logger.log('STOP: AF列(決済ID)が空 — KOMOJU注文ではないため通知スキップ');
      return;
    }

    const receiptNo = String(rowVals[SHIPMAIL_CONFIG.COL_RECEIPT_NO - 1] || '').trim();
    const customer = String(rowVals[SHIPMAIL_CONFIG.COL_CUSTOMER_C - 1] || '').trim();
    const contactEmail = String(rowVals[SHIPMAIL_CONFIG.COL_CONTACT_D - 1] || '').trim();
    const confirmLink = String(rowVals[SHIPMAIL_CONFIG.COL_CONFIRM_LINK_I - 1] || '').trim();
    const selectionList = String(rowVals[SHIPMAIL_CONFIG.COL_SELECTION_J - 1] || '').trim();
    const totalCount = rowVals[SHIPMAIL_CONFIG.COL_COUNT_K - 1] || 0;
    const totalAmount = rowVals[SHIPMAIL_CONFIG.COL_AMOUNT_L - 1] || 0;
    const carrier = String(rowVals[SHIPMAIL_CONFIG.COL_CARRIER_W - 1] || '').trim();
    const trackingNo = String(rowVals[SHIPMAIL_CONFIG.COL_TRACKING_X - 1] || '').trim();

    Logger.log('receiptNo=' + receiptNo);
    Logger.log('customer=' + customer);

    // --- 管理者宛通知メール ---
    const adminSubject = '発送通知: 受付番号 ' + receiptNo;
    const adminBody =
      '受付番号「' + receiptNo + '」が発送されました。\n\n' +
      'お客様名：' + customer + '\n';

    Logger.log('sending admin mail to=' + SHIPMAIL_CONFIG.TO_EMAIL + ' subject=' + adminSubject);
    MailApp.sendEmail(SHIPMAIL_CONFIG.TO_EMAIL, adminSubject, adminBody);
    Logger.log('admin mail sent');

    // --- 顧客宛発送通知メール（Drive共有リンク付き） ---
    if (contactEmail && contactEmail.indexOf('@') !== -1) {
      var custSubject = '【デタウリ.Detauri】商品を発送しました（受付番号：' + receiptNo + '）';
      var custBody = customer + ' 様\n\n'
        + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
        + '下記の内容で商品を発送いたしました。\n\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '■ 発送内容\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '受付番号：' + receiptNo + '\n'
        + '合計点数：' + totalCount + '点\n'
        + '合計金額：' + Number(totalAmount).toLocaleString() + '円（税込）\n';

      if (carrier) {
        custBody += '配送業者：' + carrier + '\n';
      }
      if (trackingNo) {
        custBody += '伝票番号：' + trackingNo + '\n';
      }

      // 選択商品リスト
      if (selectionList) {
        custBody += '\n■ 選択商品\n' + selectionList + '\n';
      }

      custBody += '━━━━━━━━━━━━━━━━━━━━\n\n';

      // Google Drive 共有リンク
      if (confirmLink) {
        custBody += '■ ご注文明細（Google Drive）\n'
          + '以下のリンクからご注文内容をご確認いただけます。\n'
          + confirmLink + '\n\n';
      }

      custBody += '商品到着まで今しばらくお待ちください。\n'
        + '到着後、内容にご不明点がございましたらお気軽にお問い合わせください。\n\n'
        + '──────────────────\n'
        + 'デタウリ.Detauri\n'
        + 'https://wholesale.nkonline-tool.com/\n'
        + 'お問い合わせ：nkonline1030@gmail.com\n'
        + '──────────────────\n';

      MailApp.sendEmail({ to: contactEmail, subject: custSubject, body: custBody, noReply: true });
      Logger.log('customer mail sent to=' + contactEmail);
    }

    flagCell.setValue(new Date());
    flagCell.setNumberFormat('yyyy/mm/dd hh:mm:ss');
    Logger.log('flag set at col=' + SHIPMAIL_CONFIG.FLAG_COL);

    // P列(ステータス)を自動で「完了」に更新
    sh.getRange(row, SHIPMAIL_CONFIG.COL_STATUS_P).setValue('完了');
    Logger.log('status set to 完了 at col=' + SHIPMAIL_CONFIG.COL_STATUS_P);

    Logger.log('--- shipMailOnEdit END (success) ---');
  } catch (err) {
    Logger.log('ERROR: ' + (err && err.stack ? err.stack : String(err)));
    throw err;
  }
}

function installShipMailTrigger() {
  const ss = SpreadsheetApp.openById(SHIPMAIL_CONFIG.SPREADSHEET_ID);

  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'shipMailOnEdit') {
      ScriptApp.deleteTrigger(t);
    }
  }

  ScriptApp.newTrigger('shipMailOnEdit').forSpreadsheet(ss).onEdit().create();
}

function testShipMailForRow(rowNumber) {
  const ss = SpreadsheetApp.openById(SHIPMAIL_CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHIPMAIL_CONFIG.SHEET_NAME);
  if (!sh) throw new Error('依頼管理シートが見つかりません');

  const rng = sh.getRange(rowNumber, SHIPMAIL_CONFIG.COL_STATUS_M, 1, 1);
  const e = {
    range: rng,
    value: SHIPMAIL_CONFIG.STATUS_VALUE
  };
  shipMailOnEdit(e);
}

function safeEvent_(e) {
  if (!e) return null;
  const o = {};
  try {
    if (e.value !== undefined) o.value = e.value;
    if (e.oldValue !== undefined) o.oldValue = e.oldValue;
    if (e.authMode !== undefined) o.authMode = String(e.authMode);
    if (e.triggerUid !== undefined) o.triggerUid = String(e.triggerUid);
    if (e.user !== undefined) o.user = String(e.user);
    if (e.range) {
      o.rangeA1 = e.range.getA1Notation();
      o.row = e.range.getRow();
      o.col = e.range.getColumn();
      o.sheet = e.range.getSheet().getName();
    }
  } catch (x) {}
  return o;
}
