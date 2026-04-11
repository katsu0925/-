#!/usr/bin/env python3
"""
Gemini バウンディングボックス + CV スケール テスト

Gemini 2.5 Proのネイティブ座標機能（正規化座標0-1000）を使い、
各採寸ポイントのバウンディングボックスを取得 → 中心座標をキーポイントとして使用

方式A: 衣類全体のセグメンテーション → CV輪郭解析
方式B: 各採寸ポイントのバウンディングボックス → 中心点

使い方:
  python test_gemini_bbox.py IMG_1722.jpg --actual "shoulderWidth=57,sleeveLength=50,bodyLength_cb=49,bodyWidth=51"
"""

import os, sys, json, base64, argparse, math
import numpy as np
import cv2
from pathlib import Path
from google import genai
from google.genai import types

MODEL = "gemini-2.5-pro"
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MAX_IMAGE_SIZE = 2048


def detect_a4(img):
    """A4検出 → スケール算出"""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    kernel = np.ones((5, 5), np.uint8)
    best_rect, best_score = None, 0

    for tv in [180, 160, 140, 200]:
        _, th = cv2.threshold(blurred, tv, 255, cv2.THRESH_BINARY)
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel, iterations=3)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < (w * h * 0.005): continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                rect = cv2.minAreaRect(c)
                bw, bh = rect[1]
                if bw == 0 or bh == 0: continue
                aspect = max(bw, bh) / min(bw, bh)
                if 1.1 < aspect < 1.8:
                    score = area * (1.0 - abs(aspect - 1.414) / 1.414)
                    if score > best_score:
                        best_score = score
                        best_rect = approx
        if best_rect is not None: break

    if best_rect is None: return None, img

    pts = best_rect.reshape(4, 2).astype("float32")
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1); rect[0] = pts[np.argmin(s)]; rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1); rect[1] = pts[np.argmin(d)]; rect[3] = pts[np.argmax(d)]

    tl, tr, br, bl = rect
    ww = (np.linalg.norm(tr-tl) + np.linalg.norm(br-bl)) / 2
    hh = (np.linalg.norm(bl-tl) + np.linalg.norm(br-tr)) / 2
    scale = A4_WIDTH_CM / ww
    print(f"📐 A4: 横={ww:.0f}px 縦={hh:.0f}px 比={hh/ww:.3f} scale={scale:.6f}")

    # ホモグラフィ補正
    cx = (tl[0]+tr[0]+br[0]+bl[0])/4; cy = (tl[1]+tr[1]+br[1]+bl[1])/4
    a4h = ww * (A4_HEIGHT_CM / A4_WIDTH_CM)
    dst = np.array([[cx-ww/2,cy-a4h/2],[cx+ww/2,cy-a4h/2],[cx+ww/2,cy+a4h/2],[cx-ww/2,cy+a4h/2]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, M, (w, h))
    return float(scale), warped


# ─── Gemini: 各採寸ポイントの位置を聞く（座標特定ではなく位置記述） ───

PROMPT = """この画像には平置きされた衣類とA4用紙が写っています。

# スケール情報（OpenCVで算出済み）
scaleCmPerPx = {scale}
画像サイズ = {w} x {h} px

# 重要な指示
あなたの仕事は、各採寸項目の始点と終点を画像上で特定することです。
座標は画像の**正規化座標**（0〜1000の範囲、左上が原点）で指定してください。
- x座標: 0=画像左端、1000=画像右端
- y座標: 0=画像上端、1000=画像下端

実ピクセル座標への変換は私が行います。

# 手順
1. 衣類カテゴリを判定
2. 各項目の始点/終点を正規化座標で出力
3. 全値は平置き片面の実寸（×2しない）

# カテゴリ別の採寸項目
## トップス (sweatshirt/tshirt/shirt/hoodie)
- bodyLength_cb: 後ろ襟中心の付け根 → 裾の最下端
- bodyWidth: 左脇下の縫い目 → 右脇下の縫い目
- shoulderWidth: 左肩の先端（最も外側） → 右肩の先端
- sleeveLength: 肩先の縫い目 → 袖口の先端

## パンツ (pants)
- totalLength_pants: ウエスト上端 → 裾最下端
- waistWidth: ウエスト上端左端 → 右端
- frontRise: ウエスト上端 → 股の交差点
- inseam: 股の交差点 → 裾（内股沿い）
- thighWidth: 股の交差点の高さの左端 → 右端
- hemWidth: 裾の左端 → 右端

## スカート (skirt)
- waistWidth: ウエスト上端左端 → 右端
- hipWidth_cfg: ウエスト上端から下に18cm位置の左端 → 右端
- skirtLength: ウエスト上端 → 裾最下端

## ワンピース (dress)
- dressLength_bnp: 後ろ襟中心の付け根 → 裾最下端
- bodyWidth: 左脇下 → 右脇下
- shoulderWidth: 左肩先 → 右肩先
- sleeveLength: 肩先 → 袖口端
- waistWidth: くびれ位置の左端 → 右端

# 出力（JSONのみ、説明文禁止）
{{
  "itemType": "...",
  "measurements": {{
    "項目名": {{
      "startNorm": [x_norm, y_norm],
      "endNorm": [x_norm, y_norm],
      "confidence": "high/medium/low"
    }}
  }}
}}"""


def measure_with_gemini_norm(warped_img, scale):
    """Geminiに正規化座標で採寸ポイントを聞く"""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)

    _, buf = cv2.imencode('.jpg', warped_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    image_bytes = buf.tobytes()
    h, w = warped_img.shape[:2]

    prompt = PROMPT.format(scale=scale, w=w, h=h)

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(role="user", parts=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                types.Part.from_text(text=prompt)
            ])
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
        result = json.loads(match.group()) if match else {"error": content}

    # 正規化座標 → ピクセル座標に変換 + cm計算
    measurements = result.get("measurements", {})
    for key, item in measurements.items():
        if not isinstance(item, dict): continue
        sn = item.get("startNorm", [])
        en = item.get("endNorm", [])
        if len(sn) == 2 and len(en) == 2:
            sx, sy = sn[0] / 1000 * w, sn[1] / 1000 * h
            ex, ey = en[0] / 1000 * w, en[1] / 1000 * h
            dist = math.sqrt((ex - sx)**2 + (ey - sy)**2)
            cm = round(dist * scale, 1)
            item["startPx"] = [round(sx), round(sy)]
            item["endPx"] = [round(ex), round(ey)]
            item["distancePx"] = round(dist, 1)
            item["value"] = cm

    return result, usage


def parse_actual(s):
    return {k.strip(): float(v.strip()) for k, v in (p.split("=") for p in s.split(","))}


def print_results(result, usage, scale, actual=None):
    print(f"\nカテゴリ: {result.get('itemType', '?')}")
    measurements = result.get("measurements", {})

    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'信頼度':>8}  {'始点norm':>12} {'終点norm':>12} {'始点px':>15} {'終点px':>15}")
        print("-" * 100)
        for key, item in measurements.items():
            if not isinstance(item, dict): continue
            val = item.get("value")
            val_str = f"{val:.1f}" if val is not None else "null"
            conf = item.get("confidence", "?")
            sn = item.get("startNorm", [])
            en = item.get("endNorm", [])
            sp = item.get("startPx", [])
            ep = item.get("endPx", [])
            print(f"{key:<20} {val_str:>8} {conf:>8}  {str(sn):>12} {str(en):>12} {str(sp):>15} {str(ep):>15}")

    if usage:
        cost = usage.prompt_token_count * 1.25 / 1e6 + usage.candidates_token_count * 10.0 / 1e6
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
            ai = measurements.get(key, {})
            ai_val = ai.get("value") if isinstance(ai, dict) else None
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
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--actual", type=str, default=None)
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY 未設定"); sys.exit(1)

    img = cv2.imread(args.input)
    if img is None:
        print(f"ERROR: {args.input}"); sys.exit(1)
    h, w = img.shape[:2]
    if max(w, h) > MAX_IMAGE_SIZE:
        r = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w*r), int(h*r)))

    print("=" * 70)
    print("Phase 1: A4検出 + ホモグラフィ補正")
    print("=" * 70)
    scale, warped = detect_a4(img)
    if scale is None:
        print("❌ A4検出失敗"); sys.exit(1)

    print("\n" + "=" * 70)
    print("Phase 2: Gemini 2.5 Pro — 正規化座標でキーポイント特定")
    print("=" * 70)
    result, usage = measure_with_gemini_norm(warped, scale)

    actual = parse_actual(args.actual) if args.actual else None
    print_results(result, usage, scale, actual)

    # デバッグ画像: 採寸線を描画
    debug = warped.copy()
    for key, item in result.get("measurements", {}).items():
        if not isinstance(item, dict): continue
        sp = item.get("startPx", [])
        ep = item.get("endPx", [])
        if len(sp) == 2 and len(ep) == 2:
            cv2.circle(debug, (sp[0], sp[1]), 8, (0, 0, 255), -1)
            cv2.circle(debug, (ep[0], ep[1]), 8, (0, 0, 255), -1)
            cv2.line(debug, (sp[0], sp[1]), (ep[0], ep[1]), (0, 255, 0), 2)
            mid_x = (sp[0] + ep[0]) // 2
            mid_y = (sp[1] + ep[1]) // 2
            val = item.get("value", "")
            cv2.putText(debug, f"{key}:{val}cm", (mid_x+5, mid_y-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    cv2.imwrite("measure_debug.jpg", debug)
    print(f"\n採寸線デバッグ画像 → measure_debug.jpg")

    stem = Path(args.input).stem
    with open(f"{stem}_bbox_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
