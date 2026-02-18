const SOURCE_SPREADSHEET_ID = '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo';
const SOURCE_SHEET_GID = 1614333946;
const NAME_SHEET_NAME = '配布用リスト';
const NAME_CELL_A1 = 'E1';
const RECEIPT_CELL = 'I1';
const EXPORT_FOLDER_ID = '1lq8Xb_dVwz5skrXlGvrS5epTwEc_yEts';
const REQUEST_SPREADSHEET_ID = '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc';
const REQUEST_SHEET_NAME = '依頼管理';
const HEADER_RECEIPT = '受付番号';
const HEADER_NAME = '会社名/氏名';
const HEADER_LINK = '確認リンク';

function exportDistributionList() {
  const srcSs = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
  const nameSheet = srcSs.getSheetByName(NAME_SHEET_NAME);
  if (!nameSheet) throw new Error('配布用リスト が見つかりません');
  const rawName = String(nameSheet.getRange(NAME_CELL_A1).getDisplayValue() || '').trim();
  if (!rawName) throw new Error('配布用リスト!E1 が空です');
  const receiptNo = String(nameSheet.getRange(RECEIPT_CELL).getDisplayValue() || '').trim();
  if (!receiptNo) throw new Error('配布用リスト!I1（受付番号）が空です');
  const baseName = rawName + '様';
  const exportFileName = baseName + '.xlsx';
  const folder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
  // 同名ファイルが存在する場合は上書き（既存を削除）
  var existingFiles = folder.getFilesByName(exportFileName);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }
  const srcSheet = getSheetById_(srcSs, SOURCE_SHEET_GID);
  const tmpSs = SpreadsheetApp.create('tmp_' + baseName + '_' + Date.now());
  const tmpId = tmpSs.getId();
  const copied = srcSheet.copyTo(tmpSs);
  copied.setName(srcSheet.getName());
  deleteAllExceptSheet_(tmpSs, copied.getSheetId());
  trimColumnBAfterSecondHyphen_(copied);
  trimToDataBoundsStrict_(copied);
  SpreadsheetApp.flush();
  const xlsxBlob = exportSpreadsheetAsXlsxBlob_(tmpId, exportFileName);
  const outFile = folder.createFile(xlsxBlob);
  outFile.setName(exportFileName);
  outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = outFile.getUrl();
  updateRequestSheetLink_(rawName, receiptNo, url);
  DriveApp.getFileById(tmpId).setTrashed(true);
  return { ok: true, url: url, fileName: exportFileName };
}

function updateRequestSheetLink_(name, receiptNo, url) {
  const ss = SpreadsheetApp.openById(REQUEST_SPREADSHEET_ID);
  const sh = ss.getSheetByName(REQUEST_SHEET_NAME);
  if (!sh) throw new Error('依頼管理 シートが見つかりません');
  const lastRow = Math.max(sh.getLastRow(), 1);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const receiptCol = findColByName_(headers, HEADER_RECEIPT);
  const nameCol    = findColByName_(headers, HEADER_NAME);
  const linkCol    = findColByName_(headers, HEADER_LINK);
  if (receiptCol === -1) throw new Error('ヘッダに「' + HEADER_RECEIPT + '」が見つかりません');
  if (nameCol === -1)    throw new Error('ヘッダに「' + HEADER_NAME + '」が見つかりません');
  if (linkCol === -1)    throw new Error('ヘッダに「' + HEADER_LINK + '」が見つかりません');
  const dataRows = lastRow - 1;
  const receiptVals = sh.getRange(2, receiptCol, dataRows, 1).getDisplayValues();
  const nameVals    = sh.getRange(2, nameCol, dataRows, 1).getDisplayValues();
  const targetReceipt = String(receiptNo || '').trim();
  const targetName    = String(name || '').trim();
  let found = false;
  for (let i = 0; i < dataRows; i++) {
    const r = String(receiptVals[i][0] || '').trim();
    const n = String(nameVals[i][0] || '').trim();
    if (r === targetReceipt && n === targetName) {
      sh.getRange(i + 2, linkCol).setValue(url);
      found = true;
    }
  }
  if (!found) {
    const newRow = lastRow + 1;
    sh.getRange(newRow, receiptCol).setValue(targetReceipt);
    sh.getRange(newRow, nameCol).setValue(targetName);
    sh.getRange(newRow, linkCol).setValue(url);
  }
}

function getSheetById_(ss, gid) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  throw new Error('指定gidのシートが見つかりません: ' + gid);
}

function deleteAllExceptSheet_(ss, keepSheetId) {
  const sheets = ss.getSheets();
  for (let i = sheets.length - 1; i >= 0; i--) {
    const sh = sheets[i];
    if (sh.getSheetId() !== keepSheetId) {
      if (ss.getSheets().length > 1) ss.deleteSheet(sh);
    }
  }
}

function trimColumnBAfterSecondHyphen_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  const rng = sheet.getRange(1, 2, lastRow, 1);
  const vals = rng.getDisplayValues();
  for (let i = 0; i < vals.length; i++) {
    const s = String(vals[i][0] || '');
    if (!s) { vals[i][0] = ''; continue; }
    const parts = s.split('-');
    if (parts.length >= 2) { vals[i][0] = parts[0] + '-' + parts[1]; }
    else { vals[i][0] = s; }
  }
  rng.setValues(vals);
}

function trimToDataBoundsStrict_(sheet) {
  const rowCand = Math.max(sheet.getLastRow(), 1);
  const colCand = Math.max(sheet.getLastColumn(), 1);
  const vals = sheet.getRange(1, 1, rowCand, colCand).getDisplayValues();
  let lastR = 1;
  let lastC = 1;
  for (let r = 0; r < vals.length; r++) {
    const row = vals[r];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] || '').trim() !== '') {
        if (r + 1 > lastR) lastR = r + 1;
        if (c + 1 > lastC) lastC = c + 1;
      }
    }
  }
  const maxR = sheet.getMaxRows();
  const maxC = sheet.getMaxColumns();
  if (maxR > lastR) sheet.deleteRows(lastR + 1, maxR - lastR);
  if (maxC > lastC) sheet.deleteColumns(lastC + 1, maxC - lastC);
}

function exportSpreadsheetAsXlsxBlob_(spreadsheetId, filename) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('XLSXエクスポートに失敗しました: ' + code + ' / ' + res.getContentText());
  }
  return res.getBlob().setName(filename);
}
