// GET    /api/workouts/:id      -> detail with sets
// DELETE /api/workouts/:id      -> delete workout (and sets)
export async function onRequestGet({ env, params }) {
  const id = params.id;
  const w = await env.DB.prepare(
    `SELECT id, started_at, title FROM workouts WHERE id=?`
  ).bind(id).first();
  if (!w) return new Response("Not found", { status:404 });

  const sets = await env.DB.prepare(
    `SELECT id, exercise, set_index, reps, weight, unit, rpe, notes
       FROM sets
       WHERE workout_id=?
       ORDER BY set_index ASC`
  ).bind(id).all();

  return new Response(JSON.stringify({ ...w, sets: sets.results || [] }), {
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}

export async function onRequestDelete({ env, params }) {
  const id = params.id;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sets WHERE workout_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM workouts WHERE id=?`).bind(id)
  ]);
  return new Response(null, { status:204 });
}
