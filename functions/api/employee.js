
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_employee";
const SESSION_HOURS = 8;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterationsText, saltText, hashText] =
      storedHash.split("$");

    if (algorithm !== "pbkdf2") return false;

    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 600000) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: fromBase64(saltText),
          iterations,
          hash: "SHA-256"
        },
        key,
        256
      )
    );

    const expected = fromBase64(hashText);

    if (derived.length !== expected.length) return false;

    let difference = 0;
    for (let i = 0; i < derived.length; i++) {
      difference |= derived[i] ^ expected[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}

async function createSession(employeeId, secret) {
  const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
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

export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db || !env.EMPLOYEE_SESSION_SECRET) {
      return json({ error: "إعدادات النظام غير مكتملة" }, 500);
    }

    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password || username.length > 100 || password.length > 200) {
      return json({ error: "اكتب اسم المستخدم وكلمة المرور" }, 400);
    }

    const employee = await db.prepare(
      `SELECT id, full_name, username, password_hash, is_active
       FROM employees
       WHERE username = ? COLLATE NOCASE
       LIMIT 1`
    ).bind(username).first();

    if (!employee || employee.is_active !== 1) {
      return json({ error: "بيانات الدخول غير صحيحة أو الحساب غير نشط" }, 401);
    }

    const passwordValid = await verifyPassword(
      password,
      employee.password_hash
    );

    if (!passwordValid) {
      return json({ error: "بيانات الدخول غير صحيحة أو الحساب غير نشط" }, 401);
    }

    const token = await createSession(
      employee.id,
      env.EMPLOYEE_SESSION_SECRET
    );

    return json(
      {
        success: true,
        employee: {
          id: employee.id,
          name: employee.full_name,
          username: employee.username
        }
      },
      200,
      {
        "Set-Cookie":
          `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/employee; Max-Age=28800`
      }
    );
  } catch (error) {
    return json({ error: "حصل خطأ أثناء تسجيل الدخول" }, 500);
  }
}


function getEmployeeCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("blw_employee="));

  return entry ? entry.slice("blw_employee=".length) : null;
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

    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
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
    const token = getEmployeeCookie(request);

    const employeeId = await verifyEmployeeSession(
      token,
      env.EMPLOYEE_SESSION_SECRET
    );

    if (!employeeId) {
      return json({ error: "جلسة الموظف غير صالحة" }, 401);
    }

    const employee = await env[DB_BINDING].prepare(
      `SELECT id, full_name, username
       FROM employees
       WHERE id = ? AND is_active = 1`
    ).bind(employeeId).first();

    if (!employee) {
      return json({ error: "الحساب غير نشط أو غير موجود" }, 401);
    }

    return json({
      success: true,
      employee
    });
  } catch {
    return json({ error: "حدث خطأ أثناء التحقق من الجلسة" }, 500);
  }
}
