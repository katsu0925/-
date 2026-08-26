/* =========================================================
   NKonline — 共通スクリプト
   スクロール演出 / stickyナビ / ハンバーガー / フォーム補助
   ========================================================= */
(function () {
  'use strict';

  /* --- 端末の「動きを減らす」設定を尊重する --- */
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };

  /* --- スクロールでヘッダーを白背景に切替 --- */
  var onScroll = function () {
    document.body.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* --- ヒーロー見出しを 1 行ずつに分解（<br> で区切る） --- */
  var h1 = document.querySelector('.hero h1[data-rv]');
  if (h1 && !reduce) {
    var lines = [], cur = [];
    Array.prototype.slice.call(h1.childNodes).forEach(function (n) {
      if (n.nodeName === 'BR') { lines.push(cur); cur = []; } else { cur.push(n); }
    });
    lines.push(cur);
    h1.textContent = '';
    lines.forEach(function (nodes, i) {
      var outer = document.createElement('span');
      outer.className = 'hline';
      var inner = document.createElement('span');
      inner.className = 'hline-i';
      nodes.forEach(function (n) { inner.appendChild(n); });
      outer.appendChild(inner);
      outer.style.setProperty('--hi', i);
      h1.appendChild(outer);
    });
    h1.classList.add('lines');
  }

  /* --- スクロールリビール（[data-rv] に .seen を付与） --- */
  var reveals = document.querySelectorAll('[data-rv]');

  /* 同じ親を持つ要素どうしは 0.06 秒ずつ順番をずらす（一斉に出さない） */
  var groups = [];
  Array.prototype.forEach.call(reveals, function (el) {
    var p = el.parentNode, g = null;
    for (var i = 0; i < groups.length; i++) { if (groups[i].p === p) { g = groups[i]; break; } }
    if (!g) { g = { p: p, items: [] }; groups.push(g); }
    g.items.push(el);
  });
  groups.forEach(function (g) {
    if (g.items.length < 2) return;
    g.items.forEach(function (el, i) {
      if (/\bd[123]\b/.test(el.className)) return;   /* 手動で遅延指定済みの要素は触らない */
      el.style.setProperty('--rvi', Math.min(i, 7));
    });
  });

  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('seen');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('seen'); });
  }

  /* --- 背景画像の視差：スクロール量に対して 8% だけ遅れて動かす --- */
  var bgs = document.querySelectorAll('.hero .bg, .cta-band .bg');
  if (bgs.length && !reduce) {
    var ticking = false;
    var place = function () {
      var vh = window.innerHeight || 1;
      Array.prototype.forEach.call(bgs, function (bg) {
        var r = bg.parentNode.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var prog = (vh - r.top) / (vh + r.height);
        prog = Math.max(0, Math.min(1, prog));
        bg.style.transform = 'translate3d(0,' + ((prog - 0.5) * 8).toFixed(2) + '%,0)';
      });
      ticking = false;
    };
    var request = function () { if (!ticking) { ticking = true; raf(place); } };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    place();
  }

  /* --- 数字：画面に入った瞬間に一度だけ 0 から数え上げる --- */
  var numHosts = document.querySelectorAll('.plan .pprice, .fnum, .srow .sfact b');
  if (numHosts.length) {
    var findNumNode = function (el) {
      if (!document.createTreeWalker) return null;
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false), n;
      while ((n = w.nextNode())) { if (/[0-9][0-9,]{2,}/.test(n.nodeValue)) return n; }
      return null;
    };
    var countUp = function (span) {
      var target = parseInt(span.getAttribute('data-to'), 10), t0 = null, dur = 900;
      var fin = target.toLocaleString('ja-JP');
      var step = function (ts) {
        if (typeof ts !== 'number') ts = Date.now();
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var e = 1 - Math.pow(1 - p, 4);
        span.textContent = (p < 1) ? Math.round(target * e).toLocaleString('ja-JP') : fin;
        if (p < 1) raf(step);
      };
      raf(step);
      /* 描画が間引かれても、金額が途中の値で止まらないよう必ず最終値に揃える */
      setTimeout(function () { if (span.textContent !== fin) span.textContent = fin; }, dur + 400);
    };
    var ioNum = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { ioNum.unobserve(e.target); countUp(e.target); }
      });
    }, { threshold: 0.6 }) : null;

    Array.prototype.forEach.call(numHosts, function (el) {
      var tn = findNumNode(el);
      if (!tn) return;
      var m = tn.nodeValue.match(/[0-9][0-9,]*/);
      var target = parseInt(m[0].replace(/,/g, ''), 10);
      if (!(target >= 100)) return;                       /* 「1点」などは数え上げない */
      var pre = tn.nodeValue.slice(0, m.index);
      var post = tn.nodeValue.slice(m.index + m[0].length);
      var span = document.createElement('span');
      span.className = 'cnum';
      span.textContent = m[0];
      span.setAttribute('data-to', target);
      var frag = document.createDocumentFragment();
      if (pre) frag.appendChild(document.createTextNode(pre));
      frag.appendChild(span);
      if (post) frag.appendChild(document.createTextNode(post));
      tn.parentNode.replaceChild(frag, tn);
      if (reduce || !ioNum) return;
      var w = span.offsetWidth;                            /* 数字が伸びても幅がぶれないよう固定 */
      if (w) span.style.minWidth = w + 'px';
      span.textContent = '0';
      ioNum.observe(span);
    });
  }

  /* --- ハンバーガーメニュー --- */
  var burger = document.querySelector('.burger');
  if (burger) {
    burger.addEventListener('click', function () {
      document.body.classList.toggle('menu-open');
    });
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('menu-open');
      });
    });
  }

  /* --- お問い合わせ：URLの ?topic= で相談種類をプリセット --- */
  var subj = document.getElementById('subject');
  if (subj && 'URLSearchParams' in window) {
    var topic = new URLSearchParams(location.search).get('topic');
    var topicMap = {
      fukugyo: '古着卸売（副業支援）について',
      shien: 'AI導入支援について',
      ai: '生成AIシステム開発について',
      web: 'ホームページ制作について',
      other: 'その他・複数のサービスについて'
    };
    if (topic && topicMap[topic]) subj.value = topicMap[topic];
  }

  /* --- お問い合わせ：送信中はボタンにスピナー表示 --- */
  var form = document.querySelector('form[name="contact"]');
  if (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.classList.add('loading');
    });
  }

  /* --- 現在年をフッターに反映 --- */
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
