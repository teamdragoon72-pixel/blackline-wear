
const ALLOWED_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled"
];

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
    const id = Number(data.id);
    const status = String(data.status || "");

    if (!Number.isInteger(id) || id < 1) {
      return Response.json(
        { error: "رقم الطلب غير صحيح" },
        { status: 400 }
      );
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return Response.json(
        { error: "حالة الطلب غير صحيحة" },
        { status: 400 }
      );
    }

    // تحديث الطلب والعمولة في عملية واحدة
    const results = await db.batch([
      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `).bind(status, id),

      db.prepare(`
        UPDATE affiliate_orders
        SET commission_status = CASE
          WHEN commission_status = 'paid' THEN 'paid'
          WHEN ? = 'delivered' THEN 'earned'
          WHEN ? = 'cancelled' THEN 'cancelled'
          ELSE 'pending'
        END
        WHERE order_id = ?
      `).bind(status, status, id)
    ]);

    if (!results[0].meta.changes) {
      return Response.json(
        { error: "الطلب غير موجود" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: "تم تحديث حالة الطلب والعمولة بنجاح"
    });

  } catch (error) {
    console.error("Update order error:", error);

    return Response.json(
      {
        error: "حدث خطأ أثناء تحديث الطلب",
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}
