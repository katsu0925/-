/**
 * AI採寸 Workers API
 *
 * POST /api/measure   — キーポイント検出 + 採寸計算
 * POST /api/feedback  — ユーザー修正データ記録
 * GET  /api/usage     — 利用回数確認
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // ファビコン配信
    if (request.method === 'GET' && (path === '/favicon.ico' || path === '/favicon.svg' || path === '/apple-touch-icon.png')) {
      return handleFavicon(path);
    }

    try {
      if (path === '/api/measure' && request.method === 'POST') {
        return await handleMeasure(request, env);
      }
      if (path === '/api/feedback' && request.method === 'POST') {
        return await handleFeedback(request, env);
      }
      if (path === '/api/usage' && request.method === 'GET') {
        return await handleUsage(request, env);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: e.message }, 500);
    }
  },
};

// ==================================================
// POST /api/measure
// ==================================================
async function handleMeasure(request, env) {
  const formData = await request.formData();
  const imageFile = formData.get('image');
  const category = formData.get('category') || 'tops';
  const scale = parseFloat(formData.get('scale') || '0');

  if (!imageFile) {
    return jsonResponse({ error: 'image is required' }, 400);
  }

  // 画像をR2に一時保存
  const imageKey = `temp/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const imageBuffer = await imageFile.arrayBuffer();
  await env.IMAGES.put(imageKey, imageBuffer, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  // R2の公開URLを生成（署名付き or 公開バケット）
  // ※ 本番ではR2カスタムドメインか署名付きURLを使用
  const imageUrl = `https://ai-measure-images.YOUR_DOMAIN.com/${imageKey}`;

  // Replicate API 呼び出し
  const prediction = await callReplicate(env, {
    image: imageUrl,
    category,
    scale,
  });

  // R2から一時画像を削除
  await env.IMAGES.delete(imageKey);

  if (prediction.error) {
    return jsonResponse({ error: prediction.error }, 500);
  }

  // 結果をパース
  const result = typeof prediction.output === 'string'
    ? JSON.parse(prediction.output)
    : prediction.output;

  // 統計補正を適用
  if (result.measurements) {
    await applyCorrection(result.measurements, category, env);
  }

  // 利用回数カウント
  // TODO: 認証と利用制限

  return jsonResponse(result);
}

// ==================================================
// Replicate API
// ==================================================
async function callReplicate(env, input) {
  // 1. Prediction作成
  const createResp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: env.REPLICATE_MODEL_VERSION,
      input,
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    return { error: `Replicate API error: ${err}` };
  }

  let prediction = await createResp.json();

  // 2. ポーリングで完了を待つ（最大60秒）
  const maxWait = 60000;
  const interval = 1000;
  let elapsed = 0;

  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    if (elapsed >= maxWait) {
      return { error: 'Replicate timeout' };
    }

    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;

    const pollResp = await fetch(prediction.urls.get, {
      headers: { 'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}` },
    });
    prediction = await pollResp.json();
  }

  if (prediction.status === 'failed') {
    return { error: prediction.error || 'Prediction failed' };
  }

  return prediction;
}

// ==================================================
// POST /api/feedback
// ==================================================
async function handleFeedback(request, env) {
  const body = await request.json();

  const {
    image_key, category,
    ai_keypoints, ai_measurements,
    user_keypoints, user_measurements,
    scale, image_width, image_height,
  } = body;

  if (!category || !ai_measurements || !user_measurements) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO measure_feedback
      (image_key, category, ai_keypoints, ai_measurements,
       user_keypoints, user_measurements, scale, image_width, image_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    image_key || null,
    category,
    JSON.stringify(ai_keypoints || {}),
    JSON.stringify(ai_measurements),
    JSON.stringify(user_keypoints || {}),
    JSON.stringify(user_measurements),
    scale || 0,
    image_width || 0,
    image_height || 0,
  ).run();

  // 補正テーブルを更新（一定件数ごと）
  await updateCorrection(category, env);

  return jsonResponse({ ok: true });
}

// ==================================================
// 統計補正
// ==================================================
async function applyCorrection(measurements, category, env) {
  try {
    const corrections = await env.DB.prepare(
      'SELECT measurement_name, avg_error FROM measure_correction WHERE category = ? AND sample_count >= 30'
    ).bind(category).all();

    for (const corr of corrections.results) {
      if (measurements[corr.measurement_name]) {
        const m = measurements[corr.measurement_name];
        m.value_cm = Math.round((m.value_cm - corr.avg_error) * 10) / 10;
        m.corrected = true;
        m.correction = corr.avg_error;
      }
    }
  } catch (e) {
    // テーブルがまだない場合は無視
    console.log('Correction table not ready:', e.message);
  }
}

async function updateCorrection(category, env) {
  try {
    // カテゴリの全フィードバックから補正値を再計算
    const rows = await env.DB.prepare(`
      SELECT ai_measurements, user_measurements
      FROM measure_feedback
      WHERE category = ?
      ORDER BY created_at DESC
      LIMIT 500
    `).bind(category).all();

    if (rows.results.length < 10) return; // 10件未満は補正しない

    const errors = {}; // { measurement_name: [error1, error2, ...] }

    for (const row of rows.results) {
      const ai = JSON.parse(row.ai_measurements);
      const user = JSON.parse(row.user_measurements);

      for (const [name, userVal] of Object.entries(user)) {
        const aiEntry = ai[name];
        if (!aiEntry) continue;
        const aiVal = aiEntry.value_cm || aiEntry;
        const uVal = typeof userVal === 'object' ? userVal.value_cm : userVal;
        if (typeof aiVal === 'number' && typeof uVal === 'number') {
          if (!errors[name]) errors[name] = [];
          errors[name].push(aiVal - uVal);
        }
      }
    }

    // 補正テーブルに書き込み
    for (const [name, errs] of Object.entries(errors)) {
      const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
      await env.DB.prepare(`
        INSERT INTO measure_correction (category, measurement_name, avg_error, sample_count, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(category, measurement_name)
        DO UPDATE SET avg_error = ?, sample_count = ?, updated_at = datetime('now')
      `).bind(category, name, avg, errs.length, avg, errs.length).run();
    }
  } catch (e) {
    console.log('Update correction error:', e.message);
  }
}

// ==================================================
// GET /api/usage
// ==================================================
async function handleUsage(request, env) {
  // TODO: 認証から user_id を取得
  return jsonResponse({
    used: 0,
    limit: 5,
    plan: 'free',
  });
}

// ==================================================
// ユーティリティ
// ==================================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

// ファビコン: カメラ+メジャーモチーフ（写メジャー）
function handleFavicon(path) {
  if (path === '/favicon.svg') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="8" width="24" height="18" rx="3" fill="#e94560"/><circle cx="16" cy="17" r="6" fill="#1a1a2e"/><circle cx="16" cy="17" r="4" fill="#e94560" opacity=".5"/><circle cx="16" cy="17" r="1.5" fill="#fff"/><rect x="22" y="9" width="4" height="3" rx="1" fill="#c62828"/><rect x="0" y="26" width="32" height="4" rx="1" fill="#fbbf24"/></svg>`;
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } });
  }
  // favicon.ico / apple-touch-icon.png → SVGにリダイレクト
  return new Response(null, { status: 302, headers: { 'Location': '/favicon.svg' } });
}
