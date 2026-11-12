
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ADMIN_PASSWORD) {
  return Response.json(
    {
      error: "المتغير غير ظاهر للكود",
      debug: {
        hasVariable: Object.prototype.hasOwnProperty.call(env, "ADMIN_PASSWORD"),
        availableBindings: Object.keys(env)
      }
    },
    { status: 500 }
  );
}

    const data = await request.json();
    const password = String(data.password || "");

    if (password !== env.ADMIN_PASSWORD) {
      return Response.json(
        { error: "كلمة المرور غير صحيحة" },
        { status: 401 }
      );
    }

    const expiry = String(Date.now() + 8 * 60 * 60 * 1000);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.ADMIN_PASSWORD),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(expiry)
    );

    const token = expiry + "." + base64url(new Uint8Array(signature));

    return Response.json(
      { success: true, message: "تم تسجيل الدخول" },
      {
        headers: {
          "Set-Cookie":
            `blw_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=28800`
        }
      }
    );
  } catch {
    return Response.json(
      { error: "حدث خطأ أثناء تسجيل الدخول" },
      { status: 500 }
    );
  }
}
