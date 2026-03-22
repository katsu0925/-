#!/usr/bin/env python3
"""
CVベース衣類キーポイント検出

衣類の輪郭からキーポイント（肩先・脇下・襟・裾・袖口）を検出し、
採寸線を自動で引く。

使い方:
  python3 cv_keypoints.py IMG_1722.jpg
"""

import sys
import cv2
import numpy as np
from pathlib import Path

MAX_SIZE = 2048


def load_and_resize(path):
    img = cv2.imread(path)
    h, w = img.shape[:2]
    if max(w, h) > MAX_SIZE:
        r = MAX_SIZE / max(w, h)
        img = cv2.resize(img, (int(w * r), int(h * r)))
    return img


def segment_garment(img):
    """衣類を背景から分離（LAB色空間 + Otsu）"""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)

    # --- 複数チャンネルで閾値処理して組み合わせ ---
    # LABのaチャンネル（赤-緑）: 衣類がカーペットと異なる
    a_ch = lab[:, :, 1]
    b_ch = lab[:, :, 2]
    l_ch = lab[:, :, 0]
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]

    # Otsu閾値でaチャンネルを二値化
    _, a_thresh = cv2.threshold(a_ch, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 彩度ベース: 衣類は彩度がある、背景は低彩度
    _, sat_thresh = cv2.threshold(sat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 組み合わせ: 両方とも前景と判定されたピクセル
    fg_mask = cv2.bitwise_and(a_thresh, sat_thresh)

    # --- A4用紙を除外 ---
    white_mask = (sat < 30) & (val > 180)
    fg_mask[white_mask] = 0

    # --- 画像の端ピクセルはすべて背景 ---
    fg_mask[0:5, :] = 0
    fg_mask[-5:, :] = 0
    fg_mask[:, 0:5] = 0
    fg_mask[:, -5:] = 0

    # --- モルフォロジー ---
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=2)

    # --- 最大連結成分のみ ---
    contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest = max(contours, key=cv2.contourArea)
        clean_mask = np.zeros_like(fg_mask)
        cv2.drawContours(clean_mask, [largest], -1, 255, -1)
        fg_mask = clean_mask

    # --- 穴を埋める ---
    contours2, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(fg_mask, contours2, -1, 255, -1)

    return fg_mask


def find_main_contour(mask):
    """最大の輪郭を取得"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def analyze_contour_tops(contour, img_shape):
    """トップス用: 輪郭からキーポイントを検出"""
    h, w = img_shape[:2]
    pts = contour.reshape(-1, 2)

    # バウンディングボックス
    x_min, y_min = pts.min(axis=0)
    x_max, y_max = pts.max(axis=0)
    cx = (x_min + x_max) // 2  # 衣類の中心X

    # === 1. 襟（トップ中央）===
    # 上部中央付近の最も高い点
    center_band = (pts[:, 0] > cx - (x_max - x_min) * 0.15) & (pts[:, 0] < cx + (x_max - x_min) * 0.15)
    center_pts = pts[center_band]
    if len(center_pts) > 0:
        collar_idx = center_pts[:, 1].argmin()
        collar = tuple(center_pts[collar_idx])
    else:
        collar = (cx, y_min)

    # === 2. 裾（ボトム中央）===
    bottom_pts = pts[center_band]
    if len(bottom_pts) > 0:
        hem_idx = bottom_pts[:, 1].argmax()
        hem = tuple(bottom_pts[hem_idx])
    else:
        hem = (cx, y_max)

    # === 3. 袖口（左右の最も外側の点）===
    left_sleeve_end = tuple(pts[pts[:, 0].argmin()])
    right_sleeve_end = tuple(pts[pts[:, 0].argmax()])

    # === 4. 脇下（凹み点）を検出 ===
    # 輪郭の左半分と右半分で、最も内側に凹んでいる点を探す
    left_armpit = find_armpit(pts, cx, 'left', collar, hem)
    right_armpit = find_armpit(pts, cx, 'right', collar, hem)

    # === 5. 肩先を検出 ===
    # 肩先 = 輪郭が「上→外」から「外→下」に変わる点
    # 脇下と袖口の間で、最も上にある点
    left_shoulder = find_shoulder(pts, cx, 'left', left_armpit, left_sleeve_end, collar)
    right_shoulder = find_shoulder(pts, cx, 'right', right_armpit, right_sleeve_end, collar)

    return {
        'collar': collar,
        'hem': hem,
        'left_shoulder': left_shoulder,
        'right_shoulder': right_shoulder,
        'left_armpit': left_armpit,
        'right_armpit': right_armpit,
        'left_sleeve_end': left_sleeve_end,
        'right_sleeve_end': right_sleeve_end,
    }


def find_armpit(pts, cx, side, collar, hem):
    """脇下の凹み点を検出"""
    collar_y = collar[1]
    hem_y = hem[1]
    garment_height = hem_y - collar_y

    # 脇下は衣類の上から30-50%の高さにある
    y_low = collar_y + garment_height * 0.25
    y_high = collar_y + garment_height * 0.55

    if side == 'left':
        # 左側: cx より左で、最もcxに近い（最も内側の）点
        candidates = pts[(pts[:, 0] < cx) & (pts[:, 1] > y_low) & (pts[:, 1] < y_high)]
        if len(candidates) == 0:
            return (cx - 100, int(collar_y + garment_height * 0.35))
        # X座標が最大（最も中央寄り）の点
        idx = candidates[:, 0].argmax()
        return tuple(candidates[idx])
    else:
        candidates = pts[(pts[:, 0] > cx) & (pts[:, 1] > y_low) & (pts[:, 1] < y_high)]
        if len(candidates) == 0:
            return (cx + 100, int(collar_y + garment_height * 0.35))
        idx = candidates[:, 0].argmin()
        return tuple(candidates[idx])


def find_shoulder(pts, cx, side, armpit, sleeve_end, collar):
    """肩先を検出: 輪郭が横方向から下方向に曲がる点"""
    collar_y = collar[1]
    armpit_y = armpit[1]

    # 肩は襟と脇の間の高さにある
    y_low = collar_y
    y_high = armpit_y

    if side == 'left':
        # 左肩: 脇下より左、襟より左、かつ上部にある点
        candidates = pts[(pts[:, 0] < cx) & (pts[:, 1] >= y_low) & (pts[:, 1] <= y_high)]
        if len(candidates) == 0:
            return armpit

        # 輪郭の曲率変化を検出
        # まず高さ方向にソートして、上から下にスキャン
        # 肩先 = 横方向に最も外側に出ている点（上半分で）
        # ただし袖口まで行かない範囲
        armpit_x = armpit[0]
        sleeve_x = sleeve_end[0]
        # 脇下〜袖口の中間より内側にある点群
        mid_x = (armpit_x + sleeve_x) / 2
        shoulder_candidates = candidates[candidates[:, 0] > mid_x]
        if len(shoulder_candidates) == 0:
            shoulder_candidates = candidates

        # その中でY座標が最小（最も上）の点の付近で、X座標が最小（最も外）の点
        top_y = shoulder_candidates[:, 1].min()
        near_top = shoulder_candidates[shoulder_candidates[:, 1] < top_y + (armpit_y - collar_y) * 0.3]
        if len(near_top) > 0:
            idx = near_top[:, 0].argmin()
            return tuple(near_top[idx])
        return tuple(shoulder_candidates[shoulder_candidates[:, 1].argmin()])
    else:
        candidates = pts[(pts[:, 0] > cx) & (pts[:, 1] >= y_low) & (pts[:, 1] <= y_high)]
        if len(candidates) == 0:
            return armpit

        armpit_x = armpit[0]
        sleeve_x = sleeve_end[0]
        mid_x = (armpit_x + sleeve_x) / 2
        shoulder_candidates = candidates[candidates[:, 0] < mid_x]
        if len(shoulder_candidates) == 0:
            shoulder_candidates = candidates

        top_y = shoulder_candidates[:, 1].min()
        near_top = shoulder_candidates[shoulder_candidates[:, 1] < top_y + (armpit_y - collar_y) * 0.3]
        if len(near_top) > 0:
            idx = near_top[:, 0].argmax()
            return tuple(near_top[idx])
        return tuple(shoulder_candidates[shoulder_candidates[:, 1].argmin()])


def detect_a4_scale(img):
    """A4用紙を検出してスケール(cm/px)を算出"""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # 白い矩形を検出
    mask = cv2.inRange(hsv, (0, 0, 180), (180, 40, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    best_score = 0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 5000:
            continue
        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), angle = rect
        if rw == 0 or rh == 0:
            continue
        ratio = max(rw, rh) / min(rw, rh)
        # A4比率 = 1.414
        ratio_diff = abs(ratio - 1.414)
        if ratio_diff < 0.15:
            score = area
            if score > best_score:
                best_score = score
                best = rect

    if best is None:
        return None, None

    (cx, cy), (rw, rh), angle = best
    short_side = min(rw, rh)  # 21cm
    long_side = max(rw, rh)   # 29.7cm
    scale = 21.0 / short_side
    print(f"A4検出: {short_side:.0f}x{long_side:.0f}px, 比率={long_side/short_side:.3f}, スケール={scale:.6f} cm/px")
    return scale, best


def draw_results(img, keypoints, scale, a4_rect):
    """結果を描画"""
    vis = img.copy()
    h, w = img.shape[:2]

    # A4用紙の枠を描画
    if a4_rect:
        box = cv2.boxPoints(a4_rect)
        box = box.astype(int)
        cv2.drawContours(vis, [box], 0, (200, 200, 200), 2)

    kp = keypoints
    colors = {
        'collar': (0, 0, 255),        # 赤
        'hem': (0, 0, 200),
        'left_shoulder': (255, 100, 0),  # 青
        'right_shoulder': (255, 100, 0),
        'left_armpit': (0, 200, 0),    # 緑
        'right_armpit': (0, 200, 0),
        'left_sleeve_end': (0, 200, 200),  # 黄
        'right_sleeve_end': (0, 200, 200),
    }

    # キーポイントを描画
    for name, pt in kp.items():
        color = colors.get(name, (255, 255, 255))
        cv2.circle(vis, pt, 12, color, -1)
        cv2.circle(vis, pt, 14, (255, 255, 255), 2)
        cv2.putText(vis, name, (pt[0] + 16, pt[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

    # 採寸線を描画
    measurements = {}

    def draw_measurement(name, p1, p2, color, label_offset_y=0):
        cv2.line(vis, p1, p2, color, 3)
        dist_px = np.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
        dist_cm = dist_px * scale if scale else 0
        measurements[name] = dist_cm
        mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2 + label_offset_y)
        label = f"{name}: {dist_cm:.1f}cm" if scale else f"{name}: {dist_px:.0f}px"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(vis, (mid[0] - 2, mid[1] - th - 4), (mid[0] + tw + 4, mid[1] + 4), (0, 0, 0), -1)
        cv2.putText(vis, label, mid, cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    # 肩幅: 左肩先 → 右肩先
    draw_measurement('shoulderWidth', kp['left_shoulder'], kp['right_shoulder'],
                     (255, 100, 0), -25)

    # 身幅: 左脇下 → 右脇下（水平距離）
    armpit_y = (kp['left_armpit'][1] + kp['right_armpit'][1]) // 2
    draw_measurement('bodyWidth',
                     (kp['left_armpit'][0], armpit_y),
                     (kp['right_armpit'][0], armpit_y),
                     (0, 200, 0), 0)

    # 着丈: 襟 → 裾
    draw_measurement('bodyLength_cb', kp['collar'], kp['hem'],
                     (0, 0, 255), 15)

    # 袖丈: 肩先 → 袖口（左）
    draw_measurement('sleeveLength_L', kp['left_shoulder'], kp['left_sleeve_end'],
                     (0, 200, 200), -15)

    # 袖丈: 肩先 → 袖口（右）
    draw_measurement('sleeveLength_R', kp['right_shoulder'], kp['right_sleeve_end'],
                     (0, 200, 200), 15)

    return vis, measurements


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 cv_keypoints.py <image>")
        sys.exit(1)

    path = sys.argv[1]
    img = load_and_resize(path)
    h, w = img.shape[:2]
    print(f"画像: {path} ({w}x{h})")

    # A4スケール検出
    scale, a4_rect = detect_a4_scale(img)

    # 衣類セグメンテーション
    print("衣類セグメンテーション中...")
    mask = segment_garment(img)

    # マスク保存（デバッグ用）
    stem = Path(path).stem
    cv2.imwrite(f"{stem}_mask.jpg", mask)
    print(f"マスク → {stem}_mask.jpg")

    # 輪郭検出
    contour = find_main_contour(mask)
    if contour is None:
        print("輪郭が検出できませんでした")
        sys.exit(1)
    print(f"輪郭: {len(contour)}点, 面積={cv2.contourArea(contour):.0f}px²")

    # 輪郭デバッグ画像
    contour_vis = img.copy()
    cv2.drawContours(contour_vis, [contour], -1, (0, 255, 0), 2)
    cv2.imwrite(f"{stem}_contour.jpg", contour_vis)
    print(f"輪郭 → {stem}_contour.jpg")

    # キーポイント検出
    print("キーポイント検出中...")
    keypoints = analyze_contour_tops(contour, img.shape)

    for name, pt in keypoints.items():
        print(f"  {name}: ({pt[0]}, {pt[1]})")

    # 結果描画
    vis, measurements = draw_results(img, keypoints, scale, a4_rect)

    out_path = f"{stem}_cv_keypoints.jpg"
    cv2.imwrite(out_path, vis)
    print(f"\n結果 → {out_path}")

    # 実測値との比較
    ACTUAL = {
        'IMG_1722': {'shoulderWidth': 57, 'sleeveLength': 50, 'bodyLength_cb': 49, 'bodyWidth': 51},
        'IMG_1724': {'shoulderWidth': 36, 'sleeveLength': 17, 'dressLength_bnp': 83, 'bodyWidth': 30},
    }
    actual = ACTUAL.get(stem, {})
    if actual and scale:
        print("\n" + "=" * 60)
        print("実測値との比較")
        print("=" * 60)
        print(f"{'項目':<20} {'CV値':>8} {'実測値':>8} {'誤差':>8}")
        print("-" * 60)
        for key, act in actual.items():
            cv_val = measurements.get(key)
            # 袖丈は左右の平均
            if key == 'sleeveLength' and cv_val is None:
                l = measurements.get('sleeveLength_L', 0)
                r = measurements.get('sleeveLength_R', 0)
                cv_val = (l + r) / 2 if l and r else None
            if cv_val is not None:
                diff = cv_val - act
                mark = "✅" if abs(diff) <= 2 else ("⚠️" if abs(diff) <= 5 else "❌")
                print(f"{key:<20} {cv_val:>8.1f} {act:>8.1f} {diff:>+8.1f} {mark}")
            else:
                print(f"{key:<20} {'N/A':>8} {act:>8.1f}")


if __name__ == "__main__":
    main()
