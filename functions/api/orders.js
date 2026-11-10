
const PRODUCTS = {
  1: { name: "تيشيرت رياضي أسود", price: 450 },
  2: { name: "هودي كاجوال", price: 850 },
  3: { name: "بنطلون رياضي", price: 620 },
  4: { name: "طقم رياضي حريمي", price: 790 },
  5: { name: "تيشيرت أوفر سايز", price: 420 },
  6: { name: "ليجن رياضي", price: 550 }
};

export async function onRequestPost({ request, env }) {
  try {
    const db = env["blackline-wear-orders"];

    if (!db) {
      return Response.json(
        { error: "Database binding not found" },
        { status: 500 }
      );
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const phone = String(data.phone || "").trim();
    const address = String(data.address || "").trim();

    if (!name || !phone || !address) {
      return Response.json(
        { error: "من فضلك أكمل بيانات العميل" },
        { status: 400 }
      );
    }

    if (
      name.length > 100 ||
      phone.length > 30 ||
      address.length > 500
    ) {
      return Response.json(
        { error: "بعض البيانات أطول من المسموح" },
        { status: 400 }
      );
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      return Response.json(
        { error: "السلة فارغة" },
        { status: 400 }
      );
    }

    const quantities = new Map();

    for (const item of data.items) {
      const id = Number(item.id);
      const qty = Number(item.qty);

      if (
        !PRODUCTS[id] ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 20
      ) {
        return Response.json(
          { error: "بيانات أحد المنتجات غير صحيحة" },
          { status: 400 }
        );
      }

      quantities.set(id, (quantities.get(id) || 0) + qty);

      if (quantities.get(id) > 20) {
        return Response.json(
          { error: "الكمية المطلوبة أكبر من المسموح" },
          { status: 400 }
        );
      }
    }

    const items = [...quantities.entries()].map(([id, qty]) => ({
      ...PRODUCTS[id],
      qty
    }));

    const statements = [
      db.prepare(`
        INSERT INTO customers (name, phone, address)
        VALUES (?, ?, ?)
      `).bind(name, phone, address),

      ...items.map(item => {
        const total = item.price * item.qty;

        return db.prepare(`
          INSERT INTO orders (
            customer_name,
            phone,
            address,
            product_name,
            quantity,
            price,
            total,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `).bind(
          name,
          phone,
          address,
          item.name,
          item.qty,
          item.price,
          total
        );
      })
    ];

    const results = await db.batch(statements);

    return Response.json({
      success: true,
      orderId: results[1].meta.last_row_id,
      message: "تم تسجيل الطلب بنجاح"
    });

  } catch (error) {
    return Response.json(
      { error: "حدث خطأ أثناء تسجيل الطلب" },
      { status: 500 }
    );
  }
}

