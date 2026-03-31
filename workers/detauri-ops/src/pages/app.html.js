/**
 * メインアプリHTML（SPA）
 * 全画面を1つのHTMLに含むシングルページアプリケーション
 */
export function appPage(user) {
  const isAdmin = user.role === 'admin';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#1e293b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="デタウリ業務">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <title>デタウリ業務</title>
  <style>
    /* ========== リセット・ベース ========== */
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;
      background:#f0f2f5;
      -webkit-tap-highlight-color:transparent;
      overscroll-behavior:none;
    }

    /* ========== 画面切替 ========== */
    .screen{display:none;min-height:100vh;padding-bottom:80px}
    .screen.active{display:block}

    /* ========== ヘッダー ========== */
    .hdr{
      background:#1e293b;color:#fff;padding:14px 20px;
      display:flex;align-items:center;justify-content:space-between;
      position:sticky;top:0;z-index:50;
    }
    .hdr h1{font-size:17px;font-weight:700}
    .hdr .back{
      cursor:pointer;font-size:14px;padding:4px 10px;
      background:rgba(255,255,255,.15);border-radius:6px;border:none;color:#fff;
    }
    .hdr .av{
      width:32px;height:32px;border-radius:50%;background:#3b82f6;
      display:flex;align-items:center;justify-content:center;
      font-size:14px;font-weight:700;cursor:pointer;
    }

    /* ========== 大きなアクションボタン ========== */
    .big-btn{
      display:block;width:calc(100% - 32px);margin:12px 16px;padding:20px;
      border:none;border-radius:16px;font-size:20px;font-weight:700;
      cursor:pointer;text-align:center;color:#fff;position:relative;
    }
    .big-btn:active{opacity:.85;transform:scale(.98)}
    .big-btn .sub{font-size:13px;font-weight:400;opacity:.85;margin-top:4px}

    /* ========== カード ========== */
    .card{background:#fff;border-radius:14px;padding:16px;margin:10px 16px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
    .card-t{font-size:12px;color:#94a3b8;font-weight:600;margin-bottom:10px;letter-spacing:.5px}

    /* ========== 商品行 ========== */
    .prow{
      display:flex;align-items:center;padding:14px;margin:6px 16px;
      background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);
      cursor:pointer;transition:transform .1s;
    }
    .prow:active{transform:scale(.98)}
    .prow .icon{
      width:48px;height:48px;border-radius:10px;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;margin-right:12px;flex-shrink:0;
    }
    .prow .info{flex:1;min-width:0}
    .prow .id{font-size:16px;font-weight:700;color:#1e293b}
    .prow .meta{font-size:12px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .prow .arrow{color:#94a3b8;font-size:20px;margin-left:8px}

    /* ========== ステータスドット ========== */
    .dots{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
    .dot{font-size:11px;padding:2px 6px;border-radius:6px}
    .dot-red{background:#fee2e2;color:#dc2626}
    .dot-grn{background:#d1fae5;color:#065f46}
    .dot-yel{background:#fef3c7;color:#92400e}
    .dot-blu{background:#dbeafe;color:#1e40af}

    /* ========== プログレスバー ========== */
    .prog{display:flex;align-items:center;gap:12px;padding:0 16px;margin:8px 0}
    .prog-bar{flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}
    .prog-fill{height:100%;border-radius:4px;transition:width .3s}
    .prog-txt{font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap}

    /* ========== フォーム ========== */
    .fg{margin-bottom:14px}
    .fl{font-size:13px;font-weight:600;color:#374151;margin-bottom:5px;display:block}
    .fi{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;background:#fff;outline:none;-webkit-appearance:none;appearance:none}
    input[type="date"].fi{min-height:48px}
    .fi:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
    .fs{
      width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;
      font-size:16px;background:#fff;appearance:none;outline:none;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23666' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;
    }
    .fr{display:flex;gap:8px}.fr .fg{flex:1}

    /* ========== パルスアニメーション ========== */
    @keyframes pulse{
      0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}
      70%{box-shadow:0 0 0 12px rgba(22,163,74,0)}
      100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}
    }

    /* ========== 採寸タイプ選択 ========== */
    .tsel{display:flex;gap:8px;margin-bottom:16px}
    .tbtn{
      flex:1;padding:14px 4px;border:2px solid #e2e8f0;border-radius:12px;
      text-align:center;cursor:pointer;font-weight:700;color:#94a3b8;
      background:#fff;font-size:16px;
    }
    .tbtn.on{border-color:#2563eb;color:#2563eb;background:#eff6ff}

    /* ========== 採寸グリッド ========== */
    .mg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .ml{font-size:12px;color:#64748b;margin-bottom:3px}
    .mi{
      width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;
      font-size:17px;text-align:right;outline:none;
    }
    .mi:focus{border-color:#3b82f6}

    /* ========== 確認項目行 ========== */
    .ci{
      display:flex;justify-content:space-between;align-items:center;
      padding:10px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;
    }
    .ci:last-child{border-bottom:none}
    .ci-l{font-size:13px;color:#64748b}
    .ci-v{font-size:14px;font-weight:600;color:#1e293b;text-align:right}
    .ci-ai{font-size:8px;padding:2px 4px;background:#dbeafe;color:#1e40af;border-radius:3px;margin-left:3px;vertical-align:middle}

    /* ========== 写真 ========== */
    .cam{
      border:2px dashed #94a3b8;border-radius:14px;padding:28px;
      text-align:center;color:#64748b;margin-bottom:12px;cursor:pointer;background:#fafafa;
    }
    .cam:active{background:#f1f5f9}
    .cam .ic{font-size:48px}
    .pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
    .pthumb{
      aspect-ratio:1;background:linear-gradient(135deg,#dbeafe,#bfdbfe);
      border-radius:8px;display:flex;align-items:center;justify-content:center;
      font-size:18px;position:relative;overflow:hidden;
    }
    .pthumb img{width:100%;height:100%;object-fit:cover}
    .pthumb .n{
      position:absolute;top:2px;left:3px;font-size:8px;
      background:#1e293b;color:#fff;border-radius:3px;padding:1px 4px;
    }
    .pthumb .del{
      position:absolute;top:2px;right:3px;font-size:12px;
      background:rgba(220,38,38,.8);color:#fff;border-radius:50%;
      width:18px;height:18px;display:flex;align-items:center;justify-content:center;
      cursor:pointer;
    }

    /* ========== ガイドボックス ========== */
    .guide{
      background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 10px 10px 0;
      padding:12px 14px;margin:8px 16px;font-size:13px;color:#1e40af;
    }

    /* ========== 移動報告の商品行 ========== */
    .trow{
      display:flex;align-items:center;padding:12px;margin:4px 16px;
      background:#fff;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.05);
      cursor:pointer;
    }
    .trow:active{background:#f8fafc}
    .trow input[type="checkbox"]{width:22px;height:22px;margin-right:12px;pointer-events:none;accent-color:#2563eb}
    .trow.checked{background:#eff6ff}
    .trow .info{flex:1}

    /* ========== パディング ========== */
    .pad{padding:0 16px 24px;overflow:hidden}

    /* ========== 更新バナー ========== */
    .update-banner{
      display:none;position:fixed;top:0;left:0;right:0;z-index:999;
      background:#1e40af;color:#fff;padding:12px 16px;
      text-align:center;font-size:14px;font-weight:600;
      cursor:pointer;
    }
    .update-banner.show{display:block}

    /* ========== ローディング ========== */
    .loading{text-align:center;padding:40px;color:#94a3b8;font-size:14px}
    .spinner{
      display:inline-block;width:24px;height:24px;border:3px solid #e2e8f0;
      border-top-color:#3b82f6;border-radius:50%;animation:spin .6s linear infinite;
    }
    @keyframes spin{to{transform:rotate(360deg)}}

    /* ========== トースト ========== */
    .toast{
      position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
      background:#1e293b;color:#fff;padding:12px 24px;border-radius:10px;
      font-size:14px;z-index:200;opacity:0;transition:opacity .3s;
      pointer-events:none;max-width:90%;text-align:center;
    }
    .toast.show{opacity:1}

    /* ========== 編集モーダル ========== */
    .modal-overlay{
      display:none;position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,.5);z-index:100;
      align-items:flex-end;justify-content:center;
    }
    .modal-overlay.show{display:flex}
    .modal{
      background:#fff;border-radius:20px 20px 0 0;padding:24px;
      width:100%;max-width:500px;max-height:80vh;overflow-y:auto;
    }
    .modal h3{font-size:16px;font-weight:700;margin-bottom:16px}
    .modal .close-btn{
      position:absolute;right:16px;top:16px;border:none;background:none;
      font-size:20px;cursor:pointer;color:#94a3b8;
    }

    /* ========== スタッフ行（管理者） ========== */
    .staff-row{
      padding:10px 0;border-bottom:1px solid #f1f5f9;
      display:flex;align-items:center;
    }
    .staff-row:last-child{border-bottom:none}
    .staff-av{
      width:36px;height:36px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      margin-right:10px;font-weight:600;font-size:14px;
    }

    /* ========== 合計表示 ========== */
    .total-display{
      background:#f0fdf4;border-radius:8px;padding:8px;
      text-align:center;margin-bottom:12px;font-size:13px;color:#065f46;
    }

    /* ========== ドラッグ&ドロップ並び替え ========== */
    .pgrid .pthumb { touch-action: none; user-select: none; transition: transform 0.15s; }
    .pthumb.dragging { opacity: 0.5; transform: scale(1.1); box-shadow: 0 4px 12px rgba(0,0,0,.3); z-index: 10; }
    .pthumb.drag-over { border: 2px dashed #3b82f6; }
  </style>
</head>
<body>

<!-- 更新通知バナー -->
<div class="update-banner" id="updateBanner" onclick="location.reload()">
  新しいバージョンがあります。タップして更新してください。
</div>

<!-- トースト -->
<div class="toast" id="toast"></div>

<!-- ========================================== -->
<!-- ホーム画面 -->
<!-- ========================================== -->
<div class="screen active" id="screen-home">
  <div class="hdr">
    <h1>👕 デタウリ業務</h1>
    <div class="av" id="userAvatar" onclick="showScreen('${isAdmin ? 'admin' : 'home'}')">${isAdmin ? '管' : ''}</div>
  </div>

  <!-- 次にやること -->
  <div style="padding:16px 16px 0">
    <div style="font-size:13px;color:#64748b;margin-bottom:6px">📌 次にやること</div>
  </div>
  <button class="big-btn" id="homePhotoBtn" style="background:#2563eb" onclick="startPhotoMode()">
    📷 写真を撮る
    <div class="sub" id="homePhotoCount">読み込み中...</div>
  </button>
  <button class="big-btn" id="homeMeasureBtn" style="background:#7c3aed" onclick="startMeasureMode()">
    📏 サイズ＋商品情報を入力する
    <div class="sub" id="homeMeasureCount">読み込み中...</div>
  </button>
  <button class="big-btn" id="homeListBtn" style="background:#16a34a" onclick="showScreen('list')">
    ✓ 確認して出品する
    <div class="sub" id="homeReadyCount">読み込み中...</div>
  </button>

  <!-- バッチカード（進捗） -->
  <div id="homeBatches"><div class="loading"><div class="spinner"></div><br>読み込み中...</div></div>

  <!-- 移動報告リンク -->
  <div class="prow" onclick="showScreen('move')">
    <div class="icon" style="background:#dbeafe">📦→</div>
    <div class="info">
      <div class="id">商品を送る</div>
      <div class="meta" id="homeTransferMeta">移動報告を作成</div>
    </div>
    <div class="arrow">›</div>
  </div>

  ${isAdmin ? `
  <!-- 管理者メニュー -->
  <div class="prow" onclick="showScreen('admin')" style="margin-top:8px">
    <div class="icon" style="background:#fef3c7">📊</div>
    <div class="info">
      <div class="id">管理メニュー</div>
      <div class="meta">仕入れ登録・スタッフ管理</div>
    </div>
    <div class="arrow">›</div>
  </div>
  ` : ''}
</div>

<!-- ========================================== -->
<!-- 点数入力画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-count">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>📦 いくつ入ってた？</h1>
    <span></span>
  </div>
  <div class="card">
    <div style="font-size:14px;color:#374151;line-height:2">
      <p>📅 <strong id="countBatchDate">-</strong></p>
    </div>
    <div style="background:#eff6ff;border-radius:8px;padding:10px 12px;margin-top:10px">
      <div style="font-size:11px;color:#64748b">📝 メモ:</div>
      <div style="font-size:15px;color:#1e293b;margin-top:2px;font-weight:600" id="countBatchMemo">-</div>
    </div>
  </div>
  <div class="card">
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;text-align:center">ベールの中に何着ありましたか？</div>
    <input class="fi" type="number" inputmode="numeric" id="countInput" placeholder="数字を入力" style="font-size:32px;text-align:center;padding:16px;font-weight:700">
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:12px 0">入力すると商品番号が自動で振られます</p>
    <button class="big-btn" style="background:#2563eb;width:100%;margin:8px 0" onclick="submitCount()">決定</button>
  </div>
</div>

<!-- ========================================== -->
<!-- 撮影モード画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-photo">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>📷 写真を撮る</h1>
    <span style="font-size:13px;background:rgba(255,255,255,.2);padding:4px 8px;border-radius:6px" id="photoProgress">- / -</span>
  </div>

  <!-- 商品番号 + ナビ -->
  <div style="padding:12px 16px;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:22px;font-weight:800" id="photoManagedId">-</div>
    <div style="display:flex;gap:6px">
      <button style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:14px;cursor:pointer" onclick="photoNav(-1)">← 前</button>
      <button style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:14px;cursor:pointer" onclick="photoNav(1)">次 →</button>
    </div>
  </div>

  <div class="pad" style="padding-top:8px">
    <!-- 撮影ガイド -->
    <div style="background:#eff6ff;border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:8px">📸 撮り方</div>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
        <div style="min-width:64px;text-align:center">
          <div style="width:56px;height:56px;background:#3b82f6;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto;color:#fff">👕</div>
          <div style="font-size:11px;color:#1e40af;margin-top:4px;font-weight:700">1枚目</div>
        </div>
        <div style="font-size:13px;color:#1e40af;line-height:1.5">
          <strong>前からの全体写真</strong><br>
          <span style="font-size:11px;color:#64748b">服の全体が1枚に収まるように</span>
        </div>
      </div>
      <div style="font-size:12px;color:#64748b;line-height:1.6;border-top:1px solid #bfdbfe;padding-top:8px">
        2枚目〜10枚目は自由に撮ってください<br>
        （タグ・ロゴ・傷・裏側・ディテールなど）<br>
        <span style="color:#dc2626;font-weight:600">※ 最低4枚は必要です</span>
      </div>
    </div>

    <!-- 撮影 / 画像選択ボタン -->
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div class="cam" style="flex:1;margin:0;padding:20px 8px" onclick="document.getElementById('photoCameraInput').click()">
        <div class="ic">📷</div>
        <div style="font-size:14px;font-weight:600;margin-top:4px">撮影する</div>
      </div>
      <div class="cam" style="flex:1;margin:0;padding:20px 8px;border-color:#3b82f6" onclick="document.getElementById('photoGalleryInput').click()">
        <div class="ic">🖼️</div>
        <div style="font-size:14px;font-weight:600;margin-top:4px">画像から選ぶ</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">複数選択OK</div>
      </div>
    </div>
    <input type="file" accept="image/*" capture="environment" id="photoCameraInput" style="display:none" onchange="handlePhotoFiles(this.files)">
    <input type="file" accept="image/*" multiple id="photoGalleryInput" style="display:none" onchange="handlePhotoFiles(this.files)">

    <!-- サムネイルグリッド -->
    <div class="pgrid" id="photoGrid"></div>
    <p style="font-size:12px;text-align:center;margin-bottom:12px" id="photoStatus">まだ撮影していません</p>

    <button class="big-btn" style="background:#2563eb;width:100%;margin:8px 0" onclick="savePhotosAndNext()">保存して次へ →</button>
  </div>
</div>

<!-- ========================================== -->
<!-- 採寸モード画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-measure">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>📏 サイズ＋商品情報</h1>
    <span style="font-size:13px;background:rgba(255,255,255,.2);padding:4px 8px;border-radius:6px" id="measureProgress">- / -</span>
  </div>

  <!-- 商品番号 + ナビ -->
  <div style="padding:12px 16px;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:22px;font-weight:800" id="measureManagedId">-</div>
    <div style="display:flex;gap:6px">
      <button style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:14px;cursor:pointer" onclick="measureNav(-1)">← 前</button>
      <button style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:14px;cursor:pointer" onclick="measureNav(1)">次 →</button>
    </div>
  </div>

  <!-- 商品画像プレビュー -->
  <div id="measurePreview"></div>

  <div class="pad" style="padding-top:12px">
    <!-- 測り方ガイド -->
    <div style="background:#f5f3ff;border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#6d28d9;margin-bottom:6px">📏 測り方</div>
      <div style="font-size:12px;color:#5b21b6;line-height:1.6">
        ・服を<strong>平置き</strong>にして測ります<br>
        ・メジャーはたるまないように<br>
        ・<strong>cm単位</strong>で小数点は四捨五入
      </div>
    </div>

    <div style="font-size:15px;font-weight:700;margin-bottom:10px">この服は何ですか？</div>
    <!-- 採寸タイプ4択 -->
    <div class="tsel" id="measureTypeSelector">
      <div class="tbtn on" onclick="selectMeasureType('tops',this)">👕<br>上</div>
      <div class="tbtn" onclick="selectMeasureType('pants',this)">👖<br>下</div>
      <div class="tbtn" onclick="selectMeasureType('onepiece',this)">👗<br>ワンピ</div>
      <div class="tbtn" onclick="selectMeasureType('suit',this)">🤵<br>上下</div>
    </div>

    <!-- 上（トップス）の入力フィールド -->
    <div id="mt-tops" class="measure-fields mg">
      <div><div class="ml">着丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="length"></div>
      <div><div class="ml">肩幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="shoulder"></div>
      <div><div class="ml">身幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="chest"></div>
      <div><div class="ml">袖丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="sleeve"></div>
      <div><div class="ml">裄丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="yuki"></div>
    </div>

    <!-- 下（パンツ・スカート）の入力フィールド -->
    <div id="mt-pants" class="measure-fields mg" style="display:none">
      <div><div class="ml">総丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="totalLength"></div>
      <div><div class="ml">ウエスト cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="waist"></div>
      <div><div class="ml">股上 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="rise"></div>
      <div><div class="ml">股下 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="inseam"></div>
      <div><div class="ml">ワタリ cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="thigh"></div>
      <div><div class="ml">裾幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="hem"></div>
      <div><div class="ml">ヒップ cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="hip"></div>
    </div>

    <!-- ワンピースの入力フィールド -->
    <div id="mt-onepiece" class="measure-fields mg" style="display:none">
      <div><div class="ml">着丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="length"></div>
      <div><div class="ml">肩幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="shoulder"></div>
      <div><div class="ml">身幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="chest"></div>
      <div><div class="ml">袖丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="sleeve"></div>
      <div><div class="ml">総丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="totalLength"></div>
      <div><div class="ml">ウエスト cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="waist"></div>
    </div>

    <!-- 上下セットの入力フィールド -->
    <div id="mt-suit" class="measure-fields" style="display:none">
      <p style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:8px">上着</p>
      <div class="mg" style="margin-bottom:14px">
        <div><div class="ml">着丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="jacketLength"></div>
        <div><div class="ml">肩幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="jacketShoulder"></div>
        <div><div class="ml">身幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="jacketChest"></div>
        <div><div class="ml">袖丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="jacketSleeve"></div>
      </div>
      <p style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:8px">ズボン・スカート <span style="font-size:11px;color:#94a3b8;font-weight:400">（上だけなら空欄OK）</span></p>
      <div class="mg">
        <div><div class="ml">総丈 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsLength"></div>
        <div><div class="ml">ウエスト cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsWaist"></div>
        <div><div class="ml">股上 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsRise"></div>
        <div><div class="ml">股下 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsInseam"></div>
        <div><div class="ml">ワタリ cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsThigh"></div>
        <div><div class="ml">裾幅 cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsHem"></div>
        <div><div class="ml">ヒップ cm</div><input class="mi" type="number" inputmode="decimal" placeholder="—" data-key="pantsHip"></div>
      </div>
    </div>

    <!-- 商品情報入力（AI自動生成結果を確認・修正） -->
    <div style="margin-top:20px;border-top:2px solid #e2e8f0;padding-top:16px">
      <div style="font-size:15px;font-weight:700;margin-bottom:10px">📝 商品情報</div>
      <div id="measureInfoStatus" style="font-size:12px;color:#94a3b8;margin-bottom:10px">AI自動生成の結果があれば表示されます</div>
      <div id="measureInfoFields">
        <div class="fg"><label class="fl">ブランド</label><input class="fi" id="mi_brand" placeholder="例: UNITED ARROWS"></div>
        <div class="fg"><label class="fl">性別</label>
          <select class="fs" id="mi_gender" onchange="onMeasureGenderChange()">
            <option value="">選んでください</option>
            <option value="レディース">レディース</option>
            <option value="メンズ">メンズ</option>
            <option value="ユニセックス">ユニセックス</option>
            <option value="キッズ">キッズ</option>
          </select>
        </div>
        <div class="fr">
          <div class="fg"><label class="fl">カテゴリ（大）</label><select class="fs" id="mi_cat2" onchange="onMeasureCat2Change()"><option value="">選んでください</option></select></div>
          <div class="fg"><label class="fl">カテゴリ（小）</label><select class="fs" id="mi_cat3"><option value="">選んでください</option></select></div>
        </div>
        <div class="fr">
          <div class="fg"><label class="fl">タグ表記サイズ</label><input class="fi" id="mi_tagSize" placeholder="例: 38, M, Free"></div>
          <div class="fg"><label class="fl">カラー</label>
            <select class="fs" id="mi_color"><option value="">選んでください</option></select>
          </div>
        </div>
        <div class="fg"><label class="fl">デザイン特徴</label><input class="fi" id="mi_features" placeholder="例: ストライプ、ロゴ刺繍"></div>
        <div class="fr">
          <div class="fg"><label class="fl">ポケット</label>
            <select class="fs" id="mi_pocket"><option value="">選んでください</option><option value="あり">あり</option><option value="なし">なし</option></select>
          </div>
          <div class="fg"><label class="fl">発送方法</label>
            <select class="fs" id="mi_shipping"><option value="">選んでください</option></select>
          </div>
        </div>
        <div class="fg"><label class="fl">傷・汚れ詳細</label><input class="fi" id="mi_damage" placeholder="なければ空欄でOK"></div>
      </div>
    </div>

    <button class="big-btn" style="background:#2563eb;width:100%;margin:16px 0" onclick="saveMeasurementsAndNext()">保存して次へ →</button>
  </div>
</div>

<!-- ========================================== -->
<!-- 確認・出品リスト画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-list">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>✓ 確認して出品</h1>
    <span></span>
  </div>

  <div style="padding:12px 16px 4px">
    <div style="font-size:14px;color:#374151">写真もサイズも終わった商品です。<br><strong>タップして確認 → 出品できます。</strong></div>
  </div>

  <!-- 出品可能な商品一覧 -->
  <div id="listReady"><div class="loading"><div class="spinner"></div><br>読み込み中...</div></div>

  <!-- 出品済みリスト -->
  <div style="padding:12px 16px 4px;margin-top:8px">
    <div style="font-size:12px;color:#94a3b8">出品済み</div>
  </div>
  <div id="listDone"></div>
</div>

<!-- ========================================== -->
<!-- 個別確認・編集画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-edit">
  <div class="hdr">
    <button class="back" onclick="showScreen('list')">← 戻る</button>
    <h1 id="editManagedId">-</h1>
    <span></span>
  </div>

  <div class="pad" style="padding-top:12px">
    <!-- 写真サムネイル -->
    <div class="pgrid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px" id="editPhotoGrid"></div>

    <!-- 写真追加ボタン -->
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;padding:10px;border:1px dashed #94a3b8;border-radius:10px;text-align:center;cursor:pointer;font-size:13px;color:#64748b;background:#fafafa" onclick="document.getElementById('editPhotoCameraInput').click()">
        📷 写真を追加
      </div>
      <div style="flex:1;padding:10px;border:1px dashed #3b82f6;border-radius:10px;text-align:center;cursor:pointer;font-size:13px;color:#3b82f6;background:#fafafa" onclick="document.getElementById('editPhotoGalleryInput').click()">
        🖼️ 画像から選ぶ
      </div>
    </div>
    <input type="file" accept="image/*" capture="environment" id="editPhotoCameraInput" style="display:none" onchange="handleEditPhotoFiles(this.files)">
    <input type="file" accept="image/*" multiple id="editPhotoGalleryInput" style="display:none" onchange="handleEditPhotoFiles(this.files)">

    <!-- AI自動入力項目（タップで修正可能） -->
    <div style="background:#f8fafc;border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:8px">写真から自動で読み取りました（間違っていたらタップして直せます）</div>
      <div id="editAiFields"></div>
    </div>

    <!-- 状態選択（手動必須） -->
    <div style="background:#fff;border:2px solid #f59e0b;border-radius:12px;padding:14px;margin-bottom:12px" id="editConditionBox">
      <div style="font-size:14px;font-weight:700;color:#92400e;margin-bottom:8px">⚠️ 状態を選んでください</div>
      <select class="fs" style="font-size:16px;border-color:#f59e0b" id="editConditionSelect" onchange="onConditionChange()">
        <option value="">選んでください ▼</option>
      </select>
    </div>

    <!-- 採寸サマリー -->
    <div style="background:#f0fdf4;border-radius:12px;padding:14px;margin-bottom:16px;cursor:pointer" id="editMeasureSummary" onclick="openMeasureEdit()">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:#065f46;font-weight:600">📏 サイズ</div>
        <span style="font-size:12px;color:#2563eb">修正する →</span>
      </div>
      <div style="font-size:12px;color:#064e3b;margin-top:6px" id="editMeasureText">-</div>
    </div>

    <!-- 出品ボタン -->
    <button class="big-btn" style="background:#16a34a;width:100%;margin:0 0 8px" id="editRegisterBtn" onclick="registerProduct()">
      ✓ この商品を出品する
    </button>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-bottom:8px">デタウリに掲載されます（数分後に反映）</p>
    <button style="width:100%;padding:12px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:14px;color:#94a3b8;cursor:pointer" onclick="showScreen('list')">まだ出品しない（あとで）</button>
  </div>
</div>

<!-- ========================================== -->
<!-- 移動報告画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-move">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>📦 商品を送る</h1>
    <span></span>
  </div>

  <div class="card">
    <div style="text-align:center">
      <div style="font-size:13px;color:#64748b">送り先</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px" id="moveDestination">-</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">🔒 管理者が設定</div>
    </div>
  </div>

  <div style="padding:4px 16px 0">
    <div style="font-size:14px;font-weight:600;margin-bottom:6px" id="moveInventoryCount">送る商品を選んでください</div>
  </div>

  <!-- 在庫リスト -->
  <div id="moveInventoryList"><div class="loading"><div class="spinner"></div><br>読み込み中...</div></div>

  <div style="padding:8px 16px;font-size:12px;color:#64748b;text-align:center" id="moveSelectedCount">0件選んでいます</div>

  <!-- 箱ID -->
  <div class="card">
    <div style="text-align:center">
      <div style="font-size:12px;color:#64748b">段ボールに書く番号</div>
      <div style="font-size:28px;font-weight:800;font-family:monospace;color:#1e293b;margin:6px 0" id="moveBoxId">-</div>
    </div>
  </div>

  <button class="big-btn" style="background:#f59e0b" onclick="submitTransfer()">
    📦 <span id="moveSubmitText">選んだ商品を送る</span>
  </button>
</div>

${isAdmin ? `
<!-- ========================================== -->
<!-- 管理者ダッシュボード画面 -->
<!-- ========================================== -->
<div class="screen" id="screen-admin">
  <div class="hdr">
    <button class="back" onclick="showScreen('home')">← 戻る</button>
    <h1>📊 管理</h1>
    <div class="av" style="background:#f59e0b">管</div>
  </div>

  <!-- 全体進捗 -->
  <div class="card">
    <div class="card-t">全体の進捗</div>
    <div style="display:flex;justify-content:space-around;text-align:center" id="adminOverview">
      <div><div style="font-size:28px;font-weight:800" id="adminPending">-</div><div style="font-size:11px;color:#64748b">まだの商品</div></div>
      <div><div style="font-size:28px;font-weight:800;color:#22c55e" id="adminListed">-</div><div style="font-size:11px;color:#64748b">出品中</div></div>
      <div><div style="font-size:28px;font-weight:800;color:#8b5cf6" id="adminSold">-</div><div style="font-size:11px;color:#64748b">売れた</div></div>
    </div>
  </div>

  <!-- スタッフ別 -->
  <div class="card">
    <div class="card-t">スタッフ</div>
    <div id="adminStaffList"><div class="loading"><div class="spinner"></div></div></div>
  </div>

  <!-- クイックアクション -->
  <div style="display:flex;gap:8px;padding:0 16px;flex-wrap:wrap">
    <button style="flex:1;padding:12px;border:1px solid #ddd;background:#fff;border-radius:10px;font-size:13px;cursor:pointer" onclick="showScreen('batch')">+ 仕入れ登録</button>
    <button style="flex:1;padding:12px;border:1px solid #ddd;background:#fff;border-radius:10px;font-size:13px;cursor:pointer" onclick="showStaffInvite()">スタッフ招待</button>
  </div>
</div>

<!-- ========================================== -->
<!-- 仕入れ登録画面（管理者のみ） -->
<!-- ========================================== -->
<div class="screen" id="screen-batch">
  <div class="hdr">
    <button class="back" onclick="showScreen('admin')">← 戻る</button>
    <h1>+ 仕入れ登録</h1>
    <span></span>
  </div>
  <div class="pad" style="padding-top:16px">
    <div class="fg">
      <label class="fl">仕入れ日</label>
      <input class="fi" type="date" id="batchDate">
    </div>
    <div class="fg">
      <label class="fl">区分コード</label>
      <select class="fs" id="batchCode"></select>
    </div>
    <div class="fr">
      <div class="fg">
        <label class="fl">商品金額（円）</label>
        <input class="fi" type="number" inputmode="numeric" id="batchAmount" placeholder="0" oninput="updateBatchTotal()">
      </div>
      <div class="fg">
        <label class="fl">送料（円）</label>
        <input class="fi" type="number" inputmode="numeric" id="batchShipping" placeholder="0" oninput="updateBatchTotal()">
      </div>
    </div>
    <div class="total-display" id="batchTotal">合計 ¥0</div>
    <div class="fg">
      <label class="fl">渡す相手</label>
      <select class="fs" id="batchAssignee"></select>
    </div>
    <div class="fg">
      <label class="fl">メモ（何が入ってるか等）</label>
      <input class="fi" id="batchMemo" placeholder="例: ベール30kg メンズ中心">
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#64748b">
      ※ 中身の点数は受け取った人が数えます<br>※ 商品番号は点数入力後に自動で振られます
    </div>
    <button class="big-btn" style="background:#2563eb;width:100%;margin:0" onclick="submitBatch()">登録する</button>
  </div>
</div>
` : ''}

<!-- ========================================== -->
<!-- 編集モーダル（項目タップ時） -->
<!-- ========================================== -->
<div class="modal-overlay" id="editModal">
  <div class="modal">
    <h3 id="editModalTitle">-</h3>
    <div id="editModalContent"></div>
    <button class="big-btn" style="background:#2563eb;width:100%;margin:16px 0 0" onclick="saveModalEdit()">保存</button>
    <button style="width:100%;padding:12px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:14px;color:#94a3b8;cursor:pointer;margin-top:8px" onclick="closeModal()">キャンセル</button>
  </div>
</div>

<!-- 採寸修正モーダル -->
<div class="modal-overlay" id="measureEditModal">
  <div class="modal" style="max-height:80vh;overflow-y:auto">
    <h3>📏 サイズを修正</h3>
    <div class="tsel" id="measureEditTypeSelector"></div>
    <div id="measureEditFields"></div>
    <button class="big-btn" style="background:#2563eb;width:100%;margin:16px 0 0" onclick="saveMeasureEdit()">保存</button>
    <button style="width:100%;padding:12px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:14px;color:#94a3b8;cursor:pointer;margin-top:8px" onclick="closeMeasureModal()">キャンセル</button>
  </div>
</div>

<!-- ========================================== -->
<!-- スタッフ招待モーダル（管理者用） -->
<!-- ========================================== -->
<div class="modal-overlay" id="staffModal">
  <div class="modal">
    <h3>スタッフ招待</h3>
    <div class="fg">
      <label class="fl">メールアドレス</label>
      <input class="fi" type="email" id="staffEmail" placeholder="staff@example.com">
    </div>
    <div class="fg">
      <label class="fl">表示名</label>
      <input class="fi" id="staffName" placeholder="例: 青木">
    </div>
    <div class="fg">
      <label class="fl">初期パスワード</label>
      <input class="fi" id="staffPassword" placeholder="8文字以上">
    </div>
    <button class="big-btn" style="background:#2563eb;width:100%;margin:16px 0 0" onclick="createStaff()">招待する</button>
    <button style="width:100%;padding:12px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:14px;color:#94a3b8;cursor:pointer;margin-top:8px" onclick="closeStaffModal()">キャンセル</button>
  </div>
</div>

<script>
// ========================================
// ユーザー情報・マスタデータ埋め込み
// ========================================
window.__USER__ = ${JSON.stringify(user)};

// マスタデータ（config.jsからインライン）
const MASTER = {
  // カテゴリ2 → カテゴリ3 マッピング
  CAT2_TO_CAT3: ${JSON.stringify({
    'トップス': ['ニット/セーター','Tシャツ/カットソー','シャツ/ブラウス','カーディガン','パーカー','トレーナー','スウェット','ポロシャツ','ベスト','チュニック','タンクトップ','アンサンブル','ジャージ','ジレ','ボレロ','キャミソール','ビスチェ','ベアトップ','Tシャツ','シャツ','長袖カットソー','五分袖カットソー','七分袖カットソー','ノースリーブトップス'],
    'ジャケット・アウター': ['テーラードジャケット','ジャンパー','ノーカラージャケット','ブルゾン','ロングコート','ダウンジャケット','マウンテンパーカー','ウールコート','トレンチコート','スプリングコート','ナイロンジャケット','ミリタリージャケット','キルティングジャケット','フリースジャケット','ボアジャケット','デニムジャケット','毛皮ファーコート','レザージャケット','ピーコート','チェスターコート','ダッフルコート','ムートンコート','ステンカラーコート','ライダース','ケープコート','ポンチョ','ダウンベスト','キルティングベスト','カバーオール','モッズコート','Gジャン','Gジャン/デニムジャケット','スタジャン','スカジャン','MA-1','MA-1/フライトジャケット'],
    'パンツ': ['カジュアルパンツ','デニム/ジーンズ','スラックス','イージーパンツ','ワイドパンツ','スウェットパンツ','ハーフパンツ','ショートパンツ','ガウチョパンツ','ワークパンツ','カーゴパンツ','チノパン','スキニーパンツ','ジョガーパンツ','キュロット','サルエルパンツ','ペインターパンツ'],
    'スカート': ['ひざ丈スカート','ロングスカート','ミニスカート'],
    'ワンピース': ['ひざ丈ワンピース','ロングワンピース','ミニワンピース'],
    'ドレス・ブライダル': ['パーティードレス','ウェディングドレス','カラードレス','ナイトドレス','キャバドレス','チャイナドレス'],
    'スーツ・フォーマル': ['ブラックスーツ','礼服','喪服','ブラックフォーマル','フォーマルシャツ','フォーマルベスト','フォーマル小物カフス','モーニング/フロックコート','燕尾服タキシード'],
    'スーツセットアップ': ['スカートセットアップ/ツーピース','パンツセットアップ/ツーピース','パンツセットアップ/スリーピース'],
    'スーツ': ['セットアップ/ツーピース','セットアップ/スリーピース','ビジネススーツ','カジュアルスーツ','ビジネスジャケット','スーツベスト','フォーマルシャツ'],
    'ルームウェア・パジャマ': ['ルームウェア','パジャマ','ガウン','バスローブ','ネグリジェ','腹巻き','ステテコ'],
    'サロペット・オーバーオール': ['サロペット','オールインワン','オーバーオール','つなぎ'],
    'ジャージセットアップ': ['ジャージセットアップ'],
    'マタニティ': ['マタニティ'],
    'キッズ': ['キッズ'],
  })},

  // 採寸タイプ → カテゴリ2
  MEASURE_TYPE_MAP: {
    tops: ['トップス','ジャケット・アウター','マタニティ','キッズ'],
    pants: ['パンツ'],
    skirt: ['スカート'],
    onepiece: ['ワンピース','ドレス・ブライダル'],
    suit: ['スーツ・フォーマル','スーツセットアップ','スーツ','ジャージセットアップ','ルームウェア・パジャマ'],
  },

  // カラー
  COLORS: ${JSON.stringify(['ブラック系','グリーン系','イエロー系','オレンジ系','ホワイト系','グレイ系','ブラウン系','レッド系','ピンク系','パープル系','ブルー系','ベージュ系','ネイビー系','カーキ系','マルチカラー','モノクロ','バイカラー'])},

  // 発送方法
  SHIPPING_METHODS: ${JSON.stringify(['ゆうパケットポスト','ゆうパック ローソン','ゆうパック 郵便局','ネコポス セブン','宅急便 セブン','ネコポス ファミマ','宅急便 ファミマ','ネコポス 営業所','宅急便 営業所','shops 集荷'])},

  // 状態
  CONDITIONS: ${JSON.stringify(['新品、未使用','未使用に近い','目立った傷や汚れなし','やや傷や汚れあり','傷や汚れあり','全体的に状態が悪い'])},

  // 区分コード
  CATEGORY_CODES: ${JSON.stringify(['S','AA','A','B','C','US','G','P','Y'])},

  // 写真の制限
  MAX_PHOTOS: 10,
  MIN_PHOTOS: 4,
};

// カテゴリ2→採寸タイプ逆引き
const CAT2_TO_MEASURE_TYPE = {};
for (const [type, cats] of Object.entries(MASTER.MEASURE_TYPE_MAP)) {
  for (const cat of cats) CAT2_TO_MEASURE_TYPE[cat] = type;
}

// ========================================
// グローバル状態
// ========================================
const state = {
  batches: [],            // バッチ一覧
  currentBatchId: null,   // 選択中バッチID
  products: [],           // 商品一覧（現在のバッチ）
  // 撮影モード
  photoIndex: 0,          // 現在の商品インデックス（写真未撮影リスト内）
  photoProducts: [],      // 写真未撮影の商品リスト
  photoFiles: [],         // 現在の商品の撮影済みファイル
  // 採寸モード
  measureIndex: 0,
  measureProducts: [],    // 採寸未完了の商品リスト
  currentMeasureType: 'tops',
  // 確認・出品
  editingProduct: null,   // 編集中の商品
  editModalField: null,   // 編集モーダルの対象フィールド
  // 移動報告
  moveInventory: [],      // 自分の在庫
  moveSelected: new Set(),
  moveBoxId: '',
  moveDestination: '',
};

// ========================================
// APIコール
// ========================================
async function api(path, data) {
  try {
    const res = await fetch('/api' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('sessionId'),
      },
      body: JSON.stringify(data || {}),
    });
    if (res.status === 401) {
      // セッション切れ → ログイン画面へ
      localStorage.removeItem('sessionId');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return { ok: false, message: 'セッション切れ' };
    }
    return await res.json();
  } catch (e) {
    showToast('ネットワークエラーが発生しました');
    return { ok: false, message: 'ネットワークエラー' };
  }
}

// 画像アップロード
async function uploadPhoto(managedId, file, photoIndex) {
  const formData = new FormData();
  formData.append('images', file);
  formData.append('managedId', managedId);
  try {
    const res = await fetch('/api/upload/images', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('sessionId') },
      body: formData,
    });
    return await res.json();
  } catch (e) {
    return { ok: false, message: 'アップロード失敗' };
  }
}

// ========================================
// 画面切替
// ========================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-' + id);
  if (screen) {
    screen.classList.add('active');
    window.scrollTo(0, 0);
  }
  // 画面遷移時のデータ読み込み
  if (id === 'home') loadHome();
  if (id === 'list') loadListScreen();
  if (id === 'move') loadMoveScreen();
  ${isAdmin ? `
  if (id === 'admin') loadAdminDashboard();
  if (id === 'batch') initBatchForm();
  ` : ''}
}

// ========================================
// トースト通知
// ========================================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ========================================
// ホーム画面
// ========================================
async function loadHome() {
  const res = await api('/batches/list');
  if (!res.ok) return;
  state.batches = (res.batches || []).map(b => ({
    ...b,
    memo: b.note || '',
    dateLabel: b.purchase_date ? b.purchase_date.replace(/-/g, '/') + ' 仕入れ分' : b.id,
  }));

  // 全商品を集計
  let needPhoto = 0, needMeasure = 0, readyCount = 0;
  const batchesHtml = [];
  const pendingBatches = [];

  for (const batch of state.batches) {
    const pRes = await api('/products/list', { batchId: batch.id });
    const products = (pRes.ok ? pRes.products : []) || [];
    const total = products.length;
    const drafts = products.filter(p => p.status === 'draft');
    const photosDone = drafts.filter(p => p.has_photos).length;
    const measuresDone = drafts.filter(p => p.has_measurements).length;
    const listed = products.filter(p => p.status === 'ready' || p.status === 'synced').length;
    const ready = drafts.filter(p => p.has_photos && p.has_measurements).length;

    needPhoto += drafts.length - photosDone;
    needMeasure += drafts.length - measuresDone;
    readyCount += ready;

    if (total === 0) {
      // 点数未入力のバッチ → pendingBatchesに追加
      pendingBatches.push(batch);
    } else {
      const pct = total > 0 ? Math.round(listed / total * 100) : 0;
      batchesHtml.push(\`
        <div class="card">
          <div class="card-t">\${batch.dateLabel || batch.id} 区分\${batch.category_code}（\${total}着）</div>
          <div class="prog">
            <div class="prog-bar"><div class="prog-fill" style="width:\${pct}%;background:#22c55e"></div></div>
            <div class="prog-txt">\${listed}/\${total}</div>
          </div>
          <div style="display:flex;justify-content:space-around;margin-top:10px;font-size:12px;color:#64748b">
            <span>📷 \${photosDone}着 済</span>
            <span>📏 \${measuresDone}着 済</span>
            <span>✅ \${listed}着 出品済</span>
          </div>
        </div>
      \`);
    }
  }

  // 次にやることのカウント更新 + ボタン状態制御
  const photoBtn = document.getElementById('homePhotoBtn');
  const measureBtn = document.getElementById('homeMeasureBtn');
  const listBtn = document.getElementById('homeListBtn');
  const allDrafts = state.batches.length > 0; // バッチが存在するか

  if (needPhoto > 0) {
    document.getElementById('homePhotoCount').textContent = \`\${needPhoto}着がまだ撮れていません\`;
    photoBtn.style.background = '#2563eb';
    photoBtn.style.opacity = '1';
    photoBtn.disabled = false;
    photoBtn.style.pointerEvents = '';
  } else {
    document.getElementById('homePhotoCount').textContent = allDrafts ? 'すべて撮影済み ✓' : '対象の商品がありません';
    photoBtn.style.background = '#94a3b8';
    photoBtn.style.opacity = '.5';
    photoBtn.disabled = true;
    photoBtn.style.pointerEvents = 'none';
  }

  if (needMeasure > 0) {
    document.getElementById('homeMeasureCount').textContent = \`\${needMeasure}着がまだ入力されていません\`;
    measureBtn.style.background = '#7c3aed';
    measureBtn.style.opacity = '1';
    measureBtn.disabled = false;
    measureBtn.style.pointerEvents = '';
  } else {
    document.getElementById('homeMeasureCount').textContent = allDrafts ? 'すべて入力済み ✓' : '対象の商品がありません';
    measureBtn.style.background = '#94a3b8';
    measureBtn.style.opacity = '.5';
    measureBtn.disabled = true;
    measureBtn.style.pointerEvents = 'none';
  }

  if (readyCount > 0) {
    document.getElementById('homeReadyCount').textContent = \`\${readyCount}着が出品できます → タップして確認！\`;
    listBtn.style.background = '#16a34a';
    listBtn.style.opacity = '1';
    listBtn.disabled = false;
    listBtn.style.pointerEvents = '';
    if (needPhoto === 0 && needMeasure === 0) {
      listBtn.style.animation = 'pulse 2s infinite';
    } else {
      listBtn.style.animation = 'none';
    }
  } else {
    document.getElementById('homeReadyCount').textContent = '出品待ちはありません';
    listBtn.style.background = '#94a3b8';
    listBtn.style.opacity = '.5';
    listBtn.disabled = true;
    listBtn.style.pointerEvents = 'none';
    listBtn.style.animation = 'none';
  }

  // 点数報告ボタン
  let pendingHtml = '';
  if (pendingBatches.length > 0) {
    const items = pendingBatches.map(b => \`
      <div class="prow" onclick="openBatchCount('\${b.id}')" style="margin-bottom:4px">
        <div class="icon" style="background:#fef3c7">📦</div>
        <div class="info">
          <div class="id">\${b.dateLabel} 区分\${b.category_code}</div>
          <div class="meta">\${b.memo || '（メモなし）'}</div>
          <div class="dots"><span class="dot dot-red">まだ開けていません</span></div>
        </div>
        <div class="arrow">›</div>
      </div>
    \`).join('');
    pendingHtml = \`
      <div class="card" style="border-left:4px solid #f59e0b">
        <div class="card-t">📦 点数を報告する（\${pendingBatches.length}件）</div>
        \${items}
      </div>
    \`;
  }

  document.getElementById('homeBatches').innerHTML = pendingHtml + batchesHtml.join('');
}

// ========================================
// 点数入力画面
// ========================================
function openBatchCount(batchId) {
  state.currentBatchId = batchId;
  const batch = state.batches.find(b => b.id === batchId);
  if (batch) {
    document.getElementById('countBatchDate').textContent = (batch.dateLabel || batch.id) + ' 区分' + batch.category_code;
    document.getElementById('countBatchMemo').textContent = batch.memo || '（メモなし）';
  }
  document.getElementById('countInput').value = '';
  showScreen('count');
}

async function submitCount() {
  const count = parseInt(document.getElementById('countInput').value, 10);
  if (!count || count < 1) {
    showToast('1以上の数字を入力してください');
    return;
  }
  const res = await api('/batches/count', { batchId: state.currentBatchId, itemCount: count });
  if (res.ok) {
    showToast(\`\${count}着の商品番号を作成しました\`);
    showScreen('home');
  } else {
    showToast(res.message || 'エラーが発生しました');
  }
}

// ========================================
// 撮影モード
// ========================================
async function startPhotoMode() {
  // 全バッチから未登録の商品のみ集める（登録済みは除外）
  state.photoProducts = [];
  for (const batch of state.batches) {
    if (batch.status === 'pending') continue;
    const pRes = await api('/products/list', { batchId: batch.id });
    if (pRes.ok && pRes.products) {
      const unreg = pRes.products.filter(p => p.status === 'draft');
      const notDone = unreg.filter(p => !p.has_photos);
      const done = unreg.filter(p => p.has_photos);
      state.photoProducts.push(...notDone, ...done);
    }
  }
  if (state.photoProducts.length === 0) {
    showToast('写真を撮る商品がありません');
    return;
  }
  state.photoIndex = 0;
  state.photoFiles = [];
  renderPhotoScreen();
  showScreen('photo');
}

function photoNav(dir) {
  // 現在の写真があればバックグラウンドで保存
  if (state.photoFiles.length > 0) {
    savePhotosAndNext(true); // バックグラウンド（awaitしない）
  }
  state.photoIndex += dir;
  if (state.photoIndex < 0) state.photoIndex = 0;
  if (state.photoIndex >= state.photoProducts.length) state.photoIndex = state.photoProducts.length - 1;
  state.photoFiles = [];
  renderPhotoScreen();
}

function renderPhotoScreen() {
  const product = state.photoProducts[state.photoIndex];
  if (!product) return;
  document.getElementById('photoManagedId').textContent = product.managed_id || '-';
  document.getElementById('photoProgress').textContent = \`\${state.photoIndex + 1} / \${state.photoProducts.length}\`;

  // サムネイルグリッド
  renderPhotoGrid();
  updatePhotoStatus();
}

function renderPhotoGrid() {
  const grid = document.getElementById('photoGrid');
  let html = '';
  for (let i = 0; i < state.photoFiles.length; i++) {
    const file = state.photoFiles[i];
    const label = i === 0 ? '1 全体' : String(i + 1);
    const borderStyle = i === 0 ? 'border:2px solid #3b82f6;' : '';
    html += \`<div class="pthumb" data-index="\${i}" style="\${borderStyle}">
      <img src="\${URL.createObjectURL(file)}" alt="写真\${i+1}">
      <span class="n">\${label}</span>
      <span class="del" onclick="removePhoto(\${i})">×</span>
    </div>\`;
  }
  // 空きスロット
  for (let i = state.photoFiles.length; i < MASTER.MAX_PHOTOS; i++) {
    const borderStyle = i === 0 ? 'border:2px solid #3b82f6;' : '';
    const placeholder = i === 0 ? '👕' : (i < MASTER.MIN_PHOTOS ? '📷' : '');
    html += \`<div class="pthumb" style="\${borderStyle}opacity:.4">\${placeholder}<span class="n">\${i === 0 ? '1 全体' : String(i + 1)}</span></div>\`;
  }
  grid.innerHTML = html;
  initDragAndDrop('photoGrid');
}

function updatePhotoStatus() {
  const el = document.getElementById('photoStatus');
  const count = state.photoFiles.length;
  if (count === 0) {
    el.textContent = 'まだ撮影していません';
    el.style.color = '#94a3b8';
  } else if (count < MASTER.MIN_PHOTOS) {
    el.textContent = \`\${count}枚撮影済み（あと\${MASTER.MIN_PHOTOS - count}枚必要）\`;
    el.style.color = '#dc2626';
  } else {
    el.textContent = \`✓ \${count}枚撮影済み（最低\${MASTER.MIN_PHOTOS}枚 / 最大\${MASTER.MAX_PHOTOS}枚）\`;
    el.style.color = '#22c55e';
  }
}

function handlePhotoFiles(files) {
  for (const file of files) {
    if (state.photoFiles.length >= MASTER.MAX_PHOTOS) break;
    state.photoFiles.push(file);
  }
  renderPhotoGrid();
  updatePhotoStatus();
  // ファイル入力をリセット
  const cam = document.getElementById('photoCameraInput');
  const gal = document.getElementById('photoGalleryInput');
  if (cam) cam.value = '';
  if (gal) gal.value = '';
}

function removePhoto(index) {
  state.photoFiles.splice(index, 1);
  renderPhotoGrid();
  updatePhotoStatus();
}

// ========================================
// ドラッグ&ドロップ並び替え
// ========================================
let dragSrcIndex = null;

function initDragAndDrop(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const items = grid.querySelectorAll('.pthumb[data-index]');
  items.forEach(item => {
    item.addEventListener('touchstart', handleDragStart, { passive: false });
    item.addEventListener('touchmove', handleDragMove, { passive: false });
    item.addEventListener('touchend', handleDragEnd);
  });
}

function handleDragStart(e) {
  dragSrcIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add('dragging');
}

function handleDragMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  const thumb = target?.closest('.pthumb[data-index]');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (thumb && parseInt(thumb.dataset.index) !== dragSrcIndex) {
    thumb.classList.add('drag-over');
  }
}

function handleDragEnd(e) {
  const touch = e.changedTouches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  const thumb = target?.closest('.pthumb[data-index]');

  document.querySelectorAll('.dragging,.drag-over').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });

  if (thumb) {
    const dropIndex = parseInt(thumb.dataset.index);
    if (dropIndex !== dragSrcIndex && !isNaN(dropIndex) && !isNaN(dragSrcIndex)) {
      const arr = state.photoFiles;
      const temp = arr[dragSrcIndex];
      arr[dragSrcIndex] = arr[dropIndex];
      arr[dropIndex] = temp;
      renderPhotoGrid();
    }
  }
  dragSrcIndex = null;
}

// ========================================
// 編集画面から写真を追加
// ========================================
async function handleEditPhotoFiles(files) {
  const product = state.editingProduct;
  if (!product) return;

  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;

  showToast('写真をアップロード中...');

  const existingCount = (product.photoUrls ? product.photoUrls.length : 0) || 0;
  let allOk = true;

  for (let i = 0; i < fileArray.length; i++) {
    const photoIndex = existingCount + i + 1;
    const res = await uploadPhoto(product.managed_id, fileArray[i], photoIndex);
    if (!res.ok) {
      allOk = false;
      showToast(\`写真\${i + 1}のアップロードに失敗しました\`);
      break;
    }
  }

  if (allOk) {
    showToast('写真を追加しました');
    openEdit(product.managed_id);
  }

  // ファイル入力をリセット
  const cam = document.getElementById('editPhotoCameraInput');
  const gal = document.getElementById('editPhotoGalleryInput');
  if (cam) cam.value = '';
  if (gal) gal.value = '';
}

async function savePhotosAndNext(silent) {
  if (state.photoFiles.length === 0) return;
  if (!silent && state.photoFiles.length < MASTER.MIN_PHOTOS) {
    alert(\`写真が\${state.photoFiles.length}枚しかありません。\\n最低\${MASTER.MIN_PHOTOS}枚必要です。\\nあと\${MASTER.MIN_PHOTOS - state.photoFiles.length}枚追加してください。\`);
    return;
  }
  const product = state.photoProducts[state.photoIndex];
  if (!product) return;

  // アップロードするファイルとIDをコピー
  const filesToUpload = [...state.photoFiles];
  const managedId = product.managed_id;

  // 即座に画面遷移（バックグラウンドでアップロード）
  state.photoFiles = [];

  if (silent) {
    // ナビ経由の自動保存
    uploadPhotosBackground(managedId, filesToUpload);
    return;
  }

  // 次の商品へ（即座に遷移）
  state.photoProducts.splice(state.photoIndex, 1);
  if (state.photoProducts.length === 0) {
    showToast('アップロード中…');
    showScreen('home');
  } else {
    if (state.photoIndex >= state.photoProducts.length) state.photoIndex = state.photoProducts.length - 1;
    renderPhotoScreen();
  }

  // バックグラウンドでアップロード
  uploadPhotosBackground(managedId, filesToUpload);
}

// バックグラウンドアップロード + AI自動判定
async function uploadPhotosBackground(managedId, files) {
  showToast(\`\${managedId}: \${files.length}枚アップロード中…\`);
  let allOk = true;
  for (let i = 0; i < files.length; i++) {
    const res = await uploadPhoto(managedId, files[i], i + 1);
    if (!res.ok) {
      allOk = false;
      showToast(\`\${managedId}: 写真\${i + 1}のアップロードに失敗しました\`);
      break;
    }
  }
  if (allOk) {
    showToast(\`\${managedId}: アップロード完了 → AI判定中…\`);
    // AI Step1: 1枚目で即時判定
    const aiRes = await api('/ai/step1', { managedId });
    if (aiRes.ok && aiRes.ai) {
      const parts = [aiRes.ai.brand, aiRes.ai.category2, aiRes.ai.color].filter(Boolean);
      showToast(\`\${managedId}: AI → \${parts.join(' / ') || '判定完了'}\`);
    } else {
      showToast(\`\${managedId}: アップロード完了 ✓（AI判定はスキップ）\`);
    }
    // AI Step2: 全写真で精密判定（バックグラウンド、通知のみ）
    if (files.length > 1) {
      api('/ai/step2', { managedId }).then(res2 => {
        if (res2.ok) showToast(\`\${managedId}: AI精密判定完了 ✓\`);
      });
    }
  }
}

// ========================================
// 採寸モード
// ========================================
async function startMeasureMode() {
  state.measureProducts = [];
  for (const batch of state.batches) {
    if (batch.status === 'pending') continue;
    const pRes = await api('/products/list', { batchId: batch.id });
    if (pRes.ok && pRes.products) {
      const unreg = pRes.products.filter(p => p.status === 'draft');
      const notDone = unreg.filter(p => !p.has_measurements);
      const done = unreg.filter(p => p.has_measurements);
      state.measureProducts.push(...notDone, ...done);
    }
  }
  if (state.measureProducts.length === 0) {
    showToast('サイズを測る商品がありません');
    return;
  }
  state.measureIndex = 0;
  renderMeasureScreen();
  showScreen('measure');
}

async function measureNav(dir) {
  // 現在の入力を自動保存
  await saveMeasurementsAndNext(true);
  state.measureIndex += dir;
  if (state.measureIndex < 0) state.measureIndex = 0;
  if (state.measureIndex >= state.measureProducts.length) state.measureIndex = state.measureProducts.length - 1;
  renderMeasureScreen();
}

function renderMeasureScreen() {
  const product = state.measureProducts[state.measureIndex];
  if (!product) return;
  document.getElementById('measureManagedId').textContent = product.managed_id || '-';
  document.getElementById('measureProgress').textContent = \`\${state.measureIndex + 1} / \${state.measureProducts.length}\`;

  // 商品画像プレビュー
  const previewEl = document.getElementById('measurePreview');
  if (product.photoUrls && product.photoUrls.length > 0) {
    const token = localStorage.getItem('sessionId');
    previewEl.innerHTML = \`<img src="\${product.photoUrls[0]}?token=\${token}" style="width:100%;max-height:200px;object-fit:contain;border-radius:10px;margin:8px 0;padding:0 16px">\`;
  } else {
    previewEl.innerHTML = '<div style="padding:12px;text-align:center;color:#94a3b8;font-size:13px">📷 まだ写真がありません</div>';
  }

  // 入力欄をクリア
  document.querySelectorAll('.measure-fields .mi').forEach(input => input.value = '');

  // AIカテゴリから自動判定
  if (product.cat2 && CAT2_TO_MEASURE_TYPE[product.cat2]) {
    const autoType = CAT2_TO_MEASURE_TYPE[product.cat2];
    selectMeasureType(autoType, document.querySelector(\`.tbtn[onclick*="\${autoType}"]\`));
  } else {
    selectMeasureType('tops', document.querySelector('.tbtn'));
  }

  // 商品情報フィールドを初期化・プリフィル
  renderMeasureInfoFields(product);
}

function renderMeasureInfoFields(product) {
  // カテゴリ2ドロップダウン
  const cat2El = document.getElementById('mi_cat2');
  cat2El.innerHTML = '<option value="">選んでください</option>' +
    Object.keys(MASTER.CAT2_TO_CAT3).map(c => \`<option value="\${c}" \${product.category2 === c ? 'selected' : ''}>\${c}</option>\`).join('');

  // カテゴリ3
  onMeasureCat2Change(product.category3);

  // カラー
  const colorEl = document.getElementById('mi_color');
  colorEl.innerHTML = '<option value="">選んでください</option>' +
    MASTER.COLORS.map(c => \`<option value="\${c}" \${product.color === c ? 'selected' : ''}>\${c}</option>\`).join('');

  // 発送方法
  const shipEl = document.getElementById('mi_shipping');
  shipEl.innerHTML = '<option value="">選んでください</option>' +
    MASTER.SHIPPING_METHODS.map(m => \`<option value="\${m}" \${product.shipping_method === m ? 'selected' : ''}>\${m}</option>\`).join('');

  // テキスト・セレクトフィールドのプリフィル
  document.getElementById('mi_brand').value = product.brand || '';
  document.getElementById('mi_gender').value = product.gender || '';
  document.getElementById('mi_tagSize').value = product.tag_size || '';
  document.getElementById('mi_features').value = product.design_feature || '';
  document.getElementById('mi_pocket').value = product.pocket || '';
  document.getElementById('mi_damage').value = product.defect_detail || '';

  // AI結果があればステータス表示
  const statusEl = document.getElementById('measureInfoStatus');
  if (product.brand || product.category2 || product.color) {
    statusEl.innerHTML = '🤖 <span style="color:#2563eb">AI自動生成の結果が入っています。間違っていたら修正してください</span>';
  } else if (product.has_info) {
    statusEl.innerHTML = '✓ <span style="color:#22c55e">前回の入力が残っています</span>';
  } else {
    statusEl.textContent = '手動で入力してください';
  }
}

function onMeasureGenderChange() {
  // 性別変更時にカテゴリ1を自動セット（内部処理のみ）
}

function onMeasureCat2Change(preserveCat3) {
  const cat2 = document.getElementById('mi_cat2').value;
  const cat3El = document.getElementById('mi_cat3');
  const options = MASTER.CAT2_TO_CAT3[cat2] || [];
  cat3El.innerHTML = '<option value="">選んでください</option>' +
    options.map(c => \`<option value="\${c}" \${c === preserveCat3 ? 'selected' : ''}>\${c}</option>\`).join('');

  // カテゴリ2変更時に採寸タイプも自動切替
  if (cat2 && CAT2_TO_MEASURE_TYPE[cat2]) {
    const autoType = CAT2_TO_MEASURE_TYPE[cat2];
    selectMeasureType(autoType, document.querySelector(\`.tbtn[onclick*="\${autoType}"]\`));
  }
}

function collectMeasureInfo() {
  return {
    brand: document.getElementById('mi_brand').value.trim(),
    gender: document.getElementById('mi_gender').value,
    category2: document.getElementById('mi_cat2').value,
    category3: document.getElementById('mi_cat3').value,
    tagSize: document.getElementById('mi_tagSize').value.trim(),
    color: document.getElementById('mi_color').value,
    designFeature: document.getElementById('mi_features').value.trim(),
    pocket: document.getElementById('mi_pocket').value,
    shippingMethod: document.getElementById('mi_shipping').value,
    defectDetail: document.getElementById('mi_damage').value.trim(),
  };
}

function selectMeasureType(type, el) {
  state.currentMeasureType = type;
  document.querySelectorAll('#measureTypeSelector .tbtn').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  ['tops', 'pants', 'onepiece', 'suit'].forEach(id => {
    const e = document.getElementById('mt-' + id);
    if (e) e.style.display = (id === type) ? '' : 'none';
  });
}

function collectMeasurements() {
  const container = document.getElementById('mt-' + state.currentMeasureType);
  if (!container) return {};
  const data = { type: state.currentMeasureType };
  container.querySelectorAll('.mi').forEach(input => {
    const key = input.dataset.key;
    const val = input.value.trim();
    if (key && val) data[key] = parseFloat(val);
  });
  return data;
}

async function saveMeasurementsAndNext(silent) {
  const product = state.measureProducts[state.measureIndex];
  if (!product) return;

  const measurements = collectMeasurements();
  const filledCount = Object.keys(measurements).filter(k => k !== 'type').length;
  const info = collectMeasureInfo();
  const hasInfo = Object.values(info).some(v => v);

  if (filledCount === 0 && !hasInfo) {
    if (!silent) showToast('少なくとも1つのサイズか商品情報を入力してください');
    return;
  }

  // 採寸保存
  if (filledCount > 0) {
    const res = await api('/products/save-measurements', {
      managedId: product.managed_id,
      measureType: measurements.type || 'tops',
      measurements,
    });
    if (!res.ok && !silent) {
      showToast(res.message || 'サイズ保存に失敗しました');
      return;
    }
  }

  // 商品情報保存
  if (hasInfo) {
    const gender = info.gender;
    const infoPayload = {
      ...info,
      category1: gender === 'メンズ' ? 'メンズ' : gender === 'キッズ' ? 'キッズ' : 'レディース',
    };
    const infoRes = await api('/products/save-info', {
      managedId: product.managed_id,
      info: infoPayload,
    });
    if (!infoRes.ok && !silent) {
      showToast(infoRes.message || '商品情報の保存に失敗しました');
      return;
    }
  }

  if (silent) return; // ナビ経由の自動保存

  showToast('保存しました');
  state.measureProducts.splice(state.measureIndex, 1);
  if (state.measureProducts.length === 0) {
    showToast('すべて入力し終わりました！');
    showScreen('home');
    return;
  }
  if (state.measureIndex >= state.measureProducts.length) state.measureIndex = state.measureProducts.length - 1;
  renderMeasureScreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========================================
// 確認・出品リスト
// ========================================
async function loadListScreen() {
  const readyEl = document.getElementById('listReady');
  const doneEl = document.getElementById('listDone');
  readyEl.innerHTML = '<div class="loading"><div class="spinner"></div><br>読み込み中...</div>';
  doneEl.innerHTML = '';

  // 全バッチの商品を取得
  let readyProducts = [];
  let doneProducts = [];

  for (const batch of state.batches) {
    const pRes = await api('/products/list', { batchId: batch.id });
    if (pRes.ok && pRes.products) {
      for (const p of pRes.products) {
        if (p.status === 'ready' || p.status === 'synced' || p.status === 'sold') {
          doneProducts.push(p);
        } else if (p.has_photos && p.has_measurements) {
          readyProducts.push(p);
        }
      }
    }
  }

  // 出品可能リスト
  if (readyProducts.length === 0) {
    readyEl.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:14px">出品可能な商品はありません</div>';
  } else {
    readyEl.innerHTML = readyProducts.map(p => {
      const needCondition = !p.condition_state;
      const hasWarning = p.ai_confidence === 'low';
      const icon = hasWarning ? '❓' : '👕';
      const iconBg = hasWarning ? '#fef3c7' : '#dbeafe';
      const borderStyle = hasWarning ? 'border-left:3px solid #f59e0b;' : '';
      const statusDot = needCondition
        ? '<span class="dot dot-red">状態を選んでください</span>'
        : (hasWarning ? '<span class="dot dot-yel">確認が必要です</span>' : '<span class="dot dot-grn">出品OK</span>');

      return \`<div class="prow" onclick="openEdit('\${p.managed_id}')" style="\${borderStyle}">
        <div class="icon" style="background:\${iconBg}">\${icon}</div>
        <div class="info">
          <div class="id">\${p.managed_id}</div>
          <div class="meta">\${p.brand || ''}\${p.category3 ? ' / ' + p.category3 : ''}\${p.mercari_size ? ' / ' + p.mercari_size : ''}</div>
          <div class="dots">\${statusDot}</div>
        </div>
        <div class="arrow">›</div>
      </div>\`;
    }).join('');
  }

  // 出品済みリスト
  if (doneProducts.length > 0) {
    doneEl.innerHTML = doneProducts.map(p => \`
      <div class="prow" style="opacity:.7" onclick="openEdit('\${p.managed_id}')">
        <div class="icon" style="background:#d1fae5">✅</div>
        <div class="info">
          <div class="id" style="color:#065f46">\${p.managed_id}</div>
          <div class="meta">\${p.brand || ''}\${p.category3 ? ' / ' + p.category3 : ''}\${p.mercari_size ? ' / ' + p.mercari_size : ''} — 出品済み</div>
        </div>
        <div class="arrow">›</div>
      </div>
    \`).join('');
  }
}

// ========================================
// 個別確認・編集
// ========================================
async function openEdit(managedId) {
  // 商品データを取得（products/listの結果から）
  let product = null;
  for (const batch of state.batches) {
    const pRes = await api('/products/list', { batchId: batch.id });
    if (pRes.ok && pRes.products) {
      product = pRes.products.find(p => p.managed_id === managedId);
      if (product) break;
    }
  }
  if (!product) { showToast('商品が見つかりません'); return; }

  state.editingProduct = product;
  document.getElementById('editManagedId').textContent = product.managed_id;

  // 写真サムネイル
  const photoGrid = document.getElementById('editPhotoGrid');
  let photoHtml = '';
  const token = localStorage.getItem('sessionId');
  const photoCount = (product.photoUrls ? product.photoUrls.length : 0) || 0;
  for (let i = 0; i < photoCount; i++) {
    if (product.photoUrls[i]) {
      photoHtml += \`<div class="pthumb" data-index="\${i}" style="height:72px;position:relative"><img src="\${product.photoUrls[i]}?token=\${token}" style="width:100%;height:100%;object-fit:cover;border-radius:6px" alt="写真\${i+1}"><span class="n">\${i+1}\${i===0?' 全体':''}</span></div>\`;
    }
  }
  if (photoCount === 0) {
    photoHtml = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px">写真がありません</div>';
  }
  photoGrid.innerHTML = photoHtml;
  initDragAndDrop('editPhotoGrid');

  // AI自動入力項目
  const aiFields = [
    { key: 'brand', label: 'ブランド', value: product.brand },
    { key: 'category', label: 'カテゴリ', value: [product.category2, product.category3].filter(Boolean).join(' › ') },
    { key: 'sizeTag', label: 'サイズタグ', value: [product.tag_size, product.mercari_size].filter(Boolean).join(' → ') },
    { key: 'gender', label: '性別', value: product.gender },
    { key: 'color', label: 'カラー', value: product.color },
    { key: 'features', label: '特徴', value: product.design_feature },
    { key: 'pocket', label: 'ポケット', value: product.pocket },
    { key: 'shippingMethod', label: '発送方法', value: product.shipping_method },
    { key: 'damage', label: '傷・汚れ', value: product.defect_detail || 'なし' },
  ];

  document.getElementById('editAiFields').innerHTML = aiFields.map(f => \`
    <div class="ci" onclick="openEditModal('\${f.key}', '\${f.label}')">
      <span class="ci-l">\${f.label}</span>
      <span class="ci-v">\${f.value || '未入力'} \${f.value ? '<span class="ci-ai">自動</span>' : ''}</span>
    </div>
  \`).join('');

  // 状態選択
  const condSelect = document.getElementById('editConditionSelect');
  condSelect.innerHTML = '<option value="">選んでください ▼</option>' +
    MASTER.CONDITIONS.map(c => \`<option value="\${c}" \${product.condition_state === c ? 'selected' : ''}>\${c}</option>\`).join('');
  onConditionChange();

  // 採寸サマリー
  const measureText = document.getElementById('editMeasureText');
  if (product.has_measurements) {
    const parts = [];
    if (product.m_length) parts.push('着丈 ' + product.m_length);
    if (product.m_shoulder) parts.push('肩幅 ' + product.m_shoulder);
    if (product.m_chest) parts.push('身幅 ' + product.m_chest);
    if (product.m_sleeve) parts.push('袖丈 ' + product.m_sleeve);
    if (product.m_span) parts.push('裄丈 ' + product.m_span);
    if (product.m_total_length) parts.push('総丈 ' + product.m_total_length);
    if (product.m_waist) parts.push('ウエスト ' + product.m_waist);
    if (product.m_rise) parts.push('股上 ' + product.m_rise);
    if (product.m_inseam) parts.push('股下 ' + product.m_inseam);
    if (product.m_thigh) parts.push('ワタリ ' + product.m_thigh);
    if (product.m_hem) parts.push('裾幅 ' + product.m_hem);
    if (product.m_hip) parts.push('ヒップ ' + product.m_hip);
    measureText.textContent = parts.length > 0 ? parts.join(' / ') : '未計測';
  } else {
    measureText.textContent = '未計測';
  }

  showScreen('edit');
}

function onConditionChange() {
  const val = document.getElementById('editConditionSelect').value;
  const box = document.getElementById('editConditionBox');
  if (val) {
    box.style.borderColor = '#22c55e';
    box.querySelector('div').innerHTML = '✅ 状態を選びました';
    box.querySelector('div').style.color = '#065f46';
  } else {
    box.style.borderColor = '#f59e0b';
    box.querySelector('div').innerHTML = '⚠️ 状態を選んでください';
    box.querySelector('div').style.color = '#92400e';
  }
}

// 編集モーダル
function openEditModal(field, label) {
  state.editModalField = field;
  document.getElementById('editModalTitle').textContent = label + 'を編集';
  const content = document.getElementById('editModalContent');
  const product = state.editingProduct;

  // フィールドに応じた入力UI
  if (field === 'color') {
    content.innerHTML = '<select class="fs" id="modalInput">' +
      MASTER.COLORS.map(c => \`<option value="\${c}" \${product.color === c ? 'selected' : ''}>\${c}</option>\`).join('') +
      '</select>';
  } else if (field === 'shippingMethod') {
    content.innerHTML = '<select class="fs" id="modalInput">' +
      MASTER.SHIPPING_METHODS.map(m => \`<option value="\${m}" \${product.shipping_method === m ? 'selected' : ''}>\${m}</option>\`).join('') +
      '</select>';
  } else if (field === 'gender') {
    content.innerHTML = '<select class="fs" id="modalInput">' +
      ['レディース','メンズ','ユニセックス','キッズ'].map(g => \`<option value="\${g}" \${product.gender === g ? 'selected' : ''}>\${g}</option>\`).join('') +
      '</select>';
  } else if (field === 'category') {
    // カテゴリ2 + カテゴリ3 の2段セレクト
    const cat2Options = Object.keys(MASTER.CAT2_TO_CAT3).map(c => \`<option value="\${c}" \${product.category2 === c ? 'selected' : ''}>\${c}</option>\`).join('');
    content.innerHTML = \`
      <div class="fg"><label class="fl">カテゴリ（大）</label><select class="fs" id="modalCat2" onchange="updateCat3Options()">\${cat2Options}</select></div>
      <div class="fg"><label class="fl">カテゴリ（小）</label><select class="fs" id="modalCat3"></select></div>
    \`;
    updateCat3Options();
  } else {
    // テキスト入力
    const val = field === 'brand' ? (product.brand || '') :
                field === 'sizeTag' ? (product.tag_size || '') :
                field === 'features' ? (product.design_feature || '') :
                field === 'pocket' ? (product.pocket || '') :
                field === 'damage' ? (product.defect_detail || '') : '';
    content.innerHTML = \`<input class="fi" id="modalInput" value="\${val}" placeholder="入力してください">\`;
  }

  document.getElementById('editModal').classList.add('show');
}

function updateCat3Options() {
  const cat2 = document.getElementById('modalCat2').value;
  const cat3Select = document.getElementById('modalCat3');
  const options = MASTER.CAT2_TO_CAT3[cat2] || [];
  const product = state.editingProduct;
  const current = product.category3;
  cat3Select.innerHTML = options.map(c => \`<option value="\${c}" \${current === c ? 'selected' : ''}>\${c}</option>\`).join('');
}

function saveModalEdit() {
  const product = state.editingProduct;
  const field = state.editModalField;

  if (field === 'category') {
    product.category2 = document.getElementById('modalCat2').value;
    product.category3 = document.getElementById('modalCat3').value;
  } else {
    const val = document.getElementById('modalInput').value;
    if (field === 'brand') product.brand = val;
    else if (field === 'sizeTag') product.tag_size = val;
    else if (field === 'gender') product.gender = val;
    else if (field === 'color') product.color = val;
    else if (field === 'features') product.design_feature = val;
    else if (field === 'pocket') product.pocket = val;
    else if (field === 'shippingMethod') product.shipping_method = val;
    else if (field === 'damage') product.defect_detail = val;
  }

  closeModal();
  // 画面を再描画
  openEdit(product.managed_id);
}

function closeModal() {
  document.getElementById('editModal').classList.remove('show');
}

// 採寸修正モーダル
function openMeasureEdit() {
  const product = state.editingProduct;
  if (!product) return;
  const type = product.measure_type || 'tops';
  const MEASURE_FIELDS = {
    tops: [['m_length','着丈'],['m_shoulder','肩幅'],['m_chest','身幅'],['m_sleeve','袖丈'],['m_span','裄丈']],
    pants: [['m_total_length','総丈'],['m_waist','ウエスト'],['m_rise','股上'],['m_inseam','股下'],['m_thigh','ワタリ'],['m_hem','裾幅'],['m_hip','ヒップ']],
    skirt: [['m_total_length','総丈'],['m_waist','ウエスト'],['m_hip','ヒップ']],
    onepiece: [['m_length','着丈'],['m_shoulder','肩幅'],['m_chest','身幅'],['m_sleeve','袖丈'],['m_total_length','総丈'],['m_waist','ウエスト']],
    suit: [['m_length','着丈(上)'],['m_shoulder','肩幅(上)'],['m_chest','身幅(上)'],['m_sleeve','袖丈(上)'],['m2_total_length','総丈(下)'],['m2_waist','ウエスト(下)'],['m2_rise','股上(下)'],['m2_inseam','股下(下)'],['m2_thigh','ワタリ(下)'],['m2_hem','裾幅(下)'],['m2_hip','ヒップ(下)']],
  };
  const fields = MEASURE_FIELDS[type] || MEASURE_FIELDS.tops;
  const fieldsHtml = '<div class="mg">' + fields.map(([key, label]) =>
    \`<div><div class="ml">\${label} cm</div><input class="mi" type="number" inputmode="decimal" id="me_\${key}" value="\${product[key] || ''}"></div>\`
  ).join('') + '</div>';
  document.getElementById('measureEditFields').innerHTML = fieldsHtml;
  document.getElementById('measureEditModal').classList.add('show');
}

async function saveMeasureEdit() {
  const product = state.editingProduct;
  if (!product) return;
  const m = {};
  document.querySelectorAll('#measureEditFields input').forEach(el => {
    const key = el.id.replace('me_', '');
    const val = parseFloat(el.value);
    if (!isNaN(val) && val > 0) m[key.replace('m_','').replace('m2_','').replace('total_length','totalLength')] = val;
    // Also store with original key mapping
    if (!isNaN(val) && val > 0) product[el.id.replace('me_','')] = val;
  });
  // Map to API format
  const measurements = {};
  const map = {m_length:'length',m_shoulder:'shoulder',m_chest:'chest',m_sleeve:'sleeve',m_span:'span',m_total_length:'totalLength',m_waist:'waist',m_rise:'rise',m_inseam:'inseam',m_thigh:'thigh',m_hem:'hem',m_hip:'hip',m2_total_length:'totalLength2',m2_waist:'waist2',m2_rise:'rise2',m2_inseam:'inseam2',m2_thigh:'thigh2',m2_hem:'hem2',m2_hip:'hip2'};
  document.querySelectorAll('#measureEditFields input').forEach(el => {
    const dbKey = el.id.replace('me_','');
    const apiKey = map[dbKey];
    const val = parseFloat(el.value);
    if (apiKey && !isNaN(val) && val > 0) measurements[apiKey] = val;
  });
  const res = await api('/products/save-measurements', {
    managedId: product.managed_id,
    measureType: product.measure_type || 'tops',
    measurements,
  });
  if (res.ok) {
    showToast('サイズを保存しました');
    closeMeasureModal();
    openEdit(product.managed_id);
  } else {
    showToast(res.message || '保存に失敗しました');
  }
}

function closeMeasureModal() {
  document.getElementById('measureEditModal').classList.remove('show');
}

// 出品実行
async function registerProduct() {
  const product = state.editingProduct;
  if (!product) return;

  const condition = document.getElementById('editConditionSelect').value;
  if (!condition) {
    showToast('状態を選んでください');
    return;
  }

  // 商品情報を保存
  const saveRes = await api('/products/save-info', {
    managedId: product.managed_id,
    info: {
      brand: product.brand,
      category1: product.gender === 'メンズ' ? 'メンズ' : 'レディース',
      category2: product.category2,
      category3: product.category3,
      tagSize: product.tag_size,
      mercariSize: product.mercari_size,
      gender: product.gender,
      color: product.color,
      designFeature: product.design_feature,
      pocket: product.pocket,
      shippingMethod: product.shipping_method,
      defectDetail: product.defect_detail,
      conditionState: condition,
    },
  });

  if (!saveRes.ok) {
    showToast(saveRes.message || '保存に失敗しました');
    return;
  }

  // 出品
  const regRes = await api('/products/register', { managedId: product.managed_id });
  if (regRes.ok) {
    showToast('出品しました！');
    showScreen('list');
  } else {
    showToast(regRes.message || '出品に失敗しました');
  }
}

// ========================================
// 移動報告
// ========================================
async function loadMoveScreen() {
  const invRes = await api('/products/my-inventory');
  if (!invRes.ok) {
    document.getElementById('moveInventoryList').innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:14px">読み込みに失敗しました</div>';
    return;
  }

  state.moveInventory = (invRes.products || []).map(p => ({
    managedId: p.managed_id,
    brand: p.brand,
    cat2: p.category2,
    sizeTag: p.mercari_size,
    color: p.color,
  }));
  state.moveSelected = new Set();

  // ユーザー設定から移動先を取得
  const sessionRes = await api('/session/validate');
  state.moveDestination = sessionRes.ok && sessionRes.user?.defaultDestination ? sessionRes.user.defaultDestination : '未設定';
  state.moveBoxId = generateBoxId();

  document.getElementById('moveDestination').textContent = state.moveDestination;
  document.getElementById('moveInventoryCount').textContent = \`送る商品を選んでください（自分の在庫: \${state.moveInventory.length}点）\`;
  document.getElementById('moveBoxId').textContent = state.moveBoxId;

  renderMoveInventory();
  updateMoveCount();
}

function generateBoxId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 3; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return \`BOX-\${yy}\${mm}\${dd}-\${rand}\`;
}

function renderMoveInventory() {
  const list = document.getElementById('moveInventoryList');
  if (state.moveInventory.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:14px">在庫がありません</div>';
    return;
  }
  list.innerHTML = state.moveInventory.map(item => {
    const checked = state.moveSelected.has(item.managedId);
    return \`<label class="trow \${checked ? 'checked' : ''}" onclick="toggleMoveItem('\${item.managedId}')">
      <input type="checkbox" \${checked ? 'checked' : ''}>
      <div class="info">
        <div style="font-size:14px;font-weight:600">\${item.managedId}</div>
        <div style="font-size:12px;color:#64748b">\${item.brand || ''}\${item.cat2 ? ' / ' + item.cat2 : ''}\${item.sizeTag ? ' / ' + item.sizeTag : ''}</div>
      </div>
    </label>\`;
  }).join('');
}

function toggleMoveItem(managedId) {
  if (state.moveSelected.has(managedId)) {
    state.moveSelected.delete(managedId);
  } else {
    state.moveSelected.add(managedId);
  }
  renderMoveInventory();
  updateMoveCount();
}

function updateMoveCount() {
  const count = state.moveSelected.size;
  document.getElementById('moveSelectedCount').textContent = \`\${count}件選んでいます\`;
  document.getElementById('moveSubmitText').textContent = count > 0
    ? \`この\${count}着を送る\`
    : '商品を選んでください';
}

async function submitTransfer() {
  if (state.moveSelected.size === 0) {
    showToast('送る商品を選んでください');
    return;
  }
  const res = await api('/transfers/create', {
    items: Array.from(state.moveSelected),
    boxId: state.moveBoxId,
    destination: state.moveDestination,
  });
  if (res.ok) {
    showToast(\`\${state.moveSelected.size}着の移動を報告しました\`);
    showScreen('home');
  } else {
    showToast(res.message || '移動報告に失敗しました');
  }
}

${isAdmin ? `
// ========================================
// 管理者ダッシュボード
// ========================================
async function loadAdminDashboard() {
  // 全体進捗（仮: バッチデータから集計）
  const bRes = await api('/batches/list');
  if (!bRes.ok) return;
  const batches = bRes.batches || [];

  let pending = 0, listed = 0, sold = 0;
  for (const batch of batches) {
    const pRes = await api('/products/list', { batchId: batch.id });
    if (pRes.ok && pRes.products) {
      for (const p of pRes.products) {
        if (p.status === 'ready' || p.status === 'synced') listed++;
        else if (p.status === 'sold') sold++;
        else pending++;
      }
    }
  }

  document.getElementById('adminPending').textContent = pending;
  document.getElementById('adminListed').textContent = listed;
  document.getElementById('adminSold').textContent = sold;

  // スタッフ一覧
  const sRes = await api('/auth/list-staff');
  const staffList = document.getElementById('adminStaffList');
  if (sRes.ok && sRes.staff) {
    const bgColors = ['#dbeafe', '#fce7f3', '#d1fae5', '#fef3c7', '#e0e7ff'];
    staffList.innerHTML = sRes.staff.map((s, i) => {
      const initial = (s.displayName || s.email || '?')[0];
      const hasIncomplete = s.incompleteCount > 0;
      return \`<div class="staff-row">
        <div class="staff-av" style="background:\${bgColors[i % bgColors.length]}">\${initial}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">\${s.displayName || s.email}</div>
          <div style="font-size:11px;color:#64748b">今日 \${s.todayCount || 0}件 / 在庫 \${s.inventoryCount || 0}点</div>
        </div>
        \${hasIncomplete ? '<span class="dot dot-red">未完了' + s.incompleteCount + '件</span>' : ''}
      </div>\`;
    }).join('');
  } else {
    staffList.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:13px">スタッフ情報を取得できませんでした</div>';
  }
}

// ========================================
// 仕入れ登録
// ========================================
function initBatchForm() {
  // 日付をデフォルト設定
  const today = new Date();
  document.getElementById('batchDate').value = today.toISOString().split('T')[0];

  // 区分コードセレクト
  const codeSelect = document.getElementById('batchCode');
  codeSelect.innerHTML = MASTER.CATEGORY_CODES.map(c => '<option value="' + c + '">' + c + '</option>').join('');

  // 金額リセット
  document.getElementById('batchAmount').value = '';
  document.getElementById('batchShipping').value = '';
  document.getElementById('batchMemo').value = '';
  updateBatchTotal();

  // 渡す相手をスタッフ一覧から取得
  loadBatchAssignees();
}

async function loadBatchAssignees() {
  const sRes = await api('/auth/list-staff');
  const sel = document.getElementById('batchAssignee');
  if (sRes.ok && sRes.staff) {
    sel.innerHTML = sRes.staff.map(s => '<option value="' + s.id + '">' + (s.displayName || s.email) + '</option>').join('');
  }
}

function updateBatchTotal() {
  const amount = parseInt(document.getElementById('batchAmount').value) || 0;
  const shipping = parseInt(document.getElementById('batchShipping').value) || 0;
  const total = amount + shipping;
  document.getElementById('batchTotal').textContent = '合計 ¥' + total.toLocaleString();
}

async function submitBatch() {
  const date = document.getElementById('batchDate').value;
  const code = document.getElementById('batchCode').value;
  const amount = parseInt(document.getElementById('batchAmount').value) || 0;
  const shipping = parseInt(document.getElementById('batchShipping').value) || 0;
  const assignee = document.getElementById('batchAssignee').value;
  const memo = document.getElementById('batchMemo').value.trim();

  if (!date) { showToast('仕入れ日を入力してください'); return; }
  if (!amount) { showToast('商品金額を入力してください'); return; }

  const res = await api('/batches/create', {
    purchaseDate: date,
    categoryCode: code,
    productAmount: amount,
    shippingCost: shipping,
    deliveryTo: assignee,
    note: memo,
  });
  if (res.ok) {
    showToast('仕入れを登録しました');
    showScreen('admin');
  } else {
    showToast(res.message || '登録に失敗しました');
  }
}

// ========================================
// スタッフ招待
// ========================================
function showStaffInvite() {
  document.getElementById('staffEmail').value = '';
  document.getElementById('staffName').value = '';
  document.getElementById('staffPassword').value = '';
  document.getElementById('staffModal').classList.add('show');
}

function closeStaffModal() {
  document.getElementById('staffModal').classList.remove('show');
}

async function createStaff() {
  const email = document.getElementById('staffEmail').value.trim();
  const name = document.getElementById('staffName').value.trim();
  const password = document.getElementById('staffPassword').value;

  if (!email) { showToast('メールアドレスを入力してください'); return; }
  if (!name) { showToast('表示名を入力してください'); return; }
  if (!password || password.length < 8) { showToast('パスワードは8文字以上で入力してください'); return; }

  const res = await api('/auth/create-staff', { email, displayName: name, password });
  if (res.ok) {
    showToast('スタッフを招待しました');
    closeStaffModal();
    loadAdminDashboard();
  } else {
    showToast(res.message || '招待に失敗しました');
  }
}
` : ''}

// ========================================
// PWA: Service Worker登録 + 更新検知
// ========================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // 更新検知
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            document.getElementById('updateBanner').classList.add('show');
          }
        });
      }
    });
  }).catch(() => {});
}

// ========================================
// 初期化
// ========================================
(async function init() {
  // ユーザーアバター設定
  const avatarEl = document.getElementById('userAvatar');
  const user = window.__USER__;
  if (user.displayName) {
    avatarEl.textContent = user.displayName[0];
  } else if (user.email) {
    avatarEl.textContent = user.email[0].toUpperCase();
  }

  // ホーム画面データを読み込み
  await loadHome();
})();
</script>
</body>
</html>`;
}
