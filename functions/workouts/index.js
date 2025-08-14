// GET  /api/workouts       -> list recent workouts with basic info
// POST /api/workouts       -> create a workout {title?}
export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(
    `SELECT id, started_at, title
       FROM workouts
       ORDER BY started_at DESC
       LIMIT 50`
  ).all();
  return json(rows);
}

export async function onRequestPost({ env, request }) {
  const body = await safeJson(request);
  const id = crypto.randomUUID();
  const started_at = Date.now();
  const title = (body?.title || null);

  await env.DB.prepare(
    `INSERT INTO workouts (id, started_at, title)
     VALUES (?, ?, ?)`
  ).bind(id, started_at, title).run();

  return json({ id, started_at, title }, 201);
}

/*** utils ***/
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}
async function safeJson(req){ try{return await req.json()}catch{return {}} }
