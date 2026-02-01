const ACCESS_TOKEN = 'JFY7/Af0zPbgyeBSeie1hMOLcMgx1fPfsnpwnB+mxNaKMFTN5A6iNlIkhe/n1Wfy3cvH5ySVJZ1PEIUAGBsXVsHMWFyx+BYoWA4PhIIKp9y5iZf6HwOXty+tIJCoA4Ap4oIUdr3htabt5rTj47ShPgdB04t89/1O/w1cDnyilFU=';
const TO_ID = 'C4c444a421bc6cb92ad4127c2d9c5c850';

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
      to: TO_ID,
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
        Authorization: 'Bearer ' + ACCESS_TOKEN
      }
    };
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', options);
    sh.getRange(i + 1, 28).setValue(true);
  }
}
