
const DB_BINDING = "blackline-wear-orders";

function json(data, status = 200) {
  return Response.json(data, { status });
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 210000,
        hash: "SHA-256"
      },
      key,
      256
    )
  );

  return `pbkdf2$210000$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const body = await request.json();

    const fullName = String(body.full_name || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!fullName || !username || !password) {
      return json({ error: "كل البيانات مطلوبة" }, 400);
    }

    if (fullName.length > 100 || username.length > 40) {
      return json({ error: "الاسم أو اسم المستخدم طويل جدًا" }, 400);
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return json({ error: "اسم المستخدم يجب أن يحتوي على حروف إنجليزية أو أرقام فقط" }, 400);
    }

    if (password.length < 8 || password.length > 200) {
      return json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف" }, 400);
    }

    const passwordHash = await hashPassword(password);

    const result = await db.prepare(
      `INSERT INTO employees
       (full_name, username, password_hash, is_active)
       VALUES (?, ?, ?, 1)`
    ).bind(fullName, username, passwordHash).run();

    return json({
      success: true,
      message: "تم إنشاء حساب الموظف بنجاح",
      employee_id: result.meta.last_row_id
    }, 201);

  } catch (error) {
    if (String(error.message).toLowerCase().includes("unique")) {
      return json({ error: "اسم المستخدم مستخدم بالفعل" }, 409);
    }

    return json({ error: "حدث خطأ أثناء إنشاء الحساب" }, 500);
  }
}

