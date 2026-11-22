// goodbye.bg: the cut-out editor (docs/mask-edit.md). Loaded the first time a finished cut-out is tapped.
// It takes the grid's place: the photo on a stage, the tools in one bar under it (nothing sits on the image).
// Pieces: a tap drops a kept piece or brings back a dropped one. Erase and Restore: a round brush. Undo, Done.
// Works on the mask only, at the photo's proportions (long side at most 2048 px); Download scales it up as before.

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const KEEP = 64;            // a piece is pixels at least this opaque (despeck in app.js counts pieces the same way)
const SEED = 31, GROW = 13; // bringing back: the tap must land on a pixel the model gave 0.12, growth goes through 0.05
const GAP = 3;              // a brought-back piece stays this far from the kept subject, then grows back over the gap
const MOST = 0.4;           // a tap may change at most this much of the photo
const ZOOM = 12;            // closest zoom, times the fitted size

let cssReady = null;
const css = () => (cssReady ||= new Promise((res) => {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "edit.css";
  l.onload = l.onerror = () => res(); document.head.append(l);
}));

const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  tap: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3.2"/>'),
  erase: svg('<path d="M14.5 4.5 20 10l-8.5 8.5H7l-3-3a1.5 1.5 0 0 1 0-2.1z"/><path d="m9 10 5.5 5.5"/><path d="M12 20.5h8"/>'),
  restore: svg('<path d="M20.5 3.5 11 13"/><path d="M11 13c-2.6-1.2-5.2.4-5.2 3 0 1.9-1 3.1-2.8 4 4.4.9 9.6-.3 9.6-4.4z" fill="currentColor"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
};

export async function openEditor(it, api) {
  await css();
  const { RES } = api;
  const t = api.t || ((x, v) => (v ? x.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m) : x)); // GB.t from app.js (src/i18n.js)
  const esc = (x) => String(x).replace(/[<>&"]/g, "");
  // The mask, at the photo's proportions: square pixels, so a round brush is round.
  const L = Math.min(api.small ? 1600 : 2048, Math.max(it.w, it.h)), k = L / Math.max(it.w, it.h);
  const W = Math.max(1, Math.round(it.w * k)), H = Math.max(1, Math.round(it.h * k)), N = W * H;
  const mc = new OffscreenCanvas(W, H), mx = mc.getContext("2d", { willReadFrequently: true });
  const r = it.maskRect || FULL;
  mx.imageSmoothingQuality = "high";
  mx.drawImage(it.mask, r.x * W, r.y * H, r.w * W, r.h * H);
  const mid = mx.getImageData(0, 0, W, H), md = mid.data, A = new Uint8Array(N);
  for (let i = 0; i < N; i++) { A[i] = md[i * 4 + 3]; md[i * 4] = md[i * 4 + 1] = md[i * 4 + 2] = 255; }
  mx.putImageData(mid, 0, 0);
  const A0 = A.slice();
  // What the model was unsure about (its raw output), sampled to the same grid. Photos kept before this have none.
  let U = null;
  if (it.mask.raw && !it.maskRect) try {
    const { w: rw, h: rh, z } = it.mask.raw, raw = api.inflateSync(z);
    U = new Uint8Array(N);
    const xs = new Int32Array(W); for (let x = 0; x < W; x++) xs[x] = Math.min(rw - 1, (((x + 0.5) / W) * rw) | 0);
    for (let y = 0; y < H; y++) { const o = Math.min(rh - 1, (((y + 0.5) / H) * rh) | 0) * rw, q = y * W; for (let x = 0; x < W; x++) U[q + x] = raw[o + xs[x]]; }
  } catch (e) { console.warn("Raw output unreadable", e); U = null; }
  let P = null; // the photo's pixels at the mask's size, for the colour wand (only when needed)
  const photo = () => {
    if (!P) { const c = new OffscreenCanvas(W, H), x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(it.bmp, 0, 0, W, H); P = x.getImageData(0, 0, W, H).data; }
    return P;
  };
  // The cut-out as shown: the photo, kept where the mask is.
  const C = new OffscreenCanvas(W, H), cx = C.getContext("2d");
  const F = new OffscreenCanvas(W, H), fx = F.getContext("2d"); // the one before a change, fading out
  const compose = () => {
    cx.globalCompositeOperation = "copy"; cx.drawImage(it.bmp, 0, 0, W, H);
    cx.globalCompositeOperation = "destination-in"; cx.drawImage(mc, 0, 0);
  };
  compose();

  /* ---------- the view ---------- */
  const el = document.createElement("section");
  el.className = "editor"; el.setAttribute("aria-label", t("Edit {name}", { name: it.name }));
  el.innerHTML = `<div class="estage" data-m="tap"><canvas role="img" aria-label="${esc(t("{name}, editing", { name: it.name }))}"></canvas></div>
<div class="ebar">
  <div class="emodes" role="group" aria-label="${esc(t("Tool"))}">
    <button type="button" class="btn emode" data-m="tap" aria-pressed="true" aria-label="${esc(t("Pieces"))}" title="${esc(t("Pieces"))}">${ICON.tap}<span>${esc(t("Pieces"))}</span></button>
    <button type="button" class="btn emode" data-m="erase" aria-pressed="false" aria-label="${esc(t("Erase"))}" title="${esc(t("Erase"))}">${ICON.erase}<span>${esc(t("Erase"))}</span></button>
    <button type="button" class="btn emode" data-m="restore" aria-pressed="false" aria-label="${esc(t("Restore"))}" title="${esc(t("Restore"))}">${ICON.restore}<span>${esc(t("Restore"))}</span></button>
  </div>
  <div class="eslot">
    <p class="ehint"><span class="long">${esc(t("Tap a piece to drop it or bring it back"))}</span><span class="short">${esc(t("Tap a piece"))}</span></p>
    <label class="esize" hidden><span class="edot"></span><input type="range" min="6" max="120" value="36" aria-label="${esc(t("Brush size"))}"></label>
  </div>
  <button type="button" class="btn eundo" aria-label="${esc(t("Undo"))}" title="${esc(t("Undo"))}" disabled>${ICON.undo}<span>${esc(t("Undo"))}</span></button>
  <button type="button" class="btn primary edone">${esc(t("Done"))}</button>
</div>`;
  const stage = el.querySelector(".estage"), cv = stage.querySelector("canvas"), ctx = cv.getContext("2d");
  const undoB = el.querySelector(".eundo"), doneB = el.querySelector(".edone"), size = el.querySelector(".esize input");
  const main = document.getElementById("main");
  main.append(el);
  document.body.classList.add("editing");
  if (api.kbd) el.querySelector(".edone").focus({ preventScroll: true }); // opened from the keyboard (the cut-out it came from is hidden now)

  let mode = "tap", cw = 0, ch = 0, dpr = 1, s = 1, ox = 0, oy = 0, minS = 1, fitted = false;
  let hover = null, flash = 0, ripple = null, raf = 0, spaceHeld = false;
  const brush = () => +size.value;
  const checks = (() => { // the checkerboard under the photo, in the page's colours
    const st = getComputedStyle(document.body), c = document.createElement("canvas"); c.width = c.height = 16;
    const x = c.getContext("2d"); x.fillStyle = st.getPropertyValue("--check-b").trim() || "#fff"; x.fillRect(0, 0, 16, 16);
    x.fillStyle = st.getPropertyValue("--check-a").trim() || "#e1f1f0"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return ctx.createPattern(c, "repeat");
  })();
  const accent = getComputedStyle(document.body).getPropertyValue("--brand").trim() || "#258aa1";

  function fit() {
    const pad = 12;
    minS = Math.min((cw - 2 * pad) / W, (ch - 2 * pad) / H);
    s = minS; ox = (cw - W * s) / 2; oy = (ch - H * s) / 2;
  }
  function clampView() {
    const iw = W * s, ih = H * s, m = 24;
    ox = iw <= cw ? (cw - iw) / 2 : Math.min(m, Math.max(cw - iw - m, ox));
    oy = ih <= ch ? (ch - ih) / 2 : Math.min(m, Math.max(ch - ih - m, oy));
  }
  function zoomAt(px, py, ns) {
    ns = Math.min(minS * ZOOM, Math.max(minS, ns));
    ox = px - ((px - ox) * ns) / s; oy = py - ((py - oy) * ns) / s; s = ns;
    clampView(); paint();
  }
  const ro = new ResizeObserver(() => {
    const nw = stage.clientWidth, nh = stage.clientHeight;
    if (!nw || !nh) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(nw * dpr); cv.height = Math.round(nh * dpr);
    const keep = fitted && s > minS * 1.01;
    cw = nw; ch = nh;
    if (!keep) fit(); else { minS = Math.min((cw - 24) / W, (ch - 24) / H); clampView(); }
    fitted = true; draw();
  });
  ro.observe(stage);

  function paint() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const iw = W * s, ih = H * s;
    ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = checks; ctx.fillRect(0, 0, iw, ih); ctx.restore();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = s > 1 ? "low" : "high";
    ctx.globalAlpha = 0.3; ctx.drawImage(it.bmp, ox, oy, iw, ih); // dropped parts: a ghost of the photo, to see what can come back
    ctx.globalAlpha = 1; ctx.drawImage(C, ox, oy, iw, ih);
    const now = performance.now();
    if (flash) { // the change fades in
      const t = (now - flash) / 260;
      if (t >= 1) flash = 0; else { ctx.globalAlpha = 1 - t * t; ctx.drawImage(F, ox, oy, iw, ih); ctx.globalAlpha = 1; }
    }
    if (ripple) { // a ring where the tap landed
      const t = (now - ripple.t) / 420;
      if (t >= 1) ripple = null;
      else {
        ctx.strokeStyle = accent; ctx.lineWidth = 3 * (1 - t); ctx.globalAlpha = 1 - t;
        ctx.beginPath(); ctx.arc(ripple.x, ripple.y, 6 + 30 * (1 - (1 - t) ** 3), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (hover && mode !== "tap" && !gesture) { // the brush, where the mouse is
      const rr = brush() / 2;
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.arc(hover.x, hover.y, rr + 0.75, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.arc(hover.x, hover.y, rr - 0.75, 0, Math.PI * 2); ctx.stroke();
    }
    if (flash || ripple) paint();
  }

  /* ---------- changing the mask ---------- */
  let dirty = null; // {x0,y0,x1,y1}
  const touch = (x0, y0, x1, y1) => {
    if (!dirty) dirty = { x0, y0, x1, y1 };
    else { dirty.x0 = Math.min(dirty.x0, x0); dirty.y0 = Math.min(dirty.y0, y0); dirty.x1 = Math.max(dirty.x1, x1); dirty.y1 = Math.max(dirty.y1, y1); }
  };
  function flush() {
    if (!dirty) return;
    const { x0, y0, x1, y1 } = dirty; dirty = null;
    for (let y = y0; y < y1; y++) for (let x = x0, i = y * W + x0; x < x1; x++, i++) md[i * 4 + 3] = A[i];
    mx.putImageData(mid, 0, 0, x0, y0, x1 - x0, y1 - y0);
    compose(); paint();
  }
  const fadeFrom = () => { fx.globalCompositeOperation = "copy"; fx.drawImage(C, 0, 0); flash = performance.now(); };

  // Undo: the mask's alpha before each tap or stroke, 1 byte a pixel, within a budget.
  const undos = [], BUDGET = (api.small ? 24 : 48) * 2 ** 20;
  const pushUndo = () => { undos.push(A.slice()); while (undos.length > 1 && undos.length * N > BUDGET) undos.shift(); undoB.disabled = false; };
  function undo() {
    if (!undos.length) return;
    api.tick(); fadeFrom();
    A.set(undos.pop()); touch(0, 0, W, H); flush();
    undoB.disabled = !undos.length;
  }

  // One round, soft-edged dab of the brush at image point (x, y), radius rr in image pixels.
  function dab(x, y, rr, erase) {
    const x0 = Math.max(0, Math.floor(x - rr)), x1 = Math.min(W, Math.ceil(x + rr)), y0 = Math.max(0, Math.floor(y - rr)), y1 = Math.min(H, Math.ceil(y + rr));
    if (x0 >= x1 || y0 >= y1) return;
    const inv = 1 / rr;
    for (let py = y0; py < y1; py++) {
      const dy = (py + 0.5 - y) * inv;
      for (let px = x0, i = py * W + x0; px < x1; px++, i++) {
        const dx = (px + 0.5 - x) * inv, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const u = d < 0.75 ? 1 : 1 - (d - 0.75) / 0.25, v = Math.round(u * u * (3 - 2 * u) * 255);
        if (erase) { if (255 - v < A[i]) A[i] = 255 - v; } else if (v > A[i]) A[i] = v;
      }
    }
    touch(x0, y0, x1, y1);
  }
  function line(a, b, rr, erase) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), step = Math.max(0.5, rr * 0.3), n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) dab(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, rr, erase);
  }

  // Flood fill from seed through pixels where ok(i). Marks them in mark[] with 1 and keeps their bounding box in bb;
  // returns the count, or -1 past max.
  const mark = new Uint8Array(N), stack = new Int32Array(N), bb = { x0: 0, y0: 0, x1: 0, y1: 0 };
  function flood(seed, ok, max) {
    let sp = 0, n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = seed; mark[seed] = 1;
    while (sp) {
      const j = stack[--sp]; if (++n > max) return -1;
      const x = j % W, y = (j - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !mark[j - 1] && ok(j - 1)) { mark[j - 1] = 1; stack[sp++] = j - 1; }
      if (x < W - 1 && !mark[j + 1] && ok(j + 1)) { mark[j + 1] = 1; stack[sp++] = j + 1; }
      if (j >= W && !mark[j - W] && ok(j - W)) { mark[j - W] = 1; stack[sp++] = j - W; }
      if (j < N - W && !mark[j + W] && ok(j + W)) { mark[j + W] = 1; stack[sp++] = j + W; }
    }
    Object.assign(bb, { x0, y0, x1: x1 + 1, y1: y1 + 1 });
    return n;
  }
  // Grows the marked pixels by one pixel a pass into pixels where ok(i) (pass p marks with 2 + p), within the box.
  function grow(passes, ok) {
    for (let p = 0; p < passes; p++) {
      const t = 2 + p;
      bb.x0 = Math.max(0, bb.x0 - 1); bb.y0 = Math.max(0, bb.y0 - 1); bb.x1 = Math.min(W, bb.x1 + 1); bb.y1 = Math.min(H, bb.y1 + 1);
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0, i = y * W + x; x < bb.x1; x++, i++) {
        if (mark[i] || !ok(i)) continue;
        const l = x > 0 ? mark[i - 1] : 0, r = x < W - 1 ? mark[i + 1] : 0, u = y > 0 ? mark[i - W] : 0, d = y < H - 1 ? mark[i + W] : 0;
        if ((l && l < t) || (r && r < t) || (u && u < t) || (d && d < t)) mark[i] = t;
      }
    }
  }
  // True when a kept pixel (alpha 128+) is within GAP steps.
  const OFFS = []; for (let dy = -GAP; dy <= GAP; dy++) for (let dx = -GAP; dx <= GAP; dx++) if (Math.abs(dx) + Math.abs(dy) <= GAP && (dx || dy)) OFFS.push([dx, dy]);
  function nearKept(i) {
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of OFFS) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && A[yy * W + xx] >= 128) return true; }
    return false;
  }
  const nope = () => { stage.classList.remove("nope"); void stage.offsetWidth; stage.classList.add("nope"); };
  const clearMarks = () => { for (let y = bb.y0; y < bb.y1; y++) mark.fill(0, y * W + bb.x0, y * W + bb.x1); };

  function tapAt(px, py) {
    const ix = Math.floor((px - ox) / s), iy = Math.floor((py - oy) / s);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    ripple = { x: px, y: py, t: performance.now() }; paint();
    const seed = iy * W + ix, max = Math.floor(N * MOST), t0 = performance.now();
    mark.fill(0);
    if (A[seed] >= KEEP) { // a kept piece goes, with its soft fringe
      flood(seed, (i) => A[i] >= KEEP, N);
      grow(3, (i) => A[i] > 0 && A[i] < KEEP);
      pushUndo(); fadeFrom();
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0, i = y * W + x; x < bb.x1; x++, i++) if (mark[i]) A[i] = 0;
      api.dbg("edit-drop", { ms: Math.round(performance.now() - t0) });
    } else { // a dropped piece comes back
      let n = -1;
      if (U && U[seed] >= SEED) {
        // Kept pixels and a GAP around them are off limits while growing, so the subject's own soft edge isn't hardened
        // all round; then the piece grows back over that gap (only through what the model was unsure about).
        const seedNear = nearKept(seed);
        n = flood(seed, (i) => A[i] < 128 && U[i] >= GROW && (seedNear || !nearKept(i)), max);
        if (n > 0) grow(GAP + 1, (i) => A[i] < 128 && U[i] >= GROW);
      } else { // no raw output, or clean background: similar colours, connected
        const p = photo(), r0 = p[seed * 4], g0 = p[seed * 4 + 1], b0 = p[seed * 4 + 2];
        n = flood(seed, (i) => A[i] < 128 && Math.abs(p[i * 4] - r0) + Math.abs(p[i * 4 + 1] - g0) + Math.abs(p[i * 4 + 2] - b0) < 54, max);
      }
      if (n < 0) { mark.fill(0); nope(); api.dbg("edit-nope"); return; }
      pushUndo(); fadeFrom();
      // Soft edge: each pixel takes the share of marked pixels around it (3x3), never less than it had.
      const X0 = Math.max(0, bb.x0 - 1), Y0 = Math.max(0, bb.y0 - 1), X1 = Math.min(W, bb.x1 + 1), Y1 = Math.min(H, bb.y1 + 1);
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = y * W + x;
        let c = 0, t = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; t++; if (mark[yy * W + xx]) c++; } }
        if (!c) continue;
        const v = mark[i] ? Math.max(200, Math.round((c / t) * 255)) : Math.round((c / t) * 160);
        if (v > A[i]) A[i] = v;
      }
      api.dbg("edit-restore", { n, ms: Math.round(performance.now() - t0) });
    }
    api.tick();
    touch(0, 0, W, H); flush();
  }

  /* ---------- pointers: one finger or the mouse paints (or taps), two fingers zoom and pan ---------- */
  const pts = new Map();
  let gesture = null;
  const local = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const toImg = (p) => ({ x: (p.x - ox) / s, y: (p.y - oy) / s });
  function beginStroke(g) {
    clearTimeout(g.timer);
    pushUndo();
    g.type = "stroke"; g.last = toImg(g.start);
    dab(g.last.x, g.last.y, brush() / 2 / s, mode === "erase");
    for (const p of g.queue || []) { const q = toImg(p); line(g.last, q, brush() / 2 / s, mode === "erase"); g.last = q; }
    flush();
  }
  function startPinch() {
    if (gesture?.type === "stroke") { A.set(undos.pop()); undoB.disabled = !undos.length; touch(0, 0, W, H); flush(); } // the stroke was the start of a pinch
    if (gesture) clearTimeout(gesture.timer);
    const [a, b] = [...pts.values()];
    gesture = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: s, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ox0: ox, oy0: oy };
  }
  cv.addEventListener("pointerdown", (e) => {
    const p = local(e);
    try { cv.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, p);
    if (pts.size === 2) return startPinch();
    if (pts.size > 2) return;
    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld))) { gesture = { type: "pan", start: p, ox0: ox, oy0: oy }; stage.classList.add("grab"); return; }
    if (e.button !== 0) return;
    if (mode === "tap") gesture = { type: "tap", start: p, ox0: ox, oy0: oy };
    else if (e.pointerType === "touch") { const g = (gesture = { type: "pending", start: p, queue: [] }); g.timer = setTimeout(() => gesture === g && beginStroke(g), 80); }
    else beginStroke((gesture = { start: p }));
    paint();
  });
  cv.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (e.pointerType === "mouse") { hover = p; if (!gesture) paint(); }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, p);
    const g = gesture; if (!g) return;
    if (g.type === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ns = Math.min(minS * ZOOM, Math.max(minS, (g.s0 * d) / g.d0));
      const ix = (g.m0.x - g.ox0) / g.s0, iy = (g.m0.y - g.oy0) / g.s0;
      s = ns; ox = m.x - ix * s; oy = m.y - iy * s; clampView(); paint();
    } else if (g.type === "pan" || (g.type === "tap" && (g.moved || Math.hypot(p.x - g.start.x, p.y - g.start.y) > 8))) {
      g.moved = true; ox = g.ox0 + p.x - g.start.x; oy = g.oy0 + p.y - g.start.y; clampView(); paint();
    } else if (g.type === "pending") {
      g.queue.push(p);
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 12) beginStroke(g);
    } else if (g.type === "stroke") {
      const q = toImg(p); line(g.last, q, brush() / 2 / s, mode === "erase"); g.last = q; flush();
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const g = gesture;
    if (g?.type === "pinch") { if (!pts.size) gesture = null; return; } // the other finger lifting doesn't paint
    if (pts.size) return;
    gesture = null; stage.classList.remove("grab");
    if (!g) return;
    if (g.type === "pending") { beginStroke(g); gesture = null; }
    if (g.type === "tap" && !g.moved && e.type === "pointerup") tapAt(g.start.x, g.start.y);
    if (g.type === "stroke" || g.type === "pending") { api.dbg("edit-stroke", { mode }); api.tick(); }
    paint();
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hover = null; paint(); } });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("wheel", (e) => { // trackpad pinch arrives as a wheel with ctrlKey
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });

  /* ---------- the bar ---------- */
  // Taps on the bar act on pointerup for touch: the page swallows a second tap within 350 ms (no double-tap zoom),
  // which would eat quick Undo taps.
  const onTap = (b, fn) => {
    let skip = 0;
    b.addEventListener("pointerup", (e) => { if (e.pointerType === "touch" && !b.disabled) { skip = e.timeStamp; fn(); } });
    b.addEventListener("click", (e) => { if (skip && e.timeStamp - skip < 600) { skip = 0; return; } fn(); });
  };
  const setMode = (m) => {
    mode = m; stage.dataset.m = m;
    for (const b of el.querySelectorAll(".emode")) b.setAttribute("aria-pressed", String(b.dataset.m === m));
    el.querySelector(".ehint").hidden = m !== "tap"; el.querySelector(".esize").hidden = m === "tap";
    paint();
  };
  for (const b of el.querySelectorAll(".emode")) onTap(b, () => { api.tick(); setMode(b.dataset.m); });
  const sizeDot = () => el.querySelector(".edot").style.setProperty("--d", `${Math.max(4, Math.min(24, brush() / 5))}px`);
  size.addEventListener("input", () => { sizeDot(); paint(); });
  sizeDot();
  onTap(undoB, undo);
  onTap(doneB, finish);

  const keys = (e) => {
    if (e.type === "keyup") { if (e.key === " ") { spaceHeld = false; stage.classList.remove("grab"); } return; }
    const typing = /input|textarea/i.test(e.target.tagName) && e.target.type !== "range";
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); undo(); } // never also undoes a Remove
    else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(); }
    else if (typing) return;
    else if (e.key === " " && e.target === document.body) { e.preventDefault(); spaceHeld = true; stage.classList.add("grab"); }
    else if (e.key === "[" || e.key === "]") { size.value = brush() + (e.key === "]" ? 6 : -6); sizeDot(); paint(); }
  };
  addEventListener("keydown", keys, true);
  addEventListener("keyup", keys, true);
  if (api.debug) window.goodbyeEdit = { A, A0, W, H, raw: !!U, undos, view: () => ({ s, ox, oy, minS, cw, ch }), mode: () => mode };

  let closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    ro.disconnect(); cancelAnimationFrame(raf);
    removeEventListener("keydown", keys, true); removeEventListener("keyup", keys, true);
    let changed = false;
    for (let i = 0; i < N; i++) if (A[i] !== A0[i]) { changed = true; break; }
    let out = null;
    if (changed) {
      for (let i = 0; i < N; i++) md[i * 4 + 3] = A[i];
      out = new OffscreenCanvas(W, H); out.getContext("2d").putImageData(mid, 0, 0);
      const small = new OffscreenCanvas(RES, RES), sx = small.getContext("2d");
      sx.drawImage(out, 0, 0, RES, RES);
      out.box = api.subjectBox(sx.getImageData(0, 0, RES, RES));
      out.raw = it.maskRect ? null : it.mask.raw || null;
      // The edge colours were estimated for the model's edges: where the edit changed the mask, the photo's own
      // pixels show (a brought-back faded piece would otherwise get the blurred estimate painted over it).
      if (it.mask.fix) {
        out.fix = new OffscreenCanvas(W, H);
        const fc = out.fix.getContext("2d", { willReadFrequently: true });
        fc.drawImage(it.mask.fix, r.x * W, r.y * H, r.w * W, r.h * H);
        const f = fc.getImageData(0, 0, W, H), fd = f.data;
        for (let i = 0; i < N; i++) if (A[i] !== A0[i]) fd[i * 4 + 3] = 0;
        fc.putImageData(f, 0, 0);
      }
    }
    api.tick(); api.dbg("edit-done", { changed, w: W, h: H });
    el.remove(); document.body.classList.remove("editing");
    api.done(out);
    api.closed();
  }
}
