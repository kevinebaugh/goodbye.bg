// GET /api/fetch?url=<link>
// Fetches a public image for the page when a visitor pastes or drops a link.
// Browsers block reading most images on other sites, so the page asks this same-origin
// function instead. Nothing is stored or logged here; the bytes pass straight through.
// Photos from the visitor's device never come here: only links they paste.

const MAX_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const fail = (status, message) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequestGet({ request }) {
  // Only the app itself may use this. Blocks hotlinking and cross-site abuse.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return fail(403, "This endpoint is only for goodbye.bg.");

  let url;
  try { url = new URL(new URL(request.url).searchParams.get("url") || ""); }
  catch { return fail(400, "That is not a valid link."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail(400, "Only http and https links work.");

  let res = await get(url);
  if (res instanceof Response && !res.ok) return fail(502, `The other site answered ${res.status}.`);
  if (!(res instanceof Response)) return res;

  let type = (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();

  // A web page instead of an image: follow its preview image (og:image), one hop only.
  if (type === "text/html") {
    const html = (await res.text()).slice(0, 512 * 1024);
    const found = previewImage(html);
    if (!found) return fail(415, "That page has no image we can find. Try a direct image link.");
    let next;
    try { next = new URL(found, res.url || url); } catch { return fail(415, "That page's image link is broken."); }
    res = await get(next);
    if (!(res instanceof Response)) return res;
    if (!res.ok) return fail(502, `The other site answered ${res.status}.`);
    type = (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  }

  if (!type.startsWith("image/") && type !== "application/octet-stream") return fail(415, "That link is not an image.");
  const len = Number(res.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) return fail(413, "That image is larger than 30 MB.");

  // Count bytes as they pass and stop at the limit, even if the site lied about the size.
  let seen = 0;
  const cap = new TransformStream({
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > MAX_BYTES) ctl.error(new Error("too large"));
      else ctl.enqueue(chunk);
    },
  });

  return new Response(res.body.pipeThrough(cap), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      // If someone opens this URL directly, never let the content run as a page.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function get(url) {
  try {
    return await fetch(url, {
      headers: { Accept: "image/avif,image/webp,image/*,text/html;q=0.5", "User-Agent": "Mozilla/5.0 (compatible; goodbye.bg image fetch)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail(504, "Could not reach that site.");
  }
}

function previewImage(html) {
  for (const re of [
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
  ]) {
    const m = html.match(re);
    if (m) return m[1].replace(/&amp;/g, "&");
  }
  return null;
}
