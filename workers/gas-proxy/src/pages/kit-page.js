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
  .product-details { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 12px; }
  .product-details .detail-col { width: 100%; }
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
  .listing-actions { margin: 12px 0 4px; display: flex; flex-direction: column; gap: 6px; }
  .listing-btn { display: block; width: 100%; padding: 12px; color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; letter-spacing: 0.3px; }
  .listing-btn:active { opacity: 0.8; }
  .listing-btn-browser { background: #ef4444; font-size: 15px; }
  .listing-btn-app { background: #6b7280; font-size: 12px; padding: 10px; }
  .listing-banner { position: fixed; bottom: 0; left: 0; right: 0; background: #1a1a2e; color: #fff; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); z-index: 900; transform: translateY(100%); transition: transform .25s ease; }
  .listing-banner.show { transform: translateY(0); }
  .listing-banner .banner-step { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
  .listing-banner .banner-msg { font-size: 12px; opacity: 0.8; line-height: 1.5; }
  .listing-banner .banner-ref { font-size: 11px; margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 6px; line-height: 1.6; }
  .listing-banner .banner-close { position: absolute; top: 8px; right: 12px; background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; opacity: 0.6; }
  @media (max-width: 480px) { .product-details { flex-direction: column; gap: 8px; } }
</style>
</head>
<body>

<div class="kit-container" id="kitContainer"></div>

<div class="listing-banner" id="listingBanner">
  <button class="banner-close" onclick="closeListing()">&times;</button>
  <div class="banner-step" id="bannerStep"></div>
  <div class="banner-msg" id="bannerMsg"></div>
  <div class="banner-ref" id="bannerRef"></div>
</div>

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
        '<div class="listing-actions">' +
          '<button class="listing-btn listing-btn-browser" onclick="event.stopPropagation();startListingBrowser(' + index + ')">&#x1F310; ブラウザ版メルカリで自動入力</button>' +
          '<button class="listing-btn listing-btn-app" onclick="event.stopPropagation();startListing(' + index + ')">&#x1F4CB; アプリ版はこちら（コピペ）</button>' +
        '</div>' +
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

  // ─── メルカリ出品アシスト（ブラウザ版：自動入力） ───
  window.startListingBrowser = function(index) {
    var item = items[index];
    var data = JSON.stringify({ t: item.title || '', d: item.description || '' });
    navigator.clipboard.writeText(data).then(function() {
      _listingItem = item;
      _listingStep = 0;
      bannerStep.textContent = '\\u2460 ブラウザ版メルカリで出品ページを開いてください';
      bannerMsg.innerHTML = '<div style="margin:8px 0">' +
        '<a href="https://jp.mercari.com/sell/create" target="_blank" rel="noopener" ' +
        'style="display:block;padding:10px;background:#ef4444;color:#fff;border-radius:8px;text-align:center;text-decoration:none;font-weight:700">' +
        'メルカリ出品ページを開く &rarr;</a></div>' +
        '<div style="margin-top:8px;font-size:12px;line-height:1.6">' +
        '\\u2461 出品ページが開いたら、アドレスバーに保存した<strong>ブックマークレット「\\u{1F4E6}デキルン自動入力」</strong>をタップしてください。<br>' +
        'タイトルと説明文が自動入力されます。</div>' +
        '<details style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.7)">' +
        '<summary style="cursor:pointer">初回のみ：ブックマークレットの登録方法</summary>' +
        '<div style="margin-top:6px;line-height:1.8">' +
        '1. まず適当なページをブックマーク（お気に入り）に追加<br>' +
        '2. ブックマークを編集し、名前を「\\u{1F4E6}デキルン自動入力」に変更<br>' +
        '3. URLを以下に差し替えて保存：<br>' +
        '<div style="background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin:4px 0;word-break:break-all;font-family:monospace;font-size:10px;user-select:all">' +
        'javascript:void(navigator.clipboard.readText().then(function(s){try{var d=JSON.parse(s);var inputs=document.querySelectorAll(&quot;input[type=text],input:not([type]),textarea&quot;);for(var i=0;i&lt;inputs.length;i++){var p=inputs[i].getAttribute(&quot;placeholder&quot;)||inputs[i].getAttribute(&quot;aria-label&quot;)||&quot;&quot;;if((p.indexOf(&quot;商品名&quot;)>=0||p.indexOf(&quot;タイトル&quot;)>=0||p.indexOf(&quot;name&quot;)>=0)&amp;&amp;d.t){var nv=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,&quot;value&quot;).set;nv.call(inputs[i],d.t);inputs[i].dispatchEvent(new Event(&quot;input&quot;,{bubbles:true}));inputs[i].dispatchEvent(new Event(&quot;change&quot;,{bubbles:true}))}if(inputs[i].tagName===&quot;TEXTAREA&quot;&amp;&amp;d.d){var nv2=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,&quot;value&quot;).set;nv2.call(inputs[i],d.d);inputs[i].dispatchEvent(new Event(&quot;input&quot;,{bubbles:true}));inputs[i].dispatchEvent(new Event(&quot;change&quot;,{bubbles:true}))}};alert(&quot;\\u2705 自動入力完了&quot;)}catch(e){alert(&quot;\\u274C データ読取失敗: デキルンで出品するボタンを先にタップしてください&quot;)}}))' +
        '</div></div></details>';
      var ref = [];
      if (item.item) ref.push('\\u30AB\\u30C6\\u30B4\\u30EA: ' + item.item + (item.cat3 ? ' > ' + item.cat3 : ''));
      if (item.size) ref.push('\\u30B5\\u30A4\\u30BA: ' + item.size);
      if (item.condition) ref.push('\\u72B6\\u614B: ' + item.condition);
      if (item.gender) ref.push('\\u6027\\u5225: ' + item.gender);
      if (item.priceText) ref.push('\\u4FA1\\u683C: ' + item.priceText);
      bannerRef.textContent = ref.join(' \\uFF5C ');
      banner.classList.add('show');
    });
  };

  // ─── メルカリ出品アシスト（アプリ版：コピペ） ───
  var _listingItem = null;
  var _listingStep = 0; // 0=inactive, 1=title copied, 2=desc copied, 3=done
  var banner = document.getElementById('listingBanner');
  var bannerStep = document.getElementById('bannerStep');
  var bannerMsg = document.getElementById('bannerMsg');
  var bannerRef = document.getElementById('bannerRef');

  window.startListing = function(index) {
    _listingItem = items[index];
    _listingStep = 1;
    var title = _listingItem.title || '';
    navigator.clipboard.writeText(title).then(function() {
      bannerStep.textContent = '\\u2460 タイトルをコピーしました \\u2713';
      bannerMsg.textContent = 'メルカリアプリの出品画面を開いて「商品名」に貼り付けてください。貼り付けたらこの画面に戻ってください。';
      var ref = [];
      if (_listingItem.item) ref.push('\\u30AB\\u30C6\\u30B4\\u30EA: ' + _listingItem.item + (_listingItem.cat3 ? ' > ' + _listingItem.cat3 : ''));
      if (_listingItem.size) ref.push('\\u30B5\\u30A4\\u30BA: ' + _listingItem.size);
      if (_listingItem.condition) ref.push('\\u72B6\\u614B: ' + _listingItem.condition);
      if (_listingItem.gender) ref.push('\\u6027\\u5225: ' + _listingItem.gender);
      if (_listingItem.priceText) ref.push('\\u4FA1\\u683C: ' + _listingItem.priceText);
      bannerRef.textContent = ref.join(' \\uFF5C ');
      banner.classList.add('show');
    });
  };

  window.closeListing = function() {
    _listingStep = 0;
    _listingItem = null;
    banner.classList.remove('show');
  };

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible' || !_listingItem) return;

    if (_listingStep === 1) {
      _listingStep = 2;
      var desc = _listingItem.description || '';
      navigator.clipboard.writeText(desc).then(function() {
        bannerStep.textContent = '\\u2461 説明文をコピーしました \\u2713';
        bannerMsg.textContent = 'メルカリの「商品の説明」に貼り付けてください。貼り付けたらこの画面に戻ってください。';
      });
    } else if (_listingStep === 2) {
      _listingStep = 3;
      bannerStep.textContent = '\\u2705 出品準備完了！';
      bannerMsg.textContent = 'タイトルと説明文の貼り付けが完了しました。カテゴリ・配送方法・価格を設定して出品してください。';
      bannerRef.textContent = '';
      setTimeout(function() {
        banner.classList.remove('show');
        _listingStep = 0;
        _listingItem = null;
      }, 5000);
    }
  });

})();
</script>
</body>
</html>`;
}
