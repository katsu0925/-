function ad_initAdminOwnerAndKeyOnce() {
  const email = String((Session.getEffectiveUser && Session.getEffectiveUser().getEmail ? Session.getEffectiveUser().getEmail() : '') || '').trim() ||
                String((Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : '') || '').trim();
  if (!email) return { ok: false, message: 'この関数はスクリプトエディタから実行してください' };
  const props = PropertiesService.getScriptProperties();
  let owner = String(props.getProperty(APP_CONFIG.admin.ownerEmailProp) || '').trim();
  if (!owner) {
    props.setProperty(APP_CONFIG.admin.ownerEmailProp, email);
    owner = email;
  }
  if (owner !== email) return { ok: false, message: '所有者が一致しません: ' + email };
  let key = String(props.getProperty(APP_CONFIG.admin.accessKeyProp) || '').trim();
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, u_toInt_(APP_CONFIG.admin.accessKeyLen, 24));
    props.setProperty(APP_CONFIG.admin.accessKeyProp, key);
  }
  return { ok: true, ownerEmail: owner, accessKey: key };
}

function ad_requireAdmin_(adminKey) {
  const key = String(adminKey || '').trim();
  if (!key) throw new Error('権限がありません');
  const props = PropertiesService.getScriptProperties();
  const saved = String(props.getProperty(APP_CONFIG.admin.accessKeyProp) || '').trim();
  if (!saved) throw new Error('管理キーが未設定です（ad_initAdminOwnerAndKeyOnce をスクリプトエディタから実行してください）');
  if (key !== saved) throw new Error('権限がありません');
}
