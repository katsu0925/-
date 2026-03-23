#!/usr/bin/env python3
"""撮影ガイド・アノテーションマニュアルをPDF化"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

# CIDフォント登録（macOS/Linux共通で動作）
pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
# CIDフォントにはBold版がないため同じフォントを使用
_FONT = "HeiseiKakuGo-W5"
_FONT_BOLD = "HeiseiKakuGo-W5"

# 色定義
C_PRIMARY = HexColor("#1a1a2e")
C_ACCENT = HexColor("#e94560")
C_BG_LIGHT = HexColor("#f0f0f5")
C_BG_HEADER = HexColor("#1a1a2e")
C_TEXT = HexColor("#333333")
C_GRAY = HexColor("#666666")

# スタイル定義
STYLES = {
    "title": ParagraphStyle("title", fontName="HeiseiKakuGo-W5", fontSize=22,
                            leading=30, textColor=C_PRIMARY, alignment=TA_CENTER,
                            spaceAfter=8*mm),
    "subtitle": ParagraphStyle("subtitle", fontName="HeiseiKakuGo-W5", fontSize=11,
                               leading=16, textColor=C_GRAY, alignment=TA_CENTER,
                               spaceAfter=12*mm),
    "h1": ParagraphStyle("h1", fontName="HeiseiKakuGo-W5", fontSize=16,
                         leading=22, textColor=C_PRIMARY, spaceBefore=10*mm,
                         spaceAfter=4*mm),
    "h2": ParagraphStyle("h2", fontName="HeiseiKakuGo-W5", fontSize=13,
                         leading=18, textColor=C_PRIMARY, spaceBefore=6*mm,
                         spaceAfter=3*mm),
    "h3": ParagraphStyle("h3", fontName="HeiseiKakuGo-W5", fontSize=11,
                         leading=16, textColor=C_TEXT, spaceBefore=4*mm,
                         spaceAfter=2*mm),
    "body": ParagraphStyle("body", fontName="HeiseiKakuGo-W5", fontSize=10,
                           leading=16, textColor=C_TEXT, spaceAfter=2*mm),
    "body_indent": ParagraphStyle("body_indent", fontName="HeiseiKakuGo-W5", fontSize=10,
                                  leading=16, textColor=C_TEXT, leftIndent=8*mm,
                                  spaceAfter=2*mm),
    "note": ParagraphStyle("note", fontName="HeiseiKakuGo-W5", fontSize=9,
                           leading=14, textColor=C_GRAY, leftIndent=4*mm,
                           spaceAfter=2*mm),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=9,
                           leading=14, textColor=C_TEXT, leftIndent=8*mm,
                           spaceAfter=3*mm, backColor=C_BG_LIGHT),
    "important": ParagraphStyle("important", fontName="HeiseiKakuGo-W5", fontSize=10,
                                leading=16, textColor=C_ACCENT, spaceAfter=2*mm,
                                leftIndent=4*mm),
}


def make_table(headers, rows, col_widths=None):
    """テーブルを作成"""
    data = [headers] + rows
    w = col_widths or [None] * len(headers)
    t = Table(data, colWidths=w, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "HeiseiKakuGo-W5"),
        ("FONTNAME", (0, 1), (-1, -1), "HeiseiKakuGo-W5"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("BACKGROUND", (0, 0), (-1, 0), C_BG_HEADER),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("TEXTCOLOR", (0, 1), (-1, -1), C_TEXT),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, C_BG_LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def p(text, style="body"):
    return Paragraph(text, STYLES[style])


def sp(h=3):
    return Spacer(1, h * mm)


def build_shooting_guide(output_path):
    """撮影ガイドPDF"""
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                            topMargin=20*mm, bottomMargin=20*mm,
                            leftMargin=20*mm, rightMargin=20*mm)
    story = []

    # タイトル
    story.append(sp(20))
    story.append(p("撮影ガイド", "title"))
    story.append(p("AI採寸キーポイント学習用データ", "subtitle"))
    story.append(p("平置き衣類の写真から採寸キーポイントを自動検出するAIモデルの学習データを作成するため、以下の仕様に従って衣類の平置き写真を撮影してください。"))
    story.append(sp(5))

    # 1. 必要枚数
    story.append(p("1. 必要枚数", "h1"))
    story.append(p("<b>合計200枚</b>の平置き衣類写真を撮影してください。", "body"))
    story.append(sp(2))
    story.append(p("できるだけ<b>いろいろな種類の衣類</b>を含めてください（偏りがないように）。"))
    story.append(p("例: トップス、ジャケット・アウター、パンツ、スカート、ワンピース、スーツ、サロペット、ルームウェア等"))
    story.append(sp(2))
    story.append(p("サイズはS〜XXLまで混在OK。レディース・メンズ混在OK。"))
    story.append(p("<b>キッズ（子供服）は不要です。</b>", "important"))

    # 2. 撮影環境
    story.append(p("2. 撮影環境", "h1"))

    story.append(p("2-1. 背景（最重要）", "h2"))
    story.append(p("<b>必須: 硬くて平らな面に置くこと。</b>", "important"))
    story.append(make_table(
        ["OK", "NG"],
        [
            ["テーブル", "カーペット・ラグ"],
            ["フローリング床", "毛布・布団の上"],
            ["段ボール", "ベッドの上"],
            ["デスク", "ソファ"],
        ],
        [80*mm, 80*mm]
    ))
    story.append(sp(2))
    story.append(p("背景色: 白 or グレーの無地が理想。フローリング（木目）もOK。柄物の布やごちゃごちゃした背景はNG。"))

    story.append(p("2-2. 照明", "h2"))
    story.append(p("・均一な自然光がベスト（窓際、曇りの日が理想）"))
    story.append(p("・LED照明もOK（影が少ない拡散光）"))
    story.append(p("<b>NG: 直射日光（強い影）、フラッシュ、暗い部屋</b>", "important"))

    story.append(p("2-3. カメラ", "h2"))
    story.append(p("・スマートフォンのカメラで十分"))
    story.append(p("・最低解像度: 3000 x 2000px以上（iPhone標準で十分）"))
    story.append(p("・ズーム: <b>0.5x推奨</b>（全体が収まらない場合）。1xでもOK"))
    story.append(p("・HDR: OFF / フラッシュ: OFF / Live Photos: OFF"))

    # 3. 衣類の置き方
    story.append(PageBreak())
    story.append(p("3. 衣類の置き方", "h1"))

    story.append(p("3-1. 基本ルール", "h2"))
    story.append(p("1. <b>前身頃を上にする</b>（ボタン・ロゴが見える面が上）"))
    story.append(p("2. <b>ボタン・ファスナーは閉じる</b>"))
    story.append(p("3. <b>シワを手で伸ばす</b>（引っ張りすぎない、自然な状態）"))
    story.append(p("4. <b>衣類全体が画面に収まること</b>（端が切れない）"))
    story.append(p("5. 撮影者の<b>手・影</b>が写り込まないこと（足はOK）"))

    story.append(p("3-2. トップスの置き方", "h2"))
    story.append(p("・袖は<b>自然に横に広げる</b>。無理に水平にしなくてよい"))
    story.append(p("・袖口が身頃や裾に<b>重ならないように</b>"))
    story.append(p("・パーカーのフードは後ろに折り畳むか上に広げる"))

    story.append(p("3-3. パンツの置き方", "h2"))
    story.append(p("・ウエストバンドを上に、両脚を自然にまっすぐ下に"))
    story.append(p("・片脚が下に潜り込まないように（重なりNG）"))
    story.append(p("・ファスナー・ボタンは閉じる"))

    story.append(p("3-4. スカート / ワンピースの置き方", "h2"))
    story.append(p("・ウエストバンドを上に、裾を自然に広げる"))
    story.append(p("・ワンピースは袖を広げ、裾まで全体が画面に収まること"))

    # 4. A4用紙の配置
    story.append(p("4. A4用紙の配置", "h1"))
    story.append(p("別途お渡しするPDFをA4サイズで印刷してください（四隅にL字マーカー、中央に十字線）。"))
    story.append(sp(3))
    story.append(p("<b>重要: A4用紙は衣類の上（中央）に置く</b>", "important"))
    story.append(sp(2))
    story.append(p("・A4用紙の<b>中央の十字線</b>がカメラの中心合わせの目印になる"))
    story.append(p("・A4用紙の4角のL字マーカーが全て見えること"))
    story.append(p("・A4用紙が折れない・歪まないこと"))
    story.append(sp(2))
    story.append(p("<b>NG: A4用紙を衣類の外（横）に置く</b> → 十字線でカメラ中心を合わせられない", "important"))
    story.append(p("<b>NG: A4用紙がフレーム外</b> → スケール算出不能", "important"))

    # 5. 撮影方法
    story.append(p("5. 撮影方法", "h1"))
    story.append(p("<b>A4の十字線にカメラ中心を合わせて真上から撮影する。</b>", "important"))
    story.append(sp(2))
    story.append(p("5-1. 簡単に真上から撮るコツ", "h2"))
    story.append(p("<b>衣類をまたぐように立ち、0.5x（超広角）で見下ろす</b>のが最も簡単です。"))
    story.append(p("・足が映ってもOK（AIが自動で無視します）"))
    story.append(p("・0.5xがない機種は1xのまま、少し離れて撮影"))
    story.append(sp(2))
    story.append(p("5-2. カメラの設定（初回のみ）", "h2"))
    story.append(p("・グリッド線: ON（中心が分かりやすくなる）"))
    story.append(p("  iPhone: 設定→カメラ→グリッドON / Android: カメラ設定→グリッドラインON", "note"))
    story.append(p("・ズーム: 0.5x推奨（全体が収まらない場合）。1xでもOK"))
    story.append(p("・フラッシュ: OFF / HDR: OFF / Live Photos: OFF"))
    story.append(sp(2))
    story.append(p("5-3. その他", "h2"))
    story.append(p("・衣類全体 + A4用紙が画面に収まること"))
    story.append(p("・上下左右に衣類の外側に10cm以上の余白"))

    # チェックリスト
    story.append(PageBreak())
    story.append(p("6. 撮影前チェックリスト", "h1"))
    checklist = [
        "衣類は硬い平面の上に置いたか？",
        "前身頃が上か？",
        "ボタン・ファスナーは閉じたか？",
        "袖は自然に広げたか？（トップス・ワンピース）",
        "シワを手で伸ばしたか？",
        "A4用紙は衣類の上（中央）に置いたか？",
        "A4用紙の4角が見えるか？",
        "衣類全体が画面に収まっているか？",
        "真上から撮っているか？",
        "手・影が写り込んでいないか？（足はOK）",
        "照明は均一か？（強い影がないか）",
    ]
    for item in checklist:
        story.append(p(f"□  {item}"))

    # 実寸計測
    story.append(PageBreak())
    story.append(p("7. 実寸計測", "h1"))
    story.append(p("撮影した全200着について、<b>メジャーで実寸を計測</b>し、スプレッドシートに記録してください。"))
    story.append(sp(2))
    story.append(p("・平置きの状態のままメジャーで測る（着用しない）"))
    story.append(p("・<b>片面の実寸</b>を記録（×2しない）"))
    story.append(p("・cm単位、小数点1桁まで（例: 51.5cm）"))
    story.append(p("・ゴムウエストは<b>伸ばさない自然な状態</b>で測る"))
    story.append(sp(3))
    story.append(p("計測項目（カテゴリ別）:", "h2"))
    story.append(make_table(
        ["カテゴリ", "計測項目"],
        [
            ["トップス・ジャケット等", "肩幅、身幅、着丈、袖丈"],
            ["パンツ", "ウエスト、総丈、股上、股下、ワタリ、裾幅"],
            ["スカート", "ウエスト、ヒップ、総丈"],
            ["ワンピース", "肩幅、身幅、着丈、袖丈、ウエスト"],
        ],
        [60*mm, None]
    ))
    story.append(sp(3))
    story.append(p("スプレッドシートにファイル名・カテゴリ・各計測値を記入。該当しない項目は「-」。"))

    # キーポイントアノテーション
    story.append(p("8. キーポイントアノテーション（CVAT）", "h1"))
    story.append(p("撮影した画像に対して、衣類の特徴点（キーポイント）をマーキングする作業です。"))
    story.append(sp(2))
    story.append(p("8-1. セットアップ", "h2"))
    story.append(p("1. <b>https://app.cvat.ai/</b> にアクセス → アカウント作成（無料）"))
    story.append(p("2. Projects → + → 新規プロジェクト作成"))
    story.append(p("3. Labels にキーポイントテンプレートを設定（アノテーションマニュアル参照）"))
    story.append(p("4. Tasks → + → 画像200枚をアップロード"))
    story.append(sp(2))
    story.append(p("8-2. 作業手順", "h2"))
    story.append(p("1. 画像を開く → 衣類のカテゴリを確認"))
    story.append(p("2. アノテーションマニュアルに従い、各キーポイントを<b>順番通りに</b>クリック"))
    story.append(p("3. 全点マーキング後、次の画像へ"))
    story.append(p("4. 全画像完了 → Menu → Export → <b>COCO Keypoints 1.0</b> でエクスポート"))
    story.append(sp(2))
    story.append(p("詳細はアノテーションマニュアルPDFを参照してください。", "note"))

    # ファイル命名規則
    story.append(p("9. ファイル命名規則", "h1"))
    story.append(p("連番でOKです。　例: 001.jpg, 002.jpg, 003.jpg ..."))
    story.append(p("ファイル名に特別なルールはありません。重複しなければ大丈夫です。"))

    # 納品物
    story.append(p("10. 納品物（3点）", "h1"))
    story.append(make_table(
        ["#", "納品物", "形式"],
        [
            ["1", "撮影画像 200枚", "JPEG（3000x2000px以上）"],
            ["2", "実寸データ 200枚分", "スプレッドシート（Google or Excel）"],
            ["3", "キーポイントアノテーション", "COCO Keypoints 1.0（CVATエクスポート）"],
        ],
        [10*mm, 55*mm, None]
    ))
    story.append(sp(2))
    story.append(p("納品方法: Google Driveの共有フォルダにアップロード。フォルダ分けは不要。"))

    doc.build(story)
    print(f"撮影ガイドPDF → {output_path}")


def build_annotation_manual(output_path):
    """アノテーションマニュアルPDF"""
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                            topMargin=20*mm, bottomMargin=20*mm,
                            leftMargin=20*mm, rightMargin=20*mm)
    story = []

    # タイトル
    story.append(sp(20))
    story.append(p("アノテーションマニュアル", "title"))
    story.append(p("衣類キーポイント — CVAT作業手順", "subtitle"))

    # 概要
    story.append(p("平置き衣類の写真に対して、採寸に必要なキーポイント（特徴点）をマーキングする作業です。各キーポイントは衣類の構造的な特徴点（肩先、脇下、裾など）に対応しています。"))
    story.append(sp(3))
    story.append(p("ツール: CVAT (Computer Vision Annotation Tool) / エクスポート: COCO Keypoint 1.0"))

    # カテゴリ別定義
    story.append(p("1. トップス (tops) — 10点", "h1"))
    story.append(make_table(
        ["ID", "名前", "日本語", "位置の定義"],
        [
            ["0", "collar_center", "襟中心", "襟ぐり上端中央（後ろ襟の中心付け根）"],
            ["1", "left_shoulder", "左肩先", "左の肩縫い目の最外端"],
            ["2", "right_shoulder", "右肩先", "右の肩縫い目の最外端"],
            ["3", "left_armpit", "左脇下", "袖と身頃の縫い合わせの最内側点"],
            ["4", "right_armpit", "右脇下", "右側の同上"],
            ["5", "left_cuff", "左袖口", "左袖末端の中央"],
            ["6", "right_cuff", "右袖口", "右袖末端の中央"],
            ["7", "hem_left", "裾左端", "身頃裾ラインの最左端"],
            ["8", "hem_right", "裾右端", "身頃裾ラインの最右端"],
            ["9", "hem_center", "裾中心", "裾ラインの中央最下端"],
        ],
        [12*mm, 35*mm, 20*mm, None]
    ))

    story.append(sp(3))
    story.append(p("<b>重要ルール:</b>", "h3"))
    story.append(p("<b>肩先(1,2) = 袖丈の始点</b>: 肩幅の端点と袖丈の始点は同じ点", "important"))
    story.append(p("<b>脇下(3,4)の見つけ方</b>: 衣類の輪郭を上→下に追い、袖の張り出しが終わって身頃に戻る「くびれ」の最内側点", "important"))
    story.append(p("<b>肩先 ≠ 袖の端</b>: 肩先は肩の縫い目の端。袖は肩先から先に続いている", "important"))

    story.append(p("袖付けタイプ別の判断:", "h3"))
    story.append(p("・<b>セットインスリーブ</b>: 肩の縫い目の端が明確に見える → そこが肩先"))
    story.append(p("・<b>ドロップショルダー</b>: 肩縫いが通常より外側・下側にある → 縫い目の端"))
    story.append(p("・<b>ラグランスリーブ</b>: 肩縫い目がない → 斜め縫い目と上部ラインの交差付近、visibility=1"))

    # パンツ
    story.append(PageBreak())
    story.append(p("2. パンツ (pants) — 7点", "h1"))
    story.append(make_table(
        ["ID", "名前", "日本語", "位置の定義"],
        [
            ["0", "waist_left", "ウエスト左端", "ウエストバンド上端の最左点"],
            ["1", "waist_right", "ウエスト右端", "ウエストバンド上端の最右点"],
            ["2", "crotch", "股交差点", "内股縫い目が交わる点（股ぐり最下点）"],
            ["3", "left_hem", "左裾", "左脚裾の中央下端"],
            ["4", "right_hem", "右裾", "右脚裾の中央下端"],
            ["5", "left_thigh", "左ワタリ", "股(2)と同じ高さでの左脚最外側点"],
            ["6", "right_thigh", "右ワタリ", "股(2)と同じ高さでの右脚最外側点"],
        ],
        [12*mm, 30*mm, 25*mm, None]
    ))
    story.append(sp(2))
    story.append(p("<b>ワタリ(5,6)のY座標は股(2)と同じ高さ</b>であること", "important"))
    story.append(p("ゴムウエスト: <b>自然に置いた状態</b>の幅（伸ばさない）"))

    # スカート
    story.append(p("3. スカート (skirt) — 6点", "h1"))
    story.append(make_table(
        ["ID", "名前", "日本語", "位置の定義"],
        [
            ["0", "waist_left", "ウエスト左端", "ウエストバンド上端の最左点"],
            ["1", "waist_right", "ウエスト右端", "ウエストバンド上端の最右点"],
            ["2", "hip_left", "ヒップ左", "ウエスト上端から下に約18cmの高さでの左端"],
            ["3", "hip_right", "ヒップ右", "同じ高さでの右端"],
            ["4", "hem_left", "裾左端", "裾ラインの最左点"],
            ["5", "hem_right", "裾右端", "裾ラインの最右点"],
        ],
        [12*mm, 30*mm, 25*mm, None]
    ))
    story.append(sp(2))
    story.append(p("ヒップ位置: ウエスト上端から約18cm下を目測。正確な距離はAIが算出するのでおおよそでOK。"))

    # ワンピース
    story.append(p("4. ワンピース (dress) — 12点", "h1"))
    story.append(p("トップスの10点（ID 0-9）に以下の2点を追加:"))
    story.append(make_table(
        ["ID", "名前", "日本語", "位置の定義"],
        [
            ["0-9", "(トップスと同一)", "", "上記トップスの定義を参照"],
            ["10", "waist_left", "ウエスト左", "くびれ/ゴムシャーリング位置の左端"],
            ["11", "waist_right", "ウエスト右", "くびれ/ゴムシャーリング位置の右端"],
        ],
        [12*mm, 35*mm, 25*mm, None]
    ))
    story.append(sp(2))
    story.append(p("ウエスト切り替えがない場合: 衣類の上端から約40-50%の高さを目測、visibility=1"))
    story.append(p("ノースリーブ: 袖口(5,6)は<b>visibility=0</b>、座標は(0,0)に設定"))

    # visibility
    story.append(PageBreak())
    story.append(p("5. visibility（可視度）の設定", "h1"))
    story.append(make_table(
        ["値", "意味", "使う場面"],
        [
            ["2", "完全に見える", "通常はこれ"],
            ["1", "位置は推測できるが確信がない", "ラグランの肩先、布が少し重なっている"],
            ["0", "マーキング不可 / 存在しない", "ノースリーブの袖口"],
        ],
        [15*mm, 50*mm, None]
    ))
    story.append(sp(2))
    story.append(p("visibility=0 の場合でも座標は (0, 0) に設定してください。"))

    # FAQ
    story.append(p("6. よくある質問", "h1"))
    qa = [
        ("肩の縫い目が見えない", "衣類の外側輪郭で最も角張っている点（肩→袖に折れ曲がる点）が肩先。visibility=1に設定。"),
        ("脇下がA4用紙で隠れている", "輪郭から推測してマーキング、visibility=1。判断できない場合はvisibility=0。"),
        ("袖が身頃に重なっている", "袖口は見えている位置をマーキング。脇下は輪郭のくびれから推測、visibility=1。"),
        ("パーカーのフードは？", "フードは無視。襟中心(0)はフードの付け根（身頃との接合部分）の中央。"),
        ("裾が不均一", "前身頃（上に見えている面）の裾を基準にする。"),
        ("ゴムウエストの幅", "伸ばさない自然な状態の端をマーキング。"),
    ]
    for q, a in qa:
        story.append(p(f"<b>Q: {q}</b>", "h3"))
        story.append(p(f"A: {a}", "body_indent"))

    # 品質チェック
    story.append(p("7. マーキング後の品質チェック", "h1"))
    checks = [
        "全てのキーポイントをマーキングしたか",
        "肩先(1,2)は袖の途中ではなく、肩の縫い目の端にあるか",
        "脇下(3,4)は衣類のくびれ（袖→身頃の境目）にあるか",
        "左右対称に近い位置になっているか",
        "ワタリ(5,6)のY座標は股(2)と同じ高さか（パンツ）",
        "バウンディングボックスは衣類全体を囲んでいるか",
    ]
    for item in checks:
        story.append(p(f"□  {item}"))

    # 採寸対応表
    story.append(p("8. キーポイントと採寸項目の対応（参考）", "h1"))
    story.append(make_table(
        ["採寸項目", "計算方法", "キーポイント"],
        [
            ["肩幅", "左肩先↔右肩先の水平距離", "1, 2"],
            ["袖丈", "肩先→袖口のユークリッド距離", "1→5 or 2→6"],
            ["身幅", "左脇下↔右脇下の水平距離", "3, 4"],
            ["着丈", "襟中心→裾中心の垂直距離", "0, 9"],
            ["ウエスト", "ウエスト左↔右の水平距離", "0, 1"],
            ["総丈", "ウエスト上端→裾の垂直距離", "0→3 or 0→4"],
            ["股下", "股交差点→裾の垂直距離", "2, 3"],
            ["ワタリ", "ワタリ左↔右の水平距離", "5, 6"],
        ],
        [30*mm, 55*mm, None]
    ))

    doc.build(story)
    print(f"アノテーションマニュアルPDF → {output_path}")


if __name__ == "__main__":
    docs_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    docs_dir = os.path.join(docs_dir, "docs")

    build_shooting_guide(os.path.join(docs_dir, "shooting-guide.pdf"))
    build_annotation_manual(os.path.join(docs_dir, "annotation-manual.pdf"))
