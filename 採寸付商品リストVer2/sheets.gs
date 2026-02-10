function u_toInt_(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? (def || 0) : n;
}

function u_toNumber_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function u_formatYen_(n) {
  const x = Math.round(u_toNumber_(n));
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

function u_sanitizeForSheet_(v) {
  let s = String(v == null ? '' : v);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const t = s.trim();
  if (!t) return '';
  const c = t.charAt(0);
  if (c === '=' || c === '+' || c === '-' || c === '@') return "'" + t;
  return t;
}

function u_normalizeId_(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.charAt(0) === "'") s = s.slice(1);
  return s.trim();
}

function u_normalizeIds_(ids) {
  if (!ids) return [];
  if (!Array.isArray(ids)) ids = [ids];
  const result = [];
  for (let i = 0; i < ids.length; i++) {
    const s = String(ids[i] || '').trim();
    if (s) result.push(s);
  }
  return result;
}

function app_holdMs_() {
  const min = (APP_CONFIG && APP_CONFIG.holds && APP_CONFIG.holds.minutes) 
    ? Number(APP_CONFIG.holds.minutes) : 15;
  return min * 60 * 1000;
}

function u_unique_(arr) {
  const seen = {};
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!seen[v]) {
      seen[v] = true;
      result.push(v);
    }
  }
  return result;
}

function u_splitManagedId_(id) {
  const s = u_normalizeId_(id);
  const m = s.match(/^(.*?)(\d+)\s*$/);
  if (!m) return { prefix: s, num: 0 };
  return { prefix: m[1], num: parseInt(m[2], 10) || 0 };
}

function u_compareManagedId_(a, b) {
  const pa = u_splitManagedId_(a);
  const pb = u_splitManagedId_(b);
  const c = pa.prefix.localeCompare(pb.prefix, 'en');
  if (c !== 0) return c;
  return pa.num - pb.num;
}

function u_sortManagedIds_(ids) {
  const list = (ids || []).slice();
  list.sort((a, b) => u_compareManagedId_(a, b));
  return list;
}

function u_makeReceiptNo_() {
  const tz = Session.getScriptTimeZone();
  const base = Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss');
  const rnd = Math.floor(Math.random() * 900 + 100);
  return base + '-' + rnd;
}

function u_parseSelectionList_(s) {
  const raw = String(s || '');
  if (!raw) return [];
  const parts = raw.split(/[、,]/g);
  return u_sortManagedIds_(u_unique_(u_normalizeIds_(parts)));
}

function u_isClosedStatus_(status) {
  const s = String(status || '').trim();
  const closed = APP_CONFIG.statuses.closed || [];
  for (let i = 0; i < closed.length; i++) if (s === closed[i]) return true;
  return false;
}

function u_gzipToB64_(s) {
  const blob = Utilities.newBlob(String(s), 'application/json', 'x.json');
  const gz = Utilities.gzip(blob);
  return Utilities.base64Encode(gz.getBytes());
}

function u_ungzipFromB64_(b64) {
  const bytes = Utilities.base64Decode(String(b64 || ''));
  const blob = Utilities.newBlob(bytes, 'application/gzip', 'x.gz');
  const unz = Utilities.ungzip(blob);
  return unz.getDataAsString('UTF-8');
}

function u_nowMs_() {
  return Date.now();
}
