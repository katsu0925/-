# NKonline Apparel — アーキテクチャドキュメント

## システム概要

B2B卸売アパレル見積もりプラットフォーム。Google Apps Script (GAS) をバックエンドに、
Google Sheets をデータストアとして使用する。外部決済はKOMOJU、EC連携はBASE。

```
┌─────────────────┐     ┌─────────────────┐
│  フロントエンド   │────→│  GAS Web App    │
│ (Cloudflare Pages)│←────│  (doGet/doPost) │
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │データ1    │ │依頼管理  │ │顧客管理  │
             │(商品マスタ)│ │(受注)    │ │(認証)    │
             └──────────┘ └──────────┘ └──────────┘
                    ▲
                    │
             ┌──────────┐     ┌──────────┐
             │仕入れ管理 │     │  KOMOJU  │
             │ Ver.2    │     │ (決済)   │
             └──────────┘     └──────────┘
```

## プロジェクト構成

### saisun-list（メインプロジェクト）

| ファイル | 責務 |
|---|---|
| **Config.gs** | APP_CONFIG定義、送料テーブル、ブランドリスト |
| **Constants.gs** | マジックナンバー・定数の集約 |
| **Code.gs** | doGet/doPost、レート制限、reCAPTCHA、ログ |
| **ApiPublic.gs** | 公開API（検索、確保、注文、メール通知） |
| **SubmitFix.gs** | 見積もり送信（高速版）、Drive確認リンク生成 |
| **CustomerAuth.gs** | 顧客認証（登録/ログイン/セッション/ランク/ポイント） |
| **KOMOJU.gs** | KOMOJU決済連携（セッション作成/Webhook/署名検証） |
| **発送通知.gs** | 発送ステータス変更時のメール通知（管理者+顧客） |
| **DateExport.gs** | 商品データJSON定期エクスポート（5分間隔） |
| **Product.gs** | 商品データ読み込み・キャッシュ |
| **StateStore.gs** | 確保/依頼中状態の永続化 |
| **Status.gs** | ステータスダイジェスト生成 |
| **StatusSync.gs** | ステータス同期 |
| **Orders.gs** | 注文管理ヘルパー |
| **Triggers.gs** | onEditハンドラ、トリガー設定 |
| **Util.gs** | 共通ユーティリティ（検索正規化、テンプレート生成） |
| **Tests.gs** | 自動テストスイート |
| **コード.gs** | 仕入れ管理連携（商品管理→データ1同期） |
| **受注管理.gs** | 受注展開・配布リスト生成 |
| **BASE_注文→依頼管理.gs** | BASE EC注文同期 |

### shiire-kanri（仕入れ管理プロジェクト）

在庫管理・ステータス更新・キーワード抽出（OpenAI API）を担当。

## データフロー

### 商品掲載フロー

```
仕入れ管理Ver.2 (商品管理シート)
  ↓ syncListingPublic (onEdit トリガー)
データ1シート (見積もりシステム用)
  ↓ exportProductData_ (5分間隔トリガー)
JSONキャッシュ (CacheService)
  ↓ apiGetCachedProducts / apiInit
フロントエンド表示
```

### 注文フロー

```
1. フロント: apiSyncHolds で商品を15分間確保
2. フロント: apiSubmitEstimate で見積もり送信
   ├─ バリデーション（reCAPTCHA含む）
   ├─ 価格計算（数量割引・会員割引・ポイント）
   ├─ 依頼管理シートに書き込み
   ├─ Drive確認ファイル生成（I列にURL保存）
   ├─ 管理者宛メール通知
   └─ 顧客宛確認メール
3. 管理者: 依頼管理シートで確認・発送処理
4. M列を「発送済み」に変更
   ├─ 管理者宛発送通知メール
   ├─ 顧客宛発送通知メール（Drive共有リンク付き）
   └─ P列を自動で「完了」に更新
5. 完了後: ポイント付与・領収書送付
```

### 決済フロー（KOMOJU連携時）

```
1. apiCreateKomojuSession → KOMOJU決済ページURL取得
2. 顧客がKOMOJUで決済
3. KOMOJU → Webhook → handleKomojuWebhook
   ├─ HMAC-SHA256署名検証
   ├─ payment.captured → confirmPaymentAndCreateOrder
   └─ payment.failed → 状態記録のみ
```

## 認証・セキュリティ

### パスワードハッシュ

```
v2形式: "v2:" + salt(16文字) + ":" + SHA-256(10,000回反復)
v1形式: salt + ":" + SHA-256(10,000回反復)  ← 後方互換
legacy: salt + ":" + SHA-256(1回)            ← 移行対象
```

ログイン時にv1/legacyからv2へ自動移行する。
v1/legacy用のハッシュ関数は `hashWithIterations_()` に統合済み。

### パスワードリセット

仮パスワードは元のパスワードを上書きせず、ScriptPropertiesに有効期限付きで保存。
- 有効期限: 30分（`AUTH_CONSTANTS.TEMP_PASSWORD_EXPIRY_MS`）
- ログイン時に仮パスワードが有効なら認証成功→本パスワードに昇格
- 期限切れの仮パスワードは自動削除

### CSRF対策

- `apiGetCsrfToken` でユーザーごとのCSRFトークンを発行（CacheService、1時間有効）
- 状態変更を伴うAPI（送信、プロフィール更新、決済作成等）でCSRFトークンを検証
- タイミングセーフ比較で検証

### セッション管理

- セッションID: 32文字ランダム（UUID連結）
- 有効期限: 24時間（rememberMe: 30日）
- 顧客管理シートに保存

### レート制限

| API | 上限 | ウィンドウ |
|---|---|---|
| apiSubmitEstimate | 5回 | 1時間 |
| apiSyncHolds | 30回 | 1分 |
| apiLoginCustomer | 5回 | 1時間 |
| apiRegisterCustomer | 3回 | 1時間 |
| apiSendContactForm | 3回 | 1時間 |
| apiRequestPasswordReset | 3回 | 1時間 |
| apiRecoverEmail | 5回 | 1時間 |

## スプレッドシート構造

### 依頼管理シート（30列 A-AD）

| 列 | 名前 | 用途 |
|---|---|---|
| A | 受付番号 | 一意識別子 |
| B | 依頼日時 | タイムスタンプ |
| C | 会社名/氏名 | 顧客名 |
| D | 連絡先 | メールアドレス |
| E-G | 郵便番号/住所/電話 | 配送情報 |
| H | 商品名 | 商品一覧テキスト |
| I | 確認リンク | Google Drive共有URL |
| J | 選択リスト | 管理番号一覧 |
| K | 合計点数 | 商品数 |
| L | 合計金額 | 税込金額 |
| M | 発送ステータス | 未着手/発送済み |
| P | ステータス | 依頼中/キャンセル/返品/完了 |
| R | 入金確認 | 未対応/入金待ち/対応済 |
| S | 領収書希望 | 希望/空 |
| T | 領収書送付済 | 送付済/取消送付済/空 |
| W | 配送業者 | 業者名 |
| X | 伝票番号 | 追跡番号 |
| AA | 通知フラグ | 発送通知済み日時 |
| AB | ポイント付与済 | PT/空 |
| AC-AD | 送料 | 店負担/客負担 |

### 顧客管理シート

| 列 | 名前 |
|---|---|
| A | ID (C+タイムスタンプ) |
| B | メールアドレス |
| C | パスワードハッシュ (v2:salt:hash) |
| D | 会社名/氏名 |
| E-G | 電話/郵便番号/住所 |
| H | メルマガ |
| I | 登録日時 |
| J | 最終ログイン |
| K | セッションID |
| L | セッション有効期限 |
| M | ポイント残高 |

## ランクシステム

| ランク | 年間購入額 | ポイント還元率 | 送料無料 |
|---|---|---|---|
| ダイヤモンド | 50万円以上 | 5% | Yes |
| ゴールド | 20万円以上 | 5% | No |
| シルバー | 5万円以上 | 3% | No |
| レギュラー | - | 1% | No |

救済措置: 前年ダイヤ/ゴールドが更新切れ → 直近1ヶ月で5万円以上購入 → 前ランク復活

## トリガー一覧

| トリガー | 関数 | 頻度 | 用途 |
|---|---|---|---|
| onEdit | shipMailOnEdit | リアルタイム | M列変更で発送通知 |
| onEdit | onEdit | リアルタイム | ステータス変更時の状態同期 |
| Timer | exportProductData_ | 5分 | 商品JSON更新 |
| Timer | syncListingPublicCron | 1分 | 仕入れ→データ1同期 |
| Timer | baseSyncOrdersNow | 5分 | BASE注文同期 |
| Timer | od_compactHolds_ | 毎日4時 | 期限切れ確保のクリーンアップ |

## 外部連携

| サービス | 用途 | 認証方式 |
|---|---|---|
| KOMOJU | 決済処理 | Basic Auth (Secret Key) |
| BASE | EC連携 | OAuth 2.0 |
| Google Drive | ファイル共有 | ANYONE_WITH_LINK + VIEW |
| reCAPTCHA v3 | bot防止 | Secret Key |
| Google InputTools | かな変換検索 | Public API |
