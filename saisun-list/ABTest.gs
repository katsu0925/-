// ABTest.gs
// =====================================================
// A/Bテストフレームワーク (Phase 4-8)
// フロントエンドの施策効果測定
// =====================================================

/**
 * ABテストシートを取得（なければ作成）
 */
function getABTestSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('ABテスト');
  if (!sheet) {
    sheet = ss.insertSheet('ABテスト');
    sheet.appendRow(['テストID', 'テスト名', 'バリアントA説明', 'バリアントB説明', '開始日', '終了日', 'ステータス', 'トラフィック割合']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

/**
 * ABテスト結果シートを取得（なければ作成）
 */
function getABTestResultSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('ABテスト結果');
  if (!sheet) {
    sheet = ss.insertSheet('ABテスト結果');
    sheet.appendRow(['テストID', 'バリアント', 'userKey', 'イベント種別', '日時', '値']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

/**
 * バリアント取得API
 * userKeyのハッシュでA/Bを一貫割り当て
 * @param {string} userKey
 * @param {object} params - { testId }
 * @return {object}
 */
function apiGetABTestVariant(userKey, params) {
  try {
    var testId = String(params.testId || '').trim();
    if (!testId) return { ok: false, message: 'テストIDが指定されていません' };
    if (!userKey) return { ok: false, message: 'userKeyが不正です' };

    // テスト情報を取得
    var sheet = getABTestSheet_();
    var data = sheet.getDataRange().getValues();
    var test = null;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '') === testId) {
        test = {
          id: String(data[i][0] || ''),
          name: String(data[i][1] || ''),
          variantA: String(data[i][2] || ''),
          variantB: String(data[i][3] || ''),
          startDate: data[i][4],
          endDate: data[i][5],
          status: String(data[i][6] || ''),
          trafficRatio: Number(data[i][7]) || 0.5
        };
        break;
      }
    }

    if (!test) return { ok: false, message: 'テストが見つかりません' };
    if (test.status !== 'active') return { ok: false, message: 'このテストは現在実行中ではありません' };

    // userKeyのハッシュでバリアント決定（一貫性のある割り当て）
    var hash = simpleHash_(userKey + ':' + testId);
    var ratio = (hash % 100) / 100;
    var variant = ratio < test.trafficRatio ? 'A' : 'B';

    // impressionイベント記録（非同期的にバックグラウンドで）
    try {
      recordABTestEvent_(testId, variant, userKey, 'impression', 1);
    } catch (e) {
      console.log('optional: AB test impression record: ' + (e.message || e));
    }

    return {
      ok: true,
      data: {
        testId: test.id,
        testName: test.name,
        variant: variant,
        description: variant === 'A' ? test.variantA : test.variantB
      }
    };
  } catch (e) {
    console.error('apiGetABTestVariant error:', e);
    return { ok: false, message: 'テストバリアントの取得に失敗しました' };
  }
}

/**
 * イベント記録API
 * @param {string} userKey
 * @param {object} params - { testId, eventType, value }
 * @return {object}
 */
function apiTrackABTestEvent(userKey, params) {
  try {
    var testId = String(params.testId || '').trim();
    var eventType = String(params.eventType || '').trim();
    var value = Number(params.value || 0);

    if (!testId || !eventType) return { ok: false, message: 'パラメータが不足しています' };
    if (!userKey) return { ok: false, message: 'userKeyが不正です' };

    // バリアントを再計算
    var hash = simpleHash_(userKey + ':' + testId);
    var ratio = (hash % 100) / 100;

    // テストのトラフィック割合を取得
    var testSheet = getABTestSheet_();
    var testData = testSheet.getDataRange().getValues();
    var trafficRatio = 0.5;
    for (var i = 1; i < testData.length; i++) {
      if (String(testData[i][0] || '') === testId) {
        trafficRatio = Number(testData[i][7]) || 0.5;
        break;
      }
    }

    var variant = ratio < trafficRatio ? 'A' : 'B';

    recordABTestEvent_(testId, variant, userKey, eventType, value);

    return { ok: true };
  } catch (e) {
    console.error('apiTrackABTestEvent error:', e);
    return { ok: false, message: 'イベント記録に失敗しました' };
  }
}

/**
 * テスト結果集計API（管理者用）
 */
function adminGetABTestResults(adminKey, params) {
  try {
    ad_requireAdmin_(adminKey);
    var testId = String((params || {}).testId || '').trim();

    var resultSheet = getABTestResultSheet_();
    if (resultSheet.getLastRow() < 2) return { ok: true, data: { results: [] } };

    var data = resultSheet.getDataRange().getValues();

    // テスト別・バリアント別・イベント別に集計
    var stats = {}; // { testId: { A: { impressions, conversions, users }, B: {...} } }

    for (var i = 1; i < data.length; i++) {
      var tid = String(data[i][0] || '');
      if (testId && tid !== testId) continue;

      var variant = String(data[i][1] || '');
      var uk = String(data[i][2] || '');
      var eventType = String(data[i][3] || '');

      if (!stats[tid]) stats[tid] = { A: { impressions: 0, conversions: 0, users: {} }, B: { impressions: 0, conversions: 0, users: {} } };
      if (!stats[tid][variant]) continue;

      stats[tid][variant].users[uk] = true;
      if (eventType === 'impression') stats[tid][variant].impressions++;
      if (eventType === 'conversion') stats[tid][variant].conversions++;
    }

    var results = [];
    for (var tid in stats) {
      var s = stats[tid];
      var aUsers = Object.keys(s.A.users).length;
      var bUsers = Object.keys(s.B.users).length;
      var aRate = s.A.impressions > 0 ? s.A.conversions / s.A.impressions : 0;
      var bRate = s.B.impressions > 0 ? s.B.conversions / s.B.impressions : 0;

      // 簡易Z検定
      var significance = calcZTest_(s.A.conversions, s.A.impressions, s.B.conversions, s.B.impressions);

      results.push({
        testId: tid,
        variantA: { users: aUsers, impressions: s.A.impressions, conversions: s.A.conversions, rate: Math.round(aRate * 10000) / 100 },
        variantB: { users: bUsers, impressions: s.B.impressions, conversions: s.B.conversions, rate: Math.round(bRate * 10000) / 100 },
        significant: significance.significant,
        pValue: significance.pValue,
        winner: significance.significant ? (aRate > bRate ? 'A' : 'B') : 'none'
      });
    }

    return { ok: true, data: { results: results } };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

/**
 * イベント記録（内部）
 */
function recordABTestEvent_(testId, variant, userKey, eventType, value) {
  var sheet = getABTestResultSheet_();
  sheet.appendRow([testId, variant, userKey, eventType, new Date(), value || 0]);
}

/**
 * 簡易ハッシュ関数（一貫したバリアント割り当て用）
 */
function simpleHash_(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit整数に変換
  }
  return Math.abs(hash);
}

/**
 * 簡易Z検定（二項比率の比較）
 */
function calcZTest_(convA, impA, convB, impB) {
  if (impA < 30 || impB < 30) return { significant: false, pValue: 1 };

  var pA = convA / impA;
  var pB = convB / impB;
  var pPool = (convA + convB) / (impA + impB);

  var se = Math.sqrt(pPool * (1 - pPool) * (1 / impA + 1 / impB));
  if (se === 0) return { significant: false, pValue: 1 };

  var z = Math.abs(pA - pB) / se;

  // 簡易p値近似
  var pValue = z > 2.576 ? 0.01 : (z > 1.96 ? 0.05 : (z > 1.645 ? 0.1 : 1));

  return { significant: pValue <= 0.05, pValue: pValue };
}
