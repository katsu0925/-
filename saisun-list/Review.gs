// Review.gs
// =====================================================
// レビュー・評価システム (Phase 4-1)
// 商品レビュー投稿・表示
// =====================================================

/**
 * レビューシートを取得（なければ作成）
 */
function getReviewSheet_() {
  var ss = sh_getOrderSs_();
  var sheet = ss.getSheetByName('レビュー');
  if (!sheet) {
    sheet = ss.insertSheet('レビュー');
    sheet.appendRow(['レビューID', '商品管理番号', '顧客ID', '顧客名', '評価', 'コメント', '投稿日時', '承認ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setBackground('#1565c0').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

/**
 * レビュー投稿API（会員のみ、購入済み商品のみ）
 * @param {string} userKey
 * @param {object} params - { sessionId, managedId, rating, comment }
 * @return {object}
 */
function apiSubmitReview(userKey, params) {
  try {
    var sessionId = String(params.sessionId || '').trim();
    var managedId = String(params.managedId || '').trim();
    var rating = Number(params.rating || 0);
    var comment = String(params.comment || '').trim();

    if (!sessionId) return { ok: false, message: 'ログインが必要です' };
    if (!managedId) return { ok: false, message: '商品が指定されていません' };
    if (rating < 1 || rating > 5) return { ok: false, message: '評価は1〜5で入力してください' };
    if (!comment || comment.length < 10) return { ok: false, message: 'コメントは10文字以上で入力してください' };
    if (comment.length > 500) return { ok: false, message: 'コメントは500文字以内で入力してください' };

    var customer = findCustomerBySession_(sessionId);
    if (!customer) return { ok: false, message: 'セッションが無効です。再ログインしてください' };

    // 購入済みチェック: 依頼管理シートで「完了」の注文に含まれる商品か
    if (!hasPurchasedProduct_(customer.email, managedId)) {
      return { ok: false, message: 'この商品を購入された方のみレビューを投稿できます' };
    }

    // 重複レビューチェック
    if (hasExistingReview_(customer.id, managedId)) {
      return { ok: false, message: 'この商品には既にレビューを投稿済みです' };
    }

    // レビュー登録
    var reviewId = 'RV' + Date.now().toString(36).toUpperCase();
    var sheet = getReviewSheet_();
    sheet.appendRow([
      reviewId,
      managedId,
      customer.id,
      customer.companyName,
      rating,
      comment,
      new Date(),
      '承認待ち'
    ]);

    return { ok: true, message: 'レビューを投稿しました。承認後に公開されます。', data: { reviewId: reviewId } };
  } catch (e) {
    console.error('apiSubmitReview error:', e);
    return { ok: false, message: 'レビュー投稿に失敗しました' };
  }
}

/**
 * レビュー取得API
 * @param {string} userKey
 * @param {object} params - { managedId } or { all: true }
 * @return {object}
 */
function apiGetReviews(userKey, params) {
  try {
    var managedId = String(params.managedId || '').trim();
    var sheet = getReviewSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, data: { reviews: [], average: 0, count: 0 } };

    var data = sheet.getDataRange().getValues();
    var reviews = [];
    var totalRating = 0;

    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][7] || '');
      if (status !== '承認済み') continue; // 承認済みのみ

      if (managedId && String(data[i][1] || '') !== managedId) continue;

      var r = {
        reviewId: String(data[i][0] || ''),
        managedId: String(data[i][1] || ''),
        customerName: String(data[i][3] || ''),
        rating: Number(data[i][4]) || 0,
        comment: String(data[i][5] || ''),
        date: data[i][6] ? Utilities.formatDate(new Date(data[i][6]), 'Asia/Tokyo', 'yyyy/MM/dd') : ''
      };
      reviews.push(r);
      totalRating += r.rating;
    }

    var average = reviews.length > 0 ? Math.round((totalRating / reviews.length) * 10) / 10 : 0;

    return {
      ok: true,
      data: {
        reviews: reviews,
        average: average,
        count: reviews.length
      }
    };
  } catch (e) {
    console.error('apiGetReviews error:', e);
    return { ok: false, message: 'レビューの取得に失敗しました' };
  }
}

/**
 * レビュー承認API（管理者のみ）
 * @param {string} adminKey
 * @param {object} params - { reviewId, action: 'approve'|'reject' }
 * @return {object}
 */
function adminApproveReview(adminKey, params) {
  try {
    ad_requireAdmin_(adminKey);

    var reviewId = String(params.reviewId || '').trim();
    var action = String(params.action || '').trim();
    if (!reviewId) return { ok: false, message: 'レビューIDが指定されていません' };
    if (action !== 'approve' && action !== 'reject') {
      return { ok: false, message: 'action は approve または reject を指定してください' };
    }

    var sheet = getReviewSheet_();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '') === reviewId) {
        var newStatus = action === 'approve' ? '承認済み' : '却下';
        sheet.getRange(i + 1, 8).setValue(newStatus);
        return { ok: true, message: 'レビューを' + newStatus + 'にしました' };
      }
    }

    return { ok: false, message: 'レビューが見つかりません' };
  } catch (e) {
    console.error('adminApproveReview error:', e);
    return { ok: false, message: String(e.message || e) };
  }
}

/**
 * 購入済みチェック
 */
function hasPurchasedProduct_(email, managedId) {
  var ss = sh_getOrderSs_();
  var reqSheet = ss.getSheetByName('依頼管理');
  if (!reqSheet) return false;

  var data = reqSheet.getDataRange().getValues();
  var normalizedEmail = String(email).trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][REQUEST_SHEET_COLS.CONTACT - 1] || '').trim().toLowerCase();
    var status = String(data[i][REQUEST_SHEET_COLS.STATUS - 1] || '');
    if (rowEmail !== normalizedEmail || status !== '完了') continue;

    // 選択リスト（J列）またh商品名（H列）に管理番号が含まれるかチェック
    var selectionList = String(data[i][REQUEST_SHEET_COLS.SELECTION_LIST - 1] || '');
    var productNames = String(data[i][REQUEST_SHEET_COLS.PRODUCT_NAMES - 1] || '');
    if (selectionList.indexOf(managedId) !== -1 || productNames.indexOf(managedId) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * 重複レビューチェック
 */
function hasExistingReview_(customerId, managedId) {
  var sheet = getReviewSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1] || '') === managedId && String(data[i][2] || '') === customerId) {
      return true;
    }
  }
  return false;
}
