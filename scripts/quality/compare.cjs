// An experiment against the baseline, photo by photo: node compare.cjs <work dir> <base out dir> <variant out dir>
const fs = require("fs"), path = require("path"), WORK = path.resolve(process.argv[2]);
const load = (d) => Object.fromEntries(fs.readFileSync(path.join(WORK, "out", d, "scores.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const A = load(process.argv[3]), B = load(process.argv[4]), mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1), f = (x) => (x == null || isNaN(x) ? "  –  " : x.toFixed(3));
const line = (label, ids) => {
  if (!ids.length) return;
  const m = (S, k) => mean(ids.filter((i) => S[i][k] != null).map((i) => S[i][k]));
  let up = 0, down = 0; for (const i of ids) { const d = B[i].iou - A[i].iou; if (d > 0.02) up++; else if (d < -0.02) down++; }
  console.log(`${label.padEnd(26)} n=${String(ids.length).padStart(4)}  IoU ${f(m(A, "iou"))} > ${f(m(B, "iou"))}  MAE ${f(m(A, "mae"))} > ${f(m(B, "mae"))}  bIoU ${f(m(A, "biou"))} > ${f(m(B, "biou"))}  edge ${f(m(A, "edge"))} > ${f(m(B, "edge"))}  better ${up} worse ${down}  none ${ids.filter((i) => !A[i].box).length} > ${ids.filter((i) => !B[i].box).length}`);
};
const ids = Object.keys(A).filter((i) => B[i]), changed = ids.filter((i) => B[i].zoom != null || JSON.stringify(A[i].box) !== JSON.stringify(B[i].box) || A[i].iou !== B[i].iou);
line("all", ids); line("changed photos", changed);
for (const s of ["aim500", "p3m", "am2k", "pets", "dis", "coco"]) line(s, ids.filter((i) => A[i].set === s));
if (ids.some((i) => B[i].zoom != null)) for (const [lo, hi] of [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8]]) line(`zoomed part ${lo}-${hi} of frame`, ids.filter((i) => B[i].zoom != null && B[i].zoom >= lo && B[i].zoom < hi && A[i].set !== "coco"));
const worst = changed.map((i) => [i, B[i].iou - A[i].iou]).sort((a, b) => a[1] - b[1]);
console.log("worst", worst.slice(0, 6).map(([i, d]) => i + " " + d.toFixed(2)).join(", ")); console.log("best", worst.slice(-6).map(([i, d]) => i + " +" + d.toFixed(2)).join(", "));
