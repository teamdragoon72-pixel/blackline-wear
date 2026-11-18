
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_affiliate";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function fromBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat(
    (4 - normalized.length % 4) % 4
  );

  return Uint8Array.from(
    atob(padded),
    c => c.charCodeAt(0)
  );
}

function getAffiliateCookie(request) {
  const cookies = request.headers.get("Cookie") || "";

  const entry = cookies.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE_NAME}=`));

  return entry
    ? entry.slice(`${COOKIE_NAME}=`.length)
    : null;
}

async function verifyAffiliateSession(token, secret) {
  if (!token || !secret) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [affiliateIdText, expiryText, signature] = parts;

    const affiliateId = Number(affiliateIdText);
    const expiry = Number(expiryText);

    if (
      !Number.isInteger(affiliateId) ||
      affiliateId <= 0 ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    ) {
      return null;
    }

    const message = `${affiliateId}.${expiry}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64(signature),
      new TextEncoder().encode(message)
    );

    return valid ? affiliateId : null;

  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env[DB_BINDING];
    const secret = env.AFFILIATE_SESSION_SECRET;

    if (!db || !secret) {
      return json({
        success: false,
        error: "إعدادات النظام غير مكتملة"
      }, 500);
    }

    // التحقق من جلسة المسوّق
    const token = getAffiliateCookie(request);

    const affiliateId = await verifyAffiliateSession(
      token,
      secret
    );

    if (!affiliateId) {
      return json({
        success: false,
        error: "انتهت جلسة الدخول، سجل دخولك مرة أخرى"
      }, 401);
    }

    // جلب حساب المسوّق من الجلسة فقط
    const affiliate = await db.prepare(`
      SELECT
        id,
        full_name,
        username,
        affiliate_code,
        commission_rate
      FROM affiliate_accounts
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
    `).bind(affiliateId).first();

    if (!affiliate) {
      return json({
        success: false,
        error: "الحساب غير نشط أو غير موجود"
      }, 401);
    }

    // إحصائيات المسوّق
    const stats = await db.prepare(`
      SELECT
        COUNT(*) AS total_orders,

        COALESCE(SUM(order_total), 0) AS total_sales,

        COALESCE(SUM(
          CASE
            WHEN commission_status = 'pending'
            THEN commission_amount
            ELSE 0
          END
        ), 0) AS pending_commissions,

        COALESCE(SUM(
          CASE
            WHEN commission_status = 'earned'
            THEN commission_amount
            ELSE 0
          END
        ), 0) AS earned_commissions,

        COALESCE(SUM(
          CASE
            WHEN commission_status = 'paid'
            THEN commission_amount
            ELSE 0
          END
        ), 0) AS paid_commissions,

        COALESCE(SUM(
          CASE
            WHEN commission_status = 'cancelled'
            THEN commission_amount
            ELSE 0
          END
        ), 0) AS cancelled_commissions

      FROM affiliate_orders
      WHERE affiliate_id = ?
    `).bind(affiliateId).first();

    // الطلبات المنسوبة للمسوّق فقط
    const ordersResult = await db.prepare(`
      SELECT
        affiliate_orders.order_id,
        affiliate_orders.order_total,
        affiliate_orders.commission_rate,
        affiliate_orders.commission_amount,
        affiliate_orders.commission_status,
        affiliate_orders.created_at,

        orders.product_name,
        orders.quantity,
        orders.status AS order_status

      FROM affiliate_orders

      JOIN orders
        ON orders.id = affiliate_orders.order_id

      WHERE affiliate_orders.affiliate_id = ?

      ORDER BY affiliate_orders.created_at DESC

      LIMIT 100
    `).bind(affiliateId).all();

    const origin = new URL(request.url).origin;

    const referralUrl =
      `${origin}/?ref=${encodeURIComponent(affiliate.affiliate_code)}`;

    return json({
      success: true,

      affiliate: {
        id: affiliate.id,
        name: affiliate.full_name,
        username: affiliate.username,
        affiliateCode: affiliate.affiliate_code,
        commissionRate: affiliate.commission_rate,
        referralUrl
      },

      stats: {
        totalOrders: Number(stats?.total_orders || 0),
        totalSales: Number(stats?.total_sales || 0),
        pendingCommissions: Number(stats?.pending_commissions || 0),
        earnedCommissions: Number(stats?.earned_commissions || 0),
        paidCommissions: Number(stats?.paid_commissions || 0),
        cancelledCommissions: Number(stats?.cancelled_commissions || 0)
      },

      orders: (ordersResult.results || []).map(order => ({
        orderId: order.order_id,
        productName: order.product_name,
        quantity: Number(order.quantity || 0),
        total: Number(order.order_total || 0),
        orderStatus: order.order_status,
        commissionRate: Number(order.commission_rate || 0),
        commissionAmount: Number(order.commission_amount || 0),
        commissionStatus: order.commission_status,
        createdAt: order.created_at
      }))
    });

  } catch (error) {
    console.error("Affiliate dashboard error:", error);

    return json({
      success: false,
      error: "حدث خطأ أثناء تحميل بيانات لوحة المسوّق"
    }, 500);
  }
}
