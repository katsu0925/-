# デタウリ.Detauri 運用書

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [フロントエンド](#3-フロントエンド)
4. [Cloudflare Workers](#4-cloudflare-workers)
5. [GAS バックエンド](#5-gas-バックエンド)
6. [決済フロー（KOMOJU）](#6-決済フローkomoju)
7. [注文フロー](#7-注文フロー)
8. [同期メカニズム（GAS ↔ D1）](#8-同期メカニズムgas--d1)
9. [スプレッドシート構造](#9-スプレッドシート構造)
10. [顧客認証・ランク・ポイント](#10-顧客認証ランクポイント)
11. [メールシステム](#11-メールシステム)
12. [自動トリガー・Cron](#12-自動トリガーcron)
13. [セキュリティ](#13-セキュリティ)
14. [デプロイ手順](#14-デプロイ手順)
15. [テスト](#15-テスト)
16. [日常運用タスク](#16-日常運用タスク)
17. [トラブルシューティング](#17-トラブルシューティング)
18. [ファイル一覧](#18-ファイル一覧)

---

## 1. システム概要

デタウリ.Detauri は採寸データ付き古着卸のECプラットフォーム。

| コンポーネント | 技術 |
|---|---|
| バックエンド | Google Apps Script (GAS) V8ランタイム |
| エッジレイヤー | Cloudflare Workers + D1 + KV |
| フロントエンド | HTML5/JS (GAS Web App + Cloudflare Pages) |
| データストア | Google Sheets |
| 決済 | KOMOJU（クレカ・コンビニ・銀行振込・PayPay・ペイジー・Apple Pay・Paidy） |
| EC連携 | BASE |
| メール | GmailApp（顧客向け）/ MailApp（管理者向け） |
| 通知 | LINE Messaging API（管理者通知） |
| 分析 | Google Analytics 4 (GA4) |

---

## 2. アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│              Frontend (HTML/JS)                      │
│         index.html (デタウリ) + BulkLP.html (アソート) │
└──────────────────────┬──────────────────────────────┘
                       │ JSON over HTTP
                       ▼
┌─────────────────────────────────────────────────────┐
│        Cloudflare Workers (Edge Layer)               │
│  Products / Auth / Holds / Coupon / Submit           │
│  レート制限 / CSRF / 未対応APIはGASにフォールバック    │
├──────────┬──────────────────────┬────────────────────┤
│  D1 DB   │    KV Cache          │   GAS Web App      │
│ (5分同期) │  (商品/セッション)    │  (doGet/doPost)    │
└──────────┴──────────────────────┴─────────┬──────────┘
                                            │
              ┌─────────────────────────────┘
              ▼
┌─────────────────────────────────────────────────────┐
│           Google Sheets (Data Layer)                  │
│  データ1 / 依頼管理 / 顧客管理 / 確保 / 依頼中       │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
          KOMOJU    Google     BASE
         (決済)    Drive/GA4  (EC連携)
```

### データフロー方向

| データ | 方向 | 説明 |
|---|---|---|
| 商品 | Sheets → D1 → KV → Frontend | 5分ごとのCron同期 |
| 顧客 | 双方向 | 登録/ログインはD1、ポイント/購入はSheets |
| 注文 | Frontend → Workers → KOMOJU → GAS → Sheets | 決済完了時にシート書き込み |
| 確保 | D1管理、Sheetsにも同期 | 15分（通常）/30分（会員） |
| クーポン | Sheets → D1 | 5分同期 |

---

## 3. フロントエンド

### 3.1 デタウリLP: `index.html`（約8,275行）

- 商品一覧（検索・フィルタ・ソート）
- ショッピングカート（localStorage永続化）
- ユーザー認証（ログイン/会員登録）
- チェックアウト（住所入力・決済方法選択・クーポン・ポイント）
- GA4: `G-NYPY0S7Q6S`
- reCAPTCHA v3

### 3.2 アソートLP: `BulkLP.html`（約5,364行）

- アソート商品一覧（最小/最大数量制約あり）
- 独立カートシステム
- モバイル: ボトムシートUI（商品詳細）
- デタウリ商品との混合注文対応

---

## 4. Cloudflare Workers

### 4.1 ルーティング

**ファイル**: `workers/gas-proxy/src/index.js`

Workers対応APIは `WORKER_HANDLED` マップで管理。マップにないAPIは自動でGASにプロキシ。

```
Phase 1 (Read):   apiGetCachedProducts, apiBulkInit
Phase 2 (Auth):   apiLoginCustomer, apiRegisterCustomer, apiLogoutCustomer, apiValidateSession
Phase 3 (State):  apiGetStatusDigest, apiSyncHolds, apiCancelPendingPayment, apiValidateCoupon
Phase 4 (MyPage): apiGetMyPage, apiGetReferralCode
Phase 5 (Order):  apiSubmitEstimate（価格計算+KOMOJU決済セッション作成）
```

**ロールバック**: `WORKER_HANDLED` からエントリを削除するだけでGASにフォールバック。

### 4.2 主要ハンドラ

| ファイル | 責務 |
|---|---|
| `handlers/auth.js` | ログイン/登録/ログアウト |
| `handlers/products.js` | 商品キャッシュ・アソート初期化 |
| `handlers/session.js` | セッション検証・CSRF |
| `handlers/holds.js` | カート確保/解除（15分/30分） |
| `handlers/coupon.js` | クーポン検証 |
| `handlers/submit.js` | 注文送信・KOMOJU連携・ペンディング管理 |
| `handlers/proxy.js` | GASフォールバックプロキシ |

### 4.3 レート制限

| API | 上限 |
|---|---|
| apiSubmitEstimate | 5回/時間 |
| apiBulkSubmit | 5回/時間 |
| apiSyncHolds | 30回/分 |
| apiLoginCustomer | 30回/時間 |
| apiRegisterCustomer | 20回/時間 |
| apiSendContactForm | 3回/時間 |

---

## 5. GAS バックエンド

### 5.1 主要ファイル

| ファイル | 責務 |
|---|---|
| `Code.gs` | `doGet`/`doPost` エントリポイント、レート制限、reCAPTCHA |
| `Config.gs` | APP_CONFIG（SS ID、送料テーブル、ブランドリスト） |
| `Constants.gs` | 定数集約（認証・決済・シート列・サイト情報） |
| `ApiPublic.gs` | 公開API（検索、確保、注文、メール） |
| `CustomerAuth.gs` | 認証（登録/ログイン/セッション/ランク/ポイント） |
| `KOMOJU.gs` | KOMOJU決済セッション作成・Webhook処理・署名検証 |
| `SubmitFix.gs` | 注文送信（高速版）、Drive確認ファイル生成 |
| `Product.gs` | 商品データ読み込み・CacheServiceキャッシュ |
| `StateStore.gs` | 確保/依頼中状態の永続化 |
| `SyncApi.gs` | D1 ↔ Sheets 同期API |
| `Triggers.gs` | onEditハンドラ、トリガー設定 |
| `受注管理.gs` | 依頼展開（回収完了・XLSX生成・売却反映） |

### 5.2 設定値

**Script Properties（必須）**:

| キー | 用途 |
|---|---|
| `RECAPTCHA_SECRET` | reCAPTCHA v3 |
| `ADMIN_OWNER_EMAIL` | 管理者通知先 |
| `KOMOJU_SECRET_KEY` | KOMOJU API認証 |
| `KOMOJU_WEBHOOK_SECRET` | Webhook署名検証 |
| `SYNC_SECRET` | Workers→GAS同期認証 |
| `ENV` | `production` / `staging` / `development` |
| `MEMBER_DISCOUNT_ENABLED` | 会員割引ON/OFF |
| `MEMBER_DISCOUNT_END_DATE` | 会員割引期限 |
| `FIRST_HALF_PRICE_ENABLED` | 初回半額ON/OFF |
| `OPENAI_API_KEY` | AI説明文生成（依頼展開） |

---

## 6. 決済フロー（KOMOJU）

### 6.1 対応決済方法

| 方法 | コード | Webhookイベント | 入金確認Q列 |
|---|---|---|---|
| クレジットカード | `credit_card` | `payment.captured` | 対応済 |
| PayPay | `paypay` | `payment.captured` | 対応済 |
| Apple Pay | `apple_pay` | `payment.captured` | 対応済 |
| Paidy | `paidy` | `payment.captured` | 対応済 |
| コンビニ払い | `konbini` | `payment.authorized` | 入金待ち |
| 銀行振込 | `bank_transfer` | `payment.authorized` | 入金待ち |
| ペイジー | `pay_easy` | `payment.authorized` | 入金待ち |

### 6.2 決済フロー

```
Frontend → apiSubmitEstimate (Workers)
  → 価格計算・バリデーション
  → KOMOJU決済セッション作成
  → ペンディング注文データ保存（GAS Script Properties + D1）
  → セッションURL返却

顧客 → KOMOJUページで決済

KOMOJU → Webhook → GAS handleKomojuWebhook()
  → HMAC-SHA256署名検証
  → KOMOJU APIで決済状態を裏取り
  → payment.captured → 対応済
  → payment.authorized（コンビニ等）→ 入金待ち
  → confirmPaymentAndCreateOrder()
    → 依頼管理シートに書き込み
    → Drive確認ファイル生成
    → メール通知（顧客+管理者）
    → プレミアムアソート → 自動選定 → 自動展開
```

### 6.3 後払い入金完了時

コンビニ・銀行振込・ペイジーで実際に入金された際:

```
KOMOJU → Webhook: payment.updated
  → handlePaymentUpdated_() (KOMOJU.gs:457)
  → API検証 → captured確認
  → 依頼管理Q列「入金待ち」→「未対応」に更新
  → 入金確認メールを顧客に送信
```

---

## 7. 注文フロー

### 7.1 価格計算順序

`SubmitFix.gs:101-183` / `submit.js:322-357`（CartCalcと同一順序）

1. **初回全品半額（FHP）** — 有効+ログイン+購入回数0 → 他の割引と併用不可
2. **数量割引（デタウリのみ）** — 10点5% / 30点10% / 50点15% / 100点20%
3. **会員割引** — 10%OFF（ログイン必須、会員割引ON時）
4. **クーポン** — rate型 / fixed型 / shipping_free型

割引は備考欄（AD列）に記録される（例: `【数量割引5%OFF + 会員割引10%OFF】`）。

### 7.2 送料計算

- 箱サイズ: ≤10点=小、>10点=大
- 13地域別料金テーブル（`Config.gs` SHIPPING_RATES）
- 送料無料条件: ダイヤモンド会員 / 送料無料クーポン / 1万円以上（※FHP適用時は1万円以上送料無料は対象外）
- 離島は配送対象外（35+地域）

### 7.3 プレミアムアソート自動処理

`SubmitFix.gs:1509-1720`

**対象商品**:

| 商品名キーワード | 目標金額 | 最低点数 |
|---|---|---|
| プレミアムアソート小ロット | ¥5,600 | 10点 |
| プレミアムアソート中ロット | ¥13,500 | 20点 |
| プレミアムアソート大ロット | ¥26,700 | 30点 |

**自動フロー**:
1. 決済完了 → `detectPremiumAssort_()` でキーワード検出
2. `selectProductsForPremiumAssort_()` で商品選定（シーズン考慮、90%オンシーズン目標）
3. J列に管理番号書き込み
4. `om_executeFullPipeline_()` で自動展開（回収完了・XLSX生成・売却反映）

### 7.4 依頼展開パイプライン

`受注管理.gs:260-640` — `expandOrder()` メニューまたは自動実行

1. **Phase 1**: 仕入れ管理 → 回収完了シートに商品展開
2. **Phase 2**: 配布用リスト生成 + OpenAI API（gpt-4o-mini）でメルカリ説明文自動生成（20件/バッチ）
3. **XLSX出力**: 配布用リストをExcelファイルとしてDriveに保存 → I列に確認リンク
4. **Phase 3**: 商品管理ステータス → 「売却済み」、BO列 → 受付番号
5. **後処理**: 売却履歴ログ書き込み、回収完了行削除

---

## 8. 同期メカニズム（GAS ↔ D1）

### 8.1 Export（Sheets → D1）

**API**: `apiSyncExportData()` — `SyncApi.gs:20`
**呼び出し元**: Workers Cron（5分ごと）
**認証**: `SYNC_SECRET`

| テーブル | ソース | 内容 |
|---|---|---|
| products | データ1シート | 商品データ（25列） |
| bulkProducts | アソート商品管理 | アソート商品 |
| customers | 顧客管理シート | 顧客（メール・ハッシュ・ポイント等） |
| openItems | 依頼中シート | 依頼中ステータス |
| coupons | クーポン管理 | クーポン（18列） |
| settings | Script Properties | 会員割引・FHP・送料設定 |
| stats | StatsCache | 統計データ |

### 8.2 Import（D1 → Sheets）

**API**: `apiSyncImportData()` — `SyncApi.gs:89`

D1で新規登録された顧客をSheetsに反映（既存メールはスキップ）。

### 8.3 KVキャッシュ

Workers Cron同期後、D1データをKVにプリウォーム:
- 商品一覧JSON
- ステータスダイジェスト
- `sheetTotalCount`（データ1 B1の掲載中件数）

---

## 9. スプレッドシート構造

### 9.1 依頼管理（33列 A-AG）

| 列 | 名前 | 用途 |
|---|---|---|
| A | 受付番号 | YYYYMMDDHHmmss-NNN |
| B | 依頼日時 | 注文タイムスタンプ |
| C | 会社名/氏名 | 顧客名 |
| D | 連絡先 | メールアドレス |
| E | 郵便番号 | |
| F | 住所 | |
| G | 電話番号 | |
| H | 商品名 | カンマ区切り |
| I | 確認リンク | Drive確認ファイルURL |
| J | 選択リスト | 管理番号リスト |
| K | 合計点数 | デタウリは何点でも1 |
| L | 合計金額 | 割引適用後（送料別） |
| M | 送料(店負担) | |
| N | 送料(客負担) | |
| O | 決済方法 | 日本語表示名 |
| P | 決済ID | KOMOJU payment ID |
| Q | 入金確認 | 対応済/入金待ち/未対応 |
| R | ポイント付与済 | |
| S | 発送ステータス | 未着手/発送済み |
| T | 配送業者 | |
| U | 伝票番号 | |
| V | ステータス | 依頼中/完了/キャンセル/返品 |
| W | 担当者 | |
| X | リスト同梱 | 未/済 |
| Y | xlsx送付 | 未/済 |
| Z | インボイス発行 | |
| AA | インボイス状況 | |
| AB | 受注通知 | |
| AC | 発送通知 | |
| AD | 備考 | 割引・送料・ポイント情報 |
| AE | 作業報酬 | |
| AF | 更新日時 | |
| AG | チャネル | デタウリ/アソート/まとめ |

### 9.2 顧客管理（16列 A-P）

| 列 | 名前 | 備考 |
|---|---|---|
| A | ID | 顧客ID |
| B | メール | ログインキー |
| C | パスワード | `v2:salt:hash` 形式 |
| D | 会社名/氏名 | |
| E | 電話番号 | |
| F | 郵便番号 | |
| G | 住所 | |
| H | メルマガ | TRUE/FALSE |
| I | 作成日時 | |
| J | 最終ログイン | |
| K | セッションID | 32文字ランダム |
| L | セッション有効期限 | 24時間 or 30日 |
| M | ポイント残高 | |
| N | ポイント更新日時 | |
| O | 購入回数 | FHP判定に使用 |
| P | LINE UserID | |

### 9.3 データ1（商品カタログ）

- **B1セル**: 掲載中件数（sheetTotalCount同期用）
- **ヘッダ行**: 2行目
- **データ行**: 3行目～
- **読み取り列数**: 25（A-Y）
- **K列**: 管理番号
- **I列**: 価格

---

## 10. 顧客認証・ランク・ポイント

### 10.1 パスワードハッシュ

`CustomerAuth.gs:33-100`

- **現行**: `v2:salt:SHA-256×1,000回`
- **旧形式**: v1（10,000回）、legacy（1回）→ ログイン時に自動移行

### 10.2 セッション

- ID: 32文字ランダム
- 有効期限: 24時間（通常）/ 30日（RememberMe）
- 保存先: 顧客管理 K列・L列

### 10.3 ランク

`CustomerAuth.gs:1128`

| ランク | 年間購入額 | 特典 |
|---|---|---|
| Bronze | < ¥100k | — |
| Silver | ¥100k〜300k | — |
| Gold | ¥300k〜500k | — |
| Platinum | ¥500k〜1M | — |
| Diamond | ≥ ¥1M | **全送料無料** |

### 10.4 ポイント

- 登録時: +500ポイント
- 購入時: ¥1 = 1ポイント
- 有効期限: 付与から1年
- 利用: チェックアウト時に1pt = 1円で使用
- 処理: `processCustomerPointsAuto_()` 毎日4時

---

## 11. メールシステム

### 11.1 顧客向けメール

`GmailApp.sendEmail()` — FROM: `nkonline1030@gmail.com`

| 種別 | ファイル | トリガー |
|---|---|---|
| 注文確認 | `SubmitFix.gs` | 決済完了時 |
| 入金確認 | `KOMOJU.gs` | 後払い入金時 |
| 発送通知 | `発送通知.gs` | S列=発送済み（onEdit） |
| 入金リマインド | `PaymentReminder.gs` | 毎日9時 |
| カゴ落ち | `AbandonedCart.gs` | 30分ごと |
| 新着通知 | `NewArrivalNotify.gs` | 毎日10時 |
| フォローアップ | `FollowupEmail.gs` | 毎日11時 |
| ニュースレター | `Newsletter.gs` | 毎日9時 |
| ポイント期限 | `PointExpiry.gs` | 毎日4時 |
| 認証（登録/PW変更） | `CustomerAuth.gs` | 即時 |

### 11.2 管理者向けメール

`MailApp.sendEmail()` — FROM: スクリプトオーナー（`noReply: true`）

| 種別 | ファイル |
|---|---|
| GA4週次/警告レポート | `GA4Advice.gs` |
| 在庫サマリ | `StockSummaryEmail.gs` |
| 業務サマリ | `Triggers.gs` |
| 各種管理通知 | `PaymentReminder.gs`（admin宛） |

---

## 12. 自動トリガー・Cron

### 12.1 Workers Cron

| スケジュール | 処理 |
|---|---|
| `*/5 * * * *` | D1 ↔ Sheets同期（`scheduledSync`） |

### 12.2 GAS時間トリガー

`Triggers.gs:58-129` — `tr_setupTriggersOnce_()` で初回設定

| 関数 | 頻度 | 用途 |
|---|---|---|
| `syncListingPublicCron` | 1分 | 仕入れ管理 → データ1同期 |
| `cronEvery5min` | 5分 | 商品JSON更新・注文同期 |
| `cronAbandonedCart` | 30分 | カゴ落ちメール |
| `cronStatsCache` | 1時間 | 統計キャッシュ更新 |
| `cronDaily4To6` | 毎日4時 | 確保クリーンアップ・ポイント処理 |
| `cronDaily7` | 毎日7時 | インボイス・BASEトークンチェック |
| `cronDaily8` | 毎日8時 | GA4同期・在庫サマリ |
| `cronDaily9` | 毎日9時 | 入金リマインド・ニュースレター・業務サマリ |
| `cronNewArrival` | 毎日10時 | 新着通知 |
| `cronFollowupEmail` | 毎日11時 | フォローアップメール |

### 12.3 onEditトリガー

| シート | 列 | 処理 |
|---|---|---|
| 依頼管理 | V列（ステータス） | ステータス変更処理 |
| 依頼管理 | S列（発送） | 自動完了+発送通知メール |
| SNSシェア管理 | F列 | 承認/却下処理 |
| 依頼中 | 編集/削除 | openState再構築 |

---

## 13. セキュリティ

### 13.1 認証

- パスワード: SHA-256×1,000回 + ソルト（v2形式）
- セッション: 32文字ランダムID、CacheService/Sheets管理
- CSRF: ユーザー別トークン（CacheService、1時間有効）

### 13.2 Webhook検証

- KOMOJU: HMAC-SHA256署名検証（タイミングセーフ比較）
- SyncAPI: `SYNC_SECRET` による認証

### 13.3 レート制限

- Workers側: KV `SESSIONS` ネームスペースでカウント
- GAS側: CacheServiceでカウント

---

## 14. デプロイ手順

### 14.1 GAS

```bash
# 本番デプロイID（固定）
DEPLOY_ID="AKfycbzWcsi_QteRBwc2U88urRQvWG1FsrKUoFSd_r3uPmPasJnm0jfKe02IbmzlkK7Sb1x_Jg"

# ローカル → GAS → 本番
clasp push
clasp deploy -i "$DEPLOY_ID" --description "変更内容"

# 確認
clasp deployments
```

> **注意**: `clasp deploy` を `-i` なしで実行すると新URLの別デプロイが作られる。

### 14.2 Workers

```bash
cd workers/gas-proxy
npx wrangler deploy
```

### 14.3 注意事項

- `clasp push` 後に必ず `clasp deploy -i` を実行（pushだけでは本番に反映されない）
- `appsscript.json` のOAuthスコープ変更時はGASエディタで再承認が必要
- デプロイ数上限は20。超えた場合は `clasp undeploy <ID>` で古いものを削除

---

## 15. テスト

`Tests.gs`（約1,165行）— GASエディタから実行

```javascript
setEnvDevelopment()  // dev環境に切替
runAllTests()        // 10スイート実行
setEnvProduction()   // 本番に戻す
```

**テストスイート**: Auth, Payment, Order, Util, Integration_Auth, Integration_Payment, Security, EdgeCases, Rank, CsrfEnv

---

## 16. 日常運用タスク

### 16.1 依頼展開

メニュー → `expandOrder()` → 受付番号入力

自動処理: 回収完了展開 → AI説明文生成 → XLSX出力 → 確認リンク更新 → 売却反映

### 16.2 会員割引ON/OFF

GASエディタまたはメニューから `toggleMemberDiscount()` を実行。

### 16.3 初回半額ON/OFF

`toggleFirstHalfPrice()` を実行。

### 16.4 キャッシュクリア

```javascript
pr_clearProductsCache_()       // 商品キャッシュ
st_calculateAndCacheStats_()   // 統計キャッシュ
```

### 16.5 手動同期

```javascript
apiSyncExportData({
  syncSecret: PropertiesService.getScriptProperties().getProperty('SYNC_SECRET')
})
```

---

## 17. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| 商品が更新されない | キャッシュ | `pr_clearProductsCache_()` |
| 注文が「依頼中」のまま | Webhook未受信 | KOMOJU Webhook URL確認、決済リトライ |
| ログインできない | セッション期限切れ | 顧客管理L列を確認 |
| 決済エラー | KOMOJU APIキー | Script Properties `KOMOJU_SECRET_KEY` |
| メール届かない | D列空 or GmailAppエイリアス未設定 | 依頼管理D列、Gmailエイリアス確認 |
| 送料が違う | 都道府県未検出 | 住所先頭に都道府県名があるか |
| 確保が早く消える | 確保時間設定 | `APP_CONFIG.holds.minutes` |
| D1同期が遅れる | Workers Cron | Cloudflareダッシュボード、`SYNC_SECRET`一致確認 |
| 掲載中件数が不一致 | sheetTotalCount | データ1 B1値とサイト表示を比較 |
| 割引が備考に出ない | バグ修正済み | 最新デプロイか確認 |

---

## 18. ファイル一覧

### GAS（`saisun-list/`）

**コア**: Code.gs, ApiPublic.gs, SubmitFix.gs, KOMOJU.gs
**認証**: CustomerAuth.gs
**設定**: Config.gs, Constants.gs, appsscript.json
**データ**: sheets.gs, Product.gs, StateStore.gs, SyncApi.gs
**注文管理**: 受注管理.gs, Orders.gs, OrdersStatusUpsert.gs
**メール**: 発送通知.gs, PaymentReminder.gs, NewArrivalNotify.gs, Newsletter.gs, FollowupEmail.gs, AbandonedCart.gs
**決済**: KOMOJU.gs, Coupon.gs
**分析**: GA4Advice.gs, GA4Analytics.gs, ProductAnalytics.gs, RFMAnalysis.gs, StatsCache.gs
**自動化**: Triggers.gs, BulkSubmit.gs, BulkProduct.gs
**その他**: Referral.gs, SNSShare.gs, PointExpiry.gs, Articles.gs, Chatbot.gs, ABTest.gs

### Workers（`workers/gas-proxy/src/`）

**ルーター**: index.js
**ハンドラ**: handlers/{auth, products, session, status, holds, coupon, mypage, submit, proxy}.js
**同期**: sync/sheets-sync.js
**ユーティリティ**: utils/{crypto, response}.js

### 設定

- GAS: `appsscript.json`
- Workers: `wrangler.toml`
- clasp: `.clasp.json`

---

*最終更新: 2026-03-11*
