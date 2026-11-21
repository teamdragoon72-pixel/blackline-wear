
const DB_BINDING = "blackline-wear-orders";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

// GET: عرض المنتجات
export async function onRequestGet({ env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "Database binding not found" }, 500);
    }

    const result = await db.prepare(`
      SELECT *
      FROM products
      ORDER BY id DESC
    `).all();

    return json({
      success: true,
      products: result.results || []
    });

  } catch (error) {
    return json({
      error: "حدث خطأ أثناء تحميل المنتجات",
      details: error.message
    }, 500);
  }
}

// POST: إضافة منتج
export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "Database binding not found" }, 500);
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const description = String(data.description || "").trim();
    const price = Number(data.price);
    const category = String(data.category || "").trim();

    const sizes = JSON.stringify(
      Array.isArray(data.sizes) ? data.sizes : []
    );

    const colors = JSON.stringify(
      Array.isArray(data.colors) ? data.colors : []
    );

    const images = JSON.stringify(
      Array.isArray(data.images) ? data.images : []
    );

    const mainImage = String(data.main_image || "").trim();

    const isActive = data.is_active === false ? 0 : 1;

    if (!name) {
      return json({ error: "اسم المنتج مطلوب" }, 400);
    }

    if (!Number.isFinite(price) || price <= 0) {
      return json({ error: "السعر غير صحيح" }, 400);
    }

    await db.prepare(`
      INSERT INTO products (
        name,
        description,
        price,
        category,
        sizes,
        colors,
        images,
        main_image,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      name,
      description,
      price,
      category,
      sizes,
      colors,
      images,
      mainImage,
      isActive
    ).run();

    return json({
      success: true,
      message: "تم إضافة المنتج بنجاح"
    });

  } catch (error) {
    return json({
      error: "حدث خطأ أثناء إضافة المنتج",
      details: error.message
    }, 500);
  }
}

// PUT: تعديل منتج
export async function onRequestPut({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "Database binding not found" }, 500);
    }

    const data = await request.json();
    const id = Number(data.id);

    if (!Number.isInteger(id) || id <= 0) {
      return json({ error: "رقم المنتج غير صحيح" }, 400);
    }

    const name = String(data.name || "").trim();
    const description = String(data.description || "").trim();
    const price = Number(data.price);
    const category = String(data.category || "").trim();

    if (!name) {
      return json({ error: "اسم المنتج مطلوب" }, 400);
    }

    if (!Number.isFinite(price) || price <= 0) {
      return json({ error: "السعر غير صحيح" }, 400);
    }

    const sizes = JSON.stringify(
      Array.isArray(data.sizes) ? data.sizes : []
    );

    const colors = JSON.stringify(
      Array.isArray(data.colors) ? data.colors : []
    );

    const images = JSON.stringify(
      Array.isArray(data.images) ? data.images : []
    );

    const mainImage = String(data.main_image || "").trim();

    const isActive = data.is_active === false ? 0 : 1;

    const result = await db.prepare(`
      UPDATE products
      SET
        name = ?,
        description = ?,
        price = ?,
        category = ?,
        sizes = ?,
        colors = ?,
        images = ?,
        main_image = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      name,
      description,
      price,
      category,
      sizes,
      colors,
      images,
      mainImage,
      isActive,
      id
    ).run();

    if (!result.meta.changes) {
      return json({ error: "المنتج غير موجود" }, 404);
    }

    return json({
      success: true,
      message: "تم تعديل المنتج بنجاح"
    });

  } catch (error) {
    return json({
      error: "حدث خطأ أثناء تعديل المنتج",
      details: error.message
    }, 500);
  }
}

// DELETE: حذف منتج
export async function onRequestDelete({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db) {
      return json({ error: "Database binding not found" }, 500);
    }

    const data = await request.json();
    const id = Number(data.id);

    if (!Number.isInteger(id) || id <= 0) {
      return json({ error: "رقم المنتج غير صحيح" }, 400);
    }

    const result = await db.prepare(`
      DELETE FROM products
      WHERE id = ?
    `).bind(id).run();

    if (!result.meta.changes) {
      return json({ error: "المنتج غير موجود" }, 404);
    }

    return json({
      success: true,
      message: "تم حذف المنتج بنجاح"
    });

  } catch (error) {
    return json({
      error: "حدث خطأ أثناء حذف المنتج",
      details: error.message
    }, 500);
  }
}
