// GET /api/thumb?key=products/<managedId>/<uuid>.jpg&w=200
// gas-proxy 側 R2 (detauri-images) に保存された原本を取得し、Wasm でサムネサイズに
// 縮小して返す。caches.default に 1年 キャッシュ（key=UUID で immutable）。
// 原本サイズは一定でない（従来は 1200×1200/~170KB だが、新しいアップロードは
// クライアント縮小フォールバック等で 3024×3024 級の高解像度原画が入る）。
// メモリ上限超過対策は下記 PRESHRINK_MAX / withHeavyLock を参照。
//
// 用途: 発送/商品タブの一覧サムネ（タスキ箱由来の R2 画像）。
//   原本を直接表示すると 22 件 × 173KB = 3.8MB。w=200 で生成すれば ~6KB × 22 = 130KB。
//
// セキュリティ:
//   - key は products/<英数字-_>/<英数字-_>.(jpg|jpeg) のみ許可
//   - w は 100/160/200/240/320/400/600/800 のいずれかのみ
//   - 認証は index.js 側で getAccessUser() を通過後に呼ばれる
//
// WASM 初期化:
//   @jsquash の各モジュールは内部で `fetch(new URL('xxx.wasm', import.meta.url))` を
//   走らせて WASM をロードする実装になっており、Workers では動かない。
//   そこで wrangler の WebAssembly インポート機能で .wasm を WebAssembly.Module として
//   直接バンドルし、init() に渡してオフライン初期化する。

import decode, { init as initJpegDecode } from '@jsquash/jpeg/decode';
import encode, { init as initJpegEncode } from '@jsquash/jpeg/encode';
import resize, { initResize } from '@jsquash/resize';

import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import JPEG_ENC_WASM from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
import RESIZE_WASM from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';

// Cloudflare Workers には ImageData が無い（@jsquash/resize 内で fallback 入りだが念押し）
if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

let wasmInitPromise = null;
function ensureWasmReady() {
  if (!wasmInitPromise) {
    wasmInitPromise = Promise.all([
      initJpegDecode(JPEG_DEC_WASM),
      initJpegEncode(JPEG_ENC_WASM),
      initResize(RESIZE_WASM),
    ]).catch((err) => {
      // #12: 初期化失敗を恒久キャッシュしない。reject された Promise をそのまま保持すると、
      //      同一 isolate の後続リクエストが永久に同じ reject を再利用し（isolate 再起動まで）
      //      サムネ生成が全滅する。null に戻して次リクエストで再初期化を試みる。
      //      呼び出し側 catch のフォールバック（原本素通し）は維持される。
      wasmInitPromise = null;
      throw err;
    });
  }
  return wasmInitPromise;
}

const ALLOWED_W = new Set([100, 160, 200, 240, 320, 400, 600, 800]);
const KEY_RE = /^products\/[\w-]+\/[\w-]{8,}\.jpe?g$/i;

// 原本を Lanczos リサイズする前に、長辺がこのサイズを超える画像は
// 整数倍の box 平均で先に縮小しておく。
// 理由: @jsquash/resize(squoosh) は Lanczos 計算で入力を f32 に展開するため、
//   3024×3024 の原本を直接渡すと 3024×3024×4ch×4byte ≈ 146MB を一度に確保し、
//   Workers の 128MB/isolate メモリ上限を 1 枚で超過 → ランタイムが OOM kill。
//   この kill は try/catch では捕捉できず原本フォールバックも走らないため、
//   /api/thumb がエラー応答になり一覧サムネが全滅する（新規アップロードの
//   高解像度原画 3024² で発生）。事前に長辺 ≤PRESHRINK_MAX へ落とせば
//   resize の f32 バッファが ~16MB に収まり上限内で完結する。
//   1200²/1600² 等の従来サイズは閾値未満なので素通し＝出力品質は不変。
const PRESHRINK_MAX = 1280;

// 整数倍の box 平均ダウンスケール（純 JS・メモリは出力分のみで有界）。
// 長辺が maxEdge 以下ならそのまま返す。
function boxDownscaleToMax(img, maxEdge) {
  const sw = img.width;
  const sh = img.height;
  const long = Math.max(sw, sh);
  if (long <= maxEdge) return img;
  const factor = Math.ceil(long / maxEdge); // 2 以上の整数
  const dw = Math.floor(sw / factor);
  const dh = Math.floor(sh / factor);
  const src = img.data;
  const dst = new Uint8ClampedArray(dw * dh * 4);
  const f2 = factor * factor;
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = dy * factor;
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = dx * factor;
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = 0; yy < factor; yy++) {
        let si = ((sy0 + yy) * sw + sx0) * 4;
        for (let xx = 0; xx < factor; xx++) {
          r += src[si]; g += src[si + 1]; b += src[si + 2]; a += src[si + 3];
          si += 4;
        }
      }
      const di = (dy * dw + dx) * 4;
      dst[di] = r / f2; dst[di + 1] = g / f2; dst[di + 2] = b / f2; dst[di + 3] = a / f2;
    }
  }
  return { data: dst, width: dw, height: dh };
}

// 重い WASM 処理（decode→shrink→resize→encode）を isolate 内で直列化するミューテックス。
// decode 単体でも 3024² は約 70MB を要するため、一覧の同時読み込みで複数枚が
// 同一 isolate に集中すると（box 縮小しても）decode の合算で 128MB を超え得る。
// 同時実行を 1 本に絞ることでピークを 1 枚分に抑える。成功結果は caches.default に
// immutable キャッシュされるため、直列化のコストはコールド初回のみ。
let heavyLock = Promise.resolve();
function withHeavyLock(fn) {
  const run = heavyLock.then(fn, fn);
  heavyLock = run.then(() => {}, () => {});
  return run;
}

export async function thumbProxy(request, env, ctx) {
  const url = new URL(request.url);
  const key = (url.searchParams.get('key') || '').replace(/^\/+/, '');
  const w = parseInt(url.searchParams.get('w') || '200', 10);

  if (!KEY_RE.test(key)) {
    return new Response('bad key', { status: 400 });
  }
  if (!ALLOWED_W.has(w)) {
    return new Response('bad w', { status: 400 });
  }
  if (!env.IMAGES) {
    return new Response('R2 not bound', { status: 500 });
  }

  // caches.default キーは Access cookie を含めない固定 URL にしてユーザー横断キャッシュ
  const cacheKey = new Request(`https://shiire-kanri-thumb.local/${key}?w=${w}`, {
    method: 'GET',
  });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const inputBuf = await obj.arrayBuffer();

  let outputBuf;
  try {
    outputBuf = await withHeavyLock(async () => {
      await ensureWasmReady();
      // JPEG → ImageData (RGBA)
      let decoded = await decode(inputBuf);
      // 高解像度原画は先に box 平均で縮小し、resize の f32 展開によるメモリ超過を防ぐ
      const pre = boxDownscaleToMax(decoded, PRESHRINK_MAX);
      decoded = null; // 35MB の原本 ImageData を早期解放
      const targetW = w;
      const targetH = Math.max(1, Math.round((pre.height / pre.width) * targetW));
      // Lanczos3 でリサイズ（@jsquash/resize の defaultOptions.method）
      const resized = await resize(pre, { width: targetW, height: targetH });
      // JPEG エンコード（quality 75 で十分・サイズも小さい）
      return await encode(resized, { quality: 75 });
    });
  } catch (err) {
    // デコード失敗時は原本を素通し（500 を返すと一覧が壊れる）
    return new Response(inputBuf, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=300',
        'X-Thumb-Fallback': String(err && err.message || err).slice(0, 100),
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const res = new Response(outputBuf, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Thumb-Source': 'r2-wasm',
    },
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  } else {
    await cache.put(cacheKey, res.clone());
  }
  return res;
}
