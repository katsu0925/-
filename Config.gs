// === Config.gs 全体抜粋 ===
const APP_CONFIG = {
  appTitle: '選べる古着卸',
  // 最低購入（見積もり）点数を 10 に変更
  minOrderCount: 10,
  notifyEmails: 'nsdktts1030@gmail.com',
  data: {
    spreadsheetId: '1eDkAMm_QUDFHbSzkL4IMaFeB2YV6_Gw5Dgi-HqIB2Sc',
    sheetName: 'データ1',
    headerRow: 3,
    readCols: 11
  },
  order: {
    spreadsheetId: '',
    requestSheetName: '依頼管理',
    holdSheetName: '確保',
    openLogSheetName: '依頼中'
  },
  cache: {
    productsSeconds: 21600,
    statusSeconds: 300,
    stateSeconds: 3600,
    detailSeconds: 86400  // ★追加★ 商品詳細キャッシュ（24時間）
  },
  holds: {
    minutes: 15,
    syncHoldSheet: true
  },
  admin: {
    ownerEmailProp: 'ADMIN_OWNER_EMAIL',
    accessKeyProp: 'ADMIN_ACCESS_KEY',
    accessKeyLen: 24
  },
  columns: {
    // 既存の列...
    managedId: 11,  // K列
    // ★追加★ 採寸データ列
    measureTake: 12,      // L列: 着丈
    measureShoulder: 13,  // M列: 肩幅
    measureChest: 14,     // N列: 身幅
    measureSleeve: 15,    // O列: 袖丈
    measureLength: 16,    // P列: 桁丈
    defectDetail: 17,     // Q列: 傷汚れ詳細
  },
  // ★追加★ 仕入れ管理Ver.2（商品詳細モーダル用）
  detail: {
    spreadsheetId: '1lp7XngTC0Nnc6SaA_-KlZ0SZVuRiVml6ICZ5L2riQTo',
    sheetName: '商品管理',
    headerRow: 1,
    managedIdCol: 6,  // 管理番号の列位置（1-indexed）
    columns: {
      managedId: 6,        // 管理番号
      state: 7,            // 状態
      brand: 8,            // ブランド
      defectDetail: 19,    // 傷汚れ詳細
      // 採寸データ（列番号）
      length: 20,          // 着丈
      shoulder: 21,        // 肩幅
      bust: 22,            // 身幅
      sleeve: 23,          // 袖丈
      yuki: 24,            // 裄丈
      totalLength: 25,     // 総丈
      waist: 26,           // ウエスト
      rise: 27,            // 股上
      inseam: 28,          // 股下
      thigh: 29,           // ワタリ
      hemWidth: 30,        // 裾幅
      hip: 31              // ヒップ
    }
  },
  statuses: {
    open: '依頼中',
    closed: ['キャンセル', '返品', '完了'],
    allowed: ['依頼中', 'キャンセル', '返品', '完了']
  },
  uiText: {
    // 注意文やリンクを最新仕様に変更
    notes: [
      // 商品ページガイドのリンク差し替え
      '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
      // 「購入」を「見積もり」に変更し、（送料別）をリンク化
      '10点から見積もり可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料はBASE側で確定します。',
      '送信後、受付番号をお控えください。確定金額・送料をご案内後、BASEで決済となります。',
      '在庫は先着のため、送信後に欠品となる場合があります（確保中表示がある場合はその時間内は確保）。',
      // 赤字メッセージ追加
      '<span style="color:#b8002a;">30点以上で10％割引</span>'
    ],
    // 次のステップ（受付番号コピー〜発送まで）は不要になったため空配列に
    nextSteps: [],
    basePaymentUrl: 'https://nkonline.buyshop.jp/'
  }
};

function app_getOrderSpreadsheetId_() {
  const id = String(APP_CONFIG.order.spreadsheetId || '').trim();
  return id ? id : String(APP_CONFIG.data.spreadsheetId || '').trim();
}

function app_publicSettings_() {
  const ui = (APP_CONFIG && APP_CONFIG.uiText && typeof APP_CONFIG.uiText === 'object') ? APP_CONFIG.uiText : {};

  const appTitle = String(APP_CONFIG.appTitle || ui.appTitle || '');
  const minOrderCount = Number((APP_CONFIG.minOrderCount != null ? APP_CONFIG.minOrderCount : (ui.minOrderCount != null ? ui.minOrderCount : 30)));

  const shippingEstimateText = String(ui.shippingEstimateText || '');

  const notes = Array.isArray(ui.notes) ? ui.notes : [];
  const nextSteps = Array.isArray(ui.nextSteps) ? ui.nextSteps : [];

  const basePaymentUrl =
    (typeof WEB_CONFIG !== 'undefined' && WEB_CONFIG && WEB_CONFIG.basePaymentUrl) ? String(WEB_CONFIG.basePaymentUrl) :
    String(ui.basePaymentUrl || '');

  return {
    appTitle: appTitle,
    minOrderCount: minOrderCount,
    basePaymentUrl: basePaymentUrl,
    shippingEstimateText: shippingEstimateText,
    topNotes: notes,
    notes: notes,
    nextSteps: nextSteps,
    uiText: {
      appTitle: appTitle,
      minOrderCount: minOrderCount,
      basePaymentUrl: basePaymentUrl,
      shippingEstimateText: shippingEstimateText,
      notes: notes,
      nextSteps: nextSteps
    }
  };
}

function st_normBrandDisplay_(v) {
  const s = String(v == null ? '' : v).normalize('NFKC');
  return s.replace(/[　\s]+/g, ' ').trim();
}

function st_normBrandKey_(v) {
  const s = st_normBrandDisplay_(v);
  return s.replace(/[　\s]+/g, '').toLowerCase();
}

function app_readBrandList_() {
  const ssId = String(APP_CONFIG.data.spreadsheetId || '').trim();
  const shName = String(APP_CONFIG.data.sheetName || '').trim();
  if (!ssId || !shName) return [];
  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(shName);
  if (!sh) return [];

  const last = sh.getLastRow();
  if (last < 4) return [];

  const vals = sh.getRange(4, 4, last - 3, 1).getValues();

  const map = {};
  for (let i = 0; i < vals.length; i++) {
    const raw = vals[i][0];
    const disp = st_normBrandDisplay_(raw);
    if (!disp) continue;

    const key = st_normBrandKey_(disp);
    if (!key) continue;

    if (!map[key]) {
      map[key] = disp;
    } else {
      const cur = String(map[key]);
      if (disp.length < cur.length) map[key] = disp;
    }
  }

  const out = Object.keys(map).map(k => map[k]);
  out.sort((a, b) => a.localeCompare(b, 'ja'));
  return out;
}
