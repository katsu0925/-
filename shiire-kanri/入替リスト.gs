// 入替リスト.gs
/**
 * 入替リスト.gs — 商品入替リスト自動生成・メール送信
 *
 * 月末にアカウント別で前月販売数と同数の古い在庫をリスト化し、
 * PDFメールで各運用者に送信する。
 * ※ ステータス変更は返送済みステータス変更.gsが自動処理するため本ファイルでは行わない
 */

const SWAP_CONFIG = {
  PRODUCT_SHEET_NAME: '商品管理',
  WORKER_SHEET_NAME: '作業者マスター',
  HEADER_ROWS: 1,
  // ↓ 既定（フォールバック）アカウント一覧。
  //   管理パネル「入替リスト」タブで保存すると SWAP_ACCOUNTS_JSON が優先される。
  ACCOUNTS: [
    { name: '古着屋本舗', emailProp: 'SWAP_EMAIL_FURUGIYAHONPO' },
    { name: 'ほしいが見つかる古着屋さん', emailProp: 'SWAP_EMAIL_HOSHIIGA' },
    { name: 'かつ', emailProp: 'SWAP_EMAIL_KATSU' }
  ],
  STATUS_ACTIVE: '出品中'
};

// 配信ログシート名（成功/失敗を毎回記録。失敗が「見えない」問題への対策）
const SWAP_LOG_SHEET_NAME = '入替リスト配信ログ';

// ═══════════════════════════════════════════
//  入替リスト生成＆メール送信
// ═══════════════════════════════════════════

/**
 * 入替リストを生成・送信する。
 * @param {Array<string>=} filterNames 指定時はこのアカウント名だけに絞って送信（手動再送用）。
 *   トリガーからは引数なしで呼ばれ、全アカウントが対象になる。
 */
function generateSwapLists(filterNames) {
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
  ['管理番号', '出品日', '販売日', 'ステータス', '使用アカウント', '納品場所'].forEach(function(name) {
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
  var adminEmail = props.getProperty('ADMIN_OWNER_EMAIL') || '';
  var accounts = getSwapAccounts_(props);
  // filterNames 指定時はそのアカウントだけに絞る（手動再送用。例: 古着屋本舗以外へ後から送る）
  if (filterNames && filterNames.length) {
    var allow = {};
    for (var fi = 0; fi < filterNames.length; fi++) allow[normalizeText_(filterNames[fi])] = true;
    accounts = accounts.filter(function(a) { return allow[normalizeText_(a.name)]; });
    if (accounts.length === 0) { console.log('入替リスト: 指定アカウントに一致なし'); return; }
  }
  var monthLabel = prevMonthStart.getFullYear() + '年' + (prevMonthStart.getMonth() + 1) + '月';
  var nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const results = [];

  // ★ アカウントごとに try/catch で完全隔離する。
  //   1アカウントの失敗（PDF生成例外・メール例外）が後続アカウントの配信を止めない。
  accounts.forEach(function(acct) {
    var result = {
      account: acct.name, prevMonthCount: 0, items: [],
      email: acct.email || '', emailSent: false, adminSent: false, status: '', error: ''
    };
    try {
      var built = buildSwapList_(data, hMap, acct.name, prevMonthStart, prevMonthEnd, excludedNames);
      result.prevMonthCount = built.prevMonthCount;
      result.items = built.items;

      if (result.items.length === 0) {
        result.status = '対象0件（送信なし）';
      } else {
        var pdfBlob = generateSwapPdf_(acct.name, prevMonthStart, prevMonthEnd, result.prevMonthCount, result.items);
        var errs = [];
        // 運用者へ送信（メール未設定ならスキップ＝管理者には届く）
        if (acct.email) {
          try { sendSwapEmail_(acct.email, acct.name, prevMonthStart, result.prevMonthCount, result.items, pdfBlob); result.emailSent = true; }
          catch (e) { errs.push('運用者送信失敗: ' + (e.message || e)); console.error('入替リスト 運用者送信失敗 (' + acct.name + '): ' + (e.message || e)); }
        }
        // 管理者へも同じPDFを送信（運用者送信が失敗しても独立して実行）
        if (adminEmail && adminEmail !== acct.email) {
          try { sendSwapEmail_(adminEmail, acct.name, prevMonthStart, result.prevMonthCount, result.items, pdfBlob); result.adminSent = true; }
          catch (e) { errs.push('管理者送信失敗: ' + (e.message || e)); console.error('入替リスト 管理者送信失敗 (' + acct.name + '): ' + (e.message || e)); }
        }
        result.error = errs.join(' / ');
        result.status = errs.length ? ((result.emailSent || result.adminSent) ? '一部送信' : '送信失敗') : '送信完了';
      }
    } catch (e) {
      result.error = String(e && e.message || e);
      result.status = '失敗（PDF生成等）';
      console.error('入替リスト処理失敗 (' + acct.name + '): ' + result.error);
    }
    results.push(result);

    // 1アカウントずつログへ追記（途中でタイムアウトしても痕跡が残る＝原因切り分け用）
    appendSwapLog_([[
      nowStr, monthLabel, acct.name, result.prevMonthCount, result.items.length,
      result.emailSent ? acct.email : (acct.email ? '送信失敗' : '(未設定)'),
      result.adminSent ? adminEmail : (adminEmail ? (result.items.length ? (result.status.indexOf('失敗') >= 0 ? '送信失敗' : '-') : '-') : '(管理者未設定)'),
      result.status, result.error || ''
    ]]);
  });

  // 管理者へ月次サマリーを必ず送信（失敗があっても全体結果が手元に届くようにする）
  sendSwapSummaryToAdmin_(adminEmail, monthLabel, results);

  var summary = results.map(function(r) {
    return r.account + ': 前月販売 ' + r.prevMonthCount + '件 → 返送対象 ' + r.items.length + '件 [' + r.status + ']' + (r.error ? ' ' + r.error : '');
  }).join('\n');
  console.log('入替リスト生成完了\n' + summary);
}

/**
 * 古着屋本舗以外の全アカウントへ入替リストを送信（手動・再送用）。
 * 月初配信で古着屋本舗だけ届いてしまった場合に、残りのアカウントへ後から送るために使う。
 * 集計対象月は generateSwapLists と同じ（実行時点の前月）。
 */
function sendSwapListsExceptHonpo() {
  var names = getSwapAccounts_().map(function(a) { return a.name; })
    .filter(function(n) { return normalizeText_(n) !== normalizeText_('古着屋本舗'); });
  return generateSwapLists(names);
}

/**
 * 配信対象アカウント一覧を取得する。
 * 優先: SWAP_ACCOUNTS_JSON（管理パネルで保存）/ なければ SWAP_CONFIG.ACCOUNTS（既定）。
 * @return {Array<{name:string, email:string}>}
 */
function getSwapAccounts_(props) {
  props = props || PropertiesService.getScriptProperties();
  var raw = props.getProperty('SWAP_ACCOUNTS_JSON');
  if (raw) {
    try {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        var list = [];
        for (var i = 0; i < arr.length; i++) {
          var name = arr[i] && arr[i].name ? String(arr[i].name).trim() : '';
          if (!name) continue;
          list.push({ name: name, email: arr[i].email ? String(arr[i].email).trim() : '' });
        }
        if (list.length > 0) return list;
      }
    } catch (e) {
      console.error('SWAP_ACCOUNTS_JSON パース失敗: ' + e.message + ' → 既定アカウントを使用');
    }
  }
  // フォールバック: 旧来の SWAP_CONFIG.ACCOUNTS + emailProp
  return SWAP_CONFIG.ACCOUNTS.map(function(a) {
    return { name: a.name, email: a.emailProp ? (props.getProperty(a.emailProp) || '') : '' };
  });
}

/**
 * 配信ログシートへ追記（なければ作成）。失敗してもメイン処理は止めない。
 */
function appendSwapLog_(rows) {
  if (!rows || !rows.length) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SWAP_LOG_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(SWAP_LOG_SHEET_NAME);
      sh.appendRow(['実行日時', '集計対象月', 'アカウント', '前月販売数', '返送対象数', '運用者送信先', '管理者送信先', '状態', '詳細/エラー']);
      sh.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#f0f0f0');
      sh.setFrozenRows(1);
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } catch (e) {
    console.error('入替リスト配信ログ書き込み失敗: ' + e.message);
  }
}

/**
 * 管理者へ月次の配信結果サマリーを送信（全アカウントの成否を1通にまとめる）。
 */
function sendSwapSummaryToAdmin_(adminEmail, monthLabel, results) {
  if (!adminEmail) return;
  try {
    var lines = results.map(function(r) {
      return '・' + r.account + ': 前月販売 ' + r.prevMonthCount + '件 → 返送対象 ' + r.items.length + '件 [' + r.status + ']' +
        (r.error ? '\n    ' + r.error : '');
    });
    var anyFail = results.some(function(r) { return r.status.indexOf('失敗') >= 0 || r.status === '一部送信'; });
    var subject = '【入替リスト 配信結果】' + monthLabel + '分' + (anyFail ? ' ※要確認（失敗あり）' : '');
    var body = monthLabel + '分の入替リスト配信結果です。\n\n' + lines.join('\n') +
      '\n\n各アカウントのPDFは個別メールで送信済みです。\n詳細は「' + SWAP_LOG_SHEET_NAME + '」シートをご確認ください。';
    MailApp.sendEmail(adminEmail, subject, body);
  } catch (e) {
    console.error('入替リスト サマリーメール送信失敗: ' + e.message);
  }
}

/**
 * アカウント別に前月販売数をカウントし、出品中の古い順に同数の入替対象を抽出
 */
function buildSwapList_(data, hMap, accountName, prevMonthStart, prevMonthEnd, excludedNames) {
  // 使用アカウント列の値（normalizeText_ 済）と突き合わせるため、判定キーも正規化する
  accountName = normalizeText_(accountName);
  var colId = hMap['管理番号'] - 1;
  var colDate = hMap['出品日'] - 1;
  var colSaleDate = hMap['販売日'] - 1;
  var colStatus = hMap['ステータス'] - 1;
  var colAccount = hMap['使用アカウント'] - 1;
  var colLocation = hMap['納品場所'] - 1;
  var activeNorm = normalizeText_(SWAP_CONFIG.STATUS_ACTIVE);
  var soldNorm = normalizeText_('売却済み');

  var activeRows = [];
  var prevMonthSalesCount = 0;

  for (var r = 0; r < data.length; r++) {
    if (normalizeText_(data[r][colAccount]) !== accountName) continue;

    var status = normalizeText_(data[r][colStatus]);

    // 販売日が前月 → 販売数カウント（ステータス問わず）
    var saleDate = parseSwapDate_(data[r][colSaleDate]);
    if (saleDate && saleDate >= prevMonthStart && saleDate <= prevMonthEnd) {
      prevMonthSalesCount++;
    }

    // 出品中 → 返送候補プールに追加
    if (status !== activeNorm) continue;

    // 納品場所が除外対象の作業者なら入替対象から除外
    var location = normalizeText_(data[r][colLocation]);
    if (location && excludedNames[location]) continue;

    var listDate = parseSwapDate_(data[r][colDate]);
    var id = normalizeText_(data[r][colId]);

    activeRows.push({ id: id, date: listDate, dateStr: data[r][colDate], location: location });
  }

  if (prevMonthSalesCount === 0) {
    return { account: accountName, prevMonthCount: 0, items: [], email: null, emailSent: false };
  }

  activeRows.sort(function(a, b) {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.getTime() - b.date.getTime();
  });

  var swapItems = activeRows.slice(0, prevMonthSalesCount);
  return { account: accountName, prevMonthCount: prevMonthSalesCount, items: swapItems, email: null, emailSent: false };
}

// ═══════════════════════════════════════════
//  PDF生成（一時SS → PDFエクスポート → 削除）
// ═══════════════════════════════════════════

function generateSwapPdf_(accountName, prevStart, prevEnd, prevCount, items) {
  var title = '入替リスト — ' + accountName;
  var year = prevStart.getFullYear();
  var month = prevStart.getMonth() + 1;
  var periodStr = year + '年' + month + '月販売分（' +
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
    sh.getRange('A3').setValue('前月販売数: ' + prevCount + '件');
    sh.getRange('A4').setValue('返送対象: ' + items.length + '件' + (dateRange ? '（' + dateRange + '）' : ''));

    // テーブルヘッダー（6行目）
    var tableHeaderRow = 6;
    var tableHeaders = ['No.', '管理番号', '納品場所', '使用アカウント', '出品日'];
    sh.getRange(tableHeaderRow, 1, 1, tableHeaders.length).setValues([tableHeaders])
      .setFontWeight('bold')
      .setBackground('#f0f0f0');

    // テーブルデータ
    if (items.length > 0) {
      var tableData = items.map(function(item, i) {
        return [i + 1, item.id, item.location || '', accountName, item.dateStr];
      });
      sh.getRange(tableHeaderRow + 1, 1, tableData.length, tableHeaders.length).setValues(tableData);
    }

    // 列幅調整
    sh.setColumnWidth(1, 50);
    sh.setColumnWidth(2, 120);
    sh.setColumnWidth(3, 100);
    sh.setColumnWidth(4, 200);
    sh.setColumnWidth(5, 100);

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
    '前月販売数: ' + prevCount + '件\n' +
    '返送対象: ' + items.length + '件' + dateRange + '\n\n' +
    '詳細はPDFをご確認ください。';

  // MailApp.sendEmail は appsscript.json の script.send_mail スコープで動作する。
  // GmailApp.sendEmail は gmail.send スコープが必要だが未付与のため権限エラーになる。
  MailApp.sendEmail(email, subject, body, { attachments: [pdfBlob] });
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

  // 作業者マスター: 「入替除外」列がTRUEの作業者を除外
  var sh = ss.getSheetByName(SWAP_CONFIG.WORKER_SHEET_NAME);
  if (sh) {
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow >= 2 && lastCol > 0) {
      var header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
      var nameCol = findColByName_(header, '名前');
      if (nameCol < 0) nameCol = 2; // フォールバック: B列
      var exCol = findColByName_(header, '入替除外');
      if (exCol > 0) {
        var names = sh.getRange(2, nameCol, lastRow - 1, 1).getDisplayValues();
        var flags = sh.getRange(2, exCol, lastRow - 1, 1).getDisplayValues();
        for (var i = 0; i < names.length; i++) {
          var name = normalizeText_(names[i][0]);
          var flag = String(flags[i][0]).trim().toUpperCase();
          if (name && flag === 'TRUE') excluded[name] = true;
        }
      } else {
        console.log('入替リスト: 作業者マスターに「入替除外」列がありません（除外なしで続行）');
      }
    }
  } else {
    console.log('入替リスト: 作業者マスターシートが見つかりません（除外なしで続行）');
  }

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
//  管理者メール設定
// ═══════════════════════════════════════════

function setSwapEmails() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var keys = [
    { key: 'ADMIN_OWNER_EMAIL', label: '管理者' },
    { key: 'SWAP_EMAIL_FURUGIYAHONPO', label: '古着屋本舗' },
    { key: 'SWAP_EMAIL_HOSHIIGA', label: 'ほしいが見つかる古着屋さん' },
    { key: 'SWAP_EMAIL_KATSU', label: 'かつ' }
  ];
  for (var i = 0; i < keys.length; i++) {
    var current = props.getProperty(keys[i].key) || '(未設定)';
    var res = ui.prompt(keys[i].label + ' メール設定', '現在: ' + current + '\n\n新しいメールアドレスを入力\n（変更しない場合は空欄でOK）:', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    var email = res.getResponseText().trim();
    if (email) {
      props.setProperty(keys[i].key, email);
    }
  }
  ui.alert('設定完了', '管理者: ' + (props.getProperty('ADMIN_OWNER_EMAIL') || '未設定') + '\n' +
    '古着屋本舗: ' + (props.getProperty('SWAP_EMAIL_FURUGIYAHONPO') || '未設定') + '\n' +
    'ほしいが見つかる古着屋さん: ' + (props.getProperty('SWAP_EMAIL_HOSHIIGA') || '未設定') + '\n' +
    'かつ: ' + (props.getProperty('SWAP_EMAIL_KATSU') || '未設定'), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  トリガー設定（毎月28日 9時）
// ═══════════════════════════════════════════

function setupSwapListTrigger() {
  replaceTrigger_('generateSwapLists', function(tb) {
    tb.timeBased().onMonthDay(1).atHour(9).create();
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('入替リストトリガーを設定しました（毎月1日 9時）', '完了', 5);
}

// ═══════════════════════════════════════════
//  プレビュー（メール送信なし・PDFのみDrive保存）
// ═══════════════════════════════════════════

/**
 * 5/1 時点で実行された場合のリストをPDF生成のみ行う（メール送信なし）。
 * 集計期間: 2026-04-01 〜 2026-04-30
 * PDF は Drive のルートに保存し、URL をログ出力する。
 */
function generateSwapListsPreview_2026_05_01() {
  generateSwapListsPreviewForMonth_(2026, 4); // 2026年4月分
}

/**
 * 任意の年月を指定してPDFのみ生成（メール送信なし）。
 * @param {number} year  集計対象の年（例: 2026）
 * @param {number} month 集計対象の月（1-12, 例: 4 = 4月販売分）
 */
function generateSwapListsPreviewForMonth_(year, month) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SWAP_CONFIG.PRODUCT_SHEET_NAME);
  if (!sheet) throw new Error('商品管理シートが見つかりません');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= SWAP_CONFIG.HEADER_ROWS || lastCol <= 0) {
    console.log('入替リスト(プレビュー): 商品データがありません');
    return;
  }

  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const hMap = buildHeaderMap_(header);
  ['管理番号', '出品日', '販売日', 'ステータス', '使用アカウント', '納品場所'].forEach(function(name) {
    if (!hMap[name]) throw new Error('ヘッダ「' + name + '」が見つかりません');
  });

  const numRows = lastRow - SWAP_CONFIG.HEADER_ROWS;
  const data = sheet.getRange(SWAP_CONFIG.HEADER_ROWS + 1, 1, numRows, lastCol).getDisplayValues();

  var excludedNames = getExcludedWorkers_(ss);

  // 指定年月の月初〜月末
  var prevMonthStart = new Date(year, month - 1, 1);
  var prevMonthEnd = new Date(year, month, 0);

  // 保存先フォルダ作成
  var folderName = '入替リスト_プレビュー_' + year + '-' + ('0' + month).slice(-2);
  var folder = DriveApp.createFolder(folderName);

  var summary = [];
  getSwapAccounts_().forEach(function(acct) {
    var result = buildSwapList_(data, hMap, acct.name, prevMonthStart, prevMonthEnd, excludedNames);

    if (result.items.length > 0) {
      var pdfBlob = generateSwapPdf_(acct.name, prevMonthStart, prevMonthEnd, result.prevMonthCount, result.items);
      var pdfFile = folder.createFile(pdfBlob);
      summary.push(acct.name + ': 前月販売 ' + result.prevMonthCount + '件 → 返送対象 ' + result.items.length + '件\n  ' + pdfFile.getUrl());
    } else {
      summary.push(acct.name + ': 前月販売 ' + result.prevMonthCount + '件 → 返送対象 0件（PDF未生成）');
    }
  });

  console.log('入替リスト(プレビュー: ' + year + '年' + month + '月販売分) 完了\nフォルダ: ' + folder.getUrl() + '\n' + summary.join('\n'));
  SpreadsheetApp.getActiveSpreadsheet().toast('PDF生成完了: ' + folder.getUrl(), '入替リスト(プレビュー)', 10);
}
