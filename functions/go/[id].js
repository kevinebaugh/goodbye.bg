// GET /go/<partner>: counts the click on the ad card (partner, device kind, country; no IP, no cookies)
// and sends the visitor on to that partner's affiliate link. POST /go/<partner> counts that the card was shown.
import { PARTNERS } from "../../lib/partners.mjs";

function device(request) {
  const ua = request.headers.get("User-Agent") || "";
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Macintosh|Windows|Linux|CrOS/.test(ua) ? "desktop" : "other";
}
function log(env, kind, id, v, request) {
  env.RATINGS?.writeDataPoint({ blobs: [kind, id, device(request), request.cf?.country || "", v], doubles: [1], indexes: [kind] });
}
// The A/B variant the card showed ("a" is the partner's own line and link).
function variant(p, request) {
  const v = new URL(request.url).searchParams.get("v") || "a";
  const x = (p.variants || []).find((y) => y.v === v);
  return x ? { v, url: x.url } : { v: "a", url: p.url };
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
