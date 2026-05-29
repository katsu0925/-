-- S3-lite: product_image_index に一覧描画用の列を追加（いずれも原寸URL。_thumb 派生は焼き込まない）。
-- 一覧を「D1 を1回 SELECT して全件返す」方式に切り替えるための列。
-- 適用（本番）:
--   cd /Users/katsu/saisun-repo/workers/gas-proxy
--   wrangler d1 execute detauri-db --remote --file ./sql/add_pii_columns.sql
-- 適用後 schema.sql にも同じ列を追記すること（自動同期なし）。
-- SQLite の ALTER TABLE ADD COLUMN はメタデータ操作のみ（全行スキャンなし）。NOT NULL は DEFAULT 必須。
ALTER TABLE product_image_index ADD COLUMN first_image_url TEXT;
ALTER TABLE product_image_index ADD COLUMN second_image_url TEXT;
ALTER TABLE product_image_index ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_image_index ADD COLUMN uploaded_at TEXT;
ALTER TABLE product_image_index ADD COLUMN photographer TEXT;
ALTER TABLE product_image_index ADD COLUMN save_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_image_index ADD COLUMN sort_key TEXT;
ALTER TABLE product_image_index ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_pii_sort_key ON product_image_index(sort_key);
