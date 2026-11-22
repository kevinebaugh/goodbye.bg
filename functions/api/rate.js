// POST /api/rate
// A thumbs up or down on one result. Stores an anonymous data point: the vote, which engine
// ran, whether it was a retry, the run time and the photo's size in megapixels.
// Never the photo, never an IP address, no cookies.

import { isTest } from "../../lib/test-traffic.mjs";

const ok = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response("Only for goodbye.bg.", { status: 403 });
  let b;
  try { b = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
  if (isTest(request, b)) return ok(); // a test visit (lib/test-traffic.mjs): not counted
  const vote = b?.vote === "up" || b?.vote === "down" ? b.vote : null;
  if (!vote) return new Response("Bad request", { status: 400 });
  const engine = ["gpu", "gpu-birefnet"].includes(b.engine) ? b.engine : "cpu";
  const ms = Math.max(0, Math.min(600_000, Number(b.ms) || 0));
  const mp = Math.max(0, Math.min(1000, Number(b.mp) || 0));
  const point = { blobs: [vote, engine, b.retry ? "retry" : "first"], doubles: [ms, mp], indexes: [vote] };
  if (env.RATINGS) env.RATINGS.writeDataPoint(point);
  else console.log("rating (no RATINGS binding):", JSON.stringify(point));
  return ok();
}
