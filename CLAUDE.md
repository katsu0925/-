# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開発ルール

- **すべての応答・コメント・コミットメッセージは日本語で記述する**
- **mainブランチで直接作業する** — フィーチャーブランチは作成しない
- **作業完了後は自動でコミット＆プッシュする**
- **`clasp push` の後に必ず `clasp deploy -i "$DEPLOY_ID"` も実行する** — push だけでは本番 Web App に反映されない

## プロジェクト構成

Google Apps Script (GAS) モノレポ + Cloudflare Workers エッジプロキシ。GAS側にビルドシステムは存在しない。

| ディレクトリ | 用途 |
|---|---|
| `saisun-list/` | メインプロジェクト（57 .gs/.html ファイル）。`.clasp.json` の `rootDir` はここを指す |
| `shiire-kanri/` | 仕入れ管理・在庫管理 |
| `saisun-list-bulk/` | Cron系（記事生成・GA4・報酬管理）の別GASプロジェクト |
| `workers/gas-proxy/` | Cloudflare Workers エッジプロキシ（D1 + KV） |

## デプロイコマンド

### GAS デプロイ（saisun-list）

```bash
# pushとdeployは常にセットで実行する
clasp push 2>&1 && \
DEPLOY_ID="AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg" && \
clasp deploy -i "$DEPLOY_ID" --description "変更内容" 2>&1
```

> **注意:** `clasp deploy` を `-i` なしで実行すると毎回別URLの新デプロイが作成される。
> 本番デプロイは上記の DEPLOY_ID 1本に固定して運用する。

### Cloudflare Workers デプロイ

```bash
cd workers/gas-proxy
wrangler deploy              # 本番
wrangler deploy --env dev    # 開発
```

### Cloudflare Pages

`wholesale-eco.pages.dev` — GitHub main ブランチへの push で自動デプロイ。
`saisun-list/index.html` と `saisun-list/BulkLP.html` が静的配信される。

## テスト実行

テストフレームワークはGAS上で動作するカスタム実装（`saisun-list/Tests.gs`）。GASエディタから実行する。

```javascript
// 全テストスイート実行（開発環境のみ）
setEnvDevelopment()  // まずdev環境に切り替え
runAllTests()        // 10スイート実行
setEnvProduction()   // 本番に戻す
```

テストスイート: `testSuite_Auth_`, `testSuite_Payment_`, `testSuite_Order_`, `testSuite_Util_`, `testSuite_Integration_Auth_`, `testSuite_Integration_Payment_`, `testSuite_Security_`, `testSuite_EdgeCases_`, `testSuite_Rank_`, `testSuite_CsrfEnv_`

## アーキテクチャ

**バックエンド:** Google Apps Script（V8ランタイム）
**データストア:** Google Sheets（DBの代替）
**決済:** KOMOJU（クレカ・コンビニ・銀行振込・PayPay等）
**EC連携:** BASE
**ホスティング:** GAS Web App（`doGet`/`doPost` エントリポイント）

```
ユーザー → wholesale.nkonline-tool.com (カスタムドメイン)
  → Cloudflare Workers (detauri-gas-proxy)
    → HTMLリクエスト: Cloudflare Pages (wholesale-eco.pages.dev) から取得
       → HTMLRewriter で KV の商品データを埋め込んで返す
    → APIリクエスト (/api/*): D1/KV で高速処理、未対応は GAS にプロキシ
  → GAS Web App (Code.gs: doGet/doPost)
    → Google Sheets (データ1 / 依頼管理 / 顧客管理)
  ← 仕入れ管理 (shiire-kanri) ─ onEditトリガーで同期
```

### saisun-list の主要ファイル責務

| ファイル | 責務 |
|---|---|
| `Code.gs` | `doGet`/`doPost`、レート制限、reCAPTCHA、リクエストルーティング |
| `Config.gs` | `APP_CONFIG`（スプレッドシートID、送料テーブル、ブランドリスト） |
| `Constants.gs` | マジックナンバー・定数の集約 |
| `ApiPublic.gs` | 公開API（検索、確保、注文、メール通知） |
| `CustomerAuth.gs` | 認証（登録/ログイン/セッション/ランク/ポイント） |
| `KOMOJU.gs` | KOMOJU決済セッション作成・Webhook処理・署名検証 |
| `SubmitFix.gs` | 注文送信（高速版）、Drive確認ファイル生成 |
| `Product.gs` | 商品データ読み込み・CacheServiceキャッシュ |
| `StateStore.gs` | 確保/依頼中状態の永続化 |
| `Triggers.gs` | onEditハンドラ、トリガー設定 |
| `Tests.gs` | 自動テストスイート |

### フロントエンド HTML 構造

- `index.html` — デタウリ個品ページ。GAS テンプレート `<?!= include_('CartCalc') ?>` で CartCalc.html をインライン展開
- `BulkLP.html` — アソート商品ページ。同様に CartCalc をインクルード
- `CartCalc.html` — カート計算・割引・送料の共通モジュール（`var CartCalc = (function(){...})()`）
- Cloudflare Pages では GAS テンプレートタグが処理されないため、フォールバックで CartCalc.js を読み込む仕組みあり
- 商品データは `<script id="__initial_products__">` にサーバー埋め込み。Workers の HTMLRewriter で KV データを注入

### Cloudflare Workers (workers/gas-proxy/)

| ハンドラ | 責務 |
|---|---|
| `products.js` | 商品データ（D1/KV キャッシュ） |
| `session.js` | CSRF トークン |
| `auth.js` | 認証（D1 customers テーブル） |
| `submit.js` | 注文送信・割引計算（GAS SubmitFix.gs と統一ロジック） |
| `holds.js` | 商品確保 |
| `coupon.js` | クーポン検証 |
| `mypage.js` | マイページ・ランク判定 |
| `proxy.js` | 未対応 API を GAS にプロキシ |

Workers は Phase 1（商品+CSRF）のみ有効化済み。Phase 2-5 は `index.js` のコメント解除で段階的に有効化。

### 割引ロジック（CartCalc / SubmitFix.gs / Workers submit.js 共通）

1. **FHP有効時:** 初回全品50%OFF → 他割引無効
2. **通常:** 数量割引（30点10%/50点15%/100点20%）→ 会員割引（10%）→ クーポン控除（割引後金額ベース）
3. **送料:** ダイヤモンド(累計50万円以上)→無料 / クーポン送料無料 / 1万円以上→無料 / 厚み分類ベース計算
4. **アソート商品:** 数量割引は適用しない（デタウリ個品のみ）

### データフロー

**商品掲載:**
```
仕入れ管理 (onEditトリガー) → データ1シート → exportProductData_(5分) → CacheService → フロントエンド
```

**注文フロー:**
```
apiSyncHolds (15分確保) → apiSubmitEstimate (注文送信) → 依頼管理シート書き込み
  → Drive確認ファイル生成 (I列にURL) → メール通知 (管理者+顧客)
  → M列「発送済み」変更 (onEdit) → 発送通知メール → P列「完了」自動更新
```

**決済フロー（KOMOJU）:**
```
apiCreateKomojuSession → KOMOJUページ → Webhook → HMAC-SHA256検証 → confirmPaymentAndCreateOrder
```

### スプレッドシート構造（主要列）

**依頼管理シート:** A=受付番号, D=メール, H=商品名, I=確認リンク(Drive URL), L=合計金額, M=発送ステータス, P=ステータス, R=入金確認, AA=通知フラグ, AB=ポイント付与済

**顧客管理シート:** A=ID, B=メール, C=パスワードハッシュ(v2:salt:hash), K=セッションID, L=セッション有効期限, M=ポイント残高

### セキュリティ実装

- **パスワードハッシュ:** `v2:salt:SHA-256×10000回` 形式。ログイン時にv1/legacyから自動移行
- **CSRF:** `apiGetCsrfToken` でユーザー別トークン（CacheService、1時間有効）。状態変更APIで必須
- **レート制限:** 各APIに個別上限（例: `apiLoginCustomer` 5回/時間、`apiSyncHolds` 30回/分）
- **Webhook検証:** KOMOJU Webhook はHMAC-SHA256署名をタイミングセーフ比較で検証

### 自動トリガー

| 関数 | 頻度 | 用途 |
|---|---|---|
| `exportProductData_` | 5分 | 商品JSON更新 |
| `syncListingPublicCron` | 1分 | 仕入れ→データ1同期 |
| `baseSyncOrdersNow` | 5分 | BASE注文同期 |
| `od_compactHolds_` | 毎日4時 | 期限切れ確保クリーンアップ |
| `shipMailOnEdit` | onEdit | M列変更で発送通知 |

## スクリプトプロパティ（必須）

| キー | 用途 |
|---|---|
| `RECAPTCHA_SECRET` | reCAPTCHA v3 |
| `ADMIN_KEY` | 管理者API認証 |
| `ADMIN_OWNER_EMAIL` | 管理者通知先 |
| `KOMOJU_SECRET_KEY` | KOMOJU API認証 |
| `KOMOJU_WEBHOOK_SECRET` | Webhook署名検証 |
| `ENV` | `production` / `staging` / `development` |

詳細は `saisun-list/docs/` 配下を参照: `ARCHITECTURE.md`, `API.md`, `DEPLOY.md`
