export async function onRequestGet({ env }) {
  const row = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...args).all();

  const wCount = await row(`SELECT COUNT(*) AS n FROM workouts`);
  const sCount = await row(`SELECT COUNT(*) AS n FROM sets`);
  const bwCount = await row(`SELECT COUNT(*) AS n FROM weighins`);
  const recent = await all(
    `SELECT id, started_at, ended_at, title, total_sets, total_volume
     FROM workouts ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 3`
  );

  return new Response(JSON.stringify({
    envHint: (env.PIN ? "ENV_OK" : "NO_ENV"),   // quick sanity
    counts: { workouts: wCount?.n||0, sets: sCount?.n||0, weighins: bwCount?.n||0 },
    recent: recent.results || []
  }), { headers: { "content-type":"application/json", "cache-control":"no-store" }});
}
