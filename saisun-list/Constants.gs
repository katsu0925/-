// Constants.gs
// =====================================================
// Constants.gs — マジックナンバー・定数集約
// 各ファイルで散在していた数値・文字列定数を一元管理
// =====================================================

/**
 * 認証関連の定数
 */
var AUTH_CONSTANTS = {
  // パスワードハッシュ
  HASH_ITERATIONS: 1000,                          // SHA-256反復回数（GAS環境: レート制限+ソルトで補強）
  SALT_LENGTH: 16,                                 // ソルト文字列長
  HASH_PREFIX: 'v2',                               // 現行ハッシュバージョン

  // パスワード要件
  MIN_PASSWORD_LENGTH: 6,                          // 最小パスワード長
  TEMP_PASSWORD_LENGTH: 8,                         // 仮パスワード長

  // セッション
  SESSION_ID_LENGTH: 32,                           // セッションID文字列長
  SESSION_DURATION_MS: 24 * 60 * 60 * 1000,       // 標準セッション有効期間（24時間）
  SESSION_REMEMBER_ME_MS: 30 * 24 * 60 * 60 * 1000, // RememberMe有効期間（30日）

  // メールマスク
  EMAIL_MASK_MAX_STARS: 5,                         // メールアドレスマスク最大アスタリスク数

  // 仮パスワード
  TEMP_PASSWORD_EXPIRY_MS: 30 * 60 * 1000,        // 仮パスワード有効期限（30分）

  // CSRFトークン
  CSRF_TOKEN_LENGTH: 32,                           // CSRFトークン文字列長
  CSRF_TOKEN_EXPIRY_SEC: 3600                      // CSRFトークン有効期間（1時間）
};

/**
 * 決済関連の定数
 */
var PAYMENT_CONSTANTS = {
  KOMOJU_API_URL: 'https://komoju.com/api/v1',
  PAYMENT_EXPIRY_SECONDS: 259200,                  // 決済期限（3日 = 72時間）
  PAYMENT_METHODS: ['credit_card', 'konbini', 'bank_transfer', 'paypay', 'pay_easy', 'apple_pay', 'paidy']
  // LINE Pay: サービス終了のため削除
};

/**
 * reCAPTCHA関連
 */
var RECAPTCHA_CONSTANTS = {
  VERIFY_URL: 'https://www.google.com/recaptcha/api/siteverify',
  SCORE_THRESHOLD: 0.3                             // これ未満はbot判定
};

/**
 * 税率
 */
var TAX_RATE = 0.10;                               // 消費税10%

/**
 * 送料計算の閾値・pt制箱詰め設定（2026-07 送料改定）
 */
var SHIPPING_CONSTANTS = {
  FREE_SHIP_THRESHOLD: 10000,                      // 商品合計これ以上で送料無料（FHP/価格破壊・沖縄県は対象外、ダイヤ会員は全地域無料）
  ALWAYS_CHARGE_BULK_IDS: ['BLK-H2LZTP36'],        // ¥10,000以上ルールを無効化する価格破壊商品ID（アソート）

  // pt制: 薄手(ゆうパケットポスト)=1pt / 厚手=2pt
  ITEM_POINTS: { thin: 1, thick: 2 },
  // 箱サイズごとの収容pt（昇順。DPは同額なら小さい箱を選ぶ）
  BOX_CAPACITY: { '60': 2, '80': 4, '100': 10, '140': 20, '160': 40 },
  BOX_SIZES: ['60', '80', '100', '140', '160'],

  // クリックポスト: デタウリが薄手ちょうど1点のとき適用（全国一律・沖縄含む）
  CLICKPOST_PRICE: 280,                            // 顧客価格（税込・全国一律）※改定後も据え置き

  // 実費は 2026-10-01（JST）の日本郵便運賃改定で 185→240 円。
  // 呼び出し側（SubmitFix.gs / SyncApi.gs）を一切変更せずに切り替えるため、
  // CLICKPOST_COST は日付判定するゲッターにしている。
  // ※ SyncApi.gs が D1 SHIPPING_CONFIG_V2 に流すため、Worker 側も 5分Cron で自動追随する
  CLICKPOST_COST_BEFORE: 185,                      // 改定前の実費
  CLICKPOST_COST_AFTER: 240,                       // 改定後の実費
  CLICKPOST_COST_CHANGE_YMD: '20261001',           // この日（JST）以降 AFTER を適用
  get CLICKPOST_COST() { return getClickpostCost_(); }
};

/**
 * クリックポストの実費を返す（2026-10-01 JST の運賃改定を日付で自動切替）
 * @param {Date} [baseDate] 判定基準日。省略時は現在時刻。テストから境界日を渡すために引数化している
 * @return {number} 185（改定前）または 240（改定後）
 */
function getClickpostCost_(baseDate) {
  var d = (baseDate instanceof Date) ? baseDate : new Date();
  var ymd = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
  return (ymd >= SHIPPING_CONSTANTS.CLICKPOST_COST_CHANGE_YMD)
    ? SHIPPING_CONSTANTS.CLICKPOST_COST_AFTER
    : SHIPPING_CONSTANTS.CLICKPOST_COST_BEFORE;
}

/**
 * 時間定数（ミリ秒）
 */
var TIME_CONSTANTS = {
  ONE_HOUR_MS: 60 * 60 * 1000,
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  ONE_MONTH_MS: 30 * 24 * 60 * 60 * 1000,
  ONE_YEAR_MS: 365 * 24 * 60 * 60 * 1000,
  TWO_YEARS_MS: 730 * 24 * 60 * 60 * 1000
};

/**
 * 依頼管理シートの列番号（1-indexed）
 */
var REQUEST_SHEET_COLS = {
  RECEIPT_NO: 1,        // A: 受付番号
  DATETIME: 2,          // B: 依頼日時
  COMPANY_NAME: 3,      // C: 会社名/氏名
  CONTACT: 4,           // D: 連絡先メール
  POSTAL: 5,            // E: 郵便番号
  ADDRESS: 6,           // F: 住所
  PHONE: 7,             // G: 電話番号
  PRODUCT_NAMES: 8,     // H: 商品名
  CONFIRM_LINK: 9,      // I: 確認リンク
  SELECTION_LIST: 10,   // J: 選択リスト
  TOTAL_COUNT: 11,      // K: 合計点数
  TOTAL_AMOUNT: 12,     // L: 合計金額
  SHIP_COST_SHOP: 13,   // M: 送料(店負担)
  SHIP_COST_CUST: 14,   // N: 送料(客負担)
  PAYMENT_METHOD: 15,   // O: 決済方法
  PAYMENT_ID: 16,       // P: 決済ID
  PAYMENT: 17,          // Q: 入金確認
  POINTS_AWARDED: 18,   // R: ポイント付与済
  SHIP_STATUS: 19,      // S: 発送ステータス
  CARRIER: 20,          // T: 配送業者
  TRACKING: 21,         // U: 伝票番号
  STATUS: 22,           // V: ステータス
  STAFF: 23,            // W: 担当者
  LIST_ENCLOSED: 24,    // X: リスト同梱
  XLSX_SENT: 25,        // Y: xlsx送付
  INVOICE_REQ: 26,      // Z: インボイス発行
  INVOICE_SENT: 27,     // AA: インボイス状況
  NOTIFY_FLAG: 28,      // AB: 受注通知
  SHIP_NOTIFY_FLAG: 29, // AC: 発送通知
  NOTE: 30,             // AD: 備考
  REWARD: 31,           // AE: 作業報酬
  UPDATED_AT: 32,       // AF: 更新日時
  CHANNEL: 33,          // AG: チャネル（デタウリ/アソート）
  TRACKING_URL: 34,     // AH: 追跡URL
  ITEM_PRICES: 35,      // AI: 商品単価JSON（注文時価格の永続化）
  KIT_URL: 36,          // AJ: 出品キットURL
  SHIP_SIZE: 37,        // AK: 発送サイズ（クリックポスト/中箱/大箱）※作業報酬の算定に使用
  CP_ISSUED_AT: 38      // AL: CP発行日時（クリックポストのラベルCSVを発行した日時。二重発行防止マーカー）
};

/**
 * 発送作業報酬（AE列）の数式を生成する共通ヘルパー。
 * 依頼管理シートへの行書込時に呼び出し、AE列に焼き込む。
 *
 * 報酬の考え方（2026-07-25 改定・発送サイズ別）:
 *  - デタウリ単品（channel==='デタウリ'）: 1回の発送＝発送サイズ（AK列）の額そのまま（点数掛けなし）
 *      クリックポスト=50 / 中箱=100 / 大箱=250。AK未選択なら空欄（作業者がサイズを選ぶと自動計算）
 *  - アソート系（アソート/デタウリ(アソート)/デタウリ+アソート/まとめ/BASE取込=チャネル空欄）:
 *      140サイズ段ボールに数量を詰める運用のため 箱数(K列)×250 固定
 *  いずれも T列（配送業者）が未入力の間は空欄（＝未発送なら報酬0）。
 *
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（'デタウリ' のみサイズ別、それ以外はアソート扱い）
 * @return {string} AE列に設定する数式文字列
 */
function buildRewardFormula_(rowNum, channel) {
  var r = rowNum;
  if (channel === 'デタウリ') {
    return '=IF(T' + r + '="","",IF(AK' + r + '="クリックポスト",50,IF(AK' + r + '="中箱",100,IF(AK' + r + '="大箱",250,""))))';
  }
  // アソート系はすべて 箱数×250 固定
  return '=IF(T' + r + '="","",250*K' + r + ')';
}

/**
 * 顧客管理シートの列番号（0-indexed、getValues用）
 */
var CUSTOMER_SHEET_COLS = {
  ID: 0,              // A: 顧客ID
  EMAIL: 1,           // B: メールアドレス
  PASSWORD: 2,        // C: パスワードハッシュ
  COMPANY_NAME: 3,    // D: 会社名/氏名
  PHONE: 4,           // E: 電話番号
  POSTAL: 5,          // F: 郵便番号
  ADDRESS: 6,         // G: 住所
  NEWSLETTER: 7,      // H: メルマガ
  CREATED_AT: 8,      // I: 登録日時
  LAST_LOGIN: 9,      // J: 最終ログイン
  SESSION_ID: 10,     // K: セッションID
  SESSION_EXPIRY: 11, // L: セッション有効期限
  POINTS: 12,         // M: ポイント残高
  POINTS_UPDATED_AT: 13, // N: ポイント更新日
  PURCHASE_COUNT: 14,   // O: 購入回数
  MAIL_ERROR: 15        // P: 配信不可（バウンス検知・送信エラー。値があるとメルマガ配信から除外）
};

/**
 * サイト共通情報
 */
var SITE_CONSTANTS = {
  SITE_NAME: 'デタウリ.Detauri',
  SITE_URL: (function() { try { return PropertiesService.getScriptProperties().getProperty('SITE_URL') || 'https://wholesale.nkonline-tool.com/'; } catch(e) { return 'https://wholesale.nkonline-tool.com/'; } })(),
  CONTACT_EMAIL: (function() { try { return PropertiesService.getScriptProperties().getProperty('CONTACT_EMAIL') || ''; } catch(e) { return ''; } })(),
  CUSTOMER_EMAIL: 'nkonline1030@gmail.com'
};

/**
 * 環境設定
 * ScriptPropertiesの ENV キーで 'production' / 'staging' / 'development' を切り替え。
 * 未設定時は 'production' として動作。
 */
var ENV_CONFIG = {
  /** 現在の環境を取得 */
  getEnv: function() {
    try {
      return PropertiesService.getScriptProperties().getProperty('ENV') || 'production';
    } catch (e) {
      return 'production';
    }
  },
  /** 本番環境かどうか */
  isProduction: function() { return ENV_CONFIG.getEnv() === 'production'; },
  /** 開発環境かどうか */
  isDevelopment: function() { return ENV_CONFIG.getEnv() === 'development'; },
  /** ステージング環境かどうか */
  isStaging: function() { return ENV_CONFIG.getEnv() === 'staging'; }
};
