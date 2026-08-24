// BulkProduct.gs
// =====================================================
// BulkProduct.gs — アソート商品データ読み込み（画像5枚対応）
// =====================================================

/**
 * アソート商品一覧を取得（キャッシュ付き）
 * @returns {object[]} 商品リスト
 */
// =====================================================
// 2026-06-01「採寸撮影付き」リブランドの一回限り反映（実行済み・現在は休眠）
// ScriptProperty PREMIUM_REPRICED_PROP_ が「シート価格を反映済み」のラッチになっており、
// ONの間は何もしない。このフラグは SubmitFix.gs の getPremiumTarget_() も参照していて、
// 選定目標額と顧客表示価格が食い違わないようにしている（フラグを手で消さないこと）。
// 以降の価格改定は applyPremiumRepricingNow() を手動実行する運用に切り替えた。
// =====================================================
function maybeApplyPremiumRepricing_() {
  if (typeof PRICE_TIER_V2_EFFECTIVE_MS_ === 'undefined') return;
  if (Date.now() < PRICE_TIER_V2_EFFECTIVE_MS_) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PREMIUM_REPRICED_PROP_) === '1') return;
  var n = applyPremiumRepricing_();
  // 1行以上更新できた時だけフラグON（名称不一致による無言失敗を防ぐ＝次回読込で再試行）
  if (n > 0) {
    props.setProperty(PREMIUM_REPRICED_PROP_, '1');
    console.log('プレミアムアソート 価格反映完了: ' + n + '行更新');
  } else {
    console.warn('プレミアムアソート 価格反映: 対象行が見つからずスキップ（シートの商品名を要確認）');
  }
}

// =====================================================
// 2026-08-29 値下げの自動反映（無人・一回限り）
// -----------------------------------------------------
// SubmitFix.gs の選定目標額は PREMIUM_TARGET_V3_EFFECTIVE_MS_ を過ぎると**自動でV3に切り替わる**。
// シート側（顧客価格・タイトル・説明）が手動のままだと、切替直後に
//   「客は旧価格¥16,200を払うのに、箱の中身は新目標額¥14,800分しか入らない」
// という逆ざや（お得額がマイナス）の窓が開く。両者は必ず同時に動かす必要があるため、
// 発効時刻を過ぎた最初のシート読込で一度だけ自動反映する。
//
// ・ScriptProperty PREMIUM_REPRICED_V3_PROP_ が反映済みラッチ（手で消さないこと）
// ・1行以上書けた時だけラッチON＝商品名不一致で空振りした場合は次回読込で再試行
// ・同時実行はロックで弾く（書き換え自体は冪等なので二重実行しても結果は同じ）
// ・画像(G〜K列)は PREMIUM_IMAGES_V3_ が空なら据え置き。Canva画像が間に合わなくても
//   価格・文言は正しく切り替わる（画像は後から applyPremiumRepricingNow() で差し替え可）
// =====================================================
var PREMIUM_REPRICED_V3_PROP_ = 'PREMIUM_REPRICED_0829';

function maybeApplyPremiumRepricingV3_() {
  if (typeof PREMIUM_TARGET_V3_EFFECTIVE_MS_ === 'undefined') return;
  if (Date.now() < PREMIUM_TARGET_V3_EFFECTIVE_MS_) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PREMIUM_REPRICED_V3_PROP_) === '1') return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;   // 別実行が反映中。次回読込に任せる
  try {
    if (props.getProperty(PREMIUM_REPRICED_V3_PROP_) === '1') return;   // ロック待ちの間に済んでいた
    var n = applyPremiumRepricing_(false);
    if (n > 0) {
      props.setProperty(PREMIUM_REPRICED_V3_PROP_, '1');
      console.log('プレミアムアソート 2026-08-29値下げ 自動反映完了: ' + n + '行更新');
    } else {
      console.warn('プレミアムアソート 2026-08-29値下げ 自動反映: 対象行が見つからずスキップ（シートの商品名を要確認）');
    }
  } catch (e) {
    console.error('プレミアムアソート 2026-08-29値下げ 自動反映エラー:', e);
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// 2026-08 プレミアムアソート 値下げ・点数改定（在庫消化・現金化優先）
// -----------------------------------------------------
// アソート商品シートのプレミアム3行について、次の列を一度の実行でまとめて書き換える。
//   B列 商品名   … 先頭の「○円分お得」を新しいお得額に置換
//   C列 説明     … 「必ず○円(税込み)以上」＝選定目標額 ／「・販売価格：○円（税込み）」＝顧客価格
//   D列 価格     … 顧客が払う販売価格
//   G〜K列 画像  … PREMIUM_IMAGES_V3_ に値が入っている場合のみ差し替え（空ならその枠は据え置き）
//
// 書き換え後は既存の同期経路が自動で追随するため、ここ以外の作業は不要。
//   BASE     : BulkBaseSync.gs baseSyncProductsToBase()（5分Cron・MD5差分で title/detail/price/画像を検知）
//   自社サイト: SyncApi.gs exportBulkProducts_() → Worker 5分Cron → D1 → KV → BulkLP
// 反映まで最大およそ10分。急ぐ場合は applyPremiumRepricingNow() がキャッシュも落とす。
// =====================================================

// お客様が払う「販売価格」（シートD列）。
// 自動選定の目標額（SubmitFix.gs PREMIUM_ASSORT_TARGET_V2_）とは別物で、こちらの方が安い。
// 差額がそのまま商品名の「○円分お得」訴求になるため、**両者を同額にしないこと**。
var PREMIUM_PRICE_V3_ = {
  'プレミアムアソート小ロット': 6800,   // 据置（目標7,900・お得+1,100・約16点）
  'プレミアムアソート中ロット': 12800,  // 16,200 → 12,800（目標14,800・お得+2,000・30点）
  'プレミアムアソート大ロット': 19800   // 32,000 → 19,800（目標22,600・お得+2,800・約46点）
};

// 差し替える画像URL（G〜K列 = 画像URL1〜5）。Canvaで作り直したものをここに入れる。
// 空文字／未指定のスロットは既存の画像をそのまま残す（＝全部空ならA工程では画像を一切触らない）。
// Googleドライブ直リンクの形式: https://lh3.googleusercontent.com/d/<fileId>
var PREMIUM_IMAGES_V3_ = {
  'プレミアムアソート小ロット': ['', '', '', '', ''],
  'プレミアムアソート中ロット': ['', '', '', '', ''],
  'プレミアムアソート大ロット': ['', '', '', '', '']
};

// 3桁区切り（説明文・商品名の表記に合わせる）
function premium_yen_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 商品名／説明文の「価格が書かれている箇所」だけを新しい金額に差し替える。
// 実データの表記ゆれ（お得額はカンマあり・目標額は半角括弧・販売価格は全角括弧）に合わせている。
function premium_rewriteName_(name, deal) {
  if (!/^[0-9,]+円分お得/.test(name)) return name;   // 想定外の書式なら触らない
  return name.replace(/^[0-9,]+円分お得/, premium_yen_(deal) + '円分お得');
}
function premium_rewriteDesc_(desc, target, price) {
  var s = String(desc || '');
  // 「封入内容は…が必ず7,400円(税込み)以上の商品に調整して…」→ 選定目標額
  s = s.replace(/必ず[0-9,]+円\(税込み\)以上/g, '必ず' + premium_yen_(target) + '円(税込み)以上');
  // 「・販売価格：6,800円（税込み）／1パッケージ」→ 顧客価格
  s = s.replace(/・販売価格：[0-9,]+円（税込み）/g, '・販売価格：' + premium_yen_(price) + '円（税込み）');
  return s;
}

// アソート商品シートのプレミアム3行を最新の価格・訴求文言・画像に更新し、更新できた行数を返す。
// ScriptProperty のフラグは見ない（手動でも単独実行可能）。書き換えは冪等。
function applyPremiumRepricing_(dryRun, force) {
  // PREMIUM30（30%OFF・〜2026-08-28）が旧価格でメルマガ配信済みのため、発効時刻までは書き込まない。
  // 下見（dryRun）はいつでも可。どうしても前倒しする場合は applyPremiumRepricingNow(true)。
  if (!dryRun && !force
      && typeof PREMIUM_TARGET_V3_EFFECTIVE_MS_ !== 'undefined'
      && Date.now() < PREMIUM_TARGET_V3_EFFECTIVE_MS_) {
    console.warn('プレミアムアソート反映: 発効時刻（2026-08-29 00:00 JST）前のため中止しました。'
      + '内容の確認は previewPremiumRepricing()、前倒しは applyPremiumRepricingNow(true)。');
    return 0;
  }
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return 0;
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var note = '【採寸撮影データ付き】出品キットから全商品の撮影画像をダウンロードでき、フリマ出品にそのまま使えます。';
  var count = 0;

  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][c.name] || '').trim();
    // 完全一致または部分一致（小/中/大は互いに部分文字列にならないため安全）
    var matchKey = null;
    for (var k in PREMIUM_PRICE_V3_) { if (name === k || name.indexOf(k) >= 0) { matchKey = k; break; } }
    if (!matchKey) continue;

    var row = i + 2;
    var price = PREMIUM_PRICE_V3_[matchKey];
    // 目標額は SubmitFix.gs の一箇所だけを正とし、お得額は「目標額 − 販売価格」から必ず計算する
    // （手打ちしないことで、目標額を変えたときにお得額の表記だけ取り残される事故を防ぐ）。
    var target = (typeof PREMIUM_ASSORT_TARGET_V3_ !== 'undefined' && PREMIUM_ASSORT_TARGET_V3_[matchKey])
      ? PREMIUM_ASSORT_TARGET_V3_[matchKey] : 0;
    var deal = target - price;
    var changes = [];

    // --- B列 商品名 ---
    if (target > 0 && deal > 0) {
      var newName = premium_rewriteName_(name, deal);
      if (newName !== name) {
        changes.push('商品名: ' + name + '  →  ' + newName);
        if (!dryRun) sh.getRange(row, c.name + 1).setValue(newName);
      }
    } else {
      console.warn('プレミアムアソート: 目標額が取得できないため商品名は据え置き（' + matchKey + '）');
    }

    // --- C列 説明 ---
    var desc = String(data[i][c.description] || '');
    var newDesc = (target > 0) ? premium_rewriteDesc_(desc, target, price) : desc;
    if (newDesc.indexOf('採寸撮影データ付き') < 0) {
      newDesc = newDesc ? (newDesc + ' ' + note) : note;
    }
    if (newDesc !== desc) {
      changes.push('説明: 目標' + premium_yen_(target) + '円 / 販売' + premium_yen_(price) + '円 に更新');
      if (!dryRun) sh.getRange(row, c.description + 1).setValue(newDesc);
    }

    // --- D列 価格 ---
    var curPrice = Number(data[i][c.price]) || 0;
    if (curPrice !== price) {
      changes.push('価格: ' + premium_yen_(curPrice) + '円  →  ' + premium_yen_(price) + '円');
      if (!dryRun) sh.getRange(row, c.price + 1).setValue(price);
    }

    // --- G〜K列 画像（値が入っているスロットだけ差し替え） ---
    var imgs = PREMIUM_IMAGES_V3_[matchKey] || [];
    for (var j = 0; j < 5; j++) {
      var url = String(imgs[j] || '').trim();
      if (!url) continue;                                  // 空なら既存画像を維持
      var cur = String(data[i][c.image1 + j] || '').trim();
      if (cur === url) continue;
      changes.push('画像URL' + (j + 1) + ': 差し替え');
      if (!dryRun) sh.getRange(row, c.image1 + j + 1).setValue(url);
    }

    if (changes.length) {
      console.log('プレミアムアソート' + (dryRun ? '(下見)' : '') + ' [' + matchKey + '] 行' + row + '\n  - ' + changes.join('\n  - '));
    } else {
      console.log('プレミアムアソート' + (dryRun ? '(下見)' : '') + ' [' + matchKey + '] 行' + row + ' 変更なし');
    }
    count++;
  }

  if (count > 0 && !dryRun) SpreadsheetApp.flush();
  return count;
}

/**
 * 【手動実行用】プレミアムアソートの価格・訴求文言・画像をシートに反映し、キャッシュも落とす。
 * GASエディタからこの関数を選んで実行する。反映は BASE / 自社サイトとも最大およそ10分。
 * 2026-08-29 00:00 JST より前は安全のため中止する（force に true を渡すと前倒し実行）。
 */
function applyPremiumRepricingNow(force) {
  var n = applyPremiumRepricing_(false, force === true);
  bulk_clearCache_();
  var msg = 'プレミアムアソート反映: ' + n + '行を処理し、アソート商品キャッシュをクリアしました。';
  console.log(msg);
  return msg;
}

/**
 * 【下見用・書き込みなし】何がどう変わるかをログに出すだけ。実行前の確認に使う。
 */
function previewPremiumRepricing() {
  var n = applyPremiumRepricing_(true);
  var msg = 'プレミアムアソート下見: ' + n + '行が対象です（シートは変更していません）。';
  console.log(msg);
  return msg;
}

function bulk_getProducts_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(BULK_CONFIG.cache.key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  var products = bulk_readProductsFromSheet_();

  try {
    cache.put(BULK_CONFIG.cache.key, JSON.stringify(products), BULK_CONFIG.cache.ttl);
  } catch (e) {
    console.log('アソート商品キャッシュ保存エラー:', e);
  }

  return products;
}

/**
 * スプレッドシートからアソート商品データを読み込み
 * @returns {object[]} 公開中・表示順ソート済みの商品リスト
 */
function bulk_readProductsFromSheet_() {
  try { maybeApplyPremiumRepricing_(); } catch (e) {}
  try { maybeApplyPremiumRepricingV3_(); } catch (e) {}
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return [];

  var ss;
  try { ss = SpreadsheetApp.openById(ssId); } catch (e) { console.error('アソート商品SS open error:', e); return []; }
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var c = BULK_CONFIG.cols;
  var products = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    var productId = String(row[c.productId] || '').trim();
    if (!productId) continue;

    // 公開・在庫チェック → soldOut フラグ
    var active = row[c.active];
    var isActive = (active === true || String(active).toUpperCase() === 'TRUE');
    var stockRaw = row[c.stock];
    var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
    if (isNaN(stock)) stock = -1;
    var soldOut = (!isActive || stock === 0);

    // 画像URL（最大5枚、空でないものだけ収集）
    var images = [];
    for (var imgIdx = c.image1; imgIdx <= c.image5; imgIdx++) {
      var imgUrl = String(row[imgIdx] || '').trim();
      if (imgUrl && imgUrl.indexOf('drive.google.com') !== -1) {
        var m = imgUrl.match(/[?&]id=([^&]+)/);
        if (m) imgUrl = 'https://lh3.googleusercontent.com/d/' + m[1];
      }
      if (imgUrl) images.push(imgUrl);
    }

    var discount = Number(row[c.discount]) || 0;
    if (discount < 0 || discount > 1) discount = 0;
    var basePrice = Number(row[c.price]) || 0;

    products.push({
      productId: productId,
      name: String(row[c.name] || '').trim(),
      description: String(row[c.description] || '').trim(),
      price: basePrice,
      discountRate: discount,
      discountedPrice: discount > 0 ? Math.round(basePrice * (1 - discount)) : basePrice,
      unit: String(row[c.unit] || '').trim(),
      tag: String(row[c.tag] || '').trim(),
      images: images,
      minQty: Math.max(1, Number(row[c.minQty]) || 1),
      maxQty: Math.max(1, Number(row[c.maxQty]) || 99),
      sortOrder: Number(row[c.sortOrder]) || 999,
      stock: stock,
      soldOut: soldOut
    });
  }

  // 表示順でソート
  products.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

  return products;
}

/**
 * アソート商品キャッシュを無効化
 */
function bulk_clearCache_() {
  try { CacheService.getScriptCache().remove(BULK_CONFIG.cache.key); } catch (e) {}
}

/**
 * BULKスプレッドシートの onEdit ハンドラ
 * アソート商品シートが編集されたら GAS キャッシュを即クリアし、
 * Workers 側にも apiBulkRefresh を投げて D1 + KV を即時更新する。
 *
 * トリガー登録: Triggers.gs の tr_setupTriggersOnce_() 内で
 *   ScriptApp.newTrigger('bulk_onEdit').forSpreadsheet(bulkSs).onEdit().create()
 */
function bulk_onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (!sh || sh.getName() !== BULK_CONFIG.sheetName) return;
    // ヘッダー行は無視
    if (e.range.getRow() < 2) return;

    // GASキャッシュを即クリア
    bulk_clearCache_();

    // Workers にも即時反映を依頼（fire-and-forget）
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
    var adminKey = props.getProperty('ADMIN_KEY') || '';
    if (!adminKey) {
      console.warn('bulk_onEdit: ADMIN_KEY未設定のためWorkers更新スキップ');
      return;
    }

    try {
      var resp = UrlFetchApp.fetch(workersUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          action: 'apiBulkRefresh',
          args: [{ adminKey: adminKey }]
        }),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code !== 200) {
        console.warn('bulk_onEdit: Workers refresh HTTP ' + code + ' body=' + resp.getContentText().slice(0, 200));
      }
    } catch (err) {
      console.error('bulk_onEdit: Workers refresh error: ' + (err && err.message || err));
    }
  } catch (err) {
    console.error('bulk_onEdit error: ' + (err && err.message || err));
  }
}

// adminBulkUploadImage は削除済み — saisun-list-bulk/コード.gs:294 に一本化
// BulkAdminModal.html は saisun-list-bulk にのみ存在

/**
 * アソート商品の初期化API（フロントエンドから呼ばれる）
 * @returns {object} { ok, products, settings }
 */
function apiBulkInit() {
  try {
    console.log('apiBulkInit: start');
    var products = bulk_getProducts_();
    console.log('apiBulkInit: products=' + products.length);
    var memberDiscount = app_getMemberDiscountStatus_();

    var detauriUrl = '';
    try { detauriUrl = SITE_CONSTANTS.SITE_URL || ''; } catch (e2) { console.log('apiBulkInit: SITE_URL error: ' + e2); }
    if (!detauriUrl) {
      try { detauriUrl = ScriptApp.getService().getUrl(); } catch (e3) { console.log('apiBulkInit: ScriptApp URL error: ' + e3); }
    }

    // 実績統計をキャッシュから付加
    var siteStats = null;
    try { siteStats = st_getStatsCache_(); } catch (e4) {}

    return {
      ok: true,
      products: products,
      settings: {
        appTitle: APP_CONFIG.appTitle,
        channel: BULK_CONFIG.channel,
        shippingAreas: SHIPPING_AREAS,
        shippingRates: SHIPPING_RATES,
        memberDiscount: memberDiscount,
        detauriUrl: detauriUrl,
        alwaysChargeShippingIds: (typeof SHIPPING_CONSTANTS !== 'undefined' && SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS) ? SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS : []
      },
      stats: siteStats
    };
  } catch (e) {
    console.error('apiBulkInit error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : ''));
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}
