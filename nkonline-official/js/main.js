/* =========================================================
   NKonline — 共通スクリプト
   スクロール演出 / stickyナビ / ハンバーガー / フォーム補助
   ========================================================= */
(function () {
  'use strict';

  /* --- スクロールでヘッダーを白背景に切替 --- */
  var onScroll = function () {
    document.body.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* --- スクロールリビール（[data-rv] に .seen を付与） --- */
  var reveals = document.querySelectorAll('[data-rv]');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('seen');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('seen'); });
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
