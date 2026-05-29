#!/usr/bin/env python3
"""
D1 annotations → COCO Pose 形式エクスポート（tops+jacket）

実行: cd workers/annotate && python3 scripts/export_coco.py

成果物:
  out/coco_tops_jacket/
    ├── images/                  R2 から取得した元画像（{id:04d}_{name}）
    ├── annotations/train.json   COCO Pose（9割）
    ├── annotations/val.json     COCO Pose（1割）
    └── dataset.zip              Kaggle Notebook アップロード用
"""

from __future__ import annotations

import json
import random
import re
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "out" / "coco_tops_jacket"
IMG_DIR = OUT_ROOT / "images"
ANN_DIR = OUT_ROOT / "annotations"
ZIP_PATH = REPO_ROOT / "out" / "coco_tops_jacket.zip"

KEYPOINT_NAMES = [
    "collar_center",
    "left_shoulder",
    "right_shoulder",
    "left_armpit",
    "right_armpit",
    "left_cuff",
    "right_cuff",
    "hem_left",
    "hem_right",
    "hem_center",
]

# 採寸ペア距離損失で使う対称・隣接ペア（学習時の補助損失）
SKELETON = [
    [2, 3], [4, 5], [6, 7], [8, 9],
    [1, 2], [1, 3], [2, 4], [3, 5],
    [4, 6], [5, 7], [4, 8], [5, 9],
    [8, 10], [9, 10],
]

RANDOM_SEED = 42
VAL_RATIO = 0.10
R2_BUCKET = "annotate-images"
WRANGLER_CWD = str(REPO_ROOT)

SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(s: str) -> str:
    return SAFE_NAME_RE.sub("_", s)


def run_wrangler(args: list[str]) -> str:
    cmd = ["wrangler", *args]
    proc = subprocess.run(cmd, cwd=WRANGLER_CWD, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"wrangler {' '.join(args[:3])} failed (exit {proc.returncode}):\n"
            f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc.stdout


def fetch_rows() -> list[dict]:
    sql = (
        "SELECT id, worker, category, image_key, image_name, "
        "image_width, image_height, a4_corners, keypoints "
        "FROM annotations WHERE category IN ('tops','jacket') ORDER BY id;"
    )
    out = run_wrangler([
        "d1", "execute", "detauri-db", "--remote", "--json", "--command", sql,
    ])
    data = json.loads(out)
    return data[0]["results"]


def download_image(row: dict) -> tuple[int, str, bool]:
    image_id = int(row["id"])
    src_key = row["image_key"]
    base = safe_name(Path(row["image_name"]).name)
    dst = IMG_DIR / f"{image_id:04d}_{base}"
    if dst.exists() and dst.stat().st_size > 0:
        return image_id, str(dst), True
    try:
        run_wrangler([
            "r2", "object", "get", f"{R2_BUCKET}/{src_key}",
            "--file", str(dst), "--remote",
        ])
        return image_id, str(dst), True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! image fetch failed (id={image_id}): {exc}", file=sys.stderr)
        return image_id, str(dst), False


def build_annotation(row: dict, ann_id: int) -> dict | None:
    kp = json.loads(row["keypoints"])
    flat: list[int | float] = []
    num_kp = 0
    xs: list[float] = []
    ys: list[float] = []
    for name in KEYPOINT_NAMES:
        point = kp.get(name)
        if not point or point.get("visibility", 0) == 0:
            flat.extend([0, 0, 0])
            continue
        x = float(point["x"])
        y = float(point["y"])
        v = int(point["visibility"])
        flat.extend([x, y, v])
        num_kp += 1
        xs.append(x)
        ys.append(y)
    if num_kp == 0:
        return None
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    pad = 8.0
    bx = max(0.0, x_min - pad)
    by = max(0.0, y_min - pad)
    bw = min(row["image_width"] - bx, (x_max - x_min) + pad * 2)
    bh = min(row["image_height"] - by, (y_max - y_min) + pad * 2)
    return {
        "id": ann_id,
        "image_id": int(row["id"]),
        "category_id": 1,
        "keypoints": flat,
        "num_keypoints": num_kp,
        "bbox": [bx, by, bw, bh],
        "area": bw * bh,
        "iscrowd": 0,
        "category_label": row["category"],
        "a4_corners": json.loads(row["a4_corners"]) if row.get("a4_corners") else None,
    }


def build_coco_payload(rows: list[dict], split: str) -> dict:
    images = []
    annotations = []
    next_ann_id = 1
    for row in rows:
        ann = build_annotation(row, next_ann_id)
        if ann is None:
            continue
        images.append({
            "id": int(row["id"]),
            "file_name": f"{int(row['id']):04d}_{safe_name(Path(row['image_name']).name)}",
            "width": int(row["image_width"]),
            "height": int(row["image_height"]),
            "worker": row.get("worker"),
            "category_label": row["category"],
        })
        annotations.append(ann)
        next_ann_id += 1
    return {
        "info": {
            "description": "Detauri / Toludake clothing keypoint dataset (tops+jacket)",
            "version": "1.0",
            "split": split,
            "keypoints_per_instance": len(KEYPOINT_NAMES),
        },
        "licenses": [],
        "images": images,
        "annotations": annotations,
        "categories": [
            {
                "id": 1,
                "name": "garment_top",
                "supercategory": "clothing",
                "keypoints": KEYPOINT_NAMES,
                "skeleton": SKELETON,
            }
        ],
    }


def split_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    rng = random.Random(RANDOM_SEED)
    shuffled = list(rows)
    rng.shuffle(shuffled)
    n_val = max(1, int(round(len(shuffled) * VAL_RATIO)))
    val = shuffled[:n_val]
    train = shuffled[n_val:]
    return train, val


def main() -> int:
    print("[1/5] D1 から tops+jacket 行を取得…")
    rows = fetch_rows()
    n_total = len(rows)
    print(f"      取得: {n_total} 行")
    if n_total == 0:
        print("行が0件。中止します。", file=sys.stderr)
        return 1

    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    ANN_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[2/5] R2 から画像 {n_total} 枚を並列ダウンロード…")
    ok_count = 0
    fail_ids: list[int] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(download_image, row): row for row in rows}
        for i, fut in enumerate(as_completed(futures), 1):
            image_id, _, ok = fut.result()
            if ok:
                ok_count += 1
            else:
                fail_ids.append(image_id)
            if i % 20 == 0 or i == n_total:
                print(f"      進捗: {i}/{n_total} (成功 {ok_count})")
    if fail_ids:
        print(f"  ! 画像取得失敗 {len(fail_ids)} 件: {fail_ids[:10]}…", file=sys.stderr)
        rows = [r for r in rows if int(r["id"]) not in set(fail_ids)]

    print("[3/5] train/val 分割 (9:1, seed=42)…")
    train_rows, val_rows = split_rows(rows)
    print(f"      train={len(train_rows)} val={len(val_rows)}")

    print("[4/5] COCO Pose JSON を書き出し…")
    train_path = ANN_DIR / "train.json"
    val_path = ANN_DIR / "val.json"
    train_path.write_text(
        json.dumps(build_coco_payload(train_rows, "train"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    val_path.write_text(
        json.dumps(build_coco_payload(val_rows, "val"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("[5/5] dataset.zip を作成…")
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in OUT_ROOT.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(OUT_ROOT.parent))

    print()
    print(f"  出力ディレクトリ : {OUT_ROOT}")
    print(f"  zip              : {ZIP_PATH}")
    print(f"  train images     : {len(train_rows)}")
    print(f"  val images       : {len(val_rows)}")
    if fail_ids:
        print(f"  ※ R2取得失敗 {len(fail_ids)} 件は除外しています")
    return 0


if __name__ == "__main__":
    sys.exit(main())
