#!/usr/bin/env node
// Builds goodbye-bg as one executable file for this computer's platform, with Node's single executable applications
// (node --build-sea, Node 25.5 or newer). Run from tools/bulk after `npm ci`:
//
//   node scripts/build-sea.mjs [--out <file>] [--node <official node binary>] [--open]
//
// --node: the Node binary the executable is made from (default: the one running this). It must be built with SEA
// support: nodejs.org's binaries are; Homebrew's node is not ("Single executable application is disabled").
//
// Default: the closed build. BiRefNet (MIT) only: every line marked "AGPL-only" (ISNet's download, its model settings,
// its --model choice) is left out, so the binary can neither run nor fetch ISNet. --open keeps ISNet (that build is
// AGPL, like the repo). The binary is about 170 MB (Node itself is 147 MB); it is not committed (docs/bulk-cli.md).
//
// The window (no arguments, or `app`) is included: lib/app.cjs and its page in lib/app/, checked below.
//
// How it works: bin/, lib/ and the runtime parts of node_modules for this platform go into one gzip asset inside a
// copy of this node. scripts/sea-main.cjs unpacks them on the first run to <cache>/runtime-<hash>/ and runs them from
// there, because native addons, their dylibs and worker threads have to be real files.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const open = args.includes("--open");
const plat = process.platform, arch = process.arch;
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const outArg = opt("--out");
const NODE = path.resolve(opt("--node") || process.execPath);
const out = path.resolve(outArg || path.join(ROOT, "dist-sea", `goodbye-bg-${plat}-${arch}${open ? "-agpl" : ""}${plat === "win32" ? ".exe" : ""}`));
const NM = path.join(ROOT, "node_modules");
const NODE_VERSION = execFileSync(NODE, ["--version"]).toString().trim();
if (!fs.existsSync(NM)) throw new Error("Run npm ci in tools/bulk first.");

// What the app needs at run time, nothing more: no install scripts, no TypeScript files, no source maps, no other
// platforms' binaries.
const files = []; // [relative path in the runtime, absolute source]
const skip = (f) => /\.(d\.ts|d\.cts|d\.mts|map|md|ts)$/.test(f) && !/LICENSE|README/i.test(path.basename(f));
function addTree(rel, filter = () => true) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel}`);
  if (fs.statSync(abs).isFile()) { files.push([rel, abs]); return; }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) addTree(r, filter);
    else if (e.isFile() && !skip(r) && filter(r)) files.push([r, path.join(abs, e.name)]);
  }
}
addTree("bin"); addTree("lib"); addTree("package.json");
const ortBin = path.join("node_modules/onnxruntime-node/bin/napi-v6", plat, arch);
addTree("node_modules/onnxruntime-node/package.json");
addTree("node_modules/onnxruntime-node/dist", (r) => r.endsWith(".js"));
// The binding links libonnxruntime.1.dylib (@rpath = its own folder); the versioned copy next to it is a 45 MB duplicate.
addTree(ortBin, (r) => !/libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(r));
addTree("node_modules/onnxruntime-common/package.json");
addTree("node_modules/onnxruntime-common/dist/cjs");
for (const p of ["sharp", "@img/colour", "detect-libc", "semver", `@img/sharp-${plat}-${arch}`, `@img/sharp-libvips-${plat}-${arch}`])
  addTree(path.join("node_modules", p), (r) => !/\/(src|install)\//.test(r));
addTree("node_modules/libheif-js", (r) => !/\/libheif\//.test(r) && !/(^|\/)(index|wasm)\.js$/.test(r)); // wasm-bundle.js only
addTree("node_modules/fflate", (r) => /package\.json$|LICENSE|\/lib\/.*\.cjs$/.test(r));

// The window (goodbye-bg with no arguments, lib/app.cjs) serves these from the unpacked runtime.
for (const f of ["lib/app.cjs", "lib/app/index.html", "lib/app/app.css", "lib/app/app.js"]) if (!files.some(([rel]) => rel === f)) throw new Error(`the window's ${f} is missing from the build`);

// Closed build: drop every line marked AGPL-only, then check nothing that names ISNet's model is left. The window's
// page files have no AGPL-only lines; they must not name ISNet at all.
const ISNET = ["m/isnet", "b6e8497b", "isnet:", '"isnet"', "--model isnet"];
const strip = (rel, buf) => {
  if (open || !/^(bin|lib)\//.test(rel)) return buf;
  if (/^lib\/app\//.test(rel)) { const s = buf.toString("utf8").toLowerCase(); if (s.includes("isnet")) throw new Error(`${rel} names ISNet; the page must get the model list from the server`); return buf; }
  if (!rel.endsWith(".cjs")) return buf;
  const s = buf.toString("utf8").split("\n").filter((l) => !l.includes("// AGPL-only")).join("\n");
  for (const bad of ISNET) if (s.includes(bad)) throw new Error(`${rel} still names ISNet (${bad}); mark the line AGPL-only`);
  return Buffer.from(s);
};

// Licences of everything inside (sharp's libvips and libheif are LGPL-3.0: they stay separate, replaceable files in
// the unpacked runtime; their source is linked below).
const lic = [];
const addLic = (name, rel) => { const abs = path.join(ROOT, rel); if (fs.existsSync(abs)) lic.push([`LICENSES/${name}`, fs.readFileSync(abs)]); else throw new Error(`no licence file ${rel}`); };
addLic("sharp.txt", "node_modules/sharp/LICENSE");
addLic(`libvips-${plat}-${arch}.txt`, `node_modules/@img/sharp-libvips-${plat}-${arch}/README.md`);
addLic(`sharp-${plat}-${arch}.txt`, `node_modules/@img/sharp-${plat}-${arch}/LICENSE`);
addLic("libheif-js.txt", "node_modules/libheif-js/LICENSE");
addLic("libheif.txt", "node_modules/libheif-js/libheif-wasm/LICENSE");
addLic("fflate.txt", "node_modules/fflate/LICENSE");
addLic("colour.txt", "node_modules/@img/colour/LICENSE.md");
addLic("detect-libc.txt", "node_modules/detect-libc/LICENSE");
addLic("semver.txt", "node_modules/semver/LICENSE");
const nodeLicence = [path.join(path.dirname(NODE), "..", "LICENSE"), path.join(path.dirname(NODE), "..", "share/doc/node/LICENSE")].find((f) => fs.existsSync(f));
if (nodeLicence) lic.push(["LICENSES/node.txt", fs.readFileSync(nodeLicence)]);
else console.warn("warning: Node's LICENSE not found next to this node; add it before shipping");
lic.push(["LICENSES/README.txt", Buffer.from(`goodbye-bg ${open ? "(AGPL build, with ISNet)" : "(BiRefNet-only build)"}: parts and their licences.

- BiRefNet lite model (downloaded on first use, not inside this file): MIT, https://github.com/ZhengPeng7/BiRefNet
${open ? "- ISNet medium model (downloaded with --model isnet): AGPL-3.0, IMG.LY, https://github.com/imgly/background-removal-js\n" : ""}- ONNX Runtime ${JSON.parse(fs.readFileSync(path.join(NM, "onnxruntime-node/package.json"))).version} (onnxruntime-node, onnxruntime-common): MIT, Microsoft, https://github.com/microsoft/onnxruntime
- Node.js ${NODE_VERSION} (the runtime this file is built on): MIT and others, see node.txt
- sharp: Apache-2.0, see sharp.txt
- libvips and the libraries it is built with (@img/sharp-libvips-${plat}-${arch}): LGPL-3.0 and others, see libvips-${plat}-${arch}.txt.
  Source: https://github.com/lovell/sharp-libvips. It is a separate file in the unpacked runtime folder and can be replaced.
- libheif-js (libheif with libde265, as WebAssembly): LGPL-3.0, see libheif-js.txt and libheif.txt.
  Source: https://github.com/catdad-experiments/libheif-js. A separate file in the unpacked runtime folder.
- fflate, @img/colour, detect-libc, semver: MIT / ISC, see their files.
`)]);

// One blob: the files back to back, gzipped. build.json lists names, sizes and modes; the hash names the runtime folder.
const parts = [], list = [];
for (const [rel, abs] of files.sort((a, b) => a[0].localeCompare(b[0]))) {
  const b = strip(rel, fs.readFileSync(abs));
  parts.push(b); list.push([rel, b.length, fs.statSync(abs).mode & 0o777]);
}
for (const [rel, b] of lic) { parts.push(b); list.push([rel, b.length, 0o644]); }
const blob = Buffer.concat(parts);
const hash = crypto.createHash("sha256").update(blob).update(JSON.stringify(list)).digest("hex").slice(0, 12);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version;
const work = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "goodbye-bg-sea-"));
fs.writeFileSync(path.join(work, "app.gz"), zlib.gzipSync(blob, { level: 9 }));
fs.writeFileSync(path.join(work, "build.json"), JSON.stringify({ hash, version, open, files: list }));
fs.writeFileSync(path.join(work, "sea.json"), JSON.stringify({
  main: path.join(ROOT, "scripts/sea-main.cjs"),
  output: out,
  disableExperimentalSEAWarning: true,
  assets: { "app.gz": path.join(work, "app.gz"), "build.json": path.join(work, "build.json") },
}));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync(NODE, ["--build-sea", path.join(work, "sea.json")], { stdio: "inherit" });
// macOS on Apple silicon refuses to run a Mach-O whose signature no longer matches: sign it again, ad hoc (no identity,
// no Apple account). A Developer ID signature with notarization is what a real release needs.
if (plat === "darwin") execFileSync("codesign", ["--sign", "-", "--force", out], { stdio: "inherit" });
fs.rmSync(work, { recursive: true, force: true });
const mb = (n) => (n / 1e6).toFixed(1) + " MB";
console.log(`${out}\n  ${mb(fs.statSync(out).size)} (${list.length} files, ${mb(blob.length)} unpacked), runtime ${hash}, ${open ? "AGPL build with ISNet" : "BiRefNet-only build"}`);
