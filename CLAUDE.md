# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開発ルール

- **mainブランチで直接作業する** — フィーチャーブランチは作成しない
- **作業完了後は自動でコミット＆プッシュする**

## プロジェクト構成

Google Apps Script (GAS) モノレポ。ビルドシステム（npm等）は存在しない。

| ディレクトリ | 用途 |
|---|---|
| `saisun-list/` | メインプロジェクト（37+ .gs ファイル）。`.clasp.json` の `rootDir` はここを指す |
| `shiire-kanri/` | 仕入れ管理・在庫管理（16 .gs ファイル） |
| `saisun-list-bulk/` | バルク・アソート商品バリアント |

## デプロイコマンド

```bash
# ローカルからGASへプッシュ（rootDir: saisun-list を対象）
clasp push

# 既存の本番デプロイを更新（必ず -i でIDを指定する。指定しないと新デプロイが作られてしまう）
DEPLOY_ID="AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg"
clasp deploy -i "$DEPLOY_ID" --description "変更内容"

# デプロイ一覧確認
clasp deployments
```

> **注意:** `clasp deploy` を `-i` なしで実行すると毎回別URLの新デプロイが作成される。
> 本番デプロイは上記の DEPLOY_ID 1本に固定して運用する（旧バージョン確認は GitHub で行う）。

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
フロントエンド (Cloudflare Pages)
  ↕ JSON over HTTP
GAS Web App (Code.gs: doGet/doPost)
  ↕
Google Sheets (データ1 / 依頼管理 / 顧客管理)
  ↑
仕入れ管理 (shiire-kanri) ─ onEditトリガーで同期
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
