/* =========================================================
   NKonline — 配布資料 共通スクリプト
   プロンプトのコピー / 印刷
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

})();
