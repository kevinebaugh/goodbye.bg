// Builds dist/: copies src/, then adds the models and runtime.
// No bundler. Output is plain static files for Cloudflare Pages or any static host.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const nm = join(root, "node_modules");
const dist = process.env.OUT_DIR || join(root, "dist");
const PART = 20 * 1024 * 1024; // Cloudflare Pages allows 25 MiB per file

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, "src"), dist, { recursive: true });

// Public origin for canonical links, the sitemap and structured data. Switch to https://goodbye.bg
// once the domain resolves (and 301 pages.dev to it; see docs/seo.md).
const SITE = process.env.SITE || "https://goodbye-bg-git.pages.dev";
for (const f of ["index.html", "robots.txt", "sitemap.xml", "remove-bg-alternative/index.html", "how-to-remove-background/index.html"]) {
  const p = join(dist, f);
  writeFileSync(p, readFileSync(p, "utf8").replaceAll("%SITE%", SITE));
}

// ONNX Runtime Web (MIT): WebGPU build. It also runs on the CPU through WebAssembly.
mkdirSync(join(dist, "ort"));
for (const f of ["ort.webgpu.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  cpSync(join(nm, "onnxruntime-web/dist", f), join(dist, "ort", f));
}

// fflate (MIT) for "Download all" zips.
mkdirSync(join(dist, "vendor"));
cpSync(join(nm, "fflate/esm/browser.js"), join(dist, "vendor/fflate.mjs"));

function writeModel(name, bytes) {
  const dir = join(dist, "m", name);
  mkdirSync(dir, { recursive: true });
  const parts = [];
  for (let i = 0; i * PART < bytes.length; i++) {
    writeFileSync(join(dir, `${i}.bin`), bytes.subarray(i * PART, (i + 1) * PART));
    parts.push(`${i}.bin`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ size: bytes.length, parts }));
  console.log(`  ${name}: ${(bytes.length / 1e6).toFixed(1)} MB in ${parts.length} parts`);
}

// GPU engine: BiRefNet lite, 16-bit (MIT). Pinned to one Hugging Face commit and checked
// by hash. Uses models/ if the file is already there, else downloads it (Cloudflare builds).
const BIREFNET = {
  url: "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx",
  sha256: "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402",
  file: join(root, "models/birefnet_lite_fp16.onnx"),
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
let birefnet = existsSync(BIREFNET.file) ? readFileSync(BIREFNET.file) : null;
if (!birefnet || sha(birefnet) !== BIREFNET.sha256) {
  console.log("Downloading BiRefNet lite (115 MB)…");
  const res = await fetch(BIREFNET.url);
  if (!res.ok) throw new Error(`BiRefNet download failed: ${res.status}`);
  birefnet = Buffer.from(await res.arrayBuffer());
  if (sha(birefnet) !== BIREFNET.sha256) throw new Error("BiRefNet hash mismatch. Refusing to build.");
  mkdirSync(join(root, "models"), { recursive: true });
  writeFileSync(BIREFNET.file, birefnet);
}

// CPU engine: ISNet, 16-bit (AGPL-3.0, IMG.LY). The package stores it as 4 MB chunks.
const dataDir = join(nm, "@imgly/background-removal-data/dist");
const res = JSON.parse(readFileSync(join(dataDir, "resources.json"), "utf8"))["/models/medium"];
const isnet = Buffer.concat(res.chunks.map((c) => readFileSync(join(dataDir, c.hash))));
if (isnet.length !== res.size) throw new Error(`ISNet size mismatch: ${isnet.length} != ${res.size}`);

console.log("Models:");
writeModel("birefnet", birefnet);
writeModel("isnet", isnet);
console.log("Built dist/.");
