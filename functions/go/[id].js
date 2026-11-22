// GET /go/<partner>: counts the click on the ad card (partner, device kind, country; no IP, no cookies)
// and sends the visitor on to that partner's affiliate link. POST /go/<partner> counts that the card was shown.
import { PARTNERS, capLink } from "../../lib/partners.mjs";
import { KEY } from "../api/cap/[key].js";
import { isTest } from "../../lib/test-traffic.mjs";
import { crossSite, device } from "../../lib/request.mjs";

function log(env, kind, id, v, request) {
  if (isTest(request)) return; // a test visit (lib/test-traffic.mjs): still redirected, not counted
  const q = new URL(request.url).searchParams;
  const l = q.get("l") === "sponsored" ? "sponsored" : "ad"; // label test
  const c = String(q.get("c") || "").replace(/[^a-z0-9-]/g, "").slice(0, 20); // button-wording test
  env.RATINGS?.writeDataPoint({ blobs: [kind, id, device(request), request.cf?.country || "", v, l, c], doubles: [1], indexes: [kind] });
}
// The A/B variant the card showed ("a" is the partner's own line and link).
function variant(p, request) {
  const v = new URL(request.url).searchParams.get("v") || p.v || "a";
  const x = (p.variants || []).find((y) => y.v === v);
  return x ? { v, url: x.url, product: x.product } : { v, url: p.url, product: p.product };
}

// A Zazzle card was clicked (off with ?zazzlecap=0), so the page is uploading the cut-out to /api/cap/<k>
// while this tab opens. Wait for it (a few seconds at most), then send them to the product with it on.
// If it never arrives, or the product has no template yet, they get the usual page.
async function capTarget(p, x, request, env) {
  const k = new URL(request.url).searchParams.get("k");
  if (!k || !KEY.test(k) || !env.CAP) return null;
  const image = `${new URL(request.url).origin}/cap/${k}.png`;
  if (!capLink(p, x.product, image)) return null; // no template for this product yet: don't wait
  const until = Date.now() + 10_000;
  while (!(await env.CAP.head(`cap/${k}.png`))) {
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return capLink(p, x.product, image);
}

export async function onRequestGet({ params, env, request }) {
  const p = PARTNERS.find((x) => x.id === params.id);
  if (!p) return Response.redirect(new URL("/", request.url), 302);
  const x = variant(p, request);
  let cap = null;
  try { cap = await capTarget(p, x, request, env); } catch {}
  try { log(env, "adclick", p.id, x.v, request); } catch {}
  if (cap) try { log(env, "adcap", p.id, x.v, request); } catch {} // the click also sent the cut-out
  // Before the affiliate link exists (testing with ?adtest=1) the card goes to the partner's home page.
  return new Response(null, { status: 302, headers: { Location: cap || x.url || p.url || p.home, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function onRequestPost({ params, env, request }) {
  if (crossSite(request)) return new Response(null, { status: 403 });
  const p = PARTNERS.find((x) => x.id === params.id);
  if (p) try { log(env, "adseen", p.id, variant(p, request).v, request); } catch {}
  return new Response(null, { status: 204 });
}
