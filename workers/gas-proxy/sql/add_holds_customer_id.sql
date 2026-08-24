-- holds に会員ID列を追加（2026-08-25）
--
-- 「自分の確保」を端末（user_key）だけで判定していたため、同じ会員が
-- 別端末・別ブラウザで開くと自分の確保が「確保中（選択不可）」に見えていた。
-- customer_id を持たせ、同一会員なら自分の確保として扱う（判定のみ／カートは端末ごと独立）。
--
-- 適用済み: 本番 detauri-db（2026-08-25）
ALTER TABLE holds ADD COLUMN customer_id TEXT NOT NULL DEFAULT '';
