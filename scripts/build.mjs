// Builds dist/: copies src/, then adds the model and runtime.
// No bundler. Output is plain static files for Cloudflare Pages or any static host.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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

// Split a big file into parts under the Pages per-file limit, with a manifest the engine reads.
function writeParts(dir, bytes, label) {
  mkdirSync(dir, { recursive: true });
  const parts = [];
  for (let i = 0; i * PART < bytes.length; i++) {
    writeFileSync(join(dir, `${i}.bin`), bytes.subarray(i * PART, (i + 1) * PART));
    parts.push(`${i}.bin`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ size: bytes.length, parts }));
  console.log(`  ${label}: ${(bytes.length / 1e6).toFixed(1)} MB in ${parts.length} parts`);
}

// ONNX Runtime Web (MIT), WebGPU build; it also runs on the CPU through WebAssembly.
// Served from rt/<version>/ because those files are cached forever: an upgrade gets new URLs.
const ORT = JSON.parse(readFileSync(join(nm, "onnxruntime-web/package.json"), "utf8")).version;
const rt = join(dist, "rt", ORT), ortDist = join(nm, "onnxruntime-web/dist");
mkdirSync(rt, { recursive: true });
for (const f of ["ort.webgpu.min.mjs", "ort-wasm-simd-threaded.asyncify.mjs"]) cpSync(join(ortDist, f), join(rt, f));
console.log(`Runtime ${ORT}:`);
writeParts(join(rt, "wasm"), readFileSync(join(ortDist, "ort-wasm-simd-threaded.asyncify.wasm")), "wasm");
// Build ID: the page reloads itself when a tab left open is older than the live site (see freshen() in app.js).
const BUILD = Date.now().toString(36);
writeFileSync(join(dist, "version.txt"), BUILD);
writeFileSync(join(dist, "app.js"), readFileSync(join(dist, "app.js"), "utf8").replaceAll("%BUILD%", BUILD));
// BiRefNet lite (MIT) for the GPU engine: committed as parts in weights/birefnet/ (made by scripts/birefnet.sh).
// Without it the GPU engine runs ISNet.
const birefnetSrc = join(root, "weights", "birefnet");
const birefnetManifest = existsSync(join(birefnetSrc, "manifest.json")) ? JSON.parse(readFileSync(join(birefnetSrc, "manifest.json"), "utf8")) : null;
// m/ is cached forever, so the folder is named after the model's hash: a new export never mixes with old parts.
const birefnetDir = birefnetManifest ? "birefnet-" + birefnetManifest.sha256.slice(0, 8) : "";
writeFileSync(join(dist, "engine.js"), readFileSync(join(dist, "engine.js"), "utf8").replaceAll("%ORT%", ORT).replaceAll("%BIREFNET%", birefnetDir));
// The page remembers per device which GPU tier worked (see the GPU gate in app.js); a new runtime or model tries again.
writeFileSync(join(dist, "app.js"), readFileSync(join(dist, "app.js"), "utf8").replaceAll("%ENGINE%", `${ORT}/${birefnetDir}`));

// fflate (MIT) for "Download all" zips.
mkdirSync(join(dist, "vendor"));
cpSync(join(nm, "fflate/esm/browser.js"), join(dist, "vendor/fflate.mjs"));
// canvas-confetti (ISC) for the hundredth cut-out and taps on the count. Served from here: the page loads nothing from elsewhere.
cpSync(join(nm, "canvas-confetti/dist/confetti.module.mjs"), join(dist, "vendor/confetti.mjs"));

// Nunito (SIL OFL 1.1), Latin, all weights in one variable file. The name carries the version so it can be
// cached forever; style.css and index.html must name the same file.
const NUNITO = JSON.parse(readFileSync(join(nm, "@fontsource-variable/nunito/package.json"), "utf8")).version;
const fontFile = `nunito-latin-${NUNITO}.woff2`;
// The text pages preload it too: with font-display: optional, a first visit without the preload shows the fallback font.
for (const f of ["style.css", "index.html", "404.html", "remove-bg-alternative/index.html", "how-to-remove-background/index.html"]) if (!readFileSync(join(dist, f), "utf8").includes(fontFile)) throw new Error(`${f} must use fonts/${fontFile}`);
mkdirSync(join(dist, "fonts"));
cpSync(join(nm, "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2"), join(dist, "fonts", fontFile));

// The model: ISNet, 16-bit (AGPL-3.0, IMG.LY), used by both the GPU and the CPU engine.
// The package stores it as 4 MB chunks.
const dataDir = join(nm, "@imgly/background-removal-data/dist");
const res = JSON.parse(readFileSync(join(dataDir, "resources.json"), "utf8"))["/models/medium"];
const isnet = Buffer.concat(res.chunks.map((c) => readFileSync(join(dataDir, c.hash))));
if (isnet.length !== res.size) throw new Error(`ISNet size mismatch: ${isnet.length} != ${res.size}`);
// Photoreal product previews: src/render3d.js bundled with Three.js (MIT) into one minified file, loaded only
// when ads show. The unbundled source isn't served.
const esbuild = await import("esbuild");
await esbuild.build({ entryPoints: [join(root, "src/render3d.js")], bundle: true, format: "esm", minify: true, target: "es2022",
  outfile: join(dist, "render3d.mjs"), legalComments: "none", logLevel: "warning" });
rmSync(join(dist, "render3d.js"));
// Animated GIFs: src/gif.js with gifuct-js and gifenc (both MIT), loaded only when an animated GIF is added.
await esbuild.build({ entryPoints: [join(root, "src/gif.js")], bundle: true, format: "esm", minify: true, target: "es2022",
  outfile: join(dist, "gif.mjs"), legalComments: "none", logLevel: "warning" });
rmSync(join(dist, "gif.js"));
// HEIC, TIFF and camera RAW: src/formats.js (a module Worker) with UTIF (MIT) and libheif (LGPL-3.0, wasm next to it,
// with its licence), started only when such a file is added.
await esbuild.build({ entryPoints: [join(root, "src/formats.js")], bundle: true, format: "esm", minify: true, target: "es2022",
  outfile: join(dist, "formats.mjs"), legalComments: "none", logLevel: "warning", external: ["fs", "path", "crypto", "url", "module", "worker_threads"] }); // node-only branches
rmSync(join(dist, "formats.js"));
cpSync(join(nm, "libheif-js/libheif-wasm/libheif.wasm"), join(dist, "libheif.wasm"));
cpSync(join(nm, "libheif-js/LICENSE"), join(dist, "libheif-LICENSE.txt"));

// Ad partners the page may show (public fields only; the affiliate links stay in the /go redirect).
const { PARTNERS } = await import(join(root, "lib/partners.mjs"));
const partnersJson = JSON.stringify(PARTNERS.map(({ id, name, emoji, v = "a", product, line, cta, ctas, url, variants = [] }) => ({
  id, name, emoji, live: !!url,
  variants: [{ v, product, line, cta, ctas, live: !!url },
    ...variants.map((x) => ({ v: x.v, product: x.product, line: x.line, cta: x.cta, ctas: x.ctas, live: !!(url && x.url) }))],
})));
writeFileSync(join(dist, "partners.json"), partnersJson);
// Also inside app.js, so the first layout knows which grid cells the ads take (no fetch to wait for).
writeFileSync(join(dist, "app.js"), readFileSync(join(dist, "app.js"), "utf8").replace('"%PARTNERS%"', () => JSON.stringify(partnersJson)));

console.log("Model:");
writeParts(join(dist, "m", "isnet"), isnet, "isnet");
if (birefnetManifest) {
  const out = join(dist, "m", birefnetDir), hash = createHash("sha256");
  mkdirSync(out, { recursive: true });
  for (const p of birefnetManifest.parts) { const b = readFileSync(join(birefnetSrc, p)); hash.update(b); writeFileSync(join(out, p), b); }
  if (hash.digest("hex") !== birefnetManifest.sha256) throw new Error("weights/birefnet: parts don't match manifest.json");
  cpSync(join(birefnetSrc, "manifest.json"), join(out, "manifest.json"));
  cpSync(join(root, "docs/licenses/BiRefNet.txt"), join(out, "LICENSE.txt")); // MIT: the notice travels with the weights
  console.log(`  ${birefnetDir}: ${(birefnetManifest.size / 1e6).toFixed(1)} MB in ${birefnetManifest.parts.length} parts`);
}
else console.log("  birefnet: not built (run scripts/birefnet.sh); the GPU engine uses ISNet");
console.log("Built dist/.");
