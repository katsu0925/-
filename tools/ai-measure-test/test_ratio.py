#!/usr/bin/env python3
"""
A4比率推定方式テスト

AIに座標を聞かず、「A4用紙の横幅（21cm）を基準に、各採寸値は何cmですか？」と
直接cm値を推定させる。A4用紙が画像内に見えているので、AIは目視で比較できる。

使い方:
  python test_ratio.py IMG_1722.jpg --actual "shoulderWidth=57,sleeveLength=50,bodyLength_cb=49,bodyWidth=51"
"""

import os, sys, json, argparse
import numpy as np
import cv2
from pathlib import Path
from google import genai
from google.genai import types

MODEL = "gemini-2.5-pro"
MAX_IMAGE_SIZE = 2048


PROMPT = """この画像には平置きされた衣類と、白いA4用紙（四隅にL字マーカー、中央に十字線）が写っています。

# A4用紙のサイズ
- 横幅: 21.0cm
- 縦幅: 29.7cm

A4用紙が画像内に見えています。これを物差しとして使い、各採寸値をcmで推定してください。

# 推定方法
1. まず、A4用紙の横幅（21cm）と縦幅（29.7cm）が画像上でどのくらいの大きさかを確認する
2. 次に、各採寸箇所の長さをA4と目視で比較する
3. 例: ある長さがA4横幅の約2.5倍に見えるなら → 21 × 2.5 = 52.5cm
4. 0.1倍単位で推定する（2.5倍、2.6倍のように）

# 衣類カテゴリを判定し、該当する項目のみ回答

## トップス (sweatshirt/tshirt/shirt/hoodie)
- bodyLength_cb（着丈）: 後ろ襟の中心付け根から裾の最下端までの垂直距離
- bodyWidth（身幅）:
  **測り方**: 身頃と袖の縫い合わせ部分（脇の縫い目）同士の水平距離
  **注意**: 身幅は衣類の一番広い部分ではない！袖の張り出しは含めない。
  脇の下に斜めの縫い目（袖と身頃の接合線）があり、その最も内側の点同士を測る。
  肩幅より必ず狭くなる。もし身幅が肩幅より広い値になったら、測る場所が間違っている。
- shoulderWidth（肩幅）:
  **測り方**: 左肩先から右肩先までの水平距離
  **注意**: 肩先=肩の縫い目の端（袖と肩が接合する最も外側の点）。袖口ではない！
  ドロップショルダーの場合は肩の縫い目が通常より下にあるため、腕の付け根あたりを確認。
- sleeveLength（袖丈）: 肩先の縫い目から袖口の端まで

## パンツ (pants)
- totalLength_pants（総丈）: ウエスト上端から裾最下端
- waistWidth（ウエスト）: ウエスト上端の左端から右端。ゴムウエストの場合は下記参照
- frontRise（股上）: ウエスト上端から股の交差点
- inseam（股下）: 股の交差点から裾（内股縫い目沿い）
- thighWidth（ワタリ）: 股の交差点の高さでの左右幅
- hemWidth（裾幅）: 裾の左端から右端

## スカート (skirt)
- waistWidth（ウエスト）: ウエストバンド（ベルト部分）の左端から右端の水平距離
- hipWidth_cfg（ヒップ）: ウエスト上端からA4横幅の約0.86倍（≒18cm）下の位置での左右幅
- skirtLength（総丈）:
  **測り方**: ウエストバンドの上端から裾の最下端までの**垂直距離**
  **注意**: 紐・リボン・タグは含めない。ウエストバンドの生地の上端が始点。
  プリーツスカートの場合、裾が波打っているが、最も下に来ている点を終点とする。
  斜めに広がっている長さではなく、あくまで**垂直方向の距離**を測る。

## ワンピース (dress)
- dressLength_bnp（着丈）: 後ろ襟の中心付け根から裾最下端の垂直距離
- bodyWidth（身幅）:
  **測り方**: 袖が身頃に縫い付けられている「脇の縫い目」の左右を結ぶ水平距離。
  **重要**: 身幅を測る高さは**袖の付け根（脇の下）の高さ**。
  ワンピースはウエストやヒップに向かって広がるが、身幅はウエストやヒップの幅ではない。
  袖の付け根より下の広がりは無視する。肩幅より必ず狭くなる。
  **目安**: 身幅は肩幅の70-85%程度が一般的。身幅が肩幅と同じか広い場合は測定位置が間違っている。
- shoulderWidth（肩幅）: 左肩先から右肩先
- sleeveLength（袖丈）: 肩先から袖口端
- waistWidth（ウエスト）: くびれ・ゴムシャーリング位置の左右幅

# 重要な注意
- 全て**平置き片面**の実寸（×2しない）
- 身幅 < 肩幅 が正常。逆になったら測定箇所が間違っている
- A4用紙の実物サイズと画像上の見え方を照らし合わせて慎重に推定する
- 小数点1桁まで

# 出力（JSONのみ）
各項目に approxStart と approxEnd を追加し、測っている場所を正規化座標（0-1000）で大まかに示すこと。
これは精度は問わない（可視化用）。cm値の算出はあくまでA4比率で行う。

{{
  "itemType": "...",
  "a4_reference": {{
    "横幅_cm": 21.0,
    "この画像でのA4用紙の見え方メモ": "..."
  }},
  "measurements": {{
    "項目名": {{
      "value": cm値,
      "ratioToA4Width": "A4横幅の約X倍",
      "confidence": "high/medium/low",
      "reasoning": "推定の根拠を簡潔に",
      "approxStart": [x_norm, y_norm],
      "approxEnd": [x_norm, y_norm]
    }}
  }}
}}"""


def measure_with_ratio(image_path):
    """AIにA4比率でcm値を直接推定させる"""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)

    # 画像読み込み+リサイズ
    img = cv2.imread(image_path)
    h, w = img.shape[:2]
    if max(w, h) > MAX_IMAGE_SIZE:
        r = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w*r), int(h*r)))

    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    image_bytes = buf.tobytes()

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(role="user", parts=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                types.Part.from_text(text=PROMPT)
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

    return result, usage


def parse_actual(s):
    return {k.strip(): float(v.strip()) for k, v in (p.split("=") for p in s.split(","))}


def print_results(result, usage, actual=None):
    print(f"\nカテゴリ: {result.get('itemType', '?')}")

    a4ref = result.get("a4_reference", {})
    if a4ref:
        print(f"A4メモ: {a4ref.get('この画像でのA4用紙の見え方メモ', '')}")

    measurements = result.get("measurements", {})
    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'信頼度':>8}  {'A4比率':>20}  理由")
        print("-" * 95)
        for key, item in measurements.items():
            if not isinstance(item, dict): continue
            val = item.get("value")
            val_str = f"{val:.1f}" if val is not None else "null"
            conf = item.get("confidence", "?")
            ratio = item.get("ratioToA4Width", "?")
            reason = item.get("reasoning", "")
            print(f"{key:<20} {val_str:>8} {conf:>8}  {str(ratio):>20}  {reason}")

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


COLORS = [
    (0, 0, 255),    # 赤
    (0, 255, 0),    # 緑
    (255, 0, 0),    # 青
    (0, 255, 255),  # 黄
    (255, 0, 255),  # マゼンタ
    (255, 255, 0),  # シアン
    (0, 165, 255),  # オレンジ
    (128, 0, 128),  # 紫
]


def generate_debug_image(image_path, result):
    """採寸線を画像に描画してデバッグ画像を生成"""
    img = cv2.imread(image_path)
    if img is None:
        return
    h, w = img.shape[:2]
    if max(w, h) > MAX_IMAGE_SIZE:
        r = MAX_IMAGE_SIZE / max(w, h)
        img = cv2.resize(img, (int(w * r), int(h * r)))
        h, w = img.shape[:2]

    measurements = result.get("measurements", {})
    for i, (key, item) in enumerate(measurements.items()):
        if not isinstance(item, dict):
            continue
        start = item.get("approxStart", [])
        end = item.get("approxEnd", [])
        val = item.get("value", "?")

        if len(start) != 2 or len(end) != 2:
            continue

        # 正規化座標(0-1000) → ピクセル座標
        sx = int(start[0] / 1000 * w)
        sy = int(start[1] / 1000 * h)
        ex = int(end[0] / 1000 * w)
        ey = int(end[1] / 1000 * h)

        color = COLORS[i % len(COLORS)]

        # 線を描画
        cv2.line(img, (sx, sy), (ex, ey), color, 3)
        # 始点・終点の丸
        cv2.circle(img, (sx, sy), 10, color, -1)
        cv2.circle(img, (ex, ey), 10, color, -1)
        # ラベル
        mid_x = (sx + ex) // 2
        mid_y = (sy + ey) // 2
        label = f"{key}: {val}cm"
        # 背景付きテキスト
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(img, (mid_x - 2, mid_y - th - 6), (mid_x + tw + 4, mid_y + 4), (0, 0, 0), -1)
        cv2.putText(img, label, (mid_x, mid_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    stem = Path(image_path).stem
    debug_path = f"{stem}_measure_debug.jpg"
    cv2.imwrite(debug_path, img)
    print(f"\n📸 デバッグ画像 → {debug_path}")
    return debug_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--actual", type=str, default=None)
    parser.add_argument("--serve", action="store_true", help="デバッグ画像をローカルサーバーで配信")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY 未設定"); sys.exit(1)

    print("=" * 70)
    print("A4比率推定方式 — Gemini 2.5 Pro")
    print("=" * 70)

    result, usage = measure_with_ratio(args.input)
    actual = parse_actual(args.actual) if args.actual else None
    print_results(result, usage, actual)

    # デバッグ画像生成
    debug_path = generate_debug_image(args.input, result)

    # 結果保存
    stem = Path(args.input).stem
    with open(f"{stem}_ratio_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # ローカルサーバーで配信（--serve指定時）
    if args.serve and debug_path:
        import subprocess
        print(f"\n🌐 http://192.168.0.13:8770/{debug_path}")
        print("   スマホで確認できます（Ctrl+Cで停止）")


if __name__ == "__main__":
    main()
