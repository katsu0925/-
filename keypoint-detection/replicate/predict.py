"""
衣類キーポイント検出 — Replicate Cog Predictor

4カテゴリ（tops/pants/skirt/dress）のHRNet-w48モデルを全てロードし、
categoryパラメータに応じて適切なモデルで推論する。

入力: 画像 + category
出力: JSON（キーポイント座標 + confidence + 採寸計算用メタデータ）
"""

import json
import os
import tempfile
from typing import Any

import cv2
import numpy as np
from cog import BasePredictor, Input, Path

# MMPose imports
from mmpose.apis import init_model, inference_topdown
from mmpose.utils import register_all_modules

# モデル設定
MODELS = {
    "tops": {
        "config": "configs/tops_hrnet_w48.py",
        "weights": "weights/tops_best.pth",
        "keypoints": [
            "collar_center", "left_shoulder", "right_shoulder",
            "left_armpit", "right_armpit", "left_cuff", "right_cuff",
            "hem_left", "hem_right", "hem_center"
        ],
    },
    "pants": {
        "config": "configs/pants_hrnet_w48.py",
        "weights": "weights/pants_best.pth",
        "keypoints": [
            "waist_left", "waist_right", "crotch",
            "left_hem", "right_hem", "left_thigh", "right_thigh"
        ],
    },
    "skirt": {
        "config": "configs/skirt_hrnet_w48.py",
        "weights": "weights/skirt_best.pth",
        "keypoints": [
            "waist_left", "waist_right",
            "hip_left", "hip_right",
            "hem_left", "hem_right"
        ],
    },
    "dress": {
        "config": "configs/dress_hrnet_w48.py",
        "weights": "weights/dress_best.pth",
        "keypoints": [
            "collar_center", "left_shoulder", "right_shoulder",
            "left_armpit", "right_armpit", "left_cuff", "right_cuff",
            "hem_left", "hem_right", "hem_center",
            "waist_left", "waist_right"
        ],
    },
}

# 採寸計算の定義（Workers側でも同じ計算をするが、レスポンスに含める）
MEASUREMENT_DEFS = {
    "tops": {
        "shoulderWidth":  {"type": "horizontal", "points": ["left_shoulder", "right_shoulder"], "jp": "肩幅"},
        "sleeveLength":   {"type": "euclidean",  "points": ["left_shoulder", "left_cuff"], "jp": "袖丈"},
        "bodyWidth":      {"type": "horizontal", "points": ["left_armpit", "right_armpit"], "jp": "身幅"},
        "bodyLength_cb":  {"type": "vertical",   "points": ["collar_center", "hem_center"], "jp": "着丈"},
    },
    "pants": {
        "waistWidth":        {"type": "horizontal", "points": ["waist_left", "waist_right"], "jp": "ウエスト"},
        "totalLength_pants": {"type": "vertical",   "points": ["waist_left", "left_hem"], "jp": "総丈"},
        "frontRise":         {"type": "vertical",   "points": ["waist_left", "crotch"], "jp": "股上"},
        "inseam":            {"type": "vertical",   "points": ["crotch", "left_hem"], "jp": "股下"},
        "thighWidth":        {"type": "horizontal", "points": ["left_thigh", "right_thigh"], "jp": "ワタリ"},
        "hemWidth":          {"type": "horizontal", "points": ["left_hem", "right_hem"], "jp": "裾幅"},
    },
    "skirt": {
        "waistWidth":   {"type": "horizontal", "points": ["waist_left", "waist_right"], "jp": "ウエスト"},
        "hipWidth_cfg": {"type": "horizontal", "points": ["hip_left", "hip_right"], "jp": "ヒップ"},
        "skirtLength":  {"type": "vertical",   "points": ["waist_left", "hem_left"], "jp": "総丈"},
    },
    "dress": {
        "shoulderWidth":   {"type": "horizontal", "points": ["left_shoulder", "right_shoulder"], "jp": "肩幅"},
        "sleeveLength":    {"type": "euclidean",  "points": ["left_shoulder", "left_cuff"], "jp": "袖丈"},
        "bodyWidth":       {"type": "horizontal", "points": ["left_armpit", "right_armpit"], "jp": "身幅"},
        "dressLength_bnp": {"type": "vertical",   "points": ["collar_center", "hem_center"], "jp": "着丈"},
        "waistWidth":      {"type": "horizontal", "points": ["waist_left", "waist_right"], "jp": "ウエスト"},
    },
}


def calc_px_distance(p1, p2, mtype):
    """2点間のピクセル距離を計算"""
    if mtype == "horizontal":
        return abs(p2["x"] - p1["x"])
    elif mtype == "vertical":
        return abs(p2["y"] - p1["y"])
    else:  # euclidean
        return ((p2["x"] - p1["x"]) ** 2 + (p2["y"] - p1["y"]) ** 2) ** 0.5


class Predictor(BasePredictor):
    def setup(self):
        """全4カテゴリのモデルをGPUにロード"""
        register_all_modules()
        self.models = {}
        base_dir = os.path.dirname(os.path.abspath(__file__))

        for cat, info in MODELS.items():
            config_path = os.path.join(base_dir, info["config"])
            weights_path = os.path.join(base_dir, info["weights"])

            if os.path.exists(weights_path):
                self.models[cat] = init_model(config_path, weights_path, device="cuda:0")
                print(f"[{cat}] モデルロード完了")
            else:
                print(f"[{cat}] 重みファイルなし: {weights_path} — スキップ")

    def predict(
        self,
        image: Path = Input(description="衣類 + A4用紙の画像"),
        category: str = Input(
            description="衣類カテゴリ",
            choices=["tops", "pants", "skirt", "dress"],
            default="tops",
        ),
        bbox: str = Input(
            description="衣類のバウンディングボックス [x1,y1,x2,y2]。空の場合は画像全体。",
            default="",
        ),
        scale: float = Input(
            description="A4検出で算出したスケール (cm/px)。0の場合はcm値なしでpx座標のみ返す。",
            default=0.0,
        ),
    ) -> str:
        """キーポイント検出を実行し、JSON文字列を返す"""

        if category not in self.models:
            return json.dumps({
                "error": f"モデル '{category}' が利用できません",
                "available": list(self.models.keys()),
            })

        model = self.models[category]
        img = cv2.imread(str(image))
        if img is None:
            return json.dumps({"error": "画像を読み込めませんでした"})

        h, w = img.shape[:2]

        # bbox
        if bbox:
            try:
                bboxes = [json.loads(bbox)]
            except json.JSONDecodeError:
                bboxes = [[0, 0, w, h]]
        else:
            bboxes = [[0, 0, w, h]]

        # 推論
        results = inference_topdown(model, str(image), bboxes)

        if not results:
            return json.dumps({"error": "キーポイントが検出できませんでした"})

        result = results[0]
        pred_kps = result.pred_instances.keypoints[0].tolist()
        pred_scores = result.pred_instances.keypoint_scores[0].tolist()
        kp_names = MODELS[category]["keypoints"]

        # キーポイント出力
        keypoints = {}
        for i, name in enumerate(kp_names):
            keypoints[name] = {
                "x": round(pred_kps[i][0], 1),
                "y": round(pred_kps[i][1], 1),
                "confidence": round(pred_scores[i], 4),
            }

        # 採寸値の計算（スケールが指定されている場合）
        measurements = {}
        if scale > 0:
            defs = MEASUREMENT_DEFS.get(category, {})
            for mname, mdef in defs.items():
                p1_name, p2_name = mdef["points"]
                p1 = keypoints[p1_name]
                p2 = keypoints[p2_name]
                px_dist = calc_px_distance(p1, p2, mdef["type"])
                cm_val = round(px_dist * scale, 1)
                conf = min(p1["confidence"], p2["confidence"])

                measurements[mname] = {
                    "value_cm": cm_val,
                    "value_px": round(px_dist, 1),
                    "confidence": round(conf, 4),
                    "jp_name": mdef["jp"],
                    "start": [p1["x"], p1["y"]],
                    "end": [p2["x"], p2["y"]],
                }

        output = {
            "category": category,
            "image_size": [w, h],
            "keypoints": keypoints,
            "measurements": measurements,
        }

        return json.dumps(output, ensure_ascii=False)
