// One photo at a time: decode (EXIF orientation applied), make the model's 1024x1024 input, ask the main thread for the
// mask, then the page's post-processing and a full-size cut-out. Two kinds of job: "job" (folder mode: a file in, a
// file written in --out) and "api" (serve: image bytes in, the remove.bg-style result handed back).
"use strict";
const { parentPort } = require("worker_threads");
const fs = require("fs"), path = require("path");
const sharp = require("sharp");
const P = require("./pipeline.cjs");
const { RES } = P;

sharp.cache(false); // every photo is new; the cache only holds memory
let heif = null;

// src: a file path or a Buffer. HEIC goes to libheif-js when sharp can't read it (prebuilt sharp has no HEVC decoder).
async function decode(src) {
  const heic = Buffer.isBuffer(src) ? isHeif(src) : [".heic", ".heif"].includes(path.extname(src).toLowerCase());
  if (heic) {
    try { return await viaSharp(src); } catch {} // a sharp build with HEVC support, or a HEIF that is really AVIF
    heif ||= require("libheif-js/wasm-bundle");
    const images = new heif.HeifDecoder().decode(Buffer.isBuffer(src) ? src : fs.readFileSync(src));
    if (!images.length) throw new Error("Could not read this HEIC photo");
    const img = images[0], w = img.get_width(), h = img.get_height(); // libheif applies the photo's rotation itself
    const data = new Uint8ClampedArray(w * h * 4);
    await new Promise((res, rej) => img.display({ data, width: w, height: h }, (d) => (d ? res() : rej(new Error("Could not read this HEIC photo")))));
    for (const i of images) i.free?.();
    return { data: Buffer.from(data.buffer), W: w, H: h };
  }
  return viaSharp(src);
}

// An ISO-BMFF file with a HEIF brand ("ftypheic", "ftypmif1", ...).
const isHeif = (b) => b.length > 12 && b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(b.toString("latin1", 8, 12));

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

// The cut-out at full size: the model's mask, the page's post-processing, the edge colours, the mask as alpha. data
// (RGBA, W x H) is changed in place. bg: [r, g, b] fills the background as the page does; bg4: [r, g, b, a] a
// see-through fill (serve's bg_color with alpha). roi: [x0, y0, x1, y1] in image pixels; the mask is cleared outside.
async function cutout(data, W, H, { harden, bg, bg4, roi }) {
  const px = await modelInput(data, W, H);
  const tDecoded = performance.now();
  const mask = await askMask(px);
  const tMasked = performance.now();
  if (roi) {
    const x0 = Math.floor((roi[0] / W) * RES), y0 = Math.floor((roi[1] / H) * RES), x1 = Math.ceil((roi[2] / W) * RES), y1 = Math.ceil((roi[3] / H) * RES);
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) mask[y * RES + x] = 0;
  }
  const { alpha, box } = P.postprocess(mask, harden);
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
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    const fa = f[j + 3];
    if (fa) { const t = fa / 255, s = 1 - t; data[j] = f[j] * t + data[j] * s; data[j + 1] = f[j + 1] * t + data[j + 1] * s; data[j + 2] = f[j + 2] * t + data[j + 2] * s; }
    let al = (data[j + 3] * a[i]) / 255;
    if (bg) { const t = al / 255, s = 1 - t; data[j] = data[j] * t + bg[0] * s; data[j + 1] = data[j + 1] * t + bg[1] * s; data[j + 2] = data[j + 2] * t + bg[2] * s; al = 255; }
    else if (bg4) { // the cut-out over a see-through colour
      const t = al / 255, b = (bg4[3] / 255) * (1 - t), o = t + b;
      if (o > 0) { data[j] = (data[j] * t + bg4[0] * b) / o; data[j + 1] = (data[j + 1] * t + bg4[1] * b) / o; data[j + 2] = (data[j + 2] * t + bg4[2] * b) / o; }
      al = o * 255;
    }
    data[j + 3] = al;
  }
  return { box, tDecoded, tMasked };
}

// Folder mode: one file in, one cut-out written whole to tmp and renamed to dst.
async function job({ src, dst, tmp, o }) {
  const t0 = performance.now();
  const { data, W, H } = await decode(src);
  const bg = o.bg;
  const { box, tDecoded, tMasked } = await cutout(data, W, H, { harden: o.harden, bg });
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

// ---- serve: the remove.bg API's image work (lib/api.cjs checks the parameters first) ----

const { ApiError } = require("./api.cjs");
const S = require("./shadow.cjs");

// The subject's box at full size: every pixel at least 8 of 255 opaque (fainter is upscaling ringing).
function fgBox(data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0, j = 3; y < H; y++) for (let x = 0; x < W; x++, j += 4) {
    if (data[j] < 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const toPx = ({ v, unit }, ref) => (unit === "%" ? (v / 100) * ref : v);

// o (from lib/api.cjs): harden, roi, channels, crop, margin, scale, position, bg (RGBA or null), bgImage (bool),
// format (auto|png|jpg|webp|zip), size. Returns { body, type, outW, outH, fg }.
async function apiJob({ img, bgImg, o }) {
  const buf = Buffer.from(img.buffer, img.byteOffset, img.byteLength);
  let meta = null;
  try { meta = await sharp(buf, { limitInputPixels: false }).metadata(); } catch {}
  if (!meta && !isHeif(buf)) throw new ApiError(400, "invalid_file_type", "Invalid file type", "Expected jpg/png/webp (avif, tiff, gif and heic work here too), received something else");
  const tooBig = (w, h) => { if (w * h > 50e6) throw new ApiError(400, "resolution_too_high", "Image resolution too high", `Input image has ${Math.round((w * h) / 1e6)} megapixels, maximum supported input resolution is 50 megapixels`); };
  if (meta?.width) tooBig(meta.width, meta.height);
  let d;
  try { d = await decode(buf); } catch { throw new ApiError(400, "failed_to_read_image", "There was an error reading the image."); }
  const { data, W, H } = d;
  tooBig(W, H);

  let roi = null;
  if (o.roi) {
    const r = [toPx(o.roi[0], W), toPx(o.roi[1], H), toPx(o.roi[2], W), toPx(o.roi[3], H)];
    if (r[0] < 0 || r[1] < 0 || r[2] > W || r[3] > H) throw new ApiError(400, "roi_exceeds_bounds", "ROI exceeds image bounds", "The given roi parameter defines a region that exceeds the image bounds");
    if (r[2] <= r[0] || r[3] <= r[1]) throw new ApiError(400, "roi_region_empty", "ROI region is empty", "The given roi parameter defines an empty region");
    roi = r;
  }
  const bgSolid = o.bg && o.bg[3] === 255 && o.channels !== "alpha" ? o.bg.slice(0, 3) : null;
  const bg4 = o.bg && !bgSolid && o.channels !== "alpha" ? o.bg : null;
  // A shadow goes between the cut-out and its background, so with one the colour is filled in after the layout.
  const shadow = o.shadow && o.shadow.opacity > 0 ? o.shadow : null;
  const { box } = await cutout(data, W, H, { harden: o.harden, bg: shadow ? null : bgSolid, bg4: shadow ? null : bg4, roi });
  if (!box) throw new ApiError(400, "unknown_foreground", "Could not identify foreground in image. For details and recommendations see https://www.remove.bg/supported-images.");

  // The subject's box comes from the alpha before any background fill. With a fill, the 1024 mask's box is used.
  const sub = o.bg && !shadow ? (() => { const l = Math.floor(box.x0 * W), t = Math.floor(box.y0 * H); return { left: l, top: t, width: Math.max(1, Math.min(W, Math.ceil(box.x1 * W)) - l), height: Math.max(1, Math.min(H, Math.ceil(box.y1 * H)) - t) }; })() : fgBox(data, W, H) || { left: 0, top: 0, width: W, height: H };
  const fillRGBA = bgSolid ? bgSolid.concat(255) : bg4 || [0, 0, 0, 0];
  const fill = shadow ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: fillRGBA[0], g: fillRGBA[1], b: fillRGBA[2], alpha: fillRGBA[3] / 255 };
  const raw4 = (w, h) => ({ raw: { width: w, height: h, channels: 4 } });

  // Layout: crop (tight, plus crop_margin), or scale/position on the original canvas, or the photo as it is.
  let out = data, outW = W, outH = H, fg = { ...sub };
  if (o.crop) {
    const [mt, mr, mb, ml] = o.margin.map((m, i) => Math.round(Math.min(toPx(m, i % 2 ? sub.width : sub.height), 500, 0.5 * (i % 2 ? sub.width : sub.height))));
    const cx0 = sub.left - ml, cy0 = sub.top - mt, cw = sub.width + ml + mr, ch = sub.height + mt + mb;
    const ix0 = Math.max(0, cx0), iy0 = Math.max(0, cy0), ix1 = Math.min(W, cx0 + cw), iy1 = Math.min(H, cy0 + ch);
    out = await sharp(data, raw4(W, H)).extract({ left: ix0, top: iy0, width: ix1 - ix0, height: iy1 - iy0 })
      .extend({ left: ix0 - cx0, top: iy0 - cy0, right: cx0 + cw - ix1, bottom: cy0 + ch - iy1, background: fill }).raw().toBuffer();
    outW = cw; outH = ch; fg = { left: ml, top: mt, width: sub.width, height: sub.height };
  } else if (o.scale != null || (o.position && o.position !== "original")) {
    const s = o.scale != null ? o.scale * Math.min(W / sub.width, H / sub.height) : 1;
    const w = Math.max(1, Math.min(W, Math.round(sub.width * s))), h = Math.max(1, Math.min(H, Math.round(sub.height * s)));
    const pos = o.position || "center"; // scaling implies centre unless a position is given
    let l, t;
    if (pos === "original") { l = Math.round(sub.left + sub.width / 2 - w / 2); t = Math.round(sub.top + sub.height / 2 - h / 2); }
    else { const [px, py] = pos === "center" ? [0.5, 0.5] : pos; l = Math.round(px * (W - w)); t = Math.round(py * (H - h)); }
    l = Math.max(0, Math.min(W - w, l)); t = Math.max(0, Math.min(H - h, t));
    let part = sharp(data, raw4(W, H)).extract(sub);
    if (w !== sub.width || h !== sub.height) part = part.resize(w, h, { fit: "fill", kernel: "lanczos3" });
    out = await sharp(await part.raw().toBuffer(), raw4(w, h)).extend({ left: l, top: t, right: W - w - l, bottom: H - h - t, background: fill }).raw().toBuffer();
    fg = { left: l, top: t, width: w, height: h };
  }

  // The ground shadow under the subject (lib/shadow.cjs), then the colour under both. With crop the canvas grows at the
  // bottom to hold the shadow; on the photo's own canvas it stops at the edge, as on the site. None under a subject cut
  // off by the photo's bottom edge.
  if (shadow) {
    if (!S.cutAtBottom(box)) {
      const e = S.ellipse(fg);
      if (o.crop && e.bottom > outH) {
        const grow = Math.ceil(e.bottom) - outH;
        out = await sharp(out, raw4(outW, outH)).extend({ bottom: grow, background: fill }).raw().toBuffer();
        outH += grow;
      }
      S.drawUnder(out, outW, outH, e, shadow.opacity);
    }
    if (bgSolid) S.fillUnder(out, bgSolid.concat(255));
    else if (bg4) S.fillUnder(out, bg4);
  }

  // Background image: cover-resized and centred under the cut-out.
  if (bgImg && o.channels !== "alpha") {
    let under;
    try {
      under = await sharp(Buffer.from(bgImg.buffer, bgImg.byteOffset, bgImg.byteLength), { limitInputPixels: false }).rotate()
        .resize(outW, outH, { fit: "cover", position: "centre" }).toColourspace("srgb").ensureAlpha()
        .composite([{ input: out, ...raw4(outW, outH) }]).raw().toBuffer();
    } catch { throw new ApiError(400, "failed_bg_download", "Failed to read the background image."); }
    out = under;
  }

  // Output format and size limit (remove.bg's size parameter caps the result's megapixels).
  let transparent = false;
  if (o.channels !== "alpha") for (let j = 3; j < out.length; j += 4) if (out[j] < 255) { transparent = true; break; }
  let format = o.format === "auto" ? (o.channels === "alpha" || transparent ? "png" : "jpg") : o.format;
  const caps = { preview: 0.25, medium: 1.5, hd: 4, full: 25, auto: 25, "50mp": 50 };
  let cap = caps[o.size];
  if (format === "png" && (o.size === "full" || o.size === "50mp")) cap = 10; // remove.bg: PNG up to 10 megapixels
  let img2 = sharp(out, raw4(outW, outH));
  if (outW * outH > cap * 1e6) {
    const k = Math.sqrt((cap * 1e6) / (outW * outH)), nw = Math.max(1, Math.floor(outW * k)), nh = Math.max(1, Math.floor(outH * k)); // down: never over the cap
    img2 = sharp(await img2.resize(nw, nh, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), raw4(nw, nh));
    fg = { left: Math.round(fg.left * (nw / outW)), top: Math.round(fg.top * (nh / outH)), width: Math.round(fg.width * (nw / outW)), height: Math.round(fg.height * (nh / outH)) };
    outW = nw; outH = nh;
  }

  let body, type;
  if (o.channels === "alpha") {
    const a = img2.extractChannel(3);
    if (format === "jpg") { body = await a.jpeg({ quality: 92 }).toBuffer(); type = "image/jpeg"; }
    else if (format === "webp") { body = await a.webp({ quality: 90 }).toBuffer(); type = "image/webp"; }
    else { body = await a.png().toBuffer(); type = "image/png"; } // zip with channels=alpha: the matte alone, as PNG
  } else if (format === "png") { body = await img2.png().toBuffer(); type = "image/png"; }
  else if (format === "webp") { body = await img2.webp({ quality: 90, alphaQuality: 100 }).toBuffer(); type = "image/webp"; }
  else if (format === "jpg") { body = await img2.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer(); type = "image/jpeg"; }
  else { // zip: color.jpg (the colours, edges corrected) and alpha.png (the matte), stored as remove.bg does
    const rawOut = await img2.raw().toBuffer();
    const color = await sharp(rawOut, raw4(outW, outH)).removeAlpha().jpeg({ quality: 92 }).toBuffer();
    const alphaPng = await sharp(rawOut, raw4(outW, outH)).extractChannel(3).png().toBuffer();
    const { zipSync } = require("fflate");
    body = Buffer.from(zipSync({ "color.jpg": [color, { level: 0 }], "alpha.png": [alphaPng, { level: 0 }] }));
    type = "application/zip";
  }
  return { body, type, outW, outH, fg };
}

parentPort.on("message", async (m) => {
  if (m.type === "mask" || m.type === "maskerr") {
    const p = pending.get(m.id); pending.delete(m.id);
    return m.type === "mask" ? p.resolve(m.mask) : p.reject(new Error(m.error));
  }
  if (m.type === "api") {
    try {
      const r = await apiJob(m);
      const body = new Uint8Array(r.body.buffer, r.body.byteOffset, r.body.byteLength).slice();
      parentPort.postMessage({ type: "done", ...r, body }, [body.buffer]);
    } catch (e) {
      const api = e instanceof ApiError ? { status: e.status, code: e.code, title: e.title, detail: e.detail } : null;
      parentPort.postMessage({ type: "fail", error: String(e?.message || e), api });
    }
    return;
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
