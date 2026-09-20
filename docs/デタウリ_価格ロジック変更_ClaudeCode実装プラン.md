# デタウリ 価格ロジック変更 — 実装プラン（2026-04-22 改訂版）

**対象:** デタウリ個品ページ（index.html）＋ アソートページ（BulkLP.html）＋ ガイド・チャットBOT・メール文言
**タイミング:** 即時適用（デプロイ後即時）
**作業者:** Claude Code（main ブランチ直接作業・完了後自動コミット＆プッシュ）

---

## 0. 変更内容サマリ（確定事項）

| # | 項目 | 変更前 | 変更後 |
|---|------|--------|--------|
| 1 | **送料無料閾値** | ¥10,000 | **¥30,000** |
| 2 | **沖縄・離島の送料無料** | 閾値超えで無料 | **対象外**（閾値超えても送料請求） |
| 3 | **ダイヤモンド会員の沖縄・離島送料** | 無料 | **無料のまま維持**（ダイヤ特典） |
| 4 | **デタウリ数量割引**（10/30/50/100点 5〜20%OFF） | 有効 | **廃止**（`comboBulk` フィールドはスキーマ維持） |
| 5 | **会員割引 10%OFF 期限** | 2026-09-30 | 変更なし（確認のみ） |
| 6 | **FHP 50%OFF 期限** | 2026-12-31 | **2026-09-30 に前倒し** |
| 7 | **値引率ガード** | — | **実装しない**（数量割引廃止で不要化） |

**変更の目的:** 外注費（デタウリ¥70/点、アソート¥200/件）の原価計上で高単価帯の原価割れが判明。数量割引廃止・送料無料閾値引き上げ・沖縄離島除外・FHP期限前倒しで粗利を改善する。

**影響範囲:** アソートには数量割引がもともとない。デタウリ個品のみ影響。送料関連は両ページ共通。

---

## 1. アーキテクチャ同期構造（最重要）

価格計算は **3層で同期** されている。**1層でも漏れると計算不整合**が発生する。過去の在庫経過割引削除も同じ構造だった。

```
┌─ フロント (CartCalc.html / index.html / BulkLP.html) ──┐
│   カート表示・見積計算                                    │
│   window.CartCalc を各ページから呼び出し                  │
└──────────────────────────────────────────────────────┘
                       ↕ 同じロジックで書き直す
┌─ GAS サーバー (SubmitFix.gs / BulkSubmit.gs) ──────────┐
│   注文送信時の最終価格確定                                │
│   step順: FHP → 数量割引 → 会員割引 → クーポン → 送料     │
└──────────────────────────────────────────────────────┘
                       ↕ D1 settings 経由で同期
┌─ Cloudflare Workers (gas-proxy/submit.js) ─────────────┐
│   エッジ側で同じ計算を再現（不正防止・実価格検証）        │
│   D1 settings から動的設定を読み込み                      │
└──────────────────────────────────────────────────────┘
```

**文言の同期も別問題として扱う:** 商品ページガイド・プロモバー・チャットBOT・メール・`docs/送料決済仕様.md` まで全て更新する。

---

## 2. 変更対象ファイル一覧（チェックリスト）

### A. 設定・定数（GAS）

| ファイル:行 | 変更内容 |
|---|---|
| `saisun-list/Config.gs:181-183` | `MEMBER_DISCOUNT_DEFAULTS.endDate = '2026-09-30'` を**確認のみ**（すでに一致） |
| `saisun-list/Config.gs:252-254` | `FIRST_HALF_PRICE_DEFAULTS.endDate` を `'2026-12-31'` → **`'2026-09-30'`** に変更 |
| `saisun-list/Constants.gs:64` | `FREE_SHIP_THRESHOLD: 10000` → **`30000`** |
| `saisun-list/Config.gs` に新規追加 | `// 沖縄・離島の送料無料除外フラグ（ダイヤモンド会員は除く）` のコメント（ロジックは判定側に直接記述） |

### B. 送料計算ロジック（GAS）

| ファイル:行 | 変更内容 |
|---|---|
| `saisun-list/Config.gs:473-477` | `calcShipping_` 等の送料計算関数に **沖縄・離島除外ロジック** を追加。ただし既存の `if (isRemoteIsland_(...)) return null;` は維持（離島は発送不可） |
| `saisun-list/SubmitFix.gs:222-228` | 送料無料判定にエリア判定を追加（`if (area === 'okinawa' && !diamondFree) thresholdFree = false;`）、閾値 `10000` → `30000` |
| `saisun-list/BulkSubmit.gs:195-201` | 同上。ダイヤは先に判定、沖縄・離島は閾値無料の対象外 |

### C. フロント計算ロジック（CartCalc.html）

| 行 | 変更内容 |
|---|---|
| 15-24 | `bulkDiscountRate(count)` を常に `0` 返却に変更。`bulkDiscountLabel` は空文字列を返す |
| 152 | `freeShipProgress.threshold: 10000` → `30000` |
| 185-192 | step 3a の数量割引適用ブロックを削除（または `if (false)` で無効化） |
| 219 | `var freeShipThreshold = 10000;` → `30000` |
| 221-226 | 送料無料判定ロジックに `!isOkinawaOrRemote || diamondFree` 条件を追加 |
| 237, 276 | 送料無料ラベル「商品合計1万円以上」→「商品合計3万円以上」 |
| 263-271 | 沖縄・離島の判定を送料無料クーポンの適用範囲にも反映 |
| 311-320 | 送料無料プログレスバーの閾値を30000に |
| 488-489 | 公開API `bulkDiscountRate`/`bulkDiscountLabel` は**残す**（互換のため、常に0/空返却） |

### D. デタウリ個品ページ（index.html）

| 行 | 変更内容 |
|---|---|
| 11, 13 | `<meta description>` の「1万円以上送料無料」→「3万円以上送料無料」 |
| 588, 735 | プロモーションバーの文言更新 |
| 1498, 1509 | 購入ガイド・決済欄の「1万円以上」→「3万円以上」、沖縄・離島除外の注記追加 |
| 1517-1524 | **数量割引ガイド行を削除**（ガイド構造を再確認しつつ） |
| 1792 | 法務表示内の送料説明を更新 |
| 2087-2091 | `bulkDiscountRate_` 委譲関数は残す（CartCalc側で0返却される） |
| 2171-2188 | 送料計算関数 `_freeShipSum >= 10000` → `>= 30000`、沖縄除外追加 |
| 2250-2494 | 数量割引進捗バー関連のUI・ロジック削除 |

### E. アソートページ（BulkLP.html）

| 行 | 変更内容 |
|---|---|
| 589 | プロモーションバー文言更新 |
| 1036, 1266 | 購入ガイド・法務表示内の送料説明文言 |
| 2676-2681 | 送料無料メッセージ `_prodTotalB >= 10000` → `>= 30000`、文言更新 |
| 2818-2841 | `_oaSub + _oaDet >= 10000` 系の判定を全て30000に、沖縄除外条件追加 |
| 3112-3118 | 注文送信時の送料計算（`_submitProdTotal >= 10000`） |
| 3717-3718 | `bulkDiscountRate_` 委譲関数は残す |
| 4166 | ランク特典表示の送料無料項目（変更なし・確認のみ） |
| 4971, 4975 | チャットBOTの送料FAQ応答を全文更新（「1万円以上」→「3万円以上」、沖縄除外注記） |
| 4987 | **数量割引制度の記述を削除** |

### F. チャットBOT（Chatbot.gs）

| 行 | 変更内容 |
|---|---|
| 136, 155-156 | 「1万円以上で送料無料」→「3万円以上で送料無料（沖縄・離島除く／ダイヤ会員は全国無料）」 |
| 256-289 | 送料関連FAQ応答の全文更新、沖縄・離島除外の明記 |
| （要grep） | 「数量割引」に言及する応答があれば削除 |

### G. Workers エッジ（workers/gas-proxy/）

| ファイル | 変更内容 |
|---|---|
| `src/handlers/submit.js:12-` | 数量割引ヘルパー `getBulkDiscountRate` を常に0返却、`qty_discount_enabled=false` をD1 settingsで明示 |
| `src/handlers/submit.js:281` | `freeShipRow` のfallbackデフォルトを 10000 → 30000、沖縄除外判定を追加 |
| `src/db/` 内 settings管理 | `config_free_ship_threshold=30000` を本番D1に反映 |

### H. 管理画面（AdminPanel）

| ファイル:行 | 変更内容 |
|---|---|
| `saisun-list/AdminPanelApi.gs:234-255` | `saveBulkDiscountTable_` を無効化 or 非推奨化コメント追加 |
| `saisun-list/AdminPanelApi.gs:266, 274` | `CONFIG_FREE_SHIP_THRESHOLD` デフォルト 10000 → 30000 |
| `saisun-list/AdminPanel.html`（要確認） | 数量割引セクションを「停止中」表示に、送料無料閾値のデフォルト表示を更新 |

### I. ドキュメント・その他

| ファイル | 変更内容 |
|---|---|
| `saisun-list/docs/送料決済仕様.md` | 「1万円以上」→「3万円以上」、沖縄・離島除外条件を追記 |
| `saisun-list/SNSShare.gs:253` | `M: 数量割引併用` のコメント更新（機能的影響なし） |
| `saisun-list/Coupon.gs` の COUPON_COLS | `COMBO_BULK`（M列）はスキーマ維持。将来の再開に備える |
| `saisun-list/SubmitFix.gs` 内メール生成 | `buildConfirmMail_` / `buildShipMail_` に固定文言があれば更新 |

---

## 3. 実装時の注意事項（漏らさないために）

### 3-1. 数量割引廃止にあたって
- **コード削除ではなく `return 0;` に変更**。既存の関数シグネチャは維持する（3層で呼び出されているため）
- `comboBulk` フィールド（Coupon.gs）は **スキーマ残す**（将来復活時に利用）
- 数量割引廃止箇所に `// 2026-04 数量割引廃止: 外注費計上による利益構造見直しのため` コメントを残す
- UI（進捗バー・バッジ）は **削除または非表示** にする（残すとユーザーが混乱）

### 3-2. 送料無料閾値変更にあたって
- `Constants.gs:64` と Script Property `CONFIG_FREE_SHIP_THRESHOLD` の **両方** を30000に統一
- D1 settings の `config_free_ship_threshold` も同期（`SyncApi.gs:467-468` 経由）
- `grep -rn "10000" saisun-list/` で検索する際、**パスワードハッシュ反復(10000)・ロックタイムアウト(10000)・デバッグ閾値** など無関係な10000を除外する

### 3-3. 沖縄・離島除外にあたって
- **ダイヤモンド会員は沖縄・離島でも送料無料を維持**（特典として）
- **優先順位は固定:**
  1. ダイヤモンド会員 → 無料（地域問わず）
  2. クーポン `shipping_free` → 無料（沖縄・離島**対象外**）
  3. 商品合計 ≥ ¥30,000 → 無料（沖縄・離島**対象外**）
  4. 該当なし → 通常計算
- `isRemoteIsland_()` 判定は `Config.gs:435` の既存関数を使う
- 沖縄判定は `Config.gs:390` の `'沖縄県': 'okinawa'` マッピング / CartCalc.html:88 の都道府県配列を使う
- ユーザー向け表示: 「沖縄・離島は送料無料対象外です（ダイヤモンド会員除く）」を明記

### 3-4. FHP期限前倒し
- `Config.gs:254` の `endDate: '2026-12-31'` → `'2026-09-30'` に変更
- Script Property `FIRST_HALF_PRICE_END_DATE` が設定されている場合は **上書き必要**（運用値が優先されるため）
- 期限切れ自動OFFロジック（`Config.gs:268-270`）はそのまま動く（endDate + 23:59:59 JST 経過で `reason='expired'`）
- **会員割引の期限と同日** になるため、UIで「9月末に両キャンペーン終了」の告知を検討

### 3-5. 告知
**顧客への事前告知は行わない。** サイト内の文言更新（プロモバー・購入ガイド・チャットBOT・FAQ）のみで実質的な告知とする。サイト内バナー追加・会員メール・FAQ更新ポップアップ等の能動的告知は不要。

---

## 4. 実装手順

### Step 1: ローカルでコード変更
1. **設定・定数の変更** （Constants.gs, Config.gs, AdminPanelApi.gs）
2. **GAS計算ロジック** （SubmitFix.gs, BulkSubmit.gs）
3. **フロント計算＆UI** （CartCalc.html, index.html, BulkLP.html）
4. **Workers** （workers/gas-proxy/src/handlers/submit.js）
5. **文言系** （Chatbot.gs, docs/, メール生成関数）

### Step 2: ローカル検証

#### テストケース（`Tests.gs` に追加 or 手動確認）

| # | シナリオ | 期待結果 |
|---|---|---|
| 1 | 関東・一般会員・10点¥5,850 | 送料¥1,680請求、数量割引なし、会員10%適用 |
| 2 | 関東・ダイヤ会員・¥25,000 | 送料¥0（ダイヤ特典） |
| 3 | 関東・一般会員・¥29,999 | 送料請求（閾値未満） |
| 4 | 関東・一般会員・¥30,000 | 送料¥0（閾値到達） |
| 5 | 沖縄・一般会員・¥35,000 | **送料請求**（沖縄は対象外） |
| 6 | 沖縄・ダイヤ会員・¥5,000 | 送料¥0（ダイヤ特典優先） |
| 7 | 離島・一般会員・¥40,000 | 発送不可エラー（既存動作） |
| 8 | 送料無料クーポン＋沖縄・¥20,000 | **送料請求**（クーポンも沖縄除外） |
| 9 | デタウリ100点注文 | 数量割引0%、会員割引のみ |
| 10 | 2026-10-01時計（FHP期限後） | FHP `reason='expired'`、会員割引も `reason='expired'` |
| 11 | チャットBOT「送料無料は？」 | 「3万円以上、沖縄離島除く」と回答 |

### Step 3: デプロイ（即時・3層同時）

```bash
# 0. 現状確認
git status
grep -c "10000" saisun-list/Constants.gs  # 変更後0になっているか

# 1. GAS デプロイ
clasp push 2>&1 && \
DEPLOY_ID="AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg" && \
clasp deploy -i "$DEPLOY_ID" --description "価格ロジック改定: 数量割引廃止/送料無料¥30,000/沖縄離島除外/FHP9月末" 2>&1

# 2. Cloudflare Pages（GitHub main push で自動デプロイ）
git add -A && \
git commit -m "価格ロジック改定: 数量割引廃止・送料無料閾値¥30,000・沖縄離島除外・FHP期限2026-09-30前倒し" && \
git push

# 3. Workers
cd workers/gas-proxy && wrangler deploy && cd ../..

# 4. Script Properties 更新は不要
# 2026-04-22 23:43確認時点で関連キーは全てnull（未設定）
# → Constants.gs / Config.gs のデフォルト定数変更だけで反映される

# 5. D1 settings 同期（SyncApi.gs 経由で自動同期 or 直接SQL）
```

### Step 4: 本番確認

1. 本番URL（`wholesale.nkonline-tool.com`）で:
   - [ ] プロモバー文言が「3万円以上」になっている
   - [ ] デタウリ10点カート → 数量割引表示なし
   - [ ] 合計¥30,000未満 → 送料請求
   - [ ] 合計¥30,000以上（関東） → 送料無料
   - [ ] 住所を沖縄にして¥35,000 → 送料請求
   - [ ] 購入ガイド・送料表の文言
2. Workers経由の `/api/submit` で実際の価格計算を1件通す
3. AdminPanelの設定値確認（FREE_SHIP_THRESHOLD=30000、数量割引セクション停止中）
4. チャットBOTで「送料無料の条件は？」と聞いて正しい回答を返すか

---

## 5. リスクと対策

| リスク | 対策 |
|---|---|
| GAS / フロント / Workers の計算値ズレ | 3層を**同一コミット**で変更、デプロイも連続実施 |
| Script Property が古い値のまま上書きされない | デプロイ後に必ず管理画面で現在値を確認 |
| 沖縄住所の判定漏れ | `Config.gs:390` と `CartCalc.html:88` の両方で沖縄県判定、送料エリア `'okinawa'` を唯一の真実とする |
| 既存の進行中カート（セッション）の価格変動 | カート表示時に再計算されるため実質的に影響なし |
| D1 settings 未同期で Workers だけ旧閾値のまま | Workers側fallbackを30000に直接ハードコードすれば安全 |
| チャットBOTで旧情報が残る | `Chatbot.gs` と `BulkLP.html:4971-4987` の両方を更新（2箇所ある） |
| メール文言の取りこぼし | `SubmitFix.gs` の `buildConfirmMail_` 等を grep で確認 |

---

## 6. ロールバック手順（緊急時・3層同時ロールバック必須）

**片方だけ戻すと計算不整合が発生する** ため、以下3つを必ずセットで実施:

```bash
# 1. GAS ロールバック（GASエディタ「バージョン管理」→ 前バージョンにデプロイ）
# または:
DEPLOY_ID="AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg"
# 前のコミットにチェックアウト後 clasp push
git revert HEAD && git push
clasp push && clasp deploy -i "$DEPLOY_ID" --description "rollback: 価格ロジック改定"

# 2. Workers ロールバック
cd workers/gas-proxy && wrangler rollback

# 3. Cloudflare Pages（git revert で自動デプロイ）
# 上の git revert で同時対応

# 4. Script Properties / D1 settings も旧値に戻す
# CONFIG_FREE_SHIP_THRESHOLD: 10000
# FIRST_HALF_PRICE_END_DATE: 2026-12-31
```

---

## 7. 実装承認チェックリスト（着手前確認）

- [x] **変更内容7項目**（数量割引廃止・送料無料¥30,000・沖縄離島除外・ダイヤ特典維持・会員期限確認・FHP9月末前倒し・値引率ガードなし）で合意
- [x] **タイミング**: 即時適用（デプロイ後即時）で合意
- [x] **反映範囲**: GAS / フロント / Workers / ガイド・チャットBOT・メール全て で合意
- [x] **告知なし**（サイト内文言更新のみで実質告知とする）
- [x] **Script Properties 確認済み**（2026-04-22 23:43 確認）: 関連キーは全て null → デフォルト参照のためコード定数変更のみで反映
- [ ] **検証テストケース11件**を手動 or 自動で全て通す
- [ ] **作業完了後の自動コミット＆プッシュ**（main直接）で進めてよい

---

## 8. 参考: 現行コード構造ダンプ

### 数量割引（廃止対象）
```javascript
// CartCalc.html:15-24
function bulkDiscountRate(count) {
  if (count >= 100) return 0.20;
  if (count >= 50)  return 0.15;
  if (count >= 30)  return 0.10;
  if (count >= 10)  return 0.05;
  return 0;
}
// 変更後:
function bulkDiscountRate(count) {
  return 0;  // 2026-04 数量割引廃止: 外注費計上による利益構造見直しのため
}
```

### 送料無料判定（閾値＋沖縄除外）
```javascript
// CartCalc.html:219-226（変更後イメージ）
var freeShipThreshold = 30000;  // ← 10000から引き上げ
var diamondFree = customer && customer.rank && customer.rank.freeShipping;
var isOkinawaOrRemote = (area === 'okinawa') || result.isRemoteIsland;
var couponFreeShip = coupon && coupon.type === 'shipping_free' && !isOkinawaOrRemote;
var thresholdFree = !fhpApplied && combinedDiscountedProduct >= freeShipThreshold && !isOkinawaOrRemote;
// ダイヤモンド会員はisOkinawaOrRemoteに関係なく無料（diamondFree優先）
```

### FHP期限
```javascript
// Config.gs:252-254（変更後）
var FIRST_HALF_PRICE_DEFAULTS = {
  rate: 0.50,
  endDate: '2026-09-30'  // ← '2026-12-31' から前倒し
};
```

### 計算ステップ順序（変更なし）
```
1. FHP 適用チェック
   ├─ 適用 → 初回全品50%OFF / 他割引無効 / 送料かかる
   └─ 非適用 ↓
2. 数量割引 ← **廃止（return 0）**
3. 会員割引 10%OFF
4. クーポン控除
5. 送料計算
   ├─ ダイヤモンド → 無料（地域問わず）
   ├─ クーポン shipping_free → 無料（沖縄・離島除外）
   ├─ 合計≥¥30,000 → 無料（沖縄・離島除外・FHP時除外・価格破壊商品除外）
   └─ それ以外 → 通常料金（エリア×サイズ）
6. ポイント利用
```

---

**このプランで進めて問題なければ、コード変更に着手する。**
