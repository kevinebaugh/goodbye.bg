// Time the page's refineEdge in headless Chrome with CDP CPU throttling and single-threaded V8 (phone-like), against an
// older app.js in the same session, taking turns photo by photo. Data from ppchrome-prep.cjs.
//   BIG=~/goodbye-bg-quality/ppchrome/birefnet/big.json node ppchrome.mjs <repo> ~/goodbye-bg-quality/ppchrome birefnet 1,4,6 [old app.js]
// Photos are decoded and drawn to 1024 the way segment() does; the mask is the final BiRefNet mask (after the curve).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [REPO, DATA, SET, RATES = "1,4,6", OLD = ""] = process.argv.slice(2), FN = "refineEdge";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const grabFrom = (src) => (name) => { const i = src.indexOf(`function ${name}(`); if (i < 0) return ""; let depth = 0; for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && !--depth) return src.slice(i, k + 1); } };
const list = JSON.parse(readFileSync(join(DATA, SET, "list.json"), "utf8"));
const big = process.env.BIG ? JSON.parse(readFileSync(process.env.BIG, "utf8")) : []; // [{id, img}] 18 MP versions
const impl = (file) => { const g = grabFrom(readFileSync(file, "utf8")); return `(() => { ${g("morph")}\n${g("boxBlur")}\n${g("refineEdge")}\n return refineEdge; })()`; };
const versions = { new: join(REPO, "src/app.js"), ...(OLD ? { old: OLD } : {}) };
const code = `const RES = 1024; window.FNS = { ${Object.entries(versions).map(([k, f]) => `${k}: ${impl(f)}`).join(",\n")} }; window.FN = FNS.new;`;
const page = `<!doctype html><meta charset=utf-8><script>${code}</script>`;

const server = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
  if (u.pathname === "/mask") { res.writeHead(200); return res.end(readFileSync(join(DATA, SET, u.searchParams.get("id") + ".mask"))); }
  if (u.pathname === "/img") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(readFileSync(u.searchParams.get("p"))); }
  res.writeHead(404); res.end();
}).listen(0);
const port = server.address().port;

const tmp = mkdtempSync(join(tmpdir(), "ppbench-")), dport = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${dport}`, `--user-data-dir=${tmp}`, "--no-first-run",
  "--js-flags=--single-threaded --expose-gc", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${dport}/json/version`)).json(); } catch { await sleep(100); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.no(new Error(d.error.message)) : p.ok(d.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++id; pending.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);
const ev = async (expr) => { const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await s("Page.navigate", { url: `http://127.0.0.1:${port}/` }); await sleep(500);

// Load every photo (drawn to 1024 like segment()) and mask once; keep them in the page.
const items = list.map((r) => ({ id: r.id, img: r.img, label: `${r.id} ${r.w}x${r.h}` })).concat(big.map((b) => ({ id: b.id, img: b.img, label: `${b.id} 18MP` })));
await ev(`(async () => { window.T = [];
  for (const it of ${JSON.stringify(items)}) {
    const bmp = await createImageBitmap(await (await fetch("/img?p=" + encodeURIComponent(it.img))).blob());
    const t = performance.now(), c = new OffscreenCanvas(RES, RES), x = c.getContext("2d"); x.drawImage(bmp, 0, 0, RES, RES);
    const px = x.getImageData(0, 0, RES, RES).data, draw = performance.now() - t; bmp.close();
    const m = new Uint8Array(await (await fetch("/mask?id=" + it.id)).arrayBuffer());
    T.push({ label: it.label, px, m, draw });
  } return T.length; })()`);

const V = Object.keys(versions);
const RUN = `(v, i) => { const t = T[i], img = { data: new Uint8ClampedArray(RES * RES * 4) }; for (let k = 0; k < RES * RES; k++) img.data[k * 4 + 3] = t.m[k];
  const t0 = performance.now(); const n = FNS[v](t.px, img); return [performance.now() - t0, n, img]; }`;
await ev(`window.RUN = ${RUN}; true`);

// Bytes each call allocates in typed arrays (an upper bound on its peak: nothing is freed before it returns).
const alloc = {};
for (const v of V) alloc[v] = await ev(`(() => { const out = [], kinds = ["Float32Array", "Uint8Array", "Int32Array", "Float64Array", "Uint16Array"], orig = {};
  let bytes = 0; for (const k of kinds) { orig[k] = window[k]; const O = orig[k]; window[k] = new Proxy(O, { construct(t, a) { const o = new O(...a); bytes += o.byteLength; return o; } }); }
  const imgs = T.map((t) => { const d = new Uint8ClampedArray(RES * RES * 4); for (let k = 0; k < RES * RES; k++) d[k * 4 + 3] = t.m[k]; return { data: d }; });
  try { for (let i = 0; i < T.length; i++) { bytes = 0; FNS["${v}"](T[i].px, imgs[i]); out.push(bytes); } }
  finally { for (const k of kinds) window[k] = orig[k]; } return out; })()`);

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const results = { set: SET, items: items.map((it, i) => ({ label: it.label, ...Object.fromEntries(V.map((v) => [v + "MB", +(alloc[v][i] / 2 ** 20).toFixed(2)])) })), rates: {} };
for (const v of V) console.log(`${SET} ${v}: allocates median ${med(alloc[v].map((b) => b / 2 ** 20)).toFixed(1)} MB, max ${(Math.max(...alloc[v]) / 2 ** 20).toFixed(1)} MB`);
for (const rate of RATES.split(",").map(Number)) {
  await s("Emulation.setCPUThrottlingRate", { rate });
  for (const v of V) await ev(`(() => { for (let w = 0; w < 3; w++) RUN("${v}", w % T.length); return true; })()`); // warm-up
  const per = Object.fromEntries(V.map((v) => [v, []]));
  for (let i = 0; i < items.length; i++) for (const v of V) { // interleaved: old and new see the same load
    const ts = []; for (let k = 0; k < 3; k++) ts.push(await ev(`RUN("${v}", ${i})[0]`)); per[v].push(med(ts));
  }
  results.rates[rate] = {};
  for (const v of V) {
    results.rates[rate][v] = { per: per[v].map((x) => +x.toFixed(1)), median: +med(per[v]).toFixed(1), max: +Math.max(...per[v]).toFixed(1) };
    console.log(`${SET} ${v} ${rate}x: median ${med(per[v]).toFixed(0)} ms, max ${Math.max(...per[v]).toFixed(0)} ms (photos: ${items.length})`);
  }
}
await s("Emulation.setCPUThrottlingRate", { rate: 1 });
results.draw = await ev(`T.map((t) => +t.draw.toFixed(1))`);
// Checksums of the output masks (old and new must match bit for bit).
for (const v of V) results["sum_" + v] = await ev(`T.map((t, i) => { const img = RUN("${v}", i)[2]; let h = 2166136261; for (let k = 3; k < img.data.length; k += 4) { h ^= img.data[k]; h = Math.imul(h, 16777619); } return h >>> 0; })`);
if (V.length > 1) console.log("masks identical:", results.sum_new.every((x, i) => x === results.sum_old[i]));
console.log(JSON.stringify(results));
ws.close(); chrome.kill("SIGKILL"); server.close(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(0);
