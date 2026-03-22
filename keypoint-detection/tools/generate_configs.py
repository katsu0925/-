#!/usr/bin/env python3
"""tops_hrnet_w48.pyをテンプレートに、pants/skirt/dress用の設定を自動生成"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from configs.categories import CATEGORIES

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'configs', 'tops_hrnet_w48.py')

with open(TEMPLATE_PATH) as f:
    template = f.read()

for cat in CATEGORIES:
    name = cat["name"]
    if name == "tops":
        continue  # テンプレート自体

    num_kp = len(cat["keypoints"])
    flip = cat["flip_indices"]
    sigmas = cat["sigmas"]

    config = template
    # out_channels
    config = config.replace("out_channels=10,", f"out_channels={num_kp},")
    # コメント
    config = config.replace("# トップス: 10キーポイント", f"# {name}: {num_kp}キーポイント")
    # flip_indices
    config = config.replace(
        "flip_indices=[0, 2, 1, 4, 3, 6, 5, 8, 7, 9]",
        f"flip_indices={flip}"
    )
    # annotation file
    config = config.replace("dummy_tops_train.json", f"dummy_{name}_train.json")
    config = config.replace("dummy_tops_val.json", f"dummy_{name}_val.json")
    # sigmas
    config = config.replace(
        "sigmas=[0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.06, 0.06, 0.06]",
        f"sigmas={sigmas}"
    )

    out_path = os.path.join(os.path.dirname(__file__), '..', 'configs', f'{name}_hrnet_w48.py')
    with open(out_path, 'w') as f:
        f.write(config)
    print(f"{name} → {out_path} (out_channels={num_kp})")

print("\n完了。")
