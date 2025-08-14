// POST /api/sets  -> add one or many sets
export async function onRequestPost({ env, request }) {
  const body = await safeJson(request);
  const items = Array.isArray(body) ? body : [body];
  const stmts = [];
  let idxFix = 0;

  for (const it of items) {
    if (!it.workout_id || !it.exercise) {
      return json({ ok:false, error:"workout_id and exercise are required" }, 400);
    }
    const id = crypto.randomUUID();
    const set_index = Number(it.set_index ?? ++idxFix);
    stmts.push(env.DB.prepare(
      `INSERT INTO sets
        (id, workout_id, exercise, kind, set_index, reps, weight, unit, duration_s, distance, rpe, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      it.workout_id,
      String(it.exercise).trim(),
      it.kind || 'resistance',
      set_index,
      toNum(it.reps),
      toNum(it.weight),
      it.unit || 'kg',
      toNum(it.duration_s),
      toNum(it.distance),
      toNum(it.rpe),
      it.notes || null
    ));
  }

  await env.DB.batch(stmts);
  return json({ ok:true }, 201);
}

function toNum(n){ return n==null || n==="" ? null : Number(n) }
function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{ 'content-type':'application/json','cache-control':'no-store' }}) }
async function safeJson(req){ try { return await req.json(); } catch { return {}; } }

