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
    title: 'shiire-kanri 外注向けマニュアル',
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
    margin: 0 auto;
    padding: 24px 32px 64px;
    background: #fff;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  body.staff, body.admin { background: #fff; }
  .cover {
    height: auto;
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
