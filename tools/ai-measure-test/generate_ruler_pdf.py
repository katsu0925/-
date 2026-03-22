#!/usr/bin/env python3
"""AI採寸シート PDF生成 - A4用紙の四隅マーカー + 中央十字"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import Color, black, white, red
from reportlab.pdfgen import canvas

WIDTH, HEIGHT = A4  # 210mm x 297mm

# 角マーカーの設定
CORNER_OFFSET = 10 * mm   # 紙端から10mmの位置にマーカー
CORNER_ARM = 20 * mm      # L字の腕の長さ
CORNER_THICK = 2.5 * mm   # L字の太さ

# AI用: マーカー間の実距離
# 横: 210 - 10*2 = 190mm
# 縦: 297 - 10*2 = 277mm


def draw_corner_marker(c, x, y, dx, dy):
    """L字角マーカーを描画。dx,dyは腕が伸びる方向（+1 or -1）"""
    c.setFillColor(black)
    c.setStrokeColor(black)
    # 横腕
    if dx > 0:
        c.rect(x, y - CORNER_THICK/2, CORNER_ARM, CORNER_THICK, fill=1, stroke=0)
    else:
        c.rect(x - CORNER_ARM, y - CORNER_THICK/2, CORNER_ARM, CORNER_THICK, fill=1, stroke=0)
    # 縦腕
    if dy > 0:
        c.rect(x - CORNER_THICK/2, y, CORNER_THICK, CORNER_ARM, fill=1, stroke=0)
    else:
        c.rect(x - CORNER_THICK/2, y - CORNER_ARM, CORNER_THICK, CORNER_ARM, fill=1, stroke=0)


def draw_page1(c):
    """1ページ目: 白背景 + 四隅マーカー + 中央十字"""
    # 白背景
    c.setFillColor(white)
    c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)

    cx = WIDTH / 2
    cy = HEIGHT / 2

    # ─── 四隅のL字マーカー ───
    # 左下
    draw_corner_marker(c, CORNER_OFFSET, CORNER_OFFSET, +1, +1)
    # 右下
    draw_corner_marker(c, WIDTH - CORNER_OFFSET, CORNER_OFFSET, -1, +1)
    # 左上
    draw_corner_marker(c, CORNER_OFFSET, HEIGHT - CORNER_OFFSET, +1, -1)
    # 右上
    draw_corner_marker(c, WIDTH - CORNER_OFFSET, HEIGHT - CORNER_OFFSET, -1, -1)

    # ─── 中央の十字線 ───
    cross_arm = 30 * mm  # 中心から30mm
    c.setStrokeColor(black)
    c.setLineWidth(1 * mm)
    # 横線
    c.line(cx - cross_arm, cy, cx + cross_arm, cy)
    # 縦線
    c.line(cx, cy - cross_arm, cx, cy + cross_arm)

    # ─── 中心マーク（赤い丸） ───
    c.setStrokeColor(red)
    c.setLineWidth(1.2 * mm)
    c.circle(cx, cy, 4 * mm, fill=0, stroke=1)

    # ─── ヒントテキスト（上部・薄く） ───
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    try:
        pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
    except:
        pass

    c.setFillColor(Color(0.75, 0.75, 0.75))
    try:
        c.setFont("HeiseiKakuGo-W5", 9)
    except:
        c.setFont("Helvetica", 9)
    c.drawCentredString(cx, HEIGHT - 18 * mm, "この紙を衣類の上（中央）に置き")
    c.drawCentredString(cx, HEIGHT - 24 * mm, "十字をカメラの中心に合わせて撮影")


def draw_page2(c):
    """2ページ目: 使い方"""
    c.setFillColor(white)
    c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    try:
        pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
        jp = "HeiseiKakuGo-W5"
    except:
        jp = "Helvetica"

    x = 15 * mm
    y = HEIGHT - 20 * mm

    # タイトル
    c.setFillColor(black)
    c.setFont(jp, 15)
    c.drawString(x, y, "AI採寸シート 使い方")
    y -= 14 * mm

    # 警告
    c.setStrokeColor(red)
    c.setLineWidth(1.5)
    c.rect(x, y - 8 * mm, WIDTH - 30 * mm, 12 * mm, fill=0, stroke=1)
    c.setFillColor(red)
    c.setFont(jp, 10)
    c.drawCentredString(WIDTH / 2, y - 4 * mm, "そのまま印刷するだけでOK（設定変更不要）")
    y -= 22 * mm

    # 使い方
    c.setFillColor(black)
    c.setFont(jp, 11)
    c.drawString(x, y, "使い方")
    y -= 8 * mm

    c.setFont(jp, 9)
    steps = [
        "1. この紙を普通に印刷する（設定はそのまま）",
        "2. 衣類を平置きし、この紙を衣類の上（中央付近）に置く",
        "3. 真上からスマホで撮影（十字をカメラの中心に合わせる）",
        "4. アプリにアップロード → 自動で採寸＋商品説明を生成",
    ]
    for step in steps:
        c.drawString(x + 3 * mm, y, step)
        y -= 7 * mm
    y -= 3 * mm

    # ポイント
    c.setFont(jp, 8)
    c.setFillColor(Color(0.4, 0.4, 0.4))
    c.drawString(x + 3 * mm, y, "※ 四隅の黒いL字マークとA4用紙の端をAIが自動検出してスケールを算出します")
    y -= 5 * mm
    c.drawString(x + 3 * mm, y, "※ 印刷のズレや倍率は関係ありません（用紙サイズ210×297mmが基準）")
    y -= 8 * mm

    # 撮影のコツ
    c.setFillColor(black)
    c.setFont(jp, 11)
    c.drawString(x, y, "撮影のコツ")
    y -= 8 * mm

    c.setFont(jp, 8)
    # OK
    ok_x = x + 3 * mm
    c.setStrokeColor(Color(0.16, 0.62, 0.16))
    c.setLineWidth(2)
    c.line(ok_x, y + 2, ok_x, y - 38 * mm)
    c.setFillColor(black)
    c.setFont(jp, 9)
    c.drawString(ok_x + 3 * mm, y, "OK")
    c.setFont(jp, 8)
    for i, item in enumerate(["真上から撮る（カメラと床が平行）",
                               "明るい場所で影が出ないように",
                               "シワを伸ばし左右対称に整える",
                               "四隅のL字マークがすべて写っている",
                               "衣類全体が画角に入っている"]):
        c.drawString(ok_x + 3 * mm, y - (i + 1) * 6 * mm, item)

    # NG
    ng_x = WIDTH / 2 + 3 * mm
    c.setStrokeColor(red)
    c.line(ng_x, y + 2, ng_x, y - 38 * mm)
    c.setFillColor(black)
    c.setFont(jp, 9)
    c.drawString(ng_x + 3 * mm, y, "NG")
    c.setFont(jp, 8)
    for i, item in enumerate(["斜めから撮る（遠近で歪む）",
                               "フラッシュ使用（反射でマークが消える）",
                               "暗い場所・影が濃い",
                               "L字マークが衣類の下に隠れている",
                               "衣類の端が画面外に切れている"]):
        c.drawString(ng_x + 3 * mm, y - (i + 1) * 6 * mm, item)
    y -= 46 * mm

    # スマホ水平ガイド
    c.setFillColor(black)
    c.setFont(jp, 11)
    c.drawString(x, y, "スマホの水平ガイド設定")
    y -= 6 * mm
    c.setFont(jp, 8)
    c.setFillColor(Color(0.3, 0.3, 0.3))
    c.drawString(x, y, "真上から撮影するために、スマホのカメラの水平ガイド機能をONに。")
    y -= 8 * mm

    c.setStrokeColor(Color(0.16, 0.62, 0.16))
    c.setLineWidth(2)
    c.line(ok_x, y + 2, ok_x, y - 22 * mm)
    c.setFillColor(black)
    c.setFont(jp, 9)
    c.drawString(ok_x + 3 * mm, y, "iPhone")
    c.setFont(jp, 8)
    c.drawString(ok_x + 3 * mm, y - 6 * mm, "「設定」→「カメラ」→「グリッド」をON")
    c.drawString(ok_x + 3 * mm, y - 12 * mm, "真下に向けると十字マーク(+)が表示。")
    c.drawString(ok_x + 3 * mm, y - 18 * mm, "2つの+が重なった時が水平。")

    c.setStrokeColor(Color(0.16, 0.62, 0.16))
    c.line(ng_x, y + 2, ng_x, y - 22 * mm)
    c.setFillColor(black)
    c.setFont(jp, 9)
    c.drawString(ng_x + 3 * mm, y, "Android")
    c.setFont(jp, 8)
    c.drawString(ng_x + 3 * mm, y - 6 * mm, "カメラ「設定」→「グリッドライン」をON")
    c.drawString(ng_x + 3 * mm, y - 12 * mm, "Galaxy等は「水平ガイド」もあり。")
    c.drawString(ng_x + 3 * mm, y - 18 * mm, "カメラ設定で「レベル」を探してON。")
    y -= 30 * mm

    # 注意
    c.setFillColor(Color(0.96, 0.96, 0.96))
    c.rect(x, y - 42 * mm, WIDTH - 30 * mm, 44 * mm, fill=1, stroke=0)
    c.setFont(jp, 8)
    notes = [
        ("長持ちさせるコツ", True),
        ("・厚紙に印刷すると丈夫で繰り返し使えます", False),
        ("・ラミネート加工すると耐久性UP（100均でフィルム購入可）", False),
        ("・紙の裏にマスキングテープを貼るとすべり止めに", False),
        ("", False),
        ("注意", True),
        ("・四隅のL字マークを折ったり汚したりしないでください", False),
        ("・大きい衣類は十分な距離を取って全体を撮影してください", False),
        ("・採寸結果は「平置き実寸（参考値）」です。±1〜2cmの誤差あり", False),
    ]
    for i, (note, bold) in enumerate(notes):
        if bold:
            c.setFont(jp, 9)
            c.setFillColor(black)
        else:
            c.setFont(jp, 8)
            c.setFillColor(Color(0.4, 0.4, 0.4))
        c.drawString(x + 3 * mm, y - (i + 1) * 4.5 * mm, note)


def draw_page3(c, image_path):
    """3ページ目: 採寸ガイドイラスト"""
    c.setFillColor(white)
    c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    img_w = WIDTH - 20 * mm
    img_h = HEIGHT - 20 * mm
    c.drawImage(image_path, 10 * mm, 10 * mm, width=img_w, height=img_h,
                preserveAspectRatio=True, anchor='c')


def main():
    import os
    output = "ruler-template.pdf"
    guide_image = "guide-illustrations.jpg"

    c = canvas.Canvas(output, pagesize=A4)

    # 1ページ目: 十字 + 四隅マーカー
    draw_page1(c)
    c.showPage()

    # 2ページ目: 使い方
    draw_page2(c)
    c.showPage()

    # 3ページ目: イラスト
    if os.path.exists(guide_image):
        draw_page3(c, guide_image)
        c.showPage()

    c.save()
    print(f"PDF生成完了: {output}")
    print(f"  基準: A4用紙サイズ (210mm×297mm)")
    print(f"  角マーカー: 端から10mmの位置にL字")
    print(f"  AI検出: 角マーカー間距離 横190mm / 縦277mm")
    print(f"  印刷: そのまま印刷するだけ（倍率調整不要）")


if __name__ == "__main__":
    main()
