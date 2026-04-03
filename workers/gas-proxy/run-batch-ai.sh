#!/bin/bash
# AI画像判定バッチ処理スクリプト
# 5件ずつ処理し、ローカルで処理済みIDを管理（KV結果整合性問題を回避）

cd "$(dirname "$0")"

# SYNC_SECRETを .env ファイルから読み込み
ENV_FILE="$(dirname "$0")/.env"
if [ -f "$ENV_FILE" ]; then
  SECRET=$(grep '^SYNC_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)
fi

if [ -z "$SECRET" ]; then
  read -rsp "SYNC_SECRET を入力してください: " SECRET
  echo ""
  if [ -z "$SECRET" ]; then
    echo "エラー: SECRETが空です"
    exit 1
  fi
fi

URL="https://detauri-gas-proxy.nsdktts1030.workers.dev/batch-ai"
LIMIT=5
DONE_FILE="/tmp/ai-batch-done.json"
TOTAL_PROCESSED=0
TOTAL_ERRORS=0
BATCH=1

# 前回の処理済みリストを読み込み
if [ -f "$DONE_FILE" ]; then
  SKIP_IDS=$(cat "$DONE_FILE")
  EXISTING=$(echo "$SKIP_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  echo "前回の処理済み: ${EXISTING}件（${DONE_FILE}）"
else
  SKIP_IDS="[]"
fi

echo "=== AI画像判定バッチ処理開始 ==="
echo "1回あたり ${LIMIT} 件、10秒間隔で処理"
echo ""

while true; do
  echo -n "--- バッチ #${BATCH} --- "

  RESULT=$(curl -s -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${SECRET}\",\"limit\":${LIMIT},\"skip\":${SKIP_IDS}}")

  # Parse result
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('processed',0))" 2>/dev/null || echo "0")
  REMAINING=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remaining',0))" 2>/dev/null || echo "0")
  ERRORS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errors',0))" 2>/dev/null || echo "0")
  TOTAL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "0")
  GAS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('gasWritten',0))" 2>/dev/null || echo "0")
  MSG=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null || echo "")

  if [ -n "$MSG" ] && [ "$MSG" != "" ] && [ "$MSG" != "None" ]; then
    echo "$MSG"
    break
  fi

  # 処理済みIDをローカルリストに追加
  SKIP_IDS=$(echo "$RESULT" | python3 -c "
import sys,json
result = json.load(sys.stdin)
try:
    with open('$DONE_FILE','r') as f: done = json.load(f)
except: done = []
new_ids = [r['managedId'] for r in result.get('results',[])]
done.extend(new_ids)
done = list(set(done))
with open('$DONE_FILE','w') as f: json.dump(done, f)
print(json.dumps(done))
" 2>/dev/null || echo "[]")

  DONE_COUNT=$(echo "$SKIP_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))
  TOTAL_ERRORS=$((TOTAL_ERRORS + ERRORS))

  echo "処理:${PROCESSED} / GAS:${GAS} / 完了:${DONE_COUNT}/${TOTAL} / エラー:${ERRORS}"

  if [ "$ERRORS" -gt 0 ] 2>/dev/null; then
    echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for e in d.get('errorDetails',[]):
  print(f'  ERROR: {e[\"managedId\"]}: {e[\"error\"][:80]}')" 2>/dev/null
  fi

  if [ "$REMAINING" = "0" ] || [ "$PROCESSED" = "0" ]; then
    echo ""
    echo "=== 全件完了 ==="
    break
  fi

  BATCH=$((BATCH + 1))
  sleep 10
done

echo ""
echo "=== 結果 ==="
echo "処理済み: ${TOTAL_PROCESSED}件"
echo "エラー: ${TOTAL_ERRORS}件"
DONE_TOTAL=$(echo "$SKIP_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "累計完了: ${DONE_TOTAL}件"
echo "推定コスト: ¥$(python3 -c "print(round(${TOTAL_PROCESSED} * 0.3, 1))")"
echo ""
echo "処理済みリスト: ${DONE_FILE}"
echo "全件完了後に削除: rm ${DONE_FILE}"
