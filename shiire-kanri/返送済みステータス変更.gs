// 返送済みステータス変更.gs
//
// 返送管理シート構成:
//   A列: 箱ID
//   B列: 報告者
//   C列: 発送先
//   D列: 管理番号（複数: カンマ/改行/スペース区切り）
//   E列: 着数
//   F列: 備考
//
const RETURN_STATUS_SYNC_CONFIG = {
  PRODUCT_SHEET_NAME: "商品管理",
  RETURN_SHEET_NAME: "返送管理",
  PRODUCT_HEADER_ROWS: 1,
  RETURN_HEADER_ROWS: 1,
  PRODUCT_ID_HEADER_NAME: "管理番号",
  PRODUCT_STATUS_HEADER_NAME: "ステータス",
  PRODUCT_LOCATION_HEADER_NAME: "納品場所",
  RETURN_ID_COL: 4,
  RETURN_DEST_COL: 3,
  RETURNED_STATUS_TEXT: "返品済み",
  EXCLUDED_STATUS_TEXTS: ["売却済み", "廃棄済み", "キャンセル済み", "発送待ち", "発送済み"]
};

function setupHourlyTrigger_updateReturnStatus() {
  replaceTrigger_("updateReturnStatusHourly", function(tb) { tb.timeBased().everyHours(1).create(); });
}
function updateReturnStatusHourly() { updateReturnStatusNow(); }
function updateReturnStatusNow() { withLock_(25000, function() { updateReturnStatusNowInner_(); }); }

// onChange トリガーから呼ばれるハンドラ（即時処理）
function handleChange_Return(e) {
  withLock_(25000, function() { updateReturnStatusNowInner_(); });
}

function updateReturnStatusNowInner_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const productSheet = ss.getSheetByName(RETURN_STATUS_SYNC_CONFIG.PRODUCT_SHEET_NAME);
  const returnSheet = ss.getSheetByName(RETURN_STATUS_SYNC_CONFIG.RETURN_SHEET_NAME);
  if (!productSheet) throw new Error("商品管理シートが見つかりません");
  if (!returnSheet) throw new Error("返送管理シートが見つかりません");
  const returnedIdMap = buildReturnedIdMap_(returnSheet);
  if (returnedIdMap.size === 0) return;
  const productHeaderRow = RETURN_STATUS_SYNC_CONFIG.PRODUCT_HEADER_ROWS;
  const productLastRow = productSheet.getLastRow();
  const productLastCol = productSheet.getLastColumn();
  if (productLastRow <= productHeaderRow || productLastCol <= 0) return;
  const header = productSheet.getRange(productHeaderRow, 1, 1, productLastCol).getDisplayValues()[0];
  const idCol = requireCol_(header, RETURN_STATUS_SYNC_CONFIG.PRODUCT_ID_HEADER_NAME, '商品管理');
  const statusCol = requireCol_(header, RETURN_STATUS_SYNC_CONFIG.PRODUCT_STATUS_HEADER_NAME, '商品管理');
  const locationCol = requireCol_(header, RETURN_STATUS_SYNC_CONFIG.PRODUCT_LOCATION_HEADER_NAME, '商品管理');
  const numRows = productLastRow - productHeaderRow;
  const idVals = productSheet.getRange(productHeaderRow + 1, idCol, numRows, 1).getDisplayValues();
  const statusVals = productSheet.getRange(productHeaderRow + 1, statusCol, numRows, 1).getValues();
  const locVals = productSheet.getRange(productHeaderRow + 1, locationCol, numRows, 1).getValues();
  const excludedSet = new Set((RETURN_STATUS_SYNC_CONFIG.EXCLUDED_STATUS_TEXTS || []).map(normalizeText_));
  const returnedTextNorm = normalizeText_(RETURN_STATUS_SYNC_CONFIG.RETURNED_STATUS_TEXT);
  let statusChanged = false;
  let locChanged = false;
  for (let r = 0; r < numRows; r++) {
    const id = normalizeId_(idVals[r][0]);
    if (!id) continue;
    const dest = returnedIdMap.get(id);
    if (dest === undefined) continue;
    // ステータス更新
    const currentStatusNorm = normalizeText_(statusVals[r][0]);
    if (!excludedSet.has(currentStatusNorm) && currentStatusNorm !== returnedTextNorm) {
      statusVals[r][0] = RETURN_STATUS_SYNC_CONFIG.RETURNED_STATUS_TEXT;
      statusChanged = true;
    }
    // 納品場所更新（発送先が入力されている場合のみ）
    if (dest && normalizeText_(locVals[r][0]) !== normalizeText_(dest)) {
      locVals[r][0] = dest;
      locChanged = true;
    }
  }
  if (statusChanged) productSheet.getRange(productHeaderRow + 1, statusCol, numRows, 1).setValues(statusVals);
  if (locChanged) productSheet.getRange(productHeaderRow + 1, locationCol, numRows, 1).setValues(locVals);
}

function buildReturnedIdMap_(returnSheet) {
  const lastRow = returnSheet.getLastRow();
  const headerRows = RETURN_STATUS_SYNC_CONFIG.RETURN_HEADER_ROWS;
  if (lastRow <= headerRows) return new Map();
  const numRows = lastRow - headerRows;
  const idVals = returnSheet.getRange(headerRows + 1, RETURN_STATUS_SYNC_CONFIG.RETURN_ID_COL, numRows, 1).getDisplayValues();
  const destVals = returnSheet.getRange(headerRows + 1, RETURN_STATUS_SYNC_CONFIG.RETURN_DEST_COL, numRows, 1).getDisplayValues();
  const map = new Map();
  for (let i = 0; i < numRows; i++) {
    const cell = (idVals[i][0] ?? "").toString();
    const dest = (destVals[i][0] ?? "").toString().trim();
    const ids = splitReturnIds_(cell);
    for (const id of ids) map.set(id, dest);
  }
  return map;
}

function splitReturnIds_(text) {
  const raw = (text ?? "").toString();
  if (!raw) return [];
  const cleaned = raw.replace(/\u00A0/g, " ").replace(/[　]/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
  const parts = cleaned.split(/[,\n\r\t\s、，／\/・|]+/);
  const out = [];
  for (const p of parts) { const id = normalizeId_(p); if (id) out.push(id); }
  return out;
}

function normalizeId_(v) { return normalizeText_(v); }
