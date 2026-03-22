"""キーポイントから採寸値を計算する定義"""

import math

# 採寸項目の定義
# type: "horizontal" = X座標の差（水平距離）
#       "vertical"   = Y座標の差（垂直距離）
#       "euclidean"  = 2点間のユークリッド距離
# points: [始点のキーポイントID, 終点のキーポイントID]
# sides: 左右両方を測る場合（袖丈など）→ 平均を取る

MEASUREMENT_DEFINITIONS = {
    "tops": {
        "shoulderWidth": {
            "type": "horizontal",
            "points": [1, 2],  # 左肩先 ↔ 右肩先
            "jp_name": "肩幅",
        },
        "sleeveLength": {
            "type": "euclidean",
            "points": [1, 5],  # 左肩先→左袖口
            "jp_name": "袖丈",
        },
        "bodyWidth": {
            "type": "horizontal",
            "points": [3, 4],  # 左脇下 ↔ 右脇下
            "jp_name": "身幅",
        },
        "bodyLength_cb": {
            "type": "vertical",
            "points": [0, 9],  # 襟中心 → 裾中心
            "jp_name": "着丈",
        },
    },
    "pants": {
        "waistWidth": {
            "type": "horizontal",
            "points": [0, 1],  # ウエスト左 ↔ 右
            "jp_name": "ウエスト",
        },
        "totalLength_pants": {
            "type": "vertical",
            "points": [0, 3],  # ウエスト上端 → 左裾
            "jp_name": "総丈",
        },
        "frontRise": {
            "type": "vertical",
            "points": [0, 2],  # ウエスト上端 → 股
            "jp_name": "股上",
        },
        "inseam": {
            "type": "vertical",
            "points": [2, 3],  # 股 → 左裾
            "jp_name": "股下",
        },
        "thighWidth": {
            "type": "horizontal",
            "points": [5, 6],  # ワタリ左 ↔ 右
            "jp_name": "ワタリ",
        },
        "hemWidth": {
            "type": "horizontal_avg",
            "pairs": [[3, 4]],  # 裾左右（パンツの裾は片脚分）
            "jp_name": "裾幅",
            "note": "片脚の裾幅。ここでは左裾中心→右裾中心の距離の半分程度",
        },
    },
    "skirt": {
        "waistWidth": {
            "type": "horizontal",
            "points": [0, 1],
            "jp_name": "ウエスト",
        },
        "hipWidth_cfg": {
            "type": "horizontal",
            "points": [2, 3],  # ヒップ左 ↔ 右
            "jp_name": "ヒップ",
        },
        "skirtLength": {
            "type": "vertical",
            "points": [0, 4],  # ウエスト上端 → 裾左端
            "jp_name": "総丈",
        },
    },
    "dress": {
        "shoulderWidth": {
            "type": "horizontal",
            "points": [1, 2],
            "jp_name": "肩幅",
        },
        "sleeveLength": {
            "type": "euclidean",
            "points": [1, 5],  # 左肩先→左袖口
            "jp_name": "袖丈",
        },
        "bodyWidth": {
            "type": "horizontal",
            "points": [3, 4],
            "jp_name": "身幅",
        },
        "dressLength_bnp": {
            "type": "vertical",
            "points": [0, 9],
            "jp_name": "着丈",
        },
        "waistWidth": {
            "type": "horizontal",
            "points": [10, 11],
            "jp_name": "ウエスト",
        },
    },
}


def calculate_measurements(keypoints, scale_cm_per_px, category):
    """
    キーポイント座標とスケールから採寸値（cm）を計算する。

    Args:
        keypoints: dict of {name: {"x": float, "y": float, "confidence": float}}
        scale_cm_per_px: float (cm/px)
        category: str ("tops", "pants", "skirt", "dress")

    Returns:
        dict of {name: {"value": float, "confidence": float, "jp_name": str,
                         "start": [x,y], "end": [x,y]}}
    """
    defs = MEASUREMENT_DEFINITIONS.get(category, {})
    kp_list = list(keypoints.values())
    results = {}

    for name, defn in defs.items():
        mtype = defn["type"]

        if mtype in ("horizontal", "vertical", "euclidean"):
            p1_idx, p2_idx = defn["points"]
            p1 = kp_list[p1_idx]
            p2 = kp_list[p2_idx]

            if mtype == "horizontal":
                px_dist = abs(p2["x"] - p1["x"])
            elif mtype == "vertical":
                px_dist = abs(p2["y"] - p1["y"])
            else:
                px_dist = math.sqrt((p2["x"] - p1["x"])**2 + (p2["y"] - p1["y"])**2)

            results[name] = {
                "value": round(px_dist * scale_cm_per_px, 1),
                "confidence": min(p1["confidence"], p2["confidence"]),
                "jp_name": defn["jp_name"],
                "start": [p1["x"], p1["y"]],
                "end": [p2["x"], p2["y"]],
            }

        elif mtype == "euclidean_avg":
            distances = []
            confidences = []
            starts = []
            ends = []
            for p1_idx, p2_idx in defn["pairs"]:
                p1 = kp_list[p1_idx]
                p2 = kp_list[p2_idx]
                dist = math.sqrt((p2["x"] - p1["x"])**2 + (p2["y"] - p1["y"])**2)
                distances.append(dist)
                confidences.append(min(p1["confidence"], p2["confidence"]))
                starts.append([p1["x"], p1["y"]])
                ends.append([p2["x"], p2["y"]])

            avg_dist = sum(distances) / len(distances)
            # 信頼度が高い方の始点・終点を返す
            best = confidences.index(max(confidences))
            results[name] = {
                "value": round(avg_dist * scale_cm_per_px, 1),
                "confidence": max(confidences),
                "jp_name": defn["jp_name"],
                "start": starts[best],
                "end": ends[best],
            }

    return results
