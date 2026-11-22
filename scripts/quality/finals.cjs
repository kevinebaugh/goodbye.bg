// Final masks and scores from the raw masks rawdump.cjs saved (docs/quality-products.md). Runs the page's pipeline
// (despeck, hardenHaze for ISNet, the edge curve) and, with PP=1, the ?pp=1 edge filter (refineEdge on branch
// mask-postprocess, the candidate guidedRGB_4_0.001_open1). Scores like run.cjs (mask scaled to the photo, at most
// EVAL_MAX px, default 2048). Photos with an aux mask (seller shots: the shadow or reflection) also get `kept`, the share
// of that area the cut-out keeps.
//   node finals.cjs <work dir> <raw name> <isnet|birefnet> [jobs]   -> <work dir>/out/<raw name>[-pp]/{<id>.png,scores.jsonl}
const fs = require("fs"), path = require("path"), { fork } = require("child_process");
const P = require("./pipeline.cjs"), C = require("./ppcands.cjs");
const [WORK_, NAME, KIND, JOBS_] = process.argv.slice(2), WORK = path.resolve(WORK_);
const RES = 1024, EVAL_MAX = +process.env.EVAL_MAX || 2048, PP = !!+process.env.PP, OUT = path.join(WORK, "out", NAME + (PP ? "-pp" : ""));
const REFINE = C.CANDIDATES["guidedRGB_4_0.001_open1"];

if (!process.env.FIN_PART) {
  const jobs = +JOBS_ || 6; fs.mkdirSync(OUT, { recursive: true });
  let left = jobs; const parts = [];
  for (let j = 0; j < jobs; j++) {
    const f = path.join(OUT, `scores.part${j}`); parts.push(f);
    fork(__filename, process.argv.slice(2), { env: { ...process.env, FIN_PART: `${j}/${jobs}`, FIN_OUT: f } }).on("exit", (code) => {
      if (code) console.error("part", j, "exit", code);
      if (--left) return;
      fs.writeFileSync(path.join(OUT, "scores.jsonl"), parts.map((p) => fs.readFileSync(p, "utf8")).join(""));
      parts.forEach((p) => fs.unlinkSync(p)); console.log(NAME, PP ? "pp" : "", "done");
    });
  }
} else (async () => {
  const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] }));
  const [j, jobs] = process.env.FIN_PART.split("/").map(Number), out = fs.createWriteStream(process.env.FIN_OUT);
  const rows = fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((_, i) => i % jobs === j);
  for (const r of rows) {
    const file = path.join(WORK, r.image), meta = await sharp(file).metadata(), W = meta.width, H = meta.height;
    const raw = await sharp(path.join(WORK, "raw", NAME, r.id + ".png")).extractChannel(0).raw().toBuffer();
    let alpha = C.lut(C.pre(raw, KIND === "isnet"));
    if (PP) { // the photo at 1024, as the page draws it, guides the filter
      const pk = Math.min(1, 1600 / Math.max(W, H));
      let img = sharp(file).removeAlpha();
      if (pk < 1) img = sharp(await img.resize(Math.round(W * pk), Math.round(H * pk), { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: Math.round(W * pk), height: Math.round(H * pk), channels: 3 } });
      alpha = REFINE(null, alpha, await img.resize(RES, RES, { fit: "fill", kernel: "linear" }).raw().toBuffer());
    }
    await sharp(Buffer.from(alpha), { raw: { width: RES, height: RES, channels: 1 } }).png().toFile(path.join(OUT, r.id + ".png"));
    const ek = Math.min(1, EVAL_MAX / Math.max(W, H)), ew = Math.round(W * ek), eh = Math.round(H * ek);
    const pred = await sharp(Buffer.from(alpha), { raw: { width: RES, height: RES, channels: 1 } }).resize(ew, eh, { fit: "fill", kernel: "mitchell" }).extractChannel(0).raw().toBuffer();
    const load = (f) => sharp(path.join(WORK, f)).resize(ew, eh, { fit: "fill", kernel: ek < 1 ? "lanczos3" : "nearest" }).extractChannel(0).raw().toBuffer();
    const s = P.score(pred, await load(r.gt), ew, eh, r.gtKind);
    const row = { id: r.id, set: r.set, cat: r.cat, w: W, h: H, box: P.boxOf(alpha, RES), iou: +s.iou.toFixed(5), mae: +s.mae.toFixed(5), prec: +s.prec.toFixed(4), rec: +s.rec.toFixed(4), predFrac: +s.predFrac.toFixed(5), gtFrac: +s.gtFrac.toFixed(5) };
    if (s.biou != null) { row.biou = +s.biou.toFixed(5); row.edge = +s.edge.toFixed(5); }
    if (r.look) { row.look = r.look; row.lum = r.lum; }
    if (r.aux) {
      const aux = await load(r.aux); let a = 0, k = 0;
      for (let i = 0; i < aux.length; i++) if (aux[i] >= 128) { a++; if (pred[i] >= 128) k++; }
      row.kept = a ? +(k / a).toFixed(4) : 0;
    }
    out.write(JSON.stringify(row) + "\n");
  }
  out.end(() => process.exit(0));
})();
