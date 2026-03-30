# タスキ箱（Tasukibako）— CLAUDE.md

## サービス概要

**タスキ箱**は、商品の撮影・出品を外注（分業）している物販事業者向けの**管理番号付き商品画像共有ストレージ**。駅伝のたすきのように、撮影者から出品者へ商品画像を確実に渡す「箱」。

### ターゲット
- 個人セラー + 外注撮影者1〜2名（2〜5人チーム）
- 小規模ショップ + 複数スタッフ（5〜20人チーム）
- 古着に限らず、外注を使った商品管理に困っている全ての物販事業者

### ポジショニング
- **デタウリとは完全独立ブランド**（同じリポジトリだが別Worker）
- 現在はデタウリ内部ツールとしても運用中。一般公開は未定。
- 認証: メール+パスワード（個別アカウント）
- チーム内は全員同権限（シンプル）

---

## 技術スタック

| 項目 | 技術 |
|---|---|
| ランタイム | Cloudflare Workers |
| DB | Cloudflare D1 |
| キャッシュ | Cloudflare KV |
| 画像ストレージ | Cloudflare R2 |
| フロントエンド | バニラHTML/JS（Workers内インライン） |
| 決済（未実装） | Stripe Billing（予定） |

### Cloudflareリソース
```
D1:  tasukibako-db (30d05549-1e52-4a2a-85af-555847c183f9)
KV:  SESSIONS (a45ffde241e64ee8aa03b6a54dc659ec)
KV:  CACHE (4b44ff82d82b4302b3e3318522f7ae11)
R2:  tasukibako-images
```

### デプロイ
```bash
cd workers/tasukibako
wrangler deploy
```
本番URL: https://tasukibako.nsdktts1030.workers.dev

---

## ファイル構成

```
workers/tasukibako/
├── wrangler.toml              # D1/KV/R2 binding設定
├── sql/schema.sql             # users, teams, team_members, password_resets
├── src/
│   ├── index.js               # URLパスベースルーター
│   ├── config.js              # PLAN_LIMITS（free/lite/standard/pro）
│   ├── handlers/
│   │   ├── auth.js            # register, login, logout
│   │   ├── session.js         # extractSession, validateAndReturn
│   │   ├── team.js            # create, list, join, members, inviteInfo, regenerateInvite
│   │   ├── upload.js          # uploadImages, reorder, serveImage（teamIdスコープ）
│   │   ├── manage.js          # list, productImages, deleteProduct, deleteSingle, stats
│   │   └── admin.js           # setPlan, resetUsage, info
│   ├── utils/
│   │   ├── crypto.js          # SHA-256 x 1000 パスワードハッシュ
│   │   └── response.js        # CORS, jsonOk, jsonError, htmlResponse
│   └── pages/
│       ├── app.html.js        # メインUI（4タブ: アップロード/商品管理/チーム/設定）
│       ├── login.html.js      # ログイン画面
│       └── register.html.js   # 登録画面（招待コード対応）
```

---

## D1スキーマ

```sql
-- ユーザー
users (id, email, password_hash, display_name, created_at, last_login, updated_at)

-- チーム
teams (id, name, owner_id, plan, invite_code, invite_enabled,
       product_count, image_count, created_at, updated_at)

-- チームメンバー
team_members (team_id, user_id, role, joined_at)

-- パスワードリセット（未実装）
password_resets (token, user_id, expires_at, used, created_at)
```

---

## APIエンドポイント

### 認証不要
| パス | 説明 |
|---|---|
| `POST /api/auth/register` | 新規登録 |
| `POST /api/auth/login` | ログイン |
| `POST /api/auth/logout` | ログアウト |

### 認証必須（セッショントークン）
| パス | 説明 |
|---|---|
| `POST /api/session/validate` | セッション検証 |
| `POST /api/team/create` | チーム作成 |
| `POST /api/team/list` | 所属チーム一覧 |
| `POST /api/team/invite-info` | 招待コード情報 |
| `POST /api/team/join` | チーム参加 |
| `POST /api/team/members` | メンバー一覧 |
| `POST /api/team/regenerate-invite` | 招待コード再発行 |
| `POST /api/upload/images` | 画像アップロード |
| `POST /api/upload/reorder` | 画像並び替え |
| `POST /api/manage/list` | 商品一覧 |
| `POST /api/manage/product-images` | 商品の画像一覧 |
| `POST /api/manage/delete` | 商品削除 |
| `POST /api/manage/delete-single` | 画像1枚削除 |
| `POST /api/manage/stats` | 統計情報 |
| `POST /api/admin/set-plan` | プラン変更（管理者） |
| `POST /api/admin/reset-usage` | 利用量リセット（管理者） |
| `POST /api/admin/info` | 管理者情報 |

### HTMLページ
| パス | 説明 |
|---|---|
| `/` `/login` | ログイン画面 |
| `/register` | 登録画面（?code=招待コード） |
| `/app` | メインアプリ（要認証、4タブUI） |

### 画像配信
| パス | 説明 |
|---|---|
| `GET /images/{path}?token={sessionId}` | R2画像配信（認証付き） |

---

## 料金プラン

| | フリー | ライト | スタンダード | プロ |
|---|---|---|---|---|
| **月額** | ¥0 | ¥980 | ¥1,980 | ¥3,980 |
| **商品数** | 200 | 1,000 | 2,000 | 10,000 |
| **画像数** | 2,000 | 10,000 | 20,000 | 100,000 |
| **メンバー** | 3人 | 5人 | 15人 | 無制限 |
| **一括保存** | × | ○ | ○ | ○ |
| **アクティビティログ** | × | × | ○ | ○ |
| **メンバー権限分け** | × | × | ○ | ○ |
| **複数チーム** | × | × | × | ○ |
| **CSV/APIエクスポート** | × | × | × | ○ |

---

## 実装済み機能
- メール+パスワード認証（SHA-256 x 1000、v2:salt:hash形式）
- セッション管理（KV、24h/30日remember me）
- レート制限（登録10回/h、ログイン30回/h）
- チーム作成・招待コード発行・参加
- マルチテナント画像管理（R2パス: `teams/{teamId}/products/{managedId}/{uuid}.jpg`）
- フリープラン制限チェック（200商品/2000画像/3人）
- 画像配信認証（?token=sessionId方式）
- UI: アップロード/商品管理/チーム/設定の4タブ
- Google画像検索（Lens）連携
- ドラッグ&ドロップ並び替え
- 画像リサイズ（createImageBitmap + 2枚並列）
- 管理者機能（プラン変更、利用量リセット）

## 未着手（一般公開に必要）
- パスワードリセット（Resend API + ドメイン取得が前提）
- Stripe Billing連携（有料プラン課金）
- 利用規約/プライバシーポリシー/特商法表記
- LP＆オンボーディング
- ドメイン取得（tasukibako.com等）
- 画像差し替え（update-image API）

---

## セキュリティ
- パスワード: SHA-256 × 1,000回（salt付き、v2:salt:hash形式）
- R2パスはチームIDで完全分離（他チームの画像にはアクセス不可）
- 画像URLは認証必須（公開URLなし）
- チーム招待コードは再発行可能
- アップロード時にContent-Type検証 + マジックバイト検証
- ファイルサイズ上限: 10MB/枚
- ファイル名はUUIDに置換（パストラバーサル防止）

---

## デタウリとの関係
- 同じGitリポジトリ（`saisun-repo`）内だが、完全に独立したWorker
- デタウリWorker（`workers/gas-proxy/`）には一切依存しない
- Cloudflareリソース（D1/KV/R2）も完全に別
- デタウリの画像アップロード機能（`/upload`）がタスキ箱の原型
- 将来的にAI採寸サービス（写メジャー）との連携を予定
