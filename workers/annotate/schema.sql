CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker TEXT NOT NULL,
  category TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_name TEXT NOT NULL,
  image_width INTEGER NOT NULL,
  image_height INTEGER NOT NULL,
  keypoints TEXT NOT NULL,
  keypoints_flat TEXT NOT NULL,
  measurements TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
