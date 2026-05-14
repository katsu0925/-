// Phase B: サーバー側冪等性ミドルウェア
//
// クライアント(app.js)は outbox からリトライする可能性があるので、
// 同じ X-Idempotency-Key で複数回来た POST/PUT/DELETE は
// 初回レスポンスをそのまま返してハンドラを二重実行させない。
//
// 仕組み:
//   1. ヘッダ X-Idempotency-Key を読む（無ければ素通し）
//   2. D1 idempotency_keys を SELECT
//      - 見つかれば cached response を再生して return
//   3. ハンドラを呼ぶ
//   4. レスポンスが 2xx ならボディと status を D1 に INSERT（TTL 7日）
//      - 4xx/5xx はキャッシュしない（リトライさせる）
//
// 注意: ハンドラは Response オブジェクトを返す。body は ReadableStream なので
//       一度 text() で読み出し、再度 new Response() で返す必要がある。

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7日

export async function withIdempotency(request, env, handler) {
  const key = request.headers.get('X-Idempotency-Key');
  if (!key) {
    // 冪等キーなし = 旧クライアントまたはリトライ不要のリクエスト → 素通し
    return handler();
  }

  // キー形式のバリデーション（UUID風文字列のみ受け付ける。SQLインジェクション防止）
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    return handler();
  }

  const now = Math.floor(Date.now() / 1000);

  // 1. キャッシュヒットチェック
  try {
    const row = await env.DB.prepare(
      'SELECT response_body, status_code FROM idempotency_keys WHERE key = ?1 AND expires_at > ?2'
    ).bind(key, now).first();

    if (row && row.response_body) {
      return new Response(row.response_body, {
        status: row.status_code,
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotent-Replay': 'true',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  } catch (err) {
    // D1 障害時は素通し（少なくとも処理は走らせる）
    console.warn('[idempotency] D1 read failed:', err && err.message);
  }

  // 2. ハンドラを実行
  const response = await handler();

  // 3. 2xx だけキャッシュ
  if (response && response.status >= 200 && response.status < 300) {
    try {
      const bodyText = await response.clone().text();
      const path = new URL(request.url).pathname;
      await env.DB.prepare(
        'INSERT OR REPLACE INTO idempotency_keys (key, response_body, status_code, path, user_email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
      ).bind(
        key,
        bodyText,
        response.status,
        path,
        request.headers.get('cf-access-authenticated-user-email') || null,
        now,
        now + TTL_SECONDS
      ).run();
    } catch (err) {
      // キャッシュ書き込み失敗は致命的ではない（次回もハンドラが呼ばれるだけ）
      console.warn('[idempotency] D1 write failed:', err && err.message);
    }
  }

  return response;
}
