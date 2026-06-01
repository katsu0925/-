385:const STATUS_OPTIONS = ['採寸待ち','撮影待ち','出品待ち','出品作業中','出品中','売却済み','発送済み','完了','キャンセル','返品','廃棄'];
666:    ['完了日','date'],
841://                              UI 楽観反映を維持（=外注は「保存完了」と認識して次へ進める）
1738:// type: 'details' (saveDetails) | 'image' (画像) | 'keihi-image' (経費レシート)
1997:    url = '/api/save/details';
2001:    url = '/api/save/image';
2005:    // 経費レシート画像の再送。fetch 成功すれば Drive にアップロード済み（=保管庫登録完了）。
2149:  // silent:true でローディング画面に置き換えず、フェッチ完了まで現状維持 → スクロール位置キープ
2630:  fetch('/api/save/details', {
2646:    if (status) { status.textContent = '✓ 削除完了'; status.className = 'img-status success'; }
2718:  // ② リサイズ → IndexedDB outbox に積む → ここで「✓ 保存完了」表示（楽観的完了）
2730:    // outbox に確実に積まれた → ユーザーには即座に「保存完了」を案内
2732:    if (sOk) { sOk.textContent = '✓ 保存完了'; sOk.className = 'img-status success'; }
2737:    fetchWithTimeout_('/api/save/image', {
2765:      // 静かに outbox 再送に委ねる（「✓ 保存完了」はそのまま）
3008:  // 発送済み（hassou タブ）: 完了日が空ならワンタップ完了ボタン、入力済みなら日付バッジ
3009:  var kanryouHtml = '';
3011:    var kanryouVal = (it.extra && it.extra['完了日']) ? String(it.extra['完了日']).trim() : '';
3013:    if (kanryouVal) {
3014:      kanryouHtml =
3015:        '<div class="card-kanryou done">' +
3016:          '<span class="card-kanryou-ico">✓</span>' +
3017:          '<span class="card-kanryou-date">完了 ' + esc(fmtReadonlyDate_(kanryouVal)) + '</span>' +
3020:      kanryouHtml =
3021:        '<div class="card-kanryou">' +
3022:          '<button type="button" class="btn-kanryou" data-kanri="' + esc(it.kanri) + '" ' +
3023:            'onclick="event.stopPropagation();onCardKanryouClick_(this,\'' + kanriAttr + '\')">完了 ✓</button>' +
3042:    kanryouHtml +
3049:// 工程進捗ピル（📏 採寸 / 📷 撮影 / 🛍️ 出品）。派生ステータスから完了状況を逆算。
3054:  // 採寸: 採寸待ち以外なら採寸完了
3055:  // 撮影: 採寸待ち / 撮影待ち 以外なら撮影完了
3056:  // 出品: 出品中 以降が出品完了
3071:// 発送済みカードの「完了 ✓」ボタン: 二段階タップ（3秒以内に2回タップで完了日=本日をセット）
3072:// 1回目: armed クラス + トースト案内 / 2回目: API POST → 楽観的に extra['完了日'] 反映 → 再描画
3079:    btn.textContent = 'もう一度タップで完了';
3080:    toast('もう一度タップで完了日をセット（3秒以内）', 'info');
3083:      var b = document.querySelector('.btn-kanryou[data-kanri="' + k.replace(/"/g, '\\"') + '"]');
3084:      if (b) { b.classList.remove('armed'); b.textContent = '完了 ✓'; }
3092:  // 完了日 = 本日（YYYY/MM/DD: GAS シート互換、Asia/Tokyo）
3097:  var fields = { '完了日': ymd };
3098:  fetch(API_BASE + '/api/save/details', {
3104:    // 楽観反映: STATE.items の該当 kanri に 完了日 を入れて再描画
3105:    // 完了日が入ると GAS の IFS 式（StaffApi.gs:65 「完了日 notBlank → 売却済み」）で
3108:    // （従来は 完了日 だけ更新し status を据え置いていたため、タブを切り替えるまで残っていた）
3113:          STATE.items[i].extra['完了日'] = ymd;
3120:    toast('完了しました（発送済みから除外）', 'success');
3126:    btn.textContent = '完了 ✓';
5005:// 経費レシート画像のアップロード（楽観的完了 + outbox 再送セーフティネット）
5008://   2. リサイズ → IndexedDB outbox に積む → ここで「✓ 保存完了」表示
5026:  // ② リサイズ → outbox 投入 → 「✓ 保存完了」表示
5033:    if (sOk) { sOk.textContent = '✓ 保存完了'; sOk.className = 'img-status success'; }
6028:  // 初回はフォームを描かず、明確なスピナーだけ出してから API 完了後に差し替える。
6918:  // detail フォームでの dirty フラグを立てる（saveDetails が再描画でユーザー入力を上書きしない為）
7117:  // 描画完了後にスクロール位置を戻す（rAF で 1フレーム待つ）
7203:      await saveDetails();
7270:  add(ex['完了日'], '', '完了');
7827:      '<button class="btn-save" type="button" id="btn-save-details" onclick="saveDetails()">保存</button>' +
7912:  // （楽観的更新で dirty が 0 になるが、API 完了までユーザーに状態を見せたい）
8091:async function saveDetails() {
8134:  // 楽観的更新: ローカル extra を即時反映 → 一覧キャッシュも更新（トーストは API 完了後に出す）
8140:  // 保存中フラグを立てて savebar を「保存中…」表示で固定（API 完了まで隠さない）
8160:  fetch(API_BASE + '/api/save/details', {
8277:  // 取得完了時点でテキストを返し、ユーザーには「タップしてコピー」を促す Toast にする選択肢もあるが、
8789:// 仕入れ完了判定（登録済み数 >= 予定数 で完了とみなす）
8815:  // shiireId 未指定 → 仕入れリストから選ばせる（完了済は除外）
8821:      // 未完了（registered < planned）の仕入れは60日超でもプルダウンに残す。
8822:      // planned 不明（0以下）で完了判定できない古い仕入れだけ stale 除外する。
8829:      if (!items.length) { cancelCreateProduct_(); toast('登録可能な仕入れがありません（すべて完了済）', 'error'); return; }
10052:    if (document.readyState === 'complete') tryGo();
