export async function onRequestGet({ env, params }) {
  const id = params.id;
  const w = await env.DB.prepare(
    `SELECT id, started_at, ended_at, title, notes, total_sets, total_volume
     FROM workouts WHERE id=?`
  ).bind(id).first();
  if (!w) return new Response("Not Found", { status:404 });

  const sets = await env.DB.prepare(
    `SELECT id, exercise, kind, set_index, reps, weight, unit, duration_s, distance, rpe, notes
     FROM sets WHERE workout_id=? ORDER BY set_index ASC`
  ).bind(id).all();

  return new Response(JSON.stringify({ ...w, sets: sets.results || [] }), {
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}

export async function onRequestPut({ env, params, request }) {
  const id = params.id;
  let b = {};
  try { b = await request.json(); } catch {}
  if (b.ended) {
    const sum = await env.DB.prepare(
      `SELECT COUNT(*) AS total_sets,
              SUM(CASE WHEN kind='resistance' AND weight IS NOT NULL AND reps IS NOT NULL
                       THEN weight*reps ELSE 0 END) AS total_volume
       FROM sets WHERE workout_id=?`
    ).bind(id).first();

    await env.DB.prepare(
      `UPDATE workouts
         SET ended_at = COALESCE(ended_at, ?),
             title    = COALESCE(?, title),
             notes    = COALESCE(?, notes),
             total_sets   = ?,
             total_volume = COALESCE(?,0)
       WHERE id=?`
    ).bind(Date.now(), b.title || null, b.notes || null,
           sum?.total_sets || 0, sum?.total_volume || 0, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE workouts SET title=COALESCE(?,title), notes=COALESCE(?,notes) WHERE id=?`
    ).bind(b.title || null, b.notes || null, id).run();
  }
  const w = await env.DB.prepare(`SELECT * FROM workouts WHERE id=?`).bind(id).first();
  return new Response(JSON.stringify(w), {
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}

export async function onRequestDelete({ env, params }) {
  await env.DB.prepare(`DELETE FROM workouts WHERE id=?`).bind(params.id).run();
  return new Response(null, { status:204 });
}

