-- 2026-05-06: D1 課金事故防止のため content_hash / checksum 列を追加
-- 過去 detauri-gas-proxy で月 $54 の課金事故が発生（5分Cron × 5000行 INSERT OR REPLACE）。
-- 同じ事故を起こさないため、行単位 content_hash と payload 全体 checksum で
-- 「変化したものだけ書く」方式に変える。
--
-- 適用方法:
--   wrangler d1 execute shiire-kanri-db --remote --file sql/migrations/001_add_content_hash.sql
--
-- 冪等性: 同じ列を 2 回 ADD すると "duplicate column" エラー。
--         1 度適用したら再実行不可。実行済みかは PRAGMA table_info で確認できる。

ALTER TABLE products    ADD COLUMN content_hash TEXT;
ALTER TABLE purchases   ADD COLUMN content_hash TEXT;
ALTER TABLE ai_prefill  ADD COLUMN content_hash TEXT;
ALTER TABLE sync_meta   ADD COLUMN checksum     TEXT;
