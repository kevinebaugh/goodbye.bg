// The page's own mask handling, on plain arrays so Node can run it. Keep in step with src/app.js (segment, onBackdrop,
// despeck, hardenHaze, subjectBox, LUT, edgeColors, frame) and src/engine.js (MODELS, toInput, run). Copied from
// scripts/quality/pipeline.cjs, with hardenHaze and onBackdrop taken from app.js as they are today.
"use strict";
const RES = 1024, CUTOFF = 0.5, SOFTNESS = 0.6;

const MODELS = {
  // BiRefNet lite (MIT): ImageNet mean/std, output logits.
  birefnet: { mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true, harden: false },
  // ISNet medium (AGPL, IMG.LY): (x - 128) / 256, output 0..1. The page hardens its haze (ISNet only).
  // Lines marked AGPL-only are left out of the closed single-file build (scripts/build-sea.mjs).
  isnet: { mean: [128, 128, 128], std: [256, 256, 256], logits: false, harden: true }, // AGPL-only
};

// A see-through image (a PNG cut-out, an SVG logo) goes to the model on white, or on black when the subject is light.
function onBackdrop(px) {
  let clear = 0, lum = 0, solid = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 250) clear++;
    if (px[i + 3] > 128) { solid++; lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; }
  }
  if (clear < px.length / 400) return; // an ordinary photo: nothing to do
  const bg = solid && lum / solid > 150 ? 0 : 255;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * a + bg * (1 - a);
    px[i + 3] = 255;
  }
}

// RGBA pixels (RES x RES) to the model's planar float input.
function toInput(px, { mean, std }) {
  const n = RES * RES, input = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const m = mean[c], s = 1 / std[c], o = c * n;
    for (let i = 0; i < n; i++) input[o + i] = (px[i * 4 + c] - m) * s;
  }
  return input;
}

const LUT = (() => {
  const lo = Math.max(0, CUTOFF - SOFTNESS / 2), hi = Math.min(1, CUTOFF + SOFTNESS / 2), t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let u = (v / 255 - lo) / (hi - lo); u = Math.max(0, Math.min(1, u)); t[v] = Math.round(u * u * (3 - 2 * u) * 255); }
  return t;
})();

// Remove small islands that are not part of the main subject. d: alpha, one byte a pixel.
function despeck(d) {
  const n = RES * RES, lab = new Int32Array(n), stack = new Int32Array(n), sizes = [0];
  const on = (i) => d[i] >= 64; // faint pixels do not join islands to the subject
  for (let i = 0; i < n; i++) {
    if (lab[i] || !on(i)) continue;
    const L = sizes.length; let sp = 0, cnt = 0;
    stack[sp++] = i; lab[i] = L;
    while (sp) {
      const j = stack[--sp]; cnt++;
      const x = j % RES, y = (j / RES) | 0;
      if (x > 0 && !lab[j - 1] && on(j - 1)) { lab[j - 1] = L; stack[sp++] = j - 1; }
      if (x < RES - 1 && !lab[j + 1] && on(j + 1)) { lab[j + 1] = L; stack[sp++] = j + 1; }
      if (y > 0 && !lab[j - RES] && on(j - RES)) { lab[j - RES] = L; stack[sp++] = j - RES; }
      if (y < RES - 1 && !lab[j + RES] && on(j + RES)) { lab[j + RES] = L; stack[sp++] = j + RES; }
    }
    sizes.push(cnt);
  }
  let big = 0; for (const s of sizes) if (s > big) big = s;
  for (let i = 0; i < n; i++) {
    const l = lab[i];
    if ((l && sizes[l] < big * 0.015) || (!l && d[i] < 25)) d[i] = 0; // keep soft edges
  }
}

// Square erosion or growth by r: a pixel takes `hit` if any pixel within r has it. Outside the frame counts as 0.
function morph(src, r, grow) {
  const n = RES * RES, t = new Uint8Array(n), out = new Uint8Array(n), hit = grow ? 1 : 0;
  for (let y = 0; y < RES; y++) {
    const o = y * RES; let last = grow ? -1e9 : -1;
    for (let x = 0; x < RES; x++) { if (src[o + x] === hit) last = x; t[o + x] = x - last <= r ? hit : 1 - hit; }
    last = grow ? 1e9 : RES;
    for (let x = RES - 1; x >= 0; x--) { if (src[o + x] === hit) last = x; if (last - x <= r) t[o + x] = hit; }
  }
  for (let x = 0; x < RES; x++) {
    let last = grow ? -1e9 : -1;
    for (let y = 0; y < RES; y++) { if (t[y * RES + x] === hit) last = y; out[y * RES + x] = y - last <= r ? hit : 1 - hit; }
    last = grow ? 1e9 : RES;
    for (let y = RES - 1; y >= 0; y--) { if (t[y * RES + x] === hit) last = y; if (last - y <= r) out[y * RES + x] = hit; }
  }
  return out;
}

function boxBlur(src, r) { // edges clamped
  const n = RES * RES, t = new Float32Array(n), out = new Float32Array(n), k = 1 / (2 * r + 1), c = (v) => Math.min(RES - 1, Math.max(0, v));
  for (let y = 0; y < RES; y++) {
    const o = y * RES; let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + c(x)];
    for (let x = 0; x < RES; x++) { t[o + x] = s * k; s += src[o + c(x + r + 1)] - src[o + c(x - r)]; }
  }
  for (let x = 0; x < RES; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += t[c(y) * RES + x];
    for (let y = 0; y < RES; y++) { out[y * RES + x] = s * k; s += t[c(y + r + 1) * RES + x] - t[c(y - r) * RES + x]; }
  }
  return out;
}

// ISNet leaves wide areas half see-through where it is unsure. An area still unsure 6 px in from its rim is haze:
// haze at 0.3 or more becomes solid, the rest clear, decided on a blurred copy (hardenHaze in app.js).
function hardenHaze(d) {
  const n = RES * RES, a = new Uint8Array(n), unsure = new Uint8Array(n);
  for (let i = 0; i < n; i++) { a[i] = d[i]; unsure[i] = a[i] > 51 && a[i] < 204 ? 1 : 0; }
  const wide = morph(morph(unsure, 6, false), 6, true);
  let any = false;
  for (let i = 0; i < n; i++) if ((wide[i] &= unsure[i])) any = true;
  if (!any) return;
  const sm = boxBlur(a, 8);
  for (let i = 0; i < n; i++) if (wide[i]) a[i] = sm[i] >= 0.3 * 255 ? 255 : 0;
  const soft = boxBlur(a, 2);
  for (let i = 0; i < n; i++) d[i] = wide[i] ? soft[i] : a[i];
}

// The subject's bounding box (mostly opaque pixels), as fractions of the image. null if nothing is left.
function subjectBox(d) {
  let x0 = RES, y0 = RES, x1 = -1, y1 = -1;
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    if (d[y * RES + x] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0: x0 / RES, y0: y0 / RES, x1: (x1 + 1) / RES, y1: (y1 + 1) / RES };
}

// m: the model's mask (0..1, RES x RES). Returns the alpha the page composites with, and the subject box.
function postprocess(m, harden) {
  const n = RES * RES, alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.max(0, Math.min(255, m[i] * 255));
  despeck(alpha);
  if (harden) hardenHaze(alpha);
  const box = subjectBox(alpha);
  for (let i = 0; i < n; i++) alpha[i] = LUT[alpha[i]]; // soften the edge once, here
  return { alpha, box };
}

// Hair and other see-through edges keep some of the old background's color. Estimate the subject's own color there
// (blur-fusion foreground estimation) and return it as an RGBA layer drawn over the photo before the mask cuts it out.
function edgeColors(px, a8) {
  const n = RES * RES, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = a8[i] / 255;
  const blur = (src, r, out) => {
    const t = new Float32Array(n), k = 1 / (2 * r + 1);
    for (let y = 0; y < RES; y++) {
      const o = y * RES; let s = src[o] * (r + 1);
      for (let x = 1; x <= r; x++) s += src[o + Math.min(x, RES - 1)];
      for (let x = 0; x < RES; x++) { t[o + x] = s * k; s += src[o + Math.min(x + r + 1, RES - 1)] - src[o + Math.max(x - r, 0)]; }
    }
    for (let x = 0; x < RES; x++) {
      let s = t[x] * (r + 1);
      for (let y = 1; y <= r; y++) s += t[Math.min(y, RES - 1) * RES + x];
      for (let y = 0; y < RES; y++) { out[y * RES + x] = s * k; s += t[Math.min(y + r + 1, RES - 1) * RES + x] - t[Math.max(y - r, 0) * RES + x]; }
    }
    return out;
  };
  const fd = new Uint8ClampedArray(n * 4), ba1 = blur(a, 24, new Float32Array(n)), ba2 = blur(a, 3, new Float32Array(n));
  const I = new Float32Array(n), F = new Float32Array(n), B = new Float32Array(n), u = new Float32Array(n), v = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) I[i] = F[i] = B[i] = px[i * 4 + c] / 255;
    for (const [r, ba] of [[24, ba1], [3, ba2]]) {
      for (let i = 0; i < n; i++) { u[i] = F[i] * a[i]; v[i] = B[i] * (1 - a[i]); }
      blur(u, r, u); blur(v, r, v);
      for (let i = 0; i < n; i++) {
        const fb = u[i] / (ba[i] + 1e-5), bb = v[i] / (1 - ba[i] + 1e-5), al = a[i];
        F[i] = Math.min(1, Math.max(0, fb + al * (I[i] - al * fb - (1 - al) * bb))); B[i] = bb;
      }
    }
    for (let i = 0; i < n; i++) fd[i * 4 + c] = F[i] * 255;
  }
  for (let i = 0; i < n; i++) fd[i * 4 + 3] = a[i] > 0 && a[i] < 1 ? Math.min(255, ((1 - a[i]) / 0.35) * 255) : 0;
  return fd;
}

// The page's crop (frame in app.js): the subject with 4% of its longer side as room, in image pixels.
function frame(box, W, H) {
  const pad = 0.04 * Math.max((box.x1 - box.x0) * W, (box.y1 - box.y0) * H);
  const x0 = Math.max(0, Math.floor(box.x0 * W - pad)), y0 = Math.max(0, Math.floor(box.y0 * H - pad));
  const x1 = Math.min(W, Math.ceil(box.x1 * W + pad)), y1 = Math.min(H, Math.ceil(box.y1 * H + pad));
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

module.exports = { RES, MODELS, onBackdrop, toInput, postprocess, edgeColors, frame, subjectBox };
