
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_employee";
const IDLE_MINUTES = 20;

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function getEmployeeCookie(request) {
  const cookies = request.headers.get("Cookie") || "";

  const entry = cookies
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE_NAME + "="));

  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createSession(employeeId, secret) {
  const expiry = Date.now() + IDLE_MINUTES * 60 * 1000;
  const message = `${employeeId}.${expiry}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return `${message}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyEmployeeSession(token, secret) {
  if (!token || !secret) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [employeeIdText, expiryText, signature] = parts;

    const employeeId = Number(employeeIdText);
    const expiry = Number(expiryText);

    if (
      !Number.isInteger(employeeId) ||
      employeeId <= 0 ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    ) {
      return null;
    }

    const message = `${employeeId}.${expiry}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const base64 = signature
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded = base64 + "=".repeat(
      (4 - base64.length % 4) % 4
    );

    const signatureBytes = Uint8Array.from(
      atob(padded),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(message)
    );

    return valid ? employeeId : null;

  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db || !env.EMPLOYEE_SESSION_SECRET) {
      return json({
        success: false,
        error: "إعدادات النظام غير مكتملة"
      }, 500);
    }

    const token = getEmployeeCookie(request);

    const employeeId = await verifyEmployeeSession(
      token,
      env.EMPLOYEE_SESSION_SECRET
    );

    if (!employeeId) {
      return json({
        success: false,
        error: "انتهت جلسة الدخول، سجل دخولك مرة أخرى"
      }, 401);
    }

    const employee = await db.prepare(`
      SELECT id, full_name, username
      FROM employees
      WHERE id = ? AND is_active = 1
      LIMIT 1
    `).bind(employeeId).first();

    if (!employee) {
      return json({
        success: false,
        error: "الحساب غير نشط أو غير موجود"
      }, 401);
    }

    const result = await db.prepare(`
      SELECT
        o.id,
        o.purchase_id,
        o.customer_name,
        o.phone,
        o.address,
        o.product_name,
        o.size,
        o.color,
        o.quantity,
        o.price,
        o.total,
        o.status,
        o.created_at,
        oa.assigned_at,

        (
          SELECT f.outcome
          FROM order_followups f
          WHERE f.order_id = o.id
            AND f.employee_id = ?
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) AS latest_followup_outcome,

        (
          SELECT f.next_followup_at
          FROM order_followups f
          WHERE f.order_id = o.id
            AND f.employee_id = ?
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1
        ) AS next_followup_at

      FROM orders o

      INNER JOIN order_assignments oa
        ON oa.order_id = o.id

      WHERE oa.employee_id = ?

      ORDER BY o.created_at DESC, o.id DESC
    `).bind(
      employeeId,
      employeeId,
      employeeId
    ).all();

    // تجديد الجلسة لمدة 20 دقيقة
    const newToken = await createSession(
      employeeId,
      env.EMPLOYEE_SESSION_SECRET
    );

    return json({
      success: true,
      employee,
      orders: result.results || []
    }, 200, {
      "Set-Cookie":
        `${COOKIE_NAME}=${newToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/employee; Max-Age=1200`
    });

  } catch (error) {
    return json({
      success: false,
      error: "حدث خطأ أثناء تحميل الطلبات"
    }, 500);
  }
}
