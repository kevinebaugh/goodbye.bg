// Builds dist/: copies src/, then adds the model and runtime.
// No bundler. Output is plain static files for Cloudflare Pages or any static host.
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
// BiRefNet lite (MIT) for the GPU engine, made by scripts/birefnet.sh. Without it the GPU engine runs ISNet.
const birefnetFile = join(root, "models", "birefnet-webgpu.onnx");
const birefnet = existsSync(birefnetFile) ? readFileSync(birefnetFile) : null;
writeFileSync(join(dist, "engine.js"), readFileSync(join(dist, "engine.js"), "utf8").replaceAll("%ORT%", ORT).replaceAll("%BIREFNET%", birefnet ? "1" : "0"));

// fflate (MIT) for "Download all" zips.
mkdirSync(join(dist, "vendor"));
cpSync(join(nm, "fflate/esm/browser.js"), join(dist, "vendor/fflate.mjs"));
// canvas-confetti (ISC) for the hundredth cut-out and taps on the count. Served from here: the page loads nothing from elsewhere.
cpSync(join(nm, "canvas-confetti/dist/confetti.module.mjs"), join(dist, "vendor/confetti.mjs"));

// Nunito (SIL OFL 1.1), Latin, all weights in one variable file. The name carries the version so it can be
// cached forever; style.css and index.html must name the same file.
const NUNITO = JSON.parse(readFileSync(join(nm, "@fontsource-variable/nunito/package.json"), "utf8")).version;
const fontFile = `nunito-latin-${NUNITO}.woff2`;
for (const f of ["style.css", "index.html"]) if (!readFileSync(join(dist, f), "utf8").includes(fontFile)) throw new Error(`${f} must use fonts/${fontFile}`);
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

// Ad partners the page may show (public fields only; the affiliate links stay in the /go redirect).
const { PARTNERS } = await import(join(root, "lib/partners.mjs"));
writeFileSync(join(dist, "partners.json"), JSON.stringify(PARTNERS.map(({ id, name, emoji, v = "a", product, line, cta, ctas, url, variants = [] }) => ({
  id, name, emoji, live: !!url,
  variants: [{ v, product, line, cta, ctas, live: !!url },
    ...variants.map((x) => ({ v: x.v, product: x.product, line: x.line, cta: x.cta, ctas: x.ctas, live: !!(url && x.url) }))],
}))));

console.log("Model:");
writeParts(join(dist, "m", "isnet"), isnet, "isnet");
if (birefnet) writeParts(join(dist, "m", "birefnet"), birefnet, "birefnet");
else console.log("  birefnet: not built (run scripts/birefnet.sh); the GPU engine uses ISNet");
console.log("Built dist/.");
