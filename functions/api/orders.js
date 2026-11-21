const DB_BINDING = "blackline-wear-orders";
const MAX_ITEMS = 20;
const MAX_QTY_PER_ITEM = 20;


function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];
    if (!db) return json({ error: "Database binding not found" }, 500);

    const data = await request.json();
    const name = String(data.name || "").trim();
    const phone = String(data.phone || "").trim();
    const address = String(data.address || "").trim();

    if (!name || !phone || !address) return json({ error: "من فضلك أكمل بيانات العميل" }, 400);
    if (name.length > 100 || phone.length > 30 || address.length > 500) {
      return json({ error: "بعض البيانات أطول من المسموح" }, 400);
    }
    if (!Array.isArray(data.items) || !data.items.length) return json({ error: "السلة فارغة" }, 400);
    if (data.items.length > MAX_ITEMS) return json({ error: "عدد المنتجات أكبر من المسموح" }, 400);

    // Read catalog from D1, never trust browser-sent prices or product names.
    const requestedIds = [...new Set(data.items.map(item => Number(item.id)).filter(id => Number.isInteger(id) && id > 0))];
    if (!requestedIds.length) return json({ error: "المنتجات المطلوبة غير صحيحة" }, 400);
    const placeholders = requestedIds.map(() => "?").join(",");
    const productRows = await db.prepare(`
      SELECT id, name, price, sizes, colors, is_active
      FROM products
      WHERE id IN (${placeholders})
    `).bind(...requestedIds).all();
    const catalog = new Map((productRows.results || []).map(p => [Number(p.id), p]));

    const items = [];
    const quantities = new Map();
    for (const requested of data.items) {
      const id = Number(requested.id);
      const qty = Number(requested.qty);
      const size = String(requested.size || "").trim();
      const color = String(requested.color || "").trim();
      const product = catalog.get(id);
      const sizes = parseArray(product?.sizes);
      const colors = parseArray(product?.colors);

      if (!product || Number(product.is_active) !== 1) return json({ error: "أحد المنتجات غير متاح حاليًا" }, 400);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) return json({ error: "الكمية المطلوبة غير صحيحة" }, 400);
      if (!sizes.includes(size) || !colors.includes(color)) return json({ error: "تأكد من اختيار مقاس ولون متاحين للمنتج" }, 400);

      const key = `${id}-${size}-${color}`;
      const totalQty = (quantities.get(key) || 0) + qty;
      if (totalQty > MAX_QTY_PER_ITEM) return json({ error: "الكمية المطلوبة أكبر من المسموح" }, 400);
      quantities.set(key, totalQty);
      const price = Number(product.price);
      if (!Number.isFinite(price) || price <= 0) return json({ error: "سعر أحد المنتجات غير صالح" }, 400);
      items.push({ id, name: product.name, price, qty, size, color });
    }

    // Attribution code lookup remains database-controlled.
    const affiliateCode = String(data.affiliateCode || data.affiliate_code || "").trim().toUpperCase();
    let affiliate = null;
    if (affiliateCode) {
      affiliate = await db.prepare(`
        SELECT id, commission_rate FROM affiliate_accounts
        WHERE affiliate_code = ? AND is_active = 1 LIMIT 1
      `).bind(affiliateCode).first();
    }

    const purchaseId = crypto.randomUUID();
    const statements = [
      db.prepare(`
        INSERT INTO customers (name, phone, address)
        VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address
      `).bind(name, phone, address),
      ...items.map(item => db.prepare(`
        INSERT INTO orders (customer_name, phone, address, product_name, size, color, quantity, price, total, status, purchase_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).bind(name, phone, address, item.name, item.size, item.color, item.qty, item.price, item.price * item.qty, purchaseId)),
      db.prepare(`
        UPDATE assignment_settings SET last_employee_id = COALESCE(
          (SELECT MIN(id) FROM employees WHERE is_active = 1 AND id > COALESCE(assignment_settings.last_employee_id, 0)),
          (SELECT MIN(id) FROM employees WHERE is_active = 1)
        ) WHERE id = 1 AND EXISTS (SELECT 1 FROM employees WHERE is_active = 1)
      `),
      db.prepare(`
        INSERT INTO order_assignments (order_id, employee_id)
        SELECT orders.id, assignment_settings.last_employee_id
        FROM orders CROSS JOIN assignment_settings
        WHERE orders.purchase_id = ? AND assignment_settings.id = 1
          AND assignment_settings.last_employee_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM employees WHERE employees.id = assignment_settings.last_employee_id AND employees.is_active = 1)
      `).bind(purchaseId)
    ];


    if (affiliate) {
      statements.push(db.prepare(`
        INSERT INTO affiliate_orders (order_id, affiliate_id, commission_rate, order_total, commission_amount, commission_status)
        SELECT id, ?, ?, total, ROUND(total * ? / 100, 2), 'pending'
        FROM orders WHERE purchase_id = ?
      `).bind(affiliate.id, affiliate.commission_rate, affiliate.commission_rate, purchaseId));
    }


    const results = await db.batch(statements);
    const assignment = await db.prepare(`
      SELECT employees.id, employees.full_name
      FROM order_assignments JOIN employees ON employees.id = order_assignments.employee_id
      JOIN orders ON orders.id = order_assignments.order_id
      WHERE orders.purchase_id = ? LIMIT 1
    `).bind(purchaseId).first();


    return json({
      success: true,
      orderId: results[1].meta.last_row_id,
      purchaseId,
      assigned: Boolean(assignment),
      affiliateAttributed: Boolean(affiliate),
      message: "تم تسجيل الطلب بنجاح"
    });
  } catch (error) {
    console.error("Order creation error:", error);
    return json({ error: "حدث خطأ أثناء تسجيل الطلب", details: error?.message || String(error) }, 500);
  }
}
