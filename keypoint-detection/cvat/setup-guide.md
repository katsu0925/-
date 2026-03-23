# CVATセットアップ手順

## 1. アカウント作成

1. https://app.cvat.ai/ にアクセス
2. 「Sign up」→ メールアドレスでアカウント作成
3. ログイン

## 2. プロジェクト作成

1. 左メニュー「Projects」→ 右上の「+」ボタン
2. Name: `写メジャー学習データ`
3. **Labels の設定**（以下の手順で行う）

### 2-1. ラベルのインポート

ラベル設定は `labels_config.json` をインポートして一括設定できます。

1. プロジェクト作成画面で「Raw」タブをクリック
2. `labels_config.json` の中身をコピー&ペースト
3. 「Done」→「Submit & Open」

これで4カテゴリ（tops / pants / skirt / dress）のスケルトンラベルが自動設定されます。

### 2-2. 手動で設定する場合

「Raw」タブが使えない場合は、以下の手順で手動設定:

1. 「Add label」→ Type: `Skeleton`
2. Name: `tops`
3. 「Setup skeleton」をクリック
4. 以下の10ポイントを追加:
   - collar_center（赤）
   - left_shoulder（青）
   - right_shoulder（青）
   - left_armpit（緑）
   - right_armpit（緑）
   - left_cuff（黄）
   - right_cuff（黄）
   - hem_left（マゼンタ）
   - hem_right（マゼンタ）
   - hem_center（赤）
5. ポイント間の接続線（Edge）を追加:
   - collar_center ↔ left_shoulder
   - collar_center ↔ right_shoulder
   - left_shoulder ↔ left_armpit
   - right_shoulder ↔ right_armpit
   - left_shoulder ↔ left_cuff
   - right_shoulder ↔ right_cuff
   - left_armpit ↔ hem_left
   - right_armpit ↔ hem_right
   - hem_left ↔ hem_center
   - hem_right ↔ hem_center
6. 同様に pants / skirt / dress も追加（接続線はアノテーションマニュアル参照）

## 3. タスク作成

1. プロジェクト内で「+」→「Create a new task」
2. Name: `撮影データ`
3. 「Select files」→ 画像200枚をアップロード
4. 「Submit & Open」

## 4. 外注先を招待

1. 上部メニュー「Organization」→ メンバー招待
2. 外注先のメールアドレスを入力 → Role: `Worker`
3. タスクのAssigneeに外注先を設定

## 5. アノテーション作業（外注先が実行）

1. ログイン → 割り当てられたタスクを開く
2. 画像が表示される
3. 左ツールバーから該当するスケルトンラベル（tops/pants/skirt/dress）を選択
4. 画像上でキーポイントを**順番にクリック**
5. 全ポイントをマーキングしたら「Save」→ 次の画像へ
6. アノテーションマニュアルPDFの指示に従う

### よくある操作

- **ポイントの移動**: ポイントをドラッグ
- **Undo**: Ctrl+Z
- **次の画像**: 右矢印キー or 画面下部の「>」ボタン
- **拡大**: マウスホイール or ピンチズーム
- **visibility変更**: ポイントを右クリック → visibility を設定

## 6. エクスポート

全画像のアノテーション完了後:

1. タスクを開く
2. 右上の「︙」メニュー →「Export task dataset」
3. Export format: **COCO Keypoints 1.0**
4. 「OK」→ ZIPファイルがダウンロードされる
5. ZIPをGoogle Driveにアップロードして納品
