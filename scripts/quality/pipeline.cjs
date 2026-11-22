// The page's own mask handling (src/engine.js toInput; src/app.js segment, despeck, subjectBox, LUT, edgeColors),
// on plain arrays so Node can run it, plus the scores.
const RES = 1024, CUTOFF = 0.5, SOFTNESS = 0.6;

exports.toInput = (px, { mean, std }) => {
  const n = RES * RES, input = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const m = mean[c], s = 1 / std[c], o = c * n;
    for (let i = 0; i < n; i++) input[o + i] = (px[i * 4 + c] - m) * s;
  }
  return input;
};

const LUT = (() => {
  const lo = Math.max(0, CUTOFF - SOFTNESS / 2), hi = Math.min(1, CUTOFF + SOFTNESS / 2), t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let u = (v / 255 - lo) / (hi - lo); u = Math.max(0, Math.min(1, u)); t[v] = Math.round(u * u * (3 - 2 * u) * 255); }
  return t;
})();

function despeck(d) { // d: alpha, one byte a pixel
  const n = RES * RES, lab = new Int32Array(n), stack = new Int32Array(n), sizes = [0];
  const on = (i) => d[i] >= 64;
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
  let big = 0; for (const s of sizes) if (s > big) big = s;
  for (let i = 0; i < n; i++) {
    const l = lab[i];
    if ((l && sizes[l] < big * 0.015) || (!l && d[i] < 25)) d[i] = 0;
  }
}

function subjectBox(d) {
  let x0 = RES, y0 = RES, x1 = -1, y1 = -1;
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    if (d[y * RES + x] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0: x0 / RES, y0: y0 / RES, x1: (x1 + 1) / RES, y1: (y1 + 1) / RES };
}

// Experiment: ISNet leaves wide areas half see-through where it is unsure (a dark body, white on white). An edge is a thin
// unsure line; an area still unsure 6 px in from its rim is haze. Haze at or above `t` becomes solid, the rest clear.
function hardenHaze(d, t) {
  const n = RES * RES, unsure = new Uint8Array(n);
  for (let i = 0; i < n; i++) unsure[i] = d[i] > 51 && d[i] < 204 ? 1 : 0; // the range the edge curve leaves soft
  const wide = exports.morph(exports.morph(unsure, RES, RES, 6), RES, RES, 6, true), cut = t * 255;
  // Decide on a blurred copy, so the new outline follows the haze's shape, not its noise; then soften that outline a little.
  const sm = boxBlur(d, 8), hard = Uint8ClampedArray.from(d);
  for (let i = 0; i < n; i++) if (wide[i] && unsure[i]) hard[i] = sm[i] >= cut ? 255 : 0;
  const soft = boxBlur(hard, 2);
  for (let i = 0; i < n; i++) d[i] = wide[i] && unsure[i] ? soft[i] : hard[i];
}
function boxBlur(src, r) { // separable, edges clamped
  const t = new Float32Array(RES * RES), out = new Float32Array(RES * RES), k = 1 / (2 * r + 1);
  for (let y = 0; y < RES; y++) { const o = y * RES; let s = 0; for (let x = -r; x <= r; x++) s += src[o + Math.min(RES - 1, Math.max(0, x))];
    for (let x = 0; x < RES; x++) { t[o + x] = s * k; s += src[o + Math.min(RES - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < RES; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(RES - 1, Math.max(0, y)) * RES + x];
    for (let y = 0; y < RES; y++) { out[y * RES + x] = s * k; s += t[Math.min(RES - 1, y + r + 1) * RES + x] - t[Math.max(0, y - r) * RES + x]; } }
  return out;
}

exports.postprocess = (m, harden = 0) => {
  const n = RES * RES, alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.max(0, Math.min(255, m[i] * 255));
  const raw = alpha.slice();
  despeck(alpha);
  if (harden) hardenHaze(alpha, harden);
  const box = subjectBox(alpha);
  for (let i = 0; i < n; i++) alpha[i] = LUT[alpha[i]];
  return { alpha, box, raw };
};

// px: RGBA at 1024, a8: the final alpha. Returns RGBA "fix" layer (see edgeColors in app.js).
exports.edgeColors = (px, a8) => {
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
};

// Where the page's retry zooms in (zoomRect in app.js): the subject with 15% room; null when that covers more than `max` of the photo.
exports.zoomRect = (b, max = 0.8) => {
  if (!b) return null;
  const padX = 0.15 * (b.x1 - b.x0), padY = 0.15 * (b.y1 - b.y0);
  const x0 = Math.max(0, b.x0 - padX), y0 = Math.max(0, b.y0 - padY), x1 = Math.min(1, b.x1 + padX), y1 = Math.min(1, b.y1 + padY);
  return (x1 - x0) * (y1 - y0) > max ? null : { x0, y0, x1, y1 };
};

// mergeRetry in app.js on arrays: `first` (side x side) keeps its values outside the zoomed part (rw x rh at rx, ry); inside,
// the new mask wins, fading in over a band of 4% of the part's short side on the sides that are inside the photo.
// edgeOnly (experiment): the new mask counts only within 2% of the side of the first mask's outline, so the second pass
// can sharpen an edge but not change what is kept.
exports.merge = (first, side, part, rx, ry, rw, rh, edgeOnly) => {
  const out = Uint8ClampedArray.from(first), band = Math.max(4, 0.04 * Math.min(rw, rh));
  let near = null;
  if (edgeOnly) {
    const b = new Uint8Array(side * side); for (let i = 0; i < b.length; i++) b[i] = first[i] >= 128 ? 1 : 0;
    const r = Math.round(0.02 * side), er = exports.morph(b, side, side, r), di = exports.morph(b, side, side, r, true);
    near = new Uint8Array(side * side); for (let i = 0; i < b.length; i++) near[i] = di[i] && !er[i] ? 1 : 0;
  }
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const X = rx + x, Y = ry + y; if (X < 0 || Y < 0 || X >= side || Y >= side) continue;
    let w = 1;
    if (rx > 1) w = Math.min(w, x / band); if (rx + rw < side - 1) w = Math.min(w, (rw - 1 - x) / band);
    if (ry > 1) w = Math.min(w, y / band); if (ry + rh < side - 1) w = Math.min(w, (rh - 1 - y) / band);
    w = Math.max(0, Math.min(1, w));
    if (near && !near[Y * side + X]) continue;
    out[Y * side + X] = first[Y * side + X] * (1 - w) + part[y * rw + x] * w;
  }
  return out;
};
exports.boxOf = (d, side) => {
  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { if (d[y * side + x] < 128) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0: x0 / side, y0: y0 / side, x1: (x1 + 1) / side, y1: (y1 + 1) / side };
};

/* ---------- scores ---------- */
// Square erosion (r > 0) or dilation (r < 0 is not used; pass dil = true) of a 0/1 map, zeros outside the frame.
function morph(src, w, h, r, dil) {
  const t = new Uint8Array(w * h), out = new Uint8Array(w * h), hit = dil ? 1 : 0;
  // A pixel becomes `hit` if any pixel within r (Chebyshev) is `hit`. Outside the frame counts as 0.
  for (let y = 0; y < h; y++) {
    const o = y * w; let last = dil ? -1e9 : -1; // erosion: the border at x = -1 is a zero
    for (let x = 0; x < w; x++) { if (src[o + x] === hit) last = x; t[o + x] = x - last <= r ? hit : 1 - hit; }
    last = dil ? 1e9 : w;
    for (let x = w - 1; x >= 0; x--) { if (src[o + x] === hit) last = x; if (last - x <= r) t[o + x] = hit; }
  }
  for (let x = 0; x < w; x++) {
    let last = dil ? -1e9 : -1;
    for (let y = 0; y < h; y++) { if (t[y * w + x] === hit) last = y; out[y * w + x] = y - last <= r ? hit : 1 - hit; }
    last = dil ? 1e9 : h;
    for (let y = h - 1; y >= 0; y--) { if (t[y * w + x] === hit) last = y; if (last - y <= r) out[y * w + x] = hit; }
  }
  return out;
}
exports.morph = morph;

// pred, gt: bytes at w x h. kind: "alpha" (soft matte), "binary", "trimap" (Oxford pets: 1 pet, 2 background, 3 unsure).
exports.score = (pred, gt, w, h, kind) => {
  const n = w * h, pb = new Uint8Array(n), gb = new Uint8Array(n);
  let inter = 0, uni = 0, ps = 0, gs = 0, mae = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    let g;
    if (kind === "trimap") { if (gt[i] === 3) continue; g = gt[i] === 1 ? 255 : 0; } else g = gt[i];
    const p = pred[i] >= 128 ? 1 : 0, q = g >= 128 ? 1 : 0;
    pb[i] = p; gb[i] = q; inter += p & q; uni += p | q; ps += p; gs += q; mae += Math.abs(pred[i] - g); cnt++;
  }
  const s = { iou: uni ? inter / uni : 1, mae: mae / cnt / 255, prec: ps ? inter / ps : 0, rec: gs ? inter / gs : 0, predFrac: ps / cnt, gtFrac: gs / cnt };
  if (kind === "trimap" || kind === "coarse") return s; // no trustworthy edge there
  // Boundary IoU (Cheng et al. 2021): IoU of the two masks inside a band of 2% of the diagonal along each one's contour.
  const d = Math.max(1, Math.round(0.02 * Math.hypot(w, h))), ge = morph(gb, w, h, d), pe = morph(pb, w, h, d);
  let bi = 0, bu = 0;
  for (let i = 0; i < n; i++) { const a = gb[i] & ~ge[i] & 1, b = pb[i] & ~pe[i] & 1; bi += a & b; bu += a | b; }
  s.biou = bu ? bi / bu : 1;
  // Edge error: mean alpha error within 0.6% of the diagonal of the true edge (soft pixels and the 0/1 contour).
  const edge = new Uint8Array(n), g1 = morph(gb, w, h, 1), g2 = morph(gb, w, h, 1, true);
  for (let i = 0; i < n; i++) edge[i] = (gt[i] > 5 && gt[i] < 250) || g1[i] !== g2[i] ? 1 : 0;
  const band = morph(edge, w, h, Math.max(3, Math.round(0.006 * Math.hypot(w, h))), true);
  let es = 0, ec = 0;
  for (let i = 0; i < n; i++) if (band[i]) { es += Math.abs(pred[i] - gt[i]); ec++; }
  s.edge = ec ? es / ec / 255 : 0; s.bandFrac = ec / n;
  return s;
};
exports.despeck = despeck; exports.hardenHaze = hardenHaze; exports.boxBlur = boxBlur;
