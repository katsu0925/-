#!/usr/bin/env python3
"""
AI採寸 精度検証スクリプト

衣類+定規の画像をgpt-4oに送り、自動採寸結果をJSONで取得する。
実測値と比較して精度を検証する。

使い方:
  # 1枚の画像をテスト
  python test_measure.py photo.jpg

  # 定規の長さを指定（デフォルト15cm）
  python test_measure.py photo.jpg --ruler 30

  # 実測値と比較（着丈70cm, 身幅52cm, 肩幅45cm）
  python test_measure.py photo.jpg --actual "bodyLength_cb=70,bodyWidth=52,shoulderWidth=45"

  # フォルダ内の全画像を一括テスト
  python test_measure.py ./photos/

  # 同じ画像を3回テストして再現性を確認
  python test_measure.py photo.jpg --repeat 3
"""

import os
import sys
import json
import base64
import argparse
import glob
from pathlib import Path
from openai import OpenAI

# ─── 設定 ───────────────────────────────────────────────
MODEL = "gpt-4o"
MAX_TOKENS = 4096
TEMPERATURE = 0.0  # 再現性のため0に固定
DEFAULT_RULER_CM = 18.0

# ─── 採寸プロンプト（PDF仕様書準拠） ─────────────────────
SYSTEM_PROMPT = """あなたは「古着の平置き採寸」専用の画像解析エンジンです。
入力として与えられる衣類画像（平置き）から、定義どおりの採寸値をcmで算出し、JSONのみを出力してください。
採寸基準はタカシマヤファッションスクエア準拠です。

# 絶対ルール
- 推定禁止：定義の始点/終点が画像上で視認できない場合、その項目は value=null にする（代用計測は禁止）
- 出力はJSONのみ（説明文・前置き・Markdown禁止）
- スケール算出→基準点特定→px距離→cm換算→最後に小数点1桁丸め、の順序を守る
- 定規は「物理的外形端↔外形端」として扱う（透明定規の目盛り印字は参照しない）
- 画像の遠近・レンズ歪みにより画面全域でスケールが一定とは限らない。可能なら平面補正（ホモグラフィ）または複数参照で誤差を評価する
- 衣類カテゴリに該当する項目のみ measurements に含める（ただし測れない項目は削除せず value=null で残す）

# 基準点用語
- BNP(バックネックポイント): 後ろ襟ぐり中心の襟付け根（襟は含めない）
- SNP(サイドネックポイント): 肩線上の首付け根位置
- ArmpitSeamPoint: 袖と身頃の縫い合わせ点（脇下）
- ShoulderPoint: 肩縫い目の端（肩先）
- CrotchPoint: 内股縫い目が交差する点

# 測定項目辞書（measurementDictionary）

## トップス共通項目（tshirt, shirt, sweatshirt, hoodie, outerwear_coat）
- bodyLength_cb（着丈）:
  start: BNP（バックネックポイント）
  end: 裾最下端（背中心線上）
  geometry: vertical_straight
  exclude: 襟/フード/リブ上端は含めない
- bodyWidth（身幅）:
  start: 左ArmpitSeamPoint（脇下の縫い合わせ点）
  end: 右ArmpitSeamPoint（脇下の縫い合わせ点）
  geometry: horizontal_straight
  note: 両袖の付け根下の直線距離
  forbid: 袖の張り出しを含めること、裾幅で代用すること
- shoulderWidth（肩幅）:
  start: 左ShoulderPoint（肩先）
  end: 右ShoulderPoint（肩先）
  geometry: horizontal_straight
  note: ラグラン等で肩縫い目が無い場合は null
- sleeveLength（袖丈）:
  start: ShoulderPoint（肩先、肩と袖の縫い目上端）
  end: 袖口端
  geometry: along_outer_seam_or_straight
  note: ラグラン袖の場合は null
- yukiLength（裄丈）:
  start: BNP
  end: 肩を通って袖口端
  geometry: polyline(BNP->肩->袖口)
  note: ラグラン袖で主に使用。セットイン袖でも参考値として計測可

## ラグラン袖の特別ルール
ラグラン袖（肩の縫い目がないデザイン）の場合:
- shoulderWidth = null（肩の縫い目がないため測定不可）
- sleeveLength = null（肩先が定義できないため測定不可）
- yukiLength を必ず測定する（BNPから肩を通って袖口まで）
- bodyLength_cb, bodyWidth は通常通り測定

## パンツ（pants）
- totalLength_pants（総丈）:
  start: ウエスト一番上（ベルト上端）
  end: 裾最下端
  geometry: vertical_straight
  note: BNPではなくウエスト上端から測る
- waistWidth（ウエスト）:
  start: ウエスト上端左端
  end: ウエスト上端右端
  geometry: horizontal_straight
  note: 平置き片面の幅をそのまま出力（×2しない）
- hipWidth_cfg（ヒップ）:
  基準線: ファスナー閉じ、止まり位置の高さ
  start/end: 基準線上の左右端
  geometry: horizontal_straight
  note: ファスナー止まり位置で自動判定
- frontRise（股上）:
  start: ウエストベルト脇の上端
  end: CrotchPoint（内股合わせ部分）
  geometry: vertical_straight
- inseam（股下）:
  start: CrotchPoint（内股合わせ）
  end: 内股の縫い目に沿って裾
  geometry: along_inseam
- thighWidth（わたり幅）:
  start: CrotchPoint高さの左端（内股合わせ部分の横幅）
  end: 同右端
  geometry: horizontal_straight
- hemWidth（裾幅）:
  start: 裾左端
  end: 裾右端
  geometry: horizontal_straight

## スカート（skirt）
- waistWidth（ウエスト）:
  start: ウエスト上端左端
  end: ウエスト上端右端
  geometry: horizontal_straight
- hipWidth_cfg（ヒップ）:
  基準線: スカート上端から measurementStandard.hipOffsetCm (18cm) 下の位置
  start/end: 基準線上の左右端
  geometry: horizontal_straight
- skirtLength（総丈）:
  start: スカート上端
  end: 裾最下端
  geometry: vertical_straight
  note: スカート上端から裾までの最長の直線距離

## ワンピース（dress）
- dressLength_bnp（着丈）:
  start: BNP（襟/リブ/フードは含めない）
  end: 裾最下端
  geometry: vertical_straight
- bodyWidth（身幅）:
  start: 左ArmpitSeamPoint
  end: 右ArmpitSeamPoint
  geometry: horizontal_straight
  note: 脇下の直線距離
- shoulderWidth（肩幅）:
  start: 左ShoulderPoint
  end: 右ShoulderPoint
  geometry: horizontal_straight
- sleeveLength（袖丈）:
  start: ShoulderPoint（肩先）
  end: 袖口端
  geometry: along_outer_seam_or_straight
- waistWidth（ウエスト）: 任意。切替えがある場合のみ測定

## サロペット（salopette）
- totalLength_salopette（総丈）:
  start: 肩紐上端
  end: 裾最下端
  geometry: vertical_straight
- bodyWidth（身幅）:
  start: 左ArmpitSeamPoint
  end: 右ArmpitSeamPoint
  geometry: horizontal_straight
  note: 脇下の直線距離
- waistWidth（ウエスト）:
  start: ウエスト部分の左端
  end: ウエスト部分の右端
  geometry: horizontal_straight
- frontRise（股上）:
  start: ウエスト上端
  end: CrotchPoint（内股合わせ）
  geometry: vertical_straight
- inseam（股下）:
  start: CrotchPoint
  end: 内股の縫い目に沿って裾
  geometry: along_inseam
- hemWidth（裾幅）:
  start: 裾左端
  end: 裾右端
  geometry: horizontal_straight

# カテゴリ判定（itemType）
画像から itemType を推定し、該当プロファイルの測定のみを行う。
- tshirt: bodyLength_cb, bodyWidth, shoulderWidth, sleeveLength, yukiLength(ラグランの場合)
- shirt: bodyLength_cb, bodyWidth, shoulderWidth, sleeveLength, yukiLength(ラグランの場合)
- sweatshirt: bodyLength_cb, bodyWidth, shoulderWidth, sleeveLength, yukiLength(ラグランの場合)
- hoodie: bodyLength_cb, bodyWidth, shoulderWidth, sleeveLength, yukiLength
- outerwear_coat: bodyLength_cb, bodyWidth, shoulderWidth, sleeveLength, yukiLength
- raglan: bodyLength_cb, bodyWidth, yukiLength（shoulderWidth=null, sleeveLength=null）
- pants: totalLength_pants, waistWidth, hipWidth_cfg, frontRise, inseam, thighWidth, hemWidth
- skirt: waistWidth, hipWidth_cfg, skirtLength
- dress: dressLength_bnp, bodyWidth, shoulderWidth, sleeveLength, waistWidth(任意)
- salopette: totalLength_salopette, bodyWidth, waistWidth, frontRise, inseam, hemWidth

# ラグラン判定の注意
- 肩に縫い目がなく、襟ぐりから袖下に斜めの縫い目が走っている場合はラグラン袖
- ラグラン袖のトップスは itemType を "raglan" とするか、元のカテゴリ(tshirt等)のまま shoulderWidth=null, sleeveLength=null, yukiLength を測定
- どちらの場合も肩幅・袖丈は null、裄丈を測定すること

# A4用紙検出とスケール算出（必須・最重要）
画像内にA4用紙（白い紙、四隅にL字型の黒い角マーカー、中央に十字線）が写っている。
以下の手順を必ず実行し、中間結果をすべてJSONに含めること:

1) **A4用紙の4つの角マーカーを検出**し、各マーカーのL字の内側角のpx座標を記録:
   - topLeft, topRight, bottomLeft, bottomRight（画像px座標）
   - マーカーが見えにくい場合でも、用紙の白い矩形の角を代わりに使う
   - 用紙が完全に見えない場合のみ null にする（部分的に見えるなら推定する）
2) **用紙の横幅px** = distance(topLeft, topRight) の平均と distance(bottomLeft, bottomRight) の平均
3) **用紙の縦幅px** = distance(topLeft, bottomLeft) の平均と distance(topRight, bottomRight) の平均
4) **scaleCmPerPx** = 21.0 / 横幅px平均（A4横幅=210mm=21cm）
5) **検証**: 縦横比 = 縦幅px / 横幅px ≒ 1.414（A4の297/210）。±10%超なら遠近歪みを補正
6) 上記の座標・距離・算出スケールをすべて scale オブジェクトに含める

# 各項目の計測（px座標を必ず記録）
各測定項目について:
1) 定義どおりの始点/終点を画像上で特定し、**px座標を記録**
2) 2点間のpx距離を計算
3) scaleCmPerPx を掛けてcmに換算
4) 小数点1桁に丸める

# JSON出力構造（この構造に従うこと）
{
  "itemType": "...",
  "scale": {
    "a4Corners": {
      "topLeft": [x, y],
      "topRight": [x, y],
      "bottomLeft": [x, y],
      "bottomRight": [x, y]
    },
    "a4WidthPx": 数値,
    "a4HeightPx": 数値,
    "aspectRatio": 数値,
    "scaleCmPerPx": 数値,
    "confidence": "high/medium/low",
    "notes": "..."
  },
  "measurements": {
    "項目名": {
      "startPx": [x, y],
      "endPx": [x, y],
      "distancePx": 数値,
      "value": cm値,
      "confidence": "high/medium/low"
    }
  }
}

# 絶対禁止
- scaleCmPerPx を固定値（0.036等）にハードコードすること → 必ず画像内のA4用紙から毎回算出
- px座標を出さずに値だけ出力すること → 全項目に startPx, endPx, distancePx が必須
- 全項目 confidence=high にすること → 実際の視認性・確度に基づいて判定"""


def build_user_message(ruler_cm):
    """ユーザーメッセージのJSON入力部分を構築"""
    return json.dumps({
        "task": "measure_garment_flatlay",
        "reference": {
            "type": "a4_paper",
            "paperWidthMm": 210,
            "paperHeightMm": 297,
            "cornerMarkerOffsetMm": 10,
            "notes": "白いA4用紙が衣類の上に置かれている。四隅にL字型の黒い角マーカーがあり、中央に十字線がある。用紙の物理サイズ（210mm×297mm）を基準にスケールを算出すること。角マーカーは用紙端から10mmの位置に印刷されている（マーカー間距離: 横190mm、縦277mm）。印刷の倍率ズレは無視し、用紙の物理的な端を基準にすること。"
        },
        "measurementStandard": {
            "armpitOffsetDownCm": 0.0,
            "hipDefinition": "by_zip_stop",
            "hipOffsetCm": 18.0,
            "roundingDecimalPlaces": 1,
            "roundAtEndOnly": True
        },
        "requestedItemType": None,
        "requestedMeasurements": None
    }, ensure_ascii=False, indent=2)


MAX_IMAGE_SIZE = 2048  # 長辺の最大px


def resize_image_if_needed(image_path):
    """画像が大きすぎる場合リサイズしてbase64を返す。リサイズ後のサイズも返す"""
    from PIL import Image
    import io

    img = Image.open(image_path)
    w, h = img.size
    resized = False

    if max(w, h) > MAX_IMAGE_SIZE:
        ratio = MAX_IMAGE_SIZE / max(w, h)
        new_w, new_h = int(w * ratio), int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        resized = True
        print(f"画像リサイズ: {w}x{h} → {new_w}x{new_h}")
        w, h = new_w, new_h

    # EXIF回転補正
    from PIL import ExifTags
    try:
        for orientation in ExifTags.TAGS.keys():
            if ExifTags.TAGS[orientation] == 'Orientation':
                break
        exif = img._getexif()
        if exif and orientation in exif:
            if exif[orientation] == 3:
                img = img.rotate(180, expand=True)
            elif exif[orientation] == 6:
                img = img.rotate(270, expand=True)
            elif exif[orientation] == 8:
                img = img.rotate(90, expand=True)
            w, h = img.size
    except (AttributeError, KeyError, IndexError):
        pass

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=90)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return b64, w, h, resized


def encode_image(image_path):
    """画像をbase64エンコード（後方互換用）"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_media_type(image_path):
    """ファイル拡張子からmedia typeを判定"""
    ext = Path(image_path).suffix.lower()
    types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
    }
    return types.get(ext, "image/jpeg")


VERIFY_PROMPT = """あなたは採寸結果の検証エンジンです。
1回目の計測結果JSONと同じ画像が与えられます。以下を実行してください。

# 検証手順
1. **スケール再検証**: A4用紙の四隅L字マーカーを再検出し、scaleCmPerPx を独立に再算出。1回目と5%以上乖離していたら修正。
2. **各項目の始点/終点を再確認**: 1回目のJSON内の各measurement について、定義どおりの始点/終点が正しく特定されているか画像上で再チェック。
3. **妥当性チェック**: 各値が衣類として妥当な範囲か確認（例: パンツ総丈70-120cm、トップス着丈50-80cm、スカート丈40-100cm等）。
4. **confidence=low の項目**: 始点/終点を再特定し、px距離を再計算してcmを出し直す。
5. **相互整合性**: 例えば「股上+股下≒総丈」「肩幅<身幅」等の関係が成り立つか確認。

# 出力
1回目と同じJSON構造で出力。修正した項目は confidence を更新し、verificationNotes に修正理由を記載。
修正がなければ1回目と同じ値を返す（confidence を "verified" に更新）。
出力はJSONのみ（説明文・前置き・Markdown禁止）。"""


def measure_image(client, image_path, ruler_cm, verify=False):
    """画像を送信して採寸結果を取得（自動リサイズ付き）"""
    base64_image, img_w, img_h, resized = resize_image_if_needed(image_path)
    media_type = "image/jpeg"  # リサイズ後は常にJPEG
    user_json = build_user_message(ruler_cm)

    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_json
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{base64_image}",
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

    if not verify:
        return result, usage

    # ─── 2段階目: 検証 ───
    print("\n🔍 2段階目: 検証中...")
    first_result_json = json.dumps(result, ensure_ascii=False, indent=2)

    response2 = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": VERIFY_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"# 1回目の計測結果\n{first_result_json}\n\n# 同じ画像で検証してください"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{base64_image}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        response_format={"type": "json_object"}
    )

    content2 = response2.choices[0].message.content
    usage2 = response2.usage

    try:
        verified_result = json.loads(content2)
    except json.JSONDecodeError:
        verified_result = result  # 検証失敗時は1回目を返す

    # トークン使用量を合算
    class CombinedUsage:
        def __init__(self, u1, u2):
            self.prompt_tokens = u1.prompt_tokens + u2.prompt_tokens
            self.completion_tokens = u1.completion_tokens + u2.completion_tokens

    combined_usage = CombinedUsage(usage, usage2)

    # 1回目と2回目の差分を表示
    print_verification_diff(result, verified_result)

    return verified_result, combined_usage


def print_verification_diff(first, verified):
    """1回目と検証後の差分を表示"""
    m1 = first.get("measurements", {})
    m2 = verified.get("measurements", {})

    diffs = []
    for key in m1:
        v1 = m1[key].get("value") if isinstance(m1[key], dict) else m1[key]
        v2_item = m2.get(key, {})
        v2 = v2_item.get("value") if isinstance(v2_item, dict) else v2_item

        if v1 is not None and v2 is not None and v1 != v2:
            diffs.append((key, v1, v2))

    if diffs:
        print("\n⚡ 検証で修正された項目:")
        for key, v1, v2 in diffs:
            diff = v2 - v1
            sign = "+" if diff > 0 else ""
            print(f"  {key}: {v1:.1f} → {v2:.1f} ({sign}{diff:.1f}cm)")
    else:
        print("\n✅ 検証で修正なし（全項目一致）")


def parse_actual(actual_str):
    """実測値文字列をパース: 'bodyLength_cb=70,bodyWidth=52' → dict"""
    actual = {}
    for pair in actual_str.split(","):
        key, val = pair.strip().split("=")
        actual[key.strip()] = float(val.strip())
    return actual


def compare_results(ai_result, actual):
    """AI結果と実測値を比較"""
    measurements = ai_result.get("measurements", {})
    print("\n" + "=" * 60)
    print("📏 実測値との比較")
    print("=" * 60)
    print(f"{'項目':<20} {'AI値':>8} {'実測値':>8} {'誤差':>8} {'判定':>6}")
    print("-" * 60)

    errors = []
    for key, actual_val in actual.items():
        ai_item = measurements.get(key)
        # フラット数値 or 辞書構造の両方に対応
        if isinstance(ai_item, dict):
            ai_val = ai_item.get("value")
        elif isinstance(ai_item, (int, float)):
            ai_val = ai_item
        else:
            ai_val = None

        if ai_val is None:
            print(f"{key:<20} {'null':>8} {actual_val:>8.1f} {'---':>8} {'---':>6}")
            continue

        diff = ai_val - actual_val
        abs_diff = abs(diff)
        errors.append(abs_diff)

        if abs_diff <= 1.0:
            judge = "OK"
        elif abs_diff <= 2.0:
            judge = "OK"
        else:
            judge = "NG"

        sign = "+" if diff > 0 else ""
        print(f"{key:<20} {ai_val:>8.1f} {actual_val:>8.1f} {sign}{diff:>7.1f} {judge:>6}")

    if errors:
        avg_error = sum(errors) / len(errors)
        max_error = max(errors)
        within_1cm = sum(1 for e in errors if e <= 1.0)
        within_2cm = sum(1 for e in errors if e <= 2.0)
        total = len(errors)

        print("-" * 60)
        print(f"平均誤差: {avg_error:.1f}cm")
        print(f"最大誤差: {max_error:.1f}cm")
        print(f"±1cm以内: {within_1cm}/{total} ({within_1cm/total*100:.0f}%)")
        print(f"±2cm以内: {within_2cm}/{total} ({within_2cm/total*100:.0f}%)")
        print(f"判定: {'PASS' if within_2cm == total else 'FAIL'}")


def print_result(result, image_path, usage):
    """結果を整形表示"""
    print("\n" + "=" * 60)
    print(f"画像: {image_path}")
    print("=" * 60)

    # カテゴリ
    item_type = result.get("itemType", "不明")
    print(f"カテゴリ: {item_type}")

    # スケール情報
    scale = result.get("scale", {})
    if scale:
        scale_val = scale.get('scaleCmPerPx', 0)
        conf = scale.get('confidence', '---')
        a4w = scale.get('a4WidthPx', '?')
        a4h = scale.get('a4HeightPx', '?')
        ratio = scale.get('aspectRatio', '?')
        print(f"スケール: {scale_val:.6f} cm/px (信頼度={conf})")
        print(f"A4用紙: 横={a4w}px, 縦={a4h}px, 縦横比={ratio} (理論値=1.414)")
        corners = scale.get('a4Corners', {})
        if corners:
            for name, coord in corners.items():
                print(f"  {name}: {coord}")
        notes = scale.get('notes', '')
        if notes:
            print(f"  notes: {notes}")

    # 採寸結果
    measurements = result.get("measurements", {})
    if measurements:
        print(f"\n{'項目':<20} {'値':>8} {'単位':>4} {'信頼度':>8} {'理由'}")
        print("-" * 70)
        for key, item in measurements.items():
            if isinstance(item, dict):
                val = item.get("value")
                val_str = f"{val:.1f}" if val is not None else "null"
                conf = item.get("confidence", "?")
                dist_px = item.get("distancePx", "")
                start = item.get("startPx", "")
                end = item.get("endPx", "")
                px_info = f"  {dist_px:.0f}px {start}→{end}" if dist_px and start else ""
                print(f"{key:<20} {val_str:>8} {'cm':>4} {conf:>8}{px_info}")
            elif isinstance(item, (int, float)):
                print(f"{key:<20} {item:>8.1f} {'cm':>4} {'---':>8}")
            elif item is None:
                print(f"{key:<20} {'null':>8} {'cm':>4} {'---':>8}")

    # 全体信頼度・notes
    overall_conf = result.get("confidence", "?")
    notes = result.get("notes", "")
    print(f"\n全体信頼度: {overall_conf}")
    if notes:
        print(f"ノート: {notes}")

    # トークン使用量
    if usage:
        cost_input = usage.prompt_tokens * 2.50 / 1_000_000
        cost_output = usage.completion_tokens * 10.00 / 1_000_000
        cost_total = cost_input + cost_output
        cost_yen = cost_total * 150
        print(f"\nトークン: 入力={usage.prompt_tokens}, 出力={usage.completion_tokens}")
        print(f"費用: ${cost_total:.4f} (約¥{cost_yen:.1f})")


def main():
    parser = argparse.ArgumentParser(description="AI採寸 精度検証")
    parser.add_argument("input", help="画像ファイル or フォルダ")
    parser.add_argument("--ruler", type=float, default=DEFAULT_RULER_CM,
                        help=f"定規の長さ(cm) デフォルト={DEFAULT_RULER_CM}")
    parser.add_argument("--actual", type=str, default=None,
                        help="実測値 例: bodyLength_cb=70,bodyWidth=52")
    parser.add_argument("--repeat", type=int, default=1,
                        help="同じ画像を繰り返しテスト（再現性検証）")
    parser.add_argument("--verify", action="store_true",
                        help="2段階検証を有効化（1回目計測→2回目検証）")
    args = parser.parse_args()

    # APIキー確認
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("ERROR: OPENAI_API_KEY が未設定です")
        print("  export OPENAI_API_KEY='sk-xxxxx'")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    # 画像ファイルリスト取得
    input_path = Path(args.input)
    if input_path.is_dir():
        image_files = sorted(
            glob.glob(str(input_path / "*.jpg")) +
            glob.glob(str(input_path / "*.jpeg")) +
            glob.glob(str(input_path / "*.png"))
        )
        if not image_files:
            print(f"ERROR: {input_path} に画像ファイルがありません")
            sys.exit(1)
        print(f"{len(image_files)}枚の画像を検出")
    else:
        if not input_path.exists():
            print(f"ERROR: {input_path} が見つかりません")
            sys.exit(1)
        image_files = [str(input_path)]

    # 実測値パース
    actual = parse_actual(args.actual) if args.actual else None

    # テスト実行
    all_results = []
    for image_path in image_files:
        for i in range(args.repeat):
            if args.repeat > 1:
                print(f"\n--- 試行 {i+1}/{args.repeat} ---")

            result, usage = measure_image(client, image_path, args.ruler, verify=args.verify)
            print_result(result, image_path, usage)
            all_results.append(result)

            if actual:
                compare_results(result, actual)

    # 再現性レポート（repeat > 1の場合）
    if args.repeat > 1 and len(all_results) > 1:
        print("\n" + "=" * 60)
        print("再現性レポート")
        print("=" * 60)
        # 各項目の値を集めてバラつきを確認
        all_keys = set()
        for r in all_results:
            all_keys.update(r.get("measurements", {}).keys())

        for key in sorted(all_keys):
            values = []
            for r in all_results:
                item = r.get("measurements", {}).get(key, {})
                if isinstance(item, dict) and item.get("value") is not None:
                    values.append(item["value"])
            if len(values) >= 2:
                avg = sum(values) / len(values)
                spread = max(values) - min(values)
                print(f"{key:<20} 値={[f'{v:.1f}' for v in values]}  "
                      f"平均={avg:.1f}  ばらつき={spread:.1f}cm")

    # JSON出力（最後の結果）
    result_data = all_results[-1] if all_results else {}
    output_path = Path(image_files[0]).stem + "_result.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)
    print(f"\n結果を {output_path} に保存しました")

    # 調整用HTML生成
    if all_results:
        adj_path = generate_adjust_html(image_files[0], result_data)
        print(f"調整ツール: {adj_path}")
        print("  ブラウザで開いてドットをドラッグして調整できます")
        import subprocess
        subprocess.run(["open", adj_path])


JAPANESE_NAMES = {
    "totalLength_pants": "総丈",
    "waistWidth": "ウエスト",
    "hipWidth_cfg": "ヒップ",
    "frontRise": "股上",
    "inseam": "股下",
    "thighWidth": "ワタリ",
    "hemWidth": "裾幅",
    "bodyLength_cb": "着丈",
    "bodyWidth": "身幅",
    "shoulderWidth": "肩幅",
    "sleeveLength": "袖丈",
    "yukiLength": "裄丈",
    "totalLength_top": "総丈",
    "skirtLength": "スカート丈",
    "dressLength_bnp": "着丈",
    "totalLength_salopette": "総丈",
}


def generate_adjust_html(image_path, result):
    """結果の調整用HTMLを生成"""

    stem = Path(image_path).stem
    html_path = f"{stem}_adjust.html"
    measurements = result.get("measurements", {})
    scale = result.get("scale", {})
    scale_cm_per_px = scale.get("scaleCmPerPx", 0.05)

    # 画像をリサイズしてローカルコピー
    from PIL import Image
    import io
    img = Image.open(image_path)
    w, h = img.size
    if max(w, h) > 2048:
        ratio = 2048 / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    img_filename = f"{stem}_preview.jpg"
    img.save(img_filename, "JPEG", quality=85)
    img_w, img_h = img.size

    # 測定項目をJSオブジェクトに変換
    items_js = []
    for key, val in measurements.items():
        jp_name = JAPANESE_NAMES.get(key, key)
        if isinstance(val, (int, float)) and val is not None:
            items_js.append(f'    "{key}": {{ value: {val}, name: "{jp_name}" }}')
        elif isinstance(val, dict) and val.get("value") is not None:
            v = val["value"]
            items_js.append(f'    "{key}": {{ value: {v}, name: "{jp_name}" }}')
    items_str = ",\n".join(items_js)

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>採寸結果調整 - {stem}</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family:-apple-system,'Hiragino Sans',sans-serif; background:#222; color:#fff; }}
  .container {{ display:flex; height:100vh; }}
  .image-area {{ flex:1; position:relative; overflow:hidden; cursor:crosshair; }}
  .image-area img {{ width:100%; height:100%; object-fit:contain; }}
  .panel {{ width:320px; background:#1a1a1a; padding:16px; overflow-y:auto; }}
  h2 {{ font-size:14px; margin-bottom:12px; color:#ccc; }}
  .item {{ padding:10px 0; border-bottom:1px solid #333; }}
  .item-name {{ font-size:13px; color:#999; }}
  .item-value {{ font-size:24px; font-weight:700; }}
  .item-value.adjusted {{ color:#0f0; }}
  .item-diff {{ font-size:12px; color:#f80; margin-top:2px; }}
  .dot {{
    position:absolute; width:16px; height:16px;
    background:#000; border:2px solid #fff;
    border-radius:50%; cursor:grab; z-index:10;
    transform:translate(-50%,-50%);
    box-shadow:0 0 6px rgba(0,0,0,0.8);
  }}
  .dot:hover {{ background:#c00; }}
  .dot.active {{ background:#c00; cursor:grabbing; }}
  .line {{
    position:absolute; background:rgba(255,0,0,0.6);
    z-index:5; pointer-events:none;
  }}
  .label {{
    position:absolute; background:rgba(200,0,0,0.85); color:#fff;
    font-size:11px; font-weight:600; padding:2px 6px;
    border-radius:3px; z-index:6; pointer-events:none;
    white-space:nowrap;
  }}
  .instructions {{
    margin-top:16px; padding:12px; background:#333; border-radius:8px;
    font-size:12px; line-height:1.6; color:#aaa;
  }}
  .btn {{
    display:block; width:100%; padding:12px; margin-top:12px;
    background:#c00; color:#fff; border:none; border-radius:8px;
    font-size:14px; font-weight:600; cursor:pointer;
  }}
  .btn:hover {{ background:#a00; }}
  .btn-secondary {{ background:#444; }}
  .btn-secondary:hover {{ background:#555; }}
  .mode-info {{
    padding:8px 12px; background:#c00; text-align:center;
    font-size:13px; font-weight:600;
  }}
  .mode-info.inactive {{ background:#333; color:#888; }}
</style>
</head>
<body>

<div id="modeBar" class="mode-info inactive">
  クリックで項目を選択 → 始点・終点をクリックして設定
</div>

<div class="container">
  <div class="image-area" id="imageArea">
    <img src="{img_filename}" id="img" draggable="false">
  </div>

  <div class="panel">
    <h2>採寸結果（クリックで調整）</h2>
    <div id="items"></div>

    <div class="instructions">
      <b>使い方:</b><br>
      1. 右の項目名をクリック<br>
      2. 画像上で始点をクリック<br>
      3. 終点をクリック<br>
      4. 距離が自動再計算されます<br><br>
      スケール: {scale_cm_per_px:.6f} cm/px
    </div>

    <button class="btn" onclick="startCalibrate()" id="calBtn">A4用紙の横幅でスケール補正</button>
    <button class="btn btn-secondary" onclick="exportResult()">調整結果をJSONで保存</button>
    <button class="btn btn-secondary" onclick="resetAll()">リセット</button>
  </div>
</div>

<script>
const SCALE = {scale_cm_per_px};
const IMG_W = {img_w};
const IMG_H = {img_h};

const originalMeasurements = {{
{items_str}
}};

let measurements = JSON.parse(JSON.stringify(originalMeasurements));
let activeItem = null;
let clickStep = 0; // 0=none, 1=waiting start, 2=waiting end
let tempStart = null;
let dots = [];
let lines = [];

const imageArea = document.getElementById('imageArea');
const img = document.getElementById('img');
const itemsDiv = document.getElementById('items');
const modeBar = document.getElementById('modeBar');

// アイテム一覧を描画
function renderItems() {{
  itemsDiv.innerHTML = '';
  for (const [key, data] of Object.entries(measurements)) {{
    const div = document.createElement('div');
    div.className = 'item';
    div.style.cursor = 'pointer';
    div.style.borderLeft = activeItem === key ? '3px solid #c00' : '3px solid transparent';
    div.style.paddingLeft = '8px';

    const orig = originalMeasurements[key]?.value;
    const adjusted = data.adjustedValue !== undefined;
    const displayVal = adjusted ? data.adjustedValue : data.value;
    const diffStr = adjusted ? ` (元: ${{orig.toFixed(1)}}cm → 調整後)` : '';

    div.innerHTML = `
      <div class="item-name">${{data.name}} <span style="font-size:10px;color:#555">(${{key}})</span></div>
      <div class="item-value ${{adjusted ? 'adjusted' : ''}}">${{displayVal.toFixed(1)}} cm</div>
      ${{adjusted ? `<div class="item-diff">${{diffStr}}</div>` : ''}}
    `;
    div.onclick = () => startAdjust(key);
    itemsDiv.appendChild(div);
  }}
}}

function startAdjust(key) {{
  activeItem = key;
  clickStep = 1;
  tempStart = null;
  clearOverlays();
  modeBar.className = 'mode-info';
  const jpName = measurements[key]?.name || key;
  modeBar.textContent = `[${{jpName}}] 画像上で始点をクリックしてください`;
  renderItems();
}}

function clearOverlays() {{
  dots.forEach(d => d.remove());
  lines.forEach(l => l.remove());
  document.querySelectorAll('.label').forEach(l => l.remove());
  dots = [];
  lines = [];
}}

// object-fit:contain の実際の描画領域を計算
function getRenderedImageRect() {{
  const imgEl = img;
  const cW = imgEl.clientWidth;
  const cH = imgEl.clientHeight;
  const iW = IMG_W;
  const iH = IMG_H;
  const cRatio = cW / cH;
  const iRatio = iW / iH;
  let rW, rH, oX, oY;
  if (iRatio > cRatio) {{
    rW = cW;
    rH = cW / iRatio;
    oX = 0;
    oY = (cH - rH) / 2;
  }} else {{
    rH = cH;
    rW = cH * iRatio;
    oX = (cW - rW) / 2;
    oY = 0;
  }}
  const rect = imgEl.getBoundingClientRect();
  return {{ left: rect.left + oX, top: rect.top + oY, width: rW, height: rH }};
}}

// 画像クリック — 実際の画像描画領域基準で座標を取る
imageArea.addEventListener('click', (e) => {{
  if (!activeItem || clickStep === 0) return;

  const areaRect = imageArea.getBoundingClientRect();
  const rendered = getRenderedImageRect();

  // imageArea内でのクリック位置（ドット描画用）
  const px = e.clientX - areaRect.left;
  const py = e.clientY - areaRect.top;

  // 実際の画像座標に変換（object-fit考慮）
  const imgX = ((e.clientX - rendered.left) / rendered.width) * IMG_W;
  const imgY = ((e.clientY - rendered.top) / rendered.height) * IMG_H;

  const jpName = measurements[activeItem]?.name || activeItem;

  if (clickStep === 1) {{
    tempStart = {{ px, py, imgX, imgY }};
    addDot(px, py);
    clickStep = 2;
    modeBar.textContent = `[${{jpName}}] 終点をクリックしてください`;
  }} else if (clickStep === 2) {{
    addDot(px, py);

    // ピクセル距離 → cm
    const dx = imgX - tempStart.imgX;
    const dy = imgY - tempStart.imgY;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distCm = Math.round(distPx * currentScale * 10) / 10;

    measurements[activeItem].adjustedValue = distCm;

    addLine(tempStart.px, tempStart.py, px, py, `${{jpName}}: ${{distCm}}cm`);

    clickStep = 0;
    activeItem = null;
    modeBar.className = 'mode-info inactive';
    modeBar.textContent = 'クリックで項目を選択 → 始点・終点をクリックして設定';
    renderItems();
  }}
}});

function addDot(x, y) {{
  const dot = document.createElement('div');
  dot.className = 'dot';
  dot.style.left = x + 'px';
  dot.style.top = y + 'px';
  imageArea.appendChild(dot);
  dots.push(dot);
}}

function addLine(x1, y1, x2, y2, text) {{
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const line = document.createElement('div');
  line.className = 'line';
  line.style.width = len + 'px';
  line.style.height = '2px';
  line.style.left = x1 + 'px';
  line.style.top = y1 + 'px';
  line.style.transformOrigin = '0 0';
  line.style.transform = `rotate(${{angle}}deg)`;
  imageArea.appendChild(line);
  lines.push(line);

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = text;
  label.style.left = ((x1 + x2) / 2) + 'px';
  label.style.top = ((y1 + y2) / 2 - 20) + 'px';
  imageArea.appendChild(label);
}}

function resetAll() {{
  measurements = JSON.parse(JSON.stringify(originalMeasurements));
  activeItem = null;
  clickStep = 0;
  clearOverlays();
  modeBar.className = 'mode-info inactive';
  modeBar.textContent = 'クリックで項目を選択 → 始点・終点をクリックして設定';
  renderItems();
}}

let calibrateMode = false;
let calStart = null;
let currentScale = SCALE;

function startCalibrate() {{
  calibrateMode = true;
  calStart = null;
  activeItem = null;
  clickStep = 0;
  clearOverlays();
  modeBar.className = 'mode-info';
  modeBar.textContent = 'A4用紙の左端をクリックしてください';
  document.getElementById('calBtn').textContent = 'キャリブレーション中...';
}}

imageArea.addEventListener('click', (e) => {{
  if (!calibrateMode) return;

  const rendered = getRenderedImageRect();
  const imgX = ((e.clientX - rendered.left) / rendered.width) * IMG_W;
  const imgY = ((e.clientY - rendered.top) / rendered.height) * IMG_H;
  const areaRect = imageArea.getBoundingClientRect();
  const px = e.clientX - areaRect.left;
  const py = e.clientY - areaRect.top;

  if (!calStart) {{
    calStart = {{ px, py, imgX, imgY }};
    addDot(px, py);
    modeBar.textContent = 'A4用紙の右端をクリックしてください';
    e.stopImmediatePropagation();
  }} else {{
    addDot(px, py);
    const dx = imgX - calStart.imgX;
    const dy = imgY - calStart.imgY;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const newScale = 21.0 / distPx;
    addLine(calStart.px, calStart.py, px, py, `21cm = ${{distPx.toFixed(0)}}px → ${{newScale.toFixed(6)}} cm/px`);

    const oldScale = currentScale;
    currentScale = newScale;

    modeBar.className = 'mode-info';
    modeBar.textContent = `スケール補正: ${{oldScale.toFixed(6)}} → ${{newScale.toFixed(6)}} cm/px`;
    calibrateMode = false;
    document.getElementById('calBtn').textContent = 'スケール補正済み（再補正する）';

    const ratio = newScale / oldScale;
    for (const [key, data] of Object.entries(measurements)) {{
      data.value = Math.round(data.value * ratio * 10) / 10;
      if (data.adjustedValue !== undefined) {{
        data.adjustedValue = Math.round(data.adjustedValue * ratio * 10) / 10;
      }}
    }}
    renderItems();
    e.stopImmediatePropagation();
  }}
}}, true);

function exportResult() {{
  const output = {{}};
  for (const [key, data] of Object.entries(measurements)) {{
    output[key] = data.adjustedValue !== undefined ? data.adjustedValue : data.value;
  }}
  const blob = new Blob([JSON.stringify(output, null, 2)], {{type: 'application/json'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '{stem}_adjusted.json';
  a.click();
}}

renderItems();
</script>
</body>
</html>"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    return html_path


if __name__ == "__main__":
    main()
