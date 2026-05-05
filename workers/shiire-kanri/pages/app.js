const API_BASE = ''; // Workers 同一オリジンで /api/* と SPA HTML を提供

var STATE = {
  email: '', userName: '', allowed: false,
  tab: 'shouhin', filter: '', filterLabel: '',
  business: '', businessLabel: '',
  view: 'list', current: null, items: [],
  currentShiireProducts: [],
  workers: [], accounts: [],
  suppliers: [], places: [], categories: [],
  settings: {},
  saleChannels: {}, // { 'メルカリ': {rate:0.1, enabled:true}, ... } — 設定シートL列以降から
  // 商品管理タブの並び順 / 密度（localStorage で永続化）
  shouhinSort: (function(){ try { return localStorage.getItem('sk.shouhinSort') || 'kanri'; } catch(e){ return 'kanri'; } })(),
  // 発送商品タブの表示グループ: 'pending'(発送待ち) | 'shipped'(発送済み)
  hassouFilter: (function(){ try { return localStorage.getItem('sk.hassouFilter') || 'pending'; } catch(e){ return 'pending'; } })(),
  density:     (function(){ try { return localStorage.getItem('sk.density') || 'normal'; } catch(e){ return 'normal'; } })(),
  // 管理番号 → AI prefill fields のクライアントキャッシュ
  // 仕入れ選択時に一括プリフェッチして埋める。GET /api/ai/prefill より優先
  aiPrefillCache: new Map()
};
// 起動時に密度クラスを body に反映
(function applyInitialDensity_(){
  try { document.body.classList.toggle('density-compact', STATE.density === 'compact'); } catch(e) {}
})();

// ========== 自動更新（AppSheet風のサイレントポーリング） ==========
const POLL_INTERVAL_MS = 30000; // 30秒
var pollTimer = null;
var isAutoRefreshing = false;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(autoRefresh, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
async function autoRefresh() {
  if (isAutoRefreshing) return;
  if (!STATE.allowed) return;
  if (document.visibilityState !== 'visible') return;
  // モーダル表示中は更新しない（フォーム入力中の事故防止）
  var mask = document.getElementById('modal-mask');
  if (mask && mask.classList.contains('show')) return;
  // 詳細画面・新規作成フォームはローカル編集状態があるので自動更新しない
  // （これがないと「返送/移動報告 新規作成中に勝手に一覧に戻る」現象が起きる）
  if (STATE.view !== 'list') return;
  isAutoRefreshing = true;
  try {
    refreshCounts();
    if (STATE.tab === 'shouhin' || STATE.tab === 'hassou') {
      await renderShouhinList({ silent: true });
    } else if (STATE.tab === 'uriage') {
      await renderUriageDashboard({ silent: true });
    } else if (STATE.tab === 'shiire') {
      await renderShiireList({ silent: true });
    } else if (STATE.tab === 'basho') {
      await renderBashoList();
    } else if (STATE.tab === 'hensou') {
      await renderHensouList();
    } else if (STATE.tab === 'ai') {
      await renderAiList();
    } else if (STATE.tab === 'sagyou') {
      await renderSagyouList();
    } else if (STATE.tab === 'business' && STATE.business) {
      await renderBusinessSheet(STATE.business);
    }
  } catch (err) {
    console.warn('autoRefresh failed', err);
  } finally {
    isAutoRefreshing = false;
  }
}
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'visible') autoRefresh();
});
window.addEventListener('focus', autoRefresh);

// SW へ「次回起動用に裏で温めて」と依頼。SWR 対象（counts 等）の Cache API を最新化させる。
// /api/products と /api/purchases は network-first なので温めても無駄なので含めない。
function warmApiCachesViaSW_() {
  try {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    var urls = [
      '/api/products/counts',
    ];
    navigator.serviceWorker.controller.postMessage({ type: 'WARM_API', urls: urls });
  } catch(e) {}
}
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'hidden') warmApiCachesViaSW_();
});
window.addEventListener('pagehide', warmApiCachesViaSW_);

// P2 #93: スクロール方向に応じて appbar を隠す/表示する
(function setupAppbarHideOnScroll_(){
  var lastY = 0;
  var ticking = false;
  var DOWN_THRESHOLD = 80; // 下スクロール開始から隠すまでのピクセル
  var hidden = false;
  function update() {
    var y = window.scrollY || window.pageYOffset || 0;
    var dy = y - lastY;
    if (y < 10) {
      // 最上部に戻ったら必ず表示
      if (hidden) { document.body.classList.remove('appbar-hidden'); hidden = false; }
    } else if (dy > 4 && y > DOWN_THRESHOLD) {
      if (!hidden) { document.body.classList.add('appbar-hidden'); hidden = true; }
    } else if (dy < -4) {
      if (hidden) { document.body.classList.remove('appbar-hidden'); hidden = false; }
    }
    lastY = y;
    ticking = false;
  }
  window.addEventListener('scroll', function(){
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
})();

// 日付フィールドはラベル・余白・入力欄のどこをタップ／クリックしてもカレンダーを開く
// （PC Chrome は入力欄の文字エリアをクリックしても標準ではピッカーが開かないため、
//   row 内のあらゆるクリックで input.showPicker() を呼ぶ）
document.addEventListener('click', function(e){
  var row = e.target.closest && e.target.closest('.field-row');
  if (!row) return;
  var input = row.querySelector('input[type="date"]');
  if (!input) return;
  if (typeof input.showPicker === 'function') {
    try { input.showPicker(); return; } catch (_) { /* fallback to focus */ }
  }
  input.focus();
});

// タグ表記 入力／性別 変更 で メルカリサイズ を即時派生（詳細編集 f_ / 新規作成 cf_ 共通）
// 既存値があっても性別/タグ変更時は再派生（手動選択を尊重したい場合は SELECT を直接触れば確定）
function deriveMercariSizeForPrefix_(prefix) {
  var tagEl = document.getElementById(prefix + escFieldId_('タグ表記'));
  var sizeEl = document.getElementById(prefix + escFieldId_('メルカリサイズ'));
  var genderEl = document.getElementById(prefix + escFieldId_('性別'));
  if (!tagEl || !sizeEl) return;
  var derived = (typeof convertTagToMercariSize_ === 'function')
    ? convertTagToMercariSize_(tagEl.value, genderEl ? genderEl.value : '')
    : '';
  if (!derived) return;
  if (sizeEl.tagName === 'SELECT') {
    var has = false;
    for (var i = 0; i < sizeEl.options.length; i++) {
      if (sizeEl.options[i].value === derived) { has = true; break; }
    }
    if (!has) {
      var opt = document.createElement('option');
      opt.value = derived; opt.textContent = derived;
      sizeEl.appendChild(opt);
    }
  }
  sizeEl.value = derived;
}
document.addEventListener('input', function(e){
  var t = e.target;
  if (!t || !t.id) return;
  var TAG_IDS = ['f_' + escFieldId_('タグ表記'), 'cf_' + escFieldId_('タグ表記')];
  if (TAG_IDS.indexOf(t.id) < 0) return;
  var prefix = t.id.slice(0, t.id.indexOf('_') + 1);
  deriveMercariSizeForPrefix_(prefix);
});
document.addEventListener('change', function(e){
  var t = e.target;
  if (!t || !t.id) return;
  var GENDER_IDS = ['f_' + escFieldId_('性別'), 'cf_' + escFieldId_('性別')];
  if (GENDER_IDS.indexOf(t.id) < 0) return;
  var prefix = t.id.slice(0, t.id.indexOf('_') + 1);
  deriveMercariSizeForPrefix_(prefix);
});
// カテゴリ1 → カテゴリ2、カテゴリ2 → カテゴリ3 の再構築（AppSheet の依存ドロップダウン同等）
function refillCategory2_(prefix) {
  var c1El = document.getElementById(prefix + escFieldId_('カテゴリ1'));
  var c2El = document.getElementById(prefix + escFieldId_('カテゴリ2'));
  if (!c2El) return;
  var c1 = c1El ? c1El.value : '';
  var current = c2El.value;
  var list = category2OptionsFor_(c1);
  c2El.innerHTML = categoryOptionsHtml_(list, list.indexOf(current) >= 0 ? current : '');
  refillCategory3_(prefix);
}
function refillCategory3_(prefix) {
  var c1El = document.getElementById(prefix + escFieldId_('カテゴリ1'));
  var c2El = document.getElementById(prefix + escFieldId_('カテゴリ2'));
  var c3El = document.getElementById(prefix + escFieldId_('カテゴリ3'));
  if (!c3El) return;
  var c1 = c1El ? c1El.value : '';
  var c2 = c2El ? c2El.value : '';
  var current = c3El.value;
  var list = category3OptionsFor_(c1, c2);
  c3El.innerHTML = categoryOptionsHtml_(list, list.indexOf(current) >= 0 ? current : '');
}
document.addEventListener('change', function(e){
  var t = e.target;
  if (!t || !t.id) return;
  var CAT1_IDS = ['f_' + escFieldId_('カテゴリ1'), 'cf_' + escFieldId_('カテゴリ1')];
  var CAT2_IDS = ['f_' + escFieldId_('カテゴリ2'), 'cf_' + escFieldId_('カテゴリ2')];
  if (CAT1_IDS.indexOf(t.id) >= 0) {
    var p1 = t.id.slice(0, t.id.indexOf('_') + 1);
    refillCategory2_(p1);
  } else if (CAT2_IDS.indexOf(t.id) >= 0) {
    var p2 = t.id.slice(0, t.id.indexOf('_') + 1);
    refillCategory3_(p2);
  }
});
function escFieldId_(name) {
  return name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); });
}

// 設定シートからプルダウンを引く項目（キー=フォーム項目名, 値=設定シートの列ヘッダー）
// カテゴリ1/2/3 は AppSheet 同等の依存プルダウン（CATEGORY*_BY_*）で生成するため、ここからは除外
var SETTINGS_FIELD_MAP = {
  '状態': '状態',
  '発送方法': '発送方法',
  'カラー': 'カラー1',
  'メルカリサイズ': 'サイズ'
};

// カテゴリ1 → カテゴリ2 → カテゴリ3 の依存プルダウン（AppSheet の SWITCH/IF 同等）
var CATEGORY1_OPTIONS = ['レディース','メンズ','キッズ'];
var CATEGORY2_BY_CAT1 = {
  'レディース': ['トップス','ジャケット・アウター','パンツ','スカート','ワンピース','ドレス・ブライダル','スーツ・フォーマル','スーツセットアップ','ジャージセットアップ','ルームウェア・パジャマ','サロペット・オーバーオール','マタニティ'],
  'メンズ': ['トップス','ジャケット・アウター','パンツ','スーツ','ジャージセットアップ','ルームウェア・パジャマ','サロペット・オーバーオール'],
  'キッズ': ['キッズ']
};
var CATEGORY3_BY_CAT1_CAT2 = {
  'レディース-トップス': ['シャツ/ブラウス','Tシャツ/カットソー','ニット/セーター','カーディガン','ボレロ','アンサンブル','パーカー','トレーナー','スウェット','ベスト','ジレ','ビスチェ','チュニック','タンクトップ','キャミソール','ベアトップ','チューブトップ','ジャージ','ポロシャツ'],
  'レディース-ジャケット・アウター': ['ダウンジャケット','ロングコート','ジャンパー','ブルゾン','テーラードジャケット','ノーカラージャケット','トレンチコート','スプリングコート','毛皮ファーコート','レザージャケット','ライダース','Gジャン','デニムジャケット','カバーオール','フリースジャケット','ボアジャケット','ダウンベスト','キルティングベスト','キルティングジャケット','ムートンコート','チェスターコート','ポンチョ','ケープコート','ピーコート','ウールコート','ダッフルコート','モッズコート','ミリタリージャケット','MA-1','スタジャン','スカジャン','マウンテンパーカー'],
  'レディース-パンツ': ['カジュアルパンツ','デニム/ジーンズ','ショートパンツ','ハーフパンツ','ワークパンツ','カーゴパンツ','ワイドパンツ','イージーパンツ','スラックス','スキニーパンツ','キュロット','ガウチョパンツ','サルエルパンツ','ジョガーパンツ','スウェットパンツ','チノパン'],
  'レディース-スカート': ['ロングスカート','ひざ丈スカート','ミニスカート'],
  'レディース-ワンピース': ['ロングワンピース','ひざ丈ワンピース','ミニワンピース'],
  'レディース-ドレス・ブライダル': ['ウェディングドレス','パーティードレス','カラードレス','ナイトドレス','キャバドレス','チャイナドレス'],
  'レディース-スーツ・フォーマル': ['ビジネススーツ','ブラックスーツ','礼服','喪服','セレモニースーツ','リクルートスーツ'],
  'レディース-スーツセットアップ': ['パンツセットアップ/ツーピース','パンツセットアップ/スリーピース','スカートセットアップ/ツーピース'],
  'レディース-ルームウェア・パジャマ': ['ルームウェア','ネグリジェ','パジャマ','腹巻き','バスローブ','ガウン','ステテコ'],
  'レディース-サロペット・オーバーオール': ['サロペット','オーバーオール','オールインワン'],
  'レディース-マタニティ': ['マタニティ'],
  'メンズ-トップス': ['Tシャツ','パーカー','シャツ','トレーナー','スウェット','ニット/セーター','五分袖カットソー','七分袖カットソー','長袖カットソー','ジャージ','カーディガン','ベスト','ポロシャツ','タンクトップ','ノースリーブトップス'],
  'メンズ-ジャケット・アウター': ['ダウンジャケット','ジャンパー','ブルゾン','ナイロンジャケット','マウンテンパーカー','レザージャケット','ライダース','テーラードジャケット','Gジャン/デニムジャケット','ミリタリージャケット','スタジャン','ダウンベスト','キルティングベスト','ステンカラーコート','MA-1/フライトジャケット','チェスターコート','スカジャン','トレンチコート','モッズコート','カバーオール','ピーコート','ウールコート','ダッフルコート','ノーカラージャケット','キルティングジャケット','フリースジャケット','ボアジャケット'],
  'メンズ-パンツ': ['デニム/ジーンズ','ワークパンツ','カーゴパンツ','ペインターパンツ','スラックス','ショートパンツ','ハーフパンツ','チノパン','オーバーオール','つなぎ','サルエルパンツ','ジョガーパンツ','スウェットパンツ','スキニーパンツ','ワイドパンツ','イージーパンツ'],
  'メンズ-スーツ': ['ビジネススーツ','カジュアルスーツ','ブラックフォーマル','ビジネスジャケット','スーツベスト','スラックス','フォーマルシャツ','フォーマルベスト','フォーマル小物カフス','モーニング/フロックコート','燕尾服タキシード','セットアップ/ツーピース','セットアップ/スリーピース'],
  'メンズ-ルームウェア・パジャマ': ['ルームウェア','パジャマ','バスローブ','ガウン','ステテコ','腹巻き'],
  'メンズ-サロペット・オーバーオール': ['サロペット','オーバーオール','オールインワン']
};
function category2OptionsFor_(cat1) {
  return CATEGORY2_BY_CAT1[String(cat1 || '').trim()] || [];
}
function category3OptionsFor_(cat1, cat2) {
  if (String(cat1 || '').trim() === 'キッズ') return ['キッズ'];
  return CATEGORY3_BY_CAT1_CAT2[String(cat1 || '').trim() + '-' + String(cat2 || '').trim()] || [];
}
// 既存値がリストに無くても保持して表示する <select> 用 options
function categoryOptionsHtml_(list, current) {
  var cur = String(current || '');
  var html = '<option value=""' + (cur === '' ? ' selected' : '') + '>—</option>';
  var found = false;
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    var sel = (v === cur) ? ' selected' : '';
    if (sel) found = true;
    html += '<option value="' + esc(v) + '"' + sel + '>' + esc(v) + '</option>';
  }
  if (cur && !found) {
    html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '（マスター外）</option>';
  }
  return html;
}

var TAB_LABELS = {
  shiire: '仕入れ管理', shouhin: '商品管理', hassou: '発送商品',
  basho: '場所移動', ai: 'AI', hensou: '返送', uriage: '売上', sagyou: '作業者管理'
};

const MEASURE_FIELDS = ['着丈','肩幅','身幅','袖丈','裄丈','総丈','ウエスト','股上','股下','ワタリ','裾幅','ヒップ'];

// 商品管理シート 68列をセクション分けして詳細編集UIに表示する設計
// type: text | number | date | textarea | image | readonly | status
// readonly: 計算列・自動引き当て列・サーバ側で禁止
// image: 画像URLを表示するだけ（編集はAppSheet側 or Drive直編集）
const STATUS_OPTIONS = ['採寸待ち','撮影待ち','出品待ち','出品作業中','出品中','売却済み','発送済み','完了','キャンセル','返品','廃棄'];
const GENDER_OPTIONS = ['','メンズ','レディース','キッズ','ユニセックス'];
const SHIP_METHOD_OPTIONS = ['','ゆうゆうメルカリ便','らくらくメルカリ便','ポスト','普通郵便','ヤマト宅急便','佐川急便'];
const SALE_CHANNEL_OPTIONS = ['メルカリ','ラクマ'];
const SALE_CHANNEL_DEFAULT = 'メルカリ';
const PROMO_DEFAULT = 'FALSE';

// 設定シートの「販売場所名／手数料率／有効フラグ」3列を行対応で読んだ
// STATE.saleChannels = { 'メルカリ': {rate:0.1, enabled:true}, ... } を最優先で参照する。
// 旧フォーマット（〇〇手数料 という列名に値だけ入っている）も後方互換で残す。
function findFeeRate_(channel) {
  if (!channel) return null;
  var ch = STATE.saleChannels && STATE.saleChannels[channel];
  if (ch && typeof ch.rate === 'number' && !isNaN(ch.rate)) return ch.rate;
  // ---- 旧フォーマット fallback ----
  var settings = STATE.settings || {};
  var keys = Object.keys(settings);
  function tryKey(name) {
    var v = settings[name];
    if (Array.isArray(v) && v.length) {
      var n = parseFloat(v[0]);
      if (!isNaN(n)) return n > 1 ? n / 100 : n;
    }
    return null;
  }
  var exact = tryKey(channel);
  if (exact != null) return exact;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(channel) >= 0) {
      var rate = tryKey(keys[i]);
      if (rate != null) return rate;
    }
  }
  return null;
}

// 販売場所 select の選択肢を STATE.saleChannels（有効フラグTRUEのみ）から動的に返す。
// データ未ロード／空の場合は SALE_CHANNEL_OPTIONS にフォールバック。
function getSaleChannelOptions_() {
  var ch = STATE.saleChannels || {};
  var keys = Object.keys(ch).filter(function(n){ return ch[n] && ch[n].enabled !== false; });
  if (keys.length) return keys;
  return SALE_CHANNEL_OPTIONS;
}

function calcFeeFromSettings_(channel, price) {
  var rate = findFeeRate_(channel);
  var p = Number(price);
  if (rate == null || !p || isNaN(p)) return null;
  return Math.round(p * rate);
}

// 販売場所/販売価格 変更時に手数料を自動再計算（既に手入力で値が入っていても上書き）
// id プリフィックスは 'f_'（詳細フォーム） / 'cf_'（新規作成フォーム）の2系統
function onSaleChannelChange_(el, channelId) {
  var prefix = (channelId || '').slice(0, channelId.indexOf('_') + 1) || 'f_';
  var priceId = prefix + '販売価格'.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); });
  var feeId   = prefix + '手数料'.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); });
  var priceEl = document.getElementById(priceId);
  var feeEl = document.getElementById(feeId);
  if (!feeEl) return;
  var fee = calcFeeFromSettings_(el.value, priceEl ? priceEl.value : 0);
  if (fee != null) feeEl.value = String(fee);
}

// 詳細・新規作成フォームに 販売価格 → 手数料 の自動再計算リスナーを仕込む
// 既に price+channel が入っていて 手数料 が空の場合は初期化時にも計算する
function wireFeeAutoCalc_(idPrefix) {
  function fid(name){ return idPrefix + name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); }); }
  var priceEl = document.getElementById(fid('販売価格'));
  var channelEl = document.getElementById(fid('販売場所'));
  var feeEl = document.getElementById(fid('手数料'));
  if (!priceEl || !channelEl || !feeEl) return;
  function recalc(){
    var fee = calcFeeFromSettings_(channelEl.value, priceEl.value);
    if (fee != null) {
      feeEl.value = String(fee);
      // 手数料の変更を 計算結果（粗利・利益・利益率）にも即時反映
      try { wireSaleCalcResults_recalc_(idPrefix); } catch(e) {}
    }
  }
  priceEl.addEventListener('input', recalc);
  // 初回: 手数料が空で 販売価格・販売場所 が入っているなら一度計算
  if ((!feeEl.value || feeEl.value === '0') && priceEl.value && channelEl.value) {
    recalc();
  }
}

// ローカル TZ で YYYY-MM-DD の本日文字列を返す（toISOString は UTC なので JST 深夜にずれる）
function todayLocalStr_() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// date input にフォーカスが入ったとき、空なら本日を入れる
// 入力イベントを発火させて、savebar / 派生値の再計算もトリガーする
function onDateFieldFocus_(el) {
  if (el && !el.value) {
    el.value = todayLocalStr_();
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
  }
}

// 計算結果（読取専用）の即時再計算
// 販売価格／送料／手数料／販売日／出品日 の input イベントから呼ばれる
function wireSaleCalcResults_recalc_(idPrefix) {
  function fid(name){ return idPrefix + name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); }); }
  var priceEl = document.getElementById(fid('販売価格'));
  var shipEl = document.getElementById(fid('送料'));
  var feeEl = document.getElementById(fid('手数料'));
  var saleDateEl = document.getElementById(fid('販売日'));
  var listingDateEl = document.getElementById(fid('出品日'));

  // フォーム入力をそのまま読む（空文字列は 0 として扱うが、表示判定のため raw も保持）
  var priceRaw = priceEl ? String(priceEl.value || '').trim() : '';
  var shipRaw = shipEl ? String(shipEl.value || '').trim() : '';
  var feeRaw = feeEl ? String(feeEl.value || '').trim() : '';
  var sp = priceRaw === '' ? 0 : Number(priceRaw);
  var ss = shipRaw === '' ? 0 : Number(shipRaw);
  var sf = feeRaw === '' ? 0 : Number(feeRaw);
  if (isNaN(sp)) sp = 0;
  if (isNaN(ss)) ss = 0;
  if (isNaN(sf)) sf = 0;
  var hasPrice = priceRaw !== '';
  var ex = (STATE.current && STATE.current.extra) || {};
  var cost = Number(ex['仕入れ値'] || 0);
  if (isNaN(cost)) cost = 0;

  function setRo(name, text) {
    var el = document.getElementById(fid(name));
    if (el) el.textContent = text;
  }

  // 収支サマリ（販売タブ末尾）も同時更新するヘルパー
  function setSum(id, text, posNeg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (posNeg !== undefined) {
      el.classList.remove('pos', 'neg');
      if (posNeg !== null) el.classList.add(posNeg ? 'pos' : 'neg');
    }
  }
  function fmtYen(v) { return v != null && v !== '' && !isNaN(Number(v)) ? '¥' + Number(v).toLocaleString('ja-JP') : '—'; }

  // 販売価格は フォーム値で表示（空なら "—"）。
  // 旧コードは `sp || ex['販売価格']` で空入力時に古い保存値にフォールバックしていたが、
  // それだと「販売データ削除直後にサマリが古い 1780 のまま」になるバグの原因だった。
  setSum('sum-sale-price', hasPrice ? '¥' + sp.toLocaleString('ja-JP') : '—');
  setSum('sum-cost', fmtYen(cost || ex['仕入れ値']));

  // 派生値は常に再計算する。販売価格 0/空でも 粗利=-送料-手数料、利益=粗利-仕入れ値 を表示。
  // 旧コードは `if (sp > 0)` でガードしていたため、途中入力の負値が消えずに残るバグがあった。
  var gross = sp - ss - sf;
  var profit = gross - cost;
  setRo('粗利', '¥' + gross.toLocaleString('ja-JP'));
  setRo('利益', '¥' + profit.toLocaleString('ja-JP'));
  setSum('sum-profit', '¥' + profit.toLocaleString('ja-JP'), profit >= 0);
  if (sp > 0) {
    var rate = (profit / sp * 100).toFixed(1) + '%';
    setRo('利益率', rate);
    setSum('sum-profit-rate', rate, profit >= 0);
  } else {
    // 販売価格 0 だと利益率は無限大なので "—" 表示にする
    setRo('利益率', '—');
    setSum('sum-profit-rate', '—', null);
  }
  // 在庫日数: 仕入れ日 → 販売日（なければ今日）
  var purchaseDate = ex['仕入れ日'] || '';
  if (purchaseDate) {
    var saleDateStr = (saleDateEl && saleDateEl.value) || '';
    var start = new Date(purchaseDate);
    var end = saleDateStr ? new Date(saleDateStr) : new Date();
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      var days = Math.floor((end.getTime() - start.getTime()) / 86400000);
      if (days >= 0) {
        setRo('在庫日数', days + '日');
        setSum('sum-stockdays', days + '日');
      }
    }
  }
  // リードタイム: 仕入れ日 → 出品日
  var listingDateStr = (listingDateEl && listingDateEl.value) || ex['出品日'] || '';
  if (purchaseDate && listingDateStr) {
    var a = new Date(purchaseDate);
    var b = new Date(listingDateStr);
    if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
      var ld = Math.floor((b.getTime() - a.getTime()) / 86400000);
      if (ld >= 0) {
        setRo('リードタイム', ld + '日');
        setSum('sum-leadtime', ld + '日');
      }
    }
  }
}

// 計算結果（読取専用）の input リスナーを 1 回だけ仕込む
function wireSaleCalcResults_(idPrefix) {
  function fid(name){ return idPrefix + name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); }); }
  ['販売価格', '送料', '手数料', '販売日', '出品日'].forEach(function(name){
    var el = document.getElementById(fid(name));
    if (el) el.addEventListener('input', function(){ wireSaleCalcResults_recalc_(idPrefix); });
  });
  // 初期表示でも一度計算（DOM 側の readonly div を最新状態に）
  wireSaleCalcResults_recalc_(idPrefix);
}

const DETAIL_SECTIONS = [
  { title: '基本情報', fields: [
    ['ステータス','status'],
    ['状態','text'],
    ['ブランド','text'],
    ['タグ表記','text'],
    ['メルカリサイズ','mercarisize'],
    ['性別','gender'],
    ['発送方法','shipmethod'],
    ['カテゴリ1','category1'],
    ['カテゴリ2','category2'],
    ['カテゴリ3','category3'],
    ['デザイン特徴','textarea'],
    ['カラー','color'],
    ['ポケット','yesno'],
    ['ポケット詳細','text'],
    ['透け感','yesno'],
    ['傷汚れ詳細','textarea']
  ]},
  { title: '採寸 (cm)', fields: [
    ['着丈','number'],['肩幅','number'],['身幅','number'],['袖丈','number'],
    ['裄丈','number'],['総丈','number'],['ウエスト','number'],['股上','number'],
    ['股下','number'],['ワタリ','number'],['裾幅','number'],['ヒップ','number']
  ]},
  { title: '採寸記録', fields: [
    ['採寸日','date'],
    ['採寸者','worker']
  ]},
  { title: '撮影・出品', fields: [
    ['撮影日付','date'],
    ['撮影者','worker'],
    ['出品日','date'],
    ['出品者','worker'],
    ['使用アカウント','account'],
    ['リンク','url']
  ]},
  { title: '仕入れ（連動・読取専用）', fields: [
    ['仕入れ日','readonly'],
    ['仕入れ値','readonly'],
    ['納品場所','readonly']
  ]},
  { title: '販売', fields: [
    ['販売日','date'],
    ['販売場所','salechannel'],
    ['プロモーション利用','bool'],
    ['販売価格','number'],
    ['送料','number'],
    ['手数料','number']
  ]},
  { title: '計算結果（読取専用）', fields: [
    ['プロモーション手数料','readonly'],
    ['粗利','readonly'],
    ['利益','readonly'],
    ['利益率','readonly'],
    ['リードタイム','readonly'],
    ['在庫日数','readonly']
  ]},
  { title: '発送関係', fields: [
    ['発送日付','date'],
    ['発送者','worker'],
    ['QR・バーコード画像','image'],
    ['売却済み商品画像','image'],
    ['ポストシール','image'],
    ['完了日','date'],
    ['キャンセル日','date']
  ]},
  { title: 'その他', fields: [
    ['返品日付','date'],
    ['廃棄日','date']
  ]},
  { title: '備考', fields: [
    ['備考','textarea']
  ]}
];

// マスター取得：失敗しても UI は壊さない
async function loadMasters() {
  const tasks = [
    ['/api/master/workers',    'workers'],
    ['/api/master/accounts',   'accounts'],
    ['/api/master/suppliers',  'suppliers'],
    ['/api/master/places',     'places'],
    ['/api/master/categories', 'categories'],
  ];
  await Promise.all(tasks.map(async ([url, key]) => {
    try {
      const r = await api(url);
      STATE[key] = Array.isArray(r.items) ? r.items : [];
    } catch (err) {
      console.warn(key + ' load failed', err);
    }
  }));
  // 設定シート（複数列マスタ：状態/発送方法/カラー1/カテゴリ2/カテゴリ3 等）
  try {
    const r = await api('/api/master/settings');
    STATE.settings = (r.items && typeof r.items === 'object' && !Array.isArray(r.items)) ? r.items : {};
    STATE.saleChannels = (r.saleChannels && typeof r.saleChannels === 'object' && !Array.isArray(r.saleChannels)) ? r.saleChannels : {};
  } catch (err) {
    console.warn('settings load failed', err);
  }
}

// 自分のメール → 作業者マスターの「名前」を解決して STATE.userName に格納
// 業務メニュー（仕入れ数報告 / 経費申請 / 報酬確認）で「自分の行」を絞り込むために必須
// LocalStorage で手動選択（業務メニュー用）の名前をオーバーライド可能。
async function resolveSelfName_() {
  if (!STATE.email) return;
  try {
    const r = await api('/api/sagyousha?months=1');
    const email = String(STATE.email || '').trim().toLowerCase();
    const items = Array.isArray(r.items) ? r.items : [];
    STATE.allWorkers = items;
    const me = items.find(function(w){
      return (String(w.email1 || '').trim().toLowerCase() === email)
          || (String(w.email2 || '').trim().toLowerCase() === email);
    });
    var resolved = me ? String(me.name || '') : '';
    // 手動オーバーライド（管理者がメンバーになりすまして確認する用途／メール登録漏れの暫定対応）
    var manual = '';
    try { manual = String(localStorage.getItem('shiire-kanri:userName') || '').trim(); } catch(e) {}
    if (manual && items.find(function(w){ return String(w.name || '') === manual; })) {
      STATE.userName = manual;
      STATE.userNameOverride = (manual !== resolved);
    } else {
      STATE.userName = resolved;
      STATE.userNameOverride = false;
    }
    STATE.isAdmin = !!(r.currentUser && r.currentUser.isAdmin);
    console.info('[resolveSelfName_] email=' + email + ' resolved=' + (resolved || '(none)') + ' applied=' + (STATE.userName || '(none)') + ' workers=' + items.length);
  } catch (err) {
    console.warn('resolveSelfName_ failed', err);
    STATE.userName = '';
    STATE.allWorkers = [];
  }
}

// 業務メニューで「自分」が解決できなかった or 別の作業者として確認したいときの手動切替
function showUserNamePicker_() {
  var c = document.getElementById('content');
  var workers = STATE.allWorkers || [];
  var html = '<div class="biz-wrap">' +
    '<div class="biz-meta">あなたのメール: <strong>' + esc(STATE.email) + '</strong></div>' +
    '<div class="empty" style="padding:20px;text-align:left">' +
      '<p style="margin:0 0 10px"><strong>作業者マスターにあなたのメールが見つかりませんでした。</strong></p>' +
      '<p style="margin:0 0 14px;font-size:13px;color:var(--text-sub)">' +
        '・メール登録済みなのに表示される場合: 作業者管理タブで「' + esc(STATE.email) + '」が email1 または email2 列に正確に入っているか確認してください（前後の空白・全角文字・大文字小文字違いはNG）。<br>' +
        '・暫定対応として、下から自分の名前を選ぶと業務タブを使えます（端末ごとに保存）。' +
      '</p>';
  if (workers.length) {
    html += '<label style="display:block;margin:10px 0 6px;font-size:13px;color:var(--text-sub)">作業者として表示する</label>' +
      '<select id="user-name-picker" style="width:100%;padding:8px;font-size:14px;border:1px solid #d8dde7;border-radius:6px">' +
        '<option value="">— 選択してください —</option>' +
        workers.map(function(w){
          var label = w.name + (w.email1 ? ' (' + w.email1 + ')' : '');
          return '<option value="' + esc(w.name) + '">' + esc(label) + '</option>';
        }).join('') +
      '</select>' +
      '<button class="btn-primary" style="margin-top:12px;padding:10px 20px;border:0;border-radius:6px;cursor:pointer" onclick="applyUserNameOverride_()">この作業者として開く</button>';
  } else {
    html += '<p style="color:var(--danger)">作業者マスターを取得できませんでした。</p>';
  }
  html += '</div></div>';
  c.innerHTML = html;
}
function applyUserNameOverride_() {
  var sel = document.getElementById('user-name-picker');
  if (!sel || !sel.value) { toast('名前を選んでください', 'error'); return; }
  try { localStorage.setItem('shiire-kanri:userName', sel.value); } catch(e) {}
  STATE.userName = sel.value;
  STATE.userNameOverride = true;
  toast('「' + sel.value + '」として開きます');
  if (STATE.business) renderBusinessSheet(STATE.business);
}

// SETTINGS_FIELD_MAP に登録された項目について、設定シートの値があれば <select> 用 options を返す。なければ null。
function settingsOptionsFor_(name, current) {
  var key = SETTINGS_FIELD_MAP[name];
  if (!key) return null;
  var list = STATE.settings && STATE.settings[key];
  if (!Array.isArray(list) || !list.length) return null;
  return masterOptionsHtml_(list, current);
}

// ========== API ==========
async function api(path, opts) {
  opts = opts || {};
  const res = await fetch(API_BASE + path, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = { ok: false, message: 'invalid response' }; }
  if (!res.ok || !json.ok) {
    const msg = json.message || json.error || ('http ' + res.status);
    throw new Error(msg);
  }
  return json;
}

// ========== 起動 ==========
// number 入力にフォーカスがあるときのマウスホイール操作で値が動かないように抑止
// (ページスクロールしようとして数値が変わる事故を防止)
document.addEventListener('wheel', function(e){
  var t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'number' && document.activeElement === t) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('DOMContentLoaded', async function(){
  try {
    const me = await api('/api/me');
    STATE.email = (me.user && me.user.email) || '';
    STATE.allowed = !!STATE.email;
    document.getElementById('drawer-email').textContent = STATE.email || '未取得';
    if (!STATE.allowed) { renderDenied(); return; }
    // マスタ取得は一覧表示には不要なのでバックグラウンドで実行（フォーム/詳細を開く時に await）
    STATE.mastersPromise = loadMasters();
    // 自分の名前は業務メニューで必要。バックグラウンドで取得しつつ、業務タブ描画時には await
    STATE.userNamePromise = resolveSelfName_();
    // 初期エントリを「list」状態として履歴にアンカー
    // （これがないと最初の戻るで認証画面まで抜けてしまう）
    replaceListState_();
    updateSearchPlaceholder_();
    render();
    refreshCounts();
    startPolling();
    // 前セッションでオフライン時に積まれた保存をバックグラウンド再送
    setTimeout(flushOutbox_, 1500);
  } catch (err) {
    toast('認証エラー: ' + err.message, 'error');
    renderDenied();
  }
});

async function refreshCounts() {
  try {
    const res = await api('/api/products/counts');
    const c = res.counts || {};
    STATE.counts = c;
    Object.keys(c).forEach(function(k){
      var el = document.getElementById('cnt-' + k);
      if (el) el.textContent = String(c[k]);
      // chips の件数バッジも更新
      document.querySelectorAll('.chip[data-filter="' + k + '"] .chip-count').forEach(function(b){
        b.textContent = String(c[k]);
      });
    });
  } catch (err) {
    // 件数失敗は致命ではないので静かにログだけ
    console.warn('counts failed', err);
  }
}

// appbar 左上のボタン: 一覧では「≡（メニュー）」、詳細では「← 戻る」に切り替える
// （詳細では右下の戻る FAB と savebar が干渉するため、戻る操作は appbar に集約する）
function setAppbarMode_(mode) {
  var btn = document.getElementById('appbar-menu-btn');
  if (!btn) return;
  // 詳細画面では検索バーを隠す（appbar の高さを 102→52 に縮め、sec-tabs の sticky 位置と一致させる）
  var search = document.getElementById('topbar-search');
  if (mode === 'back') {
    btn.textContent = '←';
    btn.setAttribute('aria-label', '戻る');
    btn.setAttribute('data-mode', 'back');
    if (search) search.hidden = true;
    document.body.classList.add('view-detail');
  } else {
    btn.textContent = '≡';
    btn.setAttribute('aria-label', 'メニュー');
    btn.setAttribute('data-mode', 'menu');
    if (search) search.hidden = false;
    document.body.classList.remove('view-detail');
  }
}
function appbarPrimaryAction_() {
  var btn = document.getElementById('appbar-menu-btn');
  if (btn && btn.getAttribute('data-mode') === 'back') {
    backToList();
  } else {
    toggleDrawer();
  }
}

// chips フィルタストリップ HTML（商品管理タブ用）
function shouhinChipsHtml_() {
  var counts = STATE.counts || {};
  var chips = [
    { f: '',                lbl: 'すべて',     ico: '📋', cntKey: 'all' },
    { f: 'sokutei_machi',   lbl: '採寸待ち',   ico: '📏', cntKey: 'sokutei_machi' },
    { f: 'satsuei_machi',   lbl: '撮影待ち',   ico: '📷', cntKey: 'satsuei_machi' },
    { f: 'shuppin_machi',   lbl: '出品待ち',   ico: '⏳', cntKey: 'shuppin_machi' },
    { f: 'shuppin_sagyou',  lbl: '出品作業中', ico: '✏️', cntKey: 'shuppin_sagyou' },
    { f: 'shuppinchu',      lbl: '出品中',     ico: '🛍️', cntKey: 'shuppinchu' }
  ];
  var html = chips.map(function(c){
    var active = (STATE.filter || '') === c.f ? ' active' : '';
    var cntHtml = c.cntKey
      ? '<span class="chip-count">' + (counts[c.cntKey] != null ? counts[c.cntKey] : '—') + '</span>'
      : '';
    return '<button type="button" class="chip' + active + '" data-filter="' + esc(c.cntKey) + '"' +
      ' onclick="selectChip_(\'' + c.f + '\',\'' + esc(c.lbl).replace(/\'/g,"\\\'") + '\')">' +
      '<span class="ico">' + c.ico + '</span>' + esc(c.lbl) + cntHtml + '</button>';
  }).join('');
  // 末尾に「表示」チップ（並び順 / 密度 切替メニュー）
  var sortLbl = SHOUHIN_SORT_LABELS[STATE.shouhinSort] || '管理番号';
  var densLbl = STATE.density === 'compact' ? 'コンパクト' : '通常';
  html += '<button type="button" class="chip chip-menu" onclick="openSortDensityMenu_(event)" title="表示設定">⋯ ' +
    esc(sortLbl) + ' / ' + esc(densLbl) + '</button>';
  return '<div class="chips" id="chips">' + html + '</div>';
}

// kanri 自然数昇順比較（zk999 < zk1002）。
// 形式: 先頭2文字プレフィクス(zk/zY等) + 数字。プレフィクス比較は昇順、数字は昇順。
// 数値化できないもの（NaN）は常に末尾。
function kanriCompareAsc_(a, b) {
  var sa = String(a || ''), sb = String(b || '');
  var pa = sa.slice(0, 2), pb = sb.slice(0, 2);
  if (pa !== pb) return pa.localeCompare(pb, 'ja');
  var na = parseInt(sa.slice(2), 10);
  var nb = parseInt(sb.slice(2), 10);
  if (isNaN(na) && isNaN(nb)) return sa.localeCompare(sb, 'ja');
  if (isNaN(na)) return 1;
  if (isNaN(nb)) return -1;
  return na - nb;
}

// 状態（ステータス）の並び順 — chips の業務順を踏襲。未知ステータスは末尾。
var STATUS_RANK = {
  '採寸待ち': 1,
  '撮影待ち': 2,
  '出品待ち': 3,
  '出品作業中': 4,
  '出品中': 5,
  '発送待ち': 6,
  '発送済み': 7
};
function statusRank_(s){ var r = STATUS_RANK[s]; return r != null ? r : 99; }

// 商品管理タブの並び替え / 密度メニュー
var SHOUHIN_SORT_LABELS = {
  kanri: '管理番号',
  shiire: '仕入れ日',
  brand: 'ブランド',
  status: '状態',
  saleDate: '販売日',
  size: 'サイズ',
  color: 'カラー'
};
var SHOUHIN_SORT_KEYS = ['kanri','shiire','brand','status','saleDate','size','color'];
function openSortDensityMenu_(ev) {
  if (ev) ev.stopPropagation();
  // 既存メニューがあれば閉じる
  var existing = document.getElementById('sort-density-menu');
  if (existing) { existing.remove(); return; }
  var btn = ev && ev.currentTarget;
  var rect = btn ? btn.getBoundingClientRect() : { top: 100, left: 16, right: window.innerWidth - 16 };
  var top = rect.bottom + 6 + window.scrollY;
  // ボタンの左端に合わせて配置。右端がはみ出ないようクランプ（モバイルで左見切れ防止）
  var POP_MIN_W = 220;
  var leftPos = Math.min(rect.left, window.innerWidth - POP_MIN_W - 8);
  leftPos = Math.max(8, leftPos);
  var sortRows = SHOUHIN_SORT_KEYS.map(function(k){
    var lbl = SHOUHIN_SORT_LABELS[k];
    var on = STATE.shouhinSort === k;
    return '<button type="button" class="menu-item' + (on ? ' on' : '') + '"' +
      ' onclick="setShouhinSort_(\'' + k + '\')">' + (on ? '● ' : '○ ') + esc(lbl) + '</button>';
  }).join('');
  var densRows = ['normal','compact'].map(function(k){
    var lbl = k === 'compact' ? 'コンパクト' : '通常';
    var on = STATE.density === k;
    return '<button type="button" class="menu-item' + (on ? ' on' : '') + '"' +
      ' onclick="setDensity_(\'' + k + '\')">' + (on ? '● ' : '○ ') + esc(lbl) + '</button>';
  }).join('');
  var html = '<div id="sort-density-menu" class="popover-menu" style="top:' + top + 'px; left:' + leftPos + 'px;">' +
    '<div class="menu-section-title">並び順</div>' + sortRows +
    '<div class="menu-section-title">密度</div>' + densRows +
  '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(function(){
    document.addEventListener('click', closeSortDensityMenu_, { once: true });
  }, 0);
}
function closeSortDensityMenu_() {
  var m = document.getElementById('sort-density-menu');
  if (m) m.remove();
}
function setShouhinSort_(key) {
  STATE.shouhinSort = key;
  try { localStorage.setItem('sk.shouhinSort', key); } catch(e) {}
  closeSortDensityMenu_();
  // チップラベルを更新するため bar を再描画 + リスト再描画
  updateChipsBar_();
  if (STATE.tab === 'shouhin' || STATE.tab === 'hassou') renderShouhinList({ silent: true });
}
function setDensity_(key) {
  STATE.density = key;
  try { localStorage.setItem('sk.density', key); } catch(e) {}
  document.body.classList.toggle('density-compact', key === 'compact');
  closeSortDensityMenu_();
  updateChipsBar_();
}

// 並び順を items に適用（in-place ソートはせず新配列を返す）
// 第二キーは常に kanri 自然数昇順（仕様: 全タブ共通で kanri 系は昇順固定）
function applyShouhinSort_(items) {
  if (!items || items.length < 2) return items;
  var key = STATE.shouhinSort || 'kanri';
  var arr = items.slice();
  if (key === 'kanri') {
    // サーバ DESC をクライアント側でも保証
    arr.sort(function(a,b){ return kanriCompareAsc_(a.kanri, b.kanri); });
  } else if (key === 'shiire') {
    // 仕入れ日 = shiireId 降順（新しい仕入れが先頭）
    arr.sort(function(a,b){
      var sa = String(a.shiireId || ''), sb = String(b.shiireId || '');
      if (sa !== sb) return sb.localeCompare(sa, 'ja');
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  } else if (key === 'brand') {
    arr.sort(function(a,b){
      var ba = String(a.brand || '〜'), bb = String(b.brand || '〜');
      if (ba !== bb) return ba.localeCompare(bb, 'ja');
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  } else if (key === 'status') {
    arr.sort(function(a,b){
      var ra = statusRank_(a.status), rb = statusRank_(b.status);
      if (ra !== rb) return ra - rb;
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  } else if (key === 'saleDate') {
    // 販売日新しい順。販売日なしは末尾
    arr.sort(function(a,b){
      var ta = a.saleDate ? new Date(a.saleDate).getTime() : -1;
      var tb = b.saleDate ? new Date(b.saleDate).getTime() : -1;
      if (ta !== tb) return tb - ta;
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  } else if (key === 'size') {
    arr.sort(function(a,b){
      var sa = String(a.size || '〜'), sb = String(b.size || '〜');
      if (sa !== sb) return sa.localeCompare(sb, 'ja');
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  } else if (key === 'color') {
    arr.sort(function(a,b){
      var ca = String(a.color || '〜'), cb = String(b.color || '〜');
      if (ca !== cb) return ca.localeCompare(cb, 'ja');
      return kanriCompareAsc_(a.kanri, b.kanri);
    });
  }
  return arr;
}
// 商品管理タブのみ chips-bar を表示
// 再描画時に横スクロール位置がリセットされないよう scrollLeft を保持＋アクティブチップを画面内に維持
function updateChipsBar_() {
  var bar = document.getElementById('chips-bar');
  if (!bar) return;
  if (STATE.view === 'detail' || STATE.tab !== 'shouhin') {
    bar.innerHTML = '';
    bar.hidden = true;
    document.body.classList.remove('has-chips');
    return;
  }
  var prevScrollLeft = bar.scrollLeft || 0;
  bar.innerHTML = shouhinChipsHtml_();
  bar.hidden = false;
  document.body.classList.add('has-chips');
  // 直前のスクロール位置を復元
  bar.scrollLeft = prevScrollLeft;
  // アクティブチップが見切れていたら可視範囲へ寄せる（左端には戻さない）
  var active = bar.querySelector('.chip.active');
  if (active) {
    var ar = active.getBoundingClientRect();
    var br = bar.getBoundingClientRect();
    if (ar.right > br.right) {
      bar.scrollLeft += (ar.right - br.right) + 12;
    } else if (ar.left < br.left) {
      bar.scrollLeft -= (br.left - ar.left) + 12;
    }
  }
}
// ========== 履歴管理（戻るボタンを SPA 内ナビゲーションに使う） ==========
// 認証画面に抜けないよう、すべてのナビゲーション操作で history.pushState する。
// popstate では event.state を見て view/tab/filter/filterLabel/kanri を復元する。
function currentListState_() {
  return {
    view: 'list',
    tab: STATE.tab,
    filter: STATE.filter,
    filterLabel: STATE.filterLabel
  };
}
function pushListState_() {
  try { history.pushState(currentListState_(), '', ''); } catch(e) {}
}
function replaceListState_() {
  try { history.replaceState(currentListState_(), '', ''); } catch(e) {}
}

function selectChip_(filter, label) {
  STATE.filter = filter;
  STATE.filterLabel = filter ? label : '';
  STATE.view = 'list';
  document.querySelectorAll('.drawer-item').forEach(function(d){
    d.classList.toggle('active', d.getAttribute('data-filter') === filter);
  });
  pushListState_();
  render();
}

// ========== ドロワー ==========
function toggleDrawer() {
  document.getElementById('drawer').classList.toggle('show');
  document.getElementById('drawer-mask').classList.toggle('show');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('show');
  document.getElementById('drawer-mask').classList.remove('show');
}
function selectMenu(filter, label) {
  confirmLeaveDetail_(function(){
    STATE.tab = 'shouhin';
    STATE.filter = filter;
    // 「すべて」(filter='') の場合は filter-chip を表示しない
    STATE.filterLabel = filter ? label : '';
    STATE.view = 'list';
    STATE.business = '';
    document.querySelectorAll('#bottomnav-inner button').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-tab') === 'shouhin');
    });
    document.querySelectorAll('.drawer-item').forEach(function(d){
      d.classList.toggle('active', d.getAttribute('data-filter') === filter);
    });
    closeDrawer();
    pushListState_();
    render();
  });
}

// 業務メニュー（仕入れ数報告/経費申請/報酬確認）。商品管理に飛ばさず専用ビューを表示する
function selectBusinessMenu(menuKey, label) {
  confirmLeaveDetail_(function(){
    STATE.tab = 'business';
    STATE.business = menuKey;
    STATE.businessLabel = label;
    STATE.view = 'list';
    STATE.filter = '';
    STATE.filterLabel = '';
    document.querySelectorAll('#bottomnav-inner button').forEach(function(b){ b.classList.remove('active'); });
    document.querySelectorAll('.drawer-item').forEach(function(d){
      d.classList.toggle('active', d.getAttribute('data-business') === menuKey);
    });
    closeDrawer();
    pushListState_();
    render();
  });
}

// ========== 検索 ==========
// topbar-search に常時表示。後方互換のため toggleSearch は残す（フォーカスのみ）
function toggleSearch() {
  var input = document.getElementById('search');
  if (input) input.focus();
}
function clearSearch_() {
  var input = document.getElementById('search');
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
}
function syncSearchClearVisibility_() {
  var wrap = document.getElementById('topbar-search');
  var input = document.getElementById('search');
  if (!wrap || !input) return;
  wrap.classList.toggle('has-value', !!(input.value || '').length);
}
var searchTimer = null;
// IME 変換中の input イベントは無視する。理由:
//  - 変換中に render() で DOM を書き換える + scrollTo() で focus が乱れると、
//    IME バッファが破壊されて確定文字が二重に入力されるバグになる（iOS Safari 等）
//  - 確定後（compositionend）に改めてタイマーをセットして検索を実行する
function scheduleSearchRender_() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function(){
    render();
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch(e) { window.scrollTo(0,0); }
  }, 250);
}
(function setupSearchInput_(){
  var el = document.getElementById('search');
  if (!el) return;
  var composing = false;
  el.addEventListener('compositionstart', function(){ composing = true; });
  el.addEventListener('compositionend', function(){
    composing = false;
    syncSearchClearVisibility_();
    scheduleSearchRender_();
  });
  el.addEventListener('input', function(e){
    syncSearchClearVisibility_();
    // composing 中（IME 変換中）は再描画しない
    if (composing || (e && e.isComposing)) return;
    scheduleSearchRender_();
  });
})();
syncSearchClearVisibility_();

// ========== ボトムタブ ==========
// 編集中の値はタブ／ナビ切替時に STATE.detailEditsByKanri に取り込み、
// 同じ商品詳細を再オープンすると detailValue が復元する。
// 破棄ダイアログは UX が悪いため使わない（feedback_no_dialog.md）。

function selectTab(tab) {
  confirmLeaveDetail_(function(){
    STATE.createProductReturnShiireId = null;
    STATE.tab = tab;
    STATE.view = 'list';
    STATE.business = '';
    // フィルタは常にリセット（ドロワーから設定する場合は selectMenu が再設定する）。
    // 旧: shouhin のときだけ保持していたが、hassou/uriage から shouhin に戻った際に
    // 前タブが強制設定したフィルタ ('hassou'/'sold') が残留して中身が変わらない不具合の原因。
    document.querySelectorAll('.drawer-item').forEach(function(d){ d.classList.remove('active'); });
    STATE.filter = ''; STATE.filterLabel = '';
    document.querySelectorAll('#bottomnav-inner button').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    updateSearchPlaceholder_();
    pushListState_();
    // ボトムタブ切替時はスクロール位置をリセット（前タブの位置が引き継がれて中途半端になる対策）
    try { window.scrollTo(0, 0); } catch(e) {}
    render();
  });
}

// タブごとに検索 placeholder を切り替える（タブ移動時 / 起動時に呼ぶ）
var SEARCH_PLACEHOLDERS = {
  shouhin: '管理番号・ブランド・状態で検索',
  hassou:  '使用アカウント・管理番号で検索',
  shiire:  '仕入れID・場所で検索',
  basho:   '管理番号・場所で検索',
  hensou:  '管理番号で検索',
  ai:      '管理番号・ブランドで検索',
  uriage:  '',
  sagyou:  '作業者名で検索',
  business:'シート内検索'
};
function updateSearchPlaceholder_() {
  var input = document.getElementById('search');
  if (!input) return;
  var ph = SEARCH_PLACEHOLDERS[STATE.tab];
  input.placeholder = (ph != null) ? ph : '検索';
}

// ========== レンダリング ==========
function render() {
  if (!STATE.allowed) { renderDenied(); return; }
  if (STATE.view === 'detail') {
    updateChipsBar_();
    renderDetail(); return;
  }
  setAppbarMode_('menu');
  document.getElementById('appbar-title').textContent = TAB_LABELS[STATE.tab] || '仕入れ管理';
  updateChipsBar_();

  if (STATE.tab === 'shouhin') {
    renderShouhinList();
  } else if (STATE.tab === 'uriage') {
    renderUriageDashboard();
  } else if (STATE.tab === 'hassou') {
    STATE.filter = 'hassou';
    STATE.filterLabel = '発送待ち・発送済み';
    renderShouhinList();
  } else if (STATE.tab === 'shiire') {
    renderShiireList();
  } else if (STATE.tab === 'basho') {
    renderBashoList();
  } else if (STATE.tab === 'hensou') {
    renderHensouList();
  } else if (STATE.tab === 'ai') {
    renderAiList();
  } else if (STATE.tab === 'sagyou') {
    renderSagyouList();
  } else if (STATE.tab === 'business') {
    document.getElementById('appbar-title').textContent = STATE.businessLabel || '業務';
    renderBusinessSheet(STATE.business);
  } else {
    renderPlaceholder(TAB_LABELS[STATE.tab]);
  }
}

async function renderShiireList(opts) {
  opts = opts || {};
  var c = document.getElementById('content');
  var cached = TAB_CACHE['shiire'];
  if (cached && cached.data) {
    paintShiireList_(cached.data);
  } else if (!opts.silent) {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    const res = await api('/api/purchases?limit=300');
    var items = res.items || [];
    TAB_CACHE['shiire'] = { data: items, ts: Date.now() };
    paintShiireList_(items);
  } catch (err) {
    if (!cached && !opts.silent) c.innerHTML = '<div class="empty" style="color:#c62828">' + esc(err.message) + '</div>';
  }
}

function paintShiireList_(allItems) {
  if (!tabCacheGuard_('shiire')) return;
  var c = document.getElementById('content');
  var items = allItems;
  var q = (document.getElementById('search').value || '').trim();
  if (q) {
    var ql = q.toLowerCase();
    items = items.filter(function(it){
      return String(it.shiireId || '').toLowerCase().includes(ql) ||
        String(it.place || '').toLowerCase().includes(ql) ||
        String(it.date || '').includes(q);
    });
  }
  var fab = '<div class="fab-stack">' +
    '<button class="fab" onclick="openCreatePurchaseModal()" title="新規仕入れ">＋</button>' +
  '</div>';
  if (!items.length) {
    c.innerHTML = '<div class="empty"><div class="empty-title">仕入れデータがありません</div>' +
      '<button class="empty-cta" onclick="openCreatePurchaseModal()">＋ 新規仕入れを作成</button></div>' + fab;
    return;
  }
  // 月別グループ化（yyyy-MM 降順、デフォルトは全て展開）
  var groups = Object.create(null);
  items.forEach(function(it){
    var ym = '';
    var d = String(it.date || '');
    // "yyyy-MM-dd" / "yyyy/MM/dd" 両対応。先頭7文字を yyyy-MM に正規化
    if (d.length >= 7) {
      var m = d.match(/^(\d{4})[-/](\d{1,2})/);
      if (m) ym = m[1] + '-' + ('0' + m[2]).slice(-2);
    }
    if (!ym) ym = '（日付なし）';
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(it);
  });
  var keys = Object.keys(groups).sort(function(a,b){
    if (a === '（日付なし）') return 1;
    if (b === '（日付なし）') return -1;
    return b.localeCompare(a); // yyyy-MM 降順
  });
  var html = keys.map(function(ym){
    var arr = groups[ym];
    var label = ym === '（日付なし）'
      ? ym
      : (ym.slice(0,4) + '年' + parseInt(ym.slice(5,7), 10) + '月');
    var summary = '<summary>📅 ' + esc(label) +
      '<span class="count">' + arr.length + '件</span></summary>';
    return '<details class="group-fold" open>' + summary +
      '<div class="cards-grid">' + arr.map(shiireCardHtml).join('') + '</div>' +
      '</details>';
  }).join('');
  c.innerHTML = html + fab;
}

function shiireCardHtml(it) {
  const planned = Number(it.planned || 0);
  const registered = Number(it.registered || 0);
  const progressLabel = planned > 0 ? (registered + '/' + planned) : String(registered);
  const progressDone = planned > 0 && registered >= planned;
  const pct = planned > 0 ? Math.min(100, Math.round((registered / planned) * 100)) : 0;
  const progClass = 'shiire-progress gradient' + (progressDone ? ' done' : '');
  return '<div class="shiire-card" onclick="openShiireDetail(\'' + esc(it.shiireId).replace(/\'/g,"\\'") + '\')">' +
    '<div class="shiire-row1">' +
      '<span class="shiire-date">' + esc(it.date || '—') + '</span>' +
      (it.place ? '<span class="shiire-place">' + esc(it.place) + '</span>' : '') +
      '<span class="' + progClass + '" style="--progress-pct: ' + pct + '%"><span>登録 ' + esc(progressLabel) + '</span></span>' +
    '</div>' +
    '<div class="shiire-row2">' +
      '<div class="shiire-cell"><span class="lbl">金額</span><span class="val">' + fmtYen(it.amount) + '</span></div>' +
      '<div class="shiire-cell"><span class="lbl">送料</span><span class="val">' + fmtYen(it.shipping) + '</span></div>' +
      '<div class="shiire-cell"><span class="lbl">商品原価</span><span class="val">' + fmtYen(it.cost) + '</span></div>' +
    '</div>' +
  '</div>';
}

function fmtYen(v) {
  if (v === '' || v === null || v === undefined) return '—';
  var n = Number(v);
  if (isNaN(n)) return esc(String(v));
  return '¥' + n.toLocaleString('ja-JP');
}

async function openShiireDetail(shiireId) {
  var c = document.getElementById('content');
  document.getElementById('appbar-title').textContent = shiireId;
  c.innerHTML = '<div class="loading">読み込み中…</div>';
  try {
    const productsRes = await api('/api/purchases/' + encodeURIComponent(shiireId) + '/products');
    const items = productsRes.items || [];
    // 仕入れメタ情報（category / planned）を取得して割り当て管理番号を表示
    var category = SHIIRE_CATEGORY_MAP[shiireId] || '';
    var planned = 0;
    if (!category) {
      try {
        const purRes = await api('/api/purchases?limit=2000');
        (purRes.items || []).forEach(function(p){
          SHIIRE_CATEGORY_MAP[p.shiireId] = p.category || '';
          if (p.shiireId === shiireId) planned = Number(p.planned || 0);
        });
        category = SHIIRE_CATEGORY_MAP[shiireId] || '';
      } catch (e) { /* ignore */ }
    } else {
      try {
        const purRes = await api('/api/purchases?limit=2000');
        (purRes.items || []).forEach(function(p){
          if (p.shiireId === shiireId) planned = Number(p.planned || 0);
        });
      } catch (e) { /* ignore */ }
    }
    var rangeHtml = '';
    if (category && planned > 0) {
      try {
        const next = await api('/api/kanri/next?category=' + encodeURIComponent(category));
        const prefix = next.prefix || ('z' + category);
        // 既に登録済の商品があれば、その最小〜最大を実績として表示。残りは予約として表示
        var registered = items.length;
        var remaining = Math.max(0, planned - registered);
        var startN = Number(next.maxN || 0) + 1;
        var endN = startN + remaining - 1;
        rangeHtml = '<div class="meta" style="background:#f0f9ff;border-left:3px solid var(--primary);padding:6px 10px;border-radius:4px;margin-top:6px;">' +
          '割り当て管理番号（残り ' + remaining + '点）: <strong>' +
          (remaining > 0 ? esc(prefix + startN) + ' 〜 ' + esc(prefix + endN) : '完了') +
          '</strong></div>';
      } catch (e) { /* ignore */ }
    }
    const head = '<div class="product-info"><h2>仕入れ ' + esc(shiireId) + '</h2>' +
      '<div class="meta">紐づく商品: ' + items.length + (planned ? ' / ' + planned : '') + ' 点</div>' +
      rangeHtml +
      '</div>';
    const body = items.length
      ? items.map(cardHtml).join('')
      : '<div class="empty">商品が登録されていません</div>';
    const fab = '<div class="fab-stack">' +
      '<button class="fab gray" onclick="selectTab(\'shiire\')" title="仕入れ一覧へ">←</button>' +
      '<button class="fab" onclick="openCreateProductModal(\'' + esc(shiireId).replace(/\'/g,"\\'") + '\')" title="新規商品">＋</button>' +
    '</div>';
    STATE.currentShiireProducts = items;
    c.innerHTML = head + body + fab;
  } catch (err) {
    c.innerHTML = '<div class="empty" style="color:#c62828">' + esc(err.message) + '</div>';
  }
}

// 商品一覧の stale-while-revalidate キャッシュ
// キー = tab|filter|q ／ 値 = { items, ts }
var LIST_CACHE = Object.create(null);

// 商品管理以外のタブ向け stale-while-revalidate キャッシュ
// キー = tab[|sub] ／ 値 = { data, ts }
// 2回目以降のタブ切替時にキャッシュを即時描画 → 裏で再取得して差分更新
var TAB_CACHE = Object.create(null);

// ── キャッシュ永続化（強制終了後の再起動でも初回読込にならないように）
// localStorage に snapshot を保持し、起動時に復元する。
// 保存タイミング: visibilitychange→hidden / pagehide（iOS PWA で確実に発火する経路）
// TTL: 7日。期限切れエントリは hydrate 時に破棄
var CACHE_PERSIST_KEYS = { tab: 'sk.tabcache.v1', list: 'sk.listcache.v1' };
var CACHE_PERSIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var CACHE_PERSIST_MAX_BYTES = 3 * 1024 * 1024; // localStorage の他用途を圧迫しない上限
(function hydrateCachesFromStorage_(){
  try {
    var raw = localStorage.getItem(CACHE_PERSIST_KEYS.tab);
    if (raw) {
      var snap = JSON.parse(raw);
      var cutoff = Date.now() - CACHE_PERSIST_TTL_MS;
      Object.keys(snap || {}).forEach(function(k){
        var v = snap[k];
        if (v && v.ts && v.ts > cutoff) TAB_CACHE[k] = v;
      });
    }
  } catch (e) { try { localStorage.removeItem(CACHE_PERSIST_KEYS.tab); } catch(_){} }
  try {
    var raw2 = localStorage.getItem(CACHE_PERSIST_KEYS.list);
    if (raw2) {
      var snap2 = JSON.parse(raw2);
      var cutoff2 = Date.now() - CACHE_PERSIST_TTL_MS;
      Object.keys(snap2 || {}).forEach(function(k){
        var v = snap2[k];
        if (v && v.ts && v.ts > cutoff2) LIST_CACHE[k] = v;
      });
    }
  } catch (e) { try { localStorage.removeItem(CACHE_PERSIST_KEYS.list); } catch(_){} }
})();
function persistTabCacheNow_(){
  try {
    var snap = {};
    Object.keys(TAB_CACHE).forEach(function(k){ snap[k] = TAB_CACHE[k]; });
    var s = JSON.stringify(snap);
    if (s.length <= CACHE_PERSIST_MAX_BYTES) {
      localStorage.setItem(CACHE_PERSIST_KEYS.tab, s);
    } else {
      localStorage.removeItem(CACHE_PERSIST_KEYS.tab);
    }
  } catch (e) { try { localStorage.removeItem(CACHE_PERSIST_KEYS.tab); } catch(_){} }
}
function persistListCacheNow_(){
  // LIST_CACHE は filter/q ごとに別キーで肥大化しがち。タブ毎に「最新1件」だけ保存。
  try {
    var byTab = {};
    Object.keys(LIST_CACHE).forEach(function(k){
      var entry = LIST_CACHE[k];
      if (!entry || !entry.ts) return;
      var tab = String(k).split('|')[0];
      if (!byTab[tab] || byTab[tab].entry.ts < entry.ts) byTab[tab] = { key: k, entry: entry };
    });
    var snap = {};
    Object.keys(byTab).forEach(function(t){ snap[byTab[t].key] = byTab[t].entry; });
    var s = JSON.stringify(snap);
    if (s.length <= CACHE_PERSIST_MAX_BYTES) {
      localStorage.setItem(CACHE_PERSIST_KEYS.list, s);
    } else {
      // 上限超過時は商品系の重い tab を 1 件ずつ落として再試行
      var entries = Object.keys(byTab).map(function(t){ return { tab: t, key: byTab[t].key, entry: byTab[t].entry }; })
        .sort(function(a,b){ return JSON.stringify(b.entry).length - JSON.stringify(a.entry).length; });
      while (entries.length) {
        entries.shift(); // 最も大きいエントリを除外
        var snap2 = {};
        entries.forEach(function(r){ snap2[r.key] = r.entry; });
        var s2 = JSON.stringify(snap2);
        if (s2.length <= CACHE_PERSIST_MAX_BYTES) {
          localStorage.setItem(CACHE_PERSIST_KEYS.list, s2);
          return;
        }
      }
      localStorage.removeItem(CACHE_PERSIST_KEYS.list);
    }
  } catch (e) { try { localStorage.removeItem(CACHE_PERSIST_KEYS.list); } catch(_){} }
}
function persistAllCachesNow_(){ persistTabCacheNow_(); persistListCacheNow_(); }
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'hidden') persistAllCachesNow_();
  else if (document.visibilityState === 'visible') flushOutbox_();
});
window.addEventListener('pagehide', persistAllCachesNow_);
window.addEventListener('online', flushOutbox_);

// ===== 保存リトライキュー (IndexedDB) =====
// 倉庫の電波ムラで API が瞬断した時、UI 上の「✗ 保存に失敗」を出さず
// IndexedDB に積んで online/visibilitychange で自動再送する。
// type: 'details' (saveDetails 失敗) | 'image' (画像アップロード失敗)
var OUTBOX_DB = 'sk-outbox';
var OUTBOX_STORE = 'queue';
var _outboxOpenP = null;
var _outboxFlushing = false;
function outboxOpen_() {
  if (_outboxOpenP) return _outboxOpenP;
  _outboxOpenP = new Promise(function(resolve, reject){
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    var req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
  return _outboxOpenP;
}
function outboxAdd_(rec) {
  return outboxOpen_().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OUTBOX_STORE, 'readwrite');
      var store = tx.objectStore(OUTBOX_STORE);
      var r = store.add(Object.assign({}, rec, { createdAt: Date.now(), attempts: 0 }));
      r.onsuccess = function(){ resolve(r.result); };
      r.onerror = function(){ reject(r.error); };
    });
  }).catch(function(e){ console.warn('[outbox] add failed', e); });
}
function outboxList_() {
  return outboxOpen_().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OUTBOX_STORE, 'readonly');
      var store = tx.objectStore(OUTBOX_STORE);
      var r = store.getAll();
      r.onsuccess = function(){ resolve(r.result || []); };
      r.onerror = function(){ reject(r.error); };
    });
  }).catch(function(){ return []; });
}
function outboxRemove_(id) {
  return outboxOpen_().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).delete(id);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  }).catch(function(){});
}
function outboxUpdate_(rec) {
  return outboxOpen_().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).put(rec);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  }).catch(function(){});
}
function flushOutbox_() {
  if (_outboxFlushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  _outboxFlushing = true;
  outboxList_().then(function(items){
    if (!items.length) { _outboxFlushing = false; return; }
    return items.reduce(function(p, rec){
      return p.then(function(){
        return retryOutboxItem_(rec);
      });
    }, Promise.resolve()).then(function(){
      _outboxFlushing = false;
    });
  }).catch(function(){ _outboxFlushing = false; });
}
function retryOutboxItem_(rec) {
  var url, body;
  if (rec.type === 'details') {
    url = '/api/save/details';
    body = JSON.stringify({ kanri: rec.kanri, fields: rec.fields });
  } else if (rec.type === 'image') {
    url = '/api/save/image';
    body = JSON.stringify({ kanri: rec.kanri, field: rec.field, dataUrl: rec.dataUrl });
  } else {
    return outboxRemove_(rec.id);
  }
  return fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: body
  }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
    .then(function(res){
      if (!res.ok || !res.body || res.body.ok === false) throw new Error('retry failed');
      // 再送成功
      try { toast('✓ オフライン中の保存を再送しました（' + (rec.kanri || '') + '）', 'success'); } catch(e){}
      LIST_CACHE = Object.create(null);
      return outboxRemove_(rec.id);
    })
    .catch(function(){
      rec.attempts = (rec.attempts || 0) + 1;
      if (rec.attempts >= 10) {
        // 諦め: ユーザー手動対応へ
        try { toast('⚠️ ' + (rec.kanri || '') + ' の再送に失敗（手動で再保存してください）', 'error'); } catch(e){}
        return outboxRemove_(rec.id);
      }
      return outboxUpdate_(rec);
    });
}
function tabCacheGuard_(tab) {
  // 描画中にユーザーが他タブへ移動していたら paint をスキップ
  return STATE.tab === tab && STATE.view === 'list';
}
function listCacheKey_() {
  var q = (document.getElementById('search') && document.getElementById('search').value || '').trim();
  return (STATE.tab || '') + '|' + (STATE.filter || '') + '|' + q;
}
// 楽観的に保存した変更を全キャッシュエントリに反映（一覧バッジを即座に更新）
function patchListCache_(kanri, fields) {
  Object.keys(LIST_CACHE).forEach(function(key){
    var entry = LIST_CACHE[key];
    if (!entry || !Array.isArray(entry.items)) return;
    entry.items.forEach(function(it){
      if (it.kanri !== kanri) return;
      if (fields['販売日']) it.saleDate = fields['販売日'];
      if (fields['販売価格']) it.salePrice = fields['販売価格'];
      if (fields['ステータス']) it.status = fields['ステータス'];
      if (fields['採寸日']) { it.measuredAt = fields['採寸日']; }
    });
  });
}

// Day 2: GAS が返す record（保存後の最新行 = 派生値含む）で、現 item を更新したコピーを返す。
// 旧実装は save 後に /api/products/:kanri を再 fetch していたが、これを置き換えて 1 往復削減。
// extra（シート全列）を上書き + 主要なトップレベルフィールド（status/salePrice/etc）も同期する。
function mergeRecordIntoItem_(item, record) {
  var base = item || {};
  var prevExtra = base.extra || {};
  // record をベースに、record に無いキーは prevExtra から残す（record は全列を含むはずだが念のため）
  var extra = Object.assign({}, prevExtra, record);
  function num(v){ var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function strOrNull(v){ return (v === '' || v === null || v === undefined) ? null : String(v); }
  return {
    kanri: base.kanri,
    shiireId: base.shiireId,
    worker: record['作業者'] || base.worker,
    status: String(record['ステータス'] || base.status || ''),
    rawStatus: String(record['ステータス'] || base.rawStatus || base.status || ''),
    state: String(record['状態'] || base.state || ''),
    brand: String(record['ブランド'] || base.brand || ''),
    size: String(record['メルカリサイズ'] || base.size || ''),
    color: String(record['カラー'] || base.color || ''),
    measure: base.measure,
    measuredAt: record['採寸日'] || base.measuredAt,
    measuredBy: record['採寸者'] || base.measuredBy,
    saleDate: strOrNull(record['販売日']) || base.saleDate,
    salePlace: strOrNull(record['販売場所']) || base.salePlace,
    salePrice: record['販売価格'] !== undefined ? num(record['販売価格']) : base.salePrice,
    saleShipping: record['送料'] !== undefined ? num(record['送料']) : base.saleShipping,
    saleFee: record['手数料'] !== undefined ? num(record['手数料']) : base.saleFee,
    saleTs: base.saleTs,
    extra: extra,
    row: base.row
  };
}

// ========== 売上ダッシュボード ==========
async function renderUriageDashboard(opts) {
  opts = opts || {};
  var c = document.getElementById('content');
  var year = (opts && opts.year) || (STATE.uriageYear || null);
  var cached = TAB_CACHE['uriage'];
  // 同じ年のキャッシュなら即描画
  var cachedYearMatch = cached && cached.data && (
    !year || Number(cached.data.monthlyYear) === Number(year)
  );
  if (cachedYearMatch) {
    paintUriageDashboard_(cached.data);
  } else if (!opts.silent) {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    var qs = year ? '?year=' + encodeURIComponent(year) : '';
    var res = await api('/api/sales/summary' + qs);
    TAB_CACHE['uriage'] = { data: res, ts: Date.now() };
    paintUriageDashboard_(res);
  } catch (err) {
    if (!cachedYearMatch && !opts.silent) {
      c.innerHTML = '<div class="empty" style="color:#c62828">' + esc(err.message || '読み込みに失敗しました') + '</div>';
    }
  }
}

// 月別グラフの年切替（HTML から呼ばれる）
// 切替で画面トップに戻らないよう scrollY を保持して再描画する
window.changeUriageYear = function(year) {
  STATE.uriageYear = Number(year);
  var prevY = window.scrollY || window.pageYOffset || 0;
  // silent:true でローディング画面に置き換えず、フェッチ完了まで現状維持 → スクロール位置キープ
  renderUriageDashboard({ year: year, silent: true }).then(function(){
    window.scrollTo({ top: prevY, behavior: 'instant' in window ? 'instant' : 'auto' });
  }).catch(function(){});
};

function paintUriageDashboard_(data) {
  if (!tabCacheGuard_('uriage')) return;
  var c = document.getElementById('content');
  if (!data) { c.innerHTML = '<div class="empty">データがありません</div>'; return; }
  try { paintUriageDashboardInner_(data, c); }
  catch (err) {
    console.error('[uriage paint]', err, data);
    c.innerHTML = '<div class="empty" style="color:#c62828">グラフ描画エラー: ' + esc(err.message || String(err)) + '</div>' +
      '<pre style="font-size:10px;overflow:auto;max-height:300px;background:#f5f5f5;padding:8px;border-radius:6px">' +
      esc(JSON.stringify({ now: data.now, monthlyYear: data.monthlyYear, availableYears: data.availableYears, monthlyLen: (data.monthly||[]).length }, null, 2)) +
      '</pre>';
  }
}

function paintUriageDashboardInner_(data, c) {
  var thisM = data.thisMonth || {};
  var lastM = data.lastMonth || {};
  var thisY = data.thisYear || {};
  var lastY = data.lastYear || {};
  var lastYTd = data.lastYearYtd || {};
  var monthly = data.monthly || [];
  var nowYear = (data.now && data.now.year) || (new Date().getFullYear());
  var nowMonth = (data.now && data.now.month) || (new Date().getMonth() + 1);
  var monthlyYear = data.monthlyYear || nowYear;
  var availableYears = Array.isArray(data.availableYears) && data.availableYears.length ? data.availableYears.slice() : [monthlyYear];
  // 防御策: API が古いキャッシュ等で今年を含まない場合でもフロントで補正
  if (availableYears.indexOf(nowYear) === -1) availableYears.unshift(nowYear);
  availableYears.sort(function(a, b){ return Number(b) - Number(a); });

  function deltaHtml(curr, prev, suffix) {
    var c1 = Number(curr || 0); var p1 = Number(prev || 0);
    // 双方ゼロ: 未集計
    if (!c1 && !p1) return '<span class="dash-delta flat">—</span>';
    // 前期間ゼロ＝比較不能。「実績なし」は good/bad の色を持たせず flat（グレー）に
    if (!p1) return '<span class="dash-delta flat">' + (suffix || '') + '実績なし</span>';
    // 当期間ゼロ＝月初〜集計中。-100% を出すと誤解を招くので「—（集計中）」へ
    if (!c1) return '<span class="dash-delta flat">—（集計中）</span>';
    var pct = ((c1 - p1) / p1) * 100;
    var sign = pct > 0 ? '+' : '';
    var cls = pct > 1 ? 'up' : (pct < -1 ? 'down' : 'flat');
    return '<span class="dash-delta ' + cls + '">' + sign + pct.toFixed(1) + '%</span>';
  }

  // 月別棒グラフの最大値
  var maxGross = monthly.reduce(function(a, m){ return Math.max(a, Number(m.gross || 0)); }, 0);
  if (maxGross <= 0) maxGross = 1;

  function periodCardHtml_(title, period, d, opts) {
    opts = opts || {};
    var cls = opts.primary ? 'dash-card primary' : 'dash-card';
    return '' +
      '<div class="' + cls + '">' +
        '<div class="dash-head">' +
          '<div class="dash-title">' + esc(title) + '</div>' +
          '<div class="dash-period">' + esc(period) + '</div>' +
        '</div>' +
        '<div class="dash-grid">' +
          '<div class="dash-cell">' +
            '<div class="dash-label">売上</div>' +
            '<div class="dash-num">' + fmtYen(d.gross) + '</div>' +
          '</div>' +
          '<div class="dash-cell">' +
            '<div class="dash-label">純売上（手数料・送料控除後）</div>' +
            '<div class="dash-num">' + fmtYen(d.net) + '</div>' +
          '</div>' +
          '<div class="dash-cell">' +
            '<div class="dash-label">件数</div>' +
            '<div class="dash-num small">' + Number(d.count || 0).toLocaleString('ja-JP') + ' 件</div>' +
          '</div>' +
          '<div class="dash-cell">' +
            '<div class="dash-label">平均単価</div>' +
            '<div class="dash-num small">' + fmtYen(d.avg) + '</div>' +
          '</div>' +
          '<div class="dash-cell">' +
            '<div class="dash-label">手数料</div>' +
            '<div class="dash-num small">' + fmtYen(d.fee) + '</div>' +
          '</div>' +
          '<div class="dash-cell">' +
            '<div class="dash-label">送料</div>' +
            '<div class="dash-num small">' + fmtYen(d.shipping) + '</div>' +
          '</div>' +
        '</div>' +
        (opts.deltasHtml ? opts.deltasHtml : '') +
      '</div>';
  }

  // 今月カード: 売上/純売上 それぞれの前月比をラベル付きで縦方向にも崩せる形で
  var thisDeltas =
    '<div class="dash-deltas">' +
      '<span class="dash-delta-item"><span class="lab">売上 前月比</span> ' + deltaHtml(thisM.gross, lastM.gross, '前月') + '</span>' +
      '<span class="dash-delta-item"><span class="lab">純売上 前月比</span> ' + deltaHtml(thisM.net, lastM.net, '前月') + '</span>' +
    '</div>';

  // 通年カード: 今年(YTD) と 前年通年 + 前年同期 の3並列
  var lyEndStr = lastYTd.ytdEnd ? (lastY.year + '/' + (lastYTd.ytdEnd || '').replace('-','/')) : '';
  var yoyHtml =
    '<div class="dash-yoy">' +
      '<div class="dash-yoy-cell">' +
        '<div class="yoy-label">' + esc(nowYear + '年（年初〜現在）') + '</div>' +
        '<div class="yoy-gross">' + fmtYen(thisY.gross) + '</div>' +
        '<div class="yoy-sub">' + Number(thisY.count||0) + '件 ／ 純 ' + fmtYen(thisY.net) + '</div>' +
      '</div>' +
      '<div class="dash-yoy-cell">' +
        '<div class="yoy-label">' + esc((nowYear - 1) + '年 通年') + '</div>' +
        '<div class="yoy-gross">' + fmtYen(lastY.gross) + '</div>' +
        '<div class="yoy-sub">' + Number(lastY.count||0) + '件 ／ 純 ' + fmtYen(lastY.net) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="dash-deltas">' +
      '<span class="dash-delta-item"><span class="lab">前年同期比（〜' + esc(lyEndStr) + '）</span> ' + deltaHtml(thisY.gross, lastYTd.gross, '前年同期') + '</span>' +
      '<span class="dash-delta-item"><span class="lab">前年同期 売上</span> <b style="font-variant-numeric:tabular-nums">' + fmtYen(lastYTd.gross) + '</b></span>' +
    '</div>';

  // 月別棒グラフ（任意の年。current 強調は monthlyYear==nowYear のときだけ）
  // 棒とラベルを同じ cell にまとめて構造的に左右ズレを防止。高さは px 直書き
  var CHART_H = (window.matchMedia && window.matchMedia('(max-width: 480px)').matches) ? 110 : 140;
  var highlightCurrent = (Number(monthlyYear) === Number(nowYear));
  var bars = monthly.map(function(m){
    var pct = (Number(m.gross || 0) / maxGross) * 100;
    var isCurrent = highlightCurrent && m.month === nowMonth;
    var isFuture = highlightCurrent && m.month > nowMonth;
    var cls = 'dash-bar-cell' + (isCurrent ? ' current' : '') + (isFuture && Number(m.gross||0) === 0 ? ' future' : '');
    var heightPx = Math.max(2, Math.round(pct * CHART_H / 100));
    var title = m.yyyymm + '：' + fmtYen(m.gross) + '（' + Number(m.count||0) + '件）';
    return '<div class="' + cls + '" title="' + esc(title) + '">' +
             '<div class="dash-bar-track"><div class="dash-bar-fill" style="height:' + heightPx + 'px"></div></div>' +
             '<div class="dash-bar-lab">' + m.month + '月</div>' +
           '</div>';
  }).join('');

  // 月別表（過去年は実績ある月のみ、当年は現在月までを表示）
  var rows = monthly.filter(function(m){
    if (highlightCurrent) return m.count > 0 || m.month <= nowMonth;
    return m.count > 0;
  }).map(function(m){
    var cls = (highlightCurrent && m.month === nowMonth) ? 'current' : '';
    return '<tr class="' + cls + '">' +
      '<td class="label">' + m.month + '月</td>' +
      '<td>' + Number(m.count||0).toLocaleString('ja-JP') + '</td>' +
      '<td>' + fmtYen(m.gross) + '</td>' +
      '<td>' + fmtYen(m.net) + '</td>' +
    '</tr>';
  }).join('');

  // 年切替ボタン
  var yearBtns = availableYears.map(function(y){
    var active = Number(y) === Number(monthlyYear);
    return '<button class="' + (active ? 'active' : '') + '" onclick="changeUriageYear(' + y + ')">' + y + '年</button>';
  }).join('');

  // 月別カードの集計サマリー（当年は YTD、過去年は通年合計）
  var monthlyTotalGross = monthly.reduce(function(a, m){ return a + Number(m.gross || 0); }, 0);
  var monthlyTotalCount = monthly.reduce(function(a, m){ return a + Number(m.count || 0); }, 0);

  c.innerHTML =
    '<div class="dash-wrap">' +
      periodCardHtml_('今月', (thisM.yyyymm || '') + '（' + nowMonth + '月）', thisM, {
        primary: true,
        deltasHtml: thisDeltas,
      }) +
      periodCardHtml_('前月', (lastM.yyyymm || ''), lastM) +
      '<div class="dash-card">' +
        '<div class="dash-head">' +
          '<div class="dash-title">通年（前年比）</div>' +
          '<div class="dash-period">' + esc(nowYear + '年 vs ' + (nowYear - 1) + '年') + '</div>' +
        '</div>' +
        yoyHtml +
      '</div>' +
      '<div class="dash-card">' +
        '<div class="dash-head">' +
          '<div class="dash-title">月別売上（' + monthlyYear + '年）</div>' +
          '<div class="dash-period">合計 ' + fmtYen(monthlyTotalGross) + ' ／ ' + monthlyTotalCount + '件</div>' +
        '</div>' +
        '<div class="dash-yearbar">' + yearBtns + '</div>' +
        '<div class="dash-bars-wrap">' + bars + '</div>' +
        '<table class="dash-month-table">' +
          '<thead><tr>' +
            '<th style="text-align:left">月</th>' +
            '<th>件数</th>' +
            '<th>売上</th>' +
            '<th>純売上</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

async function renderShouhinList(opts) {
  opts = opts || {};
  var c = document.getElementById('content');
  // 商品管理タブは chips-bar を appbar 直下に固定表示（renderShouhinList の innerHTML には含めない）
  updateChipsBar_();
  // 発送/売上タブは従来通りインライン表示
  var chip = (STATE.tab === 'shouhin')
    ? ''
    : (STATE.filterLabel ? '<div><span class="filter-chip">📂 ' + esc(STATE.filterLabel) + '</span></div>' : '');
  const q = (document.getElementById('search').value || '').trim();
  const params = new URLSearchParams();
  params.set('limit', '10000');
  // mode=list で最小フィールドだけ取得（モバイル高速化）— 詳細を開く時にフルデータを取り直す
  params.set('mode', 'list');
  if (q) params.set('q', q);
  if (STATE.filter) params.set('filter', STATE.filter);
  // 商品管理タブでは売却済み/返品済みは表示しない（chip 件数も同条件）
  if (STATE.tab === 'shouhin') params.set('noSold', '1');
  // 売上タブと発送タブには新規作成不要（既存商品を見る用途）
  const showCreateFab = STATE.tab === 'shouhin';
  const fab = showCreateFab
    ? '<div class="fab-stack"><button class="fab" onclick="openCreateProductModal(null)" title="新規商品">＋</button></div>'
    : '';

  // キャッシュがあれば即時表示（裏で再取得して差分更新）
  var cacheKey = listCacheKey_();
  var cached = LIST_CACHE[cacheKey];
  function paint(items){
    // 商品管理タブのみ並び替え設定を適用（発送タブはグルーピング側で並びを決める）
    var sorted = (STATE.tab === 'shouhin') ? applyShouhinSort_(items) : items;
    STATE.items = sorted;
    // 商品管理タブで件数が多い & mobile 幅 のときは仮想スクロールを使う
    // （5000+ 件を全描画すると iPhone で「追いかけ表示」が発生するため）
    var useVlist = STATE.tab === 'shouhin' &&
                   sorted.length > 100 &&
                   (window.innerWidth || 0) < 900;
    // 既存の vlist は新描画前に必ず解除（スクロールリスナー残留防止）
    vlistDeactivate_();
    var body;
    if (!sorted.length) {
      body = '<div class="empty">該当する商品がありません</div>';
    } else if (STATE.tab === 'hassou') {
      // 発送商品は使用アカウント別にグループ化（発送待ち→発送済みの順、期限が近い順）
      body = renderHassouGrouped_(sorted);
    } else if (useVlist) {
      // 空の cards-grid を作って vlistMount で埋める
      body = '<div class="cards-grid"></div>';
    } else {
      // PCグリッド対応: cards-grid でラップ → CSS で auto-fill
      body = '<div class="cards-grid">' + sorted.map(cardHtml).join('') + '</div>';
    }
    c.innerHTML = chip + body + fab;
    if (useVlist) {
      vlistMount_(sorted, cardHtml, resolveCardThumbsTasukibako_);
    } else if (STATE.tab === 'hassou' || STATE.tab === 'shouhin') {
      resolveCardThumbsTasukibako_();
    }
  }
  if (cached) {
    paint(cached.items);
  } else if (!opts.silent) {
    c.innerHTML = chip + '<div class="loading">読み込み中…</div>';
  }

  try {
    const res = await api('/api/products?' + params.toString());
    var items = res.items || [];
    LIST_CACHE[cacheKey] = { items: items, ts: Date.now() };
    paint(items);
  } catch (err) {
    if (!cached && !opts.silent) c.innerHTML = chip + '<div class="empty" style="color:#c62828">' + esc(err.message) + '</div>' + fab;
  }
}

// 発送期限 = 販売日 + SHIP_DEADLINE_DAYS（AppSheet 同様の運用）
var SHIP_DEADLINE_DAYS = 3;
function shipDeadlineHtml_(it) {
  if (it.status !== '発送待ち') return '';
  if (!it.saleDate) return '';
  var sd = new Date(it.saleDate);
  if (isNaN(sd.getTime())) return '';
  var due = new Date(sd.getTime() + SHIP_DEADLINE_DAYS * 86400000);
  var dueStr = due.getFullYear() + '-' + String(due.getMonth()+1).padStart(2,'0') + '-' + String(due.getDate()).padStart(2,'0');
  var today = new Date(); today.setHours(0,0,0,0);
  var overdue = due.getTime() < today.getTime();
  var diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  var label;
  if (overdue) label = '期限超過 ' + dueStr + '（' + Math.abs(diffDays) + '日経過）';
  else if (diffDays === 0) label = '本日が期限 ' + dueStr;
  else label = '発送期限 ' + dueStr + '（あと' + diffDays + '日）';
  var cls = overdue ? ' overdue' : (diffDays === 0 ? ' today' : '');
  return '<div class="card-deadline' + cls + '">⏰ ' + esc(label) + '</div>';
}

// 画像フィールドの表示＋アップロード UI
// v が http(s) URL: そのままプレビュー
// v が AppSheet 旧形式の相対パス（"商品管理_Images/..."）: data-legacy で残し、resolveLegacyImages_ が後で解決
// v が空: 画像なし表示
function imageFieldHtml_(id, name, v) {
  var s = String(v || '');
  var isUrl = /^https?:/.test(s);
  var isLegacy = !isUrl && s.length > 0;
  var safeName = esc(name).replace(/\'/g,"\\'");
  var preview;
  if (isUrl) {
    s = normalizeDriveUrl_(s);
    var safeUrl = esc(s).replace(/\'/g,"\\'");
    preview = '<button type="button" id="' + id + '_preview" class="img-preview" onclick="openImageModal_(\'' + safeUrl + '\')"><img src="' + esc(s) + '" alt=""></button>';
  } else if (isLegacy) {
    preview = '<div id="' + id + '_preview" class="img-preview img-loading" data-legacy="' + esc(s) + '" data-field="' + safeName + '">読み込み中…</div>';
  } else {
    preview = '<div id="' + id + '_preview" class="img-preview">画像なし</div>';
  }
  var picker =
    '<label class="img-upload-btn ghost" for="' + id + '_file">📷 撮影／差替え</label>' +
    '<input type="file" id="' + id + '_file" accept="image/*" capture="environment" ' +
    'onchange="onImageFieldPick_(this, \'' + esc(id) + '\', \'' + safeName + '\')" ' +
    'style="display:none">' +
    '<button type="button" class="img-upload-btn ghost" ' +
    'onclick="onImageFieldPaste_(\'' + esc(id) + '\', \'' + safeName + '\')">📋 貼り付け</button>' +
    '<div class="img-hint">最大1600px・JPG（スクショは Cmd+V でも貼付可）</div>' +
    '<div id="' + id + '_status" class="img-status"></div>';
  // 画像が登録されている（URL or 旧形式パス）ときだけ削除 ✕ ボタンを出す
  var deleteBtn = (isUrl || isLegacy)
    ? '<button type="button" class="img-delete-btn" ' +
      'onclick="onImageFieldDelete_(\'' + esc(id) + '\', \'' + safeName + '\')" ' +
      'title="画像を削除">✕</button>'
    : '';
  // data-field-id/data-field-name を付けて、フィールド全体を paste イベント受信ターゲットにする
  // tabindex=0 で「クリックでフォーカス→Cmd+V」も可能
  return '<div class="img-field" tabindex="0" data-img-field-id="' + esc(id) + '" data-img-field-name="' + safeName + '" ' +
    'onpaste="onImageFieldPasteEvent_(event, \'' + esc(id) + '\', \'' + safeName + '\')">' +
    '<div class="img-preview-wrap">' + preview + deleteBtn + '</div>' +
    '<div class="img-actions">' + picker + '</div></div>';
}

// 画像ファイル選択時のエントリ（input[type=file] からの呼び出し）
function onImageFieldPick_(inputEl, fieldId, fieldName) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  onImageFieldFile_(file, fieldId, fieldName);
}

// クリップボード貼り付けボタン: navigator.clipboard.read() で画像Blobを取得
async function onImageFieldPaste_(fieldId, fieldName) {
  var status = document.getElementById(fieldId + '_status');
  if (!navigator.clipboard || !navigator.clipboard.read) {
    if (status) { status.textContent = 'このブラウザは貼り付けに非対応'; status.className = 'img-status error'; }
    return;
  }
  try {
    var items = await navigator.clipboard.read();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var imgType = (item.types || []).find(function(t){ return t.indexOf('image/') === 0; });
      if (imgType) {
        var blob = await item.getType(imgType);
        var ext = imgType.split('/')[1] || 'png';
        var file = new File([blob], 'pasted-' + Date.now() + '.' + ext, { type: imgType });
        onImageFieldFile_(file, fieldId, fieldName);
        return;
      }
    }
    if (status) { status.textContent = 'クリップボードに画像なし（先にスクショをコピー）'; status.className = 'img-status error'; }
  } catch(e) {
    if (status) { status.textContent = '貼付エラー: ' + (e && e.message || e); status.className = 'img-status error'; }
  }
}

// 画像削除ボタンの二段階タップ管理（fieldId → タイマーID）
// confirm() は使わず、1回目タップでボタンが「もう一度」表示に変化、3秒以内に2回目タップで実削除
var IMG_DELETE_ARMED_ = {};
function onImageFieldDelete_(fieldId, fieldName) {
  var status = document.getElementById(fieldId + '_status');
  var kanri = (STATE.current && STATE.current.kanri) || '';
  if (!kanri) {
    if (status) { status.textContent = '管理番号がありません'; status.className = 'img-status error'; }
    return;
  }
  var btn = document.querySelector('.img-field[data-img-field-id="' + fieldId + '"] .img-delete-btn');
  if (!btn) return;
  // 二段階タップ: 1回目は arm、3秒以内の2回目で実削除
  if (!IMG_DELETE_ARMED_[fieldId]) {
    btn.classList.add('armed');
    btn.textContent = '？';
    btn.title = 'もう一度タップで削除';
    if (status) { status.textContent = 'もう一度タップで削除（3秒）'; status.className = 'img-status'; }
    IMG_DELETE_ARMED_[fieldId] = setTimeout(function(){
      delete IMG_DELETE_ARMED_[fieldId];
      btn.classList.remove('armed');
      btn.textContent = '✕';
      btn.title = '画像を削除';
      if (status && status.textContent === 'もう一度タップで削除（3秒）') {
        status.textContent = '';
      }
    }, 3000);
    return;
  }
  // 2回目タップ: タイマー解除して実削除
  clearTimeout(IMG_DELETE_ARMED_[fieldId]);
  delete IMG_DELETE_ARMED_[fieldId];
  if (status) { status.textContent = '⏳ 削除中…'; status.className = 'img-status'; }
  var fields = {};
  fields[fieldName] = '';
  fetch('/api/save/details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanri: kanri, fields: fields })
  }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
  .then(function(res){
    if (!res.ok || !res.body || res.body.ok === false) throw new Error((res.body && res.body.error) || '削除失敗');
    // プレビューを「画像なし」に差し替え + ✕ ボタン除去
    var wrap = document.querySelector('.img-field[data-img-field-id="' + fieldId + '"] .img-preview-wrap');
    if (wrap) {
      wrap.innerHTML = '<div id="' + fieldId + '_preview" class="img-preview">画像なし</div>';
    }
    if (STATE.current && STATE.current.extra) STATE.current.extra[fieldName] = '';
    LIST_CACHE = {};
    if (status) { status.textContent = '✓ 削除完了'; status.className = 'img-status success'; }
  }).catch(function(err){
    if (status) { status.textContent = '✗ ' + (err && err.message || 'エラー'); status.className = 'img-status error'; }
  });
}

// onpaste イベント（フィールドへのフォーカス中に Cmd+V）
function onImageFieldPasteEvent_(ev, fieldId, fieldName) {
  var cd = ev && ev.clipboardData;
  if (!cd || !cd.items) return;
  for (var i = 0; i < cd.items.length; i++) {
    var it = cd.items[i];
    if (it.kind === 'file' && it.type.indexOf('image/') === 0) {
      var file = it.getAsFile();
      if (file) {
        ev.preventDefault();
        onImageFieldFile_(file, fieldId, fieldName);
        return;
      }
    }
  }
}

// 画像 File を受け取ってアップロード（楽観的: 即時にローカルプレビュー → バックグラウンドでアップロード）
// 1) URL.createObjectURL で即座に <img> 差し替え（待ち時間ゼロ体験）
// 2) リサイズ→base64→POST はバックグラウンド
// 3) アップロード成功後、Drive 画像URL（thumbnail）に差し替え。失敗時はローカル画像を残してエラー表示
function onImageFieldFile_(file, fieldId, fieldName) {
  var status = document.getElementById(fieldId + '_status');
  var preview = document.getElementById(fieldId + '_preview');
  var kanri = (STATE.current && STATE.current.kanri) || '';
  if (!kanri) {
    if (status) { status.textContent = '管理番号がありません'; status.className = 'img-status error'; }
    return;
  }

  // ① 即時プレビュー（楽観的）
  var localUrl = '';
  try { localUrl = URL.createObjectURL(file); } catch(e) {}
  if (preview && localUrl) {
    var safeLocal = esc(localUrl).replace(/\'/g,"\\'");
    var html = '<button type="button" id="' + esc(fieldId) + '_preview" class="img-preview" onclick="openImageModal_(\'' + safeLocal + '\')"><img src="' + esc(localUrl) + '" alt=""></button>';
    preview.outerHTML = html;
  }
  if (status) { status.textContent = '⏳ アップロード中…（操作続行可）'; status.className = 'img-status'; }

  // ② バックグラウンドでリサイズ＋アップロード（UI は応答性維持）
  resizeImage_(file, 1600, 0.85).then(function(dataUrl){
    return fetch('/api/save/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanri: kanri, field: fieldName, dataUrl: dataUrl })
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); });
  }).then(function(res){
    if (!res.ok || !res.body) throw new Error((res.body && res.body.error) || 'アップロード失敗');
    var url = res.body.url || '';
    var path = res.body.path || '';
    // ③ Drive 画像URLに差し替え（thumbnail 正規化）。Drive 共有伝播の遅延に備えて localUrl は維持
    var displayUrl = url ? normalizeDriveUrl_(url) : (localUrl || '');
    var newPreview = document.getElementById(fieldId + '_preview');
    if (newPreview && displayUrl) {
      var safeDisp = esc(displayUrl).replace(/\'/g,"\\'");
      var html = '<button type="button" id="' + esc(fieldId) + '_preview" class="img-preview" onclick="openImageModal_(\'' + safeDisp + '\')"><img src="' + esc(displayUrl) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(localUrl || '').replace(/\'/g,"\\'") + '\'"></button>';
      newPreview.outerHTML = html;
    }
    if (status) {
      var s2 = document.getElementById(fieldId + '_status');
      if (s2) { s2.textContent = '✓ 保存完了'; s2.className = 'img-status success'; }
    }
    // STATE 更新: シートには相対パスが入るため、extra にも path を入れる（次回詳細表示と整合）
    if (STATE.current && STATE.current.extra) STATE.current.extra[fieldName] = path || url;
    LIST_CACHE = {};
  }).catch(function(err){
    // 電波切れ等は IndexedDB キューに退避＋ローカルプレビューは残す → online 復帰時に自動再送
    var isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                    /Failed to fetch|NetworkError|TypeError/i.test(String(err && err.message || ''));
    if (isOffline) {
      // dataUrl が必要なので resize し直し（catch 内では失われている可能性あり）
      resizeImage_(file, 1600, 0.85).then(function(dataUrl){
        return outboxAdd_({ type: 'image', kanri: kanri, field: fieldName, dataUrl: dataUrl });
      });
      var s4 = document.getElementById(fieldId + '_status');
      if (s4) { s4.textContent = '📥 オフラインで保存待機中（自動再送）'; s4.className = 'img-status'; }
      return;
    }
    var s3 = document.getElementById(fieldId + '_status');
    if (s3) { s3.textContent = '✗ ' + (err && err.message || 'エラー') + '（再撮影してください）'; s3.className = 'img-status error'; }
  });
}

// Drive の uc?id=... は <img> から直接表示できないため thumbnail?id=&sz=wXXX に正規化
// size 省略時は w800（詳細）。一覧サムネは w200 を明示指定して 5000件×800→200 で帯域 1/16
function normalizeDriveUrl_(url, size) {
  if (!url) return url;
  var sz = size || 800;
  var m = url.match(/^https?:\/\/drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w' + sz;
  var m2 = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w' + sz;
  // 既に thumbnail URL の場合は sz パラメータを書き換え
  if (/^https?:\/\/drive\.google\.com\/thumbnail/.test(url) && size) {
    return url.replace(/([?&])sz=w\d+/, '$1sz=w' + sz);
  }
  return url;
}

// 詳細描画後に呼び出し: 旧形式パスの画像を遅延解決して img に差し替え
function resolveLegacyImages_() {
  // .img-preview / .basic-img どちらも対象
  var nodes = document.querySelectorAll('.img-loading[data-legacy]');
  if (!nodes || !nodes.length) return;
  var kanri = (STATE.current && STATE.current.kanri) || '';
  for (var i = 0; i < nodes.length; i++) {
    (function(el){
      var path = el.getAttribute('data-legacy') || '';
      var field = el.getAttribute('data-field') || '';
      var cacheKey = 'imgresolve:v2:' + path;
      var cached = null;
      try { cached = sessionStorage.getItem(cacheKey); } catch(e) {}
      if (cached) { applyResolved_(el, normalizeDriveUrl_(cached)); return; }
      fetch('/api/image/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanri: kanri, field: field, path: path })
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || !res.body.url) throw new Error((res.body && res.body.error) || '解決失敗');
        var u = normalizeDriveUrl_(res.body.url);
        try { sessionStorage.setItem(cacheKey, u); } catch(e) {}
        applyResolved_(el, u);
      }).catch(function(err){
        el.classList.remove('img-loading');
        el.classList.add('img-error');
        el.textContent = '画像読込失敗';
      });
    })(nodes[i]);
  }
}

function applyResolved_(el, url) {
  var id = el.id || '';
  var safeUrl = esc(url).replace(/\'/g,"\\'");
  // 元の class（basic-img / img-preview など）を保持。img-loading だけ除去
  var cls = (el.className || '').replace(/\bimg-loading\b/g, '').replace(/\s+/g, ' ').trim();
  if (!cls) cls = 'img-preview';
  var html = '<button type="button" id="' + esc(id) + '" class="' + esc(cls) + '" onclick="openImageModal_(\'' + safeUrl + '\')"><img src="' + esc(url) + '" alt=""></button>';
  el.outerHTML = html;
}

// Canvas で画像を縮小して dataURL を返す（最大辺 maxSide）
function resizeImage_(file, maxSide, quality) {
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error('ファイル読込エラー')); };
    reader.onload = function(){
      var img = new Image();
      img.onerror = function(){ reject(new Error('画像のデコードに失敗')); };
      img.onload = function(){
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err) { reject(err); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function cardHtml(it) {
  const measured = !!(it.measuredAt && String(it.measuredAt).trim());
  // 発送タブでは raw ステータス（発送待ち/発送済み）を優先表示。
  // 派生ステータスは「撮影日付のみ入力」等で '採寸待ち' 等にフォールバックすることがあり、
  // 発送タブで表示すると意味不明な状態になるため、raw を優先する。
  const st = (STATE.tab === 'hassou')
    ? (it.rawStatus || it.status || '')
    : (it.status || '');
  let badgeClass = '';
  if (st === '売却済み') badgeClass = ' sold';
  else if (st === '発送済み') badgeClass = ' shipped';
  else if (st === '発送待ち') badgeClass = ' shipping-pending';
  else if (measured) badgeClass = ' measured';
  const badgeText = st || (measured ? '採寸済' : '未採寸');
  const statusBadge = '<span class="card-status' + badgeClass + '">' + esc(badgeText) + '</span>';
  // ステータスでの左ボーダー色分け（s-overdue: 期限超過, s-shukka: 発送待ち, s-sokutei: 未採寸, s-sold: 売却済）
  let cardClass = 'card';
  if (st === '発送待ち') {
    cardClass += ' s-shukka';
    if (it.saleDate) {
      const sd = new Date(it.saleDate);
      if (!isNaN(sd.getTime())) {
        const due = new Date(sd.getTime() + (typeof SHIP_DEADLINE_DAYS === 'number' ? SHIP_DEADLINE_DAYS : 3) * 86400000);
        const today0 = new Date(); today0.setHours(0,0,0,0);
        if (due.getTime() < today0.getTime() || due.toDateString() === today0.toDateString()) {
          cardClass += ' s-overdue';
        }
      }
    }
  } else if (st === '売却済み' || st === '発送済み') {
    cardClass += ' s-sold';
  } else if (!measured) {
    cardClass += ' s-sokutei';
  }
  // サムネはタスキ箱トップ画像を優先。sessionStorage に解決済 URL があればインラインで <img> を出して
  // 再描画時のチラつき（プレースホルダ→解決後 img の二段描画）を避ける。
  // 未解決のものだけ 📷 プレースホルダ + 描画後 resolveCardThumbsTasukibako_() で一括 fetch。
  var thumbHtml = '';
  if (STATE.tab === 'hassou' || STATE.tab === 'shouhin') {
    var ck = 'tbthumb:v1:' + it.kanri;
    var cached = null;
    try { cached = sessionStorage.getItem(ck); } catch(e) {}
    if (cached && cached !== '__none__') {
      var url = normalizeDriveUrl_(cached, 200);
      thumbHtml = '<div class="card-thumb"><img src="' + esc(url) + '" alt="" loading="lazy" decoding="async"></div>';
    } else {
      // 未解決 or 画像なし。__none__ もプレースホルダ枠を出し続ける（レイアウト一貫性のため）
      thumbHtml = '<div class="card-thumb img-tasukibako" data-kanri="' + esc(it.kanri) + '">📷</div>';
    }
  }
  var openHandler = 'openDetail(\'' + esc(it.kanri).replace(/\'/g,"\\'") + '\')';
  // 出品作業中タブでは使用アカウントをカードに表示（誰のアカウントで作業中か即時把握）
  var accountHtml = '';
  if (STATE.filter === 'shuppin_sagyou') {
    var accVal = (it.extra && it.extra['使用アカウント']) ? String(it.extra['使用アカウント']).trim() : '';
    accountHtml = '<div class="card-account">👤 ' + esc(accVal || '（未設定）') + '</div>';
  }
  var bodyHtml = '<div class="card-body">' +
    '<div class="card-row1">' +
      '<span class="card-kanri">' + esc(it.kanri) + '</span>' +
      statusBadge +
    '</div>' +
    '<div class="card-row2">' +
      '<span class="card-brand">' + esc(it.brand || '—') + '</span>' +
      ' / ' + esc(it.size || '—') +
      (it.color ? ' / ' + esc(it.color) : '') +
    '</div>' +
    accountHtml +
    shipDeadlineHtml_(it) +
    progressPillsHtml_(it) +
  '</div>';
  return '<div class="' + cardClass + (thumbHtml ? ' has-thumb' : '') + '" onclick="' + openHandler + '">' +
    thumbHtml + bodyHtml +
  '</div>';
}

// 工程進捗ピル（📏 採寸 / 📷 撮影 / 🛍️ 出品）。派生ステータスから完了状況を逆算。
// 発送・売却済み のカードでは出品以降の工程に意味がないので非表示。
function progressPillsHtml_(it) {
  var st = it.status || '';
  if (st === '発送待ち' || st === '発送済み' || st === '売却済み') return '';
  // 採寸: 採寸待ち以外なら採寸完了
  // 撮影: 採寸待ち / 撮影待ち 以外なら撮影完了
  // 出品: 出品中 以降が出品完了
  var saiDone = (st !== '採寸待ち');
  var satDone = (st !== '採寸待ち' && st !== '撮影待ち');
  var shuDone = (st === '出品中');
  function pill(ico, label, done) {
    return '<span class="card-pill' + (done ? ' done' : '') + '">' +
      '<span class="ico">' + ico + '</span>' + label + (done ? ' ✓' : '') + '</span>';
  }
  return '<div class="card-pills">' +
    pill('📏', '採寸', saiDone) +
    pill('📷', '撮影', satDone) +
    pill('🛍️', '出品', shuDone) +
  '</div>';
}

// 一覧描画後に呼ぶ: 発送タブのカードサムネを遅延解決して画像に差し替える
function resolveCardImages_() {
  var nodes = document.querySelectorAll('.card-thumb.img-loading[data-legacy]');
  if (!nodes || !nodes.length) return;
  Array.prototype.forEach.call(nodes, function(el){
    var path = el.getAttribute('data-legacy') || '';
    var field = el.getAttribute('data-field') || '';
    var kanri = el.getAttribute('data-kanri') || '';
    if (!path) return;
    var cacheKey = 'imgresolve:v2:' + path;
    var cached = null;
    try { cached = sessionStorage.getItem(cacheKey); } catch(e) {}
    if (cached) { applyCardThumb_(el, normalizeDriveUrl_(cached, 200)); return; }
    fetch('/api/image/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanri: kanri, field: field, path: path })
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || !res.body.url) throw new Error('resolve failed');
        var u = normalizeDriveUrl_(res.body.url, 200);
        try { sessionStorage.setItem(cacheKey, res.body.url); } catch(e) {}
        applyCardThumb_(el, u);
      }).catch(function(){
        el.classList.remove('img-loading');
      });
  });
}

function applyCardThumb_(el, url) {
  el.classList.remove('img-loading');
  el.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async">';
}

// ===== 仮想スクロール（mobile 専用） =====
// 5000+ 件のカードを全部 DOM に置くと iPhone Safari でスクロール中に
// content-visibility による「追いかけ表示」が起きて見づらいため、
// 表示範囲（+ buffer）だけ DOM にマウントする方式に切替える。
// PC（≥900px）ではグリッド表示なので対象外（content-visibility に任せる）。
var VLIST = {
  active: false,
  items: [],
  container: null,
  topSpacer: null,
  windowEl: null,
  bottomSpacer: null,
  itemHeight: 110,   // 初期値。マウント直後に実測して補正
  buffer: 6,         // 上下バッファ枚数
  startIdx: 0,
  endIdx: 0,
  rafScheduled: false,
  cardHtmlFn: null,
  onAfter: null
};

function vlistDeactivate_() {
  if (VLIST.active) {
    window.removeEventListener('scroll', vlistOnScroll_);
    VLIST.active = false;
  }
  VLIST.items = [];
  VLIST.container = null;
  VLIST.topSpacer = null;
  VLIST.windowEl = null;
  VLIST.bottomSpacer = null;
  VLIST.cardHtmlFn = null;
  VLIST.onAfter = null;
  VLIST.startIdx = 0;
  VLIST.endIdx = 0;
}

function vlistMount_(items, cardHtmlFn, onAfter) {
  vlistDeactivate_();
  var container = document.querySelector('#content .cards-grid');
  if (!container) return;
  VLIST.items = items;
  VLIST.cardHtmlFn = cardHtmlFn;
  VLIST.onAfter = onAfter || null;
  VLIST.container = container;
  container.innerHTML =
    '<div class="vlist-top-spacer"></div>' +
    '<div class="vlist-window"></div>' +
    '<div class="vlist-bottom-spacer"></div>';
  VLIST.topSpacer = container.querySelector('.vlist-top-spacer');
  VLIST.windowEl = container.querySelector('.vlist-window');
  VLIST.bottomSpacer = container.querySelector('.vlist-bottom-spacer');
  VLIST.active = true;
  window.addEventListener('scroll', vlistOnScroll_, { passive: true });
  vlistRender_(true);
  // 1 枚目の高さを実測して itemHeight を補正（密度設定や端末で変わる）
  setTimeout(function(){
    if (!VLIST.active || !VLIST.windowEl) return;
    var first = VLIST.windowEl.firstElementChild;
    if (first) {
      var h = first.getBoundingClientRect().height;
      if (h && h > 0) {
        var corrected = Math.round(h + 8); // margin-bottom 込み
        if (Math.abs(corrected - VLIST.itemHeight) > 4) {
          VLIST.itemHeight = corrected;
          vlistRender_(true);
        }
      }
    }
  }, 50);
}

function vlistOnScroll_() {
  if (!VLIST.active) return;
  if (VLIST.rafScheduled) return;
  VLIST.rafScheduled = true;
  requestAnimationFrame(function(){
    VLIST.rafScheduled = false;
    vlistRender_(false);
  });
}

function vlistRender_(force) {
  if (!VLIST.active || !VLIST.container) return;
  // 親 DOM が差し替わった（タブ切替等）ら自動でクリーンアップ
  if (!document.body.contains(VLIST.container)) {
    vlistDeactivate_();
    return;
  }
  // .cards-grid は display:contents で rect が 0 になるため、
  // topSpacer（block 要素）の位置からリスト先頭の y 座標を取る。
  // topSpacer.top はスペーサの高さに関わらず常に「リスト先頭の y」を指す。
  var spacerRect = VLIST.topSpacer.getBoundingClientRect();
  var viewportH = window.innerHeight || document.documentElement.clientHeight;
  var visibleStart = Math.max(0, -spacerRect.top);
  var visibleEnd = visibleStart + viewportH;
  var ih = VLIST.itemHeight;
  var n = VLIST.items.length;
  var startIdx = Math.max(0, Math.floor(visibleStart / ih) - VLIST.buffer);
  var endIdx = Math.min(n, Math.ceil(visibleEnd / ih) + VLIST.buffer);
  if (!force && startIdx === VLIST.startIdx && endIdx === VLIST.endIdx) return;
  VLIST.startIdx = startIdx;
  VLIST.endIdx = endIdx;
  VLIST.topSpacer.style.height = (startIdx * ih) + 'px';
  VLIST.bottomSpacer.style.height = ((n - endIdx) * ih) + 'px';
  var html = '';
  for (var i = startIdx; i < endIdx; i++) {
    html += VLIST.cardHtmlFn(VLIST.items[i]);
  }
  VLIST.windowEl.innerHTML = html;
  if (VLIST.onAfter) VLIST.onAfter();
}

// 一覧描画後に呼ぶ: タスキ箱（gas-proxy KV: product-images:<kanri>）から各カードのトップ画像を一括解決して差し替える。
// セッションキャッシュで再描画コスト削減。画像なしのカードは 📷 のまま。
function resolveCardThumbsTasukibako_() {
  var nodes = document.querySelectorAll('.card-thumb.img-tasukibako[data-kanri]');
  if (!nodes || !nodes.length) return;
  var pendingKanris = [];
  var pendingMap = {};
  Array.prototype.forEach.call(nodes, function(el){
    var k = el.getAttribute('data-kanri') || '';
    if (!k) return;
    var ck = 'tbthumb:v1:' + k;
    var cached = null;
    try { cached = sessionStorage.getItem(ck); } catch(e) {}
    if (cached === '__none__') return; // 画像なしと既知 → 何もしない
    if (cached) {
      el.classList.remove('img-tasukibako');
      el.innerHTML = '<img src="' + esc(normalizeDriveUrl_(cached, 200)) + '" alt="" loading="lazy" decoding="async">';
      return;
    }
    if (!pendingMap[k]) {
      pendingMap[k] = true;
      pendingKanris.push(k);
    }
  });
  if (pendingKanris.length === 0) return;
  // バッチサイズ200で分割
  var BATCH = 200;
  for (var i = 0; i < pendingKanris.length; i += BATCH) {
    (function(slice){
      fetch('/api/products/thumbs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanris: slice })
      }).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(res){
          var items = (res && res.items) || {};
          slice.forEach(function(k){
            var ck = 'tbthumb:v1:' + k;
            var url = items[k];
            if (url) {
              try { sessionStorage.setItem(ck, url); } catch(e) {}
              var smallUrl = normalizeDriveUrl_(url, 200);
              document.querySelectorAll('.card-thumb.img-tasukibako[data-kanri="' + k.replace(/"/g,'\\"') + '"]').forEach(function(el){
                el.classList.remove('img-tasukibako');
                el.innerHTML = '<img src="' + esc(smallUrl) + '" alt="" loading="lazy" decoding="async">';
              });
            } else {
              // 画像なしを記憶（次回以降の無駄打ち防止）
              try { sessionStorage.setItem(ck, '__none__'); } catch(e) {}
            }
          });
        }).catch(function(){ /* 静かに失敗（📷 のまま） */ });
    })(pendingKanris.slice(i, i + BATCH));
  }
}

// 発送商品タブの表示切替（発送待ち / 発送済み）
function setHassouFilter_(key) {
  if (key !== 'pending' && key !== 'shipped') return;
  if (STATE.hassouFilter === key) return;
  STATE.hassouFilter = key;
  try { localStorage.setItem('sk.hassouFilter', key); } catch(e) {}
  if (STATE.tab === 'hassou') renderShouhinList({ silent: true });
}

function renderHassouGrouped_(items) {
  var filterKey = STATE.hassouFilter === 'shipped' ? 'shipped' : 'pending';
  var targetStatus = filterKey === 'shipped' ? '発送済み' : '発送待ち';
  // チップに件数を出すため、フィルタ前に両者をカウント
  var countPending = 0, countShipped = 0;
  items.forEach(function(it){
    if (it.status === '発送待ち') countPending++;
    else if (it.status === '発送済み') countShipped++;
  });
  var filtered = items.filter(function(it){ return it.status === targetStatus; });
  // 使用アカウントごとにグループ化
  var groups = Object.create(null);
  filtered.forEach(function(it){
    var acc = (it.extra && it.extra['使用アカウント']) || '（未設定）';
    if (!groups[acc]) groups[acc] = [];
    groups[acc].push(it);
  });
  var accounts = Object.keys(groups).sort(function(a,b){
    if (a === '（未設定）') return 1;
    if (b === '（未設定）') return -1;
    return a.localeCompare(b, 'ja');
  });
  // 並び順は固定: 販売日が古い順（=期限が近い順）→ 管理番号昇順
  function cmp(a, b) {
    var sa = a.saleDate ? new Date(a.saleDate).getTime() : Number.MAX_SAFE_INTEGER;
    var sb = b.saleDate ? new Date(b.saleDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return kanriCompareAsc_(a.kanri, b.kanri);
  }
  // タブヘッダ: 発送待ち / 発送済み トグル
  var header = '<div class="tab-toolbar">' +
    '<button type="button" class="chip' + (filterKey === 'pending' ? ' active' : '') + '"' +
    ' onclick="setHassouFilter_(\'pending\')">発送待ち' +
    '<span class="chip-count">' + countPending + '</span></button>' +
    '<button type="button" class="chip' + (filterKey === 'shipped' ? ' active' : '') + '"' +
    ' onclick="setHassouFilter_(\'shipped\')">発送済み' +
    '<span class="chip-count">' + countShipped + '</span></button>' +
  '</div>';
  var groupHtml = accounts.map(function(acc){
    var arr = groups[acc].slice().sort(cmp);
    var summary = '<summary>📮 ' + esc(acc) +
      '<span class="count">' + arr.length + '件</span></summary>';
    return '<details class="group-fold" open>' + summary +
      '<div class="cards-grid">' + arr.map(cardHtml).join('') + '</div>' +
      '</details>';
  }).join('');
  return header + groupHtml;
}

function renderPlaceholder(name) {
  document.getElementById('content').innerHTML =
    '<div class="placeholder">' +
      '<div class="big">🚧</div>' +
      '<h3>' + esc(name) + '</h3>' +
      '<p>このビューは準備中です。<br>本日中の優先機能は「商品管理」（採寸入力・販売情報入力）と「仕入れ管理」「発送商品」の閲覧です。</p>' +
    '</div>';
}

// ========== 場所移動 ==========
async function renderBashoList() {
  // フォーム/詳細から戻ってきた場合に list 状態へリセット（autoRefresh の許可条件）
  STATE.view = 'list';
  var c = document.getElementById('content');
  var cached = TAB_CACHE['basho'];
  if (cached && cached.data) {
    paintBashoList_(cached.data);
  } else {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    var res = await api('/api/moves?limit=200');
    var items = (res.items || []);
    TAB_CACHE['basho'] = { data: items, ts: Date.now() };
    paintBashoList_(items);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintBashoList_(allItems) {
  if (!tabCacheGuard_('basho')) return;
  var c = document.getElementById('content');
  // 詳細モーダル用にキャッシュ
  STATE.movesCache = {};
  allItems.forEach(function(it){ if (it.moveId) STATE.movesCache[it.moveId] = it; });
  var q = (document.getElementById('search').value || '').trim().toLowerCase();
  var items = q
    ? allItems.filter(function(it){
        return ((it.moveId||'') + ' ' + (it.destination||'') + ' ' + (it.reporter||'') + ' ' + (it.ids||'')).toLowerCase().indexOf(q) >= 0;
      })
    : allItems;
  var addBtn = '<div class="fab-stack"><button class="fab" onclick="openBashoCreate()" title="新規移動報告">＋</button></div>';
  if (!items.length) {
    c.innerHTML = '<div class="empty"><div class="empty-title">移動報告はまだありません</div>' +
      '<button class="empty-cta" onclick="openBashoCreate()">＋ 新規移動報告</button></div>' + addBtn;
    return;
  }
  function moveCardHtml(it) {
    var done = it.done ? '<span class="badge ok">反映済</span>' : '<span class="badge wait">未反映</span>';
    var ids = String(it.ids || '').split(/[\s,、，／/・|\n\r\t]+/).filter(Boolean);
    var pillsHtml = '';
    if (ids.length) {
      var maxShow = 8;
      var shown = ids.slice(0, maxShow).map(function(id){ return '<span class="ids-pill">' + esc(id) + '</span>'; }).join('');
      var more = ids.length > maxShow ? '<span class="ids-pill more">+' + (ids.length - maxShow) + '</span>' : '';
      pillsHtml = '<div class="meta-line">📦 ' + ids.length + '点</div>' +
                  '<div class="ids-pills">' + shown + more + '</div>';
    }
    return '<div class="card clickable" onclick="openBashoDetail(\'' + esc(it.moveId) + '\')">' +
      '<div class="card-row"><strong>' + esc(it.moveId) + '</strong>' + done + '</div>' +
      '<div class="meta-line">📅 ' + esc(it.timestamp) + '　👤 ' + esc(it.reporter) + '</div>' +
      '<div class="meta-line">📍 移動先: <strong>' + esc(it.destination) + '</strong></div>' +
      pillsHtml +
    '</div>';
  }
  // 月別グループ化（moveId が MV-yyyyMMdd-HHmmss 形式 or timestamp の先頭7文字）
  var groups = Object.create(null);
  items.forEach(function(it){
    var ym = '';
    var mid = String(it.moveId || '');
    var m = mid.match(/^MV-(\d{4})(\d{2})/);
    if (m) ym = m[1] + '-' + m[2];
    if (!ym) {
      var ts = String(it.timestamp || '');
      var m2 = ts.match(/^(\d{4})[-/](\d{1,2})/);
      if (m2) ym = m2[1] + '-' + ('0' + m2[2]).slice(-2);
    }
    if (!ym) ym = '（日付なし）';
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(it);
  });
  var keys = Object.keys(groups).sort(function(a,b){
    if (a === '（日付なし）') return 1;
    if (b === '（日付なし）') return -1;
    return b.localeCompare(a);
  });
  var html = keys.map(function(ym){
    var arr = groups[ym];
    var label = ym === '（日付なし）'
      ? ym
      : (ym.slice(0,4) + '年' + parseInt(ym.slice(5,7), 10) + '月');
    var summary = '<summary>📅 ' + esc(label) +
      '<span class="count">' + arr.length + '件</span></summary>';
    return '<details class="group-fold" open>' + summary +
      '<div class="card-list">' + arr.map(moveCardHtml).join('') + '</div>' +
      '</details>';
  }).join('');
  c.innerHTML = html + addBtn;
}

function openBashoDetail(moveId) {
  var it = (STATE.movesCache && STATE.movesCache[moveId]) || null;
  if (!it) { toast('データが見つかりません', 'error'); return; }
  var ids = String(it.ids || '').split(/[\s,、，／/・|\n\r\t]+/).filter(Boolean);
  var done = it.done ? '<span class="badge ok">反映済</span>' : '<span class="badge wait">未反映</span>';
  var idsHtml = ids.length
    ? '<div class="ids-pills" style="max-height:50vh; overflow-y:auto;">' +
        ids.map(function(id){ return '<span class="ids-pill">' + esc(id) + '</span>'; }).join('') +
      '</div>'
    : '<div class="muted">管理番号はありません</div>';
  openModal(
    '<h3>📍 移動報告 詳細</h3>' +
    '<div class="field-row"><label>移動ID</label><div>' + esc(it.moveId || '') + '　' + done + '</div></div>' +
    '<div class="field-row"><label>タイムスタンプ</label><div>' + esc(it.timestamp || '') + '</div></div>' +
    '<div class="field-row"><label>報告者</label><div>' + esc(it.reporter || '') + '</div></div>' +
    '<div class="field-row"><label>移動先</label><div>' + esc(it.destination || '') + '</div></div>' +
    '<div class="field-row"><label>管理番号（' + ids.length + '点）</label>' + idsHtml + '</div>' +
    '<div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">閉じる</button></div>'
  );
}

// AppSheet 互換: yyyyMMdd-HHmmss を JST で生成
function genMoveId_() {
  var d = new Date();
  // ローカル(JST想定)で yyyyMMdd-HHmmss を組み立て
  var pad = function(n){ return String(n).padStart(2, '0'); };
  return 'MV-' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

async function openBashoCreate() {
  var c = document.getElementById('content');
  // 新規作成中は autoRefresh をブロックするためフォーム状態に切り替え
  STATE.view = 'form';
  c.innerHTML = '<div class="loading">読み込み中…</div>';
  // マスタ取得を待つ（places/workers が未取得なら）
  if (STATE.mastersPromise) { try { await STATE.mastersPromise; } catch (e) {} }
  var places = (STATE.places && STATE.places.length) ? STATE.places : [];
  var workers = (STATE.workers && STATE.workers.length) ? STATE.workers : [];
  var placeOptions = ['<option value="">選択してください</option>'].concat(places.map(function(p){ return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; })).join('');
  var workerOptions = ['<option value="">選択してください</option>'].concat(workers.map(function(w){ return '<option value="' + esc(w) + '">' + esc(w) + '</option>'; })).join('');
  var moveId = genMoveId_();
  c.innerHTML =
    '<div class="form-card">' +
      '<h3>📍 移動報告 新規作成</h3>' +
      '<div class="notice">⚠️ 移動報告は必ず<strong>移動する当日・もしくは前日</strong>に行うようにしてください。</div>' +
      '<div class="field-row"><label>移動ID<small>登録時に自動採番</small></label>' +
        '<input type="text" id="basho-moveid" value="' + esc(moveId) + '" readonly>' +
      '</div>' +
      '<div class="field-row"><label>報告者 *</label>' +
        '<select id="basho-reporter" onchange="onBashoReporterChange()">' + workerOptions + '</select>' +
      '</div>' +
      '<div class="field-row"><label>移動先 *</label>' +
        '<select id="basho-dest">' + placeOptions + '</select>' +
      '</div>' +
      '<div class="field-row"><label>管理番号 *<small>報告者を選択すると、その作業者の商品が表示されます</small></label>' +
        '<div id="basho-ids-picker" class="ids-picker"><div class="muted">先に「報告者」を選択してください</div></div>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button class="btn-secondary" onclick="renderBashoList()">キャンセル</button>' +
        '<button class="btn-primary" onclick="submitBashoCreate()">登録</button>' +
      '</div>' +
    '</div>';
}

async function onBashoReporterChange() {
  var sel = document.getElementById('basho-reporter');
  var picker = document.getElementById('basho-ids-picker');
  var reporter = (sel && sel.value || '').trim();
  if (!reporter) {
    picker.innerHTML = '<div class="muted">先に「報告者」を選択してください</div>';
    return;
  }
  picker.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    var res = await api('/api/products?place=' + encodeURIComponent(reporter) + '&filter=shuppin_machi&limit=10000&mode=list');
    var items = (res.items || []).slice().reverse();
    if (!items.length) {
      picker.innerHTML = '<div class="muted">対象商品がありません</div>';
      return;
    }
    // 検索ボックス + チェックボックス一覧
    var listHtml = items.map(function(it){
      var label = esc(it.kanri || '') + ' ' +
        '<span class="muted">' + esc(it.brand || '') + ' / ' + esc(it.status || '') + '</span>';
      return '<label class="ids-item"><input type="checkbox" name="basho-id" value="' + esc(it.kanri || '') + '"> ' + label + '</label>';
    }).join('');
    picker.innerHTML =
      '<div class="ids-toolbar">' +
        '<input type="text" id="basho-ids-q" placeholder="検索（管理番号/ブランド）" oninput="filterBashoIds()">' +
        '<button type="button" class="btn-secondary" onclick="toggleAllBashoIds(true)">全選択</button>' +
        '<button type="button" class="btn-secondary" onclick="toggleAllBashoIds(false)">全解除</button>' +
        '<span class="muted" id="basho-ids-count">' + items.length + '件</span>' +
      '</div>' +
      '<div id="basho-ids-list" class="ids-list">' + listHtml + '</div>';
  } catch (e) {
    picker.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function filterBashoIds() {
  var q = (document.getElementById('basho-ids-q').value || '').trim().toLowerCase();
  var list = document.getElementById('basho-ids-list');
  if (!list) return;
  var labels = list.querySelectorAll('label.ids-item');
  for (var i = 0; i < labels.length; i++) {
    var t = (labels[i].textContent || '').toLowerCase();
    labels[i].style.display = (!q || t.indexOf(q) >= 0) ? '' : 'none';
  }
}

function toggleAllBashoIds(checked) {
  var list = document.getElementById('basho-ids-list');
  if (!list) return;
  var labels = list.querySelectorAll('label.ids-item');
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].style.display === 'none') continue;
    var cb = labels[i].querySelector('input[type=checkbox]');
    if (cb) cb.checked = !!checked;
  }
}

async function submitBashoCreate() {
  var reporter = (document.getElementById('basho-reporter').value || '').trim();
  var dest = (document.getElementById('basho-dest').value || '').trim();
  var moveIdEl = document.getElementById('basho-moveid');
  var moveId = (moveIdEl && moveIdEl.value || '').trim();
  var checks = document.querySelectorAll('#basho-ids-list input[name=basho-id]:checked');
  var ids = Array.from(checks).map(function(c){ return c.value; }).filter(Boolean).join(',');
  if (!reporter) { toast('報告者を選択してください', 'error'); return; }
  if (!dest) { toast('移動先を選択してください', 'error'); return; }
  if (!ids) { toast('管理番号を選択してください', 'error'); return; }
  try {
    var res = await api('/api/moves', { method: 'POST', body: { destination: dest, ids: ids, reporter: reporter, moveId: moveId } });
    toast('登録しました: ' + (res.moveId || ''));
    // 登録後はキャッシュを無効化して即時再取得
    delete TAB_CACHE['basho'];
    renderBashoList();
  } catch (e) {
    toast('登録失敗: ' + e.message, 'error');
  }
}

// ========== 返送 ==========
// 返送管理シート: A=箱ID B=報告者 C=移動先 D=管理番号 E=着数 F=備考
// 構造は場所移動とほぼ同じ。報告者の納品場所にある商品を IDピッカーで選択する。
async function renderHensouList() {
  // フォーム/詳細から戻ってきた場合に list 状態へリセット（autoRefresh の許可条件）
  STATE.view = 'list';
  var c = document.getElementById('content');
  var cached = TAB_CACHE['hensou'];
  if (cached && cached.data) {
    paintHensouList_(cached.data);
  } else {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    var res = await api('/api/returns?limit=200');
    var items = (res.items || []);
    TAB_CACHE['hensou'] = { data: items, ts: Date.now() };
    paintHensouList_(items);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintHensouList_(allItems) {
  if (!tabCacheGuard_('hensou')) return;
  var c = document.getElementById('content');
  // 詳細モーダル用にキャッシュ
  STATE.returnsCache = {};
  allItems.forEach(function(it){ if (it.boxId) STATE.returnsCache[it.boxId] = it; });
  var q = (document.getElementById('search').value || '').trim().toLowerCase();
  var items = q
    ? allItems.filter(function(it){
        return ((it.boxId||'') + ' ' + (it.destination||'') + ' ' + (it.reporter||'') + ' ' + (it.ids||'') + ' ' + (it.note||'')).toLowerCase().indexOf(q) >= 0;
      })
    : allItems;
  var addBtn = '<div class="fab-stack"><button class="fab" onclick="openHensouCreate()" title="新規返送">＋</button></div>';
  if (!items.length) {
    c.innerHTML = '<div class="empty"><div class="empty-title">返送はまだありません</div>' +
      '<button class="empty-cta" onclick="openHensouCreate()">＋ 新規返送</button></div>' + addBtn;
    return;
  }
  function hensouCardHtml(it) {
    var ids = String(it.ids || '').split(/[\s,、，／/・|\n\r\t]+/).filter(Boolean);
    var pillsHtml = '';
    if (ids.length) {
      var maxShow = 8;
      var shown = ids.slice(0, maxShow).map(function(id){ return '<span class="ids-pill">' + esc(id) + '</span>'; }).join('');
      var more = ids.length > maxShow ? '<span class="ids-pill more">+' + (ids.length - maxShow) + '</span>' : '';
      pillsHtml = '<div class="meta-line">📦 ' + ids.length + '点</div>' +
                  '<div class="ids-pills">' + shown + more + '</div>';
    }
    var countHtml = (it.count !== '' && it.count != null) ? '<span class="badge">着数 ' + esc(String(it.count)) + '</span>' : '';
    var noteHtml = it.note ? '<div class="meta-line">📝 ' + esc(it.note) + '</div>' : '';
    return '<div class="card clickable" onclick="openHensouDetail(\'' + esc(it.boxId) + '\')">' +
      '<div class="card-row"><strong>' + esc(it.boxId) + '</strong>' + countHtml + '</div>' +
      '<div class="meta-line">👤 ' + esc(it.reporter) + '　📍 移動先: <strong>' + esc(it.destination) + '</strong></div>' +
      pillsHtml + noteHtml +
    '</div>';
  }
  // 月別グループ化（boxId が RT-yyyyMMdd-HHmmss 形式）
  var groups = Object.create(null);
  items.forEach(function(it){
    var ym = '';
    var bid = String(it.boxId || '');
    var m = bid.match(/^RT-(\d{4})(\d{2})/);
    if (m) ym = m[1] + '-' + m[2];
    if (!ym) ym = '（日付なし）';
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(it);
  });
  var keys = Object.keys(groups).sort(function(a,b){
    if (a === '（日付なし）') return 1;
    if (b === '（日付なし）') return -1;
    return b.localeCompare(a);
  });
  var html = keys.map(function(ym){
    var arr = groups[ym];
    var label = ym === '（日付なし）'
      ? ym
      : (ym.slice(0,4) + '年' + parseInt(ym.slice(5,7), 10) + '月');
    var summary = '<summary>📅 ' + esc(label) +
      '<span class="count">' + arr.length + '件</span></summary>';
    return '<details class="group-fold" open>' + summary +
      '<div class="card-list">' + arr.map(hensouCardHtml).join('') + '</div>' +
      '</details>';
  }).join('');
  c.innerHTML = html + addBtn;
}

function openHensouDetail(boxId) {
  var it = (STATE.returnsCache && STATE.returnsCache[boxId]) || null;
  if (!it) { toast('データが見つかりません', 'error'); return; }
  var ids = String(it.ids || '').split(/[\s,、，／/・|\n\r\t]+/).filter(Boolean);
  var idsHtml = ids.length
    ? '<div class="ids-pills" style="max-height:50vh; overflow-y:auto;">' +
        ids.map(function(id){ return '<span class="ids-pill">' + esc(id) + '</span>'; }).join('') +
      '</div>'
    : '<div class="muted">管理番号はありません</div>';
  var countLine = (it.count !== '' && it.count != null)
    ? '<div class="field-row"><label>着数</label><div>' + esc(String(it.count)) + '</div></div>'
    : '';
  var noteLine = it.note
    ? '<div class="field-row"><label>備考</label><div style="white-space:pre-wrap">' + esc(it.note) + '</div></div>'
    : '';
  openModal(
    '<h3>↩️ 返送 詳細</h3>' +
    '<div class="field-row"><label>箱ID</label><div>' + esc(it.boxId || '') + '</div></div>' +
    '<div class="field-row"><label>報告者</label><div>' + esc(it.reporter || '') + '</div></div>' +
    '<div class="field-row"><label>移動先</label><div>' + esc(it.destination || '') + '</div></div>' +
    countLine +
    '<div class="field-row"><label>管理番号（' + ids.length + '点）</label>' + idsHtml + '</div>' +
    noteLine +
    '<div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">閉じる</button></div>'
  );
}

// AppSheet 互換: RT-yyyyMMdd-HHmmss
function genBoxId_() {
  var d = new Date();
  var pad = function(n){ return String(n).padStart(2, '0'); };
  return 'RT-' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

async function openHensouCreate() {
  var c = document.getElementById('content');
  // 新規作成中は autoRefresh をブロックするためフォーム状態に切り替え
  STATE.view = 'form';
  c.innerHTML = '<div class="loading">読み込み中…</div>';
  if (STATE.mastersPromise) { try { await STATE.mastersPromise; } catch (e) {} }
  var places = (STATE.places && STATE.places.length) ? STATE.places : [];
  var workers = (STATE.workers && STATE.workers.length) ? STATE.workers : [];
  var placeOptions = ['<option value="">選択してください</option>'].concat(places.map(function(p){ return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; })).join('');
  var workerOptions = ['<option value="">選択してください</option>'].concat(workers.map(function(w){ return '<option value="' + esc(w) + '">' + esc(w) + '</option>'; })).join('');
  var boxId = genBoxId_();
  c.innerHTML =
    '<div class="form-card">' +
      '<h3>↩️ 返送 新規作成</h3>' +
      '<div class="notice">⚠️ 返送対象の管理番号は <strong>商品管理シートで「返品済み」</strong>に自動更新されます。</div>' +
      '<div class="field-row"><label>箱ID<small>登録時に自動採番</small></label>' +
        '<input type="text" id="hensou-boxid" value="' + esc(boxId) + '" readonly>' +
      '</div>' +
      '<div class="field-row"><label>報告者 *</label>' +
        '<select id="hensou-reporter" onchange="onHensouReporterChange()">' + workerOptions + '</select>' +
      '</div>' +
      '<div class="field-row"><label>移動先 *</label>' +
        '<select id="hensou-dest">' + placeOptions + '</select>' +
      '</div>' +
      '<div class="field-row"><label>管理番号 *<small>報告者を選択すると、その作業者の商品が表示されます</small></label>' +
        '<div id="hensou-ids-picker" class="ids-picker"><div class="muted">先に「報告者」を選択してください</div></div>' +
      '</div>' +
      '<div class="field-row"><label>着数<small>選択した管理番号の数が自動入力されます</small></label>' +
        '<input type="number" id="hensou-count" min="0" step="1" value="0" readonly>' +
      '</div>' +
      '<div class="field-row"><label>備考</label>' +
        '<textarea id="hensou-note" rows="3"></textarea>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button class="btn-secondary" onclick="renderHensouList()">キャンセル</button>' +
        '<button class="btn-primary" onclick="submitHensouCreate()">登録</button>' +
      '</div>' +
    '</div>';
}

async function onHensouReporterChange() {
  var sel = document.getElementById('hensou-reporter');
  var picker = document.getElementById('hensou-ids-picker');
  var reporter = (sel && sel.value || '').trim();
  if (!reporter) {
    picker.innerHTML = '<div class="muted">先に「報告者」を選択してください</div>';
    return;
  }
  picker.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    // 返送候補は AppSheet Valid_If と完全一致させる:
    //   納品場所 = 報告者 AND ステータス = 出品中
    //   AND ISNOTBLANK([出品日]) AND DATE([出品日]) <= (TODAY() - 30)
    // → サーバー側で listedBeforeDays=30 を渡して 30日以上前の出品のみ返す
    var res = await api('/api/products?place=' + encodeURIComponent(reporter) + '&filter=shuppinchu&listedBeforeDays=30&limit=10000&mode=list');
    var items = (res.items || []).slice().reverse();
    if (!items.length) {
      picker.innerHTML = '<div class="muted">対象商品がありません</div>';
      return;
    }
    var listHtml = items.map(function(it){
      var label = esc(it.kanri || '') + ' ' +
        '<span class="muted">' + esc(it.brand || '') + ' / ' + esc(it.status || '') + '</span>';
      return '<label class="ids-item"><input type="checkbox" name="hensou-id" value="' + esc(it.kanri || '') + '" onchange="updateHensouCount()"> ' + label + '</label>';
    }).join('');
    picker.innerHTML =
      '<div class="ids-toolbar">' +
        '<input type="text" id="hensou-ids-q" placeholder="検索（管理番号/ブランド）" oninput="filterHensouIds()">' +
        '<button type="button" class="btn-secondary" onclick="toggleAllHensouIds(true)">全選択</button>' +
        '<button type="button" class="btn-secondary" onclick="toggleAllHensouIds(false)">全解除</button>' +
        '<span class="muted" id="hensou-ids-count">' + items.length + '件</span>' +
      '</div>' +
      '<div id="hensou-ids-list" class="ids-list">' + listHtml + '</div>';
    updateHensouCount();
  } catch (e) {
    picker.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function filterHensouIds() {
  var q = (document.getElementById('hensou-ids-q').value || '').trim().toLowerCase();
  var list = document.getElementById('hensou-ids-list');
  if (!list) return;
  var labels = list.querySelectorAll('label.ids-item');
  for (var i = 0; i < labels.length; i++) {
    var t = (labels[i].textContent || '').toLowerCase();
    labels[i].style.display = (!q || t.indexOf(q) >= 0) ? '' : 'none';
  }
}

function toggleAllHensouIds(checked) {
  var list = document.getElementById('hensou-ids-list');
  if (!list) return;
  var labels = list.querySelectorAll('label.ids-item');
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].style.display === 'none') continue;
    var cb = labels[i].querySelector('input[type=checkbox]');
    if (cb) cb.checked = !!checked;
  }
  updateHensouCount();
}

// 着数を選択チェック数に同期（input は readonly にして手動入力不可）
function updateHensouCount() {
  var checks = document.querySelectorAll('#hensou-ids-list input[name=hensou-id]:checked');
  var input = document.getElementById('hensou-count');
  if (input) input.value = String(checks.length);
}

async function submitHensouCreate() {
  var reporter = (document.getElementById('hensou-reporter').value || '').trim();
  var dest = (document.getElementById('hensou-dest').value || '').trim();
  var boxIdEl = document.getElementById('hensou-boxid');
  var boxId = (boxIdEl && boxIdEl.value || '').trim();
  var checks = document.querySelectorAll('#hensou-ids-list input[name=hensou-id]:checked');
  var ids = Array.from(checks).map(function(c){ return c.value; }).filter(Boolean).join(',');
  var countRaw = (document.getElementById('hensou-count').value || '').trim();
  var note = (document.getElementById('hensou-note').value || '').trim();
  if (!reporter) { toast('報告者を選択してください', 'error'); return; }
  if (!dest) { toast('移動先を選択してください', 'error'); return; }
  if (!ids) { toast('管理番号を選択してください', 'error'); return; }
  var body = { destination: dest, ids: ids, reporter: reporter, boxId: boxId, note: note };
  if (countRaw !== '') {
    var n = Number(countRaw);
    if (!isNaN(n)) body.count = n;
  }
  try {
    var res = await api('/api/returns', { method: 'POST', body: body });
    toast('登録しました: ' + (res.boxId || ''));
    delete TAB_CACHE['hensou'];
    renderHensouList();
  } catch (e) {
    toast('登録失敗: ' + e.message, 'error');
  }
}

// ========== AI 画像判定一覧 ==========
async function renderAiList() {
  var c = document.getElementById('content');
  // 検索クエリは API に渡しているので、キーに含めてキャッシュを分離
  var qs = (document.getElementById('search').value || '').trim();
  var key = 'ai|' + qs;
  var cached = TAB_CACHE[key];
  if (cached && cached.data) {
    paintAiList_(cached.data);
  } else {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    var url = '/api/ai/list?limit=200' + (qs ? '&q=' + encodeURIComponent(qs) : '');
    var res = await api(url);
    var items = res.items || [];
    TAB_CACHE[key] = { data: items, ts: Date.now() };
    paintAiList_(items);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintAiList_(items) {
  if (!tabCacheGuard_('ai')) return;
  var c = document.getElementById('content');
  if (!items.length) {
    c.innerHTML = '<div class="empty">AI判定結果はまだありません。</div>';
    return;
  }
  // 2列グリッドのコンパクトカード。主要4項目（管理番号/ブランド/カテゴリ/カラー）+ タグ詳細はチップ
  var html = '<div class="ai-grid">' + items.map(function(it){
    var f = it.fields || {};
    var brand = f['ブランド'] || '—';
    var cat = [f['カテゴリ1'], f['カテゴリ2'], f['カテゴリ3']].filter(Boolean).join(' / ');
    var color = f['カラー'] || '';
    var meta = [cat, color].filter(Boolean).join('・');
    var tagFields = ['性別','タグ表記','デザイン特徴','ポケット'];
    var tags = tagFields.map(function(k){
      return f[k] ? '<span class="ai-tag">' + esc(String(f[k])) + '</span>' : '';
    }).filter(Boolean).join('');
    return '<div class="ai-card" onclick="openDetail(' + JSON.stringify(it.kanri) + ')">' +
      '<div class="ai-kanri">' + esc(it.kanri) + '</div>' +
      '<div class="ai-brand">' + esc(brand) + '</div>' +
      (meta ? '<div class="ai-meta">' + esc(meta) + '</div>' : '') +
      (tags ? '<div class="ai-tags">' + tags + '</div>' : '') +
    '</div>';
  }).join('') + '</div>';
  c.innerHTML = html;
}

// ========== 作業者管理 ==========
async function renderSagyouList() {
  var c = document.getElementById('content');
  var cached = TAB_CACHE['sagyou'];
  if (cached && cached.data) {
    paintSagyouList_(cached.data);
  } else {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    var res = await api('/api/sagyousha?months=6');
    var data = {
      workers: res.items || [],
      months: res.months || [],
      currentUser: res.currentUser || { email: '', isAdmin: false }
    };
    TAB_CACHE['sagyou'] = { data: data, ts: Date.now() };
    paintSagyouList_(data);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintSagyouList_(data) {
  if (!tabCacheGuard_('sagyou')) return;
  var c = document.getElementById('content');
  var workers = data.workers || [];
  var months = data.months || [];
  var isAdmin = !!(data.currentUser && data.currentUser.isAdmin);
  if (!workers.length) {
    c.innerHTML = '<div class="empty">作業者データがありません。</div>' +
      (isAdmin ? '<div class="fab-stack"><button class="fab" onclick="openSagyouCreate()" title="新規作業者">＋</button></div>' : '');
    return;
  }
  var thisMonthYm = months[0] || '';
  var thisMonthLabel = thisMonthYm ? (parseInt(thisMonthYm.slice(5), 10) + '月') : '';
  var cards = workers.map(function(w, idx){
    var enabledBadge = w.row > 0
      ? (w.enabled ? '<span class="badge ok">有効</span>' : '<span class="badge disabled">無効</span>')
      : '<span class="badge disabled">マスター未登録</span>';
    var adminBadge = w.admin ? '<span class="badge admin">管理者</span>' : '';
    var emails = [w.email1, w.email2].filter(function(e){ return e; });
    var emailHtml = emails.length
      ? esc(emails.join(' / '))
      : '<span class="nomail">メール未登録</span>';
    var tm = (w.monthly && w.monthly[thisMonthYm]) || { sokutei: 0, satsuei: 0, shuppin: 0, hassou: 0 };
    var thisMonthHtml =
      '<div class="sagyou-card-thismonth">' +
        '<span class="ym-label">' + esc(thisMonthLabel) + '</span>' +
        '<span class="metric' + (!tm.sokutei ? ' zero' : '') + '">採寸<span class="num">' + (tm.sokutei || 0) + '</span></span>' +
        '<span class="metric' + (!tm.satsuei ? ' zero' : '') + '">撮影<span class="num">' + (tm.satsuei || 0) + '</span></span>' +
        '<span class="metric' + (!tm.shuppin ? ' zero' : '') + '">出品<span class="num">' + (tm.shuppin || 0) + '</span></span>' +
        '<span class="metric' + (!tm.hassou ? ' zero' : '') + '">発送<span class="num">' + (tm.hassou || 0) + '</span></span>' +
      '</div>';
    // カード本体タップ → 履歴モーダル / 右上ボタン → 編集（管理者かつマスター登録済のみ）
    var clickable = isAdmin || w.row > 0;
    var onClick = clickable ? ' onclick="openSagyouDetail(' + idx + ')"' : '';
    var clsExtra = (w.row > 0 && !w.enabled) ? ' disabled' : '';
    var editBtn = (isAdmin && w.row > 0)
      ? '<button class="sagyou-card-edit" onclick="event.stopPropagation(); openSagyouEdit(' + idx + ')" title="編集" aria-label="編集">✎</button>'
      : '';
    return '<div class="sagyou-card' + (clickable ? ' clickable' : '') + clsExtra + '"' + onClick + '>' +
      editBtn +
      '<div class="sagyou-card-head">' +
        '<div class="sagyou-card-name">' + esc(w.name) + '</div>' +
        '<div class="sagyou-card-badges">' + enabledBadge + adminBadge + '</div>' +
      '</div>' +
      thisMonthHtml +
      '<div class="sagyou-card-emails">' + emailHtml + '</div>' +
    '</div>';
  }).join('');
  var fab = isAdmin
    ? '<div class="fab-stack"><button class="fab" onclick="openSagyouCreate()" title="新規作業者">＋</button></div>'
    : '';
  var note = '<div class="sagyou-list-note">カード=今月の件数 ／ タップで詳細（直近6ヶ月の履歴）</div>';
  c.innerHTML = note + '<div class="sagyou-list">' + cards + '</div>' + fab;
}

function openSagyouDetail(idx) {
  var data = (TAB_CACHE['sagyou'] && TAB_CACHE['sagyou'].data) || null;
  if (!data) return;
  var w = (data.workers || [])[idx];
  if (!w) return;
  var months = data.months || [];
  var totals = { sokutei: 0, satsuei: 0, shuppin: 0, hassou: 0 };
  var monthlyRows = months.map(function(m){
    var v = (w.monthly && w.monthly[m]) || { sokutei: 0, satsuei: 0, shuppin: 0, hassou: 0 };
    totals.sokutei += (v.sokutei || 0);
    totals.satsuei += (v.satsuei || 0);
    totals.shuppin += (v.shuppin || 0);
    totals.hassou  += (v.hassou  || 0);
    var label = parseInt(m.slice(5), 10) + '月';
    function cell(n){ return '<td class="' + (n ? 'has' : 'zero') + '">' + (n || '—') + '</td>'; }
    return '<tr><td class="ym">' + esc(label) + '</td>' +
           cell(v.sokutei) + cell(v.satsuei) + cell(v.shuppin) + cell(v.hassou) + '</tr>';
  }).join('');
  var totalsRow = '<tr>' +
    '<td class="ym">合計</td>' +
    '<td>' + (totals.sokutei || '—') + '</td>' +
    '<td>' + (totals.satsuei || '—') + '</td>' +
    '<td>' + (totals.shuppin || '—') + '</td>' +
    '<td>' + (totals.hassou  || '—') + '</td>' +
    '</tr>';
  var emails = [w.email1, w.email2].filter(function(e){ return e; }).join(' / ') || '—';
  openModal(
    '<h3>📊 ' + esc(w.name) + ' の作業履歴</h3>' +
    (w.row === 0 ? '<div class="notice">マスター未登録の名前。商品管理シートで担当者として記録された分のみ表示。</div>' : '') +
    '<div class="field-row"><label>有効</label><div>' + (w.enabled ? '✅ 有効' : '⛔ 無効') + '</div></div>' +
    '<div class="field-row"><label>管理者</label><div>' + (w.admin ? '✅ 管理者' : '—') + '</div></div>' +
    '<div class="field-row"><label>メールアドレス</label><div>' + esc(emails) + '</div></div>' +
    '<div class="field-row"><label>月別件数（採寸 / 撮影 / 出品 / 発送）<span style="font-weight:400;color:var(--text-sub);font-size:12px;margin-left:6px;">直近6ヶ月</span></label>' +
      '<div class="sagyou-detail-monthly">' +
        '<table>' +
          '<thead><tr><th>月</th><th>採寸</th><th>撮影</th><th>出品</th><th>発送</th></tr></thead>' +
          '<tbody>' + monthlyRows + '</tbody>' +
          '<tfoot>' + totalsRow + '</tfoot>' +
        '</table>' +
      '</div>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">閉じる</button></div>'
  );
}

function openSagyouEdit(idx) {
  var data = (TAB_CACHE['sagyou'] && TAB_CACHE['sagyou'].data) || null;
  if (!data) return;
  var w = (data.workers || [])[idx];
  if (!w || w.row < 2) return;
  openModal(
    '<h3>👥 作業者を編集</h3>' +
    '<div class="field-row"><label>名前 <span class="req">*</span></label>' +
      '<input id="sg_name" type="text" value="' + esc(w.name || '') + '"></div>' +
    '<div class="field-row"><label>メール1</label>' +
      '<input id="sg_email1" type="email" value="' + esc(w.email1 || '') + '"></div>' +
    '<div class="field-row"><label>メール2</label>' +
      '<input id="sg_email2" type="email" value="' + esc(w.email2 || '') + '"></div>' +
    '<div class="field-row"><label><input id="sg_enabled" type="checkbox"' + (w.enabled ? ' checked' : '') + '> 有効</label></div>' +
    '<div class="field-row"><label><input id="sg_admin" type="checkbox"' + (w.admin ? ' checked' : '') + '> 管理者</label></div>' +
    '<input type="hidden" id="sg_row" value="' + w.row + '">' +
    '<div class="modal-actions">' +
      '<button class="btn-cancel" onclick="closeModal()">キャンセル</button>' +
      '<button class="btn-submit" id="sg_submit" onclick="submitSagyouSave()">保存</button>' +
    '</div>'
  );
}

function openSagyouCreate() {
  var data = (TAB_CACHE['sagyou'] && TAB_CACHE['sagyou'].data) || null;
  if (!data || !data.currentUser || !data.currentUser.isAdmin) {
    toast('管理者のみ追加できます', 'error'); return;
  }
  openModal(
    '<h3>👥 新規作業者</h3>' +
    '<div class="field-row"><label>名前 <span class="req">*</span></label>' +
      '<input id="sg_name" type="text" placeholder="例: 山田 太郎"></div>' +
    '<div class="field-row"><label>メール1</label>' +
      '<input id="sg_email1" type="email" placeholder="example@gmail.com"></div>' +
    '<div class="field-row"><label>メール2</label>' +
      '<input id="sg_email2" type="email" placeholder="任意"></div>' +
    '<div class="field-row"><label><input id="sg_enabled" type="checkbox" checked> 有効</label></div>' +
    '<div class="field-row"><label><input id="sg_admin" type="checkbox"> 管理者</label></div>' +
    '<div class="modal-actions">' +
      '<button class="btn-cancel" onclick="closeModal()">キャンセル</button>' +
      '<button class="btn-submit" id="sg_submit" onclick="submitSagyouCreate()">作成</button>' +
    '</div>'
  );
}

async function submitSagyouSave() {
  var btn = document.getElementById('sg_submit');
  var row = parseInt(document.getElementById('sg_row').value, 10);
  var name = document.getElementById('sg_name').value.trim();
  if (!name) { toast('名前を入力してください', 'error'); return; }
  var body = {
    row: row,
    name: name,
    email1: document.getElementById('sg_email1').value.trim(),
    email2: document.getElementById('sg_email2').value.trim(),
    enabled: document.getElementById('sg_enabled').checked,
    admin: document.getElementById('sg_admin').checked,
  };
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    await api('/api/sagyousha', { method: 'POST', body: body });
    toast('保存しました', 'success');
    closeModal();
    delete TAB_CACHE['sagyou'];
    if (STATE.tab === 'sagyou') renderSagyouList();
  } catch (err) {
    toast('保存失敗: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '保存';
  }
}

async function submitSagyouCreate() {
  var btn = document.getElementById('sg_submit');
  var name = document.getElementById('sg_name').value.trim();
  if (!name) { toast('名前を入力してください', 'error'); return; }
  var body = {
    name: name,
    email1: document.getElementById('sg_email1').value.trim(),
    email2: document.getElementById('sg_email2').value.trim(),
    enabled: document.getElementById('sg_enabled').checked,
    admin: document.getElementById('sg_admin').checked,
  };
  btn.disabled = true; btn.textContent = '作成中…';
  try {
    await api('/api/sagyousha/create', { method: 'POST', body: body });
    toast('作業者を作成しました', 'success');
    closeModal();
    delete TAB_CACHE['sagyou'];
    if (STATE.tab === 'sagyou') renderSagyouList();
  } catch (err) {
    toast('作成失敗: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '作成';
  }
}

// ========== 業務メニュー（AppSheet 互換） ==========
// 旧: 全行ダンプの単一テーブル
// 新: ログイン者本人で絞り込み、タブごとに専用UI
//   - 仕入れ数報告: 自分の未処理行に「数量」を入力して送信（G列を自動 TRUE 化）
//   - 経費申請:   自分の申請履歴 + 新規申請フォーム（appendRow）
//   - 報酬確認:   自分の月別報酬カード（読み取り専用）
var BUSINESS_SHEETS = {
  shiire_houkoku: '仕入れ数報告',
  keihi: '経費申請',
  houshu: '報酬管理'
};

async function renderBusinessSheet(menuKey) {
  var c = document.getElementById('content');
  if (!BUSINESS_SHEETS[menuKey]) { renderPlaceholder(STATE.businessLabel || '業務'); return; }
  // 自分の名前が必要なので必ず解決を待つ（初回のみ。2回目以降はキャッシュ済み）
  if (STATE.userNamePromise && !STATE.userName) {
    c.innerHTML = '<div class="loading">読み込み中…</div>';
    try { await STATE.userNamePromise; } catch (e) {}
  }
  if (!STATE.userName) { showUserNamePicker_(); return; }
  if (menuKey === 'shiire_houkoku') return renderShiireHoukokuTab_();
  if (menuKey === 'keihi')          return renderKeihiTab_();
  if (menuKey === 'houshu')         return renderHoushuTab_();
}

// ---------- 共通: シートダンプ取得（自分用フィルタは表示時） ----------
async function fetchBusinessSheet_(menuKey) {
  var sheetName = BUSINESS_SHEETS[menuKey];
  var cacheKey = 'business|' + menuKey;
  // SWR の取り回しでスプレッドシート編集が反映されない事故を防ぐため、URL に時刻パラメータで毎回バスティング
  var bust = '&_=' + Date.now();
  var res = await api('/api/sheet/' + encodeURIComponent(sheetName) + '?limit=500' + bust);
  var data = { headers: res.headers || [], rows: res.rows || [], total: res.total || (res.rows ? res.rows.length : 0) };
  TAB_CACHE[cacheKey] = { data: data, ts: Date.now() };
  return data;
}
function colIdx_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === name) return i;
  }
  return -1;
}
function nameMatchesSelf_(v) {
  return String(v || '').trim() === STATE.userName;
}

// ---------- 仕入れ数報告 ----------
async function renderShiireHoukokuTab_() {
  if (STATE.tab !== 'business' || STATE.business !== 'shiire_houkoku' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var cached = TAB_CACHE['business|shiire_houkoku'];
  if (cached) paintShiireHoukoku_(cached.data);
  else c.innerHTML = '<div class="loading">読み込み中…</div>';
  try {
    var data = await fetchBusinessSheet_('shiire_houkoku');
    paintShiireHoukoku_(data);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintShiireHoukoku_(data) {
  if (STATE.tab !== 'business' || STATE.business !== 'shiire_houkoku' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var headers = data.headers || [];
  var rows = data.rows || [];
  var iId      = colIdx_(headers, 'ID');
  var iReporter= colIdx_(headers, '報告者');
  var iCat     = colIdx_(headers, '区分コード');
  var iDate    = colIdx_(headers, '仕入れ日');
  var iQty     = colIdx_(headers, '数量');
  var iDone    = colIdx_(headers, '処理済み');
  var iContent = colIdx_(headers, '内容');
  // 内容は H列 をそのまま表示。空欄ならプレースホルダを出さず空のままにする（フォールバックは混乱の元なので使わない）。
  function contentOf_(r) {
    return iContent >= 0 ? String(r[iContent] || '').trim() : '';
  }
  // 30文字を超えたら末尾を「…」に置き換える（描画コスト削減と一覧の見通し向上）
  function truncate_(s) {
    var v = String(s || '');
    return v.length > 30 ? v.slice(0, 30) + '…' : v;
  }
  if (iId < 0 || iQty < 0) {
    c.innerHTML = '<div class="empty">仕入れ数報告シートのヘッダーが想定と異なります。</div>';
    return;
  }
  // 処理済み判定: 数量が入力されていれば処理済みとみなす（G列の TRUE/FALSE は参照しない）。
  // 仕入れ管理側の onChange / Cron が走るまで G 列は更新されないため、UI 上は数量を信頼する。
  function qtyOf_(r){ var n = parseInt(String(r[iQty] || '').replace(/[^\d-]/g, ''), 10); return isFinite(n) ? n : 0; }
  var pending = rows.filter(function(r){ return qtyOf_(r) <= 0; });
  var done    = rows.filter(function(r){ return qtyOf_(r) >  0; });
  // 仕入れ日 降順（新しい順）
  function dateKey_(r){ return iDate >= 0 ? String(r[iDate] || '') : ''; }
  function byDateDesc_(a, b){ var da = dateKey_(a), db = dateKey_(b); return da < db ? 1 : (da > db ? -1 : 0); }
  pending.sort(byDateDesc_);
  done.sort(byDateDesc_);
  var html = '<div class="biz-wrap">';
  html += '<div class="biz-meta">仕入れ数報告（未処理 ' + pending.length + ' / 処理済み ' + done.length + '）</div>';
  if (pending.length === 0) {
    html += '<div class="empty" style="padding:24px">未処理の報告はありません。</div>';
  } else {
    html += '<div class="keihi-list">';
    pending.forEach(function(r){
      var id = String(r[iId] || '');
      var reporter = iReporter >= 0 ? String(r[iReporter] || '') : '';
      var cat = iCat >= 0 ? String(r[iCat] || '') : '';
      var date = iDate >= 0 ? String(r[iDate] || '') : '';
      var content = contentOf_(r);
      var safeId = esc(id).replace(/'/g, "\\'");
      html += '<div class="shiire-rep-card" data-id="' + esc(id) + '">' +
        '<div class="shiire-rep-card-head">' +
          '<div class="shiire-rep-card-title">' + esc(date) + '</div>' +
          '<div class="shiire-rep-card-date">' + esc(truncate_(content)) + '</div>' +
        '</div>' +
        '<div class="shiire-rep-card-sub">' +
          (id ? '<span class="tag" style="background:#fff3e0;color:#e65100">🆔 ' + esc(id) + '</span>' : '') +
          (reporter ? '<span class="tag">📍 ' + esc(reporter) + '</span>' : '') +
          (cat ? '<span class="tag">区分 ' + esc(cat) + '</span>' : '') +
        '</div>' +
        '<div class="shiire-rep-card-form">' +
          '<input type="number" inputmode="numeric" min="1" placeholder="数量を入力" id="qty-' + esc(id) + '" />' +
          '<button class="btn-primary" onclick="submitShiireHoukokuQty_(\'' + safeId + '\')">送信</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }
  if (done.length > 0) {
    // 初回読み込みを軽くするため、処理済みは折りたたみ（クリックで展開）。中身は遅延描画。
    // SWR の二度描画で開状態が失われないよう、グローバル SHIIRE_DONE_OPEN を引き継ぐ
    var openAttr = (window.SHIIRE_DONE_OPEN === true) ? ' open' : '';
    html += '<details class="shiire-done-details" style="margin-top:16px"' + openAttr + '><summary style="padding:8px 12px;color:#666;font-size:13px;cursor:pointer;font-weight:600">処理済み（' + done.length + '件）</summary>';
    html += '<div class="shiire-done-list" data-pending="1" style="margin-top:8px"></div>';
    html += '</details>';
  }
  html += '</div>';
  c.innerHTML = html;
  // 処理済みリストは details が開かれた時点で描画。SWR の再描画が来ても開状態を維持する。
  var details = c.querySelector('.shiire-done-details');
  var listEl = c.querySelector('.shiire-done-list');
  function renderDoneList_() {
    if (!listEl || listEl.dataset.pending !== '1') return;
    var inner = '';
    done.forEach(function(r){
      var id = String(r[iId] || '');
      var date = iDate >= 0 ? String(r[iDate] || '') : '';
      var reporter = iReporter >= 0 ? String(r[iReporter] || '') : '';
      var cat = iCat >= 0 ? String(r[iCat] || '') : '';
      var content = contentOf_(r);
      var qty = qtyOf_(r);
      var meta = [reporter, cat ? '区分' + cat : ''].filter(Boolean).join(' / ');
      inner += '<div class="shiire-done-row">' +
        '<span class="d-date">' + esc(date) + '</span>' +
        '<span class="d-title">' + esc(truncate_(content)) + '</span>' +
        (id ? '<span class="d-id">🆔 ' + esc(id) + '</span>' : '') +
        (meta ? '<span class="d-meta">' + esc(meta) + '</span>' : '') +
        '<span class="d-qty">' + qty + '点</span>' +
      '</div>';
    });
    listEl.innerHTML = inner;
    listEl.dataset.pending = '0';
  }
  if (details && listEl && done.length > 0) {
    // 既に開いた状態で再描画された場合は即座に中身を埋める
    if (details.open) renderDoneList_();
    details.addEventListener('toggle', function onToggle() {
      window.SHIIRE_DONE_OPEN = !!details.open;
      if (details.open) renderDoneList_();
    });
  }
}

async function submitShiireHoukokuQty_(id) {
  var input = document.getElementById('qty-' + id);
  if (!input) return;
  var qty = parseInt(input.value, 10);
  if (!qty || qty <= 0) { toast('数量を1以上で入力してください', 'error'); return; }
  var btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
  try {
    await api('/api/shiire-houkoku/quantity', { method: 'POST', body: { id: id, quantity: qty } });
    toast('送信しました（数量: ' + qty + '）');
    delete TAB_CACHE['business|shiire_houkoku'];
    await renderShiireHoukokuTab_();
  } catch (err) {
    toast('送信失敗: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '送信'; }
  }
}

// ---------- 経費申請 ----------
async function renderKeihiTab_() {
  if (STATE.tab !== 'business' || STATE.business !== 'keihi' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var cached = TAB_CACHE['business|keihi'];
  if (cached) paintKeihi_(cached.data);
  else c.innerHTML = '<div class="loading">読み込み中…</div>';
  try {
    var data = await fetchBusinessSheet_('keihi');
    paintKeihi_(data);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

// 経費申請の日付/タイムスタンプ列を YYYY/MM/DD 区切りに統一する。
// シート側で "2026-05-04" 形式が混じっていてもハイフンを / に変換。
function fmtKeihiDate_(s) {
  if (s === null || s === undefined) return '';
  var str = String(s).trim();
  if (!str) return '';
  return str.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/, '$1/$2/$3');
}

function paintKeihi_(data) {
  if (STATE.tab !== 'business' || STATE.business !== 'keihi' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var headers = data.headers || [];
  var rows = data.rows || [];
  var iName     = colIdx_(headers, '名前');
  var iDate     = colIdx_(headers, '購入日');
  var iItem     = colIdx_(headers, '商品名');
  var iPlace    = colIdx_(headers, '購入場所');
  var iLink     = colIdx_(headers, '購入場所リンク');
  var iAmount   = colIdx_(headers, '購入金額');
  var iReceipt  = colIdx_(headers, '購入証明のためのレシートやスクショ');
  var iTs       = colIdx_(headers, 'タイムスタンプ');
  if (iName < 0) {
    c.innerHTML = '<div class="empty">経費申請シートのヘッダーが想定と異なります。</div>';
    return;
  }
  var mine = rows.filter(function(r){ return nameMatchesSelf_(r[iName]); });
  var addBtn = '<div class="fab-stack"><button class="fab" onclick="openKeihiForm_()" title="新規経費申請">＋</button></div>';
  var html = '<div class="biz-wrap">';
  html += '<div class="biz-meta">' +
    '<span>' + esc(STATE.userName) + ' さんの経費申請（' + mine.length + '件）</span>' +
  '</div>';
  if (mine.length === 0) {
    html += '<div class="empty"><div class="empty-title">申請履歴はまだありません</div>' +
      '<button class="empty-cta" onclick="openKeihiForm_()">＋ 新規経費申請</button></div>';
  } else {
    html += '<table class="biz-table"><thead><tr>' +
      '<th>申請日時</th><th>購入日</th><th>商品名</th><th>購入場所</th><th>金額</th><th>レシート</th>' +
    '</tr></thead><tbody>';
    mine.forEach(function(r){
      var link = iLink >= 0 ? String(r[iLink] || '') : '';
      var place = iPlace >= 0 ? String(r[iPlace] || '') : '';
      var placeHtml = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(place || link) + '</a>' : esc(place);
      var receipt = iReceipt >= 0 ? String(r[iReceipt] || '') : '';
      var receiptHtml;
      if (receipt && /^https?:/i.test(receipt)) {
        var safeReceipt = esc(receipt).replace(/\'/g, "\\'");
        receiptHtml = '<button type="button" class="keihi-receipt-thumb" onclick="openImageModal_(\'' + safeReceipt + '\')" title="クリックで拡大">' +
                        '<img src="' + esc(normalizeDriveUrl_(receipt)) + '" alt="" loading="lazy" decoding="async">' +
                      '</button>';
      } else if (receipt) {
        receiptHtml = esc(receipt);
      } else {
        receiptHtml = '—';
      }
      html += '<tr>' +
        '<td>' + esc(fmtKeihiDate_(iTs >= 0 ? r[iTs] : '')) + '</td>' +
        '<td>' + esc(fmtKeihiDate_(iDate >= 0 ? r[iDate] : '')) + '</td>' +
        '<td>' + esc(iItem >= 0 ? r[iItem] : '') + '</td>' +
        '<td>' + placeHtml + '</td>' +
        '<td>' + esc(iAmount >= 0 ? r[iAmount] : '') + '</td>' +
        '<td>' + receiptHtml + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  c.innerHTML = html + addBtn;
}

// 商品管理の openBashoCreate と同じ画面遷移パターン（form-card / form-actions）
// 購入証明はファイル選択 → /api/keihi/image でDriveに保存 → 戻ったURLを receipt として appendKeihi
var KEIHI_DRAFT = { receiptUrl: '' };
function openKeihiForm_() {
  var c = document.getElementById('content');
  STATE.view = 'form';
  KEIHI_DRAFT = { receiptUrl: '' };
  var today = new Date();
  var dateDefault = today.getFullYear() + '-' + ('0'+(today.getMonth()+1)).slice(-2) + '-' + ('0'+today.getDate()).slice(-2);
  var gaichuRow = STATE.isAdmin
    ? ('<div class="field-row"><label>外注費（円）<small>入力時は商品名・購入金額は不要</small></label>' +
         '<input type="number" id="keihi-gaichu" inputmode="numeric" min="0" placeholder="0" oninput="onKeihiGaichuInput_()">' +
       '</div>')
    : '';
  c.innerHTML =
    '<div class="form-card">' +
      '<h3>💴 経費申請 新規作成</h3>' +
      '<div class="notice">あなた（<strong>' + esc(STATE.userName) + '</strong>）の経費を申請します。送信すると管理者にメール通知されます。</div>' +
      '<div class="field-row"><label>購入日 *</label>' +
        '<input type="date" id="keihi-date" value="' + dateDefault + '">' +
      '</div>' +
      gaichuRow +
      '<div class="field-row"><label id="keihi-item-label">商品名 *</label>' +
        '<input type="text" id="keihi-item" placeholder="例: 採寸メジャー">' +
      '</div>' +
      '<div class="field-row"><label>購入場所</label>' +
        '<input type="text" id="keihi-place" placeholder="店名 / サイト名 など">' +
      '</div>' +
      '<div class="field-row"><label>購入場所リンク</label>' +
        '<input type="url" id="keihi-link" placeholder="https://...">' +
      '</div>' +
      '<div class="field-row"><label id="keihi-amount-label">購入金額（円） *</label>' +
        '<input type="number" id="keihi-amount" inputmode="numeric" min="0" placeholder="0">' +
      '</div>' +
      '<div class="field-row"><label>購入証明<small>レシート / スクショの画像をアップロード</small></label>' +
        '<div class="img-field" tabindex="0" onpaste="onKeihiReceiptPasteEvent_(event)">' +
          '<div id="keihi-receipt-preview" class="img-preview">画像なし</div>' +
          '<div class="img-actions">' +
            '<label class="img-upload-btn ghost" for="keihi-receipt-file">📷 撮影／選択</label>' +
            '<input type="file" id="keihi-receipt-file" accept="image/*" capture="environment" ' +
              'onchange="onKeihiReceiptPick_(this)" style="display:none">' +
            '<button type="button" class="img-upload-btn ghost" onclick="onKeihiReceiptPaste_()">📋 貼り付け</button>' +
            '<div class="img-hint">最大1600px・JPG（スクショは Cmd+V でも貼付可）</div>' +
            '<div id="keihi-receipt-status" class="img-status"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button class="btn-secondary" onclick="cancelKeihiForm_()">キャンセル</button>' +
        '<button class="btn-primary" id="keihi-submit-btn" onclick="submitKeihiForm_()">申請する</button>' +
      '</div>' +
    '</div>';
}

function cancelKeihiForm_() {
  STATE.view = 'list';
  renderKeihiTab_();
}

function onKeihiReceiptPick_(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  onKeihiReceiptFile_(file);
}

function onKeihiReceiptFile_(file) {
  var status = document.getElementById('keihi-receipt-status');
  var preview = document.getElementById('keihi-receipt-preview');
  if (status) { status.textContent = '読み込み中…'; status.className = 'img-status'; }
  resizeImage_(file, 1600, 0.85).then(function(dataUrl){
    if (status) status.textContent = 'アップロード中…';
    return fetch('/api/keihi/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: dataUrl, name: STATE.userName || '' })
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
    .then(function(res){
      if (!res.ok || !res.body || !res.body.url) throw new Error((res.body && res.body.error) || 'アップロード失敗');
      var url = res.body.url;
      KEIHI_DRAFT.receiptUrl = url;
      if (preview) {
        var safeUrl = esc(url).replace(/\'/g,"\\'");
        preview.outerHTML = '<button type="button" id="keihi-receipt-preview" class="img-preview" onclick="openImageModal_(\'' + safeUrl + '\')"><img src="' + esc(normalizeDriveUrl_(url)) + '" alt=""></button>';
      }
      if (status) { status.textContent = '✓ アップロード完了'; status.className = 'img-status success'; }
    });
  }).catch(function(err){
    if (status) { status.textContent = '✗ ' + (err && err.message || 'エラー'); status.className = 'img-status error'; }
  });
}

async function onKeihiReceiptPaste_() {
  var status = document.getElementById('keihi-receipt-status');
  if (!navigator.clipboard || !navigator.clipboard.read) {
    if (status) { status.textContent = 'このブラウザは貼り付けに非対応'; status.className = 'img-status error'; }
    return;
  }
  try {
    var items = await navigator.clipboard.read();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var imgType = (item.types || []).find(function(t){ return t.indexOf('image/') === 0; });
      if (imgType) {
        var blob = await item.getType(imgType);
        var ext = imgType.split('/')[1] || 'png';
        var file = new File([blob], 'pasted-' + Date.now() + '.' + ext, { type: imgType });
        onKeihiReceiptFile_(file);
        return;
      }
    }
    if (status) { status.textContent = 'クリップボードに画像なし（先にスクショをコピー）'; status.className = 'img-status error'; }
  } catch(e) {
    if (status) { status.textContent = '貼付エラー: ' + (e && e.message || e); status.className = 'img-status error'; }
  }
}

function onKeihiReceiptPasteEvent_(ev) {
  var cd = ev && ev.clipboardData;
  if (!cd || !cd.items) return;
  for (var i = 0; i < cd.items.length; i++) {
    var it = cd.items[i];
    if (it.kind === 'file' && it.type.indexOf('image/') === 0) {
      var file = it.getAsFile();
      if (file) {
        ev.preventDefault();
        onKeihiReceiptFile_(file);
        return;
      }
    }
  }
}

function onKeihiGaichuInput_() {
  var g = parseInt((document.getElementById('keihi-gaichu') || {}).value, 10) || 0;
  var itemLabel = document.getElementById('keihi-item-label');
  var amountLabel = document.getElementById('keihi-amount-label');
  if (g > 0) {
    var item = document.getElementById('keihi-item');
    if (item && !item.value) item.value = '外注費';
    if (itemLabel) itemLabel.textContent = '商品名';
    if (amountLabel) amountLabel.textContent = '購入金額（円）';
  } else {
    if (itemLabel) itemLabel.textContent = '商品名 *';
    if (amountLabel) amountLabel.textContent = '購入金額（円） *';
  }
}

async function submitKeihiForm_() {
  var gaichu = parseInt((document.getElementById('keihi-gaichu') || {}).value, 10) || 0;
  var itemName = String((document.getElementById('keihi-item') || {}).value || '').trim();
  var amount = parseInt((document.getElementById('keihi-amount') || {}).value, 10) || 0;
  if (gaichu > 0) {
    if (!itemName) itemName = '外注費';
  }
  var payload = {
    name: STATE.userName,
    purchaseDate: String((document.getElementById('keihi-date') || {}).value || ''),
    itemName: itemName,
    place: String((document.getElementById('keihi-place') || {}).value || '').trim(),
    placeLink: String((document.getElementById('keihi-link') || {}).value || '').trim(),
    amount: amount,
    outsourceCost: gaichu,
    receipt: String(KEIHI_DRAFT.receiptUrl || '').trim()
  };
  if (!payload.itemName) { toast('商品名を入力してください', 'error'); return; }
  if (gaichu <= 0 && !payload.amount) { toast('金額を入力してください', 'error'); return; }
  var btn = document.getElementById('keihi-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
  try {
    await api('/api/keihi/submit', { method: 'POST', body: payload });
    toast('申請しました');
    // 楽観的更新: GAS のシート書き込みは裏で進行中なので、キャッシュに即時追加して
    // 一覧を即時更新する（fetch を待たない）
    var cached = TAB_CACHE['business|keihi'];
    if (cached && cached.data && cached.data.headers) {
      var hd = cached.data.headers;
      var now = new Date();
      function pad(n){ return n < 10 ? '0' + n : '' + n; }
      var tsStr = now.getFullYear() + '/' + pad(now.getMonth()+1) + '/' + pad(now.getDate()) +
                  ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      var newRow = hd.map(function(h){
        switch (h) {
          case 'タイムスタンプ': return tsStr;
          case '名前': return STATE.userName;
          case '購入日': return payload.purchaseDate;
          case '外注費': return payload.outsourceCost > 0 ? payload.outsourceCost : '';
          case '商品名': return payload.itemName;
          case '購入場所': return payload.place;
          case '購入場所リンク': return payload.placeLink;
          case '購入金額': return payload.amount || '';
          case '購入証明のためのレシートやスクショ': return payload.receipt;
          default: return '';
        }
      });
      cached.data.rows.unshift(newRow);
      cached.fetchedAt = Date.now();
    }
    STATE.view = 'list';
    if (cached) paintKeihi_(cached.data);
    else await renderKeihiTab_();
  } catch (err) {
    toast('申請失敗: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '申請する'; }
  }
}

// ---------- 報酬確認 ----------
async function renderHoushuTab_() {
  if (STATE.tab !== 'business' || STATE.business !== 'houshu' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var cached = TAB_CACHE['business|houshu'];
  if (cached) paintHoushu_(cached.data);
  else c.innerHTML = '<div class="loading">読み込み中…</div>';
  try {
    var data = await fetchBusinessSheet_('houshu');
    paintHoushu_(data);
  } catch (e) {
    if (!cached) c.innerHTML = '<div class="error">読み込み失敗: ' + esc(e.message) + '</div>';
  }
}

function paintHoushu_(data) {
  if (STATE.tab !== 'business' || STATE.business !== 'houshu' || STATE.view !== 'list') return;
  var c = document.getElementById('content');
  var headers = data.headers || [];
  // 報酬管理シートの2行目はサブヘッダー（"名前" 等の文字列が再掲）。データ段階で除外。
  var rows = (data.rows || []).filter(function(r){
    var nm = String((r && r[1]) || '').trim();
    return nm && nm !== '名前';
  });
  // 報酬管理: A=年月, B=名前, C=メール, D=撮影, E=採寸, F=出品, G=発送,
  //          H=在庫管理, I=アカウント運用, J=経費, K=利益歩合, L=固定費, M=月ブロック奇偶マーカー
  // 件数は staff_listSagyousha の monthly から拾う（D=撮影なので counts.satsuei 等の対応に注意）。
  var iMonth = colIdx_(headers, '月');
  var iName  = colIdx_(headers, '名前');
  if (iMonth < 0 || iName < 0) {
    iMonth = 0; iName = 1;
  }
  // 管理者は全員の報酬を閲覧可能。selectedName で絞り込み（'__all__' なら全員）。
  var isAdmin = !!STATE.isAdmin;
  if (isAdmin && !STATE.houshuSelectedName) STATE.houshuSelectedName = STATE.userName || '__all__';
  var selected = isAdmin ? STATE.houshuSelectedName : STATE.userName;
  var mine;
  if (isAdmin && selected === '__all__') {
    mine = rows.slice();
  } else if (isAdmin) {
    mine = rows.filter(function(r){ return String(r[iName] || '').trim() === String(selected || '').trim(); });
  } else {
    mine = rows.filter(function(r){ return nameMatchesSelf_(r[iName]); });
  }
  mine.sort(function(a, b){
    var ma = String(a[iMonth] || ''); var mb = String(b[iMonth] || '');
    if (ma !== mb) return ma < mb ? 1 : -1;
    // 同月内では名前順（管理者の全員表示時に安定）
    var na = String(a[iName] || ''); var nb = String(b[iName] || '');
    return na < nb ? -1 : (na > nb ? 1 : 0);
  });
  // 件数データ（staff_listSagyousha で取得済み）。 monthly のキーは "YYYY-MM"
  var workersByName = {};
  (STATE.allWorkers || []).forEach(function(w){ workersByName[String(w.name || '')] = w; });
  var meWorker = workersByName[STATE.userName];
  var defaultMonthly = (meWorker && meWorker.monthly) || {};
  function ymKey_(v){
    var s = String(v || '').trim();
    // "YYYY/MM" / "YYYY-MM" / "YYYY/M" すべて "YYYY-MM" 形式に正規化
    var m = s.match(/^(\d{4})[\/\-](\d{1,2})/);
    if (!m) return s;
    return m[1] + '-' + ('0' + m[2]).slice(-2);
  }
  function num_(v){
    if (v == null || v === '') return 0;
    var s = String(v).replace(/[^\d\.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function fmt_(n){
    if (!n) return '¥0';
    return '¥' + Number(n).toLocaleString('ja-JP');
  }
  // 1セル: ラベル＋金額（任意で件数バッジ・¥0 dim・特殊スタイル）
  function cell_(label, yen, opts){
    opts = opts || {};
    var dim = (yen === 0 && !opts.always) ? ' is-zero' : '';
    var extra = opts.cls ? (' ' + opts.cls) : '';
    var title = opts.title ? (' title="' + esc(opts.title) + '"') : '';
    var badge = '';
    if (typeof opts.count === 'number') {
      // (15件) と単価 @¥XXX を併記。¥0 や 0件のときは省略。
      var unit = (opts.count > 0 && yen > 0) ? Math.round(yen / opts.count) : 0;
      var unitTxt = unit ? ' @¥' + Number(unit).toLocaleString('ja-JP') : '';
      if (opts.count > 0) badge = '<small class="houshu-count">' + opts.count + '件' + unitTxt + '</small>';
    }
    return '<div class="' + (dim + extra).trim() + '"' + title + '>' +
      '<span class="h-label">' + esc(label) + badge + '</span>' +
      '<b>' + fmt_(yen) + '</b>' +
    '</div>';
  }
  // 1行を解析して内訳と件数を返す
  function parseRow_(r){
    var month = String(r[iMonth] || '');
    var rowName = String(r[iName] || '').trim();
    // 報酬管理シートの列: D=撮影, E=採寸, F=出品, G=発送, H=在庫管理,
    //                    I=アカウント運用, J=立替経費精算, K=利益歩合, L=固定費
    var v = {
      satsuei: num_(r[3]), sokutei: num_(r[4]), shuppin: num_(r[5]), hassou: num_(r[6]),
      inv: num_(r[7]), account: num_(r[8]), keihi: num_(r[9]), rieki: num_(r[10]), fixed: num_(r[11])
    };
    var counts = ((workersByName[rowName] && workersByName[rowName].monthly) || defaultMonthly)[ymKey_(month)]
      || { sokutei: 0, satsuei: 0, shuppin: 0, hassou: 0 };
    // AppSheet [合計] と同義: 利益歩合(rieki)を除く全項目の合計
    v.workTotal = v.satsuei + v.sokutei + v.shuppin + v.hassou + v.inv + v.account + v.keihi + v.fixed;
    v.profitShare = v.rieki;
    // 支払ルール: MAX(合計, 利益歩合) を実支払額とする
    v.actualPay = Math.max(v.workTotal, v.profitShare);
    v.profitWins = v.profitShare > v.workTotal;
    v.workWins = v.workTotal > v.profitShare;
    // 既存サマリ集計用: 集計バーや人別合計は実支払額ベース
    v.total = v.actualPay;
    return { month: month, name: rowName, v: v, counts: counts };
  }
  // 1枚の月カード
  function renderCard_(r){
    var p = parseRow_(r);
    var workCls = p.v.profitWins ? 'is-loser' : '';
    var rieCls  = p.v.profitWins ? 'is-winner' : (p.v.workWins ? 'is-loser' : '');
    var hasCompare = (p.v.workTotal > 0 || p.v.profitShare > 0);
    var vsHtml = '';
    if (hasCompare) {
      var lTxt = '<span class="vs-side ' + (p.v.workWins ? 'vs-win' : (p.v.profitWins ? 'vs-lose' : '')) + '">合計 ' + fmt_(p.v.workTotal) + '</span>';
      var rTxt = '<span class="vs-side ' + (p.v.profitWins ? 'vs-win' : (p.v.workWins ? 'vs-lose' : '')) + '">利益歩合 ' + fmt_(p.v.profitShare) + '</span>';
      vsHtml = '<div class="houshu-pay-vs" title="高い方が実支払額として採用されます">' +
        lTxt + '<span class="vs-arrow">vs</span>' + rTxt +
        '<span class="vs-note">高い方を採用</span>' +
      '</div>';
    }
    return '<div class="houshu-card">' +
      '<div class="houshu-month">' + esc(p.month) + ' <span style="color:var(--text-mute);font-weight:500">実支払額</span></div>' +
      '<div class="houshu-total">' + fmt_(p.v.actualPay) + '</div>' +
      vsHtml +
      '<div class="houshu-section"><div class="houshu-grid">' +
        cell_('撮影', p.v.satsuei, { count: p.counts.satsuei, cls: workCls }) +
        cell_('採寸', p.v.sokutei, { count: p.counts.sokutei, cls: workCls }) +
        cell_('出品', p.v.shuppin, { count: p.counts.shuppin, cls: workCls }) +
        cell_('発送', p.v.hassou,  { count: p.counts.hassou,  cls: workCls }) +
      '</div></div>' +
      '<div class="houshu-section"><div class="houshu-grid">' +
        cell_('在庫管理', p.v.inv,     { cls: workCls }) +
        cell_('アカウント運用', p.v.account, { cls: workCls }) +
        cell_('利益歩合', p.v.rieki,   { cls: rieCls, always: p.v.profitWins }) +
        cell_('固定費', p.v.fixed,     { cls: workCls }) +
      '</div></div>' +
      (p.v.keihi ? '<div class="houshu-section"><div class="houshu-grid">' +
        cell_('立替経費精算', p.v.keihi, { cls: 'is-credit' + (workCls ? ' ' + workCls : ''), always: true,
          title: '本人が立替えた経費を報酬と一緒に返金する分（合計に含む / 利益歩合採用時は対象外）' }) +
      '</div></div>' : '') +
    '</div>';
  }

  var html = '<div class="biz-wrap">';
  // 管理者: 名前フィルタ＋"全員"。一般: 自分の名前のみ。
  // 直近12ヶ月に報酬実績(>0)がある名前のみを候補にする（サブヘッダー行の "名前" 等も自動排除）
  if (isAdmin) {
    var now = new Date();
    var cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    var cutoffKey = cutoff.getFullYear() + '-' + ('0' + (cutoff.getMonth() + 1)).slice(-2);
    var totalsByName = {};
    rows.forEach(function(r){
      var n = String(r[iName] || '').trim();
      if (!n || n === '名前') return;
      var ymk = ymKey_(r[iMonth]);
      if (!ymk || ymk < cutoffKey) return;
      var t = num_(r[3]) + num_(r[4]) + num_(r[5]) + num_(r[6])
            + num_(r[7]) + num_(r[8]) + num_(r[9]) + num_(r[10]) + num_(r[11]);
      totalsByName[n] = (totalsByName[n] || 0) + t;
    });
    // 現在選択中の人は実績0でも候補に残す（選択肢から消えると操作不能になる）
    if (selected && selected !== '__all__' && !(selected in totalsByName)) totalsByName[selected] = 0;
    var nameOptions = '<option value="__all__"' + (selected === '__all__' ? ' selected' : '') + '>全員</option>';
    Object.keys(totalsByName).filter(function(n){ return totalsByName[n] > 0 || n === selected; }).sort().forEach(function(n){
      var sel = (n === selected) ? ' selected' : '';
      nameOptions += '<option value="' + esc(n) + '"' + sel + '>' + esc(n) + '</option>';
    });
    html += '<div class="biz-meta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
      '<span style="font-weight:600;font-size:13px;color:var(--text)">報酬（管理者）</span>' +
      '<select id="houshu-name-filter" aria-label="スタッフ選択" ' +
        'onchange="onHoushuNameChange_(this.value)">' +
        nameOptions +
      '</select>' +
    '</div>';
  }

  if (mine.length === 0) {
    html += '<div class="empty" style="padding:24px">表示できる月の報酬がありません。</div>';
    html += '</div>';
    c.innerHTML = html;
    return;
  }

  // ── 集計バー（選択範囲の合計報酬・件数合計）
  var sumTotal = 0, sumSat = 0, sumSok = 0, sumShu = 0, sumHas = 0;
  var nameSet = {};
  mine.forEach(function(r){
    var p = parseRow_(r);
    sumTotal += p.v.total;
    sumSat += p.counts.satsuei || 0;
    sumSok += p.counts.sokutei || 0;
    sumShu += p.counts.shuppin || 0;
    sumHas += p.counts.hassou  || 0;
    if (p.name) nameSet[p.name] = true;
  });
  var nameCount = Object.keys(nameSet).length;
  var summaryLabel;
  if (isAdmin && selected === '__all__') {
    summaryLabel = '全員 実支払額合計（' + nameCount + '名 × ' + mine.length + '行 / max(合計, 利益歩合)）';
  } else {
    var who = isAdmin ? selected : STATE.userName;
    summaryLabel = esc(who) + ' さんの実支払額合計（' + mine.length + 'ヶ月分 / max(合計, 利益歩合)）';
  }
  html += '<div class="houshu-summary">' +
    '<div class="s-label">' + summaryLabel + '</div>' +
    '<div class="s-total">' + fmt_(sumTotal) + '</div>' +
    '<div class="s-counts">' +
      '<span>撮影<b>' + sumSat + '</b>件</span>' +
      '<span>採寸<b>' + sumSok + '</b>件</span>' +
      '<span>出品<b>' + sumShu + '</b>件</span>' +
      '<span>発送<b>' + sumHas + '</b>件</span>' +
    '</div>' +
  '</div>';

  html += '<div class="houshu-list">';
  if (isAdmin && selected === '__all__') {
    // 人ベースで group: 名前見出し → その人の月カード
    var byName = {};
    mine.forEach(function(r){
      var nm = String(r[iName] || '').trim();
      if (!nm) return;
      (byName[nm] = byName[nm] || []).push(r);
    });
    Object.keys(byName).sort().forEach(function(nm){
      var rs = byName[nm];
      // その人の合計
      var personTotal = 0;
      rs.forEach(function(r){ personTotal += parseRow_(r).v.total; });
      html += '<div class="houshu-group-name">' + esc(nm) +
        '<small>合計 ' + fmt_(personTotal) + ' / ' + rs.length + 'ヶ月</small>' +
      '</div>';
      rs.forEach(function(r){ html += renderCard_(r); });
    });
  } else {
    mine.forEach(function(r){ html += renderCard_(r); });
  }
  html += '</div>';

  html += '</div>';
  c.innerHTML = html;
}

function onHoushuNameChange_(name) {
  STATE.houshuSelectedName = name || '__all__';
  var cached = TAB_CACHE['business|houshu'];
  if (cached && cached.data) paintHoushu_(cached.data);
}

function renderDenied() {
  stopPolling();
  document.getElementById('content').innerHTML =
    '<div class="denied">' +
      '<h2>アクセス権限がありません</h2>' +
      '<p>許可されたGoogleアカウントでサインインしてください。</p>' +
      '<p style="margin-top:16px;font-size:13px">あなたのアカウント: <strong>' + esc(STATE.email || '未取得') + '</strong></p>' +
    '</div>';
}

// ========== アイコン（発送方法 / 性別） ==========
// 発送方法の値から運送会社を判定（郵便系 / ヤマト系 / 不明）
function shipMethodCarrier_(value) {
  var s = String(value || '');
  if (!s) return '';
  // 郵便: ゆうパケット/ゆうパック/ポスト便/普通郵便/レターパック/定形/スマートレター
  if (/ゆう|郵便|レターパック|定形|定型|スマートレター|クリック|ポスト便|ぱけっとぽすと|ぱけぽす/i.test(s)) return 'post';
  // ヤマト: 宅急便/らくらく/ネコポス/コンパクト/EAZY/EASY
  if (/ヤマト|宅急|らくらく|ネコポス|コンパクト|EAZY|EASY|やまと/i.test(s)) return 'yamato';
  return '';
}
// 〒（日本郵便） / クロネコヤマト の SVG。シンプルな黒猫シルエット風。
function shipMethodIconHtml_(value) {
  var c = shipMethodCarrier_(value);
  if (c === 'post') {
    // 〒 マークを赤地白抜き
    return '<span class="field-icon is-post" title="郵便系" aria-label="郵便">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="2" y="3" width="20" height="18" rx="3" fill="#e60012"/>' +
        '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="\'Hiragino Kaku Gothic ProN\',\'Yu Gothic\',sans-serif">〒</text>' +
      '</svg></span>';
  }
  if (c === 'yamato') {
    // 黒猫が子猫をくわえているシルエット（簡易）
    return '<span class="field-icon is-yamato" title="クロネコヤマト" aria-label="ヤマト">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        // 親猫の体
        '<ellipse cx="9" cy="14.5" rx="6.5" ry="4.2" fill="#111"/>' +
        // 親猫の頭
        '<circle cx="6" cy="11" r="3" fill="#111"/>' +
        // 耳
        '<polygon points="3.6,8.5 4.2,5.6 6.5,8.4" fill="#111"/>' +
        '<polygon points="6.5,8.4 8,5.6 8.5,8.6" fill="#111"/>' +
        // しっぽ
        '<path d="M15 13.5 q 4 -2 5.5 1.5" stroke="#111" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
        // 子猫（くわえている）
        '<ellipse cx="10" cy="11.4" rx="2.2" ry="1.4" fill="#111"/>' +
        '<polygon points="8.4,10.4 8.6,9 9.6,10.4" fill="#111"/>' +
      '</svg></span>';
  }
  return '<span class="field-icon is-empty" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M3 7h13l5 5v5h-2a3 3 0 1 1-6 0H10a3 3 0 1 1-6 0H3V7z" fill="none" stroke="#999" stroke-width="1.5"/></svg>' +
    '</span>';
}

// 性別アイコン（メンズ/レディース/キッズ/ユニセックス）
function genderIconHtml_(value) {
  var s = String(value || '');
  if (s === 'メンズ' || s === '男性') {
    return '<span class="field-icon is-male" title="メンズ" aria-label="男性">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="10" cy="14" r="5" fill="none" stroke="#1565c0" stroke-width="2"/>' +
        '<path d="M14 10 L20 4 M15 4h5v5" fill="none" stroke="#1565c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>';
  }
  if (s === 'レディース' || s === '女性') {
    return '<span class="field-icon is-female" title="レディース" aria-label="女性">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="9" r="5" fill="none" stroke="#d63384" stroke-width="2"/>' +
        '<path d="M12 14v7 M9 18h6" stroke="#d63384" stroke-width="2" stroke-linecap="round"/>' +
      '</svg></span>';
  }
  if (s === 'キッズ') {
    return '<span class="field-icon is-kid" title="キッズ" aria-label="キッズ">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="8" r="3.4" fill="none" stroke="#3e8f25" stroke-width="2"/>' +
        '<path d="M7 21v-5a5 5 0 0 1 10 0v5" fill="none" stroke="#3e8f25" stroke-width="2" stroke-linecap="round"/>' +
      '</svg></span>';
  }
  if (s === 'ユニセックス') {
    return '<span class="field-icon is-uni" title="ユニセックス" aria-label="ユニセックス">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="4" fill="none" stroke="#6f42c1" stroke-width="2"/>' +
        '<path d="M16 9 L20 5 M17 5h3v3" fill="none" stroke="#6f42c1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M12 16v5 M9 19h6" fill="none" stroke="#6f42c1" stroke-width="2" stroke-linecap="round"/>' +
      '</svg></span>';
  }
  return '<span class="field-icon is-empty" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="none" stroke="#999" stroke-width="1.5"/></svg>' +
    '</span>';
}

// select 変更時に同フィールドのアイコンを差し替える
function updateFieldIcon_(selectEl, kind) {
  if (!selectEl) return;
  var slot = document.getElementById(selectEl.id + '_ico');
  if (!slot) return;
  var v = selectEl.value || '';
  slot.innerHTML = (kind === 'shipmethod') ? shipMethodIconHtml_(v) : genderIconHtml_(v);
  // インナー span はフォントサイズ等を継承するためそのまま、wrapper はそのまま
}

// 仕入れ日 等の日付 readonly 表示用フォーマッタ（ISO の T 以降を落として yyyy-MM-dd に）
function fmtReadonlyDate_(v) {
  var s = String(v == null ? '' : v);
  if (!s) return '';
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return s;
}

// 詳細画面 前後ナビ — 直前に開いていた一覧の並び順を使う
// STATE.items（商品/発送/売上タブ） を最優先、次に STATE.currentShiireProducts（仕入れ詳細）を見る
function detailNavList_() {
  var cur = STATE.current && STATE.current.kanri;
  if (!cur) return [];
  var lists = [
    Array.isArray(STATE.items) ? STATE.items : [],
    Array.isArray(STATE.currentShiireProducts) ? STATE.currentShiireProducts : []
  ];
  for (var k = 0; k < lists.length; k++) {
    for (var j = 0; j < lists[k].length; j++) {
      if (lists[k][j].kanri === cur) return lists[k];
    }
  }
  return [];
}
function adjacentKanri_(direction) {
  var cur = STATE.current && STATE.current.kanri;
  if (!cur) return null;
  var arr = detailNavList_();
  if (!arr.length) return null;
  var idx = -1;
  for (var i = 0; i < arr.length; i++) { if (arr[i].kanri === cur) { idx = i; break; } }
  if (idx < 0) return null;
  var nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= arr.length) return null;
  return { kanri: arr[nextIdx].kanri, index: nextIdx, total: arr.length };
}
function gotoAdjacentDetail_(direction) {
  var info = adjacentKanri_(direction);
  if (!info) return;
  // dirty 状態なら確認
  if (STATE.detailDirty && diffCount_() > 0) {
    if (!confirm('未保存の変更があります。破棄して移動しますか？')) return;
    STATE.detailDirty = false;
  }
  openDetail(info.kanri);
}

// ========== 詳細 ==========
// 詳細キャッシュ: 一度開いたら即時再表示できるようにする（裏で /api/products/:kanri を再取得）
var DETAIL_CACHE = Object.create(null);
async function openDetail(kanri, opts) {
  opts = opts || {};
  STATE.view = 'detail';
  STATE.detailDirty = false;
  // 一覧から別の商品の詳細を開いたときは基本タブに戻す。
  // popState 経由（ブラウザ戻る/進む）は前回見ていたタブを保つため変更しない。
  if (!opts.fromPopState) {
    STATE.detailSecTab = 'basic';
    try {
      var st = history.state;
      if (!st || st.view !== 'detail' || st.kanri !== kanri) {
        history.pushState({ view: 'detail', kanri: kanri }, '', '');
      }
    } catch(e) {}
  }
  document.getElementById('appbar-title').textContent = kanri;
  var cached = DETAIL_CACHE[kanri];
  if (cached) {
    STATE.current = cached;
    if (STATE.mastersPromise) { try { await STATE.mastersPromise; } catch(e){} }
    renderDetail();
  } else {
    document.getElementById('content').innerHTML = '<div class="loading">読み込み中…</div>';
  }
  try {
    const [res] = await Promise.all([
      api('/api/products/' + encodeURIComponent(kanri)),
      STATE.mastersPromise || Promise.resolve(),
    ]);
    // 旧 extra と新 extra を比較し、消えた/変わった画像パスの sessionStorage 解決キャッシュを破棄
    // → シートで画像を削除/差し替えても古い解決URLが残らない
    try { invalidateRemovedImagePaths_(cached && cached.extra, res.item && res.item.extra); } catch(e) {}
    DETAIL_CACHE[kanri] = res.item;
    // フォーム入力中（dirty）は再描画でユーザー入力を消さない
    if (STATE.view === 'detail' && !STATE.detailDirty) {
      STATE.current = res.item;
      renderDetail();
    }
  } catch (err) {
    if (!cached) {
      document.getElementById('content').innerHTML = '<div class="empty" style="color:#c62828">' + esc(err.message) + '</div>';
    }
  }
}

// extra の各値のうち画像パス（相対 商品管理_Images/... or Drive URL）に見えるものを抽出
function collectImagePaths_(extra) {
  var out = new Set();
  if (!extra || typeof extra !== 'object') return out;
  for (var k in extra) {
    var v = extra[k];
    if (!v || typeof v !== 'string') continue;
    if (/^商品管理_Images\//.test(v) || /^https?:\/\/drive\.google\.com\//.test(v)) {
      out.add(v);
    }
  }
  return out;
}

// 旧 extra にあって新 extra にない画像パスの sessionStorage キャッシュを削除
function invalidateRemovedImagePaths_(oldExtra, newExtra) {
  var oldPaths = collectImagePaths_(oldExtra);
  if (!oldPaths.size) return;
  var newPaths = collectImagePaths_(newExtra);
  oldPaths.forEach(function(p) {
    if (newPaths.has(p)) return; // 同じパスがまだ使われている
    try { sessionStorage.removeItem('imgresolve:v2:' + p); } catch(e) {}
  });
}

function detailFieldId(name) {
  return 'f_' + name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); });
}

function detailValue(d, name) {
  // 編集値（kanri 単位の edits バケット）があれば最優先（タブ切替やリロードで復元）
  var edits = getDetailEdits_(d.kanri);
  if (edits && Object.prototype.hasOwnProperty.call(edits, name)) {
    return edits[name];
  }
  var ex = d.extra || {};
  if (ex[name] !== undefined && ex[name] !== '') return ex[name];
  // ステータスは extra が空でも raw/派生から確実に補完する
  // （補完しないと select の初期値が先頭オプション「採寸待ち」になり、
  //   発送済み/発送待ち商品の詳細を開いたときに採寸待ち表示の事故を起こす）
  if (name === 'ステータス') {
    var rawSt = d.rawStatus || '';
    var derivedSt = d.status || '';
    if (rawSt === '発送待ち' || rawSt === '発送済み' || rawSt === '売却済み') return rawSt;
    if (derivedSt) return derivedSt;
    if (rawSt) return rawSt;
  }
  // measure_json から補完（extraにすでに同じキーで入っているはずだが念のため）
  var m = d.measure || {};
  if (m[name] !== undefined && m[name] !== null) return m[name];
  return '';
}

// クリアボタンを付与しないタイプ:
//  - readonly  : そもそも編集不可
//  - image     : 画像専用の ✕ ボタン (img-delete-btn) が既にある
//  - yesno     : トグル内の「—／詳細入力」ボタンでクリアできる
function fieldClearableType_(type) {
  return !(type === 'readonly' || type === 'image' || type === 'yesno');
}

// input HTML を ✕ ボタン付きラッパで包む。type が clear 不可なら素通し。
function fieldClearWrap_(input, fieldId, type) {
  if (!fieldClearableType_(type)) return input;
  return '<div class="field-input-wrap">' + input +
    '<button type="button" class="field-clear-btn" ' +
    'data-clear-target="' + fieldId + '" data-clear-type="' + (type || '') + '" ' +
    'aria-label="クリア" title="クリア" ' +
    'onclick="onFieldClearClick_(this)">✕</button>' +
    '</div>';
}

// ✕ ボタン 2 段タップ管理（fieldId → タイマーID）。画像削除と同じく 3 秒以内 2 回タップで実行。
var FIELD_CLEAR_ARMED_ = {};
function onFieldClearClick_(btn) {
  var fieldId = btn.getAttribute('data-clear-target');
  var type = btn.getAttribute('data-clear-type') || '';
  if (!fieldId) return;
  // 1 回目: arm のみ。3 秒以内にもう 1 回タップで実クリア。
  if (!FIELD_CLEAR_ARMED_[fieldId]) {
    btn.classList.add('armed');
    btn.title = 'もう一度タップでクリア（3秒以内）';
    FIELD_CLEAR_ARMED_[fieldId] = setTimeout(function(){
      delete FIELD_CLEAR_ARMED_[fieldId];
      btn.classList.remove('armed');
      btn.title = 'クリア';
    }, 3000);
    return;
  }
  // 2 回目: タイマー解除して即クリア
  clearTimeout(FIELD_CLEAR_ARMED_[fieldId]);
  delete FIELD_CLEAR_ARMED_[fieldId];
  btn.classList.remove('armed');
  btn.title = 'クリア';
  performFieldClear_(fieldId, type);
}

// 入力要素の値を空にして input/change を発火（dirty 判定・サマリ再計算・アイコン更新を駆動）
function performFieldClear_(fieldId, type) {
  var el = document.getElementById(fieldId);
  if (!el) return;
  var tag = (el.tagName || '').toLowerCase();
  el.value = '';
  // select で value='' option が無い場合は先頭 option にフォールバック
  if (tag === 'select' && el.value !== '') {
    var hit = false;
    for (var i = 0; i < el.options.length; i++) {
      if (el.options[i].value === '') { el.selectedIndex = i; hit = true; break; }
    }
    if (!hit) el.selectedIndex = 0;
  }
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
}

function fieldRowHtml(name, type, val) {
  var id = detailFieldId(name);
  var v = (val == null) ? '' : val;
  var input;
  if (type === 'readonly') {
    // 仕入れ日 等の Date 由来 readonly は ISO の T 以降を落として日付のみ表示
    var ro = (name === '仕入れ日') ? fmtReadonlyDate_(v) : v;
    // ID を付与して wireSaleCalcResults_ から textContent を即時更新できるようにする
    input = '<div class="field-readonly" id="' + id + '">' + esc(ro) + '</div>';
  } else if (type === 'textarea') {
    input = '<textarea id="' + id + '" class="auto-grow" rows="2">' + esc(v) + '</textarea>';
  } else if (type === 'number') {
    input = '<input type="number" inputmode="decimal" enterkeyhint="next" step="0.1" id="' + id + '" value="' + esc(v) + '">';
  } else if (type === 'color') {
    var setOptsColor = settingsOptionsFor_(name, v);
    if (setOptsColor) {
      input = '<select id="' + id + '">' + setOptsColor + '</select>';
    } else {
      input = '<select id="' + id + '">' + masterOptionsHtml_(COLOR_OPTIONS, v) + '</select>';
    }
  } else if (type === 'yesno') {
    input = yesNoToggleHtml_(id, v, name);
  } else if (type === 'date') {
    var dv = '';
    if (v) {
      var s = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) dv = s.slice(0, 10);
      else { var d = new Date(s); if (!isNaN(d.getTime())) dv = d.toISOString().slice(0, 10); }
    }
    input = '<input type="date" id="' + id + '" value="' + esc(dv) + '" onfocus="onDateFieldFocus_(this)">';
  } else if (type === 'url') {
    var safe = esc(v);
    var link = v ? ' <a href="' + safe + '" target="_blank" rel="noopener" style="font-size:12px;margin-left:8px;color:#1565c0">開く</a>' : '';
    input = '<input type="url" id="' + id + '" value="' + safe + '">' + link;
  } else if (type === 'image') {
    input = imageFieldHtml_(id, name, v);
  } else if (type === 'status') {
    // 値が空もしくは候補外の場合: 先頭にプレースホルダー option を入れ、
    // 既存値を消さずに表示する。これにより空時に「採寸待ち」が誤選択される事故を防ぐ。
    var curStatus = String(v == null ? '' : v);
    var hasCur = STATUS_OPTIONS.indexOf(curStatus) >= 0;
    var leading = '';
    if (!hasCur) {
      leading = curStatus
        ? '<option value="' + esc(curStatus) + '" selected>' + esc(curStatus) + '</option>'
        : '<option value="" selected>—</option>';
    }
    var opts = STATUS_OPTIONS.map(function(o){
      return '<option value="' + esc(o) + '"' + (curStatus === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    input = '<select id="' + id + '">' + leading + opts + '</select>';
  } else if (type === 'gender') {
    var opts2 = GENDER_OPTIONS.map(function(o){
      return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
    }).join('');
    input = '<div class="field-with-icon">' +
      '<span id="' + id + '_ico" class="field-icon-slot">' + genderIconHtml_(v) + '</span>' +
      '<select id="' + id + '" oninput="updateFieldIcon_(this,\'gender\')">' + opts2 + '</select>' +
    '</div>';
  } else if (type === 'salechannel') {
    var cur = String(v || '');
    var chList = getSaleChannelOptions_();
    var optsSc = '<option value=""' + (cur === '' ? ' selected' : '') + '>—</option>' +
      chList.map(function(o){
        return '<option value="' + esc(o) + '"' + (cur === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
    if (cur && chList.indexOf(cur) < 0) {
      optsSc += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    }
    input = '<select id="' + id + '" onchange="onSaleChannelChange_(this, \'' + id + '\')">' + optsSc + '</select>';
  } else if (type === 'bool') {
    // 表示は はい/いいえ、option value は TRUE/FALSE（シートにはそのまま TRUE/FALSE 文字列が渡る）
    // 重要: チェックボックスセルの値は Boolean false で来るため `v || ''` だと '' になって "—" 表示になり、
    // その後の syncEditsFromDom_ で擬似 dirty 化して保存時にセルが空で上書きされるバグの原因になる。
    // null/undefined のみ空、それ以外は String(v) で安全に判定する。
    var b = (v == null ? '' : String(v)).toUpperCase();
    var optsB = '<option value=""' + (b === '' ? ' selected' : '') + '>—</option>' +
      '<option value="TRUE"' + (b === 'TRUE' ? ' selected' : '') + '>はい</option>' +
      '<option value="FALSE"' + (b === 'FALSE' ? ' selected' : '') + '>いいえ</option>';
    input = '<select id="' + id + '">' + optsB + '</select>';
  } else if (type === 'shipmethod') {
    var setOptsShip = settingsOptionsFor_(name, v);
    var inner;
    if (setOptsShip) {
      inner = '<select id="' + id + '" oninput="updateFieldIcon_(this,\'shipmethod\')">' + setOptsShip + '</select>';
    } else {
      var opts3 = SHIP_METHOD_OPTIONS.map(function(o){
        return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
      }).join('');
      inner = '<select id="' + id + '" oninput="updateFieldIcon_(this,\'shipmethod\')">' + opts3 + '</select>';
    }
    input = '<div class="field-with-icon">' +
      '<span id="' + id + '_ico" class="field-icon-slot">' + shipMethodIconHtml_(v) + '</span>' +
      inner +
    '</div>';
  } else if (type === 'worker') {
    input = '<select id="' + id + '">' + masterOptionsHtml_(STATE.workers, v) + '</select>';
  } else if (type === 'account') {
    input = '<select id="' + id + '">' + masterOptionsHtml_(STATE.accounts, v) + '</select>';
  } else if (type === 'mercarisize') {
    input = mercariSizeSelectHtml_(id, v);
  } else if (type === 'category1') {
    input = '<select id="' + id + '">' + categoryOptionsHtml_(CATEGORY1_OPTIONS, v) + '</select>';
  } else if (type === 'category2') {
    var c1Cur = (STATE.current && STATE.current.extra && STATE.current.extra['カテゴリ1']) || '';
    input = '<select id="' + id + '">' + categoryOptionsHtml_(category2OptionsFor_(c1Cur), v) + '</select>';
  } else if (type === 'category3') {
    var c1Cur3 = (STATE.current && STATE.current.extra && STATE.current.extra['カテゴリ1']) || '';
    var c2Cur3 = (STATE.current && STATE.current.extra && STATE.current.extra['カテゴリ2']) || '';
    input = '<select id="' + id + '">' + categoryOptionsHtml_(category3OptionsFor_(c1Cur3, c2Cur3), v) + '</select>';
  } else {
    var setOpts = settingsOptionsFor_(name, v);
    if (setOpts) {
      input = '<select id="' + id + '">' + setOpts + '</select>';
    } else {
      input = '<input type="text" id="' + id + '" value="' + esc(v) + '">';
    }
  }
  var labelHtml = '<label>' + esc(name) +
    (type === 'mercarisize' ? ' <button type="button" class="size-help-btn" onclick="openMercariSizeHelp_()" aria-label="サイズ変換表" title="サイズ変換表">?</button>' : '') +
    '</label>';
  return '<div class="field-row">' + labelHtml + fieldClearWrap_(input, id, type) + '</div>';
}

// カラー固定リスト（設定シートのカラー1列が空のときのフォールバック）
var COLOR_OPTIONS = [
  '黒','白','グレー','ベージュ','ブラウン','ネイビー','ブルー',
  'グリーン','カーキ','イエロー','オレンジ','レッド','ピンク',
  'パープル','シルバー','ゴールド','マルチカラー','その他'
];

// あり/なし トグルボタン HTML（透け感・ポケット用）
// fieldName が 'ポケット' のときは 3 つ目のボタンを「詳細入力」にして
// 同セクションの「ポケット詳細」textarea にフォーカスさせる
function yesNoToggleHtml_(id, current, fieldName) {
  var cur = String(current || '').trim();
  var isYes = (cur === 'あり' || cur === 'TRUE' || cur === 'true' || cur === 'YES' || cur === 'はい' || cur === 'Y');
  var isNo  = (cur === 'なし' || cur === 'FALSE' || cur === 'false' || cur === 'NO' || cur === 'いいえ' || cur === 'N');
  var isPocket = (fieldName === 'ポケット');
  var isDetail = isPocket && cur === '詳細入力';
  var val = isYes ? 'あり' : (isNo ? 'なし' : (isDetail ? '詳細入力' : ''));
  var thirdLabel = isPocket ? '詳細入力' : '—';
  var thirdVal = isPocket ? '詳細入力' : '';
  var thirdAttr = isPocket ? ' data-focus-field="ポケット詳細"' : ' title="クリア"';
  var thirdActive = isPocket ? isDetail : (!isYes && !isNo);
  return (
    '<div class="yesno-toggle" data-target="' + id + '">' +
      '<input type="hidden" id="' + id + '" value="' + esc(val) + '">' +
      '<button type="button" class="yesno-btn yesno-yes' + (isYes ? ' active' : '') + '" data-val="あり" onclick="onYesNoClick_(this)">あり</button>' +
      '<button type="button" class="yesno-btn yesno-no'  + (isNo  ? ' active' : '') + '" data-val="なし" onclick="onYesNoClick_(this)">なし</button>' +
      '<button type="button" class="yesno-btn yesno-clear' + (thirdActive ? ' active' : '') + '" data-val="' + esc(thirdVal) + '"' + thirdAttr + ' onclick="onYesNoClick_(this)">' + esc(thirdLabel) + '</button>' +
    '</div>'
  );
}

function onYesNoClick_(btn) {
  var wrap = btn.closest('.yesno-toggle');
  if (!wrap) return;
  var val = btn.getAttribute('data-val') || '';
  var focusField = btn.getAttribute('data-focus-field') || '';
  var hidden = wrap.querySelector('input[type="hidden"]');
  if (hidden) {
    hidden.value = val;
    try { hidden.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
  }
  // detail フォームでの dirty フラグを立てる（saveDetails が再描画でユーザー入力を上書きしない為）
  if (typeof STATE !== 'undefined' && wrap.querySelector('input[id^="f_"]')) {
    STATE.detailDirty = true;
  }
  Array.prototype.forEach.call(wrap.querySelectorAll('.yesno-btn'), function(b){
    b.classList.toggle('active', b === btn);
  });
  if (typeof updateSavebar_ === 'function') {
    try { updateSavebar_(); } catch(e) {}
  }
  // 詳細入力ボタン: 通常の値設定処理を行ったのち、関連 textarea にフォーカス
  if (focusField) {
    // 詳細編集（f_）と新規作成（cf_）の両方の prefix を順に試す
    var target = document.getElementById(detailFieldId(focusField));
    if (!target && typeof createFieldId_ === 'function') {
      target = document.getElementById(createFieldId_(focusField));
    }
    if (target) {
      try { target.focus(); } catch(e) {}
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
    }
  }
}

// textarea 自動拡張（rows 動的調整）— デザイン特徴・傷汚れ詳細など長文項目用
function autoGrowTextarea_(el) {
  if (!el) return;
  el.style.height = 'auto';
  // scrollHeight + 2 で枠線分の余白
  el.style.height = (el.scrollHeight + 2) + 'px';
}
document.addEventListener('input', function(e){
  if (e.target && e.target.tagName === 'TEXTAREA' && e.target.classList.contains('auto-grow')) {
    autoGrowTextarea_(e.target);
  }
});

// メルカリサイズ プルダウン HTML（現在値がリスト外でも保持）
var MERCARI_SIZE_OPTIONS = ['XS','S','M','L','XL','XXL','3L','4L','5L','FREE'];
function mercariSizeSelectHtml_(id, current) {
  var cur = current == null ? '' : String(current);
  var seen = {};
  var out = ['<option value=""' + (cur === '' ? ' selected' : '') + '>—</option>'];
  MERCARI_SIZE_OPTIONS.forEach(function(o){
    seen[o] = true;
    out.push('<option value="' + esc(o) + '"' + (cur === o ? ' selected' : '') + '>' + esc(o) + '</option>');
  });
  if (cur && !seen[cur]) {
    out.push('<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>');
  }
  return '<select id="' + id + '">' + out.join('') + '</select>';
}

// メルカリサイズ変換表モーダル（メンズ／レディース／メンズスーツ／キッズ をタブで切替）
function openMercariSizeHelp_() {
  var existing = document.getElementById('mercari-size-help-modal');
  if (existing) existing.remove();

  var ladiesRows = [
    ['XS', '5号', '32', '〜23'],
    ['S',  '7号', '34・36', '24〜25'],
    ['M',  '9号', '38', '26〜27'],
    ['L',  '11号', '40', '28〜29'],
    ['XL', '13号', '42', '30〜31'],
    ['XXL','15号〜', '44〜', '32〜']
  ];
  var mensRows = [
    ['S',  '36', '〜28'],
    ['M',  '38', '29〜30'],
    ['L',  '40', '31〜33'],
    ['XL', '42', '34〜36'],
    ['XXL','44', '37〜38'],
    ['3XL','46〜', '39〜']
  ];
  var suitRows = [
    ['S',  'Y4・A4', '身長 〜165cm'],
    ['M',  'Y5・A5・A6・AB5', '身長 170〜175cm'],
    ['L',  'A7・AB6・AB7・B5', '身長 175〜180cm'],
    ['XL', 'A8・B6・B7・BB5', '身長 180〜185cm'],
    ['XXL','BB6・BB7・E系', '太め＋身長180cm〜']
  ];
  var kidsRows = [
    ['80',  '80cm', '〜1歳'],
    ['90',  '90cm', '1〜2歳'],
    ['100', '100cm','3〜4歳'],
    ['110', '110cm','4〜5歳'],
    ['120', '120cm','6〜7歳'],
    ['130', '130cm','7〜9歳'],
    ['140', '140cm','9〜10歳'],
    ['150', '150cm','11〜12歳'],
    ['160', '160cm','12〜14歳']
  ];

  function tableHtml(headers, rows) {
    var ths = headers.map(function(h){
      return '<th style="padding:8px;border:1px solid #ddd;text-align:left">' + esc(h) + '</th>';
    }).join('');
    var trs = rows.map(function(r){
      var tds = r.map(function(c, i){
        return '<td style="padding:6px 8px;border:1px solid #ddd">' + (i === 0 ? '<strong>' + esc(c) + '</strong>' : esc(c)) + '</td>';
      }).join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<thead><tr style="background:#f5f5f5">' + ths + '</tr></thead>' +
      '<tbody>' + trs + '</tbody></table>';
  }

  var panels = {
    ladies: tableHtml(['メルカリ','号','EU','ウエストinch'], ladiesRows),
    mens:   tableHtml(['メルカリ','胸囲inch / 襟cm','ウエストinch'], mensRows),
    suit:   tableHtml(['メルカリ','スーツ表記','目安'], suitRows),
    kids:   tableHtml(['メルカリ','身長','年齢目安'], kidsRows)
  };

  var tabs = [
    { key: 'ladies', label: 'レディース' },
    { key: 'mens',   label: 'メンズ' },
    { key: 'suit',   label: 'メンズスーツ' },
    { key: 'kids',   label: 'キッズ' }
  ];
  var tabBtns = tabs.map(function(t, i){
    return '<button type="button" data-tab="' + t.key + '" ' +
      'style="flex:1;padding:8px 4px;border:none;background:' + (i === 0 ? '#1976d2' : '#eee') + ';' +
      'color:' + (i === 0 ? '#fff' : '#333') + ';font-weight:500;cursor:pointer;font-size:13px">' +
      esc(t.label) + '</button>';
  }).join('');
  var panelHtmls = tabs.map(function(t, i){
    return '<div data-panel="' + t.key + '" style="display:' + (i === 0 ? 'block' : 'none') + '">' + panels[t.key] + '</div>';
  }).join('');

  var html =
    '<div id="mercari-size-help-modal" class="modal-overlay" onclick="if(event.target===this)this.remove()">' +
      '<div class="modal-content" style="max-width:520px">' +
        '<div class="modal-header"><h3>メルカリサイズ 変換表</h3>' +
          '<button class="modal-close" onclick="document.getElementById(\'mercari-size-help-modal\').remove()">×</button></div>' +
        '<div class="modal-body">' +
          '<div style="display:flex;gap:1px;margin-bottom:12px;border-radius:4px;overflow:hidden">' + tabBtns + '</div>' +
          panelHtmls +
          '<p style="margin-top:12px;font-size:12px;color:#666">性別を選択した上でタグ表記を入力すると、この表に従って自動でメルカリサイズが選択されます。FREE/F/フリーは FREE、LL→XL、3L→XXL に変換されます。</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  var div = document.createElement('div');
  div.innerHTML = html;
  var modal = div.firstChild;
  document.body.appendChild(modal);

  modal.querySelectorAll('button[data-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.getAttribute('data-tab');
      modal.querySelectorAll('button[data-tab]').forEach(function(b){
        var active = b === btn;
        b.style.background = active ? '#1976d2' : '#eee';
        b.style.color = active ? '#fff' : '#333';
      });
      modal.querySelectorAll('div[data-panel]').forEach(function(p){
        p.style.display = (p.getAttribute('data-panel') === key) ? 'block' : 'none';
      });
    });
  });
}

// マスターリスト + 現在値（リスト外でも保持） + 空オプション
function masterOptionsHtml_(list, current) {
  var cur = current == null ? '' : String(current);
  var seen = {};
  var out = ['<option value=""' + (cur === '' ? ' selected' : '') + '>—</option>'];
  (list || []).forEach(function(name){
    var n = String(name || '');
    if (!n || seen[n]) return;
    seen[n] = true;
    out.push('<option value="' + esc(n) + '"' + (cur === n ? ' selected' : '') + '>' + esc(n) + '</option>');
  });
  if (cur && !seen[cur]) {
    out.push('<option value="' + esc(cur) + '" selected>' + esc(cur) + '（マスター外）</option>');
  }
  return out.join('');
}

// セクションタブ → DETAIL_SECTIONS のマッピング
var SEC_TABS = [
  { id: 'basic',    label: '基本',         sections: ['基本情報', '仕入れ（連動・読取専用）'] },
  { id: 'measure',  label: '採寸',         sections: ['採寸 (cm)', '採寸記録'] },
  { id: 'listing',  label: '撮影・出品',   sections: ['撮影・出品'] },
  { id: 'sale',     label: '販売',         sections: ['販売', '計算結果（読取専用）'] },
  { id: 'shipping', label: '発送',         sections: ['発送関係'] },
  { id: 'memo',     label: '備考',         sections: ['備考', 'その他'] }
];
function selectSecTab_(id) {
  if (id === STATE.detailSecTab) return;
  // セクションタブ切替前に現在の入力値を edits バケットに取り込み、
  // 戻ってきたとき detailValue が edits を優先して描画することで値を復元する
  syncEditsFromDom_();
  STATE.detailSecTab = id;
  renderDetail();
}
// 編集値の保持: kanri 単位で全フィールドの編集値を保持する。
// セクションタブ切替やボトムタブ移動で DOM が消えても、編集中の値が失われない。
// 同じ kanri の詳細を再度開くと detailValue が edits 値を優先して復元する。
function ensureDetailEdits_(kanri) {
  if (!STATE.detailEditsByKanri) STATE.detailEditsByKanri = {};
  if (!STATE.detailEditsByKanri[kanri]) STATE.detailEditsByKanri[kanri] = {};
  return STATE.detailEditsByKanri[kanri];
}
function getDetailEdits_(kanri) {
  return (STATE.detailEditsByKanri && STATE.detailEditsByKanri[kanri]) || null;
}
function clearDetailEdits_(kanri) {
  if (STATE.detailEditsByKanri) delete STATE.detailEditsByKanri[kanri];
}
// 現在表示中のセクションタブの DOM 値を edits バケットに同期する。
// input/change のたびに呼ぶことで、edits は常に最新の入力値を保持する。
function syncEditsFromDom_() {
  var d = STATE.current;
  if (!d) return;
  var edits = ensureDetailEdits_(d.kanri);
  DETAIL_SECTIONS.forEach(function(sec){
    sec.fields.forEach(function(f){
      var name = f[0], type = f[1];
      if (type === 'readonly' || type === 'image') return;
      var el = document.getElementById(detailFieldId(name));
      if (!el) return;
      edits[name] = el.value;
    });
  });
}
// 後方互換のためのエイリアス
function captureDetailEdits_() { syncEditsFromDom_(); }

// ========== 詳細離脱時の案内シート ==========
// 商品詳細を離脱するとき（一覧へ戻る／タブ切替／メニュー切替／ブラウザ戻る）に
// 未保存変更があれば、変更内容のサマリと「保存して移動／破棄して移動／このページにとどまる」を提示する。
// confirm ダイアログより情報量が多く、内容が見えるので UX が良い。
function confirmLeaveDetail_(onContinue, onCancel) {
  if (STATE.view !== 'detail' || !STATE.current) {
    onContinue();
    return;
  }
  syncEditsFromDom_();
  var dirty = getDirtyFields_();
  if (dirty.length === 0) {
    onContinue();
    return;
  }
  showLeaveSheet_(dirty, onContinue, onCancel);
}
function showLeaveSheet_(dirty, onContinue, onCancel) {
  var listEl = document.getElementById('leave-sheet-list');
  var cntEl = document.getElementById('leave-sheet-count');
  if (!listEl || !cntEl) { onContinue(); return; }
  var html = dirty.map(function(d){
    var before = d.before === '' || d.before == null ? '(空)' : esc(String(d.before));
    var after  = d.after  === '' || d.after  == null ? '(空)' : esc(String(d.after));
    return '<li><strong>' + esc(d.name) + '</strong>'
         + '<span class="before">' + before + '</span>'
         + '<span class="arr">→</span>'
         + '<span class="after">' + after + '</span></li>';
  }).join('');
  listEl.innerHTML = html;
  cntEl.textContent = String(dirty.length);
  STATE._leaveContinue = onContinue;
  STATE._leaveCancel = onCancel || null;
  STATE._leaveDirtyKanri = STATE.current ? STATE.current.kanri : null;
  document.getElementById('leave-sheet-mask').classList.add('show');
}
function closeLeaveSheet_() {
  var m = document.getElementById('leave-sheet-mask');
  if (m) m.classList.remove('show');
  STATE._leaveContinue = null;
  STATE._leaveCancel = null;
  STATE._leaveDirtyKanri = null;
}
async function leaveSheetSave_() {
  var btn = document.getElementById('leave-sheet-save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  var cb = STATE._leaveContinue;
  try {
    await saveDetails();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '保存して移動'; }
    return;
  }
  // 保存が成功（dirty=0）になったときだけ移動。失敗時はシート閉じてユーザーに任せる
  if (getDirtyFields_().length === 0) {
    closeLeaveSheet_();
    if (cb) cb();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '保存して移動'; }
  }
}
function leaveSheetDiscard_() {
  var k = STATE._leaveDirtyKanri;
  if (k) clearDetailEdits_(k);
  STATE.detailDirty = false;
  var cb = STATE._leaveContinue;
  closeLeaveSheet_();
  if (cb) cb();
}
function leaveSheetCancel_(ev) {
  // マスクの onclick から呼ばれた場合は中身クリックは無視（イベント上はこちらに来ない）
  var cancelCb = STATE._leaveCancel;
  closeLeaveSheet_();
  if (cancelCb) cancelCb();
}
// 日付/日時を表示用に整形。時刻成分があれば "YYYY-MM-DD HH:mm"、無ければ "YYYY-MM-DD"。
function fmtHistoryWhen_(raw) {
  if (raw == null) return '';
  var s = String(raw).trim();
  if (!s) return '';
  // ISO もしくは "YYYY/MM/DD HH:mm:ss" などを Date として解釈
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var hasTime = /[T\s]\d{1,2}:\d{2}/.test(s);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var datePart = y + '-' + m + '-' + dd;
    if (!hasTime) return datePart;
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return datePart + ' ' + hh + ':' + mi;
  }
  return s;
}

// extra から作業履歴を再構成（販売・発送・採寸・出品・撮影・仕入れ）
function buildHistoryHtml_(d) {
  var ex = d.extra || {};
  var ev = [];
  function add(date, who, text) {
    if (!date) return;
    var raw = String(date);
    // ソートキー（ISOに寄せる）と表示用（HH:mmまで）を分離
    ev.push({ key: raw, when: fmtHistoryWhen_(raw), who: who || '', text: text });
  }
  add(ex['仕入れ日'], ex['登録者'] || '', '仕入れ登録');
  add(ex['採寸日'], ex['採寸者'] || '', '採寸');
  add(ex['撮影日付'], ex['撮影者'] || '', '撮影');
  add(ex['出品日'], ex['出品者'] || '', '出品');
  add(ex['販売日'], '', '販売（' + (ex['販売価格'] ? '¥' + ex['販売価格'] : '価格未入力') + '）');
  add(ex['発送日付'], ex['発送者'] || '', '発送');
  add(ex['完了日'], '', '完了');
  add(ex['キャンセル日'], '', 'キャンセル');
  add(ex['返品日付'], '', '返品');
  add(ex['廃棄日'], '', '廃棄');
  if (!ev.length) return '<div class="history-empty">履歴なし</div>';
  // 日時降順（Date でパース可能なら数値比較、ダメなら文字列）
  ev.sort(function(a, b){
    var ta = new Date(a.key).getTime();
    var tb = new Date(b.key).getTime();
    if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
  });
  return ev.map(function(e){
    return '<div class="history-item">' +
      '<div class="history-when">' + esc(e.when) + '</div>' +
      '<div>' + (e.who ? '<span class="history-who">' + esc(e.who) + '</span> が' : '') + esc(e.text) + '</div>' +
      '</div>';
  }).join('');
}
function buildSummaryHtml_(d) {
  var ex = d.extra || {};
  function fmtYen(v) { return v != null && v !== '' ? '¥' + Number(v).toLocaleString() : '—'; }
  function pct(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (isNaN(n)) return String(v);
    if (n > 0 && n <= 1) n *= 100;
    return n.toFixed(1) + '%';
  }
  var profit = ex['利益'] != null && ex['利益'] !== '' ? Number(ex['利益']) : null;
  var profitCls = profit == null ? '' : (profit >= 0 ? ' pos' : ' neg');
  // wireSaleCalcResults_recalc_ から textContent / className を即時更新できるよう ID を付与
  return '<div class="summary-card" id="summary-card">' +
    '<h4>収支サマリ</h4>' +
    '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-label">販売価格</div><div class="stat-value" id="sum-sale-price">' + esc(fmtYen(ex['販売価格'])) + '</div></div>' +
      '<div class="stat"><div class="stat-label">仕入れ値</div><div class="stat-value" id="sum-cost">' + esc(fmtYen(ex['仕入れ値'])) + '</div></div>' +
      '<div class="stat"><div class="stat-label">利益</div><div class="stat-value' + profitCls + '" id="sum-profit">' + esc(fmtYen(ex['利益'])) + '</div></div>' +
      '<div class="stat"><div class="stat-label">利益率</div><div class="stat-value' + profitCls + '" id="sum-profit-rate">' + esc(pct(ex['利益率'])) + '</div></div>' +
      '<div class="stat"><div class="stat-label">リードタイム</div><div class="stat-value" id="sum-leadtime">' + esc(ex['リードタイム'] != null && ex['リードタイム'] !== '' ? ex['リードタイム'] + '日' : '—') + '</div></div>' +
      '<div class="stat"><div class="stat-label">在庫日数</div><div class="stat-value" id="sum-stockdays">' + esc(ex['在庫日数'] != null && ex['在庫日数'] !== '' ? ex['在庫日数'] + '日' : '—') + '</div></div>' +
    '</div>' +
  '</div>';
}
function buildDeadlineHtml_(d) {
  if (d.status !== '発送待ち' || !d.saleDate) return '';
  var sd = new Date(d.saleDate);
  if (isNaN(sd.getTime())) return '';
  var due = new Date(sd.getTime() + 3 * 86400000);
  var dueStr = due.getFullYear() + '/' + (due.getMonth() + 1) + '/' + due.getDate();
  var today = new Date(); today.setHours(0,0,0,0);
  var diff = Math.floor((due.getTime() - today.getTime()) / 86400000);
  var overdue = due.getTime() < today.getTime();
  var label = overdue ? '⏰ 期限超過 ' + dueStr + '（' + Math.abs(diff) + '日経過）'
    : (diff === 0 ? '⏰ 本日が期限 ' + dueStr : '⏰ ' + dueStr + 'まで（あと' + diff + '日）');
  return '<span class="hero-deadline' + (overdue ? ' overdue' : '') + '">' + esc(label) + '</span>';
}

// 基本タブの先頭に表示する画像サムネ（QR / 売却済み / ポストシール）
// クリックでモーダル拡大表示。レガシーパスは resolveLegacyImages_ が非同期解決
function buildBasicImgsHtml_(d) {
  var ex = d.extra || {};
  var fields = ['QR・バーコード画像', '売却済み商品画像', 'ポストシール'];
  var items = [];
  fields.forEach(function(name){
    var v = String(ex[name] || '');
    if (!v) return;
    if (/^https?:/.test(v)) {
      var u = normalizeDriveUrl_(v);
      var safeUrl = esc(u).replace(/\'/g,"\\'");
      items.push('<button type="button" class="basic-img" onclick="openImageModal_(\'' + safeUrl + '\')" title="' + esc(name) + '"><img src="' + esc(u) + '" alt="' + esc(name) + '"></button>');
    } else {
      items.push('<div class="basic-img img-loading" data-legacy="' + esc(v) + '" data-field="' + esc(name) + '" title="' + esc(name) + '">…</div>');
    }
  });
  // タスキ箱に登録された商品画像を非同期で差し込む空コンテナ。
  // QR/売却済み/ポストシールが0件でもタスキ箱画像があれば表示できるよう、必ず先頭に置く。
  var tbHtml = '<div class="basic-imgs basic-imgs-tb" data-kanri="' + esc(d.kanri) + '"></div>';
  var fieldsHtml = items.length ? '<div class="basic-imgs">' + items.join('') + '</div>' : '';
  return tbHtml + fieldsHtml;
}

// タスキ箱(R2/KV)に登録済みの商品画像URLリストをタブ切替えを跨いでキャッシュ
// （タブごとに /api/products/:kanri/images を再取得しないため）
var PRODUCT_IMAGES_CACHE = {};

// タスキ箱(R2/KV)に登録済みの商品画像を取得して詳細の .basic-imgs-tb にレンダリング。
// 画像0件のときは空のまま（DOMからは見えない）。
async function resolveDetailTasukibakoImages_(kanri) {
  if (!kanri) return;
  var holders = document.querySelectorAll('.basic-imgs-tb[data-kanri="' + cssEscape_(kanri) + '"]');
  if (!holders.length) return;
  // キャッシュヒット → API を叩かず即描画
  var cached = PRODUCT_IMAGES_CACHE[kanri];
  if (cached) {
    renderTasukibakoImages_(holders, cached);
    return;
  }
  try {
    var res = await api('/api/products/' + encodeURIComponent(kanri) + '/images');
    var urls = (res && Array.isArray(res.urls)) ? res.urls : [];
    PRODUCT_IMAGES_CACHE[kanri] = urls;
    renderTasukibakoImages_(holders, urls);
  } catch (e) { /* 画像取得失敗は無視 */ }
}

function renderTasukibakoImages_(holders, urls) {
  if (!urls || !urls.length) return;
  var html = urls.map(function(u){
    var safeUrl = esc(u).replace(/\'/g,"\\'");
    return '<button type="button" class="basic-img" onclick="openImageModal_(\'' + safeUrl + '\')" title="商品画像"><img src="' + esc(u) + '" alt="商品画像" loading="lazy" decoding="async"></button>';
  }).join('');
  Array.prototype.forEach.call(holders, function(h){ h.innerHTML = html; });
}

// querySelector 用の簡易エスケープ（kanri は英数字想定だが安全側で）
function cssEscape_(s) {
  return String(s).replace(/(["\\])/g, '\\$1');
}

// セクション内のフィールド配列を、項目グループ単位でグリッド化して描画
function renderSectionFields_(sec, d) {
  var title = sec.title;
  var fields = sec.fields;
  // 採寸 (cm) は全項目を 2 列グリッドで一覧性UP
  if (title === '採寸 (cm)') {
    return '<div class="meas-grid">' +
      fields.map(function(f){ return fieldRowHtml(f[0], f[1], detailValue(d, f[0])); }).join('') +
      '</div>';
  }
  // 基本情報は特定の連続項目をグリッド化（モックアップ準拠）
  if (title === '基本情報') {
    var html = '';
    var i = 0;
    while (i < fields.length) {
      var n0 = fields[i][0];
      var n1 = (i + 1 < fields.length) ? fields[i+1][0] : '';
      var n2 = (i + 2 < fields.length) ? fields[i+2][0] : '';
      // カテゴリ1/2/3 → 3列
      if (n0 === 'カテゴリ1' && n1 === 'カテゴリ2' && n2 === 'カテゴリ3') {
        html += '<div class="field-grid-3">' +
          fieldRowHtml(fields[i][0], fields[i][1], detailValue(d, fields[i][0])) +
          fieldRowHtml(fields[i+1][0], fields[i+1][1], detailValue(d, fields[i+1][0])) +
          fieldRowHtml(fields[i+2][0], fields[i+2][1], detailValue(d, fields[i+2][0])) +
          '</div>';
        i += 3; continue;
      }
      // メルカリサイズ + 性別 → 2列
      if (n0 === 'メルカリサイズ' && n1 === '性別') {
        html += '<div class="field-grid-2">' +
          fieldRowHtml(fields[i][0], fields[i][1], detailValue(d, fields[i][0])) +
          fieldRowHtml(fields[i+1][0], fields[i+1][1], detailValue(d, fields[i+1][0])) +
          '</div>';
        i += 2; continue;
      }
      // ポケット + ポケット詳細 → 2列
      if (n0 === 'ポケット' && n1 === 'ポケット詳細') {
        html += '<div class="field-grid-2">' +
          fieldRowHtml(fields[i][0], fields[i][1], detailValue(d, fields[i][0])) +
          fieldRowHtml(fields[i+1][0], fields[i+1][1], detailValue(d, fields[i+1][0])) +
          '</div>';
        i += 2; continue;
      }
      html += fieldRowHtml(fields[i][0], fields[i][1], detailValue(d, fields[i][0]));
      i++;
    }
    return html;
  }
  // 仕入れ連動・読取専用 → 3列
  if (title === '仕入れ（連動・読取専用）') {
    return '<div class="field-grid-3">' +
      fields.map(function(f){ return fieldRowHtml(f[0], f[1], detailValue(d, f[0])); }).join('') +
      '</div>';
  }
  // 採寸記録 / 撮影・出品 の日付+作業者ペア — date と作業者selectが狭幅で被るため1列で表示
  if (title === '採寸記録' && fields.length === 2) {
    return '<div class="field-grid-2 fg-stack">' +
      fields.map(function(f){ return fieldRowHtml(f[0], f[1], detailValue(d, f[0])); }).join('') +
      '</div>';
  }
  return fields.map(function(f){ return fieldRowHtml(f[0], f[1], detailValue(d, f[0])); }).join('');
}

function renderDetail() {
  var d = STATE.current;
  if (!d) { render(); return; }
  setAppbarMode_('back');
  // 詳細では商品管理タブの chips-bar を確実に隠す（openDetail から直接呼ばれた場合の取りこぼし防止）
  updateChipsBar_();
  document.getElementById('appbar-title').textContent = d.kanri;
  // タイトル・説明文を背景でプリフェッチ（クリック時に即時コピー可能にする）
  prefetchListingText_(d.kanri);

  var ex = d.extra || {};

  // セクションタブの初期値
  if (!STATE.detailSecTab) STATE.detailSecTab = 'basic';
  var activeTab = SEC_TABS.find(function(t){ return t.id === STATE.detailSecTab; }) || SEC_TABS[0];

  // hero
  // raw ステータスが販売後フェーズ（発送待ち/発送済み/売却済み）なら raw を優先。
  // 派生ステータスは raw が空の時の補完用 — raw='発送待ち' の商品が
  // '採寸日' 未入力等の理由で派生では '採寸待ち' に降格表示されないようにする。
  var rawSt = d.rawStatus || '';
  var derivedSt = d.status || '';
  var status = (rawSt === '発送待ち' || rawSt === '発送済み' || rawSt === '売却済み')
    ? rawSt : (derivedSt || ex['ステータス'] || '—');
  var statusCls = status === '発送待ち' ? ' s-shukka'
    : status === '発送済み' ? ' s-shukkazumi'
    : status === '売却済み' ? ' s-sold' : '';
  var heroMeta = [];
  var brand = d.brand || ex['ブランド'];
  if (brand) heroMeta.push('<b>' + esc(brand) + '</b>');
  var size = d.size || ex['メルカリサイズ'];
  if (size) heroMeta.push(esc(size) + 'サイズ');
  var color = d.color || ex['カラー'];
  if (color) heroMeta.push(esc(color));
  // 前後ナビ（直前に表示した一覧の並び順を使う）
  var prevInfo = adjacentKanri_(-1);
  var nextInfo = adjacentKanri_(1);
  var navList = detailNavList_();
  var posInfo = (function(){
    for (var i = 0; i < navList.length; i++) { if (navList[i].kanri === d.kanri) return { i: i + 1, total: navList.length }; }
    return null;
  })();
  var navHtml = (navList.length > 1) ? (
    '<div class="detail-nav">' +
      '<button type="button" class="nav-btn nav-prev" aria-label="前のレコード"' + (prevInfo ? '' : ' disabled') +
        ' onclick="gotoAdjacentDetail_(-1)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>' +
      '</button>' +
      (posInfo ? '<span class="nav-pos"><span class="nav-pos-cur">' + posInfo.i + '</span> / ' + posInfo.total + '</span>' : '') +
      '<button type="button" class="nav-btn nav-next" aria-label="次のレコード"' + (nextInfo ? '' : ' disabled') +
        ' onclick="gotoAdjacentDetail_(1)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
      '</button>' +
    '</div>'
  ) : '';
  var copyKanriAttr = esc(d.kanri).replace(/'/g, '&#39;');
  var heroHtml = navHtml +
    '<div class="detail-hero">' +
      '<div class="hero-kanri">' + esc(d.kanri) + '</div>' +
      (heroMeta.length ? '<div class="hero-meta">' + heroMeta.map(function(m){ return '<span>' + m + '</span>'; }).join('') + '</div>' : '') +
      '<div class="hero-copy-btns">' +
        '<button type="button" class="hero-copy-btn" data-kind="title" onclick="copyListingText_(\'' + copyKanriAttr + '\', \'title\', this)">' +
          '<span class="hero-copy-ico">📋</span><span class="hero-copy-label">タイトルコピー</span>' +
        '</button>' +
        '<button type="button" class="hero-copy-btn" data-kind="description" onclick="copyListingText_(\'' + copyKanriAttr + '\', \'description\', this)">' +
          '<span class="hero-copy-ico">📋</span><span class="hero-copy-label">説明文コピー</span>' +
        '</button>' +
      '</div>' +
      '<div class="hero-status-row">' +
        '<span class="hero-status' + statusCls + '">' + esc(status) + '</span>' +
        buildDeadlineHtml_(d) +
      '</div>' +
    '</div>';

  // sec-tabs
  var tabsHtml = '<div class="sec-tabs">' +
    SEC_TABS.map(function(t){
      var active = t.id === activeTab.id ? ' active' : '';
      return '<button type="button" class="sec-tab' + active + '" data-tab-id="' + t.id + '" onclick="selectSecTab_(\'' + t.id + '\')">' + esc(t.label) + '</button>';
    }).join('') +
  '</div>';

  // 該当セクションのフィールド（グループ単位でグリッド化）
  // セクション別のアイコン＋色クラス（視覚的に識別しやすく）
  var SEC_META = {
    '基本情報':              { icon: '📝', cls: '' },
    '採寸 (cm)':             { icon: '📏', cls: 'sec-measure' },
    '採寸記録':              { icon: '✏️', cls: 'sec-measure' },
    '撮影・出品':            { icon: '📷', cls: '' },
    '仕入れ（連動・読取専用）': { icon: '📦', cls: 'sec-readonly' },
    '販売':                  { icon: '💰', cls: 'sec-sale' },
    '計算結果（読取専用）':    { icon: '🧮', cls: 'sec-readonly' },
    '発送関係':              { icon: '🚚', cls: 'sec-ship' },
    'その他':                { icon: '📁', cls: 'sec-readonly' },
    '備考':                  { icon: '💬', cls: '' }
  };
  var sectionsHtml = activeTab.sections.map(function(secTitle){
    var sec = DETAIL_SECTIONS.find(function(s){ return s.title === secTitle; });
    if (!sec) return '';
    var meta = SEC_META[sec.title] || { icon: '', cls: '' };
    var iconHtml = meta.icon ? '<span class="sec-icon">' + meta.icon + '</span>' : '';
    var hdrCls = meta.cls ? ' ' + meta.cls : '';
    return '<div class="section-header' + hdrCls + '">' + iconHtml + esc(sec.title) + '</div>' +
      '<div class="form-section">' + renderSectionFields_(sec, d) + '</div>';
  }).join('');

  // 全タブで画像サムネを hero 直下に表示（タスキ箱画像URLは PRODUCT_IMAGES_CACHE で再利用）
  var basicImgsHtml = buildBasicImgsHtml_(d);

  // 販売タブには収支サマリ、全タブ共通で末尾に作業履歴
  var summaryHtml = activeTab.id === 'sale' ? buildSummaryHtml_(d) : '';
  var historyHtml =
    '<div class="summary-card history-card">' +
      '<h4>作業履歴</h4>' +
      buildHistoryHtml_(d) +
    '</div>';

  var html =
    heroHtml +
    basicImgsHtml +
    tabsHtml +
    '<div class="sec-body">' +
      sectionsHtml +
      summaryHtml +
      historyHtml +
    '</div>' +
    '<div class="savebar" id="savebar">' +
      '<div class="savebar-info"><b id="savebar-count">0</b> 件の変更が未保存<span class="savebar-fields" id="savebar-fields"></span></div>' +
      '<button class="btn-cancel" type="button" onclick="cancelDetailEdits_()">破棄</button>' +
      '<button class="btn-save" type="button" id="btn-save-details" onclick="saveDetails()">保存</button>' +
    '</div>';
  document.getElementById('content').innerHTML = html;
  wireFeeAutoCalc_('f_');
  wireSaleCalcResults_('f_');
  Array.prototype.forEach.call(document.querySelectorAll('#content textarea.auto-grow'), autoGrowTextarea_);
  var contentEl = document.getElementById('content');
  // 任意の入力で dirty + 差分件数を更新
  contentEl.addEventListener('input', updateSavebar_);
  contentEl.addEventListener('change', updateSavebar_);
  resolveLegacyImages_();
  // タスキ箱画像は全タブで表示（キャッシュヒット時は同期描画＝瞬時、初回のみ API）
  resolveDetailTasukibakoImages_(d.kanri);
  updateSavebar_();
}
// 詳細画面で「変更があったフィールド」を { name, before, after } 配列で返す。
// updateSavebar_ がここから件数とフィールド名一覧を取得して可視化する。
// 「何も変更してないのに 1件未保存」と出る場合は before/after を見れば原因
// （日付フォーマット差、select 候補外の値、空白の揺れなど）が特定できる。
function getDirtyFields_() {
  var d = STATE.current;
  if (!d) return [];
  var ex = d.extra || {};
  var edits = getDetailEdits_(d.kanri);
  if (!edits) return [];
  // name → type のマップを構築
  var typeByName = {};
  DETAIL_SECTIONS.forEach(function(sec){
    sec.fields.forEach(function(f){ typeByName[f[0]] = f[1]; });
  });
  var dirty = [];
  Object.keys(edits).forEach(function(name){
    var type = typeByName[name];
    if (!type || type === 'readonly' || type === 'image') return;
    var v = edits[name];
    var orig = ex[name] !== undefined ? String(ex[name]) : '';
    var changed = false;
    if (type === 'date') {
      var origDate = '';
      if (orig) {
        if (/^\d{4}-\d{2}-\d{2}/.test(orig)) origDate = orig.slice(0, 10);
        else { var dd = new Date(orig); if (!isNaN(dd.getTime())) origDate = dd.toISOString().slice(0, 10); }
      }
      if ((v || '') !== origDate) { changed = true; orig = origDate; }
    } else if (type === 'bool') {
      // bool は シート由来の "true"/"false" (JS Boolean を String 化) と option value "TRUE"/"FALSE" の
      // 大文字小文字差で擬似 dirty が起きるため case-insensitive で比較する
      if (String(v).toUpperCase() !== orig.toUpperCase()) changed = true;
    } else if (String(v) !== orig) changed = true;
    if (changed) dirty.push({ name: name, before: orig, after: String(v == null ? '' : v) });
  });
  return dirty;
}
function diffCount_() { return getDirtyFields_().length; }

function updateSavebar_() {
  // 入力イベントのたびに edits を最新の DOM 値で同期（タブ移動時の値消失を防ぐ）
  syncEditsFromDom_();
  var bar = document.getElementById('savebar');
  if (!bar) return;
  var dirty = getDirtyFields_();
  var n = dirty.length;
  // 既存のハイライトをクリア
  Array.prototype.forEach.call(document.querySelectorAll('#content .field-row.dirty'), function(row){
    row.classList.remove('dirty');
  });
  // dirty なフィールドの行をハイライト（現在表示中のセクションタブのフィールドのみ DOM に存在）
  dirty.forEach(function(item){
    var el = document.getElementById(detailFieldId(item.name));
    if (!el) return;
    var row = el.closest ? el.closest('.field-row') : null;
    if (!row && el.parentElement) row = el.parentElement.closest && el.parentElement.closest('.field-row');
    if (row) {
      row.classList.add('dirty');
      row.setAttribute('title', '変更前: ' + (item.before || '（空）') + ' → 変更後: ' + (item.after || '（空）'));
    }
  });
  // セクションタブのバッジ更新（dirty なフィールドが含まれるタブに ● を表示）
  updateSecTabDirtyBadges_(dirty);
  var cnt = document.getElementById('savebar-count');
  var names = document.getElementById('savebar-fields');
  var info = bar.querySelector('.savebar-info');
  // 保存中は dirty=0 でも savebar を表示し続け、テキストを「保存中…」に切り替える
  // （楽観的更新で dirty が 0 になるが、API 完了までユーザーに状態を見せたい）
  if (STATE.savingDetails) {
    bar.classList.add('show');
    bar.classList.add('saving');
    if (info) info.innerHTML = '<b>保存中…</b><span class="savebar-fields">' +
      (STATE.savingFieldsLabel ? '（' + STATE.savingFieldsLabel + '）' : '') + '</span>';
    return;
  }
  bar.classList.remove('saving');
  // 保存中でない場合は通常のテキスト構造を復元（前回 saving で innerHTML を上書きしているため）
  if (info && !document.getElementById('savebar-count')) {
    info.innerHTML = '<b id="savebar-count">0</b> 件の変更が未保存<span class="savebar-fields" id="savebar-fields"></span>';
    cnt = document.getElementById('savebar-count');
    names = document.getElementById('savebar-fields');
  }
  if (n > 0) {
    bar.classList.add('show');
    if (cnt) cnt.textContent = String(n);
    if (names) names.textContent = '（' + dirty.map(function(d){return d.name}).join('、') + '）';
    STATE.detailDirty = true;
  } else {
    bar.classList.remove('show');
    if (names) names.textContent = '';
    STATE.detailDirty = false;
  }
}
// セクションタブの dirty バッジ更新（タブ間の編集状況を可視化、ダイアログの代替UI）
function updateSecTabDirtyBadges_(dirty) {
  if (!dirty) dirty = getDirtyFields_();
  var dirtyNames = {};
  dirty.forEach(function(d){ dirtyNames[d.name] = true; });
  if (typeof SEC_TABS === 'undefined') return;
  SEC_TABS.forEach(function(t){
    var hasDirty = false;
    t.sections.forEach(function(secTitle){
      var sec = DETAIL_SECTIONS.find(function(s){ return s.title === secTitle; });
      if (!sec) return;
      sec.fields.forEach(function(f){
        if (dirtyNames[f[0]]) hasDirty = true;
      });
    });
    var btn = document.querySelector('.sec-tab[data-tab-id="' + t.id + '"]');
    if (btn) btn.classList.toggle('dirty', hasDirty);
  });
}
function cancelDetailEdits_() {
  var d = STATE.current;
  if (!d) return;
  // edits バケットを完全クリアして再描画 → detailValue が原本値で描画する
  clearDetailEdits_(d.kanri);
  STATE.detailDirty = false;
  renderDetail();
  toast('変更を破棄しました');
}
function markDetailDirty_() { STATE.detailDirty = true; }
// 保存／戻る後は dirty を解除
function clearDetailDirty_() { STATE.detailDirty = false; }

function backToList() {
  confirmLeaveDetail_(function(){
    // 履歴に詳細エントリがあれば history.back() で popstate に任せる
    // （ブラウザの戻るボタンと挙動を一致させる）
    try {
      if (history.state && history.state.view === 'detail') {
        history.back();
        return;
      }
    } catch(e) {}
    STATE.view = 'list'; STATE.current = null; render();
  });
}

// ブラウザ戻る／進むに対応: SPA 内のすべてのナビゲーションを history で再現する
// state 形式:
//   詳細: { view:'detail', kanri }
//   一覧: { view:'list', tab, filter, filterLabel }
window.addEventListener('popstate', function(e){
  var st = e.state;
  // 詳細→詳細以外への popstate は離脱扱い。dirty があれば案内シートで確認する。
  // popstate は既に history が進んでいるため、キャンセル時は pushState で詳細に戻す。
  var leavingDetail = STATE.view === 'detail' && STATE.current && (!st || st.view !== 'detail');
  if (leavingDetail) {
    var leftKanri = STATE.current.kanri;
    syncEditsFromDom_();
    if (getDirtyFields_().length > 0) {
      showLeaveSheet_(getDirtyFields_(), function(){
        applyPopstate_(st);
      }, function(){
        // ユーザーがキャンセル → 詳細状態を再 push
        try { history.pushState({ view: 'detail', kanri: leftKanri }, '', location.pathname + location.search); } catch(e) {}
      });
      return;
    }
  }
  applyPopstate_(st);
});
function applyPopstate_(st) {
  if (st && st.view === 'detail' && st.kanri) {
    openDetail(st.kanri, { fromPopState: true });
    return;
  }
  // list（または null = 初期エントリ）: タブ／フィルタを復元して一覧表示
  STATE.view = 'list';
  STATE.current = null;
  STATE.detailDirty = false;
  if (st && st.view === 'list') {
    STATE.tab = st.tab || 'shouhin';
    STATE.filter = st.filter || '';
    STATE.filterLabel = st.filterLabel || '';
  }
  // ボトムナビ／ドロワーのアクティブ表示も復元
  document.querySelectorAll('#bottomnav-inner button').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-tab') === STATE.tab);
  });
  document.querySelectorAll('.drawer-item').forEach(function(d){
    d.classList.toggle('active', d.getAttribute('data-filter') === STATE.filter);
  });
  render();
}

async function saveDetails() {
  var d = STATE.current;
  if (!d) return;
  var ex = d.extra || {};
  // 現在表示中のセクションタブの最新入力を edits に取り込んでから差分計算
  syncEditsFromDom_();
  var dirty = getDirtyFields_();
  var fields = {};
  dirty.forEach(function(item){ fields[item.name] = item.after; });

  if (Object.keys(fields).length === 0) {
    toast('変更なし');
    return;
  }

  // 失敗時に巻き戻すため、上書き前の値を退避（undefined は「キー無し」として復元）
  var prevValues = {};
  Object.keys(fields).forEach(function(k){ prevValues[k] = (k in ex) ? ex[k] : undefined; });

  // 楽観的更新: ローカル extra を即時反映 → 一覧キャッシュも更新（トーストは API 完了後に出す）
  Object.keys(fields).forEach(function(k){ ex[k] = fields[k]; });
  d.extra = ex;
  patchListCache_(d.kanri, fields);
  if (DETAIL_CACHE[d.kanri]) DETAIL_CACHE[d.kanri] = d;

  // 保存中フラグを立てて savebar を「保存中…」表示で固定（API 完了まで隠さない）
  STATE.savingDetails = true;
  STATE.savingFieldsLabel = dirty.map(function(d){return d.name}).join('、');
  try { updateSavebar_(); } catch(e) {}

  // 保存ボタンも「保存中…」スピナーに切り替え
  var btn = document.getElementById('btn-save-details');
  if (btn) { btn.classList.add('saving'); btn.disabled = true; btn.textContent = '保存中…'; }
  function clearSavingBtn_() {
    STATE.savingDetails = false;
    STATE.savingFieldsLabel = '';
    var b = document.getElementById('btn-save-details');
    if (b) { b.classList.remove('saving'); b.disabled = false; b.textContent = '保存'; }
    // savebar を最新の dirty 状態で再評価（成功時は 0 件で非表示、失敗時は再表示）
    try { updateSavebar_(); } catch(e) {}
  }

  // 背景で API へ送信 → 成功時は record（GAS が返す保存後の最新行）で d.extra を直接更新。
  // 旧実装は save 後に /api/products/:kanri を再 fetch していたが、record で代替できるため省略。
  // record が無い古い Worker 応答にはフォールバックで再 fetch を残す。
  fetch(API_BASE + '/api/save/details', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanri: d.kanri, fields: fields }),
  })
    .then(function(res){
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    })
    .then(function(json){
      if (!json || !json.ok) throw new Error((json && (json.message || json.error)) || 'save failed');
      refreshCounts();
      // 一覧キャッシュは派生値が古くなる可能性があるため破棄
      LIST_CACHE = Object.create(null);
      if (json.record && typeof json.record === 'object') {
        // record をそのまま採用 → 1 往復省ける
        return { item: mergeRecordIntoItem_(d, json.record), optimistic: !!json.optimistic };
      }
      // フォールバック: 旧応答や record 欠損時はサーバー再取得
      return api('/api/products/' + encodeURIComponent(d.kanri)).then(function(r){
        return { item: r && r.item, optimistic: false };
      });
    })
    .then(function(res){
      clearSavingBtn_();
      toast('保存しました', 'success');
      if (!res || !res.item) return;
      DETAIL_CACHE[d.kanri] = res.item;
      // 編集中（dirty）でなく、まだ同じ詳細を表示中なら再描画
      if (STATE.view === 'detail' && STATE.current && STATE.current.kanri === d.kanri && !STATE.detailDirty) {
        // 保存成功＋追加編集なし → edits をクリアして原本ベースで再描画
        clearDetailEdits_(d.kanri);
        STATE.current = res.item;
        renderDetail();
      }
      // ★ Day 3: optimistic 応答の場合、GAS の派生値（粗利・利益・ステータス再計算等）が
      //   裏で確定した頃合いに静かに再取得して UI を更新する。
      //   ユーザは既に次の操作に進んでいることが多いので、現在の詳細表示中で dirty でない時だけ再描画。
      if (res.optimistic) {
        setTimeout(function(){
          api('/api/products/' + encodeURIComponent(d.kanri))
            .then(function(r){
              if (!r || !r.item) return;
              DETAIL_CACHE[d.kanri] = r.item;
              if (STATE.view === 'detail' && STATE.current && STATE.current.kanri === d.kanri && !STATE.detailDirty) {
                clearDetailEdits_(d.kanri);
                STATE.current = r.item;
                renderDetail();
              }
            })
            .catch(function(){ /* 黙って諦める。次回詳細を開いた時には D1 が確定済み */ });
        }, 5500);
      }
    })
    .catch(function(err){
      // 失敗時: 電波切れ等は IndexedDB キューに退避→online で自動再送（楽観UIは維持）
      // 巻き戻しはせず、楽観反映を保ったままバックグラウンド再送に任せる
      var isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                      /Failed to fetch|NetworkError|TypeError/i.test(String(err && err.message || ''));
      if (isOffline) {
        outboxAdd_({ type: 'details', kanri: d.kanri, fields: fields });
        clearSavingBtn_();
        toast('📥 オフラインのため保存を待機中（接続復帰時に自動送信）', 'success');
        return;
      }
      // オンラインだが API エラー: 楽観反映を巻き戻す
      Object.keys(prevValues).forEach(function(k){
        if (prevValues[k] === undefined) delete ex[k];
        else ex[k] = prevValues[k];
      });
      d.extra = ex;
      clearSavingBtn_();
      toast('⚠️ 保存に失敗: ' + err.message + '（再保存してください）', 'error');
    });
}

// フリマ用タイトル・説明文のキャッシュ（管理番号 → { title, description }）
// 詳細画面を開いた時点でプリフェッチし、クリック時はキャッシュから即時コピーする
var LISTING_TEXT_CACHE = {};
var LISTING_TEXT_INFLIGHT = {};

function prefetchListingText_(kanri) {
  if (!kanri) return;
  if (LISTING_TEXT_CACHE[kanri]) return;
  if (LISTING_TEXT_INFLIGHT[kanri]) return;
  var p = api('/api/listing-text/' + encodeURIComponent(kanri))
    .then(function(res){
      LISTING_TEXT_CACHE[kanri] = {
        title: String(res.title || ''),
        description: String(res.description || ''),
      };
    })
    .catch(function(){ /* 失敗時は黙ってクリック時に再試行 */ })
    .then(function(){ delete LISTING_TEXT_INFLIGHT[kanri]; });
  LISTING_TEXT_INFLIGHT[kanri] = p;
}

// クリックハンドラ。許可ダイアログを出さないために execCommand('copy') を最優先で使う
// （navigator.clipboard.writeText は初回に許可ダイアログが出るブラウザがある）
function copyListingText_(kanri, kind, btn) {
  if (!kanri) { toast('管理番号が空です', 'error'); return; }
  var cached = LISTING_TEXT_CACHE[kanri];
  if (cached) {
    var text = kind === 'title' ? cached.title : cached.description;
    if (!text) { toast(kind === 'title' ? 'タイトルが空です' : '説明文が空です', 'error'); return; }
    // ユーザー操作のスタックフレーム内で同期的に execCommand → 許可ダイアログ無しで即コピー
    if (execCopy_(text)) {
      toast((kind === 'title' ? 'タイトル' : '説明文') + 'をコピーしました', 'success');
      flashCopied_(btn);
    } else {
      // 最後の手段: navigator.clipboard（許可ダイアログが出る可能性あり）
      clipboardWriteFallback_(text, btn, kind);
    }
    return;
  }
  // キャッシュ未取得 → 取得後にコピー。execCommand も非同期コンテキストでは失敗しがちなので、
  // 取得完了時点でテキストを返し、ユーザーには「タップしてコピー」を促す Toast にする選択肢もあるが、
  // まずは試行 → 失敗時に navigator.clipboard をフォールバック
  var origLabel = btn ? (btn.querySelector('.hero-copy-label') ? btn.querySelector('.hero-copy-label').textContent : '') : '';
  if (btn) {
    btn.disabled = true;
    var labelEl = btn.querySelector('.hero-copy-label');
    if (labelEl) labelEl.textContent = '取得中…';
  }
  prefetchListingText_(kanri);
  var inflight = LISTING_TEXT_INFLIGHT[kanri] || Promise.resolve();
  inflight.then(function(){
    var c = LISTING_TEXT_CACHE[kanri];
    if (!c) throw new Error('取得失敗');
    var text = kind === 'title' ? c.title : c.description;
    if (!text) throw new Error(kind === 'title' ? 'タイトルが空です' : '説明文が空です');
    if (execCopy_(text)) return;
    // execCommand 失敗時のみ navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    throw new Error('clipboard unavailable');
  }).then(function(){
    toast((kind === 'title' ? 'タイトル' : '説明文') + 'をコピーしました', 'success');
    flashCopied_(btn, origLabel);
  }).catch(function(err){
    toast('コピーに失敗: ' + (err && err.message ? err.message : err), 'error');
    if (btn) {
      var l = btn.querySelector('.hero-copy-label');
      if (l) l.textContent = origLabel;
    }
  }).then(function(){
    if (btn) btn.disabled = false;
  });
}

function clipboardWriteFallback_(text, btn, kind) {
  if (!(navigator.clipboard && window.isSecureContext)) {
    toast('コピーに失敗', 'error'); return;
  }
  navigator.clipboard.writeText(text).then(function(){
    toast((kind === 'title' ? 'タイトル' : '説明文') + 'をコピーしました', 'success');
    flashCopied_(btn);
  }).catch(function(){ toast('コピーに失敗', 'error'); });
}

function flashCopied_(btn, origLabel) {
  if (!btn) return;
  var lbl = btn.querySelector('.hero-copy-label');
  var orig = origLabel || (lbl ? lbl.textContent : '');
  btn.classList.add('copied');
  if (lbl) lbl.textContent = 'コピー済み';
  setTimeout(function(){
    btn.classList.remove('copied');
    var l2 = btn.querySelector('.hero-copy-label');
    if (l2) l2.textContent = orig;
  }, 1400);
}

// textarea に値を入れて選択 → execCommand('copy') を実行する古典的な手法。
// 利点: 許可ダイアログを出さない。ユーザー操作スタックフレーム内なら全ブラウザで動作。
// 戻り値: 成功 true / 失敗 false（呼び出し側でフォールバック判断）
function execCopy_(text) {
  if (typeof document === 'undefined' || !document.body) return false;
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // iOS Safari: contenteditable な要素でないと select できないため属性を付与
  ta.contentEditable = 'true';
  ta.style.position = 'fixed';
  ta.style.left = '0';
  ta.style.top = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  ta.style.zIndex = '-1';
  document.body.appendChild(ta);
  // 既存の選択範囲を保存
  var prevSel = (function(){
    try { var s = document.getSelection(); return s.rangeCount > 0 ? s.getRangeAt(0) : null; }
    catch(e) { return null; }
  })();
  var ok = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  } finally {
    document.body.removeChild(ta);
    // 元の選択範囲を復元（ユーザーが何か選択していた場合）
    if (prevSel) {
      try { var s2 = document.getSelection(); s2.removeAllRanges(); s2.addRange(prevSel); } catch(e) {}
    }
  }
  return ok;
}

function setFabLoading(id, icon, loading) {
  var b = document.getElementById(id);
  if (!b) return;
  b.disabled = loading;
  b.textContent = icon;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function toast(msg, kind) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  setTimeout(function(){ t.className = 'toast'; }, 2400);
}

// ========== モーダル：新規作成 ==========
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-mask').classList.add('show');
  // モーダル内の長文 textarea を初期表示で自動拡張
  Array.prototype.forEach.call(
    document.querySelectorAll('#modal-body textarea.auto-grow'),
    autoGrowTextarea_
  );
}
function closeModal() {
  document.getElementById('modal-mask').classList.remove('show');
}

async function openCreatePurchaseModal() {
  if (STATE.mastersPromise) {
    openModal('<h3>新規仕入れ</h3><div class="loading">読み込み中…</div>');
    try { await STATE.mastersPromise; } catch(e){}
  }
  var today = new Date().toISOString().slice(0, 10);

  // 区分コード ドロップダウン
  var catOptions = '<option value="">選択してください</option>' +
    (STATE.categories || []).map(function(c){ return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  // 納品場所 ドロップダウン
  var placeOptions = '<option value="">選択してください</option>' +
    (STATE.places || []).map(function(p){ return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
  // 仕入先名 ドロップダウン (id を value にして "id - name" を表示)
  var supplierOptions = '<option value="">選択してください</option>' +
    (STATE.suppliers || []).map(function(s){
      var id = (s && s.id) || '';
      var name = (s && s.name) || id;
      var label = name ? (id + ' - ' + name) : id;
      return '<option value="' + esc(id) + '">' + esc(label) + '</option>';
    }).join('');
  // 登録者: 作業者マスタからドロップダウン（既定は STATE.email から推測しない＝AppSheet 同様 手動選択）
  var registerOptions = '<option value="">選択してください</option>' +
    (STATE.workers || []).map(function(w){ return '<option value="' + esc(w) + '">' + esc(w) + '</option>'; }).join('');

  var html =
    '<h3>新規仕入れ</h3>' +
    '<div class="hint">AppSheet と同じ列順。仕入れ日 → 区分コード → 金額 → 送料 → 商品点数 → 納品場所 → 内容 → 仕入先名 → 登録者。</div>' +
    '<div class="field-row"><label>仕入れ日<span class="req">*</span></label><input id="cp_date" type="date" value="' + today + '"></div>' +
    '<div class="field-row"><label>区分コード<span class="req">*</span></label><select id="cp_category">' + catOptions + '</select></div>' +
    '<div class="field-row"><label>金額</label><input id="cp_amount" type="number" inputmode="numeric" value="0"></div>' +
    '<div class="field-row"><label>送料</label><input id="cp_shipping" type="number" inputmode="numeric" value="0"></div>' +
    '<div class="field-row"><label>商品点数</label><input id="cp_planned" type="number" inputmode="numeric" value="0"></div>' +
    '<div class="field-row"><label>納品場所<span class="req">*</span></label><select id="cp_place">' + placeOptions + '</select></div>' +
    '<div id="cp_kanri_range" class="hint" style="background:#f0f9ff;border-left:3px solid var(--primary);padding:8px 12px;margin:8px 0;border-radius:4px;display:none;"></div>' +
    '<div class="field-row"><label>内容</label><textarea id="cp_content" placeholder="任意"></textarea></div>' +
    '<div class="field-row"><label>仕入先名</label><select id="cp_supplier">' + supplierOptions + '</select></div>' +
    '<div class="field-row"><label>登録者</label><select id="cp_register_user">' + registerOptions + '</select></div>' +
    '<div class="modal-actions">' +
      '<button class="btn-cancel" onclick="closeModal()">キャンセル</button>' +
      '<button class="btn-submit" id="cp_submit" onclick="submitCreatePurchase()">作成</button>' +
    '</div>';
  openModal(html);
  // 区分コード/点数の変更で割り当て管理番号を再計算
  document.getElementById('cp_category').addEventListener('change', updateCpKanriRange_);
  document.getElementById('cp_planned').addEventListener('input', updateCpKanriRange_);
}

var CP_KANRI_REQ_SEQ = 0;
async function updateCpKanriRange_() {
  var box = document.getElementById('cp_kanri_range');
  var category = document.getElementById('cp_category').value.trim();
  var planned = Number(document.getElementById('cp_planned').value || 0);
  if (!category || planned <= 0) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.textContent = '割り当て管理番号: 計算中…';
  var seq = ++CP_KANRI_REQ_SEQ;
  try {
    var res = await api('/api/kanri/next?category=' + encodeURIComponent(category));
    if (seq !== CP_KANRI_REQ_SEQ) return; // 古いリクエストは破棄
    var prefix = res.prefix || ('z' + category);
    var startN = Number(res.maxN || 0) + 1;
    var endN = startN + planned - 1;
    box.innerHTML = '割り当て管理番号: <strong>' + esc(prefix + startN) + ' 〜 ' + esc(prefix + endN) + '</strong> （' + planned + '点）';
  } catch (err) {
    if (seq !== CP_KANRI_REQ_SEQ) return;
    box.textContent = '割り当て管理番号: 取得失敗 (' + err.message + ')';
  }
}

async function submitCreatePurchase() {
  var btn = document.getElementById('cp_submit');
  var body = {
    date: document.getElementById('cp_date').value,
    category: document.getElementById('cp_category').value.trim(),
    amount: Number(document.getElementById('cp_amount').value || 0),
    shipping: Number(document.getElementById('cp_shipping').value || 0),
    planned: Number(document.getElementById('cp_planned').value || 0),
    place: document.getElementById('cp_place').value.trim(),
    content: document.getElementById('cp_content').value.trim(),
    supplierId: document.getElementById('cp_supplier').value.trim(),
    registerUser: document.getElementById('cp_register_user').value.trim(),
  };
  if (!body.date) { toast('仕入れ日を入力してください', 'error'); return; }
  if (!body.category) { toast('区分コードを入力してください', 'error'); return; }
  if (!body.place) { toast('納品場所を入力してください', 'error'); return; }
  btn.disabled = true; btn.textContent = '作成中…';
  try {
    var res = await api('/api/create/purchase', { method: 'POST', body: body });
    toast('仕入れを作成しました（' + res.shiireId + '）', 'success');
    closeModal();
    delete TAB_CACHE['shiire'];
    if (STATE.tab === 'shiire') render();
  } catch (err) {
    toast('作成失敗: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '作成';
  }
}

// 区分コードから「全商品にまたがる次の連番」をサーバーに問い合わせる
// 仕入れに紐づく既存商品ではなく、システム全体の zX連番 を考慮するため API を使う
async function suggestNextKanriRemote(category) {
  if (!category) return '';
  try {
    const res = await api('/api/kanri/next?category=' + encodeURIComponent(category));
    return res.nextKanri || '';
  } catch (e) {
    return '';
  }
}

// 仕入れ完了判定（登録済み数 >= 予定数 で完了とみなす）
function isShiireDone_(it) {
  var planned = Number(it && it.planned || 0);
  var registered = Number(it && it.registered || 0);
  return planned > 0 && registered >= planned;
}

// 古い仕入れ判定（60日超）— データズレで集計が合わない過去の仕入れを新規商品作成から除外
function isShiireStale_(it) {
  if (!it || !it.date) return false;
  var d = new Date(it.date);
  if (isNaN(d.getTime())) return false;
  var daysAgo = (Date.now() - d.getTime()) / 86400000;
  return daysAgo > 60;
}

// shiireId → category マップ（オートサジェスト用）
var SHIIRE_CATEGORY_MAP = {};

async function openCreateProductModal(shiireId) {
  if (STATE.mastersPromise) { try { await STATE.mastersPromise; } catch(e){} }
  var c = document.getElementById('content');
  // 仕入れ詳細から呼ばれた場合は戻り先として保持（商品管理タブからの呼び出しは null）
  STATE.createProductReturnShiireId = shiireId || null;
  // 新規作成中は autoRefresh をブロックするためフォーム状態に切り替え
  STATE.view = 'form';
  // shiireId 未指定 → 仕入れリストから選ばせる（完了済は除外）
  if (!shiireId) {
    c.innerHTML = '<div class="form-card"><h3>新規商品</h3><div class="loading">仕入れ一覧を取得中…</div></div>';
    try {
      const res = await api('/api/purchases?limit=2000');
      const all = (res.items || []).filter(it => it.shiireId);
      const items = all.filter(it => !isShiireDone_(it) && !isShiireStale_(it));
      // category マップを更新
      all.forEach(function(it){ SHIIRE_CATEGORY_MAP[it.shiireId] = it.category || ''; });
      if (!items.length) { cancelCreateProduct_(); toast('登録可能な仕入れがありません（すべて完了済）', 'error'); return; }
      const opts = items.map(it => {
        const reg = (it.registered || 0) + (it.planned ? '/' + it.planned : '');
        const label = (it.date || '—') +
          ' / ' + (it.place || '—') +
          ' / ' + (it.category || '—') +
          ' / 登録 ' + reg +
          ' - ' + (it.shiireId || '');
        return '<option value="' + esc(it.shiireId) + '">' + esc(label) + '</option>';
      }).join('');
      c.innerHTML = buildCreateProductHtml_({ withSelect: true, optionsHtml: opts, suggested: '' });
      wireFeeAutoCalc_('cf_');
      attachCreateDirtyTracker_();
      const sel = document.getElementById('cprd_shiire');
      sel.addEventListener('change', onShiireSelectChange_);
      // 初期選択の管理番号候補を引く
      onShiireSelectChange_();
    } catch (err) {
      cancelCreateProduct_();
      toast('読み込み失敗: ' + err.message, 'error');
    }
    return;
  }
  // 仕入れ詳細から呼ばれた → 仕入れの category から全商品横断で次の連番を採番
  var category = SHIIRE_CATEGORY_MAP[shiireId] || '';
  if (!category) {
    // category 未取得の場合は purchases API から取り直す
    try {
      const res = await api('/api/purchases?limit=2000');
      (res.items || []).forEach(function(it){ SHIIRE_CATEGORY_MAP[it.shiireId] = it.category || ''; });
      category = SHIIRE_CATEGORY_MAP[shiireId] || '';
    } catch (e) { /* ignore */ }
  }
  const suggested = await suggestNextKanriRemote(category);
  c.innerHTML = buildCreateProductHtml_({ withSelect: false, fixedShiireId: shiireId, suggested: suggested });
  wireFeeAutoCalc_('cf_');
  attachCreateDirtyTracker_();
  if (suggested) applyAiPrefillToForm_(suggested);
}

// 新規商品フォームのキャンセル → 元の画面（仕入れ詳細 or 商品一覧）に戻る
function cancelCreateProduct_() {
  if (STATE.createDirty) {
    if (!confirm('入力内容を破棄して戻りますか？')) return;
  }
  var returnShiire = STATE.createProductReturnShiireId;
  STATE.createProductReturnShiireId = null;
  STATE.createDirty = false;
  STATE.view = 'list';
  if (STATE.tab === 'shiire' && returnShiire) {
    openShiireDetail(returnShiire);
  } else {
    render();
  }
}

// 新規商品フォームの dirty 状態を input/change から自動追跡
function attachCreateDirtyTracker_() {
  var root = document.querySelector('.create-product-form');
  if (!root) return;
  STATE.createDirty = false;
  var onChange = function(e){
    var t = e.target;
    if (!t) return;
    if (t.id === 'cprd_kanri') return; // 自動採番のため除外
    if (t.readOnly) return;
    STATE.createDirty = true;
  };
  root.addEventListener('input', onChange);
  root.addEventListener('change', onChange);
}

// タグ表記サイズ → メルカリ表記へ変換（性別連動）
// gender: 'メンズ' | 'レディース' | 'キッズ' | 'ユニセックス' | '' （空はレディース基準）
// スーツ表記（A5/AB6/Y6/B7/BB6 等）も対応
function convertTagToMercariSize_(tag, gender) {
  if (!tag) return '';
  var t = String(tag).trim().toUpperCase();
  if (!t) return '';
  var g = String(gender || '');

  // 既にメルカリ表記
  if (/^(XXS|XS|S|M|L|LL|XL|XXL|3L|4L|5L|3XL|4XL|5XL)$/.test(t)) {
    if (t === 'LL') return 'XL';
    if (t === '3L') return 'XXL';
    if (t === '4L') return '3XL';
    if (t === '5L') return '4XL';
    return t;
  }
  // フリーサイズ
  if (/(FREE|フリー)/i.test(t) || t === 'F') return 'FREE';

  // キッズ: 80cm/90cm/100cm... 160cm をそのまま採用
  if (g === 'キッズ') {
    var kidsM = t.match(/^(\d{2,3})(?:CM)?$/);
    if (kidsM) {
      var kc = Number(kidsM[1]);
      if (kc >= 70 && kc <= 170 && kc % 10 === 0) return String(kc);
    }
  }

  // メンズスーツ JIS: Y/A/AB/B/BB/BE/E + 数字（数字=身長号: 4=165, 5=170, 6=175, 7=180, 8=185）
  // 体型 Y/A は標準, AB/B はやや太め, BB/BE/E は太め → 1段階上げる
  var suitM = t.match(/^(Y|A|AB|B|BB|BE|E)\s*(\d)$/);
  if (suitM) {
    var build = suitM[1];
    var h = Number(suitM[2]);
    var base;
    if (h <= 4) base = 'S';
    else if (h <= 5) base = 'M';
    else if (h <= 6) base = 'M';
    else if (h <= 7) base = 'L';
    else base = 'XL';
    if (build === 'B' || build === 'BB' || build === 'BE' || build === 'E') {
      base = bumpSize_(base, 1);
    } else if (build === 'AB') {
      // AB は半段階上げ。身長6以上ならL寄り
      if (h >= 6) base = bumpSize_(base, 1);
    }
    return base;
  }

  // n号（婦人服 — レディース基準）
  var goM = t.match(/^(\d+)号$/);
  if (goM) {
    var goN = Number(goM[1]);
    if (goN <= 5) return 'XS';
    if (goN === 7) return 'S';
    if (goN === 9) return 'M';
    if (goN === 11) return 'L';
    if (goN === 13) return 'XL';
    return 'XXL';
  }

  // ウエストinch（W プレフィックス or inch サフィックス必須）
  var wM = t.match(/^(?:W\s*(\d{2})|(\d{2})\s*(?:IN|INCH|INCHES))$/);
  if (wM) {
    var w = Number(wM[1] || wM[2]);
    return waistInchToSize_(w, g);
  }

  // 数字のみ
  var numM = t.match(/^(\d+)$/);
  if (numM) {
    var n = Number(numM[1]);

    if (g === 'メンズ') {
      // メンズ胸囲inch / 襟cm: 36=S, 38=M, 40=L, 42=XL, 44=XXL, 46+=3XL
      if (n >= 34 && n <= 50) {
        if (n <= 36) return 'S';
        if (n <= 38) return 'M';
        if (n <= 40) return 'L';
        if (n <= 42) return 'XL';
        if (n <= 44) return 'XXL';
        return '3XL';
      }
      // メンズウエストinch
      if (n >= 26 && n <= 44) return waistInchToSize_(n, g);
      return '';
    }

    // レディース or 不明
    // 5〜17 奇数 = 号系列
    if (n >= 5 && n <= 17 && n % 2 === 1) {
      if (n <= 5) return 'XS';
      if (n === 7) return 'S';
      if (n === 9) return 'M';
      if (n === 11) return 'L';
      if (n === 13) return 'XL';
      return 'XXL';
    }
    // EU婦人 32〜50（偶数）— 38 を M とする運用
    if (n >= 32 && n <= 50 && n % 2 === 0) {
      if (n <= 32) return 'XS';
      if (n === 34) return 'S';
      if (n === 36) return 'S';
      if (n === 38) return 'M';
      if (n === 40) return 'L';
      if (n === 42) return 'XL';
      return 'XXL';
    }
    // ウエストinch
    if (n >= 23 && n <= 38) return waistInchToSize_(n, g);
  }

  return '';
}

function waistInchToSize_(w, gender) {
  if (gender === 'メンズ') {
    if (w <= 28) return 'S';
    if (w <= 30) return 'M';
    if (w <= 33) return 'L';
    if (w <= 36) return 'XL';
    if (w <= 38) return 'XXL';
    return '3XL';
  }
  // レディース基準（不明含む）
  if (w <= 23) return 'XS';
  if (w <= 25) return 'S';
  if (w <= 27) return 'M';
  if (w <= 29) return 'L';
  if (w <= 31) return 'XL';
  return 'XXL';
}

function bumpSize_(size, n) {
  var order = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
  var i = order.indexOf(size);
  if (i < 0) return size;
  var j = Math.max(0, Math.min(order.length - 1, i + (n || 0)));
  return order[j];
}

// 仕入れに紐づく既存商品 + 候補管理番号を一括プリフェッチして STATE.aiPrefillCache に積む
// /api/ai/prefill/batch (D1 IN句一発 + 欠損のみ KV) なので 2-3秒級が 30-100ms に短縮される
async function prefetchAiPrefillForKanris_(kanris) {
  const list = (kanris || []).filter(function(k){ return k && !STATE.aiPrefillCache.has(k); });
  if (!list.length) return;
  try {
    const res = await api('/api/ai/prefill/batch', { method: 'POST', body: { kanris: list } });
    const items = (res && res.items) || {};
    list.forEach(function(k){
      // ヒット無しの管理番号も Map に空オブジェクトを入れて再フェッチを抑止
      var entry = items[k];
      STATE.aiPrefillCache.set(k, entry && entry.fields ? entry.fields : null);
    });
  } catch (err) {
    console.warn('[ai prefill batch]', err && err.message);
  }
}

// AI画像判定シートから 9 項目（ブランド/タグ表記/性別/カテゴリ1-3/デザイン特徴/カラー/ポケット）を取得して
// 新規商品モーダルの空欄フィールドに反映（AppSheet Initial Value 相当）
async function applyAiPrefillToForm_(kanri) {
  if (!kanri) return;
  try {
    var fields;
    if (STATE.aiPrefillCache.has(kanri)) {
      // クライアントキャッシュヒット（仕入れ選択時にプリフェッチ済み）
      var cached = STATE.aiPrefillCache.get(kanri);
      fields = cached ? Object.assign({}, cached) : {};
    } else {
      const res = await api('/api/ai/prefill?kanri=' + encodeURIComponent(kanri));
      fields = (res && res.fields) || {};
      STATE.aiPrefillCache.set(kanri, Object.keys(fields).length ? fields : null);
    }
    // タグ表記からメルカリサイズを派生（既に値があれば上書きしない）
    if (fields['タグ表記'] && !fields['メルカリサイズ']) {
      var derived = convertTagToMercariSize_(fields['タグ表記'], fields['性別']);
      if (derived) fields['メルカリサイズ'] = derived;
    }
    Object.keys(fields).forEach(function(name){
      var el = document.getElementById(createFieldId_(name));
      if (!el) return;
      // 既にユーザーが入力していたら上書きしない
      if (el.value && String(el.value).trim() !== '') return;
      var v = String(fields[name] == null ? '' : fields[name]);
      if (el.tagName === 'SELECT') {
        // 選択肢に無い値はオプションとして追加してから選択（プリフィル値の取りこぼし防止）
        var has = false;
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === v) { has = true; break; }
        }
        if (!has) {
          var opt = document.createElement('option');
          opt.value = v; opt.textContent = v;
          el.appendChild(opt);
        }
      }
      el.value = v;
      // yesno トグルの場合は、hidden に反映 + ボタンの active クラスを同期
      if (el.type === 'hidden') {
        var wrap = el.closest('.yesno-toggle');
        if (wrap) {
          var norm = (v === 'TRUE' || v === 'true' || v === 'YES' || v === 'はい' || v === 'Y') ? 'あり' :
                     (v === 'FALSE' || v === 'false' || v === 'NO' || v === 'いいえ' || v === 'N') ? 'なし' : v;
          el.value = norm;
          Array.prototype.forEach.call(wrap.querySelectorAll('.yesno-btn'), function(b){
            b.classList.toggle('active', b.getAttribute('data-val') === norm);
          });
        }
      }
      // textarea の自動拡張
      if (el.tagName === 'TEXTAREA' && el.classList.contains('auto-grow')) {
        autoGrowTextarea_(el);
      }
    });
    // カテゴリ1 が prefill された場合、cat1→cat2→cat3 の依存リストを再構築する。
    // el.value の代入は change を発火しないため、prefill 直後の cat2/cat3 は親=空のまま空リストで作られている。
    // refillCategory2_ が cat1 値から正しい cat2 リストを生成し、現在値（prefill 済の cat2）を保持して cat3 まで連鎖する。
    if (fields['カテゴリ1']) refillCategory2_('cf_');
  } catch (err) {
    console.warn('[ai prefill]', err && err.message);
  }
}

// 新規作成では除外するセクション
// - 仕入れ連動・計算結果・画像・ステータス変更日: 作成時には触らない
// - 撮影・出品: 撮影日付/撮影者 は gas-proxy autoMatchPhotography Cron(5分) が photo-meta KV から自動反映。
//              出品日/出品者/使用アカウント/リンクは後工程フィールド。
var CREATE_EXCLUDE_SECTIONS = {
  '仕入れ（連動・読取専用）': 1,
  '計算結果（読取専用）': 1,
  '発送関係': 1,
  'その他': 1,
  '撮影・出品': 1
};

function createFieldId_(name) {
  return 'cf_' + name.replace(/[^A-Za-z0-9_]/g, function(ch){ return '_' + ch.charCodeAt(0).toString(16); });
}

function createFieldRowHtml_(name, type, defVal) {
  var id = createFieldId_(name);
  var v = (defVal == null) ? '' : defVal;
  var input;
  if (type === 'textarea') {
    input = '<textarea id="' + id + '" class="auto-grow" rows="2">' + esc(v) + '</textarea>';
  } else if (type === 'number') {
    input = '<input type="number" inputmode="decimal" enterkeyhint="next" step="0.1" id="' + id + '" value="' + esc(v) + '">';
  } else if (type === 'color') {
    var setOptsColorC = settingsOptionsFor_(name, v);
    if (setOptsColorC) {
      input = '<select id="' + id + '">' + setOptsColorC + '</select>';
    } else {
      input = '<select id="' + id + '">' + masterOptionsHtml_(COLOR_OPTIONS, v) + '</select>';
    }
  } else if (type === 'yesno') {
    input = yesNoToggleHtml_(id, v, name);
  } else if (type === 'date') {
    input = '<input type="date" id="' + id + '" value="' + esc(v) + '" onfocus="onDateFieldFocus_(this)">';
  } else if (type === 'url') {
    input = '<input type="url" id="' + id + '" value="' + esc(v) + '">';
  } else if (type === 'status') {
    // 候補外の値・空値も保持するためのフォールバック option（誤選択事故防止）
    var curStatus = String(v == null ? '' : v);
    var hasCur = STATUS_OPTIONS.indexOf(curStatus) >= 0;
    var leading = '';
    if (!hasCur) {
      leading = curStatus
        ? '<option value="' + esc(curStatus) + '" selected>' + esc(curStatus) + '</option>'
        : '<option value="" selected>—</option>';
    }
    var opts = STATUS_OPTIONS.map(function(o){
      return '<option value="' + esc(o) + '"' + (curStatus === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    input = '<select id="' + id + '">' + leading + opts + '</select>';
  } else if (type === 'gender') {
    var opts2 = GENDER_OPTIONS.map(function(o){
      return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
    }).join('');
    input = '<div class="field-with-icon">' +
      '<span id="' + id + '_ico" class="field-icon-slot">' + genderIconHtml_(v) + '</span>' +
      '<select id="' + id + '" oninput="updateFieldIcon_(this,\'gender\')">' + opts2 + '</select>' +
    '</div>';
  } else if (type === 'salechannel') {
    var curSc = String(v || '') || SALE_CHANNEL_DEFAULT;
    var chListC = getSaleChannelOptions_();
    var optsScC = '<option value=""' + (curSc === '' ? ' selected' : '') + '>—</option>' +
      chListC.map(function(o){
        return '<option value="' + esc(o) + '"' + (curSc === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
    if (curSc && chListC.indexOf(curSc) < 0) {
      optsScC += '<option value="' + esc(curSc) + '" selected>' + esc(curSc) + '</option>';
    }
    input = '<select id="' + id + '" onchange="onSaleChannelChange_(this, \'' + id + '\')">' + optsScC + '</select>';
  } else if (type === 'bool') {
    // Boolean false を ''扱いしないよう注意（v || x は false で fallback してしまう）
    var bC = (v == null || v === '' ? PROMO_DEFAULT : String(v)).toUpperCase();
    var optsBC = '<option value=""' + (bC === '' ? ' selected' : '') + '>—</option>' +
      '<option value="TRUE"' + (bC === 'TRUE' ? ' selected' : '') + '>はい</option>' +
      '<option value="FALSE"' + (bC === 'FALSE' ? ' selected' : '') + '>いいえ</option>';
    input = '<select id="' + id + '">' + optsBC + '</select>';
  } else if (type === 'shipmethod') {
    var setOptsShipC = settingsOptionsFor_(name, v);
    var innerC;
    if (setOptsShipC) {
      innerC = '<select id="' + id + '" oninput="updateFieldIcon_(this,\'shipmethod\')">' + setOptsShipC + '</select>';
    } else {
      var opts3 = SHIP_METHOD_OPTIONS.map(function(o){
        return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
      }).join('');
      innerC = '<select id="' + id + '" oninput="updateFieldIcon_(this,\'shipmethod\')">' + opts3 + '</select>';
    }
    input = '<div class="field-with-icon">' +
      '<span id="' + id + '_ico" class="field-icon-slot">' + shipMethodIconHtml_(v) + '</span>' +
      innerC +
    '</div>';
  } else if (type === 'worker') {
    input = '<select id="' + id + '">' + masterOptionsHtml_(STATE.workers, v) + '</select>';
  } else if (type === 'account') {
    input = '<select id="' + id + '">' + masterOptionsHtml_(STATE.accounts, v) + '</select>';
  } else if (type === 'mercarisize') {
    input = mercariSizeSelectHtml_(id, v);
  } else if (type === 'category1') {
    input = '<select id="' + id + '">' + categoryOptionsHtml_(CATEGORY1_OPTIONS, v) + '</select>';
  } else if (type === 'category2') {
    // 新規作成は初期空（cat1 未選択）。cat1 確定時にリスナーが options を再構築
    input = '<select id="' + id + '">' + categoryOptionsHtml_(category2OptionsFor_(''), v) + '</select>';
  } else if (type === 'category3') {
    input = '<select id="' + id + '">' + categoryOptionsHtml_(category3OptionsFor_('', ''), v) + '</select>';
  } else {
    var setOptsC = settingsOptionsFor_(name, v);
    if (setOptsC) {
      input = '<select id="' + id + '">' + setOptsC + '</select>';
    } else {
      input = '<input type="text" id="' + id + '" value="' + esc(v) + '">';
    }
  }
  var labelHtmlC = '<label>' + esc(name) +
    (type === 'mercarisize' ? ' <button type="button" class="size-help-btn" onclick="openMercariSizeHelp_()" aria-label="サイズ変換表" title="サイズ変換表">?</button>' : '') +
    '</label>';
  return '<div class="field-row">' + labelHtmlC + fieldClearWrap_(input, id, type) + '</div>';
}

function buildCreateProductHtml_(opts) {
  const submitArg = opts.withSelect ? 'null' : "'" + esc(opts.fixedShiireId).replace(/\'/g,"\\'") + "'";

  // 先頭カード: 仕入れID/管理番号（フォームの中核）
  var leadHtml;
  if (opts.withSelect) {
    leadHtml =
      '<div class="form-card" style="margin: 12px 12px 16px;">' +
        '<h3>📝 新規商品</h3>' +
        '<div class="field-row"><label>仕入れ <span class="req">*</span></label>' +
          '<select id="cprd_shiire">' + opts.optionsHtml + '</select></div>' +
        '<div class="field-row"><label>管理番号</label>' +
          '<input id="cprd_kanri" type="text" value="' + esc(opts.suggested) + '" readonly style="background:#f5f5f5;color:#666;"></div>' +
        '<div class="hint" id="cprd_hint" style="padding: 8px 0 0; color: var(--text-sub); font-size: 12px;">— / 候補: —</div>' +
      '</div>';
  } else {
    leadHtml =
      '<div class="form-card" style="margin: 12px 12px 16px;">' +
        '<h3>📝 新規商品</h3>' +
        '<div class="field-row"><label>仕入れID</label>' +
          '<input type="text" value="' + esc(opts.fixedShiireId) + '" readonly style="background:#f5f5f5;color:#666;"></div>' +
        '<div class="field-row"><label>管理番号</label>' +
          '<input id="cprd_kanri" type="text" value="' + esc(opts.suggested) + '" readonly style="background:#f5f5f5;color:#666;"></div>' +
        (opts.suggested ? '' :
          '<div class="hint" style="padding: 8px 0 0; color: var(--danger); font-size: 12px;">⚠ 区分コード未設定で採番不可</div>') +
      '</div>';
  }

  // セクション別アイコン・色（renderDetail と同じ）
  var SEC_META_C = {
    '基本情報':              { icon: '📝', cls: '' },
    '採寸 (cm)':             { icon: '📏', cls: 'sec-measure' },
    '採寸記録':              { icon: '✏️', cls: 'sec-measure' },
    '撮影・出品':            { icon: '📷', cls: '' },
    '販売':                  { icon: '💰', cls: 'sec-sale' },
    '発送関係':              { icon: '🚚', cls: 'sec-ship' },
    'その他':                { icon: '📁', cls: 'sec-readonly' },
    '備考':                  { icon: '💬', cls: '' }
  };

  // AppSheet 同等の全セクション（仕入れ連動・計算結果・画像・ステータス変更日は除外）
  var sections = DETAIL_SECTIONS
    .filter(function(sec){ return !CREATE_EXCLUDE_SECTIONS[sec.title]; })
    .map(function(sec){
      var rows = sec.fields
        .filter(function(f){ return f[1] !== 'readonly' && f[1] !== 'image'; })
        .map(function(f){
          var name = f[0], type = f[1];
          // ステータスは作成時に常に「採寸待ち」を自動割当（表示はするが手動変更不可）
          if (name === 'ステータス') {
            return '<div class="field-row"><label>ステータス</label>' +
              '<input type="text" value="採寸待ち" readonly style="background:#f5f5f5;color:#666;"></div>';
          }
          return createFieldRowHtml_(name, type, '');
        }).join('');
      if (!rows) return '';
      var meta = SEC_META_C[sec.title] || { icon: '', cls: '' };
      var iconHtml = meta.icon ? '<span class="sec-icon">' + meta.icon + '</span>' : '';
      var hdrCls = meta.cls ? ' ' + meta.cls : '';
      return '<div class="section-header' + hdrCls + '" style="margin-left:12px;margin-right:12px;">' + iconHtml + esc(sec.title) + '</div>' +
        '<div class="form-section" style="margin-left:12px;margin-right:12px;">' + rows + '</div>';
    }).join('');

  // 末尾カード: アクションボタン
  var actionHtml =
    '<div class="form-card" style="margin: 16px 12px 24px;">' +
      '<div class="form-actions" style="margin-top: 0; padding-top: 0; border-top: none;">' +
        '<button class="btn-secondary" onclick="cancelCreateProduct_()">キャンセル</button>' +
        '<button class="btn-primary" id="cprd_submit" onclick="submitCreateProduct(' + submitArg + ')">作成</button>' +
      '</div>' +
    '</div>';

  return '<div class="create-product-form">' + leadHtml + sections + actionHtml + '</div>';
}

// 仕入れ選択中に一度フォーム全フィールドをリセット（管理番号は別途、ステータスは readonly 固定）
// type ごとの既定値（販売場所=メルカリ, プロモーション利用=FALSE）はリセット時に維持
function resetCreateProductForm_() {
  DETAIL_SECTIONS.forEach(function(sec){
    if (CREATE_EXCLUDE_SECTIONS[sec.title]) return;
    sec.fields.forEach(function(f){
      var name = f[0], type = f[1];
      if (type === 'readonly' || type === 'image') return;
      if (name === 'ステータス') return; // 固定 readonly
      var el = document.getElementById(createFieldId_(name));
      if (!el) return;
      var resetVal = '';
      if (type === 'salechannel') resetVal = SALE_CHANNEL_DEFAULT;
      else if (type === 'bool') resetVal = PROMO_DEFAULT;
      el.value = resetVal;
      if (type === 'yesno') {
        var wrap = el.closest('.yesno-toggle');
        if (wrap) {
          Array.prototype.forEach.call(wrap.querySelectorAll('.yesno-btn'), function(b){
            b.classList.toggle('active', b.getAttribute('data-val') === '');
          });
        }
      }
      if (el.tagName === 'TEXTAREA' && el.classList.contains('auto-grow')) {
        autoGrowTextarea_(el);
      }
    });
  });
}

async function onShiireSelectChange_() {
  const sel = document.getElementById('cprd_shiire');
  const hint = document.getElementById('cprd_hint');
  const kanriInput = document.getElementById('cprd_kanri');
  const sid = sel.value;
  // 仕入れが切り替わったら既存入力＋プリフィル値をすべて初期化（管理番号は下で再設定）
  resetCreateProductForm_();
  kanriInput.value = '';
  if (!sid) { hint.textContent = '— / 候補: —'; return; }
  hint.textContent = sid + ' / 候補取得中…';
  try {
    const category = SHIIRE_CATEGORY_MAP[sid] || '';
    // 紐づく既存商品数も取得して表示
    const [productsRes, suggested] = await Promise.all([
      api('/api/purchases/' + encodeURIComponent(sid) + '/products'),
      suggestNextKanriRemote(category),
    ]);
    const items = productsRes.items || [];
    hint.innerHTML = '仕入れ ID: <strong>' + esc(sid) + '</strong> / 既存 ' + items.length + '件' +
      (suggested ? ' / 自動採番: <strong>' + esc(suggested) + '</strong>' : ' / ⚠ 区分コード未設定で採番不可');
    kanriInput.value = suggested || '';
    STATE.currentShiireProducts = items;
    // Phase 3: 候補管理番号 + 既存商品の管理番号を一括プリフェッチ。次回の開閉や採番変更が即時反映される
    var toPrefetch = [];
    if (suggested) toPrefetch.push(suggested);
    items.forEach(function(it){ if (it && it.kanri) toPrefetch.push(it.kanri); });
    if (toPrefetch.length) prefetchAiPrefillForKanris_(toPrefetch);
    if (suggested) applyAiPrefillToForm_(suggested);
  } catch (err) {
    hint.textContent = sid + ' / 候補取得失敗: ' + err.message;
  }
}

async function submitCreateProduct(shiireId) {
  var btn = document.getElementById('cprd_submit');
  // shiireId が null の場合は select から取得
  if (!shiireId) {
    var sel = document.getElementById('cprd_shiire');
    shiireId = sel ? sel.value : '';
  }
  if (!shiireId) { toast('仕入れを選択してください', 'error'); return; }
  var kanri = document.getElementById('cprd_kanri').value.trim();
  if (!kanri) { toast('管理番号を採番できませんでした（区分コード未設定の可能性）', 'error'); return; }

  // 全セクションを走査して入力済みフィールドを収集
  var fields = {};
  DETAIL_SECTIONS.forEach(function(sec){
    if (CREATE_EXCLUDE_SECTIONS[sec.title]) return;
    sec.fields.forEach(function(f){
      var name = f[0], type = f[1];
      if (type === 'readonly' || type === 'image') return;
      var el = document.getElementById(createFieldId_(name));
      if (!el) return;
      var v = (el.value || '').trim ? el.value.trim() : el.value;
      if (v !== '' && v != null) fields[name] = v;
    });
  });

  // ヘッダー名 → 旧 API 互換キーへのショートカット（GAS 側の固定列マッピング用）
  var body = {
    shiireId: shiireId,
    kanri: kanri,
    brand: fields['ブランド'] || '',
    size:  fields['メルカリサイズ'] || '',
    color: fields['カラー'] || '',
    state: fields['状態'] || '',
    status: fields['ステータス'] || '採寸待ち',
    fields: fields
  };

  btn.disabled = true; btn.textContent = '作成中…';
  try {
    await api('/api/create/product', { method: 'POST', body: body });
    toast('商品 ' + body.kanri + ' を作成しました', 'success');
    var returnShiire = STATE.createProductReturnShiireId;
    STATE.createProductReturnShiireId = null;
    STATE.createDirty = false;
    STATE.view = 'list';
    refreshCounts();
    // 商品作成は仕入れの登録進捗・商品一覧の双方に影響するためキャッシュ無効化
    LIST_CACHE = Object.create(null);
    delete TAB_CACHE['shiire'];
    // 仕入れ詳細から作成 → 詳細を再描画 / 商品管理タブから作成 → 一覧再描画
    if (STATE.tab === 'shiire' && returnShiire) {
      openShiireDetail(returnShiire);
    } else {
      render();
    }
  } catch (err) {
    toast('作成失敗: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '作成';
  }
}

// =====================================================
// 画像拡大モーダル: タップで開閉 + 左右ナビでギャラリー切替
// =====================================================
var IMG_GALLERY = { urls: [], index: 0 };

// URL を絶対 URL に正規化（img.src は常に絶対、引数は相対の可能性あり）
function resolveImgUrl_(u) {
  if (!u) return '';
  try { return new URL(u, location.href).href; } catch (e) { return String(u); }
}

// 詳細画面に表示中の画像 URL を集める（重複排除、登場順）
function collectGalleryUrls_() {
  var nodes = document.querySelectorAll('.img-preview img, .basic-img img');
  var urls = [];
  var seen = Object.create(null);
  for (var i = 0; i < nodes.length; i++) {
    var src = nodes[i].src; // resolved
    if (!src || seen[src]) continue;
    seen[src] = 1;
    urls.push(src);
  }
  return urls;
}

function setImgModalSrc_(url) {
  var m = document.getElementById('img-modal');
  if (!m) return;
  var img = m.querySelector('img');
  if (img) img.src = url || '';
}

function updateImgModalNav_() {
  var prev = document.querySelector('#img-modal .img-modal-prev');
  var next = document.querySelector('#img-modal .img-modal-next');
  var counter = document.getElementById('img-modal-counter');
  var multi = IMG_GALLERY.urls.length > 1;
  if (prev) prev.style.display = multi ? '' : 'none';
  if (next) next.style.display = multi ? '' : 'none';
  if (counter) {
    counter.style.display = multi ? '' : 'none';
    counter.textContent = (IMG_GALLERY.index + 1) + ' / ' + IMG_GALLERY.urls.length;
  }
}

function openImageModal_(url) {
  var m = document.getElementById('img-modal');
  if (!m || !url) return;
  IMG_GALLERY.urls = collectGalleryUrls_();
  var resolved = resolveImgUrl_(url);
  IMG_GALLERY.index = IMG_GALLERY.urls.indexOf(resolved);
  if (IMG_GALLERY.index < 0) {
    // 集まらなかった場合は単独表示
    IMG_GALLERY.urls = [resolved];
    IMG_GALLERY.index = 0;
  }
  setImgModalSrc_(IMG_GALLERY.urls[IMG_GALLERY.index]);
  updateImgModalNav_();
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function navImageModal_(dir) {
  var n = IMG_GALLERY.urls.length;
  if (n <= 1) return;
  IMG_GALLERY.index = (IMG_GALLERY.index + dir + n) % n;
  setImgModalSrc_(IMG_GALLERY.urls[IMG_GALLERY.index]);
  updateImgModalNav_();
}

function closeImageModal_(e) {
  if (e && e.target) {
    // 画像本体タップ・ナビボタン・カウンターは閉じない（誤タップ防止）
    var t = e.target;
    if (t.tagName === 'IMG' && t.parentElement && t.parentElement.id === 'img-modal') return;
    if (t.closest && t.closest('.img-modal-nav, .img-modal-counter')) return;
  }
  var m = document.getElementById('img-modal');
  if (!m) return;
  m.classList.remove('show');
  setImgModalSrc_('');
  IMG_GALLERY.urls = [];
  IMG_GALLERY.index = 0;
  document.body.style.overflow = '';
}

// キーボード ←/→ でギャラリー切替、Esc で閉じる
document.addEventListener('keydown', function(e) {
  var m = document.getElementById('img-modal');
  if (!m || !m.classList.contains('show')) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); navImageModal_(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); navImageModal_(1); }
  else if (e.key === 'Escape')     { closeImageModal_(); }
});

// モーダル画像の左右スワイプでギャラリー切替（縦スクロールは無効＝モーダル中）
(function setupImgModalSwipe_(){
  var m = document.getElementById('img-modal');
  if (!m) return;
  var sx = 0, sy = 0, active = false;
  m.addEventListener('touchstart', function(e){
    if (!m.classList.contains('show')) return;
    if (e.touches.length !== 1) { active = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true;
  }, { passive: true });
  m.addEventListener('touchend', function(e){
    if (!active) return; active = false;
    var t = e.changedTouches[0]; if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      navImageModal_(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
})();

// ===== 詳細画面: 左右スワイプで前後移動／長い右スワイプで戻る =====
// 仕様:
//   - 横方向のスワイプが縦方向より優勢かつ素早い場合のみ反応
//   - 左→右に短くスワイプ: 前のレコード（gotoAdjacentDetail_(-1)）
//   - 右→左に短くスワイプ: 次のレコード（gotoAdjacentDetail_(1)）
//   - 左→右に長くスワイプ（画面幅の 35% 以上）: 一覧へ戻る（backToList）
//   - フォーム入力中・スライダー操作中・モーダル表示中は無効
//   - 縦スクロール中は preventDefault せず、ブラウザに任せる
(function setupDetailSwipe(){
  var SHORT_TH = 60;       // 横方向の最小距離（px）
  var BACK_RATIO = 0.35;   // 「戻る」と判定する画面幅比率
  var MAX_DURATION = 600;  // タップ的な短時間ジェスチャに限定（ms）
  var ANGLE_LOCK = 1.4;    // |dx| > |dy| * 1.4 で水平スワイプとみなす

  var st = null;
  function isInteractive(el) {
    if (!el) return false;
    if (el.closest && el.closest('input, textarea, select, button, [contenteditable], canvas, [role="slider"], .yesno-btn, .modal, #img-modal, .savebar, .nav-btn')) return true;
    return false;
  }
  function inDetail() {
    try { return typeof STATE !== 'undefined' && STATE && STATE.view === 'detail'; }
    catch(e) { return false; }
  }

  document.addEventListener('touchstart', function(e){
    if (!inDetail()) { st = null; return; }
    if (e.touches.length !== 1) { st = null; return; }
    if (isInteractive(e.target)) { st = null; return; }
    var t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, t: Date.now(), locked: false, horiz: false };
  }, { passive: true });

  document.addEventListener('touchmove', function(e){
    if (!st) return;
    if (e.touches.length !== 1) { st = null; return; }
    var t = e.touches[0];
    var dx = t.clientX - st.x;
    var dy = t.clientY - st.y;
    if (!st.locked) {
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
        st.horiz = Math.abs(dx) > Math.abs(dy) * ANGLE_LOCK;
        st.locked = true;
        if (!st.horiz) { st = null; return; } // 縦スクロール優先 → ジェスチャ放棄
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e){
    if (!st) return;
    var startState = st; st = null;
    if (!startState.horiz) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - startState.x;
    var dy = t.clientY - startState.y;
    var dt = Date.now() - startState.t;
    if (dt > MAX_DURATION) return;
    if (Math.abs(dx) < SHORT_TH) return;
    if (Math.abs(dx) < Math.abs(dy) * ANGLE_LOCK) return;

    var w = window.innerWidth || document.documentElement.clientWidth || 375;

    // 左→右（dx > 0）
    if (dx > 0) {
      if (dx > w * BACK_RATIO) {
        // 長い右スワイプ → 戻る
        if (typeof backToList === 'function') backToList();
      } else {
        // 短い右スワイプ → 前のレコード
        if (typeof gotoAdjacentDetail_ === 'function') gotoAdjacentDetail_(-1);
      }
      return;
    }
    // 右→左（dx < 0）→ 次のレコード
    if (typeof gotoAdjacentDetail_ === 'function') gotoAdjacentDetail_(1);
  }, { passive: true });

  document.addEventListener('touchcancel', function(){ st = null; }, { passive: true });
})();

