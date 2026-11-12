
export async function onRequestGet({ env }) {
  try {
    const db = env["blackline-wear-orders"];

    if (!db) {
      return Response.json(
        { error: "Database binding not found" },
        { status: 500 }
      );
    }

    const result = await db.prepare(`
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
        orders: result.results || []
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
        error: "تعذر تحميل الطلبات",
        details: error.message
      },
      { status: 500 }
    );
  }
}
