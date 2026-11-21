// POST /api/crash
// Sent once by the next visit after a tab died mid-photo (iOS kills tabs that run out of memory, and no
// code runs then, so the page leaves a note in localStorage and reports it next time). Stores an anonymous
// data point next to the ratings: which step it died in, the engine, the device kind, how many photos the
// tab had finished and the photo's megapixels. Never the photo, never an IP address, no cookies.

const STEPS = new Set(["load", "model", "retry", "png", "start-failed", "run-failed"]);
const DEVICES = new Set(["ios", "android", "desktop"]);

export async function onRequestPost({ request, env }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response("Only for goodbye.bg.", { status: 403 });
  let b;
  try { b = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const step = STEPS.has(b?.step) ? b.step : "other";
  const engine = b?.engine === "gpu" ? "gpu" : "cpu";
  const dev = DEVICES.has(b?.dev) ? b.dev : "other";
  const done = Math.max(0, Math.min(1000, Number(b?.done) || 0));
  const mp = Math.max(0, Math.min(1000, Number(b?.mp) || 0));
  // For start-failed and run-failed: the engine's error message, shortened. No photo data is in it.
  const error = String(b?.error || "").replace(/https?:\/\/\S+/g, "<url>").slice(0, 160);
  // The page's last steps before it died or failed: step names, timings and sizes. No photo data.
  const trail = String(b?.trail || "").replace(/https?:\/\/\S+/g, "<url>").slice(-2000);
  const point = { blobs: ["crash", engine, step, dev, error, trail], doubles: [done, mp], indexes: ["crash"] };
  if (env.RATINGS) env.RATINGS.writeDataPoint(point);
  else console.log("crash (no RATINGS binding):", JSON.stringify(point));
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
