// Runs before every request. Allows public paths; otherwise requires a valid session cookie.
const PUBLIC = new Set([
  "/gate.html",
  "/api/login",
  "/favicon.ico",
  // Add any additional public assets here if needed
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Public routes pass through
  if (PUBLIC.has(path)) return context.next();

  // Everything else requires a valid session cookie
  const cookie = getCookie(context.request.headers.get("Cookie"), "wt_session");
  if (cookie && await valid(cookie, context.env.SESSION_SECRET)) {
    return context.next();
  }

  // Not authed: send to gate
  return Response.redirect(new URL("/gate.html", url), 302);
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function valid(b64, secret) {
  try {
    const raw = atob(b64);
    const lastDot = raw.lastIndexOf(".");
    if (lastDot === -1) return false;
    const data = raw.slice(0, lastDot);
    const sig  = raw.slice(lastDot + 1);
    const expect = await hmac(data, secret);
    return sig === expect;
  } catch {
    return false;
  }
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

