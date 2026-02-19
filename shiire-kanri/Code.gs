function doGet(e) {
  const id = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : "";

  // Web App文脈ではgetActiveSpreadsheet()がnullを返す場合があるためScript Propertiesからのフォールバック
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = (function() { try { return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || ''; } catch(e) { return ''; } })();
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
    } else {
      return HtmlService.createHtmlOutput("<p>スプレッドシートに紐づいたGASで実行してください。SPREADSHEET_IDをScript Propertiesに設定するか、コンテナバインドで実行してください。</p>");
    }
  }

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
  const col = buildHeaderMap_(hdr);

  if (!col['管理番号']) return HtmlService.createHtmlOutput("<p>「商品管理」にヘッダー「管理番号」が見つかりません。</p>");

  const idxId = col['管理番号'] - 1;

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

  function val_(name) {
    var c = col[name];
    return c ? (row[c - 1] || "") : "";
  }

  const data = {
    id: val_("管理番号"),
    brand: val_("ブランド"),
    size: val_("メルカリサイズ"),
    color: val_("カラー"),
    pocket: val_("ポケット詳細"),
    design: val_("デザイン特徴"),
    damage: val_("傷汚れ詳細"),
    chaku: val_("着丈"),
    kata: val_("肩幅"),
    mihaba: val_("身幅"),
    sode: val_("袖丈"),
    yuki: val_("裄丈"),
    sous: val_("総丈"),
    waist: val_("ウエスト"),
    kao: val_("股上"),
    kasha: val_("股下"),
    watari: val_("ワタリ"),
    sodeh: val_("裾幅"),
    hip: val_("ヒップ")
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
  const kwCol = buildHeaderMap_(kwHdr);
  if (!kwCol['管理番号'] || !kwCol['キーワード1']) return { keywords: [], market: "", reason: "", link: "" };

  const idRange = kwSheet.getRange(2, kwCol['管理番号'], lastRow - 1, 1);
  const found = idRange.createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return { keywords: [], market: "", reason: "", link: "" };

  const rowNum = found.getRow();
  const row = kwSheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  function kwVal_(name) {
    var c = kwCol[name];
    return c ? (row[c - 1] || "") : "";
  }

  const market = kwVal_("相場") ? String(kwVal_("相場")) + "円" : "";
  const reason = kwVal_("理由");
  const link = kwVal_("リンク");

  const keywords = [];
  const kwStartIdx = kwCol['キーワード1'] - 1;
  for (let i = 0; i < 8; i++) {
    const v = row[kwStartIdx + i];
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
