/**
 * ツール一覧表を作成（このスプレッドシートにシートを追加）
 * GASエディタから createAllSheets を直接実行してください
 */

// サービスごとのカラー定義
var COLORS = {
  detauri:    { bg: '#e8f5e9', border: '#4caf50', header: '#2e7d32' }, // 緑
  tasukibako: { bg: '#e3f2fd', border: '#2196f3', header: '#1565c0' }, // 青
  shameasure: { bg: '#fff3e0', border: '#ff9800', header: '#e65100' }, // オレンジ
  internal:   { bg: '#f3e5f5', border: '#9c27b0', header: '#6a1b9a' }, // 紫
  headerBg: '#1a1a2e',
  headerFg: '#ffffff',
  separator: '#e0e0e0',
};

function createAllSheets() {
  var ss = SpreadsheetApp.openById('1CkC37iSDgURkWV-Bfhm7dCrz-Aw-Wjjvo29nlYBO1xA');
  createServiceList_(ss);
  SpreadsheetApp.flush();
  createPricingComparison_(ss);
  SpreadsheetApp.flush();
  createInfraCosts_(ss);
  SpreadsheetApp.flush();
  createPnlSimulation_(ss);
  SpreadsheetApp.flush();
  createDevStatus_(ss);
  SpreadsheetApp.flush();
}

// ─── ヘルパー ───
function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) { sheet.clear(); sheet.clearConditionalFormatRules(); sheet.clearFormats(); }
  else { sheet = ss.insertSheet(name); }
  return sheet;
}

function applyBase_(sheet, data, cols) {
  // データ書き込み
  sheet.getRange(1, 1, data.length, cols).setValues(data);
  // ヘッダー
  var header = sheet.getRange(1, 1, 1, cols);
  header.setBackground(COLORS.headerBg).setFontColor(COLORS.headerFg).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 36);
  // 全体の書式
  var allRange = sheet.getRange(1, 1, data.length, cols);
  allRange.setVerticalAlignment('middle').setWrap(true).setFontSize(10);
  // 枠線
  allRange.setBorder(true, true, true, true, true, true, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
  // データ行の高さ
  for (var r = 2; r <= data.length; r++) sheet.setRowHeight(r, 28);
}

function colorRowsByService_(sheet, data, serviceCol, startRow) {
  for (var r = startRow; r < data.length; r++) {
    var val = String(data[r][serviceCol]).trim();
    var color = null;
    if (val.indexOf('デタウリ') >= 0) color = COLORS.detauri.bg;
    else if (val.indexOf('タスキ箱') >= 0) color = COLORS.tasukibako.bg;
    else if (val.indexOf('写メジャー') >= 0) color = COLORS.shameasure.bg;
    else if (val.indexOf('仕入れ') >= 0 || val.indexOf('Cron') >= 0) color = COLORS.internal.bg;
    if (color) sheet.getRange(r + 1, 1, 1, sheet.getLastColumn()).setBackground(color);
  }
}

// ─── シート1: サービス一覧 ───
function createServiceList_(ss) {
  var sheet = getOrCreateSheet_(ss, '① サービス一覧');
  var data = [
    ['サービス名', 'ステータス', '概要', 'ターゲット', 'URL', '技術スタック', '企画書の場所', '収益モデル', '備考'],
    ['デタウリ\n.Detauri', '🟢 運用中', '中古衣料の卸売ECサイト', '副業で古着販売をする個人', 'https://wholesale.nkonline-tool.com', 'GAS + CF Workers\n+ D1/KV/R2 + Pages', 'saisun-repo/\nsaisun-list/docs/', '商品販売マージン', 'メインプロジェクト\nKOMOJU決済、BASE連携'],
    ['タスキ箱', '🟡 内部運用中', '管理番号付き商品画像の\n共有ストレージ', '外注を使った\n物販事業者', 'https://detauri-gas-proxy\n.nsdktts1030.workers.dev\n/upload', 'CF Workers\n+ R2 + KV', 'memory/\nproject-image-tool.md\nproject-tasukibako-status.md', 'フリーミアムSaaS\n¥0/¥480/¥980/¥1,980', '将来一般公開予定\n（独立ブランド）'],
    ['写メジャー\n(ShaMeasure)', '🔵 開発中', 'AI自動採寸＋\n商品説明文生成', '古着販売をする\n全ユーザー', '未定', 'CF Workers + D1/KV/R2\n+ Gemini 2.5 Pro\n+ GPT-4o-mini', 'memory/\nproject-ai-measure.md\nproject-shameasure.md', 'フリーミアムSaaS\n¥0〜¥19,800', 'デタウリとは完全独立\nHRNet fine-tune移行済み'],
    ['仕入れ管理', '🟢 運用中', '仕入れ・在庫管理\nonEditでデタウリ同期', '自社運用', 'GASエディタ', 'GAS\n+ Google Sheets', 'saisun-repo/\nshiire-kanri/', '—（社内ツール）', 'データ1シートへの同期元'],
    ['Cron管理\n(saisun-list-bulk)', '🟢 運用中', '記事生成・GA4・\n報酬管理のcron', '自社運用', 'GASエディタ', 'GAS', 'saisun-repo/\nsaisun-list-bulk/', '—（社内ツール）', '別GASプロジェクト'],
  ];
  var cols = data[0].length;
  applyBase_(sheet, data, cols);
  colorRowsByService_(sheet, data, 0, 1);

  // 列幅
  sheet.setColumnWidth(1, 120); // サービス名
  sheet.setColumnWidth(2, 110); // ステータス
  sheet.setColumnWidth(3, 180); // 概要
  sheet.setColumnWidth(4, 130); // ターゲット
  sheet.setColumnWidth(5, 180); // URL
  sheet.setColumnWidth(6, 150); // 技術
  sheet.setColumnWidth(7, 180); // 企画書
  sheet.setColumnWidth(8, 140); // 収益
  sheet.setColumnWidth(9, 180); // 備考
  // 行の高さ
  for (var r = 2; r <= data.length; r++) sheet.setRowHeight(r, 60);
}

// ─── シート2: 料金プラン比較 ───
function createPricingComparison_(ss) {
  var sheet = getOrCreateSheet_(ss, '② 料金プラン比較');
  var data = [
    ['サービス', 'プラン', '月額（一般）', '月額（会員）', '上限', 'API費用/件', '決済手数料', 'インフラ実費', '粗利', '粗利率', '備考'],
    ['写メジャー', 'フリー', 0, 0, '5件/月', '¥1.2', '—', 0, 0, '—', '集客用'],
    ['写メジャー', 'ベーシック', 1980, 1280, '100件/月', '¥1.2', 'Stripe 3.6%+¥30', '—', '—', '89% / 85%', '一般 / 会員'],
    ['写メジャー', 'ライト', 3980, 2480, '300件/月', '¥1.2', 'Stripe 3.6%+¥30', '—', '—', '85% / 78%', ''],
    ['写メジャー', 'プロ', 9800, 5980, '1,000件/月', '¥1.2', 'Stripe 3.6%+¥30', '—', '—', '81% / 71%', ''],
    ['写メジャー', 'マックス', 19800, 12800, '3,000件/月', '¥1.2', 'Stripe 3.6%+¥30', '—', '—', '74% / 61%', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['タスキ箱', 'フリー', 0, '—', '100商品 / 1,000枚 / 3人', '—', '—', '¥0.5', 0, '—', '集客用'],
    ['タスキ箱', 'ライト', 480, '—', '500商品 / 5,000枚 / 5人', '—', 'Stripe ¥47', '¥1.4', '¥432', '90%', ''],
    ['タスキ箱', 'スタンダード', 980, '—', '1,000商品 / 10,000枚 / 15人', '—', 'Stripe ¥65', '¥2.7', '¥912', '93%', ''],
    ['タスキ箱', 'プロ', 1980, '—', '無制限', '—', 'Stripe ¥101', '¥10', '¥1,869', '94%', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['デタウリ', '—', '手数料なし', '—', '—', '—', 'KOMOJU 3.25%', '—', '商品マージン', '—', 'EC販売'],
  ];
  var cols = data[0].length;
  applyBase_(sheet, data, cols);

  // サービスごと色分け
  for (var r = 1; r < data.length; r++) {
    var val = String(data[r][0]).trim();
    if (!val) continue;
    var color = null;
    if (val.indexOf('写メジャー') >= 0) color = COLORS.shameasure.bg;
    else if (val.indexOf('タスキ箱') >= 0) color = COLORS.tasukibako.bg;
    else if (val.indexOf('デタウリ') >= 0) color = COLORS.detauri.bg;
    if (color) sheet.getRange(r + 1, 1, 1, cols).setBackground(color);
  }
  // 空行をグレーに
  [7, 12].forEach(function(r) {
    sheet.getRange(r, 1, 1, cols).setBackground('#f5f5f5');
    sheet.setRowHeight(r, 8);
  });
  // 金額書式
  sheet.getRange('C2:D13').setNumberFormat('#,##0');
  // 列幅
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 80);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(8, 90);
  sheet.setColumnWidth(9, 80);
  sheet.setColumnWidth(10, 90);
  sheet.setColumnWidth(11, 100);
}

// ─── シート3: インフラ費用 ───
function createInfraCosts_(ss) {
  var sheet = getOrCreateSheet_(ss, '③ インフラ費用');
  var data = [
    ['カテゴリ', '項目', '提供元', '月額固定費', '無料枠', '超過単価', '利用状況', '対象サービス', '備考'],
    ['ホスティング', 'Workers Paid', 'Cloudflare', '$5（¥750）', '1,000万req/月', '$0.30/100万回', '全サービス共有', 'デタウリ / タスキ箱 / 写メジャー', '100契約超で分離検討'],
    ['ストレージ', 'R2 ストレージ', 'Cloudflare', '¥0', '10GB/月', '$0.015/GB', 'タスキ箱画像', 'タスキ箱 / 写メジャー', 'エグレス完全無料'],
    ['ストレージ', 'R2 書込', 'Cloudflare', '¥0', '100万回/月', '$4.50/100万回', '無料枠内', 'タスキ箱', ''],
    ['ストレージ', 'R2 読取', 'Cloudflare', '¥0', '1,000万回/月', '$0.36/100万回', '無料枠内', 'タスキ箱', ''],
    ['DB', 'D1', 'Cloudflare', '¥0', '250億行読取/月', '$0.001/100万行', '無料枠内', 'デタウリ / タスキ箱 / 写メジャー', ''],
    ['キャッシュ', 'KV', 'Cloudflare', '¥0', '1,000万読取/月', '$0.50/100万回', '無料枠内', 'デタウリ / タスキ箱', ''],
    ['静的配信', 'Pages', 'Cloudflare', '¥0', '無制限', '—', '運用中', 'デタウリ', 'GitHub push自動デプロイ'],
    ['ドメイン', 'デタウリ', 'Cloudflare', '約¥130', '—', '—', '運用中', 'デタウリ', ''],
    ['ドメイン', '写メジャー', '未取得', '約¥130', '—', '—', '未取得', '写メジャー', ''],
    ['ドメイン', 'タスキ箱', '未取得', '約¥130', '—', '—', '未取得', 'タスキ箱', '一般公開時'],
    ['実行環境', 'GAS', 'Google', '¥0', '各種制限', '—', '運用中', 'デタウリ / 仕入れ管理', ''],
    ['DB代替', 'Google Sheets', 'Google', '¥0', '—', '—', '運用中', 'デタウリ / 仕入れ管理', ''],
    ['決済', 'KOMOJU', 'KOMOJU', '¥0', '—', 'クレカ3.25%', '運用中', 'デタウリ', 'コンビニ2.75%、PayPay対応'],
    ['決済', 'Stripe', 'Stripe', '¥0', '—', '3.6%+¥30/件', '未導入', '写メジャー / タスキ箱', 'サブスクにBilling推奨'],
    ['AI', 'Gemini 2.5 Pro', 'Google', '¥0', '100回/日', '従量制', 'テスト中', '写メジャー', 'Flash検証で¥0.7/回に'],
    ['AI', 'GPT-4o-mini', 'OpenAI', '従量制', '—', '約¥0.1/回', 'テスト中', '写メジャー', '説明文生成'],
    ['セキュリティ', 'reCAPTCHA v3', 'Google', '¥0', '100万回/月', '—', '運用中', 'デタウリ', ''],
    ['EC連携', 'BASE API', 'BASE', '¥0', '—', '—', '運用中', 'デタウリ', '注文・商品同期'],
    ['', '', '', '', '', '', '', '', ''],
    ['合計', '現在の月額固定費', '', '約¥880', '', '', '', '', 'Workers$5 + ドメイン¥130'],
    ['合計', '全サービス稼働時', '', '約¥1,140', '', '', '', '', '+ ドメイン2つ ¥260'],
  ];
  var cols = data[0].length;
  applyBase_(sheet, data, cols);

  // カテゴリごとの色分け
  var catColors = {
    'ホスティング': '#e8eaf6', 'ストレージ': '#e0f7fa', 'DB': '#f1f8e9', 'キャッシュ': '#f1f8e9',
    '静的配信': '#f1f8e9', 'ドメイン': '#fce4ec', '実行環境': '#fff8e1', 'DB代替': '#fff8e1',
    '決済': '#f3e5f5', 'AI': '#fff3e0', 'セキュリティ': '#efebe9', 'EC連携': '#efebe9',
    '合計': '#e0e0e0'
  };
  for (var r = 1; r < data.length; r++) {
    var cat = String(data[r][0]).trim();
    if (catColors[cat]) sheet.getRange(r + 1, 1, 1, cols).setBackground(catColors[cat]);
  }
  // 空行
  sheet.getRange(20, 1, 1, cols).setBackground('#f5f5f5');
  sheet.setRowHeight(20, 8);
  // 合計行を太字
  sheet.getRange(21, 1, 2, cols).setFontWeight('bold');
  // 列幅
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 140);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 180);
  sheet.setColumnWidth(9, 150);
}

// ─── シート4: 損益シミュレーション ───
function createPnlSimulation_(ss) {
  var sheet = getOrCreateSheet_(ss, '④ 損益シミュレーション');
  var data = [
    ['', '', 'タスキ箱', '', '', '', '', '写メジャー（ベーシック¥1,980）', '', '', ''],
    ['項目', '', '10契約', '30契約', '50契約', '100契約', '', '10契約', '30契約', '50契約', '100契約'],
    ['売上（月額）', '', 6300, 18900, 31500, 63000, '', 19800, 59400, 99000, 198000],
    ['Stripe手数料', '', -490, -1460, -2430, -4860, '', -743, -2168, -3594, -7158],
    ['インフラ固定費', '', -130, -130, -130, -130, '', -130, -130, -130, -130],
    ['インフラ従量費', '', -14, -42, -70, -140, '', -600, -1800, -3000, -6000],
    ['メンテ人件費', '', -20000, -20000, -15000, -12000, '', -20000, -20000, -15000, -12000],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['純利益', '', -14334, -2732, 13870, 45870, '', -1673, 35302, 77276, 172712],
    ['判定', '', '赤字', 'ほぼトントン', '黒字', '黒字', '', 'ほぼトントン', '黒字', '黒字', '黒字'],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['損益分岐点', '', '有料 約35契約', '', '', '', '', '有料 約10契約', '', '', ''],
    ['ミックス想定', '', 'ライト60%/スタンダード30%/プロ10%', '', '', '', '', 'ベーシック¥1,980のみで試算', '', '', ''],
    ['メンテ人件費', '', '立ち上げ期: ¥20,000/月', '', '', '', '', '安定期: ¥12,000/月', '', '', ''],
  ];
  var cols = data[0].length;
  applyBase_(sheet, data, cols);

  // サービス名ヘッダー行
  sheet.getRange(1, 3, 1, 4).merge().setBackground(COLORS.tasukibako.header).setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(1, 8, 1, 4).merge().setBackground(COLORS.shameasure.header).setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  // セパレータ列
  sheet.setColumnWidth(7, 10);
  for (var r = 1; r <= data.length; r++) sheet.getRange(r, 7).setBackground('#e0e0e0');
  // 2行目ヘッダー
  sheet.getRange(2, 1, 1, cols).setBackground('#37474f').setFontColor('#fff').setFontWeight('bold');
  sheet.setFrozenRows(2);
  // タスキ箱データ列の背景
  sheet.getRange(3, 3, 5, 4).setBackground(COLORS.tasukibako.bg);
  // 写メジャーデータ列の背景
  sheet.getRange(3, 8, 5, 4).setBackground(COLORS.shameasure.bg);
  // 空行
  sheet.getRange(8, 1, 1, cols).setBackground('#f5f5f5');
  sheet.setRowHeight(8, 8);
  sheet.getRange(11, 1, 1, cols).setBackground('#f5f5f5');
  sheet.setRowHeight(11, 8);
  // 純利益行を強調
  sheet.getRange(9, 1, 1, cols).setFontWeight('bold').setFontSize(11);
  // 判定行の色分け
  var judgments = {3:'赤字', 4:'ほぼトントン', 5:'黒字', 6:'黒字', 8:'ほぼトントン', 9:'黒字', 10:'黒字', 11:'黒字'};
  for (var c = 3; c <= 11; c++) {
    if (c === 7) continue;
    var val = sheet.getRange(10, c).getValue();
    if (val === '赤字') sheet.getRange(10, c).setBackground('#ffcdd2').setFontColor('#b71c1c').setFontWeight('bold');
    else if (val === '黒字') sheet.getRange(10, c).setBackground('#c8e6c9').setFontColor('#1b5e20').setFontWeight('bold');
    else if (val === 'ほぼトントン') sheet.getRange(10, c).setBackground('#fff9c4').setFontColor('#f57f17').setFontWeight('bold');
  }
  // 金額書式
  sheet.getRange('C3:F7').setNumberFormat('#,##0');
  sheet.getRange('H3:K7').setNumberFormat('#,##0');
  sheet.getRange('C9:F9').setNumberFormat('#,##0');
  sheet.getRange('H9:K9').setNumberFormat('#,##0');
  // 列幅
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 10);
  for (var i = 3; i <= 6; i++) sheet.setColumnWidth(i, 90);
  for (var j = 8; j <= 11; j++) sheet.setColumnWidth(j, 90);
}

// ─── シート5: 開発ステータス ───
function createDevStatus_(ss) {
  var sheet = getOrCreateSheet_(ss, '⑤ 開発ステータス');
  var data = [
    ['サービス', '項目', 'ステータス', '優先度', '次のアクション', '備考'],
    ['デタウリ', '基本EC機能', '✅ 完了', '—', '—', '商品表示・カート・決済・注文管理'],
    ['デタウリ', 'CF Workers高速化', '✅ Phase1完了', '—', 'Phase2-5を段階的に有効化', '商品データ+CSRF'],
    ['デタウリ', '会員限定ページ', '📋 未着手', '中', 'project-member-page.md参照', '全7ステップ'],
    ['デタウリ', '出品キット', '📋 未着手', '中', 'project-listing-kit.md参照', '価格+30%、Webページ配信'],
    ['デタウリ', 'BASE連携', '✅ 運用中', '—', '—', '注文同期5分毎'],
    ['', '', '', '', '', ''],
    ['タスキ箱', 'アップロード・商品管理UI', '✅ 完了', '—', '—', '2タブ統合、プレビュー、並び替え'],
    ['タスキ箱', 'iOSクラッシュ修正', '✅ 完了', '—', '—', 'createImageBitmap+2枚並列'],
    ['タスキ箱', 'ファビコン', '✅ 完了', '—', '—', 'SVG+PNG（iOS対応）'],
    ['タスキ箱', 'マルチテナント化', '📋 未着手', '低', '一般公開時に着手', 'teamIdスコープ追加'],
    ['タスキ箱', 'アカウント＆チーム基盤', '📋 未着手', '低', '一般公開時に着手', 'D1 users/teams'],
    ['タスキ箱', 'Stripe Billing連携', '📋 未着手', '低', '一般公開時に着手', ''],
    ['タスキ箱', '利用規約/PP', '📋 未着手', '低', '弁護士レビュー ¥5〜15万', '一般公開時に必要'],
    ['タスキ箱', 'ドメイン取得', '📋 未着手', '低', 'tasukibako.com等', '一般公開時'],
    ['', '', '', '', '', ''],
    ['写メジャー', 'A4比率推定の精度検証', '✅ 完了', '—', '—', 'スウェット平均誤差2.4cm'],
    ['写メジャー', 'HRNet fine-tune', '⏳ 外注待ち', '高', '画像200枚の外注待ち', ''],
    ['写メジャー', 'プロンプト改善', '📋 未着手', '高', 'ゴムウエスト・身幅定義強化', ''],
    ['写メジャー', 'Gemini Flash検証', '📋 未着手', '中', '同等精度ならコスト1/4', ''],
    ['写メジャー', '本番UI構築', '📋 未着手', '中', '調整UIプロトタイプベース', ''],
    ['写メジャー', 'ドメイン取得', '📋 未着手', '低', '', ''],
    ['写メジャー', 'ブランド名決定', '✅ 完了', '—', '—', '写メジャー（シャメジャー）'],
  ];
  var cols = data[0].length;
  applyBase_(sheet, data, cols);
  colorRowsByService_(sheet, data, 0, 1);

  // 空行
  [7, 16].forEach(function(r) {
    sheet.getRange(r, 1, 1, cols).setBackground('#f5f5f5');
    sheet.setRowHeight(r, 8);
  });

  // 条件付き書式（ステータス列）
  var statusRange = sheet.getRange('C2:C' + data.length);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('✅').setBackground('#c8e6c9').setFontColor('#1b5e20').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('⏳').setBackground('#fff9c4').setFontColor('#f57f17').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('📋').setBackground('#bbdefb').setFontColor('#0d47a1').setRanges([statusRange]).build());
  sheet.setConditionalFormatRules(rules);

  // 列幅
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 60);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 220);
}
