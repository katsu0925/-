// Status.gs
function st_baseKeyHold_(orderSs) {
  return 'STATE_HOLDS_V4:' + orderSs.getId();
}

function st_baseKeyOpen_(orderSs) {
  return 'STATE_OPEN_V4:' + orderSs.getId();
}

function st_loadLarge_(baseKey, skipCache) {
  const cache = CacheService.getScriptCache();
  const ck = 'STATECACHE_V1:' + baseKey;

  if (!skipCache) {
    const cached = cache.get(ck);
    if (cached) {
      try {
        const json = u_ungzipFromB64_(cached);
        const obj = JSON.parse(json);
        if (obj) return obj;
      } catch (e0) { console.log('optional: state cache parse: ' + (e0.message || e0)); }
    }
  }

  const props = PropertiesService.getScriptProperties();
  const meta = props.getProperty(baseKey + ':META');
  if (!meta) return null;
  const p = meta.split('|');
  const ver = String(p[0] || '');
  const n = parseInt(p[1], 10) || 0;
  if (!ver || !n) return null;

  const chunks = [];
  for (let i = 0; i < n; i++) {
    const c = props.getProperty(baseKey + ':CHUNK:' + ver + ':' + i);
    if (c == null) return null;
    chunks.push(String(c));
  }
  const packed = chunks.join('');
  let json = '';
  try { json = u_ungzipFromB64_(packed); } catch (e1) { json = packed; }
  try {
    const obj = JSON.parse(json);
    if (obj) {
      if (!skipCache) {
        try { cache.put(ck, u_gzipToB64_(JSON.stringify(obj)), u_toInt_(APP_CONFIG.cache.stateSeconds, 3600)); } catch (e2) { console.log('optional: state cache put: ' + (e2.message || e2)); }
      }
      return obj;
    }
  } catch (e3) { console.log('optional: state JSON parse: ' + (e3.message || e3)); }
  return null;
}

function st_saveLarge_(baseKey, obj) {
  const props = PropertiesService.getScriptProperties();
  const oldMeta = props.getProperty(baseKey + ':META');
  let oldVer = '';
  let oldN = 0;
  if (oldMeta) {
    const op = String(oldMeta).split('|');
    oldVer = String(op[0] || '');
    oldN = parseInt(op[1], 10) || 0;
  }

  const json = JSON.stringify(obj || {});
  const packed = u_gzipToB64_(json);
  const ver = String(u_nowMs_());
  const size = 8000;
  const chunks = [];
  for (let i = 0; i < packed.length; i += size) chunks.push(packed.slice(i, i + size));

  for (let j = 0; j < chunks.length; j++) props.setProperty(baseKey + ':CHUNK:' + ver + ':' + j, chunks[j]);
  props.setProperty(baseKey + ':META', ver + '|' + chunks.length);

  if (oldVer && oldN) {
    for (let k = 0; k < oldN; k++) props.deleteProperty(baseKey + ':CHUNK:' + oldVer + ':' + k);
  }

  const cache = CacheService.getScriptCache();
  const ck = 'STATECACHE_V1:' + baseKey;
  try { cache.put(ck, u_gzipToB64_(JSON.stringify(obj || {})), u_toInt_(APP_CONFIG.cache.stateSeconds, 3600)); } catch (e0) { console.log('optional: state cache put: ' + (e0.message || e0)); }
}

function st_getHoldState_(orderSs) {
  const baseKey = st_baseKeyHold_(orderSs);
  // 確保状態は常にPropertiesServiceから直接読み取る（キャッシュ不使用）
  // 理由: 複数ユーザーが同時にhold操作すると、
  //   読取側がPropertiesServiceの古いデータをキャッシュに再登録し、
  //   書込側のキャッシュ無効化より後に残ってしまう競合状態が発生するため
  const st = st_loadLarge_(baseKey, true);
  if (st && st.items) return st;

  const rebuilt = od_rebuildHoldStateFromSheet_(orderSs);
  st_saveLarge_(baseKey, rebuilt);
  return rebuilt;
}

function st_setHoldState_(orderSs, stateObj) {
  const baseKey = st_baseKeyHold_(orderSs);
  const payload = stateObj || { items: {}, updatedAt: u_nowMs_() };
  // PropertiesServiceに保存（st_saveLarge_はキャッシュにも入れるが、
  // 読取側が常にskipCache=trueなので使われない）
  st_saveLarge_(baseKey, payload);
  // 念のためキャッシュを無効化（他の経路から古いキャッシュを参照されないように）
  st_invalidateStatusCache_(orderSs);
}


function st_getOpenState_(orderSs) {
  const baseKey = st_baseKeyOpen_(orderSs);
  const st = st_loadLarge_(baseKey);
  if (st && st.items) return st;

  const rebuilt = od_rebuildOpenStateFromRequestSheet_(orderSs);
  st_saveLarge_(baseKey, rebuilt);
  return rebuilt;
}

function st_setOpenState_(orderSs, stateObj) {
  const baseKey = st_baseKeyOpen_(orderSs);
  const payload = stateObj || { items: {}, updatedAt: u_nowMs_() };
  st_saveLarge_(baseKey, payload);
  st_invalidateStatusCache_(orderSs);
}

function st_cleanupExpiredHolds_(holdItems, nowMs) {
  if (!holdItems) return;
  const del = [];
  for (const id in holdItems) {
    const it = holdItems[id];
    if (!it) { del.push(id); continue; }
    if (u_toInt_(it.untilMs, 0) <= nowMs) del.push(id);
  }
  for (let i = 0; i < del.length; i++) delete holdItems[del[i]];
}

function st_buildStatusMaps_(orderSs) {
  const now = u_nowMs_();

  // st_getHoldState_ は常にskipCache=trueでPropertiesServiceから直接読取
  const holdState = st_getHoldState_(orderSs);
  const holdItems = holdState.items || {};
  const holds = {};

  for (const id in holdItems) {
    const it = holdItems[id];
    if (!it) continue;
    const untilMs = u_toInt_(it.untilMs, 0);
    if (!untilMs || untilMs <= now) continue;
    holds[id] = {
      userKey: String(it.userKey || ''),
      untilMs: untilMs,
      holdId: String(it.holdId || '')
    };
  }

  const openSet = st_getOpenSetFast_(orderSs);

  return { holds: holds, openSet: openSet };
}

function st_buildNeedles_(keywordRaw, syn) {
  return u_expandKeywordNeedles_(keywordRaw, syn);
}

function st_applyFiltersAndSort_(products, maps, userKey, params) {
  const p = params || {};
  const brandKeys = st_getSelectedBrandKeys_(params);
  const hasBrandFilter = Object.keys(brandKeys).length > 0;
  const keywordRaw = String(p.keyword || '').trim();
  const filters = p.filters || {};
  const sort = p.sort || { key: 'default', dir: 'asc' };
  const page = u_toInt_(p.page, 1);
  const pageSize = Math.min(200, Math.max(1, u_toInt_(p.pageSize, 60)));

  const pickArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  const toSet = (arr) => {
    const m = {};
    for (let i = 0; i < (arr || []).length; i++) {
      const s = String(arr[i] || '').trim();
      if (s) m[s] = true;
    }
    return m;
  };
  const hasAny = (obj) => { for (const k in (obj || {})) return true; return false; };

  const setStatus = toSet(pickArr(filters.status));
  const setCategory = toSet(pickArr(filters.category));
  const setState = toSet(pickArr(filters.state));
  const setGender = toSet(pickArr(filters.gender));
  const setSize = toSet(pickArr(filters.size));

  const now = u_nowMs_();

  const syn = st_getSynonymMaps_();
  const needles = keywordRaw ? st_buildNeedles_(keywordRaw, syn) : null;

  const out = [];
  for (let i = 0; i < products.length; i++) {
    const pr = products[i];
    const id = pr.managedId;

    let computedStatus = '在庫あり';
    let selectable = true;
    let heldByOther = false;
    let holdUntilMs = 0;

    if (maps.openSet && maps.openSet[id]) {
      computedStatus = '依頼中';
      selectable = false;
    } else {
      const h = maps.holds ? maps.holds[id] : null;
      if (h && u_toInt_(h.untilMs, 0) > now) {
        computedStatus = '確保中';
        holdUntilMs = u_toInt_(h.untilMs, 0);
        if (String(h.userKey || '') && String(h.userKey || '') !== String(userKey || '')) {
          selectable = false;
          heldByOther = true;
        }
      }
    }

    if (hasBrandFilter) {
      const bk = st_normBrandKey_(pr.brand);
      if (!brandKeys[bk]) continue;
    }

    if (hasAny(setStatus) && !setStatus[computedStatus]) continue;
    if (hasAny(setCategory) && !setCategory[String(pr.category || '')]) continue;
    if (hasAny(setState) && !setState[String(pr.state || '')]) continue;
    if (hasAny(setGender) && !setGender[String(pr.gender || '')]) continue;
    if (hasAny(setSize) && !setSize[String(pr.size || '')]) continue;

    if (needles) {
      const hay = (
        String(id || '') + ' ' +
        String(pr.noLabel || '') + ' ' +
        String(pr.state || '') + ' ' +
        String(pr.brand || '') + ' ' +
        String(pr.size || '') + ' ' +
        String(pr.gender || '') + ' ' +
        String(pr.category || '') + ' ' +
        String(pr.color || '')
      );

      const hayN = u_normSearchText_(hay);
      const hayC = u_normSearchTextCompact_(hay);

      let hit = false;
      for (let k = 0; k < needles.length; k++) {
        const nd = needles[k];
        if (nd.n && hayN.indexOf(nd.n) !== -1) { hit = true; break; }
        if (nd.c && hayC.indexOf(nd.c) !== -1) { hit = true; break; }
      }
      if (!hit) continue;
    }

    out.push({
      managedId: id,
      noLabel: pr.noLabel,
      imageUrl: pr.imageUrl,
      state: pr.state,
      brand: pr.brand,
      size: pr.size,
      gender: pr.gender,
      category: pr.category,
      color: pr.color,
      price: pr.price,
      qty: pr.qty,
      status: computedStatus,
      selectable: selectable,
      heldByOther: heldByOther,
      holdUntilMs: holdUntilMs
    });
  }

  const dir = String(sort.dir || 'asc') === 'desc' ? -1 : 1;
  const key = String(sort.key || 'default');

  const normSize = (s) => {
    const t = String(s || '').trim();
    if (!t) return { type: 9, num: 0, txt: '' };
    const m = t.match(/(\d+(\.\d+)?)/);
    if (m) return { type: 0, num: parseFloat(m[1]), txt: t };
    return { type: 1, num: 0, txt: t };
  };

  const cmpSize = (a, b) => {
    const ax = normSize(a);
    const bx = normSize(b);
    if (ax.type !== bx.type) return ax.type - bx.type;
    if (ax.type === 0) {
      if (ax.num !== bx.num) return ax.num - bx.num;
      return ax.txt.localeCompare(bx.txt, 'ja');
    }
    return ax.txt.localeCompare(bx.txt, 'ja');
  };

  const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), 'ja');
  const cmpNum = (a, b) => (Number(a || 0) - Number(b || 0));

  out.sort((A, B) => {
    let c = 0;
    if (key === 'price') c = cmpNum(A.price, B.price);
    else if (key === 'brand') c = cmpText(A.brand, B.brand);
    else if (key === 'size') c = cmpSize(A.size, B.size);
    else if (key === 'managed') c = u_compareManagedId_(A.managedId, B.managedId);
    else c = u_compareManagedId_(A.managedId, B.managedId);
    if (c === 0) c = u_compareManagedId_(A.managedId, B.managedId);
    return c * dir;
  });

  const total = out.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const curPage = Math.min(totalPages, Math.max(1, page));
  const start = (curPage - 1) * pageSize;
  const items = out.slice(start, start + pageSize);

  return {
    ok: true,
    items: items,
    total: total,
    totalPages: totalPages,
    page: curPage,
    pageSize: pageSize
  };
}

function st_getSelectedBrandKeys_(params) {
  const p = (params && typeof params === 'object') ? params : {};
  const f = (p.filters && typeof p.filters === 'object') ? p.filters : {};

  let list = [];
  if (Array.isArray(f.brand)) list = f.brand;
  else if (typeof f.brand === 'string' && f.brand.trim()) list = [f.brand];

  const set = {};
  for (let i = 0; i < list.length; i++) {
    const k = st_normBrandKey_(list[i]);
    if (k) set[k] = true;
  }
  return set;
}

function st_searchPage_(userKey, params) {
  const uk = String(userKey || '').trim();
  const orderSs = sh_getOrderSs_();
  const products = pr_readProducts_();
  const maps = st_buildStatusMaps_(orderSs);
  return st_applyFiltersAndSort_(products, maps, uk, params || {});
}

function st_buildDigestMap_(orderSs, userKey, ids) {
  const now = u_nowMs_();
  const maps = st_buildStatusMaps_(orderSs);
  const out = {};
  const list = u_unique_(u_normalizeIds_(ids || []));

  for (let i = 0; i < list.length; i++) {
    const id = list[i];

    if (maps.openSet && maps.openSet[id]) {
      out[id] = { status: '依頼中', heldByOther: false, untilMs: 0 };
      continue;
    }

    const h = maps.holds ? maps.holds[id] : null;
    if (h && u_toInt_(h.untilMs, 0) > now) {
      const other = String(h.userKey || '') && String(h.userKey || '') !== String(userKey || '');
      out[id] = { status: '確保中', heldByOther: other, untilMs: u_toInt_(h.untilMs, 0) };
      continue;
    }

    out[id] = { status: '在庫あり', heldByOther: false, untilMs: 0 };
  }

  return out;
}

/**
 * ステータスキャッシュ無効化
 */
function st_invalidateStatusCache_(orderSs) {
  const cache = CacheService.getScriptCache();
  const ssId = orderSs.getId();
  
  // 関連するキャッシュキーをすべて削除
  const keys = [
    'STATUS_CACHE_V1:' + ssId,
    'STATUS_CACHE_V2:' + ssId,
    'STATUS_CACHE_V3:' + ssId,
    'STATECACHE_V1:STATE_HOLDS_V4:' + ssId,
    'STATECACHE_V1:STATE_HOLDS_V5:' + ssId,
    'STATECACHE_V1:STATE_OPEN_V4:' + ssId,
    'STATECACHE_V1:STATE_OPEN_V5:' + ssId,
    'OPENSETV4:' + ssId,
    'OPENSETV5:' + ssId,
    'HOLDSETV4:' + ssId,
    'HOLDSETV5:' + ssId
  ];
  
  try { 
    cache.removeAll(keys); 
  } catch (e) {
    // キャッシュ削除失敗は無視
  }
}

/**
 * 依頼中セット（高速取得）- キャッシュ付き
 */
function st_getOpenSetFast_(orderSs) {
  const cache = CacheService.getScriptCache();
  const ck = 'OPENSETV5:' + orderSs.getId();
  const cached = cache.get(ck);
  
  if (cached) {
    try {
      const json = u_ungzipFromB64_(cached);
      const obj = JSON.parse(json);
      if (obj && typeof obj === 'object') return obj;
    } catch (e) { console.log('optional: open set cache parse: ' + (e.message || e)); }
  }

  const openState = st_getOpenState_(orderSs);
  const items = openState.items || {};
  const out = {};
  
  for (const id in items) {
    const it = items[id];
    // 依頼中ステータスのみをセットに含める（クローズされたものは除外）
    if (it && !u_isClosedStatus_(it.status)) {
      out[id] = true;
    }
  }

  try {
    // 他ユーザーの確保/依頼中をリアルタイムで反映するため、キャッシュは短めに設定（30秒）
    cache.put(ck, u_gzipToB64_(JSON.stringify(out)), 30);
  } catch (e) { console.log('optional: status cache put: ' + (e.message || e)); }
  return out;
}

// =====================================================
// スクリプトプロパティのクリーンアップ
// =====================================================

/**
 * 不要なスクリプトプロパティを削除
 * GASエディタから手動実行
 */
function cleanupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = Object.keys(all);

  console.log('総プロパティ数: ' + keys.length);

  // STATE_HOLDS と STATE_OPEN のチャンクを整理
  const metaKeys = {};
  const chunkKeys = [];
  const otherKeys = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key.indexOf(':META') !== -1) {
      // メタキー（保持する）
      const baseKey = key.replace(':META', '');
      metaKeys[baseKey] = all[key];
    } else if (key.indexOf(':CHUNK:') !== -1) {
      chunkKeys.push(key);
    } else {
      otherKeys.push(key);
    }
  }

  console.log('METAキー数: ' + Object.keys(metaKeys).length);
  console.log('CHUNKキー数: ' + chunkKeys.length);
  console.log('その他キー数: ' + otherKeys.length);

  // 有効なチャンクを特定
  const validChunks = {};
  for (const baseKey in metaKeys) {
    const meta = String(metaKeys[baseKey]).split('|');
    const ver = meta[0];
    const n = parseInt(meta[1], 10) || 0;
    for (let j = 0; j < n; j++) {
      validChunks[baseKey + ':CHUNK:' + ver + ':' + j] = true;
    }
  }

  // 無効なチャンクを削除
  let deleted = 0;
  for (let i = 0; i < chunkKeys.length; i++) {
    const key = chunkKeys[i];
    if (!validChunks[key]) {
      props.deleteProperty(key);
      deleted++;
    }
  }

  console.log('削除したチャンク数: ' + deleted);
  console.log('残りのプロパティ数: ' + (keys.length - deleted));
}

/**
 * すべてのSTATE関連プロパティを表示（デバッグ用）
 */
function listStateProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = Object.keys(all).filter(function(k) {
    return k.indexOf('STATE_') !== -1;
  });

  console.log('STATE関連プロパティ数: ' + keys.length);
  keys.sort().forEach(function(k) {
    const val = all[k];
    console.log(k + ' = ' + (val.length > 50 ? val.substring(0, 50) + '...' : val));
  });
}
