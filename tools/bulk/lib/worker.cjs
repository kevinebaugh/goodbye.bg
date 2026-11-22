// One photo at a time: decode (EXIF orientation applied), make the model's 1024x1024 input, ask the main thread for the
// mask, then the page's post-processing and a full-size cut-out written next to its siblings in --out.
"use strict";
const { parentPort } = require("worker_threads");
const fs = require("fs"), path = require("path");
const sharp = require("sharp");
const P = require("./pipeline.cjs");
const { RES } = P;

sharp.cache(false); // every photo is new; the cache only holds memory
let heif = null;

async function decode(src) {
  const ext = path.extname(src).toLowerCase();
  if (ext === ".heic" || ext === ".heif") {
    try { return await viaSharp(src); } catch {} // a sharp build with HEVC support, or a HEIF that is really AVIF
    heif ||= require("libheif-js/wasm-bundle");
    const images = new heif.HeifDecoder().decode(fs.readFileSync(src));
    if (!images.length) throw new Error("Could not read this HEIC photo");
    const img = images[0], w = img.get_width(), h = img.get_height(); // libheif applies the photo's rotation itself
    const data = new Uint8ClampedArray(w * h * 4);
    await new Promise((res, rej) => img.display({ data, width: w, height: h }, (d) => (d ? res() : rej(new Error("Could not read this HEIC photo")))));
    for (const i of images) i.free?.();
    return { data: Buffer.from(data.buffer), W: w, H: h };
  }
  return viaSharp(src);
}

async function viaSharp(src) {
  const { data, info } = await sharp(src, { failOn: "none", limitInputPixels: false, animated: false })
    .rotate() // EXIF orientation
    .toColourspace("srgb").ensureAlpha().raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Unexpected ${info.channels} channels`);
  return { data, W: info.width, H: info.height };
}

// The page keeps a bitmap of at most 1600 px (resizeQuality high) and draws that to 1024x1024, stretched.
async function modelInput(data, W, H) {
  const raw = (w, h) => ({ raw: { width: w, height: h, channels: 4 } });
  const k = Math.min(1, 1600 / Math.max(W, H));
  let src = data, w = W, h = H;
  if (k < 1) {
    w = Math.max(1, Math.round(W * k)); h = Math.max(1, Math.round(H * k));
    src = await sharp(data, raw(W, H)).resize(w, h, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  }
  const px = new Uint8ClampedArray(await sharp(src, raw(w, h)).resize(RES, RES, { fit: "fill", kernel: "linear" }).raw().toBuffer());
  P.onBackdrop(px);
  return px;
}

const pending = new Map();
let nextId = 0;
const askMask = (px) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  const input = new Uint8Array(px.buffer, px.byteOffset, px.byteLength).slice(); // px is used again for the edge colors
  parentPort.postMessage({ type: "infer", id, px: input }, [input.buffer]);
});

async function job({ src, dst, tmp, o }) {
  const t0 = performance.now();
  const { data, W, H } = await decode(src);
  const px = await modelInput(data, W, H);
  const tDecoded = performance.now();
  const mask = await askMask(px);
  const tMasked = performance.now();
  const { alpha, box } = P.postprocess(mask, o.harden);
  const fix = P.edgeColors(px, alpha);
  // Full size: the mask and the edge colors scaled up to the photo (the page draws them with smoothing on).
  const up = async (buf, ch) => {
    let s = sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), { raw: { width: RES, height: RES, channels: ch } }).resize(W, H, { fit: "fill", kernel: "mitchell" });
    if (ch === 1) s = s.extractChannel(0); // sharp hands one-channel images back as three
    return s.raw().toBuffer();
  };
  const a = await up(alpha, 1), f = await up(fix, 4);
  if (a.length !== W * H || f.length !== W * H * 4) throw new Error("Unexpected mask size");
  // source-atop: the estimated edge color over the photo; destination-in: the mask becomes the alpha.
  const bg = o.bg;
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    const fa = f[j + 3];
    if (fa) { const t = fa / 255, s = 1 - t; data[j] = f[j] * t + data[j] * s; data[j + 1] = f[j + 1] * t + data[j + 1] * s; data[j + 2] = f[j + 2] * t + data[j + 2] * s; }
    let al = (data[j + 3] * a[i]) / 255;
    if (bg) { const t = al / 255, s = 1 - t; data[j] = data[j] * t + bg[0] * s; data[j + 1] = data[j + 1] * t + bg[1] * s; data[j + 2] = data[j + 2] * t + bg[2] * s; al = 255; }
    data[j + 3] = al;
  }
  const fill = bg ? { r: bg[0], g: bg[1], b: bg[2], alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
  let img = sharp(data, { raw: { width: W, height: H, channels: 4 } });
  let outW = W, outH = H;
  if (o.size && box) {
    // The subject, scaled to fit inside the size less the padding on each side, centred.
    const left = Math.floor(box.x0 * W), top = Math.floor(box.y0 * H);
    const rw = Math.max(1, Math.min(W - left, Math.ceil(box.x1 * W) - left)), rh = Math.max(1, Math.min(H - top, Math.ceil(box.y1 * H) - top));
    const [TW, TH] = o.size, iw = TW * (1 - 2 * o.pad), ih = TH * (1 - 2 * o.pad), s = Math.min(iw / rw, ih / rh);
    const w = Math.max(1, Math.min(TW, Math.round(rw * s))), h = Math.max(1, Math.min(TH, Math.round(rh * s)));
    const part = await img.extract({ left, top, width: rw, height: rh }).resize(w, h, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
    const l = Math.floor((TW - w) / 2), t = Math.floor((TH - h) / 2);
    img = sharp(part, { raw: { width: w, height: h, channels: 4 } }).extend({ left: l, top: t, right: TW - w - l, bottom: TH - h - t, background: fill });
    outW = TW; outH = TH;
  } else if (o.size) {
    img = sharp({ create: { width: o.size[0], height: o.size[1], channels: 4, background: fill } });
    outW = o.size[0]; outH = o.size[1];
  } else if (o.crop && box) {
    const r = P.frame(box, W, H);
    img = img.extract(r); outW = r.width; outH = r.height;
  }
  if (o.format === "png") img = img.png();
  else if (o.format === "webp") img = img.webp({ quality: 90, alphaQuality: 100 });
  else img = img.flatten({ background: fill }).jpeg({ quality: 92 }); // the page saves backgrounds as JPEG 0.92
  await img.toFile(tmp);
  fs.renameSync(tmp, dst);
  const tEnd = performance.now();
  return { W, H, outW, outH, empty: !box, decodeMs: tDecoded - t0, waitMs: tMasked - tDecoded, postMs: tEnd - tMasked };
}

parentPort.on("message", async (m) => {
  if (m.type === "mask" || m.type === "maskerr") {
    const p = pending.get(m.id); pending.delete(m.id);
    return m.type === "mask" ? p.resolve(m.mask) : p.reject(new Error(m.error));
  }
  if (m.type !== "job") return;
  try {
    const r = await job(m);
    parentPort.postMessage({ type: "done", key: m.key, ...r });
  } catch (e) {
    try { fs.rmSync(m.tmp, { force: true }); } catch {}
    parentPort.postMessage({ type: "fail", key: m.key, error: String(e?.message || e) });
  }
});
