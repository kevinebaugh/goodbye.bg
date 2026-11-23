// POST /api/rate
// A thumbs up or down on one result, on the page's translation (kind "lang"), or how a photo went (kind "stat"). Stores an anonymous data point: the vote, which engine
// ran, whether it was a retry, the run time and the photo's size in megapixels.
// Never the photo, never an IP address, no cookies.

import { isTest } from "../../lib/test-traffic.mjs";
import { crossSite, device, engineOf } from "../../lib/request.mjs";

const ok = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (crossSite(request)) return new Response("Only for goodbye.bg.", { status: 403 });
  let b;
  try { b = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
  if (isTest(request, b)) return ok(); // a test visit (lib/test-traffic.mjs): not counted
  // How a photo went (app.js stat()): blob1 what, blob2 engine, blob3 first/next (the visit's first photo waits for the
  // model download), blob4 device; double1 the model's ms, double2 ms from adding the photo to its result, double3
  // megapixels (for "saveall", how many photos).
  if (b?.kind === "stat") {
    const what = ["done", "failed", "nosubject", "save", "saveall"].includes(b.what) ? b.what : null;
    if (!what) return new Response("Bad request", { status: 400 });
    const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
    const point = { blobs: [what, engineOf(b.engine), b.first ? "first" : "next", device(request)], doubles: [num(b.ms, 600_000), num(b.wait, 3_600_000), num(b.mp, 1000)], indexes: ["stat"] };
    if (env.RATINGS) env.RATINGS.writeDataPoint(point);
    else console.log("stat (no RATINGS binding):", JSON.stringify(point));
    return ok();
  }
  const vote = b?.vote === "up" || b?.vote === "down" ? b.vote : null;
  if (!vote) return new Response("Bad request", { status: 400 });
  // A vote on the translation (the footer, other languages only): blob1 tr-up/tr-down, blob2 the language.
  if (b.kind === "lang") {
    const lang = ["de", "es", "fr", "pt-BR", "id"].includes(b.lang) ? b.lang : null;
    if (!lang) return new Response("Bad request", { status: 400 });
    env.RATINGS?.writeDataPoint({ blobs: [`tr-${vote}`, lang], doubles: [1], indexes: ["tr"] });
    return ok();
  }
  const engine = engineOf(b.engine);
  const ms = Math.max(0, Math.min(600_000, Number(b.ms) || 0));
  const mp = Math.max(0, Math.min(1000, Number(b.mp) || 0));
  const point = { blobs: [vote, engine, b.retry ? "retry" : "first"], doubles: [ms, mp], indexes: [vote] };
  if (env.RATINGS) env.RATINGS.writeDataPoint(point);
  else console.log("rating (no RATINGS binding):", JSON.stringify(point));
  return ok();
}
