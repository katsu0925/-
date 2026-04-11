#!/bin/bash
# =====================================================
# 商品画像一括アップロードスクリプト
#
# 使い方:
#   1. LINEアルバムからPC版LINEで画像を一括ダウンロード
#   2. フォルダ名を管理番号にする（例: za79/）
#   3. このスクリプトを実行:
#
#      # 単一フォルダ
#      ./tools/upload-images.sh za79/
#
#      # 複数フォルダ（カレントディレクトリの全サブフォルダ）
#      ./tools/upload-images.sh */
#
# 初回実行時にパスワード認証でトークンを取得し、
# ~/.detauri-upload-token に保存します（90日間有効）
# =====================================================

WORKERS_URL="https://detauri-gas-proxy.nsdktts1030.workers.dev"
TOKEN_FILE="$HOME/.detauri-upload-token"
MAX_IMAGES=10

# --- トークン取得 ---
get_token() {
  if [ -f "$TOKEN_FILE" ]; then
    cat "$TOKEN_FILE"
    return
  fi

  echo "アップロードパスワードを入力してください:"
  read -rs PASSWORD
  echo ""

  RESP=$(curl -s -X POST "$WORKERS_URL/upload/auth" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$PASSWORD\"}")

  TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)

  if [ -z "$TOKEN" ]; then
    echo "認証失敗: $RESP"
    exit 1
  fi

  echo "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "認証成功（トークン保存: $TOKEN_FILE）"
  echo "$TOKEN"
}

TOKEN=$(get_token)

if [ -z "$TOKEN" ]; then
  echo "トークン取得失敗"
  exit 1
fi

# --- 引数チェック ---
if [ $# -eq 0 ]; then
  echo "使い方: $0 <フォルダ>..."
  echo "  例: $0 za79/"
  echo "  例: $0 */     （カレントの全サブフォルダ）"
  exit 1
fi

# --- アップロード ---
TOTAL_OK=0
TOTAL_FAIL=0

for DIR in "$@"; do
  # 末尾スラッシュ除去
  DIR="${DIR%/}"

  if [ ! -d "$DIR" ]; then
    echo "スキップ（ディレクトリではない）: $DIR"
    continue
  fi

  # フォルダ名から管理番号を抽出（スペース以降を除去: "za79 春夏" → "za79"）
  MANAGED_ID=$(basename "$DIR" | awk '{print $1}')

  if [ -z "$MANAGED_ID" ]; then
    echo "スキップ（管理番号が取得できない）: $DIR"
    continue
  fi

  # 画像ファイル収集（jpg, jpeg, png, heic）
  FILES=()
  for EXT in jpg jpeg png heic JPG JPEG PNG HEIC; do
    for F in "$DIR"/*."$EXT"; do
      [ -f "$F" ] && FILES+=("$F")
    done
  done

  if [ ${#FILES[@]} -eq 0 ]; then
    echo "スキップ（画像なし）: $DIR"
    continue
  fi

  # 10枚上限
  if [ ${#FILES[@]} -gt $MAX_IMAGES ]; then
    echo "警告: $MANAGED_ID — ${#FILES[@]}枚中、先頭${MAX_IMAGES}枚のみアップロード"
    FILES=("${FILES[@]:0:$MAX_IMAGES}")
  fi

  echo -n "$MANAGED_ID (${#FILES[@]}枚) ... "

  # multipart/form-data構築
  CURL_ARGS=(-s -X POST "$WORKERS_URL/upload/images"
    -H "Authorization: Bearer $TOKEN"
    -F "managedId=$MANAGED_ID")

  for F in "${FILES[@]}"; do
    CURL_ARGS+=(-F "images=@$F")
  done

  RESP=$(curl "${CURL_ARGS[@]}")
  OK=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null)

  if [ "$OK" = "True" ]; then
    echo "OK"
    TOTAL_OK=$((TOTAL_OK + 1))
  else
    # トークン期限切れの場合、再認証
    if echo "$RESP" | grep -q "期限切れ\|401"; then
      echo "トークン期限切れ → 再認証"
      rm -f "$TOKEN_FILE"
      TOKEN=$(get_token)
      # リトライ
      CURL_ARGS[4]="Authorization: Bearer $TOKEN"
      RESP=$(curl "${CURL_ARGS[@]}")
      OK=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null)
      if [ "$OK" = "True" ]; then
        echo "OK（再認証後）"
        TOTAL_OK=$((TOTAL_OK + 1))
      else
        echo "失敗: $RESP"
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
      fi
    else
      echo "失敗: $RESP"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
  fi
done

echo ""
echo "完了: 成功=${TOTAL_OK} 失敗=${TOTAL_FAIL}"
