-- shiire-kanri D1 schema
-- 商品管理シート (5000+行 × 65列) と 仕入れ管理シートのミラー

CREATE TABLE IF NOT EXISTS products (
  kanri TEXT PRIMARY KEY,             -- 管理番号 (列6)
  shiire_id TEXT,                     -- 仕入れID (列2)
  worker TEXT,                        -- 作業者名 (列3)
  status TEXT,                        -- ステータス (列5)
  state TEXT,                         -- 状態 (列7)
  brand TEXT,                         -- ブランド (列8)
  size TEXT,                          -- メルカリサイズ (列9)
  color TEXT,                         -- カラー (列17)

  -- 採寸 (列21-32) — JSONで集約してフロント側でラベルを引く
  measure_json TEXT,
  measured_at TEXT,                   -- 採寸日 (列33) ISO8601
  measured_by TEXT,                   -- 採寸者 (列34)

  -- 販売 (列42-46, 65)
  sale_date TEXT,                     -- 販売日 (列42)
  sale_place TEXT,                    -- 販売場所 (列43)
  sale_price INTEGER,                 -- 販売価格 (列44)
  sale_shipping INTEGER,              -- 送料 (列45)
  sale_fee INTEGER,                   -- 手数料 (列46)
  sale_ts TEXT,                       -- 販売日タイムスタンプ (列65)

  -- 全カラム（68列、ヘッダー名キー）を保持。スキーマ進化に強い
  extra_json TEXT,

  row_num INTEGER NOT NULL,           -- シート行番号 (書き戻し用)
  updated_at INTEGER NOT NULL         -- ms epoch
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_shiire ON products(shiire_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_kanri ON products(kanri);

CREATE TABLE IF NOT EXISTS purchases (
  shiire_id TEXT PRIMARY KEY,
  date TEXT,                          -- 仕入れ日 (yyyy-MM-dd)
  amount INTEGER,                     -- 金額
  shipping INTEGER,                   -- 送料
  planned INTEGER,                    -- 商品点数
  place TEXT,                         -- 納品場所
  cost INTEGER,                       -- 商品原価
  category TEXT,                      -- 区分コード (管理番号プレフィックス用)
  content TEXT,                       -- 内容
  supplier_id TEXT,                   -- 仕入先名 (SUP0001 等の ID)
  register_user TEXT,                 -- 登録者
  registered_at TEXT,                 -- 登録日時
  assigned_kanri TEXT,                -- 割当管理番号 (例 zB1~202)
  processed INTEGER DEFAULT 0,        -- 処理済み (0/1)
  row_num INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date DESC);

CREATE TABLE IF NOT EXISTS sync_meta (
  source TEXT PRIMARY KEY,            -- 'products' | 'purchases' | 'ai_prefill'
  last_sync_at INTEGER NOT NULL,
  row_count INTEGER NOT NULL
);

-- AI画像判定シートのミラー（管理番号 → 9項目フィールド）
-- handler 側は ai_prefill → KV (ai-result) → GAS の順に試行する
CREATE TABLE IF NOT EXISTS ai_prefill (
  kanri TEXT PRIMARY KEY,             -- 管理番号
  fields_json TEXT NOT NULL,          -- {ブランド,タグ表記,性別,カテゴリ1-3,デザイン特徴,カラー,ポケット}
  row_num INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
