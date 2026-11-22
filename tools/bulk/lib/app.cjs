// goodbye-bg app: the folder mode in a window. A small local page (lib/app/) served on 127.0.0.1 and opened in the
// user's browser. The page picks photos and options; this process reads the photos, cuts them out with the same engine
// and workers as the command line, and writes the cut-outs to a folder. Nothing leaves this computer.
//
// Two ways in:
// - "Choose folder": a native folder dialog run by this process (osascript on macOS, zenity on Linux, PowerShell on
//   Windows) gives a real path. The photos are read from disk and the cut-outs go next to the folder ("<name> cut-outs").
// - Dropped or browser-picked photos: browsers never tell a page where a file lives, so the page uploads each one to
//   this process (loopback only), which keeps it in a temporary folder until it is cut out. The cut-outs go to
//   ~/Downloads/<folder name> cut-outs, or a folder chosen with "Change".
//
// Safety: listens on 127.0.0.1 only; every /api request needs the random token from the URL this process opened;
// requests from other origins or host names are refused; the only paths ever opened in Finder are output folders this
// process made.
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { execFile } = require("child_process");
const { startEngine } = require("./engine.cjs");
const { MODELS } = require("./pipeline.cjs");
const B = require("./batch.cjs");
const VERSION = require("../package.json").version;
let MODEL_HELP = "birefnet (the only model in this build)";
if (MODELS.isnet) MODEL_HELP = "birefnet (default, MIT) or isnet (AGPL, faster on the CPU)"; // AGPL-only

const HELP = `goodbye-bg app: remove backgrounds in a window, in your browser. Nothing leaves this computer.

Usage: goodbye-bg [app] [options]

  --port <n>           port on 127.0.0.1 (default: any free one)
  --no-open            don't open the browser; just print the address
  --model <m>          ${MODEL_HELP}
  --engine <e>         auto (default), gpu or cpu
  --jobs <n>           photos in flight at once (default: 3)

It stops by itself a minute after its last window closes (or press Ctrl-C).`;

function fail(msg) { console.error(`goodbye-bg app: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const o = { port: 0, open: true, model: "birefnet", engine: "auto", jobs: 3, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { const v = argv[++i]; if (v === undefined) fail(`${a} needs a value`); return v; };
    if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
    else if (a === "--port" || a === "-p") { o.port = parseInt(val(), 10); if (!(o.port >= 0 && o.port < 65536)) fail("--port takes 0 to 65535"); }
    else if (a === "--no-open") o.open = false;
    else if (a === "--model") { o.model = val().toLowerCase(); if (!MODELS[o.model]) fail(`--model takes ${Object.keys(MODELS).join(" or ")}`); }
    else if (a === "--engine") { o.engine = val().toLowerCase(); if (!["auto", "gpu", "cpu"].includes(o.engine)) fail("--engine takes auto, gpu or cpu"); }
    else if (a === "--jobs" || a === "-j") { o.jobs = parseInt(val(), 10); if (!(o.jobs >= 1 && o.jobs <= 32)) fail("--jobs takes 1 to 32"); }
    else fail(`unknown option ${a} (see goodbye-bg app --help)`);
  }
  return o;
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};
const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin", "Cross-Origin-Opener-Policy": "same-origin",
};
const MAX_UPLOAD = 300 * 1024 * 1024;
const IDLE_MS = +process.env.GOODBYE_BG_IDLE_MS || 60000;

// Opens a URL or folder with the system's handler. Only ever given our own URL or an output folder we made.
// GOODBYE_BG_DRYOPEN=1 (tests) prints it instead.
function openWith(target) {
  if (process.env.GOODBYE_BG_DRYOPEN) return console.log(`open ${target}`);
  const [cmd, args] = process.platform === "darwin" ? ["open", [target]] : process.platform === "win32" ? ["explorer.exe", [target]] : ["xdg-open", [target]];
  execFile(cmd, args, () => {}); // explorer.exe exits 1 even when it worked
}

// A native folder dialog. Resolves to a path, or null if the user cancelled. GOODBYE_BG_PICK (and GOODBYE_BG_PICK_OUT
// for "Change") answer it without a dialog, for tests.
const pickAvailable = process.platform === "darwin" || process.platform === "win32" || !!process.env.GOODBYE_BG_PICK
  || (process.env.PATH || "").split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, "zenity")));
function nativePick(prompt, forOut) {
  const fake = forOut ? process.env.GOODBYE_BG_PICK_OUT : process.env.GOODBYE_BG_PICK;
  if (fake) return Promise.resolve(fake);
  let cmd, args;
  if (process.platform === "darwin") [cmd, args] = ["osascript", ["-e", `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`]];
  else if (process.platform === "win32") [cmd, args] = ["powershell.exe", ["-NoProfile", "-STA", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${prompt.replace(/'/g, "''")}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`]];
  else [cmd, args] = ["zenity", ["--file-selection", "--directory", `--title=${prompt}`]];
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 30 * 60 * 1000 }, (err, stdout) => {
    const p = String(stdout || "").trim();
    if (p) return resolve(p.length > 1 ? p.replace(/[\\/]+$/, "") : p);
    if (err && err.code === "ENOENT") return reject(new Error("No folder dialog on this computer"));
    resolve(null); // cancelled
  }));
}

const NAMED_BG = { white: [255, 255, 255], black: [0, 0, 0] };
// The page's options, checked: { bg: null | "white" | "#rrggbb", format, size: original|crop|<n>|<w>x<h>, pad: 0..30 }.
function toRunOptions(p, model) {
  const o = { model, bg: null, format: "png", crop: false, size: null, pad: 0.05 };
  if (p.bg != null && p.bg !== "transparent") {
    const v = String(p.bg).toLowerCase();
    if (NAMED_BG[v]) o.bg = NAMED_BG[v];
    else if (/^#[0-9a-f]{6}$/.test(v)) o.bg = [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16));
    else throw new Error("bad background");
  }
  if (!["png", "jpg", "webp"].includes(p.format)) throw new Error("bad format");
  o.format = p.format;
  const size = String(p.size || "original");
  if (size === "crop") o.crop = true;
  else if (size !== "original") {
    const m = /^(\d+)(?:x(\d+))?$/.exec(size); if (!m) throw new Error("bad size");
    o.size = [+m[1], +(m[2] || m[1])]; if (o.size.some((n) => n < 16 || n > 16384)) throw new Error("bad size");
  }
  const pad = +p.pad;
  if (!(pad >= 0 && pad <= 40)) throw new Error("bad margin");
  o.pad = pad / 100;
  if (o.format === "jpg" && !o.bg) o.bg = NAMED_BG.white; // JPEG has no transparency (the page says so)
  return o;
}

// A folder for the cut-outs that holds none made with other settings: base, else "base 2", "base 3", ... With
// fresh, it must hold no cut-outs at all (uploaded photos have no dates to resume by).
function freeFolder(base, settings, fresh) {
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base} ${n}`;
    if (!fs.existsSync(dir)) return dir;
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    if (fresh ? !B.hasFiles(dir) : !B.settingsClash(dir, settings).length) return dir;
  }
}

// A relative path from the page, made safe: no "..", no absolute paths, no empty or dot parts.
function safeRel(name) {
  const parts = String(name).split(/[\\/]+/).filter((s) => s && s !== ".");
  if (!parts.length || parts.some((s) => s === ".." || /[\0:]/.test(s))) return null;
  return parts.join(path.sep);
}

const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`; };
// Where uploaded photos' cut-outs go by default. GOODBYE_BG_DOWNLOADS: tests.
const downloads = () => { const d = process.env.GOODBYE_BG_DOWNLOADS || path.join(os.homedir(), "Downloads"); return fs.existsSync(d) ? d : os.homedir(); };

async function app(argv) {
  const o = parseArgs(argv);
  const token = crypto.randomBytes(16).toString("hex");
  const page = {};
  for (const [route, [file, type]] of Object.entries(STATIC)) page[route] = { body: fs.readFileSync(path.join(__dirname, "app", file)), type };

  // Server-sent events: the engine's state and the running job's progress, to every open window.
  const clients = new Set();
  const emit = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };

  // The engine starts at once, so the model is warm by the time photos are picked.
  let eng = null;
  const engineState = { phase: "starting", text: "Getting ready..." };
  const engineInfo = () => (eng ? { phase: "ready", text: `${o.model === "birefnet" ? "BiRefNet" : o.model} on the ${eng.engine === "gpu" ? "GPU" : "CPU"}` } : engineState);
  const engReady = startEngine(o, (t) => { engineState.text = t.replace(/^Starting the .* model\.\.\.$/, "Getting ready..."); emit("engine", engineInfo()); })
    .then((e) => { eng = e; emit("engine", engineInfo()); return e; }, (e) => { engineState.phase = "failed"; engineState.text = `The model could not start: ${String(e.message).split("\n")[0]}`; emit("engine", engineState); throw e; });
  engReady.catch(() => {});

  const picks = new Map(); // id -> { path, count }: folders chosen in a native dialog, the only paths the page can name
  const jobs = new Map();  // id -> job
  let current = null, picking = false;

  const summary = (j) => ({ id: j.id, kind: j.kind, total: j.total, done: j.done, failed: j.failed.length, empty: j.empty, skipped: j.skipped,
    out: j.outAbs, outName: path.basename(j.outAbs), running: !j.finished, stopping: j.stopping, secs: j.secs, rate: j.rate, items: j.items });

  async function createJob(body) {
    if (current && !current.finished) throw Object.assign(new Error("A batch is already running"), { status: 409 });
    let opts;
    try { opts = toRunOptions(body.options || {}, o.model); } catch (e) { throw Object.assign(e, { status: 400 }); }
    const settings = B.settingsOf(opts);
    const outPick = body.out ? picks.get(body.out) : null;
    if (body.out && !outPick) throw Object.assign(new Error("Unknown output folder"), { status: 400 });
    const j = { id: crypto.randomBytes(6).toString("hex"), opts, settings, done: 0, failed: [], empty: 0, skipped: 0, items: [], finished: false, stopping: false, secs: 0, rate: 0, staged: [] };

    if (body.source?.folder) {
      const src = picks.get(body.source.folder);
      if (!src) throw Object.assign(new Error("Unknown folder"), { status: 400 });
      j.kind = "folder";
      j.outAbs = freeFolder(outPick ? outPick.path : `${src.path} cut-outs`, settings, false);
      j.files = B.collect([src.path], path.resolve(j.outAbs));
      if (!j.files.length) throw Object.assign(new Error("No photos in that folder"), { status: 400 });
      B.plan(j.files, j.outAbs, opts.format);
      const todo = new Set(B.notDone(j.files));
      j.files.forEach((f, i) => { f.i = i; if (!todo.has(f)) { f.skip = true; j.skipped++; } });
    } else if (Array.isArray(body.source?.files) && body.source.files.length) {
      j.kind = "files"; j.client = String(body.client || "");
      let rels = body.source.files.map(safeRel);
      // A dropped folder: every path starts with its name. Name the output after it and leave it out of the paths.
      const tops = new Set(rels.map((r) => (r && r.includes(path.sep) ? r.split(path.sep)[0] : null)));
      const top = tops.size === 1 && [...tops][0];
      if (top) rels = rels.map((r) => r.slice(top.length + 1));
      j.outAbs = freeFolder(outPick ? outPick.path : path.join(downloads(), top ? `${top} cut-outs` : `Cut-outs ${stamp()}`), settings, true);
      j.staging = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "goodbye-bg-app-"));
      j.files = rels.map((rel, i) => ({ i, rel: rel || `photo-${i + 1}`, src: path.join(j.staging, `${i}${path.extname(rel || "").toLowerCase()}`), bad: !rel || !B.isPhoto(rel) }));
      B.plan(j.files, j.outAbs, opts.format);
      j.staged = j.files.map(() => { let res; const p = new Promise((r) => (res = r)); return { p, res, got: false }; });
    } else throw Object.assign(new Error("Nothing to do"), { status: 400 });

    j.total = j.files.length - j.skipped;
    B.writeSettings(j.outAbs, settings);
    jobs.set(j.id, j); current = j;
    run(j); // in the background; progress goes out as events
    return summary(j);
  }

  async function run(j) {
    let e;
    try { e = await engReady; } catch { j.failed.push({ rel: "", error: engineState.text }); return finish(j); }
    const jobOpts = { harden: e.spec.harden, bg: j.opts.bg, format: j.opts.format, crop: j.opts.crop, size: j.opts.size, pad: j.opts.pad };
    const queue = j.files.filter((f) => !f.skip);
    let at = 0;
    const next = async () => {
      const f = queue[at++];
      if (!f) return null;
      if (j.kind === "files") {
        if (f.bad) { f.error = "Not a photo this can read"; return f; }
        const err = await j.staged[f.i].p;
        f.error = err || null;
      }
      return f;
    };
    const t0 = performance.now();
    const tick = (f, item) => {
      j.items.push(item);
      j.secs = (performance.now() - t0) / 1000; j.rate = j.done / Math.max(0.001, j.secs);
      emit("photo", { id: j.id, item, done: j.done, failed: j.failed.length, total: j.total, secs: j.secs, rate: j.rate });
      if (j.kind === "files") fs.rm(f.src, { force: true }, () => {});
    };
    const batch = B.runBatch({
      eng: e, jobOpts, jobs: o.jobs, total: queue.length, next, isStopping: () => j.stopping,
      onDone: (f, m) => { j.done++; f.ok = true; if (m.empty) j.empty++; tick(f, { i: f.i, rel: f.rel, ok: true, empty: !!m.empty, w: m.outW, h: m.outH }); },
      onFail: (f, error) => { j.failed.push({ rel: f.rel, error }); tick(f, { i: f.i, rel: f.rel, ok: false, error: String(error).split("\n")[0] }); },
    });
    j.inflight = batch.inflight;
    await batch.done;
    j.secs = (performance.now() - t0) / 1000; j.rate = j.done / Math.max(0.001, j.secs);
    finish(j);
  }

  function finish(j) {
    j.finished = true;
    if (j.staging) fs.rm(j.staging, { recursive: true, force: true }, () => {});
    for (const s of j.staged) if (!s.got) s.res("Stopped before it was uploaded");
    emit("finished", summary(j));
    if (!clients.size) idleCheck();
  }

  // Stop after the photos in progress. Photos not yet uploaded count as failed, so the batch ends.
  const stopJob = (j) => { if (j.finished) return; j.stopping = true; for (const s of j.staged) if (!s.got) { s.got = true; s.res("Stopped before it was uploaded"); } emit("stopping", { id: j.id }); };

  // Lifecycle: stop a minute after the last window closes (a reload reconnects well within that), once no batch runs.
  // A dropped batch can't go on without its window (the window sends the photos), so it is stopped first.
  let idleTimer = null;
  const idleCheck = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (clients.size) return;
      if (current && !current.finished && current.kind === "files") stopJob(current);
      if (current && !current.finished) return; // finish() checks again
      console.log("The window was closed, so goodbye-bg stopped.");
      process.exit(0);
    }, IDLE_MS);
  };

  const send = (res, status, type, body, extra = {}) => { res.writeHead(status, { ...HEADERS, "Content-Type": type, ...extra }); res.end(body); };
  const json = (res, status, obj) => send(res, status, "application/json", JSON.stringify(obj));
  const readJson = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 8 * 1024 * 1024) { reject(Object.assign(new Error("Too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("Bad JSON"), { status: 400 })); } });
    req.on("error", reject);
  });
  const tokenOk = (t) => typeof t === "string" && t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));

  let port = o.port;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      // Only this computer's own page: the right Host (no DNS rebinding), no other origin, and the token for the API.
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(String(req.headers.host || "").toLowerCase())) return send(res, 403, "text/plain", "Unknown host name");
      if (req.headers.origin && !hosts.some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, "text/plain", "Requests from other pages are not accepted");
      if (req.method === "GET" && page[url.pathname]) return send(res, 200, page[url.pathname].type, page[url.pathname].body);
      if (!url.pathname.startsWith("/api/")) return send(res, 404, "text/plain", "Not found");
      if (!tokenOk(req.headers["x-token"] || url.searchParams.get("t"))) return send(res, 403, "text/plain", "Open the address goodbye-bg printed");
      const parts = url.pathname.split("/").slice(2); // api/<what>/<id>/<n>

      if (parts[0] === "events" && req.method === "GET") {
        res.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream", Connection: "keep-alive" });
        const client = crypto.randomBytes(6).toString("hex");
        res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION, client, engine: engineInfo(), canPick: pickAvailable, platform: process.platform, downloads: downloads(), job: current ? summary(current) : null })}\n\n`);
        clients.add(res); clearTimeout(idleTimer);
        const ping = setInterval(() => res.write(": ping\n\n"), 25000);
        // A dropped batch is fed by the window that started it: when that window closes or reloads, the batch stops.
        req.on("close", () => { clearInterval(ping); clients.delete(res); if (current && current.kind === "files" && current.client === client) stopJob(current); if (!clients.size) idleCheck(); });
        return;
      }
      if (parts[0] === "pick" && req.method === "POST") {
        const body = await readJson(req);
        if (!pickAvailable) return json(res, 400, { error: "No folder dialog on this computer" });
        if (picking) return json(res, 409, { error: "A folder dialog is already open" });
        picking = true;
        let p;
        try { p = await nativePick(body.for === "out" ? "Save the cut-outs in:" : "Cut out the photos in:", body.for === "out"); } finally { picking = false; }
        if (!p) return json(res, 200, { cancelled: true });
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return json(res, 400, { error: "That is not a folder" });
        const id = crypto.randomBytes(6).toString("hex");
        let count = null;
        if (body.for !== "out") { count = B.collect([p], null).length; }
        picks.set(id, { path: p, count });
        return json(res, 200, { id, path: p, name: path.basename(p) || p, count });
      }
      if (parts[0] === "job" && req.method === "POST" && parts.length === 1) return json(res, 200, await createJob(await readJson(req)));
      const j = parts[1] && jobs.get(parts[1]);
      if (!j) return json(res, 404, { error: "No such batch" });

      if (parts[0] === "file" && req.method === "PUT") { // /api/file/<job>/<n>: one uploaded photo, straight to the temporary folder
        const f = j.files[+parts[2]], s = j.staged[+parts[2]];
        if (j.kind !== "files" || !f || !s || s.got) return json(res, 400, { error: "Unexpected file" });
        if (j.finished || j.stopping) { req.resume(); return json(res, 409, { error: "Stopped" }); }
        if (+req.headers["content-length"] > MAX_UPLOAD) { req.resume(); s.got = true; s.res("Too large"); return json(res, 413, { error: "Too large" }); }
        const tmp = `${f.src}.part`;
        await new Promise((resolve) => {
          const w = fs.createWriteStream(tmp); let n = 0, bad = null;
          req.on("data", (c) => { n += c.length; if (n > MAX_UPLOAD && !bad) { bad = "Too large"; req.unpipe(w); w.destroy(); } });
          req.on("aborted", () => { bad ||= "Upload stopped"; w.destroy(); });
          req.pipe(w);
          w.on("close", () => {
            s.got = true;
            if (bad) { fs.rm(tmp, { force: true }, () => {}); s.res(bad); }
            else { try { fs.renameSync(tmp, f.src); s.res(null); } catch (e) { s.res(e.message); } }
            resolve();
          });
          w.on("error", (e) => { bad ||= e.message; });
        });
        return json(res, 200, { ok: true });
      }
      if (parts[0] === "thumb" && req.method === "GET") { // /api/thumb/<job>/<n>: a small copy of a finished cut-out
        const f = j.files[+parts[2]];
        if (!f || !f.ok) return send(res, 404, "text/plain", "Not ready");
        const sharp = require("sharp");
        const buf = await sharp(f.dst, { failOn: "none" }).resize(320, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 90 }).toBuffer();
        return send(res, 200, "image/webp", buf, { "Cache-Control": "private, max-age=3600" });
      }
      if (parts[0] === "stop" && req.method === "POST") {
        stopJob(j);
        return json(res, 200, { ok: true });
      }
      if (parts[0] === "reveal" && req.method === "POST") { openWith(j.outAbs); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      if (!e.status) console.error(`goodbye-bg app: ${e?.stack || e}`);
      if (!res.headersSent) json(res, e.status || 500, { error: String(e?.message || e).split("\n")[0] });
    }
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(o.port, "127.0.0.1", resolve); })
    .catch((e) => fail(e.code === "EADDRINUSE" ? `port ${o.port} is in use; pick another with --port, or leave it out` : e.message));
  port = server.address().port;
  const address = `http://127.0.0.1:${port}/#${token}`;
  console.log(`goodbye-bg ${VERSION}: the window is at ${address}`);
  console.log(o.open ? "Opened it in your browser. Leave this running; it stops a minute after the window closes, or press Ctrl-C." : "Open that address in a browser. Ctrl-C stops it.");
  if (o.open) openWith(address);
  process.once("SIGINT", () => {
    if (current && !current.finished) for (const { tmp } of current.inflight?.values() || []) fs.rmSync(tmp, { force: true });
    for (const j of jobs.values()) if (j.staging) fs.rmSync(j.staging, { recursive: true, force: true });
    process.exit(130);
  });
  return { port, token };
}

module.exports = { app };
