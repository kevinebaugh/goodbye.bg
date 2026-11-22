#!/usr/bin/env node
// goodbye-bg: cut out every photo in a folder on this computer. Nothing is uploaded; the only network use is the
// one-time model download from the goodbye.bg site.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { Worker } = require("worker_threads");
const { modelPath, cacheDir } = require("../lib/models.cjs");
const { MODELS, RES, toInput } = require("../lib/pipeline.cjs");
const VERSION = require("../package.json").version;

const HELP = `goodbye-bg ${VERSION}: remove backgrounds from photos on this computer. Nothing is uploaded.

Usage: goodbye-bg <photos or folders...> [options]

  --out <dir>          where cut-outs go (default: ./cutouts). Subfolders are kept.
  --bg <color>         fill the background: white, black or #rrggbb (default: transparent)
  --format <f>         png, jpg or webp (default: png, or jpg with --bg)
  --crop               crop to the subject with a little room, like the site
  --size <WxH>         put the subject in the middle of a WxH canvas, e.g. 2000x2000 (one number: square)
  --pad <n%>           room around the subject with --size, per side (default: 5%)
  --model <m>          birefnet (default, MIT) or isnet (AGPL, faster on the CPU)
  --engine <e>         auto (default), gpu or cpu
  --jobs <n>           photos in flight at once (default: 3)
  --force              redo photos that already have a cut-out
  --quiet              no progress line
  -h, --help           this help
  -v, --version        version

Reads JPG, PNG, WebP, AVIF, TIFF, GIF (first frame) and HEIC. Run the same command again to carry on
after a stop: finished photos are skipped.`;

const EXTS = new Set([".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif", ".heic", ".heif"]);
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };

function fail(msg) { console.error(`goodbye-bg: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const o = { inputs: [], out: "cutouts", bg: null, format: null, crop: false, size: null, pad: 0.05, model: "birefnet", engine: "auto", jobs: 3, force: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { const v = argv[++i]; if (v === undefined) fail(`${a} needs a value`); return v; };
    if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
    else if (a === "-v" || a === "--version") { console.log(VERSION); process.exit(0); }
    else if (a === "--out" || a === "-o") o.out = val();
    else if (a === "--bg") {
      const v = val().toLowerCase();
      if (v === "transparent" || v === "none") o.bg = null;
      else if (NAMED[v]) o.bg = NAMED[v];
      else if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) { let h = v.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); o.bg = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)); }
      else fail(`--bg takes white, black or #rrggbb, not "${v}"`);
    }
    else if (a === "--format") { o.format = val().toLowerCase().replace("jpeg", "jpg"); if (!["png", "jpg", "webp"].includes(o.format)) fail("--format takes png, jpg or webp"); }
    else if (a === "--crop") o.crop = true;
    else if (a === "--size") {
      const m = /^(\d+)(?:x(\d+))?$/i.exec(val()); if (!m) fail("--size takes WxH, e.g. 2000x2000");
      o.size = [+m[1], +(m[2] || m[1])]; if (o.size.some((n) => n < 1 || n > 16384)) fail("--size must be 1 to 16384 on each side");
    }
    else if (a === "--pad") { const v = parseFloat(val()); if (!(v >= 0 && v < 50)) fail("--pad takes 0% to 49%"); o.pad = v / 100; }
    else if (a === "--model") { o.model = val().toLowerCase(); if (!MODELS[o.model]) fail("--model takes birefnet or isnet"); }
    else if (a === "--engine") { o.engine = val().toLowerCase(); if (!["auto", "gpu", "cpu"].includes(o.engine)) fail("--engine takes auto, gpu or cpu"); }
    else if (a === "--jobs" || a === "-j") { o.jobs = parseInt(val(), 10); if (!(o.jobs >= 1 && o.jobs <= 32)) fail("--jobs takes 1 to 32"); }
    else if (a === "--force") o.force = true;
    else if (a === "--quiet" || a === "-q") o.quiet = true;
    else if (a.startsWith("-")) fail(`unknown option ${a} (see --help)`);
    else o.inputs.push(a);
  }
  if (!o.inputs.length) { console.log(HELP); process.exit(2); }
  o.format ||= o.bg ? "jpg" : "png";
  if (o.format === "jpg" && !o.bg) o.bg = NAMED.white; // JPEG has no transparency
  return o;
}

// Every picture under the inputs, in name order, with the folder it was found under (for the output's subfolders).
function collect(inputs, outAbs) {
  const found = [], seen = new Set();
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
  const walk = (dir, root) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.error(`goodbye-bg: can't read ${dir}: ${e.code || e.message}`); return; }
    ents.sort((a, b) => natural(a.name, b.name));
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { const st = fs.statSync(p); if (st.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) add(p, root); } catch {} continue; } // links to folders are not followed (no loops)
      if (e.isDirectory()) { if (path.resolve(p) !== outAbs) walk(p, root); }
      else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) add(p, root);
    }
  };
  const add = (p, root) => { const abs = path.resolve(p); if (!seen.has(abs)) { seen.add(abs); found.push({ src: abs, rel: path.relative(root, abs) }); } };
  for (const inp of inputs) {
    let st; try { st = fs.statSync(inp); } catch { fail(`can't find ${inp}`); }
    if (st.isDirectory()) walk(path.resolve(inp), path.resolve(inp));
    else add(inp, path.dirname(path.resolve(inp)));
  }
  return found;
}

// Output paths: same subfolders and name, the new extension. a.jpg and a.png in one folder would both be a.png, so
// the second keeps its old extension in the name (a-png.png).
function plan(files, outAbs, format) {
  const taken = new Set();
  for (const f of files) {
    const p = path.parse(f.rel);
    let dst = path.join(outAbs, p.dir, `${p.name}.${format}`);
    if (taken.has(dst.toLowerCase())) dst = path.join(outAbs, p.dir, `${p.name}-${p.ext.slice(1).toLowerCase()}.${format}`);
    taken.add(dst.toLowerCase());
    f.dst = dst;
  }
}

// Any cut-out (a file that isn't a dot-file) anywhere under dir.
const hasFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => !e.name.startsWith(".") && (e.isDirectory() ? hasFiles(path.join(dir, e.name)) : true));

const fmtTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const outAbs = path.resolve(o.out);
  const files = collect(o.inputs, outAbs);
  if (!files.length) fail("no photos found (JPG, PNG, WebP, AVIF, TIFF, GIF, HEIC)");
  plan(files, outAbs, o.format);

  // Resume: a finished cut-out (written whole, then renamed into place) newer than its photo is skipped. The settings
  // are kept next to the cut-outs, so a run with other settings doesn't silently mix two looks in one folder.
  const settings = { model: o.model, bg: o.bg, format: o.format, crop: o.crop, size: o.size, pad: o.size ? o.pad : null };
  const settingsFile = path.join(outAbs, ".goodbye-bg.json");
  fs.mkdirSync(outAbs, { recursive: true });
  if (!o.force && fs.existsSync(settingsFile)) {
    let old = {}; try { old = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {}
    const diff = Object.keys(settings).filter((k) => JSON.stringify(old[k] ?? null) !== JSON.stringify(settings[k] ?? null));
    if (diff.length && hasFiles(outAbs)) fail(`${o.out} has cut-outs made with other settings (${diff.join(", ")}). Add --force to redo them, or pick another --out.`);
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings) + "\n");
  const todo = o.force ? files : files.filter((f) => {
    try { const d = fs.statSync(f.dst); return !(d.size > 0 && d.mtimeMs >= fs.statSync(f.src).mtimeMs); } catch { return true; }
  });
  const skipped = files.length - todo.length;
  const say = (s) => { if (!o.quiet) process.stderr.write(process.stderr.isTTY ? `\r\x1b[K${s}` : s + "\n"); };
  if (!todo.length) { console.log(`All ${files.length} photos already have cut-outs in ${o.out}. Add --force to redo them.`); return; }

  // The engine: one ONNX Runtime session on the main thread, shared by the workers, one run at a time.
  const t0 = performance.now();
  const file = await modelPath(o.model, say);
  const ort = require("onnxruntime-node");
  const spec = MODELS[o.model];
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
        const probe = new Float32Array(3 * RES * RES); // warm-up: compiles the shaders and proves the GPU works
        for (let i = 0; i < probe.length; i++) probe[i] = ((i % RES) / RES - 0.5) * 0.9;
        await run(probe, true);
        err = null; break;
      } catch (e) { err = e; session = null; }
    }
    if (err) {
      if (o.engine === "gpu") fail(`the GPU engine failed to start: ${err.message}`);
      if (!o.quiet) process.stderr.write(`\nGPU not available (${String(err.message).split("\n")[0]}), using the CPU.\n`);
    }
  }
  if (!session) await open("cpu");
  const tReady = performance.now();
  if (engine === "cpu" && o.model === "birefnet" && !o.quiet)
    process.stderr.write(`\nNote: BiRefNet on the CPU is slow and needs a lot of memory. --model isnet is several times faster on the CPU.\n`);

  // One run at a time. A failed GPU run switches to the CPU for the rest (a broken GPU can return garbage).
  let chain = Promise.resolve(), inferMs = 0, runs = 0;
  const infer = (px) => (chain = chain.then(async () => {
    const input = toInput(px, spec);
    try { const r = await run(input); inferMs += r.ms; runs++; return r.mask; }
    catch (e) {
      if (engine !== "gpu" || o.engine === "gpu") throw e;
      if (!o.quiet) process.stderr.write(`\nGPU run failed (${String(e.message).split("\n")[0]}), switching to the CPU.\n`);
      await open("cpu");
      const r = await run(input); inferMs += r.ms; runs++; return r.mask;
    }
  }));

  const jobOpts = { harden: spec.harden, bg: o.bg, format: o.format, crop: o.crop, size: o.size, pad: o.pad };
  const queue = todo.slice(), inflight = new Map(), failed = [], empty = [];
  let done = 0, stopping = false, mp = 0;
  const tStart = performance.now();
  const progress = (name) => {
    const el = (performance.now() - tStart) / 1000, rate = done / el;
    const eta = rate > 0 ? fmtTime((todo.length - done - failed.length) / rate) : "?";
    say(`${String(done + failed.length).padStart(String(todo.length).length)}/${todo.length}  ${(rate * 60).toFixed(1)} a minute  ${eta} left  ${name || ""}`.slice(0, (process.stderr.columns || 120) - 1));
  };
  const workers = Array.from({ length: Math.min(o.jobs, todo.length) }, () => new Worker(path.join(__dirname, "../lib/worker.cjs")));
  await new Promise((resolveAll) => {
    let live = workers.length;
    const feed = (w) => {
      const f = !stopping && queue.shift();
      if (!f) { w.terminate(); if (--live === 0) resolveAll(); return; }
      fs.mkdirSync(path.dirname(f.dst), { recursive: true });
      const tmp = `${f.dst}.part-${process.pid}`;
      inflight.set(w, { f, tmp });
      w.postMessage({ type: "job", key: f.src, src: f.src, dst: f.dst, tmp, o: jobOpts });
    };
    for (const w of workers) {
      w.on("message", (m) => {
        if (m.type === "infer") {
          infer(m.px).then((mask) => w.postMessage({ type: "mask", id: m.id, mask }, [mask.buffer]), (e) => w.postMessage({ type: "maskerr", id: m.id, error: String(e?.message || e) }));
          return;
        }
        const { f } = inflight.get(w); inflight.delete(w);
        if (m.type === "done") { done++; mp += (m.W * m.H) / 1e6; if (m.empty) empty.push(f.rel); }
        else { failed.push({ rel: f.rel, error: m.error }); if (!o.quiet) process.stderr.write(`\n${f.rel}: ${m.error}\n`); }
        progress(f.rel);
        feed(w);
      });
      w.on("error", (e) => { const j = inflight.get(w); inflight.delete(w); if (j) { failed.push({ rel: j.f.rel, error: String(e.message) }); fs.rmSync(j.tmp, { force: true }); } if (--live === 0) resolveAll(); });
      feed(w);
    }
    process.once("SIGINT", () => {
      stopping = true;
      if (!o.quiet) process.stderr.write(`\nStopping after the photos in progress (Ctrl-C again to quit now)...\n`);
      process.once("SIGINT", () => { for (const { tmp } of inflight.values()) fs.rmSync(tmp, { force: true }); process.exit(130); });
    });
  });
  await session.release?.();

  const secs = (performance.now() - tStart) / 1000, total = (performance.now() - t0) / 1000;
  if (!o.quiet && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  const left = todo.length - done - failed.length;
  console.log(`${done} cut-out${done === 1 ? "" : "s"} in ${fmtTime(secs)} (${((done / secs) * 60).toFixed(1)} a minute, ${(mp / Math.max(1, done)).toFixed(1)} MP a photo), ${o.model} on the ${engine === "gpu" ? "GPU" : "CPU"}.`);
  console.log(`Model ready in ${((tReady - t0) / 1000).toFixed(1)} s; the model itself took ${runs ? Math.round(inferMs / runs) : 0} ms a photo. Total ${fmtTime(total)}.`);
  if (skipped) console.log(`${skipped} skipped: already done.`);
  if (empty.length) console.log(`${empty.length} with no subject found (saved empty): ${empty.slice(0, 5).join(", ")}${empty.length > 5 ? ", ..." : ""}`);
  if (failed.length) { console.log(`${failed.length} failed:`); for (const x of failed.slice(0, 20)) console.log(`  ${x.rel}: ${x.error}`); }
  if (left > 0) console.log(`${left} not started. Run the same command again to carry on.`);
  console.log(`Cut-outs are in ${outAbs}`);
  if (process.env.GOODBYE_BG_STATS) fs.writeFileSync(process.env.GOODBYE_BG_STATS, JSON.stringify({ done, failed: failed.length, skipped, secs, total, ready: (tReady - t0) / 1000, inferMs: runs ? inferMs / runs : 0, mp: mp / Math.max(1, done), engine, model: o.model, jobs: o.jobs }) + "\n");
  process.exitCode = stopping ? 130 : failed.length ? 1 : 0;
}

main().catch((e) => { console.error(`\ngoodbye-bg: ${e?.stack || e}`); process.exit(1); });
