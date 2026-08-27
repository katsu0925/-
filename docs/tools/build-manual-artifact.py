#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マニュアルHTML(正本) → Artifact 配信用HTML への変換。

Artifact は publish 時に <!doctype html><head>...</head><body> の骨組みで包むため、
正本の DOCTYPE / html / head / body タグを外し、<title> と <style> と本文だけを残す。

正本ごとの作りの違いは自動判定する:
  - body に background 指定が無い正本 → 白地を明示（閲覧者のダークテーマ対策）
  - レスポンシブ指定が無い正本       → スマホ幅の余白調整を追加
  - <body class="..."> が付いている正本 → そのクラスを JS で復元（配色が変わるため必須）

使い方:
  python3 build-manual-artifact.py <入力HTML> <出力HTML>
"""
import re
import sys

BASE_CSS = """
/* ---- Artifact 配信用の追記（正本には入れない） ---- */
img { max-width: 100%; height: auto; }
"""

PAINT_CSS = """/* 閲覧者のテーマに関係なく紙のマニュアルとして読めるよう、地色と文字色を明示する */
html { background: #ffffff; }
body { background: #ffffff; color: #222222; }
"""

MOBILE_CSS = """@media (max-width: 640px) {
  body { padding: 16px 12px; }
  .compare { flex-direction: column; }
  .flow .step { flex: 1 1 100%; min-width: 0; }
}
"""


def build(src_path, dst_path):
    s = open(src_path, encoding="utf-8").read()

    m = re.search(r"<title>(.*?)</title>", s, re.S)
    if not m:
        sys.exit("エラー: <title> が見つかりません: %s" % src_path)
    title = m.group(1).strip()

    head_m = re.search(r"<head[^>]*>(.*?)</head>", s, re.S | re.I)
    if not head_m:
        sys.exit("エラー: <head> が見つかりません: %s" % src_path)
    head = head_m.group(1)

    # head の <style> / <script> を出現順に拾う（<title> と <meta> は捨てる）
    head_parts = re.findall(r"<(?:style|script)[^>]*>.*?</(?:style|script)>", head, re.S | re.I)
    styles = [p for p in head_parts if p.lower().startswith("<style")]
    if not styles:
        sys.exit("エラー: <style> が見つかりません: %s" % src_path)

    body_m = re.search(r"<body([^>]*)>(.*?)</body>", s, re.S | re.I)
    if not body_m:
        sys.exit("エラー: <body> が見つかりません: %s" % src_path)
    body_attrs, body = body_m.group(1), body_m.group(2).strip()

    css = "\n".join(styles)

    # 正本が自前で地色を塗っているか（塗っていれば上書きしない）
    painted = re.search(r"(?:^|[\s,{])(?:html\s*,\s*)?body[^{;]*\{[^}]*background", css, re.S | re.I)
    # 正本が自前でレスポンシブ対応しているか
    responsive = re.search(r"@media[^{]*max-width", css, re.I)

    extra = BASE_CSS
    if not painted:
        extra += PAINT_CSS
    if not responsive:
        extra += MOBILE_CSS
    styles[-1] = styles[-1].replace("</style>", extra + "</style>")

    out = "<title>%s</title>\n%s\n\n%s\n" % (title, "\n".join(styles), body)

    # <body class="staff"> のようなクラスは配色に効くので JS で復元する
    classes = re.findall(r'class\s*=\s*"([^"]*)"', body_attrs)
    if classes:
        names = classes[0].split()
        out += '\n<script>%s</script>\n' % "".join(
            'document.body.classList.add(%s);' % ('"%s"' % n) for n in names
        )

    for ng in ("<!DOCTYPE", "<!doctype", "<html", "</html>", "<head>", "</head>", "<body", "</body>"):
        if ng in out:
            sys.exit("エラー: 出力に %s が残っています" % ng)

    print("%s → %s" % (src_path, dst_path))
    print("  タイトル=%s / %d bytes / 地色明示=%s / 余白調整=%s / bodyクラス=%s"
          % (title, len(out.encode("utf-8")),
             "しない(正本が塗り済)" if painted else "する",
             "しない(正本が対応済)" if responsive else "する",
             " ".join(classes[0].split()) if classes else "なし"))
    open(dst_path, "w", encoding="utf-8").write(out)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2])
