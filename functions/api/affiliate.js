
const DB_BINDING = "blackline-wear-orders";
const COOKIE_NAME = "blw_affiliate";
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

async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterationsText, saltText, hashText] =
      storedHash.split("$");

    const iterations = Number(iterationsText);

    if (
      algorithm !== "pbkdf2" ||
      iterations !== 100000 ||
      !saltText ||
      !hashText
    ) {
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

async function createSession(affiliateId, secret) {
  const expiry = Date.now() + IDLE_MINUTES * 60 * 1000;
  const message = `${affiliateId}.${expiry}`;

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

async function createSessionCookie(affiliateId, secret) {
  const token = await createSession(affiliateId, secret);

  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/affiliate; Max-Age=1200`;
}

// تسجيل دخول المسوّق
export async function onRequestPost({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db || !env.AFFILIATE_SESSION_SECRET) {
      return json({
        success: false,
        error: "إعدادات النظام غير مكتملة"
      }, 500);
    }

    const body = await request.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (
      !username ||
      !password ||
      username.length > 100 ||
      password.length > 200
    ) {
      return json({
        success: false,
        error: "اكتب اسم المستخدم وكلمة المرور"
      }, 400);
    }

    const affiliate = await db.prepare(`
      SELECT
        id,
        full_name,
        username,
        password_hash,
        affiliate_code,
        commission_rate,
        is_active
      FROM affiliate_accounts
      WHERE username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!affiliate || Number(affiliate.is_active) !== 1) {
      return json({
        success: false,
        error: "بيانات الدخول غير صحيحة أو الحساب غير نشط"
      }, 401);
    }

    const passwordValid = await verifyPassword(
      password,
      affiliate.password_hash
    );

    if (!passwordValid) {
      return json({
        success: false,
        error: "بيانات الدخول غير صحيحة أو الحساب غير نشط"
      }, 401);
    }

    const cookie = await createSessionCookie(
      affiliate.id,
      env.AFFILIATE_SESSION_SECRET
    );

    return json({
      success: true,
      affiliate: {
        id: affiliate.id,
        name: affiliate.full_name,
        username: affiliate.username,
        affiliateCode: affiliate.affiliate_code,
        commissionRate: affiliate.commission_rate
      }
    }, 200, {
      "Set-Cookie": cookie
    });

  } catch (error) {
    return json({
      success: false,
      error: "حصل خطأ أثناء تسجيل الدخول"
    }, 500);
  }
}

// التحقق من الجلسة وتجديدها
export async function onRequestGet({ request, env }) {
  try {
    const db = env[DB_BINDING];

    if (!db || !env.AFFILIATE_SESSION_SECRET) {
      return json({
        success: false,
        error: "إعدادات النظام غير مكتملة"
      }, 500);
    }

    const token = getAffiliateCookie(request);

    const affiliateId = await verifyAffiliateSession(
      token,
      env.AFFILIATE_SESSION_SECRET
    );

    if (!affiliateId) {
      return json({
        success: false,
        error: "انتهت جلسة الدخول، سجل دخولك مرة أخرى"
      }, 401);
    }

    const affiliate = await db.prepare(`
      SELECT
        id,
        full_name,
        username,
        affiliate_code,
        commission_rate
      FROM affiliate_accounts
      WHERE id = ? AND is_active = 1
      LIMIT 1
    `).bind(affiliateId).first();

    if (!affiliate) {
      return json({
        success: false,
        error: "الحساب غير نشط أو غير موجود"
      }, 401);
    }

    const cookie = await createSessionCookie(
      affiliateId,
      env.AFFILIATE_SESSION_SECRET
    );

    return json({
      success: true,
      affiliate: {
        id: affiliate.id,
        name: affiliate.full_name,
        username: affiliate.username,
        affiliateCode: affiliate.affiliate_code,
        commissionRate: affiliate.commission_rate
      }
    }, 200, {
      "Set-Cookie": cookie
    });

  } catch (error) {
    return json({
      success: false,
      error: "حدث خطأ أثناء التحقق من الجلسة"
    }, 500);
  }
}

// تسجيل خروج المسوّق
export async function onRequestDelete() {
  return json({
    success: true,
    message: "تم تسجيل الخروج بنجاح"
  }, 200, {
    "Set-Cookie":
      `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/affiliate; Max-Age=0`
  });
}

