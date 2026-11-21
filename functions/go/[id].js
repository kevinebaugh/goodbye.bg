// GET /go/<partner>: counts the click on the ad card (partner, device kind, country; no IP, no cookies)
// and sends the visitor on to that partner's affiliate link. POST /go/<partner> counts that the card was shown.
import { PARTNERS } from "../../lib/partners.mjs";

function device(request) {
  const ua = request.headers.get("User-Agent") || "";
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Macintosh|Windows|Linux|CrOS/.test(ua) ? "desktop" : "other";
}
function log(env, kind, id, v, request) {
  const q = new URL(request.url).searchParams;
  const l = q.get("l") === "sponsored" ? "sponsored" : "ad"; // label test
  const c = String(q.get("c") || "").replace(/[^a-z0-9-]/g, "").slice(0, 20); // button-wording test
  env.RATINGS?.writeDataPoint({ blobs: [kind, id, device(request), request.cf?.country || "", v, l, c], doubles: [1], indexes: [kind] });
}
// The A/B variant the card showed ("a" is the partner's own line and link).
function variant(p, request) {
  const v = new URL(request.url).searchParams.get("v") || p.v || "a";
  const x = (p.variants || []).find((y) => y.v === v);
  return x ? { v, url: x.url } : { v, url: p.url };
}

export async function onRequestGet({ params, env, request }) {
  const p = PARTNERS.find((x) => x.id === params.id);
  if (!p) return Response.redirect(new URL("/", request.url), 302);
  const x = variant(p, request);
  try { log(env, "adclick", p.id, x.v, request); } catch {}
  // Before the affiliate link exists (testing with ?adtest=1) the card goes to the partner's home page.
  return new Response(null, { status: 302, headers: { Location: x.url || p.url || p.home, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function onRequestPost({ params, env, request }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response(null, { status: 403 });
  const p = PARTNERS.find((x) => x.id === params.id);
  if (p) try { log(env, "adseen", p.id, variant(p, request).v, request); } catch {}
  return new Response(null, { status: 204 });
}
