# -*- coding: utf-8 -*-
"""
プレミアムアソート 2枚目画像（出品キット デモ画面）生成スクリプト（v2）

BASE のアソート商品ページの2枚目には、以前はスプレッドシートのスクリーンショットが
登録されていた。お客様に届くのは XLSX ではなく「出品キット」の Web ページなので、
実際のキット画面（デモ）を撮って 1400x1400 のブランド画像に仕立て直す。

撮影元:
  https://wholesale.nkonline-tool.com/kit?mode=demo
  （workers/gas-proxy/src/handlers/kit.js serveDemoKit。トークン不要で常時公開）

なぜこの範囲だけ切り出すか:
  - 切り出すのは「撮影画像ギャラリー／まとめて保存バー／メルカリ用タイトル／
    即出品用説明文（実寸入り）／販売参考価格」＝お客様が受け取る中身そのもの。
  - 仕入価格が出るカードのヘッダーと、「メルカリで出品」ボタンなど
    アソート商品ページに関係しない要素は外す。
  - 縦に長くなりすぎると右パネルの中で文字が読めなくなるので、撮影時に
    商品情報テーブル（管理番号などの内部情報）を隠し、説明文の表示高さを詰めて、
    採寸データのグリッドまでが 1 枚に収まるようにしている。
  - 右パネルの幅は切り出した画像の縦横比から計算するので、上下が切れることはない。

v1→v2（2026-08-26）:
  デモが images:[] のダミー4点で「画像未アップロード」と出ていたため画像欄を外していた。
  デモデータを実際に納品したキットの4点（撮影画像つき）に差し替えたので、
  撮影画像ギャラリーを含めた範囲に切り出し直した。

使い方:
  python3 generate-kitdemo.py              # img/premium-assort/premium-assort-kit-demo-v1.jpg
  python3 generate-kitdemo.py --out v2     # 差し替え時はバージョンを上げる

★差し替えるときは必ずファイル名（バージョン）を変えること。
  同名で上書きすると BASE の差分検知（画像URL5本のMD5）が反応せず貼り直されない。
"""

import argparse
import base64
import io
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
IMG_DIR = HERE.parent.parent / "img" / "premium-assort"

DEMO_URL = "https://wholesale.nkonline-tool.com/kit?mode=demo"

SIZE = 1400
# デモ画面の撮影条件。幅を狭めるとカードに対する文字が相対的に大きくなり、
# 縮小して貼っても読める。DSF=3 は縮小時のジャギー防止。
SHOT_WIDTH = 560
SHOT_DSF = 3

FEATURES = [
    ("メルカリ用タイトル", "コピーして貼るだけ"),
    ("即出品用の説明文", "ブランド・サイズ入り"),
    ("撮影画像データ", "無加工・透かしなし"),
    ("採寸データ", "肩幅・身幅・着丈ほか"),
]

BADGE = "出品キット付き"
LEAD = "そのまま出品できるデータを Webページでお渡しします"
NOTE = "※ 画面は実際の納品例です。<br>仕入れた1点ごとに掲載されます"

FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'


def capture_card(page):
    """デモ画面を開き、撮影画像ギャラリー〜コピー欄までを切り出した PNG バイト列を返す。"""
    page.goto(DEMO_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)
    # 右下に浮いている操作ボタン（▲ / A+ / ▼）は本文に被るので隠す
    page.add_style_tag(content=(
        # 右下に浮いている操作ボタン（▲ / A+ / ▼）は本文に被るので隠す
        ".float-btns{display:none !important;}"
        # 管理番号などの内部情報が並ぶ商品情報テーブルは広告に不要なので隠す
        ".product-details .detail-col:first-child{display:none !important;}"
        # 説明文は全文スクロールできる欄。1枚に収めるため表示高さだけ詰める
        ".copy-content{max-height:92px !important;}"
    ))
    page.wait_for_timeout(400)

    rect = page.evaluate(
        """() => {
          const card = document.querySelector('.product-card.open');
          const gal = card.querySelector('.image-gallery');
          const det = card.querySelector('.product-details');
          const box = el => { const b = el.getBoundingClientRect();
            return {x: b.x, y: b.y + window.scrollY, w: b.width, h: b.height}; };
          const g = box(gal), d = box(det);
          return {x: Math.round(g.x), y: Math.round(g.y),
                  w: Math.round(g.w), h: Math.round(d.y + d.h - g.y)};
        }"""
    )
    shot = page.screenshot(full_page=True)
    im = Image.open(io.BytesIO(shot))
    s = SHOT_DSF
    crop = im.crop((rect["x"] * s, rect["y"] * s,
                    (rect["x"] + rect["w"]) * s, (rect["y"] + rect["h"]) * s))
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    print("デモ画面を切り出し: %dx%d" % crop.size)
    return buf.getvalue(), crop.size


def build_html(shot_data_uri, shot_size):
    rows = "".join(
        '<li><i class="dot"></i><span class="ttl">%s</span>'
        '<span class="sub">%s</span></li>' % (t, s)
        for t, s in FEATURES
    )
    # 右パネルは切り出し画像の縦横比に合わせる（上下が切れないように）
    right_w = int(round(IMG_H * shot_size[0] / shot_size[1]))
    left_w = COLS_W - GAP - right_w
    html = """<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:@SIZE@px; height:@SIZE@px; overflow:hidden;
    font-family:@FONT@; -webkit-font-smoothing:antialiased;
    background:
      radial-gradient(120% 90% at 50% -10%, #2a2318 0%, #14110c 42%, #090807 100%),
      #090807;
  }
  .frame { position:absolute; inset:20px; border:1px solid rgba(184,147,63,.45); }
  .head { position:absolute; left:0; right:0; top:56px; text-align:center; }
  .badge { display:inline-flex; align-items:center; gap:18px;
    font-size:46px; font-weight:700; letter-spacing:.06em; color:#f2e0ae;
    border:2px solid #b8933f; border-radius:999px; padding:10px 40px 12px;
    background:rgba(0,0,0,.45); text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .dia { width:11px; height:11px; flex:none; transform:rotate(45deg); background:#c9a24a; }
  .lead { margin-top:20px; font-size:31px; font-weight:500; letter-spacing:.02em;
    color:#d6c69f; }
  .cols { position:absolute; left:91px; top:@TOP@px; width:@COLSW@px; height:@IMGH@px;
    display:flex; gap:@GAP@px; align-items:stretch; }
  .left { width:@LEFTW@px; display:flex; flex-direction:column; justify-content:center; }
  .left ul { list-style:none; }
  .left li { list-style:none; display:grid;
    grid-template-columns:22px 1fr; column-gap:14px; margin-bottom:44px; }
  .left li:last-child { margin-bottom:0; }
  .left .dot { width:12px; height:12px; margin-top:16px; transform:rotate(45deg);
    background:#c9a24a; }
  .left .ttl { font-size:38px; font-weight:700; color:#f5ead0; letter-spacing:.02em; }
  .left .sub { grid-column:2; margin-top:6px; font-size:25px; font-weight:400;
    color:#a89a7c; }
  .note { margin-top:52px; font-size:21px; line-height:1.6; color:#8a7f66; }
  .right { width:@RIGHTW@px; flex:none; border-radius:14px; overflow:hidden;
    border:1px solid rgba(184,147,63,.55);
    box-shadow:0 18px 46px rgba(0,0,0,.65); background:#fff; }
  .right img { display:block; width:100%; height:100%; object-fit:fill; }
</style></head><body>
  <div class="frame"></div>
  <div class="head">
    <div class="badge"><i class="dia"></i>@BADGE@<i class="dia"></i></div>
    <div class="lead">@LEAD@</div>
  </div>
  <div class="cols">
    <div class="left"><ul>@ROWS@</ul><div class="note">@NOTE@</div></div>
    <div class="right"><img src="@SHOT@"></div>
  </div>
</body></html>"""
    repl = {
        "@SIZE@": str(SIZE),
        "@COLSW@": str(COLS_W),
        "@GAP@": str(GAP),
        "@LEFTW@": str(left_w),
        "@RIGHTW@": str(right_w),
        "@FONT@": FONT,
        "@TOP@": str(TOP),
        "@IMGH@": str(IMG_H),
        "@BADGE@": BADGE,
        "@LEAD@": LEAD,
        "@NOTE@": NOTE,
        "@ROWS@": rows,
        "@SHOT@": shot_data_uri,
    }
    for k, v in repl.items():
        html = html.replace(k, v)
    return html


TOP = 250
IMG_H = 1110
COLS_W = 1218
GAP = 30


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="v1", help="出力バージョン（既定 v1）")
    args = ap.parse_args()

    dst = IMG_DIR / ("premium-assort-kit-demo-%s.jpg" % args.out)

    with sync_playwright() as p:
        # headless_shell は未インストール。インストール済みの Chrome を使う
        browser = p.chromium.launch(channel="chrome")

        shot_page = browser.new_page(
            viewport={"width": SHOT_WIDTH, "height": 1200},
            device_scale_factor=SHOT_DSF)
        png, shot_size = capture_card(shot_page)
        shot_page.close()

        data_uri = "data:image/png;base64," + base64.b64encode(png).decode()
        page = browser.new_page(viewport={"width": SIZE, "height": SIZE},
                                device_scale_factor=1)
        page.set_content(build_html(data_uri, shot_size))
        page.wait_for_timeout(500)
        page.screenshot(path=str(dst), type="jpeg", quality=92)
        browser.close()

    print("生成: %s (%d KB)" % (dst.name, dst.stat().st_size // 1024))


if __name__ == "__main__":
    main()
