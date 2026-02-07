const SHIPMAIL_CONFIG = {
  // APP_CONFIG.data.spreadsheetId から取得（一元管理）
  get SPREADSHEET_ID() { return String(APP_CONFIG.data.spreadsheetId || ''); },
  SHEET_NAME: '依頼管理',
  // 通知先メールも APP_CONFIG から取得
  get TO_EMAIL() { return String(APP_CONFIG.notifyEmails || ''); },
  SUBJECT: 'BASEの発送が完了しました',
  STATUS_VALUE: '発送済み',
  // 新列構成: M=発送ステータス, C=会社名/氏名, I=確認リンク, W=予備, X=予備
  COL_STATUS_M: 13,       // M列: 発送ステータス (旧O列)
  COL_CUSTOMER_C: 3,      // C列: 会社名/氏名
  COL_CONFIRM_I: 9,       // I列: 確認リンク (旧K列)
  COL_CARRIER_W: 23,      // W列: 配送業者
  COL_TRACKING_X: 24,     // X列: 追跡番号
  FLAG_COL: 27
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
      SHIPMAIL_CONFIG.COL_CONFIRM_I,
      SHIPMAIL_CONFIG.COL_CARRIER_W,
      SHIPMAIL_CONFIG.COL_TRACKING_X,
      SHIPMAIL_CONFIG.FLAG_COL
    );

    const rowVals = sh.getRange(row, 1, 1, maxCol).getValues()[0];

    const customer = String(rowVals[SHIPMAIL_CONFIG.COL_CUSTOMER_C - 1] || '').trim();
    const carrier = String(rowVals[SHIPMAIL_CONFIG.COL_CARRIER_W - 1] || '').trim();
    const tracking = String(rowVals[SHIPMAIL_CONFIG.COL_TRACKING_X - 1] || '').trim();
    const xlsx = String(rowVals[SHIPMAIL_CONFIG.COL_CONFIRM_I - 1] || '').trim();

    Logger.log('customer=' + customer);
    Logger.log('carrier=' + carrier);
    Logger.log('tracking=' + tracking);
    Logger.log('xlsx=' + xlsx);

    const body =
      'お客様名：' + customer + '\n' +
      '配送業者：' + carrier + '\n' +
      '伝票番号：' + tracking + '\n' +
      'xlsxファイル：' + xlsx + '\n\n' +
      'BASE管理画面から発送手続きを完了してください。';

    Logger.log('sending mail to=' + SHIPMAIL_CONFIG.TO_EMAIL + ' subject=' + SHIPMAIL_CONFIG.SUBJECT);
    MailApp.sendEmail(SHIPMAIL_CONFIG.TO_EMAIL, SHIPMAIL_CONFIG.SUBJECT, body);
    Logger.log('mail sent');

    flagCell.setValue(new Date());
    flagCell.setNumberFormat('yyyy/mm/dd hh:mm:ss');
    Logger.log('flag set at col=' + SHIPMAIL_CONFIG.FLAG_COL);

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
