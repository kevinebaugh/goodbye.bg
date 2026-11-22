// The engine: a background-removal model on ONNX Runtime Web, in its own worker. One worker runs one
// execution provider: "webgpu" (fast) or "wasm" (CPU). A failed GPU run can break the runtime for good,
// so the page terminates this worker and starts a CPU one rather than retrying in place.
// Nothing here talks to anything but this site.
//
// The page always sends 1024x1024 RGBA and gets a 1024x1024 mask back; a model with a smaller input gets a
// downscaled copy and its mask is scaled back up here. Three models:
// - BiRefNet lite (MIT) at 1024, GPU on computers: much better on hair, close-ups over a blurred background and busy
//   backdrops. About 0.3 s a photo on an M-series Mac. Too slow and too big for the CPU at 1024 (10 s, 6.7 GB).
// - BiRefNet lite at 640, the CPU engine (iPhones, the fallback): close to ISNet's memory and time, clearly better
//   cut-outs (docs/platforms-and-phone-model.md, docs/phone-birefnet640.md). ?model=isnet brings ISNet back.
//   Both BiRefNets: input ImageNet mean/std, output logits.
// - ISNet medium (AGPL, IMG.LY) at 1024: the GPU engine on phones and tablets, and wherever the build lacks BiRefNet.
//   Input (x - 128) / 256, output 0..1.

const RT = "./rt/%ORT%/";            // versioned by the build, so upgrades never mix with cached files
const BIREFNET = "%BIREFNET%";       // set by the build: "birefnet-<hash>", or "" when the build has no BiRefNet
const BIREFNET640 = "%BIREFNET640%"; // the same for the 640 export: "birefnet640-<hash>" or ""
const IMAGENET = { mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], logits: true };
const MODELS = {
  isnet: { dir: "./m/isnet/", res: 1024, mean: [128, 128, 128], std: [256, 256, 256], logits: false },
  birefnet: { dir: `./m/${BIREFNET}/`, res: 1024, ...IMAGENET },
  birefnet640: { dir: `./m/${BIREFNET640}/`, res: 640, ...IMAGENET },
};
const RES = 1024; // what the page sends and gets back
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

// Box-filter weights for scaling `from` samples down to `to`: for each output, the inputs it covers and how much.
function boxTaps(from, to) {
  const k = from / to, taps = [];
  for (let o = 0; o < to; o++) {
    const a = o * k, b = a + k, t = [];
    for (let i = Math.floor(a); i < Math.min(from, Math.ceil(b)); i++) t.push(i, (Math.min(b, i + 1) - Math.max(a, i)) / k);
    taps.push(t);
  }
  return taps;
}

// RGBA pixels (RES x RES) to the model's planar float input (model.res square, area-averaged when smaller).
function toInput(px) {
  const R = model.res, n = R * R, input = new Float32Array(3 * n), { mean, std } = model;
  if (R === RES) {
    for (let c = 0; c < 3; c++) {
      const m = mean[c], s = 1 / std[c], o = c * n;
      for (let i = 0; i < n; i++) input[o + i] = (px[i * 4 + c] - m) * s;
    }
    return input;
  }
  const taps = boxTaps(RES, R);
  for (let y = 0; y < R; y++) {
    const ty = taps[y];
    for (let x = 0; x < R; x++) {
      const tx = taps[x]; let r = 0, g = 0, b = 0;
      for (let j = 0; j < ty.length; j += 2) {
        const row = ty[j] * RES, wy = ty[j + 1];
        for (let i = 0; i < tx.length; i += 2) {
          const w = wy * tx[i + 1], p = (row + tx[i]) * 4;
          r += px[p] * w; g += px[p + 1] * w; b += px[p + 2] * w;
        }
      }
      const o = y * R + x;
      input[o] = (r - mean[0]) / std[0]; input[n + o] = (g - mean[1]) / std[1]; input[2 * n + o] = (b - mean[2]) / std[2];
    }
  }
  return input;
}

// A model.res square mask back up to RES x RES, bilinear (pixel centres line up, edges clamp).
function upscale(m, R) {
  const out = new Float32Array(RES * RES), k = R / RES, i0 = new Int32Array(RES), i1 = new Int32Array(RES), f = new Float32Array(RES);
  for (let o = 0; o < RES; o++) {
    const s = Math.min(R - 1, Math.max(0, (o + 0.5) * k - 0.5)), a = Math.floor(s);
    i0[o] = a; i1[o] = Math.min(R - 1, a + 1); f[o] = s - a;
  }
  for (let y = 0; y < RES; y++) {
    const r0 = i0[y] * R, r1 = i1[y] * R, fy = f[y];
    for (let x = 0; x < RES; x++) {
      const a = i0[x], b = i1[x], fx = f[x];
      const top = m[r0 + a] + (m[r0 + b] - m[r0 + a]) * fx, bot = m[r1 + a] + (m[r1 + b] - m[r1 + a]) * fx;
      out[y * RES + x] = top + (bot - top) * fy;
    }
  }
  return out;
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
  const R = model.res;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, R, R]) }, [session.outputNames[0]]);
  dbg("run-done");
  let mask = Float32Array.from(await out[session.outputNames[0]].getData());
  if (model.logits) for (let i = 0; i < mask.length; i++) mask[i] = 1 / (1 + Math.exp(-mask[i]));
  if (R !== RES) mask = upscale(mask, R); // the page's despeckle, crop box, 👎 merge and GIF frames all work at 1024
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
      // GPU: BiRefNet at 1024 on computers (its ~3 GB GPU peak is too much for phones), else ISNet.
      // CPU: BiRefNet at 640. ?model=isnet (sent by the page, also when the GPU gate steps BiRefNet down) forces ISNet
      // on either; ?model=birefnet gives the GPU BiRefNet off computers too.
      const name = data.model === "isnet" ? "isnet"
        : data.ep === "webgpu" ? (BIREFNET && (data.desktop || data.model === "birefnet") ? "birefnet" : "isnet")
        : BIREFNET640 ? "birefnet640" : "isnet";
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
        const R = model.res, probe = new Float32Array(3 * R * R);
        for (let i = 0; i < probe.length; i++) probe[i] = ((i % R) / R - 0.5) * 0.9;
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
