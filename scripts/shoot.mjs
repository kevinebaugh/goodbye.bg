// Launch kit pictures and demo from the local build, with the real model (docs/launch/README.md).
//   npm run dev            (in another terminal; or PORT/URL below)
//   node scripts/shoot.mjs  [--only batch,product,square,demo]
// Photos: the CC0 files in docs/launch/CREDITS.md, downloaded once into PHOTOS (default: $TMPDIR/gb-shoot).
// Output: docs/launch/*-{light,dark}.png, demo.mp4 and demo.gif (ffmpeg). Test switches keep it out of the stats.
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SITE = process.env.URL || `http://localhost:${process.env.PORT || 8788}`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../docs/launch/", import.meta.url).pathname;
const PHOTOS = process.env.PHOTOS || join(tmpdir(), "gb-shoot");
const only = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) || process.argv[process.argv.indexOf("--only") + 1] || "").split(",").filter((x) => /^[a-z]+$/.test(x));
const want = (k) => !only.length || only.includes(k);

const FILES = {
  corgi: "Fawn_and_white_Welsh_Corgi_puppy_standing_on_rear_legs_and_sticking_out_the_tongue.jpg",
  cat: "Tabby_cat_with_blue_eyes-3336579.jpg",
  car: "PINK_AUTOMOBILE_MANUFACTURED_BY_CADILLAC.jpg",
  teapot: "Teapot_MET_DP156033.jpg",
};
mkdirSync(PHOTOS, { recursive: true });
for (const [name, file] of Object.entries(FILES)) {
  const p = join(PHOTOS, `${name}.jpg`);
  if (existsSync(p)) continue;
  const r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=2000`, { headers: { "User-Agent": "goodbye.bg launch kit (CC0 photos)" } });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  writeFileSync(p, Buffer.from(await r.arrayBuffer()));
}
const photo = (n) => join(PHOTOS, `${n}.jpg`);

// Same flags as the smoke test, so WebGPU (BiRefNet) runs headless on a Mac.
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--hide-scrollbars"] });

// ?adpartner=zazzle marks the visit as a test (TEST_SWITCHES in app.js) and is the live partner anyway.
async function page(scheme, size, video) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: video ? 1 : 2, colorScheme: scheme, reducedMotion: "no-preference",
    ...(video && { recordVideo: { dir: video, size } }) });
  const p = await ctx.newPage();
  await p.goto(`${SITE}/?adpartner=zazzle`);
  await p.waitForSelector("#file", { state: "attached" });
  return p;
}
async function addAndWait(p, names, ads = 1) {
  await p.setInputFiles("#file", names.map(photo));
  await p.waitForFunction((n) => document.querySelectorAll('.card img[draggable="true"]').length >= n, names.length, { timeout: 180_000 });
  if (ads) await p.waitForFunction((n) => document.querySelectorAll('a[href*="/go/zazzle"]').length >= n, ads, { timeout: 60_000 });
  await p.waitForTimeout(6000); // the product finishes drawing, the shimmer and any confetti (every 100th) are gone
}
// Rendered at 2x and scaled down: smoother edges on the 3D products.
const shot = async (p, name) => {
  const { width, height } = p.viewportSize(), file = join(OUT, name);
  await p.screenshot({ path: file });
  execFileSync("sips", ["-z", String(height), String(width), file], { stdio: "ignore" });
  console.log("wrote", name);
};

// Warm the model cache once, so every shot and the demo run at real (cached) speed.
{ const p = await page("light", { width: 1270, height: 760 }); await addAndWait(p, ["teapot"], 0); await p.context().close(); }

for (const scheme of ["light", "dark"]) {
  if (want("batch")) { const p = await page(scheme, { width: 1270, height: 760 }); await addAndWait(p, ["corgi", "cat", "car", "teapot"]); await shot(p, `ph-2-batch-${scheme}.png`); await p.context().close(); }
  if (want("product")) { const p = await page(scheme, { width: 1270, height: 760 }); await addAndWait(p, ["corgi", "teapot"]); await shot(p, `ph-3-product-${scheme}.png`); await p.context().close(); }
  if (want("square")) { const p = await page(scheme, { width: 1080, height: 1080 }); await addAndWait(p, ["corgi", "cat", "car", "teapot"]); await shot(p, `social-square-${scheme}.png`); await p.context().close(); }
}

if (want("demo")) {
  const dir = join(PHOTOS, "video"); rmSync(dir, { recursive: true, force: true });
  const p = await page("light", { width: 1270, height: 760 }, dir);
  await p.waitForTimeout(1500);                       // the empty page
  await addAndWait(p, ["corgi", "cat", "car", "teapot"]);
  await p.waitForTimeout(4000);                       // results and the product card settle
  const all = p.locator("#all"); if (await all.isVisible()) { await all.hover(); await p.waitForTimeout(1500); }
  await p.context().close();
  const webm = join(dir, readdirSync(dir).find((f) => f.endsWith(".webm")));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "23", join(OUT, "demo.mp4")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer", join(OUT, "demo.gif")]);
  console.log("wrote demo.mp4, demo.gif");
}
await browser.close();
