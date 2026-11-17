
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_employee";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const cookie = cookieHeader
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(name + "="));

  return cookie ? cookie.substring(name.length + 1) : null;
}

function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function verifyEmployee(request, env) {
  const token = getCookie(request, COOKIE_NAME);

  if (!token || !env.EMPLOYEE_SESSION_SECRET) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

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

  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.EMPLOYEE_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedData = `${employeeId}.${expiry}`;

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    secret,
    new TextEncoder().encode(signedData)
  );

  const expectedSignature = toBase64Url(
    new Uint8Array(signatureBytes)
  );

  if (signature !== expectedSignature) {
    return null;
  }

  const db = env[DB_BINDING];

  if (!db) {
    return null;
  }

  const employee = await db.prepare(`
    SELECT id, full_name, username
    FROM employees
    WHERE id = ? AND is_active = 1
    LIMIT 1
  `).bind(employeeId).first();

  return employee || null;
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ success: false, error: "Database binding not found" }, 500);
    }

    const employee = await verifyEmployee(request, env);

    if (!employee) {
      return json({
        success: false,
        error: "انتهت الجلسة أو الحساب غير مفعل"
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
      employee.id,
      employee.id,
      employee.id
    ).all();

    return json({
      success: true,
      employee,
      orders: result.results || []
    });

  } catch (error) {
    return json({
      success: false,
      error: error.message || "حدث خطأ أثناء تحميل الطلبات"
    }, 500);
  }
}
