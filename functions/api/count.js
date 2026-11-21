// /api/count: the global number of finished cut-outs on goodbye.bg.
// POST adds one and returns the new total (every 100th gets confetti in the page). GET returns the total
// and the recent pace, so the footer can tick at a realistic speed. The row also keeps the total from
// 10 to 20 minutes ago for that pace. One number and a timestamp: no photo, no IP address, no cookies.

const WINDOW = 10 * 60 * 1000; // move the pace snapshot forward every 10 minutes
const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ env }) {
  if (!env.COUNTER) return json({ n: 0, perMin: 0 });
  const row = await env.COUNTER.prepare("SELECT n, n_prev, t_prev FROM counter WHERE id = 1").first();
  const n = row?.n || 0, mins = row?.t_prev ? (Date.now() - row.t_prev) / 60000 : 0;
  // Cut-outs per minute since the snapshot. It falls on its own when nobody is using the site.
  const perMin = mins > 0.5 ? Math.max(0, (n - row.n_prev) / mins) : 0;
  return json({ n, perMin: Math.round(perMin * 100) / 100 });
}

export async function onRequestPost({ request, env }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response("Only for goodbye.bg.", { status: 403 });
  if (!env.COUNTER) return json({ n: 0, confetti: false });
  const now = Date.now();
  const row = await env.COUNTER.prepare(
    `UPDATE counter SET n = n + 1,
       n_prev = CASE WHEN ?1 - t_prev > ?2 THEN n ELSE n_prev END,
       t_prev = CASE WHEN ?1 - t_prev > ?2 THEN ?1 ELSE t_prev END
     WHERE id = 1 RETURNING n`).bind(now, WINDOW).first();
  const n = row?.n || 0;
  return json({ n, confetti: n > 0 && n % 100 === 0 });
}
