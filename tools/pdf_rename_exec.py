#!/usr/bin/env python3
"""ドライラン結果のJSONを読み込んで実際にリネーム実行"""

import json
from pathlib import Path

BASE_DIR = Path("/Users/katsu/Library/CloudStorage/OneDrive-個人用")
PREVIEW_FILE = BASE_DIR / "_rename_preview.json"

def main():
    with open(PREVIEW_FILE, "r", encoding="utf-8") as f:
        results = json.load(f)

    renamed = 0
    skipped = 0
    errors = 0

    for r in results:
        old_rel = r.get("path", "")
        new_name = r.get("new")
        if not new_name:
            skipped += 1
            continue

        old_path = BASE_DIR / old_rel
        new_path = old_path.parent / new_name

        if not old_path.exists():
            print(f"[NOT FOUND] {old_rel}")
            errors += 1
            continue

        if old_path.name == new_name:
            skipped += 1
            continue

        # 同名ファイルが既に存在する場合は連番を付与
        if new_path.exists():
            stem = new_path.stem
            suffix = new_path.suffix
            i = 2
            while new_path.exists():
                new_path = old_path.parent / f"{stem}_{i}{suffix}"
                i += 1

        try:
            old_path.rename(new_path)
            print(f"[OK] {old_path.name} -> {new_path.name}")
            renamed += 1
        except Exception as e:
            print(f"[ERROR] {old_rel}: {e}")
            errors += 1

    print(f"\n完了: リネーム {renamed}件 / スキップ {skipped}件 / エラー {errors}件")

if __name__ == "__main__":
    main()
