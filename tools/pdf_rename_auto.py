#!/usr/bin/env python3
"""PDF請求書・領収書の自動リネーム（新規ファイルのみ処理）"""

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
BASE_DIR = Path("/Users/katsu/Library/CloudStorage/OneDrive-個人用")
TARGET_DIRS = ["請求書", "領収書"]
STATE_FILE = BASE_DIR / "_rename_state.json"
LOG_FILE = BASE_DIR / "_rename_log.json"

MY_NAMES = ["西出克利", "NKonline", "NK online", "nkonline"]

client = OpenAI(api_key=OPENAI_API_KEY)


def load_state():
    """処理済みファイルの一覧を読み込み"""
    if STATE_FILE.exists():
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"processed": {}}


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def append_log(entry):
    logs = []
    if LOG_FILE.exists():
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            logs = json.load(f)
    logs.append(entry)
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)


def extract_text(pdf_path, max_pages=3):
    try:
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages[:max_pages]:
            text += page.extract_text() or ""
        return text.strip()
    except Exception as e:
        return f"[TEXT_EXTRACTION_FAILED: {e}]"


def ask_gpt(text, filename):
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
            model="gpt-4o-mini",
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
    return re.sub(r'[\\/:*?"<>|]', '', s).strip()


def get_month_end(year, month):
    try:
        y = int(year)
        m = int(month)
        last_day = calendar.monthrange(y, m)[1]
        return f"{y}年{m:02d}月{last_day:02d}日"
    except (ValueError, TypeError):
        return "不明"


def is_my_invoice(vendor):
    v = vendor.lower().replace(" ", "").replace("\u3000", "")
    for name in MY_NAMES:
        if name.lower().replace(" ", "") in v:
            return True
    return False


def build_new_name(info):
    vendor = sanitize_filename(info.get("vendor", "不明"))
    recipient = sanitize_filename(info.get("recipient", "不明"))
    year = info.get("year", "不明")
    month = info.get("month", "不明")
    amount = info.get("amount", "不明")
    currency = info.get("currency", "JPY").upper()

    amount = re.sub(r'[,、円\s$€]', '', str(amount))
    date_str = get_month_end(year, month)

    if currency == "JPY" or currency == "不明":
        amount_str = f"{amount}円"
    else:
        amount_str = f"{currency}{amount}"

    if is_my_invoice(vendor):
        return f"西出克利_{recipient}_{amount_str}_{date_str}.pdf"
    else:
        return f"{vendor}_{amount_str}_{date_str}.pdf"


def is_already_renamed(filename):
    """リネーム済みのファイル名パターンにマッチするか"""
    # パターン: 名前_金額_日付.pdf or 西出克利_名前_金額_日付.pdf
    pattern = r'^.+_(\d+円|[A-Z]{3}[\d.]+)_\d{4}年\d{2}月\d{2}日\.pdf$'
    return bool(re.match(pattern, filename))


def main():
    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY が未設定です")
        sys.exit(1)

    dry_run = "--dry-run" in sys.argv

    state = load_state()
    processed = state["processed"]

    # 全PDFを収集
    pdfs = []
    for target in TARGET_DIRS:
        target_path = BASE_DIR / target
        if target_path.exists():
            for pdf in target_path.rglob("*.pdf"):
                pdfs.append(pdf)

    # 未処理のファイルだけフィルタ
    new_pdfs = []
    for pdf in sorted(pdfs):
        rel = str(pdf.relative_to(BASE_DIR))
        # 処理済みならスキップ
        if rel in processed:
            continue
        # リネーム済みのファイル名ならスキップして処理済みに登録
        if is_already_renamed(pdf.name):
            processed[rel] = {"status": "already_renamed"}
            continue
        new_pdfs.append(pdf)

    print(f"全PDF: {len(pdfs)}件 / 新規: {len(new_pdfs)}件")
    if not new_pdfs:
        print("新規ファイルはありません。")
        save_state(state)
        return

    if dry_run:
        print("--- ドライランモード（リネームしません）---")
    print("=" * 80)

    renamed = 0
    errors = 0

    for pdf in new_pdfs:
        rel = str(pdf.relative_to(BASE_DIR))
        print(f"\n[新規] {rel}")

        text = extract_text(str(pdf))
        if not text or "TEXT_EXTRACTION_FAILED" in text:
            print(f"  -> テキスト抽出失敗")
            processed[rel] = {"status": "error", "reason": "テキスト抽出失敗"}
            errors += 1
            continue

        if len(text) < 10:
            print(f"  -> テキスト不足")
            processed[rel] = {"status": "error", "reason": "テキスト不足"}
            errors += 1
            continue

        info = ask_gpt(text, pdf.name)
        if not info:
            print(f"  -> API解析失敗")
            processed[rel] = {"status": "error", "reason": "API解析失敗"}
            errors += 1
            continue

        new_name = build_new_name(info)
        is_issued = is_my_invoice(info.get("vendor", ""))
        print(f"  種別: {'発行' if is_issued else '受取'}")
        print(f"  現在: {pdf.name}")
        print(f"  変更: {new_name}")

        if dry_run:
            processed[rel] = {"status": "dry_run", "new_name": new_name, "info": info}
            renamed += 1
        else:
            new_path = pdf.parent / new_name
            # 同名ファイル対策
            if new_path.exists() and new_path != pdf:
                stem = new_path.stem
                suffix = new_path.suffix
                i = 2
                while new_path.exists():
                    new_path = pdf.parent / f"{stem}_{i}{suffix}"
                    i += 1

            try:
                pdf.rename(new_path)
                new_rel = str(new_path.relative_to(BASE_DIR))
                processed[new_rel] = {"status": "renamed", "old_name": pdf.name, "info": info}
                # 旧パスも登録（再処理防止）
                processed[rel] = {"status": "renamed_from", "new_path": new_rel}
                append_log({"old": rel, "new": new_rel, "info": info})
                print(f"  -> リネーム完了")
                renamed += 1
            except Exception as e:
                print(f"  -> エラー: {e}")
                processed[rel] = {"status": "error", "reason": str(e)}
                errors += 1

        time.sleep(0.3)

    save_state(state)

    print("\n" + "=" * 80)
    mode = "ドライラン" if dry_run else "実行"
    print(f"{mode}完了: 処理 {renamed}件 / エラー {errors}件")


if __name__ == "__main__":
    main()
