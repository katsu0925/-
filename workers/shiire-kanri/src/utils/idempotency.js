// Phase B: サーバー側冪等性ミドルウェア
//
// クライアント(app.js)は outbox からリトライする可能性があるので、
// 同じ X-Idempotency-Key で複数回来た POST/PUT/DELETE は
// 初回レスポンスをそのまま返してハンドラを二重実行させない。
//
// 仕組み:
//   1. ヘッダ X-Idempotency-Key を読む（無ければ素通し）
//   2. D1 idempotency_keys を SELECT（完了済みレスポンスがあれば再生して return）
//   3. 「処理中ロック」を予約（in-flight 行を INSERT ... ON CONFLICT DO NOTHING）
//      - 取得できなければ別リクエストが先行中 → 完了済みなら再生、まだ処理中なら 409
//   4. ハンドラを呼ぶ
//   5. レスポンスが 2xx ならボディと status で in-flight 行を UPDATE（TTL 7日）
//      - 4xx/5xx・例外時はロック行を DELETE（リトライさせる）
//
// 二重実行防止(#1): 同じキーの並行リクエスト（ダブルタップ／outbox 二重 flush）は
//   in-flight 行が UNIQUE 制約に弾かれてロックを取れないので、ハンドラ（=GAS書込）を
//   一度しか実行しない。response_body は NOT NULL のため空文字を、status_code=0 を
//   「処理中」マーカーとして使う（マイグレーション不要）。
//
// 注意: ハンドラは Response オブジェクトを返す。body は ReadableStream なので
//       一度 text() で読み出し、再度 new Response() で返す必要がある。

import { getAccessUser } from './access.js';

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7日（完了レスポンスのキャッシュ寿命）
const INFLIGHT_TTL_SECONDS = 120; // 処理中ロックの寿命。ハンドラ異常終了時はこの時間で自動解放され再試行可能になる

function replayResponse(row) {
  return new Response(row.response_body, {
    status: row.status_code,
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotent-Replay': 'true',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

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
  const path = new URL(request.url).pathname;

  // 1. 完了済みレスポンスのキャッシュヒット（status_code>0 かつ body あり = in-flight ではない）
  try {
    const row = await env.DB.prepare(
      'SELECT response_body, status_code FROM idempotency_keys WHERE key = ?1 AND expires_at > ?2'
    ).bind(key, now).first();

    if (row && row.status_code > 0 && row.response_body) {
      return replayResponse(row);
    }
  } catch (err) {
    // D1 障害時は素通し（少なくとも処理は走らせる）
    console.warn('[idempotency] D1 read failed:', err && err.message);
  }

  // #11: 偽装可能な edge ヘッダ(Cf-Access-Authenticated-User-Email)ではなく、
  //       検証済み JWT のメールを記録する。certs は index.js の getAccessUser で
  //       既に検証済みのため、ここでの再呼び出しはキャッシュヒットで安価。
  let verifiedEmail = null;
  try { verifiedEmail = (await getAccessUser(request, env))?.email || null; } catch (e) { /* 記録用途のみ */ }

  // 2. 処理中ロックを取得（in-flight 行を予約）。
  //    response_body は NOT NULL なので空文字、status_code=0 を「処理中」マーカーにする。
  let gotLock = false;
  try {
    const ins = await env.DB.prepare(
      'INSERT INTO idempotency_keys (key, response_body, status_code, path, user_email, created_at, expires_at) ' +
      "VALUES (?1, '', 0, ?2, ?3, ?4, ?5) ON CONFLICT(key) DO NOTHING"
    ).bind(key, path, verifiedEmail, now, now + INFLIGHT_TTL_SECONDS).run();
    gotLock = !!(ins && ins.meta && ins.meta.changes > 0);
  } catch (err) {
    // ロック取得に失敗（D1 障害）→ 冪等性は諦めて処理だけは通す
    console.warn('[idempotency] lock acquire failed:', err && err.message);
    return handler();
  }

  if (!gotLock) {
    // 別リクエストが先行中。完了済みなら再生、まだ処理中なら 409 を返してリトライさせる（二重書き込み防止）
    try {
      const row = await env.DB.prepare(
        'SELECT response_body, status_code FROM idempotency_keys WHERE key = ?1'
      ).bind(key).first();
      if (row && row.status_code > 0 && row.response_body) return replayResponse(row);
    } catch (e) { /* 後段の 409 にフォールバック */ }
    return new Response(
      JSON.stringify({ ok: false, error: '同じ操作を処理中です。少し待ってからもう一度お試しください。' }),
      {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotent-Inflight': 'true',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // 3. ロック取得済み → ハンドラを実行
  let response;
  try {
    response = await handler();
  } catch (err) {
    // ハンドラ例外 → ロックを解放してリトライ可能にする
    try { await env.DB.prepare('DELETE FROM idempotency_keys WHERE key = ?1').bind(key).run(); } catch (e) {}
    throw err;
  }

  // 4. 2xx は本体を保存し TTL を 7日へ延長。それ以外はロック解放（リトライさせる）
  if (response && response.status >= 200 && response.status < 300) {
    try {
      const bodyText = await response.clone().text();
      await env.DB.prepare(
        'UPDATE idempotency_keys SET response_body = ?2, status_code = ?3, expires_at = ?4 WHERE key = ?1'
      ).bind(key, bodyText, response.status, now + TTL_SECONDS).run();
    } catch (err) {
      // キャッシュ書き込み失敗は致命的ではない（ロック行は INFLIGHT_TTL で自然失効）
      console.warn('[idempotency] D1 write failed:', err && err.message);
    }
  } else {
    try { await env.DB.prepare('DELETE FROM idempotency_keys WHERE key = ?1').bind(key).run(); } catch (e) {}
  }

  return response;
}
