// KitXlsxAudit.gs
// ═══════════════════════════════════════════════════════════════════════════
// 配布用リストXLSX（Drive）の棚卸しと公開リンクの停止。
//
// なぜ要るか:
//   om_exportDistributionXlsx_fast_() が作るXLSXは
//     - ファイル名に顧客の氏名が入る（「〇〇様_受付番号.xlsx」）
//     - DriveApp.Access.ANYONE_WITH_LINK で共有される＝リンクを知れば誰でも閲覧できる
//     - TTLが無く、受付番号ごとに増え続ける
//   さらに docs/WITHDRAWAL_SOP.md の削除対象にこのファイルが入っていない。
//   出品キット（+CSV）へ移行するにあたり、まず公開リンクを閉じる。
//
// 使い方（GASエディタから実行）:
//   1. auditKitXlsxFolder()            … 読み取りのみ。棚卸し結果をログに出す
//   2. previewRevokeKitXlsxSharing()   … 90日より古いファイルの共有解除を下見
//   3. revokeKitXlsxSharing(90, true)  … 実行（共有解除のみ。ファイルは消さない）
//
// 消さずに「共有解除」だけにしてあるのは、問い合わせが来たときに戻せるようにするため。
// 削除はしばらく様子を見てから、別途手で行う。
// ═══════════════════════════════════════════════════════════════════════════

var KITAUDIT_RECENT_DAYS = 90;   // これより新しい受注は「まだ使っている可能性がある」扱い

/**
 * ファイル名から受付番号を取り出す。「〇〇様_20260825022505-950.xlsx」→「20260825022505-950」
 * 受付番号を持たない旧形式（「秋山 純様.xlsx」）や、決済IDらしき16進の付いたものは空を返す。
 */
function kitaudit_parseReceiptNo_(fileName) {
  var base = String(fileName || '').replace(/\.xlsx$/i, '').replace(/ のコピー$/, '');
  var i = base.lastIndexOf('_');
  if (i < 0) return '';
  var tail = base.slice(i + 1).trim();
  return /^\d{14}-\d+$/.test(tail) ? tail : '';
}

/** 依頼管理シートを 受付番号 → {customer, confirmLink, kitUrl} のマップにする */
function kitaudit_loadRequestMap_() {
  var sh = sh_getOrderSs_().getSheetByName('依頼管理');
  if (!sh) throw new Error('依頼管理シートが見つかりません');
  var last = sh.getLastRow();
  if (last < 2) return {};
  var maxCol = Math.max(SHIPMAIL_CONFIG.COL_KIT_URL, SHIPMAIL_CONFIG.COL_CONFIRM_LINK_I);
  var vals = sh.getRange(2, 1, last - 1, maxCol).getValues();
  var map = {};
  for (var i = 0; i < vals.length; i++) {
    var rn = String(vals[i][SHIPMAIL_CONFIG.COL_RECEIPT_NO - 1] || '').trim();
    if (!rn) continue;
    map[rn] = {
      customer: String(vals[i][SHIPMAIL_CONFIG.COL_CUSTOMER_C - 1] || '').trim(),
      confirmLink: String(vals[i][SHIPMAIL_CONFIG.COL_CONFIRM_LINK_I - 1] || '').trim(),
      kitUrl: String(vals[i][SHIPMAIL_CONFIG.COL_KIT_URL - 1] || '').trim()
    };
  }
  return map;
}

/** フォルダ内の全XLSXを読み、判断に要る情報だけ集めて返す（書き込みは一切しない） */
function kitaudit_scan_() {
  if (!OM_XLSX_FOLDER_ID) throw new Error('OM_XLSX_FOLDER_ID が未設定です');
  var folder = DriveApp.getFolderById(OM_XLSX_FOLDER_ID);
  var reqMap = kitaudit_loadRequestMap_();
  var now = Date.now();
  var files = folder.getFiles();
  var rows = [];

  while (files.hasNext()) {
    var f = files.next();
    var created = f.getDateCreated();
    var receiptNo = kitaudit_parseReceiptNo_(f.getName());
    var req = receiptNo ? reqMap[receiptNo] : null;
    var access = '';
    try { access = String(f.getSharingAccess()); } catch (e) { access = '(取得失敗)'; }
    rows.push({
      id: f.getId(),
      name: f.getName(),
      created: created,
      ageDays: Math.floor((now - created.getTime()) / 86400000),
      receiptNo: receiptNo,
      isPublic: access === String(DriveApp.Access.ANYONE_WITH_LINK) || access === String(DriveApp.Access.ANYONE),
      access: access,
      hasKit: !!(req && req.kitUrl),
      inSheet: !!req
    });
  }

  rows.sort(function(a, b) { return b.created.getTime() - a.created.getTime(); });
  return rows;
}

/**
 * 【手動実行】棚卸し。読み取りのみで何も変更しない。
 * ログに「全件の一覧」と「対応が要るものの要約」を出す。
 */
function auditKitXlsxFolder() {
  var rows = kitaudit_scan_();
  var tz = Session.getScriptTimeZone();

  // 同じ受付番号に複数ファイル＝再生成時の削除漏れ
  var byReceipt = {};
  rows.forEach(function(r) {
    if (!r.receiptNo) return;
    (byReceipt[r.receiptNo] = byReceipt[r.receiptNo] || []).push(r);
  });
  var dupReceipts = Object.keys(byReceipt).filter(function(k) { return byReceipt[k].length > 1; });

  var recent = rows.filter(function(r) { return r.ageDays <= KITAUDIT_RECENT_DAYS; });
  var old_   = rows.filter(function(r) { return r.ageDays >  KITAUDIT_RECENT_DAYS; });
  var pub    = rows.filter(function(r) { return r.isPublic; });
  var noKit  = rows.filter(function(r) { return r.receiptNo && !r.hasKit; });
  var noRow  = rows.filter(function(r) { return !r.receiptNo || !r.inSheet; });

  console.log('━━━ 配布用リストXLSX 棚卸し ━━━');
  console.log('フォルダ: %s', OM_XLSX_FOLDER_ID);
  console.log('総ファイル数: %s（うち公開リンク: %s）', rows.length, pub.length);
  console.log('%s日以内: %s件 / それ以前: %s件', KITAUDIT_RECENT_DAYS, recent.length, old_.length);
  console.log('受付番号が重複しているファイル群: %s件 → %s', dupReceipts.length, dupReceipts.join(', ') || 'なし');
  console.log('依頼管理に行が無い/受付番号を読めない: %s件', noRow.length);
  console.log('出品キットURLが未発行の受注: %s件', noKit.length);

  console.log('\n── %s日以内（案内してから閉じる対象）──', KITAUDIT_RECENT_DAYS);
  recent.forEach(function(r) {
    console.log('  %s | %s日前 | キット:%s | 公開:%s | %s',
      Utilities.formatDate(r.created, tz, 'yyyy-MM-dd'), r.ageDays,
      r.hasKit ? 'あり' : 'なし', r.isPublic ? 'YES' : 'no', r.name);
  });

  console.log('\n── それ以前（即 共有解除の候補）──');
  old_.forEach(function(r) {
    console.log('  %s | %s日前 | キット:%s | 公開:%s | %s',
      Utilities.formatDate(r.created, tz, 'yyyy-MM-dd'), r.ageDays,
      r.hasKit ? 'あり' : 'なし', r.isPublic ? 'YES' : 'no', r.name);
  });

  if (dupReceipts.length) {
    console.log('\n── 重複（新しい1件を残して整理してよい）──');
    dupReceipts.forEach(function(rn) {
      console.log('  受付番号 %s:', rn);
      byReceipt[rn].forEach(function(r, i) {
        console.log('    %s %s (%s) id=%s', i === 0 ? '[残す]' : '[重複]',
          r.name, Utilities.formatDate(r.created, tz, 'yyyy-MM-dd'), r.id);
      });
    });
  }

  if (noKit.length) {
    console.log('\n── 出品キットが未発行（先にキットを作る対象）──');
    noKit.forEach(function(r) { console.log('  %s | %s', r.receiptNo, r.name); });
  }

  return { total: rows.length, publicCount: pub.length, recent: recent.length, old: old_.length };
}

/**
 * 指定日数より古いXLSXの公開リンクを閉じる。ファイルは削除しない。
 * @param {number} olderThanDays 何日より古いものを対象にするか（既定 90）
 * @param {boolean} execute true のときだけ実際に変更する。既定は下見のみ
 */
function revokeKitXlsxSharing(olderThanDays, execute) {
  var cutoff = (typeof olderThanDays === 'number' && olderThanDays >= 0) ? olderThanDays : KITAUDIT_RECENT_DAYS;
  var dryRun = (execute !== true);
  var rows = kitaudit_scan_();
  var tz = Session.getScriptTimeZone();

  var targets = rows.filter(function(r) { return r.ageDays > cutoff && r.isPublic; });

  console.log('%s %s日より古い公開ファイル: %s件（全%s件中）',
    dryRun ? '【下見】' : '【実行】', cutoff, targets.length, rows.length);

  var done = 0, failed = 0;
  targets.forEach(function(r) {
    if (dryRun) {
      console.log('  [下見] 共有解除する: %s (%s / %s日前)',
        r.name, Utilities.formatDate(r.created, tz, 'yyyy-MM-dd'), r.ageDays);
      return;
    }
    try {
      DriveApp.getFileById(r.id).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      done++;
      console.log('  [完了] %s', r.name);
    } catch (e) {
      failed++;
      console.error('  [失敗] %s — %s', r.name, e);
    }
  });

  if (dryRun) {
    console.log('変更していません。実行するには revokeKitXlsxSharing(%s, true) を呼んでください。', cutoff);
  } else {
    console.log('共有解除 %s件 / 失敗 %s件。ファイルは削除していません。', done, failed);
  }
  return { targets: targets.length, done: done, failed: failed, dryRun: dryRun };
}

/** 【手動実行】既定値（90日）での下見。エディタの実行メニューから選べるようにするためのラッパー */
function previewRevokeKitXlsxSharing() {
  return revokeKitXlsxSharing(KITAUDIT_RECENT_DAYS, false);
}
