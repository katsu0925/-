#!/bin/bash
# Gemini API Key 設定スクリプト（gas-proxy用）
cd "$(dirname "$0")"

echo "=== gas-proxy Gemini API Key 設定 ==="
echo ""
read -rsp "Gemini API Key を入力してください: " KEY
echo ""

if [ -z "$KEY" ]; then
  echo "エラー: キーが空です"
  exit 1
fi

echo "$KEY" | wrangler secret put GEMINI_API_KEY --name detauri-gas-proxy 2>&1
echo ""
echo "設定確認:"
wrangler secret list --name detauri-gas-proxy 2>&1 | grep -i gemini
echo ""
echo "完了"
