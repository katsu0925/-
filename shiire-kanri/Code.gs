function doGet(e) {
  const id = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : "";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return HtmlService.createHtmlOutput("<p>スプレッドシートに紐づいたGASで実行してください。</p>");

  const master = ss.getSheetByName("マスタ");
  if (!master) return HtmlService.createHtmlOutput("<p>シート「マスタ」が見つかりません。</p>");

  const sheet = ss.getSheetByName("商品管理");
  if (!sheet) return HtmlService.createHtmlOutput("<p>シート「商品管理」が見つかりません。</p>");

  const hashText = master.getRange("H2").getDisplayValue();
  const hashLine = "#" + hashText;
  const hashSuffix = "商品多数ございますので、ぜひご覧ください";

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return HtmlService.createHtmlOutput("<p>「商品管理」にデータがありません。</p>");

  const hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const idxId = hdr.indexOf("管理番号");
  const idxBrand = hdr.indexOf("ブランド");
  const idxSize = hdr.indexOf("メルカリサイズ");
  const idxColor = hdr.indexOf("カラー");
  const idxPocket = hdr.indexOf("ポケット詳細");
  const idxDesign = hdr.indexOf("デザイン特徴");
  const idxDamage = hdr.indexOf("傷汚れ詳細");
  const idxChaku = hdr.indexOf("着丈");
  const idxKata = hdr.indexOf("肩幅");
  const idxMihaba = hdr.indexOf("身幅");
  const idxSode = hdr.indexOf("袖丈");
  const idxYuki = hdr.indexOf("裄丈");
  const idxSous = hdr.indexOf("総丈");
  const idxWaist = hdr.indexOf("ウエスト");
  const idxKao = hdr.indexOf("股上");
  const idxKasha = hdr.indexOf("股下");
  const idxWatari = hdr.indexOf("ワタリ");
  const idxSodeh = hdr.indexOf("裾幅");
  const idxHip = hdr.indexOf("ヒップ");

  if (idxId === -1) return HtmlService.createHtmlOutput("<p>「商品管理」にヘッダー「管理番号」が見つかりません。</p>");

  if (!id) {
    return HtmlService.createHtmlOutput(buildIdListHtml_(sheet, idxId));
  }

  const idRange = sheet.getRange(2, idxId + 1, lastRow - 1, 1);
  const found = idRange.createTextFinder(id).matchEntireCell(true).findNext();

  if (!found) {
    return HtmlService.createHtmlOutput("<p>該当レコードが見つかりません (ID:" + escapeHtml_(id) + ")</p>" + buildIdListHtml_(sheet, idxId));
  }

  const rowNum = found.getRow();
  const row = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  const data = {
    id: row[idxId] || "",
    brand: idxBrand === -1 ? "" : (row[idxBrand] || ""),
    size: idxSize === -1 ? "" : (row[idxSize] || ""),
    color: idxColor === -1 ? "" : (row[idxColor] || ""),
    pocket: idxPocket === -1 ? "" : (row[idxPocket] || ""),
    design: idxDesign === -1 ? "" : (row[idxDesign] || ""),
    damage: idxDamage === -1 ? "" : (row[idxDamage] || ""),
    chaku: idxChaku === -1 ? "" : (row[idxChaku] || ""),
    kata: idxKata === -1 ? "" : (row[idxKata] || ""),
    mihaba: idxMihaba === -1 ? "" : (row[idxMihaba] || ""),
    sode: idxSode === -1 ? "" : (row[idxSode] || ""),
    yuki: idxYuki === -1 ? "" : (row[idxYuki] || ""),
    sous: idxSous === -1 ? "" : (row[idxSous] || ""),
    waist: idxWaist === -1 ? "" : (row[idxWaist] || ""),
    kao: idxKao === -1 ? "" : (row[idxKao] || ""),
    kasha: idxKasha === -1 ? "" : (row[idxKasha] || ""),
    watari: idxWatari === -1 ? "" : (row[idxWatari] || ""),
    sodeh: idxSodeh === -1 ? "" : (row[idxSodeh] || ""),
    hip: idxHip === -1 ? "" : (row[idxHip] || "")
  };

  const kw = getKeywordData_(ss, id);
  data.market = kw.market;
  data.reason = kw.reason;
  data.link = kw.link;

  let kws = kw.keywords.slice();
  for (let j = kws.length - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [kws[j], kws[r]] = [kws[r], kws[j]];
  }

  const sizeLabel = String(data.size) === "フリーサイズ" ? "F" : String(data.size || "");
  const prefix = `${data.id}【${sizeLabel}】${data.brand}`;
  const titleTokens = [prefix];

  kws.forEach(k => {
    const cand = titleTokens.concat(k).join(" ");
    if (cand.length <= 40) titleTokens.push(k);
  });
  data.generatedTitle = titleTokens.join(" ").trim();

  let desc = "";
  desc += "【割引情報】\nフォロー割→【100円OFF】\n※1000円以下の商品は対象外になります\n\n";
  desc += "【商品情報】\n";
  if (data.brand) desc += "☆ブランド\n" + data.brand + "\n\n";
  if (data.color) desc += "☆カラー\n" + data.color + "\n\n";
  desc += "☆サイズ\n平置き素人採寸になります。\n";

  const mapKey = {
    chaku: "着丈", kata: "肩幅", mihaba: "身幅",
    sode: "袖丈", yuki: "裄丈", sous: "総丈",
    waist: "ウエスト", kao: "股上", kasha: "股下",
    watari: "ワタリ", sodeh: "裾幅", hip: "ヒップ"
  };

  ["chaku","kata","mihaba","sode","yuki","sous","waist","kao","kasha","watari","sodeh","hip"].forEach(key => {
    const v = data[key];
    if (v !== "" && v !== null && v !== undefined) desc += `- ${mapKey[key]}：${v}cm\n`;
  });

  desc += "\n";
  if (data.design || data.pocket) {
    desc += "☆デザイン・特徴\n";
    if (data.design) desc += data.design + "\n";
    if (data.pocket) desc += "ポケット：" + data.pocket + "\n";
    desc += "\n";
  }
  if (data.damage) desc += "☆状態詳細\n" + data.damage + "\n\n";

  if (hashText) {
    desc += hashLine + "\n" + hashSuffix + "\n\n";
  }

  desc += "・保管上または梱包でのシワはご容赦下さい。\n";
  desc += "・商品のデザイン、色、状態には主観を伴い表現及び受け止め方に個人差がございます。\n";
  desc += "・商品確認しておりますが、汚れ等の見落としはご容赦下さい。\n";
  desc += "・特に状態に敏感な方のご購入はお控え下さい。";

  data.description = desc;

  const tpl = HtmlService.createTemplateFromFile("Index");
  tpl.data = data;

  return tpl.evaluate()
    .setTitle(data.generatedTitle || "プレビュー")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getKeywordData_(ss, id) {
  const kwSheet = ss.getSheetByName("AIキーワード抽出");
  if (!kwSheet) return { keywords: [], market: "", reason: "", link: "" };

  const lastRow = kwSheet.getLastRow();
  const lastCol = kwSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { keywords: [], market: "", reason: "", link: "" };

  const kwHdr = kwSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idxKwId = kwHdr.indexOf("管理番号");
  const idxKwStart = kwHdr.indexOf("キーワード1");
  if (idxKwId === -1 || idxKwStart === -1) return { keywords: [], market: "", reason: "", link: "" };

  const idRange = kwSheet.getRange(2, idxKwId + 1, lastRow - 1, 1);
  const found = idRange.createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return { keywords: [], market: "", reason: "", link: "" };

  const rowNum = found.getRow();
  const row = kwSheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  const marketIdx = kwHdr.indexOf("相場");
  const reasonIdx = kwHdr.indexOf("理由");
  const linkIdx = kwHdr.indexOf("リンク");

  const market = marketIdx === -1 ? "" : (row[marketIdx] ? String(row[marketIdx]) + "円" : "");
  const reason = reasonIdx === -1 ? "" : (row[reasonIdx] || "");
  const link = linkIdx === -1 ? "" : (row[linkIdx] || "");

  const keywords = [];
  for (let i = 0; i < 8; i++) {
    const v = row[idxKwStart + i];
    if (v) keywords.push(String(v));
  }

  return { keywords, market, reason, link };
}

function buildIdListHtml_(sheet, idxId) {
  const lastRow = sheet.getLastRow();
  const max = Math.min(30, Math.max(0, lastRow - 1));
  if (max === 0) return "";

  const ids = sheet.getRange(2, idxId + 1, max, 1).getDisplayValues().flat().filter(v => v !== "");
  let html = "<hr><p>管理番号リンク（先頭" + ids.length + "件）</p><ul>";
  ids.forEach(v => {
    const s = escapeHtml_(String(v));
    html += '<li><a href="?id=' + encodeURIComponent(String(v)) + '">' + s + "</a></li>";
  });
  html += "</ul>";
  return html;
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
