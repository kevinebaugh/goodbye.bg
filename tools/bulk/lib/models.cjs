// Model files: the same two the site serves, fetched once from the site and kept in the user's cache directory.
// Each is checked against a pinned sha256, so a cached or downloaded file is exactly the one the site runs.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const SITE = process.env.GOODBYE_BG_SITE || "https://goodbye-bg-git.pages.dev";
const FILES = {
  birefnet: { dir: "m/birefnet-f71d1be4/", size: 93296664, sha256: "f71d1be4b31c1add65843f0bb2076f0752c1450a8c59e2fb5d12a0ae1227aac9", licence: "MIT" },
  isnet: { dir: "m/isnet/", size: 88188479, sha256: "b6e8497ba978a6f5fbb647e419d2696cd80df5a23cb6a8ea532021911bd76acb", licence: "AGPL-3.0" }, // AGPL-only
};

function cacheDir() {
  if (process.env.GOODBYE_BG_CACHE) return process.env.GOODBYE_BG_CACHE;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "goodbye-bg");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "goodbye-bg", "Cache");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "goodbye-bg");
}

const sha = (file) => new Promise((res, rej) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
});

async function fetchRetry(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Returns the path of a verified model file, downloading it first if needed. `say` gets progress text.
async function modelPath(name, say = () => {}) {
  const spec = FILES[name];
  if (!spec) throw new Error(`Unknown model "${name}"`);
  const dir = cacheDir(), file = path.join(dir, `${name}-${spec.sha256.slice(0, 8)}.onnx`);
  if (fs.existsSync(file) && fs.statSync(file).size === spec.size) return file; // verified when it was written
  fs.mkdirSync(dir, { recursive: true });
  const base = SITE + "/" + spec.dir, manifest = JSON.parse((await fetchRetry(base + "manifest.json")).toString());
  const tmp = `${file}.${process.pid}.part`, out = fs.openSync(tmp, "w"), h = crypto.createHash("sha256");
  let got = 0;
  try {
    for (const p of manifest.parts) {
      const b = await fetchRetry(base + p);
      fs.writeSync(out, b); h.update(b); got += b.length;
      say(`Downloading ${name} model (once): ${Math.round((got / spec.size) * 100)}%`);
    }
  } finally { fs.closeSync(out); }
  const digest = h.digest("hex");
  if (digest !== spec.sha256) { fs.rmSync(tmp, { force: true }); throw new Error(`The ${name} model from ${SITE} does not match its checksum (${digest.slice(0, 12)}).`); }
  fs.renameSync(tmp, file);
  return file;
}

module.exports = { modelPath, cacheDir, FILES, sha };
