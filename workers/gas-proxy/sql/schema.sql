-- =====================================================
-- D1 Schema for デタウリ.Detauri
-- =====================================================

-- 顧客テーブル（顧客管理シートと対応）
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,                   -- 'C' + timestamp base36
  email TEXT NOT NULL UNIQUE,            -- lowercase normalized
  password_hash TEXT NOT NULL,           -- 'v2:salt:hash' format
  company_name TEXT NOT NULL DEFAULT '', -- 会社名/氏名
  phone TEXT NOT NULL DEFAULT '',        -- 電話番号
  postal TEXT NOT NULL DEFAULT '',       -- 郵便番号
  address TEXT NOT NULL DEFAULT '',      -- 住所
  newsletter INTEGER NOT NULL DEFAULT 0, -- メルマガ flag
  created_at TEXT NOT NULL,              -- ISO8601
  last_login TEXT,                       -- ISO8601
  points INTEGER NOT NULL DEFAULT 0,    -- ポイント残高
  points_updated_at TEXT,               -- ISO8601
  purchase_count INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0, -- 年間購入金額（ランク判定用）
  line_user_id TEXT,                     -- LINE UserID
  updated_at TEXT NOT NULL               -- 同期用タイムスタンプ
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);

-- 商品テーブル（データ1シートと対応）
CREATE TABLE IF NOT EXISTS products (
  managed_id TEXT PRIMARY KEY,           -- 管理番号 (normalized)
  no_label TEXT NOT NULL DEFAULT '',     -- No.
  image_url TEXT NOT NULL DEFAULT '',    -- 商品画像URL
  state TEXT NOT NULL DEFAULT '',        -- 状態（新品、中古等）
  brand TEXT NOT NULL DEFAULT '',        -- ブランド
  size TEXT NOT NULL DEFAULT '',         -- サイズ
  gender TEXT NOT NULL DEFAULT '',       -- 性別
  category TEXT NOT NULL DEFAULT '',     -- カテゴリ
  color TEXT NOT NULL DEFAULT '',        -- カラー
  price INTEGER NOT NULL DEFAULT 0,     -- 価格
  qty INTEGER NOT NULL DEFAULT 0,       -- 数量
  defect_detail TEXT NOT NULL DEFAULT '',-- 傷汚れ詳細
  shipping_method TEXT NOT NULL DEFAULT '', -- 発送方法
  -- 採寸データ
  measure_length REAL,       -- 着丈
  measure_shoulder REAL,     -- 肩幅
  measure_bust REAL,         -- 身幅
  measure_sleeve REAL,       -- 袖丈
  measure_yuki REAL,         -- 裄丈
  measure_total_length REAL, -- 総丈
  measure_waist REAL,        -- ウエスト
  measure_rise REAL,         -- 股上
  measure_inseam REAL,       -- 股下
  measure_thigh REAL,        -- ワタリ
  measure_hem_width REAL,    -- 裾幅
  measure_hip REAL,          -- ヒップ
  updated_at TEXT NOT NULL   -- 同期用タイムスタンプ
);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);

-- アソート商品テーブル
CREATE TABLE IF NOT EXISTS bulk_products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',      -- JSON array of URLs
  min_qty INTEGER NOT NULL DEFAULT 1,
  max_qty INTEGER NOT NULL DEFAULT 99,
  sort_order INTEGER NOT NULL DEFAULT 999,
  stock INTEGER NOT NULL DEFAULT -1,      -- -1 = unlimited
  sold_out INTEGER NOT NULL DEFAULT 0,
  discount_rate REAL NOT NULL DEFAULT 0,  -- 0〜1
  discounted_price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bulk_products_updated ON bulk_products(updated_at);

-- 確保テーブル（GASのPropertiesService hold stateと対応）
CREATE TABLE IF NOT EXISTS holds (
  managed_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  hold_id TEXT NOT NULL,
  until_ms INTEGER NOT NULL,              -- 確保期限 (epoch ms)
  pending_payment INTEGER NOT NULL DEFAULT 0, -- 支払い待ちフラグ
  receipt_no TEXT NOT NULL DEFAULT '',     -- 決済待ち受付番号
  created_at TEXT NOT NULL,
  PRIMARY KEY (managed_id, user_key)
);

CREATE INDEX IF NOT EXISTS idx_holds_until ON holds(until_ms);
CREATE INDEX IF NOT EXISTS idx_holds_user ON holds(user_key);

-- 依頼中テーブル（依頼中シートと対応）
CREATE TABLE IF NOT EXISTS open_items (
  managed_id TEXT PRIMARY KEY,
  receipt_no TEXT,
  status TEXT NOT NULL DEFAULT '依頼中',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_items_updated ON open_items(updated_at);

-- クーポンテーブル
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,                      -- 'rate' | 'fixed' | 'shipping_free'
  value REAL NOT NULL DEFAULT 0,           -- rate: 0-1, fixed: yen amount
  expires_at TEXT,                          -- ISO8601 or NULL
  max_uses INTEGER NOT NULL DEFAULT 0,     -- 0 = unlimited
  use_count INTEGER NOT NULL DEFAULT 0,
  once_per_user INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  memo TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT 'all',      -- 'all' | 'new' | 'repeat'
  start_date TEXT,                          -- ISO8601 or NULL
  combo_member INTEGER NOT NULL DEFAULT 0,
  combo_bulk INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'all',     -- 'all' | 'detauri' | 'bulk'
  target_products TEXT NOT NULL DEFAULT '', -- comma-separated IDs
  shipping_exclude_products TEXT NOT NULL DEFAULT '',
  target_customer_name TEXT NOT NULL DEFAULT '',
  target_customer_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coupons_updated ON coupons(updated_at);

-- クーポン利用履歴
CREATE TABLE IF NOT EXISTS coupon_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  email TEXT NOT NULL,
  receipt_no TEXT NOT NULL DEFAULT '',
  used_at TEXT NOT NULL                    -- ISO8601
);

CREATE INDEX IF NOT EXISTS idx_coupon_usage_code ON coupon_usage(code);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_email ON coupon_usage(email);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_code_email ON coupon_usage(code, email);

-- 設定テーブル（ScriptPropertiesの一部をキャッシュ）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 統計キャッシュ
CREATE TABLE IF NOT EXISTS stats_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,                      -- JSON
  updated_at TEXT NOT NULL
);

-- 同期メタデータ
CREATE TABLE IF NOT EXISTS sync_meta (
  source TEXT PRIMARY KEY,                 -- 'products', 'customers', 'coupons', etc.
  last_sync_at TEXT NOT NULL,              -- ISO8601
  row_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT ''        -- データ変更検出用
);
