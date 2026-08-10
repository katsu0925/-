// ClickPost.gs
// =====================================================
// クリックポスト「まとめ申込」CSVの発行 ＋ 伝票番号の一括取り込み
//
// 【背景】
// クリックポストには API が無く、公式に提供される一括手段は
// 「まとめ申込」の CSV 取込（Shift-JIS / 8列固定 / 1回40件上限 / ヘッダー行改変不可）だけ。
// そのため次の半自動フローで運用する:
//   ① 依頼管理シート → CSV書き出し（このファイル）
//   ② clickpost.jp にアップ → 支払確定 → まとめ印字で印字PDFをDL（作業者の手作業）
//      → 印字PDFと①のCSVを面付けツール（https://clickpost-print.pages.dev/）に入れて
//        A6・4面ラベルに詰め直して印刷。導線は ClickPostDialog.html のタブ②にある
//   ③ マイページCSV → 伝票番号を一括書き戻し（このファイル）
//
// 【注意】
// - CSVは必ず Shift-JIS。UTF-8 だとクリックポスト側で文字化け／取込エラーになる。
// - Driveには保存しない（外注作業者のマイドライブを汚さないため）。
//   base64で返してブラウザ側でダウンロードさせる。
// - 発行済みマーカーには T列（配送業者）を使わない。
//   作業報酬の数式 buildRewardFormula_ が IF(T="","",…) のため、
//   T列を先に埋めると未発送の段階で報酬が計上されてしまう。→ AL列を使う。
// =====================================================

var CLICKPOST_CONFIG = {
  MAX_PER_FILE: 40,          // クリックポストの1回あたりアップロード上限
  CONTENT_PREFIX: '衣類',     // 内容品の固定文言
  CARRIER_LABEL: '日本郵便（クリックポスト）',  // T列に書く配送業者名
  SHIP_STATUS_DONE: '発送済み',
  // Q列(入金確認)で「入金済み」とみなす値。
  // このシステムでは 入金待ち=未入金 / 未対応=入金済み・作業未着手 / 対応済=処理終了 の3値運用で、
  // 入金Webhookが書くのは '未対応'（KOMOJU.gs updateOrderPaymentStatus_）、
  // '対応済' は発送通知メール送信後（発送通知.gs）か入金期限切れキャンセル（PaymentReminder.gs）でしか付かない。
  // '対応済' だけを条件にすると「入金済み・未発送」というラベル発行のど真ん中の行が一件も拾えないため、
  // 未対応 と 対応済 の両方を対象にする（発送済みは別途 S列で除外している）。
  PAYMENT_PAID: ['未対応', '対応済'],
  SHIP_SIZE_LABEL: 'クリックポスト',
  // 幅の上限（半角=1 / 全角=2 で数える）
  NAME_MAX_WIDTH: 40,        // お届け先氏名: 全角20文字／半角40文字
  ADDR_MAX_WIDTH: 40,        // 住所1行あたり: 全角20文字／半角40文字
  CONTENT_MAX_WIDTH: 30,     // 内容品: 全角15文字／半角30文字
  ADDR_LINES: 4,             // 住所は4行まで（D〜G列）
  // まとめ申込テンプレートの1行目。クリックポスト側で厳密に照合されるため改変不可。
  // 万一テンプレートが改訂された場合は、コードを直さずスクリプトプロパティ
  // CLICKPOST_CSV_HEADER にカンマ区切りで実物の1行目を設定すれば差し替えられる。
  DEFAULT_HEADER: [
    'お届け先郵便番号', 'お届け先氏名', 'お届け先敬称',
    'お届け先住所1行目', 'お届け先住所2行目', 'お届け先住所3行目', 'お届け先住所4行目',
    '内容品'
  ]
};

/** 法人と判定する語（含まれていれば敬称を「御中」にする） */
var CP_CORPORATE_WORDS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
  '一般社団', '一般財団', '公益社団', '公益財団',
  '医療法人', '学校法人', '社会福祉法人', '宗教法人', '特定非営利', 'NPO法人',
  '㈱', '㈲', '(株)', '（株）', '(有)', '（有）', '御中'
];

// =====================================================
// エントリポイント
// =====================================================

/** 管理メニューから開くダイアログ */
function showClickPostDialog() {
  var html = HtmlService.createHtmlOutputFromFile('ClickPostDialog')
    .setWidth(1000)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, '📮 クリックポスト ラベル発行');
}

/** 依頼管理シートを取得（AK/AL列の存在も保証される） */
function cp_getRequestSheet_() {
  var ss = sh_getOrderSs_();
  return sh_ensureRequestSheet_(ss);
}

/** まとめ申込CSVのヘッダー行（1行目） */
function cp_csvHeader_() {
  try {
    var override = PropertiesService.getScriptProperties().getProperty('CLICKPOST_CSV_HEADER');
    if (override && override.indexOf(',') !== -1) {
      var arr = override.split(',').map(function(s) { return s.trim(); });
      if (arr.length === 8) return arr;
    }
  } catch (e) { /* プロパティが読めなければ既定値を使う */ }
  return CLICKPOST_CONFIG.DEFAULT_HEADER.slice();
}

// =====================================================
// ① 対象の抽出
// =====================================================

/**
 * クリックポストで発送する注文を抽出し、CSVの8列に変換した状態で返す。
 *
 * 抽出条件（すべて満たす行）:
 *   AG チャネル      = デタウリ
 *   AK 発送サイズ    = クリックポスト（空欄の過去行は K=1点 かつ M=クリポ実費 で救済）
 *   Q  入金確認      = 未対応 または 対応済（＝入金済み。入金待ち／空欄は除外）
 *   S  発送ステータス ≠ 発送済み
 *   V  ステータス    = 依頼中
 *   U  伝票番号      = 空
 *   AL CP発行日時    = 空（opts.includeIssued=true で無視）
 *
 * @param {object} [opts] { includeIssued: boolean } 発行済みも含めるか（再発行モード）
 * @return {object} { ok, rows: [...], header: [...] }
 */
function cp_listTargets(opts) {
  opts = opts || {};
  var includeIssued = !!opts.includeIssued;
  var C = REQUEST_SHEET_COLS;
  var sh = cp_getRequestSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [], header: cp_csvHeader_() };

  var vals = sh.getRange(2, 1, last - 1, C.CP_ISSUED_AT).getValues();
  var rows = [];

  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var receiptNo = String(v[C.RECEIPT_NO - 1] || '').trim();
    if (!receiptNo) continue;
    if (String(v[C.CHANNEL - 1] || '').trim() !== 'デタウリ') continue;
    if (!cp_isClickpostRow_(v)) continue;
    if (CLICKPOST_CONFIG.PAYMENT_PAID.indexOf(String(v[C.PAYMENT - 1] || '').trim()) === -1) continue;
    if (String(v[C.SHIP_STATUS - 1] || '').trim() === CLICKPOST_CONFIG.SHIP_STATUS_DONE) continue;
    if (String(v[C.STATUS - 1] || '').trim() !== APP_CONFIG.statuses.open) continue;
    if (String(v[C.TRACKING - 1] || '').trim() !== '') continue;

    var issuedAt = cp_formatTs_(v[C.CP_ISSUED_AT - 1]);
    if (issuedAt && !includeIssued) continue;

    var conv = cp_convertRow_(receiptNo, v);
    conv.row = i + 2;
    conv.receiptNo = receiptNo;
    conv.issuedAt = issuedAt;
    conv.customer = String(v[C.COMPANY_NAME - 1] || '').trim();
    // P列（決済ID）が空の注文は既存仕様で発送通知メールの対象外。UIで注意喚起する。
    conv.hasPaymentId = String(v[C.PAYMENT_ID - 1] || '').trim() !== '';
    rows.push(conv);
  }

  return { ok: true, rows: rows, header: cp_csvHeader_() };
}

/** 行がクリックポスト対象か（AK列優先、空欄の過去行はフォールバック判定） */
function cp_isClickpostRow_(v) {
  var C = REQUEST_SHEET_COLS;
  var shipSize = String(v[C.SHIP_SIZE - 1] || '').trim();
  if (shipSize) return shipSize === CLICKPOST_CONFIG.SHIP_SIZE_LABEL;
  // AK列が未設定の過去行: 1点 かつ 店負担送料がクリポ実費（改定前/改定後どちらか）
  var count = Number(v[C.TOTAL_COUNT - 1] || 0);
  var storeShip = Number(v[C.SHIP_COST_SHOP - 1] || 0);
  return count === 1 && (
    storeShip === SHIPPING_CONSTANTS.CLICKPOST_COST_BEFORE ||
    storeShip === SHIPPING_CONSTANTS.CLICKPOST_COST_AFTER
  );
}

/** 依頼管理の1行 → CSVの8列に変換（不備は errors に積む） */
function cp_convertRow_(receiptNo, v) {
  var C = REQUEST_SHEET_COLS;
  var errors = [];

  var postalRaw = String(v[C.POSTAL - 1] || '');
  var postal = cp_normalizePostal_(postalRaw);
  if (!postal) errors.push('郵便番号が7桁で読み取れません（' + postalRaw + '）');

  var rawName = String(v[C.COMPANY_NAME - 1] || '').trim();
  var name = cp_stripHonorific_(rawName);
  if (!name) {
    errors.push('お届け先氏名が空です');
  } else if (cp_countWidth_(name) > CLICKPOST_CONFIG.NAME_MAX_WIDTH) {
    errors.push('お届け先氏名が長すぎます（全角20文字まで）');
  }

  var addrRaw = String(v[C.ADDRESS - 1] || '').trim();
  var split = cp_splitAddress_(addrRaw);
  if (!addrRaw) {
    errors.push('住所が空です');
  } else if (split.overflow) {
    errors.push('住所が4行（全角20文字×4）に収まりません');
  }

  var content = cp_buildContent_(receiptNo);
  if (cp_countWidth_(content) > CLICKPOST_CONFIG.CONTENT_MAX_WIDTH) {
    errors.push('内容品が長すぎます（全角15文字まで）');
  }

  var fields = [postal, name, cp_honorific_(rawName), split.lines[0], split.lines[1], split.lines[2], split.lines[3], content];
  var ngChars = cp_findUnconvertibleChars_(fields.join(''));
  if (ngChars.length) {
    errors.push('Shift-JISに変換できない文字が含まれています（' + ngChars.join('') + '）');
  }

  return {
    postal: postal,
    name: name,
    honorific: cp_honorific_(rawName),
    addr: split.lines,
    content: content,
    errors: errors
  };
}

// =====================================================
// ② CSV生成
// =====================================================

/**
 * 選択された受付番号のCSVを生成する（40件ごとに自動分割）。
 * Driveには保存せず base64 で返し、ブラウザ側でダウンロードさせる。
 *
 * @param {string[]} receiptNos 対象の受付番号
 * @return {object} { ok, files:[{name, base64, count}], issued, skipped:[...] }
 */
function cp_buildCsv(receiptNos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, message: '別の処理が実行中です。少し待ってからもう一度お試しください。' };
  }
  try {
    var wanted = {};
    (receiptNos || []).forEach(function(r) { wanted[String(r).trim()] = true; });

    // 再発行にも対応するため発行済みも含めて取得し、選択されたものだけに絞る
    var all = cp_listTargets({ includeIssued: true }).rows;
    var picked = all.filter(function(r) { return wanted[r.receiptNo]; });
    if (!picked.length) {
      return { ok: false, message: '対象の注文が見つかりませんでした。一覧を再読み込みしてください。' };
    }

    var skipped = [];
    var rows = picked.filter(function(r) {
      if (r.errors && r.errors.length) {
        skipped.push({ receiptNo: r.receiptNo, reason: r.errors.join(' / ') });
        return false;
      }
      return true;
    });
    if (!rows.length) {
      return { ok: false, message: '不備のある注文しか選ばれていないため、CSVを作れませんでした。', skipped: skipped };
    }

    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');
    var files = [];
    for (var i = 0; i < rows.length; i += CLICKPOST_CONFIG.MAX_PER_FILE) {
      var chunk = rows.slice(i, i + CLICKPOST_CONFIG.MAX_PER_FILE);
      var text = cp_toCsvText_(chunk);
      var blob = Utilities.newBlob('').setDataFromString(text, 'Shift_JIS');
      files.push({
        name: 'clickpost_' + stamp + '_' + (files.length + 1) + '.csv',
        base64: Utilities.base64Encode(blob.getBytes()),
        count: chunk.length
      });
    }

    // AL列に発行日時を記録（二重発行の防止マーカー）
    var sh = cp_getRequestSheet_();
    var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    rows.forEach(function(r) {
      sh.getRange(r.row, REQUEST_SHEET_COLS.CP_ISSUED_AT).setValue(nowStr);
    });
    SpreadsheetApp.flush();

    return { ok: true, files: files, issued: rows.length, skipped: skipped };
  } catch (e) {
    Logger.log('cp_buildCsv error: ' + e);
    return { ok: false, message: 'CSVの作成に失敗しました: ' + e };
  } finally {
    lock.releaseLock();
  }
}

/** CSVテキストを組み立てる（1行目は公式テンプレートのヘッダー） */
function cp_toCsvText_(rows) {
  var out = [cp_csvHeader_().map(cp_csvEscape_).join(',')];
  rows.forEach(function(r) {
    out.push([
      r.postal, r.name, r.honorific,
      r.addr[0], r.addr[1], r.addr[2], r.addr[3],
      r.content
    ].map(cp_csvEscape_).join(','));
  });
  return out.join('\r\n') + '\r\n';
}

function cp_csvEscape_(v) {
  var s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// =====================================================
// ③ 伝票番号の一括書き戻し
// =====================================================

/**
 * クリックポストのマイページからダウンロードしたCSVを取り込み、
 * 伝票番号（お問い合わせ番号）を依頼管理シートへ一括で書き戻す。
 *
 * 照合キー: 郵便番号（数字のみ）＋ 内容品に付けた受付番号の下3桁
 *           内容品が無いCSVの場合は 郵便番号＋お届け先氏名 で照合する
 *
 * @param {string} csvText マイページCSVの中身（呼び出し側でUTF-8にデコード済み）
 * @return {object} { ok, updated:[...], unmatched:[...], mailSkipped:[...], message }
 */
function cp_importTracking(csvText) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, message: '別の処理が実行中です。少し待ってからもう一度お試しください。' };
  }
  try {
    var table = cp_parseCsv_(csvText);
    if (!table.length) return { ok: false, message: 'CSVを読み取れませんでした。ファイルの中身をご確認ください。' };

    var idx = cp_resolveImportColumns_(table[0]);
    if (idx.tracking < 0) {
      return { ok: false, message: 'CSVに「お問い合わせ番号」の列が見つかりませんでした。クリックポストのマイページからダウンロードしたCSVをそのままお使いください。' };
    }
    if (idx.postal < 0) {
      return { ok: false, message: 'CSVに「郵便番号」の列が見つかりませんでした。' };
    }

    // 書き戻し候補（発行済みも含める）
    var targets = cp_listTargets({ includeIssued: true }).rows;
    var byContent = {}, byName = {};
    targets.forEach(function(r) {
      var pc = cp_postalDigits_(r.postal);
      var k1 = pc + '|' + cp_contentKey_(r.content);
      var k2 = pc + '|' + cp_normalizeName_(r.name);
      (byContent[k1] = byContent[k1] || []).push(r);
      (byName[k2] = byName[k2] || []).push(r);
    });

    var sh = cp_getRequestSheet_();
    var updated = [], unmatched = [], mailSkipped = [];

    for (var i = 1; i < table.length; i++) {
      var rec = table[i];
      if (!rec || !rec.join('').trim()) continue;

      var trackingNo = String(rec[idx.tracking] || '').replace(/[^0-9]/g, '');
      var postalDigits = cp_postalDigits_(rec[idx.postal]);
      var contentKey = idx.content >= 0 ? cp_contentKey_(rec[idx.content]) : '';
      var csvName = idx.name >= 0 ? cp_normalizeName_(cp_stripHonorific_(rec[idx.name])) : '';
      var label = (postalDigits || '?') + ' ' + (idx.name >= 0 ? String(rec[idx.name] || '') : '');

      if (trackingNo.length < 10) {
        unmatched.push({ label: label, tracking: String(rec[idx.tracking] || ''), reason: 'お問い合わせ番号が読み取れません（発送前の行の可能性があります）' });
        continue;
      }

      var cands = [];
      if (contentKey) cands = byContent[postalDigits + '|' + contentKey] || [];
      if (!cands.length && csvName) cands = byName[postalDigits + '|' + csvName] || [];

      if (!cands.length) {
        unmatched.push({ label: label, tracking: trackingNo, reason: '依頼管理シートに一致する注文が見つかりません（すでに取り込み済みの可能性があります）' });
        continue;
      }
      if (cands.length > 1) {
        unmatched.push({ label: label, tracking: trackingNo, reason: '候補が複数あるため自動で決められません（手動でご入力ください）' });
        continue;
      }

      var t = cands[0];
      var trackingUrl = buildTrackingUrl_(CLICKPOST_CONFIG.CARRIER_LABEL, trackingNo);

      // T列（配送業者）とU列（伝票番号）は隣接しているのでまとめて書き込む
      sh.getRange(t.row, REQUEST_SHEET_COLS.CARRIER, 1, 2).setValues([[CLICKPOST_CONFIG.CARRIER_LABEL, trackingNo]]);
      if (trackingUrl) sh.getRange(t.row, REQUEST_SHEET_COLS.TRACKING_URL).setValue(trackingUrl);
      sh.getRange(t.row, REQUEST_SHEET_COLS.SHIP_STATUS).setValue(CLICKPOST_CONFIG.SHIP_STATUS_DONE);
      SpreadsheetApp.flush();

      // プログラムからの書き込みでは onEdit が発火しないため、発送通知を明示的に呼び出す。
      // 二重送信は AC列（発送通知フラグ）が防ぐ。
      var mailed = cp_fireShipMail_(sh, t.row);
      if (!mailed) mailSkipped.push({ receiptNo: t.receiptNo, reason: '決済IDが無い注文のため発送通知メールは送られません' });

      updated.push({ receiptNo: t.receiptNo, customer: t.customer, tracking: trackingNo, row: t.row });

      // 取り込み済みの行は以降の候補から外す（同じ番号を2行に書かないため）
      cp_removeFromIndex_(byContent, cp_postalDigits_(t.postal) + '|' + cp_contentKey_(t.content), t);
      cp_removeFromIndex_(byName, cp_postalDigits_(t.postal) + '|' + cp_normalizeName_(t.name), t);
    }

    return {
      ok: true,
      updated: updated,
      unmatched: unmatched,
      mailSkipped: mailSkipped,
      message: updated.length + '件の伝票番号を取り込みました。'
    };
  } catch (e) {
    Logger.log('cp_importTracking error: ' + e);
    return { ok: false, message: '取り込みに失敗しました: ' + e };
  } finally {
    lock.releaseLock();
  }
}

/** 発送通知を明示的に発火する。P列（決済ID）が空の行は既存仕様で送信対象外＝false を返す */
function cp_fireShipMail_(sh, rowNum) {
  try {
    var paymentId = String(sh.getRange(rowNum, REQUEST_SHEET_COLS.PAYMENT_ID).getValue() || '').trim();
    if (!paymentId) return false;
    var rng = sh.getRange(rowNum, REQUEST_SHEET_COLS.SHIP_STATUS, 1, 1);
    shipMailOnEdit({ range: rng, value: CLICKPOST_CONFIG.SHIP_STATUS_DONE });
    return true;
  } catch (e) {
    Logger.log('cp_fireShipMail_ error (row ' + rowNum + '): ' + e);
    return false;
  }
}

function cp_removeFromIndex_(index, key, target) {
  var arr = index[key];
  if (!arr) return;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === target) { arr.splice(i, 1); return; }
  }
}

/** マイページCSVのヘッダーから必要な列位置を解決する（列順の変更に耐えるため名前で探す） */
function cp_resolveImportColumns_(headerRow) {
  var res = { tracking: -1, postal: -1, name: -1, content: -1 };
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').replace(/[\s　"]/g, '');
    if (res.tracking < 0 && (h.indexOf('お問い合わせ番号') !== -1 || h.indexOf('お問合せ番号') !== -1 || h.indexOf('問い合わせ番号') !== -1 || h.indexOf('追跡番号') !== -1)) res.tracking = i;
    else if (res.postal < 0 && h.indexOf('郵便番号') !== -1) res.postal = i;
    else if (res.name < 0 && (h.indexOf('氏名') !== -1 || h.indexOf('お届け先名') !== -1)) res.name = i;
    else if (res.content < 0 && h.indexOf('内容品') !== -1) res.content = i;
  }
  return res;
}

// =====================================================
// 変換ヘルパー
// =====================================================

/** 郵便番号を 123-4567 形式に正規化（7桁で読めなければ空文字） */
function cp_normalizePostal_(s) {
  var d = cp_toHalfWidth_(String(s || '')).replace(/[^0-9]/g, '');
  if (d.length !== 7) return '';
  return d.slice(0, 3) + '-' + d.slice(3);
}

/** 郵便番号を数字だけにする（照合キー用） */
function cp_postalDigits_(s) {
  return cp_toHalfWidth_(String(s || '')).replace(/[^0-9]/g, '');
}

/** 全角英数字・全角記号を半角に寄せる */
function cp_toHalfWidth_(s) {
  return String(s || '')
    .replace(/[！-～]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/　/g, ' ');
}

/** 敬称（様/御中）を決める。法人語を含めば御中 */
function cp_honorific_(name) {
  var s = String(name || '');
  for (var i = 0; i < CP_CORPORATE_WORDS.length; i++) {
    if (s.indexOf(CP_CORPORATE_WORDS[i]) !== -1) return '御中';
  }
  return '様';
}

/** 末尾の敬称を取り除く（CSVのB列は敬称を含めない仕様のため） */
function cp_stripHonorific_(name) {
  return String(name || '').trim().replace(/[\s　]*(様|さま|サマ|御中|殿)$/, '').trim();
}

/** 氏名の照合キー（空白除去） */
function cp_normalizeName_(name) {
  return String(name || '').replace(/[\s　]/g, '');
}

/** 半角=1 / 全角=2 で文字幅を数える */
function cp_countWidth_(s) {
  var str = String(s || '');
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    // ASCII・半角カナ・半角記号は1、それ以外は2
    if (c <= 0x7E || c === 0xA5 || c === 0x203E || (c >= 0xFF61 && c <= 0xFF9F)) n += 1;
    else n += 2;
  }
  return n;
}

/** 改行・連続空白をひとつの半角スペースにまとめる */
function cp_normalizeSpace_(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[ 　]{2,}/g, ' ').trim();
}

/**
 * 住所を D〜G列（4行 × 全角20文字）へ分割する。
 * 読みやすさを優先して都道府県を1行目に切り出すが、
 * それだと4行に収まらない住所は「詰めて分割」に切り替える（容量優先）。
 *
 * @return {object} { lines: [4], overflow: boolean }
 */
function cp_splitAddress_(addrRaw) {
  var W = CLICKPOST_CONFIG.ADDR_MAX_WIDTH;
  var MAX = CLICKPOST_CONFIG.ADDR_LINES;
  var addr = cp_normalizeSpace_(addrRaw);
  if (!addr) return { lines: ['', '', '', ''], overflow: false };

  var lines = null;
  var pref = (typeof detectPrefecture_ === 'function') ? detectPrefecture_(addr) : null;
  if (pref && addr.indexOf(pref) === 0 && cp_countWidth_(pref) <= W) {
    var rest = addr.slice(pref.length).replace(/^[\s　]+/, '');
    var chunked = cp_chunkByWidth_(rest, W, MAX - 1);
    if (!chunked.overflow) lines = [pref].concat(chunked.lines);
  }

  if (!lines) {
    var all = cp_chunkByWidth_(addr, W, MAX);
    lines = all.lines;
    while (lines.length < MAX) lines.push('');
    if (all.overflow) return { lines: lines.slice(0, MAX), overflow: true };
  }

  while (lines.length < MAX) lines.push('');
  return { lines: lines.slice(0, MAX), overflow: false };
}

/**
 * 文字列を指定幅で最大 maxLines 行に折り返す。空白があればそこで折り返す。
 * @return {object} { lines: [...], overflow: boolean } overflow=収まりきらなかった
 */
function cp_chunkByWidth_(text, width, maxLines) {
  var s = String(text || '');
  var lines = [];
  while (s.length > 0 && lines.length < maxLines) {
    if (cp_countWidth_(s) <= width) { lines.push(s); s = ''; break; }
    // width に収まる最大の文字数を求める
    var n = 0, w = 0;
    while (n < s.length) {
      var cw = cp_countWidth_(s.charAt(n));
      if (w + cw > width) break;
      w += cw; n++;
    }
    if (n <= 0) n = 1;  // 保険（1文字も入らないことは無いはず）
    // 区切りの良い位置（空白）が後半にあればそこで折り返す
    var cut = n;
    var sp = Math.max(s.lastIndexOf(' ', n), s.lastIndexOf('　', n));
    if (sp > Math.floor(n / 2)) cut = sp;
    lines.push(s.slice(0, cut).replace(/[\s　]+$/, ''));
    s = s.slice(cut).replace(/^[\s　]+/, '');
  }
  return { lines: lines, overflow: s.length > 0 };
}

/**
 * 内容品を作る。受付番号の下3桁を付けて、③の書き戻し照合キーにする。
 * 例: 受付番号 20260725193720-538 → 「衣類 538」
 */
function cp_buildContent_(receiptNo) {
  var s = String(receiptNo || '').trim();
  var m = s.match(/-(\d{1,4})$/);
  var suffix = m ? m[1] : s.replace(/[^0-9]/g, '').slice(-3);
  return suffix ? (CLICKPOST_CONFIG.CONTENT_PREFIX + ' ' + suffix) : CLICKPOST_CONFIG.CONTENT_PREFIX;
}

/** 内容品から照合用の番号を取り出す（「衣類 538」→「538」） */
function cp_contentKey_(content) {
  var m = String(content || '').match(/(\d{1,4})\s*$/);
  return m ? m[1] : '';
}

/** タイムスタンプを表示用文字列にする */
function cp_formatTs_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  }
  return String(v).trim();
}

/**
 * Shift-JISに変換できない文字を洗い出す（髙・﨑・①・絵文字など）。
 * 変換すると「?」に化けて宛先が壊れるため、CSVに含める前に弾く。
 */
function cp_findUnconvertibleChars_(text) {
  var s = String(text || '');
  if (!s) return [];
  var blob = Utilities.newBlob('').setDataFromString(s, 'Shift_JIS');
  var back = blob.getDataAsString('Shift_JIS');
  if (back === s) return [];
  var bad = [], seen = {};
  var len = Math.min(s.length, back.length);
  for (var i = 0; i < len; i++) {
    if (s.charAt(i) !== back.charAt(i) && !seen[s.charAt(i)]) {
      seen[s.charAt(i)] = true;
      bad.push(s.charAt(i));
    }
  }
  // 文字数がずれた場合（サロゲートペア等）は先頭の差分だけ返す
  if (!bad.length) bad.push('？');
  return bad;
}

// =====================================================
// CSVパーサ（引用符・改行込みに対応）
// =====================================================

function cp_parseCsv_(text) {
  var s = String(text || '').replace(/^﻿/, '');
  var rows = [], row = [], field = '', inQuotes = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function(r) { return r.join('').trim() !== ''; });
}

// =====================================================
// 入金完了のLINE通知
// =====================================================

/**
 * クリックポスト対象の注文で入金が確認できたとき、業務用LINEグループへ知らせる。
 * 宛先は朝の業務サマリー・受注通知と同じ（スクリプトプロパティ LINE_TO_ID）。
 *
 * 呼び出し元:
 *   - SubmitFix.gs writeSubmitData_          … クレカ等、注文と同時に入金が済む注文
 *   - KOMOJU.gs   updateOrderPaymentStatus_  … コンビニ／銀行振込など、あとから入金される注文
 *
 * 入金Webhookと5分Cron（checkAwaitingPayments）が同じ入金を拾うことがあるため、
 * CacheServiceのマーカーで二重送信を抑止する。
 *
 * @param {string} receiptNo 受付番号
 */
function cp_notifyPaidToLine_(receiptNo) {
  try {
    receiptNo = String(receiptNo || '').trim();
    if (!receiptNo) return;

    var cache = CacheService.getScriptCache();
    var cacheKey = 'cp_paid_line_' + receiptNo;
    if (cache.get(cacheKey)) return;  // 直近6時間に送信済み

    var C = REQUEST_SHEET_COLS;
    var sh = cp_getRequestSheet_();
    var last = sh.getLastRow();
    if (last < 2) return;

    var keys = sh.getRange(2, C.RECEIPT_NO, last - 1, 1).getValues();
    var row = 0;
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || '').trim() === receiptNo) { row = i + 2; break; }
    }
    if (!row) return;

    // 実際のシートの値で最終確認（クリックポスト対象か・本当に入金済みか）
    var v = sh.getRange(row, 1, 1, C.CP_ISSUED_AT).getValues()[0];
    if (String(v[C.CHANNEL - 1] || '').trim() !== 'デタウリ') return;
    if (!cp_isClickpostRow_(v)) return;
    if (CLICKPOST_CONFIG.PAYMENT_PAID.indexOf(String(v[C.PAYMENT - 1] || '').trim()) === -1) return;

    var message = '📮 クリックポスト｜入金完了\n'
      + '受付番号: ' + receiptNo + '\n'
      + 'ラベル発行の対象になりました。\n'
      + '依頼管理の「管理メニュー → 📮 クリックポスト ラベル発行」から進めてください。';

    if (line_pushToGroup_(message, receiptNo)) {
      cache.put(cacheKey, '1', 21600);  // 6時間
    }
  } catch (e) {
    console.error('cp_notifyPaidToLine_ error (' + receiptNo + '):', e);
  }
}

// =====================================================
// 運用ユーティリティ
// =====================================================

/**
 * 過去行のバックフィル（GASエディタから1回だけ手動実行）。
 * AK列（発送サイズ）が空で、クリックポスト条件に合う行に「クリックポスト」を入れる。
 * 副次効果として作業報酬（AE列）も自動で50円になる。
 */
function cp_backfillShipSize() {
  var C = REQUEST_SHEET_COLS;
  var sh = cp_getRequestSheet_();
  var last = sh.getLastRow();
  if (last < 2) return '対象行がありません';

  var vals = sh.getRange(2, 1, last - 1, C.SHIP_SIZE).getValues();
  var updated = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (!String(v[C.RECEIPT_NO - 1] || '').trim()) continue;
    if (String(v[C.CHANNEL - 1] || '').trim() !== 'デタウリ') continue;
    if (String(v[C.SHIP_SIZE - 1] || '').trim()) continue;  // 既に入っている行は触らない
    var count = Number(v[C.TOTAL_COUNT - 1] || 0);
    var storeShip = Number(v[C.SHIP_COST_SHOP - 1] || 0);
    if (count !== 1) continue;
    if (storeShip !== SHIPPING_CONSTANTS.CLICKPOST_COST_BEFORE &&
        storeShip !== SHIPPING_CONSTANTS.CLICKPOST_COST_AFTER) continue;
    sh.getRange(i + 2, C.SHIP_SIZE).setValue(CLICKPOST_CONFIG.SHIP_SIZE_LABEL);
    updated++;
  }
  SpreadsheetApp.flush();
  var msg = 'AK列（発送サイズ）に「クリックポスト」を ' + updated + ' 行セットしました';
  Logger.log(msg);
  return msg;
}
