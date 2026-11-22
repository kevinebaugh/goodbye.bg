// GET /cap/<key>.png   (prototype, only used with ?zazzlecap=1)
// Serves a cut-out the visitor chose to send to Zazzle, so Zazzle's server can fetch it. Zazzle copies the image
// the moment the link opens (tested 2026-11-21: the product page comes back with Zazzle's own image ID), so our copy
// is deleted 20 s after the first full fetch (a little slack for a retry). Never fetched: gone after the TTL (an
// expired one is deleted when asked for, or on the next send; an R2 lifecycle rule deletes leftovers after a day).
// Not logged, not cached by Cloudflare or browsers, not indexed.
import { KEY } from "../api/cap/[key].js";

const gone = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function get({ params, env, request, waitUntil }, head) {
  const m = String(params.file || "").match(/^(.+)\.png$/);
  if (!m || !KEY.test(m[1]) || !env.CAP) return gone();
  const name = `cap/${m[1]}.png`;
  const obj = head ? await env.CAP.head(name) : await env.CAP.get(name);
  if (!obj) return gone();
  if (Date.now() > Number(obj.customMetadata?.exp || 0)) { await env.CAP.delete(name); return gone(); }
  if (!head && waitUntil) waitUntil(new Promise((r) => setTimeout(r, 20_000)).then(() => env.CAP.delete(name)).catch(() => {}));
  return new Response(head ? null : obj.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(obj.size),
      "Cache-Control": "no-store",
      // Zazzle's server fetches it; a browser preview on zazzle.com may too.
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const onRequestGet = (ctx) => get(ctx, false);
export const onRequestHead = (ctx) => get(ctx, true);
