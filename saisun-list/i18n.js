/* ============================================================================
 * i18n.js — デタウリ / アソート 多言語対応ランタイム
 * ----------------------------------------------------------------------------
 * 対応言語: ja(既定) / en / zh-CN
 * 方式    : 日本語の原文をキーにした辞書 + DOMテキストノード置換
 *           静的HTML・JSが生成したHTML・後から挿入されたDOMの全てをカバーする
 *           （MutationObserver で追従。日本語が消えた時点で不動点になるためループしない）
 * 既定    : 常に日本語。ブラウザ言語による自動判定は行わない（ユーザー指定の仕様）
 * URL     : ?lang=en / ?lang=zh-CN。localStorage にも保存し次回以降も維持する
 * 辞書    : i18n-en.js / i18n-zh-CN.js を必要になった時だけ遅延ロード
 *           （日本語のままの利用者は 1 バイトも余分に読み込まない）
 *
 * ※ このファイルは Cloudflare Pages が静的配信する。GASには push しない
 *    （.claspignore に登録済み。GAS側は index.html / BulkLP.html のローダーが
 *      絶対URLで読みに行くため、GAS用のミラーファイルは不要）
 * ==========================================================================*/
(function (global) {
  'use strict';
  // doWriteBulk_() が document.open()/write() で文書を作り直すため、
  // 「同じwindowだが別のdocument」なら初期化をやり直す必要がある
  if (global.__I18N__ && global.__I18N__._doc === document) return;
  var DICT_CACHE = global.__I18N_DICTS__ || (global.__I18N_DICTS__ = {});

  var VERSION      = '1';
  var STORAGE_KEY  = 'detauri_lang';
  var DEFAULT_LANG = 'ja';
  var ASSET_HOST   = 'https://wholesale.nkonline-tool.com';
  var WORKER_ORIGIN = 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
  var LANGS = [
    { code: 'ja',    label: '日本語' },
    { code: 'en',    label: 'English' },
    { code: 'zh-CN', label: '简体中文' }
  ];
  var SUPPORTED = { 'ja': 1, 'en': 1, 'zh-CN': 1 };

  // ひらがな・カタカナ・CJK漢字。ここに引っかからない文字列は翻訳対象外
  var HAS_JP    = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  var ATTR_KEYS = ['placeholder', 'title', 'alt', 'aria-label'];
  var ATTR_SEL  = '[placeholder],[title],[alt],[aria-label]';
  var SKIP_SEL  = 'script,style,textarea,noscript,[translate="no"],.notranslate';

  var cur      = DEFAULT_LANG;
  var strings  = {};
  var patterns = [];
  var observer = null;
  var booted   = false;
  var dynLoaded = false;
  var spaced   = false;      // 単語間に空白を要する言語か（en=true / ja,zh-CN=false）

  /* ---------------------------------------------------------------- utils */

  // 辞書キーの正規化。HTMLソースのインデントや改行を吸収する
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function readParam() {
    try {
      var m = /[?&]lang=([^&#]+)/.exec(global.location.search);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }
  function readStore() {
    try { return global.localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }
  function writeStore(v) {
    try { global.localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
  }

  function resolveLang() {
    var p = readParam();
    if (SUPPORTED[p]) { writeStore(p); return p; }
    var s = readStore();
    if (SUPPORTED[s]) return s;
    return DEFAULT_LANG;                      // ブラウザ言語では判定しない
  }

  function assetBase() {
    try {
      var h = global.location.hostname;
      if (/(?:nkonline-tool\.com|pages\.dev)$/.test(h) || h === 'localhost' || h === '127.0.0.1') return '';
    } catch (e) {}
    return ASSET_HOST;                        // GAS(iframe)からは絶対URLで取りに行く
  }

  /* ------------------------------------------------------------ translate */

  function lookup(raw) {
    var t = norm(raw);
    if (!t) return null;
    var hit = strings[t];
    if (hit != null) return hit;
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].re.test(t)) return t.replace(patterns[i].re, patterns[i].to);
    }
    return null;
  }
  function skipEl(el) {
    if (!el) return true;
    if (el.nodeType !== 1) el = el.parentNode;
    if (!el || el.nodeType !== 1) return true;
    if (el.closest) { try { return !!el.closest(SKIP_SEL); } catch (e) {} }
    while (el && el.nodeType === 1) {
      if (SKIP_TAGS[el.nodeName]) return true;
      if (el.getAttribute && el.getAttribute('translate') === 'no') return true;
      el = el.parentNode;
    }
    return false;
  }

  // 日本語は語間に空白を置かないため <strong> 等で分断された文が
  // 英語だと "gets50% OFF" のようにくっついてしまう。境界の空白を補う
  var INLINE_TAGS   = { SPAN:1, STRONG:1, B:1, EM:1, I:1, A:1, SMALL:1, U:1, MARK:1, CODE:1, LABEL:1, SUP:1, SUB:1, FONT:1 };
  var NEEDS_SPACE_L = /^[^\s)\]}.,!?;:%…、。」』]/;   // この文字で始まるなら左に空白が要る
  var NEEDS_SPACE_R = /[^\s([{「『“"'\u3000]$/;        // 直前がこの文字なら空白を挟む
  var LATIN          = /[A-Za-z0-9]/;

  // 隣接して表示される文字を1つ返す。<strong>等のインライン要素は跨いで探す
  function edgeChar(node, forward) {
    var cur = node;
    for (var depth = 0; cur && depth < 4; depth++) {
      var sib = forward ? cur.nextSibling : cur.previousSibling;
      while (sib) {
        if (sib.nodeType === 3 || (sib.nodeType === 1 && INLINE_TAGS[sib.nodeName])) {
          var t = sib.textContent || '';
          if (t) return forward ? t.charAt(0) : t.charAt(t.length - 1);
        } else if (sib.nodeType === 1) {
          return '';                          // ブロック要素の境目は詰めなくてよい
        }
        sib = forward ? sib.nextSibling : sib.previousSibling;
      }
      cur = cur.parentNode;                   // インラインの親なら1つ外側も見る
      if (!cur || cur.nodeType !== 1 || !INLINE_TAGS[cur.nodeName]) return '';
    }
    return '';
  }

  function padEdges(node, out, lead, trail) {
    if (!spaced || !out) return lead + out + trail;
    var first = out.charAt(0), last = out.charAt(out.length - 1);
    if (!lead && NEEDS_SPACE_L.test(first)) {
      var pc = edgeChar(node, false);
      if (pc && NEEDS_SPACE_R.test(pc) && (LATIN.test(pc) || LATIN.test(first))) lead = ' ';
    }
    if (!trail && NEEDS_SPACE_R.test(last)) {
      var nc = edgeChar(node, true);
      if (nc && NEEDS_SPACE_L.test(nc) && LATIN.test(nc)) trail = ' ';   // 右隣がまだ日本語なら触らない（あとで自分の左判定が入る）
    }
    return lead + out + trail;
  }

  // 傷・汚れ詳細のように誤訳が取引トラブルになりうる箇所は、日本語の原文も残す
  var ORIGINAL_LABEL = { en: 'Japanese original:', 'zh-CN': '日文原文：' };

  function keepOriginal(node, original) {
    var host = node.parentNode;
    if (!host || host.nodeType !== 1 || !host.closest) return;
    var box = host.closest('[data-i18n-keep-original]');
    if (!box || box.querySelector('.i18n-original')) return;
    var span = document.createElement('span');
    span.className = 'i18n-original';
    span.setAttribute('translate', 'no');   // ここを再翻訳させない
    span.textContent = (ORIGINAL_LABEL[cur] || '') + ' ' + original;
    box.appendChild(span);
  }

  function trText(node) {
    var v = node.nodeValue;
    if (!v || !HAS_JP.test(v)) return;
    var out = lookup(v);
    if (out == null) return;
    var lead  = /^\s*/.exec(v)[0];
    var trail = /\s*$/.exec(v)[0];
    var next  = padEdges(node, out, lead, trail);
    if (next === v) return;                   // 同値代入は再通知を招くので避ける
    var original = v.trim();
    node.nodeValue = next;
    keepOriginal(node, original);
  }

  function trAttrs(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    for (var i = 0; i < ATTR_KEYS.length; i++) {
      var k = ATTR_KEYS[i];
      var v = el.getAttribute(k);
      if (!v || !HAS_JP.test(v)) continue;
      var out = lookup(v);
      if (out != null && out !== v) el.setAttribute(k, out);
    }
    // <input type="button|submit|reset" value="送信">
    if (el.nodeName === 'INPUT') {
      var ty = (el.type || '').toLowerCase();
      if (ty === 'button' || ty === 'submit' || ty === 'reset') {
        var val = el.getAttribute('value');
        if (val && HAS_JP.test(val)) {
          var o2 = lookup(val);
          if (o2 != null && o2 !== val) el.setAttribute('value', o2);
        }
      }
    }
  }

  function applyTo(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipEl(root.parentNode)) trText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipEl(root)) return; trAttrs(root); }

    var tw, n, list = [];
    try {
      tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      while ((n = tw.nextNode())) list.push(n);
    } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      if (!skipEl(list[i].parentNode)) trText(list[i]);
    }
    if (root.querySelectorAll) {
      var els = root.querySelectorAll(ATTR_SEL);
      for (var j = 0; j < els.length; j++) if (!skipEl(els[j])) trAttrs(els[j]);
    }
  }

  function applyAll() {
    applyTo(document.documentElement);
    var t = document.title;
    if (t && HAS_JP.test(t)) { var o = lookup(t); if (o != null) document.title = o; }
  }

  /* ------------------------------------------------------------- observer */

  function startObserver() {
    if (!global.MutationObserver || observer) return;
    observer = new global.MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) applyTo(m.addedNodes[j]);
        } else if (m.type === 'characterData') {
          if (!skipEl(m.target.parentNode)) trText(m.target);
        } else if (m.type === 'attributes') {
          if (!skipEl(m.target)) trAttrs(m.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTR_KEYS
    });
  }

  /* ------------------------------------------------- alert / confirm 差替 */

  function wrapDialogs() {
    ['alert', 'confirm'].forEach(function (name) {
      var orig = global[name];
      if (typeof orig !== 'function' || orig.__i18nWrapped) return;
      var wrapped = function (msg) {
        try {
          if (typeof msg === 'string' && HAS_JP.test(msg)) {
            var o = lookup(msg);
            if (o != null) msg = o;
          }
        } catch (e) {}
        return orig.call(global, msg);
      };
      wrapped.__i18nWrapped = true;
      try { global[name] = wrapped; } catch (e) {}
    });
  }

  /* ----------------------------------------------------- 言語スイッチャUI */

  function injectStyle() {
    if (document.getElementById('i18nSwitchStyle')) return;
    var st = document.createElement('style');
    st.id = 'i18nSwitchStyle';
    st.textContent =
      '.i18n-switch{display:inline-flex;align-items:center;gap:4px;margin-left:auto;}' +
      '.i18n-switch svg{width:13px;height:13px;flex:0 0 auto;opacity:.85;}' +
      '.i18n-switch select{appearance:none;-webkit-appearance:none;background:transparent;' +
      'border:1px solid currentColor;border-radius:11px;color:inherit;font:inherit;font-size:11px;' +
      'line-height:1;padding:3px 18px 3px 7px;cursor:pointer;opacity:.9;}' +
      '.i18n-switch select:hover{opacity:1;}' +
      '.i18n-switch select option{color:#111;background:#fff;}' +
      '.i18n-switch-wrap{position:relative;display:inline-flex;align-items:center;}' +
      '.i18n-original{display:block;margin-top:6px;font-size:11px;line-height:1.5;opacity:.7;}' +
      '.i18n-switch-wrap::after{content:"";position:absolute;right:6px;top:50%;pointer-events:none;' +
      'width:0;height:0;margin-top:-1px;border-left:3px solid transparent;border-right:3px solid transparent;' +
      'border-top:4px solid currentColor;opacity:.7;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function buildSwitcher() {
    if (document.getElementById('i18nSwitch')) return;
    var host = document.querySelector('.topbar-row3') || document.querySelector('.header-row3');
    if (!host) return;
    injectStyle();

    var box = document.createElement('div');
    box.className = 'i18n-switch';
    box.id = 'i18nSwitch';
    box.setAttribute('translate', 'no');

    var globe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    globe.setAttribute('viewBox', '0 0 24 24');
    globe.setAttribute('fill', 'none');
    globe.setAttribute('stroke', 'currentColor');
    globe.setAttribute('stroke-width', '2');
    globe.setAttribute('aria-hidden', 'true');
    globe.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
                      '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>';

    var wrap = document.createElement('span');
    wrap.className = 'i18n-switch-wrap';

    var sel = document.createElement('select');
    sel.id = 'i18nSelect';
    sel.setAttribute('aria-label', 'Language / 言語 / 语言');
    for (var i = 0; i < LANGS.length; i++) {
      var op = document.createElement('option');
      op.value = LANGS[i].code;
      op.textContent = LANGS[i].label;
      if (LANGS[i].code === cur) op.selected = true;
      sel.appendChild(op);
    }
    sel.addEventListener('change', function () { switchTo(sel.value); });

    wrap.appendChild(sel);
    box.appendChild(globe);
    box.appendChild(wrap);
    host.appendChild(box);
  }

  // 翻訳は片方向（日本語→外国語）なので、切替は必ずリロードで作り直す
  function switchTo(lang) {
    if (!SUPPORTED[lang] || lang === cur) return;
    writeStore(lang);
    var url;
    try {
      url = new URL(global.location.href);
      url.searchParams.set('lang', lang);
      global.location.href = url.toString();
    } catch (e) {
      var s = global.location.search.replace(/([?&])lang=[^&]*/, '$1').replace(/[?&]$/, '');
      global.location.href = global.location.pathname +
        (s ? s + '&' : '?') + 'lang=' + encodeURIComponent(lang) + global.location.hash;
    }
  }

  // 同一オリジンのリンクに lang を引き継がせる（共有URLでも言語が保たれる）
  function hookLinks() {
    document.addEventListener('click', function (e) {
      if (cur === DEFAULT_LANG) return;
      var a = e.target;
      while (a && a.nodeType === 1 && a.nodeName !== 'A') a = a.parentNode;
      if (!a || a.nodeName !== 'A') return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel|data):/i.test(href)) return;
      try {
        var u = new URL(href, global.location.href);
        if (u.origin !== global.location.origin) return;
        if (u.searchParams.get('lang')) return;
        u.searchParams.set('lang', cur);
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (err) {}
    }, true);
  }

  /* ------------------------------------------------------------ dict load */

  function useDict(payload) {
    strings = payload.strings || {};
    patterns = [];
    var ps = payload.patterns || [];
    for (var i = 0; i < ps.length; i++) {
      try { patterns.push({ re: new RegExp(ps[i][0]), to: ps[i][1] }); } catch (e) {}
    }
  }

  global.__I18N_REGISTER__ = function (lang, payload) {
    if (!payload) return;
    DICT_CACHE[lang] = payload;
    if (lang === cur) useDict(payload);
  };

  // シート由来のテキスト（商品名・傷汚れ詳細・記事）の訳。Workerが配信する
  // 静的辞書（人手）を上書きしないよう、既にあるキーは触らない
  global.__I18N_REGISTER_DYNAMIC__ = function (lang, map) {
    if (lang !== cur || !map) return;
    var added = 0;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (strings[k] == null) { strings[k] = map[k]; added++; }
    }
    if (added && booted) applyAll();
  };

  function loadDict(lang, cb) {
    if (DICT_CACHE[lang]) { useDict(DICT_CACHE[lang]); cb(null); return; }
    var s = document.createElement('script');
    s.src = assetBase() + '/i18n-' + lang + '.js?v=' + VERSION;
    s.async = false;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('dict ' + lang + ' failed')); };
    (document.head || document.documentElement).appendChild(s);
  }

  // 商品データ・記事の訳。表示を止めたくないので静的辞書とは切り離して後追いで読む
  function loadDynamicDict(lang) {
    if (dynLoaded) return;
    dynLoaded = true;
    var s = document.createElement('script');
    s.src = WORKER_ORIGIN + '/i18n/dict/' + encodeURIComponent(lang) + '.js';
    s.async = true;
    s.onerror = function () {};
    (document.head || document.documentElement).appendChild(s);
  }

  /* ----------------------------------------------------------------- boot */

  function unveil() {
    var d = document.documentElement;
    if (d.classList) d.classList.remove('i18n-loading');
    else d.className = String(d.className).replace(/\bi18n-loading\b/g, '');
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function boot() {
    cur = resolveLang();
    spaced = (cur === 'en');
    try { document.documentElement.lang = cur; } catch (e) {}

    if (cur === DEFAULT_LANG) { onReady(buildSwitcher); return; }

    // 日本語のちらつきを抑える。読み込み失敗時も必ず表示に戻す多重の保険つき
    try {
      var d = document.documentElement;
      if (d.classList) d.classList.add('i18n-loading');
      var st = document.createElement('style');
      st.id = 'i18nVeil';
      st.textContent = 'html.i18n-loading body{visibility:hidden!important}';
      (document.head || d).appendChild(st);
    } catch (e) {}
    global.setTimeout(unveil, 1500);
    global.addEventListener('load', unveil);

    // URLに lang が無い（localStorage 由来）なら共有できるURLに直しておく
    if (!readParam()) {
      try {
        var u = new URL(global.location.href);
        u.searchParams.set('lang', cur);
        global.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
    }

    var dictDone = false, domDone = false;
    function go() {
      if (!dictDone || !domDone || booted) return;
      booted = true;
      injectStyle();
      try { applyAll(); } finally { unveil(); }
      startObserver();
      wrapDialogs();
      buildSwitcher();
      hookLinks();
      loadDynamicDict(cur);
    }
    loadDict(cur, function (err) {
      if (err) { cur = DEFAULT_LANG; unveil(); onReady(buildSwitcher); return; }
      dictDone = true; go();
    });
    onReady(function () { domDone = true; go(); });
  }

  global.__I18N__ = {
    _doc: document,
    lang: function () { return cur; },
    t: function (s) { var o = lookup(s); return o == null ? s : o; },
    apply: applyAll,
    switchTo: switchTo
  };

  boot();
})(window);
