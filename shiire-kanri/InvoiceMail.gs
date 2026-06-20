// InvoiceMail.gs — 請求書修正申請関連のメール通知
// 申請発生時: 管理者宛
// 対応時 (承認 / 却下 / 差戻し): スタッフ宛
//
// 配信先優先順位:
//  - 管理者宛: 請求書管理者設定 N列 "通知先メール" → 無ければ wr_sendMail_ (通知用アドレス) にフォールバック
//  - スタッフ宛: 請求書履歴 D列 "スタッフメール" を使用

function inv_mail_recipientsForAdmin_() {
  try {
    var adminRes = inv_getAdminSettings_();
    if (adminRes && adminRes.settings && adminRes.settings.通知先メール) {
      var raw = String(adminRes.settings.通知先メール);
      var list = raw.split(/[,;\s]+/).map(function(s){ return s.trim(); }).filter(Boolean);
      if (list.length > 0) return list;
    }
  } catch (e) {
    console.warn('inv_mail_recipientsForAdmin_: 設定読込失敗 ' + (e && e.message || e));
  }
  return null; // fallback to wr_sendMail_
}

function inv_sendMail_(toList, subject, bodyText) {
  if (!toList || toList.length === 0) {
    // 管理者宛フォールバック
    try { wr_sendMail_(subject, bodyText); } catch (e) {
      console.error('inv_sendMail_ fallback failed: ' + (e && e.message || e));
    }
    return;
  }
  var htmlBody = '<pre style="font-family: \'Menlo\', \'Consolas\', \'Noto Sans Mono CJK JP\', monospace; font-size: 13px; line-height: 1.5;">'
               + inv_escapeHtml_(bodyText) + '</pre>';
  var sent = 0;
  for (var i = 0; i < toList.length; i++) {
    try {
      MailApp.sendEmail({ to: toList[i], subject: subject, body: bodyText, htmlBody: htmlBody });
      sent++;
    } catch (e) {
      console.error('inv_sendMail_ error: ' + toList[i] + ': ' + (e && e.message || e));
    }
    Utilities.sleep(150);
  }
  console.log('inv_sendMail_: 送信=' + sent + '/' + toList.length + '件 subject=' + subject);
}

function inv_escapeHtml_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 修正申請発生時: 管理者宛
function inv_mail_revisionRequested_(invoice, revision) {
  var subject = '【請求書修正申請】' + (invoice.請求書番号 || '') + ' / ' + (invoice.スタッフ名 || '');
  var body =
    '請求書修正申請が届きました。\n' +
    '----------------------------------------\n' +
    '請求書番号: ' + (invoice.請求書番号 || '') + '\n' +
    '請求月:     ' + (invoice.請求月 || '') + '\n' +
    'スタッフ名: ' + (invoice.スタッフ名 || '') + '\n' +
    'スタッフメール: ' + (invoice.スタッフメール || '') + '\n' +
    '請求額:     ¥' + Number(invoice.請求額 || 0).toLocaleString('ja-JP') + '\n' +
    '----------------------------------------\n' +
    '申請ID:     ' + (revision.申請ID || '') + '\n' +
    '申請日時:   ' + (revision.申請日時 || '') + '\n' +
    '申請理由:\n' + (revision.申請理由 || '(理由なし)') + '\n' +
    '----------------------------------------\n' +
    '管理者画面から内容確認・承認/却下/差戻しを行ってください。';
  inv_sendMail_(inv_mail_recipientsForAdmin_(), subject, body);
}

// 修正申請の対応時: スタッフ宛
// action: '承認済み' | '却下' | '差戻し'
function inv_mail_revisionResponded_(invoice, revision, action, adminComment) {
  var staffEmail = invoice.スタッフメール || revision.スタッフメール || '';
  if (!staffEmail) {
    console.warn('inv_mail_revisionResponded_: スタッフメールが空 申請ID=' + (revision.申請ID || ''));
    return;
  }
  var actionLabel = action === '承認済み' ? '承認' : action;
  var subject = '【請求書修正申請 ' + actionLabel + '】' + (invoice.請求書番号 || '');
  var body =
    'ご申請いただいた請求書修正申請への対応が完了しました。\n' +
    '----------------------------------------\n' +
    '請求書番号: ' + (invoice.請求書番号 || '') + '\n' +
    '請求月:     ' + (invoice.請求月 || '') + '\n' +
    '対応結果:   ' + actionLabel + '\n' +
    '対応日時:   ' + (revision.対応日時 || '') + '\n' +
    '管理者コメント:\n' + (adminComment || '(コメントなし)') + '\n' +
    '----------------------------------------\n';
  if (action === '承認済み') {
    body += '修正後の請求書番号: ' + (revision.再請求書番号 || '(再発行待ち)') + '\n';
    body += 'スタッフアプリ「報酬確認」より最新版をご確認ください。\n';
  } else if (action === '却下') {
    body += '今回の修正申請は却下されました。\n';
    body += '再度ご不明点がある場合は管理者へ直接ご連絡ください。\n';
  } else if (action === '差戻し') {
    body += '修正申請の内容に確認事項があるため差し戻されました。\n';
    body += 'コメント内容をご確認の上、必要に応じて再申請をお願いいたします。\n';
  }
  inv_sendMail_([staffEmail], subject, body);
}

// 管理者がスタッフの手動明細(追加報酬・控除)を更新した時: スタッフ宛
// summary: { 手動明細合計, 請求額 }
function inv_mail_manualItemsEdited_(invoice, editorEmail, summary) {
  var staffEmail = (invoice && invoice.スタッフメール) || '';
  if (!staffEmail) {
    console.warn('inv_mail_manualItemsEdited_: スタッフメールが空 請求書番号=' + ((invoice && invoice.請求書番号) || ''));
    return;
  }
  summary = summary || {};
  var subject = '【請求書 追加報酬・控除を更新】' + ((invoice && invoice.請求書番号) || '');
  var items = (invoice && invoice.手動明細) || [];
  var itemLines = items.length
    ? items.map(function(it) {
        var amt = Number(it.amount || 0);
        var sign = amt >= 0 ? '+' : '−';
        return '  ・' + (it.label || '(名目なし)') + '   ' + sign + '¥' + Math.abs(amt).toLocaleString('ja-JP');
      }).join('\n')
    : '  (現在 手動明細はありません)';
  var body =
    '管理者が請求書の手動明細（追加報酬・控除）を更新しました。\n' +
    '----------------------------------------\n' +
    '請求書番号: ' + ((invoice && invoice.請求書番号) || '') + '\n' +
    '請求月:     ' + ((invoice && invoice.請求月) || '') + '\n' +
    '----------------------------------------\n' +
    '【手動明細】\n' + itemLines + '\n' +
    '手動明細 合計: ¥' + Number(summary.手動明細合計 || 0).toLocaleString('ja-JP') + '\n' +
    '更新後の請求額: ¥' + Number(summary.請求額 || (invoice && invoice.請求額) || 0).toLocaleString('ja-JP') + '\n' +
    '----------------------------------------\n' +
    'スタッフアプリ「報酬確認」より最新版の請求書をご確認ください。\n' +
    '内容にご不明点がある場合は管理者へご連絡ください。';
  inv_sendMail_([staffEmail], subject, body);
}
