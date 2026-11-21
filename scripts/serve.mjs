// Tiny static server for dist/ that applies dist/_headers, so local dev
// runs under the same security headers as production.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { onRequestGet as fetchFn } from "../functions/api/fetch.js";
import { onRequestPost as rateFn } from "../functions/api/rate.js";
import { onRequestPost as crashFn } from "../functions/api/crash.js";
let localCount = +(process.env.COUNT || 0);

const dist = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT) || 8788;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".bin": "application/octet-stream", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };

// Parse Cloudflare Pages' _headers format: a path line, then indented "Name: value" lines.
const rules = [];
for (const line of readFileSync(join(dist, "_headers"), "utf8").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
  else { const i = line.indexOf(":"); rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
}
const match = (pattern, path) => pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Run the Pages Function locally, same code as production.
  const fns = { "/api/rate": rateFn, "/api/crash": crashFn };
  // The global count lives in D1 in production; locally it is a number in memory.
  if (path === "/api/count") {
    if (req.method === "POST") localCount++;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ n: localCount, confetti: req.method === "POST" && localCount % 100 === 0 }));
    return;
  }
  if (fns[path] && req.method === "POST") {
    const body = await new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });
    const r = await fns[path]({ request: new Request(`http://localhost:${port}${path}`, { method: "POST", headers: req.headers, body }), env: {} });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text()); return;
  }
  if (path === "/api/fetch") {
    const r = await fetchFn({ request: new Request(new URL(req.url, `http://localhost:${port}`), { headers: req.headers }) });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body) res.write(chunk);
    res.end(); return;
  }
  const file = normalize(join(dist, path.endsWith("/") ? path + "index.html" : path));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw 0;
    const headers = { "Content-Type": types[extname(file)] || "application/octet-stream" };
    for (const r of rules) if (match(r.path, path)) Object.assign(headers, r.headers);
    res.writeHead(200, headers).end(await readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
}).listen(port, () => console.log(`goodbye.bg running at http://localhost:${port}`));
