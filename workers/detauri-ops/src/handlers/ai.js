/**
 * AI商品判定 — Gemini 2.5 Flash Lite
 * Step1: 1枚目の写真で即時判定（ブランド/カテゴリ/カラー/性別/特徴）
 * Step2: 全写真でバックグラウンド判定（より正確）
 */
import { jsonOk, jsonError } from '../utils/response.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT_STEP1 = `中古衣類の正面写真1枚から商品情報をJSON判定せよ。不明はnull。
選択肢外の値は禁止。

■category2: トップス|ジャケット・アウター|パンツ|スカート|ワンピース|ドレス・ブライダル|スーツ・フォーマル|スーツセットアップ|スーツ|ルームウェア・パジャマ|サロペット・オーバーオール|ジャージセットアップ|マタニティ|キッズ

■category3（category2別）:
トップス: ニット/セーター,Tシャツ/カットソー,シャツ/ブラウス,カーディガン,パーカー,トレーナー,スウェット,ポロシャツ,ベスト,チュニック,タンクトップ,アンサンブル,ジャージ,ジレ,ボレロ,キャミソール,ビスチェ,ベアトップ,長袖カットソー,五分袖カットソー,七分袖カットソー,ノースリーブトップス
ジャケット・アウター: テーラードジャケット,ジャンパー,ノーカラージャケット,ブルゾン,ロングコート,ダウンジャケット,マウンテンパーカー,ウールコート,トレンチコート,スプリングコート,ナイロンジャケット,ミリタリージャケット,キルティングジャケット,フリースジャケット,ボアジャケット,デニムジャケット,毛皮ファーコート,レザージャケット,ピーコート,チェスターコート,ダッフルコート,ムートンコート,ステンカラーコート,ライダース,ケープコート,ポンチョ,ダウンベスト,キルティングベスト,カバーオール,モッズコート,Gジャン/デニムジャケット,スタジャン,スカジャン,MA-1/フライトジャケット
パンツ: カジュアルパンツ,デニム/ジーンズ,スラックス,イージーパンツ,ワイドパンツ,スウェットパンツ,ハーフパンツ,ショートパンツ,ガウチョパンツ,ワークパンツ,カーゴパンツ,チノパン,スキニーパンツ,ジョガーパンツ,キュロット,サルエルパンツ,ペインターパンツ
スカート: ひざ丈スカート,ロングスカート,ミニスカート
ワンピース: ひざ丈ワンピース,ロングワンピース,ミニワンピース
ドレス・ブライダル: パーティードレス,ウェディングドレス,カラードレス,ナイトドレス,キャバドレス,チャイナドレス
スーツ・フォーマル: ブラックスーツ,礼服,喪服,ブラックフォーマル,フォーマルシャツ,フォーマルベスト,フォーマル小物カフス,モーニング/フロックコート,燕尾服タキシード
スーツセットアップ: スカートセットアップ/ツーピース,パンツセットアップ/ツーピース,パンツセットアップ/スリーピース
スーツ: セットアップ/ツーピース,セットアップ/スリーピース,ビジネススーツ,カジュアルスーツ,ビジネスジャケット,スーツベスト,フォーマルシャツ
ルームウェア・パジャマ: ルームウェア,パジャマ,ガウン,バスローブ,ネグリジェ,腹巻き,ステテコ
サロペット・オーバーオール: サロペット,オールインワン,オーバーオール,つなぎ

■color: ブラック系|グリーン系|イエロー系|オレンジ系|ホワイト系|グレイ系|ブラウン系|レッド系|ピンク系|パープル系|ブルー系|ベージュ系|ネイビー系|カーキ系|マルチカラー|モノクロ|バイカラー

■判定ルール:
- brandはタグが見えればタグから読み取る。見えなければデザイン・ロゴから推測。推測不能ならnull
- genderは衣類のシルエット・デザインから判定
- pocketは正面写真で明確に見える場合のみ判定。不明ならnull

JSONのみ返せ:
{"brand":string|null,"gender":"メンズ"|"レディース"|"ユニセックス"|null,"category2":string,"category3":string|null,"color":string,"designFeature":string|null,"tagSize":string|null,"pocket":"あり"|"なし"|null}`;

const PROMPT_STEP2 = `中古衣類の商品写真（複数枚）から商品情報をJSON判定せよ。
全写真を総合的に確認し、タグ・裏地・ポケット等の詳細も判定に含めよ。不明はnull。
選択肢外の値は禁止。

■category2: トップス|ジャケット・アウター|パンツ|スカート|ワンピース|ドレス・ブライダル|スーツ・フォーマル|スーツセットアップ|スーツ|ルームウェア・パジャマ|サロペット・オーバーオール|ジャージセットアップ|マタニティ|キッズ

■category3（category2別）:
トップス: ニット/セーター,Tシャツ/カットソー,シャツ/ブラウス,カーディガン,パーカー,トレーナー,スウェット,ポロシャツ,ベスト,チュニック,タンクトップ,アンサンブル,ジャージ,ジレ,ボレロ,キャミソール,ビスチェ,ベアトップ,長袖カットソー,五分袖カットソー,七分袖カットソー,ノースリーブトップス
ジャケット・アウター: テーラードジャケット,ジャンパー,ノーカラージャケット,ブルゾン,ロングコート,ダウンジャケット,マウンテンパーカー,ウールコート,トレンチコート,スプリングコート,ナイロンジャケット,ミリタリージャケット,キルティングジャケット,フリースジャケット,ボアジャケット,デニムジャケット,毛皮ファーコート,レザージャケット,ピーコート,チェスターコート,ダッフルコート,ムートンコート,ステンカラーコート,ライダース,ケープコート,ポンチョ,ダウンベスト,キルティングベスト,カバーオール,モッズコート,Gジャン/デニムジャケット,スタジャン,スカジャン,MA-1/フライトジャケット
パンツ: カジュアルパンツ,デニム/ジーンズ,スラックス,イージーパンツ,ワイドパンツ,スウェットパンツ,ハーフパンツ,ショートパンツ,ガウチョパンツ,ワークパンツ,カーゴパンツ,チノパン,スキニーパンツ,ジョガーパンツ,キュロット,サルエルパンツ,ペインターパンツ
スカート: ひざ丈スカート,ロングスカート,ミニスカート
ワンピース: ひざ丈ワンピース,ロングワンピース,ミニワンピース
ドレス・ブライダル: パーティードレス,ウェディングドレス,カラードレス,ナイトドレス,キャバドレス,チャイナドレス
スーツ・フォーマル: ブラックスーツ,礼服,喪服,ブラックフォーマル,フォーマルシャツ,フォーマルベスト,フォーマル小物カフス,モーニング/フロックコート,燕尾服タキシード
スーツセットアップ: スカートセットアップ/ツーピース,パンツセットアップ/ツーピース,パンツセットアップ/スリーピース
スーツ: セットアップ/ツーピース,セットアップ/スリーピース,ビジネススーツ,カジュアルスーツ,ビジネスジャケット,スーツベスト,フォーマルシャツ
ルームウェア・パジャマ: ルームウェア,パジャマ,ガウン,バスローブ,ネグリジェ,腹巻き,ステテコ
サロペット・オーバーオール: サロペット,オールインワン,オーバーオール,つなぎ

■color: ブラック系|グリーン系|イエロー系|オレンジ系|ホワイト系|グレイ系|ブラウン系|レッド系|ピンク系|パープル系|ブルー系|ベージュ系|ネイビー系|カーキ系|マルチカラー|モノクロ|バイカラー

■判定ルール:
- brandはタグが見えればタグから読み取る。見えなければデザイン・ロゴから推測。推測不能ならnull
- genderは衣類のシルエット・デザインから判定
- pocketは写真で明確に見える場合のみ判定。不明ならnull
- tagSizeはタグ写真から読み取る

JSONのみ返せ:
{"brand":string|null,"gender":"メンズ"|"レディース"|"ユニセックス"|null,"category2":string,"category3":string|null,"color":string,"designFeature":string|null,"tagSize":string|null,"pocket":"あり"|"なし"|null}`;

/**
 * Step1: 1枚目の写真で即時判定
 */
export async function analyzeStep1(request, env, session) {
  const { managedId } = await request.json();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return jsonError('AI APIキーが設定されていません。', 500);

  // KVから写真URL一覧を取得（URL文字列の配列: ["/images/products/dS0001/0_uuid.jpg", ...]）
  const photoUrls = await env.CACHE.get(`product-photos:${managedId}`, 'json');
  if (!photoUrls || photoUrls.length === 0) {
    return jsonError('写真がありません。', 400);
  }

  // URLからR2キーを抽出（"/images/products/..." → "products/..."）
  const r2Key = urlToR2Key(photoUrls[0]);
  if (!r2Key) return jsonError(`写真データが不正です: ${JSON.stringify(photoUrls[0])}`, 400);

  const object = await env.IMAGES.get(r2Key);
  if (!object) return jsonError(`写真が見つかりません: r2Key=${r2Key}`, 404);

  const imageBytes = await object.arrayBuffer();
  const base64 = arrayBufferToBase64(imageBytes);
  const mimeType = object.httpMetadata?.contentType || 'image/jpeg';

  // Gemini API呼び出し
  const result = await callGemini(apiKey, [{ base64, mimeType }], PROMPT_STEP1);
  if (!result.ok) return jsonError(result.error || 'AI判定に失敗しました。', 500);

  // D1にAI結果を保存
  await saveAiResultToDB(env, managedId, result.data);

  return jsonOk({ managedId, ai: result.data, step: 1 });
}

/**
 * Step2: 全写真でバックグラウンド判定
 */
export async function analyzeStep2(request, env, session) {
  const { managedId } = await request.json();
  if (!managedId) return jsonError('管理番号が必要です。', 400);

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return jsonError('AI APIキーが設定されていません。', 500);

  const photoUrls = await env.CACHE.get(`product-photos:${managedId}`, 'json');
  if (!photoUrls || photoUrls.length === 0) {
    return jsonError('写真がありません。', 400);
  }

  // 全写真をR2から取得（最大10枚）
  const images = [];
  for (const url of photoUrls.slice(0, 10)) {
    const r2Key = urlToR2Key(url);
    if (!r2Key) continue;
    const object = await env.IMAGES.get(r2Key);
    if (!object) continue;
    const bytes = await object.arrayBuffer();
    images.push({
      base64: arrayBufferToBase64(bytes),
      mimeType: object.httpMetadata?.contentType || 'image/jpeg',
    });
  }

  if (images.length === 0) return jsonError('写真を読み込めませんでした。', 400);

  const result = await callGemini(apiKey, images, PROMPT_STEP2);
  if (!result.ok) return jsonError(result.error || 'AI判定に失敗しました。', 500);

  await saveAiResultToDB(env, managedId, result.data);

  return jsonOk({ managedId, ai: result.data, step: 2, photoCount: images.length });
}

/**
 * Gemini API呼び出し
 */
async function callGemini(apiKey, images, prompt) {
  const parts = [{ text: prompt }];
  for (const img of images) {
    parts.push({
      inline_data: { mime_type: img.mimeType, data: img.base64 },
    });
  }
  parts.push({ text: 'この写真の商品情報をJSONで返せ。' });

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini API error:', res.status, errText);
      return { ok: false, error: `Gemini API ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, error: 'AI応答が空です' };

    const parsed = JSON.parse(text);
    return { ok: true, data: parsed };
  } catch (e) {
    console.error('Gemini error:', e);
    return { ok: false, error: e.message };
  }
}

/**
 * AI結果をD1に保存
 */
async function saveAiResultToDB(env, managedId, ai) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE products SET
      brand = COALESCE(?, brand),
      gender = COALESCE(?, gender),
      category1 = CASE WHEN ? = 'メンズ' THEN 'メンズ' WHEN ? = 'キッズ' THEN 'キッズ' ELSE 'レディース' END,
      category2 = COALESCE(?, category2),
      category3 = COALESCE(?, category3),
      color = COALESCE(?, color),
      design_feature = COALESCE(?, design_feature),
      tag_size = COALESCE(?, tag_size),
      pocket = COALESCE(?, pocket),
      shipping_method = COALESCE(?, shipping_method),
      has_info = 1,
      updated_at = ?
    WHERE managed_id = ?
  `).bind(
    ai.brand || null,
    ai.gender || null,
    ai.gender || '', ai.gender || '',
    ai.category2 || null,
    ai.category3 || null,
    ai.color || null,
    ai.designFeature || null,
    ai.tagSize || null,
    ai.pocket || null,
    null, // shipping_method はAIでは判定しない（スタッフが手動選択）
    now,
    managedId,
  ).run();
}

/**
 * URL → R2キー変換（"/images/products/dS0001/0_uuid.jpg" → "products/dS0001/0_uuid.jpg"）
 */
function urlToR2Key(url) {
  if (!url || typeof url !== 'string') return null;
  const prefix = '/images/';
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  return url;
}

/**
 * ArrayBuffer → base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
