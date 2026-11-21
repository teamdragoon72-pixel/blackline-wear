const DB_BINDING = "blackline-wear-orders";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}


// Public storefront endpoint: only active products, no admin/session requirement.
export async function onRequestGet({ env }) {
  try {
    const db = env[DB_BINDING];
    if (!db) return json({ error: "Database binding not found" }, 500);

    const result = await db.prepare(`
      SELECT id, name, description, price, category, sizes, colors, images, main_image
      FROM products
      WHERE is_active = 1
      ORDER BY id ASC
    `).all();

    const products = (result.results || []).map(product => ({
      ...product,
      sizes: parseArray(product.sizes),
      colors: parseArray(product.colors),
      images: parseArray(product.images)
    }));

    return json({ success: true, products });
  } catch (error) {
    console.error("Public products error:", error);
    return json({ error: "تعذر تحميل المنتجات" }, 500);
  }
}


function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
