// BASE購入LINE通知.gs
function getLineAccessToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN') || '';
}
function getLineToId_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TO_ID') || '';
}

/**
 * 業務用LINEグループへテキストを1通送る共通ヘルパー。
 * 宛先は受注通知・朝の業務サマリーと同じ LINE_TO_ID（スクリプトプロパティ）。
 *
 * @param {string} message 送る本文
 * @param {string} [label] ログに出す識別子（受付番号など）
 * @return {boolean} 送信できたら true（未設定・失敗時は false）
 */
function line_pushToGroup_(message, label) {
  var suffix = label ? ' (' + label + ')' : '';
  var token = getLineAccessToken_();
  var toId = getLineToId_();
  if (!token || !toId) {
    console.warn('LINE未設定のため送信スキップ' + suffix);
    return false;
  }
  try {
    var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: toId, messages: [{ type: 'text', text: message }] }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('LINE通知エラー' + suffix + ': HTTP ' + code + ' ' + resp.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    console.error('LINE通知送信失敗' + suffix + ': ' + (e.message || e));
    return false;
  }
}

function notifyUnsentRequests() {
  // 列構成: A=受付番号, B=依頼日時, C=会社名/氏名, H=商品名, AB=受注通知, AD=備考
  // トリガーからも動作するようID指定で開く（getActiveSpreadsheetはトリガー非対応の場合がある）
  const ss = SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
  const sh = ss.getSheetByName('依頼管理');
  const data = sh.getDataRange().getValues();
  const sentRows = [];
  for (let i = 1; i < data.length; i++) {
    const flag = data[i][27];  // AB列 (index 27) = 受注通知フラグ
    const isFalse = (flag === false) || (String(flag).toUpperCase() === 'FALSE');
    if (!isFalse) continue;
    const receiptNo = data[i][0];   // A列: 受付番号
    if (!receiptNo) continue;
    const rawDate = data[i][1];     // B列: 依頼日時
    let dateStr = '';
    if (rawDate instanceof Date) {
      dateStr = Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    } else {
      dateStr = String(rawDate);
    }
    const companyName = data[i][2]; // C列: 会社名/氏名
    const productName = data[i][7]; // H列: 商品名
    const note = data[i][29];       // AD列: 備考
    const message =
      '受付番号: ' + receiptNo + '\n' +
      '依頼日時: ' + dateStr + '\n' +
      '会社名: ' + companyName + '\n' +
      '商品名:\n' + productName + '\n' +
      '備考: ' + note;
    const payload = JSON.stringify({
      to: getLineToId_(),
      messages: [{
        type: 'text',
        text: message
      }]
    });
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      headers: {
        Authorization: 'Bearer ' + getLineAccessToken_()
      }
    };
    try {
      var resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', options);
      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        console.error('LINE通知エラー (受付番号=' + receiptNo + '): HTTP ' + code + ' ' + resp.getContentText());
        continue;
      }
    } catch (lineErr) {
      console.error('LINE通知送信失敗 (受付番号=' + receiptNo + '): ' + (lineErr.message || lineErr));
      continue;
    }
    sentRows.push(i + 1);
  }
  // バッチでフラグ更新
  if (sentRows.length > 0) {
    const ranges = sentRows.map(r => sh.getRange(r, 28));
    const rangeList = sh.getRangeList(ranges.map(r => r.getA1Notation()));
    rangeList.setValue(true);
  }
}
