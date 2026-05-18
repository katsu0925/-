// shiire-kanri マニュアル PDF ビルダー
//
// 使い方:
//   npm install     （初回のみ）
//   npm run build   （staff / admin 両方）
//   npm run build:staff
//   npm run build:admin
//
// 仕組み:
//   1. manual-{staff,admin}.md を marked で HTML 化
//   2. style.css を埋め込み、目次（TOC）を自動生成
//   3. 中間 HTML を /tmp に出力
//   4. Chrome headless で --print-to-pdf
//
// 依存:
//   - Node 18+
//   - macOS の Google Chrome (/Applications/Google Chrome.app/...)
//   - marked, marked-gfm-heading-id（package.json）

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, '.build');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TARGETS = {
  staff: {
    md: 'manual-staff.md',
    pdf: '外注向けマニュアル.pdf',
    html: '外注向けマニュアル.html',
    bodyClass: 'staff',
    title: '管理アプリ 外注向けマニュアル',
    subtitle: '商品管理 Web アプリの使い方',
  },
  admin: {
    md: 'manual-admin.md',
    pdf: '管理者向けマニュアル.pdf',
    html: '管理者向けマニュアル.html',
    bodyClass: 'admin',
    title: 'shiire-kanri 管理者向けマニュアル',
    subtitle: 'Web アプリ運用・GAS 実装・デプロイ手順',
  },
};

const args = process.argv.slice(2);
const which = args[0] && TARGETS[args[0]] ? [args[0]] : Object.keys(TARGETS);

const marked = new Marked({
  gfm: true,
  breaks: false,
});
marked.use(gfmHeadingId());

// 注記ボックス記法 :::note / :::warn / :::tip / :::danger
function transformAdmonitions(md) {
  return md.replace(
    /^:::(note|warn|tip|danger)\s*\n([\s\S]*?)\n:::\s*$/gm,
    (_, kind, body) => `<div class="${kind}">\n\n${body}\n\n</div>\n`
  );
}

// 画像参照のうちファイルが存在しないものは「画像予定」プレースホルダに置換
async function transformMissingImages(md) {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...md.matchAll(re)];
  let out = md;
  for (const m of matches) {
    const [full, alt, src] = m;
    if (src.startsWith('http')) continue;
    const abs = path.join(ROOT, src);
    try {
      await fs.access(abs);
    } catch {
      const placeholder = `<div class="img-placeholder">📷 ${alt || '画像'}（後日差し替え）</div>`;
      out = out.replace(full, placeholder);
    }
  }
  return out;
}

// HTML 配布用: <img src="..."> をすべて base64 data URI に変換
async function inlineImagesAsBase64(html) {
  const re = /<img([^>]*?)src="([^"]+)"([^>]*?)>/g;
  const matches = [...html.matchAll(re)];
  let out = html;
  for (const m of matches) {
    const [full, before, src, after] = m;
    if (src.startsWith('http') || src.startsWith('data:')) continue;
    const abs = path.isAbsolute(src) ? src : path.join(ROOT, src);
    try {
      const buf = await fs.readFile(abs);
      const ext = path.extname(abs).slice(1).toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
      out = out.replace(full, `<img${before}src="${dataUri}"${after}>`);
    } catch {}
  }
  return out;
}

const WEB_STYLE = `
@media screen {
  html, body { background: #f4f5f7; }
  body {
    max-width: 820px;
    margin: 0 auto 0 max(248px, calc(124px + (100vw - 884px) / 2));
    padding: 24px 32px 64px;
    background: #fff;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    min-height: 100vh;
    line-height: 1.95;
    font-size: 11pt;
  }
  body.staff, body.admin { background: #fff; }
  p { margin: 0 0 3.5mm 0; line-height: 1.95; }
  li { margin: 0 0 2mm 0; line-height: 1.9; }
  ul, ol { margin: 2mm 0 5mm; }
  h1, h2, h3, h4 { scroll-margin-top: 24px; }
  h2 { margin-top: 8mm; }
  h3, h4 { margin-top: 6mm; }
  /* 左サイドバー目次 */
  #sidebar {
    position: fixed;
    left: 0;
    top: 0;
    width: 248px;
    height: 100vh;
    overflow-y: auto;
    background: #1b2330;
    padding: 0 0 24px;
    box-sizing: border-box;
    z-index: 200;
  }
  #sidebar .nav-title {
    font-size: 13px;
    font-weight: bold;
    color: #fff;
    padding: 16px 18px 12px;
    line-height: 1.45;
    border-bottom: 1px solid #2c3a4f;
    margin-bottom: 6px;
  }
  #sidebar a {
    display: block;
    padding: 8px 18px;
    color: #cdd8e6;
    text-decoration: none;
    font-size: 13px;
    line-height: 1.45;
    border-left: 3px solid transparent;
    cursor: pointer;
  }
  #sidebar a:hover { background: #283447; color: #fff; }
  #sidebar a.active {
    background: #283447;
    color: #fff;
    border-left-color: #1f6feb;
    font-weight: bold;
  }
  /* モバイル用アプリバー・背景オーバーレイ（PC では非表示） */
  #appbar { display: none; }
  #navBackdrop { display: none; }
  /* クリックした章だけ表示 */
  .chapter { display: none; }
  .chapter.active { display: block; }
  .cover {
    min-height: 100vh;
    margin: -24px -32px 24px;
    padding: 48px 24px;
    page-break-after: auto;
    box-sizing: border-box;
    width: calc(100% + 64px);
    max-width: none;
  }
  .cover h1 {
    font-size: 22pt;
    line-height: 1.3;
    word-break: keep-all;
    overflow-wrap: break-word;
  }
  .cover .subtitle { font-size: 13pt; }
  .toc { page-break-after: auto; border-bottom: 1px solid #eee; padding-bottom: 16px; margin-bottom: 24px; }
  img {
    cursor: zoom-in;
    max-width: 100%;
    max-height: none;
    width: auto;
    transition: transform 0.15s ease;
  }
  img:hover { transform: scale(1.02); }
  .lightbox {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.92);
    z-index: 9999;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
    padding: 16px;
  }
  .lightbox.open { display: flex; }
  .lightbox img {
    max-width: 100%;
    max-height: 100%;
    cursor: zoom-out;
    border: none;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .lightbox .close {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    color: #fff;
    border: none;
    font-size: 20px;
    cursor: pointer;
  }
  /* 表は横スクロール可能なラッパで包む（スマホで横長表が切れない） */
  .table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 4mm 0;
    border-radius: 4px;
  }
  .table-scroll table { margin: 0; }
  /* 章末の「前へ／次へ」ナビ */
  .chapter-nav {
    display: flex;
    gap: 12px;
    margin: 48px 0 0;
    border-top: 1px solid #e5e8ec;
    padding-top: 20px;
  }
  .chapter-nav a {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 16px;
    min-height: 44px;
    border: 1px solid #d8dde5;
    border-radius: 8px;
    text-decoration: none;
    color: #1b2330;
    box-sizing: border-box;
    transition: border-color 0.15s, background 0.15s;
  }
  .chapter-nav a:hover { border-color: #1f6feb; background: #f5f9ff; }
  .chapter-nav a.next { text-align: right; align-items: flex-end; }
  .chapter-nav a.disabled { visibility: hidden; }
  .chapter-nav .cn-label { font-size: 11px; color: #8a93a0; }
  .chapter-nav .cn-title { font-size: 14px; font-weight: 600; }
  /* トップへ戻るボタン */
  #toTop {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #1f6feb;
    color: #fff;
    border: none;
    font-size: 20px;
    cursor: pointer;
    display: none;
    box-shadow: 0 3px 12px rgba(0,0,0,0.28);
    z-index: 230;
  }
  #toTop.show { display: block; }
  #toTop:hover { background: #1a5fd0; }
}
/* 配布 HTML をブラウザから印刷する場合は全章表示・サイドバー等を非表示 */
@media print {
  #sidebar, #appbar, #navBackdrop, #toTop, .chapter-nav { display: none !important; }
  .chapter { display: block !important; }
}
/* ───────── スマホ表示（ハンバーガー＋スライド式ドロワー目次） ───────── */
@media screen and (max-width: 820px) {
  html, body { font-size: 12.5pt; }
  body {
    max-width: 100%;
    margin: 0;
    padding: 68px 16px 56px;
    box-shadow: none;
    line-height: 1.9;
  }
  body.nav-lock { overflow: hidden; }
  /* 画面上部に固定するアプリバー */
  #appbar {
    display: flex;
    align-items: center;
    gap: 8px;
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 52px;
    padding: 0 10px;
    background: #1b2330;
    color: #fff;
    z-index: 250;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  #navToggle {
    width: 40px;
    height: 40px;
    flex: none;
    border: none;
    background: transparent;
    color: #fff;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    border-radius: 6px;
  }
  #navToggle:active { background: rgba(255,255,255,0.14); }
  #appbarTitle {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* サイドバーを左からスライドするドロワーに */
  #sidebar {
    width: 80vw;
    max-width: 320px;
    height: 100vh;
    padding: 52px 0 24px;
    z-index: 245;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 28px rgba(0,0,0,0.4);
  }
  #sidebar.open { transform: translateX(0); }
  #sidebar a { padding: 13px 18px; font-size: 14px; }
  #navBackdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 240;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
  }
  #navBackdrop.open { opacity: 1; pointer-events: auto; }
  /* 本文 */
  h1, h2, h3, h4 { scroll-margin-top: 64px; }
  .cover {
    min-height: 72vh;
    margin: -68px -16px 24px;
    width: calc(100% + 32px);
    padding: 84px 24px 48px;
  }
  .cover h1 { font-size: 19pt; }
  h1 { font-size: 18pt; }
  h2 { font-size: 14.5pt; }
  h3, h4 { font-size: 12.5pt; }
  pre { font-size: 8.5pt; }
  table { font-size: 9pt; }
  .cols { flex-direction: column; gap: 0; }
  .chapter-nav { gap: 8px; margin-top: 36px; }
  .chapter-nav a { padding: 10px 12px; }
  .chapter-nav .cn-title { font-size: 12.5px; }
  #toTop { right: 14px; bottom: 14px; }
}
`;

const LIGHTBOX_JS = `
(function(){
  var lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = '<button class="close" aria-label="閉じる">×</button><img alt="">';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img');
  function open(src, alt){
    lbImg.src = src;
    lbImg.alt = alt || '';
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close(){
    lb.classList.remove('open');
    document.body.style.overflow = '';
    lbImg.src = '';
  }
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t.tagName === 'IMG' && !t.closest('.lightbox') && !t.closest('.img-placeholder')) {
      e.preventDefault();
      open(t.src, t.alt);
    } else if (t === lb || t.classList.contains('close')) {
      close();
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') close();
  });
})();
`;

// 配布 HTML 用: 目次ドロワー + 章送り + トップへ戻る（画面表示のみ。印刷時は全章表示）
const SIDEBAR_JS = `
(function () {
  var body = document.body;
  var scriptAnchor = document.currentScript;
  var kids = [].slice.call(body.children);
  var chapters = [];
  var current = null;

  function startChapter(title) {
    var div = document.createElement('div');
    div.className = 'chapter';
    current = { el: div, title: title };
    chapters.push(current);
  }

  // body 直下の要素を章ごとに div.chapter へまとめる
  kids.forEach(function (el) {
    if (el.tagName === 'SCRIPT') return;
    if (el.tagName === 'SECTION' && el.classList.contains('cover')) {
      startChapter('表紙');
    } else if (el.tagName === 'SECTION' && el.classList.contains('toc')) {
      startChapter('目次');
    } else if (el.tagName === 'H1') {
      startChapter(el.textContent.trim());
    }
    if (current) current.el.appendChild(el);
  });
  chapters.forEach(function (ch) { body.insertBefore(ch.el, scriptAnchor); });

  // 横長の表は横スクロール可能なラッパで包む
  [].slice.call(document.querySelectorAll('table')).forEach(function (tbl) {
    if (tbl.parentElement && tbl.parentElement.classList.contains('table-scroll')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    tbl.parentNode.insertBefore(wrap, tbl);
    wrap.appendChild(tbl);
  });

  // モバイル用アプリバー・サイドバー・背景オーバーレイ
  var appbar = document.createElement('header');
  appbar.id = 'appbar';
  appbar.innerHTML = '<button id="navToggle" aria-label="目次を開く">☰</button><span id="appbarTitle"></span>';
  var backdrop = document.createElement('div');
  backdrop.id = 'navBackdrop';
  var nav = document.createElement('nav');
  nav.id = 'sidebar';
  var navTitle = document.createElement('div');
  navTitle.className = 'nav-title';
  navTitle.textContent = document.title;
  nav.appendChild(navTitle);

  function closeDrawer() {
    nav.classList.remove('open');
    backdrop.classList.remove('open');
    body.classList.remove('nav-lock');
  }
  function openDrawer() {
    nav.classList.add('open');
    backdrop.classList.add('open');
    body.classList.add('nav-lock');
  }

  function showChapter(i, headEl) {
    chapters.forEach(function (ch, idx) {
      var on = idx === i;
      ch.el.classList.toggle('active', on);
      if (ch.link) ch.link.classList.toggle('active', on);
    });
    var at = document.getElementById('appbarTitle');
    if (at) at.textContent = (i === 0) ? document.title : (chapters[i] ? chapters[i].title : document.title);
    closeDrawer();
    if (headEl && headEl.scrollIntoView) headEl.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }

  // サイドバーの章リンク
  chapters.forEach(function (ch, i) {
    var a = document.createElement('a');
    a.href = '#';
    a.textContent = ch.title;
    a.addEventListener('click', function (e) { e.preventDefault(); showChapter(i); });
    ch.link = a;
    nav.appendChild(a);
  });
  body.insertBefore(nav, body.firstChild);
  body.insertBefore(backdrop, body.firstChild);
  body.insertBefore(appbar, body.firstChild);

  // ハンバーガー開閉
  document.getElementById('navToggle').addEventListener('click', function () {
    if (nav.classList.contains('open')) closeDrawer(); else openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  // 各章末に「前へ／次へ」ナビを追加
  chapters.forEach(function (ch, i) {
    var navEl = document.createElement('div');
    navEl.className = 'chapter-nav';
    var prev = document.createElement('a');
    prev.className = 'prev';
    if (i > 0) {
      prev.href = '#';
      prev.innerHTML = '<span class="cn-label">← 前へ</span><span class="cn-title"></span>';
      prev.querySelector('.cn-title').textContent = chapters[i - 1].title;
      prev.addEventListener('click', function (e) { e.preventDefault(); showChapter(i - 1); });
    } else { prev.className += ' disabled'; }
    var next = document.createElement('a');
    next.className = 'next';
    if (i < chapters.length - 1) {
      next.href = '#';
      next.innerHTML = '<span class="cn-label">次へ →</span><span class="cn-title"></span>';
      next.querySelector('.cn-title').textContent = chapters[i + 1].title;
      next.addEventListener('click', function (e) { e.preventDefault(); showChapter(i + 1); });
    } else { next.className += ' disabled'; }
    navEl.appendChild(prev);
    navEl.appendChild(next);
    ch.el.appendChild(navEl);
  });

  // トップへ戻るボタン
  var toTop = document.createElement('button');
  toTop.id = 'toTop';
  toTop.setAttribute('aria-label', 'ページ上部へ');
  toTop.textContent = '↑';
  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  body.appendChild(toTop);
  window.addEventListener('scroll', function () {
    toTop.classList.toggle('show', window.scrollY > 400);
  }, { passive: true });

  // 見出し要素から該当章を表示（目次リンクから利用）
  window.__manualShowChapter = function (headEl) {
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].el.contains(headEl)) { showChapter(i, headEl); return true; }
    }
    return false;
  };

  // 目次ページ内の #id リンクをクリックしたら該当章へ
  [].slice.call(document.querySelectorAll('.toc a')).forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = (a.getAttribute('href') || '').replace('#', '');
      var target = id && document.getElementById(id);
      if (target) { e.preventDefault(); window.__manualShowChapter(target); }
    });
  });

  // 初期表示: URL ハッシュがあればその章、なければ表紙
  var shown = false;
  if (location.hash) {
    var t = document.getElementById(location.hash.replace('#', ''));
    if (t) shown = window.__manualShowChapter(t);
  }
  if (!shown) showChapter(0);
})();
`;

// H1/H2 から目次生成
function buildToc(html) {
  const re = /<h([1-2])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const items = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]);
    const id = m[2];
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    if (id === 'cover-title') continue;
    items.push({ level, id, text });
  }
  let lastLevel = 0;
  let out = '<section class="toc"><h1>目次</h1><ul>';
  for (const it of items) {
    const indent = '&nbsp;'.repeat((it.level - 1) * 4);
    const weight = it.level === 1 ? 'font-weight:600;' : '';
    out += `<li style="${weight}">${indent}<a href="#${it.id}">${it.text}</a></li>`;
    lastLevel = it.level;
  }
  out += '</ul></section>';
  return out;
}

async function buildOne(key) {
  const t = TARGETS[key];
  const mdPath = path.join(ROOT, t.md);
  const cssPath = path.join(ROOT, 'style.css');
  const tmpHtml = path.join(TMP, `${key}.html`);
  const outPdf = path.join(DIST, t.pdf);

  await fs.mkdir(TMP, { recursive: true });
  await fs.mkdir(DIST, { recursive: true });

  const md = await fs.readFile(mdPath, 'utf8');
  const mdImgFiltered = await transformMissingImages(md);
  const mdTransformed = transformAdmonitions(mdImgFiltered);
  const bodyHtml = marked.parse(mdTransformed);
  const toc = buildToc(bodyHtml);
  const css = await fs.readFile(cssPath, 'utf8');

  const cover = `
    <section class="cover">
      <div class="logo">📦</div>
      <h1 id="cover-title">${t.title}</h1>
      <div class="subtitle">${t.subtitle}</div>
      <div class="meta">最終更新: ${new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' })}<br>shiire-kanri.nsdktts1030.workers.dev</div>
    </section>
  `;

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="file://${ROOT}/">
<title>${t.title}</title>
<style>${css}</style>
</head>
<body class="${t.bodyClass}">
${cover}
${toc}
${bodyHtml}
</body>
</html>`;

  await fs.writeFile(tmpHtml, html);

  // Chrome headless で PDF 化
  try {
    execFileSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--no-sandbox',
      '--virtual-time-budget=5000',
      `--print-to-pdf=${outPdf}`,
      `file://${tmpHtml}`,
    ], { stdio: 'inherit' });
  } catch (e) {
    console.error(`PDF生成失敗 (${key}):`, e.message);
    throw e;
  }

  const stat = await fs.stat(outPdf);
  console.log(`✅ ${t.pdf} (${(stat.size / 1024).toFixed(1)} KB) → ${outPdf}`);

  // 配布用 HTML (画像 base64 埋込み + タップでプレビュー)
  const outHtml = path.join(DIST, t.html);
  const bodyHtmlInlined = await inlineImagesAsBase64(bodyHtml);
  const coverInlined = await inlineImagesAsBase64(cover);
  const tocInlined = await inlineImagesAsBase64(toc);
  const htmlForWeb = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<style>${css}
${WEB_STYLE}</style>
</head>
<body class="${t.bodyClass}">
${coverInlined}
${tocInlined}
${bodyHtmlInlined}
<script>${SIDEBAR_JS}</script>
<script>${LIGHTBOX_JS}</script>
</body>
</html>`;
  await fs.writeFile(outHtml, htmlForWeb);
  const htmlStat = await fs.stat(outHtml);
  console.log(`✅ ${t.html} (${(htmlStat.size / 1024).toFixed(1)} KB) → ${outHtml}`);
}

(async () => {
  for (const key of which) {
    console.log(`\n🔨 Building ${key}...`);
    await buildOne(key);
  }
  console.log('\n✨ Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
