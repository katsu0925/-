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
 *
 * ★2026-08-27 列移設: 発送作業者が入力する「発送サイズ」「箱数」を、同じく作業者が入力する
 *   T列(配送業者)・U列(伝票番号) の直後（V/W列）へ移した。旧レイアウトでは発送サイズが
 *   AK列（右端）にあり入力漏れ＝報酬の払い漏れが起きていたため。
 *   シート側の移設は migrateShipSizeColumns()（RequestSheetRepair.gs）で1回だけ実行する。
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
  CONFIRM_LINK: 9,      // I: ピッキングリスト（外注の作業用紙。依頼展開時に設定）
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
  SHIP_SIZE: 22,        // V: 発送サイズ（クリックポスト/中箱/大箱）※作業報酬の算定に使用
  BOX_COUNT: 23,        // W: 箱数（空欄=1箱として計算）※作業報酬の算定に使用
  STATUS: 24,           // X: ステータス
  STAFF: 25,            // Y: 担当者
  LIST_ENCLOSED: 26,    // Z: リスト同梱
  XLSX_SENT: 27,        // AA: キット送付
  INVOICE_REQ: 28,      // AB: インボイス発行
  INVOICE_SENT: 29,     // AC: インボイス状況
  NOTIFY_FLAG: 30,      // AD: 受注通知
  SHIP_NOTIFY_FLAG: 31, // AE: 発送通知
  NOTE: 32,             // AF: 備考
  REWARD: 33,           // AG: 作業報酬
  UPDATED_AT: 34,       // AH: 更新日時
  CHANNEL: 35,          // AI: チャネル（デタウリ/アソート）
  TRACKING_URL: 36,     // AJ: 追跡URL
  ITEM_PRICES: 37,      // AK: 商品単価JSON（注文時価格の永続化）
  KIT_URL: 38,          // AL: 出品キットURL
  CP_ISSUED_AT: 39      // AM: CP発行日時（クリックポストのラベルCSVを発行した日時。二重発行防止マーカー）
};

/** 依頼管理シートの総列数（新規シート作成・列不足時の拡張に使う）。 */
var REQUEST_SHEET_LAST_COL = REQUEST_SHEET_COLS.CP_ISSUED_AT;

/**
 * 列番号（1-based）を A1記法の列文字へ変換する。
 * 報酬数式を REQUEST_SHEET_COLS から組み立てるために使う
 * （列を移動しても定数を直すだけで数式が追随するようにするため）。
 */
function colLetter_(colNum) {
  var n = Number(colNum), s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m - 1) / 26);
  }
  return s;
}

/** 大箱で1箱あたりの単価が割増（250→350円）になる配送業者。 */
var REWARD_CARRIER_PREMIUM_ = '日本郵便';

/**
 * 発送サイズ別報酬（v2）の適用開始日。
 * これより前の依頼日時の行は、旧ルールの数式が入っていても書き換えない
 * （＝過去に確定・支払済みの報酬額を遡って変えない）。
 */
var REWARD_SCHEME_V2_START_ = new Date(2026, 6, 25); // 2026-07-25

/**
 * 「発送サイズ×箱数」一本化（v3）の適用開始日。
 * これより前の行は v2 の数式（デタウリ=サイズ額フラット／アソート=250×K）のまま据え置く。
 */
var REWARD_SCHEME_V3_START_ = new Date(2026, 7, 27); // 2026-08-27

/**
 * 発送作業報酬（AG列）の数式を生成する共通ヘルパー（現行 = v3）。
 * 依頼管理シートへの行書込時に呼び出し、AG列に焼き込む。
 *
 * 報酬の考え方（2026-08-27 改定・チャネル非依存の「サイズ×箱数」一本化）:
 *  - 単価 = 発送サイズ(V列): クリックポスト=50 / 中箱=100 / 大箱=250
 *      **大箱かつ配送業者(T列)が日本郵便なら 350**
 *  - 報酬 = 単価 × 箱数(W列)。**箱数が空欄なら1箱として計算**（入力漏れによる払い漏れを防ぐ）
 *  - T列（配送業者）が未入力の間は空欄（＝未発送なら報酬0）
 *  - V列（発送サイズ）が未選択の間も空欄（＝作業者がサイズを選ぶと自動計算される）
 *
 * ★クリックポストも配送業者は日本郵便になるが、V='クリックポスト' の判定が先に一致するため
 *   50 のままで正しい（IFの順序を入れ替えない）。
 * ★channel は v2 数式との互換のために受け取るだけで、v3 では使わない
 *   （F1教訓＝BASE取込アソートはチャネル空欄なので、数式でチャネルを判定してはいけない）。
 *
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（v3では未使用）
 * @return {string} AG列に設定する数式文字列
 */
function buildRewardFormula_(rowNum, channel) {
  var r = rowNum;
  var carrier = colLetter_(REQUEST_SHEET_COLS.CARRIER) + r;    // T: 配送業者
  var size = colLetter_(REQUEST_SHEET_COLS.SHIP_SIZE) + r;     // V: 発送サイズ
  var boxes = colLetter_(REQUEST_SHEET_COLS.BOX_COUNT) + r;    // W: 箱数
  // 単価（大箱は日本郵便だけ割増）
  var unit = 'IF(' + size + '="クリックポスト",50,IF(' + size + '="中箱",100,'
           + 'IF(' + carrier + '="' + REWARD_CARRIER_PREMIUM_ + '",350,250)))';
  // サイズが3種のいずれかのときだけ計算する（想定外の値で #VALUE! にしない）
  var sizeFilled = 'OR(' + size + '="クリックポスト",' + size + '="中箱",' + size + '="大箱")';
  // 箱数は空欄=1箱。N() は数値以外を0にするので MAX(1,…) で1箱に丸める
  return '=IF(' + carrier + '="","",IF(' + sizeFilled + ',' + unit + '*MAX(1,N(' + boxes + ')),""))';
}

/**
 * 旧ルール（v2 = 2026-07-25〜2026-08-26）の数式。
 * v3 改定日より前の行を自己修復が書き換えてしまわないよう、比較用に残してある。
 * ★列移設（発送サイズ AK→V）に合わせて列文字も新レイアウトで生成する。
 *   シート側の moveColumns は既存数式の参照を自動で追従させるため、
 *   移設後のシートに入っている v2 数式も V列を参照した形になっている。
 *
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（'デタウリ' のみサイズ額フラット、それ以外はアソート扱い）
 * @return {string} v2 の数式文字列
 */
function buildRewardFormulaV2_(rowNum, channel) {
  var r = rowNum;
  var size = colLetter_(REQUEST_SHEET_COLS.SHIP_SIZE) + r;
  var bigBox = 'IF(T' + r + '="' + REWARD_CARRIER_PREMIUM_ + '",350,250)';
  if (channel === 'デタウリ') {
    return '=IF(T' + r + '="","",IF(' + size + '="クリックポスト",50,IF(' + size + '="中箱",100,IF(' + size + '="大箱",' + bigBox + ',""))))';
  }
  return '=IF(T' + r + '="","",' + bigBox + '*K' + r + ')';
}

/** 数式文字列の先頭 '=' を外す（別の数式へ埋め込むためのヘルパー）。 */
function stripRewardFormulaEquals_(formula) {
  var f = String(formula || '');
  return f.charAt(0) === '=' ? f.slice(1) : f;
}

/**
 * v3改定日より前の行に入れる数式（v2据え置き＋箱数入力ありなら新ルール）。
 *
 * 原則は v2 のまま据え置き（確定・支払済みの報酬を遡って変えない）。
 * ただし **発送サイズ(V列)と箱数(W列)が両方入力されている行だけ** は v3（単価×箱数）で計算する。
 * 箱数(W列)は 2026-08-27 に新設した列なので、手を入れていない過去の行は必ず空欄＝v2のまま。
 * つまり遡及的な減給・増給は起きず、**発送者が箱数を入れた行だけがその場で正しい額になる**。
 *
 * ★シート数式側で分岐させているのがポイント。コード側のフラグで切り替えると、
 *   箱数を入力しても翌朝4時の自己修復が走るまで金額が変わらない（＝入力しても反応しない）。
 * ★両方の入力を条件にしているのは、箱数だけ入れた旧アソート行（発送サイズ空欄）が
 *   v3では空欄＝¥0に落ちてしまうのを避けるため。
 *
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（v2側の分岐に使う）
 * @return {string} 数式文字列
 */
function buildRewardFormulaV2WithBoxOverride_(rowNum, channel) {
  var r = rowNum;
  var size = colLetter_(REQUEST_SHEET_COLS.SHIP_SIZE) + r;   // V: 発送サイズ
  var boxes = colLetter_(REQUEST_SHEET_COLS.BOX_COUNT) + r;  // W: 箱数
  var v3 = stripRewardFormulaEquals_(buildRewardFormula_(r, channel));
  var v2 = stripRewardFormulaEquals_(buildRewardFormulaV2_(r, channel));
  return '=IF(AND(' + size + '<>"",' + boxes + '<>""),' + v3 + ',' + v2 + ')';
}

/**
 * 依頼日時に応じて「その行に入っているべき数式」を返す。
 * v3改定日より前の行は v2 のまま据え置く（確定・支払済みの報酬を遡って変えない）。
 * ただし据え置き行でも **発送サイズと箱数が両方入力されていれば v3（単価×箱数）** で計算する
 * （`buildRewardFormulaV2WithBoxOverride_` 参照。箱数は新設列なので過去行は空欄＝据え置きのまま）。
 *
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（AI列）
 * @param {Date} [requestDate] 依頼日時（B列）。省略時は現行(v3)扱い
 * @return {string} 数式文字列
 */
function buildRewardFormulaForDate_(rowNum, channel, requestDate) {
  if (requestDate instanceof Date && requestDate.getTime() && requestDate < REWARD_SCHEME_V3_START_) {
    return buildRewardFormulaV2WithBoxOverride_(rowNum, channel);
  }
  return buildRewardFormula_(rowNum, channel);
}

/**
 * AG列に入っている数式が「その行に入っているべき数式」と一致しているかを判定する。
 *
 * ★「配送業者名を含むか」で旧数式を見分ける方式は使えない。2026-08-13 の日本郵便割増で
 *   数式自身が '日本郵便' を含むようになったため。
 *   代わりに **期待される数式と完全一致するか**（空白差は無視）で判定する。
 *   一致しない＝旧ルール or 手書き の数式 とみなす。
 *
 * 差し替え対象になった実例（コードには存在せず、シート上で手作業により列全体へドラッグされたもの）:
 *   =IF(T{r}="","",IF(B{r}>=DATE(2026,6,1),
 *      IF(T{r}="日本郵便",350*K{r},IF(OR(T{r}="佐川急便",T{r}="ヤマト運輸"),250*K{r},"")),
 *      IF(T{r}="日本郵便",300*K{r},IF(OR(T{r}="佐川急便",T{r}="ヤマト運輸"),200*K{r},""))))
 *
 * @param {string} formula AG列の数式文字列
 * @param {number} rowNum 対象行番号（1-based）
 * @param {string} channel チャネル（AI列）
 * @param {Date} [requestDate] 依頼日時（B列）
 * @return {boolean} その行に入っているべき数式なら true
 */
function isCurrentRewardFormula_(formula, rowNum, channel, requestDate) {
  var f = normalizeRewardFormula_(formula);
  if (!f) return false;
  return f === normalizeRewardFormula_(buildRewardFormulaForDate_(rowNum, channel, requestDate));
}

/** 数式比較用の正規化（空白の有無だけの差で作り直さないようにする）。 */
function normalizeRewardFormula_(formula) {
  return String(formula || '').replace(/\s+/g, '');
}

/**
 * 依頼管理シートの AF列（更新日時）に現在時刻を打ち直す共通ヘルパー。
 * 入金確認(Q列)など、行の状態を変える書き込みの直後に呼ぶ。
 * プログラムからの setValue では onEdit が発火しないため、書き込み側で明示的に呼ぶ必要がある。
 *
 * @param {Sheet} sheet 依頼管理シート
 * @param {number} row 対象行番号（1-based / ヘッダー行は対象外）
 * @param {Date} [when] 打刻する日時（省略時は現在時刻）
 */
function touchRequestUpdatedAt_(sheet, row, when) {
  try {
    if (!sheet || !(row >= 2)) return;
    sheet.getRange(row, REQUEST_SHEET_COLS.UPDATED_AT).setValue(when || new Date());
  } catch (e) {
    console.error('touchRequestUpdatedAt_ error (row=' + row + '):', e);
  }
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
