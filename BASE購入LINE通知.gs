function getLineAccessToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN') || '';
}
function getLineToId_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TO_ID') || '';
}

function notifyUnsentRequests() {
  // 新列構成: A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, H=商品名, Z=備考
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('依頼管理');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const flag = data[i][26];  // AA列 (index 26) = フラグ
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
    const note = data[i][25];       // Z列: 備考
    const message =
      '受付番号: ' + receiptNo + '\n' +
      '依頼日時: ' + dateStr + '\n' +
      '会社名: ' + companyName + '\n' +
      '商品名: ' + productName + '\n' +
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
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', options);
    sh.getRange(i + 1, 27).setValue(true);  // AA列 (column 27) = フラグ
  }
}
