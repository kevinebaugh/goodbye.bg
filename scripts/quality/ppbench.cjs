// Time candidate steps at 1024 in one Node thread (warm-up first, then the median of 20 photos).
//   node ppbench.cjs <work dir> <raw name> <isnet|birefnet> <candidate | page> ...
// page: refineEdge cut out of src/app.js (the shipped code under ?pp=1), timed on its own.
const fs = require("fs"), path = require("path");
const [WORK_, NAME, KIND, ...cands] = process.argv.slice(2), WORK = path.resolve(WORK_);
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), C = require("./ppcands.cjs");
const src = fs.readFileSync(path.join(__dirname, "../../src/app.js"), "utf8");
const grab = (name) => { const i = src.indexOf(`function ${name}(`); let depth = 0; for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && !--depth) return src.slice(i, k + 1); } };
const refineEdge = new Function(`const RES = 1024; ${grab("morph")} ${grab("boxBlur")} ${grab("refineEdge")} return refineEdge;`)();
const N = 1024 * 1024;
(async () => {
  const man = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const files = fs.readdirSync(path.join(WORK, "raw", NAME)).filter((f) => f.endsWith(".png")).filter((_, i) => i % 40 === 0).slice(0, 20);
  const masks = [];
  for (const f of files) {
    const raw = await sharp(path.join(WORK, "raw", NAME, f)).extractChannel(0).raw().toBuffer(), pre = C.pre(raw, KIND === "isnet");
    const rgb = await sharp(path.join(WORK, man[f.slice(0, -4)].image)).removeAlpha().resize(1024, 1024, { fit: "fill" }).raw().toBuffer(), px = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
    masks.push([pre, C.lut(pre), rgb, px]);
  }
  C.CANDIDATES.page = (pre, base, rgb, px) => {
    const img = { data: new Uint8ClampedArray(N * 4) }; for (let i = 0; i < N; i++) img.data[i * 4 + 3] = base[i];
    const t = performance.now(); refineEdge(px, img); return performance.now() - t; // its own time, without the copy above
  };
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const time = (fn) => { for (let w = 0; w < 3; w++) fn(...masks[w]); const ts = masks.map((m) => { const t = performance.now(), v = fn(...m); return typeof v === "number" ? v : performance.now() - t; }); return `median ${med([...ts]).toFixed(1)} ms, max ${Math.max(...ts).toFixed(1)} ms`; };
  console.log("today's despeck" + (KIND === "isnet" ? " + haze" : ""), time((p) => { C.pre(p, KIND === "isnet"); }), "(reference)");
  for (const k of cands) console.log(k, time(C.CANDIDATES[k]));
})();
