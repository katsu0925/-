/**
 * 出品キットページ HTMLテンプレート
 *
 * キットデータJSONを埋め込み、クライアントJSでDOM生成
 * - 初期20商品 + IntersectionObserverで追加描画
 * - アコーディオン折りたたみ
 * - 顧客名マスク表示
 * - コピーボタン / 画像保存 / ZIPダウンロード
 */

export function getKitPageHtml(kitDataJson) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>出品キット — デタウリ.Detauri</title>
<style>
  :root {
    --primary: #1a1a2e;
    --accent: #e94560;
    --bg: #f5f5f7;
    --card-bg: #fff;
    --text: #333;
    --text-light: #666;
    --border: #e0e0e0;
    --success: #27ae60;
    --radius: 12px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding-bottom: 40px;
  }
  .kit-container { max-width: 640px; margin: 0 auto; background: var(--bg); min-height: 100vh; }
  .kit-header { background: var(--primary); color: #fff; padding: 24px 16px; text-align: center; }
  .kit-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .kit-header .order-info { font-size: 13px; opacity: 0.7; }
  .guide-banner {
    background: #fff3cd; border-left: 4px solid #ffc107;
    margin: 16px; padding: 12px 16px; border-radius: 8px;
    font-size: 13px; line-height: 1.7;
  }
  .guide-banner strong { color: #856404; }
  .order-summary {
    background: var(--card-bg); margin: 16px; padding: 16px;
    border-radius: var(--radius); border: 1px solid var(--border);
    display: flex; justify-content: space-around; text-align: center;
  }
  .order-summary .stat-value { font-size: 22px; font-weight: 700; color: var(--primary); }
  .order-summary .stat-label { font-size: 12px; color: var(--text-light); }
  .product-card {
    background: var(--card-bg); margin: 8px 16px;
    border-radius: var(--radius); border: 1px solid var(--border);
    overflow: hidden; content-visibility: auto;
  }
  .product-card.open { margin: 12px 16px; }
  .product-card-header {
    background: var(--primary); color: #fff; padding: 12px 16px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; cursor: pointer; user-select: none; -webkit-user-select: none;
  }
  .product-card-header:active { opacity: 0.85; }
  .product-card-header .product-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .product-card-header .product-no { font-weight: 700; font-size: 13px; white-space: nowrap; }
  .product-card-header .product-brand { font-size: 12px; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .product-card-header .product-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .product-card-header .product-price { background: var(--accent); padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 12px; }
  .product-card-header .chevron { font-size: 16px; transition: transform 0.2s; opacity: 0.7; }
  .product-card.open .chevron { transform: rotate(180deg); }
  .product-body { display: none; padding: 0; }
  .product-card.open .product-body { display: block; }
  .image-gallery { padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 6px; }
  .image-gallery img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; }
  .image-gallery img:active { opacity: 0.7; }
  .image-placeholder {
    width: 100%; aspect-ratio: 1; border-radius: 6px; border: 2px dashed var(--border);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; color: var(--text-light); text-align: center;
  }
  .save-images-bar { padding: 0 12px 8px; display: flex; gap: 6px; }
  .save-images-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
    background: #f0f0f0; color: var(--text); border: 1px solid var(--border);
    padding: 9px 12px; border-radius: 8px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.2s;
  }
  .save-images-btn:active { background: #e0e0e0; transform: scale(0.98); }
  .save-images-btn .btn-icon { font-size: 14px; }
  .save-images-btn.primary-save { background: var(--accent); color: #fff; border-color: var(--accent); }
  .save-images-btn.primary-save:active { opacity: 0.9; }
  .copy-section { padding: 0 16px 12px; }
  .copy-block { margin-bottom: 10px; }
  .copy-block-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .copy-block-label span { font-size: 11px; font-weight: 700; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.5px; }
  .copy-btn {
    display: inline-flex; align-items: center;
    background: var(--primary); color: #fff; border: none;
    padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all 0.2s;
  }
  .copy-btn:active { transform: scale(0.95); }
  .copy-btn.copied { background: var(--success); }
  .copy-content {
    background: #f8f9fa; border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; font-size: 13px; line-height: 1.7;
    white-space: pre-wrap; word-break: break-all;
    max-height: 180px; overflow-y: auto;
  }
  .copy-content.title-content { font-weight: 600; font-size: 14px; max-height: none; }
  .product-details { padding: 0 16px 12px; display: flex; gap: 12px; }
  .product-details .detail-col { flex: 1; min-width: 0; }
  .detail-col h3 { font-size: 11px; font-weight: 700; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .info-table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .info-table th { text-align: left; padding: 5px 8px; background: #f8f9fa; color: var(--text-light); font-weight: 600; width: 80px; white-space: nowrap; border-bottom: 1px solid var(--border); }
  .info-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); word-break: break-all; }
  .measure-grid { display: flex; flex-wrap: wrap; gap: 4px; }
  .measure-item { background: #f8f9fa; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: flex; gap: 4px; }
  .measure-item .label { color: var(--text-light); }
  .measure-item .value { font-weight: 700; }
  .modal-overlay {
    display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.9); z-index: 1000;
    justify-content: center; align-items: center;
  }
  .modal-overlay.active { display: flex; }
  .modal-overlay img { max-width: 95%; max-height: 90vh; border-radius: 8px; }
  .modal-close { position: fixed; top: 16px; right: 16px; color: #fff; font-size: 32px; cursor: pointer; z-index: 1001; background: none; border: none; line-height: 1; }
  .kit-footer { text-align: center; padding: 24px 16px; font-size: 12px; color: var(--text-light); }
  .kit-footer a { color: var(--accent); text-decoration: none; }
  .loading-sentinel { height: 1px; }
  @media (max-width: 480px) { .product-details { flex-direction: column; gap: 8px; } }
</style>
</head>
<body>

<div class="kit-container" id="kitContainer"></div>

<div class="modal-overlay" id="imageModal" onclick="closeModal()">
  <button class="modal-close" onclick="closeModal()">&times;</button>
  <img id="modalImg" src="" alt="">
</div>

<script id="__kit_data__" type="application/json">${kitDataJson}</script>
<script>
(function() {
  'use strict';

  var data;
  try {
    data = JSON.parse(document.getElementById('__kit_data__').textContent);
  } catch(e) {
    document.getElementById('kitContainer').innerHTML = '<div style="padding:40px;text-align:center;color:#666;">データの読み込みに失敗しました。</div>';
    return;
  }

  var items = data.items || [];
  var totalCount = items.length;
  var INITIAL_RENDER = 20;
  var BATCH_SIZE = 20;
  var renderedCount = 0;

  // 顧客名マスク
  function maskName(name) {
    if (!name || name.length <= 1) return name || '';
    return name.charAt(0) + new Array(Math.min(name.length - 1, 3) + 1).join('*') + ' 様';
  }

  // 採寸テキストをパース
  function parseMeasurement(text) {
    if (!text) return [];
    var parts = text.split(/[/／]/).map(function(s) { return s.trim(); }).filter(Boolean);
    var result = [];
    parts.forEach(function(part) {
      var m = part.match(/^(.+?)[：:]?\\s*([\\d.]+\\s*cm.*)$/);
      if (m) result.push({ label: m[1].trim(), value: m[2].trim() });
      else result.push({ label: part, value: '' });
    });
    return result;
  }

  // コンテナ取得
  var container = document.getElementById('kitContainer');
  var maskedName = maskName(data.customerName);
  var orderDate = data.orderDate || '';
  var totalPrice = data.totalPrice ? Number(data.totalPrice).toLocaleString('ja-JP') : '0';

  // ヘッダー + ガイド + サマリー
  container.innerHTML =
    '<div class="kit-header">' +
      '<h1>出品キット</h1>' +
      '<div class="order-info">受付番号: ' + esc(data.receiptNo || '') + ' ／ ' + esc(maskedName) + '</div>' +
    '</div>' +
    '<div class="guide-banner">' +
      '<strong>使い方:</strong> 商品をタップで展開。画像は<strong>長押しで保存</strong>、タイトル・説明文は「コピー」でワンタップコピー。<br>' +
      '画像・タイトル・説明文はフリマアプリ等への出品にご自由にお使いいただけます。' +
    '</div>' +
    '<div class="order-summary">' +
      '<div><div class="stat-value">' + totalCount + '</div><div class="stat-label">商品数</div></div>' +
      '<div><div class="stat-value">' + esc(totalPrice) + '</div><div class="stat-label">合計金額（税込）</div></div>' +
      '<div><div class="stat-value">' + esc(orderDate) + '</div><div class="stat-label">注文日</div></div>' +
    '</div>' +
    '<div id="productList"></div>' +
    '<div class="loading-sentinel" id="loadingSentinel"></div>' +
    '<div class="kit-footer">' +
      'このページは注文者限定です。URLの共有はお控えください。<br>' +
      '<a href="https://wholesale.nkonline-tool.com">デタウリ.Detauri</a> ／ NKonline' +
    '</div>';

  var productList = document.getElementById('productList');

  // 商品カードHTML生成
  function renderItem(item, index) {
    var num = (index + 1) + '/' + totalCount;
    var brandLabel = esc(item.brand || '') + ' ' + esc(item.item || '') + ' ' + esc(item.size || '');
    var isOpen = index === 0 ? ' open' : '';

    var imagesHtml = '';
    if (item.images && item.images.length > 0) {
      imagesHtml = '<div class="image-gallery">';
      item.images.forEach(function(url) {
        imagesHtml += '<img src="' + esc(url) + '" alt="" loading="lazy" onclick="openModal(this)">';
      });
      imagesHtml += '</div>';
      imagesHtml += '<div class="save-images-bar">' +
        '<button class="save-images-btn primary-save" onclick="event.stopPropagation();saveProductImages(this,&apos;' + esc(item.managedId) + '&apos;)">' +
          '<span class="btn-icon">&#x1F4F2;</span> 画像をまとめて保存</button>' +
        '<button class="save-images-btn" onclick="event.stopPropagation();downloadProductZip(&apos;' + esc(item.managedId) + '&apos;)">' +
          '<span class="btn-icon">&#x1F4E5;</span> ZIP</button>' +
        '</div>';
    } else {
      imagesHtml = '<div class="image-gallery"><div class="image-placeholder">画像未アップロード</div></div>';
    }

    var brandId = 'brand-' + index;
    var titleId = 'title-' + index;
    var descId = 'desc-' + index;

    var copyHtml = '<div class="copy-section">';
    if (item.brand) {
      copyHtml += '<div class="copy-block">' +
        '<div class="copy-block-label"><span>ブランド</span>' +
        '<button class="copy-btn" onclick="event.stopPropagation();copyText(this,&apos;' + brandId + '&apos;)">コピー</button></div>' +
        '<div class="copy-content title-content" id="' + brandId + '">' + esc(item.brand) + '</div></div>';
    }
    if (item.title) {
      copyHtml += '<div class="copy-block">' +
        '<div class="copy-block-label"><span>メルカリ用タイトル</span>' +
        '<button class="copy-btn" onclick="event.stopPropagation();copyText(this,&apos;' + titleId + '&apos;)">コピー</button></div>' +
        '<div class="copy-content title-content" id="' + titleId + '">' + esc(item.title) + '</div></div>';
    }
    if (item.description) {
      copyHtml += '<div class="copy-block">' +
        '<div class="copy-block-label"><span>即出品用説明文</span>' +
        '<button class="copy-btn" onclick="event.stopPropagation();copyText(this,&apos;' + descId + '&apos;)">コピー</button></div>' +
        '<div class="copy-content" id="' + descId + '">' + esc(item.description) + '</div></div>';
    }
    copyHtml += '</div>';

    // 商品情報テーブル
    var infoHtml = '<div class="detail-col"><h3>商品情報</h3><table class="info-table">';
    if (item.managedId) infoHtml += '<tr><th>管理番号</th><td>' + esc(item.managedId) + '</td></tr>';
    if (item.brand) infoHtml += '<tr><th>ブランド</th><td>' + esc(item.brand) + '</td></tr>';
    if (item.item) infoHtml += '<tr><th>中カテゴリ</th><td>' + esc(item.item) + '</td></tr>';
    if (item.cat3) infoHtml += '<tr><th>小カテゴリ</th><td>' + esc(item.cat3) + '</td></tr>';
    if (item.size) infoHtml += '<tr><th>サイズ</th><td>' + esc(item.size) + '</td></tr>';
    if (item.color) infoHtml += '<tr><th>カラー</th><td>' + esc(item.color) + '</td></tr>';
    if (item.gender) infoHtml += '<tr><th>性別</th><td>' + esc(item.gender) + '</td></tr>';
    if (item.condition) infoHtml += '<tr><th>状態</th><td>' + esc(item.condition) + '</td></tr>';
    if (item.aiKeywords) infoHtml += '<tr><th>キーワード</th><td>' + esc(item.aiKeywords) + '</td></tr>';
    infoHtml += '</table></div>';

    // 採寸データ
    var measureHtml = '';
    var measures = parseMeasurement(item.measurementText);
    if (measures.length > 0) {
      measureHtml = '<div class="detail-col"><h3>採寸データ</h3><div class="measure-grid">';
      measures.forEach(function(m) {
        measureHtml += '<div class="measure-item"><span class="label">' + esc(m.label) + '</span><span class="value">' + esc(m.value) + '</span></div>';
      });
      measureHtml += '</div></div>';
    }

    return '<div class="product-card' + isOpen + '">' +
      '<div class="product-card-header" onclick="toggleCard(this)">' +
        '<div class="product-left">' +
          '<span class="product-no">' + num + '</span>' +
          '<span class="product-brand">' + brandLabel.trim() + '</span>' +
        '</div>' +
        '<div class="product-right">' +
          '<span class="product-price">' + esc(item.priceText || '') + '</span>' +
          '<span class="chevron">&#x25BC;</span>' +
        '</div>' +
      '</div>' +
      '<div class="product-body">' +
        imagesHtml + copyHtml +
        '<div class="product-details">' + infoHtml + measureHtml + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderBatch(count) {
    var end = Math.min(renderedCount + count, totalCount);
    var html = '';
    for (var i = renderedCount; i < end; i++) {
      html += renderItem(items[i], i);
    }
    productList.insertAdjacentHTML('beforeend', html);
    renderedCount = end;
  }

  // 初期描画
  renderBatch(INITIAL_RENDER);

  // IntersectionObserver で追加描画
  if (renderedCount < totalCount && 'IntersectionObserver' in window) {
    var sentinel = document.getElementById('loadingSentinel');
    var observer = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting && renderedCount < totalCount) {
        renderBatch(BATCH_SIZE);
        if (renderedCount >= totalCount) observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  // HTMLエスケープ
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // グローバル関数
  window.toggleCard = function(header) {
    header.closest('.product-card').classList.toggle('open');
  };

  window.copyText = function(btn, id) {
    var el = document.getElementById(id);
    var text = el.textContent || el.innerText;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { showCopied(btn); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopied(btn);
    }
  };

  function showCopied(btn) {
    var orig = btn.textContent;
    btn.textContent = 'コピー済み';
    btn.classList.add('copied');
    setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  }

  window.openModal = function(img) {
    document.getElementById('modalImg').src = img.src;
    document.getElementById('imageModal').classList.add('active');
  };

  window.closeModal = function() {
    document.getElementById('imageModal').classList.remove('active');
  };

  // モバイル判定
  function isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  // Web Share API で画像保存
  async function shareImages(urls, productId) {
    try {
      var files = [];
      for (var i = 0; i < urls.length; i++) {
        var res = await fetch(urls[i]);
        var blob = await res.blob();
        var ext = blob.type === 'image/png' ? '.png' : '.jpg';
        files.push(new File([blob], productId + '_' + (i + 1) + ext, { type: blob.type }));
      }
      if (navigator.canShare && navigator.canShare({ files: files })) {
        await navigator.share({ files: files, title: productId + ' の商品画像' });
        return true;
      }
      return false;
    } catch (e) {
      if (e.name === 'AbortError') return true;
      return false;
    }
  }

  window.saveProductImages = async function(btn, productId) {
    var card = btn.closest('.product-card');
    var imgs = card.querySelectorAll('.image-gallery img');
    var urls = Array.from(imgs).map(function(img) { return img.src; });
    if (urls.length === 0) return;

    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">&#x23F3;</span> 保存中...';
    btn.disabled = true;

    if (isMobile()) {
      var shared = await shareImages(urls, productId);
      if (!shared) {
        await window.downloadProductZip(productId);
      }
    } else {
      await window.downloadProductZip(productId);
    }

    btn.innerHTML = '<span class="btn-icon">&#x2705;</span> 保存完了';
    setTimeout(function() { btn.innerHTML = origHtml; btn.disabled = false; }, 2000);
  };

  window.downloadProductZip = async function(productId) {
    var token = new URLSearchParams(window.location.search).get('token');
    if (!token) { alert('トークンが不正です'); return; }
    window.location.href = '/api/kit/zip/' + encodeURIComponent(productId) + '?token=' + encodeURIComponent(token);
  };

})();
</script>
</body>
</html>`;
}
