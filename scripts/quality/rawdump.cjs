// Saves each model's raw mask (sigmoid applied, scaled to 1024, one byte a pixel: what segment() in app.js starts from)
// for the photos with a ground truth, so post-processing experiments (postproc.cjs) don't rerun the model.
//   node rawdump.cjs <work dir> <name> <model.onnx> <isnet|birefnet> [input side, default 1024]   (env EP=webgpu|cpu)
// Writes <work dir>/raw/<name>/<id>.png.
const fs = require("fs"), path = require("path");
const WORK = path.resolve(process.argv[2]), NAME = process.argv[3], FILE = path.resolve(process.argv[4]), KIND = process.argv[5], MRES = +(process.argv[6] || 1024);
const req = (m) => require(require.resolve(m, { paths: [path.join(WORK, "harness")] }));
const ort = req("onnxruntime-node"), sharp = req("sharp");
const NORM = { isnet: { mean: [128, 128, 128], std: [256, 256, 256], logits: false }, birefnet: { mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true } }[KIND];
const RES = 1024;

(async () => {
  const rows = fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.gt && r.gtKind !== "coarse");
  const outDir = path.join(WORK, "raw", NAME); fs.mkdirSync(outDir, { recursive: true });
  const session = await ort.InferenceSession.create(FILE, { executionProviders: [process.env.EP || "webgpu"], graphOptimizationLevel: "all", logSeverityLevel: 3 });
  let k = 0;
  for (const r of rows) {
    const dst = path.join(outDir, r.id + ".png");
    if (fs.existsSync(dst)) continue;
    const file = path.join(WORK, r.image), meta = await sharp(file).metadata();
    // As run.cjs: the page keeps a bitmap of at most 1600 px and draws it stretched to the model's square.
    const W = meta.width, H = meta.height, pk = Math.min(1, 1600 / Math.max(W, H));
    let img = sharp(file).removeAlpha();
    if (pk < 1) img = sharp(await img.resize(Math.round(W * pk), Math.round(H * pk), { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: Math.round(W * pk), height: Math.round(H * pk), channels: 3 } });
    const rgb = await img.resize(MRES, MRES, { fit: "fill", kernel: "linear" }).raw().toBuffer(), n = MRES * MRES, input = new Float32Array(3 * n);
    for (let c = 0; c < 3; c++) { const m = NORM.mean[c], s = 1 / NORM.std[c]; for (let i = 0; i < n; i++) input[c * n + i] = (rgb[i * 3 + c] - m) * s; }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, MRES, MRES]) }, [session.outputNames[0]]);
    const m = out[session.outputNames[0]].data, u8 = Buffer.alloc(n);
    for (let i = 0; i < n; i++) { const v = NORM.logits ? 1 / (1 + Math.exp(-m[i])) : m[i]; u8[i] = Math.round(Math.max(0, Math.min(255, v * 255))); }
    let img8 = sharp(u8, { raw: { width: MRES, height: MRES, channels: 1 } });
    if (MRES !== RES) img8 = sharp(await img8.resize(RES, RES, { fit: "fill", kernel: "linear" }).extractChannel(0).raw().toBuffer(), { raw: { width: RES, height: RES, channels: 1 } });
    await img8.png().toFile(dst);
    if (++k % 100 === 0) console.log(NAME, k, "/", rows.length);
  }
  console.log(NAME, "done");
})();
