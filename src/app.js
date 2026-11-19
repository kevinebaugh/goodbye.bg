// goodbye.bg — background removal that runs entirely in the browser.
// Nothing in this file sends image data anywhere. The page's Content-Security-Policy
// (see _headers) only allows network requests back to this site.

import * as ort from "./ort/ort.wasm.min.mjs";
import { zipSync } from "./vendor/fflate.mjs";

const RES = 1024;            // model input size
const MAX_SIDE = 8192;       // larger images are scaled down to fit in memory
const PREVIEW_SIDE = 900;    // card preview size
const CUTOFF = 0.5, SOFTNESS = 0.6;
const ADS = false;           // set true once ad.html holds a real ad tag

const $ = (id) => document.getElementById(id);
const items = [];
let bg = "";                 // "" = transparent, else a CSS color
let session = null, loading = null, running = false, uid = 0;

/* ---------- small helpers ---------- */
function toast(msg, ms = 3000) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function status(msg) { $("status").textContent = msg; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ---------- model ---------- */
async function loadModel() {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    ort.env.wasm.wasmPaths = new URL("./ort/", location.href).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    const manifest = await (await fetch("m/manifest.json")).json();
    let got = 0; const parts = [];
    for (const p of manifest.parts) {
      const res = await fetch("m/" + p);
      if (!res.ok) throw new Error(`Could not load ${p} (${res.status})`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        status(`Loading the model, one time only: ${Math.round((got / manifest.size) * 100)}%`);
      }
    }
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    status("Starting the model…");
    const opts = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    try {
      ort.env.wasm.proxy = true; // run in a worker so the page stays responsive
      session = await ort.InferenceSession.create(bytes.slice(0), opts);
    } catch (e) {
      console.warn("Worker mode failed, using the main thread.", e);
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(bytes, opts);
    }
    status("Ready. Everything runs on this device.");
    return session;
  })();
  try { return await loading; } catch (e) { loading = null; status("The model did not load. Reload the page to try again."); throw e; }
}

async function segment(bitmap) {
  const s = await loadModel();
  const c = new OffscreenCanvas(RES, RES), x = c.getContext("2d");
  x.drawImage(bitmap, 0, 0, RES, RES);
  const px = x.getImageData(0, 0, RES, RES).data, n = RES * RES;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = (px[i * 4] - 128) / 256;
    input[i + n] = (px[i * 4 + 1] - 128) / 256;
    input[i + 2 * n] = (px[i * 4 + 2] - 128) / 256;
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, RES, RES]) }, ["output"]);
  const m = out.output.data;
  const id = new ImageData(RES, RES);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    id.data[k] = id.data[k + 1] = id.data[k + 2] = 255;
    id.data[k + 3] = Math.max(0, Math.min(255, m[i] * 255));
  }
  despeck(id);
  const mask = new OffscreenCanvas(RES, RES);
  mask.getContext("2d").putImageData(id, 0, 0);
  return mask;
}

// Remove small islands that are not part of the main subject.
function despeck(img) {
  const n = RES * RES, d = img.data, lab = new Int32Array(n), stack = new Int32Array(n), sizes = [0];
  const on = (i) => d[i * 4 + 3] >= 25;
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
    if ((l && sizes[l] < big * 0.015) || (!l && d[i * 4 + 3] > 0)) d[i * 4 + 3] = 0;
  }
}

/* ---------- compositing ---------- */
const LUT = (() => {
  const lo = Math.max(0, CUTOFF - SOFTNESS / 2), hi = Math.min(1, CUTOFF + SOFTNESS / 2), t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let u = (v / 255 - lo) / (hi - lo); u = Math.max(0, Math.min(1, u)); t[v] = Math.round(u * u * (3 - 2 * u) * 255); }
  return t;
})();

function render(it, W, H) {
  const m = new OffscreenCanvas(W, H), mx = m.getContext("2d", { willReadFrequently: true });
  mx.imageSmoothingQuality = "high";
  mx.drawImage(it.mask, 0, 0, W, H);
  const a = mx.getImageData(0, 0, W, H).data;

  const fg = new OffscreenCanvas(W, H), fx = fg.getContext("2d", { willReadFrequently: true });
  fx.imageSmoothingQuality = "high";
  fx.drawImage(it.bmp, 0, 0, W, H);
  const id = fx.getImageData(0, 0, W, H);
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = LUT[a[i]];
  fx.putImageData(id, 0, 0);

  if (!bg) return fg;
  const out = new OffscreenCanvas(W, H), ox = out.getContext("2d");
  ox.fillStyle = bg; ox.fillRect(0, 0, W, H); ox.drawImage(fg, 0, 0);
  return out;
}

function previewSize(it) {
  const k = Math.min(1, PREVIEW_SIDE / Math.max(it.w, it.h));
  return [Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k))];
}

function drawCard(it) {
  const [W, H] = previewSize(it), c = it.el.canvas;
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.clearRect(0, 0, W, H);
  if (it.mask && !it.showOriginal) x.drawImage(render(it, W, H), 0, 0);
  else x.drawImage(it.bmp, 0, 0, W, H);
}

async function fullBlob(it) {
  return render(it, it.w, it.h).convertToBlob({ type: "image/png" });
}

/* ---------- cards ---------- */
function makeCard(it) {
  const card = document.createElement("article"); card.className = "card";
  const pic = document.createElement("div"); pic.className = "pic";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", it.name);
  const busy = document.createElement("div"); busy.className = "busy"; busy.textContent = "Removing background…";
  pic.append(canvas, busy);
  const bar = document.createElement("div"); bar.className = "bar";
  const name = document.createElement("span"); name.className = "name"; name.textContent = it.name;
  const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn primary"; dl.textContent = "Download"; dl.disabled = true;
  bar.append(name, dl);
  card.append(pic, bar);

  const show = (v) => { if (it.mask) { it.showOriginal = v; drawCard(it); } };
  pic.addEventListener("pointerdown", (e) => { pic.setPointerCapture(e.pointerId); show(true); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) pic.addEventListener(t, () => show(false));
  pic.addEventListener("contextmenu", (e) => e.preventDefault());
  dl.addEventListener("click", async () => save(`${it.name}-goodbye-bg.png`, await fullBlob(it)));

  it.el = { card, canvas, busy, dl, name };
  return card;
}

async function addFiles(files) {
  const list = [...files].filter((f) => f && f.type.startsWith("image/"));
  if (!list.length) { toast("That is not an image this browser can read. Try JPG, PNG or WebP."); return; }
  $("drop").hidden = true; $("work").hidden = false;
  for (const f of list) {
    let bmp;
    try { bmp = await createImageBitmap(f); }
    catch { toast(`Could not read ${f.name}. Try JPG, PNG or WebP.`); continue; }
    let { width: w, height: h } = bmp;
    if (Math.max(w, h) > MAX_SIDE) {
      const k = MAX_SIDE / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
      bmp = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    }
    const it = { id: ++uid, name: (f.name || "image").replace(/\.[^.]+$/, "") || "image", bmp, w, h, mask: null, showOriginal: false };
    items.push(it);
    $("grid").append(makeCard(it));
    drawCard(it);
  }
  syncAll();
  run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (const it of items) {
      if (it.mask || it.failed) continue;
      await nextFrame();
      try { it.mask = await segment(it.bmp); }
      catch (e) {
        console.error(e); it.failed = true;
        it.el.busy.textContent = "Could not process this image.";
        continue;
      }
      if (!items.includes(it)) continue;
      it.el.busy.hidden = true; it.el.dl.disabled = false;
      drawCard(it); syncAll();
    }
  } finally { running = false; }
  if (items.some((i) => !i.mask && !i.failed)) run();
}

function syncAll() {
  const done = items.filter((i) => i.mask).length;
  $("all").hidden = done < 2;
  $("all").textContent = `Download all (${done})`;
}

/* ---------- saving ---------- */
function save(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

$("all").addEventListener("click", async () => {
  const done = items.filter((i) => i.mask), files = {}, used = new Set();
  for (const [n, it] of done.entries()) {
    toast(`Preparing ${n + 1} of ${done.length}…`, 60_000);
    let name = `${it.name}-goodbye-bg.png`;
    for (let k = 2; used.has(name); k++) name = `${it.name}-goodbye-bg-${k}.png`;
    used.add(name);
    files[name] = [new Uint8Array(await (await fullBlob(it)).arrayBuffer()), { level: 0 }];
  }
  save(`goodbye-bg-${done.length}-images.zip`, new Blob([zipSync(files)], { type: "application/zip" }));
  toast("Done.");
});

/* ---------- background chips ---------- */
function setBg(v) {
  bg = v;
  for (const b of document.querySelectorAll(".chip[data-bg]")) b.setAttribute("aria-pressed", b.dataset.bg === v);
  document.querySelector(".chip.pick").classList.toggle("on", !!v && ![...document.querySelectorAll(".chip[data-bg]")].some((b) => b.dataset.bg === v));
  for (const it of items) drawCard(it);
}
for (const b of document.querySelectorAll(".chip[data-bg]")) b.addEventListener("click", () => setBg(b.dataset.bg));
$("color").addEventListener("input", (e) => setBg(e.target.value));

/* ---------- input ---------- */
$("file").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
$("clear").addEventListener("click", () => {
  items.length = 0; $("grid").textContent = ""; $("work").hidden = true; $("drop").hidden = false; syncAll();
});
let depth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("hot"); });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("hot"); } });
addEventListener("drop", (e) => {
  e.preventDefault(); depth = 0; document.body.classList.remove("hot");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile());
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ---------- ads ---------- */
if (ADS) $("ad").hidden = false;

// Start loading the model right away so the first photo is fast.
loadModel().catch((e) => { console.error(e); toast("The model did not load. Check your connection and reload.", 8000); });
