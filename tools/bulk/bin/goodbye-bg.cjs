#!/usr/bin/env node
// goodbye-bg: cut out every photo in a folder on this computer. Nothing is uploaded; the only network use is the
// one-time model download from the goodbye.bg site.
"use strict";
const fs = require("fs"), path = require("path");
const { MODELS } = require("../lib/pipeline.cjs");
const B = require("../lib/batch.cjs");
const { startEngine } = require("../lib/engine.cjs");
const VERSION = require("../package.json").version;
let MODEL_HELP = "birefnet (the only model in this build)";
if (MODELS.isnet) MODEL_HELP = "birefnet (default, MIT) or isnet (AGPL, faster on the CPU)"; // AGPL-only

const HELP = `goodbye-bg ${VERSION}: remove backgrounds from photos on this computer. Nothing is uploaded.

Usage: goodbye-bg <photos or folders...> [options]
       goodbye-bg                       the same in a window, in your browser (also: goodbye-bg app; see --help there)
       goodbye-bg serve [--port 5000]   remove.bg's API on this computer (see goodbye-bg serve --help)

  --out <dir>          where cut-outs go (default: ./cutouts). Subfolders are kept.
  --bg <color>         fill the background: white, black or #rrggbb (default: transparent)
  --format <f>         png, jpg or webp (default: png, or jpg with --bg)
  --crop               crop to the subject with a little room, like the site
  --size <WxH>         put the subject in the middle of a WxH canvas, e.g. 2000x2000 (one number: square)
  --pad <n%>           room around the subject with --size, per side (default: 5%)
  --model <m>          ${MODEL_HELP}
  --engine <e>         auto (default), gpu or cpu
  --jobs <n>           photos in flight at once (default: 3)
  --force              redo photos that already have a cut-out
  --quiet              no progress line
  -h, --help           this help
  -v, --version        version

Reads JPG, PNG, WebP, AVIF, TIFF, GIF (first frame) and HEIC. Run the same command again to carry on
after a stop: finished photos are skipped.`;

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
    else if (a === "--model") { o.model = val().toLowerCase(); if (!MODELS[o.model]) fail(`--model takes ${Object.keys(MODELS).join(" or ")}`); }
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

const fmtTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const outAbs = path.resolve(o.out);
  let files;
  try { files = B.collect(o.inputs, outAbs, (w) => console.error(`goodbye-bg: ${w}`)); } catch (e) { if (e.fatal) fail(e.message); throw e; }
  if (!files.length) fail("no photos found (JPG, PNG, WebP, AVIF, TIFF, GIF, HEIC)");
  B.plan(files, outAbs, o.format);

  // Resume: a finished cut-out (written whole, then renamed into place) newer than its photo is skipped. The settings
  // are kept next to the cut-outs, so a run with other settings doesn't silently mix two looks in one folder.
  const settings = B.settingsOf(o);
  fs.mkdirSync(outAbs, { recursive: true });
  const diff = o.force ? [] : B.settingsClash(outAbs, settings);
  if (diff.length) fail(`${o.out} has cut-outs made with other settings (${diff.join(", ")}). Add --force to redo them, or pick another --out.`);
  B.writeSettings(outAbs, settings);
  const todo = o.force ? files : B.notDone(files);
  const skipped = files.length - todo.length;
  const say = (s) => { if (!o.quiet) process.stderr.write(process.stderr.isTTY ? `\r\x1b[K${s}` : s + "\n"); };
  if (!todo.length) { console.log(`All ${files.length} photos already have cut-outs in ${o.out}. Add --force to redo them.`); return; }

  // The engine: one ONNX Runtime session on the main thread, shared by the workers, one run at a time.
  const t0 = performance.now();
  let eng;
  try { eng = await startEngine(o, say); } catch (e) { if (e.fatal) fail(e.message); throw e; }
  const spec = eng.spec, tReady = performance.now();

  const jobOpts = { harden: spec.harden, bg: o.bg, format: o.format, crop: o.crop, size: o.size, pad: o.pad };
  const queue = todo.slice(), failed = [], empty = [];
  let done = 0, stopping = false, mp = 0;
  const tStart = performance.now();
  const progress = (name) => {
    const el = (performance.now() - tStart) / 1000, rate = done / el;
    const eta = rate > 0 ? fmtTime((todo.length - done - failed.length) / rate) : "?";
    say(`${String(done + failed.length).padStart(String(todo.length).length)}/${todo.length}  ${(rate * 60).toFixed(1)} a minute  ${eta} left  ${name || ""}`.slice(0, (process.stderr.columns || 120) - 1));
  };
  const batch = B.runBatch({
    eng, jobOpts, jobs: o.jobs, total: todo.length, next: () => queue.shift() || null, isStopping: () => stopping,
    onDone: (f, m) => { done++; mp += (m.W * m.H) / 1e6; if (m.empty) empty.push(f.rel); progress(f.rel); },
    onFail: (f, error) => { failed.push({ rel: f.rel, error }); if (!o.quiet) process.stderr.write(`\n${f.rel}: ${error}\n`); progress(f.rel); },
  });
  process.once("SIGINT", () => {
    stopping = true;
    if (!o.quiet) process.stderr.write(`\nStopping after the photos in progress (Ctrl-C again to quit now)...\n`);
    process.once("SIGINT", () => { for (const { tmp } of batch.inflight.values()) fs.rmSync(tmp, { force: true }); process.exit(130); });
  });
  await batch.done;
  await eng.release();

  const secs = (performance.now() - tStart) / 1000, total = (performance.now() - t0) / 1000;
  if (!o.quiet && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  const left = todo.length - done - failed.length;
  console.log(`${done} cut-out${done === 1 ? "" : "s"} in ${fmtTime(secs)} (${((done / secs) * 60).toFixed(1)} a minute, ${(mp / Math.max(1, done)).toFixed(1)} MP a photo), ${o.model} on the ${eng.engine === "gpu" ? "GPU" : "CPU"}.`);
  console.log(`Model ready in ${((tReady - t0) / 1000).toFixed(1)} s; the model itself took ${eng.stats.runs ? Math.round(eng.stats.inferMs / eng.stats.runs) : 0} ms a photo. Total ${fmtTime(total)}.`);
  if (skipped) console.log(`${skipped} skipped: already done.`);
  if (empty.length) console.log(`${empty.length} with no subject found (saved empty): ${empty.slice(0, 5).join(", ")}${empty.length > 5 ? ", ..." : ""}`);
  if (failed.length) { console.log(`${failed.length} failed:`); for (const x of failed.slice(0, 20)) console.log(`  ${x.rel}: ${x.error}`); }
  if (left > 0) console.log(`${left} not started. Run the same command again to carry on.`);
  console.log(`Cut-outs are in ${outAbs}`);
  if (process.env.GOODBYE_BG_STATS) fs.writeFileSync(process.env.GOODBYE_BG_STATS, JSON.stringify({ done, failed: failed.length, skipped, secs, total, ready: (tReady - t0) / 1000, inferMs: eng.stats.runs ? eng.stats.inferMs / eng.stats.runs : 0, mp: mp / Math.max(1, done), engine: eng.engine, model: o.model, jobs: o.jobs }) + "\n");
  process.exitCode = stopping ? 130 : failed.length ? 1 : 0;
}

// No arguments at all (a double-click in Finder runs it that way too) or "app": the window.
const cmd = process.argv[2];
const run = cmd === "serve" ? () => require("../lib/serve.cjs").serve(process.argv.slice(3))
  : cmd === undefined || cmd === "app" ? () => require("../lib/app.cjs").app(process.argv.slice(3))
  : main;
run().catch((e) => { console.error(`\ngoodbye-bg: ${e?.stack || e}`); process.exit(1); });
