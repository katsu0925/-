#!/bin/bash
# Replicate にモデルをデプロイするスクリプト
#
# 前提:
#   1. cog がインストール済み: https://github.com/replicate/cog
#   2. replicate にログイン済み: cog login
#   3. weights/ に学習済みモデルが配置済み
#
# 使い方:
#   cd keypoint-detection/replicate
#   ./deploy.sh

set -e

MODEL_NAME="garment-keypoints"
REPLICATE_USER="${REPLICATE_USER:-YOUR_USERNAME}"

echo "=== 衣類キーポイント検出モデル デプロイ ==="
echo "ユーザー: ${REPLICATE_USER}"
echo "モデル名: ${MODEL_NAME}"
echo ""

# 重みファイルの確認
echo "--- 重みファイル確認 ---"
for cat in tops pants skirt dress; do
    if [ -f "weights/${cat}_best.pth" ]; then
        SIZE=$(du -h "weights/${cat}_best.pth" | cut -f1)
        echo "  ✅ ${cat}: ${SIZE}"
    else
        echo "  ❌ ${cat}: weights/${cat}_best.pth が見つかりません"
    fi
done
echo ""

# configs ディレクトリをコピー（predict.py が参照）
echo "--- 設定ファイルをコピー ---"
cp -r ../configs ./configs 2>/dev/null || true
echo "  configs/ → replicate/configs/"
echo ""

# ローカルテスト
echo "--- ローカル推論テスト ---"
echo "※ GPU環境でのみ実行可能。スキップする場合は Ctrl+C"
echo ""
read -p "ローカルテストを実行しますか？ (y/N): " RUN_TEST

if [ "$RUN_TEST" = "y" ]; then
    TEST_IMG="../../tools/ai-measure-test/IMG_1722.jpg"
    if [ -f "$TEST_IMG" ]; then
        cog predict -i image=@"$TEST_IMG" -i category=tops -i scale=0.0429
    else
        echo "テスト画像が見つかりません: $TEST_IMG"
    fi
fi

echo ""
echo "--- Replicate にプッシュ ---"
read -p "r8.im/${REPLICATE_USER}/${MODEL_NAME} にプッシュしますか？ (y/N): " DO_PUSH

if [ "$DO_PUSH" = "y" ]; then
    cog push "r8.im/${REPLICATE_USER}/${MODEL_NAME}"
    echo ""
    echo "✅ デプロイ完了！"
    echo "   https://replicate.com/${REPLICATE_USER}/${MODEL_NAME}"
else
    echo "プッシュをスキップしました。"
    echo "手動で実行: cog push r8.im/${REPLICATE_USER}/${MODEL_NAME}"
fi
