// 入替リスト.gs
/**
 * 入替リスト.gs — 商品入替リスト自動生成・メール送信
 *
 * 月末にアカウント別で前月出品数と同数の古い在庫をリスト化し、
 * PDFメールで各運用者に送信する。
 * ※ ステータス変更は返送済みステータス変更.gsが自動処理するため本ファイルでは行わない
 */

const SWAP_CONFIG = {
  PRODUCT_SHEET_NAME: '商品管理',
  WORKER_SHEET_NAME: '作業者マスター',
  HEADER_ROWS: 1,
  ACCOUNTS: [
    { name: '古着屋本舗', emailProp: 'SWAP_EMAIL_FURUGIYAHONPO' },
    { name: 'ほしいが見つかる古着屋さん', emailProp: 'SWAP_EMAIL_HOSHIIGA' }
  ],
  STATUS_ACTIVE: '出品中'
};

// ═══════════════════════════════════════════
//  入替リスト生成＆メール送信
// ═══════════════════════════════════════════

function generateSwapLists() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SWAP_CONFIG.PRODUCT_SHEET_NAME);
  if (!sheet) throw new Error('商品管理シートが見つかりません');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= SWAP_CONFIG.HEADER_ROWS || lastCol <= 0) {
    console.log('入替リスト: 商品データがありません');
    return;
  }

  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const hMap = buildHeaderMap_(header);
  ['管理番号', '出品日', 'ステータス', '使用アカウント', '納品場所'].forEach(function(name) {
    if (!hMap[name]) throw new Error('ヘッダ「' + name + '」が見つかりません');
  });

  const numRows = lastRow - SWAP_CONFIG.HEADER_ROWS;
  const data = sheet.getRange(SWAP_CONFIG.HEADER_ROWS + 1, 1, numRows, lastCol).getDisplayValues();

  // 作業者マスターから除外対象の納品場所を取得
  var excludedNames = getExcludedWorkers_(ss);

  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const props = PropertiesService.getScriptProperties();
  const results = [];

  SWAP_CONFIG.ACCOUNTS.forEach(function(acct) {
    var result = buildSwapList_(data, hMap, acct.name, prevMonthStart, prevMonthEnd, excludedNames);

    if (result.items.length > 0) {
      var pdfBlob = generateSwapPdf_(acct.name, prevMonthStart, prevMonthEnd, result.prevMonthCount, result.items);
      var email = props.getProperty(acct.emailProp);
      var emailSent = false;
      if (email) {
        try {
          sendSwapEmail_(email, acct.name, prevMonthStart, result.prevMonthCount, result.items, pdfBlob);
          emailSent = true;
        } catch (e) {
          console.error('メール送信失敗 (' + acct.name + '): ' + e.message);
        }
      }
      result.email = email;
      result.emailSent = emailSent;
    }
    results.push(result);
  });

  var summary = results.map(function(r) {
    return r.account + ': 前月出品 ' + r.prevMonthCount + '件 → 返送対象 ' + r.items.length + '件' +
      (r.emailSent ? ' → ' + r.email + ' に送信済み' : r.email ? ' → メール送信失敗' : ' (メール未設定)');
  }).join('\n');
  console.log('入替リスト生成完了\n' + summary);
}

/**
 * アカウント別に前月出品数をカウントし、古い順に同数の入替対象を抽出
 */
function buildSwapList_(data, hMap, accountName, prevMonthStart, prevMonthEnd, excludedNames) {
  var colId = hMap['管理番号'] - 1;
  var colDate = hMap['出品日'] - 1;
  var colStatus = hMap['ステータス'] - 1;
  var colAccount = hMap['使用アカウント'] - 1;
  var colLocation = hMap['納品場所'] - 1;
  var activeNorm = normalizeText_(SWAP_CONFIG.STATUS_ACTIVE);

  var activeRows = [];
  var prevMonthCount = 0;

  for (var r = 0; r < data.length; r++) {
    if (normalizeText_(data[r][colAccount]) !== accountName) continue;
    if (normalizeText_(data[r][colStatus]) !== activeNorm) continue;

    // 納品場所が除外対象の作業者なら入替対象から除外
    var location = normalizeText_(data[r][colLocation]);
    if (location && excludedNames[location]) continue;

    var listDate = parseSwapDate_(data[r][colDate]);
    var id = normalizeText_(data[r][colId]);

    if (listDate && listDate >= prevMonthStart && listDate <= prevMonthEnd) {
      prevMonthCount++;
    }

    activeRows.push({ id: id, date: listDate, dateStr: data[r][colDate] });
  }

  if (prevMonthCount === 0) {
    return { account: accountName, prevMonthCount: 0, items: [], email: null, emailSent: false };
  }

  activeRows.sort(function(a, b) {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.getTime() - b.date.getTime();
  });

  var swapItems = activeRows.slice(0, prevMonthCount);
  return { account: accountName, prevMonthCount: prevMonthCount, items: swapItems, email: null, emailSent: false };
}

// ═══════════════════════════════════════════
//  PDF生成（一時SS → PDFエクスポート → 削除）
// ═══════════════════════════════════════════

function generateSwapPdf_(accountName, prevStart, prevEnd, prevCount, items) {
  var title = '入替リスト — ' + accountName;
  var year = prevStart.getFullYear();
  var month = prevStart.getMonth() + 1;
  var periodStr = year + '年' + month + '月出品分（' +
    formatSwapDate_(prevStart) + '〜' + formatSwapDate_(prevEnd) + '）';

  var dateRange = '';
  if (items.length > 0) {
    dateRange = '出品日 ' + items[0].dateStr + ' 〜 ' + items[items.length - 1].dateStr;
  }

  var tmpSs = SpreadsheetApp.create('tmp_swap_' + accountName + '_' + Date.now());
  var tmpId = tmpSs.getId();
  try {
    var sh = tmpSs.getActiveSheet();
    sh.setName('入替リスト');

    // ヘッダー情報
    sh.getRange('A1').setValue(title).setFontSize(14).setFontWeight('bold');
    sh.getRange('A2').setValue('集計期間: ' + periodStr);
    sh.getRange('A3').setValue('前月出品数: ' + prevCount + '件');
    sh.getRange('A4').setValue('返送対象: ' + items.length + '件' + (dateRange ? '（' + dateRange + '）' : ''));

    // テーブルヘッダー（6行目）
    var tableHeaderRow = 6;
    var tableHeaders = ['No.', '管理番号', '使用アカウント', '出品日'];
    sh.getRange(tableHeaderRow, 1, 1, tableHeaders.length).setValues([tableHeaders])
      .setFontWeight('bold')
      .setBackground('#f0f0f0');

    // テーブルデータ
    if (items.length > 0) {
      var tableData = items.map(function(item, i) {
        return [i + 1, item.id, accountName, item.dateStr];
      });
      sh.getRange(tableHeaderRow + 1, 1, tableData.length, tableHeaders.length).setValues(tableData);
    }

    // 列幅調整
    sh.setColumnWidth(1, 50);
    sh.setColumnWidth(2, 120);
    sh.setColumnWidth(3, 200);
    sh.setColumnWidth(4, 100);

    SpreadsheetApp.flush();

    var pdfBlob = exportSwapPdf_(tmpId, title + '.pdf');
    return pdfBlob;
  } finally {
    DriveApp.getFileById(tmpId).setTrashed(true);
  }
}

function exportSwapPdf_(spreadsheetId, filename) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId +
    '/export?format=pdf&size=A4&portrait=true&fitw=true&gridlines=false' +
    '&printtitle=false&sheetnames=false&pagenumbers=false&fzr=false';
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('PDFエクスポート失敗: ' + res.getResponseCode() + ' / ' + res.getContentText());
  }
  return res.getBlob().setName(filename);
}

// ═══════════════════════════════════════════
//  メール送信
// ═══════════════════════════════════════════

function sendSwapEmail_(email, accountName, prevStart, prevCount, items, pdfBlob) {
  var year = prevStart.getFullYear();
  var month = prevStart.getMonth() + 1;
  var subject = '【入替リスト】' + accountName + ' ' + year + '年' + month + '月分 — ' + items.length + '件';

  var dateRange = '';
  if (items.length > 0) {
    dateRange = '\n出品日範囲: ' + items[0].dateStr + ' 〜 ' + items[items.length - 1].dateStr;
  }

  var body = accountName + ' の入替リストです。\n\n' +
    '前月出品数: ' + prevCount + '件\n' +
    '返送対象: ' + items.length + '件' + dateRange + '\n\n' +
    '詳細はPDFをご確認ください。';

  GmailApp.sendEmail(email, subject, body, { attachments: [pdfBlob] });
}

// ═══════════════════════════════════════════
//  ユーティリティ
// ═══════════════════════════════════════════

/**
 * 作業者マスターのB列(名前)・O列(有効フラグ)を読み、
 * 有効フラグがFALSEの作業者名をセットで返す
 */
function getExcludedWorkers_(ss) {
  var excluded = {};

  // 1. 作業者マスター: 有効フラグFALSEの作業者を除外
  var sh = ss.getSheetByName(SWAP_CONFIG.WORKER_SHEET_NAME);
  if (sh) {
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var names = sh.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
      var flags = sh.getRange(2, 15, lastRow - 1, 1).getDisplayValues();
      for (var i = 0; i < names.length; i++) {
        var name = normalizeText_(names[i][0]);
        var flag = String(flags[i][0]).trim().toUpperCase();
        if (name && flag === 'FALSE') excluded[name] = true;
      }
    }
  } else {
    console.log('入替リスト: 作業者マスターシートが見つかりません（除外なしで続行）');
  }

  // 2. スクリプトプロパティ SWAP_EXCLUDE_NAMES で追加除外（カンマ区切り）
  try {
    var extra = PropertiesService.getScriptProperties().getProperty('SWAP_EXCLUDE_NAMES') || '';
    if (extra) {
      extra.split(',').forEach(function(n) {
        var name = normalizeText_(n);
        if (name) excluded[name] = true;
      });
    }
  } catch (e) {}

  var count = Object.keys(excluded).length;
  if (count > 0) console.log('入替リスト: 除外作業者 ' + count + '名: ' + Object.keys(excluded).join(', '));
  return excluded;
}

function parseSwapDate_(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  var s = String(str).trim();
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatSwapDate_(d) {
  if (!d) return '';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

// ═══════════════════════════════════════════
//  トリガー設定（毎月28日 9時）
// ═══════════════════════════════════════════

function setupSwapListTrigger() {
  replaceTrigger_('generateSwapLists', function(tb) {
    tb.timeBased().onMonthDay(28).atHour(9).create();
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('入替リストトリガーを設定しました（毎月28日 9時）', '完了', 5);
}
