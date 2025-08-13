// Cloudflare Pages Function: POST /api/login
// Checks PIN from env and sets a signed session cookie (HttpOnly).
export async function onRequestPost(context) {
  const { PIN, SESSION_SECRET } = context.env;
  const { request } = context;

  // Parse body safely
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const pin = (body?.pin || "").trim();

  if (!pin || pin !== PIN) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "cache-control": "no-store" }
    });
  }

  // Minimal HMAC-SHA256 signature of a tiny payload
  const data = `ok.${Date.now()}`;
  const sig = await hmac(data, SESSION_SECRET);
  const token = btoa(`${data}.${sig}`);

  // HttpOnly cookie for 1 day
  const cookie = [
    `wt_session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=86400"
  ].join("; ");

  return new Response("OK", {
    status: 200,
    headers: {
      "Set-Cookie": cookie,
      "cache-control": "no-store"
    }
  });
}

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

