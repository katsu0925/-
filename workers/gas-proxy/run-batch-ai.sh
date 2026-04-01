#!/bin/bash
# AI画像判定バッチ処理スクリプト
# 5件ずつ処理し、残りがなくなるまで繰り返す
# タイムアウト防止のため各バッチ間に10秒のスリープを入れる

cd "$(dirname "$0")"

# SYNC_SECRETを取得（wrangler secret listから直接は取れないので手動入力）
read -rsp "SYNC_SECRET を入力してください: " SECRET
echo ""

if [ -z "$SECRET" ]; then
  echo "エラー: SECRETが空です"
  exit 1
fi

URL="https://detauri-gas-proxy.nsdktts1030.workers.dev/batch-ai"
LIMIT=5
TOTAL_PROCESSED=0
TOTAL_ERRORS=0
BATCH=1

echo "=== AI画像判定バッチ処理開始 ==="
echo "1回あたり ${LIMIT} 件、10秒間隔で処理"
echo ""

while true; do
  echo "--- バッチ #${BATCH} ---"
  RESULT=$(curl -s "${URL}?key=${SECRET}&limit=${LIMIT}")

  # Parse result
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('processed',0))" 2>/dev/null)
  REMAINING=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remaining',0))" 2>/dev/null)
  ERRORS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errors',0))" 2>/dev/null)
  TOTAL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null)
  MSG=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null)

  if [ -n "$MSG" ] && [ "$MSG" != "" ]; then
    echo "$MSG"
    break
  fi

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))
  TOTAL_ERRORS=$((TOTAL_ERRORS + ERRORS))

  echo "処理: ${PROCESSED}件 / エラー: ${ERRORS}件 / 残り: ${REMAINING}件 / 全体: ${TOTAL}件"

  # エラー詳細表示
  if [ "$ERRORS" -gt 0 ]; then
    echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for e in d.get('errorDetails',[]):
  print(f'  ERROR: {e[\"managedId\"]}: {e[\"error\"]}')" 2>/dev/null
  fi

  if [ "$REMAINING" -eq 0 ] || [ "$REMAINING" = "0" ]; then
    echo ""
    echo "=== 全件完了 ==="
    break
  fi

  BATCH=$((BATCH + 1))
  echo "10秒待機..."
  sleep 10
done

echo ""
echo "=== 結果 ==="
echo "処理済み: ${TOTAL_PROCESSED}件"
echo "エラー: ${TOTAL_ERRORS}件"
echo "推定コスト: ¥$(python3 -c "print(round(${TOTAL_PROCESSED} * 0.03, 1))")"
