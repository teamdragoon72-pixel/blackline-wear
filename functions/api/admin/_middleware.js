
function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";").map(x => x.trim())
    .find(x => x.startsWith(name + "="));
  return entry ? entry.slice(name.length + 1) : null;
}

async function verifyToken(token, secret) {
  if (!token || !secret) return false;

  const [expiryText, signature] = token.split(".");
  const expiry = Number(expiryText);

  if (!Number.isFinite(expiry) || expiry < Date.now()) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const bytes = Uint8Array.from(
      atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
      c => c.charCodeAt(0)
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(expiryText)
    );
  } catch {
    return false;
  }
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/login") {
    return next();
  }

  const token = getCookie(request, "blw_admin");
  const valid = await verifyToken(token, env.ADMIN_PASSWORD);

  if (!valid) {
    return Response.json(
      { error: "غير مصرح بالدخول" },
      { status: 401 }
    );
  }

  return next();
}

