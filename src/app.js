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
function dbg(step, data = {}) {
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
      // ?threads=N to test. 4 threads: 3.5 s a photo on an iPhone (1: 7.3 s, 2: 5.0 s), no crash.
      threads: +params.get("threads") || 4 });
  });
}

function loadModel() {
  if (!engineReady) {
    engineReady = (async () => {
      const name = await pickEngine();
      try { await startEngine(name); }
      catch (e) {
        if (name !== "gpu") throw e;
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
  dbg("segment", { w: bitmap.width, h: bitmap.height, coi: self.crossOriginIsolated, threads: +params.get("threads") || 4 });
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
}

// The background wipes away, then the view eases in to the crop.
function reveal(it) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return drawCard(it);
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
  const big = await fullBitmap(it);
  try {
    const f = frame(it), full = render(it, it.w, it.h, big);
    if (f.w === it.w && f.h === it.h) return await full.convertToBlob({ type: "image/png" });
    const out = new OffscreenCanvas(f.w, f.h);
    out.getContext("2d").drawImage(full, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    return await out.convertToBlob({ type: "image/png" });
  } finally { big.close(); }
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
  const batch = list.map((src) => {
    const it = { id: ++uid, name: "image", bmp: null, blob: null, w: 0, h: 0, mask: null, crop: true };
    items.push(it);
    $("grid").prepend(makeCard(it));
    it.name = baseName(src instanceof Blob ? src.name : String(src).startsWith("data:") ? "pasted" : String(src));
    return [it, src];
  });
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
  const crop = document.createElement("button"); crop.type = "button"; crop.className = "crop"; crop.hidden = true;
  crop.setAttribute("aria-label", "Crop to subject"); crop.setAttribute("aria-pressed", "true");
  crop.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>';
  pic.append(canvas, busy, crop, x);
  const bar = document.createElement("div"); bar.className = "bar";
  const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn primary"; dl.textContent = "Download"; dl.disabled = true;
  const up = document.createElement("button"), down = document.createElement("button");
  for (const [b, label, emoji] of [[up, "Good result", "👍"], [down, "Bad result, try again", "👎"]]) {
    b.type = "button"; b.className = "rate"; b.textContent = emoji; b.hidden = true;
    b.setAttribute("aria-label", label); b.title = label;
  }
  up.addEventListener("click", () => rate(it, "up"));
  down.addEventListener("click", () => rate(it, "down"));
  const rates = document.createElement("div"); rates.className = "rates"; rates.append(up, down);
  pic.append(rates);
  bar.append(dl);
  card.append(pic, bar);

  crop.addEventListener("click", () => {
    it.crop = !it.crop; crop.setAttribute("aria-pressed", String(it.crop));
    it.png = null; drawCard(it); if (PHONE) png(it);
  });
  x.addEventListener("click", () => { clearInterval(it.quip); items.splice(items.indexOf(it), 1); card.remove(); sync(); });
  dl.addEventListener("click", async () => deliver([{ name: outName(it), blob: await png(it) }]));

  it.el = { card, canvas, busy, dl, crop, up, down };
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
    for (const it of [...items]) {
      if (it.mask || it.failed || !it.bmp) continue;
      startQuips(it);
      await nextFrame();
      try { it.mask = await segment(it.bmp); }
      catch (e) { console.error(e); fail(it, "Could not process this image."); continue; }
      if (!it.mask.box) { it.mask = null; fail(it, "No clear subject in this photo."); continue; }
      if (!items.includes(it)) continue;
      clearInterval(it.quip);
      it.el.busy.hidden = true; it.el.dl.disabled = false; it.el.crop.hidden = !it.mask.box;
      it.el.up.hidden = it.el.down.hidden = false; it.ms = lastMs;
      dbg("shown");
      dbg("reveal"); reveal(it); sync();
      it.el.card.dataset.ms = lastMs;
    }
  } finally { running = false; }
  if (items.some((i) => i.bmp && !i.mask && !i.failed)) return run();
  if (PHONE) for (const it of items) if (it.mask) png(it); // after the batch: don't compete with the model
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
  up.disabled = down.disabled = true;
  (vote === "up" ? up : down).classList.add("chosen");
  sendRating(it, vote);
  if (vote === "down" && !it.retried) await retry(it);
}

async function retry(it) {
  const s = subject(it);
  if (!s) return;
  // Zoom to the subject with generous room; skip if that is most of the photo anyway.
  const padX = 0.15 * (s.x1 - s.x0), padY = 0.15 * (s.y1 - s.y0);
  const x0 = Math.max(0, s.x0 - padX), y0 = Math.max(0, s.y0 - padY), x1 = Math.min(1, s.x1 + padX), y1 = Math.min(1, s.y1 + padY);
  if ((x1 - x0) * (y1 - y0) > 0.8) return;
  it.retried = true;
  const { busy, up, down, dl } = it.el;
  busy.textContent = QUIPS[Math.floor(Math.random() * QUIPS.length)]; busy.hidden = false; dl.disabled = true;
  try {
    const sx = Math.round(x0 * it.w), sy = Math.round(y0 * it.h), sw = Math.max(1, Math.round((x1 - x0) * it.w)), sh = Math.max(1, Math.round((y1 - y0) * it.h));
    const big = await fullBitmap(it), sc = big.width / it.w; // decoded size can exceed the working size
    const part = await createImageBitmap(big, Math.round(sx * sc), Math.round(sy * sc), Math.max(1, Math.round(sw * sc)), Math.max(1, Math.round(sh * sc)));
    big.close();
    const m = await segment(part);
    if (m.box) { it.mask = m; it.maskRect = { x: sx / it.w, y: sy / it.h, w: sw / it.w, h: sh / it.h }; it.ms = lastMs; it.png = null; }
  } catch (e) { console.warn("Retry failed", e); }
  busy.hidden = true; dl.disabled = false;
  if (!items.includes(it)) return;
  reveal(it);
  if (PHONE) png(it);
  up.disabled = down.disabled = false; up.classList.remove("chosen"); down.classList.remove("chosen");
}

// Everything fits on one screen: cards are square and sized so they all fit the space left.
// Only past a minimum size (dozens of photos on a phone) does the grid scroll.
const GAP = 12, MIN_PIC = 96, MAX_PIC = 640;
function layout() {
  const g = $("grid"), n = g.children.length;
  if (!n) return;
  const bar = g.querySelector(".bar")?.offsetHeight || 52, W = g.clientWidth, H = g.clientHeight;
  let best = { p: 0, c: 1 };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), p = Math.floor(Math.min((W - GAP * (c - 1)) / c, (H - GAP * (r - 1)) / r - bar));
    if (p > best.p) best = { p, c };
  }
  const scroll = best.p < MIN_PIC, p = Math.min(MAX_PIC, Math.max(best.p, MIN_PIC));
  const c = scroll ? Math.max(1, Math.floor((W + GAP) / (p + GAP))) : best.c;
  g.classList.toggle("scroll", scroll);
  g.style.setProperty("--cols", c); g.style.setProperty("--p", `${p}px`);
}
new ResizeObserver(layout).observe($("grid"));

function sync() {
  const done = items.filter((i) => i.mask).length;
  $("all").hidden = false;
  $("all").style.visibility = done < 2 ? "hidden" : "";
  $("all").textContent = `Download all (${done})`;
  $("tools").hidden = items.length < 2; // reserve the row early so the grid doesn't jump
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

// Never zoom. Safari ignores user-scalable=no, so stop its pinch gestures here (CSS stops double-tap zoom).
for (const t of ["gesturestart", "gesturechange"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

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
// The frame gets its src only when ads are on, so nothing loads from the ad network otherwise.
if (ADS) { $("ad").querySelector("iframe").src = AD_SRC; $("ad").hidden = false; }

// Start loading the model right away so the first photo is fast.
loadModel().catch((e) => { console.error(e); toast("Could not load. Check your connection and reload.", 8000); });
