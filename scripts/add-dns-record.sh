#!/bin/bash
# wholesale.nkonline-tool.com のCNAMEレコードを追加するスクリプト
# Cloudflare API Token（DNS編集権限）が必要

ZONE_ID="21e05f22e3f12c87a1bff76a4284063a"

echo "============================================"
echo "  Cloudflare DNS レコード追加"
echo "  wholesale.nkonline-tool.com → wholesale-eco.pages.dev"
echo "============================================"
echo ""
echo "Cloudflare APIトークンが必要です。"
echo "以下の手順で作成してください："
echo ""
echo "1. https://dash.cloudflare.com/profile/api-tokens を開く"
echo "2.「トークンを作成」→「カスタムトークンを作成」"
echo "3. 権限: ゾーン > DNS > 編集"
echo "4. ゾーンリソース: 特定のゾーン > nkonline-tool.com"
echo "5.「概要に進む」→「トークンを作成」"
echo ""
read -sp "APIトークンを貼り付けてください: " API_TOKEN
echo ""

if [ -z "$API_TOKEN" ]; then
  echo "トークンが空です。中止します。"
  exit 1
fi

# トークン検証
echo "トークンを検証中..."
VERIFY=$(curl -s -H "Authorization: Bearer $API_TOKEN" "https://api.cloudflare.com/client/v4/user/tokens/verify")
if echo "$VERIFY" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "✅ トークン有効"
else
  echo "❌ トークンが無効です。権限を確認してください。"
  exit 1
fi

# CNAME レコード追加
echo "CNAMEレコードを追加中..."
RESULT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CNAME",
    "name": "wholesale",
    "content": "wholesale-eco.pages.dev",
    "proxied": true,
    "ttl": 1
  }')

if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "✅ DNSレコード追加成功！"
  echo ""
  echo "  CNAME wholesale.nkonline-tool.com → wholesale-eco.pages.dev (プロキシ済み)"
  echo ""
  echo "反映まで数分かかる場合があります。"
else
  ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errors',[{}])[0].get('message','不明'))" 2>/dev/null)
  echo "❌ 失敗: $ERROR"
fi

# トークンを変数から消去
unset API_TOKEN
