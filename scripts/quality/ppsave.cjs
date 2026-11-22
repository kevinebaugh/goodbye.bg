// Writes one candidate's masks and scores to out/<raw name>-<candidate>/ so sheet.cjs can show them next to today's,
// and prints the photos it hurt most (for contact sheets).
//   node ppsave.cjs <work dir> <raw name> <isnet|birefnet> <candidate> [half 0|1|all] [how many worst]
const fs = require("fs"), path = require("path");
const [WORK_, NAME, KIND, CAND, H = "all", K = "10"] = process.argv.slice(2), WORK = path.resolve(WORK_);
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), C = require("./ppcands.cjs");
const ppDir = path.join(WORK, "pp"), load = (f) => fs.readFileSync(path.join(ppDir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const all = load(NAME + ".jsonl"), byId = Object.fromEntries(all.map((r) => [r.id, r]));
for (const f of fs.readdirSync(ppDir)) if (f.startsWith(NAME + ".") && f.endsWith(".jsonl") && f !== NAME + ".jsonl") for (const r of load(f)) if (byId[r.id]) Object.assign(byId[r.id].c, r.c);
const rows = all.filter((r) => H === "all" || r.half === +H);
(async () => {
  const dir = path.join(WORK, "out", `${NAME}-${CAND}`); fs.mkdirSync(dir, { recursive: true });
  const sc = fs.createWriteStream(path.join(dir, "scores.jsonl"));
  const hurt = rows.map((r) => ({ id: r.id, d: (r.c[CAND] || r.base).iou - r.base.iou })).sort((a, b) => a.d - b.d);
  const gain = [...hurt].reverse(), want = new Set([...hurt.slice(0, +K), ...gain.slice(0, +K)].map((x) => x.id));
  const man = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const extra = new Set((process.env.IDS || "").split(" ").filter(Boolean)); for (const id of extra) want.add(id); // IDS="<id> ...": save these too
  for (const r of rows) {
    const s = r.c[CAND] || r.base; sc.write(JSON.stringify({ id: r.id, iou: s.iou, box: s.box }) + "\n");
    if (!want.has(r.id)) continue;
    const raw = await sharp(path.join(WORK, "raw", NAME, r.id + ".png")).extractChannel(0).raw().toBuffer();
    const pre = C.pre(raw, KIND === "isnet"), base = C.lut(pre);
    const file = path.join(WORK, man[r.id].image), meta = await sharp(file).metadata(), pk = Math.min(1, 1600 / Math.max(meta.width, meta.height));
    let img = sharp(file).removeAlpha(); // as postproc.cjs (and the page): at most 1600 px first
    if (pk < 1) img = sharp(await img.resize(Math.round(meta.width * pk), Math.round(meta.height * pk), { fit: "fill", kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: Math.round(meta.width * pk), height: Math.round(meta.height * pk), channels: 3 } });
    const rgb = await img.resize(1024, 1024, { fit: "fill", kernel: "linear" }).raw().toBuffer();
    await sharp(Buffer.from(C.CANDIDATES[CAND](pre, base, rgb)), { raw: { width: 1024, height: 1024, channels: 1 } }).png().toFile(path.join(dir, r.id + ".png"));
  }
  sc.end();
  console.log("worst:", hurt.slice(0, +K).filter((x) => x.d < 0).map((x) => x.id).join(" "));
  console.log("best:", gain.slice(0, +K).filter((x) => x.d > 0).map((x) => x.id).join(" "));
})();
