#!/bin/bash
# reCAPTCHA v3 シークレットを Cloudflare Worker (detauri-gas-proxy) に設定する対話式スクリプト
#
# 使い方:
#   cd workers/gas-proxy && ./setup-recaptcha-secret.sh
#
# 入力する値: GAS スクリプトプロパティ RECAPTCHA_SECRET と同じ値
# （GASエディタ → プロジェクトの設定 → スクリプトプロパティで確認できます）
#
# 設定すると Worker 側でも会員登録時の reCAPTCHA 検証が有効になります。
# 未設定の間は Worker 側の検証はスキップされます（GAS直接アクセス時のみ検証）。
set -e
cd "$(dirname "$0")"
echo "reCAPTCHA シークレットキーを入力してください（画面には表示されません）:"
npx wrangler secret put RECAPTCHA_SECRET
echo "設定完了。反映のため wrangler deploy は不要です（Secretは即時反映）。"
