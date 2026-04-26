# shiire-kanri Cloudflare 版 セットアップ手順

URL: https://shiire-kanri.nsdktts1030.workers.dev/

## 完了済み

- D1 `shiire-kanri-db` 作成（id: 5a45ff40-69ca-4a2a-9e75-daa702e959e8）+ schema 適用
- KV `CACHE`（id: 39aa093878e7425da7ecedcd31b7d274）作成済
- Workers `shiire-kanri` デプロイ済（Cron `*/5` + Static Assets で SPA 配信）
- Workers Secrets: `SYNC_SECRET`, `GAS_API_URL` 設定済
- GAS shiire-kanri に doPost + 同期エンドポイント 4件追加・デプロイ（@37）

## 残タスク（手動）

### 1. GAS Script Properties に SHIIRE_SYNC_SECRET を設定

GAS エディタで shiire-kanri プロジェクトを開き、`StaffApi.gs` の `staff_setupSyncSecret` 関数を一度だけ実行する。

または直接 Script Properties で設定:

```
SHIIRE_SYNC_SECRET=4bdb6f1286925aaefc8d67b6552422cca8df0e5dd13ef6a3a2877ebe98d10aee
```

設定後、初回同期を手動トリガーして確認:

```bash
curl -X POST https://shiire-kanri.nsdktts1030.workers.dev/admin/sync \
  -H "X-Sync-Secret: 4bdb6f1286925aaefc8d67b6552422cca8df0e5dd13ef6a3a2877ebe98d10aee"
```

D1 に行が入ったか確認:

```bash
cd workers/shiire-kanri
npx wrangler d1 execute shiire-kanri-db --remote --command "SELECT COUNT(*) FROM products"
npx wrangler d1 execute shiire-kanri-db --remote --command "SELECT * FROM sync_meta"
```

### 2. Cloudflare Access でアプリ保護

Zero Trust ダッシュボード → Access → Applications → Add application → Self-hosted

- **Application name**: shiire-kanri
- **Application domain**: `shiire-kanri.nsdktts1030.workers.dev`
  - パス指定 `/api/*` と `/` は両方カバーする（ルートドメインを丸ごと指定）
  - ただし `/health` と `/admin/sync` は除外したいなら別アプリで bypass
- **Identity provider**: Google（既設）
- **Session duration**: 24h

#### Policy

| Action | Rule | Value |
|---|---|---|
| Allow | Emails | 9人のメールアドレス（カンマ区切り） |

#### Application 作成後

1. Application の **AUD タグ**をコピー
2. Workers Secrets に登録:

```bash
cd workers/shiire-kanri
echo "<AUD タグ>" | npx wrangler secret put CF_ACCESS_AUD
echo "nkonline" | npx wrangler secret put CF_ACCESS_TEAM   # Cloudflare チーム名（cloudflareaccess.com の subdomain）
```

※ チーム名が分からない場合は Zero Trust ダッシュボードの URL `https://<team>.cloudflareaccess.com` を確認。

### 3. 動作確認

1. ブラウザで https://shiire-kanri.nsdktts1030.workers.dev/ を開く
2. Cloudflare Access の Google ログイン画面が表示される
3. 許可された Google アカウントでサインイン
4. 商品管理タブで商品リスト表示 → 1件タップ → 採寸入力 → 保存 → トースト「採寸を保存しました」
5. スプレッドシートを直接開いて該当行に値が反映されているか確認

## トラブルシュート

- `/admin/sync` で 502 → GAS 側 `SHIIRE_SYNC_SECRET` 未設定 or 値違い
- D1 行数 0 → `wrangler tail shiire-kanri --format=pretty` でCron実行時のログ確認
- ブラウザで 403 → Cloudflare Access の email allow list 確認 / `CF_ACCESS_AUD` 値確認
- 採寸保存して反映されない → Workers ログで `[save] gas error` を探す
