/**
 * 商品データ・記事の機械翻訳（Workers AI）
 * ---------------------------------------------------------------------------
 * 静的な画面文言は saisun-list/i18n-src/*.tsv（人手）が担当する。
 * こちらはシート由来で毎日変わるテキストだけを扱う:
 *   - 傷・汚れ詳細 / 純日本語のブランド名 / カラー
 *   - アソート商品の商品名・説明
 *   - 記事のタイトル・要約・本文
 *
 * 課金事故を構造的に起こさないための設計（KV過剰読みの $48.95 の反省）:
 *   1. AI呼び出しは Cron の中だけ。ユーザーのアクセスでは絶対に走らない
 *   2. 1日あたりの Neuron を D1 でカウントし、無料枠(1日10,000)の3割で強制停止。
 *      上限3,000/日 × 365日 < 無料枠3,650,000/年 なので、理論上も超過課金にならない
 *   3. 原文のハッシュをキーにキャッシュするので、同じ文は一生に一度しか翻訳しない。
 *      日本語を編集するとハッシュが変わる = 自動的に訳し直される
 *   4. 失敗は attempts を上げて打ち切る（無限リトライを作らない）
 */

// 推論(reasoning)持ちのモデルは出力トークンを全部「考え」に使ってしまい
// content が空のまま finish_reason=length で返る。翻訳では推論なしのモデルを使う
const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
// 価格表(2026-08時点): 31,876 neurons / M input, 50,488 neurons / M output
const NEURONS_PER_M_IN = 31876;
const NEURONS_PER_M_OUT = 50488;

const LANGS = ['en', 'zh-CN'];
const LANG_NAME = { en: 'English', 'zh-CN': 'Simplified Chinese' };

// 無料枠は1日10,000 Neuron。1日の上限をそれ未満に固定しておけば、
// 何が起きても課金対象の超過分は発生しない（見積り誤差を見て6,000に置く）
const MAX_NEURONS_PER_DAY = 6000;
const MAX_ITEMS_PER_RUN = 6;        // 5分Cron 1回あたりの翻訳本数
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_CHARS = 4000;      // アソート説明文が約3,000字あるので1件まるごと通す
const ARTICLE_EVERY_MIN = 30;       // 記事の棚卸しは30分に1回（GASへの負荷を抑える）
const ARTICLE_FETCH_PER_RUN = 2;    // 1回に取りに行く本文の数（GAS往復が遅いので絞る）
const ENQUEUE_EVERY_MIN = 15;       // 収集は15分に1回（D1の読み取り行数を抑える）

/* ------------------------------------------------------------------ schema */

export async function ensureI18nSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS translations (
      hash TEXT NOT NULL,
      lang TEXT NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (hash, lang)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS translation_queue (
      hash TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      seen_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS translation_budget (
      day TEXT PRIMARY KEY,
      neurons INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0
    )`),
  ]);
}

/* ------------------------------------------------------------------- utils */

const HAS_JP = /[぀-ヿ㐀-鿿]/;

export async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/** 翻訳に出す価値があるか（日本語を含み、短すぎず長すぎない） */
function translatable(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (t.length < 2 || t.length > MAX_SOURCE_CHARS) return false;
  return HAS_JP.test(t);
}

/**
 * 記事本文を段落単位に割る。
 * <strong> のようなインラインタグで切ってしまうと「30%増」だけがAIに渡り、
 * 文脈を勝手に補った訳（"Sales have increased by 30%."）が出てしまうので、
 * ブロック要素だけで切り、インラインタグは落として「画面に見えている文字列」にする。
 * クライアント側は段落要素の textContent 全体をキーに突き合わせる
 */
export function splitHtmlBlocks(html) {
  return String(html || '')
    .split(/<\/(?:p|h[1-6]|li|div|blockquote|tr|section)\s*>/i)
    .map((b) => b
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ budget */

async function readBudget(db) {
  const row = await db.prepare('SELECT neurons, calls FROM translation_budget WHERE day = ?')
    .bind(utcDay()).first();
  return { neurons: row?.neurons || 0, calls: row?.calls || 0 };
}

async function addBudget(db, neurons) {
  await db.prepare(`INSERT INTO translation_budget (day, neurons, calls) VALUES (?, ?, 1)
    ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons, calls = calls + 1`)
    .bind(utcDay(), Math.ceil(neurons)).run();
}

/* ------------------------------------------------------------------ 収集 */

/** hash -> {source, kind} の Map をキューに積む。既に全言語そろっている分は積まない */
async function queueAll(db, found) {
  if (!found.size) return 0;
  const hashes = [...found.keys()];
  const done = new Set();
  for (let i = 0; i < hashes.length; i += 80) {
    const chunk = hashes.slice(i, i + 80);      // D1の変数上限100に対する余裕
    const q = await db.prepare(
      `SELECT hash, COUNT(*) n FROM translations WHERE lang IN ('en','zh-CN')
         AND hash IN (${chunk.map(() => '?').join(',')}) GROUP BY hash`
    ).bind(...chunk).all();
    for (const r of q.results || []) if (r.n >= LANGS.length) done.add(r.hash);
  }
  const now = new Date().toISOString();
  const rows = [];
  for (const [hash, v] of found) {
    if (done.has(hash)) continue;
    rows.push(db.prepare(
      `INSERT INTO translation_queue (hash, source, kind, seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET seen_at = excluded.seen_at`
    ).bind(hash, v.source, v.kind, now));
  }
  for (let i = 0; i < rows.length; i += 40) await db.batch(rows.slice(i, i + 40));
  return rows.length;
}

async function collect(source, kind, found) {
  const t = String(source || '').trim();
  if (!translatable(t)) return;
  found.set(await sha1(t), { source: t, kind });
}

/** 商品・アソート（D1だけを見る。速いので毎回やってよい） */
export async function enqueueSources(env) {
  const db = env.DB;
  const found = new Map();

  // 傷・汚れ詳細（毎日増える唯一の自由文）
  // ブランド名とカラーはAIに渡さない。固有名詞は誤訳が致命的だし種類も少ないので
  // i18n-src の静的辞書＋「カタカナ(英字)→英字」のパターンで確定的に処理する
  const prod = await db.prepare(
    `SELECT DISTINCT defect_detail AS d FROM products WHERE defect_detail <> ''`   // qty列は常に0で在庫判定には使えない
  ).all();
  for (const r of prod.results || []) await collect(r.d, 'defect', found);

  // アソート商品（説明文は画面でも1つのテキストノードなので丸ごと1件として訳す）
  const bulk = await db.prepare(
    `SELECT name, description FROM bulk_products WHERE active = 1`
  ).all();
  for (const r of bulk.results || []) {
    await collect(r.name, 'bulk', found);
    await collect(r.description, 'bulk', found);
  }

  return { scanned: found.size, queued: await queueAll(db, found) };
}

/**
 * 記事。GASへの往復が遅いので本文取得は1回あたり ARTICLE_FETCH_PER_RUN 本まで。
 * 「取得済み」の印はキューに積み終わってから書く（途中で落ちたら次回やり直せるように）
 */
export async function enqueueArticles(env) {
  const gas = env.GAS_API_URL;
  if (!gas) return { articles: 0 };
  const db = env.DB;
  const call = async (action, args = []) => {
    const r = await fetch(gas, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, args }),
      redirect: 'follow',
    });
    return r.ok ? await r.json() : null;
  };

  const list = await call('apiGetArticles');
  const arts = (list && list.articles) || [];
  if (!arts.length) return { articles: 0 };

  const found = new Map();
  for (const a of arts) {
    await collect(a.title, 'article', found);
    await collect(a.summary, 'article', found);
  }

  const markers = [];
  let fetched = 0;
  for (const a of arts) {
    if (fetched >= ARTICLE_FETCH_PER_RUN) break;
    const key = await sha1('article:' + a.id);
    const seen = await db.prepare("SELECT 1 FROM translations WHERE hash = ? AND lang = '_seen'")
      .bind(key).first();
    if (seen) continue;
    const detail = await call('apiGetArticleContent', [a.id]);
    const content = detail && detail.article && detail.article.content;
    if (!content) continue;
    for (const seg of splitHtmlBlocks(content)) await collect(seg, 'article', found);
    markers.push({ key, id: a.id });
    fetched++;
  }

  const queued = await queueAll(db, found);
  const now = new Date().toISOString();
  for (const m of markers) {
    await db.prepare(
      `INSERT OR REPLACE INTO translations (hash, lang, source, text, kind, updated_at)
       VALUES (?, '_seen', ?, '', 'article-marker', ?)`
    ).bind(m.key, 'article:' + m.id, now).run();
  }
  return { articles: arts.length, bodies: fetched, queued };
}

/* ------------------------------------------------------------------ 翻訳 */

const GLOSSARY = {
  en: '物販 = reselling, せどり = reselling, 古着 = second-hand clothing, 仕入れ = sourcing, '
    + '出品 = listing, 採寸 = measurements, アソート = assort (bulk lot)',
  'zh-CN': '物販 = 转卖, せどり = 转卖, 古着 = 二手服装, 仕入れ = 进货, '
    + '出品 = 上架, 採寸 = 尺寸测量, アソート = 混装批发',
};

function buildPrompt(lang, kind) {
  const target = LANG_NAME[lang];
  const common =
    `You translate Japanese second-hand clothing e-commerce text into ${target}. ` +
    `Rules: reply with the translation and nothing else. ` +
    `No preamble, no quotes, no notes, no alternatives, no explanation, no romaji gloss. ` +
    `Keep the same number of lines as the input. ` +
    `Keep brand names, product codes, sizes, numbers, currency amounts and URLs exactly as they are. ` +
    `Keep the same meaning; never add or drop information. ` +
    // 用語のブレを防ぐ。「物販→物流」「円→元」のような取り違えが実際に出た。
    // 訳語は必ずターゲット言語で与える。英語の訳語を中国語向けのプロンプトに混ぜると
    // 中国語の文の中に "reselling" が残り、ひどいときは全文が英語で返ってくる
    `Use these words, not paraphrases: ${GLOSSARY[lang]}. ` +
    `円 always means Japanese yen (${lang === 'zh-CN' ? '日元' : 'JPY'}) - never convert the amount or change the currency. ` +
    `Marketplace names (メルカリ/Mercari, ラクマ/Rakuma, Yahoo!フリマ, BASE) stay as their usual Latin names. ` +
    // 実際に「デタウリ→Detour」と訳された。屋号は絶対に訳させない
    `デタウリ is our own shop name and is always written "Detauri" - never translate or re-spell it. ` +
    `Plain text only: no Markdown, no ** or ## or bullets that were not in the source. ` +
    // 説明文の中に並ぶ日本語ブランド名を音写して "Snider" "Free Area" 等になっていた
    `Japanese fashion brand names keep their official Latin spelling ` +
    `(スナイデル=SNIDEL, 自由区=JIYU-KU, 組曲=KUMIKYOKU, インディヴィ=INDIVI, ローリーズファーム=LOWRYS FARM, ` +
    `レプシィム=LEPSIM, ジルスチュアート=JILL STUART, アプワイザーリッシェ=Apuweiser-riche). ` +
    `If you are not sure of a brand's Latin spelling, leave it in Japanese - never invent a phonetic spelling.` +
    // 中国語のはずが全文英語で返る事故が実際に起きた（商品名1件が英文のまま保存された）
    (lang === 'en' ? '' :
      ` Write every word of your reply in ${target}. Latin letters are allowed only for brand names, ` +
      `shop names, marketplace names, product codes and units - never for ordinary words or sentences.`);
  if (kind === 'defect') {
    return common + ` This text describes flaws on a used garment (stains, yellowing, holes, pilling). ` +
      `Be literal and precise about the body part and the type of flaw. Do not soften or exaggerate.`;
  }
  if (kind === 'article') {
    return common + ` This is one paragraph from a blog article for resellers. Write natural, readable ${target}.`;
  }
  return common;
}

/**
 * 機械翻訳の自動点検。
 * 外国語が読めなくても気づける種類の壊れ方だけを機械的に弾く:
 *   - 金額や重量などの数字が訳文から消えている（3,300円 が抜ける等）
 *   - 訳文が極端に短い＝途中で切れている
 *   - かなが残っている＝訳し漏れ
 *   - 中国語のはずが英語で返っている＝言語の取り違え（checkLanguage）
 * 引っかかったら訳を保存しない。**日本語のまま出るほうが、誤訳が出るより安全**
 */
function checkTranslation(source, text, lang) {
  // 3桁以上の数字（金額・重量・年）は必ず残っていなければならない。
  // 1〜2桁は「3〜9月 → March-September」のように語へ変わるのが正しいので見ない
  const nums = (v) => (String(v).match(/\d[\d,]{2,}/g) || []).map((n) => n.replace(/,/g, ''));
  const have = new Set(nums(text));
  for (const n of nums(source)) {
    if (!have.has(n)) return '数字が消えている: ' + n;
  }
  if (text.length < source.length * 0.3) return '訳が短すぎる（途中で切れた可能性）';
  if (/[ぁ-んァ-ヶ]/.test(text)) return 'かなが残っている（訳し漏れ）';
  return checkLanguage(source, text, lang);
}

// 「英語の地の文」を見分けるための機能語。ブランド名には出てこない語だけを並べる
const EN_FUNCTION_WORDS =
  /\b(the|is|are|was|were|and|of|for|with|from|this|that|these|has|have|been|will|can|not|but|your|our|their|about|into|than|when|which|while|per|on|in|at|to|by)\b/gi;

/**
 * 訳文がちゃんとターゲット言語で書かれているか。
 * 中国語のはずが丸ごと英語で返る事故が実際に起きた
 * （アソート商品名1件が英文のまま保存され、中国語表示に英語が出ていた）。
 * ブランド名の羅列は英字のままが正解なので、機能語が出たときだけ弾く
 */
function checkLanguage(source, text, lang) {
  if (lang === 'en') return '';
  // 原文にある英単語（引用された英語のUIラベルなど）はそのまま残るのが正しい
  const inSource = new Set((source.match(EN_FUNCTION_WORDS) || []).map((w) => w.toLowerCase()));
  const leaked = (text.match(EN_FUNCTION_WORDS) || []).filter((w) => !inSource.has(w.toLowerCase()));
  if (leaked.length) return '英語のまま返ってきている: ' + leaked.slice(0, 3).join(' ');
  // ひらがなが並ぶ＝地の文。訳文に漢字が1文字もないなら訳せていない
  if ((source.match(/[ぁ-ん]/g) || []).length >= 6 && !/[一-鿿]/.test(text)) {
    return '訳文に漢字がない（訳し漏れ・取り違え）';
  }
  return '';
}

/** モデルを1回叩く。使ったNeuronは budget.spent に足す */
async function callModel(env, text, kind, lang, budget) {
  const r = await env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: buildPrompt(lang, kind) },
      { role: 'user', content: text },
    ],
    max_tokens: Math.min(1200, Math.ceil(text.length * 1.8) + 120),
    temperature: 0.2,
  });
  const u = r?.usage || {};
  budget.spent += (u.prompt_tokens || 0) / 1e6 * NEURONS_PER_M_IN
                + (u.completion_tokens || 0) / 1e6 * NEURONS_PER_M_OUT;
  // Workers AI の返りは model によって response / OpenAI互換 choices の2形がある
  const raw = (r && (r.response ?? r.choices?.[0]?.message?.content)) || '';
  let out = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')     // 推論モデルの独り言を落とす
    .trim()
    // 「Here is the translation:」のような前置きを落とす
    .replace(/^(?:here(?:'s| is)[^:\n]*:|translation[^:\n]*:|译文[：:]|翻译[：:])\s*/i, '')
    .trim();
  // 原文が1行なら訳も1行のはず。解説を付け足してきた分を捨てる
  if (text.indexOf('\n') < 0) out = out.split('\n')[0].trim();
  // 素のテキストとして表示するので、勝手に付いたMarkdownの装飾は剥がす
  if (text.indexOf('**') < 0) out = out.replace(/\*\*/g, '');
  if (text.indexOf('##') < 0) out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/\bDetour\b/g, 'Detauri');
  out = out.replace(/^["'「『]|["'」』]$/g, '').trim();
  if (!out) {
    const fin = r?.choices?.[0]?.finish_reason || '';
    throw new Error('empty(' + fin + '): ' + JSON.stringify(r).slice(0, 140));
  }
  if (out.length > Math.max(200, text.length * 8)) {
    throw new Error('too long(' + out.length + '): ' + out.slice(0, 120));
  }
  const bad = checkTranslation(text, out, lang);
  if (bad) throw new Error(bad + ' | ' + out.slice(0, 100));
  return out;
}

/**
 * 1件を訳す。長文は行ごとに分けて訳し、行単位でもキャッシュする。
 * アソートの説明文は7点がほぼ同じ雛形なので、行で持つと実際の呼び出しが激減する
 */
async function translateOne(env, source, kind, lang, budget) {
  const db = env.DB;
  if (source.length <= 300 || source.indexOf('\n') < 0) {
    return await callModel(env, source, kind, lang, budget);
  }
  const lines = source.split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || !HAS_JP.test(t)) { out.push(line); continue; }   // 空行・URL・数字はそのまま
    const h = await sha1(t);
    const hit = await db.prepare('SELECT text FROM translations WHERE hash = ? AND lang = ?')
      .bind(h, lang).first();
    if (hit && hit.text) { out.push(hit.text); continue; }
    if (budget.base + budget.spent >= MAX_NEURONS_PER_DAY) throw new Error('budget');
    const tr = await callModel(env, t, kind, lang, budget);
    await db.prepare(
      `INSERT OR REPLACE INTO translations (hash, lang, source, text, kind, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(h, lang, t, tr, kind + '-line', new Date().toISOString()).run();
    out.push(tr);
  }
  return out.join('\n');
}

/** キューを消化する。予算・件数の上限で必ず止まる */
export async function runTranslationBatch(env, limit = MAX_ITEMS_PER_RUN) {
  const db = env.DB;
  if (!env.AI) return { skipped: 'no-ai-binding' };

  const cur = await readBudget(db);
  if (cur.neurons >= MAX_NEURONS_PER_DAY) {
    return { skipped: 'daily-budget', neurons: cur.neurons };
  }
  const budget = { base: cur.neurons, spent: 0 };

  const q = await db.prepare(
    `SELECT hash, source, kind FROM translation_queue
      WHERE attempts < ? ORDER BY attempts ASC, seen_at ASC LIMIT ?`
  ).bind(MAX_ATTEMPTS, limit).all();
  const items = q.results || [];
  if (!items.length) return { done: 0, empty: true };

  let done = 0, failed = 0, written = 0;
  for (const it of items) {
    if (budget.base + budget.spent >= MAX_NEURONS_PER_DAY) break;
    let ok = true;
    for (const lang of LANGS) {
      const exists = await db.prepare('SELECT 1 FROM translations WHERE hash = ? AND lang = ?')
        .bind(it.hash, lang).first();
      if (exists) continue;
      try {
        const text = await translateOne(env, it.source, it.kind, lang, budget);
        await db.prepare(
          `INSERT OR REPLACE INTO translations (hash, lang, source, text, kind, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(it.hash, lang, it.source, text, it.kind, new Date().toISOString()).run();
      } catch (e) {
        ok = false;
        const msg = String(e && e.message || e).slice(0, 200);
        await db.prepare('UPDATE translation_queue SET attempts = attempts + 1, last_error = ? WHERE hash = ?')
          .bind(msg, it.hash).run();
        console.warn('[i18n-mt] failed', it.hash, msg);
        break;
      }
    }
    if (ok) {
      await db.prepare('DELETE FROM translation_queue WHERE hash = ?').bind(it.hash).run();
      done++;
    } else {
      failed++;
    }
    if (budget.spent - written > 0) {       // 1件ごとに書き戻す
      await addBudget(db, budget.spent - written);
      written = budget.spent;
    }
  }
  if (budget.spent - written > 0) await addBudget(db, budget.spent - written);
  return { done, failed, neurons: Math.round(budget.base + budget.spent) };
}

/* --------------------------------------------------------------- 配信 */

/** 原文 -> 訳文 の辞書を作る（i18n.js がそのまま食える形） */
export async function buildDynamicDict(env, lang) {
  const rows = await env.DB.prepare(
    `SELECT source, text FROM translations WHERE lang = ? AND text <> ''`
  ).bind(lang).all();
  const dict = {};
  for (const r of rows.results || []) {
    const k = String(r.source).replace(/\s+/g, ' ').trim();
    if (k) dict[k] = r.text;
  }
  return dict;
}

export async function serveDynamicDict(env, lang) {
  if (!LANGS.includes(lang)) return new Response('not found', { status: 404 });
  const cacheKey = `i18n:dyn:${lang}`;
  let body = await env.CACHE.get(cacheKey);
  if (!body) {
    const dict = await buildDynamicDict(env, lang);
    body = `window.__I18N_REGISTER_DYNAMIC__&&window.__I18N_REGISTER_DYNAMIC__(${JSON.stringify(lang)},${JSON.stringify(dict)});`;
    await env.CACHE.put(cacheKey, body, { expirationTtl: 600 });
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function purgeDynamicDict(env) {
  for (const l of LANGS) { try { await env.CACHE.delete(`i18n:dyn:${l}`); } catch (e) {} }
}

/** Cron から呼ぶ入口 */
export async function scheduledTranslate(env) {
  const LOCK = 'i18n:mt:lock';
  try {
    if (await env.CACHE.get(LOCK)) { console.log('[i18n-mt] locked, skip'); return; }
    await env.CACHE.put(LOCK, '1', { expirationTtl: 280 });
  } catch (e) { /* KVが落ちていても翻訳自体は続ける */ }
  try {
    await ensureI18nSchema(env.DB);
    const min = new Date().getUTCMinutes();
    const enq = (min % ENQUEUE_EVERY_MIN) < 5 ? await enqueueSources(env) : { skippedEnqueue: true };
    // 記事はGAS往復が入って遅いので、翻訳の実行を止めないよう失敗しても握りつぶす
    let art = { skippedArticles: true };
    if ((min % ARTICLE_EVERY_MIN) < 5) {
      try { art = await enqueueArticles(env); }
      catch (e) { art = { articleError: String(e && e.message || e).slice(0, 120) }; }
    }
    const run = await runTranslationBatch(env);
    if (run.done) await purgeDynamicDict(env);
    console.log('[i18n-mt]', JSON.stringify({ ...enq, ...art, ...run }));
  } catch (e) {
    console.error('[i18n-mt] scheduled failed:', e && e.message);
  } finally {
    try { await env.CACHE.delete(LOCK); } catch (e) {}
  }
}

export const I18N_MT_CONST = { LANGS, MODEL, MAX_NEURONS_PER_DAY, MAX_ITEMS_PER_RUN };
