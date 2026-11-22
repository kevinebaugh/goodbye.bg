// Candidate post-processing steps for the mask (docs/mask-postprocess.md). Each takes the page's mask just before the
// edge curve (`pre`: despeckled, haze hardened for ISNet, 0..255 at 1024), today's final mask (`base`, after the curve)
// and the photo at 1024 (RGB), and returns a final mask.
const P = require("./pipeline.cjs");
const RES = 1024, N = RES * RES;

const lutFor = (cut) => {
  const lo = Math.max(0, cut - 0.3), hi = Math.min(1, cut + 0.3), t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let u = (v / 255 - lo) / (hi - lo); u = Math.max(0, Math.min(1, u)); t[v] = Math.round(u * u * (3 - 2 * u) * 255); }
  return t;
};
const LUT = lutFor(0.5);
const lut = (d, t = LUT) => { const o = new Uint8ClampedArray(N); for (let i = 0; i < N; i++) o[i] = t[d[i]]; return o; };
exports.lut = lut;
exports.pre = (raw, isnet) => { const d = Uint8ClampedArray.from(raw); P.despeck(d); if (isnet) P.hardenHaze(d, 0.3); return d; };

// 4-connected components of d >= thr (or d < thr with below): label map, sizes, centroid, whether they touch the frame.
function label(d, thr, below) {
  const lab = new Int32Array(N), stack = new Int32Array(N), comps = [null];
  const on = below ? (i) => d[i] < thr : (i) => d[i] >= thr;
  for (let i = 0; i < N; i++) {
    if (lab[i] || !on(i)) continue;
    const L = comps.length; let sp = 0, cnt = 0, sx = 0, sy = 0, edge = false;
    stack[sp++] = i; lab[i] = L;
    while (sp) {
      const j = stack[--sp], x = j % RES, y = (j / RES) | 0; cnt++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === RES - 1 || y === RES - 1) edge = true;
      if (x > 0 && !lab[j - 1] && on(j - 1)) { lab[j - 1] = L; stack[sp++] = j - 1; }
      if (x < RES - 1 && !lab[j + 1] && on(j + 1)) { lab[j + 1] = L; stack[sp++] = j + 1; }
      if (y > 0 && !lab[j - RES] && on(j - RES)) { lab[j - RES] = L; stack[sp++] = j - RES; }
      if (y < RES - 1 && !lab[j + RES] && on(j + RES)) { lab[j + RES] = L; stack[sp++] = j + RES; }
    }
    comps.push({ size: cnt, cx: sx / cnt / RES, cy: sy / cnt / RES, edge });
  }
  return { lab, comps };
}
exports.label = label;

// Drop the components `keep` says no to. Labelled at 128, a dropped part's soft rim (under 128) goes with it, unless it is
// also next to a kept part.
function dropComps(pre, thr, keep) {
  const { lab, comps } = label(pre, thr);
  if (comps.length <= 2) return null;
  const k = comps.map((c, i) => i > 0 && keep(c, comps));
  if (k.every((v, i) => v || i === 0)) return null;
  const d = Uint8ClampedArray.from(pre), gone = new Uint8Array(N), kept = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const l = lab[i]; if (!l) continue; if (k[l]) kept[i] = 1; else { gone[i] = 1; d[i] = 0; } }
  if (thr > 64) {
    const g = P.morph(gone, RES, RES, 4, true), kk = P.morph(kept, RES, RES, 4, true);
    for (let i = 0; i < N; i++) if (g[i] && !kk[i] && pre[i] < thr) d[i] = 0;
  }
  return d;
}
const biggest = (comps) => { let b = 0; for (let i = 1; i < comps.length; i++) if (comps[i].size > b) b = comps[i].size; return b; };
const keepFrac = (thr, x) => (pre, base) => { const d = dropComps(pre, thr, (c, cs) => c.size >= x * biggest(cs)); return d ? lut(d) : base; };
const borderSmall = (thr, y) => (pre, base) => { const d = dropComps(pre, thr, (c, cs) => { const b = biggest(cs); return c.size === b || !c.edge || c.size >= y * b; }); return d ? lut(d) : base; };
const centre = (thr, x, sigma) => (pre, base) => {
  const w = (c) => c.size * Math.exp(-((c.cx - 0.5) ** 2 + (c.cy - 0.5) ** 2) / (2 * sigma * sigma));
  const d = dropComps(pre, thr, (c, cs) => { let b = 0; for (let i = 1; i < cs.length; i++) b = Math.max(b, w(cs[i])); return w(c) >= x * b; });
  return d ? lut(d) : base;
};
// Fill holes (background not connected to the frame) smaller than y of the subject's area.
const holes = (y) => (pre, base) => {
  const { lab, comps } = label(pre, 128, true);
  let fg = 0; for (let i = 0; i < N; i++) if (pre[i] >= 128) fg++;
  const fill = comps.map((c, i) => i > 0 && !c.edge && c.size < y * fg);
  if (!fill.some(Boolean)) return base;
  const d = Uint8ClampedArray.from(pre); for (let i = 0; i < N; i++) if (fill[lab[i]]) d[i] = 255;
  return lut(d);
};
// Otsu's threshold on the soft mask, used as the edge curve's cutoff (clamped to lo..hi).
const otsu = (lo, hi) => (pre) => {
  const h = new Float64Array(256); for (let i = 0; i < N; i++) h[pre[i]]++;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * h[v];
  let wb = 0, sb = 0, best = -1, t = 128;
  for (let v = 0; v < 255; v++) { wb += h[v]; if (!wb) continue; const wf = N - wb; if (!wf) break; sb += v * h[v]; const mb = sb / wb, mf = (sum - sb) / wf, s = wb * wf * (mb - mf) ** 2; if (s > best) { best = s; t = v + 0.5; } }
  return lut(pre, lutFor(Math.max(lo, Math.min(hi, t / 255))));
};
exports.otsuT = (pre) => { const h = new Float64Array(256); for (let i = 0; i < N; i++) h[pre[i]]++; let sum = 0; for (let v = 0; v < 256; v++) sum += v * h[v]; let wb = 0, sb = 0, best = -1, t = 128; for (let v = 0; v < 255; v++) { wb += h[v]; if (!wb) continue; const wf = N - wb; if (!wf) break; sb += v * h[v]; const s = wb * wf * (sb / wb - (sum - sb) / wf) ** 2; if (s > best) { best = s; t = v + 0.5; } } return t; };
// Guided filter (He et al.) on the final mask with the photo's grey as the guide, only near the soft edge.
const guided = (r, eps, open = 0) => (pre, base, rgb) => {
  const I = new Float32Array(N), p = new Float32Array(N), soft = new Uint8Array(N);
  for (let i = 0; i < N; i++) { I[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255; p[i] = base[i] / 255; soft[i] = base[i] > 0 && base[i] < 255 ? 1 : 0; }
  const band = P.morph(open ? P.morph(P.morph(soft, RES, RES, open), RES, RES, open, true) : soft, RES, RES, r, true);
  const II = new Float32Array(N), Ip = new Float32Array(N); for (let i = 0; i < N; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = P.boxBlur(I, r), mp = P.boxBlur(p, r), mII = P.boxBlur(II, r), mIp = P.boxBlur(Ip, r), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps); A[i] = a; B[i] = mp[i] - a * mI[i]; }
  const mA = P.boxBlur(A, r), mB = P.boxBlur(B, r), o = Uint8ClampedArray.from(base);
  for (let i = 0; i < N; i++) if (band[i]) o[i] = Math.round(Math.max(0, Math.min(1, mA[i] * I[i] + mB[i])) * 255);
  return o;
};
// The same with the photo's colour as the guide (3x3 covariance per window).
const guidedRGB = (r, eps, open = 0) => (pre, base, rgb) => {
  const ch = [0, 1, 2].map((c) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgb[i * 3 + c] / 255; return a; });
  const p = new Float32Array(N); let soft = new Uint8Array(N); for (let i = 0; i < N; i++) { p[i] = base[i] / 255; soft[i] = base[i] > 0 && base[i] < 255 ? 1 : 0; }
  if (open) soft = P.morph(P.morph(soft, RES, RES, open), RES, RES, open, true); // keep only wide soft zones
  const band = P.morph(soft, RES, RES, r, true), wide = P.morph(soft, RES, RES, 2 * r, true), bl = (a) => P.boxBlur(a, r), prod = (a, b) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = a[i] * b[i]; return o; };
  const m = ch.map(bl), mp = bl(p), mIp = ch.map((a) => bl(prod(a, p)));
  const [rr, rg, rb, gg, gb, bb] = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([a, b]) => bl(prod(ch[a], ch[b])));
  const A = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!wide[i]) continue;
    const m0 = m[0][i], m1 = m[1][i], m2 = m[2][i];
    const a = rr[i] - m0 * m0 + eps, b = rg[i] - m0 * m1, c = rb[i] - m0 * m2, d = gg[i] - m1 * m1 + eps, e = gb[i] - m1 * m2, f = bb[i] - m2 * m2 + eps;
    const c0 = mIp[0][i] - m0 * mp[i], c1 = mIp[1][i] - m1 * mp[i], c2 = mIp[2][i] - m2 * mp[i];
    const i00 = d * f - e * e, i01 = c * e - b * f, i02 = b * e - c * d, i11 = a * f - c * c, i12 = b * c - a * e, i22 = a * d - b * b, det = a * i00 + b * i01 + c * i02;
    const a0 = (i00 * c0 + i01 * c1 + i02 * c2) / det, a1 = (i01 * c0 + i11 * c1 + i12 * c2) / det, a2 = (i02 * c0 + i12 * c1 + i22 * c2) / det;
    A[0][i] = a0; A[1][i] = a1; A[2][i] = a2; B[i] = mp[i] - a0 * m0 - a1 * m1 - a2 * m2;
  }
  for (let i = 0; i < N; i++) if (!wide[i]) B[i] = p[i]; // far from the edge: a = 0, b = the mask
  const mA = A.map(bl), mB = bl(B), o = Uint8ClampedArray.from(base);
  for (let i = 0; i < N; i++) if (band[i]) o[i] = Math.round(Math.max(0, Math.min(1, mA[0][i] * ch[0][i] + mA[1][i] * ch[1][i] + mA[2][i] * ch[2][i] + mB[i])) * 255);
  return o;
};
const chain =(...fs) => (pre, base, rgb) => { let b = base; for (const f of fs) b = f(pre, b, rgb); return b; };
exports.F = { keepFrac, borderSmall, centre, holes, otsu, guided, chain, dropComps, lutFor };

const C = {};
for (const thr of [64, 128]) {
  for (const x of [0.05, 0.1, 0.2, 0.3, 0.5, 1]) C[`keep${thr}_${x}`] = keepFrac(thr, x);
  for (const y of [0.1, 0.25, 0.5, 1]) C[`border${thr}_${y}`] = borderSmall(thr, y);
  for (const s of [0.25, 0.5]) for (const x of [0.1, 0.3, 1]) C[`centre${thr}_${s}_${x}`] = centre(thr, x, s);
}
for (const y of [0.002, 0.005, 0.01, 0.02, 0.05]) C[`holes_${y}`] = holes(y);
C["otsu_0.4_0.6"] = otsu(0.4, 0.6); C["otsu_0.3_0.7"] = otsu(0.3, 0.7); C["otsu_0.2_0.8"] = otsu(0.2, 0.8);
for (const r of [2, 4, 8]) for (const e of [1e-3, 1e-2]) C[`guided_${r}_${e}`] = guided(r, e);
// Second round, after the first showed the guided filter helping at small radii.
for (const r of [2, 3, 4]) for (const e of [1e-4]) C[`guided_${r}_${e}`] = guided(r, e);
C["guided_3_0.001"] = guided(3, 1e-3);
for (const r of [2, 3, 4]) for (const e of [1e-4, 1e-3]) C[`guidedRGB_${r}_${e}`] = guidedRGB(r, e);
// Third round: the filter softened crisp edges (white on white, DIS); only where the soft zone is wide (hair, fur).
for (const k of [1, 2, 3]) { C[`guidedRGB_4_0.001_open${k}`] = guidedRGB(4, 1e-3, k); C[`guided_3_0.001_open${k}`] = guided(3, 1e-3, k); }
exports.CANDIDATES = C;
