# shiire-kanri マニュアル

外注向け／管理者向けの利用マニュアル。Markdown で保守し、Chrome headless で PDF 化する。

## ファイル構成

```
docs/manual/
├── manual-staff.md        外注向け本文（フロントの操作のみ）
├── manual-admin.md        管理者向け本文（運用・シート・GAS・デプロイ）
├── style.css              PDF 用スタイル（日本語フォント・印刷向けレイアウト）
├── build.mjs              PDF ビルドスクリプト
├── package.json           ビルドに必要な npm 依存
├── screenshots/
│   ├── staff/             外注用マニュアルに挿入するスクショ
│   └── admin/             管理者用マニュアルに挿入するスクショ
└── dist/
    ├── 外注向けマニュアル.pdf
    └── 管理者向けマニュアル.pdf
```

## 初回セットアップ

```bash
cd shiire-kanri/docs/manual
npm install
```

## ビルド

```bash
npm run build           # staff + admin 両方
npm run build:staff
npm run build:admin
```

生成された PDF は `dist/` に出力される。

## 更新手順

1. `manual-staff.md` または `manual-admin.md` を編集
2. 必要なら `screenshots/staff/` または `screenshots/admin/` に画像を差し替え
3. `npm run build` で PDF 再生成
4. `dist/` の PDF を関係者に共有

## 注記ボックス記法

Markdown 内で以下のブロックが使える：

```
:::note
情報補足。青色のボックス。
:::

:::tip
コツ・推奨設定。緑色のボックス。
:::

:::warn
注意事項。黄色のボックス。
:::

:::danger
危険操作・データ消失リスク。赤色のボックス。
:::
```

## スクリーンショットの差し替え

`screenshots/{staff,admin}/*.png` を同名で上書きすれば自動で反映される。Markdown 内では相対パスで参照する：

```markdown
![ログイン画面](screenshots/staff/01-login.png)
```

## UI/機能を変更したら

1. 該当章を編集
2. UI 変更が大きいなら関連スクショを撮り直し
3. `npm run build` → PDF 配布

新しい機能や画面を追加したら：

- 外注に触らせるなら `manual-staff.md` の該当業務ブロックに追記
- 管理者しか触らないなら `manual-admin.md` のみ
- バックエンド変更（GAS 関数追加・シート列追加など）は `manual-admin.md` の対応する一覧表を更新

## Chrome のパス

macOS 既定の `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` を `build.mjs` が直接呼ぶ。別環境で動かす場合は `CHROME` 定数を変更すること。
