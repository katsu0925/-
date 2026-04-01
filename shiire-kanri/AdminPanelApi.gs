// AdminPanelApi.gs — 仕入れ管理 管理パネル用API

function showAdminPanel() {
  var html = HtmlService.createHtmlOutputFromFile('AdminPanel')
    .setWidth(920)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '管理パネル（仕入れ管理）');
}

// =====================================================
// スクリプトプロパティ CRUD
// =====================================================

var AP_SECRET_PATTERNS_ = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY'];

function adminPanel_getProperties() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var result = {};
  var keys = Object.keys(props).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf('CALLS_') === 0 || k.indexOf('ATTEMPTS_') === 0 || k.indexOf('BACKOFF_') === 0) continue;
    if (k.indexOf('mail_sent__') === 0) continue;
    var isSecret = false;
    var kUpper = k.toUpperCase();
    for (var s = 0; s < AP_SECRET_PATTERNS_.length; s++) {
      if (kUpper.indexOf(AP_SECRET_PATTERNS_[s]) !== -1) { isSecret = true; break; }
    }
    result[k] = { value: isSecret ? '' : props[k], masked: isSecret, hasValue: !!props[k] };
  }
  return { ok: true, props: result };
}

function adminPanel_setProperties(updates) {
  if (!updates || typeof updates !== 'object') return { ok: false, message: '無効なデータ' };
  var props = PropertiesService.getScriptProperties();
  var changed = 0;
  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = updates[k];
    if (v === '__DELETE__') { props.deleteProperty(k); changed++; }
    else if (v !== null && v !== undefined && v !== '') { props.setProperty(k, String(v)); changed++; }
  }
  return { ok: true, message: changed + '件のプロパティを更新しました' };
}

// =====================================================
// 管理ツール（ラッパー）
// =====================================================

function adminPanel_startNewMonth() {
  try { startNewMonth(); return { ok: true, message: '棚卸し今月を開始しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_syncCurrentMonthIds() {
  try { syncCurrentMonthIds(); return { ok: true, message: '新規IDを同期しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_recalcCurrentTheory() {
  try { recalcCurrentTheoryFromPrev(); return { ok: true, message: '理論値を再計算しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_updateInventoryTrend() {
  try { updateMonthlyInventoryTrend(); return { ok: true, message: '月次在庫推移を更新しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_generateReport() {
  try { generateMonthlyReport(); return { ok: true, message: '月次レポートを生成しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_ecSync() {
  try { syncBaseOrdersToEc(); return { ok: true, message: 'EC管理自動反映を実行しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_returnStatusSync() {
  try { updateReturnStatusNow(); return { ok: true, message: '返送ステータスを更新しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_moveProcess() {
  try { processPendingMoves_(); return { ok: true, message: '移動報告を処理しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_mergeShiire() {
  try { mergeReportToKanri_(); return { ok: true, message: '仕入れ数マージを実行しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_checkMissingIds() {
  try { 出力_欠番確認(); return { ok: true, message: '欠番確認を実行しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_generateSwapLists() {
  try { generateSwapLists(); return { ok: true, message: '入替リストを生成しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_debugColumns() {
  try { debugCheckColumns(); return { ok: true, message: '列診断を実行しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_cleanupTriggers() {
  try { cleanupObsoleteTriggers(); return { ok: true, message: '不要トリガーを削除しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
function adminPanel_addAnalysisReport() {
  try { addAnalysisReportManual(); return { ok: true, message: '分析レポートリンクを追加しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

// =====================================================
// AI画像判定ステータス
// =====================================================

function adminPanel_checkAiStatus() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aiSh = ss.getSheetByName('AI画像判定');
    var kwSh = ss.getSheetByName('AIキーワード抽出');

    var aiCount = aiSh ? Math.max(0, aiSh.getLastRow() - 1) : 0;
    var kwCount = kwSh ? Math.max(0, kwSh.getLastRow() - 1) : 0;

    var msg = '【AI画像判定ステータス】\n';
    msg += '■ AI画像判定シート: ' + (aiSh ? aiCount + '件' : '未作成') + '\n';
    msg += '■ AIキーワード抽出シート: ' + kwCount + '件\n';
    msg += '■ Gemini判定: gas-proxy 5分Cronで自動実行\n';
    msg += '■ AppSheet: Initial Value(LOOKUP)でプリフィル\n';

    if (aiSh && aiCount > 0) {
      var lastRow = aiSh.getLastRow();
      var lastCol = aiSh.getLastColumn();
      var headers = aiSh.getRange(1, 1, 1, lastCol).getValues()[0];
      var dateCol = -1;
      for (var i = 0; i < headers.length; i++) {
        if (String(headers[i]).trim() === '判定日') { dateCol = i + 1; break; }
      }
      if (dateCol > 0) {
        var lastDate = aiSh.getRange(lastRow, dateCol).getValue();
        msg += '■ 最終判定: ' + (lastDate ? Utilities.formatDate(new Date(lastDate), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '不明') + '\n';
      }
      var midCol = -1;
      for (var j = 0; j < headers.length; j++) {
        if (String(headers[j]).trim() === '管理番号') { midCol = j + 1; break; }
      }
      if (midCol > 0) {
        var lastMid = aiSh.getRange(lastRow, midCol).getValue();
        msg += '■ 最終管理番号: ' + lastMid + '\n';
      }
    }

    return { ok: true, message: msg };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

// =====================================================
// トリガー管理
// =====================================================

function adminPanel_listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var list = [];
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    list.push({ id: t.getUniqueId(), fn: t.getHandlerFunction(), type: String(t.getEventType()), source: String(t.getTriggerSource()) });
  }
  return { ok: true, triggers: list };
}

function adminPanel_rebuildTriggers() {
  try { FULL_RESTORE_ALL(); return { ok: true, message: 'トリガーを再構築しました' }; }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}

function adminPanel_deleteTrigger(triggerId) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(triggers[i]);
      return { ok: true, message: triggers[i].getHandlerFunction() + ' を削除しました' };
    }
  }
  return { ok: false, message: 'トリガーが見つかりません' };
}

// =====================================================
// ビジネス設定
// =====================================================

function adminPanel_getBizSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_BIZ_SETTINGS');
  var s = {};
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  return {
    ok: true,
    settings: {
      baseFeeRate: s.baseFeeRate || 0.066,
      baseFeeFix: s.baseFeeFix || 40,
      creditRate: s.creditRate || 0.0325,
      paypayRate: s.paypayRate || 0.035,
      konbiniRate: s.konbiniRate || 0.0275,
      bankRate: s.bankRate || 0.014,
      payeasyRate: s.payeasyRate || 0.0275,
      paidyRate: s.paidyRate || 0.035,
      jimotiRate: s.jimotiRate || 0.10,
      aiModel: s.aiModel || 'gpt-5-mini',
      aiDailyLimit: s.aiDailyLimit || 200,
      aiMaxKeywords: s.aiMaxKeywords || 8,
      aiMinKeywords: s.aiMinKeywords || 3,
      rewardStartYear: s.rewardStartYear || 2025,
      rewardStartMonth: s.rewardStartMonth || 6,
      swapTriggerDay: s.swapTriggerDay || 1,
      monthlyReportFeeRate: s.monthlyReportFeeRate || 0.016
    }
  };
}

function adminPanel_setBizSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('CONFIG_BIZ_SETTINGS');
  var current = {};
  if (raw) { try { current = JSON.parse(raw); } catch (e) {} }
  var keys = Object.keys(settings);
  for (var i = 0; i < keys.length; i++) current[keys[i]] = settings[keys[i]];
  props.setProperty('CONFIG_BIZ_SETTINGS', JSON.stringify(current));
  return { ok: true, message: 'ビジネス設定を保存しました' };
}

// =====================================================
// メール/通知設定
// =====================================================

function adminPanel_getMailSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty('CONFIG_MAIL_SETTINGS');
  var s = {};
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  return {
    ok: true,
    settings: {
      settingsSheet: s.settingsSheet || '設定',
      recipientCol: s.recipientCol || 'K',
      recipientStartRow: s.recipientStartRow || 4,
      shiireSubject: s.shiireSubject || '仕入れ点数の報告が完了しました',
      shiireIntro: s.shiireIntro || '仕入れ管理に登録をお願いします。',
      expenseSubject: s.expenseSubject || '経費が申請されました',
      expenseIntro: s.expenseIntro || '経費が申請されましたので、確認してください。',
      swapSubjectFormat: s.swapSubjectFormat || '【入替リスト】{account} {year}年{month}月分 — {count}件'
    }
  };
}

function adminPanel_setMailSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('CONFIG_MAIL_SETTINGS');
  var current = {};
  if (raw) { try { current = JSON.parse(raw); } catch (e) {} }
  var keys = Object.keys(settings);
  for (var i = 0; i < keys.length; i++) current[keys[i]] = settings[keys[i]];
  props.setProperty('CONFIG_MAIL_SETTINGS', JSON.stringify(current));
  return { ok: true, message: 'メール設定を保存しました' };
}
