/**
 * D1 ⇔ Sheets 同期（Cron Trigger: 5分ごと）
 *
 * 同期方向:
 *   商品     : Sheets → D1（一方向）
 *   顧客     : 双方向（登録/ログインはD1、ポイント付与はSheets）
 *   確保     : D1 → Sheets（参考反映）
 *   依頼中   : Sheets → D1（一方向）
 *   クーポン : Sheets → D1（一方向）
 *   設定     : Sheets → D1（一方向）
 *
 * GAS側 SyncApi.gs の apiSyncExportData を呼び出してデータ取得、
 * D1にUPSERT する。
 */

/**
 * Cron Trigger エントリポイント
 */
export async function scheduledSync(env) {
  console.log('[sync] Starting scheduled sync...');

  try {
    // 1. GASから差分データをエクスポート取得
    const exportData = await fetchExportData(env);
    if (!exportData || !exportData.ok) {
      console.error('[sync] Export failed:', exportData?.message || 'unknown');
      return;
    }

    // 2. 各テーブルにUPSERT
    if (exportData.products && exportData.products.length > 0) {
      await syncProducts(env.DB, exportData.products);
      console.log(`[sync] Products synced: ${exportData.products.length} rows`);
    }

    if (exportData.bulkProducts && exportData.bulkProducts.length > 0) {
      await syncBulkProducts(env.DB, exportData.bulkProducts);
      console.log(`[sync] Bulk products synced: ${exportData.bulkProducts.length} rows`);
    }

    if (exportData.customers && exportData.customers.length > 0) {
      await syncCustomers(env.DB, exportData.customers);
      console.log(`[sync] Customers synced: ${exportData.customers.length} rows`);
    }

    if (exportData.openItems && exportData.openItems.length > 0) {
      await syncOpenItems(env.DB, exportData.openItems);
      console.log(`[sync] Open items synced: ${exportData.openItems.length} rows`);
    }

    if (exportData.coupons && exportData.coupons.length > 0) {
      await syncCoupons(env.DB, exportData.coupons);
      console.log(`[sync] Coupons synced: ${exportData.coupons.length} rows`);
    }

    if (exportData.settings) {
      await syncSettings(env.DB, exportData.settings);
      console.log('[sync] Settings synced');
    }

    if (exportData.stats) {
      await syncStats(env.DB, exportData.stats);
      console.log('[sync] Stats synced');
    }

    // 3. 同期メタデータ更新
    await updateSyncMeta(env.DB, exportData);

    // 4. KVキャッシュをプリウォーム（D1→KVに最新データ書き込み）
    await prewarmCaches(env);

    // 5. D1 → Sheets 方向の同期（顧客の新規登録等）
    if (exportData.needsImport) {
      await pushImportData(env);
    }

    console.log('[sync] Sync completed successfully');
  } catch (e) {
    console.error('[sync] Sync error:', e.message, e.stack);
  }
}

// ─── GAS API通信 ───

async function fetchExportData(env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) {
    console.error('[sync] GAS_API_URL not configured');
    return null;
  }

  // 最終同期時刻を取得
  const lastSync = await getLastSyncTime(env.DB);

  const body = JSON.stringify({
    action: 'apiSyncExportData',
    args: [{
      syncSecret: env.SYNC_SECRET || '',
      since: lastSync,
      tables: ['products', 'bulkProducts', 'customers', 'openItems', 'coupons', 'settings', 'stats'],
    }],
  });

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'follow',
  });

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[sync] Failed to parse GAS response:', text.substring(0, 200));
    return null;
  }
}

async function pushImportData(env) {
  const gasUrl = env.GAS_API_URL;
  if (!gasUrl) return;

  // D1から新規/更新された顧客を取得
  const lastImport = await getLastImportTime(env.DB);
  const { results: newCustomers } = await env.DB.prepare(`
    SELECT * FROM customers
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    LIMIT 100
  `).bind(lastImport).all();

  if (newCustomers.length === 0) return;

  const body = JSON.stringify({
    action: 'apiSyncImportData',
    args: [{
      syncSecret: env.SYNC_SECRET || '',
      customers: newCustomers.map(c => ({
        id: c.id,
        email: c.email,
        passwordHash: c.password_hash,
        companyName: c.company_name,
        phone: c.phone,
        postal: c.postal,
        address: c.address,
        newsletter: c.newsletter,
        createdAt: c.created_at,
        lastLogin: c.last_login,
        points: c.points,
        pointsUpdatedAt: c.points_updated_at,
        purchaseCount: c.purchase_count,
      })),
    }],
  });

  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'follow',
  });

  const text = await resp.text();
  try {
    const result = JSON.parse(text);
    if (result.ok) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
         VALUES ('import_customers', ?, ?, '')`
      ).bind(new Date().toISOString(), newCustomers.length).run();
    }
  } catch (e) {
    console.error('[sync] Import push failed:', e.message);
  }
}

// ─── D1 UPSERT ───

async function syncProducts(db, rows) {
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const stmts = batch.map(p =>
      db.prepare(`
        INSERT OR REPLACE INTO products
          (managed_id, no_label, image_url, state, brand, size, gender, category,
           color, price, qty, defect_detail, shipping_method,
           measure_length, measure_shoulder, measure_bust, measure_sleeve,
           measure_yuki, measure_total_length, measure_waist, measure_rise,
           measure_inseam, measure_thigh, measure_hem_width, measure_hip,
           updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        p.managedId, p.noLabel || '', p.imageUrl || '', p.state || '',
        p.brand || '', p.size || '', p.gender || '', p.category || '',
        p.color || '', p.price || 0, p.qty || 0,
        p.defectDetail || '', p.shippingMethod || '',
        p.measureLength ?? null, p.measureShoulder ?? null,
        p.measureBust ?? null, p.measureSleeve ?? null,
        p.measureYuki ?? null, p.measureTotalLength ?? null,
        p.measureWaist ?? null, p.measureRise ?? null,
        p.measureInseam ?? null, p.measureThigh ?? null,
        p.measureHemWidth ?? null, p.measureHip ?? null,
        new Date().toISOString()
      )
    );
    await db.batch(stmts);
  }
}

async function syncBulkProducts(db, rows) {
  const stmts = rows.map(p =>
    db.prepare(`
      INSERT OR REPLACE INTO bulk_products
        (product_id, name, description, price, unit, tag, images,
         min_qty, max_qty, sort_order, stock, sold_out,
         discount_rate, discounted_price, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      p.productId, p.name || '', p.description || '', p.price || 0,
      p.unit || '', p.tag || '', JSON.stringify(p.images || []),
      p.minQty || 1, p.maxQty || 99, p.sortOrder || 999,
      p.stock ?? -1, p.soldOut ? 1 : 0,
      p.discountRate || 0, p.discountedPrice || 0,
      p.soldOut ? 0 : 1, new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncCustomers(db, rows) {
  // Sheets → D1 方向: ポイント・購入回数などSheetsが信頼元のフィールドのみ更新
  const stmts = rows.map(c =>
    db.prepare(`
      INSERT INTO customers
        (id, email, password_hash, company_name, phone, postal, address,
         newsletter, created_at, last_login, points, points_updated_at,
         purchase_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (email) DO UPDATE SET
        points = CASE WHEN excluded.points != customers.points THEN excluded.points ELSE customers.points END,
        points_updated_at = CASE WHEN excluded.points != customers.points THEN excluded.points_updated_at ELSE customers.points_updated_at END,
        purchase_count = CASE WHEN excluded.purchase_count > customers.purchase_count THEN excluded.purchase_count ELSE customers.purchase_count END,
        updated_at = excluded.updated_at
    `).bind(
      c.id, c.email, c.passwordHash || '', c.companyName || '',
      c.phone || '', c.postal || '', c.address || '',
      c.newsletter ? 1 : 0, c.createdAt || new Date().toISOString(),
      c.lastLogin || '', c.points || 0,
      c.pointsUpdatedAt || '', c.purchaseCount || 0,
      new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncOpenItems(db, rows) {
  // まず全削除してから挿入（依頼中リストは完全上書き）
  const stmts = [
    db.prepare('DELETE FROM open_items'),
    ...rows.map(o =>
      db.prepare(`
        INSERT INTO open_items (managed_id, receipt_no, status, updated_at)
        VALUES (?, ?, ?, ?)
      `).bind(o.managedId, o.receiptNo || '', o.status || '依頼中', new Date().toISOString())
    ),
  ];

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncCoupons(db, rows) {
  const stmts = rows.map(c =>
    db.prepare(`
      INSERT OR REPLACE INTO coupons
        (code, type, value, expires_at, max_uses, use_count, once_per_user,
         active, memo, target, start_date, combo_member, combo_bulk, channel,
         target_products, shipping_exclude_products, target_customer_name,
         target_customer_email, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      c.code, c.type, c.value || 0, c.expiresAt || null,
      c.maxUses || 0, c.useCount || 0, c.oncePerUser ? 1 : 0,
      c.active ? 1 : 0, c.memo || '', c.target || 'all',
      c.startDate || null, c.comboMember ? 1 : 0, c.comboBulk ? 1 : 0,
      c.channel || 'all', c.targetProducts || '',
      c.shippingExcludeProducts || '', c.targetCustomerName || '',
      c.targetCustomerEmail || '', new Date().toISOString()
    )
  );

  const batchSize = 50;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.batch(stmts.slice(i, i + batchSize));
  }
}

async function syncSettings(db, settings) {
  const now = new Date().toISOString();
  const stmts = Object.entries(settings).map(([key, value]) =>
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).bind(key, typeof value === 'string' ? value : JSON.stringify(value), now)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

async function syncStats(db, stats) {
  await db.prepare(`
    INSERT OR REPLACE INTO stats_cache (key, data, updated_at)
    VALUES ('banner', ?, ?)
  `).bind(JSON.stringify(stats), new Date().toISOString()).run();
}

// ─── メタデータ・キャッシュ ───

async function getLastSyncTime(db) {
  const row = await db.prepare(
    "SELECT last_sync_at FROM sync_meta WHERE source = 'export' ORDER BY last_sync_at DESC LIMIT 1"
  ).first();
  return row ? row.last_sync_at : '2000-01-01T00:00:00Z';
}

async function getLastImportTime(db) {
  const row = await db.prepare(
    "SELECT last_sync_at FROM sync_meta WHERE source = 'import_customers'"
  ).first();
  return row ? row.last_sync_at : '2000-01-01T00:00:00Z';
}

async function updateSyncMeta(db, exportData) {
  const now = new Date().toISOString();
  const totalRows = (exportData.products?.length || 0) +
    (exportData.customers?.length || 0) +
    (exportData.coupons?.length || 0);

  await db.prepare(`
    INSERT OR REPLACE INTO sync_meta (source, last_sync_at, row_count, checksum)
    VALUES ('export', ?, ?, '')
  `).bind(now, totalRows).run();
}

/**
 * KVキャッシュをプリウォーム
 * 同期後にD1から最新データを読み取り、KVに書き込む。
 * ユーザーリクエスト時は常にKV HITになり、初回アクセスも高速。
 */
async function prewarmCaches(env) {
  const CACHE_TTL = 600; // 10分（Cronは5分間隔なので余裕を持たせる）

  try {
    // 商品データをプリウォーム
    const { results: products } = await env.DB.prepare(`
      SELECT managed_id, no_label, image_url, state, brand, size,
             gender, category, color, price, qty, defect_detail, shipping_method
      FROM products ORDER BY no_label ASC
    `).all();

    const items = products.map(row => ({
      managedId: row.managed_id, noLabel: row.no_label, imageUrl: row.image_url,
      state: row.state, brand: row.brand, size: row.size, gender: row.gender,
      category: row.category, color: row.color, price: row.price,
      defectDetail: row.defect_detail, shippingMethod: row.shipping_method,
      status: '在庫あり', selectable: true,
    }));

    // holds + open_items からステータスを算出
    const now = Date.now();
    const { results: holds } = await env.DB.prepare('SELECT managed_id FROM holds WHERE until_ms > ?').bind(now).all();
    const heldSet = new Set(holds.map(h => h.managed_id));
    const { results: openItems } = await env.DB.prepare('SELECT managed_id FROM open_items').all();
    const openSet = new Set(openItems.map(o => o.managed_id));
    for (const p of items) {
      if (openSet.has(p.managedId)) { p.status = '依頼中'; p.selectable = false; }
      else if (heldSet.has(p.managedId)) { p.status = '確保中'; p.selectable = false; }
    }

    // フィルタオプション構築
    const sets = { category: new Set(), state: new Set(), gender: new Set(), size: new Set() };
    for (const p of items) {
      if (p.category) sets.category.add(p.category);
      if (p.state) sets.state.add(p.state);
      if (p.gender) sets.gender.add(p.gender);
      if (p.size) sets.size.add(p.size);
    }
    const sortArr = (s) => [...s].sort((a, b) => a.localeCompare(b, 'ja'));
    const options = {
      status: ['在庫あり', '依頼中', '確保中'],
      category: sortArr(sets.category), state: sortArr(sets.state),
      gender: sortArr(sets.gender), size: sortArr(sets.size),
      sort: [
        { key: 'default', label: 'No（番号順）' }, { key: 'price', label: '価格' },
        { key: 'brand', label: 'ブランド' }, { key: 'size', label: 'サイズ' },
      ],
    };

    // 設定データ
    const memberRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'MEMBER_DISCOUNT_STATUS'").first();
    let memberDiscount = { enabled: true, rate: 0.10, endDate: '2026-09-30', reason: 'active' };
    if (memberRow) { try { memberDiscount = JSON.parse(memberRow.value); } catch (e) { /* fallthrough */ } }

    const settings = {
      appTitle: 'デタウリ.Detauri', minOrderCount: 5, memberDiscount,
      notes: [
        '<a href="https://drive.google.com/file/d/18X6qgQPWkaOXTg4YxELtru-4oBJxn7mn/view?usp=sharing" target="_blank" rel="noopener noreferrer">商品ページガイド</a>',
        '5点から購入可能です。合計金額は商品代のみ <a href="https://drive.google.com/file/d/1g7UYUBw3-Y6M5HkSv3mfMe5jEjs795E3/view?usp=sharing" target="_blank" rel="noopener noreferrer">（送料別）</a>。送料は住所入力後に自動計算されます。',
        'カートに入れた商品は15分間確保されます（会員は30分間）。在庫は先着順のためお早めにお手続きください。',
        '決済方法：クレジットカード／コンビニ払い／銀行振込／PayPay／ペイジー／Apple Pay／Paidy',
      ],
    };
    const discountNote = memberDiscount.enabled
      ? '<span style="color:#b8002a;">10点以上で5％割引〜最大20％OFF ／ 会員登録で10％OFF（' + memberDiscount.endDate + 'まで・併用可）</span>'
      : '<span style="color:#b8002a;">30点以上で10％割引</span>';
    settings.notes.push(discountNote);

    // 統計データ
    const statsRow = await env.DB.prepare("SELECT data FROM stats_cache WHERE key = 'banner'").first();
    const stats = statsRow ? JSON.parse(statsRow.data) : null;

    // KVに書き込み（GAS互換形式: products キーで保存）
    const productData = { products: items, totalCount: items.length, options, settings, stats };
    await env.CACHE.put('products:detauri', JSON.stringify(productData), { expirationTtl: CACHE_TTL });
    await env.CACHE.put('settings:public', JSON.stringify(settings), { expirationTtl: CACHE_TTL });
    if (stats) await env.CACHE.put('stats:banner', JSON.stringify(stats), { expirationTtl: CACHE_TTL });

    // Bulk商品をプリウォーム
    const { results: bulkRows } = await env.DB.prepare(`
      SELECT product_id, name, description, price, unit, tag, images,
             min_qty, max_qty, sort_order, stock, sold_out, discount_rate, discounted_price
      FROM bulk_products WHERE active = 1 ORDER BY sort_order ASC
    `).all();

    const bulkProducts = bulkRows.map(row => ({
      productId: row.product_id, name: row.name, description: row.description,
      price: row.price, unit: row.unit, tag: row.tag,
      images: JSON.parse(row.images || '[]'), minQty: row.min_qty, maxQty: row.max_qty,
      sortOrder: row.sort_order, stock: row.stock, soldOut: row.sold_out === 1,
      discountRate: row.discount_rate, discountedPrice: row.discounted_price,
    }));

    const shippingRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'SHIPPING_CONFIG'").first();
    const shippingData = shippingRow ? JSON.parse(shippingRow.value) : null;
    const siteUrlRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'SITE_URL'").first();

    const bulkResult = {
      products: bulkProducts,
      settings: {
        appTitle: 'デタウリ.Detauri', channel: 'アソート',
        shippingAreas: shippingData?.areas || null, shippingRates: shippingData?.rates || null,
        memberDiscount, detauriUrl: siteUrlRow?.value || '',
      },
      stats,
    };
    await env.CACHE.put('products:bulk', JSON.stringify(bulkResult), { expirationTtl: CACHE_TTL });

    console.log(`[sync] KV prewarm complete: ${items.length} products, ${bulkProducts.length} bulk`);
  } catch (e) {
    console.error('[sync] Prewarm error:', e.message);
    // プリウォーム失敗時はキャッシュを削除（次のリクエストでD1から再構築）
    const keys = ['products:detauri', 'products:bulk', 'settings:public', 'stats:banner'];
    for (const key of keys) { await env.CACHE.delete(key); }
  }
}
