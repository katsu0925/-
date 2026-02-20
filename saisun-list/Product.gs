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

function sh_ensureRequestSheet_(ss) {
  const name = String(APP_CONFIG.order.requestSheetName || '依頼管理');
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // 列構成（33列 A-AG）:
  // A=受付番号, B=依頼日時, C=会社名/氏名, D=連絡先, E=郵便番号, F=住所, G=電話番号, H=商品名,
  // I=確認リンク, J=選択リスト, K=合計点数, L=合計金額, M=送料(店負担), N=送料(客負担), O=決済方法, P=決済ID,
  // Q=入金確認, R=ポイント付与済, S=発送ステータス, T=配送業者, U=伝票番号, V=ステータス, W=担当者,
  // X=リスト同梱, Y=xlsx送付, Z=インボイス発行, AA=インボイス状況, AB=受注通知,
  // AC=発送通知, AD=備考, AE=作業報酬, AF=更新日時, AG=チャネル
  const header = [
    '受付番号','依頼日時','会社名/氏名','連絡先','郵便番号','住所','電話番号','商品名',
    '確認リンク','選択リスト','合計点数','合計金額','送料(店負担)','送料(客負担)','決済方法','決済ID',
    '入金確認','ポイント付与済','発送ステータス','配送業者','伝票番号','ステータス','担当者',
    'リスト同梱','xlsx送付','インボイス発行','インボイス状況','受注通知',
    '発送通知','備考','作業報酬','更新日時','チャネル'
  ];
  const r1 = sh.getRange(1, 1, 1, header.length).getValues()[0];
  let needs = false;
  for (let i = 0; i < header.length; i++) if (String(r1[i] || '') !== header[i]) { needs = true; break; }
  if (needs) sh.getRange(1, 1, 1, header.length).setValues([header]);
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
  // V列(22): ステータス（依頼中/発送済み等）
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(APP_CONFIG.statuses.allowed, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, 22, Math.max(1, maxRows - 1), 1).setDataValidation(statusRule);

  // Q列(17): 入金確認ステータス
  const paymentRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['入金待ち', '未対応', '対応済'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, 17, Math.max(1, maxRows - 1), 1).setDataValidation(paymentRule);
  return true;
}

function sh_ensureAllOnce_(ss) {
  const props = PropertiesService.getScriptProperties();
  const k = 'SHEETS_READY_V4:' + ss.getId();
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


