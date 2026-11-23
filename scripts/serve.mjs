// Tiny static server for dist/ that applies dist/_headers, so local dev
// runs under the same security headers as production.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { onRequestGet as fetchFn } from "../functions/api/fetch.js";
import { onRequestPost as rateFn } from "../functions/api/rate.js";
import { onRequestPost as crashFn } from "../functions/api/crash.js";
import { onRequestPost as diagFn } from "../functions/api/diag.js";
import { onRequestGet as goGet, onRequestPost as goPost } from "../functions/go/[id].js";
import { onRequestPut as capPut } from "../functions/api/cap/[key].js";
import { onRequestGet as capGet, onRequestHead as capHead } from "../functions/cap/[file].js";

import { ZAZZLE_CAP } from "../lib/partners.mjs";
// Local only: CAP_TEST_MEMBER=<id> CAP_TEST_PD=<pd> fills every product's template, to try the redirect.
if (process.env.CAP_TEST_PD) { ZAZZLE_CAP.member ||= process.env.CAP_TEST_MEMBER || "000000000000000000"; for (const k in ZAZZLE_CAP.pd) ZAZZLE_CAP.pd[k] ||= process.env.CAP_TEST_PD; }
// In-memory stand-in for the R2 bucket (binding CAP) behind the Zazzle hand-off (off with ?zazzlecap=0).
const capStore = new Map();
const capObj = (k) => { const o = capStore.get(k); return o && { key: k, size: o.body.byteLength, customMetadata: o.meta, body: new Blob([o.body]).stream() }; };
const CAP = {
  async put(k, body, opt = {}) { if (opt.onlyIf && capStore.has(k)) return null; capStore.set(k, { body: Buffer.from(body), meta: opt.customMetadata || {} }); return capObj(k); },
  async head(k) { return capObj(k) || null; },
  async get(k) { return capObj(k) || null; },
  async delete(k) { for (const x of [].concat(k)) capStore.delete(x); },
  async list({ prefix = "" } = {}) { return { objects: [...capStore.keys()].filter((k) => k.startsWith(prefix)).map(capObj) }; },
};
const waitUntil = (p) => { p.catch(() => {}); }; // like Pages: work that goes on after the response (the 20 s delete after Zazzle's fetch)
const readBody = (req) => new Promise((ok) => { const d = []; req.on("data", (c) => d.push(c)); req.on("end", () => ok(Buffer.concat(d))); });
const LIVE = process.env.LIVE || "https://goodbye.bg";

const dist = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT) || 8788;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".bin": "application/octet-stream", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".woff2": "font/woff2", ".gif": "image/gif", ".jpg": "image/jpeg", ".ico": "image/x-icon" };

// Parse Cloudflare Pages' _headers format: a path line, then indented "Name: value" lines.
const rules = [];
for (const line of readFileSync(join(dist, "_headers"), "utf8").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
  else { const i = line.indexOf(":"); rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
}
// _redirects: "from to [status]" lines (exact paths only; that is all the site uses).
const redirects = [];
try {
  for (const line of readFileSync(join(dist, "_redirects"), "utf8").split("\n")) {
    const [from, to, status] = line.trim().split(/\s+/);
    if (from && !from.startsWith("#") && to) redirects.push({ from, to, status: Number(status) || 302 });
  }
} catch {}
const match = (pattern, path) => pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Run the Pages Function locally, same code as production.
  const go = path.match(/^\/go\/([a-z0-9-]+)$/);
  if (go) {
    const fn = req.method === "POST" ? goPost : goGet;
    const r = await fn({ params: { id: go[1] }, env: { CAP }, request: new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method, headers: req.headers }) });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(r.body ? await r.text() : undefined); return; // the waiting page has a body
  }
  const capUp = path.match(/^\/api\/cap\/([^/]+)$/);
  if (capUp && req.method === "PUT") {
    const body = await readBody(req);
    const r = await capPut({ params: { key: capUp[1] }, env: { CAP }, waitUntil, request: new Request(`http://localhost:${port}${path}`, { method: "PUT", headers: req.headers, body }) });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text()); return;
  }
  const capDown = path.match(/^\/cap\/([^/]+)$/);
  if (capDown) {
    const r = await (req.method === "HEAD" ? capHead : capGet)({ params: { file: capDown[1] }, env: { CAP }, waitUntil, request: new Request(new URL(req.url, `http://localhost:${port}`)) });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined); return;
  }
  const fns = { "/api/rate": rateFn, "/api/crash": crashFn, "/api/diag": diagFn };
  // The global count lives in D1 in production. Local tests count too (Kevin: "it should go up into
  // perpetuity"), so the local server passes /api/count straight through to the live site.
  if (path === "/api/count") {
    try {
      const r = await fetch(`${LIVE}/api/count`, { method: req.method === "POST" ? "POST" : "GET" });
      res.writeHead(r.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(await r.text());
    } catch { res.writeHead(200, { "Content-Type": "application/json" }).end('{"n":0}'); }
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
  // Like Pages: _redirects first, then "pretty URLs" (/dir -> /dir/, /x.html -> /x, /index.html -> /).
  const qs = new URL(req.url, "http://x").search;
  const red = redirects.find((r) => r.from === path);
  if (red) { res.writeHead(red.status, { Location: red.to }).end(); return; }
  const isFile = async (f) => { try { return (await stat(f)).isFile(); } catch { return false; } };
  if (path.endsWith(".html")) { res.writeHead(308, { Location: path.replace(/(index)?\.html$/, "") + qs }).end(); return; }
  if (!path.endsWith("/") && !extname(path) && await isFile(join(dist, path, "index.html"))) { res.writeHead(308, { Location: path + "/" + qs }).end(); return; }
  const file = normalize(join(dist, path.endsWith("/") ? path + "index.html" : path));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  const headersFor = (f) => {
    const headers = { "Content-Type": types[extname(f)] || "application/octet-stream" };
    for (const r of rules) if (match(r.path, path)) Object.assign(headers, r.headers);
    return headers;
  };
  if (await isFile(file)) { res.writeHead(200, headersFor(file)).end(await readFile(file)); return; }
  // Unknown path: Pages answers with 404.html and status 404.
  const nf = join(dist, "404.html");
  if (await isFile(nf)) res.writeHead(404, headersFor(nf)).end(await readFile(nf));
  else res.writeHead(404).end("Not found");
}).listen(port, () => console.log(`goodbye.bg running at http://localhost:${port}`));
