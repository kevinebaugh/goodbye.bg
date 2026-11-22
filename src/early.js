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
