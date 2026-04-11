#!/usr/bin/env python3
"""
CV輪郭解析 + AI選択 パイプライン

1. OpenCV: A4検出 → ホモグラフィ補正 → 背景除去 → 輪郭検出 → キーポイント候補抽出
2. AI: 候補座標リストから「肩先はどれ？脇下はどれ？」を選択させる

使い方:
  python test_cv_keypoints.py IMG_1722.jpg --actual "shoulderWidth=57,sleeveLength=50,bodyLength_cb=49,bodyWidth=51"
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

MODEL = "gemini-2.5-pro"
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MAX_IMAGE_SIZE = 2048


# ─── A4検出 + ホモグラフィ補正 ───

def detect_a4(img):
    """A4検出してホモグラフィ補正"""
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

        for c in contours:
            area = cv2.contourArea(c)
            if area < (w * h * 0.005):
                continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                rect = cv2.minAreaRect(c)
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
        return None, None, img

    pts = best_rect.reshape(4, 2).astype("float32")
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]

    tl, tr, br, bl = rect
    width_avg = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height_avg = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    scale = A4_WIDTH_CM / width_avg

    print(f"📐 A4: 横={width_avg:.0f}px 縦={height_avg:.0f}px 比={height_avg/width_avg:.3f} scale={scale:.6f}")

    # ホモグラフィ補正
    a4_cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4
    a4_cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4
    a4_w = width_avg
    a4_h = a4_w * (A4_HEIGHT_CM / A4_WIDTH_CM)
    dst = np.array([
        [a4_cx - a4_w/2, a4_cy - a4_h/2],
        [a4_cx + a4_w/2, a4_cy - a4_h/2],
        [a4_cx + a4_w/2, a4_cy + a4_h/2],
        [a4_cx - a4_w/2, a4_cy + a4_h/2]
    ], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, M, (w, h))

    return float(scale), rect, warped


# ─── 衣類輪郭検出 + キーポイント候補抽出 ───

def extract_garment_keypoints(warped, a4_corners):
    """衣類の輪郭からキーポイント候補を抽出"""
    h, w = warped.shape[:2]
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    # A4用紙領域をマスク（衣類検出の邪魔にならないよう）
    a4_mask = np.ones((h, w), dtype=np.uint8) * 255
    if a4_corners is not None:
        a4_poly = a4_corners.astype(np.int32)
        cv2.fillPoly(a4_mask, [a4_poly], 0)

    # 背景除去: GrabCut風の簡易版（中央の衣類を前景と仮定）
    # まず閾値で大まかにセグメンテーション
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    # Otsu の二値化
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # 背景が明るい（白カーペット）場合: 暗い部分が衣類
    # 背景が暗い場合も考慮して、画像端のピクセルの平均で判定
    border_mean = np.mean([
        gray[0, :].mean(), gray[-1, :].mean(),
        gray[:, 0].mean(), gray[:, -1].mean()
    ])

    if border_mean > 128:
        # 背景が明るい → 暗い部分が衣類
        _, fg_mask = cv2.threshold(blurred, border_mean * 0.7, 255, cv2.THRESH_BINARY_INV)
    else:
        # 背景が暗い → 明るい部分が衣類
        _, fg_mask = cv2.threshold(blurred, border_mean * 1.3, 255, cv2.THRESH_BINARY)

    # A4マスクを適用
    fg_mask = cv2.bitwise_and(fg_mask, a4_mask)

    # モルフォロジーでノイズ除去
    kernel = np.ones((7, 7), np.uint8)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=2)

    # 最大輪郭 = 衣類
    contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        print("❌ 衣類輪郭が見つかりません")
        return None, None

    garment_contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(garment_contour)
    print(f"👕 衣類輪郭: 面積={area:.0f}px² ({area/(w*h)*100:.1f}%)")

    # 凸包と凹点
    hull = cv2.convexHull(garment_contour, returnPoints=False)
    try:
        defects = cv2.convexityDefects(garment_contour, hull)
    except:
        defects = None

    # キーポイント候補を抽出
    candidates = extract_candidates(garment_contour, defects, w, h)

    # デバッグ画像
    debug = warped.copy()
    cv2.drawContours(debug, [garment_contour], -1, (0, 255, 0), 2)
    for i, (name, x, y) in enumerate(candidates):
        color = (0, 0, 255) if 'concave' in name else (255, 0, 0)
        cv2.circle(debug, (int(x), int(y)), 8, color, -1)
        cv2.putText(debug, f"{i}:{name}", (int(x)+10, int(y)-5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    cv2.imwrite("keypoints_debug.jpg", debug)
    print(f"  キーポイント候補: {len(candidates)}個 → keypoints_debug.jpg")

    return candidates, garment_contour


def extract_candidates(contour, defects, img_w, img_h):
    """輪郭から主要キーポイント候補を抽出"""
    candidates = []

    # バウンディングボックスの極値点
    leftmost = tuple(contour[contour[:, :, 0].argmin()][0])
    rightmost = tuple(contour[contour[:, :, 0].argmax()][0])
    topmost = tuple(contour[contour[:, :, 1].argmin()][0])
    bottommost = tuple(contour[contour[:, :, 1].argmax()][0])

    candidates.append(("top_center", topmost[0], topmost[1]))
    candidates.append(("bottom_center", bottommost[0], bottommost[1]))
    candidates.append(("leftmost", leftmost[0], leftmost[1]))
    candidates.append(("rightmost", rightmost[0], rightmost[1]))

    # 上部の左右端（肩幅候補）: 上から20%の範囲での左右端
    bbox = cv2.boundingRect(contour)
    bx, by, bw, bh = bbox
    upper_y = by + int(bh * 0.25)
    upper_points = contour[contour[:, :, 1] < upper_y]
    if len(upper_points) > 0:
        ul = upper_points[upper_points[:, 0].argmin()]
        ur = upper_points[upper_points[:, 0].argmax()]
        candidates.append(("upper_left", int(ul[0]), int(ul[1])))
        candidates.append(("upper_right", int(ur[0]), int(ur[1])))

    # 中央部の左右端（身幅候補）: 30-50%の範囲
    mid_y_start = by + int(bh * 0.3)
    mid_y_end = by + int(bh * 0.5)
    mid_points = contour[(contour[:, :, 1] > mid_y_start) & (contour[:, :, 1] < mid_y_end)]
    if len(mid_points) > 0:
        ml = mid_points[mid_points[:, 0].argmin()]
        mr = mid_points[mid_points[:, 0].argmax()]
        candidates.append(("mid_left", int(ml[0]), int(ml[1])))
        candidates.append(("mid_right", int(mr[0]), int(mr[1])))

    # 下部の左右端（裾幅候補）: 下から15%
    lower_y = by + int(bh * 0.85)
    lower_points = contour[contour[:, :, 1] > lower_y]
    if len(lower_points) > 0:
        ll = lower_points[lower_points[:, 0].argmin()]
        lr = lower_points[lower_points[:, 0].argmax()]
        candidates.append(("lower_left", int(ll[0]), int(ll[1])))
        candidates.append(("lower_right", int(lr[0]), int(lr[1])))

    # 凹点（脇下・股下候補）
    if defects is not None:
        # 深さでソートして上位を取得
        depth_list = []
        for i in range(defects.shape[0]):
            s, e, f, d = defects[i, 0]
            far = tuple(contour[f][0])
            depth_list.append((d / 256.0, far))

        depth_list.sort(reverse=True)
        for i, (depth, pt) in enumerate(depth_list[:6]):
            if depth > 10:  # 最低深度フィルタ
                candidates.append((f"concave_{i}_d{depth:.0f}", pt[0], pt[1]))

    return candidates


# ─── AI に候補から選択させる ───

SELECT_PROMPT = """画像には平置きされた衣類が写っています。
衣類の輪郭上に番号付きのキーポイント候補（赤=凹点、青=凸点/端点）が表示されています。

# スケール情報
scaleCmPerPx = {scale} cm/px

# キーポイント候補一覧
{candidates_text}

# あなたの仕事
1. 衣類のカテゴリを判定
2. 各採寸項目について、上の候補リストから**始点と終点の番号**を選ぶ
3. 選んだ2点間のピクセル距離を計算し、scaleCmPerPx でcmに変換
4. 候補にない場合は、2つの候補の中間点や、候補の座標を微調整して使ってよい

# 採寸項目（カテゴリに応じて必要なもののみ）
- bodyLength_cb（着丈）: 襟付け根の中心 → 裾最下端
- bodyWidth（身幅）: 左脇下 → 右脇下（腕の付け根の内側）
- shoulderWidth（肩幅）: 左肩先 → 右肩先
- sleeveLength（袖丈）: 肩先 → 袖口端
- waistWidth（ウエスト）: ウエスト左端 → 右端
- hipWidth_cfg（ヒップ）: ヒップ位置の左端 → 右端
- skirtLength（総丈）: ウエスト上端 → 裾最下端
- dressLength_bnp（着丈）: 襟付け根 → 裾最下端
- totalLength_pants（総丈）: ウエスト上端 → 裾最下端
- frontRise（股上）: ウエスト上端 → 股の交差点
- inseam（股下）: 股の交差点 → 裾
- thighWidth（ワタリ）: 股の高さの左右端
- hemWidth（裾幅）: 裾の左右端

# 重要: 全値は平置き片面の実寸（×2しない）

# 出力（JSONのみ）
{{
  "itemType": "...",
  "measurements": {{
    "項目名": {{
      "startCandidate": "候補名 or 番号",
      "endCandidate": "候補名 or 番号",
      "startPx": [x, y],
      "endPx": [x, y],
      "distancePx": 数値,
      "value": cm値,
      "confidence": "high/medium/low"
    }}
  }}
}}"""


def measure_with_selection(candidates, debug_img, scale):
    """AIに候補から選択させる"""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)

    # 候補テキスト
    lines = []
    for i, (name, x, y) in enumerate(candidates):
        lines.append(f"  #{i} {name}: ({x}, {y})")
    candidates_text = "\n".join(lines)

    h, w = debug_img.shape[:2]
    prompt = SELECT_PROMPT.format(
        scale=scale,
        candidates_text=candidates_text
    )

    # デバッグ画像をJPEGに変換
    _, buf = cv2.imencode('.jpg', debug_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    image_bytes = buf.tobytes()

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
        import re
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            result = json.loads(match.group())
        else:
            result = {"error": "JSONパース失敗", "raw": content}

    return result, usage


def parse_actual(s):
    actual = {}
    for pair in s.split(","):
        k, v = pair.strip().split("=")
        actual[k.strip()] = float(v.strip())
    return actual


def print_results(result, usage, scale, actual=None):
    print(f"\nカテゴリ: {result.get('itemType', '?')}")
    measurements = result.get("measurements", {})

    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'信頼度':>8}  {'始点候補':>20} {'終点候補':>20}")
        print("-" * 85)
        for key, item in measurements.items():
            if isinstance(item, dict):
                val = item.get("value")
                val_str = f"{val:.1f}" if val is not None else "null"
                conf = item.get("confidence", "?")
                sc = item.get("startCandidate", "?")
                ec = item.get("endCandidate", "?")
                print(f"{key:<20} {val_str:>8} {conf:>8}  {str(sc):>20} {str(ec):>20}")

    if usage:
        cost_in = usage.prompt_token_count * 1.25 / 1_000_000
        cost_out = usage.candidates_token_count * 10.00 / 1_000_000
        cost = cost_in + cost_out
        print(f"\nトークン: 入力={usage.prompt_token_count}, 出力={usage.candidates_token_count}")
        print(f"費用: ${cost:.4f} (約¥{cost*150:.1f})")

    if actual:
        print("\n" + "=" * 70)
        print("📏 実測値との比較")
        print("=" * 70)
        print(f"{'項目':<20} {'AI値':>8} {'実測値':>8} {'誤差':>8} {'判定':>6}")
        print("-" * 70)
        errors = []
        for key, av in actual.items():
            ai_item = measurements.get(key, {})
            ai_val = ai_item.get("value") if isinstance(ai_item, dict) else None
            if ai_val is None:
                print(f"{key:<20} {'null':>8} {av:>8.1f} {'---':>8} {'---':>6}")
                continue
            diff = ai_val - av
            ad = abs(diff)
            errors.append(ad)
            j = "✅" if ad <= 2 else ("⚠️" if ad <= 5 else "❌")
            s = "+" if diff > 0 else ""
            print(f"{key:<20} {ai_val:>8.1f} {av:>8.1f} {s}{diff:>7.1f} {j:>6}")

        if errors:
            avg = sum(errors) / len(errors)
            w2 = sum(1 for e in errors if e <= 2)
            w5 = sum(1 for e in errors if e <= 5)
            t = len(errors)
            print("-" * 70)
            print(f"平均誤差: {avg:.1f}cm | ±2cm: {w2}/{t} ({w2/t*100:.0f}%) | ±5cm: {w5}/{t} ({w5/t*100:.0f}%)")


def main():
    parser = argparse.ArgumentParser(description="CV輪郭+AI選択 テスト")
    parser.add_argument("input", help="画像ファイル")
    parser.add_argument("--actual", type=str, default=None)
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY が未設定"); sys.exit(1)

    img = cv2.imread(args.input)
    if img is None:
        print(f"ERROR: {args.input} が読めません"); sys.exit(1)

    h, w = img.shape[:2]
    if max(w, h) > MAX_IMAGE_SIZE:
        r = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w * r), int(h * r)))

    # Phase 1: A4検出 + ホモグラフィ
    print("=" * 70)
    print("Phase 1: A4検出 + ホモグラフィ補正")
    print("=" * 70)
    scale, a4_corners, warped = detect_a4(img)
    if scale is None:
        print("❌ A4検出失敗"); sys.exit(1)

    # Phase 2: 輪郭解析 + キーポイント候補
    print("\n" + "=" * 70)
    print("Phase 2: 衣類輪郭解析 + キーポイント候補抽出")
    print("=" * 70)
    candidates, contour = extract_garment_keypoints(warped, a4_corners)
    if candidates is None:
        print("❌ 輪郭検出失敗"); sys.exit(1)

    # Phase 3: AIに候補から選択させる
    print("\n" + "=" * 70)
    print("Phase 3: Gemini 2.5 Pro — 候補からキーポイント選択")
    print("=" * 70)

    # デバッグ画像をAIに渡す
    debug_img = cv2.imread("keypoints_debug.jpg")
    result, usage = measure_with_selection(candidates, debug_img, scale)

    actual = parse_actual(args.actual) if args.actual else None
    print_results(result, usage, scale, actual)

    # 保存
    stem = Path(args.input).stem
    with open(f"{stem}_cv_select_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n結果を {stem}_cv_select_result.json に保存")


if __name__ == "__main__":
    main()
