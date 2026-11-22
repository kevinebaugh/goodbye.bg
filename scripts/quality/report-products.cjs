// Tables for docs/quality-products.md from finals.cjs output.
//   node report-products.cjs <work dir> [engine ...]     (default: birefnet isnet bir640 birefnet-pp bir640-pp)
const fs = require("fs"), path = require("path");
const WORK = path.resolve(process.argv[2]);
const ENG = process.argv.slice(3).length ? process.argv.slice(3) : ["birefnet", "isnet", "bir640", "birefnet-pp", "bir640-pp"];
const load = (e) => Object.fromEntries(fs.readFileSync(path.join(WORK, "out", e, "scores.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const S = Object.fromEntries(ENG.map((e) => [e, load(e)]));
const ids = Object.keys(S[ENG[0]]);
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN, f3 = (x) => isNaN(x) ? "" : x.toFixed(3);
const grade = (r) => r.predFrac < 0.002 ? "empty" : r.iou >= 0.95 ? "good" : r.iou >= 0.85 ? "usable" : "bad";
function row(e, sel) {
  const rs = sel.map((id) => S[e][id]), g = { good: 0, usable: 0, bad: 0, empty: 0 }; rs.forEach((r) => g[grade(r)]++);
  const b = rs.filter((r) => r.biou != null);
  return `| ${e} | ${rs.length} | ${f3(mean(rs.map((r) => r.iou)))} | ${f3(mean(b.map((r) => r.biou)))} | ${f3(mean(b.map((r) => r.edge)))} | ${g.good} / ${g.usable} / ${g.bad} / ${g.empty} |`;
}
const vs = (a, b, sel, key = "iou", d = 0.02, lowerBetter = false) => {
  let better = 0, worse = 0;
  for (const id of sel) { const x = S[a][id][key], y = S[b][id][key]; if (x == null || y == null) continue; const diff = lowerBetter ? y - x : x - y; if (diff > d) better++; else if (diff < -d) worse++; }
  return `${better} / ${worse}`;
};
const groups = [["all", ids]];
for (const s of [...new Set(ids.map((id) => S[ENG[0]][id].set))]) groups.push([s, ids.filter((id) => S[ENG[0]][id].set === s)]);
const big = ids.filter((id) => { const r = S[ENG[0]][id]; return r.w * r.h >= 8e6 && (r.set === "uhrsd" || r.set === "hrsod"); });
groups.push(["photos of 8 MP or more (UHRSD, HRSOD)", big]);
for (const [name, sel] of groups) {
  console.log(`\n### ${name} (n ${sel.length})\n\n| Engine | n | IoU | Boundary IoU | Edge error | Good / usable / bad / empty |\n|---|---|---|---|---|---|`);
  for (const e of ENG) console.log(row(e, sel));
  const has = (e) => ENG.includes(e);
  const lines = [];
  if (has("isnet") && has("birefnet")) lines.push(`BiRefNet 1024 better / worse than ISNet (IoU > 0.02): ${vs("birefnet", "isnet", sel)}`);
  if (has("isnet") && has("bir640")) lines.push(`BiRefNet 640 better / worse than ISNet: ${vs("bir640", "isnet", sel)}`);
  if (has("bir640") && has("birefnet")) lines.push(`BiRefNet 640 better / worse than BiRefNet 1024: ${vs("bir640", "birefnet", sel)}`);
  for (const [p, b] of [["birefnet-pp", "birefnet"], ["bir640-pp", "bir640"]]) if (has(p) && has(b))
    lines.push(`${p} better / worse than ${b}: IoU ${vs(p, b, sel)}, boundary IoU ${vs(p, b, sel, "biou")}, edge error ${vs(p, b, sel, "edge", 0.005, true)}`);
  console.log("\n" + lines.map((l) => "- " + l).join("\n"));
}
// Seller shots: by look, shadow or reflection kept, white on white.
const sel = ids.filter((id) => S[ENG[0]][id].set === "seller");
if (sel.length) {
  console.log(`\n### Seller shots by look\n\n| Engine | Look | n | IoU | Kept of the shadow / reflection (mean) | Kept over 20% | Bad or empty |\n|---|---|---|---|---|---|---|`);
  for (const e of ENG) for (const look of ["white", "drop", "floor", "mirror"]) {
    const rs = sel.map((id) => S[e][id]).filter((r) => r.look === look);
    const k = look === "white" ? "" : f3(mean(rs.map((r) => r.kept))), o = look === "white" ? "" : rs.filter((r) => r.kept > 0.2).length;
    console.log(`| ${e} | ${look} | ${rs.length} | ${f3(mean(rs.map((r) => r.iou)))} | ${k} | ${o} | ${rs.filter((r) => ["bad", "empty"].includes(grade(r))).length} |`);
  }
  console.log(`\n| Engine | Light products (mean luminance over 200): n, IoU, recall, bad or empty | The rest: n, IoU, recall, bad or empty |\n|---|---|---|`);
  for (const e of ENG) {
    const rs = sel.map((id) => S[e][id]), L = rs.filter((r) => r.lum > 200), D = rs.filter((r) => r.lum <= 200);
    const c = (a) => `${a.length}, ${f3(mean(a.map((r) => r.iou)))}, ${f3(mean(a.map((r) => r.rec)))}, ${a.filter((r) => ["bad", "empty"].includes(grade(r))).length}`;
    console.log(`| ${e} | ${c(L)} | ${c(D)} |`);
  }
}
// Worst per engine, for the contact sheets.
if (process.env.WORST) for (const e of ENG) {
  const w = ids.map((id) => S[e][id]).sort((a, b) => a.iou - b.iou).slice(0, +process.env.WORST);
  console.log(`\nworst ${e}: ` + w.map((r) => `${r.id} ${r.iou.toFixed(2)}`).join(", "));
}
