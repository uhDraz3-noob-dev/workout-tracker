
// GET  /api/weighins?days=90
// POST /api/weighins { at?, tod:'AM'|'PM', weight, unit? }
export async function onRequestGet({ env, request }) {
  const u = new URL(request.url);
  const days = Math.min(365, Number(u.searchParams.get('days') || 90));
  const since = Date.now() - days*86400000;

  const rows = await env.DB.prepare(
    `SELECT id, at, day, tod, weight, unit
       FROM weighins WHERE at >= ?
       ORDER BY at ASC`
  ).bind(since).all();

  return json(rows.results || []);
}

export async function onRequestPost({ env, request }) {
  const b = await safeJson(request);
  if (!b?.tod || !b?.weight) return json({ ok:false, error:"tod and weight required" }, 400);

  const at  = Number(b.at || Date.now());
  const day = new Date(at).toISOString().slice(0,10); // 'YYYY-MM-DD'
  const id  = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO weighins (id, at, day, tod, weight, unit)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, tod) DO UPDATE SET
       at=excluded.at, weight=excluded.weight, unit=excluded.unit`
  ).bind(id, at, day, b.tod, Number(b.weight), b.unit || 'kg').run();

  return json({ ok:true, id }, 200);
}

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{ 'content-type':'application/json','cache-control':'no-store' }}) }
async function safeJson(req){ try { return await req.json(); } catch { return {}; } }
