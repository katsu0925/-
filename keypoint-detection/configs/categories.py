"""衣類カテゴリ別キーポイント定義（COCOフォーマット準拠）"""

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
        # OKS sigmas: キーポイントの位置のばらつき許容度
        # 大きい = 許容誤差が大きい（位置が曖昧なポイント）
        "sigmas": [0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.06, 0.06, 0.06],
        # 左右反転時のキーポイントスワップ定義
        "flip_indices": [0, 2, 1, 4, 3, 6, 5, 8, 7, 9],
    },
    {
        "id": 2,
        "name": "pants",
        "keypoints": [
            "waist_left",       # 0: ウエスト左端
            "waist_right",      # 1: ウエスト右端
            "crotch",           # 2: 股交差点
            "left_hem",         # 3: 左裾
            "right_hem",        # 4: 右裾
            "left_thigh",       # 5: 左ワタリ
            "right_thigh",      # 6: 右ワタリ
        ],
        "skeleton": [
            [0, 1],             # ウエスト左右
            [0, 2], [1, 2],     # ウエスト→股
            [2, 3], [2, 4],     # 股→裾
            [5, 6],             # ワタリ左右
        ],
        "sigmas": [0.06, 0.06, 0.07, 0.06, 0.06, 0.07, 0.07],
        "flip_indices": [1, 0, 2, 4, 3, 6, 5],
    },
    {
        "id": 3,
        "name": "skirt",
        "keypoints": [
            "waist_left",       # 0: ウエスト左端
            "waist_right",      # 1: ウエスト右端
            "hip_left",         # 2: ヒップ左
            "hip_right",        # 3: ヒップ右
            "hem_left",         # 4: 裾左端
            "hem_right",        # 5: 裾右端
        ],
        "skeleton": [
            [0, 1],             # ウエスト
            [0, 2], [1, 3],     # ウエスト→ヒップ
            [2, 4], [3, 5],     # ヒップ→裾
        ],
        "sigmas": [0.06, 0.06, 0.07, 0.07, 0.06, 0.06],
        "flip_indices": [1, 0, 3, 2, 5, 4],
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
]

# カテゴリ名 → 定義のルックアップ
CATEGORY_MAP = {cat["name"]: cat for cat in CATEGORIES}

# 日本語名
JP_NAMES = {
    "collar_center": "襟中心", "left_shoulder": "左肩先", "right_shoulder": "右肩先",
    "left_armpit": "左脇下", "right_armpit": "右脇下",
    "left_cuff": "左袖口", "right_cuff": "右袖口",
    "hem_left": "裾左端", "hem_right": "裾右端", "hem_center": "裾中心",
    "waist_left": "ウエスト左", "waist_right": "ウエスト右",
    "crotch": "股交差点", "left_hem": "左裾", "right_hem": "右裾",
    "left_thigh": "左ワタリ", "right_thigh": "右ワタリ",
    "hip_left": "ヒップ左", "hip_right": "ヒップ右",
}
