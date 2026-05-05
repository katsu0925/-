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
    var __t0 = Date.now();
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
      case 'uploadKeihiImage':             result = staff_apiUploadKeihiImage(body.payload || {}, email); break;
      case 'updateShiireHoukokuQuantity':  result = staff_apiUpdateShiireHoukokuQuantity(body.payload || {}, email); break;
      default:                  result = { ok: false, error: 'unknown action: ' + action };
    }
    // 計測: doPost 内の dispatch 〜 結果生成までの ms。Worker 側で Server-Timing に転載される。
    if (result && typeof result === 'object') {
      result._t = Object.assign({}, result._t || {}, { dispatch: Date.now() - __t0 });
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
  if (e && e.parameter && e.parameter.compare === '1') {
    return compareTitlesRandom_(e);
  }
  if (e && e.parameter && e.parameter.cattop === '1') {
    return categoryTopFrequencies_(e);
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

  // 高速化: id 単位 10 分キャッシュ。2 回目以降は即時応答（createTextFinder/sheet 読みをスキップ）
  // ?nocache=1 で強制再生成可能。商品データ更新後 10 分以内は古い表示の可能性あり（説明文の採寸値含む）
  const fmtJson = e && e.parameter && (e.parameter.fmt === 'json' || e.parameter.format === 'json');
  const nocache = e && e.parameter && (e.parameter.nocache === '1' || e.parameter.refresh === '1');
  const cacheKey = 'shitsu_v3_' + id;
  if (!nocache) {
    try {
      var cachedRaw = CacheService.getScriptCache().get(cacheKey);
      if (cachedRaw) {
        var cached = JSON.parse(cachedRaw);
        if (fmtJson) {
          return ContentService.createTextOutput(JSON.stringify({
            ok: true, id: cached.id, title: cached.generatedTitle || '', description: cached.description || '', cached: true
          })).setMimeType(ContentService.MimeType.JSON);
        }
        var tplC = HtmlService.createTemplateFromFile('Index');
        tplC.data = cached;
        return tplC.evaluate()
          .setTitle(cached.generatedTitle || 'プレビュー')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      }
    } catch (cErr) { /* キャッシュ失敗時は通常パスへフォールバック */ }
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

  // 本番: v3（多層防御 dedup）。?compare=1&n=N で v1/v2/v3 を比較できる。
  data.generatedTitle = buildTitleV3_(data, kw);
  // ログ追記は HTML プレビュー時のみ（fmt=json は外部ツール／自動化、appendRow は重いのでスキップ）
  if (!fmtJson) {
    try { appendTitleLog_(ss, data, kw, 'v3'); } catch (logErr) { /* ログ失敗はタイトル生成を阻害しない */ }
  }

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

  // 次回アクセス即時化のため id 単位でキャッシュ（10 分）。Index.html が参照するフィールドのみ保存
  try {
    var cachePayload = {
      id: data.id,
      generatedTitle: data.generatedTitle || '',
      description: data.description || '',
      market: data.market || '',
      reason: data.reason || '',
      link: data.link || ''
    };
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(cachePayload), 600);
  } catch (cErr) { /* キャッシュ失敗は無視 */ }

  // ?fmt=json: タイトル・説明文を JSON で返す（外部アプリ用）
  if (fmtJson) {
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

// ───────────────────────────────────────────────────────────────
// メルカリタイトル生成（v1: 旧ロジック / v2: 改善版）
// 2026-05-06 dedup 強化（ブランド英字省略・色同義語・部分一致）
// ───────────────────────────────────────────────────────────────

// v1: 既存の inline ロジックを関数化したもの。compare 用に保持
function buildTitleV1_(data, kw) {
  let brandDisplay = String(data.brand || "");
  const brandMatch = brandDisplay.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (brandMatch) {
    brandDisplay = brandMatch[1] + " " + brandMatch[2];
  }
  const dedupWords = [brandDisplay, data.brand, data.size, data.category2, data.category3]
    .flatMap(w => String(w || "").split(/[\s　()（）]+/))
    .filter(w => w)
    .map(w => w.toLowerCase());
  let kws = (kw.keywords || []).slice().filter(k => {
    const kLower = String(k).toLowerCase();
    return !dedupWords.some(d => d === kLower || kLower === d);
  });
  // v1 はランダムシャッフル → タイトルが毎回ぶれる原因の1つ。再現性のため
  // 比較時のみ固定シードに置換する手もあるが、ここは元実装を尊重
  for (let j = kws.length - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [kws[j], kws[r]] = [kws[r], kws[j]];
  }
  const sizeLabel = String(data.size) === "フリーサイズ" ? "F" : String(data.size || "");
  const prefix = `${data.id}【${sizeLabel}】${brandDisplay}`;
  const titleTokens = [prefix];
  const cat = String(data.category3 || "") || String(data.category2 || "");
  const kwHasCat = cat && kws.some(k => String(k).includes(cat));
  if (cat && !kwHasCat) titleTokens.push(cat);
  kws.forEach(k => {
    const cand = titleTokens.concat(k).join(" ");
    if (cand.length <= 40) titleTokens.push(k);
  });
  return titleTokens.join(" ").trim();
}

// 色名同義マップ（漢字 ↔ カタカナ ↔ 英字）
var COLOR_SYNONYMS_ = {
  '黒': ['ブラック','black'], 'ブラック': ['黒','black'], 'black': ['黒','ブラック'],
  '白': ['ホワイト','white'], 'ホワイト': ['白','white'], 'white': ['白','ホワイト'],
  '赤': ['レッド','red'],     'レッド': ['赤','red'],     'red': ['赤','レッド'],
  '青': ['ブルー','blue'],    'ブルー': ['青','blue'],    'blue': ['青','ブルー'],
  '緑': ['グリーン','green'], 'グリーン': ['緑','green'], 'green': ['緑','グリーン'],
  '黄': ['イエロー','yellow'],'イエロー': ['黄','yellow'],'yellow': ['黄','イエロー'],
  '茶': ['ブラウン','brown'], 'ブラウン': ['茶','brown'], 'brown': ['茶','ブラウン'],
  '灰': ['グレー','gray','grey'], 'グレー': ['灰','gray','grey'],
  'gray': ['灰','グレー','grey'], 'grey': ['灰','グレー','gray'],
  '紺': ['ネイビー','navy'],  'ネイビー': ['紺','navy'], 'navy': ['紺','ネイビー'],
  '桃': ['ピンク','pink'],    'ピンク': ['桃','pink'],   'pink': ['桃','ピンク'],
  '紫': ['パープル','purple'],'パープル': ['紫','purple'],'purple': ['紫','パープル'],
  'ベージュ': ['beige'], 'beige': ['ベージュ'],
  'カーキ': ['khaki'], 'khaki': ['カーキ'],
  'オレンジ': ['orange','橙'], 'orange': ['オレンジ','橙'], '橙': ['オレンジ','orange']
};

function expandColorSyn_(token) {
  const t = String(token || '').toLowerCase();
  if (!t) return [];
  const out = [t];
  for (const k in COLOR_SYNONYMS_) {
    if (k.toLowerCase() === t) {
      COLOR_SYNONYMS_[k].forEach(s => out.push(String(s).toLowerCase()));
    }
  }
  return out;
}

// 双方向部分一致（短い方が長さ2以上で含まれる場合は重複扱い）
function isSubstrDup_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// v2.1: 改善版タイトル生成
//  - ブランド: 「ロペ(ROPÉ)」→ 原則「ロペ ROPÉ」両方残す。40字内でキーワード採用数が
//    減る場合のみカタカナ単独 or 英字単独に切り詰め（メルカリSEOは両表記が強い）
//  - 和文無しブランド（GUCCI 等）はそのまま
//  - dedup: ブランド/サイズ/カラー/カテゴリ + 色同義語 + 部分一致でキーワード重複排除
//  - キーワード同士の重複（ロゴ vs ロゴ刺繍）も accepted set との照合で排除
//  - 順序は kw.keywords の出現順を尊重（ランダム化しない）
function buildTitleV2_(data, kw) {
  // ── ブランド表記の候補（フル / 短縮）を作る ──
  const brandRaw = String(data.brand || "").trim();
  let brandJp = '', brandEn = '';
  const brandMatch = brandRaw.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (brandMatch) {
    brandJp = brandMatch[1].trim();
    brandEn = brandMatch[2].trim();
  } else if (/[ぁ-んァ-ヴ一-龯]/.test(brandRaw)) {
    brandJp = brandRaw;
  } else {
    brandEn = brandRaw;
  }
  const brandFull = [brandJp, brandEn].filter(Boolean).join(' ');
  const brandShort = brandJp || brandEn; // どちらか一方だけ

  // ── dedup base set 構築（jp/en/raw すべてを含める） ──
  const splitRe = /[\s　()（）、,／/・]+/;
  const baseRaw = [brandRaw, brandJp, brandEn, data.size, data.color, data.category2, data.category3]
    .flatMap(w => String(w || "").split(splitRe))
    .filter(Boolean)
    .map(w => String(w).toLowerCase());
  const baseSet = [];
  baseRaw.forEach(t => {
    expandColorSyn_(t).forEach(x => { if (baseSet.indexOf(x) < 0) baseSet.push(x); });
    if (baseSet.indexOf(t) < 0) baseSet.push(t);
  });

  // ── キーワード重複排除（base set + accepted set との部分一致） ──
  const acceptedLower = baseSet.slice();
  const accepted = [];
  (kw.keywords || []).forEach(k => {
    const kStr = String(k || '').trim();
    if (!kStr) return;
    const kLower = kStr.toLowerCase();
    const candidates = expandColorSyn_(kLower);
    if (candidates.indexOf(kLower) < 0) candidates.unshift(kLower);
    let dup = false;
    for (let i = 0; i < candidates.length && !dup; i++) {
      const c = candidates[i];
      for (let j = 0; j < acceptedLower.length; j++) {
        if (isSubstrDup_(c, acceptedLower[j])) { dup = true; break; }
      }
    }
    if (dup) return;
    accepted.push(kStr);
    acceptedLower.push(kLower);
  });

  // ── ブランド表記を決めるためにフル/短縮の両方で組み立て、キーワード採用数を比較 ──
  const cat = String(data.category3 || "") || String(data.category2 || "");
  function assemble_(brandStr) {
    const sizeLabel = String(data.size) === "フリーサイズ" ? "F" : String(data.size || "");
    const prefix = `${data.id}【${sizeLabel}】${brandStr}`.trim();
    const tokens = [prefix];
    if (cat) {
      const catLower = cat.toLowerCase();
      const kwHasCat = accepted.some(k => isSubstrDup_(String(k).toLowerCase(), catLower));
      if (!kwHasCat) tokens.push(cat);
    }
    let kwCount = 0;
    accepted.forEach(k => {
      const cand = tokens.concat(k).join(" ");
      if (cand.length <= 40) { tokens.push(k); kwCount++; }
    });
    return { title: tokens.join(" ").trim(), kwCount: kwCount };
  }

  if (brandFull && brandShort && brandFull !== brandShort) {
    const full = assemble_(brandFull);
    const shrt = assemble_(brandShort);
    // フル表記でカテゴリ＋同等のキーワード数が確保できる場合は両表記を採用
    return (full.kwCount >= shrt.kwCount) ? full.title : shrt.title;
  }
  return assemble_(brandFull || brandShort).title;
}

// ?compare=1&n=N でランダム N 件の v1/v2 タイトル比較を JSON で返す
// オプション:
//   ?long=1   ブランド名が 12文字以上 or 括弧形式 のみを抽出
//   ?paren=1  ブランド名が 括弧形式（カタカナ+英字 / 漢字+英字）のみを抽出
//   ?ids=zA73,zk100,...  指定 ID をピンポイント比較
function compareTitlesRandom_(e) {
  var n = Math.max(1, Math.min(20, parseInt((e && e.parameter && e.parameter.n) || '5', 10) || 5));
  var longOnly = (e && e.parameter && e.parameter.long === '1');
  var parenOnly = (e && e.parameter && e.parameter.paren === '1');
  var pinIds = String((e && e.parameter && e.parameter.ids) || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = (function() { try { return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || ''; } catch(_) { return ''; } })();
    if (ssId) ss = SpreadsheetApp.openById(ssId);
  }
  if (!ss) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'no spreadsheet' })).setMimeType(ContentService.MimeType.JSON);
  var sheet = ss.getSheetByName('商品管理');
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '商品管理 sheet missing' })).setMimeType(ContentService.MimeType.JSON);
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'empty' })).setMimeType(ContentService.MimeType.JSON);
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  if (!col['管理番号'] || !col['ブランド']) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'header 管理番号/ブランド missing' })).setMimeType(ContentService.MimeType.JSON);

  // AIキーワード抽出シートに登録のある管理番号セットを取得
  var kwIdSet = {};
  var kwSheet = ss.getSheetByName('AIキーワード抽出');
  if (kwSheet && kwSheet.getLastRow() >= 2) {
    var kwLastCol = kwSheet.getLastColumn();
    var kwHdr = kwSheet.getRange(1, 1, 1, kwLastCol).getValues()[0];
    var kwCol = buildHeaderMap_(kwHdr);
    if (kwCol['管理番号'] && kwCol['キーワード1']) {
      var kwAll = kwSheet.getRange(2, kwCol['管理番号'], kwSheet.getLastRow() - 1, 1).getValues();
      kwAll.forEach(r => { var v = String(r[0] || '').trim(); if (v) kwIdSet[v.toUpperCase()] = true; });
    }
  }

  // 商品管理シート全行のうち AIキーワード抽出に存在するもの、必要なら絞り込み
  var idCol = col['管理番号'] - 1;
  var brandCol = col['ブランド'] - 1;
  var sampleIds;
  if (pinIds.length > 0) {
    sampleIds = pinIds;
  } else {
    var allRows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var pool = [];
    for (var i = 0; i < allRows.length; i++) {
      var kid = String(allRows[i][idCol] || '').trim();
      if (!kid) continue;
      if (!kwIdSet[kid.toUpperCase()]) continue;
      var br = String(allRows[i][brandCol] || '').trim();
      var hasParen = /[（(].+?[）)]/.test(br);
      var hasJp = /[ぁ-んァ-ヴ一-龯]/.test(br);
      var hasEn = /[A-Za-z]/.test(br);
      if (parenOnly) {
        if (!(hasParen && hasJp && hasEn)) continue;
      } else if (longOnly) {
        var isLong = (hasParen && hasJp && hasEn) || br.length >= 12;
        if (!isLong) continue;
      }
      pool.push(kid);
    }
    // フィッシャー・イェーツで先頭 n 個取り出し
    for (var s = pool.length - 1; s > 0; s--) {
      var r2 = Math.floor(Math.random() * (s + 1));
      var tmp = pool[s]; pool[s] = pool[r2]; pool[r2] = tmp;
    }
    sampleIds = pool.slice(0, n);
  }

  var results = [];
  sampleIds.forEach(function(kanri) {
    var range = sheet.getRange(2, col['管理番号'], lastRow - 1, 1);
    var found = range.createTextFinder(kanri).matchEntireCell(true).findNext();
    if (!found) {
      results.push({ kanri: kanri, error: 'not found in 商品管理' });
      return;
    }
    var row = sheet.getRange(found.getRow(), 1, 1, lastCol).getValues()[0];
    function v_(name) { var c = col[name]; return c ? (row[c - 1] || "") : ""; }
    var data = {
      id: v_("管理番号"), brand: v_("ブランド"), size: v_("メルカリサイズ"), color: v_("カラー"),
      category2: v_("カテゴリ2"), category3: v_("カテゴリ3"),
      pocket: v_("ポケット詳細"), design: v_("デザイン特徴"), damage: v_("傷汚れ詳細"),
      sukekan: v_("透け感")
    };
    var kw = getKeywordData_(ss, kanri);
    var t1 = buildTitleV1_(data, kw);
    var t2 = buildTitleV2_(data, kw);
    var t3 = buildTitleV3_(data, kw);
    results.push({
      kanri: kanri,
      brand: data.brand,
      size: data.size,
      color: data.color,
      cat: data.category3 || data.category2,
      keywords: (kw.keywords || []).join(' '),
      v1: t1, v1_len: t1.length,
      v2: t2, v2_len: t2.length,
      v3: t3, v3_len: t3.length
    });
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, n: results.length, results: results }, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────────────────────────────────────────────
// v3: カテゴリ形態素辞書 + 適応 2-gram dedup（多層防御）
// 仕様の意図:
//  - L2 CATEGORY_MORPHEMES_ で複合カテゴリを形態素単位に分解し、既出語プールに登録
//    例: 「ロングスカート」→ ['ロング','スカート'] が pool に入るため、
//        キーワード「ロング丈」「スカート」両方とも 2-gram 重複で除外できる
//  - L3 isDupByNgram_ で短語60% / 中語50% / 長語40% の適応しきい値で部分重複検出
//  - L4 既出語プールにブランド分割・色同義語も一括登録
//  - 未登録カテゴリ（辞書に無い）は語そのものを 1 トークンとして登録（v2 互換）
// ───────────────────────────────────────────────────────────────
var CATEGORY_MORPHEMES_ = {
  'ニット/セーター': ['ニット','セーター'],
  'Tシャツ/カットソー': ['Tシャツ','カットソー'],
  'シャツ/ブラウス': ['シャツ','ブラウス'],
  'ひざ丈ワンピース': ['ひざ丈','ワンピース'],
  'ひざ丈スカート': ['ひざ丈','スカート'],
  'カジュアルパンツ': ['カジュアル','パンツ'],
  'ロングスカート': ['ロング','スカート'],
  'Tシャツ': ['Tシャツ'],
  'ロングワンピース': ['ロング','ワンピース'],
  'テーラードジャケット': ['テーラード','ジャケット'],
  'デニム/ジーンズ': ['デニム','ジーンズ'],
  'ポロシャツ': ['ポロ','ポロシャツ','シャツ'],
  'タンクトップ': ['タンク','タンクトップ'],
  'イージーパンツ': ['イージー','パンツ'],
  'ノーカラージャケット': ['ノーカラー','ジャケット'],
  'ワイドパンツ': ['ワイド','パンツ'],
  'スカートセットアップ/ツーピース': ['スカート','セットアップ','ツーピース'],
  'ロングコート': ['ロング','コート'],
  'ミニスカート': ['ミニ','スカート'],
  '長袖カットソー': ['長袖','カットソー'],
  'ダウンジャケット': ['ダウン','ジャケット'],
  'ハーフパンツ': ['ハーフ','パンツ'],
  'ショートパンツ': ['ショート','パンツ'],
  'スウェットパンツ': ['スウェット','パンツ'],
  'マウンテンパーカー': ['マウンテン','パーカー'],
  'ガウチョパンツ': ['ガウチョ','パンツ'],
  'ウールコート': ['ウール','コート'],
  'ワークパンツ': ['ワーク','パンツ'],
  'ミニワンピース': ['ミニ','ワンピース'],
  'トレンチコート': ['トレンチ','コート'],
  'セットアップ/ツーピース': ['セットアップ','ツーピース'],
  'カーゴパンツ': ['カーゴ','パンツ'],
  'スプリングコート': ['スプリング','コート'],
  'ナイロンジャケット': ['ナイロン','ジャケット'],
  'スキニーパンツ': ['スキニー','パンツ'],
  'チノパン': ['チノ','チノパン'],
  'ミリタリージャケット': ['ミリタリー','ジャケット'],
  'パーティードレス': ['パーティー','ドレス'],
  'フリースジャケット': ['フリース','ジャケット'],
  'キルティングジャケット': ['キルティング','ジャケット'],
  'パンツセットアップ/ツーピース': ['パンツ','セットアップ','ツーピース'],
  'ジョガーパンツ': ['ジョガー','パンツ'],
  'デニムジャケット': ['デニム','ジャケット'],
  '毛皮ファーコート': ['毛皮','ファー','コート'],
  'ボアジャケット': ['ボア','ジャケット'],
  'ルームウェア': ['ルームウェア'],
  'レザージャケット': ['レザー','ジャケット'],
  'ピーコート': ['ピーコート','コート'],
  'ビジネススーツ': ['ビジネス','スーツ'],
  'チェスターコート': ['チェスター','コート'],
  'ムートンコート': ['ムートン','コート'],
  'ステンカラーコート': ['ステンカラー','コート']
};

// 文字列を 2-gram 集合に分解（小文字化、長さ1の語は[w]を返す）
function ngrams2_(s) {
  var t = String(s || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return [];
  if (t.length === 1) return [t];
  var out = [];
  for (var i = 0; i < t.length - 1; i++) out.push(t.substr(i, 2));
  return out;
}

// candidate と既出語 pool の語のいずれかとの 2-gram 共通率を測り、しきい値超えなら true
// しきい値は candidate 長さで適応: ≤3字 → 60% / 4-6字 → 50% / ≥7字 → 40%
function isDupByNgram_(candidate, pool) {
  if (!candidate) return false;
  var cand = String(candidate).toLowerCase().replace(/\s+/g, '');
  if (!cand) return false;
  var candGrams = ngrams2_(cand);
  if (!candGrams.length) return false;
  var threshold = cand.length <= 3 ? 0.6 : (cand.length <= 6 ? 0.5 : 0.4);
  for (var i = 0; i < pool.length; i++) {
    var p = String(pool[i] || '').toLowerCase().replace(/\s+/g, '');
    if (!p) continue;
    if (p === cand) return true;
    // 完全包含（短い方が長い方の subset）→ 即重複
    if (cand.length >= 2 && p.indexOf(cand) >= 0) return true;
    if (p.length >= 2 && cand.indexOf(p) >= 0) return true;
    var pGrams = ngrams2_(p);
    if (!pGrams.length) continue;
    var common = 0;
    var pSet = {};
    pGrams.forEach(function(g) { pSet[g] = true; });
    candGrams.forEach(function(g) { if (pSet[g]) common++; });
    var ratio = common / candGrams.length;
    if (ratio >= threshold) return true;
  }
  return false;
}

// ブランド名を空白・記号区切りで分割（固有名詞は形態素解析せず単純トークン化）
function splitBrand_(brand) {
  return String(brand || '').split(/[\s　()（）\-,／/・&]+/).filter(Boolean);
}

// カテゴリ語を L2 辞書から形態素配列に展開（未登録ならカテゴリ語そのもの）
function expandCategoryMorphemes_(cat) {
  var c = String(cat || '').trim();
  if (!c) return [];
  if (CATEGORY_MORPHEMES_[c]) return CATEGORY_MORPHEMES_[c].slice();
  // スラッシュ区切りのみ自動分解（例: 未登録の「A/B」→ [A, B]）
  if (c.indexOf('/') >= 0 || c.indexOf('／') >= 0) {
    return c.split(/[／/]/).map(function(x) { return x.trim(); }).filter(Boolean);
  }
  return [c];
}

function buildTitleV3_(data, kw) {
  // ── ブランド表記の候補 ──
  var brandRaw = String(data.brand || '').trim();
  var brandJp = '', brandEn = '';
  var bm = brandRaw.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (bm) { brandJp = bm[1].trim(); brandEn = bm[2].trim(); }
  else if (/[ぁ-んァ-ヴ一-龯]/.test(brandRaw)) { brandJp = brandRaw; }
  else { brandEn = brandRaw; }
  var brandFull = [brandJp, brandEn].filter(Boolean).join(' ');
  var brandShort = brandJp || brandEn;

  // ── 既出語プール初期化（L4） ──
  // ブランド分割 + サイズ + 色（同義語含む） + カテゴリ形態素（L2）
  var pool = [];
  function addToPool(arr) {
    arr.forEach(function(w) {
      var lw = String(w || '').toLowerCase();
      if (lw && pool.indexOf(lw) < 0) pool.push(lw);
    });
  }
  addToPool(splitBrand_(brandRaw));
  addToPool(splitBrand_(brandJp));
  addToPool(splitBrand_(brandEn));
  if (data.size) addToPool([String(data.size)]);
  // 色は同義語展開
  String(data.color || '').split(/[\s　()（）、,／/・]+/).filter(Boolean).forEach(function(t) {
    addToPool([t]);
    addToPool(expandColorSyn_(t));
  });
  // カテゴリ形態素
  var cat3 = String(data.category3 || '').trim();
  var cat2 = String(data.category2 || '').trim();
  var cat = cat3 || cat2;
  // L8 用にカテゴリ構成語のリストを別管理（サフィックス剥がしの判定用）
  var catMorphsList = [];
  if (cat3) {
    var m3 = expandCategoryMorphemes_(cat3);
    addToPool(m3);
    catMorphsList = catMorphsList.concat(m3);
  }
  if (cat2 && cat2 !== cat3) {
    var m2 = expandCategoryMorphemes_(cat2);
    addToPool(m2);
    catMorphsList = catMorphsList.concat(m2);
  }
  catMorphsList = catMorphsList.map(function(m){ return String(m).toLowerCase().trim(); }).filter(Boolean);

  // ── キーワード dedup（L3 適応 2-gram + L8 サフィックス救済） ──
  // L8 の意図:
  //   キーワードがカテゴリ構成語で「終わる」場合（例: 花柄シャツ／長袖シャツ／ボタンダウンシャツ）、
  //   サフィックスを剥がして残り（花柄／長袖／ボタンダウン）が pool に重複しなければ採用する。
  //   これにより zC929 のような「全キーワードが〜シャツ」ケースで情報が落ちなくなる。
  var accepted = [];
  (kw.keywords || []).forEach(function(k) {
    var kStr = String(k || '').trim();
    if (!kStr) return;
    var kLower = kStr.toLowerCase();
    // 色同義語の重複も拾う
    var candidates = expandColorSyn_(kLower);
    if (candidates.indexOf(kLower) < 0) candidates.unshift(kLower);
    var dup = false;
    for (var i = 0; i < candidates.length; i++) {
      if (isDupByNgram_(candidates[i], pool)) { dup = true; break; }
    }
    if (!dup) {
      accepted.push(kStr);
      addToPool([kLower]);
      return;
    }
    // L8: カテゴリ構成語サフィックスを剥がして救済
    for (var j = 0; j < catMorphsList.length; j++) {
      var morph = catMorphsList[j];
      if (!morph || kLower.length <= morph.length) continue;
      if (kLower.slice(-morph.length) !== morph) continue;
      var residue = kLower.slice(0, kLower.length - morph.length).trim();
      if (!residue) continue;
      if (isDupByNgram_(residue, pool)) continue;
      // 元の表記から該当長を切る（toLowerCase は長さ不変）
      var residueOrig = kStr.slice(0, kStr.length - morph.length).trim();
      if (!residueOrig) continue;
      accepted.push(residueOrig);
      addToPool([residue]);
      return;
    }
  });

  // ── ブランド両表記 vs 単独表記（v2.1 ロジック維持＋20字以内ならフル優先） ──
  function assemble_(brandStr) {
    var sizeLabel = String(data.size) === 'フリーサイズ' ? 'F' : String(data.size || '');
    var prefix = (data.id + '【' + sizeLabel + '】' + brandStr).trim();
    var tokens = [prefix];
    if (cat) {
      // カテゴリ語自体がキーワードに既に表現されているかチェック
      var catLower = cat.toLowerCase();
      var kwHasCat = accepted.some(function(k) { return isDupByNgram_(k.toLowerCase(), [catLower]); });
      if (!kwHasCat) tokens.push(cat);
    }
    var kwCount = 0;
    accepted.forEach(function(k) {
      var cand = tokens.concat(k).join(' ');
      if (cand.length <= 40) { tokens.push(k); kwCount++; }
    });
    return { title: tokens.join(' ').trim(), kwCount: kwCount };
  }

  if (brandFull && brandShort && brandFull !== brandShort) {
    // 20字以内の両表記なら積極的に両表記採用、超えたらキーワード数で比較
    if (brandFull.length <= 20) {
      var fullR = assemble_(brandFull);
      var shortR = assemble_(brandShort);
      // 両表記でキーワード数が単独より極端に減らなければ両表記を優先
      if (fullR.kwCount >= shortR.kwCount - 1) return fullR.title;
      return shortR.title;
    }
    return assemble_(brandShort).title;
  }
  return assemble_(brandFull || brandShort).title;
}

// L5: 生成タイトルをスプレッドシート 'タイトル生成ログ' に追記
//  - 列: 日時 / 管理番号 / バージョン / ブランド / サイズ / カラー / カテゴリ / キーワード / 生成タイトル / 字数
//  - シートが無ければヘッダ付きで自動作成
//  - 失敗してもタイトル生成 API を阻害しないこと（呼び出し側 try/catch）
function appendTitleLog_(ss, data, kw, version) {
  if (!ss) return;
  var name = 'タイトル生成ログ';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 10).setValues([[
      '日時','管理番号','バージョン','ブランド','サイズ','カラー','カテゴリ','キーワード','生成タイトル','字数'
    ]]);
    sheet.setFrozenRows(1);
  }
  var title = String(data.generatedTitle || '');
  sheet.appendRow([
    new Date(),
    String(data.id || ''),
    String(version || ''),
    String(data.brand || ''),
    String(data.size || ''),
    String(data.color || ''),
    String(data.category3 || data.category2 || ''),
    ((kw && kw.keywords) || []).join(' '),
    title,
    title.length
  ]);
}

// ?cattop=1&top=N で 商品管理シート カテゴリ3 の頻出上位 N 件を返す（L2 辞書作成用の一時ヘルパ）
function categoryTopFrequencies_(e) {
  var top = Math.max(1, Math.min(200, parseInt((e && e.parameter && e.parameter.top) || '50', 10) || 50));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var ssId = (function() { try { return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || ''; } catch(_) { return ''; } })();
    if (ssId) ss = SpreadsheetApp.openById(ssId);
  }
  if (!ss) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'no spreadsheet' })).setMimeType(ContentService.MimeType.JSON);
  var sheet = ss.getSheetByName('商品管理');
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'no sheet' })).setMimeType(ContentService.MimeType.JSON);
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ ok: true, results: [] })).setMimeType(ContentService.MimeType.JSON);
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  var c2 = col['カテゴリ2'], c3 = col['カテゴリ3'];
  if (!c2 && !c3) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'no category cols' })).setMimeType(ContentService.MimeType.JSON);
  var rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var freq3 = {}, freq2 = {};
  rows.forEach(function(r) {
    if (c3) {
      var v3 = String(r[c3 - 1] || '').trim();
      if (v3) freq3[v3] = (freq3[v3] || 0) + 1;
    }
    if (c2) {
      var v2 = String(r[c2 - 1] || '').trim();
      if (v2) freq2[v2] = (freq2[v2] || 0) + 1;
    }
  });
  function topN(map) {
    return Object.keys(map).map(function(k) { return [k, map[k]]; })
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, top);
  }
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    category3_top: topN(freq3),
    category2_top: topN(freq2)
  }, null, 2)).setMimeType(ContentService.MimeType.JSON);
}
