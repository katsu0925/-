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
    bodyClass: 'staff',
    title: 'shiire-kanri 外注向けマニュアル',
    subtitle: '商品管理 Web アプリの使い方',
  },
  admin: {
    md: 'manual-admin.md',
    pdf: '管理者向けマニュアル.pdf',
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
