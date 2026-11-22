// PUT /api/cap/<key>   (a Zazzle ad card click; off with ?zazzlecap=0)
// The visitor clicked a Zazzle product card: the page puts that one cut-out here so Zazzle can
// fetch it from /cap/<key>.png and show it on the product. Nothing else ever comes here.
// Stored in R2 (binding CAP), deleted after TTL_MS. No IP, no cookies, no identifiers: the key is a random
// 128-bit name the page made for this one click and never reuses.
import { crossSite, fail } from "../../../lib/request.mjs";

export const TTL_MS = 60 * 60 * 1000; // 1 hour. Whether Zazzle copies the image or keeps fetching it is not known yet (docs/zazzle-cap.md)
export const MAX_BYTES = 20 * 1024 * 1024;
export const KEY = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function onRequestPut({ request, env, params, waitUntil }) {
  // Only the app itself may upload. Browsers send Sec-Fetch-Site; older ones at least send Origin.
  const site = request.headers.get("Sec-Fetch-Site"), origin = request.headers.get("Origin");
  if (crossSite(request)) return fail(403, "Only for goodbye.bg.");
  if (!site && origin && origin !== new URL(request.url).origin) return fail(403, "Only for goodbye.bg.");
  if (!env.CAP) return fail(503, "Not set up.");
  const key = String(params.key || "");
  if (!KEY.test(key)) return fail(400, "Bad key.");
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim() !== "image/png") return fail(415, "PNG only.");
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) return fail(413, "Too large.");

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return fail(413, "Too large.");
  if (body.byteLength < 64 || PNG.some((b, i) => body[i] !== b)) return fail(415, "PNG only.");
  // Never overwrite: a key is used once.
  const put = await env.CAP.put(`cap/${key}.png`, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/png" },
    customMetadata: { exp: String(Date.now() + TTL_MS) },
  });
  if (!put) return fail(409, "Key taken.");
  // Delete anything past its TTL now, so no cut-out outlives it by more than the time to the next send.
  // (An R2 lifecycle rule on cap/ deletes leftovers after a day if nobody sends anything.)
  const sweep = async () => {
    const list = await env.CAP.list({ prefix: "cap/", limit: 1000, include: ["customMetadata"] });
    const old = list.objects.filter((o) => Date.now() > Number(o.customMetadata?.exp || 0)).map((o) => o.key);
    if (old.length) await env.CAP.delete(old);
  };
  try { waitUntil ? waitUntil(sweep().catch(() => {})) : await sweep(); } catch {}
  return new Response(null, { status: 201, headers: { "Cache-Control": "no-store" } });
}
