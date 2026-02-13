// === Config.gs 全体抜粋 ===
const APP_CONFIG = {
  appTitle: 'デタウリ.Detauri',
  // 最低購入（注文）点数を 10 に変更
  minOrderCount: 10,
  notifyEmails: 'nsdktts1030@gmail.com',
  data: {
    spreadsheetId: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
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
    spreadsheetId: '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',
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
    receiptNo: 0,     // A列: 受付番号
    datetime: 1,      // B列: 依頼日時
    companyName: 2,    // C列: 会社名/氏名
    contact: 3,       // D列: 連絡先
    postal: 4,        // E列: 郵便番号
    address: 5,       // F列: 住所
    phone: 6,         // G列: 電話番号
    productNames: 7,  // H列: 商品名
    confirmLink: 8,   // I列: 確認リンク
    selectionList: 9, // J列: 選択リスト
    totalCount: 10,   // K列: 合計点数
    totalAmount: 11,  // L列: 合計金額
    shippingStatus: 12, // M列: 発送ステータス
    listEnclosed: 13, // N列: リスト同梱
    xlsxSent: 14,     // O列: xlsx送付
    status: 15,       // P列: ステータス
    person: 16,       // Q列: 担当者
    paymentConfirm: 17, // R列: 入金確認
    note: 21,         // V列: 備考
    carrier: 22,      // W列: 配送業者
    trackingNo: 23,   // X列: 伝票番号
    reward: 24,       // Y列: 作業報酬
    updatedAt: 25,    // Z列: 更新日時
    notifyFlag: 26,   // AA列: 通知フラグ
    pointFlag: 27,    // AB列: ポイント付与済
    shippingStore: 28,    // AC列: 送料(店負担)
    shippingCustomer: 29  // AD列: 送料(客負担)
  },
  statuses: {
    open: '依頼中',
    closed: ['キャンセル', '返品', '完了'],
    allowed: ['依頼中', 'キャンセル', '返品', '完了']
  },
  uiText: {
    // 注意文やリンクを最新仕様に変更
    notes: [
      // 商品ページガイドのリンク差し替え
      '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
      // 「購入」の最低点数案内（送料別）をリンク化
      '10点から購入可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料はBASE側で確定します。',
      '送信後、受付番号をお控えください。確定金額・送料をご案内後、BASEで決済となります。',
      '在庫は先着のため、送信後に欠品となる場合があります（確保中表示がある場合はその時間内は確保）。',
      // 赤字メッセージ追加
      '<span style="color:#b8002a;">30点以上で10％割引 ／ 会員登録で10％OFF（2026年9月末まで・併用可）</span>'
    ],
    // 次のステップ（受付番号コピー〜発送まで）は不要になったため空配列に
    nextSteps: [],
    basePaymentUrl: 'https://nkonline.buyshop.jp/'
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

//                            小      大       ※全て税込
const SHIPPING_RATES = {
  minami_kyushu:       [1320,  1700],
  kita_kyushu:         [1280,  1620],
  shikoku:             [1180,  1440],
  chugoku:             [1200,  1480],
  kansai:              [1100,  1260],
  hokuriku:            [1160,  1420],
  tokai:               [1180,  1440],
  shinetsu:            [1220,  1540],
  kanto:               [1300,  1680],
  minami_tohoku:       [1400,  1900],
  kita_tohoku:         [1460,  1980],
  hokkaido:            [1640,  2380],
  okinawa:             [2500,  3500]
};

// 離島リスト（配送対象外）
const REMOTE_ISLANDS = [
  // 東京都離島
  '大島町', '利島村', '新島村', '神津島村', '三宅村', '御蔵島村', '八丈町', '青ヶ島村', '小笠原村',
  // 鹿児島県離島（本土以外）
  '奄美市', '大和村', '宇検村', '瀬戸内町', '龍郷町', '喜界町', '徳之島町', '天城町', '伊仙町',
  '和泊町', '知名町', '与論町', '三島村', '十島村',
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
 * 住所と点数から送料を計算（箱サイズ: ≤10点=小、>10点=大）
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
  var sizeIdx = (totalCount <= 10) ? 0 : 1;
  return SHIPPING_RATES[area][sizeIdx];
}

function app_readBrandList_() {
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
  return out;
}
