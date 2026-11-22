// Builds dist/: copies src/, then adds the model and runtime.
// No bundler. Output is plain static files for Cloudflare Pages or any static host.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// The text pages, English and translated (src/<lang>/<page>/index.html, see docs/i18n.md).
const TEXT_PAGES = readdirSync(dist, { recursive: true }).filter((f) => /(^|\/)(remove-bg-alternative|how-to-remove-background)\/index\.html$/.test(f)).sort();
// Each text page names all its translations (hreflang), English being the default.
const { LANGS } = await import(join(root, "src/i18n.js"));
const hreflang = (slug) => [["en", ""], ...Object.entries(LANGS).map(([code, l]) => [code, l.path + "/"]), ["x-default", ""]]
  .map(([code, dir]) => `<link rel="alternate" hreflang="${code}" href="${SITE}/${dir}${slug}/">`).join("\n");
for (const f of ["index.html", "robots.txt", "sitemap.xml", ...TEXT_PAGES]) {
  const p = join(dist, f);
  let s = readFileSync(p, "utf8").replaceAll("%SITE%", SITE);
  if (TEXT_PAGES.includes(f)) {
    if (!s.includes("<!--%HREFLANG%-->")) throw new Error(`${f} must hold <!--%HREFLANG%--> after its canonical link`);
    s = s.replace("<!--%HREFLANG%-->", hreflang(f.split("/").at(-2)));
  }
  writeFileSync(p, s);
}

// The app page in other languages: src/i18n.js goes inside early.js (it runs before the first paint, so the page never
// shows English first). Every language must have every key the others have.
{
  const src = readFileSync(join(root, "src/i18n.js"), "utf8");
  const keys = new Set(Object.values(LANGS).flatMap((l) => Object.keys(l.t)));
  for (const [code, l] of Object.entries(LANGS)) {
    const missing = [...keys].filter((k) => !(k in l.t));
    if (missing.length) throw new Error(`src/i18n.js: ${code} has no ${missing.slice(0, 3).map((k) => JSON.stringify(k)).join(", ")}`);
    if (!l.quips?.length || !l.retryQuips?.length || !l.path) throw new Error(`src/i18n.js: ${code} needs quips, retryQuips and a path`);
  }
  const early = readFileSync(join(dist, "early.js"), "utf8");
  if (!early.includes("/*%I18N%*/")) throw new Error("early.js must hold the /*%I18N%*/ placeholder");
  writeFileSync(join(dist, "early.js"), early.replace("/*%I18N%*/", () => src.replace(/^export const LANGS/m, "const LANGS")));
  rmSync(join(dist, "i18n.js"));
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
// BiRefNet lite (MIT), committed as parts: weights/birefnet/ for the GPU engine (1024, made by scripts/birefnet.sh) and
// weights/birefnet640/ for the CPU engine (640, scripts/birefnet640.sh). Without them the engines run ISNet.
// m/ is cached forever, so each folder is named after the model's hash: a new export never mixes with old parts.
const weights = (name) => {
  const src = join(root, "weights", name), mf = join(src, "manifest.json");
  if (!existsSync(mf)) return { name, src, manifest: null, dir: "" };
  const manifest = JSON.parse(readFileSync(mf, "utf8"));
  return { name, src, manifest, dir: `${name}-${manifest.sha256.slice(0, 8)}` };
};
const birefnet = weights("birefnet"), birefnet640 = weights("birefnet640");
writeFileSync(join(dist, "engine.js"), readFileSync(join(dist, "engine.js"), "utf8").replaceAll("%ORT%", ORT)
  .replaceAll("%BIREFNET640%", birefnet640.dir).replaceAll("%BIREFNET%", birefnet.dir));
// The page remembers per device which GPU tier worked (see the GPU gate in app.js); a new runtime or model tries again.
writeFileSync(join(dist, "app.js"), readFileSync(join(dist, "app.js"), "utf8").replaceAll("%ENGINE%", `${ORT}/${birefnet.dir}`));

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
for (const f of ["style.css", "index.html", "404.html", ...TEXT_PAGES]) if (!readFileSync(join(dist, f), "utf8").includes(fontFile)) throw new Error(`${f} must use fonts/${fontFile}`);
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
for (const w of [birefnet, birefnet640]) {
  if (!w.manifest) { console.log(`  ${w.name}: not built (weights/${w.name}/ is missing); that engine uses ISNet`); continue; }
  const out = join(dist, "m", w.dir), hash = createHash("sha256");
  mkdirSync(out, { recursive: true });
  for (const p of w.manifest.parts) { const b = readFileSync(join(w.src, p)); hash.update(b); writeFileSync(join(out, p), b); }
  if (hash.digest("hex") !== w.manifest.sha256) throw new Error(`weights/${w.name}: parts don't match manifest.json`);
  cpSync(join(w.src, "manifest.json"), join(out, "manifest.json"));
  cpSync(join(root, "docs/licenses/BiRefNet.txt"), join(out, "LICENSE.txt")); // MIT: the notice travels with the weights
  console.log(`  ${w.dir}: ${(w.manifest.size / 1e6).toFixed(1)} MB in ${w.manifest.parts.length} parts`);
}

// The service worker's version list (src/sw.js). Shell: the app page's files with a hash each, so an update keeps
// what didn't change; eager ones are kept at install (the page loads them anyway), the rest when first used.
// Big: the runtime and model folders with their files, one cache each, named after the version; old versions are deleted.
const fileHash = (f) => createHash("sha256").update(readFileSync(join(dist, f))).digest("hex").slice(0, 12);
const shellFiles = { "/": "index.html" };
for (const f of ["app.js", "style.css", "early.js", "engine.js", "favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "icon-maskable-512.png", "apple-touch-icon.png", `fonts/${fontFile}`, "vendor/fflate.mjs", "vendor/confetti.mjs", "partners.json",
  "gif.mjs", "formats.mjs", "libheif.wasm", "render3d.mjs", "edit.js", "edit.css"]) shellFiles["/" + f] = f;
const shell = Object.fromEntries(Object.entries(shellFiles).map(([p, f]) => [p, fileHash(f)]));
const eager = ["/", "/app.js", "/style.css", "/early.js", `/fonts/${fontFile}`, "/favicon.svg", "/manifest.webmanifest"];
const big = {};
const bigDir = (prefix, cache) => (big[prefix] = { cache, files: readdirSync(join(dist, prefix), { recursive: true }).filter((f) => statSync(join(dist, prefix, f)).isFile()).sort() });
bigDir(`/rt/${ORT}/`, `gb-rt-${ORT}`);
bigDir("/m/isnet/", `gb-m-isnet-${createHash("sha256").update(isnet).digest("hex").slice(0, 8)}`); // the URL has no version: the cache name does
for (const w of [birefnet, birefnet640]) if (w.dir) bigDir(`/m/${w.dir}/`, `gb-m-${w.dir}`);
const sw = readFileSync(join(dist, "sw.js"), "utf8");
if (!sw.includes('"%SW%"')) throw new Error("sw.js must hold the \"%SW%\" placeholder");
writeFileSync(join(dist, "sw.js"), sw.replace('"%SW%"', () => JSON.stringify({ build: BUILD, shell, eager, big })));
console.log("Built dist/.");
