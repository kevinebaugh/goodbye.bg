// The engine: one ONNX Runtime session on the main thread, shared by the workers, one run at a time. WebGPU first
// (with a warm-up run that compiles the shaders and proves the GPU works), the CPU if that fails. Used by the folder
// mode and by `serve`.
"use strict";
const os = require("os");
const { modelPath } = require("./models.cjs");
const { MODELS, RES, toInput } = require("./pipeline.cjs");

// onnxruntime-node 1.31 (seen on macOS) has Microsoft's 1DS usage telemetry built in: unless told not to, it keeps a
// device ID and queues session events (Mac model, macOS version, app name, timings) in ~/Library/Application Support/
// Microsoft/DeveloperTools/.onnxruntime for upload. We promise no network use but the model download, so it is off,
// before ORT loads. Checked: with this set, nothing is written there.
process.env.ORT_DISABLE_TELEMETRY = "1";

// o: { model, engine: auto|gpu|cpu, quiet }. say(text): progress line. Returns { infer(px) -> mask, engine, stats, release }.
async function startEngine(o, say = () => {}) {
  const t0 = performance.now();
  const file = await modelPath(o.model, say);
  const ort = require("onnxruntime-node");
  const spec = MODELS[o.model];
  const warn = (s) => { if (!o.quiet) process.stderr.write(`\n${s}\n`); };
  let session, engine;
  const open = async (ep) => {
    const opts = { executionProviders: [ep], graphOptimizationLevel: "all", logSeverityLevel: 3 };
    if (ep === "cpu") opts.intraOpNumThreads = os.availableParallelism?.() || os.cpus().length;
    session = await ort.InferenceSession.create(file, opts);
    engine = ep === "cpu" ? "cpu" : "gpu";
  };
  const FAIL = process.env.GOODBYE_BG_GPUFAIL; // test switch: init or run simulates a broken GPU
  const run = async (input, warm = false) => {
    if (engine === "gpu" && FAIL === (warm ? "init" : "run")) throw new Error(`Forced GPU ${FAIL} failure`);
    const t = performance.now();
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, RES, RES]) }, [session.outputNames[0]]);
    const mask = Float32Array.from(out[session.outputNames[0]].data);
    for (let i = 0; i < mask.length; i += 61) if (!Number.isFinite(mask[i])) throw new Error("Engine returned invalid values");
    if (spec.logits) for (let i = 0; i < mask.length; i++) mask[i] = 1 / (1 + Math.exp(-mask[i]));
    return { mask, ms: performance.now() - t };
  };
  say(`Starting the ${o.model} model...`);
  if (o.engine !== "cpu") {
    // WebGPU everywhere ONNX Runtime ships it (Metal on Macs); DirectML as a second try on Windows (untested).
    const eps = process.platform === "win32" ? ["webgpu", "dml"] : ["webgpu"];
    let err;
    for (const ep of eps) {
      try {
        await open(ep);
        const probe = new Float32Array(3 * RES * RES);
        for (let i = 0; i < probe.length; i++) probe[i] = ((i % RES) / RES - 0.5) * 0.9;
        await run(probe, true);
        err = null; break;
      } catch (e) { err = e; session = null; }
    }
    if (err) {
      if (o.engine === "gpu") { const e = new Error(`the GPU engine failed to start: ${err.message}`); e.fatal = true; throw e; }
      warn(`GPU not available (${String(err.message).split("\n")[0]}), using the CPU.`);
    }
  }
  if (!session) await open("cpu");
  const stats = { readyMs: performance.now() - t0, inferMs: 0, runs: 0 };
  if (engine === "cpu" && o.model === "birefnet" && MODELS.isnet) warn(`Note: BiRefNet on the CPU is slow and needs a lot of memory. --model isnet is several times faster on the CPU.`); // AGPL-only

  // One run at a time. A failed GPU run switches to the CPU for the rest (a broken GPU can return garbage).
  let chain = Promise.resolve();
  const infer = (px) => {
    const p = chain.then(async () => {
      const input = toInput(px, spec);
      try { const r = await run(input); stats.inferMs += r.ms; stats.runs++; return r.mask; }
      catch (e) {
        if (engine !== "gpu" || o.engine === "gpu") throw e;
        warn(`GPU run failed (${String(e.message).split("\n")[0]}), switching to the CPU.`);
        await open("cpu");
        const r = await run(input); stats.inferMs += r.ms; stats.runs++; return r.mask;
      }
    });
    chain = p.catch(() => {}); // one failed photo must not fail every photo queued behind it
    return p;
  };
  return { infer, stats, get engine() { return engine; }, spec, release: () => session.release?.() };
}

module.exports = { startEngine };
