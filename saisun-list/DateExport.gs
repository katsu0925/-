/**
 * DataExport.gs
 * 
 * スプレッドシートのデータをJSONファイルとしてGoogle Driveに保存
 * 5分ごとにトリガーで自動実行
 * 
 * ★★★ 設定手順 ★★★
 * 1. このファイルをGASプロジェクトに追加
 * 2. EXPORT_FOLDER_ID を設定（Google DriveのフォルダID）
 * 3. トリガーを設定（exportProductData_ を5分ごとに実行）
 */

// =====================================================
// 設定
// =====================================================

/**
 * エクスポート先のGoogle DriveフォルダID
 * 
 * 設定方法：
 * 1. Google Driveで新しいフォルダを作成（例：「決済システムデータ」）
 * 2. フォルダを開き、URLからIDをコピー
 *    例：https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXXX
 *    → 「XXXXXXXXXXXXXXXXXX」の部分がフォルダID
 * 3. フォルダを「リンクを知っている全員」に共有設定
 */
var EXPORT_FOLDER_ID = '1Wxx7J71PImov3MDU-RgCIwTSPHFlu9ot'; // ★★★ ここにフォルダIDを設定 ★★★

/**
 * ブランド名の正規化マップ
 * キー: 正規化後の名前, 値: 統合される元の名前の配列
 * ★ 新しいブランド表記揺れを見つけたらここに追加 ★
 */
var BRAND_NORMALIZE_MAP = {
  '&.NOSTALGIA': ['&. NOSTALGIA'],
  'Alma Design': ['Alma Designs'],
  'ADAM ET ROPE': ['ADAM ET ROPÉ', 'Adam et Rope', 'adam et rope'],
  'UNITED ARROWS': ['United Arrows', 'UNITED  ARROWS'],
  'BEAMS': ['Beams', 'beams'],
  'JOURNAL STANDARD': ['Journal Standard', 'JOURNAL  STANDARD'],
  'URBAN RESEARCH': ['Urban Research', 'URBAN  RESEARCH'],
  'SHIPS': ['Ships', 'ships'],
  'nano・universe': ['nano universe', 'NANO UNIVERSE', 'nano・universe ']
};

/**
 * ブランド名の正規化用逆引きマップを構築（起動時に1度だけ）
 */
function buildBrandNormLookup_() {
  var lookup = {};
  for (var canonical in BRAND_NORMALIZE_MAP) {
    var variants = BRAND_NORMALIZE_MAP[canonical];
    for (var i = 0; i < variants.length; i++) {
      lookup[variants[i].toLowerCase().replace(/\s+/g, ' ').trim()] = canonical;
    }
  }
  return lookup;
}

/**
 * ブランド名を正規化
 * 1. 前後スペース除去
 * 2. 連続スペースを1つに
 * 3. 明示マップで統合
 */
function normalizeBrand_(raw) {
  if (!raw) return '';
  var s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var key = s.toLowerCase();
  if (!normalizeBrand_._lookup) {
    normalizeBrand_._lookup = buildBrandNormLookup_();
  }
  return normalizeBrand_._lookup[key] || s;
}

/**
 * データ1シートの列マッピング（0-indexed）
 * 実際のシート構造に合わせて調整してください
 */
var DATA_COLUMNS = {
  noLabel: 0,       // A列: No.
  imageUrl: 1,      // B列: 画像URL
  state: 2,         // C列: 状態
  brand: 3,         // D列: ブランド
  size: 4,          // E列: サイズ
  gender: 5,        // F列: 性別
  category: 6,      // G列: カテゴリ
  color: 7,         // H列: カラー
  price: 8,         // I列: 価格
  status: 9,        // J列: ステータス（チェックボックス列）
  managedId: 10,    // K列: 管理番号
  // 採寸データ（L〜W列）
  measure_着丈: 11,
  measure_肩幅: 12,
  measure_身幅: 13,
  measure_袖丈: 14,
  measure_桁丈: 15,
  measure_総丈: 16,
  measure_ウエスト: 17,
  measure_股上: 18,
  measure_股下: 19,
  measure_ワタリ: 20,
  measure_裾幅: 21,
  measure_ヒップ: 22,
  // 傷汚れ詳細
  defectDetail: 23,  // X列
  // 発送方法
  shippingMethod: 24  // Y列
};

// キャッシュキー
var CACHE_KEY_PREFIX = 'PRODUCT_DATA_';
var CACHE_DURATION = 600; // 10分（秒）

// =====================================================
// メイン関数（トリガーで実行）
// =====================================================

/**
 * 商品データをJSONファイルとしてエクスポート
 * トリガーで5分ごとに実行
 */
function exportProductData_() {
  try {
    console.log('エクスポート開始: ' + new Date().toISOString());
    
    // スプレッドシートからデータ取得
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('データ1');
    if (!sheet) {
      throw new Error('データ1シートが見つかりません');
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('データがありません');
      return;
    }
    
    // 全データ取得（3行目から。1〜2行目はヘッダー）
    if (lastRow < 3) {
      console.log('データがありません');
      return;
    }
    var range = sheet.getRange(3, 1, lastRow - 2, 25); // A〜Y列（発送方法含む）
    var values = range.getValues();
    
    // 商品データを構築
    var products = [];
    var brands = {};
    var categories = {};
    var states = {};
    var genders = {};
    var sizes = {};
    var statuses = {};
    
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var managedId = String(row[DATA_COLUMNS.managedId] || '').trim();
      
      // 管理IDがない行はスキップ
      if (!managedId) continue;
      
      // ステータスチェック（在庫あり・確保中のみ対象）
      var status = String(row[DATA_COLUMNS.status] || '').trim();
      var statusKind = getStatusKind_(status);
      
      // 依頼中は除外（販売済み扱い）
      if (statusKind === 'open') continue;
      
      // 採寸データを構築
      var measurements = {};
      var measureLabels = ['着丈', '肩幅', '身幅', '袖丈', '桁丈', '総丈', 'ウエスト', '股上', '股下', 'ワタリ', '裾幅', 'ヒップ'];
      for (var j = 0; j < measureLabels.length; j++) {
        var label = measureLabels[j];
        var colKey = 'measure_' + label;
        var val = row[DATA_COLUMNS[colKey]];
        if (val !== '' && val !== null && val !== undefined) {
          var numVal = Number(val);
          if (!isNaN(numVal) && numVal > 0) {
            measurements[label] = numVal;
          }
        }
      }
      
      // 商品オブジェクト
      var product = {
        managedId: managedId,
        noLabel: String(row[DATA_COLUMNS.noLabel] || ''),
        imageUrl: String(row[DATA_COLUMNS.imageUrl] || ''),
        brand: normalizeBrand_(row[DATA_COLUMNS.brand]),
        category: String(row[DATA_COLUMNS.category] || '').trim(),
        size: String(row[DATA_COLUMNS.size] || '').trim(),
        color: String(row[DATA_COLUMNS.color] || '').trim(),
        state: String(row[DATA_COLUMNS.state] || '').trim(),
        gender: String(row[DATA_COLUMNS.gender] || '').trim(),
        price: Number(row[DATA_COLUMNS.price] || 0),
        status: status,
        selectable: (statusKind === 'available'),
        measurements: measurements,
        defectDetail: String(row[DATA_COLUMNS.defectDetail] || '').trim(),
        shippingMethod: String(row[DATA_COLUMNS.shippingMethod] || '').trim()
      };
      
      products.push(product);
      
      // フィルタ選択肢を収集
      if (product.brand) brands[product.brand] = true;
      if (product.category) categories[product.category] = true;
      if (product.state) states[product.state] = true;
      if (product.gender) genders[product.gender] = true;
      if (product.size) sizes[product.size] = true;
      if (status) statuses[status] = true;
    }
    
    // ソート選択肢
    var sortOptions = [
      { key: 'default', label: '標準' },
      { key: 'price', label: '価格' },
      { key: 'brand', label: 'ブランド' },
      { key: 'category', label: 'カテゴリ' }
    ];
    
    // 設定を取得
    var settings = getExportSettings_();
    
    // エクスポートデータ構築
    var exportData = {
      generatedAt: new Date().toISOString(),
      totalCount: products.length,
      products: products,
      options: {
        brand: Object.keys(brands).sort(),
        category: Object.keys(categories).sort(),
        state: Object.keys(states).sort(),
        gender: Object.keys(genders).sort(),
        size: Object.keys(sizes).sort(),
        status: Object.keys(statuses).sort(),
        sort: sortOptions
      },
      settings: settings
    };
    
    // キャッシュに保存（分割して保存）
    saveToCache_(exportData);
    
    console.log('エクスポート完了: ' + products.length + '件');
    
  } catch (e) {
    console.error('エクスポートエラー:', e);
    throw e;
  }
}

// =====================================================
// キャッシュ操作
// =====================================================

/**
 * データをキャッシュに保存（大きなデータは分割）
 */
function saveToCache_(data) {
  var cache = CacheService.getScriptCache();
  var jsonString = JSON.stringify(data);
  
  // 100KB以下なら1つのキーで保存
  if (jsonString.length < 100000) {
    cache.put(CACHE_KEY_PREFIX + '0', jsonString, CACHE_DURATION);
    cache.put(CACHE_KEY_PREFIX + 'COUNT', '1', CACHE_DURATION);
    console.log('キャッシュ保存: 1チャンク (' + jsonString.length + ' bytes)');
    return;
  }
  
  // 大きい場合は分割（90KB単位）
  var chunkSize = 90000;
  var chunks = [];
  for (var i = 0; i < jsonString.length; i += chunkSize) {
    chunks.push(jsonString.substring(i, i + chunkSize));
  }
  
  // 各チャンクを保存
  for (var j = 0; j < chunks.length; j++) {
    cache.put(CACHE_KEY_PREFIX + j, chunks[j], CACHE_DURATION);
  }
  cache.put(CACHE_KEY_PREFIX + 'COUNT', String(chunks.length), CACHE_DURATION);
  
  console.log('キャッシュ保存: ' + chunks.length + 'チャンク (' + jsonString.length + ' bytes)');
}

/**
 * キャッシュからデータを取得
 */
function loadFromCache_() {
  var cache = CacheService.getScriptCache();
  var countStr = cache.get(CACHE_KEY_PREFIX + 'COUNT');
  
  if (!countStr) {
    return null;
  }
  
  var count = parseInt(countStr, 10);
  if (count === 1) {
    var data = cache.get(CACHE_KEY_PREFIX + '0');
    return data ? JSON.parse(data) : null;
  }
  
  // 分割されたデータを結合
  var chunks = [];
  for (var i = 0; i < count; i++) {
    var chunk = cache.get(CACHE_KEY_PREFIX + i);
    if (!chunk) return null; // 一部欠けていたらnull
    chunks.push(chunk);
  }
  
  return JSON.parse(chunks.join(''));
}


// =====================================================
// API関数（Index.htmlから呼び出し）
// =====================================================

/**
 * キャッシュから商品データを取得（高速）
 * キャッシュがなければ生成して返す
 */
function apiGetCachedProducts() {
  try {
    // キャッシュから取得を試みる
    var data = loadFromCache_();

    if (!data) {
      // キャッシュがなければ生成
      console.log('キャッシュなし、生成開始');
      exportProductData_();
      data = loadFromCache_();
    }

    if (data) {
      console.log('キャッシュから取得: ' + data.totalCount + '件');
      // 会員割引ステータスは常に最新値で上書き（キャッシュ中の古い値を使わない）
      if (typeof app_getMemberDiscountStatus_ === 'function') {
        var memberDiscount = app_getMemberDiscountStatus_();
        if (!data.settings) data.settings = {};
        data.settings.memberDiscount = memberDiscount;
        // notesも会員割引状態に応じて更新
        if (data.settings.notes && Array.isArray(data.settings.notes)) {
          data.settings.notes = data.settings.notes.map(function(n) {
            if (!memberDiscount.enabled && String(n).indexOf('会員登録で10％OFF') !== -1) {
              return '<span style="color:#b8002a;">30点以上で10％割引</span>';
            }
            return n;
          });
          data.settings.topNotes = data.settings.notes;
        }
      }
      return { ok: true, data: data };
    }

    return { ok: false, message: 'データの生成に失敗しました' };

  } catch (e) {
    console.error('apiGetCachedProducts error:', e);
    return { ok: false, message: e.message || 'エラーが発生しました' };
  }
}


// =====================================================
// ヘルパー関数
// =====================================================

/**
 * ステータスの種類を判定
 */
function getStatusKind_(status) {
  var t = String(status || '').trim();
  if (!t) return 'available';
  if (t.indexOf('依頼中') !== -1) return 'open';
  if (t.indexOf('確保中') !== -1) return 'hold';
  if (t.indexOf('在庫') !== -1) return 'available';
  return 'available';
}

/**
 * 設定を取得
 */
function getExportSettings_() {
  try {
    // 会員割引ステータスを常に最新で取得
    var memberDiscount = (typeof app_getMemberDiscountStatus_ === 'function')
      ? app_getMemberDiscountStatus_()
      : { enabled: false, rate: 0, endDate: '', reason: 'unknown' };

    // APP_CONFIG があれば使用
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG) {
      var rawNotes = (APP_CONFIG.uiText && APP_CONFIG.uiText.notes) || [];
      // 会員割引OFFの場合、ノートから会員割引の記述を除去（app_publicSettings_と同じロジック）
      var notes = rawNotes.map(function(n) {
        if (!memberDiscount.enabled && String(n).indexOf('会員登録で10％OFF') !== -1) {
          return '<span style="color:#b8002a;">30点以上で10％割引</span>';
        }
        return n;
      });
      return {
        appTitle: APP_CONFIG.appTitle || '決済システム',
        minOrderCount: APP_CONFIG.minOrderCount || 10,
        shippingEstimateText: (APP_CONFIG.uiText && APP_CONFIG.uiText.shippingEstimateText) || '',
        notes: notes,
        topNotes: notes,
        nextSteps: (APP_CONFIG.uiText && APP_CONFIG.uiText.nextSteps) || [],
        basePaymentUrl: (APP_CONFIG.uiText && APP_CONFIG.uiText.basePaymentUrl) || '',
        memberDiscount: memberDiscount
      };
    }

    // cfg_getSettings_ があれば使用
    if (typeof cfg_getSettings_ === 'function') {
      var settings = cfg_getSettings_();
      settings.memberDiscount = memberDiscount;
      return settings;
    }

    // デフォルト
    return {
      appTitle: '決済システム',
      minOrderCount: 10,
      shippingEstimateText: '',
      notes: [],
      topNotes: [],
      nextSteps: [],
      basePaymentUrl: '',
      memberDiscount: memberDiscount
    };
  } catch (e) {
    return { appTitle: '決済システム', minOrderCount: 10 };
  }
}

/**
 * JSONをGoogle Driveに保存
 */
function saveJsonToDrive_(data, fileName) {
  var folder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
  var jsonString = JSON.stringify(data);
  
  // 既存ファイルを検索
  var files = folder.getFilesByName(fileName);
  
  if (files.hasNext()) {
    // 既存ファイルを更新
    var file = files.next();
    file.setContent(jsonString);
    console.log('ファイル更新: ' + fileName);
  } else {
    // 新規作成
    var file = folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
    // 共有設定（リンクを知っている全員が閲覧可能）
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    console.log('ファイル作成: ' + fileName + ' (ID: ' + file.getId() + ')');
  }
  
  return file;
}

/**
 * エクスポートされたJSONファイルのURLを取得
 * 初回セットアップ時に実行して、URLをIndex.htmlに設定
 */
function getExportedJsonUrl() {
  if (!EXPORT_FOLDER_ID) {
    console.log('EXPORT_FOLDER_ID を先に設定してください');
    return;
  }
  
  var folder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
  var files = folder.getFilesByName('products.json');
  
  if (files.hasNext()) {
    var file = files.next();
    var fileId = file.getId();
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&key=';
    
    console.log('='.repeat(60));
    console.log('JSONファイルID: ' + fileId);
    console.log('');
    console.log('★★★ Index.html に設定するURL ★★★');
    console.log('https://drive.google.com/uc?export=download&id=' + fileId);
    console.log('');
    console.log('または（CORS対応版・APIキー必要）:');
    console.log(url + 'YOUR_API_KEY');
    console.log('='.repeat(60));
    
    return fileId;
  } else {
    console.log('products.json が見つかりません。先に exportProductData_() を実行してください。');
    return null;
  }
}

/**
 * 手動でエクスポートを実行（テスト用）
 */
function runExportManually() {
  exportProductData_();
  getExportedJsonUrl();
  var data = loadFromCache_();
  if (data) {
    console.log('='.repeat(50));
    console.log('エクスポート成功！');
    console.log('商品数: ' + data.totalCount + '件');
    console.log('生成日時: ' + data.generatedAt);
    console.log('='.repeat(50));
  }
}

// =====================================================
// トリガー設定用関数
// =====================================================

/**
 * 5分ごとの自動実行トリガーを設定
 * 初回のみ実行
 */
function setupExportTrigger() {
  // 既存のトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'exportProductData_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 5分ごとのトリガーを作成
  ScriptApp.newTrigger('exportProductData_')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  console.log('トリガーを設定しました（5分ごとに exportProductData_ を実行）');
}

/**
 * トリガーを削除
 */
function removeExportTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'exportProductData_') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  console.log('トリガーを' + removed + '件削除しました');
}
