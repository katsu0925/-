// MetaAdsReport.gs
// Meta広告マネージャのCSVをGoogleドライブから取り込み、スプレッドシートに反映

/**
 * Script Properties:
 *   META_CSV_FOLDER_ID — CSVアップロード先のGoogleドライブフォルダID
 */

var META_REPORT_SHEET_NAME_ = 'Meta広告レポート';

/** CSVヘッダー → シート列のマッピング */
var META_CSV_COLUMNS_ = [
  { csv: '広告の名前',                         label: '広告名' },
  { csv: '広告の配信',                         label: 'ステータス' },
  { csv: 'インプレッション',                   label: 'インプレッション' },
  { csv: 'リーチ',                             label: 'リーチ' },
  { csv: 'フリークエンシー',                   label: 'フリークエンシー' },
  { csv: 'リンクのクリック',                   label: 'クリック数' },
  { csv: 'CTR(リンククリックスルー率)',         label: 'CTR(%)' },
  { csv: 'CPC(リンククリックの単価) (JPY)',    label: 'CPC(円)' },
  { csv: '消化金額 (JPY)',                     label: '消化金額(円)' },
  { csv: 'CPM(インプレッション単価) (JPY)',    label: 'CPM(円)' },
  { csv: '結果',                               label: 'CV数' },
  { csv: '結果の単価',                         label: 'CPA(円)' },
  { csv: 'ランディングページビュー',           label: 'LP閲覧数' },
  { csv: '品質ランキング',                     label: '品質ランキング' },
  { csv: 'エンゲージメント率ランキング',       label: 'エンゲージメント率' },
  { csv: 'コンバージョン率ランキング',         label: 'コンバージョン率' },
  { csv: 'レポート開始日',                     label: '期間開始' },
  { csv: 'レポート終了日',                     label: '期間終了' },
  { csv: '終了日時',                           label: '広告終了日' }
];

/**
 * メイン: ドライブフォルダからMeta広告CSVを取り込み、シートに反映
 * cronDaily8 から呼び出し
 */
function importMetaAdsCsv() {
  var folderId = PropertiesService.getScriptProperties().getProperty('META_CSV_FOLDER_ID');
  if (!folderId) {
    Logger.log('META_CSV_FOLDER_ID が未設定');
    return;
  }

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.CSV);

  // 最新のCSVファイルを取得（更新日時順）
  var latestFile = null;
  var latestDate = new Date(0);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getLastUpdated() > latestDate) {
      latestDate = f.getLastUpdated();
      latestFile = f;
    }
  }

  if (!latestFile) {
    Logger.log('CSVファイルが見つかりません');
    return;
  }

  var csvText = latestFile.getBlob().getDataAsString('UTF-8');
  var rows = metaParseCSV_(csvText);
  if (rows.length < 2) {
    Logger.log('CSVデータが空です');
    return;
  }

  var headerRow = rows[0];
  // CSVヘッダーのインデックスマップ
  var colIndex = {};
  for (var i = 0; i < headerRow.length; i++) {
    colIndex[headerRow[i].trim()] = i;
  }

  // activeのみフィルタリング
  var statusCol = colIndex['広告の配信'];
  var dataRows = [];
  for (var r = 1; r < rows.length; r++) {
    if (rows[r].length < 2) continue;
    var status = (rows[r][statusCol] || '').toString().trim().toLowerCase();
    if (status === 'active') {
      dataRows.push(rows[r]);
    }
  }

  if (dataRows.length === 0) {
    Logger.log('アクティブな広告が見つかりません');
    return;
  }

  // シートヘッダーとデータを構築
  var sheetHeaders = META_CSV_COLUMNS_.map(function(c) { return c.label; });
  sheetHeaders.unshift('取込日時');

  var sheetData = dataRows.map(function(row) {
    var out = [new Date()]; // 取込日時
    META_CSV_COLUMNS_.forEach(function(c) {
      var idx = colIndex[c.csv];
      var val = idx !== undefined ? (row[idx] || '').trim() : '';
      // 数値変換（ランキング系は文字列のまま）
      if (c.csv.indexOf('ランキング') === -1 && val !== '' && val !== '―' && !isNaN(Number(val))) {
        val = Number(val);
      }
      out.push(val);
    });
    return out;
  });

  // シートに書き込み
  var ss = SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
  var sheet = ss.getSheetByName(META_REPORT_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.insertSheet(META_REPORT_SHEET_NAME_);
  }

  sheet.clearContents();

  // ヘッダー
  sheet.getRange(1, 1, 1, sheetHeaders.length).setValues([sheetHeaders]);
  sheet.getRange(1, 1, 1, sheetHeaders.length)
    .setFontWeight('bold')
    .setBackground('#4267B2')
    .setFontColor('#FFFFFF');

  // データ
  if (sheetData.length > 0) {
    sheet.getRange(2, 1, sheetData.length, sheetHeaders.length).setValues(sheetData);
  }

  // 列幅自動調整
  for (var c = 1; c <= sheetHeaders.length; c++) {
    sheet.autoResizeColumn(c);
  }

  Logger.log('Meta広告レポート取込完了: ' + dataRows.length + '件 (ファイル: ' + latestFile.getName() + ')');
}

/**
 * CSV文字列をパース（ダブルクォート・カンマ対応）
 */
function metaParseCSV_(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuote = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var next = i + 1 < text.length ? text[i + 1] : '';

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * 手動テスト用
 */
function testImportMetaAdsCsv() {
  importMetaAdsCsv();
}
