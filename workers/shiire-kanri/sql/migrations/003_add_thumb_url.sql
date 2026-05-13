-- 2026-05-13: 商品一覧の即時サムネ表示のため thumb_url 列を追加
-- 従来は /api/products/thumbs を別途叩いて KV (product-images:<MID>) から
-- トップ画像URLを取り直していたが、これを products 行に直接保持して
-- /api/products list レスポンスに同梱する（RTT 1往復削減・初期描画即時化）。
--
-- 値: タスキ箱（gas-proxy）の R2 経由相対 URL（例 `/images/products/xxx/yyy.jpg`）
--     または絶対 URL（外部 URL のケース）。書込み元は gas-proxy upload.js。
--
-- 適用方法:
--   wrangler d1 execute shiire-kanri-db --remote --file sql/migrations/003_add_thumb_url.sql
--
-- 冪等性: 同じ列を 2 回 ADD すると "duplicate column" エラー。
--         1 度適用したら再実行不可。実行済みかは PRAGMA table_info で確認できる。

ALTER TABLE products ADD COLUMN thumb_url TEXT;
