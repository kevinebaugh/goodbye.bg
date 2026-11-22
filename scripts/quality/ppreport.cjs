// Tables from postproc.cjs: every candidate on the tuning half, the best of each family on the held-out half.
//   node ppreport.cjs <work dir> <raw name> [half: 0 | 1 | all] [candidate ...]
const fs = require("fs"), path = require("path");
const [WORK, NAME, H = "0", ...pick] = process.argv.slice(2);
const ppDir = path.join(path.resolve(WORK), "pp"), load = (f) => fs.readFileSync(path.join(ppDir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const all = load(NAME + ".jsonl"), byId = Object.fromEntries(all.map((r) => [r.id, r]));
// Later runs of some candidates (postproc.cjs with PP_ONLY) sit in <name>.<suffix>.jsonl: merged in.
for (const f of fs.readdirSync(ppDir)) if (f.startsWith(NAME + ".") && f.endsWith(".jsonl") && f !== NAME + ".jsonl") for (const r of load(f)) if (byId[r.id]) Object.assign(byId[r.id].c, r.c);
const rows = all.filter((r) => H === "all" || r.half === +H);
const grade = (s) => !s.box ? "none" : s.iou >= 0.95 ? "good" : s.iou >= 0.85 ? "usable" : "bad";
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function stat(get) {
  const s = rows.map((r) => [r.base, get(r)]), e = s.filter(([b]) => b.biou != null), g = { good: 0, usable: 0, bad: 0, none: 0 };
  for (const [, x] of s) g[grade(x)]++;
  const better = s.filter(([b, x]) => x.iou - b.iou > 0.02).length, worse = s.filter(([b, x]) => b.iou - x.iou > 0.02).length;
  const bb = e.filter(([b, x]) => x.biou - b.biou > 0.02).length, bw = e.filter(([b, x]) => b.biou - x.biou > 0.02).length;
  const eb = e.filter(([b, x]) => b.edge - x.edge > 0.005).length, ew = e.filter(([b, x]) => x.edge - b.edge > 0.005).length;
  const cat = s.filter(([b, x]) => b.iou - x.iou > 0.2 || (b.box && !x.box)).length, changed = rows.filter((r) => get(r) !== r.base).length;
  return { n: s.length, iou: mean(s.map(([, x]) => x.iou)), biou: mean(e.map(([, x]) => x.biou)), edge: mean(e.map(([, x]) => x.edge)), mae: mean(s.map(([, x]) => x.mae)), ...g, better, worse, bb, bw, eb, ew, cat, changed };
}
const names = pick.length ? pick : Object.keys(rows[0].c);
const res = { base: stat((r) => r.base) };
for (const k of names) res[k] = stat((r) => r.c[k] || r.base);
const f = (x, d = 4) => x.toFixed(d);
console.log(`${NAME} half=${H} n=${rows.length}`);
console.log("candidate".padEnd(24), "IoU     bIoU    edge    MAE     good/usable/bad/none  better/worse  bIoU b/w  edge b/w  catastrophic  changed");
for (const [k, s] of Object.entries(res)) console.log(k.padEnd(24), f(s.iou), f(s.biou), f(s.edge), f(s.mae), `${s.good}/${s.usable}/${s.bad}/${s.none}`.padEnd(21), `${s.better}/${s.worse}`.padEnd(13), `${s.bb}/${s.bw}`.padEnd(9), `${s.eb}/${s.ew}`.padEnd(9), String(s.cat).padEnd(13), s.changed);
// Per set: mean IoU change and better/worse/catastrophic for the named candidates.
if (pick.length) for (const k of pick) {
  const sets = {}; for (const r of rows) (sets[r.set] ||= []).push(r);
  console.log(`\n${k} by set:`);
  for (const [s, rs] of Object.entries(sets)) {
    const d = rs.map((r) => (r.c[k] || r.base).iou - r.base.iou);
    console.log(" ", s.padEnd(10), `n=${rs.length}`.padEnd(6), "dIoU", (mean(d) >= 0 ? "+" : "") + mean(d).toFixed(4), "better/worse", d.filter((x) => x > 0.02).length + "/" + d.filter((x) => x < -0.02).length, "cat", d.filter((x) => x < -0.2).length);
  }
}
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(res, null, 1));
