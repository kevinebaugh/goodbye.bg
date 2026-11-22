// The single-file build's launcher (Node single executable application). The binary carries the app and its native
// libraries as one compressed asset. The first run unpacks it, once per build, into the cache folder
// (runtime-<hash>/, next to the model). Then it runs the unpacked bin/goodbye-bg.cjs, so worker threads, onnxruntime-node
// (WebGPU) and sharp load from real files as they do from a checkout. The LGPL libraries (libvips, libheif) stay
// separate files there that a user can replace. Built by scripts/build-sea.mjs.
"use strict";
const sea = require("node:sea"), fs = require("fs"), path = require("path"), os = require("os"), zlib = require("zlib");
const { createRequire } = require("module");

function cacheDir() {
  if (process.env.GOODBYE_BG_CACHE) return process.env.GOODBYE_BG_CACHE;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "goodbye-bg");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "goodbye-bg", "Cache");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "goodbye-bg");
}

const info = JSON.parse(sea.getAsset("build.json", "utf8")); // { hash, version, files: [[path, size, mode], ...] }
const dir = path.join(cacheDir(), `runtime-${info.hash}`);

if (!fs.existsSync(path.join(dir, ".complete"))) {
  // Unpack into a temporary folder and rename it into place, so two first runs at once can't see half a runtime.
  const t0 = performance.now();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const tmp = `${dir}.${process.pid}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  const blob = zlib.gunzipSync(Buffer.from(sea.getRawAsset("app.gz")));
  let at = 0;
  for (const [rel, size, mode] of info.files) {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, blob.subarray(at, at + size), { mode });
    at += size;
  }
  fs.writeFileSync(path.join(tmp, ".complete"), info.hash + "\n");
  try { fs.renameSync(tmp, dir); }
  catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); if (!fs.existsSync(path.join(dir, ".complete"))) throw e; } // another run won
  if (process.env.GOODBYE_BG_STATS) process.stderr.write(`Unpacked the runtime in ${((performance.now() - t0) / 1000).toFixed(1)} s to ${dir}\n`);
}

if (process.argv[2] === "--licenses") {
  const ld = path.join(dir, "LICENSES");
  for (const f of fs.readdirSync(ld).sort()) process.stdout.write(`==== ${f} ====\n\n${fs.readFileSync(path.join(ld, f), "utf8")}\n\n`);
  process.stdout.write(`These files are also in ${ld}\n`);
  process.exit(0);
}

const entry = path.join(dir, "bin", "goodbye-bg.cjs");
createRequire(entry)(entry);
