// Service worker: the Android share target, and goodbye.bg offline once it has been used.
// Everything stays on the device: shared photos go into a local cache, never to a server, and the page picks them up.
//
// Offline, without changing anything online:
// - The page and its scripts (the "shell") are fetched from the network first, as without this worker, so a deploy is
//   live at once and freshen() in app.js never loops. A copy of each build's shell is kept for when the network fails.
//   The build lists every shell file with a hash: an update copies the files that didn't change and refetches the rest,
//   so a deploy never mixes two builds' files offline and never downloads the unchanged ones again.
// - The runtime (rt/<version>/) and the models (m/<name>/) never change at a URL, so they come from the cache first.
//   They are kept on use, one cache per version; an update deletes old versions. Downloads here skip the HTTP cache,
//   so the 116 MB are stored once. Parts the engine fetched before this worker was in charge (a first visit) are
//   fetched once more after the engine is done, so the set is whole offline.
// - /api/, /go/, /cap/, /version.txt and anything not GET go straight to the network, never into a cache.
// COOP/COEP come with the stored responses (they are the server's own headers), so the page stays cross-origin
// isolated offline and the CPU engine keeps its threads.

const CONFIG = "%SW%"; // set by scripts/build.mjs: { build, shell: { path: hash }, eager: [path], big: { prefix: { cache, files } } }
const C = typeof CONFIG === "object" ? CONFIG : null;
const OWN = "gb-"; // our caches; anything else (share-inbox) is never touched here
const SHELL = C && OWN + "shell-" + C.build;
const PAGES = OWN + "pages"; // other pages of the site (remove-bg-alternative, ...), kept as visited
const key = (path) => `${path}?v=${C.shell[path]}`;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (C) e.waitUntil(fillShell().catch(() => {})); // never fails the install: the share target must keep working
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  await self.clients.claim();
  if (!C) return;
  const keep = new Set([SHELL, PAGES, ...Object.values(C.big).map((b) => b.cache)]);
  for (const name of await caches.keys()) if (name.startsWith(OWN) && !keep.has(name)) await caches.delete(name);
})()));

// The new build's shell: unchanged files from the old copy, changed ones fetched if the old copy had them (they were
// used), and the page's own files (eager) always. The rest is kept when first used.
async function fillShell() {
  const cache = await caches.open(SHELL), olds = [];
  for (const name of await caches.keys()) if (name.startsWith(OWN + "shell-") && name !== SHELL) olds.push(await caches.open(name));
  const had = new Set();
  for (const old of olds) for (const r of await old.keys()) had.add(new URL(r.url).pathname);
  await Promise.all(Object.keys(C.shell).map(async (path) => {
    if (await cache.match(key(path))) return;
    for (const old of olds) { const hit = await old.match(key(path)); if (hit) return cache.put(key(path), hit); }
    if (C.eager.includes(path) || had.has(path)) await store(cache, path);
  }));
}
async function store(cache, path) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (keepable(res)) await cache.put(key(path), res);
  } catch {}
}
const keepable = (res) => res && res.ok && res.type === "basic" && !res.redirected; // a redirect can't answer a navigation

// Once the engine is loading, the visitor is using the app: keep the modules it loads only when needed (GIFs, HEIC,
// TIFF and RAW, product previews, zips), so those work offline too. About 2.5 MB next to the model's 88 to 93 MB.
let warmed = false;
async function warm() {
  if (warmed) return; warmed = true;
  const cache = await caches.open(SHELL);
  for (const path of Object.keys(C.shell)) if (!(await cache.match(key(path)))) await store(cache, path);
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/share") return e.respondWith(share(req));
  if (!C || req.method !== "GET" || url.origin !== location.origin) return;
  const path = url.pathname;
  if (/^\/(api|go|cap|share-inbox)\//.test(path) || path === "/version.txt" || path === "/sw.js" || path === "/ad.html") return;
  const prefix = Object.keys(C.big).find((p) => path.startsWith(p));
  if (prefix) {
    if (req.headers.has("range")) return;
    e.waitUntil(warm().catch(() => {}));
    e.waitUntil(whole(prefix, path.slice(prefix.length)));
    return e.respondWith(fromBig(req, prefix, e));
  }
  if (path.startsWith("/rt/") || path.startsWith("/m/")) return; // another build's version: straight to the network
  const shellPath = req.mode === "navigate" && path === "/" ? "/" : C.shell[path] && path;
  if (shellPath) return e.respondWith(fromShell(e, shellPath));
  if (req.mode === "navigate") return e.respondWith(fromPage(e));
});

// Shared photos (Android share sheet, once installed): kept in a local cache for the page, then the page opens.
async function share(req) {
  const form = await req.formData();
  const cache = await caches.open("share-inbox");
  const files = form.getAll("images").filter((f) => f instanceof File);
  await Promise.all(files.map((f, i) => cache.put(`/share-inbox/${Date.now()}-${i}`,
    new Response(f, { headers: { "Content-Type": f.type, "X-Name": encodeURIComponent(f.name) } }))));
  const text = ["url", "text"].map((k) => form.get(k)).filter(Boolean).join(" ");
  if (text) await cache.put("/share-inbox/text", new Response(text));
  return Response.redirect("/?share=1", 303);
}

// Network first; the kept copy when the network fails. Online this is what the page got without a worker.
async function fromShell(e, path) {
  try {
    const res = await fetch(e.request);
    if (keepable(res)) e.waitUntil(caches.open(SHELL).then(async (c) => { if (!(await c.match(key(path)))) await c.put(key(path), res.clone()); }).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await caches.match(key(path), { cacheName: SHELL });
    if (hit) return hit;
    throw err;
  }
}
async function fromPage(e) {
  const url = new URL(e.request.url), k = url.origin + url.pathname;
  try {
    const res = await fetch(e.request);
    if (keepable(res)) e.waitUntil(caches.open(PAGES).then((c) => c.put(k, res.clone())).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await caches.match(k, { cacheName: PAGES });
    if (hit) return hit;
    throw err;
  }
}

// Runtime and models: the kept copy, else the network without writing the HTTP cache. Streamed through; a full disk
// never fails the response.
const putting = new Set();
async function fromBig(req, prefix, e) {
  const cache = await caches.open(C.big[prefix].cache);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req.url, { cache: "no-store" });
  if (keepable(res)) {
    putting.add(req.url);
    e.waitUntil(cache.put(req.url, res.clone()).catch(() => {}).finally(() => { putting.delete(req.url); whole(prefix); }));
  }
  return res;
}

// Parts the engine fetched before this worker was in charge (a first visit where the model starts at once) went past
// it. 5 s after the last part through here has finished, fetch those: the numbered parts below the first one this
// worker saw, the manifests and the small runtime modules. Never parts the engine hasn't reached (the GPU gate can stop
// BiRefNet halfway), and only folders the engine asked for.
const quiet = {};
const partNo = (f) => { const m = f.match(/^(.*?)(\d+)\.bin$/); return m && { dir: m[1], n: +m[2] }; };
function whole(prefix, rel) {
  const q = quiet[prefix] ||= { done: null, first: {} };
  const part = rel && partNo(rel);
  if (part) q.first[part.dir] = Math.min(q.first[part.dir] ?? Infinity, part.n);
  clearTimeout(q.timer);
  q.done ||= new Promise((ok) => (q.ok = ok));
  q.timer = setTimeout(async function fire() {
    if ([...putting].some((u) => new URL(u).pathname.startsWith(prefix))) { q.timer = setTimeout(fire, 5000); return; }
    const { ok } = q; q.done = null;
    try {
      const cache = await caches.open(C.big[prefix].cache);
      for (const f of C.big[prefix].files) {
        const p = partNo(f);
        if (p ? !(p.n < (q.first[p.dir] ?? 0)) : !/(^|\/)manifest\.json$|\.mjs$/.test(f)) continue;
        const url = new URL(prefix + f, location.origin).href;
        if (putting.has(url) || await cache.match(url)) continue;
        const res = await fetch(url, { cache: "no-store" });
        if (keepable(res)) await cache.put(url, res);
      }
    } catch {}
    ok();
  }, 5000);
  return q.done;
}
