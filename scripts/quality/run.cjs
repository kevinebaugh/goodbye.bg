// Quality harness: runs both models the way the page does and scores the masks against ground truth.
// The pre- and post-processing below is copied from src/engine.js and src/app.js (segment, despeck, subjectBox, LUT,
// edgeColors); keep them in step. Photos live outside the repo. See docs/quality-1000.md.
//   node run.cjs <work dir> [isnet|birefnet ...]     (work dir holds manifest.jsonl, models/, out/)
const fs = require("fs"), path = require("path");
const WORK = path.resolve(process.argv[2]);
const req = (m) => require(require.resolve(m, { paths: [path.join(WORK, "harness")] }));
const ort = req("onnxruntime-node"), sharp = req("sharp");
const P = require("./pipeline.cjs");

const MODELS = {
  isnet: { mean: [128, 128, 128], std: [256, 256, 256], logits: false },
  birefnet: { mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true },
};
const RES = 1024, EVAL_MAX = 2048;
// Experiments: PASS2=<max share of the frame the zoomed part may cover, 0.8 on the page>, HARDEN=1 (see pipeline.cjs), TAG=<suffix of the out dir>.
const PASS2 = +process.env.PASS2 || 0, HARDEN = +process.env.HARDEN || 0, TAG = process.env.TAG || "";

(async () => {
  const names = process.argv.slice(3).length ? process.argv.slice(3) : ["isnet", "birefnet"];
  const EP = process.env.EP || "webgpu";
  const rows = fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const name of names) {
    const model = MODELS[name], outDir = path.join(WORK, "out", name + (EP === "webgpu" ? "" : "-" + EP) + TAG);
    fs.mkdirSync(outDir, { recursive: true });
    const session = await ort.InferenceSession.create(path.join(WORK, "models", name + ".onnx"), { executionProviders: [EP], graphOptimizationLevel: "all", logSeverityLevel: 3 });
    const res = fs.createWriteStream(path.join(outDir, "scores.jsonl"));
    let k = 0;
    for (const r of rows) {
      const file = path.join(WORK, r.image);
      // The page keeps a bitmap of at most 1600 px (resizeQuality high) and draws that to 1024x1024, stretched.
      const meta = await sharp(file).metadata();
      const W = meta.width, H = meta.height, pk = Math.min(1, 1600 / Math.max(W, H));
      let img = sharp(file).removeAlpha();
      if (pk < 1) img = sharp(await img.resize(Math.round(W * pk), Math.round(H * pk), { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: Math.round(W * pk), height: Math.round(H * pk), channels: 3 } });
      const infer = async (rgb) => { // rgb: 1024 x 1024 x 3, the stretched photo (or part of it)
        const px = new Uint8ClampedArray(RES * RES * 4);
        for (let i = 0; i < RES * RES; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
        const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", P.toInput(px, model), [1, 3, RES, RES]) }, [session.outputNames[0]]);
        const mask = Float32Array.from(out[session.outputNames[0]].data);
        if (model.logits) for (let i = 0; i < mask.length; i++) mask[i] = 1 / (1 + Math.exp(-mask[i]));
        return P.postprocess(mask, HARDEN); // alpha: what the page composites with (after despeck and the edge LUT)
      };
      const t0 = performance.now();
      let { alpha, box } = await infer(await img.resize(RES, RES, { fit: "fill", kernel: "linear" }).raw().toBuffer()), side = RES, zoom = null;
      // Second pass (the page's zoomed retry, done unasked): the subject with 15% room, again at 1024, merged into the first.
      const z = PASS2 && P.zoomRect(box, PASS2);
      if (z) {
        const left = Math.round(z.x0 * W), top = Math.round(z.y0 * H), width = Math.max(1, Math.min(W - left, Math.round((z.x1 - z.x0) * W))), height = Math.max(1, Math.min(H - top, Math.round((z.y1 - z.y0) * H)));
        const m2 = await infer(await sharp(file).removeAlpha().extract({ left, top, width, height }).resize(RES, RES, { fit: "fill", kernel: width > RES ? "lanczos3" : "linear" }).raw().toBuffer());
        if (m2.box) {
          zoom = (z.x1 - z.x0) * (z.y1 - z.y0);
          const rect = { x: left / W, y: top / H, w: width / W, h: height / H };
          side = Math.round(RES * Math.min(2, 1 / Math.max(rect.w, rect.h)));
          const up = (buf, w, h) => sharp(Buffer.from(buf), { raw: { width: RES, height: RES, channels: 1 } }).resize(w, h, { fit: "fill", kernel: "linear" }).extractChannel(0).raw().toBuffer();
          const rw = Math.max(1, Math.round(rect.w * side)), rh = Math.max(1, Math.round(rect.h * side));
          alpha = P.merge(await up(alpha, side, side), side, await up(m2.alpha, rw, rh), Math.round(rect.x * side), Math.round(rect.y * side), rw, rh, !!process.env.EDGEONLY);
          box = P.boxOf(alpha, side);
        }
      }
      const ms = Math.round(performance.now() - t0);
      await sharp(Buffer.from(alpha), { raw: { width: side, height: side, channels: 1 } }).png().toFile(path.join(outDir, r.id + ".png"));
      const row = { id: r.id, set: r.set, cat: r.cat, w: W, h: H, ms, box, zoom };
      if (r.gt) {
        // Score at the photo's own size (at most 2048 px on a side): the page scales the 1024 mask up to the photo.
        const ek = Math.min(1, EVAL_MAX / Math.max(W, H)), ew = Math.round(W * ek), eh = Math.round(H * ek);
        const pred = await sharp(Buffer.from(alpha), { raw: { width: side, height: side, channels: 1 } }).resize(ew, eh, { fit: "fill", kernel: "mitchell" }).extractChannel(0).raw().toBuffer();
        const truth = async (f) => { // trimap values must not be blended, so those scale by nearest
          const gt = await sharp(path.join(WORK, f)).resize(ew, eh, { fit: "fill", kernel: ek < 1 && r.gtKind !== "trimap" ? "lanczos3" : "nearest" }).extractChannel(0).raw().toBuffer(); // sharp hands grey images back as three channels
          return gt;
        };
        Object.assign(row, P.score(pred, await truth(r.gt), ew, eh, r.gtKind));
        if (r.gt2) row.iou2 = P.score(pred, await truth(r.gt2), ew, eh, r.gtKind).iou; // the subject plus what goes with it
      }
      res.write(JSON.stringify(row) + "\n");
      if (++k % 50 === 0) console.log(name, k, "/", rows.length, ms, "ms");
    }
    res.end(); await session.release?.();
  }
})();
