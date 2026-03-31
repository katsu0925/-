#!/bin/bash
# Gemini APIキー設定スクリプト
cd "$(dirname "$0")"

echo "Gemini APIキーを貼り付けてEnterを押してください："
read -r KEY

if [ -z "$KEY" ]; then
  echo "キーが空です。中止しました。"
  exit 1
fi

echo "$KEY" | npx wrangler secret put GEMINI_API_KEY 2>&1
echo ""
echo "確認中..."
npx wrangler secret list 2>&1
