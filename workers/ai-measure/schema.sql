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
