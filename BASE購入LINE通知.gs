/**
 * LINE通知の認証情報をPropertiesServiceに設定（GASエディタで1回だけ実行）
 */
function setLineNotifyCredentials() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('LINE_ACCESS_TOKEN', 'ここにアクセストークンを貼り付け');
  p.setProperty('LINE_TO_ID', 'ここにTO_IDを貼り付け');
  console.log('LINE認証情報を設定しました');
}

function getLineAccessToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN') || '';
}
function getLineToId_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TO_ID') || '';
}

function notifyUnsentRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('依頼管理');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const flag = data[i][27];
    const isFalse = (flag === false) || (String(flag).toUpperCase() === 'FALSE');
    if (!isFalse) continue;
    const a = data[i][0];
    if (!a) continue;
    const rawDate = data[i][1];
    let b = '';
    if (rawDate instanceof Date) {
      b = Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    } else {
      b = String(rawDate);
    }
    const e = data[i][4];
    const z = data[i][25];
    const message =
      '受付番号: ' + a + '\n' +
      '依頼日時: ' + b + '\n' +
      '連絡手段: ' + e + '\n' +
      '備考: ' + z;
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
    sh.getRange(i + 1, 28).setValue(true);
  }
}
