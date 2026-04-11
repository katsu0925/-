#!/bin/bash
# 写メジャー デプロイスクリプト
# sw.js のキャッシュ名を自動でタイムスタンプに更新してからデプロイする

set -e
cd "$(dirname "$0")"

# sw.js のCACHE_NAMEをタイムスタンプで自動更新
TIMESTAMP=$(date +%Y%m%d%H%M%S)
sed -i '' "s/const CACHE_NAME = '.*'/const CACHE_NAME = 'shameasure-${TIMESTAMP}'/" public/sw.js
echo "sw.js CACHE_NAME → shameasure-${TIMESTAMP}"

# デプロイ
npx wrangler deploy

echo ""
echo "デプロイ完了 (shameasure-${TIMESTAMP})"
echo "version.json の更新を忘れずに！"
