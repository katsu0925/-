// ApiPublic.gs
/**
 * 初期化API — 商品一覧・フィルタオプション・設定を返す
 * フロントエンドのページロード時に呼び出される。
 * @param {string} userKey - クライアント識別キー
 * @param {object} params - 検索パラメータ（ページ番号、フィルタ等）
 * @return {object} { ok, settings, options, page }
 */
function apiInit(userKey, params) {
  try {
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    var products = pr_readProducts_();
    var options = pr_buildFilterOptions_(products);
    options.brand = app_readBrandList_();

    var page = st_searchPage_(uk, params);

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
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };
    var page = st_searchPage_(uk, params);
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
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    var list = u_unique_(u_normalizeIds_(ids || []));
    var map = st_buildDigestMap_(orderSs, uk, list);

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
function apiSyncHolds(userKey, ids, sessionId) {
  try {
    var uk = String(userKey || '').trim();
    if (!uk) return { ok: false, message: 'userKeyが不正です' };

    var orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);

    // 会員判定: sessionIdが有効なら会員（確保時間30分）
    var isMember = false;
    if (sessionId) {
      try {
        var sid = String(sessionId).trim();
        // CacheServiceで軽量セッション検証（apiValidateSession時にキャッシュ済み）
        var cached = CacheService.getScriptCache().get('sess_' + sid);
        if (cached) {
          isMember = true;
        } else {
          // キャッシュミス: シート検索（重いが確保同期は30秒間隔なので許容）
          var cust = findCustomerBySession_(sid);
          if (cust) {
            isMember = true;
            CacheService.getScriptCache().put('sess_' + sid, '1', 300); // 5分キャッシュ
            try { cacheCartUserEmail_(uk, cust.email); } catch(e2) {}
          }
        }
      } catch(e) {}
    }

    var now = u_nowMs_();
    var wantIds = u_unique_(u_normalizeIds_(ids || []));

    // ロックで並行制御（最大10秒待機: 同時アクセス時のバッティングを確実に防ぐ）
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { ok: false, message: '現在混雑しています。少し時間を置いて再度お試しください。' };
    }

    try {
      var holdState = st_getHoldState_(orderSs) || {};
      var holdItems = (holdState.items && typeof holdState.items === 'object') ? holdState.items : {};

      st_cleanupExpiredHolds_(holdItems, now);

      var openSet = st_getOpenSetFast_(orderSs) || {};

      var want = {};
      for (var i = 0; i < wantIds.length; i++) want[wantIds[i]] = true;

      var toRemove = [];
      for (var id in holdItems) {
        var it = holdItems[id];
        if (!it) continue;
        if (String(it.userKey || '') === uk && !want[id]) {
          if (it.pendingPayment) continue;  // 決済待ちの確保は解放しない
          toRemove.push(id);
        }
      }
      for (var i = 0; i < toRemove.length; i++) {
        delete holdItems[toRemove[i]];
      }

      var failed = [];
      var untilMsNew = now + app_holdMs_(isMember);

      for (var i = 0; i < wantIds.length; i++) {
        var id = wantIds[i];

        if (openSet[id]) {
          var cur0 = holdItems[id];
          if (cur0 && String(cur0.userKey || '') === uk) delete holdItems[id];
          failed.push({ id: id, reason: '依頼中' });
          continue;
        }

        var cur = holdItems[id];
        var curUntil = cur ? u_toInt_(cur.untilMs, 0) : 0;

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
      // 追加のキャッシュ無効化（save→invalidateの後、digestビルド前に確実にキャッシュをクリア）
      try { st_invalidateStatusCache_(orderSs); } catch(e) { console.log('optional: status cache invalidation: ' + (e.message || e)); }
    } finally {
      try { lock.releaseLock(); } catch (e) { console.log('optional: lock release: ' + (e.message || e)); }
    }

    var digest = st_buildDigestMap_(orderSs, uk, wantIds);
    return { ok: true, digest: digest, failed: failed, holdMinutes: isMember ? (APP_CONFIG.holds.memberMinutes || 30) : (APP_CONFIG.holds.minutes || 15) };

  } catch (e) {
    console.error('apiSyncHolds error:', e);
    return { ok: false, message: '一時的なエラーが発生しました。再度お試しください。' };
  }
}

// apiSubmitEstimate は SubmitFix.gs に移動しました（高速版）

function sh_findNextRowByDisplayKey_(sh, keyCol, headerRows) {
  var hc = Math.max(0, Number(headerRows || 0));
  var col = Math.max(1, Number(keyCol || 1));
  var last = Math.max(hc, sh.getLastRow());
  if (last <= hc) return hc + 1;

  var block = 2000;
  for (var end = last; end > hc; end -= block) {
    var start = Math.max(hc + 1, end - block + 1);
    var h = end - start + 1;
    var vals = sh.getRange(start, col, h, 1).getDisplayValues();
    for (var i = vals.length - 1; i >= 0; i--) {
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
    var toList = app_getNotifyToEmails_(orderSs);
    if (!toList.length) return;

    var subject = 'デタウリ.Detauri 注文確定（決済完了）';
    var body = app_buildOrderNotifyBody_(orderSs, receiptNo, info);

    // HTML版を構築
    var createdAt = info && info.createdAtMs ? new Date(info.createdAtMs) : new Date();
    var ssUrl = orderSs && orderSs.getUrl ? orderSs.getUrl() : '';
    var htmlSections = [];
    var orderRows = [
      { label: '受付番号', value: String(receiptNo || '') },
      { label: '注文日時', value: Utilities.formatDate(createdAt, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') }
    ];
    if (info && info.paymentMethod) orderRows.push({ label: '決済方法', value: String(info.paymentMethod || '') });
    if (info && info.paymentId) orderRows.push({ label: '決済ID', value: String(info.paymentId || '') });
    if (info && info.paymentStatus) orderRows.push({ label: '入金ステータス', value: String(info.paymentStatus || '') });
    if (info && info.userKey) orderRows.push({ label: 'userKey', value: String(info.userKey || '') });
    htmlSections.push({ title: '注文情報', rows: orderRows });

    var custRows = [];
    if (info && info.companyName) custRows.push({ label: '氏名', value: String(info.companyName || '') });
    if (custRows.length) htmlSections.push({ title: '顧客情報', rows: custRows });

    if (info && info.note) {
      htmlSections.push({ title: '備考', text: String(info.note || '') });
    }

    var summaryRows = [];
    if (info && typeof info.totalCount !== 'undefined') summaryRows.push({ label: '点数', value: String(info.totalCount) });
    if (info && typeof info.discounted !== 'undefined') summaryRows.push({ label: '注文金額（税込・送料込）', value: String(info.discounted) + '円' });
    if (info && info.measureLabel && info.measureLabel !== '付き') summaryRows.push({ label: '採寸', value: String(info.measureLabel) });
    if (summaryRows.length) htmlSections.push({ title: '金額', rows: summaryRows });

    if (info && info.itemDetails && info.itemDetails.length > 0) {
      var itemLines = [];
      for (var hi = 0; hi < info.itemDetails.length; hi++) {
        var h_item = info.itemDetails[hi];
        var hLabel = h_item.noLabel || h_item.managedId || '';
        var hParts = [];
        if (h_item.brand) hParts.push(h_item.brand);
        if (h_item.category) hParts.push(h_item.category);
        if (h_item.size) hParts.push(h_item.size);
        if (h_item.color) hParts.push(h_item.color);
        itemLines.push(hLabel + '  ' + hParts.join(' / ') + '  ' + Number(h_item.price || 0).toLocaleString() + '円');
      }
      htmlSections.push({ title: '選択商品', items: itemLines });
    } else if (info && info.selectionList) {
      htmlSections.push({ title: '選択ID', text: String(info.selectionList || '') });
    }

    if (ssUrl) {
      htmlSections.push({ title: 'スプレッドシート', text: ssUrl });
    }
    if (info && typeof info.writeRow !== 'undefined') {
      htmlSections.push({ title: '書込行', text: String(info.writeRow) });
    }

    var htmlBody = buildHtmlEmail_({
      lead: '【決済完了】新しい注文が確定しました。',
      sections: htmlSections
    });

    MailApp.sendEmail({
      to: toList.join(','),
      subject: subject,
      body: body,
      htmlBody: htmlBody
    });
  } catch (e) {
    console.error('app_sendOrderNotifyMail_ error:', e);
  }
}

function app_getNotifyToEmails_(orderSs) {
  var out = [];
  var add = function(v) {
    var s = String(v || '').trim();
    if (!s) return;
    if (s.indexOf(',') !== -1) {
      s.split(',').forEach(function(x) { add(x); });
      return;
    }
    if (s.indexOf(' ') !== -1) {
      s.split(/\s+/).forEach(function(x) { add(x); });
      return;
    }
    if (s.indexOf('@') === -1) return;
    out.push(s);
  };

  var cfg = (typeof APP_CONFIG === 'object' && APP_CONFIG) ? APP_CONFIG : {};
  var v = cfg.notifyEmails || cfg.notifyEmailTo || cfg.notifyTo;
  if (Array.isArray(v)) v.forEach(function(x) { add(x); });
  else add(v);

  if (!out.length && orderSs && orderSs.getId) {
    try {
      var owner = DriveApp.getFileById(orderSs.getId()).getOwner();
      if (owner && owner.getEmail) add(owner.getEmail());
    } catch (e) { console.log('optional: get file owner email: ' + (e.message || e)); }
  }

  if (!out.length) {
    try { add(Session.getEffectiveUser().getEmail()); } catch (e) { console.log('optional: get effective user email: ' + (e.message || e)); }
  }

  var uniq = {};
  var res = [];
  for (var i = 0; i < out.length; i++) {
    var k = String(out[i] || '').trim().toLowerCase();
    if (!k || uniq[k]) continue;
    uniq[k] = true;
    res.push(out[i]);
  }
  return res;
}

function app_buildOrderNotifyBody_(orderSs, receiptNo, info) {
  var ssUrl = orderSs && orderSs.getUrl ? orderSs.getUrl() : '';
  var createdAt = info && info.createdAtMs ? new Date(info.createdAtMs) : new Date();
  var lines = [];

  lines.push('【決済完了】新しい注文が確定しました。');
  lines.push('');
  lines.push('受付番号: ' + String(receiptNo || ''));
  lines.push('注文日時: ' + Utilities.formatDate(createdAt, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));
  if (info && info.paymentMethod) lines.push('決済方法: ' + String(info.paymentMethod || ''));
  if (info && info.paymentId) lines.push('決済ID: ' + String(info.paymentId || ''));
  if (info && info.paymentStatus) lines.push('入金ステータス: ' + String(info.paymentStatus || ''));
  if (info && info.userKey) lines.push('userKey: ' + String(info.userKey || ''));
  lines.push('');
  if (info && info.companyName) lines.push('氏名: ' + String(info.companyName || ''));
  if (info && info.note) {
    lines.push('');
    lines.push('備考:');
    lines.push(String(info.note || ''));
  }
  lines.push('');
  if (info && typeof info.totalCount !== 'undefined') lines.push('点数: ' + String(info.totalCount));
  if (info && typeof info.discounted !== 'undefined') lines.push('注文金額（税込・送料込）: ' + String(info.discounted) + '円');
  if (info && info.measureLabel && info.measureLabel !== '付き') lines.push('採寸: ' + String(info.measureLabel));
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

    // 後払い（コンビニ・銀行振込・ペイジー）かどうかを判定
    var isDeferredPayment = (paymentMethod === 'konbini' || paymentMethod === 'bank_transfer' || paymentMethod === 'pay_easy');
    var paymentStatusText = data.paymentStatus || '';
    if (paymentStatusText === '入金待ち') isDeferredPayment = true;

    // 期限日を計算（注文日+3日）
    var deadlineDate = new Date(data.createdAtMs || Date.now());
    deadlineDate.setDate(deadlineDate.getDate() + 3);
    var deadlineStr = Utilities.formatDate(deadlineDate, 'Asia/Tokyo', 'yyyy年MM月dd日');

    var subject, body;
    if (isDeferredPayment) {
      subject = '【デタウリ.Detauri】ご注文を受け付けました（受付番号：' + data.receiptNo + '）';
      body = companyName + ' 様\n\n'
        + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
        + '以下の内容でご注文を受け付けました。\n\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + '■ お支払い期限\n'
        + '━━━━━━━━━━━━━━━━━━━━\n'
        + 'お支払い期限：' + deadlineStr + '（ご注文から3日以内）\n'
        + '決済方法：' + paymentMethodLabel + '\n\n'
        + '※ 期限を過ぎますとご注文は自動キャンセルとなり、\n'
        + '  確保中の商品は解放されますのでご注意ください。\n'
        + '※ 入金確認後に注文確定メールをお送りいたします。\n'
        + '━━━━━━━━━━━━━━━━━━━━\n\n';
    } else {
      subject = '【デタウリ.Detauri】ご注文ありがとうございます（受付番号：' + data.receiptNo + '）';
      body = companyName + ' 様\n\n'
        + 'デタウリ.Detauri をご利用いただきありがとうございます。\n'
        + 'お支払いを確認しました。以下の内容でご注文が確定しました。\n\n';
    }

    body += '━━━━━━━━━━━━━━━━━━━━\n'
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

    if (isDeferredPayment) {
      body += '━━━━━━━━━━━━━━━━━━━━\n\n'
        + '上記のお支払い期限までにお支払いをお願いいたします。\n'
        + '入金確認後、商品の発送準備を進めてまいります。\n\n';
    } else {
      body += '━━━━━━━━━━━━━━━━━━━━\n\n'
        + '商品の発送準備を進めてまいります。\n'
        + '発送が完了しましたら、追跡番号とともにメールでお知らせいたします。\n\n';
    }

    body += '※ このメールは自動送信です。\n'
      + (isDeferredPayment ? '' : '※ ご注文確定後のキャンセル・変更はできません。\n')
      + '\n──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    // HTML版を構築
    var htmlSections = [];

    if (isDeferredPayment) {
      htmlSections.push({
        title: 'お支払い期限',
        rows: [
          { label: 'お支払い期限', value: deadlineStr + '（ご注文から3日以内）' },
          { label: '決済方法', value: paymentMethodLabel }
        ]
      });
    }

    var orderRows = [
      { label: '受付番号', value: String(data.receiptNo) },
      { label: '注文日時', value: datetime },
      { label: '会社名/氏名', value: companyName },
      { label: '合計点数', value: totalCount + '点' },
      { label: '合計金額', value: Number(discounted).toLocaleString() + '円（税込・送料込）' }
    ];
    if (shippingAmount > 0) {
      orderRows.push({ label: 'うち送料', value: Number(shippingAmount).toLocaleString() + '円' });
    }
    if (paymentMethodLabel) {
      orderRows.push({ label: '決済方法', value: paymentMethodLabel });
    }
    if (note) {
      orderRows.push({ label: '備考', value: note });
    }
    htmlSections.push({ title: 'ご注文内容', rows: orderRows });

    if (data.itemDetails && data.itemDetails.length > 0) {
      var hItemLines = [];
      for (var hi2 = 0; hi2 < data.itemDetails.length; hi2++) {
        var h2_item = data.itemDetails[hi2];
        var h2Label = h2_item.noLabel || h2_item.managedId || '';
        var h2Parts = [];
        if (h2_item.brand) h2Parts.push(h2_item.brand);
        if (h2_item.category) h2Parts.push(h2_item.category);
        if (h2_item.size) h2Parts.push(h2_item.size);
        if (h2_item.color) h2Parts.push(h2_item.color);
        hItemLines.push(h2Label + '  ' + h2Parts.join(' / ') + '  ' + Number(h2_item.price || 0).toLocaleString() + '円');
      }
      htmlSections.push({ title: '選択商品', items: hItemLines });
    } else if (selectionList) {
      htmlSections.push({ title: '選択商品', text: selectionList });
    }

    var htmlLead = isDeferredPayment
      ? 'デタウリ.Detauri をご利用いただきありがとうございます。\n以下の内容でご注文を受け付けました。'
      : 'デタウリ.Detauri をご利用いただきありがとうございます。\nお支払いを確認しました。以下の内容でご注文が確定しました。';

    var htmlNotes = ['このメールは自動送信です。'];
    if (isDeferredPayment) {
      htmlNotes.push('期限を過ぎますとご注文は自動キャンセルとなり、確保中の商品は解放されますのでご注意ください。');
      htmlNotes.push('入金確認後に注文確定メールをお送りいたします。');
      htmlSections.push({
        title: '',
        text: '上記のお支払い期限までにお支払いをお願いいたします。\n入金確認後、商品の発送準備を進めてまいります。'
      });
    } else {
      htmlNotes.push('ご注文確定後のキャンセル・変更はできません。');
      htmlSections.push({
        title: '',
        text: '商品の発送準備を進めてまいります。\n発送が完了しましたら、追跡番号とともにメールでお知らせいたします。'
      });
    }

    var custHtmlBody = buildHtmlEmail_({
      greeting: companyName + ' 様',
      lead: htmlLead,
      sections: htmlSections,
      notes: htmlNotes
    });

    GmailApp.sendEmail(email, subject, body, {
      from: SITE_CONSTANTS.CUSTOMER_EMAIL,
      replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
      htmlBody: custHtmlBody
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
    var ids = managedIds.slice(0, 500);
    
    // データ1シートから採寸データを取得（API文脈ではgetActiveSpreadsheet()はnullのためopenByIdを使用）
    var ss = SpreadsheetApp.openById(APP_CONFIG.data.spreadsheetId);
    var sheet = ss.getSheetByName('データ1');
    if (!sheet) {
      return { ok: false, message: 'データ1シートが見つかりません' };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: true, details: {} };
    }
    
    // 必要な列を一括取得
    // K列: 管理ID
    // L〜W列: 採寸データ12項目（着丈, 肩幅, 身幅, 袖丈, 桁丈, 総丈, ウエスト, 股上, 股下, ワタリ, 裾幅, ヒップ）
    // X列: 傷汚れ詳細
    var range = sheet.getRange(2, 11, lastRow - 1, 14); // K〜X列（11〜24列）
    var values = range.getValues();
    
    // IDでフィルタリングしてマップ作成
    var idSet = {};
    for (var _si = 0; _si < ids.length; _si++) { idSet[String(ids[_si]).trim()] = true; }
    var details = {};
    
    // 採寸項目のラベル（L〜W列の順序）
    var measureLabels = ['着丈', '肩幅', '身幅', '袖丈', '桁丈', '総丈', 'ウエスト', '股上', '股下', 'ワタリ', '裾幅', 'ヒップ'];
    
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var managedId = String(row[0] || '').trim(); // K列（index 0）
      
      if (!managedId || !idSet[managedId]) continue;
      
      // 採寸データを構築（L〜W列、index 1〜12）
      var measurements = {};
      for (var j = 0; j < measureLabels.length; j++) {
        var val = row[j + 1]; // L列から開始（index 1）
        if (val !== '' && val !== null && val !== undefined) {
          var numVal = Number(val);
          if (!isNaN(numVal) && numVal > 0) {
            measurements[measureLabels[j]] = numVal;
          }
        }
      }
      
      // 傷汚れ詳細（X列、index 13）
      var defectDetail = String(row[13] || '').trim();
      
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
    var managedId = params && params.managedId ? String(params.managedId).trim() : '';
    if (!managedId) {
      return { ok: false, message: '管理番号が指定されていません' };
    }
    
    var detail = pr_getProductDetail_(managedId);
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

    // 画像添付処理（最大3枚）
    var images = (params.images || []).slice(0, 3);
    var attachments = images.map(function(img) {
      var bytes = Utilities.base64Decode(img.data);
      return Utilities.newBlob(bytes, img.type || 'image/jpeg', img.name || 'image.jpg');
    });

    // 1. 管理者宛通知（返信ボタンでお客様に直接返信可能）
    var adminTo = (function() {
      try { return PropertiesService.getScriptProperties().getProperty('CONTACT_ADMIN_EMAILS') || (SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'); }
      catch (e) { return SITE_CONSTANTS.CONTACT_EMAIL + ',nsdktts1030@gmail.com'; }
    })();
    var adminSubject = '【デタウリ.Detauri】お問い合わせ: ' + name;
    var adminBody = 'お問い合わせを受信しました。\n'
      + 'このメールに返信すると ' + email + ' 宛に送信されます。\n\n'
      + 'お名前: ' + name + '\n'
      + 'メールアドレス: ' + email + '\n'
      + '日時: ' + datetime + '\n'
      + (attachments.length > 0 ? '添付画像: ' + attachments.length + '枚\n' : '')
      + '\n--- お問い合わせ内容 ---\n'
      + message + '\n'
      + '\n━━━ 返信テンプレート ━━━\n\n'
      + name + ' 様\n\n'
      + 'お問い合わせいただきありがとうございます。\n'
      + 'デタウリ.Detauriでございます。\n\n'
      + '\n\n'
      + '──────────────────\n'
      + 'デタウリ.Detauri\n'
      + 'https://wholesale.nkonline-tool.com/\n'
      + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL + '\n'
      + '──────────────────\n';

    var adminHtmlBody = buildHtmlEmail_({
      lead: 'お問い合わせを受信しました。<br>このメールに返信すると <strong>' + email + '</strong> 宛に送信されます。',
      sections: [
        {
          title: 'お問い合わせ情報',
          rows: [
            { label: 'お名前', value: name },
            { label: 'メールアドレス', value: email },
            { label: '日時', value: datetime }
          ].concat(attachments.length > 0 ? [{ label: '添付画像', value: attachments.length + '枚' }] : [])
        },
        {
          title: 'お問い合わせ内容',
          text: message
        },
        {
          title: '返信テンプレート（コピーしてご利用ください）',
          text: name + ' 様\n\n'
            + 'お問い合わせいただきありがとうございます。\n'
            + 'デタウリ.Detauriでございます。\n\n'
            + '\n\n'
            + '──────────────────\n'
            + 'デタウリ.Detauri\n'
            + 'https://wholesale.nkonline-tool.com/\n'
            + 'お問い合わせ：' + SITE_CONSTANTS.CONTACT_EMAIL
        }
      ]
    });

    var adminMailOpts = {
      to: adminTo,
      replyTo: email,
      subject: adminSubject,
      body: adminBody,
      htmlBody: adminHtmlBody
    };
    if (attachments.length > 0) adminMailOpts.attachments = attachments;
    MailApp.sendEmail(adminMailOpts);

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

    var custHtmlBody2 = buildHtmlEmail_({
      greeting: name + ' 様',
      lead: 'お問い合わせいただきありがとうございます。\n以下の内容で受け付けました。2営業日以内にご連絡いたします。',
      sections: [
        {
          title: 'お問い合わせ内容',
          rows: [
            { label: 'お名前', value: name },
            { label: 'メールアドレス', value: email },
            { label: '日時', value: datetime }
          ]
        },
        {
          title: '',
          text: message
        }
      ],
      notes: [
        'このメールは自動送信です。',
        'このメールへの返信はお控えください。'
      ]
    });

    GmailApp.sendEmail(email, custSubject, custBody, {
      from: SITE_CONSTANTS.CUSTOMER_EMAIL,
      replyTo: SITE_CONSTANTS.CUSTOMER_EMAIL,
      htmlBody: custHtmlBody2
    });

    return { ok: true };
  } catch (e) {
    console.error('apiSendContactForm error:', e);
    return { ok: false, message: '送信に失敗しました: ' + (e.message || String(e)) };
  }
}
