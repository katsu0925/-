// =====================================================
// Constants.gs — マジックナンバー・定数集約
// 各ファイルで散在していた数値・文字列定数を一元管理
// =====================================================

/**
 * 認証関連の定数
 */
var AUTH_CONSTANTS = {
  // パスワードハッシュ
  HASH_ITERATIONS: 10000,                         // SHA-256反復回数（OWASP推奨10,000以上）
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
  PAYMENT_METHODS: ['credit_card', 'konbini', 'bank_transfer', 'paypay', 'pay_easy', 'apple_pay']
  // 申請中: paidy
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
 * 送料計算の閾値
 */
var SHIPPING_CONSTANTS = {
  SIZE_THRESHOLD: 10                               // この数以下=小型、超=大型
};

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
  UPDATED_AT: 32        // AF: 更新日時
};

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
  POINTS: 12          // M: ポイント残高
};

/**
 * サイト共通情報
 */
var SITE_CONSTANTS = {
  SITE_NAME: 'デタウリ.Detauri',
  SITE_URL: (function() { try { return PropertiesService.getScriptProperties().getProperty('SITE_URL') || 'https://wholesale.nkonline-tool.com/'; } catch(e) { return 'https://wholesale.nkonline-tool.com/'; } })(),
  CONTACT_EMAIL: (function() { try { return PropertiesService.getScriptProperties().getProperty('CONTACT_EMAIL') || ''; } catch(e) { return ''; } })()
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
