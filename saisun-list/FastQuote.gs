function webQuoteAddFast(itemId, sessionId) {
  itemId = String(itemId || "").trim();
  sessionId = String(sessionId || "").trim();
  if (!itemId || !sessionId) return { ok: false, error: "invalid" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: "busy" };

  try {
    var now = Date.now();
    var hold = getHoldFast_(itemId, now);
    if (hold && hold.exp > now && hold.sid && hold.sid !== sessionId) {
      return { ok: false, conflict: true, expiresAt: hold.exp };
    }

    var holdMinutes = getHoldMinutesFast_();
    var exp = now + holdMinutes * 60 * 1000;
    setHoldFast_(itemId, { sid: sessionId, exp: exp }, holdMinutes);

    var cart = getCartFast_(sessionId);
    if (!cart.items) cart.items = [];
    if (cart.items.indexOf(itemId) === -1) cart.items.push(itemId);
    cart.updated = now;
    setCartFast_(sessionId, cart);

    return { ok: true, expiresAt: exp, cartCount: cart.items.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function webQuoteRemoveFast(itemId, sessionId) {
  itemId = String(itemId || "").trim();
  sessionId = String(sessionId || "").trim();
  if (!itemId || !sessionId) return { ok: false, error: "invalid" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: "busy" };

  try {
    var now = Date.now();
    var hold = getHoldFast_(itemId, now);
    if (hold && hold.exp > now && hold.sid && hold.sid !== sessionId) {
      return { ok: false, conflict: true, expiresAt: hold.exp };
    }

    delHoldFast_(itemId);

    var cart = getCartFast_(sessionId);
    var items = cart.items || [];
    var out = [];
    for (var i = 0; i < items.length; i++) if (items[i] !== itemId) out.push(items[i]);
    cart.items = out;
    cart.updated = now;
    setCartFast_(sessionId, cart);

    return { ok: true, cartCount: out.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function webQuoteGetFast(sessionId) {
  sessionId = String(sessionId || "").trim();
  if (!sessionId) return { ok: false, error: "invalid" };
  var cart = getCartFast_(sessionId);
  var items = cart.items || [];
  return { ok: true, items: items, cartCount: items.length };
}

function getHoldMinutesFast_() {
  try {
    if (typeof WEB_CONFIG === "object" && WEB_CONFIG && WEB_CONFIG.holdMinutes) {
      var n = Number(WEB_CONFIG.holdMinutes);
      if (isFinite(n) && n > 0) return n;
    }
  } catch (e) {}
  return 15;
}

function holdKeyFast_(itemId) {
  return "HOLD_VFAST_" + String(itemId);
}

function cartKeyFast_(sessionId) {
  return "CART_VFAST_" + String(sessionId);
}

function getHoldFast_(itemId, now) {
  var key = holdKeyFast_(itemId);
  var cache = CacheService.getScriptCache();
  var s = cache.get(key);

  if (!s) {
    var props = PropertiesService.getScriptProperties();
    s = props.getProperty(key) || "";
  }
  if (!s) return null;

  var obj = null;
  try { obj = JSON.parse(s); } catch (e) { obj = null; }
  if (!obj || !obj.exp) return null;

  if (Number(obj.exp) <= Number(now)) {
    delHoldFast_(itemId);
    return null;
  }
  return obj;
}

function setHoldFast_(itemId, rec, holdMinutes) {
  var key = holdKeyFast_(itemId);
  var s = JSON.stringify(rec);

  var cache = CacheService.getScriptCache();
  cache.put(key, s, Math.max(60, Math.floor(Number(holdMinutes) * 60)));

  var props = PropertiesService.getScriptProperties();
  props.setProperty(key, s);
}

function delHoldFast_(itemId) {
  var key = holdKeyFast_(itemId);
  var cache = CacheService.getScriptCache();
  cache.remove(key);

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(key);
}

function getCartFast_(sessionId) {
  var key = cartKeyFast_(sessionId);
  var cache = CacheService.getScriptCache();
  var s = cache.get(key);

  if (!s) {
    var props = PropertiesService.getScriptProperties();
    s = props.getProperty(key) || "";
  }

  if (!s) return { items: [], updated: 0 };

  var obj = null;
  try { obj = JSON.parse(s); } catch (e) { obj = null; }
  if (!obj || !obj.items) return { items: [], updated: 0 };
  return obj;
}

function setCartFast_(sessionId, cart) {
  var key = cartKeyFast_(sessionId);
  var s = JSON.stringify(cart);

  var cache = CacheService.getScriptCache();
  cache.put(key, s, 21600);

  var props = PropertiesService.getScriptProperties();
  props.setProperty(key, s);
}
