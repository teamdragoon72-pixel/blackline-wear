
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

    const result = await db.prepare(`
      UPDATE orders
      SET status = ?
      WHERE id = ?
    `).bind(status, id).run();

    if (!result.meta.changes) {
      return Response.json(
        { error: "الطلب غير موجود" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: "تم تحديث حالة الطلب"
    });

  } catch (error) {
    return Response.json(
      { error: "حدث خطأ أثناء تحديث الطلب" },
      { status: 500 }
    );
  }
}
