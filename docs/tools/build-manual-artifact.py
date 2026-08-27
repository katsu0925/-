#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マニュアルHTML(正本) → Artifact 配信用HTML への変換。

Artifact は publish 時に <!doctype html><head>...</head><body> の骨組みで包むため、
正本の DOCTYPE / html / head / body タグを外し、<title> と <style> と本文だけを残す。
あわせて、閲覧者のダークテーマに引きずられないよう地色を明示するCSSを追記する。

使い方:
  python3 build-manual-artifact.py <入力HTML> <出力HTML>
"""
import re
import sys

EXTRA_CSS = """
/* ---- Artifact 配信用の追記（正本には入れない） ---- */
/* 閲覧者のテーマに関係なく紙のマニュアルとして読めるよう、地色と文字色を明示する */
html { background: #ffffff; }
body { background: #ffffff; color: #222222; }
img { max-width: 100%; height: auto; }
@media (max-width: 640px) {
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

    styles = re.findall(r"<style[^>]*>.*?</style>", head, re.S | re.I)
    if not styles:
        sys.exit("エラー: <style> が見つかりません: %s" % src_path)

    body_m = re.search(r"<body[^>]*>(.*?)</body>", s, re.S | re.I)
    if not body_m:
        sys.exit("エラー: <body> が見つかりません: %s" % src_path)
    body = body_m.group(1).strip()

    styles[-1] = styles[-1].replace("</style>", EXTRA_CSS + "</style>")

    out = "<title>%s</title>\n%s\n\n%s\n" % (title, "\n".join(styles), body)

    for ng in ("<!DOCTYPE", "<!doctype", "<html", "</html>", "<head>", "</head>", "<body", "</body>"):
        if ng in out:
            sys.exit("エラー: 出力に %s が残っています" % ng)

    open(dst_path, "w", encoding="utf-8").write(out)
    print("%s → %s  (%s, %d bytes)" % (src_path, dst_path, title, len(out.encode("utf-8"))))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2])
