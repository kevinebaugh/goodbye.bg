// goodbye.bg — background removal that runs entirely in the browser.
// Photos from the device never leave it. The page's Content-Security-Policy (see _headers)
// only allows requests back to this site. The one server call is /api/fetch, used only
// when the visitor gives us a link to an image that lives on another site.

import { zipSync } from "./vendor/fflate.mjs";

const RES = 1024;            // model input size
const MAX_SIDE = 8192;       // larger images are scaled down to fit in memory
// Safari (Mac, iPhone, and every iOS browser) can't hold a canvas over about 16.7 megapixels.
const MAX_PIXELS = navigator.vendor === "Apple Computer, Inc." ? 16_000_000 : 64_000_000;
const MAX_BATCH = 50;        // images per drop or paste
const PREVIEW_SIDE = 900;    // card preview size
const CUTOFF = 0.5, SOFTNESS = 0.6;
const ADS = false;           // EthicalAds; turn on per docs/ads.md
const AD_SRC = "ad.html";    // later: ad.html on its own origin, e.g. https://ads.goodbye.bg/ad.html

const QUIPS = [
  "Asking the background to leave…",
  "Showing the backdrop the door…",
  "Packing the background's bags…",
  "It's not you, background. It's us.",
  "Waving goodbye…",
  "Cutting ties with the background…",
];

const $ = (id) => document.getElementById(id);
const items = [];

// A Safari tab left open can come back hours later showing an old build without asking the server.
// When the page comes back into view with no photos on it, compare builds and reload if it is stale.
const BUILD = "%BUILD%";
async function freshen() {
  if (items.length || document.visibilityState !== "visible" || BUILD.startsWith("%")) return;
  try {
    const live = (await (await fetch("/version.txt", { cache: "no-store" })).text()).trim();
    if (live && live !== BUILD) location.reload();
  } catch {}
}
addEventListener("pageshow", freshen);
document.addEventListener("visibilitychange", freshen);
let running = false, uid = 0, lastMs = 0;

/* ---------- small helpers ---------- */
function toast(msg, ms = 3500) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function hideToast() { clearTimeout(toast.t); $("toast").hidden = true; }
// Setup progress goes to the console only. People need to know when something fails, not how it is going.
let lastStatus = "";
function status(msg) { if (msg !== lastStatus) console.info(`goodbye.bg: ${(lastStatus = msg)}`); }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const baseName = (s) => (s || "image").split(/[\\/?#]/).filter(Boolean).pop()?.replace(/\.[^.]+$/, "").slice(0, 80) || "image";

/* ---------- model ----------
   ISNet runs in its own worker (engine.js). Computers and phones whose GPU can run it use
   WebGPU (about 0.15 s a photo on a recent Mac); everyone else uses the CPU (several seconds).
   If the GPU fails to start, fails a run, hangs, or returns garbage, its worker is thrown away
   and a CPU worker takes over the same photo. ?engine=gpu or ?engine=cpu forces one;
   ?gpufail=init|run|hang simulates a broken GPU for testing. */

const params = new URLSearchParams(location.search);

// ?debug=1: report each step to /api/diag (server log only) to find where a phone crashes.
// Step names and numbers only, never photo data. Off for everyone else.
const DEBUG = params.has("debug"), dbgId = Math.random().toString(36).slice(2, 7);
let dbgN = 0;
// Every page keeps its last 20 steps (names and numbers only, never photo data). They leave the device only
// inside a crash or error report (see working() and report()); with ?debug=1 each step is also sent live.
const trail = [];
let note = null; // the "working on a photo" note while one is open
function dbg(step, data = {}) {
  const extra = Object.keys(data).length ? " " + JSON.stringify(data).slice(0, 140) : "";
  trail.push(`${Math.round(performance.now())} ${step}${extra}`);
  if (trail.length > 20) trail.shift();
  if (note) saveNote();
  if (!DEBUG) return;
  const body = JSON.stringify({ id: dbgId, n: ++dbgN, t: Math.round(performance.now()), step, ...data });
  navigator.sendBeacon?.("/api/diag", body) || fetch("/api/diag", { method: "POST", body, keepalive: true }).catch(() => {});
}
dbg("load", { ua: navigator.userAgent.slice(0, 160), dpr: devicePixelRatio, w: innerWidth, h: innerHeight, mem: navigator.deviceMemory, coi: self.crossOriginIsolated });
const GPU_WARMUP_TIMEOUT = 30_000, GPU_RUN_TIMEOUT = 15_000; // longer counts as hung
let worker = null, engineName = "", engineReady = null, gpuBroken = false, jobId = 0;
const jobs = new Map();

// iPhones and iPads: WebGPU runs ISNet, but often crashes the tab (out of memory) on the first real
// photo; tested 2026-11-20 with ?debug=1. The CPU engine works there. Use it until that changes.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const THREADS = +params.get("threads") || (IOS ? 2 : 4);

/* ---------- crash reports ----------
   iOS kills a tab that runs out of memory and no code runs then, so nothing can report it at the time.
   Instead the page leaves a note in localStorage while it works on a photo and clears it when done or
   when the page closes normally. If the next visit finds the note, it sends it once to /api/crash:
   the step, the engine, the device kind, the photo's megapixels and how many photos the tab had finished.
   Never the photo. */
const CRASH_KEY = "goodbye-bg:working", DEVICE = IOS ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "desktop";
let finished = 0;

// A light haptic tick. Android: the vibration API. iPhone (iOS 18+): Safari has no vibration API, but a
// native switch control ticks when toggled, and toggling a hidden one through its label works from code.
const tickSwitch = IOS && (() => {
  const label = document.createElement("label"), box = document.createElement("input");
  box.type = "checkbox"; box.setAttribute("switch", ""); label.append(box);
  label.style.display = "none"; label.setAttribute("aria-hidden", "true");
  document.body.append(label);
  return label;
})();
// Every 100th cut-out on goodbye.bg, counted across everyone, gets confetti. /api/count adds one to a single
// global number and says whether this one is a hundredth. It carries nothing about the photo.
async function milestone(it) {
  let hit = params.has("confetti");
  try { const r = await (await fetch("/api/count", { method: "POST" })).json(); hit = r.confetti || hit; ownCount(r.n); } catch {}
  if (hit && items.includes(it)) confetti(it.el.card);
}
// canvas-confetti (ISC, served from /vendor), loaded the first time it is needed. It skips itself when the
// device asks for reduced motion. Bursts from the element that earned it, in the cool side of the palette.
let confettiLib = null;
async function confetti(from) {
  try {
    confettiLib ||= (await import("./vendor/confetti.mjs")).default;
    const r = from.getBoundingClientRect();
    const origin = { x: (r.left + r.width / 2) / innerWidth, y: Math.min(0.9, (r.top + r.height / 3) / innerHeight) };
    const base = { origin, colors: ["#69d2e7", "#a7dbd8", "#e0e4cc", "#2f9fb8", "#ffffff"], disableForReducedMotion: true, zIndex: 40 };
    confettiLib({ ...base, particleCount: 90, spread: 70, startVelocity: 38 });
    setTimeout(() => confettiLib({ ...base, particleCount: 50, spread: 110, startVelocity: 28, scalar: 0.8 }), 120);
  } catch (e) { console.warn("Confetti failed to load", e); }
}

// The footer count runs a step behind the real total and ticks toward it at the real pace, so it moves like a
// live counter without ever showing more than has happened. On load it starts about one refresh (30 s) of
// cut-outs behind, at the recent pace from /api/count; each refresh sets the next stretch to tick through,
// one by one at uneven intervals. Tap: confetti.
const REFRESH = 30_000;
let countShown = -1, countTimer = 0;
function renderCount(v) {
  countShown = v;
  const el = $("count");
  if (v <= 0) return;
  el.classList.add("on"); el.tabIndex = 0;
  el.textContent = `${v.toLocaleString("en-US")} ${v === 1 ? "background" : "backgrounds"} said goodbye`;
}
function showCount(n, perMin = 0) {
  if (!(n >= 0)) return;
  if (countShown < 0) renderCount(Math.max(0, n - Math.round((perMin * REFRESH) / 60000)));
  const steps = n - countShown;
  if (steps <= 0) return;
  // Spread the steps over the next refresh at random moments; many steps at once just roll.
  clearTimeout(countTimer);
  const times = Array.from({ length: Math.min(steps, 120) }, () => Math.random() * REFRESH).sort((a, b) => a - b);
  const from = countShown, t0 = performance.now();
  const next = (k) => {
    if (k >= times.length) return;
    countTimer = setTimeout(() => {
      renderCount(Math.max(countShown, from + Math.round(((k + 1) / times.length) * steps)));
      next(k + 1);
    }, Math.max(0, times[k] - (performance.now() - t0)));
  };
  next(0);
}
// This visitor's own cut-out shows up at once: the server has counted it, so the shown number can take one
// step right away; anything else that happened meanwhile keeps ticking in.
function ownCount(n) {
  if (countShown >= 0 && n > countShown) renderCount(countShown + 1);
  showCount(n);
}
// The first call after the page loads also counts the visit: just that it happened, and the site the visitor
// came from (hostname only). The server adds device kind and country; nothing identifies the person.
let viewSent = false;
async function pollCount() {
  if (document.visibilityState !== "visible") return;
  let q = "";
  if (!viewSent) {
    viewSent = true;
    let from = ""; try { from = document.referrer ? new URL(document.referrer).hostname : ""; } catch {}
    q = `?view=1&from=${encodeURIComponent(from === location.hostname ? "" : from)}`;
  }
  try { const r = await (await fetch("/api/count" + q)).json(); showCount(r.n, r.perMin); } catch {}
}
pollCount(); setInterval(pollCount, REFRESH);
$("count").addEventListener("click", (e) => { tick(); confetti(e.currentTarget); });

// The wordmark links home, but on this page that would reload and wipe every result. It waves instead.
document.querySelector(".mark").addEventListener("click", (e) => {
  e.preventDefault();
  const wave = e.currentTarget.querySelector(".wave");
  wave.classList.remove("again"); void wave.offsetWidth; wave.classList.add("again"); // restart the wave
  tick();
});

function tick() {
  if (tickSwitch) tickSwitch.click();
  else if (navigator.userActivation?.hasBeenActive && matchMedia("(pointer: coarse)").matches) navigator.vibrate?.(8);
}
function working(step, it) {
  note = { step, engine: engineName || "cpu", dev: DEVICE, done: finished, mp: it ? +((it.w * it.h) / 1e6).toFixed(1) : 0 };
  saveNote();
}
function saveNote() { try { localStorage.setItem(CRASH_KEY, JSON.stringify({ ...note, trail: trail.join("\n") })); } catch {} }
// Errors the page survives but the person sees (the engine would not start, or a photo failed): sent at once.
function report(step, e, it) {
  const note = { step, engine: engineName || "cpu", dev: DEVICE, done: finished, mp: it ? +((it.w * it.h) / 1e6).toFixed(1) : 0,
    error: String(e?.message || e).slice(0, 160), trail: trail.join("\n") };
  fetch("/api/crash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(note), keepalive: true }).catch(() => {});
}
// Cleared only once nothing is working: no batch, no 👎 retry, no PNG being built.
let retrying = 0, pngBusy = 0;
function rested() { if (running || retrying || pngBusy) return; note = null; try { localStorage.removeItem(CRASH_KEY); } catch {} }
addEventListener("pagehide", () => { note = null; try { localStorage.removeItem(CRASH_KEY); } catch {} }); // a normal close or reload
(() => {
  let note = null;
  try { note = localStorage.getItem(CRASH_KEY); localStorage.removeItem(CRASH_KEY); } catch {}
  if (note) fetch("/api/crash", { method: "POST", headers: { "Content-Type": "application/json" }, body: note, keepalive: true }).catch(() => {});
})();

async function pickEngine() {
  const forced = params.get("engine");
  if (forced === "gpu" || forced === "cpu") return forced;
  if (IOS) return "cpu";
  if (gpuBroken) return "cpu";
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter?.features.has("shader-f16")) return "gpu"; // the model is 16-bit
  } catch {}
  return "cpu";
}

function killWorker(reason) {
  worker?.terminate(); worker = null;
  for (const j of jobs.values()) j.reject(new Error(reason));
  jobs.clear();
}
function stopEngine(reason) { killWorker(reason); engineReady = null; }

// iPhones: the engine's memory (about 1.8 GB) only grows while the tab is open, and each photo added to it
// until Safari killed the tab (7 to 8 photos in one session). Once nothing is waiting, shut it down; the
// next photo starts a fresh one in under a second from the cached model.
// Phones make each PNG ahead of time (the share sheet only opens straight from a tap). On iPhone, wait until
// the engine just shut down has really been freed: building a 16 MP PNG while it was still in memory crashed.
// A Download tap before then builds that one PNG on the spot.
let pngTimer = 0;
function preparePngs() {
  if (!PHONE) return;
  clearTimeout(pngTimer);
  pngTimer = setTimeout(() => { if (!running && !retrying) for (const it of items) if (it.mask) png(it); }, IOS ? 10_000 : 0);
}
function idle() {
  if (IOS && worker && !jobs.size && !running) { stopEngine("idle"); dbg("engine-idle"); }
}

function startEngine(name) {
  killWorker("Engine restarted");
  engineName = name;
  const w = worker = new Worker("engine.js", { type: "module" });
  return new Promise((resolve, reject) => {
    let timer = 0;
    const fail = (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); };
    w.onerror = (e) => { e.preventDefault?.(); fail(e.message || "Engine worker crashed"); for (const j of jobs.values()) j.reject(new Error("Engine worker crashed")); jobs.clear(); };
    w.onmessage = ({ data }) => {
      if (data.type === "dbg") dbg("worker:" + data.step, data.data);
      else if (data.type === "progress") status(`Downloading model: ${Math.floor(data.f * 10) * 10}%`);
      else if (data.type === "loaded") {
        status("Starting up…");
        if (name === "gpu") timer = setTimeout(() => fail("GPU warm-up timed out"), GPU_WARMUP_TIMEOUT);
      } else if (data.type === "ready") { clearTimeout(timer); resolve(); }
      else if (data.type === "failed") fail(data.error);
      else if (data.type === "result" || data.type === "error") {
        const j = jobs.get(data.id); if (!j) return;
        jobs.delete(data.id); clearTimeout(j.timer);
        data.type === "result" ? j.resolve(data) : j.reject(new Error(data.error));
      }
    };
    dbg("engine-start", { name });
    w.postMessage({ type: "init", ep: name === "gpu" ? "webgpu" : "wasm", fail: params.get("gpufail"), debug: DEBUG, noWarm: params.has("nowarm"),
      // ?threads=N to test. iPhone: 4 threads 3.5 s a photo, 2 threads 5.0 s, 1 thread 7.3 s. But 4 threads
      // peak at 2.1 GB and crashed a big photo half the time; 2 threads peak about 300 MB lower.
      threads: THREADS });
  });
}

function loadModel() {
  if (!engineReady) {
    engineReady = (async () => {
      const name = await pickEngine();
      try { await startEngine(name); }
      catch (e) {
        if (name !== "gpu") {
          // The CPU engine can fail to start when memory is short (a tab that just crashed, or an engine that
          // was just shut down and not yet freed). Report it, wait a moment, try once more.
          report("start-failed", e); dbg("cpu-start-failed", { error: String(e?.message || e).slice(0, 200) });
          await new Promise((r) => setTimeout(r, 3000));
          await startEngine("cpu");
          status(`Ready.`); dbg("ready", { engine: engineName });
          return;
        }
        console.warn("GPU engine failed to start, switching to CPU.", e); dbg("gpu-start-failed", { error: String(e?.message || e).slice(0, 200) });
        gpuBroken = true; await startEngine("cpu");
      }
      status(`Ready.`); dbg("ready", { engine: engineName });
      console.info(`goodbye.bg: engine ${engineName}`);
    })();
    engineReady.catch(() => { engineReady = null; });
  }
  return engineReady;
}

function infer(input) {
  const w = worker, id = ++jobId;
  return new Promise((resolve, reject) => {
    const j = { resolve, reject, timer: 0 };
    if (engineName === "gpu") j.timer = setTimeout(() => { jobs.delete(id); reject(new Error("GPU run timed out")); }, GPU_RUN_TIMEOUT);
    jobs.set(id, j);
    w.postMessage({ type: "run", id, input });
  });
}

async function segment(bitmap) {
  await loadModel();
  dbg("segment", { w: bitmap.width, h: bitmap.height, coi: self.crossOriginIsolated, threads: THREADS });
  const c = new OffscreenCanvas(RES, RES), x = c.getContext("2d");
  x.drawImage(bitmap, 0, 0, RES, RES); dbg("drawn");
  const px = x.getImageData(0, 0, RES, RES).data, n = RES * RES; dbg("pixels");
  const input = new Float32Array(3 * n); // ISNet input: (x - 128) / 256
  for (let i = 0; i < n; i++) {
    input[i] = (px[i * 4] - 128) / 256;
    input[i + n] = (px[i * 4 + 1] - 128) / 256;
    input[i + 2 * n] = (px[i * 4 + 2] - 128) / 256;
  }
  let res;
  dbg("infer");
  try { res = await infer(input); }
  catch (e) {
    if (engineName !== "gpu" || params.get("engine") === "gpu") throw e;
    console.warn("GPU run failed, switching to CPU.", e); dbg("gpu-run-failed", { error: String(e?.message || e).slice(0, 200) });
    gpuBroken = true; stopEngine("GPU failed");
    await loadModel();
    res = await infer(input);
  }
  const m = res.mask;
  lastMs = res.ms; dbg("inferred", { ms: res.ms });
  const id = new ImageData(RES, RES);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    id.data[k] = id.data[k + 1] = id.data[k + 2] = 255;
    id.data[k + 3] = Math.max(0, Math.min(255, m[i] * 255));
  }
  despeck(id);
  const box = subjectBox(id);
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = LUT[id.data[i]]; // soften the edge once, here
  const mask = new OffscreenCanvas(RES, RES);
  mask.getContext("2d").putImageData(id, 0, 0);
  mask.box = box;
  return mask;
}

// The subject's bounding box (mostly opaque pixels), as fractions of the image. null if nothing is left.
function subjectBox(img) {
  let x0 = RES, y0 = RES, x1 = -1, y1 = -1;
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    if (img.data[(y * RES + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0: x0 / RES, y0: y0 / RES, x1: (x1 + 1) / RES, y1: (y1 + 1) / RES };
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };

// The subject's box as fractions of the whole photo, or null.
function subject(it) {
  const b = it.mask?.box, r = it.maskRect || FULL;
  return b ? { x0: r.x + b.x0 * r.w, y0: r.y + b.y0 * r.h, x1: r.x + b.x1 * r.w, y1: r.y + b.y1 * r.h } : null;
}

// What a card shows and saves, in image pixels: the subject with a little room when cropped, else the whole photo.
function frame(it) {
  const b = subject(it);
  if (!it.crop || !b) return { x: 0, y: 0, w: it.w, h: it.h };
  const pad = 0.04 * Math.max((b.x1 - b.x0) * it.w, (b.y1 - b.y0) * it.h);
  const x0 = Math.max(0, Math.floor(b.x0 * it.w - pad)), y0 = Math.max(0, Math.floor(b.y0 * it.h - pad));
  const x1 = Math.min(it.w, Math.ceil(b.x1 * it.w + pad)), y1 = Math.min(it.h, Math.ceil(b.y1 * it.h + pad));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Remove small islands that are not part of the main subject.
function despeck(img) {
  const n = RES * RES, d = img.data, lab = new Int32Array(n), stack = new Int32Array(n), sizes = [0];
  const on = (i) => d[i * 4 + 3] >= 64; // faint pixels do not join islands to the subject
  for (let i = 0; i < n; i++) {
    if (lab[i] || !on(i)) continue;
    const L = sizes.length; let sp = 0, cnt = 0;
    stack[sp++] = i; lab[i] = L;
    while (sp) {
      const j = stack[--sp]; cnt++;
      const x = j % RES, y = (j / RES) | 0;
      for (const k of [x > 0 ? j - 1 : -1, x < RES - 1 ? j + 1 : -1, y > 0 ? j - RES : -1, y < RES - 1 ? j + RES : -1]) {
        if (k >= 0 && !lab[k] && on(k)) { lab[k] = L; stack[sp++] = k; }
      }
    }
    sizes.push(cnt);
  }
  const big = Math.max(...sizes);
  for (let i = 0; i < n; i++) {
    const l = lab[i];
    if ((l && sizes[l] < big * 0.015) || (!l && d[i * 4 + 3] < 25)) d[i * 4 + 3] = 0; // keep soft edges
  }
}

/* ---------- compositing ---------- */
const LUT = (() => {
  const lo = Math.max(0, CUTOFF - SOFTNESS / 2), hi = Math.min(1, CUTOFF + SOFTNESS / 2), t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let u = (v / 255 - lo) / (hi - lo); u = Math.max(0, Math.min(1, u)); t[v] = Math.round(u * u * (3 - 2 * u) * 255); }
  return t;
})();

// The cut-out at W x H: the photo with the mask as its alpha. One canvas; the browser applies the mask
// by compositing, so a big photo costs one copy of itself, not four (iPhones run out of memory).
function render(it, W, H, bmp = it.bmp) {
  const c = new OffscreenCanvas(W, H), x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(bmp, 0, 0, W, H);
  x.globalCompositeOperation = "destination-in"; // keep the photo only where the mask is opaque
  const r = it.maskRect || FULL; // a retry's mask covers only the zoomed-in part; the rest goes clear
  x.drawImage(it.mask, r.x * W, r.y * H, r.w * W, r.h * H);
  return c;
}

function drawCard(it) {
  // The shown image stays up until the new one is decoded (still() swaps it), so a crop toggle doesn't flicker.
  const f = it.mask ? frame(it) : { x: 0, y: 0, w: it.w, h: it.h };
  // Never draw bigger than the preview bitmap holds (a tight crop would otherwise blow up to full size).
  const k = Math.min(1, PREVIEW_SIDE / Math.max(f.w, f.h), it.bmp.width / it.w);
  const W = Math.max(1, Math.round(f.w * k)), H = Math.max(1, Math.round(f.h * k)), c = it.el.canvas;
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.clearRect(0, 0, W, H);
  if (!it.mask) return x.drawImage(it.bmp, 0, 0, W, H);
  const full = render(it, Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k)));
  x.drawImage(full, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, W, H);
  still(it);
}

// A finished cut-out is shown as a plain image, so a long press offers Save to Photos (iOS) and a
// right-click offers Save image. It shows the preview; a press swaps in the full-size PNG.
function still(it) {
  const { canvas, img, pic } = it.el, gen = (it.gen = (it.gen || 0) + 1);
  if (it.fullUrl) { URL.revokeObjectURL(it.fullUrl); it.fullUrl = null; }
  canvas.toBlob(async (b) => {
    if (!b || gen !== it.gen) return;
    const old = it.previewUrl;
    it.previewUrl = URL.createObjectURL(b);
    img.src = it.previewUrl;
    try { await img.decode(); } catch {}
    if (gen !== it.gen) return;
    pic.classList.add("still");
    if (old) URL.revokeObjectURL(old);
  }, "image/png");
}

// Long press saves what Download saves: the full-size PNG. Only one card holds it at a time (memory).
let pressed = null;
function holdFull(it) {
  if (pressed && pressed !== it && pressed.previewUrl) pressed.el.img.src = pressed.previewUrl;
  pressed = it;
  // Never start a full-size encode here: during a batch it competes with the model for memory (iPhones crash).
  // Phones prepare the PNGs after the batch; until then a long press saves the preview.
  if (!it.mask || !it.png || running) return;
  it.png.then((b) => {
    if (pressed !== it || !it.el.pic.classList.contains("still")) return;
    it.fullUrl ||= URL.createObjectURL(b);
    if (it.el.img.src !== it.fullUrl) it.el.img.src = it.fullUrl;
  }, () => {});
}

// The background wipes away, then the view eases in to the crop.
function reveal(it) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return drawCard(it);
  it.el.pic.classList.remove("still"); it.gen = (it.gen || 0) + 1;
  const c = it.el.canvas, x = c.getContext("2d");
  const K = Math.min(1, PREVIEW_SIDE / Math.max(it.w, it.h)), W = Math.round(it.w * K), H = Math.round(it.h * K);
  c.width = W; c.height = H;
  const cut = render(it, W, H), slant = H * 0.4, D = 450, Z = 420, f = frame(it);
  const zoom = f.w !== it.w || f.h !== it.h;
  let t0 = performance.now();
  const wipe = (now) => {
    const t = 1 - (1 - Math.min(1, (now - t0) / D)) ** 3, edge = t * (W + slant);
    x.clearRect(0, 0, W, H);
    x.drawImage(it.bmp, 0, 0, W, H);
    x.save();
    x.beginPath(); x.moveTo(0, 0); x.lineTo(edge, 0); x.lineTo(edge - slant, H); x.lineTo(0, H); x.closePath(); x.clip();
    x.clearRect(0, 0, W, H); x.drawImage(cut, 0, 0);
    x.restore();
    if (t < 1) requestAnimationFrame(wipe);
    else if (zoom) { t0 = performance.now(); requestAnimationFrame(ease); }
    else drawCard(it);
  };
  // Ease into the crop in a canvas sized once for the crop: the view shrinks from the whole frame
  // (letterboxed) to the subject. Resizing a canvas every frame churns memory on phones.
  let cw = 0, ch = 0;
  const ease = (now) => {
    if (!cw) {
      const k = Math.min(PREVIEW_SIDE / Math.max(f.w, f.h), 4);
      c.width = cw = Math.max(1, Math.round(f.w * k)); c.height = ch = Math.max(1, Math.round(f.h * k));
    }
    const t = 1 - (1 - Math.min(1, (now - t0) / Z)) ** 3, l = (a, b) => a + (b - a) * t;
    const rx = l(0, f.x) * K, ry = l(0, f.y) * K, rw = l(it.w, f.w) * K, rh = l(it.h, f.h) * K;
    const s = Math.min(cw / rw, ch / rh), dw = rw * s, dh = rh * s;
    x.clearRect(0, 0, cw, ch);
    x.drawImage(cut, rx, ry, rw, rh, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    if (t < 1) requestAnimationFrame(ease); else drawCard(it);
  };
  requestAnimationFrame(wipe);
}

// Each photo keeps only a small preview bitmap plus its original file. The full-size image is decoded
// just for a download or a retry and released right after: five 19 MP photos held as bitmaps (75 MB
// each) were enough, next to the engine, to crash an iPhone.
const fullBitmap = (it) => decode(it.blob);

async function fullBlob(it) {
  dbg("png", { w: it.w, h: it.h });
  working("png", it); pngBusy++;
  // One canvas at the saved size: the photo is drawn shifted so the crop lands at 0,0 (the canvas clips the
  // rest), the full photo is freed, then the mask cuts it out. A 16 MP photo on an iPhone crashed with the
  // old way (full-frame canvas plus a cropped copy plus the decoded photo).
  const f = frame(it), out = new OffscreenCanvas(f.w, f.h), x = out.getContext("2d");
  try {
    const big = await fullBitmap(it);
    try { x.imageSmoothingQuality = "high"; x.drawImage(big, -f.x, -f.y, it.w, it.h); }
    finally { big.close(); }
    x.globalCompositeOperation = "destination-in"; // keep the photo only where the mask is opaque
    const r = it.maskRect || FULL;
    x.drawImage(it.mask, r.x * it.w - f.x, r.y * it.h - f.y, r.w * it.w, r.h * it.h);
    return await out.convertToBlob({ type: "image/png" });
  } finally { pngBusy--; rested(); }
}

// Phones save through the share sheet ("Save Image" puts it in Photos) instead of downloading to Files.
// The share sheet only opens straight from a tap, so phones make each PNG as soon as the cut is done.
const PHONE = matchMedia("(pointer: coarse)").matches && "canShare" in navigator;
let pngChain = Promise.resolve();
// One full-size PNG at a time: several at once can run a phone out of memory.
const png = (it) => (it.png ||= (pngChain = pngChain.then(() => fullBlob(it), () => fullBlob(it))));
const outName = (it) => `${it.name}-goodbye-bg.png`;

/* ---------- getting images in ----------
   Every way in ends at addSources(list), where each entry is a File/Blob or a string
   (http(s) link, data: URL, or blob: URL). */

const PREVIEW_MAX = 1600; // longest side of the bitmap kept per photo (previews and the model input)

async function addSources(list, origin = "") {
  list = list.filter(Boolean).slice(0, MAX_BATCH);
  if (!list.length) { toast("No image found there. Try a photo file, a copied image, or an image link."); return; }
  show();
  // All cards appear at once, so the layout settles once instead of jumping with every photo.
  const cards = document.createDocumentFragment(); // the batch goes on top, in the order it was picked
  const batch = list.map((src) => {
    const it = { id: ++uid, name: "image", bmp: null, blob: null, w: 0, h: 0, mask: null, crop: true };
    items.push(it);
    cards.append(makeCard(it));
    it.name = baseName(src instanceof Blob ? src.name : String(src).startsWith("data:") ? "pasted" : String(src));
    return [it, src];
  });
  $("grid").prepend(cards);
  sync();
  for (const [it, src] of batch) { // one decode at a time: a full-size decode is big
    if (!items.includes(it)) continue;
    try {
      const { blob, name } = await toBlob(src);
      it.name = baseName(name);
      dbg("decode", { bytes: blob.size, type: blob.type });
      const full = await decode(blob);
      let { width: w, height: h } = full;
      dbg("decoded", { w, h });
      if (Math.max(w, h) > MAX_SIDE || w * h > MAX_PIXELS) {
        const k = Math.min(MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
        w = Math.floor(w * k); h = Math.floor(h * k);
      }
      const k = Math.min(1, PREVIEW_MAX / Math.max(w, h));
      const bmp = k < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: "high" }) : full;
      if (bmp !== full) full.close();
      Object.assign(it, { bmp, blob, w, h });
      drawCard(it);
    } catch (e) {
      console.warn(e);
      fail(it, e.message || "Could not open this image.");
    }
    run();
  }
  sync();
}

async function toBlob(src) {
  if (src instanceof Blob) return { blob: src, name: src.name || "pasted" };
  const s = String(src).trim();
  if (s.startsWith("data:")) {
    const m = s.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) throw new Error("That data link is not an image.");
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    return { blob: new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], { type: m[1] || "image/png" }), name: "pasted" };
  }
  if (s.startsWith("blob:")) return { blob: await (await fetch(s)).blob(), name: "image" };
  const url = new URL(s);
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url.href)}`);
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `Could not get that link (${res.status}).`);
  return { blob: await res.blob(), name: url.pathname };
}

// createImageBitmap covers JPG, PNG, WebP, GIF, AVIF, BMP. An <img> also covers SVG,
// ICO and anything else this browser can show (HEIC in Safari).
async function decode(blob) {
  try { return await createImageBitmap(blob); } catch {}
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h });
  } catch {
    const heic = /hei[cf]/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name || "");
    throw new Error(heic ? "This browser can't open HEIC photos. Use Safari, or export the photo as JPG." : "This file isn't an image this browser can open.");
  } finally { URL.revokeObjectURL(url); }
}

// Pull image links out of pasted or dropped text and HTML.
function linksFrom(html, text) {
  const out = [];
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of doc.querySelectorAll("img[src]")) out.push(img.getAttribute("src"));
    if (!out.length) for (const a of doc.querySelectorAll("a[href]")) out.push(a.getAttribute("href"));
  }
  if (!out.length && text) for (const t of text.split(/\s+/)) if (/^(https?:\/\/|data:image\/)/i.test(t)) out.push(t);
  return [...new Set(out)].filter((u) => /^(https?:|data:image\/|blob:)/i.test(u));
}

// Walk dropped folders.
async function filesFromEntry(entry, out) {
  if (out.length >= MAX_BATCH) return;
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    if (f.type.startsWith("image/") || /\.(hei[cf]|avif|jxl)$/i.test(f.name)) out.push(f);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await filesFromEntry(e, out);
    }
  }
}

async function fromDataTransfer(dt) {
  const files = [];
  const entries = [...(dt.items || [])].map((i) => i.kind === "file" && i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.some((e) => e.isDirectory)) for (const e of entries) await filesFromEntry(e, files);
  else for (const f of dt.files || []) files.push(f);
  if (files.length) return files;
  return linksFrom(dt.getData("text/html"), dt.getData("text/uri-list") || dt.getData("text/plain"));
}

/* ---------- cards ---------- */
function makeCard(it) {
  const card = document.createElement("article"); card.className = "card";
  const pic = document.createElement("div"); pic.className = "pic";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Image");
  const busy = document.createElement("div"); busy.className = "busy";
  card.classList.add("queued"); // waits quietly; only the photo being worked on waves and talks
  const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "Remove");
  const crop = document.createElement("button"); crop.type = "button"; crop.className = "crop"; crop.style.visibility = "hidden"; // keeps its place, so the bar never shifts
  crop.setAttribute("aria-label", "Crop to subject"); crop.setAttribute("aria-pressed", "true");
  crop.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>';
  const img = document.createElement("img"); img.alt = "Cut-out"; img.draggable = true;
  img.addEventListener("touchstart", () => holdFull(it), { passive: true });
  img.addEventListener("contextmenu", () => holdFull(it));
  pic.append(canvas, img, busy);
  const bar = document.createElement("div"); bar.className = "bar";
  const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn primary dl"; dl.disabled = true;
  dl.setAttribute("aria-label", "Download");
  dl.innerHTML = '<span>Download</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
  const up = document.createElement("button"), down = document.createElement("button");
  for (const [b, label, emoji] of [[up, "Good result", "👍"], [down, "Bad result, try again", "👎"]]) {
    b.type = "button"; b.className = "ico rate"; b.textContent = emoji; b.style.visibility = "hidden";
    b.setAttribute("aria-label", label); b.title = label;
  }
  up.addEventListener("click", () => { tick(); rate(it, "up"); });
  down.addEventListener("click", () => { tick(); rate(it, "down"); });
  const rates = document.createElement("div"); rates.className = "rates"; rates.append(up, down);
  x.classList.add("ico"); crop.classList.add("ico");
  bar.append(crop, dl, rates, x);
  card.append(pic, bar);

  crop.addEventListener("click", () => {
    it.crop = !it.crop; crop.setAttribute("aria-pressed", String(it.crop)); tick();
    it.png = null; drawCard(it); if (PHONE) png(it);
  });
  x.addEventListener("click", () => { dbg("removed"); clearInterval(it.quip); it.gen = -1;
    for (const u of [it.previewUrl, it.fullUrl]) if (u) URL.revokeObjectURL(u); items.splice(items.indexOf(it), 1); card.remove(); sync(); });
  dl.addEventListener("click", async () => tick() || deliver([{ name: outName(it), blob: await png(it) }]));

  it.el = { card, pic, canvas, img, busy, dl, crop, up, down };
  return card;
}

function fail(it, msg) {
  it.el.card.classList.remove("queued");
  clearInterval(it.quip);
  it.failed = true;
  it.el.card.classList.add("failed");
  it.el.busy.textContent = msg;
}

async function run() {
  if (running) return;
  running = true;
  try {
    // Next waiting photo in reading order (top-left first), so the work starts where people look.
    const next = () => [...$("grid").children].map((card) => items.find((i) => i.el.card === card))
      .find((i) => i && !i.mask && !i.failed && i.bmp);
    for (let it; (it = next()); ) {
      startQuips(it);
      await nextFrame();
      working(engineReady ? "model" : "load", it);
      try { it.mask = await segment(it.bmp); finished++; }
      catch (e) { console.error(e); report("run-failed", e, it); fail(it, "Could not process this image."); continue; }
      if (!it.mask.box) { it.mask = null; fail(it, "No clear subject in this photo."); continue; }
      if (!items.includes(it)) continue;
      clearInterval(it.quip);
      it.el.busy.hidden = true; it.el.dl.disabled = false; for (const b of [it.el.crop, it.el.up, it.el.down]) b.style.visibility = ""; it.ms = lastMs;
      dbg("shown");
      dbg("reveal"); reveal(it); sync(); tick(); milestone(it);
      it.el.card.dataset.ms = lastMs;
    }
  } finally { running = false; rested(); }
  if (items.some((i) => i.bmp && !i.mask && !i.failed)) return run();
  idle();
  requestAnimationFrame(layout); // the batch is done: an empty grid cell may take the ad card now
  preparePngs(); // after the batch: don't compete with the model
}

function startQuips(it) {
  const { card, busy } = it.el;
  card.classList.remove("queued");
  let line = Math.floor(Math.random() * QUIPS.length);
  busy.textContent = QUIPS[line];
  clearInterval(it.quip);
  it.quip = setInterval(() => { if (!it.failed) busy.textContent = QUIPS[++line % QUIPS.length]; }, 1600);
}

function show() { document.body.classList.add("has-work"); }
/* ---------- ratings ----------
   👍 and 👎 send an anonymous count to /api/rate: the vote, the engine, the run time and the photo's
   megapixels. Never the photo. 👎 then runs the model again, zoomed in on the subject, which gives
   it more pixels to work with. The retry can be rated too. */
function sendRating(it, vote) {
  const body = JSON.stringify({ vote, engine: engineName, retry: !!it.retried, ms: it.ms || 0, mp: +((it.w * it.h) / 1e6).toFixed(1) });
  fetch("/api/rate", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

async function rate(it, vote) {
  const { up, down } = it.el;
  // One vote per result: the chosen one stays lit, the other steps aside (keeping its place in the bar).
  up.disabled = down.disabled = true;
  (vote === "up" ? up : down).classList.add("chosen");
  (vote === "up" ? down : up).style.visibility = "hidden";
  sendRating(it, vote);
  if (vote !== "down") return;
  if (!it.retried) return retry(it);
  if (it.first) { // 👎 on the retry: put the first result back, so a retry never leaves things worse
    Object.assign(it, { mask: it.first.mask, maskRect: it.first.rect, png: null });
    it.first = null; drawCard(it); if (PHONE) png(it);
  }
}

async function retry(it) {
  const s = subject(it);
  if (!s) return;
  // Zoom to the subject with generous room; skip if that is most of the photo anyway.
  const padX = 0.15 * (s.x1 - s.x0), padY = 0.15 * (s.y1 - s.y0);
  const x0 = Math.max(0, s.x0 - padX), y0 = Math.max(0, s.y0 - padY), x1 = Math.min(1, s.x1 + padX), y1 = Math.min(1, s.y1 + padY);
  if ((x1 - x0) * (y1 - y0) > 0.8) return;
  it.retried = true;
  it.first = { mask: it.mask, rect: it.maskRect };
  retrying++; working("retry", it);
  const { busy, up, down, dl } = it.el;
  busy.textContent = QUIPS[Math.floor(Math.random() * QUIPS.length)]; busy.hidden = false; dl.disabled = true;
  let changed = false;
  // Never next to a PNG being built (a full photo each): wait for those, and hold back the ones not started.
  clearTimeout(pngTimer);
  await pngChain.catch(() => {});
  try {
    const sx = Math.round(x0 * it.w), sy = Math.round(y0 * it.h), sw = Math.max(1, Math.round((x1 - x0) * it.w)), sh = Math.max(1, Math.round((y1 - y0) * it.h));
    const big = await fullBitmap(it), sc = big.width / it.w; // decoded size can exceed the working size
    // Straight to the model's input size: 4 MB instead of a full-resolution crop.
    const part = await createImageBitmap(big, Math.round(sx * sc), Math.round(sy * sc), Math.max(1, Math.round(sw * sc)), Math.max(1, Math.round(sh * sc)),
      { resizeWidth: RES, resizeHeight: RES, resizeQuality: "high" });
    big.close();
    const m = await segment(part); part.close();
    if (m.box) { changed = true; it.mask = m; it.maskRect = { x: sx / it.w, y: sy / it.h, w: sw / it.w, h: sh / it.h }; it.ms = lastMs; it.png = null; }
  } catch (e) { console.warn("Retry failed", e); }
  retrying--;
  busy.hidden = true; dl.disabled = false;
  if (!items.includes(it)) { rested(); return; }
  if (changed) reveal(it); else it.first = null;
  rested();
  idle();
  preparePngs();
  // A new result gets its own vote; if the retry found nothing better, the 👎 stands.
  if (changed) for (const b of [up, down]) { b.disabled = false; b.classList.remove("chosen"); b.style.visibility = ""; }
}

// Everything fits on one screen: cards are square and sized so they all fit the space left.
// Only past a minimum size (dozens of photos on a phone) does the grid scroll.
const GAP = 12, MIN_PIC = 96, MAX_PIC = 640;
function layout() {
  const g = $("grid"), n = g.querySelectorAll(".card").length, all = $("tools");
  if (!n) return;
  const bar = g.querySelector(".bar")?.offsetHeight || 52, W = g.clientWidth, H = g.clientHeight - (all.hidden ? 0 : all.offsetHeight + GAP); // "Download all" sits under the cards
  let best = { p: 0, c: 1 };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), p = Math.floor(Math.min((W - GAP * (c - 1)) / c, (H - GAP * (r - 1)) / r - bar));
    if (p > best.p) best = { p, c };
  }
  const scroll = best.p < MIN_PIC, p = Math.min(MAX_PIC, Math.max(best.p, MIN_PIC));
  const c = scroll ? Math.max(1, Math.floor((W + GAP) / (p + GAP))) : best.c;
  g.classList.toggle("scroll", scroll);
  $("main").style.setProperty("--cols", c); $("main").style.setProperty("--p", `${p}px`); // grid and tools row share them
  placeAd(n, c, scroll);
}
new ResizeObserver(layout).observe($("grid"));

/* ---------- ad card ----------
   At most one affiliate card, and only in a grid cell that would otherwise be empty (3 photos in a 2x2 grid),
   once the whole batch is done. Never between photos, never shrinks them, not part of Download all, no rating,
   clearly marked "Ad". One partner per visit. Its link goes through /go/<id>, which counts the click. */
let adPartner = null, adVariant = null, adEl = null;
// Label test, independent of the partner's A/B variant: "Ad" or "Sponsored", picked at random per visit.
const adLabel = Math.random() < 0.5 ? "Ad" : "Sponsored";
const adSeen = new Set();
fetch("/partners.json").then((r) => r.json()).then((list) => {
  const ok = list.filter((p) => p.live || params.has("adtest")); // ?adtest=1 shows partners before their links exist
  adPartner = ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  // A/B: one of the partner's live variants, at random, for this visit.
  const vs = adPartner?.variants.filter((x) => x.live || params.has("adtest")) || [];
  adVariant = vs.find((x) => x.v === params.get("adv")) || (vs.length ? vs[Math.floor(Math.random() * vs.length)] : null); // ?adv=<v> to check one
  requestAnimationFrame(layout);
}).catch(() => {});

function placeAd(n, cols, scroll) {
  const busy = running || retrying || items.some((i) => !i.mask && !i.failed);
  const free = n >= 2 && !scroll ? Math.ceil(n / cols) * cols - n : 0;
  if (!adPartner || !adVariant || busy || free < 1) { adEl?.remove(); adEl = null; return; }
  if (adEl) return;
  const p = adPartner, x = adVariant, a = adEl = document.createElement("a");
  const q = `?v=${x.v}&l=${adLabel.toLowerCase()}`;
  a.className = "adcard"; a.href = `/go/${p.id}${q}`; a.target = "_blank"; a.rel = "sponsored noopener";
  a.innerHTML = '<div class="adpic"><span class="adtag"></span><span class="adicon" aria-hidden="true"></span><p class="adline"></p></div><div class="bar"><span class="btn primary adcta"></span></div>';
  const src = x.mug && mugSource();
  if (src) { // the visitor's own cut-out on a mug, drawn here (nothing is uploaded)
    const c = document.createElement("canvas"); c.className = "admug"; c.setAttribute("aria-hidden", "true");
    a.querySelector(".adicon").replaceWith(c);
  } else a.querySelector(".adicon").textContent = p.emoji;
  a.querySelector(".adline").textContent = x.line;
  a.querySelector(".adcta").textContent = x.cta;
  a.querySelector(".adtag").textContent = adLabel;
  a.setAttribute("aria-label", `${adLabel}: ${x.line} ${x.cta}`);
  $("grid").insertBefore(a, $("tools"));
  if (src) drawMug(a.querySelector(".admug"), src);
  if (!adSeen.has(p.id)) { adSeen.add(p.id); fetch(`/go/${p.id}${q}`, { method: "POST", keepalive: true }).catch(() => {}); }
}

// The art for the mug: the first finished card on screen, cropped tight to the subject whatever the card
// shows, at most 640 px. Edges fade softly, so a subject cut off by the photo's frame (a cat's chest, a sofa)
// ends like a printed design instead of a hard straight line.
function mugSource() {
  for (const card of $("grid").children) {
    const it = items.find((i) => i.el.card === card);
    if (it?.mask?.box) return mugArt(it);
  }
  return null;
}
function mugArt(it) {
  const keep = it.crop; it.crop = true; const f = frame(it); it.crop = keep;
  const k = Math.min(1, 640 / Math.max(f.w, f.h), it.bmp.width / it.w);
  const full = render(it, Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k)));
  const w = Math.max(1, Math.round(f.w * k)), h = Math.max(1, Math.round(f.h * k));
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d");
  x.drawImage(full, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, w, h);
  x.globalCompositeOperation = "destination-in";
  for (const [x1, y1] of [[w, 0], [0, h]]) {
    const g = x.createLinearGradient(0, 0, x1, y1);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.07, "#000"); g.addColorStop(0.93, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
  return c;
}

// A white mug seen slightly from above, handle on the right, with the cut-out wrapped around it in 3D:
// each column of the picture lands where it would on a cylinder (narrower toward the edges) and sits lower
// the further forward it is, so straight lines curve like the rim's ellipse. Then shading.
function drawMug(c, src) {
  const k = Math.min(2, devicePixelRatio || 1), W = c.clientWidth || 200, H = c.clientHeight || 150;
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const x = c.getContext("2d"); x.scale(k, k);
  // ry/R sets how far we look down on the mug: 0.36 shows the rim as an open ellipse, so the print visibly
  // curves around the body (at 0.24 it looked flat, like a card standing inside the mug).
  const mh = H * 0.9, mw = Math.min(W * 0.6, mh * 0.8), R = mw / 2, ry = R * 0.36;
  // Light from the front left: brightness by the angle of the surface (Lambert), plus a soft highlight.
  const LIGHT = -0.45, lit = (th) => Math.max(0, Math.cos(th - LIGHT)), shine = (th) => Math.exp(-(((th - LIGHT) / 0.22) ** 2));
  const across = (g, f) => { for (let i = 0; i <= 24; i++) { const th = -Math.PI / 2 + (Math.PI * i) / 24; g.addColorStop(0.5 + Math.sin(th) / 2, f(th)); } return g; };
  const cx = W / 2 - mw * 0.1, top = (H - mh) / 2, rimY = top + ry, bot = top + mh - ry;
  // Soft shadow to set it down on the panel (light mode especially)
  x.fillStyle = "rgba(0,0,0,.16)"; x.filter = "blur(4px)";
  x.beginPath(); x.ellipse(cx + R * 0.1, bot + ry * 0.55, R * 1.08, ry * 0.7, 0, 0, Math.PI * 2); x.fill();
  x.filter = "none";
  // Handle
  x.lineWidth = mw * 0.12; x.strokeStyle = "#d5dcda"; x.lineCap = "round";
  x.beginPath(); x.ellipse(cx + R, top + mh * 0.47, mw * 0.2, mh * 0.21, 0, -Math.PI / 2.4, Math.PI / 2.4); x.stroke();
  // Body
  const body = new Path2D();
  body.moveTo(cx - R, rimY); body.lineTo(cx - R, bot); body.ellipse(cx, bot, R, ry, 0, Math.PI, 0, true); body.lineTo(cx + R, rimY); body.closePath();
  x.fillStyle = across(x.createLinearGradient(cx - R, 0, cx + R, 0), (th) => {
    const v = Math.round(150 + 95 * lit(th) + 10 * shine(th)); return `rgb(${v - 6},${v},${v - 2})`;
  });
  x.fill(body);
  // Print: fits the visible front of the cylinder, wrapped column by column
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const maxArc = 2 * Math.asin(0.97) * R, maxH = (bot - rimY - ry) * 0.9;
  const s = Math.min(maxArc / sw, maxH / sh), arc = sw * s, ph = sh * s, phi = arc / R;
  const half = R * Math.sin(phi / 2), py = rimY + ry * 0.2 + (bot - rimY - ry - ph) / 2;
  const print = new OffscreenCanvas(c.width, c.height), px = print.getContext("2d"); px.scale(k, k);
  for (let col = cx - half; col < cx + half; col += 1) {
    const th = Math.asin(Math.max(-1, Math.min(1, (col - cx) / R))), u = (th + phi / 2) / phi;
    const dy = ry * Math.cos(th); // seen from above: the front of the cylinder sits lower than its sides
    px.drawImage(src, Math.min(sw - 1, Math.max(0, u * sw)), 0, Math.max(1, sw / (2 * half)), sh, col, py + dy, 1.4, ph);
  }
  px.globalCompositeOperation = "source-atop"; // shade the print like the mug
  px.fillStyle = across(px.createLinearGradient(cx - R, 0, cx + R, 0), (th) => `rgba(0,0,0,${(0.62 * (1 - lit(th))).toFixed(3)})`);
  px.fillRect(0, 0, W, H);
  px.fillStyle = across(px.createLinearGradient(cx - R, 0, cx + R, 0), (th) => `rgba(255,255,255,${(0.22 * shine(th)).toFixed(3)})`);
  px.fillRect(0, 0, W, H);
  x.drawImage(print, 0, 0, W, H);
  // Rim and inside
  x.fillStyle = "#eef2f1"; x.beginPath(); x.ellipse(cx, rimY, R, ry, 0, 0, Math.PI * 2); x.fill();
  const inside = x.createLinearGradient(0, rimY - ry, 0, rimY + ry);
  inside.addColorStop(0, "#7d8a87"); inside.addColorStop(1, "#b6c0be");
  x.fillStyle = inside; x.beginPath(); x.ellipse(cx, rimY + ry * 0.08, R * 0.9, ry * 0.78, 0, 0, Math.PI * 2); x.fill();
}

function sync() {
  const done = items.filter((i) => i.mask).length;
  $("all").style.visibility = done < 2 ? "hidden" : "";
  $("all").textContent = `Download all (${done})`;
  $("tools").hidden = items.length < 2; // reserve the row early so the cards don't jump
  if (!items.length) document.body.classList.remove("has-work");
  requestAnimationFrame(layout);
}

/* ---------- saving ---------- */
function save(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

// Share sheet on phones when it can take these files; a normal download otherwise.
async function share(files) {
  if (!PHONE) return false;
  const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (!navigator.canShare({ files: list })) return false;
  try { await navigator.share({ files: list }); }
  catch (e) { if (e.name !== "AbortError") { console.warn("Share failed, downloading instead.", e); return false; } }
  return true;
}
async function deliver(files) {
  if (!(await share(files))) save(files[0].name, files[0].blob);
}

$("all").addEventListener("click", async () => {
  const done = items.filter((i) => i.mask), files = {}, used = new Set();
  if (PHONE) {
    const list = [];
    for (const it of done) {
      let name = outName(it);
      for (let k = 2; used.has(name); k++) name = `${it.name}-goodbye-bg-${k}.png`;
      used.add(name); list.push({ name, blob: await png(it) });
    }
    if (await share(list)) return;
    used.clear();
  }
  for (const [n, it] of done.entries()) {
    toast(`Preparing ${n + 1} of ${done.length}…`, 60_000);
    let name = outName(it);
    for (let k = 2; used.has(name); k++) name = `${it.name}-goodbye-bg-${k}.png`;
    used.add(name);
    files[name] = [new Uint8Array(await (await fullBlob(it)).arrayBuffer()), { level: 0 }];
  }
  hideToast();
  save(`goodbye-bg-${done.length}-images.zip`, new Blob([zipSync(files)], { type: "application/zip" }));
});

// No double-tap zoom: it fired on quick taps and threw the layout off. Pinch-zoom stays (people with low
// vision rely on it). Safari ignores touch-action for double taps, so a second tap within 350 ms is
// swallowed here; a press that is held is not.
let lastTap = 0;
document.addEventListener("touchend", (e) => {
  const now = e.timeStamp;
  if (now - lastTap < 350 && e.changedTouches.length === 1) e.preventDefault();
  lastTap = now;
}, { passive: false });
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

/* ---------- ways in ---------- */

// 1. Choose files (on phones this also offers the camera and photo library).
$("file").addEventListener("change", (e) => { addSources([...e.target.files]); e.target.value = ""; });

// 2. Paste anywhere: copied images, screenshots, copied files, image links, web page selections.
addEventListener("paste", async (e) => {
  const dt = e.clipboardData; if (!dt) return;
  const files = [...dt.items].filter((i) => i.kind === "file").map((i) => i.getAsFile());
  const links = files.length ? [] : linksFrom(dt.getData("text/html"), dt.getData("text/plain"));
  if (!files.length && !links.length) return; // let normal text paste happen
  e.preventDefault();
  addSources(files.length ? files : links);
});

// 3. Paste button, for phones and tablets with no keyboard.
// Shown from the start so the buttons don't shift on load; hidden only where it can't work.
if (!navigator.clipboard?.read) $("paste").hidden = true;
else {
  $("paste").addEventListener("click", async () => {
    try {
      const out = [];
      for (const item of await navigator.clipboard.read()) {
        const img = item.types.find((t) => t.startsWith("image/"));
        if (img) { out.push(await item.getType(img)); continue; }
        const html = item.types.includes("text/html") ? await (await item.getType("text/html")).text() : "";
        const text = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
        out.push(...linksFrom(html, text));
      }
      addSources(out);
    } catch { toast("Paste was blocked. Use ⌘/Ctrl + V, or allow clipboard access."); }
  });
}

// 4. Drag and drop: files, whole folders, and images dragged from other web pages.
let depth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("hot"); });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("hot"); } });
addEventListener("drop", async (e) => {
  e.preventDefault(); depth = 0; document.body.classList.remove("hot");
  if (e.dataTransfer) addSources(await fromDataTransfer(e.dataTransfer));
});


// 6. Links into the site: goodbye.bg/?url=https://… (bookmarklets, other apps).
if (params.get("url")) addSources([params.get("url")]);

// 7. Share sheet on Android, after "Add to Home screen" (see sw.js and manifest).
if (params.has("share")) {
  (async () => {
    try {
      const cache = await caches.open("share-inbox"), out = [];
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (req.url.endsWith("/text")) out.push(...linksFrom("", await res.text()));
        else out.push(new File([await res.blob()], decodeURIComponent(res.headers.get("X-Name") || "shared"), { type: res.headers.get("Content-Type") || "" }));
        await cache.delete(req);
      }
      addSources(out);
    } catch { toast("Could not read the shared image."); }
  })();
}
if (params.has("url") || params.has("share")) history.replaceState(null, "", location.pathname);

// 8. "Open with" on desktop when installed as an app.
if ("launchQueue" in window) {
  launchQueue.setConsumer(async (p) => { if (p.files?.length) addSources(await Promise.all(p.files.map((h) => h.getFile()))); });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
if (DEBUG) window.goodbye = { items, png, frame, drawMug, mugSource, mugArt }; // ?debug=1: for checking results by hand
// The frame gets its src only when ads are on, so nothing loads from the ad network otherwise.
if (ADS) { $("ad").querySelector("iframe").src = AD_SRC; $("ad").hidden = false; }

// Start loading the model right away so the first photo is fast.
loadModel().catch((e) => { console.error(e); toast("Could not load. Check your connection and reload.", 8000); });
