#!/usr/bin/env python3
"""
COCOアノテーションのキーポイントを画像に描画して確認する。

使い方:
  python3 visualize_keypoints.py data/annotations/dummy_tops_train.json
  python3 visualize_keypoints.py data/annotations/dummy_skirt_train.json
  python3 visualize_keypoints.py data/annotations/dummy_dress_train.json
"""

import json
import sys
import os
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from configs.categories import CATEGORY_MAP, JP_NAMES

# 色パレット（キーポイントごと）
COLORS = [
    (0, 0, 255),     # 赤
    (255, 100, 0),   # 青
    (255, 100, 0),   # 青
    (0, 200, 0),     # 緑
    (0, 200, 0),     # 緑
    (0, 200, 200),   # 黄
    (0, 200, 200),   # 黄
    (200, 0, 200),   # マゼンタ
    (200, 0, 200),   # マゼンタ
    (0, 0, 200),     # 赤（裾中心）
    (255, 0, 255),   # ピンク
    (255, 0, 255),   # ピンク
]

MAX_SIZE = 2048


def visualize(ann_path):
    with open(ann_path) as f:
        coco = json.load(f)

    cat = coco["categories"][0]
    cat_name = cat["name"]
    kp_names = cat["keypoints"]
    skeleton = cat.get("skeleton", [])
    cat_def = CATEGORY_MAP.get(cat_name, {})

    img_dir_base = os.path.join(os.path.dirname(ann_path), '..', 'images')

    for img_info in coco["images"]:
        img_id = img_info["id"]
        fname = img_info["file_name"]

        # 画像を探す
        img_path = None
        for split in ['train', 'val', '']:
            p = os.path.join(img_dir_base, split, fname)
            if os.path.exists(p):
                img_path = p
                break
        if not img_path:
            # テストディレクトリから直接探す
            p = os.path.join(os.path.dirname(__file__), '..', '..', 'tools', 'ai-measure-test', fname)
            if os.path.exists(p):
                img_path = p

        if not img_path:
            print(f"画像が見つかりません: {fname}")
            continue

        img = cv2.imread(img_path)
        h, w = img.shape[:2]
        if max(w, h) > MAX_SIZE:
            r = MAX_SIZE / max(w, h)
            img = cv2.resize(img, (int(w * r), int(h * r)))
            scale = r
        else:
            scale = 1.0

        # このimage_idのアノテーション
        anns = [a for a in coco["annotations"] if a["image_id"] == img_id]

        for ann in anns:
            kps = ann["keypoints"]
            num_kps = len(kps) // 3

            points = []
            for i in range(num_kps):
                x = kps[i * 3] * scale
                y = kps[i * 3 + 1] * scale
                v = kps[i * 3 + 2]
                points.append((int(x), int(y), v))

            # スケルトン描画
            for s in skeleton:
                # COCO skeleton は 1-indexed
                idx1, idx2 = s[0] - 1, s[1] - 1
                if idx1 < len(points) and idx2 < len(points):
                    p1, p2 = points[idx1], points[idx2]
                    if p1[2] > 0 and p2[2] > 0:
                        color = COLORS[idx1 % len(COLORS)]
                        cv2.line(img, (p1[0], p1[1]), (p2[0], p2[1]),
                                color, 2, cv2.LINE_AA)

            # キーポイント描画
            for i, (x, y, v) in enumerate(points):
                if v == 0:
                    continue
                color = COLORS[i % len(COLORS)]
                # 丸
                radius = 10 if v == 2 else 6
                cv2.circle(img, (x, y), radius, color, -1, cv2.LINE_AA)
                cv2.circle(img, (x, y), radius + 2, (255, 255, 255), 2, cv2.LINE_AA)

                # ラベル
                name = kp_names[i] if i < len(kp_names) else f"kp{i}"
                jp = JP_NAMES.get(name, name)
                label = f"{i}:{jp}"
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                lx, ly = x + 15, y + 5
                cv2.rectangle(img, (lx - 2, ly - th - 4), (lx + tw + 4, ly + 4),
                             (0, 0, 0), -1)
                cv2.putText(img, label, (lx, ly),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

            # bbox描画
            bbox = ann.get("bbox", [])
            if len(bbox) == 4:
                bx, by, bw, bh = [int(v * scale) for v in bbox]
                cv2.rectangle(img, (bx, by), (bx + bw, by + bh), (200, 200, 200), 1)

        # 保存
        stem = os.path.splitext(fname)[0]
        out_path = os.path.join(os.path.dirname(ann_path), '..', f'{stem}_kp_vis.jpg')
        cv2.imwrite(out_path, img)
        print(f"可視化 → {out_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 visualize_keypoints.py <annotation.json>")
        sys.exit(1)

    for path in sys.argv[1:]:
        print(f"\n--- {path} ---")
        visualize(path)


if __name__ == "__main__":
    main()
