
export async function onRequestGet({ env }) {
  try {
    const db = env["blackline-wear-orders"];

    if (!db) {
      return Response.json(
        { error: "Database binding not found" },
        { status: 500 }
      );
    }

    // إحصائيات جميع الطلبات
    const statsResult = await db.prepare(`
      SELECT
        COUNT(*) AS totalOrders,

        COALESCE(SUM(
          CASE WHEN status != 'cancelled'
          THEN total ELSE 0 END
        ), 0) AS totalSales,

        COALESCE(SUM(
          CASE WHEN status = 'pending'
          THEN 1 ELSE 0 END
        ), 0) AS pendingOrders,

        COALESCE(SUM(
          CASE WHEN status = 'processing'
          THEN 1 ELSE 0 END
        ), 0) AS processingOrders,

        COALESCE(SUM(
          CASE WHEN status = 'delivered'
          THEN 1 ELSE 0 END
        ), 0) AS deliveredOrders

      FROM orders
    `).all();

    // أكثر 5 منتجات مبيعاً
    const productsResult = await db.prepare(`
      SELECT
        product_name,
        SUM(quantity) AS totalQuantity,
        SUM(total) AS totalRevenue
      FROM orders
      WHERE status != 'cancelled'
      GROUP BY product_name
      ORDER BY totalQuantity DESC
      LIMIT 5
    `).all();

    // آخر 100 طلب
    const ordersResult = await db.prepare(`
      SELECT
        id,
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
        created_at
      FROM orders
      ORDER BY id DESC
      LIMIT 100
    `).all();

    return Response.json(
      {
        success: true,
        orders: ordersResult.results || [],
        stats: (statsResult.results || [])[0] || {},
        topProducts: productsResult.results || []
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        error: "تعذر تحميل الطلبات والإحصائيات",
        details: error.message
      },
      { status: 500 }
    );
  }
}
