// Cross-browser checks with Playwright: WebKit (Safari's engine) on a computer and as an iPhone (touch, iPhone
// user agent, so the app takes its iPhone paths: CPU engine with 2 threads, share sheet), and Firefox.
// Playwright's WebKit on macOS is close to Safari (same engine) but has no iOS memory limits.
//
//   npx playwright install webkit firefox        once (browsers go to ~/Library/Caches/ms-playwright)
//   npm run test:x                               build, then all three
//   node scripts/test/xbrowser.mjs --no-build --browser webkit --device iphone
//
// Each check prints PASS, FAIL or SKIP; exit code 1 when any fails. The Chrome suite is scripts/test/smoke.mjs.
// Contexts are persistent (a temp profile) because an ephemeral WebKit context behaves like Private Browsing:
// IndexedDB there refuses Blobs, so nothing is kept (the app copes; see the "private window" check).
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { webkit, firefox, devices } from "playwright";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = new URL("../..", import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const tmp = mkdtempSync(join(tmpdir(), "goodbye-x-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
let stopping = false;
const cleanup = () => { stopping = true; for (const p of procs) try { p.kill("SIGKILL"); } catch {} try { rmSync(tmp, { recursive: true, force: true }); } catch {} };
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const results = [];
async function check(name, fn) {
  const s = Date.now();
  try {
    const note = await fn();
    if (note?.skip) return report(name, "SKIP", Date.now() - s, note.skip);
    report(name, "PASS", Date.now() - s, note || "");
  } catch (e) { report(name, "FAIL", Date.now() - s, (e?.message || String(e)).split("\n")[0]); }
}
function report(name, status, ms, note) {
  results.push({ name, status });
  console.log(`${status.padEnd(4)}  ${name}${ms ? ` (${(ms / 1000).toFixed(1)} s)` : ""}${note ? `  ${note}` : ""}`);
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
// The rows in the bar's place show one page at a time: turn to the page holding sel (as a person presses ›).
async function onPage(p, sel) {
  for (let i = 0; i < 8; i++) {
    const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return "missing"; if (!e.classList.contains("off")) return "shown"; e.parentElement.querySelector(".pgnext").click(); return "turned"; }, sel);
    if (r !== "turned") return r;
  }
}
const magic = (b) => b.subarray(0, 4).toString("hex");
const kind = (b) => (magic(b) === "89504e47" ? "png" : magic(b).startsWith("ffd8ff") ? "jpg" : magic(b) === "504b0304" ? "zip" : b.subarray(0, 3).toString() === "GIF" ? "gif" : magic(b) === "52494646" && b.subarray(8, 12).toString() === "WEBP" ? "webp" : "?" + magic(b));
const gifFrames = (b) => { let n = 0; for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) n++; return n; };
// Three frames of a figure moving sideways, as in the Chrome suite.
function gifBytes() {
  const W = 240, H = 240, enc = GIFEncoder();
  for (let f = 0; f < 3; f++) {
    const rgba = new Uint8ClampedArray(W * H * 4), cx = W / 2 + (f - 1) * 30;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const head = (x - cx) ** 2 + (y - H * 0.24) ** 2 < (W * 0.15) ** 2, body = ((x - cx) / (W * 0.28)) ** 2 + ((y - H * 0.62) / (H * 0.3)) ** 2 < 1;
      rgba.set(head ? [240, 200, 160, 255] : body ? [192, 48, 42, 255] : [200, 220, 230, 255], (y * W + x) * 4);
    }
    const pal = quantize(rgba, 64); enc.writeFrame(applyPalette(rgba, pal), W, H, { palette: pal, delay: 150 });
  }
  enc.finish(); return Buffer.from(enc.bytes());
}
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

/* ---------- page helpers ---------- */
const CARDS = `[...document.querySelectorAll("#grid > .card")]`;
// Photos made in the page (a figure on a gradient), through the file input's change event, as the picker does.
const addPhotos = (p, names) => p.evaluate(async (names) => {
  const dt = new DataTransfer();
  for (const [k, name] of names.entries()) {
    const c = document.createElement("canvas"); c.width = 900 + k * 40; c.height = 1200; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 900, 1200); g.addColorStop(0, "#d8e8f0"); g.addColorStop(1, "#8aa"); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = ["#c0302a", "#2050c0", "#20a040", "#e0b020"][k % 4]; x.beginPath(); x.ellipse(450, 650, 260, 380, 0, 0, 7); x.fill();
    x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(450, 260, 150, 0, 7); x.fill();
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)); dt.items.add(new File([b], name + ".jpg", { type: "image/jpeg" }));
  }
  const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true }));
}, names);
async function allDone(p, n, ms = 120000) {
  await p.waitForFunction(({ n }) => {
    const c = [...document.querySelectorAll("#grid > .card")];
    if (c.some((x) => x.classList.contains("failed"))) return "failed";
    return c.length === n && c.every((x) => !x.querySelector(".dl").disabled && !x.classList.contains("working") && !x.classList.contains("queued"));
  }, { n }, { timeout: ms, polling: 200 });
  const failed = await p.evaluate(`${CARDS}.filter((x) => x.classList.contains("failed")).map((x) => x.innerText.replace(/\\s+/g, " ")).join(" | ")`);
  assert(!failed, "a card failed: " + failed);
}

// Download on a computer is a real download; on the iPhone it is the share sheet, stubbed here to record the files.
const SHARE_STUB = () => {
  window.__shared = [];
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => { window.__shared.push(await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()).subarray(0, 64))), size: f.size })))); };
};
async function save(t, p, click, ms = 60000) {
  if (t.phone) {
    const n = await p.evaluate("window.__shared.length");
    await click();
    await p.waitForFunction((n) => window.__shared.length > n, n, { timeout: ms });
    const files = (await p.evaluate("window.__shared.at(-1)")).map((f) => ({ ...f, bytes: Buffer.from(f.b64, "base64") }));
    return files.map((f) => ({ name: f.name, kind: kind(f.bytes), bytes: f.bytes, size: f.size }));
  }
  // Firefox saves a WebP and then opens it in a new tab (WebP is on its "viewable internally" list): no download event.
  const opened = p.context().waitForEvent("page", { timeout: ms + 5000 }).then(async (pg) => { if (!pg.url().startsWith("file:")) await pg.waitForURL(/^file:/); return pg; }, () => new Promise(() => {})); // never wins by timing out
  const got = await Promise.race([Promise.all([p.waitForEvent("download", { timeout: ms }), click()]).then(([d]) => ({ d })), opened.then((pg) => ({ pg }))]);
  if (got.pg) {
    const path = fileURLToPath(got.pg.url()), bytes = readFileSync(path);
    await p.bringToFront(); await got.pg.close(); await p.bringToFront();
    return [{ name: basename(path), kind: kind(bytes), bytes, size: bytes.length, opened: true }];
  }
  const bytes = readFileSync(await got.d.path());
  return [{ name: got.d.suggestedFilename(), kind: kind(bytes), bytes, size: bytes.length }];
}

/* ---------- targets ---------- */
const TARGETS = {
  "webkit-desktop": { b: webkit, opts: { viewport: { width: 1280, height: 800 } } },
  "webkit-iphone": { b: webkit, opts: { ...devices["iPhone 15"] }, phone: true },
  // Firefox saves a WebP and then opens it in a new tab by default (WebP is "viewable internally"); after that tab,
  // Playwright actions on the first page stall in headless Firefox. The pref keeps it a plain download here.
  "firefox-desktop": { b: firefox, opts: { viewport: { width: 1280, height: 800 }, firefoxUserPrefs: { "browser.download.viewableInternally.enabledTypes": "xml,svg" } } },
};
const wantB = arg("--browser", "all"), wantD = arg("--device", "all");
const run = Object.entries(TARGETS).filter(([k]) => (wantB === "all" || k.startsWith(wantB)) && (wantD === "all" || k.endsWith(wantD)));

async function target(name, t, base) {
  const ctx = await t.b.launchPersistentContext(mkdtempSync(join(tmp, name + "-")), { ...t.opts, acceptDownloads: true });
  const p = ctx.pages()[0] || await ctx.newPage();
  const errors = [], votes = [], requested = [], vtWarn = [];
  let offlineNow = false; // offline, the network-only requests (count, version, ad beacon) fail and WebKit logs each one
  // Console errors and exceptions fail a check (warnings do not; the 404 page logs its own 404).
  // landing() catches a failed View Transition with a warning: those are collected too.
  p.on("console", (m) => { if (m.type() === "warning" && /transition/i.test(m.text())) vtWarn.push(m.text().slice(0, 160)); });
  p.on("console", (m) => { if (m.type() === "error" && !(offlineNow && /Failed to load/.test(m.text()) && /\/(api|go)\/|\/version\.txt/.test(m.location()?.url || "")) && !(/404/.test(m.text()) && /\/nope-/.test(m.location()?.url || p.url()))) errors.push("console: " + m.text().slice(0, 200) + " " + (m.location()?.url || "").replace(/^https?:..[^/]+/, "")); });
  p.on("pageerror", (e) => errors.push("exception: " + e.message.slice(0, 200)));
  ctx.on("request", (r) => {
    requested.push(r.url());
    if (/\/api\/crash$/.test(r.url())) errors.push("crash report: " + (r.postData() || "").slice(0, 200));
    if (/\/api\/rate$/.test(r.url())) try { votes.push(JSON.parse(r.postData())); } catch {}
  });
  await p.addInitScript(() => {
    window.__csp = []; addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
    // Did the landing View Transition run and finish?
    const vt = Document.prototype.startViewTransition;
    if (vt) Document.prototype.startViewTransition = function (...a) { const t = vt.apply(this, a); window.__vt = "started"; t.finished.then(() => (window.__vt = "finished"), (e) => (window.__vt = "failed: " + e)); return t; };
  });
  if (t.phone) await p.addInitScript(SHARE_STUB);
  const clean = async (what) => {
    assert(!errors.length, `${errors.length} error(s) ${what}: ${errors.slice(0, 3).join(" | ")}`);
    const csp = await p.evaluate("window.__csp").catch(() => []);
    assert(!csp?.length, "CSP violations: " + csp.join(", "));
  };
  const app = (q = "") => `${base}/?adtest=1&adpartner=zazzle&confetti=0${q}`;
  const pre = `${name}: `;
  const isWebKit = t.b === webkit;

  await check(pre + "empty page, cross-origin isolated", async () => {
    await p.goto(app());
    await p.waitForSelector("#hero", { state: "visible" });
    const env = await p.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer === "function", vt: !!document.startViewTransition }));
    assert(env.coi && env.sab, "not cross-origin isolated: threads would be off");
    await sleep(500); await clean("on load");
    return `View Transitions: ${env.vt ? "yes" : "no"}`;
  });

  await check(pre + "first photo: View Transition to the grid, cut-out, Download", async () => {
    await addPhotos(p, ["one"]);
    await p.waitForFunction(() => document.body.classList.contains("has-work") && document.querySelector("#hero h1").getBoundingClientRect().height <= 1, null, { timeout: 5000 });
    await allDone(p, 1, 180000);
    const [f] = await save(t, p, () => p.click("#grid > .card .dl"));
    assert(f.kind === "png", "got " + f.kind); assert(f.name === "one-goodbye-bg.png", "name " + f.name);
    assert(f.bytes[25] === 6, "PNG has no alpha");
    const n = votes.length; await p.click("#grid > .card .rate");
    for (let i = 0; i < 40 && votes.length === n; i++) await sleep(50);
    const engine = votes.at(-1)?.engine;
    if (t.phone) assert(engine === "cpu", "iPhone should use the CPU engine, got " + engine);
    assert(!vtWarn.length, "View Transition failed: " + vtWarn[0]);
    const vt = await p.evaluate("window.__vt || 'not used'");
    assert(!/^failed/.test(vt), "View Transition " + vt);
    await clean("while working");
    return `engine ${engine}, ${(f.size / 1024).toFixed(0)} KB, View Transition ${vt}`;
  });

  await check(pre + "3D ad cards drawn (WebGL)", async () => {
    await p.waitForFunction(() => document.querySelectorAll("#grid > .adcard").length === 3 && [...document.querySelectorAll("#grid > .adcard")].every((a) => !a.classList.contains("loading")), null, { timeout: 20000 });
    await sleep(1500); // a failed drawing reports itself (3d-failed, ad-failed)
    await clean("drawing ads");
    const gl = await p.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    return gl ? "WebGL2" : "no WebGL2 (2D fallback)";
  });

  await check(pre + "background picker: White gives a JPG; colour input", async () => {
    await p.click("#grid > .card .bgb");
    await p.waitForSelector(":is(#grid > .card, #dock) .bgs:not([hidden])");
    await onPage(p, `:is(#grid > .card, #dock) .bgs [data-bg="#ffffff"]`);
    await p.click(`:is(#grid > .card, #dock) .bgs [data-bg="#ffffff"]`);
    await p.waitForFunction(() => document.querySelector("#grid > .card").classList.contains("solid"));
    const [f] = await save(t, p, () => p.click("#grid > .card .dl"));
    assert(f.kind === "jpg" && f.name === "one-goodbye-bg.jpg", `${f.name} ${f.kind}`);
    await p.click("#grid > .card .bgb");
    await onPage(p, ":is(#grid > .card, #dock) .bgs .custom");
    await p.locator(":is(#grid > .card, #dock) .bgs input[type=color]").fill("#ff0000"); // input + change, as the system picker does
    await p.waitForFunction(() => document.querySelector("#grid > .card .bgb").getAttribute("aria-label") === "Background: #ff0000", null, { timeout: 3000 });
  });

  await check(pre + "options row: Square, WebP only where it encodes, 16 px on touch", async () => {
    await p.click("#grid > .card .bgb");
    await onPage(p, ":is(#grid > .card, #dock) .bgs .more");
    await p.click(":is(#grid > .card, #dock) .bgs .more");
    await p.waitForSelector(":is(#grid > .card, #dock) .opts:not([hidden])");
    const st = await p.evaluate(() => {
      const o = document.querySelector(":is(#grid > .card, #dock) .opts"), w = o.querySelector(".owebp");
      return { webpShown: !w.hidden, fs: [...o.querySelectorAll("select, input")].map((e) => parseFloat(getComputedStyle(e).fontSize)),
        h: o.getBoundingClientRect().height, bar: o.parentElement.getBoundingClientRect().height, sel: getComputedStyle(o.querySelector("select")).width };
    });
    const canWebp = !isWebKit;
    assert(st.webpShown === canWebp, `WebP button ${st.webpShown ? "shown" : "hidden"}; this browser ${canWebp ? "encodes" : "cannot encode"} WebP`);
    if (t.phone) assert(st.fs.every((x) => x >= 16), "under 16 px on a phone (iOS zooms on focus): " + st.fs.join(", "));
    await p.selectOption(":is(#grid > .card, #dock) .osize select", "1:1");
    if (canWebp) { await onPage(p, ":is(#grid > .card, #dock) .owebp"); await p.click(":is(#grid > .card, #dock) .owebp"); }
    await p.mouse.click(5, 5); // close the row (phones build the file then)
    const [f] = await save(t, p, () => p.click("#grid > .card .dl"));
    const want = canWebp ? "webp" : "jpg";
    assert(f.kind === want && f.name === "one-goodbye-bg." + want, `${f.name} ${f.kind}`);
    return `fonts ${[...new Set(st.fs)].join("/")} px, select ${st.sel}, ${f.name}${f.opened ? " (saved, then opened in a new tab)" : ""}`;
  });

  await check(pre + "batch of 3 and Download all", async () => {
    await addPhotos(p, ["two", "three"]);
    await allDone(p, 3, 240000);
    await p.waitForSelector("#tools:not([hidden])", { timeout: 5000 }).catch(async (e) => { throw new Error(e.message.split("\n")[0] + " " + JSON.stringify(await p.evaluate(() => ({ hidden: document.getElementById("tools").hidden, vis: document.visibilityState, rect: document.getElementById("tools").getBoundingClientRect().toJSON(), pages: 0 })))); });
    const files = await save(t, p, () => p.click("#all"), 120000);
    let names;
    if (t.phone) names = files.map((f) => f.name).sort();
    else { assert(files[0].kind === "zip", "got " + files[0].kind); names = Object.keys(unzipSync(new Uint8Array(files[0].bytes))).sort(); }
    const ext1 = isWebKit ? "jpg" : "webp";
    const want = [`one-goodbye-bg.${ext1}`, "three-goodbye-bg.png", "two-goodbye-bg.png"];
    assert(JSON.stringify(names) === JSON.stringify(want), "got " + names.join(", "));
    await clean("in the batch");
    return names.join(", ");
  });

  await check(pre + "tell(): a bubble for a broken ZIP", async () => {
    await p.locator("#file").setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04 not really a zip") });
    await p.waitForSelector("#tell:not([hidden])", { timeout: 4000 });
    const r = await p.evaluate(() => { const b = document.getElementById("tell").getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, text: document.getElementById("tell").textContent, w: innerWidth, h: innerHeight }; });
    assert(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, `bubble off screen: ${JSON.stringify(r)}`);
    return `"${r.text}"`;
  });

  await check(pre + "reload: kept photos come back (IndexedDB)", async () => {
    await sleep(1500); // the last writes
    await p.reload();
    await allDone(p, 3, 30000);
    const st = await p.evaluate(() => ({ names: [...document.querySelectorAll("#grid > .card")].map((c) => c.getAttribute("aria-label")), bg: document.querySelector("#grid > .card .bgb")?.getAttribute("aria-label") }));
    assert(st.names.length === 3, "cards: " + st.names.join(", "));
    await clean("after the reload");
    return st.names.join(", ") + "; " + st.bg;
  });

  await check(pre + "remove, undo pill, reload", async () => {
    await p.click("#grid > .card:nth-child(2) .x");
    await p.waitForSelector("#undo:not([hidden])", { timeout: 3000 });
    const pill = await p.evaluate(() => { const b = document.getElementById("undo").getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; });
    assert(pill, "undo pill off screen");
    await p.click("#undobtn");
    await p.waitForFunction(() => document.querySelectorAll("#grid > .card").length === 3, null, { timeout: 3000 });
    await p.click("#grid > .card:nth-child(1) .x");
    await p.waitForFunction(() => document.querySelectorAll("#grid > .card").length === 2, null, { timeout: 3000 });
    await sleep(7000); // the pill runs out, then the copy is deleted
    await p.reload();
    await allDone(p, 2, 30000);
  });

  await check(pre + "offline (service worker): reload, isolated, kept photos, a new photo", async () => {
    await p.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20000 });
    await p.waitForFunction(async () => { const k = await caches.keys(); const m = k.filter((n) => n.startsWith("gb-m-")); if (!k.some((n) => n.startsWith("gb-shell-")) || !m.length) return false; for (const n of m) if ((await (await caches.open(n)).keys()).length >= 5) return true; return false; }, null, { timeout: 90000, polling: 500 });
    await sleep(1000);
    await ctx.setOffline(true); offlineNow = true;
    try {
      await p.reload();
      await allDone(p, 2, 30000);
      assert(await p.evaluate("crossOriginIsolated"), "not cross-origin isolated offline (no threads)");
      await addPhotos(p, ["offline"]);
      await allDone(p, 3, 180000);
      await clean("offline");
    } finally { await ctx.setOffline(false); await sleep(500); offlineNow = false; }
    return "caches: " + (await p.evaluate("caches.keys()")).join(", ");
  });

  await check(pre + "HEIC", async () => {
    const heic = join(tmp, "photo.heic");
    if (!existsSync(heic)) return { skip: "no sips (macOS) to make a HEIC" };
    requested.length = 0;
    await p.locator("#file").setInputFiles(heic);
    await allDone(p, 4, 180000);
    const viaWasm = requested.some((u) => /formats\.mjs|libheif/.test(u));
    // Safari opens HEIC itself; the libheif worker is for the others.
    if (isWebKit) assert(!viaWasm, "WebKit fetched the HEIC decoder; it should open HEIC itself");
    return viaWasm ? "decoded by libheif (formats.mjs)" : "opened natively";
  });

  await check(pre + "animated GIF stays animated", async () => {
    await p.locator("#file").setInputFiles({ name: "wave.gif", mimeType: "image/gif", buffer: gifBytes() });
    await allDone(p, 5, 180000);
    await p.waitForFunction(() => document.querySelector("#grid > .card img")?.src.startsWith("blob:"), null, { timeout: 5000 });
    const [f] = await save(t, p, () => p.click("#grid > .card .dl"));
    assert(f.kind === "gif" && f.name === "wave-goodbye-bg.gif", `${f.name} ${f.kind}`);
    if (t.phone) return "shared as a GIF";
    const n = gifFrames(f.bytes); assert(n >= 3, `${n} frame(s)`);
    return `${n} frames`;
  });

  if (!t.phone && isWebKit) await check(pre + "CPU engine (?engine=cpu)", async () => {
    const q = await ctx.newPage();
    await q.goto(app("&engine=cpu"));
    await addPhotos(q, ["cpu"]);
    await allDone(q, 6, 180000); // 5 kept + 1 new
    const n = votes.length; await q.click("#grid > .card .rate");
    for (let i = 0; i < 40 && votes.length === n; i++) await sleep(50);
    assert(votes.at(-1)?.engine === "cpu", "engine " + votes.at(-1)?.engine);
    await q.close();
  });

  await check(pre + "404 and SEO pages", async () => {
    const notes = [];
    const translated = ["de", "es", "fr", "pt-br", "id"].flatMap((l) => [[`/${l}/remove-bg-alternative/`, 200], [`/${l}/how-to-remove-background/`, 200]]);
    for (const [path, code] of [["/nope-" + Date.now(), 404], ["/remove-bg-alternative/", 200], ["/how-to-remove-background/", 200], ...translated]) {
      const r = await p.goto(base + path);
      assert(r.status() === code, `${path}: ${r.status()}`);
      const st = await p.evaluate(() => ({ font: document.fonts.check("16px Nunito"), h1: document.querySelector("h1")?.textContent, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
      assert(st.h1, path + ": no h1"); assert(!st.overflow, path + ": sideways scroll");
      if (!/^\/(de|es|fr|pt-br|id)\//.test(path)) notes.push(`${path.split("/")[1].slice(0, 12)} ${st.font ? "Nunito" : "system font"}`);
    }
    await clean("on the text pages");
    return notes.join(", ") + `, ${translated.length} translated`;
  });

  // A browser set to German gets the app in German (src/i18n.js, picked in early.js).
  await check(pre + "German browser: German page", async () => {
    const c2 = await t.b.launchPersistentContext(mkdtempSync(join(tmp, name + "-de-")), { ...t.opts, locale: "de-DE" });
    const q = c2.pages()[0] || await c2.newPage();
    const errs = []; q.on("pageerror", (e) => errs.push(e.message));
    await q.goto(base + "/?confetti=0");
    const st = await q.evaluate(() => ({ lang: document.documentElement.lang, pick: document.getElementById("pick").textContent,
      h1: document.querySelector("h1").textContent, langs: navigator.languages.join(), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
    await c2.close();
    assert(st.lang === "de" && st.pick === "Fotos wählen" && st.h1 === "Tschüss,Hintergrund.", `not German: ${JSON.stringify(st)}`);
    assert(!st.wide && !errs.length, `sideways scroll ${st.wide}, errors ${errs.join(" | ")}`);
  });

  await ctx.close();
}

// A private window: WebKit's ephemeral context refuses Blobs in IndexedDB. The photo must still work, quietly.
async function privateWindow(base) {
  await check("webkit-private: a photo works with nothing kept", async () => {
    const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(`${base}/?confetti=0&engine=cpu`);
    await addPhotos(p, ["private"]);
    await allDone(p, 1, 180000);
    await p.reload(); await sleep(1500);
    const n = await p.evaluate(`${CARDS}.length`);
    await b.close();
    assert(!errors.length, errors.slice(0, 2).join(" | "));
    return `${n} card(s) after a reload (nothing kept)`;
  });
}

try {
  if (!process.argv.includes("--no-build")) execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  const port = await freePort();
  // Started again if it dies (other sessions on this Mac have stopped every serve.mjs mid-run).
  const serve = () => { const s = spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PORT: String(port) } }); procs.push(s); s.on("exit", () => { if (!stopping) { console.log("      (server stopped from outside; started again)"); setTimeout(serve, 100); } }); };
  serve();
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) { try { await fetch(base + "/version.txt"); break; } catch { await sleep(100); } }
  // A HEIC to add, made with macOS's sips from a JPEG drawn here.
  try {
    const jpg = join(tmp, "photo.jpg");
    const b = await webkit.launch(); const p = await b.newPage();
    const b64 = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 1000; const x = c.getContext("2d"); x.fillStyle = "#9bc"; x.fillRect(0, 0, 800, 1000); x.fillStyle = "#2050c0"; x.beginPath(); x.ellipse(400, 560, 230, 330, 0, 0, 7); x.fill(); x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(400, 220, 130, 0, 7); x.fill(); return c.toDataURL("image/jpeg", 0.9).split(",")[1]; });
    await b.close();
    writeFileSync(jpg, Buffer.from(b64, "base64"));
    execFileSync("sips", ["-s", "format", "heic", jpg, "--out", join(tmp, "photo.heic")], { stdio: "ignore" });
  } catch {}
  for (const [name, t] of run) await target(name, t, base);
  if (wantB !== "firefox" && wantD !== "iphone") await privateWindow(base);
} catch (e) {
  console.log("FAIL  " + (e?.message || e));
  results.push({ status: "FAIL" });
} finally {
  cleanup();
  const bad = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.length - bad} of ${results.length} passed or skipped`);
  process.exit(bad ? 1 : 0);
}
