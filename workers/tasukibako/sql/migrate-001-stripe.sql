-- マイグレーション001: Stripe Billing対応
-- usersテーブルにstripe_customer_idカラム追加
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
