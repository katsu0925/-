#!/usr/bin/env python3
"""
既存テスト画像にダミーのキーポイントアノテーションを作成する。
パイプラインの動作確認用。精度は問わない。

出力: data/annotations/dummy_{category}_{train|val}.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from configs.categories import CATEGORIES, CATEGORY_MAP

# テスト画像の情報
# 座標はオリジナル画像のピクセル座標
DUMMY_DATA = {
    # スウェット IMG_1722 (4284x4284) → tops (10点)
    "tops": {
        "image": {
            "file_name": "IMG_1722.jpg",
            "width": 4284,
            "height": 4284,
        },
        "keypoints": [
            # 0: collar_center 襟中心
            (2142, 930, 2),
            # 1: left_shoulder 左肩先
            (1350, 1350, 2),
            # 2: right_shoulder 右肩先
            (2900, 1350, 2),
            # 3: left_armpit 左脇下
            (1500, 1750, 2),
            # 4: right_armpit 右脇下
            (2750, 1750, 2),
            # 5: left_cuff 左袖口
            (350, 2200, 2),
            # 6: right_cuff 右袖口
            (3900, 2200, 2),
            # 7: hem_left 裾左端
            (1400, 3200, 2),
            # 8: hem_right 裾右端
            (2800, 3200, 2),
            # 9: hem_center 裾中心
            (2100, 3250, 2),
        ],
    },
    # パンツ IMG_1721 (4284x5712) → pants (10点)
    "pants": {
        "image": {
            "file_name": "IMG_1721.jpg",
            "width": 4284,
            "height": 5712,
        },
        "keypoints": [
            # 0: waist_left ウエスト左
            (1200, 400, 2),
            # 1: waist_right ウエスト右
            (3100, 400, 2),
            # 2: waist_center ウエスト中心
            (2150, 400, 2),
            # 3: hip_left ヒップ左
            (1100, 900, 2),
            # 4: hip_right ヒップ右
            (3200, 900, 2),
            # 5: crotch 股
            (2150, 2200, 2),
            # 6: thigh_outer ワタリ外端
            (3100, 2200, 2),
            # 7: left_hem 左裾
            (1400, 5200, 2),
            # 8: right_hem 右裾
            (2900, 5200, 2),
            # 9: hem_center 裾中心
            (2150, 5200, 2),
        ],
    },
    # スカート IMG_1723 (4284x4284) → skirt (8点)
    "skirt": {
        "image": {
            "file_name": "IMG_1723.jpg",
            "width": 4284,
            "height": 4284,
        },
        "keypoints": [
            # 0: waist_left ウエスト左
            (1500, 500, 2),
            # 1: waist_right ウエスト右
            (2800, 500, 2),
            # 2: waist_center ウエスト中心
            (2150, 500, 2),
            # 3: hip_left ヒップ左
            (1300, 1200, 2),
            # 4: hip_right ヒップ右
            (3000, 1200, 2),
            # 5: hem_left 裾左端
            (800, 3800, 2),
            # 6: hem_right 裾右端
            (3200, 3800, 2),
            # 7: hem_center 裾中心
            (2000, 3850, 2),
        ],
    },
    # ワンピース IMG_1724 (3024x3024) → dress (12点)
    "dress": {
        "image": {
            "file_name": "IMG_1724.jpg",
            "width": 3024,
            "height": 3024,
        },
        "keypoints": [
            # 0: collar_center 襟中心
            (1512, 480, 2),
            # 1: left_shoulder 左肩先
            (1050, 680, 2),
            # 2: right_shoulder 右肩先
            (1970, 680, 2),
            # 3: left_armpit 左脇下
            (1150, 900, 2),
            # 4: right_armpit 右脇下
            (1870, 900, 2),
            # 5: left_cuff 左袖口
            (350, 1100, 2),
            # 6: right_cuff 右袖口
            (2700, 1100, 2),
            # 7: hem_left 裾左端
            (900, 2700, 2),
            # 8: hem_right 裾右端
            (2100, 2700, 2),
            # 9: hem_center 裾中心
            (1512, 2750, 2),
            # 10: waist_left ウエスト左
            (1100, 1500, 2),
            # 11: waist_right ウエスト右
            (1900, 1500, 2),
        ],
    },
    # サロペット（ダミー: IMG_1722を流用）→ salopette (10点)
    "salopette": {
        "image": {
            "file_name": "IMG_1722.jpg",
            "width": 4284,
            "height": 4284,
        },
        "keypoints": [
            # 0: left_strap_top 左肩紐上
            (1600, 800, 2),
            # 1: right_strap_top 右肩紐上
            (2600, 800, 2),
            # 2: left_armpit 左脇下
            (1500, 1500, 2),
            # 3: right_armpit 右脇下
            (2750, 1500, 2),
            # 4: waist_left ウエスト左
            (1450, 2000, 2),
            # 5: waist_right ウエスト右
            (2800, 2000, 2),
            # 6: crotch 股
            (2100, 2500, 2),
            # 7: left_hem 左裾
            (1400, 3500, 2),
            # 8: right_hem 右裾
            (2800, 3500, 2),
            # 9: hem_center 裾中心
            (2100, 3550, 2),
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

    img_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'images')
    os.makedirs(os.path.join(img_dir, 'train'), exist_ok=True)
    os.makedirs(os.path.join(img_dir, 'val'), exist_ok=True)

    src_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'tools', 'ai-measure-test')

    for cat_name, data in DUMMY_DATA.items():
        # キーポイント数の検証
        expected = len(CATEGORY_MAP[cat_name]["keypoints"])
        actual = len(data["keypoints"])
        if actual != expected:
            print(f"[{cat_name}] エラー: キーポイント数が不一致 (定義={expected}, データ={actual})")
            continue

        # アノテーション作成
        coco = create_coco_annotation(cat_name, data)

        # train用
        train_path = os.path.join(out_dir, f'dummy_{cat_name}_train.json')
        with open(train_path, 'w') as f:
            json.dump(coco, f, indent=2)
        print(f"[{cat_name}] train → {train_path} ({actual}点)")

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
