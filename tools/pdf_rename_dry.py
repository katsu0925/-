#!/usr/bin/env python3
"""PDF請求書・領収書の一括リネーム（ドライラン）"""

import os
import sys
import json
import re
import time
import calendar
from pathlib import Path

from PyPDF2 import PdfReader
from openai import OpenAI

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
BASE_DIR = "/Users/katsu/Library/CloudStorage/OneDrive-個人用"
TARGET_DIRS = ["請求書", "領収書"]

# この名前が請求元の場合、自社発行の請求書と判定
MY_NAMES = ["西出克利", "NKonline", "NK online", "nkonline"]

client = OpenAI(api_key=OPENAI_API_KEY)

def extract_text(pdf_path, max_pages=3):
    """PDFからテキストを抽出（先頭3ページ）"""
    try:
        reader = PdfReader(pdf_path)
        text = ""
        for i, page in enumerate(reader.pages[:max_pages]):
            text += page.extract_text() or ""
        return text.strip()
    except Exception as e:
        return f"[TEXT_EXTRACTION_FAILED: {e}]"

def ask_gpt(text, filename):
    """GPT-5-miniに請求情報を抽出させる"""
    prompt = f"""以下はPDF請求書/領収書から抽出したテキストです。以下を正確に読み取ってください。

1. vendor: 請求元（発行者）の会社名またはサービス名（短く簡潔に。個人名はそのまま）
2. recipient: 請求先（宛先）の会社名または個人名（「御中」「様」は除く。短く簡潔に）
3. year: 請求書/領収書の対象年（数字4桁）
4. month: 請求書/領収書の対象月（数字1〜2桁）
5. amount: 請求合計金額（税込）。書類に記載されている金額をそのまま数字のみで（カンマなし）
6. currency: 通貨（JPY/USD/EUR等）。日本円なら「JPY」、ドルなら「USD」

重要なルール:
- 金額は書類に記載されている合計金額（Total/合計/請求金額）をそのまま抽出すること
- 通貨が外貨（USD等）の場合、日本円に変換せずそのまま記載すること
- vendor（請求元/発行者）とrecipient（請求先/宛先）を正確に区別すること
- 抽出できない項目は「不明」とすること
- 必ず以下のJSON形式のみで回答すること

{{"vendor": "請求元名", "recipient": "請求先名", "year": "年", "month": "月", "amount": "金額", "currency": "通貨コード"}}

ファイル名: {filename}
---
{text[:3000]}"""

    try:
        res = client.chat.completions.create(
            model="gpt-5-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=200,
        )
        content = res.choices[0].message.content.strip()
        m = re.search(r'\{.*\}', content, re.DOTALL)
        if m:
            return json.loads(m.group())
        return None
    except Exception as e:
        print(f"  [API ERROR: {e}]")
        return None

def sanitize_filename(s):
    """ファイル名に使えない文字を除去"""
    return re.sub(r'[\\/:*?"<>|]', '', s).strip()

def get_month_end(year, month):
    """年月から月末日を返す"""
    try:
        y = int(year)
        m = int(month)
        last_day = calendar.monthrange(y, m)[1]
        return f"{y}年{m:02d}月{last_day:02d}日"
    except (ValueError, TypeError):
        return "不明"

def is_my_invoice(vendor):
    """自社発行の請求書かどうか判定"""
    v = vendor.lower().replace(" ", "").replace("　", "")
    for name in MY_NAMES:
        if name.lower().replace(" ", "") in v:
            return True
    return False

def build_new_name(info):
    """抽出情報から新ファイル名を構築"""
    vendor = sanitize_filename(info.get("vendor", "不明"))
    recipient = sanitize_filename(info.get("recipient", "不明"))
    year = info.get("year", "不明")
    month = info.get("month", "不明")
    amount = info.get("amount", "不明")
    currency = info.get("currency", "JPY").upper()

    # 金額からカンマや円を除去
    amount = re.sub(r'[,、円\s$€]', '', str(amount))
    date_str = get_month_end(year, month)

    if currency == "JPY" or currency == "不明":
        amount_str = f"{amount}円"
    else:
        amount_str = f"{currency}{amount}"

    if is_my_invoice(vendor):
        # 発行側: 西出克利_請求先名_金額_日付.pdf
        return f"西出克利_{recipient}_{amount_str}_{date_str}.pdf"
    else:
        # 受取側: 請求元名_金額_日付.pdf
        return f"{vendor}_{amount_str}_{date_str}.pdf"

def main():
    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY が未設定です")
        sys.exit(1)

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 999999

    pdfs = []
    for target in TARGET_DIRS:
        target_path = Path(BASE_DIR) / target
        if target_path.exists():
            for pdf in target_path.rglob("*.pdf"):
                pdfs.append(pdf)

    print(f"対象PDF: {len(pdfs)}件")
    print(f"処理上限: {limit}件")
    print("=" * 80)

    results = []
    processed = 0

    for pdf in sorted(pdfs):
        if processed >= limit:
            break

        rel = pdf.relative_to(BASE_DIR)
        print(f"\n[{processed+1}] {rel}")

        text = extract_text(str(pdf))
        if not text or "TEXT_EXTRACTION_FAILED" in text:
            print(f"  -> テキスト抽出失敗（スキャンPDFの可能性）")
            results.append({"path": str(rel), "old": pdf.name, "new": None, "reason": "テキスト抽出失敗"})
            processed += 1
            continue

        if len(text) < 10:
            print(f"  -> テキストが短すぎます: '{text}'")
            results.append({"path": str(rel), "old": pdf.name, "new": None, "reason": "テキスト不足"})
            processed += 1
            continue

        info = ask_gpt(text, pdf.name)
        if not info:
            print(f"  -> API解析失敗")
            results.append({"path": str(rel), "old": pdf.name, "new": None, "reason": "API解析失敗"})
            processed += 1
            continue

        new_name = build_new_name(info)
        is_issued = is_my_invoice(info.get("vendor", ""))
        print(f"  種別: {'発行' if is_issued else '受取'}")
        print(f"  現在: {pdf.name}")
        print(f"  変更: {new_name}")
        print(f"  詳細: {info}")
        results.append({"path": str(rel), "old": pdf.name, "new": new_name, "info": info, "type": "発行" if is_issued else "受取"})
        processed += 1
        time.sleep(0.3)

    # サマリー
    print("\n" + "=" * 80)
    print("ドライラン結果サマリー")
    print("=" * 80)
    success = [r for r in results if r.get("new")]
    failed = [r for r in results if not r.get("new")]
    issued = [r for r in success if r.get("type") == "発行"]
    received = [r for r in success if r.get("type") == "受取"]
    print(f"リネーム可能: {len(success)}件（受取: {len(received)}件 / 発行: {len(issued)}件）")
    print(f"失敗/スキップ: {len(failed)}件")

    if failed:
        print("\n--- 失敗一覧 ---")
        for r in failed:
            print(f"  {r['path']} ({r.get('reason', '不明')})")

    # 結果をJSONに保存
    out_path = Path(BASE_DIR) / "_rename_preview.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n結果を保存: {out_path}")

if __name__ == "__main__":
    main()
