// Product.gs
function sh_getProductSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sh_getDataSs_() {
  return SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
}

function sh_getOrderSs_() {
  return SpreadsheetApp.openById(app_getOrderSpreadsheetId_());
}

/** 依頼管理 / 依頼管理_アーカイブ のヘッダー（A〜AI列）。AJ以降は sh_applyRequestStatusDropdown_ で付与。 */
const REQUEST_SHEET_HEADER_ = [
  '受付番号','依頼日時','会社名/氏名','連絡先','郵便番号','住所','電話番号','商品名',
  '確認リンク','選択リスト','合計点数','合計金額','送料(店負担)','送料(客負担)','決済方法','決済ID',
  '入金確認','ポイント付与済','発送ステータス','配送業者','伝票番号','発送サイズ','箱数','ステータス','担当者',
  'リスト同梱','xlsx送付','インボイス発行','インボイス状況','受注通知',
  '発送通知','備考','作業報酬','更新日時','チャネル'
];

/**
 * 【1回だけ効く列移設】発送サイズ／箱数を V・W列（配送業者・伝票番号の隣）へ移す。
 *
 * 旧レイアウト: … T=配送業者, U=伝票番号, V=ステータス, …, AK=発送サイズ, AL=CP発行日時
 * 新レイアウト: … T=配送業者, U=伝票番号, V=発送サイズ, W=箱数, X=ステータス, …
 *
 * ★必ず moveColumns / insertColumnsBefore を使う（コピー＋deleteColumn は禁止）。
 *   前者はシート上の既存数式の参照を自動追従させるため、過去行の作業報酬の数式が
 *   #REF! にならずそのまま計算され続ける。後者は確定済みの報酬額を壊す。
 *
 * 判定は「22列目のヘッダーが『ステータス』か」だけで行う（＝旧レイアウトの動かぬ証拠）。
 * 移設済みなら何もしないので、何度呼んでも安全。
 *
 * @param {Sheet} sh 依頼管理 または 依頼管理_アーカイブ
 * @return {boolean} 移設を実行したら true
 */
function sh_migrateShipSizeColumns_(sh) {
  try {
    if (!sh || sh.getMaxColumns() < REQUEST_SHEET_COLS.SHIP_SIZE) return false;
    const at22 = String(sh.getRange(1, REQUEST_SHEET_COLS.SHIP_SIZE).getValue() || '').trim();
    if (at22 !== 'ステータス') return false; // 旧レイアウトではない＝移設済み or 新規シート

    const oldShipSizeCol = 37; // 旧AK列
    const hasOldShipSize = sh.getMaxColumns() >= oldShipSizeCol &&
      String(sh.getRange(1, oldShipSizeCol).getValue() || '').trim() === '発送サイズ';

    if (hasOldShipSize) {
      // AK(37) を V(22) へ移動 → 旧22〜36が23〜37へずれる。既存数式の参照も自動追従。
      sh.moveColumns(sh.getRange(1, oldShipSizeCol, 1, 1), REQUEST_SHEET_COLS.SHIP_SIZE);
      // 箱数(W)を新設
      sh.insertColumnsBefore(REQUEST_SHEET_COLS.BOX_COUNT, 1);
    } else {
      // アーカイブ等、発送サイズ列を持たないシートは空2列を挿入するだけ
      sh.insertColumnsBefore(REQUEST_SHEET_COLS.SHIP_SIZE, 2);
    }
    // 挿入列が左隣の入力規則を引き継ぐことがあるので、箱数列は明示的に張り替える
    sh.getRange(2, REQUEST_SHEET_COLS.BOX_COUNT, Math.max(1, sh.getMaxRows() - 1), 1).clearDataValidations();
    console.log('依頼管理の列移設を実行: ' + sh.getName());
    return true;
  } catch (e) {
    console.error('sh_migrateShipSizeColumns_ error (' + (sh && sh.getName()) + '):', e);
    return false;
  }
}

function sh_ensureRequestSheet_(ss) {
  const name = String(APP_CONFIG.order.requestSheetName || '依頼管理');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // 列構成（39列 A-AM）:
  // A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=送料(店負担), N=送料(客負担), O=決済方法, P=決済ID,
  // Q=入金確認, R=ポイント付与済, S=発送ステータス, T=配送業者, U=伝票番号,
  // V=発送サイズ, W=箱数, X=ステータス, Y=担当者,
  // Z=リスト同梱, AA=xlsx送付, AB=インボイス発行, AC=インボイス状況, AD=受注通知,
  // AE=発送通知, AF=備考, AG=作業報酬, AH=更新日時, AI=チャネル,
  // AJ=追跡URL, AK=商品単価JSON, AL=出品キットURL, AM=CP発行日時
  // ★列を移設した直後の書き込みで列ズレを起こさないよう、ヘッダー確認より先に移設を試みる
  sh_migrateShipSizeColumns_(sh);
  const header = REQUEST_SHEET_HEADER_;
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  // AM列（39, CP発行日時）までの物理存在を保証。
  // V(発送サイズ)/W(箱数)は作業報酬(AG)の数式が参照するため列が無いと #REF! になる。
  // AMはクリックポストCSVの二重発行防止マーカー（ClickPost.gs）で使用する。
  // AJ以降のヘッダー/プルダウンは sh_applyRequestStatusDropdown_ で付与。
  if (sh.getMaxColumns() < REQUEST_SHEET_COLS.CP_ISSUED_AT) {
    sh.insertColumnsAfter(sh.getMaxColumns(), REQUEST_SHEET_COLS.CP_ISSUED_AT - sh.getMaxColumns());
  }
  return sh;
}

function sh_ensureHoldSheet_(ss) {
  const name = String(APP_CONFIG.order.holdSheetName || '確保');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = ['管理番号','確保ID','userKey','確保期限','作成日時'];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_ensureArchiveSheet_(ss) {
  const name = '依頼管理_アーカイブ';
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // 依頼管理と同じ並びに揃える（過去行と新規追記の列がズレないよう先に移設）
  sh_migrateShipSizeColumns_(sh);
  const header = REQUEST_SHEET_HEADER_;
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_ensureOpenLogSheet_(ss) {
  const name = String(APP_CONFIG.order.openLogSheetName || '依頼中');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = ['管理番号', '受付番号', 'ステータス', '更新日時'];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

function sh_applyRequestStatusDropdown_(ss) {
  const sh = sh_ensureRequestSheet_(ss);
  const maxRows = sh.getMaxRows();
  const rows = Math.max(1, maxRows - 1);
  // X列(24): ステータス（依頼中/発送済み等）
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(APP_CONFIG.statuses.allowed, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, REQUEST_SHEET_COLS.STATUS, rows, 1).setDataValidation(statusRule);

  // Q列(17): 入金確認ステータス
  const paymentRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['入金待ち', '未対応', '対応済'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, REQUEST_SHEET_COLS.PAYMENT, rows, 1).setDataValidation(paymentRule);

  // V列(22): 発送サイズ ／ W列(23): 箱数 — 発送作業者が入力する2列（作業報酬の算定に使用）
  // 報酬 = 単価(クリックポスト50 / 中箱100 / 大箱250。大箱かつ日本郵便は350) × 箱数（空欄=1箱）
  const SHIP_SIZE_COL = REQUEST_SHEET_COLS.SHIP_SIZE;
  const BOX_COUNT_COL = REQUEST_SHEET_COLS.BOX_COUNT;
  if (sh.getMaxColumns() < REQUEST_SHEET_COLS.CP_ISSUED_AT) {
    sh.insertColumnsAfter(sh.getMaxColumns(), REQUEST_SHEET_COLS.CP_ISSUED_AT - sh.getMaxColumns());
  }
  sh.getRange(1, SHIP_SIZE_COL).setValue('発送サイズ');
  const shipSizeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['クリックポスト', '中箱', '大箱'], true)
    .setAllowInvalid(false)
    .setHelpText('中箱＝60〜120サイズ／大箱＝140サイズ以上。伝票に書くサイズをそのまま選んでください（クリックポストで送れるものは「クリックポスト」）')
    .build();
  sh.getRange(2, SHIP_SIZE_COL, rows, 1).setDataValidation(shipSizeRule);

  sh.getRange(1, BOX_COUNT_COL).setValue('箱数');
  const boxCountRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .setHelpText('発送した箱の数を入力してください（空欄なら1箱として計算されます）')
    .build();
  sh.getRange(2, BOX_COUNT_COL, rows, 1).setDataValidation(boxCountRule);

  // AM列(39): CP発行日時（クリックポストのラベルCSVを発行した日時）
  // 同じ注文のラベルを二重に発行しないためのマーカー。プルダウンは付けない（自動記録のみ）。
  sh.getRange(1, REQUEST_SHEET_COLS.CP_ISSUED_AT).setValue('CP発行日時');
  return true;
}

function sh_ensureAllOnce_(ss) {
  const props = PropertiesService.getScriptProperties();
  const k = 'SHEETS_READY_V5:' + ss.getId();
  if (props.getProperty(k) === '1') return;
  sh_ensureRequestSheet_(ss);
  sh_ensureHoldSheet_(ss);
  sh_ensureOpenLogSheet_(ss);
  sh_ensureCouponSheet_(ss);
  sh_ensureCouponLogSheet_(ss);
  sh_applyRequestStatusDropdown_(ss);
  props.setProperty(k, '1');
}

// =====================================================
// GASエディタから実行できる関数
// =====================================================

/**
 * 依頼管理シートのヘッダーを更新
 * GASエディタから直接実行可能
 */
function updateRequestSheetHeaders() {
  const ss = sh_getOrderSs_();
  // キャッシュをリセットして強制更新
  const props = PropertiesService.getScriptProperties();
  const k = 'SHEETS_READY_V4:' + ss.getId();
  props.deleteProperty(k);

  sh_ensureRequestSheet_(ss);
  console.log('依頼管理シートのヘッダーを更新しました');
}

/**
 * 依頼管理シートにステータスと入金確認のプルダウンを適用
 * GASエディタから直接実行可能
 */
function applyStatusDropdowns() {
  const ss = sh_getOrderSs_();
  sh_applyRequestStatusDropdown_(ss);
  console.log('ステータスと入金確認のプルダウンを適用しました');
}

/**
 * 依頼管理シートを完全に初期化（ヘッダー更新＋プルダウン適用）
 * GASエディタから直接実行可能
 */
function initializeRequestSheet() {
  const ss = sh_getOrderSs_();
  // キャッシュをリセット
  const props = PropertiesService.getScriptProperties();
  const k = 'SHEETS_READY_V4:' + ss.getId();
  props.deleteProperty(k);

  sh_ensureRequestSheet_(ss);
  sh_ensureHoldSheet_(ss);
  sh_ensureOpenLogSheet_(ss);
  sh_applyRequestStatusDropdown_(ss);

  props.setProperty(k, '1');
  console.log('依頼管理シートを初期化しました（ヘッダー＋プルダウン）');
}

/**
 * 商品詳細を取得（高速キャッシュ版）
 * 目標: 1秒未満
 */
function pr_getProductDetail_(managedId) {
  if (!managedId) return null;
  
  const id = String(managedId).trim();
  
  // ★キャッシュから取得を試みる（超高速）
  const cache = CacheService.getScriptCache();
  const cacheKey = 'PRODUCT_DETAIL_' + id;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) { console.warn('Cache parse error:', e.message || e); }
  }
  
  // キャッシュにない場合はシートから取得
  const detail = pr_getProductDetailFromSheet_(id);
  
  // キャッシュに保存（5分間）
  if (detail) {
    try {
      cache.put(cacheKey, JSON.stringify(detail), 300);
    } catch (e) { console.warn('Cache parse error:', e.message || e); }
  }
  
  return detail;
}


/**
 * シートから商品詳細を取得（内部関数）
 */
function pr_getProductDetailFromSheet_(id) {
  const ss = sh_getProductSs_();
  const sheet = ss.getSheetByName('データ1');
  if (!sheet) return null;
  
  // ★最適化: 必要な範囲だけ取得
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const headers = data[0] || [];
  // 共通ユーティリティ u_findCol_ を使用
  var findCol = function(names) { return u_findCol_(headers, names); };

  const colManagedId = findCol(['管理番号']);
  const colBrand = findCol(['ブランド']);
  const colState = findCol(['状態']);
  const colCategory = findCol(['カテゴリ']);
  const colSize = findCol(['サイズ']);
  const colGender = findCol(['性別']);
  const colColor = findCol(['カラー', '色']);
  const colPrice = findCol(['価格']);
  
  // 採寸データ列（全12項目）
  const colTake = findCol(['着丈']);
  const colShoulder = findCol(['肩幅']);
  const colChest = findCol(['身幅']);
  const colSleeve = findCol(['袖丈']);
  const colYuki = findCol(['桁丈', '裄丈']);
  const colTotal = findCol(['総丈']);
  const colWaist = findCol(['ウエスト']);
  const colRise = findCol(['股上']);
  const colInseam = findCol(['股下']);
  const colThigh = findCol(['ワタリ']);
  const colHem = findCol(['裾幅']);
  const colHip = findCol(['ヒップ']);
  const colDefect = findCol(['傷汚れ詳細', '傷汚れ']);
  
  if (colManagedId < 0) return null;
  
  // 対象行を検索（1行目はヘッダーなので i=1 から）
  let targetRow = null;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const rowId = String(row[colManagedId] || '').trim();
    if (rowId === id) {
      targetRow = row;
      break;
    }
  }
  
  if (!targetRow) return null;
  
  // 採寸データを構築
  const measurements = {};
  
  function addMeasure(label, colIndex) {
    if (colIndex < 0) return;
    const val = targetRow[colIndex];
    if (val !== '' && val !== null && val !== undefined) {
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        measurements[label] = num;
      }
    }
  }
  
  addMeasure('着丈', colTake);
  addMeasure('肩幅', colShoulder);
  addMeasure('身幅', colChest);
  addMeasure('袖丈', colSleeve);
  addMeasure('桁丈', colYuki);
  addMeasure('総丈', colTotal);
  addMeasure('ウエスト', colWaist);
  addMeasure('股上', colRise);
  addMeasure('股下', colInseam);
  addMeasure('ワタリ', colThigh);
  addMeasure('裾幅', colHem);
  addMeasure('ヒップ', colHip);
  
  const defectDetail = (colDefect >= 0) ? String(targetRow[colDefect] || '').trim() : '';
  
  return {
    managedId: id,
    brand: (colBrand >= 0) ? String(targetRow[colBrand] || '').trim() : '',
    state: (colState >= 0) ? String(targetRow[colState] || '').trim() : '',
    category: (colCategory >= 0) ? String(targetRow[colCategory] || '').trim() : '',
    size: (colSize >= 0) ? String(targetRow[colSize] || '').trim() : '',
    gender: (colGender >= 0) ? String(targetRow[colGender] || '').trim() : '',
    color: (colColor >= 0) ? String(targetRow[colColor] || '').trim() : '',
    price: (colPrice >= 0) ? Number(targetRow[colPrice] || 0) : 0,
    defectDetail: defectDetail,
    measurements: measurements
  };
}


