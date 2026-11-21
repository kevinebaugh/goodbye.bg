// The engine: a background-removal model on ONNX Runtime Web, in its own worker. One worker runs one
// execution provider: "webgpu" (fast) or "wasm" (CPU). A failed GPU run can break the runtime for good,
// so the page terminates this worker and starts a CPU one rather than retrying in place.
// Nothing here talks to anything but this site.
//
// Two models, both 1024x1024 in, one mask out:
// - BiRefNet lite (MIT), GPU only: much better on hair, close-ups over a blurred background and busy
//   backdrops. About 0.3 s a photo on an M-series Mac. Too slow and too big for the CPU (10 s, 6.7 GB).
//   Input ImageNet mean/std, output logits.
// - ISNet medium (AGPL, IMG.LY): the CPU engine, and the GPU engine when the build has no BiRefNet.
//   Input (x - 128) / 256, output 0..1.

const RT = "./rt/%ORT%/";            // versioned by the build, so upgrades never mix with cached files
const HAS_BIREFNET = "%BIREFNET%" === "1"; // set by the build: dist/m/birefnet/ exists
const MODELS = {
  isnet: { dir: "./m/isnet/", mean: [128, 128, 128], std: [256, 256, 256], logits: false },
  birefnet: { dir: "./m/birefnet/", mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true },
};
const RES = 1024;
let ort, session, model, failMode = "", debug = false;
const dbg = (step, data = {}) => debug && postMessage({ type: "dbg", step, data });

// Fetch a split file (Cloudflare Pages allows 25 MiB per file). Each part retries on its own.
async function fetchParts(dir, progress) {
  const manifest = await (await fetch(dir + "manifest.json")).json();
  let got = 0; const parts = [];
  for (const p of manifest.parts) {
    for (let attempt = 1; ; attempt++) {
      const chunks = []; let partGot = 0;
      try {
        const res = await fetch(dir + p);
        if (!res.ok) throw new Error(`Could not load ${p} (${res.status})`);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); partGot += value.length;
          progress?.((got + partGot) / manifest.size);
        }
        parts.push(...chunks); got += partGot;
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`Retrying ${dir}${p}`, e);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

// RGBA pixels (RES x RES) to the model's planar float input.
function toInput(px) {
  const n = RES * RES, input = new Float32Array(3 * n), { mean, std } = model;
  for (let c = 0; c < 3; c++) {
    const m = mean[c], s = 1 / std[c], o = c * n;
    for (let i = 0; i < n; i++) input[o + i] = (px[i * 4 + c] - m) * s;
  }
  return input;
}

async function run(input, warmUp = false) {
  if (!warmUp && failMode === "run") throw new Error("Forced GPU run failure (?gpufail=run)");
  if (!warmUp && failMode === "hang") return new Promise(() => {});
  dbg("run-start", { warmUp });
  const t0 = performance.now();
  // Ask for the final mask only. The model has 12 more side outputs, and computing them holds hundreds of MB.
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, RES, RES]) }, [session.outputNames[0]]);
  dbg("run-done");
  const mask = Float32Array.from(await out[session.outputNames[0]].getData());
  if (model.logits) for (let i = 0; i < mask.length; i++) mask[i] = 1 / (1 + Math.exp(-mask[i]));
  dbg("mask-read");
  const ms = Math.round(performance.now() - t0);
  // A broken GPU can return garbage instead of throwing. NaN or infinity counts as a failure.
  for (let i = 0; i < mask.length; i += 61) if (!Number.isFinite(mask[i])) throw new Error("Engine returned invalid values");
  return { mask, ms };
}

onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      failMode = data.ep === "webgpu" ? data.fail || "" : ""; debug = !!data.debug;
      // BiRefNet only on the GPU; ?model=isnet|birefnet (sent by the page) forces one where it can run.
      const name = data.ep === "webgpu" && HAS_BIREFNET && data.model !== "isnet" ? "birefnet" : "isnet";
      model = MODELS[name];
      dbg("init", { ep: data.ep, model: name });
      ort = await import(RT + "ort.webgpu.min.mjs");
      ort.env.wasm.wasmPaths = new URL(RT, location.href).href;
      ort.env.wasm.wasmBinary = await fetchParts(RT + "wasm/");
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(data.threads || 4, navigator.hardwareConcurrency || 2) : 1;
      let bytes = await fetchParts(model.dir, (f) => postMessage({ type: "progress", f }));
      postMessage({ type: "loaded" }); dbg("model-fetched");
      // logSeverityLevel 3: errors only (BiRefNet otherwise prints a page of harmless constant-folding warnings).
      session = await ort.InferenceSession.create(bytes, { executionProviders: [data.ep], graphOptimizationLevel: "all", logSeverityLevel: 3 });
      dbg("session"); bytes = null; ort.env.wasm.wasmBinary = undefined; // the runtime has its own copies now; free ours (phones are tight)
      if (data.ep === "webgpu" && !data.noWarm) {
        // Warm-up: compiles the shaders now instead of on the first photo, and proves the GPU works.
        if (failMode === "init") throw new Error("Forced GPU warm-up failure (?gpufail=init)");
        const probe = new Float32Array(3 * RES * RES);
        for (let i = 0; i < probe.length; i++) probe[i] = ((i % RES) / RES - 0.5) * 0.9;
        dbg("warmup"); const { ms } = await run(probe, true); dbg("warm", { ms });
        console.info(`goodbye.bg: GPU warm-up ${ms} ms`);
      }
      postMessage({ type: "ready", model: name });
    } catch (e) {
      dbg("init-failed", { error: String(e?.message || e).slice(0, 200) });
      postMessage({ type: "failed", error: String(e?.message || e) });
    }
  } else if (data.type === "run") {
    try {
      const { mask, ms } = await run(toInput(data.pixels));
      postMessage({ type: "result", id: data.id, mask, ms }, [mask.buffer]);
    } catch (e) {
      postMessage({ type: "error", id: data.id, error: String(e?.message || e) });
    }
  }
};
