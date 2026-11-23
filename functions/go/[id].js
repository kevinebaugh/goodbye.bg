// GET /go/<partner>: counts the click on the ad card (partner, device kind, country; no IP, no cookies)
// and sends the visitor on to that partner's affiliate link. POST /go/<partner> counts that the card was shown.
import { PARTNERS, capLink } from "../../lib/partners.mjs";
import { KEY } from "../api/cap/[key].js";
import { isTest } from "../../lib/test-traffic.mjs";
import { crossSite, device } from "../../lib/request.mjs";
import { LANGS } from "../../src/i18n.js";

// While the photo travels to Zazzle the new tab shows a tiny page instead of a blank one (Kevin, 2026-11-22: "Loop it
// through a few redirect messages to keep the whimsy"). No script: CSS loops the messages, and a refresh after a
// second loads this same link with w=1, which waits for the upload and redirects; the browser keeps showing this
// page until Zazzle answers.
const GO_EN = ["Packing your photo…", "Hailing a delivery van…", "Taking the scenic route…", "Warming up the printers…", "Almost there…"];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function waitPage(url) {
  const lang = url.searchParams.get("lang"), lines = LANGS[lang]?.goQuips || GO_EN, n = lines.length, step = 1.6;
  const next = new URL(url); next.searchParams.set("w", "1");
  const spans = lines.map((t, i) => `<span style="animation-delay:${(i * step).toFixed(1)}s">${esc(t)}</span>`).join("");
  return new Response(`<!doctype html><html lang="${LANGS[lang] ? esc(lang) : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>goodbye.bg</title>
<meta http-equiv="refresh" content="1;url=${esc(next.pathname + next.search)}">
<style>
:root{color-scheme:light dark;--paper:#f7f8f0;--ink:#1d3a41;--muted:#5b7377}
@media (prefers-color-scheme:dark){:root{--paper:#0e262b;--ink:#e8f1ef;--muted:#9bb5b4}}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:var(--paper);color:var(--ink);font:700 20px/1.3 ui-rounded,"Nunito",system-ui,sans-serif;text-align:center}
.w{font-size:48px;display:inline-block;transform-origin:70% 70%;animation:wave 1.4s ease-in-out infinite}
@keyframes wave{0%,60%,100%{transform:rotate(0)}15%,45%{transform:rotate(16deg)}30%{transform:rotate(-8deg)}}
.m{position:relative;height:1.4em;margin-top:14px;width:90vw}
.m span{position:absolute;inset:0;opacity:0;animation:say ${(n * step).toFixed(1)}s infinite}
@keyframes say{0%{opacity:0;transform:translateY(6px)}4%,${Math.round(100 / n) - 4}%{opacity:1;transform:none}${Math.round(100 / n)}%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.w,.m span{animation:none}.m span:first-child{opacity:1}}
</style></head><body><div><span class="w" aria-hidden="true">👋</span><p class="m" role="status">${spans}</p></div></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff" },
  });
}

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

// A Zazzle card was clicked (off with ?zazzlecap=0), so the page is uploading the photo to /api/cap/<k>
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
  // A click that is sending the photo: show the waiting page first, then come back with w=1 to wait and redirect.
  const url = new URL(request.url), k = url.searchParams.get("k");
  if (k && KEY.test(k) && !url.searchParams.has("w") && env.CAP && capLink(p, x.product, `${url.origin}/cap/${k}.png`)) return waitPage(url);
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
