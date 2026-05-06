// GET /api/thumb?key=products/<managedId>/<uuid>.jpg&w=200
// gas-proxy 側 R2 (detauri-images) に保存された原本(1200×1200, ~170KB)を取得し、
// Wasm でサムネサイズに縮小して返す。caches.default に 24h キャッシュ。
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
    ]);
  }
  return wasmInitPromise;
}

const ALLOWED_W = new Set([100, 160, 200, 240, 320, 400, 600, 800]);
const KEY_RE = /^products\/[\w-]+\/[\w-]{8,}\.jpe?g$/i;

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
    await ensureWasmReady();
    // JPEG → ImageData (RGBA)
    const decoded = await decode(inputBuf);
    const targetW = w;
    const targetH = Math.max(1, Math.round((decoded.height / decoded.width) * targetW));
    // Lanczos3 でリサイズ（@jsquash/resize の defaultOptions.method）
    const resized = await resize(decoded, { width: targetW, height: targetH });
    // JPEG エンコード（quality 75 で十分・サイズも小さい）
    outputBuf = await encode(resized, { quality: 75 });
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
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
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
