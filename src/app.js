// goodbye.bg — background removal that runs entirely in the browser.
// Photos from the device never leave it. The page's Content-Security-Policy (see _headers)
// only allows requests back to this site. The one server call is /api/fetch, used only
// when the visitor gives us a link to an image that lives on another site.

import * as ort from "./ort/ort.webgpu.min.mjs";
import { zipSync } from "./vendor/fflate.mjs";

const RES = 1024;            // model input size
const MAX_SIDE = 8192;       // larger images are scaled down to fit in memory
const MAX_BATCH = 50;        // images per drop or paste
const PREVIEW_SIDE = 900;    // card preview size
const CUTOFF = 0.5, SOFTNESS = 0.6;
const ADS = false;           // set true once ad.html holds a real ad tag

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
let white = false;
let session = null, loading = null, running = false, uid = 0, lastMs = 0;

/* ---------- small helpers ---------- */
function toast(msg, ms = 3500) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function status(msg) { $("status").textContent = msg; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const baseName = (s) => (s || "image").split(/[\\/?#]/).filter(Boolean).pop()?.replace(/\.[^.]+$/, "").slice(0, 80) || "image";

/* ---------- model ----------
   Two engines. Phones and computers with WebGPU (most current browsers) run BiRefNet on
   the GPU: best edges, a few seconds or less. Everything else runs IMG.LY's ISNet on the
   CPU. Add ?engine=gpu or ?engine=cpu to the address to force one when testing. */

const ENGINES = {
  gpu: { dir: "m/birefnet/", ep: "webgpu", mean: [0.485 * 255, 0.456 * 255, 0.406 * 255], std: [0.229 * 255, 0.224 * 255, 0.225 * 255], logits: true },
  cpu: { dir: "m/isnet/", ep: "wasm", mean: [128, 128, 128], std: [256, 256, 256], logits: false },
};
let engine = null;

async function pickEngine() {
  const forced = new URLSearchParams(location.search).get("engine");
  if (forced in ENGINES) return forced;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter?.features.has("shader-f16")) return "gpu";
  } catch {}
  return "cpu";
}

async function fetchModel(dir) {
  const manifest = await (await fetch(dir + "manifest.json")).json();
  let got = 0; const parts = [];
  for (const p of manifest.parts) {
    const res = await fetch(dir + p);
    if (!res.ok) throw new Error(`Could not load ${p} (${res.status})`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      status(`Getting ready, one time only: ${Math.round((got / manifest.size) * 100)}%`);
    }
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

async function loadModel() {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    ort.env.wasm.wasmPaths = new URL("./ort/", location.href).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    let name = await pickEngine();
    for (;;) {
      engine = ENGINES[name];
      try {
        const bytes = await fetchModel(engine.dir);
        status("Starting up…");
        const opts = { executionProviders: [engine.ep], graphOptimizationLevel: "all" };
        if (engine.ep === "wasm") {
          try { ort.env.wasm.proxy = true; session = await ort.InferenceSession.create(bytes.slice(0), opts); } // worker keeps the page smooth
          catch (e) { console.warn("Worker mode failed, using the main thread.", e); ort.env.wasm.proxy = false; session = await ort.InferenceSession.create(bytes, opts); }
        } else {
          session = await ort.InferenceSession.create(bytes, opts);
        }
        break;
      } catch (e) {
        if (name === "gpu") { console.warn("GPU engine failed, falling back to CPU.", e); name = "cpu"; continue; }
        throw e;
      }
    }
    status(name === "gpu" ? "Ready. Running on your GPU." : "Ready. Running on your CPU.");
    return session;
  })();
  try { return await loading; } catch (e) { loading = null; status("Could not load. Reload the page to try again."); throw e; }
}

async function segment(bitmap) {
  const s = await loadModel();
  const c = new OffscreenCanvas(RES, RES), x = c.getContext("2d");
  x.drawImage(bitmap, 0, 0, RES, RES);
  const px = x.getImageData(0, 0, RES, RES).data, n = RES * RES;
  const { mean, std, logits } = engine;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = (px[i * 4] - mean[0]) / std[0];
    input[i + n] = (px[i * 4 + 1] - mean[1]) / std[1];
    input[i + 2 * n] = (px[i * 4 + 2] - mean[2]) / std[2];
  }
  const t0 = performance.now();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, RES, RES]) }, [s.outputNames[0]]);
  const m = await out[s.outputNames[0]].getData();
  lastMs = Math.round(performance.now() - t0);
  const id = new ImageData(RES, RES);
  for (let i = 0; i < n; i++) {
    const k = i * 4, v = logits ? 1 / (1 + Math.exp(-m[i])) : m[i];
    id.data[k] = id.data[k + 1] = id.data[k + 2] = 255;
    id.data[k + 3] = Math.max(0, Math.min(255, v * 255));
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

  if (!white) return fg;
  const out = new OffscreenCanvas(W, H), ox = out.getContext("2d");
  ox.fillStyle = "#fff"; ox.fillRect(0, 0, W, H); ox.drawImage(fg, 0, 0);
  return out;
}

function drawCard(it) {
  const k = Math.min(1, PREVIEW_SIDE / Math.max(it.w, it.h));
  const W = Math.max(1, Math.round(it.w * k)), H = Math.max(1, Math.round(it.h * k)), c = it.el.canvas;
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.clearRect(0, 0, W, H);
  if (it.mask && !it.showOriginal) x.drawImage(render(it, W, H), 0, 0);
  else x.drawImage(it.bmp, 0, 0, W, H);
}

// The background waves goodbye: a quick diagonal wipe from original to cutout.
// Purely visual. Download is already enabled, and it skips for reduced motion.
function reveal(it) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return drawCard(it);
  drawCard(it);
  const c = it.el.canvas, x = c.getContext("2d"), W = c.width, H = c.height;
  const cut = render(it, W, H), slant = H * 0.4, t0 = performance.now(), D = 450;
  const step = (now) => {
    if (it.showOriginal) return drawCard(it);
    const t = 1 - (1 - Math.min(1, (now - t0) / D)) ** 3, edge = t * (W + slant);
    x.clearRect(0, 0, W, H);
    x.drawImage(it.bmp, 0, 0, W, H);
    x.save();
    x.beginPath(); x.moveTo(0, 0); x.lineTo(edge, 0); x.lineTo(edge - slant, H); x.lineTo(0, H); x.closePath(); x.clip();
    x.clearRect(0, 0, W, H); x.drawImage(cut, 0, 0);
    x.restore();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const fullBlob = (it) => render(it, it.w, it.h).convertToBlob({ type: "image/png" });
const outName = (it) => `${it.name}-goodbye-bg.png`;

/* ---------- getting images in ----------
   Every way in ends at addSources(list), where each entry is a File/Blob or a string
   (http(s) link, data: URL, or blob: URL). */

async function addSources(list, origin = "") {
  list = list.filter(Boolean).slice(0, MAX_BATCH);
  if (!list.length) { toast("No image found there. Try a photo file, a copied image, or an image link."); return; }
  show();
  for (const src of list) {
    const it = { id: ++uid, name: "image", bmp: null, w: 0, h: 0, mask: null, showOriginal: false };
    items.push(it);
    $("grid").prepend(makeCard(it));
    it.name = baseName(src instanceof Blob ? src.name : String(src).startsWith("data:") ? "pasted" : String(src));
    it.el.name.textContent = it.name;
    try {
      const { blob, name } = await toBlob(src);
      it.name = baseName(name);
      it.el.name.textContent = it.name;
      let bmp = await decode(blob);
      let { width: w, height: h } = bmp;
      if (Math.max(w, h) > MAX_SIDE) {
        const k = MAX_SIDE / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
        bmp = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      }
      Object.assign(it, { bmp, w, h });
      it.el.busy.textContent = QUIPS[Math.floor(Math.random() * QUIPS.length)];
      drawCard(it);
    } catch (e) {
      console.warn(e);
      fail(it, e.message || "Could not open this image.");
    }
  }
  sync();
  run();
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
  let line = Math.floor(Math.random() * QUIPS.length);
  busy.textContent = it.bmp ? QUIPS[line] : "Fetching…";
  it.quip = setInterval(() => { if (it.bmp && !it.failed) busy.textContent = QUIPS[++line % QUIPS.length]; }, 1600);
  const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "Remove");
  pic.append(canvas, busy, x);
  const bar = document.createElement("div"); bar.className = "bar";
  const name = document.createElement("span"); name.className = "name"; name.textContent = "…";
  const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn primary"; dl.textContent = "Download"; dl.disabled = true;
  bar.append(name, dl);
  card.append(pic, bar);

  const peek = (v) => { if (it.mask) { it.showOriginal = v; drawCard(it); } };
  pic.addEventListener("pointerdown", (e) => { if (e.target === x) return; pic.setPointerCapture(e.pointerId); peek(true); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) pic.addEventListener(t, () => peek(false));
  pic.addEventListener("contextmenu", (e) => e.preventDefault());
  x.addEventListener("click", () => { clearInterval(it.quip); items.splice(items.indexOf(it), 1); card.remove(); sync(); });
  dl.addEventListener("click", async () => save(outName(it), await fullBlob(it)));

  it.el = { card, canvas, busy, dl, name };
  return card;
}

function fail(it, msg) {
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
      await nextFrame();
      try { it.mask = await segment(it.bmp); }
      catch (e) { console.error(e); fail(it, "Could not process this image."); continue; }
      if (!items.includes(it)) continue;
      clearInterval(it.quip);
      it.el.busy.hidden = true; it.el.dl.disabled = false;
      reveal(it); sync();
      it.el.card.dataset.ms = lastMs;
    }
  } finally { running = false; }
  if (items.some((i) => i.bmp && !i.mask && !i.failed)) run();
}

function show() { document.body.classList.add("has-work"); }
function sync() {
  const done = items.filter((i) => i.mask).length;
  $("all").hidden = done < 2;
  $("all").textContent = `Download all (${done})`;
  $("tools").hidden = items.length === 0;
  if (!items.length) document.body.classList.remove("has-work");
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
    let name = outName(it);
    for (let k = 2; used.has(name); k++) name = `${it.name}-goodbye-bg-${k}.png`;
    used.add(name);
    files[name] = [new Uint8Array(await (await fullBlob(it)).arrayBuffer()), { level: 0 }];
  }
  save(`goodbye-bg-${done.length}-images.zip`, new Blob([zipSync(files)], { type: "application/zip" }));
  toast("All yours. Backgrounds gone. 👋");
});

$("white").addEventListener("change", (e) => { white = e.target.checked; for (const it of items) if (it.bmp) drawCard(it); });

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
  if (e.target === $("link")) $("link").value = "";
  addSources(files.length ? files : links);
});

// 3. Paste button, for phones and tablets with no keyboard.
if (navigator.clipboard?.read) {
  $("paste").hidden = false;
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

// 5. Type or paste a link and press Enter.
$("linkform").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("link").value.trim(); if (!v) return;
  $("link").value = "";
  addSources(linksFrom("", v).length ? linksFrom("", v) : [v.startsWith("http") ? v : "https://" + v]);
});

// 6. Links into the site: goodbye.bg/?url=https://… (bookmarklets, other apps).
const params = new URLSearchParams(location.search);
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
if (ADS) $("ad").hidden = false;

// Start loading the model right away so the first photo is fast.
loadModel().catch((e) => { console.error(e); toast("Could not load. Check your connection and reload.", 8000); });
