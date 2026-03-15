#!/usr/bin/env node
/**
 * migrate-images.js
 *
 * Migrates existing Google Drive / lh3 images to R2 via the Workers upload API.
 *
 * Usage:
 *   WORKER_URL=https://detauri-gas-proxy.xxxxx.workers.dev \
 *   UPLOAD_TOKEN=your-token \
 *   node tools/migrate-images.js
 *
 * Optional CLI override:
 *   node tools/migrate-images.js --worker-url=https://... --upload-token=...
 *
 * Requires Node 18+ (native fetch).
 */

const RETRY_ATTEMPTS = 3;
const REQUEST_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const map = {};
  for (const arg of args) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function getConfig() {
  const cli = parseArgs();
  const workerUrl = (cli['worker-url'] || process.env.WORKER_URL || '').replace(/\/+$/, '');
  const uploadToken = cli['upload-token'] || process.env.UPLOAD_TOKEN || '';

  if (!workerUrl) {
    console.error('Error: WORKER_URL env var or --worker-url arg is required.');
    process.exit(1);
  }
  if (!uploadToken) {
    console.error('Error: UPLOAD_TOKEN env var or --upload-token arg is required.');
    process.exit(1);
  }

  return { workerUrl, uploadToken };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isDriveImage(url) {
  if (!url) return false;
  return (
    url.includes('lh3.googleusercontent.com') ||
    url.includes('drive.google.com') ||
    url.includes('lh3.google.com')
  );
}

/**
 * Fetch with retry — exponential backoff (1s, 2s, 4s …).
 */
async function fetchWithRetry(url, options, attempts = RETRY_ATTEMPTS) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      // Treat 5xx / 429 as retryable
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
      } else {
        // Non-retryable client error
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) {
      const delay = 1000 * Math.pow(2, i);
      console.log(`  Retry ${i + 1}/${attempts - 1} in ${delay}ms ...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function fetchProducts(workerUrl) {
  console.log('Fetching product list …');
  const res = await fetchWithRetry(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'apiGetCachedProducts', args: [] }),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch products: HTTP ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const products = json?.data?.products;
  if (!Array.isArray(products)) {
    throw new Error('Unexpected response shape — data.products is not an array.');
  }
  return products;
}

async function downloadImage(imageUrl) {
  const res = await fetchWithRetry(imageUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  // Derive extension from content-type
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif'
    : 'jpg';
  return { buffer, contentType, ext };
}

async function uploadToR2(workerUrl, uploadToken, managedId, imageBuffer, contentType, ext) {
  const blob = new Blob([imageBuffer], { type: contentType });
  const formData = new FormData();
  formData.append('managedId', managedId);
  formData.append('images', blob, `${managedId}.${ext}`);

  const res = await fetchWithRetry(`${workerUrl}/upload/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${uploadToken}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${res.status} — ${body}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { workerUrl, uploadToken } = getConfig();

  const products = await fetchProducts(workerUrl);
  console.log(`Total products: ${products.length}`);

  // Filter to products with Drive-hosted images
  const targets = products.filter((p) => isDriveImage(p.imageUrl));
  console.log(`Products with Drive images to migrate: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < targets.length; i++) {
    const product = targets[i];
    const { managedId, imageUrl } = product;
    const progress = `[${i + 1}/${targets.length}]`;

    console.log(`${progress} ${managedId}`);
    console.log(`  src: ${imageUrl}`);

    try {
      // 1. Download from Google
      const { buffer, contentType, ext } = await downloadImage(imageUrl);
      console.log(`  downloaded ${(buffer.length / 1024).toFixed(1)} KB (${contentType})`);

      // 2. Upload to R2
      const result = await uploadToR2(workerUrl, uploadToken, managedId, buffer, contentType, ext);
      console.log(`  uploaded OK`, result?.urls ? `-> ${JSON.stringify(result.urls)}` : '');
      succeeded++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      failed++;
      failures.push({ managedId, error: err.message });
    }

    // Throttle to avoid Drive rate limits
    if (i < targets.length - 1) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  // Summary
  console.log('\n========== Migration Summary ==========');
  console.log(`Total targets : ${targets.length}`);
  console.log(`Succeeded     : ${succeeded}`);
  console.log(`Failed        : ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailed items:');
    for (const f of failures) {
      console.log(`  - ${f.managedId}: ${f.error}`);
    }
  }
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
