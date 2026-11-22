// goodbye-bg's local window. Talks only to the goodbye-bg process that served it (127.0.0.1), with the token from the
// address it opened. Picks photos and options, starts a batch, shows the cut-outs as they land.
"use strict";
const $ = (id) => document.getElementById(id);
const TOKEN = location.hash.slice(1);
const EXTS = /\.(jpe?g|jpe|jfif|png|webp|avif|tiff?|gif|heic|heif)$/i;
const api = (p, opts = {}) => fetch(p, { ...opts, headers: { "X-Token": TOKEN, ...(opts.body && !(opts.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...opts.headers } })
  .then(async (r) => { const j = r.headers.get("content-type")?.includes("json") ? await r.json() : {}; if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; });

let info = { canPick: false, platform: "" };
let source = null; // { kind: "folder", id, name, path, count } or { kind: "files", files: [{ file, rel }], name }
let outPick = null; // { id, path } from "Change"
let job = null;     // the running or last batch: { id, total, out, ... }
let shown = 0;
const early = {}, earlyItems = {}; // events for a batch that came before its own reply, by id
const MAX_CARDS = 400;

// ---- options, remembered in this browser ----
const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const val = (name) => radios(name).find((r) => r.checked)?.value;
const setVal = (name, v) => { const r = radios(name).find((x) => x.value === v); if (r && !r.disabled) r.checked = true; };
function options() {
  const bg = val("bg");
  return { bg: bg === "transparent" ? null : bg === "white" ? "white" : $("bgColor").value, format: val("format"), size: val("size"), pad: +$("pad").value };
}
function syncOptions() {
  const jpg = val("format") === "jpg";
  const see = radios("bg").find((r) => r.value === "transparent");
  see.disabled = jpg;
  if (jpg && see.checked) setVal("bg", "white");
  $("jpgNote").hidden = !jpg;
  $("marginSet").hidden = !/^\d/.test(val("size"));
  $("padOut").value = `${$("pad").value}%`;
  try { localStorage.setItem("goodbye-bg-bulk", JSON.stringify({ bgKind: val("bg"), color: $("bgColor").value, format: val("format"), size: val("size"), pad: $("pad").value })); } catch {}
  showOut();
}
function restoreOptions() {
  let s = null; try { s = JSON.parse(localStorage.getItem("goodbye-bg-bulk")); } catch {}
  if (!s) return;
  if (s.color) $("bgColor").value = s.color;
  setVal("format", s.format); setVal("size", s.size);
  if (s.pad != null) $("pad").value = s.pad;
  syncOptions(); setVal("bg", s.bgKind);
}
for (const n of ["bg", "format", "size"]) for (const r of radios(n)) r.addEventListener("change", syncOptions);
$("pad").addEventListener("input", syncOptions);
$("bgColor").addEventListener("input", () => { setVal("bg", "color"); syncOptions(); });
$("bgColor").addEventListener("click", () => { setVal("bg", "color"); syncOptions(); });

// ---- choosing photos ----
const sep = () => (info.platform === "win32" ? "\\" : "/");
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; }; // the folder gets the time it starts
function showOut() {
  if (!source) return;
  let p;
  if (outPick) p = outPick.path;
  else if (source.kind === "folder") p = `${source.path} cut-outs`;
  else p = `${info.downloads || "Downloads"}${sep()}${source.top ? `${source.top} cut-outs` : `Cut-outs ${stamp()}`}`;
  $("outPath").textContent = p;
}
function chosen(src) {
  if (!src.count) { note("No photos there (JPG, PNG, WebP, AVIF, TIFF, GIF, HEIC).", true); return; }
  source = src; outPick = null;
  $("pickedName").textContent = src.name;
  $("pickedCount").textContent = `${src.count} photo${src.count === 1 ? "" : "s"}`;
  $("pickedCount").classList.toggle("muted", !!src.name); // no folder name: the count is the title
  view("setup"); showOut();
}
function fromFiles(list, name) {
  const files = list.filter((x) => EXTS.test(x.rel) && !x.rel.split("/").some((s) => s.startsWith(".") || s === "__MACOSX"));
  files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true, sensitivity: "base" }));
  const tops = new Set(files.map((x) => (x.rel.includes("/") ? x.rel.split("/")[0] : null)));
  const top = tops.size === 1 ? [...tops][0] : null;
  chosen({ kind: "files", files, count: files.length, top, name: name || top || "" });
}
const note = (t, err) => { $("pickNote").textContent = t || ""; $("pickNote").classList.toggle("err", !!err); };

$("pickFolder").addEventListener("click", async () => {
  if (!info.canPick) return $("dirIn").click(); // the browser's own folder picker: the photos are sent to goodbye-bg
  try {
    note("");
    const r = await api("/api/pick", { method: "POST", body: JSON.stringify({ for: "folder" }) });
    if (r.cancelled) return;
    chosen({ kind: "folder", id: r.id, name: r.name, path: r.path, count: r.count });
  } catch (e) { note(e.message, true); }
});
$("pickFiles").addEventListener("click", () => $("filesIn").click());
$("filesIn").addEventListener("change", (e) => { fromFiles([...e.target.files].map((file) => ({ file, rel: file.name }))); e.target.value = ""; });
$("dirIn").addEventListener("change", (e) => { fromFiles([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name }))); e.target.value = ""; });
$("again").addEventListener("click", () => { source = null; view("pickView"); });
$("changeOut").addEventListener("click", async () => {
  if (!info.canPick) return;
  try {
    const r = await api("/api/pick", { method: "POST", body: JSON.stringify({ for: "out" }) });
    if (!r.cancelled) { outPick = { id: r.id, path: r.path }; showOut(); }
  } catch (e) { $("outPath").textContent = e.message; }
});

// Drops: files and folders (walked with the entries API), anywhere on the window, while nothing runs.
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) { const file = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file, rel: prefix + file.name }); return; }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) await walkEntry(e, `${prefix}${entry.name}/`, out);
  }
}
let dragDepth = 0;
const canDrop = () => !job || !job.running;
addEventListener("dragenter", (e) => { if (!canDrop() || !e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); dragDepth++; $("dropHint").hidden = false; });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropHint").hidden = true; } });
addEventListener("dragover", (e) => { if (canDrop()) e.preventDefault(); });
addEventListener("drop", async (e) => {
  e.preventDefault(); dragDepth = 0; $("dropHint").hidden = true;
  if (!canDrop()) return;
  const dt = e.dataTransfer, out = [];
  const entries = [...(dt.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) { for (const en of entries) await walkEntry(en, "", out); }
  else for (const file of dt.files) out.push({ file, rel: file.name });
  const dirs = entries.filter((x) => x.isDirectory);
  fromFiles(out, dirs.length === 1 && entries.length === 1 ? dirs[0].name : null);
});

// ---- running ----
$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  try {
    const body = { client: info.client, options: options(), out: outPick?.id || null, source: source.kind === "folder" ? { folder: source.id } : { files: source.files.map((x) => x.rel) } };
    const j = await api("/api/job", { method: "POST", body: JSON.stringify(body) });
    startView(j);
    if (source.kind === "files") upload(j.id, source.files);
  } catch (e) { $("outPath").textContent = e.message; }
  finally { $("start").disabled = false; }
});

// Sends the dropped photos to goodbye-bg in order, a few at a time; it cuts them out as they arrive.
async function upload(id, files) {
  let at = 0;
  const one = async () => {
    while (at < files.length) {
      const i = at++;
      if (!EXTS.test(files[i].rel)) continue;
      try { await api(`/api/file/${id}/${i}`, { method: "PUT", body: files[i].file }); }
      catch (e) { if (/Stopped/.test(e.message)) return; }
    }
  };
  await Promise.all([one(), one(), one()]);
}

function startView(j) {
  job = { ...j, running: true }; shown = 0;
  $("grid").replaceChildren();
  const seen = new Set();
  for (const it of [...(j.items || []), ...(earlyItems[j.id] || [])]) if (!seen.has(it.i)) { seen.add(it.i); card(it); }
  view("runView");
  $("doneRow").hidden = true; $("stop").hidden = false; $("stop").disabled = false;
  document.body.classList.add("running");
  status(j);
  if (early[j.id]) finished(early[j.id]); // a batch with nothing to do can finish before its own reply arrives
}
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
function status(s) {
  const n = s.done + s.failed, total = s.total || 1;
  $("meterFill").style.width = `${(100 * n) / total}%`;
  $("meter").setAttribute("aria-valuemax", total); $("meter").setAttribute("aria-valuenow", n);
  const t = $("statusText");
  if (!job.running) return;
  if (!n) { t.textContent = `0 of ${s.total}`; t.append(Object.assign(document.createElement("small"), { textContent: engineText })); return; }
  const left = s.rate > 0 ? (s.total - n) / s.rate : 0;
  t.textContent = `${n} of ${s.total}`;
  t.append(Object.assign(document.createElement("small"), { textContent: `${Math.round(s.rate * 60)} a minute · ${fmt(left)} left` }));
}
function card(it) {
  const grid = $("grid");
  shown++;
  if (shown > MAX_CARDS) { // keep the page light on huge batches: the newest stay
    grid.querySelector(".card")?.remove();
    let more = grid.querySelector(".more");
    if (!more) { more = Object.assign(document.createElement("p"), { className: "more" }); grid.prepend(more); }
    more.textContent = `and ${shown - MAX_CARDS} more before these`;
  }
  const c = document.createElement("div");
  c.className = "card" + (it.ok ? "" : " failed");
  c.style.order = it.i; // name order, though they finish a little out of it
  const pic = document.createElement("div"); pic.className = "pic";
  if (it.ok) {
    const img = new Image(); img.alt = it.rel; img.decoding = "async"; img.loading = "lazy";
    img.src = `/api/thumb/${job.id}/${it.i}?t=${TOKEN}`;
    pic.append(img);
  } else pic.append(it.error || "Didn't work");
  const name = Object.assign(document.createElement("div"), { className: "name", textContent: it.empty ? `${it.rel} (no subject found)` : it.rel, title: it.rel });
  c.append(pic, name);
  grid.append(c);
}
function finished(s) {
  job = { ...job, ...s, running: false };
  document.body.classList.remove("running");
  status(s);
  const t = $("statusText");
  t.textContent = s.stopping ? `Stopped: ${s.done} cut-out${s.done === 1 ? "" : "s"}` : !s.total && s.skipped ? "Nothing new to do" : `${s.done} cut-out${s.done === 1 ? "" : "s"} done`;
  const bits = [];
  if (s.done) bits.push(`in ${fmt(s.secs)}, ${Math.round(s.rate * 60)} a minute`);
  if (s.failed) bits.push(`${s.failed} didn't work`);
  if (s.skipped) bits.push(`${s.skipped} already done`);
  if (s.empty) bits.push(`${s.empty} with no subject`);
  if (bits.length) t.append(Object.assign(document.createElement("small"), { textContent: bits.join(" · ") }));
  $("stop").hidden = true;
  $("donePath").textContent = s.out;
  $("doneRow").hidden = false;
}
$("stop").addEventListener("click", () => { $("stop").disabled = true; api(`/api/stop/${job.id}`, { method: "POST", body: "{}" }).catch(() => {}); });
$("reveal").addEventListener("click", () => api(`/api/reveal/${job.id}`, { method: "POST", body: "{}" }).catch(() => {}));
$("newBatch").addEventListener("click", () => { source = null; job = null; view("pickView"); });

function view(name) {
  for (const v of ["pickView", "setup", "runView"]) $(v).hidden = v !== name;
  if (name === "pickView") note("");
}

// ---- the connection to goodbye-bg ----
let engineText = "";
function engine(e) {
  engineText = e.text;
  $("engine").textContent = e.text;
  $("engine").classList.toggle("err", e.phase === "failed");
  if (job?.running) status({ done: job.done || 0, failed: job.failed || 0, total: job.total, rate: job.rate || 0 });
}
if (!TOKEN) { $("engine").textContent = "Open the address goodbye-bg printed in the terminal."; $("engine").classList.add("err"); }
else {
  const es = new EventSource(`/api/events?t=${TOKEN}`);
  es.addEventListener("hello", (ev) => {
    info = JSON.parse(ev.data);
    $("reveal").textContent = info.platform === "darwin" ? "Show in Finder" : info.platform === "win32" ? "Show in Explorer" : "Open folder";
    $("changeOut").hidden = !info.canPick;
    engine(info.engine);
    if (info.job && !job) { startView(info.job); if (!info.job.running) finished(info.job); }
  });
  es.addEventListener("engine", (ev) => engine(JSON.parse(ev.data)));
  es.addEventListener("photo", (ev) => {
    const m = JSON.parse(ev.data);
    if (!job || m.id !== job.id) { (earlyItems[m.id] ||= []).push(m.item); return; }
    Object.assign(job, { done: m.done, failed: m.failed, rate: m.rate });
    card(m.item); status(m);
  });
  es.addEventListener("finished", (ev) => { const s = JSON.parse(ev.data); early[s.id] = s; if (job && s.id === job.id) finished(s); });
  es.addEventListener("error", () => { $("engine").textContent = "goodbye-bg isn't running. Start it again to carry on."; $("engine").classList.add("err"); });
}
restoreOptions(); syncOptions();
