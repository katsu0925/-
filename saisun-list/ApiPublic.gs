function apiInit(userKey, params) {
  try {
    const uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    const products = pr_readProducts_();
    const options = pr_buildFilterOptions_(products);
    options.brand = app_readBrandList_();

    const page = st_searchPage_(uk, params);

    return {
      ok: true,
      settings: app_publicSettings_(),
      options: options,
      page: page
    };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

function apiSearch(userKey, params) {
  try {
    const uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };
    const page = st_searchPage_(uk, params);
    if (page && typeof page === 'object' && !('ok' in page)) page.ok = true;
    return page;
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

function apiGetStatusDigest(userKey, ids) {
  try {
    const uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    const list = u_unique_(u_normalizeIds_(ids || []));
    const map = st_buildDigestMap_(orderSs, uk, list);

    return { ok: true, map: map };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * 確保同期API（ロックなし高速版）
 */
function apiSyncHolds(userKey, ids) {
  try {
    const uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };
    
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    
    const now = u_nowMs_();
    const wantIds = u_unique_(u_normalizeIds_(ids || []));
    
    // ★★★ ロックを使わない方式 ★★★
    const holdState = st_getHoldState_(orderSs) || {};
    const holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};
    
    st_cleanupExpiredHolds_(holdItems, now);
    
    const openSet = st_getOpenSetFast_(orderSs) || {};
    
    const want = {};
    for (let i = 0; i < wantIds.length; i++) want[wantIds[i]] = true;
    
    const toRemove = [];
    for (const id in holdItems) {
      const it = holdItems[id];
      if (!it) continue;
      if (String(it.userKey || '') === uk && !want[id]) {
        toRemove.push(id);
      }
    }
    for (let i = 0; i < toRemove.length; i++) {
      delete holdItems[toRemove[i]];
    }
    
    const failed = [];
    const untilMsNew = now + app_holdMs_();
    
    for (let i = 0; i < wantIds.length; i++) {
      const id = wantIds[i];
      
      if (openSet[id]) {
        const cur0 = holdItems[id];
        if (cur0 && String(cur0.userKey || '') === uk) delete holdItems[id];
        failed.push({ id: id, reason: '依頼中' });
        continue;
      }
      
      const cur = holdItems[id];
      const curUntil = cur ? u_toInt_(cur.untilMs, 0) : 0;
      
      if (cur && curUntil > now) {
        if (String(cur.userKey || '') !== uk) {
          failed.push({ id: id, reason: '確保中' });
          continue;
        }
        cur.untilMs = untilMsNew;
        continue;
      }
      
      holdItems[id] = {
        holdId: uk + ':' + String(now),
        userKey: uk,
        untilMs: untilMsNew,
        createdAtMs: now
      };
    }
    
    holdState.items = holdItems;
    holdState.updatedAt = now;
    st_setHoldState_(orderSs, holdState);
    
    try { st_invalidateStatusCache_(orderSs); } catch(e) {}
    
    const digest = st_buildDigestMap_(orderSs, uk, wantIds);
    return { ok: true, digest: digest, failed: failed };
    
  } catch (e) {
    console.error('apiSyncHolds error:', e);
    return { ok: false, message: '一時的なエラーが発生しました。再度お試しください。' };
  }
}

function u_withLockRetry_(lock, totalWaitMs, stepMs, fn) {
  const total = Math.max(0, Number(totalWaitMs || 0));
  const step = Math.max(10, Number(stepMs || 50));
  const until = Date.now() + total;
  while (true) {
    if (lock.tryLock(step)) break;
    if (Date.now() >= until) return { ok: false, message: '別の処理が実行中です。少し時間を置いてから再試行してください。' };
    Utilities.sleep(step);
  }
  try {
    const r = fn();
    return r;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// apiSubmitEstimate は SubmitFix.gs に移動しました（高速版）

function app_onEdit(e) {
  try {
    if (!e || !e.range) return;
    const r = e.range;
    const sh = r.getSheet();
    const ss = sh.getParent();
    if (ss.getId() !== app_getOrderSpreadsheetId_()) return;
    if (sh.getName() !== String(APP_CONFIG.order.requestSheetName || '依頼管理')) return;
    if (r.getRow() < 2) return;

    const col = r.getColumn();
    if (col !== 18 && col !== 12) return;

    const rebuilt = od_rebuildOpenStateFromRequestSheet_(ss);
    st_setOpenState_(ss, rebuilt);
    od_writeOpenLogSheetFromState_(ss, rebuilt.items || {}, u_nowMs_());
    st_invalidateStatusCache_(ss);
  } catch (err) {
    console.error('app_onEdit error:', err);
  }
}

function sh_findNextRowByDisplayKey_(sh, keyCol, headerRows) {
  const hc = Math.max(0, Number(headerRows || 0));
  const col = Math.max(1, Number(keyCol || 1));
  const last = Math.max(hc, sh.getLastRow());
  if (last <= hc) return hc + 1;

  const block = 2000;
  for (let end = last; end > hc; end -= block) {
    const start = Math.max(hc + 1, end - block + 1);
    const h = end - start + 1;
    const vals = sh.getRange(start, col, h, 1).getDisplayValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0] || '').trim() !== '') {
        return start + i + 1;
      }
    }
  }
  return hc + 1;
}

function forceRefreshProducts() {
  pr_bumpProductsVersion_();
  pr_clearProductsCache_();
}

function app_sendEstimateNotifyMail_(orderSs, receiptNo, info) {
  try {
    const toList = app_getNotifyToEmails_(orderSs);
    if (!toList.length) return;

    const subject = 'NKonlineApparel 見積もり依頼';
    const body = app_buildEstimateNotifyBody_(orderSs, receiptNo, info);

    MailApp.sendEmail({
      to: toList.join(','),
      subject: subject,
      body: body
    });
  } catch (e) {
    console.error('app_sendEstimateNotifyMail_ error:', e);
  }
}

function app_getNotifyToEmails_(orderSs) {
  const out = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (s.indexOf(',') !== -1) {
      s.split(',').forEach(x => add(x));
      return;
    }
    if (s.indexOf(' ') !== -1) {
      s.split(/\s+/).forEach(x => add(x));
      return;
    }
    if (s.indexOf('@') === -1) return;
    out.push(s);
  };

  const cfg = (typeof APP_CONFIG === 'object' && APP_CONFIG) ? APP_CONFIG : {};
  const v = cfg.notifyEmails || cfg.notifyEmailTo || cfg.notifyTo;
  if (Array.isArray(v)) v.forEach(x => add(x));
  else add(v);

  if (!out.length && orderSs && orderSs.getId) {
    try {
      const owner = DriveApp.getFileById(orderSs.getId()).getOwner();
      if (owner && owner.getEmail) add(owner.getEmail());
    } catch (e) {}
  }

  if (!out.length) {
    try { add(Session.getEffectiveUser().getEmail()); } catch (e) {}
  }

  const uniq = {};
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const k = String(out[i] || '').trim().toLowerCase();
    if (!k || uniq[k]) continue;
    uniq[k] = true;
    res.push(out[i]);
  }
  return res;
}

function app_buildEstimateNotifyBody_(orderSs, receiptNo, info) {
  const ssUrl = orderSs && orderSs.getUrl ? orderSs.getUrl() : '';
  const createdAt = info && info.createdAtMs ? new Date(info.createdAtMs) : new Date();
  const lines = [];

  lines.push('新しい見積もり依頼が作成されました。');
  lines.push('');
  lines.push('受付番号: ' + String(receiptNo || ''));
  lines.push('作成日時: ' + createdAt);
  if (info && info.userKey) lines.push('userKey: ' + String(info.userKey || ''));
  lines.push('');
  if (info && info.companyName) lines.push('会社名/氏名: ' + String(info.companyName || ''));
  if (info && info.contact) lines.push('メールアドレス: ' + String(info.contact || ''));
  if (info && info.postal) lines.push('郵便番号: ' + String(info.postal || ''));
  if (info && info.address) lines.push('住所: ' + String(info.address || ''));
  if (info && info.phone) lines.push('電話番号: ' + String(info.phone || ''));
  if (info && info.note) {
    lines.push('');
    lines.push('備考:');
    lines.push(String(info.note || ''));
  }
  lines.push('');
  if (info && typeof info.totalCount !== 'undefined') lines.push('点数: ' + String(info.totalCount));
  if (info && typeof info.discounted !== 'undefined') lines.push('見積金額: ' + String(info.discounted));
  if (info && info.measureLabel) lines.push('採寸: ' + String(info.measureLabel || ''));
  if (info && info.selectionList) {
    lines.push('');
    lines.push('選択ID:');
    lines.push(String(info.selectionList || ''));
  }
  if (ssUrl) {
    lines.push('');
    lines.push('スプレッドシート:');
    lines.push(ssUrl);
  }
  if (info && typeof info.writeRow !== 'undefined') {
    lines.push('書込行: ' + String(info.writeRow));
  }
  if (info && info.templateText) {
    lines.push('');
    lines.push('--- テンプレート文面 ---');
    lines.push(String(info.templateText || ''));
  }

  return lines.join('\n');
}

function apiGetAllDetails(managedIds) {
  try {
    if (!Array.isArray(managedIds) || managedIds.length === 0) {
      return { ok: true, details: {} };
    }
    
    // 最大500件に制限（安全のため）
    const ids = managedIds.slice(0, 500);
    
    // データ1シートから採寸データを取得
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('データ1');
    if (!sheet) {
      return { ok: false, message: 'データ1シートが見つかりません' };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: true, details: {} };
    }
    
    // 必要な列を一括取得
    // K列: 管理ID
    // L〜W列: 採寸データ12項目（着丈, 肩幅, 身幅, 袖丈, 桁丈, 総丈, ウエスト, 股上, 股下, ワタリ, 裾幅, ヒップ）
    // X列: 傷汚れ詳細
    const range = sheet.getRange(2, 11, lastRow - 1, 14); // K〜X列（11〜24列）
    const values = range.getValues();
    
    // IDでフィルタリングしてマップ作成
    const idSet = new Set(ids.map(id => String(id).trim()));
    const details = {};
    
    // 採寸項目のラベル（L〜W列の順序）
    const measureLabels = ['着丈', '肩幅', '身幅', '袖丈', '桁丈', '総丈', 'ウエスト', '股上', '股下', 'ワタリ', '裾幅', 'ヒップ'];
    
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const managedId = String(row[0] || '').trim(); // K列（index 0）
      
      if (!managedId || !idSet.has(managedId)) continue;
      
      // 採寸データを構築（L〜W列、index 1〜12）
      const measurements = {};
      for (let j = 0; j < measureLabels.length; j++) {
        const val = row[j + 1]; // L列から開始（index 1）
        if (val !== '' && val !== null && val !== undefined) {
          const numVal = Number(val);
          if (!isNaN(numVal) && numVal > 0) {
            measurements[measureLabels[j]] = numVal;
          }
        }
      }
      
      // 傷汚れ詳細（X列、index 13）
      const defectDetail = String(row[13] || '').trim();
      
      details[managedId] = {
        measurements: measurements,
        defectDetail: defectDetail
      };
    }
    
    return { ok: true, details: details };
    
  } catch (e) {
    console.error('apiGetAllDetails error:', e);
    return { ok: false, message: '採寸データの取得に失敗しました' };
  }
}

// =====================================================
// 【修正3】ApiPublic.gs の apiGetProductDetail
// =====================================================

function apiGetProductDetail(params) {
  try {
    const managedId = params && params.managedId ? String(params.managedId).trim() : '';
    if (!managedId) {
      return { ok: false, message: '管理番号が指定されていません' };
    }
    
    const detail = pr_getProductDetail_(managedId);
    if (!detail) {
      return { ok: false, message: '商品が見つかりません: ' + managedId };
    }
    
    return { ok: true, detail: detail };
  } catch (e) {
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * お問い合わせフォーム送信API
 */
function apiSendContactForm(params) {
  try {
    var name = String((params && params.name) || '').trim();
    var email = String((params && params.email) || '').trim();
    var message = String((params && params.message) || '').trim();

    if (!name) return { ok: false, message: 'お名前を入力してください' };
    if (!email || email.indexOf('@') === -1) return { ok: false, message: '有効なメールアドレスを入力してください' };
    if (!message) return { ok: false, message: 'お問い合わせ内容を入力してください' };

    var to = 'nkonline1030@gmail.com';
    var subject = '【NKonlineApparel】お問い合わせ: ' + name;
    var body = 'お問い合わせを受信しました。\n\n'
      + 'お名前: ' + name + '\n'
      + 'メールアドレス: ' + email + '\n'
      + '日時: ' + new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '\n'
      + '\n--- お問い合わせ内容 ---\n'
      + message + '\n';

    MailApp.sendEmail({
      to: to,
      replyTo: email,
      subject: subject,
      body: body
    });

    return { ok: true };
  } catch (e) {
    console.error('apiSendContactForm error:', e);
    return { ok: false, message: '送信に失敗しました: ' + (e.message || String(e)) };
  }
}
