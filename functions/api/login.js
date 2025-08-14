// Cloudflare Pages Function: POST /api/login
// Rate limiting + progressive backoff with KV, optional Turnstile challenge.
// On success, sets HttpOnly session cookie (same as before).

export async function onRequestPost(context) {
  const { PIN, SESSION_SECRET, TURNSTILE_SECRET_KEY } = context.env;
  const { request } = context;

  // --- Identify client (per-IP) ---
  const ip = clientIp(request);

  // --- Load current limiter state ---
  const limiter = await getLimiter(context.env.WT_RATELIMIT, ip);

  // --- Enforce cooldown if active ---
  const now = Date.now();
  if (limiter.nextAllowedAt && now < limiter.nextAllowedAt) {
    const retryAfter = Math.ceil((limiter.nextAllowedAt - now) / 1000);
    return new Response(JSON.stringify({ ok:false, reason:"cooldown", retryAfter }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "Retry-After": String(retryAfter)
      }
    });
  }

  // --- Parse body safely ---
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const pin = (body?.pin || "").trim();
  const tsToken = (body?.turnstileToken || "").trim();

  // --- If challenge is required, verify Turnstile ---
  if (limiter.requireChallenge || tsToken) {
    const ok = await verifyTurnstile(TURNSTILE_SECRET_KEY, tsToken, ip);
    if (!ok && limiter.requireChallenge) {
      await bumpFailures(context.env.WT_RATELIMIT, ip, /*failed=*/true);
      return new Response(JSON.stringify({ ok:false, reason:"challenge" }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
  }

  // --- Check credentials (uniform handling) ---
  if (!pin || pin !== PIN) {
    const state = await bumpFailures(context.env.WT_RATELIMIT, ip, /*failed=*/true);
    const payload = { ok:false, reason:"invalid" };
    // If we just entered cooldown, return 429 with Retry-After
    if (state.nextAllowedAt && Date.now() < state.nextAllowedAt) {
      const retryAfter = Math.ceil((state.nextAllowedAt - Date.now()) / 1000);
      return new Response(JSON.stringify({ ok:false, reason:"cooldown", retryAfter }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "Retry-After": String(retryAfter)
        }
      });
    }
    // Otherwise a normal 401
    return new Response(JSON.stringify(payload), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  // --- Success: reset limiter, set session cookie ---
  await resetFailures(context.env.WT_RATELIMIT, ip);

  const data = `ok.${Date.now()}`;
  const sig  = await hmac(data, SESSION_SECRET);
  const token = btoa(`${data}.${sig}`);

  const cookie = [
    `wt_session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=86400"
  ].join("; ");

  return new Response(JSON.stringify({ ok:true }), {
    status: 200,
    headers: { "Set-Cookie": cookie, "content-type":"application/json", "cache-control":"no-store" }
  });
}

/*** Helpers ***/

function clientIp(request) {
  // Cloudflare supplies CF-Connecting-IP
  return request.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

async function getLimiter(KV, ip) {
  const key = `rl:${ip}`;
  const data = await KV.get(key, { type: "json" }); // { fails, nextAllowedAt, requireChallenge, updatedAt }
  return data || { fails: 0, nextAllowedAt: 0, requireChallenge: false, updatedAt: 0 };
}

async function bumpFailures(KV, ip, failed) {
  const key = `rl:${ip}`;
  const now = Date.now();
  const cur = await getLimiter(KV, ip);

  let fails = failed ? (cur.fails + 1) : 0;

  // Backoff schedule (seconds) & when to require Turnstile
  // 1-3: no delay; 4-5: 5s; 6-7: 15s; 8-9: 60s + challenge; >=10: 300s + challenge; >=12: 3600s + challenge
  let cooldown = 0;
  let requireChallenge = cur.requireChallenge;

  if (fails >= 12) { cooldown = 3600; requireChallenge = true; }
  else if (fails >= 10) { cooldown = 300; requireChallenge = true; }
  else if (fails >= 8) { cooldown = 60; requireChallenge = true; }
  else if (fails >= 6) { cooldown = 15; }
  else if (fails >= 4) { cooldown = 5; }

  const nextAllowedAt = cooldown ? (now + cooldown * 1000) : 0;

  const state = { fails, nextAllowedAt, requireChallenge, updatedAt: now };
  // Expire record automatically (24h). Adjust if you want shorter memory.
  await KV.put(key, JSON.stringify(state), { expirationTtl: 24 * 60 * 60 });
  return state;
}

async function resetFailures(KV, ip) {
  const key = `rl:${ip}`;
  await KV.delete(key);
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip
      })
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// same HMAC helper you already use in middleware/login
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
