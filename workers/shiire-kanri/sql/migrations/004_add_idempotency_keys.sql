-- Phase B: サーバー側冪等性
-- クライアントが outbox から同じ X-Idempotency-Key で複数回送ってきても
-- スプレッドシートに二重書き込みされないように、初回のレスポンスを D1 にキャッシュする。
-- TTL = 7日（外注がオフラインでも復帰後に確実に flush できる期間）。

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response_body TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  path TEXT NOT NULL,
  user_email TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
