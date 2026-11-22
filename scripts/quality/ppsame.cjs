// Old (measured) vs new refineEdge, and old vs new hardenHaze, byte for byte on every raw mask of a set, with timing.
//   node ppsame.cjs <old app.js> <new app.js> <raw set> <birefnet|isnet>
const fs = require("fs"), path = require("path");
const [OLD, NEW, NAME, KIND] = process.argv.slice(2), WORK = path.join(process.env.HOME, "goodbye-bg-quality");
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), C = require(path.join(path.dirname(NEW), "../scripts/quality/ppcands.cjs"));
const load = (file) => { const src = fs.readFileSync(file, "utf8"), grab = (name) => { const i = src.indexOf(`function ${name}(`); let depth = 0; for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && !--depth) return src.slice(i, k + 1); } };
  return new Function(`const RES = 1024; ${grab("morph")} ${grab("boxBlur")} ${grab("refineEdge")} ${grab("hardenHaze")} return { refineEdge, hardenHaze };`)(); };
const o = load(OLD), nw = load(NEW), N = 1024 * 1024;
(async () => {
  const man = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const files = fs.readdirSync(path.join(WORK, "raw", NAME)).filter((f) => f.endsWith(".png")).sort();
  let same = 0, diff = 0, tOld = 0, tNew = 0, changedAny = 0;
  for (const f of files) {
    const raw = await sharp(path.join(WORK, "raw", NAME, f)).extractChannel(0).raw().toBuffer();
    const mk = (a) => { const img = { data: new Uint8ClampedArray(N * 4) }; for (let i = 0; i < N; i++) img.data[i * 4 + 3] = a[i]; return img; };
    let A, B;
    if (KIND === "isnet") { // hardenHaze on the despeckled mask
      const pre = C.pre(raw, false); A = mk(pre); B = mk(pre);
      let t = performance.now(); o.hardenHaze(A); tOld += performance.now() - t; t = performance.now(); nw.hardenHaze(B); tNew += performance.now() - t;
    } else {
      const base = C.lut(C.pre(raw, false)); A = mk(base); B = mk(base);
      const rgb = await sharp(path.join(WORK, man[f.slice(0, -4)].image)).removeAlpha().resize(1024, 1024, { fit: "fill" }).raw().toBuffer(), px = new Uint8ClampedArray(N * 4);
      for (let i = 0; i < N; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
      let t = performance.now(); const ca = o.refineEdge(px, A); tOld += performance.now() - t; t = performance.now(); const cb = nw.refineEdge(px, B); tNew += performance.now() - t;
      if (ca !== cb) { diff++; console.log("count differs", f, ca, cb); continue; }
      if (ca) changedAny++;
    }
    if (Buffer.compare(Buffer.from(A.data.buffer), Buffer.from(B.data.buffer)) === 0) same++; else { diff++; console.log("differs", f); }
  }
  console.log(`${NAME} ${KIND}: ${same} identical, ${diff} different (${changedAny} changed by the filter); total ms old ${tOld.toFixed(0)}, new ${tNew.toFixed(0)}`);
})();
