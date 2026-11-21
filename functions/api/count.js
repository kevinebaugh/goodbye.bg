// POST /api/count
// Adds one to the global count of finished cut-outs and returns the new total. Every 100th gets
// confetti in the page. Stores one number and nothing else: no photo, no IP address, no cookies.

const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// GET: the current total, for the live count in the footer.
export async function onRequestGet({ env }) {
  if (!env.COUNTER) return json({ n: 0 });
  const row = await env.COUNTER.prepare("SELECT n FROM counter WHERE id = 1").first();
  return json({ n: row?.n || 0 });
}

export async function onRequestPost({ request, env }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response("Only for goodbye.bg.", { status: 403 });
  if (!env.COUNTER) return json({ n: 0, confetti: false });
  const row = await env.COUNTER.prepare("UPDATE counter SET n = n + 1 WHERE id = 1 RETURNING n").first();
  const n = row?.n || 0;
  return json({ n, confetti: n > 0 && n % 100 === 0 });
}
