-- AI採寸 フィードバック・補正テーブル
-- 既存のdetauri-db (D1) に追加

-- ユーザー修正データ
CREATE TABLE IF NOT EXISTS measure_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  image_key TEXT,                   -- R2のキー（同意ユーザーのみ）
  category TEXT NOT NULL,           -- tops/pants/skirt/dress
  ai_keypoints TEXT NOT NULL,       -- JSON: {name: {x,y,confidence}}
  ai_measurements TEXT NOT NULL,    -- JSON: {name: {value_cm, confidence}}
  user_keypoints TEXT,              -- JSON: 修正後の座標
  user_measurements TEXT NOT NULL,  -- JSON: 修正後のcm値
  scale REAL,                       -- cm/px
  image_width INTEGER,
  image_height INTEGER,
  user_id TEXT,                     -- 匿名化ID
  data_consent INTEGER DEFAULT 1    -- データ利用同意
);

-- 統計補正テーブル
CREATE TABLE IF NOT EXISTS measure_correction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  measurement_name TEXT NOT NULL,
  avg_error REAL,                   -- 平均誤差 (AI値 - ユーザー修正値)
  sample_count INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, measurement_name)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_feedback_category ON measure_feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON measure_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_correction_category ON measure_correction(category);

-- ============ 認証・課金 ============

-- ユーザー
CREATE TABLE IF NOT EXISTS sm_users (
  id TEXT PRIMARY KEY,                  -- 'U' + Date.now().toString(36)
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- v2:salt:hash (SHA-256, 1000 iterations)
  plan TEXT NOT NULL DEFAULT 'free',    -- free/light/standard/pro/team
  monthly_limit INTEGER NOT NULL DEFAULT 5,
  display_name TEXT NOT NULL DEFAULT '',
  stripe_customer_id TEXT,           -- Stripe Customer ID
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sm_users_email ON sm_users(email);

-- 月次使用量
CREATE TABLE IF NOT EXISTS sm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,                         -- NULL = 匿名
  ip_hash TEXT,                         -- 匿名ユーザーのIP追跡用
  month TEXT NOT NULL,                  -- 'YYYY-MM'
  used INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, month),
  UNIQUE(ip_hash, month)
);
CREATE INDEX IF NOT EXISTS idx_sm_usage_month ON sm_usage(month);

-- チームメンバー
CREATE TABLE IF NOT EXISTS sm_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,               -- チームオーナーのsm_users.id
  member_id TEXT NOT NULL,              -- メンバーのsm_users.id
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at TEXT NOT NULL,
  UNIQUE(owner_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_sm_team_owner ON sm_team_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_sm_team_member ON sm_team_members(member_id);
