// Service worker: only catches photos shared to goodbye.bg from the Android share sheet.
// The shared files go into a local cache, never to a server, and the page picks them up.
// Every other request passes through untouched.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "POST" || url.pathname !== "/share") return;
  e.respondWith((async () => {
    const form = await e.request.formData();
    const cache = await caches.open("share-inbox");
    const files = form.getAll("images").filter((f) => f instanceof File);
    await Promise.all(files.map((f, i) => cache.put(`/share-inbox/${Date.now()}-${i}`,
      new Response(f, { headers: { "Content-Type": f.type, "X-Name": encodeURIComponent(f.name) } }))));
    const text = ["url", "text"].map((k) => form.get(k)).filter(Boolean).join(" ");
    if (text) await cache.put("/share-inbox/text", new Response(text));
    return Response.redirect("/?share=1", 303);
  })());
});
