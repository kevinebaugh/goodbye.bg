// Tables from the harness scores: per model, per set and category. node summary.cjs <work dir>  (writes out/summary.json)
const fs = require("fs"), path = require("path"), WORK = path.resolve(process.argv[2]);
const load = (m) => fs.readFileSync(path.join(WORK, "out", m, "scores.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const S = { isnet: load("isnet"), birefnet: load("birefnet") };
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1), med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// Automatic grade from the mask overlap alone (see docs/quality-1000.md for how well it tracks the eye).
const grade = (r) => !r.box ? "none" : r.iou >= 0.95 ? "good" : r.iou >= 0.85 ? "usable" : "bad";
const stat = (rows) => {
  const o = { n: rows.length, iou: mean(rows.map((r) => r.iou)), iouMed: med(rows.map((r) => r.iou)), mae: mean(rows.map((r) => r.mae)), none: rows.filter((r) => !r.box).length,
    good: rows.filter((r) => grade(r) === "good").length, usable: rows.filter((r) => grade(r) === "usable").length, bad: rows.filter((r) => grade(r) === "bad").length,
    under90: rows.filter((r) => r.iou < 0.9).length, under50: rows.filter((r) => r.iou < 0.5).length,
    // what went wrong on photos under 0.9: kept things that are not the subject (precision low), lost parts of it (recall low)
    leftover: rows.filter((r) => r.iou < 0.9 && r.prec < 0.92 && r.rec >= 0.92).length, missing: rows.filter((r) => r.iou < 0.9 && r.rec < 0.92 && r.prec >= 0.92).length,
    both: rows.filter((r) => r.iou < 0.9 && r.rec < 0.92 && r.prec < 0.92).length };
  const e = rows.filter((r) => r.biou != null);
  if (e.length) { o.biou = mean(e.map((r) => r.biou)); o.edge = mean(e.map((r) => r.edge)); }
  const g = rows.filter((r) => r.iou2 != null); if (g.length) o.iou2 = mean(g.map((r) => Math.max(r.iou, r.iou2)));
  return o;
};
const out = {};
for (const m in S) {
  const groups = { all: S[m] };
  for (const r of S[m]) { (groups[r.set] ||= []).push(r); const c = r.set === "coco" ? "coco / " + r.cat.split(":")[0] : r.set === "aim500" || r.set === "pets" ? r.set + " / " + r.cat : null; if (c) (groups[c] ||= []).push(r); }
  out[m] = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, stat(v)]));
}
// Head to head on the same photo.
const bi = Object.fromEntries(S.birefnet.map((r) => [r.id, r]));
let bw = 0, iw = 0, tie = 0; for (const r of S.isnet) { const d = bi[r.id].iou - r.iou; if (d > 0.02) bw++; else if (d < -0.02) iw++; else tie++; }
out.headToHead = { birefnetBetter: bw, isnetBetter: iw, within002: tie };
fs.writeFileSync(path.join(WORK, "out", "summary.json"), JSON.stringify(out, null, 1));
const f = (x, d = 3) => x == null ? "" : x.toFixed(d);
for (const k of Object.keys(out.isnet)) {
  const a = out.isnet[k], b = out.birefnet[k];
  console.log(`${k.padEnd(22)} n=${String(a.n).padStart(4)} | ISNet IoU ${f(a.iou)} med ${f(a.iouMed)} MAE ${f(a.mae, 4)} bIoU ${f(a.biou)} edge ${f(a.edge)} g/u/b/none ${a.good}/${a.usable}/${a.bad}/${a.none} | BiRefNet IoU ${f(b.iou)} med ${f(b.iouMed)} MAE ${f(b.mae, 4)} bIoU ${f(b.biou)} edge ${f(b.edge)} g/u/b/none ${b.good}/${b.usable}/${b.bad}/${b.none}`);
}
console.log(out.headToHead, "fail types <0.9 (leftover/missing/both): isnet", out.isnet.all.leftover, out.isnet.all.missing, out.isnet.all.both, "birefnet", out.birefnet.all.leftover, out.birefnet.all.missing, out.birefnet.all.both);
console.log("coco best-of IoU", f(out.isnet.coco.iou2), f(out.birefnet.coco.iou2));
