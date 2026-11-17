
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
        iterations: 100000,
        hash: "SHA-256"
      },
      key,
      256
    )
  );

  const toBase64 = (bytes) => {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  };

  return `pbkdf2$100000$${toBase64(salt)}$${toBase64(hash)}`;
}


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

// عرض الموظفين
export async function onRequestGet({ env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const result = await db.prepare(
      `SELECT id, full_name, username, is_active, created_at
       FROM employees
       ORDER BY id DESC`
    ).all();

    return json({
      success: true,
      employees: result.results || []
    });

  } catch (error) {
    console.error("Employees list error:", error);
    return json({ error: "تعذر تحميل الموظفين" }, 500);
  }
}

// إنشاء حساب موظف
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
      return json({
        error: "اسم المستخدم يجب أن يحتوي على حروف إنجليزية أو أرقام فقط"
      }, 400);
    }

    if (password.length < 8 || password.length > 200) {
      return json({
        error: "كلمة المرور يجب ألا تقل عن 8 أحرف"
      }, 400);
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
    console.error("Employee creation failed:", error);

    if (String(error?.message || error).toLowerCase().includes("unique")) {
      return json({ error: "اسم المستخدم مستخدم بالفعل" }, 409);
    }

    return json({
      error: "فشل إنشاء الحساب: " + String(error?.message || error)
    }, 500);
  }
}

// تفعيل أو إيقاف حساب موظف
export async function onRequestPatch({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const body = await request.json();
    const id = Number(body.id);

    const activeValue = body.is_active;

    const isActive =
      activeValue === true || activeValue === 1 ? 1 :
      activeValue === false || activeValue === 0 ? 0 : null;

    if (!Number.isInteger(id) || id <= 0 || isActive === null) {
      return json({ error: "بيانات الموظف غير صحيحة" }, 400);
    }

    const result = await db.prepare(
      `UPDATE employees
       SET is_active = ?
       WHERE id = ?`
    ).bind(isActive, id).run();

    if (!result.meta.changes) {
      return json({ error: "الموظف غير موجود" }, 404);
    }

    return json({
      success: true,
      message: isActive
        ? "تم تفعيل حساب الموظف"
        : "تم إيقاف حساب الموظف"
    });

  } catch (error) {
    console.error("Employee status update failed:", error);
    return json({
      error: "حدث خطأ أثناء تحديث حساب الموظف"
    }, 500);
  }
}
