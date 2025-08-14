// GET  /api/workouts?limit=50            -> list recent sessions (no sets)
// POST /api/workouts {title?, notes?}    -> start a new session

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(100, Number(url.searchParams.get("limit") || 50));
  const rows = await env.DB.prepare(
    `SELECT id, started_at, ended_at, title, total_sets, total_volume
     FROM workouts ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?`
  ).bind(limit).all();
  return json(rows.results || []);
}

export async function onRequestPost({ env, request }) {
  const b = await safeJson(request);
  const id = crypto.randomUUID();
  const started_at = Date.now();
  await env.DB.prepare(
    `INSERT INTO workouts (id, started_at, title, notes)
     VALUES (?, ?, ?, ?)`
  ).bind(id, started_at, b.title || null, b.notes || null).run();
  return json({ id, started_at, title: b.title || null }, 201);
}

/* utils */
function json(data, status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function safeJson(req){try{return await req.json()}catch{return {}}}
