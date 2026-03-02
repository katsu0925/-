// 発送通知.gs
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
  COL_STATUS_M: 19,        // S列: 発送ステータス
  COL_STATUS_P: 22,        // V列: ステータス
  COL_CARRIER_W: 20,       // T列: 配送業者
  COL_TRACKING_X: 21,      // U列: 伝票番号
  FLAG_COL: 29,            // AC列: 発送通知
  COL_PAYMENT_ID_AF: 16,  // P列: 決済ID（KOMOJUのみ）
  COL_TRACKING_URL: 34    // AH列: 追跡URL
};

/**
 * 配送業者名と伝票番号から追跡URLを生成
 * @param {string} carrier - 配送業者名
 * @param {string} trackingNo - 伝票番号
 * @return {string} 追跡URL（対応業者がない場合は空文字）
 */
function buildTrackingUrl_(carrier, trackingNo) {
  if (!carrier || !trackingNo) return '';
  var c = carrier.toLowerCase();
  // クロネコヤマト / ヤマト運輸
  if (c.indexOf('ヤマト') !== -1 || c.indexOf('yamato') !== -1 || c.indexOf('クロネコ') !== -1 || c.indexOf('kuroneko') !== -1) {
    return 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number=' + encodeURIComponent(trackingNo);
  }
  // 佐川急便
  if (c.indexOf('佐川') !== -1 || c.indexOf('sagawa') !== -1) {
    return 'https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=' + encodeURIComponent(trackingNo);
  }
  // 日本郵便 / ゆうパック / ゆうパケット
  if (c.indexOf('郵便') !== -1 || c.indexOf('ゆうパック') !== -1 || c.indexOf('ゆうパケット') !== -1 || c.indexOf('japan post') !== -1) {
    return 'https://trackings.post.japanpost.jp/services/srv/search/?requestNo1=' + encodeURIComponent(trackingNo) + '&search.x=1';
  }
  // 西濃運輸
  if (c.indexOf('西濃') !== -1 || c.indexOf('seino') !== -1) {
    return 'https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=' + encodeURIComponent(trackingNo);
  }
  // 福山通運
  if (c.indexOf('福山') !== -1 || c.indexOf('fukuyama') !== -1) {
    return 'https://corp.fukutsu.co.jp/situation/tracking_no_hunt/' + encodeURIComponent(trackingNo);
  }
  return '';
}

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
    const trackingUrl = buildTrackingUrl_(carrier, trackingNo);

    Logger.log('receiptNo=' + receiptNo);
    Logger.log('customer=' + customer);
    Logger.log('trackingUrl=' + trackingUrl);

    // AH列に追跡URLを書き込み
    if (trackingUrl) {
      sh.getRange(row, SHIPMAIL_CONFIG.COL_TRACKING_URL).setValue(trackingUrl);
    }

    // --- 管理者宛通知メール ---
    const adminSubject = '発送通知: 受付番号 ' + receiptNo;
    const adminBody =
      '受付番号「' + receiptNo + '」が発送されました。\n\n' +
      'お客様名：' + customer + '\n';

    var adminHtmlBody = buildHtmlEmail_({
      lead: '受付番号「' + receiptNo + '」が発送されました。',
      sections: [
        {
          title: '発送情報',
          rows: [
            { label: 'お客様名', value: customer }
          ]
        }
      ]
    });

    Logger.log('sending admin mail to=' + SHIPMAIL_CONFIG.TO_EMAIL + ' subject=' + adminSubject);
    MailApp.sendEmail({
      to: SHIPMAIL_CONFIG.TO_EMAIL,
      subject: adminSubject,
      body: adminBody,
      htmlBody: adminHtmlBody
    });
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
      if (trackingUrl) {
        custBody += '\n■ 配送状況の確認\n'
          + '下記URLから配送状況をご確認いただけます。\n'
          + trackingUrl + '\n';
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
        + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
        + '──────────────────\n';

      // HTML版を構築
      var shipRows = [
        { label: '受付番号', value: receiptNo },
        { label: '合計点数', value: totalCount + '点' },
        { label: '合計金額', value: Number(totalAmount).toLocaleString() + '円（税込）' }
      ];
      if (carrier) shipRows.push({ label: '配送業者', value: carrier });
      if (trackingNo) shipRows.push({ label: '伝票番号', html: !!trackingUrl, value: trackingUrl
        ? '<a href="' + trackingUrl + '" style="color:#1a73e8">' + trackingNo + '</a>'
        : trackingNo });

      var shipHtmlSections = [{ title: '発送内容', rows: shipRows }];

      if (trackingUrl) {
        shipHtmlSections.push({
          title: '配送状況の確認',
          text: '下記のリンクから配送状況をご確認いただけます。'
        });
      }

      if (selectionList) {
        shipHtmlSections.push({ title: '選択商品', text: selectionList });
      }

      if (confirmLink) {
        shipHtmlSections.push({
          title: 'ご注文明細（Google Drive）',
          text: '以下のリンクからご注文内容をご確認いただけます。',
          link: { url: confirmLink, text: 'ご注文明細を開く' }
        });
      }

      var shipCta = trackingUrl
        ? { text: '配送状況を確認', url: trackingUrl }
        : (confirmLink ? { text: 'ご注文明細を確認', url: confirmLink } : null);

      var custHtmlBody = buildHtmlEmail_({
        greeting: customer + ' 様',
        lead: 'デタウリ.Detauri をご利用いただきありがとうございます。\n下記の内容で商品を発送いたしました。',
        sections: shipHtmlSections,
        cta: shipCta,
        notes: [
          '商品到着まで今しばらくお待ちください。',
          '到着後、内容にご不明点がございましたらお気軽にお問い合わせください。'
        ]
      });

      MailApp.sendEmail({ to: contactEmail, subject: custSubject, body: custBody, htmlBody: custHtmlBody, noReply: true, bcc: SHIPMAIL_CONFIG.TO_EMAIL });
      Logger.log('customer mail sent to=' + contactEmail);

      // Phase 4-2: LINE発送通知
      try {
        lineNotifyShipping_(contactEmail, {
          receiptNo: receiptNo,
          carrier: carrier,
          trackingNumber: trackingNo,
          trackingUrl: trackingUrl
        });
      } catch(e) { Logger.log('optional: lineNotifyShipping_: ' + (e.message || e)); }
    }

    flagCell.setValue(new Date());
    flagCell.setNumberFormat('yyyy/mm/dd hh:mm:ss');
    Logger.log('flag set at col=' + SHIPMAIL_CONFIG.FLAG_COL);

    // P列(ステータス)を自動で「完了」に更新
    sh.getRange(row, SHIPMAIL_CONFIG.COL_STATUS_P).setValue('完了');
    Logger.log('status set to 完了 at col=' + SHIPMAIL_CONFIG.COL_STATUS_P);

    // Q列(入金確認)を自動で「対応済」に更新（P列=決済IDありの注文のみ到達するため無条件でOK）
    sh.getRange(row, 17).setValue('対応済');
    Logger.log('入金確認 set to 対応済 at col=17');

    // 顧客の購入回数を更新
    try { updatePurchaseCount_(contactEmail); } catch (pcErr) {
      Logger.log('updatePurchaseCount_ error: ' + (pcErr && pcErr.stack ? pcErr.stack : String(pcErr)));
    }

    Logger.log('--- shipMailOnEdit END (success) ---');
  } catch (err) {
    Logger.log('ERROR: ' + (err && err.stack ? err.stack : String(err)));
    throw err;
  }
}

/**
 * GASエディタから実行: T列+U列が入力済み＆AH列が空の全行に追跡URLを一括生成
 * メール送信はしない
 */
function generateTrackingUrls() {
  var ss = SpreadsheetApp.openById(SHIPMAIL_CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHIPMAIL_CONFIG.SHEET_NAME);
  if (!sh) { console.log('依頼管理シートが見つかりません'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { console.log('データがありません'); return; }

  var data = sh.getRange(2, 1, lastRow - 1, SHIPMAIL_CONFIG.COL_TRACKING_URL).getValues();
  var count = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var carrier = String(row[SHIPMAIL_CONFIG.COL_CARRIER_W - 1] || '').trim();
    var trackingNo = String(row[SHIPMAIL_CONFIG.COL_TRACKING_X - 1] || '').trim();
    var existingUrl = String(row[SHIPMAIL_CONFIG.COL_TRACKING_URL - 1] || '').trim();

    if (existingUrl || !carrier || !trackingNo) continue;

    var url = buildTrackingUrl_(carrier, trackingNo);
    if (url) {
      sh.getRange(i + 2, SHIPMAIL_CONFIG.COL_TRACKING_URL).setValue(url);
      count++;
    }
  }

  console.log('追跡URL生成完了: ' + count + '件');
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
  } catch (x) { console.log('optional: event info extraction: ' + (x.message || x)); }
  return o;
}
