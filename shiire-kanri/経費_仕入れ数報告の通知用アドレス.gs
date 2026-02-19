const CONFIG_MAILER = {
  SETTINGS_SHEET: "設定",
  RECIPIENT_COL: "K",
  RECIPIENT_START_ROW: 4,
  SHEETS: [
    { name: "仕入れ数報告", subject: "仕入れ点数の報告が完了しました", intro: "仕入れ管理に登録をお願いします。",
      fields: ["タイムスタンプ","報告者","区分コード","仕入れ日","数量"], idHeader: "ID" },
    { name: "経費申請", subject: "経費が申請されました", intro: "経費が申請されましたので、確認してください。",
      fields: ["タイムスタンプ","名前","購入日","商品名","購入場所","購入場所リンク","購入金額","購入証明のためのレシートやスクショ"], idHeader: "ID" }
  ]
};

function handleChange_Mailer(e) { withLock_(30000, function() { processAllPending(); }); }

function processAllPending() {
  const ss = SpreadsheetApp.getActive();
  const recipients = getRecipients(ss);
  if (recipients.length === 0) return;
  CONFIG_MAILER.SHEETS.forEach(def => processPendingForSheet(ss, def, recipients));
}

function processPendingForSheet(ss, def, recipients) {
  const sh = ss.getSheetByName(def.name);
  if (!sh) return;
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return;
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(v => String(v).trim());
  const fieldIdx = {};
  def.fields.forEach(f => fieldIdx[f] = headers.indexOf(f));
  let idIdx = -1;
  if (def.idHeader) { idIdx = headers.indexOf(def.idHeader); }
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  const allProps = PropertiesService.getScriptProperties().getProperties();
  const propsToSet = {};
  data.forEach((row, i) => {
    const rowNumber = i + 2;
    let idValue = "";
    if (idIdx >= 0) idValue = String(row[idIdx]).trim();
    if (!idValue) {
      const firstIdx = def.fields.map(f => fieldIdx[f]).find(idx => idx >= 0);
      const firstVal = firstIdx >= 0 ? String(row[firstIdx]).trim() : "";
      idValue = firstVal ? "row" + rowNumber + "_" + firstVal : "row" + rowNumber;
    }
    const key = propKey(def.name, idValue);
    if (allProps[key]) return;
    const payloadPairs = def.fields.map(f => {
      const idx = fieldIdx[f];
      return { label: f, value: idx >= 0 ? String(row[idx]).trim() : "" };
    });
    const hasData = payloadPairs.some(p => p.value !== "");
    if (!hasData) return;
    const lines = [def.intro, ""];
    payloadPairs.forEach(p => { lines.push(p.label); lines.push(p.value); lines.push(""); });
    const body = lines.join("\n");
    let sentAny = false;
    recipients.forEach(rcpt => {
      try { GmailApp.sendEmail(rcpt, def.subject, body); sentAny = true; } catch (err) { console.error('critical operation failed: send notification email to ' + rcpt + ': ' + (err.message || err)); }
      Utilities.sleep(200);
    });
    if (sentAny) {
      propsToSet[key] = "sent";
      allProps[key] = "sent";
    }
  });
  const keys = Object.keys(propsToSet);
  if (keys.length > 0) {
    PropertiesService.getScriptProperties().setProperties(propsToSet);
  }
}

function getRecipients(ss) {
  const sh = ss.getSheetByName(CONFIG_MAILER.SETTINGS_SHEET);
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  if (lastRow < CONFIG_MAILER.RECIPIENT_START_ROW) return [];
  const col = colLetterToNum_(CONFIG_MAILER.RECIPIENT_COL);
  const vals = sh.getRange(CONFIG_MAILER.RECIPIENT_START_ROW, col, lastRow - CONFIG_MAILER.RECIPIENT_START_ROW + 1, 1).getDisplayValues();
  return Array.from(new Set(vals.map(r => String(r[0]).trim()).filter(s => s && s.indexOf("@") > 0)));
}

function propKey(sheetName, id) { return "mail_sent__" + sheetName + "__" + id; }
function resetMailSent(sheetName, id) { PropertiesService.getScriptProperties().deleteProperty(propKey(sheetName, id)); }
