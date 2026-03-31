-- detauri-ops D1 スキーマ

-- ユーザー（管理者 + 外注スタッフ）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',  -- 'admin' or 'staff'
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 仕入れバッチ（管理者が登録→外注が点数入力）
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  purchase_date TEXT NOT NULL,
  category_code TEXT NOT NULL,
  product_amount INTEGER NOT NULL,
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER,               -- 外注が後から入力（NULL=未カウント）
  unit_cost INTEGER,                 -- 自動計算: (product_amount + shipping_cost) / item_count
  delivery_to TEXT NOT NULL,         -- 納品先（スタッフ名）
  delivery_user_id TEXT,             -- 納品先スタッフのuser ID
  note TEXT,                         -- 内容メモ
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/counted/numbered
  created_by TEXT NOT NULL,
  counted_by TEXT,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 管理番号カウンター（区分コード別、重複防止）
CREATE TABLE IF NOT EXISTS counters (
  category_code TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- 商品（メイン）
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  managed_id TEXT UNIQUE NOT NULL,    -- 管理番号（dS0001等）
  status TEXT NOT NULL DEFAULT 'draft',  -- draft/ready/synced/sold
  has_photos INTEGER NOT NULL DEFAULT 0,
  has_info INTEGER NOT NULL DEFAULT 0,
  has_measurements INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT REFERENCES users(id),
  location TEXT,                      -- 現在の所在地（スタッフ名）

  -- 採寸タイプ（4択: tops/pants/skirt/onepiece/suit）
  measure_type TEXT,

  -- 商品情報（AI自動入力 + 手動修正）
  brand TEXT,
  category_code TEXT,
  condition_state TEXT,               -- 状態（6段階）
  mercari_size TEXT,
  tag_size TEXT,
  gender TEXT,
  shipping_method TEXT,
  category1 TEXT,
  category2 TEXT,
  category3 TEXT,
  design_feature TEXT,
  color TEXT,
  pocket TEXT,
  defect_detail TEXT,

  -- 採寸（12項目）
  m_length REAL, m_shoulder REAL, m_chest REAL, m_sleeve REAL,
  m_span REAL, m_total_length REAL, m_waist REAL, m_rise REAL,
  m_inseam REAL, m_thigh REAL, m_hem REAL, m_hip REAL,
  -- スーツ下衣
  m2_total_length REAL, m2_waist REAL, m2_rise REAL, m2_inseam REAL,
  m2_thigh REAL, m2_hem REAL, m2_hip REAL,

  -- AI判定結果
  ai_step1_result TEXT,              -- Step1 JSON
  ai_step2_result TEXT,              -- Step2 JSON
  ai_confidence TEXT,                -- 低信頼度項目リスト

  -- 作業記録
  measured_at TEXT,
  measured_by TEXT,
  photographed_at TEXT,
  photographed_by TEXT,

  -- 同期
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_batch ON products(batch_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_assigned ON products(assigned_to);
CREATE INDEX IF NOT EXISTS idx_products_location ON products(location);

-- 移動報告
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,               -- BOX-YYMMDD-XXX
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reporter_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  managed_ids TEXT NOT NULL,          -- カンマ区切り
  item_count INTEGER NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- スタッフ設定（移動先の固定など）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  default_destination TEXT,           -- 固定の移動先（管理者のみ変更可）
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 作業ログ
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_product ON activity_log(product_id);
