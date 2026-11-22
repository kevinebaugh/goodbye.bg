// What a 👎 on a BiRefNet 640 result gives on the page (docs/phone-birefnet640.md): ISNet 1024, zoomed on the subject
// and merged into the 640 mask where zoomRect finds room (as mergeRetry), else ISNet on the whole photo.
// Starts from the raw masks rawdump.cjs saved (raw/bir640) and the full-frame ISNet scores (out/isnet, finals.cjs).
// The page went with the whole photo for every 640 retry (zoomed: 0.82 on thin products, whole 0.92); this script
// measured the zoomed variant. Scores like finals.cjs. Writes <work dir>/out/retry-isnet/scores.jsonl with the retry's own score per photo.
//   node retry-isnet.cjs <work dir> <isnet.onnx> [set ...]
const fs = require("fs"), path = require("path");
const P = require("./pipeline.cjs");
const WORK = path.resolve(process.argv[2]), MODEL = path.resolve(process.argv[3]), SETS = process.argv.slice(4);
const req = (m) => require(require.resolve(m, { paths: [path.join(WORK, "harness")] }));
const ort = req("onnxruntime-node"), sharp = req("sharp");
const RES = 1024, EVAL_MAX = 2048, ISNET = { mean: [128, 128, 128], std: [256, 256, 256] };
const load = (e) => Object.fromEntries(fs.readFileSync(path.join(WORK, "out", e, "scores.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));

(async () => {
  const isnetScores = load("isnet");
  const rows = fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((r) => r.gt && r.gtKind !== "coarse" && (!SETS.length || SETS.includes(r.set)));
  const outDir = path.join(WORK, "out", "retry-isnet"); fs.mkdirSync(outDir, { recursive: true });
  const res = fs.createWriteStream(path.join(outDir, "scores.jsonl"));
  const session = await ort.InferenceSession.create(MODEL, { executionProviders: ["cpu"], graphOptimizationLevel: "all", logSeverityLevel: 3 });
  let k = 0;
  for (const r of rows) {
    const file = path.join(WORK, r.image), meta = await sharp(file).metadata(), W = meta.width, H = meta.height;
    // The 640 result as the page has it: despeck, no haze hardening (ISNet only), box before the edge curve.
    const raw = await sharp(path.join(WORK, "raw", "bir640", r.id + ".png")).extractChannel(0).raw().toBuffer();
    const first = P.postprocess(Float32Array.from(raw, (v) => v / 255));
    const z = P.zoomRect(first.box, 0.8);
    const row = { id: r.id, set: r.set, cat: r.cat, w: W, h: H, zoom: z ? +((z.x1 - z.x0) * (z.y1 - z.y0)).toFixed(3) : null };
    if (!z) { // no room to zoom: ISNet on the whole photo, the same mask as finals.cjs made for out/isnet
      const s = isnetScores[r.id];
      Object.assign(row, { iou: s.iou, biou: s.biou, edge: s.edge, predFrac: s.predFrac, how: "full" });
    } else {
      const left = Math.round(z.x0 * W), top = Math.round(z.y0 * H), width = Math.max(1, Math.min(W - left, Math.round((z.x1 - z.x0) * W))), height = Math.max(1, Math.min(H - top, Math.round((z.y1 - z.y0) * H)));
      const rgb = await sharp(file).removeAlpha().extract({ left, top, width, height }).resize(RES, RES, { fit: "fill", kernel: width > RES ? "lanczos3" : "linear" }).raw().toBuffer();
      const px = new Uint8ClampedArray(RES * RES * 4);
      for (let i = 0; i < RES * RES; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", P.toInput(px, ISNET), [1, 3, RES, RES]) }, [session.outputNames[0]]);
      const m2 = P.postprocess(Float32Array.from(out[session.outputNames[0]].data), 0.3); // ISNet: haze hardening on
      let alpha = first.alpha, side = RES;
      if (m2.box) { // as run.cjs PASS2 (mergeRetry: the zoomed part keeps its 1024 px, at most 2048 on a side)
        const rect = { x: left / W, y: top / H, w: width / W, h: height / H };
        side = Math.round(RES * Math.min(2, 1 / Math.max(rect.w, rect.h)));
        const up = (buf, w, h) => sharp(Buffer.from(buf), { raw: { width: RES, height: RES, channels: 1 } }).resize(w, h, { fit: "fill", kernel: "linear" }).extractChannel(0).raw().toBuffer();
        const rw = Math.max(1, Math.round(rect.w * side)), rh = Math.max(1, Math.round(rect.h * side));
        alpha = P.merge(await up(first.alpha, side, side), side, await up(m2.alpha, rw, rh), Math.round(rect.x * side), Math.round(rect.y * side), rw, rh);
      }
      const ek = Math.min(1, EVAL_MAX / Math.max(W, H)), ew = Math.round(W * ek), eh = Math.round(H * ek);
      const pred = await sharp(Buffer.from(alpha), { raw: { width: side, height: side, channels: 1 } }).resize(ew, eh, { fit: "fill", kernel: "mitchell" }).extractChannel(0).raw().toBuffer();
      const gt = await sharp(path.join(WORK, r.gt)).resize(ew, eh, { fit: "fill", kernel: ek < 1 ? "lanczos3" : "nearest" }).extractChannel(0).raw().toBuffer();
      const s = P.score(pred, gt, ew, eh, r.gtKind);
      Object.assign(row, { iou: +s.iou.toFixed(5), biou: s.biou != null ? +s.biou.toFixed(5) : null, edge: s.edge != null ? +s.edge.toFixed(5) : null, predFrac: +s.predFrac.toFixed(5), how: m2.box ? "zoom" : "zoom-empty" });
    }
    res.write(JSON.stringify(row) + "\n");
    if (++k % 50 === 0) console.log(k, "/", rows.length);
  }
  res.end(() => process.exit(0));
})();
