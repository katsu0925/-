# shiire-kanri マニュアル

外注向け／管理者向けの利用マニュアル。Markdown で保守し、画像を埋め込んだ配布用 HTML を生成する。

> **2026-08-27 変更**: PDF 出力を廃止した。配布用 HTML が単一正本。
> HTML は画像を base64 で埋め込んだ自己完結ファイルなので、そのまま渡せば単体で開ける。
> 印刷が必要なときはブラウザの印刷機能から A4 に出力する（`style.css` に `@media print` あり）。

## ファイル構成

```
docs/manual/
├── manual-staff.md        外注向け本文（フロントの操作のみ）
├── manual-admin.md        管理者向け本文（運用・シート・GAS・デプロイ）
├── style.css              スタイル（日本語フォント・画面表示＋@media print）
├── build.mjs              HTML ビルドスクリプト
├── package.json           ビルドに必要な npm 依存
├── screenshots/
│   ├── staff/             外注用マニュアルに挿入するスクショ
│   └── admin/             管理者用マニュアルに挿入するスクショ
└── dist/
    ├── 外注向けマニュアル.html      画像 base64 埋込みの自己完結ファイル
    └── 管理者向けマニュアル.html
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

生成された HTML は `dist/` に出力される。

## 更新手順

1. `manual-staff.md` または `manual-admin.md` を編集
2. 必要なら `screenshots/staff/` または `screenshots/admin/` に画像を差し替え
3. `npm run build` で HTML 再生成
4. `dist/` の HTML を関係者に共有（1ファイルで完結するのでそのまま送れる）

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
3. `npm run build` → HTML 配布

新しい機能や画面を追加したら：

- 外注に触らせるなら `manual-staff.md` の該当業務ブロックに追記
- 管理者しか触らないなら `manual-admin.md` のみ
- バックエンド変更（GAS 関数追加・シート列追加など）は `manual-admin.md` の対応する一覧表を更新

## アップデート履歴

| 日付 | 版 | 変更 |
|---|---|---|
| 2026-08-27 | v2 | PDF 出力を廃止し、配布用 HTML 単一正本に統一（Chrome headless 依存も削除） |
| 2026-08-19 | v1 | 外注向け／管理者向けマニュアル（PDF + HTML の二重生成） |
