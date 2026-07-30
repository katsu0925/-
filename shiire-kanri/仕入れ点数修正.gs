// 仕入れ点数修正.gs
/**
 * 仕入れ点数の修正（管理者向け・スプレッドシートメニューから起動）
 *
 * 【背景】
 *   仕入れ数報告で点数を間違えて報告し、すでに割り当て管理番号が採番された後で
 *   実際の点数違いが発覚するケースがある。元の報告を直接直して再採番させると、
 *   同区分の後続バッチの番号が丸ごとズレ、登録済み商品の紐付け（タスキ箱画像の
 *   キーでもある管理番号）が壊れる。それを起こさずに安全に修正する。
 *
 * 【増やす方向（過少報告：例 50→実際52）】
 *   1) 補助行を自動作成（同区分／仕入れ日=今日／点数=差分／登録日時=今）
 *   2) 元の総額（金額・送料）を点数按分で元行と補助行に振り分ける（合計は不変）
 *      → 両行の商品原価がほぼ同額で揃う
 *   3) 補助行に「区分の最後尾」の管理番号を直接採番（既存番号は1つもズレない）
 *   4) 元行の仕入れIDに紐づく登録済み商品の 仕入れ値・粗利・利益・利益率 を再同期
 *
 * 【減らす方向（過大報告：例 52→実際50）】
 *   - 余る末尾番号にすでに商品が登録されている場合は中止
 *   - 安全なら 元行の点数・原価・管理番号(末尾を短縮)を更新し、登録済み商品を再同期
 *   - 余った末尾番号は欠番になる（採番は append-only なので後続バッチはズレない）
 *
 * 起動: スプレッドシートの「管理メニュー → 🔢 仕入れ点数を修正」
 *       仕入れ管理シートで対象行のセルを選択してから実行する。
 */

// ═══════════════════════════════════════════
//  メニューエントリ
// ═══════════════════════════════════════════

function showShiireQuantityFix() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var KANRI_NAME = SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME;

  var sheet = ss.getActiveSheet();
  if (!sheet || sheet.getName() !== KANRI_NAME) {
    ui.alert('仕入れ点数の修正', '「' + KANRI_NAME + '」シートで、修正したい行のセルを選択してから実行してください。', ui.ButtonSet.OK);
    return;
  }

  var activeRow = sheet.getActiveRange() ? sheet.getActiveRange().getRow() : 0;
  if (activeRow < 2) {
    ui.alert('仕入れ点数の修正', '修正したいデータ行のセルを選択してから実行してください（見出し行は対象外）。', ui.ButtonSet.OK);
    return;
  }

  var lastCol = Math.max(sheet.getLastColumn(), knr.SYNCED + 1);
  var rowData = sheet.getRange(activeRow, 1, 1, lastCol).getValues()[0];

  var id = normalizeText_(rowData[knr.ID - 1]);
  var category = String(rowData[knr.CATEGORY - 1] || '').trim();
  var origCount = Number(rowData[knr.ITEM_COUNT - 1]) || 0;
  var assignNum = String(rowData[knr.ASSIGN_NUM - 1] || '').trim();

  if (!id) { ui.alert('仕入れ点数の修正', '選択行に仕入れIDがありません。', ui.ButtonSet.OK); return; }
  if (!category) { ui.alert('仕入れ点数の修正', '選択行に区分コードがありません。', ui.ButtonSet.OK); return; }
  if (origCount <= 0) { ui.alert('仕入れ点数の修正', 'この行はまだ商品点数が入っていません。報告完了後に実行してください。', ui.ButtonSet.OK); return; }
  if (!assignNum) { ui.alert('仕入れ点数の修正', 'この行はまだ割り当て管理番号が採番されていません。', ui.ButtonSet.OK); return; }

  // 管理番号 "z{区分}{開始}~{終了}" から開始・終了を取り出す
  var m = assignNum.match(/(\d+)\s*~\s*(\d+)\s*$/);
  if (!m) { ui.alert('仕入れ点数の修正', '割り当て管理番号の形式が想定外です: ' + assignNum, ui.ButtonSet.OK); return; }
  var startN = parseInt(m[1], 10);
  var endN = parseInt(m[2], 10);
  if (endN - startN + 1 !== origCount) {
    ui.alert('仕入れ点数の修正',
      '商品点数(' + origCount + ')と管理番号の範囲(' + assignNum + ' = ' + (endN - startN + 1) + '個)が一致しません。\n'
      + 'データ不整合のため自動修正を中止します。シートを確認してください。', ui.ButtonSet.OK);
    return;
  }

  // 正しい点数を入力させる
  var prompt = ui.prompt(
    '仕入れ点数の修正',
    '正しい総点数を入力してください。\n\n'
    + '対象ID: ' + id + '\n'
    + '区分コード: ' + category + '\n'
    + '現在の点数: ' + origCount + '\n'
    + '管理番号: ' + assignNum,
    ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  var correctCount = parseInt(normalizeText_(prompt.getResponseText()), 10);
  if (isNaN(correctCount) || correctCount < 1) {
    ui.alert('仕入れ点数の修正', '1以上の整数を入力してください。', ui.ButtonSet.OK);
    return;
  }
  if (correctCount === origCount) {
    ui.alert('仕入れ点数の修正', '現在の点数と同じです。修正は不要です。', ui.ButtonSet.OK);
    return;
  }

  var diff = correctCount - origCount;
  var planMsg;
  if (diff > 0) {
    planMsg = '【点数を増やします】 ' + origCount + ' → ' + correctCount + '（+' + diff + '点）\n\n'
      + '・差分 ' + diff + ' 点の補助行を自動作成し、区分の最後尾に管理番号を採番します\n'
      + '・元の金額・送料を点数按分で元行と補助行に振り分けます（合計は不変）\n'
      + '・元行に紐づく登録済み商品の 仕入れ値／利益 を再同期します\n\n'
      + '実行しますか？';
  } else {
    planMsg = '【点数を減らします】 ' + origCount + ' → ' + correctCount + '（' + diff + '点）\n\n'
      + '・元行の点数・原価・管理番号（末尾を短縮）を修正します\n'
      + '・余る末尾番号は欠番になります（他の箱の管理番号はズレません）\n'
      + '・余る末尾番号にすでに商品が登録済みの場合は中止します\n'
      + '・元行に紐づく登録済み商品の 仕入れ値／利益 を再同期します\n\n'
      + '実行しますか？';
  }
  if (ui.alert('仕入れ点数の修正 — 確認', planMsg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // 実行（ロックで 5分処理／onChange と競合させない）
  var result = null;
  withLock_(30000, function() {
    if (diff > 0) {
      result = fixqty_doIncrease_(ss, sheet, activeRow, rowData, correctCount);
    } else {
      result = fixqty_doDecrease_(ss, sheet, activeRow, rowData, correctCount, startN, endN);
    }
  });

  if (!result) {
    ui.alert('仕入れ点数の修正', '他の処理が実行中のため取得できませんでした。少し待って再実行してください。', ui.ButtonSet.OK);
    return;
  }
  if (!result.ok) {
    ui.alert('仕入れ点数の修正 — 中止', result.error, ui.ButtonSet.OK);
    return;
  }
  ui.alert('仕入れ点数の修正 — 完了', result.message, ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  増やす方向（過少報告）
// ═══════════════════════════════════════════

function fixqty_doIncrease_(ss, sheet, activeRow, rowData, correctCount) {
  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var id = normalizeText_(rowData[knr.ID - 1]);
  var category = String(rowData[knr.CATEGORY - 1] || '').trim();
  var origCount = Number(rowData[knr.ITEM_COUNT - 1]) || 0;
  var origAmount = Number(rowData[knr.AMOUNT - 1]) || 0;
  var origShipping = Number(rowData[knr.SHIPPING - 1]) || 0;
  var place = String(rowData[knr.LOCATION - 1] || '').trim();
  var content = String(rowData[knr.CONTENT - 1] || '').trim();
  var supplierId = String(rowData[14 - 1] || '').trim(); // N列 仕入先名
  var diff = correctCount - origCount; // > 0

  // --- 既存の仕入れID一覧（補助行IDの衝突回避用）---
  var lastRow = sheet.getLastRow();
  var allData = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 14)).getValues();
  var existIds = {};
  for (var i = 0; i < allData.length; i++) {
    var rid = normalizeText_(allData[i][knr.ID - 1]);
    if (rid) existIds[rid] = true;
  }
  // --- 補助行の開始番号は「区分の最大末尾番号 +1」---
  //   点数の累計から求めてはいけない。欠番（点数を減らした箱の余り番号）があると
  //   累計 < 最大末尾 になり、既存レンジと衝突するため。
  var subStart = staff_nextKanriNumber_(ss, 'z' + category);
  var subEnd = subStart + diff - 1;
  var subAssign = 'z' + category + subStart + '~' + subEnd;

  // --- 金額・送料を点数按分（合計は不変）---
  var subAmount = Math.round(origAmount * diff / correctCount);
  var subShipping = Math.round(origShipping * diff / correctCount);
  var newOrigAmount = origAmount - subAmount;
  var newOrigShipping = origShipping - subShipping;
  var newOrigCost = Math.round((newOrigAmount + newOrigShipping) / origCount);
  var subCost = Math.round((subAmount + subShipping) / diff);

  // --- 元行を更新（点数・管理番号はそのまま、金額/送料/原価のみ）---
  sheet.getRange(activeRow, knr.AMOUNT).setValue(newOrigAmount);
  sheet.getRange(activeRow, knr.SHIPPING).setValue(newOrigShipping);
  sheet.getRange(activeRow, knr.UNIT_COST).setValue(newOrigCost);

  // --- 補助行を作成 ---
  var subId = staff_generateUniqueId_();
  while (existIds[subId]) subId = staff_generateUniqueId_();
  var t = new Date();
  var today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  // 列順: A=ID,B=仕入れ日,C=区分,D=金額,E=送料,F=点数,G=納品場所,H=原価,
  //       I=内容,J=登録者,K=登録日時,L=割当管理番号,M=処理済み,N=仕入先名
  var subRow = [
    subId, today, category, subAmount, subShipping, diff, place, subCost,
    '【点数修正 +' + diff + '】' + content + '（元ID:' + id + '）',
    '点数修正(自動)', new Date(), subAssign, true, supplierId
  ];
  var appendAt = sheet.getLastRow() + 1;
  sheet.getRange(appendAt, 1, 1, subRow.length).setValues([subRow]);

  // --- 元行の仕入れIDに紐づく登録済み商品を再同期 ---
  var resync = fixqty_resyncProductCost_(ss, id, newOrigCost);

  // --- 仕入れ数報告へ補助行を転記（番号には影響しない Phase1 のみ）---
  try { syncKanriToReport_(); } catch (e) { console.warn('点数修正: syncKanriToReport_ 失敗 ' + (e && e.message)); }

  console.log('仕入れ点数修正(増): ID=' + id + ' ' + origCount + '→' + correctCount
    + ' 補助行ID=' + subId + ' ' + subAssign + ' 原価:元=' + newOrigCost + '/補助=' + subCost
    + ' 商品再同期=' + resync.count + '件');

  var msg = '点数を ' + origCount + ' → ' + correctCount + ' に修正しました。\n\n'
    + '■ 補助行を作成（' + (appendAt) + '行目）\n'
    + '　仕入れID: ' + subId + '\n'
    + '　点数: ' + diff + ' 点\n'
    + '　管理番号: ' + subAssign + '\n'
    + '　金額: ¥' + subAmount + ' / 送料: ¥' + subShipping + ' / 原価: ¥' + subCost + '\n\n'
    + '■ 元行（' + activeRow + '行目）\n'
    + '　金額: ¥' + origAmount + ' → ¥' + newOrigAmount + '\n'
    + '　送料: ¥' + origShipping + ' → ¥' + newOrigShipping + '\n'
    + '　原価: ¥' + newOrigCost + '\n\n'
    + '■ 登録済み商品の再同期: ' + resync.count + ' 件（仕入れ値・利益）\n'
    + (resync.error ? '　⚠ ' + resync.error + '\n' : '')
    + '\n残り ' + diff + ' 点は、補助行（' + subAssign + '）に対してスタッフアプリから登録してください。';
  // 外注アプリ（Worker）が D1 を即時更新できるよう、構造化した結果も返す
  return {
    ok: true, message: msg, mode: 'increase',
    shiireId: id, count: origCount, addedCount: diff, totalCount: correctCount,
    amount: newOrigAmount, shipping: newOrigShipping, cost: newOrigCost,
    sub: {
      shiireId: subId,
      date: Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd'),
      category: category, amount: subAmount, shipping: subShipping,
      count: diff, place: place, cost: subCost,
      content: '【点数修正 +' + diff + '】' + content + '（元ID:' + id + '）',
      supplierId: supplierId, assignNum: subAssign, row: appendAt
    },
    resynced: resync.count
  };
}

// ═══════════════════════════════════════════
//  減らす方向（過大報告）
// ═══════════════════════════════════════════

function fixqty_doDecrease_(ss, sheet, activeRow, rowData, correctCount, startN, endN) {
  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var id = normalizeText_(rowData[knr.ID - 1]);
  var category = String(rowData[knr.CATEGORY - 1] || '').trim();
  var origCount = Number(rowData[knr.ITEM_COUNT - 1]) || 0;
  var amount = Number(rowData[knr.AMOUNT - 1]) || 0;
  var shipping = Number(rowData[knr.SHIPPING - 1]) || 0;
  var content = String(rowData[knr.CONTENT - 1] || '').trim();

  // 採番は append-only（既存の番号は誰も動かさない）ため、後続に同区分の別バッチが
  // あっても番号はズレない。末尾を短縮して欠番になるだけなので中止しない。

  // --- 安全チェック: 余る末尾番号にすでに商品が登録されていないか ---
  var phantomStart = startN + correctCount; // 不要になる先頭
  var phantomNums = [];
  for (var n = phantomStart; n <= endN; n++) phantomNums.push('z' + category + n);
  var registered = fixqty_findRegisteredKanri_(ss, phantomNums);
  if (registered.length > 0) {
    return { ok: false, error:
      '減らすと不要になる管理番号に、すでに商品が登録されています:\n　' + registered.join(' / ') + '\n\n'
      + '実際の点数より多く商品が登録されているため自動修正できません。\n'
      + '登録済み商品を確認のうえ手動対応してください。' };
  }

  // --- 元行を更新 ---
  var newEnd = startN + correctCount - 1;
  var newAssign = 'z' + category + startN + '~' + newEnd;
  var newCost = Math.round((amount + shipping) / correctCount);
  sheet.getRange(activeRow, knr.ITEM_COUNT).setValue(correctCount);
  sheet.getRange(activeRow, knr.UNIT_COST).setValue(newCost);
  sheet.getRange(activeRow, knr.ASSIGN_NUM).setValue(newAssign);
  sheet.getRange(activeRow, knr.CONTENT).setValue(content + ' 【点数修正 ' + origCount + '→' + correctCount + '】');

  // --- 登録済み商品を再同期 ---
  var resync = fixqty_resyncProductCost_(ss, id, newCost);

  console.log('仕入れ点数修正(減): ID=' + id + ' ' + origCount + '→' + correctCount
    + ' 管理番号=' + newAssign + ' 原価=' + newCost + ' 商品再同期=' + resync.count + '件');

  var msg = '点数を ' + origCount + ' → ' + correctCount + ' に修正しました。\n\n'
    + '■ 元行（' + activeRow + '行目）\n'
    + '　商品点数: ' + origCount + ' → ' + correctCount + '\n'
    + '　管理番号: z' + category + startN + '~' + endN + ' → ' + newAssign + '\n'
    + '　原価: ¥' + newCost + '（金額¥' + amount + '＋送料¥' + shipping + '）\n\n'
    + '■ 未使用になった管理番号: '
    + (phantomNums.length ? phantomNums[0] + '〜' + phantomNums[phantomNums.length - 1] : 'なし') + '\n\n'
    + '■ 登録済み商品の再同期: ' + resync.count + ' 件（仕入れ値・利益）\n'
    + (resync.error ? '　⚠ ' + resync.error + '\n' : '');
  // 外注アプリ（Worker）が D1 を即時更新できるよう、構造化した結果も返す
  return {
    ok: true, message: msg, mode: 'decrease',
    shiireId: id, count: correctCount, totalCount: correctCount,
    assignNum: newAssign, cost: newCost, amount: amount, shipping: shipping,
    freedFrom: (phantomNums.length ? phantomNums[0] : ''),
    freedTo: (phantomNums.length ? phantomNums[phantomNums.length - 1] : ''),
    resynced: resync.count
  };
}

// ═══════════════════════════════════════════
//  ヘルパー
// ═══════════════════════════════════════════

/** 商品管理シートで、指定の管理番号リストに一致する登録済み商品を返す */
function fixqty_findRegisteredKanri_(ss, kanriList) {
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2 || kanriList.length === 0) return [];
  var want = {};
  for (var i = 0; i < kanriList.length; i++) want[kanriList[i]] = true;
  var vals = sh.getRange(2, STAFF_COL.管理番号, sh.getLastRow() - 1, 1).getValues();
  var hit = [];
  for (var r = 0; r < vals.length; r++) {
    var k = String(vals[r][0] || '').trim();
    if (k && want[k]) hit.push(k);
  }
  return hit;
}

/**
 * 仕入れ管理の商品原価が変わったとき、紐づく登録済み商品の
 * 仕入れ値・粗利・利益・利益率 を再計算して上書きする。
 * 計算式は StaffApi.gs の派生値計算と同一:
 *   粗利   = 販売価格 - 送料 - 手数料
 *   利益   = 販売価格 - 送料 - 手数料 - 仕入れ値
 *   利益率 = 販売価格>0 ? 利益/販売価格 : ''（空）
 * シート式が入っているセルは尊重して上書きしない。
 */
function fixqty_resyncProductCost_(ss, shiireId, newCost) {
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { count: 0 };

  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = buildHeaderMap_(hdr);
  var cCost = col['仕入れ値'];
  if (!cCost) return { count: 0, error: '商品管理シートに「仕入れ値」列が見つからず再同期できませんでした' };
  var cArari = col['粗利'], cRieki = col['利益'], cRate = col['利益率'];
  var cSp = col['販売価格'], cSs = col['送料'], cSf = col['手数料'];

  var numRows = sh.getLastRow() - 1;
  var data = sh.getRange(2, 1, numRows, lastCol).getValues();
  var formulas = sh.getRange(2, 1, numRows, lastCol).getFormulas();

  var updated = 0;
  for (var i = 0; i < numRows; i++) {
    if (String(data[i][STAFF_COL.仕入れID - 1] || '').trim() !== shiireId) continue;
    var r = i + 2;

    if (!formulas[i][cCost - 1]) sh.getRange(r, cCost).setValue(newCost);

    var sp = cSp ? (Number(data[i][cSp - 1]) || 0) : 0;
    var ss_ = cSs ? (Number(data[i][cSs - 1]) || 0) : 0;
    var sf = cSf ? (Number(data[i][cSf - 1]) || 0) : 0;
    var arari = sp - ss_ - sf;
    var rieki = sp - ss_ - sf - newCost;
    var rate = (sp > 0) ? (rieki / sp) : '';

    if (cArari && !formulas[i][cArari - 1]) sh.getRange(r, cArari).setValue(arari);
    if (cRieki && !formulas[i][cRieki - 1]) sh.getRange(r, cRieki).setValue(rieki);
    if (cRate && !formulas[i][cRate - 1]) sh.getRange(r, cRate).setValue(rate);
    updated++;
  }
  return { count: updated };
}

/** 指定の仕入れIDに紐づく登録済み商品の件数を数える */
function fixqty_countRegisteredForShiire_(ss, shiireId) {
  var sh = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, STAFF_COL.仕入れID, sh.getLastRow() - 1, 1).getValues();
  var n = 0;
  for (var r = 0; r < vals.length; r++) {
    if (String(vals[r][0] || '').trim() === shiireId) n++;
  }
  return n;
}

// ═══════════════════════════════════════════
//  外注アプリ用 API（doPost action: fixPurchaseQuantity）
// ═══════════════════════════════════════════

/**
 * 外注アプリ（スタッフSPA）から仕入れ点数を修正する。
 * payload: { shiireId, correctCount, dryRun }
 *   dryRun: true  → 現状（点数・管理番号レンジ・登録済み件数）を返すだけ。修正画面の初期表示用。
 *   dryRun: なし  → correctCount へ修正する。
 *
 * 管理者のみ実行可。採番が動くと全体に波及するため、外注スタッフには開放しない。
 * 実処理はシートメニュー（showShiireQuantityFix）と同じ
 * fixqty_doIncrease_ / fixqty_doDecrease_ を共有する。
 */
function staff_apiFixPurchaseQuantity(payload, email) {
  payload = payload || {};
  var shiireId = normalizeText_(payload.shiireId);
  var dryRun = (payload.dryRun === true);
  var correctCount = parseInt(payload.correctCount, 10);
  if (!shiireId) return { ok: false, error: '仕入れIDが指定されていません' };

  var me = staff_resolveUserByEmail_(email);
  if (!me || !me.isAdmin) return { ok: false, error: '点数の修正は管理者のみ実行できます' };

  var knr = SHIIRE_MERGE_CONFIG.KNR;
  var ss = staff_getActiveSpreadsheet_();
  var sheet = ss.getSheetByName(SHIIRE_MERGE_CONFIG.KANRI_SHEET_NAME);
  if (!sheet) return { ok: false, error: '仕入れ管理シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: '仕入れ管理にデータがありません' };

  // 対象行を仕入れIDで特定
  var ids = sheet.getRange(2, knr.ID, lastRow - 1, 1).getValues();
  var targetRow = 0;
  for (var i = 0; i < ids.length; i++) {
    if (normalizeText_(ids[i][0]) === shiireId) { targetRow = i + 2; break; }
  }
  if (!targetRow) return { ok: false, error: '仕入れ管理にこのIDの行がありません: ' + shiireId };

  var lastCol = Math.max(sheet.getLastColumn(), knr.SYNCED + 1);
  var rowData = sheet.getRange(targetRow, 1, 1, lastCol).getValues()[0];
  var category = String(rowData[knr.CATEGORY - 1] || '').trim();
  var origCount = Number(rowData[knr.ITEM_COUNT - 1]) || 0;
  var assignNum = String(rowData[knr.ASSIGN_NUM - 1] || '').trim();

  if (!category) return { ok: false, error: 'この仕入れには区分コードが入っていません' };
  if (origCount <= 0) return { ok: false, error: 'この仕入れはまだ点数が確定していません（仕入れ数報告の入力後に実行してください）' };
  if (!assignNum) return { ok: false, error: 'この仕入れにはまだ管理番号が割り当てられていません' };

  var m = assignNum.match(/(\d+)\s*~\s*(\d+)\s*$/);
  if (!m) return { ok: false, error: '管理番号の形式が想定外です: ' + assignNum };
  var startN = parseInt(m[1], 10);
  var endN = parseInt(m[2], 10);
  if (endN - startN + 1 !== origCount) {
    return { ok: false, error: '点数（' + origCount + '点）と管理番号の範囲（' + assignNum + '＝'
      + (endN - startN + 1) + '個）が一致していません。データがズレているため自動では直せません。' };
  }

  var registered = fixqty_countRegisteredForShiire_(ss, shiireId);

  if (dryRun) {
    return {
      ok: true, dryRun: true, shiireId: shiireId, category: category,
      count: origCount, assignNum: assignNum, rangeStart: startN, rangeEnd: endN,
      registered: registered, row: targetRow
    };
  }

  if (isNaN(correctCount) || correctCount < 1) return { ok: false, error: '正しい点数は1以上の数で入力してください' };
  if (correctCount === origCount) return { ok: false, error: '今の点数と同じです（修正は不要です）' };
  if (correctCount < registered) {
    return { ok: false, error: 'この仕入れにはすでに ' + registered + ' 点の商品が登録されています。'
      + correctCount + ' 点には減らせません。' };
  }

  var result = null;
  withLock_(30000, function() {
    if (correctCount > origCount) {
      result = fixqty_doIncrease_(ss, sheet, targetRow, rowData, correctCount);
    } else {
      result = fixqty_doDecrease_(ss, sheet, targetRow, rowData, correctCount, startN, endN);
    }
  });
  if (!result) return { ok: false, error: 'ほかの処理が実行中です。少し待ってからもう一度お試しください。' };
  if (!result.ok) return { ok: false, error: result.error };

  result.origCount = origCount;
  result.correctCount = correctCount;
  return result;
}
