// Runs before the first paint. When photos were kept on this device, the page starts in its "with photos" layout and
// keeps the grid and footer out of sight until the cards are measured (app.js lifts "restoring"), so it doesn't paint
// the big landing first and then rearrange (Kevin, 2026-11-21: jitter on load). The hint is only a count, set by app.js.
try {
  if (+localStorage.getItem("gb-kept") > 0) {
    document.body.classList.add("has-work", "restoring");
    // Kept photos bring their ad cards straight back: fetch the 3D code now, so the products are drawn sooner.
    const l = document.createElement("link"); l.rel = "modulepreload"; l.href = "render3d.mjs"; document.head.append(l);
    setTimeout(() => document.body.classList.remove("restoring"), 1500); // never hide the page for long, whatever happens
  }
} catch {}

// No pinch-zoom on the app page (Kevin, 2026-11-22). Safari ignores touch-action for pinch, so stop its gesture events.
for (const t of ["gesturestart", "gesturechange"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });

// Language: the browser's first listed language we have (English when English comes first), ?lang=xx to test.
// No switcher and nothing stored. The build puts src/i18n.js in place of the line below (as `const LANGS = ...`).
/*%I18N%*/
(() => {
  const all = typeof LANGS === "object" ? LANGS : {};
  let lang = "en";
  try {
    const q = new URLSearchParams(location.search).get("lang");
    for (const l of q ? [q] : navigator.languages?.length ? navigator.languages : [navigator.language || "en"]) {
      const s = String(l).toLowerCase(), k = s.startsWith("pt") ? "pt-BR" : s.split("-")[0];
      if (k === "en") break;
      if (all[k]) { lang = k; break; }
    }
  } catch {}
  const L = all[lang] || {}, dict = L.t || {};
  const t = (s, v) => { const out = dict[s] ?? s; return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out; };
  self.GB = { lang, t, quips: L.quips || null, path: L.path || "" };
  if (lang === "en") return;
  document.documentElement.lang = lang;
  document.title = t(document.title);
  // index.html marks what to translate: data-t (the text; "html" when it holds a <br>), data-t-title, data-t-aria,
  // data-t-href (a link to a text page: the translated one). This script runs at the top of <body>, so it translates
  // each element as the parser finishes it, before it is painted (mutation callbacks run before rendering). An element
  // the parser may still be filling (on the path of last children) waits for the next round.
  const done = new WeakSet();
  const one = (el) => {
    if (done.has(el)) return; done.add(el);
    const d = el.dataset;
    if (d.t === "html") el.innerHTML = t(el.innerHTML.trim());
    else if (d.t !== undefined) el.textContent = t(el.textContent.trim());
    if (d.tTitle !== undefined) el.title = t(el.title);
    if (d.tAria !== undefined) el.setAttribute("aria-label", t(el.getAttribute("aria-label")));
    if (d.tHref !== undefined && L.path) el.setAttribute("href", `${L.path}/${el.getAttribute("href")}`);
  };
  const sweep = (final) => {
    const open = new Set();
    if (!final) for (let n = document.documentElement; n; n = n.lastChild) open.add(n);
    for (const el of document.querySelectorAll("[data-t], [data-t-title], [data-t-aria], [data-t-href]")) if (!open.has(el)) one(el);
  };
  const mo = new MutationObserver(() => sweep(false));
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => { mo.disconnect(); sweep(true); }, { once: true });
})();
