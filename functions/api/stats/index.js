// GET /api/stats/overview?days=30
// -> { byDay:[{day, volume,total_sets,workouts}], bodyweight:[{at,tod,weight,unit}] }
export async function onRequestGet({ env, request }) {
  const u = new URL(request.url);
  const days = Math.min(365, Number(u.searchParams.get('days') || 30));
  const since = Date.now() - days*86400000;

  const byDay = await env.DB.prepare(
    `WITH d AS (
       SELECT date(COALESCE(ended_at, started_at)/1000,'unixepoch') AS day,
              SUM(total_volume) AS volume,
              SUM(total_sets)   AS total_sets,
              COUNT(*)          AS workouts
       FROM workouts
       WHERE COALESCE(ended_at, started_at) >= ?
       GROUP BY day
     )
     SELECT day,
            COALESCE(volume,0)     AS volume,
            COALESCE(total_sets,0) AS total_sets,
            workouts
     FROM d ORDER BY day ASC`
  ).bind(since).all();

  const bodyweight = await env.DB.prepare(
    `SELECT at, tod, weight, unit
       FROM weighins WHERE at >= ?
       ORDER BY at ASC`
  ).bind(since).all();

  return json({
    byDay: byDay.results || [],
    bodyweight: bodyweight.results || []
  });
}

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{ 'content-type':'application/json','cache-control':'no-store' }}) }

