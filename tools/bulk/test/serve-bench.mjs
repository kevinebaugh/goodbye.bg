// Photos a minute through a running `goodbye-bg serve`, the way a remove.bg script sends them (multipart image_file).
//   node test/serve-bench.mjs <folder of photos> [--clients 4] [--size auto] [--format auto] [--base http://localhost:5000/v1.0]
// Times from the first request to the last response; writes nothing.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dir = args[0], clients = +opt("clients", 4), size = opt("size", "auto"), format = opt("format", "auto");
const BASE = opt("base", "http://localhost:5000/v1.0");
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => path.join(dir, f));
const queue = files.slice();
let done = 0, failed = 0, bytesOut = 0, mp = 0;
const t0 = performance.now();
await Promise.all(Array.from({ length: clients }, async () => {
  for (let f; (f = queue.shift()); ) {
    const fd = new FormData();
    fd.append("image_file", new Blob([fs.readFileSync(f)]), path.basename(f));
    fd.append("size", size); fd.append("format", format);
    const res = await fetch(`${BASE}/removebg`, { method: "POST", body: fd, headers: { "X-Api-Key": "bench" } });
    const buf = await res.arrayBuffer();
    if (res.ok) { done++; bytesOut += buf.byteLength; mp += (res.headers.get("x-width") * res.headers.get("x-height")) / 1e6; }
    else { failed++; console.error(path.basename(f), res.status, Buffer.from(buf).toString().slice(0, 200)); }
  }
}));
const s = (performance.now() - t0) / 1000;
console.log(`${done} photos in ${s.toFixed(1)} s: ${((done / s) * 60).toFixed(0)} a minute (${clients} client${clients > 1 ? "s" : ""}, size=${size}, format=${format}, ${(mp / Math.max(1, done)).toFixed(2)} MP out, ${(bytesOut / Math.max(1, done) / 1e6).toFixed(2)} MB a reply)${failed ? `, ${failed} failed` : ""}`);
