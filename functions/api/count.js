// POST /api/count
// Adds one to the global count of finished cut-outs and returns the new total. Every 100th gets
// confetti in the page. Stores one number and nothing else: no photo, no IP address, no cookies.

const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response("Only for goodbye.bg.", { status: 403 });
  if (!env.COUNTER) return json({ n: 0, confetti: false });
  const row = await env.COUNTER.prepare("UPDATE counter SET n = n + 1 WHERE id = 1 RETURNING n").first();
  const n = row?.n || 0;
  return json({ n, confetti: n > 0 && n % 100 === 0 });
}
