# -*- coding: utf-8 -*-
"""i18n-src/*.tsv (ja|||en|||zh) -> saisun-list/i18n-en.js, i18n-zh-CN.js

実行: python3 saisun-list/i18n-src/build.py
"""
import glob, json, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.dirname(D)          # saisun-list/
SEP = '|||'

ESC = {'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', "'": "'", '"': '"', '/': '/'}

def unescape(s):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i + 1]
            if n == 'u' and i + 5 < len(s):
                try:
                    out.append(chr(int(s[i + 2:i + 6], 16))); i += 6; continue
                except ValueError:
                    pass
            if n in ESC:
                out.append(ESC[n]); i += 2; continue
        out.append(c); i += 1
    return ''.join(out)

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

# 正規表現ルール: 数値などが埋め込まれて生成される文言（完全一致では拾えない）
PATTERNS = {
  'en': [
    [r'^[\u3040-\u30ff\u4e00-\u9fff\u30fb\s]+[（(]\s*([A-Za-z0-9&.\'\- ]{2,})\s*[)）]$', '$1'],
    [r'^([\d,]+)円$', '¥$1'],
    [r'^(\d+)サイズ$', 'Size $1'],
    [r'^(\d+)〜(\d+)サイズ$', 'Size $1-$2'],
    [r'^(\d+)・(\d+)サイズ$', 'Size $1 / $2'],
    [r'^([\d,]+)点$', '$1 items'],
    [r'^（([\d,]+)点）$', '($1 items)'],
    [r'^残り([\d,]+)個$', '$1 left'],
    [r'^残り ?(\d+)分(\d0)$', '$1 min $2 sec left'],
    [r'^掲載中 ([\d,]+)点$', '$1 listed'],
    [r'^在庫: ?([\d,]+)点（最大([\d,]+)注文可）$', 'Stock: $1 (max $2 per order)'],
    # アソートは単位（/セット）が挟まるので上の完全一致では拾えない
    [r'^在庫: ?([\d,]+)点（最大([\d,]+)/セット注文可）$', 'Stock: $1 (max $2 sets per order)'],
    [r'^カート数量: ?([\d,]+)点$', 'Cart quantity: $1'],
    [r'^表示：([\d,]+)件$', 'Showing: $1'],
    [r'^選択中：([\d,]+)件$', 'Selected: $1'],
    [r'^選択中：([\d,]+)件 / 表示：([\d,]+)件$', 'Selected: $1 / Showing: $2'],
    [r'^デタウリ([\d,]+)点$', 'Detauri $1 items'],
    [r'^アソート([\d,]+)点$', 'Assort $1 items'],
    [r'^アソート([\d,]+)種$', 'Assort $1 types'],
    [r'^デタウリ([\d,]+)点 \+ アソート([\d,]+)点$', 'Detauri $1 items + Assort $2 items'],
    [r'^アソート([\d,]+)種 \+ デタウリ([\d,]+)点$', 'Assort $1 types + Detauri $2 items'],
    [r'^会員割引 \((\d+)%OFF\)$', 'Member discount ($1% OFF)'],
    [r'^初回全品半額（(\d+)%OFF）$', 'First-order half price ($1% OFF)'],
    [r'^ポイント利用合計 \(([\d,]+)pt\)$', 'Points used ($1 pt)'],
    [r'^ポイント還元率: ?(\d+)%$', 'Point reward rate: $1%'],
    [r'^ポイント有効期限: ?(.+)$', 'Points expire: $1'],
    [r'^ポイント利用で -([\d,]+)円 割引（「変更を適用」で合計に反映）$', 'Points applied: -¥$1 off (added to the total with "Apply changes")'],
    [r'^ポイント残高が不足しています（残高: ?([\d,]+)pt）$', 'Not enough points (balance: $1 pt)'],
    [r'^\(送料 ¥([\d,]+) 込\)$', '(incl. ¥$1 shipping)'],
    [r'^あと¥([\d,]+)で送料無料$', '¥$1 more for free shipping'],
    [r'^(.+) \| デタウリ\.Detauri アソート商品$', '$1 | Detauri Assort'],
    [r'^(.+) \| デタウリ\.Detauri$', '$1 | Detauri'],
    [r'^カラー: ?(.*)$', 'Color: $1'],
    [r'^カテゴリ: ?(.*)$', 'Category: $1'],
    [r'^価格: ?(.*)$', 'Price: $1'],
    [r'^サイズ: ?(.*)$', 'Size: $1'],
    [r'^状態: ?(.*)$', 'Condition: $1'],
    [r'^性別: ?(.*)$', 'Gender: $1'],
    [r'^種類: ?(.*)$', 'Type: $1'],
    [r'^配送: ?(.*)$', 'Delivery: $1'],
    [r'^残高: ?([\d,]+)$', 'Balance: $1'],
    [r'^（保有: ?([\d,]+) ?pt）$', '(you have $1 pt)'],
    [r'^登録日: ?(.+)$', 'Registered: $1'],
  ],
  'zh-CN': [
    [r'^[\u3040-\u30ff\u4e00-\u9fff\u30fb\s]+[（(]\s*([A-Za-z0-9&.\'\- ]{2,})\s*[)）]$', '$1'],
    [r'^([\d,]+)円$', '¥$1'],
    [r'^(\d+)サイズ$', '$1尺寸'],
    [r'^(\d+)〜(\d+)サイズ$', '$1〜$2尺寸'],
    [r'^(\d+)・(\d+)サイズ$', '$1・$2尺寸'],
    [r'^([\d,]+)点$', '$1件'],
    [r'^（([\d,]+)点）$', '（$1件）'],
    [r'^残り([\d,]+)個$', '剩余$1件'],
    [r'^残り ?(\d+)分(\d0)$', '剩余$1分$2秒'],
    [r'^掲載中 ([\d,]+)点$', '在售$1件'],
    [r'^在庫: ?([\d,]+)点（最大([\d,]+)注文可）$', '库存：$1件（最多可订$2件）'],
    [r'^在庫: ?([\d,]+)点（最大([\d,]+)/セット注文可）$', '库存：$1件（每次最多可订$2套）'],
    [r'^カート数量: ?([\d,]+)点$', '购物车数量：$1件'],
    [r'^表示：([\d,]+)件$', '显示：$1件'],
    [r'^選択中：([\d,]+)件$', '已选择：$1件'],
    [r'^選択中：([\d,]+)件 / 表示：([\d,]+)件$', '已选择：$1件 / 显示：$2件'],
    [r'^デタウリ([\d,]+)点$', 'Detauri $1件'],
    [r'^アソート([\d,]+)点$', '混装批发 $1件'],
    [r'^アソート([\d,]+)種$', '混装批发 $1种'],
    [r'^デタウリ([\d,]+)点 \+ アソート([\d,]+)点$', 'Detauri $1件 + 混装批发 $2件'],
    [r'^アソート([\d,]+)種 \+ デタウリ([\d,]+)点$', '混装批发 $1种 + Detauri $2件'],
    [r'^会員割引 \((\d+)%OFF\)$', '会员折扣（$1%OFF）'],
    [r'^初回全品半額（(\d+)%OFF）$', '首单全场半价（$1%OFF）'],
    [r'^ポイント利用合計 \(([\d,]+)pt\)$', '使用积分合计（$1积分）'],
    [r'^ポイント還元率: ?(\d+)%$', '积分返还率：$1%'],
    [r'^ポイント有効期限: ?(.+)$', '积分有效期：$1'],
    [r'^ポイント利用で -([\d,]+)円 割引（「変更を適用」で合計に反映）$', '使用积分 -¥$1 折扣（点击「应用更改」后计入合计）'],
    [r'^ポイント残高が不足しています（残高: ?([\d,]+)pt）$', '积分余额不足（余额：$1积分）'],
    [r'^\(送料 ¥([\d,]+) 込\)$', '（含运费¥$1）'],
    [r'^あと¥([\d,]+)で送料無料$', '还差¥$1即可免运费'],
    [r'^(.+) \| デタウリ\.Detauri アソート商品$', '$1 | Detauri 混装批发商品'],
    [r'^(.+) \| デタウリ\.Detauri$', '$1 | Detauri'],
    [r'^カラー: ?(.*)$', '颜色：$1'],
    [r'^カテゴリ: ?(.*)$', '分类：$1'],
    [r'^価格: ?(.*)$', '价格：$1'],
    [r'^サイズ: ?(.*)$', '尺码：$1'],
    [r'^状態: ?(.*)$', '状态：$1'],
    [r'^性別: ?(.*)$', '性别：$1'],
    [r'^種類: ?(.*)$', '种类：$1'],
    [r'^配送: ?(.*)$', '配送：$1'],
    [r'^残高: ?([\d,]+)$', '余额：$1'],
    [r'^（保有: ?([\d,]+) ?pt）$', '（持有：$1积分）'],
    [r'^登録日: ?(.+)$', '注册日期：$1'],
  ],
}

def main():
    en, zh, dupes, bad = {}, {}, [], []
    for f in sorted(glob.glob(os.path.join(D, '*.tsv'))):
        for lineno, raw in enumerate(open(f, encoding='utf-8'), 1):
            line = raw.rstrip('\n')
            if not line.strip():
                continue
            cols = line.split(SEP)
            if len(cols) != 3:
                bad.append('%s:%d %r' % (os.path.basename(f), lineno, line[:60]))
                continue
            k = norm(unescape(cols[0]))
            if not k:
                continue
            if k in en:
                dupes.append(k)
            en[k] = unescape(cols[1])
            zh[k] = unescape(cols[2])

    # 中国語では中黒(・)を使わない。中点(·)へ寄せる
    for k in list(zh):
        if '\u30fb' in zh[k]:
            zh[k] = zh[k].replace('\u30fb', '\u00b7')

    for lang, table in (('en', en), ('zh-CN', zh)):
        payload = {'strings': table, 'patterns': PATTERNS[lang]}
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        js = ('/* 自動生成 — 編集しないこと。編集はTSV原本 -> build.py で再生成する */\n'
              'window.__I18N_REGISTER__ && window.__I18N_REGISTER__(%s, %s);\n'
              % (json.dumps(lang), body))
        p = os.path.join(OUT_DIR, 'i18n-%s.js' % lang)
        open(p, 'w', encoding='utf-8').write(js)
        print('wrote %s  (%d strings, %d patterns, %.1f KB)'
              % (p, len(table), len(PATTERNS[lang]), len(js.encode('utf-8')) / 1024))

    if dupes:
        print('上書きされたキー (%d件・後勝ちで正常): %s' % (len(dupes), dupes[:6]))
    if bad:
        print('MALFORMED (%d): %s' % (len(bad), bad[:10]))
    
main()
