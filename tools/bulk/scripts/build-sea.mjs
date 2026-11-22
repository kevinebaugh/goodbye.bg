#!/usr/bin/env node
// Builds goodbye-bg as one executable file for this computer's platform, with Node's single executable applications
// (node --build-sea, Node 25.5 or newer). Run from tools/bulk after `npm ci`:
//
//   node scripts/build-sea.mjs [--out <file>] [--node <official node binary>] [--open]
//                              [--target win32-x64|linux-x64|darwin-arm64|...] [--executable <that platform's node>]
//
// --node: the Node binary that builds it (default: the one running this). It must be built with SEA support:
// nodejs.org's binaries are; Homebrew's node is not ("Single executable application is disabled").
// --target: another platform (default: this one). The executable is then that platform's official Node of the same
// version, downloaded from nodejs.org and checked against its SHASUMS256.txt (or --executable). sharp's binaries for it
// come from npm (npm pack), checked against the integrity in package-lock.json; onnxruntime-node already ships every
// platform's. Both are cached in dist-sea/.cache. Checked from a Mac: win32-x64 (PE) and linux-x64 (ELF, runs in Docker).
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
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const [plat, arch] = (opt("--target") || `${process.platform}-${process.arch}`).split("-");
const cross = plat !== process.platform || arch !== process.arch;
const outArg = opt("--out");
const NODE = path.resolve(opt("--node") || process.execPath);
const out = path.resolve(outArg || path.join(ROOT, "dist-sea", `goodbye-bg-${plat}-${arch}${open ? "-agpl" : ""}${plat === "win32" ? ".exe" : ""}`));
const NM = path.join(ROOT, "node_modules");
const NODE_VERSION = execFileSync(NODE, ["--version"]).toString().trim(); // the builder's; the target's Node is the same version
if (!fs.existsSync(NM)) throw new Error("Run npm ci in tools/bulk first.");
const CACHE = path.join(ROOT, "dist-sea", ".cache");

// Another platform: its Node from nodejs.org (same version as the builder, sha256 from SHASUMS256.txt), unpacked.
async function targetNode() {
  if (opt("--executable")) return { exe: path.resolve(opt("--executable")), licence: null };
  const os = { win32: "win", linux: "linux", darwin: "darwin" }[plat];
  if (!os) throw new Error(`no Node download for ${plat}`);
  const name = `node-${NODE_VERSION}-${os}-${arch}`, file = `${name}.${plat === "win32" ? "zip" : "tar.xz"}`;
  const dir = path.join(CACHE, name), exe = path.join(dir, plat === "win32" ? "node.exe" : "bin/node");
  if (!fs.existsSync(exe)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const base = `https://nodejs.org/dist/${NODE_VERSION}/`;
    const sums = await (await fetch(base + "SHASUMS256.txt")).text();
    const want = sums.split("\n").find((l) => l.endsWith(`  ${file}`))?.split(" ")[0];
    if (!want) throw new Error(`${file} is not in ${base}SHASUMS256.txt`);
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(`${base}${file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash("sha256").update(buf).digest("hex") !== want) throw new Error(`${file}: sha256 does not match SHASUMS256.txt`);
    const arc = path.join(CACHE, file);
    fs.writeFileSync(arc, buf);
    if (plat === "win32") execFileSync("unzip", ["-q", "-o", arc, "-d", CACHE]);
    else execFileSync("tar", ["-xJf", arc, "-C", CACHE]);
    fs.rmSync(arc);
    console.log(`Node ${NODE_VERSION} for ${plat}-${arch}: ${file}, sha256 checked`);
  }
  return { exe, licence: path.join(dir, "LICENSE") };
}

// Another platform's sharp packages: npm pack, integrity checked against package-lock.json, unpacked into a
// node_modules folder. Returns the folder that holds that node_modules (this checkout for this platform).
function platformModules(names) {
  if (!cross) return ROOT;
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"))).packages;
  const nm = path.join(CACHE, `${plat}-${arch}`, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  for (const name of names) {
    const dst = path.join(nm, name);
    if (fs.existsSync(path.join(dst, "package.json"))) continue;
    const entry = lock[`node_modules/${name}`];
    if (!entry?.integrity) throw new Error(`${name} is not in package-lock.json`);
    const tmp = fs.mkdtempSync(path.join(CACHE, "pack-"));
    const [info] = JSON.parse(execFileSync("npm", ["pack", "--silent", "--json", `${name}@${entry.version}`], { cwd: tmp }).toString());
    const tgz = path.join(tmp, info.filename);
    const sri = "sha512-" + crypto.createHash("sha512").update(fs.readFileSync(tgz)).digest("base64");
    if (sri !== entry.integrity) throw new Error(`${name}@${entry.version}: integrity does not match package-lock.json`);
    fs.mkdirSync(dst, { recursive: true });
    execFileSync("tar", ["-xzf", tgz, "-C", dst, "--strip-components", "1"]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`${name}@${entry.version} for ${plat}-${arch}: integrity checked`);
  }
  return path.dirname(nm);
}

// What the app needs at run time, nothing more: no install scripts, no TypeScript files, no source maps, no other
// platforms' binaries.
const files = []; // [relative path in the runtime, absolute source]
const skip = (f) => /\.(d\.ts|d\.cts|d\.mts|map|md|ts)$/.test(f) && !/LICENSE|README/i.test(path.basename(f));
function addTree(rel, filter = () => true, root = ROOT) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel}`);
  if (fs.statSync(abs).isFile()) { files.push([rel, abs]); return; }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) addTree(r, filter, root);
    else if (e.isFile() && !skip(r) && filter(r)) files.push([r, path.join(abs, e.name)]);
  }
}
addTree("bin"); addTree("lib"); addTree("package.json");
const ortBin = path.join("node_modules/onnxruntime-node/bin/napi-v6", plat, arch);
addTree("node_modules/onnxruntime-node/package.json");
addTree("node_modules/onnxruntime-node/dist", (r) => r.endsWith(".js"));
// The binding links libonnxruntime.1.dylib (@rpath = its own folder); the versioned copy next to it is a 45 MB duplicate.
// Windows: onnxruntime.dll, DirectML.dll and dxcompiler.dll (WebGPU's shader compiler) next to the binding.
addTree(ortBin, (r) => !/libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(r));
addTree("node_modules/onnxruntime-common/package.json");
addTree("node_modules/onnxruntime-common/dist/cjs");
// sharp's binary for the target, and libvips (on Windows the libvips DLLs are inside @img/sharp-win32-x64).
const sharpPkgs = [`@img/sharp-${plat}-${arch}`].concat(plat === "win32" ? [] : [`@img/sharp-libvips-${plat}-${arch}`]);
const PROOT = platformModules(sharpPkgs);
for (const p of ["sharp", "@img/colour", "detect-libc", "semver"]) addTree(path.join("node_modules", p), (r) => !/\/(src|install)\//.test(r));
for (const p of sharpPkgs) addTree(path.join("node_modules", p), (r) => !/\/(src|install)\//.test(r), PROOT);

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
const addLic = (name, rel, root = ROOT) => { const abs = path.join(root, rel); if (fs.existsSync(abs)) lic.push([`LICENSES/${name}`, fs.readFileSync(abs)]); else throw new Error(`no licence file ${rel}`); };
addLic("sharp.txt", "node_modules/sharp/LICENSE");
// libvips's licence list is in its package's README (on Windows, in @img/sharp-win32-x64's, which carries the DLLs).
addLic(`libvips-${plat}-${arch}.txt`, `node_modules/${sharpPkgs.at(-1)}/README.md`, PROOT);
addLic(`sharp-${plat}-${arch}.txt`, `node_modules/@img/sharp-${plat}-${arch}/LICENSE`, PROOT);
addLic("libheif-js.txt", "node_modules/libheif-js/LICENSE");
addLic("libheif.txt", "node_modules/libheif-js/libheif-wasm/LICENSE");
addLic("fflate.txt", "node_modules/fflate/LICENSE");
addLic("colour.txt", "node_modules/@img/colour/LICENSE.md");
addLic("detect-libc.txt", "node_modules/detect-libc/LICENSE");
addLic("semver.txt", "node_modules/semver/LICENSE");
const target = cross ? await targetNode() : { exe: NODE, licence: null };
const nodeLicence = [target.licence, path.join(path.dirname(NODE), "..", "LICENSE"), path.join(path.dirname(NODE), "..", "share/doc/node/LICENSE")].find((f) => f && fs.existsSync(f));
if (nodeLicence) lic.push(["LICENSES/node.txt", fs.readFileSync(nodeLicence)]);
else console.warn("warning: Node's LICENSE not found next to this node; add it before shipping");
lic.push(["LICENSES/README.txt", Buffer.from(`goodbye-bg ${open ? "(AGPL build, with ISNet)" : "(BiRefNet-only build)"}: parts and their licences.

- BiRefNet lite model (downloaded on first use, not inside this file): MIT, https://github.com/ZhengPeng7/BiRefNet
${open ? "- ISNet medium model (downloaded with --model isnet): AGPL-3.0, IMG.LY, https://github.com/imgly/background-removal-js\n" : ""}- ONNX Runtime ${JSON.parse(fs.readFileSync(path.join(NM, "onnxruntime-node/package.json"))).version} (onnxruntime-node, onnxruntime-common): MIT, Microsoft, https://github.com/microsoft/onnxruntime
- Node.js ${NODE_VERSION} (the runtime this file is built on): MIT and others, see node.txt
- sharp: Apache-2.0, see sharp.txt
${plat === "win32" ? "- DirectML.dll (Microsoft DirectML redistributable) and dxcompiler.dll (DirectX Shader Compiler), shipped inside onnxruntime-node for\n  Windows: Microsoft's own licences, https://www.nuget.org/packages/Microsoft.AI.DirectML (licence link there) and\n  https://github.com/microsoft/DirectXShaderCompiler (LICENSE.TXT). Their texts are not in the npm package; add them before shipping.\n" : ""}- libvips and the libraries it is built with (${sharpPkgs.at(-1)}): LGPL-3.0 and others, see libvips-${plat}-${arch}.txt.
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
  ...(cross ? { executable: target.exe } : {}), // node --build-sea injects into another platform's Node (PE, ELF) too
  disableExperimentalSEAWarning: true,
  assets: { "app.gz": path.join(work, "app.gz"), "build.json": path.join(work, "build.json") },
}));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync(NODE, ["--build-sea", path.join(work, "sea.json")], { stdio: "inherit" });
// macOS on Apple silicon refuses to run a Mach-O whose signature no longer matches: sign it again, ad hoc (no identity,
// no Apple account). A Developer ID signature with notarization is what a real release needs.
if (plat === "darwin" && process.platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", out], { stdio: "inherit" });
fs.rmSync(work, { recursive: true, force: true });
const mb = (n) => (n / 1e6).toFixed(1) + " MB";
console.log(`${out} (${plat}-${arch})\n  ${mb(fs.statSync(out).size)} (${list.length} files, ${mb(blob.length)} unpacked), runtime ${hash}, ${open ? "AGPL build with ISNet" : "BiRefNet-only build"}`);
