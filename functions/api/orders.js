
const PRODUCTS = {
  1: { name: "تيشيرت رياضي أسود", price: 450 },
  2: { name: "هودي كاجوال", price: 850 },
  3: { name: "بنطلون رياضي", price: 620 },
  4: { name: "طقم رياضي حريمي", price: 790 },
  5: { name: "تيشيرت أوفر سايز", price: 420 },
  6: { name: "ليجن رياضي", price: 550 }
};

const SIZES = ["S", "M", "L", "XL", "XXL"];
const COLORS = ["أسود", "أبيض", "رمادي", "زيتي", "بيرجندي"];

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

    if (data.items.length > 20) {
      return Response.json(
        { error: "عدد المنتجات أكبر من المسموح" },
        { status: 400 }
      );
    }

    const items = [];
    const quantities = new Map();

    for (const item of data.items) {
      const id = Number(item.id);
      const qty = Number(item.qty);
      const size = String(item.size || "").trim();
      const color = String(item.color || "").trim();

      if (
        !PRODUCTS[id] ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 20 ||
        !SIZES.includes(size) ||
        !COLORS.includes(color)
      ) {
        return Response.json(
          { error: "تأكد من اختيار مقاس ولون صحيح لكل منتج" },
          { status: 400 }
        );
      }

      const key = `${id}-${size}-${color}`;
      const newQty = (quantities.get(key) || 0) + qty;

      if (newQty > 20) {
        return Response.json(
          { error: "الكمية المطلوبة أكبر من المسموح" },
          { status: 400 }
        );
      }

      quantities.set(key, newQty);

      items.push({
        ...PRODUCTS[id],
        qty,
        size,
        color
      });
    }

    // التحقق من كود المسوّق من قاعدة البيانات
    // لا نعتمد على نسبة عمولة يرسلها المتصفح
    const affiliateCode = String(
      data.affiliateCode || data.affiliate_code || ""
    ).trim().toUpperCase();

    let affiliate = null;

    if (affiliateCode) {
      affiliate = await db.prepare(`
        SELECT id, commission_rate
        FROM affiliate_accounts
        WHERE affiliate_code = ?
          AND is_active = 1
        LIMIT 1
      `).bind(affiliateCode).first();
    }

    // رقم مستقل لكل عملية شراء
    const purchaseId = crypto.randomUUID();

    const statements = [
      // تحديث بيانات العميل
      db.prepare(`
        INSERT INTO customers (name, phone, address)
        VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          name = excluded.name,
          address = excluded.address
      `).bind(name, phone, address),

      // تسجيل جميع منتجات السلة بنفس purchase_id
      ...items.map(item => {
        const total = item.price * item.qty;

        return db.prepare(`
          INSERT INTO orders (
            customer_name,
            phone,
            address,
            product_name,
            size,
            color,
            quantity,
            price,
            total,
            status,
            purchase_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(
          name,
          phone,
          address,
          item.name,
          item.size,
          item.color,
          item.qty,
          item.price,
          total,
          purchaseId
        );
      }),

      // اختيار الموظف النشط التالي بالتناوب
      db.prepare(`
        UPDATE assignment_settings
        SET last_employee_id = COALESCE(
          (
            SELECT MIN(id)
            FROM employees
            WHERE is_active = 1
              AND id > COALESCE(assignment_settings.last_employee_id, 0)
          ),
          (
            SELECT MIN(id)
            FROM employees
            WHERE is_active = 1
          )
        )
        WHERE id = 1
          AND EXISTS (
            SELECT 1
            FROM employees
            WHERE is_active = 1
          )
      `),

      // إسناد كل منتجات عملية الشراء لنفس الموظف
      db.prepare(`
        INSERT INTO order_assignments (order_id, employee_id)
        SELECT
          orders.id,
          assignment_settings.last_employee_id
        FROM orders
        CROSS JOIN assignment_settings
        WHERE orders.purchase_id = ?
          AND assignment_settings.id = 1
          AND assignment_settings.last_employee_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM employees
            WHERE employees.id = assignment_settings.last_employee_id
              AND employees.is_active = 1
          )
      `).bind(purchaseId)
    ];

    // تسجيل عمولات المسوّق لكل منتج في الطلب
    // نسبة العمولة مأخوذة من حساب المسوّق في قاعدة البيانات
    if (affiliate) {
      statements.push(
        db.prepare(`
          INSERT INTO affiliate_orders (
            order_id,
            affiliate_id,
            commission_rate,
            order_total,
            commission_amount,
            commission_status
          )
          SELECT
            id,
            ?,
            ?,
            total,
            ROUND(total * ? / 100, 2),
            'pending'
          FROM orders
          WHERE purchase_id = ?
        `).bind(
          affiliate.id,
          affiliate.commission_rate,
          affiliate.commission_rate,
          purchaseId
        )
      );
    }

    // تنفيذ التسجيل والتوزيع وربط المسوّق في عملية واحدة
    const results = await db.batch(statements);

    // معرفة الموظف الذي استلم العملية
    const assignment = await db.prepare(`
      SELECT
        employees.id,
        employees.full_name
      FROM order_assignments
      JOIN employees
        ON employees.id = order_assignments.employee_id
      JOIN orders
        ON orders.id = order_assignments.order_id
      WHERE orders.purchase_id = ?
      LIMIT 1
    `).bind(purchaseId).first();

    return Response.json({
      success: true,
      orderId: results[1].meta.last_row_id,
      purchaseId,
      assigned: Boolean(assignment),
      affiliateAttributed: Boolean(affiliate),
      message: "تم تسجيل الطلب بنجاح"
    });

  } catch (error) {
    console.error("Order creation error:", error);

    return Response.json(
      {
        error: "حدث خطأ أثناء تسجيل الطلب",
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}
