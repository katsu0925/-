# デプロイメントガイド

## 前提条件

- Google アカウント（GAS実行権限あり）
- [clasp](https://github.com/nicholaschiang/clasp) CLI（オプション、ローカル開発時）
- KOMOJU アカウント（決済機能利用時）
- BASE アカウント（EC連携利用時）

## 環境構成

| 環境 | ScriptProperty `ENV` | 用途 |
|---|---|---|
| production | `production`（デフォルト） | 本番環境 |
| staging | `staging` | テスト・検証用 |
| development | `development` | 開発用 |

環境はスクリプトプロパティ `ENV` で制御します:

```
GASエディタ → プロジェクトの設定 → スクリプトプロパティ
キー: ENV  値: production
```

## 初回セットアップ

### 1. スプレッドシート準備

1. Google Sheets で新規スプレッドシートを作成
2. 以下のシートを作成:
   - `データ1` — 商品マスタ（ヘッダー行3）
   - `依頼管理` — 受注管理
   - `確保` — 確保ログ
   - `依頼中` — 依頼中ログ
   - `顧客管理` — 会員データ
   - `アクセスログ` — PVログ

3. スプレッドシートIDを `Config.gs` の `APP_CONFIG.data.spreadsheetId` に設定

### 2. スクリプトプロパティ設定

GASエディタ → プロジェクトの設定 → スクリプトプロパティ に以下を設定:

| キー | 説明 | 必須 |
|---|---|---|
| `RECAPTCHA_SECRET` | reCAPTCHA v3 シークレットキー | Yes |
| `ADMIN_KEY` | 管理者APIキー | Yes |
| `ADMIN_OWNER_EMAIL` | オーナーメールアドレス | Yes |
| `KOMOJU_SECRET_KEY` | KOMOJU Secret Key | 決済利用時 |
| `KOMOJU_WEBHOOK_SECRET` | KOMOJU Webhook Secret | 決済利用時 |
| `BASE_CLIENT_ID` | BASE OAuth Client ID | EC連携時 |
| `BASE_CLIENT_SECRET` | BASE OAuth Client Secret | EC連携時 |
| `BASE_REDIRECT_URI` | BASE OAuth リダイレクトURI | EC連携時 |
| `BASE_TARGET_SS_ID` | BASE注文同期先スプレッドシートID | EC連携時 |
| `ENV` | 環境識別（production/staging/development） | No |

### 3. Web App デプロイ

```
GASエディタ → デプロイ → 新しいデプロイ
種類: ウェブアプリ
実行者: 自分
アクセス: 全員（匿名を含む）
```

デプロイURL（`/exec` で終わる）を控えてください。

### 4. トリガー設定

GASエディタから以下の関数を1回実行してトリガーを登録:

```javascript
// GASエディタで実行
function setupAllTriggers() {
  // 商品データJSON定期エクスポート（5分間隔）
  ScriptApp.newTrigger('exportProductData_').timeBased().everyMinutes(5).create();

  // 仕入れ→データ1同期（1分間隔）
  ScriptApp.newTrigger('syncListingPublicCron').timeBased().everyMinutes(1).create();

  // BASE注文同期（5分間隔）
  ScriptApp.newTrigger('baseSyncOrdersNow').timeBased().everyMinutes(5).create();

  // 期限切れ確保のクリーンアップ（毎日4時）
  ScriptApp.newTrigger('od_compactHolds_').timeBased().atHour(4).everyDays(1).create();
}
```

### 5. KOMOJU Webhook 設定

1. KOMOJU ダッシュボード → Webhooks
2. エンドポイントURL: `{デプロイURL}?action=komoju_webhook`
3. イベント: `payment.captured`, `payment.updated`, `payment.failed`, `payment.expired`, `payment.refunded`
4. Webhook Secretをスクリプトプロパティ `KOMOJU_WEBHOOK_SECRET` に設定

## 更新デプロイ

### GASエディタから

1. コードを編集
2. `デプロイ → デプロイを管理 → 編集（鉛筆アイコン）`
3. バージョン: `新しいバージョン`
4. デプロイ

### clasp CLI から

```bash
# ログイン
clasp login

# コードをプッシュ
clasp push

# デプロイ
clasp deploy --description "v1.x.x: 変更内容"
```

## ロールバック

### GASエディタから

1. `デプロイ → デプロイを管理`
2. 編集（鉛筆アイコン）→ バージョンを前のものに変更
3. デプロイ

### clasp CLI から

```bash
# デプロイ一覧を確認
clasp deployments

# 特定バージョンにロールバック
clasp deploy --deploymentId <DEPLOYMENT_ID> --versionNumber <PREVIOUS_VERSION>
```

## 監視・トラブルシューティング

### ログ確認

```
GASエディタ → 実行 → 実行ログ
```

Stackdriver ログ:
```
GASエディタ → 実行 → Cloud Logging で表示
```

### よくあるエラー

| エラー | 原因 | 対処 |
|---|---|---|
| `RECAPTCHA_SECRET が未設定` | スクリプトプロパティ未設定 | プロパティを設定 |
| `KOMOJU APIキーが設定されていません` | KOMOJU_SECRET_KEY 未設定 | `setKomojuSecretKey()` を実行 |
| `refresh_token がありません` | BASE OAuth トークン期限切れ | `baseShowAuthUrl()` で再認証 |
| `Lock timeout` | 同時実行数超過 | しばらく待って再実行 |

### ヘルスチェック

```javascript
// GASエディタで実行
function healthCheck() {
  console.log('ENV: ' + ENV_CONFIG.getEnv());
  console.log('RECAPTCHA: ' + (getRecaptchaSecret_() ? 'SET' : 'NOT SET'));
  console.log('KOMOJU: ' + (getKomojuSecretKey_() ? 'SET' : 'NOT SET'));
  console.log('ADMIN_KEY: ' + (PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') ? 'SET' : 'NOT SET'));
  checkKomojuSecretKey();
  console.log('BASE: ');
  console.log(JSON.stringify(baseCheckSetup()));
}
```
