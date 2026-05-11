// AdminInvoiceApi.gs — 請求書機能の管理者向けAPI
// 認証: 全API冒頭で inv_resolveStaffByEmail_ → isAdmin チェック
//
// 提供API:
//   adminInv_currentUser          管理者本人情報
//   adminInv_listAllInvoices      全請求書一覧
//   adminInv_getInvoiceDetail     1件詳細
//   adminInv_listAllRevisions     全修正申請一覧
//   adminInv_respondRevision      修正申請への対応（承認/却下/差戻し）
//   adminInv_updateInvoiceStatus  請求書ステータス手動更新（支払済み/取消済み等）
//   adminInv_listGraceRates       経過措置率一覧
//   adminInv_saveGraceRates       経過措置率保存
//   adminInv_getAdminSettings     管理者設定取得
//   adminInv_saveAdminSettings    管理者設定保存

function adminInv_assertAdmin_(email) {
  var me = inv_resolveStaffByEmail_(inv_currentEmail_(email));
  if (!me || !me.ok) throw new Error('スタッフ情報が取得できません');
  if (!me.isAdmin) throw new Error('管理者権限がありません');
  return me;
}

function adminInv_currentUser(email) {
  try {
    var me = adminInv_assertAdmin_(email);
    return { ok: true, email: me.email, name: me.name, isAdmin: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function adminInv_listAllInvoices(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    payload = payload || {};
    var statusFilter = inv_norm_(payload.status); // 任意フィルタ
    var ymFilter = inv_norm_(payload.ym);
    var hist = inv_readAllHistory_();
    var items = [];
    for (var i = 0; i < hist.rows.length; i++) {
      var obj = inv_historyRowToObject_(hist.rows[i], hist.hmap);
      if (statusFilter && obj.ステータス !== statusFilter) continue;
      if (ymFilter && obj.請求月 !== ymFilter) continue;
      items.push(obj);
    }
    items.sort(function(a, b){
      return String(b.作成日時 || '').localeCompare(String(a.作成日時 || ''));
    });
    return { ok: true, items: items, total: items.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function adminInv_getInvoiceDetail(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    payload = payload || {};
    var no = inv_norm_(payload.no);
    if (!no) throw new Error('請求書番号が空です');
    var inv = inv_findInvoiceByNo_(no);
    if (!inv) throw new Error('請求書が見つかりません: ' + no);
    return { ok: true, invoice: inv };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function adminInv_listAllRevisions(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    payload = payload || {};
    var statusFilter = inv_norm_(payload.status);
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.REVISION);
    if (!sh) return { ok: true, items: [] };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, items: [] };
    var hmap = inv_buildHeaderMap_(sh);
    var rows = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var obj = {
        申請ID:         rows[i][hmap.idx['申請ID']],
        請求書番号:     rows[i][hmap.idx['請求書番号']],
        請求月:         rows[i][hmap.idx['請求月']],
        スタッフ名:     rows[i][hmap.idx['スタッフ名']],
        スタッフメール: rows[i][hmap.idx['スタッフメール']],
        申請日時:       rows[i][hmap.idx['申請日時']],
        申請理由:       rows[i][hmap.idx['申請理由']],
        申請内容JSON:   rows[i][hmap.idx['申請内容JSON']],
        対応日時:       rows[i][hmap.idx['対応日時']],
        対応者メール:   rows[i][hmap.idx['対応者メール']],
        ステータス:     rows[i][hmap.idx['ステータス']],
        管理者コメント: rows[i][hmap.idx['管理者コメント']],
        再請求書番号:   rows[i][hmap.idx['再請求書番号']],
        _sheetRow:      i + 2
      };
      if (statusFilter && obj.ステータス !== statusFilter) continue;
      items.push(obj);
    }
    items.sort(function(a, b){
      return String(b.申請日時 || '').localeCompare(String(a.申請日時 || ''));
    });
    return { ok: true, items: items };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 修正申請への対応
// payload: { applyId, action: '承認済み'|'却下'|'差戻し', comment }
function adminInv_respondRevision(payload, email) {
  try {
    var me = adminInv_assertAdmin_(email);
    payload = payload || {};
    var applyId = inv_norm_(payload.applyId);
    var action = inv_norm_(payload.action);
    var comment = inv_norm_(payload.comment);
    if (!applyId) throw new Error('申請IDが空です');
    if (['承認済み', '却下', '差戻し'].indexOf(action) < 0) {
      throw new Error('不正なaction: ' + action);
    }

    // ロック内ではシート更新のみ。再発行は inv_createInvoice_ が独自にロックを取得するため、
    // ロック外で実施する（DocumentLock は reentrant ではない）。
    var locked = inv_withLock_(function(){
      var ss = inv_getSS_();
      var revSh = ss.getSheetByName(INV_SHEET.REVISION);
      if (!revSh) throw new Error('修正申請シートがありません');
      var revHmap = inv_buildHeaderMap_(revSh);
      var lastRow = revSh.getLastRow();
      if (lastRow < 2) throw new Error('申請が見つかりません');
      var rows = revSh.getRange(2, 1, lastRow - 1, revSh.getLastColumn()).getValues();
      var targetIdx = -1, target = null;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][revHmap.idx['申請ID']]) === applyId) {
          targetIdx = i;
          target = rows[i];
          break;
        }
      }
      if (!target) throw new Error('申請が見つかりません: ' + applyId);
      var currentStatus = String(target[revHmap.idx['ステータス']] || '');
      if (currentStatus !== '申請中') throw new Error('既に対応済みです: ' + currentStatus);

      var invoiceNo = String(target[revHmap.idx['請求書番号']] || '');
      var staffEmail = String(target[revHmap.idx['スタッフメール']] || '');
      var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      var actualRow = targetIdx + 2;

      // 修正申請レコードを更新
      revSh.getRange(actualRow, revHmap.idx['対応日時'] + 1).setValue(nowStr);
      revSh.getRange(actualRow, revHmap.idx['対応者メール'] + 1).setValue(me.email);
      revSh.getRange(actualRow, revHmap.idx['ステータス'] + 1).setValue(action);
      revSh.getRange(actualRow, revHmap.idx['管理者コメント'] + 1).setValue(comment);

      // 請求書ステータスの後処理
      var hist = inv_readAllHistory_();
      var histRowIdx = -1, histRow = null;
      for (var j = 0; j < hist.rows.length; j++) {
        if (String(hist.rows[j][hist.hmap.idx['請求書番号']]) === invoiceNo) {
          histRowIdx = j;
          histRow = hist.rows[j];
          break;
        }
      }
      if (!histRow) throw new Error('対象請求書が見つかりません: ' + invoiceNo);
      var actualHistRow = histRowIdx + 2;
      var nextInvoiceStatus = null;
      if (action === '承認済み') {
        // 承認: 元請求書を「取消済み」に変更し、最新情報で再発行（連番 -2 など）
        nextInvoiceStatus = '取消済み';
      } else if (action === '却下') {
        nextInvoiceStatus = '作成済み';
      } else if (action === '差戻し') {
        nextInvoiceStatus = '作成済み';
      }
      if (nextInvoiceStatus) {
        hist.sheet.getRange(actualHistRow, hist.hmap.idx['ステータス'] + 1).setValue(nextInvoiceStatus);
        if (hist.hmap.idx['更新日時'] >= 0) {
          hist.sheet.getRange(actualHistRow, hist.hmap.idx['更新日時'] + 1).setValue(nowStr);
        }
        if (comment && hist.hmap.idx['管理者メモ'] >= 0) {
          var existingMemo = String(histRow[hist.hmap.idx['管理者メモ']] || '');
          var newMemo = (existingMemo ? existingMemo + '\n' : '') + '[' + nowStr + '] ' + action + ': ' + comment;
          hist.sheet.getRange(actualHistRow, hist.hmap.idx['管理者メモ'] + 1).setValue(newMemo);
        }
      }

      // 承認時は同月で再発行（連番付きで新規作成）→ ロック外で実施するために要素を返す
      var reissueRequest = null;
      if (action === '承認済み') {
        var ymForReissue = String(histRow[hist.hmap.idx['請求月']] || '');
        var emailForReissue = String(histRow[hist.hmap.idx['スタッフメール']] || '');
        if (ymForReissue && emailForReissue) {
          reissueRequest = { ym: ymForReissue, email: emailForReissue };
        }
      }

      var invoiceObj = inv_historyRowToObject_(histRow, hist.hmap);
      invoiceObj.ステータス = nextInvoiceStatus || invoiceObj.ステータス;

      return {
        applyId: applyId,
        action: action,
        comment: comment,
        invoiceNo: invoiceNo,
        staffEmail: staffEmail,
        nowStr: nowStr,
        revisionSheetRow: actualRow,
        nextInvoiceStatus: nextInvoiceStatus,
        invoiceObj: invoiceObj,
        reissueRequest: reissueRequest
      };
    });

    // ロック外: 再発行を実施し、再請求書番号を修正申請シートに書き戻し、メール通知
    var reissueResult = null;
    if (locked.reissueRequest) {
      try {
        // inv_createInvoice_ は自身でロックを取得する。
        // 元請求書は既に 取消済み に変更済み → 非取消行が無くなったため、新規 seq は max+1 に伸びる
        reissueResult = inv_createInvoice_(
          locked.reissueRequest.email,
          locked.reissueRequest.ym,
          { force: false }
        );
        if (reissueResult && reissueResult.ok && reissueResult.invoiceNo) {
          // 修正申請シートの 再請求書番号 セルへ書き戻し
          try {
            var ss2 = inv_getSS_();
            var revSh2 = ss2.getSheetByName(INV_SHEET.REVISION);
            var revHmap2 = inv_buildHeaderMap_(revSh2);
            if (revSh2 && typeof revHmap2.idx['再請求書番号'] === 'number') {
              revSh2.getRange(locked.revisionSheetRow, revHmap2.idx['再請求書番号'] + 1)
                    .setValue(reissueResult.invoiceNo);
            }
          } catch (eW) {
            console.error('再請求書番号書き戻し失敗: ' + (eW && eW.message || eW));
          }
        }
      } catch (eR) {
        console.error('再発行失敗: ' + (eR && eR.message || eR));
        reissueResult = { ok: false, error: String(eR && eR.message || eR) };
      }
    }

    // メール通知 (スタッフ宛)
    var revisionObj = {
      申請ID: locked.applyId,
      請求書番号: locked.invoiceNo,
      請求月: locked.invoiceObj.請求月,
      スタッフ名: locked.invoiceObj.スタッフ名,
      スタッフメール: locked.staffEmail || locked.invoiceObj.スタッフメール,
      対応日時: locked.nowStr,
      再請求書番号: (reissueResult && reissueResult.ok) ? (reissueResult.invoiceNo || '') : ''
    };
    try {
      inv_mail_revisionResponded_(locked.invoiceObj, revisionObj, locked.action, locked.comment);
    } catch (e) {
      console.error('inv_mail_revisionResponded_ 失敗: ' + (e && e.message || e));
    }

    return {
      ok: true,
      申請ID: locked.applyId,
      ステータス: locked.action,
      請求書番号: locked.invoiceNo,
      請求書ステータス: locked.nextInvoiceStatus,
      再請求書番号: (reissueResult && reissueResult.ok) ? (reissueResult.invoiceNo || '') : '',
      再発行: reissueResult || null
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 請求書ステータスの手動更新
// payload: { no, status, memo? }
function adminInv_updateInvoiceStatus(payload, email) {
  try {
    var me = adminInv_assertAdmin_(email);
    payload = payload || {};
    var no = inv_norm_(payload.no);
    var status = inv_norm_(payload.status);
    var memo = inv_norm_(payload.memo);
    if (!no) throw new Error('請求書番号が空です');
    if (typeof INV_STATUS_LIST === 'undefined' || INV_STATUS_LIST.indexOf(status) < 0) {
      throw new Error('不正なステータス: ' + status);
    }

    return inv_withLock_(function(){
      var hist = inv_readAllHistory_();
      var rowIdx = -1, row = null;
      for (var i = 0; i < hist.rows.length; i++) {
        if (String(hist.rows[i][hist.hmap.idx['請求書番号']]) === no) {
          rowIdx = i;
          row = hist.rows[i];
          break;
        }
      }
      if (!row) throw new Error('請求書が見つかりません: ' + no);
      var actualRow = rowIdx + 2;
      var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      hist.sheet.getRange(actualRow, hist.hmap.idx['ステータス'] + 1).setValue(status);
      if (hist.hmap.idx['更新日時'] >= 0) {
        hist.sheet.getRange(actualRow, hist.hmap.idx['更新日時'] + 1).setValue(nowStr);
      }
      if (status === '支払済み' && hist.hmap.idx['支払日'] >= 0) {
        hist.sheet.getRange(actualRow, hist.hmap.idx['支払日'] + 1).setValue(nowStr);
      }
      if (memo && hist.hmap.idx['管理者メモ'] >= 0) {
        var existingMemo = String(row[hist.hmap.idx['管理者メモ']] || '');
        var newMemo = (existingMemo ? existingMemo + '\n' : '') + '[' + nowStr + '] ' + status + ': ' + memo;
        hist.sheet.getRange(actualRow, hist.hmap.idx['管理者メモ'] + 1).setValue(newMemo);
      }
      return { ok: true, 請求書番号: no, ステータス: status };
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 経過措置率
function adminInv_listGraceRates(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.GRACE);
    if (!sh) return { ok: true, items: [] };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, items: [] };
    var values = sh.getRange(2, 1, lastRow - 1, 5).getValues();
    var items = values.filter(function(r){ return r[0]; }).map(function(r){
      return { 開始YM: r[0], 終了YM: r[1], 控除可能率: Number(r[2]) || 0, 控除不可率: Number(r[3]) || 0, 備考: r[4] || '' };
    });
    return { ok: true, items: items };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// payload: { items: [{開始YM, 終了YM, 控除可能率, 控除不可率, 備考}, ...] }
function adminInv_saveGraceRates(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    payload = payload || {};
    var items = Array.isArray(payload.items) ? payload.items : null;
    if (!items) throw new Error('items が配列ではありません');
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.GRACE);
    if (!sh) throw new Error('経過措置率シートがありません');
    return inv_withLock_(function(){
      var lastRow = sh.getLastRow();
      if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 5).clearContent();
      if (items.length > 0) {
        var rows = items.map(function(it){
          return [
            inv_norm_(it.開始YM),
            inv_norm_(it.終了YM),
            Number(it.控除可能率) || 0,
            Number(it.控除不可率) || 0,
            inv_norm_(it.備考)
          ];
        });
        sh.getRange(2, 1, rows.length, 5).setValues(rows);
      }
      return { ok: true, count: items.length };
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 管理者設定
function adminInv_getAdminSettings(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    return inv_getAdminSettings_();
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// payload: { settings: {...} }
function adminInv_saveAdminSettings(payload, email) {
  try {
    adminInv_assertAdmin_(email);
    payload = payload || {};
    var s = payload.settings || {};
    var ss = inv_getSS_();
    var sh = ss.getSheetByName(INV_SHEET.SETTINGS);
    if (!sh) throw new Error('管理者設定シートがありません');
    var hmap = inv_buildHeaderMap_(sh);
    return inv_withLock_(function(){
      var width = sh.getLastColumn();
      var row = sh.getLastRow() < 2 ? new Array(width) : sh.getRange(2, 1, 1, width).getValues()[0];
      function set(name, v) {
        var idx = hmap.idx[name];
        if (typeof idx === 'number') row[idx] = v;
      }
      set('有効',           s.有効 === true || String(s.有効).toLowerCase() === 'true');
      set('屋号',           inv_norm_(s.屋号));
      set('本名',           inv_norm_(s.本名));
      set('郵便番号',       inv_norm_(s.郵便番号));
      set('住所',           inv_norm_(s.住所));
      set('電話',           inv_norm_(s.電話));
      set('メール',         inv_norm_(s.メール));
      set('インボイス番号', inv_norm_(s.インボイス番号));
      set('振込元銀行候補(JSON)', JSON.stringify(Array.isArray(s.振込元銀行候補) ? s.振込元銀行候補 : []));
      set('楽天⇔楽天手数料',   Number(s['楽天⇔楽天手数料']) || 0);
      set('他行小額手数料', Number(s.他行小額手数料) || 0);
      set('他行高額手数料', Number(s.他行高額手数料) || 0);
      set('高額しきい値',   Number(s.高額しきい値) || 0);
      set('通知先メール',   inv_norm_(s.通知先メール));
      if (sh.getLastRow() < 2) {
        sh.appendRow(row);
      } else {
        sh.getRange(2, 1, 1, width).setValues([row]);
      }
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
