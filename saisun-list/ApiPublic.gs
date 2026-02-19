/**
 * 初期化API — 商品一覧・フィルタオプション・設定を返す
 * フロントエンドのページロード時に呼び出される。
 * @param {string} userKey - クライアント識別キー
 * @param {object} params - 検索パラメータ（ページ番号、フィルタ等）
 * @return {object} { ok, settings, options, page }
 */
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

/**
 * 商品検索API — キーワード・フィルタに基づいてページネーション済み結果を返す
 * @param {string} userKey - クライアント識別キー
 * @param {object} params - { keyword, brand, category, sort, page, ... }
 * @return {object} { ok, items, total, page, pageSize, ... }
 */
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

/**
 * ステータスダイジェストAPI — 指定商品IDの確保/依頼中状態を返す
 * @param {string} userKey - クライアント識別キー
 * @param {Array<string>} ids - 商品ID配列
 * @return {object} { ok, map: { id: status } }
 */
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
 * 確保同期API（短時間ロック付き版）
 * 並行リクエストによるレースコンディションを防止するため、
 * CacheService状態の読み書きをScriptLockで保護する。
 * ロック待機は最大3秒。取得できない場合はリトライを促す。
 * @param {string} userKey
 * @param {Array} ids - 確保したい商品ID配列
 * @return {object} { ok, digest, failed }
 */
function apiSyncHolds(userKey, ids) {
  try {
    const uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    const now = u_nowMs_();
    const wantIds = u_unique_(u_normalizeIds_(ids || []));

    // 短時間ロックで並行制御（最大3秒待機）
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) {
      return { ok: false, message: '現在混雑しています。少し時間を置いて再度お試しください。' };
    }

    try {
      var holdState = st_getHoldState_(orderSs) || {};
      var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};

      st_cleanupExpiredHolds_(holdItems, now);

      var openSet = st_getOpenSetFast_(orderSs) || {};

      var want = {};
      for (let i = 0; i < wantIds.length; i++) want[wantIds[i]] = true;

      var toRemove = [];
      for (const id in holdItems) {
        const it = holdItems[id];
        if (!it) continue;
        if (String(it.userKey || '') === uk && !want[id]) {
          if (it.pendingPayment) continue;  // 決済待ちの確保は解放しない
          toRemove.push(id);
        }
      }
      for (let i = 0; i < toRemove.length; i++) {
        delete holdItems[toRemove[i]];
      }

      var failed = [];
      var untilMsNew = now + app_holdMs_();

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
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

    const digest = st_buildDigestMap_(orderSs, uk, wantIds);
    return { ok: true, digest: digest, failed: failed };

  } catch (e) {
    console.error('apiSyncHolds error:', e);
    return { ok: false, message: '一時的なエラーが発生しました。再度お試しください。' };
  }
}

// apiSubmitEstimate は SubmitFix.gs に移動しました（高速版）

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

function app_sendOrderNotifyMail_(orderSs, receiptNo, info) {
  try {
    const toList = app_getNotifyToEmails_(orderSs);
    if (!toList.length) return;

    const subject = 'デタウリ.Detauri 注文確定（決済完了）';
    const body = app_buildOrderNotifyBody_(orderSs, receiptNo, info);

    MailApp.sendEmail({
      to: toList.join(','),
      subject: subject,
      body: body
    });
  } catch (e) {
    console.error('app_sendOrderNotifyMail_ error:', e);
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

function app_buildOrderNotifyBody_(orderSs, receiptNo, info) {
  const ssUrl = orderSs && orderSs.getUrl ? orderSs.getUrl() : '';
  const createdAt = info && info.createdAtMs ? new Date(info.createdAtMs) : new Date();
  const lines = [];

  lines.push('【決済完了】新しい注文が確定しました。');
  lines.push('');
  lines.push('受付番号: ' + String(receiptNo || ''));
  lines.push('注文日時: ' + createdAt);
  if (info && info.paymentMethod) lines.push('決済方法: ' + String(info.paymentMethod || ''));
  if (info && info.paymentId) lines.push('決済ID: ' + String(info.paymentId || ''));
  if (info && info.paymentStatus) lines.push('入金ステータス: ' + String(info.paymentStatus || ''));
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
  if (info && typeof info.discounted !== 'undefined') lines.push('注文金額（税込・送料込）: ' + String(info.discounted) + '円');
  if (info && info.measureLabel) lines.push('採寸: ' + String(info.measureLabel || ''));
  if (info && info.itemDetails && info.itemDetails.length > 0) {
    lines.push('');
    lines.push('選択商品:');
    for (var di = 0; di < info.itemDetails.length; di++) {
      var d_item = info.itemDetails[di];
      var label = d_item.noLabel || d_item.managedId || '';
      var parts = [];
      if (d_item.brand) parts.push(d_item.brand);
      if (d_item.category) parts.push(d_item.category);
      if (d_item.size) parts.push(d_item.size);
      if (d_item.color) parts.push(d_item.color);
      lines.push('  ' + label + '  ' + parts.join(' / ') + '  ' + Number(d_item.price || 0).toLocaleString() + '円');
    }
  } else if (info && info.selectionList) {
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

  return lines.join('\n');
}

// =====================================================
// 顧客宛 注文確認メール（決済完了後に送信）
// =====================================================
function app_sendOrderConfirmToCustomer_(data) {
  try {
    var email = (data.form && data.form.contact) || '';
    if (!email || email.indexOf('@') === -1) return;

    var companyName = (data.form && data.form.companyName) || '';
    var datetime = new Date(data.createdAtMs || Date.now()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    var totalCount = data.totalCount || (data.ids ? data.ids.length : 0);
    var discounted = data.discounted || 0;
    var shippingAmount = data.shippingAmount || 0;
    var selectionList = data.selectionList || (data.ids ? data.ids.join('、') : '');
    var note = (data.form && data.form.note) || '';
    var paymentMethod = data.paymentMethod || '';

    // 決済方法の日本語表示
    var paymentMethodLabel = '';
    switch (paymentMethod) {
      case 'credit_card': paymentMethodLabel = 'クレジットカード'; break;
      case 'konbini': paymentMethodLabel = 'コンビニ払い'; break;
      case 'bank_transfer': paymentMethodLabel = '銀行振込'; break;
      default: paymentMethodLabel = paymentMethod || ''; break;
    }

    var subject = '【デタウリ.Detauri】ご注文ありがとうございます（受付番号：' + data.receiptNo + '）';
    var body = companyName + ' 様\n\n'
      + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
      + 'お支払いを確認しました。以下の内容でご注文が確定しました。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ ご注文内容\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '受付番号：' + data.receiptNo + '\n'
      + '注文日時：' + datetime + '\n'
      + '会社名/氏名：' + companyName + '\n'
      + '合計点数：' + totalCount + '点\n'
      + '合計金額：' + Number(discounted).toLocaleString() + '円（税込・送料込）\n';

    if (shippingAmount > 0) {
      body += '（うち送料：' + Number(shippingAmount).toLocaleString() + '円）\n';
    }

    if (paymentMethodLabel) {
      body += '決済方法：' + paymentMethodLabel + '\n';
    }

    if (note) {
      body += '備考：' + note + '\n';
    }

    // 商品詳細リスト
    body += '\n■ 選択商品\n';
    if (data.itemDetails && data.itemDetails.length > 0) {
      for (var di = 0; di < data.itemDetails.length; di++) {
        var d_item = data.itemDetails[di];
        var label = d_item.noLabel || d_item.managedId || '';
        var parts = [];
        if (d_item.brand) parts.push(d_item.brand);
        if (d_item.category) parts.push(d_item.category);
        if (d_item.size) parts.push(d_item.size);
        if (d_item.color) parts.push(d_item.color);
        body += '  ' + label + '  ' + parts.join(' / ') + '  ' + Number(d_item.price || 0).toLocaleString() + '円\n';
      }
    } else {
      body += selectionList + '\n';
    }
    body += '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '商品の発送準備を進めてまいります。\n'
      + '発送が完了しましたら、追跡番号とともにメールでお知らせいたします。\n\n'
      + '※ このメールは自動送信です。\n'
      + '※ ご注文確定後のキャンセル・変更はできません。\n\n'
      + '──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: body,
      noReply: true
    });
  } catch (e) {
    console.error('app_sendOrderConfirmToCustomer_ error:', e);
  }
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

    var datetime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // 1. 管理者宛通知
    var adminTo = (function() {
      try { return PropertiesService.getScriptProperties().getProperty('CONTACT_ADMIN_EMAILS') || (SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'); }
      catch (e) { return SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'; }
    })();
    var adminSubject = '【デタウリ.Detauri】お問い合わせ: ' + name;
    var adminBody = 'お問い合わせを受信しました。\n\n'
      + 'お名前: ' + name + '\n'
      + 'メールアドレス: ' + email + '\n'
      + '日時: ' + datetime + '\n'
      + '\n--- お問い合わせ内容 ---\n'
      + message + '\n';

    MailApp.sendEmail({
      to: adminTo,
      replyTo: email,
      subject: adminSubject,
      body: adminBody
    });

    // 2. 顧客宛確認メール
    var custSubject = '【デタウリ.Detauri】お問い合わせを受け付けました';
    var custBody = name + ' 様\n\n'
      + 'お問い合わせいただきありがとうございます。\n'
      + '以下の内容で受け付けました。2営業日以内にご連絡いたします。\n\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '■ お問い合わせ内容\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + 'お名前：' + name + '\n'
      + 'メールアドレス：' + email + '\n'
      + '日時：' + datetime + '\n\n'
      + message + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '※ このメールは自動送信です。\n'
      + '  このメールへの返信はお控えください。\n\n'
      + '──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    MailApp.sendEmail({
      to: email,
      subject: custSubject,
      body: custBody,
      noReply: true
    });

    return { ok: true };
  } catch (e) {
    console.error('apiSendContactForm error:', e);
    return { ok: false, message: '送信に失敗しました: ' + (e.message || String(e)) };
  }
}
