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
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return false; // ONLY=<part of a name> runs just those checks
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

async function page(ctx, { w = 1280, h = 800, dark = false, mobile = false, lang = "" } = {}) {
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
  if (lang) { // the browser's language list (navigator.languages and Accept-Language), as a browser set to that language sends it
    const { result } = await s("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true });
    await s("Network.setUserAgentOverride", { userAgent: result.value, acceptLanguage: lang });
  }
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
  for (let i = 0; i < 100 && p.votes.length === n; i++) await sleep(50);
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
const TRANSLATED = ["de", "es", "fr", "pt-br", "id"].flatMap((l) => [`/${l}/remove-bg-alternative/`, `/${l}/how-to-remove-background/`]);
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
    for (const [f, s, ph] of [["app.js", app, '"%PARTNERS%"'], ["app.js", app, "%BUILD%"], ["app.js", app, "%ENGINE%"], ["engine.js", eng, "%ORT%"], ["engine.js", eng, "%BIREFNET%"], ["engine.js", eng, "%BIREFNET640%"]]) assert(!s.includes(ph), `${ph} left in dist/${f}`);
    assert(!readFileSync(join(root, "dist/early.js"), "utf8").includes("%I18N%"), "/*%I18N%*/ left in dist/early.js");
    for (const f of readdirSync(join(root, "dist"), { recursive: true }).filter((f) => /\.(html|xml|txt)$/.test(f) && !f.startsWith("m/") && !f.startsWith("rt/"))) {
      const t = readFileSync(join(root, "dist", f), "utf8");
      for (const ph of ["%SITE%", "%HREFLANG%"]) assert(!t.includes(ph), `${ph} left in dist/${f}`);
    }
  });

  // Every English string the page can show has a translation in each language, and no translation is left over
  // after its English changed (src/i18n.js is keyed by the English text; a missing key shows English).
  await check("i18n: every string translated, none stale", async () => {
    const { LANGS } = await import(join(root, "src/i18n.js"));
    const app = readFileSync(join(root, "src/app.js"), "utf8"), idx = readFileSync(join(root, "src/index.html"), "utf8");
    const { PARTNERS } = await import(join(root, "lib/partners.mjs"));
    const said = (f) => [...readFileSync(join(root, f), "utf8").matchAll(/(?:fail\(\d+, |new Error\()"([^"]+)"/g)].map((m) => m[1]);
    const used = new Set([
      ...[...app.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1]),
      // t(a ? "one" : "other"): both, from lines that call t()
      ...app.split("\n").filter((l) => /\bt\(/.test(l)).flatMap((l) => [...l.matchAll(/\bt\((?:[^"\n]|"[^"\n]*")*?\? "((?:[^"\\]|\\.)+)" : "((?:[^"\\]|\\.)+)"/g)]).flatMap((m) => [m[1], m[2]]),
      ...[...idx.matchAll(/<[^>]*\sdata-t(?:="html")?(?=[\s>])[^>]*>([^<]*(?:<br>[^<]*)?)</g)].map((m) => m[1].trim()).filter(Boolean),
      ...[...idx.matchAll(/title="([^"]+)" data-t-title/g)].map((m) => m[1]),
      idx.match(/<title>([^<]+)<\/title>/)[1],
      ...PARTNERS.flatMap((p) => [p, ...(p.variants || [])]).flatMap((x) => [x.line, x.cta, ...(x.ctas || [])]).filter(Boolean),
      "Ad", "Sponsored",
      ...said("functions/api/fetch.js").filter((m) => !/endpoint|too large/.test(m)), ...said("src/formats.js").filter((m) => m !== "RAW"),
      "The other site answered {status}.",
    ]);
    const problems = [];
    for (const [code, l] of Object.entries(LANGS)) {
      const missing = [...used].filter((k) => !(k in l.t)), stale = Object.keys(l.t).filter((k) => !used.has(k));
      if (missing.length) problems.push(`${code} lacks ${missing.slice(0, 4).map((k) => JSON.stringify(k)).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}`);
      if (stale.length) problems.push(`${code} has unused ${stale.slice(0, 4).map((k) => JSON.stringify(k)).join(", ")}`);
      for (const [k, v] of Object.entries(l.t)) { const slots = (x) => (x.match(/\{\w+\}/g) || []).sort().join(); if (slots(k) !== slots(v)) problems.push(`${code}: slots differ in ${JSON.stringify(k)}`); }
    }
    assert(!problems.length, problems.join(" | "));
    return `${used.size} strings, ${Object.keys(LANGS).join(", ")}`;
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
    const e = await engineOf(p), want = engine === "gpu" ? /^gpu/ : /^cpu(-birefnet640)?$/;
    assert(want.test(e), `ran on ${e}`);
    return `${f.name}, ${(f.bytes.length / 1024).toFixed(0)} KB, engine ${e}`;
  });

  await check("ads: one card beside one photo (?adtest=1)", async () => {
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 1`, 15000, "1 ad card next to 1 photo");
    await p.until(`[...document.querySelectorAll("#grid > .adcard")].every((a) => !a.classList.contains("loading") && a.getBoundingClientRect().width > 50)`, 15000, "ad cards drawn");
    const labels = await p.ev(`[...document.querySelectorAll("#grid > .adcard")].map((a) => a.getAttribute("aria-label").split(":")[0])`);
    assert(labels.every((l) => /^(Ad|Sponsored)$/.test(l)), "ad label: " + labels.join(", "));
    await sleep(1000); // a failed product drawing reports itself (ad-failed, mug-failed, 3d-failed)
    noErrors(p);
  }, [`one photo (${engine}): result and PNG download`]);

  // Ad cards that don't send the cut-out (?zazzlecap=0, Printful, Printify) save it as the see-through PNG.
  await check("ads: a click saves the see-through PNG", async () => {
    const c7 = await context(), a = await page(c7);
    try {
      await a.go(app("&zazzlecap=0"));
      await addPhotos(a, ["adsave"]);
      await allDone(a, 1, 90000);
      await a.until(`document.querySelectorAll("#grid > .adcard.artcard:not(.loading)").length > 0`, 20000, "an ad card with the cut-out");
      await a.ev(`(document.addEventListener("click", (e) => { if (e.target.closest(".adcard")) e.preventDefault(); }), true)`); // the partner's tab stays shut
      const f = await download(c7, () => click(a, "#grid > .adcard.artcard"));
      assert(f.kind === "png" && f.name === "adsave-goodbye-bg.png", `${f.kind} ${f.name}`);
      assert(f.bytes[25] === 6, "PNG has no alpha channel");
      return f.name;
    } finally { await a.close(); }
  }, [`one photo (${engine}): result and PNG download`]);

  // Ads among a batch (Kevin, 2026-11-22): one after every 6th photo, never in the first row, its cell kept from the
  // start so no photo moves when it arrives.
  await check("ads: one after the 6th photo of 8, never in the first row", async () => {
    const c8 = await context(), b = await page(c8);
    try {
      await b.go(app());
      await addPhotos(b, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
      const at = () => b.ev(`[...document.getElementById("grid").children].filter((e) => e.matches(".card, .adcard, .adslot")).map((e) => e.matches(".card") ? "P" : "A").join("")`);
      const pos = () => b.ev(`${CARDS}.map((c) => { const r = c.getBoundingClientRect(); return Math.round(r.x) + "," + Math.round(r.y); }).join(" ")`);
      await sleep(700); // after the cards' pop-in (0.35 s), before the first cut-out
      const before = await pos(), slots = await at();
      await allDone(b, 8, 240000);
      await b.until(`document.querySelectorAll("#grid > .adcard:not(.loading)").length === 1`, 15000, "1 ad card");
      const after = await pos(), cells = await at();
      const cols = +(await b.ev(`getComputedStyle(document.getElementById("main")).getPropertyValue("--cols")`));
      const i = cells.indexOf("A");
      assert(cells.replace("A", "").length === 8 && cells.split("A").length === 2, "cells " + cells);
      assert(i >= Math.min(6, 8) && (cells.length <= cols || i >= cols), `ad at ${i} of ${cells} with ${cols} columns`);
      assert(slots === cells, `kept cells ${slots}, then ${cells}`);
      assert(before === after, `photos moved when the ad came in: ${before} -> ${after}`);
      noErrors(b);
      return `${cells}, ${cols} columns`;
    } finally { await b.close(); }
  });

  await check("batch: 3 photos and Download all (zip names)", async () => {
    await addPhotos(p, ["two", "three"]);
    await allDone(p, 3, 120000);
    const order = await names(p);
    assert(order.length === 3, "cards: " + order.join(", "));
    await p.until(`!document.getElementById("tools").hidden`, 5000, "Download all shown");
    const f = await download(ctx, () => click(p, "#all"), 60000);
    assert(f.kind === "zip", `got ${f.kind}`);
    const entries = Object.keys(unzipSync(new Uint8Array(f.bytes))).sort();
    const want = ["one-goodbye-bg.png", "three-goodbye-bg.png", "two-goodbye-bg.png"];
    assert(JSON.stringify(entries) === JSON.stringify(want), "zip holds " + entries.join(", "));
    assert(f.name === "goodbye-bg-3-images.zip", "zip name " + f.name);
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 1`, 10000, "1 ad card next to 3 photos");
    return `${f.name}: ${entries.join(", ")}`;
  }, [`one photo (${engine}): result and PNG download`]);

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
    await p.until(`document.querySelectorAll("#grid > .adcard").length === 1`, 10000, "1 ad card next to 2 photos");
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


  // A file that can't be opened in a batch that fitted (second review, problem 3): no card for it, so the cards keep
  // their size, no ad cell opens and nothing scrolls. notes.txt is skipped before any card exists; a "JPG" that fails
  // to decode loses its card once it fails. Phone 390x844 and desktop 1280x800, 12 photos each.
  await check("layout: a file that can't be opened doesn't reflow 12 photos", async () => {
    const out = [];
    for (const v of [{ w: 390, h: 844, mobile: true }, { w: 1280, h: 800 }]) {
      const cx = await context(), q = await page(cx, v);
      await q.go(app());
      await addPhotos(q, Array.from({ length: 12 }, (_, i) => `f${i + 1}`));
      await q.until(`document.querySelectorAll("#grid > .card").length === 12`, 10000, "12 cards");
      await sleep(400);
      const look = `(() => { const m = document.querySelector("main").style, g = document.getElementById("grid");
        return { p: m.getPropertyValue("--p"), cols: m.getPropertyValue("--cols"), cards: document.querySelectorAll("#grid > .card").length,
          ads: document.querySelectorAll("#grid > .adcard").length, scroll: g.classList.contains("scroll"),
          over: document.documentElement.scrollHeight - innerHeight, tell: document.getElementById("tell").hidden ? "" : document.getElementById("tell").textContent }; })()`;
      const before = await q.ev(look);
      await q.ev(`(() => { const dt = new DataTransfer();
        dt.items.add(new File(["shopping list"], "notes.txt", { type: "text/plain" }));
        const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await sleep(300);
      const now = await q.ev(look);
      assert(now.cards === 12 && now.p === before.p && now.cols === before.cols, `right after notes.txt: ${JSON.stringify(now)} (was ${JSON.stringify(before)})`);
      assert(/notes\.txt/.test(now.tell), "nothing says notes.txt was skipped: " + JSON.stringify(now.tell));
      await q.ev(`(() => { const dt = new DataTransfer();
        dt.items.add(new File(["not really a jpeg"], "broken.jpg", { type: "image/jpeg" }));
        const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await q.until(`document.querySelectorAll("#grid > .card").length === 12 && /broken\.jpg/.test(document.getElementById("tell").textContent)`, 10000, "broken.jpg skipped");
      // Ads come in once a cut-out is done (plus a 1.1 s pause): 12 photos fill whole rows here, so none may appear.
      await q.until(`[...document.querySelectorAll("#grid > .card")].some((c) => !c.querySelector(".dl").disabled && !c.classList.contains("working") && !c.classList.contains("queued"))`, 120000, "a first cut-out");
      await sleep(2000);
      const after = await q.ev(look), want = Math.ceil(12 / +before.cols) * +before.cols - 12;
      assert(after.cards === 12 && after.p === before.p && after.cols === before.cols, `after: ${JSON.stringify(after)} (was ${JSON.stringify(before)})`);
      assert(after.ads === want, `${after.ads} ad cards, ${want} expected for 12 photos`);
      assert(!after.scroll && after.over <= 0, `the page scrolls: ${JSON.stringify(after)}`);
      out.push(`${v.w}x${v.h}: ${after.cols} x ${after.p}`);
      await q.close();
    }
    return out.join("; ");
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
    await m.until(`document.querySelectorAll("#grid > .adcard").length === 1`, 10000, "1 ad card");
    await sleep(2000);
    const ls = await m.ev("window.__ls"), cls = ls.reduce((a, b) => a + b, 0);
    assert(cls < 0.001, `CLS ${cls.toFixed(4)} (${ls.join(", ")})`);
    noErrors(m);
    await m.close();
    return `CLS ${cls.toFixed(4)}`;
  });

  // The guided filter on hair and fur (refineEdge, docs/mask-postprocess.md) runs by default after BiRefNet on a furry
  // subject, changes some soft pixels, and the cut-out still saves; ?pp=0 turns it off. ?debug=1 reports its step
  // (name and numbers only).
  await check("edge refinement (BiRefNet, on by default, off with ?pp=0): refines a furry edge, PNG saves", async () => {
    if (engine !== "gpu") return { skip: "BiRefNet only, and it needs WebGPU with shader-f16" };
    const c6 = await context(), q = await page(c6), steps = [];
    const off = browser.on((d) => {
      if (d.method !== "Network.requestWillBeSent" || !/\/api\/diag$/.test(d.params.request.url)) return;
      try { const b = JSON.parse(d.params.request.postData); if (b.step === "edge") steps.push(b); } catch {}
    });
    const fluffy = `(async () => { // a round furry animal: a body, then a few thousand thin light hairs sticking out, on a dark blurred backdrop
        const c = document.createElement("canvas"); c.width = 1000; c.height = 1000; const x = c.getContext("2d");
        const g = x.createRadialGradient(500, 500, 100, 500, 500, 700); g.addColorStop(0, "#3a4a3a"); g.addColorStop(1, "#101810"); x.fillStyle = g; x.fillRect(0, 0, 1000, 1000);
        x.fillStyle = "#d8c8a8"; x.beginPath(); x.arc(500, 560, 280, 0, 7); x.fill();
        let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
        x.lineWidth = 1.2;
        for (let k = 0; k < 6000; k++) { const a = rnd() * 7, r0 = 230 + rnd() * 40, r1 = r0 + 30 + rnd() * 70, w = (rnd() - 0.5) * 0.25;
          x.strokeStyle = "rgba(240,228,205," + (0.5 + rnd() * 0.5) + ")"; x.beginPath(); x.moveTo(500 + r0 * Math.cos(a), 560 + r0 * Math.sin(a)); x.lineTo(500 + r1 * Math.cos(a + w), 560 + r1 * Math.sin(a + w)); x.stroke(); }
        x.fillStyle = "#222"; x.beginPath(); x.arc(420, 520, 22, 0, 7); x.arc(580, 520, 22, 0, 7); x.fill();
        const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92)), dt = new DataTransfer(); dt.items.add(new File([b], "fluffy.jpg", { type: "image/jpeg" }));
        const i = document.getElementById("file"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
    try {
      await q.go(`${base}/?engine=${engine}&debug=1&confetti=0`);
      await q.ev(fluffy);
      await allDone(q, 1, 90000);
      for (let i = 0; i < 50 && !steps.length; i++) await sleep(50);
      assert(steps.length === 1, `${steps.length} "edge" steps`);
      assert(steps[0].px > 0, "the filter changed no pixels on a furry edge");
      const f = await download(c6, () => click(q, "#grid > .card .dl"));
      assert(f.kind === "png" && f.bytes[25] === 6, `got ${f.kind}`);
      noErrors(q);
      const on = steps[0];
      const c7 = await context(), q0 = await page(c7); steps.length = 0;
      try {
        await q0.go(`${base}/?engine=${engine}&pp=0&debug=1&confetti=0`);
        await q0.ev(fluffy);
        await allDone(q0, 1, 90000); await sleep(500);
        assert(steps.length === 0, `${steps.length} "edge" steps with ?pp=0`);
        noErrors(q0);
      } finally { await q0.close(); }
      return `${on.px} px refined in ${on.ms} ms; none with ?pp=0`;
    } finally { off(); await q.close(); }
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
    const e = await engineOf(r); assert(/^cpu(-birefnet640)?$/.test(e), `ran on ${e}`);
    noErrors(r);
    await r.close();
    return `${f.name}, engine ${e}`;
  });

  // 👎 on a BiRefNet 640 result (the CPU engine) retries with ISNet 1024; the next photo runs on 640 again.
  await check("cpu 👎: the retry runs ISNet, the next photo 640 again", async () => {
    const c4 = await context(), r = await page(c4);
    await r.go(`${base}/?engine=cpu&confetti=0`);
    await addPhotos(r, ["thumbs"]);
    await allDone(r, 1, 60000);
    const DOWN = "#grid > .card .rates > .rate:last-child";
    const label = await r.ev(`document.querySelector(${JSON.stringify(DOWN)}).getAttribute("aria-label")`);
    if (!/try again/.test(label)) return { skip: `the CPU engine runs ISNet here (${label})` };
    const n = r.votes.length;
    await click(r, DOWN);
    await r.until(`(() => { const c = document.querySelector("#grid > .card"), up = c.querySelector(".rate");
      return !c.classList.contains("working") && !up.disabled && up.style.visibility !== "hidden"; })()`, 90000, "the retry's result");
    const first = r.votes[n]; assert(first?.vote === "down" && first.engine === "cpu-birefnet640" && !first.retry, "👎 vote " + JSON.stringify(first));
    const e1 = await engineOf(r), v = r.votes.at(-1);
    assert(e1 === "cpu" && v.retry === true, `retry: engine ${e1}, retry ${v.retry}`);
    await addPhotos(r, ["after"]);
    await allDone(r, 2, 90000);
    const e2 = await engineOf(r); // new photos go in front
    assert((await names(r))[0] === "after", "order " + (await names(r)));
    assert(e2 === "cpu-birefnet640", `next photo ran on ${e2}`);
    noErrors(r);
    await r.close();
    return `👎 ${first.engine}, retry ${e1}, next ${e2}`;
  });

  // A 👎 cuts in line (Kevin, 2026-11-22): its ISNet retry comes back while photos of the batch are still waiting,
  // and the batch then finishes on 640.
  await check("cpu 👎 during a batch: the retry cuts in line", async () => {
    const c6 = await context(), r = await page(c6);
    await r.go(`${base}/?engine=cpu&confetti=0`);
    await addPhotos(r, ["one", "two", "three", "four"]);
    const DONE = `${CARDS}.find((x) => !x.classList.contains("working") && !x.classList.contains("queued") && !x.querySelector(".dl").disabled)`;
    await r.until(`!!${DONE}`, 90000, "a first finished photo");
    const label = await r.ev(`${DONE}.querySelector(".rate:last-child").getAttribute("aria-label")`);
    if (!/try again/.test(label)) return { skip: `the CPU engine runs ISNet here (${label})` };
    await r.ev(`(() => { const c = ${DONE}; c.dataset.cut = "1"; c.querySelector(".rate:last-child").click(); })()`);
    await r.until(`(() => { const c = document.querySelector('[data-cut="1"]'); return c && !c.classList.contains("working") && !c.querySelector(".rate").disabled; })()`, 120000, "the retry's result");
    const waiting = await r.ev(`${CARDS}.filter((x) => x.classList.contains("queued") || x.classList.contains("working")).length`);
    assert(waiting > 0, "the retry came back only after the whole batch");
    await allDone(r, 4, 180000);
    noErrors(r);
    await r.close();
    return `${waiting} photo(s) still waiting when the retry came back`;
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

  // Other languages: a browser set to German gets the page in German from the first paint, with no layout shift.
  await check("i18n: a German browser gets German, from the first paint", async () => {
    const c = await context(), d = await page(c, { w: 390, h: 844, mobile: true, lang: "de-DE,de;q=0.9,en;q=0.8" });
    // What the first frame that holds the hero's line shows (animation frames run just before painting).
    await d.s("Page.addScriptToEvaluateOnNewDocument", { source: `requestAnimationFrame(function f() { const h = document.querySelector("#hero .sub"); if (h) window.__firstSub = h.textContent; else requestAnimationFrame(f); });` });
    await d.go(base + "/?confetti=0");
    const st = await d.ev(`({ lang: document.documentElement.lang, h1: document.querySelector("h1").textContent, pick: document.getElementById("pick").textContent,
      paste: document.getElementById("paste").textContent, alt: document.querySelector(".foot a").getAttribute("href"), title: document.title, langs: navigator.languages.join() })`);
    assert(st.lang === "de", `lang ${st.lang} (navigator.languages ${st.langs})`);
    assert(st.h1 === "Tschüss,Hintergrund." && st.pick === "Fotos wählen" && st.paste === "Einfügen", `not German: ${st.h1} / ${st.pick} / ${st.paste}`);
    assert(st.alt === "de/remove-bg-alternative/", "footer link goes to " + st.alt);
    assert(/^Hintergrund entfernen/.test(st.title), "title " + st.title);
    const first = await d.ev("window.__firstSub");
    assert(first && /Gerät/.test(first), "the parser showed this before the German: " + first);
    await sleep(500);
    const cls = (await d.ev("window.__ls")).reduce((a, b) => a + b, 0);
    assert(cls < 0.001, `layout shift on load: ${cls.toFixed(4)}`);
    await addPhotos(d, ["eins"]);
    await allDone(d, 1, 120000);
    const card = await d.ev(`({ dl: document.querySelector("#grid > .card .dl").getAttribute("aria-label"), crop: document.querySelector("#grid > .card .x").title,
      w: document.querySelector("#grid > .card .dl").getBoundingClientRect().width, wide: document.documentElement.scrollWidth > innerWidth + 1 })`);
    assert(card.dl === "Speichern" && card.crop === "Entfernen", `card not German: ${card.dl} / ${card.crop}`);
    assert(card.w >= 40 && !card.wide, `Download ${card.w} px wide, page wider than the screen: ${card.wide}`);
    noErrors(d); await cspClean(d);
    await d.close();
    // English first in the list stays English; ?lang= overrides (for testing).
    const e = await page(c, { lang: "en-US,de;q=0.9" });
    await e.go(base + "/");
    assert(await e.ev(`document.documentElement.lang === "en" && document.getElementById("pick").textContent === "Choose photos"`), "en-US, de: not English");
    await e.go(base + "/?lang=pt-BR");
    assert(await e.ev(`document.documentElement.lang === "pt-BR" && document.getElementById("pick").textContent === "Escolher fotos"`), "?lang=pt-BR: not Portuguese");
    await e.close();
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
    for (const path of ["/remove-bg-alternative/", "/how-to-remove-background/", ...TRANSLATED, "/no-such-page", "/"]) {
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
  await check("pages: translations link each other (hreflang, canonical, sitemap)", async () => {
    const sitemap = await (await fetch(base + "/sitemap.xml")).text();
    for (const path of ["/remove-bg-alternative/", "/how-to-remove-background/", ...TRANSLATED]) {
      const t = await (await fetch(base + path)).text();
      const canon = t.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "";
      assert(canon.endsWith(path), `${path}: canonical ${canon}`);
      const alts = [...t.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], new URL(m[2]).pathname]);
      const slug = path.split("/").at(-2);
      assert(alts.length === 7 && alts.find(([l]) => l === "x-default")?.[1] === `/${slug}/`, `${path}: hreflang ${JSON.stringify(alts)}`);
      const lang = t.match(/<html lang="([^"]+)"/)[1];
      assert(alts.find(([l]) => l === lang)?.[1] === path, `${path}: lang ${lang} doesn't match its hreflang`);
      assert(sitemap.includes(path + "</loc>"), `${path}: not in the sitemap`);
      if (path !== `/${slug}/`) { const words = t.replace(/<script[\s\S]*?<\/script>|<[^>]+>/g, " ").match(/\b(the|your|and|with)\b/gi); assert(!words, `${path}: English words left: ${words?.slice(0, 5)}`); }
    }
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
