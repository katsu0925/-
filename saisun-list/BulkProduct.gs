// BulkProduct.gs
// =====================================================
// BulkProduct.gs — アソート商品データ読み込み（画像5枚対応）
// =====================================================

/**
 * アソート商品一覧を取得（キャッシュ付き）
 * @returns {object[]} 商品リスト
 */
// =====================================================
// 2026-06-01「採寸撮影付き」リブランドの一回限り反映（実行済み・現在は休眠）
// ScriptProperty PREMIUM_REPRICED_PROP_ が「シート価格を反映済み」のラッチになっており、
// ONの間は何もしない。このフラグは SubmitFix.gs の getPremiumTarget_() も参照していて、
// 選定目標額と顧客表示価格が食い違わないようにしている（フラグを手で消さないこと）。
// 以降の価格改定は applyPremiumRepricingNow() を手動実行する運用に切り替えた。
// =====================================================
function maybeApplyPremiumRepricing_() {
  if (typeof PRICE_TIER_V2_EFFECTIVE_MS_ === 'undefined') return;
  if (Date.now() < PRICE_TIER_V2_EFFECTIVE_MS_) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PREMIUM_REPRICED_PROP_) === '1') return;
  var n = applyPremiumRepricing_();
  // 1行以上更新できた時だけフラグON（名称不一致による無言失敗を防ぐ＝次回読込で再試行）
  if (n > 0) {
    props.setProperty(PREMIUM_REPRICED_PROP_, '1');
    console.log('プレミアムアソート 価格反映完了: ' + n + '行更新');
  } else {
    console.warn('プレミアムアソート 価格反映: 対象行が見つからずスキップ（シートの商品名を要確認）');
  }
}

// =====================================================
// 2026-08-29 値下げの自動反映（無人・一回限り）
// -----------------------------------------------------
// SubmitFix.gs の選定目標額は PREMIUM_TARGET_V3_EFFECTIVE_MS_ を過ぎると**自動でV3に切り替わる**。
// シート側（顧客価格・タイトル・説明）が手動のままだと、切替直後に
//   「客は旧価格¥16,200を払うのに、箱の中身は新目標額¥14,800分しか入らない」
// という逆ざや（お得額がマイナス）の窓が開く。両者は必ず同時に動かす必要があるため、
// 発効時刻を過ぎた最初のシート読込で一度だけ自動反映する。
//
// ・ScriptProperty PREMIUM_REPRICED_V3_PROP_ が反映済みラッチ（手で消さないこと）
// ・1行以上書けた時だけラッチON＝商品名不一致で空振りした場合は次回読込で再試行
// ・同時実行はロックで弾く（書き換え自体は冪等なので二重実行しても結果は同じ）
// ・画像(G〜K列)は PREMIUM_IMAGES_V3_ の1枚目（サムネ）と2枚目（出品キットのデモ画面）を
//   差し替える。書き込み前にURLを取得して 200 かつ画像であることを確認し、
//   開けない場合は既存画像を維持する
//   （＝無人実行で壊れたURLを入れてサムネを失う事故を防ぐ）。空スロットは常に据え置き
// ・結果は ADMIN_OWNER_EMAIL へメール通知する。失敗・空振りの通知は
//   PREMIUM_REPRICED_V3_ALERT_PROP_ で1回に絞る（5分おきの再試行でメールが溢れないように）
// =====================================================
var PREMIUM_REPRICED_V3_PROP_ = 'PREMIUM_REPRICED_0829';
var PREMIUM_REPRICED_V3_ALERT_PROP_ = 'PREMIUM_REPRICED_0829_ALERTED';

function maybeApplyPremiumRepricingV3_() {
  if (typeof PREMIUM_TARGET_V3_EFFECTIVE_MS_ === 'undefined') return;
  if (Date.now() < PREMIUM_TARGET_V3_EFFECTIVE_MS_) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PREMIUM_REPRICED_V3_PROP_) === '1') return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;   // 別実行が反映中。次回読込に任せる
  try {
    if (props.getProperty(PREMIUM_REPRICED_V3_PROP_) === '1') return;   // ロック待ちの間に済んでいた
    var n = applyPremiumRepricing_(false);
    if (n > 0) {
      props.setProperty(PREMIUM_REPRICED_V3_PROP_, '1');
      console.log('プレミアムアソート 2026-08-29値下げ 自動反映完了: ' + n + '行更新');
      premium_notifyAdmin_(
        '【デタウリ】プレミアムアソートの新価格に切り替わりました',
        premium_buildRepriceMailHtml_(n),
        null);   // 成功はラッチで一回限りなので絞り込み不要
    } else {
      console.warn('プレミアムアソート 2026-08-29値下げ 自動反映: 対象行が見つからずスキップ（シートの商品名を要確認）');
      premium_notifyAdmin_(
        '【要確認・デタウリ】プレミアムアソートの値下げが反映できていません',
        '<p>2026-08-29 の値下げを自動で反映しようとしましたが、'
        + '<b>アソート商品シートに対象の商品が見つかりませんでした</b>。</p>'
        + '<p>お客様に表示される価格は<b>旧価格のまま</b>ですが、箱に入れる商品の目標金額は'
        + '<b>新しい金額に切り替わっています</b>。このままだと、お客様が払った金額より'
        + '中身が少なくなってしまうため、<b>できるだけ早く確認してください</b>。</p>'
        + '<p>確認する場所: アソート商品シートの商品名が「プレミアムアソート小ロット / 中ロット / 大ロット」'
        + 'を含んでいるか。名前を変えた場合は BulkProduct.gs の PREMIUM_PRICE_V3_ も合わせて直してください。</p>'
        + '<p>※ 5分おきに自動で再試行します。直れば成功メールが届きます。このお知らせは1回だけ送ります。</p>',
        PREMIUM_REPRICED_V3_ALERT_PROP_);
    }
  } catch (e) {
    console.error('プレミアムアソート 2026-08-29値下げ 自動反映エラー:', e);
    premium_notifyAdmin_(
      '【要確認・デタウリ】プレミアムアソートの値下げ反映でエラーが発生しました',
      '<p>2026-08-29 の値下げを自動で反映しようとしてエラーが出ました。</p>'
      + '<p>お客様に表示される価格は<b>旧価格のまま</b>の可能性があります。箱に入れる商品の目標金額は'
      + '<b>新しい金額に切り替わっています</b>ので、<b>できるだけ早く確認してください</b>。</p>'
      + '<p>エラー内容: ' + premium_escapeHtml_(String(e && e.message ? e.message : e)) + '</p>'
      + '<p>※ 5分おきに自動で再試行します。直れば成功メールが届きます。このお知らせは1回だけ送ります。</p>',
      PREMIUM_REPRICED_V3_ALERT_PROP_);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 管理者へのお知らせメール。送信に失敗しても値下げ処理そのものは止めない。
 * onceProp を渡すと、そのプロパティが立つまで1回だけ送る（再試行のたびにメールが来るのを防ぐ）。
 */
function premium_notifyAdmin_(subject, html, onceProp) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (onceProp && props.getProperty(onceProp) === '1') return;
    var to = String(props.getProperty('ADMIN_OWNER_EMAIL') || APP_CONFIG.notifyEmails || '').split(',')[0].trim();
    if (!to) { console.warn('プレミアムアソート通知: ADMIN_OWNER_EMAIL 未設定のため送信をスキップ'); return; }
    var text = String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    MailApp.sendEmail({ to: to, subject: subject, body: text, htmlBody: html, noReply: true });
    if (onceProp) props.setProperty(onceProp, '1');
    console.log('プレミアムアソート通知: 送信完了 → ' + to);
  } catch (e) {
    console.error('プレミアムアソート通知: 送信失敗', e);
  }
}

function premium_escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 反映結果のお知らせ本文。「こう書いたつもり」ではなく、
 * **シートを読み直して実際に入っている値**を載せる（＝そのまま確認に使える）。
 */
function premium_buildRepriceMailHtml_(rowCount) {
  var rows = [];
  var err = '';
  try {
    var ss = SpreadsheetApp.openById(String(BULK_CONFIG.spreadsheetId || '').trim());
    var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
    var lastRow = sh.getLastRow();
    var c = BULK_CONFIG.cols;
    var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var name = String(data[i][c.name] || '').trim();
      var key = null;
      for (var k in PREMIUM_PRICE_V3_) { if (name === k || name.indexOf(k) >= 0) { key = k; break; } }
      if (!key) continue;
      var imgs = PREMIUM_IMAGES_V3_[key] || [];
      // 「設定したつもり」ではなく、シートのG列に実際に入っている値で判定する
      var wantImg = String(imgs[0] || '').trim();
      var curImg = String(data[i][c.image1] || '').trim();
      rows.push({
        key: key,
        name: name,
        price: Number(data[i][c.price]) || 0,
        target: (PREMIUM_ASSORT_TARGET_V3_ && PREMIUM_ASSORT_TARGET_V3_[key]) || 0,
        stock: Number(data[i][c.stock]) || 0,
        imageWanted: !!wantImg,
        imageNew: !!wantImg && curImg === wantImg
      });
    }
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }

  var h = '<div style="font-family:sans-serif;font-size:14px;line-height:1.7">'
    + '<p>プレミアムアソートの新価格が、サイトとBASEに自動で反映されました（' + rowCount + '件）。</p>'
    + '<p>お客様に表示される販売価格と、箱に入れる商品の目標金額が、<b>同時に新しい設定へ切り替わっています</b>。</p>';

  if (rows.length) {
    h += '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px">'
      + '<tr style="background:#f3f4f6"><th>商品</th><th>販売価格<br>（お客様が払う額）</th>'
      + '<th>目標金額<br>（箱に入れる額）</th><th>お得額</th><th>在庫（箱数）</th><th>サムネ画像</th></tr>';
    for (var r = 0; r < rows.length; r++) {
      var x = rows[r];
      var deal = x.target - x.price;
      h += '<tr><td>' + premium_escapeHtml_(x.key) + '</td>'
        + '<td align="right">' + premium_yen_(x.price) + '円</td>'
        + '<td align="right">' + premium_yen_(x.target) + '円</td>'
        + '<td align="right">' + (deal > 0 ? premium_yen_(deal) + '円' : '<b style="color:#b91c1c">' + premium_yen_(deal) + '円（要確認）</b>') + '</td>'
        + '<td align="right">' + x.stock + '</td>'
        + '<td>' + (x.imageNew ? '新しい画像に差し替え済み'
              : (x.imageWanted ? '<b style="color:#b91c1c">差し替え失敗（要確認）</b>'
                               : '<b style="color:#b45309">これまでの画像のまま</b>')) + '</td></tr>';
    }
    h += '</table>';
  }
  if (err) h += '<p style="color:#b91c1c">※ 確認用にシートを読み直す際にエラーが出ました: ' + premium_escapeHtml_(err) + '</p>';

  var anyFailed = false, anyKept = false;
  for (var q = 0; q < rows.length; q++) {
    if (rows[q].imageNew) continue;
    if (rows[q].imageWanted) anyFailed = true; else anyKept = true;
  }
  if (anyFailed) {
    // 新しい画像URLを設定してあるのにシートに入らなかった＝URLが開けなかったケース。
    // （壊れたURLを書き込まないよう、わざと据え置きにしている）
    h += '<p style="background:#fee2e2;padding:10px;border-radius:6px">'
      + '<b>サムネ画像の差し替えだけ失敗しました。</b>価格・タイトル・説明文は正しく新しくなっています。'
      + '新しい画像のURLが開けなかったため、これまでの画像をそのまま残しました（消えてはいません）。'
      + '下のURLをブラウザで開いて画像が表示されるか確かめてください。表示されるようになったら、'
      + 'GASエディタで applyPremiumRepricingNow() を実行すると差し替わります。<br>'
      + 'https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-small-v5.jpg</p>';
  }
  if (anyKept) {
    // 旧サムネには金額も点数も入っていないため、表示が矛盾することはない（訴求が弱いだけ）。
    h += '<p style="background:#fef3c7;padding:10px;border-radius:6px">'
      + '<b>サムネ画像はこれまでのものを使っています。</b>画像に金額や点数は入っていないので、'
      + '新しい価格と矛盾することはありません（新しい点数・お得額を画像でも見せられていない、というだけです）。'
      + '差し替える場合は BulkProduct.gs の PREMIUM_IMAGES_V3_ にURLを入れて反映し、'
      + 'GASエディタで applyPremiumRepricingNow() を実行してください。</p>';
  }

  h += '<p>確認先:<br>'
    + 'サイト: https://wholesale.nkonline-tool.com/<br>'
    + 'BASE管理画面の商品一覧</p>'
    + '<p style="color:#6b7280;font-size:12px">※ 反映は最大10分ほどかかることがあります。'
    + 'このお知らせは切り替え時の1回だけ送られます。</p></div>';
  return h;
}

// =====================================================
// 2026-08 プレミアムアソート 値下げ・点数改定（在庫消化・現金化優先）
// -----------------------------------------------------
// アソート商品シートのプレミアム3行について、次の列を一度の実行でまとめて書き換える。
//   B列 商品名   … 先頭の「○円分お得」を新しいお得額に置換
//   C列 説明     … 「必ず○円(税込み)以上」＝選定目標額 ／「・販売価格：○円（税込み）」＝顧客価格
//   D列 価格     … 顧客が払う販売価格
//   G〜K列 画像  … PREMIUM_IMAGES_V3_ に値が入っている場合のみ差し替え（空ならその枠は据え置き）
//
// 書き換え後は既存の同期経路が自動で追随するため、ここ以外の作業は不要。
//   BASE     : BulkBaseSync.gs baseSyncProductsToBase()（5分Cron・MD5差分で title/detail/price/画像を検知）
//   自社サイト: SyncApi.gs exportBulkProducts_() → Worker 5分Cron → D1 → KV → BulkLP
// 反映まで最大およそ10分。急ぐ場合は applyPremiumRepricingNow() がキャッシュも落とす。
// =====================================================

// お客様が払う「販売価格」（シートD列）。
// 自動選定の目標額（SubmitFix.gs PREMIUM_ASSORT_TARGET_V2_）とは別物で、こちらの方が安い。
// 差額がそのまま商品名の「○円分お得」訴求になるため、**両者を同額にしないこと**。
var PREMIUM_PRICE_V3_ = {
  'プレミアムアソート小ロット': 6800,   // 据置（目標7,900・お得+1,100・約16点）
  'プレミアムアソート中ロット': 12800,  // 16,200 → 12,800（目標14,800・お得+2,000・30点）
  'プレミアムアソート大ロット': 19800   // 32,000 → 19,800（目標22,600・お得+2,800・約46点）
};

// 差し替える画像URL（G〜K列 = 画像URL1〜5）。1枚目＝サムネ、2枚目＝出品キットのデモ画面。
// 空文字／未指定のスロットは既存の画像をそのまま残す（＝3〜5枚目は今までどおり）。
//
// 画像の実体は saisun-list/img/premium-assort/ に置いてあり、main へ push すると
// Cloudflare Pages が自動で配信する（＝恒久・公開URL）。BASE は add_image のときに
// サーバー側でこのURLを取りに来るので、ログイン不要で開けるURLである必要がある。
// ※ Googleドライブ（lh3.googleusercontent.com/d/<fileId>）は共有設定に左右されるため使わない。
// v4（2026-08-26）: タイトルの旧表記「採寸付きパッケージ」を「採寸撮影付きパッケージ」へ修正し、
// 下部に訴求の帯を1本追加した。
// v5（2026-08-26）: 帯の文言から「xlsx」を外し、「出品キット付き／採寸データも撮影画像も
// そろって、そのまま出品できます」に変更。xlsx はお客様に伝わらないため、何が届くのか
// （＝出品キット）を明記する。生成スクリプトは tools/premium-assort-thumb/generate.py
// （v3のJPEGを土台に上部のタイトルと下部の帯だけ合成する）。
// kit-demo-v1（2026-08-26）: 2枚目に登録されていたスプレッドシートのスクリーンショットを、
// 出品キット（デモ画面）の画像へ差し替えた。お客様に渡すのは XLSX ではなく出品キットの
// Webページなので、実物の画面を見せる。撮影元は /kit?mode=demo（トークン不要の常時公開）、
// 生成スクリプトは tools/premium-assort-thumb/generate-kitdemo.py。
// kit-demo-v2（2026-08-26）: デモが写真なしのダミー4点で「画像未アップロード」と出ていたため、
// v1では画像ギャラリーを外していた。デモデータを実際に納品したキットの4点（撮影画像つき・
// 受付番号と氏名だけサンプル値に匿名化）へ差し替えたので、撮影画像ギャラリーと採寸データ
// まで写した画像に差し替えた。デモデータ本体は workers/gas-proxy/src/handlers/kit.js の
// serveDemoKit にある。
// ★差し替えるときは必ずファイル名のバージョンを上げること。同名で上書きすると
//   BASE 側の差分検知（画像URL5本のMD5）が反応せず、貼り直されない。
var PREMIUM_IMAGES_V3_ = {
  'プレミアムアソート小ロット': ['https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-small-v5.jpg', 'https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-kit-demo-v2.jpg', '', '', ''],
  'プレミアムアソート中ロット': ['https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-medium-v5.jpg', 'https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-kit-demo-v2.jpg', '', '', ''],
  'プレミアムアソート大ロット': ['https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-large-v5.jpg', 'https://wholesale.nkonline-tool.com/img/premium-assort/premium-assort-kit-demo-v2.jpg', '', '', '']
};

// 画像URLの生存確認。8/29の自動反映は無人で走るので、URLが死んでいた場合に
// 「開けないURL」をシートへ書き込んでサムネを丸ごと失うのが最悪のケースになる。
// 200 かつ Content-Type が image/* のときだけ true を返し、それ以外は既存画像を維持する。
var PREMIUM_IMAGE_CHECK_CACHE_ = {};
function premium_imageUrlOk_(url) {
  if (Object.prototype.hasOwnProperty.call(PREMIUM_IMAGE_CHECK_CACHE_, url)) {
    return PREMIUM_IMAGE_CHECK_CACHE_[url];
  }
  var ok = false;
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var code = res.getResponseCode();
    var head = res.getHeaders() || {};
    var ct = String(head['Content-Type'] || head['content-type'] || '');
    ok = (code === 200 && /^image\//i.test(ct));
    if (!ok) {
      console.warn('プレミアムアソート: 画像URLが使えないため据え置き（HTTP ' + code + ' / ' + ct + '） ' + url);
    }
  } catch (e) {
    console.warn('プレミアムアソート: 画像URLの確認に失敗したため据え置き ' + url + ' / ' + e);
  }
  PREMIUM_IMAGE_CHECK_CACHE_[url] = ok;
  return ok;
}

// 3桁区切り（説明文・商品名の表記に合わせる）
function premium_yen_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 商品名／説明文の「価格が書かれている箇所」だけを新しい金額に差し替える。
// 実データの表記ゆれ（お得額はカンマあり・目標額は半角括弧・販売価格は全角括弧）に合わせている。
function premium_rewriteName_(name, deal) {
  if (!/^[0-9,]+円分お得/.test(name)) return name;   // 想定外の書式なら触らない
  return name.replace(/^[0-9,]+円分お得/, premium_yen_(deal) + '円分お得');
}
function premium_rewriteDesc_(desc, target, price) {
  var s = String(desc || '');
  // 「封入内容は…が必ず7,400円(税込み)以上の商品に調整して…」→ 選定目標額
  s = s.replace(/必ず[0-9,]+円\(税込み\)以上/g, '必ず' + premium_yen_(target) + '円(税込み)以上');
  // 「・販売価格：6,800円（税込み）／1パッケージ」→ 顧客価格
  s = s.replace(/・販売価格：[0-9,]+円（税込み）/g, '・販売価格：' + premium_yen_(price) + '円（税込み）');
  return s;
}

// アソート商品シートのプレミアム3行を最新の価格・訴求文言・画像に更新し、更新できた行数を返す。
// ScriptProperty のフラグは見ない（手動でも単独実行可能）。書き換えは冪等。
function applyPremiumRepricing_(dryRun, force) {
  // PREMIUM30（30%OFF・〜2026-08-28）が旧価格でメルマガ配信済みのため、発効時刻までは書き込まない。
  // 下見（dryRun）はいつでも可。どうしても前倒しする場合は applyPremiumRepricingNow(true)。
  if (!dryRun && !force
      && typeof PREMIUM_TARGET_V3_EFFECTIVE_MS_ !== 'undefined'
      && Date.now() < PREMIUM_TARGET_V3_EFFECTIVE_MS_) {
    console.warn('プレミアムアソート反映: 発効時刻（2026-08-29 00:00 JST）前のため中止しました。'
      + '内容の確認は previewPremiumRepricing()、前倒しは applyPremiumRepricingNow(true)。');
    return 0;
  }
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return 0;
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var note = '【採寸撮影データ付き】出品キットから全商品の撮影画像をダウンロードでき、フリマ出品にそのまま使えます。';
  var count = 0;

  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][c.name] || '').trim();
    // 完全一致または部分一致（小/中/大は互いに部分文字列にならないため安全）
    var matchKey = null;
    for (var k in PREMIUM_PRICE_V3_) { if (name === k || name.indexOf(k) >= 0) { matchKey = k; break; } }
    if (!matchKey) continue;

    var row = i + 2;
    var price = PREMIUM_PRICE_V3_[matchKey];
    // 目標額は SubmitFix.gs の一箇所だけを正とし、お得額は「目標額 − 販売価格」から必ず計算する
    // （手打ちしないことで、目標額を変えたときにお得額の表記だけ取り残される事故を防ぐ）。
    var target = (typeof PREMIUM_ASSORT_TARGET_V3_ !== 'undefined' && PREMIUM_ASSORT_TARGET_V3_[matchKey])
      ? PREMIUM_ASSORT_TARGET_V3_[matchKey] : 0;
    var deal = target - price;
    var changes = [];

    // --- B列 商品名 ---
    if (target > 0 && deal > 0) {
      var newName = premium_rewriteName_(name, deal);
      if (newName !== name) {
        changes.push('商品名: ' + name + '  →  ' + newName);
        if (!dryRun) sh.getRange(row, c.name + 1).setValue(newName);
      }
    } else {
      console.warn('プレミアムアソート: 目標額が取得できないため商品名は据え置き（' + matchKey + '）');
    }

    // --- C列 説明 ---
    var desc = String(data[i][c.description] || '');
    var newDesc = (target > 0) ? premium_rewriteDesc_(desc, target, price) : desc;
    if (newDesc.indexOf('採寸撮影データ付き') < 0) {
      newDesc = newDesc ? (newDesc + ' ' + note) : note;
    }
    if (newDesc !== desc) {
      changes.push('説明: 目標' + premium_yen_(target) + '円 / 販売' + premium_yen_(price) + '円 に更新');
      if (!dryRun) sh.getRange(row, c.description + 1).setValue(newDesc);
    }

    // --- D列 価格 ---
    var curPrice = Number(data[i][c.price]) || 0;
    if (curPrice !== price) {
      changes.push('価格: ' + premium_yen_(curPrice) + '円  →  ' + premium_yen_(price) + '円');
      if (!dryRun) sh.getRange(row, c.price + 1).setValue(price);
    }

    // --- G〜K列 画像（値が入っているスロットだけ差し替え） ---
    var imgs = PREMIUM_IMAGES_V3_[matchKey] || [];
    for (var j = 0; j < 5; j++) {
      var url = String(imgs[j] || '').trim();
      if (!url) continue;                                  // 空なら既存画像を維持
      var cur = String(data[i][c.image1 + j] || '').trim();
      if (cur === url) continue;
      if (!premium_imageUrlOk_(url)) continue;             // 開けないURLは書き込まない（既存画像を守る）
      changes.push('画像URL' + (j + 1) + ': 差し替え');
      if (!dryRun) sh.getRange(row, c.image1 + j + 1).setValue(url);
    }

    if (changes.length) {
      console.log('プレミアムアソート' + (dryRun ? '(下見)' : '') + ' [' + matchKey + '] 行' + row + '\n  - ' + changes.join('\n  - '));
    } else {
      console.log('プレミアムアソート' + (dryRun ? '(下見)' : '') + ' [' + matchKey + '] 行' + row + ' 変更なし');
    }
    count++;
  }

  if (count > 0 && !dryRun) SpreadsheetApp.flush();
  return count;
}

/**
 * 【手動実行用】プレミアムアソートの価格・訴求文言・画像をシートに反映し、キャッシュも落とす。
 * GASエディタからこの関数を選んで実行する。反映は BASE / 自社サイトとも最大およそ10分。
 * 2026-08-29 00:00 JST より前は安全のため中止する（force に true を渡すと前倒し実行）。
 */
function applyPremiumRepricingNow(force) {
  var n = applyPremiumRepricing_(false, force === true);
  bulk_clearCache_();
  var msg = 'プレミアムアソート反映: ' + n + '行を処理し、アソート商品キャッシュをクリアしました。';
  console.log(msg);
  return msg;
}

/**
 * 【下見用・書き込みなし】何がどう変わるかをログに出すだけ。実行前の確認に使う。
 */
function previewPremiumRepricing() {
  var n = applyPremiumRepricing_(true);
  var msg = 'プレミアムアソート下見: ' + n + '行が対象です（シートは変更していません）。';
  console.log(msg);
  return msg;
}

function bulk_getProducts_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(BULK_CONFIG.cache.key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  var products = bulk_readProductsFromSheet_();

  try {
    cache.put(BULK_CONFIG.cache.key, JSON.stringify(products), BULK_CONFIG.cache.ttl);
  } catch (e) {
    console.log('アソート商品キャッシュ保存エラー:', e);
  }

  return products;
}

/**
 * スプレッドシートからアソート商品データを読み込み
 * @returns {object[]} 公開中・表示順ソート済みの商品リスト
 */
function bulk_readProductsFromSheet_() {
  try { maybeApplyPremiumRepricing_(); } catch (e) {}
  try { maybeApplyPremiumRepricingV3_(); } catch (e) {}
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) return [];

  var ss;
  try { ss = SpreadsheetApp.openById(ssId); } catch (e) { console.error('アソート商品SS open error:', e); return []; }
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var c = BULK_CONFIG.cols;
  var products = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    var productId = String(row[c.productId] || '').trim();
    if (!productId) continue;

    // 公開・在庫チェック → soldOut フラグ
    var active = row[c.active];
    var isActive = (active === true || String(active).toUpperCase() === 'TRUE');
    var stockRaw = row[c.stock];
    var stock = (stockRaw === '' || stockRaw === null || stockRaw === undefined) ? -1 : Number(stockRaw);
    if (isNaN(stock)) stock = -1;
    var soldOut = (!isActive || stock === 0);

    // 画像URL（最大5枚、空でないものだけ収集）
    var images = [];
    for (var imgIdx = c.image1; imgIdx <= c.image5; imgIdx++) {
      var imgUrl = String(row[imgIdx] || '').trim();
      if (imgUrl && imgUrl.indexOf('drive.google.com') !== -1) {
        var m = imgUrl.match(/[?&]id=([^&]+)/);
        if (m) imgUrl = 'https://lh3.googleusercontent.com/d/' + m[1];
      }
      if (imgUrl) images.push(imgUrl);
    }

    var discount = Number(row[c.discount]) || 0;
    if (discount < 0 || discount > 1) discount = 0;
    var basePrice = Number(row[c.price]) || 0;

    products.push({
      productId: productId,
      name: String(row[c.name] || '').trim(),
      description: String(row[c.description] || '').trim(),
      price: basePrice,
      discountRate: discount,
      discountedPrice: discount > 0 ? Math.round(basePrice * (1 - discount)) : basePrice,
      unit: String(row[c.unit] || '').trim(),
      tag: String(row[c.tag] || '').trim(),
      images: images,
      minQty: Math.max(1, Number(row[c.minQty]) || 1),
      maxQty: Math.max(1, Number(row[c.maxQty]) || 99),
      sortOrder: Number(row[c.sortOrder]) || 999,
      stock: stock,
      soldOut: soldOut
    });
  }

  // 表示順でソート
  products.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

  return products;
}

/**
 * アソート商品キャッシュを無効化
 */
function bulk_clearCache_() {
  try { CacheService.getScriptCache().remove(BULK_CONFIG.cache.key); } catch (e) {}
}

/**
 * BULKスプレッドシートの onEdit ハンドラ
 * アソート商品シートが編集されたら GAS キャッシュを即クリアし、
 * Workers 側にも apiBulkRefresh を投げて D1 + KV を即時更新する。
 *
 * トリガー登録: Triggers.gs の tr_setupTriggersOnce_() 内で
 *   ScriptApp.newTrigger('bulk_onEdit').forSpreadsheet(bulkSs).onEdit().create()
 */
function bulk_onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (!sh || sh.getName() !== BULK_CONFIG.sheetName) return;
    // ヘッダー行は無視
    if (e.range.getRow() < 2) return;

    // GASキャッシュを即クリア
    bulk_clearCache_();

    // Workers にも即時反映を依頼（fire-and-forget）
    var props = PropertiesService.getScriptProperties();
    var workersUrl = props.getProperty('WORKERS_URL') || 'https://detauri-gas-proxy.nsdktts1030.workers.dev';
    var adminKey = props.getProperty('ADMIN_KEY') || '';
    if (!adminKey) {
      console.warn('bulk_onEdit: ADMIN_KEY未設定のためWorkers更新スキップ');
      return;
    }

    try {
      var resp = UrlFetchApp.fetch(workersUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          action: 'apiBulkRefresh',
          args: [{ adminKey: adminKey }]
        }),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code !== 200) {
        console.warn('bulk_onEdit: Workers refresh HTTP ' + code + ' body=' + resp.getContentText().slice(0, 200));
      }
    } catch (err) {
      console.error('bulk_onEdit: Workers refresh error: ' + (err && err.message || err));
    }
  } catch (err) {
    console.error('bulk_onEdit error: ' + (err && err.message || err));
  }
}

// adminBulkUploadImage は削除済み — saisun-list-bulk/コード.gs:294 に一本化
// BulkAdminModal.html は saisun-list-bulk にのみ存在

/**
 * アソート商品の初期化API（フロントエンドから呼ばれる）
 * @returns {object} { ok, products, settings }
 */
function apiBulkInit() {
  try {
    console.log('apiBulkInit: start');
    var products = bulk_getProducts_();
    console.log('apiBulkInit: products=' + products.length);
    var memberDiscount = app_getMemberDiscountStatus_();

    var detauriUrl = '';
    try { detauriUrl = SITE_CONSTANTS.SITE_URL || ''; } catch (e2) { console.log('apiBulkInit: SITE_URL error: ' + e2); }
    if (!detauriUrl) {
      try { detauriUrl = ScriptApp.getService().getUrl(); } catch (e3) { console.log('apiBulkInit: ScriptApp URL error: ' + e3); }
    }

    // 実績統計をキャッシュから付加
    var siteStats = null;
    try { siteStats = st_getStatsCache_(); } catch (e4) {}

    return {
      ok: true,
      products: products,
      settings: {
        appTitle: APP_CONFIG.appTitle,
        channel: BULK_CONFIG.channel,
        shippingAreas: SHIPPING_AREAS,
        shippingRates: SHIPPING_RATES,
        memberDiscount: memberDiscount,
        detauriUrl: detauriUrl,
        alwaysChargeShippingIds: (typeof SHIPPING_CONSTANTS !== 'undefined' && SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS) ? SHIPPING_CONSTANTS.ALWAYS_CHARGE_BULK_IDS : []
      },
      stats: siteStats
    };
  } catch (e) {
    console.error('apiBulkInit error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : ''));
    return { ok: false, message: (e && e.message) ? e.message : String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 顧客向け文言から「xlsx」を消す（2026-08-29）
//
// お客様に渡すのは XLSX ではなく出品キット（Webページ＋CSV）になったので、
// 商品名と説明文の言い回しを実態に合わせる。BASE・自社サイトへは5分Cronで反映。
//
// ⚠️ 触ってはいけないもの:
//   ・商品名の先頭「◯,◯◯◯円分お得」… premium_rewriteName_ の判定条件。
//     壊すと次の値下げで商品名だけ黙って更新がスキップされる
//   ・説明文の「必ず◯円(税込み)以上」「・販売価格：◯円（税込み）」
//     … premium_rewriteDesc_ の置換対象。表記が変わると金額が更新されなくなる
//   置換後に上記が残っているか必ず検証し、崩れていればその行は書き込まない。
// ═══════════════════════════════════════════════════════════════════════════

// 長い順に並べる必要はないが、部分文字列どうしが食い合わないよう
// 「より具体的な文」を先に置いている。適用は冪等（置換済みなら素通り）。
var PREMIUM_XLSX_WORDING_ = [
  // [置換前, 置換後]
  ['即出品xlsx', '出品キット'],

  ['紙ではなく、すぐ使えるxlsxデータ＋撮影画像でお渡しします。',
   '紙ではなく、そのまま出品に使える「出品キット」（Webページ）でお渡しします。採寸データや商品情報の一覧はCSVでダウンロードして保存できます。'],

  ['・採寸：全商品 平置き採寸データ付き（xlsx）',
   '・採寸：全商品 平置き採寸データ付き（出品キットで確認・CSVで保存できます）'],

  ['以下を「xlsx＋撮影画像＋メッセージ」でお渡しします。',
   '以下を「出品キット」（Webページ）でお渡しします。'],

  ['・採寸データ入りxlsx（管理番号付き）',
   '・採寸データ（管理番号付き／CSVでダウンロードできます）'],

  ['xlsx形式なので、そのまま転用しやすく、入力・転記の手間を大幅に削減できます。',
   'タイトル・説明文はワンタップでコピーでき、商品一覧はCSVで保存できるので、入力・転記の手間を大幅に削減できます。'],

  ['・管理番号で「xlsxデータ」と「撮影画像」をかんたんに照合できます',
   '・管理番号で「採寸データ」と「撮影画像」をかんたんに照合できます'],

  ['【xlsxデータ・撮影画像のお渡し方法について】',
   '【採寸データ・撮影画像のお渡し方法について】'],

  ['・購入後にメッセージにて、xlsxと出品キット（撮影画像）のダウンロード用リンクを共有します',
   '・発送のご連絡時に、出品キット（Webページ）のURLをお送りします'],

  ['・共有したリンクからxlsx・撮影画像を開いてご利用ください',
   '・そのページでタイトル・説明文・採寸データをご確認いただき、撮影画像もダウンロードいただけます'],

  // 【採寸撮影データ付き】の見出し文字列は値下げ自動反映の再追記ガードなので触らない
  ['出品キットから全商品の撮影画像をダウンロードでき、採寸データ（xlsx）とあわせて、フリマ出品にそのまま使えます。',
   '出品キットから全商品の撮影画像をダウンロードでき、採寸データとあわせて、フリマ出品にそのまま使えます。']
];

/**
 * プレミアムアソート3行の商品名・説明文から「xlsx」の表現を置き換える。
 * @param {boolean} execute true のときだけ実際に書き込む。既定は下見のみ
 */
function replacePremiumXlsxWording(execute) {
  var dryRun = (execute !== true);
  var ssId = String(BULK_CONFIG.spreadsheetId || '').trim();
  if (!ssId) { console.error('BULK_CONFIG.spreadsheetId が未設定です'); return 0; }
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(BULK_CONFIG.sheetName);
  if (!sh) { console.error('シートが見つかりません: ' + BULK_CONFIG.sheetName); return 0; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var c = BULK_CONFIG.cols;
  var data = sh.getRange(2, 1, lastRow - 1, BULK_SHEET_HEADER.length).getValues();
  var changed = 0;

  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][c.name] || '');
    var matchKey = null;
    for (var k in PREMIUM_PRICE_V3_) { if (name.indexOf(k) >= 0) { matchKey = k; break; } }
    if (!matchKey) continue;

    var row = i + 2;
    var desc = String(data[i][c.description] || '');
    var newName = name, newDesc = desc;
    PREMIUM_XLSX_WORDING_.forEach(function(pair) {
      newName = newName.split(pair[0]).join(pair[1]);
      newDesc = newDesc.split(pair[0]).join(pair[1]);
    });

    if (newName === name && newDesc === desc) {
      console.log('[%s] 変更なし（既に置換済み）', matchKey);
      continue;
    }

    // --- 安全確認: 値下げ自動反映が依存している表記を壊していないか ---
    var problems = [];
    if (!/^[0-9,]+円分お得/.test(newName)) problems.push('商品名の先頭「◯円分お得」が消えた');
    if (desc.indexOf('必ず') >= 0 && !/必ず[0-9,]+円\(税込み\)以上/.test(newDesc)) problems.push('「必ず◯円(税込み)以上」が壊れた');
    if (desc.indexOf('・販売価格：') >= 0 && !/・販売価格：[0-9,]+円（税込み）/.test(newDesc)) problems.push('「・販売価格：◯円（税込み）」が壊れた');
    if (problems.length) {
      console.error('[%s] 行%s は書き込みません: %s', matchKey, row, problems.join(' / '));
      continue;
    }

    // 取りこぼし検知: 1文だけ直して他が残る事故を防ぐ
    var leftover = (newName + '\n' + newDesc).match(/xlsx/gi);
    if (leftover) {
      console.warn('[%s] 行%s: 置換後もまだ xlsx が %s箇所 残っています。'
        + 'PREMIUM_XLSX_WORDING_ に追加してください。', matchKey, row, leftover.length);
      (newName + '\n' + newDesc).split('\n').forEach(function(ln) {
        if (/xlsx/i.test(ln)) console.warn('    残: %s', ln);
      });
    }

    console.log('[%s] 行%s%s', matchKey, row, dryRun ? '（下見）' : '');
    if (newName !== name) console.log('  商品名: %s\n     →   %s', name, newName);
    if (newDesc !== desc) console.log('  説明文: xlsx の記述を出品キット＋CSVの案内へ置換');

    if (!dryRun) {
      if (newName !== name) sh.getRange(row, c.name + 1).setValue(newName);
      if (newDesc !== desc) sh.getRange(row, c.description + 1).setValue(newDesc);
    }
    changed++;
  }

  if (dryRun) {
    console.log('下見のみ。%s行が対象です。実行するには runReplacePremiumXlsxWording() を呼んでください。', changed);
  } else if (changed > 0) {
    SpreadsheetApp.flush();
    bulk_clearCache_();
    console.log('%s行を更新し、アソート商品キャッシュをクリアしました。BASE/自社サイトへの反映は最大およそ10分です。', changed);
  }
  return changed;
}

/** 【手動実行】下見。シートは変更しない */
function previewReplacePremiumXlsxWording() { return replacePremiumXlsxWording(false); }

/** 【手動実行】実際に書き換える */
function runReplacePremiumXlsxWording() { return replacePremiumXlsxWording(true); }
