
const DB_BINDING = "blackline-wear-orders";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
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

  return `pbkdf2$100000$${toBase64(salt)}$${toBase64(hash)}`;
}

function generateAffiliateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));

  return "BL" + Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// عرض المسوقين وإحصائياتهم
export async function onRequestGet({ env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const result = await db.prepare(`
      SELECT
        a.id,
        a.full_name,
        a.username,
        a.affiliate_code,
        a.commission_rate,
        a.is_active,
        a.created_at,
        COUNT(o.id) AS total_orders,
        COALESCE(SUM(o.order_total), 0) AS total_sales,
        COALESCE(SUM(
          CASE
            WHEN o.commission_status != 'cancelled'
            THEN o.commission_amount
            ELSE 0
          END
        ), 0) AS total_commissions,
        COALESCE(SUM(
          CASE
            WHEN o.commission_status = 'paid'
            THEN o.commission_amount
            ELSE 0
          END
        ), 0) AS paid_commissions
      FROM affiliate_accounts a
      LEFT JOIN affiliate_orders o
        ON o.affiliate_id = a.id
      GROUP BY a.id
      ORDER BY a.id DESC
    `).all();

    return json({
      success: true,
      affiliates: result.results || []
    });

  } catch (error) {
    console.error("Affiliate list error:", error);
    return json({
      error: "تعذر تحميل المسوقين"
    }, 500);
  }
}

// إنشاء حساب مسوق
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
      return json({
        error: "كل البيانات مطلوبة"
      }, 400);
    }

    if (fullName.length > 100 || username.length > 40) {
      return json({
        error: "الاسم أو اسم المستخدم طويل جدًا"
      }, 400);
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

    let commissionRate = 10;

    const settings = await db.prepare(`
      SELECT default_commission_rate
      FROM affiliate_settings
      WHERE id = 1
    `).first();

    if (settings) {
      commissionRate = Number(settings.default_commission_rate);
    }

    if (body.commission_rate !== undefined) {
      commissionRate = Number(body.commission_rate);
    }

    if (
      !Number.isFinite(commissionRate) ||
      commissionRate <= 0 ||
      commissionRate > 100
    ) {
      return json({
        error: "نسبة العمولة يجب أن تكون أكبر من 0 وألا تتجاوز 100%"
      }, 400);
    }

    const passwordHash = await hashPassword(password);

    let affiliateCode;
    let created = false;
    let result;

    for (let attempt = 0; attempt < 5; attempt++) {
      affiliateCode = generateAffiliateCode();

      try {
        result = await db.prepare(`
          INSERT INTO affiliate_accounts (
            full_name,
            username,
            password_hash,
            affiliate_code,
            commission_rate,
            is_active
          )
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(
          fullName,
          username,
          passwordHash,
          affiliateCode,
          commissionRate
        ).run();

        created = true;
        break;
      } catch (error) {
        const message = String(error?.message || error).toLowerCase();

        if (message.includes("username")) {
          return json({
            error: "اسم المستخدم مستخدم بالفعل"
          }, 409);
        }

        if (message.includes("affiliate_code")) {
          continue;
        }

        throw error;
      }
    }

    if (!created) {
      return json({
        error: "تعذر إنشاء كود تسويقي فريد، حاول مرة أخرى"
      }, 500);
    }

    return json({
      success: true,
      message: "تم إنشاء حساب المسوق بنجاح",
      affiliate: {
        id: result.meta.last_row_id,
        full_name: fullName,
        username,
        affiliate_code: affiliateCode,
        commission_rate: commissionRate,
        is_active: 1
      }
    }, 201);

  } catch (error) {
    console.error("Affiliate creation failed:", error);

    return json({
      error: "فشل إنشاء الحساب: " + String(error?.message || error)
    }, 500);
  }
}

// تفعيل أو إيقاف المسوق أو تعديل عمولته
export async function onRequestPatch({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "قاعدة البيانات غير متصلة" }, 500);
    }

    const body = await request.json();
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
      return json({
        error: "رقم المسوق غير صحيح"
      }, 400);
    }

    const affiliate = await db.prepare(`
      SELECT id FROM affiliate_accounts
      WHERE id = ?
    `).bind(id).first();

    if (!affiliate) {
      return json({
        error: "المسوق غير موجود"
      }, 404);
    }

    if (body.is_active !== undefined) {
      const activeValue = body.is_active;

      const isActive =
        activeValue === true || activeValue === 1 ? 1 :
        activeValue === false || activeValue === 0 ? 0 : null;

      if (isActive === null) {
        return json({
          error: "حالة الحساب غير صحيحة"
        }, 400);
      }

      await db.prepare(`
        UPDATE affiliate_accounts
        SET is_active = ?
        WHERE id = ?
      `).bind(isActive, id).run();
    }

    if (body.commission_rate !== undefined) {
      const rate = Number(body.commission_rate);

      if (
        !Number.isFinite(rate) ||
        rate <= 0 ||
        rate > 100
      ) {
        return json({
          error: "نسبة العمولة يجب أن تكون أكبر من 0 وألا تتجاوز 100%"
        }, 400);
      }

      await db.prepare(`
        UPDATE affiliate_accounts
        SET commission_rate = ?
        WHERE id = ?
      `).bind(rate, id).run();
    }

    return json({
      success: true,
      message: "تم تحديث حساب المسوق بنجاح"
    });

  } catch (error) {
    console.error("Affiliate update failed:", error);

    return json({
      error: "حدث خطأ أثناء تحديث حساب المسوق"
    }, 500);
  }
}
