// Throughput of the window against the command line, on the same photos and settings (see-through PNG, full size).
//
//   node test/app-bench.mjs <folder of photos> [--rounds 3] [--white] [--bin <goodbye-bg binary>]
//
// Alternates: the CLI (GOODBYE_BG_STATS gives its first-photo-to-last time), the window's "Choose folder" path
// (photos read from disk) and its drop path (each photo sent to it over loopback), both through the same HTTP API
// the page uses, with the app kept running (warm), as a user would. Photos a minute, start-up not included.
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const photos = path.resolve(args[0]);
const rounds = +opt("--rounds", 3), BIN = opt("--bin", null);
const names = fs.readdirSync(photos).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "goodbye-bg-bench-"));
const nextTo = `${photos} cut-outs`;
if (fs.existsSync(nextTo)) throw new Error(`${nextTo} exists; the bench writes there and removes it, so move it away first`);
const cmd = (a) => (BIN ? [BIN, a] : [process.execPath, [path.join(ROOT, "bin/goodbye-bg.cjs"), ...a]]);

const env = { ...process.env, GOODBYE_BG_DOWNLOADS: tmp, GOODBYE_BG_PICK: photos, GOODBYE_BG_DRYOPEN: "1" };
const [c, a] = cmd(["app", "--no-open"]);
const app = spawn(c, a, { env, stdio: ["ignore", "pipe", "inherit"] });
let out = "";
const address = await new Promise((r) => app.stdout.on("data", (d) => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)\/#([0-9a-f]+)/.exec(out); if (m) r(m); }));
const [, origin, token] = address;
const H = { "X-Token": token, "Content-Type": "application/json" };
const post = (p, b) => fetch(origin + p, { method: "POST", headers: H, body: JSON.stringify(b) }).then((r) => r.json());

// The event stream: resolves waiters on "finished" and on the engine becoming ready.
const waiters = [];
let ready;
const readyP = new Promise((r) => (ready = r));
(async () => {
  const res = await fetch(`${origin}/api/events?t=${token}`);
  let buf = "";
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString();
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = /^event: (.*)$/m.exec(ev)?.[1], data = /^data: (.*)$/m.exec(ev)?.[1];
      if (!type) continue;
      const d = JSON.parse(data);
      if ((type === "hello" && d.engine.phase === "ready") || (type === "engine" && d.phase === "ready")) ready();
      if (type === "finished") waiters.shift()?.(d);
    }
  }
})();
await readyP;
const finished = () => new Promise((r) => waiters.push(r));
// --white: white JPG, square 2000, 8% margin (the CLI's --bg white --size 2000 --pad 8%) instead of see-through PNG.
const white = args.includes("--white");
const options = white ? { bg: "white", format: "jpg", size: "2000", pad: 8 } : { bg: null, format: "png", size: "original", pad: 5 };
const cliFlags = white ? ["--bg", "white", "--size", "2000", "--pad", "8%"] : [];
// Every cut-out's sha256, by name: the three ways must give the same bytes.
const hashDir = (d) => JSON.stringify(fs.readdirSync(d).filter((f) => !f.startsWith(".")).sort().map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(d, f))).digest("hex")]));

async function viaFolder() {
  fs.rmSync(nextTo, { recursive: true, force: true });
  const p = await post("/api/pick", { for: "folder" });
  const f = finished();
  await post("/api/job", { source: { folder: p.id }, options });
  const s = await f; s.hash = hashDir(s.out);
  return s;
}
async function viaDrop() {
  const f = finished();
  const j = await post("/api/job", { source: { files: names }, options });
  let at = 0;
  const one = async () => { while (at < names.length) { const i = at++; await fetch(`${origin}/api/file/${j.id}/${i}`, { method: "PUT", headers: { "X-Token": token }, body: fs.readFileSync(path.join(photos, names[i])) }); } };
  await Promise.all([one(), one(), one()]);
  const s = await f;
  s.hash = hashDir(s.out);
  fs.rmSync(s.out, { recursive: true, force: true });
  return s;
}
function viaCli() {
  const stats = path.join(tmp, "stats.json"), dir = path.join(tmp, "cli");
  fs.rmSync(dir, { recursive: true, force: true });
  const [c2, a2] = cmd([photos, "--out", dir, "--quiet", ...cliFlags]);
  execFileSync(c2, a2, { env: { ...process.env, GOODBYE_BG_STATS: stats }, stdio: "ignore" });
  const s = JSON.parse(fs.readFileSync(stats, "utf8"));
  return { done: s.done, secs: s.secs, ready: s.ready, hash: hashDir(dir) };
}

const rows = { cli: [], folder: [], drop: [] };
let failed = false;
for (let r = 0; r < rounds; r++) {
  const c1 = viaCli(); rows.cli.push(c1);
  const f1 = await viaFolder(); rows.folder.push(f1);
  const d1 = await viaDrop(); rows.drop.push(d1);
  const pm = (x) => ((x.done / x.secs) * 60).toFixed(0);
  const same = c1.hash === f1.hash && c1.hash === d1.hash;
  if (!same) failed = true;
  console.log(`round ${r + 1}: CLI ${pm(c1)} a minute (+${c1.ready.toFixed(1)} s start), window folder ${pm(f1)}, window drop ${pm(d1)} (${names.length} photos); cut-outs ${same ? "byte for byte the same" : "DIFFER"}`);
}
const med = (xs) => { const s = xs.map((x) => (x.done / x.secs) * 60).sort((p, q) => p - q); return s[Math.floor(s.length / 2)].toFixed(0); };
console.log(`median photos a minute: CLI ${med(rows.cli)}, window (folder) ${med(rows.folder)}, window (drop) ${med(rows.drop)}; load average ${os.loadavg().map((x) => x.toFixed(1)).join(" ")}`);
fs.rmSync(nextTo, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
app.kill("SIGINT");
process.exit(failed ? 1 : 0);
