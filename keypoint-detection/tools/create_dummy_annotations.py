#!/usr/bin/env python3
"""
既存テスト画像3枚にダミーのキーポイントアノテーションを作成する。
パイプラインの動作確認用。精度は問わない。

出力: data/annotations/dummy_tops.json, dummy_skirt.json, dummy_dress.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from configs.categories import CATEGORIES, CATEGORY_MAP

# テスト画像の情報（test_ratio.pyの結果とデバッグ画像から推定した座標）
# 座標はリサイズ後（2048x2048）のピクセル座標
DUMMY_DATA = {
    # スウェット IMG_1722 (2048x2048) → tops
    "tops": {
        "image": {
            "file_name": "IMG_1722.jpg",
            "width": 4284,
            "height": 4284,
        },
        # ユーザーが調整UIで修正した正しい座標（正規化→ピクセル変換）
        # 調整後の値を参考に手動設定
        "keypoints": [
            # collar_center (0): 襟の上端中央
            (2142, 930, 2),
            # left_shoulder (1): 左肩先（調整後、袖ではなく肩の縫い目）
            (1350, 1350, 2),
            # right_shoulder (2): 右肩先
            (2900, 1350, 2),
            # left_armpit (3): 左脇下
            (1500, 1750, 2),
            # right_armpit (4): 右脇下
            (2750, 1750, 2),
            # left_cuff (5): 左袖口
            (350, 2200, 2),
            # right_cuff (6): 右袖口
            (3900, 2200, 2),
            # hem_left (7): 裾左端
            (1400, 3200, 2),
            # hem_right (8): 裾右端
            (2800, 3200, 2),
            # hem_center (9): 裾中心
            (2100, 3250, 2),
        ],
    },
    # スカート IMG_1723 (4284x4284) → skirt
    "skirt": {
        "image": {
            "file_name": "IMG_1723.jpg",
            "width": 4284,
            "height": 4284,
        },
        "keypoints": [
            # waist_left (0)
            (1500, 500, 2),
            # waist_right (1)
            (2800, 500, 2),
            # hip_left (2): ウエストから約18cm下
            (1300, 1200, 2),
            # hip_right (3)
            (3000, 1200, 2),
            # hem_left (4)
            (800, 3800, 2),
            # hem_right (5)
            (3200, 3800, 2),
        ],
    },
    # ワンピース IMG_1724 (3024x3024) → dress
    "dress": {
        "image": {
            "file_name": "IMG_1724.jpg",
            "width": 3024,
            "height": 3024,
        },
        "keypoints": [
            # collar_center (0)
            (1512, 480, 2),
            # left_shoulder (1): 左肩先
            (1050, 680, 2),
            # right_shoulder (2): 右肩先
            (1970, 680, 2),
            # left_armpit (3): 左脇下
            (1150, 900, 2),
            # right_armpit (4): 右脇下
            (1870, 900, 2),
            # left_cuff (5): 左袖口
            (350, 1100, 2),
            # right_cuff (6): 右袖口
            (2700, 1100, 2),
            # hem_left (7): 裾左端
            (900, 2700, 2),
            # hem_right (8): 裾右端
            (2100, 2700, 2),
            # hem_center (9): 裾中心
            (1512, 2750, 2),
            # waist_left (10)
            (1100, 1500, 2),
            # waist_right (11)
            (1900, 1500, 2),
        ],
    },
}


def create_coco_annotation(category_name, data, image_id=1, ann_id=1):
    """1画像分のCOCOアノテーションを作成"""
    cat_def = CATEGORY_MAP[category_name]

    # keypoints を COCO形式に変換 [x1,y1,v1, x2,y2,v2, ...]
    kp_flat = []
    num_visible = 0
    for x, y, v in data["keypoints"]:
        kp_flat.extend([x, y, v])
        if v > 0:
            num_visible += 1

    # bbox: キーポイントから算出
    xs = [x for x, y, v in data["keypoints"] if v > 0]
    ys = [y for x, y, v in data["keypoints"] if v > 0]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    # 少し余白を追加
    margin = 50
    bbox = [
        max(0, x_min - margin),
        max(0, y_min - margin),
        (x_max - x_min) + 2 * margin,
        (y_max - y_min) + 2 * margin,
    ]

    coco = {
        "images": [
            {
                "id": image_id,
                "file_name": data["image"]["file_name"],
                "width": data["image"]["width"],
                "height": data["image"]["height"],
            }
        ],
        "annotations": [
            {
                "id": ann_id,
                "image_id": image_id,
                "category_id": cat_def["id"],
                "keypoints": kp_flat,
                "num_keypoints": num_visible,
                "bbox": bbox,
                "area": bbox[2] * bbox[3],
                "iscrowd": 0,
            }
        ],
        "categories": [
            {
                "id": cat_def["id"],
                "name": cat_def["name"],
                "keypoints": cat_def["keypoints"],
                "skeleton": [[a+1, b+1] for a, b in cat_def["skeleton"]],  # COCO: 1-indexed
            }
        ],
    }
    return coco


def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'annotations')
    os.makedirs(out_dir, exist_ok=True)

    # テスト画像をdata/images/にシンボリックリンク
    img_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'images')
    os.makedirs(os.path.join(img_dir, 'train'), exist_ok=True)
    os.makedirs(os.path.join(img_dir, 'val'), exist_ok=True)

    src_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'tools', 'ai-measure-test')

    for cat_name, data in DUMMY_DATA.items():
        # アノテーション作成
        coco = create_coco_annotation(cat_name, data)

        # train用（同じデータ = ダミー）
        train_path = os.path.join(out_dir, f'dummy_{cat_name}_train.json')
        with open(train_path, 'w') as f:
            json.dump(coco, f, indent=2)
        print(f"[{cat_name}] train → {train_path}")

        # val用（同じデータ = ダミー）
        val_path = os.path.join(out_dir, f'dummy_{cat_name}_val.json')
        with open(val_path, 'w') as f:
            json.dump(coco, f, indent=2)
        print(f"[{cat_name}] val   → {val_path}")

        # 画像のシンボリックリンク
        src = os.path.join(src_dir, data["image"]["file_name"])
        for split in ['train', 'val']:
            dst = os.path.join(img_dir, split, data["image"]["file_name"])
            if not os.path.exists(dst) and os.path.exists(src):
                os.symlink(os.path.abspath(src), dst)
                print(f"  symlink: {dst}")

    print("\n完了。data/annotations/ にダミーアノテーションを作成しました。")


if __name__ == "__main__":
    main()
