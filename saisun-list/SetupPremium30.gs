// SetupPremium30.gs
// =====================================================
// プレミアムアソート限定 30%OFF キャンペーン（2026-08-22 配信）
// クーポン「PREMIUM30」登録 + メルマガ登録の一括セットアップ
//
// 冪等: 既に同じクーポンコード / 同じタイトルのメルマガがあれば追加しない
// 実行: GASエディタから setupPremium30Campaign() を直接実行
//       もしくは apiSyncSetupCampaign({ syncSecret, campaign:'premium30' })
// =====================================================

var PREMIUM30_CONFIG = {
  code: 'PREMIUM30',
  startDate: '2026-08-21',
  expires: '2026-08-28',
  // アソート商品シートの「採寸付きプレミアムアソート」小/中/大
  targetProducts: 'BLK-ST9WSKGF,BLK-YSHZVKRU,BLK-JCNMTYTU',
  newsletterTitle: '【8/28まで】採寸付きプレミアムアソートが30%OFF',
  newsletterSchedule: new Date(2026, 7, 22, 9, 0, 0), // 2026-08-22 09:00 JST
  newsletterTarget: '全員',
  newsletterFrequency: '一度'
};

/**
 * 本文（プレーンテキスト。配信時に配信停止リンクが自動付与される）
 */
function premium30NewsletterBody_() {
  var url = SITE_CONSTANTS.SITE_URL + '?page=bulk';
  return [
    'いつもデタウリ.Detauriをご利用いただきありがとうございます。',
    '',
    '採寸付きプレミアムアソート限定で、30%OFFクーポンをご用意いたしました。',
    '',
    '【クーポンコード】PREMIUM30',
    '【割引率】30%OFF',
    '【期間】2026年8月22日（金）〜 8月28日（木）',
    '',
    '■ 対象商品と割引後価格',
    '・プレミアムアソート 小ロット　¥6,800 → ¥4,760',
    '・プレミアムアソート 中ロット　¥16,200 → ¥11,340',
    '・プレミアムアソート 大ロット　¥32,000 → ¥22,400',
    '',
    'プレミアムアソートは、採寸データと撮影画像を添えてお届けするアソートです。',
    '即出品用のxlsxが付属しますので、届いたその日から「貼るだけ」で出品作業を始められます。',
    '採寸・撮影を外注されている方は、その分の工数と費用をそのまま削減いただけます。',
    '',
    '■ ご利用上の注意',
    '・プレミアムアソートのみのご注文でご利用いただけます（他の商品と同時にご注文の場合は適用されません）',
    '・お一人様1回限りのご利用となります',
    '・他の割引との併用はできません',
    '・在庫には限りがございます。なくなり次第終了となります',
    '',
    'ご注文はこちらから',
    url,
    '',
    'ご不明な点がございましたら、お気軽にお問い合わせください。'
  ].join('\n');
}

/**
 * クーポン「PREMIUM30」を登録（冪等）
 */
function setupPremium30Coupon_() {
  var C = PREMIUM30_CONFIG;
  var res = registerCouponFromDialog({
    code: C.code,
    type: 'rate',
    value: 30,                       // registerCouponFromDialog 側で /100 され 0.30 になる
    expires: C.expires,
    maxUses: 0,                      // 利用上限なし
    oncePerUser: true,               // 1人1回限り
    target: 'all',
    startDate: C.startDate,
    memo: 'プレミアムアソート限定30%OFF（2026-08-22メルマガ告知）',
    comboMember: false,              // 会員割引との併用不可
    comboBulk: false,                // 数量割引との併用不可
    channel: 'bulk',
    targetProducts: C.targetProducts,
    freeShipping: false
  });
  return res;
}

/**
 * メルマガを「ニュースレター」シートに登録（冪等）
 */
function setupPremium30Newsletter_() {
  var C = PREMIUM30_CONFIG;
  var sheet = getNewsletterSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var titles = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < titles.length; i++) {
      if (String(titles[i][0] || '').trim() === C.newsletterTitle) {
        return { ok: false, message: 'メルマガ「' + C.newsletterTitle + '」は既に登録されています（行' + (i + 2) + '）' };
      }
    }
  }
  // 列構成: タイトル / 本文 / 配信日時 / ステータス / 頻度 / 最終配信日 / 対象 / 送信済み(分割)
  sheet.appendRow([
    C.newsletterTitle,
    premium30NewsletterBody_(),
    C.newsletterSchedule,
    '配信待ち',
    C.newsletterFrequency,
    '',
    C.newsletterTarget,
    ''
  ]);
  var recipients = getNewsletterRecipients_(C.newsletterTarget);
  return { ok: true, message: 'メルマガ「' + C.newsletterTitle + '」を登録しました（2026-08-22 09時台のcronで配信 / 対象: ' + C.newsletterTarget + ' ' + recipients.length + '人）' };
}

/**
 * 登録済みメルマガ行のスナップショット（検証用）
 */
function premium30NewsletterSnapshot_() {
  var C = PREMIUM30_CONFIG;
  var sheet = getNewsletterSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === C.newsletterTitle) {
      var sched = rows[i][2];
      return {
        row: i + 2,
        title: String(rows[i][0]),
        bodyLength: String(rows[i][1] || '').length,
        bodyHead: String(rows[i][1] || '').slice(0, 60),
        scheduledAt: (sched instanceof Date)
          ? Utilities.formatDate(sched, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
          : String(sched),
        status: String(rows[i][3] || ''),
        frequency: String(rows[i][4] || ''),
        lastSentAt: String(rows[i][5] || ''),
        target: String(rows[i][6] || ''),
        sentSplit: String(rows[i][7] || '')
      };
    }
  }
  return null;
}

/**
 * クーポン + メルマガをまとめてセットアップ
 */
function setupPremium30Campaign() {
  var out = { ok: true, coupon: null, newsletter: null };
  try {
    out.coupon = setupPremium30Coupon_();
  } catch (e) {
    out.coupon = { ok: false, message: String(e && e.message || e) };
  }
  try {
    out.newsletter = setupPremium30Newsletter_();
  } catch (e) {
    out.newsletter = { ok: false, message: String(e && e.message || e) };
  }
  try {
    out.newsletterRow = premium30NewsletterSnapshot_();
  } catch (e) {
    out.newsletterRow = { error: String(e && e.message || e) };
  }
  console.log('setupPremium30Campaign: ' + JSON.stringify(out));
  return out;
}

/**
 * apiSyncSetupCampaign — SYNC_SECRET 認証でキャンペーンセットアップを実行
 *
 * @param {object} params - { syncSecret, campaign }
 */
function apiSyncSetupCampaign(params) {
  var p = params || {};
  if (!verifySyncSecret_(p.syncSecret)) {
    return { ok: false, message: '認証エラー' };
  }
  var campaign = String(p.campaign || '').trim();
  if (campaign !== 'premium30') {
    return { ok: false, message: '不明なキャンペーン: ' + campaign };
  }
  return setupPremium30Campaign();
}
