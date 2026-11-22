// Post-processing experiments on the model's mask (docs/mask-postprocess.md). Starts from the raw masks rawdump.cjs saved,
// runs the page's pipeline (despeck, hardenHaze for ISNet, the edge curve) with one candidate step added, and scores
// every candidate against the ground truth the way run.cjs does.
//   node postproc.cjs <work dir> <raw name> <isnet|birefnet> [jobs]      -> <work dir>/pp/<raw name>.jsonl
// Each line: { id, set, half, base: score, c: { candidate: score | 0 (mask unchanged) } }. half 0 tunes, half 1 reports.
const fs = require("fs"), path = require("path"), { fork } = require("child_process");
const P = require("./pipeline.cjs"), C = require("./ppcands.cjs");
const [WORK_, NAME, KIND, JOBS_] = process.argv.slice(2), WORK = path.resolve(WORK_);
const RES = 1024, EVAL_MAX = 2048, SUFFIX = process.env.PP_ONLY ? "." + (process.env.PP_SUFFIX || "x") : ""; // PP_ONLY=<regex> runs some candidates into <name>.<PP_SUFFIX>.jsonl
const half = (id) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return (h >>> 16) & 1; };

if (!process.env.PP_PART) {
  const jobs = +JOBS_ || 8, outDir = path.join(WORK, "pp"); fs.mkdirSync(outDir, { recursive: true });
  let left = jobs; const parts = [];
  for (let j = 0; j < jobs; j++) {
    const f = path.join(outDir, `${NAME}${SUFFIX}.part${j}`); parts.push(f);
    fork(__filename, process.argv.slice(2), { env: { ...process.env, PP_PART: `${j}/${jobs}`, PP_OUT: f } }).on("exit", (code) => {
      if (code) console.error("part", j, "exit", code);
      if (--left) return;
      fs.writeFileSync(path.join(outDir, NAME + SUFFIX + ".jsonl"), parts.map((p) => fs.readFileSync(p, "utf8")).join(""));
      parts.forEach((p) => fs.unlinkSync(p)); console.log(NAME, "done");
    });
  }
} else (async () => {
  const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] }));
  const [j, jobs] = process.env.PP_PART.split("/").map(Number), out = fs.createWriteStream(process.env.PP_OUT);
  const rows = fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.gt && r.gtKind !== "coarse").filter((_, i) => i % jobs === j);
  const only = process.env.PP_ONLY ? new RegExp(process.env.PP_ONLY) : null;
  for (const r of rows) {
    const file = path.join(WORK, r.image), meta = await sharp(file).metadata(), W = meta.width, H = meta.height;
    const raw = await sharp(path.join(WORK, "raw", NAME, r.id + ".png")).extractChannel(0).raw().toBuffer();
    // The photo at 1024, as the page draws it (for the guided filter).
    const pk = Math.min(1, 1600 / Math.max(W, H));
    let img = sharp(file).removeAlpha();
    if (pk < 1) img = sharp(await img.resize(Math.round(W * pk), Math.round(H * pk), { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: Math.round(W * pk), height: Math.round(H * pk), channels: 3 } });
    const rgb = await img.resize(RES, RES, { fit: "fill", kernel: "linear" }).raw().toBuffer();
    const ek = Math.min(1, EVAL_MAX / Math.max(W, H)), ew = Math.round(W * ek), eh = Math.round(H * ek);
    const gt = await sharp(path.join(WORK, r.gt)).resize(ew, eh, { fit: "fill", kernel: ek < 1 && r.gtKind !== "trimap" ? "lanczos3" : "nearest" }).extractChannel(0).raw().toBuffer();
    const score = async (alpha) => {
      const pred = await sharp(Buffer.from(alpha), { raw: { width: RES, height: RES, channels: 1 } }).resize(ew, eh, { fit: "fill", kernel: "mitchell" }).extractChannel(0).raw().toBuffer();
      const s = P.score(pred, gt, ew, eh, r.gtKind); let any = 0; for (let i = 0; i < alpha.length; i++) if (alpha[i] >= 128) { any = 1; break; }
      const o = { iou: +s.iou.toFixed(5), mae: +s.mae.toFixed(5), prec: +s.prec.toFixed(4), rec: +s.rec.toFixed(4), box: any };
      if (s.biou != null) { o.biou = +s.biou.toFixed(5); o.edge = +s.edge.toFixed(5); }
      return o;
    };
    const pre = C.pre(raw, KIND === "isnet"); // despeck (+ haze): the page's mask just before the edge curve
    const baseA = C.lut(pre);
    const row = { id: r.id, set: r.set, cat: r.cat, half: half(r.id), base: await score(baseA), c: {} };
    for (const [name, fn] of Object.entries(C.CANDIDATES)) {
      if (only && !only.test(name)) continue;
      const a = fn(pre, baseA, rgb);
      let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== baseA[i]) { same = false; break; }
      row.c[name] = same ? 0 : await score(a);
    }
    out.write(JSON.stringify(row) + "\n");
  }
  out.end(() => process.exit(0));
})();
