-- 2026-05-07: Web Push 通知用テーブル追加
-- 用途: スタッフが「発送待ち」「発送済み」へ状態遷移したときに Web Push を飛ばす。
-- iOS は 16.4+ かつ PWA インストール必須、Android Chrome は通常タブで OK。
--
-- 適用方法:
--   wrangler d1 execute shiire-kanri-db --remote --file sql/migrations/002_add_push_notifications.sql
--
-- 冪等性: CREATE TABLE IF NOT EXISTS なので何度実行しても安全。

-- 端末ごとの push subscription（同一 email でも端末が違えば別レコード）
-- endpoint をユニークキーにして同一端末の再登録は UPSERT する
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,           -- VAPID 送信先 (FCM/Apple Web Push サーバ URL)
  email        TEXT NOT NULL,              -- Cloudflare Access JWT の email
  p256dh       TEXT NOT NULL,              -- 公開鍵 (base64url)
  auth         TEXT NOT NULL,              -- 認証シークレット (base64url, 16byte)
  ua           TEXT,                       -- User-Agent (デバッグ用)
  created_at   INTEGER NOT NULL,           -- ms epoch
  last_seen_at INTEGER NOT NULL            -- ms epoch (購読更新時刻)
);
CREATE INDEX IF NOT EXISTS idx_push_subs_email ON push_subscriptions(email);

-- ユーザ単位の通知 ON/OFF
-- 全スタッフ個人 ON/OFF・トリガー別 ON/OFF を持つ。デフォルトは両方 ON
CREATE TABLE IF NOT EXISTS push_prefs (
  email           TEXT PRIMARY KEY,
  on_hassoumachi  INTEGER NOT NULL DEFAULT 1,  -- 発送待ち遷移で通知するか (0/1)
  on_hassouzumi   INTEGER NOT NULL DEFAULT 1,  -- 発送済み遷移で通知するか (0/1)
  updated_at      INTEGER NOT NULL
);
