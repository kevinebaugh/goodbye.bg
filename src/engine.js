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
const BIREFNET = "%BIREFNET%";       // set by the build: "birefnet-<hash>", or "" when the build has no BiRefNet
const MODELS = {
  isnet: { dir: "./m/isnet/", mean: [128, 128, 128], std: [256, 256, 256], logits: false },
  birefnet: { dir: `./m/${BIREFNET}/`, mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true },
};
const RES = 1024;
let ort, session, model, failMode = "", debug = false, runs = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (step, data = {}) => debug && postMessage({ type: "dbg", step, data });

// Fetch a split file (Cloudflare Pages allows 25 MiB per file). Each part retries on its own.
// Straight into one buffer of the final size: chunks plus a Blob plus its copy held the model three times over.
async function fetchParts(dir, progress) {
  const manifest = await (await fetch(dir + "manifest.json")).json();
  const out = new Uint8Array(manifest.size);
  let got = 0;
  for (const p of manifest.parts) {
    for (let attempt = 1; ; attempt++) {
      let partGot = 0;
      try {
        const res = await fetch(dir + p);
        if (!res.ok) throw new Error(`Could not load ${p} (${res.status})`);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (got + partGot + value.length > out.length) throw new Error(`${p} is larger than the manifest says`);
          out.set(value, got + partGot); partGot += value.length;
          progress?.((got + partGot) / manifest.size);
        }
        got += partGot; // a retry starts this part over at the same place
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`Retrying ${dir}${p}`, e);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  if (got !== out.length) throw new Error(`${dir} is ${got} bytes, the manifest says ${out.length}`);
  return out;
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
  const first = !warmUp && !runs++;
  // BiRefNet only (the page then tries ISNet on the GPU): the worker dies as if out of memory, or the first photo is slow.
  if (first && failMode === "birefnet-oom") { setTimeout(() => { throw new Error("Forced out of memory (?gpufail=birefnet-oom)"); }); return new Promise(() => {}); }
  dbg("run-start", { warmUp });
  const t0 = performance.now();
  if (first && failMode === "birefnet-slowrun") await sleep(2500);
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
      debug = !!data.debug;
      // BiRefNet only on the GPU; ?model=isnet|birefnet (sent by the page) forces one where it can run.
      const name = data.ep === "webgpu" && BIREFNET && data.model !== "isnet" ? "birefnet" : "isnet";
      // ?gpufail=init|run|hang breaks every GPU engine; birefnet-init|birefnet-oom|birefnet-slow|birefnet-slowrun only BiRefNet.
      failMode = data.ep !== "webgpu" ? "" : /^birefnet-/.test(data.fail || "") ? (name === "birefnet" ? data.fail : "") : data.fail || "";
      model = MODELS[name];
      postMessage({ type: "model", name }); // now, so a crash while starting up is reported against the right model
      dbg("init", { ep: data.ep, model: name });
      // Runtime code, runtime wasm and model all at once: one after the other cost a round trip or two each, and the
      // model could not start until the runtime was in. Both buffers were held together until the session anyway.
      const wasmP = fetchParts(RT + "wasm/"), modelP = fetchParts(model.dir, (f) => postMessage({ type: "progress", f }));
      wasmP.catch(() => {}); modelP.catch(() => {}); // a failure is thrown below, where it is awaited
      ort = await import(RT + "ort.webgpu.min.mjs");
      ort.env.wasm.wasmPaths = new URL(RT, location.href).href;
      ort.env.wasm.wasmBinary = await wasmP;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(data.threads || 4, navigator.hardwareConcurrency || 2) : 1;
      let bytes = await modelP;
      postMessage({ type: "loaded" }); dbg("model-fetched");
      // logSeverityLevel 3: errors only (BiRefNet otherwise prints a page of harmless constant-folding warnings).
      session = await ort.InferenceSession.create(bytes, { executionProviders: [data.ep], graphOptimizationLevel: "all", logSeverityLevel: 3 });
      dbg("session"); bytes = null; ort.env.wasm.wasmBinary = undefined; // the runtime has its own copies now; free ours (phones are tight)
      if (data.ep === "webgpu" && !data.noWarm) {
        // Warm-up: compiles the shaders now instead of on the first photo, and proves the GPU works.
        if (failMode === "init") throw new Error("Forced GPU warm-up failure (?gpufail=init)");
        // A real delay first, so a photo added meanwhile has to wait for the fallback.
        if (failMode === "birefnet-init") { await sleep(3000); throw new Error("Forced BiRefNet warm-up failure (?gpufail=birefnet-init)"); }
        if (failMode === "birefnet-slow") await sleep(60_000); // the page gives up on a slow BiRefNet start
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
