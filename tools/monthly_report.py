#!/usr/bin/env python3
"""
月次分析レポート生成スクリプト
商品管理CSV（メルカリ/ラクマ）と依頼管理CSV（卸売/デタウリ）を読み込み、
HTML形式の月次レポートを生成する。

Usage: python3 tools/monthly_report.py
"""

import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
from pathlib import Path

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
PRODUCT_CSV = os.path.expanduser("~/.Trash/仕入れ管理Ver.2 - 商品管理.csv")
ORDER_CSV = os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-個人用/採寸付商品リストVer.2 - 依頼管理.csv"
)
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "docs"
REPORT_MONTH = "2026-03"
OUTPUT_FILE = OUTPUT_DIR / f"report_{REPORT_MONTH}.html"


# ──────────────────────────────────────────────
# Data loading helpers
# ──────────────────────────────────────────────
def clean_yen(val):
    """Parse yen-formatted strings like '¥2,112' or '-¥977' into float."""
    if pd.isna(val) or val == "":
        return 0.0
    s = str(val).replace("¥", "").replace(",", "").replace(" ", "").replace("　", "")
    if s == "" or s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def clean_pct(val):
    """Parse percentage strings like '12%' or '-65%' into float."""
    if pd.isna(val) or val == "":
        return 0.0
    s = str(val).replace("%", "").replace(" ", "")
    if s == "" or s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(val):
    """Parse various date formats."""
    if pd.isna(val) or str(val).strip() == "":
        return pd.NaT
    s = str(val).strip()
    for fmt in ["%Y/%m/%d", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S",
                "%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M"]:
        try:
            return pd.to_datetime(s, format=fmt)
        except (ValueError, TypeError):
            continue
    try:
        return pd.to_datetime(s)
    except Exception:
        return pd.NaT


def fmt_yen(val):
    """Format number as yen string."""
    if pd.isna(val):
        return "¥0"
    v = int(round(val))
    if v < 0:
        return f"-¥{abs(v):,}"
    return f"¥{v:,}"


def fmt_pct(val):
    """Format as percentage."""
    if pd.isna(val):
        return "0.0%"
    return f"{val:.1f}%"


# ──────────────────────────────────────────────
# Load & process product CSV
# ──────────────────────────────────────────────
def load_product_data():
    print("📦 商品管理CSV読み込み中...")
    for enc in ["utf-8-sig", "utf-8", "cp932", "shift_jis"]:
        try:
            df = pd.read_csv(PRODUCT_CSV, encoding=enc, low_memory=False)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        raise RuntimeError(f"Cannot read {PRODUCT_CSV}")

    print(f"   行数: {len(df)}, 列数: {len(df.columns)}")

    # Clean monetary columns
    for col in ["仕入れ値", "販売価格", "利益", "送料", "手数料", "粗利"]:
        if col in df.columns:
            df[col] = df[col].apply(clean_yen)

    # Clean percentage
    if "利益率" in df.columns:
        df["利益率"] = df["利益率"].apply(clean_pct)

    # Parse dates
    for col in ["販売日", "仕入れ日"]:
        if col in df.columns:
            df[col] = df[col].apply(parse_date)

    # Inventory days
    if "在庫日数" in df.columns:
        df["在庫日数"] = pd.to_numeric(df["在庫日数"], errors="coerce")

    return df


def load_order_data():
    print("📋 依頼管理CSV読み込み中...")
    for enc in ["utf-8-sig", "utf-8", "cp932", "shift_jis"]:
        try:
            df = pd.read_csv(ORDER_CSV, encoding=enc, low_memory=False)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        raise RuntimeError(f"Cannot read {ORDER_CSV}")

    print(f"   行数: {len(df)}, 列数: {len(df.columns)}")

    # Clean monetary columns
    for col in ["合計金額", "送料(店負担)", "送料(客負担)", "作業報酬"]:
        if col in df.columns:
            df[col] = df[col].apply(clean_yen)

    # Parse dates
    if "依頼日時" in df.columns:
        df["依頼日時"] = df["依頼日時"].apply(parse_date)

    # Determine type: individual (has 確認リンク URL) vs assort
    if "確認リンク" in df.columns:
        df["注文タイプ"] = df["確認リンク"].apply(
            lambda x: "個別選択" if pd.notna(x) and str(x).strip() not in ["", ".."] and "http" in str(x) else "アソート"
        )
    else:
        df["注文タイプ"] = "アソート"

    # Compute wholesale revenue/cost/profit
    df["売上"] = df["合計金額"] + df["送料(客負担)"].fillna(0)
    df["決済手数料"] = df["売上"] * 0.016
    df["コスト"] = df["送料(店負担)"].fillna(0) + df["作業報酬"].fillna(0) + df["決済手数料"]
    df["利益"] = df["売上"] - df["コスト"]

    # Month column
    df["月"] = df["依頼日時"].dt.to_period("M")

    # Total items
    if "合計点数" in df.columns:
        df["合計点数"] = pd.to_numeric(df["合計点数"], errors="coerce").fillna(0).astype(int)

    return df


# ──────────────────────────────────────────────
# Analysis functions
# ──────────────────────────────────────────────
def analyze_mercari(df):
    """Analyze Mercari/Rakuma sales."""
    sold = df[(df["ステータス"] == "売却済み") & (df["販売場所"].notna()) & (df["販売場所"] != "")].copy()
    sold["月"] = sold["販売日"].dt.to_period("M")
    return sold


def analyze_inventory(df):
    """Analyze current inventory."""
    inv = df[df["ステータス"] == "在庫"].copy() if "在庫" in df["ステータス"].values else pd.DataFrame()
    # Also include 出品中, 出品待ち, 撮影待ち as inventory
    inv_statuses = ["出品中", "出品待ち", "撮影待ち"]
    inv = df[df["ステータス"].isin(inv_statuses)].copy()
    return inv


def analyze_losses(df):
    """Analyze returned and disposed items."""
    returned = df[df["ステータス"] == "返品済み"].copy()
    disposed = df[df["ステータス"] == "廃棄済み"].copy()
    return returned, disposed


# ──────────────────────────────────────────────
# Chart data generators
# ──────────────────────────────────────────────
def monthly_profit_data(mercari_sold, orders_completed):
    """Generate monthly profit trend data."""
    months_set = set()

    # Mercari monthly profits
    merc_monthly = {}
    if len(mercari_sold) > 0:
        for period, group in mercari_sold.groupby("月"):
            key = str(period)
            merc_monthly[key] = group["利益"].sum()
            months_set.add(key)

    # Wholesale individual/assort monthly profits
    ws_ind_monthly = {}
    ws_ass_monthly = {}
    if len(orders_completed) > 0:
        for period, group in orders_completed.groupby("月"):
            key = str(period)
            months_set.add(key)
            ind = group[group["注文タイプ"] == "個別選択"]
            ass = group[group["注文タイプ"] == "アソート"]
            ws_ind_monthly[key] = ind["利益"].sum()
            ws_ass_monthly[key] = ass["利益"].sum()

    months = sorted(months_set)
    return {
        "labels": months,
        "mercari": [merc_monthly.get(m, 0) for m in months],
        "ws_individual": [ws_ind_monthly.get(m, 0) for m in months],
        "ws_assort": [ws_ass_monthly.get(m, 0) for m in months],
    }


def classification_performance(mercari_sold):
    """Classification code performance for Mercari."""
    if len(mercari_sold) == 0:
        return pd.DataFrame()
    grouped = mercari_sold.groupby("区分コード").agg(
        件数=("利益", "size"),
        平均販売価格=("販売価格", "mean"),
        平均利益=("利益", "mean"),
        合計利益=("利益", "sum"),
        赤字件数=("利益", lambda x: (x < 0).sum()),
    ).reset_index()
    grouped["赤字率"] = (grouped["赤字件数"] / grouped["件数"] * 100).round(1)
    grouped = grouped.sort_values("件数", ascending=False)
    return grouped


def category_analysis(mercari_sold, top_n=8):
    """Top category2 analysis."""
    if len(mercari_sold) == 0:
        return pd.DataFrame()
    grouped = mercari_sold.groupby("カテゴリ2").agg(
        件数=("利益", "size"),
        合計利益=("利益", "sum"),
        平均利益=("利益", "mean"),
    ).reset_index()
    grouped = grouped.sort_values("合計利益", ascending=False).head(top_n)
    return grouped


def inventory_age_distribution(inventory):
    """Inventory age distribution."""
    if len(inventory) == 0 or "在庫日数" not in inventory.columns:
        return {"0-14": 0, "15-30": 0, "31-60": 0, "61-90": 0, "90+": 0}
    days = inventory["在庫日数"].dropna()
    return {
        "0-14": int((days <= 14).sum()),
        "15-30": int(((days > 14) & (days <= 30)).sum()),
        "31-60": int(((days > 30) & (days <= 60)).sum()),
        "61-90": int(((days > 60) & (days <= 90)).sum()),
        "90+": int((days > 90).sum()),
    }


def wholesale_comparison(orders_completed):
    """Compare individual vs assort wholesale."""
    result = {}
    for typ in ["個別選択", "アソート"]:
        sub = orders_completed[orders_completed["注文タイプ"] == typ]
        result[typ] = {
            "件数": len(sub),
            "売上": sub["売上"].sum(),
            "送料_店負担": sub["送料(店負担)"].sum(),
            "作業報酬": sub["作業報酬"].sum(),
            "決済手数料": sub["決済手数料"].sum(),
            "利益": sub["利益"].sum(),
            "利益率": (sub["利益"].sum() / sub["売上"].sum() * 100) if sub["売上"].sum() > 0 else 0,
            "送料比率": (sub["送料(店負担)"].sum() / sub["売上"].sum() * 100) if sub["売上"].sum() > 0 else 0,
        }
    return result


def wholesale_monthly_trend(orders_completed):
    """Monthly trend for individual vs assort."""
    months_set = set()
    ind_data = {}
    ass_data = {}
    for period, group in orders_completed.groupby("月"):
        key = str(period)
        months_set.add(key)
        ind = group[group["注文タイプ"] == "個別選択"]
        ass = group[group["注文タイプ"] == "アソート"]
        ind_data[key] = {"売上": ind["売上"].sum(), "利益": ind["利益"].sum(), "件数": len(ind)}
        ass_data[key] = {"売上": ass["売上"].sum(), "利益": ass["利益"].sum(), "件数": len(ass)}
    months = sorted(months_set)
    return months, ind_data, ass_data


def generate_advice(mercari_sold, orders_completed, inventory, returned, disposed,
                     cur=None, prev=None, current_month=None, prev_month=None):
    """Generate detailed, data-driven advice items with titles and bodies."""
    advice = []  # Each item: {"title": "...", "body": "..."}

    clf = classification_performance(mercari_sold) if len(mercari_sold) > 0 else pd.DataFrame()
    ws_comp = wholesale_comparison(orders_completed) if len(orders_completed) > 0 else {}
    cats = category_analysis(mercari_sold, top_n=8) if len(mercari_sold) > 0 else pd.DataFrame()

    # ── 1. 区分コード別の赤字リスク分析 ──
    if len(clf) > 0:
        high_risk = clf[(clf["件数"] >= 5) & (clf["赤字率"] > 10)]
        if len(high_risk) > 0:
            lines = []
            for _, r in high_risk.iterrows():
                lines.append(f"<b>{r['区分コード']}ランク</b>: 赤字率{r['赤字率']:.1f}%"
                             f"（{int(r['赤字件数'])}/{int(r['件数'])}件）、平均販売価格{fmt_yen(r['平均販売価格'])}")
            best = clf[clf["件数"] >= 30].sort_values("赤字率").head(1)
            best_note = ""
            if len(best) > 0:
                b = best.iloc[0]
                best_note = (f" 一方、<b>{b['区分コード']}ランク</b>は{int(b['件数'])}件で赤字率{b['赤字率']:.1f}%と最も安定しており、"
                             f"仕入れ基準のモデルケースです。")
            advice.append({
                "title": "赤字率の高い区分コードへの対策",
                "body": ("・".join(lines) + "。<br>"
                         f"高単価ランクは仕入れ値が高いためハズレ時の損失が大きい。"
                         f"販売価格を仕入れ値の2倍以上に設定できないものは仕入れ時点でスキップするか、"
                         f"卸売の個別選択に回して原価¥0で利益確定する方が効率的です。{best_note}")
            })

        # 利益の大黒柱
        top2 = clf.sort_values("合計利益", ascending=False).head(2)
        if len(top2) >= 2:
            t1, t2 = top2.iloc[0], top2.iloc[1]
            total_merc_profit = mercari_sold["利益"].sum()
            share = (t1["合計利益"] + t2["合計利益"]) / total_merc_profit * 100 if total_merc_profit > 0 else 0
            advice.append({
                "title": f"{t1['区分コード']}・{t2['区分コード']}ランクが利益の大黒柱",
                "body": (f"<b>{t1['区分コード']}</b>: {int(t1['件数'])}件 × {fmt_yen(t1['平均利益'])} = {fmt_yen(t1['合計利益'])}（赤字率{t1['赤字率']:.1f}%）<br>"
                         f"<b>{t2['区分コード']}</b>: {int(t2['件数'])}件 × {fmt_yen(t2['平均利益'])} = {fmt_yen(t2['合計利益'])}（赤字率{t2['赤字率']:.1f}%）<br>"
                         f"合計でメルカリ利益の<b>{share:.1f}%</b>を占めます。"
                         f"この2区分の仕入れ量を維持・拡大することが最も確実な利益確保策です。")
            })

    # ── 2. 卸売 個別選択の拡大戦略 ──
    ws_ind = ws_comp.get("個別選択", {})
    ws_ass = ws_comp.get("アソート", {})
    if ws_ind.get("件数", 0) > 0 and ws_ass.get("件数", 0) > 0:
        ind_rate = ws_ind.get("利益率", 0)
        ass_rate = ws_ass.get("利益率", 0)
        ind_avg = ws_ind["売上"] / ws_ind["件数"] if ws_ind["件数"] > 0 else 0
        ass_avg = ws_ass["売上"] / ws_ass["件数"] if ws_ass["件数"] > 0 else 0
        ass_ship_per = ws_ass["送料_店負担"] / ws_ass["件数"] if ws_ass["件数"] > 0 else 0
        ind_ship_per = ws_ind["送料_店負担"] / ws_ind["件数"] if ws_ind["件数"] > 0 else 0
        advice.append({
            "title": "個別選択の拡大が最優先戦略",
            "body": (f"個別選択の利益率<b>{ind_rate:.1f}%</b>は全チャネルで最高。"
                     f"1件あたり送料{fmt_yen(ind_ship_per)}に対し、アソートは{fmt_yen(ass_ship_per)}と"
                     f"<b>{fmt_yen(ass_ship_per - ind_ship_per)}の差</b>があります。<br>"
                     f"撮影・採寸データが充実するほど「自分で選びたい」顧客が増え、高粗利の個別選択比率が上がります。"
                     f"補助金申請の「販路開拓」要件にも直結するストーリーです。")
        })

    # ── 3. アソートの送料構造改善 ──
    if ws_ass.get("送料比率", 0) > 30:
        ass_ship_ratio = ws_ass["送料比率"]
        ass_ship_total = ws_ass["送料_店負担"]
        ass_count = ws_ass["件数"]
        advice.append({
            "title": "アソートの送料構造を改善",
            "body": (f"アソートの送料比率<b>{ass_ship_ratio:.1f}%</b>（{fmt_yen(ass_ship_total)}/{ass_count}件、"
                     f"1件あたり{fmt_yen(ass_ship_total / ass_count if ass_count > 0 else 0)}）は利益を圧迫しています。<br>"
                     f"特に少量注文（¥500〜¥3,300）は送料に食われます。"
                     f"最低注文額を¥5,000に引き上げるか、リピーターに個別選択への誘導を図ることで全体の収益効率が上がります。"
                     f"アソートは利益率{ass_rate:.1f}%で黒字ですが、集客チャネルとしての位置づけに留め、"
                     f"利益は個別選択で稼ぐ構造にシフトすべきです。")
        })

    # ── 4. カテゴリ別の深掘り ──
    if len(cats) >= 3:
        best_cat = cats.iloc[0]
        # 隠れた高利益カテゴリを探す（件数は少ないが平均利益が高い）
        niche = cats[(cats["件数"] >= 5) & (cats["件数"] <= 30)].sort_values("平均利益", ascending=False)
        niche_note = ""
        if len(niche) > 0:
            n = niche.iloc[0]
            niche_note = (f"<br>隠れた高利益カテゴリとして<b>「{n['カテゴリ2']}」</b>"
                          f"（{int(n['件数'])}件、平均利益{fmt_yen(n['平均利益'])}）が注目。"
                          f"{best_cat['カテゴリ2']}の平均利益{fmt_yen(best_cat['平均利益'])}の"
                          f"<b>{n['平均利益'] / best_cat['平均利益']:.1f}倍</b>。ニッチで競合が少ない可能性があります。")
        # 低利益カテゴリ
        worst_cat = cats.sort_values("平均利益").head(1).iloc[0]
        advice.append({
            "title": "カテゴリ別の仕入れ最適化",
            "body": (f"<b>「{best_cat['カテゴリ2']}」</b>が利益{fmt_yen(best_cat['合計利益'])}"
                     f"（{int(best_cat['件数'])}件）で最も好調。同カテゴリの仕入れ強化を推奨します。"
                     f"{niche_note}<br>"
                     f"一方<b>「{worst_cat['カテゴリ2']}」</b>は平均利益{fmt_yen(worst_cat['平均利益'])}と最低ライン。"
                     f"ブランド別に利益を分析し、利益の出るブランドに絞ることで改善可能です。")
        })

    # ── 5. 在庫の滞留対策 ──
    if len(inventory) > 0 and "在庫日数" in inventory.columns:
        old90 = inventory[inventory["在庫日数"] > 90]
        old60 = inventory[(inventory["在庫日数"] > 60) & (inventory["在庫日数"] <= 90)]
        new14 = inventory[inventory["在庫日数"] <= 14]
        inv_total = len(inventory)
        if len(old90) > 0:
            old90_cost = old90["仕入れ値"].sum()
            potential_rev = len(old90) * 500  # 1点500円で卸売想定
            advice.append({
                "title": f"90日超の滞留在庫{len(old90)}点の処理プラン",
                "body": (f"仕入れ額{fmt_yen(old90_cost)}が滞留中。"
                         f"卸売の個別選択に出品すれば原価¥0計算で1点¥500でも{fmt_yen(potential_rev)}の売上になります。"
                         f"送料・手数料差し引いても<b>{fmt_yen(potential_rev * 0.7)}以上の利益回収</b>が見込めます。<br>"
                         f"61-90日の{len(old60)}点には60日超で10-20%値下げルールを設定し、"
                         f"75日超で卸売行きの自動判定を入れると在庫回転率が改善します。<br>"
                         f"0-14日在庫{len(new14)}点（{len(new14)/inv_total*100:.0f}%）は健全で、出品サイクルは回っています。")
            })

    # ── 6. メルカリの月次トレンド警告（前月比ベース） ──
    if cur and prev and prev_month:
        merc_change = ((cur["merc_profit"] - prev["merc_profit"]) / abs(prev["merc_profit"]) * 100) if prev["merc_profit"] != 0 else 0
        ws_change = ((cur["ws_profit"] - prev["ws_profit"]) / abs(prev["ws_profit"]) * 100) if prev["ws_profit"] != 0 else 0
        total_cur = cur["merc_profit"] + cur["ws_profit"]
        total_prev = prev["merc_profit"] + prev["ws_profit"]
        total_change = ((total_cur - total_prev) / abs(total_prev) * 100) if total_prev != 0 else 0

        # メルカリが前月比で下落している場合
        if merc_change < -10:
            ws_offset = ""
            if cur["ws_profit"] > 0:
                ws_offset = (f"ただし卸売が{fmt_yen(cur['ws_profit'])}（前月比{ws_change:+.0f}%）で"
                             f"{'カバー' if total_change >= -5 else '一部補填'}しており、"
                             f"合計利益は{fmt_yen(total_cur)}（前月比{total_change:+.1f}%）です。")
            advice.append({
                "title": f"メルカリが前月比{merc_change:.0f}% — 要注意",
                "body": (f"メルカリ利益: {fmt_yen(prev['merc_profit'])}（{prev_month}）→ {fmt_yen(cur['merc_profit'])}（{current_month}）、"
                         f"件数も{prev['merc_count']}件→{cur['merc_count']}件に減少。<br>"
                         f"{ws_offset}<br>"
                         f"出品中在庫の価格見直し（特に90日超の商品）と、"
                         f"季節需要を見越した出品戦略の見直しが必要です。")
            })
        elif merc_change > 10:
            advice.append({
                "title": f"メルカリが前月比+{merc_change:.0f}%で好調",
                "body": (f"メルカリ利益: {fmt_yen(prev['merc_profit'])}（{prev_month}）→ {fmt_yen(cur['merc_profit'])}（{current_month}）、"
                         f"件数も{prev['merc_count']}件→{cur['merc_count']}件。<br>"
                         f"好調な要因（季節性・価格帯・カテゴリ）を分析し、来月も維持できる施策を検討してください。")
            })
    elif len(mercari_sold) > 0:
        # fallback: 前月データがない場合はピーク比較
        monthly = mercari_sold.groupby("月").agg(
            件数=("利益", "size"), 売上=("販売価格", "sum"), 利益=("利益", "sum")
        ).reset_index()
        monthly["月str"] = monthly["月"].astype(str)
        monthly = monthly.sort_values("月str")
        if len(monthly) >= 3:
            peak = monthly.loc[monthly["利益"].idxmax()]
            latest = monthly.iloc[-1]
            if latest["利益"] < peak["利益"] * 0.7:
                decline = (1 - latest["利益"] / peak["利益"]) * 100
                advice.append({
                    "title": "メルカリ利益の減速に要注意",
                    "body": (f"ピーク月（{peak['月str']}）から直近は<b>{decline:.0f}%減</b>。"
                             f"価格見直しと季節商品の出品強化が必要です。")
                })

    # ── 7. 返品の実態分析 ──
    if len(returned) > 0:
        ret_cost = returned["仕入れ値"].sum()
        total_products = len(mercari_sold) + len(returned) + len(disposed) + len(inventory)
        ret_rate = len(returned) / total_products * 100 if total_products > 0 else 0
        advice.append({
            "title": f"返品{len(returned)}件の実態を確認すべき",
            "body": (f"返品{len(returned)}件（仕入れ額{fmt_yen(ret_cost)}、全商品の{ret_rate:.1f}%）が発生。<br>"
                     f"これが<b>仕入れ先への返品</b>（仕入れロットの中で使えない商品を返した）なのか、"
                     f"<b>顧客からの返品</b>なのかで対策が全く異なります。<br>"
                     f"仕入れ先返品の場合は仕入れ単価の交渉材料（「{ret_rate:.0f}%は使えない」）になります。"
                     f"顧客返品の場合は商品説明・写真の品質改善とサイズ表記の明確化が急務です。")
        })

    # ── 8. 補助金申請の数字根拠 ──
    if len(mercari_sold) > 0 and len(orders_completed) > 0:
        total_rev = mercari_sold["販売価格"].sum() + orders_completed["売上"].sum()
        total_prof = mercari_sold["利益"].sum() + orders_completed["利益"].sum()
        total_rate = total_prof / total_rev * 100 if total_rev > 0 else 0
        ws_total_profit = orders_completed["利益"].sum()
        ws_ind_rate = ws_ind.get("利益率", 0)
        advice.append({
            "title": "補助金申請に使える数字根拠",
            "body": (f"「総売上{fmt_yen(total_rev)}・利益率{total_rate:.1f}%・"
                     f"卸売サイト開始3ヶ月で利益{fmt_yen(ws_total_profit)}」は事業成長性を示す強い材料です。<br>"
                     f"特に「卸売の個別選択（利益率{ws_ind_rate:.1f}%）を撮影データ付き商品パッケージで伸ばす」"
                     f"というストーリーは、補助金の「販路開拓」要件に直結します。"
                     f"在庫{len(inventory)}点の撮影・採寸データ整備が投資対象として説明しやすい構造です。")
        })

    return advice


# ──────────────────────────────────────────────
# HTML generation
# ──────────────────────────────────────────────
def mom_change_html(current, previous, is_pct=False):
    """Generate month-over-month change badge HTML."""
    if previous == 0:
        if current > 0:
            return '<span style="color:var(--accent-green);font-size:0.8em;margin-left:6px;">NEW</span>'
        return ''
    change = ((current - previous) / abs(previous)) * 100
    if is_pct:
        diff = current - previous
        sign = "+" if diff >= 0 else ""
        color = "var(--accent-green)" if diff >= 0 else "var(--accent-red)"
        return f'<span style="color:{color};font-size:0.8em;margin-left:6px;">{sign}{diff:.1f}pt</span>'
    sign = "+" if change >= 0 else ""
    color = "var(--accent-green)" if change >= 0 else "var(--accent-red)"
    return f'<span style="color:{color};font-size:0.8em;margin-left:6px;">{sign}{change:.1f}%</span>'


def monthly_channel_stats(mercari_sold, orders_completed, target_month):
    """Get stats for a specific month."""
    m_month = mercari_sold[mercari_sold["月"].astype(str) == target_month] if len(mercari_sold) > 0 else pd.DataFrame()
    w_month = orders_completed[orders_completed["月"].astype(str) == target_month] if len(orders_completed) > 0 else pd.DataFrame()
    return {
        "merc_count": len(m_month),
        "merc_revenue": m_month["販売価格"].sum() if len(m_month) > 0 else 0,
        "merc_profit": m_month["利益"].sum() if len(m_month) > 0 else 0,
        "ws_count": len(w_month),
        "ws_revenue": w_month["売上"].sum() if len(w_month) > 0 else 0,
        "ws_profit": w_month["利益"].sum() if len(w_month) > 0 else 0,
        "ws_ind_count": len(w_month[w_month["注文タイプ"] == "個別選択"]) if len(w_month) > 0 else 0,
        "ws_ind_profit": w_month[w_month["注文タイプ"] == "個別選択"]["利益"].sum() if len(w_month) > 0 else 0,
        "ws_ass_count": len(w_month[w_month["注文タイプ"] == "アソート"]) if len(w_month) > 0 else 0,
        "ws_ass_profit": w_month[w_month["注文タイプ"] == "アソート"]["利益"].sum() if len(w_month) > 0 else 0,
    }


def generate_html(
    mercari_sold, orders_completed, orders_all, inventory,
    returned, disposed, product_df
):
    """Generate complete HTML report."""

    # ── Determine current/previous months ──
    all_months = set()
    if len(mercari_sold) > 0:
        all_months.update(mercari_sold["月"].dropna().astype(str).unique())
    if len(orders_completed) > 0:
        all_months.update(orders_completed["月"].dropna().astype(str).unique())
    sorted_months = sorted(all_months)
    current_month = sorted_months[-1] if sorted_months else REPORT_MONTH[:7]
    prev_month = sorted_months[-2] if len(sorted_months) >= 2 else None

    cur = monthly_channel_stats(mercari_sold, orders_completed, current_month)
    prev = monthly_channel_stats(mercari_sold, orders_completed, prev_month) if prev_month else None

    cur_total_rev = cur["merc_revenue"] + cur["ws_revenue"]
    cur_total_prof = cur["merc_profit"] + cur["ws_profit"]
    cur_total_rate = (cur_total_prof / cur_total_rev * 100) if cur_total_rev > 0 else 0
    prev_total_rev = (prev["merc_revenue"] + prev["ws_revenue"]) if prev else 0
    prev_total_prof = (prev["merc_profit"] + prev["ws_profit"]) if prev else 0
    prev_total_rate = (prev_total_prof / prev_total_rev * 100) if prev and prev_total_rev > 0 else 0

    # ── Compute all metrics ──
    # All-channel summary (cumulative)
    merc_revenue = mercari_sold["販売価格"].sum() if len(mercari_sold) > 0 else 0
    merc_profit = mercari_sold["利益"].sum() if len(mercari_sold) > 0 else 0
    merc_count = len(mercari_sold)

    ws_completed = orders_completed
    ws_revenue = ws_completed["売上"].sum() if len(ws_completed) > 0 else 0
    ws_profit = ws_completed["利益"].sum() if len(ws_completed) > 0 else 0
    ws_count = len(ws_completed)

    total_revenue = merc_revenue + ws_revenue
    total_profit = merc_profit + ws_profit
    total_rate = (total_profit / total_revenue * 100) if total_revenue > 0 else 0

    pipeline_count = len(orders_all[orders_all["ステータス"] == "依頼中"]) if "ステータス" in orders_all.columns else 0

    # Monthly trend
    mdata = monthly_profit_data(mercari_sold, ws_completed)

    # Wholesale comparison
    ws_comp = wholesale_comparison(ws_completed)
    ws_months, ws_ind_trend, ws_ass_trend = wholesale_monthly_trend(ws_completed)

    # Classification
    clf = classification_performance(mercari_sold)

    # Category
    cats = category_analysis(mercari_sold)

    # Inventory
    inv_count = len(inventory)
    inv_purchase = inventory["仕入れ値"].sum() if len(inventory) > 0 else 0
    age_dist = inventory_age_distribution(inventory)

    # Inventory classification composition
    inv_clf = {}
    if len(inventory) > 0 and "区分コード" in inventory.columns:
        inv_clf = inventory.groupby("区分コード").size().sort_values(ascending=False).head(8).to_dict()

    # Losses
    ret_count = len(returned)
    ret_cost = returned["仕入れ値"].sum() if len(returned) > 0 else 0
    dis_count = len(disposed)
    dis_cost = disposed["仕入れ値"].sum() if len(disposed) > 0 else 0

    # Advice (with MoM context)
    advice = generate_advice(mercari_sold, ws_completed, inventory, returned, disposed,
                             cur=cur, prev=prev, current_month=current_month, prev_month=prev_month)

    # ── Build JSON data for charts ──
    chart_data = {
        "monthlyTrend": mdata,
        "wsMonths": ws_months,
        "wsIndRevenue": [ws_ind_trend.get(m, {}).get("売上", 0) for m in ws_months],
        "wsIndProfit": [ws_ind_trend.get(m, {}).get("利益", 0) for m in ws_months],
        "wsAssRevenue": [ws_ass_trend.get(m, {}).get("売上", 0) for m in ws_months],
        "wsAssProfit": [ws_ass_trend.get(m, {}).get("利益", 0) for m in ws_months],
        "clfLabels": clf["区分コード"].tolist() if len(clf) > 0 else [],
        "clfCount": clf["件数"].tolist() if len(clf) > 0 else [],
        "clfAvgProfit": [round(x, 0) for x in clf["平均利益"].tolist()] if len(clf) > 0 else [],
        "clfLossRate": clf["赤字率"].tolist() if len(clf) > 0 else [],
        "catLabels": cats["カテゴリ2"].tolist() if len(cats) > 0 else [],
        "catProfit": [round(x, 0) for x in cats["合計利益"].tolist()] if len(cats) > 0 else [],
        "catAvgProfit": [round(x, 0) for x in cats["平均利益"].tolist()] if len(cats) > 0 else [],
        "catCount": cats["件数"].tolist() if len(cats) > 0 else [],
        "ageDist": age_dist,
        "invClf": inv_clf,
    }

    # ── Classification table rows ──
    clf_rows = ""
    if len(clf) > 0:
        for _, r in clf.iterrows():
            clf_rows += f"""<tr>
                <td>{r['区分コード']}</td>
                <td>{int(r['件数'])}</td>
                <td>{fmt_yen(r['平均販売価格'])}</td>
                <td>{fmt_yen(r['平均利益'])}</td>
                <td>{fmt_yen(r['合計利益'])}</td>
                <td>{r['赤字率']:.1f}%</td>
            </tr>"""

    # ── Category table rows ──
    cat_rows = ""
    if len(cats) > 0:
        for _, r in cats.iterrows():
            cat_rows += f"""<tr>
                <td>{r['カテゴリ2']}</td>
                <td>{int(r['件数'])}</td>
                <td>{fmt_yen(r['合計利益'])}</td>
                <td>{fmt_yen(r['平均利益'])}</td>
            </tr>"""

    # ── Advice items ──
    advice_html = ""
    for i, a in enumerate(advice, 1):
        if isinstance(a, dict):
            advice_html += (f'<div class="advice-item"><span class="advice-num">{i}</span>'
                            f'<div><div class="advice-title">{a["title"]}</div>'
                            f'<p>{a["body"]}</p></div></div>\n')
        else:
            advice_html += f'<div class="advice-item"><span class="advice-num">{i}</span><p>{a}</p></div>\n'

    # ── Wholesale comparison table ──
    ws_ind = ws_comp.get("個別選択", {})
    ws_ass = ws_comp.get("アソート", {})

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>月次分析レポート - {REPORT_MONTH}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
:root {{
    --bg-primary: #0f0f1a;
    --bg-secondary: #1a1a2e;
    --bg-card: #16213e;
    --bg-card-alt: #1a1a3e;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0b0;
    --text-muted: #707088;
    --accent-blue: #4fc3f7;
    --accent-green: #66bb6a;
    --accent-orange: #ffa726;
    --accent-red: #ef5350;
    --accent-purple: #ab47bc;
    --accent-teal: #26a69a;
    --border-color: #2a2a4a;
    --shadow: 0 4px 20px rgba(0,0,0,0.3);
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    padding: 20px;
}}
.container {{ max-width: 1200px; margin: 0 auto; }}
.header {{
    text-align: center;
    padding: 40px 20px;
    margin-bottom: 30px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-radius: 16px;
    border: 1px solid var(--border-color);
}}
.header h1 {{
    font-size: 2em;
    background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
}}
.header .subtitle {{ color: var(--text-secondary); font-size: 1.1em; }}
.section {{
    background: var(--bg-card);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow);
}}
.section h2 {{
    font-size: 1.3em;
    color: var(--accent-blue);
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 8px;
}}
.section h2 .icon {{ font-size: 1.2em; }}
.kpi-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
}}
.kpi-card {{
    background: var(--bg-secondary);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    border: 1px solid var(--border-color);
    transition: transform 0.2s;
}}
.kpi-card:hover {{ transform: translateY(-2px); }}
.kpi-card .label {{ color: var(--text-secondary); font-size: 0.85em; margin-bottom: 4px; }}
.kpi-card .value {{ font-size: 1.6em; font-weight: 700; }}
.kpi-card .value.blue {{ color: var(--accent-blue); }}
.kpi-card .value.green {{ color: var(--accent-green); }}
.kpi-card .value.orange {{ color: var(--accent-orange); }}
.kpi-card .value.red {{ color: var(--accent-red); }}
.kpi-card .value.purple {{ color: var(--accent-purple); }}
.kpi-card .value.teal {{ color: var(--accent-teal); }}
.kpi-card .sub {{ color: var(--text-muted); font-size: 0.8em; margin-top: 4px; }}
.breakdown {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-top: 16px;
}}
.breakdown-card {{
    background: var(--bg-secondary);
    border-radius: 10px;
    padding: 20px;
    border-left: 4px solid var(--accent-blue);
}}
.breakdown-card.wholesale {{ border-left-color: var(--accent-orange); }}
.breakdown-card.pipeline {{ border-left-color: var(--accent-purple); }}
.breakdown-card h3 {{ font-size: 1em; margin-bottom: 12px; color: var(--text-primary); }}
.breakdown-card .stat {{ display: flex; justify-content: space-between; padding: 4px 0; }}
.breakdown-card .stat .lbl {{ color: var(--text-secondary); }}
.chart-container {{ position: relative; height: 350px; margin: 20px 0; }}
.chart-container.small {{ height: 280px; }}
table {{
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
}}
table th, table td {{
    padding: 10px 14px;
    text-align: right;
    border-bottom: 1px solid var(--border-color);
}}
table th {{
    background: var(--bg-secondary);
    color: var(--accent-blue);
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}
table th:first-child, table td:first-child {{ text-align: left; }}
table tr:hover {{ background: rgba(79, 195, 247, 0.05); }}
.advice-item {{
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 10px;
    margin-bottom: 12px;
    border: 1px solid var(--border-color);
}}
.advice-num {{
    background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
    color: #fff;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.9em;
    flex-shrink: 0;
}}
.advice-title {{ font-weight: 700; font-size: 1.05em; color: var(--accent-blue); margin-bottom: 8px; }}
.advice-item p {{ color: var(--text-secondary); line-height: 1.7; font-size: 0.92em; }}
.advice-item b {{ color: var(--text-primary); }}
.two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
@media (max-width: 768px) {{
    .two-col {{ grid-template-columns: 1fr; }}
    .kpi-grid {{ grid-template-columns: repeat(2, 1fr); }}
    .breakdown {{ grid-template-columns: 1fr; }}
    .header h1 {{ font-size: 1.5em; }}
}}
.ws-table {{ overflow-x: auto; }}
.ws-table table {{ min-width: 600px; }}
.loss-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
@media (max-width: 600px) {{ .loss-grid {{ grid-template-columns: 1fr; }} }}
.loss-card {{
    background: var(--bg-secondary);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    border: 1px solid var(--border-color);
}}
.loss-card .loss-label {{ color: var(--text-secondary); margin-bottom: 6px; }}
.loss-card .loss-count {{ font-size: 2em; font-weight: 700; color: var(--accent-red); }}
.loss-card .loss-amount {{ color: var(--text-muted); margin-top: 4px; }}
.footer {{
    text-align: center;
    color: var(--text-muted);
    padding: 30px;
    font-size: 0.85em;
}}
</style>
</head>
<body>
<div class="container">

<!-- Header -->
<div class="header">
    <h1>月次分析レポート</h1>
    <div class="subtitle">{REPORT_MONTH} | Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
</div>

<!-- Section 1: All-channel Summary -->
<div class="section">
    <h2><span class="icon">&#x1f4ca;</span> 当月サマリー（{current_month}）</h2>
    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="label">当月売上</div>
            <div class="value blue">{fmt_yen(cur_total_rev)}{mom_change_html(cur_total_rev, prev_total_rev) if prev else ''}</div>
            <div class="sub">{cur['merc_count'] + cur['ws_count']}件</div>
        </div>
        <div class="kpi-card">
            <div class="label">当月利益</div>
            <div class="value green">{fmt_yen(cur_total_prof)}{mom_change_html(cur_total_prof, prev_total_prof) if prev else ''}</div>
        </div>
        <div class="kpi-card">
            <div class="label">当月利益率</div>
            <div class="value orange">{fmt_pct(cur_total_rate)}{mom_change_html(cur_total_rate, prev_total_rate, is_pct=True) if prev else ''}</div>
        </div>
        <div class="kpi-card">
            <div class="label">パイプライン（依頼中）</div>
            <div class="value purple">{pipeline_count}件</div>
        </div>
    </div>
    {'<div style="margin-bottom:20px;"><h3 style="color:var(--text-secondary);font-size:0.95em;margin-bottom:12px;">前月比較（' + prev_month + ' → ' + current_month + '）</h3><div class="ws-table"><table><thead><tr><th>指標</th><th>' + prev_month + '</th><th>' + current_month + '</th><th>増減</th></tr></thead><tbody><tr><td>総売上</td><td>' + fmt_yen(prev_total_rev) + '</td><td>' + fmt_yen(cur_total_rev) + '</td><td>' + mom_change_html(cur_total_rev, prev_total_rev) + '</td></tr><tr><td>総利益</td><td>' + fmt_yen(prev_total_prof) + '</td><td>' + fmt_yen(cur_total_prof) + '</td><td>' + mom_change_html(cur_total_prof, prev_total_prof) + '</td></tr><tr><td>メルカリ件数</td><td>' + str(prev["merc_count"]) + '件</td><td>' + str(cur["merc_count"]) + '件</td><td>' + mom_change_html(cur["merc_count"], prev["merc_count"]) + '</td></tr><tr><td>メルカリ利益</td><td>' + fmt_yen(prev["merc_profit"]) + '</td><td>' + fmt_yen(cur["merc_profit"]) + '</td><td>' + mom_change_html(cur["merc_profit"], prev["merc_profit"]) + '</td></tr><tr><td>卸売件数</td><td>' + str(prev["ws_count"]) + '件</td><td>' + str(cur["ws_count"]) + '件</td><td>' + mom_change_html(cur["ws_count"], prev["ws_count"]) + '</td></tr><tr><td>卸売利益</td><td>' + fmt_yen(prev["ws_profit"]) + '</td><td>' + fmt_yen(cur["ws_profit"]) + '</td><td>' + mom_change_html(cur["ws_profit"], prev["ws_profit"]) + '</td></tr><tr><td>卸売（個別選択）</td><td>' + str(prev["ws_ind_count"]) + '件 / ' + fmt_yen(prev["ws_ind_profit"]) + '</td><td>' + str(cur["ws_ind_count"]) + '件 / ' + fmt_yen(cur["ws_ind_profit"]) + '</td><td>' + mom_change_html(cur["ws_ind_profit"], prev["ws_ind_profit"]) + '</td></tr><tr><td>卸売（アソート）</td><td>' + str(prev["ws_ass_count"]) + '件 / ' + fmt_yen(prev["ws_ass_profit"]) + '</td><td>' + str(cur["ws_ass_count"]) + '件 / ' + fmt_yen(cur["ws_ass_profit"]) + '</td><td>' + mom_change_html(cur["ws_ass_profit"], prev["ws_ass_profit"]) + '</td></tr></tbody></table></div></div>' if prev else ''}
    <div style="margin-top:12px;"><h3 style="color:var(--text-secondary);font-size:0.95em;margin-bottom:12px;">累計実績</h3></div>
    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="label">累計売上</div>
            <div class="value blue">{fmt_yen(total_revenue)}</div>
            <div class="sub">{merc_count + ws_count}件</div>
        </div>
        <div class="kpi-card">
            <div class="label">累計利益</div>
            <div class="value green">{fmt_yen(total_profit)}</div>
        </div>
        <div class="kpi-card">
            <div class="label">累計利益率</div>
            <div class="value orange">{fmt_pct(total_rate)}</div>
        </div>
        <div class="kpi-card">
            <div class="label">月平均利益</div>
            <div class="value teal">{fmt_yen(total_profit / len(sorted_months)) if len(sorted_months) > 0 else '¥0'}</div>
            <div class="sub">{len(sorted_months)}ヶ月間</div>
        </div>
    </div>
    <div class="breakdown">
        <div class="breakdown-card">
            <h3>メルカリ / ラクマ（累計）</h3>
            <div class="stat"><span class="lbl">件数</span><span>{merc_count}件</span></div>
            <div class="stat"><span class="lbl">売上</span><span>{fmt_yen(merc_revenue)}</span></div>
            <div class="stat"><span class="lbl">利益</span><span>{fmt_yen(merc_profit)}</span></div>
            <div class="stat"><span class="lbl">利益率</span><span>{fmt_pct(merc_profit / merc_revenue * 100 if merc_revenue > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">平均単価</span><span>{fmt_yen(merc_revenue / merc_count if merc_count > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">平均利益/件</span><span>{fmt_yen(merc_profit / merc_count if merc_count > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">売上構成比</span><span>{fmt_pct(merc_revenue / total_revenue * 100 if total_revenue > 0 else 0)}</span></div>
        </div>
        <div class="breakdown-card wholesale">
            <h3>卸売（デタウリ）（累計）</h3>
            <div class="stat"><span class="lbl">件数</span><span>{ws_count}件</span></div>
            <div class="stat"><span class="lbl">売上</span><span>{fmt_yen(ws_revenue)}</span></div>
            <div class="stat"><span class="lbl">利益</span><span>{fmt_yen(ws_profit)}</span></div>
            <div class="stat"><span class="lbl">利益率</span><span>{fmt_pct(ws_profit / ws_revenue * 100 if ws_revenue > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">平均単価</span><span>{fmt_yen(ws_revenue / ws_count if ws_count > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">平均利益/件</span><span>{fmt_yen(ws_profit / ws_count if ws_count > 0 else 0)}</span></div>
            <div class="stat"><span class="lbl">売上構成比</span><span>{fmt_pct(ws_revenue / total_revenue * 100 if total_revenue > 0 else 0)}</span></div>
        </div>
        <div class="breakdown-card pipeline">
            <h3>パイプライン</h3>
            <div class="stat"><span class="lbl">依頼中</span><span>{pipeline_count}件</span></div>
        </div>
    </div>
</div>

<!-- Section 2: Monthly Profit Trend -->
<div class="section">
    <h2><span class="icon">&#x1f4c8;</span> 月次利益推移</h2>
    <div class="chart-container">
        <canvas id="monthlyTrendChart"></canvas>
    </div>
</div>

<!-- Section 3: Wholesale Individual vs Assort -->
<div class="section">
    <h2><span class="icon">&#x1f4e6;</span> 卸売：個別選択 vs アソート</h2>
    <div class="ws-table">
        <table>
            <thead>
                <tr>
                    <th>指標</th>
                    <th>個別選択</th>
                    <th>アソート</th>
                </tr>
            </thead>
            <tbody>
                <tr><td>件数</td><td>{ws_ind.get('件数', 0)}件</td><td>{ws_ass.get('件数', 0)}件</td></tr>
                <tr><td>売上</td><td>{fmt_yen(ws_ind.get('売上', 0))}</td><td>{fmt_yen(ws_ass.get('売上', 0))}</td></tr>
                <tr><td>送料（店負担）</td><td>{fmt_yen(ws_ind.get('送料_店負担', 0))}</td><td>{fmt_yen(ws_ass.get('送料_店負担', 0))}</td></tr>
                <tr><td>作業報酬</td><td>{fmt_yen(ws_ind.get('作業報酬', 0))}</td><td>{fmt_yen(ws_ass.get('作業報酬', 0))}</td></tr>
                <tr><td>決済手数料</td><td>{fmt_yen(ws_ind.get('決済手数料', 0))}</td><td>{fmt_yen(ws_ass.get('決済手数料', 0))}</td></tr>
                <tr><td>利益</td><td>{fmt_yen(ws_ind.get('利益', 0))}</td><td>{fmt_yen(ws_ass.get('利益', 0))}</td></tr>
                <tr><td>利益率</td><td>{fmt_pct(ws_ind.get('利益率', 0))}</td><td>{fmt_pct(ws_ass.get('利益率', 0))}</td></tr>
                <tr><td>送料比率</td><td>{fmt_pct(ws_ind.get('送料比率', 0))}</td><td>{fmt_pct(ws_ass.get('送料比率', 0))}</td></tr>
            </tbody>
        </table>
    </div>
    <div class="chart-container" style="margin-top:24px;">
        <canvas id="wsTrendChart"></canvas>
    </div>
</div>

<!-- Section 4: Classification Performance -->
<div class="section">
    <h2><span class="icon">&#x1f3af;</span> 区分コード別パフォーマンス（メルカリ）</h2>
    <div class="chart-container">
        <canvas id="clfChart"></canvas>
    </div>
    <table>
        <thead>
            <tr>
                <th>区分コード</th>
                <th>件数</th>
                <th>平均販売価格</th>
                <th>平均利益</th>
                <th>合計利益</th>
                <th>赤字率</th>
            </tr>
        </thead>
        <tbody>
            {clf_rows}
        </tbody>
    </table>
</div>

<!-- Section 5: Category Analysis -->
<div class="section">
    <h2><span class="icon">&#x1f3f7;&#xfe0f;</span> カテゴリ分析（トップ8 カテゴリ2）</h2>
    <table>
        <thead>
            <tr>
                <th>カテゴリ</th>
                <th>件数</th>
                <th>合計利益</th>
                <th>平均利益</th>
            </tr>
        </thead>
        <tbody>
            {cat_rows}
        </tbody>
    </table>
</div>

<!-- Section 6: Inventory Analysis -->
<div class="section">
    <h2><span class="icon">&#x1f4e6;</span> 在庫分析</h2>
    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="label">在庫点数</div>
            <div class="value blue">{inv_count:,}点</div>
        </div>
        <div class="kpi-card">
            <div class="label">仕入れ額合計</div>
            <div class="value orange">{fmt_yen(inv_purchase)}</div>
        </div>
    </div>
    <div class="two-col">
        <div>
            <h3 style="color:var(--accent-blue);margin-bottom:12px;">在庫日数分布</h3>
            <div class="chart-container small">
                <canvas id="ageChart"></canvas>
            </div>
        </div>
        <div>
            <h3 style="color:var(--accent-blue);margin-bottom:12px;">区分コード構成</h3>
            <div class="chart-container small">
                <canvas id="invClfChart"></canvas>
            </div>
        </div>
    </div>
</div>

<!-- Section 7: Losses -->
<div class="section">
    <h2><span class="icon">&#x26a0;&#xfe0f;</span> 損失（返品・廃棄）</h2>
    <div class="loss-grid">
        <div class="loss-card">
            <div class="loss-label">返品済み</div>
            <div class="loss-count">{ret_count}件</div>
            <div class="loss-amount">仕入れ額: {fmt_yen(ret_cost)}</div>
        </div>
        <div class="loss-card">
            <div class="loss-label">廃棄済み</div>
            <div class="loss-count">{dis_count}件</div>
            <div class="loss-amount">仕入れ額: {fmt_yen(dis_cost)}</div>
        </div>
    </div>
</div>

<!-- Section 8: Advice -->
<div class="section">
    <h2><span class="icon">&#x1f4a1;</span> データに基づくアドバイス</h2>
    {advice_html}
</div>

<div class="footer">
    Saisun Monthly Report | Auto-generated by monthly_report.py
</div>

</div><!-- /container -->

<script>
const DATA = {json.dumps(chart_data, ensure_ascii=False)};

// Color palette
const COLORS = {{
    blue: 'rgba(79, 195, 247, 0.8)',
    blueLight: 'rgba(79, 195, 247, 0.3)',
    green: 'rgba(102, 187, 106, 0.8)',
    orange: 'rgba(255, 167, 38, 0.8)',
    orangeLight: 'rgba(255, 167, 38, 0.3)',
    red: 'rgba(239, 83, 80, 0.8)',
    purple: 'rgba(171, 71, 188, 0.8)',
    teal: 'rgba(38, 166, 154, 0.8)',
    white: 'rgba(224, 224, 224, 1)',
}};

const defaultOptions = {{
    responsive: true,
    maintainAspectRatio: false,
    plugins: {{
        legend: {{ labels: {{ color: '#a0a0b0', font: {{ size: 12 }} }} }},
    }},
    scales: {{
        x: {{ ticks: {{ color: '#707088' }}, grid: {{ color: 'rgba(42,42,74,0.5)' }} }},
        y: {{ ticks: {{ color: '#707088', callback: v => '¥' + v.toLocaleString() }}, grid: {{ color: 'rgba(42,42,74,0.5)' }} }},
    }},
}};

// 1. Monthly Profit Trend (stacked bar + line)
new Chart(document.getElementById('monthlyTrendChart'), {{
    type: 'bar',
    data: {{
        labels: DATA.monthlyTrend.labels,
        datasets: [
            {{
                label: 'メルカリ利益',
                data: DATA.monthlyTrend.mercari,
                backgroundColor: COLORS.blue,
                stack: 'stack',
                order: 2,
            }},
            {{
                label: '卸売（個別選択）利益',
                data: DATA.monthlyTrend.ws_individual,
                backgroundColor: COLORS.orange,
                stack: 'stack',
                order: 2,
            }},
            {{
                label: '卸売（アソート）利益',
                data: DATA.monthlyTrend.ws_assort,
                backgroundColor: COLORS.teal,
                stack: 'stack',
                order: 2,
            }},
            {{
                label: '合計利益',
                data: DATA.monthlyTrend.labels.map((_, i) =>
                    DATA.monthlyTrend.mercari[i] + DATA.monthlyTrend.ws_individual[i] + DATA.monthlyTrend.ws_assort[i]
                ),
                type: 'line',
                borderColor: COLORS.white,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 4,
                pointBackgroundColor: COLORS.white,
                order: 1,
                yAxisID: 'y',
            }},
        ],
    }},
    options: {{
        ...defaultOptions,
        scales: {{
            ...defaultOptions.scales,
            x: {{ ...defaultOptions.scales.x, stacked: true }},
            y: {{ ...defaultOptions.scales.y, stacked: true }},
        }},
    }},
}});

// 2. Wholesale Trend
new Chart(document.getElementById('wsTrendChart'), {{
    type: 'bar',
    data: {{
        labels: DATA.wsMonths,
        datasets: [
            {{
                label: '個別選択 売上',
                data: DATA.wsIndRevenue,
                backgroundColor: COLORS.blue,
            }},
            {{
                label: 'アソート 売上',
                data: DATA.wsAssRevenue,
                backgroundColor: COLORS.orange,
            }},
            {{
                label: '個別選択 利益',
                data: DATA.wsIndProfit,
                type: 'line',
                borderColor: COLORS.blue,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 3,
            }},
            {{
                label: 'アソート 利益',
                data: DATA.wsAssProfit,
                type: 'line',
                borderColor: COLORS.orange,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 3,
            }},
        ],
    }},
    options: defaultOptions,
}});

// 3. Classification Chart
new Chart(document.getElementById('clfChart'), {{
    type: 'bar',
    data: {{
        labels: DATA.clfLabels,
        datasets: [
            {{
                label: '件数',
                data: DATA.clfCount,
                backgroundColor: COLORS.blue,
                yAxisID: 'y',
            }},
            {{
                label: '平均利益',
                data: DATA.clfAvgProfit,
                type: 'line',
                borderColor: COLORS.green,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 3,
                yAxisID: 'y1',
            }},
            {{
                label: '赤字率(%)',
                data: DATA.clfLossRate,
                type: 'line',
                borderColor: COLORS.red,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 3,
                borderDash: [5, 5],
                yAxisID: 'y2',
            }},
        ],
    }},
    options: {{
        ...defaultOptions,
        scales: {{
            x: {{ ticks: {{ color: '#707088' }}, grid: {{ color: 'rgba(42,42,74,0.5)' }} }},
            y: {{ position: 'left', ticks: {{ color: '#707088' }}, grid: {{ color: 'rgba(42,42,74,0.5)' }}, title: {{ display: true, text: '件数', color: '#707088' }} }},
            y1: {{ position: 'right', ticks: {{ color: '#707088', callback: v => '¥' + v.toLocaleString() }}, grid: {{ drawOnChartArea: false }}, title: {{ display: true, text: '平均利益', color: '#707088' }} }},
            y2: {{ position: 'right', ticks: {{ color: '#707088', callback: v => v + '%' }}, grid: {{ drawOnChartArea: false }}, title: {{ display: true, text: '赤字率', color: '#707088' }}, display: false }},
        }},
    }},
}});

// 4. Inventory Age Distribution (bar)
new Chart(document.getElementById('ageChart'), {{
    type: 'bar',
    data: {{
        labels: ['0-14日', '15-30日', '31-60日', '61-90日', '90日+'],
        datasets: [{{
            label: '在庫数',
            data: [DATA.ageDist['0-14'], DATA.ageDist['15-30'], DATA.ageDist['31-60'], DATA.ageDist['61-90'], DATA.ageDist['90+']],
            backgroundColor: [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, COLORS.purple],
            borderRadius: 6,
        }}],
    }},
    options: {{
        ...defaultOptions,
        plugins: {{ legend: {{ display: false }} }},
        scales: {{
            x: {{ ticks: {{ color: '#707088' }}, grid: {{ color: 'rgba(42,42,74,0.5)' }} }},
            y: {{ ticks: {{ color: '#707088' }}, grid: {{ color: 'rgba(42,42,74,0.5)' }} }},
        }},
    }},
}});

// 5. Inventory Classification Pie
const invClfLabels = Object.keys(DATA.invClf);
const invClfValues = Object.values(DATA.invClf);
const pieColors = [COLORS.blue, COLORS.orange, COLORS.green, COLORS.purple, COLORS.teal, COLORS.red, 'rgba(255,235,59,0.8)', 'rgba(121,134,203,0.8)'];
new Chart(document.getElementById('invClfChart'), {{
    type: 'doughnut',
    data: {{
        labels: invClfLabels,
        datasets: [{{ data: invClfValues, backgroundColor: pieColors.slice(0, invClfLabels.length), borderWidth: 0 }}],
    }},
    options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{
            legend: {{ position: 'right', labels: {{ color: '#a0a0b0', font: {{ size: 11 }}, padding: 8 }} }},
        }},
    }},
}});
</script>
</body>
</html>"""
    return html


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def main():
    print("=" * 60)
    print(f"  月次分析レポート生成 - {REPORT_MONTH}")
    print("=" * 60)

    # Load data
    product_df = load_product_data()
    order_df = load_order_data()

    # Analyze
    mercari_sold = analyze_mercari(product_df)
    inventory = analyze_inventory(product_df)
    returned, disposed = analyze_losses(product_df)

    # Filter completed wholesale orders
    orders_completed = order_df[order_df["ステータス"] == "完了"].copy()

    print(f"\n📊 分析結果:")
    print(f"   メルカリ売却済み: {len(mercari_sold)}件")
    print(f"   卸売完了: {len(orders_completed)}件")
    print(f"   在庫: {len(inventory)}件")
    print(f"   返品: {len(returned)}件, 廃棄: {len(disposed)}件")

    # Revenue summary
    merc_rev = mercari_sold["販売価格"].sum() if len(mercari_sold) > 0 else 0
    merc_prof = mercari_sold["利益"].sum() if len(mercari_sold) > 0 else 0
    ws_rev = orders_completed["売上"].sum() if len(orders_completed) > 0 else 0
    ws_prof = orders_completed["利益"].sum() if len(orders_completed) > 0 else 0

    print(f"\n💰 売上/利益サマリー:")
    print(f"   メルカリ: 売上{fmt_yen(merc_rev)} / 利益{fmt_yen(merc_prof)}")
    print(f"   卸売:     売上{fmt_yen(ws_rev)} / 利益{fmt_yen(ws_prof)}")
    print(f"   合計:     売上{fmt_yen(merc_rev + ws_rev)} / 利益{fmt_yen(merc_prof + ws_prof)}")

    # Pipeline
    pipeline = len(order_df[order_df["ステータス"] == "依頼中"])
    print(f"   パイプライン（依頼中）: {pipeline}件")

    # Generate HTML
    print(f"\n📝 HTMLレポート生成中...")
    html = generate_html(
        mercari_sold, orders_completed, order_df,
        inventory, returned, disposed, product_df
    )

    # Write output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"\n✅ レポート出力完了: {OUTPUT_FILE}")
    print(f"   ファイルサイズ: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")
    print("=" * 60)


if __name__ == "__main__":
    main()
