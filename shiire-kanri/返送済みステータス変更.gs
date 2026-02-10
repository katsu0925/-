const RETURN_STATUS_SYNC_CONFIG = {
  PRODUCT_SHEET_NAME: "商品管理",
  RETURN_SHEET_NAME: "返送管理",
  PRODUCT_HEADER_ROWS: 1,
  RETURN_HEADER_ROWS: 1,
  PRODUCT_ID_HEADER_NAME: "管理番号",
  PRODUCT_STATUS_HEADER_NAME: "ステータス",
  RETURN_ID_COL: 3,
  RETURNED_STATUS_TEXT: "返品済み",
  EXCLUDED_STATUS_TEXTS: ["売却済み", "廃棄済み", "キャンセル済み", "発送待ち", "発送済み"]
};

function setupHourlyTrigger_updateReturnStatus() {
  replaceTrigger_("updateReturnStatusHourly", function(tb) { tb.timeBased().everyHours(1).create(); });
}
function updateReturnStatusHourly() { updateReturnStatusNow(); }
function updateReturnStatusNow() { withLock_(25000, function() { updateReturnStatusNowInner_(); }); }

function updateReturnStatusNowInner_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const productSheet = ss.getSheetByName(RETURN_STATUS_SYNC_CONFIG.PRODUCT_SHEET_NAME);
  const returnSheet = ss.getSheetByName(RETURN_STATUS_SYNC_CONFIG.RETURN_SHEET_NAME);
  if (!productSheet) throw new Error("商品管理シートが見つかりません");
  if (!returnSheet) throw new Error("返送管理シートが見つかりません");
  const returnedIdSet = buildReturnedIdSet_(returnSheet);
  if (returnedIdSet.size === 0) return;
  const productHeaderRow = RETURN_STATUS_SYNC_CONFIG.PRODUCT_HEADER_ROWS;
  const productLastRow = productSheet.getLastRow();
  const productLastCol = productSheet.getLastColumn();
  if (productLastRow <= productHeaderRow || productLastCol <= 0) return;
  const header = productSheet.getRange(productHeaderRow, 1, 1, productLastCol).getDisplayValues()[0];
  const idCol = requireCol_(header, RETURN_STATUS_SYNC_CONFIG.PRODUCT_ID_HEADER_NAME, '商品管理');
  const statusCol = requireCol_(header, RETURN_STATUS_SYNC_CONFIG.PRODUCT_STATUS_HEADER_NAME, '商品管理');
  const numRows = productLastRow - productHeaderRow;
  const idRange = productSheet.getRange(productHeaderRow + 1, idCol, numRows, 1);
  const statusRange = productSheet.getRange(productHeaderRow + 1, statusCol, numRows, 1);
  const idVals = idRange.getDisplayValues();
  const statusVals = statusRange.getValues();
  const excludedSet = new Set((RETURN_STATUS_SYNC_CONFIG.EXCLUDED_STATUS_TEXTS || []).map(normalizeText_));
  const returnedTextNorm = normalizeText_(RETURN_STATUS_SYNC_CONFIG.RETURNED_STATUS_TEXT);
  let changed = false;
  for (let r = 0; r < numRows; r++) {
    const id = normalizeId_(idVals[r][0]);
    if (!id) continue;
    if (!returnedIdSet.has(id)) continue;
    const currentStatusNorm = normalizeText_(statusVals[r][0]);
    if (excludedSet.has(currentStatusNorm)) continue;
    if (currentStatusNorm !== returnedTextNorm) { statusVals[r][0] = RETURN_STATUS_SYNC_CONFIG.RETURNED_STATUS_TEXT; changed = true; }
  }
  if (changed) statusRange.setValues(statusVals);
}

function buildReturnedIdSet_(returnSheet) {
  const lastRow = returnSheet.getLastRow();
  if (lastRow <= RETURN_STATUS_SYNC_CONFIG.RETURN_HEADER_ROWS) return new Set();
  const range = returnSheet.getRange(RETURN_STATUS_SYNC_CONFIG.RETURN_HEADER_ROWS + 1, RETURN_STATUS_SYNC_CONFIG.RETURN_ID_COL, lastRow - RETURN_STATUS_SYNC_CONFIG.RETURN_HEADER_ROWS, 1);
  const vals = range.getDisplayValues();
  const set = new Set();
  for (let i = 0; i < vals.length; i++) {
    const cell = (vals[i][0] ?? "").toString();
    const ids = splitReturnIds_(cell);
    for (const id of ids) set.add(id);
  }
  return set;
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
