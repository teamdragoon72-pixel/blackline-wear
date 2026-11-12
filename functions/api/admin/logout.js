
export async function onRequestGet() {
  return new Response(
    JSON.stringify({ success: true }),
    {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie":
          "blw_admin=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0"
      }
    }
  );
}
