#!/usr/bin/env python3
"""
キーポイント検出結果を実測値と比較して採寸精度を評価する。

使い方（推論結果JSONを入力）:
  python3 evaluate.py results.json --category tops --scale 0.0897

または手動で座標を指定:
  python3 evaluate.py --category tops --scale 0.0897 \
    --keypoints '{"collar_center":[2142,930],"left_shoulder":[1350,1350],...}'
"""

import json
import sys
import os
import argparse
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from configs.measurements import calculate_measurements, MEASUREMENT_DEFINITIONS

# 実測値（cm）
ACTUAL_VALUES = {
    "tops": {
        # IMG_1722 スウェット
        "shoulderWidth": 57.0,
        "sleeveLength": 50.0,
        "bodyWidth": 51.0,
        "bodyLength_cb": 49.0,
    },
    "skirt": {
        # IMG_1723 スカート
        "waistWidth": 31.0,
        "hipWidth_cfg": 37.0,
        "skirtLength": 38.0,
    },
    "dress": {
        # IMG_1724 ワンピース
        "shoulderWidth": 36.0,
        "sleeveLength": 17.0,
        "bodyWidth": 30.0,
        "dressLength_bnp": 83.0,
        "waistWidth": 27.0,
    },
    "pants": {
        # IMG_1721 パンツ
        "waistWidth": 33.0,
        "totalLength_pants": 93.0,
        "frontRise": 28.0,
        "inseam": 68.0,
        "thighWidth": 27.0,
        "hemWidth": 16.5,
    },
}


def evaluate(keypoints, scale, category):
    """キーポイント座標から採寸値を計算し、実測値と比較"""
    # keypoints: dict of {name: {"x": float, "y": float, "confidence": float}}
    measurements = calculate_measurements(keypoints, scale, category)
    actual = ACTUAL_VALUES.get(category, {})

    print(f"\nカテゴリ: {category}")
    print(f"スケール: {scale:.6f} cm/px")
    print(f"\n{'項目':<20} {'検出値':>8} {'実測値':>8} {'誤差':>8} {'判定':>6}")
    print("-" * 65)

    errors = []
    for name, m in measurements.items():
        act = actual.get(name)
        val = m["value"]
        jp = m["jp_name"]

        if act is not None:
            diff = val - act
            ad = abs(diff)
            errors.append(ad)
            mark = "✅" if ad <= 2 else ("⚠️" if ad <= 5 else "❌")
            sign = "+" if diff > 0 else ""
            print(f"{jp}({name})" + " " * max(0, 18 - len(jp) - len(name))
                  + f" {val:>8.1f} {act:>8.1f} {sign}{diff:>7.1f} {mark}")
        else:
            print(f"{jp}({name})" + " " * max(0, 18 - len(jp) - len(name))
                  + f" {val:>8.1f} {'---':>8} {'---':>8}")

    if errors:
        avg = sum(errors) / len(errors)
        w2 = sum(1 for e in errors if e <= 2)
        w5 = sum(1 for e in errors if e <= 5)
        t = len(errors)
        print("-" * 65)
        print(f"平均誤差: {avg:.1f}cm | ±2cm: {w2}/{t} ({w2/t*100:.0f}%) | ±5cm: {w5}/{t} ({w5/t*100:.0f}%)")
        return avg
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("result_json", nargs="?", help="推論結果JSON")
    parser.add_argument("--category", required=True)
    parser.add_argument("--scale", type=float, required=True, help="cm/px スケール")
    parser.add_argument("--keypoints", type=str, help="JSON形式のキーポイント座標")
    args = parser.parse_args()

    if args.result_json:
        with open(args.result_json) as f:
            result = json.load(f)
        keypoints = result.get("keypoints", {})
        # {name: {x, y, confidence}} 形式に変換
        if keypoints and isinstance(list(keypoints.values())[0], dict):
            kp = keypoints
        else:
            kp = {k: {"x": v[0], "y": v[1], "confidence": 1.0}
                  for k, v in keypoints.items()}
    elif args.keypoints:
        raw = json.loads(args.keypoints)
        kp = {k: {"x": v[0], "y": v[1], "confidence": 1.0}
              for k, v in raw.items()}
    else:
        print("result_json または --keypoints を指定してください")
        sys.exit(1)

    evaluate(kp, args.scale, args.category)


if __name__ == "__main__":
    main()
