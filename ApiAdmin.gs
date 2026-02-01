function apiAdminListRequests(adminKey, opts) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    const sh = sh_ensureRequestSheet_(orderSs);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, items: [], total: 0 };
    const o = opts || {};
    const limit = Math.min(300, Math.max(1, u_toInt_(o.limit, 100)));
    const q = String(o.query || '').trim();
    const startRow = Math.max(2, lastRow - limit + 1);
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 21).getValues();
    const out = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const receiptNo = String(r[0] || '').trim();
      const dt = r[1];
      const name = String(r[2] || '');
      const contact = String(r[3] || '');
      const delivery = String(r[5] || '');
      const count = u_toInt_(r[12], 0);
      const subtotal = u_toNumber_(r[13]);
      const status = String(r[17] || '').trim();
      const selectionList = String(r[11] || '');
      const measureOpt = String(r[20] || '');
      if (!receiptNo) continue;
      if (q) {
        const hay = (receiptNo + ' ' + name + ' ' + contact + ' ' + delivery + ' ' + status).toLowerCase();
        if (hay.indexOf(q.toLowerCase()) === -1) continue;
      }
      out.push({
        receiptNo: receiptNo,
        datetime: (dt instanceof Date) ? dt.getTime() : '',
        name: name,
        contact: contact,
        delivery: delivery,
        count: count,
        subtotal: subtotal,
        status: status,
        selectionList: selectionList,
        measureOpt: measureOpt
      });
    }
    return { ok: true, items: out, total: out.length };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiUpdateRequestStatus(adminKey, receiptNo, newStatus) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    const sheet = sh_ensureRequestSheet_(orderSs);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, message: 'データがありません' };
    const values = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
    let targetRow = -1;
    let selectionList = '';
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || '') === String(receiptNo || '')) {
        targetRow = i + 2;
        selectionList = String(values[i][11] || '');
        break;
      }
    }
    if (targetRow === -1) return { ok: false, message: '受付番号が見つかりません' };
    const st = String(newStatus || '').trim();
    if (!st) return { ok: false, message: 'ステータスが不正です' };
    sheet.getRange(targetRow, 18).setValue(st);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return { ok: false, message: '混雑しています。少し待ってから再試行してください' };
    try {
      const nowMs = u_nowMs_();
      od_syncOpenStateForReceipt_(orderSs, String(receiptNo || ''), selectionList, st, nowMs);
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminRebuildStates(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return { ok: false, message: '混雑しています。少し待ってから再試行してください' };
    try {
      const nowMs = u_nowMs_();
      const hold = od_rebuildHoldStateFromSheet_(orderSs);
      const open = od_rebuildOpenStateFromRequestSheet_(orderSs);
      hold.updatedAt = nowMs;
      open.updatedAt = nowMs;
      st_setHoldState_(orderSs, hold);
      st_setOpenState_(orderSs, open);
      st_invalidateStatusCache_(orderSs);
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminSetupAll(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    sh_applyRequestStatusDropdown_(orderSs);
    tr_setupTriggersOnce_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminForceRefreshProducts(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    pr_bumpProductsVersion_();
    pr_clearProductsCache_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminCompactHolds(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    od_compactHolds_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

function setupAllFromEditor() {
  const orderSs = sh_getOrderSs_();
  sh_ensureAllOnce_(orderSs);
  tr_setupTriggersOnce_();
  pr_bumpProductsVersion_();
  pr_clearProductsCache_();
  return { ok: true };
}
