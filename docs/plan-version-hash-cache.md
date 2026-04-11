# 商品データ鮮度保証：バージョンハッシュ方式（Workers完結）

## 問題
商品情報の変更後も、顧客のブラウザに古いデータが表示される。
原因：4層キャッシュ（GAS 10分 → KV 5分 → HTML埋め込み → localStorage 5分）で最悪20分の遅延。

## 解決策
Workers の prewarmCaches() 内でハッシュを計算・KV保存。クライアントはページ読み込み時に軽量APIでハッシュだけチェックし、不一致ならフルデータを再取得。**GAS側の変更は不要。**

## 修正対象ファイル（4ファイル）

| ファイル | 変更内容 |
|---|---|
| `workers/gas-proxy/src/sync/sheets-sync.js` | prewarmCaches末尾でSHA-256ハッシュ計算 + `products:version` / `products:bulk:version` KV保存 |
| `workers/gas-proxy/src/handlers/products.js` | `getProductsVersion` 新関数 + `getCachedProducts`/`bulkInit` レスポンスに `dataVersion` 追加 |
| `workers/gas-proxy/src/index.js` | `apiGetProductsVersion` ルーティング追加 |
| `saisun-list/index.html` | バージョンチェック + 条件付き再取得 |
| `saisun-list/BulkLP.html` | 同上（バルク版） |

## 実装ステップ

### Step 1: sheets-sync.js — prewarmCaches でハッシュ生成
```js
// prewarmCaches() 末尾
const encoder = new TextEncoder();
const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(productData)));
const version = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 12);
await env.CACHE.put('products:version', version);
// bulk も同様
```

### Step 2: products.js — 軽量API + dataVersion付与
- `getProductsVersion`: `products:version` と `products:bulk:version` を返す
- `getCachedProducts` / `bulkInit`: レスポンスに `dataVersion` フィールド追加（レースコンディション対策）

### Step 3: index.js — ルーティング追加
- `apiGetProductsVersion` → `getProductsVersion`

### Step 4: index.html / BulkLP.html — バージョンチェック
```
即時表示（サーバー埋め込み or localStorage）
  ↓ バックグラウンド
apiGetProductsVersion（数十バイト）
  ├─ 一致 → 終了
  ├─ 不一致 → フルデータ再取得 → 再描画 + localStorage更新（dataVersionも保存）
  └─ エラー → 何もしない（キャッシュをそのまま使用）
```

## 設計判断
- **SHA-256先頭12文字**: Workers Web Crypto APIはMD5非対応。SHA-256の先頭12文字で衝突確率は十分低い
- **レースコンディション対策**: フルデータレスポンスに`dataVersion`を含め、クライアントはそれを保存
- **エラー時**: バージョンチェック失敗時は何もしない（キャッシュをそのまま使う）
