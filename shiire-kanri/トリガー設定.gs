// トリガー設定.gs
function FULL_RESTORE_ALL() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 毎日 0:30 (閾値判定)
  ScriptApp.newTrigger('stampByThreshold').timeBased().everyDays(1).atHour(0).nearMinute(30).inTimezone('GMT+9').create();
  // 変更時 (メーラー・在庫連携・移動報告・返送管理)
  ScriptApp.newTrigger('handleChange_Mailer').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('handleChange_Inventory').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('handleChange_Move').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('handleChange_Return').forSpreadsheet(ss).onChange().create();
  // 1分ごと (AIキーワード抽出)
  ScriptApp.newTrigger('processPendingKeywordRows').timeBased().everyMinutes(1).create();
  // 1時間ごと (分析)
  ScriptApp.newTrigger('buildWorkAnalysis').timeBased().everyHours(1).inTimezone('GMT+9').create();
  // 毎日 3時 (報酬計算・欠番確認)
  ScriptApp.newTrigger('updateRewardsNoFormula').timeBased().everyDays(1).atHour(3).inTimezone('GMT+9').create();
  ScriptApp.newTrigger('出力_欠番確認').timeBased().everyDays(1).atHour(3).inTimezone('GMT+9').create();
  // 毎日 4時 (在庫日数計算)
  ScriptApp.newTrigger('recalcZaikoNissu').timeBased().everyDays(1).atHour(4).inTimezone('GMT+9').create();
  // 毎日 5時 (不要プロパティ自動クリーンアップ)
  ScriptApp.newTrigger('cleanupStaleProps').timeBased().everyDays(1).atHour(5).inTimezone('GMT+9').create();

  console.log('全てのトリガーを復旧しました。');
}
