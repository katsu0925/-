#!/usr/bin/env python3
"""
CV+AI 2段階パイプライン テスト

ステップ1: OpenCVでA4用紙検出 → スケール算出
ステップ2: GPT-4oにスケール渡してキーポイント特定のみ

使い方:
  python test_cv_ai.py IMG_1722.jpg --actual "shoulderWidth=57,sleeveLength=50,bodyLength_cb=49,bodyWidth=51"
"""

import os
import sys
import json
import base64
import argparse
import numpy as np
import cv2
from pathlib import Path
from openai import OpenAI

# ─── 設定 ───
MODEL = "gpt-4o"
MAX_TOKENS = 4096
TEMPERATURE = 0.0
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MAX_IMAGE_SIZE = 2048

# ─── ステップ1: OpenCVでA4用紙検出 ───

def detect_a4_paper(image_path):
    """A4用紙の4角を検出し、scaleCmPerPxを算出"""
    img = cv2.imread(image_path)
    if img is None:
        print(f"ERROR: 画像を読み込めません: {image_path}")
        return None

    h, w = img.shape[:2]
    print(f"元画像サイズ: {w}x{h}")

    # リサイズ（処理用）
    scale_factor = 1.0
    if max(w, h) > MAX_IMAGE_SIZE:
        scale_factor = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w * scale_factor), int(h * scale_factor)))
        h, w = img.shape[:2]
        print(f"処理用リサイズ: {w}x{h} (scale_factor={scale_factor:.4f})")

    # グレースケール変換
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # A4用紙は白いので、明るい領域を抽出
    # 適応的二値化
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # 方法1: 白い矩形を検出（閾値法）
    _, thresh = cv2.threshold(blurred, 180, 255, cv2.THRESH_BINARY)

    # ノイズ除去
    kernel = np.ones((5, 5), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

    # 輪郭検出
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_rect = None
    best_score = 0

    for contour in contours:
        area = cv2.contourArea(contour)
        # A4用紙は画像の一定割合を占めるはず（小さすぎるものは除外）
        if area < (w * h * 0.01):  # 画像面積の1%以下は除外
            continue

        # 多角形近似
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

        # 4角形のみ対象
        if len(approx) == 4:
            # 凸性チェック
            if not cv2.isContourConvex(approx):
                continue

            # 縦横比チェック（A4 = 1.414）
            rect = cv2.minAreaRect(contour)
            box_w, box_h = rect[1]
            if box_w == 0 or box_h == 0:
                continue
            aspect = max(box_w, box_h) / min(box_w, box_h)

            # A4の縦横比 1.414 ± 0.3 の範囲
            if 1.1 < aspect < 1.7:
                score = area * (1.0 - abs(aspect - 1.414) / 1.414)
                if score > best_score:
                    best_score = score
                    best_rect = approx

    if best_rect is None:
        print("⚠️ 方法1（閾値法）で検出失敗。方法2（適応的閾値）を試行...")
        # 方法2: 適応的閾値 + 広めの二値化
        for thresh_val in [160, 140, 200]:
            _, thresh2 = cv2.threshold(blurred, thresh_val, 255, cv2.THRESH_BINARY)
            thresh2 = cv2.morphologyEx(thresh2, cv2.MORPH_CLOSE, kernel, iterations=3)
            thresh2 = cv2.morphologyEx(thresh2, cv2.MORPH_OPEN, kernel, iterations=1)
            contours2, _ = cv2.findContours(thresh2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours2:
                area = cv2.contourArea(contour)
                if area < (w * h * 0.005):
                    continue
                peri = cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
                if len(approx) == 4 and cv2.isContourConvex(approx):
                    rect = cv2.minAreaRect(contour)
                    box_w, box_h = rect[1]
                    if box_w == 0 or box_h == 0:
                        continue
                    aspect = max(box_w, box_h) / min(box_w, box_h)
                    if 1.1 < aspect < 1.8:
                        score = area * (1.0 - abs(aspect - 1.414) / 1.414)
                        if score > best_score:
                            best_score = score
                            best_rect = approx
            if best_rect is not None:
                print(f"  方法2で検出成功（閾値={thresh_val}）")
                break

    if best_rect is None:
        print("⚠️ 方法2も失敗。方法3（Canny+輪郭）を試行...")
        return detect_a4_canny(img, gray, w, h, scale_factor)

    # 4点を整列（左上、右上、右下、左下）
    corners = order_corners(best_rect.reshape(4, 2))

    return process_corners(corners, w, h, scale_factor, img)


def detect_a4_canny(img, gray, w, h, scale_factor):
    """Cannyエッジ検出による代替検出"""
    edges = cv2.Canny(gray, 50, 150)
    kernel = np.ones((3, 3), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_rect = None
    best_score = 0

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < (w * h * 0.01):
            continue

        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.03 * peri, True)

        if len(approx) == 4 and cv2.isContourConvex(approx):
            rect = cv2.minAreaRect(contour)
            box_w, box_h = rect[1]
            if box_w == 0 or box_h == 0:
                continue
            aspect = max(box_w, box_h) / min(box_w, box_h)
            if 1.1 < aspect < 1.7:
                score = area
                if score > best_score:
                    best_score = score
                    best_rect = approx

    if best_rect is None:
        print("❌ A4用紙の検出に失敗しました")
        return None

    corners = order_corners(best_rect.reshape(4, 2))
    return process_corners(corners, w, h, scale_factor, img)


def order_corners(pts):
    """4点を左上、右上、右下、左下の順に並べ替え"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # 左上
    rect[2] = pts[np.argmax(s)]   # 右下
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # 右上
    rect[3] = pts[np.argmax(d)]   # 左下
    return rect


def process_corners(corners, w, h, scale_factor, img):
    """検出した4角からスケールを算出"""
    tl, tr, br, bl = corners

    # 幅（上辺と下辺の平均）
    width_top = np.linalg.norm(tr - tl)
    width_bottom = np.linalg.norm(br - bl)
    avg_width_px = (width_top + width_bottom) / 2

    # 高さ（左辺と右辺の平均）
    height_left = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)
    avg_height_px = (height_left + height_right) / 2

    # 縦横比チェック
    aspect_ratio = avg_height_px / avg_width_px

    # スケール算出（A4横幅=21cm基準）
    scale_cm_per_px = A4_WIDTH_CM / avg_width_px

    print(f"\n📐 A4用紙検出結果:")
    print(f"  左上: ({tl[0]:.0f}, {tl[1]:.0f})")
    print(f"  右上: ({tr[0]:.0f}, {tr[1]:.0f})")
    print(f"  右下: ({br[0]:.0f}, {br[1]:.0f})")
    print(f"  左下: ({bl[0]:.0f}, {bl[1]:.0f})")
    print(f"  横幅: {avg_width_px:.1f}px (上={width_top:.1f}, 下={width_bottom:.1f})")
    print(f"  縦幅: {avg_height_px:.1f}px (左={height_left:.1f}, 右={height_right:.1f})")
    print(f"  縦横比: {aspect_ratio:.3f} (理論値=1.414)")
    print(f"  スケール: {scale_cm_per_px:.6f} cm/px")

    if abs(aspect_ratio - 1.414) > 0.15:
        print(f"  ⚠️ 縦横比が理論値から乖離（遠近歪みの可能性）")

    # デバッグ画像保存
    debug_img = img.copy()
    pts = corners.astype(int)
    cv2.polylines(debug_img, [pts], True, (0, 255, 0), 2)
    for i, (label, pt) in enumerate(zip(['TL', 'TR', 'BR', 'BL'], pts)):
        cv2.circle(debug_img, tuple(pt), 8, (0, 0, 255), -1)
        cv2.putText(debug_img, label, (pt[0]+10, pt[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    debug_path = "a4_detect_debug.jpg"
    cv2.imwrite(debug_path, debug_img)
    print(f"  デバッグ画像: {debug_path}")

    return {
        "corners": {
            "topLeft": [float(tl[0]), float(tl[1])],
            "topRight": [float(tr[0]), float(tr[1])],
            "bottomRight": [float(br[0]), float(br[1])],
            "bottomLeft": [float(bl[0]), float(bl[1])]
        },
        "a4WidthPx": float(avg_width_px),
        "a4HeightPx": float(avg_height_px),
        "aspectRatio": float(aspect_ratio),
        "scaleCmPerPx": float(scale_cm_per_px),
        "imageSize": [w, h]
    }


# ─── ステップ2: AI にスケール渡してキーポイント特定 ───

SYSTEM_PROMPT_V2 = """あなたは「古着の平置き採寸」専用の画像解析エンジンです。
スケール（cm/px）は事前に算出済みで提供されます。あなたの仕事は衣類の各測定項目の始点/終点のピクセル座標を特定することです。

# あなたの担当
1. 衣類カテゴリ（itemType）を判定
2. 各測定項目について、定義どおりの始点/終点の **画像上のピクセル座標** を特定
3. 提供された scaleCmPerPx を使って cm に換算

# 絶対ルール
- スケール算出は自分でやらない。提供された scaleCmPerPx をそのまま使う
- 推定禁止：始点/終点が視認できない項目は value=null
- 出力はJSONのみ
- 全項目に startPx, endPx, distancePx を必ず含める
- 採寸値はすべて平置き片面の実寸（×2しない）

# 基準点用語
- BNP: 後ろ襟ぐり中心の襟付け根
- SNP: 肩線上の首付け根位置
- ArmpitSeamPoint: 袖と身頃の縫い合わせ点（脇下）
- ShoulderPoint: 肩縫い目の端（肩先）
- CrotchPoint: 内股縫い目が交差する点

# カテゴリと測定項目
## トップス共通 (tshirt, shirt, sweatshirt, hoodie, outerwear_coat)
- bodyLength_cb（着丈）: BNP → 裾最下端（背中心線上）、vertical
- bodyWidth（身幅）: 左脇下 → 右脇下、horizontal
- shoulderWidth（肩幅）: 左肩先 → 右肩先、horizontal
- sleeveLength（袖丈）: 肩先 → 袖口端
- yukiLength（裄丈）: BNP → 肩 → 袖口端（ラグラン用）

## パンツ (pants)
- totalLength_pants（総丈）: ウエスト上端 → 裾最下端、vertical
- waistWidth（ウエスト）: 上端左 → 上端右、horizontal
- hipWidth_cfg（ヒップ）: ファスナー止まり高さの左右端
- frontRise（股上）: ウエスト上端 → 股の交差点、vertical
- inseam（股下）: 股の交差点 → 裾（内股沿い）
- thighWidth（ワタリ）: 股の交差点高さの左右端
- hemWidth（裾幅）: 裾の左右端

## スカート (skirt)
- waistWidth（ウエスト）: 上端左 → 上端右、horizontal
- hipWidth_cfg（ヒップ）: 上端から18cm下の左右端
- skirtLength（総丈）: 上端 → 裾最下端、vertical

## ワンピース (dress)
- dressLength_bnp（着丈）: BNP → 裾最下端、vertical
- bodyWidth（身幅）: 左脇下 → 右脇下、horizontal
- shoulderWidth（肩幅）: 左肩先 → 右肩先、horizontal
- sleeveLength（袖丈）: 肩先 → 袖口端
- waistWidth（ウエスト）: 切替がある場合のみ

# JSON出力構造
{
  "itemType": "...",
  "measurements": {
    "項目名": {
      "startPx": [x, y],
      "endPx": [x, y],
      "distancePx": 数値,
      "value": cm値,
      "confidence": "high/medium/low"
    }
  }
}"""


def resize_image_for_api(image_path):
    """API送信用に画像をリサイズ"""
    from PIL import Image
    import io

    img = Image.open(image_path)
    w, h = img.size

    if max(w, h) > MAX_IMAGE_SIZE:
        ratio = MAX_IMAGE_SIZE / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        w, h = img.size

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=90)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return b64, w, h


def measure_with_cv_scale(client, image_path, cv_result):
    """CVで算出したスケールを使ってAIにキーポイント特定させる"""
    base64_image, img_w, img_h = resize_image_for_api(image_path)

    user_msg = json.dumps({
        "task": "identify_garment_keypoints",
        "imageSize": [img_w, img_h],
        "scaleCmPerPx": cv_result["scaleCmPerPx"],
        "scaleNote": "このスケールはOpenCVでA4用紙から算出済み。この値をそのまま使ってください。自分でスケールを算出しないでください。",
        "a4PaperInfo": {
            "corners": cv_result["corners"],
            "widthPx": cv_result["a4WidthPx"],
            "heightPx": cv_result["a4HeightPx"]
        }
    }, ensure_ascii=False, indent=2)

    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_V2},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_msg},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content
    usage = response.usage

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        result = {"error": "JSONパース失敗", "raw": content}

    return result, usage


def parse_actual(actual_str):
    """実測値文字列をパース"""
    actual = {}
    for pair in actual_str.split(","):
        key, val = pair.strip().split("=")
        actual[key.strip()] = float(val.strip())
    return actual


def compare_results(ai_result, actual, cv_scale):
    """AI結果と実測値を比較（CVスケールで再計算も表示）"""
    measurements = ai_result.get("measurements", {})
    print("\n" + "=" * 70)
    print("📏 実測値との比較")
    print("=" * 70)
    print(f"{'項目':<20} {'AI値':>8} {'実測値':>8} {'誤差':>8} {'判定':>6} {'distPx':>8}")
    print("-" * 70)

    errors = []
    for key, actual_val in actual.items():
        ai_item = measurements.get(key)
        if isinstance(ai_item, dict):
            ai_val = ai_item.get("value")
            dist_px = ai_item.get("distancePx", 0)
            start = ai_item.get("startPx", [])
            end = ai_item.get("endPx", [])
            # CVスケールで再計算
            if dist_px and cv_scale:
                recalc = round(dist_px * cv_scale, 1)
            else:
                recalc = None
        else:
            ai_val = ai_item if isinstance(ai_item, (int, float)) else None
            dist_px = 0
            recalc = None

        if ai_val is None:
            print(f"{key:<20} {'null':>8} {actual_val:>8.1f} {'---':>8} {'---':>6}")
            continue

        diff = ai_val - actual_val
        abs_diff = abs(diff)
        errors.append(abs_diff)
        judge = "OK" if abs_diff <= 2.0 else "NG"
        sign = "+" if diff > 0 else ""
        recalc_str = f" (CV再計算={recalc})" if recalc and recalc != ai_val else ""
        print(f"{key:<20} {ai_val:>8.1f} {actual_val:>8.1f} {sign}{diff:>7.1f} {judge:>6} {dist_px:>8.0f}{recalc_str}")

    if errors:
        avg = sum(errors) / len(errors)
        within_1 = sum(1 for e in errors if e <= 1.0)
        within_2 = sum(1 for e in errors if e <= 2.0)
        total = len(errors)
        print("-" * 70)
        print(f"平均誤差: {avg:.1f}cm | ±1cm: {within_1}/{total} ({within_1/total*100:.0f}%) | ±2cm: {within_2}/{total} ({within_2/total*100:.0f}%)")
        print(f"判定: {'PASS' if within_2 == total else 'FAIL'}")


def print_result(result, usage, cv_result):
    """結果を表示"""
    print(f"\nカテゴリ: {result.get('itemType', '不明')}")
    print(f"CVスケール: {cv_result['scaleCmPerPx']:.6f} cm/px")

    measurements = result.get("measurements", {})
    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'信頼度':>8}  {'始点':>15} {'終点':>15} {'距離px':>8}")
        print("-" * 80)
        for key, item in measurements.items():
            if isinstance(item, dict):
                val = item.get("value")
                val_str = f"{val:.1f}" if val is not None else "null"
                conf = item.get("confidence", "?")
                start = item.get("startPx", [])
                end = item.get("endPx", [])
                dist = item.get("distancePx", "")
                print(f"{key:<20} {val_str:>8} {conf:>8}  {str(start):>15} {str(end):>15} {dist:>8}")

    if usage:
        cost_in = usage.prompt_tokens * 2.50 / 1_000_000
        cost_out = usage.completion_tokens * 10.00 / 1_000_000
        cost_total = cost_in + cost_out
        print(f"\nトークン: 入力={usage.prompt_tokens}, 出力={usage.completion_tokens}")
        print(f"費用: ${cost_total:.4f} (約¥{cost_total * 150:.1f})")


def main():
    parser = argparse.ArgumentParser(description="CV+AI 2段階パイプライン テスト")
    parser.add_argument("input", help="画像ファイル")
    parser.add_argument("--actual", type=str, default=None, help="実測値")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("ERROR: OPENAI_API_KEY が未設定です")
        sys.exit(1)

    image_path = args.input
    if not Path(image_path).exists():
        print(f"ERROR: {image_path} が見つかりません")
        sys.exit(1)

    # ステップ1: CVでA4検出
    print("=" * 70)
    print("ステップ1: OpenCV A4検出")
    print("=" * 70)
    cv_result = detect_a4_paper(image_path)

    if cv_result is None:
        print("\n❌ A4検出失敗。手動キャリブレーションが必要です。")
        sys.exit(1)

    # ステップ2: AIでキーポイント特定
    print("\n" + "=" * 70)
    print("ステップ2: AI キーポイント特定")
    print("=" * 70)

    client = OpenAI(api_key=api_key)
    result, usage = measure_with_cv_scale(client, image_path, cv_result)
    print_result(result, usage, cv_result)

    # 比較
    if args.actual:
        actual = parse_actual(args.actual)
        compare_results(result, actual, cv_result["scaleCmPerPx"])

    # 結果保存
    stem = Path(image_path).stem
    output = {
        "cv_scale": cv_result,
        "ai_result": result
    }
    output_path = f"{stem}_cv_ai_result.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n結果を {output_path} に保存しました")


if __name__ == "__main__":
    main()
