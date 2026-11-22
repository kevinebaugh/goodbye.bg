// The site's ground shadow (src/app.js, outPlan and underlay: "Shadow" in the seller options), for serve's shadow_type.
// A soft black ellipse under the subject: as wide as 90% of the subject, 12% as tall as it is wide, its centre a third
// of its height above the subject's bottom edge. Its darkness falls off along a radial gradient: 0.34 at the centre,
// 0.16 halfway out, nothing at the rim (the site draws exactly that with canvas createRadialGradient).
// shadow_opacity scales it: 50 (remove.bg's default) is the site's look, 100 twice as dark, 0 nothing.
// No shadow under a subject cut off by the photo's bottom edge (a person cut at the waist), as on the site.
"use strict";
const { RES } = require("./pipeline.cjs");

const STOPS = [[0, 0.34], [0.5, 0.16], [1, 0]]; // offset, alpha (src/app.js underlay)
const CUT = 1.5 / RES; // the mask reaches the photo's edge (within a model pixel): src/app.js cutSides

// The gradient's alpha at d (0 centre, 1 rim), times opacity/50, at most 1.
function alphaAt(d, opacity = 50) {
  if (!(d < 1)) return 0;
  let a = STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [o0, a0] = STOPS[i - 1], [o1, a1] = STOPS[i];
    if (d <= o1) { a = a0 + ((d - o0) / (o1 - o0)) * (a1 - a0); break; }
  }
  return Math.min(1, (a * opacity) / 50);
}

// box: the 1024 mask's subject box (0..1, from pipeline). True when the subject runs off the photo's bottom edge.
const cutAtBottom = (box) => !!box && box.y1 >= 1 - CUT;

// fg: the subject's box in output pixels { left, top, width, height }. Returns the ellipse { cx, cy, rx, ry } and the
// lowest row it needs (bottom), in the same pixels.
function ellipse(fg) {
  const rx = 0.45 * fg.width, ry = Math.max(3, rx * 0.12);
  const cx = fg.left + fg.width / 2, cy = fg.top + fg.height - ry * 0.35;
  return { cx, cy, rx, ry, bottom: cy + ry * 1.1 };
}

// Draws the shadow under what data (RGBA, W x H, straight alpha) holds: canvas "destination-over" with black.
function drawUnder(data, W, H, e, opacity) {
  if (!(opacity > 0)) return;
  const x0 = Math.max(0, Math.floor(e.cx - e.rx)), x1 = Math.min(W - 1, Math.ceil(e.cx + e.rx));
  const y0 = Math.max(0, Math.floor(e.cy - e.ry)), y1 = Math.min(H - 1, Math.ceil(e.cy + e.ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - e.cy) / e.ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - e.cx) / e.rx, s = alphaAt(Math.sqrt(dx * dx + dy * dy), opacity);
      if (!s) continue;
      const j = (y * W + x) * 4, a = data[j + 3] / 255, b = s * (1 - a), o = a + b; // black under the pixel
      if (o > 0) { const k = a / o; data[j] *= k; data[j + 1] *= k; data[j + 2] *= k; }
      data[j + 3] = Math.round(o * 255);
    }
  }
}

// A colour under what data holds ("destination-over"): rgba [r, g, b, a 0..255]. Opaque colours leave no alpha.
// Same arithmetic as the worker's cutout() fill, so a shadow-free result looks the same either way.
function fillUnder(data, rgba) {
  const [r, g, b, A] = rgba;
  for (let j = 0; j < data.length; j += 4) {
    const t = data[j + 3] / 255;
    if (A === 255) {
      const s = 1 - t;
      data[j] = data[j] * t + r * s; data[j + 1] = data[j + 1] * t + g * s; data[j + 2] = data[j + 2] * t + b * s; data[j + 3] = 255;
    } else {
      const u = (A / 255) * (1 - t), o = t + u;
      if (o > 0) { data[j] = (data[j] * t + r * u) / o; data[j + 1] = (data[j + 1] * t + g * u) / o; data[j + 2] = (data[j + 2] * t + b * u) / o; }
      data[j + 3] = o * 255;
    }
  }
}

module.exports = { alphaAt, cutAtBottom, ellipse, drawUnder, fillUnder, STOPS };
