"""衣類カテゴリ別キーポイント定義（COCOフォーマット準拠）
annotate.html の DEFS と完全同期すること。
"""

CATEGORIES = [
    {
        "id": 1,
        "name": "tops",
        "keypoints": [
            "collar_center",    # 0: 襟中心
            "left_shoulder",    # 1: 左肩先
            "right_shoulder",   # 2: 右肩先
            "left_armpit",      # 3: 左脇下
            "right_armpit",     # 4: 右脇下
            "left_cuff",        # 5: 左袖口
            "right_cuff",       # 6: 右袖口
            "hem_left",         # 7: 裾左端
            "hem_right",        # 8: 裾右端
            "hem_center",       # 9: 裾中心
        ],
        "skeleton": [
            [0, 1], [0, 2],     # 襟→両肩
            [1, 3], [2, 4],     # 肩→脇下
            [1, 5], [2, 6],     # 肩→袖口
            [3, 7], [4, 8],     # 脇下→裾端
            [7, 9], [8, 9],     # 裾端→裾中心
        ],
        "sigmas": [0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.06, 0.06, 0.06],
        "flip_indices": [0, 2, 1, 4, 3, 6, 5, 8, 7, 9],
    },
    {
        "id": 2,
        "name": "pants",
        "keypoints": [
            "waist_left",       # 0: ウエスト左端
            "waist_right",      # 1: ウエスト右端
            "waist_center",     # 2: ウエスト中心
            "hip_left",         # 3: ヒップ左
            "hip_right",        # 4: ヒップ右
            "crotch",           # 5: 股交差点
            "thigh_outer",      # 6: ワタリ外端
            "left_hem",         # 7: 左裾
            "right_hem",        # 8: 右裾
            "hem_center",       # 9: 裾中心
        ],
        "skeleton": [
            [0, 1],             # ウエスト左右
            [0, 2], [1, 2],     # ウエスト→中心
            [3, 4],             # ヒップ左右
            [2, 5],             # ウエスト中心→股
            [5, 7], [5, 8],     # 股→裾
            [5, 6],             # 股→ワタリ外端
            [7, 9], [8, 9],     # 裾→裾中心
        ],
        "sigmas": [0.06, 0.06, 0.06, 0.07, 0.07, 0.07, 0.07, 0.06, 0.06, 0.06],
        "flip_indices": [1, 0, 2, 4, 3, 5, 6, 8, 7, 9],
    },
    {
        "id": 3,
        "name": "skirt",
        "keypoints": [
            "waist_left",       # 0: ウエスト左端
            "waist_right",      # 1: ウエスト右端
            "waist_center",     # 2: ウエスト中心
            "hip_left",         # 3: ヒップ左
            "hip_right",        # 4: ヒップ右
            "hem_left",         # 5: 裾左端
            "hem_right",        # 6: 裾右端
            "hem_center",       # 7: 裾中心
        ],
        "skeleton": [
            [0, 1],             # ウエスト
            [0, 2], [1, 2],     # ウエスト→中心
            [0, 3], [1, 4],     # ウエスト→ヒップ
            [3, 5], [4, 6],     # ヒップ→裾
            [5, 7], [6, 7],     # 裾→裾中心
        ],
        "sigmas": [0.06, 0.06, 0.06, 0.07, 0.07, 0.06, 0.06, 0.06],
        "flip_indices": [1, 0, 2, 4, 3, 6, 5, 7],
    },
    {
        "id": 4,
        "name": "dress",
        "keypoints": [
            "collar_center",    # 0: 襟中心
            "left_shoulder",    # 1: 左肩先
            "right_shoulder",   # 2: 右肩先
            "left_armpit",      # 3: 左脇下
            "right_armpit",     # 4: 右脇下
            "left_cuff",        # 5: 左袖口
            "right_cuff",       # 6: 右袖口
            "hem_left",         # 7: 裾左端
            "hem_right",        # 8: 裾右端
            "hem_center",       # 9: 裾中心
            "waist_left",       # 10: ウエスト左
            "waist_right",      # 11: ウエスト右
        ],
        "skeleton": [
            [0, 1], [0, 2],
            [1, 3], [2, 4],
            [1, 5], [2, 6],
            [3, 10], [4, 11],   # 脇下→ウエスト
            [10, 7], [11, 8],   # ウエスト→裾
            [7, 9], [8, 9],
        ],
        "sigmas": [0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.06, 0.06, 0.06, 0.07, 0.07],
        "flip_indices": [0, 2, 1, 4, 3, 6, 5, 8, 7, 9, 11, 10],
    },
    {
        "id": 5,
        "name": "salopette",
        "keypoints": [
            "left_strap_top",   # 0: 左肩紐上
            "right_strap_top",  # 1: 右肩紐上
            "left_armpit",      # 2: 左脇下
            "right_armpit",     # 3: 右脇下
            "waist_left",       # 4: ウエスト左
            "waist_right",      # 5: ウエスト右
            "crotch",           # 6: 股
            "left_hem",         # 7: 左裾
            "right_hem",        # 8: 右裾
            "hem_center",       # 9: 裾中心
        ],
        "skeleton": [
            [0, 1],             # 肩紐左右
            [0, 2], [1, 3],     # 肩紐→脇下
            [2, 4], [3, 5],     # 脇下→ウエスト
            [4, 6], [5, 6],     # ウエスト→股
            [6, 7], [6, 8],     # 股→裾
            [7, 9], [8, 9],     # 裾→裾中心
        ],
        "sigmas": [0.06, 0.06, 0.07, 0.07, 0.07, 0.07, 0.07, 0.06, 0.06, 0.06],
        "flip_indices": [1, 0, 3, 2, 5, 4, 6, 8, 7, 9],
    },
]

# エイリアス: annotate.html と同じマッピング
CATEGORY_ALIASES = {
    "jacket": "tops",
    "suit_top": "tops",
    "roomwear_top": "tops",
    "maternity": "tops",
    "suit_bottom": "pants",
    "roomwear_bottom": "pants",
    "bridal": "dress",
}

# カテゴリ名 → 定義のルックアップ
CATEGORY_MAP = {cat["name"]: cat for cat in CATEGORIES}

# 日本語名
JP_NAMES = {
    "collar_center": "襟中心", "left_shoulder": "左肩先", "right_shoulder": "右肩先",
    "left_armpit": "左脇下", "right_armpit": "右脇下",
    "left_cuff": "左袖口", "right_cuff": "右袖口",
    "hem_left": "裾左端", "hem_right": "裾右端", "hem_center": "裾中心",
    "waist_left": "ウエスト左", "waist_right": "ウエスト右", "waist_center": "ウエスト中心",
    "crotch": "股交差点", "left_hem": "左裾", "right_hem": "右裾",
    "thigh_outer": "ワタリ外端",
    "hip_left": "ヒップ左", "hip_right": "ヒップ右",
    "left_strap_top": "左肩紐上", "right_strap_top": "右肩紐上",
}
