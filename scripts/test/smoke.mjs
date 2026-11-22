// Smoke tests: build, serve dist/ with scripts/serve.mjs, drive headless Chrome over the DevTools protocol.
// No test framework, no puppeteer: Node's own fetch and WebSocket talk to Chrome.
//
//   npm run test                 build, then run everything (about a minute and a half on an M-series Mac)
//   node scripts/test/smoke.mjs --no-build      reuse dist/
//   CHROME=/path/to/chrome npm run test         another Chrome
//
// Each check prints PASS, FAIL or SKIP; the exit code is 1 when any check fails.
// Note: scripts/serve.mjs passes /api/count through to the live site, so each cut-out here adds one to the
// public count (Kevin: tests count). Nothing else reaches production; ad cards are never clicked.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { zipSync, unzipSync } from "fflate";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = new URL("../..", import.meta.url).pathname;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tmp = mkdtempSync(join(tmpdir(), "goodbye-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const procs = [];

/* ---------- results ---------- */
const results = [];
async function check(name, fn, needs = []) {
  const failed = needs.find((n) => results.find((r) => r.name === n && r.status !== "PASS"));
  if (failed) { report(name, "FAIL", 0, `skipped: "${failed}" did not pass`); return false; }
  const s = Date.now();
  try {
    const note = await fn();
    if (note && typeof note === "object" && note.skip) { report(name, "SKIP", Date.now() - s, note.skip); return false; }
    report(name, "PASS", Date.now() - s, note || "");
    return true;
  } catch (e) {
    report(name, "FAIL", Date.now() - s, e?.message || String(e));
    return false;
  }
}
function report(name, status, ms, note) {
  results.push({ name, status });
  console.log(`${status.padEnd(4)}  ${name}${ms ? ` (${(ms / 1000).toFixed(1)} s)` : ""}${note ? `  ${note}` : ""}`);
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

/* ---------- fixtures ---------- */
// A tiny PNG encoder (RGB, no filter), enough for test photos inside a ZIP.
function pngBytes(w, h, px) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// A subject the model keeps: a red body with a skin-coloured head on a soft grey-blue gradient.
const figure = (w, h, dx = 0) => (x, y) => {
  const cx = w / 2 + dx, inBody = ((x - cx) / (w * 0.28)) ** 2 + ((y - h * 0.62) / (h * 0.3)) ** 2 < 1, inHead = (x - cx) ** 2 + (y - h * 0.24) ** 2 < (w * 0.15) ** 2;
  if (inHead) return [240, 200, 160];
  if (inBody) return [192, 48, 42];
  const t = (x + y) / (w + h); return [216 - 80 * t, 232 - 70 * t, 240 - 70 * t];
};
function gifBytes() {
  const W = 240, H = 240, enc = GIFEncoder();
  for (let f = 0; f < 3; f++) {
    const rgba = new Uint8ClampedArray(W * H * 4), px = figure(W, H, (f - 1) * 30);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = px(x, y); rgba.set([r, g, b, 255], (y * W + x) * 4); }
    const pal = quantize(rgba, 64); enc.writeFrame(applyPalette(rgba, pal), W, H, { palette: pal, delay: 150 });
  }
  enc.finish(); return Buffer.from(enc.bytes());
}
const fx = join(tmp, "fixtures"); mkdirSync(fx);
writeFileSync(join(fx, "wave.gif"), gifBytes());
writeFileSync(join(fx, "pair.zip"), zipSync({ "b-second.png": pngBytes(320, 400, figure(320, 400)), "a-first.png": pngBytes(320, 400, figure(320, 400, 20)), "__MACOSX/._a-first.png": new Uint8Array(10) }));

// What a downloaded file is.
const magic = (b) => b.subarray(0, 4).toString("hex");
const kind = (b) => (magic(b) === "89504e47" ? "png" : magic(b).startsWith("ffd8ff") ? "jpg" : magic(b) === "504b0304" ? "zip" : b.subarray(0, 3).toString() === "GIF" ? "gif" : magic(b) === "52494646" && b.subarray(8, 12).toString() === "WEBP" ? "webp" : "?" + magic(b));
const gifFrames = (b) => { let n = 0; for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) n++; return n; }; // graphic control extensions

/* ---------- server and Chrome ---------- */
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: root, stdio: opts.stdio || "ignore", env: { ...process.env, ...opts.env } });
  procs.push(p); return p;
}
function cleanup() { for (const p of procs) try { p.kill("SIGKILL"); } catch {} try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
process.on("SIGINT", () => { cleanup(); process.exit(130); });

let browser; // { send, on }
async function startChrome() {
  const port = await freePort();
  run(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmp, "chrome")}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio", "--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "about:blank"]);
  let ver;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  assert(ver, `Chrome did not start (${CHROME}); set CHROME=`);
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", no, { once: true }); });
  let id = 0; const pending = new Map(), listeners = new Set();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.no(new Error(`${p.method}: ${d.error.message}`)) : p.ok(d.result); }
    else for (const l of listeners) l(d);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++id; pending.set(i, { ok, no, method }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  browser = { send, on: (f) => (listeners.add(f), () => listeners.delete(f)), ws };
}

// A fresh browser context (its own storage, like a new visitor) with downloads going to a folder of its own.
async function context() {
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const dir = join(tmp, "dl-" + browserContextId.slice(0, 8)); mkdirSync(dir);
  await browser.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true, browserContextId });
  return { id: browserContextId, dir };
}

// Installed before any page script on every load: layout shifts and CSP violations.
const OBSERVE = `
  window.__ls = []; window.__csp = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push(+e.value.toFixed(5)); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
`;

async function page(ctx, { w = 1280, h = 800, dark = false, mobile = false } = {}) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: ctx.id });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => browser.send(m, p, sessionId);
  const errors = [], votes = [];
  browser.on((d) => {
    if (d.sessionId !== sessionId) return;
    if (d.method === "Network.requestWillBeSent" && /\/api\/rate$/.test(d.params.request.url)) try { votes.push(JSON.parse(d.params.request.postData)); } catch {}
    if (d.method === "Network.requestWillBeSent" && /\/api\/crash$/.test(d.params.request.url)) errors.push("crash report: " + (d.params.request.postData || "").slice(0, 200));
    if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split("\n")[0]);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push("log: " + d.params.entry.text.slice(0, 200) + (d.params.entry.url ? " " + d.params.entry.url : ""));
  });
  await s("Page.enable"); await s("Runtime.enable"); await s("Log.enable"); await s("Network.enable");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
  await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  const p = {
    s, errors, votes, targetId,
    async go(url) { await s("Page.navigate", { url }); await p.until("document.readyState === 'complete'", 20000); },
    async reload() { await s("Page.reload", {}); await sleep(200); await p.until("document.readyState === 'complete'", 20000); },
    async ev(expr) {
      const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("in page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split("\n")[0]);
      return r.result.value;
    },
    async until(expr, ms = 30000, what = expr) {
      const end = Date.now() + ms;
      for (;;) {
        let v; try { v = await p.ev(expr); } catch {}
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}`);
        await sleep(100);
      }
    },
    async files(paths) {
      const { root: doc } = await s("DOM.getDocument", {});
      const { nodeId } = await s("DOM.querySelector", { nodeId: doc.nodeId, selector: "#file" });
      await s("DOM.setFileInputFiles", { nodeId, files: paths });
    },
    close: () => browser.send("Target.closeTarget", { targetId }),
  };
  return p;
}

// Runs fn (which clicks something) and returns the file it downloads.
async function download(ctx, fn, ms = 30000) {
  let guid, name, done, failed;
  const off = browser.on((d) => {
    if (d.method === "Browser.downloadWillBegin" && !guid) { guid = d.params.guid; name = d.params.suggestedFilename; }
    if (d.method === "Browser.downloadProgress" && d.params.guid === guid) { if (d.params.state === "completed") done = true; if (d.params.state === "canceled") failed = true; }
  });
  try {
    await fn();
    const end = Date.now() + ms;
    while (!done && !failed && Date.now() < end) await sleep(50);
    assert(done, failed ? "download canceled" : guid ? "download did not finish" : "no download started");
    const bytes = readFileSync(join(ctx.dir, guid));
    return { name, bytes, kind: kind(bytes) };
  } finally { off(); }
}

// Adds n JPEG photos made in the page (a figure on a gradient), through the real file input's change event.
const addPhotos = (p, names) => p.ev(`(async () => {
  const dt = new DataTransfer();
  for (const [k, name] of ${JSON.stringify(names)}.entries()) {
    const c = document.createElement("canvas"); c.width = 900 + k * 40; c.height = 1200; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 900, 1200); g.addColorStop(0, "#d8e8f0"); g.addColorStop(1, "#8aa"); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = ["#c0302a", "#2050c0", "#20a040", "#e0b020"][k % 4]; x.beginPath(); x.ellipse(450, 650, 260, 380, 0, 0, 7); x.fill();
    x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(450, 260, 150, 0, 7); x.fill();
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)); dt.items.add(new File([b], name + ".jpg", { type: "image/jpeg" }));
  }
  const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);
const CARDS = `[...document.querySelectorAll("#grid > .card")]`;
// Which engine made a card's cut-out: 👍 sends it to /api/rate (local; serve.mjs doesn't pass it on).
async function engineOf(p, sel = "#grid > .card") {
  const n = p.votes.length;
  await click(p, `${sel} .rate`);
  for (let i = 0; i < 50 && p.votes.length === n; i++) await sleep(50);
  assert(p.votes.length > n, "👍 sent no vote");
  return p.votes.at(-1).engine;
}
// All n cards finished (Download on); a failed card ends the wait at once.
const allDone = (p, n, ms = 60000) => p.until(`(() => { const c = ${CARDS};
  if (c.some((x) => x.classList.contains("failed"))) throw new Error("failed card");
  return c.length === ${n} && c.every((x) => !x.querySelector(".dl").disabled && !x.classList.contains("working") && !x.classList.contains("queued"));
})()`, ms, `${n} finished card(s)`).catch(async (e) => {
  const failed = await p.ev(`${CARDS}.filter((x) => x.classList.contains("failed")).map((x) => x.innerText.replace(/\\s+/g, " ")).join(" | ")`).catch(() => "");
  throw new Error(failed ? `a card failed: ${failed}` : e.message);
});
const names = (p) => p.ev(`${CARDS}.map((c) => c.getAttribute("aria-label"))`);
// Everything the page wrote to IndexedDB: states in grid order.
// Never opens a database the app hasn't made (that would create an empty one the app can't upgrade).
const KEPT = `indexedDB.databases().then((l) => l.some((d) => d.name === "goodbye-bg")).then((has) => !has ? [] : new Promise((ok) => { const r = indexedDB.open("goodbye-bg"); r.onerror = () => ok([]);
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("state")) return ok([]);
    const q = db.transaction("state").objectStore("state").getAll(); q.onsuccess = () => { db.close(); ok(q.result.map((s) => ({ name: s.name, bg: s.bg, out: s.out || null, mask: !!s.mask, anim: s.anim }))); }; q.onerror = () => ok([]); }; }))`;
const kept = (p) => p.ev(KEPT);
const noErrors = (p, allow = []) => {
  const bad = p.errors.filter((e) => !allow.some((a) => a.test(e)));
  assert(!bad.length, `${bad.length} error(s): ${bad.slice(0, 3).join(" | ")}`);
};
const cspClean = async (p) => { const v = await p.ev("window.__csp"); assert(!v?.length, "CSP violations: " + v.join(", ")); };
const click = (p, sel) => p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("no ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);

/* ---------- the checks ---------- */
let base, engine;
try {
  if (!process.argv.includes("--no-build")) {
    const b = run(process.execPath, ["scripts/build.mjs"], { stdio: ["ignore", "ignore", "inherit"] });
    const code = await new Promise((ok) => b.on("exit", ok));
    if (code) { console.log("FAIL  build"); process.exit(1); }
  }
  const port = await freePort();
  run(process.execPath, ["scripts/serve.mjs"], { env: { PORT: String(port) } });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) { try { await fetch(base + "/version.txt"); break; } catch { await sleep(100); } }
  await startChrome();

  await check("build: placeholders filled in", () => {
    const app = readFileSync(join(root, "dist/app.js"), "utf8"), eng = readFileSync(join(root, "dist/engine.js"), "utf8");
    for (const [f, s, ph] of [["app.js", app, '"%PARTNERS%"'], ["app.js", app, "%BUILD%"], ["app.js", app, "%ENGINE%"], ["engine.js", eng, "%ORT%"], ["engine.js", eng, "%BIREFNET%"]]) assert(!s.includes(ph), `${ph} left in dist/${f}`);
  });

  await check("basics: headers (CSP, COOP/COEP)", async () => {
    const r = await fetch(base + "/");
    const csp = r.headers.get("content-security-policy") || "";
    assert(/connect-src 'self'(;|$)/.test(csp) && /default-src 'self'/.test(csp) && /script-src 'self' 'wasm-unsafe-eval'(;|$)/.test(csp), "CSP missing or widened: " + csp);
    assert(r.headers.get("cross-origin-embedder-policy") === "require-corp" && r.headers.get("cross-origin-opener-policy") === "same-origin", "COOP/COEP missing");
  });

  // One fresh visitor for the main run: photo -> background -> batch -> zip -> reload -> remove/undo.
  const ctx = await context();
  const p = await page(ctx);

  await check("basics: empty page loads clean", async () => {
    await p.go(base + "/");
    await p.until(`document.getElementById("pick") && getComputedStyle(document.getElementById("hero")).display !== "none"`, 10000, "the empty page");
    assert(await p.ev("crossOriginIsolated"), "not cross-origin isolated (threads need it)");
    assert(await p.ev(`document.querySelectorAll("#grid > .card").length === 0`), "cards on an empty page");
    await sleep(800);
    noErrors(p); await cspClean(p);
    const cls = (await p.ev("window.__ls")).reduce((a, b) => a + b, 0);
    assert(cls < 0.001, `layout shift on load: ${cls.toFixed(4)}`);
  });

  // GPU if this headless Chrome has WebGPU with shader-f16 (the app's own test), else the CPU engine for everything.
  const gpu = await p.ev(`(async () => { try { const a = await navigator.gpu?.requestAdapter(); return !!a && a.features.has("shader-f16"); } catch { return false; } })()`).catch(() => false);
  engine = gpu ? "gpu" : "cpu";
  console.log(`      (engine for the main run: ${engine}${gpu ? "" : ", no WebGPU in this headless Chrome"})`);
  const app = (q = "") => `${base}/?engine=${engine}&adtest=1&adpartner=zazzle&confetti=0${q}`;

  await check(`one photo (${engine}): result and PNG download`, async () => {
    await p.go(app());
    await addPhotos(p, ["one"]);
    await allDone(p, 1, 90000);
    await p.until(`document.querySelector("#grid > .card img")?.complete && document.querySelector("#grid > .card img").naturalWidth > 0 || document.querySelector("#grid > .card canvas")?.width > 0`, 10000, "the cut-out drawn");
    const f = await download(ctx, () => click(p, "#grid > .card .dl"));
    assert(f.kind === "png", `got ${f.kind}`); assert(f.name === "one-goodbye-bg.png", "file name " + f.name);
    // The cut-out has see-through pixels: PNG colour type 6 (RGBA).
    assert(f.bytes[25] === 6, "PNG has no alpha channel");
    const e = await engineOf(p), want = engine === "gpu" ? /^gpu/ : /^cpu$/;
    assert(want.test(e), `ran on ${e}`);
    return `${f.name}, ${(f.bytes.length / 1024).toFixed(0)} KB, engine ${e}`;
  });

  await check("ads: cards fill the free cells (?adtest=1)", async () => {
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 3`, 15000, "3 ad cards next to 1 photo");
    await p.until(`[...document.querySelectorAll("#grid > .adcard")].every((a) => !a.classList.contains("loading") && a.getBoundingClientRect().width > 50)`, 15000, "ad cards drawn");
    const labels = await p.ev(`[...document.querySelectorAll("#grid > .adcard")].map((a) => a.getAttribute("aria-label").split(":")[0])`);
    assert(labels.every((l) => /^(Ad|Sponsored)$/.test(l)), "ad label: " + labels.join(", "));
    await sleep(1000); // a failed product drawing reports itself (ad-failed, mug-failed, 3d-failed)
    noErrors(p);
  }, [`one photo (${engine}): result and PNG download`]);

  await check("background picker: White gives a JPG", async () => {
    await click(p, "#grid > .card .bgb");
    await p.until(`!document.querySelector("#grid > .card .bgs").hidden`, 3000, "the picker open");
    await click(p, `#grid > .card .bgs [data-bg="#ffffff"]`);
    await p.until(`document.querySelector("#grid > .card").classList.contains("solid")`, 3000, "the card on white");
    const f = await download(ctx, () => click(p, "#grid > .card .dl"));
    assert(f.kind === "jpg", `got ${f.kind}`); assert(f.name === "one-goodbye-bg.jpg", "file name " + f.name);
    return f.name;
  }, [`one photo (${engine}): result and PNG download`]);

  await check("batch: 3 photos and Download all (zip names)", async () => {
    await addPhotos(p, ["two", "three"]);
    await allDone(p, 3, 120000);
    const order = await names(p);
    assert(order.length === 3, "cards: " + order.join(", "));
    await p.until(`!document.getElementById("tools").hidden`, 5000, "Download all shown");
    const f = await download(ctx, () => click(p, "#all"), 60000);
    assert(f.kind === "zip", `got ${f.kind}`);
    const entries = Object.keys(unzipSync(new Uint8Array(f.bytes))).sort();
    const want = ["one-goodbye-bg.jpg", "three-goodbye-bg.png", "two-goodbye-bg.png"];
    assert(JSON.stringify(entries) === JSON.stringify(want), "zip holds " + entries.join(", "));
    assert(f.name === "goodbye-bg-3-images.zip", "zip name " + f.name);
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 1`, 10000, "1 ad card next to 3 photos");
    return `${f.name}: ${entries.join(", ")}`;
  }, ["background picker: White gives a JPG"]);

  await check("reload: kept photos come back, CLS 0", async () => {
    await p.until(`(${KEPT}).then((k) => k.length === 3 && k.every((s) => s.mask))`, 15000, "3 photos kept in IndexedDB").catch(async (e) => {
      throw new Error(e.message + ": " + JSON.stringify(await kept(p)));
    });
    const before = await names(p);
    p.errors.length = 0;
    await p.reload();
    await allDone(p, 3, 15000);
    await sleep(1500); // the ads and the footer settle
    const after = await names(p);
    assert(JSON.stringify(after) === JSON.stringify(before), `order ${before} -> ${after}`);
    const white = await p.ev(`${CARDS}.find((c) => c.getAttribute("aria-label") === "one").querySelector(".bgb").getAttribute("aria-label")`);
    assert(white === "Background: White", "background of 'one' after reload: " + white);
    const ls = await p.ev("window.__ls"), cls = ls.reduce((a, b) => a + b, 0);
    assert(cls < 0.001, `CLS ${cls.toFixed(4)} (${ls.join(", ")})`);
    noErrors(p); await cspClean(p);
    return `CLS ${cls.toFixed(4)}`;
  }, ["batch: 3 photos and Download all (zip names)"]);

  await check("removal: Remove, Undo puts it back in place", async () => {
    const before = await names(p);
    await click(p, "#grid > .card:nth-of-type(2) .x");
    await p.until(`document.querySelectorAll("#grid > .card").length === 2 && !document.getElementById("undo").hidden`, 3000, "card gone, undo pill shown");
    await click(p, "#undobtn");
    await p.until(`document.querySelectorAll("#grid > .card").length === 3 && document.getElementById("undo").hidden`, 3000, "card back, pill gone");
    const after = await names(p);
    assert(JSON.stringify(after) === JSON.stringify(before), `order ${before} -> ${after}`);
    // Undone removal is kept again: it survives a reload.
    await p.until(`(${KEPT}).then((k) => k.length === 3)`, 10000, "3 photos kept again");
    await p.reload(); await allDone(p, 3, 15000);
    assert(JSON.stringify(await names(p)) === JSON.stringify(before), "order after reload: " + (await names(p)));
  }, ["reload: kept photos come back, CLS 0"]);

  await check("removal: a removed photo stays gone after a reload", async () => {
    const before = await names(p);
    await click(p, "#grid > .card:nth-of-type(1) .x");
    await p.until(`document.querySelectorAll("#grid > .card").length === 2`, 3000, "card gone");
    await sleep(500); // the delete is queued
    await p.reload(); await allDone(p, 2, 15000);
    const after = await names(p);
    assert(JSON.stringify(after) === JSON.stringify(before.slice(1)), `${before} -> ${after}`);
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 2`, 10000, "2 ad cards next to 2 photos");
  }, ["reload: kept photos come back, CLS 0"]);
  await p.close();

  // Formats, in a fresh visitor: an animated GIF stays animated, a ZIP opens into its photos (by name, no __MACOSX).
  const ctx2 = await context();
  const q = await page(ctx2);
  await check(`formats: animated GIF comes back animated (${engine})`, async () => {
    await q.go(app());
    await q.files([join(fx, "wave.gif")]);
    await allDone(q, 1, 90000);
    await q.until(`document.querySelector("#grid > .card img")?.src.startsWith("blob:")`, 5000, "the GIF on the card");
    const f = await download(ctx2, () => click(q, "#grid > .card .dl"));
    assert(f.kind === "gif", `got ${f.kind}`); assert(f.name === "wave-goodbye-bg.gif", "file name " + f.name);
    const n = gifFrames(f.bytes); assert(n >= 3, `${n} frame(s)`);
    assert(await q.ev(`getComputedStyle(document.querySelector("#grid > .card .bgb")).visibility === "hidden"`), "GIF card shows a background picker");
    return `${n} frames`;
  });
  await check("formats: a ZIP opens into its photos", async () => {
    await q.files([join(fx, "pair.zip")]);
    await allDone(q, 3, 90000);
    const n = await names(q);
    assert(n.includes("a-first") && n.includes("b-second") && n.indexOf("a-first") < n.indexOf("b-second"), "cards: " + n.join(", "));
    noErrors(q); await cspClean(q);
    return n.join(", ");
  });
  await q.close();


  // Output options (sellers): Square with a margin, a shadow, WebP, "All" for the other photo, kept over a reload.
  await check(`output: Square with a margin, All, WebP, reload (${engine})`, async () => {
    const c6 = await context(), o = await page(c6);
    await o.go(app());
    await addPhotos(o, ["sq1", "sq2"]);
    await allDone(o, 2, 120000);
    const card = (n) => `#grid > .card:nth-child(${n})`, row = (n) => `:is(${card(n)}, #dock)`; // a narrow card opens its rows in the dock
    const pickSel = (sel, v) => o.ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await click(o, `${card(1)} .bgb`);
    await click(o, `${row(1)} .bgs .more`);
    await o.until(`!document.querySelector("${row(1)} .opts").hidden`, 3000, "the options row open");
    await pickSel(`${row(1)} .osize select`, "1:1");
    await pickSel(`${row(1)} .omargin select`, "0.2");
    const f = await download(c6, () => click(o, `${card(1)} .dl`));
    assert(f.kind === "png" && f.name === "sq1-goodbye-bg.png", `${f.kind} ${f.name}`);
    const w = f.bytes.readUInt32BE(16), h = f.bytes.readUInt32BE(20);
    assert(w === h && w > 100, `not square: ${w} x ${h}`);
    // The margin is see-through all round (20% of the subject's longer side is 14% of the square), the middle is not.
    const a = await o.ev(`(async () => {
      const b = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(f.bytes.toString("base64"))}), (c) => c.charCodeAt(0))]));
      const c = new OffscreenCanvas(b.width, b.height), x = c.getContext("2d"); x.drawImage(b, 0, 0);
      const d = x.getImageData(0, 0, b.width, b.height).data, W = b.width, H = b.height, e = Math.floor(W * 0.1);
      let ring = 0;
      for (let i = 0; i < W; i += 3) for (const [px, py] of [[i, 0], [i, H - 1], [0, i], [W - 1, i], [i, e], [i, H - 1 - e], [e, i], [W - 1 - e, i]]) ring = Math.max(ring, d[(py * W + px) * 4 + 3]);
      return { ring, mid: d[((H >> 1) * W + (W >> 1)) * 4 + 3] };
    })()`);
    assert(a.ring === 0 && a.mid > 200, `margin alpha ${a.ring}, middle alpha ${a.mid}`);
    await click(o, `${row(1)} .oshadow`);
    await click(o, `${row(1)} .oall`);
    await o.until(`(${KEPT}).then((k) => k.length === 2 && k.every((s) => s.out && s.out.size === "1:1" && s.out.margin === 0.2 && s.out.shadow))`, 10000, "both kept as Square, 20%, shadow").catch(async (e) => {
      throw new Error(e.message + ": " + JSON.stringify(await kept(o)));
    });
    const g = await download(c6, () => click(o, `${card(2)} .dl`));
    assert(g.kind === "png" && g.bytes.readUInt32BE(16) === g.bytes.readUInt32BE(20), `second photo after All: ${g.kind} ${g.bytes.readUInt32BE(16)} x ${g.bytes.readUInt32BE(20)}`);
    let webp = "WebP not offered";
    if (await o.ev(`!document.querySelector("${row(1)} .owebp").hidden`)) {
      await click(o, `${row(1)} .owebp`);
      const v = await download(c6, () => click(o, `${card(1)} .dl`));
      assert(v.kind === "webp" && v.name === "sq1-goodbye-bg.webp", `${v.kind} ${v.name}`);
      webp = `${v.name} ${(v.bytes.length / 1024).toFixed(0)} KB vs PNG ${(g.bytes.length / 1024).toFixed(0)} KB`;
    }
    await o.until(`(${KEPT}).then((k) => k[0]?.out?.fmt === "webp" || ${JSON.stringify(webp)} === "WebP not offered")`, 10000, "WebP kept");
    o.errors.length = 0;
    await o.reload();
    await allDone(o, 2, 20000);
    await o.until(`[...document.querySelectorAll("#grid > .card img")].every((i) => i.naturalWidth > 0 && i.naturalWidth === i.naturalHeight)`, 10000, "both cards square after the reload");
    noErrors(o); await cspClean(o);
    await o.close();
    return `${w} x ${h}; ${webp}`;
  });

  // A subject on hard stripes: blur has to smooth them out behind a sharp subject (a smooth gradient would pass even
  // with no blur at all).
  const addStriped = (p, names) => p.ev(`(async () => {
    const dt = new DataTransfer();
    for (const name of ${JSON.stringify(names)}) {
      const c = document.createElement("canvas"); c.width = 900; c.height = 1200; const x = c.getContext("2d");
      for (let i = 0; i < 900; i += 40) { x.fillStyle = (i / 40) % 2 ? "#204060" : "#e8d070"; x.fillRect(i, 0, 40, 1200); }
      x.fillStyle = "#c0302a"; x.beginPath(); x.ellipse(450, 744, 252, 360, 0, 0, 7); x.fill();
      x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(450, 288, 135, 0, 7); x.fill();
      const b = await new Promise((r) => c.toBlob(r, "image/png")); dt.items.add(new File([b], name + ".png", { type: "image/png" }));
    }
    const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  // Pixels of a downloaded image, read back in the page: [r, g, b, a] at fractions of its size.
  const pixels = (p, f, at) => p.ev(`(async () => {
    const b = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(f.bytes.toString("base64"))}), (c) => c.charCodeAt(0))]));
    const c = new OffscreenCanvas(b.width, b.height), x = c.getContext("2d"); x.drawImage(b, 0, 0);
    const px = (u, v) => [...x.getImageData(Math.min(b.width - 1, Math.floor(u * b.width)), Math.min(b.height - 1, Math.floor(v * b.height)), 1, 1).data];
    return { w: b.width, h: b.height, at: ${JSON.stringify(at)}.map(([u, v]) => px(u, v)) };
  })()`);

  await check(`backgrounds: blur gives a JPG, stripes smoothed, subject sharp (${engine})`, async () => {
    const c7 = await context(), o = await page(c7);
    await o.go(app());
    await addStriped(o, ["blurry"]);
    await allDone(o, 1, 90000);
    await click(o, "#grid > .card .bgb");
    await click(o, "#grid > .card .bgs .blur.b1"); // soft: closes the row like every swatch
    await o.until(`document.querySelector("#grid > .card .bgb").getAttribute("aria-label") === "Background: Soft blur" && document.querySelector("#grid > .card .bgs").hidden`, 3000, "soft blur chosen, row closed");
    await click(o, "#grid > .card .bgb");
    await click(o, "#grid > .card .bgs .blur.b2"); // strong
    await o.until(`document.querySelector("#grid > .card .bgb").getAttribute("aria-label") === "Background: Strong blur"`, 3000, "strong blur chosen");
    assert(await o.ev(`document.querySelector("#grid > .card .crop").getAttribute("aria-pressed") === "false"`), "blur did not switch to the whole frame");
    const f = await download(c7, () => click(o, "#grid > .card .dl"));
    assert(f.kind === "jpg" && f.name === "blurry-goodbye-bg.jpg", `${f.kind} ${f.name}`);
    // A row across the background, left of the subject, 10 px apart: the 40 px stripes went from 50 to 230 in red.
    const row = Array.from({ length: 12 }, (_, i) => [0.06 + i * 0.0111, 0.5]);
    const r = await pixels(o, f, [...row, [0.5, 0.62], [0.01, 0.01], [0.99, 0.99]]);
    assert(r.w === 900 && r.h === 1200, `whole frame expected, got ${r.w} x ${r.h}`);
    const reds = r.at.slice(0, 12).map((v) => v[0]), spread = Math.max(...reds) - Math.min(...reds);
    assert(spread < 60, `stripes not smoothed: red runs ${reds.join(",")}`);
    const [mr, mg, mb] = r.at[12];
    assert(mr > 150 && mg < 90 && mb < 90, `subject not sharp red: ${r.at[12]}`);
    for (const c of r.at.slice(13)) assert(c[0] + c[1] + c[2] > 120, `a corner is black: ${c}`);
    await o.until(`(${KEPT}).then((k) => k[0]?.bg === "blur:2")`, 10000, "blur kept");
    o.errors.length = 0;
    await o.reload();
    await allDone(o, 1, 20000);
    await o.until(`document.querySelector("#grid > .card").classList.contains("solid") && document.querySelector("#grid > .card .bgb").getAttribute("aria-label") === "Background: Strong blur"`, 10000, "blur back after the reload");
    noErrors(o); await cspClean(o);
    await o.close();
    return `background red ${Math.min(...reds)}-${Math.max(...reds)} (stripes 32-232), subject ${r.at[12].slice(0, 3)}`;
  });

  await check("backgrounds: your photo, All, stored once, reload", async () => {
    const c8 = await context(), o = await page(c8);
    await o.go(app());
    await addPhotos(o, ["ph1", "ph2"]);
    await allDone(o, 2, 120000);
    const card = (n) => `#grid > .card:nth-child(${n})`, row = (n) => `:is(${card(n)}, #dock)`; // a narrow card opens its rows in the dock
    await click(o, `${card(1)} .bgb`);
    await o.ev(`(async () => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1000; const x = c.getContext("2d");
      x.fillStyle = "#1a7f5a"; x.fillRect(0, 0, 1600, 1000);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)), dt = new DataTransfer(); dt.items.add(new File([b], "green.jpg", { type: "image/jpeg" }));
      const i = document.querySelector("${row(1)} .bgs .photo input"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await o.until(`document.querySelector("${card(1)} .bgb").getAttribute("aria-label") === "Background: Your photo"`, 10000, "the photo as background");
    const f = await download(c8, () => click(o, `${card(1)} .dl`));
    assert(f.kind === "jpg" && f.name === "ph1-goodbye-bg.jpg", `${f.kind} ${f.name}`);
    const r = await pixels(o, f, [[0.01, 0.01], [0.5, 0.6]]);
    const [g0, g1, g2] = r.at[0];
    assert(Math.abs(g0 - 0x1a) < 25 && Math.abs(g1 - 0x7f) < 25 && Math.abs(g2 - 0x5a) < 25, `corner is not the photo: ${r.at[0]}`);
    assert(r.at[1][0] > 150 && r.at[1][1] < 90, `subject missing: ${r.at[1]}`);
    await click(o, `${card(1)} .bgb`);
    await click(o, `${row(1)} .bgs .more`);
    await click(o, `${row(1)} .oall`);
    const backs = `indexedDB.databases().then(() => new Promise((ok) => { const r = indexedDB.open("goodbye-bg"); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("backs")) { db.close(); return ok(-1); } const q = db.transaction("backs").objectStore("backs").count(); q.onsuccess = () => { db.close(); ok(q.result); }; }; }))`;
    await o.until(`(${KEPT}).then((k) => k.length === 2 && k.every((s) => s.bg && s.bg === k[0].bg && s.bg.startsWith("img:")))`, 10000, "both kept with the same photo").catch(async (e) => {
      throw new Error(e.message + ": " + JSON.stringify(await kept(o)));
    });
    await o.until(`(${backs}).then((n) => n === 1)`, 10000, "the photo stored once");
    o.errors.length = 0;
    await o.reload();
    await allDone(o, 2, 20000);
    await o.until(`[...document.querySelectorAll("#grid > .card .bgb")].every((b) => b.getAttribute("aria-label") === "Background: Your photo")`, 10000, "both back on the photo");
    const g = await download(c8, () => click(o, `${card(2)} .dl`));
    const r2 = await pixels(o, g, [[0.01, 0.01]]);
    assert(g.kind === "jpg" && Math.abs(r2.at[0][1] - 0x7f) < 25, `after the reload: ${g.kind} ${r2.at[0]}`);
    noErrors(o); await cspClean(o);
    await o.close();
    return `${f.name} ${r.w} x ${r.h}, 1 stored photo for 2 cut-outs`;
  });

  // Phone width, a slow connection: the case that jittered before (jitter-design: CLS 0.24 with 2 photos at 300 ms).
  await check("reload at phone width, 300 ms latency: CLS 0", async () => {
    const c5 = await context(), m = await page(c5, { w: 390, h: 844 }); // no touch: Download stays a download
    await m.go(app());
    await addPhotos(m, ["p1", "p2"]);
    await allDone(m, 2, 90000);
    await m.until(`(${KEPT}).then((k) => k.length === 2 && k.every((s) => s.mask))`, 15000, "2 photos kept");
    await m.s("Network.emulateNetworkConditions", { offline: false, latency: 300, downloadThroughput: -1, uploadThroughput: -1 });
    await m.reload();
    await allDone(m, 2, 20000);
    await m.until(`document.querySelectorAll("#grid > .adcard").length === 2`, 10000, "2 ad cards");
    await sleep(2000);
    const ls = await m.ev("window.__ls"), cls = ls.reduce((a, b) => a + b, 0);
    assert(cls < 0.001, `CLS ${cls.toFixed(4)} (${ls.join(", ")})`);
    noErrors(m);
    await m.close();
    return `CLS ${cls.toFixed(4)}`;
  });

  // The CPU engine on its own, when the main run used the GPU.
  await check("one photo (cpu): result and PNG download", async () => {
    if (engine === "cpu") return { skip: "the main run already used the CPU engine" };
    const c3 = await context(), r = await page(c3);
    await r.go(`${base}/?engine=cpu&confetti=0`);
    await addPhotos(r, ["cpu"]);
    await allDone(r, 1, 60000);
    const f = await download(c3, () => click(r, "#grid > .card .dl"));
    assert(f.kind === "png" && f.name === "cpu-goodbye-bg.png", `${f.kind} ${f.name}`);
    const e = await engineOf(r); assert(e === "cpu", `ran on ${e}`);
    noErrors(r);
    await r.close();
    return `${f.name}, engine ${e}`;
  });

  // The GPU gate: BiRefNet fails to start (?gpufail=birefnet-init, after a 3 s delay), ISNet on the GPU takes over, and a
  // photo added while it starts still finishes there. Fallback reports are expected here (they go to /api/crash).
  await check("gpu gate: BiRefNet fails to start, ISNet on the GPU finishes", async () => {
    if (engine !== "gpu") return { skip: "no WebGPU with shader-f16 in this headless Chrome" };
    const c5 = await context(), g = await page(c5);
    await g.go(`${base}/?gpufail=birefnet-init&confetti=0`);
    await addPhotos(g, ["first"]);
    const failed = () => g.errors.find((e) => e.includes('"birefnet-start-failed"'));
    for (let i = 0; i < 300 && !failed(); i++) await sleep(100);
    assert(failed(), "no birefnet-start-failed report");
    assert(failed().includes('"engine":"gpu-birefnet"'), "the report names another engine: " + failed());
    await addPhotos(g, ["second"]); // ISNet on the GPU is starting now
    await allDone(g, 2, 90000);
    const e1 = await engineOf(g, '#grid > .card[aria-label^="first"]'), e2 = await engineOf(g, '#grid > .card[aria-label^="second"]');
    assert(e1 === "gpu" && e2 === "gpu", `ran on ${e1} and ${e2}`);
    assert(!(await g.ev(`localStorage.getItem("gb-gpu")`)), "kept the outcome under ?gpufail=");
    noErrors(g, [/birefnet-start-failed/]);
    await g.close();
    return `${e1}, ${e2}`;
  });

  // Text pages.
  await check("pages: unknown path gives the 404 page", async () => {
    for (const path of ["/no-such-page", "/a/b/c.png"]) {
      const r = await fetch(base + path), t = await r.text();
      assert(r.status === 404, `${path}: status ${r.status}`);
      assert(/This page said goodbye/.test(t), `${path}: not the 404 page`);
    }
    const r = await fetch(base + "/share", { redirect: "manual" });
    assert(r.status === 303 && r.headers.get("location") === "/", "/share does not send to the app");
  });
  await check("pages: SEO and 404 pages load clean, in Nunito", async () => {
    for (const path of ["/remove-bg-alternative/", "/how-to-remove-background/", "/no-such-page", "/"]) {
      const r = await fetch(base + path);
      assert(r.status === (path === "/no-such-page" ? 404 : 200), `${path}: status ${r.status}`);
      if (/\/.+\/$/.test(path)) assert(/script-src 'none'/.test(r.headers.get("content-security-policy") || ""), `${path}: CSP missing`);
      // A first visit each (fresh context, empty cache, 150 ms latency): font-display: optional shows the fallback font
      // unless the font is preloaded.
      const c4 = await context(), s = await page(c4, { w: 390, h: 844, mobile: true });
      await s.s("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 }); // a real connection
      await s.go(base + path);
      await sleep(300);
      const info = await s.ev(`({ h1: document.querySelector("h1")?.textContent || "", css: [...document.styleSheets].some((x) => { try { return x.cssRules.length > 0; } catch { return false; } }),
        wide: document.documentElement.scrollWidth > innerWidth + 1 })`);
      assert(info.h1 && info.css, `${path}: no heading or no styles`);
      assert(!info.wide, `${path}: scrolls sideways at 390 px`);
      // The font the heading is actually drawn in (document.fonts says "loaded" even when the page kept the fallback).
      await s.s("DOM.enable"); await s.s("CSS.enable");
      const { root: doc } = await s.s("DOM.getDocument", {}), { nodeId } = await s.s("DOM.querySelector", { nodeId: doc.nodeId, selector: "h1" });
      const { fonts } = await s.s("CSS.getPlatformFontsForNode", { nodeId });
      assert(fonts.some((f) => /nunito/i.test(f.familyName)), `${path}: first visit draws the heading in ${fonts.map((f) => f.familyName).join(", ")}, not Nunito`);
      noErrors(s, path === "/no-such-page" ? [/404/] : []); await cspClean(s);
      await s.close();
    }
    const t = await (await fetch(base + "/")).text();
    assert(/<title>[^<]{10,}/.test(t) && /name="description"/.test(t), "home page has no title/description");
  });
} catch (e) {
  report("harness", "FAIL", 0, e?.stack?.split("\n").slice(0, 3).join(" ") || String(e));
} finally {
  const fails = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length, skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n${pass} passed, ${fails} failed${skip ? `, ${skip} skipped` : ""} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  try { browser?.ws.close(); } catch {}
  cleanup();
  process.exit(fails ? 1 : 0);
}
