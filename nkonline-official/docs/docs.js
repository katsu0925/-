/* =========================================================
   NKonline — 配布資料 共通スクリプト
   プロンプトのコピー / 印刷 / 発表モード
   ========================================================= */
(function () {
  'use strict';

  /* --- コピーボタン：直後の <pre> の中身をクリップボードへ --- */
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.pc');
      var pre = card && card.querySelector('pre');
      if (!pre) return;
      var text = pre.innerText;
      var done = function () {
        var before = btn.textContent;
        btn.textContent = 'コピーしました';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = before; btn.classList.remove('done'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  });

  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 何もしない */ }
    document.body.removeChild(ta);
  }

  /* --- 印刷（PDF保存）ボタン --- */
  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });

  /* --- 発表モード：1枚ずつ表示して ← → で送る --- */
  var deck = document.querySelector('.deck');
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  var idx = 0;

  var show = function (i) {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (s, n) { s.classList.toggle('now', n === idx); });
    var c = document.querySelector('[data-counter]');
    if (c) c.textContent = (idx + 1) + ' / ' + slides.length;
  };

  var enter = function () {
    document.body.classList.add('present');
    show(0);
    window.scrollTo(0, 0);
  };
  var leave = function () {
    document.body.classList.remove('present');
    slides.forEach(function (s) { s.classList.remove('now'); });
    if (slides[idx]) slides[idx].scrollIntoView({ block: 'start' });
  };

  document.querySelectorAll('[data-present]').forEach(function (b) {
    b.addEventListener('click', enter);
  });
  document.querySelectorAll('[data-leave]').forEach(function (b) {
    b.addEventListener('click', leave);
  });

  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('present')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'Escape') { leave(); }
  });
})();
