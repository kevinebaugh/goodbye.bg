// Edge close-ups at the photo's own pixels: photo | ISNet | BiRefNet, a square taken at the top of the subject (hair, ears).
//   node zoom.cjs <work dir> <out.jpg> <id> [<id> ...]     (env TILE=px)
const fs = require("fs"), path = require("path");
const WORK = path.resolve(process.argv[2]);
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), { cutout } = require("./sheet.cjs");
const T = +process.env.TILE || 300, MODELS = ["isnet", "birefnet"];
const rows = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const box = Object.fromEntries(fs.readFileSync(path.join(WORK, "out/birefnet/scores.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r.box]; }));
(async () => {
  const ids = process.argv.slice(4), layers = [];
  for (let k = 0; k < ids.length; k++) {
    const r = rows[ids[k]], file = path.join(WORK, r.image), m = await sharp(file).metadata(), b = box[r.id];
    const s = Math.min(1, 2000 / Math.max(m.width, m.height)), w = Math.round(m.width * s), h = Math.round(m.height * s);
    const [fx, fy] = (process.env["AT_" + k] || "x,x").split(",").map(Number); // AT_<n>=x,y (fractions) moves the square
    const cx = (isNaN(fx) ? (b.x0 + b.x1) / 2 : fx) * w, cy = (isNaN(fy) ? b.y0 + 0.08 : fy) * h, t = Math.min(T, w, h);
    const left = Math.round(Math.max(0, Math.min(w - t, cx - t / 2))), top = Math.round(Math.max(0, Math.min(h - t, cy - t / 2)));
    const x0 = (k % 2) * (3 * T + 8), y0 = Math.floor(k / 2) * (T + 6);
    const crop = (buf) => sharp(buf).extract({ left, top, width: t, height: t }).png().toBuffer();
    layers.push({ input: await crop(await sharp(file).removeAlpha().resize(w, h, { fit: "fill" }).png().toBuffer()), left: x0, top: y0 });
    for (let j = 0; j < 2; j++) layers.push({ input: await crop(await cutout(file, path.join(WORK, "out", MODELS[j], r.id + ".png"), w, h)), left: x0 + (j + 1) * T, top: y0 });
  }
  await sharp({ create: { width: 2 * (3 * T + 8), height: Math.ceil(ids.length / 2) * (T + 6), channels: 3, background: "#222" } }).composite(layers).jpeg({ quality: 88 }).toFile(process.argv[3]);
})();
