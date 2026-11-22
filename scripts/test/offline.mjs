// Offline test: one visit online, then the server is stopped (and the tab set offline) and the app must still work.
// Then an upgrade: a new build with a new runtime folder replaces the old caches.
//
//   node scripts/test/offline.mjs              build, then run (about two minutes)
//   node scripts/test/offline.mjs --no-build   reuse dist/ (the upgrade step changes dist/; rebuild afterwards)
//
// Same style as smoke.mjs: Node's fetch and WebSocket drive headless Chrome over CDP, no dependencies.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = new URL("../..", import.meta.url).pathname;
const dist = join(root, "dist");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tmp = mkdtempSync(join(tmpdir(), "goodbye-offline-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const results = [];
async function check(name, fn) {
  const s = Date.now();
  try { const note = await fn(); log(name, "PASS", s, note || ""); return true; }
  catch (e) { log(name, "FAIL", s, e?.message || String(e)); return false; }
}
function log(name, status, s, note) { results.push(status); console.log(`${status.padEnd(4)}  ${name} (${((Date.now() - s) / 1000).toFixed(1)} s)${note ? "  " + note : ""}`); }
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

/* ---------- fixtures: a figure on a gradient as GIF (3 frames) and as an uncompressed TIFF ---------- */
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
function tiffBytes(w, h) {
  const px = figure(w, h), data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 3);
  const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, data.length]];
  const ifd = 8, ifdLen = 2 + tags.length * 12 + 4, bps = ifd + ifdLen, img = bps + 6;
  const b = Buffer.alloc(img + data.length);
  b.write("II", 0); b.writeUInt16LE(42, 2); b.writeUInt32LE(ifd, 4); b.writeUInt16LE(tags.length, ifd);
  tags.forEach(([tag, type, n, v], i) => {
    const o = ifd + 2 + i * 12; b.writeUInt16LE(tag, o); b.writeUInt16LE(type, o + 2); b.writeUInt32LE(n, o + 4);
    const val = tag === 258 ? bps : tag === 273 ? img : v;
    if (type === 3 && n === 1) b.writeUInt16LE(val, o + 8); else b.writeUInt32LE(val, o + 8);
  });
  [8, 8, 8].forEach((v, i) => b.writeUInt16LE(v, bps + i * 2)); data.copy(b, img);
  return b;
}
const fx = join(tmp, "fixtures"); mkdirSync(fx);
writeFileSync(join(fx, "wave.gif"), gifBytes());
writeFileSync(join(fx, "figure.tif"), tiffBytes(320, 400));

/* ---------- server and Chrome ---------- */
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
function run(cmd, args, opts = {}) { const p = spawn(cmd, args, { cwd: root, stdio: opts.stdio || "ignore", env: { ...process.env, ...opts.env } }); procs.push(p); return p; }
let server, port, base;
async function startServer() {
  server = run(process.execPath, ["scripts/serve.mjs"], { env: { PORT: String(port), LIVE: "http://127.0.0.1:9" } }); // /api/count fails: nothing reaches production
  for (let i = 0; i < 100; i++) { try { await fetch(base + "/version.txt"); return; } catch { await sleep(100); } }
  throw new Error("server did not start");
}
async function stopServer() { server.kill("SIGKILL"); for (let i = 0; i < 50; i++) { try { await fetch(base + "/version.txt"); await sleep(100); } catch { return; } } throw new Error("server still up"); }
process.on("exit", () => { for (const p of procs) try { p.kill("SIGKILL"); } catch {} try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

let browser;
async function startChrome() {
  const cdp = await freePort();
  run(CHROME, ["--headless=new", `--remote-debugging-port=${cdp}`, `--user-data-dir=${join(tmp, "chrome")}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio", "--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "about:blank"]);
  let ver;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json(); } catch { await sleep(100); } }
  assert(ver, "Chrome did not start");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", no, { once: true }); });
  let id = 0; const pending = new Map(), listeners = new Set();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.no(new Error(`${p.method}: ${d.error.message}`)) : p.ok(d.result); }
    else for (const l of listeners) l(d);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++id; pending.set(i, { ok, no, method }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  browser = { send, on: (f) => (listeners.add(f), () => listeners.delete(f)) };
  // Service workers too: what they fetch (from the disk cache or not) and what fails.
  const swSessions = new Set(), swReqs = new Map();
  browser.on(async (d) => {
    if (d.method === "Target.targetCreated" && d.params.targetInfo.type === "service_worker") {
      const { sessionId } = await send("Target.attachToTarget", { targetId: d.params.targetInfo.targetId, flatten: true }).catch(() => ({}));
      if (!sessionId) return; swSessions.add(sessionId);
      send("Runtime.enable", {}, sessionId).catch(() => {}); send("Network.enable", {}, sessionId).catch(() => {});
      send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    }
    if (!swSessions.has(d.sessionId)) return;
    if (d.method === "Network.requestWillBeSent") swReqs.set(d.params.requestId, d.params.request.url.replace(/^https?:\/\/[^/]+/, "") + " " + (d.params.request.headers?.["Cache-Control"] || ""));
    if (d.method === "Network.responseReceived") swLog.push(`sw got ${d.params.response.status} ${d.params.response.fromDiskCache ? "disk" : "net"} ${swReqs.get(d.params.requestId)}`);
    if (d.method === "Network.loadingFailed") swLog.push(`sw failed ${d.params.errorText} ${swReqs.get(d.params.requestId)}`);
    if (d.method === "Runtime.consoleAPICalled" || d.method === "Runtime.exceptionThrown") swLog.push("sw console " + JSON.stringify(d.params).slice(0, 300));
  });
  await send("Target.setDiscoverTargets", { discover: true });
}
const swLog = [];

// A page; workers it starts (and their workers: ORT's threads) are attached so we can ask them things.
async function page(ctxId, { w = 1280, h = 800 } = {}) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: ctxId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, sid = sessionId) => browser.send(m, p, sid);
  const errors = [], workers = new Map(), votes = [], bytes = { n: 0 }, logs = [], reqs = new Map();
  browser.on((d) => {
    if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "worker") {
      const ws = d.params.sessionId; workers.set(ws, { url: d.params.targetInfo.url, parent: d.sessionId, alive: true });
      s("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, ws).catch(() => {});
      s("Network.enable", {}, ws).catch(() => {});
    }
    if (d.method === "Target.detachedFromTarget" && workers.has(d.params.sessionId)) workers.get(d.params.sessionId).alive = false;
    if (d.method === "Network.loadingFinished" && (d.sessionId === sessionId || workers.has(d.sessionId))) bytes.n += d.params.encodedDataLength;
    if (d.method === "Runtime.consoleAPICalled" && (d.sessionId === sessionId || workers.has(d.sessionId))) logs.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (d.method === "Network.loadingFailed" && (d.sessionId === sessionId || workers.has(d.sessionId))) logs.push("failed: " + d.params.errorText + " " + (reqs.get(d.params.requestId) || ""));
    if (d.method === "Network.requestWillBeSent") reqs.set(d.params.requestId, d.params.request.url);
    if (d.sessionId !== sessionId) return;
    if (d.method === "Network.requestWillBeSent" && /\/api\/rate$/.test(d.params.request.url)) try { votes.push(JSON.parse(d.params.request.postData)); } catch {}
    if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split("\n")[0]);
  });
  await s("Page.enable"); await s("Runtime.enable"); await s("Network.enable");
  await s("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const p = {
    s, errors, workers, votes, bytes, logs, sessionId,
    async go(url) { await s("Page.navigate", { url }); await sleep(300); await p.until("document.readyState === 'complete'", 20000); },
    async ev(expr, sid = sessionId) {
      const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error("in page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split("\n")[0]);
      return r.result.value;
    },
    async until(expr, ms = 30000, what = expr) {
      const end = Date.now() + ms;
      for (;;) { let v; try { v = await p.ev(expr); } catch {} if (v) return v; if (Date.now() > end) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}`); await sleep(100); }
    },
    async files(paths) {
      const { root: doc } = await s("DOM.getDocument", {});
      const { nodeId } = await s("DOM.querySelector", { nodeId: doc.nodeId, selector: "#file" });
      await s("DOM.setFileInputFiles", { nodeId, files: paths });
    },
    offline: (on) => s("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
  };
  return p;
}

const addPhoto = (p, name, color = "#c0302a") => p.ev(`(async () => {
  const c = document.createElement("canvas"); c.width = 900; c.height = 1200; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 900, 1200); g.addColorStop(0, "#d8e8f0"); g.addColorStop(1, "#8aa"); x.fillStyle = g; x.fillRect(0, 0, 900, 1200);
  x.fillStyle = ${JSON.stringify(color)}; x.beginPath(); x.ellipse(450, 650, 260, 380, 0, 0, 7); x.fill();
  x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(450, 260, 150, 0, 7); x.fill();
  const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)); const dt = new DataTransfer(); dt.items.add(new File([b], ${JSON.stringify(name)} + ".jpg", { type: "image/jpeg" }));
  const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true;
})()`);
const CARDS = `[...document.querySelectorAll("#grid > .card")]`;
const allDone = (p, n, ms = 120000) => p.until(`(() => { const c = ${CARDS};
  if (c.some((x) => x.classList.contains("failed"))) throw new Error("failed card");
  return c.length === ${n} && c.every((x) => !x.querySelector(".dl").disabled && !x.classList.contains("working") && !x.classList.contains("queued"));
})()`, ms, `${n} finished card(s)`).catch(async (e) => {
  const failed = await p.ev(`${CARDS}.filter((x) => x.classList.contains("failed")).map((x) => x.innerText.replace(/\\s+/g, " ")).join(" | ")`).catch(() => "");
  throw new Error(failed ? `a card failed: ${failed}` : e.message);
});
const cardCount = (p) => p.ev(`${CARDS}.length`);
async function engineOf(p, name) {
  const n = p.votes.length;
  await p.ev(`[...document.querySelectorAll("#grid > .card")].find((c) => (c.getAttribute("aria-label") || "").includes(${JSON.stringify(name)})).querySelector(".rate").click()`);
  for (let i = 0; i < 50 && p.votes.length === n; i++) await sleep(50);
  return p.votes.at(-1)?.engine;
}
const cachesNow = (p) => p.ev(`(async () => { const out = {}; for (const n of await caches.keys()) { const c = await caches.open(n); out[n] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); } return out; })()`);
const engineWorker = (p) => [...p.workers.entries()].reverse().find(([, w]) => w.alive && /engine\.js/.test(w.url));
const threadCount = (p, sid) => [...p.workers.values()].filter((w) => w.alive && w.parent === sid).length;
const adsDrawn = (p) => p.until(`(() => { const a = [...document.querySelectorAll("#grid > .adcard")]; return a.length > 0 && a.every((x) => !x.classList.contains("loading") && x.querySelector("canvas, img")); })()`, 20000, "ad cards drawn");

/* ---------- run ---------- */
if (!process.argv.includes("--no-build")) {
  const b = run(process.execPath, ["scripts/build.mjs"], { stdio: ["ignore", "ignore", "inherit"] });
  if (await new Promise((ok) => b.on("exit", ok))) { console.log("FAIL  build"); process.exit(1); }
}
port = await freePort(); base = `http://localhost:${port}`;
await startServer();
await startChrome();
const { browserContextId: ctx } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
const APP = (q = "") => `${base}/?adtest=1&adpartner=zazzle&confetti=0${q}`;

// 0. A visitor from before this worker (share target only). After one more visit online the app works offline.
const OLD_SW = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => { if (e.request.method === "POST" && new URL(e.request.url).pathname === "/share") e.respondWith(Response.redirect("/?share=1", 303)); });`;
{
  const newSw = readFileSync(join(dist, "sw.js"), "utf8");
  const { browserContextId: old } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const q = await page(old);
  await check("existing visitor: offline after the next online visit", async () => {
    writeFileSync(join(dist, "sw.js"), OLD_SW);
    try {
      await q.go(APP());
      await addPhoto(q, "before"); await allDone(q, 1).catch((e) => { throw new Error(e.message + "\n      " + q.logs.slice(-20).join("\n      ")); });
      assert(!(await q.ev("caches.keys()")).some((k) => k.startsWith("gb-")), "old worker made caches");
    } finally { writeFileSync(join(dist, "sw.js"), newSw); }
    await q.go(APP()); // the new worker installs
    await q.until(`caches.keys().then((k) => k.some((n) => n.startsWith("gb-shell-")))`, 20000, "new worker's shell cache");
    await q.until("!!navigator.serviceWorker.controller", 5000, "a controller");
    await q.go(APP()); await allDone(q, 1, 30000); // the engine now runs under the new worker
    await q.until(`caches.keys().then(async (k) => { const m = k.find((n) => n.startsWith("gb-m-")); return m && (await (await caches.open(m)).keys()).length >= 6; })`, 60000, "the model kept");
    await sleep(6500); // the completion pass
    await stopServer(); await q.offline(true);
    try {
      await q.go(APP());
      await allDone(q, 1, 30000);
      swLog.length = 0;
      await addPhoto(q, "after"); await allDone(q, 2).catch((e) => { throw new Error(e.message + "\n      " + q.logs.slice(-12).join("\n      ") + "\n      " + swLog.slice(-20).join("\n      ")); });
      const e = await engineOf(q, "after");
      const c = await cachesNow(q);
      const m = Object.entries(c).filter(([k]) => k.startsWith("gb-m-")).map(([k, v]) => `${k}: ${v.length}`);
      assert(m.some((x) => !x.endsWith(": 0")), "no model kept: " + JSON.stringify(Object.keys(c)));
      return `engine ${e}; ${m.join(", ")}`;
    } finally { await q.offline(false); await startServer(); }
  });
  await browser.send("Target.disposeBrowserContext", { browserContextId: old }).catch(() => {});
}

const p = await page(ctx);
let msOnline = {};

// 1. First visit, online, like a real one: the engine may start before the worker controls the page.
await check("online: first visit, GPU photo, GIF, TIFF, ad previews, CPU photo", async () => {
  await p.go(APP());
  await p.files([join(fx, "wave.gif"), join(fx, "figure.tif")]);
  await allDone(p, 2);
  await addPhoto(p, "gpu-a");
  await allDone(p, 3);
  const e1 = await engineOf(p, "gpu-a");
  await p.go(APP("&engine=cpu"));
  await allDone(p, 3, 30000); // kept photos come back
  const t = Date.now(); await addPhoto(p, "cpu-a", "#2050c0"); await allDone(p, 4, 180000); msOnline.cpu = Date.now() - t;
  const ew = engineWorker(p); msOnline.threads = ew ? threadCount(p, ew[0]) : -1;
  const iso = ew ? await p.ev("self.crossOriginIsolated", ew[0]) : null;
  const e2 = await engineOf(p, "cpu-a");
  await p.ev(`(async () => { const c = await caches.open("share-inbox"); return true; })()`);
  return `engines ${e1}, ${e2}; CPU photo ${(msOnline.cpu / 1000).toFixed(1)} s with ${msOnline.threads} thread workers, worker isolated ${iso}; ${(p.bytes.n / 1e6).toFixed(1)} MB`;
});
await check("online: what the worker kept", async () => {
  await sleep(6500); // the completion pass after the engine's last request
  const c = await cachesNow(p);
  for (const [n, want] of [["gb-rt-", 5], ["gb-m-birefnet", 7], ["gb-m-isnet", 6]]) { const k = Object.keys(c).find((x) => x.startsWith(n)); assert(k && c[k].length === want, `${n}: ${k ? c[k].length : "none"} of ${want}`); }
  const est = await p.ev("navigator.storage.estimate().then((e) => Math.round(e.usage / 1e6))");
  const sw = await p.ev("navigator.serviceWorker.controller?.scriptURL || 'none'");
  return `controller ${sw}; storage ${est} MB; ` + Object.entries(c).map(([n, k]) => `${n}: ${k.length}`).join(", ");
});

// 2. Offline: the server is gone and the tab is offline.
await stopServer(); await p.offline(true);
p.bytes.n = 0;
const up = await check("offline: reload shows the page, isolated, kept photos back", async () => {
  await p.go(APP());
  await p.until(`document.getElementById("pick")`, 10000, "the page");
  assert(await p.ev("crossOriginIsolated"), "not cross-origin isolated");
  await allDone(p, 4, 30000);
  return `${await cardCount(p)} kept cards`;
});
if (up) {
  await check("offline: GPU photo", async () => {
    p.logs.length = 0; swLog.length = 0;
    await addPhoto(p, "gpu-off", "#20a040"); await allDone(p, 5);
    const e = await engineOf(p, "gpu-off"); assert(/^gpu/.test(e || "gpu?"), "engine " + e + "\n      " + p.logs.filter((l) => !/^(debug|info): (step|goodbye\.bg: GPU)/.test(l)).slice(-15).join("\n      ") + "\n      " + swLog.filter((l) => /\/m\/|\/rt\//.test(l)).slice(-20).join("\n      "));
    return "engine " + e;
  });
  await check("offline: ad previews (3D) drawn", async () => { await adsDrawn(p).catch(() => {}); const n = await p.ev(`document.querySelectorAll("#grid > .adcard").length`); return `${n} ad cards (5 photos fill their row: 0 to 3 expected)`; });
  await check("offline: GIF and TIFF", async () => {
    await p.go(APP());
    await p.files([join(fx, "wave.gif"), join(fx, "figure.tif")]); await allDone(p, 7);
  });
  await check("offline: CPU photo, threads, worker isolated", async () => {
    await p.go(APP("&engine=cpu"));
    await allDone(p, 7, 30000);
    const t = Date.now(); await addPhoto(p, "cpu-off", "#e0b020"); await allDone(p, 8, 180000); const ms = Date.now() - t;
    const ew = engineWorker(p); assert(ew, "no engine worker seen");
    const iso = await p.ev("self.crossOriginIsolated", ew[0]); assert(iso, "engine worker not cross-origin isolated");
    const th = threadCount(p, ew[0]); assert(th >= 1, "no ORT thread workers");
    const e = await engineOf(p, "cpu-off"); assert(e === "cpu", "engine " + e);
    return `CPU photo ${(ms / 1000).toFixed(1)} s (online ${(msOnline.cpu / 1000).toFixed(1)} s), ${th} thread workers (online ${msOnline.threads})`;
  });
  await check("offline: share-target POST", async () => {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: ctx });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const ev = (x) => browser.send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }, sessionId);
    await browser.send("Network.enable", {}, sessionId);
    await browser.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
    await ev(`(async () => {
      const c = document.createElement("canvas"); c.width = 600; c.height = 800; const x = c.getContext("2d"); x.fillStyle = "#cde"; x.fillRect(0, 0, 600, 800);
      x.fillStyle = "#c0302a"; x.beginPath(); x.ellipse(300, 450, 170, 250, 0, 0, 7); x.fill(); x.fillStyle = "#f0c8a0"; x.beginPath(); x.arc(300, 170, 100, 0, 7); x.fill();
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      const f = document.createElement("form"); f.method = "POST"; f.enctype = "multipart/form-data"; f.action = ${JSON.stringify(base + "/share")};
      const i = document.createElement("input"); i.type = "file"; i.name = "images"; const dt = new DataTransfer(); dt.items.add(new File([b], "shared.jpg", { type: "image/jpeg" })); i.files = dt.files;
      f.append(i); document.body.append(f); f.submit(); return true; })()`);
    const end = Date.now() + 60000; let r;
    for (;;) {
      await sleep(300);
      r = (await ev(`location.pathname + "|" + document.querySelectorAll("#grid > .card").length + "|" + [...document.querySelectorAll("#grid > .card")].some((c) => /shared/.test(c.getAttribute("aria-label") || ""))`).catch(() => ({ result: {} }))).result?.value || "";
      if (/\|true$/.test(r)) break;
      if (Date.now() > end) throw new Error("shared photo not on the page: " + r);
    }
    await browser.send("Target.closeTarget", { targetId });
    return r;
  });
}
await check("offline: no exceptions", async () => { assert(!p.errors.length, p.errors.slice(0, 3).join(" | ")); return `${(p.bytes.n / 1e6).toFixed(2)} MB over the network while offline (should be 0)`; });

// 3. Upgrade: a new build with a new runtime folder. The old shell and runtime caches go; share-inbox stays.
await check("upgrade: new build replaces the old caches", async () => {
  const before = await cachesNow(p);
  await p.ev(`caches.open("share-inbox").then((c) => c.put("/share-inbox/keep-test", new Response("x")))`);
  const oldBuild = readFileSync(join(dist, "version.txt"), "utf8").trim(), newBuild = oldBuild + "x";
  const ORT = Object.keys(before).find((n) => n.startsWith("gb-rt-"))?.slice(6);
  assert(ORT, "no runtime cache before the upgrade: " + Object.keys(before).join(", "));
  renameSync(join(dist, "rt", ORT), join(dist, "rt", "9.9.9"));
  for (const f of ["engine.js", "sw.js", "app.js", "version.txt"]) {
    let s = readFileSync(join(dist, f), "utf8").replaceAll(`rt/${ORT}/`, "rt/9.9.9/").replaceAll(`gb-rt-${ORT}`, "gb-rt-9.9.9").replaceAll(oldBuild, newBuild);
    if (f === "sw.js") s = s.replace(/("\/engine\.js":")[0-9a-f]+/, "$1changed"); // engine.js changed: its old copy must not be reused
    writeFileSync(join(dist, f), s);
  }
  await p.offline(false); await startServer();
  await p.go(APP("&engine=cpu"));
  await p.until(`caches.keys().then((k) => k.includes("gb-shell-${newBuild}") && !k.includes("gb-shell-${oldBuild}") && !k.includes("gb-rt-${ORT}"))`, 20000, "old caches deleted");
  await p.go(APP("&engine=cpu")); // the engine of the first load may still belong to the old worker: one more load
  await allDone(p, await cardCount(p), 30000);
  await addPhoto(p, "after-upgrade"); const n = await cardCount(p); await allDone(p, n, 180000);
  const after = await cachesNow(p);
  assert(after["gb-rt-9.9.9"]?.length >= 4, "new runtime not kept: " + JSON.stringify(Object.keys(after)));
  assert(after["share-inbox"]?.some((k) => k.includes("keep-test")), "share-inbox was touched");
  const eng = after[`gb-shell-${newBuild}`].find((k) => k.startsWith("/engine.js"));
  assert(eng === "/engine.js?v=changed", "engine.js entry: " + eng);
  return Object.entries(after).map(([k, v]) => `${k}: ${v.length}`).join(", ");
});

await check("install: manifest has no installability errors", async () => {
  await p.go(base + "/");
  const { installabilityErrors: errors } = await p.s("Page.getInstallabilityErrors");
  const bad = errors.filter((e) => e.errorId !== "in-incognito"); // CDP browser contexts count as incognito
  assert(!bad.length, bad.map((e) => e.errorId).join(", "));
  const { errors: merr = [], data } = await p.s("Page.getAppManifest");
  assert(!merr.length, merr.map((e) => e.message).join(" | "));
  const m = JSON.parse(data);
  assert(m.icons.some((i) => i.purpose === "maskable") && m.screenshots.some((x) => x.form_factor === "narrow") && m.screenshots.some((x) => x.form_factor === "wide"), "maskable icon or screenshots missing");
  for (const u of [...m.icons, ...m.screenshots].map((x) => x.src)) assert((await fetch(base + u)).ok, u + " missing");
});

const failed = results.filter((r) => r === "FAIL").length;
console.log(`\n${results.length - failed} passed, ${failed} failed${process.argv.includes("--no-build") ? "" : " (dist/ was changed by the upgrade step: rebuild before deploying)"}`);
process.exit(failed ? 1 : 0);
