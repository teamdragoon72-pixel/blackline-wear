
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_employee";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function getCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE_NAME + "="));

  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

async function verifySession(token, secret) {
  if (!token || !secret) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [idText, expiryText, signature] = parts;
    const employeeId = Number(idText);
    const expiry = Number(expiryText);

    if (
      !Number.isInteger(employeeId) ||
      employeeId <= 0 ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    ) return null;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const base64 = signature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);

    const signatureBytes = Uint8Array.from(
      atob(padded),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(`${employeeId}.${expiry}`)
    );

    return valid ? employeeId : null;
  } catch {
    return null;
  }
}

async function getActiveEmployee(request, env) {
  const employeeId = await verifySession(
    getCookie(request),
    env.EMPLOYEE_SESSION_SECRET
  );

  if (!employeeId) return null;

  return await env[DB_BINDING].prepare(`
    SELECT id, full_name, username
    FROM employees
    WHERE id = ? AND is_active = 1
    LIMIT 1
  `).bind(employeeId).first();
}

const CONTACT_METHODS = ["call", "whatsapp", "other"];

const OUTCOMES = [
  "answered",
  "no_answer",
  "busy",
  "wrong_number",
  "confirmed",
  "cancelled",
  "needs_followup"
];

export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ success: false, error: "Database binding not found" }, 500);
    }

    const employee = await getActiveEmployee(request, env);

    if (!employee) {
      return json({ success: false, error: "جلسة الموظف غير صالحة" }, 401);
    }

    const body = await request.json();

    const orderId = Number(body.order_id);
    const contactMethod = String(body.contact_method || "");
    const outcome = String(body.outcome || "");
    const notes = String(body.notes || "").trim();
    const nextFollowupAt = body.next_followup_at
      ? String(body.next_followup_at).trim()
      : null;

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return json({ success: false, error: "رقم الطلب غير صحيح" }, 400);
    }

    if (!CONTACT_METHODS.includes(contactMethod)) {
      return json({ success: false, error: "طريقة التواصل غير صحيحة" }, 400);
    }

    if (!OUTCOMES.includes(outcome)) {
      return json({ success: false, error: "نتيجة التواصل غير صحيحة" }, 400);
    }

    if (notes.length > 2000) {
      return json({ success: false, error: "الملاحظات طويلة جدًا" }, 400);
    }

    if (
      nextFollowupAt &&
      (
        nextFollowupAt.length > 40 ||
        !Number.isFinite(Date.parse(nextFollowupAt))
      )
    ) {
      return json({ success: false, error: "موعد المتابعة غير صحيح" }, 400);
    }

    const assignedOrder = await db.prepare(`
      SELECT order_id
      FROM order_assignments
      WHERE order_id = ? AND employee_id = ?
      LIMIT 1
    `).bind(orderId, employee.id).first();

    if (!assignedOrder) {
      return json({
        success: false,
        error: "هذا الطلب غير مسند إلى حسابك"
      }, 403);
    }

    const result = await db.prepare(`
      INSERT INTO order_followups (
        order_id,
        employee_id,
        contact_method,
        outcome,
        notes,
        next_followup_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      orderId,
      employee.id,
      contactMethod,
      outcome,
      notes || null,
      nextFollowupAt
    ).run();

    return json({
      success: true,
      message: "تم حفظ المتابعة بنجاح",
      followup_id: result.meta.last_row_id
    });

  } catch (error) {
    return json({
      success: false,
      error: error.message || "حدث خطأ أثناء حفظ المتابعة"
    }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ success: false, error: "Database binding not found" }, 500);
    }

    const employee = await getActiveEmployee(request, env);

    if (!employee) {
      return json({ success: false, error: "جلسة الموظف غير صالحة" }, 401);
    }

    const url = new URL(request.url);
    const orderId = Number(url.searchParams.get("order_id"));

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return json({ success: false, error: "أرسل رقم طلب صحيح" }, 400);
    }

    const assignedOrder = await db.prepare(`
      SELECT order_id
      FROM order_assignments
      WHERE order_id = ? AND employee_id = ?
      LIMIT 1
    `).bind(orderId, employee.id).first();

    if (!assignedOrder) {
      return json({
        success: false,
        error: "هذا الطلب غير مسند إلى حسابك"
      }, 403);
    }

    const result = await db.prepare(`
      SELECT
        id,
        order_id,
        contact_method,
        outcome,
        notes,
        next_followup_at,
        created_at
      FROM order_followups
      WHERE order_id = ? AND employee_id = ?
      ORDER BY created_at DESC, id DESC
    `).bind(orderId, employee.id).all();

    return json({
      success: true,
      followups: result.results || []
    });

  } catch (error) {
    return json({
      success: false,
      error: error.message || "حدث خطأ أثناء تحميل سجل المتابعة"
    }, 500);
  }
}
