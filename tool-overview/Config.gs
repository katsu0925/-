const MAIN_SPREADSHEET_ID = '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo';
const DB_SPREADSHEET_ID = '1CkC37iSDgURkWV-Bfhm7dCrz-Aw-Wjjvo29nlYBO1xA';

const TRANSACTION_SHEET = '会計_取引DB';
const SUMMARY_SHEET = '会計_月次集計';
const DASHBOARD_SHEET = '会計_ダッシュボード';
const MASTER_SHEET = '会計_マスタ';
const SETTINGS_SHEET = '会計_設定';
const LOG_SHEET = '会計_ログ';

function getMainSpreadsheet(){
  return SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
}

function getDbSpreadsheet(){
  return SpreadsheetApp.openById(DB_SPREADSHEET_ID);
}

function getPropertyStore(){
  return PropertiesService.getScriptProperties();
}

function getTransactionHeader(){
  return ['取引ID','日付','年月','区分','勘定科目','サブ科目','金額(税込)','税区分','税率','税抜','消費税','口座','支払方法','販路','取引先','まとめID','仕入れID','商品ID/管理番号','証憑リンク','メモ','作成元','同期キー'];
}
