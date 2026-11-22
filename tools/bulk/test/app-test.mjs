// End-to-end test of the window (goodbye-bg app) in headless Chrome, driven by Playwright.
//
//   PW=<folder with node_modules/playwright-core> node test/app-test.mjs <folder of photos> [--bin <goodbye-bg binary>] [--shots <dir>]
//
// playwright-core isn't a dependency of this package (install it anywhere: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i
// playwright-core); it drives the installed Google Chrome (CHROME=... for another). Nothing opens on screen: the app
// runs with --no-open, the folder dialog is answered by GOODBYE_BG_PICK, and "Show in Finder" only prints
// (GOODBYE_BG_DRYOPEN). Cut-outs go to a temporary folder, plus "<photos> cut-outs" next to the photos (removed after).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(ROOT, "package.json"));
const sharp = req("sharp");
const { chromium } = createRequire(path.join(path.resolve(process.env.PW || "."), "x.js"))("playwright-core");
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const photos = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--bin", "--shots"].includes(args[i - 1])) || "");
const BIN = opt("--bin"), SHOTS = opt("--shots");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const names = fs.readdirSync(photos).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!names.length) throw new Error("no photos");

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "goodbye-bg-app-test-"));
const dl = path.join(tmp, "Downloads"); fs.mkdirSync(dl);
const nextTo = `${photos} cut-outs`;
for (const d of [nextTo, `${nextTo} 2`]) if (fs.existsSync(d)) throw new Error(`${d} exists; the test writes there and removes it after, so move it away first`);

// Start the app.
const env = { ...process.env, GOODBYE_BG_DOWNLOADS: dl, GOODBYE_BG_PICK: photos, GOODBYE_BG_DRYOPEN: "1", GOODBYE_BG_IDLE_MS: "4000" };
// The binary runs with no Node on the PATH, as on a buyer's Mac.
const child = BIN ? spawn(BIN, ["app", "--no-open"], { env: { ...env, PATH: "/usr/bin:/bin" } }) : spawn(process.execPath, [path.join(ROOT, "bin/goodbye-bg.cjs"), "app", "--no-open"], { env });
let log = "";
process.on("exit", () => child.kill()); // never leave it running if a step throws
child.stderr.on("data", (d) => (log += d));
const address = await new Promise((resolve, reject) => {
  child.stdout.on("data", (d) => { log += d; const m = /(http:\/\/127\.0\.0\.1:\d+\/#[0-9a-f]+)/.exec(log); if (m) resolve(m[1]); });
  child.on("exit", (c) => reject(new Error(`app exited ${c}: ${log}`)));
});
const origin = new URL(address).origin, token = new URL(address).hash.slice(1), port = new URL(address).port;
console.log(`app at ${origin}`);

// Requests from elsewhere are refused.
const raw = (p, headers = {}) => new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: p, headers }, (r) => { r.resume(); resolve(r.statusCode); }));
check((await raw("/api/events")) === 403, "API without the token: 403");
check((await raw(`/api/events?t=${token}`, { Origin: "https://example.com" })) === 403, "API from another origin: 403");
check((await raw(`/?t=${token}`, { Host: `evil.example:${port}` })) === 403, "another host name (DNS rebinding): 403");
check((await raw("/")) === 200, "the page itself: 200");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const offsite = [];
page.on("request", (r) => { if (!r.url().startsWith(origin + "/") && !r.url().startsWith("data:")) offsite.push(r.url()); });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
// The page's CSP has no unsafe-eval, which waitForFunction's polling needs; evaluate() works.
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (!(await page.evaluate(fn))) { if (Date.now() > end) throw new Error(`timed out: ${fn}`); await new Promise((r) => setTimeout(r, 100)); } };
await page.goto(address);
await waitFor(() => /on the (GPU|CPU)/.test(document.getElementById("engine").textContent), 120000);
console.log(`engine: ${await page.textContent("#engine")}`);
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); } };
await shot("1-empty");

// Drops the photos on the window as files (a synthetic drop carries files, not folder entries).
const files = names.map((n) => ({ name: n, b64: fs.readFileSync(path.join(photos, n)).toString("base64") }));
async function drop() {
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "image/jpeg" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await page.waitForSelector("#setup:not([hidden])");
}
const choose = (name, value) => page.check(`input[name="${name}"][value="${value}"]`, { force: true });
async function startAndWait(label) {
  const t = Date.now();
  await page.click("#start");
  await page.waitForSelector("#doneRow:not([hidden])", { timeout: 180000 });
  const wall = (Date.now() - t) / 1000;
  const text = await page.textContent("#statusText");
  const out = await page.textContent("#donePath");
  const imgs = await page.$$eval("#grid .card img", (a) => a.length);
  await waitFor(() => [...document.querySelectorAll("#grid .card img")].every((i) => i.complete && i.naturalWidth > 0), 30000);
  console.log(`${label}: ${text.trim()} (${wall.toFixed(1)} s from Start) -> ${out}`);
  return { wall, text, out, imgs };
}
async function outputs(dir, ext) {
  const list = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
  const metas = await Promise.all(list.map((f) => sharp(path.join(dir, f)).metadata()));
  const corners = await Promise.all(list.map(async (f) => { const { data, info } = await sharp(path.join(dir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return [...data.subarray(0, 4)].concat(info.width, info.height); }));
  return { list, metas, corners, allExt: list.every((f) => f.endsWith(ext)) };
}

// 1. Drop, the defaults: see-through PNG at full size.
await drop();
check((await page.textContent("#pickedCount")).startsWith(`${names.length} photo`), `drop: ${names.length} photos picked`);
await choose("bg", "transparent"); await choose("format", "png"); await choose("size", "original");
await shot("2-setup");
const r1 = await startAndWait("drop, see-through PNG");
await shot("3-done");
check(r1.imgs === names.length, `drop: ${names.length} thumbnails shown`);
check(path.dirname(r1.out) === dl && /^Cut-outs \d{4}-/.test(path.basename(r1.out)), "drop: saved to a new folder in Downloads");
{
  const o = await outputs(r1.out, ".png");
  check(o.list.length === names.length && o.allExt, `drop: ${o.list.length} PNGs`);
  const ins = await Promise.all(names.map((n) => sharp(path.join(photos, n)).rotate().metadata()));
  const same = o.metas.every((m, i) => { const a = ins[i], w = (a.orientation || 1) >= 5 ? a.height : a.width, h = (a.orientation || 1) >= 5 ? a.width : a.height; return m.width === w && m.height === h; });
  check(same, "drop: full size, same as each photo");
  check(o.metas.every((m) => m.hasAlpha), "drop: PNGs have alpha");
  check(o.corners.filter((c) => c[3] < 255).length >= names.length * 0.8, `drop: see-through corners (${o.corners.filter((c) => c[3] < 255).length} of ${names.length})`);
}

// 2. New batch, other options: white, JPG, square 2000, 8% margin.
await page.click("#newBatch");
await drop();
await choose("format", "jpg");
check(await page.isDisabled('input[name="bg"][value="transparent"]'), "JPG turns see-through off");
check(await page.isChecked('input[name="bg"][value="white"]'), "...and picks white");
await choose("size", "2000");
check(await page.isVisible("#marginSet"), "square sizes show the margin");
await page.$eval("#pad", (el) => { el.value = "8"; el.dispatchEvent(new Event("input")); });
check((await page.textContent("#padOut")) === "8%", "margin 8%");
const r2 = await startAndWait("drop, white JPG 2000 square, 8%");
{
  const o = await outputs(r2.out, ".jpg");
  check(o.list.length === names.length && o.allExt, `options: ${o.list.length} JPGs`);
  check(o.metas.every((m) => m.width === 2000 && m.height === 2000), "options: 2000 x 2000");
  check(o.corners.every((c) => c[0] > 250 && c[1] > 250 && c[2] > 250), "options: white corners");
  const st = JSON.parse(fs.readFileSync(path.join(r2.out, ".goodbye-bg.json"), "utf8"));
  check(st.pad === 0.08 && st.format === "jpg", "options: settings file says pad 0.08, jpg");
}

// 3. Choose folder (the dialog answered by GOODBYE_BG_PICK): read from disk, saved next to the folder.
await page.click("#newBatch");
await page.click("#pickFolder");
await page.waitForSelector("#setup:not([hidden])");
check((await page.textContent("#outPath")) === nextTo, "folder: saves next to it");
await choose("format", "webp"); await choose("size", "crop"); await choose("bg", "color");
await page.evaluate(() => { const c = document.getElementById("bgColor"); c.value = "#e1f1f0"; c.dispatchEvent(new Event("input")); });
check(!(await page.isVisible("#marginSet")), "crop hides the margin");
const r3 = await startAndWait("folder, #e1f1f0 WebP cropped");
check(r3.out === nextTo, "folder: cut-outs in '<folder> cut-outs'");
{
  const o = await outputs(r3.out, ".webp");
  check(o.list.length === names.length && o.allExt, `folder: ${o.list.length} WebPs`);
  check(o.corners.every((c) => Math.abs(c[0] - 0xe1) < 6 && Math.abs(c[1] - 0xf1) < 6 && Math.abs(c[2] - 0xf0) < 6), "folder: colour corners");
}
// Same settings again: everything is already done (resume).
await page.click("#newBatch"); await page.click("#pickFolder"); await page.waitForSelector("#setup:not([hidden])");
const r4 = await startAndWait("folder again, same settings");
check(/already done/.test(r4.text) && r4.out === nextTo, "folder again: skipped as already done");
log = "";
await page.click("#reveal");
await new Promise((r) => setTimeout(r, 300));
check(log.includes(`open ${nextTo}`), "Show in Finder opens the output folder");
// Other settings into the same folder: a new folder "... 2", not a mix.
await page.click("#newBatch"); await page.click("#pickFolder"); await page.waitForSelector("#setup:not([hidden])");
await choose("format", "png"); await choose("bg", "transparent"); await choose("size", "1000");
// Stop part way.
await page.click("#start");
await waitFor(() => document.querySelectorAll("#grid .card").length >= 2, 60000);
await page.click("#stop");
await page.waitForSelector("#doneRow:not([hidden])", { timeout: 60000 });
const stopped = await page.textContent("#statusText"), out5 = await page.textContent("#donePath");
console.log(`stop: ${stopped.trim()} -> ${out5}`);
check(out5 === `${nextTo} 2`, "other settings: a new folder '... 2'");
check(/^Stopped/.test(stopped) && fs.readdirSync(out5).filter((f) => !f.startsWith(".")).length < names.length, "Stop: stops part way");
check(!fs.readdirSync(out5).some((f) => f.includes(".part")), "Stop: no half files");

check(offsite.length === 0, `no requests beyond 127.0.0.1 (${offsite.length})`);
check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);

// Dark mode screenshot, then close the window: the app stops by itself (idle 4 s here).
if (SHOTS) { await page.emulateMedia({ colorScheme: "dark" }); await shot("4-done-dark"); await page.click("#newBatch"); await shot("5-empty-dark"); }
await browser.close();
const code = await new Promise((resolve) => { const t = setTimeout(() => resolve("still running"), 15000); child.on("exit", (c) => { clearTimeout(t); resolve(c); }); });
check(code === 0, `closing the window stops the app (${code})`);
if (code !== 0) child.kill();

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(nextTo, { recursive: true, force: true }); fs.rmSync(`${nextTo} 2`, { recursive: true, force: true });
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
