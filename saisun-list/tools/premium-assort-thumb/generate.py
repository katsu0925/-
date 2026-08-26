# -*- coding: utf-8 -*-
"""
プレミアムアソート サムネイル生成スクリプト（v4）

v3 の JPEG（黒×ゴールドのブランドアート＋下部の情報帯）を土台にして、
上部のタイトルを差し替え、「採寸データ＋撮影画像 付属」の帯を1本足す。

なぜ土台を流用するか:
  ブランドアートはAI生成で、テキストが焼き込まれた JPEG しか残っていない。
  アートを作り直すとブランドの見た目が変わるため、上部の黒い余白
  （y=0..378 はほぼ純黒 RGB 1-3）だけをマスクして描き直す。

なぜタイトルを差し替えるか:
  2026-06-01 のリブランドで「採寸付き」→「採寸撮影付き」に変わったのに、
  サムネのタイトルだけ旧表記「採寸付きパッケージ」のまま残っていた。

使い方:
  python3 generate.py            # img/premium-assort/*-v4.jpg を出力
  python3 generate.py --check    # 出力せずマスク範囲の妥当性だけ検査

★差し替えるときは必ずファイル名（バージョン）を変えること。
  同名で上書きすると BASE の差分検知（画像URL5本のMD5）が反応せず貼り直されない。
"""

import argparse
import base64
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
IMG_DIR = HERE.parent.parent / "img" / "premium-assort"

SIZE = 1400

# 土台 v3 の実測値:
#   焼き込みタイトル … y=80..378
#   アート本体（服の山・メジャー）… y=418 から
#   下部の情報帯 … y=1080 のゴールド罫線から
# → マスクは 382 まで不透明、404 で透明になりきる（アート開始 418 に 14px の余裕）
MASK_SOLID_UNTIL = 382
MASK_FADE_UNTIL = 404

# y=985..1078 はアートの暗い部分。ここにフェードさせながら帯を重ね、
# 既存の情報帯を上へ延長したように見せる。
BAND_TOP = 985
BAND_BOTTOM = 1078

LOTS = {
    "small": "小ロット",
    "medium": "中ロット",
    "large": "大ロット",
}

# 「採寸撮影付きパッケージ」は11文字。1400px に収めるため v3（9文字）より1文字を小さくする。
TITLE_LINE2 = "採寸撮影付きパッケージ"
BAND_TEXT = "全商品に 採寸データ（xlsx）＋ 撮影画像 付属"

# % 書式のエスケープを避けるため、置換はプレースホルダ方式にする
HTML = """
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:@SIZE@px; height:@SIZE@px; overflow:hidden; }
  body {
    background: url('@BG@') no-repeat center / @SIZE@px @SIZE@px;
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* 旧タイトルを消すマスク。上部はほぼ純黒なのでベタ塗りで継ぎ目が出ない */
  .mask {
    position:absolute; left:0; right:0; top:0; height:@FADE_END@px;
    background: linear-gradient(to bottom,
      #010101 0%, #010101 @SOLID_PCT@%, rgba(1,1,1,0) 100%);
  }
  /* 元アートと同じ、タイトル下のほのかな暖色グロー */
  .glow {
    position:absolute; left:0; right:0; top:120px; height:300px;
    background: radial-gradient(ellipse 50% 60% at 50% 100%,
      rgba(150,120,55,.20), rgba(0,0,0,0) 70%);
  }

  /* 新しいタイトル */
  .title { position:absolute; left:0; right:0; top:78px; text-align:center; }
  .title .line {
    display:block;
    font-weight:800;
    line-height:1.15;
    letter-spacing:.01em;
    background: linear-gradient(180deg,
      #fff8dc 0%, #f6e2a3 18%, #ddbb62 42%,
      #a97e2c 58%, #8a641f 66%, #e3c778 84%, #fff6d5 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 5px 9px rgba(0,0,0,.95))
            drop-shadow(0 0 26px rgba(190,150,60,.30));
  }
  .title .l1 { font-size:132px; }
  .title .l2 { font-size:108px; }

  /* 「採寸データ＋撮影画像 付属」の帯 */
  .band {
    position:absolute; left:0; right:0; top:@BAND_TOP@px; height:@BAND_H@px;
    background: linear-gradient(to bottom,
      rgba(5,4,3,0) 0%, rgba(5,4,3,.86) 34%, rgba(8,7,5,.97) 62%, rgba(10,9,5,1) 100%);
    display:flex; align-items:flex-end; justify-content:center;
    padding-bottom:14px;
  }
  .band .txt {
    font-size:42px; font-weight:600; letter-spacing:.05em;
    color:#e8d7a6;
    display:flex; align-items:center; gap:22px;
    text-shadow:0 2px 6px rgba(0,0,0,.9);
  }
  .band .dot {
    width:9px; height:9px; flex:none;
    transform:rotate(45deg); background:#c9a24a;
  }
</style>

<div class="mask"></div>
<div class="glow"></div>

<div class="title">
  <span class="line l1">@LOT@</span>
  <span class="line l2">@LINE2@</span>
</div>

<div class="band">
  <div class="txt"><i class="dot"></i>@BAND_TEXT@<i class="dot"></i></div>
</div>
"""


def build_html(bg_data_uri, lot_label):
    repl = {
        "@SIZE@": str(SIZE),
        "@BG@": bg_data_uri,
        "@FADE_END@": str(MASK_FADE_UNTIL),
        "@SOLID_PCT@": "%.2f" % (MASK_SOLID_UNTIL / MASK_FADE_UNTIL * 100),
        "@BAND_TOP@": str(BAND_TOP),
        "@BAND_H@": str(BAND_BOTTOM - BAND_TOP),
        "@LOT@": lot_label,
        "@LINE2@": TITLE_LINE2,
        "@BAND_TEXT@": BAND_TEXT,
    }
    html = HTML
    for k, v in repl.items():
        html = html.replace(k, v)
    return html


def check_base_images(base_version):
    """土台の v3 で、マスク範囲にアート本体が入り込んでいないかを検査する。"""
    ok = True
    for key in LOTS:
        src = IMG_DIR / ("premium-assort-%s-%s.jpg" % (key, base_version))
        if not src.exists():
            print("NG %s: 土台が無い %s" % (key, src))
            ok = False
            continue
        im = Image.open(src).convert("RGB")
        px = im.load()
        for y in range(MASK_FADE_UNTIL, MASK_FADE_UNTIL + 12):
            worst = max(sum(px[x, y]) // 3 for x in range(0, SIZE, 2))
            if worst > 40:
                print("NG %s: y=%d に明るい画素 (max=%d)。MASK_FADE_UNTIL を見直すこと"
                      % (key, y, worst))
                ok = False
        print("OK %s: %s %s" % (key, src.name, im.size))
    if not ok:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="出力せずマスク範囲の検査だけ行う")
    ap.add_argument("--base", default="v3", help="土台にするバージョン（既定 v3）")
    ap.add_argument("--out", default="v4", help="出力バージョン（既定 v4）")
    args = ap.parse_args()

    check_base_images(args.base)
    if args.check:
        return

    with sync_playwright() as p:
        # headless_shell は未インストール。インストール済みの Chrome を使う
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": SIZE, "height": SIZE},
                                device_scale_factor=1)
        for key, lot_label in LOTS.items():
            src = IMG_DIR / ("premium-assort-%s-%s.jpg" % (key, args.base))
            dst = IMG_DIR / ("premium-assort-%s-%s.jpg" % (key, args.out))
            data_uri = "data:image/jpeg;base64," + base64.b64encode(src.read_bytes()).decode()
            page.set_content(build_html(data_uri, lot_label))
            page.wait_for_timeout(400)
            page.screenshot(path=str(dst), type="jpeg", quality=92)
            print("生成: %s (%d KB)" % (dst.name, dst.stat().st_size // 1024))
        browser.close()


if __name__ == "__main__":
    main()
