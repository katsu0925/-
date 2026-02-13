# NKonline Apparel API仕様書

## 概要

Google Apps Script (GAS) 上で動作するB2B卸売アパレル決済システムのJSON API。
フロントエンド（Cloudflare Pages等）から `doPost` エンドポイントに対してJSON形式でリクエストを送信する。

## エンドポイント

```
POST [GAS Web App URL]
Content-Type: application/json
```

### リクエスト形式

```json
{
  "action": "apiXxx",
  "args": [...],
  "adminKey": "(管理者用・任意)",
  "recaptchaToken": "(apiSubmitEstimate時のみ必須)"
}
```

### レスポンス形式

```json
{
  "ok": true/false,
  "message": "エラーメッセージ（ok=false時）",
  "data": { ... }
}
```

---

## 商品API

### `apiInit(userKey, params)`
初期化。商品一覧・フィルタ選択肢・設定を返す。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| userKey | string | Yes | ブラウザ識別子 |
| params | object | No | 検索パラメータ |

**レスポンス:** `{ ok, settings, options, page }`

### `apiSearch(userKey, params)`
商品検索。キーワード・フィルタ・ページネーション対応。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| userKey | string | Yes | ブラウザ識別子 |
| params.keyword | string | No | 検索キーワード |
| params.brand | string | No | ブランドフィルタ |
| params.category | string | No | カテゴリフィルタ |
| params.page | number | No | ページ番号 |

### `apiGetProductDetail(params)`
商品詳細（採寸データ・傷汚れ詳細）を取得。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| params.managedId | string | Yes | 管理番号 |

### `apiGetCachedProducts()`
キャッシュから全商品データを取得（高速）。

---

## 確保・注文API

### `apiSyncHolds(userKey, ids)`
商品を一時確保（15分間）。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| userKey | string | Yes | ブラウザ識別子 |
| ids | string[] | Yes | 確保する管理番号リスト |

**レスポンス:** `{ ok, digest, failed }`
- `failed[]`: `{ id, reason: '確保中'|'依頼中' }`

### `apiGetStatusDigest(userKey, ids)`
商品のステータス一覧を取得。

### `apiSubmitEstimate(userKey, form, ids)`
注文を送信。**reCAPTCHAトークン必須。**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| userKey | string | Yes | ブラウザ識別子 |
| form.companyName | string | Yes | 会社名/氏名 |
| form.contact | string | Yes | メールアドレス |
| form.postal | string | No | 郵便番号 |
| form.address | string | No | 住所 |
| form.phone | string | No | 電話番号 |
| form.note | string | No | 備考 |
| form.measureOpt | string | No | 'with'/'without' |
| form.usePoints | number | No | 使用ポイント |
| form.invoiceReceipt | boolean | No | 領収書希望 |
| ids | string[] | Yes | 注文商品の管理番号リスト |

**レスポンス:** `{ ok, receiptNo, templateText, totalAmount }`

**レート制限:** 1時間に5回まで

### `apiCancelOrder(receiptNo)`
注文キャンセル（決済失敗時）。

---

## 顧客認証API

### `apiRegisterCustomer(userKey, params)`
新規顧客登録。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| params.email | string | Yes | メールアドレス |
| params.password | string | Yes | パスワード（6文字以上） |
| params.companyName | string | Yes | 会社名/氏名 |
| params.phone | string | No | 電話番号 |
| params.postal | string | No | 郵便番号 |
| params.address | string | No | 住所 |
| params.newsletter | boolean | No | メルマガ購読 |

**レスポンス:** `{ ok, data: { sessionId, customer } }`
**レート制限:** 1時間に3回まで

### `apiLoginCustomer(userKey, params)`
ログイン（v2/v1/legacy自動移行対応）。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| params.email | string | Yes | メールアドレス |
| params.password | string | Yes | パスワード |
| params.rememberMe | boolean | No | 30日間セッション保持 |

**レスポンス:** `{ ok, data: { sessionId, customer } }`
**レート制限:** 1時間に5回まで

### `apiValidateSession(userKey, params)`
セッション検証。

### `apiLogoutCustomer(userKey, params)`
ログアウト。

### `apiUpdateCustomerProfile(userKey, params)`
会員情報変更（パスワード再認証必須）。

### `apiChangePassword(userKey, params)`
パスワード変更。

### `apiRequestPasswordReset(userKey, params)`
パスワードリセット（仮パスワード発行）。

### `apiRecoverEmail(userKey, params)`
メールアドレス確認（会社名+電話番号で照合）。

### `apiGetMyPage(userKey, params)`
マイページ情報取得（プロフィール・注文履歴・ポイント・ランク）。

---

## 決済API (KOMOJU)

### `apiCreateKomojuSession(receiptNo, amount, customerInfo)`
KOMOJU決済セッション作成。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| receiptNo | string | Yes | 受付番号 |
| amount | number | Yes | 金額（円） |
| customerInfo.email | string | No | 顧客メール |
| customerInfo.companyName | string | No | 会社名 |

**対応決済:** クレジットカード（Visa/Mastercard） / コンビニ払い（セブン-イレブン除く） / 銀行振込 / LINE Pay
**申請中:** JCB/AMEX/Diners/Discover（日本） / PayPay / Paidy（あと払い）

### `apiCheckPaymentStatus(receiptNo)`
決済状態確認。

### Webhook: `handleKomojuWebhook(e)`
KOMOJU Webhook受信。HMAC-SHA256署名検証付き。
- `payment.captured` / `payment.authorized` → 注文確定
- `payment.failed` / `payment.expired` → 失敗記録
- `payment.refunded` → 返金処理

---

## お問い合わせAPI

### `apiSendContactForm(params)`
お問い合わせフォーム送信。管理者＋顧客に確認メール。

**レート制限:** 1時間に3回まで

---

## セキュリティ

| 項目 | 実装 |
|---|---|
| パスワードハッシュ | SHA-256 × 10,000回反復 + ランダムソルト（v2形式） |
| セッション | 32文字ランダムID、24時間 or 30日間有効 |
| レート制限 | CacheServiceベース、API別に設定 |
| reCAPTCHA | v3、スコア0.3未満で拒否 |
| CSRF | doPostはCORS対応、管理操作はadminKey必須 |
| Webhook検証 | HMAC-SHA256タイミングセーフ比較 |
| 管理者認証 | タイミングセーフな文字列比較 |
