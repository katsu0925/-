"""キーポイントから採寸値を計算する定義
annotate.html の KP_MEASURE_MAP / MEASURES と完全同期すること。
"""

import math

# 採寸項目の定義
# type: "horizontal" = X座標の差（水平距離）
#       "vertical"   = Y座標の差（垂直距離）
#       "euclidean"  = 2点間のユークリッド距離
# points: [始点のキーポイントindex, 終点のキーポイントindex]

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
        "yukitake": {
            "type": "euclidean",
            "points": [0, 5],  # 襟中心→左袖口
            "jp_name": "裄丈",
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
        "hipWidth": {
            "type": "horizontal",
            "points": [3, 4],  # ヒップ左 ↔ 右
            "jp_name": "ヒップ",
        },
        "totalLength_pants": {
            "type": "vertical",
            "points": [1, 8],  # ウエスト右 → 右裾
            "jp_name": "総丈",
        },
        "frontRise": {
            "type": "vertical",
            "points": [2, 5],  # ウエスト中心 → 股
            "jp_name": "股上",
        },
        "inseam": {
            "type": "vertical",
            "points": [5, 7],  # 股 → 左裾
            "jp_name": "股下",
        },
        "thighWidth": {
            "type": "euclidean",
            "points": [5, 6],  # 股 → ワタリ外端
            "jp_name": "ワタリ",
        },
        "hemWidth": {
            "type": "horizontal",
            "points": [7, 8],  # 左裾 ↔ 右裾（片脚分）
            "jp_name": "裾幅",
        },
    },
    "skirt": {
        "waistWidth": {
            "type": "horizontal",
            "points": [0, 1],  # ウエスト左 ↔ 右
            "jp_name": "ウエスト",
        },
        "hipWidth": {
            "type": "horizontal",
            "points": [3, 4],  # ヒップ左 ↔ 右
            "jp_name": "ヒップ",
        },
        "skirtLength": {
            "type": "vertical",
            "points": [2, 7],  # ウエスト中心 → 裾中心
            "jp_name": "総丈",
        },
    },
    "dress": {
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
        "yukitake": {
            "type": "euclidean",
            "points": [0, 5],  # 襟中心→左袖口
            "jp_name": "裄丈",
        },
        "bodyWidth": {
            "type": "horizontal",
            "points": [3, 4],  # 左脇下 ↔ 右脇下
            "jp_name": "身幅",
        },
        "dressLength_bnp": {
            "type": "vertical",
            "points": [0, 9],  # 襟中心 → 裾中心
            "jp_name": "着丈",
        },
        "waistWidth": {
            "type": "horizontal",
            "points": [10, 11],  # ウエスト左 ↔ 右
            "jp_name": "ウエスト",
        },
    },
    "salopette": {
        "strapWidth": {
            "type": "horizontal",
            "points": [0, 1],  # 左肩紐上 ↔ 右肩紐上
            "jp_name": "肩幅",
        },
        "bodyWidth": {
            "type": "horizontal",
            "points": [2, 3],  # 左脇下 ↔ 右脇下
            "jp_name": "身幅",
        },
        "totalLength": {
            "type": "euclidean",
            "points": [1, 8],  # 右肩紐上 → 右裾
            "jp_name": "総丈",
        },
        "inseam": {
            "type": "vertical",
            "points": [6, 7],  # 股 → 左裾
            "jp_name": "股下",
        },
    },
}

# エイリアスカテゴリの採寸定義マッピング
MEASUREMENT_ALIASES = {
    "jacket": "tops",
    "suit_top": "tops",
    "roomwear_top": "tops",
    "maternity": "tops",
    "suit_bottom": "pants",
    "roomwear_bottom": "pants",
    "bridal": "dress",  # bridalはdressと同じキーポイントだが裄丈なし
}

# bridal専用: dressから裄丈を除外
MEASUREMENT_DEFINITIONS["bridal"] = {
    k: v for k, v in MEASUREMENT_DEFINITIONS["dress"].items()
    if k != "yukitake"
}


def calculate_measurements(keypoints, scale_cm_per_px, category):
    """
    キーポイント座標とスケールから採寸値（cm）を計算する。

    Args:
        keypoints: dict of {name: {"x": float, "y": float, "confidence": float}}
                   or list of dicts (index順)
        scale_cm_per_px: float (cm/px)
        category: str ("tops", "pants", "skirt", "dress", "salopette",
                       "jacket", "suit_top", "suit_bottom", etc.)

    Returns:
        dict of {name: {"value": float, "confidence": float, "jp_name": str,
                         "start": [x,y], "end": [x,y]}}
    """
    # エイリアス解決
    resolved = MEASUREMENT_ALIASES.get(category, category)
    defs = MEASUREMENT_DEFINITIONS.get(resolved, {})

    if isinstance(keypoints, dict):
        kp_list = list(keypoints.values())
    else:
        kp_list = keypoints

    results = {}

    for name, defn in defs.items():
        mtype = defn["type"]
        p1_idx, p2_idx = defn["points"]

        if p1_idx >= len(kp_list) or p2_idx >= len(kp_list):
            continue

        p1 = kp_list[p1_idx]
        p2 = kp_list[p2_idx]

        if mtype == "horizontal":
            px_dist = abs(p2["x"] - p1["x"])
        elif mtype == "vertical":
            px_dist = abs(p2["y"] - p1["y"])
        else:  # euclidean
            px_dist = math.sqrt((p2["x"] - p1["x"])**2 + (p2["y"] - p1["y"])**2)

        results[name] = {
            "value": round(px_dist * scale_cm_per_px, 1),
            "confidence": min(p1.get("confidence", 1.0), p2.get("confidence", 1.0)),
            "jp_name": defn["jp_name"],
            "start": [p1["x"], p1["y"]],
            "end": [p2["x"], p2["y"]],
        }

    return results
