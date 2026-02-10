const BASE_APP = {
  API_BASE: 'https://api.thebase.in',
  AUTH_PATH: '/1/oauth/authorize',
  TOKEN_PATH: '/1/oauth/token',
  SCOPE: 'read_users read_orders',
  PROP_CLIENT_ID: 'BASE_CLIENT_ID',
  PROP_CLIENT_SECRET: 'BASE_CLIENT_SECRET',
  PROP_ACCESS_TOKEN: 'BASE_ACCESS_TOKEN',
  PROP_REFRESH_TOKEN: 'BASE_REFRESH_TOKEN',
  PROP_EXPIRES_AT: 'BASE_EXPIRES_AT',
  PROP_STATE: 'BASE_OAUTH_STATE',
  PROP_LAST_SYNC_AT: 'BASE_LAST_SYNC_AT',
  PROP_REDIRECT_URI: 'BASE_REDIRECT_URI',
  PROP_TARGET_SS_ID: 'BASE_TARGET_SS_ID',
  SHEET_ORDERS: 'BASE_注文',
  SHEET_ITEMS: 'BASE_注文商品',
  SYNC_DEFAULT_DAYS: 30,
  SYNC_BUFFER_DAYS: 7,
  LIST_LIMIT: 100
};

// 初期設定用の入力値（baseSetupDirect()で使用）
// ハードコードではなく PropertiesService から取得する
// 初回セットアップ時のみここに値を入れて baseSetupDirect() を実行し、その後空に戻す
const BASE_CLIENT_ID_INPUT = '';
const BASE_CLIENT_SECRET_INPUT = '';
const BASE_REDIRECT_URI_EXEC = '';
const BASE_TARGET_SPREADSHEET_ID_INPUT = '';

function baseCanHandleOAuthCallback_(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (p && (p.code || p.error)) return true;
  if (p && p.state) return true;
  return false;
}

function baseDoGet(e) {
  return baseHandleOAuthCallback_(e);
}

function baseSetupDirect() {
  const clientId = String(BASE_CLIENT_ID_INPUT || '').trim();
  const clientSecret = String(BASE_CLIENT_SECRET_INPUT || '').trim();
  const redirectUri = String(BASE_REDIRECT_URI_EXEC || '').trim();
  const targetId = String(BASE_TARGET_SPREADSHEET_ID_INPUT || '').trim();

  if (!clientId) throw new Error('client_id が空です');
  if (!clientSecret) throw new Error('client_secret が空です');
  if (!redirectUri) throw new Error('BASE_REDIRECT_URI_EXEC が空です（/exec のURL）');
  if (!targetId) throw new Error('BASE_TARGET_SPREADSHEET_ID_INPUT が空です（注文を入れるスプレッドシートID）');

  const props = PropertiesService.getScriptProperties();
  props.setProperty(BASE_APP.PROP_CLIENT_ID, clientId);
  props.setProperty(BASE_APP.PROP_CLIENT_SECRET, clientSecret);
  props.setProperty(BASE_APP.PROP_REDIRECT_URI, redirectUri);
  props.setProperty(BASE_APP.PROP_TARGET_SS_ID, targetId);

  return baseCheckSetup();
}

function baseCheckSetup() {
  const props = PropertiesService.getScriptProperties();
  const clientId = String(props.getProperty(BASE_APP.PROP_CLIENT_ID) || '').trim();
  const clientSecret = String(props.getProperty(BASE_APP.PROP_CLIENT_SECRET) || '').trim();
  const redirectUri = String(props.getProperty(BASE_APP.PROP_REDIRECT_URI) || '').trim();
  const targetId = String(props.getProperty(BASE_APP.PROP_TARGET_SS_ID) || '').trim();

  return {
    ok: true,
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    hasRedirectUri: !!redirectUri,
    hasTargetSpreadsheetId: !!targetId,
    redirectUri: redirectUri,
    targetSpreadsheetId: targetId,
    clientIdHead: clientId ? clientId.slice(0, 6) : ''
  };
}

function baseShowAuthUrl() {
  const cfg = baseGetOauthConfig_();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('client_id / client_secret が未設定です');
  if (!cfg.redirectUri) throw new Error('redirect_uri が未設定です（/exec を保存してください）');

  const state = baseEnsureOauthState_();
  const authUrl =
    BASE_APP.API_BASE + BASE_APP.AUTH_PATH +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(cfg.clientId) +
    '&redirect_uri=' + encodeURIComponent(cfg.redirectUri) +
    '&scope=' + encodeURIComponent(cfg.scope) +
    '&state=' + encodeURIComponent(state);

  const ui = SpreadsheetApp.getUi();
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;line-height:1.6;">' +
    '<div>下のURLを開いてBASE連携を許可してください。</div>' +
    '<div style="margin-top:10px;word-break:break-all;">' +
    '<a href="' + authUrl + '" target="_blank" rel="noopener noreferrer">' + authUrl + '</a>' +
    '</div>' +
    '<div style="margin-top:10px;">許可後、このWebアプリURLに戻ってきたら完了です。</div>' +
    '</div>'
  ).setWidth(800).setHeight(240);

  ui.showModalDialog(html, 'BASE 認証URL');
}

function basePrintAuthUrl() {
  const cfg = baseGetOauthConfig_();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('client_id / client_secret が未設定です');
  if (!cfg.redirectUri) throw new Error('redirect_uri が未設定です（/exec を保存してください）');

  const state = baseEnsureOauthState_();
  const authUrl =
    BASE_APP.API_BASE + BASE_APP.AUTH_PATH +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(cfg.clientId) +
    '&redirect_uri=' + encodeURIComponent(cfg.redirectUri) +
    '&scope=' + encodeURIComponent(cfg.scope) +
    '&state=' + encodeURIComponent(state);

  Logger.log(authUrl);
  return authUrl;
}

function baseHandleOAuthCallback_(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const cfg = baseGetOauthConfig_();

  if (p.error) {
    return HtmlService.createHtmlOutput('連携が拒否/失敗しました: ' + String(p.error));
  }

  const code = String(p.code || '').trim();
  if (!code) {
    return HtmlService.createHtmlOutput('BASE OAuth コールバックURLです。');
  }

  const stateGot = String(p.state || '').trim();
  const stateSaved = baseGetOauthState_();
  if (!stateSaved || !stateGot || stateSaved !== stateGot) {
    return HtmlService.createHtmlOutput('state が一致しません。baseShowAuthUrl() からやり直してください。');
  }

  if (!cfg.clientId || !cfg.clientSecret) {
    return HtmlService.createHtmlOutput('client_id / client_secret が未設定です。');
  }
  if (!cfg.redirectUri) {
    return HtmlService.createHtmlOutput('redirect_uri が未設定です（/exec）。');
  }

  try {
    const token = baseExchangeCodeForToken_(code, cfg);
    baseStoreToken_(token);
    baseSetLastSyncAt_(null);
    return HtmlService.createHtmlOutput('BASE連携が完了しました。スプレッドシート側で baseTestOrders() を実行してください。');
  } catch (err) {
    return HtmlService.createHtmlOutput('トークン取得に失敗しました: ' + baseErrToText_(err));
  }
}

function baseExchangeCodeForToken_(code, cfg) {
  const url = BASE_APP.API_BASE + BASE_APP.TOKEN_PATH;

  const payload = baseToFormEncoded_({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code: code,
    redirect_uri: cfg.redirectUri
  });

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true
  });

  const rc = resp.getResponseCode();
  const text = resp.getContentText();
  if (rc < 200 || rc >= 300) throw new Error(rc + ' ' + text);

  return text ? JSON.parse(text) : {};
}

function baseRefreshAccessToken_(cfg) {
  const props = PropertiesService.getScriptProperties();
  const refresh = String(props.getProperty(BASE_APP.PROP_REFRESH_TOKEN) || '').trim();

  if (!refresh) {
    const url = basePrintAuthUrl();
    try { baseShowAuthUrl(); } catch (e) {}
    throw new Error('refresh_token がありません。次のURLで再認証してください: ' + url);
  }

  const url = BASE_APP.API_BASE + BASE_APP.TOKEN_PATH;
  const payload = baseToFormEncoded_({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refresh,
    redirect_uri: cfg.redirectUri
  });

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true
  });

  const rc = resp.getResponseCode();
  const text = resp.getContentText();

  if (rc < 200 || rc >= 300) {
    const t = String(text || '');
    const authUrl = basePrintAuthUrl();
    try { baseShowAuthUrl(); } catch (e) {}
    throw new Error('トークン更新に失敗しました。再認証してください: ' + authUrl + ' / ' + rc + ' ' + t);
  }

  const token = text ? JSON.parse(text) : {};
  baseStoreToken_(token);
  return token;
}

function baseStoreToken_(token) {
  const props = PropertiesService.getScriptProperties();

  const access = token && token.access_token ? String(token.access_token) : '';
  const refresh = token && token.refresh_token ? String(token.refresh_token) : '';
  const expiresIn = token && token.expires_in != null ? Number(token.expires_in) : 3600;

  if (!access) throw new Error('access_token が空です');

  props.setProperty(BASE_APP.PROP_ACCESS_TOKEN, access);
  if (refresh) props.setProperty(BASE_APP.PROP_REFRESH_TOKEN, refresh);

  const expiresAt = Date.now() + expiresIn * 1000;
  props.setProperty(BASE_APP.PROP_EXPIRES_AT, String(expiresAt));
}

function baseGetAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const access = String(props.getProperty(BASE_APP.PROP_ACCESS_TOKEN) || '').trim();
  const exp = Number(props.getProperty(BASE_APP.PROP_EXPIRES_AT) || '0');

  const cfg = baseGetOauthConfig_();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('client_id / client_secret が未設定です');
  if (!cfg.redirectUri) throw new Error('redirect_uri が未設定です（/exec）。');

  const now = Date.now();
  if (access && exp && (exp - now) > 120000) return access;

  const token = baseRefreshAccessToken_(cfg);
  return String(token.access_token || '').trim();
}

function baseApiGet_(path, params) {
  const url = baseBuildUrl_(BASE_APP.API_BASE + path, params);
  const token = baseGetAccessToken_();

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const rc = resp.getResponseCode();
  const text = resp.getContentText();

  if (rc < 200 || rc >= 300) throw new Error(rc + ' ' + String(text || ''));

  return text ? JSON.parse(text) : {};
}

function baseGetTokenStatus() {
  const props = PropertiesService.getScriptProperties();
  const access = String(props.getProperty(BASE_APP.PROP_ACCESS_TOKEN) || '');
  const refresh = String(props.getProperty(BASE_APP.PROP_REFRESH_TOKEN) || '');
  const exp = Number(props.getProperty(BASE_APP.PROP_EXPIRES_AT) || '0');
  const now = Date.now();
  return {
    hasAccessToken: !!access,
    hasRefreshToken: !!refresh,
    expiresAt: exp || 0,
    expiresInSec: exp ? Math.max(0, Math.floor((exp - now) / 1000)) : 0
  };
}

function baseResetTokens() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BASE_APP.PROP_ACCESS_TOKEN);
  props.deleteProperty(BASE_APP.PROP_REFRESH_TOKEN);
  props.deleteProperty(BASE_APP.PROP_EXPIRES_AT);
  props.deleteProperty(BASE_APP.PROP_LAST_SYNC_AT);
  return { ok: true };
}

function baseGetTargetSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = String(props.getProperty(BASE_APP.PROP_TARGET_SS_ID) || '').trim();
  if (!id) throw new Error('同期先スプレッドシートIDが未設定です。baseSetupDirect() で設定してください。');
  return SpreadsheetApp.openById(id);
}

function baseSetTargetSpreadsheetId(id) {
  const v = String(id || '').trim();
  if (!v) throw new Error('IDが空です');
  PropertiesService.getScriptProperties().setProperty(BASE_APP.PROP_TARGET_SS_ID, v);
  return { ok: true, spreadsheetId: v };
}

function baseDebugFetchOrdersCount(days) {
  const d = Number(days);
  const span = (isFinite(d) && d > 0) ? d : 14;
  const end = new Date();
  const start = new Date(end.getTime() - span * 24 * 3600 * 1000);
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const startStr = baseFormatYmdHms_(start, tz);
  const endStr = baseFormatYmdHms_(end, tz);

  const list = baseApiGet_('/1/orders', {
    start_ordered: startStr,
    end_ordered: endStr,
    limit: '100',
    offset: '0'
  });

  const orders = (list && list.orders && Array.isArray(list.orders)) ? list.orders : [];
  return {
    ok: true,
    range: { start: startStr, end: endStr },
    count: orders.length,
    firstUniqueKey: orders[0] && orders[0].unique_key ? String(orders[0].unique_key) : ''
  };
}

function baseTestOrders() {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 3600 * 1000);
  return baseSyncOrdersBetween_(start, end);
}

function baseSyncOrdersNow() {
  const last = baseGetLastSyncAt_();
  var result;
  if (!last) {
    result = baseSyncOrdersSinceDays(BASE_APP.SYNC_DEFAULT_DAYS);
  } else {
    result = baseSyncOrdersBetween_(new Date(last.getTime() - BASE_APP.SYNC_BUFFER_DAYS * 24 * 3600 * 1000), new Date());
  }

  // BASE_注文 → 依頼管理 自動反映
  try {
    syncBaseOrdersToIraiKanri();
  } catch (e) {
    console.error('syncBaseOrdersToIraiKanri error:', e);
  }

  return result;
}

function baseSyncOrdersSinceDays(days) {
  const d = Number(days);
  const span = (isFinite(d) && d > 0) ? d : BASE_APP.SYNC_DEFAULT_DAYS;
  const end = new Date();
  const start = new Date(end.getTime() - span * 24 * 3600 * 1000);
  return baseSyncOrdersBetween_(start, end);
}

function baseSyncOrdersBetween_(startDate, endDate) {
  let lock;
  try {
    lock = LockService.getDocumentLock();
  } catch (e) {
    lock = LockService.getScriptLock();
  }

  if (!lock.tryLock(15000)) {
    throw new Error('同期処理がすでに実行中です。少し待ってから再実行してください。');
  }

  try {
    const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    const startStr = baseFormatYmdHms_(startDate, tz);
    const endStr = baseFormatYmdHms_(endDate, tz);

    const ss = baseGetTargetSpreadsheet_();
    const ordersSh = baseEnsureOrdersSheet_(ss);
    const itemsSh = baseEnsureItemsSheet_(ss);

    baseEnsurePlainTextColumns_(ordersSh, ['電話番号', '住所2']);

    const orderIndex = baseBuildOrderIndexMap_(ordersSh);
    const itemIndex = baseBuildItemIndexMap_(itemsSh);

    let offset = 0;
    let totalUpsertOrders = 0;
    let totalUpsertItems = 0;
    let appendedOrders = 0;
    let appendedItems = 0;

    const startTime = Date.now();
    const maxMs = 5 * 60 * 1000 - 15000;

    while (true) {
      if (Date.now() - startTime > maxMs) break;

      const list = baseApiGet_('/1/orders', {
        start_ordered: startStr,
        end_ordered: endStr,
        limit: String(BASE_APP.LIST_LIMIT),
        offset: String(offset)
      });

      const orders = (list && list.orders && Array.isArray(list.orders)) ? list.orders : [];
      if (orders.length === 0) break;

      for (let i = 0; i < orders.length; i++) {
        if (Date.now() - startTime > maxMs) break;

        const uk = orders[i] && orders[i].unique_key ? String(orders[i].unique_key) : '';
        if (!uk) continue;

        const detail = baseApiGet_('/1/orders/detail/' + encodeURIComponent(uk), null);
        const order = detail && detail.order ? detail.order : null;
        if (!order) continue;

        const oRow = baseBuildOrderRow_(order, tz);
        const existsRow = orderIndex[uk];

        if (existsRow) {
          ordersSh.getRange(existsRow, 1, 1, oRow.length).setValues([oRow]);
        } else {
          ordersSh.appendRow(oRow);
          orderIndex[uk] = ordersSh.getLastRow();
          appendedOrders++;
        }
        totalUpsertOrders++;

        const items = Array.isArray(order.order_items) ? order.order_items : [];
        for (let j = 0; j < items.length; j++) {
          const it = items[j] || {};
          const itemId = (it.order_item_id != null) ? String(it.order_item_id) : '';
          if (!itemId) continue;

          const key = uk + ':' + itemId;
          const iRow = baseBuildItemRow_(uk, it, tz);
          const iExists = itemIndex[key];

          if (iExists) {
            itemsSh.getRange(iExists, 1, 1, iRow.length).setValues([iRow]);
          } else {
            itemsSh.appendRow(iRow);
            itemIndex[key] = itemsSh.getLastRow();
            appendedItems++;
          }
          totalUpsertItems++;
        }
      }

      offset += orders.length;
      if (orders.length < BASE_APP.LIST_LIMIT) break;
    }

    baseEnsurePlainTextColumns_(ordersSh, ['電話番号', '住所2']);

    baseSetLastSyncAt_(new Date());

    return {
      ok: true,
      range: { start: startStr, end: endStr },
      upsertOrders: totalUpsertOrders,
      upsertItems: totalUpsertItems,
      appendedOrders: appendedOrders,
      appendedItems: appendedItems
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function baseEnsureHeaderRow_(sh, headers) {
  const width = headers.length;

  const lastRow = sh.getLastRow();
  if (lastRow === 0) {
    sh.getRange(1, 1, 1, width).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, width).setFontWeight('bold');
    sh.getRange(1, 1, 1, width).setWrap(true);
    if (!sh.getFilter()) sh.getRange(1, 1, 1, width).createFilter();
    return;
  }

  const row1 = sh.getRange(1, 1, 1, width).getValues()[0];
  let same = true;
  for (let i = 0; i < width; i++) {
    const a = (row1[i] != null) ? String(row1[i]).trim() : '';
    const b = String(headers[i]).trim();
    if (a !== b) { same = false; break; }
  }
  if (same) {
    sh.setFrozenRows(1);
    if (!sh.getFilter()) sh.getRange(1, 1, 1, width).createFilter();
    return;
  }

  let row1HasData = false;
  const checkRow1 = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), width)).getValues()[0];
  for (let i = 0; i < checkRow1.length; i++) {
    if (checkRow1[i] != null && String(checkRow1[i]).trim() !== '') { row1HasData = true; break; }
  }

  if (row1HasData) sh.insertRowBefore(1);

  sh.getRange(1, 1, 1, width).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.getRange(1, 1, 1, width).setWrap(true);
  if (!sh.getFilter()) sh.getRange(1, 1, 1, width).createFilter();
}

function baseEnsureOrdersSheet_(ss) {
  const headers = [
    '注文キー',
    '注文日時',
    'キャンセル日時',
    '対応完了日時',
    '更新日時',
    '決済方法',
    '注文ステータス',
    '合計金額',
    '送料',
    '代引手数料',
    '手数料種別',
    '名',
    '姓',
    'メールアドレス',
    '電話番号',
    '郵便番号',
    '都道府県',
    '住所1',
    '住所2',
    '備考',
    '追跡番号',
    '配送日',
    '配送時間帯',
    '注文RAW(JSON)',
    '取得日時'
  ];

  let sh = ss.getSheetByName(BASE_APP.SHEET_ORDERS);
  if (!sh) sh = ss.insertSheet(BASE_APP.SHEET_ORDERS);

  baseEnsureHeaderRow_(sh, headers);
  baseEnsurePlainTextColumns_(sh, ['電話番号', '住所2']);
  return sh;
}

function baseEnsureItemsSheet_(ss) {
  const headers = [
    '注文キー',
    '注文商品ID',
    '商品ID',
    'バリエーションID',
    '商品名',
    '商品識別子',
    'バリエーション名',
    'バリエーション識別子',
    'バーコード',
    '単価',
    '数量',
    '合計',
    '商品小計',
    'オプション小計',
    'ステータス',
    '配送方法',
    '送料',
    '配送開始',
    '配送終了',
    '更新日時',
    'オプションJSON',
    '取得日時'
  ];

  let sh = ss.getSheetByName(BASE_APP.SHEET_ITEMS);
  if (!sh) sh = ss.insertSheet(BASE_APP.SHEET_ITEMS);

  baseEnsureHeaderRow_(sh, headers);
  return sh;
}

function baseBuildOrderIndexMap_(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const k = values[i][0];
    if (k != null && String(k).trim()) map[String(k).trim()] = i + 2;
  }
  return map;
}

function baseBuildItemIndexMap_(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const uk = values[i][0] != null ? String(values[i][0]).trim() : '';
    const oid = values[i][1] != null ? String(values[i][1]).trim() : '';
    if (uk && oid) map[uk + ':' + oid] = i + 2;
  }
  return map;
}

function baseBuildOrderRow_(o, tz) {
  const now = new Date();
  return [
    o && o.unique_key != null ? String(o.unique_key) : '',
    baseToDate_(o.ordered),
    baseToDate_(o.cancelled),
    baseToDate_(o.dispatched),
    o && o.modified != null ? baseToDate_(o.modified) : '',
    o && o.payment != null ? String(o.payment) : '',
    baseToJaOrderStatus_(o && o.dispatch_status != null ? o.dispatch_status : ''),
    o && o.total != null ? Number(o.total) : '',
    o && o.shipping_fee != null ? Number(o.shipping_fee) : '',
    o && o.cod_fee != null ? Number(o.cod_fee) : '',
    o && o.fee_type != null ? String(o.fee_type) : '',
    o && o.first_name != null ? String(o.first_name) : '',
    o && o.last_name != null ? String(o.last_name) : '',
    o && o.mail_address != null ? String(o.mail_address) : '',
    o && o.tel != null ? String(o.tel) : '',
    o && o.zip_code != null ? String(o.zip_code) : '',
    o && o.prefecture != null ? String(o.prefecture) : '',
    o && o.address != null ? String(o.address) : '',
    o && o.address2 != null ? String(o.address2) : '',
    o && o.remark != null ? String(o.remark) : '',
    o && o.tracking_number != null ? String(o.tracking_number) : '',
    o && o.delivery_date != null ? String(o.delivery_date) : '',
    o && o.delivery_time_zone != null ? String(o.delivery_time_zone) : '',
    JSON.stringify(o || {}),
    Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss')
  ];
}

function baseBuildItemRow_(uniqueKey, it, tz) {
  const now = new Date();
  const opts = (it && it.options != null) ? it.options : [];
  return [
    uniqueKey,
    it && it.order_item_id != null ? String(it.order_item_id) : '',
    it && it.item_id != null ? String(it.item_id) : '',
    it && it.variation_id != null ? String(it.variation_id) : '',
    it && it.title != null ? String(it.title) : '',
    it && it.item_identifier != null ? String(it.item_identifier) : '',
    it && it.variation != null ? String(it.variation) : '',
    it && it.variation_identifier != null ? String(it.variation_identifier) : '',
    it && it.barcode != null ? String(it.barcode) : '',
    it && it.price != null ? Number(it.price) : '',
    it && it.amount != null ? Number(it.amount) : '',
    it && it.total != null ? Number(it.total) : '',
    it && it.item_total != null ? Number(it.item_total) : '',
    it && it.option_total != null ? Number(it.option_total) : '',
    baseToJaItemStatus_(it && it.status != null ? it.status : ''),
    it && it.shipping_method != null ? String(it.shipping_method) : '',
    it && it.shipping_fee != null ? Number(it.shipping_fee) : '',
    it && it.shipping_start != null ? String(it.shipping_start) : '',
    it && it.shipping_end != null ? String(it.shipping_end) : '',
    it && it.modified != null ? baseToDate_(it.modified) : '',
    JSON.stringify(opts || []),
    Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss')
  ];
}

function baseGetOauthConfig_() {
  const props = PropertiesService.getScriptProperties();
  const clientId = String(props.getProperty(BASE_APP.PROP_CLIENT_ID) || '').trim();
  const clientSecret = String(props.getProperty(BASE_APP.PROP_CLIENT_SECRET) || '').trim();
  const redirectUri = String(props.getProperty(BASE_APP.PROP_REDIRECT_URI) || '').trim();
  return {
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri,
    scope: BASE_APP.SCOPE
  };
}

function baseEnsureOauthState_() {
  const props = PropertiesService.getScriptProperties();
  let state = props.getProperty(BASE_APP.PROP_STATE);
  if (state) return state;
  state = Utilities.getUuid().replace(/-/g, '');
  props.setProperty(BASE_APP.PROP_STATE, state);
  return state;
}

function baseGetOauthState_() {
  const props = PropertiesService.getScriptProperties();
  return String(props.getProperty(BASE_APP.PROP_STATE) || '').trim();
}

function baseBuildUrl_(baseUrl, params) {
  if (!params) return baseUrl;
  const keys = Object.keys(params);
  const q = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = params[k];
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (!s) continue;
    q.push(encodeURIComponent(k) + '=' + encodeURIComponent(s));
  }
  if (q.length === 0) return baseUrl;
  return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
}

function baseToFormEncoded_(obj) {
  const keys = Object.keys(obj || {});
  const pairs = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = obj[k];
    if (v === null || v === undefined) continue;
    pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return pairs.join('&');
}

function baseErrToText_(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.message) return String(err.message);
  return String(err);
}

function baseFormatYmdHms_(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss');
}

function baseToDate_(sec) {
  if (sec === null || sec === undefined) return '';
  const n = Number(sec);
  if (!isFinite(n) || n <= 0) return '';
  return new Date(n * 1000);
}

function baseGetLastSyncAt_() {
  const props = PropertiesService.getScriptProperties();
  const v = String(props.getProperty(BASE_APP.PROP_LAST_SYNC_AT) || '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

function baseSetLastSyncAt_(d) {
  const props = PropertiesService.getScriptProperties();
  if (!d) {
    props.deleteProperty(BASE_APP.PROP_LAST_SYNC_AT);
    return;
  }
  props.setProperty(BASE_APP.PROP_LAST_SYNC_AT, d.toISOString());
}

function baseSetTargetSpreadsheetHere() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('アクティブなスプレッドシートが取得できません');
  PropertiesService.getScriptProperties().setProperty(BASE_APP.PROP_TARGET_SS_ID, ss.getId());
  return { ok: true, spreadsheetId: ss.getId(), name: ss.getName() };
}

function baseResetAuthAll() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BASE_APP.PROP_ACCESS_TOKEN);
  props.deleteProperty(BASE_APP.PROP_REFRESH_TOKEN);
  props.deleteProperty(BASE_APP.PROP_EXPIRES_AT);
  props.deleteProperty(BASE_APP.PROP_LAST_SYNC_AT);
  props.deleteProperty(BASE_APP.PROP_STATE);
  return { ok: true };
}

function baseReLinkByDialog() {
  baseResetAuthAll();
  baseShowAuthUrl();
  return { ok: true };
}

function baseReLinkByLog() {
  baseResetAuthAll();
  return basePrintAuthUrl();
}

function baseEnsureSheetsOnly() {
  const ss = baseGetTargetSpreadsheet_();
  baseEnsureOrdersSheet_(ss);
  baseEnsureItemsSheet_(ss);
  return { ok: true };
}

function baseInstallAutoSync() {
  const fn = 'baseSyncOrdersNow';
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === fn) {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
  return { ok: true };
}

function baseRemoveAutoSync() {
  const fn = 'baseSyncOrdersNow';
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === fn) {
      ScriptApp.deleteTrigger(t);
    }
  }
  return { ok: true };
}

function baseToJaOrderStatus_(v) {
  const s = (v == null) ? '' : String(v).trim();
  if (!s) return '';
  const map = {
    unshippable: '対応開始前',
    ordered: '未対応',
    cancelled: 'キャンセル',
    dispatched: '対応済',
    unpaid: '入金待ち',
    shipping: '配送中'
  };
  return map[s] || s;
}

function baseToJaItemStatus_(v) {
  const s = (v == null) ? '' : String(v).trim();
  if (!s) return '';
  const map = {
    ordered: '未対応',
    cancelled: 'キャンセル',
    dispatched: '対応済'
  };
  return map[s] || s;
}

function baseEnsurePlainTextColumns_(sheet, headerNames) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const maxRows = sheet.getMaxRows();

  for (let i = 0; i < headerNames.length; i++) {
    const name = String(headerNames[i] || '').trim();
    if (!name) continue;

    const col1Based = baseFindHeaderCol1Based_(headerRow, name);
    if (col1Based <= 0) continue;

    sheet.getRange(1, col1Based, maxRows, 1).setNumberFormat('@');
  }
}

function baseFindHeaderCol1Based_(headerRow, name) {
  const target = String(name || '').trim();
  if (!target) return -1;

  for (let i = 0; i < headerRow.length; i++) {
    const h = (headerRow[i] != null) ? String(headerRow[i]).trim() : '';
    if (h === target) return i + 1;
  }

  const t = target.toLowerCase();
  for (let i = 0; i < headerRow.length; i++) {
    const h = (headerRow[i] != null) ? String(headerRow[i]).trim().toLowerCase() : '';
    if (h === t) return i + 1;
  }

  return -1;
}
