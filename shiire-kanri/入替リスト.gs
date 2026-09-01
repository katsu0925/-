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

// ─── PDFエクスポートのペーシング／リトライ設定 ───────────────
//  複数アカウントを1実行でPDF化すると、Googleのエクスポートエンドポイントが
//  短時間の連続アクセスをスロットリングし、3件目以降がハング → GAS6分上限で
//  実行ごと強制終了 → 最後尾アカウント（例:かつ）が未配信＋サマリー未送信になる。
//  対策として (1)エクスポート間に最小間隔を空ける (2)429/5xx・fetch例外は指数
//  バックオフでリトライする。
var SWAP_EXPORT_MIN_GAP_MS = 2500;    // 直前のPDFエクスポートからの最小間隔
var SWAP_EXPORT_MAX_ATTEMPTS = 4;     // 1エクスポートあたりの最大試行回数
var SWAP_EXPORT_BACKOFF_MS = 4000;    // リトライ待機ベース（試行ごとに ×attempt = 4s,8s,12s）
var _swapExportLastTs = 0;            // 直近エクスポート時刻（同一実行内で保持しペーシングに使用）

// ─── 送れなかった分の自動持ち越し設定 ─────────────────────
//  Apps Script のメール枠(無料Gmail=100通/日)は Google アカウント単位で全スクリプト
//  共有のため、同じ9時台に走る saisun-list のメルマガ配信が枠を使い切ると、
//  入替リストの最後尾アカウント（例:かつ）だけ送信できずに落ちる（2026-09-01 実例）。
//  対策として「送れなかったアカウントをプロパティに退避 → 1時間ごとに残枠を見て、
//  空き次第そのまま送る」方式にする。枠が無い間はメールを1通も消費しない。
var SWAP_PENDING_PROP = 'SWAP_PENDING_JSON';  // 持ち越し状態の保存先（Script Properties）
var SWAP_RETRY_FN = 'retrySwapListPending';   // 持ち越し再送のハンドラ名
var SWAP_RETRY_INTERVAL_MS = 60 * 60 * 1000;  // 再チェック間隔（1時間）
var SWAP_RETRY_MAX_HOURS = 72;                // 打ち切りまでの時間（3日）
var SWAP_QUOTA_RESERVE = 2;                   // サマリー・緊急メール用に必ず残す通数
var SWAP_STATUS_DONE = '送信完了';
var SWAP_STATUS_NONE = '対象0件（送信なし）';
var SWAP_STATUS_CARRY = 'メール枠不足で持ち越し';

// ═══════════════════════════════════════════
//  入替リスト生成＆メール送信
// ═══════════════════════════════════════════

/**
 * 入替リストを生成・送信する。
 * @param {Array<string>=} filterNames 指定時はこのアカウント名だけに絞って送信（手動再送用）。
 *   トリガーからは引数なしで呼ばれ、全アカウントが対象になる。
 * @param {{monthStartMs:number, firstFailedAt:number, done:Object}=} retryCtx
 *   持ち越し再送のときだけ retrySwapListPending から内部的に渡す。
 *   集計対象月を初回実行時に固定し、既に届いた宛先への二重送信を防ぐ。
 */
function generateSwapLists(filterNames, retryCtx) {
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
  // 持ち越し再送では初回実行時の集計対象月をそのまま使う（月をまたいでも中身がズレない）
  const prevMonthStart = (retryCtx && retryCtx.monthStartMs)
    ? new Date(retryCtx.monthStartMs)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(prevMonthStart.getFullYear(), prevMonthStart.getMonth() + 1, 0);

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
  // 送れなかったアカウント。実行の最後にプロパティへ退避して1時間後に再挑戦する。
  var carryOver = [];
  // 持ち越し再送時に「既に届いている宛先」を飛ばすためのマップ { アカウント名: {op:bool, admin:bool} }
  var doneMap = (retryCtx && retryCtx.done) || {};

  // ★ アカウントごとに try/catch で完全隔離する。
  //   1アカウントの失敗（PDF生成例外・メール例外）が後続アカウントの配信を止めない。
  accounts.forEach(function(acct) {
    var done = doneMap[acct.name] || {};
    var result = {
      account: acct.name, prevMonthCount: 0, items: [],
      email: acct.email || '', emailSent: false, adminSent: false, status: '', error: ''
    };
    try {
      var built = buildSwapList_(data, hMap, acct.name, prevMonthStart, prevMonthEnd, excludedNames);
      result.prevMonthCount = built.prevMonthCount;
      result.items = built.items;

      // このアカウントで今回まだ送っていない宛先の数（＝必要なメール枠）
      var needOperator = !!(acct.email && !done.op);
      var needAdmin = !!(adminEmail && adminEmail !== acct.email && !done.admin);
      var need = (needOperator ? 1 : 0) + (needAdmin ? 1 : 0);
      var remaining = swap_remainingQuota_();

      if (result.items.length === 0) {
        result.status = SWAP_STATUS_NONE;
      } else if (need === 0) {
        // 持ち越し再送で全宛先が既に届いている（通常は起きないが安全弁）
        result.emailSent = !!done.op; result.adminSent = !!done.admin;
        result.status = SWAP_STATUS_DONE;
      } else if (remaining < need + SWAP_QUOTA_RESERVE) {
        // ★枠不足。PDFも作らずそのまま持ち越す（メールを1通も消費しない）
        result.status = SWAP_STATUS_CARRY;
        result.error = 'メール残枠' + remaining + '通（必要' + need + '通＋予備' + SWAP_QUOTA_RESERVE + '通）';
        console.warn('入替リスト: ' + acct.name + ' を持ち越し — ' + result.error);
      } else {
        var pdfBlob = generateSwapPdf_(acct.name, prevMonthStart, prevMonthEnd, result.prevMonthCount, result.items);
        var errs = [];
        // 運用者へ送信（メール未設定ならスキップ＝管理者には届く）
        if (needOperator) {
          try { sendSwapEmail_(acct.email, acct.name, prevMonthStart, result.prevMonthCount, result.items, pdfBlob); result.emailSent = true; }
          catch (e) { errs.push('運用者送信失敗: ' + (e.message || e)); console.error('入替リスト 運用者送信失敗 (' + acct.name + '): ' + (e.message || e)); }
        } else if (done.op) { result.emailSent = true; }
        // 管理者へも同じPDFを送信（運用者送信が失敗しても独立して実行）
        if (needAdmin) {
          try { sendSwapEmail_(adminEmail, acct.name, prevMonthStart, result.prevMonthCount, result.items, pdfBlob); result.adminSent = true; }
          catch (e) { errs.push('管理者送信失敗: ' + (e.message || e)); console.error('入替リスト 管理者送信失敗 (' + acct.name + '): ' + (e.message || e)); }
        } else if (done.admin) { result.adminSent = true; }
        result.error = errs.join(' / ');
        result.status = errs.length ? ((result.emailSent || result.adminSent) ? '一部送信' : '送信失敗') : SWAP_STATUS_DONE;
      }
    } catch (e) {
      result.error = String(e && e.message || e);
      result.status = '失敗（PDF生成等）';
      console.error('入替リスト処理失敗 (' + acct.name + '): ' + result.error);
    }
    results.push(result);

    // 未達の宛先が残っていれば持ち越し対象にする（届いた宛先は done に記録＝二重送信しない）
    if (result.status !== SWAP_STATUS_DONE && result.status !== SWAP_STATUS_NONE) {
      carryOver.push({
        name: acct.name,
        done: { op: !!(done.op || result.emailSent), admin: !!(done.admin || result.adminSent) },
        lastError: result.status + (result.error ? ' / ' + result.error : '')
      });
    }

    // 1アカウントずつログへ追記（途中でタイムアウトしても痕跡が残る＝原因切り分け用）。
    // 持ち越し待ちの1時間ごとの再送では、決着が付いた行だけ記録してログの肥大を防ぐ。
    var shouldLog = !retryCtx || result.status === SWAP_STATUS_DONE ||
      result.status === SWAP_STATUS_NONE || result.status === '一部送信';
    if (shouldLog) {
      appendSwapLog_([[
        nowStr, monthLabel, acct.name, result.prevMonthCount, result.items.length,
        result.emailSent ? acct.email : (acct.email ? (result.status === SWAP_STATUS_CARRY ? '持ち越し' : '送信失敗') : '(未設定)'),
        result.adminSent ? adminEmail : (adminEmail ? (result.items.length ? (result.status === SWAP_STATUS_CARRY ? '持ち越し' : (result.status.indexOf('失敗') >= 0 ? '送信失敗' : '-')) : '-') : '(管理者未設定)'),
        result.status, result.error || ''
      ]]);
    }
  });

  // ★送れなかった分は退避して1時間後に再挑戦。全部送れていれば持ち越しを解除する。
  //   filterNames で一部だけ流したときに、対象外アカウントの持ち越しを消さないようマージする。
  swap_updatePending_(props, accounts, carryOver, prevMonthStart, retryCtx);

  // 管理者へ月次サマリーを送信（失敗があっても全体結果が手元に届くようにする）。
  // 持ち越し再送では、全部送り切ったときだけ完了報告を出す（毎時サマリーで枠を食わない）。
  if (!retryCtx) {
    sendSwapSummaryToAdmin_(adminEmail, monthLabel, results, carryOver, false);
  } else if (carryOver.length === 0) {
    sendSwapSummaryToAdmin_(adminEmail, monthLabel, results, carryOver, true);
  }

  var summary = results.map(function(r) {
    return r.account + ': 前月販売 ' + r.prevMonthCount + '件 → 返送対象 ' + r.items.length + '件 [' + r.status + ']' + (r.error ? ' ' + r.error : '');
  }).join('\n');
  console.log('入替リスト生成完了\n' + summary +
    (carryOver.length ? '\n※持ち越し ' + carryOver.length + '件（1時間後に自動再送）' : ''));
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
 * 「かつ」だけへ入替リストを送信（手動・再送用の引数なしラッパー）。
 * GASエディタの ▶実行 ドロップダウンは引数を渡せないため、かつ単独で再送
 * したいときはこの関数を選んで実行する（＝generateSwapLists(['かつ']) と同じ）。
 * かつの運用者宛＋管理者控えのみ送信。ほしい・古着屋本舗への重複送信はなし。
 * 集計対象月は実行時点の前月。
 */
function sendSwapListKatsuOnly() {
  return generateSwapLists(['かつ']);
}

// ═══════════════════════════════════════════
//  送れなかった分の自動持ち越し（メール枠が空き次第そのまま送る）
// ═══════════════════════════════════════════

/** 残りメール送信枠。取得に失敗したら0扱い＝安全側（送らずに持ち越す）。 */
function swap_remainingQuota_() {
  try { return MailApp.getRemainingDailyQuota(); }
  catch (e) { console.error('入替リスト: 残枠取得失敗 ' + (e.message || e)); return 0; }
}

/** 持ち越し状態を取得（無ければ null）。 */
function swap_getPending_(props) {
  props = props || PropertiesService.getScriptProperties();
  var raw = props.getProperty(SWAP_PENDING_PROP);
  if (!raw) return null;
  try {
    var st = JSON.parse(raw);
    return (st && st.accounts && st.accounts.length) ? st : null;
  } catch (e) {
    console.error('SWAP_PENDING_JSON パース失敗: ' + (e.message || e));
    return null;
  }
}

/**
 * 今回の実行結果を持ち越し状態へ反映する。
 * 今回処理しなかったアカウント（filterNames で絞ったときの対象外）の持ち越しは温存する。
 * @param {Array<{name:string}>} accounts 今回処理したアカウント一覧
 * @param {Array<Object>} carryOver 今回送れなかったアカウント
 */
function swap_updatePending_(props, accounts, carryOver, prevMonthStart, retryCtx) {
  var processed = {};
  accounts.forEach(function(a) { processed[a.name] = true; });

  var prev = swap_getPending_(props);
  var sameMonth = !!(prev && prev.monthStartMs === prevMonthStart.getTime());
  var merged = [];
  if (sameMonth) {
    prev.accounts.forEach(function(a) { if (!processed[a.name]) merged.push(a); });
  }
  carryOver.forEach(function(a) { merged.push(a); });

  if (merged.length === 0) { swap_clearPending_(props); return; }
  var firstFailedAt = (retryCtx && retryCtx.firstFailedAt) || (sameMonth && prev.firstFailedAt) || Date.now();
  swap_savePending_(props, merged, prevMonthStart, firstFailedAt);
}

/** 持ち越しを保存して1時間後の再挑戦トリガーを張り直す。 */
function swap_savePending_(props, carryOver, prevMonthStart, firstFailedAt) {
  var st = {
    monthStartMs: prevMonthStart.getTime(),
    firstFailedAt: firstFailedAt || Date.now(),
    accounts: carryOver
  };
  props.setProperty(SWAP_PENDING_PROP, JSON.stringify(st));
  try {
    // replaceTrigger_ が同名の既存トリガーを消してから1本だけ張る（毎時ぶら下がりを防ぐ）
    replaceTrigger_(SWAP_RETRY_FN, function(tb) { tb.timeBased().after(SWAP_RETRY_INTERVAL_MS).create(); });
    console.log('入替リスト: ' + carryOver.length + '件を持ち越し（' +
      carryOver.map(function(a) { return a.name; }).join(' / ') + '）→ 1時間後に再挑戦');
  } catch (e) {
    console.error('入替リスト: 再挑戦トリガー作成失敗 ' + (e.message || e));
  }
}

/** 持ち越しを解除して再挑戦トリガーを削除する。 */
function swap_clearPending_(props) {
  props = props || PropertiesService.getScriptProperties();
  props.deleteProperty(SWAP_PENDING_PROP);
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === SWAP_RETRY_FN) ScriptApp.deleteTrigger(t);
    });
  } catch (e) {
    console.error('入替リスト: 再挑戦トリガー削除失敗 ' + (e.message || e));
  }
}

/**
 * 持ち越し分の再送（1時間ごとの自動トリガーから呼ばれる）。
 * メール枠が空いていなければ何もせず、さらに1時間後へ回す（メールを消費しない）。
 * SWAP_RETRY_MAX_HOURS を超えたら打ち切ってログ＋管理者通知を残す。
 */
function retrySwapListPending() {
  var props = PropertiesService.getScriptProperties();
  var st = swap_getPending_(props);
  if (!st) { swap_clearPending_(props); return; }

  var monthStart = new Date(st.monthStartMs);
  var monthLabel = monthStart.getFullYear() + '年' + (monthStart.getMonth() + 1) + '月';
  var names = st.accounts.map(function(a) { return a.name; });

  // 打ち切り判定
  var elapsedH = (Date.now() - (st.firstFailedAt || Date.now())) / 3600000;
  if (elapsedH > SWAP_RETRY_MAX_HOURS) {
    var lastErrs = st.accounts.map(function(a) { return a.name + ': ' + (a.lastError || '不明'); }).join(' / ');
    appendSwapLog_([[
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      monthLabel, names.join(' / '), '', '', '打ち切り', '打ち切り', '持ち越し打ち切り',
      SWAP_RETRY_MAX_HOURS + '時間再試行しても送信できず。手動で generateSwapLists を実行してください / ' + lastErrs
    ]]);
    var adminEmail = props.getProperty('ADMIN_OWNER_EMAIL') || '';
    if (adminEmail && swap_remainingQuota_() >= 1) {
      try {
        MailApp.sendEmail(adminEmail, '【入替リスト】持ち越し配信を打ち切りました ※要対応',
          monthLabel + '分の入替リストのうち、以下のアカウントを ' + SWAP_RETRY_MAX_HOURS + '時間再試行しましたが送信できませんでした。\n\n' +
          lastErrs + '\n\n手動で送るには GASエディタで generateSwapLists を実行してください' +
          '（「かつ」だけなら sendSwapListKatsuOnly）。\n詳細は「' + SWAP_LOG_SHEET_NAME + '」シートをご確認ください。');
      } catch (e) { console.error('入替リスト: 打ち切り通知の送信失敗 ' + (e.message || e)); }
    }
    swap_clearPending_(props);
    return;
  }

  var done = {};
  st.accounts.forEach(function(a) { done[a.name] = a.done || {}; });
  console.log('入替リスト: 持ち越し再挑戦（' + names.join(' / ') + '） 残枠=' + swap_remainingQuota_());
  try {
    generateSwapLists(names, { monthStartMs: st.monthStartMs, firstFailedAt: st.firstFailedAt, done: done });
  } catch (e) {
    console.error('入替リスト: 持ち越し再挑戦で例外 ' + (e.message || e));
  }

  // 一度きりトリガーは発火済み。持ち越しが残っているなら必ず次を張り直す
  // （generateSwapLists が例外や早期returnで抜けても再送チェーンを切らさない）。
  if (swap_getPending_(props)) {
    try {
      replaceTrigger_(SWAP_RETRY_FN, function(tb) { tb.timeBased().after(SWAP_RETRY_INTERVAL_MS).create(); });
    } catch (e) {
      console.error('入替リスト: 再挑戦トリガー再作成失敗 ' + (e.message || e));
    }
  }
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
function sendSwapSummaryToAdmin_(adminEmail, monthLabel, results, carryOver, isRetryComplete) {
  if (!adminEmail) return;
  carryOver = carryOver || [];
  try {
    // 残枠が無いときにサマリーで無理に1通使わない（持ち越し分の配信を優先する）
    if (swap_remainingQuota_() < 1) {
      console.warn('入替リスト: メール残枠なしのためサマリー送信を見送り');
      return;
    }
    var lines = results.map(function(r) {
      return '・' + r.account + ': 前月販売 ' + r.prevMonthCount + '件 → 返送対象 ' + r.items.length + '件 [' + r.status + ']' +
        (r.error ? '\n    ' + r.error : '');
    });
    var anyFail = results.some(function(r) { return r.status.indexOf('失敗') >= 0 || r.status === '一部送信'; });
    var subject = isRetryComplete
      ? '【入替リスト 持ち越し分 配信完了】' + monthLabel + '分'
      : '【入替リスト 配信結果】' + monthLabel + '分' +
        (carryOver.length ? ' ※持ち越しあり（自動再送します）' : (anyFail ? ' ※要確認（失敗あり）' : ''));
    var body = monthLabel + '分の入替リスト' + (isRetryComplete ? '（持ち越し分）' : '') + '配信結果です。\n\n' + lines.join('\n');
    if (carryOver.length) {
      body += '\n\n■ 未配信（1時間ごとにメール枠の空きを確認して自動再送します）\n' +
        carryOver.map(function(a) { return '・' + a.name; }).join('\n') +
        '\n※ ' + SWAP_RETRY_MAX_HOURS + '時間経っても送れない場合は打ち切って改めて通知します。';
    }
    body += '\n\n各アカウントのPDFは個別メールで送信済みです。\n詳細は「' + SWAP_LOG_SHEET_NAME + '」シートをご確認ください。';
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

  // 出品日の古い順（昇順）に並べる。出品日が空欄/不明の商品は「最新」とみなして末尾へ回す。
  // （空欄を最古扱いすると、本日再出品したばかりで出品日未入力の新規出品が
  //   返送対象の先頭に挙がってしまうため。日付のある古い商品を優先する）
  activeRows.sort(function(a, b) {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;   // a に出品日なし → 末尾へ
    if (!b.date) return -1;  // b に出品日なし → 末尾へ
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
  var lastErr = '';

  for (var attempt = 1; attempt <= SWAP_EXPORT_MAX_ATTEMPTS; attempt++) {
    // 連続エクスポートのスロットリング回避: 直前エクスポートから最小間隔を空ける
    // （アカウント間・リトライ間の両方に効く。初回は _swapExportLastTs=0 なので待たない）
    if (_swapExportLastTs) {
      var sinceLast = Date.now() - _swapExportLastTs;
      if (sinceLast < SWAP_EXPORT_MIN_GAP_MS) Utilities.sleep(SWAP_EXPORT_MIN_GAP_MS - sinceLast);
    }

    var res = null, code = 0, fetchErr = null;
    try {
      res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      code = res.getResponseCode();
    } catch (e) {
      fetchErr = String(e && e.message || e); // fetch自体の例外（接続断・タイムアウト等）もリトライ対象
    }
    _swapExportLastTs = Date.now();

    if (!fetchErr && code === 200) {
      return res.getBlob().setName(filename);
    }
    // 恒久的エラー（401/403 認可切れ・404 等、429以外の4xx）はリトライ無意味 → 即中断
    if (!fetchErr && code !== 429 && code < 500) {
      throw new Error('PDFエクスポート失敗: ' + code + ' / ' + res.getContentText());
    }
    // 一時的エラー（429/5xx / fetch例外）→ 指数バックオフして再試行
    lastErr = fetchErr ? ('fetch例外: ' + fetchErr) : ('PDFエクスポート失敗: ' + code);
    if (attempt < SWAP_EXPORT_MAX_ATTEMPTS) {
      Utilities.sleep(SWAP_EXPORT_BACKOFF_MS * attempt); // 4s → 8s → 12s
    }
  }
  throw new Error(lastErr + '（' + SWAP_EXPORT_MAX_ATTEMPTS + '回リトライ後）');
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
