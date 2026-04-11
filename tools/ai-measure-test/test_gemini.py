#!/usr/bin/env python3
"""
Gemini 2.5 Pro セグメンテーション + CV スケール 採寸テスト

Phase 1: OpenCV A4検出 → ホモグラフィ補正 → スケール算出
Phase 2: Gemini 2.5 Pro でキーポイント座標特定（セグメンテーション対応）

使い方:
  python test_gemini.py IMG_1722.jpg --actual "shoulderWidth=57,sleeveLength=50,bodyLength_cb=49,bodyWidth=51"
"""

import os
import sys
import json
import base64
import argparse
import numpy as np
import cv2
from pathlib import Path
from google import genai
from google.genai import types

# ─── 設定 ───
MODEL = "gemini-2.5-pro"
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MAX_IMAGE_SIZE = 2048

# ─── A4検出（test_cv_ai.pyと共通ロジック） ───

def detect_a4_paper(image_path):
    """A4用紙の4角を検出"""
    img = cv2.imread(image_path)
    if img is None:
        print(f"ERROR: 画像を読み込めません: {image_path}")
        return None, None

    h, w = img.shape[:2]
    if max(w, h) > MAX_IMAGE_SIZE:
        scale = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
        h, w = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    kernel = np.ones((5, 5), np.uint8)

    best_rect = None
    best_score = 0

    for thresh_val in [180, 160, 140, 200]:
        _, thresh = cv2.threshold(blurred, thresh_val, 255, cv2.THRESH_BINARY)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < (w * h * 0.005):
                continue
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                rect = cv2.minAreaRect(contour)
                bw, bh = rect[1]
                if bw == 0 or bh == 0:
                    continue
                aspect = max(bw, bh) / min(bw, bh)
                if 1.1 < aspect < 1.8:
                    score = area * (1.0 - abs(aspect - 1.414) / 1.414)
                    if score > best_score:
                        best_score = score
                        best_rect = approx

        if best_rect is not None:
            break

    if best_rect is None:
        # Canny fallback
        edges = cv2.Canny(gray, 50, 150)
        edges = cv2.dilate(edges, np.ones((3,3), np.uint8), iterations=1)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < (w * h * 0.005):
                continue
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.03 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                rect = cv2.minAreaRect(contour)
                bw, bh = rect[1]
                if bw == 0 or bh == 0:
                    continue
                aspect = max(bw, bh) / min(bw, bh)
                if 1.1 < aspect < 1.8:
                    if area > best_score:
                        best_score = area
                        best_rect = approx

    if best_rect is None:
        return None, img

    corners = order_corners(best_rect.reshape(4, 2))
    return process_corners(corners, w, h, img)


def order_corners(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def process_corners(corners, w, h, img):
    tl, tr, br, bl = corners
    width_avg = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height_avg = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    aspect = height_avg / width_avg
    scale = A4_WIDTH_CM / width_avg

    print(f"📐 A4検出: 横={width_avg:.1f}px 縦={height_avg:.1f}px 比={aspect:.3f} スケール={scale:.6f} cm/px")

    # ホモグラフィ補正
    warped = apply_homography(img, corners)

    return {
        "corners": [[float(c[0]), float(c[1])] for c in corners],
        "widthPx": float(width_avg),
        "heightPx": float(height_avg),
        "aspect": float(aspect),
        "scale": float(scale),
        "imageSize": [w, h]
    }, warped


def apply_homography(img, corners):
    """A4の4角からホモグラフィ補正を適用（正射影に変換）"""
    h, w = img.shape[:2]
    tl, tr, br, bl = corners

    # 変換先: 元画像と同じサイズを維持（A4の比率で正規化）
    # A4の中心を画像の中心に合わせる
    a4_cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4
    a4_cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4
    a4_w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    a4_h = a4_w * (A4_HEIGHT_CM / A4_WIDTH_CM)

    dst = np.array([
        [a4_cx - a4_w/2, a4_cy - a4_h/2],
        [a4_cx + a4_w/2, a4_cy - a4_h/2],
        [a4_cx + a4_w/2, a4_cy + a4_h/2],
        [a4_cx - a4_w/2, a4_cy + a4_h/2]
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, M, (w, h))

    # デバッグ画像保存
    cv2.imwrite("warped_debug.jpg", warped)
    print(f"  ホモグラフィ補正適用済み → warped_debug.jpg")

    return warped


# ─── Gemini API ───

PROMPT = """あなたは衣類の平置き採寸エンジンです。
画像には平置きされた衣類とA4用紙（白い紙、四隅にL字マーカー）が写っています。

# スケール情報（OpenCVで算出済み）
scaleCmPerPx = {scale} cm/px
画像サイズ = {img_w} x {img_h} px

# あなたの仕事
1. 衣類のカテゴリ（itemType）を判定
2. カテゴリに応じた各採寸項目について、画像上の始点と終点のピクセル座標を特定
3. 2点間のピクセル距離を計算し、scaleCmPerPx を掛けてcm値を算出
4. 全値は平置き片面の実寸（×2しない）

# カテゴリと採寸項目
## トップス (tshirt/shirt/sweatshirt/hoodie/outerwear)
- bodyLength_cb（着丈）: 後ろ襟中心の付け根 → 裾の最下端（背中心線上）
- bodyWidth（身幅）: 左脇下の縫い合わせ → 右脇下の縫い合わせ
- shoulderWidth（肩幅）: 左肩の先端 → 右肩の先端
- sleeveLength（袖丈）: 肩先（肩と袖の縫い目） → 袖口の端

## パンツ (pants)
- totalLength_pants（総丈）: ウエスト上端 → 裾最下端
- waistWidth（ウエスト）: ウエスト上端の左端 → 右端
- hipWidth_cfg（ヒップ）: ファスナー止まり高さの左右端
- frontRise（股上）: ウエスト上端 → 内股の交差点
- inseam（股下）: 内股の交差点 → 裾（内股縫い目沿い）
- thighWidth（ワタリ）: 内股交差点の高さの左右端
- hemWidth（裾幅）: 裾の左端 → 右端

## スカート (skirt)
- waistWidth（ウエスト）: 上端の左端 → 右端
- hipWidth_cfg（ヒップ）: 上端から18cm下の左右端
- skirtLength（総丈）: 上端 → 裾最下端

## ワンピース (dress)
- dressLength_bnp（着丈）: 後ろ襟中心の付け根 → 裾最下端
- bodyWidth（身幅）: 左脇下 → 右脇下
- shoulderWidth（肩幅）: 左肩先 → 右肩先
- sleeveLength（袖丈）: 肩先 → 袖口端
- waistWidth（ウエスト）: くびれ位置の左右端（切替がある場合）

# 出力（JSONのみ）
{{
  "itemType": "...",
  "measurements": {{
    "項目名": {{
      "startPx": [x, y],
      "endPx": [x, y],
      "distancePx": 数値,
      "value": cm値（小数1桁）,
      "confidence": "high/medium/low"
    }}
  }}
}}
"""


def measure_with_gemini(image_path, cv_result, warped_img):
    """Gemini 2.5 Proでキーポイント特定"""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)

    # ホモグラフィ補正済み画像をJPEGに変換
    _, buf = cv2.imencode('.jpg', warped_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    image_bytes = buf.tobytes()

    h, w = warped_img.shape[:2]
    prompt = PROMPT.format(
        scale=cv_result["scale"],
        img_w=w,
        img_h=h
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    types.Part.from_text(text=prompt)
                ]
            )
        ],
        config=types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json"
        )
    )

    content = response.text
    usage = response.usage_metadata

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        # JSON部分を抽出
        import re
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            result = json.loads(match.group())
        else:
            result = {"error": "JSONパース失敗", "raw": content}

    return result, usage


def parse_actual(actual_str):
    actual = {}
    for pair in actual_str.split(","):
        key, val = pair.strip().split("=")
        actual[key.strip()] = float(val.strip())
    return actual


def print_and_compare(result, usage, cv_result, actual=None):
    """結果表示と比較"""
    print(f"\nカテゴリ: {result.get('itemType', '不明')}")
    print(f"CVスケール: {cv_result['scale']:.6f} cm/px")

    measurements = result.get("measurements", {})
    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'信頼度':>8}  {'始点':>15} {'終点':>15} {'距離px':>8}")
        print("-" * 85)
        for key, item in measurements.items():
            if isinstance(item, dict):
                val = item.get("value")
                val_str = f"{val:.1f}" if val is not None else "null"
                conf = item.get("confidence", "?")
                start = item.get("startPx", [])
                end = item.get("endPx", [])
                dist = item.get("distancePx", "")
                dist_str = f"{dist:.0f}" if isinstance(dist, (int, float)) else str(dist)
                print(f"{key:<20} {val_str:>8} {conf:>8}  {str(start):>15} {str(end):>15} {dist_str:>8}")

    if usage:
        print(f"\nトークン: 入力={usage.prompt_token_count}, 出力={usage.candidates_token_count}")
        # Gemini 2.5 Pro pricing
        cost_in = usage.prompt_token_count * 1.25 / 1_000_000
        cost_out = usage.candidates_token_count * 10.00 / 1_000_000
        cost_total = cost_in + cost_out
        print(f"費用: ${cost_total:.4f} (約¥{cost_total * 150:.1f})")

    if actual:
        print("\n" + "=" * 70)
        print("📏 実測値との比較")
        print("=" * 70)
        print(f"{'項目':<20} {'AI値':>8} {'実測値':>8} {'誤差':>8} {'判定':>6}")
        print("-" * 70)

        errors = []
        for key, actual_val in actual.items():
            ai_item = measurements.get(key, {})
            ai_val = ai_item.get("value") if isinstance(ai_item, dict) else None

            if ai_val is None:
                print(f"{key:<20} {'null':>8} {actual_val:>8.1f} {'---':>8} {'---':>6}")
                continue

            diff = ai_val - actual_val
            abs_diff = abs(diff)
            errors.append(abs_diff)
            judge = "✅" if abs_diff <= 2.0 else ("⚠️" if abs_diff <= 5.0 else "❌")
            sign = "+" if diff > 0 else ""
            print(f"{key:<20} {ai_val:>8.1f} {actual_val:>8.1f} {sign}{diff:>7.1f} {judge:>6}")

        if errors:
            avg = sum(errors) / len(errors)
            within_2 = sum(1 for e in errors if e <= 2.0)
            within_5 = sum(1 for e in errors if e <= 5.0)
            total = len(errors)
            print("-" * 70)
            print(f"平均誤差: {avg:.1f}cm | ±2cm: {within_2}/{total} ({within_2/total*100:.0f}%) | ±5cm: {within_5}/{total} ({within_5/total*100:.0f}%)")


def main():
    parser = argparse.ArgumentParser(description="Gemini 2.5 Pro 採寸テスト")
    parser.add_argument("input", help="画像ファイル")
    parser.add_argument("--actual", type=str, default=None, help="実測値")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY が未設定です")
        sys.exit(1)

    image_path = args.input
    if not Path(image_path).exists():
        print(f"ERROR: {image_path} が見つかりません")
        sys.exit(1)

    # Phase 1: CV
    print("=" * 70)
    print("Phase 1: OpenCV A4検出 + ホモグラフィ補正")
    print("=" * 70)
    cv_result, warped = detect_a4_paper(image_path)

    if cv_result is None:
        print("❌ A4検出失敗")
        sys.exit(1)

    # Phase 2: Gemini
    print("\n" + "=" * 70)
    print("Phase 2: Gemini 2.5 Pro キーポイント特定")
    print("=" * 70)

    actual = parse_actual(args.actual) if args.actual else None
    result, usage = measure_with_gemini(image_path, cv_result, warped)
    print_and_compare(result, usage, cv_result, actual)

    # 保存
    stem = Path(image_path).stem
    output_path = f"{stem}_gemini_result.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"cv": cv_result, "gemini": result}, f, ensure_ascii=False, indent=2)
    print(f"\n結果を {output_path} に保存")


if __name__ == "__main__":
    main()
