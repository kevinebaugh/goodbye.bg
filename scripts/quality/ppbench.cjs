// Time candidate steps at 1024 in one Node thread (warm-up first, then the median of 20 photos).
//   node ppbench.cjs <work dir> <raw name> <isnet|birefnet> <candidate> ...
const fs = require("fs"), path = require("path");
const [WORK_, NAME, KIND, ...cands] = process.argv.slice(2), WORK = path.resolve(WORK_);
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), C = require("./ppcands.cjs");
(async () => {
  const files = fs.readdirSync(path.join(WORK, "raw", NAME)).filter((f) => f.endsWith(".png")).filter((_, i) => i % 40 === 0).slice(0, 20);
  const masks = [];
  for (const f of files) { const raw = await sharp(path.join(WORK, "raw", NAME, f)).extractChannel(0).raw().toBuffer(); const pre = C.pre(raw, KIND === "isnet"); masks.push([pre, C.lut(pre)]); }
  const rgb = Buffer.alloc(1024 * 1024 * 3, 120), med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const time = (fn) => { for (let w = 0; w < 3; w++) fn(...masks[w], rgb); return med(masks.map(([p, b]) => { const t = performance.now(); fn(p, b, rgb); return performance.now() - t; })); };
  console.log("today's despeck" + (KIND === "isnet" ? " + haze" : ""), time((p) => C.pre(p, KIND === "isnet")).toFixed(1), "ms (reference)");
  for (const k of cands) console.log(k, time(C.CANDIDATES[k]).toFixed(1), "ms");
})();
