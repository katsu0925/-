/**
 * 決済処理中ロックのスイープ（Cron 5分ごと）
 *
 * submitEstimate は決済ページへ送り出す前に holds.pending_payment=1 と open_items を立てる。
 * 決済ページから離脱（ブラウザバック・タブを閉じる）されるとこのロックだけが残り、
 * 誰も買えない商品になる（2026-08-24 事故）。
 *
 * 対策として初期ロックは30分に短縮し、期限が切れたものをここで後始末する。
 * ただし機械的に解放するとコンビニ・銀行振込（着金まで日をまたぐ）を巻き添えにするため、
 * 必ず KOMOJU に実際の決済状況を問い合わせてから判断する。
 *
 *   - captured / authorized（決済済み）→ 3日へ延長（解放しない）
 *   - pending（コンビニ・銀行振込の受付済み）→ 3日へ延長（解放しない）
 *   - expired / cancelled / failed / 決済未着手 → 解放
 *   - 照会できない → 今回は見送り（次tickで再試行。7日超えたら強制解放）
 */

const MAX_RECEIPTS_PER_RUN = 20;      // 1回のCronで処理する注文数の上限（KOMOJU API呼び出し抑制）
const DEFERRED_EXTEND_MS = 3 * 24 * 60 * 60 * 1000; // 3日
const FORCE_RELEASE_MS = 7 * 24 * 60 * 60 * 1000;   // 照会不能のまま7日 → 強制解放

export async function sweepExpiredPendingPayments(env) {
  try {
    const now = Date.now();

    const { results } = await env.DB.prepare(
      `SELECT receipt_no, COUNT(*) AS cnt, MIN(until_ms) AS until_ms
         FROM holds
        WHERE pending_payment = 1 AND until_ms <= ? AND receipt_no != ''
        GROUP BY receipt_no
        ORDER BY until_ms ASC
        LIMIT ?`
    ).bind(now, MAX_RECEIPTS_PER_RUN).all();

    if (!results || results.length === 0) return;

    if (results.length === MAX_RECEIPTS_PER_RUN) {
      console.warn(`[pending-sweep] 上限${MAX_RECEIPTS_PER_RUN}件に到達。残りは次回tickで処理します`);
    }

    for (const row of results) {
      const token = row.receipt_no;
      const session = await fetchKomojuSession(env, token);

      if (session === undefined) {
        // 照会失敗（ネットワーク/APIエラー）→ 判断できないので触らない
        if (now - row.until_ms > FORCE_RELEASE_MS) {
          console.warn(`[pending-sweep] 照会不能のまま7日超過 → 強制解放: token=${token}`);
          await releasePending(env, token, row.cnt);
        }
        continue;
      }

      const paymentStatus = (session && session.payment && session.payment.status) || '';

      if (['captured', 'authorized', 'pending'].includes(paymentStatus)) {
        await env.DB.prepare(
          `UPDATE holds SET until_ms = ? WHERE receipt_no = ? AND pending_payment = 1`
        ).bind(now + DEFERRED_EXTEND_MS, token).run();
        console.log(`[pending-sweep] 決済進行中(${paymentStatus}) → 3日延長: token=${token}, items=${row.cnt}`);
        continue;
      }

      await releasePending(env, token, row.cnt, paymentStatus);
    }
  } catch (e) {
    console.error('[pending-sweep] error:', e.message, e.stack);
  }
}

/**
 * 確保と依頼中ロックを解放する。
 * open_items を消さないと商品は「依頼中（選択不可）」のまま残るので必ず両方消す。
 */
async function releasePending(env, token, itemCount, paymentStatus = '') {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM holds WHERE receipt_no = ? AND pending_payment = 1').bind(token),
    env.DB.prepare('DELETE FROM open_items WHERE receipt_no = ?').bind(token),
  ]);
  console.log(`[pending-sweep] 未決済のため解放: token=${token}, items=${itemCount}, komoju=${paymentStatus || 'none'}`);
}

/**
 * KOMOJUのセッションを取得
 * @returns {Promise<object|null|undefined>} セッション / 見つからない場合 null / 照会失敗は undefined
 */
async function fetchKomojuSession(env, token) {
  const komojuKey = env.KOMOJU_SECRET_KEY;
  if (!komojuKey) return undefined;
  try {
    const resp = await fetch(
      'https://komoju.com/api/v1/sessions?external_order_num=' + encodeURIComponent(token),
      {
        headers: {
          'Authorization': 'Basic ' + btoa(komojuKey + ':'),
          'Accept': 'application/json',
        },
      }
    );
    if (!resp.ok) {
      console.error(`[pending-sweep] KOMOJU照会失敗 HTTP ${resp.status}: token=${token}`);
      return undefined;
    }
    const data = await resp.json();
    if (data && Array.isArray(data.resource_data) && data.resource_data.length > 0) {
      return data.resource_data[0];
    }
    return null; // セッションが存在しない → 未決済として解放してよい
  } catch (e) {
    console.error('[pending-sweep] KOMOJU照会エラー:', e.message);
    return undefined;
  }
}
