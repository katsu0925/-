// モデル鮮度チェック（Gemini 担当）
//
// なぜ Worker 側にあるか:
//   GEMINI_API_KEY は この Worker の secret にしか置いていない。
//   通知の本体（メール送信・重複抑止）は saisun-list GAS の ModelWatch.gs にあり、
//   そちらが GET /admin/model-health?key=SYNC_SECRET を叩いてこの結果を取りに来る。
//   こうすることで Gemini キーを GAS 側へ複製せずに済む。
//
// 何を見るか:
//   1) 設定中のモデル ID が models.list に載っているか（載らなくなる＝廃止。
//      gemini-2.0-flash が 2026-06-01 に停止したのは、これで検知できるパターン）
//   2) 本番と同じ generationConfig で実際に叩いて、空応答にならないか
//      （エイリアスの実体が thinking 持ちモデルに変わると、maxOutputTokens を
//        推論トークンが食い潰して content が空で返る。この回帰を毎日踏み抜く）

import { GEMINI_MODEL, ORDERING_MODEL, ORDERING_PRO_MODEL } from '../sync/sheets-sync.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 本番の runGeminiJudgment と同じ generationConfig（sheets-sync.js の payload と揃える）
const SMOKE_GENERATION_CONFIG = {
  temperature: 0.1,
  maxOutputTokens: 512,
  responseMimeType: 'application/json',
};

const SMOKE_PROMPT = [
  'あなたは古着の商品情報を画像から判定する専門家です。以下の条件でJSONのみを返してください。',
  '対象: 黒いレディースのロングワンピース、袖は長袖。',
  '出力形式: {"gender":"","category2":"","color":""}',
].join('\n');

/**
 * 実際に generateContent を叩いて、JSON が返ってくるところまで確認する。
 * モデルが生きていても「空応答で返る」なら本番は壊れているので、そこまで見る。
 */
async function smokeTest(apiKey, model) {
  const payload = {
    contents: [{ parts: [{ text: SMOKE_PROMPT }] }],
    generationConfig: SMOKE_GENERATION_CONFIG,
  };
  try {
    const resp = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, reason: `HTTP ${resp.status}`, detail: body.slice(0, 300) };
    }
    const j = await resp.json();
    const cand = (j.candidates || [])[0] || {};
    const text = ((cand.content || {}).parts || []).map((p) => p.text || '').join('');
    const usage = j.usageMetadata || {};
    if (!text.trim()) {
      // 推論トークンが出力枠を食い潰した典型パターン。理由まで添える
      return {
        ok: false,
        reason: '空応答',
        detail: `finishReason=${cand.finishReason} thoughtsTokenCount=${usage.thoughtsTokenCount || 0}`,
      };
    }
    let parsed = false;
    try { JSON.parse(text); parsed = true; } catch (e) { parsed = false; }
    return {
      ok: parsed,
      reason: parsed ? null : 'JSONとして壊れている',
      thoughtsTokens: usage.thoughtsTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      sample: text.slice(0, 120),
    };
  } catch (e) {
    return { ok: false, reason: '呼び出し例外', detail: String(e && e.message).slice(0, 300) };
  }
}

/**
 * Gemini 側のモデル鮮度をまとめて返す。
 * live:true のものだけ実呼び出しする（並び替え判定は事実上未使用なので一覧確認のみ）。
 */
export async function checkGeminiModelHealth(env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY が未設定' };

  let available = [];
  try {
    const resp = await fetch(`${API_BASE}?key=${apiKey}&pageSize=200`);
    if (!resp.ok) return { ok: false, error: `models.list が HTTP ${resp.status}` };
    const j = await resp.json();
    available = (j.models || []).map((m) => String(m.name || '').replace('models/', ''));
  } catch (e) {
    return { ok: false, error: `models.list 失敗: ${e && e.message}` };
  }

  const configured = [
    { role: 'AI画像判定', where: 'gas-proxy sheets-sync.js:1730', model: GEMINI_MODEL, live: true },
    { role: '画像並び替え（未使用）', where: 'gas-proxy sheets-sync.js:1734', model: ORDERING_MODEL, live: false },
    { role: '並び替えスポット（未使用）', where: 'gas-proxy sheets-sync.js:1739', model: ORDERING_PRO_MODEL, live: false },
  ];

  const models = [];
  const problems = [];
  for (const c of configured) {
    // エイリアス（*-latest）は models.list にも載るが、念のため未掲載でも実呼び出しで救う
    const listed = available.includes(c.model);
    const entry = { role: c.role, where: c.where, model: c.model, listed, live: c.live, smoke: null };
    if (c.live) {
      entry.smoke = await smokeTest(apiKey, c.model);
      if (!entry.smoke.ok) {
        problems.push(`【要対応】${c.role}（${c.model}）が実呼び出しで失敗: ${entry.smoke.reason} ${entry.smoke.detail || ''}`.trim());
      }
    }
    if (!listed) {
      const level = c.live ? '要対応' : '参考';
      problems.push(`【${level}】${c.role}の ${c.model} が models.list に載っていません（廃止の可能性）`);
    }
    models.push(entry);
  }

  return {
    ok: true,
    provider: 'gemini',
    checkedAt: new Date().toISOString(),
    availableCount: available.length,
    models,
    problems,
  };
}
