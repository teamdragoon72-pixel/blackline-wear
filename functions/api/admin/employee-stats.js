
const DB_BINDING = "blackline-wear-orders";

function json(data, status = 200) {
  return Response.json(data, { status });
}

export async function onRequestGet({ env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const result = await db.prepare(`
      SELECT
        e.id,
        e.full_name,
        e.username,
        e.is_active,
        e.created_at,

        (
          SELECT COUNT(*)
          FROM order_assignments oa
          WHERE oa.employee_id = e.id
        ) AS assigned_orders,

        (
          SELECT COUNT(*)
          FROM order_followups f
          WHERE f.employee_id = e.id
        ) AS total_followups,

        (
          SELECT f.outcome
          FROM order_followups f
          WHERE f.employee_id = e.id
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) AS latest_outcome,

        (
          SELECT f.created_at
          FROM order_followups f
          WHERE f.employee_id = e.id
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) AS latest_followup_at,

        (
          SELECT f.order_id
          FROM order_followups f
          WHERE f.employee_id = e.id
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) AS latest_order_id

      FROM employees e
      ORDER BY e.id DESC
    `).all();

    return json({
      success: true,
      employees: result.results || []
    });

  } catch (error) {
    console.error("Employee stats error:", error);

    return json({
      error: "تعذر تحميل إحصائيات الموظفين"
    }, 500);
  }
}
