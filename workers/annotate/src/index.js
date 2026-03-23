/**
 * アノテーション Workers API
 *
 * POST /api/save    — キーポイント + 実寸 + 画像を保存
 * GET  /api/count   — 保存件数（ワーカー別）
 * GET  /api/export  — 全データエクスポート（COCO形式）
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return cors(new Response(null));
    }

    try {
      if (path === '/api/save' && request.method === 'POST') {
        return cors(await handleSave(request, env));
      }
      if (path === '/api/count' && request.method === 'GET') {
        return cors(await handleCount(env));
      }
      if (path === '/api/export' && request.method === 'GET') {
        return cors(await handleExport(env));
      }
      // 静的ファイルはassetsが処理
      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error(e);
      return cors(json({ error: e.message }, 500));
    }
  },
};

async function handleSave(request, env) {
  const formData = await request.formData();
  const imageFile = formData.get('image');
  const dataJson = formData.get('data');

  if (!imageFile || !dataJson) {
    return json({ error: 'image and data are required' }, 400);
  }

  const data = JSON.parse(dataJson);
  const { worker, category, image_name, width, height, a4_corners, keypoints, keypoints_flat, measurements } = data;

  if (!worker || !category || !keypoints) {
    return json({ error: 'worker, category, keypoints are required' }, 400);
  }

  // R2に画像保存
  const imageKey = `${worker}/${Date.now()}_${image_name}`;
  await env.IMAGES.put(imageKey, await imageFile.arrayBuffer(), {
    httpMetadata: { contentType: imageFile.type || 'image/jpeg' },
  });

  // D1に保存
  await env.DB.prepare(
    `INSERT INTO annotations (worker, category, image_key, image_name, image_width, image_height, a4_corners, keypoints, keypoints_flat, measurements)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    worker,
    category,
    imageKey,
    image_name || 'unknown',
    width,
    height,
    JSON.stringify(a4_corners || []),
    JSON.stringify(keypoints),
    JSON.stringify(keypoints_flat),
    JSON.stringify(measurements || {}),
  ).run();

  // 件数取得
  const counts = await getCounts(env);

  return json({ ok: true, total: counts.total, workers: counts.workers });
}

async function handleCount(env) {
  const counts = await getCounts(env);
  return json(counts);
}

async function getCounts(env) {
  const rows = await env.DB.prepare(
    'SELECT worker, COUNT(*) as cnt FROM annotations GROUP BY worker'
  ).all();

  const workers = {};
  let total = 0;
  for (const row of rows.results) {
    workers[row.worker] = row.cnt;
    total += row.cnt;
  }
  return { total, workers };
}

async function handleExport(env) {
  const rows = await env.DB.prepare('SELECT * FROM annotations ORDER BY id').all();

  // COCO形式に変換
  const images = [];
  const annotations = [];
  let annId = 1;

  for (const row of rows.results) {
    images.push({
      id: row.id,
      file_name: row.image_key,
      width: row.image_width,
      height: row.image_height,
      worker: row.worker,
    });

    const kpFlat = JSON.parse(row.keypoints_flat);
    annotations.push({
      id: annId++,
      image_id: row.id,
      category: row.category,
      a4_corners: JSON.parse(row.a4_corners || '[]'),
      keypoints: kpFlat,
      num_keypoints: kpFlat.length / 3,
      measurements: JSON.parse(row.measurements || '{}'),
    });
  }

  return json({ images, annotations, total: rows.results.length });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}
