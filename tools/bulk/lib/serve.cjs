// goodbye-bg serve: a local stand-in for remove.bg's API (POST /v1.0/removebg, GET /v1.0/account). Scripts written for
// remove.bg keep working with only the base URL changed to http://localhost:<port>/v1.0. Photos stay on this computer;
// image_url and bg_image_url are fetched only with --allow-urls.
"use strict";
const http = require("http"), path = require("path");
const { Worker } = require("worker_threads");
const { startEngine } = require("./engine.cjs");
const { MODELS } = require("./pipeline.cjs");
const { parseRequest, ApiError } = require("./api.cjs");
const VERSION = require("../package.json").version;
let MODEL_HELP = "birefnet (the only model in this build)";
if (MODELS.isnet) MODEL_HELP = "birefnet (default, MIT) or isnet (AGPL)"; // AGPL-only

const HELP = `goodbye-bg serve: remove.bg's API on this computer. Nothing is uploaded.

Usage: goodbye-bg serve [options]

  --port <n>           port (default: 5000)
  --host <addr>        address to listen on (default: 127.0.0.1, and ::1 so "localhost" works)
  --allow-urls         fetch image_url and bg_image_url (off by default; otherwise the only network use is the one-time model download)
  --model <m>          ${MODEL_HELP}
  --engine <e>         auto (default), gpu or cpu
  --jobs <n>           photos prepared at once (default: 3)
  --quiet              no log line per request

Point a remove.bg client at http://localhost:5000/v1.0 instead of https://api.remove.bg/v1.0. Any API key, or none.`;

const MAX_FILE = 22 * 1024 * 1024, MAX_BODY = 40 * 1024 * 1024; // remove.bg: files up to 22 MB; base64 (url-encoded) is a third bigger and more
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function fail(msg) { console.error(`goodbye-bg serve: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const o = { port: 5000, host: "127.0.0.1", allowUrls: false, model: "birefnet", engine: "auto", jobs: 3, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { const v = argv[++i]; if (v === undefined) fail(`${a} needs a value`); return v; };
    if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
    else if (a === "--port" || a === "-p") { o.port = parseInt(val(), 10); if (!(o.port >= 0 && o.port < 65536)) fail("--port takes 0 to 65535"); }
    else if (a === "--host") o.host = val();
    else if (a === "--allow-urls") o.allowUrls = true;
    else if (a === "--model") { o.model = val().toLowerCase(); if (!MODELS[o.model]) fail(`--model takes ${Object.keys(MODELS).join(" or ")}`); }
    else if (a === "--engine") { o.engine = val().toLowerCase(); if (!["auto", "gpu", "cpu"].includes(o.engine)) fail("--engine takes auto, gpu or cpu"); }
    else if (a === "--jobs" || a === "-j") { o.jobs = parseInt(val(), 10); if (!(o.jobs >= 1 && o.jobs <= 32)) fail("--jobs takes 1 to 32"); }
    else if (a === "--quiet" || a === "-q") o.quiet = true;
    else fail(`unknown option ${a} (see goodbye-bg serve --help)`);
  }
  return o;
}

// Fetch a picture for image_url / bg_image_url: http(s) only, 22 MB at most, 20 s at most.
async function download(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": `goodbye-bg/${VERSION}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (+res.headers.get("content-length") > MAX_FILE) throw Object.assign(new Error("too large"), { tooLarge: true });
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > MAX_FILE) throw Object.assign(new Error("too large"), { tooLarge: true }); chunks.push(c); }
  return Buffer.concat(chunks);
}
const tooLarge = () => new ApiError(400, "file_too_large", "File too large", "File exceeds limit of 22MB");

async function serve(argv) {
  const o = parseArgs(argv);
  const say = (s) => { if (!o.quiet) process.stderr.write(s + "\n"); };
  let eng;
  try { eng = await startEngine(o); } catch (e) { if (e.fatal) fail(e.message); throw e; }
  const harden = eng.spec.harden;

  // A pool of workers that stays up. Each takes one photo at a time; the engine runs one mask at a time.
  const idle = [], waiting = [];
  const workers = Array.from({ length: o.jobs }, () => {
    const w = new Worker(path.join(__dirname, "worker.cjs"));
    w.on("message", (m) => {
      if (m.type === "infer") {
        eng.infer(m.px).then((mask) => w.postMessage({ type: "mask", id: m.id, mask }, [mask.buffer]), (e) => w.postMessage({ type: "maskerr", id: m.id, error: String(e?.message || e) }));
        return;
      }
      const cb = w.cb; w.cb = null; release(w); cb(m);
    });
    w.on("error", (e) => { const cb = w.cb; w.cb = null; if (cb) cb({ type: "fail", error: String(e.message) }); console.error(`goodbye-bg serve: a worker stopped: ${e.message}`); process.exit(1); });
    idle.push(w);
    return w;
  });
  const release = (w) => { const next = waiting.shift(); if (next) next(w); else idle.push(w); };
  const getWorker = () => (idle.length ? Promise.resolve(idle.pop()) : new Promise((r) => waiting.push(r)));
  const runJob = async (msg, transfer) => {
    const w = await getWorker();
    return new Promise((resolve) => { w.cb = resolve; w.postMessage(msg, transfer); });
  };

  const send = (res, status, headers, body) => { res.writeHead(status, { Server: `goodbye-bg/${VERSION}`, ...headers }); res.end(body); };
  const sendErrors = (res, status, errors) => send(res, status, { "Content-Type": "application/json" }, JSON.stringify({ errors }));
  const errBody = (e) => [Object.fromEntries(Object.entries({ code: e.code, title: e.title, detail: e.detail }).filter(([, v]) => v))];

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > MAX_BODY) { reject(tooLarge()); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  async function fields(req) {
    const ct = String(req.headers["content-type"] || "");
    const body = await readBody(req);
    if (/^application\/json/i.test(ct)) {
      try { const j = JSON.parse(body.toString("utf8") || "{}"); return j && typeof j === "object" ? j : {}; } catch { throw new ApiError(400, "invalid_json", "Invalid JSON body"); } // ours
    }
    if (/^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(ct)) {
      let fd;
      try { fd = await new Response(body, { headers: { "content-type": ct } }).formData(); } catch { throw new ApiError(400, "invalid_body", "Could not read the form data"); } // ours
      const f = {};
      for (const [k, v] of fd.entries()) if (!(k in f)) f[k] = v;
      return f;
    }
    if (!body.length) return {};
    throw new ApiError(400, "invalid_body", "Send multipart/form-data, application/x-www-form-urlencoded or application/json"); // ours
  }

  async function bytesOf(src, isBg) {
    if (src.kind === "bytes") return src.bytes;
    if (src.kind === "file") return Buffer.from(await src.blob.arrayBuffer());
    if (!o.allowUrls) throw new ApiError(400, "url_fetch_disabled", `${isBg ? "bg_image_url" : "image_url"} is turned off on this local server`, "Send the image as image_file or image_file_b64, or start the server with --allow-urls."); // ours
    try { return await download(src.url); }
    catch (e) {
      if (e.tooLarge) throw tooLarge();
      throw isBg ? new ApiError(400, "failed_bg_download", `Failed to download background image from given image_url: ${src.url}`)
        : new ApiError(400, "failed_image_download", `Failed to download image from given image_url: ${src.url}`);
    }
  }

  async function removebg(req, res) {
    const p = await parseRequest(await fields(req), { harden });
    const img = await bytesOf(p.image, false);
    if (img.length > MAX_FILE) throw tooLarge();
    const bgImg = p.bgImage ? await bytesOf(p.bgImage, true) : null;
    const imgU8 = new Uint8Array(img.buffer, img.byteOffset, img.byteLength).slice();
    const bgU8 = bgImg && new Uint8Array(bgImg.buffer, bgImg.byteOffset, bgImg.byteLength).slice();
    const m = await runJob({ type: "api", img: imgU8, bgImg: bgU8, o: { ...p.o, bgImage: !!bgImg } }, bgU8 ? [imgU8.buffer, bgU8.buffer] : [imgU8.buffer]);
    if (m.type === "fail") {
      if (m.api) throw new ApiError(m.api.status, m.api.code, m.api.title, m.api.detail);
      throw new Error(m.error);
    }
    const body = Buffer.from(m.body.buffer, m.body.byteOffset, m.body.byteLength);
    const headers = {
      "X-Width": m.outW, "X-Height": m.outH, "X-Credits-Charged": "0",
      "X-Foreground-Top": m.fg.top, "X-Foreground-Left": m.fg.left, "X-Foreground-Width": m.fg.width, "X-Foreground-Height": m.fg.height,
    };
    if (/application\/json/i.test(String(req.headers.accept || ""))) {
      send(res, 200, { ...headers, "Content-Type": "application/json" }, JSON.stringify({ data: {
        result_b64: body.toString("base64"), foreground_top: m.fg.top, foreground_left: m.fg.left, foreground_width: m.fg.width, foreground_height: m.fg.height,
      } }));
    } else {
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/zip": "zip" }[m.type] || "bin";
      send(res, 200, { ...headers, "Content-Type": m.type, "Content-Disposition": `attachment; filename=no-bg.${ext}` }, body);
    }
  }

  const server = (host) => http.createServer(async (req, res) => {
    const t = performance.now();
    const url = new URL(req.url, "http://x"), route = url.pathname.replace(/\/+$/, "").replace(/^\/v1\.0(?=\/|$)/, "");
    res.on("finish", () => { if (!o.quiet) say(`${req.method} ${url.pathname} ${res.statusCode} ${Math.round(performance.now() - t)} ms`); });
    try {
      // Only scripts and programs on this computer: no requests from web pages (a page could otherwise make this
      // computer fetch URLs or do work), and on loopback no other host names (DNS rebinding).
      if (req.headers.origin) return sendErrors(res, 403, [{ title: "Requests from web pages are not accepted by this local server" }]);
      const hn = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
      if (LOOPBACK.has(host) && !LOOPBACK.has(hn)) return sendErrors(res, 403, [{ title: "Unknown host name" }]);
      if (route === "/removebg" && req.method === "POST") return await removebg(req, res);
      if (route === "/account" && req.method === "GET") {
        // Nothing is counted here. The numbers say "plenty" to scripts that check the balance first.
        return send(res, 200, { "Content-Type": "application/json" }, JSON.stringify({ data: { attributes: {
          credits: { total: 1000000, subscription: 0, payg: 1000000, enterprise: 0 }, api: { free_calls: 1000000, sizes: "all" },
        } } }));
      }
      if (route === "" && req.method === "GET") return send(res, 200, { "Content-Type": "text/plain; charset=utf-8" }, `goodbye-bg ${VERSION}: remove.bg's API on this computer (${o.model} on the ${eng.engine === "gpu" ? "GPU" : "CPU"}).\nPOST /v1.0/removebg, GET /v1.0/account.\n`);
      if (route === "/improve") return sendErrors(res, 404, [{ code: "unsupported_endpoint", title: "The improvement program is not part of this local server" }]);
      if (route === "/removebg" || route === "/account") return sendErrors(res, 405, [{ title: "Method not allowed" }]);
      return sendErrors(res, 404, [{ title: "Not found" }]);
    } catch (e) {
      if (e instanceof ApiError) return sendErrors(res, e.status, errBody(e));
      console.error(`goodbye-bg serve: ${e?.stack || e}`);
      return sendErrors(res, 500, [{ code: "internal_error", title: "Something went wrong cutting out this image", detail: String(e?.message || e).split("\n")[0] }]); // ours
    }
  });

  // Listen. The default 127.0.0.1 also gets ::1, because "localhost" may resolve to ::1 first, and on Macs AirPlay
  // Receiver listens on port 5000 for every address: without ::1, localhost:5000 reaches AirPlay (a 403 from AirTunes).
  const hosts = o.host === "127.0.0.1" ? ["127.0.0.1", "::1"] : [o.host];
  const listening = [];
  for (const h of hosts) {
    const s = server(h);
    try {
      await new Promise((resolve, reject) => { s.once("error", reject); s.listen(o.port, h, resolve); });
      listening.push(s);
      if (!o.port) o.port = s.address().port;
    } catch (e) {
      if (h === "::1") { say(`Note: could not listen on [::1]:${o.port} (${e.code}); use http://127.0.0.1:${o.port}, not localhost.`); continue; }
      if (e.code === "EADDRINUSE") fail(`port ${o.port} is in use on ${h}. Pick another with --port (on Macs, AirPlay Receiver uses 5000).`);
      fail(`could not listen on ${h}:${o.port}: ${e.message}`);
    }
  }
  const shown = o.host === "127.0.0.1" ? (listening.length > 1 ? "localhost" : "127.0.0.1") : o.host.includes(":") ? `[${o.host}]` : o.host;
  console.log(`goodbye-bg ${VERSION}: remove.bg's API at http://${shown}:${o.port}/v1.0 (${o.model} on the ${eng.engine === "gpu" ? "GPU" : "CPU"}, ready in ${(eng.stats.readyMs / 1000).toFixed(1)} s). Ctrl-C stops it.`);
  if (!LOOPBACK.has(o.host)) console.log(`Note: listening on ${o.host}, so other computers that can reach it can use it. There is no key check.`);
  if (!o.allowUrls) console.log(`image_url and bg_image_url are off (--allow-urls turns them on).`);
  process.once("SIGINT", () => { for (const s of listening) s.close(); for (const w of workers) w.terminate(); Promise.resolve(eng.release()).finally(() => process.exit(0)); });
  return { port: o.port };
}

module.exports = { serve };
