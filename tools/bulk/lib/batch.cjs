// The folder mode's pieces, shared by the command line (bin/goodbye-bg.cjs) and the window (lib/app.cjs): finding the
// photos, naming the cut-outs, the settings kept next to them, resume, and the pool of workers around the engine.
"use strict";
const fs = require("fs"), path = require("path");
const { Worker } = require("worker_threads");

const EXTS = new Set([".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif", ".heic", ".heif"]);
const isPhoto = (name) => EXTS.has(path.extname(name).toLowerCase());
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

// Every picture under the inputs, in name order, with the folder it was found under (for the output's subfolders).
// warn(text): a folder that can't be read. Throws (with .fatal) for an input that doesn't exist.
function collect(inputs, outAbs, warn = () => {}) {
  const found = [], seen = new Set();
  const walk = (dir, root) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { warn(`can't read ${dir}: ${e.code || e.message}`); return; }
    ents.sort((a, b) => natural(a.name, b.name));
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { const st = fs.statSync(p); if (st.isFile() && isPhoto(e.name)) add(p, root); } catch {} continue; } // links to folders are not followed (no loops)
      if (e.isDirectory()) { if (path.resolve(p) !== outAbs) walk(p, root); }
      else if (e.isFile() && isPhoto(e.name)) add(p, root);
    }
  };
  const add = (p, root) => { const abs = path.resolve(p); if (!seen.has(abs)) { seen.add(abs); found.push({ src: abs, rel: path.relative(root, abs) }); } };
  for (const inp of inputs) {
    let st; try { st = fs.statSync(inp); } catch { throw Object.assign(new Error(`can't find ${inp}`), { fatal: true }); }
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

// The look of a run, kept in <out>/.goodbye-bg.json so one folder doesn't mix two looks by accident.
const settingsOf = (o) => ({ model: o.model, bg: o.bg, format: o.format, crop: o.crop, size: o.size, pad: o.size ? o.pad : null });
const SETTINGS = ".goodbye-bg.json";
// The settings that differ from the cut-outs already in outAbs ([] if none, or if there are no cut-outs yet).
function settingsClash(outAbs, settings) {
  const file = path.join(outAbs, SETTINGS);
  if (!fs.existsSync(file)) return [];
  let old = {}; try { old = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const diff = Object.keys(settings).filter((k) => JSON.stringify(old[k] ?? null) !== JSON.stringify(settings[k] ?? null));
  return diff.length && hasFiles(outAbs) ? diff : [];
}
const writeSettings = (outAbs, settings) => { fs.mkdirSync(outAbs, { recursive: true }); fs.writeFileSync(path.join(outAbs, SETTINGS), JSON.stringify(settings) + "\n"); };

// Resume: a finished cut-out (written whole, then renamed into place) newer than its photo is skipped.
const notDone = (files) => files.filter((f) => {
  try { const d = fs.statSync(f.dst); return !(d.size > 0 && d.mtimeMs >= fs.statSync(f.src).mtimeMs); } catch { return true; }
});

// The workers around the engine. next() gives the next photo ({ src, dst, rel }), or null when there are no more; it
// may return a promise (the window waits for uploads). A photo with .error set is reported as failed without a run.
// Returns { done: Promise, inflight: Map(worker -> { f, tmp }) }.
function runBatch({ eng, jobOpts, jobs, total, next, onDone, onFail, isStopping = () => false }) {
  const inflight = new Map();
  const done = new Promise((resolveAll) => {
    const workers = Array.from({ length: Math.max(0, Math.min(jobs, total)) }, () => new Worker(path.join(__dirname, "worker.cjs")));
    let live = workers.length;
    if (!live) return resolveAll();
    const end = (w) => { w.terminate(); if (--live === 0) resolveAll(); };
    const feed = async (w) => {
      let f = null;
      while (!isStopping()) {
        f = await next();
        if (!f || !f.error) break;
        onFail(f, f.error); f = null;
      }
      if (!f || isStopping()) return end(w);
      fs.mkdirSync(path.dirname(f.dst), { recursive: true });
      const tmp = `${f.dst}.part-${process.pid}`;
      inflight.set(w, { f, tmp });
      w.postMessage({ type: "job", key: f.src, src: f.src, dst: f.dst, tmp, o: jobOpts });
    };
    for (const w of workers) {
      w.on("message", (m) => {
        if (m.type === "infer") {
          eng.infer(m.px).then((mask) => w.postMessage({ type: "mask", id: m.id, mask }, [mask.buffer]), (e) => w.postMessage({ type: "maskerr", id: m.id, error: String(e?.message || e) }));
          return;
        }
        const { f } = inflight.get(w); inflight.delete(w);
        if (m.type === "done") onDone(f, m); else onFail(f, m.error);
        feed(w);
      });
      w.on("error", (e) => { const j = inflight.get(w); inflight.delete(w); if (j) { onFail(j.f, String(e.message)); fs.rmSync(j.tmp, { force: true }); } if (--live === 0) resolveAll(); });
      feed(w);
    }
  });
  return { done, inflight };
}

module.exports = { EXTS, isPhoto, natural, collect, plan, hasFiles, settingsOf, settingsClash, writeSettings, notDone, runBatch };
