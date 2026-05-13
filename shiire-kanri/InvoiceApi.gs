// InvoiceApi.gs — 請求書機能の計算コア + スタッフ向けAPI
// Phase 2-6 のロジックを集約。Sheets ベース、Web App / Cloudflare doPost 両対応。
// 個人情報・口座・インボイス番号は本ファイル内にハードコードしない（全てSheets由来）。

// ============================================================
// 共通ユーティリティ
// ============================================================

function inv_getSS_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!ssId) throw new Error('SPREADSHEET_ID が未設定');
  return SpreadsheetApp.openById(ssId);
}

function inv_pad2_(n) { return ('0' + n).slice(-2); }
function inv_norm_(s) { return String(s == null ? '' : s).replace(/　/g, ' ').trim(); }
function inv_toNum_(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  var n = parseFloat(String(v == null ? '' : v).replace(/[^\d\.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function inv_tz_() { return Session.getScriptTimeZone() || 'Asia/Tokyo'; }
function inv_nowISO_() { return Utilities.formatDate(new Date(), inv_tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function inv_ymOfDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + inv_pad2_(d.getMonth() + 1);
}
function inv_toYm_(v) {
  if (v instanceof Date) return inv_ymOfDate_(v);
  return inv_norm_(v);
}
function inv_toDateTimeStr_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, inv_tz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  return inv_norm_(v);
}
function inv_prevYm_(today) {
  today = today || new Date();
  var d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return inv_ymOfDate_(d);
}

// シートをヘッダーキーで安全に読むためのマップを返す
//   { headers: [...], idx: { headerName: 0-based-idx } }
function inv_buildHeaderMap_(sh) {
  var lc = sh.getLastColumn();
  if (lc < 1) return { headers: [], idx: {} };
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0].map(function(v){ return inv_norm_(v); });
  var idx = {};
  for (var i = 0; i < hdr.length; i++) {
    if (hdr[i] && !(hdr[i] in idx)) idx[hdr[i]] = i;
  }
  return { headers: hdr, idx: idx };
}

// 行配列から「ヘッダー名→セル値」で読む（無ければ ''）
function inv_v_(row, hmap, name) {
  if (!hmap || !(name in hmap.idx)) return '';
  return row[hmap.idx[name]];
}

// ============================================================
// スタッフ解決
// ============================================================

// メール→スタッフ情報（作業者マスター B列 名前 + 拡張列 + 管理者フラグ）
function inv_resolveStaffByEmail_(email) {
  email = inv_norm_(email).toLowerCase();
  if (!email) throw new Error('email が空です');
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) throw new Error('作業者マスターが見つかりません');
  var lastRow = sh.getLastRow();
  var lastCol = sh.getMaxColumns();
  if (lastRow < 2) throw new Error('作業者マスターにデータがありません');

  var hmap = inv_buildHeaderMap_(sh);
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // 固定: B(2)=名前, D(4)=email1, E(5)=email2, O(15)=有効
  // 拡張: AC..AO はヘッダー名で動的解決
  var EMAIL1_IDX = 3, EMAIL2_IDX = 4, NAME_IDX = 1, ENABLED_IDX = 14;
  var adminIdx = hmap.idx['管理者フラグ'];
  var isAdminIdxKnown = (typeof adminIdx === 'number');

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var e1 = inv_norm_(row[EMAIL1_IDX]).toLowerCase();
    var e2 = inv_norm_(row[EMAIL2_IDX]).toLowerCase();
    if (e1 !== email && e2 !== email) continue;
    var name = inv_norm_(row[NAME_IDX]);
    if (!name) continue;
    var enabled = row[ENABLED_IDX];
    var enabledFlag = (enabled === true) || (String(enabled).toLowerCase() === 'true');
    if (!enabledFlag) throw new Error('アカウントが無効です: ' + email);
    var adminFlag = false;
    if (isAdminIdxKnown) {
      var av = row[adminIdx];
      adminFlag = (av === true) || (String(av).toLowerCase() === 'true');
    }
    return {
      ok: true,
      row: r + 2,
      email: email,
      name: name,
      isAdmin: adminFlag,
      profile: {
        屋号:        inv_norm_(inv_v_(row, hmap, '屋号')),
        本名:        inv_norm_(inv_v_(row, hmap, '本名')) || name,
        郵便番号:    inv_norm_(inv_v_(row, hmap, '郵便番号')),
        住所:        inv_norm_(inv_v_(row, hmap, '住所')),
        電話:        inv_norm_(inv_v_(row, hmap, '電話')),
        銀行名:      inv_norm_(inv_v_(row, hmap, '銀行名')),
        支店名:      inv_norm_(inv_v_(row, hmap, '支店名')),
        口座種別:    inv_norm_(inv_v_(row, hmap, '口座種別')),
        口座番号:    inv_norm_(inv_v_(row, hmap, '口座番号')),
        口座名義:    inv_norm_(inv_v_(row, hmap, '口座名義')),
        インボイス登録番号: inv_norm_(inv_v_(row, hmap, 'インボイス登録番号')),
        振込元希望銀行:    inv_norm_(inv_v_(row, hmap, '振込元希望銀行')),
        スタッフ用備考:    inv_norm_(inv_v_(row, hmap, 'スタッフ用備考'))
      }
    };
  }
  throw new Error('作業者マスターに該当メールがありません: ' + email);
}

// スタッフが自分のプロフィール(個人情報・口座)を保存する
// payload: { 屋号?, 本名?, 郵便番号?, 住所?, 電話?, 銀行名?, 支店名?, 口座種別?, 口座番号?, 口座名義?, インボイス登録番号?, 振込元希望銀行?, スタッフ用備考? }
function inv_saveStaffProfile_(email, payload) {
  payload = payload || {};
  var me = inv_resolveStaffByEmail_(email);
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('作業者マスター');
  var hmap = inv_buildHeaderMap_(sh);
  var allowed = ['屋号','本名','郵便番号','住所','電話','銀行名','支店名','口座種別','口座番号','口座名義','インボイス登録番号','振込元希望銀行','スタッフ用備考'];
  var changed = 0;
  for (var i = 0; i < allowed.length; i++) {
    var key = allowed[i];
    if (!(key in payload)) continue;
    if (!(key in hmap.idx)) continue;
    var col = hmap.idx[key] + 1; // 1-indexed
    sh.getRange(me.row, col).setValue(inv_norm_(payload[key]));
    changed++;
  }
  return { ok: true, changed: changed };
}

// ============================================================
// 経過措置率
// ============================================================

// 指定YM('YYYY/MM') に対する控除可能率と控除不可率を返す
function inv_getGraceRateForMonth_(ym) {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName(INV_SHEET.GRACE);
  if (!sh || sh.getLastRow() < 2) return { 可能率: 0.80, 不可率: 0.20, source: 'default' };
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var r = 0; r < values.length; r++) {
    var start = inv_norm_(values[r][0]);
    var end = inv_norm_(values[r][1]);
    if (!start) continue;
    var inRange = (ym >= start) && (!end || ym <= end);
    if (inRange) {
      return {
        可能率: inv_toNum_(values[r][2]),
        不可率: inv_toNum_(values[r][3]),
        source: 'sheet:row' + (r + 2),
        備考: inv_norm_(values[r][4])
      };
    }
  }
  return { 可能率: 0.80, 不可率: 0.20, source: 'fallback' };
}

// ============================================================
// 管理者設定
// ============================================================

function inv_getAdminSettings_() {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName(INV_SHEET.SETTINGS);
  if (!sh || sh.getLastRow() < 2) {
    return { ok: true, settings: null };
  }
  var hmap = inv_buildHeaderMap_(sh);
  var row = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  var s = {
    有効:           row[hmap.idx['有効']] === true || String(row[hmap.idx['有効']]).toLowerCase() === 'true',
    屋号:           inv_norm_(row[hmap.idx['屋号']]),
    本名:           inv_norm_(row[hmap.idx['本名']]),
    郵便番号:       inv_norm_(row[hmap.idx['郵便番号']]),
    住所:           inv_norm_(row[hmap.idx['住所']]),
    電話:           inv_norm_(row[hmap.idx['電話']]),
    メール:         inv_norm_(row[hmap.idx['メール']]),
    インボイス番号: inv_norm_(row[hmap.idx['インボイス番号']]),
    振込元銀行候補: [],
    '楽天⇔楽天手数料': inv_toNum_(row[hmap.idx['楽天⇔楽天手数料']]),
    他行小額手数料: inv_toNum_(row[hmap.idx['他行小額手数料']]),
    他行高額手数料: inv_toNum_(row[hmap.idx['他行高額手数料']]),
    高額しきい値:   inv_toNum_(row[hmap.idx['高額しきい値']]),
    通知先メール:   inv_norm_(row[hmap.idx['通知先メール']])
  };
  try {
    var banks = JSON.parse(row[hmap.idx['振込元銀行候補(JSON)']] || '[]');
    if (Array.isArray(banks)) s.振込元銀行候補 = banks.map(function(b){ return inv_norm_(b); }).filter(Boolean);
  } catch(e) { s.振込元銀行候補 = []; }
  return { ok: true, settings: s };
}

// 楽天⇔楽天判定: スタッフの振込元希望銀行と管理者の屋号銀行が両方とも「楽天銀行」
// 振込元(管理者側)はスナップショット時点では「管理者設定の最初の候補」を使う想定だが、
// 実際は管理者画面で振込元を選ぶ運用にする。calc 段階では payload.振込元銀行 を参照。
function inv_calcTransferFee_(振込元銀行, スタッフ振込先銀行, 請求額, settings) {
  var fromBank = inv_norm_(振込元銀行);
  var toBank = inv_norm_(スタッフ振込先銀行);
  // 楽天⇔楽天 (どちらも「楽天」を含む)
  if (/楽天/.test(fromBank) && /楽天/.test(toBank)) {
    return settings && typeof settings['楽天⇔楽天手数料'] === 'number' ? settings['楽天⇔楽天手数料'] : 0;
  }
  var threshold = settings && settings.高額しきい値 ? settings.高額しきい値 : 30000;
  if (請求額 >= threshold) {
    return settings && typeof settings.他行高額手数料 === 'number' ? settings.他行高額手数料 : 330;
  }
  return settings && typeof settings.他行小額手数料 === 'number' ? settings.他行小額手数料 : 145;
}

// ============================================================
// 月次サマリー (報酬管理シートから)
// ============================================================

// 報酬管理シート: A=年月(YYYY/MM), B=作業者名, C=メール, D=採寸報酬, E=撮影報酬,
//   F=出品報酬, G=発送報酬, H=在庫管理報酬, I=固定報酬, J=経費合計, K=売上報酬, L=その他報酬
// updateRewardsNoFormula() でこの形に維持されている (D〜L が setValues される L220)
function inv_getMonthlySummary_(staffName, ym) {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('報酬管理');
  if (!sh) return { found: false };
  var lastRow = sh.getLastRow();
  if (lastRow < 3) return { found: false };
  var values = sh.getRange(3, 1, lastRow - 2, 12).getValues();
  for (var r = 0; r < values.length; r++) {
    var aYm = inv_norm_(values[r][0]);
    var name = inv_norm_(values[r][1]);
    if (aYm !== ym || name !== staffName) continue;
    return {
      found: true,
      row: r + 3,
      ym: ym,
      name: name,
      email: inv_norm_(values[r][2]),
      採寸報酬: inv_toNum_(values[r][3]),
      撮影報酬: inv_toNum_(values[r][4]),
      出品報酬: inv_toNum_(values[r][5]),
      発送報酬: inv_toNum_(values[r][6]),
      在庫管理報酬: inv_toNum_(values[r][7]),
      固定報酬: inv_toNum_(values[r][8]),
      経費合計: inv_toNum_(values[r][9]),
      売上報酬: inv_toNum_(values[r][10]),
      その他報酬: inv_toNum_(values[r][11])
    };
  }
  return { found: false };
}

// 採寸/撮影/出品/発送 の件数を商品管理シートから取得（ヘッダー名で動的解決）
// 報酬更新.gs と同じソースから件数のみを再集計（金額は単価をかけて表示する）
function inv_getMonthlyCounts_(staffName, ym) {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('商品管理');
  if (!sh || sh.getLastRow() < 2) {
    return { 採寸件数: 0, 撮影件数: 0, 出品件数: 0, 発送件数: 0 };
  }
  var hmap = inv_buildHeaderMap_(sh);
  function col(cands) {
    for (var i = 0; i < cands.length; i++) if (cands[i] in hmap.idx) return hmap.idx[cands[i]];
    return -1;
  }
  var pairs = [
    { k: '採寸件数', d: col(['採寸日']),               u: col(['採寸者','採寸担当']) },
    { k: '撮影件数', d: col(['撮影日付','撮影日']),    u: col(['撮影者','撮影担当']) },
    { k: '出品件数', d: col(['出品日','出品日付']),    u: col(['出品者','出品担当']) },
    { k: '発送件数', d: col(['発送日付','発送日']),    u: col(['発送者','発送担当']) }
  ];
  var nP = sh.getLastRow() - 1;
  var lc = sh.getLastColumn();
  var values = sh.getRange(2, 1, nP, lc).getValues();
  var counts = { 採寸件数: 0, 撮影件数: 0, 出品件数: 0, 発送件数: 0 };
  for (var r = 0; r < nP; r++) {
    for (var p = 0; p < pairs.length; p++) {
      var pp = pairs[p];
      if (pp.d < 0 || pp.u < 0) continue;
      var d = values[r][pp.d];
      var u = inv_norm_(values[r][pp.u]);
      if (!d || !(d instanceof Date) || isNaN(d.getTime())) continue;
      if (u !== staffName) continue;
      var rowYm = inv_ymOfDate_(d);
      if (rowYm !== ym) continue;
      counts[pp.k]++;
    }
  }
  return counts;
}

// 作業者マスターから単価(F〜M列)を取得
function inv_getStaffRates_(staffRow) {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('作業者マスター');
  // F=6, G=7, H=8, I=9, J=10, K=11, L=12, M=13
  var row = sh.getRange(staffRow, 6, 1, 8).getValues()[0];
  return {
    F_採寸単価: inv_toNum_(row[0]),
    G_撮影単価: inv_toNum_(row[1]),
    H_出品単価: inv_toNum_(row[2]),
    I_発送単価: inv_toNum_(row[3]),
    J_固定報酬: inv_toNum_(row[4]),
    K_売上率:   inv_toNum_(row[5]),
    L_その他:   inv_toNum_(row[6]),
    M_在庫単価: inv_toNum_(row[7])
  };
}

// ============================================================
// 請求書プレビュー計算
// ============================================================

// payload: { ym, email }
// 戻り値: 請求書1枚分の全フィールド (CSVと同じ構造)
function inv_calcInvoicePreview_(email, ym) {
  ym = inv_norm_(ym);
  if (!/^\d{4}\/\d{2}$/.test(ym)) throw new Error('請求月の形式が不正: ' + ym);
  var me = inv_resolveStaffByEmail_(email);
  var summary = inv_getMonthlySummary_(me.name, ym);
  var counts = inv_getMonthlyCounts_(me.name, ym);
  var rates = inv_getStaffRates_(me.row);
  var grace = inv_getGraceRateForMonth_(ym);
  var adminRes = inv_getAdminSettings_();
  var settings = adminRes.settings;

  var 採寸件数 = counts.採寸件数;
  var 撮影件数 = counts.撮影件数;
  var 出品件数 = counts.出品件数;
  var 発送件数 = counts.発送件数;

  // 報酬管理にデータがあれば優先（cron で確定済みの値）
  var 在庫管理報酬 = summary.found ? summary.在庫管理報酬 : 0;
  var 固定報酬     = summary.found ? summary.固定報酬     : rates.J_固定報酬;
  var 経費合計     = summary.found ? summary.経費合計     : 0;
  var 売上報酬     = summary.found ? summary.売上報酬     : 0;
  var その他報酬   = summary.found ? summary.その他報酬   : rates.L_その他;
  var 採寸報酬     = summary.found ? summary.採寸報酬     : 採寸件数 * rates.F_採寸単価;
  var 撮影報酬     = summary.found ? summary.撮影報酬     : 撮影件数 * rates.G_撮影単価;
  var 出品報酬     = summary.found ? summary.出品報酬     : 出品件数 * rates.H_出品単価;
  var 発送報酬     = summary.found ? summary.発送報酬     : 発送件数 * rates.I_発送単価;

  var 税込合計 = 採寸報酬 + 撮影報酬 + 出品報酬 + 発送報酬
               + 在庫管理報酬 + 固定報酬 + 経費合計 + 売上報酬 + その他報酬;

  // インボイス未登録(=登録番号空) の場合のみ経過措置調整額を適用
  // 登録済みの場合は控除可能率=1.0 とみなして調整額=0
  var hasInvoiceNo = !!me.profile.インボイス登録番号;
  var 控除可能率 = hasInvoiceNo ? 1.00 : grace.可能率;
  var 控除不可率 = hasInvoiceNo ? 0.00 : grace.不可率;
  // 調整額 = 税込合計 × 10/110 × 控除不可率 (買い手=管理者側の控除できない仕入税額分)
  var 調整額 = Math.round(税込合計 * (10/110) * 控除不可率);

  // 振込元銀行: 管理者設定の最初の候補をデフォルトとする
  var 振込元銀行 = (settings && settings.振込元銀行候補 && settings.振込元銀行候補[0]) || '';
  var スタッフ振込先銀行 = me.profile.銀行名;

  // 概算請求額 (手数料計算のために一旦算出)
  var 概算請求額 = 税込合計 - 調整額;
  var 振込手数料 = inv_calcTransferFee_(振込元銀行, スタッフ振込先銀行, 概算請求額, settings);
  var 請求額 = 概算請求額 - 振込手数料;

  return {
    ok: true,
    請求月: ym,
    スタッフ名: me.name,
    スタッフメール: me.email,
    プロフィール: me.profile,
    管理者設定: settings,
    件数: {
      採寸件数: 採寸件数, 撮影件数: 撮影件数, 出品件数: 出品件数, 発送件数: 発送件数
    },
    単価: {
      採寸単価: rates.F_採寸単価, 撮影単価: rates.G_撮影単価,
      出品単価: rates.H_出品単価, 発送単価: rates.I_発送単価
    },
    報酬: {
      採寸報酬: 採寸報酬, 撮影報酬: 撮影報酬, 出品報酬: 出品報酬, 発送報酬: 発送報酬,
      在庫管理報酬: 在庫管理報酬, 固定報酬: 固定報酬, 経費合計: 経費合計,
      売上報酬: 売上報酬, その他報酬: その他報酬
    },
    集計: {
      税込合計: 税込合計,
      控除可能率: 控除可能率, 控除不可率: 控除不可率,
      調整額: 調整額,
      振込元銀行: 振込元銀行, 振込手数料: 振込手数料,
      請求額: 請求額
    },
    報酬管理反映済み: summary.found,
    インボイス登録済み: hasInvoiceNo,
    経過措置: grace
  };
}

// ============================================================
// 請求書番号
// ============================================================

// INV-YYYYMM-{staffRow}-{seq}
function inv_buildInvoiceNo_(ym, staffRow, seq) {
  var ymCompact = ym.replace('/', '');
  return 'INV-' + ymCompact + '-' + staffRow + '-' + (seq || 1);
}

// ============================================================
// 請求書 PDF 生成（弥生請求書フォーマット参考）
// ============================================================

function inv_htmlEscape_(v) {
  var s = (v == null) ? '' : String(v);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inv_fmtYen_(n) {
  var v = Number(n) || 0;
  var sign = v < 0 ? '-' : '';
  v = Math.abs(Math.round(v));
  return sign + '¥' + v.toLocaleString('en-US');
}

function inv_fmtYm_(ym) {
  if (!ym) return '';
  var m = String(ym).match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (!m) return String(ym);
  return m[1] + '年' + parseInt(m[2], 10) + '月';
}

// 電話番号の先頭0補完（Sheets が数値型化して先頭0を落とす対策）
function inv_normPhone_(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (!s) return '';
  // ハイフン・括弧・空白を含むものはそのまま（ユーザー入力時のフォーマットを尊重）
  if (/[\-\s\(\)]/.test(s)) return s;
  // 純粋な数字のみのとき、桁数で先頭0を補完
  if (/^\d+$/.test(s)) {
    if (s.length === 10) return '0' + s; // 携帯11桁の頭0欠落
    if (s.length === 9)  return '0' + s; // 固定10桁の頭0欠落
  }
  return s;
}

// 弥生風請求書 HTML
//   invoice: 請求書オブジェクト
//   adminSettings: 請求先（管理者）の情報
function inv_buildInvoiceHtml_(invoice, adminSettings) {
  var p = invoice.プロフィール || {};
  var c = invoice.件数 || {};
  var r = invoice.報酬 || {};
  var s = invoice.集計 || {};
  var u = invoice.単価 || {};
  var adm = adminSettings || {};
  var esc = inv_htmlEscape_;
  var yen = inv_fmtYen_;

  // 明細行を組み立て（0は省略）
  var items = [];
  function addQty(name, qty, unit) {
    var q = Number(qty) || 0;
    var up = Number(unit) || 0;
    if (q > 0 && up !== 0) items.push({ name: name, qty: q, unit: up, amt: q * up });
  }
  function addOne(name, amt) {
    var a = Number(amt) || 0;
    if (a !== 0) items.push({ name: name, qty: 1, unit: a, amt: a });
  }
  addQty('採寸料', c.採寸件数, u.採寸単価);
  addQty('撮影料', c.撮影件数, u.撮影単価);
  addQty('出品料', c.出品件数, u.出品単価);
  addQty('発送料', c.発送件数, u.発送単価);
  addOne('在庫管理費', r.在庫管理報酬);
  addOne('固定報酬',   r.固定報酬);
  addOne('立替経費',   r.経費合計);
  addOne('売上連動報酬', r.売上報酬);
  addOne('その他業務', r.その他報酬);

  var subtotal = s.税込合計 != null ? Number(s.税込合計) : items.reduce(function(a, it){ return a + it.amt; }, 0);
  var graceRate = s.控除可能率 != null ? s.控除可能率 : '';
  var adjustment = Number(s.調整額) || 0;
  var transferFee = Number(s.振込手数料) || 0;
  var total = Number(s.請求額) || 0;
  var issuedAt = invoice.作成日時 || inv_nowISO_();
  var issuedDate = String(issuedAt).slice(0, 10).replace(/-/g, '/');
  var ymJp = inv_fmtYm_(invoice.請求月);

  var itemRows = items.map(function(it){
    return '<tr>' +
      '<td class="c-name">' + esc(it.name) + '</td>' +
      '<td class="c-qty">' + (it.qty || '') + '</td>' +
      '<td class="c-unit">' + (it.qty > 1 ? yen(it.unit) : '') + '</td>' +
      '<td class="c-amt">' + yen(it.amt) + '</td>' +
    '</tr>';
  }).join('');
  // 余白行（最低7行）
  var padRows = Math.max(0, 7 - items.length);
  for (var i = 0; i < padRows; i++) {
    itemRows += '<tr><td class="c-name">&nbsp;</td><td class="c-qty"></td><td class="c-unit"></td><td class="c-amt"></td></tr>';
  }

  // インボイス控除注釈
  var graceNote = '';
  if (graceRate !== '' && graceRate != null && !p.インボイス登録番号) {
    var pct = Math.round((1 - Number(graceRate)) * 100);
    graceNote = '※インボイス未登録のため経過措置 ' + pct + '% 控除';
  }

  var addressLine = (p.郵便番号 ? '〒' + esc(p.郵便番号) + '　' : '') + esc(p.住所 || '');
  var pPhone = inv_normPhone_(p.電話);
  var admPhone = inv_normPhone_(adm.電話);
  var holder = esc(p.口座名義 || p.本名 || invoice.スタッフ名 || '');

  var admAddress = (adm.郵便番号 ? '〒' + esc(adm.郵便番号) + '　' : '') + esc(adm.住所 || '');
  var admYago = esc(adm.屋号 || '株式会社デタウリ');
  var admHonmyo = esc(adm.本名 || '');

  var html =
'<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>請求書</title>' +
'<style>' +
'@page { size: A4; margin: 16mm 14mm; }' +
'body { font-family: "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif; color:#222; font-size:11pt; line-height:1.55; }' +
'.title { text-align:center; font-size:26pt; letter-spacing:0.5em; font-weight:700; padding-bottom:8px; border-bottom:2px solid #222; margin-bottom:18px; }' +
'.head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; gap:20px; }' +
'.head .left { flex:1.2; }' +
'.head .right { flex:1; text-align:right; }' +
'.addressee { font-size:16pt; font-weight:700; border-bottom:1.5px solid #333; padding-bottom:4px; margin-bottom:8px; }' +
'.addressee small { font-size:11pt; margin-left:6px; }' +
'.meta { font-size:10.5pt; line-height:1.7; }' +
'.meta .row { display:flex; justify-content:space-between; gap:14px; }' +
'.meta .row .lab { color:#555; }' +
'.preface { margin:10px 0 14px; font-size:11pt; }' +
'.total-box { background:#f4f6fa; border:1.5px solid #345; padding:12px 16px; margin:8px 0 18px; border-radius:6px; display:flex; align-items:center; justify-content:space-between; }' +
'.total-box .lab { font-size:13pt; font-weight:700; color:#234; }' +
'.total-box .amt { font-size:22pt; font-weight:800; color:#0a3a6e; letter-spacing:0.04em; }' +
'table.items { width:100%; border-collapse:collapse; margin-bottom:14px; }' +
'table.items th { background:#314c70; color:#fff; padding:7px 8px; font-weight:600; font-size:10.5pt; }' +
'table.items td { border-bottom:1px solid #cdd5e0; padding:7px 8px; font-size:10.5pt; }' +
'table.items td.c-name { width:46%; }' +
'table.items td.c-qty  { width:12%; text-align:center; }' +
'table.items td.c-unit { width:20%; text-align:right; }' +
'table.items td.c-amt  { width:22%; text-align:right; }' +
'.summary { display:flex; justify-content:flex-end; }' +
'.summary table { border-collapse:collapse; min-width:46%; }' +
'.summary td { padding:5px 10px; font-size:10.5pt; }' +
'.summary td.lab { background:#eef2f7; color:#234; font-weight:600; width:55%; }' +
'.summary td.val { text-align:right; border-bottom:1px solid #cdd5e0; }' +
'.summary tr.tot td { font-size:12pt; font-weight:700; color:#0a3a6e; background:#dde7f3; }' +
'.bank-box { margin:18px 0; border:1.2px solid #345; border-radius:4px; padding:10px 14px; background:#fafbfd; }' +
'.bank-box .ttl { font-weight:700; color:#234; margin-bottom:6px; font-size:11pt; }' +
'.bank-box table { width:100%; border-collapse:collapse; }' +
'.bank-box td { padding:3px 6px; font-size:10.5pt; line-height:1.6; vertical-align:top; }' +
'.bank-box td.lab { width:30%; color:#555; background:#eef2f7; font-weight:600; }' +
'.bank-box td.val { width:70%; }' +
'.note { font-size:9.5pt; color:#666; margin-top:4px; }' +
'.issuer { margin-top:18px; padding-top:10px; border-top:1px dashed #999; font-size:10pt; line-height:1.7; }' +
'.issuer .name { font-size:12pt; font-weight:700; }' +
'</style></head><body>' +
'<div class="title">請求書</div>' +
'<div class="head">' +
  '<div class="left">' +
    '<div class="addressee">' + admYago + '<small>御中</small></div>' +
    (admHonmyo ? '<div style="font-size:11pt;margin:2px 0 6px 2px;">ご担当：' + admHonmyo + ' 様</div>' : '') +
    '<div class="meta">' +
      (admAddress ? '<div>' + admAddress + '</div>' : '') +
      (admPhone ? '<div>TEL: ' + esc(admPhone) + '</div>' : '') +
    '</div>' +
    '<div class="preface">下記の通りご請求申し上げます。</div>' +
  '</div>' +
  '<div class="right">' +
    '<div class="meta">' +
      '<div class="row"><span class="lab">発行日</span><span>' + esc(issuedDate) + '</span></div>' +
      '<div class="row"><span class="lab">請求書番号</span><span>' + esc(invoice.請求書番号 || '') + '</span></div>' +
      '<div class="row"><span class="lab">対象月</span><span>' + esc(ymJp) + '</span></div>' +
    '</div>' +
  '</div>' +
'</div>' +
'<div class="total-box">' +
  '<div class="lab">ご請求金額</div>' +
  '<div class="amt">' + yen(total) + ' <span style="font-size:11pt;font-weight:600;">(税込)</span></div>' +
'</div>' +
'<table class="items">' +
  '<thead><tr><th>品目</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>' +
  '<tbody>' + itemRows + '</tbody>' +
'</table>' +
'<div class="summary"><table>' +
  '<tr><td class="lab">小計</td><td class="val">' + yen(subtotal) + '</td></tr>' +
  (adjustment ? '<tr><td class="lab">インボイス控除</td><td class="val">' + yen(adjustment) + '</td></tr>' : '') +
  (transferFee ? '<tr><td class="lab">振込手数料</td><td class="val">' + yen(-transferFee) + '</td></tr>' : '') +
  '<tr class="tot"><td class="lab">合計（請求額）</td><td class="val">' + yen(total) + '</td></tr>' +
'</table></div>' +
(graceNote ? '<div class="note">' + esc(graceNote) + '</div>' : '') +
'<div class="bank-box">' +
  '<div class="ttl">お振込先</div>' +
  '<table>' +
    '<tr><td class="lab">銀行名</td><td class="val">' + esc(p.銀行名 || '') + '</td></tr>' +
    '<tr><td class="lab">支店名</td><td class="val">' + esc(p.支店名 || '') + '</td></tr>' +
    '<tr><td class="lab">口座種別</td><td class="val">' + esc(p.口座種別 || '') + '</td></tr>' +
    '<tr><td class="lab">口座番号</td><td class="val">' + esc(p.口座番号 || '') + '</td></tr>' +
    '<tr><td class="lab">口座名義</td><td class="val">' + holder + '</td></tr>' +
  '</table>' +
'</div>' +
'<div class="issuer">' +
  '<div class="name">' + esc(p.屋号 || p.本名 || invoice.スタッフ名 || '') + '</div>' +
  (p.本名 && p.屋号 ? '<div>' + esc(p.本名) + '</div>' : '') +
  (addressLine ? '<div>' + addressLine + '</div>' : '') +
  (pPhone ? '<div>TEL: ' + esc(pPhone) + '</div>' : '') +
  (invoice.スタッフメール ? '<div>Email: ' + esc(invoice.スタッフメール) + '</div>' : '') +
  (p.インボイス登録番号 ? '<div>登録番号: ' + esc(p.インボイス登録番号) + '</div>' : '') +
'</div>' +
'</body></html>';
  return html;
}

// PDF Blob 生成
function inv_buildInvoicePdfBlob_(invoice, adminSettings, filename) {
  var html = inv_buildInvoiceHtml_(invoice, adminSettings);
  var htmlBlob = Utilities.newBlob(html, 'text/html', (filename || 'invoice') + '.html');
  return htmlBlob.getAs('application/pdf').setName((filename || 'invoice') + '.pdf');
}

// PDF ファイル名: {本名}_{請求額}円_{YYYY年MM月}.pdf（'/' は '-' に正規化）
function inv_buildInvoicePdfFilename_(invoice) {
  var p = invoice.プロフィール || {};
  var s = invoice.集計 || {};
  var name = (p.本名 || invoice.スタッフ名 || '請求書').replace(/[\\\/:\*\?"<>\|]/g, '-');
  var ym = (invoice.請求月 || '').replace('/', '年') + '月';
  var amt = (s.請求額 != null ? s.請求額 : 0).toString().replace(/-/g, 'マイナス');
  return name + '_' + amt + '円_' + ym + '.pdf';
}

// ============================================================
// 請求書履歴 読み取り
// ============================================================

// 履歴シートから1行を構造化 (ヘッダーマップ前提)
function inv_historyRowToObject_(row, hmap) {
  function v(name) {
    if (!(name in hmap.idx)) return '';
    return row[hmap.idx[name]];
  }
  var snap = null;
  try {
    var s = v('スナップショットJSON');
    if (s) snap = JSON.parse(String(s));
  } catch (e) { snap = null; }
  return {
    請求書番号:   inv_norm_(v('請求書番号')),
    請求月:       inv_toYm_(v('請求月')),
    スタッフ名:   inv_norm_(v('スタッフ名')),
    スタッフメール: inv_norm_(v('スタッフメール')),
    屋号:         inv_norm_(v('屋号')),
    本名:         inv_norm_(v('本名')),
    郵便番号:     inv_norm_(v('郵便番号')),
    住所:         inv_norm_(v('住所')),
    電話:         inv_norm_(v('電話')),
    インボイス番号: inv_norm_(v('インボイス番号')),
    銀行名:       inv_norm_(v('銀行名')),
    支店名:       inv_norm_(v('支店名')),
    口座種別:     inv_norm_(v('口座種別')),
    口座番号:     inv_norm_(v('口座番号')),
    口座名義:     inv_norm_(v('口座名義')),
    振込先希望銀行: inv_norm_(v('振込先希望銀行')),
    採寸件数:     inv_toNum_(v('採寸件数')),
    撮影件数:     inv_toNum_(v('撮影件数')),
    出品件数:     inv_toNum_(v('出品件数')),
    発送件数:     inv_toNum_(v('発送件数')),
    在庫管理報酬: inv_toNum_(v('在庫管理報酬')),
    固定報酬:     inv_toNum_(v('固定報酬')),
    経費合計:     inv_toNum_(v('経費合計')),
    売上報酬:     inv_toNum_(v('売上報酬')),
    その他報酬:   inv_toNum_(v('その他報酬')),
    採寸単価:     inv_toNum_(v('採寸単価')),
    撮影単価:     inv_toNum_(v('撮影単価')),
    出品単価:     inv_toNum_(v('出品単価')),
    発送単価:     inv_toNum_(v('発送単価')),
    税込合計:     inv_toNum_(v('税込合計')),
    控除可能率:   inv_toNum_(v('控除可能率')),
    調整額:       inv_toNum_(v('調整額')),
    振込元銀行:   inv_norm_(v('振込元銀行')),
    振込手数料:   inv_toNum_(v('振込手数料')),
    請求額:       inv_toNum_(v('請求額')),
    ステータス:   inv_norm_(v('ステータス')),
    作成日時:     inv_toDateTimeStr_(v('作成日時')),
    更新日時:     inv_toDateTimeStr_(v('更新日時')),
    支払日:       inv_toDateTimeStr_(v('支払日')),
    管理者メモ:   inv_norm_(v('管理者メモ')),
    スナップショット: snap
  };
}

// 履歴を全件読み込み (ヘッダー含む全列、無ければ空配列)
function inv_readAllHistory_() {
  var ss = inv_getSS_();
  var sh = ss.getSheetByName(INV_SHEET.HISTORY);
  if (!sh || sh.getLastRow() < 2) return { hmap: null, rows: [], sheet: sh };
  var hmap = inv_buildHeaderMap_(sh);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var no = inv_norm_(values[r][hmap.idx['請求書番号']]);
    if (!no) continue;
    var obj = inv_historyRowToObject_(values[r], hmap);
    obj._row = r + 2;
    rows.push(obj);
  }
  return { hmap: hmap, rows: rows, sheet: sh };
}

// 指定スタッフ名でフィルタした履歴 + 月リスト
function inv_listInvoicesByStaff_(staffName, opts) {
  opts = opts || {};
  var data = inv_readAllHistory_();
  var rows = data.rows.filter(function(r){ return r.スタッフ名 === staffName; });
  if (opts.ym) rows = rows.filter(function(r){ return r.請求月 === inv_norm_(opts.ym); });
  // 新しい順
  rows.sort(function(a, b){
    if (a.請求月 !== b.請求月) return a.請求月 < b.請求月 ? 1 : -1;
    return (a.作成日時 < b.作成日時) ? 1 : -1;
  });
  return rows;
}

// 指定請求書番号の履歴行を取得
function inv_findInvoiceByNo_(no) {
  no = inv_norm_(no);
  if (!no) return null;
  var data = inv_readAllHistory_();
  for (var i = 0; i < data.rows.length; i++) {
    if (data.rows[i].請求書番号 === no) return { obj: data.rows[i], hmap: data.hmap, sheet: data.sheet };
  }
  return null;
}

// 直近12ヶ月分の月リスト (新しい順、既定では「現在の前月」が先頭)
// alreadyMade: true→既に履歴のある月だけ／false→履歴のない月だけ／省略→全て
function inv_listMyAvailableMonths_(staffName, alreadyMade) {
  var months = [];
  var today = new Date();
  var prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  for (var i = 0; i < 12; i++) {
    var d = new Date(prev.getFullYear(), prev.getMonth() - i, 1);
    months.push(inv_ymOfDate_(d));
  }
  var made = {};
  if (typeof alreadyMade !== 'undefined') {
    var rows = inv_listInvoicesByStaff_(staffName);
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].ステータス === '取消済み') continue;
      made[rows[r].請求月] = true;
    }
    months = months.filter(function(ym){
      return alreadyMade ? !!made[ym] : !made[ym];
    });
  }
  return months;
}

// ============================================================
// スタッフ向け API (Code.gs doPost からも google.script.run からも呼ばれる)
// ============================================================
// 全ての staff_invoice* は冒頭で email から me を解決する。
// payload.staffName / payload.row が来ても無視し me.* を強制使用する。

// email引数があればそれを使い、無ければ Session から取得（google.script.run 経由用）
function inv_currentEmail_(email) {
  email = inv_norm_(email);
  if (email) return email;
  try { var e1 = Session.getActiveUser().getEmail() || ''; if (e1) return inv_norm_(e1); } catch(e) {}
  try { var e2 = Session.getEffectiveUser().getEmail() || ''; if (e2) return inv_norm_(e2); } catch(e) {}
  return '';
}

// 現在ユーザーの解決結果 (画面初期化用)
function staff_invoiceCurrentUser(email) {
  try {
    var em = inv_currentEmail_(email);
    var me = inv_resolveStaffByEmail_(em);
    return {
      ok: true,
      email: me.email,
      name: me.name,
      isAdmin: !!me.isAdmin,
      profile: me.profile
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 履歴一覧 (自分のみ)
//   payload: { ym? }
function staff_listInvoices(payload, email) {
  try {
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    var rows = inv_listInvoicesByStaff_(me.name, payload || {});
    return { ok: true, items: rows };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 履歴1件詳細 (権限チェック: 自分以外は不可)
//   payload: { no }
function staff_getInvoiceDetail(payload, email) {
  try {
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    var no = inv_norm_((payload || {}).no);
    if (!no) throw new Error('請求書番号が空です');
    var hit = inv_findInvoiceByNo_(no);
    if (!hit) throw new Error('請求書が見つかりません: ' + no);
    if (hit.obj.スタッフ名 !== me.name) throw new Error('権限がありません');
    return { ok: true, invoice: hit.obj };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 指定月の請求書プレビュー計算 (履歴に保存しない)
//   payload: { ym }
function staff_calcInvoicePreview(payload, email) {
  try {
    var ym = inv_norm_((payload || {}).ym) || inv_prevYm_();
    var preview = inv_calcInvoicePreview_(inv_currentEmail_(email), ym);
    return preview;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 自分の請求書プロフィール取得
function staff_getInvoiceProfile(payload, email) {
  try {
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    return { ok: true, name: me.name, profile: me.profile };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 自分の請求書プロフィール保存
//   payload: { 屋号?, 本名?, 郵便番号?, ... }
function staff_saveInvoiceProfile(payload, email) {
  try {
    var res = inv_saveStaffProfile_(inv_currentEmail_(email), payload || {});
    return res;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 直近12ヶ月の月リスト
//   payload: { mode? }  mode='unbilled'|'billed'|undefined(all)
function staff_listMyAvailableMonths(payload, email) {
  try {
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    var mode = inv_norm_((payload || {}).mode).toLowerCase();
    var filterMade;
    if (mode === 'billed') filterMade = true;
    else if (mode === 'unbilled') filterMade = false;
    else filterMade = undefined;
    var months = inv_listMyAvailableMonths_(me.name, filterMade);
    return { ok: true, months: months, defaultYm: inv_prevYm_() };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ============================================================
// 請求書作成 (履歴シートに append)
// ============================================================

// Lock 付きでクリティカル区間を実行
function inv_withLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock) lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('処理が混雑しています。少し待ってからもう一度お試しください。');
  try { return fn(); } finally { try { lock.releaseLock(); } catch(e) {} }
}

// 履歴シートから 指定YM・staffRow の最大 seq を取得 (取消済みも含む)
function inv_nextSeq_(historyData, ym, staffRow) {
  var prefix = inv_buildInvoiceNo_(ym, staffRow, '').replace(/-$/, '-');
  var max = 0;
  for (var i = 0; i < historyData.rows.length; i++) {
    var no = historyData.rows[i].請求書番号;
    if (no.indexOf(prefix) !== 0) continue;
    var tail = no.substr(prefix.length);
    var n = parseInt(tail, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// 請求書を履歴シートに作成
//   email: スタッフメール
//   ym: 'YYYY/MM'
//   options: { force?: true で既存があっても新連番で作る }
function inv_createInvoice_(email, ym, options) {
  options = options || {};
  ym = inv_norm_(ym);
  if (!/^\d{4}\/\d{2}$/.test(ym)) throw new Error('請求月の形式が不正: ' + ym);
  return inv_withLock_(function(){
    var me = inv_resolveStaffByEmail_(email);
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.HISTORY);
    if (!sh) throw new Error('請求書履歴シートがありません。inv_setupAllSheets() を実行してください。');

    // 重複チェック (既存 = 取消済み以外)
    var data = inv_readAllHistory_();
    var seq = inv_nextSeq_(data, ym, me.row);
    if (!options.force) {
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (r.スタッフ名 === me.name && r.請求月 === ym && r.ステータス !== '取消済み') {
          return { ok: true, alreadyExists: true, invoiceNo: r.請求書番号, invoice: r };
        }
      }
    }

    // 個人情報チェック
    if (!me.profile.本名)   throw new Error('プロフィール: 本名 が未登録');
    if (!me.profile.銀行名) throw new Error('プロフィール: 銀行名 が未登録');
    if (!me.profile.口座番号) throw new Error('プロフィール: 口座番号 が未登録');

    var preview = inv_calcInvoicePreview_(email, ym);
    var invoiceNo = inv_buildInvoiceNo_(ym, me.row, seq);
    var now = inv_nowISO_();

    // ヘッダーマップから 1行分を構築
    var hmap = inv_buildHeaderMap_(sh);
    var cols = sh.getLastColumn();
    var row = new Array(cols).fill('');
    function set(name, val) {
      if (!(name in hmap.idx)) return;
      row[hmap.idx[name]] = val;
    }
    var p = preview.プロフィール || {};
    var c = preview.件数 || {};
    var u = preview.単価 || {};
    var rr = preview.報酬 || {};
    var s = preview.集計 || {};
    set('請求書番号', invoiceNo);
    set('請求月', ym);
    set('スタッフ名', me.name);
    set('スタッフメール', me.email);
    set('屋号', p.屋号 || '');
    set('本名', p.本名 || me.name);
    set('郵便番号', p.郵便番号 || '');
    set('住所', p.住所 || '');
    set('電話', p.電話 || '');
    set('インボイス番号', p.インボイス登録番号 || '');
    set('銀行名', p.銀行名 || '');
    set('支店名', p.支店名 || '');
    set('口座種別', p.口座種別 || '');
    set('口座番号', p.口座番号 || '');
    set('口座名義', p.口座名義 || '');
    set('振込先希望銀行', p.振込元希望銀行 || '');
    set('採寸件数', c.採寸件数 || 0);
    set('撮影件数', c.撮影件数 || 0);
    set('出品件数', c.出品件数 || 0);
    set('発送件数', c.発送件数 || 0);
    set('在庫管理報酬', rr.在庫管理報酬 || 0);
    set('固定報酬', rr.固定報酬 || 0);
    set('経費合計', rr.経費合計 || 0);
    set('売上報酬', rr.売上報酬 || 0);
    set('その他報酬', rr.その他報酬 || 0);
    set('採寸単価', u.採寸単価 || 0);
    set('撮影単価', u.撮影単価 || 0);
    set('出品単価', u.出品単価 || 0);
    set('発送単価', u.発送単価 || 0);
    set('税込合計', s.税込合計 || 0);
    set('控除可能率', s.控除可能率 != null ? s.控除可能率 : '');
    set('調整額', s.調整額 || 0);
    set('振込元銀行', s.振込元銀行 || '');
    set('振込手数料', s.振込手数料 || 0);
    set('請求額', s.請求額 || 0);
    set('ステータス', '作成済み');
    set('作成日時', now);
    set('更新日時', now);
    set('支払日', '');
    set('スナップショットJSON', JSON.stringify(preview));
    set('管理者メモ', '');

    sh.appendRow(row);
    var newRow = sh.getLastRow();
    return {
      ok: true,
      alreadyExists: false,
      invoiceNo: invoiceNo,
      row: newRow,
      invoice: Object.assign({}, preview, {
        請求書番号: invoiceNo,
        作成日時: now,
        ステータス: '作成済み'
      })
    };
  });
}

// 履歴 1行 → PDF ダウンロード用 base64 を返す
function inv_buildInvoicePdfDownload_(no, email) {
  var me = inv_resolveStaffByEmail_(email);
  var hit = inv_findInvoiceByNo_(no);
  if (!hit) throw new Error('請求書が見つかりません: ' + no);
  if (hit.obj.スタッフ名 !== me.name) throw new Error('権限がありません');
  // スナップショットがあれば優先（作成時点の固定値で出す）
  var snap = hit.obj.スナップショット;
  if (snap && typeof snap === 'object') {
    var invoice = Object.assign({}, snap, {
      請求書番号: hit.obj.請求書番号,
      作成日時: hit.obj.作成日時 || inv_nowISO_()
    });
  } else {
    // フォールバック: 履歴行から再構築
    var invoice = {
      請求書番号: hit.obj.請求書番号,
      請求月: hit.obj.請求月,
      スタッフ名: hit.obj.スタッフ名,
      スタッフメール: hit.obj.スタッフメール,
      プロフィール: {
        屋号: hit.obj.屋号, 本名: hit.obj.本名, 郵便番号: hit.obj.郵便番号, 住所: hit.obj.住所, 電話: hit.obj.電話,
        銀行名: hit.obj.銀行名, 支店名: hit.obj.支店名, 口座種別: hit.obj.口座種別,
        口座番号: hit.obj.口座番号, 口座名義: hit.obj.口座名義,
        インボイス登録番号: hit.obj.インボイス番号
      },
      件数: { 採寸件数: hit.obj.採寸件数, 撮影件数: hit.obj.撮影件数, 出品件数: hit.obj.出品件数, 発送件数: hit.obj.発送件数 },
      単価: { 採寸単価: hit.obj.採寸単価, 撮影単価: hit.obj.撮影単価, 出品単価: hit.obj.出品単価, 発送単価: hit.obj.発送単価 },
      報酬: { 採寸報酬: 0, 撮影報酬: 0, 出品報酬: 0, 発送報酬: 0,
              在庫管理報酬: hit.obj.在庫管理報酬, 固定報酬: hit.obj.固定報酬, 経費合計: hit.obj.経費合計,
              売上報酬: hit.obj.売上報酬, その他報酬: hit.obj.その他報酬 },
      集計: { 税込合計: hit.obj.税込合計, 控除可能率: hit.obj.控除可能率, 調整額: hit.obj.調整額,
              振込元銀行: hit.obj.振込元銀行, 振込手数料: hit.obj.振込手数料, 請求額: hit.obj.請求額 },
      作成日時: hit.obj.作成日時 || inv_nowISO_()
    };
  }
  // 請求先（管理者）の最新設定を取得（スナップショットには含めない、宛先は常に最新）
  var adminRes = inv_getAdminSettings_();
  var adminSettings = (adminRes && adminRes.settings) || null;

  var filename = inv_buildInvoicePdfFilename_(invoice);
  var baseName = filename.replace(/\.pdf$/, '');
  var pdfBlob = inv_buildInvoicePdfBlob_(invoice, adminSettings, baseName);
  var b64 = Utilities.base64Encode(pdfBlob.getBytes());
  return {
    ok: true,
    filename: filename,
    mimeType: 'application/pdf',
    base64: b64
  };
}

// ============================================================
// スタッフ向け 作成・CSV API
// ============================================================

// 請求書作成
//   payload: { ym, force? }
function staff_createInvoice(payload, email) {
  try {
    payload = payload || {};
    var ym = inv_norm_(payload.ym);
    return inv_createInvoice_(inv_currentEmail_(email), ym, { force: !!payload.force });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 請求書PDFダウンロード (base64)
//   payload: { no }
function staff_downloadInvoicePdf(payload, email) {
  try {
    payload = payload || {};
    var no = inv_norm_(payload.no);
    if (!no) throw new Error('請求書番号が空です');
    return inv_buildInvoicePdfDownload_(no, inv_currentEmail_(email));
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ============================================================
// 修正申請 (Phase 6)
// ============================================================

// 修正申請を起票し、対象請求書のステータスを「修正申請中」へ更新
// payload: { no, reason, content? }   content は任意の補足 (例: { 期待請求額: 12345 })
function staff_requestInvoiceRevision(payload, email) {
  try {
    payload = payload || {};
    var no = inv_norm_(payload.no);
    var reason = inv_norm_(payload.reason);
    if (!no) throw new Error('請求書番号が空です');
    if (!reason) throw new Error('申請理由は必須です');
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    if (!me || !me.ok) throw new Error('スタッフ情報が取得できません');

    return inv_withLock_(function(){
      var hist = inv_readAllHistory_();
      var found = null;
      var foundRowIdx = -1; // 0-indexed rows array
      for (var i = 0; i < hist.rows.length; i++) {
        if (String(hist.rows[i][hist.hmap.idx['請求書番号']]) === no) {
          found = inv_historyRowToObject_(hist.rows[i], hist.hmap);
          foundRowIdx = i;
          break;
        }
      }
      if (!found) throw new Error('請求書が見つかりません: ' + no);
      if (found.スタッフ名 !== me.name) throw new Error('権限がありません');
      if (found.ステータス === '取消済み') throw new Error('取消済みの請求書には修正申請できません');
      if (found.ステータス === '支払済み') throw new Error('支払済みの請求書には修正申請できません');
      if (found.ステータス === '修正申請中') throw new Error('既に修正申請中です');

      // 重複防止: 同じ請求書の「申請中」レコードがある場合は弾く
      var ss = inv_getSS_();
      var revSh = ss.getSheetByName(INV_SHEET.REVISION);
      if (!revSh) throw new Error('修正申請シートがありません: ' + INV_SHEET.REVISION);
      var revHmap = inv_buildHeaderMap_(revSh);
      var lastRow = revSh.getLastRow();
      var existingRows = lastRow >= 2 ? revSh.getRange(2, 1, lastRow - 1, revSh.getLastColumn()).getValues() : [];
      for (var r = 0; r < existingRows.length; r++) {
        var rNo = String(existingRows[r][revHmap.idx['請求書番号']]);
        var rStatus = String(existingRows[r][revHmap.idx['ステータス']]);
        if (rNo === no && rStatus === '申請中') {
          throw new Error('既に申請中の修正申請があります');
        }
      }

      var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      var seq = existingRows.length + 1;
      var applyId = 'REV-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss') + '-' + seq;
      var contentJson = '';
      try { contentJson = JSON.stringify(payload.content || {}); } catch(e) { contentJson = '{}'; }

      // 行を組み立て (INV_REVISION_HEADERS の順)
      var width = revSh.getLastColumn();
      var row = new Array(width);
      row[revHmap.idx['申請ID']]         = applyId;
      row[revHmap.idx['請求書番号']]     = no;
      row[revHmap.idx['請求月']]         = found.請求月;
      row[revHmap.idx['スタッフ名']]     = me.name;
      row[revHmap.idx['スタッフメール']] = found.スタッフメール || me.email || '';
      row[revHmap.idx['申請日時']]       = nowStr;
      row[revHmap.idx['申請理由']]       = reason;
      row[revHmap.idx['申請内容JSON']]   = contentJson;
      row[revHmap.idx['対応日時']]       = '';
      row[revHmap.idx['対応者メール']]   = '';
      row[revHmap.idx['ステータス']]     = '申請中';
      row[revHmap.idx['管理者コメント']] = '';
      row[revHmap.idx['再請求書番号']]   = '';
      revSh.appendRow(row);

      // 請求書ステータスを「修正申請中」に更新
      var histSh = hist.sheet;
      var statusCol1 = hist.hmap.idx['ステータス'] + 1;
      var updateCol1 = hist.hmap.idx['更新日時'] + 1;
      var actualRow = foundRowIdx + 2; // header offset
      histSh.getRange(actualRow, statusCol1).setValue('修正申請中');
      if (hist.hmap.idx['更新日時'] >= 0) {
        histSh.getRange(actualRow, updateCol1).setValue(nowStr);
      }

      // 申請レコード
      var revision = {
        申請ID: applyId,
        請求書番号: no,
        請求月: found.請求月,
        スタッフ名: me.name,
        スタッフメール: found.スタッフメール || me.email || '',
        申請日時: nowStr,
        申請理由: reason,
        ステータス: '申請中'
      };

      // メール通知 (管理者宛)
      try {
        inv_mail_revisionRequested_(found, revision);
      } catch (e) {
        console.error('inv_mail_revisionRequested_ 失敗: ' + (e && e.message || e));
      }

      return { ok: true, 申請ID: applyId, 請求書番号: no, ステータス: '申請中' };
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 自分の修正申請履歴
function staff_listMyRevisions(payload, email) {
  try {
    var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
    if (!me || !me.ok) throw new Error('スタッフ情報が取得できません');
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.REVISION);
    if (!sh) return { ok: true, items: [] };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, items: [] };
    var hmap = inv_buildHeaderMap_(sh);
    var rows = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][hmap.idx['スタッフ名']]) !== me.name) continue;
      items.push({
        申請ID:       inv_norm_(rows[i][hmap.idx['申請ID']]),
        請求書番号:   inv_norm_(rows[i][hmap.idx['請求書番号']]),
        請求月:       inv_toYm_(rows[i][hmap.idx['請求月']]),
        申請日時:     inv_toDateTimeStr_(rows[i][hmap.idx['申請日時']]),
        申請理由:     inv_norm_(rows[i][hmap.idx['申請理由']]),
        対応日時:     inv_toDateTimeStr_(rows[i][hmap.idx['対応日時']]),
        ステータス:   inv_norm_(rows[i][hmap.idx['ステータス']]),
        管理者コメント: inv_norm_(rows[i][hmap.idx['管理者コメント']]),
        再請求書番号: inv_norm_(rows[i][hmap.idx['再請求書番号']])
      });
    }
    // 新しい順
    items.sort(function(a, b){
      return String(b.申請日時 || '').localeCompare(String(a.申請日時 || ''));
    });
    return { ok: true, items: items };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ============================================================
// セルフテスト (GAS エディタから手動実行)
// ============================================================

function inv_test_calcSample_() {
  // 適当なスタッフメールでプレビュー（実データ参照）
  var ss = inv_getSS_();
  var sh = ss.getSheetByName('作業者マスター');
  if (!sh) return Logger.log('作業者マスターなし');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return Logger.log('スタッフなし');
  // 有効スタッフの D列メールで試す
  var values = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  for (var r = 0; r < values.length; r++) {
    var enabled = values[r][14];
    var enabledFlag = (enabled === true) || (String(enabled).toLowerCase() === 'true');
    var email = inv_norm_(values[r][3]);
    if (!enabledFlag || !email) continue;
    var ym = inv_prevYm_();
    try {
      var res = inv_calcInvoicePreview_(email, ym);
      Logger.log('TEST email=%s ym=%s 請求額=%s 税込合計=%s 調整額=%s',
        email, ym, res.集計.請求額, res.集計.税込合計, res.集計.調整額);
      Logger.log(JSON.stringify(res, null, 2));
      return res;
    } catch(e) {
      Logger.log('TEST err for %s: %s', email, e && e.message);
    }
  }
}
