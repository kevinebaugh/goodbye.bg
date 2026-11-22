// Contact sheets: photo | ISNet cut-out | BiRefNet cut-out, on a checkerboard, composited the way the page does
// (edge colours, then the mask). For looking at results; the sheets hold other people's photos, so keep them out of the repo.
//   node sheet.cjs <work dir> <out.jpg> <id> [<id> ...]      (env TILE=px, COLS=triples per row, MODELS=isnet,birefnet)
const fs = require("fs"), path = require("path");
const WORK = path.resolve(process.argv[2]);
const req = (m) => require(require.resolve(m, { paths: [path.join(WORK, "harness")] }));
const sharp = req("sharp"), P = require("./pipeline.cjs");
const RES = 1024, T = +process.env.TILE || 280, COLS = +process.env.COLS || 2, MODELS = (process.env.MODELS || "isnet,birefnet").split(","), LABEL = 18;

const rows = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const scores = Object.fromEntries(MODELS.map((m) => [m, Object.fromEntries(fs.readFileSync(path.join(WORK, "out", m, "scores.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }))]));

function checker(w, h) {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = ((x >> 3) + (y >> 3)) & 1 ? 150 : 110; b.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3); }
  return b;
}

// The cut-out at w x h over the checkerboard.
async function cutout(file, maskFile, w, h) {
  const rgb1024 = await sharp(file).removeAlpha().resize(RES, RES, { fit: "fill", kernel: "linear" }).raw().toBuffer();
  const px = new Uint8ClampedArray(RES * RES * 4);
  for (let i = 0; i < RES * RES; i++) { px[i * 4] = rgb1024[i * 3]; px[i * 4 + 1] = rgb1024[i * 3 + 1]; px[i * 4 + 2] = rgb1024[i * 3 + 2]; px[i * 4 + 3] = 255; }
  const a = await sharp(maskFile).resize(RES, RES, { fit: "fill" }).extractChannel(0).raw().toBuffer(); // edge colours work at 1024
  const fix = P.edgeColors(px, a);
  const photo = await sharp(file).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
  const f = await sharp(Buffer.from(fix.buffer), { raw: { width: RES, height: RES, channels: 4 } }).resize(w, h, { fit: "fill" }).raw().toBuffer();
  const m = await sharp(maskFile).resize(w, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
  const out = checker(w, h);
  for (let i = 0; i < w * h; i++) {
    const fa = f[i * 4 + 3] / 255, al = m[i] / 255;
    for (let c = 0; c < 3; c++) { const col = photo[i * 3 + c] * (1 - fa) + f[i * 4 + c] * fa; out[i * 3 + c] = col * al + out[i * 3 + c] * (1 - al); }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
exports.cutout = cutout;

if (require.main === module) (async () => {
  const ids = process.argv.slice(4), per = 1 + MODELS.length, cellW = per * T + 8, cellH = T + LABEL + 6;
  const nRows = Math.ceil(ids.length / COLS), layers = [];
  for (let k = 0; k < ids.length; k++) {
    const r = rows[ids[k]], file = path.join(WORK, r.image), meta = await sharp(file).metadata();
    const s = Math.min(T / meta.width, T / meta.height), w = Math.max(1, Math.round(meta.width * s)), h = Math.max(1, Math.round(meta.height * s));
    const x0 = (k % COLS) * cellW, y0 = Math.floor(k / COLS) * cellH;
    layers.push({ input: await sharp(file).removeAlpha().resize(w, h, { fit: "fill" }).png().toBuffer(), left: x0 + ((T - w) >> 1), top: y0 + LABEL + ((T - h) >> 1) });
    const label = [`${k + 1}. ${r.id.slice(0, 26)} [${r.cat}]`];
    for (let j = 0; j < MODELS.length; j++) {
      layers.push({ input: await cutout(file, path.join(WORK, "out", MODELS[j], r.id + ".png"), w, h), left: x0 + (j + 1) * T + ((T - w) >> 1), top: y0 + LABEL + ((T - h) >> 1) });
      const sc = scores[MODELS[j]][r.id]; label.push(`${MODELS[j]} ${sc.iou != null ? "IoU " + sc.iou.toFixed(2) : ""}${sc.box ? "" : " NO SUBJECT"}`);
    }
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${per * T}" height="${LABEL}"><style>text{font:13px Helvetica,Arial,sans-serif;fill:#fff}</style>${label.map((t, j) => `<text x="${j * T + 3}" y="13">${esc(t)}</text>`).join("")}</svg>`), left: x0, top: y0 });
  }
  await sharp({ create: { width: COLS * cellW, height: nRows * cellH, channels: 3, background: "#222" } }).composite(layers).jpeg({ quality: 86 }).toFile(process.argv[3]);
})();
