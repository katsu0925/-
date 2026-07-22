// Config.gs
// === Config.gs 全体抜粋 ===
const APP_CONFIG = {
  appTitle: 'デタウリ.Detauri',
  // 2026-07改定: 最低購入（注文）点数は1点
  minOrderCount: 1,
  notifyEmails: (function() { try { return PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || ''; } catch(e) { return ''; } })(),
  data: {
    spreadsheetId: (function() { try { return PropertiesService.getScriptProperties().getProperty('DATA_SPREADSHEET_ID') || ''; } catch(e) { return ''; } })(),
    sheetName: 'データ1',
    headerRow: 2,
    readCols: 25  // Y列(発送方法)まで読み込み
  },
  order: {
    spreadsheetId: '',
    requestSheetName: '依頼管理',
    holdSheetName: '確保',
    openLogSheetName: '依頼中'
  },
  cache: {
    productsSeconds: 21600,
    statusSeconds: 300,
    stateSeconds: 3600,
    detailSeconds: 86400  // ★追加★ 商品詳細キャッシュ（24時間）
  },
  holds: {
    minutes: 15,
    memberMinutes: 30,
    syncHoldSheet: true
  },
  admin: {
    ownerEmailProp: 'ADMIN_OWNER_EMAIL',
    accessKeyProp: 'ADMIN_ACCESS_KEY',
    accessKeyLen: 24
  },
  columns: {
    // 既存の列...
    managedId: 11,  // K列
    // ★追加★ 採寸データ列
    measureTake: 12,      // L列: 着丈
    measureShoulder: 13,  // M列: 肩幅
    measureChest: 14,     // N列: 身幅
    measureSleeve: 15,    // O列: 袖丈
    measureLength: 16,    // P列: 桁丈
    defectDetail: 17,     // Q列: 傷汚れ詳細
  },
  // ★追加★ 仕入れ管理Ver.2（商品詳細モーダル用）
  detail: {
    spreadsheetId: (function() { try { return PropertiesService.getScriptProperties().getProperty('DETAIL_SPREADSHEET_ID') || ''; } catch(e) { return ''; } })(),
    sheetName: '商品管理',
    headerRow: 1,
    managedIdCol: 6,  // 管理番号の列位置（1-indexed）
    columns: {
      managedId: 6,        // 管理番号
      state: 7,            // 状態
      brand: 8,            // ブランド
      defectDetail: 19,    // 傷汚れ詳細
      // 採寸データ（列番号）
      length: 20,          // 着丈
      shoulder: 21,        // 肩幅
      bust: 22,            // 身幅
      sleeve: 23,          // 袖丈
      yuki: 24,            // 裄丈
      totalLength: 25,     // 総丈
      waist: 26,           // ウエスト
      rise: 27,            // 股上
      inseam: 28,          // 股下
      thigh: 29,           // ワタリ
      hemWidth: 30,        // 裾幅
      hip: 31              // ヒップ
    }
  },
  // 依頼管理シートの列インデックス（0-based配列用）
  // sh_ensureRequestSheet_ のヘッダー定義と対応
  requestCols: {
    receiptNo: 0,          // A列: 受付番号
    datetime: 1,           // B列: 依頼日時
    companyName: 2,        // C列: 会社名/氏名
    contact: 3,            // D列: 連絡先
    postal: 4,             // E列: 郵便番号
    address: 5,            // F列: 住所
    phone: 6,              // G列: 電話番号
    productNames: 7,       // H列: 商品名
    confirmLink: 8,        // I列: 確認リンク
    selectionList: 9,      // J列: 選択リスト
    totalCount: 10,        // K列: 合計点数
    totalAmount: 11,       // L列: 合計金額
    shippingStore: 12,     // M列: 送料(店負担)
    shippingCustomer: 13,  // N列: 送料(客負担)
    paymentMethod: 14,     // O列: 決済方法
    paymentId: 15,         // P列: 決済ID
    paymentConfirm: 16,    // Q列: 入金確認
    pointFlag: 17,         // R列: ポイント付与済
    shippingStatus: 18,    // S列: 発送ステータス
    carrier: 19,           // T列: 配送業者
    trackingNo: 20,        // U列: 伝票番号
    status: 21,            // V列: ステータス
    person: 22,            // W列: 担当者
    listEnclosed: 23,      // X列: リスト同梱
    xlsxSent: 24,          // Y列: xlsx送付
    invoiceReq: 25,        // Z列: インボイス発行
    invoiceSent: 26,       // AA列: インボイス状況
    notifyFlag: 27,        // AB列: 受注通知
    shipNotifyFlag: 28,    // AC列: 発送通知
    note: 29,              // AD列: 備考
    reward: 30,            // AE列: 作業報酬
    updatedAt: 31,         // AF列: 更新日時
    channel: 32            // AG列: チャネル（デタウリ/アソート）
  },
  statuses: {
    open: '依頼中',
    closed: ['キャンセル', '返品', '完了'],
    allowed: ['依頼中', 'キャンセル', '返品', '完了']
  },
  uiText: {
    notes: [
      '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
      '1点から購入可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料は住所入力後に自動計算されます。',
      'カートに入れた商品は15分間確保されます（会員は30分間）。在庫は先着順のためお早めにお手続きください。',
      '決済方法：クレジットカード／コンビニ払い／銀行振込／PayPay／ペイジー／Apple Pay／Paidy',
      '<span style="color:#b8002a;">10点以上で5％割引〜最大20％OFF ／ 会員登録で10％OFF（2026年9月末まで・併用可）</span>'
    ],
    nextSteps: [],
    basePaymentUrl: ''
  }
};

function app_getOrderSpreadsheetId_() {
  const id = String(APP_CONFIG.order.spreadsheetId || '').trim();
  return id ? id : String(APP_CONFIG.data.spreadsheetId || '').trim();
}

function app_publicSettings_() {
  const ui = (APP_CONFIG && APP_CONFIG.uiText && typeof APP_CONFIG.uiText === 'object') ? APP_CONFIG.uiText : {};

  const appTitle = String(APP_CONFIG.appTitle || ui.appTitle || '');
  const minOrderCount = Number((APP_CONFIG.minOrderCount != null ? APP_CONFIG.minOrderCount : (ui.minOrderCount != null ? ui.minOrderCount : 30)));

  const shippingEstimateText = String(ui.shippingEstimateText || '');

  const rawNotes = Array.isArray(ui.notes) ? ui.notes : [];
  const nextSteps = Array.isArray(ui.nextSteps) ? ui.nextSteps : [];

  const basePaymentUrl =
    (typeof WEB_CONFIG !== 'undefined' && WEB_CONFIG && WEB_CONFIG.basePaymentUrl) ? String(WEB_CONFIG.basePaymentUrl) :
    String(ui.basePaymentUrl || '');

  const memberDiscount = app_getMemberDiscountStatus_();

  // 会員割引OFFの場合、ノートから会員割引の記述を除去（30点割引は残す）
  const notes = rawNotes.map(function(n) {
    if (!memberDiscount.enabled && String(n).indexOf('会員登録で10％OFF') !== -1) {
      return '<span style="color:#b8002a;">30点以上で10％割引</span>';
    }
    return n;
  });

  return {
    appTitle: appTitle,
    minOrderCount: minOrderCount,
    basePaymentUrl: basePaymentUrl,
    shippingEstimateText: shippingEstimateText,
    topNotes: notes,
    notes: notes,
    nextSteps: nextSteps,
    memberDiscount: memberDiscount,
    uiText: {
      appTitle: appTitle,
      minOrderCount: minOrderCount,
      basePaymentUrl: basePaymentUrl,
      shippingEstimateText: shippingEstimateText,
      notes: notes,
      nextSteps: nextSteps
    }
  };
}

// =====================================================
// 会員割引管理（Script Properties + 期限自動チェック）
// =====================================================
const MEMBER_DISCOUNT_DEFAULTS = {
  rate: 0.10,
  endDate: '2026-09-30'
};

/**
 * 会員割引の現在のステータスを取得（期限切れなら自動OFF）
 */
function app_getMemberDiscountStatus_() {
  const props = PropertiesService.getScriptProperties();
  const endDate = props.getProperty('MEMBER_DISCOUNT_END_DATE') || MEMBER_DISCOUNT_DEFAULTS.endDate;
  const rate = Number(props.getProperty('MEMBER_DISCOUNT_RATE') || MEMBER_DISCOUNT_DEFAULTS.rate);

  // 手動OFF判定
  const manualFlag = props.getProperty('MEMBER_DISCOUNT_ENABLED');
  if (manualFlag === 'false') {
    return { enabled: false, rate: 0, endDate: endDate, reason: 'manual_off' };
  }

  // 期限切れ判定
  const now = new Date();
  const end = new Date(endDate + 'T23:59:59+09:00');
  if (now > end) {
    return { enabled: false, rate: 0, endDate: endDate, reason: 'expired' };
  }

  return { enabled: true, rate: rate, endDate: endDate, reason: 'active' };
}

/**
 * 会員割引をON/OFFトグル（管理メニューから呼び出し）
 */
function toggleMemberDiscount() {
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty('MEMBER_DISCOUNT_ENABLED');
  const newVal = (current === 'false') ? 'true' : 'false';
  props.setProperty('MEMBER_DISCOUNT_ENABLED', newVal);
  // 商品キャッシュを無効化し、顧客ページで次回読み込み時に最新の割引設定を反映
  pr_bumpProductsVersion_();
  pr_clearProductsCache_();

  const status = app_getMemberDiscountStatus_();
  const ui = SpreadsheetApp.getUi();
  if (status.enabled) {
    ui.alert('会員割引をONにしました\n（期限: ' + status.endDate + ' まで）');
  } else {
    ui.alert('会員割引をOFFにしました\n（理由: ' + (status.reason === 'expired' ? '期限切れ' : '手動OFF') + '）');
  }
}

/**
 * 会員割引の期限を変更
 */
function setMemberDiscountEndDate() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('会員割引の期限を設定', '終了日を入力してください（例: 2026-09-30）', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const dateStr = resp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert('日付の形式が正しくありません。YYYY-MM-DD で入力してください。');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('MEMBER_DISCOUNT_END_DATE', dateStr);
  ui.alert('会員割引の期限を ' + dateStr + ' に設定しました。');
}

// =====================================================
// 初回全品半額キャンペーン
// =====================================================
var FIRST_HALF_PRICE_DEFAULTS = {
  rate: 0.50,
  endDate: '2026-09-30'
};

function app_getFirstHalfPriceStatus_() {
  var props = PropertiesService.getScriptProperties();
  var endDate = props.getProperty('FIRST_HALF_PRICE_END_DATE') || FIRST_HALF_PRICE_DEFAULTS.endDate;
  var rate = Number(props.getProperty('FIRST_HALF_PRICE_RATE') || FIRST_HALF_PRICE_DEFAULTS.rate);
  var manualFlag = props.getProperty('FIRST_HALF_PRICE_ENABLED');
  // manualFlagが'false'の場合、自動的に'true'に修正（誤設定対策）
  if (manualFlag === 'false') {
    console.log('FHP: manualFlag was false, auto-correcting to true');
    props.setProperty('FIRST_HALF_PRICE_ENABLED', 'true');
  }
  var now = new Date();
  var end = new Date(endDate + 'T23:59:59+09:00');
  if (now > end) {
    return { enabled: false, rate: 0, endDate: endDate, reason: 'expired' };
  }
  // 先着上限は2026-06-10に撤廃（告知通り全会員の初回注文を50%OFF対象に）。0=無制限。
  // 再び先着制にする場合のみ ScriptProperty FHP_MEMBER_CAP に正の数を設定する。
  var memberCap = Number(props.getProperty('FHP_MEMBER_CAP') || 0);
  return { enabled: true, rate: rate, endDate: endDate, reason: 'active', memberCap: memberCap };
}

/**
 * FHP会員上限チェック（memberCap人目までに登録した会員のみ対象。memberCap=0で無制限）
 * @param {object} customer - findCustomerByEmail_の返却値（row プロパティ必須）
 * @param {object} fhpStatus - app_getFirstHalfPriceStatus_の返却値
 * @return {boolean} FHP対象ならtrue
 */
function isFhpEligible_(customer, fhpStatus) {
  if (!fhpStatus || !fhpStatus.enabled) return false;
  if (!customer || !customer.email) return false;
  if (!customer.row || customer.row < 2) return false;
  var cap = Number(fhpStatus.memberCap) || 0;  // 0=無制限（|| 100 だと0が100に戻る地雷を回避）
  // row = シート行番号（ヘッダー=1, 最初の顧客=2）→ 登録順 = row - 1
  if (cap > 0 && (customer.row - 1) > cap) return false;
  // 依頼管理シートを直接スキャンして過去注文があるか確認（purchaseCount列が古い場合の抜け穴対策）
  // 非キャンセルの注文が1件でもあればFHP無効
  try {
    if (hasPriorNonCancelledOrder_(customer.email)) return false;
  } catch (e) {
    // 依頼管理アクセス失敗時はpurchaseCount列にフォールバック
    if (customer.purchaseCount !== 0) return false;
  }
  return true;
}

/**
 * 依頼管理（本シート＋アーカイブ）に同メールの非キャンセル注文があるかチェック
 * FHP判定専用。status='キャンセル'と空欄はスキップ。
 */
function hasPriorNonCancelledOrder_(email) {
  var normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  var ss = sh_getOrderSs_();
  var sheetNames = ['依頼管理', '依頼管理_アーカイブ'];
  for (var s = 0; s < sheetNames.length; s++) {
    var sheet = ss.getSheetByName(sheetNames[s]);
    if (!sheet || sheet.getLastRow() < 2) continue;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rEmail = String(data[i][REQUEST_SHEET_COLS.CONTACT - 1] || '').trim().toLowerCase();
      if (rEmail !== normalized) continue;
      var rStatus = String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || '').trim();
      if (rStatus && rStatus !== 'キャンセル') return true;
    }
  }
  return false;
}

function toggleFirstHalfPrice() {
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperty('FIRST_HALF_PRICE_ENABLED');
  var newVal = (current === 'false') ? 'true' : 'false';
  props.setProperty('FIRST_HALF_PRICE_ENABLED', newVal);
  var status = app_getFirstHalfPriceStatus_();
  var ui = SpreadsheetApp.getUi();
  ui.alert(status.enabled
    ? '初回全品半額キャンペーンをONにしました（期限: ' + status.endDate + '）'
    : '初回全品半額キャンペーンをOFFにしました');
}

// =====================================================
// SNSシェアキャンペーン
// =====================================================
function app_getSnsShareCampaignStatus_() {
  var props = PropertiesService.getScriptProperties();
  var manualFlag = props.getProperty('SNS_SHARE_CAMPAIGN_ENABLED');
  if (manualFlag === 'false') return { enabled: false };
  var endDate = props.getProperty('SNS_SHARE_CAMPAIGN_END_DATE') || '2026-12-31';
  var now = new Date();
  var end = new Date(endDate + 'T23:59:59+09:00');
  if (now > end) return { enabled: false, reason: 'expired' };
  return { enabled: true, endDate: endDate };
}

function toggleSnsShareCampaign() {
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperty('SNS_SHARE_CAMPAIGN_ENABLED');
  var newVal = (current === 'false') ? 'true' : 'false';
  props.setProperty('SNS_SHARE_CAMPAIGN_ENABLED', newVal);
  var status = app_getSnsShareCampaignStatus_();
  var ui = SpreadsheetApp.getUi();
  ui.alert(status.enabled
    ? 'SNSシェアキャンペーンをONにしました'
    : 'SNSシェアキャンペーンをOFFにしました');
}

function st_normBrandDisplay_(v) {
  const s = String(v == null ? '' : v).normalize('NFKC');
  return s.replace(/[　\s]+/g, ' ').trim();
}

function st_normBrandKey_(v) {
  const s = st_normBrandDisplay_(v);
  return s.replace(/[　\s]+/g, '').toLowerCase();
}

// =====================================================
// 送料テーブル（エリアマッピング＆料金表）
// =====================================================
const SHIPPING_AREAS = {
  '北海道': 'hokkaido',
  '青森県': 'kita_tohoku', '岩手県': 'kita_tohoku', '秋田県': 'kita_tohoku',
  '宮城県': 'minami_tohoku', '福島県': 'minami_tohoku', '山形県': 'minami_tohoku',
  '東京都': 'kanto', '神奈川県': 'kanto', '埼玉県': 'kanto', '千葉県': 'kanto',
  '茨城県': 'kanto', '栃木県': 'kanto', '群馬県': 'kanto', '山梨県': 'kanto',
  '新潟県': 'shinetsu', '長野県': 'shinetsu',
  '愛知県': 'tokai', '静岡県': 'tokai', '岐阜県': 'tokai', '三重県': 'tokai',
  '石川県': 'hokuriku', '福井県': 'hokuriku', '富山県': 'hokuriku',
  '大阪府': 'kansai', '兵庫県': 'kansai', '京都府': 'kansai',
  '奈良県': 'kansai', '和歌山県': 'kansai', '滋賀県': 'kansai',
  '広島県': 'chugoku', '岡山県': 'chugoku', '島根県': 'chugoku',
  '山口県': 'chugoku', '鳥取県': 'chugoku',
  '香川県': 'shikoku', '愛媛県': 'shikoku', '高知県': 'shikoku', '徳島県': 'shikoku',
  '福岡県': 'kita_kyushu', '佐賀県': 'kita_kyushu', '大分県': 'kita_kyushu', '長崎県': 'kita_kyushu',
  '鹿児島県': 'minami_kyushu', '熊本県': 'minami_kyushu', '宮崎県': 'minami_kyushu',
  '沖縄県': 'okinawa'
};

// 顧客送料（佐川実費×1.5・¥10単位切上げ・税込）。沖縄は現行2段階の読み替え（60/80/100=2500、140/160=3500）
const SHIPPING_RATES = {
  minami_kyushu: { '60': 780, '80': 860, '100': 990,  '140': 1280, '160': 1760 },
  kita_kyushu:   { '60': 770, '80': 840, '100': 960,  '140': 1220, '160': 1650 },
  shikoku:       { '60': 750, '80': 810, '100': 890,  '140': 1080, '160': 1370 },
  chugoku:       { '60': 770, '80': 830, '100': 900,  '140': 1110, '160': 1440 },
  kansai:        { '60': 750, '80': 780, '100': 830,  '140': 950,  '160': 1110 },
  hokuriku:      { '60': 750, '80': 810, '100': 870,  '140': 1070, '160': 1340 },
  tokai:         { '60': 750, '80': 810, '100': 890,  '140': 1080, '160': 1400 },
  shinetsu:      { '60': 770, '80': 830, '100': 920,  '140': 1160, '160': 1520 },
  kanto:         { '60': 780, '80': 860, '100': 980,  '140': 1260, '160': 1730 },
  minami_tohoku: { '60': 780, '80': 890, '100': 1050, '140': 1430, '160': 2010 },
  kita_tohoku:   { '60': 800, '80': 900, '100': 1100, '140': 1490, '160': 2160 },
  hokkaido:      { '60': 830, '80': 980, '100': 1230, '140': 1790, '160': 2720 },
  okinawa:       { '60': 2500, '80': 2500, '100': 2500, '140': 3500, '160': 3500 }
};

// 実費（店負担原価）: 佐川急便 江坂発運賃表。沖縄のみゆうパック（大阪発）
// ※南東北60は原本CSVの620円が誤りのため520円に訂正済み
const SHIPPING_ACTUAL_RATES = {
  minami_kyushu: { '60': 520, '80': 570, '100': 660, '140': 850,  '160': 1170 },
  kita_kyushu:   { '60': 510, '80': 560, '100': 640, '140': 810,  '160': 1100 },
  shikoku:       { '60': 500, '80': 540, '100': 590, '140': 720,  '160': 910 },
  chugoku:       { '60': 510, '80': 550, '100': 600, '140': 740,  '160': 960 },
  kansai:        { '60': 500, '80': 520, '100': 550, '140': 630,  '160': 740 },
  hokuriku:      { '60': 500, '80': 540, '100': 580, '140': 710,  '160': 890 },
  tokai:         { '60': 500, '80': 540, '100': 590, '140': 720,  '160': 930 },
  shinetsu:      { '60': 510, '80': 550, '100': 610, '140': 770,  '160': 1010 },
  kanto:         { '60': 520, '80': 570, '100': 650, '140': 840,  '160': 1150 },
  minami_tohoku: { '60': 520, '80': 590, '100': 700, '140': 950,  '160': 1340 },
  kita_tohoku:   { '60': 530, '80': 600, '100': 730, '140': 990,  '160': 1440 },
  hokkaido:      { '60': 550, '80': 650, '100': 820, '140': 1190, '160': 1810 },
  okinawa:       { '60': 1450, '80': 1810, '100': 2160, '140': 2860, '160': 3180 }
};

// 離島リスト（配送対象外）
const REMOTE_ISLANDS = [
  // 東京都離島
  '大島町', '利島村', '新島村', '神津島村', '三宅村', '御蔵島村', '八丈町', '青ヶ島村', '小笠原村',
  // 鹿児島県離島（本土以外）
  '奄美市', '大和村', '宇検村', '瀬戸内町', '龍郷町', '喜界町', '徳之島町', '天城町', '伊仙町',
  '和泊町', '知名町', '与論町', '三島村', '十島村',
  '西之表市', '中種子町', '南種子町', '屋久島町',
  // 沖縄県離島（本島以外の主要離島地域）
  '宮古島市', '石垣市', '多良間村', '竹富町', '与那国町', '久米島町', '座間味村', '渡嘉敷村',
  '粟国村', '渡名喜村', '南大東村', '北大東村', '伊江村', '伊是名村', '伊平屋村',
  // 新潟県離島
  '佐渡市',
  // 島根県離島
  '隠岐の島町', '海士町', '西ノ島町', '知夫村',
  // 長崎県離島
  '対馬市', '壱岐市', '五島市', '新上五島町', '小値賀町',
  // 北海道離島
  '利尻町', '利尻富士町', '礼文町', '奥尻町'
];

/**
 * 住所テキストから離島かどうかを判定
 * @param {string} addressText - 住所テキスト
 * @returns {boolean} - 離島の場合true
 */
function isRemoteIsland_(addressText) {
  var text = String(addressText || '').trim();
  // 「周防大島町」（山口県・本土扱い）は東京都「大島町」に部分一致するため先に除去
  text = text.replace(/周防大島町/g, '');
  for (var i = 0; i < REMOTE_ISLANDS.length; i++) {
    if (text.indexOf(REMOTE_ISLANDS[i]) !== -1) return true;
  }
  return false;
}

/**
 * 都道府県名を住所テキストから検出
 */
function detectPrefecture_(addressText) {
  var PREFS = [
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県',
    '岐阜県','静岡県','愛知県','三重県',
    '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県',
    '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'
  ];
  var text = String(addressText || '').trim();
  for (var i = 0; i < PREFS.length; i++) {
    if (text.indexOf(PREFS[i]) === 0) return PREFS[i];
  }
  for (var j = 0; j < PREFS.length; j++) {
    var short = PREFS[j].replace(/[都府県]$/, '');
    if (text.indexOf(short) === 0) return PREFS[j];
  }
  return null;
}

/**
 * pt数から最安の箱組み合わせをDPで求める（pt制箱詰め）
 * @param {number} points - 合計pt（厚手=2pt / 薄手=1pt）
 * @param {Object} rates - サイズ→料金 { '60':n, '80':n, '100':n, '140':n, '160':n }
 * @returns {{amount:number, boxes:Object, label:string}} boxes={サイズ:個数}、labelは単箱「100サイズ」/複数口「160×2＋80」
 */
function calcBoxPlan_(points, rates) {
  var sizes = SHIPPING_CONSTANTS.BOX_SIZES;
  var caps = SHIPPING_CONSTANTS.BOX_CAPACITY;
  var p = Math.max(0, Math.ceil(Number(points) || 0));
  if (p === 0) return { amount: 0, boxes: {}, label: '' };
  var dp = [0];
  var choice = [null];
  for (var i = 1; i <= p; i++) {
    dp[i] = Infinity;
    choice[i] = null;
    for (var s = 0; s < sizes.length; s++) {
      var sz = sizes[s];
      var rest = Math.max(0, i - caps[sz]);
      var cost = rates[sz] + dp[rest];
      if (cost < dp[i]) { dp[i] = cost; choice[i] = sz; }
    }
  }
  var boxes = {};
  var cur = p;
  while (cur > 0) {
    var chosen = choice[cur];
    boxes[chosen] = (boxes[chosen] || 0) + 1;
    cur = Math.max(0, cur - caps[chosen]);
  }
  var order = ['160', '140', '100', '80', '60'];
  var parts = [];
  var totalBoxes = 0;
  for (var o = 0; o < order.length; o++) {
    var n = boxes[order[o]];
    if (n) { parts.push(n > 1 ? order[o] + '×' + n : order[o]); totalBoxes += n; }
  }
  var label = (totalBoxes === 1) ? parts[0] + 'サイズ' : parts.join('＋');
  return { amount: dp[p], boxes: boxes, label: label };
}

/**
 * 住所と点数から顧客送料を計算（薄手情報がない経路用: 全点厚手=2ptとして計算）
 * ※送料は全て税込み。会員割引は送料には適用しない。
 * @param {string} prefOrAddress - 都道府県名 or 住所テキスト
 * @param {number} totalCount - 合計点数
 * @returns {number|null} 送料金額（エリア不明の場合0、離島の場合null）
 */
function calcShippingByAddress_(prefOrAddress, totalCount) {
  // 離島チェック
  if (isRemoteIsland_(prefOrAddress)) return null;
  var pref = SHIPPING_AREAS[prefOrAddress] ? prefOrAddress : detectPrefecture_(prefOrAddress);
  if (!pref) return 0;
  var area = SHIPPING_AREAS[pref];
  if (!area || !SHIPPING_RATES[area]) return 0;
  var cnt = Math.max(1, Math.floor(Number(totalCount) || 0));
  return calcBoxPlan_(cnt * SHIPPING_CONSTANTS.ITEM_POINTS.thick, SHIPPING_RATES[area]).amount;
}

/**
 * 店負担送料を計算（実費表を直接参照。全点厚手=2ptとして計算）
 */
function calcStoreShippingByAddress_(prefOrAddress, totalCount) {
  if (isRemoteIsland_(prefOrAddress)) return null;
  var pref = SHIPPING_AREAS[prefOrAddress] ? prefOrAddress : detectPrefecture_(prefOrAddress);
  if (!pref) return 0;
  var area = SHIPPING_AREAS[pref];
  if (!area || !SHIPPING_ACTUAL_RATES[area]) return 0;
  var cnt = Math.max(1, Math.floor(Number(totalCount) || 0));
  return calcBoxPlan_(cnt * SHIPPING_CONSTANTS.ITEM_POINTS.thick, SHIPPING_ACTUAL_RATES[area]).amount;
}

var BRAND_LIST_CACHE_KEY = 'BRAND_LIST_CACHE';
var BRAND_LIST_CACHE_TTL = 300; // 5分（秒）

function app_readBrandList_() {
  // CacheServiceからキャッシュ取得を試みる
  var cache = CacheService.getScriptCache();
  var cached = cache.get(BRAND_LIST_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  const ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  const shName = String(APP_CONFIG.data.sheetName || '').trim();
  if (!ssId || !shName) return [];
  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(shName);
  if (!sh) return [];

  const last = sh.getLastRow();
  if (last < 3) return [];

  const vals = sh.getRange(3, 4, last - 2, 1).getValues();

  const map = {};
  for (let i = 0; i < vals.length; i++) {
    const raw = vals[i][0];
    const disp = st_normBrandDisplay_(raw);
    if (!disp) continue;

    const key = st_normBrandKey_(disp);
    if (!key) continue;

    if (!map[key]) {
      map[key] = disp;
    } else {
      const cur = String(map[key]);
      if (disp.length < cur.length) map[key] = disp;
    }
  }

  const out = Object.keys(map).map(k => map[k]);
  out.sort((a, b) => a.localeCompare(b, 'ja'));

  // キャッシュに保存
  try {
    cache.put(BRAND_LIST_CACHE_KEY, JSON.stringify(out), BRAND_LIST_CACHE_TTL);
  } catch (e) {
    console.log('ブランドリストキャッシュ保存エラー:', e);
  }
  return out;
}
