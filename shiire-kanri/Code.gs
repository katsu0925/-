// Code.gs

// Cloudflare Workers (workers/shiire-kanri) からの同期・書き込みプロキシ用エンドポイント
// 共通シークレット SHIIRE_SYNC_SECRET (Script Properties) で認可
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = String(body.secret || '');
    var expected = PropertiesService.getScriptProperties().getProperty('SHIIRE_SYNC_SECRET') || '';
    if (!expected || secret !== expected) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var action = String(body.action || '');
    var email = String(body.email || '');
    var result;
    switch (action) {
      case 'syncDumpProducts':  result = staff_syncDumpProducts();  break;
      case 'syncDumpPurchases': result = staff_syncDumpPurchases(); break;
      case 'syncDumpAiPrefill': result = staff_syncDumpAiPrefill(); break;
      case 'dumpHeaders':       result = staff_debugHeaders(String((body.payload && body.payload.name) || '商品管理')); break;
      case 'listAllowedEmails': result = staff_listAllowedEmails(); break;
      case 'listWorkers':       result = staff_listWorkers(); break;
      case 'listAccounts':      result = staff_listAccounts(); break;
      case 'listSuppliers':     result = staff_listSuppliers(); break;
      case 'listPlaces':        result = staff_listPlaces(); break;
      case 'listCategories':    result = staff_listCategories(); break;
      case 'listSettings':      result = staff_listSettings(); break;
      case 'lookupAiPrefill':   result = staff_lookupAiPrefill((body.payload && body.payload.kanri) || ''); break;
      case 'saveMeasurement':   result = staff_apiSaveMeasurement(body.payload || {}, email); break;
      case 'saveSale':          result = staff_apiSaveSale(body.payload || {}, email); break;
      case 'saveDetails':       result = staff_apiSaveDetails(body.payload || {}, email); break;
      case 'createPurchase':    result = staff_apiCreatePurchase(body.payload || {}, email); break;
      case 'createProduct':     result = staff_apiCreateProduct(body.payload || {}, email); break;
      case 'uploadImage':       result = staff_apiUploadImage(body.payload || {}, email); break;
      case 'resolveImage':      result = staff_apiResolveImage(body.payload || {}, email); break;
      // AppSheet 互換タブ用 追加API
      case 'listMoves':         result = staff_listMoves(body.payload || {}); break;
      case 'createMove':        result = staff_apiCreateMove(body.payload || {}, email); break;
      case 'listReturns':       result = staff_listReturns(body.payload || {}); break;
      case 'createReturn':      result = staff_apiCreateReturn(body.payload || {}, email); break;
      case 'listAiResults':     result = staff_listAiResults(body.payload || {}); break;
      case 'listSagyousha':     result = staff_listSagyousha(body.payload || {}, email); break;
      case 'saveSagyousha':     result = staff_apiSaveSagyousha(body.payload || {}, email); break;
      case 'createSagyousha':   result = staff_apiCreateSagyousha(body.payload || {}, email); break;
      case 'dumpSheet':         result = staff_dumpSheet(body.payload || {}); break;
      case 'appendKeihi':                  result = staff_apiAppendKeihi(body.payload || {}, email); break;
      case 'updateShiireHoukokuQuantity':  result = staff_apiUpdateShiireHoukokuQuantity(body.payload || {}, email); break;
      default:                  result = { ok: false, error: 'unknown action: ' + action };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.app === 'staff') {
    return HtmlService.createHtmlOutputFromFile('StaffApp')
      .setTitle('仕入れ管理 — スタッフ入力')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (e && e.parameter && e.parameter.debug === 'headers' && e.parameter.name) {
    var res = staff_debugHeaders(String(e.parameter.name));
    return ContentService.createTextOutput(JSON.stringify(res, null, 2)).setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.check === 'tsk') {
    return tskCheck_(e);
  }
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
    category2: val_("カテゴリ2"),
    category3: val_("カテゴリ3"),
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
    hip: val_("ヒップ"),
    sukekan: val_("透け感")
  };

  const kw = getKeywordData_(ss, id);
  data.market = kw.market;
  data.reason = kw.reason;
  data.link = kw.link;

  // ブランド表記を「ブランド(english)」→「ブランド english」に変換
  let brandDisplay = String(data.brand || "");
  const brandMatch = brandDisplay.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (brandMatch) {
    brandDisplay = brandMatch[1] + " " + brandMatch[2];
  }

  // 重複排除用: ブランド名・サイズ・カテゴリに含まれる語を除外
  const dedupWords = [brandDisplay, data.brand, data.size, data.category2, data.category3]
    .flatMap(w => String(w || "").split(/[\s　()（）]+/))
    .filter(w => w)
    .map(w => w.toLowerCase());

  let kws = kw.keywords.slice().filter(k => {
    const kLower = String(k).toLowerCase();
    return !dedupWords.some(d => d === kLower || kLower === d);
  });
  for (let j = kws.length - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [kws[j], kws[r]] = [kws[r], kws[j]];
  }

  const sizeLabel = String(data.size) === "フリーサイズ" ? "F" : String(data.size || "");
  const prefix = `${data.id}【${sizeLabel}】${brandDisplay}`;
  const titleTokens = [prefix];
  // カテゴリ3優先、なければカテゴリ2。キーワードにカテゴリを含む語があればそちらを優先
  const cat = String(data.category3 || "") || String(data.category2 || "");
  const kwHasCat = cat && kws.some(k => String(k).includes(cat));
  if (cat && !kwHasCat) titleTokens.push(cat);

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
  if (data.design || data.pocket || data.sukekan) {
    desc += "☆デザイン・特徴\n";
    if (data.design) desc += data.design + "\n";
    if (data.pocket) desc += "ポケット：" + data.pocket + "\n";
    if (data.sukekan) desc += "透け感：" + data.sukekan + "\n";
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

  // ?fmt=json: タイトル・説明文を JSON で返す（外部アプリ用）
  if (e && e.parameter && (e.parameter.fmt === 'json' || e.parameter.format === 'json')) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      id: data.id,
      title: data.generatedTitle || '',
      description: data.description || ''
    })).setMimeType(ContentService.MimeType.JSON);
  }

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
