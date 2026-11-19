// Builds dist/: copies src/, then adds the model and runtime from node_modules.
// No bundler. Output is plain static files for Cloudflare Pages or any static host.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const nm = join(root, "node_modules");
const dist = process.env.OUT_DIR || join(root, "dist");

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, "src"), dist, { recursive: true });

// ONNX Runtime Web (MIT): the WebAssembly build only.
mkdirSync(join(dist, "ort"));
for (const f of ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  cpSync(join(nm, "onnxruntime-web/dist", f), join(dist, "ort", f));
}

// fflate (MIT) for "Download all" zips.
mkdirSync(join(dist, "vendor"));
cpSync(join(nm, "fflate/esm/browser.js"), join(dist, "vendor/fflate.mjs"));

// Segmentation model (AGPL-3.0, IMG.LY): quantized ISNet, 44 MB.
// The package stores it as 4 MB chunks. Join them, then split into 3 parts
// so every file stays under Cloudflare Pages' 25 MiB file limit.
const dataDir = join(nm, "@imgly/background-removal-data/dist");
const res = JSON.parse(readFileSync(join(dataDir, "resources.json"), "utf8"))["/models/small"];
const model = Buffer.concat(res.chunks.map((c) => readFileSync(join(dataDir, c.hash))));
if (model.length !== res.size) throw new Error(`Model size mismatch: ${model.length} != ${res.size}`);
mkdirSync(join(dist, "m"));
const n = 3, step = Math.ceil(model.length / n), parts = [];
for (let i = 0; i < n; i++) {
  const name = `${i}.bin`;
  writeFileSync(join(dist, "m", name), model.subarray(i * step, (i + 1) * step));
  parts.push(name);
}
writeFileSync(join(dist, "m/manifest.json"), JSON.stringify({ size: model.length, parts }));


console.log(`Built dist/ (model ${(model.length / 1e6).toFixed(1)} MB in ${n} parts).`);
