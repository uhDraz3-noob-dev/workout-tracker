// Robust middleware to avoid redirect loops and allow gate + API cleanly.

const PUBLIC_EXACT = new Set([
  "/gate",
  "/gate.html",
  "/api/login",
  "/api/logout",     // keep if you add a logout endpoint
  "/favicon.ico",
  "/404.html"
]);

const PUBLIC_PREFIX = [
  "/assets/",
  "/static/",
  "/public/",
  "/.well-known/",
  "/images/",
  "/css/",
  "/js/"
];

export async function onRequest(context) {
  const DEFAULT_MAX_AGE_MS = 86_400_000; // 24h
  const url = new URL(context.request.url);
  let path = url.pathname;

  // 1) Normalize trailing slash except for the bare "/"
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  // 2) Public exact or prefix paths pass through
  if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIX.some(p => path.startsWith(p))) {
    return context.next();
  }

  // 3) Already authenticated? allow
  const cookie = getCookie(context.request.headers.get("Cookie"), "wt_session");
  if (cookie && await valid(cookie, context.env.SESSION_SECRET)) {
    return context.next();
  }

  // 4) Guard: never redirect the gate itself (handles /gate and /gate.html)
  if (path === "/gate" || path === "/gate.html") {
    return context.next();
  }

  // 5) Not authed → send to gate
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
