// ApiAdmin.gs
function apiAdminRebuildStates(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return { ok: false, message: '混雑しています。少し待ってから再試行してください' };
    try {
      const nowMs = u_nowMs_();
      const hold = od_rebuildHoldStateFromSheet_(orderSs);
      const open = od_rebuildOpenStateFromRequestSheet_(orderSs);
      hold.updatedAt = nowMs;
      open.updatedAt = nowMs;
      st_setHoldState_(orderSs, hold);
      st_setOpenState_(orderSs, open);
      st_invalidateStatusCache_(orderSs);
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminSetupAll(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    const orderSs = sh_getOrderSs_();
    sh_ensureAllOnce_(orderSs);
    sh_applyRequestStatusDropdown_(orderSs);
    tr_setupTriggersOnce_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminForceRefreshProducts(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    pr_bumpProductsVersion_();
    pr_clearProductsCache_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') };
  }
}

function apiAdminCompactHolds(adminKey) {
  try {
    ad_requireAdmin_(adminKey);
    od_compactHolds_();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

// =====================================================
// Admin.html から呼ばれるラッパー関数（adminKey 自動解決）
// =====================================================
function ad_resolveAdminKey_() {
  return String(PropertiesService.getScriptProperties().getProperty(APP_CONFIG.admin.accessKeyProp) || '');
}

function adminRebuildStates() {
  return apiAdminRebuildStates(ad_resolveAdminKey_());
}

function adminApplyStatusDropdown() {
  return apiAdminSetupAll(ad_resolveAdminKey_());
}

function adminClearProductsCache() {
  return apiAdminForceRefreshProducts(ad_resolveAdminKey_());
}

function adminCompactHolds() {
  return apiAdminCompactHolds(ad_resolveAdminKey_());
}

// =====================================================
// 会員割引管理（Admin.html 用）
// =====================================================
function adminGetMemberDiscountStatus() {
  try {
    var status = app_getMemberDiscountStatus_();
    return { ok: true, enabled: status.enabled, rate: status.rate, endDate: status.endDate, reason: status.reason };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

function adminToggleMemberDiscount() {
  try {
    var props = PropertiesService.getScriptProperties();
    var current = props.getProperty('MEMBER_DISCOUNT_ENABLED');
    var newVal = (current === 'false') ? 'true' : 'false';
    props.setProperty('MEMBER_DISCOUNT_ENABLED', newVal);
    // 商品キャッシュを無効化し、顧客ページで次回読み込み時に最新の割引設定を反映
    pr_bumpProductsVersion_();
    pr_clearProductsCache_();
    var status = app_getMemberDiscountStatus_();
    var msg = status.enabled
      ? '会員割引をONにしました（期限: ' + status.endDate + ' まで）'
      : '会員割引をOFFにしました（理由: ' + (status.reason === 'expired' ? '期限切れ' : '手動OFF') + '）';
    return { ok: true, enabled: status.enabled, rate: status.rate, endDate: status.endDate, reason: status.reason, message: msg };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

function setupAllFromEditor() {
  const orderSs = sh_getOrderSs_();
  sh_ensureAllOnce_(orderSs);
  tr_setupTriggersOnce_();
  pr_bumpProductsVersion_();
  pr_clearProductsCache_();
  return { ok: true };
}
