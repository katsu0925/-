// Util.gs
function app_measureOptLabel_(measureOpt) {
  const v = String(measureOpt || '');
  if (v === 'without') return '無し';
  if (v === 'with') return '付き';
  return '';
}

function app_buildTemplateText_(receiptNo, form, ids, totalCount, totalYen) {
  const f = form || {};
  const lines = [];
  lines.push('受付番号：' + String(receiptNo || ''));
  lines.push('会社名/氏名：' + String(f.companyName || ''));
  lines.push('メールアドレス：' + String(f.contact || ''));
  if (String(f.postal || '').trim()) lines.push('郵便番号：' + String(f.postal || ''));
  if (String(f.address || '').trim()) lines.push('住所：' + String(f.address || ''));
  if (String(f.phone || '').trim()) lines.push('電話番号：' + String(f.phone || ''));
  lines.push('採寸データ：' + app_measureOptLabel_(f.measureOpt));
  if (String(f.note || '').trim()) lines.push('備考：' + String(f.note || '').trim());
  lines.push('合計点数：' + String(totalCount || 0) + '点');
  lines.push('合計金額：' + u_formatYen_(totalYen));
  return lines.join('\n');
}

function u_toHalfWidth_(s) {
  let str = String(s == null ? '' : s);
  str = str.replace(/\u3000/g, ' ');
  str = str.replace(/[！-～]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  return str;
}

function u_kataToHira_(s) {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x30A1 && code <= 0x30F6) out += String.fromCharCode(code - 0x60);
    else out += str.charAt(i);
  }
  return out;
}

function u_normSearch_(s) {
  let str = u_toHalfWidth_(s);
  str = str.toLowerCase();
  str = u_kataToHira_(str);
  str = str.replace(/[ーｰ]/g, '');
  str = str.replace(/[\s　]+/g, '');
  str = str.replace(/[^\wぁ-ん]/g, '');
  return str;
}

function u_normSearchText_(v) {
  let s = String(v == null ? '' : v);
  try { s = s.normalize('NFKC'); } catch (e) { console.log('optional: NFKC normalize: ' + (e.message || e)); }
  s = s.toLowerCase();
  s = s.replace(/\u3000/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function u_normSearchTextCompact_(v) {
  let s = u_normSearchText_(v);
  s = s.replace(/\s+/g, '');
  s = s.replace(/[’'"/\\.,，。、・\-＿_]/g, '');
  return s;
}

function u_toHiragana_(v) {
  const s = String(v == null ? '' : v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30A1 && c <= 0x30F6) out += String.fromCharCode(c - 0x60);
    else out += s.charAt(i);
  }
  return out;
}

function u_toKatakana_(v) {
  const s = String(v == null ? '' : v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x3041 && c <= 0x3096) out += String.fromCharCode(c + 0x60);
    else out += s.charAt(i);
  }
  return out;
}

function u_hasLatin_(v) {
  const s = String(v == null ? '' : v);
  return /[A-Za-z]/.test(s);
}

function u_kanaCandidatesFetch_(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const url = 'https://inputtools.google.com/request?itc=ja-t-i0-und&num=10&cp=0&cs=1&ie=utf-8&oe=utf-8&text=' + encodeURIComponent(t);

  let res;
  try {
    res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
  } catch (e) {
    return [];
  }

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) return [];

  let json;
  try {
    json = JSON.parse(res.getContentText('UTF-8'));
  } catch (e) {
    return [];
  }

  if (!json || json[0] !== 'SUCCESS') return [];
  const items = json[1];
  if (!items || !items.length || !items[0] || !items[0][1]) return [];

  const cands = items[0][1];
  const out = [];
  const seen = {};

  for (let i = 0; i < cands.length; i++) {
    const s = String(cands[i] || '').trim();
    if (!s) continue;
    const n = u_normSearchText_(s);
    if (!n) continue;
    if (!seen[n]) {
      seen[n] = true;
      out.push(s);
    }
  }

  return out;
}

function u_kanaCandidatesCachedSafe_(text, budget) {
  const t = String(text || '').trim();
  if (!t) return [];

  const key = 'KANA_V2:' + u_normSearchText_(t);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    try {
      const a = JSON.parse(cached);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  const b = budget || null;
  if (!b) return [];
  if (b.fetchCount >= b.maxFetch) return [];
  if ((Date.now() - b.startMs) > b.maxMs) return [];

  const arr = u_kanaCandidatesFetch_(t);
  b.fetchCount++;

  try { cache.put(key, JSON.stringify(arr), 21600); } catch (e) { console.log('optional: kana candidates cache put: ' + (e.message || e)); }
  return arr;
}

function st_getSynonymMaps_(products) {
  const tz = Session.getScriptTimeZone();
  const day = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const ck = 'SYN_MAP_V2:' + day;

  const cache = CacheService.getScriptCache();
  const cached = cache.get(ck);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { console.log('optional: synonym cache parse: ' + (e.message || e)); }
  }

  const aliasToCanon = {};
  const canonToAliases = {};

  function addPair_(canon, alias) {
    const c1 = u_normSearchText_(canon);
    const c2 = u_normSearchTextCompact_(canon);
    const a1 = u_normSearchText_(alias);
    const a2 = u_normSearchTextCompact_(alias);
    if (!c1 || !a1) return;

    const canonKeys = u_unique_([c1, c2]).filter(Boolean);
    const aliasKeys = u_unique_([
      a1, a2,
      u_normSearchText_(u_toHiragana_(alias)),
      u_normSearchText_(u_toKatakana_(alias)),
      u_normSearchTextCompact_(u_toHiragana_(alias)),
      u_normSearchTextCompact_(u_toKatakana_(alias))
    ]).filter(Boolean);

    for (let i = 0; i < aliasKeys.length; i++) aliasToCanon[aliasKeys[i]] = c1;
    for (let i = 0; i < canonKeys.length; i++) aliasToCanon[canonKeys[i]] = c1;

    if (!canonToAliases[c1]) canonToAliases[c1] = {};
    for (let i = 0; i < aliasKeys.length; i++) canonToAliases[c1][aliasKeys[i]] = true;
    for (let i = 0; i < canonKeys.length; i++) canonToAliases[c1][canonKeys[i]] = true;
  }

  try {
    const ssid = String(APP_CONFIG && APP_CONFIG.data && APP_CONFIG.data.spreadsheetId ? APP_CONFIG.data.spreadsheetId : '');
    if (ssid) {
      const ss = SpreadsheetApp.openById(ssid);
      const sh = ss.getSheetByName('ブランド別名');
      if (sh) {
        const lastRow = sh.getLastRow();
        if (lastRow >= 2) {
          const values = sh.getRange(2, 1, lastRow - 1, 2).getValues();
          for (let i = 0; i < values.length; i++) {
            const canon = String(values[i][0] || '').trim();
            const aliasesRaw = String(values[i][1] || '').trim();
            if (!canon) continue;

            addPair_(canon, canon);

            if (!aliasesRaw) continue;
            const aliases = aliasesRaw.split(/[、,]/g).map(x => String(x || '').trim()).filter(Boolean);
            for (let j = 0; j < aliases.length; j++) addPair_(canon, aliases[j]);
          }
        }
      }
    }
  } catch (e) {
    console.error('ブランド別名シートの読み込みエラー: ' + e.message);
  }

  const out = { aliasToCanon: aliasToCanon, canonToAliases: {} };
  for (const c in canonToAliases) out.canonToAliases[c] = Object.keys(canonToAliases[c]);

  try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) { console.log('optional: synonym cache put: ' + (e.message || e)); }
  return out;
}

function u_expandKeywordNeedles_(keyword, synonymMaps) {
  const raw = String(keyword || '').trim();
  if (!raw) return [];

  const syn = synonymMaps || { aliasToCanon: {}, canonToAliases: {} };
  const set = {};
  const list = [];

  function add_(s) {
    const n1 = u_normSearchText_(s);
    const n2 = u_normSearchTextCompact_(s);

    if (n1 && !set['n:' + n1]) {
      set['n:' + n1] = true;
      list.push({ n: n1, c: u_normSearchTextCompact_(n1) });
    }
    if (n2 && !set['c:' + n2]) {
      set['c:' + n2] = true;
      list.push({ n: u_normSearchText_(n2), c: n2 });
    }
  }

  add_(raw);
  add_(u_toHiragana_(raw));
  add_(u_toKatakana_(raw));

  if (u_hasLatin_(raw)) {
    const budget = { startMs: Date.now(), maxMs: 2500, maxFetch: 1, fetchCount: 0 };
    const ks = u_kanaCandidatesCachedSafe_(raw, budget);
    for (let i = 0; i < ks.length; i++) {
      add_(ks[i]);
      add_(u_toHiragana_(ks[i]));
      add_(u_toKatakana_(ks[i]));
    }
  }

  const baseKeys = u_unique_([
    u_normSearchText_(raw),
    u_normSearchTextCompact_(raw),
    u_normSearchText_(u_toHiragana_(raw)),
    u_normSearchText_(u_toKatakana_(raw)),
    u_normSearchTextCompact_(u_toHiragana_(raw)),
    u_normSearchTextCompact_(u_toKatakana_(raw))
  ]).filter(Boolean);

  for (let i = 0; i < baseKeys.length; i++) {
    const k = baseKeys[i];
    const canon = syn.aliasToCanon ? syn.aliasToCanon[k] : '';
    if (canon) {
      add_(canon);
      const aliases = (syn.canonToAliases && syn.canonToAliases[canon]) ? syn.canonToAliases[canon] : [];
      for (let j = 0; j < aliases.length; j++) add_(aliases[j]);
    } else if (syn.canonToAliases && syn.canonToAliases[k]) {
      const aliases = syn.canonToAliases[k];
      add_(k);
      for (let j = 0; j < aliases.length; j++) add_(aliases[j]);
    }
  }

  return list;
}

// =====================================================
// 共通ユーティリティ: ヘッダー列検索
// =====================================================

/**
 * ヘッダー行から指定名の列インデックスを検索（0-based）
 * 複数のファイルで重複していた findCol() を統合
 * @param {Array} headers - ヘッダー行の配列
 * @param {Array<string>} names - 検索する列名の候補配列
 * @returns {number} - 見つかった列の0-basedインデックス、見つからない場合 -1
 */
function u_findCol_(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    for (var j = 0; j < names.length; j++) {
      if (h === names[j] || h.indexOf(names[j]) !== -1) return i;
    }
  }
  return -1;
}

// =====================================================
// HTML メールテンプレートビルダー
// =====================================================

/**
 * HTMLメールを構築
 * @param {object} opts
 * @param {string} opts.greeting - 挨拶（例: "○○ 様"）
 * @param {string} opts.lead - リード文（HTML可、\nは<br>変換）
 * @param {Array} opts.sections - [{title, rows:[{label,value}], text, items:[string]}]
 * @param {object} opts.cta - {text, url}
 * @param {Array<string>} opts.notes - 注意書き
 * @param {string} opts.unsubscribe - 配信停止URL
 * @returns {string} HTML文字列
 */
function buildHtmlEmail_(opts) {
  var sn = 'デタウリ.Detauri';
  var su = 'https://wholesale.nkonline-tool.com/';
  var ce = '';
  try { sn = SITE_CONSTANTS.SITE_NAME || sn; } catch(e){}
  try { su = SITE_CONSTANTS.SITE_URL || su; } catch(e){}
  try { ce = SITE_CONSTANTS.CONTACT_EMAIL || ce; } catch(e){}
  var e_ = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var nl2br = function(s){ return e_(s).replace(/\n/g,'<br>'); };

  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
    + '<body style="margin:0;padding:0;background:#f4f4f7;font-family:\'Helvetica Neue\',Arial,\'Hiragino Kaku Gothic ProN\',Meiryo,sans-serif;-webkit-text-size-adjust:100%;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;"><tr><td align="center" style="padding:24px 8px;">'
    + '<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">'
    + '<tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 24px;text-align:center;">'
    + '<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px;">' + e_(sn) + '</span></td></tr>'
    + '<tr><td style="padding:28px 24px 20px;">';

  if (opts.greeting) h += '<p style="font-size:15px;color:#333;margin:0 0 16px;line-height:1.7;">' + e_(opts.greeting) + '</p>';
  if (opts.lead) h += '<p style="font-size:14px;color:#444;margin:0 0 20px;line-height:1.7;">' + nl2br(opts.lead) + '</p>';

  if (opts.sections) {
    for (var i = 0; i < opts.sections.length; i++) {
      var s = opts.sections[i];
      h += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f9fb;border-radius:8px;margin:12px 0;border-left:4px solid #1a1a2e;">';
      if (s.title) h += '<tr><td style="padding:12px 16px 4px;font-size:13px;font-weight:700;color:#1a1a2e;">' + e_(s.title) + '</td></tr>';
      if (s.rows) {
        for (var r = 0; r < s.rows.length; r++) {
          h += '<tr><td style="padding:3px 16px;font-size:13px;line-height:1.6;color:#444;">'
            + '<span style="color:#888;">' + e_(s.rows[r].label) + '：</span>' + (s.rows[r].html ? s.rows[r].value : e_(s.rows[r].value)) + '</td></tr>';
        }
        h += '<tr><td style="padding:0 0 8px;"></td></tr>';
      }
      if (s.text) h += '<tr><td style="padding:4px 16px 12px;font-size:13px;line-height:1.7;color:#444;">' + nl2br(s.text) + '</td></tr>';
      if (s.link) h += '<tr><td style="padding:4px 16px 12px;"><a href="' + s.link.url + '" style="font-size:13px;color:#1a73e8;text-decoration:none;">' + e_(s.link.text || s.link.url) + '</a></td></tr>';
      if (s.items) {
        for (var it = 0; it < s.items.length; it++) {
          h += '<tr><td style="padding:2px 16px;font-size:12px;color:#555;line-height:1.5;">' + e_(s.items[it]) + '</td></tr>';
        }
        h += '<tr><td style="padding:0 0 8px;"></td></tr>';
      }
      h += '</table>';
    }
  }

  if (opts.cta) {
    var ctas = Array.isArray(opts.cta) ? opts.cta : [opts.cta];
    h += '<div style="text-align:center;margin:24px 0;">';
    for (var ci = 0; ci < ctas.length; ci++) {
      if (!ctas[ci]) continue;
      var bg = ctas[ci].tertiary ? '#6b7280' : (ctas[ci].secondary ? '#1a73e8' : '#e53e3e');
      if (ci > 0) h += '<div style="height:12px;"></div>';
      h += '<a href="' + ctas[ci].url + '" style="display:block;width:80%;margin:0 auto;background:' + bg + ';color:#ffffff;padding:14px 0;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;text-align:center;">'
        + e_(ctas[ci].text) + '</a>';
    }
    h += '</div>';
  }

  if (opts.notes) {
    h += '<div style="margin:20px 0 0;padding:12px 0;border-top:1px solid #eee;">';
    for (var n = 0; n < opts.notes.length; n++) {
      h += '<p style="font-size:11px;color:#999;margin:2px 0;line-height:1.5;">' + e_(opts.notes[n]) + '</p>';
    }
    h += '</div>';
  }

  h += '</td></tr>'
    + '<tr><td style="padding:16px 24px;text-align:center;background:#fafafa;border-top:1px solid #eee;">'
    + '<p style="font-size:11px;color:#999;margin:0;line-height:1.6;">'
    + e_(sn) + '<br><a href="' + su + '" style="color:#1a73e8;text-decoration:none;">' + su + '</a><br>'
    + 'お問い合わせ: ' + e_(ce) + '</p>';
  if (opts.unsubscribe) {
    h += '<p style="font-size:10px;color:#bbb;margin:8px 0 0;"><a href="' + opts.unsubscribe + '" style="color:#bbb;">メルマガ配信停止</a></p>';
  }
  h += '</td></tr></table></td></tr></table></body></html>';
  return h;
}

